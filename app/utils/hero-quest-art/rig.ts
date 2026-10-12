// The humanoid rig: a small skeleton of pose parameters drawn as filled rects and 2px limbs,
// Pixel Crusade's hero construction generalised so that a Look (outfit, head, weapon) can
// ride it. The Hero, the Champion chassis and the trash-enemy rigs all use it; what makes
// each one bespoke is its Look and its keyframes, not a different skeleton.
//
// Drawn facing right with the feet at the surface anchor. Enemies are mirrored at stamp time.

import { ANIM_FPS, compileClip, paramIndex, restPose, sample, type Clip, type KeySpec } from './anim'
import { C, CLEAR } from './palette'
import { Surface, StampStyle, line, px, rect, rotate90, stamp, ditherEllipse } from './surface'
import type { Mat } from './weapons'

export const HP = paramIndex([
    'lean', 'crouch', 'jump', // body offset: +lean forward, +crouch down, −jump up
    'hx', 'hy', 'wa', // front hand, relative to the front shoulder; weapon angle
    'bhx', 'bhy', 'ba', // back hand, relative to the back shoulder; back item angle
    'ffx', 'ffy', 'bfx', 'bfy', // feet: x from the anchor, y = lift
    'headX', 'headY', // head offset (nods, roars, slumps)
    'glow', // 0..1 accent intensity (gems, eyes, auras)
    'aux', // per-look extra (bow pull, cape flare, jaw)
    'flip', // > 0.5 draws mirrored (spins)
    'fall', // > 0.5 lies rotated on the floor
    'fade', // 0..16 dissolve
    'flash', // > 0.5 hit-flash frame
    'kneel', // 0..1 back knee drops
    'mouth', // 0..1 mouth open
    'tilt', // torso top shift in px (hunch forward +, arch back −)
    'fxk', // which scene effect this frame shows (a Look's fx reads it: smear, release…)
    'fxa' // effect parameter — a smear's start angle, a streak's length
] as const)

export type HPName = keyof typeof HP
export const HP_COUNT = Object.keys(HP).length

/** Standing rest pose: weapon hand at the hip, feet apart. */
export const REST: Float32Array = restPose(HP, {
    hx: 3, hy: 7, wa: -1.05, bhx: -1, bhy: 7, ba: 0, ffx: 2, bfx: -3
})

export type Painter = (s: Surface, x: number, y: number, p: Float32Array, t: number) => void

export interface Look {
    skin: Mat
    pants: number
    pantsDk: number
    boot: number
    bootHi: number
    /** Upper and lower arm colours, front then back, and the hand. */
    arm: number
    armLow: number
    armBack: number
    armBackLow: number
    hand: number
    /** Torso, drawn with (x, y) = body centre at the shoulder line. */
    torso: Painter
    /** Head, drawn with (x, y) = neck. */
    head: Painter
    /** Front-hand item, drawn with (x, y) = hand. Angle is p[HP.wa]. */
    weapon?: Painter
    /** Back-hand item, drawn behind the body. Angle is p[HP.ba]. */
    offhand?: Painter
    /** Drawn first, behind everything, at the shoulder line (capes, quivers, wings). */
    back?: Painter
    /** Drawn last (beards over arms, auras over the body), at the shoulder line. */
    over?: Painter
    /**
     * Scene-space effects drawn after the sprite is stamped, with no outline — weapon smears,
     * muzzle flashes, steam. Joint positions in `J` are sprite-local: convert with `fxX`/`fxY`.
     */
    fx?: (dst: Surface, p: Float32Array, t: number) => void
    /** Replaces the legs, drawn at (x, hipY) — robes, tails, tentacles. */
    lower?: Painter
    /** Draw the back arm in front of the torso (two-handed grips). */
    backArmFront?: boolean
    /**
     * Replaces the whole humanoid construction (the chibi body in chibi.ts). It must resolve
     * `J` the same way, so `fx` painters and the VFX layer keep working.
     */
    body?: (s: Surface, L: Look, p: Float32Array, t: number) => void
    /** Proportions. Pixel Crusade's hero is 8 and 9. */
    legLen?: number
    torsoLen?: number
    accent: number
}

/** Resolved joint positions of the pose being drawn — read by painters and the VFX layer. */
export const J = {
    ox: 0, oy: 0, bx: 0, hipY: 0, topY: 0,
    headX: 0, headY: 0,
    fsx: 0, fsy: 0, bsx: 0, bsy: 0,
    hx: 0, hy: 0, bhx: 0, bhy: 0,
    ffx: 0, ffy: 0, bfx: 0, bfy: 0,
    torsoLen: 9
}

