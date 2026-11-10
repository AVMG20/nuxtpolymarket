import * as THREE from 'three'
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import { SIDES, type Kit, type Pt, type Slot } from './car-kit'
import { WHEELBASE } from './config'

/** The Roadster's shell: flat panels and crisp creases between keyframed sections, unlike the lofted cars. Everything faces -z. */

export const NOSE_U = 2.58
export const TAIL_U = -2.46
export const AXLE_U = WHEELBASE / 2
/** Bigger wheels than the Kestrel's, on low-profile tyres. */
export const WHEEL_R = 0.4

/** Panels meeting at a sharper angle than this keep a hard edge; shallower bends shade smooth. */
const CREASE = THREE.MathUtils.degToRad(20)
/** Half-width of the wheel tubs, and the belly's height. */
const TUB_X = 0.6
const BELLY_Y = 0.17
/** Sections, nose first: u, then (x, y) on the right from centreline to sill; straight lines between them keep every panel flat. */
const KEYS: [number, Pt[]][] = [
    // A thin, low tip carrying the light bar, then one long wedge of bonnet up to the windscreen.
    [NOSE_U, [[0, 0.46], [0.3, 0.46], [0.32, 0.463], [0.6, 0.455], [0.78, 0.44], [0.81, 0.42], [0.8, 0.41], [0.78, 0.4]]],
    [2.5, [[0, 0.49], [0.31, 0.49], [0.335, 0.502], [0.64, 0.505], [0.87, 0.485], [0.93, 0.4], [0.9, 0.32], [0.84, 0.28]]],
    [2.42, [[0, 0.51], [0.315, 0.512], [0.34, 0.526], [0.65, 0.535], [0.9, 0.515], [0.955, 0.42], [0.92, 0.31], [0.85, 0.17]]],
    [2.2, [[0, 0.57], [0.325, 0.574], [0.35, 0.59], [0.66, 0.63], [0.94, 0.625], [0.98, 0.49], [0.93, 0.34], [0.86, 0.17]]],
    [1.95, [[0, 0.635], [0.335, 0.64], [0.36, 0.658], [0.665, 0.73], [0.96, 0.74], [0.995, 0.54], [0.94, 0.36], [0.87, 0.17]]],
    // The fender crest levels out over the front wheel, higher than the bonnet between.
    [1.66, [[0, 0.71], [0.35, 0.715], [0.375, 0.735], [0.665, 0.84], [0.97, 0.86], [0.998, 0.57], [0.94, 0.37], [0.87, 0.17]]],
    [AXLE_U, [[0, 0.77], [0.36, 0.775], [0.385, 0.795], [0.665, 0.87], [0.975, 0.885], [1.0, 0.6], [0.94, 0.38], [0.87, 0.17]]],
    // The bonnet's outer facets run out into the A-pillars, so the side glass starts right at the windscreen.
    [0.95, [[0, 0.85], [0.63, 0.858], [0.65, 0.862], [0.68, 0.862], [0.96, 0.86], [0.995, 0.6], [0.93, 0.37], [0.87, 0.17]]],
    [0.5, [[0, 1.0], [0.5, 0.975], [0.53, 0.97], [0.75, 0.835], [0.95, 0.835], [0.99, 0.61], [0.92, 0.36], [0.86, 0.17]]],
    [-0.05, [[0, 1.12], [0.47, 1.095], [0.5, 1.09], [0.78, 0.83], [0.95, 0.825], [0.99, 0.62], [0.91, 0.35], [0.85, 0.17]]],
    // A long fastback that falls all the way to the tail's lip.
    [-0.5, [[0, 1.105], [0.47, 1.08], [0.5, 1.075], [0.8, 0.84], [0.965, 0.83], [1.0, 0.64], [0.92, 0.38], [0.85, 0.17]]],
    [-1.0, [[0, 1.05], [0.45, 1.03], [0.48, 1.025], [0.81, 0.865], [0.99, 0.86], [1.01, 0.66], [0.94, 0.49], [0.86, 0.18]]],
    [-AXLE_U, [[0, 0.99], [0.42, 0.975], [0.45, 0.97], [0.78, 0.9], [1.0, 0.92], [1.02, 0.69], [0.96, 0.53], [0.87, 0.19]]],
    [-1.9, [[0, 0.905], [0.37, 0.9], [0.4, 0.898], [0.72, 0.905], [0.97, 0.9], [1.0, 0.72], [0.95, 0.55], [0.86, 0.21]]],
    // The tail face is short and narrower at the top, where the light bar sits.
    [TAIL_U, [[0, 0.8], [0.32, 0.8], [0.35, 0.8], [0.58, 0.8], [0.78, 0.795], [0.88, 0.62], [0.84, 0.46], [0.74, 0.28]]]
]
const COLS = KEYS[0]![1].length

