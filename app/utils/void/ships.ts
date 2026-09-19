// Void Runner — player hulls.
//
// Every hull is lofted from cross-sections (a rounded polygon swept along the
// ship's length), dressed with chamfered plates, bare-metal machinery, glass
// canopies and lit detail: nav lights, window rows, panel seams, vents. Still
// procedural and flat-shaded, but each silhouette is designed to read at a
// glance and look expensive up close.


import * as THREE from 'three'
import { ModelBuilder, cyl, octa, ring, tube, type BuiltModel } from './models'
import { type Section, loft, slab, block, type Livery, RED, navLights, windows, mast, seam, canopy, nacelle, vent, barrel, band, mount, radiator, tank, dish, shade } from './ship-kit'
import { CAPITAL_DESIGNS } from './ships-capital'

// ─── Hull designs ──────────────────────────────────────────────────────────

export const LIVERIES: Record<string, Livery> = {
    sparrow: { paint: 0xdde3ea, paint2: 0x9aa6b4, trim: 0x2d333d, metal: 0x6e7886, accent: 0x2f8cff, glow: 0x6fd8ff, glass: 0x0b1a2a },
    wasp: { paint: 0xf2b92c, paint2: 0x2a2d33, trim: 0x16181c, metal: 0x707885, accent: 0x16181c, glow: 0xffd66b, glass: 0x1a1406 },
    mule: { paint: 0xd9692a, paint2: 0x7d858f, trim: 0x2d3139, metal: 0x8b939d, accent: 0xf2d13a, glow: 0xffae5c, glass: 0x0d1418 },
    kestrel: { paint: 0x7c8c6e, paint2: 0x4a5543, trim: 0x23272c, metal: 0x757d86, accent: 0x3dff9a, glow: 0x6dffb8, glass: 0x08140e },
    phantom: { paint: 0x1f2027, paint2: 0x34313f, trim: 0x0d0d12, metal: 0x4d4a5c, accent: 0x9b5cff, glow: 0xc49bff, glass: 0x140a24 },
    aegis: { paint: 0x3a4f78, paint2: 0x9aa5b4, trim: 0x1d2330, metal: 0x707b8a, accent: 0xd8e1ec, glow: 0x7fa2ff, glass: 0x0a1226 },
    hive: { paint: 0x2f3239, paint2: 0xe0b93a, trim: 0x17191d, metal: 0x747c87, accent: 0xe0b93a, glow: 0xfff08a, glass: 0x141206 },
    seraph: { paint: 0xf1ede8, paint2: 0xc9c2c9, trim: 0x3a3440, metal: 0x9a93a3, accent: 0xff5fc2, glow: 0xff9be6, glass: 0x230a1c },
    bastion: { paint: 0x4b4f57, paint2: 0x8e2d34, trim: 0x1e2025, metal: 0x767d88, accent: 0xb3343f, glow: 0xff8a7a, glass: 0x1c0a0b },
    leviathan: { paint: 0xe6eaef, paint2: 0x8d97a4, trim: 0x2a3039, metal: 0x6d7785, accent: 0x2fb7d8, glow: 0x9ff4ff, glass: 0x071a22 }
}

