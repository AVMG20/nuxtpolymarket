import * as THREE from 'three'
import { monotone } from './car-body'
import { SIDES, type Kit, type Pt, type Slot } from './car-kit'
import { panelOut, Tris } from './car-roadster-body'
import { WHEELBASE } from './config'

/** The Spectre's shell: a prototype's teardrop cockpit between two tall fender pontoons, with an open tunnel down each side of it. Sections flow through splines along the car and round off across it; patches of other materials are laid on the same skin. Everything faces -z. */

export const NOSE_U = 2.58
export const TAIL_U = -2.46
export const AXLE_U = WHEELBASE / 2
export const WHEEL_R = 0.4

/** Bends shallower than this shade smooth, so a rounded-off corner reads as a curve and a real edge stays crisp. */
const CREASE = THREE.MathUtils.degToRad(38)
/** Half-width of the wheel tubs, and the belly's height. */
const TUB_X = 0.64
const BELLY_Y = 0.17
/** How far the mouth and the open tail run into the shell. */
const MOUTH_DEPTH = 0.16
export const TAIL_DEPTH = 0.24
/** Where the canopy's glass starts and ends. */
export const COWL_U = 1
export const DECK_U = -0.95

/**
 * Sections, nose first: u, then (x, y) on the right from centreline to sill.
 * 0 spine, 1 canopy shoulder, 2 canopy foot, 3 and 4 the tunnel's floor, 5 and 6 the fender's top, 7 shoulder, 8 widest point, 9 rocker, 10 sill.
 */
