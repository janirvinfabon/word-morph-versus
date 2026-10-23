<script setup lang="ts">
import { computed } from 'vue'
import type { LossReason, PlayerIndex } from '~/composables/useOnlineGame'
import { useGameSession } from '~/composables/useGameSession'
import WordChainHistory from '~/components/WordChainHistory.vue'

const session = useGameSession()

const isSolo = computed(() => session.mode.value === 'solo')
const isParty = computed(() => session.mode.value === 'party')

const winner = computed(() => session.winner.value)
const loser = computed<PlayerIndex | null>(() =>
  winner.value === null ? null : winner.value === 0 ? 1 : 0
)

const winnerName = computed(() =>
  winner.value === null ? '' : session.players.value[winner.value]?.name ?? ''
)
const loserName = computed(() =>
  loser.value === null ? '' : session.players.value[loser.value]?.name ?? ''
)

const lastWord = computed(() => session.currentWord.value)

/* -------------------- party podium -------------------- */
/** Players ordered winner-first by placement, with medal + loss reason. */
const podium = computed(() => session.party.podium.value)
const partyWinnerName = computed(() => session.party.winner.value?.name ?? '')

function medal(placement: number | null): string {
  if (placement === 1) return '🥇'
  if (placement === 2) return '🥈'
  if (placement === 3) return '🥉'
  return `#${placement ?? '—'}`
}

function outReason(reason: LossReason | null): string {
  switch (reason) {
    case 'invalid-word':
      return 'invalid word'
    case 'not-single-change':
      return 'bad change'
    case 'repeat':
      return 'repeat'
    case 'resign':
      return 'left'
    case 'timeout':
      return 'timed out'
    case 'disconnect':
      return 'disconnected'
    default:
      return ''
  }
}

function podiumAccent(i: number): string {
  return i === 0 ? 'text-arcade-gold' : i % 2 === 1 ? 'text-arcade-p2' : 'text-arcade-p1'
}

/* -------------------- missed words ("you could've played") -------------------- */
const missed = computed(() => session.missedWords.value)
const showMissed = computed(() => {
  const m = missed.value
  return !!m && m.words.length > 0
})
/** Highlight the changed letter of a neighbor vs. the board word. */
function diffIndex(fromWord: string, word: string): number {
  for (let i = 0; i < Math.min(fromWord.length, word.length); i++) {
    if (fromWord[i] !== word[i]) return i
  }
  return -1
}

/** Why the solo run ended (first-person, no opponent). */
const soloReasonText = computed(() => {
  const r = session.lossReason.value as LossReason | null
  switch (r) {
    case 'invalid-word':
      return 'That word isn\u2019t in the dictionary.'
    case 'not-single-change':
      return 'That wasn\u2019t a single-letter change.'
    case 'repeat':
      return 'You\u2019d already used that word.'
    case 'timeout':
      return 'Time ran out!'
    case 'resign':
      return 'Run ended.'
    default:
      return 'Run over.'
  }
})

const reasonText = computed(() => {
  const r = session.lossReason.value as LossReason | null
  switch (r) {
    case 'invalid-word':
      return `${loserName.value} played a word that isn't in the dictionary.`
    case 'not-single-change':
      return `${loserName.value} didn't change exactly one letter.`
    case 'repeat':
      return `${loserName.value} repeated a word already in the chain.`
    case 'resign':
      return `${loserName.value} resigned.`
    case 'disconnect':
      return `${loserName.value} left the match.`
    case 'timeout':
      return `${loserName.value} ran out of time.`
    default:
      return 'The chain broke.'
  }
})

