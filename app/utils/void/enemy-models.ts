// Void Runner — classic hostile, warden, mine and crate models.

import * as THREE from 'three'
import { ModelBuilder, ico, octa, ring, tube, wedge, plate, type BuiltModel, type Vec3 } from './models'

const DARK = 0x2c323c

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
            // Smuggler hauler: long spine, stacked containers, fat engines.
            b.solid(wedge(2.4, 1.8, 3, 0.55, 0.6), E_HULL, [0, 0.2, -5.2])
            b.solid(new THREE.BoxGeometry(1.2, 1.0, 9), E_DARK, [0, 0, 0.6])
            for (let i = 0; i < 4; i++) {
                for (const side of [-1, 1]) {
                    b.solid(new THREE.BoxGeometry(1.5, 1.5, 1.9), i % 2 ? 0x8a5a2b : 0x5b6f8a, [side * 1.4, 0.2, -2.6 + i * 2.1])
                    b.solid(new THREE.BoxGeometry(1.55, 0.12, 1.95), E_DARK, [side * 1.4, 0.98, -2.6 + i * 2.1])
                }
                b.glow(new THREE.BoxGeometry(0.06, 0.3, 0.3), glow, 2, [2.2, 0.2, -2.6 + i * 2.1], [0, 0, 0], [1, 1, 1], true)
            }
            b.solid(new THREE.BoxGeometry(2.6, 2.0, 2.2), E_PLATE, [0, 0.3, 5.6])
            b.glow(new THREE.BoxGeometry(1.4, 0.2, 0.05), 0xffe6b0, 1.5, [0, 1.0, -6.72])
            b.engine([0.8, 0.3, 6.8], 0.7, true, glow)
            break
        case 'meteor':
            b.solid(ico(1.4, 1), 0x3a2a24, [0, 0, 0], [0.4, 0.2, 0.1], [1, 0.85, 1.1])
            b.glow(ico(1.45, 0), 0xff7a2e, 1.6, [0, 0, 0.1], [0.1, 0.7, 0], [0.9, 0.7, 1.05])
            break
        case 'vault':
            b.solid(new THREE.BoxGeometry(3.4, 2.6, 4.2), 0x4a525e)
            b.solid(new THREE.BoxGeometry(3.6, 0.4, 4.4), E_DARK, [0, 1.4, 0])
            b.solid(new THREE.BoxGeometry(3.6, 0.4, 4.4), E_DARK, [0, -1.4, 0])
            for (const z of [-2.12, 2.12]) b.glow(new THREE.BoxGeometry(2.6, 0.2, 0.05), glow, 3, [0, 0, z])
            b.glow(ring(0.8, 0.08, 4, 16), glow, 3, [1.72, 0, 0], [0, Math.PI / 2, 0], [1, 1, 1], true)
            break
        case 'mine':
            b.solid(ico(0.6, 0), E_DARK)
            for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]) {
                b.solid(new THREE.ConeGeometry(0.12, 0.6, 4), E_PLATE, [d[0] * 0.7, d[1] * 0.7, d[2] * 0.7], [d[2] * Math.PI / 2, 0, -d[0] * Math.PI / 2 + (d[1] < 0 ? Math.PI : 0)])
            }
            b.glow(octa(0.25), glow, 4)
            break
    }
    const built = b.build()
    built.group.scale.setScalar(scale)
    built.radius *= scale
    return built
}

/** The sector warden: a burning core cradled by armoured petals, inside a rotating ring of blades. */
export function buildWarden(tier: number, glow: number) {
    const arms = 3 + Math.min(3, tier)
    const shellB = new ModelBuilder()
    // Core
    shellB.glow(ico(2.6, 0), glow, 4.5)
    shellB.glow(ico(1.6, 0), 0xffffff, 3, [0, 0, 0], [0.5, 0.5, 0])
    // Petals: six armour plates wrapping the core, open at the front.
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        const x = Math.cos(a) * 3.6
        const y = Math.sin(a) * 3.6
        shellB.solid(wedge(3.2, 1.2, 9, 0.35, 0.5), 0x8a7880, [x, y, 1.2], [Math.sin(a) * 0.35, -Math.cos(a) * 0.35, a + Math.PI / 2])
        shellB.solid(wedge(2.2, 0.6, 7, 0.3, 0.5), 0x2b2328, [x * 1.12, y * 1.12, 1.6], [Math.sin(a) * 0.35, -Math.cos(a) * 0.35, a + Math.PI / 2])
        shellB.glow(new THREE.BoxGeometry(0.18, 0.18, 6.5), glow, 2.6, [x * 0.82, y * 0.82, 1.0], [Math.sin(a) * 0.35, -Math.cos(a) * 0.35, 0])
    }
    // Spine and engines behind.
    shellB.solid(tube(2.2, 3.4, 6, 8), 0x3a3036, [0, 0, 7])
    shellB.solid(ring(3.6, 0.5, 4, 8), 0x8a7880, [0, 0, 9.6])
    shellB.glow(new THREE.CircleGeometry(2.4, 8), glow, 3, [0, 0, 10.05])
    shellB.glow(ring(5.4, 0.1, 4, 36), glow, 2.2, [0, 0, -2.5])
    const shell = shellB.build()

    const rb = new ModelBuilder()
    rb.solid(ring(11, 0.8, 4, 6 * arms), 0x3a3036)
    rb.glow(ring(11, 0.18, 4, 6 * arms), glow, 1.8, [0, 0, -0.75])
    for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2
        const x = Math.cos(a) * 11
        const y = Math.sin(a) * 11
        rb.solid(wedge(2.2, 2.2, 7, 0.1, 0.35), 0x8a7880, [x, y, -2], [0, 0, a])
        rb.solid(new THREE.BoxGeometry(1.2, 4, 1.2), 0x2b2328, [x * 0.9, y * 0.9, 0], [0, 0, a + Math.PI / 2])
        rb.glow(octa(0.9), glow, 4.5, [x, y, -5.8])
        rb.hardpoint([x, y, -5.6], [Math.cos(a), Math.sin(a), 0])
    }
    const ringModel = rb.build()
    const group = new THREE.Group()
    group.add(shell.group)
    const ringGroup = ringModel.group
    ringGroup.name = 'ring'
    group.add(ringGroup)
    return { group, ring: ringGroup, emitters: ringModel.hardpoints.map(h => h.position), radius: 12 }
}

// ─── Structures ────────────────────────────────────────────────────────────

export function buildCrate(color: number) {
    const b = new ModelBuilder()
    b.solid(new THREE.BoxGeometry(2, 1.4, 2.8), 0x4a525e)
    b.solid(new THREE.BoxGeometry(2.1, 0.3, 2.9), DARK, [0, 0.4, 0])
    b.glow(new THREE.BoxGeometry(2.14, 0.12, 0.12), color, 3, [0, -0.2, 1.1])
    b.glow(new THREE.BoxGeometry(2.14, 0.12, 0.12), color, 3, [0, -0.2, -1.1])
    return b.build()
}
