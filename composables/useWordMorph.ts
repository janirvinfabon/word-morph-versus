import { computed, reactive, readonly } from 'vue'

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */
export type WordLength = 4 | 5 | 6
export type Phase = 'lobby' | 'playing' | 'gameover'
export type PlayerIndex = 0 | 1

export interface Player {
  name: string
}

export interface ChainEntry {
  /** The word, uppercase. */
  word: string
  /** Which player played it (index into players). null = system start word. */
  by: PlayerIndex | null
  /** Index of the letter that changed vs. the previous word. null for start word. */
  changedIndex: number | null
}

export interface MoveResult {
  ok: boolean
  /** Human-readable reason when ok === false. */
  reason?: string
  /** The index of the changed letter when ok === true. */
  changedIndex?: number
}

export type LossReason =
  | 'invalid-word'
  | 'not-single-change'
  | 'repeat'
  | 'resign'
  | 'timeout'

/** Seconds a player has to make each move before they time out and lose. */
export const TURN_MS = 15000

const STORAGE_KEY = 'wordmorph:recent-players'

/* ------------------------------------------------------------------ *
 * Pure helpers (exported for reuse/testing)
 * ------------------------------------------------------------------ */

/**
 * Returns the single changed index between two equal-length words, or:
 *   -1  if the words are identical
 *   -2  if more than one position differs (or lengths differ)
 */
export function singleDiffIndex(a: string, b: string): number {
  if (a.length !== b.length) return -2
  let diff = -1
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (diff !== -1) return -2 // second difference => not a single change
      diff = i
    }
  }
  return diff // -1 means identical
}

/* ------------------------------------------------------------------ *
 * Module-level dictionary cache (shared across component instances).
 * Each length is loaded once and memoised as a Set for O(1) lookup.
 * ------------------------------------------------------------------ */
const dictCache = new Map<WordLength, Set<string>>()
const dictLists = new Map<WordLength, string[]>()
const startLists = new Map<WordLength, string[]>()

async function loadDictionary(len: WordLength): Promise<Set<string>> {
  const cached = dictCache.get(len)
  if (cached) return cached

  // Files live in /public so they are served at the site root.
  const res = await fetch(`/words-${len}.json`)
  if (!res.ok) throw new Error(`Failed to load words-${len}.json (${res.status})`)
  const list = (await res.json()) as string[]
  const set = new Set(list)
  dictCache.set(len, set)
  dictLists.set(len, list)

  // Common-biased start pool (best-effort; falls back to the full list).
  try {
    const sres = await fetch(`/starts-${len}.json`)
    if (sres.ok) {
      const starts = (await sres.json()) as string[]
      if (Array.isArray(starts) && starts.length) startLists.set(len, starts)
    }
  } catch {
    /* fall back to full list for start words */
  }
  return set
}

/* ------------------------------------------------------------------ *
 * Composable
 *
 * A single game instance is shared across all components via the
 * module-level `singleton` below (see useWordMorphGame). The factory
 * `createWordMorph` is kept exported for isolated use / testing.
 * ------------------------------------------------------------------ */
