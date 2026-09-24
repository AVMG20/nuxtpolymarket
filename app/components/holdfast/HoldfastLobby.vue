<script setup lang="ts">
import type { InternalApi } from 'nitropack/types'
import { BLOODMOON_AT, DIFFICULTIES, MAP_SIZE, TERRITORY, WAVE_WARNING } from '#shared/utils/holdfast/config'
import { HOLDFAST_DIFFICULTIES, HOLDFAST_WIN_MS, holdfastIsDifficulty, type HoldfastDifficulty } from '#shared/utils/holdfast/meta'
import { formatHoldfastTime } from '~/utils/holdfast/format'

type HoldfastState = InternalApi['/api/holdfast/state']['get']

const props = withDefaults(defineProps<{
  /** The parent is calling start-run: spin the start button. */
  busy?: boolean
}>(), {
  busy: false
})

const emit = defineEmits<{
  start: [difficulty: HoldfastDifficulty]
}>()

const { user } = useAuth()
const toast = useToast()

const selected = ref<HoldfastDifficulty>('easy')
const boardTab = ref<HoldfastDifficulty>('easy')
watch(selected, (d) => { boardTab.value = d })

const helpOpen = ref(false)

// Personal bests. Signed-out players have none, and the endpoint would 401.
const state = shallowRef<HoldfastState | null>(null)
const stateLoading = ref(false)

async function loadState() {
  if (!user.value) return
  stateLoading.value = true
  try {
    state.value = await apiFetch<HoldfastState>('/api/holdfast/state')
  } catch (e) {
    toast.add({ title: apiErrorMessage(e, 'Could not load your Holdfast records'), color: 'error' })
  } finally {
    stateLoading.value = false
  }
}

onMounted(loadState)
defineExpose({ refresh: loadState })

