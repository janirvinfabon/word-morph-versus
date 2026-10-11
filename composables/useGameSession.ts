import { computed, reactive, readonly } from 'vue'
import { useWordMorph } from '~/composables/useWordMorph'
import { useOnlineGame } from '~/composables/useOnlineGame'
import type { PlayerIndex, WordLength } from '~/composables/useOnlineGame'

/**
 * useGameSession — a single facade the game UI binds to, regardless of mode.
 *
 * It delegates to either the hot-seat singleton (useWordMorph) or the online
 * store (useOnlineGame) based on the currently selected mode, and normalises
 * their slightly different shapes into ONE common interface so components do
 * not branch on mode.
 */

export type GameMode = 'hotseat' | 'online'

/** Common normalised phase across both stores. */
export type SessionPhase = 'lobby' | 'playing' | 'gameover'

interface NormalPlayer {
  name: string
  connected: boolean
}

const session = reactive({
  mode: null as GameMode | null
})

function createSession() {
  const hotseat = useWordMorph()
  const online = useOnlineGame()

  function setMode(mode: GameMode) {
    session.mode = mode
  }
  function clearMode() {
    session.mode = null
  }

  /* -------------------- normalised phase -------------------- */
  const phase = computed<SessionPhase>(() => {
    if (session.mode === 'online') {
      const p = online.state.server?.phase
      // online 'waiting' maps to our 'lobby' (pre-game) for the UI router,
      // but GameBoard handles the waiting-for-opponent state itself.
      if (!p) return 'lobby'
      return p === 'waiting' ? 'playing' : p
    }
    if (session.mode === 'hotseat') {
      return hotseat.state.phase as SessionPhase
    }
    return 'lobby'
  })

  /* -------------------- normalised state fields -------------------- */
  const length = computed<WordLength>(() =>
    session.mode === 'online'
      ? (online.state.server?.length ?? 4)
      : (hotseat.state.length as WordLength)
  )

  const players = computed<NormalPlayer[]>(() => {
    if (session.mode === 'online') {
      return (
        online.state.server?.players ?? [
          { name: 'Player 1', connected: false },
          { name: 'Player 2', connected: false }
        ]
      )
    }
    return hotseat.state.players.map((p) => ({ name: p.name, connected: true }))
  })

  const current = computed<PlayerIndex>(() =>
    session.mode === 'online'
      ? (online.state.server?.current ?? 0)
      : (hotseat.state.current as PlayerIndex)
  )

  const chain = computed(() =>
    session.mode === 'online'
      ? (online.state.server?.chain ?? [])
      : hotseat.state.chain
  )

  const winner = computed<PlayerIndex | null>(() =>
    session.mode === 'online'
      ? (online.state.server?.winner ?? null)
      : (hotseat.state.winner as PlayerIndex | null)
  )

  const lossReason = computed(() =>
    session.mode === 'online'
      ? (online.state.server?.lossReason ?? null)
      : hotseat.state.lossReason
  )

  const error = computed(() =>
    session.mode === 'online' ? online.state.error : hotseat.state.error
  )

  const roomCode = computed(() =>
    session.mode === 'online' ? (online.state.server?.roomCode ?? '') : ''
  )

  /** Epoch ms when the active player's turn ends, or null if not playing. */
  const turnEndsAt = computed<number | null>(() =>
    session.mode === 'online'
      ? (online.state.server?.turnEndsAt ?? null)
      : hotseat.state.turnEndsAt
  )

  /* -------------------- derived -------------------- */
  const currentWord = computed(() => {
    const c = chain.value
    return c.length ? c[c.length - 1].word : ''
  })
  const currentPlayer = computed(
    () => players.value[current.value] ?? { name: '', connected: false }
  )
  const lastChangedIndex = computed(() => {
    const c = chain.value
    return c.length ? c[c.length - 1].changedIndex : null
  })

  /**
   * Whether the LOCAL input should be enabled right now.
   * - Hot-seat: always (both players share the device, alternating).
   * - Online: only when it is this device's turn.
   */
  const canPlay = computed(() => {
    if (phase.value !== 'playing') return false
    if (session.mode === 'online') return online.isMyTurn.value
    return true
  })

  /** Online-only: is the local client still waiting for an opponent? */
  const waitingForOpponent = computed(
    () =>
      session.mode === 'online' &&
      (online.state.server?.phase === 'waiting' ||
        !online.bothConnected.value)
  )

  const connStatus = computed(() =>
    session.mode === 'online' ? online.state.status : 'connected'
  )

  /* -------------------- unified actions -------------------- */

  function submitWord(word: string) {
    if (session.mode === 'online') online.submitWord(word)
    else hotseat.submitWord(word)
  }

  function rematch() {
    if (session.mode === 'online') online.rematch()
    else void hotseat.rematch()
  }

  function resign() {
    if (session.mode === 'online') online.resign()
    else hotseat.resign()
  }

  /** Leave the current game and return to mode selection. */
  function newGame() {
    if (session.mode === 'online') {
      online.leave()
    } else {
      hotseat.newGame()
    }
    session.mode = null
  }

  return {
    session: readonly(session),
    mode: computed(() => session.mode),
    setMode,
    clearMode,
    // direct access to underlying stores for the lobbies
    hotseat,
    online,
    // normalised state
    phase,
    length,
    players,
    current,
    chain,
    winner,
    lossReason,
    error,
    roomCode,
    turnEndsAt,
    // derived
    currentWord,
    currentPlayer,
    lastChangedIndex,
    canPlay,
    waitingForOpponent,
    connStatus,
    // actions
    submitWord,
    rematch,
    resign,
    newGame
  }
}

export type GameSession = ReturnType<typeof createSession>

let singleton: GameSession | null = null
export function useGameSession(): GameSession {
  if (!singleton) singleton = createSession()
  return singleton
}
