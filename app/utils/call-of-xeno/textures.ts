// Call of Xeno — procedural textures.
//
// Everything is drawn once into offscreen canvases at load time, so the game
// stays asset-free. Surfaces are generated as full PBR sets: an albedo map, a
// roughness map and a normal map (derived from a height field), plus an
// emissive mask for the alien bio-growth. Sets are lazy and cached: a surface
// kind nothing uses is never drawn.
//
// The generators work on float buffers (one per channel) so noise, wear and
// grime compose cleanly, then bake them into canvases at the end. All noise is
// tileable and seeded, so a texture looks the same on every run.

import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function makeRng(seed: number) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

type Rgb = [number, number, number]

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (e0: number, e1: number, x: number) => {
    const t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)
}

export function hexRgb(hex: string | number): Rgb {
    const value = typeof hex === 'number' ? hex : parseInt(hex.replace('#', ''), 16)
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

function canvasOf(width: number, height = width) {
    const element = document.createElement('canvas')
    element.width = width
    element.height = height
    return { element, ctx: element.getContext('2d', { willReadFrequently: true })! }
}

/** Tileable fractal value noise, 0..1. `sx`/`sy` stretch the lattice per axis. */
function fbm(n: number, rand: () => number, base: number, octaves: number, gain = 0.5, sx = 1, sy = 1) {
    const out = new Float32Array(n * n)
    let amp = 1
    let total = 0
    for (let o = 0; o < octaves; o++) {
        const cx = Math.max(1, Math.round(base * sx * (1 << o)))
        const cy = Math.max(1, Math.round(base * sy * (1 << o)))
        const lattice = new Float32Array(cx * cy)
        for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
        const xi0 = new Int32Array(n)
        const xi1 = new Int32Array(n)
        const xf = new Float32Array(n)
        for (let x = 0; x < n; x++) {
            const u = (x / n) * cx
            const i0 = Math.floor(u)
            const f = u - i0
            xi0[x] = i0 % cx
            xi1[x] = (i0 + 1) % cx
            xf[x] = f * f * (3 - 2 * f)
        }
        for (let y = 0; y < n; y++) {
            const v = (y / n) * cy
            const j0 = Math.floor(v)
            const fy = v - j0
            const sy2 = fy * fy * (3 - 2 * fy)
            const row0 = (j0 % cy) * cx
            const row1 = ((j0 + 1) % cy) * cx
            for (let x = 0; x < n; x++) {
                const a = lattice[row0 + xi0[x]!]!
                const b = lattice[row0 + xi1[x]!]!
                const c = lattice[row1 + xi0[x]!]!
                const d = lattice[row1 + xi1[x]!]!
                const t = xf[x]!
                out[y * n + x] = out[y * n + x]! + amp * mix(mix(a, b, t), mix(c, d, t), sy2)
            }
        }
        total += amp
        amp *= gain
    }
    for (let i = 0; i < out.length; i++) out[i] = out[i]! / total
    return out
}

/** A working surface: one float buffer per channel. */
class Surf {
    readonly n: number
    r: Float32Array
    g: Float32Array
    b: Float32Array
    rough: Float32Array
    h: Float32Array
    emit: Float32Array | null = null
    constructor(n: number, base: Rgb, rough = 0.6, h = 0.5) {
        this.n = n
        const size = n * n
        this.r = new Float32Array(size).fill(base[0])
        this.g = new Float32Array(size).fill(base[1])
        this.b = new Float32Array(size).fill(base[2])
        this.rough = new Float32Array(size).fill(rough)
        this.h = new Float32Array(size).fill(h)
    }

    /** Blend a colour into pixel `i`. */
    tint(i: number, c: Rgb, t: number) {
        this.r[i] = mix(this.r[i]!, c[0], t)
        this.g[i] = mix(this.g[i]!, c[1], t)
        this.b[i] = mix(this.b[i]!, c[2], t)
    }

    /** Multiply pixel `i`'s colour. */
    shade(i: number, k: number) {
        this.r[i] = this.r[i]! * k
        this.g[i] = this.g[i]! * k
        this.b[i] = this.b[i]! * k
    }
}

/** Composite a canvas drawing into the surface, optionally driving roughness and height too. */
function paintOver(s: Surf, draw: (ctx: CanvasRenderingContext2D) => void, o: { rough?: number, h?: number } = {}) {
    const { ctx } = canvasOf(s.n)
    draw(ctx)
    const data = ctx.getImageData(0, 0, s.n, s.n).data
    for (let i = 0; i < s.n * s.n; i++) {
        const a = data[i * 4 + 3]! / 255
        if (a <= 0.002) continue
        s.r[i] = mix(s.r[i]!, data[i * 4]! / 255, a)
        s.g[i] = mix(s.g[i]!, data[i * 4 + 1]! / 255, a)
        s.b[i] = mix(s.b[i]!, data[i * 4 + 2]! / 255, a)
        if (o.rough !== undefined) s.rough[i] = mix(s.rough[i]!, o.rough, a)
        if (o.h !== undefined) s.h[i] = s.h[i]! + o.h * a
    }
}

/** Run `fn` at `(x, y)` and at the wrapped copies, so blobs near an edge tile. */
function tiled(n: number, x: number, y: number, r: number, fn: (x: number, y: number) => void) {
    for (const ox of [-n, 0, n]) {
        for (const oy of [-n, 0, n]) {
            const px = x + ox
            const py = y + oy
            if (px < -r || px > n + r || py < -r || py > n + r) continue
            fn(px, py)
        }
    }
}

function blot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color.replace('A', String(alpha)))
    g.addColorStop(0.55, color.replace('A', String(alpha * 0.5)))
    g.addColorStop(1, color.replace('A', '0'))
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

/** A wandering crack with the odd branch. */
function crack(ctx: CanvasRenderingContext2D, rand: () => number, x: number, y: number, angle: number, length: number, width: number, depth = 0) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    let a = angle
    const step = 7 + rand() * 6
    for (let d = 0; d < length; d += step) {
        a += (rand() - 0.5) * 0.9
        x += Math.cos(a) * step
        y += Math.sin(a) * step
        ctx.lineTo(x, y)
        if (depth < 2 && rand() < 0.09) crack(ctx, rand, x, y, a + (rand() - 0.5) * 1.6, length * 0.4, width * 0.6, depth + 1)
    }
    ctx.lineWidth = width
    ctx.stroke()
}

// ---------------------------------------------------------------------------
// Texture finishing
// ---------------------------------------------------------------------------

export interface PBRSet {
    map: THREE.CanvasTexture
    roughnessMap: THREE.CanvasTexture
    normalMap: THREE.CanvasTexture
    emissiveMap: THREE.CanvasTexture | null
    /** World metres one repeat of this set covers. */
    tile: number
    textures: THREE.Texture[]
}

function configure(texture: THREE.CanvasTexture, srgb: boolean) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.anisotropy = 8
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    return texture
}

function finish(s: Surf, tile: number, normalStrength: number): PBRSet {
    const n = s.n
    const size = n * n
    const color = canvasOf(n)
    const rough = canvasOf(n)
    const normal = canvasOf(n)
    const cImg = color.ctx.createImageData(n, n)
    const rImg = rough.ctx.createImageData(n, n)
    const nImg = normal.ctx.createImageData(n, n)
    for (let i = 0; i < size; i++) {
        const o = i * 4
        cImg.data[o] = clamp01(s.r[i]!) * 255
        cImg.data[o + 1] = clamp01(s.g[i]!) * 255
        cImg.data[o + 2] = clamp01(s.b[i]!) * 255
        cImg.data[o + 3] = 255
        const ro = clamp01(s.rough[i]!) * 255
        rImg.data[o] = ro
        rImg.data[o + 1] = ro
        rImg.data[o + 2] = ro
        rImg.data[o + 3] = 255
    }
    // Height to normal, wrapping so the tile stays seamless. The canvas is
    // flipped on upload, so canvas-down is texture-down: dh/dv = -dh/dy.
    const h = s.h
    for (let y = 0; y < n; y++) {
        const ym = ((y - 1 + n) % n) * n
        const yp = ((y + 1) % n) * n
        for (let x = 0; x < n; x++) {
            const xm = (x - 1 + n) % n
            const xp = (x + 1) % n
            const dx = (h[y * n + xp]! - h[y * n + xm]!) * normalStrength
            const dy = (h[yp + x]! - h[ym + x]!) * normalStrength
            const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1)
            const o = (y * n + x) * 4
            nImg.data[o] = (-dx * inv * 0.5 + 0.5) * 255
            nImg.data[o + 1] = (dy * inv * 0.5 + 0.5) * 255
            nImg.data[o + 2] = (inv * 0.5 + 0.5) * 255
            nImg.data[o + 3] = 255
        }
    }
    color.ctx.putImageData(cImg, 0, 0)
    rough.ctx.putImageData(rImg, 0, 0)
    normal.ctx.putImageData(nImg, 0, 0)

    let emissiveMap: THREE.CanvasTexture | null = null
    if (s.emit) {
        const emit = canvasOf(n)
        const eImg = emit.ctx.createImageData(n, n)
        for (let i = 0; i < size; i++) {
            const o = i * 4
            const e = clamp01(s.emit[i]!)
            eImg.data[o] = e * 40
            eImg.data[o + 1] = e * 255
            eImg.data[o + 2] = e * 190
            eImg.data[o + 3] = 255
        }
        emit.ctx.putImageData(eImg, 0, 0)
        emissiveMap = configure(new THREE.CanvasTexture(emit.element), true)
    }

    const map = configure(new THREE.CanvasTexture(color.element), true)
    const roughnessMap = configure(new THREE.CanvasTexture(rough.element), false)
    const normalMap = configure(new THREE.CanvasTexture(normal.element), false)
    const textures: THREE.Texture[] = [map, roughnessMap, normalMap]
    if (emissiveMap) textures.push(emissiveMap)
    return { map, roughnessMap, normalMap, emissiveMap, tile, textures }
}

