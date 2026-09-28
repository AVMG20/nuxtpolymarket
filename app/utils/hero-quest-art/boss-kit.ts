// Shared construction for the bosses: the five-state driver (Idle, Attack, Hit, Death,
// Entry — asset-list §1.4) and a handful of shaded shapes every big body is made of.
//
// A boss drawer calls `drive()` first, reads the resulting pose values from `B`, paints,
// then calls `finish()` to apply its entry style and death sink.

import { C } from './palette'
import type { Surface} from './surface';
import { rect, px, line, disc, ellipse, tri, dither, ditherEllipse, bayer, hash2, taper, quad, ring, arc, poly } from './surface'
import { A, CF, attackPhase, hitPhase, deathPhase, q, sm, span, wv, type CreatureDef, type StateSpec } from './creature'
import type { Mat } from './weapons'

export const enum Entry { Rise, Drop, Walk, Fade, Grow }

/** Pose values for the boss being drawn this frame. */
export const B = {
    bob: 0,
    breath: 0,
    wind: 0,
    strike: false,
    rec: 0,
    lunge: 0,
    kb: 0,
    hurt: false,
    die: 0,
    /** Entry progress 0 → 1, and the roar beat at the end of it. */
    ent: 1,
    roar: false,
    /** 0..1 generic "power" for glows: wind-up, strike and roar light it. */
    glow: 0,
    /** Progress 0 → 1 through a special; each boss choreographs its own body against it. */
    sp: 0,
    t: 0
}

export const BOSS_STATES = ['idle', 'attack', 'hit', 'death', 'entry'] as const
export type BossState = typeof BOSS_STATES[number]

/** Add a special of `dur` seconds to a boss's states. */
export function withSpecial<S extends Record<string, StateSpec>>(states: S, dur: number): S & { special: StateSpec } {
    return { ...states, special: { dur, loop: false } }
}

export function bossStates(attack = 1.2, idle = 1.6, entry = 2.0): Record<BossState, StateSpec> {
    return {
        idle: { dur: idle, loop: true },
        attack: { dur: attack, loop: false },
        hit: { dur: 0.5, loop: false },
        death: { dur: 1.8, loop: false },
        entry: { dur: entry, loop: false }
    }
}

/** Resolve the state into B. `def` supplies the durations. */
export function drive(def: CreatureDef, st: string, t: number, reach: number, idlePeriod = 1.6): void {
    B.t = t
    B.bob = 0; B.breath = 0; B.wind = 0; B.strike = false; B.rec = 0; B.lunge = 0
    B.kb = 0; B.hurt = false; B.die = 0; B.ent = 1; B.roar = false; B.glow = 0; B.sp = 0
    const dur = def.states[st]!.dur
    switch (st) {
        case 'idle':
            B.bob = wv(t, idlePeriod, 1)
            B.breath = wv(t, idlePeriod, 1, 0.25)
            break
        case 'attack':
            attackPhase(t, dur, reach)
            B.wind = A.wind; B.strike = A.strike; B.rec = A.rec; B.lunge = A.lunge
            B.glow = Math.max(A.wind, A.strike ? 1 : A.rec * 0.6)
            break
        case 'hit':
            B.kb = hitPhase(t, dur)
            B.hurt = true
            break
        case 'death':
            B.die = deathPhase(t, dur)
            B.hurt = B.die < 0.9
            break
        case 'special':
            B.sp = Math.min(1, q(t) / dur)
            break
        case 'entry':
            B.ent = sm(span(t, 0, dur * 0.7))
            B.roar = q(t) >= dur * 0.7 && q(t) < dur * 0.95
            B.glow = B.roar ? 1 : 0
            break
    }
}

/**
 * Play a special as a big attack on the boss's own pose: wind up until `w`, strike (lunging out
 * `reach` px by `s`), hold the strike until `h`, then recover. `w`, `s` and `h` are fractions
 * of the special. Call after `drive`; the body's `bz` blends then follow it.
 */
export function spAttack(w: number, s: number, h: number, reach: number): void {
    const u = B.sp
    B.wind = 0; B.strike = false; B.rec = 0
    if (u < w) { B.wind = sm(u / w); B.lunge = -Math.round(B.wind * 3) } else if (u < h) {
        B.strike = true; B.rec = 1
        B.lunge = Math.round(reach * (u < s ? sm((u - w) / (s - w)) : 1))
    } else { B.rec = 1 - sm((u - h) / (1 - h)); B.lunge = Math.round(reach * B.rec) }
    B.glow = Math.max(B.wind, B.strike ? 1 : B.rec * 0.6)
}

