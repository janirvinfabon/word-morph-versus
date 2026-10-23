/// <reference types="@cloudflare/workers-types" />
import { RoomDurableObject, type Env as RoomEnv } from './RoomDurableObject'
import { PartyRoomDurableObject } from './PartyRoomDurableObject'
import { LobbyRegistry } from './LobbyRegistry'

export { RoomDurableObject, PartyRoomDurableObject, LobbyRegistry }

/** Worker env: the duel room, the party room, and the shared lobby registry. */
interface Env extends RoomEnv {
  PARTY_ROOM: DurableObjectNamespace
}

/**
 * Room codes: 6 chars from an unambiguous alphabet (no 0/O/1/I/L) so they are
 * easy to read aloud and type. Used for both /new generation and validation.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LEN = 6
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LEN}}$`)

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return out
}

function normalizeCode(raw: string): string {
  // Uppercase and map easily-confused characters onto the canonical alphabet.
  return (raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .slice(0, CODE_LEN)
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS }
  })
}

/** A lobby registry entry. `mode` distinguishes duel ('duel'/undefined) vs party. */
interface RegistryEntry {
  code: string
  hostName: string
  length: number
  createdAt: number
  mode?: 'duel' | 'party'
  playerCount?: number
  maxPlayers?: number
}

/** Fetch the global registry listing and return entries matching `keep`. */
async function listRooms(
  env: Env,
  keep: (entry: RegistryEntry) => boolean
): Promise<Response> {
  const id = env.REGISTRY.idFromName('global')
  const stub = env.REGISTRY.get(id)
  const res = await stub.fetch('https://registry/list')
  const body = (await res.json()) as { rooms?: RegistryEntry[] }
  const rooms = (body.rooms ?? []).filter(keep)
  return json({ rooms })
}

/**
 * Validate a (normalized) room code and that the request is a WS upgrade.
 * Returns an error Response if invalid, or null if the request is good.
 */
function validateRoomCode(room: string, request: Request): Response | null {
  if (!CODE_RE.test(room)) {
    return new Response('Invalid or missing room code', {
      status: 400,
      headers: CORS
    })
  }
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket upgrade', {
      status: 426,
      headers: CORS
    })
  }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    // Mint a fresh, valid room code for the "Create room" flow (duel + party).
    if (url.pathname === '/new' || url.pathname === '/party/new') {
      return json({ room: generateCode() })
    }

    // Public list of DUEL rooms waiting for a second player.
    if (url.pathname === '/rooms') {
      return listRooms(env, (entry) => entry.mode !== 'party')
    }

    // Public list of PARTY rooms still waiting to start.
    if (url.pathname === '/party/rooms') {
      return listRooms(env, (entry) => entry.mode === 'party')
    }

    // Duel WebSocket endpoint: /ws?room=CODE
    if (url.pathname === '/ws') {
      const room = normalizeCode(url.searchParams.get('room') ?? '')
      const bad = validateRoomCode(room, request)
      if (bad) return bad
      const id = env.ROOM.idFromName(room)
      return env.ROOM.get(id).fetch(request)
    }

    // Party WebSocket endpoint: /party/ws?room=CODE
    if (url.pathname === '/party/ws') {
      const room = normalizeCode(url.searchParams.get('room') ?? '')
      const bad = validateRoomCode(room, request)
      if (bad) return bad
      const id = env.PARTY_ROOM.idFromName(room)
      return env.PARTY_ROOM.get(id).fetch(request)
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'word-morph-worker' })
    }

    return new Response('Not found', { status: 404, headers: CORS })
  }
} satisfies ExportedHandler<Env>
