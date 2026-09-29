// Call of Xeno — level dressing meshes.
//
// Every builder returns a THREE.Group in its own local space (origin on the
// floor, centred on its footprint) made of MeshStandardMaterial parts that share
// a small pool of cached PBR materials. UVs are baked in metres, so the level
// can flatten a group into its per-material batches (Batch.addGroup) and the
// texture still tiles at the right scale. Standalone use (the explosive barrel
// the game spawns) works the same way: the group is just added to the scene.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bakeUV, scaleUV } from './level-kit'
import {
    makeRng,
    makeSignTexture,
    makeStencilAtlas,
    makeSurface,
    stencilRect,
    STENCIL,
    type SurfaceKind
} from './textures'

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface MatOpts {
    color?: number | string
    base?: string | number
    accent?: string | number
    seed?: number
    metalness?: number
    roughness?: number
    normalScale?: number
    side?: THREE.Side
    tile?: number
    emissive?: number
    transparent?: boolean
    opacity?: number
    envMapIntensity?: number
}

const matCache = new Map<string, THREE.Material>()

/** A cached PBR material for a procedural surface kind, tinted by `color`. */
export function surfaceMat(kind: SurfaceKind, o: MatOpts = {}): THREE.MeshStandardMaterial {
    const key = `${kind}:${JSON.stringify(o)}`
    const cached = matCache.get(key)
    if (cached) return cached as THREE.MeshStandardMaterial
    const set = makeSurface(kind, { base: o.base, accent: o.accent, seed: o.seed })
    const ns = o.normalScale ?? 1
    const m = new THREE.MeshStandardMaterial({
        map: set.map,
        roughnessMap: set.roughnessMap,
        normalMap: set.normalMap,
        normalScale: new THREE.Vector2(ns, ns),
        color: o.color ?? 0xffffff,
        roughness: o.roughness ?? 1,
        metalness: o.metalness ?? 0,
        side: o.side ?? THREE.FrontSide,
        transparent: o.transparent ?? false,
        opacity: o.opacity ?? 1
    })
    if (o.transparent) m.depthWrite = false
    if (o.envMapIntensity !== undefined) m.envMapIntensity = o.envMapIntensity
    if (o.emissive !== undefined && set.emissiveMap) {
        m.emissive.set(0xffffff)
        m.emissiveMap = set.emissiveMap
        m.emissiveIntensity = o.emissive
    }
    m.userData.tile = o.tile ?? set.tile
    matCache.set(key, m)
    return m
}

/** Painted, slightly worn sheet steel in `color`. */
export function paintMat(color: number, metalness = 0.3, roughness = 1) {
    return surfaceMat('paint', { color, metalness, roughness })
}

/** A flat untextured PBR material. */
export function plainMat(color: number, roughness = 0.7, metalness = 0, side: THREE.Side = THREE.FrontSide) {
    const key = `plain:${color}:${roughness}:${metalness}:${side}`
    const cached = matCache.get(key)
    if (cached) return cached as THREE.MeshStandardMaterial
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, side })
    m.userData.tile = 1
    matCache.set(key, m)
    return m
}

/** An unlit emissive colour — lamps, LEDs, screens. */
export function glowMat(color: number, side: THREE.Side = THREE.FrontSide) {
    const key = `glow:${color}:${side}`
    const cached = matCache.get(key)
    if (cached) return cached as THREE.MeshBasicMaterial
    const m = new THREE.MeshBasicMaterial({ color, side })
    m.userData.tile = 1
    matCache.set(key, m)
    return m
}

/** Stencils and stickers: an alpha-cut atlas laid over a surface. */
export function stencilMat() {
    const key = 'stencil'
    const cached = matCache.get(key)
    if (cached) return cached as THREE.MeshStandardMaterial
    const m = new THREE.MeshStandardMaterial({
        map: makeStencilAtlas(),
        alphaTest: 0.35,
        roughness: 0.75,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
    })
    m.userData.tile = 1
    matCache.set(key, m)
    return m
}

export function glassMat() {
    const key = 'glass'
    const cached = matCache.get(key)
    if (cached) return cached as THREE.MeshStandardMaterial
    const m = new THREE.MeshStandardMaterial({
        color: 0x8fb4bf,
        roughness: 0.08,
        metalness: 0.2,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false
    })
    m.userData.tile = 1
    matCache.set(key, m)
    return m
}

const M = {
    plate: () => surfaceMat('diamond', { metalness: 0.55 }),
    grate: () => surfaceMat('grating', { metalness: 0.5 }),
    wood: () => surfaceMat('plank', { color: 0xd8cbb8 }),
    palletWood: () => surfaceMat('plank', { color: 0xf0d9b0, tile: 1.2 }),
    card: () => surfaceMat('cardboard', { normalScale: 0.6 }),
    wrap: () => surfaceMat('wrap', { color: 0xdfe8ea, transparent: true, opacity: 0.55, roughness: 0.7 }),
    hazard: () => surfaceMat('hazard', { tile: 0.8 }),
    rubber: () => surfaceMat('rubber', { roughness: 1 }),
    corrugated: (color: number) => surfaceMat('corrugated', { color, metalness: 0.4 }),
    concrete: (color = 0xb7b7b0) => surfaceMat('concrete', { color, tile: 3 }),
    steel: () => paintMat(0x8b9198, 0.55),
    darkSteel: () => paintMat(0x3a3e43, 0.5),
    black: () => plainMat(0x141516, 0.6, 0.3),
    rust: () => paintMat(0x7a4a2e, 0.35),
    blue: () => paintMat(0x1f5aa6, 0.3),
    orange: () => paintMat(0xdd6a1c, 0.3),
    yellow: () => paintMat(0xd6aa1e, 0.3),
    red: () => paintMat(0xa8281d, 0.3),
    ledRed: () => glowMat(0xff3a2a),
    ledGreen: () => glowMat(0x39ff8a),
    ledAmber: () => glowMat(0xffa62a),
    screen: () => glowMat(0x37e6b0)
}

// ---------------------------------------------------------------------------
// Part helpers
// ---------------------------------------------------------------------------

const _e = new THREE.Euler()
const _q = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)

function xf(geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    if (rx === 0 && ry === 0 && rz === 0) {
        geo.translate(x, y, z)
        return geo
    }
    _e.set(rx, ry, rz, 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(x, y, z), _q, _s)
    geo.applyMatrix4(_m)
    return geo
}

/** Places a fresh geometry (bakes metre UVs unless it carries its own) as a mesh. */
export function put(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, bake = true) {
    xf(geo, x, y, z, ry, rx, rz)
    if (bake) bakeUV(geo, (mat.userData.tile as number | undefined) ?? 1)
    return new THREE.Mesh(geo, mat)
}

/** A box part centred at (x, y, z). */
export function boxPart(g: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    const mesh = put(new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry, rx, rz)
    g.add(mesh)
    return mesh
}

/** Box with all twelve edges chamfered by `c`. Non-indexed; the batcher indexes it. */
export function chamferGeo(w: number, h: number, d: number, c: number) {
    const k = Math.max(0.002, Math.min(c, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))
    const shape = new THREE.Shape()
    const hw = w / 2 - k
    const hh = h / 2 - k
    shape.moveTo(-hw, -hh)
    shape.lineTo(hw, -hh)
    shape.lineTo(hw, hh)
    shape.lineTo(-hw, hh)
    shape.closePath()
    const depth = Math.max(0.002, d - 2 * k)
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelThickness: k,
        bevelSize: k,
        bevelSegments: 1,
        curveSegments: 1
    })
    geo.translate(0, 0, -depth / 2)
    return geo
}

export function chamferPart(g: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, c: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    const mesh = put(chamferGeo(w, h, d, c), mat, x, y, z, ry, rx, rz)
    g.add(mesh)
    return mesh
}

function cylGeo(rt: number, rb: number, h: number, seg: number, tile: number, open = false) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)
    scaleUV(geo, (Math.PI * 2 * Math.max(rt, rb)) / tile, h / tile)
    return geo
}

/** A cylinder along Y (or, with rx/rz, any axis) with its own wrapped UVs. */
export function cylPart(g: THREE.Object3D, mat: THREE.Material, rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, open = false) {
    const tile = (mat.userData.tile as number | undefined) ?? 1
    const mesh = put(cylGeo(rt, rb, h, seg, tile, open), mat, x, y, z, ry, rx, rz, false)
    g.add(mesh)
    return mesh
}

/** A cylinder running along X. */
function cylX(g: THREE.Object3D, mat: THREE.Material, r: number, len: number, seg: number, x: number, y: number, z: number) {
    return cylPart(g, mat, r, r, len, seg, x, y, z, 0, 0, Math.PI / 2)
}

/** A cylinder running along Z. */
function cylZ(g: THREE.Object3D, mat: THREE.Material, r: number, len: number, seg: number, x: number, y: number, z: number) {
    return cylPart(g, mat, r, r, len, seg, x, y, z, 0, Math.PI / 2, 0)
}

function torusPart(g: THREE.Object3D, mat: THREE.Material, r: number, tube: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, arc = Math.PI * 2, seg = 12) {
    const geo = new THREE.TorusGeometry(r, tube, 5, seg, arc)
    const mesh = put(geo, mat, x, y, z, ry, rx, rz, false)
    g.add(mesh)
    return mesh
}

/** A sticker quad sampling an atlas cell. Faces +Z before the yaw / pitch. */
function decalGeo(w: number, h: number, rect: [number, number, number, number]) {
    const geo = new THREE.PlaneGeometry(w, h)
    const uv = geo.attributes.uv!
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, rect[0] + (rect[2] - rect[0]) * uv.getX(i), rect[1] + (rect[3] - rect[1]) * uv.getY(i))
    }
    return geo
}

export function stencilPart(g: THREE.Object3D, cell: number, w: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0) {
    const mesh = put(decalGeo(w, h, stencilRect(cell)), stencilMat(), x, y, z, ry, rx, 0, false)
    g.add(mesh)
    return mesh
}

/** Per-vertex colour, for parts that must carry no texture of their own. */
function tint(geo: THREE.BufferGeometry, color: number) {
    const c = new THREE.Color(color)
    const n = geo.attributes.position!.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    return geo
}

function hashSeed(a: number, b: number, c: number) {
    return Math.abs(Math.floor(a * 73.1 + b * 19.7 + c * 41.3) * 2654435761) >>> 0
}

