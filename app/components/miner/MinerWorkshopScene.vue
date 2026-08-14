<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PALETTE, Particles, clamp, mixColor, noise } from '~/utils/miner-scene'

const props = defineProps<{
  overclockLevel: number
  overclockMaxLevel: number
  catalystLevel: number
  catalystMaxLevel: number
  rakebackUnlocked: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  buyOverclock: []
  buyCatalyst: []
  unlockRakeback: []
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

type Station = 'overclock' | 'catalyst' | 'rakeback'
const anchors = ref<Record<Station, { x: number, y: number }>>({
  overclock: { x: 0, y: 0 },
  catalyst: { x: 0, y: 0 },
  rakeback: { x: 0, y: 0 }
})
const hovered = ref<Station | null>(null)

const overclockFrac = computed(() => clamp(props.overclockLevel / props.overclockMaxLevel, 0, 1))
const catalystFrac = computed(() => clamp(props.catalystLevel / props.catalystMaxLevel, 0, 1))

let L = {
  w: 0, h: 0, floor: 0, unit: 0,
  beltX: 0, beltW: 0, beltY: 0,
  engineX: 0, engineY: 0, engineW: 0, engineH: 0,
  vialX: 0, vialY: 0, vialW: 0, vialH: 0,
  flaskX: 0, flaskY: 0, flaskR: 0,
  safeX: 0, safeY: 0, safeW: 0, safeH: 0
}

function layout(w: number, h: number) {
  const floor = h * 0.82
  const unit = clamp(Math.min(h * 0.052, w * 0.022), 12, 30)
  const beltW = w * 0.3
  const beltX = w * 0.05
  const beltY = floor - unit * 1.9
  const engineW = unit * 3.4
  const engineH = unit * 3.6
  const vialW = unit * 2.9
  const vialH = unit * 6.2
  const safeW = unit * 4.6
  const safeH = unit * 4.6
  L = {
    w, h, floor, unit,
    beltX, beltW, beltY,
    engineX: beltX + beltW - unit * 0.4, engineY: floor - engineH, engineW, engineH,
    vialX: w * 0.56, vialY: floor - vialH - unit * 0.9, vialW, vialH,
    flaskX: w * 0.56 - unit * 3.2, flaskY: floor - unit * 1.9, flaskR: unit * 1.2,
    safeX: w * 0.82, safeY: floor - safeH, safeW, safeH
  }
  anchors.value = {
    overclock: { x: beltX + (beltW + engineW) * 0.5, y: floor - engineH - unit * 2.4 },
    catalyst: { x: L.vialX + vialW * 0.5, y: L.vialY - unit * 1.9 },
    rakeback: { x: L.safeX + safeW * 0.5, y: L.safeY - unit * 0.7 }
  }
}

function hitTest(x: number, y: number): Station | null {
  const u = L.unit
  if (x >= L.beltX - u && x <= L.engineX + L.engineW + u && y >= L.engineY - u * 2.6 && y <= L.floor + u) return 'overclock'
  if (x >= L.flaskX - u * 2 && x <= L.vialX + L.vialW + u * 1.2 && y >= L.vialY - u * 2 && y <= L.floor + u) return 'catalyst'
  if (x >= L.safeX - u && x <= L.safeX + L.safeW + u && y >= L.safeY - u && y <= L.floor + u) return 'rakeback'
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
  if (hit === 'overclock') emit('buyOverclock')
  else if (hit === 'catalyst') emit('buyCatalyst')
  else if (hit === 'rakeback') emit('unlockRakeback')
}

let t = 0
let shake = 0
let beltOffset = 0

function stationCenter(key: Station) {
  if (key === 'overclock') return { x: L.engineX + L.engineW * 0.5, y: L.engineY + L.engineH * 0.5 }
  if (key === 'catalyst') return { x: L.vialX + L.vialW * 0.5, y: L.vialY + L.vialH * 0.5 }
  return { x: L.safeX + L.safeW * 0.5, y: L.safeY + L.safeH * 0.5 }
}

function playPurchase(key: Station) {
  shake = 6
  const c = stationCenter(key)
  const color = key === 'catalyst' ? PALETTE.cyan : key === 'rakeback' ? PALETTE.gold : PALETTE.danger
  particles.burst(c.x, c.y, 26, color, { speed: L.unit * 9, size: 4, shape: 'shard', gravity: L.unit * 18 })
}

function playReject(key: Station) {
  const c = stationCenter(key)
  particles.burst(c.x, c.y, 10, PALETTE.danger, { speed: L.unit * 5, size: 3, shape: 'spark', gravity: L.unit * 18 })
}

defineExpose({ playPurchase, playReject })

// ─── Backdrop ───────────────────────────────────────────────────────────────
function drawBackdrop() {
  if (!bgG) return
  const g = bgG
  const { w, h, floor, unit: u } = L
  g.clear()
  g.rect(0, 0, w, h).fill({ color: 0x150f0b })
  for (let i = 0; i < 12; i++) {
    const k = i / 12
    g.rect(0, h * 0.08 * k, w, h).fill({ color: mixColor(0x1e1610, 0x33241a, k), alpha: 0.12 })
  }

  // Ceiling.
  g.moveTo(0, 0)
  g.lineTo(w, 0)
  g.lineTo(w, h * 0.08)
  for (let i = 16; i >= 0; i--) {
    g.lineTo((w * i) / 16, h * (0.04 + noise(i * 3.3) * 0.04))
  }
  g.closePath()
  g.fill({ color: 0x1c130d })

  // Floor with a stone lip.
  g.rect(0, floor, w, h - floor).fill({ color: 0x241a13 })
  g.rect(0, floor, w, u * 0.18).fill({ color: 0x4a3320 })
  for (let i = 0; i < 30; i++) {
    g.circle(noise(i * 4.3) * w, floor + u * 0.4 + noise(i * 7.7) * (h - floor - u), 1 + noise(i * 2.1) * 2)
      .fill({ color: 0x160f0a, alpha: 0.6 })
  }

  // Service pipes running the back wall — reads as a workshop without clutter.
  const pipeY = h * 0.2
  g.rect(0, pipeY, w, u * 0.3).fill({ color: 0x4a4a52 })
  g.rect(0, pipeY, w, u * 0.1).fill({ color: 0x6b6b75, alpha: 0.8 })
  for (let i = 0; i < 6; i++) {
    const px = w * (0.08 + i * 0.17)
    g.rect(px, pipeY - u * 0.12, u * 0.5, u * 0.54).fill({ color: 0x6b6b75 })
  }
  // Elbow dropping down to the engine.
  g.rect(L.engineX + L.engineW * 0.45, pipeY, u * 0.3, L.engineY - pipeY).fill({ color: 0x4a4a52 })

  // Wall shelf with jars and crates behind the distillery.
  const shelfX = L.flaskX - u * 3
  const shelfW = u * 12
  const shelfY = h * 0.34
  g.rect(shelfX, shelfY, shelfW, u * 0.28).fill({ color: 0x6b4a2b })
  g.rect(shelfX, shelfY + u * 0.28, u * 0.25, u * 0.6).fill({ color: 0x54381f })
  g.rect(shelfX + shelfW - u * 0.25, shelfY + u * 0.28, u * 0.25, u * 0.6).fill({ color: 0x54381f })
  for (let i = 0; i < 6; i++) {
    const jx = shelfX + u * 0.8 + i * u * 1.9
    const jh = u * (0.7 + noise(i * 3.1) * 0.5)
    const jw = u * 0.7
    g.roundRect(jx, shelfY - jh, jw, jh, u * 0.12).fill({ color: 0x1c2b30, alpha: 0.9 })
    g.roundRect(jx, shelfY - jh * 0.55, jw, jh * 0.55, u * 0.1)
      .fill({ color: i % 2 ? PALETTE.cyan : PALETTE.gold, alpha: 0.5 })
    g.rect(jx + jw * 0.2, shelfY - jh - u * 0.12, jw * 0.6, u * 0.14).fill({ color: 0x8a8f98 })
  }

  // Two hanging lamps.
  for (const lx of [w * 0.22, w * 0.68]) {
    g.rect(lx - 1, h * 0.04, 2, h * 0.07).fill({ color: 0x6b7280 })
    g.moveTo(lx - u * 0.5, h * 0.11)
    g.lineTo(lx + u * 0.5, h * 0.11)
    g.lineTo(lx + u * 0.28, h * 0.11 + u * 0.5)
    g.lineTo(lx - u * 0.28, h * 0.11 + u * 0.5)
    g.closePath()
    g.fill({ color: 0x52525b })
    g.circle(lx, h * 0.11 + u * 0.55, u * 0.22).fill({ color: PALETTE.lamp, alpha: 0.95 })
    g.circle(lx, h * 0.11 + u * 0.55, u * 1.3).fill({ color: PALETTE.lamp, alpha: 0.05 })
  }
}

// ─── Static machinery ───────────────────────────────────────────────────────
function drawStatic() {
  if (!staticG) return
  const g = staticG
  g.clear()
  drawOreLine(g)
  drawDistillery(g)
  drawSafe(g)
}

/** Hopper → belt → engine → ingot crate. Overclock drives the whole line. */
function drawOreLine(g: any) {
  const u = L.unit
  const { beltX: x, beltW: w, beltY: y, engineX: ex, engineY: ey, engineW: ew, engineH: eh } = L
  const hot = props.overclockLevel > 0

  // Belt frame legs.
  for (const lx of [x + u * 0.5, x + w * 0.55]) {
    g.rect(lx, y + u * 0.55, u * 0.26, L.floor - y - u * 0.55).fill({ color: 0x3f3f46 })
    g.rect(lx - u * 0.15, L.floor - u * 0.2, u * 0.56, u * 0.2).fill({ color: 0x52525b })
  }
  // Belt bed between two rollers.
  g.roundRect(x, y, w, u * 0.6, u * 0.2).fill({ color: 0x27272a })
  g.roundRect(x + u * 0.1, y + u * 0.06, w - u * 0.2, u * 0.16, u * 0.08).fill({ color: 0x52525b, alpha: 0.6 })
  g.circle(x + u * 0.3, y + u * 0.3, u * 0.34).fill({ color: 0x52525b })
  g.circle(x + w - u * 0.3, y + u * 0.3, u * 0.34).fill({ color: 0x52525b })

  // Hopper feeding the belt, resting on its own legs.
  const hx = x + u * 0.4
  const hTop = y - u * 2.8
  g.moveTo(hx, hTop)
  g.lineTo(hx + u * 3.2, hTop)
  g.lineTo(hx + u * 2.1, y - u * 0.35)
  g.lineTo(hx + u * 1.1, y - u * 0.35)
  g.closePath()
  g.fill({ color: 0x3f3f46 })
  g.moveTo(hx, hTop).lineTo(hx + u * 3.2, hTop).stroke({ color: 0x8a8f98, width: 2, alpha: 0.6 })
  g.rect(hx + u * 1.1, y - u * 0.4, u, u * 0.18).fill({ color: 0x52525b })
  // Raw ore visible in the hopper.
  for (let i = 0; i < 7; i++) {
    g.circle(hx + u * (0.6 + noise(i * 3.7) * 2), hTop + u * (0.4 + noise(i * 5.1) * 0.7), u * 0.22)
      .fill({ color: 0x6b5335 })
  }

  // Engine block: body, panel, firebox window, riveted top.
  g.roundRect(ex, ey, ew, eh, u * 0.22).fill({ color: hot ? mixColor(0x3f3f46, 0x5b2418, 0.5) : 0x3f3f46 })
  g.roundRect(ex, ey, ew, eh, u * 0.22).stroke({ color: 0x8a8f98, width: 1.5, alpha: 0.4 })
  g.roundRect(ex + u * 0.18, ey + u * 0.18, ew - u * 0.36, u * 0.5, u * 0.12).fill({ color: 0x52525b, alpha: 0.85 })
  for (let i = 0; i < 5; i++) {
    g.circle(ex + u * 0.45 + i * ((ew - u * 0.9) / 4), ey + u * 0.43, u * 0.09)
      .fill({ color: 0xa1a1aa, alpha: 0.7 })
  }
  // Firebox window (glow is drawn live).
  g.roundRect(ex + u * 0.3, ey + eh * 0.52, ew * 0.42, eh * 0.32, u * 0.12).fill({ color: 0x18120f })
  g.roundRect(ex + u * 0.3, ey + eh * 0.52, ew * 0.42, eh * 0.32, u * 0.12)
    .stroke({ color: 0x8a8f98, width: 1.5, alpha: 0.5 })

  // Exhaust stacks — at most three, always inside the engine footprint.
  const stacks = clamp(1 + Math.floor(props.overclockLevel / 4), 1, 3)
  for (let i = 0; i < stacks; i++) {
    const sw = u * 0.46
    const gap = (ew - u * 0.8 - stacks * sw) / Math.max(1, stacks - 1 || 1)
    const sx = ex + u * 0.4 + i * (sw + (stacks > 1 ? gap : 0))
    const sh = u * (0.9 + i * 0.18)
    g.rect(sx, ey - sh, sw, sh).fill({ color: 0x52525b })
    g.rect(sx - u * 0.1, ey - sh - u * 0.16, sw + u * 0.2, u * 0.18).fill({ color: 0x71717a })
  }

  // Output chute into an ingot crate.
  const cx = ex + ew + u * 0.2
  g.moveTo(ex + ew - u * 0.1, L.floor - u * 1.6)
  g.lineTo(cx + u * 0.9, L.floor - u * 1.1)
  g.lineTo(cx + u * 0.9, L.floor - u * 0.85)
  g.lineTo(ex + ew - u * 0.1, L.floor - u * 1.35)
  g.closePath()
  g.fill({ color: 0x52525b })
  g.roundRect(cx, L.floor - u * 0.95, u * 2.2, u * 0.95, u * 0.12).fill({ color: 0x5b3f26 })
  g.roundRect(cx, L.floor - u * 0.95, u * 2.2, u * 0.2, u * 0.08).fill({ color: 0x7c5836 })
}

/** Boiling flask → condenser coil → graduated vial. Catalyst fills the vial. */
function drawDistillery(g: any) {
  const u = L.unit
  const { vialX: vx, vialY: vy, vialW: vw, vialH: vh, flaskX: fx, flaskY: fy, flaskR: fr } = L

  // Shared bench top for the whole rig.
  g.roundRect(fx - u * 2.2, L.floor - u * 0.5, (vx + vw + u * 1.4) - (fx - u * 2.2), u * 0.5, u * 0.1)
    .fill({ color: 0x5b3f26 })
  g.rect(fx - u * 2, L.floor, u * 0.4, u * 0.9).fill({ color: 0x3f2a17 })
  g.rect(vx + vw + u * 0.8, L.floor, u * 0.4, u * 0.9).fill({ color: 0x3f2a17 })

  // Burner under the flask.
  g.roundRect(fx - u * 0.9, fy + fr * 0.85, u * 1.8, u * 0.42, u * 0.1).fill({ color: 0x3f3f46 })
  g.rect(fx - u * 0.12, fy + fr * 0.85 + u * 0.4, u * 0.24, L.floor - (fy + fr * 0.85 + u * 0.4))
    .fill({ color: 0x52525b })

  // Round boiling flask with a neck.
  g.circle(fx, fy, fr).fill({ color: 0x0b1a20, alpha: 0.55 })
  g.circle(fx, fy, fr).stroke({ color: PALETTE.cyanLight, width: 2, alpha: 0.4 })
  g.rect(fx - u * 0.35, fy - fr - u * 1.1, u * 0.7, u * 1.2).fill({ color: 0x0b1a20, alpha: 0.55 })
  g.rect(fx - u * 0.35, fy - fr - u * 1.1, u * 0.7, u * 1.2)
    .stroke({ color: PALETTE.cyanLight, width: 2, alpha: 0.4 })

  // Condenser: a copper coil climbing from the flask neck across to the vial.
  const coilTop = fy - fr - u * 1.1
  const coilX0 = fx
  const coilX1 = vx + vw * 0.5
  g.moveTo(coilX0, coilTop)
  g.lineTo(coilX0, coilTop - u * 0.8)
  g.stroke({ color: 0xb87333, width: u * 0.22 })
  const loops = 5
  for (let i = 0; i < loops; i++) {
    const k = i / (loops - 1)
    const cx = lerpX(coilX0, coilX1, k)
    const cy = coilTop - u * 0.8 - Math.sin(k * Math.PI) * u * 0.9
    g.circle(cx, cy, u * 0.34).stroke({ color: 0xb87333, width: u * 0.18, alpha: 0.95 })
  }
  g.moveTo(coilX1, coilTop - u * 0.8)
  g.lineTo(coilX1, vy - u * 1.15)
  g.stroke({ color: 0xb87333, width: u * 0.22 })

  // Vial stand.
  g.rect(vx - u * 1.05, vy + vh * 0.1, u * 0.26, L.floor - (vy + vh * 0.1)).fill({ color: 0x52525b })
  for (let i = 0; i < 2; i++) {
    g.rect(vx - u * 1.05, vy + vh * (0.25 + i * 0.45), u * 1.2, u * 0.18).fill({ color: 0x52525b })
  }

  // The vial itself: rounded bottom, straight body, narrow neck, graduations.
  g.roundRect(vx, vy, vw, vh, vw * 0.45).fill({ color: 0x0b1a20, alpha: 0.5 })
  g.roundRect(vx, vy, vw, vh, vw * 0.45).stroke({ color: PALETTE.cyanLight, width: 2, alpha: 0.45 })
  g.rect(vx + vw * 0.32, vy - u * 1.15, vw * 0.36, u * 1.25).fill({ color: 0x0b1a20, alpha: 0.5 })
  g.rect(vx + vw * 0.32, vy - u * 1.15, vw * 0.36, u * 1.25)
    .stroke({ color: PALETTE.cyanLight, width: 2, alpha: 0.45 })
  for (let i = 1; i < props.catalystMaxLevel; i++) {
    const gy = vy + vh * 0.06 + (vh * 0.88) * (1 - i / props.catalystMaxLevel)
    g.moveTo(vx + vw * 0.08, gy).lineTo(vx + vw * (i % 5 === 0 ? 0.36 : 0.22), gy)
      .stroke({ color: PALETTE.cyanLight, width: 1.2, alpha: 0.3 })
  }
}

function lerpX(a: number, b: number, k: number) {
  return a + (b - a) * k
}

function drawSafe(g: any) {
  const u = L.unit
  const { safeX: x, safeY: y, safeW: w, safeH: h } = L
  // Plinth.
  g.roundRect(x - u * 0.3, L.floor - u * 0.3, w + u * 0.6, u * 0.3, u * 0.08).fill({ color: 0x3f3f46 })
  // Body.
  g.roundRect(x, y, w, h, u * 0.22).fill({ color: 0x3f3f46 })
  g.roundRect(x, y, w, h, u * 0.22).stroke({ color: 0x8a8f98, width: 2, alpha: 0.45 })
  // Door inset with hinges.
  g.roundRect(x + u * 0.4, y + u * 0.4, w - u * 0.8, h - u * 0.8, u * 0.16).fill({ color: 0x4a4a52 })
  g.roundRect(x + u * 0.4, y + u * 0.4, w - u * 0.8, h - u * 0.8, u * 0.16)
    .stroke({ color: 0x8a8f98, width: 1.2, alpha: 0.4 })
  for (const hy of [y + h * 0.28, y + h * 0.72]) {
    g.roundRect(x + u * 0.12, hy - u * 0.22, u * 0.36, u * 0.44, u * 0.08).fill({ color: 0x71717a })
  }
  // Handle wheel + dial.
  const cx = x + w * 0.56
  const cy = y + h * 0.5
  g.circle(cx, cy, u * 0.78).stroke({ color: 0x8a8f98, width: u * 0.2, alpha: 0.9 })
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5
    g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * u * 0.78, cy + Math.sin(a) * u * 0.78)
      .stroke({ color: 0x8a8f98, width: u * 0.14, alpha: 0.9 })
  }
  g.circle(cx, cy, u * 0.22).fill({ color: 0xa1a1aa })
  g.circle(x + w * 0.24, y + h * 0.3, u * 0.3).stroke({ color: 0x8a8f98, width: 2, alpha: 0.6 })

  if (!props.rakebackUnlocked) {
    for (let i = 0; i < 2; i++) {
      const cyy = y + h * (0.3 + i * 0.36)
      g.rect(x - u * 0.35, cyy, w + u * 0.7, u * 0.3).fill({ color: 0x71717a })
      g.rect(x - u * 0.35, cyy + u * 0.1, w + u * 0.7, u * 0.08).fill({ color: 0x3f3f46, alpha: 0.85 })
    }
    // Padlock hanging off the middle.
    g.roundRect(x + w * 0.5 - u * 0.3, y + h * 0.52, u * 0.6, u * 0.5, u * 0.1).fill({ color: 0xa1a1aa })
    g.circle(x + w * 0.5, y + h * 0.52, u * 0.22).stroke({ color: 0xa1a1aa, width: u * 0.1 })
  } else {
    // Stacks of coins next to an unlocked safe.
    for (let i = 0; i < 3; i++) {
      const sx = x + w + u * (0.5 + i * 0.7)
      const stackH = 3 + i
      for (let k = 0; k < stackH; k++) {
        g.ellipse(sx, L.floor - u * 0.2 - k * u * 0.16, u * 0.3, u * 0.11).fill({ color: PALETTE.gold })
      }
    }
  }
}

