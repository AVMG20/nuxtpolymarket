// SHAPEZZ renderer. Reads the engine's world state and draws a frame; owns
// nothing the simulation depends on, so a headless playtest never builds one.
//
// Glow comes from cached sprites (fx.ts) stamped additively, never from
// `shadowBlur`, which is what used to force the old "dense visuals" mode to
// strip effects exactly when the screen got exciting.

import { SHAPEZZ_BOMBER_BLAST_RADIUS, SHAPEZZ_BOSSES, SHAPEZZ_CHECKPOINT_MS, SHAPEZZ_WARDEN_AURA_RADIUS, shapezzShieldStats } from '#shared/utils/gamelogic/shapezz'
import type { ShapezzEngine } from '../shapezz-engine'
import { ShapezzSprites, easeOutBack, rgba, shade, smoothNoise } from './fx'
import { COIN_COLOR, FLOOR_Y, HEIGHT, WIDTH, clamp, type Enemy, type Platform } from './world'

/** Arena lighting drifts from cyan toward hot pink as the mutations stack up. */
const MUTATION_ACCENTS = ['#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#c084fc', '#e879f9', '#f472b6', '#fb7185', '#f87171']

const TYPE_SIDES: Record<string, number> = { melee: 3, shooter: 0, tank: 6, dasher: 4, splitter: 5, shard: 3, sniper: 4, bomber: 8, warden: 8 }

interface BackdropShape { x: number, y: number, radius: number, sides: number, speed: number, depth: number }

function polygonPath(ctx: CanvasRenderingContext2D, sides: number, x: number, y: number, radius: number, rotation = 0) {
    ctx.beginPath()
    for (let i = 0; i < sides; i++) {
        const angle = rotation + i / sides * Math.PI * 2
        const px = x + Math.cos(angle) * radius
        const py = y + Math.sin(angle) * radius
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
    }
    ctx.closePath()
}

function starPath(ctx: CanvasRenderingContext2D, points: number, x: number, y: number, outer: number, inner: number, rotation = 0) {
    ctx.beginPath()
    for (let i = 0; i < points * 2; i++) {
        const angle = rotation + i / (points * 2) * Math.PI * 2
        const radius = i % 2 === 0 ? outer : inner
        const px = x + Math.cos(angle) * radius
        const py = y + Math.sin(angle) * radius
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
    }
    ctx.closePath()
}

export class ShapezzRenderer {
    private canvas: HTMLCanvasElement
    private ctx: CanvasRenderingContext2D
    private engine: ShapezzEngine
    private onFps: (fps: number) => void
    private sprites = new ShapezzSprites()
    private scale = 1
    private maxScale = 1
    private minScale = 1
    private backdrop: HTMLCanvasElement | null = null
    private vignette: HTMLCanvasElement | null = null
    private scanlines: CanvasPattern | null = null
    private platformGradients: CanvasGradient[] = []
    private frameIntervalAverage = 1000 / 60
    private frameCostAverage = 0
    private qualityFrames = 0
    private qualityStalled = false
    private denseVisuals = false
    private trail: { x: number, y: number, sx: number, sy: number }[] = []
    private trailTimer = 0
    private lastTime = 0
    private resizeObserver: ResizeObserver | null = null
    private backdropShapes: BackdropShape[] = Array.from({ length: 7 }, (_, i) => ({
        x: (i * 211 + 90) % WIDTH,
        y: 80 + (i * 137) % 420,
        radius: 40 + (i * 53) % 110,
        sides: 3 + i % 5,
        speed: (i % 2 === 0 ? 1 : -1) * (0.05 + (i % 3) * 0.04),
        depth: 0.2 + (i % 4) * 0.12
    }))