/** Rotates a group built along +X so its long axis follows the box's longer side. */
function alongLong(width: number, depth: number) {
    const inner = new THREE.Group()
    if (depth > width) inner.rotation.y = Math.PI / 2
    return inner
}

// ---------------------------------------------------------------------------
// Crates, barriers, drums
// ---------------------------------------------------------------------------

export function buildCrate(width: number, height: number, depth: number, tint: number): THREE.Group {
    const group = new THREE.Group()
    const wood = M.wood()
    const frame = paintMat(0x4d3d2c, 0.05)
    const seed = hashSeed(width, height, depth)
    // Slats: the body, slightly inset, with a batten frame proud of it.
    boxPart(group, wood, width - 0.05, height - 0.06, depth - 0.05, 0, height / 2, 0)
    const post = 0.1
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            boxPart(group, frame, post, height, post, sx * (width / 2 - post / 2), height / 2, sz * (depth / 2 - post / 2))
        }
    }
    for (const y of [0.09, height - 0.09]) {
        boxPart(group, frame, width, 0.13, depth, 0, y, 0)
    }
    if (height > 0.9) boxPart(group, frame, width + 0.02, 0.09, depth + 0.02, 0, height * 0.5, 0)
    // Diagonal braces on the two long faces.
    const long = width >= depth
    const span = long ? width : depth
    const angle = Math.atan2(height - 0.3, span - 0.2)
    const len = Math.hypot(span - 0.2, height - 0.3)
    for (const s of [-1, 1]) {
        if (long) boxPart(group, frame, len, 0.08, 0.05, 0, height / 2, s * (depth / 2), 0, 0, angle * s)
        else boxPart(group, frame, 0.05, 0.08, len, s * (width / 2), height / 2, 0, 0, angle * s, 0)
    }
    // Painted lid edge and a stencil.
    boxPart(group, paintMat(tint, 0.2), width + 0.03, 0.05, depth + 0.03, 0, height - 0.005, 0)
    const cells = [STENCIL.fragile, STENCIL.arrows, STENCIL.care, STENCIL.depot]
    const cell = cells[seed % cells.length]!
    const sw = Math.min(0.7, (long ? width : depth) * 0.6)
    if (long) stencilPart(group, cell, sw, sw, 0, height * 0.55, depth / 2 + 0.006)
    else stencilPart(group, cell, sw, sw, width / 2 + 0.006, height * 0.55, 0, Math.PI / 2)
    return group
}

/** A stack of cardboard cartons filling the footprint up to `height`. */
export function buildCardboardStack(width: number, height: number, depth: number, seed = 1): THREE.Group {
    const group = new THREE.Group()
    const rand = makeRng(hashSeed(width, height, depth) + seed)
    const card = M.card()
    const tape = paintMat(0xb6a487, 0)
    const nx = Math.max(1, Math.round(width / 0.62))
    const nz = Math.max(1, Math.round(depth / 0.62))
    const layers = Math.max(1, Math.round(height / 0.42))
    const bw = width / nx
    const bd = depth / nz
    const bh = height / layers
    for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
            // The stack tapers a little as it climbs, the way a hurried one does.
            const top = layers - Math.floor(rand() * 2)
            for (let l = 0; l < layers; l++) {
                if (l >= top) continue
                const jw = bw * (0.94 - rand() * 0.04)
                const jd = bd * (0.94 - rand() * 0.04)
                const x = -width / 2 + bw * (ix + 0.5) + (rand() - 0.5) * 0.03
                const z = -depth / 2 + bd * (iz + 0.5) + (rand() - 0.5) * 0.03
                const y = bh * (l + 0.5)
                boxPart(group, card, jw, bh * 0.97, jd, x, y, z, (rand() - 0.5) * 0.08)
                if (rand() < 0.4) boxPart(group, tape, jw + 0.004, 0.005, 0.06, x, y + bh * 0.487, z, (rand() - 0.5) * 0.08)
            }
        }
    }
    // A slab across the top so the collision box reads as one load.
    if (rand() < 0.5) boxPart(group, M.wrap(), width * 0.98, 0.02, depth * 0.98, 0, height + 0.005, 0)
    return group
}

/** Waist-high hazard-striped barrier — the low cover. */
export function buildBarrier(width: number, height: number, depth: number, tint: number, _hazard?: THREE.Texture): THREE.Group {
    const group = new THREE.Group()
    const concrete = M.concrete(0xc4c2b8)
    const hazard = M.hazard()
    const cap = paintMat(0x2a2c2e, 0.4)
    const trim = paintMat(tint, 0.2)
    const long = width >= depth
    const lowH = height * 0.62
    // Jersey profile: a wide chamfered foot, then a narrower upright body.
    chamferPart(group, concrete, width, lowH, depth, 0.07, 0, lowH / 2, 0)
    const bandH = height - lowH - 0.06
    const inset = 0.05
    chamferPart(group, hazard, width - inset, bandH, depth - inset, 0.03, 0, lowH + bandH / 2 - 0.005, 0)
    chamferPart(group, cap, width + 0.02, 0.07, depth + 0.02, 0.02, 0, height - 0.035, 0)
    // Steel end brackets and forklift pockets.
    const n = Math.max(1, Math.round((long ? width : depth) / 1.8))
    for (let i = 0; i < n; i++) {
        const t = -0.5 + (i + 0.5) / n
        const off = t * (long ? width : depth)
        const dx = long ? off : 0
        const dz = long ? 0 : off
        if (long) {
            boxPart(group, trim, 0.05, height * 0.9, depth + 0.02, dx + 0.18, height * 0.45, dz)
            boxPart(group, M.black(), 0.4, 0.09, depth + 0.03, dx, 0.16, dz)
        } else {
            boxPart(group, trim, width + 0.02, height * 0.9, 0.05, dx, height * 0.45, dz + 0.18)
            boxPart(group, M.black(), width + 0.03, 0.09, 0.4, dx, 0.16, dz)
        }
    }
    return group
}

/** Decorative fuel drum, parked in the corner of a crate's footprint. */
export function buildBarrel(color: number): THREE.Group {
    const group = new THREE.Group()
    const shell = paintMat(color, 0.55)
    const ring = paintMat(0x2a2c2b, 0.5)
    cylPart(group, shell, 0.29, 0.29, 0.9, 16, 0, 0.5, 0)
    for (const y of [0.22, 0.5, 0.78]) cylPart(group, ring, 0.305, 0.305, 0.05, 16, 0, y, 0)
    cylPart(group, ring, 0.31, 0.31, 0.05, 16, 0, 0.955, 0)
    cylPart(group, ring, 0.31, 0.31, 0.06, 16, 0, 0.055, 0)
    cylPart(group, paintMat(0x555a5e, 0.6), 0.26, 0.26, 0.02, 16, 0, 0.955, 0)
    cylPart(group, M.black(), 0.045, 0.045, 0.04, 8, 0.12, 0.985, 0.05)
    cylPart(group, M.black(), 0.03, 0.03, 0.03, 8, -0.1, 0.98, -0.08)
    return group
}

/**
 * Shootable explosive barrel: red shell, warning band, lit valve on top.
 * The game disposes this group's materials when it detonates, so every part
 * uses its own throwaway material and no albedo map (only `map` is disposed
 * with a mesh; the shared normal / roughness maps must survive).
 */
export function buildExplosiveBarrel(): THREE.Group {
    const group = new THREE.Group()
    const set = makeSurface('paint')
    const own = (metalness: number) => {
        const m = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughnessMap: set.roughnessMap,
            normalMap: set.normalMap,
            roughness: 0.85,
            metalness,
            normalScale: new THREE.Vector2(0.7, 0.7)
        })
        m.userData.tile = 1
        return m
    }
    const body = own(0.45)
    const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0) => {
        tint(geo, color)
        const mesh = put(geo, body, x, y, z, 0, rx, 0, false)
        group.add(mesh)
        return mesh
    }
    const cyl = (rt: number, rb: number, h: number, seg = 16) => {
        const g = new THREE.CylinderGeometry(rt, rb, h, seg)
        return scaleUV(g, Math.PI * 2 * Math.max(rt, rb), h)
    }
    add(cyl(0.3, 0.3, 0.98), 0xa9291b, 0, 0.53, 0)
    for (const y of [0.16, 0.36, 0.7, 0.9]) add(cyl(0.312, 0.312, 0.045), 0x6e1a12, 0, y, 0)
    add(cyl(0.312, 0.312, 0.05), 0x1e1f1f, 0, 0.045, 0)
    add(cyl(0.312, 0.312, 0.055), 0x1e1f1f, 0, 1.0, 0)
    // Hazard band round the middle: yellow with black chevron blocks.
    add(cyl(0.318, 0.318, 0.17), 0xd9a92a, 0, 0.53, 0)
    for (let i = 0; i < 8; i++) {
        const g = new THREE.BoxGeometry(0.1, 0.17, 0.02)
        const a = (i / 8) * Math.PI * 2
        tint(g, 0x18160f)
        const m = put(g, body, Math.sin(a) * 0.319, 0.53, Math.cos(a) * 0.319, a, 0, 0, false)
        group.add(m)
    }
    add(cyl(0.26, 0.26, 0.02), 0x4b4e50, 0, 1.03, 0)
    const valve = new THREE.TorusGeometry(0.1, 0.028, 6, 12)
    add(valve, 0xd9a02a, 0.04, 1.09, 0.02, Math.PI / 2)
    add(cyl(0.03, 0.03, 0.1, 8), 0x2b2d2f, 0.04, 1.06, 0.02)
    // A small live indicator so the barrel reads as charged in the dark.
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.05), new THREE.MeshBasicMaterial({ color: 0xff5a1c }))
    led.position.set(-0.12, 1.045, 0.08)
    group.add(led)
    return group
}

// ---------------------------------------------------------------------------
// Structure: columns, machines, containers, trucks
// ---------------------------------------------------------------------------

