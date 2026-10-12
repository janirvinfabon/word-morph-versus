<script setup lang="ts">
import { computed } from 'vue'
import { useGameSession } from '~/composables/useGameSession'
import ModeSelect from '~/components/ModeSelect.vue'
import GameLobby from '~/components/GameLobby.vue'
import OnlineLobby from '~/components/OnlineLobby.vue'
import SoloLobby from '~/components/SoloLobby.vue'
import GameBoard from '~/components/GameBoard.vue'
import GameOverDialog from '~/components/GameOverDialog.vue'

const session = useGameSession()
const mode = computed(() => session.mode.value)

/**
 * Routing:
 *  - no mode            -> ModeSelect
 *  - hotseat + lobby    -> GameLobby, else the board
 *  - solo + lobby       -> SoloLobby, else the board
 *  - online + not yet in a live match -> OnlineLobby, else the board
 * The GameOver dialog overlays the board when phase === 'gameover'.
 */
type Screen = 'mode' | 'hotseat-lobby' | 'solo-lobby' | 'online-lobby' | 'board'

const screen = computed<Screen>(() => {
  if (mode.value === null) return 'mode'
  if (mode.value === 'hotseat') {
    return session.hotseat.state.phase === 'lobby' ? 'hotseat-lobby' : 'board'
  }
  if (mode.value === 'solo') {
    return session.hotseat.state.phase === 'lobby' ? 'solo-lobby' : 'board'
  }
  // online: show the lobby until a match is actually underway.
  const p = session.online.state.server?.phase
  return p === 'playing' || p === 'gameover' ? 'board' : 'online-lobby'
})

const showGameOver = computed(() => session.phase.value === 'gameover')
</script>

<template>
  <div class="flex min-h-full flex-col">
    <!-- Header branding -->
    <header class="px-4 pt-8 pb-4 text-center">
      <h1 class="text-4xl font-black tracking-tight sm:text-5xl">
        <span class="text-arcade-p1">Word</span><span class="text-slate-100">Morph</span>
        <span class="mx-2 text-slate-500">|</span>
        <span class="text-arcade-p2">Versus</span>
      </h1>
      <p class="mt-2 text-sm text-slate-400">
        A head-to-head word duel · change one letter, keep the chain alive
      </p>
    </header>

    <!-- Main stage -->
    <main class="flex-1 px-4 pb-16">
      <ModeSelect v-if="screen === 'mode'" />
      <GameLobby v-else-if="screen === 'hotseat-lobby'" />
      <SoloLobby v-else-if="screen === 'solo-lobby'" />
      <OnlineLobby v-else-if="screen === 'online-lobby'" />
      <GameBoard v-else />
      <GameOverDialog v-if="showGameOver" />
    </main>

    <footer class="px-4 pb-6 text-center text-xs text-slate-600">
      @MSTRIRVING 2026
    </footer>
  </div>
</template>