const KEYS: [number, Pt[]][] = [
    // The nose ends in a thin lip round the mouth: the cone in the middle, a fender pod each side and a channel between.
    [NOSE_U, [[0, 0.365], [0.15, 0.36], [0.21, 0.345], [0.29, 0.255], [0.5, 0.255], [0.57, 0.355], [0.73, 0.36], [0.8, 0.33], [0.825, 0.29], [0.81, 0.24], [0.78, 0.2]]],
    [2.56, [[0, 0.414], [0.16, 0.406], [0.225, 0.388], [0.3, 0.275], [0.505, 0.275], [0.575, 0.4], [0.75, 0.408], [0.83, 0.368], [0.86, 0.3], [0.845, 0.235], [0.8, 0.19]]],
    [2.5, [[0, 0.47], [0.17, 0.46], [0.25, 0.44], [0.325, 0.305], [0.52, 0.305], [0.59, 0.49], [0.78, 0.5], [0.88, 0.45], [0.915, 0.36], [0.895, 0.25], [0.84, 0.18]]],
    [2.3, [[0, 0.546], [0.2, 0.534], [0.3, 0.512], [0.375, 0.395], [0.54, 0.4], [0.62, 0.62], [0.86, 0.635], [0.945, 0.57], [0.975, 0.44], [0.94, 0.28], [0.87, 0.17]]],
    [2, [[0, 0.615], [0.22, 0.606], [0.33, 0.588], [0.41, 0.5], [0.56, 0.5], [0.64, 0.765], [0.9, 0.785], [0.97, 0.7], [0.992, 0.5], [0.95, 0.3], [0.87, 0.17]]],
    [1.7, [[0, 0.676], [0.24, 0.666], [0.35, 0.648], [0.43, 0.575], [0.58, 0.575], [0.66, 0.865], [0.92, 0.885], [0.985, 0.78], [0.998, 0.54], [0.95, 0.32], [0.87, 0.17]]],
    [AXLE_U, [[0, 0.726], [0.26, 0.716], [0.37, 0.7], [0.45, 0.62], [0.58, 0.62], [0.66, 0.905], [0.93, 0.92], [0.99, 0.82], [1, 0.56], [0.95, 0.33], [0.87, 0.17]]],
    // The canopy lifts out of the bonnet here, and the fenders start to fall away behind the wheels.
    [COWL_U, [[0, 0.8], [0.3, 0.795], [0.42, 0.77], [0.48, 0.65], [0.58, 0.65], [0.66, 0.88], [0.92, 0.89], [0.985, 0.8], [1, 0.56], [0.95, 0.33], [0.87, 0.17]]],
    [0.55, [[0, 0.99], [0.3, 0.97], [0.47, 0.8], [0.52, 0.66], [0.6, 0.66], [0.67, 0.79], [0.9, 0.8], [0.972, 0.73], [0.995, 0.55], [0.945, 0.33], [0.86, 0.17]]],
    [0.05, [[0, 1.09], [0.3, 1.065], [0.49, 0.82], [0.54, 0.66], [0.62, 0.66], [0.69, 0.74], [0.9, 0.75], [0.968, 0.7], [0.995, 0.55], [0.94, 0.33], [0.86, 0.17]]],
    [-0.5, [[0, 1.07], [0.28, 1.045], [0.47, 0.82], [0.53, 0.67], [0.62, 0.67], [0.69, 0.76], [0.905, 0.77], [0.972, 0.71], [1, 0.56], [0.945, 0.35], [0.86, 0.17]]],
    // The cockpit tapers to a spine while the rear fenders swell over the wheels.
    [-1, [[0, 1], [0.22, 0.985], [0.4, 0.83], [0.48, 0.69], [0.59, 0.69], [0.67, 0.86], [0.93, 0.88], [0.995, 0.8], [1.01, 0.6], [0.955, 0.4], [0.87, 0.18]]],
    [-AXLE_U, [[0, 0.93], [0.15, 0.92], [0.3, 0.82], [0.4, 0.7], [0.58, 0.7], [0.66, 0.93], [0.95, 0.945], [1.01, 0.84], [1.02, 0.62], [0.965, 0.42], [0.87, 0.19]]],
    // Behind the wheels the tunnels climb out onto the deck, so the haunches and the spine run into one tail.
    [-1.95, [[0, 0.875], [0.13, 0.868], [0.26, 0.815], [0.36, 0.755], [0.57, 0.755], [0.65, 0.895], [0.92, 0.905], [0.99, 0.815], [1.005, 0.64], [0.955, 0.44], [0.86, 0.22]]],
    [-2.3, [[0, 0.835], [0.12, 0.83], [0.24, 0.805], [0.34, 0.79], [0.56, 0.79], [0.64, 0.845], [0.88, 0.85], [0.955, 0.78], [0.975, 0.62], [0.93, 0.46], [0.83, 0.27]]],
    // The deck's lip, then the tail turns under and its corners turn in, down to the rim of the opening.
    [-2.38, [[0, 0.815], [0.12, 0.812], [0.24, 0.795], [0.34, 0.785], [0.56, 0.785], [0.64, 0.82], [0.84, 0.82], [0.915, 0.75], [0.935, 0.6], [0.895, 0.45], [0.8, 0.3]]],
    [-2.43, [[0, 0.74], [0.12, 0.74], [0.24, 0.735], [0.34, 0.73], [0.56, 0.73], [0.63, 0.74], [0.76, 0.735], [0.81, 0.69], [0.83, 0.56], [0.8, 0.44], [0.73, 0.34]]],
    [TAIL_U, [[0, 0.655], [0.12, 0.655], [0.24, 0.655], [0.34, 0.655], [0.52, 0.655], [0.6, 0.655], [0.68, 0.645], [0.72, 0.6], [0.735, 0.52], [0.72, 0.43], [0.67, 0.37]]]
]
const KEY_COLS = KEYS[0]![1].length

const ascending = [...KEYS].sort((a, b) => a[0] - b[0])
const keyUs = ascending.map(k => k[0])
const channels = Array.from({ length: KEY_COLS }, (_, c) => [
    monotone(keyUs, ascending.map(k => k[1][c]![0])),
    monotone(keyUs, ascending.map(k => k[1][c]![1]))
] as const)

