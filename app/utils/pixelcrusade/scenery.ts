// Procedural parallax backdrops for Pixel Crusade. Every layer element is derived
// from hash() of a tile index at that layer's parallax offset, so the world tiles
// forever and nothing pops in. Static sky bands and fog are baked once into small
// offscreen canvases; everything else is drawn with integer fillRects each frame.

import { C } from './palette'
import { GROUND, LH, LW, disc, dither, ellipse, hash, line, px, rect } from './pixel'

type Ctx = CanvasRenderingContext2D

/** Ambient accent colour per zone (sun, fireflies, moonlight, lava glow). */
export const ZONE_LIGHT: string[] = [C.gold3, C.green4, C.steel3, C.orange]

// ------------------------------------------------------------------ noise

function mod(a: number, n: number): number {
    const r = a % n
    return r < 0 ? r + n : r
}

/** Deterministic [0,1) for (index, seed). */
function h2(i: number, s: number): number {
    return hash((Math.imul(i | 0, 0x2c1b3c6d) ^ Math.imul(s | 0, 0x297a2d39)) & 0xffffff)
}

function vnoise(x: number, period: number, seed: number): number {
    const f = x / period
    const i = Math.floor(f)
    const u = f - i
    const s = u * u * (3 - 2 * u)
    const a = h2(i, seed)
    return a + (h2(i + 1, seed) - a) * s
}

/** Value noise that repeats every period * count px (for baked strips). */
function pnoise(x: number, period: number, count: number, seed: number): number {
    const f = x / period
    const i = Math.floor(f)
    const u = f - i
    const s = u * u * (3 - 2 * u)
    const a = h2(mod(i, count), seed)
    return a + (h2(mod(i + 1, count), seed) - a) * s
}

let peakSide = 0

function peakC(k: number, period: number, seed: number): number {
    return (k + 0.2 + h2(k, seed) * 0.6) * period
}

function peakH(k: number, seed: number, crater: boolean): number {
    return crater ? 0.55 + h2(k, seed + 1) * 0.45 : 0.45 + h2(k, seed + 1) * 0.55
}

function peakW(k: number, period: number, seed: number, crater: boolean): number {
    return period * (crater ? 0.42 + h2(k, seed + 2) * 0.25 : 0.6 + h2(k, seed + 2) * 0.5)
}

/** Triangle peaks, one per cell; crater=true flattens and dents the summit. */
function peaks(wx: number, period: number, seed: number, crater: boolean): number {
    const i = Math.floor(wx / period)
    let best = 0
    let side = 0
    for (let k = i - 1; k <= i + 1; k++) {
        const c = peakC(k, period, seed)
        const hh = peakH(k, seed, crater)
        const hw = peakW(k, period, seed, crater)
        let v = hh * (1 - Math.abs(wx - c) / hw)
        if (crater) {
            const cap = hh * 0.82
            if (v > cap) v = cap - (v - cap) * 0.5
        }
        if (v > best) {
            best = v
            side = wx < c ? 0 : 1
        }
    }
    peakSide = side
    return best
}

function sampleN(mode: number, wx: number, period: number, seed: number): number {
    if (mode === 0) return vnoise(wx, period, seed) * 0.7 + vnoise(wx, period * 0.29, seed + 7) * 0.3
    return peaks(wx, period, seed, mode === 2)
}

// ------------------------------------------------------------------ ridges

const HB = new Int16Array(LW)
const HS = new Uint8Array(LW)

/**
 * Fill HB with the silhouette y per screen column (mode 0 rolling, 1 peaks, 2
 * volcanoes) and HS with 1 where the slope faces the light.
 */
function heights(mode: number, ox: number, period: number, seed: number, base: number, amp: number, jag: number, litRight: boolean): void {
    let prev = 0
    let lit = 0
    for (let x = -6; x < LW; x++) {
        const wx = ox + x
        let n = sampleN(mode, wx, period, seed)
        if (jag > 0) n += (h2(Math.floor(wx / 3), seed + 9) - 0.5) * jag
        const y = Math.round(base - amp * n)
        if (mode === 0) {
            if (y < prev) lit = litRight ? 0 : 1
            else if (y > prev) lit = litRight ? 1 : 0
        } else {
            lit = (peakSide === 1) === litRight ? 1 : 0
        }
        prev = y
        if (x >= 0) {
            HB[x] = y
            HS[x] = lit
        }
    }
}

function paintRidge(ctx: Ctx, bottom: number, body: string, lit: string | null, litDepth: number, rim: string | null): void {
    ctx.fillStyle = body
    let x = 0
    while (x < LW) {
        const y = HB[x]!
        let e = x + 1
        while (e < LW && HB[e] === y) e++
        if (bottom > y) ctx.fillRect(x, y, e - x, bottom - y)
        x = e
    }
    if (lit !== null) {
        ctx.fillStyle = lit
        for (let i = 0; i < LW; i++) {
            if (HS[i] === 0) continue
            const y = HB[i]!
            const d = Math.min(litDepth, bottom - y)
            if (d > 0) ctx.fillRect(i, y, 1, d)
        }
    }
    if (rim !== null) {
        ctx.fillStyle = rim
        for (let i = 0; i < LW; i++) {
            if (HS[i] !== 0) ctx.fillRect(i, HB[i]!, 1, 1)
        }
    }
}

/** Canopy hanging from the top: fill 0..HB with a leafy rim row at the bottom edge. */
function paintHang(ctx: Ctx, body: string, rim: string, ox: number): void {
    ctx.fillStyle = body
    let x = 0
    while (x < LW) {
        const y = HB[x]!
        let e = x + 1
        while (e < LW && HB[e] === y) e++
        if (y > 0) ctx.fillRect(x, 0, e - x, y)
        x = e
    }
    ctx.fillStyle = rim
    for (let i = 0; i < LW; i++) {
        const r = h2(i + ox, 77)
        if (r < 0.55) ctx.fillRect(i, HB[i]! - 1, 1, 1)
        if (r < 0.12) ctx.fillRect(i, HB[i]!, 1, 1 + ((r * 30) | 0) % 3)
    }
}

// ------------------------------------------------------------------ baked sky + fog

const SKY_COL: readonly (readonly string[])[] = [
    [C.night1, C.night2, C.night3, C.haze, C.red3, C.orange, C.gold2, C.gold3],
    [C.void, C.night0, C.green0, C.green1],
    [C.void, C.night0, C.night1, C.night2],
    [C.void, C.red0, C.red1, C.lava0]
]
const SKY_Y: readonly (readonly number[])[] = [
    [0, 14, 30, 44, 56, 68, 78, 88],
    [0, 16, 40, 80],
    [0, 20, 50, 84],
    [0, 12, 52, 86]
]

const MOON_X = 62
const MOON_Y = 34
const MOON_R = 16

const SKY: (HTMLCanvasElement | null)[] = [null, null, null, null]

function ditherDisc(g: Ctx, cx: number, cy: number, r: number, c: string, level: number): void {
    const rr = r * r + r * 0.8
    for (let dy = -r; dy <= r; dy++) {
        const half = Math.floor(Math.sqrt(Math.max(0, rr - dy * dy)))
        dither(g, cx - half, cy + dy, half * 2 + 1, 1, c, level)
    }
}