// ---------------------------------------------------------------------------
// Surface generators
// ---------------------------------------------------------------------------

export type SurfaceKind =
    | 'epoxy' | 'concrete' | 'asphalt' | 'tile' | 'diamond' | 'grating' | 'corrugated' | 'shutter'
    | 'block' | 'brick' | 'walltile' | 'panel' | 'plank' | 'bio' | 'paint' | 'cardboard'
    | 'wrap' | 'gravel' | 'hazard' | 'rubber'

export interface SurfaceOptions {
    /** Base paint / material colour, where the kind has one. */
    base?: string | number
    /** Secondary colour (hazard light stripe, for instance). */
    accent?: string | number
    seed?: number
}

/** Metres one repeat covers, per kind. */
export const SURFACE_TILE: Record<SurfaceKind, number> = {
    epoxy: 6, concrete: 6, asphalt: 8, tile: 2.4, diamond: 1, grating: 1, corrugated: 3.2, shutter: 3.2,
    block: 3.2, brick: 2.4, walltile: 2.4, panel: 4, plank: 1, bio: 2, paint: 1, cardboard: 1,
    wrap: 1, gravel: 4, hazard: 1, rubber: 1
}

function concrete(seed: number, base: Rgb, epoxy: boolean): Surf {
    const n = 1024
    const rand = makeRng(seed)
    const s = new Surf(n, base, epoxy ? 0.3 : 0.55, 0.5)
    const big = fbm(n, rand, 3, 4)
    const mid = fbm(n, rand, 10, 3)
    const fine = fbm(n, rand, 64, 2)
    for (let i = 0; i < n * n; i++) {
        const v = (big[i]! - 0.5) * 0.26 + (mid[i]! - 0.5) * 0.14 + (fine[i]! - 0.5) * (epoxy ? 0.05 : 0.11) + (rand() - 0.5) * 0.03
        s.shade(i, 1 + v)
        if (epoxy) {
            // Epoxy gloss breaks up under wear: patches of dull, foot-polished lanes.
            s.rough[i] = clamp01(0.16 + smooth(0.42, 0.72, big[i]! * 0.6 + mid[i]! * 0.4) * 0.5 + (fine[i]! - 0.5) * 0.12)
            s.h[i] = 0.5 + (fine[i]! - 0.5) * 0.06
        } else {
            s.rough[i] = clamp01(0.55 + (mid[i]! - 0.5) * 0.5 + (fine[i]! - 0.5) * 0.3)
            s.h[i] = 0.5 + (mid[i]! - 0.5) * 0.2 + (fine[i]! - 0.5) * 0.5
        }
    }

    // Saw-cut joints, one each way through the middle of the tile.
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const jd = Math.min(Math.min(x, n - x), Math.abs(x - n / 2), Math.min(y, n - y), Math.abs(y - n / 2))
            if (jd > 3) continue
            const i = y * n + x
            const k = 1 - jd / 3
            s.shade(i, 1 - 0.4 * k)
            s.h[i] = s.h[i]! - 0.4 * k
            s.rough[i] = mix(s.rough[i]!, 0.85, k)
        }
    }

    paintOver(s, (ctx) => {
        ctx.strokeStyle = 'rgba(8,8,8,0.7)'
        ctx.lineCap = 'round'
        for (let i = 0; i < (epoxy ? 3 : 7); i++) crack(ctx, rand, rand() * n, rand() * n, rand() * 6.28, 90 + rand() * 260, 1.1 + rand() * 1.2)
    }, { h: -0.25 })

    // Damp patches, chemical spills, and oil that has pooled to a gloss.
    paintOver(s, (ctx) => {
        for (let i = 0; i < 14; i++) {
            const r = 50 + rand() * 160
            const x = rand() * n
            const y = rand() * n
            tiled(n, x, y, r, (px, py) => blot(ctx, px, py, r, 'rgba(18,14,9,A)', 0.12 + rand() * 0.2))
        }
    })
    paintOver(s, (ctx) => {
        for (let i = 0; i < 10; i++) {
            const r = 14 + rand() * 46
            const x = rand() * n
            const y = rand() * n
            tiled(n, x, y, r, (px, py) => blot(ctx, px, py, r, 'rgba(5,5,6,A)', 0.55))
        }
    }, { rough: 0.1 })

    if (epoxy) {
        // Tyre and skid marks plus scuffs: rubber is matte on glossy epoxy.
        paintOver(s, (ctx) => {
            ctx.lineCap = 'butt'
            for (let i = 0; i < 6; i++) {
                ctx.strokeStyle = `rgba(6,6,6,${0.16 + rand() * 0.14})`
                ctx.lineWidth = 16 + rand() * 12
                const cx = rand() * n
                const cy = rand() * n
                const rad = 180 + rand() * 500
                const a0 = rand() * 6.28
                ctx.beginPath()
                ctx.arc(cx, cy, rad, a0, a0 + 0.35 + rand() * 0.5)
                ctx.stroke()
            }
            for (let i = 0; i < 26; i++) {
                ctx.strokeStyle = `rgba(230,230,225,${0.03 + rand() * 0.05})`
                ctx.lineWidth = 1 + rand() * 2.5
                const x = rand() * n
                const y = rand() * n
                ctx.beginPath()
                ctx.moveTo(x, y)
                ctx.lineTo(x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 120)
                ctx.stroke()
            }
        }, { rough: 0.72 })
    }
    return s
}

function asphalt(seed: number): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, [0.12, 0.12, 0.125], 0.82, 0.5)
    const big = fbm(n, rand, 4, 4)
    const grain = fbm(n, rand, 96, 2)
    for (let i = 0; i < n * n; i++) {
        const speck = rand()
        let v = 1 + (big[i]! - 0.5) * 0.45 + (grain[i]! - 0.5) * 0.4
        if (speck > 0.965) v += 0.9 * speck
        s.shade(i, v)
        s.rough[i] = 0.72 + (grain[i]! - 0.5) * 0.3 - (speck > 0.965 ? 0.2 : 0)
        s.h[i] = 0.5 + (grain[i]! - 0.5) * 0.9 + (speck > 0.965 ? 0.2 : 0)
    }
    paintOver(s, (ctx) => {
        ctx.strokeStyle = 'rgba(2,2,3,0.9)'
        for (let i = 0; i < 6; i++) crack(ctx, rand, rand() * n, rand() * n, rand() * 6.28, 80 + rand() * 200, 1.2 + rand() * 1.6)
    }, { h: -0.3 })
    paintOver(s, (ctx) => {
        ctx.fillStyle = 'rgba(8,8,9,0.5)'
        ctx.fillRect(rand() * 300, rand() * 300, 120 + rand() * 90, 60 + rand() * 60)
        for (let i = 0; i < 5; i++) {
            const r = 30 + rand() * 60
            const x = rand() * n
            const y = rand() * n
            tiled(n, x, y, r, (px, py) => blot(ctx, px, py, r, 'rgba(3,4,6,A)', 0.5))
        }
    }, { rough: 0.32 })
    return s
}

function vinylTile(seed: number, base: Rgb): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, base, 0.42, 0.55)
    const cells = 4
    const size = n / cells
    const tone: number[] = []
    for (let i = 0; i < cells * cells; i++) tone.push(0.88 + rand() * 0.24)
    const fine = fbm(n, rand, 48, 2)
    const big = fbm(n, rand, 4, 3)
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x
            const cx = Math.floor(x / size)
            const cy = Math.floor(y / size)
            const lx = x - cx * size
            const ly = y - cy * size
            const edge = Math.min(lx, size - 1 - lx, ly, size - 1 - ly)
            let k = tone[cy * cells + cx]! * (1 + (fine[i]! - 0.5) * 0.18 + (big[i]! - 0.5) * 0.3)
            // Chequered two-tone: every other tile a shade darker.
            if ((cx + cy) % 2 === 1) k *= 0.78
            if (edge < 2) {
                s.shade(i, 0.32)
                s.h[i] = 0.1
                s.rough[i] = 0.9
                continue
            }
            // Dirt worked into the tile edges.
            if (edge < 7) k *= 0.86 + edge * 0.02
            s.shade(i, k)
            s.h[i] = 0.55 + (fine[i]! - 0.5) * 0.08 + smooth(2, 5, edge) * 0.05
            s.rough[i] = 0.34 + (big[i]! - 0.5) * 0.4
        }
    }
    paintOver(s, (ctx) => {
        ctx.strokeStyle = 'rgba(5,5,5,0.7)'
        for (let i = 0; i < 2; i++) crack(ctx, rand, rand() * n, rand() * n, rand() * 6.28, 60 + rand() * 90, 1)
    }, { h: -0.2 })
    return s
}

