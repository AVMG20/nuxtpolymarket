import * as THREE from 'three'
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'
import { assembleCar } from './car-assembly'
import { Kit, modelShared, normalize, SIDES, type Slot } from './car-kit'
import { DECALS, mapToDecal } from './car-livery'
import type { PlayerCar } from './car-models'
import { Tris } from './car-roadster-body'
import { addBody, addPatch, addStrip, AXLE_U, COWL_U, DECK_U, NOSE_U, surfaceAt, TAIL_DEPTH, TAIL_U, WHEEL_R } from './car-spectre-body'

/** The Spectre: a low, wide endurance prototype with a canopy cockpit, open aero tunnels, a shark fin and a split wing. */

const TAIL_Z = -TAIL_U
const WHEEL_W = 0.3
const HALF_TRACK = 0.83
/** No part may stand further out than the rear fenders, or fitting the car to its hitbox would squeeze the hull. */
const MAX_X = 1.012
/** The centre-exit pipes the flames come out of. */
const PIPE_X = 0.075
const PIPE_Y = 0.515
const WING_Y = 1.14
const WING_Z = 2.1
const PLATE_X = 0.9
/** Where the roof's paint ends and the side glass starts, across the canopy, and where the glass ends at the canopy's foot. */
const ROOF_C = 0.84
const FOOT_C = 2

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const quat = new THREE.Quaternion()

/** Stands a part on the shell on both sides, its y axis along the skin's normal. */
function onSkin(kit: Kit, slot: Slot, geo: THREE.BufferGeometry, u: number, c: number, lift: number) {
    for (const side of SIDES) {
        const { pos, normal } = surfaceAt(u, c, side, lift)
        const g = geo.clone().applyQuaternion(quat.setFromUnitVectors(Y_AXIS, normal))
        kit.add(slot, g, pos.x, pos.y, pos.z)
        g.dispose()
    }
}

/** Where the headlamp's cover sits on the fender: `a` runs back from its blunt front to the point of its tail, `b` across it. */
function lampAt(a: number, b: number, inset = 0): [number, number] {
    const half = Math.max(0, 0.46 * Math.pow(1 - a, 0.75) - inset)
    return [NOSE_U - 0.028 - a * 0.5, 5.48 + 0.24 * a + (b * 2 - 1) * half]
}

/** A headlamp on each fender: a dark cover swept back to a point, a blade of light round its rim and three projectors inside. */
function addHeadlamps(kit: Kit) {
    addPatch(kit, 'glass', lampAt, 18, 8, 0.004)
    // The running light: one blade down each edge of the cover, meeting at its tail.
    for (const edge of [0, 1]) {
        addPatch(kit, 'head', (a, b) => {
            const [u, c] = lampAt(0.03 + a * 0.97, edge, 0.02)
            return [u, c + (edge ? -1 : 1) * b * 0.085 * (1 - a * 0.6)]
        }, 18, 1, 0.008)
    }
    const ring = new THREE.TorusGeometry(1, 0.2, 6, 20).rotateX(Math.PI / 2)
    const lens = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1)
    for (const [a, r] of [[0.1, 0.034], [0.27, 0.029], [0.43, 0.023]] as const) {
        const [u, c] = lampAt(a, 0.5)
        const bezel = ring.clone().scale(r, r, r)
        const glass = lens.clone().scale(r * 0.8, r * 0.8, r * 0.8)
        onSkin(kit, 'chrome', bezel, u, c, 0.008)
        onSkin(kit, 'head', glass, u, c, 0.006)
        bezel.dispose()
        glass.dispose()
    }
    ring.dispose()
    lens.dispose()
}

