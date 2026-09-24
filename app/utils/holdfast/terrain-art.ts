// Holdfast — the island diorama: a hand-painted ground texture, stratified
// rock cliffs around the map and a stylised sea. Cosmetic only (Math.random-free
// so the same seed always paints the same island).

import * as THREE from 'three'
import { MAP_SIZE } from '#shared/utils/holdfast/config'
import { Terrain, type Grid } from '#shared/utils/holdfast/grid'

/** Forest rim around the playable map, in tiles. */
export const ISLAND_MARGIN = 9
/** Ground texture resolution, in canvas pixels per tile. */
const PX = 32
/** Smooth painting fields are sampled this many times per tile, then interpolated. */
const FIELD = 8
const TILES = MAP_SIZE + ISLAND_MARGIN * 2
/** Height of the sea surface; the cliffs show everything above it. */
const SEA_LEVEL = -1.6
/** Distances up to this many tiles are stored in the shore texture. */
const SHORE_RANGE = 16

// ─── Noise ──────────────────────────────────────────────────────────────

function hash2(x: number, y: number, seed: number): number {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1). */
function noise(x: number, y: number, seed: number): number {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * (3 - 2 * xf)
    const v = yf * yf * (3 - 2 * yf)
    const a = hash2(xi, yi, seed)
    const b = hash2(xi + 1, yi, seed)
    const c = hash2(xi, yi + 1, seed)
    const d = hash2(xi + 1, yi + 1, seed)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function fbm(x: number, y: number, seed: number): number {
    return noise(x, y, seed) * 0.55 + noise(x * 2.1, y * 2.1, seed + 7) * 0.3 + noise(x * 4.3, y * 4.3, seed + 13) * 0.15
}

/** Deterministic stream for scattering strokes (mulberry32). */
function stream(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6D2B79F5) >>> 0
        let t = s
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const TAB = 512
const TAB_CELL = 8
/**
 * Tileable value noise baked into a table, for the per-pixel passes where a
 * full noise() call per pixel would be too slow. One unit = one noise cell.
 */
function noiseTable(seed: number): Float32Array {
    const cells = TAB / TAB_CELL
    const t = new Float32Array(TAB * TAB)
    for (let y = 0; y < TAB; y++) {
        for (let x = 0; x < TAB; x++) {
            const gx = x / TAB_CELL
            const gy = y / TAB_CELL
            const xi = Math.floor(gx)
            const yi = Math.floor(gy)
            const xf = gx - xi
            const yf = gy - yi
            const u = xf * xf * (3 - 2 * xf)
            const v = yf * yf * (3 - 2 * yf)
            const x1 = (xi + 1) % cells
            const y1 = (yi + 1) % cells
            const a = hash2(xi, yi, seed)
            const b = hash2(x1, yi, seed)
            const c = hash2(xi, y1, seed)
            const d = hash2(x1, y1, seed)
            t[y * TAB + x] = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
        }
    }
    return t
}

function tab(t: Float32Array, x: number, y: number): number {
    const fx = x * TAB_CELL
    const fy = y * TAB_CELL
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const i0 = x0 & (TAB - 1)
    const i1 = (x0 + 1) & (TAB - 1)
    const j0 = (y0 & (TAB - 1)) * TAB
    const j1 = ((y0 + 1) & (TAB - 1)) * TAB
    const a = t[j0 + i0]!
    const top = a + (t[j0 + i1]! - a) * tx
    const c = t[j1 + i0]!
    const bottom = c + (t[j1 + i1]! - c) * tx
    return top + (bottom - top) * ty
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
function smooth(e0: number, e1: number, x: number): number {
    const t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)
}

// ─── Field helpers ──────────────────────────────────────────────────────

/** Separable box blur, repeated for a soft, near-Gaussian falloff. */
function blur(src: Float32Array, w: number, h: number, r: number, passes: number): Float32Array {
    let a: Float32Array = src
    let b: Float32Array = new Float32Array(w * h)
    const span = r * 2 + 1
    for (let p = 0; p < passes; p++) {
        for (let y = 0; y < h; y++) {
            const row = y * w
            let acc = 0
            for (let k = -r; k <= r; k++) acc += a[row + Math.max(0, Math.min(w - 1, k))]!
            for (let x = 0; x < w; x++) {
                b[row + x] = acc / span
                acc += a[row + Math.min(w - 1, x + r + 1)]! - a[row + Math.max(0, x - r)]!
            }
        }
        ;[a, b] = [b, a]
        for (let x = 0; x < w; x++) {
            let acc = 0
            for (let k = -r; k <= r; k++) acc += a[Math.max(0, Math.min(h - 1, k)) * w + x]!
            for (let y = 0; y < h; y++) {
                b[y * w + x] = acc / span
                acc += a[Math.min(h - 1, y + r + 1) * w + x]! - a[Math.max(0, y - r) * w + x]!
            }
        }
        ;[a, b] = [b, a]
    }
    return a
}

const FAR = 1e20

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
    let k = 0
    v[0] = 0
    z[0] = -FAR
    z[1] = FAR
    for (let q = 1; q < n; q++) {
        let s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
        while (s <= z[k]! && k > 0) {
            k--
            s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
        }
        k++
        v[k] = q
        z[k] = s
        z[k + 1] = FAR
    }
    k = 0
    for (let q = 0; q < n; q++) {
        while (z[k + 1]! < q) k++
        const dq = q - v[k]!
        d[q] = dq * dq + f[v[k]!]!
    }
}

/** Exact Euclidean distance (in samples) from every cell to the nearest set cell. */
function edt(mask: Uint8Array, w: number, h: number): Float32Array {
    const grid = new Float64Array(w * h)
    for (let i = 0; i < w * h; i++) grid[i] = mask[i] ? 0 : FAR
    const n = Math.max(w, h)
    const f = new Float64Array(n)
    const d = new Float64Array(n)
    const v = new Int32Array(n)
    const z = new Float64Array(n + 1)
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = grid[y * w + x]!
        edt1d(f, h, d, v, z)
        for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = grid[y * w + x]!
        edt1d(f, w, d, v, z)
        for (let x = 0; x < w; x++) grid[y * w + x] = d[x]!
    }
    const out = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(grid[i]!)
    return out
}

