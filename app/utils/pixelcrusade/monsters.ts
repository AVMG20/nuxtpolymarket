// Procedural pixel-art monsters for Pixel Crusade. Every sprite is drawn with integer
// rects from the C palette into a SpriteBuffer (feet anchor at sb.ax, sb.ay), facing
// left toward the hero, then stamped with an ink outline, hit flash and rim light.
// Light comes from the upper left: each material gets a shade, a base and a highlight.

import { C } from './palette'
import { rect, px, line, disc, ellipse, ring, dither, hash } from './pixel'
import type { SpriteBuffer } from './pixel'
import type { MonsterInfo, MonsterKind, MonsterPose } from './types'

type G = CanvasRenderingContext2D

export const MONSTERS: Record<MonsterKind, MonsterInfo> = {
    slime: { name: 'Slime', boss: false, w: 16, h: 12, hitY: 6, ramp: 'slime' },
    mushroom: { name: 'Angry Shroom', boss: false, w: 22, h: 20, hitY: 10, ramp: 'nature' },
    wolf: { name: 'Dire Wolf', boss: false, w: 30, h: 20, hitY: 11, ramp: 'blood' },
    kingSlime: { name: 'King Slime', boss: true, w: 42, h: 36, hitY: 14, ramp: 'slime' },
    goblin: { name: 'Goblin', boss: false, w: 16, h: 22, hitY: 12, ramp: 'blood' },
    spider: { name: 'Cave Spider', boss: false, w: 30, h: 16, hitY: 8, ramp: 'shadow' },
    treant: { name: 'Treant', boss: false, w: 24, h: 34, hitY: 17, ramp: 'nature' },
    ogre: { name: 'Ogre Chief', boss: true, w: 32, h: 44, hitY: 22, ramp: 'blood' },
    skeleton: { name: 'Skeleton', boss: false, w: 16, h: 26, hitY: 14, ramp: 'bone' },
    ghost: { name: 'Ghost', boss: false, w: 18, h: 24, hitY: 20, ramp: 'arcane' },
    bat: { name: 'Crypt Bat', boss: false, w: 26, h: 14, hitY: 18, ramp: 'shadow' },
    lich: { name: 'Lich King', boss: true, w: 30, h: 50, hitY: 26, ramp: 'arcane' },
    imp: { name: 'Imp', boss: false, w: 18, h: 22, hitY: 12, ramp: 'fire' },
    salamander: { name: 'Salamander', boss: false, w: 32, h: 14, hitY: 6, ramp: 'fire' },
    golem: { name: 'Magma Golem', boss: false, w: 28, h: 32, hitY: 16, ramp: 'ember' },
    dragon: { name: 'Ember Dragon', boss: true, w: 60, h: 52, hitY: 22, ramp: 'fire' }
}

// ---------------------------------------------------------------- shared helpers

const TAU = Math.PI * 2
const DEG = Math.PI / 180
const R = Math.round

/** Whole-pixel sine sampled at 10 fps, so motion steps like hand-drawn frames. */
function wave(t: number, period: number, amp: number, phase = 0): number {
    const q = Math.floor(t * 10) / 10
    return R(Math.sin((q / period + phase) * TAU) * amp)
}

function frame(t: number, fps: number, n: number): number {
    return Math.floor(t * fps) % n
}

function blinking(t: number, seed: number): boolean {
    return (Math.floor(t * 8) + seed) % 31 === 0
}

// Attack / hurt state of the monster being drawn (module scratch, no allocation).
let wind = 0
let strike = false
let rec = 0
let lunge = 0
let kb = 0
let hurt = false
let trail: string | null = null

function phase(p: MonsterPose, reach: number): void {
    wind = 0
    strike = false
    rec = 0
    lunge = 0
    const a = p.attack
    if (a > 0 && a < 1) {
        if (a < 0.5) {
            // anticipation: eases in over 5 frames, then holds the full wind-up
            wind = Math.min(1, Math.floor(a * 12) / 5)
            lunge = -R(wind * 2)
        } else if (a < 0.65) {
            strike = true
            rec = 1
            lunge = reach
        } else {
            rec = 1 - Math.floor((a - 0.65) / 0.35 * 5) / 5
            lunge = R(reach * rec * rec)
        }
    }
    kb = R(p.hurt * 3)
    hurt = p.hurt > 0.25
    trail = null
}

/** Blend a pose value between rest, full wind-up and full strike. */
function pz(rest: number, w: number, s: number): number {
    return wind > 0 ? rest + (w - rest) * wind : rest + (s - rest) * rec
}

function skew(sk: number, frac: number): number {
    return R(sk * frac)
}

let tLo = 0
let tHi = 0

function edge(xa: number, ya: number, xb: number, yb: number, y: number): void {
    if ((y < ya && y < yb) || (y > ya && y > yb)) return
    if (ya === yb) {
        if (xa < tLo) tLo = xa
        if (xa > tHi) tHi = xa
        if (xb < tLo) tLo = xb
        if (xb > tHi) tHi = xb
        return
    }
    const x = xa + (xb - xa) * (y - ya) / (yb - ya)
    if (x < tLo) tLo = x
    if (x > tHi) tHi = x
}

/** Filled triangle of horizontal spans. */
function tri(g: G, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: string): void {
    x0 = R(x0); y0 = R(y0); x1 = R(x1); y1 = R(y1); x2 = R(x2); y2 = R(y2)
    g.fillStyle = c
    const top = Math.min(y0, y1, y2)
    const bot = Math.max(y0, y1, y2)
    for (let y = top; y <= bot; y++) {
        tLo = 1e9
        tHi = -1e9
        edge(x0, y0, x1, y1, y)
        edge(x1, y1, x2, y2, y)
        edge(x2, y2, x0, y0, y)
        if (tHi >= tLo) {
            const a = R(tLo)
            g.fillRect(a, y, R(tHi) - a + 1, 1)
        }
    }
}

/** Two triangles fanned from (ex, ey) with a notch between a and b (wing scallop). */
function scallop(g: G, ex: number, ey: number, ax: number, ay: number, bx: number, by: number, c: string): void {
    let mx = (ax + bx) / 2
    let my = (ay + by) / 2
    mx += (ex - mx) * 0.28
    my += (ey - my) * 0.28
    tri(g, ex, ey, ax, ay, mx, my, c)
    tri(g, ex, ey, mx, my, bx, by, c)
}

/** Upper half of an ellipse standing on row `by`, optionally sheared by `sk` px at the top. */
function dome(g: G, cx: number, by: number, rx: number, h: number, c: string, sk = 0): void {
    g.fillStyle = c
    const hh = Math.max(1, h)
    for (let j = 0; j <= hh; j++) {
        const k = j / (hh + 0.5)
        const half = Math.floor(rx * Math.sqrt(1 - k * k) + 0.35)
        const off = R(sk * j / hh)
        g.fillRect(R(cx - half + off), R(by - j), half * 2 + 1, 1)
    }
}

/** 1px arc, angles in degrees (a0 < a1). */
function arc(g: G, cx: number, cy: number, r: number, a0: number, a1: number, c: string): void {
    g.fillStyle = c
    const step = 45 / Math.max(1, r)
    for (let a = a0; a <= a1; a += step) {
        g.fillRect(R(cx + Math.cos(a * DEG) * r), R(cy + Math.sin(a * DEG) * r), 1, 1)
    }
}

/** Weapon smear: bright arc, thicker toward the leading edge at a0. */
function smear(g: G, cx: number, cy: number, r: number, a0: number, a1: number): void {
    arc(g, cx, cy, r, a0, a1, C.white)
    arc(g, cx, cy, r - 1, a0, a1, C.steel3)
    arc(g, cx, cy, r - 2, a0, a0 + (a1 - a0) * 0.6, C.steel2)
    arc(g, cx, cy, r - 3, a0, a0 + (a1 - a0) * 0.25, C.steel2)
}

function xEye(g: G, x: number, y: number, c: string): void {
    px(g, x, y, c); px(g, x + 2, y, c); px(g, x + 1, y + 1, c); px(g, x, y + 2, c); px(g, x + 2, y + 2, c)
}

/** Wince eyes: `>` at x and `<` at x + gap. */
function wince(g: G, x: number, y: number, gap: number, c: string): void {
    px(g, x, y, c); px(g, x + 1, y + 1, c); px(g, x, y + 2, c)
    px(g, x + gap + 1, y, c); px(g, x + gap, y + 1, c); px(g, x + gap + 1, y + 2, c)
}

/** Flickering flame tongue standing on (x, y). */
function flame(g: G, x: number, y: number, h: number, seed: number, q: number, lean: number): void {
    const j = hash(q * 13 + seed * 101)
    const hh = h + (j < 0.33 ? 0 : j < 0.7 ? 1 : 2)
    const tx = x + lean + (hash(q * 7 + seed * 31) < 0.3 ? 1 : 0)
    tri(g, x - 2, y, x + 2, y, tx, y - hh, C.lava1)
    tri(g, x - 1, y, x + 1, y, tx, y - hh + 2, C.orange)
    if (hh >= 5) px(g, x, y - 2, C.gold2)
    px(g, x, y - 1, C.gold2)
    px(g, x, y, C.gold3)
}

function flyShadow(dst: G, x: number, y: number, w: number): void {
    dither(dst, x - w, y, w * 2 + 1, 1, C.ink, 3)
    dither(dst, x - w + 2, y - 1, w * 2 - 3, 1, C.ink, 2)
    dither(dst, x - w + 2, y + 1, w * 2 - 3, 1, C.ink, 2)
}

// ---------------------------------------------------------------- slime

const HOP_Y = Int8Array.from([0, 0, 2, 4, 5, 4, 2, 0])
const HOP_S = Int8Array.from([2, 1, -1, -1, 0, 0, -1, 1])

function slime(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 8)
    let lift = 0
    let sq = frame(p.t, 2.5, 4) < 2 ? 0 : 1
    if (p.moving) {
        const f = frame(p.walk, 10, 8)
        lift = HOP_Y[f]!
        sq = HOP_S[f]!
    }
    if (wind > 0) sq = R(wind * 3)
    if (strike) { sq = -2; lift = 2 }
    if (hurt) sq = -1
    const cx = ax - lunge + kb
    const by = ay - lift
    const rx = 8 + sq + (strike ? 2 : 0)
    const h = 10 - R(sq * 1.5)
    const sk = strike ? -4 : R(wind * 2) + (hurt ? 2 : 0)

    dome(g, cx, by - 1, rx, h, C.green1, sk)
    rect(g, cx - rx + 1, by, rx * 2 - 1, 1, C.green0)
    dome(g, cx - 1, by - 2, rx - 2, h - 2, C.green2, sk)
    rect(g, cx - rx + 2, by - 1, 3, 1, C.green3)
    const hy = by - R(h * 0.72)
    const hx = cx - R(rx * 0.45) + skew(sk, 0.72)
    rect(g, hx - 1, hy, 3, 1, C.green3)
    px(g, hx - 2, hy + 1, C.green3)
    px(g, hx - 1, hy, C.white)
    px(g, hx - 2, hy + 1, C.green4)

    const bp = frame(p.t, 5, 10)
    if (bp < h - 5) px(g, cx + 3 + skew(sk, bp / h), by - 3 - bp, C.green3)

    const ey = by - R(h * 0.55) - 1
    const ex = cx - 5 + skew(sk, 0.55) + (strike ? -1 : 0)
    if (hurt) {
        wince(g, ex, ey, 4, C.ink)
    } else if (blinking(p.t, 3) && !strike) {
        rect(g, ex, ey + 2, 2, 1, C.ink)
        rect(g, ex + 4, ey + 2, 2, 1, C.ink)
    } else {
        rect(g, ex, ey, 2, 3, C.ink)
        rect(g, ex + 4, ey, 2, 3, C.ink)
        px(g, ex, ey, C.white)
        px(g, ex + 4, ey, C.white)
    }
    const mx = ex + 1
    const mh = strike ? 3 : 2
    const my = Math.min(ey + 4, by - 1 - mh)
    if (strike || wind > 0.4) {
        rect(g, mx, my, 4, mh, C.ink)
        rect(g, mx + 1, my + mh - 1, 2, 1, C.red1)
    } else if (hurt) {
        rect(g, mx + 1, my, 2, 2, C.ink)
    } else {
        rect(g, mx + 1, my, 2, 1, C.ink)
    }
}

// ---------------------------------------------------------------- mushroom

// spot dx, dy (from cap centre / bottom), size (1 = plus, 0 = single px)
const SPOTS = Int8Array.from([-6, -3, 1, 0, -5, 1, 6, -2, 1, -2, -1, 0, 3, -5, 0])