/** A dive plane on each front corner: a carbon blade that leaves the skin low at the nose and sweeps up towards the wheel. */
function addCanard(kit: Kit, u0: number, u1: number, c0: number, c1: number, reach: number) {
    const steps = 8
    const t = new Tris()
    const up = new THREE.Vector3(0, 1, 0)
    const down = new THREE.Vector3(0, -1, 0)
    const outward = new THREE.Vector3()
    for (const side of SIDES) {
        const rows: THREE.Vector3[][] = []
        for (let i = 0; i <= steps; i++) {
            const a = i / steps
            // Sunk a little into the skin, so no gap shows at the root.
            const { pos, normal } = surfaceAt(u0 + (u1 - u0) * a, c0 + (c1 - c0) * a, side, -0.012)
            outward.set(normal.x, 0, 0).normalize()
            const tip = pos.clone().addScaledVector(outward, reach * (0.35 + 0.65 * a))
            tip.x = THREE.MathUtils.clamp(tip.x, -MAX_X, MAX_X)
            // The blade curls up towards its trailing edge.
            tip.y += 0.03 * a * a
            rows.push([pos, tip, pos.clone().setY(pos.y - 0.01), tip.clone().setY(tip.y - 0.01)])
        }
        outward.set(side, 0, 0)
        for (let i = 0; i < steps; i++) {
            const [a0, a1, a2, a3] = rows[i]!
            const [b0, b1, b2, b3] = rows[i + 1]!
            t.quad(a0!, a1!, b1!, b0!, up)
            t.quad(a2!, a3!, b3!, b2!, down)
            t.quad(a1!, a3!, b3!, b1!, outward)
        }
        const last = rows[steps]!
        t.quad(last[0]!, last[1]!, last[3]!, last[2]!, new THREE.Vector3(0, 0, 1))
    }
    const geo = t.build(true)
    kit.add('trim', geo)
    geo.dispose()
}

/** The nose: headlamps, the mouth's vanes, a deep splitter with fences, dive planes and the bonnet's duct. */
function addNose(kit: Kit) {
    addHeadlamps(kit)
    // The splitter bows forward under the mouth and runs back to the front wheels.
    const plan = new THREE.Shape()
    plan.moveTo(-0.9, 2.02)
    plan.lineTo(-0.935, 2.44)
    plan.quadraticCurveTo(-0.93, 2.585, -0.72, 2.605)
    plan.quadraticCurveTo(0, 2.655, 0.72, 2.605)
    plan.quadraticCurveTo(0.93, 2.585, 0.935, 2.44)
    plan.lineTo(0.9, 2.02)
    plan.closePath()
    const splitter = new THREE.ExtrudeGeometry(plan, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 10 }).rotateX(-Math.PI / 2)
    kit.add('trim', splitter, 0, 0.172, 0)
    splitter.dispose()
    // Vanes stand in the mouth, splitting it into a centre intake and a brake duct under each lamp.
    for (const side of SIDES) {
        for (const [x, h] of [[0.17, 0.155], [0.6, 0.15]] as const) kit.box('trim', 0.014, h, 0.13, side * x, 0.2 + h / 2, -NOSE_U + 0.075, 0.004)
        // A fence on each end of the splitter, and a strake under its floor.
        kit.box('trim', 0.014, 0.11, 0.36, side * 0.925, 0.235, -2.27, 0.005)
        kit.box('trim', 0.012, 0.03, 0.3, side * 0.42, 0.16, -2.4, 0.004)
    }
    // The maker's shield on the cone's tip.
    const shield = new THREE.Shape()
    shield.moveTo(0, 0.034)
    shield.lineTo(0.022, 0.02)
    shield.lineTo(0.018, -0.012)
    shield.lineTo(0, -0.034)
    shield.lineTo(-0.018, -0.012)
    shield.lineTo(-0.022, 0.02)
    shield.closePath()
    const badge = new THREE.ExtrudeGeometry(shield, { depth: 0.004, bevelEnabled: false }).rotateX(-Math.PI / 2)
    const tip = surfaceAt(2.46, 0, 1, 0.002)
    badge.applyQuaternion(quat.setFromUnitVectors(Y_AXIS, tip.normal))
    kit.add('chrome', badge, 0, tip.pos.y, tip.pos.z)
    badge.dispose()
    addCanard(kit, 2.53, 2.2, 8.72, 8.2, 0.085)
    addCanard(kit, 2.5, 2.27, 7.95, 7.5, 0.06)
    // The bonnet's duct, where the air from the mouth comes back out: a dark well, its mesh and a lip at the back.
    addPatch(kit, 'rubber', (a, b) => [1.98 - a * 0.5, b * (0.9 - 0.25 * a)], 8, 6, 0.004)
    addPatch(kit, 'mesh', (a, b) => [1.95 - a * 0.44, b * (0.8 - 0.22 * a)], 8, 6, 0.007)
    for (const u of [1.84, 1.72, 1.6]) addPatch(kit, 'trim', (a, b) => [u - a * 0.022, b * (0.82 - 0.25 * (1.98 - u))], 1, 6, 0.012)
}

