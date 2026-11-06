import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { assembleCar } from './car-assembly'
import { Kit, type Pt } from './car-kit'
import type { PlayerCar } from './car-models'

/** The OG, Nitro Rush's first car: side profiles drawn as splines, extruded across the car with a rounded bevel. Everything faces -z. */

/** The low sports coupe's shape, in (forward, up) metres. */
const D = {
    top: [[2.3, 0.26], [2.38, 0.42], [2.2, 0.58], [1.5, 0.74], [0.85, 0.82], [-0.8, 0.88], [-1.75, 0.94], [-2.2, 0.95], [-2.3, 0.9], [-2.32, 0.7], [-2.26, 0.5], [-2.12, 0.38], [-1.95, 0.32]] as Pt[],
    cabin: [[0.95, 0.8], [0.15, 1.16], [-0.55, 1.19], [-1.75, 0.9]] as Pt[],
    roof: [[0.18, 1.14], [-0.2, 1.2], [-0.62, 1.19], [-1.0, 1.1]] as Pt[],
    width: 2.0, arches: [-1.42, 1.42], archR: 0.43, wheelR: 0.37, wheelW: 0.3, archY: 0.36, sill: 0.18,
    /** Head and tail lamp centres. */
    head: [2.18, 0.6] as Pt,
    tail: [-2.3, 0.78] as Pt,
    /** Beltline and roof height, for the tumblehome. */
    belt: 0.86, roofTop: 1.2,
    /** How much the glasshouse leans in toward the roof. */
    tumble: 0.2,
    /** Extra width over the wheels. */
    flare: 0.05,
    /** How much the nose and tail narrow in plan view. */
    noseTaper: 0.2, tailTaper: 0.1
}

const SIDES = [-1, 1] as const
const BODY_BEVEL = 0.14
const PIPE_XS = [0.5, 0.68]
const PIPE_Y = 0.23

/** Spline through the points; corners stay soft. */
function splinePoints(pts: Pt[], segs = 40) {
    return new THREE.SplineCurve(pts.map(([u, v]) => new THREE.Vector2(u, v))).getPoints(segs)
}

/** A side profile: the top as a spline from the front bumper over the roof to the rear bumper, then the sill with wheel arches. */
function bodyShape() {
    const s = new THREE.Shape()
    const pts = splinePoints(D.top, 60)
    s.moveTo(pts[0]!.x, pts[0]!.y)
    for (const p of pts.slice(1)) s.lineTo(p.x, p.y)
    s.lineTo(D.top[D.top.length - 1]![0] + 0.02, D.sill)
    for (const c of [...D.arches].sort((a, b) => a - b)) {
        s.lineTo(c - D.archR, D.sill)
        s.absarc(c, D.archY, D.archR, Math.PI, 0, true)
    }
    s.lineTo(D.top[0]![0] - 0.02, D.sill)
    s.closePath()
    return s
}

/** A closed shape: spline over the top, straight back along the bottom. */
function capShape(top: Pt[]) {
    const s = new THREE.Shape()
    const pts = splinePoints(top, 36)
    s.moveTo(pts[0]!.x, pts[0]!.y)
    for (const p of pts.slice(1)) s.lineTo(p.x, p.y)
    s.closePath()
    return s
}

/** Extrudes a profile across the car, then re-welds it so the bevel shades as one curved panel. */
function extrudeAcross(shape: THREE.Shape, width: number, bevel: number, segs = 4) {
    const depth = Math.max(0.01, width - bevel * 2)
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: segs, curveSegments: 12 })
    g.translate(0, 0, -depth / 2)
    g.rotateY(Math.PI / 2)
    g.deleteAttribute('normal')
    g.deleteAttribute('uv')
    const welded = mergeVertices(g, 1e-3)
    welded.computeVertexNormals()
    g.dispose()
    return welded
}

const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
}

/** Body width multiplier at (forward, up): plan taper, tumblehome, wheel flares, tucked sills. */
function widthAt(u: number, v: number) {
    const t = u / D.top[0]![0]
    const nose = smoothstep(0.55, 1.05, t)
    const tail = smoothstep(0.6, 1.05, -t)
    let k = 1 - D.noseTaper * nose * nose - D.tailTaper * tail * tail
    k *= 1 - D.tumble * smoothstep(D.belt - 0.04, D.roofTop, v)
    for (const c of D.arches) {
        const g = (u - c) / 0.6
        k += D.flare * Math.exp(-g * g) * smoothstep(D.sill + 0.1, D.archY + 0.2, v) * (1 - smoothstep(D.belt - 0.15, D.belt, v))
    }
    k *= 1 - 0.07 * (1 - smoothstep(D.sill, D.sill + 0.3, v))
    return k
}

