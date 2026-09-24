// Ember Portals effects: pooled pixi particles (embers, shards, flames),
// shockwaves, beams, fireballs, light rays and screen shake over the board,
// plus a cheap canvas-2D ember drift for the page behind it. Every effect is
// cosmetic, so Math.random is fine here.
import type { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js'

type PixiModule = typeof import('pixi.js')

export interface EpFxTextures {
    spark: Texture
    glow: Texture
    mote: Texture
    shard: Texture
    flame: Texture
}

export type EpParticleKind = keyof EpFxTextures

export interface EmitOptions {
    count: number
    /** Speed in px/s, or a [min, max] range. */
    speed?: number | [number, number]
    /** Direction in radians (0 = right, -π/2 = up); omit for every direction. */
    angle?: number
    /** Spread around `angle`, radians. */
    cone?: number
    gravity?: number
    drag?: number
    life?: number
    scale?: number
    /** Scale at the end of life, as a share of the start scale. */
    endScale?: number
    colors?: number[]
    kind?: EpParticleKind
    /** Spawn inside this radius around (x, y). */
    spread?: number
    alpha?: number
    add?: boolean
    spin?: number
}

interface Particle {
    s: Sprite
    vx: number
    vy: number
    g: number
    drag: number
    life: number
    age: number
    s0: number
    s1: number
    a0: number
    spin: number
    /** Orbiting particle (vortex): angle, radius, angular speed. */
    orbit?: { cx: number, cy: number, a: number, r: number, w: number }
}

interface Ring { g: Graphics, age: number, life: number, radius: number, color: number, width: number }
interface Fade { g: Graphics | Sprite, age: number, life: number, a0: number, grow?: number }

export interface FlameOptions {
    /** Ring radius the flames start on, px. */
    radius: number
    colors: number[]
    /** 0..1: rate, size and height of the flames. */
    intensity: number
}

export interface FlameHandle {
    set: (o: Partial<FlameOptions>) => void
    destroy: () => void
}

interface Flame {
    layer: Container
    o: FlameOptions
    acc: number
    parts: Particle[]
    alive: boolean
}

export interface RaysHandle {
    setColor: (color: number) => void
    destroy: () => void
}

const TAU = Math.PI * 2
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]!

/** A soft flame lick: bright round head, fading tail (white, tinted per particle). */
export function paintFlameSprite(px = 64): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = px
    c.height = px
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(px / 2, px * 0.62, 0, px / 2, px * 0.55, px * 0.48)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.7)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(px / 2, px * 0.04)
    g.bezierCurveTo(px * 0.86, px * 0.42, px * 0.9, px * 0.94, px / 2, px * 0.96)
    g.bezierCurveTo(px * 0.1, px * 0.94, px * 0.14, px * 0.42, px / 2, px * 0.04)
    g.fill()
    return c
}

/** A soft round ember mote (orange-white, not tinted). */
export function paintMoteSprite(px = 64): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = px
    c.height = px
    const g = c.getContext('2d')!
    const r = px / 2
    const grad = g.createRadialGradient(r, r, 0, r, r, r)
    grad.addColorStop(0, 'rgba(255,250,220,1)')
    grad.addColorStop(0.25, 'rgba(255,190,80,1)')
    grad.addColorStop(0.6, 'rgba(255,90,20,0.75)')
    grad.addColorStop(1, 'rgba(255,60,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, px, px)
    return c
}

/** A jagged white shard, tinted to the exploding symbol's colour. */
export function paintShardSprite(px = 48): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = px
    c.height = px
    const g = c.getContext('2d')!
    g.fillStyle = '#ffffff'
    g.strokeStyle = 'rgba(255,255,255,0.5)'
    g.lineWidth = px * 0.06
    g.beginPath()
    g.moveTo(px * 0.5, px * 0.05)
    g.lineTo(px * 0.9, px * 0.55)
    g.lineTo(px * 0.55, px * 0.95)
    g.lineTo(px * 0.15, px * 0.6)
    g.closePath()
    g.fill()
    g.stroke()
    return c
}