/** The canopy: a painted roof and pillars over the glass, so it reads as a windscreen and side windows. */
function addCanopy(kit: Kit) {
    // The scuttle sweeps back round the screen's foot instead of cutting straight across.
    addPatch(kit, 'paint', (a, b) => [COWL_U + 0.015 - a * (0.015 + 0.26 * Math.pow(b, 2.2)), b * FOOT_C], 5, 24, 0.004)
    const header = (b: number) => 0.3 - 0.08 * b * b
    addPatch(kit, 'paint', (a, b) => [header(b) + (DECK_U - 0.02 - header(b)) * a, b * ROOF_C], 22, 8, 0.004)
    // The pillar runs from the roof's corner down to the scuttle's.
    addPatch(kit, 'paint', (a, b) => [0.22 + 0.52 * Math.pow(a, 1.5) + (b - 0.5) * (0.07 + 0.03 * a), ROOF_C + (FOOT_C - ROOF_C) * a], 14, 2, 0.0045)
    // Behind the door glass the canopy is solid again.
    const quarter = (b: number) => -0.26 - 0.34 * b
    addPatch(kit, 'paint', (a, b) => [quarter(b) + (DECK_U - 0.02 - quarter(b)) * a, ROOF_C + (FOOT_C - ROOF_C) * b], 10, 16, 0.004)
    // A dark band round the screen, as bonded glass has.
    addPatch(kit, 'trim', (a, b) => [COWL_U - 0.26 * Math.pow(b, 2.2) - a * 0.03, b * FOOT_C], 1, 24, 0.0045)
    // The roof scoop feeds the engine: a tapered pod with a dark throat.
    const pod = new THREE.Shape()
    pod.moveTo(-0.13, 0)
    pod.lineTo(-0.115, 0.075)
    pod.quadraticCurveTo(-0.1, 0.105, 0, 0.11)
    pod.quadraticCurveTo(0.1, 0.105, 0.115, 0.075)
    pod.lineTo(0.13, 0)
    pod.closePath()
    const scoop = new THREE.ExtrudeGeometry(pod, { depth: 0.2, bevelEnabled: false, curveSegments: 8 })
    const position = scoop.attributes.position!
    // Stretched back and squeezed down to a point on the engine cover.
    for (let i = 0; i < position.count; i++) {
        const back = position.getZ(i) / 0.2
        const k = 1 - 0.75 * back
        position.setXYZ(i, position.getX(i) * k, position.getY(i) * (1 - 0.86 * back) - 0.16 * back, back * 0.95)
    }
    scoop.computeVertexNormals()
    kit.add('paint', scoop, 0, 1.045, 0.16)
    scoop.dispose()
    const throat = new THREE.ShapeGeometry(pod, 8)
    kit.add('rubber', throat, 0, 1.052, 0.158, 0, Math.PI, 0, 0.84, 0.84, 1)
    throat.dispose()
}

