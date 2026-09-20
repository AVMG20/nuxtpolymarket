// Void Runner — the Eclipse Harbinger: an obsidian ring ship built around a caged singularity.

import * as THREE from 'three'
import { ModelBuilder, cyl, ico, mulberry32, octa, ring, tube, type Vec3 } from './models'
import { loft, slab, block, dish, type Livery } from './ship-kit'
import type { CapitalModel, CapitalMount } from './capital-models'

// Obsidian plate in five shades, gunmetal and bone so the shape reads against
// black space, and cold violet ports.
const O_VOID = 0x0e0c14
const O_DEEP = 0x16141d
const O_DARK = 0x1f1c28
const O_PLATE = 0x2a2734
const O_LIGHT = 0x3a3546
const O_METAL = 0x4b4959
const GUNMETAL = 0x6a6878
const BONE = 0xb9b2a4
const VIOLET = 0xa98cff
const PALE = 0xe2d9ff
const AMBER = 0xffd9a0

const STATOR_R = 40
const STATOR_Z = 4
const INNER_R = 31
const INNER_Z = -3
const OUTER_R = 47
const OUTER_Z = 15
const OUTER_SCALE = 1.25
const CORE_R = 5
const CORE_Z = 4
const TAU = Math.PI * 2

type Pt = [number, number]
const ONE: Vec3 = [1, 1, 1]
const FLAT: Vec3 = [0, 0, 0]
const rad = (deg: number) => deg * Math.PI / 180
const smooth = (t: number) => t * t * (3 - 2 * t)

const livery = (glow: number): Livery => ({ paint: O_PLATE, paint2: O_DARK, trim: O_DARK, metal: O_METAL, accent: BONE, glow, glass: 0x0a0814 })

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)

/** A slab stood up to face down Z: the outline is (x, y). */
function wall(points: Pt[], thickness: number, bevel = 0.03) {
    return slab(points, thickness, bevel).rotateX(-Math.PI / 2)
}

/** A slab stood on edge along the keel line: the outline is (y, z). */
function fin(points: Pt[], thickness: number, bevel = 0.02) {
    return slab(points, thickness, bevel).rotateZ(Math.PI / 2)
}

/** A thin glowing slit. */
function slit(b: ModelBuilder, glow: number, pos: Vec3, size: Vec3, intensity = 2.4, mirror = false, rot: Vec3 = FLAT) {
    b.glow(box(...size), glow, intensity, pos, rot, ONE, mirror)
}

/** A panel seam or recess: a black inlay standing a hair proud of the plate. */
function groove(b: ModelBuilder, pos: Vec3, size: Vec3, mirror = false, rot: Vec3 = FLAT) {
    b.metal(box(...size), 0x08070b, pos, rot, ONE, mirror)
}

/** An engine block: an armoured octagonal housing with a collar and cooling fins, ending in a nozzle. */
function drive(b: ModelBuilder, glow: number, pos: Vec3, r: number, mirror = false, color = O_DARK) {
    const [x, y, z] = pos
    b.solid(loft([
        { z: z - r * 2.8, w: r * 0.8, h: r * 0.8, x, y },
        { z: z - r * 1.9, w: r * 1.38, h: r * 1.32, x, y },
        { z: z + r * 0.15, w: r * 1.45, h: r * 1.38, x, y }
    ], 8, 0.6, Math.PI / 8), color, FLAT, FLAT, ONE, mirror)
    b.metal(ring(r * 1.5, r * 0.13, 4, 8), O_METAL, [x, y, z - r * 0.7], [0, 0, Math.PI / 8], ONE, mirror)
    for (const i of [-1, 0, 1]) b.metal(box(r * 0.1, r * 0.45, r * 1.5), GUNMETAL, [x + i * r * 0.55, y + Math.sign(y || 1) * r * 1.4, z - r * 0.9], FLAT, ONE, mirror)
    b.metal(tube(r * 1.32, r * 1.55, r * 1.1, 14), O_VOID, [x, y, z + r * 0.15], FLAT, ONE, mirror)
    b.glow(ring(r * 1.36, r * 0.05, 3, 20), glow, 2.2, [x, y, z + r * 0.74], FLAT, ONE, mirror)
    b.engine(pos, r, mirror, glow)
}

// ─── Ring geometry ─────────────────────────────────────────────────────────

/** How an arc's section changes along its sweep: a scale and a radial shift at `t` in 0..1. */
type Shape = (t: number) => [number, number]

/**
 * Sweeps a closed (radial, z) outline around the ship's axis between two clock
 * angles: 12 o'clock is +Y and 3 o'clock is +X. The outline runs anticlockwise
 * and is given relative to the radius R.
 */
function hoop(R: number, outline: Pt[], a0 = 0, a1 = TAU, steps = 96, shape?: Shape) {
    const n = outline.length
    const pos: number[] = []
    const at = (i: number, j: number): Vec3 => {
        const t = i / steps
        const a = a0 + (a1 - a0) * t
        const [k, dr] = shape ? shape(t) : [1, 0]
        const p = outline[j % n]!
        const r = R + dr + p[0] * k
        return [r * Math.sin(a), r * Math.cos(a), p[1] * k]
    }
    const centre = (i: number): Vec3 => {
        const c: Vec3 = [0, 0, 0]
        for (let j = 0; j < n; j++) {
            const p = at(i, j)
            c[0] += p[0] / n
            c[1] += p[1] / n
            c[2] += p[2] / n
        }
        return c
    }
    for (let i = 0; i < steps; i++) {
        for (let j = 0; j < n; j++) {
            const a = at(i, j)
            const c = at(i, j + 1)
            const d = at(i + 1, j)
            const e = at(i + 1, j + 1)
            pos.push(...a, ...c, ...d, ...c, ...e, ...d)
        }
    }
    if (a1 - a0 < TAU - 1e-6) {
        const c0 = centre(0)
        const c1 = centre(steps)
        for (let j = 0; j < n; j++) {
            pos.push(...c0, ...at(0, j + 1), ...at(0, j))
            pos.push(...c1, ...at(steps, j), ...at(steps, j + 1))
        }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
}

/** A chamfered rectangular section, `w` radial by `d` deep. */
function rect(w: number, d: number, c = 0): Pt[] {
    const hw = w / 2
    const hd = d / 2
    if (!c) return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
    return [[-hw + c, -hd], [hw - c, -hd], [hw, -hd + c], [hw, hd - c], [hw - c, hd], [-hw + c, hd], [-hw, hd - c], [-hw, -hd + c]]
}

const rectAt = (r0: number, r1: number, z0: number, z1: number): Pt[] => [[r0, z0], [r1, z0], [r1, z1], [r0, z1]]
const flipR = (o: Pt[]): Pt[] => o.map(([r, z]): Pt => [-r, z]).reverse()
const grow = (o: Pt[], k: number): Pt[] => o.map(([r, z]): Pt => [r * k, z * k])

/** A strip lying on one face of an outline: between corners `i` and `i + 1`, centred at `f` along it. */
function inlay(o: Pt[], i: number, f: number, halfLength: number, halfThick: number, lift = 0): Pt[] {
    const p = o[i % o.length]!
    const q = o[(i + 1) % o.length]!
    const len = Math.hypot(q[0] - p[0], q[1] - p[1])
    const t: Pt = [(q[0] - p[0]) / len, (q[1] - p[1]) / len]
    const nrm: Pt = [t[1], -t[0]]
    const c: Pt = [p[0] + (q[0] - p[0]) * f + nrm[0] * lift, p[1] + (q[1] - p[1]) * f + nrm[1] * lift]
    const pt = (s: number, v: number): Pt => [c[0] + t[0] * s * halfLength + nrm[0] * v * halfThick, c[1] + t[1] * s * halfLength + nrm[1] * v * halfThick]
    return [pt(-1, -1), pt(-1, 1), pt(1, 1), pt(1, -1)]
}

/** A place on the ring: u runs with the clock, v is up out of the surface, w is aft before the tilt. */
interface Frame {
    at: (u: number, v: number, w: number) => Vec3
    rot: Vec3
    /** Tips a part built Y-up into the frame. */
    tip: <G extends THREE.BufferGeometry>(geo: G) => G
    up: Vec3
}

function ringFrame(a: number, r: number, z: number, tilt = 0, drop = 0): Frame {
    const s = Math.sin(a)
    const c = Math.cos(a)
    const st = Math.sin(tilt)
    const ct = Math.cos(tilt)
    return {
        at: (u, v, w) => {
            const y = r + v * ct - w * st
            return [y * s + u * c, y * c - u * s - drop, z + v * st + w * ct]
        },
        rot: [0, 0, -a],
        tip: geo => geo.rotateX(tilt),
        up: [ct * s, ct * c, st]
    }
}

/** Lays a part built along +Z from the origin onto the line from `from` to `to`; its Y axis keeps to the ship's Z. */
function along<G extends THREE.BufferGeometry>(geo: G, from: Vec3, to: Vec3) {
    const z = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize()
    const ref = Math.abs(z.z) > 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
    const y = ref.addScaledVector(z, -ref.dot(z)).normalize()
    const x = new THREE.Vector3().crossVectors(y, z)
    return geo.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z).setPosition(from[0], from[1], from[2]))
}

