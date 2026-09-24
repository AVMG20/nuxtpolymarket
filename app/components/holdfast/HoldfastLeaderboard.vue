<script setup lang="ts">
import type { InternalApi } from 'nitropack/types'
import { HOLDFAST_WIN_MS, type HoldfastDifficulty } from '#shared/utils/holdfast/meta'
import { formatHoldfastTime } from '~/utils/holdfast/format'

type LeaderboardPayload = InternalApi['/api/holdfast/leaderboard']['get']

const props = withDefaults(defineProps<{
  difficulty: HoldfastDifficulty
  /** Bump to refetch, e.g. once a finished run has been recorded. */
  refreshKey?: number
}>(), {
  refreshKey: 0
})

const { user } = useAuth()

const board = shallowRef<LeaderboardPayload | null>(null)
const error = ref<string | null>(null)

// Only the newest request may land: switching tabs quickly must not let an
// older difficulty's answer overwrite the one on screen.
let requestSeq = 0

async function load() {
  const seq = ++requestSeq
  error.value = null
  try {
    const data = await apiFetch<LeaderboardPayload>('/api/holdfast/leaderboard', {
      query: { difficulty: props.difficulty }
    })
    if (seq === requestSeq) board.value = data
  } catch (e) {
    if (seq === requestSeq) error.value = apiErrorMessage(e, 'Could not load the leaderboard')
  }
}

onMounted(load)
watch(() => [props.difficulty, props.refreshKey], load)

// A refresh of the same board keeps the old rows up; only a new board skeletons.
const current = computed(() => board.value?.difficulty === props.difficulty ? board.value : null)
const loading = computed(() => !current.value && !error.value)
const entries = computed(() => current.value?.entries ?? [])

