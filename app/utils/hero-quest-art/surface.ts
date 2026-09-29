// Indexed pixel surfaces and the primitives every Hero Quest sprite is built from.
//
// A Surface is a width × height grid of palette indices (0 = transparent). All drawing is
// integer spans written straight into that grid, so there is no anti-aliasing, no alpha and
// no colour that isn't in the palette. Nothing here touches the DOM: the same code renders
// in the browser (via canvas.ts) and in bun (via the PNG exporter).
//
// Coordinates may be fractional — every primitive rounds to the grid itself, which is what
// lets animation ease parameters smoothly and still land on whole pixels.

import { C, CLEAR } from './palette'

const R = Math.round

export class Surface {
    readonly w: number
    readonly h: number
    readonly data: Uint8Array
    /** Feet anchor for sprites. Scenes leave it at 0,0. */
    ax: number
    ay: number

    constructor(w: number, h: number, ax = w >> 1, ay = h - 6) {
        this.w = w
        this.h = h
        this.data = new Uint8Array(w * h)
        this.ax = ax
        this.ay = ay
    }

    clear(c = CLEAR): void {
        this.data.fill(c)
    }

    get(x: number, y: number): number {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return CLEAR
        return this.data[y * this.w + x]!
    }

    set(x: number, y: number, c: number): void {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
        this.data[y * this.w + x] = c
    }

    /** True when every pixel is transparent — used by specs to catch an empty drawer. */
    isEmpty(): boolean {
        for (let i = 0; i < this.data.length; i++) if (this.data[i] !== CLEAR) return false
        return true
    }

    copyFrom(src: Surface): void {
        this.data.set(src.data)
    }
}

// ── Primitives ─────────────────────────────────────────────────────────────────────

export function rect(s: Surface, x: number, y: number, w: number, h: number, c: number): void {
    let x0 = R(x)
    let y0 = R(y)
    let x1 = x0 + R(w)
    let y1 = y0 + R(h)
    if (x0 < 0) x0 = 0
    if (y0 < 0) y0 = 0
    if (x1 > s.w) x1 = s.w
    if (y1 > s.h) y1 = s.h
    if (x1 <= x0 || y1 <= y0) return
    const d = s.data
    for (let yy = y0; yy < y1; yy++) d.fill(c, yy * s.w + x0, yy * s.w + x1)
}

export function px(s: Surface, x: number, y: number, c: number): void {
    s.set(R(x), R(y), c)
}

/** Bresenham line. `t` > 1 stamps a t×t square per step (a thick limb). */
export function line(s: Surface, x0: number, y0: number, x1: number, y1: number, c: number, t = 1): void {
    x0 = R(x0); y0 = R(y0); x1 = R(x1); y1 = R(y1)
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    const o = t > 1 ? (t >> 1) : 0
    let err = dx + dy
    for (;;) {
        if (t > 1) rect(s, x0 - o, y0 - o, t, t, c)
        else s.set(x0, y0, c)
        if (x0 === x1 && y0 === y1) break
        const e2 = 2 * err
        if (e2 >= dy) { err += dy; x0 += sx }
        if (e2 <= dx) { err += dx; y0 += sy }
    }
}

/** A line along an angle from (x, y), `len` long. */
export function ray(s: Surface, x: number, y: number, a: number, len: number, c: number, t = 1): void {
    line(s, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, c, t)
}

export function disc(s: Surface, cx: number, cy: number, r: number, c: number): void {
    cx = R(cx); cy = R(cy)
    if (r < 1) { s.set(cx, cy, c); return }
    const rr = r * r + r * 0.8
    const ri = Math.floor(r)
    for (let dy = -ri; dy <= ri; dy++) {
        const half = Math.floor(Math.sqrt(Math.max(0, rr - dy * dy)))
        rect(s, cx - half, cy + dy, half * 2 + 1, 1, c)
    }
}

