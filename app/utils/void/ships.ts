// Void Runner — player hulls.
//
// Every hull is lofted from cross-sections (a rounded polygon swept along the
// ship's length), dressed with chamfered plates, bare-metal machinery, glass
// canopies and lit detail: nav lights, window rows, panel seams, vents. Still
// procedural and flat-shaded, but each silhouette is designed to read at a
// glance and look expensive up close.


import * as THREE from 'three'
import { ModelBuilder, cyl, octa, ring, tube, type BuiltModel } from './models'
import { type Section, loft, slab, block, type Livery, RED, PANEL, SCORCH, HAZARD, navLights, windows, mast, seam, canopy, nacelle, vent, barrel, band, mount, radiator, tank, dish, shade, panelLine, hazard, rcs, aerial, skid, gearBay, intake, thruster, gunFairing, saddle, stripLight } from './ship-kit'
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
    // A recon scout: a slim fuselage between two intake trunks feeding one big
    // burner, cropped deltas with drooped tips, canted twin tails and a radome
    // on the spine.
    sparrow(b, l) {
        const ROUND: [number, number, number] = [12, 0.72, 0]
        const hull: Section[] = [
            { z: -1.78, w: 0.03, h: 0.025, y: -0.03 },
            { z: -1.45, w: 0.11, h: 0.085, y: -0.02 },
            { z: -0.95, w: 0.21, h: 0.17 },
            { z: -0.35, w: 0.3, h: 0.24, y: 0.02 },
            { z: 0.35, w: 0.35, h: 0.27, y: 0.02 },
            { z: 0.95, w: 0.33, h: 0.25 },
            { z: 1.28, w: 0.27, h: 0.21 }
        ]
        b.solid(loft(hull, ...ROUND), l.paint)
        band(b, hull, -1.62, -1.42, l.accent, ROUND, 0.006)
        band(b, hull, -1.4, -1.385, PANEL, ROUND, 0.004)
        band(b, hull, -0.98, -0.965, PANEL, ROUND, 0.004)
        band(b, hull, 0.3, 0.315, PANEL, ROUND, 0.004)
        band(b, hull, 0.42, 0.56, l.accent, ROUND, 0.008)
        band(b, hull, 0.6, 0.64, l.trim, ROUND, 0.008)
        band(b, hull, 1.0, 1.27, SCORCH, ROUND, 0.01)
        b.metal(tube(0.008, 0.014, 0.42, 5), l.metal, [0, -0.03, -1.95])
        b.metal(tube(0.02, 0.02, 0.05, 6), l.trim, [0, -0.03, -1.8])
        // Spine armour, the radome on its pylon and a whip aerial.
        saddle(b, hull, -0.1, 1.15, l.paint2, 0.5, 0.015)
        saddle(b, hull, 0.62, 1.1, l.trim, 0.3, 0.035)
        seam(b, l.glow, [0, 0.318, 0.25], 0.6, false, 'z', 0.8)
        b.metal(block(0.09, 0.16, 0.3, 0.015), l.trim, [0, 0.36, 0.72])
        b.solid(cyl(0.3, 0.3, 0.035, 14), l.paint2, [0, 0.47, 0.72])
        b.solid(cyl(0.2, 0.3, 0.03, 14), l.paint, [0, 0.5, 0.72])
        b.solid(cyl(0.3, 0.2, 0.03, 14), l.trim, [0, 0.44, 0.72])
        b.glow(ring(0.3, 0.008, 3, 14).rotateX(Math.PI / 2), l.glow, 1.5, [0, 0.47, 0.72])
        b.glow(octa(0.035), l.glow, 3, [0, 0.53, 0.72])
        aerial(b, [0, 0.29, -0.02], 0.4)
        // Keel, gear doors and the belly mount.
        b.solid(loft([
            { z: -1.0, w: 0.12, h: 0.06, y: -0.14 },
            { z: 0.95, w: 0.3, h: 0.1, y: -0.19 }
        ], 6, 0.6), l.paint2)
        gearBay(b, l, [0, -0.205, -0.75], 0.14, 0.34)
        gearBay(b, l, [0.42, -0.125, 0.55], 0.16, 0.42, true, l.paint)
        b.glass(new THREE.IcosahedronGeometry(0.07, 1), l.glass, [0, -0.12, -1.22], [0, 0, 0], [1, 0.7, 1.4])
        b.metal(ring(0.075, 0.012, 4, 10).rotateX(Math.PI / 2), l.trim, [0, -0.1, -1.22], [0, 0, 0], [1, 1, 1.4])
        canopy(b, l, -0.88, 0.18, 0.2, 0.17, 0.125)
        b.solid(loft([
            { z: 0.1, w: 0.16, h: 0.1, y: 0.22 },
            { z: 0.7, w: 0.1, h: 0.05, y: 0.27 }
        ], 6, 0.7), l.paint)
        // Intake trunks down both flanks, necking into the burner.
        const trunk: Section[] = [
            { z: -0.18, w: 0.15, h: 0.15, x: 0.43, y: 0.02 },
            { z: 0.7, w: 0.17, h: 0.17, x: 0.45, y: 0.02 },
            { z: 1.12, w: 0.13, h: 0.14, x: 0.36, y: 0.02 },
            { z: 1.34, w: 0.07, h: 0.08, x: 0.3, y: 0.02 }
        ]
        const BOXY: [number, number, number] = [8, 0.5, Math.PI / 8]
        b.solid(loft(trunk, ...BOXY), l.paint2, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        band(b, trunk, 0.18, 0.195, PANEL, BOXY, 0.004, 0, true)
        band(b, trunk, 0.86, 1.1, SCORCH, BOXY, 0.006, 0, true)
        intake(b, l, [0.43, 0.02, -0.12], 0.3, 0.3, 0.3, true, l.paint, 2)
        hazard(b, [0.43, 0.178, 0.0], 0.24, 0.05, 4, true)
        vent(b, [0.45, 0.19, 0.62], 0.16, 0.03, 0.3, true, 3)
        b.glow(new THREE.BoxGeometry(0.1, 0.03, 0.01), l.glow, 2.2, [0.3, 0.02, 1.35], [0, 0, 0], [1, 1, 1], true)
        // Cropped delta: a stepped root panel, steel leading edge, split flaps and a missile rail on the tip.
        const WING_Y = -0.03
        b.solid(slab([[0.5, -0.32], [1.5, 0.5], [1.5, 0.88], [0.5, 0.96]], 0.07, 0.02), l.paint, [0, WING_Y, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.5, -0.12], [0.95, 0.24], [0.95, 0.84], [0.5, 0.88]], 0.105, 0.02), l.paint2, [0, WING_Y, 0], [0, 0, 0], [1, 1, 1], true)
        b.metal(slab([[0.5, -0.36], [1.52, 0.48], [1.52, 0.57], [0.5, -0.26]], 0.085, 0.02), l.metal, [0, WING_Y, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[1.0, 0.3], [1.46, 0.62], [1.46, 0.8], [1.0, 0.5]], 0.08, 0.01), l.accent, [0, WING_Y, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.53, 1.0], [0.98, 0.97], [0.98, 1.12], [0.53, 1.17]], 0.05, 0.012), l.paint2, [0, WING_Y - 0.012, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[1.02, 0.965], [1.46, 0.93], [1.46, 1.05], [1.02, 1.115]], 0.05, 0.012), l.paint, [0, WING_Y - 0.012, 0], [0, 0, 0], [1, 1, 1], true)
        for (const x of [0.62, 0.9, 1.12, 1.38]) b.metal(block(0.05, 0.05, 0.22, 0.01), l.trim, [x, WING_Y - 0.04, 0.96], [0, 0, 0], [1, 1, 1], true)
        panelLine(b, [1.22, WING_Y + 0.036, 0.62], 0.62, 'z', true)
        panelLine(b, [1.2, WING_Y + 0.036, 0.86], 0.56, 'x', true)
        stripLight(b, l.glow, [0.72, WING_Y + 0.054, 0.5], 0.4, 'z', true, 1.6)
        rcs(b, l, [1.3, WING_Y + 0.05, 0.5], true, true, 0.8)
        // Tip rail with a drooped winglet.
        b.metal(loft([
            { z: 0.2, w: 0.02, h: 0.02, x: 1.54, y: WING_Y },
            { z: 0.38, w: 0.05, h: 0.05, x: 1.54, y: WING_Y },
            { z: 1.0, w: 0.05, h: 0.05, x: 1.54, y: WING_Y },
            { z: 1.1, w: 0.025, h: 0.025, x: 1.54, y: WING_Y }
        ], 6, 0.9), l.trim, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0, 0.45], [0.26, 0.78], [0.26, 0.98], [0, 0.98]], 0.04, 0.01), l.accent, [1.54, WING_Y - 0.03, 0], [0, 0, -Math.PI / 2 + 0.3], [1, 1, 1], true)
        navLights(b, 1.6, WING_Y, 0.42)
        b.glow(octa(0.04), 0xffffff, 3, [1.54, WING_Y, 1.12], [0, 0, 0], [1, 1, 1], true)
        // A missile under each wing on a pylon.
        b.metal(block(0.04, 0.08, 0.26, 0.008), l.metal, [0.98, WING_Y - 0.07, 0.5], [0, 0, 0], [1, 1, 1], true)
        b.metal(tube(0.04, 0.04, 0.56, 8), 0xd8dde3, [0.98, WING_Y - 0.14, 0.45], [0, 0, 0], [1, 1, 1], true)
        b.solid(new THREE.ConeGeometry(0.04, 0.14, 8).rotateX(-Math.PI / 2), RED, [0.98, WING_Y - 0.14, 0.1], [0, 0, 0], [1, 1, 1], true)
        for (const r of [0, Math.PI / 2]) b.metal(new THREE.BoxGeometry(0.16, 0.008, 0.1), l.trim, [0.98, WING_Y - 0.14, 0.68], [0, 0, r + Math.PI / 4], [1, 1, 1], true)
        // Twin tails canted off the trunks.
        b.solid(slab([[0, 0.42], [0.52, 1.02], [0.58, 1.3], [0, 1.24]], 0.05, 0.012), l.paint, [0.45, 0.16, 0], [0, 0, Math.PI / 2 - 0.38], [1, 1, 1], true)
        b.solid(slab([[0.38, 0.9], [0.52, 1.02], [0.58, 1.3], [0.4, 1.28]], 0.06, 0.012), l.accent, [0.45, 0.16, 0], [0, 0, Math.PI / 2 - 0.38], [1, 1, 1], true)
        b.metal(slab([[0, 0.38], [0.53, 1.0], [0.53, 1.06], [0, 0.46]], 0.06, 0.01), l.metal, [0.45, 0.16, 0], [0, 0, Math.PI / 2 - 0.38], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.02, 0.26, 0.025), l.glow, 2, [0.57, 0.46, 1.27], [0, 0, -0.38], [1, 1, 1], true)
        b.glow(octa(0.035), RED, 3, [0.665, 0.7, 1.2], [0, 0, 0], [1, 1, 1], true)
        // Nose guns in cheek fairings, and RCS quads around the nose.
        gunFairing(b, l, [0.2, -0.09, -0.78], 0.62, 0.07, 0.5, true)
        rcs(b, l, [0.12, 0.1, -1.2], true, true, 0.7)
        // Burner.
        b.metal(tube(0.27, 0.3, 0.3, 12), l.trim, [0, 0, 1.2])
        thruster(b, l, [0, 0, 1.45], 0.21)
        mount(b, l, [0, -0.255, 0.25], false, false, 0.16)
    },

    // An interceptor: a needle fuselage striped like its namesake, slung between
    // two spiked ramjet nacelles, with forward-swept wings, canards and an X-tail.
    wasp(b, l) {
        const ROUND: [number, number, number] = [12, 0.7, 0]
        const hull: Section[] = [
            { z: -2.3, w: 0.02, h: 0.02 },
            { z: -1.9, w: 0.075, h: 0.065 },
            { z: -1.5, w: 0.13, h: 0.115 },
            { z: -0.5, w: 0.25, h: 0.22, y: 0.02 },
            { z: 0.4, w: 0.3, h: 0.25, y: 0.02 },
            { z: 0.95, w: 0.27, h: 0.22 },
            { z: 1.4, w: 0.15, h: 0.13 }
        ]
        b.solid(loft(hull, ...ROUND), l.paint)
        // Wasp bands down the abdomen and a steel stinger on the nose.
        for (const z of [-0.1, 0.3, 0.7, 1.05]) band(b, hull, z, z + 0.18, l.paint2, ROUND, 0.008)
        band(b, hull, -2.1, -1.85, l.trim, ROUND, 0.006)
        band(b, hull, -1.42, -1.405, PANEL, ROUND, 0.004)
        band(b, hull, -0.42, -0.405, PANEL, ROUND, 0.004)
        b.metal(new THREE.ConeGeometry(0.03, 0.5, 6).rotateX(-Math.PI / 2), l.metal, [0, 0, -2.5])
        b.glow(octa(0.035), l.glow, 3, [0, 0, -2.76])
        saddle(b, hull, -0.35, 1.3, l.trim, 0.34, 0.02)
        seam(b, l.glow, [0, 0.305, 0.1], 0.5, false, 'z', 0.9)
        aerial(b, [0.1, 0.24, 0.05], 0.36, 0.4, true)
        b.solid(loft([
            { z: -2.0, w: 0.05, h: 0.03, y: -0.08 },
            { z: 1.1, w: 0.22, h: 0.08, y: -0.17 }
        ], 6, 0.6), l.paint2)
        gearBay(b, l, [0, -0.165, -1.0], 0.12, 0.32, false, l.paint)
        canopy(b, l, -1.32, -0.3, 0.17, 0.145, 0.115)
        b.solid(loft([
            { z: -0.4, w: 0.14, h: 0.09, y: 0.2 },
            { z: 0.3, w: 0.08, h: 0.04, y: 0.26 }
        ], 6, 0.7), l.paint)
        // Tail cone with a vernier.
        b.metal(tube(0.1, 0.12, 0.16, 8), SCORCH, [0, 0, 1.45])
        b.glow(new THREE.CircleGeometry(0.07, 8), l.glow, 1.6, [0, 0, 1.535])
        // Strakes carry the nacelles; the wings sweep forward from them.
        const WY = -0.02
        b.solid(slab([[0.2, -0.45], [0.6, 0.1], [0.6, 1.2], [0.22, 1.12]], 0.08, 0.02), l.paint, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.24, 0.1], [0.46, 0.22], [0.46, 1.0], [0.24, 1.0]], 0.11, 0.02), l.paint2, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        vent(b, [0.35, WY + 0.06, 0.62], 0.16, 0.025, 0.5, true, 4)
        hazard(b, [0.35, WY + 0.058, 0.25], 0.2, 0.05, 4, true)
        b.solid(slab([[0.76, 0.42], [1.74, -0.3], [1.86, 0.0], [0.78, 1.12]], 0.06, 0.02), l.paint, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.metal(slab([[0.76, 0.36], [1.75, -0.36], [1.78, -0.27], [0.76, 0.47]], 0.075, 0.015), l.metal, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[1.38, -0.04], [1.74, -0.3], [1.86, 0.0], [1.46, 0.41]], 0.07, 0.015), l.paint2, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.82, 1.13], [1.42, 0.5], [1.5, 0.57], [0.86, 1.25]], 0.045, 0.01), l.paint2, [0, WY - 0.01, 0], [0, 0, 0], [1, 1, 1], true)
        panelLine(b, [1.05, WY + 0.031, 0.55], 0.62, 'z', true)
        panelLine(b, [1.32, WY + 0.031, 0.3], 0.5, 'z', true)
        stripLight(b, l.glow, [1.18, WY + 0.04, 0.34], 0.34, 'x', true, 1.6, 0.63)
        rcs(b, l, [1.6, WY + 0.045, -0.05], true, true, 0.75)
        // Tip lances.
        b.metal(loft([
            { z: -0.95, w: 0.008, h: 0.008, x: 1.84, y: WY },
            { z: -0.5, w: 0.04, h: 0.04, x: 1.84, y: WY },
            { z: 0.08, w: 0.045, h: 0.045, x: 1.84, y: WY },
            { z: 0.2, w: 0.02, h: 0.02, x: 1.84, y: WY }
        ], 6, 0.9), l.trim, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        navLights(b, 1.9, WY, -0.2)
        b.glow(octa(0.035), 0xffffff, 3, [1.84, WY, 0.22], [0, 0, 0], [1, 1, 1], true)
        // Canards.
        b.solid(slab([[0.12, -1.18], [0.6, -0.98], [0.6, -0.86], [0.12, -0.78]], 0.04, 0.012), l.paint2, [0, 0.02, 0], [0, 0, -0.08], [1, 1, 1], true)
        b.metal(block(0.1, 0.06, 0.3, 0.015), l.trim, [0.16, 0.0, -0.98], [0, 0, 0], [1, 1, 1], true)
        // Ramjet nacelles: shock spike, banded cowl, scorched tail.
        const NX = 0.62
        const pod: Section[] = [
            { z: -0.12, w: 0.11, h: 0.11, x: NX, y: WY },
            { z: 0.15, w: 0.18, h: 0.18, x: NX, y: WY },
            { z: 1.15, w: 0.18, h: 0.18, x: NX, y: WY },
            { z: 1.5, w: 0.15, h: 0.15, x: NX, y: WY }
        ]
        const POD: [number, number, number] = [10, 0.95, 0]
        b.solid(loft(pod, ...POD), l.paint2, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        band(b, pod, 0.32, 0.5, l.paint, POD, 0.006, 0, true)
        band(b, pod, 0.74, 0.755, PANEL, POD, 0.004, 0, true)
        band(b, pod, 1.12, 1.48, SCORCH, POD, 0.008, 0, true)
        b.metal(ring(0.11, 0.022, 4, 10), l.metal, [NX, WY, -0.12], [0, 0, 0], [1, 1, 1], true)
        b.metal(new THREE.ConeGeometry(0.075, 0.42, 8).rotateX(-Math.PI / 2), l.metal, [NX, WY, -0.2], [0, 0, 0], [1, 1, 1], true)
        b.glow(ring(0.085, 0.008, 3, 10), l.glow, 1.4, [NX, WY, -0.1], [0, 0, 0], [1, 1, 1], true)
        seam(b, l.glow, [NX, WY + 0.185, 0.85], 0.5, true, 'z', 0.9)
        thruster(b, l, [NX, WY, 1.5], 0.14, true)
        // X-tail off the nacelles.
        b.solid(slab([[0, 0.62], [0.5, 1.22], [0.56, 1.5], [0, 1.42]], 0.045, 0.012), l.paint, [NX, WY + 0.14, 0], [0, 0, Math.PI / 2 - 0.5], [1, 1, 1], true)
        b.solid(slab([[0.36, 1.06], [0.5, 1.22], [0.56, 1.5], [0.38, 1.47]], 0.055, 0.012), l.paint2, [NX, WY + 0.14, 0], [0, 0, Math.PI / 2 - 0.5], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.02, 0.3, 0.025), l.glow, 2, [NX + 0.15, WY + 0.4, 1.44], [0, 0, -0.5], [1, 1, 1], true)
        b.solid(slab([[0, 0.78], [0.32, 1.22], [0.36, 1.46], [0, 1.4]], 0.045, 0.012), l.paint2, [NX, WY - 0.14, 0], [0, 0, -Math.PI / 2 + 0.5], [1, 1, 1], true)
        // Conformal tanks under the strakes, guns in the cheeks.
        tank(b, l, l.paint2, [0.36, -0.13, 0.55], 0.075, 0.6, true)
        gunFairing(b, l, [0.17, -0.07, -1.05], 0.6, 0.055, 0.55, true)
        rcs(b, l, [0.09, 0.085, -1.62], true, true, 0.6)
        mount(b, l, [0, -0.2, 0.2], false, false, 0.14)
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
        for (const x of [0.26, 0.76]) b.metal(new THREE.BoxGeometry(0.04, 0.24, 0.5), l.trim, [x, 0.6, -2.44], [0, -x * 0.35, 0], [1, 1, 1], true)
        b.metal(block(1.7, 0.05, 0.1, 0.015), l.trim, [0, 0.74, -2.12])
        windows(b, [1.05, 0.3, -2.0], 3, 0.25, 0.14, 'z')
        windows(b, [-1.05, 0.3, -2.0], 3, 0.25, 0.14, 'z')
        // Roof: armour cap, hatch, light bar and a hazard collar where the cab meets the keel.
        saddle(b, cab, -2.3, -1.2, l.paint2, 0.62, 0.03)
        b.metal(cyl(0.2, 0.22, 0.05, 10), l.trim, [-0.3, 0.9, -1.72])
        b.metal(new THREE.BoxGeometry(0.06, 0.03, 0.2), l.metal, [-0.3, 0.935, -1.72])
        b.metal(block(1.1, 0.08, 0.12, 0.02), l.trim, [0, 0.8, -2.3])
        for (const x of [-0.42, -0.14, 0.14, 0.42]) b.glow(new THREE.BoxGeometry(0.18, 0.06, 0.03), 0xfff4d6, 2.6, [x, 0.8, -2.37])
        band(b, cab, -1.3, -1.14, 0x15171b, OCT, 0.02)
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2
            b.solid(block(0.3, 0.035, 0.15, 0.008), HAZARD, [Math.cos(a) * 0.97, Math.sin(a) * 0.76, -1.22], [0, 0, a + Math.PI / 2])
        }
        band(b, cab, -2.62, -2.6, PANEL, OCT, 0.006)
        band(b, cab, -2.12, -2.1, PANEL, OCT, 0.006)
        // Boarding rungs, RCS quads and an aerial farm.
        for (let i = 0; i < 4; i++) b.metal(new THREE.BoxGeometry(0.05, 0.025, 0.22), l.metal, [1.1, -0.35 + i * 0.16, -1.62], [0, 0, 0], [1, 1, 1], true)
        rcs(b, l, [0.8, 0.62, -2.5], true, true, 1.5)
        rcs(b, l, [0.8, -0.6, -1.4], true, false, 1.5)
        aerial(b, [-0.75, 0.62, -1.9], 0.9, 0.3)
        aerial(b, [-0.62, 0.7, -1.7], 0.6, 0.2)
        // Bumper, work lights and the mining drills under the chin.
        for (let i = 0; i < 5; i++) b.solid(block(0.2, 0.06, 0.34, 0.01), i % 2 ? l.trim : l.accent, [-0.48 + i * 0.24, -0.52, -2.66], [0.75, 0, 0])
        b.metal(block(0.34, 0.18, 0.12, 0.02), l.trim, [0.55, -0.18, -2.9], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.24, 0.1, 0.04), 0xfff4d6, 3.2, [0.55, -0.18, -2.97], [0, 0, 0], [1, 1, 1], true)
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
        for (const x of [-0.18, 0.18]) b.metal(tube(0.05, 0.05, 3.4, 6), x < 0 ? l.metal : l.accent, [x, 0.5, 0.55])
        for (const z of [-0.5, 0.6, 1.7]) {
            b.metal(new THREE.BoxGeometry(0.07, 0.07, 1.7), l.metal, [0.68, 0.56, z], [0, 0.95, 0], [1, 1, 1], true)
            b.metal(block(0.3, 0.12, 0.22, 0.02), l.trim, [0.86, 0.5, z - 0.48], [0, 0, 0], [1, 1, 1], true)
        }
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
        b.metal(tube(0.06, 0.06, 0.7, 6), l.metal, [0.86, -0.62, 2.0], [0.35, 0, 0], [1, 1, 1], true)
        skid(b, l, [0.86, -1.08, 0.5], 2.6, 0.22, true)
        skid(b, l, [0, -0.86, -2.1], 1.3, 0.18)
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
        band(b, drive, 3.0, 3.27, SCORCH, OCT, 0.015)
        saddle(b, drive, 2.35, 3.2, l.trim, 0.55, 0.03)
        hazard(b, [0, 0.885, 3.12], 1.0, 0.1, 8)
        // Engine backplate: three burners set in a recessed, piped bulkhead.
        b.metal(loft([{ z: 3.27, w: 0.84, h: 0.58, y: 0.02 }, { z: 3.34, w: 0.8, h: 0.55, y: 0.02 }], ...OCT), 0x14171c)
        thruster(b, l, [0.5, 0.25, 3.36], 0.31, true, 8, false)
        thruster(b, l, [0, -0.4, 3.36], 0.31, false, 8, false)
        for (const y of [0.62, 0.5]) b.metal(tube(0.03, 0.03, 1.2, 6), l.metal, [0, y, 3.36], [0, Math.PI / 2, 0])
        b.metal(block(0.3, 0.3, 0.1, 0.02), l.trim, [0, 0.2, 3.36])
        b.glow(new THREE.BoxGeometry(0.12, 0.05, 0.02), RED, 2.6, [0.7, -0.42, 3.36], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.12, 0.05, 0.02), 0xfff4d6, 2.2, [0.7, -0.3, 3.36], [0, 0, 0], [1, 1, 1], true)
        b.metal(block(1.5, 0.08, 0.5, 0.02), l.trim, [0, -0.86, 3.2])
        hazard(b, [0, -0.815, 3.36], 1.4, 0.12, 10)
        navLights(b, 1.4, 0.55, 2.2)
        b.glow(octa(0.06), 0xffffff, 3, [0, 0.95, 3.3])
        mount(b, l, [0, 0.84, -2.0], true, false, 0.26)
        mount(b, l, [0, -0.48, 0.6], false, false, 0.26)
    },

    // A gunship: a slab-sided armoured hull with a rotary cannon under the chin,
    // thick stub wings hung with ordnance and gun pods, and two big engine blocks
    // on the shoulders under canted tails.
    kestrel(b, l) {
        const ROUND: [number, number, number] = [12, 0.55, 0]
        const hull: Section[] = [
            { z: -2.5, w: 0.06, h: 0.05, y: -0.04 },
            { z: -2.15, w: 0.26, h: 0.14, y: -0.02 },
            { z: -1.7, w: 0.44, h: 0.22 },
            { z: -0.4, w: 0.78, h: 0.34, y: 0.02 },
            { z: 1.0, w: 0.88, h: 0.36 },
            { z: 1.85, w: 0.7, h: 0.3 },
            { z: 2.1, w: 0.5, h: 0.22 }
        ]
        b.solid(loft(hull, ...ROUND), l.paint)
        band(b, hull, -2.3, -1.95, l.trim, ROUND, 0.008)
        band(b, hull, -1.72, -1.7, PANEL, ROUND, 0.005)
        band(b, hull, -0.3, 0.0, l.paint2, ROUND, 0.012)
        band(b, hull, 0.04, 0.09, l.accent, ROUND, 0.012, 1.3)
        band(b, hull, 0.62, 0.64, PANEL, ROUND, 0.005)
        band(b, hull, 1.3, 1.8, l.paint2, ROUND, 0.012)
        band(b, hull, 1.84, 2.08, SCORCH, ROUND, 0.012)
        // Dorsal armour in two steps, a cooling grille and the top mount.
        saddle(b, hull, -0.45, 1.9, l.paint2, 0.62, 0.02)
        saddle(b, hull, 0.75, 1.75, l.trim, 0.36, 0.06)
        vent(b, [0, 0.46, 1.25], 0.46, 0.05, 0.7, false, 5)
        hazard(b, [0, 0.415, -0.3], 0.7, 0.07, 8)
        mount(b, l, [0, 0.43, 0.3], true, false, 0.24)
        aerial(b, [0.3, 0.38, -0.1], 0.55, 0.35, true)
        // Rotary chin cannon in an armoured cradle.
        b.metal(block(0.34, 0.2, 0.9, 0.03), l.trim, [0, -0.3, -1.3])
        b.solid(block(0.42, 0.1, 0.6, 0.03), l.paint2, [0, -0.2, -1.3])
        b.metal(tube(0.1, 0.1, 0.16, 8), l.metal, [0, -0.32, -1.8])
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2
            b.metal(tube(0.022, 0.026, 0.95, 6), l.metal, [Math.cos(a) * 0.06, -0.32 + Math.sin(a) * 0.06, -2.2])
        }
        b.metal(tube(0.095, 0.095, 0.05, 8), l.trim, [0, -0.32, -2.5])
        b.metal(tube(0.095, 0.095, 0.05, 8), l.trim, [0, -0.32, -2.15])
        b.glow(tube(0.04, 0.04, 0.02, 8), l.glow, 2.6, [0, -0.32, -2.69])
        // Armoured cheeks and a framed cockpit.
        b.solid(slab([[0.3, -1.6], [0.62, -0.9], [0.7, -0.3], [0.45, -0.35]], 0.1, 0.02), l.paint2, [0, 0.16, 0], [0, 0, -0.35], [1, 1, 1], true)
        b.solid(slab([[0.42, -1.2], [0.6, -0.85], [0.64, -0.45], [0.5, -0.5]], 0.14, 0.02), l.trim, [0, 0.17, 0], [0, 0, -0.35], [1, 1, 1], true)
        canopy(b, l, -1.68, -0.5, 0.25, 0.27, 0.16)
        b.solid(loft([
            { z: -0.62, w: 0.26, h: 0.13, y: 0.32 },
            { z: 0.1, w: 0.18, h: 0.06, y: 0.38 }
        ], 6, 0.7), l.paint)
        rcs(b, l, [0.3, 0.17, -1.95], true, true, 1)
        gunFairing(b, l, [0.5, -0.12, -1.25], 0.8, 0.075, 0.6, true)
        // Keel, gear doors.
        b.solid(loft([
            { z: -1.9, w: 0.2, h: 0.06, y: -0.19 },
            { z: 1.7, w: 0.6, h: 0.1, y: -0.3 }
        ], 6, 0.6), l.paint2)
        gearBay(b, l, [0, -0.335, -0.7], 0.22, 0.5, false, l.paint)
        gearBay(b, l, [0.42, -0.385, 1.0], 0.24, 0.6, true, l.paint)
        // Stub wings: stepped armour, steel leading edge, split flaps.
        const WY = 0.0
        b.solid(slab([[0.7, -0.55], [2.3, 0.25], [2.3, 1.1], [0.78, 1.3]], 0.13, 0.04), l.paint, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.75, -0.3], [1.5, 0.08], [1.5, 1.12], [0.78, 1.22]], 0.19, 0.03), l.paint2, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.metal(slab([[0.7, -0.6], [2.32, 0.21], [2.32, 0.33], [0.7, -0.47]], 0.15, 0.03), l.metal, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[1.62, 0.1], [2.28, 0.43], [2.28, 0.62], [1.62, 0.3]], 0.145, 0.02), l.accent, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.85, 1.33], [1.5, 1.24], [1.5, 1.42], [0.85, 1.52]], 0.08, 0.02), l.paint2, [0, WY - 0.02, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[1.55, 1.235], [2.25, 1.14], [2.25, 1.3], [1.55, 1.415]], 0.08, 0.02), l.paint, [0, WY - 0.02, 0], [0, 0, 0], [1, 1, 1], true)
        for (const x of [1.0, 1.35, 1.7, 2.1]) b.metal(block(0.07, 0.07, 0.3, 0.015), l.trim, [x, WY - 0.06, 1.24 - (x - 1) * 0.12], [0, 0, 0], [1, 1, 1], true)
        panelLine(b, [1.9, WY + 0.066, 0.7], 0.8, 'z', true)
        panelLine(b, [1.95, WY + 0.066, 0.95], 0.66, 'x', true)
        stripLight(b, l.accent, [1.12, WY + 0.098, 0.2], 0.5, 'z', true, 1.8)
        rcs(b, l, [2.05, WY + 0.085, 0.55], true, true, 1.1)
        mount(b, l, [1.45, WY + 0.1, 0.62], true, true, 0.2)
        // Ordnance: a rocket pod inboard, missiles outboard.
        b.metal(block(0.06, 0.12, 0.4, 0.01), l.metal, [1.0, WY - 0.13, 0.35], [0, 0, 0], [1, 1, 1], true)
        b.metal(tube(0.13, 0.13, 0.8, 10), l.trim, [1.0, WY - 0.31, 0.3], [0, 0, 0], [1, 1, 1], true)
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2
            b.glow(new THREE.CircleGeometry(0.025, 6).rotateY(Math.PI), RED, 1.4, [1.0 + Math.cos(a) * 0.075, WY - 0.31 + Math.sin(a) * 0.075, -0.105], [0, 0, 0], [1, 1, 1], true)
        }
        for (const x of [1.85, 2.1]) {
            b.metal(block(0.04, 0.08, 0.3, 0.008), l.metal, [x, WY - 0.1, 0.7], [0, 0, 0], [1, 1, 1], true)
            b.metal(tube(0.05, 0.05, 0.7, 8), 0xc9cfd6, [x, WY - 0.18, 0.65], [0, 0, 0], [1, 1, 1], true)
            b.solid(new THREE.ConeGeometry(0.05, 0.16, 8).rotateX(-Math.PI / 2), x > 2 ? l.accent : RED, [x, WY - 0.18, 0.22], [0, 0, 0], [1, 1, 1], true)
        }
        // Tip gun pods.
        const tip: Section[] = [
            { z: -0.8, w: 0.1, h: 0.1, x: 2.38, y: 0.04 },
            { z: -0.4, w: 0.21, h: 0.21, x: 2.38, y: 0.04 },
            { z: 1.4, w: 0.21, h: 0.21, x: 2.38, y: 0.04 },
            { z: 1.7, w: 0.12, h: 0.12, x: 2.38, y: 0.04 }
        ]
        const POD: [number, number, number] = [8, 0.7, Math.PI / 8]
        b.solid(loft(tip, ...POD), l.paint2, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        band(b, tip, -0.2, 0.0, l.accent, POD, 0.008, 0, true)
        band(b, tip, 0.6, 0.62, PANEL, POD, 0.005, 0, true)
        barrel(b, l, [2.38, 0.04, -1.25], 0.95, 0.065, true)
        vent(b, [2.38, 0.255, 0.9], 0.2, 0.03, 0.4, true, 3)
        navLights(b, 2.62, 0.04, 0.3)
        b.glow(octa(0.05), 0xffffff, 3, [2.38, 0.04, 1.74], [0, 0, 0], [1, 1, 1], true)
        // Shoulder engine blocks: scooped intakes, scorched tails, full burners.
        const EX = 0.47
        const eng: Section[] = [
            { z: 0.35, w: 0.22, h: 0.2, x: EX + 0.08, y: 0.2 },
            { z: 0.75, w: 0.34, h: 0.32, x: EX + 0.06, y: 0.12 },
            { z: 1.9, w: 0.35, h: 0.33, x: EX, y: 0.02 },
            { z: 2.28, w: 0.3, h: 0.29, x: EX - 0.02, y: -0.02 }
        ]
        const BOXY: [number, number, number] = [8, 0.55, Math.PI / 8]
        b.solid(loft(eng, ...BOXY), l.paint, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        band(b, eng, 1.2, 1.22, PANEL, BOXY, 0.005, 0, true)
        band(b, eng, 1.3, 1.5, l.paint2, BOXY, 0.01, 0, true)
        band(b, eng, 1.85, 2.26, SCORCH, BOXY, 0.012, 0, true)
        intake(b, l, [EX + 0.1, 0.42, 0.78], 0.42, 0.18, 0.6, true, l.paint2, 3)
        vent(b, [EX + 0.36, 0.1, 1.2], 0.05, 0.22, 0.6, true, 4)
        seam(b, l.accent, [EX + 0.02, 0.385, 1.55], 0.5, true, 'z', 1.3)
        thruster(b, l, [0.45, -0.02, 2.3], 0.25, true)
        b.metal(block(0.16, 0.3, 0.4, 0.02), l.trim, [0, -0.02, 2.1])
        // Canted twin tails and stabilisers.
        b.solid(slab([[0, 0.9], [0.75, 1.75], [0.82, 2.2], [0, 2.1]], 0.07, 0.015), l.paint, [EX + 0.12, 0.3, 0], [0, 0, Math.PI / 2 - 0.32], [1, 1, 1], true)
        b.solid(slab([[0.55, 1.52], [0.75, 1.75], [0.82, 2.2], [0.58, 2.17]], 0.085, 0.015), l.paint2, [EX + 0.12, 0.3, 0], [0, 0, Math.PI / 2 - 0.32], [1, 1, 1], true)
        b.metal(slab([[0, 0.84], [0.77, 1.71], [0.77, 1.8], [0, 0.95]], 0.085, 0.012), l.metal, [EX + 0.12, 0.3, 0], [0, 0, Math.PI / 2 - 0.32], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.03, 0.4, 0.03), l.accent, 2, [EX + 0.27, 0.78, 2.12], [0, 0, -0.32], [1, 1, 1], true)
        b.glow(octa(0.045), RED, 3, [EX + 0.4, 1.1, 2.0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.78, 1.55], [1.5, 1.9], [1.5, 2.2], [0.78, 2.25]], 0.07, 0.02), l.paint2, [0, 0.02, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[1.2, 1.76], [1.5, 1.9], [1.5, 2.2], [1.2, 2.22]], 0.08, 0.015), l.paint, [0, 0.02, 0], [0, 0, 0], [1, 1, 1], true)
    },

    // A stealth striker: a faceted diamond hull and flying wing, sawtooth edges,
    // buried engines venting through a flat exhaust trough, and a V-tail.
    phantom(b, l) {
        const FACET: [number, number, number] = [4, 1, 0]
        const hull: Section[] = [
            { z: -2.5, w: 0.02, h: 0.02 },
            { z: -1.1, w: 0.42, h: 0.18 },
            { z: 0.4, w: 0.85, h: 0.26 },
            { z: 1.45, w: 0.72, h: 0.19 },
            { z: 2.05, w: 0.5, h: 0.07 }
        ]
        b.solid(loft(hull, ...FACET), l.paint)
        b.metal(tube(0.008, 0.012, 0.4, 5), l.metal, [0, 0, -2.68])
        // Spine hump with a flat deck for the top mount.
        const HEX: [number, number, number] = [6, 1, 0]
        const spine: Section[] = [
            { z: -0.35, w: 0.12, h: 0.05, y: 0.17 },
            { z: 0.1, w: 0.34, h: 0.15, y: 0.17 },
            { z: 0.9, w: 0.36, h: 0.16, y: 0.15 },
            { z: 1.5, w: 0.2, h: 0.08, y: 0.08 }
        ]
        b.solid(loft(spine, ...HEX), l.paint2)
        band(b, spine, 0.72, 0.74, PANEL, HEX, 0.004)
        band(b, spine, 0.16, 0.2, l.accent, HEX, 0.004, 1.6)
        seam(b, l.glow, [0, 0.295, 1.0], 0.5, false, 'z', 1.2)
        canopy(b, l, -1.38, -0.2, 0.08, 0.17, 0.11)
        b.solid(slab([[0.05, -2.2], [0.3, -1.15], [0.12, -1.2]], 0.05, 0.01), l.paint2, [0, 0.06, 0], [0, 0, 0], [1, 1, 1], true)
        // Dorsal intakes beside the hump.
        intake(b, l, [0.5, 0.13, 0.05], 0.3, 0.1, 0.7, true, l.paint2, 2)
        // Flying wing: base skin, raised facets, a dark tip and a sawtooth trailing edge.
        const WY = -0.02
        b.solid(slab([[0.3, -1.1], [2.3, 0.85], [2.05, 1.3], [0.4, 1.0]], 0.06, 0.02), l.paint, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.55, -0.62], [1.45, 0.26], [1.3, 0.95], [0.6, 0.9]], 0.09, 0.02), l.paint2, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.7, -0.2], [1.1, 0.2], [1.02, 0.8], [0.72, 0.78]], 0.12, 0.02), l.paint, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[1.6, 0.2], [2.3, 0.85], [2.05, 1.3], [1.5, 0.75]], 0.075, 0.02), l.trim, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        for (let i = 0; i < 5; i++) b.solid(slab([[0, 0], [0.17, 0.2], [0.34, 0.04]], 0.055, 0.01), l.paint2, [0.42 + i * 0.33, WY, 0.98 + i * 0.06], [0, 0, 0], [1, 1, 1], true)
        b.metal(slab([[0.3, -1.14], [2.33, 0.84], [2.3, 0.92], [0.3, -1.03]], 0.035, 0.008), l.metal, [0, WY, 0], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.03, 0.03, 2.7), l.glow, 2.6, [1.3, WY + 0.03, -0.13], [0, 0.797, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.015, 0.015, 1.0), l.accent, 0.9, [0.95, WY + 0.05, 0.1], [0, 0.797, 0], [1, 1, 1], true)
        panelLine(b, [1.5, WY + 0.032, 0.75], 0.7, 'z', true, 0.35)
        panelLine(b, [1.85, WY + 0.04, 0.85], 0.6, 'z', true, 0.35)
        rcs(b, l, [1.75, WY + 0.05, 0.62], true, true, 0.9)
        navLights(b, 2.26, WY + 0.03, 0.95)
        b.glow(octa(0.04), 0xffffff, 3, [2.05, WY, 1.32], [0, 0, 0], [1, 1, 1], true)
        // Belly: weapons bay with hazard sills, gear doors and the wing mounts.
        b.metal(block(0.56, 0.04, 1.0, 0.01), l.trim, [0, -0.25, 0.3])
        gearBay(b, l, [0, -0.275, 0.3], 0.44, 0.86)
        hazard(b, [0, -0.272, -0.17], 0.5, 0.05, 6)
        gearBay(b, l, [0, -0.2, -1.0], 0.14, 0.34, false, l.paint2)
        // Two turrets ride under the wings.
        mount(b, l, [0.95, WY - 0.04, 0.65], false, true, 0.16)
        gunFairing(b, l, [0.3, -0.04, -1.1], 0.6, 0.05, 0.5, true, l.paint2)
        // V-tail.
        b.solid(slab([[0, 0.3], [0.62, 1.0], [0.55, 1.4], [0, 1.22]], 0.05, 0.015), l.paint2, [0.38, 0.15, 0.2], [0, 0, Math.PI / 2 - 0.65], [1, 1, 1], true)
        b.solid(slab([[0.44, 0.8], [0.62, 1.0], [0.55, 1.4], [0.42, 1.36]], 0.06, 0.012), l.trim, [0.38, 0.15, 0.2], [0, 0, Math.PI / 2 - 0.65], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.02, 0.4, 0.02), l.glow, 2, [0.58, 0.42, 1.56], [0, 0, -0.65], [1, 1, 1], true)
        // Beaver tail: the hull flattens into a blended exhaust deck. The burners sit
        // recessed under a short upper cowl and blow across a longer heat-tiled shelf.
        b.solid(slab([[-0.6, 1.15], [0.6, 1.15], [0.4, 1.85], [-0.4, 1.85]], 0.05, 0.015), l.paint2, [0, 0.15, 0])
        b.metal(slab([[-0.66, 1.3], [0.66, 1.3], [0.44, 2.3], [-0.44, 2.3]], 0.05, 0.015), SCORCH, [0, -0.13, 0])
        for (const x of [-0.5, 0, 0.5]) b.metal(slab([[0, 1.3], [0.27, 1.3], [0.27, 1.85], [0, 2.2]], 0.05, 0.01), l.trim, [x * 0.92, -0.12, 0], [0, 0, Math.PI / 2])
        for (let i = 0; i < 5; i++) b.metal(block(0.15, 0.015, 0.28, 0.004), i % 2 ? 0x2b2622 : 0x4a3d35, [-0.34 + i * 0.17, -0.1, 2.08])
        b.glow(new THREE.BoxGeometry(0.78, 0.015, 0.015), l.glow, 1.8, [0, 0.18, 1.85])
        b.glow(new THREE.BoxGeometry(0.84, 0.012, 0.012), l.accent, 1.4, [0, -0.1, 2.3])
        vent(b, [0.28, 0.185, 1.4], 0.3, 0.025, 0.34, true, 3)
        b.engine([0.25, 0.01, 1.62], 0.13, true, l.glow)
        b.glow(ring(0.125, 0.008, 3, 12), l.glow, 1.5, [0.25, 0.01, 1.75], [0, 0, 0], [1, 1, 1], true)
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
