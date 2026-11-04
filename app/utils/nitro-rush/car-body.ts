import * as THREE from 'three'
import { WHEELBASE } from './config'

/** The car's body as one lofted surface; a spot on it is (u, s): metres forward of the middle, and metres along the section from the centreline, negative on the left. */

export const AXLE_U = WHEELBASE / 2
export const WHEEL_R = 0.37
export const ARCH_R = 0.43
export const ARCH_Y = WHEEL_R - 0.01
export const NOSE_U = 2.58
export const TAIL_U = -2.46
/** The most s the skin reaches; the livery canvas is sized from it. */
export const MAX_S = 1.9

/** One keyframe: u, centreline height, then (x, y) of roof edge, valley, fender crest, widest point and sill. */
type Row = [number, number, number, number, number, number, number, number, number, number, number, number]

const ROWS: Row[] = [
    [NOSE_U, 0.31, 0.006, 0.309, 0.012, 0.304, 0.017, 0.296, 0.02, 0.285, 0.017, 0.27],
    [2.565, 0.325, 0.04, 0.323, 0.08, 0.315, 0.11, 0.3, 0.13, 0.282, 0.115, 0.258],
    [2.5, 0.385, 0.1, 0.382, 0.18, 0.366, 0.245, 0.34, 0.29, 0.302, 0.26, 0.264],
    [2.4, 0.435, 0.16, 0.43, 0.29, 0.412, 0.385, 0.383, 0.45, 0.338, 0.415, 0.31],
    [2.25, 0.485, 0.2, 0.48, 0.38, 0.468, 0.52, 0.452, 0.61, 0.385, 0.57, 0.34],
    [2.05, 0.545, 0.24, 0.542, 0.46, 0.54, 0.66, 0.54, 0.795, 0.425, 0.77, 0.31],
    [1.85, 0.6, 0.26, 0.598, 0.48, 0.62, 0.72, 0.73, 0.92, 0.56, 0.9, 0.27],
    [1.6, 0.645, 0.26, 0.645, 0.48, 0.68, 0.74, 0.86, 0.97, 0.64, 0.95, 0.26],
    [AXLE_U, 0.68, 0.26, 0.68, 0.48, 0.72, 0.76, 0.93, 0.99, 0.7, 0.965, 0.25],
    [1.15, 0.74, 0.26, 0.742, 0.48, 0.78, 0.76, 0.93, 0.98, 0.68, 0.94, 0.24],
    [0.88, 0.815, 0.3, 0.815, 0.52, 0.84, 0.76, 0.89, 0.94, 0.62, 0.89, 0.23],
    [0.55, 0.95, 0.36, 0.925, 0.66, 0.83, 0.79, 0.79, 0.91, 0.58, 0.87, 0.22],
    [0.25, 1.075, 0.4, 1.03, 0.65, 0.875, 0.8, 0.75, 0.9, 0.55, 0.86, 0.22],
    [-0.1, 1.14, 0.42, 1.09, 0.645, 0.905, 0.815, 0.745, 0.9, 0.54, 0.86, 0.22],
    [-0.5, 1.125, 0.41, 1.08, 0.665, 0.905, 0.84, 0.77, 0.925, 0.54, 0.87, 0.22],
    [-0.9, 1.065, 0.38, 1.03, 0.66, 0.905, 0.875, 0.825, 0.965, 0.56, 0.91, 0.24],
    [-1.2, 1.015, 0.36, 0.992, 0.66, 0.95, 0.89, 0.93, 1.0, 0.66, 0.96, 0.26],
    [-AXLE_U, 0.99, 0.34, 0.98, 0.66, 0.98, 0.9, 0.96, 1.02, 0.7, 0.99, 0.28],
    [-1.7, 0.97, 0.34, 0.965, 0.66, 0.97, 0.89, 0.95, 1.01, 0.7, 0.98, 0.3],
    [-2.0, 0.955, 0.34, 0.95, 0.64, 0.935, 0.85, 0.89, 0.97, 0.65, 0.93, 0.32],
    [-2.25, 0.93, 0.32, 0.925, 0.58, 0.91, 0.77, 0.87, 0.87, 0.68, 0.85, 0.34],
    [-2.38, 0.89, 0.28, 0.885, 0.5, 0.87, 0.66, 0.83, 0.75, 0.66, 0.75, 0.36],
    [TAIL_U, 0.8, 0.22, 0.797, 0.4, 0.785, 0.52, 0.76, 0.62, 0.62, 0.64, 0.38]
]

