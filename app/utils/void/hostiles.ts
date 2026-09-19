// Void Runner — hostile ship models.

import * as THREE from 'three'
import { ModelBuilder, cyl, ico, mulberry32, octa, ring, tube, type BuiltModel, type Vec3 } from './models'
import { loft, slab, block, barrel, band, tank, vent, dish, greeble, radiator, type Livery, type Section } from './ship-kit'

// ─── Hostiles ──────────────────────────────────────────────────────────────
//
// Enemy hulls share one language: gunmetal armour, dried-blood red paint,
// thin glowing slits in the kind's colour, and sharp forward-leaning shapes.
// Every kind's silhouette gives its trick away: claws swarm, forks snipe,
// walls soak, racks drop mines, rings blink.

const H_ARMOR = 0x5d5a60
const H_DARK = 0x242126
const H_PLATE = 0x403d44
const H_LIGHT = 0x7f7b86
const H_PAINT = 0x8e1f2b
const H_PAINT2 = 0x5c141c
const H_METAL = 0x6b6670
const H_VOID = 0x0c0b0d
const AMBER = 0xffd9a0
const COLD = 0x9fc4ff
const BEACON = 0xff3040

type Pt = [number, number]
const ONE: Vec3 = [1, 1, 1]
const FLAT: Vec3 = [0, 0, 0]

const livery = (glow: number): Livery => ({ paint: H_ARMOR, paint2: H_DARK, trim: H_DARK, metal: H_METAL, accent: H_PAINT, glow, glass: 0 })

/** A slab stood up to face down Z: the outline is (x, y). */
function wall(points: Pt[], thickness: number, bevel = 0.03) {
    return slab(points, thickness, bevel).rotateX(-Math.PI / 2)
}

/** A slab stood on edge along the keel line: the outline is (y, z). */
function fin(points: Pt[], thickness: number, bevel = 0.02) {
    return slab(points, thickness, bevel).rotateZ(Math.PI / 2)
}

/** A spike pointing down -Z. */
function spike(r: number, length: number, sides = 4) {
    return new THREE.ConeGeometry(r, length, sides).rotateX(-Math.PI / 2)
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)

/** A thin glowing slit. */
function slit(b: ModelBuilder, glow: number, pos: Vec3, size: Vec3, intensity = 2.4, mirror = false, rot: Vec3 = FLAT) {
    b.glow(box(...size), glow, intensity, pos, rot, ONE, mirror)
}

/** A panel seam or recess: a black inlay standing a hair proud of the plate. */
function groove(b: ModelBuilder, pos: Vec3, size: Vec3, mirror = false, rot: Vec3 = FLAT) {
    b.metal(box(...size), H_VOID, pos, rot, ONE, mirror)
}

/** A row of lit ports along Z on a flank. */
function ports(b: ModelBuilder, from: Vec3, count: number, spacing: number, size = 0.3, mirror = true, yaw = 0) {
    for (let i = 0; i < count; i++) {
        const z = i * spacing
        b.glow(box(0.04, size * 0.3, size), i % 4 === 1 ? AMBER : COLD, 1.8, [from[0] + Math.sin(yaw) * z, from[1], from[2] + Math.cos(yaw) * z], [0, yaw, 0], ONE, mirror)
    }
}

/** An engine block: an armoured octagonal housing with a collar and cooling fins, ending in a nozzle. */
function drive(b: ModelBuilder, glow: number, pos: Vec3, r: number, mirror = false, color = H_DARK) {
    const [x, y, z] = pos
    b.solid(loft([
        { z: z - r * 2.8, w: r * 0.8, h: r * 0.8, x, y },
        { z: z - r * 1.9, w: r * 1.38, h: r * 1.32, x, y },
        { z: z + r * 0.15, w: r * 1.45, h: r * 1.38, x, y }
    ], 8, 0.6, Math.PI / 8), color, FLAT, FLAT, ONE, mirror)
    b.metal(ring(r * 1.5, r * 0.13, 4, 8), H_METAL, [x, y, z - r * 0.7], [0, 0, Math.PI / 8], ONE, mirror)
    for (const i of [-1, 0, 1]) b.metal(box(r * 0.1, r * 0.45, r * 1.5), H_METAL, [x + i * r * 0.55, y + r * 1.4, z - r * 0.9], FLAT, ONE, mirror)
    b.engine(pos, r, mirror, glow)
}

/** A mast with a red beacon on top. */
function mast(b: ModelBuilder, pos: Vec3, height: number, r = 0.03, mirror = false) {
    b.metal(cyl(r * 0.5, r, height, 5), H_METAL, [pos[0], pos[1] + height / 2, pos[2]], FLAT, ONE, mirror)
    b.glow(octa(r * 2.4), BEACON, 5, [pos[0], pos[1] + height, pos[2]], FLAT, ONE, mirror)
}

/** A twin-barrelled deck turret, fixed forward: dressing, not a hardpoint. */
function deckGun(b: ModelBuilder, glow: number, pos: Vec3, s: number, mirror = false, up = 1) {
    const [x, y, z] = pos
    b.metal(cyl(s * 0.5, s * 0.62, s * 0.3, 8), H_DARK, [x, y + up * s * 0.15, z], FLAT, ONE, mirror)
    b.solid(block(s * 0.9, s * 0.45, s * 1.1, s * 0.08), H_PLATE, [x, y + up * s * 0.5, z + s * 0.05], FLAT, ONE, mirror)
    for (const side of [-1, 1]) {
        b.metal(box(s * 0.13, s * 0.13, s * 1.3), H_METAL, [x + side * s * 0.22, y + up * s * 0.52, z - s * 1.05], FLAT, ONE, mirror)
        b.glow(box(s * 0.09, s * 0.09, s * 0.04), glow, 2.5, [x + side * s * 0.22, y + up * s * 0.52, z - s * 1.71], FLAT, ONE, mirror)
    }
}

/** A contact mine: a dark core, six spikes and a lit equator. */
function mine(b: ModelBuilder, glow: number, pos: Vec3, r: number) {
    b.metal(ico(r, 0), H_DARK, pos)
    const spikes: [Vec3, Vec3][] = [
        [[0, 1, 0], [0, 0, 0]], [[0, -1, 0], [Math.PI, 0, 0]],
        [[1, 0, 0], [0, 0, -Math.PI / 2]], [[-1, 0, 0], [0, 0, Math.PI / 2]],
        [[0, 0, 1], [Math.PI / 2, 0, 0]], [[0, 0, -1], [-Math.PI / 2, 0, 0]]
    ]
    for (const [d, rot] of spikes) b.metal(new THREE.ConeGeometry(r * 0.2, r * 0.7, 4), H_METAL, [pos[0] + d[0] * r * 1.1, pos[1] + d[1] * r * 1.1, pos[2] + d[2] * r * 1.1], rot)
    b.glow(ring(r * 0.93, r * 0.07, 3, 8), glow, 2.6, pos, [Math.PI / 2, 0, 0])
    b.glow(octa(r * 0.22), glow, 4, [pos[0] + r * 0.6, pos[1] + r * 0.6, pos[2] - r * 0.5])
}