/** Structural column: painted concrete with a hazard-wrapped guard and steel base. */
export function buildPillar(height: number, accent: number): THREE.Group {
    const group = new THREE.Group()
    const w = 0.78
    const paint = paintMat(0x8b8c86, 0.05)
    const steel = M.darkSteel()
    chamferPart(group, paint, w, height - 0.5, w, 0.05, 0, (height - 0.5) / 2 + 0.25, 0)
    // Base plate on grout, with anchor bolts.
    boxPart(group, steel, 1.08, 0.06, 1.08, 0, 0.03, 0)
    chamferPart(group, M.concrete(0x8d8c86), 0.94, 0.18, 0.94, 0.03, 0, 0.15, 0)
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            cylPart(group, plainMat(0x777b7f, 0.5, 0.6), 0.03, 0.03, 0.09, 6, sx * 0.47, 0.11, sz * 0.47)
        }
    }
    // Capital where the column meets the deck or roof.
    chamferPart(group, steel, 1.0, 0.2, 1.0, 0.03, 0, height - 0.1, 0)
    // Guard: hazard wrap round the bottom metre, and a painted safety band above.
    chamferPart(group, M.hazard(), w + 0.04, 1.0, w + 0.04, 0.02, 0, 0.75, 0)
    boxPart(group, paintMat(accent, 0.1), w + 0.03, 0.12, w + 0.03, 0, height * 0.55, 0)
    // Column number plate.
    stencilPart(group, STENCIL.box, 0.32, 0.32, 0, 1.75, w / 2 + 0.006)
    stencilPart(group, STENCIL.box, 0.32, 0.32, 0, 1.75, -w / 2 - 0.006, Math.PI)
    return group
}

/** A cabinet / bench housing, sized to fill its collision footprint. */
export function buildMachine(width: number, height: number, depth: number, accent: number): THREE.Group {
    const group = new THREE.Group()
    const body = paintMat(0x59626a, 0.35)
    const dark = M.darkSteel()
    const trim = paintMat(accent, 0.2)
    // Plinth and main housing.
    chamferPart(group, dark, width, 0.3, depth, 0.03, 0, 0.15, 0)
    chamferPart(group, body, width * 0.94, height * 0.62, depth * 0.94, 0.04, 0, 0.3 + height * 0.31, 0)
    chamferPart(group, M.steel(), width * 0.96, height * 0.06, depth * 0.96, 0.02, 0, 0.3 + height * 0.65, 0)
    const front = depth / 2 * 0.94
    // Louvre bank on the front face.
    const louvres = Math.max(4, Math.floor(height * 4))
    for (let i = 0; i < louvres; i++) {
        boxPart(group, M.black(), width * 0.5, 0.035, 0.03, -width * 0.2, 0.55 + i * 0.09, front + 0.005, 0, -0.35)
    }
    // Control panel: two screens, a row of LEDs and a big red stop.
    const px = width * 0.3
    boxPart(group, M.black(), width * 0.28, height * 0.22, 0.04, px, height * 0.62, front + 0.01)
    boxPart(group, M.screen(), width * 0.22, height * 0.09, 0.012, px, height * 0.66, front + 0.036)
    for (let i = 0; i < 5; i++) {
        boxPart(group, i % 3 === 0 ? M.ledRed() : i % 3 === 1 ? M.ledGreen() : M.ledAmber(), 0.03, 0.03, 0.012, px - 0.1 + i * 0.05, height * 0.56, front + 0.034)
    }
    cylPart(group, M.red(), 0.035, 0.035, 0.03, 10, px + 0.16, height * 0.56, front + 0.035, 0, Math.PI / 2, 0)
    // Access door seam and handle.
    boxPart(group, M.black(), 0.012, height * 0.5, 0.01, -width * 0.02, 0.3 + height * 0.3, front + 0.003)
    boxPart(group, M.steel(), 0.04, 0.16, 0.05, -width * 0.06, 0.3 + height * 0.3, front + 0.03)
    // Exhaust stack with a rain cap and a heat wrap.
    const sx = width * 0.3
    cylPart(group, M.steel(), 0.085, 0.085, height * 0.4, 10, sx, height * 0.95 - 0.1, -depth * 0.2)
    cylPart(group, M.rust(), 0.1, 0.1, 0.4, 10, sx, height * 0.8, -depth * 0.2)
    cylPart(group, M.darkSteel(), 0.13, 0.02, 0.07, 10, sx, height * 1.0 - 0.1, -depth * 0.2)
    // Status light stack.
    cylPart(group, M.ledRed(), 0.04, 0.04, 0.07, 8, -width * 0.36, 0.3 + height * 0.62 + 0.09, -depth * 0.25)
    cylPart(group, M.ledAmber(), 0.04, 0.04, 0.07, 8, -width * 0.36, 0.3 + height * 0.62 + 0.16, -depth * 0.25)
    cylPart(group, M.darkSteel(), 0.045, 0.045, 0.05, 8, -width * 0.36, 0.3 + height * 0.62 + 0.04, -depth * 0.25)
    // Conduit and a hazard diamond on the side.
    cylPart(group, dark, 0.03, 0.03, height * 0.5, 6, width * 0.47, 0.3 + height * 0.3, front * 0.6)
    stencilPart(group, STENCIL.hazardDiamond, 0.34, 0.34, width * 0.475 + 0.006, height * 0.5, 0, Math.PI / 2)
    return group
}

/** A steel shipping container, corrugated sides and locking doors on one end. */
export function buildContainer(width: number, height: number, depth: number, tint: number): THREE.Group {
    const group = new THREE.Group()
    const inner = alongLong(width, depth)
    group.add(inner)
    const L = Math.max(width, depth)
    const W = Math.min(width, depth)
    const skin = M.corrugated(tint)
    const flat = paintMat(tint, 0.35)
    const frame = paintMat(0x2c2f30, 0.5)
    const h = height
    // Long side panels (corrugated), roof, floor and the two flat ends.
    for (const s of [-1, 1]) {
        boxPart(inner, skin, L - 0.2, h - 0.2, 0.05, 0, h / 2, s * (W / 2 - 0.03))
    }
    boxPart(inner, flat, L, 0.06, W, 0, h - 0.03, 0)
    boxPart(inner, frame, L, 0.16, W, 0, 0.1, 0)
    for (const s of [-1, 1]) {
        boxPart(inner, skin, 0.05, h - 0.2, W - 0.16, s * (L / 2 - 0.03), h / 2, 0, Math.PI / 2)
    }
    // Rails top and bottom, and the eight corner castings.
    for (const y of [0.1, h - 0.06]) {
        for (const s of [-1, 1]) {
            boxPart(inner, frame, L, 0.14, 0.14, 0, y, s * (W / 2 - 0.07))
        }
    }
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            boxPart(inner, frame, 0.16, h, 0.16, sx * (L / 2 - 0.08), h / 2, sz * (W / 2 - 0.08))
            boxPart(inner, plainMat(0x1a1c1d, 0.4, 0.6), 0.2, 0.18, 0.2, sx * (L / 2 - 0.1), h - 0.09, sz * (W / 2 - 0.1))
        }
    }
    // Locking rods and cam handles across the door end (+X).
    const doorX = L / 2 + 0.005
    for (const zz of [-0.36, -0.12, 0.12, 0.36].map(v => v * W / 2.4)) {
        cylPart(inner, plainMat(0x8f9298, 0.4, 0.8), 0.018, 0.018, h - 0.4, 6, doorX + 0.03, h / 2, zz)
        boxPart(inner, frame, 0.04, 0.16, 0.07, doorX + 0.05, h * 0.5, zz)
    }
    boxPart(inner, frame, 0.03, h - 0.3, 0.02, doorX + 0.02, h / 2, 0)
    // Stencilled ID on the long side.
    stencilPart(inner, STENCIL.depot, 1.2, 0.6, -L * 0.3, h * 0.72, W / 2 + 0.03)
    stencilPart(inner, STENCIL.barcode, 0.5, 0.5, L * 0.3, h * 0.62, W / 2 + 0.03)
    stencilPart(inner, STENCIL.depot, 1.2, 0.6, L * 0.3, h * 0.72, -W / 2 - 0.03, Math.PI)
    return group
}

/** A dead flatbed truck, filling its collision footprint (cab at the −length end). */
export function buildTruck(width: number, height: number, depth: number, tint: number): THREE.Group {
    const group = new THREE.Group()
    const inner = new THREE.Group()
    group.add(inner)
    // Build along +Z with the cab at -Z; turn it when the box runs along X.
    if (width > depth) inner.rotation.y = -Math.PI / 2
    const W = Math.min(width, depth)
    const L = Math.max(width, depth)
    const body = paintMat(0x4a5a54, 0.35)
    const cabPaint = paintMat(tint, 0.35)
    const chassis = M.darkSteel()
    const tyre = M.rubber()
    const cabL = L * 0.3
    const bedL = L - cabL - 0.15
    const bedZ = L / 2 - bedL / 2
    const cabZ = -L / 2 + cabL / 2
    // Chassis rails, axles and fuel tank.
    for (const s of [-1, 1]) boxPart(inner, chassis, 0.14, 0.26, L * 0.96, s * W * 0.3, 0.7, 0)
    for (const zz of [-L * 0.34, L * 0.18, L * 0.34]) boxPart(inner, chassis, W * 0.86, 0.12, 0.14, 0, 0.62, zz)
    cylPart(inner, plainMat(0x6b6f72, 0.4, 0.7), 0.24, 0.24, 0.6, 12, W * 0.34, 0.66, -L * 0.05, 0, 0, Math.PI / 2)
    // Flatbed: deck plate, side boards, headboard.
    boxPart(inner, M.plate(), W * 0.94, 0.09, bedL, 0, 0.98, bedZ)
    for (const s of [-1, 1]) {
        boxPart(inner, body, 0.07, 0.42, bedL, s * (W * 0.47 - 0.035), 1.25, bedZ)
        boxPart(inner, chassis, 0.09, 0.05, bedL + 0.02, s * (W * 0.47 - 0.035), 1.48, bedZ)
    }
    boxPart(inner, body, W * 0.94, 0.42, 0.07, 0, 1.25, L / 2 - 0.13)
    boxPart(inner, body, W * 0.94, 1.1, 0.1, 0, 1.6, bedZ - bedL / 2 + 0.08)
    // Cab: a lower shell, a glazed upper and a roof visor.
    chamferPart(inner, cabPaint, W * 0.9, 1.1, cabL, 0.08, 0, 1.4, cabZ)
    chamferPart(inner, cabPaint, W * 0.84, 0.74, cabL * 0.86, 0.06, 0, 2.28, cabZ + cabL * 0.04)
    boxPart(inner, glassMat(), W * 0.8, 0.5, 0.03, 0, 2.3, cabZ - cabL * 0.4 - 0.02)
    boxPart(inner, plainMat(0x0c1214, 0.1, 0.4), W * 0.86, 0.36, 0.02, 0, 2.3, cabZ - cabL * 0.4 - 0.005)
    for (const s of [-1, 1]) boxPart(inner, glassMat(), 0.03, 0.4, cabL * 0.5, s * (W * 0.42 + 0.005), 2.3, cabZ + cabL * 0.06)
    // Bonnet grille, headlamps and bumper.
    boxPart(inner, M.black(), W * 0.6, 0.5, 0.05, 0, 1.15, -L / 2 - 0.01)
    for (const s of [-1, 1]) boxPart(inner, glowMat(0xf3e2b0), 0.22, 0.16, 0.04, s * W * 0.34, 1.22, -L / 2 - 0.02)
    boxPart(inner, chassis, W * 0.94, 0.18, 0.2, 0, 0.6, -L / 2 - 0.05)
    // Wheels: tyre, rim and hub, front axle single and rear axle doubled.
    const wheel = (zz: number, side: number) => {
        const x = side * (W * 0.5 - 0.1)
        cylPart(inner, tyre, 0.52, 0.52, 0.34, 16, x, 0.52, zz, 0, 0, Math.PI / 2)
        cylPart(inner, plainMat(0x7c8085, 0.4, 0.8), 0.3, 0.3, 0.36, 12, x, 0.52, zz, 0, 0, Math.PI / 2)
        cylPart(inner, M.darkSteel(), 0.12, 0.12, 0.4, 8, x, 0.52, zz, 0, 0, Math.PI / 2)
    }
    for (const s of [-1, 1]) {
        wheel(-L * 0.34, s)
        wheel(L * 0.18, s)
        wheel(L * 0.34, s)
    }
    // Mudflaps and a rust-through patch of hazard tape on the tailgate.
    boxPart(inner, M.hazard(), W * 0.9, 0.12, 0.03, 0, 1.0, L / 2 + 0.005)
    void height
    return group
}