export class EpFx {
    private readonly parts: Particle[] = []
    private readonly pool: Sprite[] = []
    private readonly rings: Ring[] = []
    private readonly fades: Fade[] = []
    private readonly flames: Flame[] = []
    private readonly rays: { g: Graphics, color: number, t: number, alive: boolean, x: number, y: number, r: number }[] = []
    private fountainRate = 0
    private fountainColors = [0xffc247, 0xff8a1f, 0xffffff]
    private fountainAcc = 0
    private ambientRate = 0
    private ambientAcc = 0
    private shakeAmp = 0
    private shakeTime = 0
    private shakeDur = 0.45
    private shakeTarget: Container | null = null
    private shakeBase = { x: 0, y: 0 }
    private readonly tick: (t: Ticker) => void
    /** Scale for shakes and flashes; lower with prefers-reduced-motion. */
    readonly calm: number

    constructor(
        private readonly PIXI: PixiModule,
        private readonly ticker: Ticker,
        private readonly layer: Container,
        private readonly tex: EpFxTextures,
        private readonly width: number,
        private readonly height: number,
        private readonly max: number,
        reducedMotion: boolean
    ) {
        this.calm = reducedMotion ? 0.25 : 1
        this.tick = (t: Ticker) => this.update(Math.min(50, t.deltaMS) / 1000)
        ticker.add(this.tick)
    }

    get count() {
        let n = this.parts.length
        for (const f of this.flames) n += f.parts.length
        return n
    }

    private acquire(kind: EpParticleKind, parent: Container): Sprite | null {
        if (this.count >= this.max) return null
        const s = this.pool.pop() ?? new this.PIXI.Sprite()
        s.texture = this.tex[kind]
        s.anchor.set(0.5)
        s.alpha = 1
        s.rotation = 0
        s.tint = 0xffffff
        s.visible = true
        s.blendMode = 'normal'
        parent.addChild(s)
        return s
    }

    private release(p: Particle) {
        p.s.visible = false
        p.s.parent?.removeChild(p.s)
        this.pool.push(p.s)
    }

    emit(x: number, y: number, o: EmitOptions, parent: Container = this.layer, into: Particle[] = this.parts) {
        const kind = o.kind ?? 'spark'
        const colors = o.colors ?? [0xffffff]
        const base = (o.scale ?? 1) * 64 / (this.tex[kind].width || 64)
        for (let i = 0; i < o.count; i++) {
            const s = this.acquire(kind, parent)
            if (!s) return
            const angle = o.angle === undefined ? Math.random() * TAU : o.angle + (Math.random() - 0.5) * (o.cone ?? 0)
            const sp = Array.isArray(o.speed) ? rand(o.speed[0], o.speed[1]) : (o.speed ?? 260) * rand(0.35, 1.1)
            const r = o.spread ? Math.sqrt(Math.random()) * o.spread : 0
            const ra = Math.random() * TAU
            s.position.set(x + Math.cos(ra) * r, y + Math.sin(ra) * r)
            if (kind !== 'mote') s.tint = pick(colors)
            if (o.add ?? kind !== 'shard') s.blendMode = 'add'
            const s0 = base * rand(0.55, 1.05)
            s.scale.set(s0)
            s.rotation = kind === 'shard' ? Math.random() * TAU : 0
            const a0 = o.alpha ?? 1
            s.alpha = a0
            into.push({
                s,
                vx: Math.cos(angle) * sp,
                vy: Math.sin(angle) * sp,
                g: o.gravity ?? (kind === 'shard' ? 900 : 200),
                drag: o.drag ?? (kind === 'shard' ? 0.6 : 1.6),
                life: (o.life ?? 0.8) * rand(0.7, 1.2),
                age: 0,
                s0,
                s1: s0 * (o.endScale ?? 0.35),
                a0,
                spin: o.spin ?? (kind === 'shard' ? rand(-10, 10) : rand(-3, 3))
            })
        }
    }

    /** Particles that spiral into (x, y): a portal opening. */
    vortex(x: number, y: number, colors: number[], radius = 110, count = 36, life = 0.7) {
        for (let i = 0; i < count; i++) {
            const s = this.acquire('spark', this.layer)
            if (!s) return
            s.tint = pick(colors)
            s.blendMode = 'add'
            const s0 = rand(0.18, 0.4)
            s.scale.set(s0)
            this.parts.push({
                s, vx: 0, vy: 0, g: 0, drag: 0, age: 0, life: life * rand(0.7, 1.1), s0, s1: s0 * 0.4, a0: 1, spin: 0,
                orbit: { cx: x, cy: y, a: Math.random() * TAU, r: radius * rand(0.6, 1.1), w: rand(7, 11) }
            })
        }
    }

