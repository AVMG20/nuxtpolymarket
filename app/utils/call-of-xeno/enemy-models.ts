// Call of Xeno — enemy meshes.
//
// Infected people mid-mutation: gaunt limbs, hunched spines, chitin plates
// and bioluminescent veins. Everything is procedural. Every enemy type is
// modelled once into merged, vertex-coloured geometry (one geometry per
// body part per material slot, cached and shared by every spawn); each
// spawn only gets its own pivots, meshes and materials, so flash, fade and
// pulse stay per-instance while a horde of dozens costs a few draw calls
// each.

import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CallOfXenoEnemy } from '#shared/utils/gamelogic/call-of-xeno'

// ---------------------------------------------------------------------------
// Public model
// ---------------------------------------------------------------------------

/** What the enemy is doing right now, for the secondary-motion hook. */
export type EnemyAnimState = 'walk' | 'attack' | 'climb' | 'idle'

export interface EnemyModel {
    group: THREE.Group
    head?: THREE.Object3D
    armL?: THREE.Object3D
    armR?: THREE.Object3D
    legL?: THREE.Object3D
    legR?: THREE.Object3D
    /**
     * Drone marker. The component spins it every frame and treats "has a
     * rotor" as "flies". It is an empty, harmless object; the wings borrow
     * its spin as a flap clock until `animate` takes over.
     */
    rotor?: THREE.Object3D
    /** Brute back pustule: the glowing weak point. */
    weakPoint?: THREE.Mesh
    /** Flesh. Per-instance; its opacity/transparent drive the whole body (see linkFade). */
    skin: THREE.MeshStandardMaterial
    /** Workwear. Per-instance; opacity/transparent drive the whole body too. */
    clothes: THREE.MeshStandardMaterial
    /** Bioluminescence (eyes, veins). Unlit, colour is a brightness multiplier. */
    glow: THREE.MeshBasicMaterial
    baseSkin: number
    baseCloth: number
    /** Height of the centre of mass, used to place damage numbers. */
    torsoY: number

    // --- Remaster additions (all optional) ---
    kind: 'shambler' | 'husk' | 'drone' | 'brute'
    /** Per-instance number, use it to de-sync phases. */
    seed: number
    chitin: THREE.MeshStandardMaterial
    /** Translucent tissue: husk sac, drone wings. */
    membrane: THREE.MeshStandardMaterial
    /** Upper-body pivot (walkers). Head and arms are its children. */
    chest?: THREE.Object3D
    jaw?: THREE.Object3D
    tail?: THREE.Object3D
    wingL?: THREE.Object3D
    wingR?: THREE.Object3D
    /** Husk abdomen sac pivot, scaled by the pulse. */
    sac?: THREE.Object3D
    /**
     * Per-frame secondary motion: breathing, jaw, twitching, wing flap,
     * glow pulse. Never touches limb pivots' rotation.x (animateEnemy owns
     * those). Call as `model.animate?.(model, t, speed, state)`.
     */
    animate?: (model: EnemyModel, t: number, speed: number, state: EnemyAnimState) => void
    /** Internal bookkeeping. */
    flashing?: boolean
    animated?: boolean
    lean?: number
    lit?: THREE.MeshStandardMaterial[]
}

export type EnemyGibName = 'head' | 'armL' | 'armR' | 'legL' | 'legR' | 'tail' | 'wingL' | 'wingR'

export interface EnemyGib {
    name: EnemyGibName
    object: THREE.Object3D
}

// ---------------------------------------------------------------------------
// Deterministic noise, colours
// ---------------------------------------------------------------------------

type V3 = [number, number, number]
type Slot = 'skin' | 'cloth' | 'chitin' | 'glow' | 'membrane'
const SLOTS: Slot[] = ['skin', 'cloth', 'chitin', 'glow', 'membrane']

const TEAL = 0x3dffc8
const ACID = 0xb6ff2a
const BONE = 0xcfc7ac
const AMBER = 0xffb020
const BOOT = 0x1a1c20

function hash3(x: number, y: number, z: number) {
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
    return h - Math.floor(h)
}

function vnoise(x: number, y: number, z: number) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const zi = Math.floor(z)
    const fx = x - xi
    const fy = y - yi
    const fz = z - zi
    const ux = fx * fx * (3 - 2 * fx)
    const uy = fy * fy * (3 - 2 * fy)
    const uz = fz * fz * (3 - 2 * fz)
    const mix = (a: number, b: number, t: number) => a + (b - a) * t
    return mix(
        mix(mix(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), ux), mix(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), ux), uy),
        mix(mix(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), ux), mix(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), ux), uy),
        uz
    )
}

// ---------------------------------------------------------------------------
// Geometry kit: everything is collected per material slot and merged
// ---------------------------------------------------------------------------

interface GeoOpts {
    noise?: number
    freq?: number
    mottle?: number
    seed?: number
}

const AXIS_Y = new THREE.Vector3(0, 1, 0)
const scratchEuler = new THREE.Euler()
const scratchQuat = new THREE.Quaternion()
const scratchPos = new THREE.Vector3()
const scratchScale = new THREE.Vector3()
const scratchDir = new THREE.Vector3()
const scratchColor = new THREE.Color()

function compose(p: V3, r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]) {
    scratchEuler.set(r[0], r[1], r[2])
    scratchQuat.setFromEuler(scratchEuler)
    return new THREE.Matrix4().compose(scratchPos.set(p[0], p[1], p[2]), scratchQuat, scratchScale.set(s[0], s[1], s[2]))
}

function aligned(a: V3, b: V3) {
    scratchDir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const length = scratchDir.length()
    scratchDir.divideScalar(length || 1)
    scratchQuat.setFromUnitVectors(AXIS_Y, scratchDir)
    return { length, matrix: new THREE.Matrix4().compose(scratchPos.set(a[0], a[1], a[2]), scratchQuat, scratchScale.set(1, 1, 1)) }
}

function noDispose(geometry: THREE.BufferGeometry) {
    // Shared between every spawn: the component disposes a corpse's meshes,
    // which must not free geometry the rest of the horde still draws.
    geometry.dispose = () => {}
    return geometry
}

type PartGeo = Partial<Record<Slot, THREE.BufferGeometry>>

class Kit {
    private geos: Record<Slot, THREE.BufferGeometry[]> = { skin: [], cloth: [], chitin: [], glow: [], membrane: [] }

    /** Coordinates given to add() are body space; the origin is the pivot they end up relative to. */
    constructor(private origin: V3 = [0, 0, 0]) {}

    add(slot: Slot, source: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number, o: GeoOpts = {}) {
        source.deleteAttribute('uv')
        source.deleteAttribute('normal')
        const geo = mergeVertices(source, 1e-4)
        source.dispose()
        geo.computeVertexNormals()
        const pos = geo.getAttribute('position') as THREE.BufferAttribute
        const nor = geo.getAttribute('normal') as THREE.BufferAttribute
        const seed = o.seed ?? 0

        if (o.noise) {
            const f = o.freq ?? 2.4
            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i)
                const y = pos.getY(i)
                const z = pos.getZ(i)
                const n = (vnoise(x * f + seed, y * f - seed, z * f + seed * 0.5) - 0.5) * 2 * o.noise
                pos.setXYZ(i, x + nor.getX(i) * n, y + nor.getY(i) * n, z + nor.getZ(i) * n)
            }
        }

        const placed = new THREE.Matrix4().makeTranslation(-this.origin[0], -this.origin[1], -this.origin[2]).multiply(matrix)
        geo.applyMatrix4(placed)
        geo.computeVertexNormals()

        const base = scratchColor.set(color)
        const mottle = o.mottle ?? (slot === 'skin' ? 0.3 : slot === 'cloth' ? 0.2 : slot === 'chitin' ? 0.14 : 0)
        const colors = new Float32Array(pos.count * 3)
        for (let i = 0; i < pos.count; i++) {
            const shade = mottle
                ? 1 + (vnoise(pos.getX(i) * 7 + seed, pos.getY(i) * 7, pos.getZ(i) * 7 - seed) - 0.5) * 2 * mottle
                : 1
            colors[i * 3] = base.r * shade
            colors[i * 3 + 1] = base.g * shade
            colors[i * 3 + 2] = base.b * shade
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        this.geos[slot].push(geo)
    }

    bake(): PartGeo {
        const out: PartGeo = {}
        for (const slot of SLOTS) {
            const list = this.geos[slot]
            if (list.length === 0) continue
            const merged = mergeGeometries(list, false)
            for (const g of list) g.dispose()
            if (merged) out[slot] = noDispose(merged)
        }
        return out
    }
}

function blob(k: Kit, slot: Slot, p: V3, r: V3, color: number, o: GeoOpts & { rot?: V3, seg?: [number, number] } = {}) {
    const seg = o.seg ?? [8, 6]
    k.add(slot, new THREE.SphereGeometry(1, seg[0], seg[1]), compose(p, o.rot, r), color, { noise: 0.07, freq: 2.4, ...o })
}

function spindle(k: Kit, slot: Slot, a: V3, b: V3, r0: number, r1: number, color: number, o: GeoOpts & { bulge?: number, seg?: number, steps?: number } = {}) {
    const { length, matrix } = aligned(a, b)
    const steps = o.steps ?? 4
    const bulge = o.bulge ?? 0.12
    const profile = [new THREE.Vector2(0.0001, 0)]
    for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const r = (r0 + (r1 - r0) * t) * (1 + bulge * Math.sin(Math.PI * t))
        profile.push(new THREE.Vector2(Math.max(r, 0.002), length * t))
    }
    profile.push(new THREE.Vector2(0.0001, length))
    k.add(slot, new THREE.LatheGeometry(profile, o.seg ?? 7), matrix, color, { noise: (r0 + r1) * 0.06, freq: 16, ...o })
}

