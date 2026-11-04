import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { DECALS, decalAtlas, mapToDecal, meshTexture } from './car-livery'
import { shadowTexture } from './textures'

/** What cars are built from: shared material slots, the part kit and wheels. */

/** `skin` is the livery-mapped body and `paint` the plain body-coloured parts; both wear the car's own paint. */
export type Slot = 'skin' | 'paint' | 'glass' | 'trim' | 'chrome' | 'rubber' | 'rim' | 'tail' | 'head' | 'plate' | 'disc' | 'caliper' | 'lens' | 'mesh' | 'decal' | 'white'
export type Pt = [number, number]

let shared: ReturnType<typeof createShared> | null = null

function createShared() {
    const shadowMap = shadowTexture()
    const meshMap = meshTexture()
    const decalMap = decalAtlas()
    return {
        shadowMap,
        shadowGeo: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        shadow: new THREE.MeshBasicMaterial({ map: shadowMap, color: 0x000000, transparent: true, opacity: 0.85, depthWrite: false }),
        slots: {
            // Blacked-out glass lying on the skin, so it stays opaque and only ever shows reflections.
            glass: new THREE.MeshPhysicalMaterial({ color: 0x030405, roughness: 0.06, metalness: 0.1, envMapIntensity: 1.2, clearcoat: 1 }),
            trim: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.55, metalness: 0.2 }),
            chrome: new THREE.MeshStandardMaterial({ color: 0xd8dbe2, roughness: 0.1, metalness: 1 }),
            rubber: new THREE.MeshStandardMaterial({ color: 0x101011, roughness: 0.9, side: THREE.DoubleSide }),
            rim: new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.26, metalness: 0.9, side: THREE.DoubleSide }),
            tail: new THREE.MeshStandardMaterial({ color: 0x400005, emissive: 0xff1418, emissiveIntensity: 3.2, roughness: 0.2 }),
            head: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, emissive: 0xfff4dc, emissiveIntensity: 2.4, roughness: 0.1 }),
            disc: new THREE.MeshStandardMaterial({ color: 0x55555a, roughness: 0.35, metalness: 0.9 }),
            caliper: new THREE.MeshStandardMaterial({ color: 0xe8430f, roughness: 0.35, metalness: 0.2, emissive: 0x3a1000 }),
            // Red lens glass over the tail lamps: dark when off, it lets the lamp glow through.
            lens: new THREE.MeshPhysicalMaterial({ color: 0x5a0008, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55, clearcoat: 1 }),
            // Dull, so the vents stay dark holes instead of mirroring the sky.
            mesh: new THREE.MeshStandardMaterial({ map: meshMap, roughness: 0.85, metalness: 0.1, envMapIntensity: 0.35 }),
            decal: new THREE.MeshStandardMaterial({ map: decalMap, transparent: true, depthWrite: false, roughness: 0.5 }),
            white: new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.35 })
        } as Record<Exclude<Slot, 'skin' | 'paint' | 'plate'>, THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial>,
        wheels: new Map<string, ReturnType<typeof buildWheel>>()
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

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpE = new THREE.Euler()
const tmpFrom = new THREE.Vector3()
const tmpTo = new THREE.Vector3()
const Y_AXIS = new THREE.Vector3(0, 1, 0)

export class Kit {
    readonly parts = new Map<Slot, THREE.BufferGeometry[]>()

