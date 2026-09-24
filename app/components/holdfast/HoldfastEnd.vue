<script setup lang="ts">
import { BLOODMOON_AT, DIFFICULTIES } from '#shared/utils/holdfast/config'
import { HOLDFAST_WIN_MS, type HoldfastDifficulty, type HoldfastRunStats } from '#shared/utils/holdfast/meta'
import { formatHoldfastTime } from '~/utils/holdfast/format'

const props = defineProps<{
  outcome: 'victory' | 'defeat'
  difficulty: HoldfastDifficulty
  survivedMs: number
  stats: HoldfastRunStats
  /** What finish-run answered; null while in flight or if it failed. */
  result: { best: number | null, rank: number | null, clamped: boolean } | null
  submitting: boolean
}>()

const emit = defineEmits<{
  again: []
  lobby: []
}>()

const won = computed(() => props.outcome === 'victory')
const difficultyName = computed(() => DIFFICULTIES[props.difficulty].name)

// Progress toward the win clock, split at the Bloodmoon so the part survived
// under it reads differently.
const BLOODMOON_MS = BLOODMOON_AT * 60 * 1000
const bloodmoonPct = BLOODMOON_MS / HOLDFAST_WIN_MS * 100
const survivedPct = computed(() => Math.min(100, Math.max(0, props.survivedMs / HOLDFAST_WIN_MS * 100)))
const calmPct = computed(() => Math.min(survivedPct.value, bloodmoonPct))
const bloodPct = computed(() => Math.max(0, survivedPct.value - bloodmoonPct))

const tiles = computed(() => [
  { label: 'Raiders slain', value: props.stats.kills, icon: 'i-lucide-skull' },
  { label: 'Waves faced', value: props.stats.wave, icon: 'i-lucide-flag' },
  { label: 'Packs deployed', value: props.stats.packsDeployed, icon: 'i-lucide-users' },
  { label: 'Buildings built', value: props.stats.buildingsBuilt, icon: 'i-lucide-hammer' }
])

const newBest = computed(() => {
  const best = props.result?.best
  return best !== null && best !== undefined && best > 0 && props.survivedMs >= best
})

// Refetch the board once the run has been recorded, so it shows up there.
const boardKey = ref(0)
watch(() => props.submitting, (now, was) => {
  if (was && !now) boardKey.value++
})
</script>

