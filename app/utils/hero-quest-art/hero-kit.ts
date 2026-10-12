// The kit every chibi Hero is built from: the Look defaults, the cast aura, the colour ramps
// it burns through, the bow clip, and the chunky scene effects (shout rings, ground slams,
// light columns) that the class lines share. The body itself is chibi.ts.

import { Ease, Phase, step, type Clip } from './anim'
import { C } from './palette'
import { hash2, px, rect, type Surface } from './surface'
import { HP, J, fxX, fxY, hclip, type Look, type HKey } from './rig'
import { HERO_SKIN } from './hero-parts'
import { drawChibi } from './chibi'
import { bow, crossbow, type Mat } from './weapons'

export const CH = Phase.Charge
export const CA = Phase.Cast
export const RE = Phase.Recover

/** Whether this frame's `fxk` pose parameter calls for scene effect `k`. */
export const is = (p: Float32Array, k: number) => Math.round(p[HP.fxk]!) === k

/** A chibi Look: the rookie's skin and a plain tunic unless the class says otherwise. */
export function chibiLook(over: Partial<Look> & Pick<Look, 'torso' | 'head' | 'accent'>): Look {
    return {
        body: drawChibi,
        skin: HERO_SKIN,
        pants: C.brown2, pantsDk: C.brown1, boot: C.brown0, bootHi: C.brown2,
        arm: C.bone1, armLow: C.skin1, armBack: C.bone0, armBackLow: C.skin0, hand: C.skin1,
        ...over
    }
}

export function r1(t: number): number { return Math.round(t * 10) / 10 }

// ── Ramps: white-hot core first, cooling out to the rim ────────────────────────────

export const FIRE = [C.white, C.gold3, C.gold2, C.orange, C.lava1, C.red1]
export const BLOOD_FIRE = [C.white, C.red3, C.red2, C.red2, C.red1, C.red0]
export const HOLY = [C.white, C.white, C.gold3, C.gold2, C.gold1, C.gold0]
export const FROST = [C.white, C.frost, C.cyan, C.blue2, C.blue1, C.blue0]
export const ARCANE = [C.white, C.pink, C.purple2, C.purple2, C.purple1, C.purple0]
export const SPIRIT = [C.white, C.teal3, C.teal3, C.teal2, C.teal1, C.teal0]
export const POISON = [C.white, C.green4, C.green3, C.green2, C.green1, C.green0]
export const GILT = [C.white, C.gold3, C.gold2, C.gold1, C.brown2, C.brown1]
export const MOON = [C.white, C.frost, C.steel3, C.steel2, C.steel1, C.steel0]

/**
 * Flames licking up the edges of the body — the cast aura. Tongues stand on both flanks
 * (never over the face), each flickering to its own height and cooling through `ramp`
 * toward the tip; loose embers ride above them.
 */
export function aura(dst: Surface, t: number, ramp: readonly number[], spread = 7, tall = 20): void {
    const f = step(t, 10, 64)
    const n = ramp.length
    for (let i = 0; i < 10; i++) {
        const side = i & 1 ? 1 : -1
        const x = J.bx + side * (spread - (i >> 1) % 3)
        const h = Math.round(tall * (0.35 + 0.65 * hash2(i, f)))
        for (let k = 0; k < h; k++) {
            const u = k / h
            const c = ramp[Math.min(n - 1, 1 + Math.floor(u * (n - 1)))]!
            dst.set(fxX(x), fxY(J.oy - 1 - k), c)
            if (u < 0.45) dst.set(fxX(x + side), fxY(J.oy - 1 - k), ramp[Math.min(n - 1, 2 + Math.floor(u * (n - 2)))]!)
        }
        dst.set(fxX(x), fxY(J.oy - 1 - h), ramp[0]!)
    }
    for (let i = 0; i < 8; i++) {
        const u = ((f * 2 + i * 7) % 12) / 12
        const x = J.bx + Math.round((hash2(i, 9) - 0.5) * spread * 3)
        dst.set(fxX(x), fxY(J.oy - tall * 0.6 - Math.round(u * tall)), ramp[Math.min(n - 1, 1 + Math.floor(u * (n - 1)))]!)
    }
}

/** Four white-hot pixels in a burst, stepping outward — a contact spark. */
export function pop(dst: Surface, x: number, y: number, k: number, c: number): void {
    const r = 2 + k
    dst.set(fxX(x + r), fxY(y), C.white)
    dst.set(fxX(x), fxY(y - r), c)
    dst.set(fxX(x), fxY(y + r), c)
    dst.set(fxX(x + r - 1), fxY(y - r + 1), c)
    dst.set(fxX(x + r - 1), fxY(y + r - 1), c)
    if (k === 0) dst.set(fxX(x + 1), fxY(y), C.white)
}