function spike(k: Kit, slot: Slot, base: V3, tip: V3, r: number, color: number, o: GeoOpts & { seg?: number } = {}) {
    const { length, matrix } = aligned(base, tip)
    const geo = new THREE.ConeGeometry(r, length, o.seg ?? 5, 1)
    geo.translate(0, length / 2, 0)
    k.add(slot, geo, matrix, color, { mottle: 0.1, ...o })
}

function tube(k: Kit, slot: Slot, pts: V3[], r: number, color: number, o: GeoOpts & { segs?: number } = {}) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])))
    k.add(slot, new THREE.TubeGeometry(curve, o.segs ?? (pts.length - 1) * 3, r, 3, false), new THREE.Matrix4(), color, { mottle: 0, ...o })
}

/** A rib: an elliptical arc wrapped round the front of the chest, drooping toward the sternum. */
function rib(k: Kit, y: number, rx: number, rz: number, drop: number, r: number, color: number) {
    const pts: V3[] = []
    for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.06 + 0.88 * (i / 4))
        pts.push([Math.cos(a) * rx, y - drop * Math.sin(a), Math.sin(a) * rz])
    }
    tube(k, 'skin', pts, r, color, { mottle: 0.1, segs: 8 })
}

/** A line of points down a meridian of an ellipsoid, for veins wrapping a sac. */
function meridian(c: V3, r: V3, psi: number, out = 1.03): V3[] {
    const pts: V3[] = []
    for (let i = 0; i < 6; i++) {
        const phi = 0.45 + (Math.PI - 0.9) * (i / 5)
        pts.push([c[0] + r[0] * out * Math.sin(phi) * Math.sin(psi), c[1] + r[1] * out * Math.cos(phi), c[2] + r[2] * out * Math.sin(phi) * Math.cos(psi)])
    }
    return pts
}

function rel(a: V3, b: V3): V3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

// ---------------------------------------------------------------------------
// Materials and instancing
// ---------------------------------------------------------------------------

interface Mats {
    skin: THREE.MeshStandardMaterial
    cloth: THREE.MeshStandardMaterial
    chitin: THREE.MeshStandardMaterial
    glow: THREE.MeshBasicMaterial
    membrane: THREE.MeshStandardMaterial
}

interface MatStyle {
    skinEmissive: number
    clothEmissive: number
    chitinEmissive: number
    membraneEmissive: number
    membraneOpacity: number
}

const STYLES: Record<EnemyModel['kind'], MatStyle> = {
    shambler: { skinEmissive: 0x0f3326, clothEmissive: 0x2a1408, chitinEmissive: 0x08241c, membraneEmissive: 0x0a4038, membraneOpacity: 0.5 },
    husk: { skinEmissive: 0x1c2c06, clothEmissive: 0x14160c, chitinEmissive: 0x142206, membraneEmissive: 0x66ff22, membraneOpacity: 0.62 },
    drone: { skinEmissive: 0x0c2c34, clothEmissive: 0x0c1a1c, chitinEmissive: 0x0a2e38, membraneEmissive: 0x0c5866, membraneOpacity: 0.34 },
    brute: { skinEmissive: 0x2c1028, clothEmissive: 0x1a1006, chitinEmissive: 0x1a1024, membraneEmissive: 0x0a4038, membraneOpacity: 0.5 }
}

function withBase<T extends THREE.MeshStandardMaterial>(m: T, emissive: number, intensity: number): T {
    m.emissive.setHex(emissive)
    m.emissiveIntensity = intensity
    m.userData.baseEmissive = emissive
    m.userData.baseIntensity = intensity
    return m
}

function makeMats(kind: EnemyModel['kind']): Mats {
    const s = STYLES[kind]
    const membrane = withBase(new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.25,
        metalness: 0,
        transparent: true,
        opacity: s.membraneOpacity,
        side: THREE.DoubleSide,
        depthWrite: false
    }), s.membraneEmissive, kind === 'husk' ? 0.9 : 0.8)
    membrane.userData.baseOpacity = s.membraneOpacity
    return {
        skin: withBase(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 }), s.skinEmissive, 0.7),
        cloth: withBase(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 }), s.clothEmissive, 0.6),
        chitin: withBase(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.4 }), s.chitinEmissive, 0.8),
        glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
        membrane
    }
}

function mount(part: PartGeo | undefined, mats: Mats, pos: V3): THREE.Group {
    const group = new THREE.Group()
    group.position.set(pos[0], pos[1], pos[2])
    if (!part) return group
    for (const slot of SLOTS) {
        const geo = part[slot]
        if (geo) group.add(new THREE.Mesh(geo, mats[slot]))
    }
    return group
}

const shadowGeometry = noDispose(new THREE.CircleGeometry(1, 12))

function shadowDisc(radius: number) {
    const material = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false })
    material.userData.baseOpacity = 0.34
    const shadow = new THREE.Mesh(shadowGeometry, material)
    shadow.scale.setScalar(radius)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.02
    return shadow
}

/**
 * The component fades a corpse with `skin.opacity` / `clothes.opacity` and
 * `.transparent`. Route those two materials' properties to every material of
 * the body so the whole corpse dissolves, not only the flesh.
 */
function linkFade(model: EnemyModel, others: THREE.Material[]) {
    let opacity = 1
    let transparent = false
    for (const mat of [model.skin, model.clothes]) {
        Object.defineProperty(mat, 'opacity', {
            configurable: true,
            get: () => opacity,
            set: (v: number) => {
                opacity = v
                for (const o of others) o.opacity = v * ((o.userData.baseOpacity as number | undefined) ?? 1)
            }
        })
        Object.defineProperty(mat, 'transparent', {
            configurable: true,
            get: () => transparent,
            set: (v: boolean) => {
                transparent = v
                for (const o of others) {
                    if (o.userData.baseOpacity === undefined) o.transparent = v
                }
            }
        })
    }
}

const blueprints = new Map<string, Record<string, PartGeo>>()

function cached(key: string, make: () => Record<string, Kit>): Record<string, PartGeo> {
    let bp = blueprints.get(key)
    if (!bp) {
        bp = {}
        for (const [name, kit] of Object.entries(make())) bp[name] = kit.bake()
        blueprints.set(key, bp)
    }
    return bp
}

let spawnCounter = 0

// ---------------------------------------------------------------------------
// Shambler: infected warehouse worker
// ---------------------------------------------------------------------------

const SH = {
    chest: [0, 0.98, 0] as V3,
    head: [0, 1.6, 0] as V3,
    jaw: [0, 1.68, 0.05] as V3,
    shoulder: 0.27,
    shoulderY: 1.56,
    hip: 0.13,
    hipY: 0.9,
    lean: 0.2
}

const SH_PANTS = [0x3b3f45, 0x2a4a80, 0x565040]
const SH_TOP = [0xf06a10, 0x6a3a2a, 0xd49a14]

