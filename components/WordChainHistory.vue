<script setup lang="ts">
import type { ChainEntry } from '~/composables/useWordMorph'

/**
 * WordChainHistory — breadcrumb log of every word played, with the changed
 * letter highlighted and a per-player colour chip showing who played it.
 */
defineProps<{
  chain: ChainEntry[]
  players: readonly { name: string }[]
}>()

function colorFor(by: number | null) {
  if (by === null) return 'text-slate-400 ring-white/15'
  return by === 0
    ? 'text-arcade-p1 ring-arcade-p1/40'
    : 'text-arcade-p2 ring-arcade-p2/40'
}
</script>

<template>
  <div class="panel p-4">
    <h3 class="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">
      Chain · {{ Math.max(0, chain.length - 1) }} moves
    </h3>

    <ol class="flex flex-wrap items-center gap-2">
      <li
        v-for="(entry, idx) in chain"
        :key="idx"
        class="flex items-center gap-2"
      >
        <span
          class="animate-pop rounded-xl bg-arcade-bg/60 px-3 py-1.5 font-mono text-lg font-bold
                 tracking-[0.15em] ring-1"
          :class="colorFor(entry.by)"
          :title="entry.by === null ? 'Start word' : players[entry.by]?.name"
        >
          <span
            v-for="(ch, ci) in entry.word.split('')"
            :key="ci"
            :class="ci === entry.changedIndex ? 'text-arcade-gold underline underline-offset-4' : ''"
            >{{ ch }}</span
          >
        </span>
        <span
          v-if="idx < chain.length - 1"
          class="text-slate-500"
          aria-hidden="true"
          >→</span
        >
      </li>
    </ol>

    <div class="mt-3 flex gap-4 text-xs text-slate-400">
      <span class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-full bg-arcade-p1" /> {{ players[0]?.name }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-full bg-arcade-p2" /> {{ players[1]?.name }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-full bg-arcade-gold" /> changed letter
      </span>
    </div>
  </div>
</template>
