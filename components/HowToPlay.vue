<script setup lang="ts">
import { ref } from 'vue'

/**
 * HowToPlay — a simple, collapsible "how to play" card for players.
 * Collapsed by default; players expand it when they want the rules.
 */
const open = ref(false)
</script>

<template>
  <div class="panel p-6 sm:p-8">
    <button
      class="flex w-full items-center justify-between text-left"
      :aria-expanded="open"
      @click="open = !open"
    >
      <h2 class="text-2xl font-extrabold text-slate-100">📖 How to play</h2>
      <span class="text-slate-400">{{ open ? '▲' : '▼' }}</span>
    </button>

    <div v-show="open" class="mt-4 space-y-4 text-sm text-slate-300">
      <p>
        You and your rival take turns changing a word. Keep making real words to
        survive — the first player to slip up loses!
      </p>

      <!-- The core rule, shown visually -->
      <div class="rounded-xl bg-arcade-bg/60 p-4">
        <p class="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">
          Change exactly one letter each turn
        </p>
        <div class="flex flex-wrap items-center gap-2 font-mono text-base font-bold tracking-widest">
          <span class="text-slate-100">FALL</span>
          <span class="text-slate-500">→</span>
          <span class="text-arcade-p1">H<span class="text-arcade-gold">A</span>LL</span>
          <span class="text-slate-500">→</span>
          <span class="text-arcade-p2">HAL<span class="text-arcade-gold">T</span></span>
          <span class="text-slate-500">→</span>
          <span class="text-arcade-p1">HAL<span class="text-arcade-gold">F</span></span>
          <span class="text-slate-500">→</span>
          <span class="text-arcade-p2"><span class="text-arcade-gold">C</span>ALF</span>
        </div>
        <p class="mt-2 text-xs text-slate-500">
          The highlighted letter is the one that changed.
        </p>
      </div>

      <!-- Numbered steps -->
      <ol class="space-y-2">
        <li class="flex gap-3">
          <span class="font-black text-arcade-p1">1.</span>
          <span>Pick a word length (4, 5, or 6). The game gives you a starting word.</span>
        </li>
        <li class="flex gap-3">
          <span class="font-black text-arcade-p1">2.</span>
          <span>
            On your turn, change <strong class="text-slate-100">one letter</strong> to
            make a new, valid English word of the same length.
          </span>
        </li>
        <li class="flex gap-3">
          <span class="font-black text-arcade-p1">3.</span>
          <span>
            The move locks in <strong class="text-slate-100">the instant you type a
            letter</strong> — pick carefully, there are no take-backs!
          </span>
        </li>
        <li class="flex gap-3">
          <span class="font-black text-arcade-p1">4.</span>
          <span>
            You have <strong class="text-arcade-gold">15 seconds</strong> per turn. Run
            out of time and you lose.
          </span>
        </li>
      </ol>

      <!-- You lose if -->
      <div>
        <p class="mb-2 font-bold text-arcade-bad">You lose if you…</p>
        <ul class="space-y-1">
          <li class="flex gap-2"><span>❌</span><span>make a word that isn't in the dictionary,</span></li>
          <li class="flex gap-2"><span>❌</span><span>change more or fewer than one letter,</span></li>
          <li class="flex gap-2"><span>❌</span><span>repeat a word already used this match, or</span></li>
          <li class="flex gap-2"><span>❌</span><span>run out of time.</span></li>
        </ul>
        <p class="mt-2 text-slate-400">When the chain breaks, your opponent wins. 🏆</p>
      </div>
    </div>
  </div>
</template>
