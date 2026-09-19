// Void Runner — classic hostile, warden, mine and crate models.

import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { ModelBuilder, ROCK_MATERIAL, cyl, ico, mulberry32, octa, ring, tube, wedge, plate, type BuiltModel, type Vec3 } from './models'
import { WINDOW, band, barrel, block, loft, shade, slab, tank, type Livery, type Section } from './ship-kit'

// ─── Enemies ───────────────────────────────────────────────────────────────

const E_HULL = 0x6d6268
const E_DARK = 0x2a2328
const E_PLATE = 0x9a8c90
const E_PAINT = 0xa3202f

export function buildEnemy(kind: string, glow: number, scale = 1): BuiltModel {
    const b = new ModelBuilder()
    switch (kind) {
        case 'mite':
            b.solid(new THREE.TetrahedronGeometry(0.7), E_PAINT, [0, 0, 0], [0.6, 0.3, 0])
            b.solid(wedge(0.2, 0.2, 1.2, 0.1, 0.1), E_DARK, [0.5, 0, 0], [0, 0, 0], [1, 1, 1], true)
            b.glow(octa(0.28), glow, 4)
            break
        case 'raider':
            b.solid(wedge(0.8, 0.5, 2.6, 0.2, 0.4), E_HULL, [0, 0, 0])
            b.solid(plate([[0.2, -0.9], [1.7, -0.2], [1.6, 0.9], [0.3, 0.8]], 0.08), E_PLATE, [0, 0, 0], [0, 0, -0.2], [1, 1, 1], true)
            b.solid(plate([[1.2, -0.45], [1.7, -0.2], [1.62, 0.5], [1.15, 0.4]], 0.1), E_PAINT, [0, 0.01, 0], [0, 0, -0.2], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.05, 0.05, 1.0), glow, 2, [1.62, -0.33, 0.35], [0, 0, 0], [1, 1, 1], true)
            b.solid(tube(0.06, 0.08, 0.9, 5), E_DARK, [1.2, -0.1, -0.5], [0, 0, 0], [1, 1, 1], true)
            b.glow(octa(0.2), glow, 2.5, [0, 0.2, -0.4], [0, 0, 0], [1, 0.6, 1.8])
            b.engine([0.3, 0, 1.3], 0.18, true, glow)
            break
        case 'lancer':
            b.solid(wedge(0.5, 0.5, 4.2, 0.1, 0.1), E_HULL)
            b.solid(tube(0.08, 0.12, 2.6, 6), E_DARK, [0, -0.3, -1.8])
            b.solid(plate([[0.1, 0.2], [1.2, 1.4], [1.1, 1.7], [0.1, 1.5]], 0.06), E_PLATE, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
            b.solid(plate([[0, 0.2], [0.5, 1.4], [0.4, 1.7], [0, 1.5]], 0.06), E_PLATE, [0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], true)
            b.glow(octa(0.14), glow, 4, [0, -0.3, -3.15])
            b.glow(new THREE.BoxGeometry(0.05, 0.05, 1.8), glow, 2, [0, 0.26, -0.2])
            b.solid(wedge(0.55, 0.2, 1.4, 0.4, 0.5), E_PAINT, [0, 0.24, 0.9])
            b.engine([0, 0, 2.1], 0.22, false, glow)
            break
        case 'bulwark':
            b.solid(new THREE.CylinderGeometry(1.4, 1.6, 3.2, 6).rotateX(Math.PI / 2), E_HULL)
            b.solid(new THREE.BoxGeometry(3.8, 0.6, 1.6), E_PLATE, [0, 0, 0.5])
            b.solid(new THREE.BoxGeometry(0.4, 1.2, 2.4), E_PAINT, [1.95, 0, 0.2], [0, 0, 0], [1, 1, 1], true)
            b.solid(new THREE.CylinderGeometry(2.2, 2.4, 0.4, 6).rotateX(Math.PI / 2), E_PLATE, [0, 0, -1.7])
            b.solid(tube(0.2, 0.25, 1.4, 6), E_DARK, [0.7, 0.8, -1.4], [0, 0, 0], [1, 1, 1], true)
            b.glow(ring(0.9, 0.08, 4, 6), glow, 2.5, [0, 0, -1.62])
            b.engine([0.8, 0, 1.8], 0.35, true, glow)
            break
        case 'minelayer':
            b.solid(ico(1.4, 0), E_HULL, [0, 0, 0], [0, 0, 0], [1.2, 0.8, 1.4])
            b.solid(new THREE.BoxGeometry(1.6, 0.9, 1.0), E_DARK, [0, -0.2, 1.4])
            b.solid(plate([[0.8, -0.6], [2.2, 0.4], [2.0, 0.8], [0.8, 0.6]], 0.1), E_PLATE, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(1.0, 0.5, 0.05), glow, 2.2, [0, -0.2, 1.92])
            b.solid(wedge(1.2, 0.3, 2.2, 0.5, 0.5), E_PAINT, [0, 0.95, 0])
            b.glow(octa(0.25), glow, 2.5, [0, 0.9, -0.4])
            break
        case 'leech':
            b.solid(ico(0.8, 0), E_HULL, [0, 0, 0], [0, 0, 0], [1, 0.8, 1.2])
            for (let i = 0; i < 4; i++) b.solid(tube(0.35 - i * 0.07, 0.3 - i * 0.07, 0.6, 6), i % 2 ? E_DARK : E_PLATE, [0, 0, 0.8 + i * 0.55])
            b.solid(wedge(0.15, 0.15, 1.2, 0.1, 0.1), E_DARK, [0.4, 0, -1.1], [0, 0.35, 0], [1, 1, 1], true)
            b.glow(octa(0.25), glow, 4, [0, 0, -0.7])
            b.solid(octa(0.5), E_PAINT, [0, 0.45, 0.1], [0, 0, 0], [0.8, 0.6, 1.4])
            break
        case 'blinker':
            b.solid(octa(1.0), E_HULL, [0, 0, 0], [0, 0, 0], [0.8, 1.2, 1.4])
            b.solid(octa(0.7), E_PAINT, [0, 0, -0.35], [0, 0, 0], [0.62, 0.9, 1.1])
            b.glow(ring(1.3, 0.06, 4, 20), glow, 2.2, [0, 0, 0], [Math.PI / 2, 0, 0])
            b.glow(ring(1.0, 0.05, 4, 20), glow, 1.6, [0, 0, 0], [0, 0, 0])
            b.glow(octa(0.3), glow, 4)
            break
        case 'carrier':
            b.solid(wedge(4.0, 2.4, 11, 0.4, 0.5), E_HULL)
            b.solid(new THREE.BoxGeometry(6.4, 1.4, 5.0), E_PLATE, [0, -0.2, 1.8])
            b.solid(new THREE.BoxGeometry(1.2, 2.2, 3.0), E_DARK, [0, 1.8, 2.0])
            b.solid(wedge(2.6, 0.3, 6, 0.3, 0.5), E_PAINT, [0, 1.22, -1.5])
            for (let i = 0; i < 3; i++) b.glow(new THREE.BoxGeometry(0.05, 0.8, 1.0), glow, 2.2, [3.22, -0.2, 0.6 + i * 1.3], [0, 0, 0], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(1.0, 0.1, 0.1), glow, 3, [0, 3.0, 1.0])
            b.engine([1.3, 0, 5.6], 0.7, true, glow)
            b.hardpoint([0, 1.2, -3], [0, 1, 0])
            break
        case 'sentinel':
            b.solid(ico(1.5, 1), E_HULL)
            b.solid(ring(2.2, 0.35, 4, 8), E_DARK, [0, 0, 0], [Math.PI / 2, 0, 0])
            b.solid(tube(0.25, 0.35, 2.0, 6), E_PLATE, [0, 0, -1.8])
            b.solid(ring(1.7, 0.18, 4, 8), E_PAINT, [0, 0, -0.9])
            b.glow(octa(0.35), glow, 4, [0, 0, -2.9])
            b.glow(ring(1.55, 0.06, 4, 16), glow, 1.8)
            break
        case 'freighter':
            freighter(b, glow)
            break
        case 'meteor':
            meteor(b, glow)
            break
        case 'vault':
            vault(b, glow)
            break
        case 'mine':
            mine(b, glow)
            break
    }
    const built = b.build()
    built.group.scale.setScalar(scale)
    built.radius *= scale
    return built
}


// ─── Placement helpers ─────────────────────────────────────────────────────

/**
 * Moves a part built in a local frame (+Y outward, -Z forward) to angle `a`
 * around the long axis, `r` out from it. `tilt` leans its nose outward first.
 */
function around(geo: THREE.BufferGeometry, a: number, r: number, z = 0, tilt = 0) {
    if (tilt) geo.rotateX(tilt)
    return geo.translate(0, r, z).rotateZ(a - Math.PI / 2)
}

/** A chamfered plate standing on edge: the outline is (height, z) and the thickness runs sideways. */
function fin(outline: [number, number][], thickness: number, bevel = 0.06) {
    return slab(outline, thickness, bevel).rotateZ(Math.PI / 2)
}

