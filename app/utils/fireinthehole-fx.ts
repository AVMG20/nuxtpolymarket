// Pixi particle effects for Fire in the Hole: dynamite blasts, rock crumble,
// wood splinters, dust, sparks, gem glints, coin fountains and the drifting
// embers of the mine. Particles are pooled sprites driven by the app ticker
// (no per-particle tweens), with textures painted once on a 2D canvas.
//
// All randomness here is cosmetic, so Math.random is fine.
import type { Application, Container, Sprite, Texture, Ticker } from 'pixi.js'

type Pixi = typeof import('pixi.js')

type TexId = 'glow' | 'star' | 'spark' | 'dust' | 'ring' | 'rock1' | 'rock2' | 'rock3' | 'splinter' | 'coin' | 'ember'

interface Particle {
    sprite: Sprite
    vx: number
    vy: number
    gravity: number
    drag: number
    spin: number
    age: number
    life: number
    alpha: number
    scaleFrom: number
    scaleTo: number
    /** Fraction of life spent fading in. */
    fadeIn: number
    /** Oscillation for embers. */
    sway: number
    phase: number
}

export interface FithEmitOptions {
    tex: TexId
    x: number
    y: number
    count: number
    speed: [number, number]
    life: [number, number]
    scale: [number, number]
    scaleEnd?: number
    tint?: number | number[]
    alpha?: number
    gravity?: number
    drag?: number
    spin?: number
    angle?: [number, number]
    spread?: number
    additive?: boolean
    fadeIn?: number
    sway?: number
}

const MAX_PARTICLES = 900

function rand(min: number, max: number) {
    return min + Math.random() * (max - min)
}

function pick<T>(items: T | T[]): T {
    return Array.isArray(items) ? items[Math.floor(Math.random() * items.length)]! : items
}

export class FithFx {
    private readonly textures = {} as Record<TexId, Texture>
    private readonly live: Particle[] = []
    private readonly pool: Sprite[] = []
    private readonly normalLayer: Container
    private readonly addLayer: Container
    private shakeTime = 0
    private shakeDuration = 0
    private shakeStrength = 0
    private emberTimer = 0
    private glintTimer = 0
    private readonly tick: (ticker: Ticker) => void
    /** Spawn rate multiplier for ambient embers (raised during free spins). */
    emberRate = 1
    /** Called every ~0.35s to place a twinkle; returns a point or null. */
    glintSource: (() => { x: number, y: number, size: number } | null) | null = null
    /** Area the embers drift up through. */
    bounds = { x: 0, y: 0, w: 100, h: 100 }

    constructor(private readonly pixi: Pixi, private readonly app: Application, parent: Container, private readonly world: Container) {
        this.normalLayer = new pixi.Container()
        this.addLayer = new pixi.Container()
        this.addLayer.blendMode = 'add'
        parent.addChild(this.normalLayer, this.addLayer)
        this.paintTextures()
        this.tick = ticker => this.update(ticker.deltaMS / 1000)
        app.ticker.add(this.tick)
    }

