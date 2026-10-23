import { computed, reactive, readonly } from 'vue'

/* ------------------------------------------------------------------ *
 * Mirrors of the Worker PARTY protocol (worker/src/partyProtocol.ts).
 * Players are identified by a STABLE string id (not a 0|1 index) because
 * seating is fixed but players are eliminated, leaving gaps.
 * ------------------------------------------------------------------ */
export type WordLength = 4 | 5 | 6
export type PartyPhase = 'waiting' | 'playing' | 'gameover'
export type LossReason =
  | 'invalid-word'
  | 'not-single-change'
  | 'repeat'
  | 'resign'
  | 'disconnect'
  | 'timeout'

export const PARTY_MIN_PLAYERS = 3
export const PARTY_MAX_PLAYERS = 10

export interface PartyPlayerPublic {
  id: string
  name: string
  connected: boolean
  eliminated: boolean
  lossReason: LossReason | null
  placement: number | null
}
export interface PartyChainEntry {
  word: string
  by: string | null
  changedIndex: number | null
}
export interface PartyFailedEntry {
  word: string
  by: string | null
  changedIndex: number | null
  lossReason: LossReason
}
export interface PartyMissedWords {
  fromWord: string
  words: string[]
  allUsed: boolean
}
export interface PartyGameState {
  phase: PartyPhase
  length: WordLength
  players: PartyPlayerPublic[]
  currentId: string | null
  chain: PartyChainEntry[]
  failedAttempts: PartyFailedEntry[]
  missedWords: PartyMissedWords | null
  winnerId: string | null
  roomCode: string
  maxPlayers: number
  turnEndsAt: number | null
}

type ServerMsg =
  | { type: 'state'; state: PartyGameState; you: string | null }
  | { type: 'error'; reason: string }
  | { type: 'full' }
  | { type: 'in-progress' }

export type ConnStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'
  | 'error'

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 8000

/* ------------------------------------------------------------------ *
 * Party game store (shared singleton, like the online duel composable).
 * ------------------------------------------------------------------ */