const distance = (p: Vec3, q: Vec3) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])

/** A tapering spar between two points. */
function spar(from: Vec3, to: Vec3, r0: number, r1: number, sides = 5, deep = 1) {
    return along(loft([{ z: 0, w: r0, h: r0 * deep }, { z: distance(from, to), w: r1, h: r1 * deep }], sides, 1), from, to)
}

// ─── Spine ─────────────────────────────────────────────────────────────────
//
// The spine is a stack of plates. Each is an outline of (z, half width)
// stations at one height; shots are tested against the same table.

interface Layer {
    y0: number
    y1: number
    st: Pt[]
    color: number
}

const F0: Pt[] = [[-64, 0.25], [-46, 3.0], [-27, 5.6], [-9, 3.4]]
const F1: Pt[] = [[-57, 0.25], [-41, 4.2], [-25, 7.4], [-9, 4.8]]
const F2: Pt[] = [[-49, 0.25], [-36, 5.0], [-23, 9.0], [-9, 6.4]]
const DECK: Pt[] = [[-41, 0.25], [-31, 5.4], [-20, 10], [-9, 9.2], [4, 7.2], [17, 9.2], [25, 12], [47, 13], [54, 11.6]]
const RIDGE: Pt[] = [[-32, 0.25], [-22, 3.0], [-9, 3.4], [4, 2.8], [17, 4], [26, 5.5], [47, 6]]
const A0: Pt[] = [[17, 3.6], [25, 13.6], [47, 14.6], [54, 13]]
const A1: Pt[] = [[17, 5], [25, 15.2], [47, 16.2], [54, 14.6]]
const A2: Pt[] = [[17, 6.2], [25, 13.6], [47, 14.6], [54, 13.2]]

const both = (y0: number, y1: number, st: Pt[], color: number, below = color): Layer[] => [{ y0, y1, st, color }, { y0: -y1, y1: -y0, st, color: below }]

const LAYERS: Layer[] = [
    { y0: -2.5, y1: 2.5, st: F0, color: O_VOID },
    { y0: -2.5, y1: 2.5, st: A0, color: O_VOID },
    ...both(2.5, 5, F1, O_DARK),
    ...both(5, 7.5, F2, O_PLATE, O_DARK),
    ...both(2.5, 5, A1, O_PLATE, O_DARK),
    ...both(5, 7.5, A2, O_DARK),
    ...both(7.5, 10, DECK, O_LIGHT, O_PLATE),
    ...both(10, 12.5, RIDGE, O_PLATE, O_DEEP)
]

/** Half the gap left between two plates, where the light bleeds out. */
const GAP = 0.18

/** A plate's half width at `z`, or -1 past its ends. */
function halfOf(st: Pt[], z: number) {
    if (z < st[0]![0] || z > st[st.length - 1]![0]) return -1
    for (let i = 0; i < st.length - 1; i++) {
        const a = st[i]!
        const c = st[i + 1]!
        if (z <= c[0]) return a[1] + (c[1] - a[1]) * (z - a[0]) / (c[0] - a[0])
    }
    return -1
}

/** Where a plate's edge is at `z` and how it is yawed there. */
function edgeOf(st: Pt[], z: number) {
    for (let i = 0; i < st.length - 1; i++) {
        const a = st[i]!
        const c = st[i + 1]!
        if (z >= a[0] && z <= c[0]) return { x: a[1] + (c[1] - a[1]) * (z - a[0]) / (c[0] - a[0]), yaw: Math.atan2(c[1] - a[1], c[0] - a[0]) }
    }
    return null
}

const outlineOf = (st: Pt[], inset = 0): Pt[] => {
    const right = st.map(([z, h]): Pt => [Math.max(0.05, h - inset), z])
    return [...right, ...[...right].reverse().map(([h, z]): Pt => [-h, z])]
}

// Struts run from the aft shoulders out to the stator at the four diagonals.
const STRUT_ROOT: Vec3 = [7.5, 7.5, 27]
const STRUT_TIP: Vec3 = [27.4, 27.4, 5.6]
const STRUT_R = 2.7

