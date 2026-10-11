import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'

/**
 * Unit tests for the online store with a MOCKED WebSocket. We assert:
 *  - actions emit the correct outbound JSON messages,
 *  - inbound `state` messages update the reactive refs + derived values,
 *  - turn gating (isMyTurn) reflects `you` vs `current`,
 *  - the reconnect path re-sends `join` (auto-rejoin).
 */

// ---- Mock WebSocket -------------------------------------------------------
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  url: string
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  listeners: Record<string, ((ev: any) => void)[]> = {}

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  addEventListener(type: string, cb: (ev: any) => void) {
    ;(this.listeners[type] ||= []).push(cb)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', {})
  }
  // test helpers
  emit(type: string, ev: any) {
    for (const cb of this.listeners[type] || []) cb(ev)
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

// Install the mock before importing the store.
;(globalThis as any).WebSocket = MockWebSocket as any

// Fresh module (and fresh singleton) per test.
async function freshStore() {
  vi.resetModules()
  MockWebSocket.instances = []
  const mod = await import('../composables/useOnlineGame')
  return mod.useOnlineGame()
}

const BASE = 'http://127.0.0.1:8787'

function sampleState(over: Partial<any> = {}) {
  return {
    phase: 'playing',
    length: 4,
    players: [
      { name: 'Alice', connected: true },
      { name: 'Bob', connected: true }
    ],
    current: 0,
    chain: [{ word: 'FALL', by: null, changedIndex: null }],
    winner: null,
    lossReason: null,
    roomCode: 'ABCDEF',
    ...over
  }
}

describe('useOnlineGame', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
  })

  it('joinRoom connects and sends join on open', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'Alice' })

    const sock = MockWebSocket.instances[0]
    expect(sock.url).toBe('ws://127.0.0.1:8787/ws?room=ABCDEF')
    expect(game.state.status).toBe('connecting')

    sock.open()
    expect(game.state.status).toBe('connected')
    expect(sock.sentParsed).toEqual([{ type: 'join', name: 'Alice' }])
  })

  it('inbound state updates reactive refs and derived values', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'Alice' })
    const sock = MockWebSocket.instances[0]
    sock.open()

    sock.message({ type: 'state', state: sampleState(), you: 0 })
    await nextTick()

    expect(game.state.you).toBe(0)
    expect(game.currentWord.value).toBe('FALL')
    expect(game.currentPlayer.value.name).toBe('Alice')
    expect(game.isMyTurn.value).toBe(true) // you=0, current=0
    expect(game.bothConnected.value).toBe(true)
  })

  it('isMyTurn is false when it is the opponent turn', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'Bob' })
    const sock = MockWebSocket.instances[0]
    sock.open()
    sock.message({ type: 'state', state: sampleState({ current: 0 }), you: 1 })
    await nextTick()
    expect(game.isMyTurn.value).toBe(false)
  })

  it('actions emit the correct outbound messages', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'Alice' })
    const sock = MockWebSocket.instances[0]
    sock.open()
    sock.sent.length = 0 // drop the initial join

    game.startGame({ length: 5 })
    game.submitWord('hall')
    game.rematch()
    game.resign()

    expect(sock.sentParsed).toEqual([
      { type: 'start', length: 5 },
      { type: 'move', word: 'HALL' }, // uppercased
      { type: 'rematch' },
      { type: 'resign' }
    ])
  })

  it('full message sets error and stops reconnecting', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'Carol' })
    const sock = MockWebSocket.instances[0]
    sock.open()
    sock.message({ type: 'full' })
    await nextTick()
    expect(game.state.error).toMatch(/full/i)
    expect(game.state.status).toBe('closed')
  })

  it('reconnect after unexpected close re-sends join (auto-rejoin)', async () => {
    vi.useFakeTimers()
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'Alice' })
    const sock1 = MockWebSocket.instances[0]
    sock1.open()
    expect(game.state.status).toBe('connected')

    // Simulate an unexpected drop (not intentional).
    sock1.emit('close', {})
    expect(game.state.status).toBe('reconnecting')

    // Advance past the backoff delay -> a new socket is created.
    vi.advanceTimersByTime(1000)
    const sock2 = MockWebSocket.instances[1]
    expect(sock2).toBeTruthy()
    sock2.open()
    // On reconnect, it must re-announce via join (auto-rejoin same name).
    expect(sock2.sentParsed).toEqual([{ type: 'join', name: 'Alice' }])
    vi.useRealTimers()
  })

  it('leave sends leave and closes without reconnecting', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'Alice' })
    const sock = MockWebSocket.instances[0]
    sock.open()
    sock.sent.length = 0
    game.leave()
    expect(sock.sentParsed).toEqual([{ type: 'leave' }])
    expect(game.state.status).toBe('closed')
  })
})
