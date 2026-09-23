// Xeno Slot particle and screen effects on a Pixi container: spark and coin
// bursts, a coin fountain for big wins, expanding shockwave rings, lightning
// arcs and a decaying screen shake. Everything here is cosmetic, so
// Math.random() is fine. One pooled sprite list, updated from the app ticker.

import type { Container, Sprite, Texture, Graphics, Ticker } from 'pixi.js'

type PixiModule = typeof import('pixi.js')

interface Particle {
    sprite: Sprite
    vx: number
    vy: number
    gravity: number
    drag: number
    life: number
    age: number
    spin: number
    flip: number
    flipSpeed: number
    baseScale: number
    fade: boolean
    coin: boolean
}

interface Ring {
    g: Graphics
    age: number
    life: number
    radius: number
    color: number
    width: number
}

interface Bolt {
    g: Graphics
    age: number
    life: number
}

export interface XenoFxTextures {
    glow: Texture
    spark: Texture
    coins: Texture[]
}

export interface BurstOptions {
    count: number
    kind?: 'spark' | 'coin' | 'mix'
    speed?: number
    colors?: number[]
    gravity?: number
    life?: number
    scale?: number
    /** Emission cone around straight up, radians; defaults to a full circle. */
    cone?: number
}

const MAX_PARTICLES = 420

export class XenoFx {
    private readonly particles: Particle[] = []
    private readonly pool: Sprite[] = []
    private readonly rings: Ring[] = []
    private readonly bolts: Bolt[] = []
    private fountainRate = 0
    private fountainAcc = 0
    private shakeAmp = 0
    private shakeTime = 0
    private shakeTarget: Container | null = null
    private shakeBase = { x: 0, y: 0 }
    private readonly tick: (t: Ticker) => void

    constructor(
        private readonly PIXI: PixiModule,
        private readonly ticker: Ticker,
        private readonly layer: Container,
        private readonly tex: XenoFxTextures,
        private readonly width: number,
        private readonly height: number
    ) {
        this.tick = (t: Ticker) => this.update(Math.min(50, t.deltaMS) / 1000)
        ticker.add(this.tick)
    }

    private acquire(texture: Texture): Sprite {
        const sprite = this.pool.pop() ?? new this.PIXI.Sprite()
        sprite.texture = texture
        sprite.anchor.set(0.5)
        sprite.alpha = 1
        sprite.rotation = 0
        sprite.tint = 0xffffff
        sprite.visible = true
        sprite.blendMode = 'normal'
        this.layer.addChild(sprite)
        return sprite
    }

    private release(p: Particle) {
        p.sprite.visible = false
        this.layer.removeChild(p.sprite)
        this.pool.push(p.sprite)
    }

    burst(x: number, y: number, o: BurstOptions) {
        const kind = o.kind ?? 'spark'
        const speed = o.speed ?? 320
        const colors = o.colors ?? [0xffffff]
        const count = Math.min(o.count, MAX_PARTICLES - this.particles.length)
        for (let i = 0; i < count; i++) {
            const coin = kind === 'coin' || (kind === 'mix' && Math.random() < 0.45)
            const angle = o.cone !== undefined
                ? -Math.PI / 2 + (Math.random() - 0.5) * o.cone
                : Math.random() * Math.PI * 2
            const v = speed * (0.35 + Math.random() * 0.75)
            const texture = coin ? this.tex.coins[Math.floor(Math.random() * this.tex.coins.length)]! : this.tex.spark
            const sprite = this.acquire(texture)
            const baseScale = (o.scale ?? 1) * (coin ? 0.16 + Math.random() * 0.1 : 0.22 + Math.random() * 0.3)
            sprite.position.set(x, y)
            sprite.scale.set(baseScale)
            if (!coin) {
                sprite.tint = colors[Math.floor(Math.random() * colors.length)]!
                sprite.blendMode = 'add'
            }
            this.particles.push({
                sprite,
                vx: Math.cos(angle) * v,
                vy: Math.sin(angle) * v,
                gravity: o.gravity ?? (coin ? 900 : 260),
                drag: coin ? 0.4 : 1.6,
                life: (o.life ?? (coin ? 1.6 : 0.8)) * (0.7 + Math.random() * 0.5),
                age: 0,
                spin: (Math.random() - 0.5) * 8,
                flip: Math.random() * Math.PI * 2,
                flipSpeed: coin ? 6 + Math.random() * 8 : 0,
                baseScale,
                fade: true,
                coin
            })
        }
    }

    /** Coins per second shooting up from the bottom edge; 0 stops it. */
    fountain(rate: number) {
        this.fountainRate = rate
    }