function bakeSky(z: number): HTMLCanvasElement {
    const cv = document.createElement('canvas')
    cv.width = LW
    cv.height = GROUND
    const g = cv.getContext('2d')!
    const cols = SKY_COL[z]!
    const ys = SKY_Y[z]!
    for (let i = 0; i < cols.length; i++) {
        const y0 = ys[i]!
        const y1 = i + 1 < ys.length ? ys[i + 1]! : GROUND
        rect(g, 0, y0, LW, y1 - y0, cols[i]!)
    }
    // ordered-dither each band edge up into the band above
    for (let i = 1; i < cols.length; i++) {
        const y = ys[i]!
        const c = cols[i]!
        dither(g, 0, y - 6, LW, 2, c, 1)
        dither(g, 0, y - 4, LW, 2, c, 2)
        dither(g, 0, y - 2, LW, 2, c, 3)
    }
    if (z === 0) {
        // low golden sun with a dithered halo
        ditherDisc(g, 190, 80, 27, C.gold2, 1)
        ditherDisc(g, 190, 80, 21, C.gold2, 2)
        disc(g, 190, 80, 16, C.gold2)
        disc(g, 190, 80, 14, C.gold3)
        disc(g, 189, 79, 8, C.white)
        // thin cloud streaks across the sun
        rect(g, 160, 72, 26, 1, C.orange)
        rect(g, 178, 71, 18, 1, C.red3)
        rect(g, 196, 86, 34, 1, C.orange)
        rect(g, 204, 85, 12, 1, C.red3)
    } else if (z === 1) {
        // moonbeams slanting through canopy gaps
        for (let b = 0; b < 3; b++) {
            const bx = 30 + b * 84
            const bw = 6 + b * 2
            for (let y = 8; y < GROUND; y++) {
                dither(g, bx + Math.floor(y * 0.42), y, bw, 1, C.green2, 1)
            }
        }
    } else if (z === 2) {
        ditherDisc(g, MOON_X, MOON_Y, 34, C.night2, 1)
        ditherDisc(g, MOON_X, MOON_Y, 26, C.night2, 2)
        ditherDisc(g, MOON_X, MOON_Y, 21, C.night3, 1)
        disc(g, MOON_X, MOON_Y, MOON_R, C.white)
        disc(g, MOON_X + 1, MOON_Y + 1, MOON_R, C.bone1)
        // terminator: dither the lower-right limb
        g.fillStyle = C.bone0
        const r = MOON_R
        const rr = r * r + r * 0.8
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > rr) continue
                const k = dx * 0.8 + dy * 0.6
                const x = MOON_X + 1 + dx
                const y = MOON_Y + 1 + dy
                const b = ((x & 1) === 0 ? ((y & 1) === 0 ? 0 : 3) : ((y & 1) === 0 ? 2 : 1))
                const level = k > r * 0.85 ? 4 : k > r * 0.6 ? 2 : k > r * 0.4 ? 1 : 0
                if (b < level) g.fillRect(x, y, 1, 1)
            }
        }
        ellipse(g, MOON_X - 4, MOON_Y - 3, 3, 2, C.bone0)
        px(g, MOON_X - 6, MOON_Y - 5, C.white)
        ellipse(g, MOON_X + 6, MOON_Y + 6, 4, 3, C.bone0)
        px(g, MOON_X + 3, MOON_Y + 4, C.white)
        ellipse(g, MOON_X + 5, MOON_Y - 7, 2, 1, C.bone0)
        disc(g, MOON_X - 6, MOON_Y + 7, 2, C.bone0)
        px(g, MOON_X + 1, MOON_Y - 1, C.bone0)
        px(g, MOON_X - 9, MOON_Y + 1, C.bone0)
    }
    return cv
}

function sky(z: number): HTMLCanvasElement {
    let c = SKY[z]
    if (!c) {
        c = bakeSky(z)
        SKY[z] = c
    }
    return c
}

const FOG_W = 512
const FOG_H = 22
const FOG: (HTMLCanvasElement | null)[] = [null, null, null, null]
const FOG_COL: readonly string[] = [C.haze, C.green2, C.night3, C.brown1]

function bakeFog(z: number): HTMLCanvasElement {
    const cv = document.createElement('canvas')
    cv.width = FOG_W
    cv.height = FOG_H
    const g = cv.getContext('2d')!
    g.fillStyle = FOG_COL[z]!
    for (let x = 0; x < FOG_W; x++) {
        const n = pnoise(x, 64, 8, 90 + z) * 0.65 + pnoise(x, 16, 32, 95 + z) * 0.35
        for (let y = 0; y < FOG_H; y++) {
            const v = y / FOG_H
            // thick at the bottom, frayed on top, lumpy along x
            const d = (v * 1.3 - 0.45 + (n - 0.5) * 0.9) * 2.5
            const level = d < 0.4 ? 0 : d < 1.8 ? 1 : 2
            const b = ((x & 1) === 0 ? ((y & 1) === 0 ? 0 : 3) : ((y & 1) === 0 ? 2 : 1))
            if (b < level) g.fillRect(x, y, 1, 1)
        }
    }
    return cv
}

/** Drifting dithered fog band; offsets are even so the 2×2 dither never shimmers. */
function fog(ctx: Ctx, z: number, off: number, y: number): void {
    let c = FOG[z]
    if (!c) {
        c = bakeFog(z)
        FOG[z] = c
    }
    const o = mod(Math.round(off / 2) * 2, FOG_W)
    ctx.drawImage(c, -o, y)
    ctx.drawImage(c, FOG_W - o, y)
}

// ------------------------------------------------------------------ shared bits

const STAR_N = 56
const STAR_X = new Int16Array(STAR_N)
const STAR_Y = new Int16Array(STAR_N)
const STAR_P = new Uint8Array(STAR_N)
const STAR_M = new Uint8Array(STAR_N)
for (let i = 0; i < STAR_N; i++) {
    const x = (hash(i * 3 + 1) * LW) | 0
    const y = (hash(i * 3 + 2) * 80) | 0
    STAR_X[i] = x
    STAR_Y[i] = y
    STAR_P[i] = (hash(i * 3 + 3) * 64) | 0
    const dx = x - MOON_X
    const dy = y - MOON_Y
    STAR_M[i] = dx * dx + dy * dy < (MOON_R + 7) * (MOON_R + 7) ? 1 : 0
}

function stars(ctx: Ctx, n: number, maxY: number, dim: string, bright: string, tick: number, skipMoon: boolean): void {
    for (let i = 0; i < n; i++) {
        const y = STAR_Y[i]!
        if (y > maxY) continue
        if (skipMoon && STAR_M[i] === 1) continue
        const x = STAR_X[i]!
        const k = mod(tick + STAR_P[i]!, 48)
        if (k < 3) {
            px(ctx, x, y, bright)
            if (i % 6 === 0 && k === 1) {
                ctx.fillStyle = dim
                ctx.fillRect(x - 1, y, 1, 1)
                ctx.fillRect(x + 1, y, 1, 1)
                ctx.fillRect(x, y - 1, 1, 1)
                ctx.fillRect(x, y + 1, 1, 1)
            }
        } else if (k < 5 || (i & 3) === 3) {
            continue
        } else {
            px(ctx, x, y, dim)
        }
    }
}

function cloud(ctx: Ctx, x: number, y: number, w: number, seed: number, top: string, body: string, under: string): void {
    const n = 2 + ((h2(seed, 1) * 3) | 0)
    for (let pass = 0; pass < 2; pass++) {
        const col = pass === 0 ? top : body
        for (let k = 0; k < n; k++) {
            const r = 2 + ((h2(seed, 10 + k) * 4) | 0)
            const cx = x + Math.round((k + 0.5) * w / n)
            disc(ctx, cx, y - r + 2 + pass, r, col)
        }
    }
    rect(ctx, x, y + 1, w, 2, body)
    rect(ctx, x + 2, y + 3, w - 4, 1, under)
}

function clouds(ctx: Ctx, off: number, tw: number, y0: number, yh: number, seed: number, chance: number, top: string, body: string, under: string): void {
    const ox = Math.round(off)
    const i0 = Math.floor((ox - 80) / tw)
    const i1 = Math.floor((ox + LW) / tw)
    for (let i = i0; i <= i1; i++) {
        if (h2(i, seed) > chance) continue
        const w = 22 + ((h2(i, seed + 1) * 40) | 0)
        const x = i * tw + ((h2(i, seed + 2) * (tw - 20)) | 0) - ox
        const y = y0 + ((h2(i, seed + 3) * yh) | 0)
        cloud(ctx, x, y, w, i * 31 + seed, top, body, under)
    }
}

