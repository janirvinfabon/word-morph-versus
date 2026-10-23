import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

/**
 * Component tests for OnlineLobby:
 *  - Create flow mints a code and connects (shows the waiting room w/ code+link).
 *  - Join validates the 6-char code format before connecting.
 *  - A ?room= URL prefills the code input.
 */

// --- Mock WebSocket -------------------------------------------------------
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
}
;(globalThis as any).WebSocket = MockWebSocket as any

// --- fetch mock: route-aware for /new and /rooms -------------------------
const CODE = 'ABCDEF'
let OPEN_ROOMS: any[] = []
globalThis.fetch = vi.fn(async (url: any) => {
  const u = String(url)
  if (u.includes('/rooms')) {
    return new Response(JSON.stringify({ rooms: OPEN_ROOMS }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  // default: /new
  return new Response(JSON.stringify({ room: CODE }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}) as any

async function loadComponent() {
  vi.resetModules()
  MockWebSocket.instances = []
  const mod = await import('../components/OnlineLobby.vue')
  return mod.default
}

function pushState(ws: MockWebSocket, over: Partial<any> = {}) {
  ws.message({
    type: 'state',
    you: 0,
    state: {
      phase: 'waiting',
      length: 4,
      players: [
        { name: 'Alice', connected: true },
        { name: 'Player 2', connected: false }
      ],
      current: 0,
      chain: [],
      winner: null,
      lossReason: null,
      roomCode: CODE,
      ...over
    }
  })
}

describe('OnlineLobby', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    OPEN_ROOMS = []
    // reset window URL
    window.history.replaceState({}, '', '/')
  })

  it('create flow mints a code and shows the waiting room with code + link', async () => {
    const Comp = await loadComponent()
    const wrapper = mount(Comp)

    await wrapper.find('input').setValue('Alice')
    // Click "Create a room"
    const createBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Create'))!
    await createBtn.trigger('click')
    await flushPromises()

    // A socket should have been opened to the minted code.
    const sock = MockWebSocket.instances[0]
    expect(sock.url).toContain(`room=${CODE}`)
    sock.open()
    pushState(sock)
    await flushPromises()

    // Waiting room shows the room code and a share link.
    expect(wrapper.text()).toContain(CODE)
    const link = wrapper.find('input[readonly]')
    expect(link.exists()).toBe(true)
    expect((link.element as HTMLInputElement).value).toContain(`room=${CODE}`)
  })

  it('shows an invited-room panel and joins it from a ?room= URL', async () => {
    window.history.replaceState({}, '', '/?room=ZZZZ99')
    const Comp = await loadComponent()
    const wrapper = mount(Comp)
    await flushPromises()

    // The invite code is surfaced with a dedicated join button (no code entry).
    expect(wrapper.text()).toContain('ZZZZ99')
    await wrapper.find('input').setValue('Bob')
    const joinBtn = wrapper
      .findAll('button')
      .find((b) => /join this room/i.test(b.text()))!
    await joinBtn.trigger('click')
    await flushPromises()

    const sock = MockWebSocket.instances[0]
    expect(sock.url).toContain('room=ZZZZ99')
  })

  it('auto-joins an invite link immediately when a name is already known', async () => {
    // A recent name is persisted, so the invite link should connect on mount.
    // (loadRecentPlayers reads localStorage; seed it before loading.)
    window.localStorage.setItem(
      'wordmorph:recent-players',
      JSON.stringify(['Alice'])
    )
    window.history.replaceState({}, '', '/?room=YYYY88')
    const Comp = await loadComponent()
    mount(Comp)
    await flushPromises()

    const sock = MockWebSocket.instances[0]
    expect(sock).toBeTruthy()
    expect(sock.url).toContain('room=YYYY88')
    window.localStorage.clear()
  })

  it('renders open rooms fetched on mount and joins one on click', async () => {
    OPEN_ROOMS = [
      { code: 'ROOM01', hostName: 'Zoe', length: 5, createdAt: Date.now() }
    ]
    const Comp = await loadComponent()
    const wrapper = mount(Comp)
    await flushPromises()

    // The open room is listed with host name and code.
    expect(wrapper.text()).toContain('Zoe')
    expect(wrapper.text()).toContain('ROOM01')

    // Enter a name, then click that room's Join button to connect.
    await wrapper.find('input').setValue('Yan')
    const joinBtns = wrapper.findAll('button').filter((b) => b.text() === 'Join')
    // Last "Join" button belongs to the open-rooms list row.
    await joinBtns[joinBtns.length - 1].trigger('click')
    await flushPromises()

    const sock = MockWebSocket.instances[0]
    expect(sock.url).toContain('room=ROOM01')
  })

  it('persists the player name to localStorage on create (survives New Game)', async () => {
    window.localStorage.clear()
    const Comp = await loadComponent()
    const wrapper = mount(Comp)

    await wrapper.find('input').setValue('Mariel')
    const createBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Create'))!
    await createBtn.trigger('click')
    await flushPromises()

    const saved = JSON.parse(
      window.localStorage.getItem('wordmorph:recent-players') || '[]'
    )
    expect(saved[0]).toBe('Mariel')
    window.localStorage.clear()
  })

  it('pre-fills the name from a previously saved name', async () => {
    window.localStorage.setItem(
      'wordmorph:recent-players',
      JSON.stringify(['Mariel'])
    )
    const Comp = await loadComponent()
    const wrapper = mount(Comp)
    await flushPromises()

    const nameInput = wrapper.find('input')
    expect((nameInput.element as HTMLInputElement).value).toBe('Mariel')
    window.localStorage.clear()
  })

  it('shows an empty state when there are no open rooms', async () => {
    OPEN_ROOMS = []
    const Comp = await loadComponent()
    const wrapper = mount(Comp)
    await flushPromises()
    expect(wrapper.text()).toMatch(/no open rooms/i)
  })

  it('Refresh re-fetches the open rooms list', async () => {
    OPEN_ROOMS = []
    const Comp = await loadComponent()
    const wrapper = mount(Comp)
    await flushPromises()
    expect(wrapper.text()).toMatch(/no open rooms/i)

    // New room appears on the server; clicking Refresh picks it up.
    OPEN_ROOMS = [
      { code: 'ROOM02', hostName: 'Nia', length: 4, createdAt: Date.now() }
    ]
    const refreshBtn = wrapper
      .findAll('button')
      .find((b) => /refresh/i.test(b.text()))!
    await refreshBtn.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Nia')
    expect(wrapper.text()).toContain('ROOM02')
  })

  it('Leave room returns to the pre-join view', async () => {
    const Comp = await loadComponent()
    const wrapper = mount(Comp)
    await wrapper.find('input').setValue('Alice')

    // Create + join a room to reach the waiting room.
    const createBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Create'))!
    await createBtn.trigger('click')
    await flushPromises()
    const sock = MockWebSocket.instances[0]
    sock.open()
    pushState(sock)
    await flushPromises()
    expect(wrapper.text()).toContain(CODE) // in the waiting room

    // Click "Leave room" -> back to pre-join (Create a room visible again).
    const leaveBtn = wrapper
      .findAll('button')
      .find((b) => /leave room/i.test(b.text()))!
    await leaveBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toMatch(/create a room/i)
    const sentTypes = sock.sent.map((s: string) => JSON.parse(s).type)
    expect(sentTypes).toContain('leave')
  })
})