/** The player's own standing when it falls outside the listed rows. */
const pinned = computed(() => {
  const me = current.value?.me
  if (!me || entries.value.some(e => e.isCurrentUser)) return null
  return {
    rank: me.rank,
    survivedMs: me.best,
    won: me.best >= HOLDFAST_WIN_MS,
    name: user.value?.name ?? 'You',
    emblem: user.value?.emblem ?? null,
    prestige: user.value?.prestige ?? 0
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-col text-white">
    <!-- Loading -->
    <div v-if="loading" class="space-y-1.5">
      <div v-for="i in 5" :key="i" class="hf-skel h-11 rounded-xl" :style="{ opacity: 1 - i * 0.14 }" />
    </div>

    <!-- Error -->
    <div v-else-if="error && !current" class="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 py-8 text-center">
      <UIcon name="i-lucide-cloud-off" class="size-8 text-white/40" />
      <p class="text-sm text-white/70">{{ error }}</p>
      <button type="button" class="hf-retry" @click="load">
        <UIcon name="i-lucide-refresh-cw" class="size-3.5" />
        Try again
      </button>
    </div>

    <!-- Empty -->
    <div v-else-if="!entries.length && !pinned" class="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-amber-200/20 bg-black/20 px-4 py-10 text-center">
      <div class="flex size-12 items-center justify-center rounded-2xl bg-amber-400/10 ring-1 ring-amber-300/30">
        <UIcon name="i-lucide-castle" class="size-6 text-amber-300" />
      </div>
      <p class="font-black tracking-wide text-amber-50">No one has held the line yet</p>
      <p class="text-xs text-white/55">Be the first name on the wall.</p>
    </div>

    <!-- Rows -->
    <template v-else>
      <div class="flex items-center gap-2.5 px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
        <span class="w-7 text-center">#</span>
        <span class="grow">Player</span>
        <span>Survived</span>
      </div>
      <ol class="hf-lb-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        <li
          v-for="entry in entries"
          :key="entry.rank"
          class="hf-row"
          :class="[
            entry.isCurrentUser ? 'is-me' : '',
            entry.rank <= 3 ? `is-top is-top-${entry.rank}` : ''
          ]"
        >
          <span class="flex w-7 shrink-0 justify-center font-mono text-sm font-bold text-white/55">
            <LeaderboardMedal v-if="entry.rank <= 3" :rank="entry.rank - 1" size="size-5" />
            <template v-else>{{ entry.rank }}</template>
          </span>
          <ProfileEmblem :emblem="entry.emblem" :name="entry.name" :prestige="entry.prestige" class="size-8 text-xs" />
          <div class="flex min-w-0 grow items-center gap-1.5">
            <PrestigeBadge :level="entry.prestige" size="xs" />
            <span class="truncate text-sm font-semibold text-white/90">{{ entry.name }}</span>
            <span v-if="entry.isCurrentUser" class="hf-you">You</span>
          </div>
          <UTooltip v-if="entry.won" text="Survived the full 25:00">
            <span class="hf-crown">
              <UIcon name="i-lucide-crown" class="size-3.5" />
            </span>
          </UTooltip>
          <span class="w-14 shrink-0 text-right font-mono text-sm font-black tabular-nums" :class="entry.won ? 'text-amber-300' : 'text-white'">
            {{ formatHoldfastTime(entry.survivedMs) }}
          </span>
        </li>
      </ol>

      <!-- The player's own row when they rank below the listed ones -->
      <div v-if="pinned" class="mt-2 border-t border-dashed border-white/15 pt-2">
        <div class="hf-row is-me">
          <span class="w-7 shrink-0 text-center font-mono text-sm font-bold text-white/60">{{ pinned.rank }}</span>
          <ProfileEmblem :emblem="pinned.emblem" :name="pinned.name" :prestige="pinned.prestige" class="size-8 text-xs" />
          <div class="flex min-w-0 grow items-center gap-1.5">
            <PrestigeBadge :level="pinned.prestige" size="xs" />
            <span class="truncate text-sm font-semibold text-white/90">{{ pinned.name }}</span>
            <span class="hf-you">You</span>
          </div>
          <span v-if="pinned.won" class="hf-crown">
            <UIcon name="i-lucide-crown" class="size-3.5" />
          </span>
          <span class="w-14 shrink-0 text-right font-mono text-sm font-black tabular-nums" :class="pinned.won ? 'text-amber-300' : 'text-white'">
            {{ formatHoldfastTime(pinned.survivedMs) }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.hf-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.4rem 0.625rem;
  border-radius: 0.8rem;
  border: 1px solid transparent;
  /* Keep gradients from repeating under the transparent border as a hairline. */
  background-origin: border-box;
  background-repeat: no-repeat;
  transition: background-color 0.15s, border-color 0.15s;
}

.hf-row:hover {
  background-color: rgba(255, 255, 255, 0.06);
}

.hf-row.is-top {
  background-image: linear-gradient(90deg, var(--hf-top), transparent 75%);
}

.hf-row.is-top-1 {
  --hf-top: rgba(250, 204, 21, 0.14);
}

.hf-row.is-top-2 {
  --hf-top: rgba(203, 213, 225, 0.1);
}

.hf-row.is-top-3 {
  --hf-top: rgba(217, 119, 6, 0.12);
}

.hf-row.is-me {
  background-image: linear-gradient(90deg, rgba(251, 191, 36, 0.2), rgba(251, 191, 36, 0.07));
  border-color: rgba(252, 211, 77, 0.45);
  box-shadow: inset 0 0 14px -6px rgba(251, 191, 36, 0.6);
}

.hf-you {
  flex-shrink: 0;
  border-radius: 0.3rem;
  padding: 0.15rem 0.3rem;
  font-size: 0.56rem;
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #3a1d03;
  background: linear-gradient(180deg, #fde68a, #f59e0b);
}

.hf-crown {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 999px;
  color: #fcd34d;
  background: rgba(251, 191, 36, 0.15);
  border: 1px solid rgba(252, 211, 77, 0.45);
}

.hf-retry {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  padding: 0.4rem 0.9rem;
  font-size: 0.78rem;
  font-weight: 800;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  transition: background-color 0.15s, border-color 0.15s;
}

.hf-retry:hover {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(252, 211, 77, 0.45);
}

.hf-retry:focus-visible {
  outline: 2px solid #fde68a;
  outline-offset: 2px;
}

.hf-skel {
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0.05));
  background-size: 200% 100%;
  animation: hf-shimmer 1.3s linear infinite;
}

.hf-lb-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(252, 211, 77, 0.35) transparent;
}

@keyframes hf-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .hf-skel {
    animation: none;
  }
}
</style>