export function ellipse(s: Surface, cx: number, cy: number, rx: number, ry: number, c: number): void {
    cx = R(cx); cy = R(cy)
    const iry = Math.max(1, Math.floor(ry))
    for (let dy = -iry; dy <= iry; dy++) {
        const k = 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5))
        const half = Math.floor(rx * Math.sqrt(Math.max(0, k)) + 0.35)
        rect(s, cx - half, cy + dy, half * 2 + 1, 1, c)
    }
}

/** 1px circle outline (midpoint). */
export function ring(s: Surface, cx: number, cy: number, r: number, c: number): void {
    cx = R(cx); cy = R(cy); r = R(r)
    if (r <= 0) { s.set(cx, cy, c); return }
    let x = r
    let y = 0
    let err = 1 - r
    while (x >= y) {
        s.set(cx + x, cy + y, c); s.set(cx - x, cy + y, c)
        s.set(cx + x, cy - y, c); s.set(cx - x, cy - y, c)
        s.set(cx + y, cy + x, c); s.set(cx - y, cy + x, c)
        s.set(cx + y, cy - x, c); s.set(cx - y, cy - x, c)
        y++
        if (err < 0) err += 2 * y + 1
        else { x--; err += 2 * (y - x) + 1 }
    }
}

/** Elliptical 1px ring — ground shockwaves seen at a slant. */
export function ellipseRing(s: Surface, cx: number, cy: number, rx: number, ry: number, c: number): void {
    const n = Math.max(12, R((rx + ry) * 3))
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        s.set(R(cx + Math.cos(a) * rx), R(cy + Math.sin(a) * ry), c)
    }
}

/** 1px arc, angles in radians (a0 < a1). */
export function arc(s: Surface, cx: number, cy: number, r: number, a0: number, a1: number, c: number): void {
    const step = 0.8 / Math.max(1, r)
    for (let a = a0; a <= a1; a += step) s.set(R(cx + Math.cos(a) * r), R(cy + Math.sin(a) * r), c)
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

export function tri(s: Surface, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number): void {
    x0 = R(x0); y0 = R(y0); x1 = R(x1); y1 = R(y1); x2 = R(x2); y2 = R(y2)
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
            rect(s, a, y, R(tHi) - a + 1, 1, c)
        }
    }
}

export function quad(s: Surface, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: number): void {
    tri(s, x0, y0, x1, y1, x2, y2, c)
    tri(s, x0, y0, x2, y2, x3, y3, c)
}

/** A limb segment that tapers from width w0 to w1. */
export function taper(s: Surface, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, c: number): void {
    const dx = x1 - x0
    const dy = y1 - y0
    const L = Math.hypot(dx, dy) || 1
    const nx = -dy / L
    const ny = dx / L
    quad(s, x0 + nx * w0 / 2, y0 + ny * w0 / 2, x1 + nx * w1 / 2, y1 + ny * w1 / 2,
        x1 - nx * w1 / 2, y1 - ny * w1 / 2, x0 - nx * w0 / 2, y0 - ny * w0 / 2, c)
}

/** Upper half of an ellipse standing on row `by`, optionally sheared by `sk` px at the top. */
export function dome(s: Surface, cx: number, by: number, rx: number, h: number, c: number, sk = 0): void {
    const hh = Math.max(1, h)
    for (let j = 0; j <= hh; j++) {
        const k = j / (hh + 0.5)
        const half = Math.floor(rx * Math.sqrt(1 - k * k) + 0.35)
        const off = R(sk * j / hh)
        rect(s, R(cx - half + off), R(by - j), half * 2 + 1, 1, c)
    }
}

const BAYER4 = Uint8Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5])

/** True if cell (x, y) is painted at dither `level` of 16. */
export function bayer(x: number, y: number, level: number): boolean {
    return BAYER4[((y & 3) << 2) | (x & 3)]! < level
}

