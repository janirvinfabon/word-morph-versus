/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers'

// @ts-expect-error — plain ESM module with a sibling .d.ts
import { validateMove, pickStartWord, singleDiffIndex, findNeighbors, TURN_MS } from './gameLogic.mjs'
import type { LossReason, WordLength } from './gameLogic'
import type {
  PartyChainEntry,
  PartyClientMsg,
  PartyFailedEntry,
  PartyGameState,
  PartyMissedWords,
  PartyPlayerPublic,
  PartyServerMsg
} from './partyProtocol'
import { PARTY_MAX_PLAYERS, PARTY_MIN_PLAYERS } from './partyProtocol'

import words4 from './words/words-4.json'
import words5 from './words/words-5.json'
import words6 from './words/words-6.json'
import starts4 from './words/starts-4.json'
import starts5 from './words/starts-5.json'
import starts6 from './words/starts-6.json'

const WORD_SETS: Record<WordLength, Set<string>> = {
  4: new Set(words4 as string[]),
  5: new Set(words5 as string[]),
  6: new Set(words6 as string[])
}
const START_LISTS: Record<WordLength, string[]> = {
  4: (starts4 as string[]).length ? (starts4 as string[]) : (words4 as string[]),
  5: (starts5 as string[]).length ? (starts5 as string[]) : (words5 as string[]),
  6: (starts6 as string[]).length ? (starts6 as string[]) : (words6 as string[])
}

/** Idle rooms are cleaned up after this long with no activity. */
const IDLE_EXPIRY_MS = 30 * 60 * 1000 // 30 minutes

interface SessionMeta {
  /** Stable player id this socket belongs to, or null if unassigned. */
  id: string | null
}

/** Internal per-player record (persisted). */
interface PartyPlayer {
  id: string
  name: string
  eliminated: boolean
  lossReason: LossReason | null
  /** Set when eliminated (or when they win). null while active. */
  placement: number | null
}

/** Persisted authoritative state (survives hibernation / eviction). */
interface PersistedState {
  roomCode: string
  phase: PartyGameState['phase']
  length: WordLength
  /** Fixed seating order (join order). */
  players: PartyPlayer[]
  /** id of the player whose turn it is, or null when not playing. */
  currentId: string | null
  chain: PartyChainEntry[]
  used: string[]
  /** Failed attempts (broken chain / timeout / resign), for red history. */
  failedAttempts: PartyFailedEntry[]
  /** Missed moves for the decisive (final) loss, else null. */
  missedWords: PartyMissedWords | null
  winnerId: string | null
  /** Running counter: how many players have been eliminated so far. */
  eliminatedCount: number
  turnEndsAt: number | null
}

export interface PartyEnv {
  PARTY_ROOM: DurableObjectNamespace
  REGISTRY: DurableObjectNamespace
}

export class PartyRoomDurableObject extends DurableObject<PartyEnv> {
  private sessions = new Map<WebSocket, SessionMeta>()
  private state!: PersistedState
  private loaded = false

