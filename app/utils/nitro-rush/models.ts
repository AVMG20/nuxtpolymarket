import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { plateTexture, shadowTexture } from './textures'

/**
 * Procedural cars. Bodies are side profiles drawn as splines, extruded with a
 * rounded bevel and re-smoothed, so they read as pressed metal rather than
 * boxes. A car's parts are merged into one mesh per material slot.
 *
 * Everything faces -z, the direction of travel. Cosmetic choices use Math.random.
 */

type Slot = 'paint' | 'glass' | 'trim' | 'chrome' | 'rubber' | 'rim' | 'tail' | 'head' | 'amber' | 'plate' | 'interior' | 'disc' | 'caliper' | 'cabin' | 'lens'
type Pt = [number, number]

let shared: ReturnType<typeof createShared> | null = null

function createShared() {
    const shadowMap = shadowTexture()
    return {
        shadowMap,
        shadowGeo: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        shadow: new THREE.MeshBasicMaterial({ map: shadowMap, color: 0x000000, transparent: true, opacity: 0.85, depthWrite: false }),
        slots: {
            // Tinted, see-through glass: you can make out the seats inside.
            glass: new THREE.MeshPhysicalMaterial({ color: 0x080b10, roughness: 0.02, metalness: 0.2, transparent: true, opacity: 0.86, envMapIntensity: 2.2, clearcoat: 1 }),
            trim: new THREE.MeshStandardMaterial({ color: 0x0f0f11, roughness: 0.6, metalness: 0.2 }),
            chrome: new THREE.MeshStandardMaterial({ color: 0xd8dbe2, roughness: 0.1, metalness: 1 }),
            rubber: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.92, side: THREE.DoubleSide }),
            rim: new THREE.MeshStandardMaterial({ color: 0xa4a9b2, roughness: 0.22, metalness: 1, side: THREE.DoubleSide }),
            tail: new THREE.MeshStandardMaterial({ color: 0x400005, emissive: 0xff1418, emissiveIntensity: 3.2, roughness: 0.2 }),
            head: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xfff4dc, emissiveIntensity: 2.4, roughness: 0.1 }),
            amber: new THREE.MeshStandardMaterial({ color: 0x3a2000, emissive: 0xffa21a, emissiveIntensity: 2.4 }),
            interior: new THREE.MeshStandardMaterial({ color: 0x1c1912, emissive: 0xffd9a0, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.5 }),
            disc: new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 0.35, metalness: 0.9 }),
            caliper: new THREE.MeshStandardMaterial({ color: 0xb3121c, roughness: 0.35, metalness: 0.3 }),
            cabin: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.8 }),
            // Red lens glass over the tail lamps: dark when off, it lets the lamp glow through.
            lens: new THREE.MeshPhysicalMaterial({ color: 0x5a0008, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55, clearcoat: 1 })
        } as Record<Exclude<Slot, 'paint' | 'plate'>, THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial>,
        wheels: new Map<string, Record<'tire' | 'rim' | 'disc' | 'caliper', THREE.BufferGeometry>>()
    }
}

export function modelShared() {
    if (!shared) shared = createShared()
    return shared
}

export function disposeModelShared() {
    if (!shared) return
    const s = shared
    s.shadowMap.dispose()
    s.shadowGeo.dispose()
    s.shadow.dispose()
    for (const m of Object.values(s.slots)) {
        m.map?.dispose()
        m.dispose()
    }
    for (const w of s.wheels.values()) for (const g of Object.values(w)) g.dispose()
    shared = null
}

// ─── Geometry helpers ──────────────────────────────────────────────────────

/** Strip to position/normal/uv, non-indexed, so anything can be merged with anything. */
function normalize(g: THREE.BufferGeometry) {
    const out = g.index ? g.toNonIndexed() : g.clone()
    for (const name of Object.keys(out.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name)
    }
    if (!out.attributes.normal) out.computeVertexNormals()
    if (!out.attributes.uv) out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(out.attributes.position!.count * 2), 2))
    return out
}

/** Re-weld and smooth a bevelled extrusion so it shades as one curved panel. */
function smooth(g: THREE.BufferGeometry) {
    g.deleteAttribute('normal')
    g.deleteAttribute('uv')
    const welded = mergeVertices(g, 1e-3)
    welded.computeVertexNormals()
    g.dispose()
    return welded
}

