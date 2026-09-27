// The kit every world background is drawn with: canvas and loop constants, the layer
// primitives (sky bands, ridges, prop bands), the water mirror and the shared props. The
// worlds themselves live in scenery.ts (Thornwick Vale), scenery-a.ts and scenery-b.ts.

import { C, shadeLut } from './palette'
import type { Surface } from './surface'
import { rect, line, disc, tri, dither, ditherDisc, hash2 } from './surface'
import { clock, qt } from './vfx-kit'
import { AUTHORED_FPS } from './anim'

export const SW = 320
export const SH = 180
/** Frames in a world background's loop; every motion in a scene must repeat within it. */
export const BG_FRAMES = 16
/** The loop in seconds, at the authored 10 fps. A scene's motion is written as phase = t / BG_LOOP so it closes. */
export const BG_LOOP = BG_FRAMES / AUTHORED_FPS
/** The floor line characters stand on. */
export const FLOOR_Y = 150
/**
 * The distance, in px of scroll, after which the foreground framing repeats. One march must
 * cover a whole number of these or the framing pines end up somewhere new every fight — the
 * live stage derives its march speed from this, so the two cannot drift apart.
 */
export const SCROLL_PERIOD = 300

export const R = Math.round

export function mod(a: number, n: number): number { const r = a % n; return r < 0 ? r + n : r }

export function vnoise(x: number, period: number, seed: number): number {
    const f = x / period
    const i = Math.floor(f)
    const u = f - i
    const s = u * u * (3 - 2 * u)
    const a = hash2(i, seed)
    return a + (hash2(i + 1, seed) - a) * s
}

// ── Layers ─────────────────────────────────────────────────────────────────────────

/** Horizontal sky bands with a 4-row dithered seam between each. */
export function sky(s: Surface, cols: readonly number[], stops: readonly number[]): void {
    for (let i = 0; i < cols.length; i++) {
        const y0 = stops[i]!
        const y1 = i + 1 < stops.length ? stops[i + 1]! : SH
        rect(s, 0, y0, SW, y1 - y0, cols[i]!)
        if (i > 0) for (let k = 0; k < 4; k++) dither(s, 0, y0 - 4 + k, SW, 1, cols[i]!, 2 + k * 3)
    }
}

/** A ridge line on value noise, filled down to `bottom`, lit on up-slopes. */
export function ridge(s: Surface, ox: number, base: number, amp: number, period: number, seed: number, body: number, lit: number | null, bottom = SH, jag = 0): void {
    let prev = 0
    for (let x = 0; x < SW; x++) {
        const wx = x + ox
        let n = vnoise(wx, period, seed) * 0.7 + vnoise(wx, period * 0.3, seed + 7) * 0.3
        if (jag) n += (hash2(Math.floor(wx / 3), seed + 9) - 0.5) * jag
        const y = R(base - amp * n)
        rect(s, x, y, 1, bottom - y, body)
        if (lit !== null && y < prev) rect(s, x, y, 1, 2, lit)
        prev = y
    }
}

/** Triangular peaks (mountains, volcanoes); `snow` caps the tips. */
export function peaks(s: Surface, ox: number, base: number, period: number, seed: number, body: number, shade: number, snow: number | null, crater = -1): void {
    for (let k = Math.floor(ox / period) - 1; k <= Math.floor((ox + SW) / period) + 1; k++) {
        const cx = (k + 0.2 + hash2(k, seed) * 0.6) * period - ox
        const h = period * (0.45 + hash2(k, seed + 1) * 0.5)
        const w = period * (0.55 + hash2(k, seed + 2) * 0.4)
        tri(s, cx - w, base, cx + w, base, cx, base - h, body)
        tri(s, cx, base - h, cx + w, base, cx + w * 0.3, base, shade)
        if (snow !== null) tri(s, cx - w * 0.2, base - h * 0.8, cx + w * 0.2, base - h * 0.8, cx, base - h, snow)
        if (crater >= 0) {
            rect(s, R(cx - w * 0.12), R(base - h), R(w * 0.24) + 1, 2, crater)
            dither(s, R(cx - w * 0.2), R(base - h - 8), R(w * 0.4), 8, crater, 3)
        }
    }
}

