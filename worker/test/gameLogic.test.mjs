import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// gameLogic is authored as plain ESM (.mjs) so the Worker bundle and these
// Node tests share one implementation — no transpile step, no duplicate logic.
import { singleDiffIndex, validateMove } from '../src/gameLogic.mjs'

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