/** Ordered-dither fill, `level` 0..16 of the cells painted. Used instead of alpha. */
export function dither(s: Surface, x: number, y: number, w: number, h: number, c: number, level: number): void {
    if (level <= 0) return
    if (level >= 16) { rect(s, x, y, w, h, c); return }
    const x0 = R(x)
    const y0 = R(y)
    const x1 = x0 + R(w)
    const y1 = y0 + R(h)
    for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) if (bayer(xx, yy, level)) s.set(xx, yy, c)
    }
}

export function ditherDisc(s: Surface, cx: number, cy: number, r: number, c: number, level: number): void {
    cx = R(cx); cy = R(cy)
    const rr = r * r + r * 0.8
    const ri = Math.floor(r)
    for (let dy = -ri; dy <= ri; dy++) {
        const half = Math.floor(Math.sqrt(Math.max(0, rr - dy * dy)))
        dither(s, cx - half, cy + dy, half * 2 + 1, 1, c, level)
    }
}

export function ditherEllipse(s: Surface, cx: number, cy: number, rx: number, ry: number, c: number, level: number): void {
    cx = R(cx); cy = R(cy)
    const iry = Math.max(1, Math.floor(ry))
    for (let dy = -iry; dy <= iry; dy++) {
        const k = 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5))
        const half = Math.floor(rx * Math.sqrt(Math.max(0, k)) + 0.35)
        dither(s, cx - half, cy + dy, half * 2 + 1, 1, c, level)
    }
}

const PX = new Float64Array(64)
const PY = new Float64Array(64)

/** Filled polygon from flat [x0, y0, x1, y1, …] offsets around (ox, oy); `sx` mirrors. */
export function poly(s: Surface, pts: ArrayLike<number>, ox: number, oy: number, c: number, sx = 1): void {
    const n = Math.min(64, pts.length >> 1)
    let top = 1e9
    let bot = -1e9
    for (let i = 0; i < n; i++) {
        PX[i] = R(ox + pts[i * 2]! * sx)
        PY[i] = R(oy + pts[i * 2 + 1]!)
        if (PY[i]! < top) top = PY[i]!
        if (PY[i]! > bot) bot = PY[i]!
    }
    for (let y = top; y <= bot; y++) {
        tLo = 1e9
        tHi = -1e9
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n
            edge(PX[i]!, PY[i]!, PX[j]!, PY[j]!, y)
        }
        if (tHi >= tLo) {
            const a = R(tLo)
            rect(s, a, y, R(tHi) - a + 1, 1, c)
        }
    }
}

// ── Hashing (layout, not outcomes) ─────────────────────────────────────────────────
//
// Art is deterministic: scenery layout, particle spread and dissolve order come from a hash
// of an index, so an exported spritesheet is byte-identical run to run. None of this decides
// anything in the game.

export function hash(n: number): number {
    let h = Math.imul(n | 0, 374761393)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h = h ^ (h >>> 16)
    return (h >>> 0) / 4294967296
}

export function hash2(a: number, b: number): number {
    return hash((Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39)) & 0x7fffffff)
}

// ── Sprite stamping ────────────────────────────────────────────────────────────────

/**
 * How a sprite buffer lands on a scene. One mutable instance is reused by each caller so
 * stamping never allocates; `reset()` restores the defaults.
 */
export class StampStyle {
    /** Generated 1px outline colour, or CLEAR for none. */
    outline = C.ink
    /** Second, outer outline — the elite mark uses it. CLEAR for none. */
    halo = CLEAR
    /** Paint the whole sprite this colour (hit flash). CLEAR for off. */
    flash = CLEAR
    /** Light colour painted on edges facing (rimDx, rimDy). CLEAR for off. */
    rim = CLEAR
    rimDx = 1
    rimDy = 0
    /** Mirror horizontally around the anchor (enemies face left). */
    flip = false
    /** Palette remap applied to every pixel (recolors). null for none. */
    lut: Uint8Array | null = null
    /** Dissolve 0..16: that many of 16 Bayer cells are erased (death fades). */
    dissolve = 0
    /** Draw as a checker-dithered silhouette of this colour (afterimages). CLEAR for off. */
    ghost = CLEAR

