// Pirate Raid renderer. Reads the sim's state every frame and draws it on a 2D
// canvas; owns nothing the simulation depends on, so a headless balance run
// never builds one.
//
// Layers, bottom to top: the baked sea (gradient, texture and island
// shallows, rebuilt only on resize or a new island layout), animated caustics
// and glints, wakes and foam, the baked land, zones and telegraphs, pickups
// and mines, wrecks, ships, projectiles, then smoke, sparks, lightning and
// combat text. Glow is stamped from cached sprites (fx.ts), never shadowBlur.

import {
    PIRATE_HELLFIRE_ZONE_RADIUS, PIRATE_RARITIES, PIRATE_ROGUE_WAVE_LENGTH, PIRATE_ROGUE_WAVE_WIDTH, piratePowerUp,
    type PirateRarity
} from '#shared/utils/gamelogic/pirates'
import { PLAYER_BOMB_RADIUS, WORLD_H, WORLD_W } from './constants'
import { enemyHull, hullHitRadius, playerHull } from './layout'
import type { PirateSim } from './sim'
import type {
    Island, Point, SimAlly, SimEnemy, SimEvent, SimPickup, SimProjectile, SimSeaMine, SimTelegraph, SimWreck, SimZone
} from './types'
import {
    FloatingTexts, ParticleSystem, Shake, clamp01, css, easeOutBack, emitSkinTrail, jaggedBolt, mix, rgba, seededRandom, shade,
    spawnBurst, spawnExplosion, spawnHeal, spawnImpact, spawnMuzzle, spawnSmoke, spawnSplash, sprites, stampGlow, type Bolt
} from './fx'
import { drawKraken, drawShip, enemyLook, krakenEmergence, skinLook, type ShipLook } from './ships'

/** Kraken's Maw pull radius, for the aim preview (the live zone carries its own radius). */
const MAELSTROM_PREVIEW_RADIUS = 185
const CONSORT_SCALE = 0.75
const GHOST_SCALE = 0.62

const RARITY_COLOR = new Map<PirateRarity, number>(PIRATE_RARITIES.map(rarity => [rarity.id, rarity.color]))
/** Segments in a baked coastline. */
const COAST_STEPS = 64

function rand(min: number, max: number) {
    return min + Math.random() * (max - min)
}

/** A small wave-crest highlight that fades in and out as it drifts. */
interface Glint {
    x: number
    y: number
    phase: number
    speed: number
    length: number
    tilt: number
}

export class PirateRenderer {
    private canvas: HTMLCanvasElement
    private ctx: CanvasRenderingContext2D
    private sim: PirateSim

    private cssWidth = WORLD_W
    private cssHeight = WORLD_H
    /** Backing-store pixels per CSS pixel; never below 1 so dpr-1 screens are drawn at native resolution. */
    private ratio = 1
    private maxRatio = 1
    private minRatio = 1
    /** CSS pixels per world unit, and the letterbox offset in CSS pixels. */
    private fit = 1
    private offsetX = 0
    private offsetY = 0

    private seaLayer: HTMLCanvasElement | null = null
    private landLayer: HTMLCanvasElement | null = null
    private vignette: HTMLCanvasElement | null = null
    private islandsRef: readonly Island[] | null = null
    private islandsKey = ''
    private coastCache = new WeakMap<Island, Point[]>()
    private glints: Glint[] = []

    private particles = new ParticleSystem()
    private texts = new FloatingTexts()
    private shake = new Shake()
    private bolts: Bolt[] = []
    private time = 0
    private cursor: Point | null = null
    /** Distance sailed since each hull last dropped wake foam. */
    private wakeDistance = new Map<string, number>()
    private frameCostAverage = 0
    private frameIntervalAverage = 1000 / 60
    private qualityFrames = 0
    private lastFrameAt = 0
    private lastResolutionChangeAt = 0

    private enemyLooks = new Map<string, ShipLook>()
    private summonedLooks = new Map<string, ShipLook>()

    constructor(canvas: HTMLCanvasElement, sim: PirateSim) {
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D is unavailable')
        this.canvas = canvas
        this.ctx = ctx
        this.sim = sim
        this.glints = Array.from({ length: 220 }, () => ({
            x: Math.random() * WORLD_W,
            y: Math.random() * WORLD_H,
            phase: Math.random() * Math.PI * 2,
            speed: rand(0.5, 1.1),
            length: rand(6, 16),
            tilt: rand(-0.2, 0.2)
        }))
    }

    destroy() {
        this.particles.clear()
        this.texts.items = []
        this.bolts = []
        this.seaLayer = null
        this.landLayer = null
        this.vignette = null
    }

    // ─── Sizing ─────────────────────────────────────────────────────────────

    resize(cssWidth: number, cssHeight: number) {
        this.cssWidth = Math.max(1, cssWidth)
        this.cssHeight = Math.max(1, cssHeight)
        const dpr = window.devicePixelRatio || 1
        this.maxRatio = Math.max(1, Math.min(dpr, 2))
        // Adaptive quality may trade resolution for frame time on dense
        // screens, but a standard-density screen always renders at 1:1.
        this.minRatio = dpr <= 1 ? this.maxRatio : Math.max(1, this.maxRatio * 0.65)
        this.ratio = this.ratio > 1 ? Math.min(this.maxRatio, Math.max(this.minRatio, this.ratio)) : this.maxRatio
        this.applySize()
    }

    private applySize() {
        this.canvas.style.width = `${this.cssWidth}px`
        this.canvas.style.height = `${this.cssHeight}px`
        this.canvas.width = Math.round(this.cssWidth * this.ratio)
        this.canvas.height = Math.round(this.cssHeight * this.ratio)
        this.fit = Math.min(this.cssWidth / WORLD_W, this.cssHeight / WORLD_H)
        this.offsetX = (this.cssWidth - WORLD_W * this.fit) / 2
        this.offsetY = (this.cssHeight - WORLD_H * this.fit) / 2
        this.buildSea()
        this.buildLand()
        this.buildVignette()
    }

    /** Device pixels per world unit. */
    private get worldScale() {
        return this.fit * this.ratio
    }

    screenToWorld(clientX: number, clientY: number): Point {
        const rect = this.canvas.getBoundingClientRect()
        const sx = (clientX - rect.left) * (this.cssWidth / (rect.width || this.cssWidth))
        const sy = (clientY - rect.top) * (this.cssHeight / (rect.height || this.cssHeight))
        return { x: (sx - this.offsetX) / this.fit, y: (sy - this.offsetY) / this.fit }
    }

    setCursor(world: Point | null) {
        this.cursor = world
    }

    // ─── Baked layers ───────────────────────────────────────────────────────

