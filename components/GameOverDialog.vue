<script setup lang="ts">
import { computed } from 'vue'
import type { LossReason, PlayerIndex } from '~/composables/useOnlineGame'
import { useGameSession } from '~/composables/useGameSession'
import WordChainHistory from '~/components/WordChainHistory.vue'

const session = useGameSession()

const isSolo = computed(() => session.mode.value === 'solo')

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
      <div v-else class="text-center">
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

      <div class="mt-6">
        <WordChainHistory :chain="session.chain.value" :players="session.players.value" />
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