/** The key points of the section at u. */
export function sectionAt(u: number): Pt[] {
    return channels.map(([x, y]) => [x(u), y(u)])
}

/** How far each key point's corner is cut back into an arc; 0 keeps the edge sharp, which every change of material needs. */
const SOFT = [0, 0.11, 0.05, 0.04, 0.04, 0.07, 0.1, 0.1, 0.12, 0, 0]
/** Segments to a rounded corner; even, so the key point keeps a middle to measure from. */
const ARC = 4
/** The key panel each panel of the rounded section belongs to; a rounded corner is split down its middle between the two it joins. */
const PANEL_SRC = SOFT.flatMap((r, k) => k === 0 ? [] : r > 0 ? [...Array<number>(ARC / 2 + 1).fill(k - 1), ...Array<number>(ARC / 2).fill(k)] : [k - 1])
const COLS = PANEL_SRC.length + 1
/** Where each key point sits in the rounded section. */
const CENTRE = SOFT.map((r, k) => SOFT.slice(0, k).reduce((n, q) => n + (q > 0 ? ARC + 1 : 1), 0) + (r > 0 ? ARC / 2 : 0))

/** The section with its soft corners rounded off, which is what the shell is built from. */
function rounded(pts: Pt[]): Pt[] {
    const out: Pt[] = []
    pts.forEach((p, k) => {
        const r = SOFT[k]!
        if (!r) {
            out.push(p)
            return
        }
        const [a, b] = [pts[k - 1]!, pts[k + 1]!].map((q): Pt => {
            const len = Math.hypot(q[0] - p[0], q[1] - p[1])
            const f = len > 1e-6 ? Math.min(0.45, r / len) : 0
            return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]
        }) as [Pt, Pt]
        for (let i = 0; i <= ARC; i++) {
            const t = i / ARC
            const w = [(1 - t) * (1 - t), 2 * t * (1 - t), t * t]
            out.push([a[0] * w[0]! + p[0] * w[1]! + b[0] * w[2]!, a[1] * w[0]! + p[1] * w[1]! + b[1] * w[2]!])
        }
    })
    return out
}

/** A wheel arch: centred over the axle at u, `a` long each way and `b` tall over the hub; `n` 2 is round, higher squares it off. */
interface Arch { u: number, a: number, b: number, n: number }
const ARCH_Y = WHEEL_R
const ARCHES: Arch[] = [
    { u: AXLE_U, a: 0.48, b: 0.455, n: 2.2 },
    { u: -AXLE_U, a: 0.5, b: 0.465, n: 2.6 }
]

function archAt(u: number) {
    return ARCHES.find(a => Math.abs(u - a.u) < a.a) ?? null
}

/** Height of the arch's edge at u, or -Infinity away from the arches. */
function archEdge(u: number) {
    const arch = archAt(u)
    if (!arch) return -Infinity
    const d = Math.abs(u - arch.u) / arch.a
    return ARCH_Y + arch.b * Math.pow(Math.max(0, 1 - Math.pow(d, arch.n)), 1 / arch.n)
}

/** The section with everything under the arch's edge folded up onto it, so the column count never changes. */
function cutSection(u: number, pts: Pt[]): Pt[] {
    const edge = archEdge(u)
    if (edge === -Infinity) return pts
    let j = pts.length - 1
    while (j > 0 && pts[j]![1] < edge) j--
    if (j === pts.length - 1) return pts
    const a = pts[j]!
    const b = pts[j + 1]!
    const t = THREE.MathUtils.clamp((a[1] - edge) / (a[1] - b[1] || 1), 0, 1)
    const cut: Pt = [a[0] + (b[0] - a[0]) * t, edge]
    return pts.map((p, k) => k > j ? cut : p)
}