function diamondPlate(seed: number, base: Rgb): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, base, 0.46, 0.4)
    const cells = 10
    const size = n / cells
    const noise = fbm(n, rand, 6, 3)
    const fine = fbm(n, rand, 80, 2)
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x
            const cx = Math.floor(x / size)
            const cy = Math.floor(y / size)
            const u = (x / size - cx - 0.5)
            const v = (y / size - cy - 0.5)
            // Lozenges alternate between +45 and -45 degrees.
            const flip = (cx + cy) % 2 === 0 ? 1 : -1
            const a = (u + v * flip) * 0.7071
            const b = (u * flip - v) * 0.7071
            const d = (a / 0.44) ** 2 + (b / 0.11) ** 2
            const raised = 1 - smooth(0.7, 1.0, d)
            s.h[i] = 0.35 + raised * 0.5 + (fine[i]! - 0.5) * 0.08
            let k = 0.8 + raised * 0.35 + (noise[i]! - 0.5) * 0.5 + (fine[i]! - 0.5) * 0.18
            // Grime settles in the valleys.
            k *= 1 - (1 - raised) * 0.18
            s.shade(i, k)
            s.rough[i] = 0.38 + (1 - raised) * 0.22 + (noise[i]! - 0.5) * 0.3
            // Rust blooming through wear.
            const rust = smooth(0.66, 0.8, noise[i]! + (fine[i]! - 0.5) * 0.2)
            if (rust > 0) {
                s.tint(i, [0.36, 0.19, 0.09], rust * 0.7)
                s.rough[i] = mix(s.rough[i]!, 0.85, rust)
            }
        }
    }
    paintOver(s, (ctx) => {
        for (let i = 0; i < 90; i++) {
            ctx.strokeStyle = `rgba(210,215,220,${0.05 + rand() * 0.12})`
            ctx.lineWidth = 0.6 + rand()
            const x = rand() * n
            const y = rand() * n
            const a = rand() * 6.28
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + Math.cos(a) * (12 + rand() * 30), y + Math.sin(a) * (12 + rand() * 30))
            ctx.stroke()
        }
    })
    return s
}

function grating(seed: number): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, [0.03, 0.03, 0.035], 0.7, 0.05)
    const noise = fbm(n, rand, 8, 3)
    const pitch = n / 20
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x
            const fx = (x % pitch) / pitch
            const fy = (y % (pitch * 4)) / (pitch * 4)
            const bar = fx < 0.3 // load bars, fine pitch
            const cross = fy < 0.09 // cross rods
            if (bar || cross) {
                const k = 0.85 + (noise[i]! - 0.5) * 0.5
                s.r[i] = 0.34 * k
                s.g[i] = 0.35 * k
                s.b[i] = 0.37 * k
                s.h[i] = 0.9
                s.rough[i] = 0.5 + (noise[i]! - 0.5) * 0.3
                const rust = smooth(0.62, 0.78, noise[i]!)
                if (rust > 0) s.tint(i, [0.35, 0.18, 0.08], rust * 0.6)
            }
        }
    }
    return s
}

function corrugated(seed: number, base: Rgb, horizontal: boolean): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, base, 0.5, 0.5)
    const ribs = 32
    // Streaks run along the ribs: fast in the rib direction's cross axis.
    const streak = horizontal ? fbm(n, rand, 3, 3, 0.5, 1, 6) : fbm(n, rand, 3, 3, 0.5, 6, 1)
    const patch = fbm(n, rand, 5, 4)
    const fine = fbm(n, rand, 72, 2)
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x
            const t = horizontal ? y : x
            const phase = (t / n) * ribs
            const p = phase - Math.floor(phase)
            const profile = 0.5 - 0.5 * Math.cos(p * Math.PI * 2)
            s.h[i] = 0.2 + profile * 0.6
            // Crests catch the light, troughs hold the dirt.
            let k = 0.68 + profile * 0.5 + (patch[i]! - 0.5) * 0.45 + (fine[i]! - 0.5) * 0.12
            k *= 1 - streak[i]! * 0.16
            s.shade(i, k)
            s.rough[i] = 0.44 + (1 - profile) * 0.16 + (patch[i]! - 0.5) * 0.3
            const rustMask = smooth(0.58, 0.76, streak[i]! * 0.55 + patch[i]! * 0.55 - profile * 0.08)
            if (rustMask > 0) {
                s.tint(i, [0.4, 0.2, 0.09], rustMask * 0.78)
                s.rough[i] = mix(s.rough[i]!, 0.88, rustMask)
                s.h[i] = s.h[i]! + rustMask * 0.05
            }
        }
    }
    // Scuffed paint, and the odd screw head running down a rib.
    paintOver(s, (ctx) => {
        for (let i = 0; i < 40; i++) {
            ctx.strokeStyle = `rgba(200,205,210,${0.04 + rand() * 0.1})`
            ctx.lineWidth = 1 + rand() * 1.5
            const x = rand() * n
            const y = rand() * n
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + (horizontal ? 40 : (rand() - 0.5) * 6), y + (horizontal ? (rand() - 0.5) * 6 : 40))
            ctx.stroke()
        }
    })
    return s
}

function blockWall(seed: number, base: Rgb): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, base, 0.86, 0.6)
    const cols = 8
    const rows = 16
    const bw = n / cols
    const bh = n / rows
    const tone: number[] = []
    for (let i = 0; i < cols * rows; i++) tone.push(0.92 + rand() * 0.16)
    const pit = fbm(n, rand, 90, 2)
    const patch = fbm(n, rand, 4, 4)
    const chip = fbm(n, rand, 12, 3)
    const streak = fbm(n, rand, 2, 3, 0.5, 8, 1)
    for (let y = 0; y < n; y++) {
        const row = Math.floor(y / bh)
        const ly = y - row * bh
        for (let x = 0; x < n; x++) {
            const i = y * n + x
            const xo = (x + (row % 2) * bw / 2) % n
            const col = Math.floor(xo / bw)
            const lx = xo - col * bw
            const mortar = ly < 2.5 || lx < 2.5
            if (mortar) {
                s.r[i] = 0.34 + (pit[i]! - 0.5) * 0.1
                s.g[i] = 0.34 + (pit[i]! - 0.5) * 0.1
                s.b[i] = 0.32 + (pit[i]! - 0.5) * 0.1
                s.h[i] = 0.12
                s.rough[i] = 0.95
                continue
            }
            let k = tone[row * cols + col]! * (1 + (patch[i]! - 0.5) * 0.4 + (pit[i]! - 0.5) * 0.14)
            k *= 1 - streak[i]! * 0.3
            s.shade(i, k)
            s.h[i] = 0.62 + (pit[i]! - 0.5) * 0.25
            s.rough[i] = 0.8 + (pit[i]! - 0.5) * 0.3
            // Paint chipped back to bare block.
            const bare = smooth(0.66, 0.74, chip[i]! + (pit[i]! - 0.5) * 0.15)
            if (bare > 0) {
                s.tint(i, [0.5, 0.49, 0.46], bare)
                s.rough[i] = mix(s.rough[i]!, 0.97, bare)
                s.h[i] = s.h[i]! - bare * 0.14
            }
        }
    }
    return s
}

function brickWall(seed: number): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, [0.42, 0.2, 0.15], 0.85, 0.6)
    const cols = 10
    const rows = 30
    const bw = n / cols
    const bh = n / rows
    const tone: Rgb[] = []
    for (let i = 0; i < cols * rows; i++) {
        const k = 0.75 + rand() * 0.5
        tone.push([0.44 * k, 0.2 * k + rand() * 0.03, 0.14 * k])
    }
    const pit = fbm(n, rand, 70, 2)
    const soot = fbm(n, rand, 3, 3, 0.5, 6, 1)
    for (let y = 0; y < n; y++) {
        const row = Math.floor(y / bh)
        const ly = y - row * bh
        for (let x = 0; x < n; x++) {
            const i = y * n + x
            const xo = (x + (row % 2) * bw / 2) % n
            const col = Math.floor(xo / bw)
            const lx = xo - col * bw
            if (ly < 2.4 || lx < 2.6) {
                const m = 0.5 + (pit[i]! - 0.5) * 0.2
                s.r[i] = m
                s.g[i] = m * 0.97
                s.b[i] = m * 0.9
                s.h[i] = 0.1
                s.rough[i] = 0.95
                continue
            }
            const t = tone[row * cols + (col % cols)]!
            const grain = 1 + (pit[i]! - 0.5) * 0.35
            s.r[i] = t[0] * grain
            s.g[i] = t[1] * grain
            s.b[i] = t[2] * grain
            s.shade(i, 1 - soot[i]! * 0.5)
            s.h[i] = 0.65 + (pit[i]! - 0.5) * 0.3
            s.rough[i] = 0.8 + (pit[i]! - 0.5) * 0.2
        }
    }
    return s
}

