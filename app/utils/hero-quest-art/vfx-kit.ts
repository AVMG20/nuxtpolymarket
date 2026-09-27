// Building blocks for ability VFX, in scene space and un-outlined.
//
// Effects are closed-form in time: a particle's position is its launch point plus velocity
// and gravity integrated to `t`, its colour a step along a palette ramp. That makes any frame
// renderable on its own (the exporter, the gallery scrubber) and allocation-free. The live
// battle uses the pooled `Particles` system (particles.ts) for spray that reacts to hits.

import { C, RAMP, type RampName } from './palette'
import type { Surface} from './surface';
import { line, disc, ring, rect, ellipseRing, ditherDisc, dither, hash2, bayer } from './surface'
import { frameTime } from './anim'

const R = Math.round

/** Layout every VFX sheet is authored against: party left, three enemies right. */
export const VL = {
    /**
     * Wider than the old 160: the two formations sit on the thirds of the 320px scene, which
     * puts the far enemy mark past where a 160-wide stage could reach. Drawn at OX=64, so the
     * stage still lands inside the scene.
     */
    W: 200,
    H: 88,
    /** The near rank's ground, and what VFX treat as the floor. */
    floor: 84,
    /**
     * Six marks a side: indices 0-2 the **front row**, 3-5 the **back row**, as the game models
     * formation (3 front / 3 back, `classes-and-combat.md` §6).
     *
     * The camera looks along the line of battle, so a row's three members are not side by side
     * on screen — they recede into the scene. Front and back therefore read as *left and right*
     * (toward and away from the enemy), while a row's three members read as *depth*. What the
     * player sees is three ranks of two, each rank pairing one front-row body with its back-row
     * partner; what the game reasons about is still two rows of three.
     *
     * `y` is chest height and `g` the ground the body stands on. Each rank back stands 16px up
     * the slope, and the middle rank pushes 10px toward the enemy while the near and far ranks
     * share an x — so each side forms a chevron, the two pointing at each other across the gap.
     * The two rows sit 24px apart, far enough that no body hides the one beside it.
     *
     * The rear rank is pinned where it is, just clear of the hedgerow; the extra air between
     * ranks is bought by dropping the middle and near ones, which is why `floor` sits below the
     * scenery's own floor line.
     *
     * Each formation is centred on a third of the scene — the party on 33%, the wave on 66% —
     * which in stage space (drawn at OX=64) puts their centres at x 42 and 147.
     */
    allies: [
        { x: 51, y: 32, g: 52 }, { x: 61, y: 48, g: 68 }, { x: 51, y: 64, g: 84 },
        { x: 27, y: 32, g: 52 }, { x: 37, y: 48, g: 68 }, { x: 27, y: 64, g: 84 }
    ] as const,
    caster: { x: 51, y: 64 },
    foes: [
        { x: 138, y: 64, g: 84 }, { x: 128, y: 48, g: 68 }, { x: 138, y: 32, g: 52 },
        { x: 162, y: 64, g: 84 }, { x: 152, y: 48, g: 68 }, { x: 162, y: 32, g: 52 }
    ] as const
}

/**
 * The motion clock. Exported strips and the gallery sample effects on the ANIM_FPS frame grid
 * and scenery on its authored 10 fps loop, so a baked loop closes and matches the held frames. The live stage turns
 * `smooth` on while it draws them, so they move at its 60 Hz instead, against the stepped
 * bodies. Only the live stage sets it, and only around its own draw calls.
 */
export const clock = { smooth: false }

/** Time as effects and scenery see it: on the frame grid, unless the live stage asks for smooth. */
export function qt(t: number): number { return clock.smooth ? t : frameTime(t) }

/** 0..1 progress of t through [a, b], clamped, on the frame grid. */
export function pr(t: number, a: number, b: number): number {
    const u = (qt(t) - a) / (b - a)
    return u < 0 ? 0 : u > 1 ? 1 : u
}

export function inWin(t: number, a: number, b: number): boolean {
    const q = qt(t)
    return q >= a && q < b
}

export function eo(u: number): number { return 1 - (1 - u) * (1 - u) }

function rampColor(ramp: Uint8Array, age: number): number {
    return ramp[Math.min(ramp.length - 1, Math.floor(age * ramp.length))]!
}

