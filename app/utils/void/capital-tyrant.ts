// Void Runner — the Tyrant siege cruiser, a hostile capital hull.

import * as THREE from 'three'
import { ModelBuilder, cyl, ico, mulberry32, octa, ring, tube, type Vec3 } from './models'
import { loft, slab, block, dish, tank, HAZARD, type Livery } from './ship-kit'
import type { CapitalModel, CapitalMount } from './capital-models'

// The hostile palette, as in hostiles.ts: gunmetal armour, dried-blood paint.
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

const livery = (glow: number): Livery => ({ paint: 0x5d5a60, paint2: H_DARK, trim: H_DARK, metal: H_METAL, accent: H_PAINT, glow, glass: 0 })

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)

/** A lit window on a flank: one quad facing out along +X. */
const pane = (length: number, h: number) => new THREE.PlaneGeometry(length, h).rotateY(Math.PI / 2)

/** A slab stood up to face down Z: the outline is (x, y). */
function wall(points: Pt[], thickness: number, bevel = 0.03) {
    return slab(points, thickness, bevel).rotateX(-Math.PI / 2)
}

/** A slab stood on edge along the keel line: the outline is (y, z). */
function fin(points: Pt[], thickness: number, bevel = 0.02) {
    return slab(points, thickness, bevel).rotateZ(Math.PI / 2)
}

/** An armour plate facing down Z. */
function facing(w: number, h: number, t: number, bevel = 0.08) {
    return wall([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], t, bevel)
}

/** A thin glowing slit. */
function slit(b: ModelBuilder, glow: number, pos: Vec3, size: Vec3, intensity = 2.4, mirror = false, rot: Vec3 = FLAT) {
    b.glow(box(...size), glow, intensity, pos, rot, ONE, mirror)
}

/** A panel seam or recess: a black inlay standing a hair proud of the plate. */
function groove(b: ModelBuilder, pos: Vec3, size: Vec3, mirror = false, rot: Vec3 = FLAT) {
    b.metal(box(...size), H_VOID, pos, rot, ONE, mirror)
}

/** A mast with a red beacon on top. */
function mast(b: ModelBuilder, pos: Vec3, height: number, r = 0.03, mirror = false) {
    b.metal(cyl(r * 0.5, r, height, 5), H_METAL, [pos[0], pos[1] + height / 2, pos[2]], FLAT, ONE, mirror)
    b.glow(octa(r * 2.4), BEACON, 5, [pos[0], pos[1] + height, pos[2]], FLAT, ONE, mirror)
}

/** A twin-barrelled deck turret, fixed forward: dressing, not a hardpoint. */
function deckGun(b: ModelBuilder, glow: number, pos: Vec3, s: number, mirror = false, up = 1) {
    const [x, y, z] = pos
    b.metal(cyl(s * 0.5, s * 0.62, s * 0.3, 6), H_DARK, [x, y + up * s * 0.15, z], FLAT, ONE, mirror)
    b.solid(box(s * 0.9, s * 0.45, s * 1.1), H_PLATE, [x, y + up * s * 0.5, z + s * 0.05], FLAT, ONE, mirror)
    for (const side of [-1, 1]) {
        b.metal(box(s * 0.13, s * 0.13, s * 1.3), H_METAL, [x + side * s * 0.22, y + up * s * 0.52, z - s * 1.05], FLAT, ONE, mirror)
        b.glow(box(s * 0.09, s * 0.09, s * 0.04), glow, 2.5, [x + side * s * 0.22, y + up * s * 0.52, z - s * 1.71], FLAT, ONE, mirror)
    }
}

/** A deck outline (x, z): a long rectangle with its corners cut. */
function deck(half: number, z0: number, z1: number, c0: number, c1: number): Pt[] {
    return [[-(half - c0), z0], [half - c0, z0], [half, z0 + c0], [half, z1 - c1], [half - c1, z1], [-(half - c1), z1], [-half, z1 - c1], [-half, z0 + c0]]
}

/** The hammerhead outline, inset by `i`; the bow gallery is a notch in the front. */
function hammer(i: number, notch = true): Pt[] {
    const h: Pt[] = [[17 - i * 0.4, -52 + i], [23 - i, -47.5 + i * 0.4], [23 - i, -42 - i * 0.4], [19.5 - i * 0.4, -38 - i]]
    if (notch) h.unshift([7 + i * 0.3, -49.5 + i], [8.5 + i, -52 + i])
    return [...h, ...h.map(([x, z]): Pt => [-x, z]).reverse()]
}

const mount = (x: number, y: number, z: number, nx = 0, ny = 1, nz = 0): CapitalMount => ({ position: new THREE.Vector3(x, y, z), normal: new THREE.Vector3(nx, ny, nz).normalize() })

// The broadside sponsons carrying the battery tubs, and the dorsal citadel.
const SPONSONS = [-17, 24]
const SPONSON_X = 12.4
const CITADEL_Z0 = -6
const CITADEL_Z1 = 12

/**
 * The Tyrant: a hundred-metre hammerhead battlecruiser. An armoured hammer
 * prow over a recessed bow gallery, a braced neck, a spine hull whose flanks
 * step down in gun-deck terraces, a casemate citadel under the bridge tower,
 * a deep keel fin, and a stern that is one open furnace.
 */
