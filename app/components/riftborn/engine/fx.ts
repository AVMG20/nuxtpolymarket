/*
 * Juice: pooled particles (ParticleContainer), transient sprites (rings,
 * slashes, pops, afterimages), lightning and beam strokes, damage numbers.
 * Purely cosmetic, so Math.random() is fine in here.
 */
import { BitmapText, Particle, Sprite } from 'pixi.js'
import type { Texture , Container, Graphics, ParticleContainer} from 'pixi.js'
import type { AtlasBaker } from './atlas'

export interface BurstOpts {
    count: number
    color: number
    speed?: number
    life?: number
    size?: number
    angle?: number
    spread?: number
    tex?: 'p.dot' | 'p.spark' | 'p.flame' | 'p.star' | 'p.shard' | 'p.smoke' | 'p.square' | 'p.ring'
    gravity?: number
    drag?: number
    /** Normal blend instead of additive */
    normal?: boolean
    /** Size multiplier at end of life */
    grow?: number
    /** Random offset radius around the origin */
    jitter?: number
    alpha?: number
}

interface Part {
    p: Particle
    vx: number
    vy: number
    life: number
    max: number
    s0: number
    s1: number
    a0: number
    drag: number
    grav: number
    spin: number
    stretch: boolean
}

interface SFx {
    s: Sprite
    life: number
    max: number
    vx: number
    vy: number
    s0x: number
    s0y: number
    s1x: number
    s1y: number
    a0: number
    a1: number
    vrot: number
    easeOut: boolean
    follow: { x: number, y: number } | null
    ox: number
    oy: number
}

interface Num {
    t: BitmapText
    life: number
    max: number
    vx: number
    vy: number
    scale: number
    pop: number
}

interface Decal {
    s: Sprite
    life: number
    max: number
    a0: number
    add: boolean
}

export type DecalKind = 'burn' | 'frost' | 'void' | 'blood' | 'crack' | 'splat'

interface Bolt {
    pts: number[]
    color: number
    width: number
    life: number
    max: number
}

export type NumKind = 'normal' | 'crit' | 'player' | 'heal' | 'burn' | 'big'

const NUM_COLORS: Record<NumKind, number> = {
    normal: 0xffffff,
    crit: 0xffd23a,
    player: 0xff4a5a,
    heal: 0x5dff8a,
    burn: 0xff9a3a,
    big: 0xff7a2a
}

export const DMG_FONT = 'RiftbornDmg'
export const TAG_FONT = 'RiftbornTag'

function fmt(v: number): string {
    if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M'
    if (v >= 1e4) return Math.round(v / 1e3) + 'k'
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k'
    return String(Math.max(1, Math.round(v)))
}

class PartPool {
    readonly parts: Part[] = []
    private readonly free: Particle[] = []
    private dirty = false
    constructor(readonly pc: ParticleContainer, readonly max: number) {}

    spawn(tex: Texture): Part {
        if (this.parts.length >= this.max) this.kill(0)
        const p = this.free.pop() ?? new Particle({ texture: tex, anchorX: 0.5, anchorY: 0.5 })
        p.texture = tex
        const part: Part = { p, vx: 0, vy: 0, life: 0, max: 1, s0: 1, s1: 0, a0: 1, drag: 0, grav: 0, spin: 0, stretch: false }
        this.parts.push(part)
        this.pc.particleChildren.push(p)
        this.dirty = true
        return part
    }

    kill(i: number): void {
        const last = this.parts.length - 1
        const children = this.pc.particleChildren
        this.free.push(this.parts[i]!.p)
        if (i !== last) {
            this.parts[i] = this.parts[last]!
            children[i] = children[last]!
        }
        this.parts.pop()
        children.pop()
        this.dirty = true
    }