function buildSpine(b: ModelBuilder, glow: number) {
    const rnd = mulberry32(61)
    const shades = [O_DARK, O_PLATE, O_LIGHT, O_PLATE, 0x322e3e]

    for (const l of LAYERS) b.solid(slab(outlineOf(l.st), l.y1 - l.y0 - GAP * 2, 0.22), l.color, [0, (l.y0 + l.y1) / 2, 0])

    // Purple light bleeding through every seam between two plates.
    const seams: [Pt[], Pt[], number][] = [[F0, F1, 2.5], [F1, F2, 5], [F2, DECK, 7.5], [DECK, RIDGE, 10], [A0, A1, 2.5], [A1, A2, 5], [A2, DECK, 7.5]]
    for (const [p, q, y] of seams) {
        const z0 = Math.max(p[0]![0], q[0]![0]) + 1.5
        const z1 = Math.min(p[p.length - 1]![0], q[q.length - 1]![0]) - 0.4
        const st: Pt[] = []
        for (let z = z0; z <= z1; z += 1.5) st.push([z, Math.min(halfOf(p, z), halfOf(q, z)) - 0.32])
        st.push([z1, Math.min(halfOf(p, z1), halfOf(q, z1)) - 0.32])
        for (const side of [1, -1]) b.glow(slab(outlineOf(st), GAP * 2 + 0.06, 0), glow, 1.5, [0, y * side, 0])
    }

    // Raised armour on every exposed ledge, in broken shades with open seams between.
    const plate = (outer: Pt[], inner: Pt[] | null, y: number, up: number, z0: number, z1: number, step: number, keep = 0.9) => {
        for (let z = z0; z < z1; z += step) {
            const za = z + 0.2
            const zb = Math.min(z + step, z1) - 0.2
            const oa = halfOf(outer, za) - 0.75
            const ob = halfOf(outer, zb) - 0.75
            const ia = Math.max(inner ? halfOf(inner, za) + 0.6 : 0, keep)
            const ib = Math.max(inner ? halfOf(inner, zb) + 0.6 : 0, keep)
            if (oa - ia < 1 || ob - ib < 1) continue
            const runs = ob - ib > 6 ? 2 : 1
            for (let k = 0; k < runs; k++) {
                const f0 = k / runs
                const f1 = (k + 1) / runs
                const g = runs > 1 ? 0.18 : 0
                const pts: Pt[] = [
                    [ia + (oa - ia) * f0 + (k ? g : 0), za], [ia + (oa - ia) * f1 - (k ? 0 : g), za],
                    [ib + (ob - ib) * f1 - (k ? 0 : g), zb], [ib + (ob - ib) * f0 + (k ? g : 0), zb]
                ]
                const raised = rnd() < 0.3
                const color = rnd() < 0.07 ? GUNMETAL : shades[Math.floor(rnd() * shades.length)]!
                b.solid(slab(pts, raised ? 0.5 : 0.24, 0.05), color, [0, y + up * (raised ? 0.2 : 0.08), 0], FLAT, ONE, true)
            }
        }
    }
    for (const up of [1, -1]) {
        plate(F0, F1, 2.5 * up, up, -63, -40, 3.4, 0.4)
        plate(F1, F2, 5 * up, up, -56, -34, 3.6, 0.5)
        plate(F2, DECK, 7.5 * up, up, -48, -26, 3.8, 0.6)
        plate(DECK, RIDGE, 10 * up, up, -40, 53, 4.2)
        plate(RIDGE, null, 12.5 * up, up, -30, up > 0 ? 33 : 46, 3.6, 1.1)
        plate(A1, A2, 5 * up, up, 19, 53, 4.4)
    }

    // Ribs standing under each overhang, breaking the seam light into dashes.
    const ribs = (st: Pt[], y: number, h: number, z0: number, z1: number, step: number, color: number, proud = 0.25) => {
        for (let z = z0; z < z1; z += step) {
            const e = edgeOf(st, z)
            if (!e) continue
            b.solid(block(0.8, h, 0.8, 0.1), color, [e.x + proud, y, z], [0, e.yaw, 0], ONE, true)
        }
    }
    for (const side of [1, -1]) {
        ribs(F0, 2.2 * side, 1.6, -58, -10, 4, O_PLATE, 0.5)
        ribs(F1, 4.9 * side, 1.4, -54, -10, 4, O_LIGHT, 0.3)
        ribs(F2, 7.4 * side, 1.4, -46, -10, 4, O_LIGHT, 0.3)
        ribs(A2, 7.4 * side, 1.4, 20, 53, 3.5, O_LIGHT, 0.3)
        ribs(A0, 2.3 * side, 1.2, 19, 53, 3.5, O_PLATE, 0.6)
        ribs(RIDGE, 10.4 * side, 1.2, -28, 46, 3, O_LIGHT, 0.3)
    }

    // The waist: machinery in the shadow of the overhang, with a long glow line.
    const clutter = [O_PLATE, O_LIGHT, O_METAL, O_DARK]
    for (const st of [F0, A0]) {
        const from = st[0]![0] + 8
        const to = st[st.length - 1]![0] - 1
        for (let z = from; z < to; z += 2.4) {
            const e = edgeOf(st, z)!
            b.metal(block(1 + rnd(), 0.8 + rnd() * 1.8, 1 + rnd() * 1.3, 0.06), clutter[Math.floor(rnd() * 4)]!, [e.x + 0.35, (rnd() - 0.5) * 2.4, z], [0, e.yaw, 0], ONE, true)
        }
        for (let z = from; z < to - 5; z += 7.5) {
            const e = edgeOf(st, z + 2.5)!
            b.glow(box(0.1, 0.18, 5), glow, 2, [e.x + 0.32, 0, z + 2.5], [0, e.yaw, 0], ONE, true)
        }
    }

    // Rows of cold violet ports along every plate edge, some dark.
    const litRow = (st: Pt[], y: number, z0: number, z1: number, step: number, size: number) => {
        for (let z = z0; z < z1; z += step) {
            const e = edgeOf(st, z)
            if (!e || rnd() < 0.42) continue
            const pale = rnd() < 0.15
            b.glow(box(0.14, 0.32, size), pale ? PALE : VIOLET, pale ? 1.2 : 1.5, [e.x + 0.26 / Math.cos(e.yaw), y, z], [0, e.yaw, 0], ONE, true)
        }
    }
    for (const side of [1, -1]) {
        litRow(F1, 3.9 * side, -50, -10, 1.9, 0.9)
        litRow(F2, 6.4 * side, -42, -10, 2.1, 1.0)
        litRow(F2, 5.7 * side, -38, -12, 3.1, 1.3)
        litRow(DECK, 8.9 * side, -34, 52, 1.8, 0.9)
        litRow(DECK, 8.2 * side, -28, 52, 2.7, 1.2)
        litRow(A1, 4.2 * side, 19, 53, 1.7, 0.9)
        litRow(A1, 3.3 * side, 21, 53, 2.5, 1.2)
        litRow(A2, 6.6 * side, 19, 53, 1.9, 1.0)
        litRow(A2, 5.8 * side, 23, 53, 3.3, 1.4)
        litRow(RIDGE, 11.4 * side, -24, 46, 2.2, 1.0)
    }
    // Bone trim down the shoulder of the deck plate.
    for (const side of [1, -1]) {
        for (let z = -36; z < 50; z += 6) {
            const e = edgeOf(DECK, z + 2.5)!
            b.solid(block(0.3, 0.3, 4.6, 0.04), z > -12 && z < 18 ? GUNMETAL : BONE, [e.x - 0.25, 10.0 * side, z + 2.5], [0, e.yaw, 0], ONE, true)
        }
    }

    // Prow: a lit trench down the ridge, bridged, and a row of raked spines behind it.
    for (const side of [1, -1]) {
        groove(b, [0, 12.42 * side, -11], [1.5, 0.3, 36])
        slit(b, glow, [0, 12.5 * side, -11], [0.28, 0.12, 35], 2.2)
        for (let i = 0; i < 10; i++) b.metal(block(2.2, 0.45, 0.6, 0.06), O_LIGHT, [0, 12.62 * side, -27 + i * 3.6])
    }
    for (let i = 0; i < 5; i++) {
        const s = 1 - i * 0.12
        b.solid(fin([[0, -1.4 * s], [0, 1.2 * s], [4.2 * s, 3.6 * s], [3.4 * s, 1.0 * s]], 0.5, 0.08), i % 2 ? O_PLATE : O_LIGHT, [0, 12.5, -13.5 - i * 3.6])
        slit(b, glow, [0, 12.5 + 1.9 * s, -12.3 - i * 3.6], [0.56, 0.12, 1.2 * s], 2, false, [-0.72, 0, 0])
    }
    // The needle nose: a bone tip, a lit emitter and two tusks flanking the blade.
    b.solid(loft([{ z: -67.5, w: 0.05, h: 0.05 }, { z: -64.4, w: 0.5, h: 0.9 }, { z: -62.5, w: 0.7, h: 2.2 }], 6, 0.8), BONE)
    b.glow(octa(0.5), glow, 4, [0, 0, -68])
    for (const y of [3.4, -3.4]) {
        b.solid(loft([
            { z: -61, w: 0.08, h: 0.12, x: 1.6, y },
            { z: -52, w: 0.5, h: 0.9, x: 4.6, y },
            { z: -40, w: 0.7, h: 1.2, x: 7.6, y },
            { z: -29, w: 0.5, h: 0.9, x: 9.6, y: y * 1.5 }
        ], 6, 0.7), O_LIGHT, FLAT, FLAT, ONE, true)
        b.solid(loft([{ z: -62.4, w: 0.04, h: 0.05, x: 1.15, y }, { z: -60.4, w: 0.16, h: 0.22, x: 1.8, y }], 6, 0.7), BONE, FLAT, FLAT, ONE, true)
        slit(b, glow, [5.4, y, -46], [0.1, 0.2, 13], 1.8, true, [0, 0.253, 0])
        for (const z of [-48, -38]) {
            const e = edgeOf(F1, z)!
            b.metal(spar([e.x - 0.5, y, z + 1], [e.x + 2.6, y, z - 0.4], 0.35, 0.3, 6), O_METAL, FLAT, FLAT, ONE, true)
        }
    }

    // Deck clutter on both faces, clear of the battery tubs and the tower.
    for (let i = 0; i < 90; i++) {
        const z = -33 + rnd() * 84
        const up = rnd() < 0.6 ? 1 : -1
        const lo = Math.max(halfOf(RIDGE, z), 0) + 1.2
        const hi = halfOf(DECK, z) - 1.6
        const w = 0.7 + rnd() * 1.8
        const h = 0.4 + rnd() * 1.1
        const d = 0.9 + rnd() * 3
        if (hi - lo < 1) continue
        const x = lo + rnd() * (hi - lo)
        if (up > 0 && (Math.hypot(x - 6.6, z + 16) < 4.6 || Math.hypot(x - 8.9, z - 29) < 4.6 || (z > 32 && z < 50 && x < 7))) continue
        b.metal(block(w, h, d, 0.07), clutter[i % clutter.length]!, [x, up * (10.15 + h / 2), z], FLAT, ONE, true)
        if (i % 5 === 0) b.glow(box(0.22, 0.12, 0.22), i % 10 ? VIOLET : glow, 3, [x, up * (10.25 + h), z], FLAT, ONE, true)
    }
    for (const [z, len] of [[-24, 9], [-4, 14], [14, 9], [36, 12]] as const) {
        const e = edgeOf(RIDGE, z)!
        for (const side of [1, -1]) b.metal(tube(0.26, 0.26, len, 6), GUNMETAL, [e.x + 0.8, 10.5 * side, z], [0, e.yaw, 0], ONE, true)
    }

    // Keel: a long ventral blade under the prow, sensor pods, and belly vents under the drives.
    b.solid(fin([[0, -34], [0, -10], [-8.5, -13], [-6, -27]], 0.9, 0.15), O_DARK, [0, -12.4, 0])
    b.solid(fin([[-1.5, -30], [-1.5, -13], [-5, -15], [-4, -25.5]], 1.3, 0.1), O_LIGHT, [0, -12.4, 0])
    slit(b, glow, [0, -17.6, -20], [1.4, 0.22, 8], 1.8)
    b.solid(fin([[-8.2, -13.6], [-8.9, -12.4], [-7.0, -18], [-6.6, -24]], 1.0, 0.05), BONE, [0, -12.4, 0])
    for (const z of [-2, 10, 30]) {
        b.metal(ico(1.5, 1), GUNMETAL, [5.6, -10.4, z], FLAT, [1, 0.7, 1.7], true)
        b.glow(ring(1.0, 0.08, 3, 10), glow, 2, [5.6, -11.45, z], [Math.PI / 2, 0, 0], ONE, true)
    }
    for (let i = 0; i < 4; i++) {
        groove(b, [6.2, -10.12, 36 + i * 3.4], [7, 0.3, 2.2], true)
        for (let k = 0; k < 4; k++) b.metal(box(6.6, 0.22, 0.2), O_METAL, [6.2, -10.3, 35.2 + i * 3.4 + k * 0.55], [0.5, 0, 0], ONE, true)
    }
}