/** Louvres over the front wheels, door lines, side intakes, sill blades and mirrors. */
function addFlank(kit: Kit) {
    // Louvres let the air out of the front arches.
    addStrip(kit, 'rubber', 5, 1.66, 1.2, 0.2, 0.8, 0.003)
    for (const u of [1.62, 1.53, 1.44, 1.35, 1.26]) addStrip(kit, 'paint', 5, u, u - 0.045, 0.22, 0.78, 0.012, 1)
    // The gill behind the front wheel, with two blades across it.
    addPatch(kit, 'rubber', (a, b) => [0.9 - a * (0.2 + 0.26 * b), 7.22 + 0.62 * b], 6, 8, 0.004)
    for (const b of [0.36, 0.68]) addPatch(kit, 'paint', (a, s) => [0.9 - a * (0.2 + 0.26 * b), 7.22 + 0.62 * (b + (s - 0.5) * 0.09)], 6, 1, 0.009)
    // The intake ahead of the rear wheel: a dark well that deepens to its mesh, under a painted lip.
    addPatch(kit, 'rubber', (a, b) => [-0.2 - a * (0.5 + 0.28 * b), 8.14 + 0.72 * b], 10, 8, 0.004)
    addPatch(kit, 'mesh', (a, b) => [-0.5 - a * (0.2 + 0.26 * b), 8.2 + 0.6 * b], 6, 6, 0.007)
    addPatch(kit, 'paint', (a, b) => [-0.18 - a * 0.56, 8.08 + 0.07 * b], 10, 1, 0.012)
    for (const b of [0.36, 0.66]) addPatch(kit, 'paint', (a, s) => [-0.24 - a * (0.26 + 0.2 * b), 8.14 + 0.72 * (b + (s - 0.5) * 0.06)], 6, 1, 0.009)
    // The engine bay's vent on the tunnel wall and the fender's shoulder.
    for (const u of [-1.1, -1.2, -1.3]) addStrip(kit, 'rubber', 4, u, u - 0.05, 0.3, 0.85, 0.004, 1)
    // The door's shut lines, down the glass and the flank.
    for (const u of [0.5, -0.24]) addPatch(kit, 'trim', (a, b) => [u + 0.006 - a * 0.012, 6.5 + 2.45 * b], 1, 30, 0.003)
    // Engine cover louvres either side of the fin.
    for (const u of [-1.08, -1.2, -1.32, -1.44, -1.56]) addPatch(kit, 'rubber', (a, b) => [u - a * 0.05, 0.3 + 0.62 * b], 1, 4, 0.004)
    // Louvres over the rear wheels too, and a radiator's mesh in the floor of each tunnel.
    addStrip(kit, 'rubber', 5, -1.2, -1.64, 0.2, 0.8, 0.003)
    for (const u of [-1.24, -1.33, -1.42, -1.51, -1.6]) addStrip(kit, 'paint', 5, u, u - 0.045, 0.22, 0.78, 0.012, 1)
    addPatch(kit, 'rubber', (a, b) => [-1.12 - a * 0.82, 3.08 + 0.84 * b], 12, 6, 0.004)
    addPatch(kit, 'mesh', (a, b) => [-1.16 - a * 0.74, 3.16 + 0.68 * b], 12, 6, 0.007)
    for (const side of SIDES) {
        // The sill blade.
        kit.box('trim', 0.06, 0.04, 1.78, side * 0.885, 0.15, -0.01, 0.012)
        // Mirror pods on blade stalks, kept inside the flank so they don't squeeze the car once it's fitted to the hitbox.
        kit.beam('trim', [side * 0.6, 0.79, -0.7], [side * 0.77, 0.885, -0.66], 0.035, 0.01)
        const pod = new THREE.SphereGeometry(1, 14, 10)
        kit.add('paint', pod, side * 0.79, 0.9, -0.65, 0, side * -0.15, 0, 0.09, 0.03, 0.045)
        pod.dispose()
        const face = new THREE.CircleGeometry(1, 14)
        kit.add('glass', face, side * 0.786, 0.9, -0.623, 0, side * -0.15, 0, 0.075, 0.021, 1)
        face.dispose()
    }
}

/** A raised rail along a path on the skin, on both sides of the car: `half` wide each way along the car and `height` proud, with chamfered flanks. */
function addRail(kit: Kit, slot: Slot, path: (t: number) => [number, number], steps: number, half: (t: number) => number, height: number) {
    const tris = new Tris()
    const run = new THREE.Vector3()
    for (const side of SIDES) {
        const rows: { lo: THREE.Vector3[], hi: THREE.Vector3[], n: THREE.Vector3, w: THREE.Vector3 }[] = []
        for (let i = 0; i <= steps; i++) {
            const t = i / steps
            const [u, c] = path(t)
            const { pos, normal } = surfaceAt(u, c, side)
            const w = surfaceAt(u + 0.008, c, side).pos.sub(surfaceAt(u - 0.008, c, side).pos).normalize()
            const h = half(t)
            // Sunk a little into the skin, so no gap shows under it.
            const foot = pos.clone().addScaledVector(normal, -0.004)
            const top = pos.clone().addScaledVector(normal, height)
            rows.push({
                lo: [foot.clone().addScaledVector(w, h), foot.clone().addScaledVector(w, -h)],
                hi: [top.clone().addScaledVector(w, h * 0.6), top.clone().addScaledVector(w, -h * 0.6)],
                n: normal,
                w
            })
        }
        for (let i = 0; i < steps; i++) {
            const a = rows[i]!
            const b = rows[i + 1]!
            tris.quad(a.hi[0]!, a.hi[1]!, b.hi[1]!, b.hi[0]!, a.n)
            tris.quad(a.lo[0]!, a.hi[0]!, b.hi[0]!, b.lo[0]!, a.w)
            tris.quad(a.lo[1]!, a.hi[1]!, b.hi[1]!, b.lo[1]!, run.copy(a.w).negate())
        }
        const end = rows[steps]!
        run.subVectors(end.hi[0]!, rows[steps - 1]!.hi[0]!)
        tris.quad(end.lo[0]!, end.lo[1]!, end.hi[1]!, end.hi[0]!, run)
    }
    const geo = tris.build(true)
    kit.add(slot, geo)
    geo.dispose()
}

