<script setup lang="ts">
// Big-win celebration for Candy Madness. Counts the amount up and upgrades the
// banner as it passes each tier (BIG → MEGA → EPIC → LEGENDARY). A tap skips to
// the end; a second tap (or the hold timer) closes it.
import { CANDY_WIN_TIERS } from '~/utils/slots/candymadness-ui'

const props = defineProps<{
  amount: number
  bet: number
  subtitle?: string
}>()

const emit = defineEmits<{
  tier: [index: number]
  tick: []
  done: []
}>()

const shown = ref(0)
const tierIndex = ref(0)
const finished = ref(false)
let raf = 0
let holdTimer: ReturnType<typeof setTimeout> | null = null
let lastTick = 0

const finalTier = computed(() => {
  const x = props.amount / props.bet
  let idx = 0
  CANDY_WIN_TIERS.forEach((t, i) => {
    if (x >= t.at) idx = i
  })
  return idx
})

const tier = computed(() => CANDY_WIN_TIERS[tierIndex.value]!)

// Cosmetic confetti layout.
const CONFETTI_COLORS = ['#ff5fa8', '#ffd23a', '#5ee0a0', '#58c4ff', '#b77bff', '#ffffff', '#ff9a2e']
const confetti = Array.from({ length: 70 }, (_, i) => ({
  left: `${Math.random() * 100}%`,
  delay: `${-Math.random() * 3}s`,
  dur: `${2.2 + Math.random() * 2}s`,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  w: 6 + Math.random() * 8,
  h: 4 + Math.random() * 5,
  round: i % 3 === 0,
  sway: `${(Math.random() * 2 - 1) * 80}px`
}))

function finish() {
  if (finished.value) return
  cancelAnimationFrame(raf)
  shown.value = props.amount
  if (tierIndex.value !== finalTier.value) {
    tierIndex.value = finalTier.value
    emit('tier', tierIndex.value)
  }
  finished.value = true
  holdTimer = setTimeout(() => emit('done'), 2200)
}

function onClick() {
  if (!finished.value) finish()
  else {
    if (holdTimer) clearTimeout(holdTimer)
    emit('done')
  }
}

onMounted(() => {
  emit('tier', 0)
  const duration = 2200 + finalTier.value * 1500
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    // ease-out, but keep it moving so every tier gets its moment
    const e = 1 - Math.pow(1 - t, 2.2)
    shown.value = props.amount * e
    const x = shown.value / props.bet
    const next = CANDY_WIN_TIERS.findLastIndex(tt => x >= tt.at)
    if (next > tierIndex.value) {
      tierIndex.value = next
      emit('tier', next)
    }
    if (now - lastTick > 70) {
      lastTick = now
      emit('tick')
    }
    if (t < 1) raf = requestAnimationFrame(step)
    else finish()
  }
  raf = requestAnimationFrame(step)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (holdTimer) clearTimeout(holdTimer)
})
</script>

<template>
  <div
    class="cmbw"
    :style="{ '--tier-a': tier.from, '--tier-b': tier.to, '--tier-glow': tier.glow }"
    @click="onClick"
  >
    <div class="cmbw__rays" />
    <div class="cmbw__confetti">
      <i
        v-for="(c, i) in confetti"
        :key="i"
        :style="{ 'left': c.left, 'animationDelay': c.delay, 'animationDuration': c.dur, 'background': c.color, 'width': `${c.w}px`, 'height': `${c.h}px`, 'borderRadius': c.round ? '50%' : '2px', '--sway': c.sway }"
      />
    </div>
    <div class="cmbw__body">
      <p
        v-if="subtitle"
        class="cmbw__sub"
      >
        {{ subtitle }}
      </p>
      <Transition
        name="cmbw-label"
        mode="out-in"
      >
        <p
          :key="tierIndex"
          class="cmbw__label"
        >
          {{ tier.label }}
        </p>
      </Transition>
      <p
        class="cmbw__amount"
        :class="{ 'cmbw__amount--done': finished }"
      >
        <UIcon
          name="i-lucide-coins"
          class="cmbw__coin"
        />
        {{ formatNumber(shown, false, 2) }}
      </p>
      <p class="cmbw__x">
        {{ formatNumber(shown / bet, false) }}× bet
      </p>
      <p class="cmbw__hint">
        {{ finished ? 'Tap to continue' : 'Tap to skip' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.cmbw {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  background: radial-gradient(circle at 50% 50%, rgba(60, 8, 80, 0.72), rgba(16, 2, 28, 0.9));
  backdrop-filter: blur(2px);
}

.cmbw__rays {
  position: absolute;
  inset: -50%;
  background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--tier-a) 30%, transparent) 0deg 9deg, transparent 9deg 22deg);
  mask-image: radial-gradient(circle, #000 0%, transparent 55%);
  animation: cmbw-spin 14s linear infinite;
}

