<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  PALETTE, Particles, clamp, lerp, mixColor, noise, stageOf,
  minerCrewSize, STORAGE_TIERS, VAULT_LEVELS_PER_TIER, storageTierName, drawStickFigure
} from '~/utils/miner-scene'

const props = defineProps<{
  rigLevel: number
  rigMaxLevel: number
  vaultLevel: number
  vaultMaxLevel: number
  overclockLevel: number
  incomeMultiplier: number
  /** 0..1 vault fill. */
  fill: number
  busy: boolean
}>()

const emit = defineEmits<{
  collect: []
  upgradeRig: []
  upgradeVault: []
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

type Spot = 'hq' | 'store' | 'scaffold'
const anchors = ref<Record<Spot, { x: number, y: number }>>({
  hq: { x: 0, y: 0 },
  store: { x: 0, y: 0 },
  scaffold: { x: 0, y: 0 }
})
const hovered = ref<Spot | null>(null)

// One extra miner every 5 rig levels — the headline "my upgrade did something"
// signal on this page. Buildings step up more slowly: six tiers across the range.
const minerCount = computed(() => minerCrewSize(props.rigLevel))
const hqStage = computed(() => stageOf(props.rigLevel, 17, 6))
const storeStage = computed(() => stageOf(props.vaultLevel, VAULT_LEVELS_PER_TIER, STORAGE_TIERS.length))
const storeName = computed(() => storageTierName(props.vaultLevel))

let L = {
  w: 0, h: 0,
  floor: 0,
  wallX: 0,
  hqX: 0, hqW: 0, hqH: 0,
  storeX: 0, storeW: 0, storeH: 0,
  scaffoldX: 0, scaffoldW: 0,
  railY: 0,
  unit: 0
}

function layout(w: number, h: number) {
  const floor = h * 0.76
  const unit = clamp(h * 0.055, 16, 34) // one "figure unit" — everything scales off this
  const hqW = unit * (5 + hqStage.value * 0.5)
  const storeW = unit * (4.4 + storeStage.value * 0.85)
  L = {
    w, h, floor, unit,
    wallX: w * 0.2,
    hqX: w * 0.3, hqW, hqH: unit * (3.2 + hqStage.value * 0.5),
    storeX: w * 0.66, storeW, storeH: unit * (2 + storeStage.value * 0.75),
    scaffoldX: w * 0.66 + storeW + unit * 0.8, scaffoldW: unit * 1.8,
    railY: floor + unit * 0.35
  }
  anchors.value = {
    hq: { x: L.hqX + hqW / 2, y: L.floor - L.hqH - unit * 1.6 },
    store: { x: L.storeX + storeW / 2, y: L.floor - L.storeH - unit * 1.4 },
    scaffold: { x: Math.min(w - unit * 3, L.scaffoldX + L.scaffoldW / 2), y: L.floor - unit * 3.4 }
  }
  buildMiners()
}

// ─── Miners ─────────────────────────────────────────────────────────────────
interface Miner {
  x: number
  /** -1/0/1 depth row, so the crew doesn't stand in a single line. */
  lane: number
  /** Stable index used to fan the crew out along the ore face. */
  slot: number
  dir: 1 | -1
  phase: 'toWall' | 'mining' | 'toStore' | 'dropping'
  swingsLeft: number
  swingT: number
  carrying: number
  speed: number
  seed: number
  helmet: number
  pauseT: number
}

let miners: Miner[] = []

function buildMiners() {
  const want = minerCount.value
  while (miners.length > want) miners.pop()
  while (miners.length < want) {
    const seed = miners.length + 1
    const slot = miners.length
    miners.push({
      x: lerp(L.wallX + L.unit, L.storeX, noise(seed * 3.1)),
      lane: (slot % 3) - 1,
      slot,
      dir: -1,
      phase: 'toWall',
      swingsLeft: 3 + Math.floor(noise(seed * 7.3) * 4),
      swingT: noise(seed) * 6,
      carrying: 0,
      speed: (0.85 + noise(seed * 2.9) * 0.4),
      seed,
      helmet: [PALETTE.gold, 0xf97316, 0xfacc15, 0xfb923c][Math.floor(noise(seed * 11.1) * 4)] ?? PALETTE.gold,
      pauseT: noise(seed * 19.3) * 1.6
    })
  }
}

function minerBaseY(m: Miner) {
  // Depth rows: the back row stands slightly higher and reads as further away.
  return L.floor + m.lane * L.unit * 0.42
}

function updateMiners(dt: number) {
  const hot = 1 + (props.incomeMultiplier - 1) * 3
  const full = props.fill >= 0.999
  for (const m of miners) {
    const speed = L.unit * 3.2 * m.speed * hot
    // Fan out: three depth rows, each column a bit further from the face.
    const column = Math.floor(m.slot / 3)
    const wallTarget = L.wallX + L.unit * (1 + column * 1.35) + (m.lane + 1) * L.unit * 0.3
    const storeTarget = L.storeX - L.unit * (0.6 + (m.slot % 4) * 0.55)

    if (m.pauseT > 0) {
      m.pauseT -= dt
      continue
    }

    if (m.phase === 'toWall') {
      m.dir = -1
      m.x -= speed * dt
      if (m.x <= wallTarget) {
        m.x = wallTarget
        m.phase = 'mining'
        m.swingsLeft = 3 + Math.floor(noise(m.seed * 13.7 + m.x) * 4)
        m.swingT = 0
      }
    } else if (m.phase === 'mining') {
      const prev = m.swingT
      m.swingT += dt * 4.2 * hot
      // One hit per swing cycle, at the bottom of the arc.
      if (Math.floor(m.swingT) > Math.floor(prev)) {
        const hy = minerBaseY(m) - L.unit * 1.1
        particles.burst(m.x - L.unit * 0.9, hy, 4, PALETTE.lamp, { speed: L.unit * 5, size: 2, shape: 'spark', gravity: L.unit * 22 })
        m.swingsLeft--
        if (m.swingsLeft <= 0) {
          m.carrying = 1
          m.phase = 'toStore'
          particles.burst(m.x - L.unit * 0.8, hy, 3, PALETTE.gold, { speed: L.unit * 4, size: 3, gravity: L.unit * 20 })
        }
      }
    } else if (m.phase === 'toStore') {
      m.dir = 1
      m.x += speed * dt
      if (m.x >= storeTarget) {
        m.x = storeTarget
        m.phase = 'dropping'
        m.pauseT = 0.35
        m.carrying = 0
        // Toss the ore into (or, when full, off) the storage.
        const from = { x: m.x, y: minerBaseY(m) - L.unit * 1.5 }
        const to = full
          ? { x: L.storeX - L.unit * (0.5 + noise(m.seed * 3) * 1.2), y: L.floor - 4 }
          : { x: L.storeX + L.storeW * 0.45, y: L.floor - L.storeH * 0.4 }
        particles.spawnArc(from.x, from.y, to.x, to.y, 0.55, PALETTE.gold, L.unit * 0.16)
        if (full) {
          spill.push({ x: to.x, y: L.floor - 2, seed: noise(m.seed * 17 + m.x) })
          if (spill.length > 40) spill.shift()
        }
      }
    } else {
      m.phase = 'toWall'
      m.pauseT = 0.15
    }
  }
}

function drawMiner(g: any, m: Miner) {
  drawStickFigure(g, {
    x: m.x,
    baseY: minerBaseY(m),
    unit: L.unit,
    dir: m.dir,
    swing: m.phase === 'mining' ? m.swingT % 1 : null,
    walk: (m.phase === 'toWall' || m.phase === 'toStore') ? t * 11 * m.speed + m.seed : 0,
    carrying: m.carrying,
    helmet: m.helmet
  })
}

// ─── Interaction ────────────────────────────────────────────────────────────
function hitTest(x: number, y: number): Spot | null {
  const u = L.unit
  if (x >= L.storeX - u && x <= L.storeX + L.storeW + u && y >= L.floor - L.storeH - u && y <= L.floor + u) return 'store'
  if (x >= L.hqX - u * 0.5 && x <= L.hqX + L.hqW + u * 0.5 && y >= L.floor - L.hqH - u * 2.6 && y <= L.floor + u * 0.5) return 'hq'
  if (x >= L.scaffoldX - u && x <= L.scaffoldX + L.scaffoldW + u && y >= L.floor - u * 3.6 && y <= L.floor + u * 0.5) return 'scaffold'
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
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const hit = hitTest(x, y)
  if (hit === 'store') emit('collect')
  else if (hit === 'hq') emit('upgradeRig')
  else if (hit === 'scaffold') emit('upgradeVault')
  else particles.burst(x, y, 5, PALETTE.rockEdge, { speed: 90, size: 2, shape: 'spark', gravity: 400 })
}

// ─── Animation state ────────────────────────────────────────────────────────
let t = 0
let shake = 0
let drainUntil = 0
let drainFrom = 0
let cartX = 0
let cartDir = 1
const spill: { x: number, y: number, seed: number }[] = []

function displayFill() {
  if (t < drainUntil) {
    const k = 1 - (drainUntil - t) / 0.7
    return drainFrom * (1 - k * k)
  }
  return clamp(props.fill, 0, 1)
}

function playCollect() {
  drainFrom = displayFill()
  drainUntil = t + 0.7
  shake = 8
  const cx = L.storeX + L.storeW * 0.5
  const cy = L.floor - L.storeH * 0.5
  particles.burst(cx, cy, 34, PALETTE.gold, { speed: L.unit * 12, size: L.unit * 0.18, gravity: L.unit * 22 })
  for (let i = 0; i < 14; i++) {
    particles.spawnArc(cx, cy, L.w * (0.86 + noise(i) * 0.1), -30, 0.55 + noise(i * 3) * 0.2, PALETTE.goldLight, L.unit * 0.14)
  }
  spill.length = 0
}

function playUpgrade(which: 'rig' | 'vault') {
  shake = 6
  if (which === 'rig') {
    particles.burst(L.hqX + L.hqW / 2, L.floor - L.hqH, 22, PALETTE.lamp, { speed: L.unit * 9, size: 3, shape: 'spark', gravity: L.unit * 18 })
  } else {
    particles.burst(L.storeX + L.storeW / 2, L.floor - L.storeH, 24, PALETTE.steelLight, { speed: L.unit * 9, size: 3, shape: 'shard', gravity: L.unit * 18 })
  }
}

function playReject(which: 'rig' | 'vault' | 'scaffold') {
  const x = which === 'rig' ? L.hqX + L.hqW / 2 : L.storeX + L.storeW / 2
  particles.burst(x, L.floor - L.unit * 2, 10, PALETTE.danger, { speed: L.unit * 5, size: 3, shape: 'spark', gravity: L.unit * 18 })
}

defineExpose({ playCollect, playUpgrade, playReject, minerCount, storeName })

// ─── Cave backdrop ──────────────────────────────────────────────────────────
function drawBackdrop() {
  if (!bgG) return
  const g = bgG
  const { w, h, floor } = L
  g.clear()

  // Deep dark behind everything.
  g.rect(0, 0, w, h).fill({ color: 0x120d0a })

  // Back wall with a warm gradient toward the floor.
  for (let i = 0; i < 14; i++) {
    const k = i / 14
    g.rect(0, h * 0.1 * k, w, h).fill({ color: mixColor(0x1d1611, 0x3a2718, k), alpha: 0.14 })
  }

  // Distant tunnel arches for depth.
  for (let i = 0; i < 3; i++) {
    const ax = w * (0.42 + i * 0.06)
    const aw = w * 0.06
    const ah = h * (0.26 - i * 0.03)
    g.roundRect(ax, floor - ah, aw, ah, aw * 0.5).fill({ color: 0x0d0906, alpha: 0.55 })
  }

  // Rough ceiling with stalactites.
  g.moveTo(0, 0)
  g.lineTo(w, 0)
  g.lineTo(w, h * 0.1)
  for (let i = 20; i >= 0; i--) {
    const px = (w * i) / 20
    g.lineTo(px, h * (0.06 + noise(i * 2.7) * 0.07))
  }
  g.closePath()
  g.fill({ color: 0x1a120c })
  for (let i = 0; i < 16; i++) {
    const sx = noise(i * 3.9) * w
    const len = h * (0.03 + noise(i * 6.1) * 0.07)
    const sy = h * (0.07 + noise(i * 2.2) * 0.04)
    g.moveTo(sx - len * 0.22, sy)
    g.lineTo(sx, sy + len)
    g.lineTo(sx + len * 0.22, sy)
    g.closePath()
    g.fill({ color: 0x241811 })
  }

  // Floor.
  g.rect(0, floor, w, h - floor).fill({ color: 0x241a12 })
  g.rect(0, floor, w, 3).fill({ color: 0x4a3320 })
  for (let i = 0; i < 60; i++) {
    const px = noise(i * 4.3) * w
    const py = floor + noise(i * 7.7) * (h - floor)
    g.circle(px, py, 1 + noise(i * 2.1) * 2.4).fill({ color: 0x160f0a, alpha: 0.7 })
  }

  // Ore wall on the left — the face the miners work.
  g.moveTo(0, 0)
  for (let i = 0; i <= 14; i++) {
    const py = (h * i) / 14
    g.lineTo(L.wallX + (noise(i * 5.1) - 0.5) * L.unit * 1.6, py)
  }
  g.lineTo(0, h)
  g.closePath()
  g.fill({ color: 0x3a2718 })
  g.stroke({ color: 0x54381f, width: 2, alpha: 0.8 })

  // Ore seams: clusters of chunky nuggets embedded in the rock face, richer as
  // the operation scales up. Thin zigzag lines read as scratches, not gold.
  const seams = 4 + Math.round(minerCount.value * 0.6)
  for (let i = 0; i < seams; i++) {
    const vy = h * (0.12 + noise(i * 2.7) * 0.66)
    const vx = L.wallX * (0.28 + noise(i * 5.3) * 0.5)
    const nuggets = 4 + Math.floor(noise(i * 9.1) * 4)
    // Dark seam bed behind the nuggets.
    g.ellipse(vx, vy, L.unit * 1.5, L.unit * 0.5).fill({ color: 0x2a1a10, alpha: 0.55 })
    for (let n = 0; n < nuggets; n++) {
      const nx = vx + (noise(i * 3.3 + n * 1.7) - 0.5) * L.unit * 2.4
      const ny = vy + (noise(i * 7.9 + n * 2.3) - 0.5) * L.unit * 0.8
      const nr = L.unit * (0.16 + noise(i + n * 4.1) * 0.16)
      g.circle(nx, ny, nr).fill({ color: PALETTE.gold, alpha: 0.9 })
      g.circle(nx - nr * 0.3, ny - nr * 0.3, nr * 0.4).fill({ color: PALETTE.goldLight, alpha: 0.7 })
    }
  }
}

// ─── Buildings and props ────────────────────────────────────────────────────
function drawStatic() {
  if (!staticG) return
  const g = staticG
  g.clear()
  drawSupports(g)
  drawRails(g)
  drawHQ(g)
  drawStorage(g)
  drawScaffold(g)
  drawProps(g)
}

function drawSupports(g: any) {
  const u = L.unit
  const beams = 3 + hqStage.value
  for (let i = 0; i < beams; i++) {
    const bx = L.wallX + u * 2 + (i / beams) * (L.w - L.wallX - u * 3)
    g.rect(bx - u * 0.16, L.h * 0.08, u * 0.32, L.floor - L.h * 0.08).fill({ color: 0x4a3320 })
    g.rect(bx - u * 0.9, L.h * 0.08, u * 1.8, u * 0.3).fill({ color: 0x5b3f26 })
    // Hanging lamp on every other beam.
    if (i % 2 === 0) {
      const ly = L.h * 0.08 + u * 1.4
      g.moveTo(bx, L.h * 0.08 + u * 0.3).lineTo(bx, ly).stroke({ color: 0x6b7280, width: 1.5 })
      g.circle(bx, ly, u * 0.26).fill({ color: PALETTE.lamp, alpha: 0.9 })
      g.circle(bx, ly, u * 0.8).fill({ color: PALETTE.lamp, alpha: 0.06 })
    }
  }
}

function drawRails(g: any) {
  const u = L.unit
  const y = L.railY
  for (let x = L.wallX; x < L.storeX + L.storeW; x += u * 0.8) {
    g.rect(x, y - u * 0.08, u * 0.5, u * 0.16).fill({ color: 0x3a2a1c })
  }
  g.rect(L.wallX, y - u * 0.16, L.storeX + L.storeW - L.wallX, u * 0.08).fill({ color: 0x8a8f98, alpha: 0.75 })
  g.rect(L.wallX, y + u * 0.12, L.storeX + L.storeW - L.wallX, u * 0.06).fill({ color: 0x6b7280, alpha: 0.7 })
}

/** Rig HQ: a shack that grows a headframe, engine house and floodlights. */
function drawHQ(g: any) {
  const u = L.unit
  const x = L.hqX
  const w = L.hqW
  const h = L.hqH
  const base = L.floor
  const stage = hqStage.value
  const hot = props.overclockLevel > 0

  // Headframe tower behind the shack (stage 1+).
  if (stage >= 1) {
    const th = h * (1.3 + stage * 0.25)
    const tw = w * 0.5
    const tx = x + w * 0.5
    g.moveTo(tx, base - th)
    g.lineTo(tx + tw * 0.5, base)
    g.moveTo(tx, base - th)
    g.lineTo(tx - tw * 0.5, base)
    g.stroke({ color: 0x6b5335, width: u * 0.16 })
    for (let i = 1; i < 4; i++) {
      const k = i / 4
      g.moveTo(tx - tw * 0.5 * k, base - th * (1 - k))
      g.lineTo(tx + tw * 0.5 * k, base - th * (1 - k))
      g.stroke({ color: 0x6b5335, width: u * 0.1, alpha: 0.9 })
    }
    // Pulley wheel (spins in the live pass).
    g.circle(tx, base - th, u * 0.5).stroke({ color: PALETTE.steelLight, width: u * 0.12, alpha: 0.9 })
  }

  // Shack.
  g.rect(x, base - h, w, h).fill({ color: 0x6b4a2b })
  g.rect(x, base - h, w, h).stroke({ color: 0x3f2a17, width: 2 })
  for (let i = 1; i < 4; i++) {
    g.moveTo(x, base - h * (i / 4)).lineTo(x + w, base - h * (i / 4))
      .stroke({ color: 0x54381f, width: 1.5, alpha: 0.8 })
  }
  // Roof.
  g.moveTo(x - u * 0.3, base - h)
  g.lineTo(x + w * 0.5, base - h - u * 0.9)
  g.lineTo(x + w + u * 0.3, base - h)
  g.closePath()
  g.fill({ color: hot ? 0x7c2d12 : 0x4a3320 })
  // Door + window.
  g.rect(x + w * 0.12, base - h * 0.62, w * 0.24, h * 0.62).fill({ color: 0x2a1a10 })
  g.rect(x + w * 0.5, base - h * 0.78, w * 0.3, h * 0.3).fill({ color: PALETTE.lamp, alpha: 0.7 })

  // Engine house with chimney (stage 3+) — smoke is added live.
  if (stage >= 3) {
    const ex = x + w + u * 0.3
    g.rect(ex, base - h * 0.7, u * 1.6, h * 0.7).fill({ color: 0x4a3320 })
    g.rect(ex + u * 0.45, base - h * 1.5, u * 0.55, h * 0.8).fill({ color: 0x3a2718 })
  }
  // Floodlights (stage 5).
  if (stage >= 5) {
    for (const fx of [x - u * 0.6, x + w + u * 0.6]) {
      g.rect(fx - u * 0.08, base - h * 1.5, u * 0.16, h * 1.5).fill({ color: 0x6b7280 })
      g.circle(fx, base - h * 1.5, u * 0.3).fill({ color: PALETTE.lamp, alpha: 0.9 })
    }
  }
  // Toolrack against the wall.
  g.rect(x - u * 1.2, base - u * 1.1, u * 0.9, u * 1.1).fill({ color: 0x54381f, alpha: 0.9 })
}

/**
 * Storage: literally a pile of coins on the dirt at first, then crates, a shed,
 * a stone depot, a warehouse and finally a bank vault.
 */
function drawStorage(g: any) {
  const u = L.unit
  const x = L.storeX
  const w = L.storeW
  const h = L.storeH
  const base = L.floor
  const stage = storeStage.value

  if (stage === 0) return // pure coin pile, drawn live so it tracks the fill

  if (stage === 1) {
    // Crate stack.
    for (let i = 0; i < 4; i++) {
      const cw = u * 1.5
      const cx = x + (i % 2) * (cw + u * 0.25)
      const cy = base - (Math.floor(i / 2) + 1) * cw
      g.rect(cx, cy, cw, cw).fill({ color: 0x6b4a2b })
      g.rect(cx, cy, cw, cw).stroke({ color: 0x3f2a17, width: 2 })
      g.moveTo(cx, cy).lineTo(cx + cw, cy + cw).stroke({ color: 0x54381f, width: 1.5 })
    }
    return
  }

  // Building body — material gets heavier with each tier.
  const bodyColor = stage === 2 ? 0x6b4a2b : stage === 3 ? 0x57534e : stage === 4 ? 0x44403c : 0x3f3f46
  g.rect(x, base - h, w, h).fill({ color: bodyColor })
  g.rect(x, base - h, w, h).stroke({ color: 0x27272a, width: 2 })

  if (stage === 2) {
    for (let i = 1; i < 5; i++) {
      g.moveTo(x, base - h * (i / 5)).lineTo(x + w, base - h * (i / 5))
        .stroke({ color: 0x54381f, width: 1.5, alpha: 0.8 })
    }
  } else {
    // Block courses.
    for (let r = 0; r < 5; r++) {
      const ry = base - h + (h / 5) * r
      g.moveTo(x, ry).lineTo(x + w, ry).stroke({ color: 0x1c1917, width: 1.2, alpha: 0.6 })
      for (let c = 0; c < 4; c++) {
        const cx = x + (w / 4) * (c + (r % 2 ? 0.5 : 0))
        if (cx > x && cx < x + w) {
          g.moveTo(cx, ry).lineTo(cx, ry + h / 5).stroke({ color: 0x1c1917, width: 1.2, alpha: 0.5 })
        }
      }
    }
  }

  // Roof.
  if (stage <= 3) {
    g.moveTo(x - u * 0.4, base - h)
    g.lineTo(x + w * 0.5, base - h - u * 1.1)
    g.lineTo(x + w + u * 0.4, base - h)
    g.closePath()
    g.fill({ color: stage === 2 ? 0x4a3320 : 0x3f3f46 })
  } else {
    g.rect(x - u * 0.4, base - h - u * 0.5, w + u * 0.8, u * 0.5).fill({ color: 0x71717a })
    for (let i = 0; i < 6; i++) {
      g.circle(x + (w / 6) * (i + 0.5), base - h - u * 0.25, u * 0.07).fill({ color: PALETTE.steelLight, alpha: 0.7 })
    }
  }

  // Door: plank door, then a steel shutter, then a round vault door.
  const dw = w * 0.34
  const dh = h * 0.6
  const dx = x + w * 0.5 - dw * 0.5
  const dy = base - dh
  if (stage < 5) {
    g.rect(dx, dy, dw, dh).fill({ color: stage <= 2 ? 0x3f2a17 : 0x27272a })
    if (stage >= 3) {
      for (let i = 0; i < 5; i++) {
        g.rect(dx, dy + (dh / 5) * i, dw, dh / 9).fill({ color: 0x52525b, alpha: 0.8 })
      }
    }
  } else {
    const r = Math.min(dw, dh) * 0.62
    g.circle(x + w * 0.5, base - h * 0.5, r).fill({ color: 0x52525b })
    g.circle(x + w * 0.5, base - h * 0.5, r).stroke({ color: PALETTE.steelLight, width: 2, alpha: 0.6 })
    g.circle(x + w * 0.5, base - h * 0.5, r * 0.55).stroke({ color: PALETTE.steelLight, width: 2, alpha: 0.4 })
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      g.moveTo(x + w * 0.5 + Math.cos(a) * r * 0.2, base - h * 0.5 + Math.sin(a) * r * 0.2)
      g.lineTo(x + w * 0.5 + Math.cos(a) * r * 0.5, base - h * 0.5 + Math.sin(a) * r * 0.5)
      g.stroke({ color: PALETTE.steelLight, width: 2, alpha: 0.5 })
    }
  }

  // Sign board naming the current tier of storage.
  g.rect(x + w * 0.5 - u * 1.5, base - h - u * 1.9, u * 3, u * 0.7).fill({ color: 0x2a1a10, alpha: 0.9 })
  g.rect(x + w * 0.5 - u * 1.5, base - h - u * 1.9, u * 3, u * 0.7).stroke({ color: PALETTE.gold, width: 1.5, alpha: 0.5 })
}