// The menu is always dark glass over the live scene, so these are fixed game
// colours rather than theme tokens.
const LEVEL: Record<HoldfastDifficulty, { label: string, chipClass: string, skulls: number, skullClass: string }> = {
  easy: { label: 'Easy', chipClass: 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/40', skulls: 1, skullClass: 'text-emerald-300' },
  normal: { label: 'Normal', chipClass: 'bg-amber-400/15 text-amber-200 ring-amber-300/40', skulls: 2, skullClass: 'text-amber-300' },
  hard: { label: 'Hard', chipClass: 'bg-red-500/20 text-red-200 ring-red-400/45', skulls: 3, skullClass: 'text-red-400' }
}

// Schematic of each map, drawn straight from the difficulty config so it can
// never disagree with the game: the keep, its starting territory and an arrow
// from every raider lane pointing at it. 100×100 viewBox with an 8 unit margin.
const PAD = 8
const toView = (v: number) => PAD + v / MAP_SIZE * (100 - PAD * 2)
const ARROW = 15

const maps = computed(() => HOLDFAST_DIFFICULTIES.map((id) => {
  const def = DIFFICULTIES[id]
  const keep = { x: toView(def.keep.x), y: toView(def.keep.z) }
  const arrows = def.lanes.map((lane) => {
    const x1 = toView(lane.x)
    const y1 = toView(lane.z)
    const dx = keep.x - x1
    const dy = keep.y - y1
    const len = Math.hypot(dx, dy) || 1
    return { x1, y1, x2: x1 + dx / len * ARROW, y2: y1 + dy / len * ARROW }
  })
  const territory = TERRITORY[0] / MAP_SIZE * (100 - PAD * 2)
  return { id, keep, arrows, territory }
}))

// Marker ids end up in `url(#…)`, which a colon or similar would break.
const markerId = `hf-arrow-${useId().replace(/[^\w-]/g, '')}`

const cards = computed(() => maps.value.map(map => ({
  ...map,
  def: DIFFICULTIES[map.id],
  level: LEVEL[map.id],
  best: state.value?.bests[map.id] ?? null
})))

const boardTabs = computed(() => HOLDFAST_DIFFICULTIES.map(id => ({
  label: DIFFICULTIES[id].name,
  value: id
})))

const selectedName = computed(() => DIFFICULTIES[selected.value].name)
const winTime = formatHoldfastTime(HOLDFAST_WIN_MS)

function pickBoard(value: string | number) {
  if (holdfastIsDifficulty(value)) boardTab.value = value
}

function start() {
  if (props.busy) return
  emit('start', selected.value)
}

const HOW_TO: { title: string, icon: string, lines: string[] }[] = [
  {
    title: 'Build your economy',
    icon: 'i-lucide-coins',
    lines: [
      'Gold and wood pay for buildings and walls.',
      'The stonemason turns wood into stone (needs keep level 2).',
      'Crystal mines dig up crystals, which buy upgrades.',
      'Every extra building of the same type costs more, so upgrade what you have.'
    ]
  },
  {
    title: 'Command your packs',
    icon: 'i-lucide-swords',
    lines: [
      'Place packs of warriors and archers from the toolbar. Rings show where they will stand.',
      'Archers placed on a wall stand on it and shoot further.',
      'Select a pack and right-click (or tap Move) to send it somewhere.',
      'Packs pick their own fights once they are in place.'
    ]
  },
  {
    title: 'Wall up',
    icon: 'i-lucide-brick-wall',
    lines: [
      'Drag to draw a whole line of wall in one go.',
      'Gates let your own units through.'
    ]
  },
  {
    title: 'Survive the siege',
    icon: 'i-lucide-moon',
    lines: [
      `Raiders attack from marked lanes, with a ${WAVE_WARNING}s warning before each wave.`,
      'Speed up to 2x whenever you like, but there is no pause.',
      `At minute ${BLOODMOON_AT} the Bloodmoon rises and raiders get brutal.`,
      `Survive ${winTime} to win.`
    ]
  }
]

const CONTROLS: { keys: string[], action: string }[] = [
  { keys: ['W', 'A', 'S', 'D'], action: 'Pan (also arrows, screen edge or right-drag)' },
  { keys: ['Wheel'], action: 'Zoom (pinch on touch)' },
  { keys: ['Q', 'E'], action: 'Rotate the camera' },
  { keys: ['Space'], action: 'Centre on the keep' },
  { keys: ['1–9'], action: 'Toolbar hotkeys' },
  { keys: ['Esc'], action: 'Cancel the current tool' },
  { keys: ['Shift'], action: 'Hold to keep a tool active' },
  { keys: ['F'], action: 'Toggle 2x speed' }
]
</script>

<template>
  <div class="hf-lobby hf-scroll absolute inset-0 overflow-x-hidden overflow-y-auto text-white">
    <!-- Scrims: shade only where the menu sits and leave the live scene clear -->
    <div aria-hidden="true" class="pointer-events-none fixed inset-0">
      <div class="hf-scrim absolute inset-0" />
      <div class="hf-scrim-edges absolute inset-0" />
    </div>

    <div class="relative mx-auto flex min-h-full max-w-[96rem] flex-col gap-4 p-4 sm:p-6 lg:gap-4 lg:px-10 lg:py-5">
      <!-- Top bar -->
      <header class="hf-in flex items-center justify-between gap-2" style="--d: 0s">
        <NuxtLink to="/" class="hf-chip-btn">
          <UIcon name="i-lucide-arrow-left" class="size-4" />
          Games
        </NuxtLink>
        <button type="button" class="hf-chip-btn" @click="helpOpen = true">
          <UIcon name="i-lucide-scroll-text" class="size-4 text-amber-200" />
          How to play
        </button>
      </header>

      <div class="grid flex-1 gap-6 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)_minmax(0,22rem)] lg:items-center lg:gap-8">
        <!-- Left column: title, grounds, start -->
        <div class="flex w-full max-w-xl flex-col gap-5 lg:max-w-none">
          <div class="hf-in" style="--d: 0.05s">
            <div class="hf-kicker">
              <UIcon name="i-lucide-swords" class="size-4" />
              Castle defence RTS
            </div>
            <h1 class="hf-title mt-1">
              Holdfast
            </h1>
            <div class="hf-rule mt-3" aria-hidden="true" />
            <p class="hf-shadow mt-3 text-lg font-extrabold text-amber-50 sm:text-xl">
              Hold the keep. Survive the Bloodmoon.
            </p>
            <p class="hf-desc hf-shadow mt-1 max-w-md text-sm leading-relaxed text-white/75">
              Build up, wall in and command packs of warriors and archers against endless raiders.
              Last {{ winTime }} to claim victory.
            </p>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <span class="hf-info-chip">
                <UIcon name="i-lucide-timer" class="size-3.5 text-amber-200" /> {{ winTime }} to win
              </span>
              <span class="hf-info-chip">
                <UIcon name="i-lucide-moon" class="size-3.5 text-red-300" /> Bloodmoon at {{ BLOODMOON_AT }}:00
              </span>
              <span v-if="state?.runs" class="hf-info-chip">
                <UIcon name="i-lucide-flag" class="size-3.5 text-sky-300" /> {{ formatNumber(state.runs) }} {{ state.runs === 1 ? 'run' : 'runs' }} played
              </span>
            </div>
          </div>

          <!-- Difficulty picker -->
          <section class="flex flex-col gap-2.5" aria-labelledby="hf-grounds">
            <h2 id="hf-grounds" class="hf-section-label hf-in" style="--d: 0.15s">
              Choose your ground
            </h2>

            <button
              v-for="(card, i) in cards"
              :key="card.id"
              type="button"
              class="hf-card hf-in group"
              :class="{ 'is-selected': selected === card.id }"
              :style="{ '--d': `${0.2 + i * 0.08}s` }"
              :aria-pressed="selected === card.id"
              @click="selected = card.id"
            >
              <!-- Map schematic -->
              <span class="hf-map">
                <svg
                  viewBox="0 0 100 100"
                  class="size-full"
                  role="img"
                  :aria-label="`${card.def.name} map: keep and raider lanes`"
                >
                  <defs>
                    <marker
                      :id="`${markerId}-${card.id}`"
                      viewBox="0 0 10 10"
                      refX="6"
                      refY="5"
                      markerWidth="4"
                      markerHeight="4"
                      orient="auto-start-reverse"
                    >
                      <path d="M0 0 L10 5 L0 10 z" fill="#f87171" />
                    </marker>
                    <radialGradient :id="`${markerId}-${card.id}-ground`" cx="50%" cy="40%" r="75%">
                      <stop offset="0%" stop-color="#3f7a4f" />
                      <stop offset="100%" stop-color="#1c3a2a" />
                    </radialGradient>
                  </defs>
                  <rect x="0" y="0" width="100" height="100" :fill="`url(#${markerId}-${card.id}-ground)`" />
                  <!-- Tufts of grass for texture -->
                  <g fill="#bbf7d0" opacity="0.16">
                    <circle cx="20" cy="78" r="4" />
                    <circle cx="80" cy="22" r="5" />
                    <circle cx="74" cy="84" r="3" />
                    <circle cx="16" cy="24" r="3" />
                    <circle cx="58" cy="12" r="2.5" />
                  </g>
                  <circle
                    :cx="card.keep.x"
                    :cy="card.keep.y"
                    :r="card.territory"
                    fill="#fbbf24"
                    fill-opacity="0.16"
                    stroke="#fcd34d"
                    stroke-opacity="0.8"
                    stroke-width="1"
                    stroke-dasharray="3 3"
                  />
                  <line
                    v-for="(arrow, a) in card.arrows"
                    :key="a"
                    :x1="arrow.x1"
                    :y1="arrow.y1"
                    :x2="arrow.x2"
                    :y2="arrow.y2"
                    stroke="#f87171"
                    stroke-width="3"
                    stroke-linecap="round"
                    :marker-end="`url(#${markerId}-${card.id})`"
                  />
                  <!-- The keep -->
                  <g :transform="`translate(${card.keep.x} ${card.keep.y})`" fill="#fde68a" stroke="#78350f" stroke-width="0.6">
                    <rect x="-7" y="-4" width="14" height="10" rx="1.5" />
                    <rect x="-7" y="-8" width="3.5" height="5" rx="0.8" />
                    <rect x="-1.75" y="-8" width="3.5" height="5" rx="0.8" />
                    <rect x="3.5" y="-8" width="3.5" height="5" rx="0.8" />
                    <rect x="-2" y="1" width="4" height="5" rx="2" fill="#1c3a2a" stroke="none" />
                  </g>
                </svg>
              </span>

              <span class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="flex items-center justify-between gap-2">
                  <span class="hf-shadow truncate text-xl font-black leading-tight tracking-wide">{{ card.def.name }}</span>
                  <span class="hf-check" aria-hidden="true">
                    <UIcon name="i-lucide-check" class="size-3.5" />
                  </span>
                </span>
                <span class="flex items-center gap-2">
                  <span class="rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1" :class="card.level.chipClass">
                    {{ card.level.label }}
                  </span>
                  <span class="flex items-center gap-0.5" :aria-label="`Difficulty ${card.level.skulls} of 3`">
                    <UIcon
                      v-for="n in 3"
                      :key="n"
                      name="i-lucide-skull"
                      class="size-3.5"
                      :class="n <= card.level.skulls ? card.level.skullClass : 'text-white/20'"
                    />
                  </span>
                </span>
                <span class="line-clamp-2 text-xs leading-snug text-white/65">{{ card.def.blurb }}</span>
                <span class="mt-auto flex items-center justify-between gap-2 border-t border-white/10 pt-1.5">
                  <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Your best</span>
                  <span v-if="stateLoading && !state" class="hf-skel h-4 w-14 rounded-md" />
                  <span v-else-if="card.best" class="flex items-center gap-1.5">
                    <span v-if="card.best.won" class="hf-victory-chip">
                      <UIcon name="i-lucide-crown" class="size-3" /> Victory
                    </span>
                    <span class="font-mono text-sm font-black tabular-nums" :class="card.best.won ? 'text-amber-300' : 'text-white'">
                      {{ formatHoldfastTime(card.best.survivedMs) }}
                    </span>
                  </span>
                  <span v-else class="text-xs italic text-white/40">Not yet held</span>
                </span>
              </span>
            </button>
          </section>

          <!-- Start: sticks to the bottom of the screen whenever the column is taller than it -->
          <div class="hf-in sticky bottom-3 z-10" style="--d: 0.5s">
            <div class="hf-start">
              <button
                v-if="user"
                type="button"
                class="hf-gold-btn w-full"
                :disabled="busy"
                :aria-busy="busy"
                @click="start"
              >
                <UIcon
                  :name="busy ? 'i-lucide-loader-circle' : 'i-lucide-swords'"
                  class="size-7 shrink-0"
                  :class="busy ? 'animate-spin' : ''"
                />
                <span class="flex flex-col items-start leading-none">
                  <span class="text-2xl uppercase tracking-[0.2em]">Start</span>
                  <span class="mt-1 text-xs font-bold opacity-75">March to {{ selectedName }}</span>
                </span>
              </button>
              <NuxtLink v-else to="/login" class="hf-gold-btn w-full">
                <UIcon name="i-lucide-log-in" class="size-6 shrink-0" />
                <span class="text-xl uppercase tracking-[0.14em]">Sign in to play</span>
              </NuxtLink>
            </div>
          </div>
        </div>

        <!-- The scene shows through here -->
        <div class="hidden lg:block" aria-hidden="true" />

        <!-- Leaderboard -->
        <section
          class="hf-glass hf-in hf-in-right flex min-h-0 flex-col p-4 lg:max-h-[calc(100dvh-8rem)]"
          style="--d: 0.35s"
          aria-labelledby="hf-hall"
        >
          <div class="flex items-center gap-3">
            <span class="hf-emblem">
              <UIcon name="i-lucide-trophy" class="size-4.5" />
            </span>
            <div class="min-w-0">
              <h2 id="hf-hall" class="text-base font-black leading-tight tracking-wide text-amber-100">
                Hall of the Holdfast
              </h2>
              <p class="text-[11px] text-white/50">Longest holds on each ground</p>
            </div>
          </div>

          <div class="hf-pills mt-3" role="tablist" aria-label="Leaderboard ground">
            <button
              v-for="tab in boardTabs"
              :key="tab.value"
              type="button"
              role="tab"
              class="hf-pill"
              :class="{ 'is-active': boardTab === tab.value }"
              :aria-selected="boardTab === tab.value"
              @click="pickBoard(tab.value)"
            >
              {{ tab.label }}
            </button>
          </div>

          <HoldfastLeaderboard :difficulty="boardTab" class="mt-3 max-h-[26rem] min-h-0 lg:max-h-none lg:flex-1" />
        </section>
      </div>
    </div>

    <!-- How to play -->
    <UModal
      v-model:open="helpOpen"
      title="How to play Holdfast"
      description="Hold the keep until the clock runs out."
      :ui="{
        overlay: 'bg-[#05080c]/70 backdrop-blur-sm',
        content: 'sm:max-w-2xl bg-transparent ring-0 shadow-none divide-y-0 rounded-[1.25rem]'
      }"
    >
      <template #content>
        <div class="hf-glass flex min-h-0 flex-1 flex-col overflow-hidden text-white">
          <header class="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
            <div>
              <div class="hf-kicker">
                <UIcon name="i-lucide-scroll-text" class="size-4" />
                Field manual
              </div>
              <div class="hf-title hf-title-sm mt-1">How to play</div>
              <p class="mt-1 text-sm text-white/60">Hold the keep until the clock runs out.</p>
            </div>
            <button type="button" class="hf-close" aria-label="Close" @click="helpOpen = false">
              <UIcon name="i-lucide-x" class="size-5" />
            </button>
          </header>

          <div class="hf-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            <div class="grid gap-3 sm:grid-cols-2">
              <div v-for="section in HOW_TO" :key="section.title" class="hf-manual-card">
                <div class="flex items-center gap-2.5">
                  <span class="hf-emblem">
                    <UIcon :name="section.icon" class="size-4" />
                  </span>
                  <h3 class="text-sm font-black tracking-wide text-amber-50">{{ section.title }}</h3>
                </div>
                <ul class="mt-3 space-y-1.5 text-xs leading-relaxed text-white/70">
                  <li v-for="line in section.lines" :key="line" class="flex gap-2">
                    <span class="mt-[0.4rem] size-1.5 shrink-0 rotate-45 bg-amber-300" />
                    <span>{{ line }}</span>
                  </li>
                </ul>
              </div>
            </div>

            <div>
              <h3 class="hf-section-label mb-3">
                Controls
              </h3>
              <div class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <div v-for="control in CONTROLS" :key="control.action" class="flex items-center gap-3 text-xs">
                  <span class="flex w-[8.5rem] shrink-0 items-center gap-1">
                    <kbd v-for="key in control.keys" :key="key" class="hf-kbd">{{ key }}</kbd>
                  </span>
                  <span class="text-white/70">{{ control.action }}</span>
                </div>
              </div>
            </div>
          </div>

          <footer class="flex justify-end border-t border-white/10 bg-black/20 px-5 py-4 sm:px-6">
            <button type="button" class="hf-gold-btn hf-gold-btn-sm" @click="helpOpen = false">
              <UIcon name="i-lucide-swords" class="size-5" />
              To arms
            </button>
          </footer>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