export function pine(s: Surface, x: number, y: number, h: number, c: number, snow: number | null): void {
    for (let i = 0; i < h; i++) {
        const w = Math.floor((i / h) * (h * 0.4)) + (i % 4 === 3 ? 1 : 0)
        rect(s, x - w, y - h + i, w * 2 + 1, 1, c)
        if (snow !== null && i % 4 === 0) rect(s, x - w, y - h + i, w + 1, 1, snow)
    }
    rect(s, x - 1, y, 2, 3, C.brown0)
}

export function deadTree(s: Surface, x: number, y: number, h: number, c: number): void {
    line(s, x, y, x, y - h, c, 2)
    for (let i = 0; i < 4; i++) {
        const by = y - h * (0.4 + i * 0.15)
        const d = i & 1 ? 1 : -1
        line(s, x, by, x + d * (4 + i * 2), by - 4 - i, c)
    }
}

/** A tiling prop band: `draw(x, k)` places prop k at screen x every `spacing` px. */
export function band(ox: number, spacing: number, seed: number, draw: (x: number, k: number, r: number) => void): void {
    for (let k = Math.floor(ox / spacing) - 1; k <= Math.floor((ox + SW) / spacing) + 1; k++) {
        const r = hash2(k, seed)
        draw(R(k * spacing + r * spacing * 0.6 - ox), k, r)
    }
}

/** Ambient particles on the frame grid (motes, snow, embers) — `speed` px/s, `dir` ±1 vertical. */
export function drift(s: Surface, t: number, n: number, seed: number, cols: readonly number[], vy: number, vx: number, y0 = 0, y1 = SH): void {
    const q = qt(t)
    for (let i = 0; i < n; i++) {
        const x = mod(hash2(seed, i) * SW + vx * q + Math.sin(q * 2 + i) * 2, SW)
        const y = y0 + mod(hash2(seed + 1, i) * (y1 - y0) + vy * q, y1 - y0)
        s.set(R(x), R(y), cols[i % cols.length]!)
    }
}

export interface WorldScene {
    id: string
    draw(s: Surface, scroll: number, t: number): void
    /**
     * The foreground: props nearer the camera than the near rank (the framing at both edges).
     * The live stage draws it over the fighters; `composeScene` draws it for a still.
     */
    front?(s: Surface, scroll: number, t: number): void
    /**
     * First row of standing water, when the scene has any. The live stage re-runs
     * `reflectWater` after the units are drawn so bodies and effects mirror in it too.
     */
    water?: number
    /** Column the sun's glitter road runs down on the water, if any. */
    glitter?: number
    /**
     * On the scenery tier: everything in the fight band (FIGHT_BAND rows above the floor) is
     * painted in SCENERY colours only, so the characters in front always read.
     */
    tiered?: boolean
}

/** Rows above FLOOR_Y that sit behind a standing fighter — the band the scenery tier governs. */
export const FIGHT_BAND = 28

// ── Water ──────────────────────────────────────────────────────────────────────────

// Darker and pulled well toward the sky's blue: the field above is now lit green, and a faithful
// mirror of it just reads as more grass rather than as water.
const REFLECT_LUT = shadeLut(0.72, 'sky0', 0.45)
/** Rows of scene mirrored per row of water: >1 foreshortens, so a shallow pond still shows the sky. */
const REFLECT_SQUASH = 2.2

/**
 * Mirror everything above the water line into rows [top, SH): each row copied from its
 * foreshortened mirror image about `top − 2` (REFLECT_SQUASH rows up per row down), sheared sideways by a wave that grows with depth, and
 * darkened through a shade map. Then a sparse glitter of lit dashes on the surface.
 */
