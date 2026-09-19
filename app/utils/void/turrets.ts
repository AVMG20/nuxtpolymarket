// Void Runner — turret and drone models.

import * as THREE from 'three'
import type { VoidTurretId } from '#shared/utils/gamelogic/void'
import { ModelBuilder, cyl, ico, octa, ring, tube, type TurretModel } from './models'
import { type Section, loft, slab, block, RED, band, shade } from './ship-kit'

// ─── Turrets ───────────────────────────────────────────────────────────────
//
// Every turret shares an armoured ring, trunnion cheeks and a service pack on
// the back; the head and the gun are its own. The weapon's colour is worn
// twice: once as light and once as a dull painted stripe.

const T_PAINT = 0x9aa3af
const T_LIGHT = 0xc9d0d8
const T_DARK = 0x2a2f37
const T_METAL = 0x69727e
const T_OCT: [number, number, number] = [8, 0.6, Math.PI / 8]

export function buildTurret(type: VoidTurretId, color: number): TurretModel {
    const tint = shade(color, 0.5)
    const root = new THREE.Group()
    const baseB = new ModelBuilder()
    baseB.metal(cyl(0.34, 0.42, 0.1, 8), T_DARK, [0, 0.05, 0], [0, Math.PI / 8, 0])
    baseB.solid(cyl(0.27, 0.31, 0.08, 12), T_PAINT, [0, 0.13, 0])
    baseB.glow(ring(0.31, 0.018, 3, 20), color, 1.6, [0, 0.115, 0], [Math.PI / 2, 0, 0])
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        baseB.metal(cyl(0.022, 0.022, 0.03, 6), T_METAL, [Math.cos(a) * 0.35, 0.095, Math.sin(a) * 0.35])
    }
    baseB.solid(block(0.16, 0.05, 0.1, 0.01), tint, [0, 0.1, -0.36])
    root.add(baseB.build().group)

    const yaw = new THREE.Group()
    yaw.position.y = 0.17
    root.add(yaw)
    const pitch = new THREE.Group()
    pitch.position.y = 0.16
    yaw.add(pitch)
    const yawB = new ModelBuilder()
    const headB = new ModelBuilder()
    const barrelB = new ModelBuilder()
    const barrel = new THREE.Group()
    let muzzle = new THREE.Vector3(0, 0, -0.7)
    // Trunnion cheeks either side of the elevating head, a pivot pin through them, and the service pack behind.
    yawB.metal(slab([[0, -0.15], [0.16, -0.15], [0.3, -0.05], [0.3, 0.09], [0.14, 0.17], [0, 0.17]], 0.07, 0.012), T_DARK, [0.235, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], true)
    yawB.metal(cyl(0.05, 0.05, 0.03, 8), T_METAL, [0.275, 0.16, 0], [0, 0, Math.PI / 2], [1, 1, 1], true)
    yawB.glow(cyl(0.022, 0.022, 0.035, 6), color, 2, [0.28, 0.16, 0], [0, 0, Math.PI / 2], [1, 1, 1], true)
    yawB.solid(block(0.34, 0.12, 0.12, 0.02), T_PAINT, [0, 0.04, 0.24])
    yawB.metal(new THREE.BoxGeometry(0.26, 0.015, 0.125), T_DARK, [0, 0.07, 0.24])
    yawB.metal(cyl(0.012, 0.012, 0.22, 4), T_METAL, [-0.2, 0.26, 0.2])
    yawB.glow(octa(0.025), RED, 3, [-0.2, 0.38, 0.2])

    switch (type) {
        case 'pulse': {
            const head: Section[] = [
                { z: -0.32, w: 0.13, h: 0.09 },
                { z: -0.16, w: 0.19, h: 0.135 },
                { z: 0.2, w: 0.19, h: 0.135 },
                { z: 0.3, w: 0.14, h: 0.1 }
            ]
            headB.solid(loft(head, ...T_OCT), T_LIGHT)
            band(headB, head, -0.02, 0.1, tint, T_OCT, 0.006)
            band(headB, head, 0.14, 0.17, T_DARK, T_OCT, 0.006)
            headB.glow(new THREE.BoxGeometry(0.02, 0.02, 0.3), color, 1.8, [0.155, 0.085, -0.02], [0, 0, 0], [1, 1, 1], true)
            // Capacitors slung either side, a sight on top.
            headB.metal(tube(0.045, 0.045, 0.26, 8), T_DARK, [0.2, -0.04, 0.02], [0, 0, 0], [1, 1, 1], true)
            headB.glow(tube(0.03, 0.03, 0.27, 6), color, 1.4, [0.2, -0.04, 0.02], [0, 0, 0], [1, 1, 1], true)
            headB.metal(block(0.05, 0.05, 0.16, 0.008), T_DARK, [0, 0.16, -0.05])
            headB.glow(new THREE.CircleGeometry(0.016, 6).rotateY(Math.PI), color, 3, [0, 0.16, -0.135])
            barrelB.metal(tube(0.04, 0.055, 0.55, 8), T_METAL, [0, 0.01, -0.5])
            barrelB.metal(tube(0.07, 0.075, 0.2, 8), T_DARK, [0, 0.01, -0.36])
            for (let i = 0; i < 3; i++) barrelB.metal(ring(0.058, 0.012, 3, 10), T_DARK, [0, 0.01, -0.52 - i * 0.06])
            barrelB.metal(tube(0.07, 0.07, 0.07, 8), T_DARK, [0, 0.01, -0.74])
            barrelB.glow(tube(0.03, 0.03, 0.02, 8), color, 3, [0, 0.01, -0.78])
            muzzle = new THREE.Vector3(0, 0.01, -0.8)
            break
        }
        case 'gatling':
            headB.solid(block(0.34, 0.28, 0.42, 0.04), T_PAINT)
            headB.solid(block(0.35, 0.06, 0.3, 0.01), tint, [0, 0.06, 0.02])
            // Ammo drum and feed chute on the right, motor housing on the left.
            headB.metal(cyl(0.13, 0.13, 0.16, 12), T_DARK, [0.26, -0.02, 0.06], [0, 0, Math.PI / 2])
            headB.solid(cyl(0.1, 0.1, 0.17, 12), tint, [0.26, -0.02, 0.06], [0, 0, Math.PI / 2])
            headB.metal(block(0.07, 0.05, 0.26, 0.01), T_METAL, [0.2, 0.06, -0.14], [0.3, 0, 0])
            headB.metal(block(0.1, 0.16, 0.22, 0.02), T_DARK, [-0.22, 0, 0.08])
            headB.glow(new THREE.BoxGeometry(0.01, 0.08, 0.12), color, 1.6, [-0.275, 0, 0.08])
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2
                barrelB.metal(tube(0.02, 0.02, 0.64, 5), T_METAL, [Math.cos(a) * 0.065, Math.sin(a) * 0.065, -0.5])
            }
            barrelB.metal(tube(0.03, 0.03, 0.6, 6), T_DARK, [0, 0, -0.48])
            for (const z of [-0.28, -0.5, -0.74]) barrelB.metal(cyl(0.1, 0.1, 0.035, 10), T_DARK, [0, 0, z], [Math.PI / 2, 0, 0])
            barrelB.glow(ring(0.1, 0.012, 3, 12), color, 2.2, [0, 0, -0.245])
            barrelB.glow(ring(0.05, 0.01, 3, 10), color, 2.6, [0, 0, -0.825])
            muzzle = new THREE.Vector3(0, 0, -0.82)
            break
        case 'flak':
            headB.solid(block(0.56, 0.3, 0.48, 0.05), T_PAINT)
            headB.metal(block(0.12, 0.22, 0.3, 0.02), T_DARK, [0.34, 0, 0.05], [0, 0, 0], [1, 1, 1], true)
            // Sloped mantlet up front, shell lockers on the flanks, a ranging dish on the roof.
            headB.solid(slab([[-0.3, 0], [0.3, 0], [0.26, 0.2], [-0.26, 0.2]], 0.06, 0.012), tint, [0, 0, -0.27], [-1.1, 0, 0])
            headB.solid(block(0.13, 0.08, 0.2, 0.012), T_LIGHT, [0.34, 0.14, 0.06], [0, 0, 0], [1, 1, 1], true)
            headB.metal(cyl(0.015, 0.02, 0.1, 5), T_DARK, [0.16, 0.2, 0.12])
            headB.metal(new THREE.ConeGeometry(0.08, 0.035, 8, 1, true).rotateX(Math.PI), T_METAL, [0.16, 0.26, 0.12], [0.5, 0, 0])
            headB.glow(new THREE.BoxGeometry(0.44, 0.025, 0.025), color, 2.2, [0, 0.16, -0.12])
            barrelB.metal(tube(0.07, 0.085, 0.46, 8), T_METAL, [0.13, 0, -0.42], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(tube(0.105, 0.105, 0.16, 8), T_DARK, [0.13, 0, -0.32], [0, 0, 0], [1, 1, 1], true)
            for (let i = 0; i < 2; i++) barrelB.metal(ring(0.09, 0.014, 3, 10), T_DARK, [0.13, 0, -0.47 - i * 0.07], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(new THREE.ConeGeometry(0.12, 0.1, 8, 1, true).rotateX(Math.PI / 2), T_DARK, [0.13, 0, -0.67], [0, 0, 0], [1, 1, 1], true)
            barrelB.glow(tube(0.05, 0.05, 0.01, 8), color, 2.4, [0.13, 0, -0.645], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(block(0.3, 0.04, 0.05, 0.008), T_DARK, [0, 0, -0.4])
            muzzle = new THREE.Vector3(0, 0, -0.7)
            break
        case 'beam':
            headB.metal(ico(0.2, 1), T_LIGHT, [0, 0, 0], [0, 0, 0], [1, 0.85, 1.25])
            headB.solid(ring(0.2, 0.025, 4, 14), tint, [0, 0, 0.04], [0, 0, 0], [1, 0.85, 1])
            headB.solid(block(0.04, 0.18, 0.34, 0.01), T_DARK, [0.22, 0, 0.05], [0, 0, 0], [1, 1, 1], true)
            // Heat sink fins down the back.
            for (let i = 0; i < 4; i++) headB.metal(block(0.3 - i * 0.04, 0.26 - i * 0.03, 0.02, 0.004), T_DARK, [0, 0, 0.16 + i * 0.045])
            headB.glow(new THREE.BoxGeometry(0.16, 0.02, 0.15), color, 1.5, [0, 0.0, 0.25])
            // Focusing claws around a crystal.
            barrelB.metal(tube(0.07, 0.13, 0.2, 8), T_DARK, [0, 0, -0.27])
            for (let i = 0; i < 3; i++) {
                const a = (i / 3) * Math.PI * 2 + Math.PI / 2
                barrelB.metal(block(0.035, 0.05, 0.42, 0.006), T_METAL, [Math.cos(a) * 0.1, Math.sin(a) * 0.1, -0.42], [0, 0, a + Math.PI / 2])
                barrelB.solid(block(0.04, 0.055, 0.1, 0.006), tint, [Math.cos(a) * 0.1, Math.sin(a) * 0.1, -0.58], [0, 0, a + Math.PI / 2])
            }
            for (let i = 0; i < 3; i++) barrelB.glow(ring(0.06 - i * 0.012, 0.01, 3, 12), color, 2.4, [0, 0, -0.34 - i * 0.07])
            barrelB.glow(octa(0.06), color, 4.5, [0, 0, -0.57], [0, 0, 0], [1, 1, 1.6])
            muzzle = new THREE.Vector3(0, 0, -0.66)
            break
        case 'missile':
            headB.metal(block(0.22, 0.2, 0.28, 0.03), T_DARK)
            barrelB.solid(block(0.56, 0.36, 0.56, 0.05), T_PAINT, [0, 0.02, -0.12])
            barrelB.solid(block(0.58, 0.07, 0.2, 0.01), tint, [0, 0.02, -0.22])
            for (let k = 0; k < 4; k++) barrelB.solid(block(0.06, 0.372, 0.06, 0.004), k % 2 ? T_DARK : 0xe8c33a, [-0.25 + k * 0.035, 0.02, 0.1 - k * 0.0])
            barrelB.metal(block(0.5, 0.025, 0.4, 0.008), T_LIGHT, [0, 0.215, -0.14])
            barrelB.metal(block(0.04, 0.3, 0.5, 0.008), T_DARK, [0.3, 0.02, -0.12], [0, 0, 0], [1, 1, 1], true)
            for (let i = 0; i < 6; i++) {
                const x = -0.16 + (i % 3) * 0.16
                const y = i < 3 ? 0.1 : -0.06
                barrelB.metal(tube(0.065, 0.065, 0.05, 8), T_DARK, [x, y + 0.02, -0.41])
                barrelB.solid(new THREE.ConeGeometry(0.04, 0.07, 8).rotateX(-Math.PI / 2), i % 2 ? T_LIGHT : tint, [x, y + 0.02, -0.43])
                barrelB.glow(ring(0.052, 0.008, 3, 8), color, 2.4, [x, y + 0.02, -0.438])
                barrelB.glow(new THREE.CircleGeometry(0.03, 6), 0xff7a2e, 0.9, [x, y + 0.02, 0.163])
            }
            barrelB.glow(new THREE.BoxGeometry(0.58, 0.02, 0.02), color, 1.6, [0, 0.21, 0.1])
            muzzle = new THREE.Vector3(0, 0.02, -0.48)
            break
        case 'tesla':
            headB.metal(cyl(0.2, 0.24, 0.2, 10), T_DARK)
            headB.solid(cyl(0.16, 0.2, 0.08, 10), T_PAINT, [0, 0.12, 0])
            headB.solid(cyl(0.205, 0.215, 0.05, 10), tint, [0, 0.02, 0])
            // Capacitor banks on the shoulders.
            for (const z of [-0.06, 0.08]) {
                headB.metal(cyl(0.04, 0.04, 0.16, 8), T_METAL, [0.2, 0.1, z], [0, 0, 0], [1, 1, 1], true)
                headB.glow(cyl(0.025, 0.025, 0.01, 6), color, 2.4, [0.2, 0.185, z], [0, 0, 0], [1, 1, 1], true)
            }
            // A coil stack of ceramic insulators and live rings, with a caged ball at the tip.
            barrelB.metal(tube(0.04, 0.06, 0.52, 8), T_METAL, [0, 0.02, -0.34])
            for (let i = 0; i < 4; i++) {
                barrelB.solid(tube(0.1 - i * 0.012, 0.115 - i * 0.012, 0.035, 10), 0xd8d2c0, [0, 0.02, -0.12 - i * 0.12])
                barrelB.glow(ring(0.105 - i * 0.012, 0.012, 3, 14), color, 2.6, [0, 0.02, -0.18 - i * 0.12])
            }
            barrelB.glow(ico(0.085, 1), color, 5, [0, 0.02, -0.68])
            for (let i = 0; i < 3; i++) {
                const a = (i / 3) * Math.PI * 2 + Math.PI / 2
                barrelB.metal(block(0.02, 0.02, 0.2, 0.004), T_METAL, [Math.cos(a) * 0.12, 0.02 + Math.sin(a) * 0.12, -0.6], [Math.sin(a) * 0.35, -Math.cos(a) * 0.35, 0])
                barrelB.metal(octa(0.025), T_DARK, [Math.cos(a) * 0.085, 0.02 + Math.sin(a) * 0.085, -0.71])
            }
            muzzle = new THREE.Vector3(0, 0.02, -0.7)
            break
        case 'mortar':
            headB.solid(block(0.58, 0.34, 0.5, 0.06), T_PAINT)
            headB.metal(block(0.1, 0.26, 0.36, 0.02), T_DARK, [0.34, 0, 0.02], [0, 0, 0], [1, 1, 1], true)
            headB.solid(block(0.4, 0.36, 0.16, 0.02), tint, [0, 0, 0.12])
            // Ready rack of shells on the left shoulder.
            for (let i = 0; i < 3; i++) {
                headB.metal(cyl(0.04, 0.04, 0.14, 8), T_METAL, [-0.2 + i * 0.0, 0.22, -0.1 + i * 0.1], [0, 0, Math.PI / 2])
                headB.glow(cyl(0.03, 0.03, 0.01, 6), color, 2, [-0.275, 0.22, -0.1 + i * 0.1], [0, 0, Math.PI / 2])
            }
            headB.glow(new THREE.BoxGeometry(0.5, 0.024, 0.024), color, 1.8, [0, 0.19, 0.21])
            // One fat, short tube between recoil cylinders, with a slotted brake.
            barrelB.metal(tube(0.14, 0.16, 0.6, 12), T_METAL, [0, 0.03, -0.42])
            for (const z of [-0.3, -0.5]) barrelB.metal(tube(0.175, 0.175, 0.05, 12), T_DARK, [0, 0.03, z])
            barrelB.metal(tube(0.035, 0.035, 0.42, 6), T_LIGHT, [0.2, 0.03, -0.3], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(tube(0.05, 0.05, 0.16, 6), T_DARK, [0.2, 0.03, -0.2], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(tube(0.19, 0.19, 0.14, 12), T_DARK, [0, 0.03, -0.74])
            for (const y of [0.12, -0.06]) barrelB.glow(new THREE.BoxGeometry(0.4, 0.025, 0.06), color, 1.6, [0, y, -0.74])
            barrelB.glow(ring(0.15, 0.02, 3, 16), color, 2.4, [0, 0.03, -0.815])
            muzzle = new THREE.Vector3(0, 0.03, -0.84)
            break
        case 'rail':
            headB.solid(block(0.38, 0.26, 0.56, 0.04), T_PAINT)
            headB.metal(block(0.1, 0.14, 0.4, 0.02), T_DARK, [0.24, 0.02, 0.05], [0, 0, 0], [1, 1, 1], true)
            headB.solid(block(0.39, 0.05, 0.2, 0.008), tint, [0, 0.08, 0.1])
            // Capacitor cells across the roof and a power trunk out the back.
            for (let i = 0; i < 3; i++) {
                headB.metal(block(0.22, 0.06, 0.1, 0.01), T_DARK, [0, 0.16, -0.16 + i * 0.15])
                headB.glow(new THREE.BoxGeometry(0.16, 0.02, 0.05), color, 2.2, [0, 0.195, -0.16 + i * 0.15])
            }
            headB.metal(tube(0.05, 0.05, 0.14, 8), T_METAL, [0, -0.02, 0.33])
            barrelB.metal(block(0.05, 0.11, 1.15, 0.01), T_METAL, [0.078, 0, -0.66], [0, 0, 0], [1, 1, 1], true)
            barrelB.solid(block(0.056, 0.115, 0.16, 0.008), tint, [0.078, 0, -0.95], [0, 0, 0], [1, 1, 1], true)
            barrelB.glow(new THREE.BoxGeometry(0.03, 0.03, 1.05), color, 3, [0, 0, -0.64])
            for (let i = 0; i < 5; i++) {
                barrelB.metal(block(0.22, 0.03, 0.05, 0.005), T_DARK, [0, 0.065, -0.2 - i * 0.22])
                barrelB.metal(block(0.22, 0.03, 0.05, 0.005), T_DARK, [0, -0.065, -0.2 - i * 0.22])
            }
            barrelB.metal(slab([[0, 0], [0.08, 0.03], [0.08, 0.15], [0, 0.12]], 0.02, 0.004), T_DARK, [0.1, 0, -1.26], [0, 0, 0], [1, 1, 1], true)
            barrelB.glow(octa(0.03), color, 4, [0, 0, -1.2])
            muzzle = new THREE.Vector3(0, 0, -1.25)
            break
    }
    yaw.add(yawB.build().group)
    pitch.add(headB.build().group)
    barrel.add(barrelB.build().group)
    pitch.add(barrel)
    return { root, yaw, pitch, barrel, muzzle }
}

/** An escort drone: a dart of a fuselage under a twin-boom tail, a gun under the chin and an eye that matches its mothership. */
export function buildDrone(color: number): THREE.Group {
    const tint = shade(color, 0.5)
    const b = new ModelBuilder()
    const body: Section[] = [
        { z: -0.6, w: 0.03, h: 0.03 },
        { z: -0.25, w: 0.17, h: 0.12 },
        { z: 0.28, w: 0.21, h: 0.14 },
        { z: 0.46, w: 0.15, h: 0.1 }
    ]
    b.solid(loft(body, 8, 0.7, Math.PI / 8), T_LIGHT)
    band(b, body, -0.02, 0.08, tint, [8, 0.7, Math.PI / 8], 0.006)
    band(b, body, 0.3, 0.36, T_DARK, [8, 0.7, Math.PI / 8], 0.006)
    b.glass(loft([{ z: -0.4, w: 0.02, h: 0.02, y: 0.06 }, { z: -0.22, w: 0.09, h: 0.06, y: 0.1 }, { z: 0.02, w: 0.06, h: 0.03, y: 0.12 }], 6, 0.9), 0x0a0f18)
    // Cranked wings: a dark inner panel, a light outer one canted down, lit tips.
    b.solid(slab([[0.12, -0.12], [0.42, 0.08], [0.42, 0.34], [0.14, 0.36]], 0.045, 0.01), T_DARK, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
    b.solid(slab([[0, 0.1], [0.3, 0.26], [0.3, 0.4], [0, 0.34]], 0.03, 0.008), T_LIGHT, [0.41, 0, 0], [0, 0, -0.45], [1, 1, 1], true)
    b.solid(slab([[0.18, 0.2], [0.3, 0.26], [0.3, 0.4], [0.18, 0.37]], 0.036, 0.008), tint, [0.41, 0, 0], [0, 0, -0.45], [1, 1, 1], true)
    b.glow(new THREE.BoxGeometry(0.025, 0.025, 0.16), color, 3, [0.69, -0.135, 0.33], [0, 0, 0], [1, 1, 1], true)
    // Twin tail booms and fins.
    b.metal(tube(0.03, 0.03, 0.4, 6), T_DARK, [0.2, 0.03, 0.42], [0, 0, 0], [1, 1, 1], true)
    b.solid(slab([[0, 0], [0.2, 0.1], [0.22, 0.22], [0, 0.2]], 0.025, 0.006), T_LIGHT, [0.2, 0.04, 0.42], [0, 0, Math.PI / 2 - 0.3], [1, 1, 1], true)
    b.glow(new THREE.BoxGeometry(0.015, 0.1, 0.015), color, 2.4, [0.262, 0.2, 0.63], [0, 0, -0.3], [1, 1, 1], true)
    // Chin gun and sensor eye.
    b.metal(block(0.08, 0.06, 0.2, 0.01), T_DARK, [0, -0.13, -0.1])
    b.metal(tube(0.018, 0.022, 0.32, 6), T_METAL, [0, -0.14, -0.34])
    b.glow(tube(0.012, 0.012, 0.01, 6), color, 3, [0, -0.14, -0.5])
    b.glow(octa(0.05), color, 3.5, [0, 0, -0.6])
    b.metal(ring(0.045, 0.012, 3, 8), T_DARK, [0, 0, -0.55])
    // Drive.
    b.metal(tube(0.13, 0.15, 0.1, 8), T_DARK, [0, 0, 0.5])
    b.glow(new THREE.CircleGeometry(0.1, 8), color, 2.5, [0, 0, 0.555])
    b.glow(new THREE.CircleGeometry(0.02, 6), color, 2.5, [0.2, 0.03, 0.625], [0, 0, 0], [1, 1, 1], true)
    return b.build().group
}