    update(dt: number): void {
        const parts = this.parts
        for (let i = parts.length - 1; i >= 0; i--) {
            const q = parts[i]!
            q.life += dt
            if (q.life >= q.max) {
                this.kill(i)
                continue
            }
            const t = q.life / q.max
            if (q.drag) {
                const f = Math.exp(-q.drag * dt)
                q.vx *= f
                q.vy *= f
            }
            q.vy += q.grav * dt
            const p = q.p
            p.x += q.vx * dt
            p.y += q.vy * dt
            const s = q.s0 + (q.s1 - q.s0) * t
            if (q.stretch) {
                const sp = Math.hypot(q.vx, q.vy)
                p.rotation = Math.atan2(q.vy, q.vx)
                p.scaleX = s * Math.min(3, 0.6 + sp / 250)
                p.scaleY = s * 0.8
            } else {
                p.rotation += q.spin * dt
                p.scaleX = s
                p.scaleY = s
            }
            p.alpha = q.a0 * (t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85)
        }
        if (this.dirty) {
            this.pc.update()
            this.dirty = false
        }
    }

    clear(): void {
        while (this.parts.length) this.kill(this.parts.length - 1)
        this.pc.update()
    }
}

export class Fx {
    private readonly add: PartPool
    private readonly norm: PartPool
    private readonly sfxAdd: SFx[] = []
    private readonly sfxNorm: SFx[] = []
    private readonly freeAdd: Sprite[] = []
    private readonly freeNorm: Sprite[] = []
    private readonly nums: Num[] = []
    private readonly freeNums: BitmapText[] = []
    private readonly bolts: Bolt[] = []
    private readonly beams: number[] = []
    private readonly decals: Decal[] = []
    private readonly freeDecalN: Sprite[] = []
    private readonly freeDecalA: Sprite[] = []
    /** Lower this when the frame budget is tight (0..1) */
    quality = 1
    /** Decal cap, lowered when crowded */
    maxDecals = 110

    constructor(
        private readonly atlas: AtlasBaker,
        addPc: ParticleContainer,
        normPc: ParticleContainer,
        private readonly addLayer: Container,
        private readonly normLayer: Container,
        private readonly textLayer: Container,
        private readonly lines: Graphics,
        private readonly decalNorm: Container,
        private readonly decalAdd: Container
    ) {
        this.add = new PartPool(addPc, 3200)
        this.norm = new PartPool(normPc, 900)
    }

    get particleCount(): number {
        return this.add.parts.length + this.norm.parts.length
    }

    burst(x: number, y: number, o: BurstOpts): void {
        const tex = this.atlas.get(o.tex ?? 'p.dot')
        const pool = o.normal ? this.norm : this.add
        const load = pool.parts.length / pool.max
        const budget = load < 0.55 ? 1 : Math.max(0.25, 1 - (load - 0.55) * 1.7)
        const count = Math.max(1, Math.round(o.count * this.quality * budget))
        const speed = o.speed ?? 200
        const life = o.life ?? 0.5
        const size = (o.size ?? 4) / 12
        const spread = o.spread ?? Math.PI * 2
        const angle = o.angle ?? 0
        const stretch = o.tex === 'p.spark'
        for (let i = 0; i < count; i++) {
            const q = pool.spawn(tex)
            const a = o.spread === undefined && o.angle === undefined
                ? Math.random() * Math.PI * 2
                : angle + (Math.random() - 0.5) * spread
            const sp = speed * (0.35 + Math.random() * 0.65)
            q.vx = Math.cos(a) * sp
            q.vy = Math.sin(a) * sp
            const j = o.jitter ?? 0
            q.p.x = x + (j ? (Math.random() - 0.5) * 2 * j : 0)
            q.p.y = y + (j ? (Math.random() - 0.5) * 2 * j : 0)
            q.max = life * (0.6 + Math.random() * 0.6)
            q.s0 = size * (0.6 + Math.random() * 0.7)
            q.s1 = q.s0 * (o.grow ?? 0.1)
            q.a0 = o.alpha ?? 1
            q.drag = o.drag ?? 3
            q.grav = o.gravity ?? 0
            q.spin = (Math.random() - 0.5) * 8
            q.stretch = stretch
            q.p.tint = o.color
            q.p.rotation = Math.random() * 6.28
            q.p.alpha = q.a0
            q.p.scaleX = q.s0
            q.p.scaleY = q.s0
        }
    }

