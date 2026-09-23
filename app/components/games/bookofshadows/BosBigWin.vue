<script setup lang="ts">
// Win celebration for Book of Shadows: counts the amount up, escalating
// through Big → Mega → Epic → Legendary as it passes each threshold, over a
// fountain of coins and embers. Doubles as the free spins outro
// (mode="feature"). Click or Space skips the count; a second press closes.

const props = defineProps<{
  amount: number
  bet: number
  mode: 'win' | 'feature'
  spins?: number
  fast?: boolean
}>()

const emit = defineEmits<{
  tier: [index: number]
  tick: [progress: number]
  settled: []
  done: []
}>()

const TIERS = [
  { label: 'Big Win', min: 15 },
  { label: 'Mega Win', min: 50 },
  { label: 'Epic Win', min: 150 },
  { label: 'Legendary Win', min: 500 }
] as const

const shown = ref(0)
const tierIndex = ref(-1)
const settled = ref(false)
const slam = ref(0)

const finalTier = computed(() => {
  let index = -1
  TIERS.forEach((t, i) => {
    if (props.amount >= t.min * props.bet) index = i
  })
  return index
})

const label = computed(() => (tierIndex.value >= 0 ? TIERS[tierIndex.value]!.label : props.mode === 'feature' ? 'Total Win' : 'Win'))
const multiple = computed(() => (props.bet > 0 ? shown.value / props.bet : 0))

const canvasRef = ref<HTMLCanvasElement | null>(null)
let raf = 0
let closeTimer: ReturnType<typeof setTimeout> | null = null
let startAt = 0
let duration = 0
let lastTick = 0

function countDuration() {
  const base = props.fast ? 1400 : 2400
  const perTier = props.fast ? 900 : 1700
  return base + Math.max(0, finalTier.value) * perTier
}

function settle() {
  if (settled.value) return
  shown.value = props.amount
  if (finalTier.value !== tierIndex.value) {
    tierIndex.value = finalTier.value
    slam.value++
  }
  settled.value = true
  emit('settled')
  closeTimer = setTimeout(close, props.fast ? 1500 : 3200)
}

function close() {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = null
  emit('done')
}

function skip() {
  if (!settled.value) settle()
  else close()
}

defineExpose({ skip })

// --- coins + embers (cosmetic) ------------------------------------------------

interface Bit { x: number, y: number, vx: number, vy: number, r: number, spin: number, phase: number, life: number, coin: boolean, hue: number }
const bits: Bit[] = []
let lastFrame = 0
let spawnAcc = 0

function spawn(w: number, h: number, intensity: number) {
  const coin = Math.random() < 0.55
  const fromSide = Math.random() < 0.3
  bits.push({
    x: fromSide ? (Math.random() < 0.5 ? -10 : w + 10) : w * (0.3 + Math.random() * 0.4),
    y: fromSide ? h * (0.4 + Math.random() * 0.3) : h + 12,
    vx: fromSide ? (Math.random() * 0.5 + 0.2) * w * (Math.random() < 0.5 ? 1 : -1) * 0.6 : (Math.random() - 0.5) * w * 0.7,
    vy: -(h * (0.9 + Math.random() * 0.6 + intensity * 0.12)),
    r: coin ? 7 + Math.random() * 7 : 2 + Math.random() * 3,
    spin: 4 + Math.random() * 8,
    phase: Math.random() * 6,
    life: 0,
    coin,
    hue: Math.random()
  })
}

function drawCoin(g: CanvasRenderingContext2D, b: Bit, t: number) {
  const sx = Math.abs(Math.cos(b.phase + t * b.spin))
  g.save()
  g.translate(b.x, b.y)
  g.scale(Math.max(0.12, sx), 1)
  const grad = g.createRadialGradient(-b.r * 0.35, -b.r * 0.35, b.r * 0.1, 0, 0, b.r)
  grad.addColorStop(0, '#fff6cf')
  grad.addColorStop(0.45, '#f3c14f')
  grad.addColorStop(1, '#8a5a12')
  g.fillStyle = grad
  g.beginPath()
  g.arc(0, 0, b.r, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(255,236,170,0.8)'
  g.lineWidth = 1
  g.beginPath()
  g.arc(0, 0, b.r * 0.68, 0, Math.PI * 2)
  g.stroke()
  g.restore()
}

function frame(now: number) {
  raf = requestAnimationFrame(frame)
  const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000)
  lastFrame = now

  if (!settled.value) {
    const k = Math.min(1, (now - startAt) / duration)
    // ease-out so the last digits crawl, like a real meter
    const eased = 1 - Math.pow(1 - k, 2.2)
    shown.value = props.amount * eased
    let idx = -1
    TIERS.forEach((t, i) => {
      if (shown.value >= t.min * props.bet) idx = i
    })
    if (idx > tierIndex.value) {
      tierIndex.value = idx
      slam.value++
      emit('tier', idx)
    }
    if (now - lastTick > 70) {
      lastTick = now
      emit('tick', k)
    }
    if (k >= 1) settle()
  }

  const c = canvasRef.value
  if (!c) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = c.clientWidth
  const h = c.clientHeight
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
  }
  const g = c.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)

  const intensity = Math.max(0, tierIndex.value + 1)
  const rate = settled.value ? 10 + intensity * 6 : 26 + intensity * 16
  spawnAcc += dt * rate
  while (spawnAcc > 1 && bits.length < 260) {
    spawnAcc -= 1
    spawn(w, h, intensity)
  }
  const gravity = h * 1.25
  const t = now / 1000
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i]!
    b.life += dt
    b.vy += gravity * dt
    b.x += b.vx * dt
    b.y += b.vy * dt
    if (b.y > h + 30 || b.life > 4) {
      bits.splice(i, 1)
      continue
    }
    if (b.coin) {
      drawCoin(g, b, t)
    } else {
      g.globalCompositeOperation = 'lighter'
      const a = Math.max(0, 1 - b.life / 2.6)
      g.fillStyle = b.hue < 0.5 ? `rgba(255,160,60,${a})` : `rgba(255,220,140,${a})`
      g.beginPath()
      g.arc(b.x, b.y, b.r, 0, Math.PI * 2)
      g.fill()
      g.globalCompositeOperation = 'source-over'
    }
  }
}

