<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */

import { deriveTrackModifiers } from '#shared/utils/colony'

// The terrarium — a glass-walled world drawn with Pixi. Sky follows the real
// clock (day / dusk / night with stars and fireflies), the soil is layered
// strata with roots, plants sway and multiply as the habitat levels up, bugs
// hop around with shadows, and every finished cycle fires the foraged item
// flying into the loot jar in the corner. Everything here is cosmetic — the
// real accounting is settled server-side.

const props = defineProps<{
  bugs: any[]
  isStarving: boolean
  hasSpareBugs: boolean
  upgrades: any[]
  habitatLevel: number
  gemBuffActive?: boolean
}>()

const emit = defineEmits<{
  produced: []
  tick: [emoji: string, qty: number]
  snack: []
}>()

const sound = useColonySound()

const trackLevels = computed<Record<string, number>>(() =>
  Object.fromEntries((props.upgrades ?? []).map((t: any) => [t.id, t.level ?? 0]))
)

const habitatStats = computed(() => {
  const { yieldLevelBonus, speedBonusPct, feedMultiplier } = deriveTrackModifiers(trackLevels.value)
  return [
    { key: 'yield', icon: 'i-lucide-trending-up', label: 'Yield', value: `+${yieldLevelBonus}`, color: 'text-info' },
    { key: 'speed', icon: 'i-lucide-zap', label: 'Speed', value: `+${Math.round(speedBonusPct)}%`, color: 'text-warning' },
    { key: 'nutrition', icon: 'i-lucide-leaf', label: 'Appetite', value: `-${Math.round((1 - feedMultiplier) * 100)}%`, color: 'text-success' }
  ]
})

const canvasWrap = ref<HTMLDivElement | null>(null)
let destroyed = false
let app: any = null
let PIXI: any = null

// Layers, bottom to top.
let skyGfx: any = null
let starsGfx: any = null
let soilGfx: any = null
let plantsGfx: any = null
let glassGfx: any = null
let flashlightGfx: any = null
let trailLayer: any = null
let eventGfx: any = null
let bugLayer: any = null
let particleLayer: any = null
let ambientGfx: any = null
let overlayGfx: any = null

let sceneWidth = 0
let sceneHeight = 0
let lastDay = -1

// ─── Time of day ───────────────────────────────────────────────────────────
// 1 = full day, 0 = full night, smooth ramps around dawn (5-7) and dusk (18-20).
function dayFactor(now: number): number {
  const d = new Date(now)
  const h = d.getHours() + d.getMinutes() / 60
  if (h >= 7 && h < 18) return 1
  if (h >= 20 || h < 5) return 0
  if (h >= 5 && h < 7) return (h - 5) / 2
  return 1 - (h - 18) / 2
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return (r << 16) | (g << 8) | bl
}

const SKY_TOP_NIGHT = 0x0a0f2a
const SKY_TOP_DAY = 0x7cc6ef
const SKY_BOT_NIGHT = 0x1c2350
const SKY_BOT_DAY = 0xd9f1ff
const HORIZON = 0.3 // fraction of height where soil starts

// ─── Flashlight ────────────────────────────────────────────────────────────
const FLASHLIGHT_RADIUS = 110
const FLASHLIGHT_BOOST_MIN = 0.10
const FLASHLIGHT_BOOST_MAX = 0.15
let flashlightAlpha = 0

const POOP_LIFETIME_MS = 10_000
const SOCIAL_COHESION_RANGE = 240
const SOLITARY_PERSONAL_SPACE = 180
const SQUABBLE_RANGE = 135
const FOOD_ATTRACTION_RANGE = 520
const FOOD_LIFETIME_MS = 30_000
const FOOD_EMOJIS = ['🍓', '🥕', '🍎', '🫐', '🌽', '🍄', '🥬']
const FOOD_REACTIONS = ['Yum!', 'Tasty!', 'Nom nom!', 'Snack time!', 'Delicious!', 'Mine!']
const IDLE_CHATTER = ['♪', '~', '…', '!', '?', '♫']

interface LiveBug {
  id: string
  typeId: string
  color: number
  emoji: string
  itemEmoji: string
  tier: number
  yield: number
  social: boolean
  x: number
  y: number
  vx: number
  vy: number
  tickMs: number
  itemsPerTickMin: number
  itemsPerTickMax: number
  baseProgressMs: number
  fetchedAtMs: number
  cyclesSeen: number
  seed: number
  orbitSeed: number
  orbitRadius: number
  boostFrac: number
  pauseUntil: number
  /** Hop phase — bugs bounce as they walk. */
  hop: number
  excitedUntil: number
  trail: { x: number, y: number }[]
}
const liveBugs = new Map<string, LiveBug>()
const bugGfx = new Map<string, { sprite: any, halo: any, shadow: any, trail: any }>()

interface PoopEvent { id: number, x: number, y: number, createdAt: number, expiresAt: number, seed: number }
interface SquabbleEvent { bugA: string, bugB: string, startedAt: number, expiresAt: number }
interface FoodDrop { id: number, x: number, y: number, emoji: string, expiresAt: number, rotation: number }

/** Item emoji that flies from a bug to the loot jar corner after a cycle. */
interface LootParticle {
  text: any
  x: number
  y: number
  sx: number
  sy: number
  bornAt: number
  duration: number
  arc: number
}

/** Falling food from a feed — purely a celebration. */
interface FoodRain {
  text: any
  x: number
  y: number
  vy: number
  vx: number
  rot: number
  vr: number
  bornAt: number
  landedAt: number
}

let ambientEventSeq = 0
let poopEvents: PoopEvent[] = []
let squabble: SquabbleEvent | null = null
const foodDrops = ref<FoodDrop[]>([])
let lootParticles: LootParticle[] = []
let foodRain: FoodRain[] = []
let nextPoopAt = Date.now() + 6_000 + Math.random() * 8_000
let nextSquabbleAt = Date.now() + 9_000 + Math.random() * 12_000
let nextChirpAt = Date.now() + 4_000 + Math.random() * 6_000
let nextChatterAt = Date.now() + 8_000 + Math.random() * 10_000

// Stars + fireflies + motes are seeded once so they don't re-roll each frame.
interface Star { x: number, y: number, r: number, seed: number }
interface Firefly { x: number, y: number, seed: number, r: number }
interface Mote { x: number, y: number, seed: number, r: number }
interface Plant { x: number, y: number, kind: 'fern' | 'grass' | 'mushroom' | 'flower' | 'sprout', scale: number, seed: number }
let stars: Star[] = []
let fireflies: Firefly[] = []
let motes: Mote[] = []
let plants: Plant[] = []
let dropletSeeds: Array<[number, number, number]> = []
let plantsLevel = -1

function bugFontSize(tier: number) {
  return 17 + tier * 3
}

function yieldHaloColor(level: number) {
  const colors: Record<number, number> = {
    0: 0x9ca3af, 1: 0x4ade80, 2: 0xa3e635, 3: 0xfacc15, 4: 0xfbbf24,
    5: 0xfb923c, 6: 0xf87171, 7: 0xf472b6, 8: 0xc084fc, 9: 0x60a5fa, 10: 0x22d3ee
  }
  return colors[Math.min(10, level)] ?? colors[0]!
}

