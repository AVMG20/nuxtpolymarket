<script setup lang="ts">
// Free-spins intro, retrigger and outro card. It slams in with a particle
// fire burning along its top edge; the outro counts the feature total up over
// `countMs`. Math.random only drives the cosmetic flames.
const props = defineProps<{
  kind: 'fs' | 'fs-end' | 'retrigger'
  title: string
  sub: string
  amount: number
  art?: string
  countMs?: number
}>()

defineEmits<{ skip: [] }>()

const shown = ref(props.kind === 'fs-end' ? 0 : props.amount)
let raf = 0

// --- flames ---------------------------------------------------------------------
const flameCanvas = ref<HTMLCanvasElement | null>(null)
let flameRaf = 0

/** Hot to cool: white core, then the flame body, then the smoky tips. */
const FIRE = ['#fff7dc', '#ffd23a', '#ff7a14', '#c81e0a']
const ICE = ['#f4ffff', '#8af0ff', '#2a8cff', '#1a2ab8']

interface Flame { x: number, y: number, vx: number, vy: number, life: number, max: number, size: number, seed: number }

function softSprite(color: string, px = 64): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = px
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2)
  grad.addColorStop(0, color)
  grad.addColorStop(0.35, color)
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, px, px)
  return c
}

function startFlames() {
  const canvas = flameCanvas.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const sprites = (props.kind === 'retrigger' ? ICE : FIRE).map(c => softSprite(c))
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const flames: Flame[] = []
  const base = h - 14
  const cap = w < 360 ? 160 : 280

  function spawn() {
    // Most flames rise along the whole edge; some crowd the centre so the
    // fire peaks behind the portal art like a crown.
    const centre = Math.random() < 0.4
    const x = centre ? w / 2 + (Math.random() - Math.random()) * w * 0.22 : 10 + Math.random() * (w - 20)
    const tall = centre ? 1.5 : 1
    flames.push({
      x,
      y: base + Math.random() * 6,
      vx: (Math.random() - 0.5) * 12,
      vy: -(38 + Math.random() * 46) * tall,
      life: 0,
      max: (0.55 + Math.random() * 0.5) * tall,
      size: (10 + Math.random() * 12) * (centre ? 1.25 : 1),
      seed: Math.random() * 10
    })
  }

  let last = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const want = still ? 0 : Math.round(w * 0.9 * dt * 6)
    for (let i = 0; i < want && flames.length < cap; i++) spawn()

    ctx.clearRect(0, 0, w, h)
    // A glowing bed under the flames, where they meet the card's edge.
    const bed = ctx.createLinearGradient(0, base - 10, 0, h)
    bed.addColorStop(0, 'rgba(0,0,0,0)')
    bed.addColorStop(1, props.kind === 'retrigger' ? 'rgba(80,190,255,0.45)' : 'rgba(255,140,40,0.5)')
    ctx.fillStyle = bed
    ctx.fillRect(8, base - 10, w - 16, h - base + 10)

    ctx.globalCompositeOperation = 'lighter'
    for (let i = flames.length - 1; i >= 0; i--) {
      const f = flames[i]!
      f.life += dt
      const t = f.life / f.max
      if (t >= 1) {
        flames.splice(i, 1)
        continue
      }
      // Flicker sideways and narrow as they rise.
      f.x += (f.vx + Math.sin(now / 90 + f.seed) * 18) * dt
      f.y += f.vy * dt
      const r = f.size * (1 - t * 0.75)
      const sprite = sprites[t < 0.12 ? 0 : t < 0.38 ? 1 : t < 0.7 ? 2 : 3]!
      ctx.globalAlpha = (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9) * 0.85
      ctx.drawImage(sprite, f.x - r, f.y - r * 1.4, r * 2, r * 2.8)
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    if (!still) flameRaf = requestAnimationFrame(frame)
  }
  // Reduced motion: one settled frame of fire, no animation.
  if (still) for (let i = 0; i < 120; i++) spawn()
  flameRaf = requestAnimationFrame(frame)
}

onMounted(() => {
  startFlames()

  if (props.kind !== 'fs-end' || props.amount <= 0) {
    shown.value = props.amount
    return
  }
  const ms = props.countMs ?? 1600
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    shown.value = props.amount * (1 - (1 - t) ** 3)
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  cancelAnimationFrame(flameRaf)
})
</script>

