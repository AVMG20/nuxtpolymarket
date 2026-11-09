import * as THREE from 'three'
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import { AXLE_U } from './car-body'
import { Kit, modelShared, normalize, type Pt, type Slot } from './car-kit'
import { canvas, finish } from './canvas'
import type { PlayerCar } from './models'

/**
 * The Roadster: a low, faceted wedge with a long glass canopy, built from flat
 * panels and crisp creases rather than the Kestrel's lofted curves. Cosmetic
 * only: physics never sees the model, so it drives and collides exactly like
 * the Kestrel on the same wheelbase and track. Everything faces -z.
 */

const SIDES = [-1, 1] as const
const NOSE_U = 2.58
const TAIL_U = -2.46
const TAIL_Z = -TAIL_U
/** Bigger wheels than the Kestrel's, on low-profile tyres; the wheels carry their radius so they spin true. */
const WHEEL_R = 0.4
const WHEEL_W = 0.32
const HALF_TRACK = 0.82
/** Panels meeting at a sharper angle than this keep a hard edge; shallower bends shade smooth. */
const CREASE = THREE.MathUtils.degToRad(20)
/** Half-width of the wheel tubs, and the belly's height. */
const TUB_X = 0.6
const BELLY_Y = 0.17
/** The rear lamps the flames come out of, and where the light trails start. */
const LAMP_XS = [0.13, 0.39]
const LAMP_Y = 0.39
const TRAIL_X = 0.62
const TRAIL_Y = 0.765