function shamblerParts(v: number, flesh: number): Record<string, Kit> {
    const pants = SH_PANTS[v]!
    const top = SH_TOP[v]!
    const chitin = 0x1d2a26
    const pelvis = new Kit()
    blob(pelvis, 'skin', [0, 0.93, -0.02], [0.17, 0.13, 0.13], flesh)
    blob(pelvis, 'cloth', [0, 0.93, -0.02], [0.195, 0.145, 0.15], pants, { seed: v })

    // Chest: exposed ribs, spine ridges, scapular plates, glowing veins.
    const chest = new Kit(SH.chest)
    spindle(chest, 'skin', [0, 0.86, 0], [0, 1.3, 0.02], 0.12, 0.15, flesh, { bulge: 0.05, seg: 8 })
    blob(chest, 'skin', [0, 1.45, 0], [0.2, 0.25, 0.135], flesh, { seg: [10, 7] })
    const ribShrink = [0.98, 1, 0.95, 0.85]
    for (let i = 0; i < 4; i++) {
        const f = ribShrink[i]!
        rib(chest, 1.38 + i * 0.07, 0.2 * f, 0.138 * f, 0.03, 0.011, BONE)
    }
    spindle(chest, 'skin', [0, 1.62, 0.128], [0, 1.34, 0.14], 0.014, 0.014, BONE, { seg: 4, steps: 2, bulge: 0 })
    for (let i = 0; i < 6; i++) {
        const y = 1.0 + i * 0.1
        spike(chest, 'chitin', [0, y, -0.115], [0, y + 0.035, -0.2 - i * 0.008], 0.022 + i * 0.002, chitin)
    }
    for (const sx of [-1, 1]) {
        blob(chest, 'skin', [0.25 * sx, 1.55, 0], [0.075, 0.075, 0.075], flesh, { seg: [6, 5] })
        blob(chest, 'chitin', [0.27 * sx, 1.61, -0.03], [0.11, 0.04, 0.12], chitin, { rot: [0, 0, -0.35 * sx], seg: [7, 5] })
        spike(chest, 'chitin', [0.3 * sx, 1.62, -0.03], [0.36 * sx, 1.74, -0.1], 0.03, chitin)
    }
    spindle(chest, 'skin', [0, 1.5, 0], [0, 1.64, 0], 0.055, 0.045, flesh, { seg: 6, steps: 2 })
    tube(chest, 'glow', [[0.03, 1.18, 0.138], [0.055, 1.32, 0.146], [0.03, 1.46, 0.145], [0.06, 1.58, 0.095]], 0.007, TEAL)
    tube(chest, 'glow', [[-0.06, 1.24, 0.135], [-0.1, 1.38, 0.125], [-0.135, 1.52, 0.09]], 0.006, TEAL)
    tube(chest, 'glow', [[0.02, 1.68, 0.02], [0.06, 1.64, 0.02], [0.1, 1.6, -0.01]], 0.006, TEAL)

    // Warehouse workwear per variant: hi-vis vest, overalls, tied-off coverall.
    if (v === 0) {
        blob(chest, 'cloth', [-0.115, 1.42, 0.06], [0.09, 0.21, 0.085], top, { seed: 3 })
        blob(chest, 'cloth', [0.13, 1.36, 0.055], [0.07, 0.15, 0.08], top, { rot: [0, 0, 0.1], seed: 5 })
        blob(chest, 'cloth', [0, 1.42, -0.05], [0.2, 0.2, 0.1], top, { seed: 7 })
        for (const y of [1.34, 1.5]) {
            blob(chest, 'cloth', [-0.115, y, 0.062], [0.093, 0.016, 0.088], 0xdfe4e6, { noise: 0.02, seg: [7, 4] })
            blob(chest, 'cloth', [0, y, -0.05], [0.203, 0.016, 0.103], 0xdfe4e6, { noise: 0.02, seg: [9, 4] })
        }
    } else if (v === 1) {
        blob(chest, 'cloth', [0, 1.24, 0.075], [0.13, 0.14, 0.075], pants, { seed: 2 })
        blob(chest, 'cloth', [0, 1.0, 0], [0.17, 0.14, 0.14], pants, { seed: 4 })
        for (const sx of [-1, 1]) {
            spindle(chest, 'cloth', [0.09 * sx, 1.36, 0.1], [0.13 * sx, 1.62, 0.02], 0.02, 0.018, pants, { seg: 5, steps: 3 })
            spindle(chest, 'cloth', [0.09 * sx, 1.3, -0.11], [0.13 * sx, 1.58, -0.05], 0.02, 0.018, pants, { seg: 5, steps: 3 })
        }
        blob(chest, 'cloth', [-0.06, 1.3, 0.148], [0.035, 0.03, 0.012], 0x9a8f6a, { seg: [6, 4] })
    } else {
        blob(chest, 'cloth', [0, 1.0, 0], [0.19, 0.09, 0.15], top, { seed: 6 })
        for (const sx of [-1, 1]) {
            spindle(chest, 'cloth', [0.15 * sx, 1.0, 0.02], [0.2 * sx, 0.76, 0.1], 0.05, 0.035, top, { seg: 6, steps: 3, seed: sx })
        }
        blob(chest, 'cloth', [0, 0.95, -0.14], [0.13, 0.12, 0.03], top, { seed: 8 })
    }

    // Head: sunken face, glowing eyes, chitin crest, cracked-open dome.
    const head = new Kit(SH.head)
    blob(head, 'skin', [0, 1.74, 0.03], [0.135, 0.15, 0.17], flesh, { seg: [10, 7] })
    blob(head, 'chitin', [0, 1.79, -0.09], [0.09, 0.09, 0.17], chitin, { seg: [8, 6] })
    blob(head, 'skin', [0, 1.68, 0.11], [0.09, 0.05, 0.07], flesh, { seg: [7, 5] })
    for (const sx of [-1, 1]) {
        blob(head, 'skin', [0.055 * sx, 1.75, 0.115], [0.04, 0.035, 0.03], 0x080c0b, { mottle: 0, seg: [6, 5] })
        blob(head, 'glow', [0.055 * sx, 1.75, 0.128], [0.022, 0.02, 0.014], TEAL, { noise: 0, seg: [6, 4] })
    }
    for (let i = 0; i < 6; i++) {
        const x = (i - 2.5) * 0.024
        spike(head, 'skin', [x, 1.665, 0.135 - Math.abs(x) * 0.6], [x, 1.625 - (i % 2) * 0.012, 0.14 - Math.abs(x) * 0.6], 0.008, BONE, { seg: 4 })
    }
    spike(head, 'chitin', [0, 1.82, -0.05], [0, 1.9, -0.2], 0.022, chitin)
    for (const sx of [-1, 1]) spike(head, 'chitin', [0.05 * sx, 1.8, -0.06], [0.09 * sx, 1.85, -0.2], 0.018, chitin)
    tube(head, 'glow', [[0.02, 1.87, 0.1], [0.032, 1.81, 0.16], [0.012, 1.765, 0.172]], 0.006, TEAL)
    if (v === 1) {
        blob(head, 'cloth', [0, 1.83, 0.0], [0.155, 0.1, 0.185], 0xf0c020, { noise: 0.03, seed: 9 })
        blob(head, 'cloth', [0, 1.79, 0.1], [0.135, 0.012, 0.135], 0xf0c020, { noise: 0.02, seg: [9, 4] })
        spike(head, 'chitin', [0.03, 1.92, 0], [0.06, 2.04, -0.06], 0.03, chitin)
    }
    const jaw = new Kit(SH.jaw)
    blob(jaw, 'skin', [0, 1.65, 0.1], [0.075, 0.03, 0.085], flesh, { seg: [7, 5] })
    for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 0.026
        spike(jaw, 'skin', [x, 1.66, 0.14 - Math.abs(x) * 0.5], [x, 1.7 + (i % 2) * 0.012, 0.14 - Math.abs(x) * 0.5], 0.007, BONE, { seg: 4 })
    }
    blob(jaw, 'glow', [0, 1.64, 0.08], [0.036, 0.008, 0.05], TEAL, { noise: 0, seg: [6, 4] })

    return {
        pelvis,
        chest,
        head,
        jaw,
        armL: shamblerArm(-1, v, flesh, chitin),
        armR: shamblerArm(1, v, flesh, chitin),
        legL: shamblerLeg(-1, v, flesh, pants),
        legR: shamblerLeg(1, v, flesh, pants)
    }
}

function shamblerArm(sx: number, v: number, flesh: number, chitin: number) {
    const k = new Kit()
    blob(k, 'skin', [0, 0, 0], [0.065, 0.065, 0.065], flesh, { seg: [6, 5] })
    spindle(k, 'skin', [0, 0, 0], [0.02 * sx, -0.36, 0.02], 0.055, 0.042, flesh, { bulge: 0.1 })
    blob(k, 'skin', [0.02 * sx, -0.37, 0.02], [0.05, 0.05, 0.05], flesh, { seg: [6, 5] })
    spike(k, 'chitin', [0.03 * sx, -0.37, -0.03], [0.06 * sx, -0.4, -0.14], 0.025, chitin)
    spindle(k, 'skin', [0.02 * sx, -0.37, 0.02], [0, -0.78, 0.12], 0.042, 0.03, flesh, { bulge: 0.06 })
    blob(k, 'skin', [0, -0.79, 0.13], [0.045, 0.06, 0.035], flesh, { seg: [6, 5] })
    const claw = sx > 0 ? 0.017 : 0.012
    for (const x of [-0.03, 0, 0.03]) {
        spike(k, 'skin', [x * 0.7, -0.83, 0.13], [x * 1.3, sx > 0 ? -1.06 : -1.0, 0.21], claw, BONE, { seg: 4 })
    }
    spike(k, 'skin', [0.04 * sx, -0.8, 0.12], [0.08 * sx, -0.95, 0.17], 0.012, BONE, { seg: 4 })
    tube(k, 'glow', [[0.01 * sx, -0.06, 0.056], [0.02 * sx, -0.2, 0.066], [0.025 * sx, -0.34, 0.062]], 0.005, TEAL)
    tube(k, 'glow', [[0.014 * sx, -0.49, 0.092], [0.004 * sx, -0.7, 0.138]], 0.005, TEAL)
    if (sx > 0) {
        // The right arm is further along: a chitin bracer over the forearm.
        blob(k, 'chitin', [0.008, -0.6, 0.09], [0.06, 0.13, 0.06], chitin, { rot: [-0.25, 0, 0], seg: [7, 5] })
    } else if (v === 1) {
        spindle(k, 'cloth', [0, 0.01, 0], [0.02, -0.26, 0.02], 0.068, 0.06, 0x6a3a2a, { seg: 6, steps: 3, seed: 3 })
    }
    return k
}

function shamblerLeg(sx: number, v: number, flesh: number, pants: number) {
    const k = new Kit()
    spindle(k, 'cloth', [0, 0, 0], [0, -0.46, 0.09], 0.085, 0.055, pants, { bulge: 0.06, seed: sx + v })
    blob(k, 'cloth', [0, -0.47, 0.1], [0.06, 0.06, 0.06], pants, { seg: [6, 5] })
    spindle(k, 'cloth', [0, -0.47, 0.1], [0, -0.68, 0.04], 0.056, 0.05, pants, { seg: 6, steps: 3, seed: 2 })
    spindle(k, 'skin', [0, -0.64, 0.05], [0, -0.88, -0.01], 0.045, 0.036, flesh, { seg: 6, steps: 3 })
    blob(k, 'cloth', [0, -0.87, 0.07], [0.055, 0.045, 0.12], BOOT, { seg: [7, 5], mottle: 0.1 })
    for (const x of [-0.02, 0.02]) spike(k, 'skin', [x, -0.88, 0.16], [x * 1.4, -0.9, 0.29], 0.016, BONE, { seg: 4 })
    if (sx > 0) blob(k, 'chitin', [0, -0.48, 0.15], [0.05, 0.06, 0.03], 0x1d2a26, { seg: [6, 5] })
    tube(k, 'glow', [[0.052 * sx, -0.06, 0.02], [0.062 * sx, -0.24, 0.05], [0.05 * sx, -0.4, 0.08]], 0.005, TEAL)
    return k
}

