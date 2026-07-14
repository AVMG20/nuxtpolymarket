<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */

const props = defineProps<{
  bugs: any[]
  isStarving: boolean
  hasSpareBugs: boolean
}>()

const emit = defineEmits<{
  produced: []
}>()

const canvasWrap = ref<HTMLDivElement | null>(null)
let destroyed = false
let app: any = null
let PIXI: any = null
let sceneryLayer: any = null
let bugLayer: any = null
let trailLayer: any = null
let eventLayer: any = null
let flashlightGfx: any = null
let sceneryGfx: any = null
let eventGfx: any = null
let sceneWidth = 0
let sceneHeight = 0

// ─── Flashlight — hovering the terrarium casts a small dim spotlight that
// draws nearby bugs in and gives them a modest speed bump while they're
// inside it, instead of the whole swarm reacting to the cursor at once.
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
const FOOD_REACTIONS = ['Yum!', 'Tasty!', 'Nom nom!', 'Snack time!', 'Delicious!']

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
  /** Stable per-bug fraction (0-1) used to pick a boost % within the flashlight range — keeps the swarm from all boosting by the exact same amount. */
  boostFrac: number
  /** Idle "look around" pause timer — occasionally a bug stops dead for a beat before wandering again, instead of drifting nonstop. */
  pauseUntil: number
  trail: { x: number, y: number }[]
}
const liveBugs = new Map<string, LiveBug>()
const bugGfx = new Map<string, { sprite: any, halo: any, trail: any }>()

interface PoopEvent {
  id: number
  x: number
  y: number
  createdAt: number
  expiresAt: number
  seed: number
}

interface SquabbleEvent {
  bugA: string
  bugB: string
  startedAt: number
  expiresAt: number
}

interface FoodDrop {
  id: number
  x: number
  y: number
  emoji: string
  expiresAt: number
  rotation: number
}

let ambientEventSeq = 0
let poopEvents: PoopEvent[] = []
let squabble: SquabbleEvent | null = null
const foodDrops = ref<FoodDrop[]>([])
let nextPoopAt = Date.now() + 6_000 + Math.random() * 8_000
let nextSquabbleAt = Date.now() + 9_000 + Math.random() * 12_000

function bugFontSize(tier: number) {
  return 16 + tier * 3
}

function yieldHaloColor(level: number) {
  const colors: Record<number, number> = {
    0: 0x9ca3af,
    1: 0x4ade80,
    2: 0xa3e635,
    3: 0xfacc15,
    4: 0xfbbf24,
    5: 0xfb923c,
    6: 0xf87171,
    7: 0xf472b6,
    8: 0xc084fc,
    9: 0x60a5fa,
    10: 0x22d3ee
  }
  return colors[level] ?? colors[0]!
}

function drawBugHalo(halo: any, live: LiveBug) {
  const size = bugFontSize(live.tier)
  halo.clear()
  halo
    .circle(0, 0, size * 0.95)
    .fill({ color: live.color, alpha: 0.14 })
    .stroke({ color: yieldHaloColor(live.yield), width: 1.5, alpha: 0.82 })
}