/** Points a part modelled along +Y down `dir` and pushes it `dist` out from the origin. */
function aim(geo: THREE.BufferGeometry, dir: THREE.Vector3, dist: number) {
    const d = dir.clone().normalize()
    geo.translate(0, dist, 0)
    return geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d))
}

/** Pulls every triangle in towards its own centre, leaving gaps: a shell of loose armour tiles over whatever burns inside. */
function panelled(geo: THREE.BufferGeometry, shrink: number) {
    const g = geo.index ? geo.toNonIndexed() : geo
    const p = g.attributes.position as THREE.BufferAttribute
    const c = new THREE.Vector3()
    const v = new THREE.Vector3()
    for (let i = 0; i < p.count; i += 3) {
        c.set(0, 0, 0)
        for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(p, i + k))
        c.divideScalar(3)
        for (let k = 0; k < 3; k++) {
            v.fromBufferAttribute(p, i + k).lerp(c, 1 - shrink)
            p.setXYZ(i + k, v.x, v.y, v.z)
        }
    }
    return g
}

/** Like `around`, for dressing a tilted plate: `z` runs along the plate and `lift` stands the part off its surface. */
function along(geo: THREE.BufferGeometry, a: number, r: number, z: number, tilt: number, lift = 0, x = 0) {
    return around(geo.translate(x, lift, z), a, r, 0, tilt)
}

/** A row of small lit ports running down an outward-facing surface. */
function ports(b: ModelBuilder, color: number, a: number, r: number, z0: number, count: number, dz: number, x = 0, tilt = 0, intensity = 1.6) {
    for (let i = 0; i < count; i++) b.glow(along(new THREE.BoxGeometry(0.16, 0.05, 0.28), a, r, z0 + i * dz, tilt, 0, x), color, intensity)
}

// ─── Neutral ships and objects ─────────────────────────────────────────────

const HAULER: Livery = { paint: 0x8d8478, paint2: 0x4f4a46, trim: 0x2b2a2c, metal: 0x6b6f78, accent: 0xb8862b, glow: 0xffc44d, glass: 0x0a0e14 }
const CONTAINER_PAINTS = [0x8a5a2b, 0x5b6f8a, 0x7a3b32, 0x4d6b52, 0x8a8468, 0x3f4a5c]
const HAZARD = 0xd9a520
const SOOT = 0x17181c

/** One shipping container lying along Z: corrugated flank, end frames and a status lamp on the outboard side. */
function container(b: ModelBuilder, pos: Vec3, w: number, h: number, l: number, color: number, side: number, lamp: number) {
    b.solid(block(w, h, l, 0.04), color, pos)
    for (const end of [-1, 1]) b.metal(block(w + 0.07, h + 0.07, 0.14, 0.02), shade(color, 0.5), [pos[0], pos[1], pos[2] + end * (l / 2 - 0.07)])
    for (let i = 0; i < 6; i++) {
        const z = pos[2] - l / 2 + 0.3 + (i * (l - 0.6)) / 5
        b.solid(new THREE.BoxGeometry(0.06, h * 0.78, 0.08), shade(color, 0.72), [pos[0] + side * (w / 2 + 0.01), pos[1], z])
        b.solid(new THREE.BoxGeometry(w * 0.78, 0.05, 0.08), shade(color, 0.8), [pos[0], pos[1] + Math.sign(pos[1] || 1) * (h / 2 + 0.01), z])
    }
    b.glow(new THREE.BoxGeometry(0.05, 0.1, 0.24), lamp, 2.2, [pos[0] + side * (w / 2 + 0.04), pos[1] + h * 0.3, pos[2] - l / 2 + 0.34])
}

/** Smuggler hauler: a crew cab on a long truss spine, two decks of mismatched containers, and an engine block far bigger than the law allows. */
function freighter(b: ModelBuilder, glow: number) {
    const l = { ...HAULER, glow }
    const rng = mulberry32(77)
    // Crew cab: stepped nose, wraparound glass, chin sensor.
    const cab: Section[] = [
        { z: -7.3, w: 0.45, h: 0.3, y: 0.35 },
        { z: -6.6, w: 1.25, h: 0.7, y: 0.4 },
        { z: -5.2, w: 1.55, h: 1.0, y: 0.45 },
        { z: -4.2, w: 1.5, h: 1.0, y: 0.45 },
        { z: -3.7, w: 0.9, h: 0.7, y: 0.3 }
    ]
    b.solid(loft(cab, 8, 0.55), l.paint)
    b.solid(loft(cab.slice(1, 4).map(s => ({ ...s, w: s.w + 0.05, h: s.h * 0.34, y: (s.y ?? 0) - s.h * 0.7 })), 8, 0.55), l.paint2)
    b.glass(loft([
        { z: -6.95, w: 0.8, h: 0.16, y: 0.78 },
        { z: -6.3, w: 1.3, h: 0.3, y: 1.0 },
        { z: -5.6, w: 1.2, h: 0.2, y: 1.3 }
    ], 6, 0.6), l.glass)
    b.solid(block(2.2, 0.5, 1.5, 0.08), l.paint2, [0, 1.55, -4.9])
    b.solid(block(1.4, 0.35, 0.9, 0.06), l.accent, [0, 1.95, -4.8])
    for (let i = 0; i < 5; i++) b.glow(new THREE.BoxGeometry(0.2, 0.12, 0.03), WINDOW, 1.6, [-0.72 + i * 0.36, 1.58, -5.67])
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) b.glow(new THREE.BoxGeometry(0.03, 0.13, 0.22), WINDOW, 1.4, [side * 1.56, 0.7, -5.4 + i * 0.4])
    b.metal(cyl(0.04, 0.06, 1.5, 5), l.metal, [0.7, 2.6, -4.6])
    b.glow(octa(0.09), 0xff3040, 3.5, [0.7, 3.4, -4.6])
    b.metal(new THREE.ConeGeometry(0.45, 0.2, 10, 1, true).rotateX(Math.PI), l.metal, [-0.6, 2.35, -4.7], [0.5, 0, 0.2])
    b.metal(ico(0.3, 1), l.trim, [0, -0.55, -6.3])
    b.glow(new THREE.BoxGeometry(1.5, 0.06, 0.05), glow, 2, [0, 0.25, -7.0])
    b.glow(octa(0.08), 0xff3040, 3.5, [-1.62, 0.45, -4.6])
    b.glow(octa(0.08), 0x39ff88, 3.5, [1.62, 0.45, -4.6])
    // Spine: a box keel inside an open truss, fuel tanks slung underneath.
    b.solid(block(1.1, 1.0, 9.4, 0.08), l.trim, [0, 0, 0.6])
    b.metal(tube(0.12, 0.12, 9.2, 6), l.metal, [0.35, 0.62, 0.6], [0, 0, 0], [1, 1, 1], true)
    for (let i = 0; i < 5; i++) {
        const z = -3.65 + i * 2.1
        b.metal(block(5.0, 0.16, 0.2, 0.02), l.metal, [0, 1.42, z])
        b.metal(block(5.0, 0.16, 0.2, 0.02), l.metal, [0, -1.5, z])
        b.metal(block(0.16, 3.0, 0.2, 0.02), l.metal, [2.42, -0.04, z], [0, 0, 0], [1, 1, 1], true)
        b.metal(block(0.3, 3.0, 0.3, 0.03), l.paint2, [0, -0.04, z])
    }
    for (const x of [-2.42, 2.42]) for (const y of [1.42, -1.5]) b.metal(block(0.14, 0.14, 8.6, 0.02), l.metal, [x, y, 0.55])
    tank(b, l, 0x9a9488, [0, -1.0, 2.6], 0.42, 2.6)
    // Two decks of containers, a few slots empty where the cargo was sold off early.
    for (let row = 0; row < 4; row++) {
        for (const side of [-1, 1]) {
            for (const deck of [1, -1]) {
                const roll = rng()
                if (deck < 0 && roll < 0.2) continue
                const color = CONTAINER_PAINTS[Math.floor(rng() * CONTAINER_PAINTS.length)]!
                container(b, [side * 1.47, deck > 0 ? 0.72 : -0.78, -2.6 + row * 2.1], 1.62, 1.3, 1.86, color, side, roll > 0.85 ? 0xff3040 : glow)
            }
        }
    }
    // Engine block: stepped housings, flank intakes, radiators and four nozzles.
    b.solid(block(4.2, 2.8, 2.4, 0.18), l.paint, [0, 0, 5.75])
    b.solid(block(3.4, 2.2, 1.0, 0.12), l.paint2, [0, 0, 7.0])
    b.solid(block(2.4, 0.6, 1.8, 0.1), l.accent, [0, 1.65, 5.6])
    b.solid(block(1.2, 0.4, 1.0, 0.06), l.paint2, [0, 2.1, 5.5])
    for (let i = 0; i < 4; i++) b.glow(new THREE.BoxGeometry(0.16, 0.1, 0.03), WINDOW, 1.5, [-0.42 + i * 0.28, 2.12, 4.98])
    for (const side of [-1, 1]) {
        b.metal(block(0.12, 1.5, 1.5, 0.02), SOOT, [side * 2.12, 0.2, 5.5])
        for (let i = 0; i < 4; i++) b.metal(block(0.16, 0.1, 1.4, 0.01), l.metal, [side * 2.14, -0.3 + i * 0.34, 5.5])
        b.metal(block(1.9, 0.07, 1.7, 0.015), l.trim, [side * 3.1, 1.0, 6.0], [0, 0, side * 0.35])
        for (let i = 0; i < 4; i++) b.glow(new THREE.BoxGeometry(1.6, 0.1, 0.12), 0xff7a2e, 1.5, [side * 3.1, 1.0, 5.4 + i * 0.4], [0, 0, side * 0.35])
        b.glow(new THREE.BoxGeometry(0.05, 0.12, 1.8), glow, 1.8, [side * 2.13, -1.0, 5.75])
    }
    b.metal(tube(0.1, 0.1, 2.2, 6), l.metal, [1.2, 1.5, 5.8], [0, 0, 0], [1, 1, 1], true)
    b.engine([0.95, 0.35, 7.45], 0.72, true, glow)
    b.engine([0.95, -0.85, 7.45], 0.34, true, glow)
}

