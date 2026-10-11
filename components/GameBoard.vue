<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useGameSession } from '~/composables/useGameSession'
import { TURN_MS } from '~/composables/useWordMorph'
import TileInput from '~/components/TileInput.vue'
import WordChainHistory from '~/components/WordChainHistory.vue'

const session = useGameSession()

const feedback = ref<{ ok: boolean; msg: string } | null>(null)
const shake = ref(false)

const isOnline = computed(() => session.mode.value === 'online')
const accent = computed<'p1' | 'p2'>(() => (session.current.value === 0 ? 'p1' : 'p2'))
const inputDisabled = computed(() => !session.canPlay.value)

/* -------------------- countdown -------------------- */
// `now` ticks every 100ms so the countdown bar animates smoothly.
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  ticker = setInterval(() => (now.value = Date.now()), 100)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})

const msLeft = computed(() => {
  const end = session.turnEndsAt.value
  if (!end || session.phase.value !== 'playing') return null
  return Math.max(0, end - now.value)
})
const secondsLeft = computed(() =>
  msLeft.value === null ? null : Math.ceil(msLeft.value / 1000)
)
const pct = computed(() =>
  msLeft.value === null ? 0 : Math.max(0, Math.min(100, (msLeft.value / TURN_MS) * 100))
)
const low = computed(() => msLeft.value !== null && msLeft.value <= 5000)

/* -------------------- move submit -------------------- */
function onSubmit(word: string) {
  const upper = word.toUpperCase()

  if (session.mode.value === 'hotseat') {
    const res = session.hotseat.submitWord(upper)
    if (!res.ok) {
      feedback.value = { ok: false, msg: res.reason ?? 'Illegal move.' }
      shake.value = true
      setTimeout(() => (shake.value = false), 500)
    } else {
      feedback.value = null
    }
    return
  }
  // Online: server validates and broadcasts the result.
  session.submitWord(upper)
}

// Surface server-side errors (online) as feedback.
watch(
  () => session.online.state.error,
  (err) => {
    if (isOnline.value && err) {
      feedback.value = { ok: false, msg: err }
      shake.value = true
      setTimeout(() => (shake.value = false), 500)
    }
  }
)

// Clear transient feedback whenever the word changes (turn advanced).
watch(
  () => session.currentWord.value,
  () => {
    feedback.value = null
  }
)
</script>

<template>
  <div class="mx-auto flex w-full max-w-2xl flex-col gap-6">
    <!-- Connection / waiting banner (online only) -->
    <div
      v-if="isOnline && session.waitingForOpponent.value"
      class="panel flex items-center justify-center gap-2 p-3 text-sm text-slate-300"
    >
      <span class="h-2 w-2 animate-pulse rounded-full bg-arcade-gold" />
      <span v-if="session.connStatus.value === 'reconnecting'">Reconnecting…</span>
      <span v-else>Waiting for your opponent to connect…</span>
    </div>

    <!-- Turn indicator + countdown -->
    <div class="panel p-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span
            class="flex h-10 w-10 items-center justify-center rounded-full text-lg font-black text-slate-900"
            :class="accent === 'p1' ? 'bg-arcade-p1' : 'bg-arcade-p2'"
          >
            {{ session.current.value + 1 }}
          </span>
          <div>
            <div class="text-xs uppercase tracking-widest text-slate-400">
              {{ isOnline && session.canPlay.value ? 'Your turn' : 'Waiting on' }}
            </div>
            <div
              class="text-lg font-extrabold"
              :class="accent === 'p1' ? 'text-arcade-p1' : 'text-arcade-p2'"
            >
              {{ session.currentPlayer.value.name }}…
            </div>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <!-- Countdown seconds -->
          <div
            v-if="secondsLeft !== null"
            class="flex h-11 w-11 items-center justify-center rounded-full border-2 font-mono text-lg font-black tabular-nums"
            :class="
              low
                ? 'border-arcade-bad text-arcade-bad animate-pulse'
                : 'border-white/20 text-slate-200'
            "
            aria-label="Seconds remaining"
          >
            {{ secondsLeft }}
          </div>
          <button class="btn-ghost text-xs" @click="session.resign()">Resign</button>
        </div>
      </div>

      <!-- Countdown bar -->
      <div v-if="msLeft !== null" class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          class="h-full rounded-full transition-[width] duration-100 ease-linear"
          :class="low ? 'bg-arcade-bad' : accent === 'p1' ? 'bg-arcade-p1' : 'bg-arcade-p2'"
          :style="{ width: pct + '%' }"
        />
      </div>
    </div>

    <!-- Current word / tile input -->
    <div class="panel p-6" :class="{ 'animate-shake': shake }">
      <p class="mb-4 text-center text-sm text-slate-400">
        Change <span class="font-bold text-slate-200">one letter</span> of
        <span class="font-mono font-bold tracking-[0.2em] text-slate-100">{{
          session.currentWord.value
        }}</span>
        to make a new word
      </p>

      <TileInput
        :base-word="session.currentWord.value"
        :length="session.length.value"
        :highlight-index="session.lastChangedIndex.value"
        :accent="accent"
        :disabled="inputDisabled"
        @submit="onSubmit"
      />

      <!-- Inline feedback -->
      <div class="mt-4 h-6 text-center text-sm font-semibold">
        <span v-if="feedback" :class="feedback.ok ? 'text-arcade-good' : 'text-arcade-bad'">
          {{ feedback.msg }}
        </span>
        <span v-else-if="isOnline && !session.canPlay.value" class="text-slate-500">
          Waiting on {{ session.currentPlayer.value.name }}…
        </span>
      </div>
    </div>

    <!-- History -->
    <WordChainHistory :chain="session.chain.value" :players="session.players.value" />
  </div>
</template>