/**
 * A burst of `n` particles launched at t0 from (x, y), speed up to `spd` px/s, living `life`
 * seconds, walking `ramp`. `dir`/`spread` constrain the angle (radians); `grav` pulls down.
 */
export function burst(dst: Surface, x: number, y: number, t: number, t0: number, n: number, spd: number, ramp: RampName,
    seed: number, life = 0.5, grav = 0, dir = 0, spread = Math.PI * 2, size = 1): void {
    const age0 = qt(t) - t0
    if (age0 < 0) return
    const rp = RAMP[ramp]
    for (let i = 0; i < n; i++) {
        const l = life * (0.6 + hash2(seed, i) * 0.4)
        const age = age0 / l
        if (age >= 1) continue
        const a = dir - spread / 2 + hash2(seed + 1, i) * spread
        const v = spd * (0.35 + hash2(seed + 2, i) * 0.65)
        const tt = age0
        const px = x + Math.cos(a) * v * tt
        const py = y + Math.sin(a) * v * tt + 0.5 * grav * tt * tt
        const c = rampColor(rp, age)
        const sz = size > 1 && age < 0.5 ? size : 1
        rect(dst, R(px) - (sz >> 1), R(py) - (sz >> 1), sz, sz, c)
    }
}

/** Motes rising from a region (auras, heals, curses). */
export function motes(dst: Surface, x: number, y: number, w: number, h: number, t: number, n: number, ramp: RampName, seed: number, speed = 20): void {
    const rp = RAMP[ramp]
    const q = qt(t)
    for (let i = 0; i < n; i++) {
        const period = h / speed
        const ph = (q / period + hash2(seed, i)) % 1
        const mx = x + (hash2(seed + 1, i) - 0.5) * w + Math.sin((q + i) * 6) * 1
        const my = y - ph * h
        dst.set(R(mx), R(my), rampColor(rp, ph))
    }
}

/** An expanding ring (or ground ellipse when `flat`), fading through the ramp. */
export function shock(dst: Surface, x: number, y: number, t: number, t0: number, dur: number, r0: number, r1: number, ramp: RampName, flat = false, thick = 1): void {
    const u = (qt(t) - t0) / dur
    if (u < 0 || u >= 1) return
    const r = r0 + (r1 - r0) * eo(u)
    const c = rampColor(RAMP[ramp], u)
    for (let k = 0; k < thick; k++) {
        if (flat) ellipseRing(dst, x, y, r - k, (r - k) * 0.28, c)
        else ring(dst, x, y, r - k, c)
    }
}

/** Jagged lightning from (x0, y0) to (x1, y1), re-rolled each frame. */
export function bolt(dst: Surface, x0: number, y0: number, x1: number, y1: number, t: number, seed: number, core: number = C.white, glow: number = C.cyan, jag = 4): void {
    const steps = Math.max(4, R(Math.hypot(x1 - x0, y1 - y0) / 5))
    const f = Math.floor(qt(t) * 10)
    let px0 = x0
    let py0 = y0
    for (let i = 1; i <= steps; i++) {
        const u = i / steps
        const off = i === steps ? 0 : (hash2(seed + f * 7, i) - 0.5) * jag * 2
        const nx = x0 + (x1 - x0) * u + off
        const ny = y0 + (y1 - y0) * u + off * 0.3
        line(dst, px0 + 1, py0, nx + 1, ny, glow)
        line(dst, px0, py0, nx, ny, core)
        px0 = nx
        py0 = ny
    }
}

/** A straight projectile travelling from a → b over [t0, t1], drawn by `head`. Returns progress (−1 outside). */
export function travel(t: number, t0: number, t1: number): number {
    const q = qt(t)
    if (q < t0 || q > t1) return -1
    return (q - t0) / (t1 - t0)
}

/** Point on a parabola from (x0, y0) to (x1, y1) peaking `h` above the midpoint. Scratch P. */
export const VP = { x: 0, y: 0, a: 0 }
export function lob(x0: number, y0: number, x1: number, y1: number, h: number, u: number): void {
    VP.x = x0 + (x1 - x0) * u
    VP.y = y0 + (y1 - y0) * u - h * 4 * u * (1 - u)
    const dx = x1 - x0
    const dy = (y1 - y0) - h * 4 * (1 - 2 * u)
    VP.a = Math.atan2(dy, dx)
}