    reset(): this {
        this.outline = C.ink
        this.halo = CLEAR
        this.flash = CLEAR
        this.rim = CLEAR
        this.rimDx = 1
        this.rimDy = 0
        this.flip = false
        this.lut = null
        this.dissolve = 0
        this.ghost = CLEAR
        return this
    }
}

/**
 * The first and last rows of `s` holding anything, into ROWS; false when it is empty. Found a word at
 * a time (a word straddling two rows only widens the span), so skipping the empty rows of a big,
 * mostly empty buffer costs a fraction of scanning it.
 */
export const ROWS = { y0: 0, y1: -1 }
const WORDS = new WeakMap<Uint8Array, Uint32Array>()
export function rowSpan(s: Surface): boolean {
    const d = s.data
    let q = WORDS.get(d)
    if (!q && !(d.byteOffset & 3)) { q = new Uint32Array(d.buffer, d.byteOffset, d.length >> 2); WORDS.set(d, q) }
    let first = -1
    let last = -1
    if (q) {
        const n = q.length
        for (let i = 0; i < n; i++) if (q[i]) { first = i << 2; break }
        for (let i = n - 1; i >= 0; i--) if (q[i]) { last = (i << 2) + 3; break }
        // the bytes past the last whole word
        for (let i = n << 2; i < d.length; i++) if (d[i]) { if (first < 0) first = i; last = i }
    } else {
        for (let i = 0; i < d.length; i++) if (d[i]) { if (first < 0) first = i; last = i }
    }
    if (first < 0) { ROWS.y0 = 0; ROWS.y1 = -1; return false }
    ROWS.y0 = Math.floor(first / s.w)
    ROWS.y1 = Math.min(s.h - 1, Math.floor(last / s.w))
    return true
}

function srcAt(src: Surface, x: number, y: number, flip: boolean): number {
    if (flip) x = 2 * src.ax - x
    if (x < 0 || y < 0 || x >= src.w || y >= src.h) return CLEAR
    return src.data[y * src.w + x]!
}

/**
 * Stamp `src` so its anchor lands on (x, y) of `dst`. Order: halo, outline, body (or flash
 * or ghost), rim — the same composite Pixel Crusade's SpriteBuffer does with canvas ops,
 * done here directly on indices.
 */
export function stamp(dst: Surface, src: Surface, x: number, y: number, st: StampStyle): void {
    const ox = R(x) - src.ax
    const oy = R(y) - src.ay
    const flip = st.flip
    const pad = st.halo !== CLEAR ? 2 : 1
    // only the rows the sprite is in, and its outline and halo round them
    if (!rowSpan(src)) return
    const x0 = Math.max(0, ox - pad)
    const y0 = Math.max(0, oy + ROWS.y0 - pad)
    const x1 = Math.min(dst.w, ox + src.w + pad)
    const y1 = Math.min(dst.h, oy + ROWS.y1 + 1 + pad)
    const dis = st.dissolve
    const d = dst.data
    for (let yy = y0; yy < y1; yy++) {
        const sy = yy - oy
        for (let xx = x0; xx < x1; xx++) {
            const sx = xx - ox
            let c = srcAt(src, sx, sy, flip)
            if (c !== CLEAR && dis > 0 && bayer(sx + 1, sy + 3, dis)) c = CLEAR
            const i = yy * dst.w + xx
            if (c === CLEAR) {
                if (dis >= 8) continue
                if (st.outline !== CLEAR || st.halo !== CLEAR) {
                    const n = (srcAt(src, sx - 1, sy, flip) !== CLEAR ? 1 : 0) | (srcAt(src, sx + 1, sy, flip) !== CLEAR ? 1 : 0)
                        | (srcAt(src, sx, sy - 1, flip) !== CLEAR ? 1 : 0) | (srcAt(src, sx, sy + 1, flip) !== CLEAR ? 1 : 0)
                    if (n && st.outline !== CLEAR && st.ghost === CLEAR) { d[i] = st.outline; continue }
                    if (st.halo !== CLEAR) {
                        const n2 = srcAt(src, sx - 2, sy, flip) !== CLEAR || srcAt(src, sx + 2, sy, flip) !== CLEAR
                            || srcAt(src, sx, sy - 2, flip) !== CLEAR || srcAt(src, sx, sy + 2, flip) !== CLEAR
                            || srcAt(src, sx - 1, sy - 1, flip) !== CLEAR || srcAt(src, sx + 1, sy + 1, flip) !== CLEAR
                            || srcAt(src, sx + 1, sy - 1, flip) !== CLEAR || srcAt(src, sx - 1, sy + 1, flip) !== CLEAR
                        if (n || n2) d[i] = st.halo
                    }
                }
                continue
            }
            if (st.ghost !== CLEAR) {
                if (((xx + yy) & 1) === 0) d[i] = st.ghost
                continue
            }
            if (st.flash !== CLEAR) { d[i] = st.flash; continue }
            if (st.lut) c = st.lut[c]!
            if (st.rim !== CLEAR) {
                const rdx = flip ? -st.rimDx : st.rimDx
                if (srcAt(src, sx + rdx, sy + st.rimDy, flip) === CLEAR) c = st.rim
            }
            d[i] = c
        }
    }
}