/** Bilinear read of a field at the four samples starting at k. */
function bil(f: Float32Array, k: number, w: number, w00: number, w10: number, w01: number, w11: number): number {
    return f[k]! * w00 + f[k + 1]! * w10 + f[k + w]! * w01 + f[k + w + 1]! * w11
}

// ─── Ground painting ────────────────────────────────────────────────────

type RGB = readonly [number, number, number]

const GRASS_LUSH: RGB = [66, 94, 42]
const GRASS_MID: RGB = [100, 122, 56]
const GRASS_LIGHT: RGB = [128, 140, 76]
const GRASS_DRY: RGB = [146, 140, 92]
const GRASS_WORN: RGB = [138, 128, 82]
const FOREST_FLOOR: RGB = [54, 68, 36]
const MOSS: RGB = [74, 90, 44]
const EARTH: RGB = [116, 94, 66]
const STONY: RGB = [122, 116, 100]
const DIRT_EDGE: RGB = [116, 94, 68]
const DIRT_MID: RGB = [142, 118, 86]
const DIRT_DUST: RGB = [160, 138, 102]

/**
 * Paint the playable ground plus the forest rim into one canvas. The canvas
 * covers (MAP_SIZE + 2 * margin) tiles; world (0,0) sits at (margin, margin).
 */
