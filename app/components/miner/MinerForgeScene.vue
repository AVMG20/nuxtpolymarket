<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PALETTE, Particles, clamp, mixColor, noise, drawStickFigure } from '~/utils/miner-scene'

const props = defineProps<{
  factoryLevel: number
  factoryMaxLevel: number
  catalystLevel: number
  gemRateMultiplier: number
  gemCap: number
  /** Live fractional gem count. */
  pendingGems: number
  busy: boolean
}>()

const emit = defineEmits<{
  collect: []
  upgradeFactory: []
}>()

const wrap = ref<HTMLDivElement | null>(null)
let PIXI: any = null
let app: any = null
let destroyed = false
let resizeObserver: ResizeObserver | null = null
let bgG: any = null
let staticG: any = null
let liveG: any = null
let partG: any = null
const particles = new Particles()

const anchors = ref({ geode: { x: 0, y: 0 }, crate: { x: 0, y: 0 } })
const hovered = ref<'geode' | 'crate' | null>(null)

// Deliberately light on progression: the geode just grows a few more crystals.
const crystalCount = computed(() => 5 + Math.round((props.factoryLevel / props.factoryMaxLevel) * 7))

let L = {
  w: 0, h: 0, floor: 0, unit: 0,
  geodeX: 0, geodeY: 0, geodeR: 0,
  crateX: 0, crateY: 0, crateW: 0, crateH: 0
}

function layout(w: number, h: number) {
  const floor = h * 0.78
  const unit = clamp(h * 0.055, 14, 32)
  const geodeR = Math.min(w * 0.13, h * 0.3)
  const crateW = unit * 5
  L = {
    w, h, floor, unit,
    geodeX: w * 0.28, geodeY: floor - geodeR * 0.55, geodeR,
    crateX: w * 0.66, crateY: floor - unit * 2.4, crateW, crateH: unit * 2.4
  }
  anchors.value = {
    geode: { x: L.geodeX, y: floor - geodeR * 1.2 - unit * 0.5 },
    crate: { x: L.crateX + crateW / 2, y: L.crateY - unit * 1.2 }
  }
}

function hitTest(x: number, y: number): 'geode' | 'crate' | null {
  const u = L.unit
  if (x >= L.crateX - u && x <= L.crateX + L.crateW + u && y >= L.crateY - u * 2 && y <= L.floor + u) return 'crate'
  if (x >= L.geodeX - L.geodeR * 1.4 && x <= L.geodeX + L.geodeR * 1.4
    && y >= L.floor - L.geodeR * 1.35 && y <= L.floor + u) return 'geode'
  return null
}

function onPointerMove(e: PointerEvent) {
  const rect = wrap.value?.getBoundingClientRect()
  if (!rect) return
  hovered.value = hitTest(e.clientX - rect.left, e.clientY - rect.top)
}

function onPointerLeave() { hovered.value = null }

function onPointerDown(e: PointerEvent) {
  const rect = wrap.value?.getBoundingClientRect()
  if (!rect) return
  const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
  if (hit === 'crate') emit('collect')
  else if (hit === 'geode') emit('upgradeFactory')
}

let t = 0
let shake = 0
let drainUntil = 0
let drainFrom = 0

// The one worker on this page: chips at the geode, carries each gem to the crate.
const worker = reactive({
  x: 0,
  dir: -1 as 1 | -1,
  phase: 'toGeode' as 'toGeode' | 'chipping' | 'toCrate' | 'dropping',
  swingT: 0,
  swingsLeft: 4,
  carrying: 0,
  pauseT: 0
})

function displayGems() {
  if (t < drainUntil) {
    const k = 1 - (drainUntil - t) / 0.6
    return drainFrom * (1 - k * k)
  }
  return props.pendingGems
}

function playCollect() {
  drainFrom = displayGems()
  drainUntil = t + 0.6
  shake = 6
  const cx = L.crateX + L.crateW / 2
  const cy = L.crateY
  particles.burst(cx, cy, 24, PALETTE.cyan, { speed: L.unit * 9, size: 4, shape: 'shard', gravity: L.unit * 18 })
  for (let i = 0; i < 10; i++) {
    particles.spawnArc(cx, cy, L.w * (0.8 + noise(i) * 0.15), -30, 0.5 + noise(i * 2) * 0.2, PALETTE.cyanLight, L.unit * 0.16)
  }
}

