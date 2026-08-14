<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PALETTE, Particles, clamp, mixColor, noise, drawStickFigure } from '~/utils/miner-scene'

const props = defineProps<{
  slots: number
  maxSlots: number
  freeRemaining: number
  busy: boolean
}>()

const emit = defineEmits<{
  open: []
  buySlot: []
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

const anchors = ref({ cart: { x: 0, y: 0 }, crane: { x: 0, y: 0 } })
/** Centre of the reveal stage, published for the DOM prize card. */
const stagePos = ref({ x: 0, y: 0 })
const hovered = ref<'cart' | 'crane' | null>(null)
/** Drives the DOM prize card that sits over the burst. */
const revealPhase = ref<'idle' | 'lift' | 'charge' | 'burst'>('idle')

let L = {
  w: 0, h: 0, rail: 0, unit: 0,
  cartX: 0, cartY: 0, cartW: 0, cartH: 0,
  craneX: 0, craneY: 0, craneW: 0,
  stageX: 0, stageY: 0,
  crate: 0, cols: 5
}

function layout(w: number, h: number) {
  const rail = h * 0.86
  const unit = clamp(Math.min(h * 0.055, w * 0.022), 12, 30)
  const cols = 5
  const cartW = unit * 11
  const cartH = unit * 3.2
  L = {
    w, h, rail, unit,
    cartX: w * 0.06, cartY: rail - cartH - unit * 0.5, cartW, cartH,
    craneX: w * 0.7, craneY: h * 0.1, craneW: Math.min(w * 0.2, unit * 9),
    stageX: w * 0.42, stageY: h * 0.42,
    crate: unit * 1.55, cols
  }
  anchors.value = {
    cart: { x: L.cartX + cartW / 2, y: L.cartY - unit * 1.2 },
    crane: { x: L.craneX + L.craneW / 2, y: L.craneY + h * 0.3 }
  }
  stagePos.value = { x: L.stageX, y: L.stageY - unit * 5 }
}

function hitTest(x: number, y: number): 'cart' | 'crane' | null {
  const u = L.unit
  if (x >= L.cartX - u && x <= L.cartX + L.cartW + u && y >= L.cartY - u * 2 && y <= L.rail + u) return 'cart'
  if (x >= L.craneX - u && x <= L.craneX + L.craneW + u && y >= L.craneY - u && y <= L.craneY + L.h * 0.42) return 'crane'
  return null
}

function onPointerMove(e: PointerEvent) {
  const rect = wrap.value?.getBoundingClientRect()
  if (!rect) return
  hovered.value = revealPhase.value === 'idle' ? hitTest(e.clientX - rect.left, e.clientY - rect.top) : null
}

function onPointerLeave() { hovered.value = null }

function onPointerDown(e: PointerEvent) {
  if (revealPhase.value !== 'idle') return
  const rect = wrap.value?.getBoundingClientRect()
  if (!rect) return
  const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
  if (hit === 'cart') emit('open')
  else if (hit === 'crane') emit('buySlot')
}

let t = 0
let shake = 0
let haulerX = 0
let haulerDir: 1 | -1 = 1

// ─── Reveal timeline ────────────────────────────────────────────────────────
// A crate lifts out of the cart, rattles harder and harder under a spotlight,
// then blows its lid. The page drives it: startReveal() on the click,
// finishReveal() once the server has said what was won.
const LIFT_SECONDS = 0.55
let revealStart = 0
let chargeSeconds = 2.4
let burstAt = 0
let burstColor: number = PALETTE.gold

function startReveal(seconds: number) {
  revealStart = t
  chargeSeconds = Math.max(0.6, seconds)
  revealPhase.value = 'lift'
}

function finishReveal(color: number) {
  burstColor = color
  burstAt = t
  revealPhase.value = 'burst'
  shake = 12
  const { x, y } = cratePosition()
  particles.burst(x, y, 46, color, { speed: L.unit * 16, size: L.unit * 0.22, gravity: L.unit * 26 })
  particles.burst(x, y, 20, PALETTE.goldLight, { speed: L.unit * 9, size: L.unit * 0.14, shape: 'shard', gravity: L.unit * 20 })
  for (let i = 0; i < 26; i++) {
    particles.spawn({
      x: x + (Math.random() - 0.5) * L.unit * 6,
      y: -L.unit,
      vx: (Math.random() - 0.5) * L.unit * 2,
      vy: L.unit * (4 + Math.random() * 5),
      gravity: L.unit * 14,
      color: PALETTE.gold,
      size: L.unit * (0.12 + Math.random() * 0.1),
      life: 2.2,
      maxLife: 2.2,
      shape: 'coin',
      spin: (Math.random() - 0.5) * 14
    })
  }
  setTimeout(() => { if (revealPhase.value === 'burst') revealPhase.value = 'idle' }, 2600)
}

function cancelReveal() {
  revealPhase.value = 'idle'
}

function playSlotAdded() {
  shake = 6
  particles.burst(L.craneX + L.craneW / 2, L.craneY + L.h * 0.24, 20, PALETTE.steelLight, {
    speed: L.unit * 8, size: 3, shape: 'shard', gravity: L.unit * 18
  })
}

function playReject(which: 'cart' | 'crane') {
  const x = which === 'cart' ? L.cartX + L.cartW / 2 : L.craneX + L.craneW / 2
  particles.burst(x, L.rail - L.unit * 2, 10, PALETTE.danger, { speed: L.unit * 5, size: 3, shape: 'spark', gravity: L.unit * 18 })
}

defineExpose({ startReveal, finishReveal, cancelReveal, playSlotAdded, playReject })

/** Where the featured crate is right now, mid-timeline. */
function cratePosition() {
  const from = { x: L.cartX + L.cartW * 0.5, y: L.cartY - L.crate * 0.4 }
  const to = { x: L.stageX, y: L.stageY }
  if (revealPhase.value === 'idle') return from
  const elapsed = t - revealStart
  if (revealPhase.value === 'lift' || elapsed < LIFT_SECONDS) {
    const k = clamp(elapsed / LIFT_SECONDS, 0, 1)
    const ease = 1 - Math.pow(1 - k, 3)
    return { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease - Math.sin(ease * Math.PI) * L.unit }
  }
  return to
}

// ─── Backdrop ───────────────────────────────────────────────────────────────
function drawBackdrop() {
  if (!bgG) return
  const g = bgG
  const { w, h, rail, unit: u } = L
  g.clear()
  g.rect(0, 0, w, h).fill({ color: 0x14100c })
  for (let i = 0; i < 12; i++) {
    const k = i / 12
    g.rect(0, h * 0.08 * k, w, h).fill({ color: mixColor(0x1d1610, 0x35251a, k), alpha: 0.12 })
  }
  // Ceiling.
  g.moveTo(0, 0)
  g.lineTo(w, 0)
  g.lineTo(w, h * 0.09)
  for (let i = 16; i >= 0; i--) {
    g.lineTo((w * i) / 16, h * (0.04 + noise(i * 3.9) * 0.05))
  }
  g.closePath()
  g.fill({ color: 0x1c130d })

  // Tunnel mouth behind the cart for depth.
  g.roundRect(w * 0.02, rail - h * 0.42, w * 0.3, h * 0.42, w * 0.15).fill({ color: 0x0d0906, alpha: 0.55 })

  // Ground + rails.
  g.rect(0, rail, w, h - rail).fill({ color: 0x241a12 })
  for (let x = 0; x < w; x += u * 1.2) {
    g.rect(x, rail + u * 0.22, u * 0.8, u * 0.26).fill({ color: 0x3a2a1c })
  }
  g.rect(0, rail + u * 0.1, w, u * 0.12).fill({ color: 0x8a8f98, alpha: 0.8 })
  g.rect(0, rail + u * 0.52, w, u * 0.1).fill({ color: 0x6b7280, alpha: 0.7 })

  // Support beams and lamps.
  for (let i = 0; i < 4; i++) {
    const bx = w * (0.14 + i * 0.24)
    g.rect(bx - u * 0.16, h * 0.07, u * 0.32, rail - h * 0.07).fill({ color: 0x4a3320, alpha: 0.85 })
    g.rect(bx - u * 0.9, h * 0.07, u * 1.8, u * 0.28).fill({ color: 0x5b3f26, alpha: 0.9 })
    if (i % 2 === 0) {
      const ly = h * 0.07 + u * 1.5
      g.moveTo(bx, h * 0.07 + u * 0.28).lineTo(bx, ly).stroke({ color: 0x6b7280, width: 1.5 })
      g.circle(bx, ly, u * 0.24).fill({ color: PALETTE.lamp, alpha: 0.9 })
      g.circle(bx, ly, u * 1.2).fill({ color: PALETTE.lamp, alpha: 0.05 })
    }
  }
}

// ─── Static props ───────────────────────────────────────────────────────────
function drawStatic() {
  if (!staticG) return
  const g = staticG
  g.clear()
  drawCart(g)
  drawCrane(g)
}

function drawCart(g: any) {
  const u = L.unit
  const { cartX: x, cartY: y, cartW: w, cartH: h } = L
  // Body: wooden tub with steel bands, slightly tapered.
  g.moveTo(x, y)
  g.lineTo(x + w, y)
  g.lineTo(x + w - u * 0.9, y + h)
  g.lineTo(x + u * 0.9, y + h)
  g.closePath()
  g.fill({ color: 0x6b4a2b })
  g.stroke({ color: 0x3f2a17, width: 2 })
  // Plank seams.
  for (let i = 1; i < 4; i++) {
    const px = x + (w * i) / 4
    g.moveTo(px, y).lineTo(px - u * 0.9 * (i / 4), y + h)
      .stroke({ color: 0x54381f, width: 1.5, alpha: 0.7 })
  }
  // Iron bands + rim.
  g.rect(x - u * 0.2, y - u * 0.22, w + u * 0.4, u * 0.34).fill({ color: 0x52525b })
  g.rect(x - u * 0.2, y - u * 0.22, w + u * 0.4, u * 0.1).fill({ color: 0x8a8f98, alpha: 0.6 })
  g.moveTo(x + u * 0.3, y + h * 0.55)
  g.lineTo(x + w - u * 0.3, y + h * 0.55)
  g.stroke({ color: 0x52525b, width: u * 0.18, alpha: 0.85 })
  // Chassis + wheels.
  g.rect(x + u * 0.6, y + h, w - u * 1.2, u * 0.3).fill({ color: 0x3f3f46 })
  for (const wx of [x + w * 0.26, x + w * 0.74]) {
    g.circle(wx, L.rail + u * 0.18, u * 0.62).fill({ color: 0x27272a })
    g.circle(wx, L.rail + u * 0.18, u * 0.62).stroke({ color: 0x8a8f98, width: 2, alpha: 0.55 })
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI
      g.moveTo(wx - Math.cos(a) * u * 0.5, L.rail + u * 0.18 - Math.sin(a) * u * 0.5)
      g.lineTo(wx + Math.cos(a) * u * 0.5, L.rail + u * 0.18 + Math.sin(a) * u * 0.5)
      g.stroke({ color: 0x52525b, width: 2, alpha: 0.8 })
    }
    g.circle(wx, L.rail + u * 0.18, u * 0.16).fill({ color: 0x8a8f98 })
  }
}