function buildShambler(def: CallOfXenoEnemy, seed: number): EnemyModel {
    const v = seed % 3
    const bp = cached(`shambler:${v}`, () => shamblerParts(v, def.color))
    const mats = makeMats('shambler')
    const group = new THREE.Group()
    group.add(mount(bp.pelvis, mats, [0, 0, 0]))
    const chest = mount(bp.chest, mats, SH.chest)
    chest.rotation.x = SH.lean
    group.add(chest)
    const head = mount(bp.head, mats, rel(SH.head, SH.chest))
    head.rotation.x = 0.12
    chest.add(head)
    const jaw = mount(bp.jaw, mats, rel(SH.jaw, SH.head))
    head.add(jaw)
    const armL = mount(bp.armL, mats, [-SH.shoulder, SH.shoulderY - SH.chest[1], 0])
    const armR = mount(bp.armR, mats, [SH.shoulder, SH.shoulderY - SH.chest[1], 0])
    chest.add(armL, armR)
    const legL = mount(bp.legL, mats, [-SH.hip, SH.hipY, 0])
    const legR = mount(bp.legR, mats, [SH.hip, SH.hipY, 0])
    group.add(legL, legR)
    group.add(shadowDisc(0.42))

    const model = assemble('shambler', def, group, mats, seed, 1.2, { head, jaw, armL, armR, legL, legR, chest })
    model.baseCloth = SH_PANTS[v]!
    model.lean = SH.lean
    model.animate = animateWalker
    return model
}

// ---------------------------------------------------------------------------
// Husk: bloated sac spitter
// ---------------------------------------------------------------------------

const HK = {
    chest: [0, 0.98, -0.03] as V3,
    head: [0, 1.68, -0.08] as V3,
    jaw: [0, 1.68, -0.1] as V3,
    sac: [0, 1.02, 0.14] as V3,
    shoulder: 0.2,
    shoulderY: 1.55,
    hip: 0.12,
    hipY: 0.9,
    lean: 0.26
}

function huskParts(flesh: number): Record<string, Kit> {
    const chitin = 0x3a2a20
    const cloth = 0x3a3f46
    const pelvis = new Kit()
    blob(pelvis, 'skin', [0, 0.93, -0.03], [0.12, 0.1, 0.1], flesh)
    blob(pelvis, 'cloth', [0, 0.96, -0.02], [0.14, 0.07, 0.115], cloth, { seed: 1 })
    for (const [x, y, z, rz] of [[-0.1, 0.83, 0.04, 0.15], [0.1, 0.8, 0.03, -0.15], [0, 0.82, -0.12, 0]] as [number, number, number, number][]) {
        blob(pelvis, 'cloth', [x, y, z], [0.05, 0.11, 0.015], cloth, { rot: [0, 0, rz], seg: [5, 5], seed: x * 30 })
    }

    const chest = new Kit(HK.chest)
    spindle(chest, 'skin', [0, 0.88, -0.03], [0, 1.28, 0], 0.075, 0.1, flesh, { seg: 6 })
    blob(chest, 'skin', [0, 1.42, -0.02], [0.165, 0.22, 0.11], flesh, { seg: [9, 7] })
    for (let i = 0; i < 5; i++) {
        const f = 1 - Math.abs(i - 2) * 0.08
        rib(chest, 1.28 + i * 0.07, 0.17 * f, 0.113 * f, 0.03, 0.01, 0xb8a890)
    }
    blob(chest, 'skin', [0, 1.62, -0.09], [0.14, 0.13, 0.12], flesh, { seg: [8, 6] })
    blob(chest, 'chitin', [0, 1.66, -0.13], [0.13, 0.07, 0.11], chitin, { rot: [0.3, 0, 0], seg: [7, 5] })
    for (let i = 0; i < 7; i++) {
        const y = 1.05 + i * 0.1
        const z = i < 4 ? -0.12 : -0.13 - (i - 3) * 0.02
        spike(chest, 'chitin', [0, y, z], [0, y + 0.05, z - 0.12], 0.02 + (i > 3 ? 0.006 : 0), chitin)
        if (i > 3) spike(chest, 'glow', [0, y + 0.04, z - 0.09], [0, y + 0.06, z - 0.15], 0.01, ACID, { seg: 4 })
    }
    for (const sx of [-1, 1]) {
        blob(chest, 'skin', [HK.shoulder * sx, HK.shoulderY - HK.chest[1] + HK.chest[1], 0], [0.06, 0.06, 0.06], flesh, { seg: [6, 5] })
        blob(chest, 'chitin', [(HK.shoulder + 0.01) * sx, 1.6, -0.03], [0.08, 0.03, 0.09], chitin, { rot: [0, 0, -0.35 * sx], seg: [6, 5] })
    }
    spindle(chest, 'skin', [0, 1.6, -0.06], [0, 1.72, -0.06], 0.05, 0.04, flesh, { seg: 6, steps: 2 })
    blob(chest, 'skin', [0, 1.24, 0.06], [0.09, 0.06, 0.08], flesh, { seg: [6, 5] })
    tube(chest, 'glow', [[0.02, 1.2, 0.1], [0.05, 1.34, 0.1], [0.03, 1.5, 0.08]], 0.006, ACID)

    // Abdomen sac: translucent bladder over a glowing core, wrapped in veins.
    const sacKit = new Kit(HK.sac)
    const sacR: V3 = [0.24, 0.28, 0.22]
    blob(sacKit, 'membrane', HK.sac, sacR, 0xd6f0b0, { noise: 0.05, seg: [12, 9], mottle: 0.12 })
    blob(sacKit, 'glow', HK.sac, [0.11, 0.14, 0.11], ACID, { noise: 0.1, seg: [8, 6] })
    for (const psi of [0.3, 1.9, -1.3, 3.5]) tube(sacKit, 'glow', meridian(HK.sac, sacR, psi, 1.02), 0.005, ACID)

    const head = new Kit(HK.head)
    blob(head, 'skin', [0, 1.75, -0.02], [0.085, 0.09, 0.13], flesh, { seg: [9, 7] })
    blob(head, 'skin', [0, 1.72, 0.12], [0.06, 0.05, 0.1], flesh, { seg: [7, 5] })
    blob(head, 'chitin', [0, 1.79, 0.05], [0.09, 0.03, 0.08], chitin, { rot: [0.2, 0, 0], seg: [6, 5] })
    for (const sx of [-1, 1]) {
        blob(head, 'glow', [0.055 * sx, 1.77, 0.07], [0.02, 0.016, 0.014], ACID, { noise: 0, seg: [5, 4] })
        blob(head, 'glow', [0.04 * sx, 1.8, 0.03], [0.014, 0.012, 0.01], ACID, { noise: 0, seg: [5, 4] })
    }
    spike(head, 'chitin', [0, 1.83, -0.08], [0, 1.93, -0.2], 0.02, chitin)
    for (const sx of [-1, 1]) spike(head, 'chitin', [0.04 * sx, 1.82, -0.07], [0.07 * sx, 1.9, -0.19], 0.016, chitin)
    for (const x of [-0.04, -0.02, 0.02, 0.04]) spike(head, 'skin', [x, 1.69, 0.1], [x, 1.62, 0.1], 0.008, BONE, { seg: 4 })
    for (const sx of [-1, 1]) spike(head, 'skin', [0.025 * sx, 1.7, 0.19], [0.03 * sx, 1.63, 0.2], 0.01, BONE, { seg: 4 })
    blob(head, 'glow', [0, 1.67, 0.02], [0.05, 0.03, 0.07], ACID, { noise: 0.05, seg: [7, 5] })
    blob(head, 'membrane', [0, 1.63, 0.04], [0.055, 0.06, 0.07], 0xd6f0b0, { seg: [8, 6], mottle: 0.1 })
    blob(head, 'glow', [0, 1.63, 0.04], [0.03, 0.035, 0.04], ACID, { noise: 0, seg: [6, 5] })
    const jaw = new Kit(HK.jaw)
    for (const sx of [-1, 1]) spindle(jaw, 'skin', [0.035 * sx, 1.68, -0.02], [0.035 * sx, 1.62, 0.16], 0.02, 0.015, flesh, { seg: 5, steps: 3 })
    blob(jaw, 'skin', [0, 1.62, 0.15], [0.045, 0.02, 0.03], flesh, { seg: [6, 4] })
    for (const x of [-0.03, 0, 0.03]) spike(jaw, 'skin', [x, 1.63, 0.12 + Math.abs(x)], [x, 1.68, 0.12 + Math.abs(x)], 0.007, BONE, { seg: 4 })
    blob(jaw, 'glow', [0, 1.635, 0.08], [0.03, 0.008, 0.05], ACID, { noise: 0, seg: [6, 4] })

    return {
        pelvis,
        chest,
        sac: sacKit,
        head,
        jaw,
        armL: huskArm(-1, flesh, chitin),
        armR: huskArm(1, flesh, chitin),
        legL: huskLeg(-1, flesh, chitin, cloth),
        legR: huskLeg(1, flesh, chitin, cloth)
    }
}