function wallTile(seed: number, base: Rgb): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, base, 0.2, 0.6)
    const cells = 8
    const size = n / cells
    const fine = fbm(n, rand, 40, 2)
    const stain = fbm(n, rand, 3, 3, 0.5, 6, 1)
    const tone: number[] = []
    for (let i = 0; i < cells * cells; i++) tone.push(0.9 + rand() * 0.16)
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x
            const cx = Math.floor(x / size)
            const cy = Math.floor(y / size)
            const edge = Math.min(x - cx * size, size - 1 - (x - cx * size), y - cy * size, size - 1 - (y - cy * size))
            if (edge < 2) {
                s.r[i] = 0.3
                s.g[i] = 0.3
                s.b[i] = 0.28
                s.h[i] = 0.1
                s.rough[i] = 0.9
                continue
            }
            const k = tone[cy * cells + cx]! * (1 + (fine[i]! - 0.5) * 0.1) * (1 - stain[i]! * 0.34)
            s.shade(i, k)
            // Bevelled glaze: the rim curves away from the light.
            s.h[i] = 0.55 + smooth(2, 7, edge) * 0.25
            s.rough[i] = 0.16 + stain[i]! * 0.35
        }
    }
    paintOver(s, (ctx) => {
        ctx.strokeStyle = 'rgba(10,10,10,0.8)'
        for (let i = 0; i < 3; i++) crack(ctx, rand, rand() * n, rand() * n, rand() * 6.28, 50 + rand() * 80, 1)
    }, { h: -0.2 })
    return s
}

function metalPanel(seed: number, base: Rgb): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, base, 0.5, 0.5)
    const panels = 4
    const pw = n / panels
    const dent = fbm(n, rand, 5, 4)
    const streak = fbm(n, rand, 3, 3, 0.5, 8, 1)
    const fine = fbm(n, rand, 70, 2)
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x
            const lx = (x % pw) / pw
            // Three shallow ribs per panel, and a tight seam between panels.
            const rib = 0.5 - 0.5 * Math.cos(lx * Math.PI * 2 * 3)
            const seam = Math.min(lx, 1 - lx) * pw
            let k = 0.85 + rib * 0.2 + (dent[i]! - 0.5) * 0.5 + (fine[i]! - 0.5) * 0.1
            k *= 1 - streak[i]! * 0.22
            s.h[i] = 0.5 + rib * 0.12 + (dent[i]! - 0.5) * 0.5
            if (seam < 2.5) {
                k *= 0.5
                s.h[i] = 0.15
            }
            s.shade(i, k)
            s.rough[i] = 0.42 + (dent[i]! - 0.5) * 0.35 + (1 - rib) * 0.08
            const rust = smooth(0.66, 0.8, streak[i]! * 0.7 + (seam < 6 ? 0.15 : 0) + (fine[i]! - 0.5) * 0.2)
            if (rust > 0) {
                s.tint(i, [0.38, 0.2, 0.1], rust * 0.6)
                s.rough[i] = mix(s.rough[i]!, 0.88, rust)
            }
        }
    }
    paintOver(s, (ctx) => {
        ctx.fillStyle = 'rgba(30,30,30,0.9)'
        for (let px = 0; px < panels; px++) {
            for (let yy = 12; yy < n; yy += 40) {
                ctx.beginPath()
                ctx.arc(px * pw + 5, yy, 2, 0, 6.28)
                ctx.fill()
            }
        }
    }, { h: 0.1 })
    return s
}

function planks(seed: number): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, [0.4, 0.31, 0.21], 0.82, 0.55)
    const count = 4
    const ph = n / count
    const grain = fbm(n, rand, 2, 3, 0.55, 1, 40)
    const weather = fbm(n, rand, 4, 4)
    const fine = fbm(n, rand, 30, 2, 0.5, 1, 6)
    const tone: number[] = []
    for (let i = 0; i < count; i++) tone.push(0.8 + rand() * 0.4)
    for (let y = 0; y < n; y++) {
        const p = Math.floor(y / ph)
        const ly = y - p * ph
        for (let x = 0; x < n; x++) {
            const i = y * n + x
            if (ly < 2.5 || ly > ph - 2) {
                s.r[i] = 0.05
                s.g[i] = 0.04
                s.b[i] = 0.03
                s.h[i] = 0.1
                continue
            }
            const g = grain[i]!
            const k = tone[p]! * (0.75 + g * 0.55) * (0.9 + fine[i]! * 0.2)
            s.shade(i, k)
            // Sun-bleached to silver where the weather has got at it.
            const silver = smooth(0.5, 0.75, weather[i]!)
            s.tint(i, [0.45, 0.43, 0.39], silver * 0.55)
            s.h[i] = 0.5 + (g - 0.5) * 0.35 + (fine[i]! - 0.5) * 0.2
            s.rough[i] = 0.78 + (g - 0.5) * 0.2
        }
    }
    paintOver(s, (ctx) => {
        for (let i = 0; i < 6; i++) {
            const x = rand() * n
            const y = rand() * n
            tiled(n, x, y, 20, (px, py) => {
                ctx.fillStyle = 'rgba(30,20,10,0.6)'
                ctx.beginPath()
                ctx.ellipse(px, py, 9 + rand() * 6, 4 + rand() * 3, 0, 0, 6.28)
                ctx.fill()
            })
        }
    }, { h: -0.15 })
    return s
}

function bioGrowth(seed: number): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, [0.06, 0.08, 0.07], 0.32, 0.5)
    s.emit = new Float32Array(n * n)
    const n1 = fbm(n, rand, 4, 3)
    const n2 = fbm(n, rand, 7, 3)
    const n3 = fbm(n, rand, 14, 3)
    const lump = fbm(n, rand, 5, 4)
    for (let i = 0; i < n * n; i++) {
        const r1 = 1 - Math.abs(n1[i]! * 2 - 1)
        const r2 = 1 - Math.abs(n2[i]! * 2 - 1)
        const r3 = 1 - Math.abs(n3[i]! * 2 - 1)
        // Sharp ridges of three noise fields read as a branching vein net.
        const vein = Math.max(smooth(0.93, 0.995, r1), smooth(0.945, 0.995, r2) * 0.85, smooth(0.955, 0.998, r3) * 0.55)
        const wet = 0.5 + (lump[i]! - 0.5) * 0.8
        s.shade(i, 0.7 + wet * 0.6)
        s.tint(i, [0.02, 0.2, 0.15], vein * 0.7)
        s.tint(i, [0.14, 0.05, 0.06], smooth(0.55, 0.85, lump[i]!) * 0.35)
        s.h[i] = 0.4 + (lump[i]! - 0.5) * 0.6 + vein * 0.22 + (n3[i]! - 0.5) * 0.12
        s.rough[i] = 0.24 + (1 - wet) * 0.35 - vein * 0.1
        s.emit![i] = vein * (0.55 + n2[i]! * 0.45)
    }
    // Pustules: small glowing nodules where the vein net meets.
    paintOver(s, (ctx) => {
        for (let i = 0; i < 46; i++) {
            const r = 4 + rand() * 9
            const x = rand() * n
            const y = rand() * n
            tiled(n, x, y, r, (px, py) => blot(ctx, px, py, r, 'rgba(40,150,110,A)', 0.9))
        }
    }, { rough: 0.15, h: 0.16 })
    // Mirror the nodules into the emissive mask.
    for (let i = 0; i < n * n; i++) {
        const g = s.g[i]! - s.r[i]!
        if (g > 0.12) s.emit[i] = Math.max(s.emit[i]!, clamp01((g - 0.12) * 4))
    }
    return s
}

