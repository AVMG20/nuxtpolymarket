// Canvas 2D renderer for Meadowbrawl. Paints the terrain once per run into
// offscreen layers, then draws the live scene y-sorted on top with a
// foreshortened ground plane so the 45° camera reads without a 3D stack.
import type { Enemy, MeadowbrawlGame, Particle, Player } from './engine'
import { GROUND_YS as YS } from './types'
import type { TreeDeco, WorldLayout } from './world'
import { WEAPONS } from './weapons'
import { clamp, lerp } from './geometry'

export const VIEW_W = 1120
export const VIEW_H = 630
const TS = 1.25

type Ctx = CanvasRenderingContext2D

const TREE_PALETTES = [
    ['#d97c2b', '#f0a13d', '#f6c35a', '#a8531f'],
    ['#b23a2c', '#d4523a', '#ee7d4f', '#7d2418'],
    ['#d9a52b', '#f2c74b', '#f8e07a', '#a3741a'],
    ['#5f8f3a', '#7fb24a', '#a6d16a', '#3f6a25']
]

function hash(seed: number, i: number): number {
    const x = Math.sin(seed * 9301 + i * 49297) * 233280
    return x - Math.floor(x)
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
    ctx.beginPath()
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2)
}

function parseColor(c: string): [number, number, number] {
    if (c.startsWith('#')) {
        const n = parseInt(c.slice(1), 16)
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }
    const m = c.match(/(\d+)/g)
    return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [200, 200, 200]
}

function shade(color: string, amt: number): string {
    const [r, g, b] = parseColor(color)
    return `rgb(${clamp(r + amt, 0, 255)},${clamp(g + amt, 0, 255)},${clamp(b + amt, 0, 255)})`
}

/** Painterly two-tone fill: lit from the upper left, shadowed lower right. */
function bodyGrad(ctx: Ctx, color: string, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    g.addColorStop(0, shade(color, 28))
    g.addColorStop(0.55, color)
    g.addColorStop(1, shade(color, -34))
    return g
}

export class MeadowbrawlRenderer {
    private ctx: Ctx
    private terrain: HTMLCanvasElement | null = null
    private canopy: HTMLCanvasElement | null = null
    private terrainWorld: WorldLayout | null = null
    private cssW = VIEW_W
    private cssH = VIEW_H
    private scale = 1
    private dpr = 1
    camX = 0
    camY = 0
    private camInit = false
    private t = 0
    private lowHpPulse = 0

    constructor(private canvas: HTMLCanvasElement, private game: MeadowbrawlGame) {
        this.ctx = canvas.getContext('2d', { alpha: false })!
        this.resize()
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect()
        this.cssW = Math.max(1, rect.width)
        this.cssH = Math.max(1, rect.height)
        this.dpr = Math.min(2, window.devicePixelRatio || 1)
        this.canvas.width = Math.round(this.cssW * this.dpr)
        this.canvas.height = Math.round(this.cssH * this.dpr)
        this.scale = this.cssW / VIEW_W
    }

    /** Client pixel → logic coordinates. */
    screenToWorld(clientX: number, clientY: number) {
        const rect = this.canvas.getBoundingClientRect()
        const vx = (clientX - rect.left) / this.scale
        const vy = (clientY - rect.top) / this.scale
        return { x: vx + this.camX, y: (vy + this.camY) / YS }
    }

    // ---------------------------------------------------------------- frame

    render(dt: number) {
        this.t += dt
        const g = this.game
        const ctx = this.ctx
        if (this.terrainWorld !== g.world) this.buildTerrain(g.world)
        this.stampDecals()
        this.updateCamera(dt)

        const viewH = this.cssH / this.scale
        ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0)
        ctx.fillStyle = '#213d1c'
        ctx.fillRect(0, 0, VIEW_W, viewH)

        const shake = g.shake
        const sx = shake > 0 ? (Math.random() - 0.5) * shake * 1.6 : 0
        const sy = shake > 0 ? (Math.random() - 0.5) * shake * 1.2 : 0
        ctx.translate(sx, sy)
        const ox = -this.camX
        const oy = -this.camY

        // Terrain.
        const w = g.world
        ctx.drawImage(this.terrain!, ox - w.margin, oy - w.margin * YS, this.terrain!.width / TS, this.terrain!.height / TS)
        this.drawWater(ctx, ox, oy)

        // Ground layer: telegraphs, shadows, ground effects.
        ctx.save()
        ctx.translate(ox, oy)
        ctx.scale(1, YS)
        this.drawGround(ctx)
        ctx.restore()

        // Afterimages sit just above the ground, below everything solid.
        ctx.save()
        ctx.translate(ox, oy)
        this.drawAfterimages(ctx)
        ctx.restore()

        // Sorted sprites.
        this.drawSprites(ctx, ox, oy)

        // Air layer.
        ctx.save()
        ctx.translate(ox, oy)
        this.drawAir(ctx)
        this.drawAbilityAir(ctx)
        ctx.restore()

        // Additive glow pass: sparks, embers, motes, souls, auras.
        ctx.save()
        ctx.translate(ox, oy)
        ctx.globalCompositeOperation = 'lighter'
        this.drawGlow(ctx)
        ctx.restore()

        // Foreground canopies.
        ctx.drawImage(this.canopy!, ox - w.margin, oy - w.margin * YS, this.canopy!.width / TS, this.canopy!.height / TS)
        this.drawInnerCanopies(ctx, ox, oy)

        // Floating text on top of everything in the world.
        ctx.save()
        ctx.translate(ox, oy)
        this.drawFloaters(ctx)
        ctx.restore()