function huskArm(sx: number, flesh: number, chitin: number) {
    const k = new Kit()
    blob(k, 'skin', [0, 0, 0], [0.05, 0.05, 0.05], flesh, { seg: [6, 5] })
    spindle(k, 'skin', [0, 0, 0], [0.02 * sx, -0.42, -0.02], 0.042, 0.03, flesh, { bulge: 0.06 })
    blob(k, 'skin', [0.02 * sx, -0.43, -0.02], [0.04, 0.04, 0.04], flesh, { seg: [6, 5] })
    spike(k, 'chitin', [0.02 * sx, -0.43, -0.04], [0.03 * sx, -0.47, -0.17], 0.02, chitin)
    spindle(k, 'skin', [0.02 * sx, -0.43, -0.02], [0, -0.86, 0.14], 0.03, 0.022, flesh, { bulge: 0.05 })
    blob(k, 'skin', [0, -0.87, 0.15], [0.03, 0.045, 0.02], flesh, { seg: [6, 5] })
    for (const x of [-0.03, -0.01, 0.01, 0.03]) spike(k, 'skin', [x, -0.9, 0.15], [x * 1.7, -1.06, 0.21], 0.01, BONE, { seg: 4 })
    blob(k, 'membrane', [0.03 * sx, -0.6, 0.03], [0.045, 0.06, 0.045], 0xd6f0b0, { seg: [7, 5], mottle: 0.1 })
    blob(k, 'glow', [0.03 * sx, -0.6, 0.03], [0.022, 0.032, 0.022], ACID, { noise: 0, seg: [5, 4] })
    tube(k, 'glow', [[0.01 * sx, -0.05, 0.04], [0.02 * sx, -0.25, 0.03], [0.02 * sx, -0.4, 0.02]], 0.005, ACID)
    return k
}

function huskLeg(sx: number, flesh: number, chitin: number, cloth: number) {
    const k = new Kit()
    spindle(k, 'skin', [0, 0, 0], [0, -0.38, 0.15], 0.07, 0.05, flesh, { bulge: 0.05 })
    spindle(k, 'cloth', [0, -0.02, 0.01], [0, -0.26, 0.1], 0.085, 0.075, cloth, { seg: 6, steps: 3, seed: sx })
    blob(k, 'skin', [0, -0.39, 0.16], [0.05, 0.05, 0.05], flesh, { seg: [6, 5] })
    blob(k, 'chitin', [0, -0.4, 0.2], [0.04, 0.05, 0.02], chitin, { seg: [6, 4] })
    spindle(k, 'skin', [0, -0.39, 0.16], [0, -0.72, -0.02], 0.048, 0.032, flesh, { bulge: 0.08 })
    blob(k, 'skin', [0, -0.73, -0.02], [0.035, 0.035, 0.035], flesh, { seg: [6, 5] })
    spindle(k, 'skin', [0, -0.73, -0.02], [0, -0.87, 0.1], 0.03, 0.02, flesh, { seg: 5, steps: 2 })
    for (const x of [-0.03, 0, 0.03]) spike(k, 'skin', [x * 0.5, -0.88, 0.1], [x * 2, -0.9, 0.27], 0.016, BONE, { seg: 4 })
    spike(k, 'chitin', [0, -0.72, -0.04], [0, -0.66, -0.14], 0.016, chitin, { seg: 4 })
    tube(k, 'glow', [[0.045 * sx, -0.05, 0.03], [0.05 * sx, -0.2, 0.08], [0.04 * sx, -0.34, 0.15]], 0.005, ACID)
    return k
}

function buildHusk(def: CallOfXenoEnemy, seed: number): EnemyModel {
    const bp = cached('husk', () => huskParts(def.color))
    const mats = makeMats('husk')
    const group = new THREE.Group()
    group.add(mount(bp.pelvis, mats, [0, 0, 0]))
    const chest = mount(bp.chest, mats, HK.chest)
    chest.rotation.x = HK.lean
    group.add(chest)
    const sac = mount(bp.sac, mats, rel(HK.sac, HK.chest))
    chest.add(sac)
    const head = mount(bp.head, mats, rel(HK.head, HK.chest))
    head.rotation.x = 0.16
    chest.add(head)
    const jaw = mount(bp.jaw, mats, rel(HK.jaw, HK.head))
    head.add(jaw)
    const armL = mount(bp.armL, mats, [-HK.shoulder, HK.shoulderY - HK.chest[1], 0])
    const armR = mount(bp.armR, mats, [HK.shoulder, HK.shoulderY - HK.chest[1], 0])
    chest.add(armL, armR)
    const legL = mount(bp.legL, mats, [-HK.hip, HK.hipY, 0])
    const legR = mount(bp.legR, mats, [HK.hip, HK.hipY, 0])
    group.add(legL, legR)
    group.add(shadowDisc(0.38))

    const model = assemble('husk', def, group, mats, seed, 1.15, { head, jaw, armL, armR, legL, legR, chest, sac })
    model.baseCloth = 0x3a3f46
    model.lean = HK.lean
    model.animate = animateHusk
    return model
}

// ---------------------------------------------------------------------------
// Drone: insectoid flyer
// ---------------------------------------------------------------------------

const DR = {
    head: [0, 1.32, 0.26] as V3,
    jaw: [0, 1.29, 0.4] as V3,
    tail: [0, 1.2, -0.72] as V3,
    wing: 0.07,
    wingY: 1.42,
    wingZ: 0.05
}

function wingGeometry(span: number, chord: number, sx: number) {
    const top: THREE.Vector2[] = []
    const bottom: THREE.Vector2[] = []
    const n = 9
    for (let i = 0; i <= n; i++) {
        const t = i / n
        const w = chord * Math.sin(Math.PI * Math.pow(t, 0.75))
        top.push(new THREE.Vector2(span * t, w * 0.45))
        bottom.push(new THREE.Vector2(span * t, -w * 0.55))
    }
    const geo = new THREE.ShapeGeometry(new THREE.Shape([...top, ...bottom.reverse()]))
    geo.rotateX(-Math.PI / 2)
    geo.scale(sx, 1, 1)
    return geo
}

function droneWing(sx: number): Kit {
    const k = new Kit()
    const wingColor = 0xbff4ee
    const veinColor = 0x1e3a44
    const wings: { span: number, chord: number, z: number, sweep: number }[] = [
        { span: 0.82, chord: 0.24, z: 0, sweep: 0.12 },
        { span: 0.6, chord: 0.18, z: -0.1, sweep: 0.34 }
    ]
    for (const w of wings) {
        k.add('membrane', wingGeometry(w.span, w.chord, sx), compose([0, 0, w.z], [0, w.sweep * sx, 0]), wingColor, { mottle: 0.12, seed: w.span * 10 })
        const tip = (x: number, z: number): V3 => {
            // Rotate the point about y by the sweep, so veins stay on the membrane.
            const c = Math.cos(w.sweep * sx)
            const s = Math.sin(w.sweep * sx)
            return [x * sx * c + z * s, 0.003, -x * sx * s * sx * sx + z * c + w.z]
        }
        tube(k, 'chitin', [tip(0, 0.01), tip(w.span * 0.5, 0.012), tip(w.span * 0.95, 0)], 0.007, veinColor, { seg: 0 } as GeoOpts & { segs?: number })
        tube(k, 'chitin', [tip(0, 0), tip(w.span * 0.55, -w.chord * 0.32), tip(w.span * 0.88, -w.chord * 0.12)], 0.005, veinColor)
    }
    return k
}