function drawBugHalo(halo: any, live: LiveBug) {
  const size = bugFontSize(live.tier)
  halo.clear()
  halo
    .circle(0, 0, size * 0.95)
    .fill({ color: live.color, alpha: 0.12 })
    .stroke({ color: yieldHaloColor(live.yield), width: 1.5, alpha: 0.8 })
}

// ─── Scenery ───────────────────────────────────────────────────────────────

function seedScenery(width: number, height: number) {
  const rand = mulberry(1337)
  stars = Array.from({ length: 46 }, () => ({
    x: rand() * width,
    y: rand() * height * HORIZON * 0.95,
    r: 0.6 + rand() * 1.3,
    seed: rand() * Math.PI * 2
  }))
  fireflies = Array.from({ length: 14 }, () => ({
    x: rand() * width,
    y: height * (HORIZON - 0.05) + rand() * height * 0.55,
    seed: rand() * Math.PI * 2,
    r: 1.5 + rand() * 1.5
  }))
  motes = Array.from({ length: 22 }, () => ({
    x: rand() * width,
    y: rand() * height,
    seed: rand() * Math.PI * 2,
    r: 0.8 + rand() * 1.4
  }))
  dropletSeeds = Array.from({ length: 9 }, () => [rand() * width, rand() * height, 2 + rand() * 3])
}

function seedPlants(width: number, height: number, level: number) {
  const rand = mulberry(99 + level * 7)
  const soilY = height * HORIZON
  const count = 7 + level * 2
  const kinds: Plant['kind'][] = ['fern', 'grass', 'grass', 'mushroom', 'flower', 'sprout', 'fern']
  plants = Array.from({ length: count }, (_, i) => {
    const alongEdge = i % 3 !== 0
    return {
      x: 24 + rand() * (width - 48),
      y: alongEdge ? soilY + 4 + rand() * 18 : soilY + 30 + rand() * (height - soilY - 60),
      kind: kinds[Math.floor(rand() * kinds.length)]!,
      scale: 0.7 + rand() * 0.7,
      seed: rand() * Math.PI * 2
    }
  })
  plantsLevel = level
}

/** Tiny seeded PRNG for stable decoration layouts. Cosmetic only. */
function mulberry(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function drawSky(width: number, height: number, day: number) {
  if (!skyGfx) return
  skyGfx.clear()
  const top = lerpColor(SKY_TOP_NIGHT, SKY_TOP_DAY, day)
  const bottom = lerpColor(SKY_BOT_NIGHT, SKY_BOT_DAY, day)
  const bands = 14
  const skyH = height * HORIZON + 6
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1)
    skyGfx.rect(0, (skyH * i) / bands, width, skyH / bands + 1).fill({ color: lerpColor(top, bottom, t) })
  }
  // dusk / dawn warmth
  const warm = 1 - Math.abs(day - 0.5) * 2
  if (warm > 0.05) {
    skyGfx.rect(0, skyH * 0.45, width, skyH * 0.55).fill({ color: 0xff9a5c, alpha: 0.28 * warm })
  }
  // sun / moon
  const cx = width * 0.82
  const cy = skyH * 0.42
  if (day > 0.02) {
    skyGfx.circle(cx, cy, 26).fill({ color: 0xffe9a3, alpha: 0.35 * day })
    skyGfx.circle(cx, cy, 16).fill({ color: 0xfff3c4, alpha: 0.95 * day })
  }
  if (day < 0.98) {
    const mx = width * 0.2
    const my = skyH * 0.38
    skyGfx.circle(mx, my, 14).fill({ color: 0xf5f3ff, alpha: 0.9 * (1 - day) })
    skyGfx.circle(mx + 5, my - 3, 12).fill({ color: lerpColor(SKY_TOP_NIGHT, SKY_TOP_DAY, day), alpha: 1 * (1 - day) })
  }
  // distant hills
  skyGfx.ellipse(width * 0.2, skyH + 8, width * 0.4, skyH * 0.35).fill({ color: lerpColor(0x1a2a1c, 0x5f9a58, day), alpha: 0.9 })
  skyGfx.ellipse(width * 0.75, skyH + 10, width * 0.5, skyH * 0.42).fill({ color: lerpColor(0x152218, 0x4f8a4a, day), alpha: 0.95 })
}

function drawSoil(width: number, height: number) {
  if (!soilGfx) return
  soilGfx.clear()
  const soilY = height * HORIZON
  // Grass lip along the horizon.
  soilGfx.rect(0, soilY - 6, width, 14).fill({ color: 0x4f8a4a })
  for (let x = 0; x < width; x += 9) {
    const h = 6 + ((x * 7) % 9)
    soilGfx.moveTo(x, soilY + 2).lineTo(x + 3, soilY - h).stroke({ color: 0x6da35a, width: 2, alpha: 0.85 })
  }
  // Layered strata — each band a little darker, with a wavy top edge.
  const bands = [0x8a5a2b, 0x74482a, 0x5e3a22, 0x4a2d1b, 0x3a2315]
  let y = soilY + 6
  const bandH = (height - soilY) / bands.length
  bands.forEach((color, i) => {
    soilGfx.moveTo(0, y)
    for (let x = 0; x <= width; x += 24) {
      soilGfx.lineTo(x, y + Math.sin(x / 37 + i) * 5)
    }
    soilGfx.lineTo(width, height).lineTo(0, height).closePath().fill({ color })
    y += bandH
  })
  // Pebbles, roots and little air pockets.
  const rand = mulberry(4242)
  for (let i = 0; i < 60; i++) {
    const px = rand() * width
    const py = soilY + 14 + rand() * (height - soilY - 20)
    const pr = 1.5 + rand() * 3.5
    const c = [0xa07a55, 0x6d4d32, 0xb89570, 0x3a2a1c][i % 4]!
    soilGfx.ellipse(px, py, pr * 1.3, pr).fill({ color: c, alpha: 0.5 + rand() * 0.4 })
  }
  for (let i = 0; i < 7; i++) {
    let rx = rand() * width
    let ry = soilY + 4
    soilGfx.moveTo(rx, ry)
    for (let s = 0; s < 6; s++) {
      rx += (rand() - 0.5) * 30
      ry += 12 + rand() * 18
      soilGfx.lineTo(rx, ry)
    }
    soilGfx.stroke({ color: 0xc4a074, width: 1.5, alpha: 0.35 })
  }
  // Burrow with a warm glow inside.
  const bx = width * 0.14
  const by = height * 0.62
  soilGfx.ellipse(bx, by, 36, 26).fill({ color: 0x2b1a13, alpha: 0.6 })
  soilGfx.ellipse(bx, by, 27, 19).fill({ color: 0x110b08, alpha: 0.85 })
  soilGfx.ellipse(bx, by + 4, 12, 7).fill({ color: 0xf5b342, alpha: 0.12 })
  // Log shelter bottom-right.
  const logX = width * 0.66
  const logY = height * 0.78
  const logW = Math.min(180, width * 0.24)
  soilGfx.roundRect(logX, logY, logW, 38, 18).fill({ color: 0x5d3926 }).stroke({ color: 0x8b5a38, width: 2, alpha: 0.7 })
  soilGfx.circle(logX + 16, logY + 19, 13).fill({ color: 0x8b5a38 }).stroke({ color: 0xb17d50, width: 2, alpha: 0.6 })
  soilGfx.circle(logX + 16, logY + 19, 6).stroke({ color: 0xb17d50, width: 1.5, alpha: 0.5 })
  for (let i = 0; i < 4; i++) {
    const lx = logX + 40 + i * Math.max(18, (logW - 52) / 4)
    soilGfx.moveTo(lx, logY + 6).lineTo(lx - 7, logY + 32).stroke({ color: 0x3e261c, width: 2, alpha: 0.4 })
  }
  // Rock cluster centre.
  const rx = width * 0.46
  const ry = height * 0.55
  soilGfx.ellipse(rx, ry, 22, 14).fill({ color: 0x6b7280 }).stroke({ color: 0x9ca3af, width: 1.5, alpha: 0.5 })
  soilGfx.ellipse(rx + 24, ry + 6, 13, 9).fill({ color: 0x4b5563 }).stroke({ color: 0x9ca3af, width: 1.5, alpha: 0.4 })
  soilGfx.ellipse(rx - 8, ry - 6, 9, 5).fill({ color: 0xd1d5db, alpha: 0.25 })
  // Water dish top-right-ish.
  const wx = width * 0.8
  const wy = height * 0.42
  soilGfx.ellipse(wx, wy, 30, 13).fill({ color: 0x7c5a3c }).stroke({ color: 0x9c7450, width: 2 })
  soilGfx.ellipse(wx, wy - 2, 24, 9).fill({ color: 0x38bdf8, alpha: 0.6 })
  soilGfx.ellipse(wx - 6, wy - 4, 8, 3).fill({ color: 0xffffff, alpha: 0.35 })
}