const HOSTILE_DESIGNS: Record<string, (b: ModelBuilder, glow: number) => void> = {
    /** Swarmer: a barbed dart with biting mandibles, four scythe claws and one oversized drive. */
    mite(b, glow) {
        const body: Section[] = [
            { z: -1.25, w: 0.04, h: 0.03, y: -0.05 },
            { z: -0.7, w: 0.26, h: 0.17 },
            { z: -0.1, w: 0.44, h: 0.29 },
            { z: 0.55, w: 0.38, h: 0.27 },
            { z: 0.95, w: 0.24, h: 0.19 }
        ]
        b.solid(loft(body, 6, 0.75), H_ARMOR)
        band(b, body, 0.3, 0.6, H_PLATE, [6, 0.75, 0], 0.025)
        // Blood-red carapace over the back, ridged with spines.
        b.solid(loft([
            { z: -0.95, w: 0.08, h: 0.04, y: 0.1 },
            { z: -0.25, w: 0.31, h: 0.13, y: 0.25 },
            { z: 0.55, w: 0.27, h: 0.11, y: 0.24 },
            { z: 0.95, w: 0.12, h: 0.05, y: 0.17 }
        ], 6, 0.6), H_PAINT)
        for (let i = 0; i < 3; i++) b.solid(fin([[0, -0.12], [0.2 - i * 0.03, 0.12], [0.18 - i * 0.03, 0.26], [0, 0.22]], 0.05, 0.012), H_DARK, [0, 0.34, -0.35 + i * 0.4])
        // Mandibles hooking in ahead of the nose.
        b.metal(loft([
            { z: -1.75, w: 0.012, h: 0.02, x: 0.1, y: -0.06 },
            { z: -1.5, w: 0.045, h: 0.07, x: 0.27, y: -0.06 },
            { z: -1.05, w: 0.07, h: 0.1, x: 0.36, y: -0.04 },
            { z: -0.45, w: 0.09, h: 0.08, x: 0.24, y: -0.02 }
        ], 4, 1), H_DARK, FLAT, FLAT, ONE, true)
        b.glow(octa(0.055), glow, 4, [0.3, -0.05, -1.3], FLAT, ONE, true)
        // Scythe claws, swept forward in an X.
        for (const a of [0.55, -0.55]) {
            b.solid(slab([[0.25, 0.55], [0.3, -0.2], [1.12, -1.05], [1.22, -0.78], [0.78, 0.1], [0.62, 0.7]], 0.06, 0.015), H_DARK, FLAT, [0, 0, a], ONE, true)
            b.solid(slab([[0.86, -0.74], [1.12, -1.05], [1.22, -0.78], [0.98, -0.36]], 0.08, 0.015), H_PAINT, FLAT, [0, 0, a], ONE, true)
            b.glow(box(0.3, 0.085, 0.03), glow, 2.2, [0.55, 0, 0.12], [0, 0, a], ONE, true)
        }
        // Eye cluster and flank slits.
        b.glow(octa(0.1), glow, 4.5, [0, 0.13, -0.72])
        b.glow(octa(0.05), glow, 3.5, [0.13, 0.1, -0.6], FLAT, ONE, true)
        slit(b, glow, [0.42, 0.03, 0.2], [0.03, 0.05, 0.5], 2.6, true)
        drive(b, glow, [0, 0, 1.0], 0.18)
        for (const side of [1, -1]) {
            b.metal(tube(0.05, 0.065, 0.3, 6), H_DARK, [side * 0.3, -0.12, 0.85])
            b.glow(new THREE.CircleGeometry(0.04, 6), glow, 2.4, [side * 0.3, -0.12, 1.005])
        }
    },
    /** Strafing fighter: forward-swept gull wings with a cannon on each tip, a chin gun and twin canted tails. */
    raider(b, glow) {
        const l = livery(glow)
        const hull: Section[] = [
            { z: -2.05, w: 0.03, h: 0.03, y: -0.08 },
            { z: -1.35, w: 0.2, h: 0.13, y: -0.03 },
            { z: -0.4, w: 0.4, h: 0.26 },
            { z: 0.6, w: 0.46, h: 0.3 },
            { z: 1.25, w: 0.36, h: 0.24 }
        ]
        b.solid(loft(hull, 8, 0.7), H_ARMOR)
        band(b, hull, -2.05, -1.5, H_PAINT, [8, 0.7, 0], 0.012)
        band(b, hull, -0.2, 0.2, H_PLATE, [8, 0.7, 0], 0.03)
        band(b, hull, 0.85, 1.1, H_DARK, [8, 0.7, 0], 0.035)
        // Armoured cockpit: no glass, only a visor slit.
        b.solid(loft([
            { z: -1.25, w: 0.05, h: 0.03, y: 0.1 },
            { z: -0.75, w: 0.2, h: 0.12, y: 0.26 },
            { z: 0.1, w: 0.25, h: 0.14, y: 0.33 },
            { z: 0.9, w: 0.12, h: 0.06, y: 0.3 }
        ], 6, 0.6), H_DARK)
        slit(b, glow, [0, 0.33, -0.88], [0.3, 0.035, 0.08], 3.2)
        slit(b, glow, [0, 0.475, 0.2], [0.04, 0.02, 0.7], 2)
        // Gull wings, swept forward, with a painted outer panel.
        const droop = -0.2
        b.solid(slab([[0.3, 0.0], [1.7, -0.95], [1.82, -0.55], [1.15, 0.6], [0.3, 0.95]], 0.08, 0.02), H_DARK, FLAT, [0, 0, droop], ONE, true)
        b.solid(slab([[1.02, -0.47], [1.7, -0.95], [1.82, -0.55], [1.3, 0.34]], 0.1, 0.02), H_PAINT, FLAT, [0, 0, droop], ONE, true)
        b.solid(slab([[0.3, 0.25], [0.95, 0.05], [0.8, 0.7], [0.3, 0.85]], 0.11, 0.02), H_ARMOR, FLAT, [0, 0, droop], ONE, true)
        b.glow(box(0.5, 0.115, 0.03), glow, 2.4, [0.72, 0, 0.0], [0, 0.55, droop], ONE, true)
        b.glow(box(0.03, 0.115, 0.4), glow, 1.8, [1.05, 0, 0.3], [0, 0, droop], ONE, true)
        // Wingtip cannon pods.
        const tip: Vec3 = [1.72, -0.35, -0.7]
        b.solid(loft([
            { z: -1.15, w: 0.06, h: 0.06, x: tip[0], y: tip[1] },
            { z: -0.85, w: 0.11, h: 0.11, x: tip[0], y: tip[1] },
            { z: -0.2, w: 0.1, h: 0.1, x: tip[0], y: tip[1] },
            { z: 0.0, w: 0.04, h: 0.04, x: tip[0], y: tip[1] }
        ], 6, 0.8), H_ARMOR, FLAT, FLAT, ONE, true)
        barrel(b, l, [tip[0], tip[1], -1.5], 0.9, 0.04, true)
        // Chin gun and cheek intakes.
        b.metal(block(0.18, 0.12, 0.6, 0.02), H_DARK, [0, -0.24, -0.9])
        barrel(b, l, [0, -0.26, -1.5], 0.8, 0.035)
        vent(b, [0.43, 0.02, -0.45], 0.12, 0.2, 0.4, true)
        // Canted tails and a ventral blade.
        b.solid(fin([[0, 0.35], [0, 1.2], [0.78, 1.5], [0.72, 1.12]], 0.05, 0.015), H_DARK, [0.3, 0.18, 0], [0, 0, -0.45], ONE, true)
        b.solid(fin([[0.45, 0.85], [0.45, 1.36], [0.78, 1.5], [0.72, 1.12]], 0.065, 0.015), H_PAINT, [0.3, 0.18, 0], [0, 0, -0.45], ONE, true)
        b.solid(fin([[0, 0.1], [0, 1.1], [-0.5, 1.35], [-0.42, 0.95]], 0.05, 0.015), H_PLATE, [0, -0.22, 0])
        mast(b, [0, 0.4, 0.75], 0.45, 0.025)
        drive(b, glow, [0.27, 0, 1.3], 0.16, true)
    },
    /** Sniper: the whole ship is a gun. A tuning-fork rail down the centreline, capacitor drums and an X of radiators. */
    lancer(b, glow) {
        const l = livery(glow)
        const hull: Section[] = [
            { z: -1.0, w: 0.3, h: 0.28 },
            { z: 0.3, w: 0.5, h: 0.42 },
            { z: 1.4, w: 0.42, h: 0.36 },
            { z: 1.95, w: 0.26, h: 0.24 }
        ]
        b.solid(loft(hull, 6, 0.8), H_ARMOR)
        band(b, hull, -0.35, 0.15, H_PAINT, [6, 0.8, 0], 0.025)
        band(b, hull, 0.9, 1.25, H_PLATE, [6, 0.8, 0], 0.03)
        // The rails: two armoured tines with lit inner faces.
        b.solid(loft([
            { z: -3.05, w: 0.025, h: 0.07, x: 0.17 },
            { z: -2.6, w: 0.075, h: 0.17, x: 0.215 },
            { z: -0.6, w: 0.11, h: 0.24, x: 0.27 }
        ], 4, 0.35, Math.PI / 4), H_DARK, FLAT, FLAT, ONE, true)
        b.solid(fin([[-0.2, -2.5], [0.2, -2.5], [0.28, -0.7], [-0.28, -0.7]], 0.05, 0.015), H_PAINT, [0.36, 0, 0], FLAT, ONE, true)
        slit(b, glow, [0.135, 0, -1.7], [0.02, 0.07, 2.2], 2.6, true)
        // Accelerator clamps and coils between the tines.
        for (let i = 0; i < 5; i++) {
            const z = -2.5 + i * 0.42
            b.glow(ring(0.17, 0.022, 3, 10), glow, 2.2 + i * 0.3, [0, 0, z])
            for (const y of [0.27, -0.27]) b.metal(block(0.62, 0.07, 0.13, 0.015), i % 2 ? H_METAL : H_PLATE, [0, y, z])
        }
        b.glow(octa(0.1), glow, 5, [0, 0, -2.75])
        b.metal(tube(0.1, 0.13, 1.0, 8), H_VOID, [0, 0, -0.9])
        // Capacitor drums on the flanks.
        tank(b, l, H_PLATE, [0.66, -0.05, 0.45], 0.2, 1.1, true)
        for (const z of [0.05, 0.45, 0.85]) b.glow(ring(0.215, 0.018, 3, 10), glow, 1.8, [0.66, -0.05, z], FLAT, ONE, true)
        b.metal(block(0.3, 0.1, 0.5, 0.02), H_DARK, [0.45, -0.05, 0.45], FLAT, ONE, true)
        // Scope on the spine.
        b.metal(block(0.12, 0.2, 0.4, 0.02), H_DARK, [0, 0.47, 0.2])
        b.metal(tube(0.085, 0.11, 1.2, 8), H_METAL, [0, 0.62, -0.1])
        b.glow(new THREE.CircleGeometry(0.07, 8).rotateY(Math.PI), glow, 3.5, [0, 0.62, -0.705])
        // Radiators in an X, coils lit.
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            b.solid(slab([[0.3, 0.75], [1.35, 1.55], [1.3, 2.0], [0.3, 1.75]], 0.05, 0.012), i % 2 ? H_PAINT : H_DARK, FLAT, [0, 0, a])
            for (let k = 0; k < 3; k++) b.glow(box(0.5, 0.06, 0.03), glow, 1.6, [0.85, 0, 1.4 + k * 0.14], [0, 0, a])
        }
        // Steadying canards under the rails.
        b.solid(slab([[0.3, -1.3], [0.85, -0.95], [0.85, -0.8], [0.3, -0.85]], 0.04, 0.012), H_PLATE, [0, -0.12, 0], [0, 0, -0.3], ONE, true)
        mast(b, [0, 0.4, 1.3], 0.5, 0.025)
        drive(b, glow, [0, 0, 2.0], 0.2)
    },
    /** Shield ship: a three-panel tower shield of stacked plate carried ahead of a squat armoured hull. */
    bulwark(b, glow) {
        const hull: Section[] = [
            { z: -1.7, w: 1.25, h: 0.9 },
            { z: -0.6, w: 1.6, h: 1.15 },
            { z: 1.6, w: 1.5, h: 1.05 },
            { z: 2.4, w: 1.0, h: 0.7 }
        ]
        b.solid(loft(hull, 8, 0.5, Math.PI / 8), H_ARMOR)
        band(b, hull, -0.3, 0.3, H_PLATE, [8, 0.5, Math.PI / 8], 0.06)
        band(b, hull, 1.0, 1.35, H_LIGHT, [8, 0.5, Math.PI / 8], 0.05)
        band(b, hull, 1.9, 2.15, H_DARK, [8, 0.5, Math.PI / 8], 0.05)
        // The shield: centre panel and two raked wings, each three plates deep.
        const centre = (w: number, h: number, c: number): Pt[] => [[-w, -h + c], [-w + c, -h], [w - c, -h], [w, -h + c], [w, h - c], [w - c, h], [-w + c, h], [-w, h - c]]
        b.solid(wall(centre(1.3, 1.4, 0.35), 0.22, 0.06), H_DARK, [0, 0, -2.3])
        b.solid(wall(centre(1.08, 1.15, 0.3), 0.2, 0.05), H_ARMOR, [0, 0, -2.48])
        b.solid(wall(centre(0.8, 0.85, 0.25), 0.18, 0.05), H_PAINT, [0, 0, -2.64])
        const rake = -0.55
        b.solid(wall([[0, -1.4], [1.5, -0.85], [1.5, 0.85], [0, 1.4]], 0.2, 0.06), H_DARK, [1.32, 0, -2.28], [0, rake, 0], ONE, true)
        b.solid(wall([[0.15, -1.1], [1.3, -0.68], [1.3, 0.68], [0.15, 1.1]], 0.18, 0.05), H_ARMOR, [1.23, 0, -2.44], [0, rake, 0], ONE, true)
        b.solid(wall([[0.35, -0.75], [1.05, -0.5], [1.05, 0.5], [0.35, 0.75]], 0.16, 0.04), H_PAINT2, [1.15, 0, -2.58], [0, rake, 0], ONE, true)
        for (let i = 0; i < 3; i++) slit(b, glow, [0, -0.5 + i * 0.5, -2.74], [1.2 - Math.abs(i - 1) * 0.3, 0.05, 0.04], 2.8)
        for (const x of [0.55, 0.85]) slit(b, glow, [1.15 + x * Math.cos(rake), 0, -2.58 - 0.09 - x * Math.sin(rake)], [0.04, 0.8 - x * 0.3, 0.04], 2.4, true, [0, rake, 0])
        // Field projectors at the shield's corners, braced back to the hull.
        for (const y of [1.0, -1.0]) {
            b.metal(spike(0.09, 0.7, 5), H_METAL, [1.05, y, -2.95], FLAT, ONE, true)
            b.glow(octa(0.07), glow, 4.5, [1.05, y, -3.32], FLAT, ONE, true)
            b.metal(box(0.16, 0.16, 1.0), H_DARK, [1.0, y * 0.78, -1.85], FLAT, ONE, true)
        }
        b.metal(block(1.6, 1.2, 0.7, 0.08), H_PLATE, [0, 0, -1.95])
        // Stepped flank armour.
        for (let i = 0; i < 3; i++) {
            b.solid(fin([[-0.75, -0.55], [0.75, -0.55], [0.6, 0.6], [-0.6, 0.6]], 0.22, 0.05), i % 2 ? H_DARK : H_PLATE, [1.68 - i * 0.02, -0.05, -0.55 + i * 1.05], [0, 0, 0.1], ONE, true)
            slit(b, glow, [1.83, -0.05, 0.05 + i * 1.05], [0.04, 0.7, 0.05], 2, true)
        }
        // Citadel and turrets firing over the shield.
        b.solid(block(1.7, 0.45, 2.4, 0.1), H_PLATE, [0, 1.3, 0.7])
        b.solid(block(1.0, 0.4, 1.2, 0.08), H_LIGHT, [0, 1.7, 1.1])
        slit(b, AMBER, [0, 1.74, 0.49], [0.8, 0.08, 0.04], 3)
        b.solid(slab([[-0.3, -1.4], [0.3, -1.4], [0.45, 0.4], [-0.45, 0.4]], 0.08, 0.02), H_PAINT, [0, 1.56, 0])
        deckGun(b, glow, [0.95, 1.12, -0.7], 0.75, true)
        mast(b, [-0.3, 1.9, 1.4], 0.9, 0.035)
        dish(b, livery(glow), [0.3, 1.9, 1.4], 0.28)
        // Keel, belly lights and drives.
        b.solid(fin([[0, -1.2], [0, 2.0], [-0.7, 1.7], [-0.5, -0.6]], 0.3, 0.06), H_DARK, [0, -1.05, 0])
        slit(b, glow, [0, -1.7, 0.6], [0.06, 0.06, 1.8], 1.8)
        ports(b, [1.56, 0.55, -0.9], 6, 0.5, 0.26)
        drive(b, glow, [0.62, 0.05, 2.5], 0.34, true)
        drive(b, glow, [1.3, -0.35, 2.0], 0.17, true, H_PLATE)
    },
    /** Minelayer: a fat hauler with an open rack of spiked mines down each flank and a drop chute astern. */
    minelayer(b, glow) {
        const hull: Section[] = [
            { z: -2.05, w: 0.4, h: 0.32, y: 0.12 },
            { z: -1.35, w: 0.95, h: 0.75 },
            { z: 0.8, w: 1.05, h: 0.82 },
            { z: 1.95, w: 0.82, h: 0.62 }
        ]
        b.solid(loft(hull, 8, 0.55, Math.PI / 8), H_ARMOR)
        band(b, hull, -2.05, -1.7, H_PAINT, [8, 0.55, Math.PI / 8], 0.02)
        band(b, hull, -0.9, -0.55, H_PLATE, [8, 0.55, Math.PI / 8], 0.04)
        band(b, hull, 0.45, 0.8, H_PLATE, [8, 0.55, Math.PI / 8], 0.04)
        band(b, hull, 1.5, 1.75, H_DARK, [8, 0.55, Math.PI / 8], 0.04)
        // Bridge block up front, hazard-red roof.
        b.solid(block(1.0, 0.4, 1.1, 0.08), H_PLATE, [0, 0.92, -0.9])
        b.solid(block(0.7, 0.12, 0.8, 0.03), H_PAINT, [0, 1.17, -0.85])
        slit(b, AMBER, [0, 0.98, -1.46], [0.75, 0.08, 0.04], 3)
        mast(b, [0.3, 1.2, -0.6], 0.7, 0.03)
        // Mine racks: open frames, three armed mines a side.
        for (const y of [0.45, -0.5]) {
            b.metal(box(0.09, 0.09, 3.0), H_METAL, [1.95, y, 0.35], FLAT, ONE, true)
            b.metal(box(0.09, 0.09, 3.0), H_METAL, [1.2, y, 0.35], FLAT, ONE, true)
        }
        for (let i = 0; i < 4; i++) {
            const z = -1.1 + i * 0.97
            b.metal(box(0.08, 1.0, 0.08), H_DARK, [1.95, -0.02, z], FLAT, ONE, true)
            b.metal(box(0.95, 0.08, 0.08), H_DARK, [1.5, 0.45, z], FLAT, ONE, true)
            b.metal(box(0.95, 0.08, 0.08), H_DARK, [1.5, -0.5, z], FLAT, ONE, true)
        }
        for (let i = 0; i < 3; i++) {
            for (const side of [1, -1]) mine(b, glow, [side * 1.55, -0.02, -0.62 + i * 0.97], 0.3)
        }
        b.solid(slab([[1.0, -1.35], [1.9, -1.15], [2.08, 1.7], [1.0, 1.95]], 0.1, 0.03), H_PAINT, [0, 0.52, 0], FLAT, ONE, true)
        slit(b, glow, [2.04, 0.57, 0.3], [0.04, 0.05, 2.4], 2.2, true)
        b.glow(octa(0.07), AMBER, 4, [1.95, 0.62, -1.15], FLAT, ONE, true)
        // Drop chute astern, a mine already on the rail.
        b.metal(block(1.0, 0.75, 0.7, 0.05), H_DARK, [0, -0.2, 2.1])
        b.glow(box(0.8, 0.55, 0.03), glow, 1.4, [0, -0.2, 2.2])
        groove(b, [0, -0.2, 2.46], [0.84, 0.6, 0.02])
        mine(b, glow, [0, -0.2, 2.5], 0.26)
        for (const x of [0.35, -0.35]) b.metal(box(0.05, 0.05, 0.9), H_METAL, [x, -0.5, 2.35])
        // Loading crane, nose sensor and belly tanks.
        b.metal(cyl(0.06, 0.08, 0.5, 6), H_METAL, [0, 1.0, 0.9])
        b.metal(box(0.08, 0.08, 1.5), H_METAL, [0, 1.25, 1.5], [0.12, 0, 0])
        b.glow(octa(0.06), AMBER, 4, [0, 1.12, 2.22])
        b.glow(octa(0.14), glow, 4, [0, 0.12, -2.1])
        for (const side of [1, -1]) b.metal(spike(0.04, 0.6, 4), H_METAL, [side * 0.22, 0.12, -2.2])
        tank(b, livery(glow), H_PLATE, [0.45, -0.85, 0.2], 0.22, 1.4, true)
        ports(b, [1.0, 0.35, -1.2], 3, 0.35, 0.22)
        drive(b, glow, [0.6, 0.42, 2.05], 0.2, true)
    },
    /** Leech: a segmented siphon with four hooked grapple arms spread around a tether emitter. */
    leech(b, glow) {
        const segs = 5
        for (let i = 0; i < segs; i++) {
            const r = 0.58 - i * 0.075
            const z = i * 0.52
            b.solid(loft([
                { z: z - 0.24, w: r * 0.7, h: r * 0.7 },
                { z: z - 0.05, w: r, h: r },
                { z: z + 0.27, w: r * 0.78, h: r * 0.78 }
            ], 8, 0.85, Math.PI / 8), i % 2 ? H_DARK : H_ARMOR)
            b.solid(loft([
                { z: z - 0.12, w: r * 0.6, h: r * 0.3, y: r * 0.78 },
                { z: z + 0.2, w: r * 0.5, h: r * 0.22, y: r * 0.74 }
            ], 4, 0.6, Math.PI / 4), H_PAINT)
            if (i < segs - 1) b.glow(ring(r * 0.72, 0.03, 3, 12), glow, 2, [0, 0, z + 0.27])
        }
        // Armoured collar carrying the arms.
        b.metal(tube(0.5, 0.66, 0.3, 8), H_PLATE, [0, 0, -0.35], [0, 0, Math.PI / 8])
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            const c = Math.cos(a)
            const s = Math.sin(a)
            b.metal(loft([
                { z: -2.0, w: 0.015, h: 0.015, x: c * 0.5, y: s * 0.5 },
                { z: -1.72, w: 0.06, h: 0.06, x: c * 0.95, y: s * 0.95 },
                { z: -1.3, w: 0.085, h: 0.085, x: c * 1.08, y: s * 1.08 },
                { z: -0.75, w: 0.1, h: 0.1, x: c * 0.9, y: s * 0.9 },
                { z: -0.25, w: 0.13, h: 0.13, x: c * 0.42, y: s * 0.42 }
            ], 5, 1, a), H_DARK)
            b.solid(octa(0.2), H_PAINT, [c * 1.1, s * 1.1, -1.25], [0, 0, a], [1.1, 0.7, 1.7])
            b.glow(octa(0.06), glow, 4, [c * 1.22, s * 1.22, -1.25])
            b.metal(tube(0.035, 0.035, 0.7, 5), H_METAL, [c * 0.5, s * 0.5, -0.6], [s * 0.6, -c * 0.6, 0])
        }
        // Tether emitter: a dish, a hot core and two focusing rings.
        b.metal(new THREE.ConeGeometry(0.42, 0.35, 10, 1, true).rotateX(Math.PI / 2), H_METAL, [0, 0, -0.62])
        b.glow(ico(0.17, 1), glow, 4.5, [0, 0, -0.62])
        b.glow(ring(0.26, 0.025, 3, 12), glow, 3, [0, 0, -0.95])
        b.glow(ring(0.16, 0.02, 3, 10), glow, 3.4, [0, 0, -1.25])
        // Siphon tanks glowing with what it has drained.
        tank(b, livery(glow), H_PLATE, [0.6, -0.1, 0.7], 0.15, 0.9, true)
        slit(b, glow, [0.76, -0.1, 0.7], [0.03, 0.08, 0.6], 2.6, true)
        b.metal(tube(0.03, 0.03, 0.6, 5), H_METAL, [0.5, -0.1, 0.1], [0, -0.5, 0], ONE, true)
        // Tail fins and drive.
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + Math.PI / 2
            b.solid(slab([[0.2, 1.5], [0.8, 2.2], [0.75, 2.5], [0.2, 2.3]], 0.05, 0.012), i ? H_DARK : H_PAINT, FLAT, [0, 0, a])
        }
        drive(b, glow, [0, 0, 2.4], 0.17)
    },
    /** Blinker: a diamond dagger flying inside its own phase ring, six armour arcs over a live coil. */
    blinker(b, glow) {
        const hull: Section[] = [
            { z: -1.75, w: 0.02, h: 0.02 },
            { z: -0.5, w: 0.42, h: 0.5 },
            { z: 0.5, w: 0.36, h: 0.44 },
            { z: 1.3, w: 0.16, h: 0.18 }
        ]
        b.solid(loft(hull, 4, 1), H_ARMOR)
        band(b, hull, -1.2, -0.45, H_PAINT, [4, 1, 0], 0.02)
        band(b, hull, 0.1, 0.4, H_PLATE, [4, 1, 0], 0.03)
        slit(b, glow, [0, 0.4, 0.0], [0.04, 0.2, 0.9], 2.4)
        slit(b, glow, [0, -0.4, 0.0], [0.04, 0.2, 0.9], 2.4)
        // Emitter fork under the nose.
        for (const side of [1, -1]) b.metal(spike(0.05, 0.9, 4), H_METAL, [side * 0.2, -0.05, -1.5])
        b.glow(octa(0.12), glow, 5, [0, -0.05, -1.62])
        // The phase ring.
        const R = 1.5
        const arc = Math.PI / 3 - 0.3
        for (let i = 0; i < 6; i++) {
            const a0 = (i / 6) * Math.PI * 2 + 0.15
            b.solid(new THREE.TorusGeometry(R, 0.13, 4, 4, arc), i % 2 ? H_PAINT : H_DARK, [0, 0, 0.1], [0, 0, a0])
            for (const a of [a0, a0 + arc]) b.metal(block(0.34, 0.3, 0.36, 0.04), H_METAL, [Math.cos(a) * R, Math.sin(a) * R, 0.1], [0, 0, a])
            const m = a0 + arc / 2
            b.metal(spike(0.06, 0.7, 4), H_METAL, [Math.cos(m) * R, Math.sin(m) * R, -0.35])
            b.glow(octa(0.05), glow, 4.5, [Math.cos(m) * R, Math.sin(m) * R, -0.72])
        }
        b.glow(ring(R, 0.06, 4, 36), glow, 2.6, [0, 0, 0.1])
        b.glow(ring(R - 0.17, 0.02, 3, 36), glow, 1.6, [0, 0, 0.1])
        // Vanes holding the ring, and a gyro coil round the hull.
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + Math.PI / 2
            b.solid(slab([[0.25, -0.3], [1.4, -0.08], [1.4, 0.3], [0.25, 0.6]], 0.06, 0.015), H_PLATE, FLAT, [0, 0, a])
            b.glow(box(0.8, 0.075, 0.03), glow, 1.8, [0.85, 0, 0.12], [0, 0, a])
        }
        b.metal(ring(0.78, 0.04, 4, 20), H_METAL, [0, 0, 0.1], [Math.PI / 2, 0, 0])
        b.glow(ring(0.78, 0.015, 3, 20), glow, 2, [0, 0.045, 0.1], [Math.PI / 2, 0, 0])
        drive(b, glow, [0, 0, 1.4], 0.17)
    },
    /** Brood carrier: a jawed hive ship with a hangar gallery of open bays down each flank. */
    carrier(b, glow) {
        const l = livery(glow)
        const hull: Section[] = [
            { z: -5.6, w: 1.3, h: 0.8 },
            { z: -4.4, w: 2.3, h: 1.35 },
            { z: 3.4, w: 2.5, h: 1.5 },
            { z: 5.0, w: 1.7, h: 1.05 }
        ]
        b.solid(loft(hull, 8, 0.5, Math.PI / 8), H_ARMOR)
        band(b, hull, -4.2, -3.6, H_PLATE, [8, 0.5, Math.PI / 8], 0.06)
        band(b, hull, -2.2, -1.2, H_LIGHT, [8, 0.5, Math.PI / 8], 0.05)
        band(b, hull, 4.0, 4.5, H_DARK, [8, 0.5, Math.PI / 8], 0.06)
        // Jawed prow around the forward launch mouth.
        b.metal(block(2.3, 1.3, 0.5, 0.05), H_VOID, [0, -0.05, -5.5])
        b.glow(box(2.0, 1.0, 0.03), glow, 1.1, [0, -0.05, -5.7])
        for (let i = 0; i < 4; i++) b.glow(box(0.06, 1.0, 0.06), AMBER, 2.6, [-0.9 + i * 0.6, -0.05, -5.78])
        b.solid(slab([[-1.2, -6.6], [1.2, -6.6], [2.35, -4.3], [-2.35, -4.3]], 0.3, 0.06), H_PAINT, [0, 0.85, 0])
        b.solid(slab([[-1.0, -6.3], [1.0, -6.3], [2.2, -4.3], [-2.2, -4.3]], 0.3, 0.06), H_DARK, [0, -0.95, 0])
        for (const x of [-0.8, -0.27, 0.27, 0.8]) {
            b.metal(new THREE.ConeGeometry(0.12, 0.5, 4).rotateX(Math.PI), H_METAL, [x, 0.5, -6.3])
            b.metal(new THREE.ConeGeometry(0.12, 0.5, 4), H_METAL, [x * 0.9, -0.6, -6.05])
        }
        slit(b, glow, [0, 1.02, -5.4], [1.6, 0.04, 0.08], 2.6)
        // Hangar galleries: three open bays a side with lit interiors and landing sills.
        b.solid(block(1.3, 1.7, 5.9, 0.12), H_PLATE, [2.95, -0.4, 2.45], FLAT, ONE, true)
        b.solid(slab([[2.3, -0.9], [3.5, -0.5], [3.5, 5.2], [2.3, 5.5]], 0.16, 0.04), H_PAINT, [0, 0.52, 0], FLAT, ONE, true)
        b.solid(slab([[2.2, -2.2], [3.45, -0.55], [2.4, -0.45]], 1.2, 0.08), H_DARK, [0, -0.4, 0], FLAT, ONE, true)
        for (let i = 0; i < 3; i++) {
            const z = 0.7 + i * 1.75
            b.metal(box(0.5, 1.05, 1.35), H_VOID, [3.37, -0.45, z], FLAT, ONE, true)
            b.glow(box(0.03, 0.85, 1.15), glow, 1.3, [3.5, -0.45, z], FLAT, ONE, true)
            b.glow(box(0.06, 0.05, 1.35), AMBER, 2.6, [3.63, 0.1, z], FLAT, ONE, true)
            b.solid(block(0.4, 0.08, 1.5, 0.02), H_LIGHT, [3.75, -1.0, z], FLAT, ONE, true)
            b.glow(box(0.3, 0.03, 0.04), glow, 2.4, [3.78, -0.95, z - 0.55], FLAT, ONE, true)
            b.glow(box(0.3, 0.03, 0.04), glow, 2.4, [3.78, -0.95, z + 0.55], FLAT, ONE, true)
            b.metal(box(0.14, 1.5, 0.22), H_METAL, [3.58, -0.4, z + 0.875], FLAT, ONE, true)
        }
        // Dorsal decks in steps, a lit trench down the middle.
        b.solid(slab([[-1.6, -4.3], [1.6, -4.3], [2.05, 3.7], [-2.05, 3.7]], 0.4, 0.08), H_PLATE, [0, 1.6, 0])
        b.solid(slab([[0.35, -3.6], [0.9, -3.6], [1.25, 1.6], [0.35, 1.6]], 0.25, 0.05), H_PAINT, [0, 1.9, 0], FLAT, ONE, true)
        groove(b, [0, 1.81, -1.0], [0.5, 0.04, 5.0])
        slit(b, glow, [0, 1.84, -1.0], [0.08, 0.04, 4.6], 2)
        greeble(b, l, [1.55, 1.8, -0.5], 0.6, 5.5, 14, 11, true)
        for (let i = 0; i < 5; i++) groove(b, [0, 1.81, -3.4 + i * 1.5], [3.4 + i * 0.12, 0.03, 0.05])
        // Command tower aft.
        b.solid(block(2.2, 0.9, 2.3, 0.12), H_ARMOR, [0, 2.25, 2.6])
        b.solid(block(1.5, 0.75, 1.5, 0.1), H_LIGHT, [0, 3.05, 2.85])
        b.solid(block(2.4, 0.4, 0.9, 0.08), H_PLATE, [0, 3.55, 2.75])
        slit(b, AMBER, [0, 3.58, 2.28], [2.1, 0.1, 0.04], 3)
        ports(b, [1.11, 2.3, 1.8], 4, 0.45, 0.25)
        b.solid(block(0.9, 0.12, 0.6, 0.03), H_PAINT, [0, 2.76, 1.7])
        mast(b, [0.5, 3.75, 3.0], 1.6, 0.05)
        mast(b, [-0.7, 3.75, 3.1], 1.0, 0.04)
        dish(b, l, [-0.2, 3.75, 2.6], 0.4)
        deckGun(b, glow, [1.2, 1.8, -2.6], 0.8, true)
        // Flank ports, brood pods under the belly and a keel.
        ports(b, [2.42, 0.55, -3.9], 8, 0.45, 0.3)
        ports(b, [2.47, -0.5, -3.7], 6, 0.5, 0.3)
        b.solid(fin([[0, -3.6], [0, 3.8], [-0.9, 3.2], [-0.6, -1.6]], 0.4, 0.08), H_DARK, [0, -1.4, 0])
        for (let i = 0; i < 3; i++) {
            b.solid(ico(0.55, 1), H_PAINT2, [0.95, -1.6, -2.6 + i * 1.5], FLAT, [1, 0.8, 1.25], true)
            b.glow(ring(0.4, 0.035, 3, 10), glow, 2.2, [0.95, -1.98, -2.6 + i * 1.5], [Math.PI / 2, 0, 0], ONE, true)
        }
        slit(b, glow, [0, -2.32, 0.6], [0.08, 0.06, 4.0], 1.8)
        // Drives.
        b.solid(block(3.6, 2.0, 0.9, 0.12), H_DARK, [0, 0.05, 4.75])
        drive(b, glow, [1.25, 0, 5.3], 0.66, true, H_PLATE)
        drive(b, glow, [0, 0.35, 5.3], 0.55, false, H_PLATE)
        b.engine([2.95, -0.4, 5.45], 0.3, true, glow)
    },
    /**
     * The mothership: a ninety-metre wedge carrier. A forked prow around a
     * spinal emitter, stacked decks over a lit waist trench, armour panels in
     * broken shades, a hammerhead command tower, an open hangar in each flank
     * and one in the belly, and a stern that is all engine.
     */
    mothership(b, glow) {
        const rnd = mulberry32(7)
        type Deck = { nose: number, stern: number, half: number, y: number, t: number }
        const halfAt = (d: Deck, z: number) => d.half * (z - d.nose) / (d.stern - d.nose)
        const yawOf = (d: Deck) => Math.atan2(d.half, d.stern - d.nose)
        const top = (d: Deck) => d.y + d.t / 2
        const wedge = (d: Deck, slot = 0, slotEnd = 0): Pt[] => {
            if (!slot) return [[0, d.nose], [d.half, d.stern], [-d.half, d.stern]]
            const tip = d.nose + slot * (d.stern - d.nose) / d.half
            return [[slot, tip], [d.half, d.stern], [-d.half, d.stern], [-slot, tip], [-slot, slotEnd], [slot, slotEnd]]
        }
        const keel: Deck = { nose: -32, stern: 34, half: 13, y: -7.6, t: 3.4 }
        const lower: Deck = { nose: -48, stern: 36, half: 24, y: -3.3, t: 5.4 }
        const waist: Deck = { nose: -42, stern: 35.5, half: 19.6, y: -0.1, t: 1.4 }
        const mid: Deck = { nose: -45, stern: 35, half: 21.5, y: 2.15, t: 3.3 }
        const upper: Deck = { nose: -31, stern: 33, half: 15, y: 5.35, t: 3.1 }
        const crown: Deck = { nose: -18, stern: 30, half: 7.5, y: 8.05, t: 2.3 }

        // Stacked hull decks, darkest at the bottom; the prow forks around the emitter.
        b.solid(slab(wedge({ ...keel, nose: -24, stern: 4, half: 5 }), 2.2, 0.25), 0x1f1d22, [0, -10.2, 0])
        b.solid(slab(wedge(keel), keel.t, 0.25), 0x2c2a30, [0, keel.y, 0])
        b.solid(slab(wedge(lower, 1.3, -33), lower.t, 0.35), 0x3c3a42, [0, lower.y, 0])
        b.solid(slab(wedge(waist), waist.t, 0.1), 0x141318, [0, waist.y, 0])
        b.solid(slab(wedge(mid, 1.3, -33), mid.t, 0.3), 0x6d6a74, [0, mid.y, 0])
        b.solid(slab(wedge(upper), upper.t, 0.25), 0x8e8a96, [0, upper.y, 0])
        b.solid(slab(wedge(crown), crown.t, 0.2), 0x55525c, [0, crown.y, 0])

        // Spinal emitter in the fork.
        b.metal(block(2.4, 6, 10, 0.1), 0x17151a, [0, -1, -37.5])
        b.metal(tube(0.7, 1.0, 9, 8), H_METAL, [0, 0.4, -39])
        for (let i = 0; i < 4; i++) b.glow(ring(1.15, 0.12, 4, 12), glow, 2 + i * 0.5, [0, 0.4, -36 - i * 2.2])
        b.glow(octa(0.9), glow, 5, [0, 0.4, -44.2])
        for (const y of [-3.2, 2.6]) slit(b, glow, [1.32, y, -38.5], [0.08, 0.3, 9], 2, true)

        // Armour panels on every ledge, in broken shades with open seams between.
        const shades = [0x625f69, 0x77737e, 0x8a8692, 0x4e4b54, 0x9a96a3]
        const plate = (deck: Deck, inner: Deck | null, z0: number, z1: number, step: number, base: number) => {
            for (let z = z0; z < z1; z += step) {
                const za = z + 0.25
                const zb = Math.min(z + step, z1) - 0.25
                const inA = Math.max(inner ? halfAt(inner, za) + 0.7 : 0, 1.4)
                const inB = Math.max(inner ? halfAt(inner, zb) + 0.7 : 0, 1.4)
                const outA = halfAt(deck, za) - 0.8
                const outB = halfAt(deck, zb) - 0.8
                if (outA - inA < 1.2) continue
                // Wide ledges split into an inboard and an outboard run.
                const runs = outB - inB > 7 ? 2 : 1
                for (let k = 0; k < runs; k++) {
                    const f0 = k / runs
                    const f1 = (k + 1) / runs
                    const g = runs > 1 ? 0.2 : 0
                    const pts: Pt[] = [
                        [inA + (outA - inA) * f0 + (k ? g : 0), za], [inA + (outA - inA) * f1 - (k ? 0 : g), za],
                        [inB + (outB - inB) * f1 - (k ? 0 : g), zb], [inB + (outB - inB) * f0 + (k ? g : 0), zb]
                    ]
                    const pick = rnd()
                    const raised = rnd() < 0.3
                    const color = pick < 0.1 ? H_PAINT : shades[Math.floor(rnd() * shades.length)]!
                    b.solid(slab(pts, raised ? 0.5 : 0.22, 0.05), base ? new THREE.Color(color).multiplyScalar(base).getHex() : color, [0, top(deck) + (raised ? 0.2 : 0.08), 0], FLAT, ONE, true)
                }
            }
        }
        plate(mid, upper, -41, 34, 5.2, 0.85)
        plate(upper, crown, -27, 32, 4.6, 1)
        plate(crown, null, -13, 19, 4, 0.7)

        // Red command stripes down both edges of the mid deck.
        for (const side of [1, -1]) {
            const pts: Pt[] = [[side * 1.6, -40], [side * 20.3, 30], [side * 19.2, 30], [side * 1.45, -36.5]]
            b.solid(slab(side > 0 ? pts : pts.reverse(), 0.3, 0.04), H_PAINT, [0, top(mid) + 0.42, 0])
        }
        // Dorsal trench down the prow, lit from inside.
        groove(b, [0, top(mid) + 0.1, -22], [2.2, 0.5, 20])
        slit(b, glow, [0, top(mid) + 0.36, -22], [0.3, 0.06, 19], 2.2)
        for (let i = 0; i < 7; i++) b.metal(block(2.6, 0.5, 0.6, 0.06), H_PLATE, [0, top(mid) + 0.3, -31 + i * 3])

        // Deck clutter: machinery blocks and pipe runs in a spread of shades.
        const clutter = [0x4a4850, 0x7a7680, 0x9e9aa6, 0x34323a]
        for (let i = 0; i < 64; i++) {
            const z = -34 + rnd() * 62
            const onUpper = rnd() < 0.45
            const deck = onUpper ? upper : mid
            const inner = halfAt(onUpper ? crown : upper, z)
            const lo = Math.max(inner + 1.2, 2)
            const hi = halfAt(deck, z) - 1.8
            const w = 0.8 + rnd() * 2.6
            const h = 0.5 + rnd() * 1.4
            const d = 1 + rnd() * 4
            if (hi - lo < 1 || z > 16 && z < 34 && onUpper) continue
            const x = lo + rnd() * (hi - lo)
            // Keep the reactor wells and battery tubs clear.
            if (Math.hypot(x - 14.5, z - 27) < 6 || Math.hypot(x - 11, z + 6) < 4 || Math.hypot(x - 16, z - 22) < 4 || Math.hypot(x - 6.5, z + 8) < 4) continue
            b.metal(block(w, h, d, 0.08), clutter[i % clutter.length]!, [x, top(deck) + 0.2 + h / 2, z], FLAT, ONE, true)
            if (i % 5 === 0) b.glow(box(0.2, 0.12, 0.2), i % 10 ? COLD : BEACON, 3, [x, top(deck) + 0.3 + h, z], FLAT, ONE, true)
        }
        for (const [deck, inner] of [[mid, upper], [upper, crown]] as const) {
            const yaw = yawOf(inner)
            for (let i = 0; i < 4; i++) {
                const z = inner.nose + 14 + i * 11
                b.metal(tube(0.28, 0.28, 8.5, 6), H_METAL, [halfAt(inner, z) + 0.75, top(deck) + 0.55, z], [0, yaw, 0], ONE, true)
            }
        }

        // Lit windows along every deck edge, some dark.
        const litRow = (deck: Deck, y: number, z0: number, z1: number, step: number, size: number, out: number) => {
            const yaw = yawOf(deck)
            for (let z = z0; z < z1; z += step) {
                if (rnd() < 0.28) continue
                b.glow(box(0.12, 0.3, size), rnd() < 0.2 ? AMBER : COLD, 1.8, [halfAt(deck, z) + out, y, z], [0, yaw, 0], ONE, true)
            }
        }
        litRow(lower, -1.6, -40, 34, 2.3, 1.3, 0.42)
        litRow(lower, -3.0, -38, 34, 2.3, 1.3, 0.42)
        litRow(lower, -4.6, -30, 34, 3.1, 1.6, 0.42)
        litRow(mid, 2.9, -38, 33, 2.1, 1.1, 0.37)
        litRow(mid, 1.5, -36, 2, 2.1, 1.1, 0.37)
        litRow(mid, 1.5, 20, 33, 2.1, 1.1, 0.37)
        litRow(upper, 5.9, -26, 31, 1.9, 1.0, 0.31)
        litRow(upper, 4.8, -24, 31, 2.6, 1.2, 0.31)
        litRow(crown, 8.3, -13, 17, 1.7, 0.9, 0.26)
        litRow(keel, -7.4, -24, 32, 3.2, 1.4, 0.31)

        // The waist trench: machinery in the shadow, a glow line and hull ribs bridging it.
        {
            const yaw = yawOf(waist)
            for (let z = -36; z < 34; z += 2.6) {
                const x = halfAt(waist, z)
                const h = 0.5 + rnd() * 0.7
                b.metal(block(1.2 + rnd(), h, 1 + rnd() * 1.4, 0.06), clutter[Math.floor(rnd() * 4)]!, [x + 0.3, -0.1, z], [0, yaw, 0], ONE, true)
            }
            for (let z = -34; z < 34; z += 8) {
                b.glow(box(0.1, 0.16, 5.5), glow, 1.8, [halfAt(waist, z) + 0.2, 0.3, z], [0, yaw, 0], ONE, true)
                b.solid(block(1.6, 2.0, 1.1, 0.12), 0x55525c, [halfAt(mid, z + 4) - 0.2, -0.1, z + 4], [0, yawOf(mid), 0], ONE, true)
            }
        }
        // A pale trim line along the lower hull's shoulder.
        for (const side of [1, -1]) {
            const pts: Pt[] = [[side * 1.5, -43], [side * 24.4, 36], [side * 23.2, 36], [side * 1.4, -39.5]]
            b.solid(slab(side > 0 ? pts : pts.reverse(), 0.3, 0.04), 0xb8b4c0, [0, top(lower) + 0.05, 0])
        }

        // Flank hangars: an open gallery in each side with fighters parked under the lights.
        {
            const yaw = yawOf(mid)
            const cx = halfAt(mid, 11) + 2.4
            const c = Math.cos(yaw)
            const s = Math.sin(yaw)
            const at = (u: number, v: number, w: number): Vec3 => [cx + u * c + w * s, 1.6 + v, 11 - u * s + w * c]
            const rot: Vec3 = [0, yaw, 0]
            b.solid(block(5.6, 0.7, 17, 0.12), 0x4a4850, at(0, -2.3, 0), rot, ONE, true)
            b.solid(block(5.8, 0.9, 17.4, 0.15), 0x6d6a74, at(0, 2.4, 0), rot, ONE, true)
            b.solid(block(4.6, 0.3, 15, 0.08), H_PAINT, at(0, 2.95, 0), rot, ONE, true)
            for (const w of [-8.1, 0, 8.1]) b.solid(block(5.6, 4.2, w ? 1.2 : 0.7, 0.12), 0x55525c, at(0, 0.05, w), rot, ONE, true)
            b.metal(box(0.3, 4, 16), 0x0b0a0d, at(-2.4, 0.05, 0), rot, ONE, true)
            for (const w of [-4.05, 4.05]) {
                b.glow(box(0.1, 2.6, 6.2), glow, 0.8, at(-2.2, 0.1, w), rot, ONE, true)
                b.glow(box(3.6, 0.1, 0.3), AMBER, 2.6, at(0, 1.9, w - 2), rot, ONE, true)
                b.glow(box(3.6, 0.1, 0.3), AMBER, 2.6, at(0, 1.9, w + 2), rot, ONE, true)
                b.glow(box(4.4, 0.06, 0.16), glow, 2.2, at(0.2, -1.92, w), rot, ONE, true)
                // A parked fighter.
                b.solid(loft([{ z: -1.5, w: 0.05, h: 0.05 }, { z: 0, w: 0.4, h: 0.3 }, { z: 1, w: 0.3, h: 0.22 }], 6, 0.7), H_ARMOR, at(-0.3, -1.4, w), [0, yaw + Math.PI / 2, 0], ONE, true)
                b.solid(slab([[-1.3, -0.6], [0, 0.1], [1.3, -0.6], [0.9, 0.5], [-0.9, 0.5]], 0.08, 0.02), H_PAINT, at(-0.3, -1.45, w), [0, yaw + Math.PI / 2, 0], ONE, true)
            }
            for (const v of [-1.85, 1.85]) b.glow(box(0.14, 0.14, 16.4), AMBER, 2.6, at(2.85, v, 0), rot, ONE, true)
            for (let i = 0; i < 5; i++) b.glow(box(0.5, 0.08, 0.5), i % 2 ? BEACON : AMBER, 3, at(2.4, -1.9, -6.4 + i * 3.2), rot, ONE, true)
        }
        // Belly hangar mouth with guide lights.
        b.solid(block(15, 1.4, 21, 0.2), 0x232126, [0, -9.8, 18])
        b.metal(block(12, 0.6, 18, 0.1), 0x0b0a0d, [0, -10.3, 18])
        b.glow(box(10.5, 0.2, 16), glow, 1.1, [0, -10.55, 18])
        for (let i = 0; i < 6; i++) b.glow(box(11.5, 0.12, 0.3), AMBER, 2.4, [0, -10.66, 10.5 + i * 3])
        for (const z of [8, 28]) b.glow(box(14, 0.14, 0.2), BEACON, 2.5, [0, -10.52, z])
        // Ventral fins and sensor pods.
        b.solid(fin([[0, -18], [0, 2], [-5.5, -1], [-3.5, -12]], 0.8, 0.15), 0x2c2a30, [0, -11.2, 0])
        slit(b, glow, [0, -14.2, -6], [0.95, 0.25, 8], 1.8)
        b.solid(fin([[0, -4], [0, 8], [-4, 9.5], [-3, 0]], 0.6, 0.12), 0x3c3a42, [9, -9.2, 24], [0, 0, 0.35], ONE, true)
        for (const z of [-14, -2]) {
            b.metal(ico(1.5, 1), H_LIGHT, [6.5, -9.9, z], FLAT, [1, 0.8, 1.6], true)
            b.glow(ring(1.1, 0.08, 3, 10), glow, 2, [6.5, -10.9, z], [Math.PI / 2, 0, 0], ONE, true)
        }

        // Command tower: terraces climbing to a hammerhead bridge under an antenna farm.
        b.solid(block(8, 1.5, 8, 0.2), 0x6d6a74, [0, 9.9, 15])
        b.solid(block(5, 1.2, 4, 0.15), 0x8e8a96, [0, 11.2, 16.5])
        slit(b, COLD, [0, 10, 10.95], [6, 0.3, 0.1], 1.8)
        b.solid(block(18, 2.4, 15, 0.3), 0x55525c, [0, 8.0, 25.5])
        b.solid(block(16, 2.6, 13, 0.3), 0x6d6a74, [0, 10.5, 26])
        b.solid(block(12, 0.35, 5, 0.08), H_PAINT, [0, 11.9, 21.4])
        b.solid(block(9, 5.2, 8.5, 0.3), 0x4a4850, [0, 14.4, 27])
        b.solid(block(5, 5.2, 3, 0.2), 0x8e8a96, [0, 14.4, 22.4])
        for (let row = 0; row < 3; row++) {
            for (let i = 0; i < 5; i++) {
                if ((row + i) % 4 === 3) continue
                b.glow(box(0.12, 0.35, 0.9), COLD, 1.8, [4.62, 12.9 + row * 1.4, 24 + i * 1.5], FLAT, ONE, true)
            }
            slit(b, row === 1 ? AMBER : COLD, [0, 12.9 + row * 1.4, 20.85], [3.6, 0.3, 0.1], 1.8)
        }
        b.solid(slab([[-14, -2.2], [14, -2.2], [11.5, 3.6], [-11.5, 3.6]], 3, 0.3), 0x8e8a96, [0, 18.5, 27])
        b.solid(slab([[-12.5, -3], [12.5, -3], [12.5, -2], [-12.5, -2]], 1.2, 0.15), 0x3c3a42, [0, 18.6, 27])
        slit(b, AMBER, [0, 18.9, 23.92], [23, 0.4, 0.12], 3)
        slit(b, COLD, [0, 17.9, 24.5], [26, 0.25, 0.12], 1.8)
        slit(b, glow, [0, 16.95, 27.5], [24, 0.12, 4], 0.9)
        b.solid(block(14, 1.3, 4.8, 0.2), 0x55525c, [0, 20.6, 28])
        b.solid(block(6, 1.0, 3, 0.15), H_PAINT2, [0, 21.7, 28.4])
        for (const x of [-10.5, 10.5]) {
            b.metal(cyl(0.9, 1.2, 1.4, 8), H_PLATE, [x, 20.6, 28.5])
            b.metal(ico(2.2, 1), 0x9e9aa6, [x, 22.8, 28.5])
            b.glow(ring(2.25, 0.08, 3, 16), glow, 1.8, [x, 22.8, 28.5], [Math.PI / 2, 0, 0])
        }
        for (const [x, z, h] of [[2, 29.5, 7], [-1.5, 28.5, 4.5], [0.5, 27.2, 3], [-3.5, 29.5, 5.5], [4.5, 28, 2.5], [-5.5, 28, 2]] as const) mast(b, [x, 21.2, z], h, 0.16)
        dish(b, livery(glow), [-7, 20.1, 26.2], 1.6)
        dish(b, livery(glow), [7, 20.1, 26.2], 1.2)

        // Point-defence guns along the deck edges.
        for (const z of [-30, -18, -2, 28]) deckGun(b, glow, [halfAt(mid, z) - 2.2, top(mid) + 0.2, z], 2.2, true)
        for (const z of [-14, 2, 14]) deckGun(b, glow, [halfAt(upper, z) - 2, top(upper) + 0.2, z], 2, true)
        for (const z of [-20, 0, 26]) deckGun(b, glow, [halfAt(keel, z) + 3.5, lower.y - lower.t / 2, z], 2.2, true, -1)

        // Stern: an engine block in layers, three big drives and four small, finned between.
        b.solid(block(42, 12, 5.5, 0.3), 0x3c3a42, [0, -0.5, 38.4])
        b.metal(block(44, 1.3, 6, 0.1), 0x6d6a74, [0, 5.6, 38.4])
        b.metal(block(44, 1.0, 6, 0.1), 0x2c2a30, [0, -6.6, 38.4])
        b.solid(block(30, 2.2, 5, 0.2), 0x55525c, [0, 7.2, 37.5])
        for (const x of [6.6, 18.2]) {
            b.solid(fin([[-5.5, 0], [5.2, 0], [4, 5], [-4.5, 5]], 0.9, 0.15), 0x55525c, [x, -0.5, 40.6], FLAT, ONE, true)
            slit(b, glow, [x, 0, 45.62], [0.3, 7, 0.1], 2.2, true)
        }
        const shroud = (x: number, y: number, r: number, mirror: boolean) => {
            b.metal(tube(r * 1.32, r * 1.55, r * 1.1, 14), 0x232126, [x, y, 41.2 + r * 0.15], FLAT, ONE, mirror)
            b.glow(ring(r * 1.36, r * 0.05, 3, 20), glow, 2.2, [x, y, 41.2 + r * 0.74], FLAT, ONE, mirror)
        }
        shroud(0, 0, 4.4, false)
        shroud(13, 0, 3.6, true)
        b.engine([0, 0, 41.2], 4.4, false, glow)
        b.engine([13, 0, 41.2], 3.6, true, glow)
        b.engine([6.5, -4, 41.2], 1.9, true, glow)
        b.engine([19, -3, 41.2], 1.7, true, glow)
        for (let i = 0; i < 9; i++) b.glow(box(1.6, 0.3, 0.1), i % 3 ? COLD : AMBER, 1.8, [-16 + i * 4, 4.2, 41.18])

        // Battery tubs (the batteries spawn as separate targets) and reactor wells.
        const tubs: [Vec3, Vec3][] = [[[11, 4.2, -6], [0.2, 1, 0]], [[16, 4.2, 22], [0.2, 1, 0]], [[6.5, 7, -8], [0, 1, 0]]]
        for (const [pos, normal] of tubs) {
            b.metal(cyl(2.7, 3.3, 1.0, 10), H_DARK, [pos[0], pos[1] - 0.5, pos[2]], FLAT, ONE, true)
            b.solid(block(5, 2.4, 5, 0.3), 0x4a4850, [pos[0] - 0.6, pos[1] - 2.1, pos[2]], FLAT, ONE, true)
            b.glow(ring(2.85, 0.07, 3, 16), glow, 2, [pos[0], pos[1] - 0.02, pos[2]], [Math.PI / 2, 0, 0], ONE, true)
            b.hardpoint(pos, normal, true)
        }
        b.metal(cyl(3.6, 4.0, 0.5, 12), H_DARK, [14.5, top(mid) + 0.25, 27], FLAT, ONE, true)
        b.glow(ring(3.7, 0.08, 3, 20), glow, 2, [14.5, top(mid) + 0.52, 27], [Math.PI / 2, 0, 0], ONE, true)
        b.metal(cyl(3.0, 3.3, 0.4, 12), H_DARK, [0, top(crown) + 0.1, 4])
        b.glow(ring(3.1, 0.08, 3, 20), glow, 2, [0, top(crown) + 0.32, 4], [Math.PI / 2, 0, 0])
    },
    /** Gunship: a long flat hull with a gun sponson on each flank and a raked dorsal fin. */
    ravager(b, glow) {
        const l = livery(glow)
        const hull: Section[] = [
            { z: -5.6, w: 0.12, h: 0.1, y: -0.1 },
            { z: -4.2, w: 0.7, h: 0.4 },
            { z: -1.5, w: 1.25, h: 0.7 },
            { z: 2.6, w: 1.35, h: 0.8 },
            { z: 4.6, w: 0.95, h: 0.6 }
        ]
        b.solid(loft(hull, 8, 0.55, Math.PI / 8), H_ARMOR)
        band(b, hull, -5.6, -4.7, H_PAINT, [8, 0.55, Math.PI / 8], 0.015)
        band(b, hull, -3.3, -2.7, H_PLATE, [8, 0.55, Math.PI / 8], 0.04)
        band(b, hull, -0.4, 0.3, H_LIGHT, [8, 0.55, Math.PI / 8], 0.035)
        band(b, hull, 2.9, 3.4, H_PLATE, [8, 0.55, Math.PI / 8], 0.045)
        band(b, hull, 4.0, 4.3, H_DARK, [8, 0.55, Math.PI / 8], 0.045)
        // Armoured spine and a red command stripe down the nose.
        b.solid(loft([
            { z: -3.4, w: 0.35, h: 0.18, y: 0.5 },
            { z: 0.5, w: 0.6, h: 0.3, y: 0.85 },
            { z: 3.8, w: 0.5, h: 0.25, y: 0.8 }
        ], 6, 0.6), H_DARK)
        b.solid(slab([[-0.3, -5.2], [0.3, -5.2], [0.62, -1.6], [-0.62, -1.6]], 0.06, 0.02), H_PAINT, [0, 0.62, 0], [-0.085, 0, 0])
        b.glow(box(0.7, 0.05, 0.22), glow, 3, [0, 0.98, -0.9])
        // Bridge on the spine, sensors behind it.
        b.solid(block(0.9, 0.35, 1.3, 0.07), H_PLATE, [0, 1.25, 1.2])
        b.solid(block(0.6, 0.25, 0.7, 0.05), H_LIGHT, [0, 1.52, 1.4])
        slit(b, AMBER, [0, 1.3, 0.54], [0.7, 0.08, 0.04], 3)
        dish(b, l, [0.0, 1.62, 1.5], 0.26)
        mast(b, [-0.3, 1.4, 1.7], 0.8, 0.03)
        // Missile cells in the afterdeck.
        b.metal(block(0.8, 0.12, 1.1, 0.03), H_PLATE, [0, 1.08, 2.9])
        for (let i = 0; i < 6; i++) {
            groove(b, [(i % 2 ? 0.2 : -0.2), 1.145, 2.55 + Math.floor(i / 2) * 0.35], [0.26, 0.02, 0.24])
            b.glow(box(0.08, 0.025, 0.08), glow, 2.6, [(i % 2 ? 0.2 : -0.2), 1.155, 2.55 + Math.floor(i / 2) * 0.35])
        }
        // Shoulder intakes and a chin sensor.
        vent(b, [0.85, 0.52, -2.1], 0.4, 0.22, 0.7, true)
        b.metal(ico(0.22, 1), H_LIGHT, [0, -0.45, -3.9], FLAT, [1, 0.7, 1.5])
        b.glow(octa(0.08), glow, 4, [0, -0.52, -4.22])
        // Flank sponsons, each with a twin battery.
        b.solid(loft([
            { z: -2.6, w: 0.3, h: 0.3, x: 2.0 },
            { z: -1.4, w: 0.55, h: 0.5, x: 2.1 },
            { z: 1.8, w: 0.6, h: 0.55, x: 2.1 },
            { z: 2.9, w: 0.35, h: 0.35, x: 1.9 }
        ], 6, 0.6), H_DARK, [0, -0.1, 0], FLAT, ONE, true)
        b.metal(block(1.0, 0.3, 1.6, 0.05), H_METAL, [1.45, -0.1, 0.3], FLAT, ONE, true)
        b.metal(block(0.8, 0.22, 0.5, 0.04), H_PLATE, [1.5, -0.1, -1.2], FLAT, ONE, true)
        for (const y of [0.18, -0.38]) {
            barrel(b, l, [2.1, y, -3.0], 2.2, 0.11, true)
            b.metal(tube(0.17, 0.17, 0.7, 8), H_PLATE, [2.1, y, -2.3], FLAT, ONE, true)
        }
        b.metal(block(0.5, 0.75, 0.3, 0.04), H_PLATE, [2.1, -0.1, -2.75], FLAT, ONE, true)
        b.metal(tube(0.24, 0.24, 1.0, 8), H_PLATE, [2.1, -0.72, 0.4], FLAT, ONE, true)
        b.solid(slab([[1.5, -2.2], [2.75, -1.2], [2.75, 1.6], [1.5, 2.4]], 0.08, 0.03), H_PAINT, [0, 0.47, 0], FLAT, ONE, true)
        groove(b, [2.15, 0.515, 0.2], [1.1, 0.02, 0.04], true)
        groove(b, [2.15, 0.515, -0.8], [1.0, 0.02, 0.04], true)
        for (let i = 0; i < 4; i++) b.glow(box(0.04, 0.1, 0.5), glow, 2.2, [2.68, -0.1, -1.0 + i * 0.8], FLAT, ONE, true)
        // Swept tail planes and a raked fin.
        b.solid(slab([[1.0, 2.2], [3.4, 4.4], [3.3, 5.0], [0.9, 4.4]], 0.1, 0.03), H_ARMOR, [0, 0.1, 0], [0, 0, -0.12], ONE, true)
        b.solid(slab([[2.5, 3.65], [3.4, 4.4], [3.3, 5.0], [2.3, 4.78]], 0.13, 0.03), H_PAINT, [0, 0.1, 0], [0, 0, -0.12], ONE, true)
        b.glow(box(1.2, 0.12, 0.04), glow, 2, [1.9, -0.12, 3.9], [0, -0.72, -0.12], ONE, true)
        b.solid(slab([[0, 1.2], [0, 4.4], [1.9, 5.0], [1.7, 4.2]], 0.1, 0.03), H_PAINT, [0, 0.7, 0], [0, 0, Math.PI / 2])
        b.solid(slab([[0, 1.9], [0, 4.2], [0.8, 4.4], [0.75, 2.9]], 0.16, 0.03), H_DARK, [0, 0.7, 0], [0, 0, Math.PI / 2])
        slit(b, glow, [0, 1.9, 4.05], [0.13, 0.05, 1.0], 2.2)
        b.glow(octa(0.14), BEACON, 5, [0, 2.75, 4.8])
        // Windows, belly keel and lights.
        for (let i = 0; i < 6; i++) b.glow(box(0.04, 0.09, 0.32), i % 3 === 0 ? AMBER : COLD, 1.8, [1.27, 0.25, -1.4 + i * 0.7], FLAT, ONE, true)
        b.solid(fin([[0, -3.0], [0, 3.6], [-0.55, 3.0], [-0.4, -1.4]], 0.5, 0.06), H_DARK, [0, -0.7, 0])
        b.glow(box(0.5, 0.04, 2.6), glow, 1.2, [0, -1.27, 0.6])
        deckGun(b, glow, [0, -1.22, -0.9], 0.5, false, -1)
        // Engine block.
        b.solid(block(2.4, 1.1, 0.8, 0.08), H_PLATE, [0, 0, 4.3])
        drive(b, glow, [0.62, 0, 4.7], 0.42, true)
        drive(b, glow, [2.0, -0.1, 3.0], 0.26, true, H_PLATE)
    },
    /** Siege cruiser: a hammerhead prow around a fanged plasma maw, slab armour and a deep keel. */
    mauler(b, glow) {
        const l = livery(glow)
        const hull: Section[] = [
            { z: -4.6, w: 1.5, h: 0.9 },
            { z: -2.8, w: 1.3, h: 1.0 },
            { z: 0.5, w: 1.6, h: 1.2 },
            { z: 4.4, w: 1.75, h: 1.25 },
            { z: 6.4, w: 1.2, h: 0.85 }
        ]
        b.solid(loft(hull, 8, 0.45, Math.PI / 8), H_ARMOR)
        band(b, hull, -3.4, -2.9, H_DARK, [8, 0.45, Math.PI / 8], 0.06)
        band(b, hull, -0.7, -0.1, H_PLATE, [8, 0.45, Math.PI / 8], 0.05)
        band(b, hull, 4.7, 5.3, H_PLATE, [8, 0.45, Math.PI / 8], 0.06)
        band(b, hull, 5.8, 6.1, H_DARK, [8, 0.45, Math.PI / 8], 0.06)
        // Hammerhead: two armoured jaws flanking the maw.
        b.solid(loft([
            { z: -7.2, w: 0.45, h: 0.55, x: 2.0 },
            { z: -5.6, w: 0.95, h: 0.95, x: 2.1 },
            { z: -3.6, w: 0.9, h: 0.9, x: 1.9 },
            { z: -2.4, w: 0.4, h: 0.5, x: 1.5 }
        ], 6, 0.5), H_DARK, FLAT, FLAT, ONE, true)
        b.solid(slab([[1.3, -7.0], [2.9, -6.2], [3.0, -3.4], [1.4, -2.8]], 0.12, 0.04), H_PAINT, [0, 0.95, 0], FLAT, ONE, true)
        b.solid(slab([[1.4, -6.6], [2.8, -5.9], [2.9, -3.6], [1.5, -3.1]], 0.12, 0.04), H_PLATE, [0, -0.95, 0], FLAT, ONE, true)
        b.solid(fin([[-0.6, -6.6], [0.6, -6.6], [0.7, -3.6], [-0.7, -3.6]], 0.14, 0.04), H_ARMOR, [3.02, 0, 0], FLAT, ONE, true)
        slit(b, glow, [3.1, 0, -5.1], [0.04, 0.12, 2.4], 2.4, true)
        groove(b, [2.15, 1.02, -4.4], [1.5, 0.02, 0.05], true)
        groove(b, [2.15, 1.02, -5.5], [1.4, 0.02, 0.05], true)
        b.glow(octa(0.1), BEACON, 4.5, [2.0, 0, -7.3], FLAT, ONE, true)
        // The maw: a fanged collar round a deep charging throat.
        b.metal(cyl(1.0, 1.0, 1.6, 12), H_VOID, [0, 0, -4.9], [Math.PI / 2, 0, 0])
        b.metal(ring(1.08, 0.17, 4, 12), H_PLATE, [0, 0, -5.7])
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + Math.PI / 8
            b.metal(spike(0.16, 0.9, 4), H_METAL, [Math.cos(a) * 1.08, Math.sin(a) * 1.08, -6.1], [0, 0, a])
        }
        for (let i = 0; i < 4; i++) b.glow(ring(0.95 - i * 0.16, 0.05, 4, 24), glow, 2 + i * 0.6, [0, 0, -5.75 + i * 0.3])
        b.glow(ico(0.42, 1), glow, 4.5, [0, 0, -5.2])
        for (const side of [1, -1]) b.glow(box(0.06, 0.12, 2.6), glow, 2.2, [side * 1.18, 0, -5.4])
        // Slab armour along the flanks, stepped like roof tiles.
        for (let i = 0; i < 4; i++) {
            const z = -1.6 + i * 1.9
            b.solid(slab([[0, -0.9], [0.5, -0.7], [0.5, 0.9], [0, 0.9]], 1.7, 0.06), i % 2 ? H_DARK : H_METAL, [1.62 + i * 0.05, -0.85, z], [0, 0, 0.14], ONE, true)
            b.glow(box(0.04, 0.5, 0.08), glow, 1.8, [2.2 + i * 0.05, 0, z + 0.95], FLAT, ONE, true)
            b.solid(block(0.12, 0.5, 1.2, 0.03), i % 2 ? H_PAINT2 : H_PLATE, [2.22 + i * 0.05, 0.1, z], [0, 0, 0.14], ONE, true)
        }
        // Foredeck guns, citadel in three tiers, bridge and masts.
        deckGun(b, glow, [0.75, 1.0, -1.2], 0.9, true)
        deckGun(b, glow, [0, 1.12, 0.3], 1.1)
        b.solid(block(2.4, 0.5, 4.2, 0.12), H_PLATE, [0, 1.35, 2.9])
        b.solid(block(2.0, 0.9, 3.4, 0.15), 0x55525c, [0, 1.85, 2.9])
        b.solid(block(1.3, 0.7, 1.8, 0.12), 0x6d6a74, [0, 2.6, 3.4])
        b.solid(block(2.0, 0.3, 0.9, 0.06), H_LIGHT, [0, 3.05, 3.1])
        b.glow(box(1.8, 0.1, 0.05), AMBER, 3, [0, 3.06, 2.63])
        b.glow(box(1.1, 0.1, 0.05), COLD, 1.8, [0, 2.6, 2.48])
        ports(b, [1.02, 1.9, 1.6], 6, 0.5, 0.3)
        b.solid(slab([[-0.5, -1.0], [0.5, -1.0], [0.4, 1.4], [-0.4, 1.4]], 0.12, 0.03), H_PAINT, [0, 2.32, 1.7])
        mast(b, [0.5, 3.2, 3.4], 1.9, 0.06)
        mast(b, [-0.7, 3.2, 3.3], 1.1, 0.04)
        b.metal(ico(0.5, 1), 0x9e9aa6, [-0.2, 3.55, 3.7])
        dish(b, l, [0.2, 2.3, 4.3], 0.4)
        greeble(b, l, [0, 1.62, 5.2], 2.0, 0.8, 8, 5)
        // Radiators aft, keel and ventral fins.
        radiator(b, l, [1.6, 0.6, 4.6], 1.6, 1.4, 0.5, glow, 4)
        b.solid(slab([[0, -2.5], [0, 5.2], [1.7, 4.4], [1.2, -0.6]], 0.2, 0.05), H_DARK, [0, -1.0, 0], [0, 0, -Math.PI / 2])
        b.solid(slab([[0.2, -1.2], [0.2, 3.6], [1.0, 3.2], [0.8, -0.4]], 0.3, 0.05), H_PAINT2, [0, -1.0, 0], [0, 0, -Math.PI / 2])
        b.glow(box(0.05, 0.08, 4.4), glow, 1.6, [0, -2.72, 2.0])
        deckGun(b, glow, [0.9, -1.12, -1.0], 0.8, true, -1)
        b.solid(slab([[1.5, 3.4], [3.6, 5.6], [3.5, 6.4], [1.3, 5.8]], 0.14, 0.04), H_ARMOR, [0, 0.2, 0], [0, 0, 0.1], ONE, true)
        b.solid(slab([[2.75, 4.7], [3.6, 5.6], [3.5, 6.4], [2.55, 6.13]], 0.17, 0.04), H_PAINT, [0, 0.2, 0], [0, 0, 0.1], ONE, true)
        for (let i = 0; i < 8; i++) b.glow(box(0.04, 0.1, 0.36), i % 4 === 0 ? AMBER : COLD, 1.8, [1.5, 0.6, -1.8 + i * 0.85], FLAT, ONE, true)
        // Engine block.
        b.solid(block(3.2, 2.0, 0.9, 0.1), H_PLATE, [0, 0, 6.1])
        drive(b, glow, [0, 0.1, 6.5], 0.62)
        drive(b, glow, [0.95, -0.2, 6.5], 0.42, true, H_PLATE)
    },
    /** Sentinel: a static gun platform. A siege cannon on an armoured drum over a ringed deck, radiators out to the sides. */
    sentinel(b, glow) {
        const l = livery(glow)
        const core: Section[] = [
            { z: -1.4, w: 0.85, h: 0.85 },
            { z: -0.7, w: 1.3, h: 1.3 },
            { z: 0.9, w: 1.3, h: 1.3 },
            { z: 1.7, w: 0.8, h: 0.8 }
        ]
        b.solid(loft(core, 8, 0.6, Math.PI / 8), H_ARMOR)
        band(b, core, -0.75, -0.35, H_PAINT, [8, 0.6, Math.PI / 8], 0.04)
        band(b, core, 0.2, 0.6, H_PLATE, [8, 0.6, Math.PI / 8], 0.05)
        band(b, core, 1.1, 1.35, H_DARK, [8, 0.6, Math.PI / 8], 0.04)
        // The cannon: shrouded barrel, charge coils and a vented muzzle.
        b.metal(tube(0.3, 0.44, 2.5, 10), H_DARK, [0, 0, -2.4])
        b.solid(block(1.0, 0.9, 1.0, 0.1), H_PLATE, [0, 0, -1.55])
        for (const side of [1, -1]) b.metal(box(0.1, 0.22, 1.9), H_METAL, [side * 0.42, 0, -2.3])
        for (let i = 0; i < 3; i++) b.glow(ring(0.43, 0.04, 3, 12), glow, 2.2 + i * 0.5, [0, 0, -2.1 - i * 0.42])
        b.metal(tube(0.5, 0.5, 0.42, 8), H_PLATE, [0, 0, -3.45])
        for (const side of [1, -1]) slit(b, glow, [side * 0.49, 0, -3.45], [0.05, 0.2, 0.26], 2.6)
        b.glow(new THREE.CircleGeometry(0.3, 10).rotateY(Math.PI), glow, 3.5, [0, 0, -3.67])
        // Ringed deck under the gun, braced to the drum.
        b.solid(ring(2.2, 0.24, 4, 8), H_DARK, [0, -0.85, 0], [Math.PI / 2, 0, Math.PI / 8])
        b.glow(ring(2.2, 0.05, 3, 32), glow, 1.8, [0, -0.6, 0], [Math.PI / 2, 0, 0])
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            const c = Math.cos(a)
            const s = Math.sin(a)
            b.metal(box(1.3, 0.16, 0.22), H_METAL, [c * 1.6, -0.8, s * 1.6], [0, -a, 0])
            // Shield vanes standing on the ring.
            b.solid(wall([[-0.55, -0.7], [0.55, -0.7], [0.4, 0.75], [-0.4, 0.75]], 0.16, 0.04), H_PAINT, [c * 2.3, -0.75, s * 2.3], [0, Math.PI / 2 - a, 0])
            b.glow(box(0.5, 0.06, 0.04), glow, 2.4, [c * 2.4, -0.55, s * 2.4], [0, Math.PI / 2 - a, 0])
        }
        // Flank batteries and radiator wings.
        b.solid(block(0.6, 0.6, 1.3, 0.08), H_PLATE, [1.5, 0.1, -0.2], FLAT, ONE, true)
        for (const y of [0.25, -0.05]) barrel(b, l, [1.55, y, -1.3], 1.2, 0.06, true)
        radiator(b, l, [1.75, 0.15, 0.7], 1.25, 1.2, 0.0, glow, 4)
        // Sensor crown, reactor bulb below and a vented counterweight aft.
        b.solid(block(0.9, 0.35, 1.2, 0.07), H_PLATE, [0, 1.42, 0.2])
        slit(b, AMBER, [0, 1.45, -0.41], [0.7, 0.08, 0.04], 3)
        mast(b, [0.25, 1.6, 0.5], 1.1, 0.04)
        dish(b, l, [-0.2, 1.6, 0.4], 0.32)
        b.metal(cyl(0.7, 0.4, 0.7, 8), H_DARK, [0, -1.55, 0.1])
        b.glow(ico(0.34, 1), glow, 3.5, [0, -2.0, 0.1])
        b.metal(ring(0.42, 0.06, 4, 10), H_METAL, [0, -1.95, 0.1], [Math.PI / 2, 0, 0])
        b.metal(tube(0.6, 0.5, 0.6, 8), H_DARK, [0, 0, 1.95])
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2
            slit(b, glow, [Math.cos(a) * 0.4, Math.sin(a) * 0.4, 2.26], [0.3, 0.06, 0.03], 2, false, [0, 0, a + Math.PI / 2])
        }
        for (const side of [1, -1]) b.glow(octa(0.07), BEACON, 4.5, [side * 2.95, 0.2, 1.25])
    }
}

export function buildHostile(kind: string, glow: number, scale = 1): BuiltModel | null {
    const design = HOSTILE_DESIGNS[kind]
    if (!design) return null
    const b = new ModelBuilder()
    design(b, glow)
    const built = b.build()
    built.group.scale.setScalar(scale)
    built.radius *= scale
    return built
}