/** Wall-hugging pipe run (local X) with flanges, brackets and one valve wheel. */
export function buildPipesRun(length: number, accent: number): THREE.Group {
    const group = new THREE.Group()
    const pipe = paintMat(0x6f757b, 0.55)
    const lag = paintMat(0xa79f8c, 0.05)
    const dark = M.darkSteel()
    cylX(group, pipe, 0.09, length, 10, 0, 0, 0)
    cylX(group, lag, 0.07, length, 8, 0, 0.34, 0)
    cylX(group, paintMat(0x2f5f7a, 0.4), 0.045, length, 8, 0, 0.2, 0.15)
    const brackets = Math.max(2, Math.round(length / 2.4))
    for (let i = 0; i <= brackets; i++) {
        const x = -length / 2 + (length / brackets) * i
        boxPart(group, dark, 0.06, 0.6, 0.1, x, 0.18, -0.04)
        torusPart(group, dark, 0.1, 0.018, x, 0, 0, Math.PI / 2, 0, 0, Math.PI * 2, 10)
    }
    // Flanged joints and bolts.
    const joints = Math.max(1, Math.round(length / 4))
    for (let i = 0; i < joints; i++) {
        const x = -length / 2 + (length / joints) * (i + 0.5)
        cylX(group, dark, 0.125, 0.05, 10, x, 0, 0)
        cylX(group, dark, 0.1, 0.05, 8, x + 0.03, 0.34, 0)
    }
    // Valve: body, stem and a handwheel in the room's accent.
    const vx = -length * 0.3
    boxPart(group, dark, 0.14, 0.22, 0.14, vx, 0, 0)
    cylPart(group, dark, 0.02, 0.02, 0.26, 6, vx, 0.2, 0)
    torusPart(group, paintMat(accent === 0 ? 0xa03a22 : accent, 0.3), 0.11, 0.018, vx, 0.32, 0, 0, Math.PI / 2, 0, Math.PI * 2, 12)
    return group
}

// ---------------------------------------------------------------------------
// Lighting hardware
// ---------------------------------------------------------------------------

/** Batten light: housing then tube (children[0], children[1]) — the tube is the flicker target. */
export function buildCeilingLight(color: number, height: number): THREE.Group {
    const group = new THREE.Group()
    const housing = new THREE.Group()
    const dark = paintMat(0x25282b, 0.4)
    boxPart(housing, dark, 2.5, 0.09, 0.42, 0, height - 0.06, 0)
    boxPart(housing, dark, 2.6, 0.03, 0.06, 0, height - 0.13, 0.2)
    boxPart(housing, dark, 2.6, 0.03, 0.06, 0, height - 0.13, -0.2)
    for (const s of [-1, 1]) boxPart(housing, dark, 0.06, 0.06, 0.46, s * 1.28, height - 0.1, 0)
    // Suspension cables up to the roof.
    for (const s of [-1, 1]) cylPart(housing, plainMat(0x1a1b1c, 0.6, 0.5), 0.006, 0.006, 1.2, 4, s * 1.1, height + 0.55, 0)
    // The housing group is one mesh so the tube stays children[1].
    const parts = housing.children as THREE.Mesh[]
    const merged = mergeParts(parts, dark)
    group.add(merged)
    const tube = new THREE.Mesh(
        new THREE.BoxGeometry(2.3, 0.05, 0.26),
        new THREE.MeshBasicMaterial({ color, transparent: true })
    )
    tube.position.y = height - 0.15
    group.add(tube)
    group.userData.tube = tube
    return group
}

/** Fuses a list of same-material meshes (already in local space) into one mesh. */
function mergeParts(parts: THREE.Mesh[], material: THREE.Material) {
    const geos: THREE.BufferGeometry[] = []
    for (const p of parts) {
        const g = p.geometry
        if (!g.index) {
            const count = g.attributes.position!.count
            const idx = new Uint32Array(count)
            for (let i = 0; i < count; i++) idx[i] = i
            g.setIndex(new THREE.BufferAttribute(idx, 1))
        }
        for (const name of Object.keys(g.attributes)) {
            if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
        }
        geos.push(g)
    }
    return new THREE.Mesh(mergeGeoList(geos), material)
}

function mergeGeoList(geos: THREE.BufferGeometry[]) {
    return geos.length === 1 ? geos[0]! : mergeGeometries(geos, false)!
}

/**
 * Hanging high-bay lamp. Origin at the roof attach point, the shade hangs
 * `drop` below it. children[0] is the fixture hardware, children[1] the glowing
 * lens (flicker its opacity), children[2] the dome shade.
 */
export function buildHighBay(color: number, drop: number): THREE.Group {
    const group = new THREE.Group()
    const dark = paintMat(0x2b2e31, 0.6)
    const hardware = new THREE.Group()
    // Chain / cable, hook plate and the driver housing above the shade.
    cylPart(hardware, dark, 0.012, 0.012, drop, 4, 0, -drop / 2, 0)
    boxPart(hardware, dark, 0.3, 0.05, 0.3, 0, -0.025, 0)
    cylPart(hardware, dark, 0.09, 0.09, 0.12, 10, 0, -drop - 0.03, 0)
    group.add(mergeParts(hardware.children as THREE.Mesh[], dark))
    const lens = new THREE.Mesh(
        new THREE.CircleGeometry(0.4, 20),
        new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide })
    )
    lens.rotation.x = Math.PI / 2
    lens.position.y = -drop - 0.36
    group.add(lens)
    // Dome shade: a lathe profile, steel outside, reflector inside.
    const pts = [
        new THREE.Vector2(0.05, 0), new THREE.Vector2(0.14, -0.06), new THREE.Vector2(0.3, -0.18),
        new THREE.Vector2(0.46, -0.34), new THREE.Vector2(0.5, -0.4), new THREE.Vector2(0.49, -0.42)
    ]
    group.add(put(new THREE.LatheGeometry(pts, 20), plainMat(0x3a3d40, 0.45, 0.6, THREE.DoubleSide), 0, -drop, 0, 0, 0, 0, false))
    group.userData.tube = lens
    return group
}

/** A small red emergency beacon on a bracket. Returns the group; userData.lens is the glowing part. */
export function buildBeacon(): THREE.Group {
    const group = new THREE.Group()
    boxPart(group, M.darkSteel(), 0.18, 0.05, 0.14, 0, 0, 0)
    const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.07, 0.11, 10),
        new THREE.MeshBasicMaterial({ color: 0xff2a1c, transparent: true, opacity: 0.12 })
    )
    lens.position.y = 0.08
    group.add(lens)
    group.userData.lens = lens
    return group
}

let exitTexture: THREE.CanvasTexture | null = null

/** A green EXIT sign, lit from within. userData.face is the glowing panel. */
export function buildExitSign(): THREE.Group {
    const group = new THREE.Group()
    if (!exitTexture) {
        exitTexture = makeSignTexture({ title: 'EXIT', color: '#eaffef', background: '#0d8a44', accent: '#eaffef' })
    }
    boxPart(group, M.darkSteel(), 0.62, 0.24, 0.07, 0, 0, 0)
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.2), new THREE.MeshBasicMaterial({ map: exitTexture, transparent: true }))
    face.position.z = 0.038
    group.add(face)
    const back = face.clone()
    back.rotation.y = Math.PI
    back.position.z = -0.038
    group.add(back)
    group.userData.face = face
    return group
}

// ---------------------------------------------------------------------------
// Doors, windows, stairs, rails
// ---------------------------------------------------------------------------

export function buildDoorFrame(width: number, height: number, color: number): THREE.Group {
    const group = new THREE.Group()
    const steel = paintMat(color, 0.35)
    const dark = M.darkSteel()
    const hazard = M.hazard()
    const t = 0.24
    for (const s of [-1, 1]) {
        chamferPart(group, steel, t, height, 0.5, 0.03, s * width / 2, height / 2, 0)
        // Hazard chevrons up the jamb, and a bump rail at trolley height.
        boxPart(group, hazard, t + 0.02, 1.5, 0.52, s * width / 2, 0.75, 0)
        boxPart(group, dark, t + 0.05, 0.14, 0.54, s * width / 2, 1.2, 0)
    }
    chamferPart(group, steel, width + t, 0.36, 0.5, 0.03, 0, height - 0.18, 0)
    boxPart(group, hazard, width - 0.1, 0.1, 0.52, 0, height - 0.42, 0)
    // Track housing for the shutter.
    boxPart(group, dark, width - 0.1, 0.05, 0.16, 0, height - 0.5, 0)
    return group
}