function drawPlants(now: number, day: number) {
  if (!plantsGfx) return
  plantsGfx.clear()
  const wind = Math.sin(now / 900) * 0.6 + Math.sin(now / 2300) * 0.4
  for (const p of plants) {
    const sway = Math.sin(now / 700 + p.seed) * 3 * p.scale + wind * 2
    const s = p.scale
    if (p.kind === 'grass') {
      for (let b = -2; b <= 2; b++) {
        plantsGfx
          .moveTo(p.x + b * 3, p.y)
          .quadraticCurveTo(p.x + b * 4 + sway * 0.5, p.y - 12 * s, p.x + b * 6 + sway, p.y - (20 + Math.abs(b) * -3) * s)
          .stroke({ color: b % 2 ? 0x6da35a : 0x8bc34a, width: 2, alpha: 0.9 })
      }
    } else if (p.kind === 'fern') {
      for (let f = -1; f <= 1; f++) {
        const tipX = p.x + f * 16 * s + sway
        const tipY = p.y - 30 * s - Math.abs(f) * -6
        plantsGfx.moveTo(p.x, p.y).quadraticCurveTo(p.x + f * 6 * s, p.y - 16 * s, tipX, tipY).stroke({ color: 0x4f8a4a, width: 2.2, alpha: 0.95 })
        for (let l = 1; l <= 4; l++) {
          const t = l / 5
          const lx = p.x + (tipX - p.x) * t
          const ly = p.y + (tipY - p.y) * t
          const len = (7 - l) * 1.6 * s
          plantsGfx.moveTo(lx, ly).lineTo(lx - len, ly - len * 0.5).stroke({ color: 0x6da35a, width: 1.5, alpha: 0.85 })
          plantsGfx.moveTo(lx, ly).lineTo(lx + len, ly - len * 0.5).stroke({ color: 0x6da35a, width: 1.5, alpha: 0.85 })
        }
      }
    } else if (p.kind === 'mushroom') {
      const glow = 1 - day
      plantsGfx.roundRect(p.x - 3 * s, p.y - 14 * s, 6 * s, 14 * s, 3).fill({ color: 0xe8d8b8 })
      plantsGfx.ellipse(p.x, p.y - 14 * s, 13 * s, 7 * s).fill({ color: 0xc2410c })
      plantsGfx.circle(p.x - 5 * s, p.y - 15 * s, 1.6 * s).fill({ color: 0xffedd5 })
      plantsGfx.circle(p.x + 4 * s, p.y - 13 * s, 1.3 * s).fill({ color: 0xffedd5 })
      if (glow > 0.05) {
        const pulse = 0.5 + Math.sin(now / 600 + p.seed) * 0.5
        plantsGfx.ellipse(p.x, p.y - 12 * s, 18 * s, 10 * s).fill({ color: 0x7dd3fc, alpha: 0.18 * glow * (0.6 + pulse * 0.4) })
        plantsGfx.ellipse(p.x, p.y - 14 * s, 13 * s, 7 * s).fill({ color: 0x38bdf8, alpha: 0.35 * glow })
      }
    } else if (p.kind === 'flower') {
      plantsGfx.moveTo(p.x, p.y).quadraticCurveTo(p.x + sway * 0.5, p.y - 12 * s, p.x + sway, p.y - 24 * s).stroke({ color: 0x4f8a4a, width: 2 })
      const fx = p.x + sway
      const fy = p.y - 24 * s
      const petal = [0xf472b6, 0xfbbf24, 0xa78bfa, 0xfb7185][Math.floor(p.seed) % 4]!
      for (let a = 0; a < 6; a++) {
        const ang = (a / 6) * Math.PI * 2 + now / 4000
        plantsGfx.ellipse(fx + Math.cos(ang) * 5 * s, fy + Math.sin(ang) * 5 * s, 4 * s, 2.5 * s).fill({ color: petal })
      }
      plantsGfx.circle(fx, fy, 2.6 * s).fill({ color: 0xfde68a })
    } else {
      plantsGfx.moveTo(p.x, p.y).lineTo(p.x + sway * 0.3, p.y - 10 * s).stroke({ color: 0x6da35a, width: 2 })
      plantsGfx.ellipse(p.x - 4 * s + sway * 0.3, p.y - 9 * s, 5 * s, 2.5 * s).fill({ color: 0x8bc34a })
      plantsGfx.ellipse(p.x + 4 * s + sway * 0.3, p.y - 11 * s, 5 * s, 2.5 * s).fill({ color: 0x8bc34a })
    }
  }
}

function drawGlass(width: number, height: number) {
  if (!glassGfx) return
  glassGfx.clear()
  // Inner glass edge + two long highlight streaks + droplets.
  glassGfx.roundRect(5, 5, width - 10, height - 10, 18).stroke({ color: 0xffffff, width: 1.5, alpha: 0.12 })
  glassGfx.roundRect(1, 1, width - 2, height - 2, 20).stroke({ color: 0x000000, width: 2, alpha: 0.35 })
  glassGfx.moveTo(22, 26).lineTo(22, height * 0.55).stroke({ color: 0xffffff, width: 3, alpha: 0.08 })
  glassGfx.moveTo(30, 26).lineTo(30, height * 0.32).stroke({ color: 0xffffff, width: 1.5, alpha: 0.1 })
  glassGfx.moveTo(width - 26, height * 0.5).lineTo(width - 26, height - 30).stroke({ color: 0xffffff, width: 2, alpha: 0.06 })
  for (const [dx, dy, dr] of dropletSeeds) {
    glassGfx.ellipse(dx, dy, dr, dr * 1.3).fill({ color: 0xffffff, alpha: 0.07 }).stroke({ color: 0xffffff, width: 0.8, alpha: 0.14 })
    glassGfx.circle(dx - dr * 0.3, dy - dr * 0.5, dr * 0.3).fill({ color: 0xffffff, alpha: 0.28 })
  }
  // Vignette corners.
  glassGfx.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0 })
}