@keyframes cmbw-spin {
  to { transform: rotate(360deg); }
}

.cmbw__confetti i {
  position: absolute;
  top: -20px;
  animation: cmbw-fall linear infinite;
}

@keyframes cmbw-fall {
  0% { transform: translate(0, 0) rotate(0); }
  50% { transform: translate(var(--sway), 55vh) rotate(360deg); }
  100% { transform: translate(0, 110vh) rotate(720deg); }
}

.cmbw__body {
  position: relative;
  text-align: center;
  padding: 0 16px;
}

.cmbw__sub {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: #ffe6f4;
  margin-bottom: 4px;
}

.cmbw__label {
  font-family: 'Lilita One', 'Baloo 2', system-ui, sans-serif;
  font-size: clamp(44px, 11vw, 92px);
  line-height: 0.95;
  font-weight: 900;
  letter-spacing: 0.02em;
  background: linear-gradient(180deg, #fff 0%, var(--tier-a) 35%, var(--tier-b) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-stroke: 2px rgba(60, 0, 50, 0.55);
  filter: drop-shadow(0 5px 0 rgba(70, 0, 60, 0.7)) drop-shadow(0 0 28px var(--tier-glow));
  animation: cmbw-throb 0.9s ease-in-out infinite alternate;
}

@keyframes cmbw-throb {
  from { transform: scale(1) rotate(-1.5deg); }
  to { transform: scale(1.06) rotate(1.5deg); }
}

.cmbw__amount {
  margin-top: 12px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: clamp(30px, 7vw, 56px);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #fff7d6;
  text-shadow: 0 3px 0 #9a3a00, 0 0 24px rgba(255, 200, 60, 0.8);
  padding: 6px 22px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(90, 20, 90, 0.85), rgba(40, 6, 50, 0.85));
  border: 3px solid #ffd35a;
  box-shadow: 0 0 0 3px rgba(120, 30, 80, 0.8), 0 10px 30px rgba(0, 0, 0, 0.5);
}

.cmbw__amount--done {
  animation: cmbw-land 0.45s cubic-bezier(0.3, 1.8, 0.5, 1);
}

@keyframes cmbw-land {
  from { transform: scale(1.25); }
  to { transform: scale(1); }
}

.cmbw__coin {
  width: 0.8em;
  height: 0.8em;
  color: #ffd35a;
}

.cmbw__x {
  margin-top: 10px;
  font-size: 14px;
  font-weight: 800;
  color: #ffd6ee;
  letter-spacing: 0.08em;
}

.cmbw__hint {
  margin-top: 14px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(255, 220, 240, 0.55);
}

.cmbw-label-enter-active { transition: transform 0.35s cubic-bezier(0.3, 1.8, 0.5, 1), opacity 0.2s; }
.cmbw-label-leave-active { transition: transform 0.15s, opacity 0.15s; }
.cmbw-label-enter-from { transform: scale(2.2); opacity: 0; }
.cmbw-label-leave-to { transform: scale(0.6); opacity: 0; }
</style>