/** Apply the entry style and the death sink to the painted buffer. */
export function finish(s: Surface, style: Entry, sinkOnDeath = 6): void {
    if (B.ent < 1) {
        const u = 1 - B.ent
        switch (style) {
            case Entry.Rise: shift(s, 0, Math.round(u * s.h * 0.7), s.ay); break
            case Entry.Drop:
                shift(s, 0, -Math.round(u * s.h), s.h)
                if (u > 0.1) CF.fade = Math.round(u * 6)
                // the shadow gathers under it as it comes down
                CF.shadow = 0.15 + 0.85 * B.ent
                break
            case Entry.Walk: shift(s, -Math.round(u * s.w * 0.45), 0, s.h); break
            case Entry.Fade: CF.fade = Math.round(u * 16); break
            case Entry.Grow: CF.fade = Math.round(u * 12); shift(s, 0, Math.round(u * 10), s.ay); break
        }
    }
    if (B.die > 0) shift(s, 0, Math.round(B.die * sinkOnDeath), s.ay)
}

/** A pool a boss rises out of: its centre `dx` from the anchor and its radii, as `ditherEllipse` fills it. */
export interface Pool { dx: number, rx: number, ry: number }

/** Paint a boss's pool into the scene, under its anchor (x, y) facing `dir`. */
export function drawPool(dst: Surface, p: Pool, x: number, y: number, dir: number, c: number): void {
    ditherEllipse(dst, x + dir * p.dx, y - 1, p.rx, p.ry, c, 16)
}

/**
 * Cut a body off at the front rim of the pool it rises out of: in every column the pool spans,
 * nothing below the rim survives, so the body goes into the water instead of on through it and
 * out underneath. Call after `finish`, in the buffer's own facing-right space; the stamp's
 * outline then lands on the rim, where the pool (drawn in `fx`, over the body) covers it.
 */
export function waterline(s: Surface, p: Pool): void {
    const cx = s.ax + p.dx
    const cy = s.ay - 1
    const iry = Math.max(1, Math.floor(p.ry))
    // walked from the front rim up: each row cuts only the columns the rows below it did not reach
    for (let dy = iry; dy >= -iry; dy--) {
        const half = rimHalf(p, dy)
        const inner = dy < iry ? rimHalf(p, dy + 1) : -1
        for (let x = cx - half; x <= cx + half; x++) {
            if (x < 0 || x >= s.w || Math.abs(x - cx) <= inner) continue
            for (let y = Math.max(0, cy + dy); y < s.h; y++) s.data[y * s.w + x] = 0
        }
    }
}

/** Half the width of a pool's row `dy` from its centre, as `ditherEllipse` fills it. */
function rimHalf(p: Pool, dy: number): number {
    const k = 1 - (dy * dy) / ((p.ry + 0.5) * (p.ry + 0.5))
    return Math.floor(p.rx * Math.sqrt(Math.max(0, k)) + 0.35)
}

/** Shift every pixel by (dx, dy) in place; pixels pushed below `floor` are cut. */
export function shift(s: Surface, dx: number, dy: number, floor: number): void {
    if (dx === 0 && dy === 0) return
    const w = s.w
    const src = SCRATCH.length >= s.data.length ? SCRATCH : (SCRATCH = new Uint8Array(s.data.length))
    src.set(s.data)
    s.data.fill(0)
    for (let y = 0; y < s.h; y++) {
        const ny = y + dy
        if (ny < 0 || ny >= s.h || ny > floor) continue
        for (let x = 0; x < w; x++) {
            const c = src[y * w + x]!
            if (!c) continue
            const nx = x + dx
            if (nx >= 0 && nx < w) s.data[ny * w + nx] = c
        }
    }
}
let SCRATCH = new Uint8Array(160 * 160)

// ── Shapes ─────────────────────────────────────────────────────────────────────────

