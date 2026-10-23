/**
 * partyProtocol.ts — JSON message protocol for PARTY mode (3-10 players),
 * shared between the PartyRoomDurableObject and the browser client.
 *
 * Kept separate from protocol.ts (the frozen 2-player duel protocol). The key
 * structural difference: players are identified by a STABLE string `id`, not a
 * numeric 0|1 index, because seating is fixed but players get eliminated and an
 * index-based identity would be ambiguous once the roster has gaps.
 */
import type { LossReason, WordLength } from './gameLogic'

/** Min/max roster size for a party match. */
export const PARTY_MIN_PLAYERS = 3
export const PARTY_MAX_PLAYERS = 10

export type PartyPhase = 'waiting' | 'playing' | 'gameover'

export interface PartyPlayerPublic {
  /** Stable identity assigned on first join; survives elimination. */
  id: string
  name: string
  connected: boolean
  /** True once this player broke the chain / timed out / resigned. */
  eliminated: boolean
  /** Why they were eliminated, if they were. */
  lossReason: LossReason | null
  /**
   * Final placement once eliminated or won: 1 = winner, 2 = runner-up, etc.
   * null while still active (and for everyone until someone is out).
   */
  placement: number | null
}

export interface PartyChainEntry {
  word: string
  /** id of the player who played this word, or null for the seed word. */
  by: string | null
  changedIndex: number | null
}

/** A failed attempt (broken chain / timeout / resign), shown in red. */
export interface PartyFailedEntry {
  /** The attempted word, or '' for wordless failures (timeout/resign). */
  word: string
  /** id of the player who failed. */
  by: string | null
  changedIndex: number | null
  lossReason: LossReason
}

/**
 * What the final loser could have played — valid neighbors of the last board
 * word. Populated at game over (tied to the decisive elimination) unless that
 * elimination was a resign; null otherwise.
 */
export interface PartyMissedWords {
  fromWord: string
  words: string[]
  allUsed: boolean
}

/** Authoritative snapshot broadcast to every connected client. */
export interface PartyGameState {
  phase: PartyPhase
  length: WordLength
  /** Fixed seating order (join order). Eliminated players stay in the list. */
  players: PartyPlayerPublic[]
  /** id of the player whose turn it is, or null when not playing. */
  currentId: string | null
  chain: PartyChainEntry[]
  /** Failed attempts across the match, in order, for red history entries. */
  failedAttempts: PartyFailedEntry[]
  /** Missed moves for the decisive (final) loss, else null. */
  missedWords: PartyMissedWords | null
  /** id of the sole survivor once the game is over, else null. */
  winnerId: string | null
  roomCode: string
  maxPlayers: number
  /** Epoch ms when the current player's turn times out, or null. */
  turnEndsAt: number | null
}

/* ---- Client -> Server ---- */
export type PartyClientMsg =
  | { type: 'join'; name: string }
  | { type: 'start'; length: WordLength }
  | { type: 'move'; word: string }
  | { type: 'rematch' }
  | { type: 'resign' }
  | { type: 'leave' }

/* ---- Server -> Client ---- */
export type PartyServerMsg =
  | { type: 'state'; state: PartyGameState; you: string | null }
  | { type: 'error'; reason: string }
  | { type: 'full' }
  /** Sent when a late joiner tries to enter a match already in progress. */
  | { type: 'in-progress' }