function droneParts(flesh: number): Record<string, Kit> {
    const shell = 0x22414c
    const dark = 0x14242a
    const cyan = 0x30ffe0
    const body = new Kit()
    // Thorax and segmented abdomen.
    blob(body, 'chitin', [0, 1.32, 0.05], [0.14, 0.13, 0.22], shell, { seg: [10, 7] })
    blob(body, 'skin', [0, 1.3, -0.3], [0.11, 0.1, 0.16], flesh, { seg: [9, 7] })
    blob(body, 'skin', [0, 1.27, -0.5], [0.09, 0.08, 0.14], flesh, { seg: [8, 6] })
    blob(body, 'skin', [0, 1.22, -0.66], [0.06, 0.055, 0.12], flesh, { seg: [7, 5] })
    blob(body, 'chitin', [0, 1.36, -0.3], [0.115, 0.05, 0.14], shell, { seg: [8, 5] })
    blob(body, 'chitin', [0, 1.325, -0.5], [0.095, 0.04, 0.12], shell, { seg: [8, 5] })
    blob(body, 'chitin', [0, 1.27, -0.66], [0.065, 0.03, 0.1], shell, { seg: [7, 4] })
    tube(body, 'glow', [[0, 1.42, 0.14], [0, 1.44, -0.1], [0, 1.4, -0.34], [0, 1.36, -0.52]], 0.008, cyan)
    for (const sx of [-1, 1]) tube(body, 'glow', [[0.05 * sx, 1.28, 0.24], [0.1 * sx, 1.3, 0.1], [0.07 * sx, 1.36, -0.1]], 0.006, cyan)
    // Dangling insect legs: three pairs.
    for (const sx of [-1, 1]) {
        for (const z of [0.15, 0.02, -0.11]) {
            const knee: V3 = [0.2 * sx, 1.12, z + 0.06]
            spindle(body, 'chitin', [0.09 * sx, 1.24, z], knee, 0.018, 0.012, dark, { seg: 5, steps: 2, bulge: 0.05 })
            spindle(body, 'chitin', knee, [0.25 * sx, 0.92, z + 0.12], 0.012, 0.006, dark, { seg: 4, steps: 2, bulge: 0 })
        }
    }

    const head = new Kit(DR.head)
    blob(head, 'chitin', [0, 1.33, 0.34], [0.11, 0.1, 0.12], shell, { seg: [9, 7] })
    for (const sx of [-1, 1]) {
        blob(head, 'glow', [0.075 * sx, 1.35, 0.37], [0.05, 0.06, 0.05], cyan, { noise: 0.05, seg: [8, 6] })
        tube(head, 'chitin', [[0.03 * sx, 1.42, 0.4], [0.08 * sx, 1.55, 0.55], [0.12 * sx, 1.6, 0.72]], 0.006, dark)
    }
    for (const x of [-0.03, 0, 0.03]) blob(head, 'glow', [x, 1.42, 0.33], [0.012, 0.012, 0.012], cyan, { noise: 0, seg: [5, 4] })
    const jaw = new Kit(DR.jaw)
    for (const sx of [-1, 1]) {
        spike(jaw, 'chitin', [0.04 * sx, 1.29, 0.4], [0.07 * sx, 1.23, 0.56], 0.022, dark)
        spike(jaw, 'chitin', [0.02 * sx, 1.28, 0.42], [0.025 * sx, 1.23, 0.53], 0.014, dark, { seg: 4 })
    }
    blob(jaw, 'skin', [0, 1.26, 0.42], [0.04, 0.03, 0.05], flesh, { seg: [6, 5] })
    blob(jaw, 'glow', [0, 1.285, 0.4], [0.028, 0.02, 0.03], cyan, { noise: 0, seg: [6, 4] })

    const tail = new Kit(DR.tail)
    spindle(tail, 'skin', [0, 1.2, -0.72], [0, 1.23, -0.92], 0.05, 0.035, flesh, { seg: 6, steps: 3 })
    spindle(tail, 'skin', [0, 1.23, -0.92], [0, 1.36, -1.08], 0.035, 0.025, flesh, { seg: 6, steps: 3 })
    spike(tail, 'chitin', [0, 1.36, -1.08], [0, 1.5, -1.14], 0.022, dark)
    blob(tail, 'glow', [0, 1.37, -1.08], [0.045, 0.045, 0.045], cyan, { noise: 0.08, seg: [7, 5] })

    return { body, head, jaw, tail, wingL: droneWing(-1), wingR: droneWing(1) }
}

function flapWings(model: EnemyModel, phase: number, amp = 0.65) {
    const flap = Math.sin(phase) * amp
    const sweep = Math.sin(phase + 1.2) * 0.14
    if (model.wingR) {
        model.wingR.rotation.z = 0.28 + flap
        model.wingR.rotation.y = sweep
    }
    if (model.wingL) {
        model.wingL.rotation.z = -0.28 - flap
        model.wingL.rotation.y = -sweep
    }
}

function buildDrone(def: CallOfXenoEnemy, seed: number): EnemyModel {
    const bp = cached('drone', () => droneParts(def.color))
    const mats = makeMats('drone')
    const group = new THREE.Group()
    group.add(mount(bp.body, mats, [0, 0, 0]))
    const head = mount(bp.head, mats, DR.head)
    group.add(head)
    const jaw = mount(bp.jaw, mats, rel(DR.jaw, DR.head))
    head.add(jaw)
    const tail = mount(bp.tail, mats, DR.tail)
    group.add(tail)

    // Rotor stand-in: the component spins its rotation.y every frame, which
    // doubles as the wing-flap clock until the integrator drives animate().
    const rotor = new THREE.Group()
    group.add(rotor)
    const wingL = mount(bp.wingL, mats, [-DR.wing, DR.wingY, DR.wingZ])
    const wingR = mount(bp.wingR, mats, [DR.wing, DR.wingY, DR.wingZ])
    group.add(wingL, wingR)
    group.add(shadowDisc(0.34))

    const model = assemble('drone', def, group, mats, seed, 1.3, { head, jaw, tail, wingL, wingR, rotor })
    model.baseCloth = 0x22414c
    const stock = rotor.updateMatrixWorld.bind(rotor)
    rotor.updateMatrixWorld = (force?: boolean) => {
        if (!model.animated) flapWings(model, rotor.rotation.y * 5.5 + seed)
        stock(force)
    }
    flapWings(model, 0)
    model.animate = animateDrone
    return model
}

// ---------------------------------------------------------------------------
// Brute: hulking armoured tank
// ---------------------------------------------------------------------------

const BR = {
    chest: [0, 1.0, 0] as V3,
    head: [0, 1.6, 0.04] as V3,
    jaw: [0, 1.68, 0.1] as V3,
    shoulder: 0.5,
    shoulderY: 1.56,
    hip: 0.2,
    hipY: 0.9,
    lean: 0.16,
    pustule: [0, 1.3, -0.36] as V3
}

function bruteParts(flesh: number): Record<string, Kit> {
    const chitin = 0x2a2230
    const navy = 0x2d3b55
    const strap = 0xd06a12
    const pelvis = new Kit()
    blob(pelvis, 'skin', [0, 0.92, 0], [0.3, 0.17, 0.22], flesh, { seg: [9, 6] })
    blob(pelvis, 'cloth', [0, 0.8, 0.02], [0.27, 0.16, 0.2], navy, { seg: [9, 6], seed: 4 })

    const chest = new Kit(BR.chest)
    blob(chest, 'skin', [0, 1.12, 0], [0.3, 0.2, 0.24], flesh, { seg: [9, 6] })
    blob(chest, 'skin', [0, 1.36, 0], [0.4, 0.3, 0.3], flesh, { seg: [11, 8] })
    blob(chest, 'skin', [0, 1.52, -0.13], [0.34, 0.22, 0.2], flesh, { seg: [10, 7] })
    blob(chest, 'chitin', [0, 1.38, 0.19], [0.3, 0.26, 0.13], chitin, { seg: [10, 7], noise: 0.05 })
    tube(chest, 'glow', [[-0.16, 1.55, 0.27], [-0.06, 1.44, 0.32], [0.05, 1.5, 0.31], [0.14, 1.36, 0.31], [0.08, 1.24, 0.3]], 0.011, TEAL)
    blob(chest, 'chitin', [0, 1.14, 0.19], [0.24, 0.045, 0.1], chitin, { seg: [8, 4] })
    blob(chest, 'chitin', [0, 1.06, 0.18], [0.2, 0.04, 0.09], chitin, { seg: [8, 4] })
    // Back carapace, a crater ring and thorns around the weak point.
    for (const sx of [-1, 1]) {
        blob(chest, 'chitin', [0.2 * sx, 1.5, -0.24], [0.2, 0.14, 0.07], chitin, { rot: [0, 0.3 * sx, -0.25 * sx], seg: [8, 5] })
        blob(chest, 'chitin', [0.25 * sx, 1.26, -0.22], [0.17, 0.12, 0.07], chitin, { rot: [0, 0.3 * sx, -0.2 * sx], seg: [8, 5] })
        blob(chest, 'chitin', [0.5 * sx, 1.62, 0], [0.2, 0.13, 0.2], chitin, { rot: [0, 0, 0.4 * sx * -1], seg: [8, 6] })
        blob(chest, 'skin', [0.5 * sx, 1.55, 0], [0.13, 0.13, 0.13], flesh, { seg: [7, 5] })
        spike(chest, 'chitin', [0.5 * sx, 1.68, 0], [0.58 * sx, 1.9, -0.06], 0.05, chitin)
        spike(chest, 'chitin', [0.4 * sx, 1.7, 0], [0.4 * sx, 1.88, 0.02], 0.04, chitin)
        spike(chest, 'chitin', [0.14 * sx, 1.66, -0.28], [0.2 * sx, 1.8, -0.4], 0.04, chitin)
        tube(chest, 'glow', [[0.377 * sx, 1.2, 0.1], [0.385 * sx, 1.35, 0.1], [0.34 * sx, 1.5, 0.08]], 0.008, TEAL)
    }
    blob(chest, 'chitin', [0, 1.72, -0.2], [0.22, 0.07, 0.12], chitin, { rot: [0.3, 0, 0], seg: [8, 5] })
    spike(chest, 'chitin', [0, 1.74, -0.24], [0, 1.9, -0.34], 0.05, chitin)
    k_ring(chest, chitin)
    blob(chest, 'skin', [0, 1.62, 0.02], [0.14, 0.08, 0.1], flesh, { seg: [7, 5] })
    // Torn hi-vis harness strap across the chest.
    spindle(chest, 'cloth', [-0.3, 1.62, 0.12], [0.22, 1.15, 0.2], 0.03, 0.03, strap, { seg: 5, steps: 5, bulge: 0, seed: 2 })
    spindle(chest, 'cloth', [-0.22, 1.54, 0.16], [0.1, 1.26, 0.22], 0.033, 0.033, 0xdfe4e6, { seg: 5, steps: 2, bulge: 0, noise: 0.002 })

    const head = new Kit(BR.head)
    blob(head, 'chitin', [0, 1.76, 0.05], [0.15, 0.13, 0.16], chitin, { seg: [9, 7] })
    blob(head, 'skin', [0, 1.72, 0.14], [0.1, 0.08, 0.08], flesh, { seg: [8, 6] })
    blob(head, 'chitin', [0, 1.8, 0.16], [0.13, 0.03, 0.07], chitin, { rot: [-0.2, 0, 0], seg: [7, 4] })
    for (const sx of [-1, 1]) {
        blob(head, 'glow', [0.06 * sx, 1.765, 0.19], [0.04, 0.011, 0.018], TEAL, { rot: [0, 0, 0.35 * sx], noise: 0, seg: [6, 4] })
        spike(head, 'chitin', [0.11 * sx, 1.84, -0.01], [0.22 * sx, 2.0, -0.12], 0.04, chitin)
        spike(head, 'chitin', [0.07 * sx, 1.86, -0.06], [0.11 * sx, 2.02, -0.2], 0.03, chitin)
    }
    const jaw = new Kit(BR.jaw)
    blob(jaw, 'skin', [0, 1.64, 0.16], [0.11, 0.04, 0.11], flesh, { seg: [8, 5] })
    for (const sx of [-1, 1]) spike(jaw, 'skin', [0.075 * sx, 1.66, 0.22], [0.09 * sx, 1.81, 0.26], 0.02, BONE, { seg: 4 })
    for (const x of [-0.04, 0, 0.04]) spike(jaw, 'skin', [x, 1.66, 0.2], [x, 1.7, 0.2], 0.01, BONE, { seg: 4 })
    blob(jaw, 'glow', [0, 1.65, 0.14], [0.05, 0.008, 0.05], TEAL, { noise: 0, seg: [6, 4] })

    return {
        pelvis,
        chest,
        head,
        jaw,
        armL: bruteArm(-1, flesh, chitin),
        armR: bruteArm(1, flesh, chitin),
        legL: bruteLeg(-1, flesh, chitin, navy),
        legR: bruteLeg(1, flesh, chitin, navy)
    }
}

