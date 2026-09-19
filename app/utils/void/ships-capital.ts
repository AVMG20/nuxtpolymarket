// Void Runner — capital player hulls: Aegis, Hive, Seraph, Bastion and Leviathan.

import * as THREE from 'three'
import { cyl, ico, octa, ring, tube, type ModelBuilder } from './models'
import { type Livery, type Vec3, type Section, loft, slab, block, WINDOW, navLights, windows, mast, seam, canopy, nacelle, vent, greeble, barrel, sectionAt, band, mount, flankPlate, radiator, dish } from './ship-kit'

export const CAPITAL_DESIGNS: Record<string, (b: ModelBuilder, l: Livery) => void> = {
    aegis(b, l) {
        const GOLD = 0xd9a441
        const OCT: [number, number, number] = [8, 0.5, Math.PI / 8]
        const hull: Section[] = [
            { z: -3.1, w: 0.55, h: 0.42, y: -0.05 },
            { z: -2.3, w: 1.15, h: 0.82 },
            { z: 0, w: 1.45, h: 1.05 },
            { z: 2.4, w: 1.35, h: 0.95 },
            { z: 3.0, w: 1.05, h: 0.72 }
        ]
        b.solid(loft(hull, ...OCT), l.paint)
        band(b, hull, -2.2, -1.9, l.accent, OCT)
        band(b, hull, -1.86, -1.78, GOLD, OCT, 0.04)
        band(b, hull, 1.5, 2.3, l.paint2, OCT)
        band(b, hull, 2.34, 2.42, GOLD, OCT, 0.04)
        band(b, hull, -0.04, 0.04, l.glow, OCT, 0.015, 1.4)
        // Shield projector: a ring on four prongs with a bright emitter at its heart.
        b.metal(ring(1.0, 0.13, 6, 8), l.trim, [0, -0.05, -3.55], [0, 0, Math.PI / 8])
        b.glow(ring(0.82, 0.045, 4, 8), l.glow, 2.8, [0, -0.05, -3.6], [0, 0, Math.PI / 8])
        b.solid(new THREE.TorusGeometry(1.0, 0.15, 6, 2, Math.PI / 4), GOLD, [0, -0.05, -3.55], [0, 0, Math.PI * 0.375])
        b.solid(new THREE.TorusGeometry(1.0, 0.15, 6, 2, Math.PI / 4), GOLD, [0, -0.05, -3.55], [0, 0, Math.PI * 1.375])
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            b.metal(block(0.16, 0.16, 1.5, 0.03), l.metal, [Math.cos(a) * 0.82, -0.05 + Math.sin(a) * 0.7, -2.9], [Math.sin(a) * 0.22, -Math.cos(a) * 0.22, 0])
        }
        b.metal(tube(0.2, 0.32, 0.7, 8), l.trim, [0, -0.05, -3.35])
        b.glow(octa(0.24), l.glow, 3.5, [0, -0.05, -3.78])
        // Pauldrons: three kite shields a side, growing aft, each overlapping the next.
        const kite: [number, number][] = [[0.9, -0.95], [0.9, 0.95], [-0.25, 0.95], [-1.3, 0], [-0.25, -0.95]]
        for (let i = 0; i < 3; i++) {
            const k = 0.82 + i * 0.14
            const x = 2.6 + i * 0.22
            const z = -1.75 + i * 1.5
            const face = i === 1 ? l.paint : l.paint2
            const boss = i === 1 ? l.paint2 : l.paint
            const scaled = (f: number) => kite.map(([h, d]) => [h * k * f, d * k * f] as [number, number])
            flankPlate(b, GOLD, scaled(1.06), 0.14, [x - 0.04, 0, z], 0.16, 0.03)
            flankPlate(b, face, scaled(1), 0.24, [x, 0, z], 0.16, 0.07)
            flankPlate(b, boss, scaled(0.55), 0.12, [x + 0.15, -0.05, z], 0.16, 0.04)
            b.glow(new THREE.BoxGeometry(0.04, 0.05, 0.7 * k), l.glow, 2.2, [x + 0.22, 0.1, z], [0, 0, 0.16], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.04, 0.6 * k, 0.05), l.glow, 2.2, [x + 0.23, -0.08, z], [0, 0, 0.16], [1, 1, 1], true)
            for (const d of [-0.7, 0.7]) b.metal(octa(0.07), l.metal, [x + 0.08, 0.68 * k, z + d * k], [0, 0, 0], [1, 1, 1], true)
            b.metal(block(0.9, 0.22, 0.3, 0.03), l.metal, [2.1 + i * 0.1, -0.1, z + 0.2], [0, 0, 0], [1, 1, 1], true)
        }
        // Sponsons tucked behind the plates.
        b.solid(block(0.85, 0.9, 2.5, 0.08), l.paint2, [1.95, 0, -0.4], [0, 0, 0], [1, 1, 1], true)
        b.solid(block(0.87, 0.2, 2.0, 0.03), l.paint, [1.95, 0, -0.4], [0, 0, 0], [1, 1, 1], true)
        barrel(b, l, [1.95, 0.12, -2.0], 0.9, 0.09, true)
        barrel(b, l, [1.95, -0.16, -1.9], 0.7, 0.07, true)
        b.engine([1.95, 0, 0.9], 0.3, true, l.glow)
        // Bridge, then the shield generator dome behind it.
        b.solid(loft([
            { z: -1.1, w: 0.45, h: 0.18, y: 1.18 },
            { z: -0.7, w: 0.7, h: 0.34, y: 1.3 },
            { z: 0.35, w: 0.7, h: 0.34, y: 1.3 },
            { z: 0.6, w: 0.55, h: 0.25, y: 1.25 }
        ], ...OCT), l.paint2)
        b.glass(new THREE.BoxGeometry(1.1, 0.14, 0.04), l.glass, [0, 1.42, -0.9], [-0.5, 0, 0])
        windows(b, [-0.45, 1.36, -0.93], 7, 0.15, 0.09)
        b.solid(new THREE.BoxGeometry(1.42, 0.05, 0.12), GOLD, [0, 1.64, -0.15])
        mast(b, [0.4, 1.62, 0.3], 1.0)
        mast(b, [-0.35, 1.62, 0.35], 0.65)
        b.metal(cyl(0.62, 0.7, 0.16, 12), l.trim, [0, 1.05, 1.25])
        b.glow(ico(0.46, 1), l.glow, 1.5, [0, 1.12, 1.25], [0, 0, 0], [1, 0.7, 1])
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            b.metal(block(0.1, 0.4, 0.1, 0.02), l.metal, [Math.cos(a) * 0.52, 1.25, 1.25 + Math.sin(a) * 0.52], [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35])
        }
        b.metal(ring(0.5, 0.04, 4, 12), GOLD, [0, 1.42, 1.25], [Math.PI / 2, 0, 0])
        // Belly keel with a lit trench.
        b.solid(block(1.5, 0.3, 3.6, 0.08), l.paint2, [0, -1.08, 0.5])
        seam(b, l.glow, [0.5, -1.24, 0.5], 3.0, true, 'z', 1.4)
        vent(b, [0.95, 0.98, 2.0], 0.5, 0.06, 0.7, true, 3)
        greeble(b, l, [0.85, 1.0, -1.6], 0.7, 1.0, 7, 12, true)
        navLights(b, 3.2, 0.95, 2.4)
        b.engine([0.55, 0.36, 3.1], 0.42, true, l.glow)
        b.engine([0.55, -0.4, 3.1], 0.38, true, l.glow)
        mount(b, l, [0, 0.94, 2.25])
        mount(b, l, [0, 0.9, -1.75])
        mount(b, l, [1.95, 0.5, -0.4], true, true)
        mount(b, l, [1.95, -0.5, -0.4], false, true)
        mount(b, l, [0, -1.28, 0.6], false)
    },

    // A catamaran carrier: drones fly out through a lit tunnel between the twin
    // hulls, and each flank is a honeycomb of launch cells.
    hive(b, l) {
        const CREAM = 0xe9e2cf
        const OCT: [number, number, number] = [8, 0.5, Math.PI / 8]
        const hull: Section[] = [
            { z: -3.8, w: 0.18, h: 0.2, x: 1.55, y: -0.1 },
            { z: -2.7, w: 0.68, h: 0.62, x: 1.55 },
            { z: 2.4, w: 0.76, h: 0.66, x: 1.55 },
            { z: 3.2, w: 0.56, h: 0.48, x: 1.55 }
        ]
        b.solid(loft(hull, ...OCT), l.paint, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        // Wasp-striped prows with a lit eye.
        band(b, hull, -3.55, -3.3, l.paint2, OCT, 0.03, 0, true)
        band(b, hull, -3.05, -2.8, l.paint2, OCT, 0.03, 0, true)
        band(b, hull, 2.0, 2.35, l.paint2, OCT, 0.03, 0, true)
        b.glow(octa(0.1), l.glow, 3.5, [2.05, 0.1, -2.95], [0, 0, 0], [1, 1, 1], true)
        // Flight deck roof and the tunnel floor.
        b.metal(block(2.3, 0.14, 5.5, 0.03), l.trim, [0, 0.62, -0.2])
        b.solid(block(2.0, 0.14, 5.2, 0.03), l.paint, [0, -0.6, -0.1])
        for (let i = 0; i < 8; i++) b.glow(new THREE.BoxGeometry(0.06, 0.02, 0.28), l.glow, 2, [0, 0.7, -2.6 + i * 0.62])
        seam(b, l.accent, [1.08, 0.7, -0.2], 5.3, true, 'z', 1.2)
        b.glow(ring(0.55, 0.025, 3, 6), CREAM, 1.6, [0, 0.7, 1.9], [Math.PI / 2, 0, 0])
        for (let i = 0; i < 3; i++) b.solid(slab([[0, 0], [0.5, 0.3], [0.5, 0.46], [0, 0.16]], 0.02, 0), CREAM, [0.12, 0.7, -2.7 + i * 0.35], [0, 0, 0], [1, 1, 1], true)
        // Tunnel: hazard lip, lit walls, guide lights down the floor.
        for (let i = 0; i < 9; i++) b.solid(block(0.2, 0.16, 0.12, 0.01), i % 2 ? l.trim : l.paint2, [-0.8 + i * 0.2, 0.6, -2.98])
        b.glow(new THREE.BoxGeometry(1.7, 0.05, 0.03), l.glow, 2.4, [0, 0.49, -2.96])
        b.metal(block(1.9, 1.1, 0.2, 0.03), 0x0b0c0f, [0, 0, 1.3])
        b.glow(tube(0.34, 0.34, 0.02, 6), l.glow, 1.8, [0, 0, 1.18])
        b.metal(ring(0.42, 0.05, 4, 6), l.paint2, [0, 0, 1.17])
        for (const y of [0.36, -0.36]) b.glow(new THREE.BoxGeometry(0.03, 0.05, 3.9), l.glow, 1.7, [0.84, y, -0.85], [0, 0, 0], [1, 1, 1], true)
        for (let i = 0; i < 7; i++) b.glow(new THREE.BoxGeometry(0.1, 0.02, 0.1), CREAM, 2, [0, -0.52, -2.5 + i * 0.55])
        for (let i = 0; i < 4; i++) b.metal(block(0.12, 1.1, 0.12, 0.02), l.metal, [0.86, 0, -2.3 + i * 1.1], [0, 0, 0], [1, 1, 1], true)
        // Honeycomb launch cells along each flank.
        for (let row = 0; row < 2; row++) {
            for (let i = 0; i < 7 - row; i++) {
                const at: Vec3 = [2.28, 0.2 - row * 0.42, -1.75 + i * 0.5 + row * 0.25]
                b.solid(cyl(0.28, 0.28, 0.34, 6), l.paint2, at, [0, 0, Math.PI / 2], [1, 1, 1], true)
                b.metal(cyl(0.22, 0.22, 0.36, 6), 0x0b0c0f, at, [0, 0, Math.PI / 2], [1, 1, 1], true)
                b.glow(cyl(0.15, 0.15, 0.37, 6), l.glow, (i + row) % 3 === 0 ? 1.5 : 0.65, at, [0, 0, Math.PI / 2], [1, 1, 1], true)
            }
        }
        // Island on the starboard hull, control blister to port.
        b.solid(block(0.85, 0.5, 2.0, 0.06), l.paint2, [1.55, 0.92, 0.7])
        b.solid(block(0.7, 0.45, 1.3, 0.06), l.paint, [1.55, 1.38, 0.55])
        b.glass(new THREE.BoxGeometry(0.62, 0.16, 0.04), l.glass, [1.55, 1.42, -0.12], [-0.35, 0, 0])
        windows(b, [1.18, 1.4, 0.1], 5, 0.2, 0.12, 'z')
        windows(b, [1.92, 1.4, 0.1], 5, 0.2, 0.12, 'z')
        for (let i = 0; i < 5; i++) b.solid(new THREE.BoxGeometry(0.87, 0.1, 0.12), i % 2 ? l.trim : l.paint2, [1.55, 0.78, -0.1 + i * 0.12])
        mast(b, [1.75, 1.6, 1.0], 1.2)
        dish(b, l, [1.35, 1.6, 1.05], 0.3)
        b.solid(loft([
            { z: -0.6, w: 0.2, h: 0.1, x: -1.55, y: 0.66 },
            { z: -0.2, w: 0.4, h: 0.24, x: -1.55, y: 0.74 },
            { z: 0.7, w: 0.4, h: 0.24, x: -1.55, y: 0.74 },
            { z: 1.0, w: 0.25, h: 0.12, x: -1.55, y: 0.68 }
        ], 8, 0.7), l.paint2)
        b.glass(new THREE.BoxGeometry(0.5, 0.1, 0.04), l.glass, [-1.55, 0.86, -0.42], [-0.7, 0, 0])
        // Canted tail fins.
        b.solid(slab([[0, 0], [0.9, 0.7], [0.95, 1.35], [0, 1.2]], 0.09, 0.03), l.paint, [1.75, 0.55, 1.9], [0, 0, Math.PI / 2 - 0.35], [1, 1, 1], true)
        b.solid(slab([[0.62, 0.5], [0.9, 0.7], [0.95, 1.35], [0.62, 1.3]], 0.11, 0.03), l.paint2, [1.75, 0.55, 1.9], [0, 0, Math.PI / 2 - 0.35], [1, 1, 1], true)
        // Drive house between the hulls.
        b.solid(loft([{ z: 1.35, w: 0.95, h: 0.62 }, { z: 2.7, w: 0.95, h: 0.6 }, { z: 3.0, w: 0.8, h: 0.48 }], ...OCT), l.paint)
        vent(b, [0, 0.72, 2.75], 1.2, 0.06, 0.4, false, 3)
        b.engine([0.42, 0, 3.05], 0.3, true, l.glow)
        b.engine([1.55, 0, 3.3], 0.45, true, l.glow)
        navLights(b, 2.35, 0.4, 2.6)
        greeble(b, l, [-0.7, 0.69, 2.3], 0.5, 0.6, 5, 21)
        mount(b, l, [1.55, 1.64, 0.55])
        mount(b, l, [-1.55, 0.67, 1.9])
        mount(b, l, [0, -0.7, -0.5], false)
    },

    seraph(b, l) {
        const seraphHull: Section[] = [
            { z: -3.4, w: 0.02, h: 0.02 },
            { z: -2.3, w: 0.28, h: 0.22 },
            { z: -0.6, w: 0.55, h: 0.38, y: 0.03 },
            { z: 1.2, w: 0.6, h: 0.4 },
            { z: 2.3, w: 0.38, h: 0.28 }
        ]
        b.solid(loft(seraphHull, 12, 0.85), l.paint)
        b.solid(loft([
            { z: -2.8, w: 0.06, h: 0.05, y: -0.15 },
            { z: 2.0, w: 0.35, h: 0.1, y: -0.34 }
        ], 6, 0.6), l.paint2)
        canopy(b, l, -2.1, -0.75, 0.28, 0.24, 0.15)
        band(b, seraphHull, -2.9, -2.55, l.accent, [12, 0.85, 0], 0.008)
        band(b, seraphHull, -0.45, -0.3, l.accent, [12, 0.85, 0], 0.01)
        band(b, seraphHull, -0.26, -0.22, l.trim, [12, 0.85, 0], 0.01)
        band(b, seraphHull, 1.5, 2.2, l.paint2, [12, 0.85, 0], 0.01)
        b.metal(new THREE.ConeGeometry(0.025, 0.7, 6).rotateX(-Math.PI / 2), l.metal, [0, 0, -3.7])
        b.glow(octa(0.04), l.glow, 3.5, [0, 0, -4.06])
        // Layered feathers over the upper wings.
        for (let i = 0; i < 3; i++) b.solid(slab([[0, 0], [0.75, -0.32], [0.9, -0.1], [0.12, 0.5]], 0.05, 0.012), i === 1 ? l.paint2 : l.paint, [0.75 + i * 0.62, 0.37 + i * 0.14, 0.3 - i * 0.3], [0, 0, 0.22], [1, 1, 1], true)
        b.metal(block(0.3, 0.1, 1.0, 0.02), l.trim, [0, -0.42, 0.6])
        // Upper wings
        b.solid(slab([[0.4, -0.2], [3.0, -1.35], [3.35, -0.95], [0.6, 1.2]], 0.1, 0.03), l.paint, [0, 0.08, 0], [0, 0, 0.22], [1, 1, 1], true)
        b.solid(slab([[2.2, -1.0], [3.0, -1.35], [3.35, -0.95], [2.4, -0.5]], 0.11, 0.03), l.accent, [0, 0.085, 0], [0, 0, 0.22], [1, 1, 1], true)
        // Lower wings
        b.solid(slab([[0.4, 0.6], [2.4, 1.8], [2.25, 2.2], [0.4, 1.7]], 0.08, 0.025), l.paint2, [0, -0.15, 0], [0, 0, -0.3], [1, 1, 1], true)
        // Feather lights
        for (let i = 0; i < 3; i++) b.glow(new THREE.BoxGeometry(0.03, 0.03, 1.2 - i * 0.25), l.glow, 2.4, [1.2 + i * 0.6, 0.35 + i * 0.13, -0.3 - i * 0.3], [0, 0.55, 0.22], [1, 1, 1], true)
        navLights(b, 3.25, 0.82, -1.1)
        nacelle(b, l, [1.4, 0.3, 1.1], 0.3, 1.8, true)
        b.glow(ring(0.85, 0.035, 4, 40), l.glow, 3, [0, 0.05, 2.75])
        b.metal(ring(0.85, 0.05, 4, 20), l.metal, [0, 0.05, 2.7])
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            b.metal(new THREE.BoxGeometry(0.04, 0.55, 0.04), l.metal, [Math.cos(a) * 0.55, 0.05 + Math.sin(a) * 0.55, 2.55], [0, 0, a - Math.PI / 2])
        }
        seam(b, l.accent, [0, 0.42, 0.3], 1.8, false, 'z', 1.4)
        b.engine([0, 0, 2.35], 0.3, false, l.glow)
        b.hardpoint([0, 0.43, 0.4], [0, 1, 0])
        b.hardpoint([0, -0.44, -0.3], [0, -1, 0])
        b.hardpoint([1.4, 0.61, 1.0], [0, 1, 0], true)
        b.hardpoint([1.4, -0.01, 1.0], [0, -1, 0], true)
    },

    // A flying fortress: a dagger prow with a triple main battery, casemates
    // behind armoured skirts, a stepped citadel and twin tail fins over the drives.
    bastion(b, l) {
        const BRASS = 0xc9973f
        const OCT: [number, number, number] = [8, 0.5, Math.PI / 8]
        const hull: Section[] = [
            { z: -6.4, w: 0.3, h: 0.3, y: -0.35 },
            { z: -4.3, w: 2.1, h: 1.15, y: -0.05 },
            { z: 0, w: 3.0, h: 1.5 },
            { z: 4.0, w: 2.9, h: 1.42 },
            { z: 4.8, w: 2.35, h: 1.12 }
        ]
        const keel: Section[] = [
            { z: -4.8, w: 0.5, h: 0.3, y: -1.0 },
            { z: -2.5, w: 1.5, h: 0.6, y: -1.5 },
            { z: 2.5, w: 1.7, h: 0.65, y: -1.6 },
            { z: 4.4, w: 1.3, h: 0.5, y: -1.35 }
        ]
        b.solid(loft(hull, ...OCT), l.paint)
        b.solid(loft(keel, ...OCT), l.trim)
        band(b, hull, -6.4, -5.2, l.paint2, OCT, 0.04)
        band(b, hull, -5.15, -5.0, BRASS, OCT, 0.05)
        band(b, hull, -2.0, -1.55, l.paint2, OCT)
        band(b, hull, 3.3, 3.95, l.paint2, OCT)
        band(b, hull, 4.0, 4.12, BRASS, OCT, 0.05)
        band(b, hull, -4.32, -4.26, l.glow, OCT, 0.02, 1.6)
        band(b, keel, -1.0, -0.92, l.glow, OCT, 0.02, 1.6)
        band(b, keel, 1.6, 1.68, l.glow, OCT, 0.02, 1.6)
        // Ram: cheek plates either side of a lit maw.
        b.solid(slab([[0.25, -6.9], [0.7, -6.9], [2.4, -4.2], [0.9, -4.2]], 0.8, 0.1), l.paint2, [0, -0.4, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.3, -6.6], [0.55, -6.6], [1.9, -4.4], [1.1, -4.4]], 0.3, 0.05), BRASS, [0, 0.12, 0], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.4, 0.5, 2.0), l.glow, 1.3, [0, -0.4, -5.7])
        // Main battery on the foredeck.
        b.metal(cyl(1.0, 1.1, 0.25, 8), l.trim, [0, 1.28, -3.0])
        b.solid(slab([[-0.85, -0.9], [0.85, -0.9], [0.95, 0.4], [0.6, 0.9], [-0.6, 0.9], [-0.95, 0.4]], 0.6, 0.1), l.paint2, [0, 1.7, -3.0])
        b.solid(new THREE.BoxGeometry(1.5, 0.08, 0.5), BRASS, [0, 2.02, -2.7])
        for (const x of [-0.5, 0, 0.5]) barrel(b, l, [x, 1.72, -4.8], 2.2, 0.11)
        // Casemates with forward guns, behind canted armour skirts.
        const skirt: [number, number][] = [[-1.2, -1.0], [0.6, -1.0], [1.0, -0.6], [1.0, 0.6], [0.6, 1.0], [-1.2, 1.0], [-1.5, 0]]
        b.metal(tube(0.3, 0.3, 7.6, 8), l.metal, [3.1, 0, 0.1], [0, 0, 0], [1, 1, 1], true)
        for (let i = 0; i < 3; i++) {
            const z = -2.4 + i * 2.5
            b.solid(block(1.5, 2.0, 2.2, 0.12), i === 1 ? l.paint : l.paint2, [3.3, 0, z], [0, 0, 0], [1, 1, 1], true)
            b.solid(block(1.54, 0.3, 1.8, 0.04), l.trim, [3.3, -0.35, z], [0, 0, 0], [1, 1, 1], true)
            flankPlate(b, l.paint2, skirt, 0.2, [4.25, -0.1, z], 0.14, 0.06)
            flankPlate(b, l.paint, skirt.map(([h, d]) => [h * 0.55, d * 0.6] as [number, number]), 0.12, [4.37, -0.1, z], 0.14, 0.04)
            b.solid(new THREE.BoxGeometry(0.1, 0.1, 1.5), BRASS, [4.13, 0.88, z], [0, 0, 0.14], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.04, 0.12, 0.7), l.glow, 2, [4.46, -0.05, z], [0, 0, 0.14], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.2, 0.5, 0.06), l.glow, 1.5, [3.75, 0.2, z + 1.25], [0, 0, 0], [1, 1, 1], true)
            barrel(b, l, [3.3, 0.45, z - 1.5], 1.2, 0.09, true)
        }
        // Bow casemates: stepped wedges with a lit gun slit.
        b.solid(slab([[-0.6, -1.3], [0.35, -1.3], [0.75, 0.9], [-0.75, 0.9]], 1.5, 0.12), l.paint2, [3.3, 0, -4.4], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[-0.62, -0.5], [0.62, -0.5], [0.78, 0.92], [-0.78, 0.92]], 1.9, 0.1), l.paint, [3.3, 0, -4.4], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[-0.64, -1.0], [0.5, -1.0], [0.62, -0.7], [-0.64, -0.7]], 1.56, 0.04), BRASS, [3.3, 0, -4.4], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.7, 0.12, 0.05), l.glow, 2.2, [3.2, 0, -5.72], [0, 0, 0], [1, 1, 1], true)
        barrel(b, l, [3.2, -0.35, -6.0], 1.0, 0.1, true)
        // Stepped citadel with buttresses.
        b.solid(block(2.6, 0.95, 4.4, 0.1), l.paint2, [0, 2.0, 0.4])
        b.solid(block(1.8, 1.0, 2.6, 0.1), l.paint, [0, 2.98, 1.1])
        b.solid(block(2.64, 0.12, 4.44, 0.03), BRASS, [0, 2.42, 0.4])
        b.solid(block(1.84, 0.12, 2.64, 0.03), l.paint2, [0, 3.42, 1.1])
        b.solid(slab([[0, -1.6], [1.7, 0.6], [1.7, 1.6], [0, 1.0]], 0.22, 0.05), l.paint, [1.0, 1.45, 0.4], [0, 0, Math.PI / 2], [1, 1, 1], true)
        b.solid(loft([
            { z: 0.1, w: 0.55, h: 0.25, y: 3.72 },
            { z: 0.35, w: 0.8, h: 0.36, y: 3.76 },
            { z: 1.3, w: 0.8, h: 0.36, y: 3.76 },
            { z: 1.5, w: 0.6, h: 0.28, y: 3.72 }
        ], ...OCT), l.paint2)
        b.glass(new THREE.BoxGeometry(1.3, 0.16, 0.04), l.glass, [0, 3.86, 0.2], [-0.5, 0, 0])
        windows(b, [-0.55, 3.8, 0.17], 8, 0.155, 0.1)
        windows(b, [-1.05, 2.1, -1.82], 9, 0.26, 0.13)
        windows(b, [1.31, 2.05, -1.2], 8, 0.4, 0.14, 'z')
        windows(b, [-1.31, 2.05, -1.2], 8, 0.4, 0.14, 'z')
        windows(b, [-0.7, 3.05, -0.22], 6, 0.28, 0.12)
        mast(b, [0.45, 4.1, 1.2], 2.4)
        mast(b, [-0.45, 4.1, 1.3], 1.6)
        dish(b, l, [0, 3.48, 2.95], 0.5)
        for (let i = 0; i < 4; i++) vent(b, [1.6, 1.62, -0.9 + i * 0.8], 0.06, 0.4, 0.5, true, 3)
        // Tail fins and drives.
        b.solid(slab([[0, 0], [2.2, 1.4], [2.4, 2.6], [0, 2.4]], 0.24, 0.06), l.paint2, [2.0, 1.2, 2.3], [0, 0, Math.PI / 2 - 0.2], [1, 1, 1], true)
        b.solid(slab([[1.5, 0.95], [2.2, 1.4], [2.4, 2.6], [1.5, 2.55]], 0.27, 0.06), BRASS, [2.0, 1.2, 2.3], [0, 0, Math.PI / 2 - 0.2], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.05, 1.6, 0.06), l.glow, 2, [2.36, 2.2, 4.95], [0, 0, -0.2], [1, 1, 1], true)
        b.solid(slab([[0, 0], [1.3, 0.8], [1.3, 2.0], [0, 2.2]], 0.3, 0.06), l.paint2, [0, -2.1, 0.3], [0, 0, -Math.PI / 2])
        navLights(b, 4.5, 1.0, 3.6)
        b.engine([0, -0.1, 4.95], 0.8, false, l.glow)
        b.engine([1.55, 0.55, 4.9], 0.62, true, l.glow)
        b.engine([1.55, -0.65, 4.9], 0.55, true, l.glow)
        b.engine([3.3, 0, 3.95], 0.55, true, l.glow)
        greeble(b, l, [1.9, 1.42, -1.6], 1.0, 2.2, 16, 31, true)
        greeble(b, l, [3.3, 1.0, 0.1], 0.9, 1.4, 8, 32, true)
        greeble(b, l, [0.75, 2.5, 1.9], 0.5, 1.2, 6, 33, true)
        mount(b, l, [0, 2.5, -1.2], true, false, 0.42)
        mount(b, l, [0, 3.5, 2.0], true, false, 0.42)
        mount(b, l, [3.3, 1.02, -2.4], true, true, 0.42)
        mount(b, l, [3.3, 1.02, 2.6], true, true, 0.42)
        mount(b, l, [3.3, -1.02, 0.1], false, true, 0.42)
        mount(b, l, [0, -2.1, -1.2], false, false, 0.42)
        mount(b, l, [0, -2.0, 3.6], false, false, 0.42)
    },

    // A dreadnought built around its gun: the spinal lance runs out between two
    // long prow tines, with swept wings carrying an outrigger hull on each side.
    leviathan(b, l) {
        const NAVY = 0x1d3557
        const GOLD = 0xd8a53c
        const OCT: [number, number, number] = [8, 0.55, Math.PI / 8]
        const hull: Section[] = [
            { z: -7.4, w: 1.0, h: 0.85 },
            { z: -6.4, w: 2.1, h: 1.5 },
            { z: -4.0, w: 2.5, h: 1.8 },
            { z: 3.0, w: 3.1, h: 2.2 },
            { z: 7.0, w: 2.8, h: 2.0 },
            { z: 8.0, w: 2.1, h: 1.5 }
        ]
        const top = (z: number) => sectionAt(hull, z).h * 0.97
        b.solid(loft(hull, ...OCT), l.paint)
        band(b, hull, -6.3, -5.6, NAVY, OCT, 0.04)
        band(b, hull, -5.55, -5.4, GOLD, OCT, 0.05)
        band(b, hull, -2.2, -1.2, l.paint2, OCT, 0.04)
        band(b, hull, 1.2, 1.6, NAVY, OCT, 0.04)
        band(b, hull, 5.6, 6.9, NAVY, OCT, 0.04)
        band(b, hull, 6.95, 7.1, GOLD, OCT, 0.05)
        for (const z of [-4.6, -3.2, -0.4, 0.5, 2.4, 4.6]) band(b, hull, z, z + 0.08, l.glow, OCT, 0.02, 1.5)
        // Prow tines cradling the lance.
        const tine: Section[] = [
            { z: -11.2, w: 0.12, h: 0.2, x: 2.0 },
            { z: -10.2, w: 0.5, h: 0.65, x: 2.0 },
            { z: -6.6, w: 0.75, h: 1.0, x: 2.05 },
            { z: -4.8, w: 0.5, h: 0.75, x: 2.3 }
        ]
        b.solid(loft(tine, ...OCT), l.paint, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        band(b, tine, -10.9, -10.3, NAVY, OCT, 0.04, 0, true)
        band(b, tine, -10.25, -10.1, GOLD, OCT, 0.05, 0, true)
        band(b, tine, -8.0, -7.4, l.paint2, OCT, 0.04, 0, true)
        b.glow(new THREE.BoxGeometry(0.05, 0.12, 3.4), l.glow, 2.2, [1.42, 0, -8.6], [0, 0, 0], [1, 1, 1], true)
        windows(b, [2.78, 0.35, -8.6], 6, 0.45, 0.14, 'z')
        windows(b, [-2.78, 0.35, -8.6], 6, 0.45, 0.14, 'z')
        navLights(b, 2.0, 0.3, -11.1)
        b.metal(tube(0.5, 0.8, 4.2, 12), l.trim, [0, 0, -8.9])
        for (let i = 0; i < 4; i++) {
            const z = -10.5 + i * 0.95
            b.glow(ring(0.78, 0.07, 4, 16), l.glow, 2.4, [0, 0, z])
            b.metal(block(1.3, 0.16, 0.22, 0.03), l.metal, [0.95, 0, z + 0.3], [0, 0, 0], [1, 1, 1], true)
        }
        b.glow(tube(0.36, 0.36, 0.1, 12), l.glow, 4, [0, 0, -11.02])
        // Swept wings out to the outrigger hulls.
        b.solid(slab([[2.6, -3.0], [5.3, -0.6], [5.3, 3.6], [2.6, 3.4]], 0.55, 0.12), l.paint2, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[2.9, -2.35], [5.0, -0.5], [5.0, 0.3], [2.9, -1.2]], 0.62, 0.08), NAVY, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.06, 0.06, 3.5), l.glow, 2.2, [3.95, 0, -1.85], [0, -0.844, 0], [1, 1, 1], true)
        for (let i = 0; i < 3; i++) radiator(b, l, [3.2, 0.3, 1.2 + i * 0.9], 1.9, 0.7, 0.0, l.glow, 3)
        const pod: Section[] = [
            { z: -4.4, w: 0.2, h: 0.3, x: 6 },
            { z: -2.8, w: 1.05, h: 1.25, x: 6 },
            { z: 4.4, w: 1.05, h: 1.25, x: 6 },
            { z: 5.2, w: 0.75, h: 0.9, x: 6 }
        ]
        b.solid(loft(pod, ...OCT), l.paint, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        band(b, pod, -3.6, -3.0, NAVY, OCT, 0.04, 0, true)
        band(b, pod, -2.95, -2.82, GOLD, OCT, 0.05, 0, true)
        band(b, pod, 3.2, 4.3, NAVY, OCT, 0.04, 0, true)
        band(b, pod, 0.6, 0.68, l.glow, OCT, 0.02, 1.5, true)
        seam(b, l.accent, [7.08, -0.3, 0.8], 6.0, true, 'z', 1.6)
        for (let i = 0; i < 6; i++) b.glow(new THREE.BoxGeometry(0.03, 0.14, 0.4), WINDOW, 1.4, [7.07, 0.45, -1.8 + i * 1.1], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0, 0], [1.8, 1.2], [1.9, 2.6], [0, 2.4]], 0.2, 0.05), NAVY, [6, 1.1, 2.4], [0, 0, Math.PI / 2], [1, 1, 1], true)
        b.solid(slab([[0, 0], [1.3, 1.0], [1.3, 2.2], [0, 2.4]], 0.2, 0.05), NAVY, [6, -1.1, 2.4], [0, 0, -Math.PI / 2], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.05, 1.3, 0.06), l.glow, 2, [6, 2.4, 5.0], [0, 0, 0], [1, 1, 1], true)
        // Dorsal trenches and the citadel.
        for (const z of [-3.0, 0.3]) b.metal(block(0.5, 0.2, 2.6, 0.04), 0x0d1117, [1.25, top(z + 1.3) - 0.04, z + 1.3], [0, 0, 0], [1, 1, 1], true)
        seam(b, l.glow, [1.25, top(-1.2) + 0.08, -1.7], 2.4, true, 'z', 2)
        seam(b, l.glow, [1.25, top(2) + 0.06, 1.6], 2.4, true, 'z', 2)
        b.solid(block(3.2, 1.2, 5.2, 0.12), l.paint2, [0, 2.7, 3.2])
        b.solid(block(3.24, 0.14, 5.24, 0.03), NAVY, [0, 3.22, 3.2])
        b.solid(block(2.1, 1.2, 3.2, 0.12), l.paint, [0, 3.85, 3.6])
        b.solid(block(2.14, 0.14, 3.24, 0.03), GOLD, [0, 4.36, 3.6])
        b.solid(loft([
            { z: 2.3, w: 0.8, h: 0.3, y: 4.75 },
            { z: 2.6, w: 1.05, h: 0.46, y: 4.82 },
            { z: 4.0, w: 1.05, h: 0.46, y: 4.82 },
            { z: 4.3, w: 0.8, h: 0.35, y: 4.75 }
        ], ...OCT), l.paint2)
        b.glass(new THREE.BoxGeometry(1.7, 0.2, 0.05), l.glass, [0, 4.95, 2.42], [-0.5, 0, 0])
        windows(b, [-0.8, 4.86, 2.38], 11, 0.16, 0.1)
        windows(b, [-1.4, 2.85, 0.58], 11, 0.28, 0.14)
        windows(b, [1.61, 2.8, 1.0], 10, 0.46, 0.15, 'z')
        windows(b, [-1.61, 2.8, 1.0], 10, 0.46, 0.15, 'z')
        windows(b, [1.06, 3.9, 2.3], 6, 0.46, 0.13, 'z')
        windows(b, [-1.06, 3.9, 2.3], 6, 0.46, 0.13, 'z')
        b.solid(slab([[0, 0], [2.4, 1.0], [2.2, 3.0], [0, 3.2]], 0.22, 0.05), NAVY, [0, 1.9, 5.4], [0, 0, Math.PI / 2])
        b.glow(new THREE.BoxGeometry(0.06, 0.06, 2.0), l.glow, 2, [0, 4.24, 7.4], [-0.1, 0, 0])
        mast(b, [0.55, 5.25, 3.9], 3)
        mast(b, [-0.55, 5.25, 3.7], 2.2)
        dish(b, l, [0, 5.28, 3.1], 0.6)
        for (let i = 0; i < 5; i++) vent(b, [1.72, 2.4, 1.2 + i * 0.9], 0.08, 0.5, 0.6, true, 3)
        // Ventral hangar between twin keel fins.
        b.metal(block(1.8, 0.3, 3.0, 0.05), 0x0b0e13, [0, -top(-2.5) + 0.05, -2.5])
        for (const x of [-0.8, 0.8]) b.glow(new THREE.BoxGeometry(0.06, 0.06, 2.8), l.glow, 2.2, [x, -top(-2.5) - 0.12, -2.5])
        for (let i = 0; i < 5; i++) b.glow(new THREE.BoxGeometry(0.9, 0.04, 0.08), WINDOW, 1.6, [0, -top(-2.5) - 0.11, -3.6 + i * 0.55])
        b.solid(slab([[0, 0], [1.6, 1.2], [1.6, 4.6], [0, 5.4]], 0.3, 0.06), NAVY, [1.7, -1.9, 1.2], [0, 0, -Math.PI / 2 + 0.25], [1, 1, 1], true)
        // Drive cluster in a shroud.
        b.metal(ring(2.0, 0.2, 6, 8), l.trim, [0, 0, 8.3], [0, 0, Math.PI / 8])
        b.glow(ring(1.8, 0.04, 4, 8), l.glow, 2, [0, 0, 8.5], [0, 0, Math.PI / 8])
        b.engine([0, 0, 8.1], 1.0, false, l.glow)
        b.engine([1.55, 0.85, 8.05], 0.72, true, l.glow)
        b.engine([1.55, -0.95, 8.05], 0.72, true, l.glow)
        b.engine([6, 0, 5.4], 0.75, true, l.glow)
        greeble(b, l, [1.5, 1.72, -4.2], 1.2, 2.0, 16, 41, true)
        greeble(b, l, [6, 1.22, 0.4], 1.0, 3.0, 14, 42, true)
        greeble(b, l, [2.0, 2.05, 6.4], 1.0, 1.6, 10, 43, true)
        greeble(b, l, [1.1, 3.32, 1.4], 0.7, 1.2, 8, 44, true)
        for (const z of [-6.0, -4.2, -0.8]) mount(b, l, [0, top(z) + 0.04, z], true, false, 0.5)
        mount(b, l, [0, 4.48, 4.9], true, false, 0.5)
        mount(b, l, [6, 1.25, -1.5], true, true, 0.5)
        mount(b, l, [6, 1.25, 2.0], true, true, 0.5)
        mount(b, l, [6, -1.25, 0.6], false, true, 0.5)
        mount(b, l, [0, -top(2) - 0.04, 2.0], false, false, 0.5)
        mount(b, l, [0, -top(6.2) - 0.04, 6.2], false, false, 0.5)
    }
}