<template>
  <div
    class="hf-end relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden text-white"
    :class="won ? 'is-won' : 'is-lost'"
  >
    <!-- Glow and light rays behind the headline -->
    <div aria-hidden="true" class="pointer-events-none absolute inset-x-0 top-0 h-80 overflow-hidden">
      <div v-if="won" class="hf-rays absolute left-1/2 top-[-14rem] size-[36rem] -translate-x-1/2" />
      <div class="hf-glow absolute -top-28 left-1/2 size-80 -translate-x-1/2 rounded-full" />
    </div>

    <div class="hf-scroll relative overflow-y-auto p-5 sm:p-7">
      <!-- Headline -->
      <div class="flex flex-col items-center text-center">
        <div class="hf-medal end-pop">
          <UIcon :name="won ? 'i-lucide-crown' : 'i-lucide-castle'" class="size-9" />
        </div>
        <div class="hf-kicker hf-in mt-4" style="--d: 0.1s">
          <span class="hf-kicker-line" />
          {{ difficultyName }}
          <span class="hf-kicker-line is-flipped" />
        </div>
        <h2 class="hf-headline hf-in mt-2" style="--d: 0.15s">
          {{ won ? 'Victory!' : 'The keep has fallen' }}
        </h2>
        <p class="hf-in mt-3 text-sm text-white/70" style="--d: 0.25s">
          {{ won ? 'The Bloodmoon sets and your banners still fly.' : 'You held the line for' }}
        </p>
        <div class="hf-time hf-in mt-1" style="--d: 0.3s">
          {{ formatHoldfastTime(survivedMs) }}
        </div>
      </div>

      <!-- Progress to the win clock -->
      <div class="hf-in mt-6" style="--d: 0.38s">
        <div class="relative">
          <div class="hf-track relative h-3.5 overflow-hidden rounded-full">
            <!-- The Bloodmoon stretch of the clock -->
            <div class="hf-blood-zone absolute inset-y-0 right-0" :style="{ left: `${bloodmoonPct}%` }" />
            <div class="hf-fill-calm absolute inset-y-0 left-0 transition-[width] duration-700" :style="{ width: `${calmPct}%` }" />
            <div
              class="hf-fill-blood absolute inset-y-0 transition-[width] duration-700"
              :style="{ left: `${bloodmoonPct}%`, width: `${bloodPct}%` }"
            />
          </div>
          <!-- Bloodmoon marker -->
          <div
            class="hf-marker pointer-events-none absolute -top-1 h-5.5 w-1.5 -translate-x-1/2 rounded-full"
            :style="{ left: `${bloodmoonPct}%` }"
          />
        </div>
        <div class="relative mt-1.5 h-5 text-[10px] font-bold tabular-nums text-white/45">
          <span class="absolute left-0">00:00</span>
          <span
            class="absolute flex -translate-x-full items-center gap-1 pr-1.5 text-red-300 sm:-translate-x-1/2 sm:pr-0"
            :style="{ left: `${bloodmoonPct}%` }"
          >
            <UIcon name="i-lucide-moon" class="size-3" />{{ formatHoldfastTime(BLOODMOON_MS) }}
          </span>
          <span class="absolute right-0 flex items-center gap-1" :class="won ? 'text-amber-300' : ''">
            <UIcon name="i-lucide-crown" class="size-3" />{{ formatHoldfastTime(HOLDFAST_WIN_MS) }}
          </span>
        </div>
      </div>

      <!-- Stats -->
      <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div
          v-for="(tile, i) in tiles"
          :key="tile.label"
          class="hf-tile hf-in"
          :style="{ '--d': `${0.45 + i * 0.06}s` }"
        >
          <UIcon :name="tile.icon" class="size-4 text-amber-200/80" />
          <div class="mt-1 text-2xl font-black tabular-nums">{{ formatNumber(tile.value) }}</div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-white/45">{{ tile.label }}</div>
        </div>
      </div>

      <!-- Result -->
      <div class="mt-4 flex min-h-8 flex-wrap items-center justify-center gap-2 text-sm">
        <template v-if="submitting">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-amber-200" />
          <span class="text-white/65">Carving your time into the wall…</span>
        </template>
        <template v-else-if="result">
          <span v-if="newBest" class="hf-best end-pop">
            <UIcon name="i-lucide-sparkles" class="size-4" />
            New best!
          </span>
          <span v-if="result.rank" class="text-white/65">
            Ranked <span class="font-black text-white">#{{ result.rank }}</span> on {{ difficultyName }}
            <template v-if="result.best !== null && !newBest">
              · best <span class="font-mono font-bold text-white">{{ formatHoldfastTime(result.best) }}</span>
            </template>
          </span>
          <span v-else class="text-white/65">Not ranked: hold out a little longer next time.</span>
        </template>
        <span v-else class="text-white/45">This run could not be recorded.</span>
      </div>
      <p v-if="result?.clamped" class="mx-auto mt-2 flex max-w-md items-start justify-center gap-1.5 text-center text-xs text-white/50">
        <UIcon name="i-lucide-info" class="mt-0.5 size-3.5 shrink-0" />
        Your time was trimmed to what the clock allows. Keep the tab in front while you play.
      </p>

      <!-- Leaderboard -->
      <div class="hf-inset mt-5 p-3">
        <div class="mb-2 flex items-center gap-2 px-1 text-sm font-black tracking-wide text-amber-100">
          <UIcon name="i-lucide-trophy" class="size-4 text-amber-300" />
          {{ difficultyName }} leaderboard
        </div>
        <HoldfastLeaderboard :difficulty="difficulty" :refresh-key="boardKey" class="max-h-64" />
      </div>
    </div>

    <!-- Actions -->
    <div class="relative flex flex-col-reverse gap-3 border-t border-white/10 bg-black/25 p-4 sm:flex-row sm:justify-end sm:px-7">
      <button type="button" class="hf-ghost-btn" @click="emit('lobby')">
        <UIcon name="i-lucide-arrow-left" class="size-4" />
        Back to menu
      </button>
      <button type="button" class="hf-gold-btn" @click="emit('again')">
        <UIcon name="i-lucide-rotate-ccw" class="size-5" />
        Play again
      </button>
    </div>
  </div>