function k_ring(chest: Kit, chitin: number) {
    const p = BR.pustule
    chest.add('chitin', new THREE.TorusGeometry(0.24, 0.045, 5, 10), compose([p[0], p[1], p[2] + 0.05]), chitin, { mottle: 0.1 })
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3
        const bx = Math.cos(a) * 0.25
        const by = Math.sin(a) * 0.25
        spike(chest, 'chitin', [p[0] + bx, p[1] + by, p[2] + 0.05], [p[0] + bx * 1.25, p[1] + by * 1.25, p[2] - 0.1], 0.03, chitin)
    }
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.8
        tube(chest, 'glow', [[p[0] + Math.cos(a) * 0.1, p[1] + Math.sin(a) * 0.1, p[2] + 0.02], [p[0] + Math.cos(a) * 0.2, p[1] + Math.sin(a) * 0.2, p[2] + 0.04], [p[0] + Math.cos(a + 0.2) * 0.3, p[1] + Math.sin(a + 0.2) * 0.3, p[2] + 0.1]], 0.008, TEAL)
    }
}

function bruteArm(sx: number, flesh: number, chitin: number) {
    const k = new Kit()
    blob(k, 'skin', [0, 0, 0], [0.12, 0.12, 0.12], flesh, { seg: [7, 5] })
    spindle(k, 'skin', [0, 0, 0], [0.05 * sx, -0.42, 0.03], 0.14, 0.11, flesh, { bulge: 0.12, seg: 8 })
    blob(k, 'chitin', [0.05 * sx, -0.44, -0.02], [0.11, 0.11, 0.1], chitin, { seg: [7, 5] })
    spike(k, 'chitin', [0.08 * sx, -0.44, -0.05], [0.16 * sx, -0.48, -0.2], 0.04, chitin)
    spindle(k, 'skin', [0.05 * sx, -0.44, 0.03], [0.02 * sx, -0.86, 0.14], 0.12, 0.17, flesh, { bulge: 0.1, seg: 8 })
    blob(k, 'chitin', [0.03 * sx, -0.72, 0.12], [sx < 0 ? 0.19 : 0.17, 0.2, 0.17], chitin, { seg: [8, 6], noise: 0.06 })
    blob(k, 'skin', [0, -0.96, 0.16], [0.14, 0.1, 0.12], flesh, { seg: [7, 5] })
    for (const x of [-0.07, 0, 0.07]) spike(k, 'chitin', [x, -0.95, 0.24], [x * 1.3, -1.03, 0.4], 0.035, chitin)
    tube(k, 'glow', [[0.03 * sx, -0.08, 0.13], [0.04 * sx, -0.22, 0.15], [0.05 * sx, -0.36, 0.15]], 0.008, TEAL)
    return k
}

function bruteLeg(sx: number, flesh: number, chitin: number, navy: number) {
    const k = new Kit()
    spindle(k, 'skin', [0, 0, 0], [0, -0.44, 0.06], 0.14, 0.11, flesh, { bulge: 0.1, seg: 8 })
    blob(k, 'cloth', [0, -0.1, 0], [0.16, 0.16, 0.15], navy, { seg: [8, 6], seed: sx })
    blob(k, 'chitin', [0, -0.46, 0.14], [0.11, 0.1, 0.07], chitin, { seg: [7, 5] })
    spike(k, 'chitin', [0, -0.46, 0.18], [0, -0.5, 0.34], 0.035, chitin)
    spindle(k, 'skin', [0, -0.46, 0.06], [0, -0.84, -0.02], 0.11, 0.08, flesh, { bulge: 0.08, seg: 8 })
    blob(k, 'chitin', [0, -0.66, 0.06], [0.11, 0.2, 0.08], chitin, { seg: [7, 6] })
    blob(k, 'skin', [0, -0.86, 0.1], [0.11, 0.05, 0.16], flesh, { seg: [7, 5] })
    for (const x of [-0.06, 0, 0.06]) spike(k, 'chitin', [x, -0.87, 0.24], [x * 1.2, -0.89, 0.4], 0.028, chitin)
    return k
}

function buildBrute(def: CallOfXenoEnemy, seed: number): EnemyModel {
    const bp = cached('brute', () => bruteParts(def.color))
    const mats = makeMats('brute')
    const group = new THREE.Group()
    group.add(mount(bp.pelvis, mats, [0, 0, 0]))
    const chest = mount(bp.chest, mats, BR.chest)
    chest.rotation.x = BR.lean
    group.add(chest)
    const head = mount(bp.head, mats, rel(BR.head, BR.chest))
    chest.add(head)
    const jaw = mount(bp.jaw, mats, rel(BR.jaw, BR.head))
    head.add(jaw)
    const armL = mount(bp.armL, mats, [-BR.shoulder, BR.shoulderY - BR.chest[1], 0])
    const armR = mount(bp.armR, mats, [BR.shoulder, BR.shoulderY - BR.chest[1], 0])
    chest.add(armL, armR)
    const legL = mount(bp.legL, mats, [-BR.hip, BR.hipY, 0])
    const legR = mount(bp.legR, mats, [BR.hip, BR.hipY, 0])
    group.add(legL, legR)
    group.add(shadowDisc(0.42))

    // Weak point: a fat glowing pustule in the carapace crater on the back.
    const pustuleGeo = pustuleGeometry()
    const pustuleMat = withBase(new THREE.MeshStandardMaterial({ color: 0xffc040, roughness: 0.2, metalness: 0, transparent: true }), 0xff8a10, 1.6)
    pustuleMat.userData.baseOpacity = 1
    const pustule = new THREE.Mesh(pustuleGeo, pustuleMat)
    pustule.position.set(BR.pustule[0], BR.pustule[1] - BR.chest[1], BR.pustule[2])
    pustule.scale.set(0.2, 0.22, 0.13)
    chest.add(pustule)

    const model = assemble('brute', def, group, mats, seed, 1.2, { head, jaw, armL, armR, legL, legR, chest }, [pustuleMat])
    model.baseCloth = 0x2d3b55
    model.lean = BR.lean
    model.weakPoint = pustule
    model.animate = animateBrute
    return model
}

let pustuleShared: THREE.BufferGeometry | null = null

function pustuleGeometry() {
    if (!pustuleShared) {
        const geo = new THREE.SphereGeometry(1, 12, 9)
        const pos = geo.getAttribute('position') as THREE.BufferAttribute
        for (let i = 0; i < pos.count; i++) {
            const n = 1 + (vnoise(pos.getX(i) * 3, pos.getY(i) * 3, pos.getZ(i) * 3) - 0.5) * 0.22
            pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n, pos.getZ(i) * n)
        }
        geo.computeVertexNormals()
        pustuleShared = noDispose(geo)
    }
    return pustuleShared
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function assemble(
    kind: EnemyModel['kind'],
    def: CallOfXenoEnemy,
    group: THREE.Group,
    mats: Mats,
    seed: number,
    torsoY: number,
    rig: Partial<Pick<EnemyModel, 'head' | 'jaw' | 'armL' | 'armR' | 'legL' | 'legR' | 'chest' | 'tail' | 'wingL' | 'wingR' | 'sac' | 'rotor'>>,
    extra: THREE.MeshStandardMaterial[] = []
): EnemyModel {
    const model: EnemyModel = {
        group,
        ...rig,
        kind,
        seed,
        skin: mats.skin,
        clothes: mats.cloth,
        chitin: mats.chitin,
        membrane: mats.membrane,
        glow: mats.glow,
        baseSkin: def.color,
        baseCloth: 0x343a44,
        torsoY,
        lit: [mats.skin, mats.cloth, mats.chitin, mats.membrane, ...extra]
    }
    const fade: THREE.Material[] = [mats.chitin, mats.membrane, mats.glow, ...extra]
    group.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh && (mesh.material as THREE.Material).userData.baseOpacity === 0.34) fade.push(mesh.material as THREE.Material)
    })
    linkFade(model, fade)
    return model
}