export function buildTyrant(glow: number): CapitalModel {
    const b = new ModelBuilder()
    const rnd = mulberry32(23)
    const l = livery(glow)
    const shades = [0x625f69, 0x77737e, 0x8a8692, 0x4e4b54, 0x9a96a3]
    const clutter = [0x4a4850, 0x7a7680, 0x9e9aa6, 0x34323a]
    const dim = (color: number, f: number) => new THREE.Color(color).multiplyScalar(f).getHex()
    const armour = (f = 1) => dim(rnd() < 0.1 ? H_PAINT : shades[Math.floor(rnd() * shades.length)]!, f)
    const nearSponson = (z: number, pad = 5.2) => SPONSONS.some(s => Math.abs(z - s) < pad)
    const underCitadel = (z: number) => z > CITADEL_Z0 - 0.6 && z < CITADEL_Z1 + 0.6

    // ── Hammerhead ─────────────────────────────────────────────────────────
    b.solid(slab(hammer(3.2, false), 1.0, 0.2), 0x1f1d22, [0, -5.0, 0])
    b.solid(slab(hammer(0, false), 2.9, 0.3), 0x3c3a42, [0, -3.05, 0])
    b.solid(slab(hammer(0.9), 1.8, 0.05), 0x141318, [0, -0.7, 0])
    b.solid(slab(hammer(0), 3.2, 0.3), 0x5f5c66, [0, 1.8, 0])
    b.solid(slab(hammer(2.6), 1.1, 0.2), 0x77737e, [0, 3.95, 0])

    // Heavy bow plating: slabs of armour bolted over the brow and jaw, seams between.
    {
        const yaw = -Math.atan2(4.5, 6)
        for (const [y, h, f] of [[1.8, 2.9, 1], [-3.05, 2.6, 0.72]] as const) {
            for (let i = 0; i < 3; i++) {
                const t = 0.45 + rnd() * 0.5
                b.solid(facing(2.65, h, t), armour(f), [10 + i * 2.85, y, -52 - t / 2 + 0.1], FLAT, ONE, true)
            }
            for (let i = 0; i < 2; i++) {
                const t = 0.45 + rnd() * 0.5
                const u = (i + 0.5) / 2
                b.solid(facing(3.5, h, t), armour(f), [17 + 6 * u + 0.3 * t, y, -52 + 4.5 * u - 0.4 * t], [0, yaw, 0], ONE, true)
            }
            // Hammer ends.
            for (let i = 0; i < 2; i++) b.solid(block(0.7, h, 2.6, 0.08), armour(f), [23.2, y, -46.2 + i * 2.8], FLAT, ONE, true)
        }
        // A strake along the top of the brow, slit down its face.
        b.solid(block(8.6, 0.6, 0.8, 0.08), 0x8a8692, [12.8, 3.0, -52.8], FLAT, ONE, true)
        slit(b, glow, [12.8, 3.0, -53.22], [7.6, 0.14, 0.08], 2.2, true)
        for (const x of [8.9, 16.75]) b.solid(block(0.6, 3.3, 1.5, 0.08), 0x34323a, [x, 1.8, -52.5], FLAT, ONE, true)
        // The jaw runs straight across under the gallery: a ram plate with teeth.
        for (let i = 0; i < 5; i++) b.solid(facing(2.7, 2.6, 0.5 + (i % 2) * 0.35), i === 2 ? H_PAINT2 : armour(0.72), [-5.8 + i * 2.9, -3.05, -52.2])
        for (let i = 0; i < 6; i++) b.metal(new THREE.ConeGeometry(0.5, 1.9, 4).rotateX(-Math.PI / 2), H_DARK, [-7.25 + i * 2.9, -3.6, -53.2], [0, 0, Math.PI / 4])
        slit(b, glow, [0, -1.72, -52.12], [14, 0.14, 0.12], 2.4)
    }

    // The bow gallery: a lit arcade set back in the brow, a balcony on the jaw.
    groove(b, [0, 1.0, -49.46], [13.6, 4.4, 0.16])
    for (let i = 0; i < 8; i++) {
        const x = -6.3 + i * 1.8
        b.solid(block(0.55, 4.9, 0.8, 0.08), i % 7 ? 0x55525c : H_PAINT2, [x, 0.95, -49.8])
        if (i < 7 && i !== 3) b.glow(box(1.0, 1.9, 0.08), i % 3 === 1 ? COLD : AMBER, 1.7, [x + 0.9, 1.7, -49.56])
        if (i < 7) b.glow(box(1.0, 0.4, 0.08), rnd() < 0.3 ? AMBER : COLD, 1.8, [x + 0.9, -0.5, -49.56])
    }
    b.metal(block(1.6, 3.4, 0.9, 0.1), H_PLATE, [0, 1.3, -49.9])
    b.glow(octa(0.55), glow, 4.5, [0, 1.7, -50.5])
    b.solid(block(14.6, 0.5, 0.9, 0.08), 0x8a8692, [0, 3.2, -49.9])
    b.solid(block(13, 0.25, 0.5, 0.05), H_PAINT, [0, -1.48, -51.6])
    for (let i = 0; i < 7; i++) b.glow(box(0.3, 0.1, 0.3), i % 2 ? BEACON : AMBER, 3, [-6 + i * 2, -1.52, -50.9])
    for (const x of [-4.2, 2.8, 5.2]) b.metal(block(1.2, 0.7, 0.9, 0.06), clutter[1]!, [x, -1.25, -50.35])

    // Gallery band windows right round the hammer.
    {
        const yaw = -Math.atan2(4.5, 6)
        for (const y of [-0.35, -1.05]) {
            for (let x = 9.9; x < 16.2; x += 1.3) if (rnd() > 0.25) b.glow(box(0.85, 0.3, 0.1), rnd() < 0.2 ? AMBER : COLD, 1.8, [x, y, -51.12], FLAT, ONE, true)
            for (let i = 0; i < 5; i++) {
                const u = (i + 0.6) / 5.2
                if (rnd() > 0.25) b.glow(box(0.85, 0.3, 0.1), rnd() < 0.2 ? AMBER : COLD, 1.8, [16.55 + 5.5 * u, y, -51.0 + 4.1 * u], [0, yaw, 0], ONE, true)
            }
            for (let z = -46.4; z < -42.2; z += 1.3) if (rnd() > 0.25) b.glow(box(0.1, 0.3, 0.85), COLD, 1.8, [22.12, y, z], FLAT, ONE, true)
            for (let x = 8.5; x < 18.5; x += 1.4) if (rnd() > 0.3) b.glow(box(0.85, 0.3, 0.1), rnd() < 0.2 ? AMBER : COLD, 1.8, [x, y, -38.88], FLAT, ONE, true)
        }
        // Buttresses bridging the band, and a glow line in its shadow.
        for (const x of [9.2, 13, 16.8]) b.solid(block(0.9, 2.0, 1.0, 0.08), 0x55525c, [x, -0.7, -51.6], FLAT, ONE, true)
        for (const z of [-47, -42.5]) b.solid(block(1.0, 2.0, 0.9, 0.08), 0x55525c, [22.6, -0.7, z], FLAT, ONE, true)
        slit(b, glow, [22.14, -1.45, -44.75], [0.1, 0.12, 3.4], 2.2, true)
    }

    // Hammer roof: plating on the brow ledge and the cap, a red brow stripe, the tip pods.
    {
        const onCap = (x: number, z: number, i: number) => z > -52 + i && z < -38 - i && x < 23 - i && x - 17 + i * 0.4 < (z + 52 - i) * 1.33 && x - 19.5 + i * 0.4 < (-38 - i - z) * 0.875 && !(x < 8.6 + i && z < -49.5 + i)
        for (let x = 1.6; x < 21; x += 3.3) {
            for (let z = -50.4; z < -39; z += 2.9) {
                const w = 3.0
                const d = 2.6
                if (Math.hypot(x, z + 45) < 6.4) continue
                if (![[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sz]) => onCap(x + sx! * w / 2, z + sz! * d / 2, 2.9))) continue
                const raised = rnd() < 0.3
                b.solid(block(w, raised ? 0.5 : 0.22, d, 0.05), armour(), [x, 4.5 + (raised ? 0.2 : 0.08), z], FLAT, ONE, true)
            }
        }
        // Brow ledge plates along the front and rear edges.
        for (let x = 9.6; x < 16; x += 2.4) b.solid(block(2.2, 0.24, 1.9, 0.05), armour(0.85), [x, 3.5, -50.85], FLAT, ONE, true)
        for (let x = 3; x < 18; x += 2.5) b.solid(block(2.3, 0.24, 1.9, 0.05), armour(0.85), [x, 3.5, -39.2], FLAT, ONE, true)
        for (let z = -46.4; z < -42; z += 2.3) b.solid(block(1.9, 0.24, 2.1, 0.05), armour(0.85), [21.85, 3.5, z], FLAT, ONE, true)
        const stripe: Pt[] = [[8.9, -51.7], [16.9, -51.7], [22.7, -47.35], [22.7, -46.5], [16.6, -51.05], [8.9, -51.05]]
        b.solid(slab(stripe, 0.3, 0.04), H_PAINT, [0, 3.58, 0])
        b.solid(slab(stripe.map(([x, z]): Pt => [-x, z]).reverse(), 0.3, 0.04), H_PAINT, [0, 3.58, 0])
        // Siege lances slung from the hammer ends.
        b.solid(loft([
            { z: -50.5, w: 1.0, h: 1.4, x: 23.9, y: -0.7 },
            { z: -48.5, w: 1.7, h: 2.5, x: 23.9, y: -0.7 },
            { z: -42, w: 1.7, h: 2.5, x: 23.9, y: -0.7 },
            { z: -39.5, w: 0.9, h: 1.3, x: 23.6, y: -0.7 }
        ], 8, 0.55, Math.PI / 8), 0x4a4850, FLAT, FLAT, ONE, true)
        b.solid(block(0.5, 1.4, 5, 0.08), H_PAINT, [25.45, -0.7, -45.2], FLAT, ONE, true)
        b.metal(tube(0.62, 0.72, 6.5, 8), H_METAL, [24, -0.7, -52.2], FLAT, ONE, true)
        b.metal(tube(0.95, 0.95, 1.0, 8), H_DARK, [24, -0.7, -54.4], FLAT, ONE, true)
        b.metal(tube(0.9, 0.9, 0.5, 8), H_DARK, [24, -0.7, -51.4], FLAT, ONE, true)
        b.glow(tube(0.45, 0.45, 0.06, 8), glow, 3, [24, -0.7, -54.93], FLAT, ONE, true)
        for (const z of [-47.5, -45.2, -42.9]) b.glow(box(0.08, 1.0, 0.5), glow, 2.2, [25.72, -0.7, z], FLAT, ONE, true)
        // Roof clutter and point defence.
        for (const x of [11.5, 18.5]) deckGun(b, glow, [x, 4.5, -41.6], 1.9, true)
        mast(b, [21, 3.4, -40.3], 4.5, 0.12, true)
        mast(b, [19.6, 3.4, -39.6], 2.6, 0.1, true)
        for (const x of [8.2, 14.6]) {
            b.metal(block(1.6, 0.9, 2.4, 0.08), clutter[0]!, [x, 5.0, -47.5], FLAT, ONE, true)
            b.glow(box(0.2, 0.12, 0.2), COLD, 3, [x, 5.5, -47.5], FLAT, ONE, true)
        }
    }

    // Hammer underside: belly plates, sensor pods, a keel light.
    for (let x = 1.8; x < 18; x += 3.4) {
        for (const z of [-48.6, -45.2, -41.8]) {
            if (x > 15 && z < -47) continue
            b.solid(box(3.1, 0.24, 3.1), armour(0.55), [x, -5.55, z], FLAT, ONE, true)
        }
    }
    for (const x of [7, 15]) {
        b.metal(ico(1.3, 1), H_LIGHT, [x, -5.7, -44], FLAT, [1, 0.7, 1.5], true)
        b.glow(ring(0.95, 0.07, 3, 10), glow, 2, [x, -6.5, -44], [Math.PI / 2, 0, 0], ONE, true)
    }
    slit(b, glow, [0, -5.72, -45], [0.4, 0.1, 9], 2)
    deckGun(b, glow, [19.5, -4.5, -44], 1.8, true, -1)

    // ── Neck ───────────────────────────────────────────────────────────────
    b.solid(slab([[-5.5, -39], [5.5, -39], [7, -24], [-7, -24]], 8, 0.3), 0x4a4850, [0, -0.2, 0])
    b.solid(slab([[-3.2, -40], [3.2, -40], [4, -24], [-4, -24]], 1.6, 0.2), 0x6d6a74, [0, 4.4, 0])
    b.solid(slab([[-3, -39], [3, -39], [4, -24], [-4, -24]], 1.6, 0.2), 0x2c2a30, [0, -4.8, 0])
    for (let i = 0; i < 4; i++) {
        const z = -36.6 + i * 3.5
        const half = 5.75 + (z + 39) * 0.1
        b.solid(block(half * 2 + 1.3, 9.2, 1.3, 0.15), i % 2 ? 0x3c3a42 : 0x625f69, [0, -0.2, z])
        b.solid(block(half * 2 + 1.5, 0.5, 1.5, 0.06), H_PAINT, [0, 2.6, z])
        if (i < 3) {
            slit(b, glow, [half + 0.2, -0.2, z + 1.75], [0.12, 5.4, 0.5], 2, true)
            for (const y of [1.6, -2.2]) b.glow(box(0.1, 0.3, 1.0), rnd() < 0.3 ? AMBER : COLD, 1.8, [half + 0.22, y + 1.4, z + 1.75], FLAT, ONE, true)
        }
    }
    for (const y of [3.2, -3.4]) b.metal(tube(0.4, 0.4, 14, 6), H_METAL, [6.9, y, -31.2], [0, 0.1, 0], ONE, true)
    // The dorsal trench runs on over the neck ridge, plated either side.
    groove(b, [0, 5.22, -32], [1.3, 0.3, 14.5])
    slit(b, glow, [0, 5.4, -32], [0.3, 0.06, 14], 2.2)
    for (let i = 0; i < 5; i++) {
        const z = -38.3 + i * 3.1
        const raised = rnd() < 0.35
        b.solid(block(1.9 + i * 0.15, raised ? 0.5 : 0.22, 2.8, 0.05), armour(), [1.95 + i * 0.08, 5.2 + (raised ? 0.2 : 0.08), z], FLAT, ONE, true)
        if (i % 2) b.metal(block(2.0, 0.5, 0.5, 0.05), H_PLATE, [0, 5.4, z + 1.5])
    }
    // Braces from the hammer's shoulders back to the hull.
    for (const [y, t, color] of [[-1.2, 1.8, 0x3c3a42], [2.2, 1.0, 0x625f69]] as const) {
        const brace: Pt[] = [[16.6, -38.6], [19.4, -38.6], [12.2, -22.6], [10, -23.4]]
        b.solid(slab(brace, t, 0.12), color, [0, y, 0])
        b.solid(slab(brace.map(([x, z]): Pt => [-x, z]).reverse(), t, 0.12), color, [0, y, 0])
    }
    {
        const yaw = Math.atan2(7, 15.5)
        for (let i = 0; i < 4; i++) {
            const u = (i + 0.7) / 4.6
            b.glow(box(0.1, 0.3, 1.6), i % 3 ? COLD : AMBER, 1.8, [19.5 - 7.2 * u, -1.2, -38.6 + 16 * u], [0, -yaw, 0], ONE, true)
        }
        b.metal(tube(0.3, 0.3, 17, 6), H_METAL, [14.3, 0.2, -30.8], [0, -yaw, 0], ONE, true)
    }

    // ── Spine hull and broadside terraces ──────────────────────────────────
    const SPINE = { half: 6, top: 5 }
    const T1 = { half: 9.5, top: 3.2 }
    const T2 = { half: 12, top: 0.6 }
    const T3 = { half: 14, top: -2.2 }
    b.solid(slab(deck(5, -26, 34, 3, 2), 1.8, 0.25), 0x1f1d22, [0, -8.5, 0])
    b.solid(slab(deck(10.5, -25, 36, 4, 1), 2.2, 0.25), 0x2c2a30, [0, -6.6, 0])
    b.solid(slab(deck(T3.half, -23, 36, 4, 0.5), 3.5, 0.3), 0x3c3a42, [0, -3.9, 0])
    b.solid(slab(deck(T2.half, -26, 35, 4.5, 1.5), 3.6, 0.3), 0x55525c, [0, -1.2, 0])
    b.solid(slab(deck(T1.half, -25, 33, 3, 2), 4.2, 0.3), 0x6d6a74, [0, 1.1, 0])
    b.solid(slab(deck(SPINE.half, -27, 37, 2, 0.5), 5, 0.25), 0x807c88, [0, 2.5, 0])

    // Tread plating: armour panels in broken shades with open seams between.
    const tread = (inner: number, outer: number, y: number, z0: number, z1: number, step: number, base: number, skip: (z: number) => boolean) => {
        for (let z = z0; z < z1; z += step) {
            const d = Math.min(step, z1 - z) - 0.3
            const raised = rnd() < 0.3
            const color = armour(base)
            if (skip(z + step / 2) || d < 1) continue
            b.solid(block(outer - inner, raised ? 0.5 : 0.22, d, 0.05), color, [(inner + outer) / 2, y + (raised ? 0.2 : 0.08), z + step / 2], FLAT, ONE, true)
        }
    }
    tread(SPINE.half + 0.8, T1.half - 0.8, T1.top, -21.5, 30, 3.7, 1, underCitadel)
    tread(T1.half + 0.4, T2.half - 0.7, T2.top, -21, 32, 4.3, 0.85, z => nearSponson(z, 4.4))
    tread(T2.half + 0.35, T3.half - 0.55, T3.top, -18.5, 35, 3.4, 0.7, z => nearSponson(z, 4.6))
    // Red trim down the edge of every tread.
    for (const [t, z0, z1] of [[T1, -21.5, 30.5], [T2, -21, 33], [T3, -18.5, 35]] as const) {
        for (let z = z0; z < z1; z += 9.2) {
            const d = Math.min(8.4, z1 - z)
            b.solid(box(0.5, 0.16, d), H_PAINT, [t.half - 0.4, t.top + 0.06, z + d / 2], FLAT, ONE, true)
        }
    }

    // Gun decks: every riser is a lit gallery of broadside guns between buttresses.
    const gunDeck = (x: number, y: number, h: number, z0: number, z1: number, skip: (z: number) => boolean, size: number) => {
        for (let z = z0; z < z1; z += 3.3) {
            if (skip(z)) continue
            groove(b, [x + 0.03, y, z + 0.4], [0.14, h, 2.7], true)
            b.solid(box(0.8, h + 0.35, 1.3), H_PLATE, [x + 0.3, y, z - 0.5], FLAT, ONE, true)
            b.metal(cyl(0.2 * size, 0.24 * size, 1.5 * size, 5), H_METAL, [x + 0.6 + 0.75 * size, y, z - 0.5], [0, 0, -Math.PI / 2], ONE, true)
            b.metal(box(0.3 * size, 0.6 * size, 0.6 * size), H_DARK, [x + 0.5 + 1.35 * size, y, z - 0.5], FLAT, ONE, true)
            b.glow(box(0.06, 0.2 * size, 0.2 * size), glow, 2.6, [x + 0.62 + 1.5 * size, y, z - 0.5], FLAT, ONE, true)
            if (rnd() > 0.2) b.glow(pane(1.5, h * 0.42), rnd() < 0.25 ? AMBER : COLD, 1.8, [x + 0.16, y, z + 1.1], FLAT, ONE, true)
        }
    }
    gunDeck(T1.half, 1.9, 1.5, -20, 31, z => underCitadel(z) || nearSponson(z), 0.9)
    gunDeck(T2.half, -0.8, 1.6, -20.5, 33, z => nearSponson(z), 1.1)
    // Buttresses over the terrace steps.
    for (let z = -22; z < 34; z += 9.9) {
        if (nearSponson(z)) continue
        if (!underCitadel(z)) b.solid(block(1.1, 2.9, 1.2, 0.1), 0x8a8692, [T1.half + 0.2, 1.9, z + 1.2], FLAT, ONE, true)
        b.solid(block(1.1, 3.1, 1.2, 0.1), 0x625f69, [T2.half + 0.2, -0.8, z + 1.2], FLAT, ONE, true)
    }
    // Windows under the spine's shoulder and along the lower hull.
    const litRow = (x: number, y: number, z0: number, z1: number, step: number, size: number, skip: (z: number) => boolean) => {
        for (let z = z0; z < z1; z += step) {
            if (rnd() < 0.28 || skip(z)) continue
            b.glow(pane(size, 0.3), rnd() < 0.2 ? AMBER : COLD, 1.8, [x + 0.05, y, z], FLAT, ONE, true)
        }
    }
    const hangarZ = 3
    const nearSlot = (z: number) => Math.abs(z - hangarZ) < 9.4 || [-9.5, 15.5, 32].some(s => Math.abs(z - s) < 2.8)
    litRow(SPINE.half + 0.06, 4.2, -24, 35, 1.7, 0.9, z => underCitadel(z) || (z > 12 && z < 28))
    litRow(T3.half + 0.06, -2.9, -18, 35, 2.1, 1.2, z => nearSponson(z) || nearSlot(z))
    litRow(T3.half + 0.06, -4.0, -18, 35, 2.1, 1.2, z => nearSponson(z) || nearSlot(z))
    litRow(T3.half + 0.06, -5.0, -17, 35, 2.8, 1.5, z => nearSponson(z) || nearSlot(z))
    litRow(10.56, -6.6, -19, 35, 3.1, 1.5, () => false)
    litRow(5.06, -8.5, -22, 32, 3.4, 1.4, () => false)
    // A pale trim line along the lower hull's shoulder, armour belts below it.
    for (let z = -18.5; z < 35; z += 6.7) {
        if (nearSponson(z + 3, 7) || nearSlot(z + 3)) continue
        b.solid(block(0.4, 1.0, 6.2, 0.06), rnd() < 0.2 ? H_PAINT2 : dim(shades[Math.floor(rnd() * 5)]!, 0.6), [T3.half + 0.12, -3.45, z + 3.1], FLAT, ONE, true)
    }

    // Launch slots in the lower hull: dark mouths with guide lights.
    for (const z of [-9.5, 15.5, 32]) {
        b.solid(block(0.9, 2.9, 4.6, 0.1), 0x55525c, [T3.half + 0.2, -3.9, z], FLAT, ONE, true)
        groove(b, [T3.half + 0.62, -3.9, z], [0.12, 1.7, 3.4], true)
        b.glow(box(0.1, 0.9, 2.4), glow, 0.9, [T3.half + 0.66, -3.9, z], FLAT, ONE, true)
        for (const y of [-4.9, -2.9]) b.glow(box(0.1, 0.12, 3.4), AMBER, 2.6, [T3.half + 0.68, y, z], FLAT, ONE, true)
        for (const dz of [-1.95, 1.95]) b.glow(box(0.12, 0.3, 0.3), BEACON, 3, [T3.half + 0.7, -3.9, z + dz], FLAT, ONE, true)
    }

    // Flank hangars: an open gallery under the citadel with fighters parked under the lights.
    {
        const x = T3.half + 1.2
        const at = (u: number, v: number, w: number): Vec3 => [x + u, -3.7 + v, hangarZ + w]
        b.solid(block(3.6, 0.6, 16.6, 0.12), 0x4a4850, at(0, -2.2, 0), FLAT, ONE, true)
        b.solid(block(3.8, 0.9, 17, 0.15), 0x6d6a74, at(0, 2.1, 0), FLAT, ONE, true)
        b.solid(block(2.8, 0.3, 14.6, 0.08), H_PAINT, at(0, 2.65, 0), FLAT, ONE, true)
        for (const w of [-7.9, 0, 7.9]) b.solid(block(3.6, 3.8, w ? 1.2 : 0.7, 0.12), 0x55525c, at(0, -0.05, w), FLAT, ONE, true)
        b.metal(box(0.3, 3.6, 15.6), 0x0b0a0d, at(-1.5, -0.05, 0), FLAT, ONE, true)
        for (const w of [-3.95, 3.95]) {
            b.glow(box(0.1, 2.2, 6), glow, 0.8, at(-1.3, 0, w), FLAT, ONE, true)
            b.glow(box(2.4, 0.1, 0.3), AMBER, 2.6, at(0, 1.6, w - 2), FLAT, ONE, true)
            b.glow(box(2.4, 0.1, 0.3), AMBER, 2.6, at(0, 1.6, w + 2), FLAT, ONE, true)
            b.glow(box(3, 0.06, 0.16), glow, 2.2, at(0.1, -1.86, w), FLAT, ONE, true)
            // A parked fighter.
            b.solid(loft([{ z: -1.3, w: 0.05, h: 0.05 }, { z: 0, w: 0.36, h: 0.27 }, { z: 0.9, w: 0.27, h: 0.2 }], 6, 0.7), 0x5d5a60, at(-0.2, -1.4, w), [0, Math.PI / 2, 0], ONE, true)
            b.solid(slab([[-1.1, -0.5], [0, 0.1], [1.1, -0.5], [0.8, 0.4], [-0.8, 0.4]], 0.08, 0.02), H_PAINT, at(-0.2, -1.45, w), [0, Math.PI / 2, 0], ONE, true)
        }
        for (const v of [-1.78, 1.6]) b.glow(box(0.14, 0.14, 16), AMBER, 2.6, at(1.85, v, 0), FLAT, ONE, true)
        for (let i = 0; i < 5; i++) b.glow(box(0.4, 0.08, 0.4), i % 2 ? BEACON : AMBER, 3, at(1.4, -1.86, -6.2 + i * 3.1), FLAT, ONE, true)
    }

    // Deck clutter: machinery blocks and pipe runs on the treads.
    for (let i = 0; i < 46; i++) {
        const z = -21 + rnd() * 54
        const upper = rnd() < 0.5
        const lo = (upper ? SPINE.half : T1.half) + 0.7
        const hi = (upper ? T1.half : T2.half) - 1.2
        const w = 0.7 + rnd() * 1.2
        const h = 0.4 + rnd() * 1.1
        const d = 1 + rnd() * 3.2
        const x = lo + rnd() * (hi - lo)
        if ((upper && underCitadel(z)) || (!upper && nearSponson(z, 5.5)) || (!upper && underCitadel(z) && x < 11.6)) continue
        b.metal(box(w, h, d), clutter[i % clutter.length]!, [x, (upper ? T1.top : T2.top) + 0.2 + h / 2, z], FLAT, ONE, true)
        if (i % 5 === 0) b.glow(box(0.2, 0.12, 0.2), i % 10 ? COLD : BEACON, 3, [x, (upper ? T1.top : T2.top) + 0.3 + h, z], FLAT, ONE, true)
    }
    for (const z of [-15, 17, 26]) b.metal(tube(0.26, 0.26, 7.5, 6), H_METAL, [SPINE.half + 0.5, T1.top + 0.5, z], FLAT, ONE, true)
    for (const z of [-9, 16]) b.metal(tube(0.26, 0.26, 6, 6), H_METAL, [T1.half + 0.5, T2.top + 0.5, z], FLAT, ONE, true)

    // Forward spine: plating, a lit dorsal trench and the two rocket silos.
    const silos: CapitalMount[] = []
    for (let z = -24.5; z < -7; z += 3.5) b.solid(block(1.9, 0.24, 3.2, 0.05), armour(), [4.7, SPINE.top + 0.08, z + 1.6], FLAT, ONE, true)
    for (const z of [-7.4, -26]) b.solid(block(2.5, 0.24, 1.5, 0.05), armour(), [2.3, SPINE.top + 0.08, z], FLAT, ONE, true)
    groove(b, [0, SPINE.top + 0.06, -17], [1.6, 0.3, 19])
    slit(b, glow, [0, SPINE.top + 0.24, -17], [0.3, 0.06, 18.4], 2.2)
    for (const z of [-21.5, -12.5]) {
        b.metal(cyl(2.7, 3.2, 1.0, 10), H_DARK, [0, SPINE.top + 0.5, z])
        b.metal(cyl(2.2, 2.2, 0.1, 10), H_VOID, [0, SPINE.top + 1.01, z])
        b.glow(ring(2.35, 0.07, 3, 16), glow, 2, [0, SPINE.top + 1.04, z], [Math.PI / 2, 0, 0])
        b.solid(new THREE.ConeGeometry(1.6, 1.6, 8), H_PAINT2, [0, SPINE.top + 0.95, z])
        // Blast doors slid open fore and aft, hazard-edged.
        for (const s of [-1, 1]) {
            b.solid(block(4.4, 0.4, 1.5, 0.06), 0x4e4b54, [0, SPINE.top + 0.3, z + s * 3.6])
            b.solid(box(4.2, 0.1, 0.35), HAZARD, [0, SPINE.top + 0.52, z + s * 3.05])
        }
        for (let i = 0; i < 4; i++) b.solid(box(0.5, 0.1, 0.36), 0x15171b, [-1.55 + i * 1.05, SPINE.top + 0.525, z - 3.05])
        for (let i = 0; i < 4; i++) b.solid(box(0.5, 0.1, 0.36), 0x15171b, [-1.55 + i * 1.05, SPINE.top + 0.525, z + 3.05])
        silos.push(mount(0, SPINE.top + 1.05, z, 0, 1, -0.25))
    }

    // ── Battery sponsons ───────────────────────────────────────────────────
    const batteries: CapitalMount[] = []
    for (const z of SPONSONS) {
        const x = SPONSON_X
        const drum = (r: number, c: number): Pt[] => [[-r + 0.6, -r - 0.4], [r - c, -r - 0.4], [r, -r - 0.4 + c], [r, r + 0.4 - c], [r - c, r + 0.4], [-r + 0.6, r + 0.4]]
        b.solid(slab(drum(4.0, 2.2), 3.6, 0.3), 0x34323a, [x, -3.9, z], FLAT, ONE, true)
        b.solid(slab(drum(3.75, 2.1), 3.2, 0.3), 0x625f69, [x, -0.5, z], FLAT, ONE, true)
        // A brace under the sponson, slots and a stripe round its face.
        b.solid(fin([[0, -3.4], [0, 3.4], [-2.6, 2.2], [-2.6, -2.2]], 5.4, 0.15), 0x2c2a30, [x - 0.4, -5.7, z], FLAT, ONE, true)
        b.solid(block(0.4, 0.5, 5.2, 0.05), H_PAINT, [x + 3.8, 0.5, z], FLAT, ONE, true)
        groove(b, [x + 3.78, -0.9, z], [0.12, 1.2, 4.6], true)
        for (const dz of [-1.5, 0, 1.5]) b.glow(box(0.1, 0.5, 1.0), dz ? COLD : AMBER, 1.8, [x + 3.84, -0.9, z + dz], FLAT, ONE, true)
        slit(b, glow, [x + 4.04, -3.9, z], [0.1, 0.16, 4.4], 2.2, true)
        for (const s of [-1, 1]) {
            b.glow(box(1.2, 0.4, 0.1), COLD, 1.8, [x + 0.8, -0.9, z + s * 4.17], FLAT, ONE, true)
            b.glow(box(1.4, 0.16, 0.1), glow, 2.2, [x + 0.6, -3.9, z + s * 4.42], FLAT, ONE, true)
        }
        // The open tub the battery sits in.
        b.metal(cyl(2.7, 3.3, 1.0, 10), H_DARK, [x, 1.6, z], FLAT, ONE, true)
        b.metal(cyl(2.3, 2.3, 0.08, 10), H_VOID, [x, 2.1, z], FLAT, ONE, true)
        b.glow(ring(2.85, 0.07, 3, 16), glow, 2, [x, 2.08, z], [Math.PI / 2, 0, 0], ONE, true)
        for (const s of [-1, 1]) b.metal(block(1.4, 0.6, 1.2, 0.06), clutter[1]!, [x + 1.4, 1.4, z + s * 3.4], FLAT, ONE, true)
        batteries.push(mount(x, 2.1, z, 0.2, 1, 0), mount(-x, 2.1, z, -0.2, 1, 0))
    }

    // ── Citadel ────────────────────────────────────────────────────────────
    const citadels: CapitalMount[] = []
    /** An armoured barbette: a heavy ring wall on a bolted skirt, built into the deck. */
    const barbette = (x: number, y: number, z: number, mirror: boolean) => {
        b.solid(cyl(4.75, 5.1, 0.5, 12), 0x34323a, [x, y + 0.25, z], FLAT, ONE, mirror)
        b.solid(cyl(4.2, 4.5, 1.5, 12), 0x4e4b54, [x, y + 0.75, z], FLAT, ONE, mirror)
        b.solid(cyl(4.42, 4.46, 0.34, 12), H_PAINT, [x, y + 1.0, z], FLAT, ONE, mirror)
        for (let i = 0; i < 12; i++) {
            const a = (i + 0.5) / 12 * Math.PI * 2
            const c = Math.cos(a)
            const s = Math.sin(a)
            // Skirt plates with a bolt at each end, hazard blocks round the lip.
            b.solid(block(2.15, 0.85, 0.5, 0.08), i % 2 ? 0x77737e : 0x5a5761, [x + c * 4.62, y + 0.55, z + s * 4.62], [0, Math.PI / 2 - a, 0], ONE, mirror)
            for (const t of [-0.7, 0.7]) b.metal(box(0.2, 0.24, 0.24), 0x9e9aa6, [x + c * 4.9 - s * t, y + 0.6, z + s * 4.9 + c * t], [0, -a, 0], ONE, mirror)
            b.solid(box(1.0, 0.14, 0.55), i % 2 ? HAZARD : 0x15171b, [x + c * 3.8, y + 1.52, z + s * 3.8], [0, Math.PI / 2 - a, 0], ONE, mirror)
        }
        b.metal(cyl(3.35, 3.35, 0.1, 12), H_VOID, [x, y + 1.5, z], FLAT, ONE, mirror)
        b.glow(ring(3.42, 0.09, 3, 24), glow, 2.2, [x, y + 1.54, z], [Math.PI / 2, 0, 0], ONE, mirror)
        citadels.push(mount(x, y + 1.5, z))
        if (mirror) citadels.push(mount(-x, y + 1.5, z))
    }
    barbette(0, 4.5, -45, false)

    {
        const z0 = CITADEL_Z0
        const z1 = CITADEL_Z1
        const zc = (z0 + z1) / 2
        b.solid(slab(deck(11.3, z0, z1, 1.6, 1.6), 3.2, 0.3), 0x3c3a42, [0, 2.1, 0])
        b.solid(slab(deck(10.9, z0 + 0.4, z1 - 0.4, 1.8, 1.8), 2.9, 0.3), 0x6d6a74, [0, 5.05, 0])
        // Casemate guns under an armour belt.
        for (let i = 0; i < 4; i++) {
            const z = z0 + 3 + i * 4
            b.solid(block(0.9, 2.2, 2.2, 0.12), H_PLATE, [11.5, 2.0, z], FLAT, ONE, true)
            b.metal(cyl(0.34, 0.4, 2.6, 8), H_METAL, [12.9, 2.0, z], [0, 0, -Math.PI / 2], ONE, true)
            b.metal(cyl(0.55, 0.55, 0.5, 8), H_DARK, [13.9, 2.0, z], [0, 0, -Math.PI / 2], ONE, true)
            b.glow(box(0.06, 0.34, 0.34), glow, 2.8, [14.17, 2.0, z], FLAT, ONE, true)
            if (i < 3) b.glow(box(0.1, 0.5, 1.2), i === 1 ? AMBER : COLD, 1.8, [11.36, 2.0, z + 2], FLAT, ONE, true)
        }
        for (let i = 0; i < 5; i++) b.solid(block(0.45, 1.5, 2.8, 0.08), i === 2 ? H_PAINT : armour(), [11.0, 5.2, z0 + 2.6 + i * 3.2], FLAT, ONE, true)
        slit(b, glow, [11.34, 3.62, zc], [0.1, 0.14, 14], 2, true)
        for (let i = 0; i < 9; i++) if (i % 4 !== 2) b.glow(box(0.12, 0.3, 0.9), COLD, 1.8, [10.96, 6.2, z0 + 2 + i * 1.7], FLAT, ONE, true)
        // Forward face: a sloped glacis with a windowed gallery.
        b.solid(slab([[-8.6, 0], [8.6, 0], [7.4, 2.6], [-7.4, 2.6]], 0.6, 0.1), 0x8a8692, [0, 4.9, z0 - 0.2], [1.0, 0, 0])
        for (let i = 0; i < 9; i++) if (i !== 4) b.glow(box(1.0, 0.3, 0.1), i % 3 ? COLD : AMBER, 1.8, [-6.4 + i * 1.6, 4.1, z0 + 0.32])
        b.solid(block(15, 0.3, 0.5, 0.05), H_PAINT, [0, 3.72, z0 + 0.25])
        // Roof: the barbette pair, armour plates round them and a vented ridge between.
        barbette(6.1, 6.5, 3, true)
        for (const z of [z0 + 1.6, z1 - 1.6]) for (let x = 1.6; x < 9; x += 2.9) b.solid(block(2.6, 0.24, 1.7, 0.05), armour(), [x + 0.2, 6.58, z], FLAT, ONE, true)
        b.solid(block(1.9, 0.9, 12, 0.12), 0x4a4850, [0, 6.95, 3])
        for (let i = 0; i < 6; i++) b.metal(box(1.3, 0.12, 0.9), H_VOID, [0, 7.42, -1.5 + i * 1.8])
        slit(b, glow, [0, 7.44, 3], [0.2, 0.08, 10.6], 2)
    }

    // ── Bridge tower ───────────────────────────────────────────────────────
    b.solid(slab(deck(6.6, 12, 29, 0.8, 2.2), 2.4, 0.25), 0x55525c, [0, 6.2, 0])
    b.solid(slab(deck(5.2, 13.5, 26.5, 1, 1.6), 1.9, 0.2), 0x6d6a74, [0, 8.35, 0])
    b.solid(block(8, 0.3, 1.2, 0.06), H_PAINT, [0, 9.36, 14.4])
    b.solid(block(6.4, 3.2, 8, 0.3), 0x4a4850, [0, 10.9, 20.8])
    b.solid(block(3.8, 3.2, 2.4, 0.2), 0x8a8692, [0, 10.9, 16.2])
    for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 5; i++) {
            if ((row + i) % 4 === 3) continue
            b.glow(box(0.12, 0.32, 0.85), COLD, 1.8, [3.26, 10.2 + row * 1.2, 18 + i * 1.4], FLAT, ONE, true)
        }
        slit(b, row ? AMBER : COLD, [0, 10.2 + row * 1.2, 14.95], [2.8, 0.3, 0.1], 1.8)
    }
    for (let i = 0; i < 8; i++) if (i % 3 !== 1) b.glow(box(0.12, 0.3, 0.9), rnd() < 0.3 ? AMBER : COLD, 1.8, [6.66, 6.4, 14.2 + i * 1.7], FLAT, ONE, true)
    for (let i = 0; i < 6; i++) if (i % 4 !== 2) b.glow(box(0.12, 0.3, 0.9), COLD, 1.8, [5.26, 8.5, 15.4 + i * 1.7], FLAT, ONE, true)
    // The bridge: a forward-raked head with a visor, flying wings for the dishes.
    b.solid(slab([[-4.6, -4.2], [4.6, -4.2], [3.6, 3.4], [-3.6, 3.4]], 2.0, 0.25), 0x807c88, [0, 13.5, 20.4])
    b.solid(slab([[-4.2, -4.9], [4.2, -4.9], [4.2, -4.0], [-4.2, -4.0]], 0.9, 0.1), 0x34323a, [0, 13.55, 20.4])
    slit(b, AMBER, [0, 13.6, 15.46], [7.6, 0.34, 0.12], 3)
    slit(b, COLD, [0, 12.75, 16.1], [8.4, 0.2, 0.12], 1.8)
    for (let i = 0; i < 4; i++) b.glow(box(0.12, 0.32, 0.9), i === 2 ? AMBER : COLD, 1.8, [4.42 - i * 0.14, 13.6, 17.6 + i * 1.5], [0, 0.13, 0], ONE, true)
    b.solid(block(6, 0.8, 5, 0.15), 0x55525c, [0, 14.9, 20.6])
    b.solid(block(3, 0.6, 2.4, 0.1), H_PAINT2, [0, 15.6, 21])
    b.solid(block(3.4, 0.5, 3, 0.08), 0x625f69, [6.2, 12.4, 22], FLAT, ONE, true)
    b.metal(box(2.4, 0.3, 0.3), H_METAL, [4.4, 12.0, 22], [0, 0, 0.4], ONE, true)
    dish(b, l, [-6.4, 12.6, 22], 1.5)
    dish(b, l, [6.4, 12.6, 22], 1.1)
    dish(b, l, [0, 9.3, 24.6], 1.3)
    for (const [x, z, h] of [[1.6, 22.2, 6], [-1.2, 21.4, 4], [0.4, 19.6, 2.8], [-2.4, 22.4, 4.8], [2.6, 20, 2.2]] as const) mast(b, [x, 15.3, z], h, 0.15)
    // Tower point defence.
    deckGun(b, glow, [4.2, 7.4, 27.2], 1.6, true)
    deckGun(b, glow, [0, 9.3, 14.9], 1.5)

    // Aft spine: heat exchangers feeding the furnace, tanks along the shoulders.
    for (let i = 0; i < 7; i++) {
        b.metal(box(8.4, 1.5, 0.35), i % 2 ? 0x34323a : 0x4a4850, [0, SPINE.top + 0.75, 30 + i * 1.0])
        if (i < 6) b.glow(box(7.6, 0.2, 0.3), glow, 1.5, [0, SPINE.top + 0.35, 30.5 + i * 1.0])
    }
    b.solid(block(1.2, 1.9, 7.4, 0.1), 0x625f69, [4.8, SPINE.top + 0.9, 33], FLAT, ONE, true)
    tank(b, l, H_PAINT2, [7.8, T1.top + 1.0, 30.4], 0.9, 3.6, true)
    tank(b, l, 0x77737e, [10.7, T2.top + 0.9, 31.5], 0.8, 3, true)

    // Point-defence guns along the terraces and the belly.
    for (const z of [-21.5, -9.5, 15, 28]) deckGun(b, glow, [SPINE.half + 1.9, T1.top + 0.1, z], 1.7, true)
    for (const z of [-8.5, 14.5, 32]) deckGun(b, glow, [T1.half + 1.4, T2.top + 0.1, z], 1.6, true)
    for (const z of [-14, 8, 30]) deckGun(b, glow, [12.4, -5.65, z], 1.6, true, -1)
    for (const z of [-20, 18]) deckGun(b, glow, [7.6, -7.7, z], 1.9, true, -1)

    // ── Belly and keel fin ─────────────────────────────────────────────────
    for (let z = -20; z < 34; z += 4.5) {
        b.solid(box(4.4, 0.24, 4.1), armour(0.55), [7.9, -7.75, z + 2.2], FLAT, ONE, true)
        if (rnd() < 0.6) b.solid(box(3.2, 0.22, 4.1), armour(0.45), [2.9, -9.42, z + 2.2], FLAT, ONE, true)
    }
    for (const z of [-13, 27]) {
        b.metal(ico(1.4, 1), H_LIGHT, [3.4, -9.6, z], FLAT, [1, 0.75, 1.6], true)
        b.glow(ring(1.0, 0.08, 3, 10), glow, 2, [3.4, -10.5, z], [Math.PI / 2, 0, 0], ONE, true)
    }
    // Belly ribs, pipe runs under the lower hull and a glow line either side of the keel.
    for (let z = -17; z < 34; z += 8.5) {
        b.solid(block(21.4, 0.6, 1.1, 0.08), 0x3c3a42, [0, -7.6, z])
        b.solid(block(3.2, 0.5, 1.3, 0.08), 0x4a4850, [12.3, -5.75, z], FLAT, ONE, true)
        slit(b, glow, [6.6, -7.74, z + 4.25], [0.3, 0.08, 5.6], 2, true)
    }
    for (let z = -18; z < 34; z += 5.2) {
        if (nearSponson(z + 2.4, 6.2)) continue
        b.solid(box(2.5, 0.22, 4.8), armour(0.5), [12.35, -5.7, z + 2.4], FLAT, ONE, true)
    }
    b.metal(tube(0.32, 0.32, 40, 6), H_METAL, [10.2, -7.95, 7], FLAT, ONE, true)
    // The keel fin: a deep blade on a thick root, ribbed, slit down its length.
    b.solid(fin([[0, -19], [0, 27], [-1.6, 26], [-1.6, -17]], 2.8, 0.2), 0x2c2a30, [0, -9.2, 0])
    b.solid(fin([[0, -18], [0, 26], [-4.4, 22.5], [-7.8, 15], [-7.8, -4], [-5.4, -11.5]], 1.2, 0.15), 0x232126, [0, -9.4, 0])
    b.solid(fin([[0, -12], [0, 20], [-3.2, 17], [-3.6, -6]], 1.8, 0.12), 0x3c3a42, [0, -10.4, 0])
    b.solid(fin([[0, -7], [0, 16], [-1.0, 15.2], [-1.0, -6]], 1.5, 0.08), H_PAINT2, [0, -15.6, 0])
    for (let i = 0; i < 6; i++) b.solid(box(1.6, 3.4 - Math.abs(i - 2.5) * 0.3, 0.7), 0x34323a, [0, -14, -3.5 + i * 3.6])
    slit(b, glow, [0, -14.6, 5.5], [1.34, 0.3, 17.5], 2)
    for (let i = 0; i < 8; i++) if (i % 4 !== 2) b.glow(box(1.92, 0.3, 0.9), i % 3 ? COLD : AMBER, 1.8, [0, -11.6, -6 + i * 3.1])
    b.metal(tube(0.9, 0.9, 21, 8), H_PLATE, [0, -17.3, 5.5])
    b.metal(new THREE.ConeGeometry(0.9, 2.6, 8).rotateX(-Math.PI / 2), H_DARK, [0, -17.3, -6.3])
    b.glow(octa(0.4), glow, 4, [0, -17.3, -7.8])
    for (const z of [-2, 5.5, 13]) b.glow(ring(0.95, 0.07, 3, 10), glow, 2, [0, -17.3, z])
    // Ventral stabilisers aft.
    b.solid(fin([[0, -4], [0, 7], [-3.6, 8.2], [-2.8, 0]], 0.6, 0.12), 0x3c3a42, [7.5, -7.6, 26], [0, 0, 0.4], ONE, true)

    // ── Stern furnace ──────────────────────────────────────────────────────
    const core = new THREE.Vector3(0, 0, 41)
    // A firewall bulkhead closes the hull off from the furnace.
    b.solid(block(29.4, 14.2, 1.5, 0.2), 0x3c3a42, [0, -0.1, 36.1])
    b.solid(block(29.8, 0.5, 1.7, 0.08), H_PAINT, [0, 5.4, 36.1])
    for (const y of [-3.4, -0.6, 2.2]) b.solid(block(0.5, 1.6, 1.9, 0.08), 0x625f69, [14.7, y + 1.4, 36.1], FLAT, ONE, true)
    b.solid(block(27, 13, 10, 0.4), 0x2c2a30, [0, -0.1, 41])
    b.solid(block(28.2, 1.0, 10.4, 0.12), 0x55525c, [0, -6.2, 41])
    // The open furnace well: a slatted grille over the fire, a reactor drum in the middle.
    for (const x of [10.4]) b.solid(block(6.6, 1.5, 10.2, 0.15), 0x55525c, [x, 7.05, 41], FLAT, ONE, true)
    for (const z of [37, 45.2]) b.solid(block(14.4, 1.5, 1.9, 0.15), 0x4a4850, [0, 7.05, z])
    b.glow(box(14.2, 0.1, 6.4), glow, 1.1, [0, 6.5, 41.1])
    for (let i = 0; i < 7; i++) b.metal(box(14.4, 0.16, 0.6), 0x17151a, [0, 7.35, 38.5 + i * 0.87], [0.6, 0, 0])
    for (const x of [-4.7, 4.7]) b.metal(box(0.5, 0.5, 6.6), H_PLATE, [x, 7.5, 41.1])
    b.metal(cyl(1.9, 2.2, 1.7, 10), H_PLATE, [0, 7.4, 41.1])
    b.glow(ring(1.5, 0.12, 3, 16), glow, 2.8, [0, 8.28, 41.1], [Math.PI / 2, 0, 0])
    b.glow(cyl(0.9, 0.9, 0.08, 8), glow, 1.6, [0, 8.27, 41.1])
    b.glow(box(4.4, 0.1, 7.2), glow, 0.9, [10.5, 7.84, 41], FLAT, ONE, true)
    for (let i = 0; i < 8; i++) b.metal(box(4.7, 0.34, 0.5), i % 3 ? 0x232126 : H_PAINT2, [10.5, 7.95, 37.85 + i * 0.9], FLAT, ONE, true)
    b.solid(block(0.5, 0.3, 9.6, 0.05), H_PAINT, [13.35, 7.9, 41], FLAT, ONE, true)
    for (const z of [38.4, 43.6]) b.metal(tube(0.5, 0.5, 3.6, 6), H_METAL, [8.2, 8.0, z], [0, Math.PI / 2, 0], ONE, true)
    // Flanks: cooling fins standing over the glow.
    b.glow(box(0.1, 8.4, 8.2), glow, 1.5, [13.56, 0.3, 41], FLAT, ONE, true)
    for (let i = 0; i < 8; i++) b.metal(box(1.2, 9, 0.34), i % 2 ? 0x34323a : 0x232126, [13.9, 0.3, 37.15 + i * 1.1], FLAT, ONE, true)
    for (const y of [5.0, -4.4]) b.solid(block(1.7, 0.8, 9.4, 0.1), 0x625f69, [13.9, y, 41], FLAT, ONE, true)
    b.metal(tube(0.45, 0.45, 9.6, 6), H_METAL, [14.2, 5.8, 41], FLAT, ONE, true)
    // Transom: the furnace grille over three big drives and two small.
    b.glow(box(21, 2.7, 0.1), glow, 1.2, [0, 4.3, 46.04])
    for (let i = 0; i < 5; i++) b.metal(box(21.6, 0.2, 0.7), 0x17151a, [0, 3.2 + i * 0.55, 46.25], [-0.5, 0, 0])
    for (let i = 0; i < 6; i++) b.metal(box(0.6, 3.2, 0.9), i % 5 ? 0x34323a : H_PAINT2, [-10.5 + i * 4.2, 4.3, 46.3])
    b.solid(block(23.4, 0.7, 1.4, 0.1), 0x55525c, [0, 6.05, 46.3])
    b.solid(block(23.4, 0.5, 1.2, 0.08), 0x4a4850, [0, 2.6, 46.2])
    const shroud = (x: number, y: number, r: number, mirror: boolean) => {
        b.metal(tube(r * 1.32, r * 1.55, r * 1.1, 14), 0x232126, [x, y, 46 + r * 0.15], FLAT, ONE, mirror)
        b.glow(ring(r * 1.36, r * 0.05, 3, 20), glow, 2.2, [x, y, 46 + r * 0.74], FLAT, ONE, mirror)
        b.engine([x, y, 46], r, mirror, glow)
    }
    shroud(0, -1.9, 3.0, false)
    shroud(9.2, -1.9, 2.5, true)
    b.engine([4.7, -5.3, 46], 0.95, true, glow)
    for (const x of [4.65, 12.95]) slit(b, glow, [x, -0.6, 46.06], [0.3, 4.4, 0.1], 2.2, true)
    for (const x of [4.65]) b.solid(fin([[-2.6, 0], [2.6, 0], [2, 2.2], [-2, 2.2]], 0.7, 0.1), 0x55525c, [x + 0.7, -0.6, 46], FLAT, ONE, true)
    for (const x of [-8, 0, 8]) slit(b, glow, [x, -6.74, 41], [5.4, 0.1, 0.5], 2)
    // Heat slits where the hull meets the furnace.
    for (const y of [-3.4, -0.6, 2.2]) slit(b, glow, [14.72, y, 36.1], [0.1, 0.3, 1.1], 2.2, true)

    const built = b.build()

    // The hull for shots: the hammer, the neck and its braces, the stepped hull, the citadel, the tower, the keel fin and the furnace.
    const inside = (x: number, y: number, z: number) => {
        const ax = x < 0 ? -x : x
        if (z < -55 || z > 49 || ax > 25.8 || y < -18.4 || y > 16.2) return false
        if (z < -38) {
            if (y > 5 || y < -5.6) return y <= 6.4 && y > 0 && ax < 5.2 && z > -50.2 && z < -39.8
            if (ax > 23.2) return ax < 25.8 && y > -3.3 && y < 1.9 && z > -55 && z < -39.5
            if (z < -52.6 || ax - 17 > (z + 52.6) * 1.33 + 0.6 || ax - 19.5 > (-38 - z) * 0.875 + 0.6) return false
            return !(ax < 6.8 && z < -49.8 && y > -1.4)
        }
        if (z < -24) {
            if (ax < 7.4 && y > -5.7 && y < 5.9) return true
            const c = 18 - (z + 38.6) * 0.442
            return ax > c - 1.7 && ax < c + 1.7 && y > -2.2 && y < 2.8
        }
        if (z < 35.3) {
            const mid = z > CITADEL_Z0 && z < CITADEL_Z1
            const sponson = (z > -21.5 && z < -12.5) || (z > 19.5 && z < 28.5)
            if (y > 5) {
                if (mid) return y < 8.1 && ax < 11
                if (z < CITADEL_Z1 || z > 29) return y < 6.4 && ax < 4.4
                // The tower: two terraces, the shaft, then the bridge head and its dish wings.
                if (y < 9.4) return ax < 6.7
                if (y > 11.8 && y < 14.6 && ax < 8 && z > 20.3 && z < 23.7) return true
                return y < 12.4 ? ax < 3.4 && z > 14.8 && z < 25 : ax < 4.7 && z > 15.4 && z < 24
            }
            // Each tread carries a layer of deck clutter, each riser a row of gun barrels.
            if (y > 3.2) return ax < (mid ? 11.4 : y < 4.5 ? 9.4 : 6.2)
            if (y > 0.6) return ax < (mid ? (y < 3 ? 13.6 : 11.6) : y < 1.9 ? 12 : y < 2.8 ? 10.9 : 9.8) || (y < 2.2 && ax < 16.3 && sponson)
            if (y > -5.7) {
                if (ax < (y > -2.2 ? (y > -1.7 && y < 0.1 ? 13.8 : 12.3) : 14.3)) return z > -25
                return sponson ? ax < 16.6 : y < -0.8 && ax < 17.3 && z > -5.6 && z < 11.6
            }
            if (y > -7.7) return ax < 10.8
            if (y > -9.5) return ax < 5.3 && z > -26
            return ax < 1.5 && z > -18 - (y + 9.4) * 1.3 && z < 26 + (y + 9.4) * 1.4
        }
        return ax < 14.9 && y > -6.8 && y < 8.3 && z < 48.5
    }

    return {
        group: built.group,
        radius: built.radius,
        engines: built.engines,
        batteries,
        citadels,
        pylons: [],
        silos,
        hangars: [mount(T3.half + 2.6, -3.9, hangarZ, 1, 0, 0), mount(-T3.half - 2.6, -3.9, hangarZ, -1, 0, 0)],
        core,
        rotors: [],
        debris: [],
        inside,
        keepOut: [[0, 0, -45, 8], [14, 0, -45, 7], [-14, 0, -45, 7], [0, 0, -30, 6.5], [0, -1, -14, 10.5], [0, -1, 4, 12], [0, -1, 22, 11.5], [0, 0, 40, 11]]
    }
}
