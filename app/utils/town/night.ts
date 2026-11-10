import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Polytown at night. Every building gets one little light: a lit window on its
// front wall, or a lamp post by the door when it has no wall (fields, parks),
// plus a warm pool of light on the ground in front. Real point lights would
// recompile every material and cost a light per building, so the light is
// faked: an unlit warm pane and an additive glow decal.
//
// Lamps are dealt into a few groups, each with its own three materials, so
// one call (setTownNightMix) drives every light in town: at dusk the groups
// switch on one after another, and with the mix at 0 they are all skipped.

const WARM = new THREE.Color(0xffc56b)
const POST = new THREE.Color(0x2a2620)

function glowMat(color: number, offset = false) {
    return new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        visible: false,
        ...(offset ? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {})
    })
}

interface LampSet { lamp: THREE.MeshBasicMaterial, pool: THREE.MeshBasicMaterial, halo: THREE.MeshBasicMaterial }
const LAMP_GROUPS = 6
const lampSets: LampSet[] = Array.from({ length: LAMP_GROUPS }, () => ({
    lamp: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, visible: false }),
    pool: glowMat(0xffa94d, true),
    halo: glowMat(0xffb860)
}))
/** When each group switches on, as a night mix: the first lights come on at dusk. */
const LAMP_START = 0.35
const LAMP_STEP = 0.07
const LAMP_FADE = 0.08

// Vehicle lights come on together, a little before the houses.
const vehicleLampMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, visible: false })
const beamMaterial = glowMat(0xffe2a8, true)
const tailGlowMaterial = glowMat(0xff3a2a)
const VEHICLE_LIGHTS_AT = 0.3

let poolTexture: THREE.CanvasTexture | null = null

function glowTexture(): THREE.CanvasTexture {
    if (poolTexture) return poolTexture
    const size = 128
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
    poolTexture = new THREE.CanvasTexture(c)
    poolTexture.colorSpace = THREE.SRGBColorSpace
    for (const set of lampSets) set.pool.map = set.halo.map = poolTexture
    beamMaterial.map = tailGlowMaterial.map = poolTexture
    return poolTexture
}

function painted(geo: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
    const g = geo.index ? geo.toNonIndexed() : geo
    const n = g.getAttribute('position').count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) color.toArray(colors, i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.deleteAttribute('uv')
    g.deleteAttribute('normal')
    return g
}

// Shared geometry: a window pane with a glowing sill line, and a lamp post.
let paneGeo: THREE.BufferGeometry | null = null
let postGeo: THREE.BufferGeometry | null = null
let poolGeo: THREE.BufferGeometry | null = null
let haloGeo: THREE.BufferGeometry | null = null
function geometries() {
    if (!paneGeo) {
        paneGeo = painted(new THREE.BoxGeometry(0.085, 0.1, 0.012), WARM)
        const pole = painted(new THREE.CylinderGeometry(0.012, 0.016, 0.34, 6).translate(0, 0.17, 0), POST)
        const bulb = painted(new THREE.BoxGeometry(0.05, 0.06, 0.05).translate(0, 0.37, 0), WARM)
        const cap = painted(new THREE.ConeGeometry(0.045, 0.035, 4).rotateY(Math.PI / 4).translate(0, 0.415, 0), POST)
        postGeo = mergeGeometries([pole, bulb, cap])!
        poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
        haloGeo = new THREE.PlaneGeometry(1, 1)
    }
    return { pane: paneGeo!, post: postGeo!, pool: poolGeo!, halo: haloGeo! }
}

interface LampAnchor { kind: 'window' | 'post', x: number, y: number, z: number, poolZ: number, poolSize: number }
const anchors = new Map<string, LampAnchor>()
const raycaster = new THREE.Raycaster()

/**
 * Where a model's light goes, in model space (the front door faces +Z). Cast a
 * few rays at the front wall and take the first hit on a wall that faces
 * forward; no wall means a lamp post at the front corner.
 */