function drawScaffold(g: any) {
  const u = L.unit
  const x = L.scaffoldX
  const w = L.scaffoldW
  const top = L.floor - u * 3.4
  const maxed = props.vaultLevel >= props.vaultMaxLevel

  g.rect(x, top, u * 0.18, L.floor - top).fill({ color: 0x6b5335 })
  g.rect(x + w - u * 0.18, top, u * 0.18, L.floor - top).fill({ color: 0x6b5335 })
  for (let i = 0; i < 4; i++) {
    const ry = top + ((L.floor - top) * i) / 4
    g.rect(x, ry, w, u * 0.12).fill({ color: 0x8a6b3f, alpha: 0.9 })
  }
  // Ghost outline of the next storage tier, waiting to be built.
  if (!maxed) {
    g.rect(x - u * 0.4, top - u * 1.4, w + u * 0.8, u * 1.4)
      .stroke({ color: PALETTE.gold, width: 1.5, alpha: 0.3 })
    g.moveTo(x + w * 0.5, top - u * 1.05).lineTo(x + w * 0.5, top - u * 0.35)
      .stroke({ color: PALETTE.gold, width: 2, alpha: 0.4 })
    g.moveTo(x + w * 0.5 - u * 0.35, top - u * 0.7).lineTo(x + w * 0.5 + u * 0.35, top - u * 0.7)
      .stroke({ color: PALETTE.gold, width: 2, alpha: 0.4 })
  }
}