/** Pulls an across-extruded panel into the car's plan shape, then re-shades it. */
function sculpt(g: THREE.BufferGeometry) {
    const pos = g.attributes.position!
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * widthAt(-pos.getZ(i), pos.getY(i)))
    pos.needsUpdate = true
    g.computeVertexNormals()
    return g
}

/** Half-width of the sculpted body at (forward, up). */
const edgeX = (u: number, v: number) => D.width / 2 * widthAt(u, v)

/** Depth (+z) of the tail at height v; the bevel pushes the skin past the profile, so parts placed on the raw profile end up buried. */
function rearZ(v: number) {
    const pts = splinePoints(D.top, 60)
    pts.push(new THREE.Vector2(D.top[D.top.length - 1]![0] + 0.02, D.sill))
    const off = pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)]!
        const c = pts[Math.min(pts.length - 1, i + 1)]!
        const len = Math.hypot(c.x - a.x, c.y - a.y) || 1
        return new THREE.Vector2(p.x + (c.y - a.y) / len * BODY_BEVEL * 0.8, p.y - (c.x - a.x) / len * BODY_BEVEL * 0.8)
    })
    let u = 0
    for (let i = 1; i < off.length; i++) {
        const p = off[i - 1]!
        const q = off[i]!
        if ((p.y - v) * (q.y - v) > 0 || p.y === q.y) continue
        u = Math.min(u, p.x + (q.x - p.x) * (v - p.y) / (q.y - p.y))
    }
    return -u
}

/** Rear face of the black valance, set in behind the tail lamps; the diffuser and pipes hang off it. */
const VALANCE_Z = rearZ(D.tail[1]) - 0.12

/** Body, glasshouse and roof, with the wheel tubs blacked out so no daylight shows through the arches. */
function addShell(kit: Kit) {
    const body = sculpt(extrudeAcross(bodyShape(), D.width, BODY_BEVEL, 5))
    kit.add('paint', body)
    body.dispose()
    // Opaque like all car glass now, so the seats it once showed are left out.
    const cabin = sculpt(extrudeAcross(capShape(D.cabin), D.width - 0.2, 0.09, 4))
    kit.add('glass', cabin)
    cabin.dispose()
    const roofShape = capShape([...D.roof, ...[...D.roof].reverse().map(([u, v]) => [u, v - 0.08] as Pt)])
    const roof = sculpt(extrudeAcross(roofShape, D.width - 0.2, 0.05, 3))
    kit.add('paint', roof, 0, 0.014, 0)
    roof.dispose()
    kit.box('trim', D.width - 0.62, D.archY + D.archR - D.sill - 0.05, (D.top[0]![0] - D.top[D.top.length - 1]![0]) - 0.5, 0, (D.sill + D.archY + D.archR) / 2, 0, 0.05)
}