export function reflectWater(s: Surface, top: number, t: number, glitterX = -1): void {
    // everything below moves on the background loop, so a baked 16-frame strip closes
    const ph = (qt(t) / BG_LOOP) % 1
    const f = Math.floor(ph * BG_FRAMES + 1e-6)
    const axis = top - 2
    const w = s.w
    const d = s.data
    for (let y = top; y < s.h; y++) {
        const depth = y - top
        const src = axis - R(depth * REFLECT_SQUASH) - 1
        if (src < 0) break
        const off = R(Math.sin(y * 0.9 + ph * Math.PI * 2) * (0.6 + depth * 0.09))
        const row = y * w
        const srow = src * w
        for (let x = 0; x < w; x++) {
            let sx = x + off
            if (sx < 0) sx = 0
            else if (sx >= w) sx = w - 1
            d[row + x] = REFLECT_LUT[d[srow + sx]!]!
        }
        // ripple lines: every third row a broken lighter streak, sliding a pixel every two frames
        if (depth % 3 === 1) {
            for (let x = mod((f >> 1) + depth * 5, 8); x < w; x += 8) {
                const c = d[row + x]!
                if (hash2(x >> 3, y) < 0.6) d[row + x] = c === C.void || c === C.ink ? C.night0 : c
            }
        }
    }
    if (glitterX >= 0) {
        // the sun's road across the water, re-scattered every other frame
        const k = f >> 1
        for (let y = top + 1; y < s.h; y += 2) {
            const spread = 3 + (y - top) * 0.6
            for (let i = 0; i < 3; i++) {
                const x = R(glitterX + (hash2(y, i + k * 3) - 0.5) * spread * 2)
                const len = 1 + R(hash2(i, y) * 3)
                rect(s, x, y, len, 1, i === 0 ? C.white : C.gold3)
            }
        }
    }
}

/** A wide flat cloud: stacked lozenges in `body`, underside lit `lit` toward the sun. */
export function streakCloud(s: Surface, x: number, y: number, len: number, body: number, lit: number, dark: number): void {
    for (let i = 0; i < 3; i++) {
        const l = len * (1 - i * 0.3)
        const ox = x + (i === 1 ? len * 0.1 : i === 2 ? len * 0.28 : 0)
        rect(s, ox + 2, y - i * 3 - 1, l - 4, 1, i === 2 ? dark : body)
        rect(s, ox, y - i * 3, l, 3, body)
    }
    rect(s, x + 1, y + 2, len - 3, 1, lit)
    rect(s, x + 3, y + 3, len * 0.55, 1, lit)
    dither(s, x + 6, y + 4, len * 0.4, 1, lit, 6)
}

/** A tall pine with a stepped, jagged silhouette — the video's framing trees. */
export function bigPine(s: Surface, x: number, base: number, h: number, c: number, rim: number): void {
    const tiers = Math.floor(h / 9)
    for (let k = 0; k < tiers; k++) {
        const ty = base - h + k * 8
        const w = 3 + k * 2.2
        tri(s, x - w, ty + 11, x + w, ty + 11, x, ty, c)
        rect(s, R(x - w), ty + 10, R(w * 2) + 1, 2, c)
        // the sun side of each tier catches light
        line(s, x + 1, ty + 2, R(x + w * 0.8), ty + 10, rim)
    }
    rect(s, x - 1, base - 6, 3, 8, C.rust0)
}

/** Fireflies wheeling on small closed loops — one lap per background loop, so it repeats. */
export function fireflies(s: Surface, ph: number, n: number, seed: number, y0: number, y1: number): void {
    for (let i = 0; i < n; i++) {
        const a = (ph + hash2(seed, i)) * Math.PI * 2 * (i & 1 ? 1 : -1)
        const x = R(hash2(seed + 1, i) * SW + Math.cos(a) * 4)
        const y = R(y0 + hash2(seed + 2, i) * (y1 - y0) + Math.sin(a) * 2)
        const lit = (Math.floor(ph * BG_FRAMES) + i * 5) % 8 < 5
        if (lit) s.set(x, y, i % 3 ? C.sand3 : C.moss3)
    }
}

/**
 * A small flock crossing the sky every BIRD_EVERY seconds, live stage only: dark V's in a
 * loose line, each flapping on its own beat. They ride a little of the scroll so a march
 * overtakes them.
 */
