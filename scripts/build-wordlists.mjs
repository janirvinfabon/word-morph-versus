#!/usr/bin/env node
/**
 * build-wordlists.mjs
 *
 * Generates the local word lists for WordMorph from the ENABLE word list
 * (a large, reputable, public-domain word-game dictionary — ~173k words,
 * no proper nouns, American+common spellings).
 *
 * Outputs, for each length in LENGTHS, into /public:
 *   - words-<n>.json   : the FULL validation set (every accepted move).
 *   - starts-<n>.json  : a common-biased subset used only to seed the random
 *                        START word, so matches open on familiar words even
 *                        though any ENABLE word is a legal move.
 *
 * Strategy:
 *  1. Base = ENABLE words of the target length (pure a-z).
 *  2. Prune dead-ends so every kept word has >= 1 single-letter neighbor
 *     inside the final set (guarantees a legal move always exists).
 *  3. starts = (final set) ∩ (google-10000 common words), themselves pruned
 *     to those with a neighbor in the final set. Fallback handled at runtime.
 *  4. Emit uppercase JSON arrays, sorted.
 *
 * Run: node scripts/build-wordlists.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PUBLIC = join(ROOT, 'public')
mkdirSync(PUBLIC, { recursive: true })

const LENGTHS = [4, 5, 6]

// ---- load ENABLE base dictionary -------------------------------------------
const enable = readFileSync(join(__dirname, 'enable.txt'), 'utf8').split('\n')

// ---- load common-word list (for start-word biasing) ------------------------
const commonRaw = readFileSync(join(__dirname, 'common-words.txt'), 'utf8')
const COMMON = new Set(
  commonRaw
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
)

const ALPHA = /^[a-z]+$/

function hasNeighbor(word, pool) {
  const chars = word.split('')
  for (let i = 0; i < chars.length; i++) {
    const orig = chars[i]
    for (let c = 97; c <= 122; c++) {
      const ch = String.fromCharCode(c)
      if (ch === orig) continue
      chars[i] = ch
      if (pool.has(chars.join(''))) {
        chars[i] = orig
        return true
      }
    }
    chars[i] = orig
  }
  return false
}

for (const len of LENGTHS) {
  // 1. candidates of correct length, pure alpha
  let pool = new Set()
  for (const raw of enable) {
    const w = raw.trim()
    if (w.length !== len) continue
    if (!ALPHA.test(w)) continue
    pool.add(w)
  }
  const rawCount = pool.size

  // 2. prune dead-ends (iterate to a fixed point)
  let changed = true
  while (changed) {
    changed = false
    const next = new Set()
    for (const w of pool) {
      if (hasNeighbor(w, pool)) next.add(w)
      else changed = true
    }
    pool = next
  }

  // 3. common-biased start pool: final ∩ common, still having a neighbor.
  const starts = [...pool].filter((w) => COMMON.has(w) && hasNeighbor(w, pool))

  const words = [...pool].map((w) => w.toUpperCase()).sort()
  const startWords = starts.map((w) => w.toUpperCase()).sort()

  writeFileSync(join(PUBLIC, `words-${len}.json`), JSON.stringify(words))
  writeFileSync(join(PUBLIC, `starts-${len}.json`), JSON.stringify(startWords))
  console.log(
    `len${len}: raw ${rawCount} -> words ${words.length}, starts ${startWords.length}`
  )
}
