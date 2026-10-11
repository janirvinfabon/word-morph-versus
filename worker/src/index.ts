/// <reference types="@cloudflare/workers-types" />
import { RoomDurableObject, type Env } from './RoomDurableObject'
import { LobbyRegistry } from './LobbyRegistry'

export { RoomDurableObject, LobbyRegistry }

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    // Mint a fresh, valid room code for the "Create room" flow.
    if (url.pathname === '/new') {
      return json({ room: generateCode() })
    }

    // Public list of rooms waiting for a second player.
    if (url.pathname === '/rooms') {
      const id = env.REGISTRY.idFromName('global')
      const stub = env.REGISTRY.get(id)
      const res = await stub.fetch('https://registry/list')
      const body = await res.text()
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json', ...CORS }
      })
    }

    // WebSocket endpoint: /ws?room=CODE
    if (url.pathname === '/ws') {
      const room = normalizeCode(url.searchParams.get('room') ?? '')

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

      // Route to the single Durable Object instance for this room code.
      const id = env.ROOM.idFromName(room)
      const stub = env.ROOM.get(id)
      return stub.fetch(request)
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'word-morph-worker' })
    }

    return new Response('Not found', { status: 404, headers: CORS })
  }
} satisfies ExportedHandler<Env>
