import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// gameLogic is authored as plain ESM (.mjs) so the Worker bundle and these
// Node tests share one implementation — no transpile step, no duplicate logic.
import { singleDiffIndex, validateMove, findNeighbors } from '../src/gameLogic.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const words4 = new Set(
  JSON.parse(readFileSync(join(__dirname, '../src/words/words-4.json'), 'utf8'))
)

test('singleDiffIndex: single change returns index', () => {
  assert.equal(singleDiffIndex('FALL', 'HALL'), 0)
  assert.equal(singleDiffIndex('HALL', 'HALT'), 3)
  assert.equal(singleDiffIndex('HALT', 'HALF'), 3)
  assert.equal(singleDiffIndex('HALF', 'CALF'), 0)
})

test('singleDiffIndex: identical => -1', () => {
  assert.equal(singleDiffIndex('CALF', 'CALF'), -1)
})

test('singleDiffIndex: multi-change => -2', () => {
  assert.equal(singleDiffIndex('FALL', 'HELP'), -2)
})

test('singleDiffIndex: length mismatch => -2', () => {
  assert.equal(singleDiffIndex('FALL', 'FALLS'), -2)
})

test('validateMove: full FALL chain is valid', () => {
  const used = new Set(['FALL'])
  const steps = [
    ['FALL', 'HALL'],
    ['HALL', 'HALT'],
    ['HALT', 'HALF'],
    ['HALF', 'CALF']
  ]
  for (const [cur, next] of steps) {
    const r = validateMove(cur, next, used, words4, 4)
    assert.equal(r.ok, true, `${cur}->${next} should be valid`)
    used.add(next)
  }
})

test('validateMove: CALF->CARF single-diff but not a word => invalid-word', () => {
  const r = validateMove('CALF', 'CARF', new Set(['CALF']), words4, 4)
  assert.equal(r.ok, false)
  assert.equal(r.loss, 'invalid-word')
})

test('validateMove: identical => not-single-change', () => {
  const r = validateMove('CALF', 'CALF', new Set(['CALF']), words4, 4)
  assert.equal(r.ok, false)
  assert.equal(r.loss, 'not-single-change')
})

test('validateMove: multi-change => not-single-change', () => {
  const r = validateMove('FALL', 'HELP', new Set(['FALL']), words4, 4)
  assert.equal(r.ok, false)
  assert.equal(r.loss, 'not-single-change')
})

test('validateMove: repeat => repeat', () => {
  const r = validateMove('HALL', 'FALL', new Set(['FALL', 'HALL']), words4, 4)
  assert.equal(r.ok, false)
  assert.equal(r.loss, 'repeat')
})

test('validateMove: wrong length => not-single-change', () => {
  const r = validateMove('FALL', 'FALLS', new Set(['FALL']), words4, 4)
  assert.equal(r.ok, false)
  assert.equal(r.loss, 'not-single-change')
})

test('findNeighbors: returns valid single-letter neighbors (unused preferred)', () => {
  const { words, allUsed } = findNeighbors('FALL', words4, new Set(['FALL']))
  assert.ok(words.length > 0, 'FALL has neighbors in the dictionary')
  assert.equal(allUsed, false)
  for (const w of words) {
    assert.ok(words4.has(w), `${w} is a real word`)
    assert.equal(
      singleDiffIndex('FALL', w) >= 0,
      true,
      `${w} is a single-letter change from FALL`
    )
  }
})

test('findNeighbors: excludes already-used words', () => {
  // Find a real neighbor of FALL, mark it used, and confirm it is excluded.
  const first = findNeighbors('FALL', words4, new Set(['FALL'])).words[0]
  const { words } = findNeighbors('FALL', words4, new Set(['FALL', first]))
  assert.ok(!words.includes(first), 'used neighbor is excluded from suggestions')
})

test('findNeighbors: falls back to used neighbors when none are fresh', () => {
  // Mark FALL + ALL its neighbors as used; the fallback should list them and
  // flag allUsed = true rather than returning empty.
  const all = findNeighbors('FALL', words4, new Set(['FALL'])).words
  const used = new Set(['FALL', ...findNeighborsAll('FALL', words4)])
  const { words, allUsed } = findNeighbors('FALL', words4, used)
  assert.equal(allUsed, true, 'allUsed is true when only repeats remain')
  assert.ok(words.length > 0, 'fallback still returns the (used) neighbors')
})

/** Helper: every dictionary neighbor of a word (for the fallback test). */
function findNeighborsAll(word, dict) {
  const out = []
  const chars = word.split('')
  for (let i = 0; i < chars.length; i++) {
    const orig = chars[i]
    for (let c = 65; c <= 90; c++) {
      const ch = String.fromCharCode(c)
      if (ch === orig) continue
      chars[i] = ch
      const cand = chars.join('')
      if (dict.has(cand)) out.push(cand)
    }
    chars[i] = orig
  }
  return out
}
