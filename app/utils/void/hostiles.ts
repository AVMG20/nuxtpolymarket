// Void Runner — hostile ship models.

import * as THREE from 'three'
import { ModelBuilder, cyl, ico, octa, ring, tube, type BuiltModel } from './models'
import { loft, slab, block, barrel } from './ship-kit'

// ─── Hostiles ──────────────────────────────────────────────────────────────
//
// Enemy hulls share one language: gunmetal armour, dried-blood red paint,
// thin glowing slits in the kind's colour, and sharp forward-leaning shapes.

const H_ARMOR = 0x5d5a60
const H_DARK = 0x242126
const H_PAINT = 0x8e1f2b
const H_METAL = 0x6b6670

const HOSTILE_DESIGNS: Record<string, (b: ModelBuilder, glow: number) => void> = {
    mite(b, glow) {
        b.solid(loft([
            { z: -0.8, w: 0.05, h: 0.05 },
            { z: -0.2, w: 0.42, h: 0.3 },
            { z: 0.45, w: 0.3, h: 0.22 },
            { z: 0.7, w: 0.08, h: 0.06 }
        ], 4, 1, Math.PI / 4), H_PAINT)
        for (const [x, y] of [[0.25, 0.15], [-0.25, 0.15], [0.25, -0.15], [-0.25, -0.15]] as const) {
            b.metal(new THREE.ConeGeometry(0.06, 0.8, 4).rotateX(-Math.PI / 2 + 0.2), H_DARK, [x, y, -0.6], [y * 0.8, -x * 0.8, 0])
        }
        b.glow(octa(0.16), glow, 4, [0, 0.05, -0.25])
        b.glow(new THREE.BoxGeometry(0.5, 0.02, 0.02), glow, 2.5, [0, 0.2, 0.1])
        b.engine([0, 0, 0.72], 0.1, false, glow)
    },
    raider(b, glow) {
        b.solid(loft([
            { z: -1.4, w: 0.03, h: 0.03, y: -0.05 },
            { z: -0.8, w: 0.22, h: 0.14 },
            { z: 0.2, w: 0.36, h: 0.22 },
            { z: 1.0, w: 0.3, h: 0.18 }
        ], 6, 0.8), H_ARMOR)
        b.solid(slab([[0.2, -0.5], [1.5, 0.1], [1.45, 0.45], [0.25, 0.75]], 0.07, 0.02), H_DARK, [0, 0, 0], [0, 0, -0.18], [1, 1, 1], true)
        b.solid(slab([[0.9, -0.2], [1.5, 0.1], [1.45, 0.3], [0.95, 0.12]], 0.08, 0.02), H_PAINT, [0, 0.005, 0], [0, 0, -0.18], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.28, 0.03, 0.12), glow, 3, [0, 0.19, -0.45])
        barrel(b, { paint: H_ARMOR, paint2: H_DARK, trim: H_DARK, metal: H_METAL, accent: H_PAINT, glow, glass: 0 }, [0.3, -0.16, -0.7], 0.8, 0.04, true)
        b.solid(slab([[0, 0.3], [0.35, 0.8], [0.3, 1.05], [0, 1.0]], 0.05, 0.015), H_PAINT, [0.22, 0.12, 0], [0, 0, Math.PI / 2 - 0.5], [1, 1, 1], true)
        b.engine([0.2, 0, 1.05], 0.14, true, glow)
    },
    lancer(b, glow) {
        b.solid(loft([
            { z: -2.1, w: 0.04, h: 0.04 },
            { z: -1.2, w: 0.2, h: 0.18 },
            { z: 0.6, w: 0.32, h: 0.28 },
            { z: 1.6, w: 0.22, h: 0.2 }
        ], 6, 0.8), H_ARMOR)
        b.metal(tube(0.1, 0.13, 3.0, 8), H_DARK, [0, -0.32, -1.1])
        for (let i = 0; i < 5; i++) b.glow(ring(0.15, 0.025, 3, 10), glow, 2.6, [0, -0.32, -2.3 + i * 0.35])
        b.glow(octa(0.12), glow, 4.5, [0, -0.32, -2.65])
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            b.solid(slab([[0, 0.8], [0.6, 1.4], [0.55, 1.65], [0, 1.6]], 0.04, 0.012), i % 2 ? H_PAINT : H_DARK, [0, 0, 0], [0, 0, a])
        }
        b.glow(new THREE.BoxGeometry(0.03, 0.03, 1.4), glow, 2, [0, 0.29, 0])
        b.engine([0, 0, 1.65], 0.17, false, glow)
    },
    bulwark(b, glow) {
        b.solid(loft([
            { z: -1.4, w: 1.1, h: 0.8 },
            { z: -0.6, w: 1.4, h: 1.0 },
            { z: 1.4, w: 1.3, h: 0.9 },
            { z: 1.9, w: 0.9, h: 0.6 }
        ], 8, 0.5, Math.PI / 8), H_ARMOR)
        // Layered front shield plates.
        b.solid(slab([[-1.5, -0.2], [1.5, -0.2], [1.3, 0.2], [-1.3, 0.2]], 1.9, 0.08), H_DARK, [0, 0, -1.65], [Math.PI / 2, 0, 0])
        b.solid(slab([[-1.1, -0.15], [1.1, -0.15], [0.95, 0.15], [-0.95, 0.15]], 1.4, 0.06), H_PAINT, [0, 0, -1.9], [Math.PI / 2, 0, 0])
        for (let i = 0; i < 3; i++) b.glow(new THREE.BoxGeometry(1.6 - i * 0.4, 0.04, 0.04), glow, 2.4, [0, -0.35 + i * 0.35, -2.07])
        for (const side of [1]) {
            b.metal(block(0.5, 0.5, 1.2, 0.05), H_DARK, [1.55 * side, 0.3, 0], [0, 0, 0], [1, 1, 1], true)
            barrel(b, { paint: H_ARMOR, paint2: H_DARK, trim: H_DARK, metal: H_METAL, accent: H_PAINT, glow, glass: 0 }, [1.55 * side, 0.3, -0.9], 0.8, 0.09, true)
        }
        b.engine([0.5, 0, 1.95], 0.3, true, glow)
    },
    minelayer(b, glow) {
        b.solid(loft([
            { z: -1.3, w: 0.3, h: 0.25 },
            { z: -0.8, w: 0.9, h: 0.7 },
            { z: 0.6, w: 1.0, h: 0.75 },
            { z: 1.3, w: 0.7, h: 0.5 }
        ], 10, 0.9), H_ARMOR)
        b.solid(loft([
            { z: -0.6, w: 0.5, h: 0.2, y: 0.7 },
            { z: 0.9, w: 0.4, h: 0.15, y: 0.65 }
        ], 6, 0.7), H_PAINT)
        b.metal(block(0.9, 0.6, 0.3, 0.04), H_DARK, [0, -0.1, 1.35])
        b.glow(new THREE.BoxGeometry(0.7, 0.35, 0.03), glow, 2.4, [0, -0.1, 1.52])
        b.solid(slab([[0.8, -0.4], [1.8, 0.2], [1.7, 0.6], [0.8, 0.5]], 0.08, 0.02), H_DARK, [0, -0.1, 0], [0, 0, 0], [1, 1, 1], true)
        b.glow(octa(0.18), glow, 3.5, [0, 0.4, -1.0])
        for (let i = 0; i < 3; i++) b.glow(new THREE.BoxGeometry(0.03, 0.12, 0.25), glow, 2, [1.0, 0.1, -0.5 + i * 0.4], [0, 0, 0], [1, 1, 1], true)
    },
    leech(b, glow) {
        const segs = 5
        for (let i = 0; i < segs; i++) {
            const r = 0.55 - i * 0.08
            b.solid(loft([
                { z: -0.2 + i * 0.5, w: r * 0.7, h: r * 0.7 },
                { z: 0.0 + i * 0.5, w: r, h: r },
                { z: 0.25 + i * 0.5, w: r * 0.75, h: r * 0.75 }
            ], 8, 1), i % 2 ? H_DARK : H_ARMOR)
            if (i < segs - 1) b.glow(ring(r * 0.8, 0.02, 3, 12), glow, 1.8, [0, 0, 0.27 + i * 0.5])
        }
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2
            b.metal(new THREE.ConeGeometry(0.08, 0.9, 5).rotateX(-Math.PI / 2), H_PAINT, [Math.cos(a) * 0.3, Math.sin(a) * 0.3, -0.6], [Math.sin(a) * 0.35, -Math.cos(a) * 0.35, 0])
        }
        b.glow(octa(0.2), glow, 4, [0, 0, -0.3])
    },
    blinker(b, glow) {
        b.solid(octa(0.7), H_ARMOR, [0, 0, 0], [0, 0, 0], [0.8, 1.2, 1.3])
        b.solid(octa(0.5), H_PAINT, [0, 0, -0.25], [0, 0, 0], [0.62, 0.95, 1.05])
        b.glow(octa(0.25), glow, 4.5, [0, 0, -0.62])
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2
            b.solid(slab([[0, 0], [0.12, 0.2], [0.05, 1.1], [0, 1.2]], 0.05, 0.012), H_DARK, [Math.cos(a) * 0.9, Math.sin(a) * 0.9, -0.3], [Math.PI / 2, 0, a])
        }
        b.glow(ring(1.15, 0.035, 4, 32), glow, 2.2, [0, 0, 0])
        b.glow(ring(0.95, 0.03, 4, 32), glow, 1.6, [0, 0, 0], [Math.PI / 2, 0, 0])
    },
    carrier(b, glow) {
        b.solid(loft([
            { z: -5.4, w: 1.4, h: 0.9 },
            { z: -4.4, w: 2.4, h: 1.4 },
            { z: 3.2, w: 2.6, h: 1.5 },
            { z: 4.6, w: 1.8, h: 1.1 }
        ], 8, 0.5, Math.PI / 8), H_ARMOR)
        b.metal(block(2.2, 1.2, 0.3, 0.05), 0x0c0b0d, [0, -0.1, -5.35])
        b.glow(new THREE.BoxGeometry(2.0, 0.08, 0.03), glow, 2.6, [0, 0.45, -5.52])
        b.glow(new THREE.BoxGeometry(2.0, 0.08, 0.03), glow, 2.6, [0, -0.65, -5.52])
        for (let i = 0; i < 3; i++) {
            b.metal(block(0.2, 1.0, 1.3, 0.04), H_DARK, [2.62, -0.1, -2.5 + i * 2.0], [0, 0, 0], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.03, 0.6, 0.9), glow, 1.8, [2.73, -0.1, -2.5 + i * 2.0], [0, 0, 0], [1, 1, 1], true)
        }
        b.solid(slab([[-0.6, -2.5], [0.6, -2.5], [0.4, 2.8], [-0.4, 2.8]], 0.9, 0.08), H_PAINT, [0, 1.8, 0])
        b.metal(new THREE.ConeGeometry(0.25, 3, 6), H_DARK, [0, 3.6, 1.8])
        b.glow(octa(0.2), glow, 4, [0, 5.1, 1.8])
        b.engine([1.2, 0, 4.7], 0.65, true, glow)
        b.engine([0, 0.3, 4.7], 0.55, false, glow)
    },
    /**
     * The mothership: a ninety-metre wedge carrier built from stacked decks in
     * different greys, with red command stripes, lit windows along the edges,
     * a stepped command tower and open launch bays in both flanks and the belly.
     */
    mothership(b, glow) {
        const wedge = (nose: number, stern: number, half: number) => [[0, nose], [half, stern], [-half, stern]] as [number, number][]
        // Stacked hull decks, darkest at the bottom.
        b.solid(slab(wedge(-48, 36, 24), 6, 0.35), 0x3c3a42, [0, -3, 0])
        b.solid(slab(wedge(-45, 35, 21.5), 4, 0.3), 0x6d6a74, [0, 1.8, 0])
        b.solid(slab(wedge(-31, 33, 15), 3.2, 0.25), 0x8e8a96, [0, 5.3, 0])
        b.solid(slab(wedge(-18, 30, 7.5), 2.4, 0.2), 0x55525c, [0, 8, 0])
        // Keel under the belly.
        b.solid(slab(wedge(-30, 34, 12), 3, 0.25), 0x2c2a30, [0, -7.2, 0])

        // Red command stripes along the mid deck.
        for (const side of [1, -1]) {
            const pts: [number, number][] = [[side * 1.2, -40], [side * 19.8, 30], [side * 18.4, 30], [side * 0.4, -38]]
            b.solid(slab(side > 0 ? pts : pts.reverse(), 0.25, 0.02), H_PAINT, [0, 3.9, 0])
        }

        // Panel seams across the upper decks.
        for (let i = 0; i < 10; i++) {
            const z = -26 + i * 6
            const half = 15 * (z + 31) / 64
            if (half < 2) continue
            b.metal(block(half * 2 - 1, 0.12, 0.3, 0.02), 0x2a282e, [0, 6.95, z])
        }

        // Greebles on the mid and upper decks, in a spread of shades.
        const shades = [0x4a4850, 0x7a7680, 0x9e9aa6, 0x34323a]
        let seed = 7
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
        for (let i = 0; i < 46; i++) {
            const z = -34 + rnd() * 64
            const upper = rnd() < 0.45
            const half = upper ? 15 * (z + 31) / 64 : 21.5 * (z + 45) / 80
            if (half < 3) continue
            const x = (upper ? 1.5 : Math.max(2, half * 0.72)) + rnd() * (half * (upper ? 0.7 : 0.25))
            const w = 1 + rnd() * 3
            const h = 0.4 + rnd() * 1.2
            const d = 1 + rnd() * 4
            b.metal(block(w, h, d, 0.08), shades[i % shades.length]!, [x, (upper ? 6.9 : 3.8) + h / 2, z], [0, 0, 0], [1, 1, 1], true)
        }

        // Windows along the lower hull edge.
        const edge = Math.atan2(24, 84)
        for (let i = 0; i < 16; i++) {
            const z = -36 + i * 4.6
            const half = 24 * (z + 48) / 84
            for (const row of [0, 1]) {
                b.glow(new THREE.BoxGeometry(0.12, 0.28, 1.6), (i + row) % 5 === 0 ? 0xffd9a0 : 0x9fc4ff, 1.8, [half + 0.3, -4.2 + row * 1.6, z], [0, edge, 0], [1, 1, 1], true)
            }
            const mid = 21.5 * (z + 45) / 80
            if (i % 2 === 0 && z < 30) b.glow(new THREE.BoxGeometry(0.12, 0.24, 2.2), 0x9fc4ff, 1.6, [mid + 0.28, 1.6, z + 1], [0, Math.atan2(21.5, 80), 0], [1, 1, 1], true)
        }
        // A pale trim line where the lower hull meets the mid deck.
        for (const side of [1, -1]) {
            const pts: [number, number][] = [[side * 0.6, -47], [side * 24.3, 36], [side * 23.1, 36], [side * 0.2, -45]]
            b.solid(slab(side > 0 ? pts : pts.reverse(), 0.3, 0.02), 0xb8b4c0, [0, 0.1, 0])
        }

        // Launch bays: dark recesses in both flanks with lit interiors and frames.
        for (const z of [4, 18]) {
            const half = 21.5 * (z + 45) / 80
            b.metal(block(1.2, 3, 9, 0.1), 0x0b0a0d, [half - 0.3, 1.8, z], [0, edge, 0], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.1, 2.2, 8), glow, 0.9, [half - 0.5, 1.8, z], [0, edge, 0], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.15, 0.15, 9.4), 0xffe6b0, 2.6, [half + 0.2, 3.45, z], [0, edge, 0], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.15, 0.15, 9.4), 0xffe6b0, 2.6, [half + 0.2, 0.15, z], [0, edge, 0], [1, 1, 1], true)
        }
        // Belly hangar mouth with guide lights.
        b.metal(block(12, 1, 18, 0.1), 0x0b0a0d, [0, -8.8, 18])
        b.glow(new THREE.BoxGeometry(10.5, 0.2, 16), glow, 1.1, [0, -9.2, 18])
        for (let i = 0; i < 6; i++) b.glow(new THREE.BoxGeometry(11.5, 0.12, 0.3), 0xffe6b0, 2.4, [0, -9.4, 10.5 + i * 3])

        // Command tower: stepped blocks, a lit bridge and sensor globes.
        b.solid(block(18, 4, 12, 0.3), 0x6d6a74, [0, 11.2, 25])
        b.solid(block(12, 4, 8, 0.25), 0x8e8a96, [0, 15, 27])
        b.metal(block(4, 3, 5, 0.2), 0x3c3a42, [0, 17.5, 29])
        b.solid(block(24, 2.2, 4.5, 0.2), 0x55525c, [0, 19.6, 28.5])
        b.glow(new THREE.BoxGeometry(22, 0.35, 0.1), 0xffd9a0, 3, [0, 19.7, 26.2])
        b.solid(block(8, 0.5, 3, 0.1), H_PAINT, [0, 13.4, 19.2])
        for (const x of [-9.5, 9.5]) b.metal(ico(2, 1), 0x9e9aa6, [x, 22.2, 29])
        b.metal(tube(0.15, 0.15, 7, 5), H_METAL, [2, 23, 30], [Math.PI / 2, 0, 0])
        b.glow(octa(0.35), 0xff3040, 5, [2, 26.6, 30])

        // Stern: engine housing with three big drives and four small.
        b.solid(block(40, 11, 5, 0.3), 0x3c3a42, [0, -0.5, 38.5])
        b.metal(block(42, 1.2, 5.6, 0.1), 0x6d6a74, [0, 5.4, 38.5])
        b.engine([0, 0, 41.2], 4.4, false, glow)
        b.engine([13, 0, 41.2], 3.6, true, glow)
        b.engine([6.5, -4, 41.2], 1.9, true, glow)
        b.engine([19, -3, 41.2], 1.7, true, glow)

        // Nose beacon.
        b.glow(octa(0.9), glow, 5, [0, 1, -47])

        // Battery hardpoints (spawned as separate targets).
        b.hardpoint([11, 4.2, -6], [0.2, 1, 0], true)
        b.hardpoint([16, 4.2, 22], [0.2, 1, 0], true)
        b.hardpoint([6.5, 7, -8], [0, 1, 0], true)
    },
    /** Gunship: a long flat hull with a gun sponson on each flank and a raked dorsal fin. */
    ravager(b, glow) {
        const l = { paint: H_ARMOR, paint2: H_DARK, trim: H_DARK, metal: H_METAL, accent: H_PAINT, glow, glass: 0 }
        b.solid(loft([
            { z: -5.6, w: 0.12, h: 0.1, y: -0.1 },
            { z: -4.2, w: 0.7, h: 0.4 },
            { z: -1.5, w: 1.25, h: 0.7 },
            { z: 2.6, w: 1.35, h: 0.8 },
            { z: 4.6, w: 0.95, h: 0.6 }
        ], 8, 0.55, Math.PI / 8), H_ARMOR)
        // Armoured spine and a red command stripe down the nose.
        b.solid(loft([
            { z: -3.4, w: 0.35, h: 0.18, y: 0.5 },
            { z: 0.5, w: 0.6, h: 0.3, y: 0.85 },
            { z: 3.8, w: 0.5, h: 0.25, y: 0.8 }
        ], 6, 0.6), H_DARK)
        b.solid(slab([[-0.3, -5.2], [0.3, -5.2], [0.62, -1.6], [-0.62, -1.6]], 0.06, 0.02), H_PAINT, [0, 0.62, 0])
        b.glow(new THREE.BoxGeometry(0.7, 0.05, 0.22), glow, 3, [0, 0.98, -0.9])
        // Flank sponsons, each with a twin battery.
        b.solid(loft([
            { z: -2.6, w: 0.3, h: 0.3, x: 2.0 },
            { z: -1.4, w: 0.55, h: 0.5, x: 2.1 },
            { z: 1.8, w: 0.6, h: 0.55, x: 2.1 },
            { z: 2.9, w: 0.35, h: 0.35, x: 1.9 }
        ], 6, 0.6), H_DARK, [0, -0.1, 0], [0, 0, 0], [1, 1, 1], true)
        b.metal(block(1.0, 0.3, 1.6, 0.05), H_METAL, [1.45, -0.1, 0.3], [0, 0, 0], [1, 1, 1], true)
        for (const y of [0.18, -0.38]) barrel(b, l, [2.1, y, -3.0], 2.2, 0.11, true)
        b.solid(slab([[1.5, -2.2], [2.75, -1.2], [2.75, 1.6], [1.5, 2.4]], 0.08, 0.03), H_PAINT, [0, 0.47, 0], [0, 0, 0], [1, 1, 1], true)
        for (let i = 0; i < 4; i++) b.glow(new THREE.BoxGeometry(0.04, 0.1, 0.5), glow, 2.2, [2.68, -0.1, -1.0 + i * 0.8], [0, 0, 0], [1, 1, 1], true)
        // Swept tail planes and a raked fin.
        b.solid(slab([[1.0, 2.2], [3.4, 4.4], [3.3, 5.0], [0.9, 4.4]], 0.1, 0.03), H_ARMOR, [0, 0.1, 0], [0, 0, -0.12], [1, 1, 1], true)
        b.solid(slab([[0, 1.2], [0, 4.4], [1.9, 5.0], [1.7, 4.2]], 0.1, 0.03), H_PAINT, [0, 0.7, 0], [0, 0, Math.PI / 2])
        b.glow(octa(0.14), 0xff3040, 5, [0, 2.75, 4.8])
        // Windows and belly lights.
        for (let i = 0; i < 6; i++) b.glow(new THREE.BoxGeometry(0.04, 0.09, 0.32), i % 3 === 0 ? 0xffd9a0 : 0x9fc4ff, 1.8, [1.27, 0.25, -1.4 + i * 0.7], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.5, 0.04, 2.6), glow, 1.2, [0, -0.78, 0.6])
        b.engine([0.62, 0, 4.7], 0.42, true, glow)
        b.engine([2.0, -0.1, 3.0], 0.26, true, glow)
    },
    /** Siege cruiser: a hammerhead prow around a plasma maw, slab armour and a deep keel. */
    mauler(b, glow) {
        b.solid(loft([
            { z: -4.6, w: 1.5, h: 0.9 },
            { z: -2.8, w: 1.3, h: 1.0 },
            { z: 0.5, w: 1.6, h: 1.2 },
            { z: 4.4, w: 1.75, h: 1.25 },
            { z: 6.4, w: 1.2, h: 0.85 }
        ], 8, 0.45, Math.PI / 8), H_ARMOR)
        // Hammerhead: two armoured jaws flanking the maw.
        b.solid(loft([
            { z: -7.2, w: 0.45, h: 0.55, x: 2.0 },
            { z: -5.6, w: 0.95, h: 0.95, x: 2.1 },
            { z: -3.6, w: 0.9, h: 0.9, x: 1.9 },
            { z: -2.4, w: 0.4, h: 0.5, x: 1.5 }
        ], 6, 0.5), H_DARK, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[1.3, -7.0], [2.9, -6.2], [3.0, -3.4], [1.4, -2.8]], 0.12, 0.04), H_PAINT, [0, 0.95, 0], [0, 0, 0], [1, 1, 1], true)
        b.metal(cyl(1.0, 1.0, 1.6, 12), 0x0c0b0d, [0, 0, -4.9], [Math.PI / 2, 0, 0])
        for (let i = 0; i < 4; i++) b.glow(ring(0.95 - i * 0.16, 0.05, 4, 24), glow, 2 + i * 0.6, [0, 0, -5.75 + i * 0.3])
        b.glow(ico(0.42, 1), glow, 4.5, [0, 0, -5.2])
        for (const side of [1, -1]) b.glow(new THREE.BoxGeometry(0.06, 0.12, 2.6), glow, 2.2, [side * 1.18, 0, -5.4])
        // Slab armour along the flanks, stepped like roof tiles.
        for (let i = 0; i < 4; i++) {
            const z = -1.6 + i * 1.9
            b.solid(slab([[0, -0.9], [0.5, -0.7], [0.5, 0.9], [0, 0.9]], 1.7, 0.06), i % 2 ? H_DARK : H_METAL, [1.62 + i * 0.05, -0.85, z], [0, 0, 0.14], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.04, 0.5, 0.08), glow, 1.8, [2.2 + i * 0.05, 0, z + 0.95], [0, 0, 0], [1, 1, 1], true)
        }
        // Citadel, bridge and mast.
        b.solid(block(2.0, 0.9, 3.4, 0.15), 0x55525c, [0, 1.55, 2.6])
        b.solid(block(1.3, 0.7, 1.8, 0.12), 0x6d6a74, [0, 2.3, 3.2])
        b.glow(new THREE.BoxGeometry(1.2, 0.12, 0.05), 0xffd9a0, 3, [0, 2.4, 2.28])
        b.solid(slab([[-0.5, -1.0], [0.5, -1.0], [0.4, 1.4], [-0.4, 1.4]], 0.12, 0.03), H_PAINT, [0, 2.02, 0.2])
        b.metal(cyl(0.05, 0.09, 2.2, 5), H_METAL, [0.4, 3.6, 3.6])
        b.glow(octa(0.13), 0xff3040, 5, [0.4, 4.75, 3.6])
        b.metal(ico(0.5, 1), 0x9e9aa6, [-0.5, 2.9, 3.8])
        // Keel and ventral fins.
        b.solid(slab([[0, -2.5], [0, 5.2], [1.7, 4.4], [1.2, -0.6]], 0.2, 0.05), H_DARK, [0, -1.0, 0], [0, 0, -Math.PI / 2])
        b.glow(new THREE.BoxGeometry(0.05, 0.08, 4.4), glow, 1.6, [0, -2.55, 2.0])
        b.solid(slab([[1.5, 3.4], [3.6, 5.6], [3.5, 6.4], [1.3, 5.8]], 0.14, 0.04), H_ARMOR, [0, 0.2, 0], [0, 0, 0.1], [1, 1, 1], true)
        for (let i = 0; i < 8; i++) b.glow(new THREE.BoxGeometry(0.04, 0.1, 0.36), i % 4 === 0 ? 0xffd9a0 : 0x9fc4ff, 1.8, [1.5, 0.6, -1.8 + i * 0.85], [0, 0, 0], [1, 1, 1], true)
        b.engine([0, 0.1, 6.5], 0.62, false, glow)
        b.engine([0.95, -0.2, 6.5], 0.42, true, glow)
    },
    sentinel(b, glow) {
        b.solid(ico(1.4, 1), H_ARMOR)
        b.solid(ring(2.1, 0.25, 4, 12), H_DARK, [0, 0, 0], [Math.PI / 2, 0, 0])
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            b.solid(slab([[0, 0], [0.4, 0.3], [0.3, 1.4], [0, 1.6]], 0.12, 0.03), H_PAINT, [Math.cos(a) * 1.9, Math.sin(a) * 1.9, 0.3], [Math.PI / 2, 0, a - Math.PI / 2])
        }
        b.metal(tube(0.3, 0.42, 2.2, 8), H_DARK, [0, 0, -1.8])
        for (let i = 0; i < 3; i++) b.glow(ring(0.45, 0.04, 3, 12), glow, 2.4, [0, 0, -1.2 - i * 0.45])
        b.glow(octa(0.35), glow, 4.5, [0, 0, -3.0])
        b.glow(ring(1.45, 0.05, 4, 24), glow, 1.8)
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
