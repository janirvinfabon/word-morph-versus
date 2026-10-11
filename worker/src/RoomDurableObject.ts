/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers'

// @ts-expect-error — plain ESM module with a sibling .d.ts
import { validateMove, pickStartWord, TURN_MS } from './gameLogic.mjs'
import type { LossReason, PlayerIndex, WordLength } from './gameLogic'
import type { ChainEntry, ClientMsg, GameState, ServerMsg } from './protocol'

import words4 from './words/words-4.json'
import words5 from './words/words-5.json'
import words6 from './words/words-6.json'
import starts4 from './words/starts-4.json'
import starts5 from './words/starts-5.json'
import starts6 from './words/starts-6.json'

const WORD_LISTS: Record<WordLength, string[]> = {
  4: words4 as string[],
  5: words5 as string[],
  6: words6 as string[]
}
const WORD_SETS: Record<WordLength, Set<string>> = {
  4: new Set(words4 as string[]),
  5: new Set(words5 as string[]),
  6: new Set(words6 as string[])
}
// Common-biased pools used ONLY to seed the random start word, so matches
// open on familiar words even though any WORD_SETS entry is a legal move.
const START_LISTS: Record<WordLength, string[]> = {
  4: (starts4 as string[]).length ? (starts4 as string[]) : (words4 as string[]),
  5: (starts5 as string[]).length ? (starts5 as string[]) : (words5 as string[]),
  6: (starts6 as string[]).length ? (starts6 as string[]) : (words6 as string[])
}

/** Idle rooms are cleaned up after this long with no activity. */
const IDLE_EXPIRY_MS = 30 * 60 * 1000 // 30 minutes

interface SessionMeta {
  /** Player slot this socket occupies, or null if a spectator/unassigned. */
  index: PlayerIndex | null
  name: string
}

/** Persisted authoritative state (survives hibernation / eviction). */
interface PersistedState {
  roomCode: string
  phase: GameState['phase']
  length: WordLength
  playerNames: [string | null, string | null]
  current: PlayerIndex
  chain: ChainEntry[]
  used: string[]
  winner: PlayerIndex | null
  lossReason: LossReason | null
  /** Epoch ms when the current turn times out (playing only), else null. */
  turnEndsAt: number | null
}

export interface Env {
  ROOM: DurableObjectNamespace
  REGISTRY: DurableObjectNamespace
}

export class RoomDurableObject extends DurableObject<Env> {
  private sessions = new Map<WebSocket, SessionMeta>()
  private state!: PersistedState
  private loaded = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Reconstruct live sockets after hibernation.
    for (const ws of this.ctx.getWebSockets()) {
      const meta = ws.deserializeAttachment() as SessionMeta | null
      if (meta) this.sessions.set(ws, meta)
    }