function grungePaint(seed: number): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, [0.9, 0.9, 0.9], 0.52, 0.5)
    const dirt = fbm(n, rand, 5, 4)
    const fine = fbm(n, rand, 60, 2)
    const chip = fbm(n, rand, 10, 3)
    for (let i = 0; i < n * n; i++) {
        s.shade(i, 0.86 + (dirt[i]! - 0.5) * 0.28 + (fine[i]! - 0.5) * 0.1)
        s.rough[i] = 0.46 + (dirt[i]! - 0.5) * 0.4
        s.h[i] = 0.5 + (fine[i]! - 0.5) * 0.14
        const bare = smooth(0.7, 0.78, chip[i]! + (fine[i]! - 0.5) * 0.2)
        if (bare > 0) {
            s.tint(i, [0.28, 0.27, 0.26], bare * 0.9)
            s.rough[i] = mix(s.rough[i]!, 0.9, bare)
            s.h[i] = s.h[i]! - bare * 0.1
        }
    }
    paintOver(s, (ctx) => {
        for (let i = 0; i < 70; i++) {
            ctx.strokeStyle = rand() > 0.5 ? `rgba(240,240,235,${0.05 + rand() * 0.1})` : `rgba(20,20,20,${0.06 + rand() * 0.1})`
            ctx.lineWidth = 0.6 + rand() * 1.4
            const x = rand() * n
            const y = rand() * n
            const a = rand() * 6.28
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + Math.cos(a) * (10 + rand() * 40), y + Math.sin(a) * (10 + rand() * 40))
            ctx.stroke()
        }
    })
    return s
}

function cardboard(seed: number): Surf {
    const n = 256
    const rand = makeRng(seed)
    const s = new Surf(n, [0.56, 0.42, 0.27], 0.9, 0.5)
    const fibre = fbm(n, rand, 4, 3, 0.6, 1, 30)
    const dirt = fbm(n, rand, 4, 3)
    for (let i = 0; i < n * n; i++) {
        s.shade(i, 0.84 + fibre[i]! * 0.26 + (dirt[i]! - 0.5) * 0.24)
        s.h[i] = 0.5 + (fibre[i]! - 0.5) * 0.3
    }
    paintOver(s, (ctx) => {
        // Packing tape down the seam, and a shipping label.
        ctx.fillStyle = 'rgba(176,160,132,0.9)'
        ctx.fillRect(n * 0.46, 0, n * 0.08, n)
        ctx.fillStyle = 'rgba(224,222,214,0.95)'
        ctx.fillRect(n * 0.08, n * 0.12, n * 0.3, n * 0.22)
        ctx.fillStyle = 'rgba(30,30,30,0.8)'
        for (let y = 0.16; y < 0.3; y += 0.04) ctx.fillRect(n * 0.11, n * y, n * (0.14 + rand() * 0.1), 3)
        ctx.strokeStyle = 'rgba(40,28,14,0.5)'
        ctx.lineWidth = 3
        ctx.strokeRect(1, 1, n - 2, n - 2)
    }, { rough: 0.55 })
    return s
}

function shrinkWrap(seed: number): Surf {
    const n = 256
    const rand = makeRng(seed)
    const s = new Surf(n, [0.78, 0.84, 0.86], 0.2, 0.5)
    const streak = fbm(n, rand, 3, 4, 0.55, 2, 9)
    const wrinkle = fbm(n, rand, 14, 3)
    for (let i = 0; i < n * n; i++) {
        s.shade(i, 0.78 + streak[i]! * 0.34)
        s.rough[i] = 0.12 + wrinkle[i]! * 0.34
        s.h[i] = 0.5 + (wrinkle[i]! - 0.5) * 0.5 + (streak[i]! - 0.5) * 0.3
    }
    return s
}

function gravel(seed: number): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, [0.2, 0.19, 0.17], 0.95, 0.5)
    const big = fbm(n, rand, 6, 4)
    const fine = fbm(n, rand, 110, 2)
    for (let i = 0; i < n * n; i++) {
        const stone = rand()
        let k = 0.8 + (big[i]! - 0.5) * 0.5 + (fine[i]! - 0.5) * 0.7
        if (stone > 0.94) k += 0.5
        s.shade(i, k)
        s.h[i] = 0.5 + (fine[i]! - 0.5) * 1.1 + (stone > 0.94 ? 0.25 : 0)
        s.rough[i] = 0.9
    }
    return s
}

function hazardStripes(seed: number, dark: Rgb, light: Rgb): Surf {
    const n = 512
    const rand = makeRng(seed)
    const s = new Surf(n, dark, 0.55, 0.5)
    const wear = fbm(n, rand, 6, 4)
    const fine = fbm(n, rand, 60, 2)
    const stripes = 4
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x
            // 45 degree bands that tile: the period divides the tile exactly.
            const t = (((x + y) / n) * stripes) % 1
            const yellow = t < 0.5
            const c = yellow ? light : dark
            s.r[i] = c[0]
            s.g[i] = c[1]
            s.b[i] = c[2]
            const k = 0.78 + (wear[i]! - 0.5) * 0.5 + (fine[i]! - 0.5) * 0.2
            // Paint has worn back to steel in patches.
            const bare = smooth(0.66, 0.76, wear[i]! + (fine[i]! - 0.5) * 0.3)
            s.shade(i, k)
            if (bare > 0) s.tint(i, [0.3, 0.3, 0.3], bare * 0.7)
            s.rough[i] = 0.5 + (wear[i]! - 0.5) * 0.4 + bare * 0.3
            s.h[i] = 0.5 + (fine[i]! - 0.5) * 0.1
        }
    }
    return s
}

function rubber(seed: number): Surf {
    const n = 256
    const rand = makeRng(seed)
    const s = new Surf(n, [0.06, 0.06, 0.065], 0.9, 0.5)
    const fine = fbm(n, rand, 30, 3)
    for (let i = 0; i < n * n; i++) {
        s.shade(i, 0.8 + fine[i]! * 0.5)
        s.h[i] = 0.5 + (fine[i]! - 0.5) * 0.4
    }
    return s
}

const cache = new Map<string, PBRSet>()

/**
 * A PBR set for `kind`, drawn on first use and cached per option combination.
 * The set's textures are owned by the cache: dispose them via `set.textures`.
 */
export function makeSurface(kind: SurfaceKind, opts: SurfaceOptions = {}): PBRSet {
    const key = `${kind}|${opts.base ?? ''}|${opts.accent ?? ''}|${opts.seed ?? 0}`
    const cached = cache.get(key)
    if (cached) return cached
    const seed = (opts.seed ?? 0) * 7919 + kind.length * 131 + kind.charCodeAt(0) * 17
    const base = (fallback: string) => hexRgb(opts.base ?? fallback)
    let set: PBRSet
    switch (kind) {
        case 'epoxy': set = finish(concrete(seed, base('#3d5158'), true), SURFACE_TILE.epoxy, 1.4); break
        case 'concrete': set = finish(concrete(seed, base('#6b6b67'), false), SURFACE_TILE.concrete, 3); break
        case 'asphalt': set = finish(asphalt(seed), SURFACE_TILE.asphalt, 3); break
        case 'tile': set = finish(vinylTile(seed, base('#8a8776')), SURFACE_TILE.tile, 2); break
        case 'diamond': set = finish(diamondPlate(seed, base('#5b5f64')), SURFACE_TILE.diamond, 5); break
        case 'grating': set = finish(grating(seed), SURFACE_TILE.grating, 4); break
        case 'corrugated': set = finish(corrugated(seed, base('#586360'), false), SURFACE_TILE.corrugated, 5); break
        case 'shutter': set = finish(corrugated(seed, base('#6c675c'), true), SURFACE_TILE.shutter, 5); break
        case 'block': set = finish(blockWall(seed, base('#8a8d86')), SURFACE_TILE.block, 4); break
        case 'brick': set = finish(brickWall(seed), SURFACE_TILE.brick, 4); break
        case 'walltile': set = finish(wallTile(seed, base('#a9b0aa')), SURFACE_TILE.walltile, 3); break
        case 'panel': set = finish(metalPanel(seed, base('#8c9491')), SURFACE_TILE.panel, 3); break
        case 'plank': set = finish(planks(seed), SURFACE_TILE.plank, 4); break
        case 'bio': set = finish(bioGrowth(seed), SURFACE_TILE.bio, 4); break
        case 'paint': set = finish(grungePaint(seed), SURFACE_TILE.paint, 2); break
        case 'cardboard': set = finish(cardboard(seed), SURFACE_TILE.cardboard, 1.5); break
        case 'wrap': set = finish(shrinkWrap(seed), SURFACE_TILE.wrap, 2); break
        case 'gravel': set = finish(gravel(seed), SURFACE_TILE.gravel, 5); break
        case 'hazard': set = finish(hazardStripes(seed, base('#1c1b18'), hexRgb(opts.accent ?? '#c99a1c')), SURFACE_TILE.hazard, 2); break
        default: set = finish(rubber(seed), SURFACE_TILE.rubber, 2)
    }
    cache.set(key, set)
    return set
}

// ---------------------------------------------------------------------------
// Decals: an atlas of grime, blood and paint drawn with alpha
// ---------------------------------------------------------------------------

export const DECAL = {
    oil: 0,
    blood: 1,
    tyres: 2,
    soot: 3,
    skid: 4,
    crack: 5,
    puddle: 6,
    goo: 7,
    drag: 8,
    arrow: 9,
    cross: 10,
    rust: 11,
    scorch: 12,
    bioPatch: 13
} as const
export type DecalKind = keyof typeof DECAL