/* ---------- Scrims ---------- */
.hf-scrim {
  background: linear-gradient(180deg, rgba(10, 14, 20, 0.55), rgba(10, 14, 20, 0.72));
}

.hf-scrim-edges {
  background:
    linear-gradient(180deg, rgba(10, 14, 20, 0.5) 0%, transparent 16%),
    linear-gradient(0deg, rgba(10, 14, 20, 0.55) 0%, transparent 20%);
}

@media (min-width: 1024px) {
  .hf-scrim {
    background:
      linear-gradient(90deg, rgba(10, 14, 20, 0.8) 0%, rgba(10, 14, 20, 0.66) 24%, rgba(10, 14, 20, 0.3) 40%, transparent 54%),
      linear-gradient(270deg, rgba(10, 14, 20, 0.5) 0%, rgba(10, 14, 20, 0.22) 20%, transparent 32%),
      radial-gradient(ellipse 80% 90% at 62% 50%, transparent 60%, rgba(10, 14, 20, 0.3) 100%);
  }
}

/* ---------- Type ---------- */
.hf-shadow {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7), 0 0 12px rgba(0, 0, 0, 0.35);
}

.hf-kicker {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.7rem;
  font-weight: 900;
  letter-spacing: 0.38em;
  text-transform: uppercase;
  color: #fde68a;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

/* Inline-block so the gradient spans exactly the letters, even if they overhang the column. */
.hf-title {
  display: inline-block;
  font-size: clamp(3.2rem, 5.4vw, 5.1rem);
  font-weight: 900;
  line-height: 0.92;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: transparent;
  background: linear-gradient(180deg, #fffbeb 0%, #fde68a 26%, #fbbf24 50%, #e08a0c 74%, #9a4a0a 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-stroke: 1px rgba(255, 246, 220, 0.3);
  filter:
    drop-shadow(0 2px 0 #6b3407)
    drop-shadow(0 3px 0 #3b1d05)
    drop-shadow(0 10px 22px rgba(0, 0, 0, 0.6));
}

.hf-title-sm {
  font-size: 2rem;
  letter-spacing: 0.06em;
}

.hf-rule {
  position: relative;
  height: 2px;
  width: min(18rem, 70%);
  margin-left: 0.9rem;
  background: linear-gradient(90deg, #fbbf24, rgba(251, 191, 36, 0));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.hf-rule::before {
  content: '';
  position: absolute;
  left: -0.9rem;
  top: 50%;
  width: 0.55rem;
  height: 0.55rem;
  transform: translateY(-50%) rotate(45deg);
  background: #fcd34d;
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.8);
}

.hf-section-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.7rem;
  font-weight: 900;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgba(253, 230, 138, 0.9);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.hf-section-label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgba(253, 230, 138, 0.45), transparent);
}

/* ---------- Surfaces ---------- */
.hf-glass {
  border-radius: 1.25rem;
  background: linear-gradient(180deg, rgba(24, 28, 37, 0.8), rgba(11, 14, 20, 0.88));
  border: 1px solid rgba(252, 211, 77, 0.24);
  box-shadow:
    0 24px 48px -18px rgba(0, 0, 0, 0.75),
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    inset 0 0 0 1px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(14px) saturate(1.2);
  -webkit-backdrop-filter: blur(14px) saturate(1.2);
}

.hf-info-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border-radius: 999px;
  padding: 0.3rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(10, 14, 20, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.hf-emblem {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.7rem;
  color: #fcd34d;
  background: radial-gradient(circle at 50% 30%, rgba(251, 191, 36, 0.3), rgba(120, 53, 15, 0.35));
  border: 1px solid rgba(252, 211, 77, 0.45);
  box-shadow: inset 0 1px 0 rgba(255, 240, 200, 0.2), 0 4px 10px rgba(0, 0, 0, 0.35);
}

.hf-skel {
  display: block;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.06));
  background-size: 200% 100%;
  animation: hf-shimmer 1.3s linear infinite;
}

/* ---------- Buttons ---------- */
.hf-chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  padding: 0.45rem 0.95rem;
  font-size: 0.8rem;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.92);
  background: rgba(10, 14, 20, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 6px 16px -8px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.6);
  transition: transform 0.15s, background-color 0.15s, border-color 0.15s;
}