/** A falling star: a scorched rock whose deepest fractures still show the molten heart. */
function meteor(b: ModelBuilder, glow: number) {
    const rng = mulberry32(4401)
    const cuts = Array.from({ length: 9 }, () => ({
        n: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
        d: 0.95 + rng() * 0.3
    }))
    const cracks = Array.from({ length: 7 }, () => new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize())
    const geo = mergeVertices(ico(1, 7).deleteAttribute('normal').deleteAttribute('uv'))
    const p = geo.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(p.count * 3)
    const v = new THREE.Vector3()
    const cold = new THREE.Color(0x4a3a33)
    const scorched = new THREE.Color(0x1d1614)
    const c = new THREE.Color()
    for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).normalize()
        let r = 1.42 + Math.sin(v.x * 3.1 + 1.3) * Math.sin(v.y * 2.7 + 0.4) * Math.sin(v.z * 3.4 + 2.2) * 0.22
        // Fracture planes shear flat faces off the ball.
        for (const cut of cuts) {
            const along = v.dot(cut.n)
            if (along > 0.05) r = Math.min(r, (cut.d * 1.35) / along)
        }
        // Great-circle cracks sink below the molten core so it shows through.
        let crack = 1
        for (const n of cracks) crack = Math.min(crack, Math.abs(v.dot(n)) / 0.075)
        crack = Math.min(1, crack)
        r -= (1 - crack) * (1 - crack) * 0.34
        c.copy(scorched).lerp(cold, crack * (0.5 + 0.5 * Math.max(0, v.z)))
        colors.set([c.r, c.g, c.b], i * 3)
        p.setXYZ(i, v.x * r, v.y * r * 0.88, v.z * r * 1.08)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const rock = new THREE.Mesh(geo, ROCK_MATERIAL)
    rock.name = 'hull'
    b.extra.push(rock)
    b.glow(ico(1.12, 2), glow, 2.6, [0, 0, 0], [0, 0, 0], [1, 0.88, 1.08])
    // The leading face still burns from the fall.
    for (let i = 0; i < 6; i++) {
        const d = new THREE.Vector3(rng() - 0.5, rng() - 0.5, -0.6 - rng()).normalize()
        b.glow(aim(new THREE.ConeGeometry(0.1 + rng() * 0.08, 0.5 + rng() * 0.4, 4), d, 1.25), 0xffc070, 3)
    }
}

/** Derelict vault: a bank strongbox built to outlive its ship, with a wheel door at each end and lock bars down the flanks. */
function vault(b: ModelBuilder, glow: number) {
    const body = 0x4a525e
    const cast = 0x2c323c
    const steel = 0x757d8a
    b.solid(block(3.2, 2.4, 4.0, 0.22), body)
    for (const y of [-1, 1]) {
        b.solid(block(3.6, 0.42, 4.4, 0.12), cast, [0, y * 1.32, 0])
        b.solid(block(2.6, 0.2, 3.4, 0.06), shade(body, 0.8), [0, y * 1.6, 0])
    }
    // Corner castings and armour ribs.
    for (const x of [-1, 1]) {
        for (const z of [-1, 1]) {
            b.metal(block(0.55, 2.9, 0.55, 0.1), cast, [x * 1.62, 0, z * 2.02])
            b.glow(octa(0.09), glow, 3.5, [x * 1.62, 1.78, z * 2.02])
        }
        for (const z of [-1.0, 0, 1.0]) b.solid(block(0.22, 2.3, 0.4, 0.05), shade(body, 0.72), [x * 1.66, 0, z])
        // Lock bars: three sliding bolts behind a lit status ring.
        b.metal(block(0.16, 0.34, 3.2, 0.04), steel, [x * 1.72, 0.55, 0])
        b.metal(block(0.16, 0.34, 3.2, 0.04), steel, [x * 1.72, -0.55, 0])
        b.metal(cyl(0.62, 0.7, 0.24, 14).rotateZ(Math.PI / 2), cast, [x * 1.72, 0, 0])
        b.glow(ring(0.78, 0.06, 4, 20).rotateY(Math.PI / 2), glow, 3, [x * 1.78, 0, 0])
        b.glow(cyl(0.2, 0.2, 0.06, 8).rotateZ(Math.PI / 2), glow, 2.2, [x * 1.85, 0, 0])
    }
    // Wheel doors, fore and aft.
    for (const z of [-1, 1]) {
        b.metal(tube(1.0, 1.08, 0.3, 18), steel, [0, 0, z * 2.08])
        b.metal(tube(0.78, 0.78, 0.12, 18), shade(steel, 0.6), [0, 0, z * 2.27])
        b.glow(ring(0.9, 0.045, 4, 28), glow, 2.6, [0, 0, z * 2.25])
        b.metal(ring(0.42, 0.055, 5, 16), 0xb8bec8, [0, 0, z * 2.42])
        b.metal(tube(0.12, 0.14, 0.26, 8), 0xb8bec8, [0, 0, z * 2.36])
        for (let i = 0; i < 3; i++) b.metal(block(0.84, 0.07, 0.07, 0.01), 0xb8bec8, [0, 0, z * 2.42], [0, 0, (i / 3) * Math.PI])
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2
            b.metal(tube(0.09, 0.09, 0.16, 6), cast, [Math.cos(a) * 1.22, Math.sin(a) * 1.22, z * 2.04])
        }
        for (let i = 0; i < 3; i++) b.glow(new THREE.BoxGeometry(0.14, 0.08, 0.04), i === 0 ? 0xff3040 : glow, 2.4, [-1.1 + i * 0.22, 0.95, z * 2.02])
        b.solid(block(1.1, 0.26, 0.06, 0.02), HAZARD, [0.8, -0.98, z * 2.01])
        for (let i = 0; i < 3; i++) b.solid(block(0.13, 0.27, 0.07, 0.01), SOOT, [0.45 + i * 0.34, -0.98, z * 2.012], [0, 0, 0.5])
    }
    // Roof: service hatch, conduit and a row of seal lamps.
    b.metal(block(1.2, 0.12, 1.2, 0.04), steel, [0.4, 1.74, 0.6])
    b.metal(ring(0.3, 0.04, 4, 12).rotateX(Math.PI / 2), 0xb8bec8, [0.4, 1.83, 0.6])
    b.metal(tube(0.07, 0.07, 3.0, 6), steel, [-0.95, 1.76, 0])
    for (let i = 0; i < 5; i++) b.glow(new THREE.BoxGeometry(0.16, 0.05, 0.3), glow, 2, [-0.5, 1.72, -1.2 + i * 0.6])
}

/** Proximity mine: loose armour tiles over a live charge, contact spikes in every direction. */
function mine(b: ModelBuilder, glow: number) {
    const spike = 0x8e8a92
    b.glow(ico(0.55, 1), glow, 3.2)
    b.solid(panelled(ico(0.64, 1), 0.8), 0x23242a)
    b.metal(ring(0.66, 0.05, 4, 18), 0x5d5a60)
    b.metal(ring(0.66, 0.05, 4, 18).rotateX(Math.PI / 2), 0x5d5a60)
    const dirs: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) dirs.push([x, y, z])
    for (const [i, d] of dirs.entries()) {
        const dir = new THREE.Vector3(...d)
        const long = i < 6
        b.metal(aim(cyl(0.1, 0.14, 0.14, 6), dir, 0.66), 0x3a3a42)
        b.metal(aim(new THREE.ConeGeometry(0.07, long ? 0.62 : 0.4, 5), dir, long ? 1.0 : 0.88), spike)
        if (long) b.glow(aim(octa(0.05), dir, 1.33), 0xff3040, 3.5)
    }
}

