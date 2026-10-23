export type WordLength = 4 | 5 | 6
export type PlayerIndex = 0 | 1

export const TURN_MS: number

export type LossReason =
  | 'invalid-word'
  | 'not-single-change'
  | 'repeat'
  | 'resign'
  | 'disconnect'
  | 'timeout'

export interface ValidateResult {
  ok: boolean
  reason?: string
  loss?: LossReason
  changedIndex?: number
}

export function singleDiffIndex(a: string, b: string): number

export function validateMove(
  current: string,
  candidate: string,
  used: Set<string>,
  dict: Set<string>,
  length: number
): ValidateResult

export function hasAnyNeighbor(word: string, dict: Set<string>): boolean

export interface NeighborResult {
  /** Valid single-letter neighbors (capped), preferring unused words. */
  words: string[]
  /** True when the only neighbors that exist were already played. */
  allUsed: boolean
}

export function findNeighbors(
  word: string,
  dict: Set<string>,
  used: Set<string>,
  limit?: number
): NeighborResult

export function pickStartWord(list: string[], dict: Set<string>): string