    /** A fading ground mark under the actors: scorches, cracks, splats. */
    scorch(x: number, y: number, r: number, color = 0x000000, life = 6, kind: DecalKind = 'burn', rot?: number): void {
        if (this.quality < 0.5 && Math.random() > this.quality) return
        const add = kind === 'frost' || kind === 'void'
        while (this.decals.length >= this.maxDecals) this.dropDecal(0)
        const free = add ? this.freeDecalA : this.freeDecalN
        let s = free.pop()
        const tex = this.atlas.get(kind === 'crack' ? 'decal.crack' : kind === 'blood' || kind === 'splat' ? 'splat' : 'scorch')
        if (!s) {
            s = new Sprite(tex)
            s.anchor.set(0.5)
            ;(add ? this.decalAdd : this.decalNorm).addChild(s)
        }
        s.texture = tex
        s.visible = true
        s.position.set(x, y)
        s.rotation = rot ?? Math.random() * 6.28
        const sc = (r * 2) / (tex.width || 1)
        s.scale.set(sc * (kind === 'crack' ? 1.2 : 1), sc * (kind === 'crack' ? 0.9 : 0.8))
        s.tint = kind === 'burn' ? 0x060308 : color
        const a0 = kind === 'burn' ? 0.45 : kind === 'void' ? 0.35 : kind === 'frost' ? 0.3 : kind === 'crack' ? 0.75 : 0.5
        s.alpha = a0
        this.decals.push({ s, life: 0, max: life, a0, add })
    }

    private dropDecal(i: number): void {
        const d = this.decals[i]!
        d.s.visible = false
        ;(d.add ? this.freeDecalA : this.freeDecalN).push(d.s)
        this.decals.splice(i, 1)
    }

    /** A quick starburst for heavy hits */
    impact(x: number, y: number, size: number, color: number): void {
        this.sprite('impact', x, y, { life: 0.14, color, size0: size * 0.6, size1: size * 1.4, a0: 1, a1: 0, rot: Math.random() * 6.28 })
    }

    /** One particle with exact parameters (trails, embers). */
    one(x: number, y: number, tex: BurstOpts['tex'], color: number, vx: number, vy: number, life: number, size: number, opts?: { normal?: boolean, grow?: number, grav?: number, drag?: number, alpha?: number }): void {
        if (this.quality < 1 && Math.random() > this.quality) return
        const pool = opts?.normal ? this.norm : this.add
        const q = pool.spawn(this.atlas.get(tex ?? 'p.dot'))
        q.p.x = x
        q.p.y = y
        q.vx = vx
        q.vy = vy
        q.max = life
        q.s0 = size / 12
        q.s1 = q.s0 * (opts?.grow ?? 0.2)
        q.a0 = opts?.alpha ?? 1
        q.drag = opts?.drag ?? 1
        q.grav = opts?.grav ?? 0
        q.spin = (Math.random() - 0.5) * 4
        q.stretch = tex === 'p.spark'
        q.p.tint = color
        q.p.alpha = q.a0
        q.p.rotation = Math.random() * 6.28
        q.p.scaleX = q.s0
        q.p.scaleY = q.s0
    }

