// Pirate Raid cosmetic effects: cached glow sprites, a pooled particle system,
// floating combat text and camera shake. Nothing here touches the sim, and
// every random number is cosmetic, so Math.random is fine.
//
// Glow comes from cached radial sprites stamped additively (the SHAPEZZ
// approach), never from `shadowBlur`, which re-blurs every shape every frame.

const SPRITE_SIZE = 96

// ─── Colour helpers (the contract carries colours as 0xRRGGBB numbers) ─────

const cssCache = new Map<number, string>()

/** `#rrggbb` for a numeric colour. */
export function css(color: number) {
    let value = cssCache.get(color)
    if (!value) {
        value = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`
        cssCache.set(color, value)
    }
    return value
}

const rgbaCache = new Map<number, string>()

/** `rgba()` for a numeric colour at a quantised alpha, cached so hot loops don't build strings. */
export function rgba(color: number, alpha: number) {
    const quantised = Math.round(Math.max(0, Math.min(1, alpha)) * 40)
    const key = (color & 0xffffff) * 64 + quantised
    let value = rgbaCache.get(key)
    if (!value) {
        value = `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${quantised / 40})`
        rgbaCache.set(key, value)
    }
    return value
}

/** Blend toward white (amount > 0) or black (amount < 0). Done in sRGB, which is what reads right on screen. */
export function shade(color: number, amount: number) {
    const target = amount > 0 ? 255 : 0
    const t = Math.min(1, Math.abs(amount))
    const mixChannel = (channel: number) => Math.round(channel + (target - channel) * t)
    return (mixChannel((color >> 16) & 255) << 16) | (mixChannel((color >> 8) & 255) << 8) | mixChannel(color & 255)
}

/** Linear blend between two colours. */
export function mix(a: number, b: number, t: number) {
    const channel = (shift: number) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * t))
    return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

function makeCanvas(width: number, height = width) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
}

// ─── Sprites ────────────────────────────────────────────────────────────────

class PirateSprites {
    private glows = new Map<number, HTMLCanvasElement>()
    private cores = new Map<number, HTMLCanvasElement>()
    private smokes = new Map<number, HTMLCanvasElement>()
    private streaks = new Map<number, HTMLCanvasElement>()
    private foamSprite: HTMLCanvasElement | null = null

    /** Soft halo: transparent edge, coloured body. Drawn additively. */
    glow(color: number) {
        let sprite = this.glows.get(color)
        if (sprite) return sprite
        sprite = makeCanvas(SPRITE_SIZE)
        const ctx = sprite.getContext('2d')!
        const half = SPRITE_SIZE / 2
        const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
        gradient.addColorStop(0, rgba(color, 0.85))
        gradient.addColorStop(0.3, rgba(color, 0.45))
        gradient.addColorStop(0.65, rgba(color, 0.12))
        gradient.addColorStop(1, rgba(color, 0))
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
        this.glows.set(color, sprite)
        return sprite
    }

    /** Hot centre bleeding into the colour: muzzle flashes, fireballs, projectile cores. */
    core(color: number) {
        let sprite = this.cores.get(color)
        if (sprite) return sprite
        sprite = makeCanvas(SPRITE_SIZE)
        const ctx = sprite.getContext('2d')!
        const half = SPRITE_SIZE / 2
        const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
        gradient.addColorStop(0, 'rgba(255,255,255,1)')
        gradient.addColorStop(0.18, 'rgba(255,250,235,0.95)')
        gradient.addColorStop(0.34, rgba(color, 0.9))
        gradient.addColorStop(0.62, rgba(color, 0.25))
        gradient.addColorStop(1, rgba(color, 0))
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
        this.cores.set(color, sprite)
        return sprite
    }

    /** A soft puff for smoke and soot, drawn with normal compositing. Denser in the middle than a glow so it reads as a cloud, not a blur. */
    smoke(color = 0x2a2522) {
        let sprite = this.smokes.get(color)
        if (sprite) return sprite
        sprite = makeCanvas(SPRITE_SIZE)
        const ctx = sprite.getContext('2d')!
        const half = SPRITE_SIZE / 2
        const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
        gradient.addColorStop(0, rgba(color, 0.7))
        gradient.addColorStop(0.4, rgba(color, 0.5))
        gradient.addColorStop(0.75, rgba(color, 0.15))
        gradient.addColorStop(1, rgba(color, 0))
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
        this.smokes.set(color, sprite)
        return sprite
    }

    /** White sea foam with a soft broken edge. */
    foam() {
        if (this.foamSprite) return this.foamSprite
        const sprite = makeCanvas(SPRITE_SIZE)
        const ctx = sprite.getContext('2d')!
        const half = SPRITE_SIZE / 2
        const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
        gradient.addColorStop(0, 'rgba(255,255,255,0.75)')
        gradient.addColorStop(0.45, 'rgba(235,250,255,0.4)')
        gradient.addColorStop(1, 'rgba(220,245,255,0)')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE)
        this.foamSprite = sprite
        return sprite
    }

    /**
     * A tapered light streak, bright at the right end and fading to nothing at
     * the left, for projectile trails. Drawn additively along the direction of
     * travel with the bright end on the shot.
     */
    streak(color: number) {
        let sprite = this.streaks.get(color)
        if (sprite) return sprite
        sprite = makeCanvas(STREAK_W, STREAK_H)
        const ctx = sprite.getContext('2d')!
        const along = ctx.createLinearGradient(0, 0, STREAK_W, 0)
        along.addColorStop(0, rgba(color, 0))
        along.addColorStop(0.55, rgba(color, 0.35))
        along.addColorStop(0.88, rgba(color, 0.9))
        along.addColorStop(1, 'rgba(255,255,255,1)')
        ctx.fillStyle = along
        ctx.fillRect(0, 0, STREAK_W, STREAK_H)
        // Soft across, and tapering toward the tail.
        ctx.globalCompositeOperation = 'destination-in'
        const across = ctx.createLinearGradient(0, 0, 0, STREAK_H)
        across.addColorStop(0, 'rgba(0,0,0,0)')
        across.addColorStop(0.5, 'rgba(0,0,0,1)')
        across.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = across
        ctx.beginPath()
        ctx.moveTo(0, STREAK_H / 2)
        ctx.lineTo(STREAK_W, 0)
        ctx.lineTo(STREAK_W, STREAK_H)
        ctx.closePath()
        ctx.fill()
        this.streaks.set(color, sprite)
        return sprite
    }
}

const STREAK_W = 128
const STREAK_H = 32

let sharedSprites: PirateSprites | null = null

/** One sprite cache for the game and every preview canvas on the page. */
export function sprites() {
    sharedSprites ??= new PirateSprites()
    return sharedSprites
}

/**
 * Stamp a glow sprite at an absolute alpha, leaving globalAlpha as it found
 * it. The caller sets (and resets) globalCompositeOperation, usually 'lighter'.
 */
export function stampGlow(ctx: CanvasRenderingContext2D, color: number, x: number, y: number, radius: number, alpha: number, hot = false) {
    if (alpha <= 0.004 || radius <= 0) return
    const previous = ctx.globalAlpha
    ctx.globalAlpha = Math.min(1, alpha)
    ctx.drawImage(hot ? sprites().core(color) : sprites().glow(color), x - radius, y - radius, radius * 2, radius * 2)
    ctx.globalAlpha = previous
}

// ─── Easing and noise ───────────────────────────────────────────────────────

export function easeOutBack(t: number) {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export function easeOutCubic(t: number) {
    const inv = 1 - t
    return 1 - inv * inv * inv
}

export function clamp01(t: number) {
    return t < 0 ? 0 : t > 1 ? 1 : t
}

/** Deterministic value noise in [-1, 1], for smooth shake and wobble. */
export function smoothNoise(t: number, seed: number) {
    const i = Math.floor(t)
    const f = t - i
    const hash = (n: number) => {
        const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453
        return (x - Math.floor(x)) * 2 - 1
    }
    const u = f * f * (3 - 2 * f)
    return hash(i) * (1 - u) + hash(i + 1) * u
}

/** Small deterministic PRNG so seeded art (islands, scorch marks) never reshuffles. */
export function seededRandom(seed: number) {
    let state = (Math.floor(Math.abs(seed)) % 2147483646) + 1
    return () => {
        state = (state * 16807) % 2147483647
        return (state - 1) / 2147483646
    }
}

// ─── Particles ──────────────────────────────────────────────────────────────

export type ParticleKind =
    /** Additive glowing dot (sparks, embers, motes, plasma). */
    | 'glow'
    /** Additive dot with a white-hot centre. */
    | 'hot'
    /** Soft smoke puff, normal compositing, grows as it fades. */
    | 'smoke'
    /** White foam blob on the water, grows and fades. */
    | 'foam'
    /** Expanding ring (foam rings, shockwaves, ripples). */
    | 'ring'
    /** Spinning splinter of wood. */
    | 'debris'
    /** Airborne water droplet with gravity toward the water. */
    | 'droplet'
    /** Green plus sign for repairs. */
    | 'plus'
    /** Four-point twinkle. */
    | 'twinkle'
    /** Additive line along its velocity: a crisp hot spark rather than a soft dot. */
    | 'spark'

export interface Particle {
    kind: ParticleKind
    x: number
    y: number
    vx: number
    vy: number
    /** Height above the water for droplets and debris. */
    z: number
    vz: number
    life: number
    maxLife: number
    size: number
    /** Size multiplier reached at the end of life (1 = no growth). */
    grow: number
    color: number
    alpha: number
    rotation: number
    spin: number
    /** Velocity damping per second (0 = none). */
    drag: number
    /** Drawn beneath the ships (wakes, foam rings) or above them (smoke, sparks). */
    under: boolean
    /** Ring line width. */
    width: number
}

export interface ParticleInit {
    kind: ParticleKind
    x: number
    y: number
    vx?: number
    vy?: number
    z?: number
    vz?: number
    life: number
    size: number
    grow?: number
    color?: number
    alpha?: number
    rotation?: number
    spin?: number
    drag?: number
    under?: boolean
    width?: number
}

const MAX_PARTICLES = 2600

export class ParticleSystem {
    private items: Particle[] = []
    private pool: Particle[] = []
    /** 0.35..1 — the renderer lowers it when frames run long, and spawners scale their counts by it. */
    budget = 1

    get count() {
        return this.items.length
    }

    /** How many of `n` requested particles to actually spawn at the current budget. */
    scaled(n: number) {
        const value = n * this.budget
        const whole = Math.floor(value)
        return whole + (Math.random() < value - whole ? 1 : 0)
    }

    add(init: ParticleInit) {
        if (this.items.length >= MAX_PARTICLES * this.budget) return
        const p = this.pool.pop() ?? {} as Particle
        p.kind = init.kind
        p.x = init.x
        p.y = init.y
        p.vx = init.vx ?? 0
        p.vy = init.vy ?? 0
        p.z = init.z ?? 0
        p.vz = init.vz ?? 0
        p.life = init.life
        p.maxLife = init.life
        p.size = init.size
        p.grow = init.grow ?? 1
        p.color = init.color ?? 0xffffff
        p.alpha = init.alpha ?? 1
        p.rotation = init.rotation ?? Math.random() * Math.PI * 2
        p.spin = init.spin ?? 0
        p.drag = init.drag ?? 0
        p.under = init.under ?? false
        p.width = init.width ?? 2
        this.items.push(p)
    }

    clear() {
        for (const p of this.items) this.pool.push(p)
        this.items.length = 0
    }

    update(dt: number) {
        if (dt <= 0) return
        const items = this.items
        let write = 0
        for (let i = 0; i < items.length; i++) {
            const p = items[i]!
            p.life -= dt
            if (p.life <= 0) {
                this.pool.push(p)
                continue
            }
            if (p.drag > 0) {
                const damp = Math.max(0, 1 - p.drag * dt)
                p.vx *= damp
                p.vy *= damp
            }
            p.x += p.vx * dt
            p.y += p.vy * dt
            if (p.kind === 'droplet' || p.kind === 'debris') {
                p.vz -= 520 * dt
                p.z += p.vz * dt
                if (p.z < 0) {
                    p.z = 0
                    p.vz = 0
                    p.vx *= 0.5
                    p.vy *= 0.5
                }
            }
            p.rotation += p.spin * dt
            items[write++] = p
        }
        items.length = write
    }

    draw(ctx: CanvasRenderingContext2D, under: boolean, minLine: number) {
        const spriteCache = sprites()
        // Pass 1: normal compositing (smoke, foam, debris, droplets, rings, plus).
        for (const p of this.items) {
            if (p.under !== under) continue
            const t = 1 - p.life / p.maxLife
            const fade = p.life / p.maxLife
            const size = p.size * (1 + (p.grow - 1) * t)
            switch (p.kind) {
                case 'smoke': {
                    ctx.globalAlpha = p.alpha * fade * Math.min(1, t * 6)
                    ctx.drawImage(spriteCache.smoke(p.color), p.x - size, p.y - size, size * 2, size * 2)
                    break
                }
                case 'foam': {
                    ctx.globalAlpha = p.alpha * fade
                    ctx.drawImage(spriteCache.foam(), p.x - size, p.y - size, size * 2, size * 2)
                    break
                }
                case 'ring': {
                    ctx.globalAlpha = p.alpha * fade
                    ctx.strokeStyle = css(p.color)
                    ctx.lineWidth = Math.max(minLine, p.width * fade + 0.5)
                    ctx.beginPath()
                    ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
                    ctx.stroke()
                    break
                }
                case 'debris': {
                    ctx.globalAlpha = Math.min(1, fade * 2) * p.alpha
                    ctx.save()
                    ctx.translate(p.x, p.y - p.z)
                    ctx.rotate(p.rotation)
                    ctx.fillStyle = css(p.color)
                    ctx.fillRect(-size, -size * 0.32, size * 2, size * 0.64)
                    ctx.restore()
                    break
                }
                case 'droplet': {
                    ctx.globalAlpha = fade * p.alpha
                    ctx.fillStyle = css(p.color)
                    ctx.beginPath()
                    ctx.arc(p.x, p.y - p.z, size, 0, Math.PI * 2)
                    ctx.fill()
                    break
                }
                case 'plus': {
                    ctx.globalAlpha = fade * p.alpha
                    ctx.fillStyle = css(p.color)
                    const arm = size * 0.34
                    ctx.fillRect(p.x - size, p.y - arm, size * 2, arm * 2)
                    ctx.fillRect(p.x - arm, p.y - size, arm * 2, size * 2)
                    break
                }
                default:
                    break
            }
        }
        // Pass 2: additive light.
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        for (const p of this.items) {
            if (p.under !== under) continue
            if (p.kind !== 'glow' && p.kind !== 'hot' && p.kind !== 'twinkle' && p.kind !== 'spark') continue
            const t = 1 - p.life / p.maxLife
            const fade = p.life / p.maxLife
            const size = p.size * (1 + (p.grow - 1) * t)
            if (p.kind === 'spark') {
                // A short tail behind the spark along its velocity, white-hot at the head.
                const speed = Math.hypot(p.vx, p.vy)
                const tail = Math.min(size * 4, speed * 0.03)
                const tx = speed > 1 ? p.x - p.vx / speed * tail : p.x
                const ty = speed > 1 ? p.y - p.vy / speed * tail : p.y
                ctx.globalAlpha = p.alpha * Math.min(1, fade * 1.5)
                ctx.strokeStyle = css(p.color)
                ctx.lineWidth = Math.max(minLine, size * 0.55)
                ctx.beginPath()
                ctx.moveTo(tx, ty)
                ctx.lineTo(p.x, p.y)
                ctx.stroke()
                ctx.globalAlpha = p.alpha * fade * 0.7
                ctx.drawImage(spriteCache.core(p.color), p.x - size, p.y - size, size * 2, size * 2)
                continue
            }
            if (p.kind === 'twinkle') {
                const pulse = Math.sin(t * Math.PI)
                ctx.globalAlpha = p.alpha * pulse
                ctx.fillStyle = css(p.color)
                ctx.save()
                ctx.translate(p.x, p.y)
                ctx.rotate(p.rotation)
                ctx.beginPath()
                ctx.moveTo(0, -size)
                ctx.lineTo(size * 0.2, -size * 0.2)
                ctx.lineTo(size, 0)
                ctx.lineTo(size * 0.2, size * 0.2)
                ctx.lineTo(0, size)
                ctx.lineTo(-size * 0.2, size * 0.2)
                ctx.lineTo(-size, 0)
                ctx.lineTo(-size * 0.2, -size * 0.2)
                ctx.closePath()
                ctx.fill()
                ctx.restore()
                ctx.globalAlpha = p.alpha * pulse * 0.5
                ctx.drawImage(spriteCache.glow(p.color), p.x - size * 1.6, p.y - size * 1.6, size * 3.2, size * 3.2)
                continue
            }
            ctx.globalAlpha = p.alpha * fade
            ctx.drawImage(p.kind === 'hot' ? spriteCache.core(p.color) : spriteCache.glow(p.color), p.x - size, p.y - size, size * 2, size * 2)
        }
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
    }
}

// ─── Particle recipes ───────────────────────────────────────────────────────

function rand(min: number, max: number) {
    return min + Math.random() * (max - min)
}

export function spawnSparks(ps: ParticleSystem, x: number, y: number, color: number, count: number, speed = 220, size = 3.2) {
    for (let i = ps.scaled(count); i > 0; i--) {
        const a = Math.random() * Math.PI * 2
        const v = rand(0.35, 1) * speed
        ps.add({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.18, 0.42), size: rand(size * 0.6, size * 1.2), grow: 0.5, color, drag: 3.2 })
    }
}

export function spawnSmoke(ps: ParticleSystem, x: number, y: number, count: number, size = 14, color = 0x3a3330, drift = 26) {
    for (let i = ps.scaled(count); i > 0; i--) {
        const a = Math.random() * Math.PI * 2
        ps.add({
            kind: 'smoke', x: x + rand(-5, 5), y: y + rand(-5, 5),
            vx: Math.cos(a) * rand(4, drift), vy: Math.sin(a) * rand(4, drift) - rand(6, 16),
            life: rand(0.55, 1.1), size: rand(size * 0.6, size), grow: 2, color, alpha: rand(0.4, 0.6), drag: 1.6
        })
    }
}

export function spawnDebris(ps: ParticleSystem, x: number, y: number, count: number, color = 0x6b4424, speed = 160) {
    for (let i = ps.scaled(count); i > 0; i--) {
        const a = Math.random() * Math.PI * 2
        const v = rand(0.3, 1) * speed
        ps.add({
            kind: 'debris', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rand(120, 260),
            life: rand(0.7, 1.2), size: rand(2, 4), color: Math.random() < 0.3 ? shade(color, -0.35) : color, spin: rand(-12, 12), drag: 1.4
        })
    }
}

export function spawnSplash(ps: ParticleSystem, x: number, y: number, size: number) {
    ps.add({ kind: 'ring', x, y, life: 0.6, size: size * 0.4, grow: 3, color: 0xe0f7ff, alpha: 0.7, width: 2, under: true })
    ps.add({ kind: 'foam', x, y, life: 0.8, size: size * 0.8, grow: 1.7, alpha: 0.65, under: true })
    for (let i = ps.scaled(Math.round(5 + size * 0.25)); i > 0; i--) {
        const a = Math.random() * Math.PI * 2
        const v = rand(30, 90) * (size / 14)
        ps.add({ kind: 'droplet', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rand(90, 200), life: rand(0.35, 0.65), size: rand(1.2, 2.2), color: 0xe6f7ff, alpha: 0.9 })
    }
}

/**
 * A punchy blast: a white flash that is gone in a few frames, a fireball
 * that fades fast, a thin shockwave, crisp sparks, splinters and a little
 * smoke that clears quickly.
 */
export function spawnExplosion(ps: ParticleSystem, x: number, y: number, r: number, color: number, heavy: boolean) {
    const scale = r / 60
    const size = Math.max(0.7, scale)
    ps.add({ kind: 'hot', x, y, life: 0.1, size: r * 0.7, grow: 1.6, color: 0xffffff })
    ps.add({ kind: 'hot', x, y, life: heavy ? 0.32 : 0.24, size: r * 0.55, grow: 1.7, color })
    ps.add({ kind: 'glow', x, y, life: heavy ? 0.4 : 0.3, size: r * 1.3, grow: 1.2, color, alpha: 0.5 })
    ps.add({ kind: 'ring', x, y, life: 0.32, size: r * 0.25, grow: 3.6, color: shade(color, 0.6), alpha: 0.85, width: heavy ? 3 : 2 })
    for (let i = ps.scaled(heavy ? 6 : 3); i > 0; i--) {
        const a = Math.random() * Math.PI * 2
        const d = rand(0, r * 0.4)
        ps.add({ kind: 'hot', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50, life: rand(0.18, 0.36), size: rand(r * 0.2, r * 0.38), grow: 1.5, color: Math.random() < 0.5 ? color : 0xfb923c, drag: 2 })
    }
    spawnSparks(ps, x, y, 0xfde68a, heavy ? 18 : 9, 340 * size, 3)
    spawnSmoke(ps, x, y, heavy ? 6 : 3, 16 * size, 0x2b2522, 34)
    spawnDebris(ps, x, y, heavy ? 8 : 4, 0x6b4424, 220 * size)
    if (heavy) spawnSplash(ps, x, y, 22 * scale)
}

export function spawnMuzzle(ps: ParticleSystem, x: number, y: number, angle: number, color: number, size: number) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    ps.add({ kind: 'hot', x: x + cos * size * 2, y: y + sin * size * 2, vx: cos * 60, vy: sin * 60, life: 0.09, size: size * 3.6, grow: 1.4, color })
    ps.add({ kind: 'glow', x, y, life: 0.14, size: size * 5, grow: 0.8, color, alpha: 0.5 })
    for (let i = ps.scaled(2); i > 0; i--) {
        const spread = rand(-0.4, 0.4)
        const v = rand(40, 80)
        ps.add({ kind: 'smoke', x: x + cos * size * 3, y: y + sin * size * 3, vx: Math.cos(angle + spread) * v, vy: Math.sin(angle + spread) * v, life: rand(0.35, 0.6), size: size * rand(1.4, 2), grow: 2.2, color: 0x5c5650, alpha: 0.32, drag: 3 })
    }
    for (let i = ps.scaled(3); i > 0; i--) {
        const spread = rand(-0.3, 0.3)
        const v = rand(180, 320)
        ps.add({ kind: 'spark', x, y, vx: Math.cos(angle + spread) * v, vy: Math.sin(angle + spread) * v, life: rand(0.1, 0.2), size: 2, color: 0xfde68a, drag: 5 })
    }
}

export function spawnImpact(ps: ParticleSystem, x: number, y: number, color: number, heavy: boolean) {
    ps.add({ kind: 'hot', x, y, life: 0.08, size: heavy ? 18 : 12, grow: 1.5, color: 0xffffff })
    ps.add({ kind: 'hot', x, y, life: 0.16, size: heavy ? 22 : 14, grow: 1.3, color })
    spawnSparks(ps, x, y, color, heavy ? 12 : 6, heavy ? 280 : 200, 2.6)
    spawnDebris(ps, x, y, heavy ? 5 : 3, 0x7a4a24, 150)
    spawnSmoke(ps, x, y, heavy ? 2 : 1, 9, 0x3d3632, 18)
    if (heavy) ps.add({ kind: 'ring', x, y, life: 0.28, size: 8, grow: 4, color: shade(color, 0.5), alpha: 0.8, width: 2 })
}

export function spawnHeal(ps: ParticleSystem, x: number, y: number, amount: number) {
    const count = Math.min(10, 3 + Math.round(amount / 6))
    for (let i = ps.scaled(count); i > 0; i--) {
        ps.add({ kind: 'plus', x: x + rand(-26, 26), y: y + rand(-16, 16), vy: rand(-46, -24), life: rand(0.7, 1.1), size: rand(3, 5), color: 0x4ade80, drag: 0.8 })
    }
    ps.add({ kind: 'glow', x, y, life: 0.5, size: 50, color: 0x22c55e, alpha: 0.35 })
}

export function spawnBurst(ps: ParticleSystem, x: number, y: number, color: number, count: number) {
    ps.add({ kind: 'ring', x, y, life: 0.6, size: 12, grow: 5, color, alpha: 0.9, width: 3.5 })
    ps.add({ kind: 'glow', x, y, life: 0.45, size: 60, color, alpha: 0.6 })
    for (let i = ps.scaled(count); i > 0; i--) {
        const a = Math.random() * Math.PI * 2
        const v = rand(80, 240)
        ps.add({ kind: Math.random() < 0.3 ? 'twinkle' : 'glow', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.5, 1), size: rand(3, 6), color, drag: 2.6 })
    }
}

// ─── Skin trails ────────────────────────────────────────────────────────────
// The paid skins each leave a signature trail, one more lavish than the last.
// Emission scales with speed, so they're strongest under full sail and a
// gentle shimmer at anchor. The consort's spectral copy never calls this.

export interface TrailHull {
    /** Stern point in world space. */
    sternX: number
    sternY: number
    angle: number
    /** 0..1 speed factor. */
    speed: number
    length: number
    beam: number
    x: number
    y: number
}

export function emitSkinTrail(ps: ParticleSystem, skinId: string, hull: TrailHull, dt: number, time: number) {
    if (dt <= 0) return
    const back = hull.angle + Math.PI
    const side = hull.angle + Math.PI / 2
    const speed = hull.speed
    const rate = (perSecond: number) => {
        const expected = perSecond * dt * ps.budget
        return Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0)
    }
    const drift = (v: number) => ({ vx: Math.cos(back) * v + rand(-8, 8), vy: Math.sin(back) * v + rand(-8, 8) })

    if (skinId === 'crimson-privateer') {
        // Dark soot rolling off the stern, with faint red lantern embers.
        for (let i = rate(3 + speed * 12); i > 0; i--) {
            ps.add({ kind: 'smoke', x: hull.sternX + rand(-4, 4), y: hull.sternY + rand(-4, 4), ...drift(rand(8, 22)), life: rand(1, 1.8), size: rand(5, 8), grow: 2.4, color: 0x1c1917, alpha: 0.4, drag: 0.8 })
        }
        for (let i = rate(2 + speed * 6); i > 0; i--) {
            ps.add({ kind: 'glow', x: hull.sternX + rand(-4, 4), y: hull.sternY + rand(-4, 4), ...drift(rand(10, 30)), life: rand(0.5, 0.9), size: rand(1.6, 2.4), color: 0xef4444, drag: 1.2 })
        }
        return
    }

    if (skinId === 'emerald-serpent') {
        // Two jade mist ribbons that weave like a serpent's tail.
        for (let i = rate(10 + speed * 24); i > 0; i--) {
            const strand = Math.random() < 0.5 ? -1 : 1
            const weave = Math.sin(time * 5 + strand * 1.6) * hull.beam * 0.32 * strand
            ps.add({
                kind: 'glow',
                x: hull.sternX + Math.cos(side) * weave,
                y: hull.sternY + Math.sin(side) * weave,
                ...drift(rand(6, 16)),
                life: rand(0.8, 1.3), size: rand(3.5, 5.5), grow: 1.7, color: strand > 0 ? 0x34d399 : 0x10b981, alpha: 0.32, drag: 0.6
            })
        }
        for (let i = rate(0.8 + speed * 2.5); i > 0; i--) {
            ps.add({ kind: 'twinkle', x: hull.sternX + rand(-18, 18), y: hull.sternY + rand(-18, 18), life: rand(0.5, 0.9), size: rand(2, 3.2), color: 0x6ee7b7, alpha: 0.9, under: true })
        }
        return
    }

    if (skinId === 'royal-aether') {
        // Violet crystal smoke, sparkling wake and motes drifting off the rails.
        for (let i = rate(7 + speed * 20); i > 0; i--) {
            ps.add({ kind: 'glow', x: hull.sternX + rand(-6, 6), y: hull.sternY + rand(-6, 6), ...drift(rand(8, 20)), life: rand(0.9, 1.5), size: rand(4, 7), grow: 2, color: Math.random() < 0.6 ? 0x8b5cf6 : 0xc084fc, alpha: 0.3, drag: 0.7 })
        }
        for (let i = rate(3 + speed * 8); i > 0; i--) {
            const along = rand(-0.5, 0.5) * hull.length
            const across = (Math.random() < 0.5 ? -1 : 1) * hull.beam * 0.55
            ps.add({
                kind: 'twinkle',
                x: hull.x + Math.cos(hull.angle) * along + Math.cos(side) * across,
                y: hull.y + Math.sin(hull.angle) * along + Math.sin(side) * across,
                vx: Math.cos(side) * across * 0.4, vy: Math.sin(side) * across * 0.4,
                life: rand(0.6, 1), size: rand(2, 3.4), color: 0xe9d5ff, alpha: 0.9, drag: 1.5
            })
        }
        for (let i = rate(speed * 10); i > 0; i--) {
            ps.add({ kind: 'glow', x: hull.sternX + rand(-12, 12), y: hull.sternY + rand(-12, 12), life: rand(0.6, 1), size: rand(2, 3.4), color: 0xa78bfa, alpha: 0.8, under: true })
        }
        return
    }

    if (skinId === 'crown-of-tides') {
        // The flex: a golden sparkle stream over a glowing sapphire wake, with
        // gold glints tumbling off the hull like spilled coin.
        for (let i = rate(10 + speed * 28); i > 0; i--) {
            ps.add({ kind: 'glow', x: hull.sternX + rand(-6, 6), y: hull.sternY + rand(-6, 6), ...drift(rand(10, 26)), life: rand(0.6, 1.1), size: rand(2.4, 4), grow: 0.5, color: Math.random() < 0.7 ? 0xfacc15 : 0xfde68a, drag: 1 })
        }
        for (let i = rate(4 + speed * 14); i > 0; i--) {
            ps.add({ kind: 'glow', x: hull.sternX + rand(-10, 10), y: hull.sternY + rand(-10, 10), ...drift(rand(4, 10)), life: rand(0.9, 1.4), size: rand(6, 9), grow: 1.7, color: 0x3b82f6, alpha: 0.22, under: true, drag: 0.5 })
        }
        for (let i = rate(2 + speed * 6); i > 0; i--) {
            const a = Math.random() * Math.PI * 2
            ps.add({ kind: 'twinkle', x: hull.x + Math.cos(a) * hull.length * 0.5, y: hull.y + Math.sin(a) * hull.beam, vx: Math.cos(a) * 18, vy: Math.sin(a) * 18, life: rand(0.5, 0.9), size: rand(2.6, 4.2), color: 0xfef08a, alpha: 1, drag: 1 })
        }
    }
}

// ─── Lightning ──────────────────────────────────────────────────────────────

export interface Bolt {
    points: { x: number, y: number }[]
    color: number
    life: number
    maxLife: number
}

/** A jagged path through the given points, re-jittered so each flicker looks alive. */
export function jaggedBolt(points: { x: number, y: number }[]) {
    const out: { x: number, y: number }[] = []
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!
        const b = points[i + 1]!
        const length = Math.hypot(b.x - a.x, b.y - a.y)
        const steps = Math.max(2, Math.round(length / 22))
        const nx = -(b.y - a.y) / (length || 1)
        const ny = (b.x - a.x) / (length || 1)
        for (let s = 0; s < steps; s++) {
            const t = s / steps
            const offset = s === 0 ? 0 : rand(-1, 1) * Math.min(18, length * 0.12)
            out.push({ x: a.x + (b.x - a.x) * t + nx * offset, y: a.y + (b.y - a.y) * t + ny * offset })
        }
    }
    out.push(points[points.length - 1]!)
    return out
}

// ─── Floating combat text ───────────────────────────────────────────────────

export interface FloatingText {
    x: number
    y: number
    text: string
    color: number
    big: boolean
    age: number
    life: number
    lane: number
}

export class FloatingTexts {
    items: FloatingText[] = []

    add(x: number, y: number, text: string, color: number, big: boolean) {
        // Volleys land on the same hull within a few frames. Stack them into
        // lanes above each other instead of printing on the same pixel.
        let lane = 0
        for (const other of this.items) {
            if (other.age < 0.35 && Math.abs(other.x - x) < 46 && Math.abs(other.y - y) < 30) lane = Math.max(lane, other.lane + 1)
        }
        if (this.items.length > 70) this.items.shift()
        this.items.push({ x: x + (lane % 2 ? 10 : -4) * Math.min(1, lane), y, text, color, big, age: 0, life: big ? 1.3 : 0.9, lane: Math.min(lane, 5) })
    }

    update(dt: number) {
        if (dt <= 0) return
        let write = 0
        for (const item of this.items) {
            item.age += dt
            if (item.age < item.life) this.items[write++] = item
        }
        this.items.length = write
    }

    draw(ctx: CanvasRenderingContext2D) {
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.miterLimit = 2
        for (const item of this.items) {
            const t = item.age / item.life
            // Big hits punch in oversized and settle; small ones just pop up.
            const pop = item.big ? (t < 0.14 ? 0.5 + easeOutBack(t / 0.14) * 0.7 : 1.2 - Math.min(0.2, (t - 0.14) * 0.5)) : (t < 0.1 ? 0.6 + easeOutCubic(t / 0.1) * 0.4 : 1)
            const size = (item.big ? 22 : 15) * pop
            const rise = easeOutCubic(Math.min(1, t * 1.5)) * (item.big ? 36 : 28)
            const y = item.y - rise - item.lane * 16
            ctx.globalAlpha = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1
            ctx.font = `800 ${size.toFixed(1)}px "Trebuchet MS", "Segoe UI", ui-sans-serif, system-ui, sans-serif`
            // Soft drop shadow, dark outline, then the fill.
            ctx.lineWidth = size * 0.26
            ctx.strokeStyle = 'rgba(2,8,18,0.35)'
            ctx.strokeText(item.text, item.x + size * 0.06, y + size * 0.1)
            ctx.lineWidth = size * 0.2
            ctx.strokeStyle = 'rgba(6,10,20,0.92)'
            ctx.strokeText(item.text, item.x, y)
            ctx.fillStyle = css(item.color)
            ctx.fillText(item.text, item.x, y)
            if (item.big) {
                // A lighter top half sells the chunky game-font look.
                ctx.fillStyle = 'rgba(255,255,255,0.28)'
                ctx.save()
                ctx.beginPath()
                ctx.rect(item.x - size * 4, y - size * 0.6, size * 8, size * 0.5)
                ctx.clip()
                ctx.fillText(item.text, item.x, y)
                ctx.restore()
            }
        }
        ctx.globalAlpha = 1
    }
}

// ─── Camera shake ───────────────────────────────────────────────────────────

export class Shake {
    private trauma = 0
    private time = 0

    add(amount: number) {
        this.trauma = Math.min(1, this.trauma + amount / 22)
    }

    update(dt: number) {
        this.time += dt
        this.trauma = Math.max(0, this.trauma - dt * 1.6)
    }

    /** World offset for this frame; trauma squared keeps small hits subtle. */
    offset() {
        const power = this.trauma * this.trauma
        return {
            x: power * 16 * smoothNoise(this.time * 24, 1),
            y: power * 16 * smoothNoise(this.time * 24, 2)
        }
    }
}