/** A monotone cubic through the points, so keyframes never overshoot into ripples. */
export function monotone(xs: number[], ys: number[]) {
    const n = xs.length
    const d = xs.slice(1).map((x, i) => (ys[i + 1]! - ys[i]!) / (x - xs[i]!))
    const m = xs.map((_, i) => {
        if (i === 0) return d[0]!
        if (i === n - 1) return d[n - 2]!
        const a = d[i - 1]!
        const b = d[i]!
        if (a * b <= 0) return 0
        const h0 = xs[i]! - xs[i - 1]!
        const h1 = xs[i + 1]! - xs[i]!
        const w1 = 2 * h1 + h0
        const w2 = h1 + 2 * h0
        return (w1 + w2) / (w1 / a + w2 / b)
    })
    return (x: number) => {
        if (x <= xs[0]!) return ys[0]!
        if (x >= xs[n - 1]!) return ys[n - 1]!
        let i = 0
        while (x > xs[i + 1]!) i++
        const h = xs[i + 1]! - xs[i]!
        const t = (x - xs[i]!) / h
        const t2 = t * t
        const t3 = t2 * t
        return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!
    }
}

/** A boundary curve in (u, value), for shaping patches. */
export const curve = (pts: [number, number][]) => {
    const sorted = [...pts].sort((a, b) => a[0] - b[0])
    return monotone(sorted.map(p => p[0]), sorted.map(p => p[1]))
}

const SAMPLES_PER_SPAN = 16
const NORMAL_EPS = 0.012

interface Section {
    x: Float64Array
    y: Float64Array
    len: Float64Array
    total: number
}

const rows = [...ROWS].sort((a, b) => a[0] - b[0])
const channels = rows[0]!.slice(1).map((_, c) => monotone(rows.map(r => r[0]), rows.map(r => r[c + 1]!)))

function buildSection(u: number): Section {
    const v = channels.map(f => f(u))
    const ctrl = [new THREE.Vector3(0, v[0]!, 0)]
    for (let i = 1; i < v.length; i += 2) ctrl.push(new THREE.Vector3(v[i]!, v[i + 1]!, 0))
    const last = ctrl[ctrl.length - 1]!
    const before = ctrl[ctrl.length - 2]!
    // Phantom ends keep the curve square across the centreline and running on past the sill.
    const curve3 = new THREE.CatmullRomCurve3([new THREE.Vector3(-ctrl[1]!.x, ctrl[1]!.y, 0), ...ctrl, last.clone().multiplyScalar(2).sub(before)], false, 'centripetal')
    const spans = ctrl.length - 1
    const n = spans * SAMPLES_PER_SPAN + 1
    const x = new Float64Array(n)
    const y = new Float64Array(n)
    const len = new Float64Array(n)
    const p = new THREE.Vector3()
    const count = ctrl.length + 1
    for (let i = 0; i < n; i++) {
        curve3.getPoint((1 + i / SAMPLES_PER_SPAN) / count, p)
        x[i] = i === 0 ? 0 : p.x
        y[i] = p.y
        if (i > 0) len[i] = len[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, y[i]! - y[i - 1]!)
    }
    return { x, y, len, total: len[n - 1]! }
}

/** Height of a wheel arch's edge at u, or -Infinity away from the arches. */
export function archEdge(u: number) {
    for (const c of [-AXLE_U, AXLE_U]) {
        const d = u - c
        if (Math.abs(d) < ARCH_R) return ARCH_Y + Math.sqrt(ARCH_R * ARCH_R - d * d)
    }
    return -Infinity
}

const inArch = (u: number) => archEdge(u) > -Infinity

/** The body surface; sections are built on demand and kept for this one build. */
export class BodySurface {
    private readonly cache = new Map<number, Section>()
    private readonly a = new THREE.Vector3()
    private readonly b = new THREE.Vector3()
    private readonly c = new THREE.Vector3()
    private readonly d = new THREE.Vector3()

    private section(u: number) {
        const key = Math.round(u * 1e4)
        let s = this.cache.get(key)
        if (!s) {
            s = buildSection(u)
            this.cache.set(key, s)
        }
        return s
    }

