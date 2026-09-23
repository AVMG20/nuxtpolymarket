// Screen-space effects for Aether Gates that cross DOM boundaries: lightning
// from an orb on the reels to the multiplier meter, glowing comets carrying a
// value, and spark bursts. Drawn on one fixed, pointer-transparent 2D canvas
// that covers the viewport; the animation loop only runs while something is
// on screen. Randomness here is cosmetic (bolt jitter, spark spread).

export interface AgPoint {
    x: number
    y: number
}

interface Bolt {
    kind: 'bolt'
    from: AgPoint
    to: AgPoint
    color: string
    start: number
    life: number
    width: number
    seed: number
}

interface Comet {
    kind: 'comet'
    from: AgPoint
    to: AgPoint
    ctrl: AgPoint
    color: string
    start: number
    life: number
    size: number
    trail: AgPoint[]
    done: () => void
    arrived: boolean
}

interface Spark {
    kind: 'spark'
    x: number
    y: number
    vx: number
    vy: number
    color: string
    start: number
    life: number
    size: number
}

interface Ring {
    kind: 'ring'
    at: AgPoint
    color: string
    start: number
    life: number
    radius: number
}

type Item = Bolt | Comet | Spark | Ring

function jagged(from: AgPoint, to: AgPoint, detail: number, spread: number): AgPoint[] {
    const pts: AgPoint[] = [from]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    for (let i = 1; i < detail; i++) {
        const t = i / detail
        const off = (Math.random() - 0.5) * spread * Math.sin(Math.PI * t) * 2
        pts.push({ x: from.x + dx * t + nx * off, y: from.y + dy * t + ny * off })
    }
    pts.push(to)
    return pts
}

export class AgFx {
    private readonly ctx: CanvasRenderingContext2D
    private items: Item[] = []
    private raf = 0
    private dpr = 1
    private w = 0
    private h = 0

    constructor(private readonly canvas: HTMLCanvasElement) {
        this.ctx = canvas.getContext('2d')!
        this.resize()
    }

    resize() {
        this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
        this.w = window.innerWidth
        this.h = window.innerHeight
        this.canvas.width = Math.round(this.w * this.dpr)
        this.canvas.height = Math.round(this.h * this.dpr)
    }

    /** A forked lightning strike that flickers for `life` seconds. */
    bolt(from: AgPoint, to: AgPoint, color: string, life = 0.4, width = 3) {
        this.push({ kind: 'bolt', from, to, color, life, width, start: performance.now(), seed: Math.random() })
    }

    /** A glowing comet that arcs from `from` to `to`; resolves on arrival. */
    comet(from: AgPoint, to: AgPoint, color: string, life = 0.6, size = 14): Promise<void> {
        return new Promise((resolve) => {
            const mx = (from.x + to.x) / 2
            const my = (from.y + to.y) / 2
            const lift = Math.min(220, Math.hypot(to.x - from.x, to.y - from.y) * 0.35)
            const ctrl = { x: mx + (Math.random() - 0.5) * 120, y: my - lift }
            this.push({ kind: 'comet', from, to, ctrl, color, life, size, trail: [], start: performance.now(), done: resolve, arrived: false })
        })
    }