    // Keepalive that does NOT wake the DO from hibernation.
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    )

    // Load persisted game state lazily/at construction via a blocking read.
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
      playerNames: [null, null],
      current: 0,
      chain: [],
      used: [],
      winner: null,
      lossReason: null,
      turnEndsAt: null
    }
  }

  /**
   * Persist state and (re)arm the single DO alarm. While a game is in
   * progress the alarm fires at the turn deadline (to enforce timeout);
   * otherwise it fires at the idle-expiry horizon to reclaim storage.
   */
  private async persist() {
    await this.ctx.storage.put('state', this.state)
    const idleAt = Date.now() + IDLE_EXPIRY_MS
    const alarmAt =
      this.state.phase === 'playing' && this.state.turnEndsAt
        ? Math.min(this.state.turnEndsAt, idleAt)
        : idleAt
    await this.ctx.storage.setAlarm(alarmAt)
  }

  /** Begin the current player's turn clock. */
  private armTurn() {
    this.state.turnEndsAt = Date.now() + TURN_MS
  }

  /* --------------------------- registry sync --------------------------- */

  /** How many player slots are currently filled (by name, not sockets). */
  private filledSlots(): number {
    return (
      (this.state.playerNames[0] ? 1 : 0) + (this.state.playerNames[1] ? 1 : 0)
    )
  }

  private registryStub() {
    const id = this.env.REGISTRY.idFromName('global')
    return this.env.REGISTRY.get(id)
  }

  /**
   * Keep the public lobby registry in sync with this room's state. A room is
   * "open" (listed) only while it is WAITING with exactly one player present.
   * Any other state (full, playing, over, empty) means it should be delisted.
   */
  private async syncRegistry() {
    const open =
      this.state.phase === 'waiting' &&
      this.filledSlots() === 1 &&
      !!this.state.roomCode
    try {
      if (open) {
        const hostName =
          this.state.playerNames[0] ?? this.state.playerNames[1] ?? 'Player'
        await this.registryStub().fetch('https://registry/register', {
          method: 'POST',
          body: JSON.stringify({
            code: this.state.roomCode,
            hostName,
            length: this.state.length,
            createdAt: Date.now()
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

    // First connection to a brand-new room seeds the room code.
    if (!this.state.roomCode && roomCode) {
      this.state.roomCode = roomCode
      await this.persist()
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    this.ctx.acceptWebSocket(server)
    const meta: SessionMeta = { index: null, name: '' }
    server.serializeAttachment(meta)
    this.sessions.set(server, meta)

    return new Response(null, { status: 101, webSocket: client })
  }

  /* --------------------------- message router --------------------------- */

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: ClientMsg
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
    const meta = this.sessions.get(ws)
    this.sessions.delete(ws)
    try {
      ws.close()
    } catch {
      /* already closed */
    }
    // Note: we keep the player's slot/name so they can rejoin with the same
    // code+name and resume (connected flag flips off until they return).
    if (meta) this.broadcastState()
  }

  /* ------------------------------ handlers ------------------------------ */

  private onJoin(ws: WebSocket, rawName: string) {
    const name = (rawName || '').trim().slice(0, 16) || 'Player'

    // Rejoin: if a slot already has this name, reclaim it (resume).
    let index: PlayerIndex | null = null
    if (this.state.playerNames[0]?.toLowerCase() === name.toLowerCase()) index = 0
    else if (this.state.playerNames[1]?.toLowerCase() === name.toLowerCase()) index = 1

    if (index === null) {
      // Take the first free slot.
      if (this.state.playerNames[0] === null) index = 0
      else if (this.state.playerNames[1] === null) index = 1
      else {
        // Both slots taken by other names => room is full.
        return this.sendTo(ws, { type: 'full' })
      }
      this.state.playerNames[index] = name
    }

    const meta: SessionMeta = { index, name }
    this.sessions.set(ws, meta)
    ws.serializeAttachment(meta)

    void this.persist()
    void this.syncRegistry()
    this.broadcastState()
  }

  private onStart(ws: WebSocket, length: WordLength) {
    const meta = this.sessions.get(ws)
    if (!meta || meta.index === null) {
      return this.sendTo(ws, { type: 'error', reason: 'Join the room first.' })
    }
    if (this.state.playerNames[0] === null || this.state.playerNames[1] === null) {
      return this.sendTo(ws, { type: 'error', reason: 'Waiting for both players.' })
    }
    const len = ([4, 5, 6] as WordLength[]).includes(length) ? length : 4

    const start = pickStartWord(START_LISTS[len], WORD_SETS[len])
    this.state.length = len
    this.state.chain = [{ word: start, by: null, changedIndex: null }]
    this.state.used = [start]
    this.state.current = 0
    this.state.winner = null
    this.state.lossReason = null
    this.state.phase = 'playing'
    this.armTurn()

    void this.persist()
    void this.syncRegistry()
    this.broadcastState()
  }

  private onMove(ws: WebSocket, word: string) {
    const meta = this.sessions.get(ws)
    if (!meta || meta.index === null) return
    if (this.state.phase !== 'playing') return
    // Only the player whose turn it is may move.
    if (meta.index !== this.state.current) {
      return this.sendTo(ws, { type: 'error', reason: "It's not your turn." })
    }

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
      // Illegal move => this player loses, opponent wins.
      this.state.winner = (meta.index === 0 ? 1 : 0) as PlayerIndex
      this.state.lossReason = (result.loss ?? 'invalid-word') as LossReason
      this.state.phase = 'gameover'
      this.state.turnEndsAt = null
      void this.persist()
      // Give the mover the specific reason, then broadcast the result to all.
      this.sendTo(ws, { type: 'error', reason: result.reason ?? 'Illegal move.' })
      void this.syncRegistry()
      this.broadcastState()
      return
    }

    const next = word.toUpperCase()
    this.state.chain.push({
      word: next,
      by: meta.index,
      changedIndex: result.changedIndex ?? null
    })
    this.state.used.push(next)
    this.state.current = (meta.index === 0 ? 1 : 0) as PlayerIndex
    this.armTurn()
    void this.persist()
    this.broadcastState()
  }

  private onRematch(ws: WebSocket) {
    const meta = this.sessions.get(ws)
    if (!meta || meta.index === null) return
    // Either player may request a rematch, but only from a finished game.
    // Idempotent: if a rematch already restarted the game, ignore extra clicks.
    if (this.state.phase !== 'gameover') return
    // Keep players + length, new random start word.
    const len = this.state.length
    const start = pickStartWord(START_LISTS[len], WORD_SETS[len])
    this.state.chain = [{ word: start, by: null, changedIndex: null }]
    this.state.used = [start]
    this.state.current = 0
    this.state.winner = null
    this.state.lossReason = null
    this.state.phase = 'playing'
    this.armTurn()
    void this.persist()
    void this.syncRegistry()
    this.broadcastState()
  }

  private onResign(ws: WebSocket) {
    const meta = this.sessions.get(ws)
    if (!meta || meta.index === null) return
    if (this.state.phase !== 'playing') return
    this.state.winner = (meta.index === 0 ? 1 : 0) as PlayerIndex
    this.state.lossReason = 'resign'
    this.state.phase = 'gameover'
    this.state.turnEndsAt = null
    void this.persist()
    void this.syncRegistry()
    this.broadcastState()
  }

  private onLeave(ws: WebSocket) {
    const meta = this.sessions.get(ws)
    if (meta && meta.index !== null) {
      // Free the slot so a new player can take it.
      this.state.playerNames[meta.index] = null
    }
    this.sessions.delete(ws)
    try {
      ws.close(1000, 'left')
    } catch {
      /* noop */
    }
    void this.persist()
    void this.syncRegistry()
    this.broadcastState()
  }

  /* ------------------------------ broadcast ----------------------------- */

  private connectedIndexes(): Set<PlayerIndex> {
    const s = new Set<PlayerIndex>()
    for (const meta of this.sessions.values()) {
      if (meta.index !== null) s.add(meta.index)
    }
    return s
  }

  private snapshot(): GameState {
    const connected = this.connectedIndexes()
    return {
      phase: this.state.phase,
      length: this.state.length,
      players: [0, 1].map((i) => ({
        name: this.state.playerNames[i] ?? `Player ${i + 1}`,
        connected: connected.has(i as PlayerIndex)
      })),
      current: this.state.current,
      chain: this.state.chain,
      winner: this.state.winner,
      lossReason: this.state.lossReason,
      roomCode: this.state.roomCode,
      turnEndsAt: this.state.turnEndsAt
    }
  }

  private broadcastState() {
    const base = this.snapshot()
    for (const [ws, meta] of this.sessions) {
      this.sendTo(ws, { type: 'state', state: base, you: meta.index })
    }
  }

  private sendTo(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      /* socket not writable */
    }
  }

  /* ------------------------------- alarm -------------------------------- */

  async alarm() {
    // Turn timeout: if a game is in progress and the current player's clock
    // has run out, they lose and the opponent wins.
    if (
      this.state.phase === 'playing' &&
      this.state.turnEndsAt !== null &&
      Date.now() >= this.state.turnEndsAt
    ) {
      this.state.winner = (this.state.current === 0 ? 1 : 0) as PlayerIndex
      this.state.lossReason = 'timeout'
      this.state.phase = 'gameover'
      this.state.turnEndsAt = null
      await this.ctx.storage.put('state', this.state)
      void this.syncRegistry()
      this.broadcastState()
      // Arm idle-expiry so the finished room is eventually reclaimed.
      await this.ctx.storage.setAlarm(Date.now() + IDLE_EXPIRY_MS)
      return
    }

    // Idle cleanup: nobody connected => wipe the room to reclaim storage.
    if (this.sessions.size === 0) {
      const code = this.state.roomCode
      await this.ctx.storage.deleteAll()
      this.state = this.freshState('')
      // Best-effort delist from the public lobby.
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

    // Still active (e.g. mid-turn but not yet expired, or finished game):
    // re-arm at the appropriate horizon.
    const idleAt = Date.now() + IDLE_EXPIRY_MS
    const alarmAt =
      this.state.phase === 'playing' && this.state.turnEndsAt
        ? Math.min(this.state.turnEndsAt, idleAt)
        : idleAt
    await this.ctx.storage.setAlarm(alarmAt)
  }
}