function mushroom(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 7)
    let lift = 0
    let sq = frame(p.t, 3, 6) < 3 ? 0 : 1
    if (p.moving) {
        const f = frame(p.walk, 9, 8)
        lift = HOP_Y[f]!
        sq = Math.max(-1, Math.min(1, HOP_S[f]!))
    }
    if (wind > 0) sq = R(wind * 2)
    if (strike) { sq = -1; lift = 1 }
    if (hurt) sq = 1
    const cx = ax - lunge + kb
    const by = ay - lift
    const sh = 8 - sq
    const tilt = strike ? -3 : R(wind * 2) + (hurt ? 2 : 0)
    const fs = lift > 0 ? 1 : 0

    // feet
    rect(g, cx + 1 - fs, by - 2, 4, 2, C.brown1)
    rect(g, cx - 5 + fs, by - 2, 4, 2, C.brown2)
    px(g, cx - 5 + fs, by - 2, C.brown3)

    // stem
    const st = by - 1 - sh
    rect(g, cx + 4, st + 4, 1, 1, C.bone0)
    rect(g, cx + 5, st + 5, 1, 1, C.bone0)
    rect(g, cx - 4, st, 8, sh, C.bone1)
    rect(g, cx + 2, st, 2, sh, C.bone0)
    rect(g, cx - 3, st + 2, 1, Math.max(1, sh - 3), C.white)

    // face
    const fx = cx + (tilt < 0 ? -1 : 0)
    const ey = st + 3
    line(g, fx - 5, ey - 2, fx - 2, ey - 1, C.ink)
    line(g, fx + 3, ey - 2, fx, ey - 1, C.ink)
    if (hurt) {
        rect(g, fx - 3, ey + 1, 2, 1, C.ink)
        rect(g, fx, ey + 1, 2, 1, C.ink)
    } else if (blinking(p.t, 13)) {
        rect(g, fx - 3, ey + 1, 2, 1, C.ink)
        rect(g, fx, ey + 1, 2, 1, C.ink)
    } else {
        rect(g, fx - 3, ey, 2, 2, C.ink)
        rect(g, fx, ey, 2, 2, C.ink)
        if (strike || wind > 0.5) {
            px(g, fx - 3, ey + 1, C.red3)
            px(g, fx, ey + 1, C.red3)
        }
    }
    const my = Math.min(ey + 3, by - 4)
    if (strike || wind > 0.5 || hurt) {
        rect(g, fx - 3, my, 4, 2, C.ink)
        px(g, fx - 2, my + 1, C.red1)
    } else {
        rect(g, fx - 2, my, 2, 1, C.ink)
        px(g, fx - 3, my + 1, C.ink)
        px(g, fx, my + 1, C.ink)
    }

    // stubby front arm
    if (strike || wind > 0) {
        px(g, cx - 5, st + 3, C.bone0)
        px(g, cx - 6, st + 2, C.bone0)
    } else {
        px(g, cx - 5, st + 4, C.bone0)
        px(g, cx - 6, st + 5 + (frame(p.t, 3, 4) < 2 ? 0 : -1), C.bone0)
    }

    // cap
    const ccx = cx + tilt
    const cb = st - 1 + (sq > 0 ? 1 : 0)
    const crx = 11 + (sq > 0 ? 1 : 0)
    const ch = 7 - (sq > 0 ? 1 : 0)
    const csk = strike ? -2 : 0
    dome(g, ccx, cb, crx, ch, C.red1, csk)
    dome(g, ccx - 1, cb - 1, crx - 2, ch - 1, C.red2, csk)
    rect(g, ccx - 5, cb - ch + 1, 4, 1, C.red3)
    px(g, ccx - 6, cb - ch + 2, C.red3)
    px(g, ccx - 4, cb - ch + 1, C.white)
    for (let i = 0; i < SPOTS.length; i += 3) {
        const sx = ccx + SPOTS[i]!
        const sy = cb + SPOTS[i + 1]!
        if (SPOTS[i + 2]!) {
            disc(g, sx, sy, 1, sx > ccx + 3 ? C.bone1 : C.white)
            px(g, sx + 1, sy, C.bone1)
        } else {
            px(g, sx, sy, C.bone1)
        }
    }
    rect(g, ccx - crx + 2, cb + 1, crx * 2 - 3, 1, C.bone0)
    for (let x = ccx - crx + 3; x < ccx + crx - 1; x += 2) px(g, x, cb + 1, C.brown2)

    // spores drifting off the cap
    const q = Math.floor(p.t * 6)
    for (let i = 0; i < 2; i++) {
        const ph = (q + i * 5) % 10
        if (ph < 8) px(g, ccx - 4 + i * 7 + ((ph >> 2) & 1), cb - ch - 2 - ph, i ? C.gold3 : C.green4)
    }
    if (strike) {
        for (let i = 0; i < 6; i++) {
            px(g, cx - 10 - R(hash(i * 3 + 1) * 6), cb - 2 + R(hash(i * 5 + 2) * 8), i & 1 ? C.green4 : C.green3)
        }
    }
}

// ---------------------------------------------------------------- wolf

const RUN_X = Int8Array.from([-4, -2, 0, 2, 4, 2, -1, -3])
const RUN_Y = Int8Array.from([0, 0, 0, 0, 1, 3, 3, 1])
const RUN_B = Int8Array.from([0, 1, 1, 0, 0, -1, -1, 0])

function wolfLeg(g: G, hx: number, hy: number, fx: number, fy: number, hind: boolean, c: string, hi: string | null): void {
    const kx = ((hx + fx) >> 1) + (hind ? 2 : -1)
    const ky = ((hy + fy) >> 1) - (hind ? 1 : 0)
    line(g, hx, hy, kx, ky, c, 2)
    line(g, kx, ky, fx, fy - 1, c)
    rect(g, fx - 2, fy - 1, 3, 1, c)
    if (hi) px(g, kx - 1, ky - 1, hi)
}

function wolf(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 9)
    const run = p.moving && !strike && wind === 0
    const f = run ? frame(p.walk, 12, 8) : 0
    const br = run ? 0 : (frame(p.t, 2, 4) < 2 ? 0 : 1)
    const bx = ax + 2 - lunge + kb
    const by = ay - 10 + (run ? RUN_B[f]! : 0) + R(wind * 2) - (strike ? 3 : 0)
    const fh = bx - 6
    const hh = bx + 6

    let dFN = -1, lFN = 0, dFF = 1, lFF = 0, dHN = 0, lHN = 0, dHF = 2, lHF = 0
    if (run) {
        const b = (f + 1) & 7
        const c = (f + 4) & 7
        const d = (f + 5) & 7
        dFN = RUN_X[f]!; lFN = RUN_Y[f]!
        dFF = RUN_X[b]!; lFF = RUN_Y[b]!
        dHN = RUN_X[c]!; lHN = RUN_Y[c]!
        dHF = RUN_X[d]!; lHF = RUN_Y[d]!
    } else if (strike) {
        dFN = -6; lFN = 5; dFF = -5; lFF = 3; dHN = 5; lHN = 1; dHF = 6; lHF = 0
    } else if (wind > 0) {
        dFN = -2; dHN = 3; dHF = 4
    }

    // tail
    let tx = bx + 16
    let ty = by - 6 + wave(p.t, 1.3, 2)
    if (run) { tx = bx + 17; ty = by - 4 + (f & 1) }
    if (wind > 0) { tx = bx + 15; ty = by - 9 }
    if (strike) { tx = bx + 18; ty = by - 3 }
    if (hurt) { tx = bx + 13; ty = by + 3 }
    const tbx = bx + 9
    const tby = by - 2
    const tmx = (tbx + tx) >> 1
    const tmy = ((tby + ty) >> 1) - 1
    line(g, tbx, tby, tmx, tmy, C.steel1, 3)
    line(g, tmx, tmy, tx, ty, C.steel1, 2)
    line(g, tbx, tby - 1, tmx, tmy - 1, C.steel2)
    px(g, tx, ty, C.steel0)

    // far legs
    wolfLeg(g, fh + 2, by + 1, fh + 2 + dFF, ay - lFF, false, C.steel0, null)
    wolfLeg(g, hh + 1, by + 1, hh + 1 + dHF, ay - lHF, true, C.steel0, null)

    // body
    ellipse(g, bx, by, 9, 4, C.steel0)
    ellipse(g, bx - 1, by - 1, 8, 3, C.steel1)
    ellipse(g, bx - 6, by, 4, 4, C.steel1)
    ellipse(g, bx + 6, by - 1, 4, 3, C.steel1)
    rect(g, bx - 5, by - 4, 9, 1, C.steel2)
    px(g, bx - 3, by - 4, C.steel3)
    px(g, bx + 5, by - 3, C.steel2)
    rect(g, bx - 3, by + 3, 7, 1, C.steel0)
    rect(g, bx - 10, by + 1, 2, 3, C.steel2)

    // near legs
    wolfLeg(g, fh, by + 2, fh + dFN, ay - lFN, false, C.steel1, C.steel2)
    wolfLeg(g, hh, by + 1, hh + dHN, ay - lHN, true, C.steel1, C.steel2)

    // neck, mane, head
    const hx = bx - 12 - (strike ? 2 : 0)
    const hy = by - 5 + R(wind * 2) - (hurt ? 2 : 0) + br
    line(g, bx - 7, by - 1, hx + 2, hy + 1, C.steel1, 4)
    for (let i = 1; i <= 2; i++) {
        const mx = R(hx + 3 + (bx - 6 - hx - 3) * i / 3)
        const my = R(hy - 1 + (by - 4 - hy + 1) * i / 3)
        tri(g, mx - 2, my + 1, mx + 2, my + 1, mx + 2, my - 3, C.steel0)
    }
    tri(g, hx + 2, hy - 2, hx + 4, hy - 2, hx + 4, hy - 6, C.steel0)
    disc(g, hx + 1, hy, 3, C.steel1)
    rect(g, hx - 6, hy - 1, 6, 3, C.steel1)
    rect(g, hx - 5, hy - 1, 6, 1, C.steel2)
    px(g, hx + 1, hy - 3, C.steel2)
    rect(g, hx - 7, hy - 1, 2, 2, C.ink)
    const tw = !run && blinking(p.t, 11) ? 1 : 0
    tri(g, hx, hy - 2, hx + 2, hy - 2, hx + 1 - tw, hy - 6 + tw, C.steel1)
    px(g, hx + 1, hy - 4, C.steel0)

    const open = strike ? 3 : wind > 0 ? 1 + R(wind) : hurt ? 1 : 0
    rect(g, hx - 1, hy + 1, 3, 2 + open, C.steel1)
    if (open > 0) {
        rect(g, hx - 5, hy + 2, 5, open, C.red1)
        px(g, hx - 5, hy + 2, C.white)
        px(g, hx - 3, hy + 2, C.white)
        px(g, hx - 4, hy + 1 + open, C.white)
    }
    rect(g, hx - 5, hy + 2 + open, 6, 1, C.steel0)
    px(g, hx + 2, hy + 2, C.steel2)

    const ex = hx - 2
    const ey = hy - 2
    if (hurt) {
        rect(g, ex, ey, 2, 1, C.ink)
    } else if (!strike && wind === 0 && blinking(p.t, 5)) {
        rect(g, ex, ey, 2, 1, C.steel0)
    } else {
        rect(g, ex, ey, 2, 1, strike || wind > 0 ? C.red3 : C.gold2)
        px(g, ex + 1, ey - 1, C.ink)
    }
    if (strike) trail = C.steel1
}

// ---------------------------------------------------------------- king slime

function crown(g: G, x: number, y: number, glint: boolean): void {
    tri(g, x - 6, y - 3, x - 4, y - 3, x - 6, y - 7, C.gold2)
    tri(g, x - 1, y - 3, x + 1, y - 3, x, y - 8, C.gold2)
    tri(g, x + 4, y - 3, x + 6, y - 3, x + 6, y - 7, C.gold1)
    rect(g, x - 6, y - 2, 13, 3, C.gold1)
    rect(g, x - 6, y - 2, 13, 1, C.gold2)
    rect(g, x - 6, y, 13, 1, C.gold0)
    px(g, x - 6, y - 5, C.gold3)
    px(g, x - 6, y - 8, C.gold3)
    px(g, x, y - 9, C.gold3)
    px(g, x + 6, y - 8, C.gold2)
    disc(g, x, y - 1, 1, C.red2)
    px(g, x - 1, y - 1, C.red3)
    px(g, x - 4, y - 1, C.cyan)
    px(g, x + 4, y - 1, C.blue2)
    if (glint) {
        px(g, x, y - 11, C.white)
        px(g, x - 1, y - 10, C.white)
        px(g, x + 1, y - 10, C.white)
        px(g, x, y - 10, C.white)
    }
}