/** Plain copy of `src` onto `dst` at (x, y) (top-left), skipping transparent pixels. */
export function blit(dst: Surface, src: Surface, x: number, y: number, lut: Uint8Array | null = null): void {
    const ox = R(x)
    const oy = R(y)
    for (let sy = 0; sy < src.h; sy++) {
        const yy = oy + sy
        if (yy < 0 || yy >= dst.h) continue
        for (let sx = 0; sx < src.w; sx++) {
            const xx = ox + sx
            if (xx < 0 || xx >= dst.w) continue
            const c = src.data[sy * src.w + sx]!
            if (c !== CLEAR) dst.data[yy * dst.w + xx] = lut ? lut[c]! : c
        }
    }
}

/** Rotate `src` 90° about its anchor into `dst` (same size); dir 1 = clockwise. */
export function rotate90(src: Surface, dst: Surface, dir: 1 | -1): void {
    dst.clear()
    const ax = src.ax
    const ay = src.ay
    for (let y = 0; y < src.h; y++) {
        for (let x = 0; x < src.w; x++) {
            const c = src.data[y * src.w + x]!
            if (c === CLEAR) continue
            const dx = x - ax
            const dy = y - ay
            // clockwise: (dx, dy) → (-dy, dx); rest on the floor line
            const nx = dir === 1 ? ax - dy : ax + dy
            const ny = dir === 1 ? ay + dx : ay - dx
            dst.set(nx, ny, c)
        }
    }
}

/** Shift every pixel of `s` down by `n` rows in place (sinking into the ground). */
export function sink(s: Surface, n: number, floor: number): void {
    n = R(n)
    if (n <= 0) return
    for (let y = Math.min(s.h - 1, floor); y >= 0; y--) {
        for (let x = 0; x < s.w; x++) {
            const from = y - n
            s.data[y * s.w + x] = from >= 0 ? s.data[from * s.w + x]! : CLEAR
        }
    }
}

/** Identity palette map, for building recolors. */
export function identityLut(): Uint8Array {
    const lut = new Uint8Array(256)
    for (let i = 0; i < 256; i++) lut[i] = i
    return lut
}

/** A recolor that maps each entry of `from` onto the same position of `to`. */
export function rampLut(pairs: readonly (readonly [ArrayLike<number>, ArrayLike<number>])[]): Uint8Array {
    const lut = identityLut()
    for (const [from, to] of pairs) {
        for (let i = 0; i < from.length; i++) lut[from[i]!] = to[Math.min(to.length - 1, Math.round(i * (to.length - 1) / Math.max(1, from.length - 1)))]!
    }
    return lut
}