    /**
     * A transient sprite: scale from s0 to s1 and alpha from a0 to a1 over
     * life seconds. Sizes are in world units of the texture's width.
     */
    sprite(texKey: string, x: number, y: number, o: {
        life: number
        color?: number
        size0: number
        size1: number
        a0?: number
        a1?: number
        rot?: number
        vrot?: number
        vx?: number
        vy?: number
        normal?: boolean
        easeOut?: boolean
        aspect?: number
        flip?: boolean
        follow?: { x: number, y: number } | null
    }): Sprite {
        const list = o.normal ? this.sfxNorm : this.sfxAdd
        const free = o.normal ? this.freeNorm : this.freeAdd
        const layer = o.normal ? this.normLayer : this.addLayer
        if (list.length > 400) {
            const old = list.shift()!
            old.s.visible = false
            free.push(old.s)
        }
        const tex = this.atlas.get(texKey)
        let s = free.pop()
        if (!s) {
            s = new Sprite(tex)
            s.anchor.set(0.5)
            layer.addChild(s)
        }
        s.texture = tex
        s.visible = true
        s.tint = o.color ?? 0xffffff
        s.rotation = o.rot ?? 0
        s.position.set(x, y)
        const w = tex.width || 1
        const aspect = o.aspect ?? 1
        const fl = o.flip ? -1 : 1
        const fx: SFx = {
            s,
            life: 0,
            max: o.life,
            vx: o.vx ?? 0,
            vy: o.vy ?? 0,
            s0x: (o.size0 / w) * fl,
            s0y: (o.size0 / w) * aspect,
            s1x: (o.size1 / w) * fl,
            s1y: (o.size1 / w) * aspect,
            a0: o.a0 ?? 1,
            a1: o.a1 ?? 0,
            vrot: o.vrot ?? 0,
            easeOut: o.easeOut ?? true,
            follow: o.follow ?? null,
            ox: 0,
            oy: 0
        }
        if (fx.follow) {
            fx.ox = x - fx.follow.x
            fx.oy = y - fx.follow.y
        }
        s.scale.set(fx.s0x, fx.s0y)
        s.alpha = fx.a0
        list.push(fx)
        return s
    }

    ring(x: number, y: number, color: number, r0: number, r1: number, life: number, alpha = 1, soft = false): void {
        this.sprite(soft ? 'ringSoft' : 'ring', x, y, { life, color, size0: r0 * 2.15, size1: r1 * 2.15, a0: alpha, a1: 0 })
    }

    /** Token bucket for plain damage numbers (about 55 a second), so crowds stay readable */
    private numBudget = 20

    number(x: number, y: number, value: number, kind: NumKind = 'normal'): void {
        if (kind === 'normal' || kind === 'burn') {
            if (this.numBudget < 1) return
            this.numBudget--
        }
        if (this.nums.length > 160) {
            const old = this.nums.shift()!
            old.t.visible = false
            this.freeNums.push(old.t)
        }
        let t = this.freeNums.pop()
        if (!t) {
            t = new BitmapText({ text: '0', style: { fontFamily: DMG_FONT, fontSize: 24 } })
            t.anchor.set(0.5)
            this.textLayer.addChild(t)
        }
        t.visible = true
        t.text = kind === 'heal' ? '+' + fmt(value) : kind === 'crit' ? fmt(value) + '!' : fmt(value)
        t.tint = NUM_COLORS[kind]
        t.position.set(x + (Math.random() - 0.5) * 14, y)
        t.alpha = 1
        const crit = kind === 'crit' || kind === 'big'
        const scale = crit ? 1.25 + Math.min(0.9, Math.log10(Math.max(1, value)) * 0.12) : kind === 'burn' ? 0.62 : kind === 'player' ? 0.95 : 0.78
        t.scale.set(scale * (crit ? 1.9 : 1.3))
        this.nums.push({
            t,
            life: 0,
            max: crit ? 0.9 : 0.65,
            vx: (Math.random() - 0.5) * 40,
            vy: crit ? -120 : -80,
            scale,
            pop: crit ? 1.9 : 1.3
        })
    }

    lightning(x1: number, y1: number, x2: number, y2: number, color: number, width = 3, life = 0.18, jag = 1): void {
        const dx = x2 - x1
        const dy = y2 - y1
        const len = Math.hypot(dx, dy) || 1
        const nx = -dy / len
        const ny = dx / len
        const segs = Math.max(3, Math.min(16, Math.round(len / 22)))
        const pts: number[] = [x1, y1]
        for (let i = 1; i < segs; i++) {
            const t = i / segs
            const off = (Math.random() - 0.5) * Math.min(38, len * 0.18) * jag
            pts.push(x1 + dx * t + nx * off, y1 + dy * t + ny * off)
        }
        pts.push(x2, y2)
        this.bolts.push({ pts, color, width, life, max: life })
    }

    /** A beam drawn until the next clearBeams() (lasers re-add every sim step). */
    beam(x1: number, y1: number, x2: number, y2: number, color: number, width: number): void {
        this.beams.push(x1, y1, x2, y2, color, width)
    }