    private layerCanvas() {
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(WORLD_W * this.worldScale))
        canvas.height = Math.max(1, Math.round(WORLD_H * this.worldScale))
        const ctx = canvas.getContext('2d')!
        ctx.scale(this.worldScale, this.worldScale)
        return { canvas, ctx }
    }

    /** Cached coastline points (relative to the island centre, at scale 1). */
    private coast(island: Island) {
        let points = this.coastCache.get(island)
        if (!points) {
            const random = seededRandom(island.seed * 1_000_003 + island.x * 7 + island.y * 13)
            const waves = Array.from({ length: 4 }, (_, i) => ({ k: i + 2, phase: random() * Math.PI * 2, amp: 0.035 + random() * 0.05 / (i + 1) }))
            points = []
            for (let i = 0; i < COAST_STEPS; i++) {
                const a = i / COAST_STEPS * Math.PI * 2
                const r = island.r * (1 + waves.reduce((sum, w) => sum + Math.sin(a * w.k + w.phase) * w.amp, 0))
                points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
            }
            this.coastCache.set(island, points)
        }
        return points
    }

    /** Trace the coastline at `scale` around the island centre (plus an offset) as the current path. */
    private coastPath(ctx: CanvasRenderingContext2D, island: Island, scale: number, dx = 0, dy = 0) {
        const points = this.coast(island)
        ctx.beginPath()
        for (let i = 0; i < points.length; i++) {
            const p = points[i]!
            const x = island.x + dx + p.x * scale
            const y = island.y + dy + p.y * scale
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
        }
        ctx.closePath()
    }

    /** Radius of the coastline at an angle, for placing boulders. */
    private coastRadius(island: Island, angle: number) {
        const points = this.coast(island)
        const i = ((Math.round(angle / (Math.PI * 2) * COAST_STEPS) % COAST_STEPS) + COAST_STEPS) % COAST_STEPS
        const p = points[i]!
        return Math.hypot(p.x, p.y)
    }

    /**
     * Open water: a smooth depth gradient (lighter mid-sea, deep navy at the
     * edges), broad soft colour variation, and turquoise shallows that follow
     * each coastline. No texture strokes: the moving light lives in drawSea.
     */
    private buildSea() {
        const { canvas, ctx } = this.layerCanvas()
        const base = ctx.createRadialGradient(WORLD_W * 0.5, WORLD_H * 0.45, 60, WORLD_W * 0.5, WORLD_H * 0.5, WORLD_W * 0.72)
        base.addColorStop(0, '#1d7d93')
        base.addColorStop(0.45, '#15627e')
        base.addColorStop(0.8, '#0d4666')
        base.addColorStop(1, '#093552')
        ctx.fillStyle = base
        ctx.fillRect(0, 0, WORLD_W, WORLD_H)
        const depth = ctx.createLinearGradient(0, 0, 0, WORLD_H)
        depth.addColorStop(0, 'rgba(120,220,230,0.06)')
        depth.addColorStop(0.5, 'rgba(120,220,230,0)')
        depth.addColorStop(1, 'rgba(3,18,40,0.22)')
        ctx.fillStyle = depth
        ctx.fillRect(0, 0, WORLD_W, WORLD_H)

        // Broad, very soft patches so the sea isn't one flat gradient. Seeded so it never reshuffles.
        const random = seededRandom(424242)
        for (let i = 0; i < 16; i++) {
            const x = random() * WORLD_W
            const y = random() * WORLD_H
            const r = 220 + random() * 320
            const light = i % 2 === 0
            const g = ctx.createRadialGradient(x, y, 0, x, y, r)
            g.addColorStop(0, light ? 'rgba(90,205,215,0.11)' : 'rgba(4,24,52,0.16)')
            g.addColorStop(1, light ? 'rgba(90,205,215,0)' : 'rgba(4,24,52,0)')
            ctx.fillStyle = g
            ctx.fillRect(x - r, y - r, r * 2, r * 2)
        }

        // Shallows: layered coastline fills from deep to bright, so the
        // turquoise follows the island's shape and brightens toward the beach.
        const steps = 9
        for (const island of this.sim.islands) {
            for (let i = 0; i < steps; i++) {
                const t = i / (steps - 1)
                const scale = 1.75 - t * 0.72
                const color = mix(0x2fb3b8, 0x9beee0, t * t)
                ctx.fillStyle = rgba(color, 0.05 + t * 0.09)
                this.coastPath(ctx, island, scale)
                ctx.fill()
            }
        }
        this.seaLayer = canvas
    }

    private buildLand() {
        const { canvas, ctx } = this.layerCanvas()
        for (const island of this.sim.islands) this.drawIsland(ctx, island)
        this.landLayer = canvas
        this.islandsRef = this.sim.islands
        this.islandsKey = this.islandSignature()
    }

    private islandSignature() {
        return this.sim.islands.map(island => `${Math.round(island.x)},${Math.round(island.y)},${Math.round(island.r)},${island.seed}`).join(';')
    }

    private drawIsland(ctx: CanvasRenderingContext2D, island: Island) {
        const random = seededRandom(island.seed * 7_654_321 + island.r * 31)
        const { x, y, r } = island
        const rocky = island.kind === 'rock'
        const volcanic = island.kind === 'volcanic'

        // Soft drop shadow onto the water, light from the upper left.
        ctx.fillStyle = 'rgba(3,18,36,0.16)'
        this.coastPath(ctx, island, 1.03, 5, 7)
        ctx.fill()
        this.coastPath(ctx, island, 1.0, 9, 12)
        ctx.fill()

        // Wet sand at the waterline, then the dry beach.
        const sand = volcanic ? 0x6e6259 : rocky ? 0x8b9099 : 0xefdcaa
        ctx.fillStyle = css(shade(sand, -0.22))
        this.coastPath(ctx, island, 1)
        ctx.fill()
        const beach = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r * 1.1)
        beach.addColorStop(0, css(shade(sand, 0.12)))
        beach.addColorStop(1, css(shade(sand, -0.06)))
        ctx.fillStyle = beach
        this.coastPath(ctx, island, 0.95)
        ctx.fill()

        // Interior: grass, ash or stone, with a darker rim where it meets the sand.
        const interior: Record<Island['kind'], [number, number]> = {
            tropical: [0x5cae4c, 0x2f7330],
            volcanic: [0x5b4a43, 0x2a201d],
            ruins: [0x9fae62, 0x5f7040],
            rock: [0x7d858f, 0x4a515b]
        }
        const [light, dark] = interior[island.kind]
        const innerScale = rocky ? 0.9 : volcanic ? 0.84 : 0.78
        const inner = ctx.createRadialGradient(x - r * 0.28, y - r * 0.32, r * 0.05, x, y, r * innerScale)
        inner.addColorStop(0, css(light))
        inner.addColorStop(0.6, css(mix(light, dark, 0.5)))
        inner.addColorStop(1, css(dark))
        ctx.fillStyle = inner
        this.coastPath(ctx, island, innerScale)
        ctx.fill()
        ctx.strokeStyle = rgba(shade(dark, -0.35), 0.55)
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.stroke()

        if (island.kind === 'tropical') {
            // Undergrowth clumps, then palms leaning outward from the middle.
            for (let i = 0; i < 5; i++) {
                const a = random() * Math.PI * 2
                const d = random() * r * 0.45
                ctx.fillStyle = rgba(shade(dark, -0.1), 0.28)
                ctx.beginPath()
                ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, 6 + random() * 9, 4 + random() * 6, random() * 3, 0, Math.PI * 2)
                ctx.fill()
            }
            const palms = 4 + Math.floor(random() * 4)
            const placed: { x: number, y: number }[] = []
            for (let i = 0; i < palms; i++) {
                const a = random() * Math.PI * 2
                const d = r * (0.12 + random() * 0.5)
                const px = x + Math.cos(a) * d
                const py = y + Math.sin(a) * d
                if (placed.some(p => Math.hypot(p.x - px, p.y - py) < 16)) continue
                placed.push({ x: px, y: py })
                this.drawPalm(ctx, px, py, 11 + random() * 6, random() * Math.PI * 2, random)
            }
        } else if (volcanic) {
            this.drawVolcano(ctx, island, random)
        } else if (island.kind === 'ruins') {
            this.drawRuins(ctx, island, random)
        } else {
            // Bare rock: cracks and lighter facets across the mass.
            ctx.strokeStyle = 'rgba(20,24,32,0.45)'
            ctx.lineWidth = 1.6
            ctx.lineCap = 'round'
            for (let i = 0; i < 5; i++) {
                const a = random() * Math.PI * 2
                const d = random() * r * 0.4
                ctx.beginPath()
                ctx.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d)
                ctx.lineTo(x + Math.cos(a + 0.8) * (d + r * 0.25), y + Math.sin(a + 0.8) * (d + r * 0.25))
                ctx.lineTo(x + Math.cos(a + 0.5) * (d + r * 0.45), y + Math.sin(a + 0.5) * (d + r * 0.45))
                ctx.stroke()
            }
        }

        // Boulders along the shoreline for every kind, sun on the upper left.
        const boulders = rocky ? 6 : 3 + Math.floor(random() * 2)
        for (let i = 0; i < boulders; i++) {
            const a = random() * Math.PI * 2
            const d = this.coastRadius(island, a) * (rocky ? 0.15 + random() * 0.55 : 0.84 + random() * 0.14)
            const bx = x + Math.cos(a) * d
            const by = y + Math.sin(a) * d
            const br = rocky ? 7 + random() * 9 : 4 + random() * 5
            this.drawBoulder(ctx, bx, by, br, a, rocky ? 0x848d97 : 0x9aa3ad)
        }
    }

    private drawBoulder(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tilt: number, tone: number) {
        ctx.fillStyle = 'rgba(3,18,36,0.3)'
        ctx.beginPath()
        ctx.ellipse(x + r * 0.35, y + r * 0.45, r, r * 0.78, tilt, 0, Math.PI * 2)
        ctx.fill()
        const stone = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r)
        stone.addColorStop(0, css(shade(tone, 0.25)))
        stone.addColorStop(0.7, css(tone))
        stone.addColorStop(1, css(shade(tone, -0.45)))
        ctx.fillStyle = stone
        ctx.beginPath()
        ctx.ellipse(x, y, r, r * 0.78, tilt, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = css(shade(tone, -0.6))
        ctx.lineWidth = 1.2
        ctx.stroke()
        // A flat lit facet on the sunward side.
        ctx.fillStyle = rgba(shade(tone, 0.5), 0.5)
        ctx.beginPath()
        ctx.moveTo(x - r * 0.55, y - r * 0.2)
        ctx.lineTo(x - r * 0.1, y - r * 0.55)
        ctx.lineTo(x + r * 0.25, y - r * 0.3)
        ctx.lineTo(x - r * 0.2, y - r * 0.05)
        ctx.closePath()
        ctx.fill()
    }

    /** A palm seen from above: a starburst of tapered fronds with a mid-rib, on a leaning trunk, with its shadow on the ground. */
    private drawPalm(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number, random: () => number) {
        const fronds = 7 + Math.floor(random() * 2)
        // Ground shadow, thrown down-right.
        ctx.fillStyle = 'rgba(4,22,10,0.32)'
        ctx.beginPath()
        ctx.ellipse(x + size * 0.45, y + size * 0.55, size * 0.95, size * 0.7, 0.6, 0, Math.PI * 2)
        ctx.fill()
        // Trunk from its root to the crown.
        ctx.strokeStyle = '#4a3220'
        ctx.lineCap = 'round'
        ctx.lineWidth = size * 0.17
        ctx.beginPath()
        ctx.moveTo(x + size * 0.32, y + size * 0.4)
        ctx.lineTo(x, y)
        ctx.stroke()
        ctx.strokeStyle = '#7a5637'
        ctx.lineWidth = size * 0.08
        ctx.stroke()
        for (let i = 0; i < fronds; i++) {
            const a = rotation + i / fronds * Math.PI * 2 + (random() - 0.5) * 0.3
            const len = size * (0.85 + random() * 0.3)
            const width = size * 0.3
            const cos = Math.cos(a)
            const sin = Math.sin(a)
            // Fronds facing the light are brighter.
            const lit = 0.5 - Math.cos(a + Math.PI * 0.75) * 0.5
            const tone = mix(0x2c7a2f, 0x62b84d, lit)
            ctx.fillStyle = css(tone)
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.quadraticCurveTo(x + cos * len * 0.45 - sin * width, y + sin * len * 0.45 + cos * width, x + cos * len, y + sin * len)
            ctx.quadraticCurveTo(x + cos * len * 0.45 + sin * width, y + sin * len * 0.45 - cos * width, x, y)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = rgba(0x143d16, 0.55)
            ctx.lineWidth = 0.9
            ctx.stroke()
            ctx.strokeStyle = rgba(shade(tone, 0.35), 0.7)
            ctx.lineWidth = 0.8
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + cos * len * 0.9, y + sin * len * 0.9)
            ctx.stroke()
        }
        // Coconuts at the crown.
        ctx.fillStyle = '#5b3d22'
        for (let i = 0; i < 3; i++) {
            const a = rotation + i * 2.1
            ctx.beginPath()
            ctx.arc(x + Math.cos(a) * size * 0.14, y + Math.sin(a) * size * 0.14, size * 0.1, 0, Math.PI * 2)
            ctx.fill()
        }
    }

    private drawVolcano(ctx: CanvasRenderingContext2D, island: Island, random: () => number) {
        const { x, y, r } = island
        // The cone: ridges radiating from the crater, lit from the upper left.
        for (let i = 0; i < 14; i++) {
            const a = i / 14 * Math.PI * 2 + random() * 0.2
            const lit = 0.5 - Math.cos(a + Math.PI * 0.75) * 0.5
            ctx.strokeStyle = rgba(mix(0x1a1210, 0x8a7a70, lit), 0.35)
            ctx.lineWidth = 3 + random() * 4
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3)
            ctx.lineTo(x + Math.cos(a + 0.1) * r * 0.78, y + Math.sin(a + 0.1) * r * 0.78)
            ctx.stroke()
        }
        // Lava channels down the slopes: dark crust with a bright molten core.
        const channels = 3
        for (let i = 0; i < channels; i++) {
            const a = i / channels * Math.PI * 2 + random() * 1.2
            const points = [
                { x: x + Math.cos(a) * r * 0.24, y: y + Math.sin(a) * r * 0.24 },
                { x: x + Math.cos(a + 0.35) * r * 0.45, y: y + Math.sin(a + 0.35) * r * 0.45 },
                { x: x + Math.cos(a + 0.15) * r * 0.7, y: y + Math.sin(a + 0.15) * r * 0.7 }
            ]
            const trace = () => {
                ctx.beginPath()
                ctx.moveTo(points[0]!.x, points[0]!.y)
                ctx.quadraticCurveTo(points[1]!.x, points[1]!.y, points[2]!.x, points[2]!.y)
            }
            ctx.lineCap = 'round'
            ctx.strokeStyle = '#3b0d08'
            ctx.lineWidth = 5
            trace()
            ctx.stroke()
            ctx.strokeStyle = '#f97316'
            ctx.lineWidth = 2.4
            trace()
            ctx.stroke()
            ctx.strokeStyle = '#fde047'
            ctx.lineWidth = 1
            trace()
            ctx.stroke()
            ctx.globalCompositeOperation = 'lighter'
            stampGlow(ctx, 0xf97316, points[1]!.x, points[1]!.y, r * 0.22, 0.3)
            ctx.globalCompositeOperation = 'source-over'
        }
        // Crater rim and the lava pool.
        ctx.fillStyle = '#1a1210'
        ctx.beginPath()
        ctx.arc(x, y, r * 0.3, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#4a3a34'
        ctx.lineWidth = 2
        ctx.stroke()
        const lava = ctx.createRadialGradient(x, y, 0, x, y, r * 0.24)
        lava.addColorStop(0, '#fef08a')
        lava.addColorStop(0.35, '#fb923c')
        lava.addColorStop(0.8, '#b91c1c')
        lava.addColorStop(1, '#3b0d08')
        ctx.fillStyle = lava
        ctx.beginPath()
        ctx.arc(x, y, r * 0.24, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalCompositeOperation = 'lighter'
        stampGlow(ctx, 0xf97316, x, y, r * 0.55, 0.5)
        ctx.globalCompositeOperation = 'source-over'
    }

    private drawRuins(ctx: CanvasRenderingContext2D, island: Island, random: () => number) {
        const { x, y, r } = island
        // A cracked flagstone plaza.
        const w = r * 0.7
        const h = r * 0.5
        ctx.fillStyle = 'rgba(3,18,36,0.2)'
        ctx.fillRect(x - w / 2 + 3, y - h / 2 + 4, w, h)
        ctx.fillStyle = '#cfc9b8'
        ctx.fillRect(x - w / 2, y - h / 2, w, h)
        ctx.strokeStyle = 'rgba(70,64,56,0.5)'
        ctx.lineWidth = 1.2
        ctx.strokeRect(x - w / 2, y - h / 2, w, h)
        ctx.beginPath()
        for (let i = 1; i < 4; i++) {
            ctx.moveTo(x - w / 2 + i * w / 4, y - h / 2)
            ctx.lineTo(x - w / 2 + i * w / 4, y + h / 2)
        }
        for (let i = 1; i < 3; i++) {
            ctx.moveTo(x - w / 2, y - h / 2 + i * h / 3)
            ctx.lineTo(x + w / 2, y - h / 2 + i * h / 3)
        }
        ctx.stroke()
        // Moss creeping over the stones.
        for (let i = 0; i < 5; i++) {
            ctx.fillStyle = 'rgba(96,140,60,0.45)'
            ctx.beginPath()
            ctx.ellipse(x + (random() - 0.5) * w, y + (random() - 0.5) * h, 4 + random() * 7, 3 + random() * 4, random() * 3, 0, Math.PI * 2)
            ctx.fill()
        }
        // An altar in the middle.
        ctx.fillStyle = 'rgba(3,18,36,0.3)'
        ctx.fillRect(x - 6 + 2, y - 4 + 3, 12, 8)
        ctx.fillStyle = '#e7e5e4'
        ctx.fillRect(x - 6, y - 4, 12, 8)
        ctx.strokeStyle = '#78716c'
        ctx.strokeRect(x - 6, y - 4, 12, 8)
        // Columns around the plaza, some still standing, some toppled.
        for (let i = 0; i < 8; i++) {
            const cx = x - w / 2 + (i % 4) * w / 3
            const cy = y + (i < 4 ? -h / 2 : h / 2)
            const standing = random() < 0.6
            if (standing) {
                ctx.fillStyle = 'rgba(3,18,36,0.35)'
                ctx.beginPath()
                ctx.arc(cx + 3, cy + 4, 5.5, 0, Math.PI * 2)
                ctx.fill()
                const drum = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 5.5)
                drum.addColorStop(0, '#f5f5f4')
                drum.addColorStop(1, '#a8a29e')
                ctx.fillStyle = drum
                ctx.beginPath()
                ctx.arc(cx, cy, 5.5, 0, Math.PI * 2)
                ctx.fill()
                ctx.strokeStyle = '#57534e'
                ctx.lineWidth = 1.2
                ctx.stroke()
                ctx.beginPath()
                ctx.arc(cx, cy, 2.5, 0, Math.PI * 2)
                ctx.stroke()
            } else {
                ctx.save()
                ctx.translate(cx, cy)
                ctx.rotate(random() * Math.PI)
                ctx.fillStyle = 'rgba(3,18,36,0.3)'
                ctx.fillRect(-8 + 2, -3 + 3, 16, 6)
                const drum = ctx.createLinearGradient(0, -3, 0, 3)
                drum.addColorStop(0, '#e7e5e4')
                drum.addColorStop(1, '#a8a29e')
                ctx.fillStyle = drum
                ctx.fillRect(-8, -3, 16, 6)
                ctx.strokeStyle = '#57534e'
                ctx.lineWidth = 1
                ctx.strokeRect(-8, -3, 16, 6)
                ctx.restore()
            }
        }
        this.drawPalm(ctx, x + r * 0.15, y - r * 0.6, 12, random() * 3, random)
        this.drawPalm(ctx, x - r * 0.5, y + r * 0.45, 10, random() * 3, random)
    }

    private buildVignette() {
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(this.cssWidth / 2))
        canvas.height = Math.max(1, Math.round(this.cssHeight / 2))
        const ctx = canvas.getContext('2d')!
        const w = canvas.width
        const h = canvas.height
        const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72)
        gradient.addColorStop(0, 'rgba(0,8,20,0)')
        gradient.addColorStop(1, 'rgba(0,8,20,0.5)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, w, h)
        this.vignette = canvas
    }

    // ─── Frame ──────────────────────────────────────────────────────────────

    frame(dtMs: number, events: SimEvent[]) {
        const startedAt = performance.now()
        const dt = Math.min(0.05, Math.max(0, dtMs / 1000))
        this.time += dt
        if (this.sim.islands !== this.islandsRef) {
            const key = this.islandSignature()
            this.islandsRef = this.sim.islands
            if (key !== this.islandsKey) {
                this.buildSea()
                this.buildLand()
            }
        }

        for (const event of events) this.handleEvent(event)
        if (dt > 0) this.emitContinuous(dt)
        this.particles.update(dt)
        this.texts.update(dt)
        this.shake.update(dt)
        if (dt > 0) {
            for (const bolt of this.bolts) {
                bolt.life -= dt
                if (Math.random() < 0.35) bolt.points = jaggedBolt(bolt.points.filter((_, i, all) => i === 0 || i === all.length - 1 || i % 6 === 0))
            }
            this.bolts = this.bolts.filter(bolt => bolt.life > 0)
        }

        const ctx = this.ctx
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = '#061a2b'
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

        const scale = this.worldScale
        const shake = this.shake.offset()
        ctx.setTransform(scale, 0, 0, scale, this.offsetX * this.ratio + shake.x * scale, this.offsetY * this.ratio + shake.y * scale)
        const minLine = 1.5 / scale

        this.drawSea()
        this.particles.draw(ctx, true, minLine)
        if (this.landLayer) ctx.drawImage(this.landLayer, 0, 0, WORLD_W, WORLD_H)
        this.drawLandOverlays()
        for (const zone of this.sim.zones) if (zone.kind !== 'wave') this.drawZone(zone, minLine)
        this.drawPath(minLine)
        for (const telegraph of this.sim.telegraphs) this.drawTelegraph(telegraph, minLine)
        for (const mine of this.sim.mines) this.drawMine(mine, minLine)
        for (const pickup of this.sim.pickups) this.drawPickup(pickup, minLine)
        this.drawProjectileShadows()
        for (const wreck of this.sim.wrecks) this.drawWreck(wreck)
        this.drawTargetRing(minLine)
        for (const enemy of this.sim.enemies) this.drawEnemy(enemy)
        for (const ally of this.sim.allies) this.drawAlly(ally)
        this.drawPlayer(minLine)
        for (const zone of this.sim.zones) if (zone.kind === 'wave') this.drawZone(zone, minLine)
        this.drawProjectiles(minLine)
        this.particles.draw(ctx, false, minLine)
        this.drawBolts(minLine)
        this.drawHpBars()
        this.texts.draw(ctx)
        this.drawAbilityPreview(minLine)

        // Screen space: vignette over everything.
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalAlpha = 1
        if (this.vignette) ctx.drawImage(this.vignette, 0, 0, this.canvas.width, this.canvas.height)

        if (dt > 0) this.updateQuality(startedAt)
    }

    /**
     * Adaptive quality: first thin the particle budget, then (only on dense
     * screens) the resolution. Recovers when frames are cheap again.
     */
    private updateQuality(startedAt: number) {
        const now = performance.now()
        const cost = now - startedAt
        const interval = this.lastFrameAt ? now - this.lastFrameAt : 16.7
        this.lastFrameAt = now
        this.frameCostAverage += (cost - this.frameCostAverage) * 0.05
        this.frameIntervalAverage += (Math.min(100, interval) - this.frameIntervalAverage) * 0.05
        if (++this.qualityFrames < 45) return
        this.qualityFrames = 0
        const slow = this.frameCostAverage > 9 || this.frameIntervalAverage > 19
        const fast = this.frameCostAverage < 5 && this.frameIntervalAverage < 17.4
        if (slow) {
            if (this.particles.budget > 0.4) this.particles.budget = Math.max(0.35, this.particles.budget - 0.15)
            else if (this.ratio > this.minRatio && now - this.lastResolutionChangeAt > 3000) {
                this.ratio = Math.max(this.minRatio, this.ratio - 0.2)
                this.lastResolutionChangeAt = now
                this.applySize()
            }
        } else if (fast) {
            if (this.ratio < this.maxRatio && now - this.lastResolutionChangeAt > 5000) {
                this.ratio = Math.min(this.maxRatio, this.ratio + 0.2)
                this.lastResolutionChangeAt = now
                this.applySize()
            } else this.particles.budget = Math.min(1, this.particles.budget + 0.05)
        }
    }

    // ─── Events ─────────────────────────────────────────────────────────────

    private handleEvent(event: SimEvent) {
        const ps = this.particles
        switch (event.type) {
            case 'muzzle':
                spawnMuzzle(ps, event.x, event.y, event.angle, event.color, event.size)
                // The Crown of Tides rings the water gold with every shot.
                if (this.sim.player.skinId === 'crown-of-tides' && Math.hypot(event.x - this.sim.player.x, event.y - this.sim.player.y) < 70) {
                    ps.add({ kind: 'ring', x: event.x, y: event.y, life: 0.45, size: 5, grow: 4, color: 0xfacc15, alpha: 0.6, width: 1.8, under: true })
                }
                break
            case 'impact':
                spawnImpact(ps, event.x, event.y, event.color, event.heavy)
                break
            case 'explosion':
                spawnExplosion(ps, event.x, event.y, event.r, event.color, event.heavy)
                break
            case 'splash':
                spawnSplash(ps, event.x, event.y, event.size)
                break
            case 'popup':
                this.texts.add(event.x, event.y, event.text, event.color, event.big)
                break
            case 'lightning':
                if (event.points.length >= 2) this.bolts.push({ points: jaggedBolt(event.points), color: event.color, life: 0.28, maxLife: 0.28 })
                for (const point of event.points.slice(1)) spawnImpact(ps, point.x, point.y, event.color, false)
                break
            case 'shockwave':
                ps.add({ kind: 'ring', x: event.x, y: event.y, life: 0.5, size: event.r * 0.15, grow: 1 / 0.15, color: event.color, alpha: 0.85, width: 5 })
                ps.add({ kind: 'glow', x: event.x, y: event.y, life: 0.35, size: event.r * 0.8, grow: 1.3, color: event.color, alpha: 0.35 })
                break
            case 'burst':
                spawnBurst(ps, event.x, event.y, event.color, event.count)
                break
            case 'heal':
                spawnHeal(ps, event.x, event.y, event.amount)
                break
            case 'shake':
                this.shake.add(event.amount)
                break
            case 'move-marker':
                ps.add({ kind: 'ring', x: event.x, y: event.y, life: 0.55, size: 6, grow: 4, color: 0xecfeff, alpha: 0.85, width: 2.5, under: true })
                ps.add({ kind: 'ring', x: event.x, y: event.y, life: 0.4, size: 3, grow: 3, color: 0xfde68a, alpha: 0.9, width: 2, under: true })
                break
            default:
                break
        }
    }

    /** Wakes, trails, embers and smoke that stream every frame while time moves. */
    private emitContinuous(dt: number) {
        const ps = this.particles
        const sim = this.sim
        const player = sim.player
        const playerDims = playerHull()
        if (player.alive) {
            this.emitWake(`p`, player.x, player.y, player.angle, player.velocity, playerDims.length, playerDims.beam, dt)
            emitSkinTrail(ps, player.skinId, {
                sternX: player.x - Math.cos(player.angle) * playerDims.length * 0.5,
                sternY: player.y - Math.sin(player.angle) * playerDims.length * 0.5,
                angle: player.angle,
                speed: clamp01(player.velocity / 260),
                length: playerDims.length,
                beam: playerDims.beam,
                x: player.x,
                y: player.y
            }, dt, this.time)
            if (player.hp / Math.max(1, player.maxHp) < 0.35 && Math.random() < dt * 8 * ps.budget) {
                spawnSmoke(ps, player.x + rand(-12, 12), player.y + rand(-8, 8), 1, 10, 0x2b2522, 18)
            }
        }
        for (const enemy of sim.enemies) {
            if (enemy.tier.boss === 'kraken') {
                if (enemy.state !== 'submerged' && Math.random() < dt * 10 * ps.budget) {
                    const a = Math.random() * Math.PI * 2
                    const r = enemyHull(enemy.tier.sizeScale ?? 1).length * 0.55
                    ps.add({ kind: 'foam', x: enemy.x + Math.cos(a) * r, y: enemy.y + Math.sin(a) * r, life: 1, size: 8, grow: 2, alpha: 0.5, under: true })
                }
                continue
            }
            const dims = enemyHull(enemy.tier.sizeScale ?? 1)
            this.emitWake(`e${enemy.id}`, enemy.x, enemy.y, enemy.angle, enemy.velocity, dims.length, dims.beam, dt)
            if (enemy.state === 'burning' || enemy.tier.id === 'fireship') {
                const rate = enemy.state === 'burning' ? 40 : 10
                for (let i = ps.scaled(rate * dt); i > 0; i--) {
                    ps.add({ kind: 'glow', x: enemy.x + rand(-dims.length * 0.3, dims.length * 0.3), y: enemy.y + rand(-dims.beam * 0.3, dims.beam * 0.3), vx: rand(-20, 20), vy: rand(-50, -15), life: rand(0.4, 0.8), size: rand(2, 4), color: Math.random() < 0.5 ? 0xf97316 : 0xfde047, drag: 1 })
                }
                if (Math.random() < dt * (enemy.state === 'burning' ? 12 : 4)) spawnSmoke(ps, enemy.x, enemy.y, 1, 11, 0x1c1917, 20)
            } else if (enemy.hp / Math.max(1, enemy.maxHp) < 0.5 && Math.random() < dt * 5 * ps.budget) {
                spawnSmoke(ps, enemy.x + rand(-10, 10), enemy.y + rand(-6, 6), 1, 8, 0x2b2522, 14)
            }
        }
        for (const ally of sim.allies) {
            const dims = playerHull(ally.kind === 'ghost' ? GHOST_SCALE : CONSORT_SCALE)
            this.emitWake(`a${ally.id}`, ally.x, ally.y, ally.angle, ally.velocity, dims.length, dims.beam, dt)
        }
        for (const wreck of sim.wrecks) {
            if (wreck.progress < 0.85 && Math.random() < dt * 14 * ps.budget) {
                ps.add({ kind: 'foam', x: wreck.x + rand(-14, 14), y: wreck.y + rand(-10, 10), life: rand(0.5, 0.9), size: rand(2, 4), grow: 1.8, alpha: 0.7, under: true })
            }
            if (wreck.progress < 0.5 && Math.random() < dt * 6 * ps.budget) spawnSmoke(ps, wreck.x, wreck.y, 1, 12, 0x1f1a17, 20)
        }
        for (const projectile of sim.projectiles) this.emitTrail(projectile, dt)
        for (const island of sim.islands) {
            // The volcano breathes embers and a thread of smoke.
            if (island.kind !== 'volcanic') continue
            if (Math.random() < dt * 1.6 * ps.budget) spawnSmoke(ps, island.x + rand(-6, 6), island.y + rand(-6, 6), 1, 9, 0x2a2523, 8)
            if (Math.random() < dt * 4 * ps.budget) {
                ps.add({ kind: 'spark', x: island.x + rand(-8, 8), y: island.y + rand(-8, 8), vx: rand(-25, 25), vy: rand(-60, -20), life: rand(0.5, 0.9), size: 1.8, color: 0xfb923c, drag: 1.5 })
            }
        }
        for (const zone of sim.zones) {
            if (zone.kind === 'wave') {
                // Spray thrown off the crest as the wave rolls.
                const cos = Math.cos(zone.angle)
                const sin = Math.sin(zone.angle)
                for (let i = ps.scaled(60 * dt); i > 0; i--) {
                    const across = rand(-zone.r, zone.r)
                    const bulge = (1 - (across / zone.r) ** 2) * 26
                    ps.add({
                        kind: 'foam',
                        x: zone.x + cos * bulge - sin * across,
                        y: zone.y + sin * bulge + cos * across,
                        vx: cos * rand(40, 120), vy: sin * rand(40, 120),
                        life: rand(0.4, 0.8), size: rand(4, 8), grow: 1.8, alpha: 0.7, drag: 2
                    })
                }
            } else if (zone.kind === 'maelstrom' || zone.kind === 'whirlpool') {
                for (let i = ps.scaled(24 * dt); i > 0; i--) {
                    const a = Math.random() * Math.PI * 2
                    const d = rand(0.3, 1) * zone.r
                    ps.add({
                        kind: 'foam', x: zone.x + Math.cos(a) * d, y: zone.y + Math.sin(a) * d,
                        vx: Math.cos(a + Math.PI / 2) * 90 - Math.cos(a) * 30, vy: Math.sin(a + Math.PI / 2) * 90 - Math.sin(a) * 30,
                        life: rand(0.5, 0.9), size: rand(3, 6), grow: 1.4, alpha: 0.5, under: true
                    })
                }
            }
        }
    }

    /** Foam in a V behind a moving hull, dropped by distance sailed rather than per frame. */
    private emitWake(key: string, x: number, y: number, angle: number, velocity: number, length: number, beam: number, dt: number) {
        if (velocity < 12) return
        const spacing = 9 / this.particles.budget
        let travelled = (this.wakeDistance.get(key) ?? 0) + velocity * dt
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const sternX = x - cos * length * 0.46
        const sternY = y - sin * length * 0.46
        const strength = clamp01(velocity / 260)
        while (travelled >= spacing) {
            travelled -= spacing
            for (const side of [-1, 1]) {
                addWakeFoam(this.particles, sternX - sin * side * beam * 0.35, sternY + cos * side * beam * 0.35, -sin * side * (18 + strength * 26), cos * side * (18 + strength * 26), 4 + strength * 3, 0.45 + strength * 0.25)
            }
            if (strength > 0.4) addWakeFoam(this.particles, x + cos * length * 0.46, y + sin * length * 0.46, cos * 10, sin * 10, 3, 0.35)
        }
        this.wakeDistance.set(key, travelled)
    }

    private emitTrail(projectile: SimProjectile, dt: number) {
        const ps = this.particles
        const x = projectile.x
        const y = projectile.y - projectile.z
        // The streak drawn with each shot carries the trail; particles only add
        // the occasional mote so the sky doesn't fill with blur.
        const chance = dt * 30 * ps.budget
        if (Math.random() > chance) return
        switch (projectile.trail) {
            case 'smoke':
                if (Math.random() < 0.25) ps.add({ kind: 'smoke', x, y, life: 0.3, size: projectile.size * 0.7, grow: 1.8, color: 0x8a8378, alpha: 0.18 })
                break
            case 'tier':
                if (Math.random() < 0.35) ps.add({ kind: 'glow', x, y, life: 0.2, size: projectile.size * 0.9, grow: 0.4, color: projectile.color, alpha: 0.45 })
                break
            case 'mutated':
                ps.add({ kind: 'glow', x: x + rand(-1.5, 1.5), y: y + rand(-1.5, 1.5), life: 0.35, size: projectile.size * 1.3, grow: 1.6, color: projectile.color, alpha: 0.3 })
                if (Math.random() < 0.3) ps.add({ kind: 'spark', x, y, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.16, size: 1.6, color: projectile.color, drag: 3 })
                break
            case 'gem':
                if (Math.random() < 0.5) ps.add({ kind: 'spark', x, y, vx: rand(-50, 50), vy: rand(-50, 50), life: 0.18, size: 1.6, color: 0xe0f2fe, drag: 3 })
                break
            case 'spectral':
                ps.add({ kind: 'glow', x, y, life: 0.3, size: projectile.size * 1.2, grow: 1.3, color: projectile.color, alpha: 0.3 })
                break
            case 'fire':
                ps.add({ kind: 'hot', x, y, life: 0.2, size: projectile.size * 1.1, grow: 0.6, color: 0xf97316, alpha: 0.6 })
                if (Math.random() < 0.4) ps.add({ kind: 'smoke', x, y, life: 0.5, size: projectile.size * 0.9, grow: 2, color: 0x292524, alpha: 0.35 })
                break
            default:
                break
        }
        if (projectile.kind === 'skiff' && Math.random() < 0.5) {
            ps.add({ kind: 'foam', x: projectile.x - Math.cos(projectile.angle) * 8, y: projectile.y - Math.sin(projectile.angle) * 8, life: 0.7, size: 3, grow: 2.2, alpha: 0.6, under: true })
        }
        if (projectile.kind === 'keg' || projectile.kind === 'bomb' || projectile.kind === 'mortar') {
            ps.add({ kind: 'glow', x: x + rand(-3, 3), y: y - projectile.size, vx: rand(-40, 40), vy: rand(-60, -10), life: 0.25, size: 2, color: 0xfde047, drag: 3 })
        }
    }

    // ─── Sea ────────────────────────────────────────────────────────────────

    private drawSea() {
        const ctx = this.ctx
        if (this.seaLayer) ctx.drawImage(this.seaLayer, 0, 0, WORLD_W, WORLD_H)
        const time = this.time
        const minLine = 1.5 / this.worldScale

        // Slow-moving pools of light: the sun through a thin cloud deck.
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 4; i++) {
            const x = WORLD_W * (0.2 + i * 0.22) + Math.sin(time * 0.05 + i * 1.9) * 260
            const y = WORLD_H * (0.3 + (i % 2) * 0.4) + Math.cos(time * 0.04 + i * 1.3) * 180
            stampGlow(ctx, 0x4fd6d6, x, y, 420, 0.045 + Math.sin(time * 0.3 + i) * 0.012)
        }
        ctx.globalCompositeOperation = 'source-over'

        // Sparse crest glints: short, near-horizontal highlights that fade in and out as they drift.
        ctx.strokeStyle = '#eafcff'
        ctx.lineCap = 'round'
        ctx.lineWidth = Math.max(minLine, 1.6)
        for (const glint of this.glints) {
            const pulse = Math.sin(time * glint.speed + glint.phase)
            if (pulse < 0.35) continue
            const x = (glint.x + time * 5 * glint.speed) % WORLD_W
            const half = glint.length / 2
            const dx = Math.cos(glint.tilt) * half
            const dy = Math.sin(glint.tilt) * half
            ctx.globalAlpha = (pulse - 0.35) * 0.7
            ctx.beginPath()
            ctx.moveTo(x - dx, glint.y - dy)
            ctx.quadraticCurveTo(x, glint.y - 1.2, x + dx, glint.y + dy)
            ctx.stroke()
        }
        ctx.globalAlpha = 1

        // Surf: a soft foam band breathing around each coast. The land layer
        // covers the inner half, so it reads as foam hugging the beach.
        ctx.lineJoin = 'round'
        for (const island of this.sim.islands) {
            const breathe = Math.sin(time * 1.1 + island.seed) * 0.018
            ctx.strokeStyle = 'rgba(235,250,255,0.1)'
            ctx.lineWidth = Math.max(minLine, 11)
            this.coastPath(ctx, island, 1.06 + breathe)
            ctx.stroke()
            ctx.strokeStyle = 'rgba(245,252,255,0.28)'
            ctx.lineWidth = Math.max(minLine, 5)
            this.coastPath(ctx, island, 1.045 + breathe * 1.4)
            ctx.stroke()
            ctx.strokeStyle = 'rgba(255,255,255,0.4)'
            ctx.lineWidth = Math.max(minLine, 2)
            this.coastPath(ctx, island, 1.035 + Math.sin(time * 1.5 + island.seed * 3) * 0.012)
            ctx.stroke()
        }
    }

    /** Living details on top of the baked land: the volcano's pulsing lava glow. */
    private drawLandOverlays() {
        const ctx = this.ctx
        for (const island of this.sim.islands) {
            if (island.kind !== 'volcanic') continue
            const pulse = 0.7 + Math.sin(this.time * 2.1 + island.seed) * 0.2 + Math.sin(this.time * 5.3) * 0.1
            ctx.globalCompositeOperation = 'lighter'
            stampGlow(ctx, 0xf97316, island.x, island.y, island.r * 0.6, 0.3 * pulse)
            stampGlow(ctx, 0xfde047, island.x, island.y, island.r * 0.2, 0.5 * pulse, true)
            ctx.globalCompositeOperation = 'source-over'
        }
    }

    private drawPath(minLine: number) {
        const player = this.sim.player
        if (!this.sim.running || !player.path.length || player.attackTargetId !== null) return
        const ctx = this.ctx
        ctx.strokeStyle = 'rgba(236,254,255,0.35)'
        ctx.lineWidth = Math.max(minLine, 2)
        ctx.setLineDash([6, 8])
        ctx.lineDashOffset = -this.time * 20
        ctx.beginPath()
        ctx.moveTo(player.x, player.y)
        for (const point of player.path) ctx.lineTo(point.x, point.y)
        ctx.stroke()
        ctx.setLineDash([])
        const end = player.path[player.path.length - 1]!
        ctx.strokeStyle = 'rgba(253,230,138,0.7)'
        ctx.beginPath()
        ctx.arc(end.x, end.y, 7 + Math.sin(this.time * 5) * 1.5, 0, Math.PI * 2)
        ctx.stroke()
    }

    // ─── Zones and telegraphs ───────────────────────────────────────────────

    private drawZone(zone: SimZone, minLine: number) {
        const ctx = this.ctx
        const t = zone.durationMs > 0 ? clamp01(zone.ageMs / zone.durationMs) : 0
        // Ease in over the first 300ms and out over the last 400ms.
        const fade = Math.min(1, zone.ageMs / 300, Math.max(0, zone.durationMs - zone.ageMs) / 400)
        const time = this.time
        ctx.save()
        ctx.translate(zone.x, zone.y)
        switch (zone.kind) {
            case 'maelstrom':
            case 'whirlpool': {
                const hostile = zone.kind === 'whirlpool'
                const color = hostile ? 0xa855f7 : 0x22d3ee
                const dark = hostile ? 'rgba(30,6,50,0.55)' : 'rgba(4,30,60,0.55)'
                const grow = 0.3 + easeOutBack(Math.min(1, zone.ageMs / 450)) * 0.7
                const r = zone.r * grow
                const depth = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
                depth.addColorStop(0, dark)
                depth.addColorStop(0.7, rgba(color, 0.12 * fade))
                depth.addColorStop(1, rgba(color, 0))
                ctx.globalAlpha = fade
                ctx.fillStyle = depth
                ctx.beginPath()
                ctx.arc(0, 0, r, 0, Math.PI * 2)
                ctx.fill()
                // Spiral arms turning inward.
                ctx.strokeStyle = css(shade(color, 0.3))
                ctx.lineCap = 'round'
                for (let arm = 0; arm < 4; arm++) {
                    ctx.lineWidth = Math.max(minLine, 4 - arm * 0.5)
                    ctx.globalAlpha = fade * 0.55
                    ctx.beginPath()
                    for (let s = 0; s <= 30; s++) {
                        const u = s / 30
                        const a = arm / 4 * Math.PI * 2 + time * (hostile ? -3 : 3) + u * 4.2
                        const d = r * (1 - u * 0.88)
                        if (s === 0) ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d)
                        else ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d)
                    }
                    ctx.stroke()
                }
                ctx.globalCompositeOperation = 'lighter'
                stampGlow(ctx, color, 0, 0, r * 0.6, 0.3 * fade)
                ctx.globalCompositeOperation = 'source-over'
                ctx.globalAlpha = fade * 0.8
                ctx.strokeStyle = css(color)
                ctx.lineWidth = Math.max(minLine, 2.5)
                ctx.beginPath()
                ctx.arc(0, 0, r, 0, Math.PI * 2)
                ctx.stroke()
                break
            }
            case 'hellfire': {
                ctx.globalAlpha = fade
                ctx.fillStyle = 'rgba(234,88,12,0.07)'
                ctx.beginPath()
                ctx.arc(0, 0, zone.r, 0, Math.PI * 2)
                ctx.fill()
                ctx.strokeStyle = '#fb923c'
                ctx.lineWidth = Math.max(minLine, 3)
                ctx.setLineDash([16, 10])
                ctx.lineDashOffset = time * 30
                ctx.stroke()
                ctx.setLineDash([])
                ctx.globalCompositeOperation = 'lighter'
                for (let i = 0; i < 16; i++) {
                    const a = i / 16 * Math.PI * 2 + time * 0.4
                    stampGlow(ctx, 0xf97316, Math.cos(a) * zone.r, Math.sin(a) * zone.r, 14, 0.4 * fade * (0.6 + Math.sin(time * 6 + i) * 0.4))
                }
                ctx.globalCompositeOperation = 'source-over'
                break
            }
            case 'wave': {
                // A curved wall of water: deep blue body, white foaming crest.
                ctx.rotate(zone.angle)
                ctx.globalAlpha = fade
                const half = zone.r
                const body = ctx.createLinearGradient(-50, 0, 30, 0)
                body.addColorStop(0, 'rgba(56,189,248,0)')
                body.addColorStop(0.55, 'rgba(56,189,248,0.45)')
                body.addColorStop(0.85, 'rgba(186,230,253,0.8)')
                body.addColorStop(1, 'rgba(255,255,255,0.95)')
                ctx.fillStyle = body
                ctx.beginPath()
                ctx.moveTo(-50, -half)
                for (let i = 0; i <= 24; i++) {
                    const across = -half + i / 24 * half * 2
                    const bulge = (1 - (across / half) ** 2) * 26 + Math.sin(time * 8 + i) * 2
                    ctx.lineTo(bulge, across)
                }
                ctx.lineTo(-50, half)
                ctx.quadraticCurveTo(-30, 0, -50, -half)
                ctx.fill()
                ctx.strokeStyle = 'rgba(255,255,255,0.9)'
                ctx.lineWidth = Math.max(minLine, 4)
                ctx.beginPath()
                for (let i = 0; i <= 24; i++) {
                    const across = -half + i / 24 * half * 2
                    const bulge = (1 - (across / half) ** 2) * 26 + Math.sin(time * 8 + i) * 2
                    if (i === 0) ctx.moveTo(bulge, across)
                    else ctx.lineTo(bulge, across)
                }
                ctx.stroke()
                ctx.globalCompositeOperation = 'lighter'
                stampGlow(ctx, 0x7dd3fc, 10, 0, half * 0.8, 0.2 * fade)
                ctx.globalCompositeOperation = 'source-over'
                break
            }
            case 'ink': {
                // An inky cloud that darkens the water beneath it.
                ctx.globalAlpha = fade
                const random = seededRandom(zone.id * 131)
                for (let i = 0; i < 8; i++) {
                    const a = random() * Math.PI * 2 + time * 0.2 * (i % 2 ? 1 : -1)
                    const d = random() * zone.r * 0.5
                    const r = zone.r * (0.45 + random() * 0.35)
                    const g = ctx.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, r)
                    g.addColorStop(0, 'rgba(12,4,24,0.6)')
                    g.addColorStop(0.6, 'rgba(30,10,50,0.35)')
                    g.addColorStop(1, 'rgba(30,10,50,0)')
                    ctx.fillStyle = g
                    ctx.beginPath()
                    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, Math.PI * 2)
                    ctx.fill()
                }
                break
            }
            case 'ward': {
                const r = zone.r * (0.2 + t * 0.8)
                ctx.globalAlpha = (1 - t) * 0.9
                ctx.strokeStyle = '#67e8f9'
                ctx.lineWidth = Math.max(minLine, 5 * (1 - t) + 1)
                ctx.beginPath()
                ctx.arc(0, 0, r, 0, Math.PI * 2)
                ctx.stroke()
                ctx.globalCompositeOperation = 'lighter'
                stampGlow(ctx, 0x22d3ee, 0, 0, r, 0.25 * (1 - t))
                ctx.globalCompositeOperation = 'source-over'
                break
            }
        }
        ctx.restore()
        ctx.globalAlpha = 1
    }

    private drawTelegraph(telegraph: SimTelegraph, minLine: number) {
        const ctx = this.ctx
        const p = clamp01(telegraph.ageMs / Math.max(1, telegraph.durationMs))
        const pulse = 0.65 + Math.sin(this.time * (8 + p * 14)) * 0.35
        const color = telegraph.color
        ctx.save()
        if (telegraph.kind === 'circle') {
            ctx.translate(telegraph.x, telegraph.y)
            const intro = Math.min(1, telegraph.ageMs / 220)
            const r = telegraph.r * (0.5 + intro * 0.5)
            ctx.fillStyle = rgba(color, 0.08 + p * 0.08)
            ctx.beginPath()
            ctx.arc(0, 0, r, 0, Math.PI * 2)
            ctx.fill()
            // The fill closes in on impact.
            ctx.fillStyle = rgba(color, 0.18 + p * 0.14)
            ctx.beginPath()
            ctx.arc(0, 0, r * p, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = rgba(color, 0.55 + pulse * 0.4)
            ctx.lineWidth = Math.max(minLine, telegraph.hostile ? 3 : 2.5)
            ctx.beginPath()
            ctx.arc(0, 0, r, 0, Math.PI * 2)
            ctx.stroke()
            if (telegraph.hostile) {
                ctx.strokeStyle = rgba(0xfef2f2, 0.7)
                ctx.lineWidth = Math.max(minLine, 1.8)
                ctx.beginPath()
                ctx.moveTo(-8, 0)
                ctx.lineTo(8, 0)
                ctx.moveTo(0, -8)
                ctx.lineTo(0, 8)
                ctx.stroke()
            }
        } else if (telegraph.kind === 'line') {
            const dx = telegraph.x2 - telegraph.x
            const dy = telegraph.y2 - telegraph.y
            const length = Math.hypot(dx, dy)
            ctx.translate(telegraph.x, telegraph.y)
            ctx.rotate(Math.atan2(dy, dx))
            const half = Math.max(telegraph.width, 6) / 2
            ctx.fillStyle = rgba(color, 0.08 + p * 0.1)
            ctx.fillRect(0, -half, length, half * 2)
            ctx.fillStyle = rgba(color, 0.22 + p * 0.1)
            ctx.fillRect(0, -half, length * p, half * 2)
            ctx.strokeStyle = rgba(color, 0.5 + pulse * 0.4)
            ctx.lineWidth = Math.max(minLine, 1.8)
            ctx.beginPath()
            ctx.moveTo(0, -half)
            ctx.lineTo(length, -half)
            ctx.moveTo(0, half)
            ctx.lineTo(length, half)
            ctx.stroke()
        } else {
            // Sniper reticle: brackets tightening onto the point.
            ctx.translate(telegraph.x, telegraph.y)
            ctx.rotate(p * Math.PI / 2)
            const r = telegraph.r * (1.8 - p * 0.8)
            ctx.strokeStyle = rgba(color, 0.7 + pulse * 0.3)
            ctx.lineWidth = Math.max(minLine, 3)
            for (let i = 0; i < 4; i++) {
                ctx.rotate(Math.PI / 2)
                ctx.beginPath()
                ctx.moveTo(r, -r * 0.35)
                ctx.lineTo(r, -r)
                ctx.lineTo(r * 0.65, -r)
                ctx.stroke()
            }
            ctx.fillStyle = rgba(color, 0.12 + p * 0.12)
            ctx.beginPath()
            ctx.arc(0, 0, telegraph.r, 0, Math.PI * 2)
            ctx.fill()
        }
        ctx.restore()
    }

    // ─── Pickups and mines ──────────────────────────────────────────────────

    private drawPickup(pickup: SimPickup, minLine: number) {
        const ctx = this.ctx
        const remaining = pickup.lifespanMs - pickup.ageMs
        // Blink out over the last three seconds.
        if (remaining < 3000 && Math.sin(this.time * (remaining < 1200 ? 30 : 16)) < -0.2) return
        const spawn = Math.min(1, pickup.ageMs / 350)
        const scale = easeOutBack(spawn)
        const bob = Math.sin(this.time * 2.4 + pickup.id) * 2.5
        const x = pickup.x
        const y = pickup.y + bob
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(scale, scale)
        if (pickup.kind === 'repair') {
            ctx.globalCompositeOperation = 'lighter'
            stampGlow(ctx, 0x22c55e, 0, 0, 44, 0.45 + Math.sin(this.time * 4) * 0.12)
            ctx.globalCompositeOperation = 'source-over'
            ctx.fillStyle = 'rgba(2,20,30,0.3)'
            ctx.beginPath()
            ctx.arc(3, 4, 15, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#f8fafc'
            ctx.beginPath()
            ctx.arc(0, 0, 15, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#16a34a'
            ctx.lineWidth = Math.max(minLine, 3)
            ctx.stroke()
            ctx.fillStyle = '#16a34a'
            ctx.fillRect(-3.5, -9, 7, 18)
            ctx.fillRect(-9, -3.5, 18, 7)
            ctx.restore()
            return
        }

        const rarity = pickup.rarity ?? 'common'
        const color = RARITY_COLOR.get(rarity) ?? 0xa1a1aa
        const grand = rarity === 'epic' || rarity === 'legendary'
        const pulse = 0.75 + Math.sin(this.time * 3.5 + pickup.id) * 0.25
        // Ripples where the crate rides the swell.
        ctx.strokeStyle = 'rgba(235,250,255,0.22)'
        ctx.lineWidth = Math.max(minLine, 1.5)
        const ripple = (this.time * 0.5 + pickup.id * 0.3) % 1
        ctx.globalAlpha = 1 - ripple
        ctx.beginPath()
        ctx.ellipse(0, 2, 16 + ripple * 16, 11 + ripple * 11, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'lighter'
        stampGlow(ctx, color, 0, 0, grand ? 60 : 42, (grand ? 0.55 : 0.4) * pulse)
        if (grand) {
            // A shaft of light straight up from the crate, with motes rising in it.
            const beam = ctx.createLinearGradient(0, 0, 0, -140)
            beam.addColorStop(0, rgba(color, 0.45 * pulse))
            beam.addColorStop(0.5, rgba(color, 0.18 * pulse))
            beam.addColorStop(1, rgba(color, 0))
            ctx.fillStyle = beam
            ctx.beginPath()
            ctx.moveTo(-7, 0)
            ctx.lineTo(7, 0)
            ctx.lineTo(12, -140)
            ctx.lineTo(-12, -140)
            ctx.closePath()
            ctx.fill()
            const core = ctx.createLinearGradient(0, 0, 0, -120)
            core.addColorStop(0, rgba(0xffffff, 0.5 * pulse))
            core.addColorStop(1, rgba(0xffffff, 0))
            ctx.fillStyle = core
            ctx.fillRect(-1.5, -120, 3, 120)
            for (let i = 0; i < 5; i++) {
                const t = (this.time * 0.5 + i / 5) % 1
                stampGlow(ctx, mix(color, 0xffffff, 0.4), Math.sin(i * 2.3 + this.time * 1.5) * 7, -t * 120, 4, (1 - t) * 0.9, true)
            }
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.rotate(Math.sin(this.time * 1.6 + pickup.id) * 0.1)
        // Shadow on the water.
        ctx.fillStyle = 'rgba(2,14,28,0.3)'
        ctx.fillRect(-11, -10, 28, 27)
        // A wooden crate: planks, dark edge, rarity-coloured iron corners and a sealed emblem.
        const size = 14
        const wood = ctx.createLinearGradient(-size, -size, size, size)
        wood.addColorStop(0, '#c58b52')
        wood.addColorStop(0.5, '#9c6432')
        wood.addColorStop(1, '#6a4021')
        ctx.fillStyle = wood
        ctx.fillRect(-size, -size, size * 2, size * 2)
        ctx.strokeStyle = 'rgba(40,22,10,0.7)'
        ctx.lineWidth = Math.max(minLine, 1.2)
        ctx.beginPath()
        for (let i = 1; i < 3; i++) {
            ctx.moveTo(-size, -size + i * size * 2 / 3)
            ctx.lineTo(size, -size + i * size * 2 / 3)
        }
        ctx.stroke()
        ctx.strokeStyle = '#2a1708'
        ctx.lineWidth = Math.max(minLine, 2.2)
        ctx.strokeRect(-size, -size, size * 2, size * 2)
        // Iron corner brackets in the rarity colour.
        ctx.fillStyle = css(color)
        ctx.strokeStyle = css(shade(color, -0.55))
        ctx.lineWidth = Math.max(minLine, 1)
        const arm = size * 0.55
        const thick = size * 0.24
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            ctx.beginPath()
            ctx.moveTo(sx * size, sy * size)
            ctx.lineTo(sx * (size - arm), sy * size)
            ctx.lineTo(sx * (size - arm), sy * (size - thick))
            ctx.lineTo(sx * (size - thick), sy * (size - thick))
            ctx.lineTo(sx * (size - thick), sy * (size - arm))
            ctx.lineTo(sx * size, sy * (size - arm))
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        // Rope around the middle.
        ctx.strokeStyle = '#3b2412'
        ctx.lineWidth = Math.max(minLine, 3)
        ctx.beginPath()
        ctx.moveTo(-size, 0)
        ctx.lineTo(size, 0)
        ctx.stroke()
        ctx.strokeStyle = '#d9b27a'
        ctx.lineWidth = Math.max(minLine, 1.4)
        ctx.setLineDash([2.5, 2])
        ctx.stroke()
        ctx.setLineDash([])
        // The seal: a lit gem in the rarity colour.
        ctx.fillStyle = css(shade(color, -0.4))
        ctx.beginPath()
        ctx.moveTo(0, -6)
        ctx.lineTo(6, 0)
        ctx.lineTo(0, 6)
        ctx.lineTo(-6, 0)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = css(shade(color, 0.25))
        ctx.beginPath()
        ctx.moveTo(0, -4)
        ctx.lineTo(4, 0)
        ctx.lineTo(0, 4)
        ctx.lineTo(-4, 0)
        ctx.closePath()
        ctx.fill()
        ctx.globalCompositeOperation = 'lighter'
        stampGlow(ctx, color, 0, 0, 9, 0.6 * pulse, true)
        ctx.globalCompositeOperation = 'source-over'
        ctx.restore()

        // Name label in the rarity colour.
        if (pickup.powerUpId) {
            const name = piratePowerUp(pickup.powerUpId).name.toUpperCase()
            ctx.font = '900 12px ui-sans-serif, system-ui, sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.lineJoin = 'round'
            ctx.lineWidth = 4
            ctx.strokeStyle = 'rgba(8,12,24,0.85)'
            ctx.globalAlpha = Math.min(1, spawn * 1.5)
            ctx.strokeText(name, x, y - 30)
            ctx.fillStyle = css(color)
            ctx.fillText(name, x, y - 30)
            ctx.globalAlpha = 1
        }
    }

    private drawMine(mine: SimSeaMine, minLine: number) {
        const ctx = this.ctx
        const spawn = easeOutBack(Math.min(1, mine.ageMs / 350))
        const fadeOut = Math.min(1, (mine.lifespanMs - mine.ageMs) / 450)
        const bob = Math.sin(this.time * 2 + mine.id) * 1.5
        const pulse = 0.5 + Math.sin(this.time * 2.4 + mine.id) * 0.5
        ctx.save()
        ctx.translate(mine.x, mine.y + bob)
        ctx.globalAlpha = Math.max(0, fadeOut)
        ctx.scale(spawn, spawn)
        // Danger radius: a faint red disc with a soft rim that swells slowly.
        const danger = ctx.createRadialGradient(0, 0, 10, 0, 0, 48)
        danger.addColorStop(0, 'rgba(239,68,68,0.02)')
        danger.addColorStop(0.75, 'rgba(239,68,68,0.06)')
        danger.addColorStop(1, 'rgba(239,68,68,0.14)')
        ctx.fillStyle = danger
        ctx.beginPath()
        ctx.arc(0, 0, 48, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = rgba(0xf87171, 0.2 + pulse * 0.15)
        ctx.lineWidth = Math.max(minLine, 1.5)
        ctx.beginPath()
        ctx.arc(0, 0, 46 + pulse * 2, 0, Math.PI * 2)
        ctx.stroke()
        // Ripple and shadow.
        ctx.strokeStyle = 'rgba(235,250,255,0.18)'
        ctx.beginPath()
        ctx.ellipse(0, 2, 17, 12, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = 'rgba(2,14,28,0.35)'
        ctx.beginPath()
        ctx.ellipse(3, 5, 14, 11, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.rotate(this.time * 0.35 + mine.id)
        // Spikes: dark cones with a lit edge.
        for (let i = 0; i < 8; i++) {
            const a = i / 8 * Math.PI * 2
            const cos = Math.cos(a)
            const sin = Math.sin(a)
            ctx.fillStyle = '#2a2523'
            ctx.beginPath()
            ctx.moveTo(cos * 9 - sin * 3, sin * 9 + cos * 3)
            ctx.lineTo(cos * 19, sin * 19)
            ctx.lineTo(cos * 9 + sin * 3, sin * 9 - cos * 3)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = '#6b625c'
            ctx.lineWidth = Math.max(minLine, 0.9)
            ctx.beginPath()
            ctx.moveTo(cos * 9 - sin * 3, sin * 9 + cos * 3)
            ctx.lineTo(cos * 19, sin * 19)
            ctx.stroke()
        }
        // The body: a rusted iron sphere, sun on the upper left.
        const body = ctx.createRadialGradient(-4.5, -4.5, 1, 0, 0, 13)
        body.addColorStop(0, '#8a7f78')
        body.addColorStop(0.5, '#3f3835')
        body.addColorStop(1, '#141110')
        ctx.fillStyle = body
        ctx.beginPath()
        ctx.arc(0, 0, 12, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#0c0a09'
        ctx.lineWidth = Math.max(minLine, 1.4)
        ctx.stroke()
        // Rivet band.
        ctx.strokeStyle = 'rgba(160,150,140,0.35)'
        ctx.lineWidth = Math.max(minLine, 1)
        ctx.beginPath()
        ctx.arc(0, 0, 8, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
        // Blinking fuse lamp on top.
        const blink = Math.sin(this.time * 6 + mine.id) > 0.3
        ctx.fillStyle = blink ? '#fca5a5' : '#7f1d1d'
        ctx.beginPath()
        ctx.arc(mine.x, mine.y + bob, 2.6 * spawn, 0, Math.PI * 2)
        ctx.fill()
        if (blink) {
            ctx.globalCompositeOperation = 'lighter'
            stampGlow(ctx, 0xef4444, mine.x, mine.y + bob, 14, 0.8 * Math.max(0, fadeOut), true)
            ctx.globalCompositeOperation = 'source-over'
        }
        ctx.globalAlpha = 1
    }

    // ─── Ships ──────────────────────────────────────────────────────────────

    private lookForEnemy(enemy: SimEnemy) {
        const id = enemy.tier.id
        if (enemy.summoned) {
            let look = this.summonedLooks.get(id)
            if (!look) {
                const base = enemyLook(id)
                look = { ...base, spectral: true, palette: { hull: 0x0f3b33, deck: 0x1d5a4d, trim: 0x99f6e4, sail: 0x5eead4, accent: 0x2dd4bf, glow: true } }
                this.summonedLooks.set(id, look)
            }
            return look
        }
        let look = this.enemyLooks.get(id)
        if (!look) {
            look = enemyLook(id)
            this.enemyLooks.set(id, look)
        }
        return look
    }

    private consortLook(skinId: string): ShipLook {
        const base = skinLook(skinId)
        const tint = (color: number) => mix(color, 0x60a5fa, 0.55)
        return {
            ...base,
            kind: 'ally',
            spectral: true,
            sizeScale: CONSORT_SCALE,
            palette: { hull: tint(base.palette.hull), deck: tint(base.palette.deck), trim: 0xbfdbfe, sail: tint(base.palette.sail), accent: 0x93c5fd, glow: true }
        }
    }

    private readonly ghostLook: ShipLook = {
        kind: 'ally',
        spectral: true,
        sizeScale: GHOST_SCALE,
        skinId: 'starter',
        palette: { hull: 0x2e1065, deck: 0x4c1d95, trim: 0xddd6fe, sail: 0xc4b5fd, accent: 0xa78bfa, glow: true }
    }

    private drawEnemy(enemy: SimEnemy) {
        const ctx = this.ctx
        const spawn = Math.min(1, enemy.ageMs / 420)
        const damage = 1 - enemy.hp / Math.max(1, enemy.maxHp)
        const flash = Math.min(1, enemy.flashMs / 140)
        if (enemy.tier.boss === 'kraken') {
            drawKraken(ctx, {
                x: enemy.x,
                y: enemy.y,
                time: this.time,
                hpFrac: 1 - damage,
                state: enemy.state,
                stateMs: enemy.stateMs,
                tentacles: enemy.tentacles,
                flash,
                alpha: Math.min(1, spawn * 2)
            })
            if (krakenEmergence(enemy.state, enemy.stateMs) > 0.5) this.drawBossAura(enemy, 0x7c3aed)
            return
        }
        let alpha = 1
        if (enemy.state === 'blinking') alpha = 0.15 + Math.abs(Math.sin(this.time * 18)) * 0.2
        if (enemy.tier.boss) this.drawBossAura(enemy, enemy.tier.boss === 'phantom' ? 0x5eead4 : 0xdc2626)
        const scale = spawn < 1 ? easeOutBack(spawn) : 1
        if (enemy.state === 'burning') {
            // The fuse is lit: a hot pulsing ring so the player knows to run.
            const pulse = 0.5 + Math.sin(this.time * 20) * 0.5
            ctx.strokeStyle = rgba(0xf97316, 0.4 + pulse * 0.5)
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(enemy.x, enemy.y, 40 + pulse * 6, 0, Math.PI * 2)
            ctx.stroke()
        }
        ctx.save()
        ctx.translate(enemy.x, enemy.y)
        ctx.scale(scale, scale)
        drawShip(ctx, this.lookForEnemy(enemy), {
            x: 0,
            y: 0,
            angle: enemy.angle,
            time: this.time,
            guns: enemy.guns,
            flash,
            damage,
            alpha,
            velocity: enemy.velocity
        })
        ctx.restore()
        if (enemy.shield > 0) {
            const r = hullHitRadius(enemyHull(enemy.tier.sizeScale ?? 1)) * 1.3
            ctx.globalCompositeOperation = 'lighter'
            stampGlow(ctx, 0x22d3ee, enemy.x, enemy.y, r * 1.4, 0.25 + Math.sin(this.time * 4) * 0.08)
            ctx.globalCompositeOperation = 'source-over'
            ctx.strokeStyle = rgba(0x67e8f9, 0.6)
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(enemy.x, enemy.y, r, 0, Math.PI * 2)
            ctx.stroke()
        }
    }

    private drawBossAura(enemy: SimEnemy, color: number) {
        const ctx = this.ctx
        const r = enemyHull(enemy.tier.sizeScale ?? 1).length * 0.8
        const pulse = 0.75 + Math.sin(this.time * 2.2) * 0.25
        ctx.globalCompositeOperation = 'lighter'
        stampGlow(ctx, color, enemy.x, enemy.y, r * 1.3, 0.3 * pulse)
        ctx.globalCompositeOperation = 'source-over'
        // A slowly turning ring of three arcs, no dashes.
        ctx.strokeStyle = rgba(color, 0.45 * pulse)
        ctx.lineWidth = 2.5
        ctx.lineCap = 'round'
        for (let i = 0; i < 3; i++) {
            const a = this.time * 0.8 + i / 3 * Math.PI * 2
            ctx.beginPath()
            ctx.arc(enemy.x, enemy.y, r * (1 + pulse * 0.05), a, a + 1.5)
            ctx.stroke()
        }
    }

    private drawAlly(ally: SimAlly) {
        const ctx = this.ctx
        const spawn = Math.min(1, ally.ageMs / 400)
        const scale = spawn < 1 ? easeOutBack(spawn) : 1
        const look = ally.kind === 'ghost' ? this.ghostLook : this.consortLook(this.sim.player.skinId)
        ctx.save()
        ctx.translate(ally.x, ally.y)
        ctx.scale(scale, scale)
        ctx.globalCompositeOperation = 'lighter'
        stampGlow(ctx, ally.kind === 'ghost' ? 0x8b5cf6 : 0x3b82f6, 0, 0, 46, 0.25 + Math.sin(this.time * 3 + ally.id) * 0.08)
        ctx.globalCompositeOperation = 'source-over'
        drawShip(ctx, look, {
            x: 0,
            y: 0,
            angle: ally.angle,
            time: this.time,
            guns: ally.guns,
            flash: Math.min(1, ally.flashMs / 140),
            damage: 1 - ally.hp / Math.max(1, ally.maxHp),
            alpha: 1,
            velocity: ally.velocity
        })
        ctx.restore()
        if (ally.kind === 'consort' && ally.hp < ally.maxHp) this.drawBar(ally.x, ally.y - 34, 36, ally.hp / Math.max(1, ally.maxHp), 0, 0x93c5fd)
    }

    private drawPlayer(minLine: number) {
        const ctx = this.ctx
        const player = this.sim.player
        if (!player.alive) return
        const dims = playerHull()
        const radius = hullHitRadius(dims)

        // Tether rope from the harpooner.
        if (player.tetherMs > 0 && player.tetherFrom !== null) {
            const from = this.sim.enemies.find(enemy => enemy.id === player.tetherFrom)
            if (from) this.drawRope(from.x, from.y, player.x, player.y, minLine, 0.9)
        }

        // Selection ring on the water: barely there, just enough to find the ship.
        ctx.strokeStyle = 'rgba(253,230,138,0.09)'
        ctx.lineWidth = Math.max(minLine, 1.4)
        ctx.beginPath()
        ctx.arc(player.x, player.y, radius * 1.35, 0, Math.PI * 2)
        ctx.stroke()

        if ((this.sim.powerUpStacks.get('krakens-heart') ?? 0) > 0) {
            ctx.globalCompositeOperation = 'lighter'
            stampGlow(ctx, 0xe11d48, player.x, player.y, radius * 2.4, 0.22 + Math.sin(this.time * 3.2) * 0.08)
            ctx.globalCompositeOperation = 'source-over'
        }

        drawShip(ctx, skinLook(player.skinId), {
            x: player.x,
            y: player.y,
            angle: player.angle,
            time: this.time,
            guns: player.guns,
            flash: Math.min(1, player.flashMs / 160),
            damage: 1 - player.hp / Math.max(1, player.maxHp),
            alpha: 1,
            velocity: player.velocity
        })

        // Hunter's Chain warheads in orbit.
        if (player.warheads > 0) {
            ctx.globalCompositeOperation = 'lighter'
            for (let i = 0; i < player.warheads; i++) {
                const a = player.warheadSpin + i / player.warheads * Math.PI * 2
                const x = player.x + Math.cos(a) * 78
                const y = player.y + Math.sin(a) * 78
                stampGlow(ctx, 0xfb7185, x, y, 14, 0.7)
                ctx.globalCompositeOperation = 'source-over'
                ctx.save()
                ctx.translate(x, y)
                ctx.rotate(a + Math.PI / 2)
                ctx.fillStyle = '#fecdd3'
                ctx.beginPath()
                ctx.moveTo(8, 0)
                ctx.lineTo(-5, -4)
                ctx.lineTo(-3, 0)
                ctx.lineTo(-5, 4)
                ctx.closePath()
                ctx.fill()
                ctx.restore()
                ctx.globalCompositeOperation = 'lighter'
            }
            ctx.globalCompositeOperation = 'source-over'
        }

        // Shield bubble with a shimmering hex lattice.
        if (player.shield > 0 && player.maxShield > 0) {
            const strength = clamp01(player.shield / player.maxShield)
            const r = radius * 1.55
            const bubble = ctx.createRadialGradient(player.x, player.y, r * 0.6, player.x, player.y, r)
            bubble.addColorStop(0, 'rgba(34,211,238,0)')
            bubble.addColorStop(0.85, rgba(0x22d3ee, 0.12 + strength * 0.12))
            bubble.addColorStop(1, rgba(0xa5f3fc, 0.35 + strength * 0.25))
            ctx.fillStyle = bubble
            ctx.beginPath()
            ctx.arc(player.x, player.y, r, 0, Math.PI * 2)
            ctx.fill()
            ctx.save()
            ctx.beginPath()
            ctx.arc(player.x, player.y, r, 0, Math.PI * 2)
            ctx.clip()
            ctx.strokeStyle = rgba(0xa5f3fc, 0.12 + strength * 0.14)
            ctx.lineWidth = Math.max(minLine, 1.2)
            const hex = 12
            const shift = (this.time * 8) % (hex * 1.5)
            ctx.beginPath()
            for (let row = -5; row <= 5; row++) {
                for (let col = -5; col <= 5; col++) {
                    const cx = player.x + col * hex * 1.5 + shift
                    const cy = player.y + row * hex * 1.732 + (col % 2 ? hex * 0.866 : 0)
                    for (let k = 0; k < 6; k++) {
                        const a = k / 6 * Math.PI * 2
                        const px = cx + Math.cos(a) * hex * 0.9
                        const py = cy + Math.sin(a) * hex * 0.9
                        if (k === 0) ctx.moveTo(px, py)
                        else ctx.lineTo(px, py)
                    }
                    ctx.closePath()
                }
            }
            ctx.stroke()
            ctx.restore()
            ctx.strokeStyle = rgba(0xcffafe, 0.5 + strength * 0.4)
            ctx.lineWidth = Math.max(minLine, 2)
            ctx.beginPath()
            ctx.arc(player.x, player.y, r, 0, Math.PI * 2)
            ctx.stroke()
        }
    }

    private drawRope(ax: number, ay: number, bx: number, by: number, minLine: number, alpha: number) {
        const ctx = this.ctx
        const mx = (ax + bx) / 2
        const my = (ay + by) / 2 + Math.min(40, Math.hypot(bx - ax, by - ay) * 0.12) + Math.sin(this.time * 4) * 3
        ctx.globalAlpha = alpha
        ctx.strokeStyle = '#3f2a18'
        ctx.lineWidth = Math.max(minLine, 3)
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.quadraticCurveTo(mx, my, bx, by)
        ctx.stroke()
        ctx.strokeStyle = '#c8a878'
        ctx.lineWidth = Math.max(minLine * 0.8, 1.2)
        ctx.setLineDash([4, 4])
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
    }

    private drawWreck(wreck: SimWreck) {
        const ctx = this.ctx
        const p = clamp01(wreck.progress)
        if (wreck.boss === 'kraken') {
            drawKraken(ctx, { x: wreck.x, y: wreck.y, time: this.time, hpFrac: 0, state: 'diving', stateMs: (1 - p) * 900, tentacles: [], flash: 0, alpha: 1 - p })
            return
        }
        let look: ShipLook
        if (wreck.side === 'enemy') look = enemyLook(wreck.tierId ?? 'sloop')
        else if (wreck.side === 'ally') look = this.consortLook(wreck.skinId ?? this.sim.player.skinId)
        else look = skinLook(wreck.skinId ?? this.sim.player.skinId)
        look = { ...look, sizeScale: wreck.sizeScale || look.sizeScale }
        const roll = (wreck.id % 2 ? 1 : -1) * p * 0.7
        const sink = 1 - p * 0.4
        ctx.save()
        ctx.translate(wreck.x, wreck.y + p * 6)
        ctx.scale(sink, sink)
        drawShip(ctx, look, {
            x: 0,
            y: 0,
            angle: wreck.angle + roll,
            time: this.time,
            guns: [],
            flash: 0,
            damage: 1,
            alpha: Math.pow(1 - p, 0.8),
            velocity: 0
        })
        ctx.restore()
        // Water closing over the hull.
        ctx.fillStyle = `rgba(10,50,70,${(p * 0.5).toFixed(2)})`
        ctx.beginPath()
        ctx.ellipse(wreck.x, wreck.y, 36 * wreck.sizeScale * sink, 18 * wreck.sizeScale * sink, wreck.angle, 0, Math.PI * 2)
        ctx.fill()
    }

    private drawTargetRing(minLine: number) {
        const id = this.sim.player.attackTargetId
        if (id === null) return
        const target = this.sim.enemies.find(enemy => enemy.id === id)
        if (!target) return
        const ctx = this.ctx
        const r = hullHitRadius(enemyHull(target.tier.sizeScale ?? 1)) * 1.45
        ctx.save()
        ctx.translate(target.x, target.y)
        ctx.rotate(this.time * 1.6)
        ctx.strokeStyle = 'rgba(248,113,113,0.95)'
        ctx.lineWidth = Math.max(minLine, 3)
        for (let i = 0; i < 4; i++) {
            const a = i / 4 * Math.PI * 2
            ctx.beginPath()
            ctx.arc(0, 0, r, a, a + Math.PI / 3.2)
            ctx.stroke()
        }
        ctx.restore()
    }

    private drawBar(x: number, y: number, width: number, fraction: number, shieldFraction: number, color: number) {
        const ctx = this.ctx
        ctx.fillStyle = 'rgba(2,6,23,0.8)'
        ctx.fillRect(x - width / 2 - 1.5, y - 3, width + 3, 6)
        ctx.fillStyle = css(color)
        ctx.fillRect(x - width / 2, y - 1.8, width * clamp01(fraction), 3.6)
        if (shieldFraction > 0) {
            ctx.fillStyle = 'rgba(103,232,249,0.9)'
            ctx.fillRect(x - width / 2, y - 1.8, width * clamp01(shieldFraction), 1.8)
        }
    }

    private drawHpBars() {
        for (const enemy of this.sim.enemies) {
            if (enemy.tier.boss) continue
            if (enemy.hp >= enemy.maxHp && enemy.shield <= 0) continue
            const hull = enemyHull(enemy.tier.sizeScale ?? 1)
            const fraction = enemy.hp / Math.max(1, enemy.maxHp)
            const color = fraction > 0.5 ? 0x4ade80 : fraction > 0.25 ? 0xfacc15 : 0xef4444
            this.drawBar(enemy.x, enemy.y - hull.beam - 14, Math.max(30, hull.length * 0.55), fraction, enemy.shield / Math.max(1, enemy.maxHp), color)
        }
    }

    // ─── Projectiles ────────────────────────────────────────────────────────

    private drawProjectileShadows() {
        const ctx = this.ctx
        ctx.fillStyle = 'rgba(2,14,28,0.28)'
        for (const projectile of this.sim.projectiles) {
            if (projectile.z < 2 && projectile.kind !== 'mine') continue
            const r = projectile.size * (1 + projectile.z / 160)
            ctx.globalAlpha = Math.max(0.25, 1 - projectile.z / 400)
            ctx.beginPath()
            ctx.ellipse(projectile.x + projectile.z * 0.1, projectile.y + 2, r, r * 0.7, 0, 0, Math.PI * 2)
            ctx.fill()
        }
        ctx.globalAlpha = 1
    }

    private drawProjectiles(minLine: number) {
        const ctx = this.ctx
        for (const projectile of this.sim.projectiles) {
            const lift = 1 + projectile.z / 220
            const x = projectile.x
            const y = projectile.y - projectile.z
            const r = projectile.size * lift
            switch (projectile.kind) {
                case 'ball':
                case 'enemy': {
                    const glowing = projectile.trail === 'mutated' || projectile.trail === 'tier' || projectile.trail === 'spectral'
                    // A short crisp streak behind the ball, tinted by the shot.
                    const streakColor = projectile.kind === 'enemy' ? 0xf87171 : glowing ? projectile.color : 0xfbe7b8
                    this.drawStreak(x, y, projectile.angle, streakColor, r * (glowing ? 9 : 6.5), r * (glowing ? 2.6 : 1.8), glowing ? 0.9 : 0.55)
                    if (glowing) {
                        ctx.globalCompositeOperation = 'lighter'
                        stampGlow(ctx, projectile.color, x, y, r * (projectile.trail === 'mutated' ? 3.2 : 2.4), 0.55)
                        ctx.globalCompositeOperation = 'source-over'
                    }
                    const ball = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r)
                    ball.addColorStop(0, projectile.kind === 'enemy' ? '#8a7570' : '#9a928a')
                    ball.addColorStop(0.6, projectile.kind === 'enemy' ? '#3b2d2a' : '#3a3532')
                    ball.addColorStop(1, projectile.trail === 'spectral' ? css(shade(projectile.color, -0.5)) : '#0c0a09')
                    ctx.fillStyle = ball
                    ctx.beginPath()
                    ctx.arc(x, y, r, 0, Math.PI * 2)
                    ctx.fill()
                    ctx.strokeStyle = projectile.kind === 'enemy' ? rgba(0xef4444, 0.75) : 'rgba(4,8,14,0.7)'
                    ctx.lineWidth = Math.max(minLine, r * 0.25)
                    ctx.stroke()
                    break
                }
                case 'gem':
                case 'titan':
                case 'spiral':
                case 'warhead':
                case 'sniper': {
                    const color = projectile.kind === 'gem' ? 0x38bdf8 : projectile.kind === 'warhead' ? 0xfb7185 : projectile.kind === 'sniper' ? 0xe879f9 : projectile.color
                    const boost = projectile.kind === 'titan' ? 1.6 : 1
                    const long = projectile.kind === 'sniper' || projectile.kind === 'warhead'
                    this.drawStreak(x, y, projectile.angle, color, r * (long ? 10 : 6.5) * boost, r * 2.2 * boost, 0.9)
                    ctx.globalCompositeOperation = 'lighter'
                    stampGlow(ctx, color, x, y, r * 3.2 * boost, 0.6)
                    stampGlow(ctx, color, x, y, r * 1.6 * boost, 1, true)
                    ctx.globalCompositeOperation = 'source-over'
                    break
                }
                case 'harpoon': {
                    const shooter = this.nearestShooter(projectile, 'harpooner')
                    if (shooter) this.drawRope(shooter.x, shooter.y, x, y, minLine, 0.8)
                    ctx.save()
                    ctx.translate(x, y)
                    ctx.rotate(projectile.angle)
                    ctx.strokeStyle = '#d6d3d1'
                    ctx.lineWidth = Math.max(minLine, 2.4)
                    ctx.beginPath()
                    ctx.moveTo(-18, 0)
                    ctx.lineTo(6, 0)
                    ctx.stroke()
                    ctx.fillStyle = css(projectile.color)
                    ctx.beginPath()
                    ctx.moveTo(14, 0)
                    ctx.lineTo(4, -5)
                    ctx.lineTo(6, 0)
                    ctx.lineTo(4, 5)
                    ctx.closePath()
                    ctx.fill()
                    ctx.restore()
                    break
                }
                case 'mine': {
                    ctx.globalCompositeOperation = 'lighter'
                    stampGlow(ctx, 0x3b82f6, x, y, r * 3, 0.5)
                    ctx.globalCompositeOperation = 'source-over'
                    ctx.save()
                    ctx.translate(x, y)
                    ctx.rotate(this.time * 3 + projectile.id)
                    ctx.strokeStyle = '#93c5fd'
                    ctx.lineWidth = Math.max(minLine, 2.5)
                    ctx.beginPath()
                    for (let i = 0; i < 6; i++) {
                        const a = i / 6 * Math.PI * 2
                        ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6)
                        ctx.lineTo(Math.cos(a) * r * 1.4, Math.sin(a) * r * 1.4)
                    }
                    ctx.stroke()
                    ctx.fillStyle = '#172554'
                    ctx.beginPath()
                    ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2)
                    ctx.fill()
                    ctx.restore()
                    break
                }
                case 'bomb':
                case 'mortar':
                case 'shell': {
                    if (projectile.kind === 'shell') {
                        ctx.globalCompositeOperation = 'lighter'
                        stampGlow(ctx, 0xf97316, x, y, r * 4, 0.8)
                        stampGlow(ctx, 0xfde047, x, y, r * 1.6, 1, true)
                        ctx.globalCompositeOperation = 'source-over'
                        break
                    }
                    const shell = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r)
                    shell.addColorStop(0, projectile.kind === 'mortar' ? '#78716c' : '#57534e')
                    shell.addColorStop(1, '#0c0a09')
                    ctx.fillStyle = shell
                    ctx.beginPath()
                    ctx.arc(x, y, r, 0, Math.PI * 2)
                    ctx.fill()
                    ctx.strokeStyle = css(projectile.color)
                    ctx.lineWidth = Math.max(minLine, 1.6)
                    ctx.stroke()
                    ctx.globalCompositeOperation = 'lighter'
                    stampGlow(ctx, 0xfde047, x + r * 0.7, y - r * 0.7, r * 0.9, 0.9 * (0.7 + Math.sin(this.time * 30) * 0.3), true)
                    ctx.globalCompositeOperation = 'source-over'
                    break
                }
                case 'keg': {
                    ctx.save()
                    ctx.translate(x, y)
                    ctx.rotate(projectile.ageMs / 120)
                    ctx.fillStyle = '#8b5a2b'
                    ctx.fillRect(-r, -r * 1.2, r * 2, r * 2.4)
                    ctx.fillStyle = '#3f2a18'
                    ctx.fillRect(-r, -r * 0.8, r * 2, r * 0.3)
                    ctx.fillRect(-r, r * 0.5, r * 2, r * 0.3)
                    ctx.restore()
                    ctx.globalCompositeOperation = 'lighter'
                    stampGlow(ctx, 0xfacc15, x, y - r * 1.3, r * 1.2, 0.9, true)
                    ctx.globalCompositeOperation = 'source-over'
                    break
                }
                case 'skiff': {
                    ctx.save()
                    ctx.translate(x, y)
                    ctx.rotate(projectile.angle)
                    ctx.fillStyle = '#164e63'
                    ctx.strokeStyle = '#a5f3fc'
                    ctx.lineWidth = Math.max(minLine, 1.5)
                    ctx.beginPath()
                    ctx.moveTo(13, 0)
                    ctx.lineTo(-11, -5.5)
                    ctx.lineTo(-8, 0)
                    ctx.lineTo(-11, 5.5)
                    ctx.closePath()
                    ctx.fill()
                    ctx.stroke()
                    ctx.fillStyle = '#ecfeff'
                    ctx.beginPath()
                    ctx.moveTo(-2, 0)
                    ctx.lineTo(-2, -10)
                    ctx.lineTo(6, -2)
                    ctx.closePath()
                    ctx.fill()
                    ctx.restore()
                    break
                }
            }
        }
        ctx.globalAlpha = 1
    }

    /** An additive light streak trailing a shot: bright at the shot, fading behind it. */
    private drawStreak(x: number, y: number, angle: number, color: number, length: number, thickness: number, alpha: number) {
        const ctx = this.ctx
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(angle)
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = alpha
        ctx.drawImage(sprites().streak(color), -length + thickness * 0.3, -thickness / 2, length, thickness)
        ctx.restore()
    }

    private nearestShooter(projectile: SimProjectile, tierId: string) {
        let best: SimEnemy | null = null
        let bestDistance = Infinity
        for (const enemy of this.sim.enemies) {
            if (enemy.tier.id !== tierId) continue
            const d = Math.hypot(enemy.x - projectile.x, enemy.y - projectile.y)
            if (d < bestDistance) {
                best = enemy
                bestDistance = d
            }
        }
        return best && bestDistance < 700 ? best : null
    }

    private drawBolts(minLine: number) {
        const ctx = this.ctx
        if (!this.bolts.length) return
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.globalCompositeOperation = 'lighter'
        for (const bolt of this.bolts) {
            const fade = bolt.life / bolt.maxLife
            for (const [width, color, alpha] of [[9, bolt.color, 0.25], [4, bolt.color, 0.6], [1.8, 0xffffff, 0.95]] as const) {
                ctx.globalAlpha = alpha * fade
                ctx.strokeStyle = css(color)
                ctx.lineWidth = Math.max(minLine, width)
                ctx.beginPath()
                bolt.points.forEach((point, index) => {
                    if (index === 0) ctx.moveTo(point.x, point.y)
                    else ctx.lineTo(point.x, point.y)
                })
                ctx.stroke()
            }
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
    }

    // ─── Ability aim preview ────────────────────────────────────────────────

    private drawAbilityPreview(minLine: number) {
        const sim = this.sim
        const cursor = this.cursor
        if (!cursor || !sim.running || !sim.abilityReady) return
        const ctx = this.ctx
        const pulse = 0.7 + Math.sin(this.time * 4) * 0.3
        ctx.lineWidth = Math.max(minLine, 2)
        const ring = (radius: number, color: number, dashed = false) => {
            ctx.strokeStyle = rgba(color, 0.4 * pulse)
            ctx.fillStyle = rgba(color, 0.05)
            if (dashed) ctx.setLineDash([10, 8])
            ctx.beginPath()
            ctx.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            ctx.setLineDash([])
        }
        switch (sim.abilityId) {
            case 'bomb':
                ring(PLAYER_BOMB_RADIUS, 0xfde047)
                break
            case 'maelstrom':
                ring(MAELSTROM_PREVIEW_RADIUS, 0x22d3ee)
                break
            case 'firestorm':
                ring(PIRATE_HELLFIRE_ZONE_RADIUS, 0xfb923c, true)
                break
            case 'tidal': {
                const player = sim.player
                const angle = Math.atan2(cursor.y - player.y, cursor.x - player.x)
                ctx.save()
                ctx.translate(player.x, player.y)
                ctx.rotate(angle)
                const half = PIRATE_ROGUE_WAVE_WIDTH / 2
                const band = ctx.createLinearGradient(0, 0, PIRATE_ROGUE_WAVE_LENGTH, 0)
                band.addColorStop(0, 'rgba(125,211,252,0.12)')
                band.addColorStop(1, 'rgba(125,211,252,0)')
                ctx.fillStyle = band
                ctx.fillRect(0, -half, PIRATE_ROGUE_WAVE_LENGTH, half * 2)
                ctx.strokeStyle = rgba(0x7dd3fc, 0.35 * pulse)
                ctx.setLineDash([10, 8])
                ctx.beginPath()
                ctx.moveTo(0, -half)
                ctx.lineTo(PIRATE_ROGUE_WAVE_LENGTH, -half)
                ctx.moveTo(0, half)
                ctx.lineTo(PIRATE_ROGUE_WAVE_LENGTH, half)
                ctx.stroke()
                ctx.setLineDash([])
                ctx.restore()
                break
            }
            default:
                break
        }
    }
}

/** A wake foam blob drifting out from the hull. */
function addWakeFoam(ps: ParticleSystem, x: number, y: number, vx: number, vy: number, size: number, alpha: number) {
    ps.add({ kind: 'foam', x, y, vx, vy, life: 1.3, size, grow: 2.6, alpha, under: true, drag: 1.4 })
}