    /** The spot at (u, s) in model space, nose toward -z. */
    point(u: number, s: number, out = new THREE.Vector3()) {
        const sec = this.section(u)
        const at = Math.min(Math.abs(s), sec.total)
        let lo = 0
        let hi = sec.len.length - 1
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1
            if (sec.len[mid]! <= at) lo = mid
            else hi = mid
        }
        const span = sec.len[hi]! - sec.len[lo]!
        const t = span > 0 ? (at - sec.len[lo]!) / span : 0
        const x = sec.x[lo]! + (sec.x[hi]! - sec.x[lo]!) * t
        return out.set(s < 0 ? -x : x, sec.y[lo]! + (sec.y[hi]! - sec.y[lo]!) * t, -u)
    }

    /** The outward normal at (u, s), measured off the surface so shading never shows the mesh. */
    normal(u: number, s: number, out = new THREE.Vector3()) {
        const du = this.point(Math.min(NOSE_U, u + NORMAL_EPS), s, this.a).sub(this.point(Math.max(TAIL_U, u - NORMAL_EPS), s, this.b))
        const ds = this.point(u, s + NORMAL_EPS, this.c).sub(this.point(u, s - NORMAL_EPS, this.d))
        out.crossVectors(ds, du)
        if (out.lengthSq() < 1e-14) return out.set(0, 1, 0)
        return out.normalize()
    }

    /** The s at which the section first reaches half-width x, going out from the centreline. */
    sAtX(u: number, x: number) {
        const sec = this.section(u)
        for (let i = 1; i < sec.x.length; i++) {
            if (sec.x[i]! >= x) {
                const t = (x - sec.x[i - 1]!) / (sec.x[i]! - sec.x[i - 1]! || 1)
                return sec.len[i - 1]! + (sec.len[i]! - sec.len[i - 1]!) * t
            }
        }
        return sec.total
    }

    /** The s at which the section reaches height y, coming up from the sill. */
    sAtY(u: number, y: number) {
        const sec = this.section(u)
        const n = sec.y.length
        if (sec.y[n - 1]! >= y) return sec.total
        for (let i = n - 2; i >= 0; i--) {
            if (sec.y[i]! >= y) {
                const t = (y - sec.y[i + 1]!) / (sec.y[i]! - sec.y[i + 1]! || 1)
                return sec.len[i + 1]! + (sec.len[i]! - sec.len[i + 1]!) * t
            }
        }
        return 0
    }

    /** Where the skin stops at u: the sill, or the edge of a wheel arch. */
    cutAt(u: number) {
        const edge = archEdge(u)
        const total = this.section(u).total
        return edge > -Infinity ? Math.min(total, this.sAtY(u, edge)) : total
    }
}

/** Stations along the car, packed around the arches so their edges come out round. */
export function skinStations(step = 0.055) {
    const us = new Set<number>()
    for (let u = TAIL_U; u < NOSE_U; u += step) us.add(u)
    us.add(NOSE_U)
    // The blunt nose closes over its last few centimetres.
    for (const d of [0.005, 0.012, 0.022, 0.035]) us.add(NOSE_U - d)
    for (const c of [-AXLE_U, AXLE_U]) {
        for (let i = 0; i <= 18; i++) us.add(c + ARCH_R * Math.cos(i / 18 * Math.PI) * 0.9999)
        // The edge steps down to the sill just outside the arch.
        us.add(c - ARCH_R - 1e-3)
        us.add(c + ARCH_R + 1e-3)
    }
    return [...us].sort((a, b) => a - b)
}

/** Triangles for a grid laid out row by row. */
function gridIndex(rows: number, cols: number) {
    const index: number[] = []
    for (let i = 0; i < rows - 1; i++) {
        for (let j = 0; j < cols - 1; j++) {
            const a = i * cols + j
            const c = a + cols
            index.push(a, a + 1, c, a + 1, c + 1, c)
        }
    }
    return index
}

/** Grid columns from the centreline to the sill, per side. */
const SKIN_COLUMNS = 30