function drawCrane(g: any) {
  const u = L.unit
  const { craneX: x, craneY: y, craneW: w } = L
  // Gantry beam with a mast down to the floor.
  g.rect(x, y, w, u * 0.34).fill({ color: 0x52525b })
  g.rect(x, y, w, u * 0.12).fill({ color: 0x8a8f98, alpha: 0.6 })
  g.rect(x + w - u * 0.4, y, u * 0.4, L.rail - y).fill({ color: 0x3f3f46 })
  g.rect(x + w - u * 1.2, L.rail - u * 0.3, u * 2, u * 0.3).fill({ color: 0x3f3f46 })
  // Diagonal brace.
  g.moveTo(x + w - u * 0.4, y + u * 2)
  g.lineTo(x + w * 0.45, y + u * 0.34)
  g.stroke({ color: 0x3f3f46, width: u * 0.2 })
}

/** Wooden loot crate. `charge` 0..1 lights the seams; `ghost` draws an empty slot. */
function drawCrate(g: any, cx: number, cy: number, size: number, charge: number, ghost = false) {
  const half = size / 2
  if (ghost) {
    g.roundRect(cx - half, cy - half, size, size, size * 0.12)
      .stroke({ color: PALETTE.steelLight, width: 1.4, alpha: 0.25 })
    g.moveTo(cx - half * 0.34, cy).lineTo(cx + half * 0.34, cy)
      .stroke({ color: PALETTE.steelLight, width: 1.4, alpha: 0.3 })
    g.moveTo(cx, cy - half * 0.34).lineTo(cx, cy + half * 0.34)
      .stroke({ color: PALETTE.steelLight, width: 1.4, alpha: 0.3 })
    return
  }
  const wood = mixColor(0x6b4a2b, 0x8b5a2b, charge * 0.5)
  g.roundRect(cx - half, cy - half, size, size, size * 0.1).fill({ color: wood })
  g.roundRect(cx - half, cy - half, size, size, size * 0.1).stroke({ color: 0x3f2a17, width: 1.5 })
  // Plank lines and corner irons.
  g.moveTo(cx - half, cy - half * 0.3).lineTo(cx + half, cy - half * 0.3)
    .stroke({ color: 0x54381f, width: 1.2, alpha: 0.8 })
  g.moveTo(cx - half, cy + half * 0.35).lineTo(cx + half, cy + half * 0.35)
    .stroke({ color: 0x54381f, width: 1.2, alpha: 0.8 })
  g.rect(cx - half, cy - half, size, size * 0.14).fill({ color: 0x52525b, alpha: 0.85 })
  g.rect(cx - half, cy + half - size * 0.14, size, size * 0.14).fill({ color: 0x52525b, alpha: 0.85 })
  // Lock plate.
  g.roundRect(cx - size * 0.12, cy - size * 0.08, size * 0.24, size * 0.24, size * 0.05)
    .fill({ color: charge > 0 ? PALETTE.gold : 0x8a8f98, alpha: 0.95 })
  if (charge > 0) {
    g.roundRect(cx - half, cy - half, size, size, size * 0.1)
      .stroke({ color: PALETTE.gold, width: 2, alpha: 0.25 + charge * 0.5 })
  }
}