/** Barrels, sacks, spare picks — the clutter that makes it read as a worksite. */
function drawProps(g: any) {
  const u = L.unit
  const spots = [0.26, 0.47, 0.58, 0.62, 0.9]
  spots.forEach((p, i) => {
    const px = L.w * p
    if (i % 2 === 0) {
      g.roundRect(px, L.floor - u * 1.1, u * 0.8, u * 1.1, u * 0.16).fill({ color: 0x5b3f26 })
      g.rect(px, L.floor - u * 0.8, u * 0.8, u * 0.14).fill({ color: 0x8a8f98, alpha: 0.6 })
    } else {
      g.ellipse(px, L.floor - u * 0.35, u * 0.55, u * 0.35).fill({ color: 0x7c6242 })
      g.ellipse(px - u * 0.1, L.floor - u * 0.5, u * 0.2, u * 0.14).fill({ color: 0x93785a, alpha: 0.7 })
    }
  })
}

// ─── Live pass ──────────────────────────────────────────────────────────────
function drawLive(dt: number) {
  if (!liveG) return
  const g = liveG
  g.clear()
  const u = L.unit
  const fill = displayFill()
  const full = fill >= 0.999

  // Pulley wheel spinning on the headframe.
  if (hqStage.value >= 1) {
    const th = L.hqH * (1.3 + hqStage.value * 0.25)
    const tx = L.hqX + L.hqW * 0.5
    const ty = L.floor - th
    const spin = t * (1.2 + hqStage.value * 0.4) * props.incomeMultiplier
    for (let i = 0; i < 4; i++) {
      const a = spin + (i / 4) * Math.PI
      g.moveTo(tx - Math.cos(a) * u * 0.5, ty - Math.sin(a) * u * 0.5)
      g.lineTo(tx + Math.cos(a) * u * 0.5, ty + Math.sin(a) * u * 0.5)
      g.stroke({ color: PALETTE.steelLight, width: u * 0.08, alpha: 0.8 })
    }
  }

  // Chimney smoke.
  if (hqStage.value >= 3 && Math.random() < 0.2) {
    particles.spawn({
      x: L.hqX + L.hqW + u * 1.05,
      y: L.floor - L.hqH * 1.5,
      vx: (Math.random() - 0.5) * u * 0.6,
      vy: -u * (1.2 + Math.random()),
      gravity: -u * 0.2,
      color: props.overclockLevel > 0 ? PALETTE.danger : 0x9ca3af,
      size: u * (0.14 + Math.random() * 0.14),
      life: 1.8,
      maxLife: 1.8,
      shape: 'spark'
    })
  }

  // Ore cart shuttling along the rails.
  const railFrom = L.wallX + u
  const railTo = L.storeX - u
  cartX += cartDir * dt * u * 2.4 * props.incomeMultiplier
  if (cartX > railTo) { cartX = railTo; cartDir = -1 }
  if (cartX < railFrom) { cartX = railFrom; cartDir = 1 }
  const cartY = L.railY - u * 0.2
  g.moveTo(cartX - u * 0.8, cartY - u * 0.8)
  g.lineTo(cartX + u * 0.8, cartY - u * 0.8)
  g.lineTo(cartX + u * 0.6, cartY)
  g.lineTo(cartX - u * 0.6, cartY)
  g.closePath()
  g.fill({ color: 0x52525b })
  if (cartDir > 0) {
    for (let i = 0; i < 4; i++) {
      g.circle(cartX - u * 0.45 + i * u * 0.3, cartY - u * 0.85, u * 0.16).fill({ color: PALETTE.gold })
    }
  }
  g.circle(cartX - u * 0.45, cartY + u * 0.1, u * 0.2).fill({ color: 0x3f3f46 })
  g.circle(cartX + u * 0.45, cartY + u * 0.1, u * 0.2).fill({ color: 0x3f3f46 })

  // Miners.
  updateMiners(dt)
  for (const m of miners) drawMiner(g, m)

  // ── Loose gold. At vault tier 0 the pile IS the storage; later it is just
  // the heap by the door, so it stays small and never swallows the crew.
  const stage = storeStage.value
  const pileX = stage === 0 ? L.storeX + L.storeW * 0.5 : L.storeX - u * 1.4
  const maxCoins = stage === 0 ? 42 : 12
  const spreadX = (stage === 0 ? L.storeW * 0.55 : u * 1.6)
  const layers = Math.max(1, Math.round(fill * (stage === 0 ? 6 : 3)))
  const coinR = u * 0.2
  if (fill > 0.005) {
    // Discrete coins stacked into a mound — flat ellipses read as a puddle.
    const coins = Math.max(3, Math.round(fill * maxCoins))
    for (let i = 0; i < coins; i++) {
      const layer = Math.floor((i / coins) * layers)
      const shrink = 1 - layer / (layers + 1)
      const cx2 = pileX + (noise(i * 3.1) - 0.5) * spreadX * 2 * shrink
      const cy2 = L.floor - u * 0.12 - layer * coinR * 1.1
      g.ellipse(cx2, cy2, coinR * 1.15, coinR * 0.75).fill({ color: PALETTE.goldDark })
      g.ellipse(cx2, cy2 - coinR * 0.18, coinR, coinR * 0.62).fill({ color: PALETTE.gold })
      g.ellipse(cx2 - coinR * 0.25, cy2 - coinR * 0.3, coinR * 0.4, coinR * 0.24)
        .fill({ color: PALETTE.goldLight, alpha: 0.75 })
    }
  }

  // Fill gauge on the building — the number, made physical.
  if (stage >= 1) {
    const gx = L.storeX + L.storeW + u * 0.15
    const gh = L.storeH * 0.8
    const gy = L.floor - gh
    g.roundRect(gx, gy, u * 0.34, gh, u * 0.14).fill({ color: 0x1c1917, alpha: 0.9 })
    g.roundRect(gx, gy + gh * (1 - fill), u * 0.34, gh * fill, u * 0.14)
      .fill({ color: full ? PALETTE.danger : PALETTE.gold })
    g.roundRect(gx, gy, u * 0.34, gh, u * 0.14).stroke({ color: PALETTE.steelLight, width: 1, alpha: 0.4 })
  }

  // Gold spilled on the floor once the storage is full.
  for (const s of spill) {
    g.ellipse(s.x, s.y - s.seed * u * 0.2, u * 0.16, u * 0.1).fill({ color: PALETTE.gold, alpha: 0.85 })
  }

  // Ready-to-collect glow.
  if (fill > 0.02) {
    const pulse = 0.5 + Math.sin(t * 3) * 0.5
    g.ellipse(L.storeX + L.storeW * 0.5, L.floor + 2, L.storeW * 0.75, u * 0.5)
      .fill({ color: full ? PALETTE.danger : PALETTE.gold, alpha: 0.05 + pulse * 0.08 })
  }

  // Hover outline.
  if (hovered.value) {
    const box = hovered.value === 'store'
      ? [L.storeX - u, L.floor - L.storeH - u * 2.2, L.storeW + u * 2, L.storeH + u * 3]
      : hovered.value === 'hq'
        ? [L.hqX - u * 0.6, L.floor - L.hqH - u * 2.6, L.hqW + u * 1.2, L.hqH + u * 3]
        : [L.scaffoldX - u * 0.8, L.floor - u * 4.8, L.scaffoldW + u * 1.6, u * 5.2]
    g.roundRect(box[0]!, box[1]!, box[2]!, box[3]!, u * 0.4)
      .stroke({ color: PALETTE.goldLight, width: 2, alpha: 0.5 })
  }

  // Ambience: dust motes and the odd falling pebble.
  if (Math.random() < 0.12) {
    particles.spawn({
      x: Math.random() * L.w,
      y: L.h * 0.12,
      vx: (Math.random() - 0.5) * u * 0.5,
      vy: u * (0.5 + Math.random()),
      gravity: 0,
      color: PALETTE.lamp,
      size: 1 + Math.random(),
      life: 2.6,
      maxLife: 2.6,
      shape: 'spark'
    })
  }
  if (props.overclockLevel > 0 && Math.random() < 0.06) {
    particles.spawn({
      x: L.hqX + L.hqW * 0.5 + (Math.random() - 0.5) * L.hqW,
      y: L.floor - L.hqH - u,
      vx: (Math.random() - 0.5) * u,
      vy: -u * (1 + Math.random()),
      gravity: -u * 0.3,
      color: PALETTE.danger,
      size: u * 0.14,
      life: 1.2,
      maxLife: 1.2,
      shape: 'spark'
    })
  }
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

watch(() => [props.rigLevel, props.vaultLevel, props.overclockLevel].join(','), rebuild)

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
  // `resizeTo` resizes the canvas; the layout still has to be recomputed.
  resizeObserver = new ResizeObserver(() => rebuild())
  if (wrap.value) resizeObserver.observe(wrap.value)
  app.ticker.add(() => frame(app.ticker.deltaMS))
})

