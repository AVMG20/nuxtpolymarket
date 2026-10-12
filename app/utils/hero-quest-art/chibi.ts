// The chibi body — round 2's hero construction.
//
// Where the classic rig is a stick figure (2px limbs, a 5×7 face), this one is squat and
// big-headed: a 12×11 head over a 10×8 torso on 5px legs, 3px sleeves and 3×3 fists, about
// 24px tall. Heads are authored as pixel maps (a face needs every pixel placed by hand);
// torsos, limbs and weapons stay procedural so the keyframes can move them.
//
// It rides the same pose parameters (HP) and resolves the same joints (J) as drawHumanoid,
// so clips, Look.fx painters and the VFX layer read it unchanged.

import { C } from './palette'
import { line, rect, px, type Surface } from './surface'
import { HP, J, fxX, fxY, type Look } from './rig'

const R = Math.round

// ── Pixel maps ─────────────────────────────────────────────────────────────────────

export interface Pix { readonly w: number, readonly h: number, readonly data: Uint8Array }

/** Compile rows of characters into palette indices through `key`; '.' is transparent. */
export function pix(rows: readonly string[], key: Readonly<Record<string, number>>): Pix {
    const h = rows.length
    const w = Math.max(...rows.map(r => r.length))
    const data = new Uint8Array(w * h)
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
            const ch = row[x]!
            if (ch === '.' || ch === ' ') continue
            const c = key[ch]
            if (c === undefined) throw new Error(`pix: no colour for '${ch}'`)
            data[y * w + x] = c
        }
    })
    return { w, h, data }
}

/** Draw a pixel map with its top-left at (x, y). */
export function put(s: Surface, p: Pix, x: number, y: number): void {
    x = R(x); y = R(y)
    for (let yy = 0; yy < p.h; yy++) {
        for (let xx = 0; xx < p.w; xx++) {
            const c = p.data[yy * p.w + xx]!
            if (c) s.set(x + xx, y + yy, c)
        }
    }
}

/** Colour keys every chibi head shares: the rookie's hair and skin, plus headgear ramps. */
export const HEAD_KEY: Readonly<Record<string, number>> = {
    k: C.ink, w: C.white, b: C.bone1, B: C.bone0,
    o: C.brown0, h: C.brown1, H: C.brown2, L: C.brown3,
    d: C.skin0, s: C.skin1, S: C.skin2,
    i: C.steel0, I: C.steel1, j: C.steel2, J: C.steel3,
    x: C.red0, y: C.red1, z: C.red2, g: C.gold1, G: C.gold2, Y: C.gold3,
    q: C.lava0, O: C.orange, v: C.void,
    a: C.blue0, A: C.blue1, e: C.blue2, c: C.cyan, f: C.frost,
    n: C.green1, N: C.green2, m: C.green3, M: C.green4,
    t: C.teal1, T: C.teal2, u: C.teal3,
    p: C.purple0, P: C.purple1, V: C.purple2,
    '4': C.stone0, '5': C.stone1, '6': C.stone2, '7': C.stone3,
    '8': C.olive1, '9': C.olive2
}

/**
 * A head: a pixel map plus the column its neck sits under. Heads are bottom-aligned, and the
 * face occupies the same rows counted from the bottom in every one, so the eye and mouth can
 * be animated by coordinate whatever the headgear adds on top.
 */
export interface Head { readonly pix: Pix, readonly neck: number, readonly eye: number }

export function head(rows: readonly string[], neck: number, eye: number): Head {
    return { pix: pix(rows, HEAD_KEY), neck, eye }
}

const EYE_FROM_BOTTOM = 6
const MOUTH_FROM_BOTTOM = 3

/** The rookie's face, bare. Class heads splice these rows under their headgear. */
const FACE = [
    'ohHHHsSSSkS.',
    'ohHHdsSSSkSs',
    '.hHHssSbbSS.',
    '.ohHssSSSSS.',
    '..ohsssSSs..',
    '.....ddd....'
]