/** The painted skin, with its uv unrolled from above: x along the car, y across it at a constant scale. */
export function buildSkin(surface: BodySurface) {
    const us = skinStations()
    const cols = SKIN_COLUMNS * 2 + 1
    const pos = new Float32Array(us.length * cols * 3)
    const nor = new Float32Array(us.length * cols * 3)
    const uv = new Float32Array(us.length * cols * 2)
    const p = new THREE.Vector3()
    const n = new THREE.Vector3()
    let k = 0
    for (const u of us) {
        const cut = surface.cutAt(u)
        for (let j = -SKIN_COLUMNS; j <= SKIN_COLUMNS; j++) {
            const s = cut * j / SKIN_COLUMNS
            surface.point(u, s, p)
            surface.normal(u, s, n)
            pos.set([p.x, p.y, p.z], k * 3)
            nor.set([n.x, n.y, n.z], k * 3)
            uv.set([(u - TAIL_U) / (NOSE_U - TAIL_U), 0.5 - s / (2 * MAX_S)], k * 2)
            k++
        }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setIndex(gridIndex(us.length, cols))
    return g
}

/** s as a function of u: one edge of a patch on the skin. */
export type Edge = (u: number) => number

export interface PatchOptions {
    nu?: number
    nv?: number
    /** Lift off the skin, so the patch doesn't fight it for depth. */
    lift?: number
    /** Texture coordinates from the place on the patch (`a` along u, `b` from `lo` to `hi`, both 0 to 1); metres on the car by default. */
    uv?: (a: number, b: number, u: number, s: number) => [number, number]
}

/** A panel lying on the skin between two edges: glass, vents, decals. */
export function surfacePatch(surface: BodySurface, u0: number, u1: number, lo: Edge, hi: Edge, opts: PatchOptions = {}) {
    const nu = opts.nu ?? 28
    const nv = opts.nv ?? 12
    const lift = opts.lift ?? 0.005
    const pos: number[] = []
    const nor: number[] = []
    const uv: number[] = []
    const p = new THREE.Vector3()
    const n = new THREE.Vector3()
    for (let i = 0; i <= nu; i++) {
        const a = i / nu
        const u = u0 + (u1 - u0) * a
        const l = lo(u)
        const h = hi(u)
        for (let j = 0; j <= nv; j++) {
            const b = j / nv
            const s = l + (h - l) * b
            surface.point(u, s, p)
            surface.normal(u, s, n)
            pos.push(p.x + n.x * lift, p.y + n.y * lift, p.z + n.z * lift)
            nor.push(n.x, n.y, n.z)
            const t = opts.uv ? opts.uv(a, b, u, s) : [u, s]
            uv.push(t[0]!, t[1]!)
        }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(gridIndex(nu + 1, nv + 1))
    return g
}

/** Flat quads, each turned to face the way asked, for the dark parts nobody sees closely. */
class Quads {
    private readonly pos: number[] = []
    private readonly nor: number[] = []
    private readonly e1 = new THREE.Vector3()
    private readonly e2 = new THREE.Vector3()
    private readonly n = new THREE.Vector3()

    add(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, facing: THREE.Vector3) {
        this.n.crossVectors(this.e1.subVectors(b, a), this.e2.subVectors(c, a))
        if (this.n.lengthSq() < 1e-14) this.n.crossVectors(this.e1.subVectors(c, a), this.e2.subVectors(d, a))
        const flip = this.n.dot(facing) < 0
        const order = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d]
        for (const v of order) {
            this.pos.push(v.x, v.y, v.z)
            this.nor.push(facing.x, facing.y, facing.z)
        }
    }

    build() {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
        return g
    }
}

/** Half-width of the box the wheel tubs are cut from. */
export const TUB_X = 0.62
const FLOOR_Y = 0.15

/** The dark underside: belly pan out to the skin's edge, and a liner in each arch so the wheels sit in shadow. */
export function buildUnderbody(surface: BodySurface) {
    const q = new Quads()
    const down = new THREE.Vector3(0, -1, 0)
    const edge = (u: number, side: number) => {
        if (inArch(u)) return new THREE.Vector3(side * TUB_X, ARCH_Y - 0.2, -u)
        return surface.point(u, side * surface.cutAt(u))
    }
    const us = skinStations(0.12)
    for (let i = 0; i < us.length - 1; i++) {
        const a = us[i]!
        const b = us[i + 1]!
        for (const side of [-1, 1]) {
            q.add(edge(a, side), new THREE.Vector3(0, FLOOR_Y, -a), new THREE.Vector3(0, FLOOR_Y, -b), edge(b, side), down)
        }
    }
    const steps = 24
    const facing = new THREE.Vector3()
    for (const c of [-AXLE_U, AXLE_U]) {
        for (const side of [-1, 1]) {
            const rim = (t: number) => {
                const ang = t * Math.PI
                const u = c + ARCH_R * Math.cos(ang) * 0.9999
                return { u, y: ARCH_Y + ARCH_R * Math.sin(ang) * 0.9999 }
            }
            for (let i = 0; i < steps; i++) {
                const p0 = rim(i / steps)
                const p1 = rim((i + 1) / steps)
                const outer0 = surface.point(p0.u, side * surface.cutAt(p0.u))
                const outer1 = surface.point(p1.u, side * surface.cutAt(p1.u))
                const inner0 = new THREE.Vector3(side * TUB_X, p0.y, -p0.u)
                const inner1 = new THREE.Vector3(side * TUB_X, p1.y, -p1.u)
                facing.set(0, ARCH_Y - (p0.y + p1.y) / 2, (p0.u + p1.u) / 2 - c).normalize()
                q.add(outer0, outer1, inner1, inner0, facing)
            }
        }
    }
    return q.build()
}

/** The flat rear face closing the skin, set in behind its last section. */
export function buildTailFace(surface: BodySurface) {
    const q = new Quads()
    const u = TAIL_U
    const cut = surface.cutAt(u)
    const back = new THREE.Vector3(0, 0, 1)
    const centre = new THREE.Vector3(0, 0.55, -u)
    const n = 24
    for (let i = 0; i < n; i++) {
        const a = surface.point(u, -cut + 2 * cut * i / n)
        const b = surface.point(u, -cut + 2 * cut * (i + 1) / n)
        q.add(a, b, centre, centre, back)
    }
    // The bottom edge, from sill to sill.
    const l = surface.point(u, -cut)
    const r = surface.point(u, cut)
    q.add(l, r, centre, centre, back)
    return q.build()
}
