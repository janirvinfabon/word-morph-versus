<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRuntimeConfig } from '#imports'
import { useGameSession } from '~/composables/useGameSession'
import { useWordMorph } from '~/composables/useWordMorph'
import {
  PARTY_MIN_PLAYERS,
  PARTY_MAX_PLAYERS,
  type WordLength
} from '~/composables/usePartyGame'

const session = useGameSession()
const party = session.party
const wordMorph = useWordMorph()
const config = useRuntimeConfig()
const wsBase = config.public.wsUrl as string

const recentNames = wordMorph.loadRecentPlayers()
const name = ref(recentNames[0] ?? '')
const length = ref<WordLength>(4)
const busy = ref(false)
const localError = ref('')
/** Party code from an invite link (?party=CODE), if any. */
const invitedCode = ref('')

/**
 * Join a party and PERSIST the player's name (so it survives New Game / Back to
 * the mode screen and pre-fills next time). All join paths go through here.
 */
function joinAndRemember(code: string) {
  wordMorph.rememberPlayers([name.value])
  party.joinRoom({ wsBase, room: code.toUpperCase(), name: name.value })
}

interface OpenRoom {
  code: string
  hostName: string
  length: WordLength
  playerCount?: number
  maxPlayers?: number
}
const httpBase = wsBase.replace(/^ws/, 'http').replace(/\/$/, '')
const openRooms = ref<OpenRoom[]>([])
const roomsLoading = ref(false)

async function refreshRooms() {
  roomsLoading.value = true
  try {
    const res = await fetch(`${httpBase}/party/rooms`)
    const body = (await res.json()) as { rooms: OpenRoom[] }
    openRooms.value = Array.isArray(body.rooms) ? body.rooms : []
  } catch {
    openRooms.value = []
  } finally {
    roomsLoading.value = false
  }
}

function joinOpenRoom(code: string) {
  if (!validName()) return
  joinAndRemember(code)
}

const joined = computed(() => !!party.state.server && party.state.you !== null)
const roomCode = computed(() => party.state.server?.roomCode ?? '')
const youAreHost = computed(() => party.youAreHost.value)
const playerCount = computed(() => party.playerCount.value)
const canStart = computed(() => party.canStart.value)
const roster = computed(() => party.state.server?.players ?? [])

const shareLink = computed(() => {
  if (typeof window === 'undefined' || !roomCode.value) return ''
  const u = new URL(window.location.href)
  u.searchParams.set('party', roomCode.value)
  return u.toString()
})

const lengths: { value: WordLength; label: string }[] = [
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' }
]

function validName(): boolean {
  if (!name.value.trim()) {
    localError.value = 'Enter your name first.'
    return false
  }
  localError.value = ''
  return true
}

async function createRoom() {
  if (!validName()) return
  busy.value = true
  try {
    const code = await party.createRoomCode(wsBase)
    joinAndRemember(code)
  } catch (e) {
    localError.value = e instanceof Error ? e.message : 'Could not create room.'
  } finally {
    busy.value = false
  }
}

/** Join the party from an invite link (?party=CODE). */
function joinInvited() {
  if (!validName()) return
  joinAndRemember(invitedCode.value)
}

function startMatch() {
  party.startGame({ length: length.value })
}

function leaveRoom() {
  party.leave()
  void refreshRooms()
}

const copied = ref(false)
async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareLink.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* clipboard unavailable */
  }
}

/** Alternating accent for the roster tiles (static classes for Tailwind JIT). */
function accentClasses(i: number): { border: string; text: string } {
  return i % 2 === 0
    ? { border: 'border-arcade-p1/40', text: 'text-arcade-p1' }
    : { border: 'border-arcade-p2/40', text: 'text-arcade-p2' }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    const code = new URL(window.location.href).searchParams.get('party')
    if (code) {
      invitedCode.value = code.toUpperCase()
      if (name.value.trim()) {
        joinAndRemember(invitedCode.value)
      }
    }
  }
  void refreshRooms()
})
</script>