function drawScenery(width: number, height: number) {
  if (!sceneryGfx || (width === sceneWidth && height === sceneHeight)) return
  sceneWidth = width
  sceneHeight = height
  sceneryGfx.clear()

  // Uneven soil patches and tiny stones make the floor feel organic without
  // introducing a bitmap asset or making the habitat visually noisy.
  for (let i = 0; i < 34; i++) {
    const x = 20 + ((i * 83) % Math.max(40, width - 40))
    const y = 20 + ((i * 137) % Math.max(40, height - 40))
    const radius = 2 + (i % 4)
    const color = i % 3 === 0 ? 0x9a6a42 : i % 3 === 1 ? 0x6f4a32 : 0xb48758
    sceneryGfx.circle(x, y, radius).fill({ color, alpha: 0.18 + (i % 4) * 0.035 })
  }

  // A worn foraging trail through the middle.
  sceneryGfx
    .ellipse(width * 0.48, height * 0.52, width * 0.34, height * 0.12)
    .fill({ color: 0xc19a68, alpha: 0.07 })

  // Burrow in the upper-left.
  sceneryGfx.circle(width * 0.16, height * 0.22, 31).fill({ color: 0x2b1a13, alpha: 0.42 })
  sceneryGfx.circle(width * 0.16, height * 0.22, 23).fill({ color: 0x120c09, alpha: 0.66 })
  sceneryGfx.ellipse(width * 0.16, height * 0.195, 18, 7).fill({ color: 0xffffff, alpha: 0.035 })

  // A bark shelter and its growth rings.
  const logX = width * 0.68
  const logY = height * 0.72
  const logWidth = Math.min(190, width * 0.24)
  sceneryGfx.roundRect(logX, logY, logWidth, 42, 18).fill({ color: 0x5d3926, alpha: 0.72 }).stroke({ color: 0x8b5a38, width: 2, alpha: 0.55 })
  sceneryGfx.circle(logX + 16, logY + 21, 14).stroke({ color: 0xb17d50, width: 2, alpha: 0.48 })
  sceneryGfx.circle(logX + 16, logY + 21, 7).stroke({ color: 0xb17d50, width: 1, alpha: 0.38 })
  for (let i = 0; i < 4; i++) {
    const lineX = logX + 43 + i * Math.max(18, (logWidth - 55) / 4)
    sceneryGfx.moveTo(lineX, logY + 7).lineTo(lineX - 8, logY + 35).stroke({ color: 0x3e261c, width: 2, alpha: 0.35 })
  }

  // A tiny feeding shelter, two mushrooms and a few grass tufts.
  const shelterX = width * 0.42
  const shelterY = height * 0.18
  sceneryGfx.roundRect(shelterX, shelterY, 74, 42, 8).fill({ color: 0x493126, alpha: 0.48 })
  sceneryGfx.poly([shelterX - 8, shelterY + 5, shelterX + 37, shelterY - 23, shelterX + 82, shelterY + 5]).fill({ color: 0x76513a, alpha: 0.78 }).stroke({ color: 0xa27851, width: 2, alpha: 0.48 })
  sceneryGfx.roundRect(shelterX + 27, shelterY + 17, 20, 25, 8).fill({ color: 0x1b1210, alpha: 0.7 })

  const mushrooms: Array<[number, number, number]> = [
    [width * 0.56, height * 0.32, 1],
    [width * 0.59, height * 0.35, 0.7]
  ]
  for (const [mx, my, scale] of mushrooms) {
    sceneryGfx.roundRect(mx - 3 * scale, my, 6 * scale, 14 * scale, 3).fill({ color: 0xd8c5a0, alpha: 0.7 })
    sceneryGfx.ellipse(mx, my, 13 * scale, 6 * scale).fill({ color: 0xa64f3c, alpha: 0.72 })
    sceneryGfx.circle(mx - 4 * scale, my - 1, 1.4 * scale).fill({ color: 0xf0d7b0, alpha: 0.75 })
    sceneryGfx.circle(mx + 4 * scale, my + 1, 1.2 * scale).fill({ color: 0xf0d7b0, alpha: 0.65 })
  }

  const grassTufts: Array<[number, number]> = [[0.08, 0.75], [0.32, 0.87], [0.9, 0.25], [0.82, 0.46]]
  for (const [gx, gy] of grassTufts) {
    for (let blade = -1; blade <= 1; blade++) {
      sceneryGfx
        .moveTo(width * gx, height * gy)
        .lineTo(width * gx + blade * 7, height * gy - 17 + Math.abs(blade) * 4)
        .stroke({ color: 0x5f8a50, width: 2, alpha: 0.45 })
    }
  }

  // Inset glass edge catches a little light and gives the larger canvas depth.
  sceneryGfx.roundRect(7, 7, width - 14, height - 14, 15).stroke({ color: 0xffffff, width: 1, alpha: 0.07 })
}

