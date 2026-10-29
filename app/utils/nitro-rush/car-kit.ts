import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { shadowTexture } from './textures'

/** What cars are built from: shared material slots, smoothed body geometry, the part kit and wheels. */


export type Slot = 'paint' | 'glass' | 'trim' | 'chrome' | 'rubber' | 'rim' | 'tail' | 'head' | 'amber' | 'plate' | 'interior' | 'disc' | 'caliper' | 'cabin' | 'lens'
export type Pt = [number, number]

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
export function splinePoints(pts: Pt[], segs = 40) {
    return new THREE.SplineCurve(pts.map(([u, v]) => new THREE.Vector2(u, v))).getPoints(segs)
}

/**
 * A body side profile in (forward, up): the top as a spline from the front
 * bumper over the roof to the rear bumper, then the sill with wheel arches.
 */
export function bodyShape(top: Pt[], arches: { c: number, r: number }[], archY: number, sill: number) {
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
export function capShape(top: Pt[]) {
    const s = new THREE.Shape()
    const pts = splinePoints(top, 36)
    s.moveTo(pts[0]!.x, pts[0]!.y)
    for (const p of pts.slice(1)) s.lineTo(p.x, p.y)
    s.closePath()
    return s
}

/** Extrude a profile across the car (x) and turn it so forward is -z. */
export function extrudeAcross(shape: THREE.Shape, width: number, bevel: number, segs = 4) {
    const depth = Math.max(0.01, width - bevel * 2)
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: segs, curveSegments: 12 })
    g.translate(0, 0, -depth / 2)
    g.rotateY(Math.PI / 2)
    return smooth(g)
}

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpE = new THREE.Euler()

export class Kit {
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
export function wheelGeos(r: number, w: number, sporty = true) {
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