const R = Math.round

/** Sprite-local → scene transform of the actor being drawn, for Look.fx. */
export const FX = { ox: 0, oy: 0, ax: 0, flip: false }
export function fxX(x: number): number { return FX.flip ? FX.ox + FX.ax - (x - FX.ax) : FX.ox + x }
export function fxY(y: number): number { return FX.oy + y }
/** Mirror an angle when the actor is flipped. */
export function fxA(a: number): number { return FX.flip ? Math.PI - a : a }

function limb(s: Surface, x0: number, y0: number, x1: number, y1: number, c: number, low: number): void {
    const mx = R((x0 + x1) / 2)
    const my = R((y0 + y1) / 2)
    line(s, x0, y0, mx, my, c, 2)
    line(s, mx, my, x1, y1, low, 2)
}

function legs(s: Surface, L: Look, p: Float32Array): void {
    const kneel = p[HP.kneel]!
    // back leg
    if (kneel > 0.4) {
        const kx = J.bx - 2
        const ky = J.oy - 2
        line(s, J.bx - 1, J.hipY, kx, ky, L.pantsDk, 2)
        line(s, kx, ky, kx - 5, J.oy - 1, L.pantsDk, 2)
        rect(s, kx - 7, J.oy - 2, 3, 2, L.boot)
    } else {
        line(s, J.bx - 1, J.hipY, J.bfx, J.bfy - 2, L.pantsDk, 2)
        rect(s, J.bfx - 1, J.bfy - 2, 3, 2, L.boot)
    }
    // front leg: a knee when the foot is far forward or the body is low
    const kneeX = R((J.bx + 1 + J.ffx) / 2 + (kneel > 0.4 ? 2 : 0))
    const kneeY = R((J.hipY + J.ffy) / 2 - (kneel > 0.4 ? 1 : 0))
    line(s, J.bx + 1, J.hipY, kneeX, kneeY, L.pants, 2)
    line(s, kneeX, kneeY, J.ffx, J.ffy - 2, L.pants, 2)
    rect(s, J.ffx - 1, J.ffy - 2, 4, 2, L.boot)
    px(s, J.ffx, J.ffy - 2, L.bootHi)
}

/**
 * Draw a Look in pose `p` into `s`, feet at the anchor. The caller clears `s` first and stamps
 * it afterwards (see `Actor`).
 */
export function drawHumanoid(s: Surface, L: Look, p: Float32Array, t: number): void {
    if (L.body) { L.body(s, L, p, t); return }
    const legLen = L.legLen ?? 8
    const torsoLen = L.torsoLen ?? 9
    J.torsoLen = torsoLen
    J.ox = s.ax
    J.oy = s.ay
    const crouch = R(p[HP.crouch]!)
    const jump = R(p[HP.jump]!)
    J.bx = R(J.ox + p[HP.lean]!)
    J.hipY = J.oy - legLen + crouch + jump
    J.topY = J.hipY - torsoLen
    const tilt = R(p[HP.tilt]!)
    J.headX = J.bx + R(p[HP.headX]!) + tilt
    J.headY = J.topY + R(p[HP.headY]!)
    J.fsx = J.bx + 2 + tilt
    J.fsy = J.topY + 1
    J.bsx = J.bx - 3 + tilt
    J.bsy = J.topY + 1
    J.hx = R(J.fsx + p[HP.hx]!)
    J.hy = R(J.fsy + p[HP.hy]!)
    J.bhx = R(J.bsx + p[HP.bhx]!)
    J.bhy = R(J.bsy + p[HP.bhy]!)
    J.ffx = R(J.ox + p[HP.ffx]!)
    J.ffy = J.oy + jump - R(p[HP.ffy]!)
    J.bfx = R(J.ox + p[HP.bfx]!)
    J.bfy = J.oy + jump - R(p[HP.bfy]!)

    const cx = J.bx + tilt
    if (L.back) L.back(s, cx, J.topY, p, t)
    if (!L.backArmFront) {
        if (L.offhand) L.offhand(s, J.bhx, J.bhy, p, t)
        limb(s, J.bsx, J.bsy, J.bhx, J.bhy, L.armBack, L.armBackLow)
        rect(s, J.bhx - 1, J.bhy - 1, 2, 2, L.hand)
    }
    if (L.lower) L.lower(s, J.bx, J.hipY, p, t)
    else legs(s, L, p)
    L.torso(s, cx, J.topY, p, t)
    L.head(s, J.headX, J.headY, p, t)
    if (L.backArmFront) {
        limb(s, J.bsx, J.bsy, J.bhx, J.bhy, L.armBack, L.armBackLow)
        rect(s, J.bhx - 1, J.bhy - 1, 2, 2, L.hand)
        if (L.offhand) L.offhand(s, J.bhx, J.bhy, p, t)
    }
    limb(s, J.fsx, J.fsy, J.hx, J.hy, L.arm, L.armLow)
    if (L.weapon) L.weapon(s, J.hx, J.hy, p, t)
    rect(s, J.hx - 1, J.hy - 1, 2, 2, L.hand)
    if (L.over) L.over(s, cx, J.topY, p, t)
}