    shockwave(x: number, y: number, color: number, radius = 160, life = 0.6, width = 8) {
        const g = new this.PIXI.Graphics()
        g.blendMode = 'add'
        g.position.set(x, y)
        this.layer.addChild(g)
        this.rings.push({ g, age: 0, life, radius, color, width })
    }

    /** Full-board additive flash. */
    flash(color: number, alpha = 0.7, life = 0.4) {
        const g = new this.PIXI.Graphics()
        g.rect(-60, -60, this.width + 120, this.height + 120).fill({ color })
        g.blendMode = 'add'
        g.alpha = alpha * this.calm
        this.layer.addChild(g)
        this.fades.push({ g, age: 0, life, a0: g.alpha })
    }

    /** A glowing beam of light from (x0, y0) to (x1, y1). */
    beam(x0: number, y0: number, x1: number, y1: number, color: number, life = 0.7, width = 14) {
        const g = new this.PIXI.Graphics()
        for (const [w, a] of [[width * 2.4, 0.18], [width, 0.5], [Math.max(2, width * 0.3), 1]] as const) {
            g.moveTo(x0, y0).lineTo(x1, y1).stroke({ color: a === 1 ? 0xffffff : color, width: w, alpha: a, cap: 'round' })
        }
        g.blendMode = 'add'
        this.layer.addChild(g)
        this.fades.push({ g, age: 0, life, a0: 1 })
    }

    /** A soft glow that swells and fades at (x, y). */
    bloom(x: number, y: number, color: number, size = 240, life = 0.5) {
        const s = new this.PIXI.Sprite(this.tex.glow)
        s.anchor.set(0.5)
        s.position.set(x, y)
        s.tint = color
        s.blendMode = 'add'
        s.width = s.height = size * 0.4
        this.layer.addChild(s)
        this.fades.push({ g: s, age: 0, life, a0: 1, grow: size })
    }

    /** A fireball flies from one point to another, trailing embers. */
    fireball(x0: number, y0: number, x1: number, y1: number, colors: number[], seconds: number): Promise<void> {
        if (seconds <= 0) return Promise.resolve()
        const head = new this.PIXI.Sprite(this.tex.glow)
        head.anchor.set(0.5)
        head.tint = colors[0] ?? 0xffc247
        head.blendMode = 'add'
        head.width = head.height = 70
        head.position.set(x0, y0)
        this.layer.addChild(head)
        // Arc sideways so two fireballs meeting don't overlap on a straight line.
        const mx = (x0 + x1) / 2 + (y1 - y0) * 0.25
        const my = (y0 + y1) / 2 - (x1 - x0) * 0.25 - 30
        let t = 0
        return new Promise((resolve) => {
            const step = (tk: Ticker) => {
                t += Math.min(50, tk.deltaMS) / 1000 / seconds
                const k = Math.min(1, t)
                const e = k * k
                const u = 1 - e
                head.x = u * u * x0 + 2 * u * e * mx + e * e * x1
                head.y = u * u * y0 + 2 * u * e * my + e * e * y1
                this.emit(head.x, head.y, { count: 2, kind: 'flame', speed: [10, 60], gravity: -120, life: 0.4, scale: 0.7, colors, spread: 8 })
                if (k >= 1) {
                    this.ticker.remove(step)
                    head.destroy()
                    resolve()
                }
            }
            this.ticker.add(step)
        })
    }

    /** Rotating light rays behind a big moment; destroy() fades them out. */
    lightRays(x: number, y: number, color: number, radius = 700): RaysHandle {
        const g = new this.PIXI.Graphics()
        g.position.set(x, y)
        g.blendMode = 'add'
        g.alpha = 0
        this.layer.addChildAt(g, 0)
        const ray = { g, color, t: 0, alive: true, x, y, r: radius }
        this.drawRays(ray)
        this.rays.push(ray)
        return {
            setColor: (c: number) => {
                ray.color = c
                this.drawRays(ray)
            },
            destroy: () => { ray.alive = false }
        }
    }

