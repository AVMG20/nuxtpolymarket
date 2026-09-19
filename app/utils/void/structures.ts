// Void Runner — station, beacon and wreck models.

import * as THREE from 'three'
import { ModelBuilder, cyl, ico, octa, ring } from './models'
import { type Section, loft, slab, block, RED, GREEN, WINDOW, type Vec3 } from './ship-kit'

// ─── Structures ────────────────────────────────────────────────────────────

/** Loft standing up along Y instead of Z. */
function tower(sections: Section[], sides = 8, roundness = 0.8, phase = 0) {
    return loft(sections, sides, roundness, phase).rotateX(-Math.PI / 2)
}

/** The home station: spire, spinning habitat ring, docking arms, solar wings. */
export function buildStation(accent: number) {
    const PAINT = 0xd5dae1
    const PANEL = 0x8f98a6
    const DARK = 0x2a3038
    const SOLAR = 0x1b2c4f
    const hub = new ModelBuilder()
    // Central spire
    hub.solid(tower([
        { z: -34, w: 3, h: 3 },
        { z: -28, w: 8, h: 8 },
        { z: -16, w: 10, h: 10 },
        { z: 14, w: 10, h: 10 },
        { z: 22, w: 7, h: 7 },
        { z: 34, w: 3.5, h: 3.5 }
    ], 8, 0.9, Math.PI / 8), PAINT)
    hub.metal(tower([
        { z: -6, w: 13, h: 13 },
        { z: -3, w: 14, h: 14 },
        { z: 3, w: 14, h: 14 },
        { z: 6, w: 13, h: 13 }
    ], 16, 1), PANEL)
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        hub.glow(new THREE.BoxGeometry(1.4, 0.8, 0.2), WINDOW, 1.4, [Math.cos(a) * 14.05, 0, Math.sin(a) * 14.05], [0, -a + Math.PI / 2, 0])
    }
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8
        hub.glow(new THREE.BoxGeometry(0.35, 16, 0.35), accent, 1.1, [Math.cos(a) * 9.9, 22 - 26 + 8, Math.sin(a) * 9.9])
    }
    // Command crown and antennae
    hub.solid(tower([{ z: 34, w: 6, h: 6 }, { z: 38, w: 7, h: 7 }, { z: 41, w: 4, h: 4 }], 8, 0.8, Math.PI / 8), PANEL)
    hub.glow(ring(6.6, 0.18, 4, 32), WINDOW, 1.3, [0, 37, 0], [Math.PI / 2, 0, 0])
    hub.metal(cyl(0.25, 0.5, 16, 6), DARK, [0, 49, 0])
    hub.glow(octa(1), RED, 4, [0, 57, 0])
    hub.metal(new THREE.ConeGeometry(4, 1.5, 16, 1, true), PANEL, [5, 44, 2], [0.5, 0, 0.3])
    // Reactor underneath
    hub.metal(tower([{ z: -34, w: 6, h: 6 }, { z: -40, w: 4, h: 4 }, { z: -44, w: 1, h: 1 }], 8, 1), DARK)
    hub.glow(ico(2.6, 1), accent, 2.2, [0, -38, 0])
    for (let i = 0; i < 3; i++) hub.glow(ring(4.5 + i * 1.2, 0.12, 4, 32), accent, 1.6 - i * 0.4, [0, -30 - i * 2.5, 0], [Math.PI / 2, 0, 0])
    // Solar wings
    for (const side of [1, -1]) {
        hub.metal(block(40, 1, 1, 0.15), DARK, [side * 30, 24, 0])
        for (let k = 0; k < 4; k++) {
            const x = side * (16 + k * 9)
            hub.solid(block(8, 0.3, 14, 0.1), SOLAR, [x, 24, 0])
            for (let r = 0; r < 4; r++) hub.glow(new THREE.BoxGeometry(7.6, 0.05, 0.08), 0x4f9dff, 0.6, [x, 24.2, -5.2 + r * 3.5])
        }
        hub.glow(octa(0.6), side > 0 ? GREEN : RED, 4, [side * 50.5, 24, 0])
    }
    // Docking arms with lit bays and approach strips
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 2
        const x = Math.cos(a)
        const z = Math.sin(a)
        hub.solid(block(24, 3.2, 4.4, 0.4), PANEL, [x * 20, -8, z * 20], [0, -a, 0])
        hub.solid(block(8, 7, 9, 0.6), PAINT, [x * 33, -8, z * 33], [0, -a, 0])
        hub.metal(block(6, 4.2, 0.6, 0.1), DARK, [x * 37.3, -8, z * 37.3], [0, -a + Math.PI / 2, 0])
        hub.glow(new THREE.BoxGeometry(5.6, 0.3, 0.2), accent, 2.6, [x * 37.7, -5.6, z * 37.7], [0, -a + Math.PI / 2, 0])
        hub.glow(new THREE.BoxGeometry(5.6, 0.3, 0.2), accent, 2.6, [x * 37.7, -10.4, z * 37.7], [0, -a + Math.PI / 2, 0])
        for (let k = 0; k < 5; k++) hub.glow(octa(0.35), WINDOW, 3, [x * (40 + k * 4), -8, z * (40 + k * 4)])
    }
    const hubModel = hub.build()

    const rb = new ModelBuilder()
    rb.solid(ring(46, 3.2, 8, 48), PAINT, [0, 0, 0], [Math.PI / 2, 0, 0])
    rb.metal(ring(46, 3.4, 8, 48), DARK, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.35])
    for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2
        if (i % 8 !== 0) rb.glow(new THREE.BoxGeometry(0.4, 0.9, 1.6), WINDOW, 1.4, [Math.cos(a) * 49.25, 1.1, Math.sin(a) * 49.25], [0, -a, 0])
    }
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        rb.metal(block(33, 1.4, 1.6, 0.2), PANEL, [Math.cos(a) * 29, 0, Math.sin(a) * 29], [0, -a, 0])
        rb.solid(block(5, 6.4, 5, 0.5), PANEL, [Math.cos(a) * 46, 0, Math.sin(a) * 46], [0, -a, 0])
        rb.glow(new THREE.BoxGeometry(5.2, 0.35, 0.35), accent, 2, [Math.cos(a) * 46, 3.4, Math.sin(a) * 46], [0, -a, 0])
    }
    const ringModel = rb.build()
    const group = new THREE.Group()
    group.add(hubModel.group)
    group.add(ringModel.group)
    return { group, ring: ringModel.group, radius: 50 }
}