function drawAmbient(now: number, day: number, width: number, height: number) {
  if (!starsGfx || !ambientGfx) return
  starsGfx.clear()
  ambientGfx.clear()
  const night = 1 - day
  if (night > 0.02) {
    for (const s of stars) {
      const tw = 0.5 + Math.sin(now / 700 + s.seed) * 0.5
      starsGfx.circle(s.x, s.y, s.r).fill({ color: 0xffffff, alpha: (0.35 + tw * 0.6) * night })
    }
    for (const f of fireflies) {
      const t = now / 1000
      const fx = f.x + Math.sin(t * 0.5 + f.seed) * 26 + Math.sin(t * 1.3 + f.seed * 2) * 8
      const fy = f.y + Math.cos(t * 0.7 + f.seed) * 16
      const blink = Math.max(0, Math.sin(t * 2.2 + f.seed * 3))
      if (blink < 0.05) continue
      ambientGfx.circle(fx, fy, f.r * 3.5).fill({ color: 0xf5b342, alpha: 0.12 * blink * night })
      ambientGfx.circle(fx, fy, f.r).fill({ color: 0xfff1b8, alpha: 0.95 * blink * night })
    }
  }
  if (day > 0.05) {
    for (const m of motes) {
      const t = now / 1000
      const mx = (m.x + Math.sin(t * 0.3 + m.seed) * 30 + t * 4) % width
      const my = m.y + Math.sin(t * 0.5 + m.seed) * 12
      const a = 0.25 + Math.sin(t + m.seed) * 0.15
      ambientGfx.circle(mx, my, m.r).fill({ color: 0xfff6d5, alpha: a * day })
    }
    // Slow-moving light shafts through the glass.
    const shaftX = width * 0.55 + Math.sin(now / 9000) * 40
    ambientGfx.poly([shaftX, 0, shaftX + 90, 0, shaftX + 200, height, shaftX + 60, height]).fill({ color: 0xfff3c4, alpha: 0.05 * day })
  }
  // Gem-fed buff shimmer.
  if (props.gemBuffActive) {
    const pulse = 0.5 + Math.sin(now / 500) * 0.5
    ambientGfx.roundRect(6, 6, width - 12, height - 12, 18).stroke({ color: 0x38bdf8, width: 3, alpha: 0.25 + pulse * 0.25 })
  }
  // Starving vignette.
  if (overlayGfx) {
    overlayGfx.clear()
    if (props.isStarving) {
      overlayGfx.rect(0, 0, width, height).fill({ color: 0x1a0505, alpha: 0.45 })
      const pulse = 0.5 + Math.sin(now / 700) * 0.5
      overlayGfx.roundRect(4, 4, width - 8, height - 8, 18).stroke({ color: 0xef4444, width: 4, alpha: 0.35 + pulse * 0.35 })
    }
  }
}

function drawScenery(width: number, height: number, now: number) {
  const day = dayFactor(now)
  const resized = width !== sceneWidth || height !== sceneHeight
  if (resized) {
    sceneWidth = width
    sceneHeight = height
    seedScenery(width, height)
    drawSoil(width, height)
    drawGlass(width, height)
    plantsLevel = -1
  }
  if (plantsLevel !== props.habitatLevel) seedPlants(width, height, props.habitatLevel)
  if (resized || Math.abs(day - lastDay) > 0.01) {
    lastDay = day
    drawSky(width, height, day)
  }
  drawPlants(now, day)
  drawAmbient(now, day, width, height)
}

// ─── Ambient events ────────────────────────────────────────────────────────

function scheduleAmbientEvents(now: number) {
  const bugs = [...liveBugs.values()]
  if (props.isStarving || !bugs.length) return

  if (now >= nextPoopAt) {
    const bug = bugs[Math.floor(Math.random() * bugs.length)]!
    poopEvents.push({
      id: ambientEventSeq++,
      x: bug.x - bug.vx * 0.35,
      y: bug.y - bug.vy * 0.35,
      createdAt: now,
      expiresAt: now + POOP_LIFETIME_MS,
      seed: Math.random() * Math.PI * 2
    })
    spawnBugFloat('plop!', bug.x, bug.y - 5)
    nextPoopAt = now + 11_000 + Math.random() * 14_000
  }

  if (now >= nextChirpAt) {
    sound.play('chirp')
    nextChirpAt = now + 6_000 + Math.random() * 12_000
  }

  if (now >= nextChatterAt) {
    const bug = bugs[Math.floor(Math.random() * bugs.length)]!
    spawnBugFloat(IDLE_CHATTER[Math.floor(Math.random() * IDLE_CHATTER.length)]!, bug.x, bug.y - bugFontSize(bug.tier))
    nextChatterAt = now + 7_000 + Math.random() * 12_000
  }

  if (now >= nextSquabbleAt && bugs.length >= 2 && !squabble) {
    const nearbyRivals: Array<[LiveBug, LiveBug]> = []
    for (let i = 0; i < bugs.length; i++) {
      const bugA = bugs[i]!
      for (let j = i + 1; j < bugs.length; j++) {
        const bugB = bugs[j]!
        if (bugA.typeId === bugB.typeId) continue
        if (Math.hypot(bugA.x - bugB.x, bugA.y - bugB.y) > SQUABBLE_RANGE) continue
        nearbyRivals.push([bugA, bugB])
      }
    }
    const rivals = nearbyRivals[Math.floor(Math.random() * nearbyRivals.length)]
    if (rivals) {
      const [bugA, bugB] = rivals
      squabble = { bugA: bugA.id, bugB: bugB.id, startedAt: now, expiresAt: now + 2_200 }
      spawnBugFloat('💢 hey!', (bugA.x + bugB.x) / 2, (bugA.y + bugB.y) / 2)
      nextSquabbleAt = now + 16_000 + Math.random() * 20_000
    } else {
      nextSquabbleAt = now + 4_000 + Math.random() * 4_000
    }
  }
}

function drawAmbientEvents(now: number) {
  if (!eventGfx) return
  eventGfx.clear()
  poopEvents = poopEvents.filter(event => event.expiresAt > now)

  for (const event of poopEvents) {
    const remaining = event.expiresAt - now
    const alpha = Math.min(0.72, remaining / 1800)
    const wobble = Math.sin(now / 550 + event.seed) * 1.2
    eventGfx.circle(event.x - 5, event.y + 2, 5).fill({ color: 0x56311f, alpha })
    eventGfx.circle(event.x + 1, event.y - 2, 6).fill({ color: 0x684029, alpha })
    eventGfx.circle(event.x + 6, event.y + 3, 4).fill({ color: 0x472719, alpha })
    eventGfx.circle(event.x - 1, event.y - 4, 1.6).fill({ color: 0xc1976c, alpha: alpha * 0.5 })
    if (now - event.createdAt < 4_500) {
      eventGfx
        .moveTo(event.x - 4 + wobble, event.y - 9)
        .bezierCurveTo(event.x - 10, event.y - 17, event.x + 3, event.y - 19, event.x - 3 + wobble, event.y - 27)
        .stroke({ color: 0xd6c3aa, width: 1.5, alpha: alpha * 0.25 })
    }
  }

  if (squabble && squabble.expiresAt <= now) squabble = null
  if (!squabble) return
  const bugA = liveBugs.get(squabble.bugA)
  const bugB = liveBugs.get(squabble.bugB)
  if (!bugA || !bugB) {
    squabble = null
    return
  }
  const pulse = 0.45 + Math.sin((now - squabble.startedAt) / 65) * 0.18
  const midX = (bugA.x + bugB.x) / 2
  const midY = (bugA.y + bugB.y) / 2
  eventGfx.circle(bugA.x, bugA.y, bugFontSize(bugA.tier) + 7).stroke({ color: 0xef4444, width: 3, alpha: pulse })
  eventGfx.circle(bugB.x, bugB.y, bugFontSize(bugB.tier) + 7).stroke({ color: 0xef4444, width: 3, alpha: pulse })
  eventGfx
    .poly([midX - 12, midY - 8, midX - 3, midY - 2, midX - 8, midY + 8, midX + 10, midY - 4, midX + 3, midY - 8])
    .stroke({ color: 0xf87171, width: 2.5, alpha: pulse + 0.2 })
}