// ─── Live pass ──────────────────────────────────────────────────────────────
function drawLive(dt: number) {
  if (!liveG) return
  const g = liveG
  g.clear()
  const u = L.unit
  const size = L.crate
  const cols = L.cols
  const phase = revealPhase.value
  const featuredHidden = phase !== 'idle'

  // Crates loaded in the cart. Owned = solid, free opens glow, rest are ghosts.
  for (let i = 0; i < props.maxSlots; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx = L.cartX + u * 1.1 + (L.cartW - u * 2.2) * ((col + 0.5) / cols)
    const cy = L.cartY + L.cartH * 0.42 - row * (size * 0.92)
    const owned = i < props.slots
    // The first charged crate is the one that flies out during a reveal.
    if (featuredHidden && i === 0) continue
    if (!owned) {
      drawCrate(g, cx, cy, size, 0, true)
      continue
    }
    const charged = i < props.freeRemaining
    const bob = charged ? Math.sin(t * 2 + i) * u * 0.06 : 0
    drawCrate(g, cx, cy + bob, size, charged ? 0.55 + 0.45 * Math.sin(t * 3 + i) : 0)
  }

  // Crane hook with the next slot's crate.
  const hookX = L.craneX + L.craneW * 0.5
  const hookY = L.craneY + L.h * 0.2 + Math.sin(t * 1.6) * u * 0.2
  const soldOut = props.slots >= props.maxSlots
  g.moveTo(hookX, L.craneY + u * 0.34).lineTo(hookX, hookY).stroke({ color: 0x8a8f98, width: 2, alpha: 0.8 })
  g.moveTo(hookX - u * 0.25, hookY).lineTo(hookX + u * 0.25, hookY).stroke({ color: 0x8a8f98, width: 2 })
  drawCrate(g, hookX, hookY + size * 0.62, size, 0, soldOut)

  // Hauler pacing between the cart and the crane.
  const railLeft = L.cartX + L.cartW + u * 1.2
  const railRight = Math.max(railLeft + u * 2, L.craneX - u * 1.5)
  if (haulerX === 0) haulerX = railLeft
  haulerX += haulerDir * u * 1.9 * dt
  if (haulerX > railRight) { haulerX = railRight; haulerDir = -1 }
  if (haulerX < railLeft) { haulerX = railLeft; haulerDir = 1 }
  drawStickFigure(g, {
    x: haulerX,
    baseY: L.rail + u * 0.2,
    unit: u,
    dir: haulerDir,
    swing: null,
    walk: t * 9,
    helmet: PALETTE.gold,
    lampCone: false
  })

  // Dust motes.
  if (Math.random() < 0.07) {
    particles.spawn({
      x: Math.random() * L.w,
      y: L.h * 0.12,
      vx: (Math.random() - 0.5) * u * 0.4,
      vy: u * (0.4 + Math.random() * 0.6),
      gravity: 0,
      color: PALETTE.lamp,
      size: 1 + Math.random(),
      life: 2.6,
      maxLife: 2.6,
      shape: 'spark'
    })
  }

  // Hover outline.
  if (hovered.value === 'cart') {
    g.roundRect(L.cartX - u, L.cartY - size * 1.6, L.cartW + u * 2, L.rail - L.cartY + size * 2, u * 0.4)
      .stroke({ color: PALETTE.goldLight, width: 2, alpha: 0.45 })
  } else if (hovered.value === 'crane') {
    g.roundRect(L.craneX - u, L.craneY - u, L.craneW + u * 2, L.h * 0.42, u * 0.4)
      .stroke({ color: PALETTE.goldLight, width: 2, alpha: 0.45 })
  }

  // Ready glow under the cart.
  if (props.freeRemaining > 0 && phase === 'idle') {
    const pulse = 0.5 + Math.sin(t * 2.4) * 0.5
    g.ellipse(L.cartX + L.cartW / 2, L.rail + u * 0.7, L.cartW * 0.5, u * 0.5)
      .fill({ color: PALETTE.gold, alpha: 0.05 + pulse * 0.07 })
  }

  if (phase !== 'idle') drawReveal(g)
}