const BIRD_EVERY = 14
export function birds(s: Surface, t: number, sc: number): void {
    const n = Math.floor(t / BIRD_EVERY)
    const u = (t % BIRD_EVERY) / BIRD_EVERY
    const y0 = 26 + R(hash2(n, 61) * 30)
    for (let i = 0; i < 3 + (n & 1); i++) {
        const x = R(SW + 20 + i * 9 - u * (SW + 90) - sc * 0.08)
        const y = y0 + i * 3 + R(Math.sin(t * 1.3 + i) * 1.5)
        const up = Math.floor(t * 6 + i * 1.7) & 1
        s.set(x, y, C.sky0); s.set(x + 1, y, C.sky0)
        s.set(x - 1, y + (up ? -1 : 1), C.sky0); s.set(x + 2, y + (up ? -1 : 1), C.sky0)
        if (up) { s.set(x - 2, y - 1, C.sky0); s.set(x + 3, y - 1, C.sky0) }
    }
}


// ── The shared field ───────────────────────────────────────────────────────────────
//
// Every world after Thornwick Vale is built on its layout: a field deep enough for the three
// ranks (the rear one stands on y 122, the near one on 154), the backdrop rooted along its far
// edge so no prop stands behind a fighter, framing at both edges on SCROLL_PERIOD, and something
// in front of the lip — water, lava, a drop into sky.

/** Far edge of the field: every backdrop roots here, 12 rows above the rear rank. */
export const GROUND = 110
/** Where the field ends and drops away toward the foreground. */
export const LIP = FLOOR_Y + 10
/** First row of the foreground: water, lava or a drop. */
export const FRONT = FLOOR_Y + 15

/** The background loop's phase, 0..1. Motion written against it closes the baked loop. */
export function phase(t: number): number {
    return (qt(t) / BG_LOOP) % 1
}

/** The loop's frame, 0..BG_FRAMES−1, for things that step rather than move. */
export function loopFrame(t: number): number {
    return Math.floor(phase(t) * BG_FRAMES + 1e-6)
}

/**
 * Foreground framing at full scroll, laid out on SCROLL_PERIOD so it is back at both edges when
 * each march ends (see thornwick's framing pines). `draw(o)` places a period's props at o + x.
 */
export function framing(sc: number, draw: (o: number) => void): void {
    // Whole pixels: mid-march the scroll is fractional, and a prop's trunk, tiers and highlights
    // would each round to the grid on their own and slip against one another by a pixel.
    const base = -R(mod(sc, SCROLL_PERIOD))
    for (let k = 0; k <= 1; k++) draw(base + k * SCROLL_PERIOD)
}

/** A celestial: two rings of dithered halo, the disc, a lighter core. Fixed: it is at infinity. */
export function glow(s: Surface, x: number, y: number, r: number, halo: number, body: number, core: number): void {
    ditherDisc(s, x, y, r + 9, halo, 2)
    ditherDisc(s, x, y, r + 4, halo, 6)
    disc(s, x, y, r, body)
    if (r > 3) disc(s, x - 1, y - 1, r - 3, core)
}

/**
 * Field clutter with depth: `lanes` rows between y0 and y1, the far lane riding 0.6 of the scroll
 * and the near one all of it, so the ground itself parallaxes on a march instead of sliding as
 * one slab. `draw(x, y, k, r)` places item k.
 */
export function scatter(sc: number, y0: number, y1: number, lanes: number, spacing: number, seed: number, draw: (x: number, y: number, k: number, r: number) => void): void {
    for (let j = 0; j < lanes; j++) {
        const u = lanes === 1 ? 1 : j / (lanes - 1)
        const y = y0 + (j + 0.5) * (y1 - y0) / lanes
        const sp = spacing * (0.7 + 0.3 * u)
        band(sc * (0.6 + 0.4 * u), sp, seed + j * 13, (x, k, r) => draw(x, R(y + (hash2(k, seed + j) - 0.5) * (y1 - y0) / lanes), k, r))
    }
}

/**
 * A paved floor seen at a low angle: seams across it that crowd toward the far edge, and joints
 * along it that converge on the horizon and parallax by depth. Paints only the seams.
 */
