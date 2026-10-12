<script setup lang="ts">
import { useGameSession } from '~/composables/useGameSession'
import HowToPlay from '~/components/HowToPlay.vue'

const session = useGameSession()
</script>

<template>
  <div class="mx-auto w-full max-w-xl">
    <div class="panel p-6 sm:p-8">
      <h2 class="mb-1 text-center text-2xl font-extrabold">Choose how to play</h2>
      <p class="mb-6 text-center text-sm text-slate-400">
        Face off on one device, or duel across two.
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <button
          class="group rounded-2xl border-2 border-arcade-p1/30 bg-arcade-p1/5 p-6 text-left
                 transition-all hover:border-arcade-p1 hover:bg-arcade-p1/10"
          @click="session.setMode('hotseat')"
        >
          <div class="text-3xl">🛋️</div>
          <div class="mt-2 text-lg font-extrabold text-arcade-p1">Same device</div>
          <p class="mt-1 text-sm text-slate-400">
            Pass-and-play hot seat. Two players take turns on this screen.
          </p>
        </button>

        <button
          class="group rounded-2xl border-2 border-arcade-p2/30 bg-arcade-p2/5 p-6 text-left
                 transition-all hover:border-arcade-p2 hover:bg-arcade-p2/10"
          @click="session.setMode('online')"
        >
          <div class="text-3xl">🌐</div>
          <div class="mt-2 text-lg font-extrabold text-arcade-p2">
            Two devices (online)
          </div>
          <p class="mt-1 text-sm text-slate-400">
            Create a room, share the code or link, and duel in real time.
          </p>
        </button>
      </div>

      <!-- Solo rush -->
      <button
        class="group mt-4 flex w-full items-center gap-4 rounded-2xl border-2 border-arcade-gold/30
               bg-arcade-gold/5 p-6 text-left transition-all hover:border-arcade-gold
               hover:bg-arcade-gold/10"
        @click="session.setMode('solo')"
      >
        <div class="text-3xl">🏃</div>
        <div>
          <div class="text-lg font-extrabold text-arcade-gold">Versus Self (Rush)</div>
          <p class="mt-1 text-sm text-slate-400">
            Solo challenge — chain as many words as you can and beat your best score.
          </p>
        </div>
      </button>
    </div>

    <div class="mt-6">
      <HowToPlay />
    </div>
  </div>
</template>
