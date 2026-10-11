<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

/**
 * TileInput — a row of per-letter tiles the active player types into.
 *
 * INSTANT SUBMIT: the moment the active player types a letter that makes the
 * word differ from `baseWord` by exactly one position, the move is submitted
 * immediately — there is no Reset/Submit step. One keystroke = one move.
 *
 * - Pre-fills with the current word so the player only mutates letters.
 * - `highlightIndex` marks the letter the PREVIOUS player changed.
 * - `accent` tints tiles to the active player's colour.
 */
const props = defineProps<{
  baseWord: string
  length: number
  highlightIndex: number | null
  accent: 'p1' | 'p2'
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', word: string): void
}>()

const letters = ref<string[]>([])
const inputs = ref<HTMLInputElement[]>([])
// Guards against emitting more than one move per turn.
let submitted = false

function seed() {
  letters.value = props.baseWord.split('')
  submitted = false
  nextTick(() => {
    const el = inputs.value[0]
    el?.focus()
  })
}

// Reseed whenever the base word changes (new turn / new game).
watch(() => props.baseWord, seed, { immediate: true })

const typed = computed(() => letters.value.join('').toUpperCase())

/** Single changed index vs base, or -1 (none) / -2 (more than one). */
const diffIndex = computed(() => {
  const base = props.baseWord.toUpperCase()
  const cur = typed.value
  let diff = -1
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] !== base[i]) {
      if (diff !== -1) return -2
      diff = i
    }
  }
  return diff
})

function onInput(i: number, e: Event) {
  const el = e.target as HTMLInputElement
  const ch = el.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(-1)
  letters.value[i] = ch
  el.value = ch

  if (props.disabled || submitted) return

  // Instant submit: a single-letter change fires the move right away.
  if (diffIndex.value >= 0) {
    submitted = true
    const word = typed.value
    // Blur so the mobile keyboard dismisses and no further keys land.
    el.blur()
    emit('submit', word)
  } else if (ch && i < props.length - 1) {
    // Still equal to the base (they retyped the same letter) — advance focus.
    nextTick(() => inputs.value[i + 1]?.focus())
  }
}

function onKeydown(i: number, e: KeyboardEvent) {
  if (e.key === 'Backspace' && !letters.value[i] && i > 0) {
    nextTick(() => inputs.value[i - 1]?.focus())
  }
  if (e.key === 'ArrowLeft' && i > 0) inputs.value[i - 1]?.focus()
  if (e.key === 'ArrowRight' && i < props.length - 1) inputs.value[i + 1]?.focus()
}

defineExpose({ focus: () => inputs.value[0]?.focus() })

const accentRing = computed(() =>
  props.accent === 'p1' ? 'focus:ring-arcade-p1' : 'focus:ring-arcade-p2'
)
const accentActive = computed(() =>
  props.accent === 'p1'
    ? 'border-arcade-p1 text-arcade-p1 shadow-glow'
    : 'border-arcade-p2 text-arcade-p2'
)
</script>

<template>
  <div class="flex flex-col items-center gap-3">
    <div class="flex gap-2 sm:gap-3" role="group" aria-label="Letter tiles">
      <input
        v-for="(ch, i) in letters"
        :key="i"
        ref="inputs"
        :value="ch"
        type="text"
        inputmode="latin"
        maxlength="1"
        autocomplete="off"
        autocapitalize="characters"
        :disabled="disabled"
        :aria-label="`Letter ${i + 1}`"
        class="h-14 w-12 sm:h-16 sm:w-14 rounded-xl border-2 bg-arcade-bg/70 text-center
               text-2xl sm:text-3xl font-extrabold uppercase outline-none transition-all
               duration-150 focus:ring-4 disabled:opacity-50"
        :class="[
          accentRing,
          i === diffIndex
            ? accentActive
            : i === highlightIndex
              ? 'border-arcade-gold/70 text-arcade-gold'
              : 'border-white/15 text-slate-100'
        ]"
        @input="onInput(i, $event)"
        @keydown="onKeydown(i, $event)"
        @focus="($event.target as HTMLInputElement).select()"
      />
    </div>

    <p class="text-xs text-slate-500">
      Type one letter to lock in your move — no take-backs!
    </p>
  </div>
</template>