onMounted(() => {
  duration = countDuration()
  startAt = performance.now()
  raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (closeTimer) clearTimeout(closeTimer)
  bits.length = 0
})
</script>

<template>
  <div
    class="bos-bigwin"
    :class="[`bos-bigwin-t${Math.max(0, tierIndex)}`, { 'bos-bigwin-settled': settled }]"
    role="button"
    tabindex="-1"
    @click="skip"
  >
    <div class="bos-bigwin-rays" />
    <canvas
      ref="canvasRef"
      class="bos-bigwin-canvas"
    />
    <div class="bos-bigwin-content">
      <p
        v-if="mode === 'feature'"
        class="bos-bigwin-kicker"
      >
        Free spins complete<span v-if="spins"> · {{ spins }} spins</span>
      </p>
      <p
        :key="slam"
        class="bos-bigwin-label"
      >
        {{ label }}
      </p>
      <p class="bos-bigwin-amount">
        {{ formatNumber(shown, false) }}
      </p>
      <p class="bos-bigwin-mult">
        {{ formatNumber(multiple, false) }}× bet
      </p>
      <p class="bos-bigwin-hint">
        {{ settled ? 'Click to continue' : 'Click to skip' }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.bos-bigwin {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  overflow: hidden;
  cursor: pointer;
  background: radial-gradient(ellipse 70% 60% at 50% 48%, rgba(40, 18, 6, 0.9), rgba(4, 2, 1, 0.97) 75%);
  backdrop-filter: blur(3px);
  border-radius: inherit;
}

.bos-bigwin-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.bos-bigwin-rays {
  position: absolute;
  left: 50%;
  top: 46%;
  width: 180vmax;
  height: 180vmax;
  translate: -50% -50%;
  background: repeating-conic-gradient(from 0deg, rgba(255, 196, 90, 0.13) 0deg 6deg, transparent 6deg 18deg);
  mask-image: radial-gradient(circle, #000 0%, transparent 42%);
  animation: bos-rays 26s linear infinite;
  pointer-events: none;
}

.bos-bigwin-t2 .bos-bigwin-rays,
.bos-bigwin-t3 .bos-bigwin-rays {
  background: repeating-conic-gradient(from 0deg, rgba(255, 90, 50, 0.16) 0deg 6deg, transparent 6deg 18deg);
  animation-duration: 14s;
}

@keyframes bos-rays {
  to {
    rotate: 360deg;
  }
}

.bos-bigwin-content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 16px;
  text-align: center;
}

.bos-bigwin-kicker {
  margin-bottom: 6px;
  color: #d9b77a;
  font-family: Cinzel, Georgia, serif;
  font-size: clamp(12px, 1.6vw, 16px);
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
}

.bos-bigwin-label {
  font-family: 'Cinzel Decorative', Cinzel, Georgia, serif;
  font-size: clamp(34px, 6.4vw, 84px);
  font-weight: 900;
  line-height: 1.05;
  letter-spacing: 0.02em;
  background: linear-gradient(180deg, #fffbe6 0%, #ffe08a 30%, #e5a42c 58%, #8c4d0c 100%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 4px 0 #2a1204) drop-shadow(0 0 26px rgba(255, 170, 60, 0.6));
  animation: bos-slam 520ms cubic-bezier(0.2, 1.6, 0.4, 1) both;
}

.bos-bigwin-t2 .bos-bigwin-label,
.bos-bigwin-t3 .bos-bigwin-label {
  background-image: linear-gradient(180deg, #fff1ea 0%, #ffb08a 28%, #ef4b2c 60%, #6d1106 100%);
  filter: drop-shadow(0 4px 0 #2a0703) drop-shadow(0 0 32px rgba(255, 70, 40, 0.7));
}

@keyframes bos-slam {
  0% {
    opacity: 0;
    transform: scale(2.4);
  }

  60% {
    opacity: 1;
    transform: scale(0.94);
  }

  100% {
    transform: scale(1);
  }
}

.bos-bigwin-amount {
  margin-top: 4px;
  color: #fff4d6;
  font-family: Cinzel, Georgia, serif;
  font-size: clamp(34px, 5.6vw, 72px);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-shadow: 0 3px 0 #2a1204, 0 0 30px rgba(255, 180, 70, 0.75);
}

.bos-bigwin-settled .bos-bigwin-amount {
  animation: bos-throb 1.1s ease-in-out infinite alternate;
}

@keyframes bos-throb {
  to {
    transform: scale(1.06);
  }
}

.bos-bigwin-mult {
  margin-top: 10px;
  color: #caa56a;
  font-family: Cinzel, Georgia, serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.bos-bigwin-hint {
  margin-top: 22px;
  color: rgba(230, 205, 160, 0.45);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}
</style>
