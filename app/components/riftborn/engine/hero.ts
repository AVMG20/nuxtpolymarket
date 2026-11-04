/*
 * The animated hero: each class's HeroArt parts are baked into the atlas
 * (plus a solid white copy for hit flashes and afterimages), then a small
 * rig of sprites animates them: walk cycle, bob and squash, idle breathing,
 * cape spring, head lag, lean, weapon swing / recoil, accent glow.
 * Purely cosmetic, so Math.random() would be fine here (none is needed).
 */
import { Container, Sprite } from 'pixi.js'
import type { Graphics, Texture } from 'pixi.js'
import type { RiftbornClassId } from '#shared/utils/gamelogic/riftborn'
import type { AtlasBaker } from './atlas'
import { HERO_ART_A } from './hero-art-a'
import { HERO_ART_B } from './hero-art-b'
import type { Col, HeroArt, HeroPart } from './hero-types'

export const HERO_ART: Record<RiftbornClassId, HeroArt> = { ...HERO_ART_A, ...HERO_ART_B }

type PartName = 'cape' | 'leg' | 'torso' | 'head' | 'weapon' | 'back'
const PARTS: PartName[] = ['cape', 'leg', 'torso', 'head', 'weapon', 'back']

/** Feet sit this far below the rig origin */
export const HERO_FEET = 24

function drawPose(g: Graphics, art: HeroArt, c: Col): void {
    const at = (part: HeroPart | undefined, x: number, y: number, rot: number, tint?: (n: number) => number) => {
        if (!part) return
        g.save()
        g.translateTransform(x, y)
        if (rot) g.rotateTransform(rot)
        part.draw(g, tint ?? c)
        g.restore()
    }
    const A = art.anchors
    at(art.cape, A.cape[0], A.cape[1], 0.15)
    if (art.back && A.back) at(art.back, A.back[0], A.back[1], 0)
    at(art.leg, A.legBack[0], A.legBack[1], -0.15)
    at(art.leg, A.legFront[0], A.legFront[1], 0.15)
    at(art.torso, 0, 0, 0)
    at(art.head, A.head[0], A.head[1], 0)
    at(art.weapon, A.hand[0], A.hand[1], art.rest)
}

/** Queue every hero's parts and composites into the atlas */
export function bakeHeroes(atlas: AtlasBaker): void {
    for (const id of Object.keys(HERO_ART) as RiftbornClassId[]) {
        const art = HERO_ART[id]
        for (const name of PARTS) {
            const part = art[name]
            if (!part) continue
            atlas.add(`hero.${id}.${name}`, part.w, part.h, g => part.draw(g, c => c))
            atlas.add(`hero.${id}.${name}.w`, part.w, part.h, g => part.draw(g, () => 0xffffff))
        }
        // Whole-body composites for afterimages and UI-ish uses
        atlas.add(`hero.${id}`, 104, 112, g => drawPose(g, art, c => c))
        atlas.add(`hero.${id}.w`, 104, 112, g => drawPose(g, art, () => 0xffffff))
    }
}

export interface RigState {
    moving: boolean
    /** Velocity in local facing space (x > 0 = forward), world units / s */
    vx: number
    vy: number
    /** Normaliser for vx (the move speed) */
    speed: number
    facing: number
    dashing: boolean
    /** 0..1, hit flash */
    hurt: number
    /** Aim angle in world space */
    aim: number
    /** 0..1 level-up glow */
    glow: number
    ultReady: boolean
    /** Glow colour for buffs (0 = none) */
    buffColor: number
    time: number
}

interface PartSprite {
    s: Sprite
    n: Texture
    w: Texture
    tint: number
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v
}

export class HeroRig {
    readonly root = new Container()
    private readonly body = new Container()
    private readonly weaponC = new Container()
    private readonly parts: Partial<Record<'cape' | 'back' | 'legB' | 'legF' | 'torso' | 'head' | 'weapon', PartSprite>> = {}
    private readonly accent: Sprite
    private readonly aura: Sprite
    private readonly art: HeroArt
    private phase = 0
    private walk = 0
    private capeAng = 0.15
    private capeVel = 0
    private lean = 0
    private bobS = 0
    private attackT = 0
    private attackDur = 0.25
    private swingDir = 1
    private aimLocal = 0
    private flashWhite = false

