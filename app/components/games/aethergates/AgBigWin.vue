<script setup lang="ts">
import { AG_WIN_TIERS, agWinTier } from '~/utils/slots/aethergates-ui'

// Big-win celebration: the amount counts up and the title climbs through the
// tiers (Big -> Mega -> Epic -> Mythic) as it passes each threshold. Tap to
// skip the count, tap again to close.

const props = defineProps<{
  amount: number
  bet: number
  turbo?: boolean
  /** Bumped by the parent (Space key) to skip / close like a tap. */
  skip?: number
}>()

const emit = defineEmits<{
  tier: [index: number]
  tick: [progress: number]
  landed: []
  done: []
}>()

const finalTier = agWinTier(props.bet > 0 ? props.amount / props.bet : 0)
const shown = ref(0)
const tier = ref(0)
const counting = ref(true)
let raf = 0
let holdTimer: ReturnType<typeof setTimeout> | null = null
let lastTick = 0
const start = performance.now()
const duration = (2000 + Math.max(0, finalTier) * 1400) * (props.turbo ? 0.6 : 1)

const current = computed(() => AG_WIN_TIERS[Math.max(0, tier.value)]!)

// Cosmetic coin shower.
const coins = Array.from({ length: 34 }, (_, i) => ({
  left: `${(i * 29.7) % 100}%`,
  delay: `${((i * 0.37) % 2.4).toFixed(2)}s`,
  duration: `${(1.6 + (i % 5) * 0.35).toFixed(2)}s`,
  size: `${14 + (i % 4) * 6}px`,
  spin: `${(i % 2 ? 1 : -1) * (360 + (i % 3) * 180)}deg`
}))

function finish() {
  cancelAnimationFrame(raf)
  shown.value = props.amount
  if (tier.value !== finalTier) {
    tier.value = Math.max(0, finalTier)
    emit('tier', tier.value)
  }
  counting.value = false
  emit('landed')
  holdTimer = setTimeout(() => emit('done'), props.turbo ? 1400 : 2600)
}

function frame(now: number) {
  const t = Math.min(1, (now - start) / duration)
  const eased = 1 - (1 - t) ** 2.2
  shown.value = props.amount * eased
  const reached = agWinTier(props.bet > 0 ? shown.value / props.bet : 0)
  if (reached > tier.value) {
    tier.value = reached
    emit('tier', reached)
  }
  if (now - lastTick > 70) {
    lastTick = now
    emit('tick', t)
  }
  if (t < 1) raf = requestAnimationFrame(frame)
  else finish()
}

function onClick() {
  if (counting.value) finish()
  else {
    if (holdTimer) clearTimeout(holdTimer)
    emit('done')
  }
}

watch(() => props.skip, () => onClick())

onMounted(() => {
  emit('tier', 0)
  raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (holdTimer) clearTimeout(holdTimer)
})
</script>

<template>
  <div
    class="ag-bigwin"
    :style="{ '--from': current.from, '--to': current.to, '--glow': current.glow }"
    role="button"
    tabindex="0"
    @click="onClick"
    @keydown.space.prevent.stop="onClick"
  >
    <div class="ag-bigwin-rays" />
    <span
      v-for="(c, i) in coins"
      :key="i"
      class="ag-bigwin-coin"
      :style="{ 'left': c.left, 'animationDelay': c.delay, 'animationDuration': c.duration, 'width': c.size, 'height': c.size, '--spin': c.spin }"
    />
    <div class="ag-bigwin-body">
      <Transition
        name="ag-tier"
        mode="out-in"
      >
        <p
          :key="tier"
          class="ag-bigwin-title"
        >
          {{ current.label }}
        </p>
      </Transition>
      <p
        class="ag-bigwin-amount"
        :class="{ 'is-landed': !counting }"
      >
        {{ formatNumber(shown) }}
      </p>
      <p class="ag-bigwin-mult">
        {{ formatNumber(bet > 0 ? amount / bet : 0, false, 0) }}× bet
      </p>
      <p class="ag-bigwin-hint">
        {{ counting ? 'Tap to skip' : 'Tap to continue' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.ag-bigwin {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  overflow: hidden;
  cursor: pointer;
  background: radial-gradient(ellipse at center, rgba(20, 10, 40, 0.72), rgba(3, 2, 12, 0.92) 70%);
  outline: none;
}

.ag-bigwin-rays {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 180vmax;
  height: 180vmax;
  transform: translate(-50%, -50%);
  background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--to) 30%, transparent) 0deg 7deg, transparent 7deg 18deg);
  mask-image: radial-gradient(circle, black 0%, transparent 38%);
  animation: ag-bw-rays 18s linear infinite;
}