</template>

<style scoped>
.hf-end {
  --hf-trim: rgba(252, 211, 77, 0.45);
  --hf-glow: rgba(251, 191, 36, 0.32);
  border-radius: 1.5rem;
  background: linear-gradient(180deg, rgba(26, 30, 40, 0.9), rgba(10, 13, 19, 0.94));
  border: 1px solid var(--hf-trim);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.5),
    0 0 60px -20px var(--hf-glow),
    0 30px 60px -20px rgba(0, 0, 0, 0.8),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(16px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
}

.hf-end.is-lost {
  --hf-trim: rgba(248, 113, 113, 0.4);
  --hf-glow: rgba(220, 38, 38, 0.3);
}

.hf-glow {
  background: radial-gradient(circle, var(--hf-glow), transparent 70%);
  filter: blur(20px);
}

.hf-rays {
  background: repeating-conic-gradient(from 0deg, rgba(253, 230, 138, 0.13) 0deg 6deg, transparent 6deg 18deg);
  mask-image: radial-gradient(circle, #000 18%, transparent 62%);
  -webkit-mask-image: radial-gradient(circle, #000 18%, transparent 62%);
  animation: hf-spin 40s linear infinite;
}

.hf-medal {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 999px;
  color: #fcd34d;
  background: radial-gradient(circle at 50% 30%, rgba(251, 191, 36, 0.35), rgba(60, 30, 5, 0.9));
  border: 2px solid #fcd34d;
  box-shadow:
    0 0 0 4px rgba(0, 0, 0, 0.35),
    0 0 30px rgba(251, 191, 36, 0.55),
    inset 0 2px 0 rgba(255, 240, 200, 0.3);
}

.is-lost .hf-medal {
  color: #fca5a5;
  background: radial-gradient(circle at 50% 30%, rgba(248, 113, 113, 0.3), rgba(50, 10, 10, 0.9));
  border-color: #f87171;
  box-shadow:
    0 0 0 4px rgba(0, 0, 0, 0.35),
    0 0 30px rgba(220, 38, 38, 0.5),
    inset 0 2px 0 rgba(255, 220, 220, 0.2);
}

.hf-kicker {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.7rem;
  font-weight: 900;
  letter-spacing: 0.35em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.6);
}

.hf-kicker-line {
  width: 2rem;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--hf-trim));
}

.hf-kicker-line.is-flipped {
  transform: scaleX(-1);
}