    constructor(atlas: AtlasBaker, readonly id: RiftbornClassId, private readonly color: number) {
        this.art = HERO_ART[id]
        const art = this.art
        const A = art.anchors
        const mk = (name: PartName, key: 'cape' | 'back' | 'legB' | 'legF' | 'torso' | 'head' | 'weapon', x: number, y: number, parent: Container, tint = 0xffffff) => {
            if (!art[name]) return
            const n = atlas.get(`hero.${id}.${name}`)
            const w = atlas.get(`hero.${id}.${name}.w`)
            const s = new Sprite(n)
            s.anchor.set(0.5)
            s.position.set(x, y)
            s.tint = tint
            parent.addChild(s)
            this.parts[key] = { s, n, w, tint }
        }
        this.aura = new Sprite(atlas.get('glow'))
        this.aura.anchor.set(0.5)
        this.aura.blendMode = 'add'
        this.aura.alpha = 0
        this.body.pivot.set(0, HERO_FEET)
        this.body.position.set(0, HERO_FEET)
        this.root.addChild(this.aura, this.body)
        mk('cape', 'cape', A.cape[0], A.cape[1], this.body)
        if (A.back) mk('back', 'back', A.back[0], A.back[1], this.body)
        mk('leg', 'legB', A.legBack[0], A.legBack[1], this.body, 0x9a96a8)
        mk('torso', 'torso', 0, 0, this.body)
        mk('leg', 'legF', A.legFront[0], A.legFront[1], this.body)
        mk('head', 'head', A.head[0], A.head[1], this.body)
        // Legs go behind the torso skirt: torso already sits between them
        this.weaponC.position.set(A.hand[0], A.hand[1])
        this.body.addChild(this.weaponC)
        mk('weapon', 'weapon', 0, 0, this.weaponC)
        this.accent = new Sprite(atlas.get('glow'))
        this.accent.anchor.set(0.5)
        this.accent.blendMode = 'add'
        this.accent.tint = art.accent.color
        if (art.accent.onWeapon) {
            this.accent.position.set(art.accent.x, art.accent.y)
            this.weaponC.addChild(this.accent)
        } else {
            this.accent.position.set(art.accent.x, art.accent.y)
            this.body.addChild(this.accent)
        }
        this.weaponC.rotation = art.rest
    }

    /** The class weapon fired toward `aim` (world angle) */
    attack(aim: number, facing: number): void {
        const m = this.art.motion
        this.attackDur = m === 'swing' ? 0.3 : m === 'reap' ? 0.34 : m === 'draw' ? 0.22 : 0.26
        this.attackT = 1
        this.swingDir = -this.swingDir
        this.aimLocal = this.local(aim, facing)
    }

    private local(aim: number, facing: number): number {
        const a = facing >= 0 ? aim : Math.PI - aim
        return Math.atan2(Math.sin(a), Math.cos(a))
    }