/** The fin down the spine: it rises off the engine cover and carries the middle of the wing. */
function addFin(kit: Kit) {
    // Drawn side-on: x runs back along the car, y is up.
    const fin = new THREE.Shape()
    fin.moveTo(0.62, 1.0)
    fin.quadraticCurveTo(1.3, 1.17, 1.84, 1.19)
    fin.lineTo(2.3, 1.19)
    fin.quadraticCurveTo(2.2, 1.0, 2.26, 0.8)
    fin.lineTo(1.95, 0.84)
    fin.lineTo(1.42, 0.9)
    fin.lineTo(1, 0.97)
    fin.closePath()
    const geo = new THREE.ExtrudeGeometry(fin, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 12 })
    geo.translate(0, 0, -0.007)
    geo.rotateY(-Math.PI / 2)
    kit.add('paint', geo)
    geo.dispose()
}

/** An aerofoil's outline, nose first over the top and back underneath, in chords: cambered below, the trailing edge kicked up. */
const FOIL: readonly (readonly [number, number])[] = [
    [-0.5, 0], [-0.46, 0.04], [-0.36, 0.068], [-0.15, 0.085], [0.1, 0.09], [0.32, 0.105], [0.5, 0.14],
    [0.5, 0.122], [0.36, 0.06], [0.16, 0.0], [-0.08, -0.04], [-0.3, -0.05], [-0.45, -0.032]
]

/** One plane of the wing, lofted tip to tip: `at` gives each station's height, middle, chord and pitch, for s from -1 to 1. */
function addPlane(kit: Kit, slot: Slot, halfSpan: number, at: (s: number) => { y: number, z: number, chord: number, pitch: number }) {
    const stations = 24
    const tris = new Tris()
    const rings: THREE.Vector3[][] = []
    for (let i = 0; i <= stations; i++) {
        const s = i / stations * 2 - 1
        const { y, z, chord, pitch } = at(s)
        const cos = Math.cos(pitch)
        const sin = Math.sin(pitch)
        rings.push(FOIL.map(([fx, fy]) => new THREE.Vector3(s * halfSpan, y + (fy * cos + fx * sin) * chord, z + (fx * cos - fy * sin) * chord)))
    }
    const hint = new THREE.Vector3()
    const centre = new THREE.Vector3()
    for (let i = 0; i < stations; i++) {
        const a = rings[i]!
        const b = rings[i + 1]!
        centre.set(0, 0, 0)
        for (const p of a) centre.addScaledVector(p, 1 / a.length)
        for (let k = 0; k < FOIL.length; k++) {
            const k1 = (k + 1) % FOIL.length
            hint.copy(a[k]!).add(a[k1]!).multiplyScalar(0.5).sub(centre).setX(0)
            tris.quad(a[k]!, a[k1]!, b[k1]!, b[k]!, hint)
        }
    }
    const geo = tris.build(true, THREE.MathUtils.degToRad(50))
    kit.add(slot, geo)
    geo.dispose()
}

/** The wing: a dished main plane and a flap, carried by the fin and by end plates that grow out of the rear fenders. */
function addWing(kit: Kit) {
    // Dished in the middle, where it meets the fin, and rising to the end plates.
    const dish = (s: number) => 0.07 * THREE.MathUtils.smoothstep(Math.abs(s), 0.12, 0.85)
    addPlane(kit, 'paint', PLATE_X, s => ({ y: WING_Y + dish(s), z: WING_Z - 0.02 * s * s, chord: 0.46 - 0.05 * s * s, pitch: 0.05 }))
    addPlane(kit, 'paint', PLATE_X, s => ({ y: WING_Y + 0.105 + dish(s), z: WING_Z + 0.27 - 0.04 * s * s, chord: 0.15, pitch: 0.36 }))
    // A carbon gurney on the flap's edge.
    addPlane(kit, 'trim', PLATE_X, s => ({ y: WING_Y + 0.158 + dish(s), z: WING_Z + 0.338 - 0.04 * s * s, chord: 0.018, pitch: 1.45 }))

    // Drawn side-on, x running back: the plate sweeps up off the fender's crest and is cut away behind the wheel.
    const plate = new THREE.Shape()
    plate.moveTo(1.7, 0.74)
    plate.quadraticCurveTo(1.86, 1.02, 2.0, 1.3)
    plate.lineTo(2.4, 1.33)
    plate.quadraticCurveTo(2.44, 1.33, 2.44, 1.29)
    plate.lineTo(2.44, 1.06)
    plate.quadraticCurveTo(2.36, 0.9, 2.3, 0.74)
    plate.closePath()
    const plateGeo = new THREE.ExtrudeGeometry(plate, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 1, curveSegments: 10 })
    plateGeo.translate(0, 0, -0.007)
    plateGeo.rotateY(-Math.PI / 2)
    for (const side of SIDES) {
        kit.add('paint', plateGeo, side * PLATE_X)
        // Carbon louvres let into each end plate.
        for (const k of [0, 1, 2]) kit.box('rubber', 0.028, 0.012, 0.18 - k * 0.03, side * PLATE_X, 1.03 - k * 0.045, 2.18 - k * 0.012, 0.004, -0.16)
    }
    plateGeo.dispose()
}

