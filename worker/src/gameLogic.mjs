/**
 * gameLogic.mjs — pure, server-authoritative WordMorph rules.
 *
 * Plain ESM JavaScript so it runs identically under:
 *   - Node's built-in test runner (node --test), and
 *   - the Cloudflare Worker bundle (esbuild via wrangler).
 *
 * Types are provided by the sibling gameLogic.d.ts.
 */

/** Seconds a player has to make each move before they time out and lose. */
export const TURN_MS = 15000

/**
 * Returns the single changed index between two equal-length words, or:
 *   -1  if the words are identical
 *   -2  if more than one position differs (or lengths differ)
 */
export function singleDiffIndex(a, b) {
  if (a.length !== b.length) return -2
  let diff = -1
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (diff !== -1) return -2
      diff = i
    }
  }
  return diff
}

/**
 * Validate a candidate move against the current word and rules.
 * Pure: never mutates inputs. `used` and `dict` are Sets of UPPERCASE words.
 */
export function validateMove(current, candidate, used, dict, length) {
  const next = String(candidate).toUpperCase()

  if (next.length !== length) {
    return {
      ok: false,
      loss: 'not-single-change',
      reason: `Word must be ${length} letters.`
    }
  }
  if (!/^[A-Z]+$/.test(next)) {
    return { ok: false, loss: 'not-single-change', reason: 'Letters A-Z only.' }
  }

  const diff = singleDiffIndex(current, next)
  if (diff === -1) {
    return {
      ok: false,
      loss: 'not-single-change',
      reason: 'You must change exactly one letter.'
    }
  }
  if (diff === -2) {
    return {
      ok: false,
      loss: 'not-single-change',
      reason: 'Change exactly one letter — no more, no less.'
    }
  }
  if (used.has(next)) {
    return { ok: false, loss: 'repeat', reason: 'That word was already played.' }
  }
  if (!dict.has(next)) {
    return { ok: false, loss: 'invalid-word', reason: `"${next}" is not a valid word.` }
  }
  return { ok: true, changedIndex: diff }
}

/** True if `word` has at least one single-letter neighbor present in `dict`. */
export function hasAnyNeighbor(word, dict) {
  const chars = word.split('')
  for (let i = 0; i < chars.length; i++) {
    const orig = chars[i]
    for (let c = 65; c <= 90; c++) {
      const ch = String.fromCharCode(c)
      if (ch === orig) continue
      chars[i] = ch
      if (dict.has(chars.join(''))) {
        chars[i] = orig
        return true
      }
    }
    chars[i] = orig
  }
  return false
}

/** Pick a random start word that is guaranteed to have at least one legal move. */
export function pickStartWord(list, dict) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const w = list[Math.floor(Math.random() * list.length)]
    if (hasAnyNeighbor(w, dict)) return w
  }
  return list[Math.floor(Math.random() * list.length)]
}