.hf-headline {
  font-size: clamp(2.6rem, 8vw, 4rem);
  font-weight: 900;
  line-height: 0.95;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: transparent;
  background: linear-gradient(180deg, #fffbeb 0%, #fde68a 28%, #fbbf24 52%, #e08a0c 76%, #9a4a0a 100%);
  -webkit-background-clip: text;
  background-clip: text;
  filter: drop-shadow(0 2px 0 #6b3407) drop-shadow(0 3px 0 #3b1d05) drop-shadow(0 10px 20px rgba(0, 0, 0, 0.55));
}

.is-lost .hf-headline {
  font-size: clamp(1.8rem, 5.6vw, 2.75rem);
  background-image: linear-gradient(180deg, #fff1f2 0%, #fecaca 26%, #f87171 55%, #dc2626 80%, #7f1d1d 100%);
  filter: drop-shadow(0 2px 0 #5c0f0f) drop-shadow(0 3px 0 #2b0707) drop-shadow(0 10px 20px rgba(0, 0, 0, 0.55));
}

.hf-time {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: clamp(3.5rem, 12vw, 4.75rem);
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: #fff;
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.45), 0 0 30px var(--hf-glow);
}

.hf-track {
  background: rgba(0, 0, 0, 0.5);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.hf-blood-zone {
  background: repeating-linear-gradient(-45deg, rgba(220, 38, 38, 0.2) 0 5px, rgba(220, 38, 38, 0.06) 5px 10px);
}

.hf-fill-calm {
  background: linear-gradient(180deg, #fde68a, #f59e0b 60%, #d97706);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.hf-fill-blood {
  background: linear-gradient(180deg, #fca5a5, #dc2626 60%, #991b1b);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

.hf-marker {
  background: #f87171;
  box-shadow: 0 0 0 2px #0f131a, 0 0 10px rgba(248, 113, 113, 0.8);
}

.hf-tile {
  border-radius: 1rem;
  padding: 0.75rem;
  text-align: center;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.hf-best {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 999px;
  padding: 0.3rem 0.8rem;
  font-size: 0.8rem;
  font-weight: 900;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #3a1d03;
  background: linear-gradient(180deg, #fff3c4, #fcd34d 30%, #f59e0b);
  box-shadow: 0 0 18px rgba(251, 191, 36, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.hf-inset {
  border-radius: 1rem;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.hf-ghost-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 0.9rem;
  padding: 0.7rem 1.3rem;
  font-size: 0.9rem;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  transition: transform 0.12s, background-color 0.15s, border-color 0.15s, color 0.15s;
}

.hf-ghost-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.11);
  border-color: rgba(252, 211, 77, 0.45);
  transform: translateY(-1px);
}

.hf-ghost-btn:active {
  transform: translateY(1px);
}

.hf-gold-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  overflow: hidden;
  padding: 0.7rem 2rem;
  border-radius: 0.9rem;
  font-size: 1rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #3a1d03;
  background: linear-gradient(180deg, #fff3c4 0%, #fcd34d 24%, #f59e0b 68%, #d97706 100%);
  border: 1px solid #fde68a;
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, 0.7),
    inset 0 -3px 0 rgba(146, 64, 14, 0.45),
    0 4px 0 #8a4a0b,
    0 5px 0 rgba(40, 20, 3, 0.7),
    0 12px 24px -8px rgba(0, 0, 0, 0.65);
  text-shadow: 0 1px 0 rgba(255, 244, 214, 0.65);
  transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.2s ease;
}

.hf-gold-btn::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 -60%;
  width: 45%;
  transform: skewX(-20deg);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent);
  transition: left 0.55s ease;
  pointer-events: none;
}

.hf-gold-btn:hover {
  transform: translateY(-2px);
  filter: brightness(1.07) saturate(1.08);
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, 0.75),
    inset 0 -3px 0 rgba(146, 64, 14, 0.45),
    0 6px 0 #8a4a0b,
    0 7px 0 rgba(40, 20, 3, 0.7),
    0 0 30px 2px rgba(251, 191, 36, 0.5),
    0 16px 28px -8px rgba(0, 0, 0, 0.6);
}

.hf-gold-btn:hover::after {
  left: 120%;
}

.hf-gold-btn:active {
  transform: translateY(4px);
  box-shadow:
    inset 0 2px 4px rgba(120, 53, 15, 0.45),
    inset 0 -1px 0 rgba(146, 64, 14, 0.4),
    0 0 0 #8a4a0b,
    0 1px 0 rgba(40, 20, 3, 0.7),
    0 6px 14px -6px rgba(0, 0, 0, 0.6);
}

.hf-gold-btn:focus-visible,
.hf-ghost-btn:focus-visible {
  outline: 3px solid #fef3c7;
  outline-offset: 3px;
}

.hf-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(252, 211, 77, 0.35) transparent;
}

/* Last, so the background shorthands above cannot reset it: gradients would
   otherwise repeat under the translucent borders as a hairline. */
.hf-end,
.hf-tile,
.hf-gold-btn {
  background-origin: border-box;
}

.end-pop {
  animation: holdfast-end-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.hf-in {
  animation: hf-rise 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  animation-delay: var(--d, 0s);
}

@keyframes holdfast-end-pop {
  from { transform: scale(0.6); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@keyframes hf-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
}

@keyframes hf-spin {
  to { rotate: 360deg; }
}

@media (prefers-reduced-motion: reduce) {
  .end-pop,
  .hf-in,
  .hf-rays {
    animation: none;
  }
}
</style>
