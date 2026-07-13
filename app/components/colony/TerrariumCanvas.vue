<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */

const props = defineProps<{
  bugs: any[]
  isStarving: boolean
  hasSpareBugs: boolean
}>()

const canvasWrap = ref<HTMLDivElement | null>(null)
let destroyed = false
let app: any = null
let PIXI: any = null
let bugLayer: any = null
let trailLayer: any = null
let flashlightGfx: any = null

// ─── Flashlight — hovering the terrarium casts a small dim spotlight that
// draws nearby bugs in and gives them a modest speed bump while they're
// inside it, instead of the whole swarm reacting to the cursor at once.
const FLASHLIGHT_RADIUS = 110
const FLASHLIGHT_BOOST_MIN = 0.10
const FLASHLIGHT_BOOST_MAX = 0.15
let flashlightAlpha = 0

interface LiveBug {
  id: string
  typeId: string
  color: number
  emoji: string
  itemEmoji: string
  tier: number
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

function bugFontSize(tier: number) {
  return 16 + tier * 3
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
      existing.tickMs = bug.tickMs
      existing.itemsPerTickMin = bug.itemsPerTickMin
      existing.itemsPerTickMax = bug.itemsPerTickMax
      existing.baseProgressMs = bug.tickProgressMs
      existing.fetchedAtMs = now
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
    halo.circle(0, 0, size * 0.95).fill({ color: live.color, alpha: 0.14 })
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

function tickFrame(deltaMS: number) {
  if (!PIXI || !app) return
  const width = app.screen.width
  const height = app.screen.height
  const pad = 16
  const now = Date.now()

  drawFlashlight()

  for (const live of liveBugs.values()) {
    let inFlashlight = false
    if (!props.isStarving) {
      const speedBase = 14 + live.tier * 3
      const paused = now < live.pauseUntil

      if (mouseActive) {
        const distToMouse = Math.hypot(mouseX - live.x, mouseY - live.y)
        inFlashlight = distToMouse < FLASHLIGHT_RADIUS
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
      } else if (!paused) {
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
      const boostPct = inFlashlight ? FLASHLIGHT_BOOST_MIN + live.boostFrac * (FLASHLIGHT_BOOST_MAX - FLASHLIGHT_BOOST_MIN) : 0
      const maxSpeed = speedBase * (1 + boostPct)
      const speed = Math.hypot(live.vx, live.vy)
      if (speed > maxSpeed) {
        live.vx = (live.vx / speed) * maxSpeed
        live.vy = (live.vy / speed) * maxSpeed
      }

      // leave a fading trail of recent positions behind the bug
      live.trail.push({ x: live.x, y: live.y })
      if (live.trail.length > 10) live.trail.shift()

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
      }
    }

    const entry = bugGfx.get(live.id)
    if (!entry) continue
    entry.sprite.position.set(live.x, live.y)
    entry.halo.position.set(live.x, live.y)
    // walking direction flips the emoji so bugs "face" where they go, plus a
    // gentle idle "breathing" pulse and a light rocking rotation so the
    // swarm feels alive even at rest — both quicken a touch while boosted.
    const speedNow = Math.hypot(live.vx, live.vy)
    const liveliness = inFlashlight ? 1.5 : 1
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

  flashlightGfx = new PIXI.Graphics()
  trailLayer = new PIXI.Container()
  bugLayer = new PIXI.Container()
  app.stage.addChild(flashlightGfx)
  app.stage.addChild(trailLayer)
  app.stage.addChild(bugLayer)

  syncLiveBugs()
  app.ticker.add(() => tickFrame(app.ticker.deltaMS))
})

watch(() => props.bugs.map((b: any) => `${b.id}:${b.tickProgressMs}`).join(','), syncLiveBugs)

onUnmounted(() => {
  destroyed = true
  bugGfx.clear()
  liveBugs.clear()
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
    class="relative w-full rounded-xl border border-default bg-elevated/40 overflow-hidden"
    style="height: 420px;"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
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
      class="colony-float pointer-events-none absolute text-sm font-semibold"
      :style="{ left: f.x + 'px', top: f.y + 'px' }"
    >
      {{ f.text }}
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
</style>