const winnerAccent = computed(() =>
  winner.value === 0 ? 'text-arcade-p1' : 'text-arcade-p2'
)
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Game over"
  >
    <div class="panel w-full max-w-xl animate-pop p-6 sm:p-8">
      <!-- Solo rush result -->
      <div v-if="isSolo" class="text-center">
        <div class="animate-float text-5xl">{{ session.isNewBest.value ? '🎉' : '🏁' }}</div>
        <h2 class="mt-2 text-sm font-bold uppercase tracking-[0.3em] text-slate-400">
          {{ session.isNewBest.value ? 'New best!' : 'Run over' }}
        </h2>
        <p class="text-5xl font-black text-arcade-gold tabular-nums">
          {{ session.score.value }}
        </p>
        <p class="text-xs uppercase tracking-widest text-slate-500">words chained</p>
        <p class="mt-3 text-sm text-slate-400">{{ soloReasonText }}</p>
        <p class="mt-1 text-xs text-slate-500">
          Best: <span class="font-bold text-slate-300">{{ session.bestScore.value }}</span>
          · ended on
          <span class="font-mono font-bold tracking-widest text-slate-300">{{ lastWord }}</span>
        </p>
      </div>

      <!-- Duel result -->
      <div v-else-if="!isParty" class="text-center">
        <div class="animate-float text-5xl">🏆</div>
        <h2 class="mt-2 text-sm font-bold uppercase tracking-[0.3em] text-slate-400">
          Winner
        </h2>
        <p class="text-3xl font-black sm:text-4xl" :class="winnerAccent">
          {{ winnerName }}
        </p>
        <p class="mt-2 text-sm text-slate-400">{{ reasonText }}</p>
        <p class="mt-1 text-xs text-slate-500">
          Chain ended on
          <span class="font-mono font-bold tracking-widest text-slate-300">{{ lastWord }}</span>
        </p>
      </div>

      <!-- Party podium -->
      <div v-else class="text-center">
        <div class="animate-float text-5xl">🎉</div>
        <h2 class="mt-2 text-sm font-bold uppercase tracking-[0.3em] text-slate-400">
          Last word-smith standing
        </h2>
        <p class="text-3xl font-black text-arcade-gold sm:text-4xl">
          {{ partyWinnerName }}
        </p>

        <ol class="mt-5 flex flex-col gap-2 text-left">
          <li
            v-for="(p, i) in podium"
            :key="p.id"
            class="flex items-center justify-between rounded-xl border px-3 py-2"
            :class="
              i === 0
                ? 'border-arcade-gold/50 bg-arcade-gold/10'
                : 'border-white/10 bg-arcade-bg/50'
            "
          >
            <span class="flex items-center gap-2 min-w-0">
              <span class="text-lg">{{ medal(p.placement) }}</span>
              <span class="truncate font-extrabold" :class="podiumAccent(i)">{{ p.name }}</span>
            </span>
            <span v-if="p.placement !== 1" class="text-[11px] uppercase tracking-widest text-slate-500">
              {{ outReason(p.lossReason) }}
            </span>
            <span v-else class="text-[11px] uppercase tracking-widest text-arcade-gold">
              survived
            </span>
          </li>
        </ol>

        <p class="mt-3 text-xs text-slate-500">
          Chain ended on
          <span class="font-mono font-bold tracking-widest text-slate-300">{{ lastWord }}</span>
        </p>
      </div>

      <!-- What the loser could have played -->
      <div
        v-if="showMissed"
        class="mt-6 rounded-xl border border-arcade-good/30 bg-arcade-good/5 p-4"
      >
        <p class="mb-2 text-xs font-bold uppercase tracking-widest text-arcade-good">
          {{ missed!.allUsed ? 'Only repeats were left' : 'You could’ve played' }}
        </p>
        <p class="mb-3 text-xs text-slate-400">
          from
          <span class="font-mono font-bold tracking-widest text-slate-300">{{
            missed!.fromWord
          }}</span>
        </p>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="w in missed!.words"
            :key="w"
            class="rounded-lg border border-arcade-good/40 bg-arcade-good/10 px-2.5 py-1 font-mono
                   text-base font-bold tracking-[0.15em] text-arcade-good"
          >
            <span
              v-for="(ch, ci) in w.split('')"
              :key="ci"
              :class="ci === diffIndex(missed!.fromWord, w) ? 'text-arcade-gold underline underline-offset-4' : ''"
              >{{ ch }}</span
            >
          </span>
        </div>
      </div>

      <div class="mt-6">
        <WordChainHistory
          :chain="session.chain.value"
          :players="session.players.value"
          :failed-attempts="session.failedAttempts.value"
        />
      </div>

      <div class="mt-6 grid grid-cols-2 gap-3">
        <button class="btn-gold" @click="session.rematch()">
          {{ isSolo ? '🔁 Play Again' : '🔁 Rematch' }}
        </button>
        <button class="btn-ghost" @click="isSolo ? session.backToLobby() : session.newGame()">
          {{ isSolo ? '🔙 Back to Lobby' : '🆕 New Game' }}
        </button>
      </div>
    </div>
  </div>
</template>
