import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

/**
 * Integration tests for GameBoard turn-gating in ONLINE mode via useGameSession.
 *  - When it is NOT the local player's turn, TileInput is disabled.
 *  - When it IS the local player's turn, TileInput is enabled.
 *  - Submitting a move sends a `move` message to the server.
 */

// Mock WebSocket (shared pattern).
class MockWebSocket {
  static OPEN = 1
  static instances: MockWebSocket[] = []
  url: string
  readyState = 0
  sent: string[] = []
  listeners: Record<string, ((ev: any) => void)[]> = {}
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  addEventListener(t: string, cb: (ev: any) => void) {
    ;(this.listeners[t] ||= []).push(cb)
  }
  send(d: string) {
    this.sent.push(d)
  }
  close() {}
  emit(t: string, ev: any) {
    for (const cb of this.listeners[t] || []) cb(ev)
  }
  open() {
    this.readyState = MockWebSocket.OPEN
    this.emit('open', {})
  }
  message(obj: unknown) {
    this.emit('message', { data: JSON.stringify(obj) })
  }
  get sentParsed() {
    return this.sent.map((s) => JSON.parse(s))
  }
}
;(globalThis as any).WebSocket = MockWebSocket as any

function stateMsg(you: number, current: number) {
  return {
    type: 'state',
    you,
    state: {
      phase: 'playing',
      length: 4,
      players: [
        { name: 'Alice', connected: true },
        { name: 'Bob', connected: true }
      ],
      current,
      chain: [{ word: 'FALL', by: null, changedIndex: null }],
      winner: null,
      lossReason: null,
      roomCode: 'ABCDEF',
      turnEndsAt: Date.now() + 15000
    }
  }
}

async function setup(you: number, current: number) {
  vi.resetModules()
  MockWebSocket.instances = []
  const { useGameSession } = await import('../composables/useGameSession')
  const GameBoard = (await import('../components/GameBoard.vue')).default

  const session = useGameSession()
  session.setMode('online')
  session.online.joinRoom({
    wsBase: 'http://127.0.0.1:8787',
    room: 'ABCDEF',
    name: you === 0 ? 'Alice' : 'Bob'
  })
  const sock = MockWebSocket.instances[0]
  sock.open()
  sock.message(stateMsg(you, current))

  const wrapper = mount(GameBoard)
  await flushPromises()
  return { wrapper, sock, session }
}

describe('GameBoard online turn gating', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
  })

  it('disables tile input when it is NOT the local player turn', async () => {
    // local player is 1 (Bob); current turn is 0 (Alice).
    const { wrapper } = await setup(1, 0)
    const inputs = wrapper.findAll('input')
    expect(inputs.length).toBeGreaterThan(0)
    expect(inputs.every((i) => (i.element as HTMLInputElement).disabled)).toBe(true)
    expect(wrapper.text()).toMatch(/waiting on/i)
  })

  it('enables tile input when it IS the local player turn', async () => {
    // local player is 0 (Alice); current turn is 0.
    const { wrapper } = await setup(0, 0)
    const inputs = wrapper.findAll('input')
    expect(inputs.some((i) => !(i.element as HTMLInputElement).disabled)).toBe(true)
  })

  it('submitting a move sends a move message to the server', async () => {
    const { wrapper, sock } = await setup(0, 0)
    sock.sent.length = 0 // drop the join

    // Instant submit: typing one letter into the first tile (FALL -> HALL)
    // fires the move immediately — no Submit button.
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('H')
    await flushPromises()

    const moves = sock.sentParsed.filter((m: any) => m.type === 'move')
    expect(moves.length).toBe(1)
    expect(moves[0].word).toBe('HALL')
  })
})