// ─── Loot particles + food rain ────────────────────────────────────────────

function lootTarget() {
  return { x: 58, y: (app?.screen.height ?? 400) - 58 }
}

function spawnLootParticle(emoji: string, x: number, y: number) {
  if (!PIXI || !particleLayer) return
  const text = new PIXI.Text({ text: emoji, style: { fontSize: 18 } })
  text.anchor.set(0.5)
  text.position.set(x, y)
  particleLayer.addChild(text)
  lootParticles.push({ text, x, y, sx: x, sy: y, bornAt: Date.now(), duration: 900 + Math.random() * 300, arc: 60 + Math.random() * 80 })
  if (lootParticles.length > 40) {
    const old = lootParticles.shift()!
    particleLayer.removeChild(old.text)
    old.text.destroy()
  }
}

function updateLootParticles(now: number) {
  if (!particleLayer) return
  const target = lootTarget()
  lootParticles = lootParticles.filter((p) => {
    const t = Math.min(1, (now - p.bornAt) / p.duration)
    const ease = t * t * (3 - 2 * t)
    const x = p.sx + (target.x - p.sx) * ease
    const y = p.sy + (target.y - p.sy) * ease - Math.sin(t * Math.PI) * p.arc
    p.text.position.set(x, y)
    p.text.scale.set(1.2 - t * 0.7)
    p.text.alpha = t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1
    p.text.rotation = t * 4
    if (t >= 1) {
      particleLayer.removeChild(p.text)
      p.text.destroy()
      return false
    }
    return true
  })
}

/** Rain a shower of food down the terrarium — called by the page after a feed. */
function feedCelebration(kind: 'coins' | 'gems' = 'coins') {
  if (!PIXI || !particleLayer || !app) return
  const width = app.screen.width
  const n = kind === 'gems' ? 26 : 18
  const emojis = kind === 'gems' ? ['💎', '✨', '💠', ...FOOD_EMOJIS] : FOOD_EMOJIS
  for (let i = 0; i < n; i++) {
    const text = new PIXI.Text({ text: emojis[Math.floor(Math.random() * emojis.length)], style: { fontSize: 14 + Math.random() * 10 } })
    text.anchor.set(0.5)
    const x = 20 + Math.random() * (width - 40)
    text.position.set(x, -20)
    particleLayer.addChild(text)
    foodRain.push({ text, x, y: -20 - Math.random() * 120, vy: 60 + Math.random() * 90, vx: (Math.random() - 0.5) * 20, rot: 0, vr: (Math.random() - 0.5) * 4, bornAt: Date.now(), landedAt: 0 })
  }
  for (const live of liveBugs.values()) live.excitedUntil = Date.now() + 4000
}

function updateFoodRain(deltaMS: number, now: number) {
  if (!particleLayer || !app) return
  const floor = app.screen.height - 30
  foodRain = foodRain.filter((f) => {
    if (!f.landedAt) {
      f.y += (f.vy * deltaMS) / 1000
      f.x += (f.vx * deltaMS) / 1000
      f.rot += (f.vr * deltaMS) / 1000
      f.vy += 40 * (deltaMS / 1000)
      if (f.y >= floor - Math.random() * 120) f.landedAt = now
    }
    f.text.position.set(f.x, f.y)
    f.text.rotation = f.rot
    if (f.landedAt) {
      const age = now - f.landedAt
      f.text.alpha = Math.max(0, 1 - age / 2500)
      f.text.scale.set(1 - age / 5000)
      if (age > 2500) {
        particleLayer.removeChild(f.text)
        f.text.destroy()
        return false
      }
    }
    return true
  })
}

// ─── Bug sync ──────────────────────────────────────────────────────────────

function syncLiveBugs() {
  const width = app?.screen.width ?? 600
  const height = app?.screen.height ?? 420
  const now = Date.now()
  const soilY = height * HORIZON + 10

  for (const id of [...liveBugs.keys()]) {
    if (!props.bugs.some((b: any) => b.id === id)) {
      liveBugs.delete(id)
      const entry = bugGfx.get(id)
      if (entry && bugLayer && trailLayer) {
        bugLayer.removeChild(entry.sprite)
        bugLayer.removeChild(entry.halo)
        bugLayer.removeChild(entry.shadow)
        trailLayer.removeChild(entry.trail)
      }
      bugGfx.delete(id)
    }
  }

  for (const bug of props.bugs as any[]) {
    const existing = liveBugs.get(bug.id)
    if (existing) {
      existing.color = bug.color
      existing.tier = bug.tier
      existing.yield = bug.yield
      existing.social = bug.social
      existing.tickMs = bug.tickMs
      existing.itemsPerTickMin = bug.itemsPerTickMin
      existing.itemsPerTickMax = bug.itemsPerTickMax
      existing.baseProgressMs = bug.tickProgressMs
      existing.fetchedAtMs = now
      const entry = bugGfx.get(bug.id)
      if (entry) drawBugHalo(entry.halo, existing)
      // Server resets tickProgressMs after settling a tick — the reference
      // frame moved, so the client-side cycle counter must restart with it.
      existing.cyclesSeen = 0
      continue
    }
    const speedBase = 14 + bug.tier * 3
    const angle = Math.random() * Math.PI * 2
    liveBugs.set(bug.id, {
      id: bug.id,
      typeId: bug.typeId,
      color: bug.color,
      emoji: bug.emoji,
      itemEmoji: bug.itemEmoji,
      tier: bug.tier,
      yield: bug.yield,
      social: bug.social,
      x: 30 + Math.random() * (width - 60),
      y: soilY + Math.random() * (height - soilY - 40),
      vx: Math.cos(angle) * speedBase * 0.5,
      vy: Math.sin(angle) * speedBase * 0.5,
      tickMs: bug.tickMs,
      itemsPerTickMin: bug.itemsPerTickMin,
      itemsPerTickMax: bug.itemsPerTickMax,
      baseProgressMs: bug.tickProgressMs,
      fetchedAtMs: now,
      cyclesSeen: 0,
      seed: Math.random() * 1000,
      orbitSeed: Math.random() * Math.PI * 2,
      orbitRadius: 18 + Math.random() * 28,
      boostFrac: Math.random(),
      pauseUntil: 0,
      hop: Math.random() * Math.PI * 2,
      excitedUntil: 0,
      trail: []
    })
  }

  if (!PIXI || !bugLayer || !trailLayer) return
  for (const [id, live] of liveBugs) {
    if (bugGfx.has(id)) continue
    const size = bugFontSize(live.tier)
    const halo = new PIXI.Graphics()
    drawBugHalo(halo, live)
    const shadow = new PIXI.Graphics()
    shadow.ellipse(0, 0, size * 0.55, size * 0.22).fill({ color: 0x000000, alpha: 0.35 })
    const sprite = new PIXI.Text({ text: live.emoji, style: { fontSize: size } })
    sprite.anchor.set(0.5)
    halo.position.set(live.x, live.y)
    shadow.position.set(live.x, live.y + size * 0.45)
    sprite.position.set(live.x, live.y)
    const trail = new PIXI.Graphics()
    trailLayer.addChild(trail)
    bugLayer.addChild(shadow)
    bugLayer.addChild(halo)
    bugLayer.addChild(sprite)
    bugGfx.set(id, { sprite, halo, shadow, trail })
    // New arrival pops in.
    sprite.scale.set(0.2)
  }
}