/** Two-frame flapping bird/bat silhouette. */
function flapper(ctx: Ctx, x: number, y: number, frame: number, c: string, bat: boolean): void {
    ctx.fillStyle = c
    ctx.fillRect(x - 1, y, 3, 1)
    if (frame === 0) {
        ctx.fillRect(x - 2, y - 1, 1, 1)
        ctx.fillRect(x + 2, y - 1, 1, 1)
        ctx.fillRect(x - 3, y - 2, 1, 1)
        ctx.fillRect(x + 3, y - 2, 1, 1)
    } else {
        ctx.fillRect(x - 3, y + 1, 2, 1)
        ctx.fillRect(x + 2, y + 1, 2, 1)
    }
    if (bat) {
        ctx.fillRect(x, y - 1, 1, 1)
        ctx.fillRect(x, y + 1, 1, 1)
    }
}

function fireflies(ctx: Ctx, n: number, seed: number, scroll: number, f: number, tq: number, tick: number, y0: number, yh: number, glow: boolean): void {
    const span = LW + 40
    for (let i = 0; i < n; i++) {
        const s = seed + i * 7
        const x = Math.round(mod(h2(s, 1) * span - scroll * f + Math.sin(tq * 0.6 + h2(s, 2) * 6.28) * 14 + tq * 3, span)) - 20
        const y = Math.round(y0 + h2(s, 3) * yh + Math.sin(tq * 1.1 + h2(s, 4) * 6.28) * 5)
        const on = mod(tick + ((h2(s, 5) * 40) | 0), 40)
        if (on >= 22) continue
        const core = on < 3 || on > 18 ? C.green2 : C.gold3
        if (glow && on >= 6 && on <= 14) {
            ctx.fillStyle = C.green1
            ctx.fillRect(x - 1, y, 3, 1)
            ctx.fillRect(x, y - 1, 1, 3)
        }
        px(ctx, x, y, core)
    }
}

// ------------------------------------------------------------------ zone 0: Greenwood Meadow

function castle(ctx: Ctx, x: number, yb: number, tick: number, seed: number): void {
    const body = C.blue0
    const lit = C.night2
    // curtain wall with crenels
    rect(ctx, x, yb - 12, 36, 16, body)
    for (let k = 0; k < 9; k++) rect(ctx, x + k * 4, yb - 14, 2, 2, body)
    // left tower
    rect(ctx, x - 4, yb - 22, 7, 26, body)
    rect(ctx, x - 4, yb - 24, 2, 2, body)
    rect(ctx, x - 1, yb - 24, 1, 2, body)
    rect(ctx, x + 1, yb - 24, 2, 2, body)
    rect(ctx, x + 2, yb - 22, 1, 26, lit)
    // keep with conical roof
    rect(ctx, x + 13, yb - 30, 9, 34, body)
    for (let k = 0; k < 4; k++) rect(ctx, x + 13 + k, yb - 32 - k * 2, 9 - k * 2, 2, body)
    rect(ctx, x + 21, yb - 30, 1, 30, lit)
    for (let k = 0; k < 4; k++) px(ctx, x + 21 - k, yb - 31 - k * 2, lit)
    // right tower
    rect(ctx, x + 32, yb - 19, 6, 23, body)
    rect(ctx, x + 32, yb - 21, 2, 2, body)
    rect(ctx, x + 36, yb - 21, 2, 2, body)
    rect(ctx, x + 37, yb - 19, 1, 23, lit)
    // banner on the keep
    rect(ctx, x + 17, yb - 44, 1, 5, body)
    const wave = ((tick + seed) >> 2) & 1
    rect(ctx, x + 18, yb - 44, 3, 1, C.red1)
    rect(ctx, x + 18, yb - 43 + wave, 3, 1, C.red1)
    // warm windows, one flickers
    const flick = mod(tick + seed, 23) < 2
    px(ctx, x + 17, yb - 24, C.gold2)
    px(ctx, x + 17, yb - 18, flick ? C.gold1 : C.gold2)
    px(ctx, x - 1, yb - 16, C.gold1)
    px(ctx, x + 34, yb - 13, C.gold2)
    px(ctx, x + 6, yb - 6, C.gold1)
    px(ctx, x + 27, yb - 7, C.gold1)
}

function meadow(ctx: Ctx, scroll: number, tq: number, tick: number): void {
    stars(ctx, 20, 22, C.night3, C.haze, tick, false)
    clouds(ctx, scroll * 0.04 + tq * 1.5, 96, 12, 34, 11, 0.55, C.haze, C.night3, C.red3)

    // birds heading home
    for (let b = 0; b < 3; b++) {
        const x = Math.round(mod(h2(b, 300) * 520 - tq * (7 + b * 2) - scroll * 0.06, 520)) - 40
        const y = 34 + ((h2(b, 301) * 26) | 0) + Math.round(Math.sin(tq * 0.8 + b) * 2)
        flapper(ctx, x, y, ((tick + b * 3) >> 2) & 1, C.night1, false)
    }

    // far mountains, lit from the sun on the right
    const o1 = Math.round(scroll * 0.1)
    heights(1, o1, 72, 3, 100, 40, 0.04, true)
    paintRidge(ctx, GROUND, C.night2, C.night3, 9, C.haze)

    // blue hills with a castle
    const o2 = Math.round(scroll * 0.18)
    heights(0, o2, 84, 5, 106, 18, 0, true)
    paintRidge(ctx, GROUND, C.blue0, C.night1, 3, C.night2)
    const tw2 = 380
    for (let i = Math.floor((o2 - 60) / tw2); i <= Math.floor((o2 + LW) / tw2); i++) {
        if (h2(i, 40) > 0.6) continue
        const wx = i * tw2 + 40 + ((h2(i, 41) * (tw2 - 120)) | 0)
        const sx = wx - o2
        if (sx < -50 || sx > LW + 10) continue
        const yb = Math.round(106 - 18 * sampleN(0, wx + 18, 84, 5)) + 3
        castle(ctx, sx, yb, tick, i & 15)
    }

    // green rolling hills with round trees
    const o3 = Math.round(scroll * 0.3)
    heights(0, o3, 60, 7, 112, 13, 0, true)
    paintRidge(ctx, GROUND, C.green0, C.green1, 3, C.green2)
    const tw3 = 17
    for (let i = Math.floor((o3 - 20) / tw3); i <= Math.floor((o3 + LW + 20) / tw3); i++) {
        const r = h2(i, 42)
        if (r > 0.42) continue
        const wx = i * tw3 + ((h2(i, 43) * 10) | 0)
        const sx = wx - o3
        const yb = Math.round(112 - 13 * sampleN(0, wx, 60, 7)) + 1
        const rad = 3 + ((h2(i, 44) * 3) | 0)
        rect(ctx, sx, yb - 3, 1, 3, C.brown0)
        if (r < 0.12) {
            // poplar
            ellipse(ctx, sx + 1, yb - 9, 2, 6, C.green1)
            ellipse(ctx, sx, yb - 8, 2, 6, C.green0)
        } else {
            disc(ctx, sx + 1, yb - 3 - rad, rad, C.green1)
            disc(ctx, sx, yb - 2 - rad, rad, C.green0)
        }
    }

    // near hedgerow and fences
    const o4 = Math.round(scroll * 0.6)
    heights(0, o4, 26, 9, 117, 8, 0.25, true)
    paintRidge(ctx, GROUND, C.green1, C.green2, 2, null)
    const tw4 = 44
    for (let i = Math.floor((o4 - 30) / tw4); i <= Math.floor((o4 + LW) / tw4); i++) {
        if (h2(i, 45) > 0.4) continue
        const x = i * tw4 + ((h2(i, 46) * 12) | 0) - o4
        const len = 14 + ((h2(i, 47) * 2) | 0) * 12
        rect(ctx, x, GROUND - 7, len + 2, 1, C.brown1)
        rect(ctx, x, GROUND - 4, len + 2, 1, C.brown1)
        for (let p = 0; p <= len; p += 12) {
            rect(ctx, x + p, GROUND - 9, 2, 9, C.brown1)
            px(ctx, x + p + 1, GROUND - 9, C.brown2)
        }
    }

    meadowFloor(ctx, scroll)
}