/** A glowing orb with a short trail behind it. */
export function orbFx(dst: Surface, x: number, y: number, a: number, r: number, core: number, mid: number, trail: number): void {
    for (let i = 1; i <= 5; i++) dst.set(R(x - Math.cos(a) * i * 2), R(y - Math.sin(a) * i * 2), i < 3 ? mid : trail)
    disc(dst, x, y, r, mid)
    disc(dst, x, y, Math.max(0, r - 1), core)
}

/** A four-point impact star. */
export function star(dst: Surface, x: number, y: number, r: number, c: number, core: number = C.white): void {
    x = R(x); y = R(y)
    for (let i = -r; i <= r; i++) {
        dst.set(x + i, y, Math.abs(i) < 2 ? core : c)
        dst.set(x, y + i, Math.abs(i) < 2 ? core : c)
    }
    if (r > 3) { dst.set(x - 1, y - 1, c); dst.set(x + 1, y + 1, c); dst.set(x + 1, y - 1, c); dst.set(x - 1, y + 1, c) }
}

/** A hit burst: star plus sparks, at t0 for 0.3 s. */
export function impact(dst: Surface, x: number, y: number, t: number, t0: number, ramp: RampName, seed: number, big = false): void {
    const u = (qt(t) - t0) / 0.3
    if (u < 0 || u >= 1) return
    const c = rampColor(RAMP[ramp], u)
    star(dst, x, y, R((big ? 7 : 4) * (1 - u * 0.5)), c, u < 0.5 ? C.white : c)
    burst(dst, x, y, t, t0, big ? 12 : 7, big ? 60 : 40, ramp, seed, 0.3)
}

/** Buff (up) or debuff (down) chevrons floating over (x, y). */
export function arrows(dst: Surface, x: number, y: number, t: number, up: boolean, c: number, n = 2): void {
    const q = qt(t)
    for (let k = 0; k < n; k++) {
        const ph = (q * 1.5 + k / n) % 1
        const yy = R(up ? y - ph * 10 : y - 10 + ph * 10)
        const xx = x + (k & 1 ? 4 : -4)
        for (let i = 0; i < 3; i++) {
            // buff: ^ (apex on top); debuff: v (apex below)
            const d = up ? i : -i
            dst.set(xx - i, yy + d, c)
            dst.set(xx + i, yy + d, c)
        }
    }
}

/** A small pixel plus. */
export function plus(dst: Surface, x: number, y: number, c: number, big = false): void {
    x = R(x); y = R(y)
    const r = big ? 2 : 1
    for (let i = -r; i <= r; i++) { dst.set(x + i, y, c); dst.set(x, y + i, c) }
}

/** Heal pluses rising from a body. */
export function healRise(dst: Surface, x: number, y: number, t: number, seed: number, c: number = C.green4, c2: number = C.white): void {
    const q = qt(t)
    for (let i = 0; i < 4; i++) {
        const ph = (q * 1.2 + hash2(seed, i)) % 1
        plus(dst, x - 8 + R(hash2(seed + 1, i) * 16), R(y + 6 - ph * 22), ph < 0.3 ? c2 : c, i === 0)
    }
}

/** Stun stars circling a head. */
export function stunStars(dst: Surface, x: number, y: number, t: number, c: number = C.gold3): void {
    const q = qt(t)
    for (let i = 0; i < 3; i++) {
        const a = q * 8 + i * (Math.PI * 2 / 3)
        const sx = R(x + Math.cos(a) * 6)
        const sy = R(y + Math.sin(a) * 2)
        dst.set(sx, sy, C.white); dst.set(sx - 1, sy, c); dst.set(sx + 1, sy, c); dst.set(sx, sy - 1, c); dst.set(sx, sy + 1, c)
    }
}