function playUpgrade() {
  shake = 6
  particles.burst(L.geodeX, L.geodeY, 24, PALETTE.cyanLight, { speed: L.unit * 9, size: 3, shape: 'shard', gravity: L.unit * 16 })
}

function playReject(which: 'geode' | 'crate') {
  const x = which === 'geode' ? L.geodeX : L.crateX + L.crateW / 2
  particles.burst(x, L.floor - L.unit * 2, 10, PALETTE.danger, { speed: L.unit * 5, size: 3, shape: 'spark', gravity: L.unit * 18 })
}

defineExpose({ playCollect, playUpgrade, playReject })

// ─── Backdrop ───────────────────────────────────────────────────────────────
function drawBackdrop() {
  if (!bgG) return
  const g = bgG
  const { w, h, floor, unit: u } = L
  g.clear()
  g.rect(0, 0, w, h).fill({ color: 0x08100f })
  for (let i = 0; i < 12; i++) {
    const k = i / 12
    g.rect(0, h * 0.08 * k, w, h).fill({ color: mixColor(0x0d1a1c, 0x14262b, k), alpha: 0.16 })
  }
  // Ceiling with stalactites.
  g.moveTo(0, 0)
  g.lineTo(w, 0)
  g.lineTo(w, h * 0.1)
  for (let i = 16; i >= 0; i--) {
    g.lineTo((w * i) / 16, h * (0.05 + noise(i * 4.1) * 0.06))
  }
  g.closePath()
  g.fill({ color: 0x0c1517 })
  for (let i = 0; i < 10; i++) {
    const sx = noise(i * 5.3) * w
    const len = h * (0.03 + noise(i * 2.7) * 0.06)
    const sy = h * 0.08
    g.moveTo(sx - len * 0.2, sy)
    g.lineTo(sx, sy + len)
    g.lineTo(sx + len * 0.2, sy)
    g.closePath()
    g.fill({ color: 0x15252a })
  }
  // Floor.
  g.rect(0, floor, w, h - floor).fill({ color: 0x111d20 })
  g.rect(0, floor, w, 2).fill({ color: PALETTE.cyanDark, alpha: 0.28 })
  for (let i = 0; i < 40; i++) {
    g.circle(noise(i * 3.7) * w, floor + noise(i * 6.1) * (h - floor), 1 + noise(i) * 2)
      .fill({ color: 0x0a1416, alpha: 0.7 })
  }
  // A few small crystals scattered along the back wall.
  for (let i = 0; i < 9; i++) {
    const cx = noise(i * 7.1) * w
    const size = u * (0.5 + noise(i * 2.3) * 1.1)
    drawCrystal(g, cx, floor - size * 0.2, size, 0.35)
  }
  // Lamps.
  for (const lx of [w * 0.16, w * 0.52, w * 0.84]) {
    g.rect(lx - 1, h * 0.05, 2, h * 0.05).fill({ color: 0x475569 })
    g.circle(lx, h * 0.1, u * 0.26).fill({ color: PALETTE.lamp, alpha: 0.85 })
    g.circle(lx, h * 0.1, u * 1.1).fill({ color: PALETTE.lamp, alpha: 0.05 })
  }
}

/** A single crystal spike growing out of the ground or the geode. */
function drawCrystal(g: any, cx: number, baseY: number, size: number, alpha = 1, tilt = 0) {
  const tipX = cx + tilt * size * 0.5
  g.moveTo(tipX, baseY - size)
  g.lineTo(cx + size * 0.3, baseY - size * 0.25)
  g.lineTo(cx + size * 0.18, baseY)
  g.lineTo(cx - size * 0.18, baseY)
  g.lineTo(cx - size * 0.3, baseY - size * 0.25)
  g.closePath()
  g.fill({ color: PALETTE.cyan, alpha: alpha * 0.75 })
  g.moveTo(tipX, baseY - size)
  g.lineTo(cx - size * 0.3, baseY - size * 0.25)
  g.lineTo(cx - size * 0.18, baseY)
  g.closePath()
  g.fill({ color: PALETTE.cyanLight, alpha: alpha * 0.35 })
  g.moveTo(tipX, baseY - size).lineTo(cx, baseY)
    .stroke({ color: PALETTE.cyanLight, width: 1, alpha: alpha * 0.4 })
}