const FLOWERS: readonly string[] = [C.pink, C.gold3, C.white, C.red3, C.cyan]

function meadowFloor(ctx: Ctx, scroll: number): void {
    const ox = Math.round(scroll)
    rect(ctx, 0, GROUND, LW, 5, C.green2)
    rect(ctx, 0, GROUND, LW, 1, C.green3)
    rect(ctx, 0, GROUND + 5, LW, 1, C.green1)
    rect(ctx, 0, GROUND + 6, LW, 10, C.brown2)
    rect(ctx, 0, GROUND + 6, LW, 1, C.brown1)
    rect(ctx, 0, GROUND + 16, LW, 1, C.brown1)
    rect(ctx, 0, GROUND + 17, LW, 4, C.green1)
    rect(ctx, 0, GROUND + 21, LW, 5, C.green0)

    for (let x = 0; x < LW; x++) {
        const wx = x + ox
        const r = h2(wx, 50)
        if (r < 0.16) px(ctx, x, GROUND - 1, C.green2)
        else if (r > 0.9) px(ctx, x, GROUND + 1, C.green3)
        const r2 = h2(wx, 51)
        if (r2 < 0.3) px(ctx, x, GROUND + 2 + (r2 < 0.15 ? 1 : 0), C.green1)
        if (r2 > 0.55) px(ctx, x, GROUND + 6, C.green1)
        if (r2 > 0.85) px(ctx, x, GROUND + 7, C.green1)
        const r3 = h2(wx, 52)
        if (r3 < 0.35) px(ctx, x, GROUND + 15, C.green1)
        if (r3 > 0.75) px(ctx, x, GROUND + 18 + ((r3 * 40) | 0) % 5, C.green2)
        else if (r3 > 0.62) px(ctx, x, GROUND + 22 + ((r3 * 40) | 0) % 4, C.green1)
    }

    // pebbles and ruts on the path
    const i0 = Math.floor((ox - 8) / 7)
    const i1 = Math.floor((ox + LW) / 7)
    for (let i = i0; i <= i1; i++) {
        const r = h2(i, 53)
        const x = i * 7 + ((h2(i, 54) * 5) | 0) - ox
        if (r < 0.35) {
            const y = GROUND + 8 + ((h2(i, 55) * 6) | 0)
            const w = r < 0.1 ? 2 : 1
            rect(ctx, x, y, w, 1, C.brown3)
            rect(ctx, x, y + 1, w, 1, C.brown1)
        } else if (r < 0.6) {
            rect(ctx, x, GROUND + (r < 0.48 ? 10 : 13), 3 + ((r * 20) | 0) % 4, 1, C.brown1)
        }
    }

    // flowers in the lower grass
    const f0 = Math.floor((ox - 4) / 9)
    const f1 = Math.floor((ox + LW) / 9)
    for (let i = f0; i <= f1; i++) {
        const r = h2(i, 56)
        if (r > 0.45) continue
        const x = i * 9 + ((h2(i, 57) * 7) | 0) - ox
        const y = GROUND + 18 + ((h2(i, 58) * 5) | 0)
        const c = FLOWERS[(h2(i, 59) * FLOWERS.length) | 0]!
        px(ctx, x, y + 1, C.green2)
        if (r < 0.12) {
            px(ctx, x - 1, y, c)
            px(ctx, x + 1, y, c)
            px(ctx, x, y - 1, c)
            px(ctx, x, y, C.gold2)
        } else {
            px(ctx, x, y, c)
        }
    }
}

// ------------------------------------------------------------------ zone 1: Darkroot Forest

function trunk(ctx: Ctx, x: number, w: number, bottom: number, body: string, lit: string, dark: string, moss: string, seed: number): void {
    rect(ctx, x, 0, w, bottom, body)
    rect(ctx, x, 0, w > 12 ? 2 : 1, bottom, lit)
    rect(ctx, x + w - 1, 0, 1, bottom, dark)
    ctx.fillStyle = dark
    for (let g = 0; g < 3; g++) {
        const gx = x + 3 + ((h2(seed, 20 + g) * (w - 5)) | 0)
        const gy = (h2(seed, 30 + g) * (bottom - 30)) | 0
        ctx.fillRect(gx, gy, 1, 8 + ((h2(seed, 40 + g) * 18) | 0))
    }
    // knot hole
    if (h2(seed, 49) < 0.4 && w > 9) {
        const ky = 30 + ((h2(seed, 48) * 50) | 0)
        rect(ctx, x + (w >> 1) - 1, ky, 3, 4, dark)
        px(ctx, x + (w >> 1) - 1, ky, lit)
    }
    ctx.fillStyle = moss
    for (let m = 0; m < 3; m++) {
        const my = ((h2(seed, 50 + m) * (bottom - 20)) | 0) + 10
        ctx.fillRect(x, my, 2 + ((h2(seed, 55 + m) * 3) | 0), 2 + ((h2(seed, 58 + m) * 5) | 0))
    }
    // root flare
    for (let r = 1; r <= 4; r++) {
        rect(ctx, x - r, bottom - 5 + r, w + r * 2, 1, body)
        px(ctx, x - r, bottom - 5 + r, lit)
    }
}

function mushroom(ctx: Ctx, x: number, y: number, cap: string, glow: string, big: boolean, tick: number, ph: number): void {
    const pulse = mod(tick + ph, 24) < 12 ? 1 : 0
    ditherDisc(ctx, x, y - 3, (big ? 5 : 4) + pulse, glow, 1)
    rect(ctx, x, y - 2, 1, 2, C.bone1)
    if (big) {
        rect(ctx, x - 2, y - 4, 5, 2, cap)
        rect(ctx, x - 1, y - 5, 3, 1, cap)
        px(ctx, x - 1, y - 4, C.white)
    } else {
        rect(ctx, x - 1, y - 3, 3, 1, cap)
        px(ctx, x, y - 4, cap)
    }
}