function createPartyGame() {
  const state = reactive({
    mode: 'party' as const,
    status: 'idle' as ConnStatus,
    /** Stable id the local player occupies, or null until joined. */
    you: null as string | null,
    server: null as PartyGameState | null,
    error: '' as string,
    loading: false
  })

  let ws: WebSocket | null = null
  let wsBase = ''
  let room = ''
  let name = ''
  let intentionalClose = false
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /* -------------------- connection -------------------- */

  function wsUrlFor(code: string): string {
    const base = wsBase.replace(/^http/, 'ws').replace(/\/$/, '')
    return `${base}/party/ws?room=${encodeURIComponent(code)}`
  }

  function connect() {
    if (typeof WebSocket === 'undefined') return
    cleanupSocket()
    state.status = reconnectAttempts > 0 ? 'reconnecting' : 'connecting'

    const sock = new WebSocket(wsUrlFor(room))
    ws = sock

    sock.addEventListener('open', () => {
      reconnectAttempts = 0
      state.status = 'connected'
      state.error = ''
      send({ type: 'join', name })
    })

    sock.addEventListener('message', (ev) => {
      let msg: ServerMsg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      handleServer(msg)
    })

    sock.addEventListener('close', () => {
      if (intentionalClose) {
        state.status = 'closed'
        return
      }
      scheduleReconnect()
    })

    sock.addEventListener('error', () => {
      state.error = 'Connection error.'
    })
  }

  function scheduleReconnect() {
    state.status = 'reconnecting'
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_MS
    )
    reconnectAttempts++
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, delay)
  }

  function cleanupSocket() {
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      try {
        ws.close()
      } catch {
        /* noop */
      }
      ws = null
    }
  }

  function send(obj: unknown) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj))
    }
  }

  function handleServer(msg: ServerMsg) {
    switch (msg.type) {
      case 'state':
        state.server = msg.state
        if (msg.you !== null) state.you = msg.you
        state.loading = false
        break
      case 'error':
        state.error = msg.reason
        break
      case 'full':
        state.error = 'That party is full (10 players).'
        state.loading = false
        intentionalClose = true
        cleanupSocket()
        state.status = 'closed'
        break
      case 'in-progress':
        state.error = 'That match has already started.'
        state.loading = false
        intentionalClose = true
        cleanupSocket()
        state.status = 'closed'
        break
    }
  }

  /* -------------------- public actions -------------------- */

  function joinRoom(opts: { wsBase: string; room: string; name: string }) {
    wsBase = opts.wsBase
    room = opts.room.toUpperCase()
    name = opts.name.trim().slice(0, 16) || 'Player'
    intentionalClose = false
    reconnectAttempts = 0
    state.loading = true
    state.error = ''
    state.you = null
    state.server = null
    connect()
  }

  async function createRoomCode(base: string): Promise<string> {
    const httpBase = base.replace(/^ws/, 'http').replace(/\/$/, '')
    const res = await fetch(`${httpBase}/party/new`)
    if (!res.ok) throw new Error('Could not create a room.')
    const body = (await res.json()) as { room: string }
    return body.room
  }

  function startGame(opts: { length: WordLength }) {
    send({ type: 'start', length: opts.length })
  }
  function submitWord(word: string) {
    send({ type: 'move', word: word.toUpperCase() })
  }
  function rematch() {
    send({ type: 'rematch' })
  }
  function resign() {
    send({ type: 'resign' })
  }
  function leave() {
    intentionalClose = true
    send({ type: 'leave' })
    if (reconnectTimer) clearTimeout(reconnectTimer)
    cleanupSocket()
    state.status = 'closed'
    state.server = null
    state.you = null
  }

  /* -------------------- derived -------------------- */

  const currentWord = computed(() => {
    const c = state.server?.chain
    return c && c.length ? c[c.length - 1].word : ''
  })
  const youPlayer = computed<PartyPlayerPublic | null>(() => {
    const s = state.server
    if (!s || !state.you) return null
    return s.players.find((p) => p.id === state.you) ?? null
  })
  const currentPlayer = computed<PartyPlayerPublic | null>(() => {
    const s = state.server
    if (!s || !s.currentId) return null
    return s.players.find((p) => p.id === s.currentId) ?? null
  })
  const lastChangedIndex = computed(() => {
    const c = state.server?.chain
    return c && c.length ? c[c.length - 1].changedIndex : null
  })
  /** True when it is the LOCAL player's turn (used to gate input). */
  const isMyTurn = computed(
    () =>
      state.server?.phase === 'playing' &&
      state.you !== null &&
      state.server.currentId === state.you
  )
  /** True once the local player has been eliminated (spectating). */
  const youEliminated = computed(() => !!youPlayer.value?.eliminated)
  const playerCount = computed(() => state.server?.players.length ?? 0)
  const canStart = computed(
    () =>
      state.server?.phase === 'waiting' &&
      playerCount.value >= PARTY_MIN_PLAYERS
  )
  const youAreHost = computed(
    () => !!state.you && state.server?.players[0]?.id === state.you
  )
  const winner = computed<PartyPlayerPublic | null>(() => {
    const s = state.server
    if (!s || !s.winnerId) return null
    return s.players.find((p) => p.id === s.winnerId) ?? null
  })
  /** Players ordered for a podium: winner first, then 2nd, 3rd, ... */
  const podium = computed<PartyPlayerPublic[]>(() => {
    const ps = state.server?.players ?? []
    return [...ps]
      .filter((p) => p.placement !== null)
      .sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0))
  })

  return {
    state: readonly(state),
    // derived
    currentWord,
    youPlayer,
    currentPlayer,
    lastChangedIndex,
    isMyTurn,
    youEliminated,
    playerCount,
    canStart,
    youAreHost,
    winner,
    podium,
    // actions
    joinRoom,
    createRoomCode,
    startGame,
    submitWord,
    rematch,
    resign,
    leave
  }
}

export type PartyGame = ReturnType<typeof createPartyGame>

let singleton: PartyGame | null = null
export function usePartyGame(): PartyGame {
  if (!singleton) singleton = createPartyGame()
  return singleton
}
