<script setup lang="ts">
// Full-cover canvas for confetti, papel picado flags and gold coins. Purely
// cosmetic, so Math.random is fine. The loop only runs while particles live.

interface Bit {
  kind: 'rect' | 'flag' | 'coin' | 'star'
  x: number
  y: number
  vx: number
  vy: number
  r: number
  vr: number
  size: number
  color: string
  phase: number
  life: number
  max: number
}

const COLORS = ['#ff2d6f', '#ffb400', '#00c2a8', '#7b3cff', '#ff6a00', '#2ec5ff', '#7ed321', '#ffe066', '#ff7ad9']

const canvas = ref<HTMLCanvasElement>()
let ctx2d: CanvasRenderingContext2D | null = null
let bits: Bit[] = []
let raf = 0
let last = 0
let rainUntil = 0
let rainRate = 0
let dpr = 1
let w = 0
let h = 0

function resize() {
  const el = canvas.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
  w = rect.width
  h = rect.height
  el.width = Math.round(w * dpr)
  el.height = Math.round(h * dpr)
  ctx2d = el.getContext('2d')
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function add(x: number, y: number, vx: number, vy: number, coins: boolean) {
  if (bits.length > 900) return
  const roll = Math.random()
  const kind: Bit['kind'] = coins && roll < 0.3 ? 'coin' : roll < 0.62 ? 'rect' : roll < 0.85 ? 'flag' : 'star'
  const life = 180 + Math.random() * 120
  bits.push({
    kind, x, y, vx, vy,
    r: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.25,
    size: kind === 'flag' ? 14 + Math.random() * 8 : kind === 'coin' ? 10 + Math.random() * 6 : 7 + Math.random() * 6,
    color: kind === 'coin' ? '#ffcc33' : pick(COLORS),
    phase: Math.random() * Math.PI * 2,
    life, max: life
  })
}

/** Cannon of confetti from a point (fractions of the canvas, 0..1). */
function burst(fx = 0.5, fy = 0.5, count = 120, power = 1, coins = false) {
  resize()
  const x = fx * w
  const y = fy * h
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5
    const sp = (6 + Math.random() * 12) * power
    add(x, y, Math.cos(a) * sp, Math.sin(a) * sp, coins)
  }
  run()
}

/** Confetti falling from the top edge for `ms`. */
function rain(ms = 3000, rate = 4) {
  resize()
  rainUntil = performance.now() + ms
  rainRate = rate
  run()
}

function stop() {
  rainUntil = 0
  bits = []
  if (ctx2d) ctx2d.clearRect(0, 0, w * dpr, h * dpr)
}

function run() {
  if (raf) return
  last = performance.now()
  raf = requestAnimationFrame(frame)
}

function drawBit(g: CanvasRenderingContext2D, b: Bit, t: number) {
  const flip = Math.cos(t * 0.008 + b.phase)
  g.save()
  g.translate(b.x, b.y)
  g.rotate(b.r)
  g.globalAlpha = Math.min(1, b.life / 40)
  if (b.kind === 'rect') {
    g.scale(1, flip)
    g.fillStyle = b.color
    g.fillRect(-b.size / 2, -b.size / 3, b.size, b.size * 0.66)
  } else if (b.kind === 'flag') {
    g.scale(flip, 1)
    const s = b.size
    g.fillStyle = b.color
    g.beginPath()
    g.moveTo(-s / 2, -s / 2)
    g.lineTo(s / 2, -s / 2)
    g.lineTo(s / 2, s * 0.3)
    for (let i = 0; i <= 6; i++) g.lineTo(s / 2 - (i * s) / 6, i % 2 === 0 ? s * 0.3 : s * 0.5)
    g.closePath()
    g.fill()
    g.globalCompositeOperation = 'destination-out'
    g.beginPath()
    g.arc(0, -s * 0.05, s * 0.16, 0, Math.PI * 2)
    g.fill()
    g.globalCompositeOperation = 'source-over'
  } else if (b.kind === 'coin') {
    g.scale(flip, 1)
    const grad = g.createLinearGradient(-b.size, -b.size, b.size, b.size)
    grad.addColorStop(0, '#fff3a6')
    grad.addColorStop(0.5, '#ffc21a')
    grad.addColorStop(1, '#b86b00')
    g.fillStyle = grad
    g.beginPath()
    g.arc(0, 0, b.size, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = 'rgba(120,60,0,0.6)'
    g.lineWidth = 1.5
    g.beginPath()
    g.arc(0, 0, b.size * 0.7, 0, Math.PI * 2)
    g.stroke()
  } else {
    g.fillStyle = b.color
    g.beginPath()
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? b.size : b.size * 0.45
      const a = (i * Math.PI) / 5
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
    }
    g.closePath()
    g.fill()
  }
  g.restore()
}

function frame(now: number) {
  raf = 0
  const g = ctx2d
  if (!g) return
  const dt = Math.min(3, (now - last) / 16.67)
  last = now
  if (now < rainUntil) {
    const n = rainRate * dt
    for (let i = 0; i < n; i++) add(Math.random() * w, -20, (Math.random() - 0.5) * 2, 1 + Math.random() * 2, true)
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i]!
    b.vx *= Math.pow(0.985, dt)
    b.vy = b.vy * Math.pow(0.985, dt) + 0.22 * dt
    if (b.vy > 3.2 && b.kind !== 'coin') {
      b.vy = 3.2
      b.vx += Math.sin(now * 0.004 + b.phase) * 0.12 * dt
    }
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.r += b.vr * dt
    b.life -= dt
    if (b.life <= 0 || b.y > h + 40) {
      bits[i] = bits[bits.length - 1]!
      bits.pop()
      continue
    }
    drawBit(g, b, now)
  }
  if (bits.length > 0 || now < rainUntil) raf = requestAnimationFrame(frame)
  else g.clearRect(0, 0, w, h)
}

onMounted(() => {
  resize()
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  bits = []
  window.removeEventListener('resize', resize)
})

defineExpose({ burst, rain, stop })
</script>

<template>
  <canvas
    ref="canvas"
    class="pointer-events-none absolute inset-0 size-full"
    aria-hidden="true"
  />
</template>