// ── Clips ──────────────────────────────────────────────────────────────────────────

export type HKey = KeySpec<HPName>

export function hclip(name: string, dur: number, loop: boolean, keys: readonly HKey[], rest: Float32Array = REST): Clip {
    return compileClip(name, HP, rest, dur, loop, keys)
}

/** Standard humanoid Hit: a flash frame, a recoil, a settle. `weight` scales the recoil. */
export function hitClip(rest: Float32Array, weight = 1, extra: Partial<Record<HPName, number>> = {}): Clip {
    const w = weight
    return hclip('hit', 0.4, false, [
        [0, {}],
        [0.1, { flash: 1, lean: -2 * w, headX: -1, headY: 0, crouch: 1, glow: 0, ...extra }, 0],
        [0.2, { flash: 0, lean: -3 * w, headX: -2, tilt: -1, crouch: 1, mouth: 1 }, 0],
        [0.4, { lean: 0, headX: 0, tilt: 0, crouch: 0, mouth: 0 }]
    ], rest)
}

/**
 * The pose a clip rests in: its first keyframe, which every clip here opens on. Lets a gait be
 * generated from a unit's own stance, so its weapon and hands keep the silhouette they hold
 * standing still rather than snapping to the generic rest.
 */
export function poseOf(clip: Clip): Float32Array {
    return clip.values.slice(0, clip.np)
}

/**
 * Standard humanoid Run: contact → drive → contact → drive, four frames at 10 fps. A long
 * stride, the torso pitched forward, and a flight frame after each drive where both feet are
 * off the ground and the whole body lifts — which is what separates it from a walk. The plant
 * dips on `crouch` so the grounded foot stays put; the flight lifts on `jump`, which carries
 * the feet with it.
 */
export function runClip(rest: Float32Array, extra: Partial<Record<HPName, number>> = {}): Clip {
    return hclip('move', 0.4, true, [
        [0, { ffx: 6, bfx: -5, ffy: 0, bfy: 1, crouch: 1, lean: 3, ...extra }],
        [0.1, { ffx: 2, bfx: -2, ffy: 1, bfy: 5, crouch: 0, jump: -2, headY: -1, hx: 5, bhx: -3 }],
        [0.2, { ffx: -4, bfx: 6, ffy: 1, bfy: 0, crouch: 1, jump: 0, headY: 0, hx: 3, bhx: -1 }],
        [0.3, { ffx: 4, bfx: 1, ffy: 5, bfy: 1, crouch: 0, jump: -2, headY: -1, hx: 1, bhx: 1 }],
        [0.4, { ffx: 6, bfx: -5, ffy: 0, bfy: 1, crouch: 1, jump: 0, headY: 0, hx: 3, bhx: -1 }]
    ], rest)
}

/**
 * Standard humanoid Float: no stride at all — the whole body rides clear of the ground and
 * swells on its own cycle, hem and hands trailing. Uses `jump`, which carries the feet with it.
 * Pitched forward and kept brisk so a hovering caster still reads as travelling, not drifting.
 */
export function floatClip(rest: Float32Array, extra: Partial<Record<HPName, number>> = {}): Clip {
    return hclip('move', 0.8, true, [
        [0, { jump: -3, lean: 2, ...extra }],
        [0.3, { jump: -6, tilt: -1, hy: 8, bhy: 8 }],
        [0.6, { jump: -4, tilt: 0, hy: 6, bhy: 6 }],
        [0.8, { jump: -3 }]
    ], rest)
}