    private canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void, height = size): Texture {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        paint(ctx, size)
        return this.pixi.Texture.from(canvas)
    }

    private paintTextures() {
        const radial = (stops: [number, string][]) => (ctx: CanvasRenderingContext2D, size: number) => {
            const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
            for (const [at, color] of stops) g.addColorStop(at, color)
            ctx.fillStyle = g
            ctx.fillRect(0, 0, size, size)
        }
        this.textures.glow = this.canvasTexture(128, radial([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]))
        this.textures.ember = this.canvasTexture(32, radial([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]))
        this.textures.dust = this.canvasTexture(96, radial([[0, 'rgba(255,255,255,0.55)'], [0.5, 'rgba(255,255,255,0.28)'], [1, 'rgba(255,255,255,0)']]))
        this.textures.ring = this.canvasTexture(128, (ctx, size) => {
            const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size / 2)
            g.addColorStop(0, 'rgba(255,255,255,0)')
            g.addColorStop(0.7, 'rgba(255,255,255,0.9)')
            g.addColorStop(0.85, 'rgba(255,255,255,0.5)')
            g.addColorStop(1, 'rgba(255,255,255,0)')
            ctx.fillStyle = g
            ctx.fillRect(0, 0, size, size)
        })
        this.textures.star = this.canvasTexture(64, (ctx, size) => {
            const c = size / 2
            const glow = ctx.createRadialGradient(c, c, 0, c, c, c * 0.5)
            glow.addColorStop(0, 'rgba(255,255,255,1)')
            glow.addColorStop(1, 'rgba(255,255,255,0)')
            ctx.fillStyle = glow
            ctx.fillRect(0, 0, size, size)
            ctx.fillStyle = 'rgba(255,255,255,0.95)'
            for (const [w, h] of [[2.2, c], [c, 2.2]] as const) {
                ctx.beginPath()
                ctx.ellipse(c, c, w, h, 0, 0, Math.PI * 2)
                ctx.fill()
            }
        })
        this.textures.spark = this.canvasTexture(48, (ctx) => {
            const g = ctx.createLinearGradient(0, 0, 48, 0)
            g.addColorStop(0, 'rgba(255,255,255,0)')
            g.addColorStop(0.7, 'rgba(255,255,255,0.8)')
            g.addColorStop(1, 'rgba(255,255,255,1)')
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.ellipse(24, 6, 24, 3, 0, 0, Math.PI * 2)
            ctx.fill()
        }, 12)
        const rock = (points: [number, number][], base: string, light: string) => (ctx: CanvasRenderingContext2D, size: number) => {
            ctx.beginPath()
            points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x * size, y * size) : ctx.lineTo(x * size, y * size))
            ctx.closePath()
            ctx.fillStyle = base
            ctx.fill()
            ctx.strokeStyle = 'rgba(0,0,0,0.55)'
            ctx.lineWidth = 2
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(points[0]![0] * size, points[0]![1] * size)
            ctx.lineTo(points[1]![0] * size, points[1]![1] * size)
            ctx.lineTo(size / 2, size / 2)
            ctx.closePath()
            ctx.fillStyle = light
            ctx.fill()
        }
        // Rock chunks are painted light grey so a tint can recolour them per symbol.
        this.textures.rock1 = this.canvasTexture(32, rock([[0.2, 0.15], [0.75, 0.1], [0.92, 0.55], [0.6, 0.9], [0.12, 0.7]], '#c9c2b8', 'rgba(255,255,255,0.45)'))
        this.textures.rock2 = this.canvasTexture(32, rock([[0.35, 0.08], [0.9, 0.35], [0.78, 0.85], [0.2, 0.92], [0.06, 0.4]], '#bdb5aa', 'rgba(255,255,255,0.4)'))
        this.textures.rock3 = this.canvasTexture(32, rock([[0.1, 0.3], [0.55, 0.05], [0.95, 0.4], [0.5, 0.95]], '#d2cbc1', 'rgba(255,255,255,0.5)'))
        this.textures.splinter = this.canvasTexture(48, (ctx) => {
            ctx.fillStyle = '#8a5a2b'
            ctx.beginPath()
            ctx.moveTo(0, 5)
            ctx.lineTo(40, 1)
            ctx.lineTo(48, 6)
            ctx.lineTo(38, 11)
            ctx.lineTo(2, 9)
            ctx.closePath()
            ctx.fill()
            ctx.fillStyle = 'rgba(255,220,160,0.5)'
            ctx.fillRect(4, 4, 34, 2)
        }, 12)
        this.textures.coin = this.canvasTexture(40, (ctx, size) => {
            const c = size / 2
            const g = ctx.createRadialGradient(c * 0.7, c * 0.6, 1, c, c, c)
            g.addColorStop(0, '#fff7c2')
            g.addColorStop(0.45, '#f6c945')
            g.addColorStop(1, '#a8660c')
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.ellipse(c, c, c - 2, c - 2, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#7c4a06'
            ctx.lineWidth = 2
            ctx.stroke()
            ctx.strokeStyle = 'rgba(255,240,180,0.8)'
            ctx.beginPath()
            ctx.ellipse(c, c, c - 8, c - 8, 0, 0, Math.PI * 2)
            ctx.stroke()
        })
    }

    private acquire(tex: TexId, additive: boolean): Sprite | null {
        if (this.live.length >= MAX_PARTICLES) return null
        const sprite = this.pool.pop() ?? new this.pixi.Sprite()
        sprite.texture = this.textures[tex]
        sprite.anchor.set(0.5)
        sprite.rotation = 0
        sprite.visible = true
        ;(additive ? this.addLayer : this.normalLayer).addChild(sprite)
        return sprite
    }

    emit(o: FithEmitOptions) {
        const additive = o.additive ?? false
        for (let i = 0; i < o.count; i++) {
            const sprite = this.acquire(o.tex, additive)
            if (!sprite) return
            const [a0, a1] = o.angle ?? [0, Math.PI * 2]
            const angle = rand(a0, a1)
            const speed = rand(o.speed[0], o.speed[1])
            const spread = o.spread ?? 0
            sprite.position.set(o.x + rand(-spread, spread), o.y + rand(-spread, spread))
            sprite.tint = pick(o.tint ?? 0xffffff)
            const scaleFrom = rand(o.scale[0], o.scale[1])
            sprite.scale.set(scaleFrom)
            if (o.tex === 'spark') sprite.rotation = angle
            else if (o.spin) sprite.rotation = Math.random() * Math.PI * 2
            const alpha = o.alpha ?? 1
            sprite.alpha = o.fadeIn ? 0 : alpha
            this.live.push({
                sprite,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                gravity: o.gravity ?? 0,
                drag: o.drag ?? 0,
                spin: o.spin ? rand(-o.spin, o.spin) : 0,
                age: 0,
                life: rand(o.life[0], o.life[1]),
                alpha,
                scaleFrom,
                scaleTo: scaleFrom * (o.scaleEnd ?? 1),
                fadeIn: o.fadeIn ?? 0,
                sway: o.sway ?? 0,
                phase: Math.random() * Math.PI * 2
            })
        }
    }

    private update(dt: number) {
        const step = Math.min(dt, 0.05)
        for (let i = this.live.length - 1; i >= 0; i--) {
            const p = this.live[i]!
            p.age += step
            if (p.age >= p.life) {
                this.release(i)
                continue
            }
            const t = p.age / p.life
            if (p.drag) {
                const k = Math.max(0, 1 - p.drag * step)
                p.vx *= k
                p.vy *= k
            }
            p.vy += p.gravity * step
            const s = p.sprite
            s.x += (p.vx + (p.sway ? Math.sin(p.phase + p.age * 3) * p.sway : 0)) * step
            s.y += p.vy * step
            if (p.spin) s.rotation += p.spin * step
            else if (s.texture === this.textures.spark) s.rotation = Math.atan2(p.vy, p.vx)
            const scale = p.scaleFrom + (p.scaleTo - p.scaleFrom) * t
            s.scale.set(scale)
            const fade = p.fadeIn > 0 && t < p.fadeIn ? t / p.fadeIn : 1 - Math.max(0, (t - 0.55) / 0.45)
            s.alpha = p.alpha * Math.max(0, fade)
        }

        this.updateShake(step)
        this.updateAmbient(step)
    }

    private release(index: number) {
        const p = this.live[index]!
        const last = this.live.pop()!
        if (index < this.live.length) this.live[index] = last
        p.sprite.removeFromParent()
        p.sprite.visible = false
        this.pool.push(p.sprite)
    }

    private updateShake(dt: number) {
        if (this.shakeTime <= 0) return
        this.shakeTime = Math.max(0, this.shakeTime - dt)
        const k = this.shakeTime / this.shakeDuration
        const amp = this.shakeStrength * k * k
        this.world.position.set((Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp)
        if (this.shakeTime === 0) this.world.position.set(0, 0)
    }

    private updateAmbient(dt: number) {
        const b = this.bounds
        this.emberTimer -= dt * this.emberRate
        if (this.emberTimer <= 0) {
            this.emberTimer = 0.18 + Math.random() * 0.25
            this.emit({
                tex: 'ember',
                x: b.x + Math.random() * b.w,
                y: b.y + b.h + 6,
                count: 1,
                speed: [18, 46],
                angle: [-Math.PI * 0.62, -Math.PI * 0.38],
                life: [3, 6],
                scale: [0.12, 0.26],
                scaleEnd: 0.4,
                tint: [0xffb347, 0xff8a2a, 0xffd27a],
                alpha: 0.75,
                additive: true,
                fadeIn: 0.15,
                sway: 12
            })
        }
        this.glintTimer -= dt
        if (this.glintTimer <= 0 && this.glintSource) {
            this.glintTimer = 0.28 + Math.random() * 0.4
            const at = this.glintSource()
            if (at) this.glint(at.x, at.y, at.size)
        }
    }

    shake(strength: number, duration = 0.35) {
        // A stronger shake still ringing wins over a weaker new one.
        if (this.shakeTime > 0 && this.shakeStrength * (this.shakeTime / this.shakeDuration) ** 2 > strength) return
        this.shakeStrength = strength
        this.shakeDuration = duration
        this.shakeTime = duration
    }

    glint(x: number, y: number, size: number) {
        this.emit({ tex: 'star', x, y, count: 1, speed: [0, 0], life: [0.5, 0.7], scale: [size * 0.004, size * 0.006], scaleEnd: 0.1, spin: 2, alpha: 0.9, additive: true, fadeIn: 0.35 })
    }

    /** Flash + expanding ring, for impacts. */
    flash(x: number, y: number, radius: number, tint = 0xfff1c9, ring = true) {
        this.emit({ tex: 'glow', x, y, count: 1, speed: [0, 0], life: [0.22, 0.26], scale: [radius / 40, radius / 40], scaleEnd: 1.6, tint, alpha: 1, additive: true })
        if (ring) this.emit({ tex: 'ring', x, y, count: 1, speed: [0, 0], life: [0.45, 0.5], scale: [radius / 200, radius / 200], scaleEnd: 6, tint: 0xffa640, alpha: 0.9, additive: true })
    }

    /** Dynamite blast at a cell centre. `cell` is the cell size in pixels. */
    blast(x: number, y: number, cell: number) {
        const k = cell / 100
        this.flash(x, y, 70 * k)
        this.emit({ tex: 'glow', x, y, count: 3, speed: [10, 40], life: [0.35, 0.55], scale: [0.9 * k, 1.4 * k], scaleEnd: 1.8, tint: [0xff7a1a, 0xffb238], alpha: 0.9, additive: true, spread: 10 * k })
        this.emit({ tex: 'spark', x, y, count: 26, speed: [260 * k, 620 * k], life: [0.3, 0.6], scale: [0.5 * k, 1 * k], scaleEnd: 0.3, tint: [0xfff3c4, 0xffc94a, 0xff8a2a], gravity: 520 * k, drag: 2.2, additive: true })
        this.emit({ tex: 'ember', x, y, count: 16, speed: [80 * k, 260 * k], life: [0.5, 1.1], scale: [0.18 * k, 0.4 * k], scaleEnd: 0.2, tint: [0xffd27a, 0xff9933], gravity: 260 * k, drag: 1.5, additive: true })
        this.emit({ tex: 'rock1', x, y, count: 6, speed: [160 * k, 380 * k], life: [0.6, 0.9], scale: [0.35 * k, 0.7 * k], scaleEnd: 0.6, tint: [0x4a4038, 0x6b5d50, 0x2e2925], gravity: 900 * k, drag: 0.6, spin: 9 })
        this.emit({ tex: 'rock3', x, y, count: 5, speed: [160 * k, 380 * k], life: [0.6, 0.9], scale: [0.3 * k, 0.55 * k], scaleEnd: 0.6, tint: [0x4a4038, 0x6b5d50], gravity: 900 * k, drag: 0.6, spin: 9 })
        this.emit({ tex: 'dust', x, y, count: 8, speed: [30 * k, 110 * k], life: [0.9, 1.5], scale: [0.6 * k, 1 * k], scaleEnd: 2.6, tint: [0x3b332d, 0x524840, 0x2a2420], alpha: 0.55, drag: 1.8, gravity: -30 * k, spread: 12 * k })
    }

    /** Rock crumbling away where a winning symbol was. */
    crumble(x: number, y: number, cell: number, tint: number[]) {
        const k = cell / 100
        this.emit({ tex: 'rock1', x, y, count: 4, speed: [60 * k, 190 * k], angle: [-Math.PI, 0], life: [0.5, 0.8], scale: [0.35 * k, 0.6 * k], scaleEnd: 0.6, tint, gravity: 1000 * k, spin: 8, spread: 16 * k })
        this.emit({ tex: 'rock2', x, y, count: 4, speed: [60 * k, 190 * k], angle: [-Math.PI, 0], life: [0.5, 0.8], scale: [0.25 * k, 0.5 * k], scaleEnd: 0.6, tint, gravity: 1000 * k, spin: 8, spread: 16 * k })
        this.emit({ tex: 'dust', x, y, count: 3, speed: [10 * k, 40 * k], life: [0.6, 1], scale: [0.5 * k, 0.8 * k], scaleEnd: 2, tint: 0x6b6158, alpha: 0.45, drag: 2, gravity: -20 * k, spread: 14 * k })
        this.emit({ tex: 'star', x, y, count: 2, speed: [20 * k, 80 * k], life: [0.35, 0.55], scale: [0.35 * k, 0.55 * k], scaleEnd: 0.1, tint: tint[0], additive: true, spread: 18 * k, spin: 3 })
    }

    /** A plank snapping as a row is blasted open. */
    splinters(x0: number, x1: number, y: number, cell: number) {
        const k = cell / 100
        const steps = 6
        for (let i = 0; i <= steps; i++) {
            const x = x0 + (x1 - x0) * (i / steps)
            this.emit({ tex: 'splinter', x, y, count: 3, speed: [120 * k, 360 * k], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.7, 1.1], scale: [0.5 * k, 0.9 * k], scaleEnd: 0.7, gravity: 1100 * k, spin: 10, spread: 12 * k })
            this.emit({ tex: 'dust', x, y, count: 2, speed: [20 * k, 80 * k], life: [0.8, 1.4], scale: [0.7 * k, 1.1 * k], scaleEnd: 2.4, tint: [0x5c4a3a, 0x3d332b], alpha: 0.5, drag: 2, spread: 20 * k })
        }
        this.emit({ tex: 'ember', x: (x0 + x1) / 2, y, count: 24, speed: [100 * k, 380 * k], angle: [-Math.PI, 0], life: [0.5, 1], scale: [0.2 * k, 0.4 * k], scaleEnd: 0.2, tint: [0xffd27a, 0xff9933], gravity: 400 * k, additive: true, spread: (x1 - x0) / 2 })
    }

    /** Gold coins bursting up and falling back. */
    coinFountain(x: number, y: number, cell: number, count = 14) {
        const k = cell / 100
        this.emit({ tex: 'coin', x, y, count, speed: [220 * k, 520 * k], angle: [-Math.PI * 0.85, -Math.PI * 0.15], life: [0.8, 1.2], scale: [0.35 * k, 0.6 * k], scaleEnd: 0.8, gravity: 1100 * k, spin: 6 })
        this.emit({ tex: 'star', x, y, count: 6, speed: [40 * k, 160 * k], life: [0.4, 0.7], scale: [0.3 * k, 0.6 * k], scaleEnd: 0.1, tint: 0xffe28a, additive: true, spin: 3 })
    }

    /** Soft coloured sparkle burst (bonus drops, value hits). */
    sparkle(x: number, y: number, cell: number, tint: number | number[], count = 10) {
        const k = cell / 100
        this.emit({ tex: 'star', x, y, count, speed: [60 * k, 220 * k], life: [0.4, 0.8], scale: [0.25 * k, 0.55 * k], scaleEnd: 0.1, tint, additive: true, drag: 2.5, spin: 4 })
        this.emit({ tex: 'glow', x, y, count: 1, speed: [0, 0], life: [0.3, 0.35], scale: [0.7 * k, 0.7 * k], scaleEnd: 1.6, tint: Array.isArray(tint) ? tint[0] : tint, alpha: 0.8, additive: true })
    }

    /** Fuse sparks spitting from a point. */
    fuse(x: number, y: number, cell: number) {
        const k = cell / 100
        this.emit({ tex: 'spark', x, y, count: 10, speed: [80 * k, 240 * k], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.18, 0.35], scale: [0.25 * k, 0.45 * k], scaleEnd: 0.2, tint: [0xfff3c4, 0xffc94a], gravity: 600 * k, additive: true })
        this.emit({ tex: 'glow', x, y, count: 1, speed: [0, 0], life: [0.25, 0.3], scale: [0.35 * k, 0.35 * k], scaleEnd: 1.4, tint: 0xffb238, additive: true })
    }

    /** Dust settling as a column of rock lands. */
    landingDust(x: number, y: number, cell: number) {
        const k = cell / 100
        this.emit({ tex: 'dust', x, y, count: 3, speed: [30 * k, 90 * k], angle: [Math.PI * 0.85, Math.PI * 1.15], life: [0.5, 0.8], scale: [0.35 * k, 0.55 * k], scaleEnd: 1.8, tint: 0x6b6158, alpha: 0.3, drag: 3, spread: 6 * k })
        this.emit({ tex: 'dust', x, y, count: 3, speed: [30 * k, 90 * k], angle: [-Math.PI * 0.15, Math.PI * 0.15], life: [0.5, 0.8], scale: [0.35 * k, 0.55 * k], scaleEnd: 1.8, tint: 0x6b6158, alpha: 0.3, drag: 3, spread: 6 * k })
    }

    clear() {
        for (let i = this.live.length - 1; i >= 0; i--) this.release(i)
    }

    destroy() {
        this.app.ticker?.remove(this.tick)
        this.clear()
        for (const sprite of this.pool) sprite.destroy()
        this.pool.length = 0
        for (const tex of Object.values(this.textures)) tex.destroy(true)
        this.normalLayer.destroy({ children: true })
        this.addLayer.destroy({ children: true })
        this.world.position.set(0, 0)
    }
}