// ─── Floating popups ───────────────────────────────────────────────────────

interface FloatText { id: number, text: string, x: number, y: number, big?: boolean }
const bugFloats = ref<FloatText[]>([])
let floatSeq = 0

function spawnBugFloat(text: string, x: number, y: number, big = false) {
  const id = floatSeq++
  bugFloats.value.push({ id, text, x, y, big })
  setTimeout(() => {
    bugFloats.value = bugFloats.value.filter(f => f.id !== id)
  }, 1300)
}

// ─── Pointer ───────────────────────────────────────────────────────────────

let mouseActive = false
let mouseX = 0
let mouseY = 0

function onPointerMove(e: PointerEvent) {
  const rect = canvasWrap.value?.getBoundingClientRect()
  if (!rect) return
  mouseX = e.clientX - rect.left
  mouseY = e.clientY - rect.top
  mouseActive = true
}
function onPointerLeave() {
  mouseActive = false
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || !props.bugs.length) return
  const target = e.target as HTMLElement | null
  if (target && target.closest('[data-no-snack]')) return
  const rect = canvasWrap.value?.getBoundingClientRect()
  if (!rect) return
  const pad = 24
  const x = Math.max(pad, Math.min(rect.width - pad, e.clientX - rect.left))
  const y = Math.max(rect.height * HORIZON + 8, Math.min(rect.height - pad, e.clientY - rect.top))
  const emoji = FOOD_EMOJIS[Math.floor(Math.random() * FOOD_EMOJIS.length)]!
  foodDrops.value.push({
    id: ambientEventSeq++,
    x,
    y,
    emoji,
    expiresAt: Date.now() + FOOD_LIFETIME_MS,
    rotation: (Math.random() - 0.5) * 20
  })
  if (foodDrops.value.length > 12) foodDrops.value.shift()
  sound.play('snack')
  emit('snack')
}

function drawFlashlight() {
  if (!flashlightGfx) return
  const targetAlpha = mouseActive ? 1 : 0
  flashlightAlpha += (targetAlpha - flashlightAlpha) * 0.12
  flashlightGfx.clear()
  if (flashlightAlpha < 0.01) return
  const layers = 5
  for (let i = layers; i >= 1; i--) {
    const r = (FLASHLIGHT_RADIUS * i) / layers
    const a = 0.05 * flashlightAlpha * (1 - i / (layers + 1))
    flashlightGfx.circle(mouseX, mouseY, r).fill({ color: 0xfff3d6, alpha: a })
  }
}

// ─── Movement ──────────────────────────────────────────────────────────────

function applyTemperament(live: LiveBug, bugs: LiveBug[], frameScale: number) {
  const sameSpecies = bugs.filter(other => other.id !== live.id && other.typeId === live.typeId)

  if (sameSpecies.length) {
    if (live.social) {
      const center = sameSpecies.reduce((sum, other) => ({ x: sum.x + other.x, y: sum.y + other.y }), { x: 0, y: 0 })
      center.x /= sameSpecies.length
      center.y /= sameSpecies.length
      const dx = center.x - live.x
      const dy = center.y - live.y
      const distance = Math.hypot(dx, dy) || 1
      if (distance > 52 && distance < SOCIAL_COHESION_RANGE) {
        const strength = Math.min(0.22, (distance - 52) / SOCIAL_COHESION_RANGE * 0.25)
        live.vx += (dx / distance) * strength * frameScale
        live.vy += (dy / distance) * strength * frameScale
      }
    } else {
      for (const other of sameSpecies) {
        const dx = live.x - other.x
        const dy = live.y - other.y
        const distance = Math.hypot(dx, dy) || 1
        if (distance >= SOLITARY_PERSONAL_SPACE) continue
        const strength = (1 - distance / SOLITARY_PERSONAL_SPACE) * 0.48
        live.vx += (dx / distance) * strength * frameScale
        live.vy += (dy / distance) * strength * frameScale
      }
    }
  }

  for (const other of bugs) {
    if (other.id === live.id) continue
    const dx = live.x - other.x
    const dy = live.y - other.y
    const distance = Math.hypot(dx, dy) || 1
    const minimumDistance = (bugFontSize(live.tier) + bugFontSize(other.tier)) * 0.62
    if (distance >= minimumDistance) continue
    const strength = (1 - distance / minimumDistance) * 0.7
    live.vx += (dx / distance) * strength * frameScale
    live.vy += (dy / distance) * strength * frameScale
  }
}