/** Salvage crate: a strapped cargo pod with hazard paint on the lid and a recovery beacon blinking on one corner. */
export function buildCrate(color: number) {
    const b = new ModelBuilder()
    const body = 0x4a525e
    const cast = 0x2c323c
    b.solid(block(2.0, 1.4, 2.8, 0.1), body)
    for (const z of [-1, 1]) {
        b.metal(block(2.14, 1.54, 0.26, 0.05), cast, [0, 0, z * 1.3])
        b.metal(tube(0.04, 0.04, 0.9, 6).rotateY(Math.PI / 2), 0x8a929e, [0, 0.1, z * 1.52])
        for (const x of [-0.45, 0.45]) b.metal(block(0.08, 0.08, 0.14, 0.01), 0x8a929e, [x, 0.1, z * 1.46])
        b.solid(block(0.7, 0.34, 0.04, 0.01), 0x9aa2ae, [-0.5, -0.35, z * 1.435])
    }
    for (const x of [-1, 1]) {
        for (let i = 0; i < 7; i++) b.solid(new THREE.BoxGeometry(0.06, 1.1, 0.1), shade(body, 0.75), [x * 1.01, 0, -0.96 + i * 0.32])
        b.glow(new THREE.BoxGeometry(0.05, 0.1, 1.9), color, 2.6, [x * 1.04, -0.5, 0])
    }
    // Lid with hazard chevrons at both ends.
    b.solid(block(2.08, 0.16, 2.3, 0.04), shade(body, 0.8), [0, 0.74, 0])
    for (const z of [-1, 1]) {
        b.solid(block(1.9, 0.05, 0.34, 0.01), HAZARD, [0, 0.83, z * 0.92])
        for (let i = 0; i < 5; i++) b.solid(block(0.16, 0.06, 0.4, 0.005), SOOT, [-0.72 + i * 0.36, 0.835, z * 0.92], [0, 0.6, 0])
    }
    // Webbing straps with ratchet buckles.
    for (const z of [-0.5, 0.5]) {
        b.solid(block(2.1, 1.5, 0.2, 0.03), 0x9c7a2c, [0, 0, z])
        b.metal(block(0.34, 0.1, 0.3, 0.02), 0x8a929e, [0.35, 0.78, z])
    }
    b.metal(cyl(0.03, 0.05, 0.6, 5), 0x8a929e, [0.8, 1.1, -1.1])
    b.metal(cyl(0.1, 0.12, 0.1, 6), cast, [0.8, 0.85, -1.1])
    b.glow(octa(0.12), color, 4.5, [0.8, 1.46, -1.1])
    b.glow(new THREE.BoxGeometry(0.5, 0.08, 0.04), color, 3, [0.45, -0.35, 1.44])
    b.glow(new THREE.BoxGeometry(0.5, 0.08, 0.04), color, 3, [0.45, -0.35, -1.44])
    return b.build()
}

// ─── Sector wardens ────────────────────────────────────────────────────────
//
// Each warden is a static hull around an exposed reactor, plus a rotating
// `ring` that carries the emitters the boss fires from. Hulls grow and get
// stranger sector by sector; the reactor always sits at the origin, facing -Z.

type WardenDesign = (s: ModelBuilder, r: ModelBuilder, glow: number, arms: number) => void

/** The exposed reactor: a burning ball under loose containment tiles, white flares punching through, gimbal rings around it. */
function reactor(b: ModelBuilder, glow: number, r: number, cage = 0x1c1f26) {
    b.glow(ico(r, 2), glow, 4.2)
    b.glow(octa(r * 1.24), 0xffffff, 3, [0, 0, 0], [0.5, 0.5, 0])
    b.metal(panelled(ico(r * 1.1, 1), 0.72), cage)
    b.metal(ring(r * 1.4, r * 0.05, 4, 28), 0x8a929e, [0, 0, 0], [Math.PI / 2, 0, 0.5])
    b.metal(ring(r * 1.4, r * 0.05, 4, 28), 0x8a929e, [0, 0, 0], [Math.PI / 2, 0, -0.5])
}

function emitter(r: ModelBuilder, glow: number, a: number, radius: number, z: number, size = 0.85) {
    r.glow(octa(size), glow, 4.5, [Math.cos(a) * radius, Math.sin(a) * radius, z])
    r.glow(octa(size * 0.5), 0xffffff, 3.5, [Math.cos(a) * radius, Math.sin(a) * radius, z - size * 0.7])
    r.hardpoint([Math.cos(a) * radius, Math.sin(a) * radius, z], [Math.cos(a), Math.sin(a), 0])
}

/** Halcyon Warden: a navy picket fortress. Four armour petals cowl the reactor, gun decks sit between them, and a lance halo turns around the waist. */
const halcyonWarden: WardenDesign = (s, r, glow, arms) => {
    const armour = 0x7d8a9c
    const dark = 0x232a36
    const white = 0xd5dbe4
    const blue = 0x2c5c9c
    const metal = 0x59616d
    const tilt = -0.1
    reactor(s, glow, 2.3)
    for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2
        s.solid(around(slab([[-0.7, -7], [0.7, -7], [2.5, -2.5], [2.7, 4.5], [-2.7, 4.5], [-2.5, -2.5]], 0.8, 0.12), a, 3.8, 0, tilt), armour)
        s.solid(along(slab([[-0.45, -6.2], [0.45, -6.2], [1.7, -2.3], [1.9, 1.2], [-1.9, 1.2], [-1.7, -2.3]], 0.3, 0.06), a, 3.8, 0, tilt, 0.5), white)
        s.solid(along(block(3.9, 0.3, 0.7, 0.05), a, 3.8, 2.1, tilt, 0.5), blue)
        s.solid(along(block(4.6, 0.5, 1.5, 0.08), a, 3.8, 3.6, tilt, 0.55), dark)
        s.solid(along(block(0.5, 0.2, 4.4, 0.04), a, 3.8, -2.4, tilt, 0.72), blue)
        s.metal(along(slab([[-0.4, -6.4], [0.4, -6.4], [2.0, -2.4], [2.2, 4.0], [-2.2, 4.0], [-2.0, -2.4]], 0.2, 0.04), a, 3.8, 0, tilt, -0.45), dark)
        for (const x of [-1.2, 1.2]) s.glow(along(new THREE.BoxGeometry(0.14, 0.1, 5.2), a, 3.8, 0.8, tilt, -0.58, x), glow, 2.4)
        for (const x of [-1.25, 1.25]) ports(s, WINDOW, a, 4.47, -1.6, 6, 0.45, x, tilt)
        for (let k = 0; k < 4; k++) s.metal(along(block(0.5, 0.18, 0.5, 0.03), a, 3.8, 3.6, tilt, 0.85, -1.5 + k), metal)
    }
    // Gun decks in the gaps between the petals.
    for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2
        s.solid(around(block(2.3, 1.2, 4.4, 0.12), a, 3.2, 0), dark)
        s.solid(around(block(1.7, 0.5, 2.4, 0.08), a, 3.95, 0.6), white)
        s.solid(around(block(1.1, 0.4, 1.2, 0.06), a, 4.35, 0.9), armour)
        for (const x of [-0.6, 0.6]) {
            s.metal(around(tube(0.17, 0.24, 4.0, 8).translate(x, 0.15, 0), a, 3.3, -3.8), metal)
            s.metal(around(tube(0.27, 0.27, 0.5, 8).translate(x, 0.15, 0), a, 3.3, -5.4), dark)
            s.glow(around(tube(0.12, 0.12, 0.04, 8).translate(x, 0.15, 0), a, 3.3, -5.82), glow, 3)
        }
        ports(s, WINDOW, a, 4.22, -0.2, 4, 0.4, 0.62)
    }
    // Aft hull: banded octagonal drum, bridge tower, keel, five engines.
    const hull: Section[] = [{ z: 1.5, w: 2.4, h: 2.4 }, { z: 3.2, w: 3.3, h: 3.3 }, { z: 9, w: 3.0, h: 3.0 }, { z: 12, w: 2.3, h: 2.3 }, { z: 13.2, w: 1.7, h: 1.7 }]
    const oct: [number, number, number] = [8, 0.9, Math.PI / 8]
    s.solid(loft(hull, ...oct), armour)
    band(s, hull, 6.2, 7.2, white, oct, 0.12)
    band(s, hull, 7.35, 7.6, blue, oct, 0.13)
    band(s, hull, 9.4, 11.4, dark, oct, 0.16)
    band(s, hull, 11.6, 11.75, glow, oct, 0.2, 2)
    s.solid(block(2.4, 1.0, 3.8, 0.14), white, [0, 3.4, 8.2])
    s.solid(block(1.6, 0.8, 2.4, 0.1), dark, [0, 4.3, 8.5])
    s.solid(block(1.1, 0.5, 1.3, 0.08), white, [0, 4.95, 8.7])
    for (let i = 0; i < 5; i++) s.glow(new THREE.BoxGeometry(0.2, 0.16, 0.04), WINDOW, 1.8, [-0.56 + i * 0.28, 4.4, 7.28])
    for (let i = 0; i < 7; i++) s.glow(new THREE.BoxGeometry(0.2, 0.14, 0.04), WINDOW, 1.5, [-0.9 + i * 0.3, 3.5, 6.28])
    s.metal(cyl(0.05, 0.09, 2.6, 5), metal, [0.3, 6.4, 8.9])
    s.glow(octa(0.14), 0xff3040, 3.5, [0.3, 7.75, 8.9])
    s.solid(around(fin([[0, -3], [2.4, -1], [2.4, 3], [0, 4.6]], 0.5), -Math.PI / 2, 2.8, 8.5), dark)
    for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2
        s.solid(around(loft([{ z: -3, w: 0.6, h: 0.6 }, { z: -2, w: 1.05, h: 1.05 }, { z: 2.4, w: 1.05, h: 1.05 }, { z: 3, w: 0.9, h: 0.9 }], 10, 0.95), a, 3.7, 9.6), dark)
        s.solid(around(block(1.2, 0.3, 2.6, 0.05), a, 4.7, 9.4), white)
        s.engine([Math.cos(a) * 3.7, Math.sin(a) * 3.7, 12.6], 0.85, false, glow)
        ports(s, WINDOW, a - 0.39, 3.22, 3.8, 9, 0.55)
    }
    s.engine([0, 0, 13.2], 1.25, false, glow)
    // Halo: a bearing collar on the waist, spokes, an armoured hoop and one lance per emitter.
    const z = 5.2
    r.metal(ring(3.75, 0.42, 4, 24), metal, [0, 0, z])
    r.solid(ring(10.5, 0.6, 4, 48), dark, [0, 0, z])
    r.glow(ring(10.5, 0.12, 4, 48), glow, 2, [0, 0, z - 0.68])
    const plates = arms * 6
    for (let i = 0; i < plates; i++) {
        const a = (i / plates) * Math.PI * 2
        if (i % 6 !== 0) r.solid(around(block(2.3, 0.5, 1.5, 0.06), a, 11.0, z), i % 2 ? armour : white)
        if (i % 6 === 3) r.solid(around(block(0.6, 6.6, 0.7, 0.08), a, 7.25, z), armour)
    }
    for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2
        r.solid(around(loft([{ z: -10, w: 0.05, h: 0.05 }, { z: -7, w: 0.4, h: 0.55 }, { z: -1, w: 0.9, h: 1.2 }, { z: 2.5, w: 0.6, h: 0.8 }], 6, 0.7), a, 10.5, z), armour)
        r.solid(around(slab([[-0.3, -6.5], [0.3, -6.5], [0.7, -1], [0.7, 1.6], [-0.7, 1.6], [-0.7, -1]], 0.3, 0.05), a, 11.55, z), white)
        r.solid(around(block(1.5, 0.3, 0.5, 0.04), a, 11.6, z + 0.6), blue)
        r.solid(around(fin([[0, -4], [1.6, -0.5], [1.6, 1.5], [0, 2.2]], 0.3), a + Math.PI, -9.5, z), dark)
        r.glow(around(new THREE.BoxGeometry(0.12, 0.1, 6), a, 9.75, z - 3.6, -0.1), glow, 2.4)
        emitter(r, glow, a, 10.5, z - 10.1)
    }
}

