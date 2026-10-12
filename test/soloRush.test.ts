import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Solo "Versus Self" rush:
 *  - a valid move scores +1 and keeps the same player (no turn flip),
 *  - an invalid move ends the run (gameover, no winner),
 *  - a timeout ends the run,
 *  - the best score persists to localStorage and isNewBest flags a record.
 */

// Connected mini-dictionary so a chain of valid moves exists.
const WORDS4 = ['FALL', 'HALL', 'HALT', 'HALF', 'CALF', 'MALL', 'BALL']

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: any) => {
    const body = String(url).includes('/starts-') ? ['FALL'] : WORDS4
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as any
  localStorage.clear()
})

async function freshGame() {
  vi.resetModules()
  const mod = await import('../composables/useWordMorph')
  return mod.useWordMorph()
}

/** Find a valid single-letter neighbor of `cur` in WORDS4 not in `used`. */
function neighbor(cur: string, used: Set<string>) {
  return WORDS4.find(
    (w) =>
      w !== cur &&
      !used.has(w) &&
      w.length === cur.length &&
      w.split('').filter((c, i) => c !== cur[i]).length === 1
  )
}

describe('solo rush', () => {
  it('valid moves score +1 and keep the same player', async () => {
    const game = await freshGame()
    await game.startSolo({ length: 4, player1: 'Me' })
    expect(game.state.solo).toBe(true)
    expect(game.state.score).toBe(0)
    expect(game.state.current).toBe(0)

    const used = new Set([game.currentWord.value])
    const next = neighbor(game.currentWord.value, used)!
    const res = game.submitWord(next)
    expect(res.ok).toBe(true)
    expect(game.state.score).toBe(1)
    expect(game.state.current).toBe(0) // no turn flip in solo
    expect(game.state.phase).toBe('playing')
  })

  it('session reports solo run as playable (phase=playing, canPlay=true)', async () => {
    vi.resetModules()
    const { useGameSession } = await import('../composables/useGameSession')
    const { useWordMorph } = await import('../composables/useWordMorph')
    const session = useGameSession()
    const game = useWordMorph()
    session.setMode('solo')
    await game.startSolo({ length: 4, player1: 'Me' })
    expect(session.phase.value).toBe('playing')
    expect(session.canPlay.value).toBe(true) // input must be enabled
    expect(session.isSolo.value).toBe(true)
  })

  it('an invalid move ends the run with no winner', async () => {
    const game = await freshGame()
    await game.startSolo({ length: 4, player1: 'Me' })
    // Single-letter change from the start word (FALL) to a non-word (FALZ).
    const cur = game.currentWord.value
    const nonWord = cur.slice(0, 3) + (cur[3] === 'Z' ? 'Q' : 'Z')
    const res = game.submitWord(nonWord)
    expect(res.ok).toBe(false)
    expect(game.state.phase).toBe('gameover')
    expect(game.state.winner).toBeNull()
    expect(game.state.lossReason).toBe('invalid-word')
  })

  it('timeout ends the run', async () => {
    vi.useFakeTimers()
    const game = await freshGame()
    await game.startSolo({ length: 4, player1: 'Me' })
    vi.advanceTimersByTime(15001)
    expect(game.state.phase).toBe('gameover')
    expect(game.state.lossReason).toBe('timeout')
    expect(game.state.winner).toBeNull()
    vi.useRealTimers()
  })

  it('records a new best score to localStorage', async () => {
    const game = await freshGame()
    await game.startSolo({ length: 4, player1: 'Me' })

    // Chain a couple of valid moves, then make an invalid one to end the run.
    const used = new Set([game.currentWord.value])
    let n = neighbor(game.currentWord.value, used)
    while (n) {
      game.submitWord(n)
      used.add(n)
      n = neighbor(game.currentWord.value, used)
    }
    const scored = game.state.score
    // End the run (if not already ended by running out of neighbors path).
    if (game.state.phase === 'playing') game.submitWord('ZZZZ')

    expect(scored).toBeGreaterThan(0)
    expect(game.state.isNewBest).toBe(true)
    expect(game.loadBest(4)).toBe(scored)
  })

  it('backToLobby returns to the solo lobby, keeping solo mode', async () => {
    vi.resetModules()
    const { useGameSession } = await import('../composables/useGameSession')
    const { useWordMorph } = await import('../composables/useWordMorph')
    const session = useGameSession()
    const game = useWordMorph()
    session.setMode('solo')
    await game.startSolo({ length: 4, player1: 'Me' })
    game.submitWord('FALZ') // end the run (single-letter non-word)

    session.backToLobby()
    expect(session.mode.value).toBe('solo') // still in Versus Self
    expect(game.state.phase).toBe('lobby') // back on the setup screen
  })
})