    burst(at: AgPoint, color: string, count = 18, speed = 260, life = 0.7) {
        const now = performance.now()
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2
            const v = speed * (0.35 + Math.random() * 0.65)
            this.items.push({ kind: 'spark', x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, start: now, life: life * (0.6 + Math.random() * 0.4), size: 1.5 + Math.random() * 2.5 })
        }
        this.items.push({ kind: 'ring', at, color, start: now, life: life * 0.7, radius: speed * 0.32 })
        this.kick()
    }

    clear() {
        for (const item of this.items) if (item.kind === 'comet' && !item.arrived) item.done()
        this.items = []
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }

    destroy() {
        cancelAnimationFrame(this.raf)
        this.clear()
    }

    private push(item: Item) {
        this.items.push(item)
        this.kick()
    }

    private kick() {
        if (!this.raf) this.raf = requestAnimationFrame(this.frame)
    }

    private frame = (now: number) => {
        this.raf = 0
        const ctx = this.ctx
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        const alive: Item[] = []
        for (const item of this.items) {
            const t = (now - item.start) / 1000 / item.life
            if (t >= 1) {
                if (item.kind === 'comet' && !item.arrived) {
                    item.arrived = true
                    item.done()
                }
                continue
            }
            alive.push(item)
            if (item.kind === 'bolt') this.drawBolt(item, t)
            else if (item.kind === 'comet') this.drawComet(item, t)
            else if (item.kind === 'spark') this.drawSpark(item, t, now)
            else this.drawRing(item, t)
        }
        this.items = alive
        ctx.globalCompositeOperation = 'source-over'
        if (alive.length) this.kick()
    }

    private drawBolt(b: Bolt, t: number) {
        const ctx = this.ctx
        // Re-jag every few frames so the strike crackles.
        const flicker = t < 0.15 ? 1 : (Math.sin(t * 60 + b.seed * 10) > -0.3 ? 1 : 0.35)
        const alpha = (1 - t) * flicker
        const len = Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y)
        const pts = jagged(b.from, b.to, Math.max(6, Math.round(len / 28)), Math.min(60, len * 0.12))
        const path = () => {
            ctx.beginPath()
            pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        }
        ctx.globalAlpha = alpha * 0.35
        ctx.strokeStyle = b.color
        ctx.lineWidth = b.width * 5
        path()
        ctx.stroke()
        ctx.globalAlpha = alpha * 0.8
        ctx.lineWidth = b.width * 2
        path()
        ctx.stroke()
        ctx.globalAlpha = alpha
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = Math.max(1.5, b.width * 0.7)
        path()
        ctx.stroke()
        // A fork off the middle.
        const mid = pts[Math.floor(pts.length / 2)]!
        const fork = jagged(mid, { x: mid.x + (Math.random() - 0.5) * len * 0.3, y: mid.y + len * 0.12 }, 4, 18)
        ctx.globalAlpha = alpha * 0.6
        ctx.strokeStyle = b.color
        ctx.lineWidth = Math.max(1.5, b.width * 0.8)
        ctx.beginPath()
        fork.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.stroke()
        ctx.globalAlpha = 1
    }

    private drawComet(c: Comet, t: number) {
        const ctx = this.ctx
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
        const u = 1 - e
        const x = u * u * c.from.x + 2 * u * e * c.ctrl.x + e * e * c.to.x
        const y = u * u * c.from.y + 2 * u * e * c.ctrl.y + e * e * c.to.y
        c.trail.push({ x, y })
        if (c.trail.length > 16) c.trail.shift()
        for (let i = 0; i < c.trail.length; i++) {
            const p = c.trail[i]!
            const k = i / c.trail.length
            ctx.globalAlpha = k * 0.5
            ctx.fillStyle = c.color
            ctx.beginPath()
            ctx.arc(p.x, p.y, c.size * (0.3 + k * 0.6), 0, Math.PI * 2)
            ctx.fill()
        }
        const g = ctx.createRadialGradient(x, y, 0, x, y, c.size * 2.4)
        g.addColorStop(0, 'rgba(255,255,255,1)')
        g.addColorStop(0.25, c.color)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = 1
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, c.size * 2.4, 0, Math.PI * 2)
        ctx.fill()
    }

    private drawSpark(s: Spark, t: number, now: number) {
        const ctx = this.ctx
        const dt = (now - s.start) / 1000
        const x = s.x + s.vx * dt
        const y = s.y + s.vy * dt + 260 * dt * dt
        ctx.globalAlpha = 1 - t
        ctx.fillStyle = s.color
        ctx.beginPath()
        ctx.arc(x, y, s.size * (1 - t * 0.5), 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = (1 - t) * 0.8
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(x, y, s.size * 0.4, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
    }

    private drawRing(r: Ring, t: number) {
        const ctx = this.ctx
        ctx.globalAlpha = (1 - t) * 0.9
        ctx.strokeStyle = r.color
        ctx.lineWidth = 3 * (1 - t) + 1
        ctx.beginPath()
        ctx.arc(r.at.x, r.at.y, r.radius * (0.2 + t), 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
    }
}