/** Spline through the points; corners stay soft. */
function splinePoints(pts: Pt[], segs = 40) {
    return new THREE.SplineCurve(pts.map(([u, v]) => new THREE.Vector2(u, v))).getPoints(segs)
}

/**
 * A body side profile in (forward, up): the top as a spline from the front
 * bumper over the roof to the rear bumper, then the sill with wheel arches.
 */
function bodyShape(top: Pt[], arches: { c: number, r: number }[], archY: number, sill: number) {
    const s = new THREE.Shape()
    const pts = splinePoints(top, 60)
    s.moveTo(pts[0]!.x, pts[0]!.y)
    for (const p of pts.slice(1)) s.lineTo(p.x, p.y)
    const rear = top[top.length - 1]![0]
    s.lineTo(rear + 0.02, sill)
    for (const a of [...arches].sort((x, y) => x.c - y.c)) {
        s.lineTo(a.c - a.r, sill)
        s.absarc(a.c, archY, a.r, Math.PI, 0, true)
    }
    s.lineTo(top[0]![0] - 0.02, sill)
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

/** Extrude a profile across the car (x) and turn it so forward is -z. */
function extrudeAcross(shape: THREE.Shape, width: number, bevel: number, segs = 4) {
    const depth = Math.max(0.01, width - bevel * 2)
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: segs, curveSegments: 12 })
    g.translate(0, 0, -depth / 2)
    g.rotateY(Math.PI / 2)
    return smooth(g)
}

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpE = new THREE.Euler()

class Kit {
    readonly parts = new Map<Slot, THREE.BufferGeometry[]>()

    add(slot: Slot, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
        const g = normalize(geo)
        tmpM.compose(new THREE.Vector3(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz))
        g.applyMatrix4(tmpM)
        const list = this.parts.get(slot) ?? []
        list.push(g)
        this.parts.set(slot, list)
        return this
    }

    box(slot: Slot, w: number, h: number, d: number, x: number, y: number, z: number, r = 0.03, rx = 0) {
        const geo = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2))
        this.add(slot, geo, x, y, z, rx)
        geo.dispose()
        return this
    }

    /** A thin panel between two profile points (forward, up), offset outward. */
    panel(slot: Slot, a: Pt, b: Pt, width: number, thick = 0.04, out = 0.02) {
        const dz = -(b[0] - a[0])
        const dy = b[1] - a[1]
        const len = Math.hypot(dz, dy)
        // Outward normal in the (z, y) plane, pointing up/forward-ish away from the body.
        let nz = -dy / len
        let ny = dz / len
        if (ny < 0) {
            nz = -nz
            ny = -ny
        }
        const cz = -(a[0] + b[0]) / 2 + nz * out
        const cy = (a[1] + b[1]) / 2 + ny * out
        const geo = new RoundedBoxGeometry(width, thick, len, 2, Math.min(0.015, thick / 2))
        this.add(slot, geo, 0, cy, cz, Math.atan2(-dy, dz))
        geo.dispose()
        return this
    }

    wheels(r: number, w: number, halfTrack: number, zs: number[], dual = false, brakes = true) {
        const set = wheelGeos(r, w * (dual ? 1.7 : 1), !dual)
        for (const z of zs) {
            for (const side of [-1, 1]) {
                const ry = side > 0 ? 0 : Math.PI
                this.add('rubber', set.tire, side * halfTrack, r, z, 0, ry)
                this.add('rim', set.rim, side * halfTrack, r, z, 0, ry)
                if (brakes) {
                    this.add('disc', set.disc, side * halfTrack, r, z, 0, ry)
                    this.add('caliper', set.caliper, side * halfTrack, r, z, 0, ry)
                }
            }
        }
        return this
    }

    bake() {
        const out = new Map<Slot, THREE.BufferGeometry>()
        for (const [slot, list] of this.parts) {
            const merged = mergeGeometries(list, false)
            if (merged) {
                merged.computeBoundingSphere()
                out.set(slot, merged)
            }
            for (const g of list) g.dispose()
        }
        return out
    }
}

/**
 * Low-profile tyre, multi-spoke alloy, brake disc and caliper. Axis along x,
 * outer face at +x. `sporty` gives cars the deep-dish ten-spoke; trucks get a
 * plain steel wheel.
 */