/** Guard rail along a deck edge. Local X; base at y = 0, top at 1.05. */
export function buildRailing(length: number, color: number): THREE.Group {
    const group = new THREE.Group()
    const mat = paintMat(color === 0 ? 0xd6aa1e : color, 0.4)
    const dark = M.darkSteel()
    cylX(group, mat, 0.03, length, 8, 0, 1.03, 0)
    cylX(group, mat, 0.022, length, 8, 0, 0.55, 0)
    // Toe plate.
    boxPart(group, dark, length, 0.12, 0.012, 0, 0.09, 0)
    const posts = Math.max(1, Math.round(length / 1.5))
    for (let i = 0; i <= posts; i++) {
        const x = -length / 2 + (length / posts) * i
        boxPart(group, mat, 0.05, 1.06, 0.05, x, 0.53, 0)
        boxPart(group, dark, 0.1, 0.012, 0.1, x, 0.006, 0)
    }
    return group
}

/**
 * A boarded window: the reveal, the sill and the planks nailed across it.
 *
 *  Local space has +X along the opening and +Z pointing outside, so the caller
 *  only has to drop the group on the wall plane and yaw it to face out.
 */
export interface WindowModel {
    group: THREE.Group
    /** One node per board, ordered bottom to top. Hidden as they are torn off. */
    boards: THREE.Object3D[]
    /** The static frame (child of `group`). The level flattens it into its batches. */
    frame?: THREE.Group
}

function boardMaterial() {
    const cached = matCache.get('boards')
    if (cached) return cached as THREE.MeshStandardMaterial
    const set = makeSurface('plank')
    const m = new THREE.MeshStandardMaterial({
        map: set.map,
        roughnessMap: set.roughnessMap,
        normalMap: set.normalMap,
        vertexColors: true,
        roughness: 1
    })
    m.userData.tile = 1
    matCache.set('boards', m)
    return m
}

export function buildWindow(width: number, sill: number, head: number, planks: number, _plank?: THREE.Texture): WindowModel {
    const group = new THREE.Group()
    const frame = new THREE.Group()
    group.add(frame)
    const opening = head - sill
    const concrete = M.concrete(0x9d9c95)
    const steel = paintMat(0x33383b, 0.5)
    const wall = 0.5
    const mid = wall / 2
    // Reveal lining right through the wall thickness.
    for (const s of [-1, 1]) boxPart(frame, concrete, 0.1, opening, wall + 0.02, s * (width / 2 + 0.05), sill + opening / 2, mid)
    boxPart(frame, concrete, width + 0.2, 0.1, wall + 0.02, 0, head + 0.05, mid)
    boxPart(frame, concrete, width + 0.2, 0.1, wall + 0.02, 0, sill - 0.05, mid)
    // Steel angle frame on both faces of the wall.
    for (const z of [-0.02, wall + 0.02]) {
        for (const s of [-1, 1]) boxPart(frame, steel, 0.09, opening + 0.1, 0.05, s * (width / 2 + 0.005), sill + opening / 2, z)
        boxPart(frame, steel, width + 0.2, 0.09, 0.05, 0, head + 0.045, z)
        boxPart(frame, steel, width + 0.2, 0.09, 0.05, 0, sill - 0.045, z)
    }
    // Sloped outside sill and a concrete stool inside.
    chamferPart(frame, concrete, width + 0.5, 0.1, 0.32, 0.02, 0, sill - 0.09, wall + 0.12, 0, -0.12)
    chamferPart(frame, concrete, width + 0.36, 0.06, 0.16, 0.015, 0, sill - 0.03, -0.08)
    // Mullion stubs and the remnants of the glass.
    boxPart(frame, steel, 0.05, opening, 0.05, 0, sill + opening / 2, mid)
    const shard = glassMat()
    const rand = makeRng(Math.floor(width * 977 + planks))
    for (let i = 0; i < 9; i++) {
        const side = i % 4
        const geo = new THREE.BufferGeometry()
        const a = 0.06 + rand() * 0.12
        const b = 0.1 + rand() * 0.22
        geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, a, 0, 0, a * 0.4, b, 0], 3))
        geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
        geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2))
        geo.setIndex([0, 1, 2])
        let x = 0
        let y = 0
        let rz = 0
        if (side === 0) { x = -width / 2 + rand() * width; y = sill; rz = 0 }
        else if (side === 1) { x = -width / 2 + rand() * width; y = head; rz = Math.PI }
        else if (side === 2) { x = -width / 2; y = sill + rand() * opening; rz = -Math.PI / 2 }
        else { x = width / 2; y = sill + rand() * opening; rz = Math.PI / 2 }
        frame.add(put(geo, shard, x, y, mid + (rand() - 0.5) * 0.1, 0, 0, rz, false))
    }

    // Boards: nailed to the room face, each at its own hurried angle.
    const boardMat = boardMaterial()
    const boards: THREE.Object3D[] = []
    for (let i = 0; i < planks; i++) {
        const pivot = new THREE.Group()
        const t = (i + 0.5) / planks
        pivot.position.set(0, sill + opening * t, -0.075)
        pivot.rotation.z = (i % 2 === 0 ? 1 : -1) * (0.035 + (i % 3) * 0.028)
        const bh = (opening / planks) * 0.74
        const length = width + 0.56 - (i % 3) * 0.04
        const geo = chamferGeo(length, bh, 0.06, 0.012)
        tint(geo, 0xffffff)
        // Nail heads, one at each end and one near the middle.
        const geos: THREE.BufferGeometry[] = [geo]
        for (const nx of [-1, 1, 0.1]) {
            const nail = new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6)
            nail.rotateX(Math.PI / 2)
            nail.translate(nx * (length / 2 - 0.12), 0, 0.04)
            tint(nail, 0x3d3a36)
            geos.push(nail)
        }
        const flat = geos.map((g) => {
            const gg = g.index ? g.toNonIndexed() : g
            for (const name of Object.keys(gg.attributes)) {
                if (name !== 'position' && name !== 'normal' && name !== 'color') gg.deleteAttribute(name)
            }
            return gg
        })
        const merged = mergeGeometries(flat, false)!
        bakeUV(merged, 1, i * 0.37, i * 0.21)
        const board = new THREE.Mesh(merged, boardMat)
        pivot.add(board)
        group.add(pivot)
        boards.push(pivot)
    }
    return { group, boards, frame }
}

/** A flight of steps. Local origin sits at the bottom, climbing along +Z. */
export function buildStairs(width: number, run: number, rise: number, steps: number, _metal?: THREE.Texture): THREE.Group {
    const group = new THREE.Group()
    const tread = M.plate()
    const riser = paintMat(0x2f3235, 0.5)
    const steel = paintMat(0x3b4045, 0.5)
    const stepRun = run / steps
    const stepRise = rise / steps
    for (let i = 0; i < steps; i++) {
        boxPart(group, tread, width, 0.06, stepRun + 0.05, 0, stepRise * (i + 1) - 0.03, stepRun * (i + 0.5))
        // Nosing strip and the open riser plate behind it.
        boxPart(group, M.hazard(), width, 0.02, 0.06, 0, stepRise * (i + 1) - 0.005, stepRun * (i + 1) - 0.03)
        boxPart(group, riser, width - 0.02, stepRise - 0.06, 0.03, 0, stepRise * (i + 0.5) - 0.03, stepRun * i)
    }
    // Channel stringers following the pitch, with a lip along the top.
    const length = Math.hypot(run, rise)
    const pitch = Math.atan2(rise, run)
    for (const sx of [-1, 1]) {
        boxPart(group, steel, 0.08, 0.36, length + 0.1, sx * (width / 2 + 0.04), rise / 2 - 0.14, run / 2, 0, -pitch)
        boxPart(group, steel, 0.2, 0.05, length + 0.1, sx * (width / 2 + 0.04), rise / 2 + 0.04, run / 2, 0, -pitch)
    }
    // Support legs at the low end and mid-flight.
    for (const sx of [-1, 1]) {
        boxPart(group, steel, 0.12, rise * 0.55, 0.12, sx * (width / 2 + 0.04), rise * 0.275, run * 0.55)
        boxPart(group, steel, 0.12, rise * 0.9, 0.12, sx * (width / 2 + 0.04), rise * 0.45, run * 0.92)
    }
    return group
}

export function buildSign(width: number, height: number, opts: Parameters<typeof makeSignTexture>[0]): THREE.Mesh {
    return new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: makeSignTexture(opts), transparent: true })
    )
}

// ---------------------------------------------------------------------------
// Warehouse: racking, forklift, pallets, conveyor, generator, tank
// ---------------------------------------------------------------------------

function pushPallet(g: THREE.Object3D, x: number, y: number, z: number, w: number, d: number) {
    const wood = M.palletWood()
    const dark = paintMat(0x8a6d45, 0)
    // Five deck boards, three stringers and two bottom runners.
    const slat = 5
    for (let i = 0; i < slat; i++) {
        boxPart(g, wood, w, 0.022, d / slat - 0.03, x, y + 0.135, z - d / 2 + (d / slat) * (i + 0.5))
    }
    for (const s of [-1, 0, 1]) boxPart(g, dark, 0.09, 0.1, d, x + s * (w / 2 - 0.06), y + 0.07, z)
    for (const s of [-1, 1]) boxPart(g, wood, w, 0.02, 0.1, x, y + 0.01, z + s * (d / 2 - 0.06))
}

type LoadKind = 'cardboard' | 'wrapped' | 'drums' | 'sacks'