/** Stations along the car, nose first: close enough for the splines to read as curves, and packed round the arches. */
function stations() {
    const us = new Set<number>([...keyUs, COWL_U, DECK_U])
    for (let u = TAIL_U + 0.06; u < NOSE_U - 0.2; u += 0.06) us.add(Math.round(u * 1000) / 1000)
    // Both ends turn under fast, so they are cut finer.
    for (let u = TAIL_U + 0.01; u < TAIL_U + 0.13; u += 0.01) us.add(Math.round(u * 1000) / 1000)
    for (let u = NOSE_U - 0.2; u < NOSE_U - 0.005; u += u > NOSE_U - 0.07 ? 0.01 : 0.025) us.add(Math.round(u * 1000) / 1000)
    for (const arch of ARCHES) {
        for (let i = 0; i <= 24; i++) us.add(arch.u + arch.a * Math.cos(i / 24 * Math.PI) * 0.9999)
        // The edge steps down to the sill just outside the arch.
        us.add(arch.u - arch.a - 1e-3)
        us.add(arch.u + arch.a + 1e-3)
    }
    return [...us].sort((a, b) => b - a)
}

/** Which material key panel j wears, at u. */
function panelSlot(j: number, u: number): Slot {
    if (j === 9) return 'trim'
    if (j <= 1 && u < COWL_U && u > DECK_U) return 'glass'
    // The tunnels are bare carbon beside the cockpit.
    if (j === 3 && u < COWL_U && u > DECK_U) return 'trim'
    return 'paint'
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** Hollows an end of the shell: dark walls run `depth` in from the section's own outline to a vent mesh, so the mouth and the tail read as openings. */
function addRecess(kit: Kit, u: number, depth: number, nose: boolean) {
    const sec = rounded(sectionAt(u))
    const outline = [...sec, ...sec.slice(1).reverse().map((p): Pt => [-p[0], p[1]])]
    const pts = outline.filter((p, i) => i === 0 || Math.hypot(p[0] - outline[i - 1]![0], p[1] - outline[i - 1]![1]) > 1e-5)
    const z = -u + (nose ? depth : -depth)
    const walls = new Tris()
    const hint = new THREE.Vector3()
    // The outline runs clockwise from the spine, so the inside is to the right of each edge.
    pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length]!
        hint.set(q[1] - p[1], p[0] - q[0], 0).normalize()
        walls.quad(v3(p[0], p[1], -u), v3(q[0], q[1], -u), v3(q[0], q[1], z), v3(p[0], p[1], z), hint)
    })
    const wallGeo = walls.build(true, CREASE)
    kit.add('trim', wallGeo)
    wallGeo.dispose()
    // A shape's uv is its own outline, so it is already in metres, as the mesh wants.
    const back = new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))))
    kit.add('mesh', back, 0, 0, z, 0, nose ? Math.PI : 0)
    back.dispose()
}

