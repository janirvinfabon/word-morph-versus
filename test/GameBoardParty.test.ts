import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

/**
 * Integration tests for GameBoard turn-gating in PARTY mode via useGameSession.
 *  - Input disabled when it is NOT the local player's turn (by id).
 *  - Input enabled when it IS the local player's turn.
 *  - Submitting a move sends a `move` to the server.
 *  - An eliminated local player is shown as spectating and cannot type.
 */

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

function player(id: string, over: Partial<any> = {}) {
  return {
    id,
    name: id.toUpperCase(),
    connected: true,
    eliminated: false,
    lossReason: null,
    placement: null,
    ...over
  }
}

function stateMsg(you: string, currentId: string, playersOver: any[] | null = null) {
  return {
    type: 'state',
    you,
    state: {
      phase: 'playing',
      length: 4,
      players: playersOver ?? [player('a'), player('b'), player('c')],
      currentId,
      chain: [{ word: 'FALL', by: null, changedIndex: null }],
      winnerId: null,
      roomCode: 'ABCDEF',
      maxPlayers: 10,
      turnEndsAt: Date.now() + 15000
    }
  }
}

async function setup(you: string, currentId: string, playersOver: any[] | null = null) {
  vi.resetModules()
  MockWebSocket.instances = []
  const { useGameSession } = await import('../composables/useGameSession')
  const GameBoard = (await import('../components/GameBoard.vue')).default

  const session = useGameSession()
  session.setMode('party')
  session.party.joinRoom({ wsBase: 'http://127.0.0.1:8787', room: 'ABCDEF', name: you })
  const sock = MockWebSocket.instances[0]
  sock.open()
  sock.message(stateMsg(you, currentId, playersOver))

  const wrapper = mount(GameBoard)
  await flushPromises()
  return { wrapper, sock, session }
}

describe('GameBoard party turn gating', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
  })

  it('connects to /party/ws', async () => {
    const { sock } = await setup('a', 'a')
    expect(sock.url).toBe('ws://127.0.0.1:8787/party/ws?room=ABCDEF')
  })

  it('disables input when it is NOT the local player turn', async () => {
    const { wrapper } = await setup('b', 'a') // you=b, current=a
    const inputs = wrapper.findAll('input')
    expect(inputs.length).toBeGreaterThan(0)
    expect(inputs.every((i) => (i.element as HTMLInputElement).disabled)).toBe(true)
    expect(wrapper.text()).toMatch(/waiting on/i)
  })

  it('enables input when it IS the local player turn', async () => {
    const { wrapper } = await setup('a', 'a')
    const inputs = wrapper.findAll('input')
    expect(inputs.some((i) => !(i.element as HTMLInputElement).disabled)).toBe(true)
  })

  it('submitting a move sends a move message', async () => {
    const { wrapper, sock } = await setup('a', 'a')
    sock.sent.length = 0
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('H') // FALL -> HALL
    await flushPromises()
    const moves = sock.sentParsed.filter((m: any) => m.type === 'move')
    expect(moves.length).toBe(1)
    expect(moves[0].word).toBe('HALL')
  })

  it('shows spectating state and disables input for an eliminated local player', async () => {
    const players = [
      player('a'),
      player('b', { eliminated: true, lossReason: 'timeout', placement: 3 }),
      player('c')
    ]
    const { wrapper } = await setup('b', 'c', players) // you=b (eliminated)
    expect(wrapper.text()).toMatch(/out/i)
    const inputs = wrapper.findAll('input')
    expect(inputs.every((i) => (i.element as HTMLInputElement).disabled)).toBe(true)
  })

  it('renders the full player strip with every seat', async () => {
    const { wrapper } = await setup('a', 'a')
    expect(wrapper.text()).toContain('A')
    expect(wrapper.text()).toContain('B')
    expect(wrapper.text()).toContain('C')
  })
})