function findAnchor(model: THREE.Object3D): LampAnchor {
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const width = Math.max(0.6, box.max.x - box.min.x)
    const poolSize = 0.75 + width * 0.25
    const height = Math.max(0.2, box.max.y)
    const dir = new THREE.Vector3(0, 0, -1)
    const meshes: THREE.Object3D[] = []
    model.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o) })
    const heights = [0.3, 0.38, 0.24, 0.46].map(h => Math.min(h, height * 0.7))
    const offsets = [0.17, -0.17, 0.27, -0.27, 0.08].map(x => x * Math.max(1, width))
    for (const y of heights) {
        for (const x of offsets) {
            raycaster.set(new THREE.Vector3(x, y, box.max.z + 1), dir)
            const hit = raycaster.intersectObjects(meshes, false)[0]
            if (!hit?.face || hit.face.normal.z < 0.7) continue
            return { kind: 'window', x, y, z: hit.point.z + 0.007, poolZ: hit.point.z + poolSize * 0.35, poolSize }
        }
    }
    const edge = Math.min(0.42 * Math.max(1, width), Math.max(box.max.x, 0.3))
    const front = Math.min(0.42 * Math.max(1, width), Math.max(box.max.z, 0.3))
    return { kind: 'post', x: edge, y: 0, z: front, poolZ: front, poolSize: 0.7 }
}

/**
 * Give a freshly built model its night light. Call before the model is
 * positioned or parented: the anchor is measured in model space. `key`
 * identifies the artwork, so the rays are cast once per look.
 */