function forest(ctx: Ctx, scroll: number, tq: number, tick: number): void {
    // far trunks and canopy
    const o1 = Math.round(scroll * 0.1)
    const tw1 = 26
    for (let i = Math.floor((o1 - 14) / tw1); i <= Math.floor((o1 + LW) / tw1); i++) {
        if (h2(i, 60) > 0.75) continue
        const w = 4 + ((h2(i, 61) * 6) | 0)
        const x = i * tw1 + ((h2(i, 62) * (tw1 - w)) | 0) - o1
        rect(ctx, x, 0, w, GROUND, C.green0)
        rect(ctx, x, 0, 1, GROUND, C.green1)
    }
    heights(0, o1, 40, 21, 16, -18, 0.3, false)
    paintHang(ctx, C.void, C.night0, o1)

    fog(ctx, 1, scroll * 0.2 + tq * 2, 96)

    // mid trunks with glowing mushrooms
    const o2 = Math.round(scroll * 0.3)
    const tw2 = 58
    for (let i = Math.floor((o2 - 30) / tw2); i <= Math.floor((o2 + LW + 10) / tw2); i++) {
        if (h2(i, 63) > 0.8) continue
        const w = 9 + ((h2(i, 64) * 7) | 0)
        const x = i * tw2 + ((h2(i, 65) * (tw2 - w - 8)) | 0) + 4 - o2
        trunk(ctx, x, w, GROUND, C.night0, C.night1, C.void, C.green1, i * 13 + 1)
        const m = h2(i, 66)
        if (m < 0.55) {
            const cyan = m < 0.3
            mushroom(ctx, x - 3, GROUND, cyan ? C.cyan : C.pink, cyan ? C.blue1 : C.purple1, m < 0.15, tick, i & 31)
            if (m < 0.4) mushroom(ctx, x + w + 2, GROUND, cyan ? C.cyan : C.pink, cyan ? C.blue1 : C.purple1, false, tick, (i + 7) & 31)
        }
    }
    heights(0, o2, 34, 23, 6, -14, 0.5, false)
    paintHang(ctx, C.green0, C.green1, o2)

    // hanging vines
    const tv = 30
    for (let i = Math.floor((o2 - 4) / tv); i <= Math.floor((o2 + LW + 4) / tv); i++) {
        if (h2(i, 67) > 0.55) continue
        const wx = i * tv + ((h2(i, 68) * 24) | 0)
        const x = wx - o2
        const top = Math.round(6 + 14 * sampleN(0, wx, 34, 23)) - 4
        const len = 14 + ((h2(i, 69) * 44) | 0)
        const sw = Math.sin(tq * 1.4 + h2(i, 70) * 6.28)
        ctx.fillStyle = C.green1
        for (let s = 0; s < len; s += 3) ctx.fillRect(x + Math.round(sw * 2 * s / len), top + s, 1, 3)
        ctx.fillStyle = C.green2
        for (let s = 6; s < len; s += 5) {
            ctx.fillRect(x + Math.round(sw * 2 * s / len) + (((s / 5) | 0) & 1 ? 1 : -1), top + s, 1, 1)
        }
        ctx.fillRect(x + Math.round(sw * 2), top + len, 1, 1)
    }

    fireflies(ctx, 10, 700, scroll, 0.45, tq, tick, 48, 60, true)

    // near giant trunks
    const o3 = Math.round(scroll * 0.6)
    const tw3 = 180
    for (let i = Math.floor((o3 - 40) / tw3); i <= Math.floor((o3 + LW) / tw3); i++) {
        if (h2(i, 71) > 0.6) continue
        const w = 16 + ((h2(i, 72) * 9) | 0)
        const x = i * tw3 + ((h2(i, 73) * (tw3 - w - 10)) | 0) + 5 - o3
        trunk(ctx, x, w, GROUND, C.brown0, C.brown1, C.ink, C.green0, i * 17 + 5)
    }

    forestFloor(ctx, scroll)
}

function forestFloor(ctx: Ctx, scroll: number): void {
    const ox = Math.round(scroll)
    rect(ctx, 0, GROUND, LW, 1, C.green2)
    rect(ctx, 0, GROUND + 1, LW, 3, C.green1)
    rect(ctx, 0, GROUND + 4, LW, 1, C.green0)
    rect(ctx, 0, GROUND + 5, LW, 10, C.brown0)
    rect(ctx, 0, GROUND + 15, LW, 11, C.ink)

    for (let x = 0; x < LW; x++) {
        const wx = x + ox
        const r = h2(wx, 80)
        if (r < 0.1) px(ctx, x, GROUND + 1, C.green3)
        else if (r < 0.3) px(ctx, x, GROUND + 2 + (r < 0.2 ? 1 : 0), C.green0)
        const r2 = h2(wx, 81)
        if (r2 < 0.45) px(ctx, x, GROUND + 4, C.green1)
        if (r2 < 0.15) px(ctx, x, GROUND + 5, C.green0)
        if (r2 > 0.6) px(ctx, x, GROUND + 15, C.brown0)
        if (r2 > 0.88) px(ctx, x, GROUND + 16, C.brown0)
    }

    // roots
    const tw = 36
    for (let i = Math.floor((ox - 34) / tw); i <= Math.floor((ox + LW) / tw); i++) {
        if (h2(i, 82) > 0.7) continue
        let x = i * tw + ((h2(i, 83) * 10) | 0) - ox
        let y = GROUND + 6 + ((h2(i, 84) * 6) | 0)
        const len = 12 + ((h2(i, 85) * 20) | 0)
        let s = 0
        while (s < len) {
            const seg = 3 + ((h2(i * 16 + s, 86) * 4) | 0)
            rect(ctx, x, y, seg, 2, C.brown1)
            rect(ctx, x, y, seg, 1, C.brown2)
            x += seg
            s += seg
            const d = h2(i * 16 + s, 87)
            y += d < 0.35 ? -1 : d > 0.65 ? 1 : 0
            if (y < GROUND + 5) y = GROUND + 5
            if (y > GROUND + 13) y = GROUND + 13
        }
    }

    // stones and tiny floor mushrooms
    const ts = 17
    for (let i = Math.floor((ox - 4) / ts); i <= Math.floor((ox + LW) / ts); i++) {
        const r = h2(i, 88)
        const x = i * ts + ((h2(i, 89) * 12) | 0) - ox
        if (r < 0.28) {
            const y = GROUND + 8 + ((h2(i, 90) * 5) | 0)
            const w = 2 + ((r * 10) | 0)
            rect(ctx, x, y, w, 2, C.stone1)
            rect(ctx, x, y, w - 1, 1, C.stone2)
        } else if (r > 0.86) {
            px(ctx, x, GROUND - 1, C.bone1)
            rect(ctx, x - 1, GROUND - 2, 3, 1, C.red2)
            px(ctx, x, GROUND - 3, C.red2)
            px(ctx, x - 1, GROUND - 2, C.red3)
        }
    }
}

// ------------------------------------------------------------------ zone 2: Forsaken Crypt

function tombstone(ctx: Ctx, x: number, yb: number, w: number, h: number, body: string, rim: string): void {
    rect(ctx, x, yb - h + 1, w, h, body)
    rect(ctx, x + 1, yb - h, w - 2, 1, body)
    rect(ctx, x, yb - h + 1, 1, h - 1, rim)
    rect(ctx, x + 1, yb - h, w - 3, 1, rim)
}

function cross(ctx: Ctx, x: number, yb: number, h: number, body: string, rim: string): void {
    rect(ctx, x, yb - h, 2, h + 1, body)
    rect(ctx, x - 2, yb - h + 2, 6, 2, body)
    rect(ctx, x, yb - h, 1, h, rim)
    rect(ctx, x - 2, yb - h + 2, 2, 1, rim)
}

function deadTree(ctx: Ctx, x: number, yb: number, h: number, seed: number, body: string): void {
    rect(ctx, x, yb - h, 2, h + 1, body)
    rect(ctx, x - 1, yb - 2, 4, 3, body)
    for (let b = 0; b < 4; b++) {
        const sy = yb - Math.round(h * (0.45 + b * 0.16))
        const dir = ((b + ((h2(seed, 1) * 2) | 0)) & 1) === 0 ? -1 : 1
        const len = 3 + ((h2(seed, 2 + b) * h * 0.4) | 0)
        const ex = x + (dir > 0 ? 1 : 0) + dir * len
        const ey = sy - Math.round(len * (0.5 + h2(seed, 8 + b) * 0.5))
        line(ctx, x + (dir > 0 ? 1 : 0), sy, ex, ey, body)
        const mx = (x + ex) >> 1
        const my = (sy + ey) >> 1
        line(ctx, mx, my, mx + dir * 2, my - 3, body)
    }
}

function mausoleum(ctx: Ctx, x: number, yb: number, tick: number, seed: number): void {
    const body = C.void
    const rim = C.night2
    rect(ctx, x, yb - 16, 28, 17, body)
    rect(ctx, x - 2, yb - 18, 32, 2, body)
    for (let k = 0; k < 7; k++) rect(ctx, x + 1 + k * 2, yb - 19 - k, 26 - k * 4, 1, body)
    rect(ctx, x + 13, yb - 30, 2, 6, body)
    rect(ctx, x + 11, yb - 28, 6, 2, body)
    rect(ctx, x - 2, yb - 18, 1, 2, rim)
    for (let k = 0; k < 7; k++) px(ctx, x + 1 + k * 2, yb - 19 - k, rim)
    px(ctx, x + 13, yb - 30, rim)
    rect(ctx, x, yb - 16, 1, 17, rim)
    rect(ctx, x + 3, yb - 15, 2, 15, C.night0)
    rect(ctx, x + 23, yb - 15, 2, 15, C.night0)
    rect(ctx, x + 11, yb - 11, 6, 12, C.ink)
    rect(ctx, x + 12, yb - 12, 4, 1, C.ink)
    const f = mod(tick + seed, 30)
    ctx.fillStyle = f < 20 ? C.purple1 : C.purple2
    ctx.fillRect(x + 13, yb - 4, 2, 1)
    ctx.fillRect(x + 12, yb - 1, 4, 1)
}