/** Where the panels change material along the car. */
const COWL_U = 0.95
const VENT_U = 1.22
const DECK_U = -2.05
const SIDE_GLASS_END_U = -1.35

/** The section at u, straight between the keyframes. */
export function sectionAt(u: number): Pt[] {
    let i = 0
    while (i < KEYS.length - 2 && u < KEYS[i + 1]![0]) i++
    const [u0, a] = KEYS[i]!
    const [u1, b] = KEYS[i + 1]!
    const t = THREE.MathUtils.clamp((u - u0) / (u1 - u0), 0, 1)
    return a.map((p, j) => [p[0] + (b[j]![0] - p[0]) * t, p[1] + (b[j]![1] - p[1]) * t])
}

/** A wheel arch: centred over the axle at u, `a` long each way and `b` tall over ARCH_Y; `n` 2 is round, higher squares it off. */
interface Arch { u: number, a: number, b: number, n: number }
const ARCH_Y = WHEEL_R
const ARCHES: Arch[] = [
    { u: AXLE_U, a: 0.48, b: 0.46, n: 2 },
    // The rear arch is big and squared off.
    { u: -AXLE_U, a: 0.52, b: 0.475, n: 3.4 }
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
    // Clamped, so an edge above the whole section folds it flat instead of flinging a point off.
    const t = THREE.MathUtils.clamp((a[1] - edge) / (a[1] - b[1] || 1), 0, 1)
    const cut: Pt = [a[0] + (b[0] - a[0]) * t, edge]
    return pts.map((p, k) => k > j ? cut : p)
}

/** Stations along the car, nose first: every keyframe and material change, packed round the arches. */
function stations() {
    const us = new Set<number>([...KEYS.map(k => k[0]), COWL_U, VENT_U, DECK_U, SIDE_GLASS_END_U])
    for (const arch of ARCHES) {
        for (let i = 0; i <= 24; i++) us.add(arch.u + arch.a * Math.cos(i / 24 * Math.PI) * 0.9999)
        // The edge steps down to the sill just outside the arch.
        us.add(arch.u - arch.a - 1e-3)
        us.add(arch.u + arch.a + 1e-3)
    }
    return [...us].sort((a, b) => b - a)
}

/** Which material a panel between columns j and j + 1 wears, at u. */
function panelSlot(j: number, u: number): Slot {
    if (j === 6) return 'trim'
    if (j === 0) {
        if (u < COWL_U && u > DECK_U) return 'glass'
        // The matte black vent in the bonnet, ahead of the windscreen (the kit's `rubber` is the dullest black).
        if (u >= COWL_U && u < VENT_U) return 'rubber'
    }
    if (j === 2 && u < COWL_U && u > SIDE_GLASS_END_U) return 'glass'
    return 'paint'
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** Loose triangles, each wound to face its hint; slivers are dropped. */
export class Tris {
    private readonly pos: number[] = []
    private readonly e1 = new THREE.Vector3()
    private readonly e2 = new THREE.Vector3()
    private readonly n = new THREE.Vector3()

    tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, hint: THREE.Vector3) {
        this.n.crossVectors(this.e1.subVectors(b, a), this.e2.subVectors(c, a))
        if (this.n.lengthSq() < 1e-12) return
        const order = this.n.dot(hint) < 0 ? [a, c, b] : [a, b, c]
        for (const v of order) this.pos.push(v.x, v.y, v.z)
    }

    quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, hint: THREE.Vector3) {
        this.tri(a, b, c, hint)
        this.tri(a, c, d, hint)
    }

    /** A fan round `centre` over a closed outline. */
    fan(centre: THREE.Vector3, outline: THREE.Vector3[], hint: THREE.Vector3) {
        for (let i = 0; i < outline.length; i++) this.tri(centre, outline[i]!, outline[(i + 1) % outline.length]!, hint)
    }

    get empty() {
        return this.pos.length === 0
    }

    /** Smooth across shallow bends, sharp across creases. */
    build(creased = true, angle = CREASE) {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
        if (!creased) {
            g.computeVertexNormals()
            return g
        }
        const out = toCreasedNormals(g, angle)
        g.dispose()
        return out
    }
}