/** Cinder Matriarch: a blast furnace with engines. Hooded furnace mouth, ore jaw, smokestacks, slag tanks and a toothed grinder ring of mining drills. */
const cinderMatriarch: WardenDesign = (s, r, glow, arms) => {
    const rust = 0x70493a
    const soot = 0x221a17
    const iron = 0x4a3d38
    const metal = 0x6e6660
    const l: Livery = { paint: rust, paint2: iron, trim: soot, metal, accent: HAZARD, glow, glass: 0 }
    reactor(s, glow, 2.6, 0x120d0b)
    // Furnace mouth: a barrel of heavy staves with a hazard-painted lip.
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        s.solid(around(block(2.55, 1.0, 5.6, 0.12), a, 4.4, -0.6), i % 2 ? rust : iron)
        s.solid(around(block(2.3, 0.3, 0.5, 0.04), a, 4.95, -3.0), i % 2 ? HAZARD : SOOT)
        s.glow(around(new THREE.BoxGeometry(0.5, 0.08, 3.6), a, 3.86, -1.2), glow, 1.6)
    }
    s.metal(ring(4.7, 0.3, 4, 24), metal, [0, 0, -1.4])
    // Welder's hood above, ore jaw below.
    s.solid(around(slab([[-3.4, -7], [3.4, -7], [4.4, 0.5], [-4.4, 0.5]], 1.0, 0.16), Math.PI / 2, 5.5, 0, 0.14), rust)
    s.solid(along(slab([[-2.6, -6.2], [2.6, -6.2], [3.3, -1.5], [-3.3, -1.5]], 0.35, 0.06), Math.PI / 2, 5.5, 0, 0.14, 0.6), iron)
    for (let i = 0; i < 8; i++) s.solid(along(block(0.8, 0.3, 0.5, 0.03), Math.PI / 2, 5.5, -6.8, 0.14, 0.45, -2.95 + i * 0.84), i % 2 ? SOOT : HAZARD)
    for (const x of [-2, 0, 2]) s.glow(along(new THREE.BoxGeometry(0.9, 0.1, 0.2), Math.PI / 2, 5.5, -6.0, 0.14, -0.56, x), glow, 2.6)
    s.solid(around(slab([[-2.4, -6], [2.4, -6], [3.6, 0.5], [-3.6, 0.5]], 0.9, 0.14), -Math.PI / 2, 5.3, 0, 0.3), iron)
    for (let i = 0; i < 6; i++) s.metal(along(new THREE.ConeGeometry(0.32, 1.6, 5).rotateX(-Math.PI / 2), -Math.PI / 2, 5.3, -6.6, 0.3, -0.1, -2 + i * 0.8), 0xa8a098)
    // Boiler hull with riveted hoops, pipe runs and mite hangars down both flanks.
    s.solid(tube(4.5, 4.9, 9.5, 14), rust, [0, 0, 6.9])
    for (let i = 0; i < 4; i++) s.metal(ring(4.85 + i * 0.1, 0.24, 4, 28), metal, [0, 0, 2.9 + i * 2.7])
    for (let i = 0; i < 9; i++) {
        const a = -0.9 + i * 0.35 + (i > 4 ? Math.PI - 1.4 : 0)
        s.metal(around(tube(0.14, 0.14, 8, 6), a, 4.95, 6.8), i % 3 ? metal : HAZARD)
    }
    for (const side of [-1, 1]) {
        s.solid(block(2.4, 3.0, 6.4, 0.2), iron, [side * 5.6, 1.4, 7.2])
        s.solid(block(1.6, 0.6, 4.4, 0.1), rust, [side * 5.8, 3.1, 7.4])
        for (let k = 0; k < 3; k++) {
            s.metal(block(0.2, 1.3, 1.4, 0.03), SOOT, [side * 6.75, 1.5, 5.4 + k * 1.9])
            s.glow(new THREE.BoxGeometry(0.06, 1.4, 0.08), glow, 2.4, [side * 6.84, 1.5, 4.62 + k * 1.9])
            s.glow(new THREE.BoxGeometry(0.06, 0.08, 1.5), glow, 2.4, [side * 6.84, 2.22, 5.4 + k * 1.9])
        }
        for (const x of [-0.6, 0, 0.6]) barrel(s, l, [side * 5.6 + x, 1.2, 2.4], 3.4, 0.2)
        s.solid(block(2.0, 1.2, 1.2, 0.1), soot, [side * 5.6, 1.2, 4.2])
        tank(s, l, 0x8d6a3a, [side * 5.4, -2.6, 7], 1.35, 5)
        s.metal(block(0.5, 1.6, 0.5, 0.05), metal, [side * 4.9, -1.4, 5.4])
        s.metal(block(0.5, 1.6, 0.5, 0.05), metal, [side * 4.9, -1.4, 8.6])
    }
    for (let i = 0; i < 4; i++) {
        const x = (i % 2 ? 1 : -1) * 1.5
        const z = i < 2 ? 5 : 8.4
        s.metal(cyl(0.6, 0.8, 4.6, 10).rotateX(0.35), soot, [x, 6.4, z + 0.8])
        s.metal(ring(0.7, 0.12, 4, 12).rotateX(Math.PI / 2 + 0.35), metal, [x, 8.3, z + 1.5])
        s.glow(cyl(0.5, 0.5, 0.06, 10).rotateX(0.35), glow, 3, [x, 8.58, z + 1.6])
    }
    // Engine house: stepped block, three main bells inside glowing heat collars.
    s.solid(block(8.4, 6.4, 3.0, 0.3), iron, [0, 0, 12.6])
    s.solid(block(6.4, 4.8, 1.6, 0.2), soot, [0, 0, 14.6])
    s.solid(block(9.0, 0.5, 2.2, 0.08), HAZARD, [0, 3.3, 12.6])
    for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + (i / 3) * Math.PI * 2
        const p: Vec3 = [Math.cos(a) * 1.9, Math.sin(a) * 1.7, 15.4]
        s.engine(p, 1.35, false, glow)
        s.glow(ring(1.9, 0.08, 4, 20), glow, 2, [p[0], p[1], 15.45])
    }
    // Grinder ring: a gear on girders, one mining drill per emitter.
    const z = 2.6
    r.metal(ring(5.45, 0.4, 4, 28), metal, [0, 0, z])
    r.solid(ring(11, 0.95, 4, 8 * arms), soot, [0, 0, z])
    r.glow(ring(10.0, 0.12, 4, 48), glow, 1.8, [0, 0, z - 0.4])
    const teeth = arms * 6
    for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2
        r.solid(around(block(1.35, 1.2, 1.7, 0.1), a, 12.1, z), i % 2 ? rust : iron)
        if (i % 6 === 3) {
            for (const x of [-0.5, 0.5]) r.metal(around(block(0.3, 5.2, 0.5, 0.04).translate(x, 0, 0), a, 8.1, z), metal)
            for (let k = 0; k < 3; k++) r.metal(around(block(1.3, 0.25, 0.4, 0.03), a, 6.6 + k * 1.5, z), HAZARD)
        }
    }
    for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2
        r.solid(around(block(2.6, 2.8, 4.4, 0.2), a, 11, z - 0.6), rust)
        r.solid(around(block(2.0, 0.5, 3.0, 0.08), a, 12.6, z - 0.4), HAZARD)
        for (const x of [-0.6, 0, 0.6]) r.solid(around(block(0.3, 0.52, 3.1, 0.02).rotateY(0.5).translate(x, 0, 0), a, 12.61, z - 0.4), SOOT)
        r.metal(around(tube(1.0, 1.3, 1.6, 10), a, 11, z - 3.4), metal)
        r.metal(around(new THREE.ConeGeometry(1.0, 5.0, 8).rotateX(-Math.PI / 2), a, 11, z - 6.7), 0x9a928a)
        for (let k = 0; k < 4; k++) r.glow(around(ring(0.88 - k * 0.2, 0.06, 4, 12), a, 11, z - 4.7 - k * 1.0), glow, 2.6)
        for (const x of [-1.1, 1.1]) r.metal(around(tube(0.16, 0.16, 3.4, 6).translate(x, -1.0, 0), a, 11, z + 0.4), metal)
        emitter(r, glow, a, 11, z - 9.5, 0.7)
    }
}