/** A bright vertical column (holy light, pillars of fire). */
export function column(dst: Surface, x: number, top: number, bottom: number, w: number, ramp: RampName, t: number, level = 16): void {
    const rp = RAMP[ramp]
    const f = Math.floor(qt(t) * 10)
    for (let yy = R(top); yy <= R(bottom); yy++) {
        for (let xx = -w; xx <= w; xx++) {
            const d = Math.abs(xx) / (w + 0.5)
            const c = rp[Math.min(rp.length - 1, Math.floor(d * (rp.length - 1)))]!
            if (d > 0.5 && !bayer(R(x) + xx, yy + f, level)) continue
            dst.set(R(x) + xx, yy, c)
        }
    }
}

/** A dithered bubble (shields). */
export function bubble(dst: Surface, x: number, y: number, r: number, rim: number, fill: number, level: number): void {
    ditherDisc(dst, x, y, r, fill, level)
    ring(dst, x, y, r, rim)
}

/** A 5×5 rune glyph from a 25-bit mask. */
export function rune(dst: Surface, x: number, y: number, bits: number, c: number): void {
    for (let i = 0; i < 25; i++) if ((bits >> i) & 1) dst.set(R(x) - 2 + (i % 5), R(y) - 2 + Math.floor(i / 5), c)
}

export const RUNES = [0x1151151, 0x0477c40, 0x11f1f11, 0x0e4a4e0, 0x1f8421f, 0x0a5f4a0, 0x0e1110e, 0x1151f11]

/** A ring of runes around (x, y), rotating with t. */
export function runeCircle(dst: Surface, x: number, y: number, r: number, t: number, c: number, n = 6, ry = 0.35): void {
    for (let i = 0; i < n; i++) {
        const a = qt(t) * 2 + i * (Math.PI * 2 / n)
        rune(dst, x + Math.cos(a) * r, y + Math.sin(a) * r * ry, RUNES[i % RUNES.length]!, c)
    }
}

/** Falling streaks (rain of arrows, embers, gold). */
export function rain(dst: Surface, x0: number, x1: number, top: number, floor: number, t: number, t0: number, t1: number, n: number, c: number, head: number, slant: number, seed: number, len = 5): void {
    const q = qt(t)
    if (q < t0 || q > t1 + 0.4) return
    for (let i = 0; i < n; i++) {
        const start = t0 + hash2(seed, i) * (t1 - t0)
        const u = (q - start) / 0.35
        if (u < 0 || u > 1) continue
        const x = x0 + hash2(seed + 1, i) * (x1 - x0) + slant * u * 20
        const y = top + (floor - top) * u
        line(dst, x - slant * len, y - len, x, y, c)
        dst.set(R(x), R(y), head)
    }
}

/** A chain of links from a to b (binds, tethers). */
export function chainFx(dst: Surface, x0: number, y0: number, x1: number, y1: number, c: number, hi: number, sag = 0): void {
    const n = Math.max(3, R(Math.hypot(x1 - x0, y1 - y0) / 3))
    for (let i = 0; i <= n; i++) {
        const u = i / n
        const x = x0 + (x1 - x0) * u
        const y = y0 + (y1 - y0) * u + sag * 4 * u * (1 - u)
        if (i & 1) { dst.set(R(x), R(y) - 1, c); dst.set(R(x), R(y) + 1, c) } else { dst.set(R(x) - 1, R(y), c); dst.set(R(x) + 1, R(y), hi) }
    }
}

/** A slash: a bright arc swept over progress u (0..1) from a0 to a1. */
export function slash(dst: Surface, cx: number, cy: number, r: number, a0: number, a1: number, u: number, c: number, edge: number = C.white, thick = 3): void {
    if (u <= 0 || u > 1.4) return
    const head = Math.min(1, u)
    const tail = Math.max(0, u - 0.5)
    const n = Math.max(8, R(Math.abs(a1 - a0) * r))
    for (let i = 0; i <= n; i++) {
        const k = i / n
        if (k < tail || k > head) continue
        const a = a0 + (a1 - a0) * k
        const th = Math.max(1, R(thick * (k - tail) / Math.max(0.01, head - tail)))
        for (let j = 0; j < th; j++) dst.set(R(cx + Math.cos(a) * (r - j)), R(cy + Math.sin(a) * (r - j)), j === 0 ? edge : c)
    }
}

/** Dim the frame region with a dither (a darkening sky, a cursed area). */
export function shade(dst: Surface, x: number, y: number, w: number, h: number, c: number, level: number): void {
    dither(dst, x, y, w, h, c, level)
}

export { R }