/** UV rectangle [u0, v0, u1, v1] of an atlas cell (4x4), inset a hair to avoid bleeding. */
export function decalRect(cell: number): [number, number, number, number] {
    const col = cell % 4
    const row = Math.floor(cell / 4)
    const e = 0.004
    return [col / 4 + e, 1 - (row + 1) / 4 + e, (col + 1) / 4 - e, 1 - row / 4 - e]
}

let decalTexture: THREE.CanvasTexture | null = null

export function makeDecalAtlas() {
    if (decalTexture) return decalTexture
    const size = 1024
    const cell = size / 4
    const { element, ctx } = canvasOf(size)
    const rand = makeRng(4242)

    const inCell = (index: number, draw: (cx: number, cy: number) => void) => {
        const col = index % 4
        const row = Math.floor(index / 4)
        ctx.save()
        ctx.beginPath()
        ctx.rect(col * cell, row * cell, cell, cell)
        ctx.clip()
        draw(col * cell + cell / 2, row * cell + cell / 2)
        ctx.restore()
    }
    const blob = (cx: number, cy: number, r: number, color: string, count: number, spread: number, alpha: number) => {
        for (let i = 0; i < count; i++) {
            const a = rand() * 6.28
            const d = Math.pow(rand(), 0.7) * spread
            blot(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.3 + rand() * 0.7), color, alpha * (0.5 + rand() * 0.5))
        }
    }

    inCell(DECAL.oil, (cx, cy) => blob(cx, cy, 70, 'rgba(6,5,4,A)', 14, 60, 0.85))
    inCell(DECAL.blood, (cx, cy) => {
        blob(cx, cy, 46, 'rgba(96,8,8,A)', 16, 62, 0.95)
        for (let i = 0; i < 26; i++) {
            const a = rand() * 6.28
            const d = 40 + rand() * 80
            ctx.fillStyle = `rgba(80,6,6,${0.5 + rand() * 0.4})`
            ctx.beginPath()
            ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.5 + rand() * 4, 0, 6.28)
            ctx.fill()
        }
    })
    inCell(DECAL.tyres, (cx, cy) => {
        ctx.strokeStyle = 'rgba(4,4,4,0.6)'
        ctx.lineWidth = 22
        for (const off of [-30, 30]) {
            ctx.beginPath()
            ctx.arc(cx - 150 + off * 0.4, cy + 30, 260 + off, -0.45, 0.45)
            ctx.stroke()
        }
    })
    inCell(DECAL.soot, (cx, cy) => blob(cx, cy, 90, 'rgba(10,9,8,A)', 18, 70, 0.55))
    inCell(DECAL.skid, (cx, cy) => {
        ctx.strokeStyle = 'rgba(3,3,3,0.7)'
        ctx.lineWidth = 12
        ctx.beginPath()
        ctx.moveTo(cx - 118, cy + 8)
        ctx.bezierCurveTo(cx - 40, cy - 12, cx + 40, cy + 20, cx + 118, cy - 6)
        ctx.stroke()
        ctx.lineWidth = 8
        ctx.beginPath()
        ctx.moveTo(cx - 118, cy + 34)
        ctx.bezierCurveTo(cx - 40, cy + 16, cx + 40, cy + 48, cx + 118, cy + 22)
        ctx.stroke()
    })
    inCell(DECAL.crack, (cx, cy) => {
        ctx.strokeStyle = 'rgba(2,2,2,0.85)'
        ctx.lineCap = 'round'
        for (let i = 0; i < 3; i++) crack(ctx, rand, cx, cy, i * 2.1 + rand(), 120, 2.4)
    })
    inCell(DECAL.puddle, (cx, cy) => {
        ctx.save()
        ctx.translate(cx, cy)
        ctx.scale(1.3, 0.85)
        const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 100)
        g.addColorStop(0, 'rgba(12,20,28,0.6)')
        g.addColorStop(0.85, 'rgba(12,20,28,0.5)')
        g.addColorStop(1, 'rgba(12,20,28,0)')
        ctx.fillStyle = g
        ctx.fillRect(-110, -110, 220, 220)
        ctx.restore()
    })
    inCell(DECAL.goo, (cx, cy) => blob(cx, cy, 60, 'rgba(18,54,42,A)', 16, 60, 0.9))
    inCell(DECAL.drag, (cx, cy) => {
        ctx.strokeStyle = 'rgba(86,7,7,0.75)'
        ctx.lineCap = 'round'
        ctx.lineWidth = 28
        ctx.beginPath()
        ctx.moveTo(cx - 100, cy + 40)
        ctx.bezierCurveTo(cx - 40, cy - 30, cx + 20, cy + 50, cx + 104, cy - 20)
        ctx.stroke()
        blob(cx + 90, cy - 16, 40, 'rgba(96,8,8,A)', 6, 24, 0.9)
        ctx.lineWidth = 6
        for (let i = 0; i < 5; i++) {
            ctx.beginPath()
            ctx.moveTo(cx - 90 + i * 34, cy + 30 - i * 8)
            ctx.lineTo(cx - 84 + i * 34 + rand() * 12, cy + 52 + rand() * 20)
            ctx.stroke()
        }
    })
    inCell(DECAL.arrow, (cx, cy) => {
        ctx.fillStyle = 'rgba(214,176,44,0.88)'
        ctx.beginPath()
        ctx.moveTo(cx, cy - 110)
        ctx.lineTo(cx + 70, cy - 20)
        ctx.lineTo(cx + 26, cy - 20)
        ctx.lineTo(cx + 26, cy + 110)
        ctx.lineTo(cx - 26, cy + 110)
        ctx.lineTo(cx - 26, cy - 20)
        ctx.lineTo(cx - 70, cy - 20)
        ctx.closePath()
        ctx.fill()
        // Wear: knock chunks out of the paint.
        ctx.globalCompositeOperation = 'destination-out'
        for (let i = 0; i < 40; i++) {
            ctx.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.6})`
            ctx.fillRect(cx - 80 + rand() * 160, cy - 110 + rand() * 220, 3 + rand() * 12, 2 + rand() * 5)
        }
        ctx.globalCompositeOperation = 'source-over'
    })
    inCell(DECAL.cross, (cx, cy) => {
        ctx.strokeStyle = 'rgba(214,176,44,0.85)'
        ctx.lineWidth = 22
        ctx.strokeRect(cx - 84, cy - 84, 168, 168)
        ctx.beginPath()
        ctx.moveTo(cx - 84, cy - 84)
        ctx.lineTo(cx + 84, cy + 84)
        ctx.moveTo(cx + 84, cy - 84)
        ctx.lineTo(cx - 84, cy + 84)
        ctx.stroke()
        ctx.globalCompositeOperation = 'destination-out'
        for (let i = 0; i < 40; i++) {
            ctx.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.6})`
            ctx.fillRect(cx - 90 + rand() * 180, cy - 90 + rand() * 180, 3 + rand() * 12, 2 + rand() * 5)
        }
        ctx.globalCompositeOperation = 'source-over'
    })
    inCell(DECAL.rust, (cx, cy) => blob(cx, cy, 70, 'rgba(96,46,18,A)', 18, 60, 0.7))
    inCell(DECAL.scorch, (cx, cy) => blob(cx, cy, 100, 'rgba(2,2,2,A)', 8, 30, 0.8))
    inCell(DECAL.bioPatch, (cx, cy) => {
        blob(cx, cy, 70, 'rgba(10,26,22,A)', 12, 60, 0.95)
        ctx.strokeStyle = 'rgba(40,220,160,0.85)'
        ctx.lineCap = 'round'
        for (let i = 0; i < 9; i++) {
            ctx.lineWidth = 1.5 + rand() * 2
            ctx.beginPath()
            const a = rand() * 6.28
            let x = cx + Math.cos(a) * 10
            let y = cy + Math.sin(a) * 10
            ctx.moveTo(x, y)
            let d = a
            for (let s = 0; s < 6; s++) {
                d += (rand() - 0.5) * 1.1
                x += Math.cos(d) * (14 + rand() * 12)
                y += Math.sin(d) * (14 + rand() * 12)
                ctx.lineTo(x, y)
            }
            ctx.stroke()
        }
    })

    decalTexture = new THREE.CanvasTexture(element)
    decalTexture.colorSpace = THREE.SRGBColorSpace
    decalTexture.anisotropy = 8
    decalTexture.wrapS = THREE.ClampToEdgeWrapping
    decalTexture.wrapT = THREE.ClampToEdgeWrapping
    return decalTexture
}

// ---------------------------------------------------------------------------
// Strips: repeating floor paint and wall grime
// ---------------------------------------------------------------------------