    update(dt: number, st: RigState): void {
        const art = this.art
        const A = art.anchors
        const t = st.time
        const speedFrac = clamp(Math.hypot(st.vx, st.vy) / Math.max(1, st.speed), 0, 1.6)
        const fwd = clamp(st.vx / Math.max(1, st.speed), -1, 1)
        this.walk += ((st.moving ? 1 : 0) - this.walk) * Math.min(1, dt * 10)
        if (st.moving) this.phase += dt * (8 + speedFrac * 4)
        const w = this.walk
        const sp = Math.sin(this.phase)
        const breath = Math.sin(t * 2.6)
        const bob = -Math.abs(sp) * 2.2 * w + breath * 0.5 * (1 - w)
        this.bobS += (bob - this.bobS) * Math.min(1, dt * 14)

        // Body: squash on each step, stretch on the dash, lean into the motion
        // Small squash as each foot lands
        const land = Math.max(0, Math.cos(this.phase * 2))
        let sx = 1 + land * 0.025 * w
        let sy = 1 - land * 0.035 * w + breath * 0.01 * (1 - w)
        if (st.dashing) {
            sx = 1.16
            sy = 0.86
        }
        // Upright: only the dash leans the body
        const leanT = st.dashing ? 0.16 : 0
        this.lean += (leanT - this.lean) * Math.min(1, dt * 10)
        this.body.scale.set(sx, sy)
        this.body.rotation = this.lean
        this.body.y = HERO_FEET + bob * 0.4

        const P = this.parts
        if (P.legF) {
            P.legF.s.rotation = sp * 0.45 * w
            P.legF.s.y = A.legFront[1] - Math.max(0, Math.cos(this.phase)) * 1.6 * w
        }
        if (P.legB) {
            P.legB.s.rotation = -sp * 0.45 * w
            P.legB.s.y = A.legBack[1] - Math.max(0, -Math.cos(this.phase)) * 1.6 * w
        }
        if (P.torso) {
            P.torso.s.y = this.bobS
            P.torso.s.scale.set(1 - breath * 0.01 * (1 - w), 1 + breath * 0.02 * (1 - w))
        }
        if (P.head) {
            P.head.s.y = A.head[1] + this.bobS * 1.1 + breath * 0.3
            P.head.s.rotation = 0
        }
        if (P.back) P.back.s.y = (A.back?.[1] ?? 0) + this.bobS * 0.9

        // Cape: a damped spring pushed back by forward motion and the dash
        const capeT = 0.12 + Math.max(0, fwd) * 0.55 * w + (st.dashing ? 0.9 : 0) + Math.sin(t * 3.1) * 0.05 + Math.sin(this.phase) * 0.06 * w - Math.min(0, fwd) * -0.2
        this.capeVel += (capeT - this.capeAng) * 90 * dt
        this.capeVel *= Math.exp(-dt * 9)
        this.capeAng += this.capeVel * dt
        if (P.cape) {
            P.cape.s.rotation = clamp(this.capeAng, -0.4, 1.3)
            P.cape.s.y = A.cape[1] + this.bobS * 0.9
            P.cape.s.scale.set(1 + Math.sin(t * 9) * 0.03 * (0.3 + w), 1 - Math.max(0, this.capeAng - 0.3) * 0.12)
        }

        // Weapon
        const aim = this.local(st.aim, st.facing)
        // The weapon only moves when attacking (bows and daggers track the aim)
        let rot = art.rest
        let ox = 0
        let oy = this.bobS * 0.8
        if (art.motion === 'draw') rot = clamp(aim, -1.2, 1.2)
        else if (art.motion === 'float') {
            rot = clamp(aim, -1.2, 1.2) * 0.7 + art.rest * 0.3
            oy += Math.sin(t * 3.4) * 1.2
        }
        if (this.attackT > 0) {
            this.attackT = Math.max(0, this.attackT - dt / this.attackDur)
            const k = 1 - this.attackT
            const target = clamp(this.aimLocal, -1.3, 1.3)
            switch (art.motion) {
                case 'swing':
                case 'reap': {
                    const arc = art.motion === 'reap' ? 3.3 : 2.7
                    const start = art.rest - 0.55
                    const end = art.rest + arc
                    let a: number
                    if (k < 0.18) a = art.rest + (start - art.rest) * (k / 0.18)
                    else if (k < 0.45) {
                        const u = (k - 0.18) / 0.27
                        a = start + (end - start) * (1 - (1 - u) * (1 - u))
                    } else {
                        const u = (k - 0.45) / 0.55
                        a = end + (art.rest - end) * (u * u * (3 - 2 * u))
                    }
                    rot = a + (target * 0.25)
                    ox = Math.sin(Math.min(1, k / 0.45) * Math.PI) * 4
                    break
                }
                case 'draw':
                    ox = -4 * Math.sin(k * Math.PI) * (1 - k * 0.5)
                    rot = target
                    break
                case 'cast': {
                    const u = Math.sin(k * Math.PI)
                    rot = rot + (target * 0.6 - 0.2 - rot) * u
                    ox = u * 4
                    break
                }
                case 'float':
                    ox = Math.sin(k * Math.PI) * 6
                    rot = rot + (target - rot) * Math.sin(k * Math.PI)
                    break
            }
        }
        this.weaponC.rotation = rot
        this.weaponC.position.set(A.hand[0] + ox, A.hand[1] + oy)

        // Hit flash and level-up flash swap to the white bakes
        const white = st.hurt > 0.15 || st.glow > 0.8
        const flashTint = st.hurt > 0.15 ? 0xff5a6a : 0xfff0b0
        if (white !== this.flashWhite || white) {
            this.flashWhite = white
            for (const k of Object.keys(P) as (keyof typeof P)[]) {
                const ps = P[k]!
                ps.s.texture = white ? ps.w : ps.n
                ps.s.tint = white ? flashTint : ps.tint
            }
        }

        // Accent and aura
        const pulse = 0.5 + 0.5 * Math.sin(t * (st.ultReady ? 7 : 3))
        const r = art.accent.r
        this.accent.scale.set(((r * (st.ultReady ? 5.5 : 3.6)) / 128) * (0.85 + pulse * 0.3))
        this.accent.alpha = st.ultReady ? 0.75 + pulse * 0.25 : 0.4 + pulse * 0.25
        const auraA = Math.max(st.glow * 0.9, st.buffColor ? 0.35 + pulse * 0.15 : 0)
        this.aura.visible = auraA > 0.01
        if (this.aura.visible) {
            this.aura.tint = st.glow > 0.05 ? 0xffd54f : st.buffColor || this.color
            this.aura.alpha = auraA
            this.aura.scale.set(1.0 + st.glow * 0.6)
        }
    }

    destroy(): void {
        this.root.destroy({ children: true })
    }
}