/** The cage: both beams bared around the core, bulkhead emitters fore and aft, claws and tension rods. */
function buildCage(b: ModelBuilder, glow: number) {
    // The singularity and its accretion disc, tipped so it reads from the beam and from ahead.
    b.metal(ico(CORE_R, 3), 0x030206, [0, 0, CORE_Z])
    const disc = (r0: number, r1: number, intensity: number) => {
        for (const flip of [0, Math.PI]) b.glow(new THREE.RingGeometry(r0, r1, 56, 1).rotateX(-Math.PI / 2 + flip).rotateX(0.36), glow, intensity, [0, 0, CORE_Z])
    }
    disc(6.0, 6.5, 3.4)
    disc(6.5, 7.7, 1.7)
    disc(7.7, 8.8, 0.8)
    disc(8.8, 9.7, 0.35)
    b.glow(ring(5.3, 0.11, 4, 48), PALE, 2.6, [0, 0, CORE_Z])
    b.glow(ring(5.3, 0.11, 4, 48), PALE, 2.6, [0, 0, CORE_Z], [0, Math.PI / 2, 0])

    for (const side of [1, -1]) {
        // Containment rings on the inner faces of the beams, ribbed across.
        b.metal(cyl(4.2, 4.6, 0.7, 16), O_VOID, [0, 7.2 * side, CORE_Z])
        b.glow(ring(3.6, 0.14, 4, 28), glow, 2.6, [0, 6.84 * side, CORE_Z], [Math.PI / 2, 0, 0])
        b.glow(ring(2.2, 0.1, 4, 20), PALE, 2.2, [0, 6.84 * side, CORE_Z], [Math.PI / 2, 0, 0])
        b.metal(cyl(0.2, 1.1, 1.6, 6), GUNMETAL, [0, 6.2 * side, CORE_Z], [side > 0 ? Math.PI : 0, 0, 0])
        for (let i = 0; i < 9; i++) {
            const z = -7 + i * 2.75
            if (Math.abs(z - CORE_Z) < 4.5) continue
            b.solid(block(halfOf(DECK, z) * 2 - 1.4, 0.7, 0.8, 0.08), i % 2 ? O_PLATE : O_DARK, [0, 7.45 * side, z])
        }
        for (const z of [-6.4, 14.4]) slit(b, glow, [0, 7.3 * side, z], [9, 0.12, 0.3], 2)
        // The beams are slotted over the core, so its light falls through.
        groove(b, [0, 12.5 * side, CORE_Z], [1.7, 0.4, 9])
        slit(b, glow, [0, 12.62 * side, CORE_Z], [0.7, 0.2, 8], 2.4)

        // Claws hooking down around the core from the beam edges.
        for (const z of [-3.6, 11.6]) {
            const lean = z < CORE_Z ? 1.6 : -1.6
            const path: Vec3[] = [[5.2, 7.6 * side, z], [8.6, 6.4 * side, z + lean * 0.3], [10.4, 3.6 * side, z + lean * 0.7], [9.6, 1.5 * side, z + lean]]
            const size = [1.0, 0.8, 0.55, 0.12]
            for (let i = 0; i < 3; i++) b.solid(spar(path[i]!, path[i + 1]!, size[i]!, size[i + 1]!, 5, 1.5), i === 2 ? BONE : O_LIGHT, FLAT, FLAT, ONE, true)
            b.solid(block(2.4, 1.2, 2.6, 0.2), O_PLATE, [5.6, 7.3 * side, z], FLAT, ONE, true)
            b.glow(octa(0.34), glow, 4, [9.5, 1.15 * side, z + lean], FLAT, ONE, true)
        }
    }
    // Tension rods at the corners keep the beams apart.
    for (const z of [-7.6, 15.6]) {
        const x = halfOf(DECK, z) - 1.3
        b.metal(cyl(0.3, 0.3, 15, 6), GUNMETAL, [x, 0, z], FLAT, ONE, true)
        for (const y of [-5.4, 0, 5.4]) b.metal(cyl(0.55, 0.55, 0.7, 6), O_METAL, [x, y, z], FLAT, ONE, true)
        b.glow(cyl(0.36, 0.36, 3.2, 6), glow, 1.8, [x, 2.7, z], FLAT, ONE, true)
        b.glow(cyl(0.36, 0.36, 3.2, 6), glow, 1.8, [x, -2.7, z], FLAT, ONE, true)
    }

    // Bulkheads where the middle plates stop: a dished emitter and a focusing needle aimed at the core.
    for (const [z, dir] of [[-9, 1], [17, -1]] as const) {
        const half = dir > 0 ? 6.4 : 6.2
        b.solid(wall([[-half, -7.2], [half, -7.2], [half + 0.4, 0], [half, 7.2], [-half, 7.2], [-half - 0.4, 0]], 1.0, 0.12), O_DARK, [0, 0, z - dir * 0.2])
        b.metal(tube(3.4, 3.4, 0.8, 12), O_VOID, [0, 0, z + dir * 0.5])
        b.glow(ring(2.9, 0.16, 4, 24), glow, 2.6, [0, 0, z + dir * 0.95])
        b.glow(ring(1.7, 0.1, 4, 20), PALE, 2, [0, 0, z + dir * 0.95])
        b.metal(new THREE.ConeGeometry(0.9, 4.2, 6).rotateX(dir * Math.PI / 2), GUNMETAL, [0, 0, z + dir * 2.6])
        b.glow(octa(0.3), glow, 5, [0, 0, z + dir * 4.9])
        for (const y of [-5, 5]) {
            b.solid(block(half * 2 - 1.5, 0.5, 0.5, 0.06), O_LIGHT, [0, y, z + dir * 0.45])
            slit(b, VIOLET, [0, y * 0.72, z + dir * 0.36], [half * 1.3, 0.22, 0.1], 1.7)
        }
        for (const x of [-4.6, 4.6]) b.solid(block(0.6, 12, 0.6, 0.06), O_LIGHT, [x, 0, z + dir * 0.45])
    }
}

/** Tower, silos, stern blades and the drive block. */
function buildStern(b: ModelBuilder, glow: number) {
    // Command tower: terraces climbing to a bridge blister.
    b.solid(block(11, 2.6, 15, 0.25), O_PLATE, [0, 13.7, 40.5])
    b.solid(block(12.4, 0.5, 5, 0.1), O_LIGHT, [0, 15.1, 35.6])
    b.solid(block(7.6, 2.8, 10.5, 0.22), O_LIGHT, [0, 16.4, 42.2])
    b.solid(block(5, 2.2, 6.4, 0.2), O_PLATE, [0, 18.9, 43])
    b.solid(block(8.6, 0.4, 3, 0.08), BONE, [0, 17.95, 37.6])
    b.glass(ico(2.1, 2), 0x120c20, [0, 19.2, 39.9], FLAT, [1.25, 0.62, 1.5])
    slit(b, glow, [0, 18.6, 38.2], [4.4, 0.16, 0.2], 2.6)
    for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 7; i++) {
            if ((row * 3 + i) % 5 === 3) continue
            b.glow(box(0.12, 0.34, 0.9), i % 4 === 1 ? PALE : VIOLET, 1.8, [5.62, 13.2 + row * 1.0, 34.6 + i * 1.8], FLAT, ONE, true)
        }
        slit(b, row ? PALE : VIOLET, [0, 13.2 + row * 1.0, 32.94], [8.4, 0.3, 0.1], 1.8)
    }
    for (let i = 0; i < 5; i++) b.glow(box(0.12, 0.34, 0.9), i === 2 ? PALE : VIOLET, 1.8, [3.92, 16.5, 38.6 + i * 1.8], FLAT, ONE, true)
    slit(b, VIOLET, [0, 16.6, 36.9], [5.6, 0.34, 0.1], 1.8)
    slit(b, glow, [0, 15.0, 48.05], [9, 0.3, 0.1], 2)
    dish(b, livery(glow), [3.6, 17.7, 45.5], 1.3)
    for (const [x, z, h] of [[-1.4, 45.2, 6], [1.2, 44.4, 4], [-3.4, 46.4, 3]] as const) {
        b.metal(cyl(0.07, 0.16, h, 5), GUNMETAL, [x, 19.9 + h / 2, z])
        b.glow(octa(0.34), glow, 5, [x, 19.9 + h, z])
    }

    // Stern blades: one raked high over the drives, one deeper below, and four canted off the corners.
    b.solid(fin([[0, 46.5], [0, 57.5], [19, 63], [17, 54.5]], 1.0, 0.16), O_DARK, [0, 9.6, 0])
    b.solid(fin([[2, 49], [2, 56.4], [12, 59.4], [11, 53]], 1.5, 0.12), O_LIGHT, [0, 9.6, 0])
    b.solid(fin([[17.3, 55], [19.4, 63.2], [15.5, 61.4], [14.2, 54]], 1.2, 0.06), BONE, [0, 9.6, 0])
    slit(b, glow, [0, 18.4, 59.95], [1.1, 17, 0.12], 2.2, false, [0.283, 0, 0])
    b.solid(fin([[0, 44], [0, 57.5], [-24, 64], [-21, 53]], 1.0, 0.16), O_DARK, [0, -9.6, 0])
    b.solid(fin([[-2, 47], [-2, 56.2], [-15, 59.6], [-13.5, 51.4]], 1.5, 0.12), O_PLATE, [0, -9.6, 0])
    b.solid(fin([[-21.6, 53.4], [-24.5, 64.3], [-19.6, 62.4], [-18, 52]], 1.2, 0.06), BONE, [0, -9.6, 0])
    slit(b, glow, [0, -20.9, 60.5], [1.1, 22, 0.12], 2.2, false, [-0.263, 0, 0])
    for (const side of [1, -1]) {
        const rot: Vec3 = [0, 0, side > 0 ? -0.95 : -Math.PI + 0.95]
        b.solid(fin([[0, 43], [0, 56], [13, 61.5], [11.5, 52.5]], 0.8, 0.14), O_PLATE, [13.4, 7.2 * side, 0], rot, ONE, true)
        b.solid(fin([[11.7, 53], [13.3, 61.7], [10.4, 60.1], [9.6, 52]], 1.0, 0.05), GUNMETAL, [13.4, 7.2 * side, 0], rot, ONE, true)
    }

    // Drive block: a stern wall of plate ends, one great drive, four heavy and two light.
    b.solid(wall([[-14.4, -7.3], [14.4, -7.3], [15.4, -2.5], [15.4, 2.5], [14.4, 7.3], [-14.4, 7.3], [-15.4, 2.5], [-15.4, -2.5]], 1.2, 0.15), O_DEEP, [0, 0, 54.3])
    b.metal(block(27, 0.7, 1.2, 0.08), O_METAL, [0, 8.2, 54.6])
    b.metal(block(27, 0.7, 1.2, 0.08), O_METAL, [0, -8.2, 54.6])
    drive(b, glow, [0, 0, 56], 5, false, O_PLATE)
    for (const y of [5.4, -5.4]) drive(b, glow, [9.8, y, 55.4], 3, true, O_DARK)
    b.engine([14.3, 0, 54.8], 1.6, true, glow)
    for (const x of [5.6, 13.2]) {
        b.solid(fin([[-9, 50], [9, 50], [7.4, 58.4], [-7.4, 58.4]], 0.6, 0.1), O_LIGHT, [x, 0, 0], FLAT, ONE, true)
        slit(b, glow, [x, 0, 58.46], [0.28, 13.5, 0.1], 2.2, true)
    }
    for (let i = 0; i < 9; i++) b.glow(box(1.3, 0.28, 0.1), i % 3 ? VIOLET : PALE, 1.8, [-12 + i * 3, 9.2, 54.95])
}