// ─── Live pass ──────────────────────────────────────────────────────────────
function drawLive(dt: number) {
  if (!liveG) return
  const g = liveG
  g.clear()
  const u = L.unit
  const { beltX: x, beltW: w, beltY: y, engineX: ex, engineY: ey, engineW: ew, engineH: eh } = L
  const speedMult = 1 + overclockFrac.value * 2.6

  // Belt chevrons.
  beltOffset = (beltOffset + dt * u * 3.6 * speedMult) % (u * 0.9)
  for (let bx = x + u * 0.4 + beltOffset; bx < x + w - u * 0.4; bx += u * 0.9) {
    g.moveTo(bx, y + u * 0.14)
    g.lineTo(bx + u * 0.2, y + u * 0.3)
    g.lineTo(bx, y + u * 0.46)
    g.stroke({ color: 0x8a8f98, width: 1.4, alpha: 0.35 })
  }

  // Ore riding the belt; it leaves the engine as a gold ingot.
  const chunks = 6
  for (let i = 0; i < chunks; i++) {
    const p = ((t * speedMult * 0.2) + i / chunks) % 1
    const ox = x + u * 1.4 + p * (w - u * 2)
    const oy = y - u * 0.26
    g.circle(ox, oy, u * 0.26).fill({ color: 0x6b5335 })
    g.circle(ox - u * 0.07, oy - u * 0.07, u * 0.1).fill({ color: PALETTE.gold, alpha: 0.85 })
  }
  // Finished ingots dropping down the chute into the crate.
  for (let i = 0; i < 3; i++) {
    const p = ((t * speedMult * 0.35) + i / 3) % 1
    const sx = ex + ew - u * 0.2 + p * u * 1.1
    const sy = L.floor - u * 1.5 + p * u * 0.5
    g.roundRect(sx, sy, u * 0.55, u * 0.26, u * 0.07).fill({ color: PALETTE.gold })
    g.rect(sx + u * 0.06, sy + u * 0.05, u * 0.3, u * 0.07).fill({ color: PALETTE.goldLight, alpha: 0.7 })
  }

  // Firebox glow, hotter with each overclock level.
  const fireA = 0.25 + overclockFrac.value * 0.6 + 0.1 * Math.sin(t * 9)
  g.roundRect(ex + u * 0.36, ey + eh * 0.55, ew * 0.42 - u * 0.12, eh * 0.32 - u * 0.12, u * 0.1)
    .fill({ color: mixColor(0xb45309, PALETTE.danger, overclockFrac.value), alpha: fireA })

  // Flywheel on the engine side, linked to the belt roller by a drive band.
  const fx = ex + ew * 0.74
  const fy = ey + eh * 0.62
  const fr = u * 0.85
  const spin = t * (1.6 + overclockFrac.value * 9)
  g.moveTo(x + w - u * 0.3, y + u * 0.3 - u * 0.34)
  g.lineTo(fx, fy - fr)
  g.stroke({ color: 0x27272a, width: u * 0.12, alpha: 0.9 })
  g.moveTo(x + w - u * 0.3, y + u * 0.3 + u * 0.34)
  g.lineTo(fx, fy + fr)
  g.stroke({ color: 0x27272a, width: u * 0.12, alpha: 0.9 })
  g.circle(fx, fy, fr).fill({ color: 0x27272a })
  g.circle(fx, fy, fr).stroke({ color: mixColor(0x8a8f98, PALETTE.gold, overclockFrac.value), width: u * 0.16, alpha: 0.95 })
  for (let i = 0; i < 6; i++) {
    const a = spin + (i / 6) * Math.PI * 2
    g.moveTo(fx, fy)
    g.lineTo(fx + Math.cos(a) * fr * 0.86, fy + Math.sin(a) * fr * 0.86)
    g.stroke({ color: mixColor(0x71717a, PALETTE.lamp, overclockFrac.value), width: u * 0.1, alpha: 0.9 })
  }
  g.circle(fx, fy, u * 0.16).fill({ color: 0xa1a1aa })

  // Smoke out of the stacks.
  if (Math.random() < 0.12 + overclockFrac.value * 0.3) {
    const stacks = clamp(1 + Math.floor(props.overclockLevel / 4), 1, 3)
    const sw = u * 0.46
    const gap = (ew - u * 0.8 - stacks * sw) / Math.max(1, stacks - 1 || 1)
    const i = Math.floor(Math.random() * stacks)
    const sx = ex + u * 0.4 + i * (sw + (stacks > 1 ? gap : 0)) + sw * 0.5
    particles.spawn({
      x: sx,
      y: ey - u * (1 + i * 0.18),
      vx: (Math.random() - 0.5) * u * 0.7,
      vy: -u * (1.2 + Math.random() * 1.4),
      gravity: -u * 0.2,
      color: mixColor(0x9ca3af, PALETTE.danger, overclockFrac.value * 0.8),
      size: u * (0.16 + Math.random() * 0.16),
      life: 1.6,
      maxLife: 1.6,
      shape: 'spark'
    })
  }

  // Overclock gauge plate on the engine face.
  drawPips(g, ex + u * 0.3, ey + eh * 0.4, ew - u * 0.6, props.overclockLevel, props.overclockMaxLevel, PALETTE.gold)

  // ── Distillery.
  const { vialX: vx, vialY: vy, vialW: vw, vialH: vh, flaskX: flx, flaskY: fly, flaskR: flr } = L
  const frac = catalystFrac.value

  // Flask always boils; harder as the catalyst climbs.
  const boilLevel = fly + flr * 0.15
  g.moveTo(flx - flr * 0.92, boilLevel)
  for (let i = 0; i <= 6; i++) {
    const px = flx - flr * 0.92 + (flr * 1.84 * i) / 6
    g.lineTo(px, boilLevel + Math.sin(t * 4 + i) * u * 0.09)
  }
  g.lineTo(flx + flr * 0.92, fly + flr * 0.9)
  g.lineTo(flx - flr * 0.92, fly + flr * 0.9)
  g.closePath()
  g.fill({ color: PALETTE.cyanDark, alpha: 0.8 })
  for (let i = 0; i < 5; i++) {
    const bt = (t * (0.7 + i * 0.14) * (1 + frac)) % 1
    const bx = flx - flr * 0.6 + noise(i * 3.1) * flr * 1.2
    const by = fly + flr * 0.8 - bt * flr * 0.75
    g.circle(bx, by, u * (0.07 + noise(i) * 0.1)).fill({ color: PALETTE.cyanLight, alpha: 0.5 * (1 - bt) })
  }
  // Burner flame.
  const flameH = u * (0.35 + frac * 0.6) * (0.85 + 0.15 * Math.sin(t * 16))
  g.moveTo(flx - u * 0.3, fly + flr * 0.85)
  g.lineTo(flx, fly + flr * 0.85 - flameH)
  g.lineTo(flx + u * 0.3, fly + flr * 0.85)
  g.closePath()
  g.fill({ color: PALETTE.cyan, alpha: 0.55 })

  // Vial contents: one graduation per catalyst level.
  const liquidH = vh * (0.06 + frac * 0.86)
  const top = vy + vh - liquidH
  g.moveTo(vx + vw * 0.07, vy + vh - vw * 0.4)
  g.lineTo(vx + vw * 0.07, top)
  for (let i = 0; i <= 6; i++) {
    const px = vx + vw * 0.07 + ((vw * 0.86) * i) / 6
    g.lineTo(px, top + Math.sin(t * 2.2 + i * 0.7) * u * 0.1)
  }
  g.lineTo(vx + vw * 0.93, vy + vh - vw * 0.4)
  g.closePath()
  g.fill({ color: mixColor(PALETTE.cyanDark, PALETTE.cyan, 0.4 + frac * 0.5), alpha: 0.85 })
  g.ellipse(vx + vw * 0.5, vy + vh - vw * 0.4, vw * 0.43, vw * 0.4)
    .fill({ color: mixColor(PALETTE.cyanDark, PALETTE.cyan, 0.4 + frac * 0.5), alpha: 0.85 })
  const bubbles = 4 + Math.round(frac * 7)
  for (let i = 0; i < bubbles; i++) {
    const bt = (t * (0.45 + i * 0.08) * (1 + frac)) % 1
    const bx = vx + vw * 0.2 + noise(i * 3.1) * vw * 0.6
    const by = vy + vh - vw * 0.35 - bt * (liquidH - u * 0.2)
    if (by > top) g.circle(bx, by, u * (0.07 + noise(i) * 0.1)).fill({ color: PALETTE.cyanLight, alpha: 0.4 * (1 - bt) })
  }
  // Condensate dripping down the last coil into the vial neck.
  if (Math.random() < 0.08 + frac * 0.15) {
    particles.spawn({
      x: vx + vw * 0.5,
      y: vy - u * 1.1,
      vx: 0,
      vy: u * 2,
      gravity: u * 6,
      color: PALETTE.cyanLight,
      size: u * 0.12,
      life: 0.5,
      maxLife: 0.5,
      shape: 'spark'
    })
  }
  drawPips(g, vx - u * 1.05, L.floor - u * 0.9, vw + u * 2.1, props.catalystLevel, props.catalystMaxLevel, PALETTE.cyan)

  // ── Safe.
  const { safeX: sx, safeY: sy, safeW: sw, safeH: sh } = L
  if (props.rakebackUnlocked) {
    const pulse = 0.5 + Math.sin(t * 2) * 0.5
    g.roundRect(sx + u * 0.4, sy + u * 0.4, sw - u * 0.8, sh - u * 0.8, u * 0.16)
      .stroke({ color: PALETTE.gold, width: 2, alpha: 0.25 + pulse * 0.35 })
  } else {
    g.circle(sx + sw * 0.24, sy + sh * 0.3, u * 0.3)
      .stroke({ color: PALETTE.danger, width: 1.5, alpha: 0.25 + 0.2 * Math.sin(t * 4) })
  }

  // Hover outline.
  if (hovered.value) {
    const box = hovered.value === 'overclock'
      ? [L.beltX - u * 0.6, ey - u * 2.6, (ex + ew) - L.beltX + u * 3.4, L.floor - ey + u * 3]
      : hovered.value === 'catalyst'
        ? [flx - u * 2.4, vy - u * 2.6, (vx + vw + u * 1.4) - (flx - u * 2.4), L.floor - vy + u * 3.4]
        : [sx - u * 0.6, sy - u * 0.6, sw + u * 1.2, sh + u * 1.2]
    g.roundRect(box[0]!, box[1]!, box[2]!, box[3]!, u * 0.4)
      .stroke({ color: PALETTE.goldLight, width: 2, alpha: 0.4 })
  }
}