    clearBeams(): void {
        this.beams.length = 0
    }

    update(dt: number): void {
        this.numBudget = Math.min(20, this.numBudget + dt * 55)
        for (let i = this.decals.length - 1; i >= 0; i--) {
            const d = this.decals[i]!
            d.life += dt
            if (d.life >= d.max) {
                this.dropDecal(i)
                continue
            }
            const t = d.life / d.max
            if (t > 0.6) d.s.alpha = d.a0 * (1 - (t - 0.6) / 0.4)
        }
        this.add.update(dt)
        this.norm.update(dt)
        this.updateSprites(this.sfxAdd, this.freeAdd, dt)
        this.updateSprites(this.sfxNorm, this.freeNorm, dt)

        for (let i = this.nums.length - 1; i >= 0; i--) {
            const n = this.nums[i]!
            n.life += dt
            if (n.life >= n.max) {
                n.t.visible = false
                this.freeNums.push(n.t)
                this.nums.splice(i, 1)
                continue
            }
            const t = n.life / n.max
            n.vy += 160 * dt
            n.t.x += n.vx * dt
            n.t.y += n.vy * dt
            const pop = t < 0.12 ? n.pop - (n.pop - 1) * (t / 0.12) : 1
            n.t.scale.set(n.scale * pop)
            n.t.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4
        }

        const g = this.lines
        g.clear()
        for (let i = this.bolts.length - 1; i >= 0; i--) {
            const b = this.bolts[i]!
            b.life -= dt
            if (b.life <= 0) {
                this.bolts.splice(i, 1)
                continue
            }
            const a = b.life / b.max
            const pts = b.pts
            g.moveTo(pts[0]!, pts[1]!)
            for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k]!, pts[k + 1]!)
            g.stroke({ width: b.width * 4, color: b.color, alpha: 0.22 * a, cap: 'round', join: 'round' })
            g.moveTo(pts[0]!, pts[1]!)
            for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k]!, pts[k + 1]!)
            g.stroke({ width: b.width, color: 0xffffff, alpha: a, cap: 'round', join: 'round' })
        }
        const bm = this.beams
        for (let i = 0; i < bm.length; i += 6) {
            const x1 = bm[i]!
            const y1 = bm[i + 1]!
            const x2 = bm[i + 2]!
            const y2 = bm[i + 3]!
            const col = bm[i + 4]!
            const w = bm[i + 5]!
            g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: w * 2.4, color: col, alpha: 0.18, cap: 'round' })
            g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: w, color: col, alpha: 0.65, cap: 'round' })
            g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: Math.max(1.5, w * 0.35), color: 0xffffff, alpha: 1, cap: 'round' })
        }
    }

    private updateSprites(list: SFx[], free: Sprite[], dt: number): void {
        for (let i = list.length - 1; i >= 0; i--) {
            const f = list[i]!
            f.life += dt
            if (f.life >= f.max) {
                f.s.visible = false
                free.push(f.s)
                list.splice(i, 1)
                continue
            }
            let t = f.life / f.max
            if (f.easeOut) t = 1 - (1 - t) * (1 - t)
            if (f.follow) {
                f.s.x = f.follow.x + f.ox
                f.s.y = f.follow.y + f.oy
            } else {
                f.s.x += f.vx * dt
                f.s.y += f.vy * dt
            }
            f.s.rotation += f.vrot * dt
            f.s.scale.set(f.s0x + (f.s1x - f.s0x) * t, f.s0y + (f.s1y - f.s0y) * t)
            f.s.alpha = f.a0 + (f.a1 - f.a0) * (f.life / f.max)
        }
    }

    clear(): void {
        this.add.clear()
        this.norm.clear()
        for (const f of this.sfxAdd) f.s.visible = false
        for (const f of this.sfxNorm) f.s.visible = false
        this.sfxAdd.length = 0
        this.sfxNorm.length = 0
        this.bolts.length = 0
        this.beams.length = 0
        while (this.decals.length) this.dropDecal(this.decals.length - 1)
    }
}