/** The painted shell, canopy and carbon tunnels, the closing faces at each end, the belly and the wheel tubs. */
export function addBody(kit: Kit) {
    const us = stations()
    const raw = us.map(u => rounded(sectionAt(u)))
    const cut = us.map((u, i) => cutSection(u, raw[i]!))
    const bySlot = new Map<Slot, Tris>()
    const tris = (slot: Slot) => {
        let t = bySlot.get(slot)
        if (!t) bySlot.set(slot, t = new Tris())
        return t
    }
    const hint = new THREE.Vector3()
    const toArch = new THREE.Vector3()
    for (let i = 0; i < us.length - 1; i++) {
        const ua = us[i]!
        const ub = us[i + 1]!
        const um = (ua + ub) / 2
        const mid = rounded(sectionAt(um))
        const arch = archAt(ua) ?? archAt(ub)
        for (let j = 0; j < COLS - 1; j++) {
            const t = tris(panelSlot(PANEL_SRC[j]!, um))
            for (const side of SIDES) {
                const p = (pt: Pt, u: number) => v3(side * pt[0], pt[1], -u)
                panelOut(mid, j, side, hint)
                // In an arch, the walls where the edge steps down face the wheel.
                if (arch) hint.add(toArch.set(0, 0, um - arch.u).normalize())
                t.quad(p(cut[i]![j]!, ua), p(cut[i]![j + 1]!, ua), p(cut[i + 1]![j + 1]!, ub), p(cut[i + 1]![j]!, ub), hint)
            }
        }
    }

    // The belly runs sill to sill, and between the tubs under the arches; it climbs to the tail as the diffuser's roof.
    const trim = tris('trim')
    const down = v3(0, -1, 0)
    const belly = (i: number) => {
        const u = us[i]!
        if (archAt(u)) return { x: TUB_X, y: BELLY_Y, z: -u }
        const sill = raw[i]![COLS - 1]!
        return { x: sill[0], y: sill[1], z: -u }
    }
    for (let i = 0; i < us.length - 1; i++) {
        const a = belly(i)
        const b = belly(i + 1)
        trim.quad(v3(-a.x, a.y, a.z), v3(a.x, a.y, a.z), v3(b.x, b.y, b.z), v3(-b.x, b.y, b.z), down)
    }

    // Each tub: a liner from the arch's edge in to the tub wall, and the wall itself, so the wheel sits in shadow.
    for (const arch of ARCHES) {
        const inside = us.filter(u => Math.abs(u - arch.u) < arch.a)
        const front = arch.u + arch.a + 1e-3
        const back = arch.u - arch.a - 1e-3
        const sillX = (u: number) => rounded(sectionAt(u))[COLS - 1]![0]
        const rim = [
            { u: front, y: BELLY_Y, x: sillX(front) },
            ...inside.map(u => ({ u, y: archEdge(u), x: cutSection(u, rounded(sectionAt(u)))[COLS - 1]![0] })),
            { u: back, y: BELLY_Y, x: sillX(back) }
        ]
        for (const side of SIDES) {
            for (let k = 0; k < rim.length - 1; k++) {
                const a = rim[k]!
                const b = rim[k + 1]!
                hint.set(0, ARCH_Y - (a.y + b.y) / 2, -arch.u + (a.u + b.u) / 2).normalize()
                trim.quad(v3(side * a.x, a.y, -a.u), v3(side * b.x, b.y, -b.u), v3(side * TUB_X, b.y, -b.u), v3(side * TUB_X, a.y, -a.u), hint)
            }
            trim.fan(v3(side * TUB_X, ARCH_Y, -arch.u), rim.map(r => v3(side * TUB_X, r.y, -r.u)), v3(side, 0, 0))
        }
    }

    for (const [slot, t] of bySlot) {
        if (t.empty) continue
        const geo = t.build(true, CREASE)
        kit.add(slot, geo)
        geo.dispose()
    }
    // Both ends are hollow: the mouth under the nose, and the tail behind its light bars.
    addRecess(kit, NOSE_U, MOUTH_DEPTH, true)
    addRecess(kit, TAIL_U, TAIL_DEPTH, false)
}