.ag-bigwin-coin {
  position: absolute;
  top: -40px;
  border-radius: 999px;
  background:
    radial-gradient(circle at 35% 30%, #fffbe0 0 12%, transparent 30%),
    radial-gradient(circle, #ffd966 0 45%, #c27c12 46% 58%, #f7cf62 59% 70%, #8a520c 71%);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  animation-name: ag-bw-coin;
  animation-timing-function: cubic-bezier(0.4, 0, 0.8, 1);
  animation-iteration-count: infinite;
}

.ag-bigwin-body {
  position: relative;
  text-align: center;
  padding: 0 16px;
}

.ag-bigwin-title {
  margin: 0;
  font-family: 'Cinzel Decorative', 'Cinzel', Georgia, serif;
  font-size: clamp(40px, 9vw, 92px);
  font-weight: 900;
  line-height: 1;
  text-transform: uppercase;
  background: linear-gradient(180deg, #ffffff 0%, var(--from) 30%, var(--to) 75%, #1a0f02 110%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-stroke: 1.5px rgba(26, 15, 2, 0.7);
  filter: drop-shadow(0 4px 0 rgba(0, 0, 0, 0.6)) drop-shadow(0 0 30px var(--glow));
  animation: ag-bw-throb 1.1s ease-in-out infinite alternate;
}

.ag-bigwin-amount {
  margin: 14px 0 0;
  font-family: 'Cinzel', Georgia, serif;
  font-size: clamp(36px, 7vw, 72px);
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: #fff7d6;
  -webkit-text-stroke: 2px #3b1d00;
  paint-order: stroke fill;
  text-shadow: 0 4px 0 rgba(0, 0, 0, 0.6), 0 0 28px rgba(252, 211, 77, 0.7);
}

.ag-bigwin-amount.is-landed {
  animation: ag-bw-land 480ms cubic-bezier(0.2, 1.6, 0.4, 1);
}

.ag-bigwin-mult {
  margin-top: 8px;
  font-size: 15px;
  font-weight: 800;
  color: rgba(254, 243, 199, 0.8);
  letter-spacing: 0.08em;
}

.ag-bigwin-hint {
  margin-top: 20px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(224, 231, 255, 0.5);
}

.ag-tier-enter-active {
  transition: transform 380ms cubic-bezier(0.2, 1.8, 0.4, 1), opacity 200ms ease;
}

.ag-tier-leave-active {
  transition: transform 160ms ease-in, opacity 160ms ease-in;
}

.ag-tier-enter-from {
  transform: scale(0.3);
  opacity: 0;
}

.ag-tier-leave-to {
  transform: scale(1.5);
  opacity: 0;
}

@keyframes ag-bw-rays {
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

@keyframes ag-bw-coin {
  0% {
    transform: translateY(0) rotateY(0deg);
    opacity: 1;
  }
  100% {
    transform: translateY(115vh) rotateY(var(--spin));
    opacity: 0.9;
  }
}

@keyframes ag-bw-throb {
  to {
    transform: scale(1.05);
  }
}

@keyframes ag-bw-land {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
  }
}
</style>