        this.drawPost(ctx, viewH, dt)
    }

    private updateCamera(dt: number) {
        const g = this.game
        const p = g.player
        const viewH = this.cssH / this.scale
        // The camera stays locked on the player; drifting toward the cursor
        // made aiming feel like it moved the world.
        const tx = p.x - VIEW_W / 2
        const ty = p.y * YS - viewH / 2
        const w = g.world
        const minX = -w.margin + 40
        const maxX = w.w + w.margin - VIEW_W - 40
        const minY = (-w.margin + 40) * YS
        const maxY = (w.h + w.margin) * YS - viewH - 40
        const cx = clamp(tx, minX, maxX)
        const cy = clamp(ty, minY, maxY)
        if (!this.camInit || g.phase === 'menu') {
            this.camX = cx
            this.camY = cy
            this.camInit = true
        } else {
            const k = 1 - Math.exp(-7 * dt)
            this.camX = lerp(this.camX, cx, k)
            this.camY = lerp(this.camY, cy, k)
        }
    }

    // --------------------------------------------------------------- terrain

    private buildTerrain(w: WorldLayout) {
        this.terrainWorld = w
        const tw = Math.round((w.w + w.margin * 2) * TS)
        const th = Math.round((w.h + w.margin * 2) * YS * TS)
        const terrain = document.createElement('canvas')
        terrain.width = tw
        terrain.height = th
        const canopy = document.createElement('canvas')
        canopy.width = tw
        canopy.height = th
        this.terrain = terrain
        this.canopy = canopy
        const ctx = terrain.getContext('2d')!
        const cctx = canopy.getContext('2d')!

        const ground = (c: Ctx) => c.setTransform(TS, 0, 0, TS * YS, w.margin * TS, w.margin * YS * TS)
        const upright = (c: Ctx) => c.setTransform(TS, 0, 0, TS, w.margin * TS, w.margin * YS * TS)

        // --- Meadow base -------------------------------------------------
        ground(ctx)
        const x0 = -w.margin
        const y0 = -w.margin
        const fullW = w.w + w.margin * 2
        const fullH = w.h + w.margin * 2
        const base = ctx.createLinearGradient(0, y0, 0, y0 + fullH)
        base.addColorStop(0, '#6aa83c')
        base.addColorStop(0.5, '#5c9c37')
        base.addColorStop(1, '#4d8a31')
        ctx.fillStyle = base
        ctx.fillRect(x0, y0, fullW, fullH)

        // Soft colour variation: big translucent blobs.
        for (let i = 0; i < 260; i++) {
            const x = x0 + Math.random() * fullW
            const y = y0 + Math.random() * fullH
            const r = 60 + Math.random() * 200
            const light = Math.random() < 0.5
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
            grad.addColorStop(0, light ? 'rgba(170,220,90,0.35)' : 'rgba(40,100,40,0.35)')
            grad.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.fillStyle = grad
            ctx.fillRect(x - r, y - r, r * 2, r * 2)
        }
        // Painterly brush strokes.
        for (let i = 0; i < 2600; i++) {
            const x = x0 + Math.random() * fullW
            const y = y0 + Math.random() * fullH
            const k = Math.random()
            ctx.fillStyle = k < 0.33 ? 'rgba(150,205,80,0.22)' : k < 0.66 ? 'rgba(70,140,50,0.22)' : 'rgba(110,175,60,0.2)'
            ctx.save()
            ctx.translate(x, y)
            ctx.rotate((Math.random() - 0.5) * 0.8)
            ellipse(ctx, 0, 0, 10 + Math.random() * 26, 3 + Math.random() * 5)
            ctx.fill()
            ctx.restore()
        }

        // Dappled light patches.
        for (let i = 0; i < 40; i++) {
            const x = x0 + Math.random() * fullW
            const y = y0 + Math.random() * fullH
            const r = 90 + Math.random() * 160
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
            grad.addColorStop(0, 'rgba(255,240,170,0.16)')
            grad.addColorStop(1, 'rgba(255,240,170,0)')
            ctx.fillStyle = grad
            ctx.fillRect(x - r, y - r, r * 2, r * 2)
        }

        // --- Dirt path ---------------------------------------------------
        const drawPath = (width: number, color: string, jitter: number) => {
            ctx.strokeStyle = color
            ctx.lineWidth = width
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.beginPath()
            const pts = w.path
            ctx.moveTo(pts[0]!.x, pts[0]!.y + (Math.random() - 0.5) * jitter)
            for (let i = 1; i < pts.length - 1; i++) {
                const a = pts[i]!
                const b = pts[i + 1]!
                ctx.quadraticCurveTo(a.x, a.y + (Math.random() - 0.5) * jitter, (a.x + b.x) / 2, (a.y + b.y) / 2 + (Math.random() - 0.5) * jitter)
            }
            const last = pts[pts.length - 1]!
            ctx.lineTo(last.x, last.y)
            ctx.stroke()
        }
        drawPath(78, 'rgba(120,92,58,0.55)', 14)
        drawPath(64, 'rgba(150,118,74,0.85)', 10)
        drawPath(40, 'rgba(178,146,96,0.75)', 8)
        drawPath(14, 'rgba(200,170,115,0.5)', 6)

        // --- Stream banks, pool, stream --------------------------------
        const s = w.stream
        ctx.fillStyle = 'rgba(196,178,120,0.9)'
        ctx.beginPath()
        ctx.moveTo(s.x - s.width / 2 - 26, s.top)
        for (let y = s.top; y <= s.bottom; y += 30) ctx.lineTo(s.x - s.width / 2 - 26 + Math.sin(y * 0.02) * 8, y)
        for (let y = s.bottom; y >= s.top; y -= 30) ctx.lineTo(s.x + s.width / 2 + 26 + Math.cos(y * 0.017) * 8, y)
        ctx.closePath()
        ctx.fill()
        ellipse(ctx, w.pool.x, w.pool.y, w.pool.r + 26, w.pool.r + 18)
        ctx.fill()

        const water = ctx.createLinearGradient(s.x - s.width / 2, 0, s.x + s.width / 2, 0)
        water.addColorStop(0, '#2d6f96')
        water.addColorStop(0.5, '#4f9fc8')
        water.addColorStop(1, '#2b6890')
        ctx.fillStyle = water
        ctx.beginPath()
        ctx.moveTo(s.x - s.width / 2, s.top)
        for (let y = s.top; y <= s.bottom; y += 30) ctx.lineTo(s.x - s.width / 2 + Math.sin(y * 0.02) * 8, y)
        for (let y = s.bottom; y >= s.top; y -= 30) ctx.lineTo(s.x + s.width / 2 + Math.cos(y * 0.017) * 8, y)
        ctx.closePath()
        ctx.fill()
        const pool = ctx.createRadialGradient(w.pool.x, w.pool.y, 10, w.pool.x, w.pool.y, w.pool.r)
        pool.addColorStop(0, '#6fc0dd')
        pool.addColorStop(0.6, '#3f8fba')
        pool.addColorStop(1, '#245f88')
        ctx.fillStyle = pool
        ellipse(ctx, w.pool.x, w.pool.y, w.pool.r, w.pool.r * 0.9)
        ctx.fill()
        // Still-water highlights.
        ctx.fillStyle = 'rgba(255,255,255,0.18)'
        for (let y = s.top; y < s.bottom; y += 22) {
            ellipse(ctx, s.x + Math.sin(y * 0.05) * 16, y, 8 + Math.random() * 10, 1.6)
            ctx.fill()
        }

        // --- Bridge (ground part: shadow on water) -----------------------
        const b = w.bridge
        ctx.fillStyle = 'rgba(20,40,60,0.35)'
        ctx.fillRect(b.x0 - 4, b.y - b.width / 2 + 10, b.x1 - b.x0 + 8, b.width)

        // --- Ground clutter ---------------------------------------------
        for (const leaf of w.leaves) {
            ctx.save()
            ctx.translate(leaf.x, leaf.y)
            ctx.rotate(Math.random() * Math.PI)
            ctx.fillStyle = Math.random() < 0.5 ? 'rgba(214,120,40,0.85)' : 'rgba(178,58,44,0.8)'
            ellipse(ctx, 0, 0, 5, 2.6)
            ctx.fill()
            ctx.restore()
        }
        for (const t of w.tufts) {
            const dark = hash(t.seed, 1) < 0.5
            ctx.strokeStyle = dark ? 'rgba(40,100,35,0.7)' : 'rgba(160,215,90,0.75)'
            ctx.lineWidth = 1.6
            ctx.lineCap = 'round'
            for (let i = 0; i < 4; i++) {
                const a = -Math.PI / 2 + (i - 1.5) * 0.35 + (hash(t.seed, i + 2) - 0.5) * 0.3
                const len = 6 + hash(t.seed, i + 9) * 8
                ctx.beginPath()
                ctx.moveTo(t.x, t.y)
                ctx.quadraticCurveTo(t.x + Math.cos(a) * len * 0.6, t.y + Math.sin(a) * len * 0.6, t.x + Math.cos(a) * len + (i - 1.5) * 2, t.y + Math.sin(a) * len * 1.4)
                ctx.stroke()
            }
        }
        for (const f of w.flowers) {
            ctx.fillStyle = 'rgba(30,80,30,0.5)'
            ellipse(ctx, f.x + 1, f.y + 2, f.size + 0.6, f.size * 0.8)
            ctx.fill()
            ctx.fillStyle = f.color
            for (let i = 0; i < 5; i++) {
                const a = i / 5 * Math.PI * 2
                ellipse(ctx, f.x + Math.cos(a) * f.size * 0.75, f.y + Math.sin(a) * f.size * 0.75, f.size * 0.6, f.size * 0.6)
                ctx.fill()
            }
            ctx.fillStyle = f.color === '#ffe066' ? '#ff9a3c' : '#ffe066'
            ellipse(ctx, f.x, f.y, f.size * 0.45, f.size * 0.45)
            ctx.fill()
        }

        // --- Upright props -----------------------------------------------
        upright(ctx)
        this.paintCliff(ctx, w)
        this.paintWaterfallBase(ctx, w)
        for (const r of w.rocks) this.paintRock(ctx, r.x, r.y * YS, r.r, r.seed)
        this.paintBridge(ctx, w)

        // Perimeter trees: trunks on the terrain, canopies on the overlay.
        const trees = [...w.trees].filter(t => !t.inner).sort((a, b) => a.y - b.y)
        upright(cctx)
        for (const t of trees) {
            this.paintTrunk(ctx, t)
            this.paintCanopy(cctx, t, 1)
        }
        // Boulders are static and never overlap moving things at their base,
        // so they go straight into the terrain (sorted with trunks by y).
        const boulders = w.obstacles.filter(o => o.kind === 'boulder').sort((a, b) => a.y - b.y)
        for (const o of boulders) this.paintBoulder(ctx, o.x, o.y * YS, o.r, o.seed)

        // Warm light + soft vignette baked into the terrain.
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'overlay'
        const warm = ctx.createRadialGradient(tw * 0.3, th * 0.2, 0, tw * 0.3, th * 0.2, tw * 0.9)
        warm.addColorStop(0, 'rgba(255,220,150,0.5)')
        warm.addColorStop(1, 'rgba(60,40,90,0.3)')
        ctx.fillStyle = warm
        ctx.fillRect(0, 0, tw, th)
        ctx.globalCompositeOperation = 'source-over'
    }

    private paintCliff(ctx: Ctx, w: WorldLayout) {
        const c = w.cliff
        const top = c.y0 * YS
        const bottom = c.y1 * YS
        const faceTop = bottom - 120
        // Plateau on top.
        ctx.fillStyle = '#5a8a34'
        ctx.fillRect(c.x0, top, c.x1 - c.x0, faceTop - top)
        for (let i = 0; i < 120; i++) {
            ctx.fillStyle = Math.random() < 0.5 ? 'rgba(150,200,90,0.3)' : 'rgba(50,110,40,0.3)'
            ellipse(ctx, c.x0 + Math.random() * (c.x1 - c.x0), top + Math.random() * (faceTop - top), 14 + Math.random() * 30, 5 + Math.random() * 8)
            ctx.fill()
        }
        // Rock face.
        const face = ctx.createLinearGradient(0, faceTop, 0, bottom)
        face.addColorStop(0, '#8a7f70')
        face.addColorStop(0.5, '#6d6357')
        face.addColorStop(1, '#4a4139')
        ctx.fillStyle = face
        ctx.beginPath()
        ctx.moveTo(c.x0, faceTop)
        for (let x = c.x0; x <= c.x1; x += 40) ctx.lineTo(x, faceTop + Math.sin(x * 0.05) * 8)
        ctx.lineTo(c.x1 + 30, faceTop + 40)
        ctx.lineTo(c.x1 + 10, bottom + 8)
        ctx.lineTo(c.x0, bottom + 8)
        ctx.closePath()
        ctx.fill()
        // Strata + cracks.
        ctx.strokeStyle = 'rgba(40,32,28,0.45)'
        ctx.lineWidth = 2
        for (let y = faceTop + 18; y < bottom; y += 22) {
            ctx.beginPath()
            ctx.moveTo(c.x0, y)
            for (let x = c.x0; x <= c.x1; x += 30) ctx.lineTo(x, y + Math.sin(x * 0.08 + y) * 4)
            ctx.stroke()
        }
        ctx.fillStyle = 'rgba(255,240,200,0.18)'
        for (let x = c.x0; x < c.x1; x += 26) {
            ellipse(ctx, x + 10, faceTop + 8, 12, 4)
            ctx.fill()
        }
        // Moss.
        for (let i = 0; i < 40; i++) {
            ctx.fillStyle = 'rgba(90,150,60,0.55)'
            ellipse(ctx, c.x0 + Math.random() * (c.x1 - c.x0), faceTop + Math.random() * 40, 8 + Math.random() * 12, 4 + Math.random() * 4)
            ctx.fill()
        }
        // Drop shadow onto the meadow.
        const sh = ctx.createLinearGradient(0, bottom, 0, bottom + 60)
        sh.addColorStop(0, 'rgba(20,30,20,0.45)')
        sh.addColorStop(1, 'rgba(20,30,20,0)')
        ctx.fillStyle = sh
        ctx.fillRect(c.x0, bottom, c.x1 - c.x0 + 30, 60)
    }

    private paintWaterfallBase(ctx: Ctx, w: WorldLayout) {
        const f = w.waterfall
        const top = w.cliff.y1 * YS - 120
        const bottom = w.pool.y * YS - 10
        const grad = ctx.createLinearGradient(0, top, 0, bottom)
        grad.addColorStop(0, 'rgba(120,190,225,0.9)')
        grad.addColorStop(1, 'rgba(210,240,255,0.95)')
        ctx.fillStyle = grad
        ctx.fillRect(f.x - f.width / 2, top, f.width, bottom - top)
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        for (let i = 0; i < 6; i++) ctx.fillRect(f.x - f.width / 2 + 4 + i * 9, top, 3, bottom - top)
        // Mist at the base.
        const mist = ctx.createRadialGradient(f.x, bottom, 4, f.x, bottom, 70)
        mist.addColorStop(0, 'rgba(255,255,255,0.7)')
        mist.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = mist
        ctx.fillRect(f.x - 80, bottom - 50, 160, 80)
    }

    private paintRock(ctx: Ctx, x: number, y: number, r: number, seed: number) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ellipse(ctx, x + 2, y + r * 0.35, r * 1.1, r * 0.45)
        ctx.fill()
        ctx.fillStyle = shade('#8d8478', Math.round(hash(seed, 1) * 30 - 15))
        ellipse(ctx, x, y, r, r * 0.8)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,240,0.35)'
        ellipse(ctx, x - r * 0.3, y - r * 0.35, r * 0.45, r * 0.25)
        ctx.fill()
        ctx.strokeStyle = 'rgba(30,25,20,0.5)'
        ctx.lineWidth = 1
        ellipse(ctx, x, y, r, r * 0.8)
        ctx.stroke()
    }

    private paintBoulder(ctx: Ctx, x: number, y: number, r: number, seed: number) {
        const h = r * 1.15
        ctx.fillStyle = 'rgba(0,0,0,0.3)'
        ellipse(ctx, x + 6, y + 4, r * 1.15, r * YS * 0.8)
        ctx.fill()
        ctx.beginPath()
        const n = 9
        for (let i = 0; i < n; i++) {
            const a = i / n * Math.PI * 2
            const wob = 0.85 + hash(seed, i) * 0.3
            const px = x + Math.cos(a) * r * 1.05 * wob
            const py = y - h * 0.45 + Math.sin(a) * h * 0.7 * wob
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
        }
        ctx.closePath()
        const g = ctx.createLinearGradient(x - r, y - h, x + r, y + r * 0.4)
        g.addColorStop(0, '#a49b8d')
        g.addColorStop(0.55, '#7d7468')
        g.addColorStop(1, '#4e463e')
        ctx.fillStyle = g
        ctx.fill()
        ctx.strokeStyle = 'rgba(30,25,22,0.7)'
        ctx.lineWidth = 2
        ctx.stroke()
        // Moss and highlight.
        ctx.fillStyle = 'rgba(100,160,60,0.6)'
        ellipse(ctx, x - r * 0.2, y - h * 0.75, r * 0.55, r * 0.22)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,250,230,0.28)'
        ellipse(ctx, x - r * 0.35, y - h * 0.6, r * 0.3, r * 0.16)
        ctx.fill()
        ctx.strokeStyle = 'rgba(30,25,22,0.4)'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(x + r * 0.2, y - h * 0.5)
        ctx.lineTo(x + r * 0.45, y - h * 0.1)
        ctx.lineTo(x + r * 0.3, y + r * 0.2)
        ctx.stroke()
    }

    private paintBridge(ctx: Ctx, w: WorldLayout) {
        const b = w.bridge
        const y = b.y * YS
        const hw = b.width * YS / 2
        ctx.fillStyle = '#7a5a3a'
        ctx.fillRect(b.x0, y - hw, b.x1 - b.x0, hw * 2)
        for (let x = b.x0; x < b.x1; x += 12) {
            ctx.fillStyle = (Math.floor((x - b.x0) / 12) % 2 === 0) ? '#946e47' : '#87643f'
            ctx.fillRect(x + 1, y - hw + 2, 10, hw * 2 - 4)
            ctx.fillStyle = 'rgba(40,25,15,0.35)'
            ctx.fillRect(x, y - hw + 2, 1, hw * 2 - 4)
        }
        // Rails.
        ctx.strokeStyle = '#5c3f26'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(b.x0, y - hw - 14)
        ctx.lineTo(b.x1, y - hw - 14)
        ctx.moveTo(b.x0, y + hw - 14)
        ctx.lineTo(b.x1, y + hw - 14)
        ctx.stroke()
        ctx.fillStyle = '#6b4a2c'
        for (const px of [b.x0 + 4, (b.x0 + b.x1) / 2, b.x1 - 4]) {
            ctx.fillRect(px - 3, y - hw - 22, 6, 24)
            ctx.fillRect(px - 3, y + hw - 22, 6, 24)
        }
    }

    private paintTrunk(ctx: Ctx, t: TreeDeco) {
        const x = t.x
        const y = t.y * YS
        const s = t.scale
        ctx.fillStyle = 'rgba(0,0,0,0.28)'
        ellipse(ctx, x + 4, y + 2, 22 * s, 8 * s)
        ctx.fill()
        ctx.fillStyle = '#5a3d26'
        ctx.beginPath()
        ctx.moveTo(x - 9 * s, y + 2)
        ctx.quadraticCurveTo(x - 6 * s, y - 30 * s, x - 5 * s, y - 62 * s)
        ctx.lineTo(x + 5 * s, y - 62 * s)
        ctx.quadraticCurveTo(x + 6 * s, y - 30 * s, x + 10 * s, y + 2)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.beginPath()
        ctx.moveTo(x + 2 * s, y + 2)
        ctx.quadraticCurveTo(x + 3 * s, y - 30 * s, x + 2 * s, y - 62 * s)
        ctx.lineTo(x + 5 * s, y - 62 * s)
        ctx.quadraticCurveTo(x + 6 * s, y - 30 * s, x + 10 * s, y + 2)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = 'rgba(30,20,12,0.8)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(x - 9 * s, y + 2)
        ctx.quadraticCurveTo(x - 6 * s, y - 30 * s, x - 5 * s, y - 62 * s)
        ctx.moveTo(x + 10 * s, y + 2)
        ctx.quadraticCurveTo(x + 6 * s, y - 30 * s, x + 5 * s, y - 62 * s)
        ctx.stroke()
    }

    paintCanopy(ctx: Ctx, t: TreeDeco, alpha: number) {
        const x = t.x
        const y = t.y * YS - 74 * t.scale
        const s = t.scale
        const pal = TREE_PALETTES[t.palette]!
        ctx.globalAlpha = alpha
        const blobs = 9
        ctx.strokeStyle = 'rgba(40,20,10,0.55)'
        ctx.lineWidth = 2
        for (let i = 0; i < blobs; i++) {
            const a = hash(t.seed, i) * Math.PI * 2
            const d = hash(t.seed, i + 20) * 26 * s
            const bx = x + Math.cos(a) * d
            const by = y + Math.sin(a) * d * 0.75 + 4 * s
            const r = (22 + hash(t.seed, i + 40) * 16) * s
            const shadeIdx = by > y + 6 * s ? 3 : (i % 3)
            ctx.fillStyle = pal[shadeIdx]!
            ellipse(ctx, bx, by, r, r * 0.85)
            ctx.fill()
            ctx.stroke()
        }
        // Highlights on top.
        for (let i = 0; i < 4; i++) {
            const bx = x + (hash(t.seed, i + 60) - 0.5) * 40 * s
            const by = y - 14 * s + (hash(t.seed, i + 70) - 0.5) * 14 * s
            ctx.fillStyle = pal[2]!
            ellipse(ctx, bx, by, (10 + hash(t.seed, i + 80) * 10) * s, 7 * s)
            ctx.fill()
        }
        ctx.globalAlpha = 1
    }

    /** Blood, scorch and crack decals are permanent — stamp them straight into the terrain. */
    private stampDecals() {
        const g = this.game
        if (!g.decals.length || !this.terrain) return
        const ctx = this.terrain.getContext('2d')!
        const w = g.world
        ctx.setTransform(TS, 0, 0, TS * YS, w.margin * TS, w.margin * YS * TS)
        for (const d of g.decals) {
            if (d.kind === 'crack') {
                ctx.strokeStyle = 'rgba(40,30,20,0.6)'
                ctx.lineWidth = 2
                for (let i = 0; i < 6; i++) {
                    const a = i / 6 * Math.PI * 2 + Math.random() * 0.6
                    ctx.beginPath()
                    ctx.moveTo(d.x, d.y)
                    ctx.lineTo(d.x + Math.cos(a) * d.r * 0.6, d.y + Math.sin(a) * d.r * 0.6)
                    ctx.lineTo(d.x + Math.cos(a + 0.3) * d.r, d.y + Math.sin(a + 0.3) * d.r)
                    ctx.stroke()
                }
                continue
            }
            ctx.fillStyle = d.color
            const n = d.kind === 'blood' ? 5 : 3
            for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2
                const dd = Math.random() * d.r * 0.5
                ellipse(ctx, d.x + Math.cos(a) * dd, d.y + Math.sin(a) * dd, d.r * (0.4 + Math.random() * 0.5), d.r * (0.35 + Math.random() * 0.4))
                ctx.fill()
            }
        }
        g.decals.length = 0
    }

    // ------------------------------------------------------------- live water

    private drawWater(ctx: Ctx, ox: number, oy: number) {
        const w = this.game.world
        const s = w.stream
        ctx.save()
        ctx.translate(ox, oy)
        // Stream shimmer.
        ctx.fillStyle = 'rgba(255,255,255,0.22)'
        const flow = (this.t * 90) % 44
        const yStart = Math.max(s.top, (this.camY) / YS - 40)
        const yEnd = Math.min(s.bottom, (this.camY + this.cssH / this.scale) / YS + 40)
        for (let y = yStart - (yStart % 44); y < yEnd; y += 44) {
            const yy = y + flow
            const xx = s.x + Math.sin(yy * 0.05) * 16
            ellipse(ctx, xx, yy * YS, 9, 1.5)
            ctx.fill()
            ellipse(ctx, xx + 18, yy * YS + 14, 5, 1.2)
            ctx.fill()
        }
        // Waterfall sheets.
        const f = w.waterfall
        const top = w.cliff.y1 * YS - 120
        const bottom = w.pool.y * YS - 10
        if (bottom > this.camY - 20 && top < this.camY + this.cssH / this.scale) {
            ctx.fillStyle = 'rgba(255,255,255,0.45)'
            for (let i = 0; i < 5; i++) {
                const x = f.x - f.width / 2 + 6 + i * 10
                const off = (this.t * 260 + i * 37) % 60
                for (let y = top + off; y < bottom; y += 60) {
                    ctx.fillRect(x, y, 3, 26)
                }
            }
            // Foam ring in the pool.
            ctx.fillStyle = 'rgba(255,255,255,0.35)'
            for (let i = 0; i < 8; i++) {
                const a = i / 8 * Math.PI * 2 + this.t * 0.8
                const r = 18 + Math.sin(this.t * 3 + i) * 5
                ellipse(ctx, f.x + Math.cos(a) * r, bottom + 6 + Math.sin(a) * r * 0.6, 8, 3)
                ctx.fill()
            }
        }
        ctx.restore()
    }

    // ------------------------------------------------------------- ground fx

    private drawGround(ctx: Ctx) {
        const g = this.game
        const p = g.player

        // Enemy telegraphs — every attack shows its shape before it lands.
        for (const e of g.enemies) {
            if (!e.alive || e.state !== 'windup' || !e.attack) continue
            const a = e.attack
            const k = clamp(e.stateT / a.windup, 0, 1)
            const flash = k > 0.82
            const fill = flash ? 'rgba(255,240,220,0.55)' : `rgba(255,70,50,${0.12 + k * 0.3})`
            const stroke = flash ? 'rgba(255,255,255,0.9)' : 'rgba(255,90,60,0.9)'
            ctx.fillStyle = fill
            ctx.strokeStyle = stroke
            ctx.lineWidth = 2
            ctx.beginPath()
            if (a.kind === 'melee') {
                ctx.moveTo(e.x, e.y)
                ctx.arc(e.x, e.y, a.reach, a.dir - a.halfAngle, a.dir + a.halfAngle)
                ctx.closePath()
            } else if (a.kind === 'slam' || a.kind === 'spin') {
                ctx.arc(e.x, e.y, a.radius, 0, Math.PI * 2)
            } else if (a.kind === 'charge') {
                const len = a.chargeSpeed * a.chargeDur + e.r
                const hw = e.r + 6
                const c = Math.cos(a.dir)
                const sn = Math.sin(a.dir)
                ctx.moveTo(e.x - sn * hw, e.y + c * hw)
                ctx.lineTo(e.x + c * len - sn * hw, e.y + c * hw + sn * len)
                ctx.lineTo(e.x + c * len + sn * hw, e.y - c * hw + sn * len)
                ctx.lineTo(e.x + sn * hw, e.y - c * hw)
                ctx.closePath()
            } else if (a.kind === 'shot') {
                ctx.setLineDash([10, 8])
                ctx.moveTo(e.x, e.y)
                ctx.lineTo(e.x + Math.cos(a.dir) * 620, e.y + Math.sin(a.dir) * 620)
                ctx.stroke()
                ctx.setLineDash([])
                continue
            } else if (a.kind === 'volley') {
                // Five lanes: the gaps between them are the way through.
                ctx.setLineDash([12, 9])
                for (let i = 0; i < 5; i++) {
                    const ang = a.dir + (i - 2) * 0.22
                    ctx.moveTo(e.x, e.y)
                    ctx.lineTo(e.x + Math.cos(ang) * 560, e.y + Math.sin(ang) * 560)
                }
                ctx.stroke()
                ctx.setLineDash([])
                continue
            } else if (a.kind === 'snare') {
                const tx = a.tx ?? e.x
                const ty = a.ty ?? e.y
                ctx.fillStyle = flash ? 'rgba(210,255,180,0.55)' : `rgba(120,190,70,${0.12 + k * 0.3})`
                ctx.strokeStyle = flash ? 'rgba(240,255,220,0.95)' : 'rgba(140,215,90,0.9)'
                ctx.arc(tx, ty, a.radius, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
                ctx.fillStyle = `rgba(150,220,100,${0.25 + k * 0.25})`
                ctx.beginPath()
                ctx.arc(tx, ty, a.radius * k, 0, Math.PI * 2)
                ctx.fill()
                // Roots creeping outward as it charges.
                ctx.strokeStyle = 'rgba(90,150,60,0.85)'
                ctx.lineWidth = 2
                ctx.beginPath()
                for (let i = 0; i < 8; i++) {
                    const ang = i / 8 * Math.PI * 2 + e.seed * 6
                    ctx.moveTo(tx, ty)
                    ctx.lineTo(tx + Math.cos(ang) * a.radius * k, ty + Math.sin(ang) * a.radius * k)
                }
                ctx.stroke()
                continue
            } else if (a.kind === 'brood') {
                ctx.strokeStyle = `rgba(140,215,90,${0.4 + k * 0.5})`
                ctx.lineWidth = 3
                ctx.arc(e.x, e.y, e.r + 20 + k * 40, 0, Math.PI * 2)
                ctx.stroke()
                continue
            } else if (a.kind === 'parry') {
                ctx.strokeStyle = `rgba(190,220,255,${0.5 + k * 0.5})`
                ctx.lineWidth = 3
                ctx.arc(e.x, e.y, e.r + 16, a.dir - 0.9, a.dir + 0.9)
                ctx.stroke()
                continue
            }
            ctx.fill()
            ctx.stroke()
            // Fill sweep so the timing is readable.
            if (a.kind === 'melee' || a.kind === 'slam' || a.kind === 'spin') {
                ctx.fillStyle = `rgba(255,120,80,${0.25 + k * 0.2})`
                ctx.beginPath()
                if (a.kind === 'melee') {
                    ctx.moveTo(e.x, e.y)
                    ctx.arc(e.x, e.y, a.reach * k, a.dir - a.halfAngle, a.dir + a.halfAngle)
                } else {
                    ctx.arc(e.x, e.y, a.radius * k, 0, Math.PI * 2)
                }
                ctx.closePath()
                ctx.fill()
            }
        }

        // Ground rings (shockwaves, slams).
        for (const r of g.rings) {
            const k = 1 - r.life / r.maxLife
            const rad = lerp(r.r0, r.r1, 1 - (1 - k) * (1 - k))
            ctx.strokeStyle = r.color
            ctx.globalAlpha = 1 - k
            ctx.lineWidth = r.width * (1 - k * 0.6)
            ctx.beginPath()
            ctx.arc(r.x, r.y, rad, 0, Math.PI * 2)
            ctx.stroke()
            ctx.globalAlpha = 1
        }

        // Shadows.
        ctx.fillStyle = 'rgba(15,30,15,0.32)'
        for (const e of g.enemies) {
            const sr = e.alive ? e.r * 1.25 : e.r * 1.5
            ctx.beginPath()
            ctx.arc(e.x + 3, e.y + 3, sr, 0, Math.PI * 2)
            ctx.fill()
        }
        const pz = (p.dodge ? Math.sin(p.dodge.t / p.dodge.dur * Math.PI) * 10 : 0) + p.z
        ctx.beginPath()
        ctx.arc(p.x + 3, p.y + 3, Math.max(4, p.r * 1.35 - pz * 0.12), 0, Math.PI * 2)
        ctx.fill()
        if (p.special?.kind === 'leap' && !p.special.fired) {
            // Landing zone.
            const k = clamp(p.special.t / p.special.dur, 0, 1)
            ctx.fillStyle = `rgba(255,240,200,${0.08 + k * 0.2})`
            ctx.strokeStyle = 'rgba(255,240,200,0.75)'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(p.special.tx!, p.special.ty!, 140 * g.reachMult, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
        }
        if (p.special?.kind === 'whirl') {
            ctx.strokeStyle = 'rgba(200,215,230,0.5)'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(p.x, p.y, 120 * g.reachMult, 0, Math.PI * 2)
            ctx.stroke()
        }

        // Player ground marker — never lose yourself in a crowd.
        ctx.strokeStyle = 'rgba(255,245,210,0.55)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * 1.9, 0, Math.PI * 2)
        ctx.stroke()
        // Veteran and elite markers.
        for (const e of g.enemies) {
            if (!e.alive || !e.veteran || e.def.elite) continue
            ctx.strokeStyle = 'rgba(255,120,80,0.45)'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(e.x, e.y, e.r * 1.4, 0, Math.PI * 2)
            ctx.stroke()
        }
        for (const e of g.enemies) {
            if (!e.alive || !e.def.elite) continue
            ctx.strokeStyle = 'rgba(255,80,60,0.6)'
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(e.x, e.y, e.r * 1.5, 0, Math.PI * 2)
            ctx.stroke()
        }

        // Class ability ground marks.
        for (const j of g.javelins) {
            if (j.t >= j.delay) continue
            const k = clamp(j.t / j.delay, 0, 1)
            ctx.fillStyle = `rgba(255,220,140,${0.1 + k * 0.25})`
            ctx.strokeStyle = 'rgba(255,230,170,0.8)'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.arc(j.x, j.y, 46, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = `rgba(255,240,200,${0.3 + k * 0.4})`
            ctx.beginPath()
            ctx.arc(j.x, j.y, 46 * k, 0, Math.PI * 2)
            ctx.fill()
        }
        for (const sm of g.seismics) {
            const len = sm.remaining * 44
            ctx.strokeStyle = 'rgba(255,200,120,0.6)'
            ctx.setLineDash([12, 10])
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.moveTo(sm.x, sm.y)
            ctx.lineTo(sm.x + sm.dx * len, sm.y + sm.dy * len)
            ctx.stroke()
            ctx.setLineDash([])
        }
        for (const e of g.enemies) {
            if (!e.alive || e.marked <= 0) continue
            ctx.strokeStyle = `rgba(200,160,255,${0.5 + Math.sin(this.t * 8) * 0.25})`
            ctx.lineWidth = 2.5
            ctx.beginPath()
            ctx.arc(e.x, e.y, e.r * 1.7, this.t * 2, this.t * 2 + 4.5)
            ctx.stroke()
        }
        if (p.fx.smoke > 0) {
            const k = Math.min(1, p.fx.smoke / 0.5)
            const grad = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, 90)
            grad.addColorStop(0, `rgba(60,52,80,${0.55 * k})`)
            grad.addColorStop(1, 'rgba(60,52,80,0)')
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.arc(p.x, p.y, 90, 0, Math.PI * 2)
            ctx.fill()
        }
        if (p.fx.rally > 0 || p.fx.bloodrage > 0 || p.fx.ironSkin > 0) {
            const color = p.fx.bloodrage > 0 ? '255,70,60' : p.fx.rally > 0 ? '255,209,102' : '200,204,210'
            ctx.strokeStyle = `rgba(${color},${0.45 + Math.sin(this.t * 6) * 0.2})`
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(p.x, p.y, 30 + Math.sin(this.t * 6) * 3, 0, Math.PI * 2)
            ctx.stroke()
        }

        // Whirlwind base.
        for (const w of g.whirlwinds) {
            const k = w.life / w.maxLife
            ctx.strokeStyle = `rgba(230,220,170,${0.5 * k})`
            ctx.lineWidth = 3
            for (let i = 0; i < 3; i++) {
                ctx.beginPath()
                ctx.arc(p.x, p.y, w.radius * (0.55 + i * 0.2), w.spin + i * 2.1, w.spin + i * 2.1 + 2.2)
                ctx.stroke()
            }
        }

        // Ground-hugging particles (dust, smoke, landed blood).
        for (const pt of g.particles) {
            if (pt.kind !== 'dust' && pt.kind !== 'smoke' && !(pt.kind === 'blood' && pt.z <= 0) && !(pt.kind === 'chip' && pt.z <= 0)) continue
            const k = pt.life / pt.maxLife
            ctx.globalAlpha = (pt.kind === 'dust' ? 0.5 : pt.kind === 'smoke' ? 0.35 : 0.9) * k
            ctx.fillStyle = pt.color
            ctx.beginPath()
            ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2)
            ctx.fill()
        }
        ctx.globalAlpha = 1

        // Special windup telegraphs for the player (slam / sweep), so the
        // player can see their own reach.
        const s = p.special
        if (s && (s.kind === 'slam' || s.kind === 'sweep') && !s.fired) {
            const k = clamp(s.t / s.dur, 0, 1)
            const radius = (s.kind === 'slam' ? 150 : 130) * g.reachMult
            ctx.fillStyle = `rgba(255,240,200,${0.08 + k * 0.18})`
            ctx.strokeStyle = 'rgba(255,240,200,0.7)'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
        }
    }

    // --------------------------------------------------------------- sprites

    private drawSprites(ctx: Ctx, ox: number, oy: number) {
        const g = this.game
        type Item = { y: number, draw: () => void }
        const items: Item[] = []
        const proj = (x: number, y: number, z = 0) => ({ x: x + ox, y: y * YS + oy - z })

        for (const o of g.world.obstacles) {
            if (o.kind !== 'tree') continue
            const t = g.world.trees.find(tr => tr.inner && tr.x === o.x && tr.y === o.y)
            if (!t) continue
            items.push({ y: o.y, draw: () => {
                ctx.save()
                ctx.translate(ox, oy)
                this.paintTrunk(ctx, t)
                ctx.restore()
            } })
        }
        for (const e of g.enemies) {
            items.push({ y: e.y + (e.alive ? 0 : -1), draw: () => {
                const s = proj(e.x, e.y)
                this.drawEnemy(ctx, e, s.x, s.y)
            } })
        }
        const p = g.player
        items.push({ y: p.y, draw: () => {
            const s = proj(p.x, p.y)
            this.drawPlayer(ctx, p, s.x, s.y)
        } })
        for (const pr of g.projectiles) {
            items.push({ y: pr.y, draw: () => {
                const s = proj(pr.x, pr.y, 18)
                ctx.save()
                ctx.translate(s.x, s.y)
                ctx.rotate(Math.atan2(Math.sin(pr.angle) * YS, Math.cos(pr.angle)))
                if (pr.kind === 'thorn') {
                    ctx.fillStyle = '#6d8f3a'
                    ctx.strokeStyle = '#1e2a12'
                    ctx.lineWidth = 1.5
                    ctx.beginPath()
                    ctx.moveTo(10, 0)
                    ctx.lineTo(-8, 4)
                    ctx.lineTo(-5, 0)
                    ctx.lineTo(-8, -4)
                    ctx.closePath()
                    ctx.fill()
                    ctx.stroke()
                } else if (pr.kind === 'knife') {
                    ctx.fillStyle = '#f1e5c7'
                    ctx.strokeStyle = '#1e1a24'
                    ctx.lineWidth = 1.2
                    ctx.beginPath()
                    ctx.moveTo(12, 0)
                    ctx.lineTo(-4, 3)
                    ctx.lineTo(-9, 0)
                    ctx.lineTo(-4, -3)
                    ctx.closePath()
                    ctx.fill()
                    ctx.stroke()
                } else if (pr.kind === 'crescent') {
                    ctx.strokeStyle = 'rgba(230,250,255,0.85)'
                    ctx.lineWidth = 9
                    ctx.lineCap = 'round'
                    ctx.beginPath()
                    ctx.arc(-pr.r * 0.4, 0, pr.r * 1.2, -1.2, 1.2)
                    ctx.stroke()
                    ctx.strokeStyle = 'rgba(255,255,255,1)'
                    ctx.lineWidth = 3
                    ctx.beginPath()
                    ctx.arc(-pr.r * 0.4, 0, pr.r * 1.2, -1.1, 1.1)
                    ctx.stroke()
                } else {
                    ctx.strokeStyle = 'rgba(220,245,255,0.9)'
                    ctx.lineWidth = 4
                    ctx.beginPath()
                    ctx.arc(-6, 0, 18, -1.1, 1.1)
                    ctx.stroke()
                    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
                    ctx.lineWidth = 1.5
                    ctx.beginPath()
                    ctx.arc(-6, 0, 18, -0.9, 0.9)
                    ctx.stroke()
                }
                ctx.restore()
            } })
        }
        for (const pt of g.particles) {
            if (pt.kind === 'dust' || pt.kind === 'smoke' || pt.kind === 'glow' || pt.kind === 'spark' || pt.kind === 'ember' || pt.kind === 'spore' || (pt.kind === 'blood' && pt.z <= 0) || (pt.kind === 'chip' && pt.z <= 0)) continue
            items.push({ y: pt.y, draw: () => this.drawParticle(ctx, pt, proj(pt.x, pt.y, pt.z)) })
        }
        for (const a of g.thrownAxes) {
            items.push({ y: a.y, draw: () => {
                const s = proj(a.x, a.y, 22)
                ctx.save()
                ctx.translate(s.x, s.y)
                ctx.rotate(a.spin)
                this.drawWeapon(ctx, 'greataxe', -20, 0, 0, 1, WEAPONS.greataxe.color, 1.1)
                ctx.restore()
                ctx.fillStyle = 'rgba(15,30,15,0.3)'
                ctx.beginPath()
                ctx.ellipse(s.x, a.y * YS + oy + 4, 22, 8, 0, 0, Math.PI * 2)
                ctx.fill()
            } })
        }
        for (const j of g.javelins) {
            items.push({ y: j.y, draw: () => {
                const k = j.t / j.delay
                if (k < 0.55) return
                const landed = j.t >= j.delay
                const fall = landed ? 0 : (1 - (k - 0.55) / 0.45) * 420
                const s = proj(j.x, j.y, fall)
                ctx.save()
                ctx.translate(s.x, s.y)
                ctx.rotate(j.angle)
                ctx.globalAlpha = landed ? clamp((j.delay + j.stuck - j.t) / 0.5, 0, 1) : 1
                ctx.strokeStyle = '#1e1a24'
                ctx.lineWidth = 5
                ctx.beginPath()
                ctx.moveTo(0, 0)
                ctx.lineTo(0, -64)
                ctx.stroke()
                ctx.strokeStyle = '#7a5a34'
                ctx.lineWidth = 3
                ctx.beginPath()
                ctx.moveTo(0, 0)
                ctx.lineTo(0, -64)
                ctx.stroke()
                ctx.fillStyle = '#e7d7b8'
                ctx.beginPath()
                ctx.moveTo(-4, -4)
                ctx.lineTo(0, 10)
                ctx.lineTo(4, -4)
                ctx.closePath()
                ctx.fill()
                ctx.restore()
            } })
        }
        for (const sp of g.spikes) {
            items.push({ y: sp.y, draw: () => {
                const k = 1 - sp.life / sp.maxLife
                const rise = k < 0.25 ? k / 0.25 : k > 0.7 ? (1 - k) / 0.3 : 1
                const s = proj(sp.x, sp.y)
                ctx.save()
                ctx.translate(s.x, s.y)
                for (const [dx, h, w] of [[-12, 0.8, 8], [0, 1, 10], [12, 0.7, 7]] as const) {
                    ctx.fillStyle = bodyGrad(ctx, '#8d8478', dx - w, -sp.size * h * rise, dx + w, 0)
                    ctx.strokeStyle = 'rgba(30,25,22,0.8)'
                    ctx.lineWidth = 1.5
                    ctx.beginPath()
                    ctx.moveTo(dx - w, 2)
                    ctx.lineTo(dx, -sp.size * h * rise)
                    ctx.lineTo(dx + w, 2)
                    ctx.closePath()
                    ctx.fill()
                    ctx.stroke()
                }
                ctx.restore()
            } })
        }

        items.sort((a, b) => a.y - b.y)
        for (const it of items) it.draw()
    }

    private drawParticle(ctx: Ctx, pt: Particle, s: { x: number, y: number }) {
        const k = pt.life / pt.maxLife
        ctx.globalAlpha = Math.min(1, k * 1.5)
        ctx.fillStyle = pt.color
        switch (pt.kind) {
            case 'spark': {
                ctx.strokeStyle = pt.color
                ctx.lineWidth = pt.size * 0.8
                ctx.beginPath()
                ctx.moveTo(s.x, s.y)
                ctx.lineTo(s.x - pt.vx * 0.03, s.y - pt.vy * YS * 0.03 + pt.vz * 0.02)
                ctx.stroke()
                break
            }
            case 'leaf':
            case 'petal': {
                ctx.save()
                ctx.translate(s.x, s.y)
                ctx.rotate(this.t * 3 + pt.x)
                ellipse(ctx, 0, 0, pt.size, pt.size * 0.55)
                ctx.fill()
                ctx.restore()
                break
            }
            case 'ember':
                ctx.beginPath()
                ctx.arc(s.x, s.y, pt.size * k, 0, Math.PI * 2)
                ctx.fill()
                ctx.fillStyle = 'rgba(255,240,180,0.8)'
                ctx.beginPath()
                ctx.arc(s.x, s.y, pt.size * k * 0.4, 0, Math.PI * 2)
                ctx.fill()
                break
            case 'frost':
                ctx.save()
                ctx.translate(s.x, s.y)
                ctx.rotate(pt.x)
                ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size)
                ctx.restore()
                break
            case 'bone':
                ctx.save()
                ctx.translate(s.x, s.y)
                ctx.rotate(pt.x + this.t * 4)
                ctx.strokeStyle = 'rgba(40,30,20,0.8)'
                ctx.lineWidth = 1
                ctx.fillStyle = pt.color
                ctx.beginPath()
                ctx.roundRect(-pt.size, -pt.size * 0.35, pt.size * 2, pt.size * 0.7, 2)
                ctx.fill()
                ctx.stroke()
                ctx.restore()
                break
            default:
                ctx.beginPath()
                ctx.arc(s.x, s.y, pt.size, 0, Math.PI * 2)
                ctx.fill()
        }
        ctx.globalAlpha = 1
    }

    private drawPlayer(ctx: Ctx, p: Player, sx: number, sy: number) {
        const g = this.game
        const w = WEAPONS[p.weapon]
        const facingLeft = Math.cos(p.facing) < 0
        const bob = p.moving && !p.dodge ? Math.abs(Math.sin(p.walk)) * 2.5 : Math.sin(this.t * 3) * 0.8
        const rollZ = (p.dodge ? Math.sin(p.dodge.t / p.dodge.dur * Math.PI) * 10 : 0) + p.z
        const hurt = p.hurtFlash > 0 && Math.floor(this.t * 30) % 2 === 0
        const invulnBlink = p.invuln > 0 && !p.dodge && p.z === 0 && Math.floor(this.t * 20) % 3 === 0

        ctx.save()
        ctx.translate(sx, sy - rollZ)
        const ps = g.playerScale
        if (ps !== 1) ctx.scale(ps, ps)
        if (p.z > 0) {
            // Curl up mid-leap.
            ctx.translate(0, -10)
            ctx.rotate(Math.sin(p.special ? p.special.t / p.special.dur * Math.PI : 0) * 0.5 * (facingLeft ? -1 : 1))
            ctx.translate(0, 10)
        }
        if (p.dodge) {
            const k = p.dodge.t / p.dodge.dur
            ctx.translate(0, -14)
            ctx.rotate(k * Math.PI * 2 * (p.dodge.dx >= 0 ? 1 : -1))
            ctx.translate(0, 14)
            ctx.scale(1, 0.85)
        } else if (p.sprinting) {
            const lean = clamp(p.sprintT / 0.3, 0, 1) * 0.22 * (facingLeft ? -1 : 1)
            ctx.transform(1, 0, -lean, 1, 0, 0)
        }
        if (invulnBlink) ctx.globalAlpha = 0.55
        if (p.fx.smoke > 0) ctx.globalAlpha = 0.4

        const outline = 'rgba(24,18,34,0.95)'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 1.6
        ctx.strokeStyle = outline

        // Cape trails away from facing.
        const capeDir = facingLeft ? 1 : -1
        const sway = Math.sin(this.t * 6 + p.walk) * 3 + (p.moving ? 4 : 0)
        ctx.fillStyle = hurt ? '#ffb0b0' : '#a8262b'
        ctx.beginPath()
        ctx.moveTo(-6, -26 - bob)
        ctx.lineTo(6, -26 - bob)
        ctx.quadraticCurveTo(capeDir * (10 + sway), -14 - bob, capeDir * (14 + sway), -2)
        ctx.lineTo(capeDir * (2 + sway * 0.5), -4)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // Legs.
        const stride = p.moving || p.dodge ? Math.sin(p.walk) * 5 : 0
        ctx.strokeStyle = outline
        ctx.lineWidth = 5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-4, -12 - bob)
        ctx.lineTo(-4 + stride, 0)
        ctx.moveTo(4, -12 - bob)
        ctx.lineTo(4 - stride, 0)
        ctx.stroke()
        ctx.strokeStyle = '#3b2e3f'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(-4, -12 - bob)
        ctx.lineTo(-4 + stride, 0)
        ctx.moveTo(4, -12 - bob)
        ctx.lineTo(4 - stride, 0)
        ctx.stroke()

        // Body: tunic.
        ctx.fillStyle = hurt ? '#ffd6d6' : bodyGrad(ctx, '#3d6fd8', -10, -30 - bob, 10, -10 - bob)
        ctx.lineWidth = 1.6
        ctx.strokeStyle = outline
        ctx.beginPath()
        ctx.moveTo(-10, -30 - bob)
        ctx.lineTo(10, -30 - bob)
        ctx.lineTo(9, -10 - bob)
        ctx.lineTo(-9, -10 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = 'rgba(0,0,40,0.25)'
        ctx.fillRect(-9, -16 - bob, 18, 6)
        ctx.fillStyle = '#e0b04a'
        ctx.fillRect(-9, -18 - bob, 18, 3)
        // Chest plate glint.
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.fillRect(-6, -28 - bob, 5, 8)
        // Shoulders.
        ctx.fillStyle = '#b9c2cf'
        ellipse(ctx, -10, -29 - bob, 5, 4)
        ctx.fill()
        ctx.stroke()
        ellipse(ctx, 10, -29 - bob, 5, 4)
        ctx.fill()
        ctx.stroke()

        // Head + helm.
        ctx.fillStyle = hurt ? '#ffe0d0' : '#f1c9a5'
        ctx.beginPath()
        ctx.arc(0, -38 - bob, 7.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = bodyGrad(ctx, '#c3ccd8', -8, -48 - bob, 8, -37 - bob)
        ctx.beginPath()
        ctx.arc(0, -40 - bob, 8.5, Math.PI, Math.PI * 2)
        ctx.lineTo(8.5, -37 - bob)
        ctx.lineTo(-8.5, -37 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // Visor / eyes toward facing.
        const eyeDir = facingLeft ? -1 : 1
        ctx.fillStyle = '#2a2230'
        ctx.fillRect(eyeDir * 1 - 3, -37 - bob, 6, 2)
        // Plume.
        ctx.strokeStyle = '#f6f1e6'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(0, -47 - bob)
        ctx.quadraticCurveTo(-eyeDir * 8, -52 - bob, -eyeDir * 14, -44 - bob + Math.sin(this.t * 5) * 2)
        ctx.stroke()
        ctx.strokeStyle = outline
        ctx.lineWidth = 1

        // Weapon arm + weapon.
        const wp = this.weaponPose(p)
        const ax = Math.cos(wp.angle)
        const ay = Math.sin(wp.angle) * YS
        const shoulderX = ax * 8
        const shoulderY = -27 - bob
        const handX = shoulderX + ax * 12 * wp.ext
        const handY = shoulderY + ay * 12 * wp.ext + 6
        ctx.strokeStyle = outline
        ctx.lineWidth = 5
        ctx.beginPath()
        ctx.moveTo(shoulderX, shoulderY)
        ctx.lineTo(handX, handY)
        ctx.stroke()
        ctx.strokeStyle = '#f1c9a5'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(shoulderX, shoulderY)
        ctx.lineTo(handX, handY)
        ctx.stroke()
        if (!p.axeOut) this.drawWeapon(ctx, p.weapon, handX, handY, wp.angle, wp.ext, w.color, g.reachMult)
        if (p.fx.shieldWall > 0) {
            // Kite shield raised toward the facing.
            const fx = Math.cos(p.facing)
            const fy = Math.sin(p.facing) * YS
            ctx.save()
            ctx.translate(fx * 16, -24 - bob + fy * 8)
            ctx.fillStyle = bodyGrad(ctx, '#3d6fd8', -12, -20, 12, 16)
            ctx.strokeStyle = outline
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(-12, -18)
            ctx.lineTo(12, -18)
            ctx.lineTo(12, 6)
            ctx.lineTo(0, 18)
            ctx.lineTo(-12, 6)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = '#e0b04a'
            ctx.beginPath()
            ctx.moveTo(0, -12)
            ctx.lineTo(6, -2)
            ctx.lineTo(0, 8)
            ctx.lineTo(-6, -2)
            ctx.closePath()
            ctx.fill()
            ctx.restore()
        }
        if (p.weapon === 'daggers') {
            const offAngle = wp.angle + Math.PI * 0.9
            const ox2 = -ax * 8 + Math.cos(offAngle) * 6
            const oy2 = -25 - bob + Math.sin(offAngle) * YS * 6
            this.drawWeapon(ctx, 'daggers', ox2, oy2, wp.angle + 0.5, 0.8, w.color, g.reachMult)
        }
        ctx.restore()
    }

    private weaponPose(p: Player): { angle: number, ext: number } {
        const a = p.attack
        const s = p.special
        if (s?.kind === 'slam') {
            const k = clamp(s.t / s.dur, 0, 1)
            if (!s.fired) return { angle: p.facing - Math.PI / 2 - k * 0.6, ext: 1.4 }
            return { angle: p.facing + 0.4, ext: 1.2 }
        }
        if (s?.kind === 'sweep') {
            const k = clamp(s.t / (s.dur + 0.3), 0, 1)
            return { angle: p.facing + k * Math.PI * 2, ext: 1.5 }
        }
        if (s?.kind === 'dash') return { angle: p.facing, ext: 1.5 }
        if (s?.kind === 'leap') {
            if (!s.fired) return { angle: p.facing - Math.PI / 2 - 0.4, ext: 1.4 }
            return { angle: p.facing + 0.5, ext: 1.2 }
        }
        if (s?.kind === 'whirl') return { angle: p.facing, ext: 1.6 }
        if (s?.kind === 'backstab') return { angle: p.facing, ext: 1.5 }
        if (!a) {
            return { angle: p.facing + (Math.cos(p.facing) < 0 ? -0.9 : 0.9), ext: 0.9 }
        }
        const shape = a.def.shape
        if (shape.kind === 'thrust') {
            if (a.phase === 'windup') return { angle: a.dir, ext: 0.4 + 0.2 * (a.t / a.windup) }
            if (a.phase === 'active') return { angle: a.dir, ext: 1.6 }
            return { angle: a.dir, ext: lerp(1.6, 0.9, a.t / a.recovery) }
        }
        const half = shape.kind === 'arc' ? shape.halfAngle : 1
        const sweep = a.def.sweep || 1
        const start = a.dir - sweep * (half + 0.5)
        const end = a.dir + sweep * (half + 0.3)
        if (a.phase === 'windup') {
            const k = a.t / a.windup
            return { angle: lerp(a.dir + sweep * 0.6, start, k * k), ext: 1.1 }
        }
        if (a.phase === 'active') return { angle: lerp(start, end, a.t / a.active), ext: 1.4 }
        return { angle: lerp(end, a.dir + sweep * 0.9, a.t / a.recovery), ext: lerp(1.3, 0.9, a.t / a.recovery) }
    }

    private drawWeapon(ctx: Ctx, id: Player['weapon'], x: number, y: number, angle: number, ext: number, color: string, scale: number) {
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(Math.atan2(Math.sin(angle) * YS, Math.cos(angle)))
        ctx.scale(scale, scale)
        ctx.lineJoin = 'round'
        ctx.strokeStyle = 'rgba(24,18,34,0.95)'
        ctx.lineWidth = 1.4
        switch (id) {
            case 'sword':
                ctx.fillStyle = '#6b4a2c'
                ctx.fillRect(-8, -2, 8, 4)
                ctx.fillStyle = '#e0b04a'
                ctx.fillRect(-1, -6, 3, 12)
                ctx.fillStyle = color
                ctx.beginPath()
                ctx.moveTo(2, -3)
                ctx.lineTo(30, -1.5)
                ctx.lineTo(36, 0)
                ctx.lineTo(30, 1.5)
                ctx.lineTo(2, 3)
                ctx.closePath()
                ctx.fill()
                ctx.stroke()
                ctx.strokeStyle = 'rgba(255,255,255,0.7)'
                ctx.beginPath()
                ctx.moveTo(4, 0)
                ctx.lineTo(30, 0)
                ctx.stroke()
                break
            case 'greataxe': {
                // Long haft with a leather grip, a double-bit head and a top spike.
                ctx.fillStyle = '#5a3d26'
                ctx.fillRect(-22, -2.5, 66, 5)
                ctx.strokeRect(-22, -2.5, 66, 5)
                ctx.fillStyle = '#3b2a1c'
                for (let i = -18; i < 0; i += 5) ctx.fillRect(i, -2.5, 2, 5)
                const head = (dir: 1 | -1) => {
                    ctx.beginPath()
                    ctx.moveTo(30, dir * 3)
                    ctx.lineTo(28, dir * 12)
                    ctx.quadraticCurveTo(34, dir * 26, 54, dir * 24)
                    ctx.quadraticCurveTo(50, dir * 12, 50, dir * 3)
                    ctx.closePath()
                    ctx.fillStyle = bodyGrad(ctx, color, 28, dir * 4, 52, dir * 24)
                    ctx.fill()
                    ctx.stroke()
                    // Cutting edge highlight.
                    ctx.strokeStyle = 'rgba(255,255,255,0.75)'
                    ctx.lineWidth = 1.6
                    ctx.beginPath()
                    ctx.moveTo(29, dir * 13)
                    ctx.quadraticCurveTo(35, dir * 25, 53, dir * 23)
                    ctx.stroke()
                    ctx.strokeStyle = 'rgba(24,18,34,0.95)'
                    ctx.lineWidth = 1.4
                }
                head(1)
                head(-1)
                // Steel band and spike.
                ctx.fillStyle = '#7d8590'
                ctx.fillRect(30, -5, 20, 10)
                ctx.strokeRect(30, -5, 20, 10)
                ctx.fillStyle = color
                ctx.beginPath()
                ctx.moveTo(50, -3)
                ctx.lineTo(62, 0)
                ctx.lineTo(50, 3)
                ctx.closePath()
                ctx.fill()
                ctx.stroke()
                break
            }
            case 'warhammer': {
                ctx.fillStyle = '#5a3d26'
                ctx.fillRect(-20, -2.5, 58, 5)
                ctx.strokeRect(-20, -2.5, 58, 5)
                ctx.fillStyle = '#3b2a1c'
                for (let i = -16; i < 0; i += 5) ctx.fillRect(i, -2.5, 2, 5)
                // Head: broad block with a flat striking face and a rear spike.
                ctx.fillStyle = bodyGrad(ctx, '#8d96a3', 30, -14, 52, 14)
                ctx.beginPath()
                ctx.moveTo(30, -14)
                ctx.lineTo(52, -12)
                ctx.lineTo(54, 12)
                ctx.lineTo(30, 14)
                ctx.closePath()
                ctx.fill()
                ctx.stroke()
                ctx.fillStyle = '#5c646f'
                ctx.fillRect(33, -11, 4, 22)
                ctx.fillRect(45, -10, 3, 20)
                ctx.fillStyle = color
                ctx.beginPath()
                ctx.moveTo(30, -4)
                ctx.lineTo(16, 0)
                ctx.lineTo(30, 4)
                ctx.closePath()
                ctx.fill()
                ctx.stroke()
                ctx.fillStyle = 'rgba(255,255,255,0.35)'
                ctx.fillRect(38, -11, 6, 6)
                break
            }
            case 'scythe': {
                // Curved snath, then a long crescent blade sweeping sideways.
                ctx.strokeStyle = '#5a3d26'
                ctx.lineWidth = 4.5
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.moveTo(-34, 8)
                ctx.quadraticCurveTo(-4, -4, 30, -2)
                ctx.stroke()
                ctx.strokeStyle = 'rgba(24,18,34,0.95)'
                ctx.lineWidth = 1.2
                ctx.beginPath()
                ctx.moveTo(-34, 8)
                ctx.quadraticCurveTo(-4, -4, 30, -2)
                ctx.stroke()
                ctx.fillStyle = '#3b2a1c'
                ctx.fillRect(-14, -1, 8, 4)
                ctx.fillStyle = '#7d8590'
                ctx.fillRect(26, -5, 8, 7)
                ctx.strokeRect(26, -5, 8, 7)
                ctx.fillStyle = bodyGrad(ctx, color, 30, -30, 70, 0)
                ctx.beginPath()
                ctx.moveTo(30, -4)
                ctx.quadraticCurveTo(56, -8, 72, -34)
                ctx.quadraticCurveTo(52, -20, 34, -6)
                ctx.lineTo(34, 2)
                ctx.closePath()
                ctx.fill()
                ctx.stroke()
                ctx.strokeStyle = 'rgba(255,255,255,0.8)'
                ctx.lineWidth = 1.4
                ctx.beginPath()
                ctx.moveTo(32, -4)
                ctx.quadraticCurveTo(56, -8, 71, -33)
                ctx.stroke()
                break
            }
            case 'spear':
                ctx.fillStyle = '#7a5a34'
                ctx.fillRect(-26, -1.8, 66, 3.6)
                ctx.strokeRect(-26, -1.8, 66, 3.6)
                ctx.fillStyle = color
                ctx.beginPath()
                ctx.moveTo(38, -5)
                ctx.lineTo(58, 0)
                ctx.lineTo(38, 5)
                ctx.closePath()
                ctx.fill()
                ctx.stroke()
                ctx.fillStyle = '#b23a2c'
                ctx.fillRect(34, -4, 4, 8)
                break
            case 'daggers':
                ctx.fillStyle = '#3b2e3f'
                ctx.fillRect(-6, -2, 7, 4)
                ctx.fillStyle = color
                ctx.beginPath()
                ctx.moveTo(1, -3)
                ctx.lineTo(16, -1)
                ctx.lineTo(20, 0)
                ctx.lineTo(16, 1)
                ctx.lineTo(1, 3)
                ctx.closePath()
                ctx.fill()
                ctx.stroke()
                break
        }
        ctx.restore()
        void ext
    }

    private drawEnemy(ctx: Ctx, e: Enemy, sx: number, sy: number) {
        const t = this.t
        const outline = 'rgba(20,14,24,0.95)'
        const flash = e.hitFlash > 0
        const windupFlash = e.state === 'windup' && e.attack && e.stateT / e.attack.windup > 0.82 && Math.floor(t * 40) % 2 === 0
        const facingLeft = Math.cos(e.facing) < 0
        const dir = facingLeft ? -1 : 1
        const squash = e.squash > 0 ? 1 - e.squash * 0.25 : 1
        const scaleIn = e.state === 'spawn' ? clamp(e.stateT / 0.45, 0, 1) : 1
        const dead = !e.alive
        const deadK = dead ? clamp(e.deadT / 0.7, 0, 1) : 0
        const bob = (e.state === 'chase' || e.state === 'attack') ? Math.abs(Math.sin(e.walk)) * 2 : 0

        ctx.save()
        ctx.translate(sx, sy)
        if (e.veteran) ctx.scale(1.15, 1.15)
        if (dead) {
            ctx.globalAlpha = 1 - deadK
            ctx.rotate(dir * deadK * Math.PI / 2 * 0.9)
            ctx.scale(1, 1 - deadK * 0.5)
        } else {
            ctx.scale(scaleIn * (2 - squash), scaleIn * squash)
            if (e.state === 'windup' && e.attack) {
                // Lean back through the anticipation.
                const k = clamp(e.stateT / e.attack.windup, 0, 1)
                ctx.transform(1, 0, -dir * 0.18 * k, 1, 0, 0)
            }
            if (e.state === 'stagger') ctx.rotate(Math.sin(t * 30) * 0.08)
        }
        ctx.lineJoin = 'round'
        ctx.strokeStyle = outline
        ctx.lineWidth = 1.6

        const tint = (base: string) => {
            if (flash || windupFlash) return '#ffffff'
            if (e.frozen > 0) return '#bfe6ff'
            if (e.slow > 0) return shade(base, 30)
            if (e.burn) return shade(base, 25)
            if (e.veteran) {
                const [r, gg, b] = parseColor(base)
                return `rgb(${clamp(r + 40, 0, 255)},${clamp(gg - 20, 0, 255)},${clamp(b - 20, 0, 255)})`
            }
            return base
        }

        switch (e.type) {
            case 'grunt': this.drawGrunt(ctx, e, dir, bob, tint, outline); break
            case 'charger': this.drawCharger(ctx, e, dir, bob, tint, outline); break
            case 'swarmer': this.drawSwarmer(ctx, e, dir, bob, tint, outline); break
            case 'shield': this.drawShieldwarden(ctx, e, dir, bob, tint, outline); break
            case 'ranged': this.drawRanged(ctx, e, dir, bob, tint, outline); break
            case 'ogre': this.drawOgre(ctx, e, dir, bob, tint, outline); break
            case 'warlord': this.drawWarlord(ctx, e, dir, bob, tint, outline); break
            case 'briar': this.drawBriar(ctx, e, dir, bob, tint, outline); break
            case 'knight': this.drawKnight(ctx, e, dir, bob, tint, outline); break
        }

        // Status overlays.
        if (e.burn && !dead) {
            ctx.fillStyle = 'rgba(255,140,40,0.8)'
            for (let i = 0; i < 3; i++) {
                const fx = Math.sin(t * 12 + i * 2) * 6
                const fy = -e.def.height * 0.5 - Math.abs(Math.sin(t * 9 + i)) * 12
                ellipse(ctx, fx, fy, 3, 5)
                ctx.fill()
            }
        }
        if (e.frozen > 0 && !dead) {
            ctx.fillStyle = 'rgba(190,235,255,0.45)'
            ctx.strokeStyle = 'rgba(230,250,255,0.9)'
            ctx.beginPath()
            ctx.moveTo(-e.r - 4, 2)
            ctx.lineTo(-e.r, -e.def.height - 6)
            ctx.lineTo(0, -e.def.height - 12)
            ctx.lineTo(e.r, -e.def.height - 4)
            ctx.lineTo(e.r + 4, 2)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        if (e.marked > 0 && !dead) {
            const pulse = 1 + Math.sin(t * 8) * 0.12
            ctx.save()
            ctx.translate(0, -e.def.height - 22 + Math.sin(t * 4) * 2)
            ctx.scale(pulse, pulse)
            ctx.fillStyle = '#c9a3ff'
            ctx.strokeStyle = 'rgba(40,10,70,0.9)'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.arc(0, -3, 6, Math.PI, 0)
            ctx.lineTo(6, 3)
            ctx.lineTo(3, 6)
            ctx.lineTo(-3, 6)
            ctx.lineTo(-6, 3)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = '#2a1040'
            ellipse(ctx, -2.5, -2, 1.6, 2)
            ctx.fill()
            ellipse(ctx, 2.5, -2, 1.6, 2)
            ctx.fill()
            ctx.restore()
        }
        // Dazed stars after a charge.
        if (e.state === 'recover' && e.attack?.kind === 'charge' && !dead) {
            ctx.fillStyle = '#ffe066'
            for (let i = 0; i < 3; i++) {
                const a = t * 5 + i * 2.1
                ellipse(ctx, Math.cos(a) * 12, -e.def.height - 8 + Math.sin(a) * 4, 2.5, 2.5)
                ctx.fill()
            }
        }
        ctx.restore()

        // Health bar when damaged.
        const wdt = Math.max(24, e.r * 2.6)
        const hx = sx - wdt / 2
        const hy = sy - e.def.height - 12
        if (!dead && e.hp < e.maxHp && !e.def.elite) {
            ctx.fillStyle = 'rgba(10,8,14,0.7)'
            ctx.fillRect(hx - 1, hy - 1, wdt + 2, 5)
            ctx.fillStyle = '#e04848'
            ctx.fillRect(hx, hy, wdt * clamp(e.hp / e.maxHp, 0, 1), 3)
            if (e.shield && !e.shield.broken) {
                ctx.fillStyle = '#7fb3ff'
                ctx.fillRect(hx, hy - 4, wdt * clamp(e.shield.hp / e.shield.max, 0, 1), 2)
            }
        }
        // Stun meter — always on for elites, and on anything already primed.
        if (!dead && (e.def.elite || e.stun > 0 || e.stunLock > 0)) {
            const sy2 = hy + 6
            ctx.fillStyle = 'rgba(10,8,14,0.7)'
            ctx.fillRect(hx - 1, sy2 - 1, wdt + 2, 4)
            if (e.stunLock > 0) {
                // Cracked and cold: nothing lands on the meter right now.
                ctx.fillStyle = 'rgba(120,118,130,0.55)'
                ctx.fillRect(hx, sy2, wdt, 2)
                ctx.strokeStyle = 'rgba(30,26,36,0.9)'
                ctx.lineWidth = 1
                ctx.beginPath()
                for (let i = 0; i < wdt; i += 5) {
                    ctx.moveTo(hx + i, sy2 + 2)
                    ctx.lineTo(hx + i + 3, sy2 - 1)
                }
                ctx.stroke()
            } else {
                const full = e.state === 'stagger' && e.stunT > 0
                ctx.fillStyle = full ? (Math.floor(t * 24) % 2 === 0 ? '#ffffff' : '#ffe9a8') : '#ffab2e'
                ctx.fillRect(hx, sy2, wdt * clamp(full ? 1 : e.stun / Math.max(1, e.stunMax), 0, 1), 2)
            }
        }
    }

    private drawGrunt(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const stride = Math.sin(e.walk) * 4
        ctx.strokeStyle = outline
        ctx.lineWidth = 4
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-4, -10)
        ctx.lineTo(-4 + stride, 0)
        ctx.moveTo(4, -10)
        ctx.lineTo(4 - stride, 0)
        ctx.stroke()
        ctx.lineWidth = 1.6
        // Tunic.
        ctx.fillStyle = bodyGrad(ctx, tint('#6f7f3a'), -9, -26 - bob, 9, -8 - bob)
        ctx.beginPath()
        ctx.moveTo(-9, -26 - bob)
        ctx.lineTo(9, -26 - bob)
        ctx.lineTo(8, -8 - bob)
        ctx.lineTo(-8, -8 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#4a3a2a'
        ctx.fillRect(-8, -14 - bob, 16, 3)
        // Hood with a bandana'd face underneath.
        ctx.fillStyle = bodyGrad(ctx, tint('#7a4b2e'), -9, -46 - bob, 9, -26 - bob)
        ctx.beginPath()
        ctx.moveTo(-10, -25 - bob)
        ctx.quadraticCurveTo(-6, -44 - bob, 0, -47 - bob)
        ctx.quadraticCurveTo(6, -44 - bob, 10, -25 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#d9a980'
        ellipse(ctx, dir * 1.5, -32 - bob, 5.5, 5)
        ctx.fill()
        ctx.fillStyle = '#b23a2c'
        ctx.fillRect(dir * 1.5 - 5.5, -31 - bob, 11, 3)
        ctx.fillStyle = '#1d1520'
        ellipse(ctx, dir * 2.5 - 2, -34 - bob, 1.2, 1.4)
        ctx.fill()
        ellipse(ctx, dir * 2.5 + 2, -34 - bob, 1.2, 1.4)
        ctx.fill()
        // Club.
        const swing = e.state === 'windup' ? -1.2 : e.state === 'recover' ? 0.8 : 0
        ctx.save()
        ctx.translate(dir * 9, -20 - bob)
        ctx.rotate(dir * (0.5 + swing))
        ctx.fillStyle = '#5a3d26'
        ctx.fillRect(0, -2, 20, 4)
        ctx.strokeRect(0, -2, 20, 4)
        ctx.fillStyle = '#7a5a3a'
        ellipse(ctx, 22, 0, 6, 5)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
    }

    private drawCharger(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const stride = Math.sin(e.walk) * 4
        ctx.strokeStyle = outline
        ctx.lineWidth = 4
        ctx.lineCap = 'round'
        ctx.beginPath()
        for (const lx of [-10, -3, 5, 12]) {
            ctx.moveTo(lx, -8)
            ctx.lineTo(lx + (lx < 0 ? stride : -stride), 0)
        }
        ctx.stroke()
        ctx.lineWidth = 1.6
        ctx.fillStyle = bodyGrad(ctx, tint('#7b4f2c'), -14, -24 - bob, 14, -4 - bob)
        ellipse(ctx, 0, -14 - bob, 19, 11)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = 'rgba(0,0,0,0.22)'
        ellipse(ctx, -2, -9 - bob, 14, 4)
        ctx.fill()
        // Pale belly and a dark dorsal stripe.
        ctx.fillStyle = 'rgba(230,200,160,0.35)'
        ellipse(ctx, -2, -8 - bob, 11, 3)
        ctx.fill()
        ctx.fillStyle = 'rgba(40,24,14,0.55)'
        ellipse(ctx, -3, -22 - bob, 12, 2.5)
        ctx.fill()
        // Bristles.
        ctx.strokeStyle = '#3a2416'
        ctx.lineWidth = 2
        ctx.beginPath()
        for (let i = -12; i <= 8; i += 4) {
            ctx.moveTo(i, -22 - bob)
            ctx.lineTo(i - 2, -27 - bob)
        }
        ctx.stroke()
        // Head.
        ctx.strokeStyle = outline
        ctx.lineWidth = 1.6
        ctx.fillStyle = bodyGrad(ctx, tint('#6b4325'), dir * 8, -22 - bob, dir * 24, -6 - bob)
        ellipse(ctx, dir * 16, -14 - bob, 9, 8)
        ctx.fill()
        ctx.stroke()
        // Ears.
        ctx.fillStyle = tint('#6b4325')
        ellipse(ctx, dir * 11, -22 - bob, 3, 4)
        ctx.fill()
        ctx.stroke()
        // Tusks.
        ctx.fillStyle = '#f4ecd8'
        ctx.beginPath()
        ctx.moveTo(dir * 20, -10 - bob)
        ctx.lineTo(dir * 28, -16 - bob)
        ctx.lineTo(dir * 22, -8 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#ff5540'
        ellipse(ctx, dir * 18, -17 - bob, 1.8, 1.8)
        ctx.fill()
        // Snout.
        ctx.fillStyle = '#3a2416'
        ellipse(ctx, dir * 24, -12 - bob, 3, 2.4)
        ctx.fill()
    }

    private drawSwarmer(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const hop = Math.abs(Math.sin(e.walk * 1.5)) * 4
        ctx.strokeStyle = outline
        ctx.lineWidth = 2.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-3, -6 - hop)
        ctx.lineTo(-5, 0)
        ctx.moveTo(3, -6 - hop)
        ctx.lineTo(5, 0)
        ctx.stroke()
        ctx.lineWidth = 1.5
        ctx.fillStyle = tint('#79b53a')
        ellipse(ctx, 0, -12 - hop - bob, 8, 8)
        ctx.fill()
        ctx.stroke()
        // Leaf sprout.
        ctx.fillStyle = tint('#a7d95a')
        ctx.beginPath()
        ctx.moveTo(0, -19 - hop - bob)
        ctx.quadraticCurveTo(-8, -27 - hop - bob, -2, -30 - hop - bob)
        ctx.quadraticCurveTo(2, -24 - hop - bob, 0, -19 - hop - bob)
        ctx.fill()
        ctx.stroke()
        // Big eyes.
        ctx.fillStyle = '#fff8e0'
        ellipse(ctx, dir * 3 - 2.5, -13 - hop - bob, 2.6, 3)
        ctx.fill()
        ellipse(ctx, dir * 3 + 2.5, -13 - hop - bob, 2.6, 3)
        ctx.fill()
        ctx.fillStyle = '#1d1520'
        ellipse(ctx, dir * 3.6 - 2.5, -13 - hop - bob, 1.2, 1.6)
        ctx.fill()
        ellipse(ctx, dir * 3.6 + 2.5, -13 - hop - bob, 1.2, 1.6)
        ctx.fill()
        // Teeth when winding up.
        if (e.state === 'windup') {
            ctx.fillStyle = '#fff'
            ctx.beginPath()
            ctx.moveTo(dir * 2 - 4, -8 - hop - bob)
            ctx.lineTo(dir * 2 - 2, -5 - hop - bob)
            ctx.lineTo(dir * 2, -8 - hop - bob)
            ctx.lineTo(dir * 2 + 2, -5 - hop - bob)
            ctx.lineTo(dir * 2 + 4, -8 - hop - bob)
            ctx.closePath()
            ctx.fill()
        }
    }

    private drawShieldwarden(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const stride = Math.sin(e.walk) * 3
        ctx.strokeStyle = outline
        ctx.lineWidth = 5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-5, -12)
        ctx.lineTo(-5 + stride, 0)
        ctx.moveTo(5, -12)
        ctx.lineTo(5 - stride, 0)
        ctx.stroke()
        ctx.lineWidth = 1.6
        // Armoured body.
        ctx.fillStyle = bodyGrad(ctx, tint('#8c93a3'), -11, -30 - bob, 11, -10 - bob)
        ctx.beginPath()
        ctx.moveTo(-11, -30 - bob)
        ctx.lineTo(11, -30 - bob)
        ctx.lineTo(10, -10 - bob)
        ctx.lineTo(-10, -10 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.fillRect(-10, -20 - bob, 20, 3)
        // Great helm with a crest.
        ctx.fillStyle = bodyGrad(ctx, tint('#a9b0bd'), -8, -46 - bob, 8, -30 - bob)
        ctx.fillRect(-8, -46 - bob, 16, 16)
        ctx.strokeRect(-8, -46 - bob, 16, 16)
        ctx.fillStyle = '#b5652f'
        ctx.fillRect(-2, -52 - bob, 4, 7)
        ctx.strokeRect(-2, -52 - bob, 4, 7)
        ctx.fillStyle = '#1d1520'
        ctx.fillRect(dir * 2 - 5, -40 - bob, 10, 2.5)
        // Mace on the off side.
        ctx.save()
        ctx.translate(-dir * 10, -24 - bob)
        ctx.rotate(-dir * (e.state === 'windup' ? 1.6 : 0.4))
        ctx.fillStyle = '#5a3d26'
        ctx.fillRect(0, -2, 18, 4)
        ctx.strokeRect(0, -2, 18, 4)
        ctx.fillStyle = '#6b7280'
        ellipse(ctx, 20, 0, 5, 5)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
        // Tower shield on the facing side.
        if (e.shield && !e.shield.broken) {
            ctx.fillStyle = tint('#b5652f')
            ctx.beginPath()
            ctx.moveTo(dir * 10, -44 - bob)
            ctx.lineTo(dir * 24, -44 - bob)
            ctx.lineTo(dir * 24, -14 - bob)
            ctx.lineTo(dir * 17, -4 - bob)
            ctx.lineTo(dir * 10, -14 - bob)
            ctx.closePath()
            ctx.fill()
            ctx.lineWidth = 2.2
            ctx.stroke()
            ctx.lineWidth = 1.6
            ctx.fillStyle = '#d9d2c2'
            ctx.beginPath()
            ctx.moveTo(dir * 17, -40 - bob)
            ctx.lineTo(dir * 21, -30 - bob)
            ctx.lineTo(dir * 17, -20 - bob)
            ctx.lineTo(dir * 13, -30 - bob)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = 'rgba(255,255,255,0.4)'
            ctx.beginPath()
            ctx.moveTo(dir * 12, -42 - bob)
            ctx.lineTo(dir * 12, -14 - bob)
            ctx.stroke()
            ctx.strokeStyle = outline
        } else {
            // Splintered remains.
            ctx.fillStyle = '#7a4a24'
            ctx.beginPath()
            ctx.moveTo(dir * 10, -30 - bob)
            ctx.lineTo(dir * 18, -34 - bob)
            ctx.lineTo(dir * 15, -22 - bob)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
    }

    private drawRanged(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const stride = Math.sin(e.walk) * 3
        ctx.strokeStyle = outline
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-3, -8)
        ctx.lineTo(-3 + stride, 0)
        ctx.moveTo(3, -8)
        ctx.lineTo(3 - stride, 0)
        ctx.stroke()
        ctx.lineWidth = 1.6
        // Stalk body.
        ctx.fillStyle = tint('#e9dcc2')
        ctx.beginPath()
        ctx.moveTo(-6, -8 - bob)
        ctx.lineTo(6, -8 - bob)
        ctx.lineTo(5, -24 - bob)
        ctx.lineTo(-5, -24 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // Cap.
        ctx.fillStyle = bodyGrad(ctx, tint('#7b3fa0'), -15, -46 - bob, 15, -24 - bob)
        ctx.beginPath()
        ctx.moveTo(-15, -24 - bob)
        ctx.quadraticCurveTo(0, -46 - bob, 15, -24 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#f2d9ff'
        for (const [dx, dy, r] of [[-7, -30, 2.4], [3, -36, 2], [8, -28, 1.6]] as const) {
            ellipse(ctx, dx, dy - bob, r, r * 0.8)
            ctx.fill()
        }
        // Eyes.
        ctx.fillStyle = '#1d1520'
        ellipse(ctx, dir * 2 - 2.5, -16 - bob, 1.3, 1.8)
        ctx.fill()
        ellipse(ctx, dir * 2 + 2.5, -16 - bob, 1.3, 1.8)
        ctx.fill()
        // Blowpipe toward the target.
        const ang = e.facing
        const px = Math.cos(ang)
        const py = Math.sin(ang) * YS
        ctx.strokeStyle = outline
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(px * 4, -14 - bob + py * 4)
        ctx.lineTo(px * 22, -14 - bob + py * 22)
        ctx.stroke()
        ctx.strokeStyle = '#8a9a4a'
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.moveTo(px * 4, -14 - bob + py * 4)
        ctx.lineTo(px * 22, -14 - bob + py * 22)
        ctx.stroke()
    }

    private drawOgre(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const stride = Math.sin(e.walk) * 6
        ctx.strokeStyle = outline
        ctx.lineWidth = 9
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-12, -20)
        ctx.lineTo(-12 + stride, 0)
        ctx.moveTo(12, -20)
        ctx.lineTo(12 - stride, 0)
        ctx.stroke()
        ctx.strokeStyle = '#4d5a3a'
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.moveTo(-12, -20)
        ctx.lineTo(-12 + stride, 0)
        ctx.moveTo(12, -20)
        ctx.lineTo(12 - stride, 0)
        ctx.stroke()
        ctx.strokeStyle = outline
        ctx.lineWidth = 2
        // Belly + body.
        ctx.fillStyle = bodyGrad(ctx, tint('#6e8352'), -28, -64 - bob, 28, -12 - bob)
        ellipse(ctx, 0, -38 - bob, 28, 26)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = bodyGrad(ctx, tint('#9db07a'), -18, -48 - bob, 18, -16 - bob)
        ellipse(ctx, 0, -32 - bob, 18, 16)
        ctx.fill()
        // Warts.
        ctx.fillStyle = 'rgba(60,80,40,0.6)'
        for (const [wx, wy] of [[-18, -50], [-22, -34], [16, -54], [22, -30]] as const) {
            ellipse(ctx, wx, wy - bob, 2.6, 2)
            ctx.fill()
        }
        // Loincloth.
        ctx.fillStyle = '#5a3d26'
        ctx.beginPath()
        ctx.moveTo(-16, -22 - bob)
        ctx.lineTo(16, -22 - bob)
        ctx.lineTo(10, -8 - bob)
        ctx.lineTo(-10, -8 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // Head with an underbite.
        ctx.fillStyle = bodyGrad(ctx, tint('#6e8352'), dir * 4 - 13, -77 - bob, dir * 4 + 13, -55 - bob)
        ellipse(ctx, dir * 4, -66 - bob, 13, 11)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#7f9460')
        ellipse(ctx, dir * 8, -59 - bob, 8, 4)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#ffd25a'
        ellipse(ctx, dir * 8, -68 - bob, 2.6, 2.6)
        ctx.fill()
        ctx.fillStyle = '#1d1520'
        ellipse(ctx, dir * 8.6, -68 - bob, 1.2, 1.2)
        ctx.fill()
        ctx.fillStyle = '#f4ecd8'
        ctx.beginPath()
        ctx.moveTo(dir * 2, -60 - bob)
        ctx.lineTo(dir * 4, -66 - bob)
        ctx.lineTo(dir * 6, -60 - bob)
        ctx.closePath()
        ctx.fill()
        // Massive club, raised on windup.
        const raise = e.state === 'windup' && e.attack ? -1.8 * clamp(e.stateT / e.attack.windup, 0, 1) : e.state === 'recover' ? 0.9 : 0
        ctx.save()
        ctx.translate(dir * 24, -40 - bob)
        ctx.rotate(dir * (0.6 + raise))
        ctx.fillStyle = '#4a3220'
        ctx.fillRect(0, -4, 34, 8)
        ctx.strokeRect(0, -4, 34, 8)
        ctx.fillStyle = '#6b4a2c'
        ellipse(ctx, 38, 0, 12, 10)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#c9c2b4'
        for (let i = 0; i < 4; i++) {
            const a = i / 4 * Math.PI * 2
            ellipse(ctx, 38 + Math.cos(a) * 11, Math.sin(a) * 9, 2.2, 2.2)
            ctx.fill()
        }
        ctx.restore()
    }

    private drawWarlord(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const stride = Math.sin(e.walk) * 5
        ctx.strokeStyle = outline
        ctx.lineWidth = 6
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-7, -16)
        ctx.lineTo(-7 + stride, 0)
        ctx.moveTo(7, -16)
        ctx.lineTo(7 - stride, 0)
        ctx.stroke()
        ctx.strokeStyle = '#3a3040'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(-7, -16)
        ctx.lineTo(-7 + stride, 0)
        ctx.moveTo(7, -16)
        ctx.lineTo(7 - stride, 0)
        ctx.stroke()
        ctx.strokeStyle = outline
        ctx.lineWidth = 1.8
        // Tattered cloak behind.
        ctx.fillStyle = tint('#5a1f24')
        ctx.beginPath()
        ctx.moveTo(-10, -40 - bob)
        ctx.lineTo(10, -40 - bob)
        ctx.lineTo(-dir * 18 + Math.sin(this.t * 5) * 3, -4)
        ctx.lineTo(-dir * 4, -8)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // Dark plate.
        ctx.fillStyle = bodyGrad(ctx, tint('#4a4552'), -14, -42 - bob, 14, -14 - bob)
        ctx.beginPath()
        ctx.moveTo(-14, -42 - bob)
        ctx.lineTo(14, -42 - bob)
        ctx.lineTo(12, -14 - bob)
        ctx.lineTo(-12, -14 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#c0392b'
        ctx.fillRect(-10, -34 - bob, 20, 3)
        ctx.fillStyle = 'rgba(255,255,255,0.2)'
        ctx.fillRect(-10, -40 - bob, 6, 20)
        // Horned helm.
        ctx.fillStyle = tint('#5a5563')
        ctx.fillRect(-9, -60 - bob, 18, 18)
        ctx.strokeRect(-9, -60 - bob, 18, 18)
        ctx.fillStyle = '#ff5540'
        ctx.fillRect(dir * 2 - 6, -53 - bob, 12, 2.5)
        ctx.fillStyle = '#d9d2c2'
        ctx.beginPath()
        ctx.moveTo(-9, -56 - bob)
        ctx.lineTo(-20, -70 - bob)
        ctx.lineTo(-8, -62 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(9, -56 - bob)
        ctx.lineTo(20, -70 - bob)
        ctx.lineTo(8, -62 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // Red plume.
        ctx.strokeStyle = '#c0392b'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(0, -60 - bob)
        ctx.quadraticCurveTo(-dir * 10, -72 - bob, -dir * 18, -62 - bob)
        ctx.stroke()
        ctx.strokeStyle = outline
        ctx.lineWidth = 1.8
        // Greatsword.
        const raise = e.state === 'windup' && e.attack ? -1.4 * clamp(e.stateT / e.attack.windup, 0, 1) : e.state === 'recover' ? 0.9 : 0
        ctx.save()
        ctx.translate(dir * 14, -32 - bob)
        ctx.rotate(dir * (0.5 + raise))
        ctx.fillStyle = '#3b2e3f'
        ctx.fillRect(-6, -2, 10, 4)
        ctx.fillStyle = '#e0b04a'
        ctx.fillRect(3, -7, 3, 14)
        ctx.fillStyle = '#cfd6e0'
        ctx.beginPath()
        ctx.moveTo(6, -4)
        ctx.lineTo(44, -2)
        ctx.lineTo(50, 0)
        ctx.lineTo(44, 2)
        ctx.lineTo(6, 4)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.restore()
        // Shield.
        if (e.shield && !e.shield.broken) {
            ctx.fillStyle = tint('#2f2a36')
            ctx.beginPath()
            ctx.moveTo(dir * 12, -50 - bob)
            ctx.lineTo(dir * 30, -50 - bob)
            ctx.lineTo(dir * 30, -20 - bob)
            ctx.lineTo(dir * 21, -8 - bob)
            ctx.lineTo(dir * 12, -20 - bob)
            ctx.closePath()
            ctx.fill()
            ctx.lineWidth = 2.5
            ctx.stroke()
            ctx.fillStyle = '#c0392b'
            ellipse(ctx, dir * 21, -32 - bob, 5, 6)
            ctx.fill()
        }
    }

    private drawBriar(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const t = this.t
        const bristle = e.state === 'windup' && e.attack ? clamp(e.stateT / e.attack.windup, 0, 1) : 0
        // Six thorned legs, arching out of the bramble body.
        for (let i = 0; i < 6; i++) {
            const side = i < 3 ? -1 : 1
            const k = i % 3
            const base = -26 - k * 6
            const spread = (26 + k * 12) * side
            const lift = Math.sin(e.walk * 0.8 + i) * 4 + bristle * 6
            ctx.strokeStyle = outline
            ctx.lineWidth = 7 - k
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(side * 8, base - bob)
            ctx.quadraticCurveTo(spread * 0.7, base - 16 - lift - bob, spread, -2)
            ctx.stroke()
            ctx.strokeStyle = tint('#4c6b33')
            ctx.lineWidth = 4.5 - k
            ctx.beginPath()
            ctx.moveTo(side * 8, base - bob)
            ctx.quadraticCurveTo(spread * 0.7, base - 16 - lift - bob, spread, -2)
            ctx.stroke()
        }
        ctx.strokeStyle = outline
        ctx.lineWidth = 1.8
        // Abdomen — a bramble sac, thorns all over it.
        ctx.fillStyle = bodyGrad(ctx, tint('#3f5a2c'), -26, -46 - bob, 26, -6 - bob)
        ellipse(ctx, -dir * 6, -26 - bob, 26, 21)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#5c7d3c')
        for (let i = 0; i < 7; i++) {
            const ang = i / 7 * Math.PI * 2 + e.seed
            ctx.beginPath()
            ctx.moveTo(-dir * 6 + Math.cos(ang) * 22, -26 - bob + Math.sin(ang) * 17)
            ctx.lineTo(-dir * 6 + Math.cos(ang + 0.16) * 20, -26 - bob + Math.sin(ang + 0.16) * 15)
            ctx.lineTo(-dir * 6 + Math.cos(ang) * 33, -26 - bob + Math.sin(ang) * 26)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        // Thorax and the matriarch's torso above it.
        ctx.fillStyle = bodyGrad(ctx, tint('#6b8a44'), -14, -44 - bob, 14, -20 - bob)
        ellipse(ctx, dir * 8, -34 - bob, 15, 14)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = bodyGrad(ctx, tint('#7d5a34'), -10, -58 - bob, 10, -38 - bob)
        ctx.beginPath()
        ctx.moveTo(dir * 8 - 10, -40 - bob)
        ctx.quadraticCurveTo(dir * 8 - 8, -58 - bob, dir * 8, -60 - bob)
        ctx.quadraticCurveTo(dir * 8 + 8, -58 - bob, dir * 8 + 10, -40 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // Petal crown, breathing with the idle.
        for (let i = 0; i < 7; i++) {
            const ang = -Math.PI + i / 6 * Math.PI
            const r = 13 + Math.sin(t * 2 + i) * 1.5 + bristle * 4
            ctx.fillStyle = tint(i % 2 === 0 ? '#c9527f' : '#e0708f')
            ellipse(ctx, dir * 8 + Math.cos(ang) * r, -60 - bob + Math.sin(ang) * r * 0.8, 6, 4)
            ctx.fill()
            ctx.stroke()
        }
        ctx.fillStyle = tint('#f0d98a')
        ellipse(ctx, dir * 8, -60 - bob, 8, 7)
        ctx.fill()
        ctx.stroke()
        // Cluster eyes.
        ctx.fillStyle = '#2a1020'
        for (const [ex, ey] of [[-4, -62], [1, -63], [5, -61], [-1, -58]] as const) {
            ellipse(ctx, dir * 8 + ex, ey - bob, 1.7, 1.7)
            ctx.fill()
        }
        ctx.fillStyle = 'rgba(255,220,120,0.85)'
        ellipse(ctx, dir * 8 + 1, -63 - bob, 0.9, 0.9)
        ctx.fill()
        // Front scythe-arms, raised through a windup.
        for (const side of [-1, 1]) {
            ctx.save()
            ctx.translate(dir * 8 + side * 11, -44 - bob)
            ctx.rotate(side * (0.5 - bristle * 1.1))
            ctx.fillStyle = tint('#5c7d3c')
            ctx.beginPath()
            ctx.moveTo(0, -3)
            ctx.quadraticCurveTo(side * 16, -10, side * 26, -2)
            ctx.quadraticCurveTo(side * 16, -3, 0, 3)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.restore()
        }
    }

    private drawKnight(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const t = this.t
        const stride = Math.sin(e.walk) * 5
        const parry = e.parryT > 0 || (e.state === 'windup' && e.attack?.kind === 'parry')
        ctx.strokeStyle = outline
        ctx.lineWidth = 6
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-6, -16)
        ctx.lineTo(-6 + stride, 0)
        ctx.moveTo(6, -16)
        ctx.lineTo(6 - stride, 0)
        ctx.stroke()
        ctx.strokeStyle = '#3c4256'
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(-6, -16)
        ctx.lineTo(-6 + stride, 0)
        ctx.moveTo(6, -16)
        ctx.lineTo(6 - stride, 0)
        ctx.stroke()
        ctx.strokeStyle = outline
        ctx.lineWidth = 1.8
        // Half-cape, trailing behind.
        ctx.fillStyle = tint('#1f2740')
        ctx.beginPath()
        ctx.moveTo(-8, -42 - bob)
        ctx.lineTo(8, -42 - bob)
        ctx.lineTo(-dir * 16 + Math.sin(t * 4.5) * 3, -6)
        ctx.lineTo(-dir * 3, -10)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // Cuirass, narrow-waisted duellist's plate.
        ctx.fillStyle = bodyGrad(ctx, tint('#8792a8'), -12, -44 - bob, 12, -14 - bob)
        ctx.beginPath()
        ctx.moveTo(-12, -44 - bob)
        ctx.lineTo(12, -44 - bob)
        ctx.lineTo(9, -22 - bob)
        ctx.lineTo(0, -14 - bob)
        ctx.lineTo(-9, -22 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,0.18)'
        ctx.fillRect(-11, -43 - bob, 5, 20)
        ctx.strokeStyle = 'rgba(30,26,40,0.6)'
        ctx.beginPath()
        ctx.moveTo(0, -44 - bob)
        ctx.lineTo(0, -16 - bob)
        ctx.stroke()
        ctx.strokeStyle = outline
        // Pauldrons.
        for (const side of [-1, 1]) {
            ctx.fillStyle = bodyGrad(ctx, tint('#9aa5bb'), side * 8, -48 - bob, side * 20, -34 - bob)
            ellipse(ctx, side * 13, -41 - bob, 7, 6)
            ctx.fill()
            ctx.stroke()
        }
        // Great helm, hollow but for the visor light.
        ctx.fillStyle = bodyGrad(ctx, tint('#aab4c8'), -9, -64 - bob, 9, -44 - bob)
        ctx.beginPath()
        ctx.moveTo(-9, -62 - bob)
        ctx.quadraticCurveTo(0, -70 - bob, 9, -62 - bob)
        ctx.lineTo(8, -46 - bob)
        ctx.lineTo(-8, -46 - bob)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = parry ? '#eaf4ff' : '#7fd4ff'
        ctx.fillRect(dir * 1 - 6, -57 - bob, 12, 2.6)
        ctx.fillStyle = 'rgba(120,200,255,0.35)'
        ctx.fillRect(dir * 1 - 7, -58 - bob, 14, 4.6)
        // Crest.
        ctx.strokeStyle = '#5b6cc4'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(0, -68 - bob)
        ctx.quadraticCurveTo(-dir * 9, -74 - bob, -dir * 16, -66 - bob)
        ctx.stroke()
        ctx.strokeStyle = outline
        ctx.lineWidth = 1.8
        // Longsword: level in the parry stance, wound up otherwise.
        const raise = e.state === 'windup' && e.attack && e.attack.kind === 'melee' ? -1.5 * clamp(e.stateT / e.attack.windup, 0, 1) : e.state === 'recover' ? 0.8 : 0
        ctx.save()
        ctx.translate(dir * 13, -34 - bob)
        ctx.rotate(parry ? -Math.PI / 2 * dir : dir * (0.45 + raise))
        ctx.fillStyle = '#2b2436'
        ctx.fillRect(-7, -2, 11, 4)
        ctx.fillStyle = '#c3cbd8'
        ctx.fillRect(3, -8, 3, 16)
        ctx.fillStyle = '#e8eef7'
        ctx.beginPath()
        ctx.moveTo(6, -3)
        ctx.lineTo(48, -1.6)
        ctx.lineTo(56, 0)
        ctx.lineTo(48, 1.6)
        ctx.lineTo(6, 3)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        if (parry) {
            // Blue-white glint running up the edge.
            const gk = (t * 1.6) % 1
            ctx.fillStyle = 'rgba(220,240,255,0.9)'
            ellipse(ctx, 8 + gk * 46, 0, 5, 2.6)
            ctx.fill()
        }
        ctx.restore()
        // Buckler on the off-hand.
        if (e.shield && !e.shield.broken) {
            ctx.fillStyle = tint('#4a5470')
            ellipse(ctx, -dir * 15, -34 - bob, 8, 11)
            ctx.fill()
            ctx.lineWidth = 2.4
            ctx.stroke()
            ctx.lineWidth = 1.8
            ctx.fillStyle = '#7fd4ff'
            ellipse(ctx, -dir * 15, -34 - bob, 3, 3.6)
            ctx.fill()
        }
    }

    // ------------------------------------------------------------------- air

    private drawAir(ctx: Ctx) {
        const g = this.game
        // Swing trails — each weapon has its own signature.
        for (const tr of g.trails) {
            const k = tr.life / tr.maxLife
            const y = tr.y * YS - tr.z
            ctx.save()
            ctx.translate(tr.x, y)
            ctx.scale(1, YS)
            ctx.globalAlpha = k
            if (tr.kind === 'arc' || tr.kind === 'ring') this.drawArcTrail(ctx, tr, k)
            else this.drawThrustTrail(ctx, tr, k)
            ctx.restore()
        }
        ctx.globalAlpha = 1

        // Meteors falling, singularities and orbiting blades.
        for (const m of g.meteors) {
            const k = clamp(m.t / m.delay, 0, 1)
            const z = (1 - k) * 520
            const x = m.x + (1 - k) * 160
            const y = m.y * YS - z
            ctx.strokeStyle = 'rgba(255,150,60,0.7)'
            ctx.lineWidth = 6
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(x + 40, y - 120)
            ctx.lineTo(x, y)
            ctx.stroke()
            ctx.fillStyle = '#ff8c2a'
            ctx.beginPath()
            ctx.arc(x, y, 12 + k * 6, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#fff2c4'
            ctx.beginPath()
            ctx.arc(x, y, 6, 0, Math.PI * 2)
            ctx.fill()
        }
        for (const sg of g.singularities) {
            const k = sg.life / sg.maxLife
            ctx.save()
            ctx.translate(sg.x, sg.y * YS - 8)
            ctx.scale(1, YS)
            const r = sg.radius * (0.5 + 0.5 * Math.min(1, (sg.maxLife - sg.life) * 4)) * (0.6 + 0.4 * k)
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
            grad.addColorStop(0, 'rgba(10,5,20,0.95)')
            grad.addColorStop(0.7, 'rgba(60,20,90,0.7)')
            grad.addColorStop(1, 'rgba(180,140,255,0)')
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.arc(0, 0, r, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(200,160,255,0.8)'
            ctx.lineWidth = 3
            for (let i = 0; i < 3; i++) {
                ctx.beginPath()
                ctx.arc(0, 0, r * (0.55 + i * 0.18), sg.spin + i * 2, sg.spin + i * 2 + 1.6)
                ctx.stroke()
            }
            ctx.restore()
        }
        const pl = g.player
        for (const o of g.orbitals) {
            const k = Math.min(1, o.life / 0.6)
            ctx.globalAlpha = k
            for (let b = 0; b < 3; b++) {
                const a = o.angle + b * Math.PI * 2 / 3
                const bx = pl.x + Math.cos(a) * 64
                const by = (pl.y + Math.sin(a) * 64) * YS - 26
                ctx.save()
                ctx.translate(bx, by)
                ctx.rotate(Math.atan2(Math.sin(a + Math.PI / 2) * YS, Math.cos(a + Math.PI / 2)))
                ctx.fillStyle = 'rgba(191,230,255,0.9)'
                ctx.strokeStyle = 'rgba(255,255,255,0.9)'
                ctx.lineWidth = 1.5
                ctx.beginPath()
                ctx.moveTo(-14, 0)
                ctx.lineTo(2, -5)
                ctx.lineTo(16, 0)
                ctx.lineTo(2, 5)
                ctx.closePath()
                ctx.fill()
                ctx.stroke()
                ctx.restore()
            }
        }
        ctx.globalAlpha = 1

        // Impact flashes at the point of contact.
        for (const im of g.impacts) {
            const k = im.life / im.maxLife
            const x = im.x
            const y = im.y * YS - im.z
            ctx.globalAlpha = k
            if (im.kind === 'burst') {
                ctx.strokeStyle = im.color
                ctx.lineWidth = 2.5
                ctx.lineCap = 'round'
                const grow = 1 - k * k
                for (let i = 0; i < 6; i++) {
                    const a = im.angle + i / 6 * Math.PI * 2 + 0.4
                    const r0 = im.size * 0.25 * grow
                    const r1 = im.size * (0.35 + grow * 0.65)
                    ctx.beginPath()
                    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.8)
                    ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.8)
                    ctx.stroke()
                }
                ctx.fillStyle = im.color
                ctx.beginPath()
                ctx.arc(x, y, im.size * 0.22 * k, 0, Math.PI * 2)
                ctx.fill()
            } else if (im.kind === 'slash') {
                ctx.save()
                ctx.translate(x, y)
                ctx.rotate(Math.atan2(Math.sin(im.angle) * YS, Math.cos(im.angle)) + Math.PI / 2)
                ctx.strokeStyle = im.color
                ctx.lineWidth = 3.5 * k + 1
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.moveTo(-im.size * 0.5, im.size * 0.15)
                ctx.quadraticCurveTo(0, -im.size * 0.35, im.size * 0.5, im.size * 0.15)
                ctx.stroke()
                ctx.restore()
            } else {
                ctx.strokeStyle = im.color
                ctx.lineWidth = 3 * k
                ctx.beginPath()
                ctx.ellipse(x, y, im.size * (1.2 - k), im.size * (1.2 - k) * 0.7, 0, 0, Math.PI * 2)
                ctx.stroke()
            }
        }
        ctx.globalAlpha = 1

        // Lightning.
        for (const b of g.bolts) {
            const k = b.life / b.maxLife
            ctx.globalAlpha = k
            for (const [width, color] of [[6, 'rgba(180,140,255,0.6)'], [2, '#ffffff']] as const) {
                ctx.strokeStyle = color
                ctx.lineWidth = width
                ctx.beginPath()
                for (let i = 0; i < b.points.length - 1; i++) {
                    const a = b.points[i]!
                    const c = b.points[i + 1]!
                    ctx.moveTo(a.x, a.y * YS - 16)
                    const segs = 5
                    for (let s = 1; s <= segs; s++) {
                        const t = s / segs
                        const jx = s === segs ? 0 : (Math.random() - 0.5) * 18
                        const jy = s === segs ? 0 : (Math.random() - 0.5) * 18
                        ctx.lineTo(lerp(a.x, c.x, t) + jx, lerp(a.y, c.y, t) * YS - 16 + jy)
                    }
                }
                ctx.stroke()
            }
        }
        ctx.globalAlpha = 1

        // Whirlwind blades.
        const p = g.player
        for (const w of g.whirlwinds) {
            const k = w.life / w.maxLife
            ctx.save()
            ctx.translate(p.x, p.y * YS - 18)
            ctx.scale(1, YS)
            ctx.globalAlpha = 0.7 * k
            for (let i = 0; i < 4; i++) {
                const a = w.spin * 1.4 + i * Math.PI / 2
                const grad = ctx.createRadialGradient(0, 0, w.radius * 0.3, 0, 0, w.radius)
                grad.addColorStop(0, 'rgba(255,255,255,0)')
                grad.addColorStop(1, 'rgba(240,235,200,0.9)')
                ctx.fillStyle = grad
                ctx.beginPath()
                ctx.moveTo(0, 0)
                ctx.arc(0, 0, w.radius, a, a + 0.9)
                ctx.closePath()
                ctx.fill()
            }
            ctx.restore()
        }
        ctx.globalAlpha = 1
    }

    private drawArcTrail(ctx: Ctx, tr: { angle0: number, angle1: number, reach: number, width: number, color: string, style: string, finisher?: boolean }, k: number) {
        const a0 = tr.angle0
        const a1 = tr.angle1
        const ccw = a1 < a0
        const band = (inner: number, outer: number, stops: [number, string][]) => {
            const grad = ctx.createRadialGradient(0, 0, Math.max(1, inner), 0, 0, outer)
            for (const [t, c] of stops) grad.addColorStop(t, c)
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.arc(0, 0, outer, a0, a1, ccw)
            ctx.arc(0, 0, Math.max(1, inner), a1, a0, !ccw)
            ctx.closePath()
            ctx.fill()
        }
        const edge = (r: number, color: string, width: number) => {
            ctx.strokeStyle = color
            ctx.lineWidth = width
            ctx.beginPath()
            ctx.arc(0, 0, r, a0, a1, ccw)
            ctx.stroke()
        }
        const w = tr.width
        switch (tr.style) {
            case 'sword':
                // Clean silver crescent with a crisp bright edge.
                band(tr.reach - w * 0.8, tr.reach, [[0, 'rgba(219,228,243,0)'], [0.7, 'rgba(219,228,243,0.75)'], [1, 'rgba(255,255,255,0.95)']])
                edge(tr.reach - 1, 'rgba(255,255,255,0.95)', 2.5)
                edge(tr.reach - w * 0.45, 'rgba(160,200,255,0.5)', 1.2)
                break
            case 'greataxe': {
                // Heavy, hot: a thick smouldering band with a jagged glowing rim.
                band(tr.reach - w * 1.3, tr.reach + 4, [[0, 'rgba(255,120,40,0)'], [0.55, 'rgba(255,120,40,0.55)'], [0.9, 'rgba(255,200,120,0.9)'], [1, 'rgba(255,240,200,0.3)']])
                ctx.strokeStyle = 'rgba(255,230,180,0.95)'
                ctx.lineWidth = 3.5
                ctx.beginPath()
                const n = 14
                for (let i = 0; i <= n; i++) {
                    const a = a0 + (a1 - a0) * i / n
                    const r = tr.reach + (i % 2 === 0 ? 0 : -5)
                    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
                    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
                }
                ctx.stroke()
                break
            }
            case 'daggers':
                // Two razor-thin gold streaks.
                edge(tr.reach - 2, 'rgba(255,246,214,0.95)', 2)
                edge(tr.reach - w * 0.6, 'rgba(255,220,150,0.8)', 1.5)
                band(tr.reach - w * 0.7, tr.reach, [[0, 'rgba(255,230,170,0)'], [1, 'rgba(255,230,170,0.35)']])
                break
            case 'warhammer':
                // Blunt, wide, with concussion rings trailing the head.
                band(tr.reach - w * 1.1, tr.reach + 6, [[0, 'rgba(216,208,196,0)'], [0.6, 'rgba(216,208,196,0.5)'], [1, 'rgba(255,255,255,0.85)']])
                edge(tr.reach + 6 + (1 - k) * 14, `rgba(255,255,255,${0.6 * k})`, 3)
                edge(tr.reach + 6 + (1 - k) * 26, `rgba(216,208,196,${0.35 * k})`, 2)
                break
            case 'scythe': {
                // A spectral reaping crescent: dark soul-smoke inside, cold green-white edge.
                band(tr.reach - w * 1.4, tr.reach, [[0, 'rgba(20,10,40,0)'], [0.5, 'rgba(30,20,60,0.55)'], [0.85, 'rgba(120,230,200,0.7)'], [1, 'rgba(230,255,245,0.95)']])
                edge(tr.reach - 1, 'rgba(180,255,230,0.95)', 3)
                ctx.fillStyle = 'rgba(143,227,200,0.55)'
                for (let i = 0; i < 6; i++) {
                    const a = a0 + (a1 - a0) * (i + 0.5) / 6
                    const r = tr.reach - w * (0.4 + (i % 3) * 0.3)
                    ctx.beginPath()
                    ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 4 + (1 - k) * 4, 0, Math.PI * 2)
                    ctx.fill()
                }
                break
            }
            case 'ghost':
                band(tr.reach - w, tr.reach, [[0, 'rgba(191,230,255,0)'], [1, 'rgba(191,230,255,0.6)']])
                edge(tr.reach - 1, 'rgba(230,245,255,0.8)', 1.5)
                break
            case 'enemy':
                band(tr.reach - w, tr.reach, [[0, 'rgba(255,120,100,0)'], [0.7, 'rgba(255,120,100,0.6)'], [1, 'rgba(255,220,200,0.9)']])
                edge(tr.reach - 1, 'rgba(255,240,230,0.8)', 2)
                break
            default:
                band(tr.reach - w, tr.reach, [[0, 'rgba(255,255,255,0)'], [0.6, tr.color], [1, 'rgba(255,255,255,0.9)']])
                edge(tr.reach - 1, 'rgba(255,255,255,0.8)', 2)
        }
        if (tr.finisher) edge(tr.reach + 4, `rgba(255,255,255,${0.5 * k})`, 1.5)
    }

    private drawThrustTrail(ctx: Ctx, tr: { angle0: number, reach: number, width: number, color: string, style: string, finisher?: boolean }, k: number) {
        ctx.rotate(tr.angle0)
        if (tr.style === 'spear') {
            // A needle-thin gold streak with a flash at the tip and speed lines.
            const grad = ctx.createLinearGradient(0, 0, tr.reach, 0)
            grad.addColorStop(0, 'rgba(255,233,168,0)')
            grad.addColorStop(0.6, 'rgba(255,233,168,0.7)')
            grad.addColorStop(1, 'rgba(255,255,255,1)')
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.moveTo(0, -tr.width * 0.25)
            ctx.lineTo(tr.reach - 6, -tr.width * 0.12)
            ctx.lineTo(tr.reach + 14, 0)
            ctx.lineTo(tr.reach - 6, tr.width * 0.12)
            ctx.lineTo(0, tr.width * 0.25)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = `rgba(255,255,255,${0.7 * k})`
            ctx.lineWidth = 1.2
            for (const off of [-tr.width * 0.5, tr.width * 0.5]) {
                ctx.beginPath()
                ctx.moveTo(tr.reach * 0.2, off)
                ctx.lineTo(tr.reach * 0.85, off * 0.6)
                ctx.stroke()
            }
            ctx.fillStyle = `rgba(255,255,255,${k})`
            ctx.beginPath()
            ctx.arc(tr.reach + 6, 0, 5 + (1 - k) * 6, 0, Math.PI * 2)
            ctx.fill()
            return
        }
        const grad = ctx.createLinearGradient(0, 0, tr.reach, 0)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(0.5, tr.style === 'ghost' ? 'rgba(191,230,255,0.6)' : tr.color)
        grad.addColorStop(1, 'rgba(255,255,255,0.95)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(0, -tr.width / 2)
        ctx.lineTo(tr.reach, -tr.width * 0.15)
        ctx.lineTo(tr.reach + 8, 0)
        ctx.lineTo(tr.reach, tr.width * 0.15)
        ctx.lineTo(0, tr.width / 2)
        ctx.closePath()
        ctx.fill()
    }

    private drawAfterimages(ctx: Ctx) {
        const g = this.game
        for (const a of g.afterimages) {
            const k = a.life / a.maxLife
            const x = a.x
            const y = a.y * YS
            ctx.globalAlpha = 0.35 * k
            ctx.fillStyle = a.color
            ctx.beginPath()
            ctx.ellipse(x, y - 18, 11, 16, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.beginPath()
            ctx.arc(x, y - 38, 8, 0, Math.PI * 2)
            ctx.fill()
        }
        ctx.globalAlpha = 1
    }

    private drawAbilityAir(ctx: Ctx) {
        const g = this.game
        const p = g.player
        // Shield Wall dome.
        if (p.fx.shieldWall > 0) {
            const k = Math.min(1, p.fx.shieldWall / 0.2)
            ctx.save()
            ctx.translate(p.x, p.y * YS - 22)
            ctx.rotate(Math.atan2(Math.sin(p.facing) * YS, Math.cos(p.facing)))
            ctx.globalAlpha = 0.55 * k
            const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, 48)
            grad.addColorStop(0, 'rgba(188,211,255,0)')
            grad.addColorStop(0.8, 'rgba(188,211,255,0.5)')
            grad.addColorStop(1, 'rgba(255,255,255,0.9)')
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.arc(0, 0, 48, -1.35, 1.35)
            ctx.lineTo(0, 0)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = `rgba(230,240,255,${0.8 * k})`
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(0, 0, 48, -1.35, 1.35)
            ctx.stroke()
            ctx.restore()
        }
        // Souls.
        for (const so of g.souls) {
            const x = so.x
            const y = so.y * YS - 20
            const hunter = so.targetId >= 0 || so.targetId === -2
            ctx.fillStyle = hunter ? 'rgba(201,163,255,0.9)' : 'rgba(143,227,200,0.9)'
            ctx.beginPath()
            ctx.arc(x, y, 5, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = hunter ? 'rgba(201,163,255,0.5)' : 'rgba(143,227,200,0.5)'
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x - so.vx * 0.06, y - so.vy * YS * 0.06)
            ctx.stroke()
        }
    }

    private drawGlow(ctx: Ctx) {
        const g = this.game
        const p = g.player
        for (const pt of g.particles) {
            if (pt.kind !== 'glow' && pt.kind !== 'spark' && pt.kind !== 'ember' && pt.kind !== 'spore') continue
            const k = pt.life / pt.maxLife
            const x = pt.x
            const y = pt.y * YS - pt.z
            if (pt.kind === 'spark') {
                ctx.strokeStyle = pt.color
                ctx.globalAlpha = Math.min(1, k * 1.5)
                ctx.lineWidth = pt.size * 0.8
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.moveTo(x, y)
                ctx.lineTo(x - pt.vx * 0.03, y - pt.vy * YS * 0.03 + pt.vz * 0.02)
                ctx.stroke()
                continue
            }
            const r = pt.kind === 'glow' ? pt.size * (0.6 + 0.4 * Math.sin(this.t * 6 + pt.x)) : pt.size * k
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 2)
            grad.addColorStop(0, pt.color)
            grad.addColorStop(0.4, pt.color)
            grad.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.globalAlpha = (pt.kind === 'glow' ? 0.55 : 0.8) * Math.min(1, k * 2)
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.arc(x, y, r * 2, 0, Math.PI * 2)
            ctx.fill()
            if (pt.kind === 'ember') {
                ctx.fillStyle = '#fff2c4'
                ctx.beginPath()
                ctx.arc(x, y, r * 0.4, 0, Math.PI * 2)
                ctx.fill()
            }
        }
        ctx.globalAlpha = 1
        // Player auras.
        const aura = p.fx.bloodrage > 0 ? '255,70,60' : p.fx.rally > 0 ? '255,209,102' : p.fx.ironSkin > 0 ? '200,220,255' : p.fx.shieldWall > 0 ? '188,211,255' : null
        if (aura) {
            const x = p.x
            const y = p.y * YS - 20
            const r = 46 + Math.sin(this.t * 7) * 4
            const grad = ctx.createRadialGradient(x, y, 6, x, y, r)
            grad.addColorStop(0, `rgba(${aura},0.35)`)
            grad.addColorStop(1, `rgba(${aura},0)`)
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.arc(x, y, r, 0, Math.PI * 2)
            ctx.fill()
        }
        // Soul glow trails and thrown axe heat.
        for (const so of g.souls) {
            const grad = ctx.createRadialGradient(so.x, so.y * YS - 20, 0, so.x, so.y * YS - 20, 22)
            grad.addColorStop(0, so.targetId === -1 ? 'rgba(143,227,200,0.7)' : 'rgba(201,163,255,0.7)')
            grad.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.arc(so.x, so.y * YS - 20, 22, 0, Math.PI * 2)
            ctx.fill()
        }
        for (const a of g.thrownAxes) {
            const grad = ctx.createRadialGradient(a.x, a.y * YS - 22, 0, a.x, a.y * YS - 22, 40)
            grad.addColorStop(0, 'rgba(255,150,60,0.5)')
            grad.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.arc(a.x, a.y * YS - 22, 40, 0, Math.PI * 2)
            ctx.fill()
        }
        // Singularities and meteors already glow; add a lens on active whirlwinds.
        for (const w of g.whirlwinds) {
            const grad = ctx.createRadialGradient(p.x, p.y * YS - 18, 0, p.x, p.y * YS - 18, w.radius)
            grad.addColorStop(0, 'rgba(240,235,200,0)')
            grad.addColorStop(0.8, 'rgba(240,235,200,0.25)')
            grad.addColorStop(1, 'rgba(240,235,200,0)')
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.ellipse(p.x, p.y * YS - 18, w.radius, w.radius * YS, 0, 0, Math.PI * 2)
            ctx.fill()
        }
    }

    private drawInnerCanopies(ctx: Ctx, ox: number, oy: number) {
        const g = this.game
        const p = g.player
        ctx.save()
        ctx.translate(ox, oy)
        for (const t of g.world.trees) {
            if (!t.inner) continue
            const d = Math.hypot(p.x - t.x, (p.y - t.y) * 1.3)
            const alpha = clamp((d - 40) / 70, 0.28, 1)
            this.paintCanopy(ctx, t, alpha)
        }
        ctx.restore()
    }

    private drawFloaters(ctx: Ctx) {
        const g = this.game
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        for (const f of g.floaters) {
            const k = f.life / f.maxLife
            const pop = 1 + Math.max(0, (k - 0.8)) * 3
            const big = f.size >= 22
            ctx.globalAlpha = Math.min(1, k * 2.5)
            ctx.font = `900 ${Math.round(f.size * pop)}px "Public Sans", system-ui, sans-serif`
            ctx.strokeStyle = 'rgba(15,10,20,0.9)'
            ctx.lineWidth = big ? 6 : 4
            const x = f.x
            const y = f.y * YS - f.z
            ctx.save()
            ctx.translate(x, y)
            if (big) ctx.rotate(Math.sin(k * 30) * 0.08 * (1 - k))
            ctx.strokeText(f.text, 0, 0)
            ctx.fillStyle = f.color
            ctx.fillText(f.text, 0, 0)
            if (big) {
                ctx.globalAlpha *= 0.5
                ctx.lineWidth = 1.5
                ctx.strokeStyle = f.color
                ctx.strokeText(f.text, 0, 0)
            }
            ctx.restore()
        }
        ctx.globalAlpha = 1
    }

    private drawPost(ctx: Ctx, viewH: number, dt: number) {
        const g = this.game
        ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0)
        // Time of day follows the run: noon at wave 1, golden hour by the
        // teens, a blood dusk by the finale.
        const dusk = g.phase === 'menu' ? 0 : clamp((g.wave - 6) / 24, 0, 1)
        if (dusk > 0) {
            ctx.globalCompositeOperation = 'multiply'
            const r = Math.round(lerp(255, 120, dusk))
            const gg = Math.round(lerp(250, 60, dusk))
            const b = Math.round(lerp(235, 110, dusk))
            ctx.fillStyle = `rgba(${r},${gg},${b},${0.2 + dusk * 0.38})`
            ctx.fillRect(0, 0, VIEW_W, viewH)
            ctx.globalCompositeOperation = 'source-over'
        }
        // Drifting god rays.
        ctx.save()
        ctx.globalCompositeOperation = 'overlay'
        const rayAlpha = 0.16 * (1 - dusk * 0.6)
        for (let i = 0; i < 4; i++) {
            const x = ((this.t * 12 + i * 320) % (VIEW_W + 500)) - 250
            const grad = ctx.createLinearGradient(x, 0, x + 140, 0)
            grad.addColorStop(0, 'rgba(255,240,190,0)')
            grad.addColorStop(0.5, `rgba(255,240,190,${rayAlpha})`)
            grad.addColorStop(1, 'rgba(255,240,190,0)')
            ctx.fillStyle = grad
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x + 140, 0)
            ctx.lineTo(x + 140 - 260, viewH)
            ctx.lineTo(x - 260, viewH)
            ctx.closePath()
            ctx.fill()
        }
        ctx.restore()
        // Vignette.
        const v = ctx.createRadialGradient(VIEW_W / 2, viewH / 2, viewH * 0.5, VIEW_W / 2, viewH / 2, viewH * 1.1)
        v.addColorStop(0, 'rgba(20,20,40,0)')
        v.addColorStop(1, 'rgba(20,15,35,0.5)')
        ctx.fillStyle = v
        ctx.fillRect(0, 0, VIEW_W, viewH)
        // Hurt flash + low health pulse.
        const p = g.player
        const low = g.phase === 'wave' && p.hp / p.maxHp < 0.3 ? 0.5 + Math.sin(this.t * 6) * 0.5 : 0
        this.lowHpPulse = lerp(this.lowHpPulse, low, 1 - Math.exp(-6 * dt))
        const red = Math.max(p.hurtFlash * 1.6, this.lowHpPulse * 0.5)
        if (red > 0.01) {
            const h = ctx.createRadialGradient(VIEW_W / 2, viewH / 2, viewH * 0.35, VIEW_W / 2, viewH / 2, viewH * 0.95)
            h.addColorStop(0, 'rgba(200,20,30,0)')
            h.addColorStop(1, `rgba(200,20,30,${Math.min(0.7, red)})`)
            ctx.fillStyle = h
            ctx.fillRect(0, 0, VIEW_W, viewH)
        }
        if (g.flash > 0) {
            ctx.fillStyle = `rgba(255,250,235,${g.flash * 0.8})`
            ctx.fillRect(0, 0, VIEW_W, viewH)
        }
        if (g.slowmo > 0) {
            // Letterbox for the slow-motion beats.
            ctx.fillStyle = 'rgba(0,0,0,0.85)'
            const bar = Math.min(28, g.slowmo * 120)
            ctx.fillRect(0, 0, VIEW_W, bar)
            ctx.fillRect(0, viewH - bar, VIEW_W, bar)
        }
        if (g.phase === 'dead') {
            ctx.fillStyle = `rgba(30,5,10,${clamp(g.deathT / 1.5, 0, 0.55)})`
            ctx.fillRect(0, 0, VIEW_W, viewH)
        }
        if (g.phase === 'upgrade' || g.paused || g.phase === 'menu' || g.phase === 'victory') {
            ctx.fillStyle = 'rgba(10,12,20,0.35)'
            ctx.fillRect(0, 0, VIEW_W, viewH)
        }
    }
}