/** A 2px arc around (cx, cy), white on its outer edge — a shout or a gust, not a thin line. */
export function thickArc(dst: Surface, cx: number, cy: number, r: number, a0: number, a1: number, c: number, edge: number = C.white): void {
    const n = Math.max(6, Math.round((a1 - a0) * r * 1.4))
    for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * i / n
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        dst.set(fxX(Math.round(cx + ca * r)), fxY(Math.round(cy + sa * r)), edge)
        dst.set(fxX(Math.round(cx + ca * (r - 1))), fxY(Math.round(cy + sa * (r - 1))), c)
    }
}

/**
 * Shout rings rolling forward from (x, y): three arcs stepping outward over the frames, the
 * lead one white. Roars and whistles.
 */
export function shout(dst: Surface, x: number, y: number, t: number, c: number, spread = 0.9): void {
    const k = step(t, 10, 4)
    for (let i = 0; i < 3; i++) {
        const r = 3 + ((i * 4 + k * 3) % 12)
        thickArc(dst, x, y, r, -spread, spread, c, i === 0 ? C.white : c)
    }
}

/**
 * A ground slam at sprite-local x: a flat shock ring skidding out along the floor both ways,
 * rubble thrown up, a white flash at the contact.
 */
export function slam(dst: Surface, x: number, t: number, c: number, rubble: number): void {
    const k = step(t, 10, 5)
    const floor = J.oy
    const r = 4 + k * 4
    for (let dx = -r; dx <= r; dx++) {
        const edge = Math.abs(dx) >= r - 1
        const dy = Math.round(Math.sqrt(Math.max(0, 1 - (dx * dx) / (r * r))) * 2)
        if (edge || dy === 2) {
            dst.set(fxX(x + dx), fxY(floor - dy), edge ? C.white : c)
            dst.set(fxX(x + dx), fxY(floor + dy - 1), c)
        }
    }
    if (k === 0) for (let i = -2; i <= 2; i++) dst.set(fxX(x + i), fxY(floor - 1 - (2 - Math.abs(i))), C.white)
    for (let i = 0; i < 6; i++) {
        const side = i & 1 ? 1 : -1
        const d = 2 + (i >> 1) * 3 + k * 2
        const h = Math.round(6 * Math.sin(Math.min(1, (k + 1) / 5) * Math.PI) * (1 - (i >> 1) * 0.25))
        dst.set(fxX(x + side * d), fxY(floor - 1 - h), rubble)
        dst.set(fxX(x + side * d + 1), fxY(floor - 1 - h), i < 2 ? C.white : rubble)
    }
}

/**
 * A column of light falling on sprite-local x from the top of the frame down to `bottom`
 * (a raised weapon, so the beam never covers the Hero), bursting where it lands.
 */
export function lightColumn(dst: Surface, x: number, bottom: number, t: number, ramp: readonly number[], half = 3): void {
    const k = step(t, 10, 4)
    const top = J.oy - 58
    for (let y = top; y < bottom; y++) {
        for (let dx = -half; dx <= half; dx++) {
            const edge = Math.abs(dx) === half
            if (edge && ((y + k) & 1)) continue
            const c = Math.abs(dx) <= 1 ? ramp[0]! : edge ? ramp[3]! : ramp[2]!
            dst.set(fxX(x + dx), fxY(y), c)
        }
    }
    // the landing: a white-hot star with rays stepping outward
    const r = 3 + (k & 1)
    for (let d = 0; d <= r; d++) {
        const c = d < 2 ? ramp[0]! : ramp[2]!
        dst.set(fxX(x + d), fxY(bottom), c); dst.set(fxX(x - d), fxY(bottom), c)
        dst.set(fxX(x), fxY(bottom + d), c); dst.set(fxX(x), fxY(bottom - d), c)
    }
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4
        const d = 2 + k
        dst.set(fxX(Math.round(x + Math.cos(a) * d)), fxY(Math.round(bottom + Math.sin(a) * d)), ramp[1]!)
    }
}

// ── Bows ───────────────────────────────────────────────────────────────────────────

/** Bow painter with the pull read from `aux`. */
export function bowPainter(wood: Mat, size: number, arrowTip: number = C.steel3) {
    return (s: Surface, x: number, y: number, p: Float32Array) => {
        const pull = p[HP.aux]!
        bow(s, x, y, p[HP.wa]!, pull, pull > 0.05, wood, size, arrowTip)
    }
}

/**
 * Crossbow painter on the bow clip: `aux` is the span, so drawing the string back to the latch
 * loads a bolt and the release snaps it forward.
 */