/** Worn dashed yellow line. Tiles along U; one tile is 2 m long. */
export function makeLineTexture(color = '#cfa92a') {
    const { element, ctx } = canvasOf(256, 64)
    const rand = makeRng(77)
    ctx.clearRect(0, 0, 256, 64)
    ctx.fillStyle = color
    ctx.fillRect(0, 20, 256, 24)
    ctx.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.3 + rand() * 0.7})`
        ctx.fillRect(rand() * 256, 16 + rand() * 32, 2 + rand() * 9, 1 + rand() * 4)
    }
    ctx.globalCompositeOperation = 'source-over'
    const texture = new THREE.CanvasTexture(element)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return texture
}

/** Diagonal hazard band with worn paint, alpha-cut. U tiles along the band, 1 m per tile. */
export function makeHazardBandTexture() {
    const { element, ctx } = canvasOf(256, 128)
    const rand = makeRng(91)
    ctx.fillStyle = '#c99a1c'
    ctx.fillRect(0, 0, 256, 128)
    ctx.fillStyle = '#17150f'
    ctx.save()
    for (let x = -256; x < 512; x += 64) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x + 32, 0)
        ctx.lineTo(x + 32 + 128, 128)
        ctx.lineTo(x + 128, 128)
        ctx.closePath()
        ctx.fill()
    }
    ctx.restore()
    ctx.strokeStyle = '#0d0c09'
    ctx.lineWidth = 6
    ctx.strokeRect(0, 0, 256, 128)
    ctx.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 320; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.25 + rand() * 0.7})`
        ctx.fillRect(rand() * 256, rand() * 128, 2 + rand() * 10, 1 + rand() * 5)
    }
    ctx.globalCompositeOperation = 'source-over'
    const texture = new THREE.CanvasTexture(element)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return texture
}

/** Vertical soot gradient: opaque at the bottom (v = 0), clear at the top. */
export function makeGrimeTexture() {
    const { element, ctx } = canvasOf(256, 256)
    const rand = makeRng(313)
    const g = ctx.createLinearGradient(0, 256, 0, 0)
    g.addColorStop(0, 'rgba(6,5,4,0.85)')
    g.addColorStop(0.35, 'rgba(6,5,4,0.4)')
    g.addColorStop(1, 'rgba(6,5,4,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
    // Streaky drips reaching up the wall.
    ctx.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 70; i++) {
        const x = rand() * 256
        const h = rand() * 200
        const grad = ctx.createLinearGradient(0, 0, 0, h)
        grad.addColorStop(0, 'rgba(0,0,0,0.55)')
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = grad
        ctx.fillRect(x, 0, 2 + rand() * 6, h)
    }
    const texture = new THREE.CanvasTexture(element)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
}

/** Soft radial falloff for light pools on the floor and glow discs. */
export function makePoolTexture() {
    const { element, ctx } = canvasOf(128)
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.62)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.16)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    const texture = new THREE.CanvasTexture(element)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
}

/** Chain-link mesh, alpha-cut. One tile covers 1 m x 1 m. */
export function makeChainLinkTexture() {
    const { element, ctx } = canvasOf(256)
    ctx.clearRect(0, 0, 256, 256)
    ctx.strokeStyle = 'rgba(150,158,165,0.95)'
    ctx.lineWidth = 3
    const step = 32
    for (let i = -8; i < 16; i++) {
        ctx.beginPath()
        ctx.moveTo(i * step, 0)
        ctx.lineTo(i * step + 256, 256)
        ctx.moveTo(i * step + 256, 0)
        ctx.lineTo(i * step, 256)
        ctx.stroke()
    }
    const texture = new THREE.CanvasTexture(element)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return texture
}

/** Black conifer and broadleaf silhouettes for the distant treeline, alpha-cut. */
export function makeTreelineTexture() {
    const { element, ctx } = canvasOf(2048, 256)
    const rand = makeRng(2718)
    ctx.clearRect(0, 0, 2048, 256)
    ctx.fillStyle = '#04070a'
    // Undergrowth ridge.
    ctx.beginPath()
    ctx.moveTo(0, 256)
    for (let x = 0; x <= 2048; x += 16) ctx.lineTo(x, 256 - 40 - Math.sin(x * 0.011) * 14 - rand() * 12)
    ctx.lineTo(2048, 256)
    ctx.fill()
    for (let x = -20; x < 2068; x += 26 + rand() * 30) {
        const h = 90 + rand() * 130
        const w = 26 + rand() * 30
        for (const shift of [0, x < 60 ? 2048 : x > 1988 ? -2048 : 0]) {
            const bx = x + shift
            if (rand() > 0.35) {
                // Conifer: stacked skirts narrowing to a spire.
                ctx.beginPath()
                ctx.moveTo(bx, 256)
                const tiers = 5 + Math.floor(rand() * 3)
                for (let t = 0; t < tiers; t++) {
                    const y = 256 - (h * (t + 1)) / tiers
                    const half = (w / 2) * (1 - t / (tiers + 0.5))
                    ctx.lineTo(bx - half - 3, y + h / tiers * 0.5)
                    ctx.lineTo(bx - half * 0.35, y + h / tiers * 0.35)
                }
                ctx.lineTo(bx, 256 - h - 8)
                for (let t = tiers - 1; t >= 0; t--) {
                    const y = 256 - (h * (t + 1)) / tiers
                    const half = (w / 2) * (1 - t / (tiers + 0.5))
                    ctx.lineTo(bx + half * 0.35, y + h / tiers * 0.35)
                    ctx.lineTo(bx + half + 3, y + h / tiers * 0.5)
                }
                ctx.lineTo(bx, 256)
                ctx.fill()
            } else {
                // Broadleaf: a lumpy crown on a trunk.
                ctx.fillRect(bx - 2, 256 - h * 0.5, 4, h * 0.5)
                for (let b = 0; b < 7; b++) {
                    ctx.beginPath()
                    ctx.arc(bx + (rand() - 0.5) * w, 256 - h * 0.62 - rand() * h * 0.36, w * (0.34 + rand() * 0.26), 0, 6.28)
                    ctx.fill()
                }
            }
        }
    }
    const texture = new THREE.CanvasTexture(element)
    texture.wrapS = THREE.RepeatWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    return texture
}

/** Stencils for crates, drums and racking: an atlas of 256px cells (4x4). */
export const STENCIL = { fragile: 0, arrows: 1, biohazard: 2, depot: 3, care: 4, barcode: 5, hazardDiamond: 6, flammable: 7, box: 8 } as const
let stencilTexture: THREE.CanvasTexture | null = null

