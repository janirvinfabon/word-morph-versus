/**
 * ws-match.mjs — integration driver: connects TWO WebSocket clients to the
 * same room against a running Worker (wrangler dev) and plays a full match,
 * asserting the broadcast `state` payloads reflect correct turns and win/loss.
 *
 * Usage: node test/ws-match.mjs [ws://127.0.0.1:8787]
 * Exit code 0 = all assertions passed.
 */
import assert from 'node:assert/strict'

const BASE = process.argv[2] ?? 'ws://127.0.0.1:8787'
const HTTP_BASE = BASE.replace(/^ws/, 'http')

// Valid room code per the Worker's alphabet (no 0/O/1/I/L), 6 chars.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function makeCode() {
  let c = ''
  for (let i = 0; i < 6; i++) {
    c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return c
}
let ROOM = makeCode()

function connect(name, room = ROOM) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}/ws?room=${room}`)
    const inbox = []
    const waiters = []
    ws.addEventListener('open', () => resolve(api))
    ws.addEventListener('error', (e) => reject(e))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      const w = waiters.shift()
      if (w) w(msg)
      else inbox.push(msg)
    })
    const api = {
      ws,
      name,
      send: (obj) => ws.send(JSON.stringify(obj)),
      // Wait for the next message, optionally matching a predicate.
      next: (pred) =>
        new Promise((res) => {
          const take = (m) => {
            if (!pred || pred(m)) res(m)
            else waiters.unshift(wrap) // keep waiting
          }
          const wrap = (m) => take(m)
          if (inbox.length) {
            const idx = pred ? inbox.findIndex(pred) : 0
            if (idx >= 0) {
              const [m] = inbox.splice(idx, 1)
              return res(m)
            }
          }
          waiters.push(wrap)
        }),
      close: () => ws.close()
    }
  })
}

const isState = (m) => m.type === 'state'

// Load the real word lists so the driver can compute a guaranteed-valid move
// (a single-letter neighbor present in the dictionary) for the seed word.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
function loadWords(len) {
  return new Set(
    JSON.parse(readFileSync(join(__dirname, `../src/words/words-${len}.json`), 'utf8'))
  )
}
/** Find a single-letter neighbor of `word` in `dict`, excluding `used`. */
function findNeighbor(word, dict, used) {
  const chars = word.split('')
  for (let i = 0; i < chars.length; i++) {
    const orig = chars[i]
    for (let c = 65; c <= 90; c++) {
      const ch = String.fromCharCode(c)
      if (ch === orig) continue
      chars[i] = ch
      const cand = chars.join('')
      if (dict.has(cand) && !used.has(cand)) {
        chars[i] = orig
        return cand
      }
    }
    chars[i] = orig
  }
  return null
}

async function main() {
  console.log(`Room: ${ROOM}  Base: ${BASE}`)
  const p1 = await connect('Alice')
  const p2 = await connect('Bob')

  // --- join ---
  p1.send({ type: 'join', name: 'Alice' })
  let s = await p1.next(isState)
  assert.equal(s.you, 0, 'P1 should be player index 0')
  assert.equal(s.state.roomCode, ROOM)

  p2.send({ type: 'join', name: 'Bob' })
  s = await p2.next((m) => isState(m) && m.you === 1)
  assert.equal(s.you, 1, 'P2 should be player index 1')
  console.log('✓ both players joined (indexes 0 and 1)')

  // --- start (seed word via server) ---
  p1.send({ type: 'start', length: 4 })
  const started = await p1.next((m) => isState(m) && m.state.phase === 'playing')
  assert.equal(started.state.phase, 'playing')
  assert.equal(started.state.chain.length, 1, 'chain seeded with 1 word')
  assert.equal(started.state.current, 0, 'P1 starts')
  console.log(`✓ game started on "${started.state.chain[0].word}"`)

  // --- timer: turnEndsAt is set ~15s ahead on the active turn ---
  assert.ok(started.state.turnEndsAt, 'turnEndsAt present when playing')
  const remaining = started.state.turnEndsAt - Date.now()
  assert.ok(
    remaining > 10000 && remaining <= 15000,
    `turnEndsAt ~15s ahead (got ${remaining}ms)`
  )
  console.log(`✓ turn timer armed (~${Math.round(remaining / 1000)}s ahead)`)

  // --- a VALID move advances the chain and flips the turn ---
  const dict4 = loadWords(4)
  const seedWord = started.state.chain[0].word
  const neighbor = findNeighbor(seedWord, dict4, new Set([seedWord]))
  assert.ok(neighbor, `seed "${seedWord}" should have a valid neighbor`)

  p1.send({ type: 'move', word: neighbor })
  const adv1 = await p1.next((m) => isState(m) && m.state.chain.length === 2)
  const adv2 = await p2.next((m) => isState(m) && m.state.chain.length === 2)
  assert.equal(adv1.state.chain[1].word, neighbor, 'chain extended with the move')
  assert.equal(adv1.state.chain[1].by, 0, 'move attributed to P1')
  assert.equal(adv1.state.current, 1, 'turn flipped to P2')
  assert.equal(adv2.state.current, 1, 'both clients agree it is P2 turn')
  assert.ok(adv1.state.chain[1].changedIndex !== null, 'changed index recorded')
  console.log(`✓ valid move ${seedWord}->${neighbor} advances chain, turn flips to P2`)

  // --- turn gating: P1 (not their turn) cannot move ---
  p1.send({ type: 'move', word: seedWord })
  const err = await p1.next((m) => m.type === 'error')
  assert.match(err.reason, /not your turn/i)
  console.log('✓ out-of-turn move rejected with error (state unchanged)')

  // --- drive a deterministic chain by overriding the start word ---
  // We can't control the random seed word, so instead verify turn mechanics
  // and win/loss with controlled moves relative to whatever the seed is.
  // To get a known chain, resign+rematch isn't deterministic either, so we
  // assert the RULES: an invalid word from the current player ends the game
  // and awards the opponent.

  // P2 (now current) plays a non-single-letter change -> not-single-change.
  const seed = adv1.state.chain[1].word
  const twoChanged =
    (seed[0] === 'Z' ? 'Q' : 'Z') + (seed[1] === 'Z' ? 'Q' : 'Z') + seed.slice(2)

  p2.send({ type: 'move', word: twoChanged })
  // P2 gets an error; both get a gameover state with winner = P1 (index 0).
  const over1 = await p1.next((m) => isState(m) && m.state.phase === 'gameover')
  const over2 = await p2.next((m) => isState(m) && m.state.phase === 'gameover')
  assert.equal(over1.state.winner, 0, 'opponent (P1) wins on illegal move')
  assert.equal(over2.state.winner, 0, 'both clients agree P1 won')
  assert.equal(over1.state.lossReason, 'not-single-change')
  console.log('✓ illegal move ends game, opponent wins, both clients in sync')

  // --- rematch resets to playing, P1 to move ---
  p1.send({ type: 'rematch' })
  const re = await p1.next(
    (m) => isState(m) && m.state.phase === 'playing' && m.state.chain.length === 1
  )
  assert.equal(re.state.winner, null)
  assert.equal(re.state.current, 0)
  console.log('✓ rematch starts fresh match')

  // --- EITHER player can rematch: end the game, then P2 requests rematch ---
  p2.send({ type: 'resign' }) // P2 resigns -> game over
  await p1.next((m) => isState(m) && m.state.phase === 'gameover')
  p2.send({ type: 'rematch' }) // the non-host (P2) clicks rematch
  const re2 = await p2.next(
    (m) => isState(m) && m.state.phase === 'playing' && m.state.chain.length === 1
  )
  assert.equal(re2.state.phase, 'playing', 'P2 (non-host) rematch restarts the game')
  console.log('✓ either player can trigger a rematch')

  // --- resign hands win to opponent ---
  p2.send({ type: 'resign' }) // not P2's turn, but resign is allowed anytime
  const rs = await p1.next((m) => isState(m) && m.state.phase === 'gameover')
  assert.equal(rs.state.winner, 0, 'P2 resigned => P1 wins')
  assert.equal(rs.state.lossReason, 'resign')
  console.log('✓ resign awards opponent the win')

  // --- room full: a third distinct player is rejected ---
  const p3 = await connect('Carol')
  p3.send({ type: 'join', name: 'Carol' })
  const full = await p3.next((m) => m.type === 'full')
  assert.equal(full.type, 'full', 'third player gets room-full')
  console.log('✓ third player rejected (room full)')
  p3.close()

  // --- Task 3: /new mints a valid code ---
  const newRes = await fetch(`${HTTP_BASE}/new`)
  const newBody = await newRes.json()
  assert.match(newBody.room, /^[A-HJ-NP-Z2-9]{6}$/, '/new returns a 6-char code')
  console.log(`✓ /new minted room code ${newBody.room}`)

  // --- Task 3: room isolation (two different codes = independent games) ---
  const roomA = makeCode()
  const roomB = makeCode()
  const a1 = await connect('A1', roomA)
  const b1 = await connect('B1', roomB)
  a1.send({ type: 'join', name: 'A1' })
  b1.send({ type: 'join', name: 'B1' })
  const sa = await a1.next(isState)
  const sb = await b1.next(isState)
  assert.equal(sa.state.roomCode, roomA)
  assert.equal(sb.state.roomCode, roomB)
  assert.equal(sa.state.players[0].name, 'A1')
  assert.equal(sb.state.players[0].name, 'B1', 'rooms do not share state')
  console.log('✓ room isolation: two codes are independent games')

  // --- Task 3: rejoin-resume (same code+name reclaims slot & gets state) ---
  const roomC = makeCode()
  const c1 = await connect('Carol', roomC)
  const c2 = await connect('Dave', roomC)
  c1.send({ type: 'join', name: 'Carol' })
  await c1.next(isState)
  c2.send({ type: 'join', name: 'Dave' })
  await c2.next((m) => isState(m) && m.you === 1)
  c1.send({ type: 'start', length: 4 })
  const mid = await c1.next((m) => isState(m) && m.state.phase === 'playing')
  // Carol drops and reconnects with the same code+name.
  c1.close()
  await new Promise((r) => setTimeout(r, 200))
  const c1b = await connect('Carol', roomC)
  c1b.send({ type: 'join', name: 'Carol' })
  const resumed = await c1b.next((m) => isState(m) && m.you === 0)
  assert.equal(resumed.state.phase, 'playing', 'rejoin resumes in-progress game')
  assert.equal(resumed.state.chain[0].word, mid.state.chain[0].word, 'same chain')
  assert.equal(resumed.you, 0, 'Carol reclaims slot 0')
  console.log('✓ rejoin with same code+name resumes the game')

  a1.close()
  b1.close()
  c1b.close()
  c2.close()

  // --- Task: public /rooms lobby lifecycle ---
  const helper = (arr, code) => arr.some((r) => r.code === code)
  const listRooms = async () => {
    const res = await fetch(`${HTTP_BASE}/rooms`)
    const body = await res.json()
    return body.rooms ?? []
  }
  // Small delay helper so best-effort registry writes settle.
  const settle = () => new Promise((r) => setTimeout(r, 150))

  const roomOpen = makeCode()
  const o1 = await connect('Olivia', roomOpen)
  o1.send({ type: 'join', name: 'Olivia' })
  await o1.next(isState)
  await settle()
  let rooms = await listRooms()
  assert.ok(helper(rooms, roomOpen), 'one-player room appears in /rooms')
  const entry = rooms.find((r) => r.code === roomOpen)
  assert.equal(entry.hostName, 'Olivia', 'listing shows host name')
  console.log('✓ waiting room (1 player) is listed in /rooms')

  // Second player joins => room should be delisted.
  const o2 = await connect('Oscar', roomOpen)
  o2.send({ type: 'join', name: 'Oscar' })
  await o2.next((m) => isState(m) && m.you === 1)
  await settle()
  rooms = await listRooms()
  assert.ok(!helper(rooms, roomOpen), 'full room is delisted from /rooms')
  console.log('✓ room delisted once a second player joins')

  // A fresh one-player room that then leaves => delisted.
  const roomLeave = makeCode()
  const l1 = await connect('Liam', roomLeave)
  l1.send({ type: 'join', name: 'Liam' })
  await l1.next(isState)
  await settle()
  assert.ok(helper(await listRooms(), roomLeave), 'room listed before leave')
  l1.send({ type: 'leave' })
  await settle()
  assert.ok(!helper(await listRooms(), roomLeave), 'room delisted after host leaves')
  console.log('✓ room delisted after the host leaves')

  o1.close()
  o2.close()

  // --- timeout: current player loses if they don't move within 15s ---
  console.log('… waiting up to ~16s to verify turn timeout (server-authoritative)')
  const roomT = makeCode()
  const t1 = await connect('Tina', roomT)
  const t2 = await connect('Tom', roomT)
  t1.send({ type: 'join', name: 'Tina' })
  await t1.next(isState)
  t2.send({ type: 'join', name: 'Tom' })
  await t2.next((m) => isState(m) && m.you === 1)
  t1.send({ type: 'start', length: 4 })
  await t1.next((m) => isState(m) && m.state.phase === 'playing')
  // Neither player moves. P1 (current) should time out and lose.
  const timedOut = await t1.next(
    (m) => isState(m) && m.state.phase === 'gameover'
  )
  assert.equal(timedOut.state.lossReason, 'timeout', 'loss reason is timeout')
  assert.equal(timedOut.state.winner, 1, 'opponent (P2) wins on timeout')
  console.log('✓ turn timeout ends game, opponent wins (reason: timeout)')
  t1.close()
  t2.close()

  p1.close()
  p2.close()
  console.log('\nALL WS INTEGRATION ASSERTIONS PASSED')
  process.exit(0)
}

main().catch((e) => {
  console.error('WS INTEGRATION FAILED:', e?.message ?? e)
  process.exit(1)
})