export function crossbowPainter(stock: Mat, prod: Mat, boltTip: number = C.steel3) {
    return (s: Surface, x: number, y: number, p: Float32Array) => {
        crossbow(s, x, y, p[HP.wa]!, p[HP.aux]! > 0.05, stock, prod, boltTip)
    }
}

/** A thick release streak off the bow along angle `a` — two rows, white-hot at the head. */
export function loose(dst: Surface, a: number, c: number, big: boolean): void {
    const len = big ? 22 : 12
    const x = J.hx + Math.cos(a) * (big ? 16 : 13)
    const y = J.hy + Math.sin(a) * (big ? 16 : 13)
    for (let i = 0; i < len; i++) {
        if (i > len * 0.6 && (i & 1)) continue
        const xx = Math.round(x - Math.cos(a) * i)
        const yy = Math.round(y - Math.sin(a) * i)
        dst.set(fxX(xx), fxY(yy), i < 3 ? C.white : c)
        if (big && i < len * 0.7) { dst.set(fxX(xx), fxY(yy - 1), i < 5 ? C.white : c); dst.set(fxX(xx), fxY(yy + 1), c) }
    }
}

/** Raise → nock → draw → release, `shots` times; `release` is the Look's fxk for a loose. */
export function bowAttack(restPose: Float32Array, shots: number, release: number): Clip {
    const keys: HKey[] = [[0, {}], [0.1, { wa: 0, hx: 8, hy: 0, bhx: 9, bhy: 0, lean: -1, aux: 0.1 }, Ease.Out, CH]]
    let t = 0.1
    const gap = shots === 1 ? 0.2 : 0.1
    for (let i = 0; i < shots; i++) {
        t += gap
        keys.push([r1(t), { aux: 1, bhx: 3, fxk: 0 }, Ease.InOut, CH])
        t += 0.1
        keys.push([r1(t), { aux: 0, bhx: -1, bhy: -1, fxk: release, lean: -1 - (i & 1) }, Ease.Hold, CA])
        if (i < shots - 1) { t += 0.1; keys.push([r1(t), { fxk: 0, bhx: 8, bhy: 0, aux: 0.1 }, Ease.Out, CH]) }
    }
    keys.push([r1(t + 0.1), { fxk: 0 }, Ease.Hold, RE])
    const end = Math.max(0.9, r1(t + 0.4))
    keys.push([end, {
        wa: restPose[HP.wa]!, hx: restPose[HP.hx]!, hy: restPose[HP.hy]!, bhx: restPose[HP.bhx]!, bhy: restPose[HP.bhy]!, lean: 0, aux: 0
    }])
    return hclip('attack', end, false, keys, restPose)
}

// ── Cloth ──────────────────────────────────────────────────────────────────────────

/**
 * A cape hanging from the shoulders behind the back, flaring out as it falls and flicking
 * its lower half on a 3 fps beat. Drawn from a Look's `back` at the shoulder line.
 */
export function chibiCape(s: Surface, x: number, y: number, len: number, t: number, c: number, dk: number, hi: number = c): void {
    const flick = step(t, 3, 2)
    for (let i = 0; i < len; i++) {
        const u = i / Math.max(1, len - 1)
        const back = Math.round(u * 3) + (i > len * 0.5 ? flick : 0)
        rect(s, x - 6 - back, y + i, 6, 1, c)
        px(s, x - 6 - back, y + i, dk)
        if (i < 2) px(s, x - 2 - back, y + i, hi)
    }
    rect(s, x - 6 - 3 - flick, y + len - 1, 5, 1, dk)
}

/**
 * A robe to the floor, flaring as it falls, the hem swinging a pixel on the beat: shadow
 * side, lit edge and a trim band along the hem. Replaces the legs. The hem rides `jump`, so a
 * caster who rises leaves the ground rather than stretching his robe down to it.
 */
export function robe(cloth: Mat, trim: number, flare = 2) {
    return (s: Surface, x: number, hipY: number, p: Float32Array, t: number) => {
        const sway = step(t, 3, 2)
        const floor = J.oy + Math.round(p[HP.jump]!)
        for (let y = hipY; y < floor; y++) {
            const u = (y - hipY) / Math.max(1, floor - hipY - 1)
            const half = Math.round(5 + u * flare)
            const off = y === floor - 1 ? sway : 0
            rect(s, x - half + off, y, half * 2, 1, cloth[1])
            rect(s, x - half + off, y, 2, 1, cloth[0])
            px(s, x + half - 2 + off, y, cloth[2])
        }
        rect(s, x - 5 - flare + sway, floor - 1, (5 + flare) * 2, 1, trim)
    }
}