/** The opening ceremony: spotlight, rattle, then the lid comes off. */
function drawReveal(g: any) {
  const u = L.unit
  const phase = revealPhase.value
  const elapsed = t - revealStart
  const charging = phase === 'charge' || (phase === 'lift' && elapsed >= LIFT_SECONDS)
  if (phase === 'lift' && elapsed >= LIFT_SECONDS) revealPhase.value = 'charge'
  const chargeK = charging ? clamp((elapsed - LIFT_SECONDS) / chargeSeconds, 0, 1) : 0
  const pos = cratePosition()
  const bursting = phase === 'burst'
  const burstK = bursting ? clamp((t - burstAt) / 1.6, 0, 1) : 0

  // Dim the room and put a light cone on the crate.
  const dim = bursting ? 0.5 * (1 - burstK) : 0.2 + chargeK * 0.4
  g.rect(0, 0, L.w, L.h).fill({ color: 0x000000, alpha: dim })
  g.moveTo(pos.x - u * 0.8, 0)
  g.lineTo(pos.x + u * 0.8, 0)
  g.lineTo(pos.x + u * 3.4, pos.y + u * 2)
  g.lineTo(pos.x - u * 3.4, pos.y + u * 2)
  g.closePath()
  g.fill({ color: PALETTE.lamp, alpha: 0.05 + chargeK * 0.05 })

  const size = L.crate * (1.7 + chargeK * 0.3)

  if (!bursting) {
    // Rattle harder as the charge builds.
    const j = chargeK * u * 0.5
    const jx = pos.x + (Math.random() - 0.5) * j
    const jy = pos.y + (Math.random() - 0.5) * j
    drawCrate(g, jx, jy, size, 0.4 + chargeK * 0.6)
    // Charge ring.
    const ringR = size * (0.8 + Math.sin(t * 6) * 0.05)
    g.circle(pos.x, pos.y, ringR).stroke({ color: PALETTE.gold, width: 2, alpha: 0.15 + chargeK * 0.4 })
    // Arc of progress around the crate so the wait reads as a countdown.
    // `arc` continues the current path, so start it explicitly — otherwise pixi
    // draws a leader line from wherever the last path point was.
    const arcR = ringR + u * 0.5
    g.moveTo(pos.x, pos.y - arcR)
    g.arc(pos.x, pos.y, arcR, -Math.PI / 2, -Math.PI / 2 + chargeK * Math.PI * 2)
    g.stroke({ color: PALETTE.goldLight, width: 3, alpha: 0.8 })
    // Sparks leaking from the seams.
    if (Math.random() < 0.1 + chargeK * 0.5) {
      particles.spawn({
        x: pos.x + (Math.random() - 0.5) * size,
        y: pos.y + (Math.random() - 0.5) * size,
        vx: (Math.random() - 0.5) * u * 3,
        vy: -u * (1 + Math.random() * 2),
        gravity: u * 6,
        color: PALETTE.gold,
        size: u * 0.12,
        life: 0.8,
        maxLife: 0.8,
        shape: 'spark'
      })
    }
  } else {
    // Light column and shockwave rings.
    const colW = u * (1.6 + burstK * 5)
    g.rect(pos.x - colW * 0.5, 0, colW, L.h).fill({ color: burstColor, alpha: 0.22 * (1 - burstK) })
    for (let i = 0; i < 3; i++) {
      const k = clamp(burstK * 1.6 - i * 0.18, 0, 1)
      if (k <= 0) continue
      g.circle(pos.x, pos.y, size * (0.6 + k * 4))
        .stroke({ color: burstColor, width: 3 * (1 - k), alpha: 0.6 * (1 - k) })
    }
    // Open crate body + lid tumbling away.
    const lidK = clamp(burstK * 2, 0, 1)
    drawCrate(g, pos.x, pos.y + size * 0.1, size, 1)
    g.roundRect(pos.x - size * 0.55, pos.y - size * 0.5 - lidK * u * 6, size * 1.1, size * 0.2, size * 0.06)
      .fill({ color: 0x6b4a2b, alpha: 1 - lidK * 0.7 })
    g.circle(pos.x, pos.y, size * 0.42 * (1 - burstK)).fill({ color: burstColor, alpha: 0.8 * (1 - burstK) })
  }
}

