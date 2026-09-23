<script setup lang="ts">
// Spiñata big win celebration. Counts the win up through escalating tiers
// (Big, Mega, Insane), switching the music loop and confetti at each tier.
// Also used as the free spins summary, where it can show a win below the Big
// tier with its own title. Tap or Space skips the count, a second tap closes.
import SpinataConfetti from './SpinataConfetti.vue'
import type { SpinataSampleName } from '~/utils/spinata-sounds'
import type { SpinataSoundHandle } from '~/composables/spinata-sound'

export interface SpinataWinBreakdown {
  label: string
  value: number
}

interface ShowOptions {
  amount: number
  bet: number
  /** Title when the win stays below the Big tier (free spins summary). */
  title?: string
  breakdown?: SpinataWinBreakdown[]
  /** Close by itself after the count (auto-spin). */
  autoClose?: boolean
  turbo?: boolean
}

const TIERS = [
  { key: 'big', label: 'Big Win', mult: 15, intro: 'intoBig', loop: 'bigLoop', end: 'bigEnd' },
  { key: 'mega', label: 'Mega Win', mult: 40, intro: 'intoMega', loop: 'megaLoop', end: 'megaEnd' },
  { key: 'insane', label: 'Insane Win', mult: 100, intro: 'intoInsane', loop: 'insaneLoop', end: 'insaneEnd' }
] as const satisfies readonly { key: string, label: string, mult: number, intro: SpinataSampleName, loop: SpinataSampleName, end: SpinataSampleName }[]

const sound = useSpinataSound()

const open = ref(false)
const shown = ref(0)
const tierIndex = ref(-1)
const title = ref('')
const breakdown = ref<SpinataWinBreakdown[]>([])
const finished = ref(false)
const betRef = ref(1)
const confetti = ref<InstanceType<typeof SpinataConfetti>>()

const tierLabel = computed(() => tierIndex.value >= 0 ? TIERS[tierIndex.value]!.label : title.value)
const tierKey = computed(() => tierIndex.value >= 0 ? TIERS[tierIndex.value]!.key : 'plain')
const multiple = computed(() => betRef.value > 0 ? shown.value / betRef.value : 0)

let target = 0
let raf = 0
let startAt = 0
let duration = 0
let resolveFn: (() => void) | null = null
let loop: SpinataSoundHandle | null = null
let counter: SpinataSoundHandle | null = null
let introTimer: ReturnType<typeof setTimeout> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let autoClose = false

function tierFor(mult: number) {
  let idx = -1
  for (let i = 0; i < TIERS.length; i++) if (mult >= TIERS[i]!.mult) idx = i
  return idx
}

function clearTimers() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  if (introTimer) clearTimeout(introTimer)
  introTimer = null
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = null
}

function enterTier(idx: number) {
  tierIndex.value = idx
  const tier = TIERS[idx]!
  loop?.stop(0.25)
  loop = null
  sound.play(tier.intro)
  sound.synth('pop', 1)
  if (tier.key === 'big') sound.play('bigIntro', { delay: 0.35 })
  if (tier.key === 'insane') sound.play('insaneIntro', { delay: 0.3 })
  if (introTimer) clearTimeout(introTimer)
  introTimer = setTimeout(() => {
    if (open.value && !finished.value) loop = sound.play(tier.loop, { loop: true })
  }, tier.key === 'insane' ? 2300 : tier.key === 'big' ? 1500 : 900)
  confetti.value?.burst(0.5, 0.62, 90 + idx * 70, 1 + idx * 0.25, true)
  confetti.value?.rain(duration, 3 + idx * 3)
}

// Count up with an ease-out inside each tier band so every tier gets its moment.
function valueAt(p: number) {
  const eased = 1 - Math.pow(1 - p, 2.2)
  return target * eased
}

function step(now: number) {
  raf = 0
  const p = Math.min(1, (now - startAt) / duration)
  shown.value = valueAt(p)
  const idx = tierFor(shown.value / betRef.value)
  if (idx > tierIndex.value) enterTier(idx)
  if (p >= 1) {
    finish()
    return
  }
  raf = requestAnimationFrame(step)
}