/** Compact level track — pips stay inside the machine they belong to. */
function drawPips(g: any, x: number, y: number, w: number, level: number, max: number, color: number) {
  const pipW = w / max
  for (let i = 0; i < max; i++) {
    const on = i < level
    g.roundRect(x + i * pipW, y, Math.max(2, pipW - pipW * 0.3), L.unit * 0.16, L.unit * 0.06)
      .fill({ color: on ? color : 0x3f3f46, alpha: on ? 0.95 : 0.55 })
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

watch(() => [props.overclockLevel, props.catalystLevel, props.rakebackUnlocked].join(','), rebuild)

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
    class="workshop-scene relative w-full overflow-hidden rounded-2xl border border-default"
    :class="[hovered ? 'cursor-pointer' : 'cursor-default', busy ? 'workshop-scene--busy' : '']"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @pointerdown="onPointerDown"
  >
    <div
      v-for="key in (['overclock', 'catalyst', 'rakeback'] as const)"
      :key="key"
      class="absolute z-10 -translate-x-1/2 -translate-y-full"
      :style="{ left: `${anchors[key].x}px`, top: `${anchors[key].y}px` }"
    >
      <slot :name="key" />
    </div>
    <slot />
  </div>
</template>

<style scoped>
.workshop-scene {
  height: clamp(420px, 58vh, 620px);
  background-color: #150f0b;
  touch-action: manipulation;
}

.workshop-scene--busy::after {
  position: absolute;
  inset: 0;
  content: '';
  pointer-events: none;
  background: radial-gradient(circle at 50% 100%, rgba(251, 191, 36, 0.08), transparent 60%);
}
</style>
