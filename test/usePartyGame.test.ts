import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'

/**
 * Unit tests for the PARTY store with a MOCKED WebSocket. Party players are
 * id-based (not 0|1), so we assert:
 *  - the /party/ws URL is used and join is sent on open,
 *  - id-based turn gating (isMyTurn via currentId === you),
 *  - roster helpers (playerCount, canStart at >= 3, youAreHost),
 *  - elimination-aware derived values (youEliminated, winner, podium),
 *  - 'full' and 'in-progress' server messages set errors and stop reconnecting.
 */

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
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
  close() {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', {})
  }
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

async function freshStore() {
  vi.resetModules()
  MockWebSocket.instances = []
  const mod = await import('../composables/usePartyGame')
  return mod.usePartyGame()
}

const BASE = 'http://127.0.0.1:8787'

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

function sampleState(over: Partial<any> = {}) {
  return {
    phase: 'playing',
    length: 4,
    players: [player('a'), player('b'), player('c')],
    currentId: 'a',
    chain: [{ word: 'FALL', by: null, changedIndex: null }],
    winnerId: null,
    roomCode: 'ABCDEF',
    maxPlayers: 10,
    turnEndsAt: Date.now() + 15000,
    ...over
  }
}

describe('usePartyGame', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
  })

  it('joinRoom connects to /party/ws and sends join on open', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'Alice' })
    const sock = MockWebSocket.instances[0]
    expect(sock.url).toBe('ws://127.0.0.1:8787/party/ws?room=ABCDEF')
    sock.open()
    expect(game.state.status).toBe('connected')
    expect(sock.sentParsed).toEqual([{ type: 'join', name: 'Alice' }])
  })

  it('isMyTurn reflects currentId === you (id-based gating)', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'A' })
    const sock = MockWebSocket.instances[0]
    sock.open()

    sock.message({ type: 'state', state: sampleState({ currentId: 'a' }), you: 'a' })
    await nextTick()
    expect(game.isMyTurn.value).toBe(true)

    sock.message({ type: 'state', state: sampleState({ currentId: 'b' }), you: 'a' })
    await nextTick()
    expect(game.isMyTurn.value).toBe(false)
  })

  it('roster helpers: playerCount, canStart (>=3), youAreHost', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'A' })
    const sock = MockWebSocket.instances[0]
    sock.open()

    // Two players waiting => cannot start yet.
    sock.message({
      type: 'state',
      state: sampleState({ phase: 'waiting', players: [player('a'), player('b')], currentId: null }),
      you: 'a'
    })
    await nextTick()
    expect(game.playerCount.value).toBe(2)
    expect(game.canStart.value).toBe(false)
    expect(game.youAreHost.value).toBe(true) // seat 0 is 'a'

    // Third joins => can start.
    sock.message({
      type: 'state',
      state: sampleState({ phase: 'waiting', players: [player('a'), player('b'), player('c')], currentId: null }),
      you: 'a'
    })
    await nextTick()
    expect(game.playerCount.value).toBe(3)
    expect(game.canStart.value).toBe(true)
  })

  it('tracks elimination: youEliminated, winner, and podium ordering', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'B' })
    const sock = MockWebSocket.instances[0]
    sock.open()

    // Game over: 'a' wins (placement 1), 'b' 2nd, 'c' 3rd (eliminated first).
    sock.message({
      type: 'state',
      you: 'b',
      state: sampleState({
        phase: 'gameover',
        currentId: null,
        winnerId: 'a',
        players: [
          player('a', { placement: 1 }),
          player('b', { eliminated: true, lossReason: 'resign', placement: 2 }),
          player('c', { eliminated: true, lossReason: 'timeout', placement: 3 })
        ]
      })
    })
    await nextTick()

    expect(game.youEliminated.value).toBe(true)
    expect(game.winner.value?.id).toBe('a')
    expect(game.podium.value.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(game.podium.value.map((p) => p.placement)).toEqual([1, 2, 3])
  })

  it('actions emit the correct outbound messages', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'A' })
    const sock = MockWebSocket.instances[0]
    sock.open()
    sock.sent.length = 0

    game.startGame({ length: 5 })
    game.submitWord('hall')
    game.rematch()
    game.resign()

    expect(sock.sentParsed).toEqual([
      { type: 'start', length: 5 },
      { type: 'move', word: 'HALL' },
      { type: 'rematch' },
      { type: 'resign' }
    ])
  })

  it('full message sets error and stops reconnecting', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'K' })
    const sock = MockWebSocket.instances[0]
    sock.open()
    sock.message({ type: 'full' })
    await nextTick()
    expect(game.state.error).toMatch(/full/i)
    expect(game.state.status).toBe('closed')
  })

  it('in-progress message rejects a late joiner', async () => {
    const game = await freshStore()
    game.joinRoom({ wsBase: BASE, room: 'ABCDEF', name: 'L' })
    const sock = MockWebSocket.instances[0]
    sock.open()
    sock.message({ type: 'in-progress' })
    await nextTick()
    expect(game.state.error).toMatch(/already started/i)
    expect(game.state.status).toBe('closed')
  })
})