    private drawRays(ray: { g: Graphics, color: number, r: number }) {
        ray.g.clear()
        const n = 16
        for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU
            const w = TAU / n * 0.32
            ray.g.moveTo(0, 0)
                .lineTo(Math.cos(a - w) * ray.r, Math.sin(a - w) * ray.r)
                .lineTo(Math.cos(a + w) * ray.r, Math.sin(a + w) * ray.r)
                .closePath()
                .fill({ color: ray.color, alpha: 0.16 })
        }
    }

    /** Flames licking up from a ring, drawn in `layer` so they follow it. */
    addFlame(layer: Container, o: FlameOptions): FlameHandle {
        const f: Flame = { layer, o: { ...o }, acc: Math.random(), parts: [], alive: true }
        this.flames.push(f)
        return {
            set: (n) => { Object.assign(f.o, n) },
            destroy: () => {
                f.alive = false
                for (const p of f.parts) this.release(p)
                f.parts.length = 0
                const i = this.flames.indexOf(f)
                if (i >= 0) this.flames.splice(i, 1)
            }
        }
    }

    /** Embers rising from the bottom of the board; 0 stops it. */
    ambient(rate: number) {
        this.ambientRate = rate
    }

    /** Embers and sparks shooting up from the bottom edge; 0 stops it. */
    fountain(rate: number, colors?: number[]) {
        this.fountainRate = rate
        if (colors) this.fountainColors = colors
    }

    shake(target: Container, amplitude: number, duration = 0.45) {
        const amp = amplitude * this.calm
        if (this.shakeTime > 0 && this.shakeTarget === target && amp < this.shakeAmp) return
        if (this.shakeTime <= 0) this.shakeBase = { x: target.x, y: target.y }
        this.shakeTarget = target
        this.shakeAmp = amp
        this.shakeTime = duration
        this.shakeDur = duration
    }

    /** Drop every transient effect at once (skip); flames and rays stay. */
    clear() {
        for (const p of this.parts) this.release(p)
        this.parts.length = 0
        for (const r of this.rings) r.g.destroy()
        this.rings.length = 0
        for (const f of this.fades) f.g.destroy()
        this.fades.length = 0
        this.fountainRate = 0
        if (this.shakeTarget) this.shakeTarget.position.set(this.shakeBase.x, this.shakeBase.y)
        this.shakeTarget = null
        this.shakeTime = 0
    }

    destroy() {
        this.ticker.remove(this.tick)
        this.clear()
        for (const f of [...this.flames]) {
            for (const p of f.parts) this.release(p)
        }
        this.flames.length = 0
        for (const r of this.rays) r.g.destroy()
        this.rays.length = 0
        for (const s of this.pool) s.destroy()
        this.pool.length = 0
    }

    private stepParticle(p: Particle, dt: number): boolean {
        p.age += dt
        if (p.age >= p.life) return false
        const t = p.age / p.life
        if (p.orbit) {
            const o = p.orbit
            o.a += o.w * dt
            const r = o.r * (1 - t)
            p.s.x = o.cx + Math.cos(o.a) * r
            p.s.y = o.cy + Math.sin(o.a) * r
        } else {
            const damp = Math.exp(-p.drag * dt)
            p.vx *= damp
            p.vy = p.vy * damp + p.g * dt
            p.s.x += p.vx * dt
            p.s.y += p.vy * dt
        }
        p.s.rotation += p.spin * dt
        p.s.scale.set(p.s0 + (p.s1 - p.s0) * t)
        p.s.alpha = p.a0 * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9)
        return true
    }

    private update(dt: number) {
        if (this.ambientRate > 0) {
            this.ambientAcc += dt * this.ambientRate
            while (this.ambientAcc >= 1) {
                this.ambientAcc -= 1
                this.emit(Math.random() * this.width, this.height + 10, { count: 1, kind: 'mote', angle: -Math.PI / 2, cone: 0.7, speed: [40, 110], gravity: -20, drag: 0.2, life: 3.5, scale: rand(0.12, 0.3), alpha: 0.7 })
            }
        }
        if (this.fountainRate > 0) {
            this.fountainAcc += dt * this.fountainRate
            while (this.fountainAcc >= 1) {
                this.fountainAcc -= 1
                const x = this.width * rand(0.1, 0.9)
                this.emit(x, this.height + 20, { count: 1, kind: Math.random() < 0.5 ? 'mote' : 'spark', angle: -Math.PI / 2, cone: 0.5, speed: [700, 1050], gravity: 1000, drag: 0.3, life: 2, scale: rand(0.35, 0.7), colors: this.fountainColors })
            }
        }

        for (let i = this.parts.length - 1; i >= 0; i--) {
            const p = this.parts[i]!
            if (this.stepParticle(p, dt)) continue
            this.release(p)
            this.parts.splice(i, 1)
        }

        // Fewer licks per portal when many are open, so the budget holds.
        const share = Math.min(1, 7 / Math.max(1, this.flames.length))
        for (const f of this.flames) {
            if (!f.alive || f.layer.destroyed) continue
            const k = f.o.intensity
            f.acc += dt * (14 + k * 46) * share
            while (f.acc >= 1) {
                f.acc -= 1
                const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7
                const r = f.o.radius * rand(0.82, 1)
                this.emit(Math.cos(a) * r, Math.sin(a) * r, {
                    count: 1,
                    kind: 'flame',
                    angle: -Math.PI / 2 + Math.cos(a) * 0.35,
                    cone: 0.35,
                    speed: [40 + k * 40, 90 + k * 110],
                    gravity: -140 - k * 160,
                    drag: 1.2,
                    life: 0.42 + k * 0.4,
                    scale: 0.55 + k * 0.75,
                    endScale: 0.15,
                    colors: f.o.colors
                }, f.layer, f.parts)
            }
            for (let i = f.parts.length - 1; i >= 0; i--) {
                const p = f.parts[i]!
                if (this.stepParticle(p, dt)) continue
                this.release(p)
                f.parts.splice(i, 1)
            }
        }

        for (let i = this.rings.length - 1; i >= 0; i--) {
            const r = this.rings[i]!
            r.age += dt
            const t = r.age / r.life
            if (t >= 1) {
                r.g.destroy()
                this.rings.splice(i, 1)
                continue
            }
            const ease = 1 - (1 - t) ** 3
            r.g.clear()
            // Never thinner than 2px, or it flickers into dots on dpr 1.
            r.g.circle(0, 0, 8 + r.radius * ease)
                .stroke({ color: r.color, width: Math.max(2, r.width * 2.4 * (1 - t)), alpha: 0.25 * (1 - t) })
                .circle(0, 0, 8 + r.radius * ease)
                .stroke({ color: r.color, width: Math.max(2, r.width * (1 - t)), alpha: 1 - t })
        }

        for (let i = this.fades.length - 1; i >= 0; i--) {
            const f = this.fades[i]!
            f.age += dt
            const t = f.age / f.life
            if (t >= 1) {
                f.g.destroy()
                this.fades.splice(i, 1)
                continue
            }
            f.g.alpha = f.a0 * (1 - t) * (1 - t)
            if (f.grow) {
                const s = f.grow * (0.4 + 0.6 * (1 - (1 - t) ** 3))
                f.g.width = f.g.height = s
            }
        }

        for (let i = this.rays.length - 1; i >= 0; i--) {
            const r = this.rays[i]!
            r.t += dt
            r.g.rotation += dt * 0.35
            if (r.alive) {
                r.g.alpha = Math.min(1, r.g.alpha + dt * 2.5) * (0.85 + Math.sin(r.t * 4) * 0.15)
            } else {
                r.g.alpha -= dt * 2.5
                if (r.g.alpha <= 0) {
                    r.g.destroy()
                    this.rays.splice(i, 1)
                }
            }
        }

        if (this.shakeTarget && this.shakeTime > 0) {
            this.shakeTime -= dt
            const a = this.shakeAmp * Math.max(0, this.shakeTime) / this.shakeDur
            if (this.shakeTime <= 0) {
                this.shakeTarget.position.set(this.shakeBase.x, this.shakeBase.y)
                this.shakeTarget = null
            } else {
                this.shakeTarget.position.set(this.shakeBase.x + (Math.random() - 0.5) * 2 * a, this.shakeBase.y + (Math.random() - 0.5) * 2 * a)
            }
        }
    }
}