function finish() {
  if (finished.value) return
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  shown.value = target
  const idx = tierFor(target / betRef.value)
  if (idx > tierIndex.value) enterTier(idx)
  finished.value = true
  counter?.stop(0.08)
  counter = null
  if (introTimer) clearTimeout(introTimer)
  introTimer = null
  loop?.stop(0.35)
  loop = null
  if (tierIndex.value >= 0) sound.play(TIERS[tierIndex.value]!.end)
  else sound.play('youWon')
  sound.play('meterCount')
  confetti.value?.burst(0.5, 0.55, 120, 1.2, true)
  closeTimer = setTimeout(close, autoClose ? 2200 : 6000)
}

function close() {
  if (!open.value) return
  clearTimers()
  counter?.stop(0.05)
  loop?.stop(0.2)
  counter = null
  loop = null
  open.value = false
  sound.duck(1)
  confetti.value?.stop()
  const r = resolveFn
  resolveFn = null
  r?.()
}

function onTap() {
  sound.play('click')
  if (!finished.value) finish()
  else close()
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.type === 'keydown' && !e.repeat) onTap()
  }
}

function show(options: ShowOptions): Promise<void> {
  clearTimers()
  target = Math.max(0, options.amount)
  betRef.value = options.bet > 0 ? options.bet : 1
  title.value = options.title ?? 'Win'
  breakdown.value = options.breakdown ?? []
  autoClose = !!options.autoClose
  shown.value = 0
  tierIndex.value = -1
  finished.value = false
  open.value = true
  const finalTier = tierFor(target / betRef.value)
  duration = (finalTier < 0 ? 2200 : 3200 + finalTier * 2600) * (options.turbo ? 0.6 : 1)
  sound.duck(0.25)
  if (finalTier < 0) {
    sound.play('totalWin')
    nextTick(() => {
      confetti.value?.burst(0.5, 0.6, 110, 1, true)
      confetti.value?.rain(duration, 3)
    })
  }
  counter = sound.play('counter', { loop: true })
  startAt = performance.now() + 250
  raf = requestAnimationFrame(step)
  return new Promise((resolve) => {
    resolveFn = resolve
  })
}