/** The Hollow King: an empty lantern of black ribs bound in tarnished gold, a small cold star adrift inside, a trailing cape of blades and a crown that turns. */
const hollowKing: WardenDesign = (s, r, glow, arms) => {
    const black = 0x241d30
    const pitch = 0x110d18
    const gold = 0x9a8246
    const metal = 0x4a4258
    reactor(s, glow, 1.8, 0x08060c)
    s.metal(ring(2.9, 0.1, 4, 28), gold)
    s.metal(ring(2.9, 0.1, 4, 28), gold, [0, 0, 0], [0, Math.PI / 2, 0])
    // Ribs: crescents that leave the middle of the ship empty.
    const outer: [number, number][] = [[1.6, -8.5], [3.9, -6], [5.3, -2], [5.6, 2], [4.9, 6], [3.2, 9.5]]
    const inner: [number, number][] = [[2.4, 9.5], [3.9, 6], [4.5, 2], [4.2, -2], [3.0, -6], [1.2, -8.2]]
    const edge = outer.map(([h, z]) => [h - 0.35, z] as [number, number]).reverse()
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8
        s.solid(around(fin([...outer, ...inner], 0.55, 0.08), a, 0), i % 2 ? black : pitch)
        s.solid(around(fin([...outer, ...edge], 0.7, 0.04), a, 0), gold)
        s.glow(around(new THREE.BoxGeometry(0.08, 0.08, 3.6), a, 4.3, 0), glow, 2.2)
        for (let k = 0; k < 6; k++) s.glow(around(new THREE.BoxGeometry(0.62, 0.12, 0.2), a, 4.75 + (k < 3 ? k * 0.2 : (5 - k) * 0.2), -2.5 + k), WINDOW, 1.3)
        // A needle gun rides every other rib.
        if (i % 2) {
            s.metal(around(tube(0.12, 0.2, 7, 6), a, 5.2, -5.5), metal)
            s.glow(around(octa(0.2), a, 5.2, -9.1), glow, 4)
        }
    }
    s.metal(ring(1.7, 0.32, 4, 16), gold, [0, 0, -8.3])
    s.metal(ring(4.0, 0.16, 4, 32), gold, [0, 0, -5.4])
    s.metal(ring(5.25, 0.2, 4, 32), gold, [0, 0, 0])
    s.metal(ring(4.85, 0.16, 4, 32), gold, [0, 0, 5.6])
    // Throne: the only solid part, carrying the drives around an empty socket.
    const throne: Section[] = [{ z: 8.6, w: 2.2, h: 2.2 }, { z: 10, w: 3.7, h: 3.7 }, { z: 13.5, w: 3.3, h: 3.3 }, { z: 16, w: 2.2, h: 2.2 }]
    const oct: [number, number, number] = [8, 0.85, Math.PI / 8]
    s.solid(loft(throne, ...oct), black)
    band(s, throne, 10.2, 10.7, gold, oct, 0.1)
    band(s, throne, 11.2, 13, pitch, oct, 0.14)
    band(s, throne, 13.4, 13.55, glow, oct, 0.16, 2)
    s.glass(new THREE.CircleGeometry(1.2, 16), 0x020104, [0, 0, 16.02])
    s.glow(ring(1.3, 0.07, 4, 24), glow, 3, [0, 0, 16.05])
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        ports(s, WINDOW, a, 3.72, 11.3, 5, 0.4, -0.5)
        ports(s, WINDOW, a, 3.72, 11.3, 5, 0.4, 0.5)
        if (i % 2 === 0) s.engine([Math.cos(a + Math.PI / 8) * 1.75, Math.sin(a + Math.PI / 8) * 1.75, 16], 0.42, false, glow)
    }
    // Cape: long blades trailing from the throne, and a sceptre spire above it.
    for (const [a, len] of [[-Math.PI / 2, 1], [-Math.PI / 2 - 0.75, 0.8], [-Math.PI / 2 + 0.75, 0.8], [Math.PI / 2 - 1.1, 0.55], [Math.PI / 2 + 1.1, 0.55]] as const) {
        s.solid(around(fin([[0, 0], [2.6 * len, 1.5], [3.6 * len, 9 * len], [2.8 * len, 19 * len], [1.7 * len, 9 * len], [0, 5]], 0.4, 0.08), a, 2.9, 10.5), pitch)
        s.solid(around(fin([[2.6 * len, 1.5], [3.6 * len, 9 * len], [2.8 * len, 19 * len], [3.1 * len, 9 * len]], 0.52, 0.03), a, 2.9, 10.5), gold)
        s.glow(around(octa(0.22), a, 2.9 + 2.8 * len, 10.5 + 19 * len), glow, 4)
    }
    s.metal(cyl(0.06, 0.3, 7, 6), gold, [0, 7, 12])
    s.glow(octa(0.5), glow, 4.5, [0, 10.8, 12])
    s.metal(ring(0.8, 0.06, 4, 16), gold, [0, 10.8, 12], [Math.PI / 2, 0, 0])
    // The crown: a floating circlet, one tall point per emitter and a low point between each pair.
    const z = 1
    const facets = arms * 6
    for (let i = 0; i < facets; i++) r.solid(around(block(2.08, 0.4, 1.9, 0.06), (i / facets) * Math.PI * 2, 11.5, z), i % 2 ? black : pitch)
    for (const dz of [-1, 1]) r.metal(ring(11.6, 0.2, 4, 60), gold, [0, 0, z + dz])
    r.glow(ring(11.2, 0.08, 4, 60), glow, 2, [0, 0, z])
    for (let i = 0; i < arms * 2; i++) {
        const a = (i / (arms * 2)) * Math.PI * 2
        const tall = i % 2 === 0
        const h = tall ? 8.5 : 3.6
        r.solid(around(slab([[-1.15, 0.9], [-0.4, -h * 0.4], [0, -h], [0.4, -h * 0.4], [1.15, 0.9]], 0.45, 0.08), a, 11.6, z), black)
        r.metal(around(slab([[-0.5, 0.3], [0, -h * 0.72], [0.5, 0.3]], 0.2, 0.03), a, 11.9, z), gold)
        r.glow(around(octa(tall ? 0.5 : 0.3), a, 11.95, z + 0.2), glow, 3.5)
        if (tall) emitter(r, glow, a, 11.6, z - h - 0.3, 0.75)
    }
}