    constructor(canvas: HTMLCanvasElement, engine: ShapezzEngine, onFps: (fps: number) => void) {
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas 2D is unavailable')
        this.canvas = canvas
        this.ctx = ctx
        this.engine = engine
        this.onFps = onFps
        this.measure()
        this.scale = this.maxScale
        this.resize()
        window.addEventListener('resize', this.onResize)
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(this.onResize)
            this.resizeObserver.observe(canvas)
        }
    }

    destroy() {
        window.removeEventListener('resize', this.onResize)
        this.resizeObserver?.disconnect()
    }

    /**
     * The canvas is drawn at the scale that maps one logical pixel onto the
     * screen's real pixels, so a 1440p monitor is never upscaled from 720p.
     * Adaptive quality may back off on slow frames, but never below native
     * resolution on a standard-density screen.
     */
    private measure() {
        const dpr = window.devicePixelRatio || 1
        const cssWidth = this.canvas.clientWidth || WIDTH
        const native = cssWidth * dpr / WIDTH
        this.maxScale = clamp(native, 1, 2.2)
        this.minScale = dpr <= 1 ? this.maxScale : clamp(native * 0.6, 1, this.maxScale)
    }

    private onResize = () => {
        this.measure()
        this.scale = clamp(this.scale, this.minScale, this.maxScale)
        if (this.scale < this.maxScale && this.frameIntervalAverage < 17.5) this.scale = this.maxScale
        this.resize()
    }

    private resize() {
        const targetWidth = Math.round(WIDTH * this.scale)
        const targetHeight = Math.round(HEIGHT * this.scale)
        if (this.canvas.width === targetWidth && this.canvas.height === targetHeight && this.backdrop) return
        this.canvas.width = targetWidth
        this.canvas.height = targetHeight
        this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)
        this.buildBackdrop()
        this.buildVignette()
        this.platformGradients = this.engine.platforms.map((platform) => {
            const gradient = this.ctx.createLinearGradient(0, platform.y, 0, platform.y + platform.height)
            gradient.addColorStop(0, '#0e3a4a')
            gradient.addColorStop(0.35, '#0a2331')
            gradient.addColorStop(1, '#050d16')
            return gradient
        })
        const lines = document.createElement('canvas')
        lines.width = 1
        lines.height = 3
        const linesCtx = lines.getContext('2d')!
        linesCtx.fillStyle = 'rgba(0,0,0,0.22)'
        linesCtx.fillRect(0, 2, 1, 1)
        this.scanlines = this.ctx.createPattern(lines, 'repeat')
    }

    /** Static sky, nebulae and far stars, baked once per resolution. */
    private buildBackdrop() {
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(WIDTH * this.scale)
        canvas.height = Math.round(HEIGHT * this.scale)
        const ctx = canvas.getContext('2d')!
        ctx.scale(this.scale, this.scale)
        const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT)
        sky.addColorStop(0, '#04020f')
        sky.addColorStop(0.5, '#090d26')
        sky.addColorStop(0.82, '#0d0b2a')
        sky.addColorStop(1, '#05070f')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, WIDTH, HEIGHT)

        const nebulae: [number, number, number, string, number][] = [
            [220, 180, 420, '#6d28d9', 0.22],
            [1040, 140, 380, '#0e7490', 0.2],
            [700, 420, 520, '#be185d', 0.12],
            [120, 560, 300, '#1d4ed8', 0.14],
            [1180, 520, 340, '#7c3aed', 0.14]
        ]
        ctx.globalCompositeOperation = 'lighter'
        for (const [x, y, radius, color, alpha] of nebulae) {
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
            gradient.addColorStop(0, rgba(color, alpha))
            gradient.addColorStop(0.5, rgba(color, alpha * 0.4))
            gradient.addColorStop(1, rgba(color, 0))
            ctx.fillStyle = gradient
            ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
        }
        ctx.globalCompositeOperation = 'source-over'

        // Far stars: a fixed scatter from a tiny LCG so the sky never reshuffles.
        let seed = 7
        const next = () => {
            seed = (seed * 16807) % 2147483647
            return seed / 2147483647
        }
        for (let i = 0; i < 220; i++) {
            const x = next() * WIDTH
            const y = next() * (FLOOR_Y - 20)
            const size = next() < 0.9 ? 1 : 2
            ctx.fillStyle = `rgba(255,255,255,${0.12 + next() * 0.4})`
            ctx.fillRect(x, y, size, size)
        }

        // Horizon haze behind the floor.
        const haze = ctx.createLinearGradient(0, FLOOR_Y - 180, 0, FLOOR_Y)
        haze.addColorStop(0, 'rgba(34,211,238,0)')
        haze.addColorStop(1, 'rgba(34,211,238,0.07)')
        ctx.fillStyle = haze
        ctx.fillRect(0, FLOOR_Y - 180, WIDTH, 180)
        this.backdrop = canvas
    }

    private buildVignette() {
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(WIDTH * this.scale / 2)
        canvas.height = Math.round(HEIGHT * this.scale / 2)
        const ctx = canvas.getContext('2d')!
        ctx.scale(this.scale / 2, this.scale / 2)
        const gradient = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 240, WIDTH / 2, HEIGHT / 2, 780)
        gradient.addColorStop(0, 'rgba(0,0,0,0)')
        gradient.addColorStop(1, 'rgba(0,0,0,0.62)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, WIDTH, HEIGHT)
        this.vignette = canvas
    }

    updateQuality(frameInterval: number, frameCost: number) {
        if (frameInterval <= 0) return
        this.frameIntervalAverage += (Math.min(100, frameInterval) - this.frameIntervalAverage) * 0.04
        this.frameCostAverage += (frameCost - this.frameCostAverage) * 0.04
        if (frameInterval > 50) this.qualityStalled = true
        if (++this.qualityFrames < 45) return
        this.qualityFrames = 0
        this.onFps(Math.min(999, Math.round(1000 / this.frameIntervalAverage)))
        let next = this.scale
        if (this.qualityStalled || this.frameIntervalAverage > 18.5 || this.frameCostAverage > 12) next = Math.max(this.minScale, this.scale - 0.2)
        else if (this.frameCostAverage < 6 && this.frameIntervalAverage < 17.2) next = Math.min(this.maxScale, this.scale + 0.1)
        this.qualityStalled = false
        if (Math.abs(next - this.scale) < 0.01) return
        this.scale = next
        this.resize()
    }

    // ─── Frame ──────────────────────────────────────────────────────────────

    render(time: number) {
        const engine = this.engine
        const ctx = this.ctx
        const dt = Math.min(0.05, Math.max(0, time - (this.lastTime || time)))
        this.lastTime = time
        const load = engine.bullets.length / 700 + engine.enemyBullets.length / 360 + engine.particles.length / 1400
        if (load > 1.25) this.denseVisuals = true
        else if (load < 0.8) this.denseVisuals = false

        ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'

        // Camera shake: trauma squared drives smooth noise, never frame-random jitter.
        const shake = engine.trauma * engine.trauma
        const shakeX = shake * 18 * smoothNoise(time * 22, 1)
        const shakeY = shake * 18 * smoothNoise(time * 22, 2)
        const shakeAngle = shake * 0.014 * smoothNoise(time * 18, 3)

        ctx.save()
        ctx.translate(WIDTH / 2 + shakeX, HEIGHT / 2 + shakeY)
        ctx.rotate(shakeAngle)
        ctx.translate(-WIDTH / 2, -HEIGHT / 2)
        this.drawBackground(time)
        this.drawPlatforms(time)
        this.drawWarnings(time)
        this.drawSingularities(time)
        this.drawPickups(time)
        this.drawShadows()
        this.drawLasers(time)
        this.drawEnemies(time)
        this.drawDebris()
        this.drawPlayerBullets()
        this.drawEnemyBullets(time)
        this.drawCompanions(time)
        this.updateTrail(dt)
        this.drawPlayer(time)
        this.drawBeams()
        this.drawLances()
        this.drawParticles()
        this.drawShockwaves()
        this.drawTexts()
        ctx.restore()

        this.drawPost(time)
        this.drawEdgeIndicators(time)
        this.drawBossBars(time)
        if (engine.running && engine.aimVisible) this.drawAimCursor(time)
    }

    // ─── Arena ──────────────────────────────────────────────────────────────

    private mutationAccent() {
        const checkpoint = Math.floor(this.engine.elapsedMs / SHAPEZZ_CHECKPOINT_MS)
        return MUTATION_ACCENTS[Math.min(MUTATION_ACCENTS.length - 1, checkpoint)]!
    }

    private drawBackground(time: number) {
        const ctx = this.ctx
        const engine = this.engine
        if (this.backdrop) ctx.drawImage(this.backdrop, -30, -30, WIDTH + 60, HEIGHT + 60)
        else {
            ctx.fillStyle = '#06031a'
            ctx.fillRect(-30, -30, WIDTH + 60, HEIGHT + 60)
        }

        const accent = this.mutationAccent()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.35
        ctx.drawImage(this.sprites.glow(accent), WIDTH / 2 - 900, FLOOR_Y - 380, 1800, 700)
        if (engine.bossTint > 0.01) {
            ctx.globalAlpha = engine.bossTint * (0.4 + Math.sin(time * 2.2) * 0.08)
            ctx.drawImage(this.sprites.glow(engine.bossTintColor), WIDTH / 2 - 900, -420, 1800, 900)
        }

        // Drifting wireframe geometry, parallaxed against the player.
        const parallax = (engine.player.x - WIDTH / 2) / WIDTH
        ctx.lineWidth = 1.5
        for (const shape of this.backdropShapes) {
            const x = shape.x - parallax * 80 * shape.depth + Math.sin(time * 0.1 + shape.radius) * 20
            const y = shape.y + Math.cos(time * 0.13 + shape.sides) * 14
            ctx.globalAlpha = 0.05 + shape.depth * 0.08
            ctx.strokeStyle = accent
            polygonPath(ctx, shape.sides, x, y, shape.radius, time * shape.speed)
            ctx.stroke()
            polygonPath(ctx, shape.sides, x, y, shape.radius * 0.55, -time * shape.speed * 1.4)
            ctx.stroke()
        }

        // Twinkling near stars.
        for (let i = 0; i < 40; i++) {
            const x = (i * 193 + time * (6 + i % 5) - parallax * 30) % WIDTH
            const y = (i * 97) % (FLOOR_Y - 60)
            ctx.globalAlpha = 0.2 + Math.max(0, Math.sin(time * (1.5 + i % 3) + i)) * 0.6
            ctx.fillStyle = i % 7 === 0 ? accent : '#ffffff'
            const size = 1 + i % 2
            ctx.fillRect(x < 0 ? x + WIDTH : x, y, size, size)
        }
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'

        // Faint scrolling grid over the sky.
        ctx.lineWidth = 1
        ctx.strokeStyle = rgba(accent, 0.05)
        const offset = time * 18 % 40
        ctx.beginPath()
        for (let x = -40 + offset; x < WIDTH + 40; x += 40) {
            ctx.moveTo(x, 0)
            ctx.lineTo(x, FLOOR_Y)
        }
        for (let y = 0; y < FLOOR_Y; y += 40) {
            ctx.moveTo(0, y)
            ctx.lineTo(WIDTH, y)
        }
        ctx.stroke()
    }

    private drawPlatforms(time: number) {
        const ctx = this.ctx
        const accent = this.mutationAccent()
        const platforms = this.engine.platforms
        for (let i = 0; i < platforms.length; i++) {
            const platform = platforms[i]!
            ctx.fillStyle = this.platformGradients[i] ?? '#0a2331'
            ctx.fillRect(platform.x, platform.y, platform.width, platform.height)
            if (i === 0) this.drawFloorGrid(platform, accent)
            else {
                // Underside light strip.
                ctx.fillStyle = rgba(accent, 0.25)
                ctx.fillRect(platform.x + 6, platform.y + platform.height - 2, platform.width - 12, 2)
            }
            // Neon lip with a halo that flares when something lands on it.
            const flare = 0.55 + platform.glow * 0.45 + Math.sin(time * 2 + i) * 0.05
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.35 + platform.glow * 0.5
            ctx.drawImage(this.sprites.glow(accent), platform.x - 20, platform.y - 18, platform.width + 40, 36)
            ctx.globalAlpha = flare
            ctx.fillStyle = shade(accent, 0.45)
            ctx.fillRect(platform.x, platform.y - 1, platform.width, 3)
            ctx.globalAlpha = 1
            ctx.globalCompositeOperation = 'source-over'
            if (i > 0) {
                ctx.fillStyle = '#ecfeff'
                ctx.fillRect(platform.x, platform.y - 1, 4, platform.height + 1)
                ctx.fillRect(platform.x + platform.width - 4, platform.y - 1, 4, platform.height + 1)
            }
        }
    }

    /** Static perspective grid on the floor slab. */
    private drawFloorGrid(floor: Platform, accent: string) {
        const ctx = this.ctx
        const top = floor.y + 3
        const bottom = floor.y + floor.height
        const vanishX = WIDTH / 2
        ctx.save()
        ctx.beginPath()
        ctx.rect(floor.x, top, floor.width, floor.height)
        ctx.clip()
        ctx.strokeStyle = rgba(accent, 0.32)
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = -16; i <= 16; i++) {
            const bottomX = WIDTH / 2 + i * 120
            ctx.moveTo(vanishX + (bottomX - vanishX) * 0.12, top)
            ctx.lineTo(bottomX, bottom + 40)
        }
        for (let i = 1; i <= 6; i++) {
            const t = i / 6
            const y = top + t * t * (bottom - top + 10)
            ctx.moveTo(0, y)
            ctx.lineTo(WIDTH, y)
        }
        ctx.stroke()
        ctx.restore()
    }

    private drawWarnings(time: number) {
        const ctx = this.ctx
        for (const warning of this.engine.warnings) {
            const progress = 1 - warning.life / warning.maxLife
            const blink = 0.55 + Math.sin(time * (18 + progress * 30)) * 0.45
            ctx.strokeStyle = warning.color
            ctx.fillStyle = warning.color
            if (warning.kind === 'circle') {
                ctx.globalAlpha = 0.12 + progress * 0.25
                ctx.beginPath()
                ctx.arc(warning.x, warning.y, warning.radius * progress, 0, Math.PI * 2)
                ctx.fill()
                ctx.globalAlpha = blink
                ctx.lineWidth = 3
                ctx.beginPath()
                ctx.arc(warning.x, warning.y, warning.radius, 0, Math.PI * 2)
                ctx.stroke()
            } else if (warning.kind === 'column') {
                ctx.globalAlpha = 0.08 + progress * 0.22
                ctx.fillRect(warning.x - warning.radius, 0, warning.radius * 2, FLOOR_Y)
                ctx.globalAlpha = blink
                ctx.beginPath()
                ctx.moveTo(warning.x - 10, 8)
                ctx.lineTo(warning.x + 10, 8)
                ctx.lineTo(warning.x, 24)
                ctx.closePath()
                ctx.fill()
                ctx.fillRect(warning.x - 12, FLOOR_Y - 3, 24, 3)
            } else {
                ctx.globalAlpha = 0.1 + progress * 0.25
                ctx.lineWidth = warning.radius * 2
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.moveTo(warning.x, warning.y)
                ctx.lineTo(warning.x2, warning.y2)
                ctx.stroke()
                ctx.globalAlpha = blink
                ctx.lineWidth = 2
                ctx.setLineDash([18, 12])
                ctx.lineDashOffset = -time * 200
                ctx.stroke()
                ctx.setLineDash([])
                ctx.lineCap = 'butt'
            }
        }
        ctx.globalAlpha = 1
    }

    private drawSingularities(time: number) {
        const ctx = this.ctx
        for (const singularity of this.engine.singularities) {
            const progress = 1 - singularity.life / singularity.maxLife
            const appear = Math.min(1, progress * 8) * Math.min(1, singularity.life * 3)
            const radius = singularity.radius * appear
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.7 * appear
            ctx.drawImage(this.sprites.glow('#a21caf'), singularity.x - radius * 1.5, singularity.y - radius * 1.5, radius * 3, radius * 3)
            ctx.globalCompositeOperation = 'source-over'
            const gradient = ctx.createRadialGradient(singularity.x, singularity.y, 1, singularity.x, singularity.y, Math.max(2, radius * 0.45))
            gradient.addColorStop(0, 'rgba(0,0,0,1)')
            gradient.addColorStop(0.7, 'rgba(0,0,0,0.95)')
            gradient.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.globalAlpha = appear
            ctx.fillStyle = gradient
            ctx.beginPath()
            ctx.arc(singularity.x, singularity.y, radius * 0.45, 0, Math.PI * 2)
            ctx.fill()
            // Accretion arcs spinning inward.
            ctx.globalCompositeOperation = 'lighter'
            ctx.lineWidth = 3
            for (let i = 0; i < 4; i++) {
                const r = radius * (0.3 + i * 0.16)
                ctx.strokeStyle = i % 2 === 0 ? '#e879f9' : '#c4b5fd'
                ctx.globalAlpha = appear * (0.7 - i * 0.12)
                ctx.beginPath()
                const start = time * (5 - i) + i * 1.3
                ctx.arc(singularity.x, singularity.y, r, start, start + Math.PI * 1.1)
                ctx.stroke()
            }
            ctx.globalAlpha = appear * 0.8
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.arc(singularity.x, singularity.y, radius * 0.45 + Math.sin(time * 12) * 2, 0, Math.PI * 2)
            ctx.stroke()
            ctx.globalCompositeOperation = 'source-over'
        }
        ctx.globalAlpha = 1
    }

    private drawPickups(time: number) {
        const ctx = this.ctx
        const pickups = this.engine.pickups
        ctx.globalCompositeOperation = 'lighter'
        for (const pickup of pickups) {
            const color = pickup.kind === 'coin' ? COIN_COLOR : '#34d399'
            const size = pickup.kind === 'coin' ? 30 : 46 + Math.sin(time * 6) * 6
            ctx.globalAlpha = pickup.life < 2 ? (Math.sin(time * 20) > 0 ? 0.5 : 0.15) : 0.55
            ctx.drawImage(this.sprites.glow(color), pickup.x - size / 2, pickup.y - size / 2, size, size)
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        for (const pickup of pickups) {
            if (pickup.life < 2 && Math.sin(time * 20) < -0.3) continue
            if (pickup.kind === 'coin') {
                // A spinning hex coin: squash the x axis to fake rotation in depth.
                const squash = Math.abs(Math.cos(pickup.spin))
                ctx.save()
                ctx.translate(pickup.x, pickup.y)
                ctx.scale(0.25 + squash * 0.75, 1)
                polygonPath(ctx, 6, 0, 0, 8.5, Math.PI / 6)
                ctx.fillStyle = COIN_COLOR
                ctx.fill()
                ctx.lineWidth = 2
                ctx.strokeStyle = '#ecfeff'
                ctx.stroke()
                ctx.fillStyle = '#083344'
                ctx.fillRect(-1.5, -4.5, 3, 9)
                ctx.restore()
            } else {
                const pulse = 1 + Math.sin(time * 8) * 0.1
                ctx.fillStyle = '#34d399'
                ctx.fillRect(pickup.x - 3.5 * pulse, pickup.y - 10 * pulse, 7 * pulse, 20 * pulse)
                ctx.fillRect(pickup.x - 10 * pulse, pickup.y - 3.5 * pulse, 20 * pulse, 7 * pulse)
                ctx.fillStyle = '#ecfdf5'
                ctx.fillRect(pickup.x - 1.5, pickup.y - 6, 3, 12)
                ctx.fillRect(pickup.x - 6, pickup.y - 1.5, 12, 3)
            }
        }
    }

    /** Soft contact shadows on the floor sell height. */
    private drawShadows() {
        if (this.denseVisuals) return
        const ctx = this.ctx
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.beginPath()
        const addShadow = (x: number, y: number, radius: number) => {
            const height = FLOOR_Y - y
            if (height < 0 || height > 420) return
            const scale = 1 - height / 520
            const width = radius * scale * 1.1
            ctx.moveTo(x + width, FLOOR_Y + 2)
            ctx.ellipse(x, FLOOR_Y + 2, width, Math.max(1.5, width * 0.18), 0, 0, Math.PI * 2)
        }
        for (const enemy of this.engine.enemies) addShadow(enemy.x, enemy.y, enemy.radius)
        const player = this.engine.player
        addShadow(player.x, player.y + player.size / 2, player.size * 0.7)
        ctx.fill()
    }

    private drawLasers(time: number) {
        const ctx = this.ctx
        ctx.lineCap = 'round'
        for (const laser of this.engine.lasers) {
            const endX = laser.x + Math.cos(laser.angle) * laser.length
            const endY = laser.y + Math.sin(laser.angle) * laser.length
            ctx.beginPath()
            ctx.moveTo(laser.x, laser.y)
            ctx.lineTo(endX, endY)
            if (laser.warmup > 0) {
                const progress = 1 - laser.warmup / laser.maxWarmup
                ctx.globalAlpha = 0.25 + progress * 0.55 * (0.6 + Math.sin(time * 40) * 0.4)
                ctx.strokeStyle = laser.color
                ctx.lineWidth = 1 + progress * 2
                ctx.stroke()
                continue
            }
            const fade = Math.min(1, laser.life / 0.2, (laser.maxLife - laser.life) / 0.08)
            const wobble = 1 + Math.sin(time * 50) * 0.08
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.25 * fade
            ctx.strokeStyle = laser.color
            ctx.lineWidth = laser.width * 2.6 * wobble
            ctx.stroke()
            ctx.globalAlpha = 0.85 * fade
            ctx.lineWidth = laser.width * wobble
            ctx.stroke()
            ctx.globalAlpha = fade
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = laser.width * 0.35
            ctx.stroke()
            ctx.drawImage(this.sprites.core(laser.color), laser.x - laser.width * 2, laser.y - laser.width * 2, laser.width * 4, laser.width * 4)
            ctx.globalCompositeOperation = 'source-over'
        }
        ctx.globalAlpha = 1
        ctx.lineCap = 'butt'
    }

    // ─── Enemies ────────────────────────────────────────────────────────────

    private drawEnemies(time: number) {
        const ctx = this.ctx
        const enemies = this.engine.enemies

        // Warden auras and tethers under everything else.
        for (const warden of enemies) {
            if (warden.type !== 'warden') continue
            ctx.globalAlpha = 0.18
            ctx.strokeStyle = warden.color
            ctx.lineWidth = 2
            ctx.setLineDash([10, 10])
            ctx.lineDashOffset = -time * 30
            ctx.beginPath()
            ctx.arc(warden.x, warden.y, SHAPEZZ_WARDEN_AURA_RADIUS, 0, Math.PI * 2)
            ctx.stroke()
            ctx.setLineDash([])
            ctx.globalAlpha = 0.3
            ctx.beginPath()
            for (const enemy of enemies) {
                if (!enemy.shielded || (enemy.x - warden.x) ** 2 + (enemy.y - warden.y) ** 2 > SHAPEZZ_WARDEN_AURA_RADIUS ** 2) continue
                ctx.moveTo(warden.x, warden.y)
                ctx.lineTo(enemy.x, enemy.y)
            }
            ctx.stroke()
        }
        ctx.globalAlpha = 1

        // Halos in one additive pass.
        ctx.globalCompositeOperation = 'lighter'
        for (const enemy of enemies) {
            const spawn = enemy.spawnT < 1 ? easeOutBack(enemy.spawnT) : 1
            const size = enemy.radius * (enemy.boss ? 4.2 : this.denseVisuals ? 2.4 : 3.2) * spawn
            ctx.globalAlpha = enemy.boss ? 0.6 : enemy.elite ? 0.55 : 0.32
            ctx.drawImage(this.sprites.glow(enemy.elite ? '#facc15' : enemy.color), enemy.x - size / 2, enemy.y - size / 2, size, size)
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1

        for (const enemy of enemies) {
            const spawn = enemy.spawnT < 1 ? easeOutBack(enemy.spawnT) : 1
            if (spawn <= 0.01) continue
            ctx.save()
            ctx.translate(enemy.x, enemy.y)
            ctx.scale(spawn, spawn)
            if (enemy.boss) this.drawBoss(enemy, time)
            else this.drawEnemyBody(enemy, time)
            ctx.restore()
        }

        // Health bars on top of the bodies.
        for (const enemy of enemies) {
            if (enemy.boss || enemy.hp >= enemy.maxHp) continue
            const width = Math.max(24, enemy.radius * 2)
            const x = enemy.x - width / 2
            const y = enemy.y - enemy.radius - 12
            ctx.fillStyle = 'rgba(0,0,0,0.75)'
            ctx.fillRect(x - 1, y - 1, width + 2, 5)
            ctx.fillStyle = 'rgba(255,255,255,0.7)'
            ctx.fillRect(x, y, width * clamp(enemy.hpShown / enemy.maxHp, 0, 1), 3)
            ctx.fillStyle = enemy.shielded ? '#93c5fd' : enemy.elite ? '#facc15' : enemy.color
            ctx.fillRect(x, y, width * clamp(enemy.hp / enemy.maxHp, 0, 1), 3)
        }
    }

    private drawEnemyBody(enemy: Enemy, time: number) {
        const ctx = this.ctx
        const r = enemy.radius * (1 + Math.sin(time * 5 + enemy.phase) * 0.04)
        const flash = enemy.hitFlash > 0
        const color = enemy.color
        const fill = flash ? '#ffffff' : rgba(color, 0.22)
        const stroke = flash ? '#ffffff' : color
        ctx.lineWidth = 3.5
        ctx.lineJoin = 'round'

        switch (enemy.type) {
            case 'melee':
            case 'shard': {
                ctx.rotate(enemy.angle)
                polygonPath(ctx, 3, 0, 0, r, 0)
                ctx.fillStyle = fill
                ctx.fill()
                ctx.strokeStyle = stroke
                ctx.stroke()
                polygonPath(ctx, 3, r * 0.15, 0, r * 0.38, 0)
                ctx.fillStyle = flash ? '#ffffff' : color
                ctx.fill()
                break
            }
            case 'dasher': {
                const surge = Math.max(0, Math.sin(enemy.phase * 3.8))
                ctx.rotate(enemy.phase * (2 + surge * 6))
                if (surge > 0.5 && !this.denseVisuals) {
                    ctx.globalAlpha = 0.25
                    polygonPath(ctx, 4, -enemy.vx * 0.04, -enemy.vy * 0.04, r, 0)
                    ctx.strokeStyle = color
                    ctx.stroke()
                    ctx.globalAlpha = 1
                }
                polygonPath(ctx, 4, 0, 0, r, 0)
                ctx.fillStyle = fill
                ctx.fill()
                ctx.strokeStyle = stroke
                ctx.stroke()
                ctx.fillStyle = flash ? '#ffffff' : shade(color, 0.5)
                ctx.fillRect(-r * 0.2, -r * 0.2, r * 0.4, r * 0.4)
                break
            }
            case 'tank': {
                ctx.rotate(enemy.phase * 0.35)
                polygonPath(ctx, 6, 0, 0, r, 0)
                ctx.fillStyle = fill
                ctx.fill()
                ctx.strokeStyle = stroke
                ctx.lineWidth = 5
                ctx.stroke()
                ctx.lineWidth = 2.5
                polygonPath(ctx, 6, 0, 0, r * 0.62, Math.PI / 6)
                ctx.stroke()
                ctx.fillStyle = flash ? '#ffffff' : color
                polygonPath(ctx, 6, 0, 0, r * 0.28, 0)
                ctx.fill()
                break
            }
            case 'shooter': {
                const charging = enemy.fireCooldown < 0.35
                ctx.beginPath()
                ctx.arc(0, 0, r, 0, Math.PI * 2)
                ctx.fillStyle = fill
                ctx.fill()
                ctx.strokeStyle = stroke
                ctx.stroke()
                ctx.rotate(enemy.phase * 1.2)
                ctx.fillStyle = flash ? '#ffffff' : color
                for (let i = 0; i < 3; i++) {
                    ctx.rotate(Math.PI * 2 / 3)
                    ctx.fillRect(r - 2, -3, 8, 6)
                }
                ctx.beginPath()
                ctx.arc(0, 0, r * (charging ? 0.45 + Math.sin(time * 40) * 0.05 : 0.3), 0, Math.PI * 2)
                ctx.fillStyle = charging ? '#ffffff' : color
                ctx.fill()
                break
            }
            case 'splitter': {
                ctx.rotate(enemy.phase * 0.8)
                polygonPath(ctx, 5, 0, 0, r, 0)
                ctx.fillStyle = fill
                ctx.fill()
                ctx.strokeStyle = stroke
                ctx.stroke()
                // Glowing seams where it will crack apart.
                ctx.strokeStyle = flash ? '#ffffff' : shade(color, 0.55)
                ctx.lineWidth = 2
                ctx.beginPath()
                for (let i = 0; i < 3; i++) {
                    const angle = i / 3 * Math.PI * 2
                    ctx.moveTo(0, 0)
                    ctx.lineTo(Math.cos(angle) * r * 0.85, Math.sin(angle) * r * 0.85)
                }
                ctx.stroke()
                ctx.beginPath()
                ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2)
                ctx.fillStyle = '#ffffff'
                ctx.fill()
                break
            }
            case 'sniper': {
                ctx.rotate(enemy.angle)
                ctx.beginPath()
                ctx.moveTo(r * 1.5, 0)
                ctx.lineTo(0, r * 0.55)
                ctx.lineTo(-r, 0)
                ctx.lineTo(0, -r * 0.55)
                ctx.closePath()
                ctx.fillStyle = fill
                ctx.fill()
                ctx.strokeStyle = stroke
                ctx.stroke()
                const charging = enemy.state === 1
                ctx.beginPath()
                ctx.arc(r * 0.35, 0, r * (charging ? 0.32 : 0.22), 0, Math.PI * 2)
                ctx.fillStyle = charging && enemy.stateTimer < 0.28 && Math.sin(time * 60) > 0 ? '#ffffff' : color
                ctx.fill()
                break
            }
            case 'bomber': {
                const armed = enemy.state === 1
                const pulse = armed ? 1 + (1 - Math.max(0, enemy.stateTimer) / 0.85) * 0.35 : 1
                const blink = armed && Math.sin(time * (30 + (0.85 - enemy.stateTimer) * 60)) > 0
                ctx.rotate(enemy.phase * (armed ? 6 : 1.5))
                starPath(ctx, 8, 0, 0, r * 1.15 * pulse, r * 0.6 * pulse, 0)
                ctx.fillStyle = blink || flash ? '#ffffff' : fill
                ctx.fill()
                ctx.strokeStyle = blink ? '#ffffff' : stroke
                ctx.stroke()
                ctx.beginPath()
                ctx.arc(0, 0, r * 0.3 * pulse, 0, Math.PI * 2)
                ctx.fillStyle = armed ? '#ffffff' : color
                ctx.fill()
                break
            }
            case 'warden': {
                ctx.rotate(enemy.angle)
                polygonPath(ctx, 8, 0, 0, r, Math.PI / 8)
                ctx.fillStyle = fill
                ctx.fill()
                ctx.strokeStyle = stroke
                ctx.lineWidth = 4
                ctx.stroke()
                ctx.lineWidth = 2
                ctx.beginPath()
                ctx.arc(0, 0, r * 0.55, time * 2, time * 2 + Math.PI * 1.4)
                ctx.stroke()
                ctx.fillStyle = flash ? '#ffffff' : '#dbeafe'
                polygonPath(ctx, 4, 0, 0, r * 0.25, time)
                ctx.fill()
                break
            }
            default: {
                polygonPath(ctx, TYPE_SIDES[enemy.type] ?? 5, 0, 0, r, 0)
                ctx.fillStyle = fill
                ctx.fill()
                ctx.strokeStyle = stroke
                ctx.stroke()
            }
        }
        if (enemy.shielded) {
            ctx.globalAlpha = 0.45 + Math.sin(time * 6 + enemy.phase) * 0.15
            ctx.strokeStyle = '#93c5fd'
            ctx.lineWidth = 2
            polygonPath(ctx, 6, 0, 0, r + 8, time * 0.8)
            ctx.stroke()
            ctx.globalAlpha = 1
        }
        if (enemy.elite) {
            ctx.strokeStyle = '#facc15'
            ctx.lineWidth = 2.5
            ctx.setLineDash([6, 6])
            ctx.lineDashOffset = -time * 40
            ctx.beginPath()
            ctx.arc(0, 0, r + 12, 0, Math.PI * 2)
            ctx.stroke()
            ctx.setLineDash([])
        }
        if (enemy.type === 'bomber' && enemy.state === 1) {
            const progress = 1 - Math.max(0, enemy.stateTimer) / 0.85
            ctx.globalAlpha = 0.2 + progress * 0.4
            ctx.strokeStyle = '#ef4444'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(0, 0, SHAPEZZ_BOMBER_BLAST_RADIUS * (enemy.elite ? 1.3 : 1), 0, Math.PI * 2)
            ctx.stroke()
            ctx.globalAlpha = 1
        }
    }

    private drawSniperSights(time: number) {
        const ctx = this.ctx
        for (const enemy of this.engine.enemies) {
            if (enemy.type !== 'sniper' || enemy.state !== 1) continue
            const locked = enemy.stateTimer < 0.28
            const endX = enemy.x + Math.cos(enemy.angle) * 1600
            const endY = enemy.y + Math.sin(enemy.angle) * 1600
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = locked ? (Math.sin(time * 60) > 0 ? 0.95 : 0.4) : 0.2 + (1.05 - enemy.stateTimer) * 0.35
            ctx.strokeStyle = locked ? '#ffffff' : enemy.color
            ctx.lineWidth = locked ? 2.5 : 1.2
            ctx.beginPath()
            ctx.moveTo(enemy.x, enemy.y)
            ctx.lineTo(endX, endY)
            ctx.stroke()
            ctx.globalCompositeOperation = 'source-over'
        }
        ctx.globalAlpha = 1
    }

    private drawBoss(enemy: Enemy, time: number) {
        const ctx = this.ctx
        const config = SHAPEZZ_BOSSES[enemy.bossKind ?? 'overseer']
        const r = enemy.radius * (1 + Math.sin(time * 3) * 0.03)
        const flash = enemy.hitFlash > 0
        const color = enemy.color
        const enraged = enemy.bossPhase >= 2
        ctx.lineJoin = 'round'

        switch (enemy.bossKind) {
            case 'prism': {
                ctx.rotate(enemy.angle)
                polygonPath(ctx, 3, 0, 0, r, 0)
                ctx.fillStyle = rgba(flash ? '#ffffff' : color, flash ? 0.4 : 0.25)
                ctx.fill()
                ctx.strokeStyle = color
                ctx.lineWidth = 6
                ctx.stroke()
                ctx.lineWidth = 2
                ctx.strokeStyle = config.accent
                polygonPath(ctx, 3, 0, 0, r * 0.55, Math.PI)
                ctx.stroke()
                ctx.beginPath()
                for (let i = 0; i < 3; i++) {
                    const angle = i / 3 * Math.PI * 2
                    ctx.moveTo(0, 0)
                    ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r)
                }
                ctx.stroke()
                // Refraction glints at the vertices.
                ctx.globalCompositeOperation = 'lighter'
                const glints = ['#f472b6', '#facc15', '#22d3ee']
                for (let i = 0; i < 3; i++) {
                    const angle = i / 3 * Math.PI * 2
                    const size = 34 + Math.sin(time * 6 + i) * 8
                    ctx.drawImage(this.sprites.core(glints[i]!), Math.cos(angle) * r - size / 2, Math.sin(angle) * r - size / 2, size, size)
                }
                ctx.globalCompositeOperation = 'source-over'
                break
            }
            case 'hive': {
                ctx.rotate(enemy.angle * 0.5)
                polygonPath(ctx, 6, 0, 0, r, 0)
                ctx.fillStyle = rgba(flash ? '#ffffff' : color, flash ? 0.4 : 0.2)
                ctx.fill()
                ctx.strokeStyle = color
                ctx.lineWidth = 6
                ctx.stroke()
                // Honeycomb brood cells, pulsing out of phase.
                const cell = r * 0.26
                const offsets: [number, number][] = [[0, 0]]
                for (let i = 0; i < 6; i++) offsets.push([Math.cos(i / 6 * Math.PI * 2 + Math.PI / 6) * cell * 1.8, Math.sin(i / 6 * Math.PI * 2 + Math.PI / 6) * cell * 1.8])
                ctx.lineWidth = 2
                offsets.forEach(([x, y], i) => {
                    polygonPath(ctx, 6, x, y, cell * 0.92, 0)
                    ctx.fillStyle = rgba(config.accent, 0.15 + Math.max(0, Math.sin(time * 4 + i)) * 0.45)
                    ctx.fill()
                    ctx.strokeStyle = color
                    ctx.stroke()
                })
                // Escort drones buzzing around.
                ctx.fillStyle = config.accent
                for (let i = 0; i < 5; i++) {
                    const angle = time * (2 + i * 0.3) + i
                    polygonPath(ctx, 3, Math.cos(angle) * r * 1.35, Math.sin(angle) * r * 1.35, 6, angle)
                    ctx.fill()
                }
                break
            }
            case 'polygon': {
                const sides = Math.max(3, Math.round(enemy.sides))
                const glitch = enraged || Math.sin(time * 7) > 0.92
                if (glitch && !this.denseVisuals) {
                    ctx.globalCompositeOperation = 'lighter'
                    ctx.lineWidth = 4
                    ctx.strokeStyle = 'rgba(34,211,238,0.6)'
                    polygonPath(ctx, sides, -5, 0, r, enemy.angle)
                    ctx.stroke()
                    ctx.strokeStyle = 'rgba(244,63,94,0.6)'
                    polygonPath(ctx, sides, 5, 0, r, enemy.angle)
                    ctx.stroke()
                    ctx.globalCompositeOperation = 'source-over'
                }
                polygonPath(ctx, sides, 0, 0, r, enemy.angle)
                ctx.fillStyle = rgba(flash ? '#ffffff' : color, flash ? 0.4 : 0.22)
                ctx.fill()
                ctx.strokeStyle = color
                ctx.lineWidth = 7
                ctx.stroke()
                ctx.lineWidth = 2.5
                ctx.strokeStyle = config.accent
                polygonPath(ctx, Math.max(3, sides - 1), 0, 0, r * 0.65, -enemy.angle * 2)
                ctx.stroke()
                polygonPath(ctx, sides + 2, 0, 0, r * 0.35, enemy.angle * 3)
                ctx.stroke()
                ctx.beginPath()
                ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2)
                ctx.fillStyle = '#ffffff'
                ctx.fill()
                break
            }
            default: {
                // The Overseer: a nine-sided eye with a crown of blades.
                ctx.save()
                ctx.rotate(enemy.angle)
                polygonPath(ctx, 9, 0, 0, r, 0)
                ctx.fillStyle = rgba(flash ? '#ffffff' : color, flash ? 0.4 : 0.2)
                ctx.fill()
                ctx.strokeStyle = color
                ctx.lineWidth = 7
                ctx.stroke()
                ctx.fillStyle = color
                for (let i = 0; i < 9; i++) {
                    const angle = i / 9 * Math.PI * 2
                    polygonPath(ctx, 3, Math.cos(angle) * (r + 14), Math.sin(angle) * (r + 14), 9, angle)
                    ctx.fill()
                }
                ctx.restore()
                const look = Math.atan2(this.engine.player.y - enemy.y, this.engine.player.x - enemy.x)
                ctx.beginPath()
                ctx.ellipse(0, 0, r * 0.55, r * 0.38, 0, 0, Math.PI * 2)
                ctx.fillStyle = '#0b0214'
                ctx.fill()
                ctx.strokeStyle = config.accent
                ctx.lineWidth = 3
                ctx.stroke()
                const pupilX = Math.cos(look) * r * 0.2
                const pupilY = Math.sin(look) * r * 0.12
                ctx.beginPath()
                ctx.arc(pupilX, pupilY, r * (enraged ? 0.2 : 0.16), 0, Math.PI * 2)
                ctx.fillStyle = enraged ? '#fb7185' : color
                ctx.fill()
                ctx.beginPath()
                ctx.arc(pupilX, pupilY, r * 0.06, 0, Math.PI * 2)
                ctx.fillStyle = '#ffffff'
                ctx.fill()
            }
        }
        if (enraged) {
            ctx.globalAlpha = 0.35 + Math.sin(time * 10) * 0.2
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(0, 0, r + 24 + Math.sin(time * 5) * 4, 0, Math.PI * 2)
            ctx.stroke()
            ctx.globalAlpha = 1
        }
    }

    private drawDebris() {
        const ctx = this.ctx
        for (const piece of this.engine.debris) {
            const alpha = clamp(piece.life / piece.maxLife * 1.5, 0, 1)
            ctx.globalAlpha = alpha
            ctx.fillStyle = piece.color
            const cos = Math.cos(piece.rotation)
            const sin = Math.sin(piece.rotation)
            const s = piece.size
            ctx.beginPath()
            ctx.moveTo(piece.x + cos * s, piece.y + sin * s)
            ctx.lineTo(piece.x - cos * s * 0.5 - sin * s * 0.6, piece.y - sin * s * 0.5 + cos * s * 0.6)
            ctx.lineTo(piece.x - cos * s * 0.5 + sin * s * 0.4, piece.y - sin * s * 0.5 - cos * s * 0.4)
            ctx.closePath()
            ctx.fill()
        }
        ctx.globalAlpha = 1
    }

    // ─── Projectiles ────────────────────────────────────────────────────────

    private drawPlayerBullets() {
        const ctx = this.ctx
        const bullets = this.engine.bullets
        const dense = this.denseVisuals
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        // Streaks first, so the hot cores sit on top.
        if (!dense) {
            for (const bullet of bullets) {
                if (bullet.life <= 0) continue
                const dx = bullet.x - bullet.prevX
                const dy = bullet.y - bullet.prevY
                if (dx * dx + dy * dy < 4) continue
                ctx.globalAlpha = 0.55
                ctx.strokeStyle = bullet.color
                ctx.lineWidth = bullet.radius * 1.3
                ctx.beginPath()
                ctx.moveTo(bullet.prevX - dx * 0.8, bullet.prevY - dy * 0.8)
                ctx.lineTo(bullet.x, bullet.y)
                ctx.stroke()
            }
        }
        ctx.globalAlpha = 1
        for (const bullet of bullets) {
            if (bullet.life <= 0) continue
            // On-kill swarms (novas, shards) stay dimmer so hostile shots keep reading on top.
            ctx.globalAlpha = bullet.priority === 0 ? 0.55 : 1
            const size = bullet.radius * (dense ? 3.2 : 4.4 + bullet.visualIntensity * 0.25)
            ctx.drawImage(this.sprites.core(bullet.color), bullet.x - size / 2, bullet.y - size / 2, size, size)
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.lineCap = 'butt'
    }

    /** Hostile shots get a white core and a dark rim so they read against any effect. */
    private drawEnemyBullets(time: number) {
        const ctx = this.ctx
        const bullets = this.engine.enemyBullets
        this.drawSniperSights(time)
        ctx.globalCompositeOperation = 'lighter'
        for (const bullet of bullets) {
            const size = bullet.radius * (this.denseVisuals ? 3.5 : 5)
            ctx.globalAlpha = 0.8
            ctx.drawImage(this.sprites.glow(bullet.color), bullet.x - size / 2, bullet.y - size / 2, size, size)
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        for (const bullet of bullets) {
            ctx.fillStyle = bullet.color
            ctx.strokeStyle = 'rgba(0,0,0,0.65)'
            ctx.lineWidth = 2
            switch (bullet.shape) {
                case 'needle': {
                    const angle = Math.atan2(bullet.vy, bullet.vx)
                    const length = bullet.radius * 4.5
                    ctx.lineCap = 'round'
                    ctx.strokeStyle = bullet.color
                    ctx.lineWidth = bullet.radius * 1.6
                    ctx.beginPath()
                    ctx.moveTo(bullet.x - Math.cos(angle) * length, bullet.y - Math.sin(angle) * length)
                    ctx.lineTo(bullet.x, bullet.y)
                    ctx.stroke()
                    ctx.strokeStyle = '#ffffff'
                    ctx.lineWidth = bullet.radius * 0.6
                    ctx.stroke()
                    ctx.lineCap = 'butt'
                    break
                }
                case 'star':
                    starPath(ctx, 4, bullet.x, bullet.y, bullet.radius * 1.5, bullet.radius * 0.6, bullet.spin)
                    ctx.fill()
                    ctx.stroke()
                    ctx.fillStyle = '#ffffff'
                    ctx.beginPath()
                    ctx.arc(bullet.x, bullet.y, bullet.radius * 0.35, 0, Math.PI * 2)
                    ctx.fill()
                    break
                case 'wave': {
                    const height = bullet.radius * 2.4
                    ctx.beginPath()
                    ctx.moveTo(bullet.x - bullet.radius, FLOOR_Y)
                    ctx.quadraticCurveTo(bullet.x, bullet.y - height, bullet.x + bullet.radius, FLOOR_Y)
                    ctx.closePath()
                    ctx.fill()
                    ctx.strokeStyle = '#ffffff'
                    ctx.stroke()
                    break
                }
                default:
                    ctx.beginPath()
                    ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2)
                    ctx.fill()
                    ctx.stroke()
                    ctx.fillStyle = '#ffffff'
                    ctx.beginPath()
                    ctx.arc(bullet.x, bullet.y, bullet.radius * 0.45, 0, Math.PI * 2)
                    ctx.fill()
            }
        }
    }

    // ─── Player and companions ──────────────────────────────────────────────

    private updateTrail(dt: number) {
        const player = this.engine.player
        this.trailTimer -= dt
        const fast = Math.hypot(player.vx, player.vy) > 420
        if (fast && this.trailTimer <= 0 && this.engine.running) {
            this.trail.push({ x: player.x, y: player.y, sx: player.scaleX, sy: player.scaleY })
            this.trailTimer = 0.025
        } else if (!fast && this.trailTimer <= -0.06) {
            this.trail.shift()
            this.trailTimer = 0
        }
        if (this.trail.length > 6) this.trail.shift()
    }

    private drawPlayer(time: number) {
        const ctx = this.ctx
        const engine = this.engine
        const player = engine.player
        const weapon = engine.weapon
        if (player.hp <= 0 && !engine.running) return
        const angle = Math.atan2(engine.aim.y - player.y, engine.aim.x - player.x)
        const half = player.size / 2

        // Motion afterimages.
        ctx.globalCompositeOperation = 'lighter'
        this.trail.forEach((ghost, i) => {
            ctx.globalAlpha = (i + 1) / this.trail.length * 0.22
            ctx.strokeStyle = weapon.primaryColor
            ctx.lineWidth = 2
            ctx.strokeRect(ghost.x - half * ghost.sx, ghost.y - half * ghost.sy, player.size * ghost.sx, player.size * ghost.sy)
        })
        ctx.globalAlpha = 0.5
        ctx.drawImage(this.sprites.glow(weapon.primaryColor), player.x - 60, player.y - 60, 120, 120)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'

        if (weapon.visualIntensity >= 2) {
            ctx.save()
            ctx.translate(player.x, player.y)
            ctx.strokeStyle = weapon.primaryColor
            ctx.globalAlpha = 0.2 + weapon.visualIntensity * 0.055
            ctx.lineWidth = 1 + weapon.visualIntensity * 0.5
            ctx.setLineDash([7, 8])
            ctx.lineDashOffset = -time * (20 + weapon.visualIntensity * 8)
            ctx.beginPath()
            ctx.arc(0, 0, 29 + weapon.visualIntensity * 3, 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
        }

        if (player.shield > 0) {
            const capacity = engine.upgrades.aegisPlating ? shapezzShieldStats(engine.upgrades.aegisPlating).capacity : player.shield
            const strength = clamp(player.shield / Math.max(1, capacity), 0, 1)
            ctx.save()
            ctx.translate(player.x, player.y)
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.15 + strength * 0.2
            ctx.drawImage(this.sprites.glow('#38bdf8'), -52, -52, 104, 104)
            ctx.globalAlpha = 0.45 + strength * 0.45
            ctx.strokeStyle = '#7dd3fc'
            ctx.lineWidth = 2.5
            polygonPath(ctx, 6, 0, 0, player.size * 0.9, time * 0.6)
            ctx.stroke()
            ctx.globalCompositeOperation = 'source-over'
            ctx.restore()
        }

        ctx.save()
        ctx.translate(player.x, player.y + half)
        ctx.scale(player.scaleX, player.scaleY)
        ctx.translate(0, -half)
        if (player.invulnerable > 0 && Math.floor(time * 28) % 2 === 0) ctx.globalAlpha = 0.4
        const body = ctx.createLinearGradient(0, -half, 0, half)
        body.addColorStop(0, '#ffffff')
        body.addColorStop(1, shade(weapon.primaryColor, 0.55))
        ctx.fillStyle = body
        ctx.fillRect(-half, -half, player.size, player.size)
        ctx.strokeStyle = weapon.primaryColor
        ctx.lineWidth = 3.5
        ctx.strokeRect(-half, -half, player.size, player.size)
        // Visor band with an eye that follows the aim.
        ctx.fillStyle = '#0b1220'
        ctx.fillRect(-half + 5, -half + 9, player.size - 10, 10)
        const lookX = Math.cos(angle) * 7
        const lookY = Math.sin(angle) * 2
        ctx.fillStyle = weapon.primaryColor
        ctx.fillRect(-4 + lookX, -half + 11 + lookY, 8, 6)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(-2 + lookX, -half + 12 + lookY, 3, 3)
        if (player.hurtFlash > 0) {
            ctx.globalAlpha = player.hurtFlash * 0.8
            ctx.fillStyle = '#fb7185'
            ctx.fillRect(-half, -half, player.size, player.size)
        }
        ctx.restore()

        // The gun, with recoil.
        ctx.save()
        ctx.translate(player.x, player.y - 2)
        ctx.rotate(angle)
        const kick = player.recoil * (weapon.type === 'launcher' || weapon.type === 'railgun' ? 9 : weapon.type === 'shotgun' ? 7 : 4)
        ctx.translate(-kick, 0)
        const gunHeight = weapon.type === 'launcher' ? 18 : weapon.type === 'shotgun' ? 20 : weapon.type === 'arcCoil' ? 19 : weapon.type === 'railgun' ? 10 : 12
        const gunLength = weapon.type === 'launcher' ? 42 : weapon.type === 'arcCoil' ? 30 : weapon.type === 'railgun' ? 52 : weapon.type === 'shotgun' ? 30 : 35
        ctx.fillStyle = '#0b1220'
        ctx.fillRect(6, -gunHeight / 2 - 2, gunLength + 4, gunHeight + 4)
        ctx.fillStyle = weapon.primaryColor
        ctx.fillRect(8, -gunHeight / 2, gunLength, gunHeight)
        ctx.fillStyle = weapon.accentColor
        if (weapon.type === 'arcCoil') {
            ctx.strokeStyle = weapon.accentColor
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(24, 0, 9, 0, Math.PI * 2)
            ctx.stroke()
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.5 + Math.sin(time * 30) * 0.3
            ctx.drawImage(this.sprites.core(weapon.primaryColor), 12, -12, 24, 24)
            ctx.globalAlpha = 1
            ctx.globalCompositeOperation = 'source-over'
        } else if (weapon.type === 'railgun') {
            // Twin rails with a charge strip that glows between shots.
            ctx.fillRect(14, -8, gunLength - 4, 3)
            ctx.fillRect(14, 5, gunLength - 4, 3)
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.4 + (1 - player.recoil) * 0.6
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(16, -1.5, (gunLength - 8) * (1 - player.recoil * 0.8), 3)
            ctx.globalAlpha = 1
            ctx.globalCompositeOperation = 'source-over'
        } else if (weapon.type === 'shotgun') {
            // A pod of missile tubes.
            ctx.fillStyle = '#0b1220'
            for (let i = 0; i < 3; i++) {
                ctx.beginPath()
                ctx.arc(gunLength + 4, -6 + i * 6, 2.4, 0, Math.PI * 2)
                ctx.fill()
            }
            ctx.fillStyle = weapon.accentColor
            ctx.fillRect(12, -gunHeight / 2 - 3, gunLength - 10, 3)
        } else {
            ctx.fillRect(32, -3, 16, 6)
        }
        if (player.muzzleFlash > 0) {
            ctx.globalCompositeOperation = 'lighter'
            const flashSize = (weapon.type === 'launcher' || weapon.type === 'railgun' ? 64 : weapon.type === 'shotgun' ? 56 : 38) * (0.7 + Math.random() * 0.5)
            ctx.drawImage(this.sprites.core(weapon.primaryColor), gunLength + 6 - flashSize / 2, -flashSize / 2, flashSize, flashSize)
            ctx.globalCompositeOperation = 'source-over'
        }
        ctx.restore()
    }

    private drawCompanions(time: number) {
        const ctx = this.ctx
        const engine = this.engine
        const ceilingBatteries = Math.min(6, engine.upgrades.ceilingBattery ?? 0)
        for (let i = 0; i < ceilingBatteries; i++) {
            const position = engine.ceilingBatteryPosition(i, ceilingBatteries)
            const target = engine.nearestEnemy(position, 920)
            const angle = target ? Math.atan2(target.y - position.y, target.x - position.x) : Math.PI / 2
            ctx.fillStyle = '#1a2e05'
            ctx.fillRect(position.x - 3, 0, 6, position.y - 8)
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.5
            ctx.drawImage(this.sprites.glow('#a3e635'), position.x - 34, position.y - 34, 68, 68)
            ctx.globalAlpha = 1
            ctx.globalCompositeOperation = 'source-over'
            ctx.save()
            ctx.translate(position.x, position.y)
            ctx.rotate(angle)
            ctx.fillStyle = '#18230d'
            ctx.strokeStyle = '#a3e635'
            ctx.lineWidth = 3
            polygonPath(ctx, 6, 0, 0, 15, 0)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = '#a3e635'
            ctx.fillRect(7, -4, 25, 8)
            ctx.fillStyle = '#ecfccb'
            ctx.fillRect(-3, -3, 6, 6)
            ctx.restore()
        }

        const drones = engine.dronePositions(time)
        for (let i = 0; i < drones.length; i++) {
            const drone = drones[i]!
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.6
            ctx.drawImage(this.sprites.glow('#34d399'), drone.x - 22, drone.y - 22, 44, 44)
            ctx.globalAlpha = 0.4 + Math.random() * 0.4
            ctx.drawImage(this.sprites.core('#34d399'), drone.x - 6, drone.y + 6, 12, 14)
            ctx.globalAlpha = 1
            ctx.globalCompositeOperation = 'source-over'
            ctx.strokeStyle = '#34d399'
            ctx.fillStyle = '#052e1c'
            ctx.lineWidth = 2.5
            polygonPath(ctx, 3, drone.x, drone.y, 10, -Math.PI / 2)
            ctx.fill()
            ctx.stroke()
        }

        const orbitals = engine.orbitalPositions()
        if (orbitals.length) {
            ctx.globalAlpha = 0.12
            ctx.strokeStyle = '#f0abfc'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.arc(engine.player.x, engine.player.y, 72, 0, Math.PI * 2)
            ctx.stroke()
            ctx.globalAlpha = 1
        }
        for (const orbital of orbitals) {
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.6
            ctx.drawImage(this.sprites.glow('#f0abfc'), orbital.x - 20, orbital.y - 20, 40, 40)
            ctx.globalAlpha = 1
            ctx.globalCompositeOperation = 'source-over'
            ctx.fillStyle = '#f0abfc'
            polygonPath(ctx, 4, orbital.x, orbital.y, 9, time * 4)
            ctx.fill()
            ctx.fillStyle = '#ffffff'
            polygonPath(ctx, 4, orbital.x, orbital.y, 3.5, time * 4)
            ctx.fill()
        }

        for (const turret of engine.turrets) {
            const alpha = clamp(turret.life / 0.8, 0, 1)
            ctx.globalAlpha = alpha * 0.5
            ctx.globalCompositeOperation = 'lighter'
            ctx.drawImage(this.sprites.glow('#2dd4bf'), turret.x - 24, turret.y - 24, 48, 48)
            ctx.globalCompositeOperation = 'source-over'
            ctx.globalAlpha = alpha
            ctx.save()
            ctx.translate(turret.x, turret.y)
            ctx.rotate(turret.angle)
            ctx.fillStyle = '#042f2e'
            ctx.strokeStyle = '#2dd4bf'
            ctx.lineWidth = 2
            ctx.fillRect(-10, -10, 20, 20)
            ctx.strokeRect(-10, -10, 20, 20)
            ctx.fillStyle = '#2dd4bf'
            ctx.fillRect(6 - turret.recoil * 4, -3, 20, 6)
            ctx.restore()
        }
        ctx.globalAlpha = 1
    }

    // ─── Effects ────────────────────────────────────────────────────────────

    private drawBeams() {
        const ctx = this.ctx
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        for (const beam of this.engine.beams) {
            const alpha = clamp(beam.life / beam.maxLife, 0, 1)
            ctx.beginPath()
            ctx.moveTo(beam.from.x, beam.from.y)
            if (beam.jagged) {
                const dx = beam.to.x - beam.from.x
                const dy = beam.to.y - beam.from.y
                const length = Math.hypot(dx, dy) || 1
                const nx = -dy / length
                const ny = dx / length
                const segments = Math.max(3, Math.min(8, Math.round(length / 40)))
                for (let i = 1; i < segments; i++) {
                    const t = i / segments
                    const offset = (Math.random() - 0.5) * Math.min(34, length * 0.18)
                    ctx.lineTo(beam.from.x + dx * t + nx * offset, beam.from.y + dy * t + ny * offset)
                }
            }
            ctx.lineTo(beam.to.x, beam.to.y)
            ctx.globalAlpha = alpha * 0.35
            ctx.strokeStyle = beam.color
            ctx.lineWidth = beam.width * 3
            ctx.stroke()
            ctx.globalAlpha = alpha
            ctx.lineWidth = beam.width
            ctx.stroke()
            if (beam.jagged) {
                ctx.strokeStyle = '#ffffff'
                ctx.lineWidth = Math.max(1, beam.width * 0.35)
                ctx.stroke()
            }
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        ctx.lineCap = 'butt'
    }

    private drawLances() {
        const ctx = this.ctx
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        for (const lance of this.engine.lances) {
            const t = lance.life / lance.maxLife
            const width = lance.width * (0.35 + t * 0.65)
            ctx.beginPath()
            ctx.moveTo(lance.from.x, lance.from.y)
            ctx.lineTo(lance.to.x, lance.to.y)
            ctx.globalAlpha = t * 0.3
            ctx.strokeStyle = lance.glow
            ctx.lineWidth = width * 2.6
            ctx.stroke()
            ctx.globalAlpha = t * 0.9
            ctx.strokeStyle = lance.color
            ctx.lineWidth = width
            ctx.stroke()
            ctx.globalAlpha = t
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = width * 0.4
            ctx.stroke()
            const size = width * 4
            ctx.drawImage(this.sprites.core(lance.color), lance.from.x - size / 2, lance.from.y - size / 2, size, size)
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        ctx.lineCap = 'butt'
    }

    private drawParticles() {
        const ctx = this.ctx
        const particles = this.engine.particles
        // Smoke darkens, so it goes down first with normal blending.
        const smoke = this.sprites.smokePuff()
        for (const particle of particles) {
            if (particle.kind !== 'smoke') continue
            const t = 1 - particle.life / particle.maxLife
            const size = particle.size * (1 + (particle.grow - 1) * t) * 2
            ctx.globalAlpha = (1 - t) * 0.9
            ctx.drawImage(smoke, particle.x - size / 2, particle.y - size / 2, size, size)
        }
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        for (const particle of particles) {
            if (particle.kind === 'smoke') continue
            const life = clamp(particle.life / particle.maxLife, 0, 1)
            const t = 1 - life
            const size = particle.size * (1 + (particle.grow - 1) * t)
            switch (particle.kind) {
                case 'glow': {
                    ctx.globalAlpha = life
                    const sprite = particle.color === '#ffffff' ? this.sprites.core('#ffffff') : this.sprites.glow(particle.color)
                    ctx.drawImage(sprite, particle.x - size / 2, particle.y - size / 2, size, size)
                    break
                }
                case 'spark': {
                    ctx.globalAlpha = life
                    ctx.strokeStyle = particle.color
                    ctx.lineWidth = Math.max(1, size)
                    ctx.beginPath()
                    ctx.moveTo(particle.x, particle.y)
                    ctx.lineTo(particle.x - particle.vx * 0.035, particle.y - particle.vy * 0.035)
                    ctx.stroke()
                    break
                }
                case 'ring':
                    ctx.globalAlpha = life
                    ctx.strokeStyle = particle.color
                    ctx.lineWidth = 2
                    ctx.beginPath()
                    ctx.arc(particle.x, particle.y, size, 0, Math.PI * 2)
                    ctx.stroke()
                    break
                case 'square':
                    ctx.globalAlpha = life
                    ctx.fillStyle = particle.color
                    ctx.fillRect(particle.x - size / 2, particle.y - size / 2, size, size)
                    break
                default:
                    ctx.globalAlpha = life
                    if (this.denseVisuals) {
                        ctx.fillStyle = particle.color
                        ctx.fillRect(particle.x - size / 2, particle.y - size / 2, size, size)
                    } else {
                        const glowSize = size * 3
                        ctx.drawImage(this.sprites.core(particle.color), particle.x - glowSize / 2, particle.y - glowSize / 2, glowSize, glowSize)
                    }
            }
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        ctx.lineCap = 'butt'
    }

    private drawShockwaves() {
        const ctx = this.ctx
        ctx.globalCompositeOperation = 'lighter'
        for (const wave of this.engine.shockwaves) {
            const life = clamp(wave.life / wave.maxLife, 0, 1)
            if (wave.fill && life > 0.5 && !this.denseVisuals) {
                ctx.globalAlpha = (life - 0.5) * 0.9
                const size = wave.radius * 2.2
                ctx.drawImage(this.sprites.glow(wave.color), wave.x - size / 2, wave.y - size / 2, size, size)
            }
            ctx.globalAlpha = life
            ctx.strokeStyle = wave.color
            ctx.lineWidth = Math.max(0.5, wave.width * life)
            ctx.beginPath()
            ctx.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2)
            ctx.stroke()
            if (wave.width >= 6) {
                ctx.globalAlpha = life * 0.6
                ctx.strokeStyle = '#ffffff'
                ctx.lineWidth = Math.max(0.5, wave.width * life * 0.3)
                ctx.stroke()
            }
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
    }

    private drawTexts() {
        const ctx = this.ctx
        const texts = this.engine.damageTexts
        const crowded = texts.length > 70
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        for (const text of texts) {
            if (crowded && !text.crit && text.size < 18) continue
            const life = clamp(text.life / text.maxLife, 0, 1)
            const age = 1 - life
            const pop = age < 0.12 ? 1.6 - age / 0.12 * 0.6 : 1
            const size = Math.round(text.size * pop)
            ctx.globalAlpha = Math.min(1, life * 2.5)
            ctx.font = `900 ${size}px ui-sans-serif, system-ui, sans-serif`
            ctx.strokeStyle = 'rgba(0,0,0,0.8)'
            ctx.lineWidth = 4
            ctx.strokeText(text.text, text.x, text.y)
            ctx.fillStyle = text.color
            ctx.fillText(text.text, text.x, text.y)
        }
        ctx.globalAlpha = 1
        ctx.textBaseline = 'alphabetic'
    }

    // ─── Screen-space overlays ──────────────────────────────────────────────

    private drawPost(time: number) {
        const ctx = this.ctx
        const engine = this.engine
        if (engine.flash > 0) {
            ctx.globalCompositeOperation = 'lighter'
            ctx.fillStyle = rgba(engine.flashColor, Math.min(0.4, engine.flash * 0.3))
            ctx.fillRect(0, 0, WIDTH, HEIGHT)
            ctx.globalCompositeOperation = 'source-over'
        }
        if (this.vignette) ctx.drawImage(this.vignette, 0, 0, WIDTH, HEIGHT)
        // Heartbeat vignette when the hull is failing.
        const hull = engine.player.hp / Math.max(1, engine.stats.maxHp)
        if (engine.running && hull < 0.35) {
            const beat = Math.pow(Math.max(0, Math.sin(time * (hull < 0.15 ? 9 : 6))), 4)
            const strength = (0.35 - hull) / 0.35
            const gradient = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 260, WIDTH / 2, HEIGHT / 2, 720)
            gradient.addColorStop(0, 'rgba(244,63,94,0)')
            gradient.addColorStop(1, `rgba(244,63,94,${(0.25 + beat * 0.3) * strength})`)
            ctx.fillStyle = gradient
            ctx.fillRect(0, 0, WIDTH, HEIGHT)
        }
        if (this.scanlines) {
            ctx.fillStyle = this.scanlines
            ctx.globalAlpha = 0.5
            ctx.fillRect(0, 0, WIDTH, HEIGHT)
            ctx.globalAlpha = 1
        }
    }

    /** Arrows on the arena edge for shapes about to walk in. */
    private drawEdgeIndicators(time: number) {
        const ctx = this.ctx
        for (const enemy of this.engine.enemies) {
            const left = enemy.x < -enemy.radius * 0.5
            const right = enemy.x > WIDTH + enemy.radius * 0.5
            if (!left && !right) continue
            const x = left ? 12 : WIDTH - 12
            const y = clamp(enemy.y, 20, HEIGHT - 20)
            const direction = left ? -1 : 1
            ctx.globalAlpha = 0.6 + Math.sin(time * 10 + enemy.id) * 0.3
            ctx.fillStyle = enemy.elite ? '#facc15' : enemy.color
            ctx.beginPath()
            ctx.moveTo(x + direction * 6, y)
            ctx.lineTo(x - direction * 6, y - 8)
            ctx.lineTo(x - direction * 6, y + 8)
            ctx.closePath()
            ctx.fill()
        }
        ctx.globalAlpha = 1
    }

    private drawBossBars(time: number) {
        const ctx = this.ctx
        const bosses = this.engine.enemies.filter(enemy => enemy.boss)
        // Top centre, between the hull panel and the cash offer; an escort boss sits side by side.
        const gap = 24
        const width = bosses.length > 1 ? 260 : 400
        const total = bosses.length * width + (bosses.length - 1) * gap
        bosses.forEach((boss, index) => {
            const config = SHAPEZZ_BOSSES[boss.bossKind ?? 'overseer']
            const x = WIDTH / 2 - total / 2 + index * (width + gap)
            const y = 14
            const ratio = clamp(boss.hp / boss.maxHp, 0, 1)
            const shown = clamp(boss.hpShown / boss.maxHp, 0, 1)
            ctx.fillStyle = 'rgba(0,0,0,0.7)'
            ctx.fillRect(x - 4, y - 4, width + 8, 16)
            ctx.fillStyle = 'rgba(255,255,255,0.75)'
            ctx.fillRect(x, y, width * shown, 8)
            const bar = ctx.createLinearGradient(x, 0, x + width, 0)
            bar.addColorStop(0, shade(boss.color, -0.2))
            bar.addColorStop(1, shade(boss.color, 0.3))
            ctx.fillStyle = bar
            ctx.fillRect(x, y, width * ratio, 8)
            ctx.fillStyle = 'rgba(0,0,0,0.8)'
            ctx.fillRect(x + width * 0.66 - 1, y - 2, 2, 12)
            ctx.fillRect(x + width * 0.33 - 1, y - 2, 2, 12)
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = 0.5 + Math.sin(time * 4) * 0.15
            ctx.drawImage(this.sprites.glow(boss.color), x + width * ratio - 20, y - 16, 40, 40)
            ctx.globalAlpha = 1
            ctx.globalCompositeOperation = 'source-over'
            ctx.font = '900 12px ui-sans-serif, system-ui, sans-serif'
            ctx.textAlign = 'center'
            ctx.lineWidth = 3
            ctx.strokeStyle = 'rgba(0,0,0,0.9)'
            const label = `${config.name}${boss.bossPhase >= 2 ? ' · ENRAGED' : ''}`
            ctx.strokeText(label, x + width / 2, y + 24)
            ctx.fillStyle = '#ffffff'
            ctx.fillText(label, x + width / 2, y + 24)
        })
    }

    private drawAimCursor(time: number) {
        const ctx = this.ctx
        const { x, y } = this.engine.aim
        const firing = this.engine.firing
        const radius = firing ? 9 : 11
        const gap = radius + 5
        const arm = gap + 10
        const pulse = 0.82 + Math.sin(time * 7) * 0.12

        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(firing ? time * 3 : 0)
        ctx.lineCap = 'round'

        // A dark under-stroke keeps the reticle readable over bright effects.
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)'
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.moveTo(-arm, 0)
        ctx.lineTo(-gap, 0)
        ctx.moveTo(gap, 0)
        ctx.lineTo(arm, 0)
        ctx.moveTo(0, -arm)
        ctx.lineTo(0, -gap)
        ctx.moveTo(0, gap)
        ctx.lineTo(0, arm)
        ctx.stroke()

        ctx.strokeStyle = '#ecfeff'
        ctx.lineWidth = 2.5
        ctx.stroke()

        ctx.globalAlpha = pulse
        ctx.strokeStyle = '#22d3ee'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(0, 0, radius, 0, Math.PI * 2)
        ctx.stroke()

        ctx.globalAlpha = 1
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(0, 0, 2.75, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
    }
}