function kingSlime(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 7)
    let lift = 0
    let sq = wave(p.t, 1.1, 1)
    if (p.moving) {
        const f = frame(p.walk, 7, 8)
        lift = HOP_Y[f]!
        sq = HOP_S[f]! * 2
    }
    if (wind > 0) sq = R(wind * 4)
    if (strike) { sq = -3; lift = 3 }
    if (hurt) sq = -2
    const cx = ax - lunge + kb
    const by = ay - lift
    const rx = 19 + sq
    const h = 24 - R(sq * 1.5)
    const sk = strike ? -6 : R(wind * 3) + (hurt ? 3 : 0)

    dome(g, cx, by - 1, rx, h, C.green1, sk)
    rect(g, cx - rx + 2, by, rx * 2 - 3, 1, C.green0)
    dome(g, cx - 2, by - 3, rx - 3, h - 3, C.green2, sk)
    rect(g, cx - rx + 3, by - 2, 6, 1, C.green3)
    px(g, cx - rx + 2, by - 3, C.green3)

    // gooey core with a beating heart
    const beat = frame(p.t, 5, 8)
    const pr = beat === 0 || beat === 2 ? 1 : 0
    const ccx = cx + 5 + skew(sk, 0.4)
    const ccy = by - R(h * 0.38)
    disc(g, ccx, ccy, 6, C.green1)
    dither(g, ccx - 5, ccy - 5, 11, 11, C.green2, 1)
    disc(g, ccx, ccy, 3 + pr, C.red0)
    disc(g, ccx, ccy, 2 + pr, C.red1)
    disc(g, ccx - 1, ccy - 1, 1, C.red2)
    px(g, ccx - 1, ccy - 2, pr ? C.white : C.red3)

    // bubbles
    for (let i = 0; i < 3; i++) {
        const ph = (Math.floor(p.t * 5) + i * 5) % 16
        if (ph >= h - 8) continue
        const bxx = cx - 9 + i * 7 + skew(sk, ph / h)
        const byy = by - 4 - ph
        if (i === 1) ring(g, bxx, byy, 1, C.green3)
        else px(g, bxx, byy, C.green4)
    }

    // highlight
    const hy = by - R(h * 0.8)
    const hx = cx - R(rx * 0.5) + skew(sk, 0.8)
    ellipse(g, hx, hy + 1, 3, 1, C.green3)
    rect(g, hx - 2, hy, 3, 1, C.white)
    px(g, hx - 3, hy + 1, C.white)
    px(g, hx - 5, hy + 4, C.green3)
    px(g, hx - 6, hy + 6, C.green3)

    // face
    const ey = by - R(h * 0.58)
    const e1 = cx - 13 + skew(sk, 0.58) + (strike ? -2 : 0)
    const e2 = e1 + 7
    if (hurt) {
        xEye(g, e1, ey - 1, C.ink)
        xEye(g, e2, ey - 1, C.ink)
    } else if (!strike && wind === 0 && blinking(p.t, 7)) {
        rect(g, e1, ey + 1, 4, 1, C.ink)
        rect(g, e2, ey + 1, 4, 1, C.ink)
    } else {
        rect(g, e1, ey - 2, 4, 5, C.white)
        rect(g, e2, ey - 2, 4, 5, C.white)
        rect(g, e1, ey - 2, 4, 1, C.steel3)
        rect(g, e2, ey - 2, 4, 1, C.steel3)
        const pu = wind > 0 || strike ? 1 : 2
        rect(g, e1, ey, pu, 3, C.ink)
        rect(g, e2, ey, pu, 3, C.ink)
    }
    line(g, e1 - 1, ey - 4, e1 + 3, ey - 3, C.green0, 2)
    line(g, e2 + 4, ey - 4, e2 + 1, ey - 3, C.green0, 2)

    const mx = e1 + 5
    const my = ey + 6
    if (strike || wind > 0.3) {
        const mh = strike ? 4 : 1 + R(wind * 2)
        rect(g, mx - 3, my, 7, mh, C.ink)
        rect(g, mx - 2, my + mh, 5, 1, C.ink)
        rect(g, mx - 1, my + mh - 1, 3, 1, C.red1)
    } else if (hurt) {
        rect(g, mx - 1, my, 3, 2, C.ink)
    } else {
        rect(g, mx - 2, my, 5, 1, C.ink)
        px(g, mx - 3, my + 1, C.ink)
        px(g, mx + 3, my + 1, C.ink)
    }

    // crown lags behind the body's motion
    const kx = cx + 2 + sk + (strike ? 3 : 0)
    const ky = by - h - (lift >= 4 ? 2 : 0) - (wind >= 1 ? 1 : 0)
    crown(g, kx, ky, frame(p.t, 6, 14) === 0)
}

// ---------------------------------------------------------------- goblin

const STEP_X = Int8Array.from([-2, -1, 0, 1, 2, 1, 0, -1])
const STEP_Y = Int8Array.from([0, 0, 0, 0, 0, 1, 2, 1])

function goblin(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 8)
    const walk = p.moving
    const w = frame(p.walk, 10, 8)
    const bob = walk && (w & 3) === 0 ? 1 : 0
    const br = walk ? 0 : (frame(p.t, 2.5, 4) < 2 ? 0 : 1)
    const cx = ax - lunge + kb
    const hip = ay - 5 + bob + (wind > 0.5 ? 1 : 0)
    const lean = strike ? -2 : R(wind * 2) + (hurt ? 1 : 0)
    const ln = lean >> 1
    const top = hip - 7 + br

    let nX = -1, nY = 0, fX = 1, fY = 0
    if (walk) {
        const o = (w + 4) & 7
        nX = STEP_X[w]!; nY = STEP_Y[w]!
        fX = STEP_X[o]!; fY = STEP_Y[o]!
    }
    if (wind > 0) { nX = -2; fX = 2; nY = 0; fY = 0 }
    if (strike) { nX = -4; fX = 3; nY = 0; fY = 0 }

    // far leg + back arm
    line(g, cx + 1, hip, cx + 1 + fX, ay - 1 - fY, C.green1, 2)
    rect(g, cx - 2 + fX, ay - 1 - fY, 3, 1, C.brown0)
    line(g, cx + 3 + ln, top + 1, cx + 5 + ln, top + 5, C.green1)
    px(g, cx + 5 + ln, top + 6, C.green1)

    // tunic
    rect(g, cx - 3 + ln, top, 7, hip - top, C.brown2)
    rect(g, cx + 2 + ln, top, 2, hip - top, C.brown1)
    rect(g, cx - 3 + ln, top + 1, 1, hip - top - 2, C.brown3)
    rect(g, cx - 3 + ln, hip - 2, 7, 1, C.brown0)
    px(g, cx - 1 + ln, hip - 2, C.gold2)
    px(g, cx - 3 + ln, hip, C.brown2)
    px(g, cx - 1 + ln, hip, C.brown2)
    px(g, cx + 1 + ln, hip, C.brown1)
    px(g, cx + 3 + ln, hip, C.brown1)

    // near leg
    line(g, cx - 1, hip + 1, cx - 1 + nX, ay - 1 - nY, C.green2, 2)
    rect(g, cx - 5 + nX, ay - 1 - nY, 4, 1, C.brown1)

    // head
    const hx = cx - 1 + lean + (hurt ? 1 : 0)
    const hy = top - 8 + (hurt ? -1 : 0)
    const et = blinking(p.t, 17) ? 1 : 0
    tri(g, hx + 2, hy + 3, hx + 2, hy + 6, hx + 9, hy + 1 + et, C.green1)
    tri(g, hx - 3, hy + 3, hx - 3, hy + 6, hx - 9, hy + 2 - et, C.green2)
    line(g, hx - 4, hy + 4, hx - 7, hy + 3, C.green1)
    ellipse(g, hx, hy + 4, 4, 4, C.green1)
    ellipse(g, hx - 1, hy + 3, 3, 3, C.green2)
    px(g, hx - 3, hy + 5, C.green3)
    // leather cap
    dome(g, hx, hy + 1, 4, 3, C.brown1)
    rect(g, hx - 2, hy - 1, 3, 1, C.brown2)
    px(g, hx - 1, hy - 2, C.brown3)
    rect(g, hx - 5, hy + 1, 8, 1, C.brown0)
    // eyes
    if (hurt) {
        line(g, hx - 4, hy + 2, hx - 3, hy + 3, C.ink)
        px(g, hx - 1, hy + 3, C.ink)
    } else if (blinking(p.t, 9) && wind === 0) {
        rect(g, hx - 4, hy + 3, 2, 1, C.green0)
    } else {
        rect(g, hx - 4, hy + 2, 2, 2, strike ? C.gold3 : C.gold2)
        px(g, hx - 4, hy + 3, C.ink)
        rect(g, hx - 1, hy + 2, 1, 2, C.gold1)
    }
    // hooked nose
    px(g, hx - 5, hy + 3, C.green2)
    rect(g, hx - 7, hy + 4, 4, 1, C.green2)
    px(g, hx - 7, hy + 5, C.green1)
    // mouth
    if (strike || wind > 0.4 || hurt) {
        rect(g, hx - 4, hy + 6, 4, 2, C.red0)
        px(g, hx - 3, hy + 6, C.white)
        px(g, hx - 1, hy + 7, C.white)
    } else {
        rect(g, hx - 4, hy + 6, 3, 1, C.green0)
        px(g, hx - 3, hy + 7, C.white)
    }

    // front arm + dagger
    const sx = cx - 2 + ln
    const sy = top + 2
    const hdx = R(cx + pz(-6, 4, -11))
    const hdy = R(top + pz(5, -3, 3))
    const a = pz(-135, -60, -180) * DEG
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    line(g, R(hdx + ux), R(hdy + uy), R(hdx + ux * 7), R(hdy + uy * 7), C.steel2)
    px(g, R(hdx + ux * 3), R(hdy + uy * 3), C.steel3)
    px(g, R(hdx + ux * 7), R(hdy + uy * 7), C.white)
    px(g, R(hdx + ux - uy * 1.5), R(hdy + uy + ux * 1.5), C.gold1)
    px(g, R(hdx + ux + uy * 1.5), R(hdy + uy - ux * 1.5), C.gold1)
    px(g, R(hdx - ux * 2), R(hdy - uy * 2), C.brown0)
    line(g, sx, sy, hdx, hdy, C.green2, 2)
    px(g, hdx, hdy, C.green3)
    if (strike) smear(g, sx, sy, 12, -178, -70)
}

// ---------------------------------------------------------------- spider

const SP_FOOT = Int8Array.from([-13, -7, 3, 10])
const SP_KNEE = Int8Array.from([-6, -8, -8, -6])
const LEG4_X = Int8Array.from([-2, 0, 2, 0])
const LEG4_Y = Int8Array.from([0, 0, 0, 2])

function spider(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 8)
    const walk = p.moving
    const f = walk ? frame(p.walk, 12, 4) : 0
    const bob = walk ? (f & 1) : (frame(p.t, 2, 4) < 2 ? 0 : 1)
    const cx = ax - lunge + kb
    const rear = R(wind * 4) + (hurt ? 1 : 0)
    const by = ay - 7 + bob + (strike ? 1 : 0)
    const tx = cx - 3
    const ty = by - rear
    const abx = cx + 6
    const aby = by - 3 + (rear >> 1)
    const q = Math.floor(p.t * 6)

    for (let side = 1; side >= 0; side--) {
        const c = side ? C.purple0 : C.purple1
        for (let i = 0; i < 4; i++) {
            const grp = (i + side) & 1
            const s = walk ? (grp ? (f + 2) & 3 : f) : 0
            const hx = tx - 1 + i * 2 + side
            const hy = ty + 1
            let fx = cx + SP_FOOT[i]! + LEG4_X[s]! + side * 2
            let fy = ay - LEG4_Y[s]!
            let kx = ((hx + fx) >> 1) + (i < 2 ? -1 : 1)
            let ky = by + SP_KNEE[i]! - side
            if (!walk && (q + i * 5 + side * 11) % 23 === 0) { fy -= 1; fx -= 1 }
            if (i < 2 && wind > 0) {
                fx = tx - 7 - i * 3 + side
                fy = ty - 9 + i * 5 + wave(p.t, 0.4, 1, i * 0.25)
                kx = tx - 3 - i
                ky = ty - 9 + i * 2
            } else if (i < 2 && strike) {
                fx = cx - 17 + i * 3 + side
                fy = ay - 2 + i
                kx = cx - 9 + i
                ky = ty - 6
            }
            if (hurt) {
                fx = (fx + hx) >> 1
                fy -= 2
            }
            line(g, hx, hy, kx, ky, c, side ? 1 : 2)
            line(g, kx, ky, fx, fy, c)
            if (!side) px(g, kx, ky - 1, C.purple2)
        }
    }

    // abdomen
    ellipse(g, abx, aby, 7, 5, C.purple0)
    ellipse(g, abx - 1, aby - 1, 6, 4, C.purple1)
    ellipse(g, abx - 3, aby - 3, 2, 1, C.purple2)
    px(g, abx - 4, aby - 4, C.pink)
    rect(g, abx, aby - 3, 3, 1, C.red2)
    px(g, abx + 1, aby - 2, C.red2)
    rect(g, abx, aby - 1, 3, 1, C.red2)
    px(g, abx, aby - 3, C.red3)
    px(g, abx + 7, aby + 1, C.purple0)

    // thorax + face
    ellipse(g, tx, ty, 4, 3, C.purple0)
    ellipse(g, tx - 1, ty - 1, 3, 2, C.purple1)
    px(g, tx - 2, ty - 3, C.purple2)
    px(g, tx - 1, ty - 3, C.purple2)
    if (hurt) {
        rect(g, tx - 5, ty - 1, 2, 1, C.ink)
        px(g, tx - 2, ty - 2, C.ink)
    } else {
        const glow = wind > 0 || strike
        rect(g, tx - 5, ty - 2, 2, 2, glow ? C.red3 : C.red2)
        px(g, tx - 5, ty - 2, glow ? C.white : C.red3)
        px(g, tx - 3, ty - 3, C.red2)
        px(g, tx - 1, ty - 3, C.red1)
        px(g, tx - 3, ty, C.red1)
    }
    const clack = strike ? 2 : wind > 0.5 ? 1 : frame(p.t, 5, 6) === 0 ? 1 : 0
    px(g, tx - 5 - clack, ty + 1, C.bone1)
    px(g, tx - 6 - clack, ty + 2, C.bone0)
    px(g, tx - 3, ty + 1, C.bone1)
    px(g, tx - 3 + (clack >> 1), ty + 2, C.bone0)
    if (wind > 0.4) px(g, tx - 5, ty + 3 + (q % 3), C.green3)
}

// ---------------------------------------------------------------- treant

const GLOW6: readonly string[] = [C.gold1, C.gold2, C.gold3, C.gold3, C.gold2, C.gold1]
// leaf clump dx, dy (from canopy centre), radius
const LEAVES = Int8Array.from([-6, -1, 4, 5, -2, 5, -1, -6, 5, 6, -8, 3, -7, -7, 3])