/** A battery tub: a dark collar in an armoured housing, ringed with light. */
function tub(b: ModelBuilder, glow: number, f: Frame, mirror: boolean) {
    b.solid(f.tip(block(8, 3, 8, 0.35)), O_PLATE, f.at(0, -0.8, 0), f.rot, ONE, mirror)
    b.solid(f.tip(block(9, 0.5, 5, 0.1)), O_LIGHT, f.at(0, 0.55, 0), f.rot, ONE, mirror)
    b.metal(f.tip(cyl(2.7, 3.3, 1.0, 10)), O_VOID, f.at(0, 1.2, 0), f.rot, ONE, mirror)
    b.glow(f.tip(ring(2.85, 0.07, 3, 16).rotateX(Math.PI / 2)), glow, 2, f.at(0, 1.68, 0), f.rot, ONE, mirror)
    for (const u of [-3.4, 3.4]) b.solid(f.tip(block(0.6, 0.8, 6.4, 0.08)), GUNMETAL, f.at(u, 0.9, 0), f.rot, ONE, mirror)
}

const mountOf = (f: Frame, v: number, w = 0, normal: Vec3 = f.up): CapitalMount => ({ position: new THREE.Vector3(...f.at(0, v, w)), normal: new THREE.Vector3(...normal).normalize() })
const mirrored = (m: CapitalMount): CapitalMount => ({ position: new THREE.Vector3(-m.position.x, m.position.y, m.position.z), normal: new THREE.Vector3(-m.normal.x, m.normal.y, m.normal.z) })