    add(slot: Slot, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
        const g = normalize(geo)
        tmpM.compose(new THREE.Vector3(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz))
        g.applyMatrix4(tmpM)
        // Plain paint must miss the livery, whose canvas stays clear at uv 0.
        if (slot === 'paint') g.attributes.uv!.array.fill(0)
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

    /** A strut from one point to another, `w` wide across x and `t` thick. */
    beam(slot: Slot, from: readonly [number, number, number], to: readonly [number, number, number], w: number, t: number) {
        tmpFrom.set(...from)
        tmpTo.set(...to)
        const dir = tmpTo.clone().sub(tmpFrom)
        const len = dir.length()
        const geo = new RoundedBoxGeometry(w, len, t, 2, Math.min(0.012, w / 2, t / 2))
        geo.applyQuaternion(tmpQ.setFromUnitVectors(Y_AXIS, dir.normalize()))
        const mid = tmpFrom.add(tmpTo).multiplyScalar(0.5)
        this.add(slot, geo, mid.x, mid.y, mid.z)
        geo.dispose()
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

function buildWheel(r: number, w: number) {
    const hw = w / 2
    const rim = 0.74
    const tireProfile = [
        new THREE.Vector2(r * rim, -hw + 0.01), new THREE.Vector2(r * 0.86, -hw), new THREE.Vector2(r * 0.97, -hw + w * 0.1),
        new THREE.Vector2(r, -hw + w * 0.28), new THREE.Vector2(r, hw - w * 0.28), new THREE.Vector2(r * 0.97, hw - w * 0.1),
        new THREE.Vector2(r * 0.86, hw), new THREE.Vector2(r * rim, hw - 0.01)
    ]
    const tire = new THREE.LatheGeometry(tireProfile, 40)
    tire.rotateZ(-Math.PI / 2)
    const rimParts: THREE.BufferGeometry[] = []
    const R = r * rim
    // Barrel and lip, then a dished face the spokes sit in.
    const barrel = new THREE.LatheGeometry([
        new THREE.Vector2(R * 0.96, -hw + 0.03), new THREE.Vector2(R, -hw + 0.04), new THREE.Vector2(R, hw - 0.02),
        new THREE.Vector2(R * 1.02, hw - 0.005), new THREE.Vector2(R * 0.94, hw)
    ], 40)
    barrel.rotateZ(-Math.PI / 2)
    rimParts.push(normalize(barrel))
    barrel.dispose()
    const hub = new THREE.CylinderGeometry(R * 0.17, R * 0.22, 0.06, 20).rotateZ(Math.PI / 2).translate(hw - 0.05, 0, 0)
    rimParts.push(normalize(hub))
    hub.dispose()
    // Five split spokes, each pair swept the same way so the wheel reads as turning.
    const pairs = 5
    for (let i = 0; i < pairs; i++) {
        const base = i / pairs * Math.PI * 2
        for (const lean of [-0.17, 0.17]) {
            const spoke = new RoundedBoxGeometry(0.028, R * 0.84, R * 0.075, 2, 0.01)
            spoke.translate(0, R * 0.42, 0)
            spoke.rotateX(lean)
            spoke.rotateZ(-0.07)
            spoke.translate(hw - 0.05, R * 0.1, lean * R * 0.28)
            spoke.rotateX(base + 0.2)
            rimParts.push(normalize(spoke))
            spoke.dispose()
        }
    }
    // A bright lip around the rim, so the wheel keeps its edge against the black tyre.
    const lipRaw = new THREE.LatheGeometry([
        new THREE.Vector2(R, hw - 0.03), new THREE.Vector2(R * 1.03, hw - 0.008), new THREE.Vector2(R * 0.97, hw + 0.002), new THREE.Vector2(R * 0.93, hw - 0.012)
    ], 40)
    lipRaw.rotateZ(-Math.PI / 2)
    const lip = normalize(lipRaw)
    lipRaw.dispose()
    const rimGeo = mergeGeometries(rimParts, false)!
    for (const p of rimParts) p.dispose()
    const discRaw = new THREE.CylinderGeometry(R * 0.84, R * 0.84, 0.04, 32).rotateZ(Math.PI / 2).translate(hw - 0.2, 0, 0)
    const disc = normalize(discRaw)
    discRaw.dispose()
    // Caliper hugs the disc's trailing top, where it shows through the spokes.
    const arc = new THREE.Shape()
    arc.absarc(0, 0, R * 0.88, 1.85, 3, false)
    arc.absarc(0, 0, R * 0.54, 3, 1.85, true)
    const calRaw = new THREE.ExtrudeGeometry(arc, { depth: 0.09, bevelEnabled: false, curveSegments: 8 }).rotateY(Math.PI / 2).translate(hw - 0.2, 0, 0)
    const caliper = normalize(calRaw)
    calRaw.dispose()
    // Sidewall lettering; a ring's uv is flat across it, so it maps straight onto the atlas's round decal.
    const ring = new THREE.RingGeometry(r * 0.76, r * 0.99, 48, 1)
    mapToDecal(ring, DECALS.tyre)
    ring.rotateY(Math.PI / 2)
    ring.translate(hw + 0.002, 0, 0)
    const letters = normalize(ring)
    ring.dispose()
    const out = { tire: normalize(tire), rim: rimGeo, lip, disc, caliper, letters }
    tire.dispose()
    return out
}

/** Low-profile tyre with white lettering, split-spoke alloy with a bright lip, brake disc and caliper; axis along x, outer face at +x. */
export function wheelGeos(r: number, w: number) {
    const key = `${r.toFixed(3)}:${w.toFixed(3)}`
    const s = modelShared()
    const cached = s.wheels.get(key)
    if (cached) return cached
    const set = buildWheel(r, w)
    s.wheels.set(key, set)
    return set
}
