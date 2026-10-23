/**
 * ws-party.mjs — integration driver for PARTY mode (3-10 players). Connects
 * several WebSocket clients to one party room against a running Worker
 * (wrangler dev) and plays an elimination match, asserting the broadcast
 * `state` payloads reflect correct turn order, elimination, and last-standing.
 *
 * Usage: node test/ws-party.mjs [ws://127.0.0.1:8787]
 * Exit code 0 = all assertions passed.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.argv[2] ?? 'ws://127.0.0.1:8787'
const HTTP_BASE = BASE.replace(/^ws/, 'http')

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function makeCode() {
  let c = ''
  for (let i = 0; i < 6; i++) {
    c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return c
}

function connect(name, room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}/party/ws?room=${room}`)
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
      next: (pred) =>
        new Promise((res) => {
          const take = (m) => {
            if (!pred || pred(m)) res(m)
            else waiters.unshift(wrap)
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

/** An intentionally illegal "two letters changed" word for a given base. */
function twoLetterBad(word) {
  const a = word[0] === 'Z' ? 'Q' : 'Z'
  const b = word[1] === 'Z' ? 'Q' : 'Z'
  return a + b + word.slice(2)
}

async function main() {
  const ROOM = makeCode()
  console.log(`Party room: ${ROOM}  Base: ${BASE}`)
  const dict4 = loadWords(4)

  // --- three players join; all get ids and seating order ---
  const p1 = await connect('Alice', ROOM)
  const p2 = await connect('Bob', ROOM)
  const p3 = await connect('Carol', ROOM)

  p1.send({ type: 'join', name: 'Alice' })
  let s1 = await p1.next(isState)
  assert.ok(s1.you, 'P1 receives a stable id')
  assert.equal(s1.state.players.length, 1)
  assert.equal(s1.state.maxPlayers, 10, 'maxPlayers reported as 10')

  p2.send({ type: 'join', name: 'Bob' })
  await p2.next((m) => isState(m) && m.state.players.length === 2)
  p3.send({ type: 'join', name: 'Carol' })
  const s3 = await p3.next((m) => isState(m) && m.state.players.length === 3)
  assert.equal(s3.state.players.map((p) => p.name).join(','), 'Alice,Bob,Carol')
  console.log('✓ three players joined in seating order')

  // --- min-players gate: starting with < 3 is rejected is implicitly covered;
  //     here we have exactly 3, so host can start ---
  // non-host cannot start
  p2.send({ type: 'start', length: 4 })
  const notHost = await p2.next((m) => m.type === 'error')
  assert.match(notHost.reason, /host/i, 'only host can start')
  console.log('✓ non-host cannot start the match')

  // --- host starts ---
  p1.send({ type: 'start', length: 4 })
  const started = await p1.next((m) => isState(m) && m.state.phase === 'playing')
  assert.equal(started.state.chain.length, 1, 'chain seeded')
  assert.equal(started.state.currentId, s1.you, 'host (seat 0) moves first')
  assert.ok(started.state.turnEndsAt, 'turn timer armed')
  console.log(`✓ host started on "${started.state.chain[0].word}", P1 to move`)

  const ids = started.state.players.map((p) => p.id)
  const [idA, idB, idC] = ids

  // --- a valid move advances to the next active player (P2) ---
  const used = new Set([started.state.chain[0].word])
  const seed = started.state.chain[0].word
  const n1 = findNeighbor(seed, dict4, used)
  assert.ok(n1, 'seed has a neighbor')
  p1.send({ type: 'move', word: n1 })
  const adv = await p1.next((m) => isState(m) && m.state.chain.length === 2)
  assert.equal(adv.state.chain[1].by, idA, 'move attributed to P1 id')
  assert.equal(adv.state.currentId, idB, 'turn advanced to P2')
  used.add(n1)
  console.log('✓ valid move advances turn to the next player')

  // --- P2 makes an ILLEGAL move => P2 eliminated, NOT game over; turn -> P3 ---
  const cur = adv.state.chain[adv.state.chain.length - 1].word
  p2.send({ type: 'move', word: twoLetterBad(cur) })
  const afterElim = await p3.next(
    (m) => isState(m) && m.state.players.find((p) => p.id === idB)?.eliminated
  )
  assert.equal(afterElim.state.phase, 'playing', 'still playing after 1 elimination')
  const bRec = afterElim.state.players.find((p) => p.id === idB)
  assert.equal(bRec.eliminated, true, 'P2 eliminated')
  assert.equal(bRec.lossReason, 'not-single-change', 'elimination reason recorded')
  assert.equal(bRec.placement, 3, 'first eliminated of 3 places 3rd')
  assert.equal(afterElim.state.currentId, idC, 'turn passes to P3 (skipping P2)')
  console.log('✓ illegal move eliminates the mover, turn skips them, game continues')

  // --- the failed word is recorded (in red) with the attempting player's id ---
  assert.ok(
    Array.isArray(afterElim.state.failedAttempts),
    'failedAttempts present in state'
  )
  const fail = afterElim.state.failedAttempts.at(-1)
  assert.ok(fail, 'a failed attempt was recorded')
  assert.equal(fail.by, idB, 'failed attempt attributed to P2')
  assert.equal(fail.lossReason, 'not-single-change', 'failed reason recorded')
  assert.ok(fail.word.length > 0, 'the attempted (bad) word is captured')
  console.log('✓ failed word recorded with player + reason for red history')

  // --- P3 plays a valid move; chain continues from the current word ---
  const cur2 = afterElim.state.chain[afterElim.state.chain.length - 1].word
  const n2 = findNeighbor(cur2, dict4, used)
  if (n2) {
    p3.send({ type: 'move', word: n2 })
    const adv2 = await p3.next((m) => isState(m) && m.state.chain.length === 3)
    // Only P1 and P3 remain active; after P3 it should wrap back to P1.
    assert.equal(adv2.state.currentId, idA, 'turn wraps to P1 (P2 skipped)')
    used.add(n2)
    console.log('✓ chain continues; eliminated player is skipped in rotation')
  }

  // --- P1 resigns => P1 eliminated; only P3 remains => P3 WINS ---
  p1.send({ type: 'resign' })
  const over = await p3.next((m) => isState(m) && m.state.phase === 'gameover')
  assert.equal(over.state.winnerId, idC, 'last player standing (P3) wins')
  const cWin = over.state.players.find((p) => p.id === idC)
  const aLose = over.state.players.find((p) => p.id === idA)
  assert.equal(cWin.placement, 1, 'winner placement is 1')
  assert.equal(aLose.placement, 2, 'second-to-last eliminated places 2nd')
  assert.equal(aLose.lossReason, 'resign', 'resign recorded as loss reason')
  console.log('✓ last player standing wins; podium placements assigned (1/2/3)')

  // --- the decisive loss here was a RESIGN, so missedWords must be null ---
  assert.equal(
    over.state.missedWords,
    null,
    'missedWords is null when the game ended on a resign'
  )
  console.log('✓ missedWords suppressed on a resign finish')

  // --- rematch resets elimination for all three ---
  p1.send({ type: 'rematch' })
  const re = await p1.next(
    (m) => isState(m) && m.state.phase === 'playing' && m.state.chain.length === 1
  )
  assert.ok(re.state.players.every((p) => !p.eliminated), 'all players active again')
  assert.equal(re.state.players.every((p) => p.placement === null), true)
  assert.equal(re.state.winnerId, null)
  console.log('✓ rematch clears eliminations and restarts')

  p1.close()
  p2.close()
  p3.close()

  // --- late joiner rejected once a match is in progress ---
  const ROOM2 = makeCode()
  const q1 = await connect('Dan', ROOM2)
  const q2 = await connect('Eve', ROOM2)
  const q3 = await connect('Finn', ROOM2)
  q1.send({ type: 'join', name: 'Dan' })
  await q1.next(isState)
  q2.send({ type: 'join', name: 'Eve' })
  await q2.next((m) => isState(m) && m.state.players.length === 2)
  q3.send({ type: 'join', name: 'Finn' })
  await q3.next((m) => isState(m) && m.state.players.length === 3)
  q1.send({ type: 'start', length: 4 })
  await q1.next((m) => isState(m) && m.state.phase === 'playing')

  const late = await connect('Gwen', ROOM2)
  late.send({ type: 'join', name: 'Gwen' })
  const rej = await late.next((m) => m.type === 'in-progress')
  assert.equal(rej.type, 'in-progress', 'late joiner rejected while playing')
  console.log('✓ late joiner rejected once the match has started')
  late.close()

  // --- min-players gate: a 2-player room cannot start ---
  q3.send({ type: 'leave' }) // doesn't matter; make a fresh waiting room
  const ROOM3 = makeCode()
  const r1 = await connect('Hank', ROOM3)
  const r2 = await connect('Ivy', ROOM3)
  r1.send({ type: 'join', name: 'Hank' })
  await r1.next(isState)
  r2.send({ type: 'join', name: 'Ivy' })
  await r2.next((m) => isState(m) && m.state.players.length === 2)
  r1.send({ type: 'start', length: 4 })
  const gate = await r1.next((m) => m.type === 'error')
  assert.match(gate.reason, /at least 3/i, 'cannot start with fewer than 3 players')
  console.log('✓ min-players gate: cannot start with only 2 players')

  q1.close()
  q2.close()
  r1.close()
  r2.close()

  // --- /party/new mints a valid code ---
  const newRes = await fetch(`${HTTP_BASE}/party/new`)
  const newBody = await newRes.json()
  assert.match(newBody.room, /^[A-HJ-NP-Z2-9]{6}$/, '/party/new returns a 6-char code')
  console.log(`✓ /party/new minted room code ${newBody.room}`)

  // --- /party/rooms lists a waiting party room (and not duel rooms) ---
  const settle = () => new Promise((r) => setTimeout(r, 200))
  const ROOM4 = makeCode()
  const w1 = await connect('Jade', ROOM4)
  w1.send({ type: 'join', name: 'Jade' })
  await w1.next(isState)
  await settle()
  const listRes = await fetch(`${HTTP_BASE}/party/rooms`)
  const listBody = await listRes.json()
  const found = (listBody.rooms ?? []).find((r) => r.code === ROOM4)
  assert.ok(found, 'waiting party room appears in /party/rooms')
  assert.equal(found.mode, 'party', 'listed with mode=party')
  assert.equal(found.playerCount, 1, 'playerCount reported')
  assert.equal(found.maxPlayers, 10, 'maxPlayers reported')
  console.log('✓ /party/rooms lists waiting party rooms with counts')
  w1.close()

  console.log('\nALL PARTY WS INTEGRATION ASSERTIONS PASSED')
  process.exit(0)
}

main().catch((e) => {
  console.error('PARTY WS INTEGRATION FAILED:', e?.message ?? e)
  process.exit(1)
})