export function paintGround(grid: Grid, seed: number): HTMLCanvasElement {
    const size = TILES * PX
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const n = grid.size
    const M = ISLAND_MARGIN

    // Smooth fields, sampled at FIELD per tile over the whole canvas.
    const fw = TILES * FIELD + 1
    const count = fw * fw
    const cellOf = (wx: number, wz: number): number => {
        const cx = Math.floor(wx)
        const cz = Math.floor(wz)
        if (cx < 0 || cz < 0 || cx >= n || cz >= n) return -1
        return grid.terrain[cz * n + cx]!
    }
    const roadMask = new Float32Array(count)
    const treeMask = new Float32Array(count)
    const rockMask = new Float32Array(count)
    for (let j = 0; j < fw; j++) {
        for (let i = 0; i < fw; i++) {
            const t = cellOf(i / FIELD - M, j / FIELD - M)
            const k = j * fw + i
            if (t === Terrain.Road) roadMask[k] = 1
            else if (t === Terrain.Tree) treeMask[k] = 1
            else if (t === Terrain.Rock) rockMask[k] = 1
        }
    }
    const road = blur(roadMask, fw, fw, 4, 2)
    const trees = blur(treeMask, fw, fw, 6, 2)
    const rocks = blur(rockMask, fw, fw, 5, 2)
    // Distances inside and outside a smoother road outline, in tiles: the
    // wheel ruts follow it, so they run straighter than the ragged edge.
    const roadSmooth = blur(roadMask, fw, fw, 6, 3)
    const inside = new Uint8Array(count)
    const outside = new Uint8Array(count)
    for (let k = 0; k < count; k++) {
        if (roadSmooth[k]! >= 0.5) inside[k] = 1
        else outside[k] = 1
    }
    const roadOut = edt(inside, fw, fw)
    const roadIn = edt(outside, fw, fw)
    for (let k = 0; k < count; k++) {
        roadOut[k] = roadOut[k]! / FIELD
        roadIn[k] = roadIn[k]! / FIELD
    }

    // Base grass colour: large soft tonal zones, dry patches, forest shade.
    const baseR = new Float32Array(count)
    const baseG = new Float32Array(count)
    const baseB = new Float32Array(count)
    const patch = new Float32Array(count)
    const edgeN = new Float32Array(count)
    for (let j = 0; j < fw; j++) {
        for (let i = 0; i < fw; i++) {
            const k = j * fw + i
            const wx = i / FIELD - M
            const wz = j / FIELD - M
            const big = fbm(wx * 0.045, wz * 0.045, seed + 1)
            const med = fbm(wx * 0.16, wz * 0.16, seed + 2)
            const t = clamp01((big - 0.28) * 1.7) * 0.6 + clamp01((med - 0.3) * 1.7) * 0.4
            let r: number
            let g: number
            let b: number
            if (t < 0.5) {
                const q = t * 2
                r = mix(GRASS_LUSH[0], GRASS_MID[0], q)
                g = mix(GRASS_LUSH[1], GRASS_MID[1], q)
                b = mix(GRASS_LUSH[2], GRASS_MID[2], q)
            } else {
                const q = (t - 0.5) * 2
                r = mix(GRASS_MID[0], GRASS_LIGHT[0], q)
                g = mix(GRASS_MID[1], GRASS_LIGHT[1], q)
                b = mix(GRASS_MID[2], GRASS_LIGHT[2], q)
            }
            const dry = smooth(0.56, 0.74, fbm(wx * 0.11 + 13.1, wz * 0.11, seed + 3)) * 0.5
            r = mix(r, GRASS_DRY[0], dry)
            g = mix(g, GRASS_DRY[1], dry)
            b = mix(b, GRASS_DRY[2], dry)
            // Forest floor: under tree clumps and across the rim outside the map.
            const edge = Math.max(-wx, -wz, wx - n, wz - n)
            const rim = smooth(-0.8, 2.6, edge)
            const shade = Math.min(1, trees[k]! * 1.15) * 0.72 + rim * 0.8 * (1 - trees[k]! * 0.5)
            const fr = mix(FOREST_FLOOR[0], MOSS[0], med)
            const fg = mix(FOREST_FLOOR[1], MOSS[1], med)
            const fb = mix(FOREST_FLOOR[2], MOSS[2], med)
            r = mix(r, fr, Math.min(1, shade))
            g = mix(g, fg, Math.min(1, shade))
            b = mix(b, fb, Math.min(1, shade))
            // Stony soil around boulders.
            const stone = Math.min(1, rocks[k]! * 1.3) * 0.5
            r = mix(r, STONY[0], stone)
            g = mix(g, STONY[1], stone)
            b = mix(b, STONY[2], stone)
            baseR[k] = r
            baseG[k] = g
            baseB[k] = b
            patch[k] = fbm(wx * 0.2 + 40.7, wz * 0.2, seed + 4) - shade * 0.35
            edgeN[k] = noise(wx * 1.4, wz * 1.4, seed + 6)
        }
    }

    // Per-pixel pass: interpolate the fields, add brushwork, grain, paths.
    const tA = noiseTable(seed + 101)
    const tB = noiseTable(seed + 202)
    const img = ctx.createImageData(size, size)
    const data = img.data
    const step = FIELD / PX
    const ca = Math.cos(0.55)
    const sa = Math.sin(0.55)
    const cb = Math.cos(-0.4)
    const sb = Math.sin(-0.4)
    for (let py = 0; py < size; py++) {
        const fy = (py + 0.5) * step
        const j0 = Math.min(fw - 2, Math.floor(fy))
        const ty = fy - j0
        const wz = (py + 0.5) / PX - M
        for (let px = 0; px < size; px++) {
            const fx = (px + 0.5) * step
            const i0 = Math.min(fw - 2, Math.floor(fx))
            const tx = fx - i0
            const k00 = j0 * fw + i0
            const w00 = (1 - tx) * (1 - ty)
            const w10 = tx * (1 - ty)
            const w01 = (1 - tx) * ty
            const w11 = tx * ty
            const wx = (px + 0.5) / PX - M

            let r = bil(baseR, k00, fw, w00, w10, w01, w11)
            let g = bil(baseG, k00, fw, w00, w10, w01, w11)
            let b = bil(baseB, k00, fw, w00, w10, w01, w11)

            // Brush streaks: two elongated noise layers at crossing angles.
            const u1 = wx * ca + wz * sa
            const v1 = -wx * sa + wz * ca
            const u2 = wx * cb + wz * sb
            const v2 = -wx * sb + wz * cb
            const streak = (tab(tA, u1 * 1.1, v1 * 4.2) + tab(tB, u2 * 1.5, v2 * 5.5)) * 0.5 - 0.5
            const fine = tab(tA, wx * 3.1 + 17.3, wz * 3.1) - 0.5
            const grain = ((Math.imul(px ^ Math.imul(py, 0x27d4eb2d), 0x165667b1) >>> 20) & 255) / 255 - 0.5
            const lum = 1 + streak * 0.2 + fine * 0.1 + grain * 0.05
            r = r * lum + streak * 8
            g = g * lum + streak * 4
            b = b * lum - streak * 2

            // Bare earth patches with ragged, broken edges.
            const pv = bil(patch, k00, fw, w00, w10, w01, w11) + fine * 0.09 + streak * 0.05
            const bare = smooth(0.7, 0.77, pv) * 0.75
            if (bare > 0) {
                const e = 1 + (tab(tB, wx * 1.9, wz * 1.9) - 0.5) * 0.25 + grain * 0.08
                r = mix(r, EARTH[0] * e, bare)
                g = mix(g, EARTH[1] * e, bare)
                b = mix(b, EARTH[2] * e, bare)
            }

            // Packed-dirt roads: ragged grassy edges, lighter worn middle, wheel ruts.
            const rv = bil(road, k00, fw, w00, w10, w01, w11)
            if (rv > 0.05) {
                const dOut = bil(roadOut, k00, fw, w00, w10, w01, w11)
                const dIn = bil(roadIn, k00, fw, w00, w10, w01, w11)
                const e = rv + (bil(edgeN, k00, fw, w00, w10, w01, w11) - 0.5) * 0.34 + fine * 0.22 - 0.5
                const k = smooth(-0.05, 0.05, e)
                if (e < 0.25) {
                    // Trampled, yellowed grass along the verge and a dark soil line.
                    const wear = smooth(1.1, 0, dOut) * 0.4
                    r = mix(r, GRASS_WORN[0], wear)
                    g = mix(g, GRASS_WORN[1], wear)
                    b = mix(b, GRASS_WORN[2], wear)
                    const line = 1 - smooth(0.0, 0.12, Math.abs(e + 0.03))
                    r *= 1 - line * 0.07
                    g *= 1 - line * 0.07
                    b *= 1 - line * 0.07
                }
                if (k > 0) {
                    const centre = smooth(0.0, 0.8, dIn)
                    const dust = tab(tB, wx * 0.8 + 3.3, wz * 0.8) - 0.5
                    let dr = mix(DIRT_EDGE[0], DIRT_MID[0], centre) + dust * 22
                    let dg = mix(DIRT_EDGE[1], DIRT_MID[1], centre) + dust * 19
                    let db = mix(DIRT_EDGE[2], DIRT_MID[2], centre) + dust * 14
                    const dusty = smooth(0.1, 0.35, dust) * centre * 0.5
                    dr = mix(dr, DIRT_DUST[0], dusty)
                    dg = mix(dg, DIRT_DUST[1], dusty)
                    db = mix(db, DIRT_DUST[2], dusty)
                    // Two wheel ruts a set distance inside each edge.
                    const rd = Math.abs(dIn - 0.62 - fine * 0.06)
                    const gaps = smooth(0.28, 0.5, tab(tA, wx * 0.45 + 9.1, wz * 0.45))
                    const rut = (1 - smooth(0.03, 0.09, rd)) * (0.35 + 0.65 * gaps)
                    const ridge = (smooth(0.08, 0.12, rd) - smooth(0.13, 0.2, rd)) * gaps
                    const rl = 1 - rut * 0.15 + ridge * 0.05 + grain * 0.07 + fine * 0.08
                    dr *= rl
                    dg *= rl
                    db *= rl
                    r = mix(r, dr, k)
                    g = mix(g, dg, k)
                    b = mix(b, db, k)
                }
            }

            const o = (py * size + px) * 4
            data[o] = r
            data[o + 1] = g
            data[o + 2] = b
            data[o + 3] = 255
        }
    }
    ctx.putImageData(img, 0, 0)

    // Brushwork overlays, batched into a handful of translucent paths.
    const rand = stream(seed ^ 0x51f15e)
    const sampleAt = (f: Float32Array, wx: number, wz: number): number => {
        const fx = Math.max(0, Math.min(fw - 1.001, (wx + M) * FIELD))
        const fy = Math.max(0, Math.min(fw - 1.001, (wz + M) * FIELD))
        const i = Math.floor(fx)
        const j = Math.floor(fy)
        const tx = fx - i
        const ty = fy - j
        const k = j * fw + i
        return mix(mix(f[k]!, f[k + 1]!, tx), mix(f[k + fw]!, f[k + fw + 1]!, tx), ty)
    }
    const toPx = (w: number): number => (w + M) * PX
    ctx.lineCap = 'round'

    // Grass tufts: little fans of blades, dark and sunlit.
    const dark = new Path2D()
    const light = new Path2D()
    const tufts = TILES * TILES * 5
    for (let i = 0; i < tufts; i++) {
        const wx = rand() * TILES - M
        const wz = rand() * TILES - M
        const rv = sampleAt(road, wx, wz)
        if (rv > 0.42 && rand() < 0.9) continue
        const x = toPx(wx)
        const y = toPx(wz)
        const blades = 2 + Math.floor(rand() * 3)
        const lean = (rand() - 0.5) * 0.8
        const target = rand() < 0.62 ? dark : light
        for (let k = 0; k < blades; k++) {
            const a = -Math.PI / 2 + lean + (k - (blades - 1) / 2) * 0.35 + (rand() - 0.5) * 0.3
            const len = 3 + rand() * 5
            const bx = x + (rand() - 0.5) * 3
            target.moveTo(bx, y)
            target.quadraticCurveTo(bx + Math.cos(a) * len * 0.5 + lean * 2, y + Math.sin(a) * len * 0.5, bx + Math.cos(a) * len, y + Math.sin(a) * len)
        }
    }
    ctx.lineWidth = 1.3
    ctx.strokeStyle = 'rgba(28, 42, 14, 0.2)'
    ctx.stroke(dark)
    ctx.lineWidth = 1.1
    ctx.strokeStyle = 'rgba(214, 222, 150, 0.14)'
    ctx.stroke(light)

    // Leaf and needle litter on the forest floor.
    const litterDark = new Path2D()
    const litterWarm = new Path2D()
    for (let i = 0; i < TILES * TILES * 3; i++) {
        const wx = rand() * TILES - M
        const wz = rand() * TILES - M
        const edge = Math.max(-wx, -wz, wx - n, wz - n)
        const shade = Math.min(1, sampleAt(trees, wx, wz) * 1.3) + smooth(0, 2, edge)
        if (rand() > shade) continue
        const x = toPx(wx)
        const y = toPx(wz)
        const p = rand() < 0.5 ? litterDark : litterWarm
        const rr = 1 + rand() * 1.8
        p.moveTo(x + rr, y)
        p.ellipse(x, y, rr, rr * 0.6, rand() * Math.PI, 0, Math.PI * 2)
    }
    ctx.fillStyle = 'rgba(30, 36, 18, 0.28)'
    ctx.fill(litterDark)
    ctx.fillStyle = 'rgba(120, 92, 48, 0.22)'
    ctx.fill(litterWarm)

    // Pebbles on the paths: a shadowed underside and a sunlit top.
    const pebShade = new Path2D()
    const pebBody = new Path2D()
    const pebLight = new Path2D()
    for (let i = 0; i < n * n * 1.2; i++) {
        const wx = rand() * n
        const wz = rand() * n
        if (sampleAt(road, wx, wz) < 0.6) continue
        const x = toPx(wx)
        const y = toPx(wz)
        const rr = 0.9 + rand() * rand() * 3
        const rot = rand() * Math.PI
        pebShade.moveTo(x + rr + 0.6, y + 0.8)
        pebShade.ellipse(x + 0.6, y + 0.8, rr, rr * 0.7, rot, 0, Math.PI * 2)
        pebBody.moveTo(x + rr, y)
        pebBody.ellipse(x, y, rr, rr * 0.7, rot, 0, Math.PI * 2)
        if (rr > 1.6) {
            pebLight.moveTo(x - 0.3 + rr * 0.45, y - 0.4)
            pebLight.ellipse(x - 0.3, y - 0.4, rr * 0.45, rr * 0.3, rot, 0, Math.PI * 2)
        }
    }
    ctx.fillStyle = 'rgba(58, 44, 30, 0.35)'
    ctx.fill(pebShade)
    ctx.fillStyle = 'rgba(150, 138, 118, 0.75)'
    ctx.fill(pebBody)
    ctx.fillStyle = 'rgba(214, 204, 182, 0.55)'
    ctx.fill(pebLight)

    // Wildflowers: small clusters in meadow patches, away from paths and woods.
    const flowerColors = ['rgba(242, 238, 222, 0.85)', 'rgba(236, 204, 84, 0.85)', 'rgba(184, 156, 214, 0.8)', 'rgba(208, 86, 68, 0.8)']
    const flowers = flowerColors.map(() => new Path2D())
    for (let i = 0; i < n * n * 0.5; i++) {
        const wx = rand() * n
        const wz = rand() * n
        const meadow = smooth(0.52, 0.72, fbm(wx * 0.24 + 5.5, wz * 0.24, seed + 5))
        if (rand() > meadow) continue
        if (sampleAt(road, wx, wz) > 0.2 || sampleAt(trees, wx, wz) > 0.25) continue
        const kind = rand() < 0.4 ? 0 : rand() < 0.6 ? 1 : rand() < 0.8 ? 2 : 3
        const p = flowers[kind]!
        const dots = 3 + Math.floor(rand() * 5)
        for (let k = 0; k < dots; k++) {
            const x = toPx(wx) + (rand() - 0.5) * 14
            const y = toPx(wz) + (rand() - 0.5) * 14
            const rr = 0.9 + rand() * 0.8
            p.moveTo(x + rr, y)
            p.arc(x, y, rr, 0, Math.PI * 2)
        }
    }
    flowers.forEach((p, k) => {
        ctx.fillStyle = flowerColors[k]!
        ctx.fill(p)
    })
    return canvas
}