export function addTownNightLamp(model: THREE.Group, key: string): void {
    glowTexture()
    let anchor = anchors.get(key)
    if (!anchor) {
        anchor = findAnchor(model)
        anchors.set(key, anchor)
    }
    const geo = geometries()
    const lamp = new THREE.Group()
    lamp.name = 'nightlamp'
    // Cosmetic: which wave of the dusk this house switches on in.
    const set = lampSets[Math.floor(Math.random() * LAMP_GROUPS)]!
    const light = new THREE.Mesh(anchor.kind === 'window' ? geo.pane : geo.post, set.lamp)
    light.position.set(anchor.x, anchor.y, anchor.z)
    const haloY = anchor.kind === 'window' ? anchor.y : 0.37
    const halo = new THREE.Mesh(geo.halo, set.halo)
    halo.position.set(anchor.x, haloY, anchor.z + 0.02)
    halo.scale.setScalar(0.32)
    const pool = new THREE.Mesh(geo.pool, set.pool)
    pool.position.set(anchor.x * 0.6, 0.045, anchor.poolZ)
    pool.scale.setScalar(anchor.poolSize)
    pool.renderOrder = 1
    for (const o of [light, halo, pool]) {
        o.castShadow = false
        o.receiveShadow = false
        // Scenery only: clicks go through to the building or the tile under it.
        o.raycast = () => {}
        lamp.add(o)
    }
    model.add(lamp)
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** 0 = broad daylight (lamps off and skipped), 1 = full night. */
export function setTownNightMix(mix: number): void {
    lampSets.forEach((set, i) => {
        const on = clamp01((mix - LAMP_START - i * LAMP_STEP) / LAMP_FADE)
        set.lamp.visible = set.pool.visible = set.halo.visible = on > 0
        set.lamp.color.setScalar(0.3 + 0.7 * on)
        set.pool.opacity = 0.55 * on
        set.halo.opacity = 0.7 * on
    })
    const cars = clamp01((mix - VEHICLE_LIGHTS_AT) / LAMP_FADE)
    vehicleLampMaterial.visible = beamMaterial.visible = tailGlowMaterial.visible = cars > 0
    vehicleLampMaterial.color.setScalar(0.4 + 0.6 * cars)
    beamMaterial.opacity = 0.42 * cars
    tailGlowMaterial.opacity = 0.55 * cars
}

// ─── Vehicles ────────────────────────────────────────────────────────────────
// Head and tail lamps over the painted ones, a pool of headlight on the road
// ahead and a red glow behind. Coordinates are the vehicle's own modelling
// units (nose at +z, wheels on y = 0), before its group scale.

const HEAD = new THREE.Color(0xfff6dc)
const TAIL = new THREE.Color(0xff2a1a)
const VEHICLE_LAMPS = {
    car: { x: 0.09, y: 0.105, front: 0.286, back: -0.286, w: 0.062, h: 0.032 },
    truck: { x: 0.1, y: 0.11, front: 0.437, back: -0.452, w: 0.062, h: 0.042 }
} as const
const vehicleLampGeos = new Map<string, THREE.BufferGeometry>()

function vehicleLampGeo(kind: 'car' | 'truck') {
    let geo = vehicleLampGeos.get(kind)
    if (!geo) {
        const l = VEHICLE_LAMPS[kind]
        const parts: THREE.BufferGeometry[] = []
        for (const x of [-l.x, l.x]) {
            parts.push(painted(new THREE.BoxGeometry(l.w, l.h, 0.01).translate(x, l.y, l.front), HEAD))
            parts.push(painted(new THREE.BoxGeometry(l.w, l.h * 0.85, 0.01).translate(kind === 'truck' ? x * 1.1 : x, l.y - 0.005, l.back), TAIL))
        }
        geo = mergeGeometries(parts)!
        parts.forEach(p => p.dispose())
        vehicleLampGeos.set(kind, geo)
    }
    return geo
}

/** Give a vehicle model its night lights. Shared geometry and materials: nothing to free. */
export function addTownVehicleLights(group: THREE.Group, kind: 'car' | 'truck'): void {
    if (group.getObjectByName('nightlamp')) return
    glowTexture()
    const l = VEHICLE_LAMPS[kind]
    const geo = geometries()
    const lights = new THREE.Group()
    lights.name = 'nightlamp'
    const lamps = new THREE.Mesh(vehicleLampGeo(kind), vehicleLampMaterial)
    const beam = new THREE.Mesh(geo.pool, beamMaterial)
    beam.position.set(0, 0.012, l.front + 0.3)
    beam.scale.set(0.5, 1, 0.85)
    const tail = new THREE.Mesh(geo.pool, tailGlowMaterial)
    tail.position.set(0, 0.012, l.back - 0.1)
    tail.scale.set(0.42, 1, 0.3)
    for (const o of [lamps, beam, tail]) {
        o.castShadow = false
        o.receiveShadow = false
        o.raycast = () => {}
        lights.add(o)
    }
    group.add(lights)
}

/** A dome of stars, drawn past the fog. Follows the camera's focus. */
export function createStarfield(): THREE.Points {
    const count = 700
    const positions = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    let seed = 1
    const rand = () => {
        // Cosmetic and repeatable: the same sky every visit.
        seed = (seed * 16807) % 2147483647
        return seed / 2147483647
    }
    for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2
        const el = 0.04 + Math.pow(rand(), 0.8) * 1.3
        const r = 190
        positions[i * 3] = Math.cos(a) * Math.cos(el) * r
        positions[i * 3 + 1] = Math.sin(el) * r
        positions[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r
        sizes[i] = rand()
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
        color: 0xdfe8ff,
        size: 1.6,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        fog: false,
        depthWrite: false,
        toneMapped: false,
        visible: false
    })
    const stars = new THREE.Points(geo, mat)
    stars.raycast = () => {}
    stars.frustumCulled = false
    return stars
}

/** A pale moon with a soft halo, far out in the sky. */
export function createMoon(): THREE.Group {
    glowTexture()
    const g = new THREE.Group()
    const disc = new THREE.Mesh(
        new THREE.CircleGeometry(5, 32),
        new THREE.MeshBasicMaterial({ color: 0xf4f1e2, fog: false, toneMapped: false, transparent: true, opacity: 0, visible: false })
    )
    const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(34, 34),
        new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x8fa6d8, fog: false, toneMapped: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, visible: false })
    )
    glow.position.z = -0.1
    g.add(glow, disc)
    g.traverse((o) => { o.raycast = () => {} })
    return g
}

export function disposeTownNight(): void {
    poolTexture?.dispose()
    poolTexture = null
    for (const set of lampSets) set.pool.map = set.halo.map = null
    beamMaterial.map = tailGlowMaterial.map = null
}
