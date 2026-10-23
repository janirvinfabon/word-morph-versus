import { computed, reactive, readonly } from 'vue'

/* ------------------------------------------------------------------ *
 * Mirrors of the Worker protocol (kept in sync with worker/src/protocol.ts).
 * ------------------------------------------------------------------ */
export type WordLength = 4 | 5 | 6
export type PlayerIndex = 0 | 1
export type Phase = 'waiting' | 'playing' | 'gameover'
export type LossReason =
  | 'invalid-word'
  | 'not-single-change'
  | 'repeat'
  | 'resign'
  | 'disconnect'
  | 'timeout'

export interface PlayerPublic {
  name: string
  connected: boolean
}
export interface ChainEntry {
  word: string
  by: PlayerIndex | null
  changedIndex: number | null
}
export interface FailedEntry {
  word: string
  by: PlayerIndex | null
  changedIndex: number | null
  lossReason: LossReason
}
export interface MissedWords {
  fromWord: string
  words: string[]
  allUsed: boolean
}
export interface GameState {
  phase: Phase
  length: WordLength
  players: PlayerPublic[]
  current: PlayerIndex
  chain: ChainEntry[]
  failedAttempts: FailedEntry[]
  missedWords: MissedWords | null
  winner: PlayerIndex | null
  lossReason: LossReason | null
  roomCode: string
  turnEndsAt: number | null
}

type ServerMsg =
  | { type: 'state'; state: GameState; you: PlayerIndex | null }
  | { type: 'error'; reason: string }
  | { type: 'full' }

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
 * Online game store (shared singleton, like the hot-seat composable).
 * ------------------------------------------------------------------ */
function createOnlineGame() {
  const state = reactive({
    mode: 'online' as const,
    status: 'idle' as ConnStatus,
    // Which slot the LOCAL player occupies (0 or 1), or null until joined.
    you: null as PlayerIndex | null,
    // Latest authoritative snapshot from the server.
    server: null as GameState | null,
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
    // Convert http(s) base to ws(s) and append the room query.
    const base = wsBase.replace(/^http/, 'ws').replace(/\/$/, '')
    return `${base}/ws?room=${encodeURIComponent(code)}`
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
      // (Re)announce ourselves so the DO (re)assigns our slot and sends state.
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
      // 'close' will fire next and trigger reconnect.
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
        state.error = 'That room is full.'
        state.loading = false
        intentionalClose = true
        cleanupSocket()
        state.status = 'closed'
        break
    }
  }

  /* -------------------- public actions -------------------- */

  /** Create or join a room. For "create", the caller supplies a fresh code. */
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

  /** Fetch a fresh room code from the Worker's /new endpoint. */
  async function createRoomCode(base: string): Promise<string> {
    const httpBase = base.replace(/^ws/, 'http').replace(/\/$/, '')
    const res = await fetch(`${httpBase}/new`)
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

  /* -------------------- derived (common interface) -------------------- */

  const currentWord = computed(() => {
    const c = state.server?.chain
    return c && c.length ? c[c.length - 1].word : ''
  })
  const currentPlayer = computed(() => {
    const s = state.server
    return s ? s.players[s.current] : { name: '', connected: false }
  })
  const opponentIndex = computed<PlayerIndex>(() =>
    (state.server?.current ?? 0) === 0 ? 1 : 0
  )
  const lastChangedIndex = computed(() => {
    const c = state.server?.chain
    return c && c.length ? c[c.length - 1].changedIndex : null
  })
  const turnNumber = computed(() =>
    Math.max(0, (state.server?.chain.length ?? 1) - 1)
  )
  /** True when it is the LOCAL player's turn (used to gate input). */
  const isMyTurn = computed(
    () =>
      state.server?.phase === 'playing' &&
      state.you !== null &&
      state.you === state.server.current
  )
  const bothConnected = computed(
    () => !!state.server && state.server.players.every((p) => p.connected)
  )

  return {
    state: readonly(state),
    // derived
    currentWord,
    currentPlayer,
    opponentIndex,
    lastChangedIndex,
    turnNumber,
    isMyTurn,
    bothConnected,
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

export type OnlineGame = ReturnType<typeof createOnlineGame>

let singleton: OnlineGame | null = null
export function useOnlineGame(): OnlineGame {
  if (!singleton) singleton = createOnlineGame()
  return singleton
}
