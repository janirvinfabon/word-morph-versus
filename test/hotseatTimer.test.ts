import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Hot-seat per-turn timer: if the current player doesn't move within TURN_MS,
 * they lose with reason 'timeout' and the opponent wins.
 */

// Minimal dictionary so startGame() resolves and pickStartWord has a neighbor.
const WORDS4 = ['FALL', 'HALL', 'HALT', 'HALF', 'CALF']
beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(WORDS4), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  ) as any
})

async function freshGame() {
  vi.resetModules()
  const mod = await import('../composables/useWordMorph')
  return mod.useWordMorph()
}

describe('hot-seat turn timer', () => {
  it('current player loses on timeout, opponent wins', async () => {
    vi.useFakeTimers()
    const game = await freshGame()

    await game.startGame({ length: 4, player1: 'Alice', player2: 'Bob' })
    expect(game.state.phase).toBe('playing')
    expect(game.state.current).toBe(0)
    expect(game.state.turnEndsAt).not.toBeNull()

    // Advance past the 15s turn limit without moving.
    vi.advanceTimersByTime(15001)

    expect(game.state.phase).toBe('gameover')
    expect(game.state.lossReason).toBe('timeout')
    expect(game.state.winner).toBe(1) // opponent of player 0
    vi.useRealTimers()
  })

  it('a valid move resets the timer (no premature timeout)', async () => {
    vi.useFakeTimers()
    const game = await freshGame()
    await game.startGame({ length: 4, player1: 'Alice', player2: 'Bob' })

    // Force a known current word so we can make a valid move.
    // startGame seeds randomly; make any valid single-letter move from it.
    // We instead just advance 10s, then (if still playing) a move re-arms.
    vi.advanceTimersByTime(10000)
    expect(game.state.phase).toBe('playing')

    // Make a valid move from the current word to a neighbor in WORDS4.
    const cur = game.currentWord.value
    const neighbor = WORDS4.find(
      (w) =>
        w !== cur &&
        w.length === cur.length &&
        w.split('').filter((c, i) => c !== cur[i]).length === 1
    )
    if (neighbor) {
      const res = game.submitWord(neighbor)
      expect(res.ok).toBe(true)
      // Timer re-armed: advancing another 10s should NOT time out yet.
      vi.advanceTimersByTime(10000)
      expect(game.state.phase).toBe('playing')
    }
    vi.useRealTimers()
  })
})
