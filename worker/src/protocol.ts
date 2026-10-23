/**
 * protocol.ts — the JSON message protocol shared between the Worker DO and
 * the browser client. Kept framework-free so it can be referenced by both.
 */
import type { LossReason, PlayerIndex, WordLength } from './gameLogic'

export interface PlayerPublic {
  name: string
  connected: boolean
}

export interface ChainEntry {
  word: string
  by: PlayerIndex | null
  changedIndex: number | null
}

/** A failed attempt (broken chain / timeout / resign), shown in red. */
export interface FailedEntry {
  /** The attempted word, or '' for wordless failures (timeout/resign). */
  word: string
  by: PlayerIndex | null
  changedIndex: number | null
  lossReason: LossReason
}

/**
 * What the losing player could have played — the valid single-letter neighbors
 * of the last board word. Populated at game over for every loss EXCEPT resign;
 * null otherwise.
 */
export interface MissedWords {
  /** The board word they needed to morph. */
  fromWord: string
  /** Valid neighbors (capped), preferring words not already used. */
  words: string[]
  /** True when the only neighbors left had already been played. */
  allUsed: boolean
}

export type Phase = 'waiting' | 'playing' | 'gameover'

/** The authoritative snapshot broadcast to clients. */
export interface GameState {
  phase: Phase
  length: WordLength
  players: PlayerPublic[]
  current: PlayerIndex
  chain: ChainEntry[]
  /** Failed attempts across the match, in order, for red history entries. */
  failedAttempts: FailedEntry[]
  /** Missed moves for the decisive loss (game over only), else null. */
  missedWords: MissedWords | null
  winner: PlayerIndex | null
  lossReason: LossReason | null
  roomCode: string
  /** Epoch ms when the current player's turn times out, or null if not playing. */
  turnEndsAt: number | null
}

/* ---- Client -> Server ---- */
export type ClientMsg =
  | { type: 'join'; name: string }
  | { type: 'start'; length: WordLength }
  | { type: 'move'; word: string }
  | { type: 'rematch' }
  | { type: 'resign' }
  | { type: 'leave' }

/* ---- Server -> Client ---- */
export type ServerMsg =
  | { type: 'state'; state: GameState; you: PlayerIndex | null }
  | { type: 'error'; reason: string }
  | { type: 'full' }