  constructor(ctx: DurableObjectState, env: PartyEnv) {
    super(ctx, env)

    for (const ws of this.ctx.getWebSockets()) {
      const meta = ws.deserializeAttachment() as SessionMeta | null
      if (meta) this.sessions.set(ws, meta)
    }

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    )

    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<PersistedState>('state')
      this.state = stored ?? this.freshState('')
      this.loaded = true
    })
  }

  private freshState(roomCode: string): PersistedState {
    return {
      roomCode,
      phase: 'waiting',
      length: 4,
      players: [],
      currentId: null,
      chain: [],
      used: [],
      failedAttempts: [],
      missedWords: null,
      winnerId: null,
      eliminatedCount: 0,
      turnEndsAt: null
    }
  }

  private async persist() {
    await this.ctx.storage.put('state', this.state)
    const idleAt = Date.now() + IDLE_EXPIRY_MS
    const alarmAt =
      this.state.phase === 'playing' && this.state.turnEndsAt
        ? Math.min(this.state.turnEndsAt, idleAt)
        : idleAt
    await this.ctx.storage.setAlarm(alarmAt)
  }

  private armTurn() {
    this.state.turnEndsAt = Date.now() + TURN_MS
  }

  /**
   * Best-effort changed-letter index for a FAILED word (for highlighting):
   * the single changed position if there is one, else the first differing
   * position, else null (wordless/empty).
   */
  private failedChangedIndex(candidate: string): number | null {
    const cur = this.state.chain[this.state.chain.length - 1]?.word ?? ''
    const next = (candidate ?? '').toUpperCase()
    if (!next) return null
    const single = singleDiffIndex(cur, next) as number
    if (single >= 0) return single
    const n = Math.min(cur.length, next.length)
    for (let i = 0; i < n; i++) {
      if (cur[i] !== next[i]) return i
    }
    return n < next.length || n < cur.length ? n : null
  }

  /** Append a failed attempt so clients can render it in red. */
  private recordFailure(word: string, by: string, loss: LossReason) {
    this.state.failedAttempts.push({
      word: (word ?? '').toUpperCase(),
      by,
      changedIndex: word ? this.failedChangedIndex(word) : null,
      lossReason: loss
    })
  }

  /** Compute the moves the final loser could have played, for game over. */
  private computeMissedWords() {
    const fromWord = this.state.chain[this.state.chain.length - 1]?.word ?? ''
    if (!fromWord) {
      this.state.missedWords = null
      return
    }
    const used = new Set(this.state.used)
    const { words, allUsed } = findNeighbors(
      fromWord,
      WORD_SETS[this.state.length],
      used
    ) as { words: string[]; allUsed: boolean }
    this.state.missedWords = { fromWord, words, allUsed }
  }

  /* ---------------------------- roster helpers --------------------------- */

  private activePlayers(): PartyPlayer[] {
    return this.state.players.filter((p) => !p.eliminated)
  }

  private playerById(id: string | null): PartyPlayer | undefined {
    if (!id) return undefined
    return this.state.players.find((p) => p.id === id)
  }

  /**
   * Given the current player's id, return the id of the next ACTIVE player in
   * seating order (wrapping around), skipping eliminated players. Returns null
   * if no other active player exists.
   */
  private nextActiveId(fromId: string): string | null {
    const n = this.state.players.length
    const startIdx = this.state.players.findIndex((p) => p.id === fromId)
    if (startIdx === -1) return null
    for (let step = 1; step <= n; step++) {
      const cand = this.state.players[(startIdx + step) % n]
      if (!cand.eliminated) return cand.id
    }
    return null
  }

  private newPlayerId(): string {
    return crypto.randomUUID().slice(0, 8)
  }

  /* --------------------------- registry sync --------------------------- */

  private registryStub() {
    const id = this.env.REGISTRY.idFromName('global')
    return this.env.REGISTRY.get(id)
  }

  /**
   * A party room is listed in the public lobby only while WAITING (not yet
   * started) and not empty. Uses a `party:` key prefix so it never collides
   * with 2-player duel listings in the same registry.
   */
  private async syncRegistry() {
    const open =
      this.state.phase === 'waiting' &&
      this.state.players.length > 0 &&
      !!this.state.roomCode
    try {
      if (open) {
        const hostName = this.state.players[0]?.name ?? 'Player'
        await this.registryStub().fetch('https://registry/register', {
          method: 'POST',
          body: JSON.stringify({
            code: this.state.roomCode,
            hostName,
            length: this.state.length,
            createdAt: Date.now(),
            mode: 'party',
            playerCount: this.state.players.length,
            maxPlayers: PARTY_MAX_PLAYERS
          })
        })
      } else if (this.state.roomCode) {
        await this.registryStub().fetch('https://registry/deregister', {
          method: 'POST',
          body: JSON.stringify({ code: this.state.roomCode })
        })
      }
    } catch {
      /* registry is best-effort; never block gameplay on it */
    }
  }

  /* ----------------------------- HTTP / WS ----------------------------- */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const roomCode = (url.searchParams.get('room') ?? '').toUpperCase()

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }

    if (!this.state.roomCode && roomCode) {
      this.state.roomCode = roomCode
      await this.persist()
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    this.ctx.acceptWebSocket(server)
    const meta: SessionMeta = { id: null }
    server.serializeAttachment(meta)
    this.sessions.set(server, meta)

    return new Response(null, { status: 101, webSocket: client })
  }

  /* --------------------------- message router --------------------------- */

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: PartyClientMsg
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      return this.sendTo(ws, { type: 'error', reason: 'Malformed message.' })
    }

    switch (msg.type) {
      case 'join':
        return this.onJoin(ws, msg.name)
      case 'start':
        return this.onStart(ws, msg.length)
      case 'move':
        return this.onMove(ws, msg.word)
      case 'rematch':
        return this.onRematch(ws)
      case 'resign':
        return this.onResign(ws)
      case 'leave':
        return this.onLeave(ws)
      default:
        return this.sendTo(ws, { type: 'error', reason: 'Unknown message.' })
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.dropSocket(ws)
  }

  async webSocketError(ws: WebSocket) {
    this.dropSocket(ws)
  }

  private dropSocket(ws: WebSocket) {
    const existed = this.sessions.delete(ws)
    try {
      ws.close()
    } catch {
      /* already closed */
    }
    // Keep the player's slot so they can rejoin by name and resume (the
    // connected flag flips off until they return). A disconnected player is
    // NOT eliminated here — their turn clock still runs via the alarm.
    if (existed) this.broadcastState()
  }

  /* ------------------------------ handlers ------------------------------ */

  private onJoin(ws: WebSocket, rawName: string) {
    const name = (rawName || '').trim().slice(0, 16) || 'Player'

    // Rejoin: if a player with this name exists, reclaim that identity.
    const existing = this.state.players.find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    )
    if (existing) {
      const meta: SessionMeta = { id: existing.id }
      this.sessions.set(ws, meta)
      ws.serializeAttachment(meta)
      this.broadcastState()
      return
    }

    // New player. Only allowed while the room is still WAITING.
    if (this.state.phase !== 'waiting') {
      return this.sendTo(ws, { type: 'in-progress' })
    }
    if (this.state.players.length >= PARTY_MAX_PLAYERS) {
      return this.sendTo(ws, { type: 'full' })
    }

    const id = this.newPlayerId()
    this.state.players.push({
      id,
      name,
      eliminated: false,
      lossReason: null,
      placement: null
    })
    const meta: SessionMeta = { id }
    this.sessions.set(ws, meta)
    ws.serializeAttachment(meta)

    void this.persist()
    void this.syncRegistry()
    this.broadcastState()
  }

  private onStart(ws: WebSocket, length: WordLength) {
    const meta = this.sessions.get(ws)
    if (!meta?.id) {
      return this.sendTo(ws, { type: 'error', reason: 'Join the room first.' })
    }
    // Only the host (first player in seating order) may start.
    if (this.state.players[0]?.id !== meta.id) {
      return this.sendTo(ws, { type: 'error', reason: 'Only the host can start.' })
    }
    if (this.state.phase !== 'waiting') return
    if (this.state.players.length < PARTY_MIN_PLAYERS) {
      return this.sendTo(ws, {
        type: 'error',
        reason: `Need at least ${PARTY_MIN_PLAYERS} players to start.`
      })
    }

    const len = ([4, 5, 6] as WordLength[]).includes(length) ? length : 4
    const start = pickStartWord(START_LISTS[len], WORD_SETS[len])

    this.state.length = len
    this.state.chain = [{ word: start, by: null, changedIndex: null }]
    this.state.used = [start]
    this.state.failedAttempts = []
    this.state.missedWords = null
    for (const p of this.state.players) {
      p.eliminated = false
      p.lossReason = null
      p.placement = null
    }
    this.state.eliminatedCount = 0
    this.state.currentId = this.state.players[0].id
    this.state.winnerId = null
    this.state.phase = 'playing'
    this.armTurn()

    void this.persist()
    void this.syncRegistry()
    this.broadcastState()
  }

  private onMove(ws: WebSocket, word: string) {
    const meta = this.sessions.get(ws)
    if (!meta?.id) return
    if (this.state.phase !== 'playing') return
    if (meta.id !== this.state.currentId) {
      return this.sendTo(ws, { type: 'error', reason: "It's not your turn." })
    }

    const mover = this.playerById(meta.id)
    if (!mover || mover.eliminated) return

    const current = this.state.chain[this.state.chain.length - 1].word
    const used = new Set(this.state.used)
    const result = validateMove(
      current,
      word,
      used,
      WORD_SETS[this.state.length],
      this.state.length
    )

    if (!result.ok) {
      // Illegal move => this player is eliminated (not an instant game over).
      this.sendTo(ws, { type: 'error', reason: result.reason ?? 'Illegal move.' })
      this.recordFailure(word, mover.id, (result.loss ?? 'invalid-word') as LossReason)
      this.eliminate(mover, (result.loss ?? 'invalid-word') as LossReason)
      this.advanceOrEnd(mover.id)
      return
    }

    const next = word.toUpperCase()
    this.state.chain.push({
      word: next,
      by: mover.id,
      changedIndex: result.changedIndex ?? null
    })
    this.state.used.push(next)
    // Chain continues from the new word; pass to the next active player.
    const nextId = this.nextActiveId(mover.id)
    this.state.currentId = nextId
    this.armTurn()
    void this.persist()
    this.broadcastState()
  }

  private onResign(ws: WebSocket) {
    const meta = this.sessions.get(ws)
    if (!meta?.id) return
    if (this.state.phase !== 'playing') return
    const p = this.playerById(meta.id)
    if (!p || p.eliminated) return

    const wasCurrent = this.state.currentId === p.id
    this.recordFailure('', p.id, 'resign')
    this.eliminate(p, 'resign')
    // If the resigner was the active player, advance from them; otherwise the
    // active player is unchanged but we must still check for a lone survivor.
    this.advanceOrEnd(wasCurrent ? p.id : (this.state.currentId ?? p.id))
  }

  private onRematch(ws: WebSocket) {
    const meta = this.sessions.get(ws)
    if (!meta?.id) return
    if (this.state.phase !== 'gameover') return
    if (this.state.players.length < PARTY_MIN_PLAYERS) {
      // Not enough players remain for another party; stay in gameover.
      return this.sendTo(ws, {
        type: 'error',
        reason: `Need at least ${PARTY_MIN_PLAYERS} players to rematch.`
      })
    }
    const len = this.state.length
    const start = pickStartWord(START_LISTS[len], WORD_SETS[len])
    this.state.chain = [{ word: start, by: null, changedIndex: null }]
    this.state.used = [start]
    this.state.failedAttempts = []
    this.state.missedWords = null
    for (const p of this.state.players) {
      p.eliminated = false
      p.lossReason = null
      p.placement = null
    }
    this.state.eliminatedCount = 0
    this.state.currentId = this.state.players[0].id
    this.state.winnerId = null
    this.state.phase = 'playing'
    this.armTurn()
    void this.persist()
    void this.syncRegistry()
    this.broadcastState()
  }

  private onLeave(ws: WebSocket) {
    const meta = this.sessions.get(ws)
    this.sessions.delete(ws)

    if (meta?.id) {
      const p = this.playerById(meta.id)
      if (p) {
        if (this.state.phase === 'waiting') {
          // Pre-game: remove them from the roster entirely to free the slot.
          this.state.players = this.state.players.filter((x) => x.id !== p.id)
        } else if (this.state.phase === 'playing' && !p.eliminated) {
          // Mid-game: leaving is a resignation (elimination).
          const wasCurrent = this.state.currentId === p.id
          this.recordFailure('', p.id, 'resign')
          this.eliminate(p, 'resign')
          this.advanceOrEnd(wasCurrent ? p.id : (this.state.currentId ?? p.id))
          try {
            ws.close(1000, 'left')
          } catch {
            /* noop */
          }
          return
        }
      }
    }

    try {
      ws.close(1000, 'left')
    } catch {
      /* noop */
    }
    void this.persist()
    void this.syncRegistry()
    this.broadcastState()
  }

  /* --------------------------- elimination core -------------------------- */

  /** Mark a player eliminated and assign their placement (reverse finish). */
  private eliminate(p: PartyPlayer, reason: LossReason) {
    if (p.eliminated) return
    p.eliminated = true
    p.lossReason = reason
    this.state.eliminatedCount += 1
    // Last to be eliminated gets the best (lowest) non-winning placement.
    // With N players, the k-th eliminated places (N - k + 1).
    p.placement = this.state.players.length - this.state.eliminatedCount + 1
  }

  /**
   * After an elimination, either end the game (one survivor) or pass the turn
   * to the next active player. `fromId` is the seat to advance from.
   */
  private advanceOrEnd(fromId: string) {
    const active = this.activePlayers()
    if (active.length <= 1) {
      const winner = active[0] ?? null
      if (winner) {
        winner.placement = 1
        this.state.winnerId = winner.id
      } else {
        this.state.winnerId = null
      }
      // Missed moves for the decisive loser (skip if they resigned/left).
      const loser = this.playerById(fromId)
      if (loser && loser.lossReason !== 'resign') {
        this.computeMissedWords()
      } else {
        this.state.missedWords = null
      }
      this.state.phase = 'gameover'
      this.state.currentId = null
      this.state.turnEndsAt = null
      void this.persist()
      void this.syncRegistry()
      this.broadcastState()
      return
    }

    this.state.currentId = this.nextActiveId(fromId)
    this.armTurn()
    void this.persist()
    this.broadcastState()
  }

  /* ------------------------------ broadcast ----------------------------- */

  private connectedIds(): Set<string> {
    const s = new Set<string>()
    for (const meta of this.sessions.values()) {
      if (meta.id) s.add(meta.id)
    }
    return s
  }

  private snapshot(): PartyGameState {
    const connected = this.connectedIds()
    const players: PartyPlayerPublic[] = this.state.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: connected.has(p.id),
      eliminated: p.eliminated,
      lossReason: p.lossReason,
      placement: p.placement
    }))
    return {
      phase: this.state.phase,
      length: this.state.length,
      players,
      currentId: this.state.currentId,
      chain: this.state.chain,
      failedAttempts: this.state.failedAttempts,
      missedWords: this.state.missedWords,
      winnerId: this.state.winnerId,
      roomCode: this.state.roomCode,
      maxPlayers: PARTY_MAX_PLAYERS,
      turnEndsAt: this.state.turnEndsAt
    }
  }

  private broadcastState() {
    const base = this.snapshot()
    for (const [ws, meta] of this.sessions) {
      this.sendTo(ws, { type: 'state', state: base, you: meta.id })
    }
  }

  private sendTo(ws: WebSocket, msg: PartyServerMsg) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      /* socket not writable */
    }
  }

  /* ------------------------------- alarm -------------------------------- */

  async alarm() {
    // Turn timeout: the current player is eliminated (then advance/end).
    if (
      this.state.phase === 'playing' &&
      this.state.turnEndsAt !== null &&
      Date.now() >= this.state.turnEndsAt &&
      this.state.currentId
    ) {
      const p = this.playerById(this.state.currentId)
      if (p && !p.eliminated) {
        const fromId = p.id
        this.recordFailure('', p.id, 'timeout')
        this.eliminate(p, 'timeout')
        // advanceOrEnd persists + broadcasts + re-arms the alarm.
        this.advanceOrEnd(fromId)
        return
      }
    }

    // Idle cleanup: nobody connected => wipe the room to reclaim storage.
    if (this.sessions.size === 0) {
      const code = this.state.roomCode
      await this.ctx.storage.deleteAll()
      this.state = this.freshState('')
      if (code) {
        try {
          await this.registryStub().fetch('https://registry/deregister', {
            method: 'POST',
            body: JSON.stringify({ code })
          })
        } catch {
          /* ignore */
        }
      }
      return
    }

    const idleAt = Date.now() + IDLE_EXPIRY_MS
    const alarmAt =
      this.state.phase === 'playing' && this.state.turnEndsAt
        ? Math.min(this.state.turnEndsAt, idleAt)
        : idleAt
    await this.ctx.storage.setAlarm(alarmAt)
  }
}