/** Lays the vent mesh flat on a thin part: uv in metres across its two longest axes. */
function meshUv(geo: THREE.BufferGeometry) {
    geo.computeBoundingBox()
    const size = geo.boundingBox!.getSize(new THREE.Vector3()).toArray()
    const [a, b] = [0, 1, 2].sort((i, j) => size[j]! - size[i]!)
    const position = geo.attributes.position!
    const uv = new Float32Array(position.count * 2)
    for (let i = 0; i < position.count; i++) {
        uv[i * 2] = position.getComponent(i, a!)
        uv[i * 2 + 1] = position.getComponent(i, b!)
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

const ACROSS_EPS = 0.02
const ALONG_EPS = 0.01

/** The point at c across a rounded section: c counts key points from the spine, so 5.5 is half-way over the fender's top, measured along the skin. */
function sectionPoint(sec: Pt[], c: number): Pt {
    const j = Math.min(Math.max(Math.floor(c), 0), KEY_COLS - 2)
    const i0 = CENTRE[j]!
    const i1 = CENTRE[j + 1]!
    let total = 0
    for (let i = i0; i < i1; i++) total += Math.hypot(sec[i + 1]![0] - sec[i]![0], sec[i + 1]![1] - sec[i]![1])
    let left = THREE.MathUtils.clamp(c - j, 0, 1) * total
    for (let i = i0; i < i1; i++) {
        const a = sec[i]!
        const b = sec[i + 1]!
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (left <= len || i === i1 - 1) {
            const t = len > 1e-9 ? Math.min(1, left / len) : 0
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        }
        left -= len
    }
    return sec[i1]!
}

const across = new THREE.Vector3()
const along = new THREE.Vector3()

/** A point on the shell at u along the car and c across it (see `sectionPoint`), lifted off the skin, with the skin's normal there. */
export function surfaceAt(u: number, c: number, side: number, lift = 0, normal = new THREE.Vector3()) {
    const max = KEY_COLS - 1
    const sec = rounded(sectionAt(u))
    const p = sectionPoint(sec, c)
    const lo = sectionPoint(sec, Math.max(0, c - ACROSS_EPS))
    const hi = sectionPoint(sec, Math.min(max, c + ACROSS_EPS))
    // Level across the centreline, where the two sides meet.
    if (c < ACROSS_EPS) across.set(1, 0, 0)
    else across.set(hi[0] - lo[0], hi[1] - lo[1], 0)
    const fore = sectionPoint(rounded(sectionAt(u + ALONG_EPS)), c)
    const aft = sectionPoint(rounded(sectionAt(u - ALONG_EPS)), c)
    along.set(fore[0] - aft[0], fore[1] - aft[1], -2 * ALONG_EPS)
    normal.crossVectors(across, along)
    if (normal.lengthSq() < 1e-12) normal.set(-across.y, across.x, 0)
    normal.normalize()
    // Outward is to the left of the way across, whatever the slope along the car.
    if (normal.x * -across.y + normal.y * across.x < 0) normal.negate()
    normal.x *= side
    return { pos: v3(side * p[0], p[1], -u).addScaledVector(normal, lift), normal }
}

/**
 * A patch of another material lying on the shell, on both sides of the car: lamps, vents, shut lines, pillars.
 * `at` maps the unit square to [u, c], so its edges can curve; it is cut `na` by `nb` and follows the skin at every cut.
 */
export function addPatch(kit: Kit, slot: Slot, at: (a: number, b: number) => [number, number], na: number, nb: number, lift = 0.004) {
    const t = new Tris()
    const hint = new THREE.Vector3()
    for (const side of SIDES) {
        const grid: THREE.Vector3[][] = []
        for (let i = 0; i <= na; i++) {
            const row: THREE.Vector3[] = []
            for (let k = 0; k <= nb; k++) row.push(surfaceAt(...at(i / na, k / nb), side, lift, hint).pos)
            grid.push(row)
        }
        for (let i = 0; i < na; i++) {
            for (let k = 0; k < nb; k++) {
                surfaceAt(...at((i + 0.5) / na, (k + 0.5) / nb), side, 0, hint)
                t.quad(grid[i]![k]!, grid[i]![k + 1]!, grid[i + 1]![k + 1]!, grid[i + 1]![k]!, hint)
            }
        }
    }
    if (t.empty) return
    const geo = t.build(true, CREASE)
    if (slot === 'mesh') meshUv(geo)
    kit.add(slot, geo)
    geo.dispose()
}

/** A straight-edged patch on key panel j, for u0 to u1 and t0 to t1 across it. */
export function addStrip(kit: Kit, slot: Slot, j: number, u0: number, u1: number, t0: number, t1: number, lift = 0.004, steps = 0) {
    const na = steps || Math.max(1, Math.ceil(Math.abs(u1 - u0) / 0.05))
    addPatch(kit, slot, (a, b) => [u0 + (u1 - u0) * a, j + t0 + (t1 - t0) * b], na, Math.max(2, Math.ceil(Math.abs(t1 - t0) * 12)), lift)
}