    ring(x: number, y: number, color: number, radius = 160, life = 0.6, width = 6) {
        const g = new this.PIXI.Graphics()
        g.blendMode = 'add'
        g.position.set(x, y)
        this.layer.addChild(g)
        this.rings.push({ g, age: 0, life, radius, color, width })
    }

    /** Jagged electric arc between two points, fading over `life` seconds. */
    bolt(x0: number, y0: number, x1: number, y1: number, color: number, life = 0.35) {
        const g = new this.PIXI.Graphics()
        g.blendMode = 'add'
        const segs = 9
        const dx = x1 - x0
        const dy = y1 - y0
        const len = Math.hypot(dx, dy) || 1
        const nx = -dy / len
        const ny = dx / len
        const pts: [number, number][] = [[x0, y0]]
        for (let i = 1; i < segs; i++) {
            const t = i / segs
            const off = (Math.random() - 0.5) * Math.min(38, len * 0.22)
            pts.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off])
        }
        pts.push([x1, y1])
        for (const [w, a] of [[10, 0.25], [5, 0.6], [2, 1]] as const) {
            g.moveTo(pts[0]![0], pts[0]![1])
            for (const p of pts.slice(1)) g.lineTo(p[0], p[1])
            g.stroke({ color: w === 2 ? 0xffffff : color, width: w, alpha: a, cap: 'round', join: 'round' })
        }
        this.layer.addChild(g)
        this.bolts.push({ g, age: 0, life })
    }

    /** Shake `target` around its current position; stronger calls override weaker ones. */
    shake(target: Container, amplitude: number, duration = 0.45) {
        if (this.shakeTime > 0 && this.shakeTarget === target && amplitude < this.shakeAmp) return
        if (this.shakeTime <= 0) this.shakeBase = { x: target.x, y: target.y }
        this.shakeTarget = target
        this.shakeAmp = amplitude
        this.shakeTime = duration
    }

    private update(dt: number) {
        if (this.fountainRate > 0) {
            this.fountainAcc += dt * this.fountainRate
            while (this.fountainAcc >= 1) {
                this.fountainAcc -= 1
                const x = this.width * (0.15 + Math.random() * 0.7)
                this.burst(x, this.height + 20, { count: 1, kind: 'coin', speed: 900, cone: 0.5, gravity: 1100, life: 2.2, scale: 1.3 })
            }
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i]!
            p.age += dt
            if (p.age >= p.life) {
                this.release(p)
                this.particles.splice(i, 1)
                continue
            }
            const damp = Math.exp(-p.drag * dt)
            p.vx *= damp
            p.vy = p.vy * damp + p.gravity * dt
            p.sprite.x += p.vx * dt
            p.sprite.y += p.vy * dt
            const t = p.age / p.life
            if (p.coin) {
                p.flip += p.flipSpeed * dt
                p.sprite.scale.set(p.baseScale * Math.max(0.12, Math.abs(Math.cos(p.flip))), p.baseScale)
                p.sprite.alpha = t > 0.8 ? (1 - t) / 0.2 : 1
            } else {
                p.sprite.rotation += p.spin * dt
                p.sprite.scale.set(p.baseScale * (1 - t * 0.6))
                p.sprite.alpha = 1 - t * t
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
            r.g.circle(0, 0, 8 + r.radius * ease).stroke({ color: r.color, width: r.width * (1 - t) + 1, alpha: 1 - t })
        }

        for (let i = this.bolts.length - 1; i >= 0; i--) {
            const b = this.bolts[i]!
            b.age += dt
            const t = b.age / b.life
            if (t >= 1) {
                b.g.destroy()
                this.bolts.splice(i, 1)
                continue
            }
            b.g.alpha = t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85
        }

        if (this.shakeTarget && this.shakeTime > 0) {
            this.shakeTime -= dt
            const a = this.shakeAmp * Math.max(0, this.shakeTime) / 0.45
            if (this.shakeTime <= 0) {
                this.shakeTarget.position.set(this.shakeBase.x, this.shakeBase.y)
                this.shakeTarget = null
            } else {
                this.shakeTarget.position.set(this.shakeBase.x + (Math.random() - 0.5) * 2 * a, this.shakeBase.y + (Math.random() - 0.5) * 2 * a)
            }
        }
    }

    clear() {
        this.fountainRate = 0
        for (const p of this.particles.splice(0)) this.release(p)
        for (const r of this.rings.splice(0)) r.g.destroy()
        for (const b of this.bolts.splice(0)) b.g.destroy()
    }

    destroy() {
        this.ticker.remove(this.tick)
        this.clear()
        for (const s of this.pool.splice(0)) s.destroy()
    }
}