/** Extraction beacon: a finned spindle inside two counter-rotating rings. */
export function buildBeacon(accent: number) {
    const b = new ModelBuilder()
    b.solid(tower([
        { z: -9, w: 0.2, h: 0.2 },
        { z: -4, w: 1.6, h: 1.6 },
        { z: 0, w: 2.2, h: 2.2 },
        { z: 4, w: 1.6, h: 1.6 },
        { z: 9, w: 0.2, h: 0.2 }
    ], 6, 1), 0xb8c0cb)
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        b.solid(slab([[0, -5], [2.4, -2], [2.4, 2], [0, 5]], 0.3, 0.06), 0x353c46, [0, 0, 0], [Math.PI / 2, a, 0])
        b.glow(new THREE.BoxGeometry(0.15, 7, 0.15), accent, 2, [Math.cos(a) * 1.7, 0, Math.sin(a) * 1.7])
    }
    b.glow(octa(1.3), accent, 4.5)
    b.glow(octa(0.35), 0xffffff, 4, [0, 9.4, 0])
    const core = b.build()
    const r1 = new ModelBuilder()
    r1.glow(ring(7.55, 0.12, 4, 48), accent, 2.6)
    r1.glow(ring(6.45, 0.1, 4, 48), accent, 1.8)
    r1.metal(ring(7, 0.45, 6, 24), 0x39414c, [0, 0, 0], [0, 0, 0], [1, 1, 0.5])
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        r1.solid(block(1.2, 1.2, 0.8, 0.1), 0xb8c0cb, [Math.cos(a) * 7, Math.sin(a) * 7, 0], [0, 0, a])
    }
    const r2 = new ModelBuilder()
    r2.glow(ring(5.4, 0.1, 4, 40), accent, 2.2, [0, 0, 0], [Math.PI / 2, 0, 0])
    r2.metal(ring(5, 0.3, 6, 20), 0x39414c, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.5])
    const group = new THREE.Group()
    const ringA = r1.build().group
    const ringB = r2.build().group
    group.add(core.group, ringA, ringB)
    return { group, ringA, ringB }
}

/** A drifting derelict: broken hull sections with exposed ribs and embers. */
export function buildWreck(seed: number) {
    let a = seed >>> 0
    const rng = () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const b = new ModelBuilder()
    const paint = rng() > 0.5 ? 0x6a7280 : 0x7a5a4a
    const pieces = 3 + Math.floor(rng() * 3)
    for (let i = 0; i < pieces; i++) {
        const len = 4 + rng() * 9
        const w = 1.2 + rng() * 2.4
        const h = 0.8 + rng() * 1.6
        const pos: Vec3 = [(rng() - 0.5) * 14, (rng() - 0.5) * 6, (rng() - 0.5) * 16]
        const rot: Vec3 = [rng() * 3, rng() * 3, rng() * 3]
        b.solid(loft([
            { z: -len / 2, w: w * (0.3 + rng() * 0.7), h: h * (0.3 + rng() * 0.7) },
            { z: -len * 0.1, w, h },
            { z: len / 2, w: w * (0.6 + rng() * 0.5), h: h * (0.5 + rng() * 0.5), x: (rng() - 0.5) * 0.8 }
        ], 6, 0.6), rng() > 0.3 ? paint : 0x2b2e34, pos, rot)
        // Exposed ribs at the torn end.
        for (let k = 0; k < 3; k++) {
            b.metal(new THREE.BoxGeometry(0.15, h * 1.6, 0.15), 0x3b3f46, [pos[0] + (k - 1) * w * 0.5, pos[1], pos[2] + len * 0.55], rot)
        }
        b.glow(octa(0.25 + rng() * 0.2), 0xff7a2e, 2 + rng() * 2, [pos[0], pos[1], pos[2] + len * 0.5], rot)
    }
    return b.build()
}