export function flagstones(s: Surface, sc: number, y0: number, y1: number, rows: number, spacing: number, seam: number, lit: number): void {
    const ys: number[] = []
    for (let i = 0; i <= rows; i++) {
        const u = i / rows
        ys.push(R(y0 + (y1 - y0) * u * u * 0.4 + (y1 - y0) * u * 0.6))
    }
    for (let i = 1; i < ys.length; i++) {
        rect(s, 0, ys[i]!, SW, 1, seam)
        rect(s, 0, ys[i]! + 1, SW, 1, lit)
    }
    for (let i = 0; i < rows; i++) {
        const a = ys[i]!
        const b = ys[i + 1]!
        const u = (i + 0.5) / rows
        const f = 0.6 + 0.4 * u
        const sp = spacing * (0.55 + 0.45 * u)
        const off = mod(-sc * f + (i & 1) * sp * 0.5, sp)
        for (let x = off - sp; x < SW + sp; x += sp) line(s, R(x), a + 2, R(x - (b - a) * 0.3 * ((x - SW / 2) / SW)), b - 1, seam)
    }
}

/**
 * Ambient motes. On the live stage they drift (`vx`, `vy` px/s); in a baked strip, which must
 * close in BG_LOOP, each one wheels on a small closed loop instead.
 */
export function motes(s: Surface, t: number, n: number, seed: number, cols: readonly number[], vy: number, vx: number, y0 = 0, y1 = SH): void {
    if (clock.smooth) {
        drift(s, t, n, seed, cols, vy, vx, y0, y1)
        return
    }
    const ph = phase(t)
    for (let i = 0; i < n; i++) {
        const a = (ph + hash2(seed + 3, i)) * Math.PI * 2
        const x = R(hash2(seed, i) * SW + Math.cos(a) * 2)
        const y = R(y0 + hash2(seed + 1, i) * (y1 - y0) + Math.sin(a) * 3)
        s.set(x, y, cols[i % cols.length]!)
    }
}

/** Vertical bands, like `sky` but from y0 to y1 only: for grounds and water that shade by depth. */
export function strata(s: Surface, y0: number, y1: number, cols: readonly number[], stops: readonly number[]): void {
    for (let i = 0; i < cols.length; i++) {
        const a = y0 + stops[i]!
        const b = i + 1 < cols.length ? y0 + stops[i + 1]! : y1
        rect(s, 0, a, SW, b - a, cols[i]!)
        if (i > 0) for (let k = 0; k < 2; k++) dither(s, 0, a - 2 + k, SW, 1, cols[i]!, 4 + k * 6)
    }
}

/** Stars: a fixed field above `y1`, each twinkling on its own beat within the loop. */
export function stars(s: Surface, t: number, n: number, seed: number, y1: number, dim: number, bright: number): void {
    const f = loopFrame(t)
    for (let i = 0; i < n; i++) {
        const tw = (f + i * 5) % 16
        if (tw < 2) continue
        s.set(R(hash2(seed, i) * SW), R(hash2(seed + 1, i) * y1), tw > 13 || i % 7 === 0 ? bright : dim)
    }
}

/** A rising column of puffs (smoke, ash): one puff climbs one slot per loop, so it closes. */
export function plume(s: Surface, x: number, y: number, ph: number, n: number, rise: number, lean: number, body: number, lit: number): void {
    for (let i = n - 1; i >= 0; i--) {
        const u = i + ph
        const px0 = x + u * lean + Math.sin(u * 1.3) * 2
        const py = y - u * rise
        const r = 2 + u * 1.6
        const level = R(14 * (1 - u / n))
        if (level <= 0) continue
        ditherDisc(s, px0, py + 1, r, lit, level)
        ditherDisc(s, px0 - 1, py - 1, r - 1, body, level)
    }
}

/** A whole scene as a still (gallery, exports): backdrop, foreground, then the water mirroring both. */
export function composeScene(scene: WorldScene, s: Surface, sc: number, t: number): void {
    scene.draw(s, sc, t)
    if (!scene.front) return
    scene.front(s, sc, t)
    if (scene.water !== undefined) reflectWater(s, scene.water, t, scene.glitter)
}