function pushLoad(g: THREE.Object3D, kind: LoadKind, x: number, y: number, z: number, w: number, d: number, h: number, rand: () => number) {
    if (kind === 'drums') {
        const colors = [0x1f4a8a, 0x2c6b3d, 0x8a2e20, 0x555a5e]
        const col = paintMat(colors[Math.floor(rand() * colors.length)]!, 0.4)
        const r = Math.min(w, d) * 0.23
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                cylPart(g, col, r, r, h * 0.94, 10, x + sx * w * 0.25, y + h * 0.47, z + sz * d * 0.25)
                cylPart(g, M.darkSteel(), r * 1.04, r * 1.04, 0.04, 10, x + sx * w * 0.25, y + h * 0.5, z + sz * d * 0.25)
            }
        }
        return
    }
    if (kind === 'sacks') {
        const sack = paintMat(0x8f8a7a, 0)
        const layers = Math.max(1, Math.round(h / 0.22))
        const bh = h / layers
        for (let l = 0; l < layers; l++) {
            const off = (l % 2) * 0.1
            boxPart(g, sack, w * 0.94, bh * 0.94, d * 0.94, x + (rand() - 0.5) * 0.02, y + bh * (l + 0.5), z + off * (rand() - 0.5), (rand() - 0.5) * 0.05)
        }
        return
    }
    const card = M.card()
    const nx = w > 0.9 ? 2 : 1
    const nz = d > 0.7 ? 2 : 1
    const layers = Math.max(1, Math.round(h / 0.36))
    const bh = h / layers
    for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
            for (let l = 0; l < layers; l++) {
                boxPart(
                    g, card, (w / nx) * 0.95, bh * 0.96, (d / nz) * 0.95,
                    x - w / 2 + (w / nx) * (ix + 0.5), y + bh * (l + 0.5), z - d / 2 + (d / nz) * (iz + 0.5),
                    (rand() - 0.5) * 0.05
                )
            }
        }
    }
    if (kind === 'wrapped') boxPart(g, M.wrap(), w * 1.0, h * 1.02, d * 1.0, x, y + h / 2, z)
}

/** Tall pallet racking: blue uprights, orange beams, loaded pallets. Long axis = the box's longer side. */
export function buildRack(width: number, height: number, depth: number, seed = 1): THREE.Group {
    const group = new THREE.Group()
    const inner = alongLong(width, depth)
    group.add(inner)
    const L = Math.max(width, depth)
    const D = Math.min(width, depth)
    const rand = makeRng(hashSeed(width, height, depth) + seed * 977)
    const upright = M.blue()
    const beam = M.orange()
    const guard = M.yellow()
    const dark = M.darkSteel()
    const rows = D > 1.9 ? 2 : 1
    const gap = rows === 2 ? 0.16 : 0
    const rowD = (D - gap) / rows
    const bays = Math.max(1, Math.round(L / 2.7))
    const bayW = L / bays
    const levels = Math.max(2, Math.floor((height - 0.4) / 1.7))
    const step = (height - 0.6) / levels
    const fx = (i: number) => -L / 2 + 0.05 + ((L - 0.1) / bays) * i

    for (let r = 0; r < rows; r++) {
        const zc = -D / 2 + rowD * (r + 0.5) + gap * r
        const zf = rowD / 2 - 0.04
        // Uprights, base plates and yellow column guards.
        for (let i = 0; i <= bays; i++) {
            const x = fx(i)
            for (const s of [-1, 1]) {
                boxPart(inner, upright, 0.085, height, 0.075, x, height / 2, zc + s * zf)
                boxPart(inner, dark, 0.16, 0.02, 0.15, x, 0.01, zc + s * zf)
                boxPart(inner, guard, 0.11, 0.42, 0.1, x, 0.21, zc + s * zf)
            }
            // Zig-zag bracing between the pair, every metre or so.
            const segs = Math.max(2, Math.round(height / 0.95))
            const sh = height / segs
            for (let k = 0; k < segs; k++) {
                const len = Math.hypot(zf * 2, sh)
                const ang = Math.atan2(zf * 2, sh)
                boxPart(inner, upright, 0.04, len, 0.025, x, sh * (k + 0.5), zc, 0, k % 2 === 0 ? ang : -ang)
            }
        }
        // Beams and the pallets sitting on them.
        for (let l = 0; l < levels; l++) {
            const by = 0.4 + step * l
            for (let i = 0; i < bays; i++) {
                const x0 = fx(i) + 0.05
                const x1 = fx(i + 1) - 0.05
                for (const s of [-1, 1]) {
                    boxPart(inner, beam, x1 - x0, 0.12, 0.05, (x0 + x1) / 2, by, zc + s * zf)
                    boxPart(inner, beam, x1 - x0, 0.03, 0.09, (x0 + x1) / 2, by + 0.065, zc + s * (zf - 0.02))
                }
                // Cross rails to carry the pallets.
                for (const t of [-0.2, 0.2]) boxPart(inner, dark, 0.03, 0.03, zf * 2, (x0 + x1) / 2 + t * (x1 - x0), by + 0.06, zc)
                const slots = bayW > 2.2 ? 2 : 1
                for (let sIdx = 0; sIdx < slots; sIdx++) {
                    if (rand() < 0.22) continue
                    const pw = Math.min(1.2, ((x1 - x0) / slots) - 0.1)
                    const pd = Math.min(1.0, rowD - 0.12)
                    const px = x0 + ((x1 - x0) / slots) * (sIdx + 0.5)
                    const py = by + 0.075
                    pushPallet(inner, px, py, zc, pw, pd)
                    const lh = Math.max(0.3, Math.min(step - 0.32, 0.5 + rand() * 0.9))
                    const roll = rand()
                    const kind: LoadKind = roll < 0.4 ? 'cardboard' : roll < 0.72 ? 'wrapped' : roll < 0.88 ? 'drums' : 'sacks'
                    pushLoad(inner, kind, px, py + 0.15, zc, pw * 0.96, pd * 0.94, lh, rand)
                }
            }
        }
        // Row identification plates on the end frames.
        stencilPart(inner, STENCIL.box, 0.3, 0.3, -L / 2 - 0.01, 1.6, zc, -Math.PI / 2)
        stencilPart(inner, STENCIL.box, 0.3, 0.3, L / 2 + 0.01, 1.6, zc, Math.PI / 2)
    }
    // Top ties between the two rows of a double rack.
    if (rows === 2) {
        for (let i = 0; i <= bays; i++) boxPart(inner, upright, 0.06, 0.06, D, fx(i), height - 0.06, 0)
    }
    return group
}

/** A parked forklift: yellow body, mast and forks at +X of the long axis. */
export function buildForklift(width: number, height: number, depth: number): THREE.Group {
    const group = new THREE.Group()
    const inner = alongLong(width, depth)
    group.add(inner)
    const L = Math.max(width, depth)
    const W = Math.min(width, depth)
    const body = paintMat(0xd0a01a, 0.35)
    const dark = M.darkSteel()
    const black = M.black()
    const steel = plainMat(0x767b80, 0.45, 0.8)
    const tyre = M.rubber()
    const fx = L / 2
    const mastX = fx - 1.15
    const bodyL = mastX - 0.1 + L / 2
    const bodyW = Math.min(W * 0.86, 1.15)
    const top = Math.max(1.8, height - 0.05)
    // Chassis: lower tub, engine cowl over the rear and the counterweight.
    chamferPart(inner, dark, bodyL, 0.34, bodyW * 0.9, 0.04, -L / 2 + bodyL / 2, 0.42, 0)
    chamferPart(inner, body, bodyL * 0.62, 0.5, bodyW, 0.07, -L / 2 + bodyL * 0.31, 0.75, 0)
    chamferPart(inner, body, bodyL * 0.34, 0.66, bodyW, 0.09, -L / 2 + bodyL * 0.83 - bodyL * 0.34, 0.83, 0)
    boxPart(inner, M.hazard(), 0.03, 0.34, bodyW * 0.94, -L / 2 - 0.005, 0.62, 0)
    // Front cowl and floor plate the operator's feet rest on.
    chamferPart(inner, body, bodyL * 0.3, 0.44, bodyW * 0.9, 0.06, -L / 2 + bodyL * 0.86, 0.67, 0)
    boxPart(inner, M.plate(), bodyL * 0.3, 0.03, bodyW * 0.8, -L / 2 + bodyL * 0.6, 0.6, 0)
    // Seat and backrest, steering column and wheel.
    chamferPart(inner, black, 0.42, 0.1, 0.42, 0.03, -L / 2 + bodyL * 0.34, 1.1, 0)
    chamferPart(inner, black, 0.08, 0.46, 0.4, 0.03, -L / 2 + bodyL * 0.34 - 0.2, 1.36, 0, 0, 0, -0.12)
    cylPart(inner, dark, 0.025, 0.025, 0.5, 6, -L / 2 + bodyL * 0.55, 1.2, 0, 0, 0, -0.5)
    torusPart(inner, black, 0.17, 0.02, -L / 2 + bodyL * 0.55 + 0.11, 1.42, 0, 0, Math.PI / 2 - 0.5, 0, Math.PI * 2, 12)
    // Overhead guard: four posts, a slatted roof and a beacon.
    const gx0 = -L / 2 + bodyL * 0.2
    const gx1 = -L / 2 + bodyL * 0.62
    for (const x of [gx0, gx1]) {
        for (const s of [-1, 1]) boxPart(inner, dark, 0.06, top - 0.9, 0.06, x, 0.9 + (top - 0.9) / 2, s * (bodyW / 2 - 0.05))
    }
    for (const s of [-1, 1]) boxPart(inner, dark, gx1 - gx0 + 0.16, 0.05, 0.05, (gx0 + gx1) / 2, top, s * (bodyW / 2 - 0.05))
    for (let i = 0; i < 7; i++) {
        boxPart(inner, dark, 0.035, 0.03, bodyW - 0.05, gx0 + ((gx1 - gx0) / 6) * i, top + 0.005, 0)
    }
    cylPart(inner, M.ledAmber(), 0.055, 0.06, 0.1, 8, gx0 + 0.05, top + 0.09, bodyW / 2 - 0.1)
    // Mast: two channels, cross ties, carriage and the forks.
    for (const s of [-1, 1]) {
        boxPart(inner, dark, 0.1, top - 0.1, 0.09, mastX, (top - 0.1) / 2 + 0.05, s * 0.3)
        boxPart(inner, steel, 0.06, top * 0.55, 0.07, mastX + 0.09, top * 0.28 + 0.1, s * 0.3)
    }
    for (const y of [0.4, 1.1, top - 0.1]) boxPart(inner, dark, 0.09, 0.08, 0.68, mastX, y, 0)
    boxPart(inner, dark, 0.05, 0.9, 0.72, mastX + 0.16, 0.6, 0)
    for (let i = 0; i < 4; i++) boxPart(inner, dark, 0.03, 0.9, 0.03, mastX + 0.19, 0.95, -0.28 + i * 0.187)
    for (const s of [-1, 1]) {
        boxPart(inner, steel, 1.0, 0.06, 0.13, mastX + 0.7, 0.1, s * 0.32)
        boxPart(inner, steel, 0.08, 0.72, 0.13, mastX + 0.2, 0.42, s * 0.32)
        // Hydraulic hose down the mast.
        cylPart(inner, black, 0.014, 0.014, top * 0.6, 5, mastX - 0.06, top * 0.35, s * 0.17)
    }
    // Wheels: big driven pair at the front, small steer pair at the back.
    const wheel = (x: number, r: number, zz: number, wide: number) => {
        cylPart(inner, tyre, r, r, wide, 16, x, r, zz, 0, Math.PI / 2, 0)
        cylPart(inner, steel, r * 0.55, r * 0.55, wide + 0.02, 10, x, r, zz, 0, Math.PI / 2, 0)
        cylPart(inner, dark, r * 0.18, r * 0.18, wide + 0.05, 8, x, r, zz, 0, Math.PI / 2, 0)
    }
    for (const s of [-1, 1]) {
        wheel(mastX + 0.02, 0.36, s * (bodyW / 2 + 0.03), 0.28)
        wheel(-L / 2 + 0.55, 0.28, s * (bodyW / 2 - 0.04), 0.22)
    }
    // Headlamps and a capacity plate.
    for (const s of [-1, 1]) boxPart(inner, glowMat(0xffe0a0), 0.04, 0.09, 0.14, mastX - 0.14, 0.95, s * 0.36)
    stencilPart(inner, STENCIL.care, 0.5, 0.5, -L / 2 + bodyL * 0.5, 0.78, bodyW / 2 + 0.005)
    return group
}