.hf-chip-btn:hover {
  transform: translateY(-1px);
  background: rgba(20, 26, 36, 0.72);
  border-color: rgba(252, 211, 77, 0.45);
}

.hf-chip-btn:focus-visible,
.hf-card:focus-visible,
.hf-pill:focus-visible,
.hf-close:focus-visible {
  outline: 2px solid #fde68a;
  outline-offset: 2px;
}

.hf-start {
  position: relative;
  isolation: isolate;
}

.hf-start::before {
  content: '';
  position: absolute;
  inset: -0.5rem -0.25rem -0.75rem;
  z-index: -1;
  border-radius: 1.5rem;
  background: radial-gradient(ellipse at center, rgba(251, 191, 36, 0.5), transparent 70%);
  filter: blur(12px);
  animation: hf-breathe 2.8s ease-in-out infinite;
}

.hf-gold-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.85rem;
  overflow: hidden;
  padding: 0.95rem 1.75rem;
  border-radius: 1rem;
  font-weight: 900;
  color: #3a1d03;
  background: linear-gradient(180deg, #fff3c4 0%, #fcd34d 24%, #f59e0b 68%, #d97706 100%);
  border: 1px solid #fde68a;
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, 0.7),
    inset 0 -3px 0 rgba(146, 64, 14, 0.45),
    0 6px 0 #8a4a0b,
    0 7px 0 rgba(40, 20, 3, 0.7),
    0 16px 30px -8px rgba(0, 0, 0, 0.65);
  text-shadow: 0 1px 0 rgba(255, 244, 214, 0.65);
  cursor: pointer;
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