function church(ctx: Ctx, x: number, yb: number, tick: number): void {
    const body = C.night0
    rect(ctx, x, yb - 12, 22, 16, body)
    for (let k = 0; k < 5; k++) rect(ctx, x + k * 2, yb - 13 - k, 22 - k * 4, 1, body)
    rect(ctx, x + 22, yb - 28, 7, 32, body)
    for (let k = 0; k < 6; k++) rect(ctx, x + 22 + (k >> 1), yb - 29 - k * 2, 7 - (k >> 1) * 2, 2, body)
    rect(ctx, x + 25, yb - 42, 1, 3, body)
    rect(ctx, x + 24, yb - 41, 3, 1, body)
    const flick = mod(tick, 37) < 3
    px(ctx, x + 25, yb - 22, flick ? C.gold2 : C.gold1)
    px(ctx, x + 6, yb - 6, C.gold1)
    px(ctx, x + 12, yb - 6, flick ? C.gold0 : C.gold1)
}

function crypt(ctx: Ctx, scroll: number, tq: number, tick: number): void {
    stars(ctx, STAR_N, 82, C.night3, C.white, tick, true)

    // thin clouds sliding over the moon
    const cw = LW + 140
    for (let c = 0; c < 4; c++) {
        const x = Math.round(mod(h2(c, 100) * cw - tq * (2 + c) - scroll * 0.03, cw)) - 70
        const y = 22 + ((h2(c, 101) * 40) | 0)
        const w = 30 + ((h2(c, 102) * 40) | 0)
        rect(ctx, x, y, w, 2, C.night1)
        rect(ctx, x + 4, y - 1, w - 10, 1, C.night2)
        rect(ctx, x + 8, y + 2, w - 14, 1, C.night1)
    }

    // bats
    for (let b = 0; b < 2; b++) {
        const x = Math.round(mod(h2(b, 110) * 400 - tq * (14 + b * 5) - scroll * 0.08, 400)) - 60
        const y = 40 + ((h2(b, 111) * 30) | 0) + Math.round(Math.sin(tq * 3 + b * 2) * 4)
        flapper(ctx, x, y, ((tick + b * 2) >> 1) & 1, C.void, true)
    }

    // far hills with a ruined church and dead trees
    const o1 = Math.round(scroll * 0.1)
    heights(0, o1, 70, 31, 102, 20, 0.08, false)
    paintRidge(ctx, GROUND, C.night1, null, 0, C.night3)
    const tw1 = 300
    for (let i = Math.floor((o1 - 40) / tw1); i <= Math.floor((o1 + LW) / tw1); i++) {
        if (h2(i, 112) > 0.6) continue
        const wx = i * tw1 + 30 + ((h2(i, 113) * (tw1 - 90)) | 0)
        const yb = Math.round(102 - 20 * sampleN(0, wx + 14, 70, 31)) + 2
        church(ctx, wx - o1, yb, tick + (i & 7) * 5)
    }
    const tt = 23
    for (let i = Math.floor((o1 - 10) / tt); i <= Math.floor((o1 + LW + 10) / tt); i++) {
        if (h2(i, 114) > 0.22) continue
        const wx = i * tt + ((h2(i, 115) * 16) | 0)
        const yb = Math.round(102 - 20 * sampleN(0, wx, 70, 31)) + 1
        deadTree(ctx, wx - o1, yb, 8 + ((h2(i, 116) * 6) | 0), i, C.night0)
    }

    // graveyard silhouettes
    const o2 = Math.round(scroll * 0.3)
    heights(0, o2, 44, 33, 113, 5, 0, false)
    paintRidge(ctx, GROUND, C.void, C.night0, 1, C.night1)
    const tm = 230
    for (let i = Math.floor((o2 - 40) / tm); i <= Math.floor((o2 + LW) / tm); i++) {
        if (h2(i, 117) > 0.6) continue
        const wx = i * tm + ((h2(i, 118) * (tm - 40)) | 0)
        const yb = Math.round(113 - 5 * sampleN(0, wx + 14, 44, 33)) + 1
        mausoleum(ctx, wx - o2, yb, tick, i & 15)
    }
    const tg = 14
    for (let i = Math.floor((o2 - 30) / tg); i <= Math.floor((o2 + LW + 10) / tg); i++) {
        const r = h2(i, 119)
        if (r > 0.64) continue
        const wx = i * tg + ((h2(i, 120) * 8) | 0)
        const sx = wx - o2
        const yb = Math.round(113 - 5 * sampleN(0, wx, 44, 33)) + 1
        if (r < 0.32) tombstone(ctx, sx, yb, 4 + ((h2(i, 121) * 3) | 0), 5 + ((h2(i, 122) * 5) | 0), C.void, C.night2)
        else if (r < 0.54) cross(ctx, sx, yb, 7 + ((h2(i, 123) * 5) | 0), C.void, C.night2)
        else deadTree(ctx, sx, yb, 18 + ((h2(i, 124) * 14) | 0), i + 500, C.void)
    }

    fog(ctx, 2, scroll * 0.35 + tq * 3, 98)

    // near iron fence and big headstones
    const o3 = Math.round(scroll * 0.6)
    const tf = 128
    for (let i = Math.floor((o3 - 80) / tf); i <= Math.floor((o3 + LW) / tf); i++) {
        if (h2(i, 125) > 0.55) continue
        const x0 = i * tf + ((h2(i, 126) * 40) | 0) - o3
        const len = 28 + (((h2(i, 127) * 11) | 0) << 2)
        rect(ctx, x0, GROUND - 12, len, 1, C.void)
        rect(ctx, x0, GROUND - 4, len, 1, C.void)
        for (let b = 2; b < len; b += 4) {
            rect(ctx, x0 + b, GROUND - 14, 1, 14, C.void)
            rect(ctx, x0 + b - 1, GROUND - 14, 3, 1, C.void)
            px(ctx, x0 + b, GROUND - 16, C.night2)
            px(ctx, x0 + b, GROUND - 15, C.void)
        }
        for (let e = 0; e < 2; e++) {
            const px0 = e === 0 ? x0 - 4 : x0 + len
            rect(ctx, px0, GROUND - 17, 4, 17, C.stone1)
            rect(ctx, px0 - 1, GROUND - 18, 6, 2, C.stone1)
            rect(ctx, px0 - 1, GROUND - 18, 6, 1, C.stone2)
            rect(ctx, px0, GROUND - 16, 1, 16, C.stone2)
        }
    }
    const tb = 90
    for (let i = Math.floor((o3 - 20) / tb); i <= Math.floor((o3 + LW) / tb); i++) {
        if (h2(i, 128) > 0.45) continue
        const x = i * tb + ((h2(i, 129) * 70) | 0) - o3
        const w = 7 + ((h2(i, 130) * 4) | 0)
        const h = 10 + ((h2(i, 131) * 7) | 0)
        tombstone(ctx, x, GROUND - 1, w, h, C.stone1, C.stone2)
        rect(ctx, x + w - 1, GROUND - h + 1, 1, h - 1, C.stone0)
        rect(ctx, x + (w >> 1), GROUND - h + 3, 1, 4, C.stone0)
        rect(ctx, x + (w >> 1) - 1, GROUND - h + 4, 3, 1, C.stone0)
        px(ctx, x + 1, GROUND - 2, C.green1)
        px(ctx, x + w - 2, GROUND - 2, C.green0)
    }

    cryptFloor(ctx, scroll)
}