<template>
  <div class="ep-card-wrap" @click="$emit('skip')">
    <div class="ep-card" :class="`is-${kind}`">
      <canvas ref="flameCanvas" class="ep-card__flames" aria-hidden="true" />
      <img v-if="art" :src="art" alt="" class="ep-card__art">
      <p class="ep-card__title">
        {{ title }}
      </p>
      <p v-if="kind === 'fs-end'" class="ep-card__amount" :class="{ 'is-zero': amount <= 0 }">
        {{ formatNumber(shown) }}
      </p>
      <p class="ep-card__sub">
        {{ sub }}
      </p>
      <p class="ep-card__hint">
        Tap to continue
      </p>
    </div>
  </div>
</template>

<style scoped>
.ep-card-wrap {
  position: absolute;
  inset: 0;
  z-index: 35;
  display: grid;
  place-items: center;
  padding: 16px;
  cursor: pointer;
  container-type: inline-size;
}

.ep-card {
  --c1: #ffc247;
  --c2: #ff5a1a;
  position: relative;
  width: min(460px, 92%);
  padding: 22px 24px 18px;
  border-radius: 22px;
  text-align: center;
  color: #e6ecff;
  background:
    radial-gradient(ellipse 90% 60% at 50% 0%, rgba(255, 138, 31, 0.4), transparent 70%),
    linear-gradient(180deg, #2a1a3a, #0b0f22 70%);
  border: 2px solid rgba(255, 194, 71, 0.7);
  box-shadow: 0 0 0 4px rgba(8, 10, 24, 0.9), 0 0 50px rgba(255, 138, 31, 0.6), 0 0 120px rgba(255, 90, 26, 0.35), 0 24px 60px rgba(0, 0, 0, 0.7);
  animation: ep-card-slam 0.55s cubic-bezier(0.2, 1.6, 0.35, 1) both;
}

.ep-card.is-retrigger {
  --c1: #9fe8ff;
  --c2: #1a8fd6;
  border-color: rgba(127, 220, 255, 0.8);
  background:
    radial-gradient(ellipse 90% 60% at 50% 0%, rgba(53, 198, 255, 0.4), transparent 70%),
    linear-gradient(180deg, #1b2447, #0b0f22 70%);
  box-shadow: 0 0 0 4px rgba(8, 10, 24, 0.9), 0 0 50px rgba(53, 198, 255, 0.6), 0 24px 60px rgba(0, 0, 0, 0.7);
}

.ep-card__flames {
  position: absolute;
  left: 0;
  right: 0;
  top: -96px;
  width: 100%;
  height: 112px;
  pointer-events: none;
}

.ep-card__art {
  display: block;
  width: clamp(72px, 22cqw, 120px);
  margin: -64px auto 6px;
  filter: drop-shadow(0 0 22px rgba(255, 138, 31, 0.9));
  animation: ep-card-spin 6s linear infinite;
}

.ep-card__title {
  font-family: var(--ep-display, Georgia, serif);
  font-size: clamp(30px, 9cqw, 58px);
  font-weight: 900;
  line-height: 1.05;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: linear-gradient(180deg, #ffffff 5%, var(--c1) 50%, var(--c2) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 3px 0 #140a06) drop-shadow(0 0 18px var(--c2));
  animation: ep-card-title 0.7s cubic-bezier(0.2, 1.8, 0.4, 1) 0.1s both;
}

.ep-card__amount {
  margin-top: 6px;
  font-family: var(--ep-number, Georgia, serif);
  font-size: clamp(32px, 9cqw, 58px);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #fff4dc;
  -webkit-text-stroke: 2px #140a06;
  paint-order: stroke fill;
  text-shadow: 0 3px 0 #140a06, 0 0 22px rgba(255, 170, 60, 0.9), 0 0 50px rgba(255, 110, 30, 0.6);
}

.ep-card__amount.is-zero { color: #9fb2d9; text-shadow: 0 3px 0 #140a06; }

.ep-card__sub {
  margin-top: 8px;
  font-family: var(--ep-ui, system-ui, sans-serif);
  font-size: clamp(13px, 2.8cqw, 15px);
  line-height: 1.5;
  color: #d9e2ff;
}

.ep-card__hint {
  margin-top: 10px;
  font-family: var(--ep-ui, system-ui, sans-serif);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(159, 178, 217, 0.7);
}

@keyframes ep-card-slam {
  0% { transform: scale(2.4) rotate(-4deg); opacity: 0; filter: brightness(3); }
  60% { transform: scale(0.94) rotate(1deg); opacity: 1; filter: brightness(1.4); }
  100% { transform: scale(1) rotate(0); filter: brightness(1); }
}

@keyframes ep-card-title {
  0% { transform: scale(0.2); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes ep-card-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ep-card, .ep-card__title { animation-duration: 0.01s; }
  .ep-card__art { animation: none; }
}
</style>