function wheelGeos(r: number, w: number, sporty = true) {
    const key = `${r.toFixed(3)}:${w.toFixed(3)}:${sporty}`
    const s = modelShared()
    const cached = s.wheels.get(key)
    if (cached) return cached
    const hw = w / 2
    const rim = sporty ? 0.74 : 0.62
    const tireProfile = [
        new THREE.Vector2(r * rim, -hw + 0.01), new THREE.Vector2(r * 0.86, -hw), new THREE.Vector2(r * 0.97, -hw + w * 0.1),
        new THREE.Vector2(r, -hw + w * 0.28), new THREE.Vector2(r, hw - w * 0.28), new THREE.Vector2(r * 0.97, hw - w * 0.1),
        new THREE.Vector2(r * 0.86, hw), new THREE.Vector2(r * rim, hw - 0.01)
    ]
    const tire = new THREE.LatheGeometry(tireProfile, 32)
    tire.rotateZ(-Math.PI / 2)
    const rimParts: THREE.BufferGeometry[] = []
    const R = r * rim
    // Barrel and lip, then a dished face the spokes sit in.
    const barrel = new THREE.LatheGeometry([
        new THREE.Vector2(R * 0.96, -hw + 0.03), new THREE.Vector2(R, -hw + 0.04), new THREE.Vector2(R, hw - 0.02),
        new THREE.Vector2(R * 1.02, hw - 0.005), new THREE.Vector2(R * 0.94, hw)
    ], 32)
    barrel.rotateZ(-Math.PI / 2)
    rimParts.push(normalize(barrel))
    barrel.dispose()
    const hub = new THREE.CylinderGeometry(R * 0.2, R * 0.24, 0.06, 16).rotateZ(Math.PI / 2).translate(hw - 0.06, 0, 0)
    rimParts.push(normalize(hub))
    hub.dispose()
    const spokes = sporty ? 10 : 6
    for (let i = 0; i < spokes; i++) {
        const twin = sporty && i % 2 === 1
        const spoke = new RoundedBoxGeometry(0.03, R * 0.8, R * (sporty ? 0.085 : 0.16), 2, 0.012)
        spoke.translate(hw - 0.05 - (twin ? 0.015 : 0), R * 0.56, 0)
        // Dish: spokes lean outward toward the hub.
        spoke.rotateZ(sporty ? -0.08 : 0)
        spoke.rotateX((i / spokes) * Math.PI * 2 + (twin ? 0.12 : 0))
        rimParts.push(normalize(spoke))
        spoke.dispose()
    }
    if (!sporty) {
        const face = new THREE.CylinderGeometry(R * 0.98, R * 0.98, 0.02, 24).rotateZ(Math.PI / 2).translate(hw - 0.08, 0, 0)
        rimParts.push(normalize(face))
        face.dispose()
    }
    const rimGeo = mergeGeometries(rimParts, false)!
    for (const p of rimParts) p.dispose()
    const discRaw = new THREE.CylinderGeometry(R * 0.82, R * 0.82, 0.04, 28).rotateZ(Math.PI / 2).translate(hw - 0.2, 0, 0)
    const disc = normalize(discRaw)
    discRaw.dispose()
    // Caliper clamps the disc at the trailing top, where it shows through the spokes.
    const calRaw = new RoundedBoxGeometry(0.1, R * 0.32, R * 0.5, 2, 0.03).translate(hw - 0.15, R * 0.62, R * 0.25)
    const caliper = normalize(calRaw)
    calRaw.dispose()
    const set = { tire: normalize(tire), rim: rimGeo, disc, caliper }
    tire.dispose()
    s.wheels.set(key, set)
    return set
}

// ─── Vehicle designs ───────────────────────────────────────────────────────

interface CarDesign {
    top: Pt[]
    cabin: Pt[]
    roof: Pt[]
    width: number
    arches: number[]
    archR: number
    wheelR: number
    wheelW: number
    archY: number
    sill: number
    /** Head and tail lamp centres in (forward, up). */
    head: Pt
    tail: Pt
    /** Beltline and roof height, for the tumblehome. */
    belt: number
    roofTop: number
    /** How much the glasshouse leans in toward the roof. */
    tumble: number
    /** Extra width over the wheels. */
    flare: number
    /** How much the nose and tail narrow in plan view. */
    noseTaper: number
    tailTaper: number
}