function treant(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 6)
    const walk = p.moving
    const f = walk ? frame(p.walk, 8, 4) : 0
    const cx = ax - lunge + kb
    const bob = walk ? (f & 1) : 0
    const sway = walk ? (f < 2 ? -1 : 0) : wave(p.t, 3, 1)
    const lean = strike ? -3 : R(wind * 2) + (hurt ? 1 : 0)
    const base = ay - 3 + bob
    const top = ay - 24 + bob
    const span = base - top

    // back arm
    line(g, cx + 4 + lean, top + 5, cx + 10 + lean, top + 11, C.brown1, 2)
    line(g, cx + 10 + lean, top + 11, cx + 12 + lean, top + 14, C.brown1)
    px(g, cx + 12 + lean, top + 10, C.green2)

    // trunk
    for (let y = top; y <= base; y++) {
        const half = 5 + (((y - top) / 12) | 0)
        const off = R(lean * (base - y) / span)
        const x0 = cx - half + off
        rect(g, x0, y, half * 2, 1, C.brown2)
        rect(g, x0 + half * 2 - 3, y, 3, 1, C.brown1)
        px(g, x0 + 1, y, C.brown3)
        if (y % 5 !== 0) px(g, cx - 1 + off, y, C.brown1)
        if ((y + 2) % 4 !== 0) px(g, cx + 2 + off, y, C.brown1)
        if (y < top + 4) px(g, x0 + 2 + (y & 1), y, C.green2)
    }
    const kn = R(lean * 0.3)
    disc(g, cx + 1 + kn, base - 5, 1, C.brown1)
    px(g, cx + kn, base - 6, C.brown0)

    // roots (feet)
    const lA = walk && f === 1 ? 2 : 0
    const lB = walk && f === 3 ? 2 : 0
    line(g, cx + 4, base, cx + 9, ay - lB, C.brown1, 2)
    line(g, cx, base, cx - 1, ay, C.brown1, 2)
    line(g, cx - 4, base, cx - 9, ay - lA, C.brown2, 2)
    px(g, cx - 10, ay - 1 - lA, C.brown3)
    px(g, cx - 6, base, C.green2)

    // face
    const oe = R(lean * (span - 6) / span)
    const ey = top + 6
    const ex1 = cx - 5 + oe
    const ex2 = cx - 1 + oe
    rect(g, ex1, ey, 3, 2, C.ink)
    rect(g, ex2, ey, 3, 2, C.ink)
    if (!hurt) {
        const gc = wind > 0 || strike ? C.white : GLOW6[frame(p.t, 5, 6)]!
        rect(g, ex1, ey, 2, 1, gc)
        rect(g, ex2, ey, 2, 1, gc)
        if (wind > 0.5 || strike) {
            px(g, ex1, ey + 1, C.gold2)
            px(g, ex2, ey + 1, C.gold2)
        }
    }
    line(g, ex1 - 1, ey - 2, ex1 + 2, ey - 1, C.brown3)
    line(g, ex2 + 3, ey - 2, ex2, ey - 1, C.brown3)
    px(g, cx - 3 + oe, ey + 3, C.brown3)
    const open = strike ? 2 : R(wind * 2) + (hurt ? 1 : 0)
    const om = R(lean * (span - 11) / span)
    rect(g, cx - 5 + om, top + 11, 5, 2 + open, C.ink)
    px(g, cx - 4 + om, top + 11, C.brown2)
    px(g, cx - 2 + om, top + 11, C.brown2)
    px(g, cx - 3 + om, top + 12 + open, C.brown2)

    // canopy
    const kx = cx + lean + sway
    const ky = top - 5
    line(g, cx - 2 + lean, top, kx - 4, ky + 1, C.brown1, 2)
    line(g, cx + 2 + lean, top, kx + 5, ky, C.brown1, 2)
    const rq = Math.floor(p.t * 4)
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < LEAVES.length; i += 3) {
            const rs = (rq + i) % 5 === 0 ? 1 : 0
            const lx = kx + LEAVES[i]! + rs
            const ly = ky + LEAVES[i + 1]!
            const r = LEAVES[i + 2]!
            if (pass === 0) disc(g, lx, ly, r, C.green1)
            else if (pass === 1) disc(g, lx - 1, ly - 1, r - 1, C.green2)
            else if (r > 3) {
                disc(g, lx - 2, ly - 2, r - 3, C.green3)
                px(g, lx - 3, ly - r + 1, C.green4)
            }
        }
    }
    const lf = frame(p.t, 6, 24)
    if (lf < 16) px(g, kx + 8 + ((lf >> 2) & 1), ky + 2 + lf, C.green3)
    if (strike) {
        for (let i = 0; i < 4; i++) px(g, kx - 8 + R(hash(i * 5 + 3) * 18), ky - 6 + R(hash(i * 7 + 1) * 12), C.green4)
    }

    // front arm
    const sx = cx - 5 + lean
    const sy = top + 5
    const hx = R(cx + pz(-11, -3, -17))
    const hy = R(top + pz(12, -9, 20))
    const elx = ((sx + hx) >> 1) - 1
    const ely = ((sy + hy) >> 1) + 1
    line(g, sx, sy, elx, ely, C.brown2, 3)
    line(g, elx, ely, hx, hy, C.brown2, 2)
    px(g, elx - 1, ely - 1, C.brown3)
    const aa = Math.atan2(hy - ely, hx - elx)
    for (let k = -1; k <= 1; k++) {
        const b = aa + k * 0.6
        line(g, hx, hy, R(hx + Math.cos(b) * 3), R(hy + Math.sin(b) * 3), C.brown1)
    }
    if (strike) {
        arc(g, sx, sy, 15, -205, -100, C.white)
        arc(g, sx, sy, 14, -205, -100, C.green4)
        arc(g, sx, sy, 13, -205, -150, C.green3)
    }
}

// ---------------------------------------------------------------- ogre

function club(g: G, hx: number, hy: number, a: number): void {
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const nx = -uy
    const ny = ux
    const s = ny < 0 ? 1 : -1
    line(g, R(hx - ux * 3), R(hy - uy * 3), R(hx + ux * 9), R(hy + uy * 9), C.brown1, 2)
    line(g, R(hx + ux * 9), R(hy + uy * 9), R(hx + ux * 15), R(hy + uy * 15), C.brown2, 4)
    line(g, R(hx + ux * 14), R(hy + uy * 14), R(hx + ux * 21), R(hy + uy * 21), C.brown2, 6)
    line(g, R(hx + ux * 10 + nx * s), R(hy + uy * 10 + ny * s), R(hx + ux * 21 + nx * s * 2), R(hy + uy * 21 + ny * s * 2), C.brown3)
    line(g, R(hx + ux * 11 - nx * s), R(hy + uy * 11 - ny * s), R(hx + ux * 21 - nx * s * 2), R(hy + uy * 21 - ny * s * 2), C.brown1)
    line(g, R(hx + ux * 12 + nx * 2), R(hy + uy * 12 + ny * 2), R(hx + ux * 12 - nx * 2), R(hy + uy * 12 - ny * 2), C.steel1)
    for (let i = 0; i < 3; i++) {
        const d = 15 + i * 3
        for (let k = -1; k <= 1; k += 2) {
            const bx = hx + ux * d + nx * k * 3.5
            const by = hy + uy * d + ny * k * 3.5
            px(g, R(bx), R(by), C.steel2)
            px(g, R(bx + nx * k), R(by + ny * k), C.steel3)
        }
    }
    px(g, R(hx + ux * 23), R(hy + uy * 23), C.steel3)
}

function ogre(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 6)
    const walk = p.moving
    const f = walk ? frame(p.walk, 6, 4) : 0
    const br = walk ? 0 : (frame(p.t, 1.6, 4) < 2 ? 0 : 1)
    const cx = ax - lunge + kb
    const hip = ay - 12 + (walk && (f & 1) ? -1 : 0) + R(wind * 2) + (strike ? 1 : 0)
    const lean = strike ? -3 : R(wind * 2) + (hurt ? 1 : 0)
    let nd = 0, nl = 0, fd = 0, fl = 0
    if (walk) {
        if (f === 1) { nd = -2; nl = 2 } else if (f === 3) { fd = -2; fl = 2 }
    }
    if (strike) { nd = -3; fd = 2 }

    // far leg
    rect(g, cx + 3 + fd, hip, 5, ay - hip - 2 - fl, C.skin0)
    rect(g, cx + 2 + fd, ay - 3 - fl, 7, 3, C.brown0)

    // back arm
    const bsx = cx + 8 + lean
    const bsy = hip - 16 + br
    const bhx = cx + 12 + (lean >> 1)
    line(g, bsx, bsy, bhx, hip - 4, C.skin0, 4)
    disc(g, bhx, hip - 3, 2, C.skin0)
    px(g, bhx - 1, hip - 4, C.skin1)
    rect(g, bsx - 1, bsy + 4, 4, 1, C.gold1)

    // near leg
    rect(g, cx - 6 + nd, hip, 6, ay - hip - 2 - nl, C.skin1)
    rect(g, cx - 1 + nd, hip, 1, ay - hip - 2 - nl, C.skin0)
    px(g, cx - 5 + nd, hip + 5, C.skin2)
    rect(g, cx - 6 + nd, ay - 6 - nl, 6, 1, C.brown3)
    rect(g, cx - 8 + nd, ay - 3 - nl, 8, 3, C.brown1)
    rect(g, cx - 8 + nd, ay - 3 - nl, 7, 1, C.brown2)

    // belly
    const bx = cx + (lean >> 1)
    ellipse(g, bx, hip - 10, 11 + br, 9, C.skin0)
    ellipse(g, bx - 1, hip - 11, 10 + br, 8, C.skin1)
    ellipse(g, bx - 3, hip - 8, 5, 4, C.skin2)
    px(g, bx - 2, hip - 6, C.skin0)
    line(g, bx - 9, hip - 15, bx - 2, hip - 13, C.skin0)
    px(g, bx + 4, hip - 14, C.red1)
    px(g, bx + 5, hip - 13, C.red1)
    px(g, bx + 6, hip - 12, C.red1)

    // loincloth
    rect(g, cx - 8, hip - 3, 17, 5, C.brown2)
    rect(g, cx + 4, hip - 3, 5, 5, C.brown1)
    tri(g, cx - 6, hip + 2, cx, hip + 2, cx - 3, hip + 6, C.brown2)
    px(g, cx - 2, hip + 3, C.brown1)
    rect(g, cx - 9, hip - 4, 19, 2, C.brown0)
    rect(g, cx - 4, hip - 5, 3, 3, C.bone1)
    px(g, cx - 4, hip - 4, C.ink)
    px(g, cx - 2, hip - 4, C.ink)

    // head
    const hx = cx - 7 + lean
    const hy = hip - 21 + br + (hurt ? -1 : 0)
    const sw = wave(p.t, 1.2, 1)
    line(g, hx + 1, hy - 5, hx + 3 + sw, hy - 9, C.brown0, 2)
    px(g, hx + 1, hy - 5, C.gold1)
    ellipse(g, hx + 5, hy, 2, 2, C.skin0)
    ellipse(g, hx, hy, 6, 5, C.skin0)
    ellipse(g, hx - 1, hy - 1, 5, 4, C.skin1)
    px(g, hx - 3, hy - 4, C.skin2)
    px(g, hx - 2, hy - 4, C.skin2)
    px(g, hx + 6, hy + 3, C.gold2)
    px(g, hx + 6, hy + 2, C.gold1)
    rect(g, hx - 6, hy - 2, 8, 2, C.skin0)
    if (hurt) {
        rect(g, hx - 5, hy, 2, 1, C.ink)
        rect(g, hx - 1, hy, 2, 1, C.ink)
    } else if (wind === 0 && !strike && blinking(p.t, 21)) {
        rect(g, hx - 5, hy, 2, 1, C.skin0)
        rect(g, hx - 1, hy, 2, 1, C.skin0)
    } else {
        const ec = wind > 0 || strike ? C.gold3 : C.red2
        rect(g, hx - 5, hy, 2, 1, ec)
        rect(g, hx - 1, hy, 2, 1, ec)
        px(g, hx - 5, hy, C.red3)
    }
    rect(g, hx + 1, hy + 1, 3, 1, C.red1)
    rect(g, hx - 8, hy, 2, 3, C.skin1)
    px(g, hx - 8, hy + 2, C.skin0)
    const jd = strike ? 2 : R(wind * 1.5) + (hurt ? 1 : 0)
    if (jd > 0) rect(g, hx - 5, hy + 3, 7, jd, C.red0)
    rect(g, hx - 6, hy + 3 + jd, 9, 3, C.skin1)
    rect(g, hx - 6, hy + 5 + jd, 9, 1, C.skin0)
    if (jd === 0) rect(g, hx - 5, hy + 3, 7, 1, C.ink)
    rect(g, hx - 5, hy + 1 + jd, 1, 2, C.bone1)
    rect(g, hx - 1, hy + 1 + jd, 1, 2, C.bone1)
    px(g, hx - 5, hy + 1 + jd, C.white)

    // club arm
    const sx = cx - 5 + lean
    const sy = hip - 13 + br
    const hdx = R(sx + pz(-4, 2, -10))
    const hdy = R(sy + pz(7, -16, 6))
    const a = pz(-50, 15, -210) * DEG
    club(g, hdx, hdy, a)
    line(g, sx, sy, hdx, hdy, C.skin1, 4)
    disc(g, hdx, hdy, 2, C.skin1)
    px(g, hdx - 1, hdy - 1, C.skin2)
    disc(g, sx + 2, sy, 3, C.steel1)
    tri(g, sx + 3, sy - 2, sx + 5, sy - 1, sx + 7, sy - 5, C.steel2)
    px(g, sx + 7, sy - 5, C.steel3)
    px(g, sx + 1, sy - 2, C.steel3)
    if (strike) {
        smear(g, sx, sy - 2, 27, -212, -95)
        const tx = hdx + Math.cos(a) * 23
        for (let i = 0; i < 6; i++) {
            px(g, R(tx + (hash(i * 7 + 1) - 0.5) * 12), ay - 1 - R(hash(i * 3 + 2) * 6), i & 1 ? C.stone3 : C.bone0)
        }
    }
}