onMounted(() => {
  window.addEventListener('keydown', onKey, { capture: true })
  window.addEventListener('keyup', onKey, { capture: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, { capture: true })
  window.removeEventListener('keyup', onKey, { capture: true })
  close()
})

defineExpose({ show, close })
</script>

<template>
  <Teleport to="body">
    <Transition name="spn-bw">
      <div
        v-if="open"
        class="spn-bw"
        :class="`spn-bw--${tierKey}`"
        role="dialog"
        aria-live="polite"
        :aria-label="`${tierLabel}: ${formatNumber(target, false)}`"
        @click="onTap"
      >
        <div class="spn-bw__backdrop" />
        <div class="spn-bw__rays" />
        <SpinataConfetti ref="confetti" />

        <div class="spn-bw__stage">
          <img
            src="/slots/spinata/pinata.png"
            alt=""
            class="spn-bw__pinata"
            draggable="false"
          >
          <Transition
            name="spn-slam"
            mode="out-in"
          >
            <p
              :key="tierLabel"
              class="spn-bw__label"
            >
              {{ tierLabel }}
            </p>
          </Transition>
          <p class="spn-bw__amount">
            {{ formatNumber(shown, false) }}
          </p>
          <p class="spn-bw__mult">
            {{ formatNumber(multiple, false) }}× bet
          </p>
          <div
            v-if="breakdown.length && finished"
            class="spn-bw__breakdown"
          >
            <div
              v-for="row in breakdown"
              :key="row.label"
              class="spn-bw__row"
            >
              <span>{{ row.label }}</span>
              <span>{{ formatNumber(row.value, false) }}</span>
            </div>
          </div>
          <p class="spn-bw__hint">
            {{ finished ? 'Tap to collect' : 'Tap to skip' }}
          </p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.spn-bw {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  cursor: pointer;
  user-select: none;
  font-family: 'Lilita One', 'Arial Black', system-ui, sans-serif;
  --tier-a: #ffd23f;
  --tier-b: #ff8a1f;
  --tier-glow: rgba(255, 180, 40, 0.55);
}
.spn-bw--mega { --tier-a: #ff7ad9; --tier-b: #ff2d6f; --tier-glow: rgba(255, 60, 140, 0.6); }
.spn-bw--insane { --tier-a: #7df9ff; --tier-b: #b86bff; --tier-glow: rgba(140, 110, 255, 0.65); }
.spn-bw--plain { --tier-a: #ffe9a3; --tier-b: #ffb400; --tier-glow: rgba(255, 190, 60, 0.45); }

.spn-bw__backdrop {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 45%, rgba(60, 10, 70, 0.72), rgba(10, 2, 18, 0.93) 70%);
  backdrop-filter: blur(3px);
}

.spn-bw__rays {
  position: absolute;
  left: 50%;
  top: 44%;
  width: 180vmax;
  height: 180vmax;
  translate: -50% -50%;
  background: repeating-conic-gradient(from 0deg, var(--tier-glow) 0deg 7deg, transparent 7deg 18deg);
  mask-image: radial-gradient(circle, #000 0%, transparent 42%);
  -webkit-mask-image: radial-gradient(circle, #000 0%, transparent 42%);
  animation: spn-spin 22s linear infinite;
  opacity: 0.55;
}

.spn-bw__stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0 16px;
}

.spn-bw__pinata {
  width: clamp(110px, 18vmin, 190px);
  transform-origin: 50% 0;
  animation: spn-swing 1.6s ease-in-out infinite;
  filter: drop-shadow(0 0 28px var(--tier-glow)) drop-shadow(0 10px 18px rgba(0, 0, 0, 0.5));
  margin-bottom: -6px;
}

.spn-bw__label {
  font-size: clamp(44px, 9vw, 104px);
  line-height: 0.95;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  background: linear-gradient(180deg, #fff 0%, var(--tier-a) 38%, var(--tier-b) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-stroke: 3px #3a0a2e;
  paint-order: stroke fill;
  filter: drop-shadow(0 6px 0 #1c0418) drop-shadow(0 0 30px var(--tier-glow));
}

.spn-bw__amount {
  margin-top: 10px;
  font-size: clamp(40px, 7.5vw, 88px);
  line-height: 1;
  color: #fff6d6;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 4px 0 #6b2a00, 0 0 24px rgba(255, 200, 80, 0.7);
  padding: 8px 28px 12px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(40, 6, 40, 0.85), rgba(20, 2, 24, 0.9));
  border: 3px solid transparent;
  background-clip: padding-box;
  box-shadow: 0 0 0 3px var(--tier-a), 0 0 40px var(--tier-glow), inset 0 2px 0 rgba(255, 255, 255, 0.15);
}

.spn-bw__mult {
  margin-top: 12px;
  font-size: clamp(16px, 2.2vw, 22px);
  color: var(--tier-a);
  letter-spacing: 0.06em;
  text-shadow: 0 2px 0 #1c0418;
}

.spn-bw__breakdown {
  margin-top: 14px;
  min-width: 240px;
  padding: 10px 16px;
  border-radius: 14px;
  background: rgba(20, 3, 26, 0.75);
  border: 1px solid rgba(255, 210, 120, 0.3);
  font-family: system-ui, sans-serif;
  font-size: 14px;
  color: #f6dfff;
}
.spn-bw__row {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 3px 0;
  font-variant-numeric: tabular-nums;
}
.spn-bw__row span:last-child { font-weight: 800; color: #ffe38a; }

.spn-bw__hint {
  margin-top: 18px;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 235, 200, 0.55);
  animation: spn-blink 1.4s ease-in-out infinite;
}

.spn-bw-enter-active { transition: opacity 0.25s ease; }
.spn-bw-leave-active { transition: opacity 0.35s ease; }
.spn-bw-enter-from, .spn-bw-leave-to { opacity: 0; }

.spn-slam-enter-active { animation: spn-slam 0.5s cubic-bezier(0.2, 1.6, 0.4, 1); }
.spn-slam-leave-active { transition: opacity 0.12s, transform 0.12s; }
.spn-slam-leave-to { opacity: 0; transform: scale(1.3); }

@keyframes spn-slam {
  0% { transform: scale(2.6) rotate(-6deg); opacity: 0; }
  60% { transform: scale(0.92) rotate(1deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); }
}
@keyframes spn-swing {
  0%, 100% { transform: rotate(-9deg); }
  50% { transform: rotate(9deg); }
}
@keyframes spn-spin { to { rotate: 360deg; } }
@keyframes spn-blink { 50% { opacity: 0.35; } }

@media (prefers-reduced-motion: reduce) {
  .spn-bw__rays, .spn-bw__pinata { animation: none; }
}
</style>