/** Where the diffuser's fences stand, out from the middle; the last is the side wall. */
const TAIL_FENCES = [0.15, 0.5, 0.83] as const
const DIFFUSER_TOP = 0.362
const DIFFUSER_FOOT = 0.105
const DIFFUSER_LENGTH = 0.55

/** A box with its corners rounded off, for drawing with. */
function roundRect<T extends THREE.Path>(path: T, x0: number, y0: number, x1: number, y1: number, r: number) {
    path.moveTo(x0 + r, y0)
    path.lineTo(x1 - r, y0)
    path.quadraticCurveTo(x1, y0, x1, y0 + r)
    path.lineTo(x1, y1 - r)
    path.quadraticCurveTo(x1, y1, x1 - r, y1)
    path.lineTo(x0 + r, y1)
    path.quadraticCurveTo(x0, y1, x0, y1 - r)
    path.lineTo(x0, y0 + r)
    path.quadraticCurveTo(x0, y0, x0 + r, y0)
    return path
}

/** The diffuser, drawn from behind: one frame under the tail with five tunnels through it, each a rounded mouth. */
function diffuserOutline() {
    const wall = 0.016
    const outer = TAIL_FENCES[TAIL_FENCES.length - 1]!
    const shape = roundRect(new THREE.Shape(), -outer, DIFFUSER_FOOT, outer, DIFFUSER_TOP, 0.05)
    const edges = [...TAIL_FENCES.map(x => -x).reverse(), ...TAIL_FENCES]
    for (let i = 0; i < edges.length - 1; i++) {
        shape.holes.push(roundRect(new THREE.Path(), edges[i]! + wall, DIFFUSER_FOOT + 0.02, edges[i + 1]! - wall, 0.28, 0.055))
    }
    return shape
}