// ---------------------------------------------------------------- skeleton

function rattle(q: number, i: number, amt: number): number {
    return hash(q * 31 + i * 7) < amt ? 1 : 0
}

function boneLeg(g: G, hx: number, hy: number, fx: number, fy: number, c: string, hi: string): void {
    const kx = ((hx + fx) >> 1) - 1
    const ky = (hy + fy) >> 1
    line(g, hx, hy, kx, ky, c)
    line(g, kx, ky, fx, fy - 1, c)
    rect(g, kx - 1, ky, 2, 1, c)
    px(g, kx - 1, ky, hi)
    rect(g, fx - 2, fy - 1, 3, 1, c)
}

function sword(g: G, hx: number, hy: number, a: number, len: number): void {
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const nx = -uy
    const ny = ux
    line(g, R(hx - ux * 2), R(hy - uy * 2), hx, hy, C.brown1)
    px(g, R(hx - ux * 3), R(hy - uy * 3), C.gold1)
    line(g, R(hx + ux * 2), R(hy + uy * 2), R(hx + ux * len), R(hy + uy * len), C.steel2, 2)
    line(g, R(hx + ux * 2 + nx), R(hy + uy * 2 + ny), R(hx + ux * (len - 1) + nx), R(hy + uy * (len - 1) + ny), C.steel3)
    px(g, R(hx + ux * (len + 1)), R(hy + uy * (len + 1)), C.white)
    line(g, R(hx + ux + nx * 2), R(hy + uy + ny * 2), R(hx + ux - nx * 2), R(hy + uy - ny * 2), C.gold1)
}

function skeleton(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 7)
    const walk = p.moving
    const w = frame(p.walk, 9, 8)
    const q = Math.floor(p.t * 8)
    const amt = hurt ? 0.5 : walk ? 0.2 : 0.06
    const cx = ax - lunge + kb
    const hip = ay - 9 + (walk && (w & 3) === 0 ? 1 : 0) + (wind > 0.5 ? 1 : 0)
    const lean = strike ? -2 : R(wind * 2) + (hurt ? 1 : 0)
    const L = lean >> 1
    const top = hip - 9

    let nX = -1, nY = 0, fX = 1, fY = 0
    if (walk) {
        const o = (w + 4) & 7
        nX = STEP_X[w]!; nY = STEP_Y[w]!
        fX = STEP_X[o]!; fY = STEP_Y[o]!
    }
    if (wind > 0) { nX = -2; fX = 2; nY = 0; fY = 0 }
    if (strike) { nX = -4; fX = 3; nY = 0; fY = 0 }

    boneLeg(g, cx + 1, hip, cx + 1 + fX, ay - fY, C.bone0, C.bone0)

    // shield on the back arm
    const shx = cx + 5 + L
    const shy = top + 5 + rattle(q, 1, amt)
    line(g, cx + 3 + L, top + 1, shx, shy, C.bone0)
    disc(g, shx, shy, 4, C.brown1)
    disc(g, shx - 1, shy - 1, 3, C.brown2)
    ring(g, shx, shy, 4, C.steel1)
    rect(g, shx - 1, shy - 1, 2, 2, C.steel2)
    px(g, shx - 1, shy - 1, C.steel3)

    // spine, pelvis, ribs
    for (let y = top + 1; y < hip - 1; y++) px(g, cx + (y < top + 5 ? L : 0), y, (y & 1) ? C.bone1 : C.bone0)
    rect(g, cx - 2, hip - 1, 5, 2, C.bone1)
    px(g, cx + 1, hip, C.bone0)
    const rj = rattle(q, 2, amt)
    const rx = cx - 4 + L
    rect(g, rx, top, 8, 1, C.bone1)
    px(g, rx + 1, top, C.white)
    rect(g, rx, top + 2 + rj, 7, 1, C.bone1)
    rect(g, rx, top + 4 + rj, 7, 1, C.bone1)
    rect(g, rx + 1, top + 6 + rj, 5, 1, C.bone1)
    px(g, rx + 6, top + 2 + rj, C.bone0)
    px(g, rx + 6, top + 4 + rj, C.bone0)
    px(g, rx, top + 3 + rj, C.bone0)
    px(g, rx, top + 5 + rj, C.bone0)
    px(g, rx + 1, top + 2 + rj, C.white)

    boneLeg(g, cx - 1, hip, cx - 1 + nX, ay - nY, C.bone1, C.white)

    // skull
    const sx = cx + lean + rattle(q, 3, amt)
    const sy = top - 4 - (hurt ? 2 : 0) - rattle(q, 4, amt)
    ellipse(g, sx, sy - 1, 4, 3, C.bone0)
    ellipse(g, sx - 1, sy - 2, 3, 2, C.bone1)
    px(g, sx - 2, sy - 4, C.white)
    px(g, sx - 1, sy - 4, C.white)
    rect(g, sx - 3, sy - 1, 2, 2, C.ink)
    rect(g, sx + 1, sy - 1, 1, 2, C.ink)
    if (!hurt) {
        const gc = strike || wind > 0 ? C.red3 : (q & 2) ? C.red2 : C.red3
        px(g, sx - 3, sy, gc)
        px(g, sx + 1, sy, C.red1)
        if (wind > 0.5 || strike) px(g, sx - 2, sy - 1, C.white)
    }
    px(g, sx - 2, sy + 1, C.ink)
    rect(g, sx - 3, sy + 2, 5, 1, C.bone1)
    px(g, sx - 2, sy + 2, C.bone0)
    px(g, sx, sy + 2, C.bone0)
    const jd = strike ? 2 : wind > 0.5 ? 1 : frame(p.t, 6, 5) === 0 ? 1 : 0
    rect(g, sx - 3, sy + 3 + jd, 5, 1, C.bone0)
    if (jd > 0) px(g, sx - 3, sy + 2 + jd, C.bone1)

    // sword arm
    const shx2 = cx - 3 + L
    const shy2 = top + 1
    const hx = R(cx + pz(-6, 4, -11))
    const hy = R(top + pz(6, -4, 3))
    const a = pz(-125, -35, -190) * DEG
    sword(g, hx, hy, a, 11)
    const ex = ((shx2 + hx) >> 1) + 1
    const ey = ((shy2 + hy) >> 1) + 1
    line(g, shx2, shy2, ex, ey, C.bone1)
    line(g, ex, ey, hx, hy, C.bone1)
    px(g, ex, ey, C.bone0)
    px(g, hx, hy, C.white)
    if (strike) smear(g, shx2, shy2, 14, -190, -40)
}

// ---------------------------------------------------------------- ghost

function ghost(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 10)
    const hover = 10 + wave(p.t, 1.6, 2)
    const cx = ax - lunge + kb
    const cy = ay - hover - 12 + (strike ? 2 : 0)
    const r = 7 + R(wind * 1.5)
    const st = strike ? 3 : hurt ? 1 : 0
    const q = Math.floor(p.t * 10)
    const drift = (p.moving ? 0.6 : 0.35) + (strike ? 0.5 : 0)

    // wavy dithered tail
    for (let i = 0; i < 12; i++) {
        const y = cy + 3 + i
        const half = Math.max(1, R(r - 1 - i * 0.5))
        const sway = R(Math.sin(q * 0.7 - i * 0.8) * 1.3 + i * drift)
        const x0 = cx - half + sway
        const wd = half * 2 + 1
        if (i < 5) {
            rect(g, x0, y, wd, 1, C.steel3)
            rect(g, x0 + wd - 2, y, 2, 1, C.steel2)
            px(g, x0, y, C.white)
        } else if (i < 8) {
            dither(g, x0, y, wd, 1, C.steel3, 3)
        } else if (i < 10) {
            dither(g, x0, y, wd, 1, C.steel2, 2)
        } else {
            dither(g, x0, y, wd, 1, C.steel2, 1)
        }
    }

    // back arm
    const aw = wave(p.t, 0.9, 1)
    const armY = cy + 4 + aw - (wind > 0 ? 6 : 0) - (strike ? 3 : 0)
    tri(g, cx + r - 2, cy + 1, cx + r - 3, cy + 4, cx + r + 2, armY, C.steel2)

    // head
    ellipse(g, cx, cy, r + st, r - (strike ? 1 : 0), C.steel2)
    ellipse(g, cx - 1, cy - 1, r - 1 + st, r - 1 - (strike ? 1 : 0), C.steel3)
    rect(g, cx - 4, cy - r + 1, 3, 1, C.white)
    px(g, cx - 5, cy - r + 2, C.white)
    px(g, cx - 6, cy - r + 4, C.white)
    dither(g, cx - 3, cy + 4, 6, 2, C.cyan, 1)

    // front arm
    const armX = cx - r - st - (strike ? 4 : 2)
    tri(g, cx - r + 1, cy + 1, cx - r + 3, cy + 4, armX, armY, C.steel3)
    px(g, armX, armY, C.white)

    // face
    const fx = cx - 3 - st
    const ey = cy - 2
    if (hurt) {
        wince(g, fx - 2, ey, 4, C.ink)
    } else if (!strike && wind === 0 && blinking(p.t, 19)) {
        rect(g, fx - 2, ey + 2, 2, 1, C.ink)
        rect(g, fx + 2, ey + 2, 2, 1, C.ink)
    } else {
        const big = wind > 0.5 || strike
        rect(g, fx - 2, ey, 2, 3, C.ink)
        rect(g, fx + 2, ey, 2, 3, C.ink)
        const gc = big ? C.white : C.cyan
        px(g, fx - 2, ey + 1, gc)
        px(g, fx + 2, ey + 1, gc)
        if (big) {
            px(g, fx - 1, ey + 1, C.cyan)
            px(g, fx + 3, ey + 1, C.cyan)
        }
    }
    const my = cy + 3
    if (strike) {
        ellipse(g, fx, my + 1, 2, 2, C.ink)
        px(g, fx, my + 2, C.purple1)
    } else if (wind > 0) {
        rect(g, fx - 1, my, 3, 2 + R(wind * 2), C.ink)
    } else {
        rect(g, fx, my, 2, 1 + ((q >> 2) & 1), C.ink)
    }
    if (strike) trail = C.cyan
}

// ---------------------------------------------------------------- bat

// right wing per flap frame: wrist, tip, trailing point (mirrored for the left wing)
const BAT_W = Int8Array.from([
    6, -7, 11, -12, 8, -2,
    7, -4, 13, -4, 9, 1,
    6, 0, 9, 6, 5, 5,
    7, -5, 13, -6, 9, 0
])
const BAT_BOB = Int8Array.from([1, 0, -1, 0])

function batWing(g: G, cx: number, cy: number, s: number, f: number): void {
    const o = f * 6
    const ex = cx + s * BAT_W[o]!
    const ey = cy + BAT_W[o + 1]!
    const tx = cx + s * BAT_W[o + 2]!
    const ty = cy + BAT_W[o + 3]!
    const mx = cx + s * BAT_W[o + 4]!
    const my = cy + BAT_W[o + 5]!
    const sx = cx + s * 2
    const sy = cy - 2
    const bx = cx + s
    const by = cy + 3
    tri(g, sx, sy, ex, ey, bx, by, C.purple1)
    scallop(g, ex, ey, tx, ty, mx, my, C.purple1)
    scallop(g, ex, ey, mx, my, bx, by, C.purple0)
    line(g, sx, sy, ex, ey, C.purple2)
    line(g, ex, ey, tx, ty, C.purple2)
    line(g, ex, ey, mx, my, C.purple2)
    px(g, ex, ey - 1, C.bone1)
}

function bat(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 9)
    let f = frame(p.t, p.moving ? 14 : 10, 4)
    if (wind > 0) f = 0
    if (strike || hurt) f = 2
    const cx = ax - lunge + kb
    const cy = ay - 18 + BAT_BOB[f]! - R(wind * 4) + (strike ? 5 : 0) + wave(p.t, 1.3, 1)

    batWing(g, cx, cy, 1, f)
    batWing(g, cx, cy, -1, f)

    // body
    ellipse(g, cx, cy, 3, 4, C.brown1)
    ellipse(g, cx - 1, cy - 1, 2, 3, C.brown2)
    px(g, cx - 1, cy + 1, C.brown3)
    px(g, cx - 1, cy + 5, C.brown0)
    px(g, cx + 1, cy + 5, C.brown0)

    // head
    const hx = cx - 1
    const hy = cy - 5
    tri(g, hx - 3, hy - 2, hx - 1, hy - 2, hx - 3, hy - 6, C.brown1)
    tri(g, hx + 1, hy - 2, hx + 3, hy - 2, hx + 3, hy - 6, C.brown1)
    px(g, hx - 3, hy - 3, C.pink)
    px(g, hx + 2, hy - 3, C.pink)
    disc(g, hx, hy, 3, C.brown1)
    disc(g, hx - 1, hy - 1, 2, C.brown2)
    px(g, hx - 2, hy - 2, C.brown3)
    if (hurt) {
        rect(g, hx - 3, hy, 2, 1, C.ink)
        rect(g, hx, hy, 2, 1, C.ink)
    } else {
        const ec = wind > 0 || strike ? C.gold3 : C.red3
        px(g, hx - 2, hy, ec)
        px(g, hx + 1, hy, ec)
        px(g, hx - 2, hy - 1, C.red1)
    }
    if (strike || wind > 0.5) {
        rect(g, hx - 2, hy + 2, 3, 2, C.red0)
        px(g, hx - 2, hy + 2, C.white)
        px(g, hx, hy + 2, C.white)
    } else {
        px(g, hx - 2, hy + 2, C.white)
        px(g, hx, hy + 2, C.white)
    }
    if (strike) trail = C.purple1
}