/** Low stacked cover: shrink-wrapped pallet loads filling the footprint up to `height`. */
export function buildPallets(width: number, height: number, depth: number, seed = 1): THREE.Group {
    const group = new THREE.Group()
    const rand = makeRng(hashSeed(width, height, depth) + seed * 313)
    const nx = Math.max(1, Math.round(width / 1.2))
    const nz = Math.max(1, Math.round(depth / 1.0))
    const cw = width / nx
    const cd = depth / nz
    const layers = height > 1.5 ? 2 : 1
    const palletH = 0.15
    const layerH = height / layers
    for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
            const x = -width / 2 + cw * (ix + 0.5)
            const z = -depth / 2 + cd * (iz + 0.5)
            for (let l = 0; l < layers; l++) {
                const y = layerH * l
                pushPallet(group, x, y, z, cw - 0.04, cd - 0.04)
                const roll = rand()
                const kind: LoadKind = roll < 0.45 ? 'wrapped' : roll < 0.75 ? 'cardboard' : roll < 0.9 ? 'sacks' : 'drums'
                pushLoad(group, kind, x, y + palletH, z, cw - 0.08, cd - 0.08, layerH - palletH - 0.01, rand)
            }
        }
    }
    // Yellow strapping.
    boxPart(group, M.yellow(), width + 0.01, 0.03, 0.03, 0, height * 0.55, -depth / 2 - 0.003)
    boxPart(group, M.yellow(), width + 0.01, 0.03, 0.03, 0, height * 0.55, depth / 2 + 0.003)
    return group
}

/** A roller conveyor on legs, waist high. */
export function buildConveyor(width: number, height: number, depth: number, seed = 1): THREE.Group {
    const group = new THREE.Group()
    const inner = alongLong(width, depth)
    group.add(inner)
    const L = Math.max(width, depth)
    const W = Math.min(width, depth)
    const rand = makeRng(hashSeed(width, height, depth) + seed)
    const frame = paintMat(0x2f5f8a, 0.35)
    const dark = M.darkSteel()
    const roller = plainMat(0x9aa0a5, 0.35, 0.85)
    const top = height - 0.02
    // Side channels and the rail guides above them.
    for (const s of [-1, 1]) {
        boxPart(inner, frame, L, 0.16, 0.05, 0, top - 0.08, s * (W / 2 - 0.03))
        boxPart(inner, dark, L, 0.03, 0.09, 0, top - 0.005, s * (W / 2 - 0.045))
        boxPart(inner, dark, L, 0.04, 0.04, 0, top + 0.16, s * (W / 2 - 0.02))
        for (let i = 0; i <= Math.round(L / 1.2); i++) {
            const x = -L / 2 + 0.06 + ((L - 0.12) / Math.round(L / 1.2)) * i
            boxPart(inner, dark, 0.04, 0.16, 0.04, x, top + 0.08, s * (W / 2 - 0.02))
        }
    }
    // Rollers.
    const n = Math.max(6, Math.floor(L / 0.115))
    for (let i = 0; i < n; i++) {
        const x = -L / 2 + 0.05 + ((L - 0.1) / (n - 1)) * i
        cylZ(inner, roller, 0.028, W - 0.08, 6, x, top - 0.04, 0)
    }
    // Legs in pairs, with a cross-brace and foot plates.
    const legs = Math.max(2, Math.round(L / 1.6) + 1)
    for (let i = 0; i < legs; i++) {
        const x = -L / 2 + 0.15 + ((L - 0.3) / (legs - 1)) * i
        for (const s of [-1, 1]) {
            boxPart(inner, frame, 0.06, top - 0.16, 0.06, x, (top - 0.16) / 2, s * (W / 2 - 0.05))
            boxPart(inner, dark, 0.16, 0.02, 0.16, x, 0.01, s * (W / 2 - 0.05))
        }
        boxPart(inner, frame, 0.04, 0.04, W - 0.1, x, 0.32, 0)
    }
    // Drive motor and gearbox at one end, with a chain guard and status LED.
    boxPart(inner, M.darkSteel(), 0.4, 0.26, 0.28, -L / 2 + 0.3, 0.42, -W / 2 - 0.04)
    cylX(inner, paintMat(0x3b4148, 0.5), 0.11, 0.34, 10, -L / 2 + 0.3, 0.42, -W / 2 - 0.2)
    boxPart(inner, M.black(), 0.16, 0.2, 0.08, -L / 2 + 0.7, 0.66, -W / 2 - 0.02)
    boxPart(inner, M.ledGreen(), 0.03, 0.03, 0.012, -L / 2 + 0.7, 0.7, -W / 2 + 0.024)
    // A few cartons already riding it.
    const cartons = Math.min(4, Math.floor(L / 1.8))
    for (let i = 0; i < cartons; i++) {
        const cw = 0.42 + rand() * 0.24
        const ch = 0.26 + rand() * 0.26
        const x = -L / 2 + 0.7 + rand() * (L - 1.4)
        boxPart(inner, M.card(), cw, ch, W * 0.62, x, top + ch / 2, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.1)
    }
    return group
}

/** A diesel generator on a skid: louvred enclosure, radiator end, exhaust stack. */
export function buildGenerator(width: number, height: number, depth: number, accent = 0x6d6961): THREE.Group {
    const group = new THREE.Group()
    const inner = alongLong(width, depth)
    group.add(inner)
    const L = Math.max(width, depth)
    const W = Math.min(width, depth)
    const shell = new THREE.Color(accent).lerp(new THREE.Color(0xb98a2e), 0.6).getHex()
    const enc = paintMat(shell, 0.3)
    const dark = M.darkSteel()
    const black = M.black()
    const steel = M.steel()
    const encH = height * 0.72
    // Skid: two I-beams and cross members, with vibration mounts.
    for (const s of [-1, 1]) boxPart(inner, dark, L, 0.2, 0.12, 0, 0.14, s * (W / 2 - 0.1))
    for (let i = 0; i < 4; i++) boxPart(inner, dark, 0.1, 0.12, W - 0.1, -L / 2 + 0.3 + i * ((L - 0.6) / 3), 0.2, 0)
    // Enclosure with a slightly lifted lid, louvres and access doors.
    chamferPart(inner, enc, L - 0.2, encH, W - 0.16, 0.05, -0.06, 0.24 + encH / 2, 0)
    chamferPart(inner, paintMat(shell, 0.15), L - 0.14, 0.08, W - 0.1, 0.03, -0.06, 0.24 + encH + 0.03, 0)
    for (const s of [-1, 1]) {
        const zf = s * (W / 2 - 0.075)
        const cells = Math.max(2, Math.round((L - 1.6) / 0.9))
        for (let c = 0; c < cells; c++) {
            const x = -L / 2 + 0.7 + ((L - 1.6) / cells) * (c + 0.5)
            const w = (L - 1.6) / cells - 0.1
            boxPart(inner, black, w, encH * 0.42, 0.03, x, 0.24 + encH * 0.62, zf + s * 0.006)
            for (let k = 0; k < 7; k++) boxPart(inner, dark, w - 0.03, 0.022, 0.04, x, 0.24 + encH * 0.44 + k * (encH * 0.36 / 6), zf + s * 0.028, 0, -0.5 * s)
            boxPart(inner, steel, 0.04, 0.16, 0.05, x + w / 2 - 0.05, 0.24 + encH * 0.3, zf + s * 0.03)
        }
    }
    // Radiator grille on the +X end.
    boxPart(inner, black, 0.06, encH * 0.7, W * 0.7, L / 2 - 0.08, 0.24 + encH * 0.5, 0)
    for (let i = 0; i < 9; i++) boxPart(inner, dark, 0.03, encH * 0.66, 0.02, L / 2 - 0.045, 0.24 + encH * 0.5, -W * 0.3 + i * (W * 0.6 / 8))
    cylX(inner, dark, 0.22, 0.05, 12, L / 2 - 0.02, 0.24 + encH * 0.5, 0)
    // Control panel on the -X end: screen, LEDs, e-stop.
    boxPart(inner, black, 0.06, 0.4, 0.5, -L / 2 + 0.06, 0.24 + encH * 0.62, 0)
    boxPart(inner, M.screen(), 0.012, 0.16, 0.3, -L / 2 + 0.032, 0.24 + encH * 0.7, 0)
    for (let i = 0; i < 4; i++) boxPart(inner, i % 2 ? M.ledGreen() : M.ledAmber(), 0.012, 0.03, 0.03, -L / 2 + 0.032, 0.24 + encH * 0.55, -0.15 + i * 0.1)
    cylPart(inner, M.red(), 0.035, 0.035, 0.03, 10, -L / 2 + 0.04, 0.24 + encH * 0.47, 0.18, 0, 0, Math.PI / 2)
    // Exhaust stack, rain cap and a heat shield collar, rising to `height`.
    const ex = L * 0.22
    const ez = W * 0.18
    const sh = height - (0.24 + encH)
    cylPart(inner, steel, 0.09, 0.09, sh + 0.05, 10, ex, 0.24 + encH + sh / 2, ez)
    cylPart(inner, M.rust(), 0.115, 0.115, 0.34, 10, ex, 0.24 + encH + 0.2, ez)
    cylPart(inner, dark, 0.15, 0.03, 0.08, 10, ex, height - 0.02, ez)
    // Lifting eyes, a cable coil and hazard stencils.
    for (const s of [-1, 1]) torusPart(inner, steel, 0.06, 0.014, s * L * 0.3, 0.24 + encH + 0.11, 0, 0, Math.PI / 2, 0, Math.PI * 2, 8)
    torusPart(inner, black, 0.16, 0.04, L * 0.32, 0.26, W / 2 + 0.02, 0, Math.PI / 2, 0, Math.PI * 2, 12)
    stencilPart(inner, STENCIL.flammable, 0.7, 0.7, -L * 0.1, 0.24 + encH * 0.9, W / 2 - 0.05 + 0.03)
    stencilPart(inner, STENCIL.hazardDiamond, 0.5, 0.5, L * 0.12, 0.24 + encH * 0.92, -W / 2 + 0.05 - 0.03, Math.PI)
    return group
}