// ─── Static props ───────────────────────────────────────────────────────────
function drawStatic() {
  if (!staticG) return
  const g = staticG
  g.clear()
  const u = L.unit

  // The geode: a rock outcrop split open, with big crystals growing out of the
  // cavity. Drawn as solid rock rather than a glowing disc so it sits in the cave.
  const { geodeX: x, geodeY: y, geodeR: r } = L
  const bottom = L.floor
  // Outer rock body — an irregular mound anchored to the floor.
  g.moveTo(x - r * 1.15, bottom)
  const steps = 12
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI + (i / steps) * Math.PI
    const rr = r * (1.02 + noise(i * 3.7) * 0.22)
    g.lineTo(x + Math.cos(a) * rr, bottom + Math.sin(a) * rr * 1.05)
  }
  g.closePath()
  g.fill({ color: 0x1d3136 })
  g.stroke({ color: 0x27454d, width: 3, alpha: 0.9 })
  // Cavity.
  g.moveTo(x - r * 0.66, bottom)
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI + (i / 10) * Math.PI
    const rr = r * (0.62 + noise(i * 5.1) * 0.1)
    g.lineTo(x + Math.cos(a) * rr, bottom + Math.sin(a) * rr * 0.95)
  }
  g.closePath()
  g.fill({ color: 0x07171b })

  // Crystals filling the cavity — the count is the only progression here.
  for (let i = 0; i < crystalCount.value; i++) {
    const k = (i + 0.5) / crystalCount.value
    const cx = x - r * 0.52 + k * r * 1.04 + (noise(i * 4.3) - 0.5) * r * 0.12
    const size = r * (0.42 + noise(i * 3.3) * 0.45)
    drawCrystal(g, cx, bottom - noise(i * 6.7) * r * 0.12, size, 0.95, (noise(i * 5.1) - 0.5) * 0.5)
  }
  // A couple of loose crystals and rubble at the foot of the outcrop.
  for (let i = 0; i < 4; i++) {
    const rx = x + (noise(i * 4.7) - 0.5) * r * 2.6
    drawCrystal(g, rx, bottom, u * (0.5 + noise(i * 2.1) * 0.7), 0.7, (noise(i) - 0.5) * 0.8)
  }
  for (let i = 0; i < 7; i++) {
    g.ellipse(x + (noise(i * 8.3) - 0.5) * r * 2.4, bottom - u * 0.1, u * (0.25 + noise(i) * 0.3), u * 0.16)
      .fill({ color: 0x1d3136 })
  }

  // Collection crate under a small sorting frame.
  const { crateX: cx2, crateY: cy2, crateW: cw, crateH: ch } = L
  g.rect(cx2, cy2, cw, ch).fill({ color: 0x2a3b40 })
  g.rect(cx2, cy2, cw, ch).stroke({ color: 0x16262a, width: 2 })
  for (let i = 1; i < 3; i++) {
    g.moveTo(cx2, cy2 + (ch / 3) * i).lineTo(cx2 + cw, cy2 + (ch / 3) * i)
      .stroke({ color: 0x16262a, width: 1.5, alpha: 0.8 })
  }
  g.rect(cx2 - u * 0.2, cy2 - u * 0.25, cw + u * 0.4, u * 0.28).fill({ color: 0x475569 })
}

// ─── Live pass ──────────────────────────────────────────────────────────────
function updateWorker(dt: number) {
  const u = L.unit
  const speed = u * 3 * props.gemRateMultiplier
  const geodeTarget = L.geodeX + L.geodeR * 1.1 + u * 0.8
  const crateTarget = L.crateX - u * 0.8
  if (worker.x === 0) worker.x = crateTarget

  if (worker.pauseT > 0) {
    worker.pauseT -= dt
    return
  }
  if (worker.phase === 'toGeode') {
    worker.dir = -1
    worker.x -= speed * dt
    if (worker.x <= geodeTarget) {
      worker.x = geodeTarget
      worker.phase = 'chipping'
      worker.swingT = 0
      worker.swingsLeft = 4
    }
  } else if (worker.phase === 'chipping') {
    const prev = worker.swingT
    worker.swingT += dt * 3.4 * props.gemRateMultiplier
    if (Math.floor(worker.swingT) > Math.floor(prev)) {
      particles.burst(worker.x - u * 0.9, L.floor - u * 1.2, 4, PALETTE.cyanLight, {
        speed: u * 4, size: 2, shape: 'shard', gravity: u * 20
      })
      worker.swingsLeft--
      if (worker.swingsLeft <= 0) {
        worker.carrying = 1
        worker.phase = 'toCrate'
      }
    }
  } else if (worker.phase === 'toCrate') {
    worker.dir = 1
    worker.x += speed * dt
    if (worker.x >= crateTarget) {
      worker.x = crateTarget
      worker.phase = 'dropping'
      worker.pauseT = 0.3
      worker.carrying = 0
      particles.spawnArc(worker.x, L.floor - u * 1.5, L.crateX + L.crateW * 0.4, L.crateY, 0.5, PALETTE.cyan, u * 0.16)
    }
  } else {
    worker.phase = 'toGeode'
    worker.pauseT = 0.2
  }
}

