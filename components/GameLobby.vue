<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { WordLength } from '~/composables/useWordMorph'
import { useWordMorph } from '~/composables/useWordMorph'
import { useGameSession } from '~/composables/useGameSession'

const game = useWordMorph()
const session = useGameSession()

const p1 = ref('')
const p2 = ref('')
const length = ref<WordLength>(4)
const recent = ref<string[]>([])

const lengths: { value: WordLength; label: string; blurb: string }[] = [
  { value: 4, label: '4 Letters', blurb: 'Quick & punchy' },
  { value: 5, label: '5 Letters', blurb: 'The classic duel' },
  { value: 6, label: '6 Letters', blurb: 'For word wizards' }
]

onMounted(() => {
  recent.value = game.loadRecentPlayers()
  // Pre-fill with the two most recent names if present.
  if (recent.value[0]) p1.value = recent.value[0]
  if (recent.value[1]) p2.value = recent.value[1]
})

function useName(target: 'p1' | 'p2', name: string) {
  if (target === 'p1') p1.value = name
  else p2.value = name
}

async function start() {
  await game.startGame({
    length: length.value,
    player1: p1.value || 'Player 1',
    player2: p2.value || 'Player 2'
  })
}
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
      <h2 class="mb-1 text-center text-2xl font-extrabold text-slate-100">
        New Duel
      </h2>
      <p class="mb-6 text-center text-sm text-slate-400">
        Two players. One word. Change a single letter each turn — don't break the chain.
      </p>

      <!-- Player names -->
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-xs font-bold uppercase tracking-widest text-arcade-p1"
            >Player 1</span
          >
          <input
            v-model="p1"
            maxlength="16"
            placeholder="Player 1"
            class="w-full rounded-xl border-2 border-arcade-p1/40 bg-arcade-bg/70 px-4 py-3
                   font-bold text-slate-100 outline-none focus:border-arcade-p1 focus:ring-4
                   focus:ring-arcade-p1/30"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs font-bold uppercase tracking-widest text-arcade-p2"
            >Player 2</span
          >
          <input
            v-model="p2"
            maxlength="16"
            placeholder="Player 2"
            class="w-full rounded-xl border-2 border-arcade-p2/40 bg-arcade-bg/70 px-4 py-3
                   font-bold text-slate-100 outline-none focus:border-arcade-p2 focus:ring-4
                   focus:ring-arcade-p2/30"
          />
        </label>
      </div>

      <!-- Recent names -->
      <div v-if="recent.length" class="mt-3">
        <span class="text-xs text-slate-500">Recent:</span>
        <div class="mt-1 flex flex-wrap gap-2">
          <button
            v-for="name in recent"
            :key="name"
            class="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300 ring-1 ring-white/10
                   hover:bg-white/10"
            @click="useName(!p1 ? 'p1' : 'p2', name)"
          >
            {{ name }}
          </button>
        </div>
      </div>

      <!-- Category -->
      <div class="mt-6">
        <span class="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400"
          >Word Length</span
        >
        <div class="grid grid-cols-3 gap-3">
          <button
            v-for="opt in lengths"
            :key="opt.value"
            class="rounded-2xl border-2 p-4 text-center transition-all"
            :class="
              length === opt.value
                ? 'border-arcade-gold bg-arcade-gold/10 text-arcade-gold'
                : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/25'
            "
            @click="length = opt.value"
          >
            <div class="text-lg font-extrabold">{{ opt.label }}</div>
            <div class="text-[11px] opacity-70">{{ opt.blurb }}</div>
          </button>
        </div>
      </div>

      <p v-if="game.state.error" class="mt-4 text-center text-sm text-arcade-bad">
        {{ game.state.error }}
      </p>

      <button
        class="btn-gold mt-7 w-full text-lg"
        :disabled="game.state.loading"
        @click="start"
      >
        <span v-if="game.state.loading">Loading dictionary…</span>
        <span v-else>⚔️ Start Duel</span>
      </button>
    </div>
  </div>
</template>