.hf-gold-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.07) saturate(1.08);
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, 0.75),
    inset 0 -3px 0 rgba(146, 64, 14, 0.45),
    0 8px 0 #8a4a0b,
    0 9px 0 rgba(40, 20, 3, 0.7),
    0 0 36px 4px rgba(251, 191, 36, 0.55),
    0 20px 34px -8px rgba(0, 0, 0, 0.6);
}

.hf-gold-btn:hover:not(:disabled)::after {
  left: 120%;
}

.hf-gold-btn:active:not(:disabled) {
  transform: translateY(5px);
  filter: brightness(0.97);
  box-shadow:
    inset 0 2px 4px rgba(120, 53, 15, 0.45),
    inset 0 -1px 0 rgba(146, 64, 14, 0.4),
    0 1px 0 #8a4a0b,
    0 2px 0 rgba(40, 20, 3, 0.7),
    0 6px 14px -6px rgba(0, 0, 0, 0.6);
}

.hf-gold-btn:disabled {
  cursor: progress;
  filter: saturate(0.7) brightness(0.9);
}

.hf-gold-btn:focus-visible {
  outline: 3px solid #fef3c7;
  outline-offset: 4px;
}

.hf-gold-btn-sm {
  gap: 0.5rem;
  padding: 0.6rem 1.4rem;
  border-radius: 0.8rem;
  font-size: 0.95rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hf-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex-shrink: 0;
  border-radius: 0.7rem;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  transition: color 0.15s, background-color 0.15s, transform 0.15s;
}