// ---------------------------------------------------------------- lich

// 3×3 rune glyphs as 9-bit masks
const RUNES = Uint16Array.from([0b010111010, 0b101010101, 0b111001111, 0b100111001])
const EYE4: readonly string[] = [C.cyan, C.white, C.cyan, C.blue2]

function rune(g: G, x: number, y: number, bits: number, c: string): void {
    for (let i = 0; i < 9; i++) {
        if ((bits >> i) & 1) px(g, x + (i % 3), y + ((i / 3) | 0), c)
    }
}

function lichRunes(g: G, cx: number, cy: number, q: number, front: boolean): void {
    for (let i = 0; i < 3; i++) {
        const a = q * 0.12 + i * 2.094
        const s = Math.sin(a)
        if ((s > 0) !== front) continue
        const x = R(cx + Math.cos(a) * 15) - 1
        const y = R(cy + s * 3 + Math.sin(q * 0.3 + i) * 1.5)
        rune(g, x, y, RUNES[(i + (q >> 4)) & 3]!, front ? ((q + i) % 7 === 0 ? C.white : C.cyan) : C.purple2)
    }
}

function lich(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 6)
    const hover = 5 + wave(p.t, 2.2, 1.5)
    const cx = ax - lunge + kb
    const yb = ay - hover
    const q = Math.floor(p.t * 10)
    const lean = strike ? -2 : R(wind * 2) + (hurt ? 1 : 0)
    const top = yb - 30
    const fl = wave(p.t, 1.1, 2) + (p.moving ? 2 : 0)

    lichRunes(g, cx, top + 14, q, false)

    // cape
    tri(g, cx + 3 + lean, top + 1, cx + 13 + fl, yb - 1, cx + 3, yb - 3, C.purple0)
    tri(g, cx + 4 + lean, top + 4, cx + 11 + fl, yb - 3, cx + 4, yb - 4, C.red1)
    px(g, cx + 12 + fl, yb, C.purple0)
    px(g, cx + 9 + fl, yb - 1, C.purple0)

    // collar spikes behind the hood
    tri(g, cx - 1 + lean, top, cx + 5 + lean, top, cx + 7 + lean, top - 9, C.purple0)
    tri(g, cx - 4 + lean, top, cx + lean, top, cx - 5 + lean, top - 7, C.purple0)
    px(g, cx + 7 + lean, top - 9, C.gold1)
    px(g, cx - 5 + lean, top - 7, C.gold1)

    // back hand with a spell mote
    const bhx = cx + 8 + lean
    const bhy = top + 10
    px(g, bhx, bhy, C.bone1)
    px(g, bhx + 1, bhy - 1, C.bone1)
    px(g, bhx - 1, bhy - 1, C.bone0)
    const mf = frame(p.t, 8, 4)
    px(g, bhx, bhy - 3 - (mf >> 1), mf & 1 ? C.pink : C.purple2)
    if (mf === 0) px(g, bhx, bhy - 5, C.white)

    // robe
    for (let y = top; y <= yb - 5; y++) {
        const k = (y - top) / 30
        const half = R(5 + k * 6)
        const off = R(lean * (1 - k))
        const flare = R(k * k * 3)
        const x0 = cx - half + off
        const wd = half * 2 + 1 + flare
        const sh = R(wd / 3)
        rect(g, x0, y, wd, 1, C.purple1)
        rect(g, x0 + wd - sh, y, sh, 1, C.purple0)
        px(g, x0, y, C.purple2)
        px(g, cx - 3 + off, y, (y & 3) === 0 ? C.gold2 : C.gold1)
        if ((y + 1) % 3 !== 0) px(g, cx + 2 + off, y, C.purple0)
        if (y % 4 === 0) px(g, x0 + 2, y, C.purple2)
    }
    // tattered, flowing hem
    const q6 = Math.floor(p.t * 6)
    for (let x = cx - 11; x <= cx + 13; x++) {
        const len = 2 + R(Math.sin((x - cx) * 0.9 + q6 * 0.8) * 1.5)
        rect(g, x, yb - 4, 1, len + 1, x > cx + 5 ? C.purple0 : C.purple1)
    }
    rect(g, cx - 11, yb - 5, 25, 1, C.gold1)
    for (let x = cx - 10; x <= cx + 12; x += 3) px(g, x, yb - 5, C.gold2)

    // pauldrons
    ellipse(g, cx + 5 + lean, top, 3, 2, C.gold0)
    ellipse(g, cx - 4 + lean, top + 1, 3, 2, C.gold1)
    px(g, cx - 6 + lean, top, C.gold3)
    tri(g, cx - 5 + lean, top - 1, cx - 3 + lean, top - 1, cx - 5 + lean, top - 4, C.gold2)

    // hood + skull
    const hx = cx + lean
    const hy = top - 5
    tri(g, hx - 2, hy - 4, hx + 4, hy - 3, hx + 6, hy - 8, C.purple0)
    disc(g, hx, hy, 5, C.purple0)
    px(g, hx - 4, hy - 2, C.purple1)
    px(g, hx - 3, hy - 3, C.purple1)
    px(g, hx - 5, hy, C.purple1)
    ellipse(g, hx - 2, hy + 1, 3, 3, C.ink)
    const fx = hx - 3 + (hurt ? 1 : 0)
    const fy = hy - 2
    ellipse(g, fx, fy + 2, 3, 2, C.bone1)
    px(g, fx - 2, fy + 1, C.white)
    rect(g, fx - 2, fy + 4, 4, 2, C.bone0)
    px(g, fx - 1, fy + 5, C.ink)
    px(g, fx + 1, fy + 5, C.ink)
    rect(g, fx - 3, fy + 2, 2, 2, C.ink)
    rect(g, fx, fy + 2, 2, 2, C.ink)
    if (!hurt) {
        const ec = wind > 0 || strike ? C.white : EYE4[frame(p.t, 8, 4)]!
        px(g, fx - 3, fy + 2, ec)
        px(g, fx, fy + 2, ec)
        if (wind > 0.5 || strike) {
            px(g, fx - 3, fy + 1 - (q & 1), C.cyan)
            px(g, fx, fy + 1 - ((q + 1) & 1), C.cyan)
        }
    }
    // circlet
    rect(g, hx - 5, hy - 5, 8, 1, C.gold1)
    px(g, hx - 5, hy - 6, C.gold2)
    px(g, hx - 2, hy - 7, C.gold2)
    px(g, hx - 2, hy - 6, C.gold2)
    px(g, hx + 1, hy - 6, C.gold2)
    px(g, hx - 2, hy - 5, C.pink)
    px(g, hx - 4, hy - 5, C.gold3)

    // staff
    const sdx = R(cx + pz(-9, -6, -14))
    const sdy = R(top + pz(12, 2, 8))
    const a = pz(-95, -70, -155) * DEG
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const nx = -uy
    const ny = ux
    line(g, R(sdx - ux * 13), R(sdy - uy * 13), R(sdx + ux * 18), R(sdy + uy * 18), C.brown1, 2)
    line(g, R(sdx - ux * 13) - 1, R(sdy - uy * 13), R(sdx + ux * 18) - 1, R(sdy + uy * 18), C.brown2)
    px(g, R(sdx + ux * 14 + nx), R(sdy + uy * 14 + ny), C.bone1)
    px(g, R(sdx + ux * 14 - nx), R(sdy + uy * 14 - ny), C.bone1)
    const hdx = sdx + ux * 18
    const hdy = sdy + uy * 18
    const ox = R(hdx + ux * 4)
    const oy = R(hdy + uy * 4)
    for (let k = -1; k <= 1; k += 2) {
        line(g, R(hdx + nx * k * 2), R(hdy + ny * k * 2), R(ox + nx * k * 4), R(oy + ny * k * 4), C.bone1)
        line(g, R(ox + nx * k * 4), R(oy + ny * k * 4), R(ox + ux * 3 + nx * k * 2), R(oy + uy * 3 + ny * k * 2), C.bone0)
    }
    const pulse = frame(p.t, 6, 6)
    const or = 2 + (wind > 0.5 ? 1 : 0) + (strike ? 1 : 0)
    if (pulse % 3 === 0 || wind > 0.5) ring(g, ox, oy, or + 2, C.purple2)
    disc(g, ox, oy, or, C.purple2)
    disc(g, ox - 1, oy - 1, or - 1, C.pink)
    px(g, ox - 1, oy - 1, C.white)
    if (wind > 0) {
        for (let i = 0; i < 3; i++) {
            const b = q * 0.9 + i * 2.094
            px(g, R(ox + Math.cos(b) * (or + 4)), R(oy + Math.sin(b) * (or + 4)), i === 0 ? C.white : i === 1 ? C.cyan : C.pink)
        }
    }
    if (strike) {
        for (let i = 0; i < 8; i++) {
            const b = i * 0.785
            const c = Math.cos(b)
            const s = Math.sin(b)
            line(g, R(ox + c * (or + 2)), R(oy + s * (or + 2)), R(ox + c * (or + 5 + (i & 1) * 2)), R(oy + s * (or + 5 + (i & 1) * 2)), i & 1 ? C.cyan : C.white)
        }
        ring(g, ox, oy, or + 4, C.cyan)
    }
    // skeletal hand on the staff
    rect(g, sdx - 1, sdy - 1, 2, 2, C.bone1)
    px(g, sdx - 2, sdy, C.bone0)

    lichRunes(g, cx, top + 14, q, true)
}

// ---------------------------------------------------------------- imp

// wrist, tip per flap frame (relative to the shoulder, sweeping back)
const IMP_W = Int8Array.from([3, -5, 6, -10, 4, -3, 9, -5, 4, 0, 8, 3, 4, -3, 9, -6])

function impWing(g: G, sx: number, sy: number, f: number, mem: string, bone: string): void {
    const o = f * 4
    const wx = sx + IMP_W[o]!
    const wy = sy + IMP_W[o + 1]!
    const tx = sx + IMP_W[o + 2]!
    const ty = sy + IMP_W[o + 3]!
    tri(g, sx, sy, wx, wy, tx, ty, mem)
    scallop(g, sx, sy, tx, ty, sx + 3, sy + 4, mem)
    line(g, sx, sy, wx, wy, bone)
    line(g, wx, wy, tx, ty, bone)
}

function imp(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 8)
    const f = hurt ? 2 : wind > 0 ? 0 : frame(p.t, 12, 4)
    const hover = 4 + (f === 2 ? 1 : 0) + wave(p.t, 1.4, 1) + (p.moving ? 1 : 0)
    const cx = ax - lunge + kb
    const fy = ay - hover
    const lean = strike ? -2 : R(wind * 2) + (hurt ? 1 : 0)
    const ln = lean >> 1

    impWing(g, cx + 4 + lean, fy - 12, (f + 1) & 3, C.purple0, C.red0)

    // tail
    const tw = wave(p.t, 1, 2)
    const ttx = cx + 9
    const tty = fy - 6 + tw
    line(g, cx + 2, fy - 5, cx + 6, fy - 3, C.red1)
    line(g, cx + 6, fy - 3, ttx, tty, C.red1)
    tri(g, ttx - 1, tty - 2, ttx + 3, tty, ttx - 1, tty + 2, C.red1)

    // legs dangle
    const ls = f & 1
    line(g, cx + 2, fy - 5, cx + 1 + ls, fy - 2, C.red0, 2)
    px(g, cx + 1 + ls, fy - 1, C.brown0)
    line(g, cx - 1, fy - 5, cx - 3, fy - 3, C.red1, 2)
    line(g, cx - 3, fy - 3, cx - 2 - ls, fy - 1, C.red1)
    px(g, cx - 3 - ls, fy, C.brown0)

    impWing(g, cx + 2 + lean, fy - 11, f, C.red0, C.red1)

    // torso
    ellipse(g, cx + ln, fy - 8, 3, 3, C.red1)
    ellipse(g, cx - 1 + ln, fy - 9, 2, 2, C.red2)
    px(g, cx - 2 + ln, fy - 7, C.red3)

    // head
    const hx = cx - 1 + lean
    const hy = fy - 14 + (hurt ? -1 : 0)
    tri(g, hx + 2, hy - 1, hx + 2, hy + 1, hx + 7, hy - 3, C.red1)
    disc(g, hx, hy, 4, C.red1)
    disc(g, hx - 1, hy - 1, 3, C.red2)
    px(g, hx - 2, hy - 3, C.red3)
    px(g, hx - 3, hy - 2, C.red3)
    px(g, hx - 5, hy, C.red2)
    line(g, hx - 2, hy - 3, hx - 3, hy - 6, C.bone1)
    px(g, hx - 2, hy - 7, C.bone0)
    line(g, hx + 1, hy - 4, hx + 2, hy - 7, C.bone1)
    px(g, hx + 3, hy - 8, C.bone0)
    line(g, hx - 5, hy - 3, hx - 2, hy - 2, C.red0)
    if (hurt) {
        rect(g, hx - 4, hy - 1, 2, 1, C.ink)
        px(g, hx - 1, hy - 1, C.ink)
    } else {
        rect(g, hx - 4, hy - 1, 2, 1, C.gold2)
        px(g, hx - 4, hy - 1, wind > 0 || strike ? C.white : C.gold3)
        px(g, hx - 1, hy - 1, C.gold2)
    }
    if (strike || wind > 0.5) {
        rect(g, hx - 4, hy + 1, 4, 2, C.ink)
        px(g, hx - 3, hy + 1, C.white)
        px(g, hx - 1, hy + 1, C.white)
    } else {
        rect(g, hx - 4, hy + 2, 4, 1, C.ink)
        px(g, hx - 3, hy + 2, C.white)
        px(g, hx - 1, hy + 2, C.white)
        px(g, hx, hy + 1, C.ink)
    }

    // trident arm
    const sx = cx - 2 + lean
    const sy = fy - 10
    const hdx = R(cx + pz(-5, 3, -10))
    const hdy = R(fy + pz(-7, -11, -9))
    const a = pz(-110, -172, -182) * DEG
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const nx = -uy
    const ny = ux
    line(g, R(hdx - ux * 5), R(hdy - uy * 5), R(hdx + ux * 9), R(hdy + uy * 9), C.gold1)
    px(g, R(hdx + ux * 4), R(hdy + uy * 4), C.gold2)
    const bx = hdx + ux * 9
    const by = hdy + uy * 9
    line(g, R(bx + nx * 2), R(by + ny * 2), R(bx - nx * 2), R(by - ny * 2), C.steel2)
    for (let k = -2; k <= 2; k += 2) {
        const l = k === 0 ? 4 : 3
        line(g, R(bx + nx * k), R(by + ny * k), R(bx + nx * k + ux * l), R(by + ny * k + uy * l), C.steel2)
        px(g, R(bx + nx * k + ux * l), R(by + ny * k + uy * l), C.steel3)
    }
    line(g, sx, sy, hdx, hdy, C.red1, 2)
    px(g, hdx, hdy, C.red2)
    if (strike) {
        rect(g, R(bx) + 4, R(by) - 3, 8, 1, C.white)
        rect(g, R(bx) + 6, R(by) + 3, 7, 1, C.steel3)
        trail = C.red1
    }
}