export function buildEnemy(def: CallOfXenoEnemy): EnemyModel {
    const seed = spawnCounter++
    const model = def.flies
        ? buildDrone(def, seed)
        : def.id === 'brute'
            ? buildBrute(def, seed)
            : def.id === 'husk'
                ? buildHusk(def, seed)
                : buildShambler(def, seed)
    model.group.scale.setScalar(def.scale)
    model.torsoY *= def.scale
    return model
}

// ---------------------------------------------------------------------------
// Hit flash
// ---------------------------------------------------------------------------

/** Hit flash: the body lights up hot white-red (emissive), eyes and veins blow out. */
export function flashEnemy(model: EnemyModel, on: boolean) {
    if ((model.flashing ?? false) === on) return
    model.flashing = on
    for (const m of model.lit ?? []) {
        m.emissive.setHex(on ? 0xff4a30 : (m.userData.baseEmissive as number))
        m.emissiveIntensity = on ? 1.5 : (m.userData.baseIntensity as number)
    }
    model.skin.color.setHex(on ? 0xffb4a4 : 0xffffff)
    model.clothes.color.setHex(on ? 0xffb4a4 : 0xffffff)
    model.glow.color.setScalar(on ? 3 : 1)
}

// ---------------------------------------------------------------------------
// Secondary motion
// ---------------------------------------------------------------------------

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Small shudder bursts, deterministic per enemy. */
function twitch(t: number, phase: number) {
    const burst = Math.max(0, Math.sin(t * 2.9 + phase))
    return burst * burst * burst * burst * Math.sin(t * 43 + phase)
}

function pulseGlow(model: EnemyModel, value: number) {
    if (!model.flashing) model.glow.color.setScalar(value)
}

function animateWalker(model: EnemyModel, t: number, speed: number, state: EnemyAnimState) {
    model.animated = true
    const ph = model.seed * 1.7
    const move = clamp01(speed / 3)
    const attack = state === 'attack'
    const chest = model.chest!
    const stride = t * (2.2 + speed * 0.8)
    const tw = twitch(t, ph)
    chest.rotation.x = (model.lean ?? 0.2)
        + Math.sin(t * 2.2 + ph) * 0.025
        + (attack ? 0.2 * (0.5 + 0.5 * Math.sin(t * 9 + ph)) : 0)
        + (state === 'climb' ? 0.22 : 0)
    chest.rotation.y = Math.sin(stride) * 0.09 * move
    chest.rotation.z = tw * 0.05 + Math.sin(stride * 0.5) * 0.03 * move
    const head = model.head!
    head.rotation.x = 0.12 + Math.sin(t * 1.7 + ph) * 0.05 + (attack ? -0.18 : 0)
    head.rotation.y = Math.sin(t * 0.9 + ph) * (state === 'idle' ? 0.32 : 0.14) + tw * 0.2
    model.jaw!.rotation.x = attack
        ? Math.abs(Math.sin(t * 15 + ph)) * 0.6
        : state === 'idle'
            ? 0.2 + Math.sin(t * 11 + ph) * 0.12
            : 0.16 + Math.sin(t * 7 + ph) * 0.1
    pulseGlow(model, 0.82 + Math.sin(t * 3 + ph) * 0.2 + (attack ? 0.3 : 0))
}

function animateHusk(model: EnemyModel, t: number, speed: number, state: EnemyAnimState) {
    model.animated = true
    const ph = model.seed * 1.3
    const attack = state === 'attack'
    const move = clamp01(speed / 3)
    const beat = 0.5 + 0.5 * Math.sin(t * 3.2 + ph)
    const chest = model.chest!
    chest.rotation.x = (model.lean ?? 0.26) + Math.sin(t * 3 + ph) * 0.03 + (attack ? 0.14 : 0) + (state === 'climb' ? 0.2 : 0)
    chest.rotation.y = Math.sin(t * (2.6 + speed) + ph) * 0.1 * move
    chest.rotation.z = twitch(t, ph) * 0.07
    // The sac breathes; before a spit it swells and jitters.
    const swell = attack ? 0.18 + 0.1 * Math.abs(Math.sin(t * 6 + ph)) : 0
    model.sac!.scale.set(1 + beat * 0.07 + swell, 1 + beat * 0.09 + swell, 1 + beat * 0.07 + swell)
    if (!model.flashing) {
        model.membrane.emissiveIntensity = 0.55 + beat * 0.7 + (attack ? 0.8 : 0)
    }
    const head = model.head!
    head.rotation.x = 0.16 + Math.sin(t * 2.1 + ph) * 0.07 + (attack ? -0.3 : 0)
    head.rotation.y = Math.sin(t * 1.1 + ph) * 0.25 + twitch(t, ph + 1) * 0.3
    model.jaw!.rotation.x = attack ? 0.65 + Math.sin(t * 8 + ph) * 0.15 : 0.3 + Math.sin(t * 5 + ph) * 0.1
    pulseGlow(model, 0.75 + beat * 0.4 + (attack ? 0.45 : 0))
}

function animateDrone(model: EnemyModel, t: number, speed: number, state: EnemyAnimState) {
    model.animated = true
    const ph = model.seed * 2.1
    const attack = state === 'attack'
    flapWings(model, t * (attack ? 96 : 78) + ph, attack ? 0.75 : 0.6)
    const tail = model.tail!
    tail.rotation.y = Math.sin(t * 2.3 + ph) * 0.25
    tail.rotation.x = Math.sin(t * 1.7 + ph) * 0.12 + (attack ? -0.4 : 0)
    model.head!.rotation.y = Math.sin(t * 1.3 + ph) * 0.2 + twitch(t, ph) * 0.3
    model.head!.rotation.x = Math.sin(t * 2 + ph) * 0.06 + clamp01(speed / 4) * 0.08
    model.jaw!.rotation.x = attack ? 0.5 + Math.sin(t * 16) * 0.2 : 0.12 + Math.abs(Math.sin(t * 6 + ph)) * 0.16
    pulseGlow(model, 0.85 + Math.sin(t * 4 + ph) * 0.2 + (attack ? 0.5 : 0))
}

function animateBrute(model: EnemyModel, t: number, speed: number, state: EnemyAnimState) {
    model.animated = true
    const ph = model.seed * 0.9
    const attack = state === 'attack'
    const move = clamp01(speed / 2)
    const chest = model.chest!
    chest.rotation.x = (model.lean ?? 0.16) + Math.sin(t * 1.5 + ph) * 0.03 + (attack ? -0.12 + 0.2 * Math.abs(Math.sin(t * 5 + ph)) : 0) + (state === 'climb' ? 0.15 : 0)
    chest.rotation.z = Math.sin(t * (1.6 + speed * 0.6) + ph) * 0.05 * move
    const head = model.head!
    head.rotation.x = attack ? -0.3 : 0.02 + Math.sin(t * 1.1 + ph) * 0.04
    head.rotation.y = Math.sin(t * 0.7 + ph) * 0.18
    model.jaw!.rotation.x = attack ? 0.7 : 0.14 + Math.sin(t * 2 + ph) * 0.06
    // Heartbeat in the back: a quick double thump.
    const a = Math.max(0, Math.sin(t * 5.5 + ph))
    const b = Math.max(0, Math.sin(t * 5.5 + ph - 0.9)) * 0.6
    const beat = Math.min(1, a * a * a + b * b * b)
    const pustule = model.weakPoint
    if (pustule) {
        const s = 1 + beat * 0.14
        pustule.scale.set(0.2 * s, 0.22 * s, 0.13 * s)
        const mat = pustule.material as THREE.MeshStandardMaterial
        if (!model.flashing) mat.emissiveIntensity = 1.1 + beat * 1.6
    }
    pulseGlow(model, 0.8 + beat * 0.35 + (attack ? 0.25 : 0))
}

/** Drive the secondary motion. Same as `model.animate?.(model, t, speed, state)`. */
export function animateEnemyModel(model: EnemyModel, t: number, speed: number, state: EnemyAnimState) {
    model.animate?.(model, t, speed, state)
}

// ---------------------------------------------------------------------------
// Dismemberment
// ---------------------------------------------------------------------------

/** Detachable parts: head and arms for walkers, plus tail and wings for drones. */
export function gibParts(model: EnemyModel): EnemyGib[] {
    const gibs: EnemyGib[] = []
    const add = (name: EnemyGibName, object: THREE.Object3D | undefined) => {
        if (object && object.parent) gibs.push({ name, object })
    }
    add('head', model.head)
    add('armL', model.armL)
    add('armR', model.armR)
    add('tail', model.tail)
    add('wingL', model.wingL)
    add('wingR', model.wingR)
    return gibs
}

/**
 * Cuts a part off and re-parents it to `parent` (usually the scene) keeping
 * its exact world transform, so the caller can fling it with its own
 * velocity and spin. The body keeps a stump. Its materials are the corpse's,
 * so it fades with it. Returns null if already detached.
 */
export function detachGib(model: EnemyModel, gib: EnemyGib | EnemyGibName, parent: THREE.Object3D): THREE.Object3D | null {
    const object = typeof gib === 'string' ? gibParts(model).find(g => g.name === gib)?.object : gib.object
    if (!object || !object.parent) return null
    model.group.updateWorldMatrix(true, true)
    parent.updateWorldMatrix(true, false)
    parent.attach(object)
    return object
}