onUnmounted(() => {
  destroyed = true
  resizeObserver?.disconnect()
  resizeObserver = null
  particles.clear()
  miners = []
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
    class="miner-scene relative w-full overflow-hidden rounded-2xl border border-default"
    :class="[hovered ? 'cursor-pointer' : 'cursor-crosshair', busy ? 'miner-scene--busy' : '']"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @pointerdown="onPointerDown"
  >
    <div
      class="absolute z-10 -translate-x-1/2 -translate-y-full"
      :style="{ left: `${anchors.hq.x}px`, top: `${anchors.hq.y}px` }"
    >
      <slot name="rig" />
    </div>
    <div
      class="absolute z-10 -translate-x-1/2 -translate-y-full"
      :style="{ left: `${anchors.store.x}px`, top: `${anchors.store.y}px` }"
    >
      <slot name="vault" />
    </div>
    <div
      class="absolute z-10 -translate-x-1/2 -translate-y-full"
      :style="{ left: `${anchors.scaffold.x}px`, top: `${anchors.scaffold.y}px` }"
    >
      <slot name="scaffold" />
    </div>
    <slot :miners="minerCount" :store-name="storeName" />
  </div>
</template>

<style scoped>
.miner-scene {
  height: clamp(460px, 66vh, 720px);
  background-color: #120d0a;
  touch-action: manipulation;
}

/* While a request is in flight the scene reads as "working" rather than frozen. */
.miner-scene--busy::after {
  position: absolute;
  inset: 0;
  content: '';
  pointer-events: none;
  background: radial-gradient(circle at 50% 100%, rgba(251, 191, 36, 0.09), transparent 60%);
}
</style>
