<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRuntimeConfig } from '#imports'
import { useGameSession } from '~/composables/useGameSession'
import { useWordMorph } from '~/composables/useWordMorph'
import type { WordLength } from '~/composables/useOnlineGame'

const session = useGameSession()
const online = session.online
const wordMorph = useWordMorph()
const config = useRuntimeConfig()
const wsBase = config.public.wsUrl as string

// Reuse the hot-seat recent-name persistence.
const recentNames = wordMorph.loadRecentPlayers()

const name = ref(recentNames[0] ?? '')
const codeInput = ref('')
const length = ref<WordLength>(4)
const busy = ref(false)
const localError = ref('')

/**
 * Join a room and PERSIST the player's name (so it survives New Game / Back to
 * the mode screen and pre-fills next time). All join paths go through here.
 */
function joinAndRemember(code: string) {
  wordMorph.rememberPlayers([name.value])
  online.joinRoom({ wsBase, room: code.toUpperCase(), name: name.value })
}

// Public "open rooms" browsing.
interface OpenRoom {
  code: string
  hostName: string
  length: WordLength
  createdAt: number
}
const httpBase = wsBase.replace(/^ws/, 'http').replace(/\/$/, '')
const openRooms = ref<OpenRoom[]>([])
const roomsLoading = ref(false)

async function refreshRooms() {
  roomsLoading.value = true
  try {
    const res = await fetch(`${httpBase}/rooms`)
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

// Whether this client has joined a room yet (server has sent state).
const joined = computed(() => !!online.state.server && online.state.you !== null)
const roomCode = computed(() => online.state.server?.roomCode ?? '')
const bothHere = computed(() => online.bothConnected.value)
const youAreHost = computed(() => online.state.you === 0)

const shareLink = computed(() => {
  if (typeof window === 'undefined' || !roomCode.value) return ''
  const u = new URL(window.location.href)
  u.searchParams.set('room', roomCode.value)
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
    const code = await online.createRoomCode(wsBase)
    joinAndRemember(code)
  } catch (e) {
    localError.value = e instanceof Error ? e.message : 'Could not create room.'
  } finally {
    busy.value = false
  }
}

function joinByCode() {
  if (!validName()) return
  const code = codeInput.value.trim().toUpperCase()
  if (code.length !== 6) {
    localError.value = 'Room codes are 6 characters.'
    return
  }
  joinAndRemember(code)
}

function startMatch() {
  online.startGame({ length: length.value })
}

/** Leave the current room and return to the online lobby's pre-join view. */
function leaveRoom() {
  online.leave()
  // Refresh the open-rooms list since ours (if we were the host) just closed.
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

onMounted(() => {
  // Auto-join if the URL carries a ?room= code (invite link).
  if (typeof window !== 'undefined') {
    const code = new URL(window.location.href).searchParams.get('room')
    if (code) codeInput.value = code.toUpperCase()
  }
  // Load the current open-rooms list.
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
        <h2 class="mb-1 text-center text-2xl font-extrabold">Play online</h2>
        <p class="mb-6 text-center text-sm text-slate-400">
          Create a room and share the link, or join with a code.
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
          :disabled="busy || online.state.status === 'connecting'"
          @click="createRoom"
        >
          {{ busy ? 'Creating…' : '✨ Create a room' }}
        </button>

        <div class="my-5 flex items-center gap-3 text-xs text-slate-500">
          <span class="h-px flex-1 bg-white/10" /> OR <span class="h-px flex-1 bg-white/10" />
        </div>

        <div class="flex gap-2">
          <input
            v-model="codeInput"
            maxlength="6"
            placeholder="ENTER CODE"
            class="w-full rounded-xl border-2 border-white/15 bg-arcade-bg/70 px-4 py-3 text-center
                   font-mono text-lg font-bold uppercase tracking-[0.3em] text-slate-100 outline-none
                   focus:border-arcade-p1 focus:ring-4 focus:ring-arcade-p1/30"
            @input="codeInput = codeInput.toUpperCase()"
          />
          <button class="btn-primary whitespace-nowrap" @click="joinByCode">Join</button>
        </div>

        <p v-if="localError || online.state.error" class="mt-4 text-center text-sm text-arcade-bad">
          {{ localError || online.state.error }}
        </p>

        <!-- Open rooms browser -->
        <div class="mt-7">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-widest text-slate-400">
              Open rooms
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
                  {{ r.hostName }}
                </div>
                <div class="text-[11px] text-slate-500">
                  <span class="font-mono tracking-widest">{{ r.code }}</span>
                  · {{ r.length }} letters
                </div>
              </div>
              <button class="btn-primary whitespace-nowrap text-xs" @click="joinOpenRoom(r.code)">
                Join
              </button>
            </li>
          </ul>
          <p v-else class="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-slate-500">
            No open rooms right now. Create one above!
          </p>
        </div>
      </template>

      <!-- Joined: waiting room -->
      <template v-else>
        <h2 class="text-center text-sm font-bold uppercase tracking-[0.3em] text-slate-400">
          Room
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

        <!-- Players -->
        <div class="mt-6 grid grid-cols-2 gap-3">
          <div
            v-for="(p, i) in online.state.server?.players ?? []"
            :key="i"
            class="rounded-xl border-2 p-3 text-center"
            :class="[
              i === 0 ? 'border-arcade-p1/40' : 'border-arcade-p2/40',
              p.connected ? '' : 'opacity-50'
            ]"
          >
            <div class="text-xs uppercase tracking-widest text-slate-400">
              Player {{ i + 1 }}{{ online.state.you === i ? ' (you)' : '' }}
            </div>
            <div class="truncate font-extrabold" :class="i === 0 ? 'text-arcade-p1' : 'text-arcade-p2'">
              {{ p.name }}
            </div>
            <div class="mt-1 text-[11px]" :class="p.connected ? 'text-arcade-good' : 'text-slate-500'">
              {{ p.connected ? '● connected' : '○ waiting…' }}
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
          <button
            class="btn-gold mt-5 w-full"
            :disabled="!bothHere"
            @click="startMatch"
          >
            {{ bothHere ? '⚔️ Start Duel' : 'Waiting for opponent…' }}
          </button>
        </div>
        <p v-else class="mt-6 text-center text-sm text-slate-400">
          Waiting for the host to start the duel…
        </p>

        <p v-if="online.state.error" class="mt-4 text-center text-sm text-arcade-bad">
          {{ online.state.error }}
        </p>

        <button
          class="mt-6 w-full text-xs text-slate-400 hover:text-arcade-bad"
          @click="leaveRoom"
        >
          ← Leave room
        </button>
      </template>
    </div>
  </div>
</template>