/** The stator: the fixed hoop, its struts and everything bolted to it. */
function buildStator(b: ModelBuilder, glow: number) {
    const rnd = mulberry32(977)
    const shades = [O_DARK, O_PLATE, O_LIGHT, O_PLATE, 0x322e3e]
    const Z: Vec3 = [0, 0, STATOR_Z]
    // Bays kept clear of plating: pylon pads, barbettes, battery sponsons and the hangars.
    const zones: Pt[] = [[0, 9.5], [90, 15], [180, 9.5], [270, 15], [45, 10.5], [135, 10.5], [225, 10.5], [315, 10.5], [22, 7.5], [338, 7.5]]
    const busy = (deg: number) => zones.some(([c, half]) => Math.abs(((deg - c + 540) % 360) - 180) < half)

    b.solid(hoop(STATOR_R, rect(6, 7, 1.0), 0, TAU, 96), O_DEEP, Z)
    // Frames every five degrees, armour in the bays between, each face in its own broken shades.
    for (let k = 0; k < 72; k++) {
        const deg = k * 5
        b.solid(hoop(STATOR_R, rect(6.9, 7.9, 1.2), rad(deg - 0.65), rad(deg + 0.65), 1), k % 2 ? O_LIGHT : O_PLATE, Z)
        const a0 = rad(deg + 1.1)
        const a1 = rad(deg + 3.9)
        const pick = () => rnd() < 0.06 ? GUNMETAL : shades[Math.floor(rnd() * shades.length)]!
        const t = () => rnd() < 0.3 ? 0.62 : 0.3
        const open = !busy(deg + 2.5)
        if (open) {
            const lift = t()
            b.solid(hoop(STATOR_R, rectAt(2.9, 3 + lift, -2.4, 2.4), a0, a1, 2), pick(), Z)
            if (rnd() < 0.55) {
                const f = ringFrame(rad(deg + 2.5), STATOR_R + 3 + lift, STATOR_Z)
                for (const w of [-1.1, 1.1]) if (rnd() < 0.7) b.glow(box(1.1, 0.1, 0.3), rnd() < 0.2 ? PALE : VIOLET, 1.7, f.at(0, 0.02, w), f.rot)
            }
            b.solid(hoop(STATOR_R, rectAt(0.8, 2.3, -3.5 - t(), -3.4), a0, a1, 2), pick(), Z)
            b.solid(hoop(STATOR_R, rectAt(-2.3, -0.8, -3.5 - t(), -3.4), a0, a1, 2), pick(), Z)
            if (rnd() < 0.4) {
                const f = ringFrame(rad(deg + 2.5), STATOR_R, STATOR_Z - 3.5)
                b.glow(box(1.2, 0.34, 0.1), VIOLET, 1.7, f.at(0, 1.5, -0.68), f.rot)
            }
        }
        b.solid(hoop(STATOR_R, rectAt(-3 - t(), -2.9, -2.4, 2.4), a0, a1, 2), pick(), Z)
        b.solid(hoop(STATOR_R, rectAt(0.8, 2.3, 3.4, 3.5 + t()), a0, a1, 2), pick(), Z)
        b.solid(hoop(STATOR_R, rectAt(-2.3, -0.8, 3.4, 3.5 + t()), a0, a1, 2), pick(), Z)
        if (rnd() < 0.35) {
            const f = ringFrame(rad(deg + 2.5), STATOR_R - 3.62, STATOR_Z)
            b.glow(box(1.1, 0.1, 0.3), VIOLET, 1.7, f.at(0, -0.05, rnd() < 0.5 ? -1 : 1), f.rot)
        }
    }
    // Light rails in the trench of both faces, pipe runs round the inner corners.
    for (const w of [-3.56, 3.56]) b.glow(hoop(STATOR_R, rectAt(-0.22, 0.22, w - 0.08, w + 0.08), 0, TAU, 96), glow, 1.7, Z)
    for (const [r, w] of [[-3.25, -2.95], [-3.25, 2.95], [3.25, 2.95]] as const) {
        for (let q = 0; q < 4; q++) b.metal(hoop(STATOR_R + r, rect(0.5, 0.5), rad(q * 90 + 12), rad(q * 90 + 78), 14), GUNMETAL, [0, 0, STATOR_Z + w])
    }
    b.solid(hoop(STATOR_R, rectAt(2.95, 3.2, -3.3, -2.7), 0, TAU, 96), BONE, Z)

    const pylons: CapitalMount[] = []
    const citadels: CapitalMount[] = []
    const batteries: CapitalMount[] = []
    const hangars: CapitalMount[] = []

    // Pylon sockets on the rim at 12, 3, 6 and 9: a plinth, a machined pad and a lit socket.
    for (const deg of [0, 90, 180]) {
        const mirror = deg === 90
        const f = ringFrame(rad(deg), STATOR_R + 3, STATOR_Z)
        b.solid(block(13, 2.4, 10.6, 0.5), O_PLATE, f.at(0, 0.3, 0), f.rot, ONE, mirror)
        b.solid(block(15.5, 1.2, 7.4, 0.3), O_DARK, f.at(0, -0.2, 0), f.rot, ONE, mirror)
        b.solid(cyl(5, 5.5, 1.0, 20), O_METAL, f.at(0, 2.0, 0), f.rot, ONE, mirror)
        b.metal(ring(5.05, 0.16, 4, 28).rotateX(Math.PI / 2), BONE, f.at(0, 2.5, 0), f.rot, ONE, mirror)
        b.glow(ring(4.3, 0.1, 3, 28).rotateX(Math.PI / 2), glow, 2.2, f.at(0, 2.53, 0), f.rot, ONE, mirror)
        b.metal(cyl(1.7, 1.7, 0.16, 12), O_VOID, f.at(0, 2.52, 0), f.rot, ONE, mirror)
        b.glow(ring(1.75, 0.07, 3, 16).rotateX(Math.PI / 2), glow, 1.8, f.at(0, 2.55, 0), f.rot, ONE, mirror)
        for (let i = 0; i < 8; i++) {
            const a = (i + 0.5) / 8 * TAU
            b.metal(cyl(0.28, 0.28, 0.2, 6), GUNMETAL, f.at(Math.cos(a) * 3.1, 2.55, Math.sin(a) * 3.1), f.rot, ONE, mirror)
        }
        for (const u of [-5.9, 5.9]) {
            b.solid(block(1.2, 1.7, 8.6, 0.12), O_LIGHT, f.at(u, 1.9, 0), f.rot, ONE, mirror)
            b.glow(box(0.12, 0.2, 6), glow, 1.8, f.at(u * 1.11, 2.2, 0), f.rot, ONE, mirror)
        }
        const m = mountOf(f, 2.5)
        pylons.push(m)
        if (mirror) pylons.push(mirrored(m))
    }
    // The order the fight expects: 12, 3, 6, 9.
    pylons.splice(0, pylons.length, pylons[0]!, pylons[1]!, pylons[3]!, pylons[2]!)

    // Citadel barbettes at the diagonals, built into the hoop where the struts land.
    for (const deg of [45, 135]) {
        const a = rad(deg)
        b.solid(hoop(STATOR_R, rect(7.8, 8.8, 1.3), a - rad(8), a + rad(8), 4), O_PLATE, Z)
        b.solid(hoop(STATOR_R, rect(7.8, 8.8, 1.3), -a - rad(8), -a + rad(8), 4), O_PLATE, Z)
        const f = ringFrame(a, STATOR_R + 2.4, STATOR_Z - 1.4, -0.4)
        b.solid(f.tip(block(14, 4.6, 10.5, 0.6)), O_DARK, f.at(0, -0.6, 0.6), f.rot, ONE, true)
        b.solid(f.tip(block(15.2, 1.0, 7, 0.2)), O_LIGHT, f.at(0, 0.2, 0.6), f.rot, ONE, true)
        b.metal(f.tip(cyl(5.5, 6.2, 1.3, 12)), O_METAL, f.at(0, 2.2, 0), f.rot, ONE, true)
        b.solid(f.tip(cyl(4.2, 4.7, 3.0, 12)), O_PLATE, f.at(0, 4.1, 0), f.rot, ONE, true)
        b.solid(f.tip(cyl(3.7, 3.7, 0.3, 12)), GUNMETAL, f.at(0, 5.44, 0), f.rot, ONE, true)
        b.metal(f.tip(cyl(2.3, 2.5, 0.3, 12)), O_METAL, f.at(0, 5.5, 0), f.rot, ONE, true)
        for (let i = 0; i < 6; i++) b.metal(f.tip(box(0.16, 0.1, 1.2).rotateY(i / 6 * TAU).translate(Math.sin(i / 6 * TAU) * 3.05, 0, Math.cos(i / 6 * TAU) * 3.05)), 0x08070b, f.at(0, 5.6, 0), f.rot, ONE, true)
        b.metal(f.tip(ring(4.25, 0.2, 4, 24).rotateX(Math.PI / 2)), BONE, f.at(0, 5.6, 0), f.rot, ONE, true)
        b.glow(f.tip(ring(3.55, 0.09, 3, 24).rotateX(Math.PI / 2)), glow, 2.4, f.at(0, 5.68, 0), f.rot, ONE, true)
        b.glow(f.tip(ring(4.85, 0.08, 3, 24).rotateX(Math.PI / 2)), glow, 1.6, f.at(0, 2.9, 0), f.rot, ONE, true)
        for (let i = 0; i < 12; i++) {
            const t = (i + 0.5) / 12 * TAU
            b.metal(f.tip(cyl(0.3, 0.3, 0.3, 6)), GUNMETAL, f.at(Math.cos(t) * 5.35, 2.95, Math.sin(t) * 5.35), f.rot, ONE, true)
            if (i % 3 === 0) b.solid(f.tip(block(0.7, 2.6, 0.7, 0.08).rotateY(-t)), O_LIGHT, f.at(Math.cos(t) * 4.6, 4.0, Math.sin(t) * 4.6), f.rot, ONE, true)
        }
        for (const u of [-6.4, 6.4]) {
            b.solid(f.tip(block(1.4, 3.2, 8.6, 0.15)), O_LIGHT, f.at(u, 1.4, 0.6), f.rot, ONE, true)
            b.solid(f.tip(block(0.3, 0.3, 7.4, 0.04)), BONE, f.at(u, 3.05, 0.6), f.rot, ONE, true)
            b.glow(f.tip(box(0.12, 0.24, 5.4)), glow, 1.8, f.at(u * 1.12, 1.6, 0.6), f.rot, ONE, true)
        }
        b.glow(f.tip(box(9, 0.3, 0.12)), VIOLET, 1.7, f.at(0, -0.3, -4.68), f.rot, ONE, true)
        const m = mountOf(f, 5.6)
        citadels.push(m, mirrored(m))
    }

    // Battery sponsons on the forward shoulder at 11 and 1 o'clock.
    {
        const f = ringFrame(rad(22), STATOR_R + 1.7, STATOR_Z - 2.7, -0.95)
        tub(b, glow, f, true)
        const m = mountOf(f, 1.7)
        batteries.push(m, mirrored(m))
    }

    // Hangars at 3 and 9 o'clock: the hoop swells forward into a gallery whose mouth looks forward and outward.
    {
        const a = rad(90)
        const housing: Pt[] = [[-3.6, -8.6], [3.4, -5.2], [3.4, 3.9], [-3.6, 3.9]]
        const arcs = (outline: Pt[], d0: number, d1: number, steps = 3) => hoop(STATOR_R, outline, a + rad(d0), a + rad(d1), steps)
        b.solid(arcs(housing, -12.5, 12.5, 8), O_DARK, Z, FLAT, ONE, true)
        b.solid(arcs(inlay(housing, 0, 0.5, 3.5, 0.14, 0.05), -11.6, 11.6, 8), O_LIGHT, Z, FLAT, ONE, true)
        for (const d of [-12.5, -4.2, 4.2, 12.5]) b.solid(arcs(grow(housing, 1.07), d - 0.7, d + 0.7, 1), O_PLATE, Z, FLAT, ONE, true)
        for (const [d0, d1] of [[-10.8, -5.2], [-3.2, 3.2], [5.2, 10.8]] as const) {
            b.metal(arcs(inlay(housing, 0, 0.5, 2.5, 0.08, 0.24), d0, d1), 0x08070b, Z, FLAT, ONE, true)
            b.glow(arcs(inlay(housing, 0, 0.55, 1.5, 0.04, 0.34), d0 + 0.7, d1 - 0.7), glow, 0.22, Z, FLAT, ONE, true)
            for (const t of [0.3, 0.75]) b.glow(arcs(inlay(housing, 0, t, 0.07, 0.04, 0.4), d0 + 1, d1 - 1), glow, 1.6, Z, FLAT, ONE, true)
            b.glow(arcs(inlay(housing, 0, 0.83, 0.1, 0.05, 0.36), d0 + 0.4, d1 - 0.4), AMBER, 1.5, Z, FLAT, ONE, true)
            b.solid(arcs(inlay(housing, 0, 0.93, 0.18, 0.12, 0.3), d0 - 0.3, d1 + 0.3), BONE, Z, FLAT, ONE, true)
            // A parked fighter in each bay, nose out.
            const f = ringFrame(a + rad((d0 + d1) / 2), STATOR_R + 0.1, STATOR_Z - 7.5, 0.45)
            b.solid(f.tip(loft([{ z: -1.5, w: 0.05, h: 0.05 }, { z: 0, w: 0.42, h: 0.3 }, { z: 1, w: 0.3, h: 0.22 }], 6, 0.7)), GUNMETAL, f.at(0, 0, 0), f.rot, ONE, true)
            b.solid(f.tip(slab([[-1.3, -0.6], [0, 0.1], [1.3, -0.6], [0.9, 0.5], [-0.9, 0.5]], 0.08, 0.02)), O_LIGHT, f.at(0, -0.06, 0.2), f.rot, ONE, true)
        }
        b.solid(arcs(inlay(housing, 0, 0.97, 0.22, 0.9, 0.7), -11.4, 11.4, 8), O_PLATE, Z, FLAT, ONE, true)
        // A landing sill under the mouth with guide lights running out along it.
        b.solid(arcs(rectAt(-4.1, -3.3, -11.6, -7.6), -11, 11, 8), O_PLATE, Z, FLAT, ONE, true)
        b.solid(arcs(rectAt(-4.25, -4.05, -11.2, -4), -9, 9, 6), O_LIGHT, Z, FLAT, ONE, true)
        for (let i = 0; i < 9; i++) {
            const d = -9.6 + i * 2.4
            b.glow(arcs(rectAt(-3.3, -3.2, -11.2, -8.4), d - 0.22, d + 0.22, 1), i % 2 ? glow : AMBER, 1.5, Z, FLAT, ONE, true)
        }
        b.glow(arcs(rectAt(-3.7, -3.4, -11.7, -11.58), -10.4, 10.4, 8), AMBER, 1.4, Z, FLAT, ONE, true)
        // Armour over the housing's back and flank.
        for (let i = 0; i < 4; i++) {
            const d = -11.4 + i * 5.85
            b.solid(arcs(inlay(housing, 2, 0.5, 4.2, 0.2, 0.1), d, d + 5.2), i % 2 ? O_PLATE : O_LIGHT, Z, FLAT, ONE, true)
            b.solid(arcs(inlay(housing, 3, 0.5, 3.2, 0.2, 0.1), d, d + 5.2), i % 2 ? O_LIGHT : O_PLATE, Z, FLAT, ONE, true)
            b.glow(arcs(inlay(housing, 3, 0.5, 0.5, 0.04, 0.34), d + 1.6, d + 3.6), VIOLET, 1.5, Z, FLAT, ONE, true)
        }
        const m: CapitalMount = { position: new THREE.Vector3(STATOR_R + 0.35, 0, STATOR_Z - 7.6), normal: new THREE.Vector3(0.44, 0, -0.9).normalize() }
        hangars.push(m, mirrored(m))
    }

    // Sensor clusters and vents fill the lower quadrants.
    for (const deg of [68, 112, 158]) {
        const f = ringFrame(rad(deg), STATOR_R + 3.3, STATOR_Z)
        b.metal(block(3.4, 1.0, 4.4, 0.1), O_METAL, f.at(0, 0.5, 0), f.rot, ONE, true)
        b.metal(ico(1.1, 1), GUNMETAL, f.at(0, 1.5, -0.8), f.rot, [1, 0.8, 1.4], true)
        b.glow(octa(0.26), glow, 4, f.at(0, 2.5, -0.8), f.rot, ONE, true)
        b.metal(cyl(0.06, 0.12, 3.4, 5), GUNMETAL, f.at(0.9, 2.2, 1.2), f.rot, ONE, true)
    }

    // Struts: heavy blades raked forward from the aft shoulders to the barbette nodes.
    for (const side of [1, -1]) {
        const from: Vec3 = [STRUT_ROOT[0], STRUT_ROOT[1] * side, STRUT_ROOT[2]]
        const to: Vec3 = [STRUT_TIP[0], STRUT_TIP[1] * side, STRUT_TIP[2]]
        const len = distance(from, to)
        const body = (grow: number, z0: number, z1: number, sides = 8) => along(loft([
            { z: len * z0, w: 1.5 + grow + (1 - z0) * 0.7, h: 3.0 + grow + (1 - z0) * 1.4 },
            { z: len * z1, w: 1.5 + grow + (1 - z1) * 0.7, h: 3.0 + grow + (1 - z1) * 1.4 }
        ], sides, 0.55, Math.PI / 8), from, to)
        b.solid(body(0, 0, 1), O_DEEP, FLAT, FLAT, ONE, true)
        b.solid(body(0.45, 0.16, 0.3), O_LIGHT, FLAT, FLAT, ONE, true)
        b.solid(body(0.3, 0.33, 0.5), O_PLATE, FLAT, FLAT, ONE, true)
        b.solid(body(0.45, 0.53, 0.62), O_DARK, FLAT, FLAT, ONE, true)
        b.solid(body(0.3, 0.65, 0.84), O_PLATE, FLAT, FLAT, ONE, true)
        b.solid(body(0.6, 0.87, 0.97), O_LIGHT, FLAT, FLAT, ONE, true)
        for (const t of [0.315, 0.515, 0.635, 0.855]) b.glow(body(0.12, t - 0.006, t + 0.006), glow, 1.8, FLAT, FLAT, ONE, true)
        // A lit spine down the leading edge and ports along the flank.
        b.glow(along(new THREE.BoxGeometry(0.2, 0.2, len * 0.62).translate(0, -3.9, len * 0.55), from, to), glow, 2, FLAT, FLAT, ONE, true)
        for (let i = 0; i < 9; i++) {
            if (i % 4 === 2) continue
            b.glow(along(new THREE.BoxGeometry(0.12, 0.34, 0.9).translate(side * -2.12, 0.4, len * (0.36 + i * 0.055)), from, to), i % 3 ? VIOLET : PALE, 1.7, FLAT, FLAT, ONE, true)
        }
        // Root fairing on the hull shoulder.
        b.solid(block(7, 5, 11, 0.5), O_PLATE, [10.4, 7.4 * side, 25.5], [0, 0, side * -0.6], ONE, true)
        b.solid(block(7.6, 1, 8, 0.2), O_LIGHT, [10.8, 7.8 * side, 25.5], [0, 0, side * -0.6], ONE, true)
    }

    return { pylons, citadels, batteries, hangars }
}