/** Pad face rows by `l` columns on the left and `r` on the right, to sit under wider gear. */
export function face(l = 0, r = 0): string[] {
    return FACE.map(row => '.'.repeat(l) + row + '.'.repeat(r))
}

/**
 * The rookie, bare-headed: a messy brown mop swept forward over the brow, a big eye, a
 * button nose and the plaster on his cheek. Every class head is this face with headgear
 * painted over the hair.
 */
export const ROOKIE_HEAD = head([
    '..hH.hH.H...',
    '.hHHHHHHHh..',
    '.hHHLLLLHHh.',
    'hHHHHHLLHHHH',
    'hHHHHHHHHsHH',
    ...face()
], 5, 9)

/**
 * Draw a head at the neck (x, y), then animate the face from the pose. `lid` is the skin the
 * squint closes over; `mouth` is false for heads whose mouth is hidden (visors, masks).
 */
export function chibiHead(s: Surface, hd: Head, x: number, y: number, p: Float32Array, eye: number = C.ink,
    lid: number = C.skin2, mouth = true): void {
    const ox = R(x) - hd.neck
    const oy = R(y) - hd.pix.h
    put(s, hd.pix, ox, oy)
    const hurt = (p[HP.flash]! > 0.5 || p[HP.mouth]! > 0.5) && p[HP.glow]! < 0.5
    const ex = ox + hd.eye
    const ey = oy + hd.pix.h - EYE_FROM_BOTTOM
    if (hurt && p[HP.fade]! < 1) {
        // squeezed shut: a flat line where the eye was
        s.set(ex, ey, lid)
        s.set(ex, ey + 1, C.ink)
        s.set(ex - 1, ey + 1, C.ink)
    } else {
        s.set(ex, ey, eye)
        s.set(ex, ey + 1, eye)
    }
    if (mouth && p[HP.mouth]! > 0.5) {
        const my = oy + hd.pix.h - MOUTH_FROM_BOTTOM
        s.set(ex, my, C.ink)
        s.set(ex, my + 1, C.red1)
    }
}

// ── Body ───────────────────────────────────────────────────────────────────────────

export const CHIBI_LEG = 5
export const CHIBI_TORSO = 7

/** Stubby legs: 3px columns ending in 4–5px boots. The back leg kneels when asked. */
function chibiLegs(s: Surface, L: Look, p: Float32Array): void {
    if (p[HP.kneel]! > 0.4) {
        const kx = J.bx - 3
        const ky = J.oy - 2
        line(s, J.bx - 1, J.hipY, kx, ky, L.pantsDk, 3)
        rect(s, kx - 4, J.oy - 2, 4, 2, L.boot)
    } else {
        line(s, J.bx - 1, J.hipY + 1, J.bfx, J.bfy - 2, L.pantsDk, 3)
        rect(s, J.bfx - 2, J.bfy - 2, 4, 2, L.boot)
    }
    line(s, J.bx + 1, J.hipY + 1, J.ffx, J.ffy - 2, L.pants, 3)
    rect(s, J.ffx - 1, J.ffy - 2, 5, 2, L.boot)
    px(s, J.ffx + 1, J.ffy - 2, L.bootHi)
}

/** A 3px sleeve from the shoulder to the hand, and a 3×3 fist. */
function chibiArm(s: Surface, x0: number, y0: number, x1: number, y1: number, sleeve: number, cuff: number): void {
    const mx = R(x0 + (x1 - x0) * 0.6)
    const my = R(y0 + (y1 - y0) * 0.6)
    line(s, x0, y0, mx, my, sleeve, 3)
    line(s, mx, my, x1, y1, cuff, 3)
}

function fist(s: Surface, x: number, y: number, c: number, hi: number): void {
    rect(s, x - 1, y - 1, 3, 3, c)
    px(s, x, y - 1, hi)
}