/** Standard humanoid Death: stagger, kneel, slump, fall back, dissolve. */
export function deathClip(rest: Float32Array, extra: Partial<Record<HPName, number>> = {}): Clip {
    return hclip('death', 1.4, false, [
        [0, {}],
        [0.1, { flash: 1, lean: -2, headX: -1 }, 0],
        [0.2, { flash: 0, lean: -3, tilt: -1, mouth: 1, hy: 10, bhy: 10 }],
        [0.4, { lean: -1, crouch: 4, kneel: 1, tilt: 1, headY: 1, headX: 1, mouth: 0, hy: 11, bhy: 11, wa: 0.4, ...extra }],
        [0.6, { crouch: 5, tilt: 2, headY: 2 }],
        [0.7, { fall: 1 }, 0],
        [0.9, { fade: 4 }, 0],
        [1.1, { fade: 9 }, 0],
        [1.3, { fade: 14 }, 0],
        [1.4, { fade: 16 }, 0]
    ], rest)
}

/** Breathing idle loop over `dur`, with optional sway of the weapon hand. */
export function idleClip(rest: Float32Array, dur = 1.2, sway = 1, extra: Partial<Record<HPName, number>> = {}): Clip {
    return hclip('idle', dur, true, [
        [0, {}],
        [dur * 0.5, { crouch: 1, hy: rest[HP.hy]! + sway, bhy: rest[HP.bhy]! + sway, ...extra }],
        [dur, {}]
    ], rest)
}

/** A rest pose that starts from REST. */
export function rest(spec: Partial<Record<HPName, number>>): Float32Array {
    const out = REST.slice()
    for (const [k, v] of Object.entries(spec) as [HPName, number][]) out[HP[k]] = v
    return out
}

// ── Actor: render a clip frame onto a scene ────────────────────────────────────────

/**
 * One reusable buffer set per on-screen body. Rendering a frame never allocates: the pose
 * array, sprite buffer, rotation scratch and stamp style are all owned here.
 */
export class Actor {
    readonly buf: Surface
    readonly scratch: Surface
    readonly pose = new Float32Array(HP_COUNT)
    readonly style = new StampStyle()

    constructor(size = 64, ay = size - 6) {
        this.buf = new Surface(size, size, size >> 1, ay)
        this.scratch = new Surface(size, size, size >> 1, ay)
    }

    /**
     * Draw `look` at clip time `t` onto `dst` with feet at (x, y). `facing` −1 mirrors (enemies).
     * `mark` adds the elite halo. Returns the pose that was drawn.
     */
    draw(dst: Surface, x: number, y: number, look: Look, clip: Clip, t: number, facing: 1 | -1 = 1,
        mark: number = CLEAR, shadow = true): Float32Array {
        sample(clip, t, this.pose)
        return this.drawPose(dst, x, y, look, t, facing, mark, shadow)
    }

    drawPose(dst: Surface, x: number, y: number, look: Look, t: number, facing: 1 | -1 = 1,
        mark: number = CLEAR, shadow = true): Float32Array {
        const p = this.pose
        this.buf.clear()
        drawHumanoid(this.buf, look, p, t)
        let src = this.buf
        if (p[HP.fall]! > 0.5) {
            rotate90(this.buf, this.scratch, -1)
            src = this.scratch
        }
        if (shadow && p[HP.fade]! < 12) {
            const jump = p[HP.jump]!
            ditherEllipse(dst, x, y, jump < -4 ? 4 : 6, 1, C.ink, p[HP.fade]! > 6 ? 5 : 10)
        }
        const st = this.style.reset()
        st.flip = (facing === -1) !== (p[HP.flip]! > 0.5)
        st.flash = p[HP.flash]! > 0.5 ? C.white : CLEAR
        st.dissolve = R(p[HP.fade]!)
        st.halo = mark
        if (p[HP.glow]! > 0.6) { st.rim = look.accent; st.rimDx = 1 }
        stamp(dst, src, x, y, st)
        if (look.fx && p[HP.fall]! <= 0.5 && p[HP.flash]! <= 0.5) {
            FX.ox = R(x) - this.buf.ax
            FX.oy = R(y) - this.buf.ay
            FX.ax = this.buf.ax
            FX.flip = st.flip
            look.fx(dst, p, t)
        }
        return p
    }
}

/** Frames in a clip at the authoring rate. */
export function framesOf(clip: Clip): number {
    return Math.max(1, Math.round(clip.dur * ANIM_FPS))
}