/** A shaded ellipse: shade below-right, base, highlight up-left. */
export function ball(s: Surface, cx: number, cy: number, rx: number, ry: number, m: Mat, hi = true): void {
    ellipse(s, cx, cy, rx, ry, m[0])
    ellipse(s, cx - 1, cy - 1, rx - 1, ry - 1, m[1])
    if (hi && rx > 3 && ry > 2) ellipse(s, cx - Math.round(rx * 0.35), cy - Math.round(ry * 0.4), Math.max(1, rx * 0.35), Math.max(1, ry * 0.3), m[2])
}

/** Foliage: a leafy ellipse broken up with dithered light and dark clumps. */
export function foliage(s: Surface, cx: number, cy: number, rx: number, ry: number, m: Mat, seed: number): void {
    ellipse(s, cx, cy, rx, ry, m[1])
    ditherEllipse(s, cx + 1, cy + Math.round(ry * 0.3), rx - 1, ry * 0.6, m[0], 8)
    ditherEllipse(s, cx - Math.round(rx * 0.3), cy - Math.round(ry * 0.35), rx * 0.5, ry * 0.4, m[2], 6)
    // ragged rim
    for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2
        const r = 1 + hash2(seed, i) * 1.5
        px(s, cx + Math.round(Math.cos(a) * (rx + r)), cy + Math.round(Math.sin(a) * (ry + r)), i & 1 ? m[1] : m[0])
    }
}

/** A chain of discs along a quadratic curve — serpent necks, tentacles, leech bodies. */
export function chain(s: Surface, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
    r0: number, r1: number, m: Mat, n = 14, belly: number = -1): void {
    for (let i = 0; i <= n; i++) {
        const u = i / n
        const a = (1 - u) * (1 - u)
        const b = 2 * (1 - u) * u
        const c = u * u
        const x = a * x0 + b * cx + c * x1
        const y = a * y0 + b * cy + c * y1
        const r = r0 + (r1 - r0) * u
        disc(s, x, y, r, m[0])
    }
    for (let i = 0; i <= n; i++) {
        const u = i / n
        const a = (1 - u) * (1 - u)
        const b = 2 * (1 - u) * u
        const c = u * u
        const x = a * x0 + b * cx + c * x1
        const y = a * y0 + b * cy + c * y1
        const r = r0 + (r1 - r0) * u
        disc(s, x - 1, y - 1, Math.max(1, r - 1), m[1])
        if (r > 2) px(s, x - Math.round(r * 0.5), y - Math.round(r * 0.5), m[2])
        if (belly >= 0 && r > 2 && i % 2 === 0) px(s, x + Math.round(r * 0.4), y + Math.round(r * 0.6), belly)
    }
}

/** A curling tentacle from (x, y) along angle `a`, length `len`, waving with `ph`. */
export function tentacle(s: Surface, x: number, y: number, a: number, len: number, w: number, ph: number, m: Mat, sucker: number = -1): void {
    let cx = x
    let cy = y
    for (let i = 0; i < len; i++) {
        const u = i / len
        const ang = a + Math.sin(ph + u * 3) * 0.9 * u
        cx += Math.cos(ang)
        cy += Math.sin(ang)
        const r = Math.max(0.5, w * (1 - u * 0.85))
        disc(s, cx, cy, r, i % 3 === 0 ? m[0] : m[1])
        if (sucker >= 0 && r > 1.4 && i % 3 === 1) px(s, cx, cy + 1, sucker)
    }
    px(s, cx, cy, m[2])
}

/** A feathered or membranous wing from the shoulder (x, y); `flap` −1 (down) … 1 (up). */
export function wing(s: Surface, x: number, y: number, span: number, flap: number, m: Mat, feathered: boolean): void {
    const tipX = x - span
    const tipY = y - Math.round(span * 0.55 * flap)
    tri(s, x, y, x - 3, y + 6, tipX, tipY, m[1])
    tri(s, x, y, tipX, tipY, tipX + span * 0.35, tipY - 3 * flap - 2, m[1])
    line(s, x, y, tipX, tipY, m[2])
    const n = feathered ? 5 : 3
    for (let i = 1; i <= n; i++) {
        const u = i / (n + 1)
        const fx = x + (tipX - x) * u
        const fy = y + (tipY - y) * u
        const len = feathered ? 5 + i : 7
        line(s, fx, fy, fx + (feathered ? 1 : 2), fy + len, i & 1 ? m[0] : m[1])
    }
}

