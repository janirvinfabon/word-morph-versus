import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Hot-seat failed-attempt tracking (useWordMorph):
 *  - an invalid-word attempt is recorded with the word, player, reason, and a
 *    highlightable changed index,
 *  - a not-single-change attempt is recorded (best-effort changed index),
 *  - a timeout/resign records a WORDLESS failed entry,
 *  - startGame / newGame clear the failed list.
 */

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

describe('failed attempts (hot-seat)', () => {
  it('records an invalid-word attempt with the bad word + changed index', async () => {
    const game = await freshGame()
    await game.startGame({ length: 4, player1: 'A', player2: 'B' })
    // Current word is FALL (seeded). FXLL is a single change but not a word.
    game.submitWord('FXLL')

    expect(game.state.failedAttempts.length).toBe(1)
    const f = game.state.failedAttempts[0]
    expect(f.word).toBe('FXLL')
    expect(f.by).toBe(0)
    expect(f.lossReason).toBe('invalid-word')
    expect(f.changedIndex).toBe(1) // the 'X' position
  })

  it('records a not-single-change attempt (best-effort first-diff index)', async () => {
    const game = await freshGame()
    await game.startGame({ length: 4, player1: 'A', player2: 'B' })
    // FALL -> ZZLL changes two letters.
    game.submitWord('ZZLL')

    const f = game.state.failedAttempts.at(-1)!
    expect(f.word).toBe('ZZLL')
    expect(f.lossReason).toBe('not-single-change')
    expect(f.changedIndex).toBe(0) // first differing position
  })

  it('records a WORDLESS failure on resign', async () => {
    const game = await freshGame()
    await game.startGame({ length: 4, player1: 'A', player2: 'B' })
    game.resign()

    const f = game.state.failedAttempts.at(-1)!
    expect(f.word).toBe('')
    expect(f.lossReason).toBe('resign')
    expect(f.changedIndex).toBe(null)
    expect(f.by).toBe(0)
  })

  it('clears failed attempts on a new game / rematch', async () => {
    const game = await freshGame()
    await game.startGame({ length: 4, player1: 'A', player2: 'B' })
    game.submitWord('FXLL')
    expect(game.state.failedAttempts.length).toBe(1)

    await game.rematch()
    expect(game.state.failedAttempts.length).toBe(0)
  })

  it('computes missed words on a losing move (neighbors of the board word)', async () => {
    const game = await freshGame()
    await game.startGame({ length: 4, player1: 'A', player2: 'B' })
    // FALL is the board word; a bad move loses and should surface neighbors.
    game.submitWord('FXLL')

    const m = game.state.missedWords
    expect(m).not.toBe(null)
    expect(m!.fromWord).toBe('FALL')
    expect(m!.words.length).toBeGreaterThan(0)
    // Every suggestion is a real single-letter neighbor of FALL in the dict.
    for (const w of m!.words) {
      expect(WORDS4).toContain(w)
      expect(w.split('').filter((c, i) => c !== 'FALL'[i]).length).toBe(1)
    }
  })

  it('does NOT compute missed words on resign', async () => {
    const game = await freshGame()
    await game.startGame({ length: 4, player1: 'A', player2: 'B' })
    game.resign()
    expect(game.state.missedWords).toBe(null)
  })

  it('computes missed words on timeout', async () => {
    vi.useFakeTimers()
    const game = await freshGame()
    await game.startGame({ length: 4, player1: 'A', player2: 'B' })
    vi.advanceTimersByTime(15000) // run out the clock
    expect(game.state.phase).toBe('gameover')
    expect(game.state.missedWords).not.toBe(null)
    expect(game.state.missedWords!.words.length).toBeGreaterThan(0)
    vi.useRealTimers()
  })
})