const DESIGNS: Record<string, (b: ModelBuilder, l: Livery) => void> = {
    sparrow(b, l) {
        const ROUND: [number, number, number] = [10, 0.72, 0]
        const hull: Section[] = [
            { z: -1.75, w: 0.02, h: 0.02, y: -0.02 },
            { z: -1.25, w: 0.15, h: 0.11 },
            { z: -0.55, w: 0.3, h: 0.22, y: 0.02 },
            { z: 0.35, w: 0.36, h: 0.25 },
            { z: 1.0, w: 0.32, h: 0.22 },
            { z: 1.25, w: 0.26, h: 0.18 }
        ]
        b.solid(loft(hull, ...ROUND), l.paint)
        band(b, hull, -1.5, -1.3, l.accent, ROUND, 0.008)
        band(b, hull, 0.42, 0.56, l.accent, ROUND, 0.008)
        band(b, hull, 0.6, 0.64, l.trim, ROUND, 0.008)
        band(b, hull, 1.05, 1.24, l.paint2, ROUND, 0.008)
        b.metal(tube(0.008, 0.012, 0.35, 5), l.metal, [0, -0.02, -1.9])
        // Flaps, a missile under each wing and a whip aerial.
        b.solid(slab([[0.5, 0.78], [1.4, 0.78], [1.5, 0.92], [0.4, 0.97]], 0.075, 0.01), l.paint2, [0, -0.04, 0], [0, 0, 0], [1, 1, 1], true)
        seam(b, l.glow, [0.95, 0.0, 0.76], 0.9, true, 'x', 0.9)
        b.metal(tube(0.035, 0.035, 0.5, 6), l.trim, [0.9, -0.12, 0.45], [0, 0, 0], [1, 1, 1], true)
        b.solid(new THREE.ConeGeometry(0.035, 0.12, 6).rotateX(-Math.PI / 2), RED, [0.9, -0.12, 0.14], [0, 0, 0], [1, 1, 1], true)
        b.metal(new THREE.BoxGeometry(0.03, 0.06, 0.2), l.metal, [0.9, -0.075, 0.5], [0, 0, 0], [1, 1, 1], true)
        b.metal(cyl(0.006, 0.01, 0.4, 4), l.trim, [0, 0.45, 0.55], [-0.35, 0, 0])
        b.glow(ring(0.27, 0.012, 3, 14), l.glow, 1.8, [0, 0, 1.42])
        b.solid(loft([
            { z: -1.0, w: 0.12, h: 0.06, y: -0.14 },
            { z: 0.9, w: 0.3, h: 0.1, y: -0.18 }
        ], 6, 0.6), l.paint2)
        canopy(b, l, -0.85, 0.2, 0.2, 0.17, 0.12)
        b.solid(slab([[0.3, -0.15], [1.45, 0.55], [1.52, 0.9], [0.32, 0.95]], 0.07), l.paint, [0, -0.04, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.85, 0.32], [1.46, 0.6], [1.5, 0.78], [0.86, 0.52]], 0.08), l.accent, [0, -0.035, 0], [0, 0, 0], [1, 1, 1], true)
        b.metal(new THREE.BoxGeometry(0.08, 0.08, 0.7), l.metal, [1.5, -0.04, 0.6], [0, 0, 0], [1, 1, 1], true)
        navLights(b, 1.55, -0.04, 0.95)
        b.solid(slab([[0, 0.45], [0.5, 1.15], [0.55, 1.3], [0, 1.2]], 0.05), l.paint2, [0, 0.15, 0], [0, 0, Math.PI / 2])
        b.glow(new THREE.BoxGeometry(0.02, 0.35, 0.03), l.accent, 1.8, [0.03, 0.55, 1.18])
        vent(b, [0.33, 0.0, -0.1], 0.06, 0.12, 0.4, true, 3)
        seam(b, l.glow, [0, 0.255, 0.55], 0.7, false, 'z', 0.7)
        barrel(b, l, [0.2, -0.08, -0.9], 0.6, 0.035, true)
        b.metal(tube(0.24, 0.28, 0.35, 10), l.trim, [0, 0, 1.3])
        b.engine([0, 0, 1.45], 0.21, false, l.glow)
        b.hardpoint([0, -0.29, 0.25], [0, -1, 0])
    },

    wasp(b, l) {
        const ROUND: [number, number, number] = [10, 0.7, 0]
        const hull: Section[] = [
            { z: -2.3, w: 0.02, h: 0.02 },
            { z: -1.5, w: 0.13, h: 0.11 },
            { z: -0.5, w: 0.25, h: 0.21, y: 0.02 },
            { z: 0.7, w: 0.3, h: 0.23 },
            { z: 1.25, w: 0.2, h: 0.16 }
        ]
        b.solid(loft(hull, ...ROUND), l.paint)
        // Wasp bands down the abdomen and a steel stinger on the nose.
        for (const z of [-0.1, 0.3, 0.7, 1.05]) band(b, hull, z, z + 0.18, l.paint2, ROUND, 0.008)
        band(b, hull, -2.1, -1.85, l.trim, ROUND, 0.006)
        b.metal(new THREE.ConeGeometry(0.03, 0.5, 6).rotateX(-Math.PI / 2), l.metal, [0, 0, -2.5])
        b.glow(octa(0.035), l.glow, 3, [0, 0, -2.76])
        b.glow(new THREE.BoxGeometry(1.1, 0.02, 0.02), l.glow, 1.1, [0.95, 0.095, 0.42], [0, 0.535, 0.06], [1, 1, 1], true)
        tank(b, l, l.paint2, [0, -0.3, 0.45], 0.1, 0.7)
        b.metal(new THREE.BoxGeometry(0.03, 0.1, 0.3), l.metal, [0, -0.22, 0.45])
        b.metal(cyl(0.006, 0.01, 0.35, 4), l.trim, [0.1, 0.4, 0.2], [-0.4, 0, 0], [1, 1, 1], true)
        b.solid(loft([
            { z: -2.0, w: 0.05, h: 0.03, y: -0.08 },
            { z: 1.1, w: 0.22, h: 0.08, y: -0.16 }
        ], 6, 0.6), l.paint2)
        canopy(b, l, -1.3, -0.3, 0.17, 0.14, 0.11)
        // Forward-swept wing with hazard tips.
        b.solid(slab([[0.25, 0.65], [1.6, -0.15], [1.78, 0.1], [0.3, 1.0]], 0.06), l.paint, [0, 0, 0], [0, 0, 0.06], [1, 1, 1], true)
        b.solid(slab([[1.28, 0.03], [1.6, -0.15], [1.78, 0.1], [1.43, 0.3]], 0.07), l.paint2, [0, 0.005, 0], [0, 0, 0.06], [1, 1, 1], true)
        b.solid(slab([[0.12, -1.15], [0.55, -0.98], [0.56, -0.86], [0.12, -0.78]], 0.04), l.paint2, [0, 0.02, 0], [0, 0, 0], [1, 1, 1], true)
        navLights(b, 1.76, 0.05, 0.02)
        nacelle(b, l, [0.62, -0.02, 0.75], 0.17, 1.5, true)
        b.solid(slab([[0, 0.25], [0.45, 0.9], [0.5, 1.1], [0, 1.05]], 0.04), l.paint2, [0.62, 0.15, 0], [0, 0, Math.PI / 2 - 0.2], [1, 1, 1], true)
        seam(b, l.glow, [0.62, 0.18, 0.4], 0.8, true, 'z', 0.9)
        barrel(b, l, [0.16, -0.05, -1.25], 0.7, 0.03, true)
        vent(b, [0.26, 0.02, 0.2], 0.05, 0.12, 0.5, true)
        b.hardpoint([0, -0.25, 0.2], [0, -1, 0])
        b.hardpoint([0, 0.25, 0.75], [0, 1, 0])
    },

    // A deep-space tug: a fat cab up front, an open keel behind it, and mismatched
    // freight boxes clamped to the keel over a pair of slung fuel tanks.
    mule(b, l) {
        const TEAL = 0x1f8f8a
        const CREAM = 0xe8dcc4
        const OCT: [number, number, number] = [8, 0.58, Math.PI / 8]
        const cab: Section[] = [
            { z: -3.0, w: 0.55, h: 0.42, y: 0.02 },
            { z: -2.6, w: 0.95, h: 0.72 },
            { z: -1.5, w: 1.08, h: 0.84 },
            { z: -1.1, w: 0.9, h: 0.7 }
        ]
        b.solid(loft(cab, ...OCT), l.paint)
        band(b, cab, -1.85, -1.55, CREAM, OCT)
        band(b, cab, -1.5, -1.38, l.trim, OCT, 0.04)
        b.glass(loft([
            { z: -2.85, w: 0.6, h: 0.13, y: 0.4 },
            { z: -2.5, w: 0.93, h: 0.22, y: 0.5 },
            { z: -2.1, w: 0.98, h: 0.2, y: 0.57 }
        ], 8, 0.7), l.glass)
        b.metal(new THREE.BoxGeometry(0.06, 0.28, 0.55), l.trim, [0, 0.62, -2.45])
        b.metal(new THREE.BoxGeometry(0.05, 0.26, 0.5), l.trim, [0.5, 0.58, -2.42], [0, -0.25, 0], [1, 1, 1], true)
        windows(b, [1.05, 0.3, -2.0], 3, 0.25, 0.14, 'z')
        windows(b, [-1.05, 0.3, -2.0], 3, 0.25, 0.14, 'z')
        // Bumper, work lights and the mining drills under the chin.
        for (let i = 0; i < 5; i++) b.solid(block(0.2, 0.06, 0.34, 0.01), i % 2 ? l.trim : l.accent, [-0.48 + i * 0.24, -0.52, -2.66], [0.75, 0, 0])
        b.glow(new THREE.BoxGeometry(0.24, 0.1, 0.04), 0xfff4d6, 3.2, [0.55, -0.18, -2.95], [0, 0, 0], [1, 1, 1], true)
        b.metal(block(0.24, 0.24, 1.2, 0.03), l.metal, [0.62, -0.58, -2.55], [0, 0, 0], [1, 1, 1], true)
        b.solid(block(0.3, 0.3, 0.3, 0.03), l.accent, [0.62, -0.58, -3.0], [0, 0, 0], [1, 1, 1], true)
        b.metal(new THREE.ConeGeometry(0.2, 0.8, 8).rotateX(-Math.PI / 2), l.trim, [0.62, -0.58, -3.5], [0, 0, 0], [1, 1, 1], true)
        b.glow(ring(0.17, 0.025, 3, 12), l.glow, 2.6, [0.62, -0.58, -3.25], [0, 0, 0], [1, 1, 1], true)
        b.glow(ring(0.1, 0.02, 3, 12), l.glow, 2.6, [0.62, -0.58, -3.55], [0, 0, 0], [1, 1, 1], true)
        // Keel and the frames the freight clamps to.
        b.metal(loft([{ z: -1.2, w: 0.36, h: 0.44 }, { z: 2.3, w: 0.36, h: 0.44 }], ...OCT), l.trim)
        for (const z of [-1.08, 0.05, 1.15, 2.22]) {
            b.metal(block(2.75, 0.1, 0.1, 0.02), l.metal, [0, 0.52, z])
            b.metal(block(2.75, 0.1, 0.1, 0.02), l.metal, [0, -0.52, z])
            b.metal(block(0.1, 1.1, 0.1, 0.02), l.metal, [1.36, 0, z], [0, 0, 0], [1, 1, 1], true)
        }
        seam(b, l.glow, [0, 0.45, 0.55], 3.2, false, 'z', 1.2)
        // Freight: no two boxes alike.
        const freight = [[l.paint, TEAL, CREAM], [CREAM, l.paint2, l.paint]]
        freight.forEach((row, side) => row.forEach((paint, i) => {
            const x = side ? 0.86 : -0.86
            const out = side ? 1 : -1
            const z = -0.52 + i * 1.1
            b.solid(block(0.92, 0.9, 0.98, 0.06), paint, [x, 0, z])
            for (let k = 0; k < 5; k++) b.solid(new THREE.BoxGeometry(0.04, 0.74, 0.07), shade(paint, 0.72), [x + out * 0.46, 0, z - 0.36 + k * 0.18])
            for (let k = 0; k < 4; k++) b.solid(new THREE.BoxGeometry(0.7, 0.04, 0.07), shade(paint, 0.72), [x, 0.45, z - 0.3 + k * 0.2])
            b.solid(new THREE.BoxGeometry(0.05, 0.16, 0.5), i === 1 ? l.accent : l.trim, [x + out * 0.47, 0.22, z])
            b.glow(new THREE.BoxGeometry(0.05, 0.08, 0.08), i === 2 ? RED : l.glow, 2.4, [x + out * 0.48, -0.3, z + 0.38])
        }))
        tank(b, l, CREAM, [0.86, -0.8, 0.55], 0.3, 2.5, true)
        b.solid(new THREE.BoxGeometry(0.04, 0.2, 0.9), l.paint, [1.17, -0.8, 0.55], [0, 0, 0], [1, 1, 1], true)
        // Crane over the freight.
        b.metal(cyl(0.22, 0.28, 0.2, 10), l.trim, [0, 0.92, -1.5])
        b.solid(block(0.3, 0.3, 0.4, 0.03), l.accent, [0, 1.12, -1.5])
        b.solid(block(0.15, 0.15, 2.3, 0.02), l.accent, [0, 1.38, -0.45], [0.22, 0, 0])
        for (let k = 0; k < 4; k++) b.solid(new THREE.BoxGeometry(0.17, 0.17, 0.12), l.trim, [0, 1.22 + k * 0.105, -1.15 + k * 0.47], [0.22, 0, 0])
        b.metal(new THREE.BoxGeometry(0.03, 0.62, 0.03), l.metal, [0, 1.3, 0.62])
        b.metal(block(0.26, 0.08, 0.26, 0.02), l.trim, [0, 0.98, 0.62])
        b.metal(slab([[0, 0], [0.16, 0.05], [0.12, 0.3], [0, 0.22]], 0.05, 0.01), l.accent, [0.1, 0.98, 0.62], [0, 0, -Math.PI / 2], [1, 1, 1], true)
        mast(b, [-0.55, 0.8, -1.35], 0.8)
        dish(b, l, [0.55, 0.8, -1.4], 0.26)
        // Drive block: stacks, radiator wings and a triple burner.
        const drive: Section[] = [
            { z: 2.25, w: 0.9, h: 0.66, y: 0.02 },
            { z: 2.55, w: 1.12, h: 0.8, y: 0.02 },
            { z: 3.1, w: 1.05, h: 0.74, y: 0.02 },
            { z: 3.28, w: 0.88, h: 0.62, y: 0.02 }
        ]
        b.solid(loft(drive, ...OCT), l.paint2)
        band(b, drive, 2.6, 2.78, l.accent, OCT)
        band(b, drive, 2.86, 2.95, l.trim, OCT)
        for (const x of [0.3, 0.62]) {
            b.metal(cyl(0.1, 0.12, 0.6, 8), l.trim, [x, 0.98, 2.8], [0.2, 0, 0], [1, 1, 1], true)
            b.glow(cyl(0.07, 0.07, 0.02, 8), l.glow, 2.6, [x, 1.28, 2.86], [0.2, 0, 0], [1, 1, 1], true)
        }
        radiator(b, l, [1.05, 0.35, 2.8], 1.25, 0.85, 0.55, 0xff7a2e)
        vent(b, [1.13, -0.05, 2.8], 0.06, 0.34, 0.5, true, 4)
        nacelle(b, l, [1.08, -0.5, 2.75], 0.25, 1.0, true)
        b.engine([0.45, 0.22, 3.32], 0.31, true, l.glow)
        b.engine([0, -0.3, 3.32], 0.31, false, l.glow)
        navLights(b, 1.4, 0.55, 2.2)
        mount(b, l, [0, 0.84, -2.0], true, false, 0.26)
        mount(b, l, [0, -0.48, 0.6], false, false, 0.26)
        mount(b, l, [0.86, 0.5, 0.58], true, true, 0.26)
    },

    kestrel(b, l) {
        const ROUND: [number, number, number] = [10, 0.62, 0]
        const hull: Section[] = [
            { z: -2.5, w: 0.05, h: 0.04, y: -0.02 },
            { z: -1.7, w: 0.42, h: 0.2 },
            { z: -0.4, w: 0.78, h: 0.32, y: 0.02 },
            { z: 1.0, w: 0.88, h: 0.34 },
            { z: 1.85, w: 0.7, h: 0.28 }
        ]
        b.solid(loft(hull, ...ROUND), l.paint)
        band(b, hull, -2.3, -1.95, l.trim, ROUND, 0.008)
        band(b, hull, -0.3, 0.0, l.paint2, ROUND, 0.01)
        band(b, hull, 0.04, 0.09, l.accent, ROUND, 0.01, 1.3)
        band(b, hull, 1.3, 1.8, l.paint2, ROUND, 0.01)
        // Chin cannon, armoured cheeks, and ordnance under the wings.
        b.metal(block(0.22, 0.14, 0.7, 0.02), l.trim, [0, -0.28, -1.35])
        for (const x of [-0.05, 0.05]) b.metal(tube(0.025, 0.03, 0.75, 6), l.metal, [x, -0.3, -1.95])
        b.glow(new THREE.BoxGeometry(0.14, 0.02, 0.02), l.glow, 2.4, [0, -0.3, -2.33])
        b.solid(slab([[0.3, -1.6], [0.62, -0.9], [0.7, -0.3], [0.45, -0.35]], 0.1, 0.02), l.paint2, [0, 0.16, 0], [0, 0, -0.35], [1, 1, 1], true)
        for (const x of [1.1, 1.5, 1.9]) {
            b.metal(tube(0.05, 0.05, 0.7, 6), l.trim, [x, -0.14, 0.45 + (x - 1.1) * 0.35], [0, 0, 0], [1, 1, 1], true)
            b.solid(new THREE.ConeGeometry(0.05, 0.16, 6).rotateX(-Math.PI / 2), x === 1.5 ? l.accent : RED, [x, -0.14, 0.02 + (x - 1.1) * 0.35], [0, 0, 0], [1, 1, 1], true)
        }
        b.solid(slab([[0.85, 0.95], [2.25, 0.85], [2.28, 1.08], [0.8, 1.28]], 0.125, 0.02), l.paint2, [0, 0, 0], [0, 0, 0.04], [1, 1, 1], true)
        b.metal(cyl(0.008, 0.012, 0.5, 4), l.trim, [0, 0.55, 1.2], [-0.35, 0, 0])
        b.solid(loft([
            { z: -1.9, w: 0.2, h: 0.06, y: -0.18 },
            { z: 1.7, w: 0.6, h: 0.1, y: -0.28 }
        ], 6, 0.6), l.paint2)
        canopy(b, l, -1.65, -0.5, 0.25, 0.26, 0.15)
        // Swept wings with weapon pods
        b.solid(slab([[0.7, -0.55], [2.3, 0.25], [2.3, 1.1], [0.78, 1.3]], 0.12, 0.04), l.paint, [0, 0, 0], [0, 0, 0.04], [1, 1, 1], true)
        b.solid(slab([[1.6, -0.05], [2.3, 0.25], [2.3, 0.45], [1.6, 0.25]], 0.13, 0.03), l.paint2, [0, 0.002, 0], [0, 0, 0.04], [1, 1, 1], true)
        b.solid(loft([
            { z: -0.8, w: 0.1, h: 0.1, x: 2.35 },
            { z: -0.4, w: 0.2, h: 0.2, x: 2.35 },
            { z: 1.4, w: 0.2, h: 0.2, x: 2.35 },
            { z: 1.7, w: 0.12, h: 0.12, x: 2.35 }
        ], 8, 0.9), l.paint2, [0, 0.06, 0], [0, 0, 0], [1, 1, 1], true)
        barrel(b, l, [2.35, 0.06, -1.25], 0.9, 0.06, true)
        navLights(b, 2.35, 0.3, 1.3)
        // Twin tails
        b.solid(slab([[0, 0.2], [0.55, 0.8], [0.6, 1.05], [0, 1.0]], 0.07), l.paint, [0.55, 0.25, 0.75], [0, 0, Math.PI / 2 - 0.3], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.03, 0.3, 0.03), l.accent, 2, [0.72, 0.62, 1.72], [0, 0, -0.3], [1, 1, 1], true)
        vent(b, [0.72, 0.1, 0.2], 0.06, 0.18, 0.6, true, 4)
        seam(b, l.accent, [1.45, 0.075, 0.55], 1.2, true, 'z', 1.2)
        vent(b, [0, 0.33, 0.9], 0.5, 0.05, 0.7, false, 4)
        nacelle(b, l, [0.45, -0.02, 1.75], 0.3, 1.1, true)
        b.hardpoint([1.45, 0.08, 0.5], [0, 1, 0], true)
        b.hardpoint([1.45, -0.08, 0.5], [0, -1, 0], true)
        b.hardpoint([0, 0.35, 0.3], [0, 1, 0])
    },

    phantom(b, l) {
        b.solid(loft([
            { z: -2.5, w: 0.02, h: 0.02 },
            { z: -1.1, w: 0.42, h: 0.18 },
            { z: 0.4, w: 0.85, h: 0.26 },
            { z: 1.5, w: 0.5, h: 0.14 }
        ], 4, 1, 0), l.paint)
        canopy(b, l, -1.35, -0.2, 0.08, 0.16, 0.1)
        b.solid(slab([[0.3, -1.1], [2.3, 0.85], [2.05, 1.3], [0.4, 1.0]], 0.06, 0.02), l.paint, [0, -0.02, 0], [0, 0, 0], [1, 1, 1], true)
        // Sawtooth panels, faint seams across the skin, a bay under the belly and a probe on the nose.
        for (let i = 0; i < 3; i++) b.solid(slab([[0, 0], [0.3, -0.22], [0.42, 0.08], [0.1, 0.2]], 0.075, 0.01), l.paint2, [0.6 + i * 0.42, -0.02, 0.62 + i * 0.07], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.015, 0.015, 1.0), l.accent, 0.9, [0.75, 0.02, 0.25], [0, 0.35, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.015, 0.015, 0.7), l.accent, 0.9, [1.3, 0.02, 0.6], [0, 0.35, 0], [1, 1, 1], true)
        b.metal(block(0.5, 0.04, 0.9, 0.01), l.trim, [0, -0.25, 0.3])
        seam(b, l.glow, [0, -0.275, 0.3], 0.8, false, 'z', 0.8)
        b.metal(tube(0.008, 0.012, 0.4, 5), l.metal, [0, 0, -2.68])
        b.solid(slab([[0.05, -2.2], [0.3, -1.15], [0.12, -1.2]], 0.05, 0.01), l.paint2, [0, 0.06, 0], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.62, 0.025, 0.02), l.glow, 1.6, [0, 0.0, 1.64])
        b.solid(slab([[1.6, 0.2], [2.3, 0.85], [2.05, 1.3], [1.5, 0.75]], 0.07, 0.02), l.paint2, [0, -0.015, 0], [0, 0, 0], [1, 1, 1], true)
        // Leading-edge light strips.
        b.glow(new THREE.BoxGeometry(0.03, 0.03, 2.7), l.glow, 2.6, [1.3, 0.01, -0.13], [0, 0.797, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.4, 0.02, 0.02), l.accent, 2.5, [0, 0.27, 0.6])
        // V-tail
        b.solid(slab([[0, 0.3], [0.55, 1.0], [0.45, 1.35], [0, 1.2]], 0.05, 0.015), l.paint2, [0.35, 0.15, 0.2], [0, 0, Math.PI / 2 - 0.65], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.02, 0.36, 0.02), l.glow, 2, [0.49, 0.34, 1.47], [0, 0, -0.65], [1, 1, 1], true)
        vent(b, [0.45, 0.12, 0.6], 0.3, 0.04, 0.4, true, 2)
        b.metal(block(0.7, 0.12, 0.35, 0.02), l.trim, [0, 0, 1.45])
        b.engine([0.26, 0, 1.55], 0.17, true, l.glow)
        b.hardpoint([0, 0.27, 0.45], [0, 1, 0])
        b.hardpoint([0.95, -0.05, 0.65], [0, -1, 0], true)
    },

    // A shield-bearer: a navy core hull carried between overlapping pauldron
    // plates, with a projector ring held out ahead of the nose.,
    ...CAPITAL_DESIGNS
}

export function buildShip(shipId: string): BuiltModel {
    const b = new ModelBuilder()
    const livery = LIVERIES[shipId] ?? LIVERIES.sparrow!
    ;(DESIGNS[shipId] ?? DESIGNS.sparrow!)(b, livery)
    return b.build()
}

export function shipGlow(shipId: string) {
    return (LIVERIES[shipId] ?? LIVERIES.sparrow!).glow
}