function tickFrame(deltaMS: number) {
  if (!PIXI || !app) return
  const width = app.screen.width
  const height = app.screen.height
  const pad = 16
  const soilTop = height * HORIZON + 6
  const now = Date.now()
  const frameScale = Math.min(2, deltaMS / (1000 / 60))
  const bugs = [...liveBugs.values()]

  drawScenery(width, height, now)
  drawFlashlight()
  scheduleAmbientEvents(now)
  drawAmbientEvents(now)
  updateLootParticles(now)
  updateFoodRain(deltaMS, now)
  if (foodDrops.value.some(food => food.expiresAt <= now)) {
    foodDrops.value = foodDrops.value.filter(food => food.expiresAt > now)
  }

  for (const live of bugs) {
    let inFlashlight = false
    let seekingFood = false
    const excited = now < live.excitedUntil
    if (!props.isStarving) {
      const speedBase = (14 + live.tier * 3) * (excited ? 1.6 : 1)
      let paused = now < live.pauseUntil
      let foodTarget: FoodDrop | null = null

      if (mouseActive) {
        const distToMouse = Math.hypot(mouseX - live.x, mouseY - live.y)
        inFlashlight = distToMouse < FLASHLIGHT_RADIUS
      }

      if (!inFlashlight) {
        let closestDistance = FOOD_ATTRACTION_RANGE
        for (const food of foodDrops.value) {
          const distance = Math.hypot(food.x - live.x, food.y - live.y)
          if (distance >= closestDistance) continue
          closestDistance = distance
          foodTarget = food
        }
        if (foodTarget) {
          seekingFood = true
          paused = false
          live.pauseUntil = 0
        }
      }

      if (inFlashlight) {
        const targetX = mouseX + Math.cos(now / 450 + live.orbitSeed) * live.orbitRadius
        const targetY = mouseY + Math.sin(now / 450 + live.orbitSeed) * live.orbitRadius
        const dx = targetX - live.x
        const dy = targetY - live.y
        const dist = Math.hypot(dx, dy) || 1
        live.vx += (dx / dist) * 0.55
        live.vy += (dy / dist) * 0.55
      } else if (foodTarget) {
        const dx = foodTarget.x - live.x
        const dy = foodTarget.y - live.y
        const distance = Math.hypot(dx, dy) || 1
        live.vx += (dx / distance) * 0.72 * frameScale
        live.vy += (dy / distance) * 0.72 * frameScale
      } else if (!paused) {
        applyTemperament(live, bugs, frameScale)
        if (Math.random() < (excited ? 0.03 : 0.01)) {
          live.vx += (Math.random() - 0.5) * speedBase
          live.vy += (Math.random() - 0.5) * speedBase
        }
        if (!excited && Math.random() < 0.0025) {
          live.pauseUntil = now + 350 + Math.random() * 550
        }
      }

      if (!paused) {
        live.x += (live.vx * deltaMS) / 1000
        live.y += (live.vy * deltaMS) / 1000
      } else {
        live.vx *= 0.85
        live.vy *= 0.85
      }

      if (live.x < pad || live.x > width - pad) {
        live.vx *= -1
        live.x = Math.max(pad, Math.min(width - pad, live.x))
      }
      if (live.y < soilTop || live.y > height - pad) {
        live.vy *= -1
        live.y = Math.max(soilTop, Math.min(height - pad, live.y))
      }

      if (!paused) {
        live.vx += (Math.random() - 0.5) * 2.4
        live.vy += (Math.random() - 0.5) * 2.4
      }
      const boostPct = seekingFood
        ? 0.65
        : inFlashlight ? FLASHLIGHT_BOOST_MIN + live.boostFrac * (FLASHLIGHT_BOOST_MAX - FLASHLIGHT_BOOST_MIN) : 0
      const maxSpeed = speedBase * (1 + boostPct)
      const speed = Math.hypot(live.vx, live.vy)
      if (speed > maxSpeed) {
        live.vx = (live.vx / speed) * maxSpeed
        live.vy = (live.vy / speed) * maxSpeed
      }

      live.trail.push({ x: live.x, y: live.y })
      if (live.trail.length > 10) live.trail.shift()

      if (foodTarget && Math.hypot(foodTarget.x - live.x, foodTarget.y - live.y) < bugFontSize(live.tier) * 0.75 + 9) {
        foodDrops.value = foodDrops.value.filter(food => food.id !== foodTarget.id)
        const reaction = FOOD_REACTIONS[Math.floor(Math.random() * FOOD_REACTIONS.length)]!
        spawnBugFloat(`${reaction} ${foodTarget.emoji}`, live.x, live.y - bugFontSize(live.tier))
        live.excitedUntil = now + 1500
        sound.play('chirp')
      }

      // Client-side prediction of production ticks for the popup + particle.
      const elapsedSinceFetch = now - live.fetchedAtMs
      const totalProgress = live.baseProgressMs + elapsedSinceFetch
      const cycles = live.tickMs > 0 ? Math.floor(totalProgress / live.tickMs) : 0
      if (cycles > live.cyclesSeen) {
        live.cyclesSeen = cycles
        const qty = Math.round(live.itemsPerTickMin + Math.random() * (live.itemsPerTickMax - live.itemsPerTickMin))
        spawnBugFloat(`+${formatNumber(qty, false)} ${live.itemEmoji}`, live.x, live.y - bugFontSize(live.tier), true)
        const n = Math.min(6, 1 + Math.round(Math.log2(Math.max(1, qty))))
        for (let i = 0; i < n; i++) {
          setTimeout(() => spawnLootParticle(live.itemEmoji, live.x + (Math.random() - 0.5) * 14, live.y - 6), i * 70)
        }
        live.excitedUntil = now + 900
        emit('tick', live.itemEmoji, qty)
        emit('produced')
      }

      if (squabble && (squabble.bugA === live.id || squabble.bugB === live.id)) {
        const otherId = squabble.bugA === live.id ? squabble.bugB : squabble.bugA
        const other = liveBugs.get(otherId)
        if (other) {
          const dx = live.x - other.x
          const dy = live.y - other.y
          const distance = Math.hypot(dx, dy) || 1
          const jostle = Math.sin((now - squabble.startedAt) / 85) * 0.9 + 0.55
          live.vx += (dx / distance) * jostle * frameScale
          live.vy += (dy / distance) * jostle * frameScale
        }
      }
    }

    const entry = bugGfx.get(live.id)
    if (!entry) continue
    const size = bugFontSize(live.tier)
    const speedNow = Math.hypot(live.vx, live.vy)
    const isSquabbling = !!squabble && (squabble.bugA === live.id || squabble.bugB === live.id)
    const shake = isSquabbling ? Math.sin(now / 32 + live.seed) * 2.5 : 0
    // Hop: faster bugs bounce more; resting bugs just breathe.
    live.hop += (deltaMS / 1000) * (4 + speedNow * 0.35)
    const hopH = props.isStarving ? 0 : Math.abs(Math.sin(live.hop)) * Math.min(6, speedNow * 0.25 + (excited ? 3 : 0))
    entry.sprite.position.set(live.x + shake, live.y - hopH)
    entry.halo.position.set(live.x, live.y)
    entry.shadow.position.set(live.x, live.y + size * 0.45)
    entry.shadow.scale.set(1 - hopH / 20)
    const liveliness = inFlashlight || seekingFood || excited ? 1.5 : 1
    const pulse = 1 + Math.sin(now / 260 + live.seed) * 0.07 * liveliness
    const targetScale = props.isStarving ? 0.85 : pulse
    const cur = Math.abs(entry.sprite.scale.y)
    const next = cur + (targetScale - cur) * 0.15
    entry.sprite.scale.x = (live.vx < 0 ? -1 : 1) * next
    entry.sprite.scale.y = next
    entry.sprite.rotation = props.isStarving
      ? Math.sin(now / 900 + live.seed) * 0.15
      : Math.sin(now / 200 + live.seed * 3) * 0.06 * Math.min(1, speedNow / 20) + (live.vx < 0 ? -1 : 1) * Math.min(0.2, speedNow / 200)
    const targetAlpha = props.isStarving ? 0.45 : 1
    entry.sprite.alpha += (targetAlpha - entry.sprite.alpha) * 0.08
    const targetHaloAlpha = targetAlpha * (inFlashlight || excited ? 0.75 : 0.4)
    entry.halo.alpha += (targetHaloAlpha - entry.halo.alpha) * 0.1
    entry.halo.tint = isSquabbling ? 0xff3333 : excited ? 0xffe08a : 0xffffff
    entry.shadow.alpha = props.isStarving ? 0.2 : 0.6

    entry.trail.clear()
    const len = live.trail.length
    for (let i = 0; i < len - 1; i++) {
      const p = live.trail[i]
      if (!p) continue
      const t = i / len
      entry.trail.circle(p.x, p.y, Math.max(1, size * 0.16 * t)).fill({ color: live.color, alpha: targetAlpha * 0.2 * t })
    }
  }

  // Starving bugs sigh a "zzz" every so often.
  if (props.isStarving && bugs.length && Math.random() < 0.004) {
    const bug = bugs[Math.floor(Math.random() * bugs.length)]!
    spawnBugFloat('💤', bug.x, bug.y - bugFontSize(bug.tier))
  }
}