const DESIGNS: Record<string, CarDesign> = {
    sedan: {
        top: [[2.3, 0.3], [2.36, 0.5], [2.25, 0.7], [1.6, 0.84], [0.9, 0.92], [-0.9, 0.96], [-1.6, 0.98], [-2.15, 0.94], [-2.33, 0.75], [-2.3, 0.32]],
        cabin: [[1.0, 0.9], [0.25, 1.37], [-0.75, 1.41], [-1.45, 1.2], [-1.78, 0.94]],
        roof: [[0.3, 1.35], [-0.2, 1.41], [-0.75, 1.42], [-1.25, 1.3]],
        width: 1.84, arches: [-1.38, 1.38], archR: 0.42, wheelR: 0.34, wheelW: 0.24, archY: 0.34, sill: 0.24,
        head: [2.25, 0.68], tail: [-2.28, 0.84], belt: 0.94, roofTop: 1.42, tumble: 0.2, flare: 0.025, noseTaper: 0.14, tailTaper: 0.08
    },
    hatch: {
        top: [[2.05, 0.3], [2.1, 0.52], [1.95, 0.72], [1.3, 0.86], [0.75, 0.94], [-1.5, 0.98], [-1.98, 0.95], [-2.08, 0.7], [-2.05, 0.32]],
        cabin: [[0.85, 0.92], [0.15, 1.42], [-1.55, 1.46], [-1.98, 1.02], [-1.99, 0.95]],
        roof: [[0.2, 1.4], [-0.7, 1.47], [-1.55, 1.46]],
        width: 1.76, arches: [-1.28, 1.28], archR: 0.4, wheelR: 0.32, wheelW: 0.22, archY: 0.33, sill: 0.24,
        head: [1.97, 0.72], tail: [-2.03, 0.9], belt: 0.96, roofTop: 1.47, tumble: 0.18, flare: 0.02, noseTaper: 0.14, tailTaper: 0.06
    },
    coupe: {
        top: [[2.25, 0.3], [2.3, 0.5], [2.15, 0.66], [1.5, 0.78], [0.8, 0.86], [-1.2, 0.9], [-2.0, 0.92], [-2.25, 0.8], [-2.27, 0.32]],
        cabin: [[0.9, 0.84], [0.1, 1.24], [-0.7, 1.26], [-1.85, 0.9]],
        roof: [[0.15, 1.22], [-0.3, 1.27], [-0.8, 1.25]],
        width: 1.86, arches: [-1.4, 1.38], archR: 0.42, wheelR: 0.34, wheelW: 0.25, archY: 0.33, sill: 0.22,
        head: [2.17, 0.62], tail: [-2.22, 0.8], belt: 0.88, roofTop: 1.27, tumble: 0.24, flare: 0.035, noseTaper: 0.16, tailTaper: 0.1
    },
    suv: {
        top: [[2.4, 0.42], [2.46, 0.75], [2.3, 1.0], [1.4, 1.12], [0.95, 1.16], [-1.9, 1.2], [-2.38, 1.15], [-2.44, 0.8], [-2.4, 0.45]],
        cabin: [[1.0, 1.14], [0.45, 1.68], [-1.95, 1.73], [-2.3, 1.22], [-2.32, 1.16]],
        roof: [[0.5, 1.66], [-0.7, 1.75], [-1.95, 1.74]],
        width: 1.96, arches: [-1.5, 1.5], archR: 0.5, wheelR: 0.42, wheelW: 0.27, archY: 0.44, sill: 0.34,
        head: [2.36, 0.92], tail: [-2.4, 1.12], belt: 1.17, roofTop: 1.75, tumble: 0.14, flare: 0.03, noseTaper: 0.1, tailTaper: 0.05
    },
    sports: {
        top: [[2.3, 0.26], [2.38, 0.42], [2.2, 0.58], [1.5, 0.74], [0.85, 0.82], [-0.8, 0.88], [-1.75, 0.94], [-2.2, 0.95], [-2.3, 0.9], [-2.32, 0.7], [-2.26, 0.5], [-2.12, 0.38], [-1.95, 0.32]],
        cabin: [[0.95, 0.8], [0.15, 1.16], [-0.55, 1.19], [-1.75, 0.9]],
        roof: [[0.18, 1.14], [-0.2, 1.2], [-0.62, 1.19], [-1.0, 1.1]],
        width: 2.0, arches: [-1.42, 1.42], archR: 0.43, wheelR: 0.37, wheelW: 0.3, archY: 0.36, sill: 0.18,
        head: [2.18, 0.6], tail: [-2.3, 0.78], belt: 0.86, roofTop: 1.2, tumble: 0.2, flare: 0.05, noseTaper: 0.2, tailTaper: 0.1
    }
}

