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

export type Phase = 'waiting' | 'playing' | 'gameover'

/** The authoritative snapshot broadcast to clients. */
export interface GameState {
  phase: Phase
  length: WordLength
  players: PlayerPublic[]
  current: PlayerIndex
  chain: ChainEntry[]
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