/** The tail: one blade of light round the opening, a spoiler lip on the deck, the exhaust in the opening and the diffuser under it. */
function addTail(kit: Kit) {
    const z = TAIL_Z
    // The light runs the width of the tail under the deck's lip, then turns down each corner: first its dark bed, then the lamp.
    const blade = (t: number): [number, number] => [TAIL_U + 0.036 + 0.008 * Math.cos(t * Math.PI), 8.75 * t]
    const taper = (t: number) => 1 - THREE.MathUtils.smoothstep(t, 0.9, 1) * 0.6
    addRail(kit, 'glass', blade, 72, t => 0.03 * taper(t), 0.008)
    addRail(kit, 'tail', t => blade(t * 0.985), 72, t => 0.013 * taper(t), 0.02)
    // A carbon lip stands along the deck's edge.
    addRail(kit, 'trim', t => [TAIL_U + 0.088, 6.7 * t], 48, t => 0.012 * taper(t), 0.03)

    // The exhaust: twin pipes in one long collar, standing out of the mesh in the middle of the opening.
    const stadium = (half: number, r: number) => {
        const path = new THREE.Shape()
        path.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false)
        path.absarc(-half, 0, r, Math.PI / 2, Math.PI * 1.5, false)
        path.closePath()
        return path
    }
    const collar = stadium(PIPE_X, 0.082)
    collar.holes.push(stadium(PIPE_X, 0.066))
    const collarGeo = new THREE.ExtrudeGeometry(collar, { depth: TAIL_DEPTH, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 10 })
    kit.add('rim', collarGeo, 0, PIPE_Y, z - TAIL_DEPTH + 0.012)
    collarGeo.dispose()
    const soot = new THREE.ShapeGeometry(stadium(PIPE_X, 0.07), 10)
    kit.add('rubber', soot, 0, PIPE_Y, z - 0.09)
    soot.dispose()
    // Open at the back, with a rolled lip and a wall running in, so each reads as a hollow pipe.
    const pipe = new THREE.LatheGeometry([
        new THREE.Vector2(0.054, -0.1), new THREE.Vector2(0.054, 0.03), new THREE.Vector2(0.05, 0.038),
        new THREE.Vector2(0.043, 0.038), new THREE.Vector2(0.043, -0.08)
    ], 20).rotateX(Math.PI / 2)
    for (const side of SIDES) {
        kit.add('chrome', pipe, side * PIPE_X, PIPE_Y, z - 0.03)
        // The crash structure's uprights show through the opening.
        kit.box('rim', 0.022, 0.3, TAIL_DEPTH - 0.04, side * 0.4, 0.51, z - TAIL_DEPTH / 2 - 0.02, 0.006)
    }
    pipe.dispose()

    // The diffuser's tunnels open out towards the tail, and its edge follows the corners round.
    const diffuser = new THREE.ExtrudeGeometry(diffuserOutline(), { depth: DIFFUSER_LENGTH, steps: 8, bevelEnabled: false, curveSegments: 6 })
    const position = diffuser.attributes.position!
    for (let i = 0; i < position.count; i++) {
        const depth = 1 - position.getZ(i) / DIFFUSER_LENGTH
        const open = 0.34 + 0.66 * Math.pow(1 - depth, 1.8)
        const tuck = 0.085 * THREE.MathUtils.smoothstep(Math.abs(position.getX(i)), 0.6, 0.83) * (1 - depth)
        position.setY(i, DIFFUSER_FOOT + (position.getY(i) - DIFFUSER_FOOT) * open)
        position.setZ(i, position.getZ(i) - tuck)
    }
    const creased = toCreasedNormals(diffuser, THREE.MathUtils.degToRad(40))
    kit.add('rim', creased, 0, 0, z - DIFFUSER_LENGTH)
    diffuser.dispose()
    creased.dispose()
    const plate = new THREE.PlaneGeometry(0.36, 0.08)
    kit.add('plate', plate, 0, 0.318, z + 0.003)
    plate.dispose()
    // The rain light hangs in the middle tunnel.
    kit.box('tail', 0.034, 0.08, 0.02, 0, 0.24, z - 0.006, 0.008)
}