const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
}

/** Body width multiplier at (forward, up): plan taper, tumblehome, wheel flares, tucked sills. */
function widthAt(d: CarDesign, u: number, v: number) {
    const half = d.top[0]![0]
    const t = u / half
    const nose = smoothstep(0.55, 1.05, t)
    const tail = smoothstep(0.6, 1.05, -t)
    let k = 1 - d.noseTaper * nose * nose - d.tailTaper * tail * tail
    k *= 1 - d.tumble * smoothstep(d.belt - 0.04, d.roofTop, v)
    for (const c of d.arches) {
        const g = (u - c) / 0.6
        k += d.flare * Math.exp(-g * g) * smoothstep(d.sill + 0.1, d.archY + 0.2, v) * (1 - smoothstep(d.belt - 0.15, d.belt, v))
    }
    k *= 1 - 0.07 * (1 - smoothstep(d.sill, d.sill + 0.3, v))
    return k
}

/** Pull an across-extruded panel into the car's real plan shape, then re-shade it. */
function sculpt(g: THREE.BufferGeometry, d: CarDesign) {
    const pos = g.attributes.position!
    for (let i = 0; i < pos.count; i++) {
        pos.setX(i, pos.getX(i) * widthAt(d, -pos.getZ(i), pos.getY(i)))
    }
    pos.needsUpdate = true
    g.computeVertexNormals()
    return g
}

/** Half-width of the sculpted body surface at (forward, up). */
const edgeX = (d: CarDesign, u: number, v: number) => d.width / 2 * widthAt(d, u, v)

const BODY_BEVEL = 0.14