export function makeStencilAtlas() {
    if (stencilTexture) return stencilTexture
    const size = 1024
    const cell = 256
    const { element, ctx } = canvasOf(size)
    const rand = makeRng(555)
    const at = (index: number, draw: () => void) => {
        ctx.save()
        ctx.translate((index % 4) * cell, Math.floor(index / 4) * cell)
        ctx.beginPath()
        ctx.rect(0, 0, cell, cell)
        ctx.clip()
        draw()
        ctx.restore()
    }
    const text = (t: string, x: number, y: number, px: number, color: string) => {
        ctx.fillStyle = color
        ctx.font = `bold ${px}px "Arial Narrow", Arial, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(t, x, y, cell - 24)
    }
    at(STENCIL.fragile, () => {
        text('FRAGILE', 128, 104, 52, '#161513')
        text('THIS SIDE UP', 128, 158, 26, '#161513')
    })
    at(STENCIL.arrows, () => {
        for (const x of [80, 176]) {
            ctx.fillStyle = '#161513'
            ctx.beginPath()
            ctx.moveTo(x, 40)
            ctx.lineTo(x + 34, 96)
            ctx.lineTo(x + 12, 96)
            ctx.lineTo(x + 12, 210)
            ctx.lineTo(x - 12, 210)
            ctx.lineTo(x - 12, 96)
            ctx.lineTo(x - 34, 96)
            ctx.closePath()
            ctx.fill()
        }
    })
    at(STENCIL.biohazard, () => {
        ctx.strokeStyle = '#d9b323'
        ctx.fillStyle = '#d9b323'
        ctx.lineWidth = 10
        for (let i = 0; i < 3; i++) {
            ctx.save()
            ctx.translate(128, 122)
            ctx.rotate((i * Math.PI * 2) / 3)
            ctx.beginPath()
            ctx.arc(0, -46, 34, 0.3, Math.PI * 2 - 0.3)
            ctx.stroke()
            ctx.restore()
        }
        ctx.beginPath()
        ctx.arc(128, 122, 14, 0, 6.28)
        ctx.fill()
        text('XENO-9', 128, 216, 32, '#d9b323')
    })
    at(STENCIL.depot, () => {
        text('DEPOT 9', 128, 110, 62, '#e5e2d8')
        text('LOGISTICS', 128, 168, 28, '#e5e2d8')
    })
    at(STENCIL.care, () => {
        text('HANDLE', 128, 90, 44, '#161513')
        text('WITH CARE', 128, 146, 40, '#161513')
    })
    at(STENCIL.barcode, () => {
        ctx.fillStyle = '#ecebe4'
        ctx.fillRect(28, 60, 200, 130)
        ctx.fillStyle = '#111'
        let x = 40
        while (x < 216) {
            const w = 2 + Math.floor(rand() * 5)
            ctx.fillRect(x, 74, w, 60)
            x += w + 2 + Math.floor(rand() * 4)
        }
        ctx.font = 'bold 20px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(String(Math.floor(1e9 + rand() * 9e9)), 128, 162)
    })
    at(STENCIL.hazardDiamond, () => {
        ctx.save()
        ctx.translate(128, 128)
        ctx.rotate(Math.PI / 4)
        ctx.fillStyle = '#d9b323'
        ctx.fillRect(-72, -72, 144, 144)
        ctx.strokeStyle = '#161513'
        ctx.lineWidth = 8
        ctx.strokeRect(-72, -72, 144, 144)
        ctx.restore()
        text('!', 128, 130, 110, '#161513')
    })
    at(STENCIL.flammable, () => {
        ctx.fillStyle = '#b03a26'
        ctx.fillRect(20, 60, 216, 136)
        text('FLAMMABLE', 128, 128, 36, '#f1e6d2')
    })
    at(STENCIL.box, () => {
        ctx.strokeStyle = 'rgba(20,18,14,0.75)'
        ctx.lineWidth = 8
        ctx.strokeRect(24, 24, 208, 208)
        text('DEPOT 9', 128, 128, 40, 'rgba(20,18,14,0.75)')
    })
    for (let i = 0; i < 3000; i++) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = `rgba(0,0,0,${rand() * 0.4})`
        ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 3, 1 + rand() * 2)
    }
    ctx.globalCompositeOperation = 'source-over'
    stencilTexture = new THREE.CanvasTexture(element)
    stencilTexture.colorSpace = THREE.SRGBColorSpace
    stencilTexture.anisotropy = 8
    return stencilTexture
}

/** Every cached texture the level generators own, for disposal on teardown. */
export function allTextures(): THREE.Texture[] {
    const out: THREE.Texture[] = []
    for (const set of cache.values()) out.push(...set.textures)
    if (decalTexture) out.push(decalTexture)
    if (stencilTexture) out.push(stencilTexture)
    return out
}

export function stencilRect(cell: number): [number, number, number, number] {
    return decalRect(cell)
}

// ---------------------------------------------------------------------------
// Sign atlas
// ---------------------------------------------------------------------------

export interface LabelSpec {
    title: string
    subtitle?: string
    color: string
    background?: string
    accent?: string
}

/**
 * Many text panels in one canvas so every sign in the level shares a draw call.
 * Cells are 512x192 laid out two across; `rect(i)` gives the UV rectangle.
 */
export function makeLabelAtlas(labels: LabelSpec[]) {
    const cw = 512
    const ch = 192
    const cols = 2
    const rows = Math.max(1, Math.ceil(labels.length / cols))
    const { element, ctx } = canvasOf(cw * cols, ch * rows)
    labels.forEach((label, index) => {
        const ox = (index % cols) * cw
        const oy = Math.floor(index / cols) * ch
        ctx.save()
        ctx.translate(ox, oy)
        if (label.background) {
            ctx.fillStyle = label.background
            ctx.fillRect(0, 0, cw, ch)
        }
        if (label.accent) {
            ctx.strokeStyle = label.accent
            ctx.lineWidth = 8
            ctx.strokeRect(6, 6, cw - 12, ch - 12)
        }
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = label.color
        ctx.font = 'bold 76px "Arial Narrow", "Courier New", monospace'
        ctx.fillText(label.title.toUpperCase(), cw / 2, label.subtitle ? 68 : ch / 2, cw - 40)
        if (label.subtitle) {
            ctx.font = 'bold 46px "Arial Narrow", "Courier New", monospace'
            ctx.fillStyle = label.accent ?? label.color
            ctx.fillText(label.subtitle.toUpperCase(), cw / 2, 138, cw - 40)
        }
        ctx.restore()
    })
    const texture = new THREE.CanvasTexture(element)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    const totalH = ch * rows
    return {
        texture,
        rect(index: number): [number, number, number, number] {
            const col = index % cols
            const row = Math.floor(index / cols)
            return [(col * cw + 2) / (cw * cols), 1 - ((row + 1) * ch - 2) / totalH, ((col + 1) * cw - 2) / (cw * cols), 1 - (row * ch + 2) / totalH]
        }
    }
}

// ---------------------------------------------------------------------------
// Legacy exports — the rest of the game still imports these by name.
// ---------------------------------------------------------------------------

function legacy(set: PBRSet, repeatX: number, repeatY: number) {
    // Only the albedo is handed back; the caller repeats it per UV like before.
    // A clone, so repeating it does not rescale the cached set other meshes use.
    const map = set.map.clone()
    map.repeat.set(repeatX, repeatY)
    map.needsUpdate = true
    return map
}

/** Poured concrete in big slabs. */
export function makeFloorTexture(base: string, _line: string, _accent: string, repeat = 6) {
    return legacy(makeSurface('concrete', { base }), repeat, repeat)
}

/** Painted block wall. */
export function makeWallTexture(base: string, _panel: string, _accent: string) {
    return legacy(makeSurface('block', { base }), 3, 1.5)
}

/** Ribbed soffit. */
export function makeCeilingTexture(_base: string, _vent: string) {
    return legacy(makeSurface('panel'), 6, 6)
}

/** Diamond plate — decking, stair treads and machinery casings. */
export function makeMetalTexture(base = '#5b5f64', _line = '#3a3d41', _rivet = '#5e6266') {
    return legacy(makeSurface('diamond', { base }), 4, 4)
}

/** Weathered timber, for boards nailed across windows and doors. */
export function makePlankTexture() {
    return makeSurface('plank').map
}

/** Gravel and dirt for the ground outside the shell. */
export function makeDirtTexture() {
    return legacy(makeSurface('gravel'), 24, 24)
}

/** Diagonal hazard stripes for barriers. */
export function makeHazardTexture(dark = '#1c1b18', light = '#c99a1c') {
    return makeSurface('hazard', { base: dark, accent: light }).map
}

/**
 * A text panel — used for wall-buy price boards, perk signage and the
 * Pack-a-Punch marquee. Returns a transparent texture sized 512x256.
 */
export function makeSignTexture(opts: {
    title: string
    subtitle?: string
    color: string
    background?: string
    accent?: string
}) {
    const element = document.createElement('canvas')
    element.width = 512
    element.height = 256
    const ctx = element.getContext('2d')!

    if (opts.background) {
        ctx.fillStyle = opts.background
        ctx.fillRect(0, 0, 512, 256)
    }
    if (opts.accent) {
        ctx.strokeStyle = opts.accent
        ctx.lineWidth = 10
        ctx.strokeRect(5, 5, 502, 246)
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = opts.color
    ctx.font = 'bold 72px "Courier New", monospace'
    ctx.fillText(opts.title.toUpperCase(), 256, opts.subtitle ? 100 : 128, 470)

    if (opts.subtitle) {
        ctx.font = 'bold 56px "Courier New", monospace'
        ctx.fillStyle = opts.accent ?? opts.color
        ctx.fillText(opts.subtitle.toUpperCase(), 256, 180, 470)
    }

    const texture = new THREE.CanvasTexture(element)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
}

/** Soft round particle — smoke, blood, sparks, the muzzle glow. */
export function makeDotTexture() {
    const { element, ctx } = canvasOf(64)
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.55)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
    const texture = new THREE.CanvasTexture(element)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
}

/** Four-spoke muzzle flash star. */
export function makeFlashTexture() {
    const { element, ctx } = canvasOf(128)
    ctx.translate(64, 64)
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 60)
    gradient.addColorStop(0, 'rgba(255,255,235,1)')
    gradient.addColorStop(0.25, 'rgba(255,205,110,0.85)')
    gradient.addColorStop(1, 'rgba(255,150,40,0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(0, 0, 60, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = 'rgba(255,235,180,0.9)'
    for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2)
        ctx.beginPath()
        ctx.moveTo(0, -8)
        ctx.lineTo(62, 0)
        ctx.lineTo(0, 8)
        ctx.closePath()
        ctx.fill()
    }
    const texture = new THREE.CanvasTexture(element)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
}

/** Irregular splat used for both blood on the floor and scorch on the walls. */
export function makeSplatTexture(color: string) {
    const { element, ctx } = canvasOf(128)
    ctx.clearRect(0, 0, 128, 128)
    ctx.fillStyle = color
    for (let i = 0; i < 22; i++) {
        const angle = Math.random() * Math.PI * 2
        const dist = Math.random() * 42
        const radius = 6 + Math.random() * 18
        ctx.globalAlpha = 0.35 + Math.random() * 0.5
        ctx.beginPath()
        ctx.arc(64 + Math.cos(angle) * dist, 64 + Math.sin(angle) * dist, radius, 0, Math.PI * 2)
        ctx.fill()
    }
    ctx.globalAlpha = 1
    const texture = new THREE.CanvasTexture(element)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
}
