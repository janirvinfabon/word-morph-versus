<script setup lang="ts">
/**
 * WordChainHistory — breadcrumb log of every word played, with the changed
 * letter highlighted and a per-player colour chip showing who played it.
 *
 * Works for both duel mode (where `by` is a numeric player index) and party
 * mode (where `by` is a stable string player id). Players may optionally carry
 * an `id` and an `eliminated` flag.
 */
interface HistEntry {
  word: string
  by: number | string | null
  changedIndex: number | null
}
interface HistPlayer {
  name: string
  id?: string
  eliminated?: boolean
}
interface HistFailed {
  word: string
  by: number | string | null
  changedIndex: number | null
  lossReason: string
}

const props = withDefaults(
  defineProps<{
    chain: HistEntry[]
    players: readonly HistPlayer[]
    failedAttempts?: readonly HistFailed[]
  }>(),
  { failedAttempts: () => [] }
)

/** Resolve the seating index of the player who played an entry. */
function indexOf(by: number | string | null): number | null {
  if (by === null) return null
  if (typeof by === 'number') return by
  const i = props.players.findIndex((p) => p.id === by)
  return i < 0 ? null : i
}

function nameOf(by: number | string | null): string {
  const i = indexOf(by)
  return i === null ? '' : (props.players[i]?.name ?? '')
}

/** Alternating per-seat colour (p1/p2) so any number of players stays legible. */
function colorFor(by: number | string | null) {
  const i = indexOf(by)
  if (i === null) return 'text-slate-400 ring-white/15'
  return i % 2 === 0
    ? 'text-arcade-p1 ring-arcade-p1/40'
    : 'text-arcade-p2 ring-arcade-p2/40'
}

function dotClass(i: number): string {
  return i % 2 === 0 ? 'bg-arcade-p1' : 'bg-arcade-p2'
}

/** Short label for a wordless failure (timeout / resign). */
function failLabel(reason: string): string {
  if (reason === 'timeout') return '⏱ timed out'
  if (reason === 'resign') return '🏳 resigned'
  if (reason === 'disconnect') return '🔌 left'
  return '✗ failed'
}

/** Tooltip explaining why an attempt failed. */
function failTitle(f: HistFailed): string {
  const who = nameOf(f.by) || 'Player'
  switch (f.lossReason) {
    case 'invalid-word':
      return `${who}: not a valid word`
    case 'not-single-change':
      return `${who}: not a single-letter change`
    case 'repeat':
      return `${who}: word already used`
    case 'timeout':
      return `${who}: ran out of time`
    case 'resign':
      return `${who}: resigned`
    case 'disconnect':
      return `${who}: left the match`
    default:
      return `${who}: failed`
  }
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
          :title="entry.by === null ? 'Start word' : nameOf(entry.by)"
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

      <!-- Failed attempts: broken-chain / timeout / resign, shown in red -->
      <template v-for="(f, fi) in failedAttempts" :key="`f-${fi}`">
        <li class="flex items-center gap-2">
          <span class="text-arcade-bad" aria-hidden="true">✗</span>
          <span
            class="animate-pop rounded-xl border border-dashed border-arcade-bad/60 bg-arcade-bad/10
                   px-3 py-1.5 font-mono text-lg font-bold tracking-[0.15em] text-arcade-bad"
            :title="failTitle(f)"
          >
            <template v-if="f.word">
              <span
                v-for="(ch, ci) in f.word.split('')"
                :key="ci"
                :class="ci === f.changedIndex ? 'underline underline-offset-4 decoration-2' : ''"
                >{{ ch }}</span
              >
            </template>
            <span v-else class="text-sm font-bold uppercase tracking-wider">
              {{ failLabel(f.lossReason) }}
            </span>
          </span>
        </li>
      </template>
    </ol>

    <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-400">
      <span
        v-for="(p, i) in players"
        :key="p.id ?? i"
        class="flex items-center gap-1.5"
        :class="p.eliminated ? 'text-slate-500 line-through' : ''"
      >
        <span class="h-2.5 w-2.5 rounded-full" :class="dotClass(i)" /> {{ p.name }}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="h-2.5 w-2.5 rounded-full bg-arcade-gold" /> changed letter
      </span>
    </div>
  </div>
</template>