.hf-close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  transform: rotate(90deg);
}

/* ---------- Difficulty cards ---------- */
.hf-card {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 0.9rem;
  width: 100%;
  padding: 0.7rem 0.85rem 0.7rem 0.7rem;
  text-align: left;
  border-radius: 1.1rem;
  background: linear-gradient(180deg, rgba(26, 30, 40, 0.76), rgba(12, 15, 21, 0.86));
  border: 1px solid rgba(255, 236, 200, 0.13);
  box-shadow: 0 12px 28px -16px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  cursor: pointer;
  transition: translate 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), border-color 0.2s, box-shadow 0.2s, background 0.2s;
}

.hf-card::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 1rem;
  bottom: 1rem;
  width: 4px;
  border-radius: 0 4px 4px 0;
  background: linear-gradient(180deg, #fde68a, #f59e0b);
  box-shadow: 0 0 12px rgba(251, 191, 36, 0.9);
  opacity: 0;
  transform: scaleY(0.4);
  transition: opacity 0.2s, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.hf-card:hover {
  translate: 4px -2px;
  border-color: rgba(252, 211, 77, 0.4);
  box-shadow: 0 18px 32px -16px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.hf-card.is-selected {
  translate: 8px 0;
  border-color: rgba(252, 211, 77, 0.85);
  background-image: linear-gradient(180deg, rgba(64, 46, 18, 0.84), rgba(26, 19, 10, 0.9));
  box-shadow:
    0 0 0 1px rgba(252, 211, 77, 0.3),
    0 0 30px -6px rgba(245, 158, 11, 0.65),
    0 16px 30px -14px rgba(0, 0, 0, 0.85),
    inset 0 1px 0 rgba(255, 240, 200, 0.2);
}

.hf-card.is-selected:hover {
  translate: 10px -2px;
}

.hf-card.is-selected::before {
  opacity: 1;
  transform: scaleY(1);
}

.hf-map {
  position: relative;
  display: block;
  flex-shrink: 0;
  width: 4.75rem;
  height: 4.75rem;
  align-self: center;
  overflow: hidden;
  border-radius: 0.85rem;
  border: 1px solid rgba(252, 211, 77, 0.28);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4), 0 6px 14px -6px rgba(0, 0, 0, 0.7);
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), border-color 0.2s;
}

