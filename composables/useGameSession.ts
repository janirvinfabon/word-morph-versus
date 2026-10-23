import { computed, reactive, readonly } from 'vue'
import { useWordMorph } from '~/composables/useWordMorph'
import { useOnlineGame } from '~/composables/useOnlineGame'
import { usePartyGame } from '~/composables/usePartyGame'
import type { PlayerIndex, WordLength } from '~/composables/useOnlineGame'

/**
 * useGameSession — a single facade the game UI binds to, regardless of mode.
 *
 * It delegates to the hot-seat singleton (useWordMorph), the online duel store
 * (useOnlineGame), or the party store (usePartyGame) based on the currently
 * selected mode, and normalises their slightly different shapes into ONE common
 * interface so components do not branch on mode.
 */

export type GameMode = 'hotseat' | 'online' | 'solo' | 'party'

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
  const party = usePartyGame()

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
    if (session.mode === 'party') {
      const p = party.state.server?.phase
      if (!p) return 'lobby'
      return p === 'waiting' ? 'lobby' : p
    }
    if (session.mode === 'hotseat' || session.mode === 'solo') {
      return hotseat.state.phase as SessionPhase
    }
    return 'lobby'
  })

  /* -------------------- normalised state fields -------------------- */
  const length = computed<WordLength>(() => {
    if (session.mode === 'online') return (online.state.server?.length ?? 4) as WordLength
    if (session.mode === 'party') return (party.state.server?.length ?? 4) as WordLength
    return hotseat.state.length as WordLength
  })

  const players = computed<NormalPlayer[]>(() => {
    if (session.mode === 'online') {
      return (
        online.state.server?.players ?? [
          { name: 'Player 1', connected: false },
          { name: 'Player 2', connected: false }
        ]
      )
    }
    if (session.mode === 'party') {
      return (party.state.server?.players ?? []).map((p) => ({
        name: p.name,
        connected: p.connected
      }))
    }
    return hotseat.state.players.map((p) => ({ name: p.name, connected: true }))
  })

  /**
   * Normalised "current player" index into `players`. For party mode we map
   * the server's string `currentId` to its position in the roster so the
   * shared GameBoard (which colours by index) keeps working.
   */
  const current = computed<PlayerIndex>(() => {
    if (session.mode === 'online') return (online.state.server?.current ?? 0) as PlayerIndex
    if (session.mode === 'party') {
      const s = party.state.server
      if (!s || !s.currentId) return 0 as PlayerIndex
      const idx = s.players.findIndex((p) => p.id === s.currentId)
      return (idx < 0 ? 0 : idx) as PlayerIndex
    }
    return hotseat.state.current as PlayerIndex
  })

  const chain = computed(() => {
    if (session.mode === 'online') return online.state.server?.chain ?? []
    if (session.mode === 'party') return party.state.server?.chain ?? []
    return hotseat.state.chain
  })

  /** Failed attempts (broken chain / timeout / resign) for red history entries. */
  const failedAttempts = computed(() => {
    if (session.mode === 'online') return online.state.server?.failedAttempts ?? []
    if (session.mode === 'party') return party.state.server?.failedAttempts ?? []
    return hotseat.state.failedAttempts
  })

  /** Moves the loser could have played, shown at game over (null if none/resign). */
  const missedWords = computed(() => {
    if (session.mode === 'online') return online.state.server?.missedWords ?? null
    if (session.mode === 'party') return party.state.server?.missedWords ?? null
    return hotseat.state.missedWords
  })

  const winner = computed<PlayerIndex | null>(() => {
    if (session.mode === 'online') return (online.state.server?.winner ?? null) as PlayerIndex | null
    if (session.mode === 'party') {
      const s = party.state.server
      if (!s || !s.winnerId) return null
      const idx = s.players.findIndex((p) => p.id === s.winnerId)
      return (idx < 0 ? null : idx) as PlayerIndex | null
    }
    return hotseat.state.winner as PlayerIndex | null
  })

  const lossReason = computed(() => {
    if (session.mode === 'online') return online.state.server?.lossReason ?? null
    if (session.mode === 'party') {
      // The decisive loss reason is the last-eliminated player's reason.
      const s = party.state.server
      if (!s) return null
      const runnerUp = s.players.find((p) => p.placement === 2)
      return runnerUp?.lossReason ?? null
    }
    return hotseat.state.lossReason
  })

  const error = computed(() => {
    if (session.mode === 'online') return online.state.error
    if (session.mode === 'party') return party.state.error
    return hotseat.state.error
  })

  const roomCode = computed(() => {
    if (session.mode === 'online') return online.state.server?.roomCode ?? ''
    if (session.mode === 'party') return party.state.server?.roomCode ?? ''
    return ''
  })

  /** Epoch ms when the active player's turn ends, or null if not playing. */
  const turnEndsAt = computed<number | null>(() => {
    if (session.mode === 'online') return online.state.server?.turnEndsAt ?? null
    if (session.mode === 'party') return party.state.server?.turnEndsAt ?? null
    return hotseat.state.turnEndsAt
  })

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
    if (session.mode === 'party') return party.isMyTurn.value
    return true
  })

  /** Online/party-only: is the local client still waiting to begin? */
  const waitingForOpponent = computed(() => {
    if (session.mode === 'online') {
      return (
        online.state.server?.phase === 'waiting' || !online.bothConnected.value
      )
    }
    if (session.mode === 'party') {
      return party.state.server?.phase === 'waiting'
    }
    return false
  })

  const connStatus = computed(() => {
    if (session.mode === 'online') return online.state.status
    if (session.mode === 'party') return party.state.status
    return 'connected'
  })

  /* -------------------- solo-specific -------------------- */
  const isSolo = computed(() => session.mode === 'solo')
  const score = computed(() => hotseat.state.score)
  const bestScore = computed(() => hotseat.state.bestScore)
  const isNewBest = computed(() => hotseat.state.isNewBest)

  /* -------------------- unified actions -------------------- */

  function submitWord(word: string) {
    if (session.mode === 'online') online.submitWord(word)
    else if (session.mode === 'party') party.submitWord(word)
    else hotseat.submitWord(word)
  }

  function rematch() {
    if (session.mode === 'online') online.rematch()
    else if (session.mode === 'party') party.rematch()
    else void hotseat.rematch()
  }

  function resign() {
    if (session.mode === 'online') online.resign()
    else if (session.mode === 'party') party.resign()
    else hotseat.resign()
  }

  /** Leave the current game and return to mode selection. */
  function newGame() {
    if (session.mode === 'online') {
      online.leave()
    } else if (session.mode === 'party') {
      party.leave()
    } else {
      hotseat.newGame()
    }
    session.mode = null
  }

  /**
   * Return to the CURRENT mode's lobby (not the mode-select home).
   * Used by solo "Home" to go back to the Versus Self setup screen.
   */
  function backToLobby() {
    const keep = session.mode
    hotseat.newGame() // resets the hotseat store to its 'lobby' phase
    session.mode = keep
  }

  return {
    session: readonly(session),
    mode: computed(() => session.mode),
    setMode,
    clearMode,
    // direct access to underlying stores for the lobbies
    hotseat,
    online,
    party,
    // normalised state
    phase,
    length,
    players,
    current,
    chain,
    failedAttempts,
    missedWords,
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
    // solo
    isSolo,
    score,
    bestScore,
    isNewBest,
    // actions
    submitWord,
    rematch,
    resign,
    newGame,
    backToLobby
  }
}

export type GameSession = ReturnType<typeof createSession>

let singleton: GameSession | null = null
export function useGameSession(): GameSession {
  if (!singleton) singleton = createSession()
  return singleton
}