/** Outward across a section's panel j on the given side, ignoring the slope along the car. */
export function panelOut(sec: Pt[], j: number, side: number, out = new THREE.Vector3()) {
    const dx = sec[j + 1]![0] - sec[j]![0]
    const dy = sec[j + 1]![1] - sec[j]![1]
    return out.set(-dy * side, dx, 0).normalize()
}

/** The painted shell, glass and dark lower body, the closing faces at each end, the belly and the wheel tubs. */
export function addBody(kit: Kit) {
    const us = stations()
    const raw = us.map(sectionAt)
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
        const mid = sectionAt(um)
        const arch = archAt(ua) ?? archAt(ub)
        for (let j = 0; j < COLS - 1; j++) {
            const t = tris(panelSlot(j, um))
            for (const side of SIDES) {
                const p = (pt: Pt, u: number) => v3(side * pt[0], pt[1], -u)
                panelOut(mid, j, side, hint)
                // In an arch, the walls where the edge steps down face the wheel.
                if (arch) hint.add(toArch.set(0, 0, um - arch.u).normalize())
                t.quad(p(cut[i]![j]!, ua), p(cut[i]![j + 1]!, ua), p(cut[i + 1]![j + 1]!, ub), p(cut[i + 1]![j]!, ub), hint)
            }
        }
    }

    const trim = tris('trim')
    // Each end closes flat: the nose in black under its light bar, the tail in paint round its dark panel.
    for (const [u, sec, facing, slot] of [[NOSE_U, raw[0]!, v3(0, 0, -1), 'trim'], [TAIL_U, raw[raw.length - 1]!, v3(0, 0, 1), 'paint']] as const) {
        const outline = [...sec.map(p => v3(p[0], p[1], -u)), ...[...sec].reverse().map(p => v3(-p[0], p[1], -u))]
        const centre = v3(0, (sec[0]![1] + sec[COLS - 1]![1]) / 2, -u)
        tris(slot).fan(centre, outline, facing)
    }

    // The belly runs sill to sill, and between the tubs under the arches.
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
        // Under the tip the belly is the nose's painted front face.
        tris(-a.z > 2.5 - 1e-6 && -b.z > 2.5 - 1e-6 ? 'paint' : 'trim').quad(v3(-a.x, a.y, a.z), v3(a.x, a.y, a.z), v3(b.x, b.y, b.z), v3(-b.x, b.y, b.z), down)
    }

    // Each tub: a liner from the arch's edge in to the tub wall, and the wall itself, so the wheel sits in shadow.
    for (const arch of ARCHES) {
        const inside = us.filter(u => Math.abs(u - arch.u) < arch.a)
        const front = arch.u + arch.a + 1e-3
        const back = arch.u - arch.a - 1e-3
        const rim = [
            { u: front, y: BELLY_Y, x: sectionAt(front)[COLS - 1]![0] },
            ...inside.map(u => ({ u, y: archEdge(u), x: cutSection(u, sectionAt(u))[COLS - 1]![0] })),
            { u: back, y: BELLY_Y, x: sectionAt(back)[COLS - 1]![0] }
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
        // The dark parts are flat-shaded: nobody looks closely, and the creases read better.
        const geo = t.build(slot !== 'trim')
        kit.add(slot, geo)
        geo.dispose()
    }
}

/** A thin strip lifted off panel j, for u0 to u1 and t0 to t1 across it: lamps, shut lines, pillars. */
export function addStrip(kit: Kit, slot: Slot, j: number, u0: number, u1: number, t0: number, t1: number, lift = 0.004, steps = 6) {
    const t = new Tris()
    const hint = new THREE.Vector3()
    const at = (u: number, f: number, side: number) => {
        const sec = sectionAt(u)
        const a = sec[j]!
        const b = sec[j + 1]!
        panelOut(sec, j, side, hint)
        return v3(side * (a[0] + (b[0] - a[0]) * f), a[1] + (b[1] - a[1]) * f, -u).addScaledVector(hint, lift)
    }
    for (const side of SIDES) {
        for (let i = 0; i < steps; i++) {
            const ua = u0 + (u1 - u0) * i / steps
            const ub = u0 + (u1 - u0) * (i + 1) / steps
            panelOut(sectionAt((ua + ub) / 2), j, side, hint)
            const h = hint.clone()
            t.quad(at(ua, t0, side), at(ua, t1, side), at(ub, t1, side), at(ub, t0, side), h)
        }
    }
    const geo = t.build(false)
    kit.add(slot, geo)
    geo.dispose()
}