.hf-card:hover .hf-map {
  transform: scale(1.05) rotate(-2deg);
}

.hf-card.is-selected .hf-map {
  border-color: rgba(253, 230, 138, 0.9);
}

.hf-check {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 999px;
  color: #3a1d03;
  background: linear-gradient(180deg, #fde68a, #f59e0b);
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.7);
  opacity: 0;
  transform: scale(0.4);
  transition: opacity 0.18s, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.hf-card.is-selected .hf-check {
  opacity: 1;
  transform: scale(1);
}

.hf-victory-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  border-radius: 0.4rem;
  padding: 0.1rem 0.4rem;
  font-size: 0.6rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #3a1d03;
  background: linear-gradient(180deg, #fde68a, #f59e0b);
}

/* Short desktop windows: drop the blurb so the start button stays in view. */
@media (min-width: 1024px) and (max-height: 860px) {
  .hf-desc {
    display: none;
  }
}

@media (max-width: 639px) {
  .hf-map {
    width: 4.5rem;
    height: 4.5rem;
  }

  .hf-card.is-selected {
    translate: 4px 0;
  }
}

/* ---------- Leaderboard pills ---------- */
.hf-pills {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.hf-pill {
  flex: 1;
  border-radius: 999px;
  padding: 0.35rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.6);
  transition: color 0.15s, background-color 0.15s, box-shadow 0.15s;
}

.hf-pill:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.07);
}