function drawLive(dt: number) {
  if (!liveG) return
  const g = liveG
  g.clear()
  const u = L.unit
  const gems = displayGems()
  const whole = Math.floor(gems)
  const frac = gems - whole
  const full = gems >= props.gemCap - 0.001

  // Cavity glow, breathing with the catalyst level — kept inside the rock.
  const glow = 0.06 + 0.03 * Math.sin(t * 2) + props.catalystLevel * 0.008
  for (let i = 0; i < 3; i++) {
    const rr = L.geodeR * (0.5 + i * 0.16) * (1 + 0.02 * Math.sin(t * 2))
    g.ellipse(L.geodeX, L.floor - rr * 0.35, rr, rr * 0.7).fill({ color: PALETTE.cyan, alpha: glow })
  }

  // The gem currently forming, growing out of the middle of the cluster.
  if (!full) {
    drawCrystalGem(g, L.geodeX, L.floor - L.geodeR * 0.55, L.geodeR * 0.24 * (0.3 + frac * 0.7), 0.95)
  }

  updateWorker(dt)
  drawStickFigure(g, {
    x: worker.x,
    baseY: L.floor,
    unit: u,
    dir: worker.dir,
    swing: worker.phase === 'chipping' ? worker.swingT % 1 : null,
    walk: (worker.phase === 'toGeode' || worker.phase === 'toCrate') ? t * 10 : 0,
    carrying: worker.carrying,
    helmet: PALETTE.cyan,
    cargoColor: PALETTE.cyan
  })

  // Gems piled in the crate — one drawn gem per whole gem, up to the cap.
  const { crateX: cx, crateY: cy, crateW: cw } = L
  const shown = Math.min(whole, props.gemCap)
  const perRow = Math.max(4, Math.ceil(Math.sqrt(props.gemCap * 1.6)))
  const gemR = Math.min(u * 0.44, (cw - u * 0.4) / perRow * 0.55)
  for (let i = 0; i < shown; i++) {
    const col = i % perRow
    const row = Math.floor(i / perRow)
    const gx = cx + u * 0.3 + col * ((cw - u * 0.6) / perRow) + gemR * 0.5
    const gy = cy + L.crateH - u * 0.35 - row * gemR * 1.7
    drawCrystalGem(g, gx, gy, gemR, full ? 0.8 : 0.95, full ? mixColor(PALETTE.cyan, PALETTE.danger, 0.4) : PALETTE.cyan)
  }

  // Crate fill bar so the cap is legible even when the pile is tall.
  const barW = cw
  const fillFrac = clamp(gems / props.gemCap, 0, 1)
  g.roundRect(cx, cy - u * 0.75, barW, u * 0.26, u * 0.13).fill({ color: 0x0a1416, alpha: 0.9 })
  g.roundRect(cx, cy - u * 0.75, barW * fillFrac, u * 0.26, u * 0.13)
    .fill({ color: full ? PALETTE.danger : PALETTE.cyan })

  // Ready-to-collect pulse.
  if (whole >= 1) {
    const pulse = 0.5 + Math.sin(t * 3) * 0.5
    g.roundRect(cx - u * 0.5, cy - u * 1.1, cw + u, L.crateH + u * 1.4, u * 0.3)
      .stroke({ color: PALETTE.cyan, width: 2, alpha: 0.15 + pulse * 0.3 })
  }

  // Hover outline.
  if (hovered.value === 'crate') {
    g.roundRect(cx - u * 0.8, cy - u * 1.4, cw + u * 1.6, L.crateH + u * 2, u * 0.35)
      .stroke({ color: PALETTE.cyanLight, width: 2, alpha: 0.5 })
  } else if (hovered.value === 'geode') {
    g.roundRect(L.geodeX - L.geodeR * 1.35, L.floor - L.geodeR * 1.3, L.geodeR * 2.7, L.geodeR * 1.3 + u * 0.6, u * 0.4)
      .stroke({ color: PALETTE.cyanLight, width: 2, alpha: 0.5 })
  }

  // Ambient motes.
  if (Math.random() < 0.1) {
    particles.spawn({
      x: L.geodeX + (Math.random() - 0.5) * L.geodeR * 1.6,
      y: L.floor - L.geodeR * (0.3 + Math.random() * 0.7),
      vx: (Math.random() - 0.5) * u * 0.4,
      vy: -u * (0.3 + Math.random() * 0.5),
      gravity: -u * 0.1,
      color: PALETTE.cyanLight,
      size: u * 0.1,
      life: 2,
      maxLife: 2,
      shape: 'spark'
    })
  }
}