/** Depth (+z) of the body's tail at height v; the bevel pushes the skin past the profile, so parts placed on the raw profile end up buried. */
function rearZ(d: CarDesign, v: number) {
    const pts = splinePoints(d.top, 60)
    pts.push(new THREE.Vector2(d.top[d.top.length - 1]![0] + 0.02, d.sill))
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

/** Rear face of the black valance, set in behind the tail lamps. */
const valanceZ = (d: CarDesign) => rearZ(d, d.tail[1]) - 0.12

/** Body, glasshouse, roof, cabin, lights, aero and details for a car-shaped design. */
function carKit(d: CarDesign, wheels = true) {
    const k = new Kit()
    const body = sculpt(extrudeAcross(bodyShape(d.top, d.arches.map(c => ({ c, r: d.archR })), d.archY, d.sill), d.width, BODY_BEVEL, 5), d)
    k.add('paint', body)
    body.dispose()
    const cabin = sculpt(extrudeAcross(capShape(d.cabin), d.width - 0.2, 0.09, 4), d)
    k.add('glass', cabin)
    cabin.dispose()
    const roofPts = d.roof
    const roofShape = capShape([...roofPts, ...[...roofPts].reverse().map(([u, v]) => [u, v - 0.08] as Pt)])
    const roof = sculpt(extrudeAcross(roofShape, d.width - 0.2, 0.05, 3), d)
    k.add('paint', roof, 0, 0.014, 0)
    roof.dispose()

    // Wheel wells: a dark tub so you never see daylight through the arches.
    k.box('trim', d.width - 0.62, d.archY + d.archR - d.sill - 0.05, (d.top[0]![0] - d.top[d.top.length - 1]![0]) - 0.5, 0, (d.sill + d.archY + d.archR) / 2, 0, 0.05)

    // Cabin: seats with headrests and a dash, seen through the glass.
    const seatU = (d.cabin[0]![0] + d.cabin[d.cabin.length - 1]![0]) / 2 - 0.15
    for (const side of [-1, 1]) {
        k.box('cabin', 0.48, 0.5, 0.5, side * 0.38, d.belt - 0.05, -seatU, 0.08)
        k.box('cabin', 0.26, 0.2, 0.12, side * 0.38, d.belt + 0.28, -(seatU - 0.22), 0.05)
    }
    k.box('cabin', d.width - 0.5, 0.18, 0.4, 0, d.belt + 0.02, -(d.cabin[0]![0] - 0.25), 0.05)

    const [hu, hv] = d.head
    const [tu, tv] = d.tail
    const tz = rearZ(d, tv)
    for (const side of [-1, 1]) {
        // Headlamp: a slim housing following the nose, with a white LED brow.
        const hx = side * (edgeX(d, hu - 0.12, hv) - 0.3)
        k.box('trim', 0.44, 0.13, 0.22, hx, hv, -hu + 0.06, 0.05)
        k.box('head', 0.38, 0.035, 0.05, hx, hv + 0.045, -hu - 0.04, 0.015)
        k.box('chrome', 0.2, 0.07, 0.04, hx - side * 0.06, hv - 0.02, -hu - 0.03, 0.03)
        // Tail lamp: emissive core behind a red lens, wrapping toward the flank.
        const tx = side * (edgeX(d, tu + 0.1, tv) - 0.3)
        k.box('tail', 0.42, 0.07, 0.04, tx, tv, tz + 0.02, 0.02)
        k.box('lens', 0.5, 0.15, 0.08, tx, tv, tz + 0.01, 0.04)
        // Mirrors on stalks, ahead of the side glass.
        const mu = d.cabin[0]![0] - 0.25
        const mx = side * (edgeX(d, mu, d.belt) + 0.1)
        k.box('paint', 0.2, 0.12, 0.08, mx, d.belt + 0.1, -mu, 0.04)
        k.box('trim', 0.12, 0.03, 0.05, mx - side * 0.1, d.belt + 0.05, -mu, 0.012)
        // Chrome trim along the bottom of the side glass.
        const trimLen = d.cabin[0]![0] - d.cabin[d.cabin.length - 1]![0] - 0.3
        const trimU = (d.cabin[0]![0] + d.cabin[d.cabin.length - 1]![0]) / 2
        k.box('chrome', 0.02, 0.025, trimLen, side * (edgeX(d, trimU, d.belt) - 0.03), d.belt + 0.01, -trimU, 0.01)
        // Side skirt between the wheels.
        const skirtLen = d.arches[1]! - d.arches[0]! - d.archR * 2 - 0.1
        k.box('trim', 0.06, 0.1, skirtLen, side * (edgeX(d, 0, d.sill + 0.05) + 0.01), d.sill + 0.04, -(d.arches[0]! + d.arches[1]!) / 2, 0.03)
    }
    // A thin light bar joins the tail lamps.
    k.box('tail', d.width * 0.62, 0.02, 0.03, 0, tv + 0.06, rearZ(d, tv + 0.06) + 0.01, 0.01)
    // Front splitter, and a rear valance that peeks out under the tucked bumper.
    k.box('trim', d.width * 0.86, 0.05, 0.3, 0, d.sill - 0.02, -(d.top[0]![0] - 0.1), 0.02)
    k.box('trim', d.width * 0.78, 0.26, 0.5, 0, d.sill + 0.05, valanceZ(d) - 0.25, 0.06)
    // Plate on the bumper, tilted to its slope.
    const pv = tv - 0.2
    const pz = rearZ(d, pv)
    const tilt = Math.atan2(rearZ(d, pv + 0.04) - rearZ(d, pv - 0.04), 0.08)
    k.box('trim', 0.58, 0.16, 0.04, 0, pv, pz - 0.01, 0.015, tilt)
    const plate = new THREE.PlaneGeometry(0.52, 0.12)
    k.add('plate', plate, 0, pv, pz + 0.012, tilt)
    plate.dispose()
    if (wheels) k.wheels(d.wheelR, d.wheelW, edgeX(d, d.arches[0]!, d.archY) - d.wheelW / 2 + 0.02, d.arches.map(c => -c))
    return k
}

function slotMaterial(slot: Slot, paint: THREE.Material, plate: THREE.Material): THREE.Material {
    if (slot === 'paint') return paint
    if (slot === 'plate') return plate
    return modelShared().slots[slot]
}

export interface PlayerCar {
    group: THREE.Group
    body: THREE.Group
    paint: THREE.MeshPhysicalMaterial
    wheels: THREE.Object3D[]
    flames: THREE.Mesh[]
    flameMat: THREE.MeshBasicMaterial
    /** Tail-light positions in the car's local space, for the light trails. */
    tailPoints: THREE.Vector3[]
    dispose(): void
}

/** The hero car: a low sports coupe with a wing, diffuser and quad exhaust. */
export function buildPlayerCar(color: number): PlayerCar {
    const s = modelShared()
    const d = DESIGNS.sports!
    const group = new THREE.Group()
    const body = new THREE.Group()
    group.add(body)
    const owned: { dispose(): void }[] = []
    const own = <T extends { dispose(): void }>(x: T) => {
        owned.push(x)
        return x
    }
    const paint = own(new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.03 }))
    // Backlit like the billboards, so the ad still reads at night.
    const plateMap = own(plateTexture())
    const plate = own(new THREE.MeshStandardMaterial({ map: plateMap, emissiveMap: plateMap, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.45 }))
    const kit = carKit(d, false)
    const vz = valanceZ(d)
    // Swan-neck wing, diffuser fins, quad pipes, bonnet vents.
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
    for (const side of [-1, 1]) {
        kit.box('trim', 0.12, 0.03, 0.42, side * 0.94, 1.13, 1.95, 0.01)
        kit.box('trim', 0.04, 0.24, 0.12, side * 0.5, 1.0, 1.98, 0.015)
        kit.box('trim', 0.03, 0.18, 0.34, side * 0.28, 0.2, vz - 0.14, 0.01)
        kit.box('trim', 0.03, 0.18, 0.34, side * 0.12, 0.2, vz - 0.14, 0.01)
        for (const x of [0.5, 0.68]) {
            const pipe = new THREE.CylinderGeometry(0.055, 0.06, 0.22, 16, 1, true).rotateX(Math.PI / 2)
            kit.add('chrome', pipe, side * x, 0.23, vz - 0.04)
            pipe.dispose()
        }
        kit.box('trim', 0.34, 0.015, 0.4, side * 0.38, 0.79, -1.55, 0.006)
    }
    const baked = kit.bake()
    for (const [slot, geo] of baked) {
        own(geo)
        body.add(new THREE.Mesh(geo, slotMaterial(slot, paint, plate)))
    }

    const wheelSet = wheelGeos(d.wheelR, d.wheelW)
    const wheels: THREE.Object3D[] = []
    const track = edgeX(d, d.arches[0]!, d.archY) - d.wheelW / 2 + 0.02
    for (const u of d.arches) {
        for (const side of [-1, 1]) {
            const w = new THREE.Group()
            const spin = new THREE.Group()
            spin.add(new THREE.Mesh(wheelSet.tire, s.slots.rubber), new THREE.Mesh(wheelSet.rim, s.slots.rim), new THREE.Mesh(wheelSet.disc, s.slots.disc))
            // The left wheel is turned round, so it spins the other way about its local axis.
            spin.userData.dir = side
            // The caliper stays put while the wheel turns.
            w.add(spin, new THREE.Mesh(wheelSet.caliper, s.slots.caliper))
            w.position.set(side * track, d.wheelR, -u)
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

    const flameGeo = own(new THREE.ConeGeometry(0.09, 1.1, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.55))
    const flameMat = own(new THREE.MeshBasicMaterial({ color: 0x7ab8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))
    const flames: THREE.Mesh[] = []
    for (const x of [-0.68, -0.5, 0.5, 0.68]) {
        const f = new THREE.Mesh(flameGeo, flameMat)
        f.position.set(x, 0.23, vz + 0.06)
        f.scale.setScalar(0.001)
        body.add(f)
        flames.push(f)
    }

    return {
        group,
        body,
        paint,
        wheels,
        flames,
        flameMat,
        tailPoints: [new THREE.Vector3(-0.65, d.tail[1], rearZ(d, d.tail[1]) + 0.05), new THREE.Vector3(0.65, d.tail[1], rearZ(d, d.tail[1]) + 0.05)],
        dispose: () => owned.forEach(o => o.dispose())
    }
}
