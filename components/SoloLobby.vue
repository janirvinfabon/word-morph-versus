<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { WordLength } from '~/composables/useWordMorph'
import { useWordMorph } from '~/composables/useWordMorph'
import { useGameSession } from '~/composables/useGameSession'

const game = useWordMorph()
const session = useGameSession()

const recent = game.loadRecentPlayers()
const name = ref(recent[0] ?? '')
const length = ref<WordLength>(4)

const lengths: { value: WordLength; label: string; blurb: string }[] = [
  { value: 4, label: '4 Letters', blurb: 'Quick & punchy' },
  { value: 5, label: '5 Letters', blurb: 'The classic' },
  { value: 6, label: '6 Letters', blurb: 'For wizards' }
]

// Live best score for the currently selected length.
const best = computed(() => game.loadBest(length.value))

async function start() {
  await game.startSolo({ length: length.value, player1: name.value || 'You' })
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

      <h2 class="mb-1 text-center text-2xl font-extrabold text-arcade-gold">
        🏃 Versus Self
      </h2>
      <p class="mb-6 text-center text-sm text-slate-400">
        One life. 15 seconds a move. Chain as many valid words as you can —
        then try to beat it.
      </p>

      <label class="block">
        <span class="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-400"
          >Your name</span
        >
        <input
          v-model="name"
          maxlength="16"
          placeholder="You"
          class="w-full rounded-xl border-2 border-arcade-gold/40 bg-arcade-bg/70 px-4 py-3
                 font-bold text-slate-100 outline-none focus:border-arcade-gold focus:ring-4
                 focus:ring-arcade-gold/30"
        />
      </label>

      <div class="mt-6">
        <span class="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400"
          >Word length</span
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

      <div class="mt-6 flex items-center justify-center gap-2 text-sm text-slate-400">
        <span>🏆 Your best ({{ length }} letters):</span>
        <span class="font-mono text-lg font-black text-arcade-gold">{{ best }}</span>
      </div>

      <p v-if="game.state.error" class="mt-4 text-center text-sm text-arcade-bad">
        {{ game.state.error }}
      </p>

      <button
        class="btn-gold mt-6 w-full text-lg"
        :disabled="game.state.loading"
        @click="start"
      >
        <span v-if="game.state.loading">Loading…</span>
        <span v-else>🏁 Start Rush</span>
      </button>
    </div>
  </div>
</template>