/** Faceted gem, the motif this page is built from. */
function drawCrystalGem(g: any, cx: number, cy: number, r: number, alpha = 1, color: number = PALETTE.cyan) {
  g.moveTo(cx, cy - r)
  g.lineTo(cx + r * 0.72, cy - r * 0.2)
  g.lineTo(cx + r * 0.45, cy + r)
  g.lineTo(cx - r * 0.45, cy + r)
  g.lineTo(cx - r * 0.72, cy - r * 0.2)
  g.closePath()
  g.fill({ color, alpha })
  g.moveTo(cx, cy - r)
  g.lineTo(cx - r * 0.72, cy - r * 0.2)
  g.lineTo(cx, cy + r)
  g.closePath()
  g.fill({ color: PALETTE.cyanLight, alpha: alpha * 0.35 })
}

function frame(dtMs: number) {
  const dt = Math.min(0.05, dtMs / 1000)
  t += dt
  particles.update(dt)
  drawLive(dt)
  particles.draw(partG)
  if (shake > 0.05) {
    shake *= 0.86
    app.stage.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake)
  } else if (shake) {
    shake = 0
    app.stage.position.set(0, 0)
  }
}

function rebuild() {
  if (!app) return
  layout(app.screen.width, app.screen.height)
  drawBackdrop()
  drawStatic()
}

watch(() => [props.factoryLevel, props.catalystLevel, props.gemCap].join(','), rebuild)

onMounted(async () => {
  const pixi = await import('pixi.js')
  if (destroyed) return
  PIXI = pixi
  app = new PIXI.Application()
  await app.init({
    resizeTo: wrap.value ?? undefined,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1)
  })
  if (destroyed) {
    app.destroy(true)
    return
  }
  wrap.value?.appendChild(app.canvas)

  bgG = new PIXI.Graphics()
  staticG = new PIXI.Graphics()
  liveG = new PIXI.Graphics()
  partG = new PIXI.Graphics()
  app.stage.addChild(bgG, staticG, liveG, partG)

  rebuild()
  resizeObserver = new ResizeObserver(() => rebuild())
  if (wrap.value) resizeObserver.observe(wrap.value)
  app.ticker.add(() => frame(app.ticker.deltaMS))
})

onUnmounted(() => {
  destroyed = true
  resizeObserver?.disconnect()
  resizeObserver = null
  particles.clear()
  bgG = staticG = liveG = partG = null
  if (app) {
    app.destroy(true, { children: true })
    app = null
  }
})
</script>

<template>
  <div
    ref="wrap"
    class="forge-scene relative w-full overflow-hidden rounded-2xl border border-default"
    :class="[hovered ? 'cursor-pointer' : 'cursor-crosshair', busy ? 'forge-scene--busy' : '']"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @pointerdown="onPointerDown"
  >
    <div
      class="absolute z-10 -translate-x-1/2 -translate-y-full"
      :style="{ left: `${anchors.geode.x}px`, top: `${anchors.geode.y}px` }"
    >
      <slot name="press" />
    </div>
    <div
      class="absolute z-10 -translate-x-1/2 -translate-y-full"
      :style="{ left: `${anchors.crate.x}px`, top: `${anchors.crate.y}px` }"
    >
      <slot name="rack" />
    </div>
    <slot />
  </div>
</template>

<style scoped>
.forge-scene {
  height: clamp(420px, 58vh, 620px);
  background-color: #08100f;
  touch-action: manipulation;
}

.forge-scene--busy::after {
  position: absolute;
  inset: 0;
  content: '';
  pointer-events: none;
  background: radial-gradient(circle at 50% 100%, rgba(34, 211, 238, 0.09), transparent 60%);
}
</style>