const COB_Y: readonly number[] = [GROUND + 1, GROUND + 5, GROUND + 9, GROUND + 14, GROUND + 19]
const COB_H: readonly number[] = [4, 4, 5, 5, 7]
const COB_BODY: readonly string[] = [C.stone2, C.stone2, C.stone1, C.stone1, C.stone0]
const COB_HI: readonly string[] = [C.stone3, C.stone3, C.stone2, C.stone2, C.stone1]
const COB_GAP: readonly string[] = [C.stone0, C.stone0, C.stone0, C.ink, C.ink]

function cryptFloor(ctx: Ctx, scroll: number): void {
    const ox = Math.round(scroll)
    rect(ctx, 0, GROUND, LW, 1, C.stone3)
    for (let row = 0; row < COB_Y.length; row++) {
        const y = COB_Y[row]!
        const h = COB_H[row]!
        const body = COB_BODY[row]!
        const hi = COB_HI[row]!
        rect(ctx, 0, y, LW, h, COB_GAP[row]!)
        const sh = (row & 1) * 4 + row
        const i0 = Math.floor((ox - sh - 8) / 8)
        const i1 = Math.floor((ox - sh + LW) / 8)
        for (let i = i0; i <= i1; i++) {
            const r = h2(i * 8 + row, 140)
            const x = i * 8 + sh - ox
            const w = r < 0.3 ? 6 : 7
            if (r > 0.94) continue
            rect(ctx, x, y, w, h - 1, r > 0.86 ? COB_GAP[row] === C.ink ? C.stone0 : C.stone1 : body)
            rect(ctx, x, y, w - 1, 1, hi)
            if (r < 0.08) px(ctx, x + 2, y + 1, C.green1)
            else if (r > 0.9 && row < 3) px(ctx, x + 3, y + 2, C.bone0)
        }
    }
    // weeds poking out of the joints
    for (let i = Math.floor(ox / 11); i <= Math.floor((ox + LW) / 11); i++) {
        if (h2(i, 141) > 0.3) continue
        const x = i * 11 + ((h2(i, 142) * 8) | 0) - ox
        px(ctx, x, GROUND - 1, C.green1)
        px(ctx, x + 1, GROUND - 2, C.green0)
    }
}

// ------------------------------------------------------------------ zone 3: Cinder Peaks

function volcanoes(ctx: Ctx, ox: number, tick: number): void {
    const period = 120
    const seed = 51
    const base = 110
    const amp = 66
    heights(2, ox, period, seed, base, amp, 0.03, false)
    paintRidge(ctx, GROUND, C.brown0, C.red0, 10, C.red1)
    for (let k = Math.floor(ox / period) - 1; k <= Math.floor((ox + LW) / period) + 1; k++) {
        const hh = peakH(k, seed, true)
        if (hh < 0.7) continue
        const hw = peakW(k, period, seed, true)
        const cx = Math.round(peakC(k, period, seed)) - ox
        const topY = Math.round(base - amp * hh * 0.82)
        const dipY = Math.round(base - amp * hh * 0.73)
        if (cx < -40 || cx > LW + 40) continue
        if (cx >= 0 && cx < LW && Math.abs(HB[cx]! - dipY) > 4) continue
        // glowing crater lip
        const cw = Math.max(2, Math.round(hw * 0.18) - 1)
        ctx.fillStyle = C.lava1
        for (let x = cx - cw; x <= cx + cw; x++) {
            if (x >= 0 && x < LW) ctx.fillRect(x, HB[x]!, 1, 1)
        }
        dither(ctx, cx - cw - 2, topY - 3, cw * 2 + 5, 2, C.lava0, 1)
        // smoke plume
        for (let j = 0; j < 5; j++) {
            const rise = mod(tick * 0.5 + j * 7 + k * 3, 35)
            const r = 2 + Math.floor(rise / 9)
            disc(ctx, cx + Math.round(rise * 0.5), topY - 4 - Math.round(rise), r, j & 1 ? C.stone0 : C.brown0)
        }
        // lava streams
        for (let st = 0; st < 2; st++) {
            let sx = cx + (st === 0 ? -cw + 1 : cw - 1)
            const sy = (sx >= 0 && sx < LW ? HB[sx]! : topY) + 1
            const len = 18 + ((h2(k * 4 + st, seed + 5) * 26) | 0)
            for (let s = 0; s < len; s++) {
                const r = h2(k * 64 + st * 32 + s, seed + 6)
                if (s > 1) {
                    if (r < 0.22) sx += st === 0 ? -1 : 0
                    else if (r > 0.78) sx += st === 0 ? 0 : 1
                    else if (r > 0.5 && r < 0.56) sx += st === 0 ? -1 : 1
                }
                const wave = mod(tick - s, 14)
                const col = wave < 2 ? C.gold2 : s < len * 0.6 ? C.lava1 : C.lava0
                px(ctx, sx, sy + s, col)
                if (s < len * 0.45) px(ctx, sx + (st === 0 ? 1 : -1), sy + s, C.lava0)
            }
        }
    }
}

function cinder(ctx: Ctx, scroll: number, tq: number, tick: number): void {
    clouds(ctx, scroll * 0.03 + tq * 2.5, 104, 8, 30, 41, 0.6, C.brown1, C.brown0, C.red0)

    volcanoes(ctx, Math.round(scroll * 0.08), tick)

    // jagged basalt ridge rim-lit by lava
    const o2 = Math.round(scroll * 0.25)
    heights(1, o2, 46, 53, 114, 30, 0.07, false)
    paintRidge(ctx, GROUND, C.stone0, C.red0, 4, C.lava0)

    fog(ctx, 3, scroll * 0.3 + tq * 4, 98)

    // near spires and lava pools
    const o3 = Math.round(scroll * 0.55)
    const tp = 50
    for (let i = Math.floor((o3 - 20) / tp); i <= Math.floor((o3 + LW) / tp); i++) {
        if (h2(i, 150) > 0.35) continue
        const x = i * tp + ((h2(i, 151) * 30) | 0) - o3
        const w = 5 + ((h2(i, 152) * 6) | 0)
        const hot = mod(tick + i * 5, 16) < 8
        ellipse(ctx, x, GROUND - 1, w + 1, 1, C.lava0)
        rect(ctx, x - w + 2, GROUND - 1, w * 2 - 3, 1, hot ? C.lava1 : C.orange)
        px(ctx, x - 2, GROUND - 1, C.gold2)
    }
    const ts = 72
    for (let i = Math.floor((o3 - 20) / ts); i <= Math.floor((o3 + LW) / ts); i++) {
        if (h2(i, 153) > 0.6) continue
        const x = i * ts + ((h2(i, 154) * 50) | 0) - o3
        const w = 8 + ((h2(i, 155) * 7) | 0)
        const h = 16 + ((h2(i, 156) * 26) | 0)
        const lean = h2(i, 157) < 0.5 ? -1 : 1
        const top = GROUND - h
        for (let y = top; y < GROUND; y += 2) {
            const f = (y - top) / h
            const rw = Math.max(1, Math.round(w * Math.sqrt(f)))
            const cx = x + Math.round((1 - f) * lean * 3)
            rect(ctx, cx - (rw >> 1), y, rw, 2, C.ink)
            rect(ctx, cx - (rw >> 1), y, 1, 2, C.red0)
        }
        px(ctx, x + lean * 3, top, C.red1)
    }

    embers(ctx, 14, 160, scroll, 0.4, tq, tick, 40, GROUND)
    cinderFloor(ctx, scroll, tq)
}

function embers(ctx: Ctx, n: number, seed: number, scroll: number, f: number, tq: number, tick: number, yTop: number, yBot: number): void {
    const span = yBot - yTop
    const w = LW + 20
    for (let i = 0; i < n; i++) {
        const s = seed + i * 5
        if (mod(tick + i * 3, 9) === 0) continue
        const sp = 6 + h2(s, 1) * 12
        const rise = mod(h2(s, 2) * span + tq * sp, span)
        const y = yBot - Math.round(rise)
        const x = Math.round(mod(h2(s, 3) * w - scroll * f + Math.sin(tq * 2 + i) * 3 - tq * 4, w)) - 10
        const life = rise / span
        px(ctx, x, y, life < 0.25 ? C.gold3 : life < 0.5 ? C.gold2 : life < 0.8 ? C.orange : C.lava0)
    }
}