export function createWordMorph() {
  const state = reactive({
    phase: 'lobby' as Phase,
    length: 4 as WordLength,
    players: [{ name: 'Player 1' }, { name: 'Player 2' }] as [Player, Player],
    /** Whose turn it is right now (index into players). */
    current: 0 as PlayerIndex,
    /** The ordered chain of played words (index 0 = system start word). */
    chain: [] as ChainEntry[],
    /** Set of words already used this match (uppercase). */
    used: new Set<string>(),
    /** Winner index once the game is over, else null. */
    winner: null as PlayerIndex | null,
    lossReason: null as LossReason | null,
    /** Epoch ms when the current player's turn times out, or null. */
    turnEndsAt: null as number | null,
    /** True while the dictionary for the chosen length is loading. */
    loading: false,
    error: '' as string
  })

  // Client-side turn timer (hot-seat only). Cleared/reset at each turn.
  let turnTimer: ReturnType<typeof setTimeout> | null = null

  function clearTurnTimer() {
    if (turnTimer) {
      clearTimeout(turnTimer)
      turnTimer = null
    }
    state.turnEndsAt = null
  }

  function armTurnTimer() {
    clearTurnTimer()
    state.turnEndsAt = Date.now() + TURN_MS
    turnTimer = setTimeout(handleTimeout, TURN_MS)
  }

  function handleTimeout() {
    if (state.phase !== 'playing') return
    // Current player ran out of time => they lose, opponent wins.
    state.lossReason = 'timeout'
    state.winner = opponentIndex.value
    state.phase = 'gameover'
    clearTurnTimer()
  }

  /* -------------------- derived -------------------- */
  const currentWord = computed(
    () => state.chain[state.chain.length - 1]?.word ?? ''
  )
  const currentPlayer = computed(() => state.players[state.current])
  const opponentIndex = computed<PlayerIndex>(() =>
    state.current === 0 ? 1 : 0
  )
  const lastChangedIndex = computed(
    () => state.chain[state.chain.length - 1]?.changedIndex ?? null
  )
  const turnNumber = computed(() => Math.max(0, state.chain.length - 1))

  /* -------------------- player name persistence -------------------- */
  function loadRecentPlayers(): string[] {
    if (typeof localStorage === 'undefined') return []
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : []
    } catch {
      return []
    }
  }

  function rememberPlayers(names: string[]) {
    if (typeof localStorage === 'undefined') return
    const existing = loadRecentPlayers()
    // Most-recent-first, de-duplicated (case-insensitive), capped at 8.
    const merged: string[] = []
    for (const n of [...names, ...existing]) {
      const name = n.trim()
      if (!name) continue
      if (merged.some((m) => m.toLowerCase() === name.toLowerCase())) continue
      merged.push(name)
      if (merged.length >= 8) break
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }

  /* -------------------- lifecycle -------------------- */

  /** Pick a random valid start word that is guaranteed to have a legal move. */
  function pickStartWord(len: WordLength): string {
    // Prefer the common-biased start pool so games open on familiar words;
    // fall back to the full list if the start pool failed to load.
    const list = startLists.get(len) ?? dictLists.get(len)!
    const set = dictCache.get(len)!
    // Try random candidates; accept the first with >=1 neighbor.
    // (Lists are pre-pruned so this almost always succeeds first try.)
    for (let attempt = 0; attempt < 50; attempt++) {
      const w = list[Math.floor(Math.random() * list.length)]
      if (hasAnyNeighbor(w, set)) return w
    }
    return list[Math.floor(Math.random() * list.length)]
  }

  function hasAnyNeighbor(word: string, set: Set<string>): boolean {
    const chars = word.split('')
    for (let i = 0; i < chars.length; i++) {
      const orig = chars[i]
      for (let c = 65; c <= 90; c++) {
        const ch = String.fromCharCode(c)
        if (ch === orig) continue
        chars[i] = ch
        if (set.has(chars.join(''))) {
          chars[i] = orig
          return true
        }
      }
      chars[i] = orig
    }
    return false
  }

  /**
   * Configure players + length and start a fresh match.
   * Loads the dictionary (idempotent) and seeds a random start word.
   */
  async function startGame(opts: {
    length: WordLength
    player1: string
    player2: string
  }) {
    state.loading = true
    state.error = ''
    try {
      await loadDictionary(opts.length)

      state.length = opts.length
      state.players = [
        { name: opts.player1.trim() || 'Player 1' },
        { name: opts.player2.trim() || 'Player 2' }
      ]
      rememberPlayers([state.players[0].name, state.players[1].name])

      const start = pickStartWord(opts.length)
      state.chain = [{ word: start, by: null, changedIndex: null }]
      state.used = new Set([start])
      state.current = 0
      state.winner = null
      state.lossReason = null
      state.phase = 'playing'
      armTurnTimer()
    } catch (e: unknown) {
      state.error =
        e instanceof Error ? e.message : 'Failed to start the game.'
    } finally {
      state.loading = false
    }
  }

  /** Rematch: same players + length, new random start word. */
  async function rematch() {
    await startGame({
      length: state.length,
      player1: state.players[0].name,
      player2: state.players[1].name
    })
  }

  /** Back to the lobby to change names / category. */
  function newGame() {
    clearTurnTimer()
    state.phase = 'lobby'
    state.winner = null
    state.lossReason = null
    state.chain = []
    state.used = new Set()
  }

  /* -------------------- validation (no mutation) -------------------- */

  /**
   * Validate a proposed next word against the current word & rules,
   * WITHOUT mutating state. Useful for live UI feedback.
   */
  function validateMove(candidate: string): MoveResult {
    const next = candidate.toUpperCase()
    const cur = currentWord.value
    const set = dictCache.get(state.length)

    if (next.length !== state.length) {
      return { ok: false, reason: `Word must be ${state.length} letters.` }
    }
    if (!/^[A-Z]+$/.test(next)) {
      return { ok: false, reason: 'Letters A-Z only.' }
    }

    const diff = singleDiffIndex(cur, next)
    if (diff === -1) {
      return { ok: false, reason: 'You must change exactly one letter.' }
    }
    if (diff === -2) {
      return { ok: false, reason: 'Change exactly one letter — no more, no less.' }
    }
    if (state.used.has(next)) {
      return { ok: false, reason: 'That word was already played.' }
    }
    if (!set || !set.has(next)) {
      return { ok: false, reason: `"${next}" is not a valid word.` }
    }
    return { ok: true, changedIndex: diff }
  }

  /* -------------------- committing a turn -------------------- */

  /**
   * Attempt to play `candidate` for the current player.
   * - On success: appends to the chain and passes the turn.
   * - On failure: ends the game; the OPPONENT wins. Returns the result so
   *   the UI can surface the specific reason.
   */
  function submitWord(candidate: string): MoveResult {
    if (state.phase !== 'playing') {
      return { ok: false, reason: 'Game is not in progress.' }
    }

    const result = validateMove(candidate)

    if (!result.ok) {
      // Illegal move => current player loses, opponent wins.
      clearTurnTimer()
      state.lossReason = mapReasonToLoss(result.reason ?? '')
      state.winner = opponentIndex.value
      state.phase = 'gameover'
      return result
    }

    const next = candidate.toUpperCase()
    state.chain.push({
      word: next,
      by: state.current,
      changedIndex: result.changedIndex ?? null
    })
    state.used.add(next)
    state.current = opponentIndex.value
    armTurnTimer()
    return result
  }

  /** Current player gives up; opponent wins. */
  function resign() {
    if (state.phase !== 'playing') return
    clearTurnTimer()
    state.lossReason = 'resign'
    state.winner = opponentIndex.value
    state.phase = 'gameover'
  }

  function mapReasonToLoss(reason: string): LossReason {
    if (reason.includes('already played')) return 'repeat'
    if (reason.includes('not a valid word')) return 'invalid-word'
    return 'not-single-change'
  }

  /* -------------------- exports -------------------- */
  return {
    state: readonly(state),
    // derived
    currentWord,
    currentPlayer,
    opponentIndex,
    lastChangedIndex,
    turnNumber,
    // actions
    startGame,
    rematch,
    newGame,
    submitWord,
    validateMove,
    resign,
    // persistence
    loadRecentPlayers,
    // helpers
    singleDiffIndex
  }
}

export type WordMorphGame = ReturnType<typeof createWordMorph>

/* ------------------------------------------------------------------ *
 * Shared singleton accessor.
 * All components call useWordMorph() and get the SAME reactive game,
 * so the Lobby, GameBoard and GameOver dialog stay in sync.
 * ------------------------------------------------------------------ */
let singleton: WordMorphGame | null = null

export function useWordMorph(): WordMorphGame {
  if (!singleton) singleton = createWordMorph()
  return singleton
}