// ---------------------------------------------------------------- salamander

function lizLeg(g: G, hx: number, hy: number, fy: number, dx: number, lift: number, c: string, toe: string): void {
    const kx = hx + dx - 1
    const ky = hy + 2 - lift
    const fx = hx + dx - 2
    line(g, hx, hy, kx, ky, c, 2)
    line(g, kx, ky, fx, fy - 1 - lift, c)
    rect(g, fx - 2, fy - 1 - lift, 3, 1, c)
    px(g, fx - 2, fy - 1 - lift, toe)
}

function salamander(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 8)
    const walk = p.moving
    const f = walk ? frame(p.walk, 10, 4) : 0
    const q = Math.floor(p.t * 10)
    const cx = ax - lunge + kb
    const by = ay - 5 + (hurt ? 1 : 0)
    const fb = R(wind * 2) + (strike ? 2 : 0)
    const lean = walk ? 1 : 0

    // tail
    let tipx = cx + 21
    let tipy = by - 3
    for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < 8; k++) {
            const x = cx + 7 + k * 2
            const y = by - 1 - R(k * 0.35 + Math.sin(q * 0.5 + k * 0.9) * Math.min(k, 4) * 0.35)
            const r = Math.max(0, R(2.4 - k * 0.3))
            if (pass === 0) {
                disc(g, x, y + 1, r, C.red0)
            } else {
                disc(g, x, y, r, C.red1)
                px(g, x, y - r, C.red2)
            }
            tipx = x
            tipy = y
        }
    }

    // legs: diagonal pairs step together
    const sA = walk ? f : 0
    const sB = walk ? (f + 2) & 3 : 0
    const reach = strike ? -2 : 0
    lizLeg(g, cx - 5, by, ay, LEG4_X[sB]! + 1 + reach, LEG4_Y[sB]!, C.red0, C.red0)
    lizLeg(g, cx + 5, by, ay, LEG4_X[sA]! + 2, LEG4_Y[sA]!, C.red0, C.red0)

    // body
    ellipse(g, cx, by - 1, 9, 3, C.red1)
    ellipse(g, cx - 1, by - 2, 8, 2, C.red2)
    rect(g, cx - 7, by + 1, 14, 1, C.gold1)
    for (let i = 0; i < 4; i++) px(g, cx - 6 + i * 4, by + 1, C.gold2)
    for (let i = 0; i < 3; i++) px(g, cx - 4 + i * 5, by - 3, C.orange)
    px(g, cx - 5, by - 4, C.red3)
    px(g, cx - 4, by - 4, C.red3)

    lizLeg(g, cx - 6, by + 1, ay, LEG4_X[sA]! + reach, LEG4_Y[sA]!, C.red2, C.gold2)
    lizLeg(g, cx + 4, by + 1, ay, LEG4_X[sB]! + 1, LEG4_Y[sB]!, C.red2, C.gold2)

    // head
    const hx = R(cx + pz(-12, -10, -16))
    const hy = R(by + pz(-2, -7, -1))
    line(g, cx - 7, by - 1, hx + 2, hy, C.red1, 3)
    ellipse(g, hx, hy, 4, 2, C.red1)
    ellipse(g, hx - 1, hy - 1, 3, 1, C.red2)
    rect(g, hx - 6, hy - 1, 2, 2, C.red1)
    px(g, hx - 5, hy - 1, C.red2)
    px(g, hx - 6, hy - 1, C.red0)
    px(g, hx - 1, hy - 3, C.red2)
    if (hurt) {
        rect(g, hx - 2, hy - 2, 2, 1, C.ink)
    } else {
        px(g, hx - 1, hy - 2, wind > 0 || strike ? C.white : C.gold3)
        px(g, hx, hy - 2, C.gold2)
    }
    const jo = strike ? 3 : R(wind * 2)
    if (jo > 0) {
        rect(g, hx - 5, hy + 1, 5, jo + 1, C.red0)
        rect(g, hx - 4, hy + 1, 3, jo, strike ? C.gold3 : wind > 0.6 ? C.gold2 : C.orange)
        px(g, hx - 5, hy + 1, C.white)
    } else {
        rect(g, hx - 5, hy + 1, 5, 1, C.red0)
    }
    rect(g, hx - 5, hy + 2 + jo, 6, 1, C.red1)
    if (jo === 0 && q % 30 < 2) {
        px(g, hx - 7, hy + 1, C.red3)
        px(g, hx - 8, hy, C.red3)
        px(g, hx - 8, hy + 2, C.red3)
    }

    // flames on the back and tail
    flame(g, cx - 4, by - 3, 4 + fb, 1, q, lean)
    flame(g, cx + 1, by - 4, 5 + fb, 2, q, lean)
    flame(g, cx + 6, by - 3, 3 + fb, 3, q, lean)
    flame(g, tipx, tipy - 1, 5 + fb, 4, q, lean + 1)

    if (strike) {
        disc(g, hx - 9, hy + 1, 3, C.lava1)
        disc(g, hx - 9, hy + 1, 2, C.orange)
        disc(g, hx - 10, hy + 1, 1, C.gold2)
        px(g, hx - 10, hy + 1, C.gold3)
        disc(g, hx - 14, hy - (q & 1), 2, C.orange)
        px(g, hx - 14, hy - (q & 1), C.gold2)
        px(g, hx - 17, hy + 1, C.gold2)
        trail = C.orange
    }
}

// ---------------------------------------------------------------- golem

// glowing crack segments x0, y0, x1, y1 relative to (cx, hip)
const CRACKS = Int8Array.from([-6, -14, -3, -11, -3, -11, -4, -6, 4, -15, 6, -11, 6, -11, 4, -7, 0, -5, 3, -3])
const HEAT: readonly string[] = [C.lava0, C.lava1, C.orange, C.gold2, C.orange, C.lava1]

function golem(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 6)
    const walk = p.moving
    const f = walk ? frame(p.walk, 7, 4) : 0
    const cx = ax - lunge + kb
    const bob = walk ? ((f & 1) ? 0 : 1) : 0
    const br = walk ? 0 : (frame(p.t, 1.5, 4) < 2 ? 0 : 1)
    const pulse = frame(p.t, 6, 6)
    const heat = hurt ? C.lava0 : HEAT[pulse]!
    const hip = ay - 8 + bob + (wind > 0.5 ? 1 : 0)
    const lean = strike ? -3 : R(wind * 2) + (hurt ? 1 : 0)
    const ln = lean >> 1
    let nd = 0, nl = 0, fd = 0, fl = 0
    if (walk) {
        if (f === 1) { nd = -2; nl = 2 } else if (f === 3) { fd = -2; fl = 2 }
    }
    if (strike) { nd = -3; fd = 2 }

    // back arm + shoulder
    const bsx = cx + 7 + lean
    const bsy = hip - 15 + br
    line(g, bsx, bsy, cx + 10 + ln, hip - 3, C.stone1, 4)
    rect(g, cx + 7 + ln, hip - 4, 6, 5, C.stone1)
    px(g, cx + 8 + ln, hip - 3, heat)
    disc(g, bsx, bsy - 1, 4, C.stone1)

    // legs
    rect(g, cx + 2 + fd, hip, 6, ay - hip - fl, C.stone1)
    px(g, cx + 4 + fd, hip + 3, heat)
    rect(g, cx - 6 + nd, hip, 6, ay - hip - nl, C.stone2)
    rect(g, cx - 1 + nd, hip, 1, ay - hip - nl, C.stone1)
    px(g, cx - 5 + nd, hip + 1, C.stone3)
    px(g, cx - 4 + nd, hip + 4, heat)
    rect(g, cx - 7 + nd, ay - 1 - nl, 7, 1, C.stone1)

    // torso
    const bx = cx + ln
    ellipse(g, bx, hip - 9, 10, 8, C.stone1)
    ellipse(g, bx - 1, hip - 10, 9, 7, C.stone2)
    ellipse(g, bx - 4, hip - 13, 4, 2, C.stone3)
    line(g, bx - 8, hip - 8, bx - 2, hip - 9, C.stone1)
    line(g, bx + 1, hip - 16, bx + 2, hip - 12, C.stone1)
    px(g, bx + 5, hip - 5, C.stone0)
    px(g, bx - 6, hip - 3, C.stone0)
    for (let i = 0; i < CRACKS.length; i += 4) {
        const x0 = bx + CRACKS[i]!
        const y0 = hip + CRACKS[i + 1]!
        const x1 = bx + CRACKS[i + 2]!
        const y1 = hip + CRACKS[i + 3]!
        line(g, x0, y0, x1, y1, heat)
        if (pulse >= 2 && pulse <= 4 && !hurt) px(g, (x0 + x1) >> 1, (y0 + y1) >> 1, C.gold3)
    }
    disc(g, bx - 1, hip - 10, 2, heat)
    px(g, bx - 1, hip - 10, pulse === 3 && !hurt ? C.white : C.gold3)

    // head
    const hx = cx - 3 + lean
    const hy = hip - 22 + br + (hurt ? -1 : 0)
    rect(g, hx - 3, hy, 6, 6, C.stone2)
    rect(g, hx - 4, hy + 1, 8, 4, C.stone2)
    rect(g, hx + 2, hy + 1, 2, 5, C.stone1)
    rect(g, hx - 3, hy, 3, 1, C.stone3)
    rect(g, hx - 4, hy + 2, 6, 1, C.stone1)
    rect(g, hx - 4, hy + 3, 4, 1, wind > 0 || strike ? C.gold3 : heat)
    px(g, hx - 3, hy + 5, heat)

    // front shoulder
    const sx = cx - 7 + lean
    const sy = hip - 15 + br
    disc(g, sx, sy, 4, C.stone2)
    disc(g, sx - 1, sy - 1, 2, C.stone3)
    px(g, sx + 2, sy + 2, heat)

    // front arm + fist
    const fx = R(cx + pz(-11, 3, -20))
    const fy = R(hip + pz(-2, -22, -10))
    line(g, sx, sy + 2, fx, fy, C.stone2, 4)
    disc(g, (sx + fx) >> 1, ((sy + fy) >> 1) + 1, 2, C.stone2)
    px(g, ((sx + fx) >> 1) - 1, (sy + fy) >> 1, C.stone3)
    rect(g, fx - 4, fy - 3, 7, 6, C.stone2)
    rect(g, fx - 4, fy + 2, 7, 1, C.stone1)
    rect(g, fx - 3, fy - 3, 5, 1, C.stone3)
    px(g, fx - 2, fy, C.stone1)
    px(g, fx, fy, C.stone1)
    px(g, fx + 1, fy - 1, heat)
    if (strike) {
        rect(g, fx + 4, fy - 2, 8, 1, C.gold2)
        rect(g, fx + 4, fy + 1, 10, 1, C.orange)
        rect(g, fx + 4, fy + 3, 6, 1, C.lava1)
    }

    // embers
    const eq = Math.floor(p.t * 6)
    for (let i = 0; i < 3; i++) {
        const ph = (eq + i * 7) % 14
        const ex = (i === 0 ? sx : i === 1 ? bsx : hx) + ((ph >> 2) & 1)
        const ey = (i === 2 ? hy - 2 : sy - 4) - ph
        px(g, ex, ey, ph < 4 ? C.gold3 : ph < 8 ? C.orange : ph < 12 ? C.lava1 : C.lava0)
    }
}

// ---------------------------------------------------------------- dragon

// wing per flap frame relative to the shoulder: wrist, finger 1, finger 2, finger 3
const DRAGON_WING = Int8Array.from([
    3, -20, -7, -30, 9, -33, 21, -24,
    4, -15, -9, -24, 9, -27, 22, -19,
    6, -8, -8, -14, 11, -17, 24, -10,
    6, -4, -6, -6, 12, -7, 24, -3
])
const DRAGON_FLAP = Int8Array.from([0, 1, 2, 3, 2, 1])