// ─── Rotors ────────────────────────────────────────────────────────────────

/** A blade section with its edge outward; the blunt back is 1.7 inboard of the centreline. */
const BLADE: Pt[] = [[2.6, 0], [0.6, 1.7], [-1.2, 2.0], [-1.7, 0.8], [-1.7, -0.8], [-1.2, -2.0], [0.6, -1.7]]

/**
 * One rotor segment, built around its own centre so it tumbles well when the
 * ring breaks up. `sharp` is which way the edge faces; `lead` is the end that
 * goes first as the rotor turns.
 */
function rotorSegment(glow: number, R: number, span: number, scale: number, sharp: 1 | -1, lead: 1 | -1, tether: [number, number], seed: number) {
    const b = new ModelBuilder()
    const rnd = mulberry32(seed)
    const P: Vec3 = [0, -R, 0]
    const section = grow(sharp > 0 ? BLADE : flipR(BLADE), scale)
    const back = -sharp * 1.7 * scale
    // A blunt leading end and a long tapering tail; the back stays on its circle.
    const taper: Shape = (t) => {
        const s = lead < 0 ? t : 1 - t
        const k = 0.26 + 0.74 * smooth(Math.min(1, s / 0.1)) * smooth(Math.min(1, (1 - s) / 0.45))
        return [k, back * (1 - k)]
    }
    const arc = (outline: Pt[], t0: number, t1: number, steps: number) => hoop(R, outline, -span / 2 + span * t0, -span / 2 + span * t1, steps, t => taper(t0 + (t1 - t0) * t))
    const at = (s: number) => lead < 0 ? s : 1 - s
    const run = (s0: number, s1: number): [number, number] => lead < 0 ? [s0, s1] : [1 - s1, 1 - s0]

    b.solid(arc(section, 0, 1, 18), O_DARK, P)
    // Armour over the back and both faces, in runs with open seams.
    const face = sharp > 0 ? { back: 3, fore: 5, aft: 1, chamfer: 4, flanks: [0, 6] } : { back: 2, fore: 0, aft: 4, chamfer: 1, flanks: [5, 6] }
    for (let i = 0; i < 5; i++) {
        const [t0, t1] = run(0.06 + i * 0.17, 0.06 + i * 0.17 + 0.155)
        const shades = [O_PLATE, O_LIGHT, 0x322e3e]
        b.solid(arc(inlay(section, face.back, 0.5, 0.74 * scale, 0.22 * scale, 0.1), t0, t1, 4), i === 1 ? GUNMETAL : shades[Math.floor(rnd() * 3)]!, P)
        b.solid(arc(inlay(section, face.fore, 0.5, 0.78 * scale, 0.16 * scale, 0.1), t0, t1, 4), shades[Math.floor(rnd() * 3)]!, P)
        b.solid(arc(inlay(section, face.chamfer, 0.5, 0.52 * scale, 0.16 * scale, 0.1), t0, t1, 4), shades[Math.floor(rnd() * 3)]!, P)
        b.solid(arc(inlay(section, face.aft, 0.5, 0.78 * scale, 0.16 * scale, 0.1), t0, t1, 4), shades[Math.floor(rnd() * 3)]!, P)
        // Ribs between the runs and ports in the back plate.
        b.solid(arc(grow(section, 1.1), at(0.06 + i * 0.17 + 0.1625) - 0.006, at(0.06 + i * 0.17 + 0.1625) + 0.006, 1), O_LIGHT, P)
        if (rnd() < 0.75) {
            const mid = (t0 + t1) / 2
            b.glow(arc(inlay(section, face.back, rnd() < 0.5 ? 0.3 : 0.7, 0.14 * scale, 0.05, 0.34 * scale), mid - 0.03, mid + 0.03, 2), rnd() < 0.25 ? PALE : VIOLET, 1.7, P)
        }
    }
    // The edge is lit from end to end, with a fainter inlay down both flanks.
    const tipR = sharp * 2.6 * scale
    const edge: Pt[] = [[tipR + (sharp > 0 ? 0.2 : 0.14), 0], [tipR, 0.15], [tipR - (sharp > 0 ? 0.14 : 0.2), 0], [tipR, -0.15]]
    b.glow(arc(edge, 0, 1, 18), glow, 2.6, P)
    for (const i of face.flanks) b.glow(arc(inlay(section, i, 0.45, 0.12 * scale, 0.05, 0.03), ...run(0.12, 0.8), 12), glow, 1.5, P)
    // Bone on the leading end, gunmetal on the tail.
    b.solid(arc(grow(section, 1.07), ...run(0, 0.05), 2), BONE, P)
    b.solid(arc(grow(section, 1.1), ...run(0.9, 1), 2), GUNMETAL, P)

    // A tether emitter on the back, its line reaching for the stator.
    const f = ringFrame(0, R + back, 0, 0, R)
    const dir = -sharp
    b.metal(block(2.4 * scale, 0.7, 2.2 * scale, 0.1), O_METAL, f.at(0, dir * 0.3, 0), f.rot)
    b.metal(new THREE.ConeGeometry(0.5, 1.8, 6).rotateX(dir > 0 ? 0 : Math.PI), GUNMETAL, f.at(0, dir * 1.4, 0), f.rot)
    b.glow(octa(0.3), glow, 5, f.at(0, dir * 2.4, 0), f.rot)
    const tip: Vec3 = [0, tether[0] - R, tether[1]]
    b.glow(spar(f.at(0, dir * 2.4, 0), tip, 0.09, 0.03, 4), glow, 1.6)
    return b.build().group
}