.hf-pill.is-active {
  color: #3a1d03;
  background: linear-gradient(180deg, #fde68a, #f59e0b);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 2px 8px rgba(245, 158, 11, 0.4);
}

/* ---------- How to play ---------- */
.hf-manual-card {
  border-radius: 1rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.09);
}

.hf-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.6rem;
  height: 1.6rem;
  padding: 0 0.4rem;
  border-radius: 0.4rem;
  font-family: ui-monospace, monospace;
  font-size: 0.68rem;
  font-weight: 800;
  color: #fef3c7;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.05));
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-bottom-width: 3px;
  border-bottom-color: rgba(0, 0, 0, 0.5);
}

/* ---------- Scrollbars ---------- */
.hf-scroll {
  scrollbar-width: thin;
  scrollbar-color: rgba(252, 211, 77, 0.35) transparent;
}

/* Last, so the background shorthands above cannot reset it: gradients would
   otherwise repeat under the translucent borders as a hairline. */
.hf-glass,
.hf-card,
.hf-gold-btn,
.hf-pill {
  background-origin: border-box;
}

/* ---------- Motion ---------- */
.hf-in {
  animation: hf-rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  animation-delay: var(--d, 0s);
}

.hf-in-right {
  animation-name: hf-rise-right;
}

@keyframes hf-rise {
  from {
    opacity: 0;
    transform: translateX(-18px);
  }
}

@keyframes hf-rise-right {
  from {
    opacity: 0;
    transform: translateX(24px);
  }
}

@keyframes hf-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

@keyframes hf-breathe {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.9; }
}

@media (prefers-reduced-motion: reduce) {
  .hf-in,
  .hf-start::before,
  .hf-skel {
    animation: none;
  }

  .hf-card,
  .hf-map,
  .hf-gold-btn,
  .hf-gold-btn::after {
    transition: none;
  }
}
</style>