function scheduleAmbientEvents(now: number) {
  const bugs = [...liveBugs.values()]
  if (props.isStarving || !bugs.length) return

  if (now >= nextPoopAt) {
    const bug = bugs[Math.floor(Math.random() * bugs.length)]!
    const event = {
      id: ambientEventSeq++,
      x: bug.x - bug.vx * 0.35,
      y: bug.y - bug.vy * 0.35,
      createdAt: now,
      expiresAt: now + POOP_LIFETIME_MS,
      seed: Math.random() * Math.PI * 2
    }
    poopEvents.push(event)
    spawnBugFloat('plop!', event.x, event.y - 5)
    nextPoopAt = now + 11_000 + Math.random() * 14_000
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

function syncLiveBugs() {
  const width = app?.screen.width ?? 600
  const height = app?.screen.height ?? 420
  const now = Date.now()

  for (const id of [...liveBugs.keys()]) {
    if (!props.bugs.some((b: any) => b.id === id)) {
      liveBugs.delete(id)
      const entry = bugGfx.get(id)
      if (entry && bugLayer && trailLayer) {
        bugLayer.removeChild(entry.sprite)
        bugLayer.removeChild(entry.halo)
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
      // The server resets tickProgressMs to a small remainder after every
      // real tick it settles, so the reference frame this bug's progress is
      // measured from just moved. Without resetting cyclesSeen here, it
      // stays pinned at whatever count it reached under the OLD reference
      // frame, `cycles` (computed from the new, smaller base) almost never
      // exceeds it again, and the +N floating popup silently stops firing
      // after the first poll refresh (every 30s) — it looked "removed".
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
      x: Math.random() * width,
      y: Math.random() * height,
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
      trail: []
    })
  }

  if (!PIXI || !bugLayer || !trailLayer) return
  for (const [id, live] of liveBugs) {
    if (bugGfx.has(id)) continue
    const size = bugFontSize(live.tier)
    const halo = new PIXI.Graphics()
    drawBugHalo(halo, live)
    const sprite = new PIXI.Text({
      text: live.emoji,
      style: { fontSize: size }
    })
    sprite.anchor.set(0.5)
    halo.position.set(live.x, live.y)
    sprite.position.set(live.x, live.y)
    const trail = new PIXI.Graphics()
    trailLayer.addChild(trail)
    bugLayer.addChild(halo)
    bugLayer.addChild(sprite)
    bugGfx.set(id, { sprite, halo, trail })
  }
}

// ─── Floating popups (over the canvas, per-bug production ticks) ──────────

interface FloatText { id: number, text: string, x: number, y: number }
const bugFloats = ref<FloatText[]>([])
let floatSeq = 0

function spawnBugFloat(text: string, x: number, y: number) {
  const id = floatSeq++
  bugFloats.value.push({ id, text, x, y })
  setTimeout(() => {
    bugFloats.value = bugFloats.value.filter(f => f.id !== id)
  }, 1300)
}

// ─── Mouse tracking — bugs get curious and drift toward the cursor ────────

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
  const rect = canvasWrap.value?.getBoundingClientRect()
  if (!rect) return
  const pad = 24
  const x = Math.max(pad, Math.min(rect.width - pad, e.clientX - rect.left))
  const y = Math.max(pad, Math.min(rect.height - pad, e.clientY - rect.top))
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
}

/** Soft, muted radial glow at the cursor — layered translucent circles fading outward, since PIXI.Graphics has no native radial gradient fill. Fades in/out smoothly rather than snapping with pointerenter/leave. */
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
      // Solitary species actively preserve a visible bubble from their own
      // kind, so their temperament can be read from the animation alone.
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

  // Every bug keeps a little collision space. Social bugs gather, but never
  // collapse into a single unreadable emoji pile.
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
  const now = Date.now()
  const frameScale = Math.min(2, deltaMS / (1000 / 60))
  const bugs = [...liveBugs.values()]

  drawScenery(width, height)
  drawFlashlight()
  scheduleAmbientEvents(now)
  drawAmbientEvents(now)
  if (foodDrops.value.some(food => food.expiresAt <= now)) {
    foodDrops.value = foodDrops.value.filter(food => food.expiresAt > now)
  }

  for (const live of bugs) {
    let inFlashlight = false
    let seekingFood = false
    if (!props.isStarving) {
      const speedBase = 14 + live.tier * 3
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
        // orbit a point near the cursor rather than piling straight onto
        // it, so a bug drawn in by the flashlight still looks alive
        const targetX = mouseX + Math.cos(now / 450 + live.orbitSeed) * live.orbitRadius
        const targetY = mouseY + Math.sin(now / 450 + live.orbitSeed) * live.orbitRadius
        const dx = targetX - live.x
        const dy = targetY - live.y
        const dist = Math.hypot(dx, dy) || 1
        const pull = 0.55
        live.vx += (dx / dist) * pull
        live.vy += (dy / dist) * pull
      } else if (foodTarget) {
        const dx = foodTarget.x - live.x
        const dy = foodTarget.y - live.y
        const distance = Math.hypot(dx, dy) || 1
        const pull = 0.72
        live.vx += (dx / distance) * pull * frameScale
        live.vy += (dy / distance) * pull * frameScale
      } else if (!paused) {
        applyTemperament(live, bugs, frameScale)

        // occasional erratic dart, like a startled bug
        if (Math.random() < 0.01) {
          live.vx += (Math.random() - 0.5) * speedBase
          live.vy += (Math.random() - 0.5) * speedBase
        }
        // rare "stop and look around" beat so the swarm doesn't read as
        // nonstop drifting — brief pause, then it picks a new direction
        if (Math.random() < 0.0025) {
          live.pauseUntil = now + 350 + Math.random() * 550
        }
      }

      if (!paused) {
        live.x += (live.vx * deltaMS) / 1000
        live.y += (live.vy * deltaMS) / 1000
      } else {
        // settle to a stop instead of freezing mid-stride
        live.vx *= 0.85
        live.vy *= 0.85
      }

      if (live.x < pad || live.x > width - pad) {
        live.vx *= -1
        live.x = Math.max(pad, Math.min(width - pad, live.x))
      }
      if (live.y < pad || live.y > height - pad) {
        live.vy *= -1
        live.y = Math.max(pad, Math.min(height - pad, live.y))
      }

      if (!paused) {
        live.vx += (Math.random() - 0.5) * 2.4
        live.vy += (Math.random() - 0.5) * 2.4
      }
      // flashlight speed bump is a modest +10-15%, unique per bug, and only
      // applies while that bug is actually inside the glow — not the whole
      // swarm reacting to the cursor at once.
      const boostPct = seekingFood
        ? 0.65
        : inFlashlight ? FLASHLIGHT_BOOST_MIN + live.boostFrac * (FLASHLIGHT_BOOST_MAX - FLASHLIGHT_BOOST_MIN) : 0
      const maxSpeed = speedBase * (1 + boostPct)
      const speed = Math.hypot(live.vx, live.vy)
      if (speed > maxSpeed) {
        live.vx = (live.vx / speed) * maxSpeed
        live.vy = (live.vy / speed) * maxSpeed
      }

      // leave a fading trail of recent positions behind the bug
      live.trail.push({ x: live.x, y: live.y })
      if (live.trail.length > 10) live.trail.shift()

      if (foodTarget && Math.hypot(foodTarget.x - live.x, foodTarget.y - live.y) < bugFontSize(live.tier) * 0.75 + 9) {
        foodDrops.value = foodDrops.value.filter(food => food.id !== foodTarget.id)
        const reaction = FOOD_REACTIONS[Math.floor(Math.random() * FOOD_REACTIONS.length)]!
        spawnBugFloat(`${reaction} ${foodTarget.emoji}`, live.x, live.y - bugFontSize(live.tier))
      }

      // predict production ticks client-side for the floating popup — the
      // actual accounting already happened server-side via settleColony. The
      // shown quantity is a cosmetic roll in the bug's real min-max range.
      const elapsedSinceFetch = now - live.fetchedAtMs
      const totalProgress = live.baseProgressMs + elapsedSinceFetch
      const cycles = live.tickMs > 0 ? Math.floor(totalProgress / live.tickMs) : 0
      if (cycles > live.cyclesSeen) {
        live.cyclesSeen = cycles
        const qty = Math.round(live.itemsPerTickMin + Math.random() * (live.itemsPerTickMax - live.itemsPerTickMin))
        spawnBugFloat(`+${formatNumber(qty, false)} ${live.itemEmoji}`, live.x, live.y - bugFontSize(live.tier))
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
    const isSquabbling = !!squabble && (squabble.bugA === live.id || squabble.bugB === live.id)
    const shake = isSquabbling ? Math.sin(now / 32 + live.seed) * 2.5 : 0
    entry.sprite.position.set(live.x + shake, live.y)
    entry.halo.position.set(live.x, live.y)
    // walking direction flips the emoji so bugs "face" where they go, plus a
    // gentle idle "breathing" pulse and a light rocking rotation so the
    // swarm feels alive even at rest — both quicken a touch while boosted.
    const speedNow = Math.hypot(live.vx, live.vy)
    const liveliness = inFlashlight || seekingFood ? 1.5 : 1
    const pulse = 1 + Math.sin(now / 260 + live.seed) * 0.07 * liveliness
    entry.sprite.scale.x = (live.vx < 0 ? -1 : 1) * pulse
    entry.sprite.scale.y = pulse
    entry.sprite.rotation = Math.sin(now / 200 + live.seed * 3) * 0.06 * Math.min(1, speedNow / 20)
    const targetAlpha = props.isStarving ? 0.3 : 1
    entry.sprite.alpha += (targetAlpha - entry.sprite.alpha) * 0.08
    // halo glows a little brighter while a bug is caught in the flashlight —
    // a subtle "excited" tell that doubles as feedback the boost is active
    const targetHaloAlpha = targetAlpha * (inFlashlight ? 0.7 : 0.4)
    entry.halo.alpha += (targetHaloAlpha - entry.halo.alpha) * 0.1
    entry.halo.tint = isSquabbling ? 0xff3333 : 0xffffff

    // redraw the comet-tail trail behind the bug, fading out with age
    entry.trail.clear()
    const len = live.trail.length
    for (let i = 0; i < len - 1; i++) {
      const p = live.trail[i]
      if (!p) continue
      const t = i / len
      entry.trail.circle(p.x, p.y, Math.max(1, bugFontSize(live.tier) * 0.16 * t)).fill({ color: live.color, alpha: targetAlpha * 0.22 * t })
    }
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

  sceneryLayer = new PIXI.Container()
  sceneryGfx = new PIXI.Graphics()
  trailLayer = new PIXI.Container()
  flashlightGfx = new PIXI.Graphics()
  eventLayer = new PIXI.Container()
  eventGfx = new PIXI.Graphics()
  bugLayer = new PIXI.Container()
  sceneryLayer.addChild(sceneryGfx)
  eventLayer.addChild(eventGfx)
  app.stage.addChild(sceneryLayer, flashlightGfx, trailLayer, eventLayer, bugLayer)

  drawScenery(app.screen.width, app.screen.height)
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
  squabble = null
  sceneryLayer = null
  sceneryGfx = null
  eventLayer = null
  eventGfx = null
  flashlightGfx = null
  if (app) {
    app.destroy(true, { children: true })
    app = null
  }
})
</script>

<template>
  <div
    ref="canvasWrap"
    class="terrarium-soil relative w-full rounded-2xl border border-default overflow-hidden shadow-inner"
    :class="bugs.length ? 'cursor-crosshair' : ''"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
    @pointerdown="onPointerDown"
  >
    <div
      v-if="bugs.length"
      class="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full border border-default/70 bg-default/65 px-2.5 py-1 text-[10px] font-semibold text-muted backdrop-blur-sm"
    >
      <span class="size-1.5 rounded-full bg-success animate-pulse" />
      Living habitat
    </div>
    <div
      v-if="bugs.length"
      class="pointer-events-none absolute top-3 right-3 z-10 hidden sm:flex items-center gap-1.5 rounded-full border border-default/70 bg-default/65 px-2.5 py-1 text-[10px] font-semibold text-muted backdrop-blur-sm"
    >
      <UIcon
        name="i-lucide-mouse-pointer-click"
        class="size-3 text-primary"
      />
      Click to drop a snack
    </div>
    <div
      v-if="bugs.length"
      class="pointer-events-none absolute right-3 bottom-3 z-10 hidden sm:flex items-center gap-3 rounded-full border border-default/60 bg-default/55 px-3 py-1.5 text-[10px] text-muted backdrop-blur-sm"
    >
      <span class="inline-flex items-center gap-1"><UIcon
        name="i-lucide-users"
        class="size-3 text-success"
      /> Social bugs cluster</span>
      <span class="inline-flex items-center gap-1"><UIcon
        name="i-lucide-user"
        class="size-3 text-warning"
      /> Solitary bugs roam</span>
    </div>
    <div
      v-if="!bugs.length"
      class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-6"
    >
      <UIcon
        name="i-lucide-bug-off"
        class="size-8 text-muted/40"
      />
      <p class="text-sm text-muted">
        The terrarium is empty.
      </p>
      <p class="text-xs text-muted/60 max-w-60">
        {{ hasSpareBugs ? 'Place a bug from your inventory to start foraging.' : 'Buy your first bugs in the Market.' }}
      </p>
      <UButton
        v-if="!hasSpareBugs"
        size="xs"
        variant="soft"
        icon="i-lucide-store"
        to="/colony/market"
      >
        Open Market
      </UButton>
    </div>
    <div
      v-for="f in bugFloats"
      :key="f.id"
      class="colony-float pointer-events-none absolute z-30 text-sm font-semibold"
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
  </div>
</template>

<style scoped>
.colony-float {
  animation: colony-float-up 1.3s ease-out forwards;
  transform: translate(-50%, -100%);
  color: white;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
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

.terrarium-soil {
  height: clamp(460px, 62vh, 680px);
  background-color: color-mix(in srgb, var(--ui-bg-elevated) 76%, #523824 24%);
  background-image:
    radial-gradient(circle at 14% 24%, rgba(186, 137, 84, 0.13) 0 2px, transparent 3px),
    radial-gradient(circle at 72% 66%, rgba(54, 32, 21, 0.17) 0 3px, transparent 4px),
    radial-gradient(circle at 44% 82%, rgba(212, 167, 111, 0.08) 0 1px, transparent 2px),
    linear-gradient(145deg, rgba(91, 58, 37, 0.16), transparent 42%, rgba(38, 25, 18, 0.2));
  background-size: 43px 47px, 67px 61px, 29px 31px, 100% 100%;
}

.terrarium-soil::after {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  box-shadow: inset 0 0 80px rgba(19, 12, 8, 0.35), inset 0 1px rgba(255, 255, 255, 0.05);
}

@media (max-width: 639px) {
  .terrarium-soil {
    height: 460px;
  }
}

@keyframes colony-float-up {
  0% {
    opacity: 0;
    transform: translate(-50%, -100%) scale(0.8);
  }
  15% {
    opacity: 1;
    transform: translate(-50%, -130%) scale(1.1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -220%) scale(1);
  }
}

@keyframes food-drop-in {
  0% {
    opacity: 0;
    transform: translateY(-28px) scale(1.7);
  }
  70% {
    opacity: 1;
    transform: translateY(3px) scale(0.9);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes food-idle {
  0%, 100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -2px;
  }
}
</style>
