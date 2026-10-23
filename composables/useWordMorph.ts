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

/**
 * A FAILED attempt — a move that broke the chain (bad word, not a single
 * change, repeat), or a turn lost to timeout/resign. Rendered in red in the
 * history. It never enters the valid chain or the `used` set.
 */
export interface FailedEntry {
  /** The word the player tried, or '' for wordless failures (timeout/resign). */
  word: string
  /** Which player failed (index into players). */
  by: PlayerIndex | null
  /** Changed-letter index to highlight, when there is a word to show. */
  changedIndex: number | null
  /** Why it failed. */
  lossReason: LossReason
}

/**
 * What the loser could have played — valid single-letter neighbors of the last
 * board word. Shown at game over for every loss EXCEPT resign; null otherwise.
 */
export interface MissedWords {
  fromWord: string
  words: string[]
  allUsed: boolean
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
    /** Failed attempts (broken chain / timeout / resign), rendered in red. */
    failedAttempts: [] as FailedEntry[],
    /** Moves the loser could have played, shown at game over (null = none). */
    missedWords: null as MissedWords | null,
    /** Set of words already used this match (uppercase). */
    used: new Set<string>(),
    /** Winner index once the game is over, else null. */
    winner: null as PlayerIndex | null,
    lossReason: null as LossReason | null,
    /** Epoch ms when the current player's turn times out, or null. */
    turnEndsAt: null as number | null,
    /** True while the dictionary for the chosen length is loading. */
    loading: false,
    error: '' as string,
    /** Solo "Versus Self" rush mode (single player, beat your own best). */
    solo: false,
    /** Current run score = number of valid words chained (solo). */
    score: 0,
    /** Best score for the chosen length (solo), from localStorage. */
    bestScore: 0,
    /** True once the latest run beat the previous best. */
    isNewBest: false
  })

  // Client-side turn timer. Cleared/reset at each turn.
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
    clearTurnTimer()
    // Wordless failure: record a timeout marker for the active player.
    recordFailure({ word: '', by: state.current, lossReason: 'timeout' })
    computeMissedWords()
    if (state.solo) {
      // Solo rush: running out of time ends the run.
      endSoloRun('timeout')
      return
    }
    // Duel: current player ran out of time => opponent wins.
    state.lossReason = 'timeout'
    state.winner = opponentIndex.value
    state.phase = 'gameover'
  }

  /* -------------------- solo best-score persistence -------------------- */
  function bestKey(len: WordLength) {
    return `wordmorph:best:${len}`
  }
  function loadBest(len: WordLength): number {
    if (typeof localStorage === 'undefined') return 0
    const n = Number(localStorage.getItem(bestKey(len)))
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  function saveBest(len: WordLength, score: number) {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(bestKey(len), String(score))
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }

  /** End the current solo run, recording the best score. */
  function endSoloRun(reason: LossReason) {
    clearTurnTimer()
    state.lossReason = reason
    state.winner = null
    state.phase = 'gameover'
    if (state.score > state.bestScore) {
      state.bestScore = state.score
      state.isNewBest = true
      saveBest(state.length, state.score)
    } else {
      state.isNewBest = false
    }
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
   * Pass `solo: true` for the single-player "Versus Self" rush.
   */
  async function startGame(opts: {
    length: WordLength
    player1: string
    player2?: string
    solo?: boolean
  }) {
    state.loading = true
    state.error = ''
    try {
      await loadDictionary(opts.length)

      state.solo = !!opts.solo
      state.length = opts.length
      state.players = [
        { name: opts.player1.trim() || 'Player 1' },
        { name: (opts.player2 ?? '').trim() || 'Player 2' }
      ]
      rememberPlayers(
        state.solo ? [state.players[0].name] : [state.players[0].name, state.players[1].name]
      )

      const start = pickStartWord(opts.length)
      state.chain = [{ word: start, by: null, changedIndex: null }]
      state.failedAttempts = []
      state.missedWords = null
      state.used = new Set([start])
      state.current = 0
      state.winner = null
      state.lossReason = null
      state.phase = 'playing'
      // Solo scoring resets each run; load the best for this length.
      state.score = 0
      state.isNewBest = false
      state.bestScore = state.solo ? loadBest(opts.length) : 0
      armTurnTimer()
    } catch (e: unknown) {
      state.error =
        e instanceof Error ? e.message : 'Failed to start the game.'
    } finally {
      state.loading = false
    }
  }

  /** Start a solo "Versus Self" rush. */
  async function startSolo(opts: { length: WordLength; player1: string }) {
    await startGame({ length: opts.length, player1: opts.player1, solo: true })
  }

  /** Rematch / play again: same settings, new random start word. */
  async function rematch() {
    await startGame({
      length: state.length,
      player1: state.players[0].name,
      player2: state.players[1].name,
      solo: state.solo
    })
  }

  /** Back to the lobby to change names / category. */
  function newGame() {
    clearTurnTimer()
    state.phase = 'lobby'
    state.winner = null
    state.lossReason = null
    state.chain = []
    state.failedAttempts = []
    state.missedWords = null
    state.used = new Set()
    state.solo = false
    state.score = 0
    state.isNewBest = false
  }

  /**
   * Best-effort changed-letter index for a FAILED word, for highlighting.
   * Returns the single changed position when there is exactly one; otherwise
   * the first differing position; or null when there's nothing meaningful
   * (wordless failure or equal/empty word).
   */
  function failedChangedIndex(candidate: string): number | null {
    const cur = currentWord.value
    const next = (candidate ?? '').toUpperCase()
    if (!next) return null
    const single = singleDiffIndex(cur, next)
    if (single >= 0) return single
    // Multi-change / wrong length: highlight the first position that differs.
    const n = Math.min(cur.length, next.length)
    for (let i = 0; i < n; i++) {
      if (cur[i] !== next[i]) return i
    }
    // Same prefix but different length (e.g. trailing extra/missing letters).
    return n < next.length || n < cur.length ? n : null
  }

  /** Record a failed attempt so the history can show it in red. */
  function recordFailure(opts: {
    word: string
    by: PlayerIndex | null
    lossReason: LossReason
  }) {
    state.failedAttempts.push({
      word: opts.word.toUpperCase(),
      by: opts.by,
      changedIndex: opts.word ? failedChangedIndex(opts.word) : null,
      lossReason: opts.lossReason
    })
  }

  /**
   * Compute the moves the loser could have played (valid neighbors of the last
   * board word), for the game-over screen. Prefers unused words; falls back to
   * already-used ones so the result explains "only repeats were left". Capped.
   */
  function computeMissedWords(limit = 6) {
    const fromWord = currentWord.value
    const set = dictCache.get(state.length)
    if (!fromWord || !set) {
      state.missedWords = null
      return
    }
    const unused: string[] = []
    const usedHits: string[] = []
    const chars = fromWord.split('')
    for (let i = 0; i < chars.length; i++) {
      const orig = chars[i]
      for (let c = 65; c <= 90; c++) {
        const ch = String.fromCharCode(c)
        if (ch === orig) continue
        chars[i] = ch
        const cand = chars.join('')
        if (set.has(cand)) {
          if (state.used.has(cand)) usedHits.push(cand)
          else unused.push(cand)
        }
      }
      chars[i] = orig
    }
    const words = unused.length ? unused.slice(0, limit) : usedHits.slice(0, limit)
    state.missedWords = {
      fromWord,
      words,
      allUsed: unused.length === 0 && usedHits.length > 0
    }
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
      clearTurnTimer()
      // Record the failed word (shown in red in the history) before ending.
      recordFailure({
        word: candidate,
        by: state.current,
        lossReason: mapReasonToLoss(result.reason ?? '')
      })
      computeMissedWords()
      if (state.solo) {
        // Solo rush: a wrong move ends the run.
        endSoloRun(mapReasonToLoss(result.reason ?? ''))
        return result
      }
      // Duel: illegal move => current player loses, opponent wins.
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
    if (state.solo) {
      // Solo rush: you keep playing yourself — score one, re-arm the clock.
      state.score += 1
      armTurnTimer()
    } else {
      state.current = opponentIndex.value
      armTurnTimer()
    }
    return result
  }

  /** Current player gives up (duel) / ends the run (solo). */
  function resign() {
    if (state.phase !== 'playing') return
    clearTurnTimer()
    // Wordless failure: record a resign marker for the active player.
    recordFailure({ word: '', by: state.current, lossReason: 'resign' })
    if (state.solo) {
      endSoloRun('resign')
      return
    }
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
    startSolo,
    rematch,
    newGame,
    submitWord,
    validateMove,
    resign,
    // persistence
    loadRecentPlayers,
    rememberPlayers,
    loadBest,
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