onMounted(async () => {
  const pixi = await import('pixi.js')
  if (destroyed) return
  PIXI = pixi

  app = new PIXI.Application()
  await app.init({
    resizeTo: canvasWrap.value ?? undefined,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1)
  })
  if (destroyed) {
    app.destroy(true)
    return
  }
  canvasWrap.value?.appendChild(app.canvas)

  skyGfx = new PIXI.Graphics()
  starsGfx = new PIXI.Graphics()
  soilGfx = new PIXI.Graphics()
  plantsGfx = new PIXI.Graphics()
  flashlightGfx = new PIXI.Graphics()
  trailLayer = new PIXI.Container()
  eventGfx = new PIXI.Graphics()
  bugLayer = new PIXI.Container()
  particleLayer = new PIXI.Container()
  ambientGfx = new PIXI.Graphics()
  overlayGfx = new PIXI.Graphics()
  glassGfx = new PIXI.Graphics()
  app.stage.addChild(skyGfx, starsGfx, soilGfx, flashlightGfx, trailLayer, eventGfx, plantsGfx, bugLayer, particleLayer, ambientGfx, overlayGfx, glassGfx)

  drawScenery(app.screen.width, app.screen.height, Date.now())
  syncLiveBugs()
  app.ticker.add(() => tickFrame(app.ticker.deltaMS))
})

watch(() => props.bugs.map((b: any) => `${b.id}:${b.tickProgressMs}`).join(','), syncLiveBugs)

onUnmounted(() => {
  destroyed = true
  bugGfx.clear()
  liveBugs.clear()
  poopEvents = []
  foodDrops.value = []
  lootParticles = []
  foodRain = []
  squabble = null
  skyGfx = starsGfx = soilGfx = plantsGfx = glassGfx = flashlightGfx = eventGfx = ambientGfx = overlayGfx = null
  trailLayer = bugLayer = particleLayer = null
  if (app) {
    app.destroy(true, { children: true })
    app = null
  }
})

defineExpose({ feedCelebration })

const isNight = computed(() => dayFactor(Date.now()) < 0.5)
</script>

<template>
  <div
    ref="canvasWrap"
    class="terrarium relative w-full rounded-3xl overflow-hidden"
    :class="[bugs.length ? 'cursor-crosshair' : '', isStarving ? 'terrarium-starving' : '']"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @pointerdown="onPointerDown"
  >
    <!-- Lid -->
    <div class="terrarium-lid pointer-events-none absolute inset-x-0 top-0 z-20 h-3" />

    <!-- Habitat readout -->
    <div class="pointer-events-none absolute top-4 left-3 z-10 flex flex-col gap-1 rounded-xl border border-white/10 bg-black/45 px-2.5 py-1.5 text-[10px] font-bold text-white/80 backdrop-blur-sm">
      <span class="flex items-center gap-1.5">
        <UIcon
          name="i-lucide-castle"
          class="size-3 shrink-0 text-amber-300"
        />
        <span class="text-white">Habitat Lv {{ habitatLevel }}</span>
        <span class="ml-1 text-white/50">{{ isNight ? '🌙' : '☀️' }}</span>
      </span>
      <span
        v-for="stat in habitatStats"
        :key="stat.key"
        class="flex items-center gap-1.5"
      >
        <UIcon
          :name="stat.icon"
          class="size-3 shrink-0"
          :class="stat.color"
        />
        <span class="flex-1">{{ stat.label }}</span>
        <span class="font-mono text-white">{{ stat.value }}</span>
      </span>
    </div>

    <div
      v-if="bugs.length"
      class="pointer-events-none absolute top-4 right-3 z-10 hidden sm:flex items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[10px] font-bold text-white/80 backdrop-blur-sm"
    >
      <UIcon
        name="i-lucide-mouse-pointer-click"
        class="size-3 text-amber-300"
      />
      Click the soil to drop a snack
    </div>

    <div
      v-if="isStarving"
      class="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 flex flex-col items-center gap-1 text-center"
    >
      <span class="text-4xl colony-shake">💀</span>
      <span class="rounded-full bg-black/60 px-3 py-1 text-xs font-black uppercase tracking-widest text-red-300">Colony starving — feed them!</span>
    </div>

    <div
      v-if="!bugs.length"
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-center p-6"
    >
      <span class="text-5xl colony-bob">🫙</span>
      <p class="text-sm font-bold text-white drop-shadow">
        The terrarium is empty.
      </p>
      <p class="text-xs text-white/70 max-w-60 drop-shadow">
        {{ hasSpareBugs ? 'Place a bug from your Bug Box to start foraging.' : 'Buy your first bugs in the Market.' }}
      </p>
      <NuxtLink
        v-if="!hasSpareBugs"
        to="/colony/market"
        class="colony-btn colony-btn-sm mt-1"
        data-no-snack
      >
        <UIcon
          name="i-lucide-store"
          class="size-3.5"
        />
        Open Market
      </NuxtLink>
    </div>

    <div
      v-for="f in bugFloats"
      :key="f.id"
      class="terrarium-float pointer-events-none absolute z-30 font-black"
      :class="f.big ? 'text-base terrarium-float-big' : 'text-xs'"
      :style="{ left: f.x + 'px', top: f.y + 'px' }"
    >
      {{ f.text }}
    </div>
    <div
      v-for="food in foodDrops"
      :key="food.id"
      class="food-drop pointer-events-none absolute z-5"
      :style="{ left: food.x + 'px', top: food.y + 'px' }"
    >
      <span :style="{ transform: `rotate(${food.rotation}deg)` }">{{ food.emoji }}</span>
    </div>

    <slot />
  </div>
</template>

<style scoped>
.terrarium {
  height: clamp(460px, 62vh, 700px);
  background: #1c2350;
  box-shadow:
    inset 0 0 0 2px rgba(255, 255, 255, 0.06),
    inset 0 0 80px rgba(0, 0, 0, 0.35),
    0 20px 60px -20px rgba(0, 0, 0, 0.7);
  border: 1px solid color-mix(in srgb, var(--ui-border) 70%, transparent);
  transition: box-shadow 0.4s;
}
.terrarium-starving {
  box-shadow:
    inset 0 0 0 2px rgba(239, 68, 68, 0.3),
    inset 0 0 80px rgba(60, 0, 0, 0.5),
    0 20px 60px -20px rgba(0, 0, 0, 0.7);
}
.terrarium-lid {
  background: linear-gradient(180deg, #c9ced6, #8a919c 60%, #5b616b);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}

.terrarium-float {
  animation: terrarium-float-up 1.3s ease-out forwards;
  transform: translate(-50%, -100%);
  color: white;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75);
}
.terrarium-float-big {
  color: #ffe08a;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8), 0 0 14px rgba(245, 179, 66, 0.7);
}

.food-drop {
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.42));
  transform: translate(-50%, -50%);
}
.food-drop span {
  display: block;
  font-size: 22px;
  line-height: 1;
  animation: food-drop-in 0.38s cubic-bezier(0.2, 1.65, 0.45, 1) both, food-idle 1.8s ease-in-out 0.38s infinite;
}

@media (max-width: 639px) {
  .terrarium { height: 440px; }
}

@keyframes terrarium-float-up {
  0% { opacity: 0; transform: translate(-50%, -100%) scale(0.8); }
  15% { opacity: 1; transform: translate(-50%, -130%) scale(1.15); }
  100% { opacity: 0; transform: translate(-50%, -230%) scale(1); }
}
@keyframes food-drop-in {
  0% { opacity: 0; transform: translateY(-28px) scale(1.7); }
  70% { opacity: 1; transform: translateY(3px) scale(0.9); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes food-idle {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -2px; }
}
</style>