function buildRotor(glow: number, R: number, z: number, count: number, gapDeg: number, scale: number, sharp: 1 | -1, lead: 1 | -1, tether: [number, number], seed: number) {
    const group = new THREE.Group()
    group.position.set(0, 0, z)
    const segments: THREE.Object3D[] = []
    for (let i = 0; i < count; i++) {
        const a = (i + 0.5) / count * TAU
        const segment = rotorSegment(glow, R, TAU / count - rad(gapDeg), scale, sharp, lead, tether, seed + i * 7)
        segment.position.set(R * Math.sin(a), R * Math.cos(a), 0)
        segment.rotation.z = -a
        group.add(segment)
        segments.push(segment)
    }
    return { group, segments }
}

// ─── The ship ──────────────────────────────────────────────────────────────

const STRUT_D: Vec3 = [STRUT_TIP[0] - STRUT_ROOT[0], STRUT_TIP[1] - STRUT_ROOT[1], STRUT_TIP[2] - STRUT_ROOT[2]]
const STRUT_LEN2 = STRUT_D[0] * STRUT_D[0] + STRUT_D[1] * STRUT_D[1] + STRUT_D[2] * STRUT_D[2]

function inside(x: number, y: number, z: number) {
    const ax = Math.abs(x)
    const ay = Math.abs(y)
    const dz = z - CORE_Z
    if (x * x + y * y + dz * dz < CORE_R * CORE_R) return true
    const r = Math.hypot(x, y)
    if (r > 24) {
        if (Math.hypot(r - STATOR_R, z - STATOR_Z) < 4.6) return true
        if (Math.hypot(r - INNER_R, z - INNER_Z) < 2.5) return true
        if (Math.hypot(r - OUTER_R, z - OUTER_Z) < 2.5 * OUTER_SCALE) return true
    }
    // Struts, folded into one quadrant.
    if (r > 9 && r < 40) {
        const px = ax - STRUT_ROOT[0]
        const py = ay - STRUT_ROOT[1]
        const pz = z - STRUT_ROOT[2]
        const t = Math.min(1, Math.max(0, (px * STRUT_D[0] + py * STRUT_D[1] + pz * STRUT_D[2]) / STRUT_LEN2))
        const qx = px - STRUT_D[0] * t
        const qy = py - STRUT_D[1] * t
        const qz = pz - STRUT_D[2] * t
        if (qx * qx + qy * qy + qz * qz < STRUT_R * STRUT_R) return true
    }
    if (ax > 17 || z < -68 || z > 64) return false
    for (let i = 0; i < LAYERS.length; i++) {
        const l = LAYERS[i]!
        if (y >= l.y0 && y <= l.y1 && ax < halfOf(l.st, z) + 0.3) return true
    }
    // Tower, drive block, stern blades and the keel.
    if (y > 12 && y < 20 && ax < 5.6 && z > 33 && z < 48) return true
    if (z >= 54 && z < 61 && (r < 7.4 || (Math.abs(ax - 9.8) < 4.4 && Math.abs(ay - 5.4) < 4.3))) return true
    if (ax < 0.9 && ay > 9.6) {
        const h = ay - 9.6
        if (y > 0 ? h < 18.5 && z > 46.5 + h * 0.47 && z < 57.5 + h * 0.29 : h < 23 && z > 44 + h * 0.43 && z < 57.5 + h * 0.27) return true
        if (y < -12 && y > -20.5 && z > -34 + (-12.4 - y) * 0.8 && z < -10 - (-12.4 - y) * 0.35) return true
    }
    return false
}

export function buildHarbinger(glow: number): CapitalModel {
    const b = new ModelBuilder()
    buildSpine(b, glow)
    buildCage(b, glow)
    buildStern(b, glow)
    const ringMounts = buildStator(b, glow)

    // Dorsal battery tubs fore and aft of the ring, and the storm silos behind it.
    const batteries: CapitalMount[] = []
    for (const [x, z] of [[6.6, -16], [8.9, 29]] as const) {
        b.metal(cyl(2.7, 3.3, 1.0, 10), O_VOID, [x, 10.5, z], FLAT, ONE, true)
        b.solid(block(7, 1.2, 7, 0.3), O_PLATE, [x, 10.2, z], FLAT, ONE, true)
        b.glow(ring(2.85, 0.07, 3, 16), glow, 2, [x, 10.98, z], [Math.PI / 2, 0, 0], ONE, true)
        for (const dz of [-3.1, 3.1]) b.solid(block(5.4, 0.7, 0.6, 0.08), GUNMETAL, [x, 10.9, z + dz], FLAT, ONE, true)
        for (const side of [1, -1]) batteries.push({ position: new THREE.Vector3(x * side, 11, z), normal: new THREE.Vector3(0, 1, 0) })
    }
    batteries.push(...ringMounts.batteries)
    const silos: CapitalMount[] = []
    for (const z of [20.4, 25.6, 30.8]) {
        b.solid(block(5.6, 1.0, 4.6, 0.2), O_LIGHT, [0, 12.9, z], [-0.12, 0, 0])
        b.metal(cyl(1.7, 2.0, 0.9, 10), O_VOID, [0, 13.3, z], [-0.24, 0, 0])
        b.metal(ring(1.78, 0.14, 4, 16), BONE, [0, 13.72, z - 0.1], [Math.PI / 2 - 0.24, 0, 0])
        b.glow(ring(1.35, 0.08, 3, 16), glow, 2.4, [0, 13.74, z - 0.1], [Math.PI / 2 - 0.24, 0, 0])
        for (const x of [-2.3, 2.3]) b.glow(box(0.16, 0.12, 3), VIOLET, 1.8, [x, 13.45, z], [-0.12, 0, 0])
        silos.push({ position: new THREE.Vector3(0, 13.8, z - 0.1), normal: new THREE.Vector3(0, 1, -0.25).normalize() })
    }

    const built = b.build()
    const inner = buildRotor(glow, INNER_R, INNER_Z, 6, 9, 1, -1, 1, [36.1, STATOR_Z - 3.9 - INNER_Z], 311)
    const outer = buildRotor(glow, OUTER_R, OUTER_Z, 8, 8, OUTER_SCALE, 1, -1, [43.3, 10.2 - OUTER_Z], 733)
    built.group.add(inner.group, outer.group)

    const bounds = new THREE.Box3().setFromObject(built.group)
    const radius = Math.max(-bounds.min.x, bounds.max.x, -bounds.min.y, bounds.max.y, -bounds.min.z, bounds.max.z)

    const keepOut: [number, number, number, number][] = [[0, 0, -50, 6], [0, 0, -34, 10], [0, 0, -18, 13], [0, 0, CORE_Z, 14], [0, 0, 24, 15], [0, 0, 40, 18], [0, 2, 54, 17]]
    for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU
        keepOut.push([Math.sin(a) * STATOR_R, Math.cos(a) * STATOR_R, STATOR_Z, 5])
    }

    return {
        group: built.group,
        radius,
        engines: built.engines,
        batteries,
        citadels: ringMounts.citadels,
        pylons: ringMounts.pylons,
        silos,
        hangars: ringMounts.hangars,
        core: new THREE.Vector3(0, 0, CORE_Z),
        rotors: [{ object: inner.group, speed: 0.22 }, { object: outer.group, speed: -0.14 }],
        debris: [...inner.segments, ...outer.segments],
        inside,
        keepOut
    }
}