/** Lamps, mirrors, glass trim and skirts on each side, the light bar, splitter, valance and plate. */
function addDetails(kit: Kit) {
    const [hu, hv] = D.head
    const [tu, tv] = D.tail
    const tz = rearZ(tv)
    for (const side of SIDES) {
        // Headlamp: a slim housing following the nose, with a white LED brow.
        const hx = side * (edgeX(hu - 0.12, hv) - 0.3)
        kit.box('trim', 0.44, 0.13, 0.22, hx, hv, -hu + 0.06, 0.05)
        kit.box('head', 0.38, 0.035, 0.05, hx, hv + 0.045, -hu - 0.04, 0.015)
        kit.box('chrome', 0.2, 0.07, 0.04, hx - side * 0.06, hv - 0.02, -hu - 0.03, 0.03)
        // Tail lamp: emissive core behind a red lens, wrapping toward the flank.
        const tx = side * (edgeX(tu + 0.1, tv) - 0.3)
        kit.box('tail', 0.42, 0.07, 0.04, tx, tv, tz + 0.02, 0.02)
        kit.box('lens', 0.5, 0.15, 0.08, tx, tv, tz + 0.01, 0.04)
        // Mirrors on stalks, ahead of the side glass.
        const mu = D.cabin[0]![0] - 0.25
        const mx = side * (edgeX(mu, D.belt) + 0.1)
        kit.box('paint', 0.2, 0.12, 0.08, mx, D.belt + 0.1, -mu, 0.04)
        kit.box('trim', 0.12, 0.03, 0.05, mx - side * 0.1, D.belt + 0.05, -mu, 0.012)
        // Chrome along the bottom of the side glass.
        const trimLen = D.cabin[0]![0] - D.cabin[D.cabin.length - 1]![0] - 0.3
        const trimU = (D.cabin[0]![0] + D.cabin[D.cabin.length - 1]![0]) / 2
        kit.box('chrome', 0.02, 0.025, trimLen, side * (edgeX(trimU, D.belt) - 0.03), D.belt + 0.01, -trimU, 0.01)
        // Side skirt between the wheels.
        const skirtLen = D.arches[1]! - D.arches[0]! - D.archR * 2 - 0.1
        kit.box('trim', 0.06, 0.1, skirtLen, side * (edgeX(0, D.sill + 0.05) + 0.01), D.sill + 0.04, -(D.arches[0]! + D.arches[1]!) / 2, 0.03)
    }
    kit.box('tail', D.width * 0.62, 0.02, 0.03, 0, tv + 0.06, rearZ(tv + 0.06) + 0.01, 0.01)
    kit.box('trim', D.width * 0.86, 0.05, 0.3, 0, D.sill - 0.02, -(D.top[0]![0] - 0.1), 0.02)
    kit.box('trim', D.width * 0.78, 0.26, 0.5, 0, D.sill + 0.05, VALANCE_Z - 0.25, 0.06)
    // The plate sits on the bumper, tilted to its slope.
    const pv = tv - 0.2
    const pz = rearZ(pv)
    const tilt = Math.atan2(rearZ(pv + 0.04) - rearZ(pv - 0.04), 0.08)
    kit.box('trim', 0.58, 0.16, 0.04, 0, pv, pz - 0.01, 0.015, tilt)
    const plate = new THREE.PlaneGeometry(0.52, 0.12)
    kit.add('plate', plate, 0, pv, pz + 0.012, tilt)
    plate.dispose()
}

/** Swan-neck wing, diffuser fins, quad pipes and bonnet vents. */
function addAero(kit: Kit) {
    const wing = new THREE.Shape()
    wing.moveTo(0.18, 0)
    wing.quadraticCurveTo(0.05, 0.05, -0.2, 0.03)
    wing.lineTo(-0.2, 0.0)
    wing.quadraticCurveTo(0.0, 0.0, 0.18, -0.02)
    wing.closePath()
    const wingGeo = new THREE.ExtrudeGeometry(wing, { depth: 1.84, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.01, bevelSegments: 2 })
    wingGeo.translate(0, 0, -0.92)
    wingGeo.rotateY(Math.PI / 2)
    kit.add('trim', wingGeo, 0, 1.13, 1.95)
    wingGeo.dispose()
    const pipe = new THREE.CylinderGeometry(0.055, 0.06, 0.22, 16, 1, true).rotateX(Math.PI / 2)
    for (const side of SIDES) {
        kit.box('trim', 0.12, 0.03, 0.42, side * 0.94, 1.13, 1.95, 0.01)
        kit.box('trim', 0.04, 0.24, 0.12, side * 0.5, 1.0, 1.98, 0.015)
        kit.box('trim', 0.03, 0.18, 0.34, side * 0.28, 0.2, VALANCE_Z - 0.14, 0.01)
        kit.box('trim', 0.03, 0.18, 0.34, side * 0.12, 0.2, VALANCE_Z - 0.14, 0.01)
        for (const x of PIPE_XS) kit.add('chrome', pipe, side * x, PIPE_Y, VALANCE_Z - 0.04)
        kit.box('trim', 0.34, 0.015, 0.4, side * 0.38, 0.79, -1.55, 0.006)
    }
    pipe.dispose()
}

export function buildOg(color: number): PlayerCar {
    const kit = new Kit()
    addShell(kit)
    addDetails(kit)
    addAero(kit)
    const tailZ = rearZ(D.tail[1]) + 0.05
    return assembleCar({
        kit,
        paint: new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.03 }),
        wheel: { r: D.wheelR, w: D.wheelW, halfTrack: edgeX(D.arches[0]!, D.archY) - D.wheelW / 2 + 0.02, axles: D.arches },
        flames: SIDES.flatMap(side => PIPE_XS.map(x => new THREE.Vector3(side * x, PIPE_Y, VALANCE_Z + 0.06))),
        tailPoints: SIDES.map(side => new THREE.Vector3(side * 0.65, D.tail[1], tailZ))
    })
}