/** A vertical process tank filling its box: seams, dished top, ladder, valve and a green sight glass. */
export function buildTank(width: number, height: number, depth: number, seed = 1): THREE.Group {
    const group = new THREE.Group()
    const R = Math.min(width, depth) / 2 - 0.08
    const shell = paintMat(0x7c8a84, 0.45)
    const dark = M.darkSteel()
    const rand = makeRng(hashSeed(width, height, depth) + seed)
    const legH = 0.45
    const bodyH = Math.max(1, height - legH - R * 0.3)
    // Legs and a base ring.
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        boxPart(group, dark, 0.14, legH + 0.1, 0.14, Math.cos(a) * R * 0.86, (legH + 0.1) / 2, Math.sin(a) * R * 0.86)
    }
    cylPart(group, dark, R * 0.96, R * 0.96, 0.08, 20, 0, legH, 0)
    // Shell in courses with a weld bead between each.
    cylPart(group, shell, R, R, bodyH, 24, 0, legH + bodyH / 2, 0)
    const courses = Math.max(2, Math.round(bodyH / 1.2))
    for (let i = 1; i < courses; i++) {
        cylPart(group, dark, R + 0.012, R + 0.012, 0.06, 24, 0, legH + (bodyH / courses) * i, 0)
    }
    // Dished head.
    const dome = new THREE.SphereGeometry(R, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    dome.scale(1, 0.3, 1)
    const domeMesh = put(dome, shell, 0, legH + bodyH, 0, 0, 0, 0, false)
    scaleUV(dome, R * 2 / 1, R / 1)
    group.add(domeMesh)
    cylPart(group, dark, R * 0.26, R * 0.26, 0.16, 10, R * 0.25, legH + bodyH + R * 0.3, 0)
    cylPart(group, dark, 0.06, 0.06, 0.5, 8, -R * 0.3, legH + bodyH + R * 0.28, R * 0.2)
    // Manway, level gauge with a bio-green sight glass, hazard placards.
    const a0 = rand() * Math.PI * 2
    const faceAt = (a: number, off = 0) => ({ x: Math.cos(a) * (R + off), z: Math.sin(a) * (R + off) })
    const man = faceAt(a0, 0.05)
    cylPart(group, dark, 0.28, 0.28, 0.1, 12, man.x, legH + 1.1, man.z, -a0, 0, Math.PI / 2)
    const glass = faceAt(a0 + 0.9, 0.03)
    const gauge = new THREE.Mesh(new THREE.BoxGeometry(0.06, bodyH * 0.6, 0.03), glowMat(0x2dffb2))
    gauge.position.set(glass.x, legH + bodyH * 0.55, glass.z)
    gauge.rotation.y = -(a0 + 0.9) + Math.PI / 2
    group.add(gauge)
    const dia = faceAt(a0 + 2.2, 0.006)
    stencilPart(group, STENCIL.hazardDiamond, 0.7, 0.7, dia.x, legH + 1.6, dia.z, -(a0 + 2.2) + Math.PI / 2)
    const flam = faceAt(a0 + 3.6, 0.006)
    stencilPart(group, STENCIL.biohazard, 0.75, 0.75, flam.x, legH + 1.7, flam.z, -(a0 + 3.6) + Math.PI / 2)
    // Ladder with a cage up the side.
    const la = a0 + 1.9
    const lp = faceAt(la, 0.12)
    const ladder = new THREE.Group()
    ladder.position.set(lp.x, 0, lp.z)
    ladder.rotation.y = -la + Math.PI / 2
    group.add(ladder)
    const lh = legH + bodyH + 0.1
    for (const s of [-1, 1]) boxPart(ladder, dark, 0.04, lh, 0.05, s * 0.2, lh / 2, 0)
    for (let y = 0.3; y < lh; y += 0.3) cylX(ladder, dark, 0.015, 0.4, 5, 0, y, 0)
    for (let y = 2.2; y < lh; y += 0.7) torusPart(ladder, dark, 0.28, 0.012, 0, y, 0.1, 0, Math.PI / 2, 0, Math.PI * 2, 10)
    // Inlet pipe with an elbow down to the floor and a handwheel.
    const pa = a0 + 4.6
    const pp = faceAt(pa, 0)
    const pipe = new THREE.Group()
    pipe.position.set(pp.x, 0, pp.z)
    pipe.rotation.y = -pa + Math.PI / 2
    group.add(pipe)
    cylZ(pipe, M.steel(), 0.08, 0.7, 10, 0, legH + 0.9, 0.35)
    const elbow = put(new THREE.SphereGeometry(0.09, 10, 8), M.steel(), 0, legH + 0.9, 0.7, 0, 0, 0, false)
    pipe.add(elbow)
    cylPart(pipe, M.steel(), 0.08, 0.08, legH + 0.9, 10, 0, (legH + 0.9) / 2, 0.7)
    torusPart(pipe, M.red(), 0.1, 0.016, 0, legH + 0.45, 0.7, 0, Math.PI / 2, 0, Math.PI * 2, 12)
    return group
}

/**
 * Heavy overhead-roof steel: a flat Warren truss spanning local X, `depth`
 * deep, hung from the roof. Origin is the top-chord centre line.
 */
export function buildTruss(span: number, depth = 0.9): THREE.Group {
    const group = new THREE.Group()
    const steel = paintMat(0x3c4147, 0.5)
    const chord = 0.09
    boxPart(group, steel, span, chord, 0.22, 0, -chord / 2, 0)
    boxPart(group, steel, span, chord, 0.22, 0, -depth + chord / 2, 0)
    const bay = 1.3
    const n = Math.max(2, Math.round(span / bay))
    const b = span / n
    for (let i = 0; i < n; i++) {
        const x0 = -span / 2 + b * i
        const len = Math.hypot(b, depth - chord)
        const ang = Math.atan2(depth - chord, b)
        boxPart(group, steel, len, 0.06, 0.06, x0 + b / 2, -depth / 2, 0, 0, 0, i % 2 === 0 ? ang : -ang)
        if (i % 2 === 0) boxPart(group, steel, 0.06, depth - chord, 0.06, x0, -depth / 2, 0)
    }
    boxPart(group, steel, 0.06, depth - chord, 0.06, span / 2, -depth / 2, 0)
    return group
}

/** A perforated cable tray with bundled cables. Runs along local X; tray floor at y = 0. */
export function buildCableTray(length: number, hang = 0): THREE.Group {
    const group = new THREE.Group()
    const tray = paintMat(0x8c9298, 0.5)
    const dark = M.darkSteel()
    boxPart(group, tray, length, 0.02, 0.4, 0, 0.01, 0)
    for (const s of [-1, 1]) boxPart(group, tray, length, 0.09, 0.02, 0, 0.055, s * 0.2)
    const cols = [0x1a1a1c, 0x1a1a1c, 0xa8281d, 0x2a4a8a, 0x1a1a1c, 0xc4a02a]
    cols.forEach((c, i) => {
        cylX(group, plainMat(c, 0.6, 0), 0.028, length * 0.98, 6, 0, 0.05, -0.15 + i * 0.06)
    })
    const brackets = Math.max(2, Math.round(length / 2))
    for (let i = 0; i <= brackets; i++) {
        const x = -length / 2 + (length / brackets) * i
        boxPart(group, dark, 0.03, 0.03, 0.46, x, -0.01, 0)
        if (hang > 0) for (const s of [-1, 1]) cylPart(group, dark, 0.01, 0.01, hang, 4, x, hang / 2, s * 0.2)
    }
    return group
}

/** A rectangular galvanised duct with flanged joints and strap hangers. Along local X. */
export function buildDuct(length: number, width = 0.9, height = 0.55, hang = 0): THREE.Group {
    const group = new THREE.Group()
    const skin = paintMat(0xb4b9bd, 0.6)
    const dark = M.darkSteel()
    chamferPart(group, skin, length, height, width, 0.015, 0, 0, 0)
    const joints = Math.max(1, Math.round(length / 2.4))
    for (let i = 0; i <= joints; i++) {
        const x = -length / 2 + (length / joints) * i
        boxPart(group, dark, 0.05, height + 0.05, width + 0.05, x, 0, 0)
        if (hang > 0) for (const s of [-1, 1]) cylPart(group, dark, 0.008, 0.008, hang, 4, x, height / 2 + hang / 2, s * width * 0.4)
    }
    return group
}

/** A skylight: dark frame with a pale sky-lit pane (unlit, additive-looking). Local origin at the roof plane. */
export function buildSkylight(width: number, depth: number, color = 0x6d88a8): THREE.Group {
    const group = new THREE.Group()
    const frame = paintMat(0x2a2d30, 0.5)
    const t = 0.12
    boxPart(group, frame, width, 0.16, t, 0, 0, depth / 2 - t / 2)
    boxPart(group, frame, width, 0.16, t, 0, 0, -depth / 2 + t / 2)
    boxPart(group, frame, t, 0.16, depth, width / 2 - t / 2, 0, 0)
    boxPart(group, frame, t, 0.16, depth, -width / 2 + t / 2, 0, 0)
    const bars = Math.max(1, Math.round(width / 1.6))
    for (let i = 1; i < bars; i++) boxPart(group, frame, 0.06, 0.1, depth, -width / 2 + (width / bars) * i, -0.02, 0)
    const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(width - t * 2, depth - t * 2),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    )
    pane.rotation.x = Math.PI / 2
    pane.position.y = 0.02
    group.add(pane)
    group.userData.pane = pane
    return group
}