/** Womb Sovereign: grown, not built. A segmented egg of chitin over luminous flesh, a lipped mouth full of egg sacs, trailing feelers and a wreath of bone talons. */
const wombSovereign: WardenDesign = (s, r, glow, arms) => {
    const chitin = 0x36503f
    const shell = 0x1b2b23
    const flesh = 0x5e3546
    const bone = 0xb9b398
    const rng = mulberry32(904)
    reactor(s, glow, 2.5, 0x0c1812)
    const body: Section[] = [{ z: -0.6, w: 3.4, h: 3.2 }, { z: 2, w: 4.9, h: 4.5 }, { z: 6, w: 5.5, h: 5.0 }, { z: 10, w: 4.6, h: 4.2 }, { z: 13, w: 3.0, h: 2.8 }, { z: 15, w: 1.5, h: 1.4 }]
    const round: [number, number, number] = [16, 1, 0]
    s.solid(loft(body, ...round), flesh)
    // Overlapping carapace segments; the soft seams between them glow.
    for (const [k, [z0, z1]] of ([[0.2, 3.2], [3.7, 6.7], [7.2, 10.0], [10.5, 12.8]] as const).entries()) {
        band(s, body, z0, z1, k % 2 ? shell : chitin, round, 0.38 - k * 0.04)
        band(s, body, z0 + 0.5, z1 - 1.2, k % 2 ? chitin : shell, round, 0.62 - k * 0.04)
        band(s, body, z1 + 0.15, z1 + 0.35, glow, round, 0.06, 1.8)
    }
    // Bone ribs arch over the back, with a row of spines down the middle.
    for (let i = 0; i < 5; i++) {
        const zz = 1.8 + i * 2.6
        const sec = body[1]!.w + (i < 2 ? i * 0.5 : (4 - i) * 0.45)
        s.solid(new THREE.TorusGeometry(sec + 0.7, 0.26, 5, 16, Math.PI * 1.2).rotateZ(-Math.PI * 0.1), bone, [0, 0, zz], [0, 0, 0], [1, 0.92, 1])
        s.solid(new THREE.ConeGeometry(0.42, 3.4 - i * 0.35, 5).rotateX(0.5), bone, [0, sec * 0.92 + 1.9, zz + 1.6])
    }
    for (let i = 0; i < 26; i++) {
        const a = rng() * Math.PI * 2
        const zz = 1 + rng() * 11
        const sec = body.findIndex(q => q.z > zz)
        const t = (zz - body[sec - 1]!.z) / (body[sec]!.z - body[sec - 1]!.z)
        const w = body[sec - 1]!.w + (body[sec]!.w - body[sec - 1]!.w) * t
        s.glow(ico(0.3 + rng() * 0.35, 1), glow, 2.2, [Math.cos(a) * (w + 0.45), Math.sin(a) * (w + 0.45) * 0.92, zz])
    }
    // Mouth: six lips flared open around the core, teeth and egg sacs inside.
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6
        s.solid(around(loft([{ z: -7.5, w: 0.05, h: 0.05, y: 1.6 }, { z: -5, w: 1.0, h: 0.4, y: 1.0 }, { z: -2, w: 1.9, h: 0.6, y: 0.25 }, { z: 1.2, w: 1.6, h: 0.6 }], 8, 0.9), a, 3.4), chitin)
        s.solid(around(loft([{ z: -6.6, w: 0.05, h: 0.05, y: 1.7 }, { z: -4.6, w: 0.6, h: 0.3, y: 1.35 }, { z: -2, w: 1.2, h: 0.45, y: 0.7 }, { z: 0.6, w: 1.0, h: 0.4, y: 0.5 }], 8, 0.9), a, 3.4), shell)
        s.glow(around(new THREE.BoxGeometry(0.5, 0.08, 4.4), a, 3.05, -2.4, 0.22), glow, 1.8)
        for (let k = 0; k < 3; k++) s.solid(around(new THREE.ConeGeometry(0.2, 1.3, 5).rotateX(-Math.PI / 2 - 0.5).translate(-0.8 + k * 0.8, 0, 0), a, 3.0 + Math.abs(k - 1) * 0.1, -1.6), bone)
        s.glow(ico(0.55 + (i % 2) * 0.2, 1), glow, 2.6, [Math.cos(a + 0.5) * 3.0, Math.sin(a + 0.5) * 3.0, -0.9 - (i % 3) * 0.4])
    }
    // Brood pods on the flanks, where the mites hatch.
    for (const side of [-1, 1]) {
        s.solid(loft([{ z: 2.6, w: 0.4, h: 0.5 }, { z: 4.2, w: 1.5, h: 1.8 }, { z: 7, w: 1.6, h: 1.9 }, { z: 9.4, w: 0.5, h: 0.6 }].map(q => ({ ...q, x: side * 6.3 })), 10, 1), shell)
        for (let k = 0; k < 4; k++) s.glow(new THREE.BoxGeometry(0.1, 2.2 - Math.abs(k - 1.5) * 0.5, 0.22), glow, 2.4, [side * 7.86, 0, 4.3 + k * 0.9])
        for (const zz of [4, 7.6]) s.solid(tube(0.3, 0.3, 2.2, 6).rotateY(Math.PI / 2), bone, [side * 5.4, 0, zz])
    }
    // Feelers trailing aft instead of engines.
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2
        const len = 13 + rng() * 8
        const ph = rng() * 6
        const sections: Section[] = []
        for (let k = 0; k <= 10; k++) {
            const t = k / 10
            const sway = Math.sin(t * 5 + ph) * t * 2.2
            const w = 0.8 * (1 - t) + 0.06
            sections.push({ z: 13.4 + t * len, w, h: w, x: Math.cos(a) * (1.3 + t * 2.5) + Math.cos(a + 1.6) * sway, y: Math.sin(a) * (1.3 + t * 2.5) + Math.sin(a + 1.6) * sway })
        }
        s.solid(loft(sections, 7, 1), i % 2 ? flesh : shell)
        const tip = sections[10]!
        s.glow(ico(0.3, 1), glow, 3.5, [tip.x!, tip.y!, tip.z])
        const mid = sections[5]!
        s.glow(ring(mid.w + 0.06, 0.06, 4, 10), glow, 2, [mid.x!, mid.y!, mid.z])
    }
    s.glow(ico(1.1, 1), glow, 2.4, [0, 0, 15])
    // Wreath: a sinew hoop strung with nodules, one hooked bone talon per emitter.
    const z = 1.5
    r.solid(ring(11.5, 0.32, 5, 60), flesh, [0, 0, z])
    r.glow(ring(11.5, 0.1, 4, 60), glow, 1.6, [0, 0, z - 0.4])
    for (let i = 0; i < arms * 3; i++) {
        const a = (i / (arms * 3)) * Math.PI * 2
        if (i % 3) {
            r.solid(around(ico(0.7, 1), a, 11.5, z), shell)
            r.glow(around(ico(0.34, 1), a, 12.0, z), glow, 2.4)
            r.solid(around(new THREE.ConeGeometry(0.22, 1.8, 5), a, 12.8, z), bone)
        }
    }
    for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2
        r.solid(around(loft([{ z: -9, w: 0.04, h: 0.04, y: -3.6 }, { z: -7, w: 0.35, h: 0.5, y: -2.3 }, { z: -3.5, w: 0.75, h: 1.0, y: -0.7 }, { z: 0, w: 1.05, h: 1.3 }, { z: 2.4, w: 0.6, h: 0.8, y: -0.2 }], 7, 1), a, 11.5, z), bone)
        r.solid(around(loft([{ z: -2.6, w: 0.9, h: 1.2, y: -0.35 }, { z: -1, w: 1.3, h: 1.6 }, { z: 1.6, w: 1.3, h: 1.55 }, { z: 2.8, w: 0.5, h: 0.7, y: -0.2 }], 8, 1), a, 11.5, z), chitin)
        r.glow(around(ico(0.6, 1), a, 13.0, z + 0.3), glow, 2.6)
        r.glow(around(new THREE.BoxGeometry(0.1, 0.1, 3.4), a, 10.0, z - 4.6, -0.42), glow, 2.2)
        emitter(r, glow, a, 7.9, z - 9.2, 0.6)
    }
}