/**
 * The chibi construction, in the same order drawHumanoid paints: back items, back arm,
 * legs (or `lower`), torso, head, front arm, weapon, fist, overlays.
 */
export function drawChibi(s: Surface, L: Look, p: Float32Array, t: number): void {
    J.torsoLen = CHIBI_TORSO
    J.ox = s.ax
    J.oy = s.ay
    const crouch = R(p[HP.crouch]!)
    const jump = R(p[HP.jump]!)
    J.bx = R(J.ox + p[HP.lean]!)
    J.hipY = J.oy - (L.legLen ?? CHIBI_LEG) + crouch + jump
    J.topY = J.hipY - (L.torsoLen ?? CHIBI_TORSO)
    const tilt = R(p[HP.tilt]!)
    J.headX = J.bx + R(p[HP.headX]!) + tilt
    J.headY = J.topY + 1 + R(p[HP.headY]!)
    J.fsx = J.bx + 3 + tilt
    J.fsy = J.topY + 2
    J.bsx = J.bx - 3 + tilt
    J.bsy = J.topY + 2
    J.hx = R(J.fsx + p[HP.hx]!)
    J.hy = R(J.fsy + p[HP.hy]!)
    J.bhx = R(J.bsx + p[HP.bhx]!)
    J.bhy = R(J.bsy + p[HP.bhy]!)
    J.ffx = R(J.ox + p[HP.ffx]!)
    J.ffy = J.oy + jump - R(p[HP.ffy]!)
    J.bfx = R(J.ox + p[HP.bfx]!)
    J.bfy = J.oy + jump - R(p[HP.bfy]!)

    const cx = J.bx + tilt
    const hand = L.hand
    const handHi = L.skin[2]
    if (L.back) L.back(s, cx, J.topY, p, t)
    if (!L.backArmFront) {
        if (L.offhand) L.offhand(s, J.bhx, J.bhy, p, t)
        chibiArm(s, J.bsx, J.bsy, J.bhx, J.bhy, L.armBack, L.armBackLow)
        fist(s, J.bhx, J.bhy, L.skin[0], hand)
    }
    if (L.lower) L.lower(s, J.bx, J.hipY, p, t)
    else chibiLegs(s, L, p)
    L.torso(s, cx, J.topY, p, t)
    L.head(s, J.headX, J.headY, p, t)
    if (L.backArmFront) {
        chibiArm(s, J.bsx, J.bsy, J.bhx, J.bhy, L.armBack, L.armBackLow)
        fist(s, J.bhx, J.bhy, L.skin[0], hand)
        if (L.offhand) L.offhand(s, J.bhx, J.bhy, p, t)
    }
    chibiArm(s, J.fsx, J.fsy, J.hx, J.hy, L.arm, L.armLow)
    if (L.weapon) L.weapon(s, J.hx, J.hy, p, t)
    fist(s, J.hx, J.hy, hand, handHi)
    if (L.over) L.over(s, cx, J.topY, p, t)
}

// ── Scene effects ──────────────────────────────────────────────────────────────────

/**
 * A filled crescent swept around sprite-local (cx, cy) from a0 to a1: `width` px thick at
 * the middle, tapering to a point at both ends, white on the outer edge — the chunky slash
 * of the reference video rather than a 1px arc.
 */
export function crescent(dst: Surface, cx: number, cy: number, r: number, a0: number, a1: number, width: number,
    body: number, edge: number = C.white, inner: number = body): void {
    const steps = Math.max(10, R(Math.abs(a1 - a0) * r * 1.5))
    for (let i = 0; i <= steps; i++) {
        const k = i / steps
        const a = a0 + (a1 - a0) * k
        const th = Math.max(1, R(width * Math.sin(Math.PI * Math.min(1, k * 1.15))))
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        for (let d = 0; d < th; d++) {
            const c = d === 0 ? edge : d === th - 1 && th > 2 ? inner : body
            dst.set(fxX(R(cx + ca * (r - d))), fxY(R(cy + sa * (r - d))), c)
        }
    }
}