/**
 * Keyframe sections, nose first: u (metres forward of the middle), then each
 * column's (x, y) on the right, from the centreline out and down: centre,
 * centre-panel edge, the step beside it, beltline, shoulder, flank crease, top
 * of the dark lower body and sill. Straight lines join them across and along,
 * so every panel is flat between the creases.
 */
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
function sectionAt(u: number): Pt[] {
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
class Tris {
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
    build(creased = true) {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
        if (!creased) {
            g.computeVertexNormals()
            return g
        }
        const out = toCreasedNormals(g, CREASE)
        g.dispose()
        return out
    }
}

/** Outward across a section's panel j on the given side, ignoring the slope along the car. */
function panelOut(sec: Pt[], j: number, side: number, out = new THREE.Vector3()) {
    const dx = sec[j + 1]![0] - sec[j]![0]
    const dy = sec[j + 1]![1] - sec[j]![1]
    return out.set(-dy * side, dx, 0).normalize()
}

/** The painted shell, glass and dark lower body, the closing faces at each end, the belly and the wheel tubs. */
function addBody(kit: Kit) {
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

/**
 * A thin strip lying on panel j (between columns j and j + 1), from u0 to u1
 * and from t0 to t1 across the panel, lifted off it: lamps, shut lines, pillars.
 */
function addStrip(kit: Kit, slot: Slot, j: number, u0: number, u1: number, t0: number, t1: number, lift = 0.004, steps = 6) {
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

/** The nose's full-width light bar, slit headlamps on the bonnet's corners and the lip under it. */
function addNose(kit: Kit) {
    const z = -NOSE_U - 0.004
    const nose = sectionAt(NOSE_U)
    // Follows the leading edge: straight across the middle, then down each corner.
    kit.box('head', nose[3]![0] * 2, 0.024, 0.014, 0, nose[3]![1] - 0.016, z, 0.006)
    for (const side of SIDES) {
        kit.beam('head', [side * nose[3]![0], nose[3]![1] - 0.016, z], [side * nose[4]![0], nose[4]![1] - 0.018, z], 0.024, 0.014)
    }
    // Slim angular slits along the bonnet's outer crease.
    addStrip(kit, 'head', 3, 2.12, 2.47, 0.78, 0.93, 0.005, 4)
    addStrip(kit, 'trim', 3, 2.09, 2.5, 0.72, 0.97, 0.003, 4)
    // A thin black lip tucked in under the nose's lower edge.
    kit.box('rubber', 1.56, 0.022, 0.1, 0, 0.175, -2.45, 0.008)
}

/** Shut lines, the slim B-pillar, side markers and the black side blades. */
function addFlank(kit: Kit) {
    // The door's front and back shut lines.
    for (const u of [0.9, -0.84]) {
        for (const j of [3, 4, 5]) addStrip(kit, 'trim', j, u + 0.006, u - 0.006, 0, 1, 0.003, 1)
    }
    // A thin pillar splits the side glass.
    addStrip(kit, 'paint', 2, -0.28, -0.31, 0, 1, 0.004, 1)
    // An amber marker behind the front wheel, a red one ahead of the rear.
    addStrip(kit, 'caliper', 4, 0.86, 0.78, 0.05, 0.14, 0.004, 1)
    addStrip(kit, 'tail', 5, -0.7, -0.74, 0.55, 0.66, 0.004, 1)
    for (const side of SIDES) {
        // The black blade along the sill between the wheels.
        kit.box('trim', 0.08, 0.05, 1.84, side * 0.85, 0.15, -0.02, 0.012)
    }
}

/** A big body-coloured wing on two short stalks off the tail deck, with soft end plates. */
function addWing(kit: Kit) {
    const chord = 0.56
    const span = 1.84
    const y = 1.07
    const z = 2.3
    const foil = new THREE.Shape()
    // Leading edge at +x (forward once turned), blunt; the trailing edge thins out to a lip.
    foil.moveTo(chord / 2, 0)
    foil.lineTo(chord / 2 - 0.05, 0.03)
    foil.lineTo(-chord / 2 + 0.04, 0.026)
    foil.lineTo(-chord / 2, 0.04)
    foil.lineTo(-chord / 2, 0.012)
    foil.lineTo(chord / 2 - 0.08, -0.02)
    foil.closePath()
    const wing = new THREE.ExtrudeGeometry(foil, { depth: span, bevelEnabled: false })
    wing.translate(0, 0, -span / 2)
    wing.rotateY(Math.PI / 2)
    // The trailing edge sits higher, as on a real wing.
    wing.rotateX(-0.06)
    kit.add('paint', wing, 0, y, z)
    wing.dispose()
    // A dark gurney along the trailing edge.
    kit.box('trim', span - 0.02, 0.026, 0.012, 0, y + 0.055, z + chord / 2 - 0.005, 0.004)

    const plate = new THREE.Shape()
    plate.moveTo(0.27, 0.05)
    plate.lineTo(-0.27, 0.08)
    plate.quadraticCurveTo(-0.3, 0.08, -0.3, 0.04)
    plate.lineTo(-0.28, -0.06)
    plate.quadraticCurveTo(-0.27, -0.09, -0.23, -0.09)
    plate.lineTo(0.18, -0.06)
    plate.closePath()
    const plateGeo = new THREE.ExtrudeGeometry(plate, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 4 })
    plateGeo.translate(0, 0, -0.01)
    plateGeo.rotateY(Math.PI / 2)
    for (const side of SIDES) {
        kit.add('paint', plateGeo, side * (span / 2 + 0.01), y, z)
        // Short, slim body-coloured stalks standing on the deck.
        kit.beam('paint', [side * 0.42, 0.84, 2.24], [side * 0.44, y - 0.005, z + 0.04], 0.026, 0.11)
    }
    plateGeo.dispose()
}

/** The rear: the red light bar along the tail's top edge, the plate, four round bronze lamps and the recessed diffuser. */
function addTail(kit: Kit) {
    const z = TAIL_Z + 0.004
    // Tall enough to hold a few pixels from the chase camera, in the Kestrel's lamp slot so it blooms like its lamps.
    kit.box('lens', 1.52, 0.056, 0.014, 0, TRAIL_Y, z, 0.006)
    kit.box('tail', 1.48, 0.036, 0.016, 0, TRAIL_Y, z + 0.006, 0.006)
    // The dark lower face, recessed under the painted band and following the tail's taper.
    const panel = new THREE.Shape()
    panel.moveTo(-0.84, 0.6)
    panel.lineTo(0.84, 0.6)
    panel.lineTo(0.73, 0.29)
    panel.lineTo(-0.73, 0.29)
    panel.closePath()
    const panelGeo = new THREE.ExtrudeGeometry(panel, { depth: 0.012, bevelEnabled: false })
    kit.add('trim', panelGeo, 0, 0, z - 0.004)
    panelGeo.dispose()
    const plate = new THREE.PlaneGeometry(0.4, 0.1)
    kit.add('plate', plate, 0, 0.52, z + 0.018)
    plate.dispose()
    // Open at the back, with a rolled lip and a wall running in, so each reads as a hollow pipe.
    const pipe = new THREE.LatheGeometry([
        new THREE.Vector2(0.05, -0.1), new THREE.Vector2(0.05, 0.05), new THREE.Vector2(0.046, 0.06),
        new THREE.Vector2(0.038, 0.06), new THREE.Vector2(0.038, -0.03)
    ], 20).rotateX(Math.PI / 2)
    const glow = new THREE.CircleGeometry(0.038, 20)
    for (const side of SIDES) {
        for (const x of LAMP_XS) {
            kit.add('chrome', pipe, side * x, LAMP_Y, z)
            kit.add('caliper', glow, side * x, LAMP_Y, z + 0.02)
        }
    }
    pipe.dispose()
    glow.dispose()
    // Short diffuser strakes along the panel's foot, tucked in under the car.
    for (const x of [-0.52, -0.26, 0, 0.26, 0.52]) kit.box('trim', 0.022, 0.06, 0.26, x, 0.31, z - 0.11, 0.006)
}

/** Low-profile tyre and a pale aero disc carrying six straight dark spokes in a star; axis along x, outer face at +x. */
function roadsterWheel(r: number, w: number) {
    const hw = w / 2
    const R = r * 0.84
    const tire = new THREE.LatheGeometry([
        new THREE.Vector2(R * 0.98, -hw + 0.01), new THREE.Vector2(r * 0.93, -hw), new THREE.Vector2(r * 0.99, -hw + w * 0.1),
        new THREE.Vector2(r, -hw + w * 0.24), new THREE.Vector2(r, hw - w * 0.24), new THREE.Vector2(r * 0.99, hw - w * 0.1),
        new THREE.Vector2(r * 0.93, hw), new THREE.Vector2(R * 0.98, hw - 0.01)
    ], 48).rotateZ(-Math.PI / 2)
    // A shallow pale dish set in behind the dark rim lip, walked from the rim in so it faces out of the wheel.
    const face = new THREE.LatheGeometry([
        new THREE.Vector2(R * 0.97, hw - 0.012), new THREE.Vector2(R * 0.3, hw - 0.03), new THREE.Vector2(0.001, hw - 0.035)
    ], 48).rotateZ(-Math.PI / 2)
    const dark: THREE.BufferGeometry[] = []
    const lip = new THREE.LatheGeometry([
        new THREE.Vector2(R * 0.94, hw - 0.03), new THREE.Vector2(R * 1.01, hw - 0.02), new THREE.Vector2(R * 1.0, hw),
        new THREE.Vector2(R * 0.95, hw - 0.002), new THREE.Vector2(R * 0.94, hw - 0.03)
    ], 48).rotateZ(-Math.PI / 2)
    dark.push(normalize(lip))
    lip.dispose()
    const hub = new THREE.CylinderGeometry(R * 0.16, R * 0.19, 0.045, 6).rotateZ(Math.PI / 2).translate(hw - 0.02, 0, 0)
    dark.push(normalize(hub))
    hub.dispose()
    // Six straight spokes, tapering a little from the hub out to the rim's edge.
    const blade = new THREE.Shape()
    blade.moveTo(-0.028, R * 0.12)
    blade.lineTo(-0.019, R * 0.98)
    blade.lineTo(0.019, R * 0.98)
    blade.lineTo(0.028, R * 0.12)
    blade.closePath()
    for (let i = 0; i < 6; i++) {
        const spoke = new THREE.ExtrudeGeometry(blade, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 1 })
        spoke.rotateY(Math.PI / 2)
        spoke.rotateX(i / 6 * Math.PI * 2)
        spoke.translate(hw - 0.05, 0, 0)
        dark.push(normalize(spoke))
        spoke.dispose()
    }
    const spokes = mergeGeometries(dark, false)!
    for (const g of dark) g.dispose()
    return { tire: normalize(tire), face: normalize(face), spokes }
}

/** The plate: dark letters on white, backlit at night. */
function roadsterPlate() {
    const [c, ctx] = canvas(440, 110)
    ctx.fillStyle = '#e9e9e4'
    ctx.beginPath()
    ctx.roundRect(4, 4, 432, 102, 10)
    ctx.fill()
    ctx.strokeStyle = '#1a1a1c'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.fillStyle = '#16161a'
    ctx.font = '600 70px "DIN Alternate", "Bahnschrift", "Arial Narrow", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('RDSTR', 220, 58)
    return finish(c)
}

export function buildRoadster(color: number): PlayerCar {
    const s = modelShared()
    const group = new THREE.Group()
    const body = new THREE.Group()
    group.add(body)
    const owned: { dispose(): void }[] = []
    const own = <T extends { dispose(): void }>(x: T) => {
        owned.push(x)
        return x
    }
    // Satin pearl that takes the player's colour.
    const paint = own(new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.4, sheenRoughness: 0.5, sheenColor: 0xffffff }))
    // Dark, warm smoked-bronze canopy glass: it reflects weakly and tints what it does reflect, so it stays dark at a glancing angle.
    const glass = own(new THREE.MeshPhysicalMaterial({ color: 0x140b05, roughness: 0.1, metalness: 0.3, envMapIntensity: 0.6, specularColor: 0xc8864a, specularIntensity: 0.6 }))
    // The wheels' pale aero discs.
    const face = own(new THREE.MeshStandardMaterial({ color: 0xc4c6ca, roughness: 0.32, metalness: 0.45 }))
    const bronze = own(new THREE.MeshStandardMaterial({ color: 0xb07a3a, roughness: 0.3, metalness: 1 }))
    const amber = own(new THREE.MeshStandardMaterial({ color: 0x4a2a08, emissive: 0xffa040, emissiveIntensity: 2.6, roughness: 0.3 }))
    const plateMap = own(roadsterPlate())
    const plate = own(new THREE.MeshStandardMaterial({ map: plateMap, emissiveMap: plateMap, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.45 }))
    // The kit's slots are buckets here: the pipes go in `chrome` and the amber lamps in `caliper`.
    const materials: Partial<Record<Slot, THREE.Material>> = { paint, glass, chrome: bronze, caliper: amber, plate }

    const kit = new Kit()
    addBody(kit)
    addNose(kit)
    addFlank(kit)
    addWing(kit)
    addTail(kit)
    for (const [slot, geo] of kit.bake()) {
        own(geo)
        const material = materials[slot] ?? s.slots[slot as keyof typeof s.slots]
        const mesh = new THREE.Mesh(geo, material)
        if (slot === 'decal') mesh.renderOrder = 1
        body.add(mesh)
    }

    const wheelSet = roadsterWheel(WHEEL_R, WHEEL_W)
    for (const g of Object.values(wheelSet)) own(g)
    const wheels: THREE.Object3D[] = []
    for (const u of [-AXLE_U, AXLE_U]) {
        for (const side of SIDES) {
            const w = new THREE.Group()
            const spin = new THREE.Group()
            spin.add(new THREE.Mesh(wheelSet.tire, s.slots.rubber), new THREE.Mesh(wheelSet.face, face), new THREE.Mesh(wheelSet.spokes, s.slots.rim))
            // The left wheel is turned round, so it spins the other way about its local axis.
            spin.userData.dir = side
            spin.userData.radius = WHEEL_R
            w.add(spin)
            w.position.set(side * HALF_TRACK, WHEEL_R, -u)
            if (side < 0) w.rotation.y = Math.PI
            group.add(w)
            wheels.push(spin)
        }
    }

    const shadow = new THREE.Mesh(s.shadowGeo, s.shadow)
    shadow.scale.set(2.8, 1, 5.6)
    shadow.position.y = 0.03
    shadow.renderOrder = 2
    group.add(shadow)

    const flameGeo = own(new THREE.ConeGeometry(0.065, 1.0, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5))
    const flameMat = own(new THREE.MeshBasicMaterial({ color: 0x7ab8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
    const flames: THREE.Mesh[] = []
    for (const side of SIDES) {
        for (const x of LAMP_XS) {
            const f = new THREE.Mesh(flameGeo, flameMat)
            f.position.set(side * x, LAMP_Y, TAIL_Z + 0.06)
            f.scale.setScalar(0.001)
            body.add(f)
            flames.push(f)
        }
    }

    return {
        group,
        body,
        paint,
        wheels,
        flames,
        flameMat,
        tailPoints: SIDES.map(side => new THREE.Vector3(side * TRAIL_X, TRAIL_Y, TAIL_Z + 0.03)),
        dispose: () => owned.forEach(o => o.dispose())
    }
}