/** Glowing eye with a 1px bloom. */
export function glowEye(s: Surface, x: number, y: number, c: number, bloom: number, big = false): void {
    if (big) rect(s, x - 1, y, 3, 1, bloom)
    px(s, x, y, c)
    if (big) px(s, x, y - 1, bloom)
}

/** A still pool (black water, lava, ice) on the floor line, rippling with t. */
export function pool(s: Surface, cx: number, floor: number, rx: number, m: Mat, t: number): void {
    ellipse(s, cx, floor - 1, rx, 2, m[0])
    rect(s, cx - rx + 2, floor - 2, rx * 2 - 3, 1, m[1])
    const k = Math.floor(q(t) * 4) & 3
    for (let i = 0; i < 4; i++) px(s, cx - rx + 4 + ((i * 7 + k * 3) % (rx * 2 - 6)), floor - 2, m[2])
}

/** Spikes/thorns along a line. */
export function spikes(s: Surface, x0: number, y0: number, x1: number, y1: number, n: number, h: number, c: number, tipc: number): void {
    for (let i = 0; i <= n; i++) {
        const u = i / n
        const x = x0 + (x1 - x0) * u
        const y = y0 + (y1 - y0) * u
        tri(s, x - 1, y, x + 1, y, x - 1, y - h, c)
        px(s, x - 1, y - h, tipc)
    }
}

/** Standard hurt squint / roar mouth helper for the face of a big creature. */
export function mouth(s: Surface, x: number, y: number, w: number, open: number, inside: number, teeth: number): void {
    if (open <= 0) { rect(s, x, y, w, 1, C.ink); return }
    rect(s, x, y, w, open, C.ink)
    if (open > 1) rect(s, x + 1, y + 1, w - 2, open - 1, inside)
    for (let i = 0; i < w; i += 2) px(s, x + i, y, teeth)
}

/** Stone-block texture: speckle a region with the dark and light of a material. */
export function speckle(s: Surface, x: number, y: number, w: number, h: number, m: Mat, seed: number): void {
    for (let i = 0; i < (w * h) / 10; i++) {
        const xx = x + Math.floor(hash2(seed, i) * w)
        const yy = y + Math.floor(hash2(seed + 3, i) * h)
        if (s.get(xx, yy) !== 0) s.set(xx, yy, i & 1 ? m[0] : m[2])
    }
}

export { C, rect, px, line, disc, ellipse, tri, dither, ditherEllipse, bayer, hash2, taper, quad, ring, arc, poly, CF, q, sm, span, wv }

/** Blend a value between rest, full wind-up and full strike from the boss driver. */
export function bz(rest: number, w: number, s: number): number {
    return B.wind > 0 ? rest + (w - rest) * B.wind : rest + (s - rest) * B.rec
}

/** A shaded tapered limb: shade edge, body, and a 1px highlight down the lit side. */
export function limbT(s: Surface, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, m: Mat): void {
    taper(s, x0, y0, x1, y1, w0, w1, m[0])
    taper(s, x0 - 0.5, y0 - 0.5, x1 - 0.5, y1 - 0.5, Math.max(1, w0 - 1.5), Math.max(1, w1 - 1.5), m[1])
    const dx = x1 - x0
    const dy = y1 - y0
    const L = Math.hypot(dx, dy) || 1
    const ox = (dy / L) * (w0 * 0.25)
    const oy = (-dx / L) * (w0 * 0.25)
    line(s, x0 - ox, y0 - oy - 0.5, x1 - ox, y1 - oy - 0.5, m[2])
}

/** The elbow of a two-bone limb from shoulder (sx, sy) to hand (hx, hy), bending toward `bend` (±1), into P. */
export function elbow(sx: number, sy: number, hx: number, hy: number, l1: number, l2: number, bend: number): void {
    const dx = hx - sx
    const dy = hy - sy
    const d = Math.max(1, Math.min(l1 + l2 - 0.5, Math.hypot(dx, dy)))
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
    const ux = dx / d
    const uy = dy / d
    P.x = sx + ux * a - uy * h * bend
    P.y = sy + uy * a + ux * h * bend
}

/** Point on an arm of length `len` from (x, y) at angle a — scratch output in P. */
export const P = { x: 0, y: 0 }
export function reach(x: number, y: number, a: number, len: number): void {
    P.x = x + Math.cos(a) * len
    P.y = y + Math.sin(a) * len
}
