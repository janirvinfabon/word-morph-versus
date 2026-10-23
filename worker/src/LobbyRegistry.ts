/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers'
import type { WordLength } from './gameLogic'

/**
 * LobbyRegistry — a single global Durable Object that tracks rooms currently
 * WAITING for a second player, so a public "open rooms" list can be shown.
 *
 * Rooms register themselves when they enter the waiting state (1 player) and
 * deregister when they fill, end, or empty. Entries are also pruned if they
 * go stale (host left without a clean deregister).
 *
 * Addressed via a fixed name (idFromName('global')) so there is exactly one.
 */

export interface RoomEntry {
  code: string
  hostName: string
  length: WordLength
  createdAt: number
  /** 'party' for 3-10 player rooms; absent/undefined for 2-player duels. */
  mode?: 'duel' | 'party'
  /** Party only: current roster size and the cap, for "N/10" displays. */
  playerCount?: number
  maxPlayers?: number
}

/** Stale entries older than this (ms) are dropped from listings. */
const STALE_MS = 20 * 60 * 1000 // 20 minutes

export interface RegistryEnv {
  // The registry itself does not need other bindings.
  [key: string]: unknown
}

export class LobbyRegistry extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    if (method === 'POST' && url.pathname === '/register') {
      const entry = (await request.json()) as RoomEntry
      await this.register(entry)
      return new Response(null, { status: 204 })
    }

    if (method === 'POST' && url.pathname === '/deregister') {
      const { code } = (await request.json()) as { code: string }
      await this.deregister(code)
      return new Response(null, { status: 204 })
    }

    if (method === 'GET' && url.pathname === '/list') {
      const rooms = await this.list()
      return new Response(JSON.stringify({ rooms }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }

    return new Response('Not found', { status: 404 })
  }

  async register(entry: RoomEntry) {
    if (!entry?.code) return
    await this.ctx.storage.put(`room:${entry.code}`, {
      code: entry.code,
      hostName: entry.hostName,
      length: entry.length,
      createdAt: entry.createdAt || Date.now(),
      mode: entry.mode ?? 'duel',
      playerCount: entry.playerCount,
      maxPlayers: entry.maxPlayers
    } satisfies RoomEntry)
  }

  async deregister(code: string) {
    if (!code) return
    await this.ctx.storage.delete(`room:${code}`)
  }

  async list(): Promise<RoomEntry[]> {
    const map = await this.ctx.storage.list<RoomEntry>({ prefix: 'room:' })
    const now = Date.now()
    const rooms: RoomEntry[] = []
    const stale: string[] = []
    for (const [key, entry] of map) {
      if (now - entry.createdAt > STALE_MS) {
        stale.push(key)
        continue
      }
      rooms.push(entry)
    }
    // Opportunistically prune stale entries.
    if (stale.length) await this.ctx.storage.delete(stale)
    // Newest first.
    rooms.sort((a, b) => b.createdAt - a.createdAt)
    return rooms
  }
}
