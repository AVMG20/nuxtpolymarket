// Shading for the raid bosses, which are big enough that flat fills read as cardboard.
//
// A part is drawn as a shape into a scratch mask, then lit as a volume from the upper left: each
// pixel's tone comes from how far it sits from the lit edge against the shadowed one, stepped down
// a material's ramp in flat bands with a narrow dithered seam between them. The lit edge takes a highlight and the
// shadowed edge a reflected rim, so a part stands off whatever it is drawn over. Detail (seams,
// rivets, grain, glints) goes on top by hand.

import { Surface, bayer, rowSpan, ROWS } from './surface'

const MASKS = new Map<string, Surface>()

/**
 * The rows of `m` holding anything, into BOX (and its columns, if `cols`); false when it is empty.
 * A raid boss's parts are each drawn into a mask the size of its whole buffer, so shading one by
 * scanning every pixel cost 90% of a bake; skipping to the rows in use leaves the output the same.
 */
export const BOX = { x0: 0, y0: 0, x1: -1, y1: -1 }
export function bounds(m: Surface, cols = false): boolean {
    const d = m.data
    const w = m.w
    if (!rowSpan(m)) { BOX.x0 = 0; BOX.x1 = -1; BOX.y0 = 0; BOX.y1 = -1; return false }
    BOX.y0 = ROWS.y0
    BOX.y1 = ROWS.y1
    BOX.x0 = 0
    BOX.x1 = w - 1
    if (cols) {
        let x0 = w
        let x1 = -1
        for (let y = BOX.y0; y <= BOX.y1; y++) {
            const row = y * w
            for (let x = 0; x < x0; x++) if (d[row + x]) { x0 = x; break }
            for (let x = w - 1; x > x1; x--) if (d[row + x]) { x1 = x; break }
        }
        BOX.x0 = x0
        BOX.x1 = x1
    }
    return true
}

/** A cleared scratch mask the size of `like`, one per key so a part can be masked inside another. */
export function mask(like: Surface, key = 'm'): Surface {
    let m = MASKS.get(key)
    if (!m || m.w !== like.w || m.h !== like.h) { m = new Surface(like.w, like.h, like.ax, like.ay); MASKS.set(key, m) }
    m.data.fill(0)
    m.ax = like.ax
    m.ay = like.ay
    return m
}

/**
 * A material: its tones dark → light, the highlight along its lit edge and the reflected light along
 * its shadowed one (−1 for none).
 */
export interface Mat5 { ramp: readonly number[], hi: number, rim: number }

/**
 * Light what is drawn into `m` (any non-zero pixel) as a volume from the upper left, onto `s`.
 * `reach` caps how far the edges are measured, so a wide part keeps a broad lit face; `bias` shifts
 * the whole part lighter (+) or darker (−).
 */
export function vol(s: Surface, m: Surface, mat: Mat5, reach = 12, bias = 0): void {
    const w = m.w
    const h = m.h
    const d = m.data
    const n = mat.ramp.length
    if (!bounds(m)) return
    const y1 = BOX.y1
    for (let y = BOX.y0; y <= y1; y++) {
        for (let x = 0; x < w; x++) {
            if (!d[y * w + x]) continue
            let dl = 1
            while (dl < reach && x - dl >= 0 && y - dl >= 0 && d[(y - dl) * w + x - dl]) dl++
            let ds = 1
            while (ds < reach && x + ds < w && y + ds < h && d[(y + ds) * w + x + ds]) ds++
            let c: number
            if (dl === 1 && mat.hi >= 0) c = mat.hi
            else if (ds === 1 && mat.rim >= 0) c = mat.rim
            else {
                // flat bands of tone, dithered only in a narrow seam between two: dither across a
                // whole gradient reads as grain at this size
                const L = Math.min(1, Math.max(0, ds / (dl + ds) + bias))
                const v = L * (n - 1)
                const b = Math.floor(v)
                const f = v - b
                const up = f > 0.62 || (f > 0.38 && bayer(x, y, 8))
                c = mat.ramp[Math.min(n - 1, b + (up ? 1 : 0))]!
            }
            s.data[y * w + x] = c
        }
    }
}

/**
 * Run `fn` over every pixel of `m`, with whether it lies on the part's edge (a 4-neighbour outside)
 * and which side that edge faces: for seams, rims and sel-out outlines drawn after `vol`.
 */
export function eachPx(m: Surface, fn: (x: number, y: number, edge: boolean, below: boolean) => void): void {
    const w = m.w
    const d = m.data
    if (!bounds(m)) return
    const y1 = Math.min(m.h - 2, BOX.y1)
    for (let y = Math.max(1, BOX.y0); y <= y1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x
            if (!d[i]) continue
            const below = !d[i + w] || !d[i + 1]
            const edge = below || !d[i - w] || !d[i - 1]
            fn(x, y, edge, below)
        }
    }
}

/**
 * A sel-out line round a part drawn over another: its shadowed edges (below and right) in `dark`,
 * so it separates from what is behind it without a hard ink line on its lit side.
 */
export function selOut(s: Surface, m: Surface, dark: number): void {
    eachPx(m, (x, y, _edge, below) => { if (below) s.set(x, y, dark) })
}

/** Rotate (x, y) about (px, py) by `a`, into T. */
export const T = { x: 0, y: 0 }
export function rot(x: number, y: number, px: number, py: number, a: number): void {
    const c = Math.cos(a)
    const sn = Math.sin(a)
    T.x = px + (x - px) * c - (y - py) * sn
    T.y = py + (x - px) * sn + (y - py) * c
}