function cinderFloor(ctx: Ctx, scroll: number, tq: number): void {
    const ox = Math.round(scroll)
    rect(ctx, 0, GROUND, LW, 1, C.stone3)
    rect(ctx, 0, GROUND + 1, LW, 6, C.stone1)
    rect(ctx, 0, GROUND + 7, LW, 9, C.stone0)
    rect(ctx, 0, GROUND + 16, LW, 10, C.ink)

    // basalt column joints
    const tj = 12
    for (let i = Math.floor((ox - 12) / tj); i <= Math.floor((ox + LW) / tj); i++) {
        const x = i * tj + ((h2(i, 170) * 4) | 0) - ox
        rect(ctx, x, GROUND + 1, 1, 25, C.ink)
        rect(ctx, x + 1, GROUND + 1, 1, 6, C.stone2)
        const hy = GROUND + 6 + ((h2(i, 171) * 3) | 0) * 4
        rect(ctx, x + 1, hy, 11, 1, C.ink)
        if (h2(i, 172) < 0.4) px(ctx, x + 3 + ((h2(i, 173) * 6) | 0), GROUND + 2, C.stone2)
    }

    // pulsing lava cracks
    const tc = 29
    for (let i = Math.floor((ox - 10) / tc); i <= Math.floor((ox + LW + 10) / tc); i++) {
        if (h2(i, 174) > 0.45) continue
        let sx = i * tc + ((h2(i, 175) * 20) | 0) - ox
        const len = 10 + ((h2(i, 176) * 14) | 0)
        const pulse = Math.sin(tq * 2.5 + h2(i, 177) * 6.28)
        const core = pulse > 0.6 ? C.gold2 : pulse > -0.2 ? C.lava1 : C.lava0
        const edge = pulse > -0.2 ? C.lava0 : C.red0
        px(ctx, sx, GROUND, C.orange)
        for (let s = 0; s < len; s++) {
            const r = h2(i * 32 + s, 178)
            if (r < 0.3) sx--
            else if (r > 0.7) sx++
            const y = GROUND + 1 + s
            px(ctx, sx, y, s < len - 3 ? core : edge)
            if ((s & 3) === 1) px(ctx, sx + (r < 0.5 ? -1 : 1), y, edge)
        }
    }
}

// ------------------------------------------------------------------ public

export function drawScenery(ctx: CanvasRenderingContext2D, zone: number, scroll: number, t: number): void {
    const z = mod(zone | 0, 4)
    const tick = Math.floor(t * 10)
    const tq = tick / 10
    ctx.drawImage(sky(z), 0, 0)
    if (z === 0) meadow(ctx, scroll, tq, tick)
    else if (z === 1) forest(ctx, scroll, tq, tick)
    else if (z === 2) crypt(ctx, scroll, tq, tick)
    else cinder(ctx, scroll, tq, tick)
}

const TUFT: readonly (readonly string[])[] = [
    [C.green0, C.green1, C.green3],
    [C.ink, C.green0, C.green2],
    [C.void, C.night1, C.bone0],
    [C.ink, C.stone0, C.red1]
]

function tufts(ctx: Ctx, z: number, scroll: number): void {
    const ox = Math.round(scroll * 1.3)
    const tw = 18
    const cols = TUFT[z]!
    const dark = cols[0]!
    const mid = cols[1]!
    const tip = cols[2]!
    for (let i = Math.floor((ox - tw) / tw); i <= Math.floor((ox + LW) / tw); i++) {
        if (h2(i, 900 + z) > 0.55) continue
        const x = i * tw + ((h2(i, 901) * 10) | 0) - ox
        if (z === 3) {
            const w = 4 + ((h2(i, 902) * 5) | 0)
            rect(ctx, x, LH - 3, w, 3, dark)
            rect(ctx, x + 1, LH - 4, w - 2, 1, mid)
            px(ctx, x + 1, LH - 4, tip)
            continue
        }
        const n = 3 + ((h2(i, 902) * 3) | 0)
        for (let b = 0; b < n; b++) {
            const hgt = 3 + ((h2(i * 8 + b, 903) * 6) | 0)
            const bx = x + b * 2 - (b & 1)
            const lean = b < n >> 1 ? -1 : 1
            rect(ctx, bx, LH - hgt, 1, hgt, (b & 1) === 0 ? dark : mid)
            px(ctx, bx + lean, LH - hgt - 1, tip)
        }
    }
}

export function drawForeground(ctx: CanvasRenderingContext2D, zone: number, scroll: number, t: number): void {
    const z = mod(zone | 0, 4)
    const tick = Math.floor(t * 10)
    const tq = tick / 10
    const w = LW + 20
    tufts(ctx, z, scroll)
    if (z === 0) {
        // petals on the breeze and drifting pollen
        for (let i = 0; i < 7; i++) {
            const s = 1000 + i * 5
            const x = Math.round(mod(h2(s, 1) * w - tq * (10 + h2(s, 2) * 8) - scroll * 1.1, w)) - 10
            const y = Math.round(mod(h2(s, 3) * LH + tq * (5 + h2(s, 4) * 5), LH) + Math.sin(tq * 2 + i) * 3)
            const c = (i & 1) === 0 ? C.pink : C.white
            px(ctx, x, y, c)
            if (((tick + i) & 3) < 2) px(ctx, x + 1, y, c)
        }
        for (let i = 0; i < 6; i++) {
            const s = 1100 + i * 5
            if (mod(tick + i * 7, 30) > 20) continue
            const x = Math.round(mod(h2(s, 1) * w - scroll * 0.9 + Math.sin(tq * 0.7 + i) * 8, w)) - 10
            const y = Math.round(60 + h2(s, 2) * 50 + Math.sin(tq * 0.9 + i * 2) * 4)
            px(ctx, x, y, C.gold3)
        }
    } else if (z === 1) {
        // falling leaves and a few near fireflies
        for (let i = 0; i < 5; i++) {
            const s = 1200 + i * 5
            const x = Math.round(mod(h2(s, 1) * w - scroll * 1.1 + Math.sin(tq * 1.5 + i) * 6 - tq * 3, w)) - 10
            const y = Math.round(mod(h2(s, 2) * LH + tq * (9 + h2(s, 3) * 6), LH))
            const c = (i & 1) === 0 ? C.green2 : C.brown2
            if (((tick + i * 2) >> 1 & 1) === 0) rect(ctx, x, y, 2, 1, c)
            else rect(ctx, x, y, 1, 2, c)
        }
        fireflies(ctx, 4, 1300, scroll, 0.9, tq, tick, 70, 44, false)
    } else if (z === 2) {
        // ghostly wisps drifting low
        for (let i = 0; i < 7; i++) {
            const s = 1400 + i * 5
            const x = Math.round(mod(h2(s, 1) * w - scroll * 1.05 - tq * (3 + h2(s, 2) * 4), w)) - 10
            const y = Math.round(84 + h2(s, 3) * 36 + Math.sin(tq * 0.8 + i * 1.7) * 3)
            const ph = mod(tick + i * 11, 40)
            if (ph > 30) continue
            px(ctx, x, y, ph < 4 || ph > 26 ? C.night2 : C.night3)
            if (ph >= 8 && ph <= 22) px(ctx, x + 1, y, C.night2)
        }
    } else {
        embers(ctx, 10, 1500, scroll, 1.2, tq, tick, 20, LH)
        // falling ash
        for (let i = 0; i < 8; i++) {
            const s = 1600 + i * 5
            const x = Math.round(mod(h2(s, 1) * w - scroll * 1.1 + Math.sin(tq * 1.2 + i) * 4 - tq * 5, w)) - 10
            const y = Math.round(mod(h2(s, 2) * LH + tq * (4 + h2(s, 3) * 4), LH))
            px(ctx, x, y, (i & 1) === 0 ? C.stone2 : C.stone3)
        }
    }
}
