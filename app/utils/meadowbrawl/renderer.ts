// Canvas 2D renderer for Meadowbrawl. Paints the terrain once per run into
// offscreen layers, then draws the live scene y-sorted on top with a
// foreshortened ground plane so the 45° camera reads without a 3D stack.
import type { Enemy, MeadowbrawlGame, Particle, Player } from './engine'
import { GROUND_YS as YS } from './types'
import type { TreeDeco, WorldLayout } from './world'
import { WEAPONS } from './weapons'
import { clamp, lerp } from './geometry'
import { drawCoin, drawCompanion, drawFeather, drawFireTrail } from './companion-draw'
import { drawHeroBody, drawHeroWeaponDetails, drawHeroShieldDetails, drawBogOgre, drawAshenWarlord, drawBriarMatriarch, drawHollowKnight } from './character-draw'

export const VIEW_W = 1120
export const VIEW_H = 630
const TS = 1.25

type Ctx = CanvasRenderingContext2D

const TREE_PALETTES = [
    ['#b96a36', '#df9648', '#f5cc79', '#713e32'],
    ['#a94e3f', '#cd7050', '#eeae70', '#633b3b'],
    ['#b89842', '#d9b958', '#f5dea0', '#6b6137'],
    ['#65794b', '#8f9d59', '#cbd48b', '#3d5644']
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
        const seed = w.w * 0.17 + w.h * 0.31
        const s = w.stream
        const b = w.bridge
        const onBridge = (x: number, y: number, pad = 0) => x > b.x0 - pad && x < b.x1 + pad && Math.abs(y - b.y) < b.width / 2 + pad
        const dryGround = (x: number, y: number, pad = 0) => !onBridge(x, y, pad)
            && !(y > s.top - pad && y < s.bottom + pad && Math.abs(x - s.x) < s.width / 2 + 14 + pad)
            && Math.hypot(x - w.pool.x, (y - w.pool.y) / 0.9) > w.pool.r + 14 + pad
        const clearing = (x: number, y: number) => clamp(Math.hypot(x - w.w / 2, y - w.h / 2) / 420, 0.2, 1)
        const base = ctx.createLinearGradient(x0, y0, fullW * 0.6, fullH)
        base.addColorStop(0, '#6b805a')
        base.addColorStop(0.38, '#53785b')
        base.addColorStop(0.72, '#456e56')
        base.addColorStop(1, '#34574a')
        ctx.fillStyle = base
        ctx.fillRect(x0, y0, fullW, fullH)

        // Broad glazes, then small dry-brush marks. All detail is stable per layout.
        for (let i = 0; i < 64; i++) {
            const x = x0 + hash(seed, i) * fullW
            const y = y0 + hash(seed, i + 100) * fullH
            const r = 100 + hash(seed, i + 200) * 220
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
            grad.addColorStop(0, i % 3 === 0 ? 'rgba(196,190,116,0.18)' : 'rgba(22,66,53,0.2)')
            grad.addColorStop(1, 'rgba(67,103,77,0)')
            ctx.fillStyle = grad
            ctx.fillRect(x - r, y - r, r * 2, r * 2)
        }
        for (let i = 0; i < 2400; i++) {
            const x = x0 + hash(seed, i + 400) * fullW
            const y = y0 + hash(seed, i + 3000) * fullH
            const len = 5 + hash(seed, i + 6000) * 24
            ctx.globalAlpha = clearing(x, y)
            ctx.fillStyle = i % 3 === 0 ? 'rgba(190,201,137,0.12)' : i % 3 === 1 ? 'rgba(30,70,53,0.14)' : 'rgba(116,157,112,0.18)'
            ctx.beginPath()
            ctx.moveTo(x - len, y + 2)
            ctx.quadraticCurveTo(x - len * 0.25, y - 4, x + len, y - 1)
            ctx.lineTo(x + len * 0.4, y + 3)
            ctx.closePath()
            ctx.fill()
        }
        ctx.globalAlpha = 1

        // Afternoon light lies below props and water, never across the bridge deck.
        const sun = ctx.createLinearGradient(0, y0, w.w * 0.75, w.h)
        sun.addColorStop(0, 'rgba(255,226,160,0)')
        sun.addColorStop(0.28, 'rgba(255,226,160,0.1)')
        sun.addColorStop(1, 'rgba(255,226,160,0)')
        ctx.fillStyle = sun
        for (let i = 0; i < 5; i++) {
            const x = x0 + 100 + i * 410
            const width = 36 + hash(seed, i + 9000) * 70
            ctx.beginPath()
            ctx.moveTo(x, y0)
            ctx.lineTo(x + width, y0)
            ctx.lineTo(x + 920 + width * 2, w.h + 220)
            ctx.lineTo(x + 920 - width, w.h + 220)
            ctx.closePath()
            ctx.fill()
        }

        // --- Dirt path ---------------------------------------------------
        const path = new Path2D()
        const pts = w.path
        path.moveTo(pts[0]!.x, pts[0]!.y)
        for (let i = 1; i < pts.length - 1; i++) {
            const a = pts[i]!
            const next = pts[i + 1]!
            path.quadraticCurveTo(a.x, a.y, (a.x + next.x) / 2, (a.y + next.y) / 2)
        }
        path.lineTo(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y)
        const drawPath = (width: number, color: string) => {
            ctx.strokeStyle = color
            ctx.lineWidth = width
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.stroke(path)
        }
        drawPath(82, 'rgba(44,66,47,0.22)')
        drawPath(73, '#7c7e59')
        drawPath(62, '#9b9065')
        drawPath(43, '#b2a078')
        drawPath(23, 'rgba(211,188,139,0.24)')
        ctx.lineWidth = 66
        const onPath = (x: number, y: number) => ctx.isPointInStroke(path, (x + w.margin) * TS, (y + w.margin) * TS * YS)
        // Sample the existing curve's bounds, not a second jittered route.
        const pathMinY = Math.min(...pts.map(p => p.y)) - 42
        const pathMaxY = Math.max(...pts.map(p => p.y)) + 42
        for (let i = 0; i < 1500; i++) {
            const x = pts[0]!.x + hash(seed, i + 10000) * (pts[pts.length - 1]!.x - pts[0]!.x)
            const y = lerp(pathMinY, pathMaxY, hash(seed, i + 12000))
            if (!onPath(x, y)) continue
            ctx.fillStyle = i % 4 === 0 ? 'rgba(235,214,167,0.32)' : 'rgba(95,83,57,0.18)'
            ellipse(ctx, x, y, 1 + hash(seed, i + 14000) * 4, 0.6 + hash(seed, i + 16000))
            ctx.fill()
        }

        // Long, soft foliage shadows anchor the existing trees without new obstacles.
        for (const t of w.trees) {
            ctx.fillStyle = 'rgba(23,50,43,0.1)'
            for (let i = 0; i < 4; i++) {
                ellipse(ctx, t.x + (16 + i * 11) * t.scale, t.y + (18 + i * 15) * t.scale, (36 - i * 3) * t.scale, (18 + i * 2) * t.scale)
                ctx.fill()
            }
        }

        // --- Stream banks, pool, stream --------------------------------
        const streamShape = (pad: number) => {
            const shape = new Path2D()
            shape.moveTo(s.x - s.width / 2 - pad + Math.sin(s.top * 0.02) * 8, s.top)
            for (let y = s.top + 20; y < s.bottom; y += 20) shape.lineTo(s.x - s.width / 2 - pad + Math.sin(y * 0.02) * 8, y)
            shape.lineTo(s.x - s.width / 2 - pad + Math.sin(s.bottom * 0.02) * 8, s.bottom)
            shape.lineTo(s.x + s.width / 2 + pad + Math.cos(s.bottom * 0.017) * 8, s.bottom)
            for (let y = s.bottom - 20; y > s.top; y -= 20) shape.lineTo(s.x + s.width / 2 + pad + Math.cos(y * 0.017) * 8, y)
            shape.lineTo(s.x + s.width / 2 + pad + Math.cos(s.top * 0.017) * 8, s.top)
            shape.closePath()
            return shape
        }
        for (const [pad, color] of [[26, '#3b594a'], [20, '#777b58'], [11, '#a39b70'], [4, '#4d7560']] as const) {
            ctx.fillStyle = color
            ctx.fill(streamShape(pad))
            ellipse(ctx, w.pool.x, w.pool.y, w.pool.r + pad, w.pool.r * 0.9 + pad * 0.7)
            ctx.fill()
        }
        const waterShape = streamShape(0)
        waterShape.moveTo(w.pool.x + w.pool.r, w.pool.y)
        waterShape.ellipse(w.pool.x, w.pool.y, w.pool.r, w.pool.r * 0.9, 0, 0, Math.PI * 2, true)
        const water = ctx.createLinearGradient(s.x - s.width / 2, 0, s.x + s.width / 2, 0)
        water.addColorStop(0, '#497f73')
        water.addColorStop(0.25, '#2c6967')
        water.addColorStop(0.58, '#214f57')
        water.addColorStop(1, '#609580')
        ctx.fillStyle = water
        ctx.fill(waterShape)
        const pool = ctx.createRadialGradient(w.pool.x, w.pool.y, 10, w.pool.x, w.pool.y, w.pool.r)
        pool.addColorStop(0, '#568f86')
        pool.addColorStop(0.48, '#2b6569')
        pool.addColorStop(0.85, '#244e55')
        pool.addColorStop(1, '#64907b')
        ctx.fillStyle = pool
        ellipse(ctx, w.pool.x, w.pool.y, w.pool.r, w.pool.r * 0.9)
        ctx.fill()

        ctx.save()
        ctx.clip(waterShape)
        for (let i = 0; i < 180; i++) {
            const y = s.top + hash(seed, i + 18000) * (s.bottom - s.top)
            const x = s.x + (hash(seed, i + 18200) - 0.5) * s.width
            if (onBridge(x, y, 12)) continue
            ctx.fillStyle = i % 3 === 0 ? 'rgba(178,203,149,0.18)' : 'rgba(16,55,60,0.22)'
            ellipse(ctx, x, y, 2 + hash(seed, i + 18400) * 7, 1.5)
            ctx.fill()
        }
        ctx.lineWidth = 1.4
        for (let y = s.top + 14; y < s.bottom - 8; y += 24) {
            if (onBridge(s.x, y, 18)) continue
            const x = s.x + Math.sin(y * 0.029) * 16
            ctx.strokeStyle = 'rgba(168,210,187,0.2)'
            ctx.beginPath()
            ctx.moveTo(x - 15, y)
            ctx.quadraticCurveTo(x, y + 3, x + 12, y - 2)
            ctx.stroke()
        }
        ctx.restore()

        // --- Bridge (ground part: shadow on water) -----------------------
        ctx.fillStyle = 'rgba(15,38,39,0.4)'
        ctx.fillRect(b.x0 - 4, b.y - b.width / 2 + 12, b.x1 - b.x0 + 12, b.width)

        // Reeds follow the shore, with a generous clear approach to the bridge.
        ctx.lineCap = 'round'
        for (let i = 0; i < 80; i++) {
            const y = s.top + 45 + hash(seed, i + 19000) * (s.bottom - s.top - 60)
            const side = i % 2 === 0 ? -1 : 1
            const x = s.x + side * (s.width / 2 + 14) + (side < 0 ? Math.sin(y * 0.02) : Math.cos(y * 0.017)) * 8
            if (onBridge(x, y, 34)) continue
            for (let j = 0; j < 3; j++) {
                const h = 12 + hash(seed + i, j) * 16
                const lean = (j - 1) * 6 + side * 3
                ctx.strokeStyle = j === 0 ? '#9cac75' : '#416c51'
                ctx.lineWidth = 1.5
                ctx.beginPath()
                ctx.moveTo(x + j * 2, y)
                ctx.quadraticCurveTo(x + lean * 0.4, y - h * 0.65, x + lean, y - h)
                ctx.stroke()
                if (j === 1 && i % 3 === 0) {
                    ctx.strokeStyle = '#85734c'
                    ctx.lineWidth = 3
                    ctx.beginPath()
                    ctx.moveTo(x + lean, y - h)
                    ctx.lineTo(x + lean - 1, y - h - 5)
                    ctx.stroke()
                }
            }
        }

        // --- Ground clutter ---------------------------------------------
        ctx.lineWidth = 74
        for (let i = 0; i < w.leaves.length; i++) {
            const leaf = w.leaves[i]!
            if (!dryGround(leaf.x, leaf.y, 5)) continue
            ctx.save()
            ctx.translate(leaf.x, leaf.y)
            ctx.rotate(hash(seed, i + 20000) * Math.PI * 2)
            ctx.fillStyle = i % 3 === 0 ? '#c8a05b' : i % 3 === 1 ? '#ae7448' : '#875846'
            ctx.beginPath()
            ctx.moveTo(-4, 0)
            ctx.quadraticCurveTo(-1, -4, 5, 0)
            ctx.quadraticCurveTo(1, 3, -4, 0)
            ctx.fill()
            ctx.strokeStyle = 'rgba(243,208,136,0.4)'
            ctx.lineWidth = 0.7
            ctx.beginPath()
            ctx.moveTo(-4, 0)
            ctx.lineTo(3, 0)
            ctx.stroke()
            ctx.restore()
        }
        for (const t of w.tufts) {
            ctx.lineWidth = 74
            if (!dryGround(t.x, t.y, 12) || onPath(t.x, t.y) || hash(t.seed, 20) > clearing(t.x, t.y)) continue
            const fern = hash(t.seed, 1) < 0.18 && clearing(t.x, t.y) > 0.8
            ctx.strokeStyle = fern ? '#90a873' : hash(t.seed, 2) < 0.5 ? 'rgba(36,76,53,0.6)' : 'rgba(164,188,124,0.5)'
            ctx.lineWidth = fern ? 1.25 : 1.1
            ctx.lineCap = 'round'
            for (let i = 0; i < 3; i++) {
                const dx = (i - 1) * (fern ? 11 : 5)
                const len = (fern ? 16 : 6) + hash(t.seed, i + 9) * 7
                ctx.beginPath()
                ctx.moveTo(t.x, t.y)
                ctx.quadraticCurveTo(t.x + dx * 0.4, t.y - len * 0.8, t.x + dx, t.y - len)
                if (fern) {
                    for (let j = 1; j < 5; j++) {
                        const k = j / 5
                        const fx = t.x + dx * k * k
                        const fy = t.y - len * k
                        const span = 4 * (1 - k) + 1
                        ctx.moveTo(fx - span, fy - 3)
                        ctx.lineTo(fx, fy)
                        ctx.lineTo(fx + span, fy - 3)
                    }
                }
                ctx.stroke()
            }
        }
        for (const f of w.flowers) {
            ctx.lineWidth = 74
            if (!dryGround(f.x, f.y, 8) || onPath(f.x, f.y)) continue
            const size = f.size * (0.65 + clearing(f.x, f.y) * 0.25)
            ctx.strokeStyle = '#3c6249'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(f.x + 1, f.y + 5)
            ctx.lineTo(f.x, f.y)
            ctx.stroke()
            ctx.fillStyle = 'rgba(30,58,44,0.35)'
            ellipse(ctx, f.x + 2, f.y + 4, size + 1, size * 0.6)
            ctx.fill()
            ctx.fillStyle = hash(f.x, f.y) < 0.84 ? '#f0e5bf' : '#d7ba85'
            ctx.beginPath()
            for (let i = 0; i < 5; i++) {
                const a = i / 5 * Math.PI * 2
                const px = f.x + Math.cos(a) * size * 0.7
                const py = f.y + Math.sin(a) * size * 0.7
                ctx.moveTo(px + size * 0.55, py)
                ctx.ellipse(px, py, size * 0.55, size * 0.48, a, 0, Math.PI * 2)
            }
            ctx.fill()
            ctx.fillStyle = '#b7994d'
            ellipse(ctx, f.x, f.y, size * 0.32, size * 0.32)
            ctx.fill()
        }
        // Flat grit, not additional cover or collision-looking props.
        for (let i = 0; i < 240; i++) {
            const x = x0 + hash(seed, i + 22000) * fullW
            const y = y0 + hash(seed, i + 22400) * fullH
            if (!dryGround(x, y, 4) || clearing(x, y) < 0.8) continue
            ctx.fillStyle = i % 2 === 0 ? 'rgba(195,193,155,0.4)' : 'rgba(37,66,53,0.3)'
            ellipse(ctx, x, y, 1.2 + hash(seed, i + 22800), 0.8)
            ctx.fill()
        }

        // --- Upright props -----------------------------------------------
        upright(ctx)
        this.paintCliff(ctx, w)
        this.paintWaterfallBase(ctx, w)
        for (const r of w.rocks) {
            if (!onBridge(r.x, r.y, r.r + 12)) this.paintRock(ctx, r.x, r.y * YS, r.r, r.seed)
        }
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

        // A restrained warm glaze preserves the jade shadows and cream flowers.
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'overlay'
        const warm = ctx.createRadialGradient(tw * 0.3, th * 0.2, 0, tw * 0.3, th * 0.2, tw * 0.9)
        warm.addColorStop(0, 'rgba(245,210,151,0.18)')
        warm.addColorStop(1, 'rgba(37,57,69,0.12)')
        ctx.fillStyle = warm
        ctx.fillRect(0, 0, tw, th)
        ctx.globalCompositeOperation = 'source-over'
    }

    private paintCliff(ctx: Ctx, w: WorldLayout) {
        const c = w.cliff
        const top = c.y0 * YS
        const bottom = c.y1 * YS
        const faceTop = bottom - 120
        const seed = c.x1 + c.y1
        ctx.save()
        ctx.fillStyle = '#526b50'
        ctx.fillRect(c.x0, top, c.x1 - c.x0, faceTop - top)
        for (let i = 0; i < 60; i++) {
            ctx.fillStyle = i % 3 === 0 ? 'rgba(174,181,112,0.25)' : 'rgba(28,69,52,0.2)'
            ellipse(ctx, lerp(c.x0, c.x1, hash(seed, i)), lerp(top, faceTop, hash(seed, i + 80)), 10 + hash(seed, i + 160) * 28, 3 + hash(seed, i + 240) * 5)
            ctx.fill()
        }
        const outline = new Path2D()
        outline.moveTo(c.x0, faceTop)
        for (let x = c.x0; x < c.x1; x += 36) outline.lineTo(x, faceTop + Math.sin(x * 0.05) * 7)
        outline.lineTo(c.x1, faceTop + 2)
        outline.lineTo(c.x1 + 30, faceTop + 40)
        outline.lineTo(c.x1 + 10, bottom + 8)
        outline.lineTo(c.x0, bottom + 8)
        outline.closePath()
        const face = ctx.createLinearGradient(0, faceTop, 0, bottom)
        face.addColorStop(0, '#869087')
        face.addColorStop(0.35, '#63716d')
        face.addColorStop(1, '#354d4c')
        ctx.fillStyle = face
        ctx.fill(outline)
        ctx.save()
        ctx.clip(outline)
        // Broad broken shelves, with thin sunlit edges rather than a stone grid.
        for (let row = 0; row < 5; row++) {
            const y = faceTop + row * 25
            for (let x = c.x0 - row * 19; x < c.x1 + 30; x += 88) {
                const k = hash(seed + row, x)
                const ledge = y + k * 12
                ctx.fillStyle = row % 2 === 0 ? '#718079' : '#5c6d68'
                ctx.beginPath()
                ctx.moveTo(x, ledge)
                ctx.lineTo(x + 27, ledge - 5)
                ctx.lineTo(x + 94, ledge - 1)
                ctx.lineTo(x + 76, ledge + 14)
                ctx.lineTo(x + 16, ledge + 19)
                ctx.closePath()
                ctx.fill()
                ctx.strokeStyle = 'rgba(202,204,174,0.4)'
                ctx.lineWidth = 1.4
                ctx.beginPath()
                ctx.moveTo(x + 3, ledge)
                ctx.lineTo(x + 28, ledge - 4)
                ctx.lineTo(x + 85, ledge)
                ctx.stroke()
                ctx.strokeStyle = 'rgba(27,46,47,0.55)'
                ctx.lineWidth = 1.8
                ctx.beginPath()
                ctx.moveTo(x + 76, ledge + 14)
                ctx.lineTo(x + 52, ledge + 18)
                ctx.lineTo(x + 12, ledge + 19)
                if (k > 0.45) {
                    ctx.moveTo(x + 60, ledge + 2)
                    ctx.lineTo(x + 49, ledge + 10)
                    ctx.lineTo(x + 54, ledge + 17)
                    ctx.lineTo(x + 42, ledge + 27)
                }
                ctx.stroke()
            }
        }
        // Moss follows the rim and fractures; a few tendrils trail down the face.
        for (let i = 0; i < 48; i++) {
            const x = lerp(c.x0, c.x1, hash(seed, i + 400))
            const y = faceTop + Math.sin(x * 0.05) * 7
            const length = 7 + hash(seed, i + 480) * 30
            ctx.fillStyle = i % 2 === 0 ? '#71885a' : '#8c9a65'
            ctx.beginPath()
            ctx.moveTo(x - 13, y - 5)
            ctx.lineTo(x + 17, y - 3)
            ctx.lineTo(x + 12, y + 5)
            ctx.lineTo(x + 3, y + length)
            ctx.lineTo(x - 1, y + 10)
            ctx.lineTo(x - 10, y + 7)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = '#a8b17c'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(x - 10, y)
            ctx.lineTo(x + 7, y + 1)
            ctx.stroke()
        }
        ctx.restore()
        const sh = ctx.createLinearGradient(0, bottom, 0, bottom + 60)
        sh.addColorStop(0, 'rgba(20,43,38,0.4)')
        sh.addColorStop(1, 'rgba(20,43,38,0)')
        ctx.fillStyle = sh
        ctx.fillRect(c.x0, bottom, c.x1 - c.x0 + 30, 60)
        ctx.restore()
    }

    private paintWaterfallBase(ctx: Ctx, w: WorldLayout) {
        const f = w.waterfall
        const top = w.cliff.y1 * YS - 120
        const bottom = w.pool.y * YS - 10
        const left = f.x - f.width / 2
        ctx.save()
        ctx.fillStyle = '#284f51'
        ctx.beginPath()
        ctx.moveTo(left - 5, top + 1)
        ctx.lineTo(left + f.width + 5, top + 1)
        ctx.lineTo(left + f.width + 9, bottom)
        ctx.lineTo(left - 9, bottom)
        ctx.closePath()
        ctx.fill()
        const grad = ctx.createLinearGradient(left, top, left + f.width, bottom)
        grad.addColorStop(0, '#b1d7c6')
        grad.addColorStop(0.28, '#6dada9')
        grad.addColorStop(0.66, '#a3d0c4')
        grad.addColorStop(1, '#e0e9d3')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(left, top)
        ctx.lineTo(left + f.width, top)
        ctx.bezierCurveTo(left + f.width - 5, top + 30, left + f.width - 2, bottom - 32, left + f.width + 6, bottom)
        ctx.lineTo(left - 6, bottom)
        ctx.bezierCurveTo(left + 3, bottom - 30, left + 5, top + 30, left, top)
        ctx.fill()
        ctx.lineCap = 'round'
        for (let i = 0; i < 8; i++) {
            const x = left + 3 + i * (f.width - 6) / 8
            ctx.strokeStyle = i % 3 === 0 ? 'rgba(40,98,104,0.4)' : 'rgba(236,246,222,0.5)'
            ctx.lineWidth = i % 3 === 0 ? 3 : 1.8
            ctx.beginPath()
            ctx.moveTo(x, top + 4)
            ctx.bezierCurveTo(x + 3, top + 35, x - 3, bottom - 35, x + (i - 3.5) * 1.3, bottom - 4)
            ctx.stroke()
        }
        ctx.strokeStyle = '#d7e5cb'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(left - 2, top + 1)
        ctx.quadraticCurveTo(f.x, top - 5, left + f.width + 2, top + 1)
        ctx.stroke()
        ctx.fillStyle = 'rgba(221,236,213,0.66)'
        for (let i = 0; i < 10; i++) {
            ellipse(ctx, f.x + (hash(f.x, i) - 0.5) * (f.width + 18), bottom + hash(f.x, i + 12) * 12, 5 + hash(f.x, i + 24) * 9, 2 + hash(f.x, i + 36) * 3)
            ctx.fill()
        }
        const mist = ctx.createRadialGradient(f.x, bottom, 4, f.x, bottom, 58)
        mist.addColorStop(0, 'rgba(228,242,216,0.35)')
        mist.addColorStop(1, 'rgba(228,242,216,0)')
        ctx.fillStyle = mist
        ctx.fillRect(f.x - 60, bottom - 45, 120, 80)
        ctx.restore()
    }

    private paintRock(ctx: Ctx, x: number, y: number, r: number, seed: number) {
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(r, r)
        ctx.fillStyle = 'rgba(19,41,38,0.28)'
        ellipse(ctx, 0.2, 0.35, 1.1, 0.38)
        ctx.fill()
        const peak = -0.6 - hash(seed, 1) * 0.2
        ctx.fillStyle = '#556866'
        ctx.beginPath()
        ctx.moveTo(-1, 0.15)
        ctx.lineTo(-0.63, peak + 0.2)
        ctx.lineTo(0.2, peak)
        ctx.lineTo(0.9, -0.2)
        ctx.lineTo(1, 0.35)
        ctx.lineTo(0.35, 0.65)
        ctx.lineTo(-0.7, 0.5)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = hash(seed, 2) > 0.5 ? '#9b9f88' : '#8a988c'
        ctx.beginPath()
        ctx.moveTo(-1, 0.15)
        ctx.lineTo(-0.63, peak + 0.2)
        ctx.lineTo(0.2, peak)
        ctx.lineTo(0.65, -0.23)
        ctx.lineTo(-0.2, 0.06)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#3e5354'
        ctx.beginPath()
        ctx.moveTo(0.65, -0.23)
        ctx.lineTo(0.9, -0.2)
        ctx.lineTo(1, 0.35)
        ctx.lineTo(0.35, 0.65)
        ctx.lineTo(0.15, 0.18)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = '#b9bba0'
        ctx.lineWidth = 0.08
        ctx.beginPath()
        ctx.moveTo(-0.8, -0.06)
        ctx.lineTo(-0.2, 0.06)
        ctx.lineTo(0.6, -0.22)
        ctx.stroke()
        if (hash(seed, 3) > 0.4) {
            ctx.fillStyle = '#7d9366'
            ctx.beginPath()
            ctx.moveTo(-0.7, -0.38)
            ctx.lineTo(-0.1, peak + 0.08)
            ctx.lineTo(0.25, peak + 0.18)
            ctx.lineTo(0.02, -0.26)
            ctx.lineTo(-0.32, -0.19)
            ctx.closePath()
            ctx.fill()
        }
        ctx.restore()
    }

    private paintBoulder(ctx: Ctx, x: number, y: number, r: number, seed: number) {
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(r, r)
        ctx.fillStyle = 'rgba(19,39,36,0.3)'
        ellipse(ctx, 0.22, 0.15, 1.15, YS * 0.8)
        ctx.fill()
        const peak = -1.08 - hash(seed, 1) * 0.24
        const crown = -0.24 + hash(seed, 2) * 0.35
        const outline = new Path2D()
        outline.moveTo(-1.04, -0.05)
        outline.lineTo(-0.87, -0.69)
        outline.lineTo(-0.44, peak + 0.13)
        outline.lineTo(crown + 0.3, peak)
        outline.lineTo(0.84, -0.77)
        outline.lineTo(1.05, -0.2)
        outline.lineTo(0.91, 0.22)
        outline.lineTo(0.21, 0.34)
        outline.lineTo(-0.75, 0.24)
        outline.closePath()
        ctx.fillStyle = '#60716e'
        ctx.fill(outline)
        ctx.save()
        ctx.clip(outline)
        ctx.fillStyle = '#96a08e'
        ctx.beginPath()
        ctx.moveTo(-1.04, -0.05)
        ctx.lineTo(-0.87, -0.69)
        ctx.lineTo(-0.44, peak + 0.13)
        ctx.lineTo(crown + 0.3, peak)
        ctx.lineTo(0.84, -0.77)
        ctx.lineTo(0.31, -0.55)
        ctx.lineTo(-0.3, -0.45)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#425957'
        ctx.beginPath()
        ctx.moveTo(0.31, -0.55)
        ctx.lineTo(0.84, -0.77)
        ctx.lineTo(1.1, -0.2)
        ctx.lineTo(0.9, 0.35)
        ctx.lineTo(0.14, 0.4)
        ctx.lineTo(0.43, -0.13)
        ctx.closePath()
        ctx.fill()
        // Thin strata split the broad faces; only their upper edges catch the sun.
        for (let i = 0; i < 4; i++) {
            const yy = -0.55 + i * 0.25
            ctx.lineWidth = 0.045
            ctx.strokeStyle = '#3c5452'
            ctx.beginPath()
            ctx.moveTo(-1.05, yy + 0.14)
            ctx.lineTo(-0.48, yy + 0.05)
            ctx.lineTo(0.17, yy + 0.1)
            ctx.lineTo(0.8, yy - 0.12)
            ctx.lineTo(1.1, yy - 0.08)
            ctx.stroke()
            ctx.strokeStyle = 'rgba(200,205,172,0.38)'
            ctx.lineWidth = 0.025
            ctx.beginPath()
            ctx.moveTo(-0.95, yy + 0.1)
            ctx.lineTo(-0.48, yy + 0.015)
            ctx.lineTo(0.08, yy + 0.07)
            ctx.stroke()
        }
        ctx.strokeStyle = '#344b4c'
        ctx.lineWidth = 0.045
        ctx.beginPath()
        ctx.moveTo(crown, peak + 0.06)
        ctx.lineTo(crown - 0.18, -0.8)
        ctx.lineTo(crown + 0.02, -0.57)
        ctx.lineTo(crown - 0.1, -0.18)
        ctx.lineTo(crown + 0.08, 0.2)
        ctx.moveTo(crown - 0.18, -0.8)
        ctx.lineTo(crown - 0.43, -0.71)
        ctx.stroke()
        ctx.fillStyle = '#788e5c'
        ctx.beginPath()
        ctx.moveTo(-0.87, -0.71)
        ctx.lineTo(-0.46, peak + 0.13)
        ctx.lineTo(-0.05, peak + 0.16)
        ctx.lineTo(0.17, -0.9)
        ctx.lineTo(-0.09, -0.76)
        ctx.lineTo(-0.28, -0.48)
        ctx.lineTo(-0.37, -0.68)
        ctx.lineTo(-0.65, -0.55)
        ctx.closePath()
        ctx.fill()
        for (let i = 0; i < 22; i++) {
            const px = -0.82 + hash(seed, i + 30) * 0.85
            const py = peak + 0.16 + hash(seed, i + 60) * 0.43
            ctx.fillStyle = i % 3 === 0 ? '#bec18a' : '#97a96d'
            ctx.fillRect(px, py, 0.04 + hash(seed, i + 90) * 0.06, 0.025)
        }
        ctx.restore()
        ctx.strokeStyle = 'rgba(30,48,44,0.65)'
        ctx.lineWidth = 0.035
        ctx.stroke(outline)
        ctx.restore()
    }

    private paintBridge(ctx: Ctx, w: WorldLayout) {
        const b = w.bridge
        const y = b.y * YS
        const hw = b.width * YS / 2
        const posts = [b.x0 + 4, (b.x0 + b.x1) / 2, b.x1 - 4]
        ctx.save()
        // Visible end grain on the deck's front fascia, below the walking surface.
        ctx.fillStyle = '#4d4132'
        ctx.fillRect(b.x0, y - hw, b.x1 - b.x0, hw * 2 + 6)
        ctx.fillStyle = '#745739'
        ctx.fillRect(b.x0, y + hw, b.x1 - b.x0, 4)
        const count = Math.ceil((b.x1 - b.x0) / 13)
        const plankW = (b.x1 - b.x0) / count
        for (let i = 0; i < count; i++) {
            const x = b.x0 + i * plankW
            const wear = hash(b.y, i)
            const inset = 1 + wear * 1.4
            ctx.fillStyle = ['#a88352', '#b5905c', '#99774f'][i % 3]!
            ctx.fillRect(x + 0.8, y - hw + inset, plankW - 1.6, hw * 2 - inset - 1)
            ctx.fillStyle = '#d5b17b'
            ctx.fillRect(x + 1.1, y - hw + inset, 1.2, hw * 2 - inset - 2)
            ctx.fillRect(x + 1.1, y - hw + inset, plankW - 2.2, 1.2)
            ctx.fillStyle = '#6c5136'
            ctx.fillRect(x + plankW - 2, y - hw + inset + 2, 1, hw * 2 - inset - 2)
            ctx.lineWidth = 0.65
            for (let grain = 0; grain < 3; grain++) {
                const gx = x + 3 + grain * 2.4
                ctx.strokeStyle = grain === 1 ? 'rgba(224,190,132,0.45)' : 'rgba(82,58,37,0.32)'
                ctx.beginPath()
                ctx.moveTo(gx, y - hw + 5)
                ctx.bezierCurveTo(gx - 2, y - 10, gx + 2 + wear, y + 6, gx - 0.5, y + hw - 4)
                ctx.stroke()
            }
            if (i % 3 === 1) {
                ctx.strokeStyle = '#795939'
                ctx.lineWidth = 0.8
                ellipse(ctx, x + plankW * 0.5, y + (wear - 0.5) * hw, 1.5, 3.8)
                ctx.stroke()
            }
            // Small forged nail heads, with a single warm glint.
            for (const py of [y - hw + 6, y + hw - 5]) {
                ctx.fillStyle = '#3d4944'
                ellipse(ctx, x + plankW * 0.5, py, 1.5, 1.2)
                ctx.fill()
                ctx.fillStyle = '#b0b49b'
                ctx.fillRect(x + plankW * 0.5 - 0.7, py - 0.7, 1, 0.7)
            }
        }
        ctx.lineCap = 'round'
        for (const edge of [y - hw, y + hw]) {
            // Slack doubled rope reads as a rail, not a solid wall across the deck.
            for (const offset of [0, 8]) {
                ctx.beginPath()
                ctx.moveTo(posts[0]!, edge - 21 + offset)
                for (let i = 1; i < posts.length; i++) {
                    ctx.quadraticCurveTo((posts[i - 1]! + posts[i]!) / 2, edge - 8 + offset, posts[i]!, edge - 21 + offset)
                }
                ctx.strokeStyle = '#554a34'
                ctx.lineWidth = 3.5
                ctx.stroke()
                ctx.strokeStyle = '#c4b17e'
                ctx.lineWidth = 1.7
                ctx.stroke()
                ctx.setLineDash([1, 4])
                ctx.strokeStyle = '#f0d69d'
                ctx.lineWidth = 1
                ctx.stroke()
                ctx.setLineDash([])
            }
            for (const px of posts) {
                ctx.fillStyle = '#655036'
                ctx.fillRect(px - 3.5, edge - 27, 7, 29)
                ctx.fillStyle = '#b1915d'
                ctx.fillRect(px - 3.5, edge - 27, 2.5, 28)
                ctx.fillStyle = '#dcc090'
                ctx.beginPath()
                ctx.moveTo(px - 3.5, edge - 27)
                ctx.lineTo(px, edge - 29)
                ctx.lineTo(px + 3.5, edge - 27)
                ctx.lineTo(px, edge - 25)
                ctx.closePath()
                ctx.fill()
                ctx.fillStyle = '#424c42'
                ctx.fillRect(px - 3.5, edge - 8, 7, 3)
                ctx.strokeStyle = '#dbbf88'
                ctx.lineWidth = 1.2
                ctx.beginPath()
                ctx.moveTo(px - 4, edge - 20)
                ctx.lineTo(px + 4, edge - 18)
                ctx.moveTo(px - 4, edge - 17)
                ctx.lineTo(px + 4, edge - 15)
                ctx.stroke()
            }
        }
        ctx.restore()
    }

    private paintTrunk(ctx: Ctx, t: TreeDeco) {
        ctx.save()
        ctx.translate(t.x, t.y * YS)
        ctx.scale(t.scale, t.scale)
        const bend = (hash(t.seed, 100) - 0.5) * 9
        ctx.fillStyle = 'rgba(19,36,30,0.3)'
        ellipse(ctx, 4, 3, 23, 7)
        ctx.fill()
        // Tapered forks belong to the same trunk and stay inside the crown footprint.
        ctx.fillStyle = '#574535'
        ctx.beginPath()
        ctx.moveTo(-6, -34)
        ctx.quadraticCurveTo(-22, -45, -28, -65)
        ctx.lineTo(-24, -64)
        ctx.quadraticCurveTo(-17, -52, bend - 2, -49)
        ctx.lineTo(bend + 1, -72)
        ctx.lineTo(bend + 7, -73)
        ctx.lineTo(6, -47)
        ctx.quadraticCurveTo(20, -54, 26, -68)
        ctx.lineTo(29, -66)
        ctx.quadraticCurveTo(23, -44, 7, -35)
        ctx.closePath()
        ctx.fill()
        const trunk = new Path2D()
        trunk.moveTo(-19, 4)
        trunk.quadraticCurveTo(-7, -5, -8, -24)
        trunk.quadraticCurveTo(-13, -43, bend - 5, -65)
        trunk.lineTo(bend + 5, -65)
        trunk.quadraticCurveTo(2, -44, 7, -27)
        trunk.quadraticCurveTo(5, -7, 19, 4)
        trunk.lineTo(9, 3)
        trunk.lineTo(3, -2)
        trunk.lineTo(1, 7)
        trunk.lineTo(-5, 4)
        trunk.lineTo(-8, 1)
        trunk.closePath()
        ctx.fillStyle = '#80603e'
        ctx.fill(trunk)
        ctx.save()
        ctx.clip(trunk)
        ctx.fillStyle = '#a27d50'
        ctx.beginPath()
        ctx.moveTo(-19, 4)
        ctx.quadraticCurveTo(-2, -18, -6, -33)
        ctx.lineTo(bend - 3, -65)
        ctx.lineTo(bend, -65)
        ctx.quadraticCurveTo(-1, -31, -2, -10)
        ctx.lineTo(-9, 4)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#4d4032'
        ctx.beginPath()
        ctx.moveTo(3, 7)
        ctx.quadraticCurveTo(-2, -11, 3, -29)
        ctx.quadraticCurveTo(-1, -47, bend + 3, -65)
        ctx.lineTo(14, -65)
        ctx.lineTo(20, 7)
        ctx.closePath()
        ctx.fill()
        for (let i = 0; i < 8; i++) {
            const x = -10 + i * 2.6
            const start = -7 - hash(t.seed, i + 110) * 14
            ctx.strokeStyle = i % 3 === 0 ? '#bc9360' : '#594430'
            ctx.lineWidth = i % 3 === 0 ? 0.8 : 1.2
            ctx.beginPath()
            ctx.moveTo(x * 1.5, 3)
            ctx.bezierCurveTo(x - 3, start, x + 3, -35, x + bend * 0.5, -62)
            ctx.stroke()
        }
        ctx.strokeStyle = '#493c2f'
        ctx.lineWidth = 1.4
        ellipse(ctx, -2, -29, 2.7, 5)
        ctx.stroke()
        ctx.strokeStyle = '#b18a56'
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(-3, -35)
        ctx.quadraticCurveTo(-9, -29, -3, -22)
        ctx.stroke()
        ctx.restore()
        // Roots taper into the ground; no enlarged solid trunk footprint.
        ctx.strokeStyle = '#9a7d50'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(-5, -9)
        ctx.quadraticCurveTo(-9, 1, -18, 4)
        ctx.moveTo(5, -6)
        ctx.quadraticCurveTo(8, 0, 16, 3)
        ctx.stroke()
        ctx.fillStyle = '#718153'
        ellipse(ctx, -9, 1, 5, 1.8)
        ctx.fill()
        ctx.restore()
    }

    paintCanopy(ctx: Ctx, t: TreeDeco, alpha: number) {
        const pal = TREE_PALETTES[t.palette]!
        ctx.save()
        ctx.translate(t.x, t.y * YS - 74 * t.scale)
        ctx.scale(t.scale, t.scale)
        ctx.globalAlpha *= alpha
        // Eight interlocking leaf masses, no circle outlines or live gradients.
        // Fixed cluster/leaf counts keep the three fading inner crowns inexpensive.
        const clusters = [[20, 18, 28], [-12, 23, 29], [32, -2, 25], [-32, 2, 25], [8, -21, 29], [-20, -19, 29], [1, 3, 30], [-15, -7, 24]]
        for (let i = 0; i < clusters.length; i++) {
            const cluster = clusters[i]!
            const bx = cluster[0]! + (hash(t.seed, i) - 0.5) * 7
            const by = cluster[1]! + (hash(t.seed, i + 10) - 0.5) * 6
            const r = cluster[2]! * (0.92 + hash(t.seed, i + 20) * 0.14)
            const lit = i >= 4
            ctx.fillStyle = pal[i < 3 ? 3 : lit ? 1 : 0]!
            ctx.beginPath()
            for (let j = 0; j < 12; j++) {
                const a = j / 12 * Math.PI * 2
                const next = a + Math.PI / 6
                const edge = r * (0.82 + hash(t.seed + i, j + 40) * 0.18)
                const px = bx + Math.cos(a) * edge
                const py = by + Math.sin(a) * edge * 0.78
                if (j === 0) ctx.moveTo(px, py)
                else ctx.lineTo(px, py)
                ctx.quadraticCurveTo(bx + Math.cos(a + 0.2) * r * 1.08, by + Math.sin(a + 0.2) * r * 0.84, bx + Math.cos(next - 0.08) * edge, by + Math.sin(next - 0.08) * edge * 0.78)
            }
            ctx.closePath()
            ctx.fill()

            // A broad crescent breaks up each mass, lit consistently from upper left.
            ctx.fillStyle = pal[lit ? 2 : 0]!
            ctx.beginPath()
            ctx.moveTo(bx - r * 0.84, by - r * 0.14)
            ctx.quadraticCurveTo(bx - r * 0.64, by - r * 0.81, bx + r * 0.13, by - r * 0.66)
            ctx.lineTo(bx + r * 0.45, by - r * 0.4)
            ctx.lineTo(bx + r * 0.04, by - r * 0.44)
            ctx.lineTo(bx - r * 0.16, by - r * 0.23)
            ctx.lineTo(bx - r * 0.48, by - r * 0.29)
            ctx.lineTo(bx - r * 0.62, by + r * 0.02)
            ctx.closePath()
            ctx.fill()

            // Pointed paired leaves, batched into two fills per cluster.
            for (let tone = 0; tone < 2; tone++) {
                ctx.fillStyle = pal[tone === 0 ? (lit ? 0 : 1) : (lit ? 2 : 0)]!
                ctx.beginPath()
                for (let j = 0; j < 5; j++) {
                    const k = i * 20 + tone * 5 + j
                    const lx = bx + (hash(t.seed, k + 200) - 0.5) * r * 1.55
                    const ly = by + (hash(t.seed, k + 400) - 0.5) * r * 1.05
                    const length = 3 + hash(t.seed, k + 600) * 4
                    const tilt = (hash(t.seed, k + 800) - 0.5) * 5
                    ctx.moveTo(lx - length, ly + tilt)
                    ctx.quadraticCurveTo(lx - 1, ly - 4, lx + length, ly - tilt)
                    ctx.quadraticCurveTo(lx + 1, ly + 3, lx - length, ly + tilt)
                    ctx.closePath()
                }
                ctx.fill()
            }
        }
        ctx.restore()
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
        const b = w.bridge
        ctx.save()
        ctx.translate(ox, oy)
        // Water is drawn above the baked deck. Exclude posts and both rope rails too.
        ctx.beginPath()
        ctx.rect(-w.margin, -w.margin * YS, w.w + w.margin * 2, (w.h + w.margin * 2) * YS)
        ctx.rect(b.x0 - 8, (b.y - b.width / 2) * YS - 32, b.x1 - b.x0 + 16, b.width * YS + 42)
        ctx.clip('evenodd')
        ctx.save()
        // The inset is inside both meandering banks; clip the actual endpoints,
        // not just the loop's starting rows, which move as the flow advances.
        ctx.beginPath()
        ctx.rect(s.x - s.width / 2 + 9, s.top * YS, s.width - 18, (s.bottom - s.top) * YS)
        ctx.clip()
        ctx.lineCap = 'round'
        ctx.lineWidth = 1.1
        const flow = (this.t * 32) % 46
        const yStart = Math.max(s.top, this.camY / YS - 46)
        const yEnd = Math.min(s.bottom, (this.camY + this.cssH / this.scale) / YS + 46)
        for (let y = Math.floor(yStart / 46) * 46 - 46; y < yEnd; y += 46) {
            const yy = y + flow
            const row = Math.floor(y / 46)
            const xx = s.x + Math.sin(yy * 0.029) * 12
            const pulse = 0.12 + Math.sin(this.t * 1.5 + row * 1.7) * 0.04
            ctx.strokeStyle = `rgba(200,228,202,${pulse})`
            ctx.beginPath()
            ctx.moveTo(xx - 12, yy * YS)
            ctx.quadraticCurveTo(xx - 2, yy * YS + 2.5, xx + 9, yy * YS - 1)
            ctx.moveTo(xx + 8, yy * YS + 11)
            ctx.quadraticCurveTo(xx + 14, yy * YS + 13, xx + 20, yy * YS + 10)
            ctx.stroke()
        }
        ctx.restore()

        const f = w.waterfall
        const top = w.cliff.y1 * YS - 120
        const bottom = w.pool.y * YS - 10
        if (bottom > this.camY - 20 && top < this.camY + this.cssH / this.scale) {
            // Expanding broken ripples stay inside the pool, clear of its banks.
            ctx.save()
            ellipse(ctx, w.pool.x, w.pool.y * YS, w.pool.r - 5, w.pool.r * 0.9 * YS - 4)
            ctx.clip()
            ctx.lineWidth = 1.2
            for (let i = 0; i < 3; i++) {
                const phase = (this.t * 0.32 + i / 3) % 1
                const r = 18 + phase * 55
                ctx.strokeStyle = `rgba(209,231,206,${(1 - phase) * 0.28})`
                ctx.beginPath()
                ctx.ellipse(f.x, bottom + 8, r, r * 0.36, 0, 0.12, Math.PI - 0.16)
                ctx.stroke()
            }
            ctx.restore()

            const left = f.x - f.width / 2
            ctx.save()
            ctx.beginPath()
            ctx.moveTo(left, top)
            ctx.lineTo(left + f.width, top)
            ctx.bezierCurveTo(left + f.width - 5, top + 30, left + f.width - 2, bottom - 32, left + f.width + 6, bottom)
            ctx.lineTo(left - 6, bottom)
            ctx.bezierCurveTo(left + 3, bottom - 30, left + 5, top + 30, left, top)
            ctx.closePath()
            ctx.clip()
            ctx.fillStyle = 'rgba(234,247,222,0.34)'
            ctx.beginPath()
            for (let i = 0; i < 5; i++) {
                const x = left + 5 + i * (f.width - 10) / 5
                const off = (this.t * 170 + i * 37) % 64
                for (let y = top - 64 + off; y < bottom; y += 64) {
                    ctx.rect(x + Math.sin(y * 0.035 + i), y, 1.4 + i % 2, 17 + i * 2)
                }
            }
            ctx.fill()
            ctx.restore()
            ctx.fillStyle = 'rgba(228,241,217,0.4)'
            for (let i = 0; i < 8; i++) {
                const phase = (this.t * 0.7 + hash(f.x, i)) % 1
                const x = f.x + (hash(f.x, i + 12) - 0.5) * f.width
                ellipse(ctx, x, bottom + 4 - Math.sin(phase * Math.PI) * 8, 2 + phase * 3, 1.2)
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

        // Companion ground effects: burning trail, the ward's ring underfoot.
        const c = g.companion
        if (c) {
            for (const t of c.trails) drawFireTrail(ctx, t.x, t.y, t.r, t.life / t.maxLife, this.t)
            if (c.ward) {
                ctx.save()
                ctx.globalAlpha = 0.45 + Math.sin(this.t * 5) * 0.15
                ctx.strokeStyle = '#b8f0a0'
                ctx.lineWidth = 2
                ctx.setLineDash([6, 5])
                ctx.lineDashOffset = -this.t * 30
                ctx.beginPath()
                ctx.arc(p.x, p.y, p.r + 12, 0, Math.PI * 2)
                ctx.stroke()
                ctx.restore()
            }
        }
        // Coins on the ground get a warm pool of light so they read on grass.
        if (g.coinDrops.length) {
            ctx.save()
            ctx.globalCompositeOperation = 'lighter'
            for (const coin of g.coinDrops) {
                if (coin.z > 4) continue
                const blink = coin.life < 5 && Math.sin(coin.life * 14) < 0
                if (blink) continue
                ctx.globalAlpha = 0.14
                ctx.fillStyle = '#ffd166'
                ctx.beginPath()
                ctx.arc(coin.x, coin.y, coin.size * 2.6, 0, Math.PI * 2)
                ctx.fill()
            }
            ctx.restore()
        }

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
        const c = g.companion
        if (c) {
            items.push({ y: c.y, draw: () => {
                const s = proj(c.x, c.y)
                drawCompanion(ctx, c, s.x, s.y, this.t)
            } })
            const f = c.feather
            if (f) {
                items.push({ y: f.y, draw: () => {
                    const s = proj(f.x, f.y)
                    drawFeather(ctx, s.x, s.y, f.z, this.t, f.taken, f.life)
                } })
            }
        }
        for (const coin of g.coinDrops) {
            if (coin.life < 5 && Math.sin(coin.life * 14) < 0) continue
            items.push({ y: coin.y, draw: () => {
                const s = proj(coin.x, coin.y)
                drawCoin(ctx, coin, s.x, s.y, this.t)
            } })
        }
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

        drawHeroBody(ctx, p, bob, this.t, hurt, outline)

        // Weapon arm + weapon.
        const wp = this.weaponPose(p)
        const ax = Math.cos(wp.angle)
        const ay = Math.sin(wp.angle) * YS
        const shoulderX = ax * 8
        const shoulderY = -27 - bob
        const handX = shoulderX + ax * 12 * wp.ext
        const handY = shoulderY + ay * 12 * wp.ext + 6
        const elbowX = shoulderX + (handX - shoulderX) * 0.5
        const elbowY = shoulderY + (handY - shoulderY) * 0.65 + 2
        ctx.strokeStyle = outline
        ctx.lineWidth = 6
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(shoulderX, shoulderY)
        ctx.lineTo(elbowX, elbowY)
        ctx.lineTo(handX, handY)
        ctx.stroke()
        ctx.strokeStyle = hurt ? '#ffd6d6' : '#617b9d'
        ctx.lineWidth = 4
        ctx.stroke()
        ctx.strokeStyle = hurt ? '#ffffff' : '#bdcdd8'
        ctx.lineWidth = 3.5
        ctx.beginPath()
        ctx.moveTo(elbowX, elbowY)
        ctx.lineTo(handX, handY)
        ctx.stroke()
        ctx.fillStyle = hurt ? '#ffd6d6' : bodyGrad(ctx, '#a9bdce', handX - 3, handY - 3, handX + 3, handY + 3)
        ctx.strokeStyle = outline
        ctx.lineWidth = 1
        ellipse(ctx, handX, handY, 3.3, 3)
        ctx.fill()
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
            drawHeroShieldDetails(ctx)
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
        drawHeroWeaponDetails(ctx, id)
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
            case 'ogre': drawBogOgre(ctx, e, dir, bob, this.t, tint, outline); break
            case 'warlord': drawAshenWarlord(ctx, e, dir, bob, this.t, tint, outline); break
            case 'briar': drawBriarMatriarch(ctx, e, dir, bob, this.t, tint, outline); break
            case 'knight': drawHollowKnight(ctx, e, dir, bob, this.t, tint, outline); break
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
        ctx.save()
        ctx.strokeStyle = outline
        ctx.lineCap = 'round'
        ctx.lineWidth = 1.2
        for (const side of [-1, 1]) {
            const foot = side * 4 - side * stride
            ctx.fillStyle = tint(side < 0 ? '#645141' : '#3d3b3b')
            ctx.beginPath()
            ctx.moveTo(side * 4 - 2.5, -12)
            ctx.lineTo(side * 4 + 2.5, -12)
            ctx.lineTo(foot + 2.5, -2)
            ctx.lineTo(foot + dir * 4, 0)
            ctx.lineTo(foot - 3, 0)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        ctx.translate(0, -bob)
        // Split leather skirt and overlapping jerkin, not a solid tunic block.
        ctx.fillStyle = bodyGrad(ctx, tint('#63754b'), -9, -27, 9, -8)
        ctx.beginPath()
        ctx.moveTo(-8, -27)
        ctx.quadraticCurveTo(0, -30, 9, -25)
        ctx.lineTo(7, -17)
        ctx.lineTo(10, -8)
        ctx.lineTo(1, -9)
        ctx.lineTo(-1, -13)
        ctx.lineTo(-3, -8)
        ctx.lineTo(-10, -10)
        ctx.lineTo(-7, -18)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#414e42')
        ctx.beginPath()
        ctx.moveTo(2, -26)
        ctx.lineTo(8, -24)
        ctx.lineTo(6, -17)
        ctx.lineTo(9, -10)
        ctx.lineTo(2, -11)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = tint('#93603b')
        ctx.beginPath()
        ctx.moveTo(-9, -26)
        ctx.lineTo(-5, -28)
        ctx.lineTo(7, -15)
        ctx.lineTo(4, -13)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#493a32')
        ctx.fillRect(-8, -16, 16, 3)
        ctx.fillStyle = tint('#d7ad67')
        ctx.fillRect(1, -16, 3, 3)
        ctx.fillStyle = tint('#815231')
        ctx.beginPath()
        ctx.roundRect(-10, -18, 5, 7, 1.5)
        ctx.fill()
        ctx.stroke()
        // Hooked hood, warm sewn patch and a cool recessed face opening.
        ctx.fillStyle = bodyGrad(ctx, tint('#98633e'), -9, -45, 10, -26)
        ctx.beginPath()
        ctx.moveTo(-10, -25)
        ctx.lineTo(-9, -37)
        ctx.quadraticCurveTo(-8, -44, -dir * 4, -47)
        ctx.lineTo(dir * 5, -44)
        ctx.quadraticCurveTo(9, -38, 10, -26)
        ctx.lineTo(4, -23)
        ctx.lineTo(-3, -26)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#c19459')
        ctx.beginPath()
        ctx.moveTo(-7, -39)
        ctx.lineTo(-3, -42)
        ctx.lineTo(0, -38)
        ctx.lineTo(-5, -35)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = tint('#5e4234')
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(-7, -38)
        ctx.lineTo(-4, -37)
        ctx.moveTo(-3, -41)
        ctx.lineTo(-2, -38)
        ctx.stroke()
        ctx.strokeStyle = outline
        ctx.lineWidth = 1.2
        ctx.fillStyle = '#292d2d'
        ctx.beginPath()
        ctx.moveTo(dir * 1.5, -39)
        ctx.quadraticCurveTo(dir * 1.5 + 7, -35, dir * 1.5 + 6, -29)
        ctx.lineTo(dir * 1.5 - 6, -29)
        ctx.quadraticCurveTo(dir * 1.5 - 7, -36, dir * 1.5, -39)
        ctx.fill()
        ctx.fillStyle = tint('#d9ac82')
        ellipse(ctx, dir * 1.5, -33, 5, 3.8)
        ctx.fill()
        ctx.fillStyle = tint('#a94835')
        ctx.beginPath()
        ctx.moveTo(dir * 1.5 - 6, -32)
        ctx.lineTo(dir * 1.5 + 6, -32)
        ctx.lineTo(dir * 2, -26)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#241e23'
        ellipse(ctx, dir * 2.5 - 2, -34, 1, 1.2)
        ctx.fill()
        ellipse(ctx, dir * 2.5 + 2, -34, 1, 1.2)
        ctx.fill()
        // Knotted cudgel with an iron collar and two readable spikes.
        const swing = e.state === 'windup' ? -1.2 : e.state === 'recover' ? 0.8 : 0
        ctx.save()
        ctx.translate(dir * 9, -20)
        ctx.rotate(dir * (0.5 + swing))
        ctx.scale(dir, 1)
        ctx.fillStyle = bodyGrad(ctx, tint('#8c6541'), 0, -5, 25, 5)
        ctx.beginPath()
        ctx.moveTo(-2, -2)
        ctx.lineTo(12, -2)
        ctx.lineTo(18, -5)
        ctx.lineTo(25, -4)
        ctx.lineTo(28, 0)
        ctx.lineTo(24, 5)
        ctx.lineTo(17, 4)
        ctx.lineTo(11, 2)
        ctx.lineTo(-2, 2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.strokeStyle = tint('#4e4136')
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(14, 0)
        ctx.quadraticCurveTo(20, -2, 25, 0)
        ctx.stroke()
        ctx.strokeStyle = outline
        ctx.fillStyle = tint('#899392')
        ctx.beginPath()
        ctx.moveTo(15, -4)
        ctx.lineTo(17, -4.5)
        ctx.lineTo(18, 4)
        ctx.lineTo(16, 3.5)
        ctx.closePath()
        ctx.moveTo(21, -4)
        ctx.lineTo(22, -8)
        ctx.lineTo(24, -4)
        ctx.closePath()
        ctx.moveTo(23, 4)
        ctx.lineTo(24, 8)
        ctx.lineTo(20, 4)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#ba9166')
        ellipse(ctx, 1, 0, 3, 3)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
        ctx.restore()
    }

    private drawCharger(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const stride = Math.sin(e.walk) * 4
        ctx.save()
        ctx.strokeStyle = outline
        ctx.lineCap = 'round'
        ctx.lineWidth = 1.2
        for (const lx of [-10, -3, 5, 12]) {
            const foot = lx + (lx < 0 ? stride : -stride)
            ctx.fillStyle = tint(lx === -3 || lx === 12 ? '#655342' : '#3d3938')
            ctx.beginPath()
            ctx.moveTo(lx - 2.5, -10)
            ctx.lineTo(lx + 3, -10)
            ctx.lineTo(foot + 2, -3)
            ctx.lineTo(foot + 3, 0)
            ctx.lineTo(foot - 3, 0)
            ctx.lineTo(foot - 2, -4)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = tint('#292e31')
            ctx.fillRect(foot - 2.5, -2.5, 5, 2.5)
        }
        ctx.translate(0, -bob)
        ctx.scale(dir, 1)
        // Shaggy wedge of shoulder and haunch, with the belly tucked up.
        ctx.fillStyle = bodyGrad(ctx, tint('#89613e'), -18 * dir, -25, 19 * dir, -4)
        ctx.beginPath()
        ctx.moveTo(-19, -13)
        ctx.quadraticCurveTo(-18, -22, -9, -24)
        ctx.lineTo(5, -25)
        ctx.quadraticCurveTo(16, -25, 19, -15)
        ctx.lineTo(17, -6)
        ctx.lineTo(12, -8)
        ctx.lineTo(9, -4)
        ctx.lineTo(5, -7)
        ctx.quadraticCurveTo(-5, -3, -14, -6)
        ctx.lineTo(-16, -10)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#44453c')
        ctx.beginPath()
        ctx.moveTo(-14, -11)
        ctx.quadraticCurveTo(0, -4, 14, -13)
        ctx.lineTo(12, -8)
        ctx.lineTo(9, -4)
        ctx.lineTo(5, -7)
        ctx.quadraticCurveTo(-7, -3, -14, -7)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = tint('#ba8954')
        ctx.beginPath()
        ctx.moveTo(-16, -16)
        ctx.quadraticCurveTo(-13, -24, -5, -22)
        ctx.lineTo(-8, -17)
        ctx.lineTo(-7, -12)
        ctx.lineTo(-12, -14)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = tint('#3c3530')
        ctx.beginPath()
        ctx.moveTo(-15, -21)
        for (let i = 0; i < 6; i++) {
            ctx.lineTo(-15 + i * 4, -27 + (i % 2))
            ctx.lineTo(-10 + i * 4, -23)
        }
        ctx.lineTo(12, -17)
        ctx.lineTo(5, -20)
        ctx.lineTo(1, -18)
        ctx.lineTo(-3, -21)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // Far tusk sits behind the carved snout.
        ctx.fillStyle = tint('#aaa98b')
        ctx.beginPath()
        ctx.moveTo(21, -12)
        ctx.lineTo(26, -15)
        ctx.lineTo(27, -21)
        ctx.lineTo(28, -15)
        ctx.lineTo(24, -9)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = bodyGrad(ctx, tint('#79523b'), 8 * dir, -24, 25 * dir, -7)
        ctx.beginPath()
        ctx.moveTo(8, -22)
        ctx.lineTo(16, -23)
        ctx.lineTo(21, -18)
        ctx.lineTo(26, -16)
        ctx.lineTo(27, -9)
        ctx.lineTo(20, -7)
        ctx.lineTo(12, -8)
        ctx.lineTo(8, -13)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#bc8968')
        ctx.beginPath()
        ctx.moveTo(21, -16)
        ctx.lineTo(26, -16)
        ctx.lineTo(27, -10)
        ctx.lineTo(22, -9)
        ctx.lineTo(20, -12)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#a97450')
        ctx.beginPath()
        ctx.moveTo(10, -20)
        ctx.lineTo(6, -27)
        ctx.lineTo(13, -25)
        ctx.lineTo(15, -20)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#674b49')
        ctx.beginPath()
        ctx.moveTo(9, -25)
        ctx.lineTo(12, -23)
        ctx.lineTo(12, -21)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#e69a42'
        ellipse(ctx, 18, -18, 1.7, 1.5)
        ctx.fill()
        ctx.fillStyle = '#23292b'
        ellipse(ctx, 18.5, -18, 0.7, 1.2)
        ctx.fill()
        ellipse(ctx, 24.5, -13, 0.9, 1.5)
        ctx.fill()
        ctx.strokeStyle = outline
        ctx.beginPath()
        ctx.moveTo(14, -20)
        ctx.lineTo(19, -20)
        ctx.stroke()
        ctx.fillStyle = bodyGrad(ctx, tint('#e8d6ae'), 20 * dir, -18, 26 * dir, -7)
        ctx.beginPath()
        ctx.moveTo(19, -10)
        ctx.lineTo(23, -8)
        ctx.lineTo(27, -12)
        ctx.lineTo(28, -19)
        ctx.lineTo(25, -14)
        ctx.lineTo(22, -13)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.restore()
    }

    private drawSwarmer(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const hop = Math.abs(Math.sin(e.walk * 1.5)) * 4
        ctx.save()
        ctx.strokeStyle = outline
        ctx.lineCap = 'round'
        ctx.lineWidth = 1
        ctx.fillStyle = tint('#8b7549')
        ctx.beginPath()
        ctx.moveTo(-4, -8 - hop)
        ctx.lineTo(-1, -7 - hop)
        ctx.lineTo(-4, -2)
        ctx.lineTo(-5, 0)
        ctx.lineTo(-7, 0)
        ctx.closePath()
        ctx.moveTo(2, -7 - hop)
        ctx.lineTo(4, -8 - hop)
        ctx.lineTo(7, 0)
        ctx.lineTo(5, 0)
        ctx.lineTo(3, -2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.translate(0, -hop - bob)
        // Bark cheeks taper into a root knot; leaf arms break the round outline.
        ctx.fillStyle = bodyGrad(ctx, tint('#849c47'), -8, -20, 8, -5)
        ctx.beginPath()
        ctx.moveTo(-7, -18)
        ctx.quadraticCurveTo(-2, -22, 5, -19)
        ctx.lineTo(8, -14)
        ctx.lineTo(7, -9)
        ctx.lineTo(3, -5)
        ctx.lineTo(0, -7)
        ctx.lineTo(-4, -5)
        ctx.lineTo(-8, -11)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#536940')
        ctx.beginPath()
        ctx.moveTo(4, -18)
        ctx.lineTo(8, -14)
        ctx.lineTo(7, -9)
        ctx.lineTo(3, -5)
        ctx.lineTo(1, -8)
        ctx.quadraticCurveTo(5, -12, 4, -18)
        ctx.fill()
        ctx.fillStyle = tint('#b2bb6c')
        ctx.beginPath()
        ctx.moveTo(-6, -17)
        ctx.lineTo(-2, -18)
        ctx.lineTo(-4, -11)
        ctx.lineTo(-6, -8)
        ctx.lineTo(-7, -12)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = tint('#698c3c')
        ctx.beginPath()
        ctx.moveTo(-6, -13)
        ctx.lineTo(-11, -16)
        ctx.lineTo(-9, -9)
        ctx.lineTo(-6, -8)
        ctx.closePath()
        ctx.moveTo(7, -13)
        ctx.lineTo(11, -15)
        ctx.lineTo(9, -8)
        ctx.lineTo(7, -8)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // One serrated blade reads better than a crown of tiny leaves.
        ctx.fillStyle = bodyGrad(ctx, tint('#9ec957'), -7, -30, 3, -18)
        ctx.beginPath()
        ctx.moveTo(0, -19)
        ctx.lineTo(-5, -22)
        ctx.lineTo(-3, -24)
        ctx.lineTo(-7, -26)
        ctx.lineTo(-4, -27)
        ctx.lineTo(-3, -30)
        ctx.quadraticCurveTo(4, -27, 2, -22)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.strokeStyle = tint('#526d38')
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(0, -19)
        ctx.quadraticCurveTo(0, -25, -3, -28)
        ctx.stroke()
        // Heavy sockets and unequal brows keep the face legible at native size.
        ctx.fillStyle = '#293b32'
        ellipse(ctx, dir * 2 - 2.5, -13.5, 3, 3.5)
        ctx.fill()
        ellipse(ctx, dir * 2 + 2.5, -13.5, 2.8, 3.2)
        ctx.fill()
        ctx.fillStyle = '#fff8e0'
        ellipse(ctx, dir * 2 - 2.5, -13, 2.2, 2.6)
        ctx.fill()
        ellipse(ctx, dir * 2 + 2.5, -13, 2, 2.3)
        ctx.fill()
        ctx.fillStyle = '#1d1520'
        ellipse(ctx, dir * 2.7 - 2.5, -13, 1, 1.6)
        ctx.fill()
        ellipse(ctx, dir * 2.7 + 2.5, -13, 1, 1.4)
        ctx.fill()
        if (e.state === 'windup') {
            ctx.fillStyle = '#29332b'
            ellipse(ctx, dir * 2, -7.5, 4.5, 2.5)
            ctx.fill()
            ctx.fillStyle = '#fff'
            ctx.beginPath()
            ctx.moveTo(dir * 2 - 4, -8)
            ctx.lineTo(dir * 2 - 2, -5)
            ctx.lineTo(dir * 2, -8)
            ctx.lineTo(dir * 2 + 2, -5)
            ctx.lineTo(dir * 2 + 4, -8)
            ctx.closePath()
            ctx.fill()
        } else {
            ctx.strokeStyle = '#29332b'
            ctx.beginPath()
            ctx.moveTo(dir * 2 - 2, -8)
            ctx.quadraticCurveTo(dir * 2, -6, dir * 2 + 2, -8)
            ctx.stroke()
        }
        ctx.restore()
    }

    private drawShieldwarden(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const stride = Math.sin(e.walk) * 3
        ctx.save()
        ctx.strokeStyle = outline
        ctx.lineCap = 'round'
        ctx.lineWidth = 1.2
        for (const side of [-1, 1]) {
            const foot = side * 5 - side * stride
            ctx.fillStyle = bodyGrad(ctx, tint('#867250'), foot - 3, -12, foot + 3, 0)
            ctx.beginPath()
            ctx.moveTo(side * 5 - 3, -13)
            ctx.lineTo(side * 5 + 3, -13)
            ctx.lineTo(foot + 2, -4)
            ctx.lineTo(foot + 4, 0)
            ctx.lineTo(foot - 4, 0)
            ctx.lineTo(foot - 3, -4)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        ctx.translate(0, -bob)
        // Rust-red padded skirt beneath a bronze, overlapping cuirass.
        ctx.fillStyle = tint('#6c3f32')
        ctx.beginPath()
        ctx.moveTo(-9, -25)
        ctx.lineTo(9, -25)
        ctx.lineTo(11, -10)
        ctx.lineTo(2, -8)
        ctx.lineTo(0, -12)
        ctx.lineTo(-3, -9)
        ctx.lineTo(-11, -11)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = bodyGrad(ctx, tint('#a18455'), -11, -32, 11, -14)
        ctx.beginPath()
        ctx.moveTo(-10, -30)
        ctx.lineTo(-5, -33)
        ctx.lineTo(6, -33)
        ctx.lineTo(11, -29)
        ctx.lineTo(8, -20)
        ctx.lineTo(0, -16)
        ctx.lineTo(-9, -20)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#4c5b58')
        ctx.beginPath()
        ctx.moveTo(2, -31)
        ctx.lineTo(10, -28)
        ctx.lineTo(7, -21)
        ctx.lineTo(1, -18)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = tint('#997247')
        for (let i = 0; i < 2; i++) {
            const y = -20 + i * 4
            ctx.beginPath()
            ctx.moveTo(-9, y)
            ctx.lineTo(0, y + 2)
            ctx.lineTo(9, y)
            ctx.lineTo(10, y + 3)
            ctx.lineTo(0, y + 5)
            ctx.lineTo(-10, y + 3)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        for (const side of [-1, 1]) {
            ctx.fillStyle = tint(side < 0 ? '#c09a60' : '#6d7563')
            ctx.beginPath()
            ctx.moveTo(side * 6, -32)
            ctx.lineTo(side * 11, -34)
            ctx.lineTo(side * 15, -29)
            ctx.lineTo(side * 12, -24)
            ctx.lineTo(side * 7, -26)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        // Folded helmet planes and a short, notched copper crest.
        ctx.fillStyle = bodyGrad(ctx, tint('#ab9268'), -8, -47, 8, -30)
        ctx.beginPath()
        ctx.moveTo(-8, -43)
        ctx.lineTo(-5, -47)
        ctx.lineTo(4, -48)
        ctx.lineTo(8, -43)
        ctx.lineTo(8, -33)
        ctx.lineTo(2, -30)
        ctx.lineTo(-8, -33)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#576563')
        ctx.beginPath()
        ctx.moveTo(2, -46)
        ctx.lineTo(7, -42)
        ctx.lineTo(7, -34)
        ctx.lineTo(2, -31)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#252e30'
        ctx.fillRect(dir * 2 - 5, -40, 10, 2.5)
        ctx.fillStyle = tint('#d4b27c')
        ctx.fillRect(dir * 2 - 0.8, -43, 1.6, 10)
        ctx.fillStyle = tint('#a75435')
        ctx.beginPath()
        ctx.moveTo(-2, -46)
        ctx.lineTo(-3, -51)
        ctx.lineTo(0, -52)
        ctx.lineTo(3, -50)
        ctx.lineTo(2, -46)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        // Flanged mace: metal planes around a wrapped ash handle.
        ctx.save()
        ctx.translate(-dir * 10, -24)
        ctx.rotate(-dir * (e.state === 'windup' ? 1.6 : 0.4))
        ctx.scale(-dir, 1)
        ctx.fillStyle = tint('#73503b')
        ctx.fillRect(-1, -1.8, 18, 3.6)
        ctx.strokeRect(-1, -1.8, 18, 3.6)
        ctx.fillStyle = bodyGrad(ctx, tint('#8f9b92'), 15, -6, 25, 6)
        ctx.beginPath()
        ctx.moveTo(15, -3)
        ctx.lineTo(18, -6)
        ctx.lineTo(22, -6)
        ctx.lineTo(25, -2)
        ctx.lineTo(25, 2)
        ctx.lineTo(22, 6)
        ctx.lineTo(18, 6)
        ctx.lineTo(15, 3)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#d1c296')
        ctx.beginPath()
        ctx.moveTo(16, -1)
        ctx.lineTo(24, -2)
        ctx.lineTo(26, 0)
        ctx.lineTo(24, 2)
        ctx.lineTo(16, 1)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#b79b6b')
        ctx.fillRect(9, -2, 2, 4)
        ellipse(ctx, 0, 0, 3, 3)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
        // Beveled tower shield keeps the original footprint and broken-state gap.
        ctx.save()
        ctx.translate(dir * 17, 0)
        if (e.shield && !e.shield.broken) {
            ctx.fillStyle = bodyGrad(ctx, tint('#b78c52'), -7, -44, 7, -6)
            ctx.beginPath()
            ctx.moveTo(-7, -41)
            ctx.lineTo(-4, -44)
            ctx.lineTo(4, -44)
            ctx.lineTo(7, -41)
            ctx.lineTo(7, -14)
            ctx.lineTo(0, -4)
            ctx.lineTo(-7, -14)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = bodyGrad(ctx, tint('#995039'), -5, -41, 5, -10)
            ctx.beginPath()
            ctx.moveTo(-4.5, -40)
            ctx.lineTo(4.5, -40)
            ctx.lineTo(4.5, -15)
            ctx.lineTo(0, -9)
            ctx.lineTo(-4.5, -15)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = tint('#526159')
            ctx.beginPath()
            ctx.moveTo(0, -39)
            ctx.lineTo(4, -39)
            ctx.lineTo(4, -16)
            ctx.lineTo(0, -11)
            ctx.closePath()
            ctx.fill()
            ctx.strokeStyle = tint('#d8b981')
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(-5.5, -39)
            ctx.lineTo(-5.5, -15)
            ctx.moveTo(0, -38)
            ctx.lineTo(0, -13)
            ctx.stroke()
            ctx.strokeStyle = outline
            ctx.fillStyle = tint('#d9c99b')
            ctx.beginPath()
            ctx.moveTo(0, -35)
            ctx.lineTo(3, -29)
            ctx.lineTo(0, -23)
            ctx.lineTo(-3, -29)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = tint('#d7b27a')
            for (const x of [-5.5, 5.5]) {
                for (const y of [-40, -16]) {
                    ellipse(ctx, x, y, 0.9, 1)
                    ctx.fill()
                }
            }
        } else {
            ctx.fillStyle = tint('#806346')
            ctx.beginPath()
            ctx.moveTo(-7, -31)
            ctx.lineTo(1, -34)
            ctx.lineTo(-1, -28)
            ctx.lineTo(3, -29)
            ctx.lineTo(-3, -22)
            ctx.lineTo(-7, -24)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
            ctx.strokeStyle = tint('#c4a372')
            ctx.beginPath()
            ctx.moveTo(-6, -30)
            ctx.lineTo(-4, -25)
            ctx.stroke()
        }
        ctx.restore()
        ctx.restore()
    }

    private drawRanged(ctx: Ctx, e: Enemy, dir: number, bob: number, tint: (c: string) => string, outline: string) {
        const stride = Math.sin(e.walk) * 3
        ctx.save()
        ctx.strokeStyle = outline
        ctx.lineCap = 'round'
        ctx.lineWidth = 1.1
        ctx.fillStyle = tint('#b5ab87')
        for (const side of [-1, 1]) {
            const foot = side * 3 - side * stride
            ctx.beginPath()
            ctx.moveTo(side * 3 - 1.5, -9)
            ctx.lineTo(side * 3 + 1.5, -9)
            ctx.lineTo(foot + 1.5, -3)
            ctx.lineTo(foot + 3, 0)
            ctx.lineTo(foot - 3, 0)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        ctx.translate(0, -bob)
        // Curved stalk and papery collar below the overhanging gills.
        ctx.fillStyle = bodyGrad(ctx, tint('#ddcc9f'), -6, -26, 7, -7)
        ctx.beginPath()
        ctx.moveTo(-5, -26)
        ctx.lineTo(5, -26)
        ctx.quadraticCurveTo(2, -16, 7, -8)
        ctx.quadraticCurveTo(0, -5, -6, -8)
        ctx.quadraticCurveTo(-2, -16, -5, -26)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#879481')
        ctx.beginPath()
        ctx.moveTo(2, -24)
        ctx.lineTo(5, -25)
        ctx.quadraticCurveTo(2, -16, 7, -8)
        ctx.lineTo(2, -8)
        ctx.quadraticCurveTo(0, -16, 2, -24)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = tint('#eee0b5')
        ctx.beginPath()
        ctx.moveTo(-6, -23)
        ctx.lineTo(6, -23)
        ctx.lineTo(7, -19)
        ctx.lineTo(2, -20)
        ctx.lineTo(-1, -18)
        ctx.lineTo(-7, -20)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#9c7b87')
        ellipse(ctx, 0, -24, 15, 4)
        ctx.fill()
        ctx.stroke()
        ctx.strokeStyle = tint('#594c64')
        ctx.lineWidth = 0.8
        ctx.beginPath()
        for (const x of [-12, -7, 0, 7, 12]) {
            ctx.moveTo(x, -25)
            ctx.lineTo(x * 0.35, -21)
        }
        ctx.stroke()
        ctx.strokeStyle = outline
        ctx.lineWidth = 1.2
        ctx.fillStyle = bodyGrad(ctx, tint('#88538a'), -14, -40, 15, -23)
        ctx.beginPath()
        ctx.moveTo(-15, -25)
        ctx.bezierCurveTo(-11, -29, -11, -37, -3, -39)
        ctx.bezierCurveTo(7, -41, 9, -28, 15, -25)
        ctx.quadraticCurveTo(13, -22, 6, -24)
        ctx.quadraticCurveTo(-4, -22, -15, -25)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#b87d9d')
        ctx.beginPath()
        ctx.moveTo(-12, -28)
        ctx.quadraticCurveTo(-8, -40, -2, -37)
        ctx.quadraticCurveTo(-5, -33, -3, -29)
        ctx.lineTo(-8, -30)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = tint('#e5c7b0')
        ctx.beginPath()
        ctx.moveTo(-7, -34)
        ctx.quadraticCurveTo(-5, -38, -2, -35)
        ctx.lineTo(-3, -32)
        ctx.lineTo(-7, -32)
        ctx.closePath()
        ctx.moveTo(5, -30)
        ctx.quadraticCurveTo(8, -32, 9, -27)
        ctx.lineTo(6, -27)
        ctx.closePath()
        ctx.fill()
        // Spore satchel and strap sit beside the face, not across the eyes.
        ctx.strokeStyle = tint('#705a41')
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(dir * 4, -20)
        ctx.lineTo(-dir * 6, -9)
        ctx.stroke()
        ctx.strokeStyle = outline
        ctx.lineWidth = 1
        ctx.fillStyle = bodyGrad(ctx, tint('#9c6d40'), -dir * 8 - 3, -14, -dir * 8 + 3, -5)
        ctx.beginPath()
        ctx.roundRect(-dir * 8 - 3.5, -14, 7, 9, 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#c3a56c')
        ctx.beginPath()
        ctx.moveTo(-dir * 8 - 3.5, -13)
        ctx.lineTo(-dir * 8 + 3.5, -13)
        ctx.lineTo(-dir * 8, -9)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#1d1520'
        ellipse(ctx, dir * 2 - 2.5, -16, 1.2, 1.7)
        ctx.fill()
        ellipse(ctx, dir * 2 + 2.5, -16, 1.2, 1.7)
        ctx.fill()
        // Projected aim stays unchanged; a flared reed replaces the straight stick.
        const ang = e.facing
        const px = Math.cos(ang)
        const py = Math.sin(ang) * YS
        ctx.save()
        ctx.translate(px * 4, -14 + py * 4)
        ctx.rotate(Math.atan2(py, px))
        ctx.scale(Math.hypot(px, py), 1)
        ctx.fillStyle = bodyGrad(ctx, tint('#849b51'), 0, -3, 18, 3)
        ctx.beginPath()
        ctx.moveTo(0, -1.2)
        ctx.quadraticCurveTo(10, -0.5, 18, -3)
        ctx.lineTo(18, 3)
        ctx.quadraticCurveTo(10, 1, 0, 1.2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.strokeStyle = tint('#d4c48d')
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(6, -1)
        ctx.lineTo(6, 1.5)
        ctx.moveTo(12, -1.5)
        ctx.lineTo(12, 2)
        ctx.stroke()
        ctx.strokeStyle = outline
        ctx.lineWidth = 0.8
        ctx.fillStyle = '#303c35'
        ellipse(ctx, 18, 0, 1.1, 2.8)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = tint('#7f994e')
        ctx.beginPath()
        ctx.moveTo(10, -1)
        ctx.quadraticCurveTo(9, -7, 14, -6)
        ctx.lineTo(12, -2)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.restore()
        ctx.restore()
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