/**
 * A small tileable detail map multiplied over the ground up close: grass
 * blades in red, dirt grain and grit in green. Both average to mid-grey, so
 * the mipmapped far view is untouched.
 */
function detailTexture(): THREE.CanvasTexture {
    const S = 256
    const rand = stream(0xd37a11)
    const layer = (draw: (ctx: CanvasRenderingContext2D, wrap: (fn: (ox: number, oy: number) => void) => void) => void): Uint8ClampedArray => {
        const c = document.createElement('canvas')
        c.width = S
        c.height = S
        const ctx = c.getContext('2d')!
        ctx.fillStyle = 'rgb(128, 128, 128)'
        ctx.fillRect(0, 0, S, S)
        const wrap = (fn: (ox: number, oy: number) => void): void => {
            for (const ox of [-S, 0, S]) {
                for (const oy of [-S, 0, S]) fn(ox, oy)
            }
        }
        draw(ctx, wrap)
        return ctx.getImageData(0, 0, S, S).data
    }
    const grass = layer((ctx, wrap) => {
        ctx.lineCap = 'round'
        for (let pass = 0; pass < 2; pass++) {
            const p = new Path2D()
            for (let i = 0; i < 1100; i++) {
                const x = rand() * S
                const y = rand() * S
                const a = -Math.PI / 2 + (rand() - 0.5) * 1.6
                const len = 5 + rand() * 9
                const bend = (rand() - 0.5) * 4
                wrap((ox, oy) => {
                    p.moveTo(x + ox, y + oy)
                    p.quadraticCurveTo(x + ox + Math.cos(a) * len * 0.5 + bend, y + oy + Math.sin(a) * len * 0.5, x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len)
                })
            }
            ctx.lineWidth = pass === 0 ? 1.6 : 1.1
            ctx.strokeStyle = pass === 0 ? 'rgba(40, 40, 40, 0.5)' : 'rgba(230, 230, 230, 0.42)'
            ctx.stroke(p)
        }
    })
    const dirt = layer((ctx, wrap) => {
        for (let i = 0; i < 2600; i++) {
            const x = rand() * S
            const y = rand() * S
            const rr = 0.6 + rand() * rand() * 2.6
            const v = rand() < 0.5 ? 70 + rand() * 30 : 170 + rand() * 40
            ctx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.45)`
            wrap((ox, oy) => {
                ctx.beginPath()
                ctx.ellipse(x + ox, y + oy, rr, rr * 0.75, rand() * Math.PI, 0, Math.PI * 2)
                ctx.fill()
            })
        }
    })
    const c = document.createElement('canvas')
    c.width = S
    c.height = S
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(S, S)
    let sumR = 0
    let sumG = 0
    for (let i = 0; i < S * S; i++) {
        sumR += grass[i * 4]!
        sumG += dirt[i * 4]!
    }
    // Re-centre both channels on 128 so the far view stays neutral.
    const offR = 128 - sumR / (S * S)
    const offG = 128 - sumG / (S * S)
    for (let i = 0; i < S * S; i++) {
        img.data[i * 4] = grass[i * 4]! + offR
        img.data[i * 4 + 1] = dirt[i * 4]! + offG
        img.data[i * 4 + 2] = 128
        img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    const tex = new THREE.CanvasTexture(c)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.NoColorSpace
    return tex
}

// ─── Island shape ───────────────────────────────────────────────────────

interface RimPoint { x: number, z: number, nx: number, nz: number, s: number }

/** Rounded-rectangle outline of the island with outward normals, ~0.75 apart. */
function rimPoints(): RimPoint[] {
    const m = ISLAND_MARGIN
    const x0 = -m
    const z0 = -m
    const x1 = MAP_SIZE + m
    const z1 = MAP_SIZE + m
    const r = 7
    const pts: RimPoint[] = []
    let s = 0
    const push = (x: number, z: number, nx: number, nz: number): void => {
        const last = pts[pts.length - 1]
        if (last) s += Math.hypot(x - last.x, z - last.z)
        pts.push({ x, z, nx, nz, s })
    }
    const corner = (cx: number, cz: number, a0: number): void => {
        const steps = 14
        for (let k = 0; k <= steps; k++) {
            const a = a0 + (k / steps) * Math.PI / 2
            push(cx + Math.cos(a) * r, cz + Math.sin(a) * r, Math.cos(a), Math.sin(a))
        }
    }
    const edge = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number): void => {
        const len = Math.hypot(bx - ax, bz - az)
        const steps = Math.max(1, Math.round(len / 0.75))
        for (let k = 1; k < steps; k++) push(ax + (bx - ax) * k / steps, az + (bz - az) * k / steps, nx, nz)
    }
    corner(x1 - r, z1 - r, 0)
    edge(x1 - r, z1, x0 + r, z1, 0, 1)
    corner(x0 + r, z1 - r, Math.PI / 2)
    edge(x0, z1 - r, x0, z0 + r, -1, 0)
    corner(x0 + r, z0 + r, Math.PI)
    edge(x0 + r, z0, x1 - r, z0, 0, -1)
    corner(x1 - r, z0 + r, Math.PI * 1.5)
    edge(x1, z0 + r, x1, z1 - r, 1, 0)
    return pts
}

/**
 * Cliff profile, top to bottom: y and outward offset of each ring. The turf
 * lip rolls over the edge, the soil under it is undercut, then alternating
 * rock ledges and recesses down past the waterline.
 */
const RINGS: { y: number, off: number, jit: number, strata: boolean }[] = [
    { y: 0, off: 0, jit: 0, strata: false },
    { y: -0.1, off: 0.16, jit: 0.04, strata: false },
    { y: -0.25, off: 0.08, jit: 0.05, strata: false },
    { y: -0.4, off: -0.2, jit: 0.07, strata: true },
    { y: -0.62, off: -0.04, jit: 0.1, strata: true },
    { y: -0.84, off: -0.2, jit: 0.1, strata: true },
    { y: -1.02, off: 0.02, jit: 0.1, strata: true },
    { y: -1.3, off: -0.1, jit: 0.1, strata: true },
    { y: SEA_LEVEL, off: 0.08, jit: 0.08, strata: false },
    { y: -2.3, off: 0.45, jit: 0.15, strata: false },
    { y: -3.6, off: 1.1, jit: 0.2, strata: false }
]
const WATERLINE_RING = 8

/** Colour of each cliff band (between ring k and k + 1), sRGB 0–255. */
const BANDS: RGB[] = [
    [84, 104, 46], // turf lip
    [58, 72, 36], // turf underside
    [82, 64, 46], // soil
    [150, 138, 116], // pale sandstone
    [122, 116, 104], // grey stratum
    [158, 144, 118], // pale sandstone
    [108, 102, 94], // dark stratum
    [80, 78, 72], // damp rock above the waterline
    [50, 54, 52], // wet rock
    [40, 44, 44]
]

interface Boulder { x: number, z: number, r: number, rot: number, seed: number }

interface ShoreLayout {
    rim: RimPoint[]
    /** rings[k][i]: position of ring k at rim point i. */
    rings: { x: number, y: number, z: number }[][]
    boulders: Boulder[]
    perimeter: number
}

let layoutCache: ShoreLayout | null = null

/** The jittered cliff rings and the sea boulders; shared by island and sea. */
function shoreLayout(): ShoreLayout {
    if (layoutCache) return layoutCache
    const rim = rimPoints()
    const last = rim[rim.length - 1]!
    const perimeter = last.s + Math.hypot(rim[0]!.x - last.x, rim[0]!.z - last.z)
    // Periodic noise along the rim, so the wobble meets itself where the loop closes.
    const loop = (s: number, freq: number, seed: number): number => {
        const a = (s / perimeter) * Math.PI * 2
        const rad = perimeter * freq / (Math.PI * 2)
        return noise(Math.cos(a) * rad + 50, Math.sin(a) * rad + 50, seed)
    }
    const rings = RINGS.map((ring, k) => rim.map((p, i) => {
        const wobble = 0.2 + (loop(p.s, 0.06, 71) - 0.5) * 1.1 + (loop(p.s, 0.21, 72) - 0.5) * 0.45
        let off = ring.off + wobble + (hash2(i, k, 91) - 0.5) * ring.jit * 2
        let y = ring.y
        if (ring.strata) {
            // Fractured blocks: the rock steps in and out in chunks, and the
            // strata dip gently along the coast.
            const block = Math.floor(p.s / 1.7 + loop(p.s, 0.1, 73) * 2)
            off += (hash2(block, k, 92) - 0.5) * 0.3
            y += Math.sin(p.s * 0.045 + k * 1.3) * 0.05 + (hash2(i, k, 93) - 0.5) * 0.04
        }
        return { x: p.x + p.nx * off, y, z: p.z + p.nz * off }
    }))

    const rand = stream(0xb0a1de)
    const boulders: Boulder[] = []
    const water = rings[WATERLINE_RING]!
    for (let tries = 0; tries < 200 && boulders.length < 18; tries++) {
        const i = Math.floor(rand() * rim.length)
        const p = rim[i]!
        const r = 0.35 + rand() * rand() * 0.9
        const out = 0.3 + r + rand() * 2.2
        const x = water[i]!.x + p.nx * out + (rand() - 0.5) * 0.8
        const z = water[i]!.z + p.nz * out + (rand() - 0.5) * 0.8
        if (boulders.some(b => Math.hypot(b.x - x, b.z - z) < b.r + r + 1)) continue
        boulders.push({ x, z, r, rot: rand() * Math.PI * 2, seed: Math.floor(rand() * 1e6) })
        // Sometimes a smaller rock huddles beside it.
        if (rand() < 0.45) {
            const a = rand() * Math.PI * 2
            const r2 = r * (0.4 + rand() * 0.3)
            boulders.push({ x: x + Math.cos(a) * (r + r2) * 0.9, z: z + Math.sin(a) * (r + r2) * 0.9, r: r2, rot: rand() * Math.PI * 2, seed: Math.floor(rand() * 1e6) })
        }
    }
    layoutCache = { rim, rings, boulders, perimeter }
    return layoutCache
}

const tmpColor = new THREE.Color()

function srgb(c: RGB, shade: number): THREE.Color {
    return tmpColor.setRGB(c[0] / 255 * shade, c[1] / 255 * shade, c[2] / 255 * shade, THREE.SRGBColorSpace)
}

/** Island top (textured) plus stratified rock cliffs dropping into the sea. */
export function buildIsland(texture: THREE.Texture): THREE.Group {
    const group = new THREE.Group()
    const { rim, rings, boulders } = shoreLayout()

    // Top: a flat shape from the turf edge, UV-mapped onto the painted canvas.
    // Shape lives in XY; after rotateX(-90°) its y becomes -z, so feed -z in.
    const edge = rings[0]!
    const shape = new THREE.Shape(edge.map(p => new THREE.Vector2(p.x, -p.z)))
    const top = new THREE.ShapeGeometry(shape, 4)
    top.rotateX(-Math.PI / 2)
    const pos = top.attributes.position!
    const uv = new Float32Array(pos.count * 2)
    for (let i = 0; i < pos.count; i++) {
        uv[i * 2] = (pos.getX(i) + ISLAND_MARGIN) / TILES
        uv[i * 2 + 1] = 1 - (pos.getZ(i) + ISLAND_MARGIN) / TILES
    }
    top.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    top.computeVertexNormals()
    const detail = detailTexture()
    detail.anisotropy = texture.anisotropy
    const topMat = new THREE.MeshLambertMaterial({ map: texture })
    topMat.onBeforeCompile = (shader) => {
        shader.uniforms.uDetail = { value: detail }
        // Two scales of the same detail map, so its repeat doesn't show.
        shader.uniforms.uDetailScale = { value: new THREE.Vector2(TILES / 1.6, TILES / 4.3) }
        shader.fragmentShader = 'uniform sampler2D uDetail;\nuniform vec2 uDetailScale;\n' + shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            {
                vec3 d1 = texture2D(uDetail, vMapUv * uDetailScale.x).rgb;
                vec3 d2 = texture2D(uDetail, vMapUv * uDetailScale.y + 0.37).rgb;
                vec3 dd = d1 * 0.65 + d2 * 0.35 - 0.5;
                float grassy = clamp((diffuseColor.g - diffuseColor.r) * 14.0 + 0.3, 0.0, 1.0);
                float det = mix(dd.g, dd.r, grassy);
                diffuseColor.rgb *= 1.0 + det * 0.9;
            }`
        )
    }
    const topMesh = new THREE.Mesh(top, topMat)
    topMesh.receiveShadow = true
    group.add(topMesh)

    // Cliffs: one quad per rim segment per band, coloured by stratum.
    const positions: number[] = []
    const colors: number[] = []
    const push = (p: { x: number, y: number, z: number }, c: THREE.Color): void => {
        positions.push(p.x, p.y, p.z)
        colors.push(c.r, c.g, c.b)
    }
    const count = rim.length
    for (let k = 0; k < rings.length - 1; k++) {
        const upper = rings[k]!
        const lower = rings[k + 1]!
        for (let i = 0; i < count; i++) {
            const j = (i + 1) % count
            const block = Math.floor(rim[i]!.s / 1.7)
            const shade = 0.88 + hash2(block, k, 7) * 0.16 + (hash2(i, k, 8) - 0.5) * 0.08
            let band = BANDS[Math.min(k, BANDS.length - 1)]!
            // Now and then a stratum swaps tone, so the layers don't read as painted stripes.
            if (k >= 3 && k <= 6 && hash2(block, k, 9) < 0.18) band = BANDS[k === 4 ? 3 : 4]!
            const c = srgb(band, shade).clone()
            push(upper[i]!, c)
            push(lower[i]!, c)
            push(upper[j]!, c)
            push(upper[j]!, c)
            push(lower[i]!, c)
            push(lower[j]!, c)
        }
    }

    // Sea boulders: chunky jittered icosahedra, wet below the waterline.
    const ico = new THREE.IcosahedronGeometry(1, 0)
    const ip = ico.attributes.position!
    const v = new THREE.Vector3()
    for (const b of boulders) {
        const tri: THREE.Vector3[] = []
        for (let i = 0; i < ip.count; i++) {
            v.fromBufferAttribute(ip, i)
            // Jitter by position so shared corners move together.
            const key = Math.round(v.x * 10) * 7 + Math.round(v.y * 10) * 131 + Math.round(v.z * 10) * 1733
            const j = 0.8 + hash2(key, b.seed, 5) * 0.4
            const x = v.x * j * b.r
            const y = v.y * j * b.r * 0.72
            const z = v.z * j * b.r * 0.9
            const cs = Math.cos(b.rot)
            const sn = Math.sin(b.rot)
            tri.push(new THREE.Vector3(b.x + x * cs - z * sn, SEA_LEVEL + b.r * 0.12 + y, b.z + x * sn + z * cs))
            if (tri.length === 3) {
                const cy = (tri[0]!.y + tri[1]!.y + tri[2]!.y) / 3
                const tone: RGB = cy > SEA_LEVEL + 0.3 ? [124, 118, 106] : cy > SEA_LEVEL + 0.05 ? [84, 82, 76] : [48, 52, 50]
                const c = srgb(tone, 0.85 + hash2(i, b.seed, 6) * 0.25).clone()
                for (const t of tri) push(t, c)
                tri.length = 0
            }
        }
    }
    ico.dispose()

    const cliff = new THREE.BufferGeometry()
    cliff.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    cliff.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    cliff.computeVertexNormals()
    const cliffMesh = new THREE.Mesh(cliff, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, side: THREE.DoubleSide }))
    cliffMesh.receiveShadow = true
    cliffMesh.castShadow = true
    group.add(cliffMesh)
    return group
}