/**
 * A few faint embers drifting up in the lower half of the page, around the
 * board, on a plain 2D canvas (a second pixi app would be far heavier). They
 * burn out before they reach the top. Pauses while hidden.
 */
export class EpEmberDrift {
    private readonly ctx: CanvasRenderingContext2D
    private readonly motes: { x: number, y: number, vx: number, vy: number, r: number, life: number, age: number, hue: number, wob: number }[] = []
    private raf = 0
    private last = 0
    private w = 0
    private h = 0
    private dpr = 1
    rate: number
    private acc = 0

    constructor(private readonly canvas: HTMLCanvasElement, private readonly cap: number, rate: number) {
        this.ctx = canvas.getContext('2d')!
        this.rate = rate
        this.resize()
        this.raf = requestAnimationFrame(this.frame)
    }

    resize() {
        this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
        this.w = this.canvas.clientWidth
        this.h = this.canvas.clientHeight
        this.canvas.width = Math.max(1, Math.round(this.w * this.dpr))
        this.canvas.height = Math.max(1, Math.round(this.h * this.dpr))
    }

    private readonly frame = (now: number) => {
        this.raf = requestAnimationFrame(this.frame)
        const dt = Math.min(0.05, (now - (this.last || now)) / 1000)
        this.last = now
        if (document.hidden) return
        this.acc += dt * this.rate
        while (this.acc >= 1 && this.motes.length < this.cap) {
            this.acc -= 1
            this.motes.push({
                x: this.w * rand(0.15, 0.85),
                y: this.h * rand(0.6, 1),
                vx: rand(-8, 8),
                vy: -rand(12, 30),
                r: rand(0.6, 1.4),
                life: rand(3, 6),
                age: 0,
                hue: rand(14, 44),
                wob: Math.random() * TAU
            })
        }
        if (this.acc > 1) this.acc = 1
        const g = this.ctx
        g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
        g.clearRect(0, 0, this.w, this.h)
        g.globalCompositeOperation = 'lighter'
        for (let i = this.motes.length - 1; i >= 0; i--) {
            const m = this.motes[i]!
            m.age += dt
            if (m.age >= m.life || m.y < -20) {
                this.motes.splice(i, 1)
                continue
            }
            m.wob += dt * 1.6
            m.x += (m.vx + Math.sin(m.wob) * 8) * dt
            m.y += m.vy * dt
            const t = m.age / m.life
            const a = (t < 0.2 ? t / 0.2 : 1 - t) * 0.5
            // At least ~1.5 css px so it never shimmers into a dot on dpr 1.
            const r = Math.max(1.5, m.r)
            g.fillStyle = `hsla(${m.hue}, 100%, 62%, ${a * 0.25})`
            g.beginPath()
            g.arc(m.x, m.y, r * 2.2, 0, TAU)
            g.fill()
            g.fillStyle = `hsla(${m.hue + 10}, 100%, 80%, ${a})`
            g.beginPath()
            g.arc(m.x, m.y, r, 0, TAU)
            g.fill()
        }
        g.globalCompositeOperation = 'source-over'
    }

    destroy() {
        cancelAnimationFrame(this.raf)
        this.motes.length = 0
    }
}

/** Soft light rays fanning out from the centre (white, tinted per use). */
export function paintRaysSprite(px = 256, rays = 12): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = px
    c.height = px
    const g = c.getContext('2d')!
    const r = px / 2
    g.translate(r, r)
    for (let i = 0; i < rays; i++) {
        const a = (i / rays) * TAU
        const w = (TAU / rays) * (i % 2 ? 0.16 : 0.26)
        const grad = g.createRadialGradient(0, 0, r * 0.12, 0, 0, r)
        grad.addColorStop(0, 'rgba(255,255,255,0.9)')
        grad.addColorStop(0.5, 'rgba(255,255,255,0.35)')
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = grad
        g.beginPath()
        g.moveTo(0, 0)
        g.arc(0, 0, r, a - w, a + w)
        g.closePath()
        g.fill()
    }
    return c
}