/** Abyssal Leviathan: a living dreadnought. One great eye in a ring of mandibles, a plated skull bristling with guns, a finned body tapering into the dark and a wheel of scythes. */
const abyssalLeviathan: WardenDesign = (s, r, glow, arms) => {
    const obsidian = 0x1d1722
    const pitch = 0x0c0a10
    const crimson = 0x5c1230
    const bone = 0x8d8490
    const metal = 0x3a3440
    const l: Livery = { paint: obsidian, paint2: pitch, trim: pitch, metal, accent: crimson, glow, glass: 0 }
    // The eye: slit pupil, bright iris, armoured lids.
    s.glow(ico(2.7, 2), glow, 4)
    s.solid(octa(1), 0x050306, [0, 0, -2.5], [0, 0, 0], [0.5, 2.0, 0.45])
    s.glow(ring(1.95, 0.09, 4, 32), 0xffffff, 3, [0, 0, -1.95])
    s.glow(ring(2.4, 0.05, 4, 32), 0xffffff, 2, [0, 0, -1.35])
    s.solid(new THREE.SphereGeometry(3.05, 14, 5, 0, Math.PI * 2, 0, 1.05).rotateX(-0.55), obsidian)
    s.solid(new THREE.SphereGeometry(3.05, 14, 5, 0, Math.PI * 2, 0, 0.95).rotateZ(Math.PI).rotateX(0.6), pitch)
    s.solid(new THREE.SphereGeometry(3.2, 14, 3, 0, Math.PI * 2, 0, 0.6).rotateX(-0.75), crimson)
    // Mandibles, long and short by turns, serrated on the inside.
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 2
        const k = i % 2 ? 0.68 : 1
        s.solid(around(loft([{ z: -12 * k, w: 0.05, h: 0.05, y: -1.8 * k }, { z: -8.5 * k, w: 0.65, h: 0.55, y: -0.5 }, { z: -3, w: 1.4, h: 1.0, y: 0.3 }, { z: 2.5, w: 1.9, h: 1.2 }], 6, 0.7), a, 4.6, 0, 0.1), i % 2 ? pitch : obsidian)
        s.solid(around(loft([{ z: -7 * k, w: 0.3, h: 0.2, y: 0.35 }, { z: -3, w: 0.95, h: 0.4, y: 1.15 }, { z: 2, w: 1.3, h: 0.45, y: 1.0 }], 6, 0.6), a, 4.6, 0, 0.1), crimson)
        s.glow(around(new THREE.BoxGeometry(0.12, 0.1, 7 * k), a, 3.75, -3 * k, 0.04), glow, 2.4)
        for (let t = 0; t < 5; t++) s.solid(around(new THREE.ConeGeometry(0.2, 1.1, 4).rotateX(Math.PI + 0.3), a, 3.6 - t * 0.12 * k, (-1.5 - t * 1.5) * k, 0), bone)
    }
    // Skull: stepped brow plates, gun batteries on the temples, lit decks.
    const skull: Section[] = [{ z: 0.5, w: 4.4, h: 4.0 }, { z: 4, w: 6.2, h: 5.2 }, { z: 8, w: 5.6, h: 4.8 }, { z: 10, w: 4.2, h: 3.6 }]
    const hex: [number, number, number] = [10, 0.7, 0]
    s.solid(loft(skull, ...hex), obsidian)
    band(s, skull, 3.2, 5.2, pitch, hex, 0.25)
    band(s, skull, 5.5, 5.75, glow, hex, 0.12, 1.8)
    band(s, skull, 6.2, 8.4, crimson, hex, 0.18)
    for (let k = 0; k < 3; k++) s.solid(slab([[-3.6 + k * 0.7, -2], [3.6 - k * 0.7, -2], [4.2 - k * 0.8, 3], [-4.2 + k * 0.8, 3]], 0.7, 0.12), k % 2 ? crimson : pitch, [0, 5.0 + k * 0.6, 3.4 + k * 1.6], [0.12, 0, 0])
    for (const side of [-1, 1]) {
        for (const y of [2.6, -2.6]) {
            s.solid(block(2.2, 1.4, 3.4, 0.16), pitch, [side * 5.6, y, 4.6])
            s.metal(cyl(0.9, 1.0, 0.5, 10), metal, [side * 5.6, y + Math.sign(y) * 0.9, 4.4])
            for (const x of [-0.45, 0, 0.45]) barrel(s, l, [side * 5.6 + x, y + Math.sign(y) * 1.0, 2.0], 4.2, 0.17)
        }
        for (let row = 0; row < 3; row++) for (let i = 0; i < 8; i++) s.glow(new THREE.BoxGeometry(0.06, 0.16, 0.3), WINDOW, 1.4, [side * (6.32 - row * 0.12), 0.9 - row * 0.9, 3.6 + i * 0.6])
    }
    // Body: six plated segments, each with a dorsal blade and a keel spike, gills glowing between them.
    let z0 = 9.4
    for (let k = 0; k < 6; k++) {
        const w = 5.0 * Math.pow(0.84, k)
        const len = 3.6 - k * 0.15
        s.solid(loft([{ z: z0, w: w * 0.78, h: w * 0.7 }, { z: z0 + 0.6, w, h: w * 0.88 }, { z: z0 + len * 0.8, w: w * 0.9, h: w * 0.8 }, { z: z0 + len + 0.3, w: w * 0.66, h: w * 0.6 }], 10, 0.7), k % 2 ? pitch : obsidian)
        s.solid(slab([[-w * 0.62, 0], [w * 0.62, 0], [w * 0.5, len * 0.8], [-w * 0.5, len * 0.8]], 0.4, 0.08), crimson, [0, w * 0.86, z0 + 0.5], [-0.04, 0, 0])
        s.glow(tube(w * 0.74, w * 0.74, 0.22, 10), glow, 1.7, [0, 0, z0 + len + 0.12], [0, 0, 0], [1, 0.84, 1])
        s.solid(around(fin([[0, -1], [w * 0.95, 1.4], [w * 0.8, 2.4], [0, 2.2]], 0.34, 0.06), Math.PI / 2, w * 0.8, z0 + 0.8), k % 2 ? obsidian : pitch)
        s.solid(around(fin([[0, -0.6], [w * 0.5, 1.6], [0, 1.8]], 0.3, 0.06), -Math.PI / 2, w * 0.78, z0 + 0.8), bone)
        for (const side of [-1, 1]) for (let i = 0; i < 4; i++) s.glow(new THREE.BoxGeometry(0.06, 0.14, 0.26), WINDOW, 1.3, [side * w * 0.985, 0.2, z0 + 0.9 + i * 0.55])
        // Pectoral and pelvic fins give the beast its wingspan.
        if (k === 0 || k === 3) {
            const span = k === 0 ? 11 : 6.5
            s.solid(slab([[0, -1.6], [span, 4.5], [span * 0.92, 6.6], [span * 0.4, 3.6], [0, 2.4]], 0.45, 0.1), obsidian, [w * 0.8, 0, z0 + 1.4], [0, 0, -0.16], [1, 1, 1], true)
            s.solid(slab([[span * 0.25, -0.3], [span, 4.5], [span * 0.96, 5.4]], 0.55, 0.04), crimson, [w * 0.8, 0, z0 + 1.4], [0, 0, -0.16], [1, 1, 1], true)
            for (let i = 0; i < 4; i++) s.glow(new THREE.BoxGeometry(span * (0.7 - i * 0.12), 0.06, 0.1), glow, 2, [w * 0.8 + span * 0.42, 0.3, z0 + 3.2 + i * 0.5], [0, -0.5, -0.16], [1, 1, 1], true)
        }
        z0 += len
    }
    // Tail: flukes and the drive cluster.
    s.solid(slab([[0, -1], [5.2, 3.6], [4.6, 5.2], [0, 1.8]], 0.4, 0.1), pitch, [0.6, 0, z0 - 0.6], [0, 0, 0.5], [1, 1, 1], true)
    s.solid(slab([[0, -1], [5.2, 3.6], [4.6, 5.2], [0, 1.8]], 0.4, 0.1), pitch, [0.6, 0, z0 - 0.6], [0, 0, -0.5], [1, 1, 1], true)
    s.engine([0, 0, z0 + 0.4], 1.1, false, glow)
    s.engine([1.5, 0.2, z0 + 0.1], 0.6, true, glow)
    // A still rune halo inside a turning wheel of scythes.
    s.metal(ring(8.6, 0.22, 4, 48), metal, [0, 0, 3])
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        s.glow(around(new THREE.BoxGeometry(0.9, 0.2, 0.3), a, 8.6, 2.75), glow, 2.6)
        if (i % 4 === 1) s.metal(around(block(0.4, 3.0, 0.5, 0.05), a, 7.2, 3.4), metal)
    }
    const z = 1.8
    r.solid(ring(13, 0.75, 4, 12 * arms), obsidian, [0, 0, z])
    r.solid(ring(13, 0.45, 4, 12 * arms), crimson, [0, 0, z], [0, 0, 0], [1.045, 1.045, 1])
    r.glow(ring(12.1, 0.12, 4, 72), glow, 2.2, [0, 0, z - 0.3])
    for (let i = 0; i < arms * 2; i++) {
        const a = (i / (arms * 2)) * Math.PI * 2
        if (i % 2) {
            r.solid(around(new THREE.ConeGeometry(0.6, 3.6, 5), a, 15.2, z), bone)
            r.solid(around(block(1.8, 1.0, 1.8, 0.12), a, 13.4, z), pitch)
            continue
        }
        r.solid(around(fin([[-1.2, 2.6], [1.4, 2.2], [2.0, -2], [0.9, -6.5], [-2.2, -11], [-0.9, -6], [-0.3, -1.6], [-1.2, 0]], 0.55, 0.1), a, 13, z), obsidian)
        r.solid(around(fin([[1.4, 2.2], [2.0, -2], [0.9, -6.5], [-2.2, -11], [0.5, -6.4], [1.5, -2]], 0.68, 0.04), a, 13, z), crimson)
        r.solid(around(block(2.4, 1.6, 3.0, 0.16), a, 13, z + 0.6), pitch)
        r.glow(around(new THREE.BoxGeometry(0.72, 0.1, 5), a, 12.7, z - 5, 0.32), glow, 2.2)
        emitter(r, glow, a, 10.8, z - 11.2, 0.9)
    }
}

const WARDENS: WardenDesign[] = [halcyonWarden, cinderMatriarch, hollowKing, wombSovereign, abyssalLeviathan]

/** The boss of a sector. `ring` spins during the fight and `emitters` are its firing points, in the ring's own space. */
export function buildWarden(tier: number, glow: number) {
    const arms = 3 + Math.min(3, tier)
    const shellB = new ModelBuilder()
    const rb = new ModelBuilder()
    WARDENS[THREE.MathUtils.clamp(tier, 1, WARDENS.length) - 1]!(shellB, rb, glow, arms)
    const shell = shellB.build()
    const ringModel = rb.build()
    const group = new THREE.Group()
    group.add(shell.group)
    const ringGroup = ringModel.group
    ringGroup.name = 'ring'
    group.add(ringGroup)
    return { group, ring: ringGroup, emitters: ringModel.hardpoints.map(h => h.position), radius: ringModel.radius }
}