/** Low-profile tyre on a deep rim with seven dished Y spokes and a centre lock, over a big disc and caliper; axis along x, outer face at +x. */
function spectreWheel(r: number, w: number) {
    const hw = w / 2
    const R = r * 0.78
    const lathe = (pts: [number, number][]) => {
        const raw = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), 48).rotateZ(-Math.PI / 2)
        const out = normalize(raw)
        raw.dispose()
        return out
    }
    // A square shoulder and a sidewall that bulges past the rim.
    const tire = lathe([
        [R * 0.985, -hw + 0.014], [r * 0.87, -hw + 0.003], [r * 0.93, -hw], [r * 0.972, -hw + w * 0.06], [r * 0.994, -hw + w * 0.16], [r, -hw + w * 0.3],
        [r, hw - w * 0.3], [r * 0.994, hw - w * 0.16], [r * 0.972, hw - w * 0.06], [r * 0.93, hw], [r * 0.87, hw - 0.003], [R * 0.985, hw - 0.014]
    ])
    const dark: THREE.BufferGeometry[] = [lathe([[R * 0.9, -hw + 0.03], [R, -hw + 0.04], [R, hw - 0.02], [R * 0.955, hw - 0.012]])]
    // Each spoke leaves the hub as one blade and forks to the rim.
    const fork = new THREE.Shape()
    for (const [i, p] of ([[-0.05, 0.14], [-0.036, 0.5], [-0.235, 0.975], [-0.165, 0.975], [0, 0.63], [0.165, 0.975], [0.235, 0.975], [0.036, 0.5], [0.05, 0.14]] as const).entries()) {
        fork[i ? 'lineTo' : 'moveTo'](p[0] * R, p[1] * R)
    }
    fork.closePath()
    const SPOKES = 7
    const face = hw - 0.04
    const dish = 0.075
    for (let i = 0; i < SPOKES; i++) {
        const spoke = new THREE.ExtrudeGeometry(fork, { depth: 0.022, bevelEnabled: false })
        spoke.rotateY(Math.PI / 2)
        spoke.rotateX(i / SPOKES * Math.PI * 2)
        const position = spoke.attributes.position!
        // Dished: the spokes fall away from the rim's face to a hub set deep in the wheel.
        for (let k = 0; k < position.count; k++) {
            const reach = Math.min(1, Math.hypot(position.getY(k), position.getZ(k)) / (R * 0.975))
            position.setX(k, position.getX(k) + face - dish * (1 - reach) * (1 - reach * 0.4))
        }
        spoke.computeVertexNormals()
        dark.push(normalize(spoke))
        spoke.dispose()
    }
    const hub = new THREE.CylinderGeometry(R * 0.2, R * 0.25, 0.05, 20).rotateZ(Math.PI / 2).translate(face - dish + 0.012, 0, 0)
    dark.push(normalize(hub))
    hub.dispose()
    // The disc's bell, dark behind the spokes.
    const bell = new THREE.CylinderGeometry(R * 0.4, R * 0.44, 0.07, 20).rotateZ(Math.PI / 2).translate(hw - 0.165, 0, 0)
    dark.push(normalize(bell))
    bell.dispose()
    const rim = mergeGeometries(dark, false)!
    for (const g of dark) g.dispose()

    // The bright parts: a machined lip round the rim and the centre-lock nut.
    const lip = lathe([[R, hw - 0.03], [R * 1.03, hw - 0.008], [R * 0.985, hw + 0.002], [R * 0.94, hw - 0.014]])
    const nutRaw = new THREE.CylinderGeometry(R * 0.1, R * 0.13, 0.04, 6).rotateZ(Math.PI / 2).translate(face - dish + 0.05, 0, 0)
    const nut = normalize(nutRaw)
    nutRaw.dispose()
    const bright = mergeGeometries([lip, nut], false)!
    lip.dispose()
    nut.dispose()

    const discRaw = new THREE.CylinderGeometry(R * 0.9, R * 0.9, 0.035, 40).rotateZ(Math.PI / 2).translate(hw - 0.18, 0, 0)
    const disc = normalize(discRaw)
    discRaw.dispose()
    // A long caliper round the disc's trailing top, where it shows through the spokes.
    const arc = new THREE.Shape()
    arc.absarc(0, 0, R * 0.95, 1.7, 3.15, false)
    arc.absarc(0, 0, R * 0.55, 3.15, 1.7, true)
    const calRaw = new THREE.ExtrudeGeometry(arc, { depth: 0.1, bevelEnabled: false, curveSegments: 10 }).rotateY(Math.PI / 2).translate(hw - 0.235, 0, 0)
    const caliper = normalize(calRaw)
    calRaw.dispose()
    // Sidewall lettering; a ring's uv is flat across it, so it maps straight onto the atlas's round decal.
    const ring = new THREE.RingGeometry(r * 0.8, r * 0.975, 48, 1)
    mapToDecal(ring, DECALS.tyre)
    ring.rotateY(Math.PI / 2)
    ring.translate(hw + 0.002, 0, 0)
    const letters = normalize(ring)
    ring.dispose()
    return { tire, rim, bright, disc, caliper, letters }
}

export function buildSpectre(color: number): PlayerCar {
    const s = modelShared()
    // Deep metallic under a hard clearcoat, in the player's colour.
    const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.24, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.04 })
    // A blacked-out canopy that throws back an ice-blue glint.
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x04070b, roughness: 0.06, metalness: 0.3, envMapIntensity: 1, clearcoat: 1, specularColor: 0x6cc8ff })

    const kit = new Kit()
    addBody(kit)
    addNose(kit)
    addCanopy(kit)
    addFlank(kit)
    addFin(kit)
    addWing(kit)
    addTail(kit)

    const wheel = spectreWheel(WHEEL_R, WHEEL_W)
    return assembleCar({
        kit,
        paint,
        materials: { glass },
        wheel: {
            r: WHEEL_R,
            w: WHEEL_W,
            halfTrack: HALF_TRACK,
            axles: [-AXLE_U, AXLE_U],
            parts: () => [new THREE.Mesh(wheel.tire, s.slots.rubber), new THREE.Mesh(wheel.rim, s.slots.rim), new THREE.Mesh(wheel.bright, s.slots.chrome), new THREE.Mesh(wheel.disc, s.slots.disc), new THREE.Mesh(wheel.letters, s.slots.decal)],
            fixed: () => [new THREE.Mesh(wheel.caliper, s.slots.caliper)]
        },
        flames: SIDES.map(side => new THREE.Vector3(side * PIPE_X, PIPE_Y, TAIL_Z + 0.04)),
        flame: { r: 0.06, length: 1.05 },
        tailPoints: SIDES.map(side => new THREE.Vector3(side * 0.74, 0.7, TAIL_Z + 0.02)),
        owned: [glass, ...Object.values(wheel)]
    })
}