// ─── Sea ────────────────────────────────────────────────────────────────

/**
 * Distance from the waterline (cliffs and boulders) baked into a texture, so
 * the foam can hug the real, irregular shore.
 */
function shoreTexture(): { tex: THREE.DataTexture, rect: THREE.Vector3 } {
    const { rings, boulders } = shoreLayout()
    const pad = 22
    const min = -ISLAND_MARGIN - pad
    const span = MAP_SIZE + (ISLAND_MARGIN + pad) * 2
    const res = 512
    const scale = res / span
    const c = document.createElement('canvas')
    c.width = res
    c.height = res
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    rings[WATERLINE_RING]!.forEach((p, i) => {
        const x = (p.x - min) * scale
        const y = (p.z - min) * scale
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fill()
    for (const b of boulders) {
        ctx.beginPath()
        ctx.arc((b.x - min) * scale, (b.z - min) * scale, b.r * 0.85 * scale, 0, Math.PI * 2)
        ctx.fill()
    }
    const px = ctx.getImageData(0, 0, res, res).data
    const mask = new Uint8Array(res * res)
    for (let i = 0; i < res * res; i++) mask[i] = px[i * 4 + 3]! > 127 ? 1 : 0
    const dist = edt(mask, res, res)
    const data = new Uint8Array(res * res)
    for (let i = 0; i < res * res; i++) data[i] = Math.round(clamp01(dist[i]! / scale / SHORE_RANGE) * 255)
    const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
    return { tex, rect: new THREE.Vector3(min, min, span) }
}

/** Stylised sea: depth-tinted swell, glints, shallow caustics and surf hugging the shore. */
export function buildSea(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const m = ISLAND_MARGIN
    const shore = shoreTexture()
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uMin: { value: new THREE.Vector2(-m, -m) },
            uMax: { value: new THREE.Vector2(MAP_SIZE + m, MAP_SIZE + m) },
            uShallow: { value: new THREE.Color(0x5fd0e0) },
            uDeep: { value: new THREE.Color(0x2479b8) },
            uFar: { value: new THREE.Color(0xbfe4f7) },
            uCenter: { value: new THREE.Vector2(MAP_SIZE / 2, MAP_SIZE / 2) },
            uShore: { value: shore.tex },
            uShoreRect: { value: shore.rect },
            uGlint: { value: new THREE.Vector3(0.3, 0.62, -0.72).normalize() }
        },
        vertexShader: `
            varying vec3 vWorld;
            void main() {
                vec4 w = modelMatrix * vec4(position, 1.0);
                vWorld = w.xyz;
                gl_Position = projectionMatrix * viewMatrix * w;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec2 uMin;
            uniform vec2 uMax;
            uniform vec3 uShallow;
            uniform vec3 uDeep;
            uniform vec3 uFar;
            uniform vec2 uCenter;
            uniform sampler2D uShore;
            uniform vec3 uShoreRect;
            uniform vec3 uGlint;
            varying vec3 vWorld;

            float hash12(vec2 p) {
                vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }
            float vnoise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                float a = hash12(i);
                float b = hash12(i + vec2(1.0, 0.0));
                float c = hash12(i + vec2(0.0, 1.0));
                float d = hash12(i + vec2(1.0, 1.0));
                return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
            }
            float sdRoundBox(vec2 p, vec2 b, float r) {
                vec2 q = abs(p) - b + r;
                return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
            }
            float shoreDist(vec2 w) {
                vec2 uv = (w - uShoreRect.xy) / uShoreRect.z;
                if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
                    return max(sdRoundBox(w - (uMin + uMax) * 0.5, (uMax - uMin) * 0.5, 7.0), 0.0);
                }
                return texture2D(uShore, uv).r * ${SHORE_RANGE.toFixed(1)};
            }
            // Slope of one travelling swell: amplitude * frequency * cos(phase) along its direction.
            vec2 swell(vec2 p, vec2 dir, float freq, float speed, float amp) {
                return dir * (amp * freq * cos(dot(dir, p) * freq + uTime * speed));
            }
            // Thin bright filaments where two drifting noise ridges cross.
            float caustic(vec2 p) {
                float a = vnoise(p + vec2(uTime * 0.13, uTime * 0.07));
                float b = vnoise(p * 1.37 + vec2(-uTime * 0.09, uTime * 0.11) + 7.3);
                float ra = clamp(1.0 - abs(a * 2.0 - 1.0), 0.0, 1.0);
                float rb = clamp(1.0 - abs(b * 2.0 - 1.0), 0.0, 1.0);
                ra = ra * ra * ra * ra;
                rb = rb * rb * rb * rb;
                return ra * rb;
            }
            vec3 soften(vec3 c, float sat, float gain) {
                float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
                return max(mix(vec3(l), c, sat), 0.0) * gain;
            }
            void main() {
                vec2 w = vWorld.xz;
                float d = shoreDist(w);
                float depth = smoothstep(0.0, 13.0, d);

                // Natural palette derived from the (renderer-driven) uniforms,
                // so the Bloodmoon tint still carries through.
                vec3 shallow = soften(uShallow, 0.62, 0.42) * vec3(0.7, 1.0, 0.85);
                vec3 deep = soften(uDeep, 0.55, 0.5) * vec3(0.85, 1.0, 0.8);
                vec3 col = mix(shallow, deep, depth);

                // Swell: a few crossing waves, domain-warped so they never line up.
                vec2 p = w + (vec2(vnoise(w * 0.09 + uTime * 0.03), vnoise(w * 0.09 + 9.1 - uTime * 0.02)) - 0.5) * 6.0;
                vec2 g = swell(p, vec2(0.8, 0.6), 0.8, 0.9, 0.1);
                g += swell(p, vec2(-0.49, 0.87), 1.25, 1.3, 0.07);
                g += swell(p, vec2(0.95, -0.31), 2.0, 1.8, 0.04);
                g += swell(p, vec2(-0.2, -0.98), 3.1, 2.4, 0.022);
                vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
                vec3 toCam = cameraPosition - vWorld;
                float camDist = length(toCam);
                vec3 v = toCam / max(camDist, 0.001);
                // Slope shading gives the swell shape without real lighting.
                col *= 1.0 + (g.x * 0.35 + g.y * 0.5);

                // Sky reflection at grazing angles.
                float fr = clamp(1.0 - dot(n, v), 0.0, 1.0);
                fr = fr * fr * fr;
                col = mix(col, uFar * 0.9, fr * 0.55);

                // Caustics dancing in the shallows by the cliffs.
                float shallowK = 1.0 - smoothstep(0.5, 6.0, d);
                col += shallow * caustic(w * 0.75) * shallowK * 0.9;

                // Glints: a stylised light facing the camera, broken into twinkles.
                float nh = clamp(dot(n, normalize(uGlint + v)), 0.0, 1.0);
                float glint = pow(nh, 600.0) * smoothstep(0.6, 0.85, vnoise(w * 0.9 + vec2(uTime * 0.4, -uTime * 0.3)));
                glint *= 1.0 - smoothstep(40.0, 80.0, camDist);
                col += vec3(1.0, 0.97, 0.9) * glint;

                // Surf: a ragged contact line, swells lapping in and out, lacy trails.
                float lace = vnoise(w * 1.6 + vec2(uTime * 0.15, uTime * 0.05));
                float lace2 = vnoise(w * 3.3 - vec2(uTime * 0.1, uTime * 0.2) + 3.1);
                float contact = 1.0 - smoothstep(0.1, 0.35 + lace * 0.45, d);
                float phase = fract(uTime * 0.11 + lace * 0.12);
                float wave = 1.0 - smoothstep(0.0, 0.16 + phase * 0.12, abs(d - (0.3 + phase * 2.6)));
                wave *= (1.0 - phase) * smoothstep(0.35, 0.65, lace2);
                float trail = smoothstep(0.55, 0.85, lace * 0.6 + lace2 * 0.4) * (1.0 - smoothstep(0.4, 3.2, d)) * 0.55;
                float foam = clamp(contact + wave * 0.8 + trail, 0.0, 1.0);
                col = mix(col, vec3(0.86, 0.9, 0.9), foam * 0.85);

                // Fade into the sky haze far out.
                float far = clamp((length(w - uCenter) - 70.0) / 90.0, 0.0, 1.0);
                col = mix(col, uFar, far);
                gl_FragColor = vec4(col, 1.0);
                #include <colorspace_fragment>
            }
        `
    })
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), mat)
    sea.position.set(MAP_SIZE / 2, SEA_LEVEL, MAP_SIZE / 2)
    return sea
}