<template>
  <div class="mx-auto w-full max-w-xl">
    <div class="panel p-6 sm:p-8">
      <button
        class="mb-4 text-xs text-slate-400 hover:text-slate-200"
        @click="session.clearMode()"
      >
        ← Back
      </button>

      <!-- Pre-join: name + create/join -->
      <template v-if="!joined">
        <h2 class="mb-1 text-center text-2xl font-extrabold">🎉 Party mode</h2>
        <p class="mb-6 text-center text-sm text-slate-400">
          {{ PARTY_MIN_PLAYERS }}–{{ PARTY_MAX_PLAYERS }} players. Break the chain and
          you're out — last one standing wins.
        </p>

        <label class="block">
          <span class="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-400"
            >Your name</span
          >
          <input
            v-model="name"
            maxlength="16"
            placeholder="Your name"
            class="w-full rounded-xl border-2 border-white/15 bg-arcade-bg/70 px-4 py-3 font-bold
                   text-slate-100 outline-none focus:border-arcade-p2 focus:ring-4
                   focus:ring-arcade-p2/30"
          />
        </label>

        <button
          class="btn-pink mt-5 w-full"
          :disabled="busy || party.state.status === 'connecting'"
          @click="createRoom"
        >
          {{ busy ? 'Creating…' : '✨ Create a party' }}
        </button>

        <!-- Invite link: join the shared party directly (no code entry needed) -->
        <div
          v-if="invitedCode"
          class="mt-4 rounded-xl border border-arcade-p1/30 bg-arcade-p1/5 p-3 text-center"
        >
          <p class="text-xs text-slate-400">You were invited to party</p>
          <p class="font-mono text-xl font-black tracking-[0.3em] text-arcade-gold">
            {{ invitedCode }}
          </p>
          <button class="btn-primary mt-2 w-full" @click="joinInvited">Join this party</button>
        </div>

        <p v-if="localError || party.state.error" class="mt-4 text-center text-sm text-arcade-bad">
          {{ localError || party.state.error }}
        </p>

        <!-- Open parties browser -->
        <div class="mt-7">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-widest text-slate-400">
              Open parties
            </span>
            <button
              class="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
              :disabled="roomsLoading"
              @click="refreshRooms"
            >
              {{ roomsLoading ? 'Refreshing…' : '↻ Refresh' }}
            </button>
          </div>

          <ul v-if="openRooms.length" class="flex flex-col gap-2">
            <li
              v-for="r in openRooms"
              :key="r.code"
              class="flex items-center justify-between rounded-xl border border-white/10
                     bg-arcade-bg/50 px-3 py-2"
            >
              <div class="min-w-0">
                <div class="truncate text-sm font-bold text-slate-100">
                  {{ r.hostName }}'s party
                </div>
                <div class="text-[11px] text-slate-500">
                  <span class="font-mono tracking-widest">{{ r.code }}</span>
                  · {{ r.length }} letters ·
                  <span class="text-slate-400">{{ r.playerCount ?? 1 }}/{{ r.maxPlayers ?? PARTY_MAX_PLAYERS }}</span>
                </div>
              </div>
              <button class="btn-primary whitespace-nowrap text-xs" @click="joinOpenRoom(r.code)">
                Join
              </button>
            </li>
          </ul>
          <p v-else class="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-500">
            No open parties right now. Create one above!
          </p>
        </div>
      </template>

      <!-- Joined: waiting room -->
      <template v-else>
        <h2 class="text-center text-sm font-bold uppercase tracking-[0.3em] text-slate-400">
          Party room
        </h2>
        <p class="text-center font-mono text-4xl font-black tracking-[0.3em] text-arcade-gold">
          {{ roomCode }}
        </p>

        <div class="mt-4 flex items-center gap-2">
          <input
            :value="shareLink"
            readonly
            class="w-full truncate rounded-xl border border-white/10 bg-arcade-bg/70 px-3 py-2
                   text-xs text-slate-300"
          />
          <button class="btn-ghost whitespace-nowrap text-xs" @click="copyLink">
            {{ copied ? '✓ Copied' : 'Copy link' }}
          </button>
        </div>

        <!-- Roster -->
        <div class="mt-6 flex items-center justify-between">
          <span class="text-xs font-bold uppercase tracking-widest text-slate-400">Players</span>
          <span class="text-xs font-bold tabular-nums text-slate-300">
            {{ playerCount }}/{{ PARTY_MAX_PLAYERS }}
          </span>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div
            v-for="(p, i) in roster"
            :key="p.id"
            class="rounded-xl border-2 p-2.5 text-center"
            :class="[
              accentClasses(i).border,
              p.connected ? '' : 'opacity-50'
            ]"
          >
            <div class="truncate text-sm font-extrabold" :class="accentClasses(i).text">
              {{ p.name }}
            </div>
            <div class="mt-0.5 text-[10px] uppercase tracking-widest text-slate-500">
              {{ i === 0 ? 'Host' : `Seat ${i + 1}` }}{{ party.state.you === p.id ? ' · you' : '' }}
            </div>
          </div>
        </div>

        <!-- Host start controls -->
        <div v-if="youAreHost" class="mt-6">
          <span class="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400"
            >Word length</span
          >
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="opt in lengths"
              :key="opt.value"
              class="rounded-xl border-2 py-3 text-lg font-extrabold transition-all"
              :class="
                length === opt.value
                  ? 'border-arcade-gold bg-arcade-gold/10 text-arcade-gold'
                  : 'border-white/10 bg-white/5 text-slate-300'
              "
              @click="length = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
          <button class="btn-gold mt-5 w-full" :disabled="!canStart" @click="startMatch">
            {{
              canStart
                ? '🎉 Start Party'
                : `Need ${PARTY_MIN_PLAYERS}+ players (${playerCount}/${PARTY_MIN_PLAYERS})`
            }}
          </button>
        </div>
        <p v-else class="mt-6 text-center text-sm text-slate-400">
          Waiting for the host to start the party…
        </p>

        <p v-if="party.state.error" class="mt-4 text-center text-sm text-arcade-bad">
          {{ party.state.error }}
        </p>

        <button
          class="mt-6 w-full text-xs text-slate-400 hover:text-arcade-bad"
          @click="leaveRoom"
        >
          ← Leave party
        </button>
      </template>
    </div>
  </div>
</template>