function dragonWing(g: G, sx: number, sy: number, f: number, mem: string, dark: string, bone: string): void {
    const o = f * 8
    const wx = sx + DRAGON_WING[o]!
    const wy = sy + DRAGON_WING[o + 1]!
    const x1 = sx + DRAGON_WING[o + 2]!
    const y1 = sy + DRAGON_WING[o + 3]!
    const x2 = sx + DRAGON_WING[o + 4]!
    const y2 = sy + DRAGON_WING[o + 5]!
    const x3 = sx + DRAGON_WING[o + 6]!
    const y3 = sy + DRAGON_WING[o + 7]!
    const rx = sx + 14
    const ry = sy + 4
    tri(g, sx, sy, wx, wy, rx, ry, dark)
    scallop(g, wx, wy, x3, y3, rx, ry, dark)
    scallop(g, wx, wy, x1, y1, x2, y2, mem)
    scallop(g, wx, wy, x2, y2, x3, y3, mem)
    line(g, sx, sy, wx, wy, bone, 2)
    line(g, wx, wy, x1, y1, bone)
    line(g, wx, wy, x2, y2, bone)
    line(g, wx, wy, x3, y3, bone)
    px(g, wx - 1, wy - 2, C.bone1)
}

function dragon(g: G, ax: number, ay: number, p: MonsterPose): void {
    phase(p, 3)
    const walk = p.moving
    const q = Math.floor(p.t * 10)
    const f = walk ? frame(p.walk, 7, 4) : 0
    const br = walk ? 0 : (frame(p.t, 1.4, 4) < 2 ? 0 : 1)
    let wf = DRAGON_FLAP[walk ? frame(p.walk, 9, 6) : frame(p.t, 5, 6)]!
    if (wind > 0) wf = 0
    else if (strike) wf = 3
    else if (hurt) wf = 2
    const cx = ax + 6 - lunge + kb
    const by = ay - 17 + (walk && (f & 1) ? 1 : 0)

    // far wing
    dragonWing(g, cx + 1, by - 9 + br, wf, C.red0, C.red0, C.red1)

    // tail
    let tx = 0
    let ty = 0
    for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < 10; k++) {
            const x = cx + 12 + R(k * 2.4)
            const y = by + 1 + R(k * 0.9 - (k > 6 ? (k - 6) * 1.6 : 0) + Math.sin(q * 0.35 + k * 0.6) * k * 0.22)
            const r = Math.max(1, R(4 - k * 0.35))
            if (pass === 0) {
                disc(g, x, y + 1, r, C.red0)
            } else {
                disc(g, x, y, r, C.red1)
                px(g, x, y - r, C.red2)
                if (k & 1) px(g, x, y - r - 1, C.bone0)
            }
            tx = x
            ty = y
        }
    }
    tri(g, tx, ty - 3, tx + 5, ty - 1, tx + 1, ty + 3, C.red2)
    px(g, tx + 1, ty - 1, C.red3)

    // legs: diagonal pairs
    const lA = walk && f === 1 ? 2 : 0
    const lB = walk && f === 3 ? 2 : 0
    const dA = walk ? (f === 1 ? -2 : f === 3 ? 1 : 0) : 0
    const dB = walk ? (f === 3 ? -2 : f === 1 ? 1 : 0) : 0
    line(g, cx + 9, by + 3, cx + 12, by + 8, C.red0, 3)
    line(g, cx + 12, by + 8, cx + 10 + dB, ay - 1 - lB, C.red0, 3)
    rect(g, cx + 6 + dB, ay - 2 - lB, 5, 2, C.red0)
    line(g, cx - 5, by + 4, cx - 8 + dA, ay - 1 - lA, C.red0, 3)
    rect(g, cx - 11 + dA, ay - 2 - lA, 4, 2, C.red0)

    // body
    ellipse(g, cx, by, 14, 9, C.red0)
    ellipse(g, cx - 1, by - 1, 13, 8, C.red1)
    ellipse(g, cx - 4, by - 5, 6, 2, C.red2)
    px(g, cx - 7, by - 6, C.red3)
    px(g, cx - 2, by - 7, C.red3)
    px(g, cx + 4, by - 3, C.red2)
    px(g, cx + 7, by - 1, C.red2)
    for (let i = 0; i < 7; i++) {
        const x = cx - 10 + i * 3
        const y = by + 6 - R((i - 3) * (i - 3) * 0.3)
        rect(g, x, y, 2, 2, C.gold1)
        px(g, x, y, C.gold2)
    }
    for (let i = 0; i < 6; i++) {
        const x = cx - 8 + i * 4
        const y = by - 9 + R((i - 2.5) * (i - 2.5) * 0.3)
        tri(g, x - 1, y + 1, x + 1, y + 1, x, y - 2, C.bone0)
        px(g, x, y - 2, C.bone1)
    }

    // near hind leg
    ellipse(g, cx + 8, by + 2, 5, 6, C.red1)
    ellipse(g, cx + 6, by, 2, 3, C.red2)
    line(g, cx + 10, by + 7, cx + 8 + dA, ay - 2 - lA, C.red1, 3)
    rect(g, cx + 3 + dA, ay - 2 - lA, 7, 2, C.red1)
    px(g, cx + 3 + dA, ay - 1 - lA, C.bone1)
    px(g, cx + 5 + dA, ay - 1 - lA, C.bone1)

    // near wing
    dragonWing(g, cx - 3, by - 7 + br, wf, C.red1, C.red0, C.gold1)

    // head pose: rest, reared back, lunged
    const hx = R(cx + pz(-22, -14, -30))
    const hy = R(ay + pz(-36 + br, -44, -26))

    // neck
    const n0x = cx - 9
    const n0y = by - 3
    const n2x = hx + 4
    const n2y = hy + 2
    const n1x = n0x - 1
    const n1y = n2y + 7
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i <= 8; i++) {
            const s = i / 8
            const u = 1 - s
            const x = R(u * u * n0x + 2 * u * s * n1x + s * s * n2x)
            const y = R(u * u * n0y + 2 * u * s * n1y + s * s * n2y)
            const r = R(5 - s * 2)
            const d = R(r * 0.7)
            if (pass === 0) disc(g, x + 1, y + 1, r, C.red0)
            else if (pass === 1) disc(g, x, y, r, C.red1)
            else if (i > 0 && i < 8) {
                rect(g, x - d - 1, y + d - 1, 2, 2, C.gold1)
                px(g, x - d - 1, y + d - 1, C.gold2)
                px(g, x + d - 1, y - d - 1, C.red2)
                if (i & 1) px(g, x + d + 1, y - d - 1, C.bone1)
            }
        }
    }

    // head
    line(g, hx + 3, hy - 2, hx + 9, hy - 6, C.bone0, 2)
    line(g, hx + 9, hy - 6, hx + 12, hy - 6, C.bone0)
    tri(g, hx + 3, hy - 1, hx + 4, hy + 4, hx + 9, hy + 2, C.red0)
    const jo = strike ? 5 : R(wind * 4) + (hurt ? 1 : 0)
    if (jo > 0) {
        tri(g, hx + 2, hy + 2, hx - 8, hy + 2, hx - 7, hy + 2 + jo, C.red0)
        if (wind > 0 || strike) {
            const gc = strike ? C.gold3 : wind < 0.4 ? C.orange : wind < 0.8 ? C.gold2 : C.gold3
            tri(g, hx, hy + 2, hx - 6, hy + 2, hx - 5, hy + 1 + jo, gc)
            if (wind >= 0.8 || strike) px(g, hx - 3, hy + 2, C.white)
        }
    }
    line(g, hx + 2, hy + 3, hx - 7, hy + 3 + jo, C.red1, 2)
    line(g, hx + 2, hy + 4, hx - 6, hy + 4 + jo, C.gold1)
    ellipse(g, hx + 1, hy, 5, 4, C.red1)
    rect(g, hx - 8, hy - 2, 9, 4, C.red1)
    rect(g, hx - 9, hy - 1, 1, 3, C.red1)
    rect(g, hx - 7, hy - 2, 8, 1, C.red2)
    rect(g, hx - 1, hy - 4, 4, 1, C.red2)
    px(g, hx, hy - 4, C.red3)
    px(g, hx - 5, hy - 2, C.red3)
    rect(g, hx - 8, hy + 1, 9, 1, C.red0)
    px(g, hx - 7, hy + 2, C.white)
    px(g, hx - 4, hy + 2, C.white)
    px(g, hx - 1, hy + 2, C.bone1)
    px(g, hx - 6, hy + 2 + jo, C.white)
    line(g, hx + 1, hy - 3, hx + 6, hy - 9, C.bone1, 2)
    line(g, hx + 6, hy - 9, hx + 9, hy - 11, C.bone1)
    px(g, hx + 2, hy - 5, C.white)
    line(g, hx - 4, hy - 3, hx + 1, hy - 4, C.red0)
    if (hurt) {
        rect(g, hx - 3, hy - 2, 3, 1, C.red0)
    } else {
        rect(g, hx - 3, hy - 2, 3, 1, wind > 0 || strike ? C.white : C.gold3)
        px(g, hx - 2, hy - 2, C.ink)
    }
    px(g, hx - 8, hy - 2, C.ink)

    // nostril smoke / sparks
    const ph = q % 24
    if (wind > 0) {
        const s = q % 4
        px(g, hx - 9 - s, hy - 3 - s, s & 1 ? C.orange : C.gold2)
    } else if (ph < 6) {
        px(g, hx - 9 - (ph >> 1), hy - 3 - ph, C.stone3)
        if (ph > 1) px(g, hx - 8 - (ph >> 1), hy - 4 - ph, C.stone2)
    }

    // near foreleg
    const fdx = strike ? -3 : dB
    line(g, cx - 8, by + 2, cx - 7, by + 7, C.red1, 3)
    line(g, cx - 7, by + 7, cx - 10 + fdx, ay - 2 - lB, C.red1, 3)
    rect(g, cx - 14 + fdx, ay - 2 - lB, 6, 2, C.red1)
    px(g, cx - 14 + fdx, ay - 1 - lB, C.bone1)
    px(g, cx - 12 + fdx, ay - 1 - lB, C.bone1)
    px(g, cx - 9, by + 2, C.red2)

    // fire breath
    if (strike) {
        const mx = hx - 9
        const my = hy + 3
        const j = q & 1
        disc(g, mx - 4, my + 1, 3, C.lava1)
        disc(g, mx - 9, my + 2 + j, 4, C.lava1)
        disc(g, mx - 15, my + 3 - j, 4, C.lava1)
        disc(g, mx - 20, my + 4, 2, C.red2)
        disc(g, mx - 4, my + 1, 2, C.orange)
        disc(g, mx - 9, my + 2 + j, 3, C.orange)
        disc(g, mx - 15, my + 3 - j, 2, C.orange)
        rect(g, mx - 12, my + 1 + j, 9, 2, C.gold2)
        rect(g, mx - 9, my + 1 + j, 5, 1, C.gold3)
        px(g, mx - 3, my + 1, C.white)
        px(g, mx - 22, my + 1, C.gold2)
        px(g, mx - 19, my - 1, C.orange)
    } else if (rec > 0.3) {
        px(g, hx - 12 - (q % 3), hy + 1, C.orange)
        px(g, hx - 16, hy - 1 - (q % 2), C.lava1)
    }

    // ambient embers
    for (let i = 0; i < 3; i++) {
        const e = (q + i * 9) % 26
        px(g, cx - 12 + i * 12 + ((e >> 2) & 1), by - 12 - e, e < 8 ? C.gold2 : e < 16 ? C.orange : C.lava0)
    }
}

// ---------------------------------------------------------------- entry

const SHADOW: Record<MonsterKind, number> = {
    slime: 0, mushroom: 0, wolf: 0, kingSlime: 0,
    goblin: 0, spider: 0, treant: 0, ogre: 0,
    skeleton: 0, ghost: 6, bat: 4, lich: 9,
    imp: 4, salamander: 0, golem: 0, dragon: 0
}

export function drawMonster(dst: CanvasRenderingContext2D, sb: SpriteBuffer, kind: MonsterKind, x: number, y: number,
    pose: MonsterPose, flash: string | null, rim: string | null): void {
    const g = sb.begin()
    const ax = sb.ax
    const ay = sb.ay
    const X = R(x)
    const Y = R(y)
    switch (kind) {
        case 'slime': slime(g, ax, ay, pose); break
        case 'mushroom': mushroom(g, ax, ay, pose); break
        case 'wolf': wolf(g, ax, ay, pose); break
        case 'kingSlime': kingSlime(g, ax, ay, pose); break
        case 'goblin': goblin(g, ax, ay, pose); break
        case 'spider': spider(g, ax, ay, pose); break
        case 'treant': treant(g, ax, ay, pose); break
        case 'ogre': ogre(g, ax, ay, pose); break
        case 'skeleton': skeleton(g, ax, ay, pose); break
        case 'ghost': ghost(g, ax, ay, pose); break
        case 'bat': bat(g, ax, ay, pose); break
        case 'lich': lich(g, ax, ay, pose); break
        case 'imp': imp(g, ax, ay, pose); break
        case 'salamander': salamander(g, ax, ay, pose); break
        case 'golem': golem(g, ax, ay, pose); break
        case 'dragon': dragon(g, ax, ay, pose); break
    }
    const sw = SHADOW[kind]
    if (sw > 0) flyShadow(dst, X, Y, sw)
    if (trail && !flash) sb.ghost(dst, X + 6, Y, trail)
    sb.blit(dst, X, Y, C.ink, flash, rim, -1, 0)
}