function frame(dtMs: number) {
  const dt = Math.min(0.05, dtMs / 1000)
  t += dt
  particles.update(dt)
  drawLive(dt)
  particles.draw(partG)
  if (shake > 0.05) {
    shake *= 0.88
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

watch(() => [props.slots, props.maxSlots].join(','), rebuild)

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
    class="cart-scene relative w-full overflow-hidden rounded-2xl border border-default"
    :class="[hovered ? 'cursor-pointer' : 'cursor-default', busy ? 'cart-scene--busy' : '']"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @pointerdown="onPointerDown"
  >
    <div
      v-show="revealPhase === 'idle'"
      class="absolute z-10 -translate-x-1/2 -translate-y-full"
      :style="{ left: `${anchors.cart.x}px`, top: `${anchors.cart.y}px` }"
    >
      <slot name="cart" />
    </div>
    <div
      v-show="revealPhase === 'idle'"
      class="absolute z-10 -translate-x-1/2"
      :style="{ left: `${anchors.crane.x}px`, top: `${anchors.crane.y}px` }"
    >
      <slot name="crane" />
    </div>
    <!-- Prize card, centred on the crate that just blew its lid. -->
    <div
      class="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
      :style="{ left: `${stagePos.x}px`, top: `${stagePos.y}px` }"
    >
      <slot name="prize" :phase="revealPhase" />
    </div>
    <slot />
  </div>
</template>

<style scoped>
.cart-scene {
  height: clamp(420px, 60vh, 640px);
  background-color: #14100c;
  touch-action: manipulation;
}

.cart-scene--busy::after {
  position: absolute;
  inset: 0;
  content: '';
  pointer-events: none;
  background: radial-gradient(circle at 50% 100%, rgba(251, 191, 36, 0.08), transparent 60%);
}
</style>
