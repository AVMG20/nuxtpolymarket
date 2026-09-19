// Void Runner — turret and drone models.

import * as THREE from 'three'
import type { VoidTurretId } from '#shared/utils/gamelogic/void'
import { ModelBuilder, cyl, ico, octa, ring, tube, type TurretModel } from './models'
import { type Section, loft, slab, block, RED, GREEN, band, shade } from './ship-kit'

// ─── Turrets ───────────────────────────────────────────────────────────────
//
// Every turret is naval hardware in three layers: a bolted barbette on the
// hull, a traversing carriage with trunnion cheeks and a service bustle, and
// an elevating gun that is entirely its own. Each is meant to be told apart by
// silhouette alone. The weapon's colour is worn twice: once as light and once
// as a dull painted stripe.

const T_PAINT = 0x9aa3af
const T_LIGHT = 0xc9d0d8
const T_ARMOR = 0x7a8490
const T_DARK = 0x2a2f37
const T_BLACK = 0x15181d
const T_METAL = 0x69727e
const T_HAZARD = 0xe8c33a
const T_CERAMIC = 0xd8d2c0
const T_OCT: [number, number, number] = [8, 0.6, Math.PI / 8]

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
/** A cylinder wall with no caps, for bands and collars whose ends are never seen. */
const hoop = (rTop: number, rBottom: number, h: number, segments = 12) => new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, true)
/** The same along Z: shrouds, sleeves and jackets around a barrel. */
const sleeve = (rFront: number, rBack: number, l: number, segments = 8) => hoop(rFront, rBack, l, segments).rotateX(-Math.PI / 2)
/** A disc facing down the barrel (-Z): bores, lenses, tube mouths. */
const bore = (r: number, segments = 8) => new THREE.CircleGeometry(r, segments).rotateY(Math.PI)

/** The fixed barbette: a bolted flange, an armoured skirt with four buttresses, the lit traverse ring and a power conduit. */
function barbette(b: ModelBuilder, color: number, tint: number) {
    b.metal(cyl(0.43, 0.44, 0.03, 12), T_DARK, [0, 0.015, 0], [0, Math.PI / 12, 0])
    b.metal(hoop(0.33, 0.4, 0.07, 12), T_METAL, [0, 0.065, 0], [0, Math.PI / 12, 0])
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8
        b.metal(cyl(0.016, 0.022, 0.03, 5), T_LIGHT, [Math.cos(a) * 0.412, 0.04, Math.sin(a) * 0.412])
    }
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        b.solid(block(0.13, 0.09, 0.2, 0.025), T_ARMOR, [Math.sin(a) * 0.37, 0.06, Math.cos(a) * 0.37], [0, a, 0])
    }
    b.solid(hoop(0.31, 0.33, 0.07, 16), T_PAINT, [0, 0.125, 0])
    b.glow(hoop(0.318, 0.326, 0.014, 16), color, 1.7, [0, 0.118, 0])
    b.metal(cyl(0.325, 0.325, 0.02, 16), T_DARK, [0, 0.16, 0])
    // Power comes up the back through a painted conduit box.
    b.solid(block(0.18, 0.07, 0.12, 0.015), tint, [0, 0.085, 0.4])
    b.glow(box(0.03, 0.02, 0.01), color, 3, [0.05, 0.095, 0.462])
    b.glow(box(0.03, 0.02, 0.01), RED, 2.4, [-0.05, 0.095, 0.462])
}

/** The traversing carriage: turntable, trunnion cheeks with pivot caps, and the bustle of electronics behind the gun. */
function carriage(b: ModelBuilder, color: number, tint: number) {
    b.metal(cyl(0.285, 0.305, 0.04, 12), T_DARK, [0, 0.005, 0])
    const cheek: [number, number][] = [[0, -0.16], [0.13, -0.16], [0.29, -0.05], [0.3, 0.08], [0.15, 0.19], [0, 0.19]]
    b.solid(slab(cheek, 0.06, 0.012), T_ARMOR, [0.235, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], true)
    b.solid(slab([[0.03, -0.11], [0.12, -0.11], [0.22, -0.03], [0.22, 0.06], [0.12, 0.14], [0.03, 0.14]], 0.02, 0.006), T_LIGHT, [0.275, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], true)
    b.metal(cyl(0.05, 0.058, 0.03, 8), T_METAL, [0.295, 0.16, 0], [0, 0, -Math.PI / 2], [1, 1, 1], true)
    b.glow(new THREE.CircleGeometry(0.024, 6).rotateY(Math.PI / 2), color, 2.4, [0.3115, 0.16, 0], [0, 0, 0], [1, 1, 1], true)
    // Bustle: a vented electronics pack, a whip aerial, a sensor dome and the cable run down into the barbette.
    b.solid(block(0.36, 0.11, 0.12, 0.02), T_PAINT, [0, 0.075, 0.27])
    b.solid(block(0.12, 0.115, 0.125, 0.01), tint, [-0.09, 0.075, 0.27])
    for (let i = 0; i < 3; i++) b.metal(box(0.12, 0.012, 0.01), T_BLACK, [0.08, 0.05 + i * 0.025, 0.332])
    b.metal(sleeve(0.018, 0.018, 0.16, 5), T_BLACK, [0.13, 0.03, 0.34], [0.9, 0, 0])
    b.metal(sleeve(0.018, 0.018, 0.16, 5), T_BLACK, [0.09, 0.03, 0.34], [0.9, 0, 0])
    b.metal(cyl(0.006, 0.01, 0.26, 4), T_METAL, [-0.15, 0.26, 0.27])
    b.glow(octa(0.02), RED, 3, [-0.15, 0.4, 0.27])
    b.metal(ico(0.042), T_LIGHT, [0.12, 0.14, 0.27])
}

export function buildTurret(type: VoidTurretId, color: number): TurretModel {
    const tint = shade(color, 0.5)
    const root = new THREE.Group()
    const baseB = new ModelBuilder()
    barbette(baseB, color, tint)
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
    carriage(yawB, color, tint)

    switch (type) {
        case 'pulse': {
            // A sleek faceted gun house around one energy cannon: capacitors on the flanks, a vented jacket showing the hot barrel.
            const head: Section[] = [
                { z: -0.33, w: 0.11, h: 0.08 },
                { z: -0.17, w: 0.19, h: 0.14 },
                { z: 0.17, w: 0.19, h: 0.14 },
                { z: 0.27, w: 0.13, h: 0.09 }
            ]
            headB.solid(loft(head, ...T_OCT), T_LIGHT)
            band(headB, head, -0.04, 0.08, tint, T_OCT, 0.006)
            band(headB, head, 0.12, 0.15, T_DARK, T_OCT, 0.005)
            band(headB, head, -0.33, -0.27, T_DARK, T_OCT, 0.012)
            headB.solid(block(0.16, 0.025, 0.14, 0.008), T_PAINT, [0, 0.145, 0.04])
            headB.metal(cyl(0.02, 0.02, 0.015, 5), T_METAL, [0.04, 0.163, 0.07])
            headB.metal(block(0.05, 0.05, 0.15, 0.008), T_DARK, [-0.07, 0.165, -0.08])
            headB.glow(bore(0.016, 6), color, 3, [-0.07, 0.165, -0.157])
            headB.glow(box(0.015, 0.015, 0.26), color, 1.8, [0.163, 0.08, 0], [0, 0, 0], [1, 1, 1], true)
            headB.metal(tube(0.05, 0.05, 0.28, 6), T_DARK, [0.2, -0.05, 0], [0, 0, 0], [1, 1, 1], true)
            for (const z of [-0.08, 0, 0.08]) headB.glow(sleeve(0.053, 0.053, 0.03, 6), color, 1.6, [0.2, -0.05, z], [0, 0, 0], [1, 1, 1], true)
            headB.metal(sleeve(0.015, 0.015, 0.14, 4), T_BLACK, [0.17, -0.02, 0.19], [0, 0.5, 0], [1, 1, 1], true)
            // Recoil sleeve, barrel, slotted cooling jacket and a two-baffle brake.
            barrelB.metal(tube(0.075, 0.085, 0.16, 8), T_DARK, [0, 0.01, -0.36])
            barrelB.metal(tube(0.036, 0.048, 0.5, 8), T_METAL, [0, 0.01, -0.56])
            barrelB.metal(sleeve(0.062, 0.062, 0.2, 8), T_ARMOR, [0, 0.01, -0.56])
            for (const z of [-0.455, -0.665]) barrelB.metal(tube(0.068, 0.068, 0.02, 8), T_DARK, [0, 0.01, z])
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2 + Math.PI / 4
                barrelB.glow(box(0.012, 0.006, 0.15), color, 2.2, [Math.cos(a) * 0.062, 0.01 + Math.sin(a) * 0.062, -0.56], [0, 0, a + Math.PI / 2])
            }
            barrelB.metal(block(0.17, 0.07, 0.035, 0.008), T_DARK, [0, 0.01, -0.75])
            barrelB.metal(block(0.15, 0.07, 0.03, 0.008), T_DARK, [0, 0.01, -0.805])
            barrelB.glow(bore(0.028), color, 3, [0, 0.01, -0.822])
            muzzle = new THREE.Vector3(0, 0.01, -0.83)
            break
        }
        case 'gatling': {
            // A rotary cannon in an open cradle: six barrels, a drum magazine with a feed chute, a finned drive motor.
            headB.solid(block(0.24, 0.22, 0.42, 0.03), T_PAINT, [0, 0, 0.03])
            headB.solid(block(0.245, 0.05, 0.2, 0.01), tint, [0, 0.07, 0.08])
            headB.metal(block(0.16, 0.03, 0.16, 0.008), T_DARK, [0, 0.12, -0.06])
            headB.solid(slab([[-0.17, 0], [0.17, 0], [0.13, 0.17], [-0.13, 0.17]], 0.03, 0.008), T_ARMOR, [0, -0.04, -0.2], [-1.25, 0, 0])
            // Drum on the right, its chute climbing over into the breech.
            headB.metal(cyl(0.15, 0.15, 0.13, 12), T_DARK, [0.23, -0.03, 0.1], [0, 0, Math.PI / 2])
            headB.solid(cyl(0.12, 0.12, 0.14, 12), tint, [0.235, -0.03, 0.1], [0, 0, Math.PI / 2])
            headB.metal(cyl(0.04, 0.04, 0.16, 6), T_METAL, [0.235, -0.03, 0.1], [0, 0, Math.PI / 2])
            for (let i = 0; i < 4; i++) {
                const t = i / 3
                headB.metal(block(0.07, 0.035, 0.075, 0.006), i % 2 ? T_METAL : T_ARMOR, [0.22 - t * 0.14, 0.12 + Math.sin(t * Math.PI) * 0.05, 0.06 - t * 0.12], [0.5 * t, 0, 0.9 - t * 0.9])
            }
            // Motor on the left, spent cases out the bottom.
            headB.metal(tube(0.075, 0.075, 0.22, 8), T_DARK, [-0.19, -0.01, 0.1])
            for (let i = 0; i < 4; i++) headB.metal(tube(0.095, 0.095, 0.012, 8), T_METAL, [-0.19, -0.01, 0.03 + i * 0.045])
            headB.glow(bore(0.03, 6), color, 2, [-0.19, -0.01, -0.012])
            headB.metal(block(0.08, 0.1, 0.06, 0.008), T_BLACK, [0.06, -0.14, -0.06], [0.4, 0, 0])
            barrelB.metal(tube(0.11, 0.12, 0.12, 10), T_DARK, [0, 0, -0.26])
            barrelB.glow(sleeve(0.113, 0.113, 0.014, 10), color, 2.2, [0, 0, -0.3])
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2
                barrelB.metal(sleeve(0.02, 0.023, 0.56, 5), T_METAL, [Math.cos(a) * 0.068, Math.sin(a) * 0.068, -0.58])
                barrelB.glow(bore(0.013, 5), color, 2.6, [Math.cos(a) * 0.068, Math.sin(a) * 0.068, -0.862])
            }
            barrelB.metal(sleeve(0.032, 0.032, 0.54, 6), T_BLACK, [0, 0, -0.57])
            for (const z of [-0.45, -0.64]) barrelB.metal(tube(0.1, 0.1, 0.03, 10), T_DARK, [0, 0, z])
            barrelB.metal(tube(0.1, 0.105, 0.05, 10), T_ARMOR, [0, 0, -0.835])
            muzzle = new THREE.Vector3(0, 0, -0.87)
            break
        }
        case 'flak': {
            // A quad anti-air mount: wide armoured house, four short barrels with flash cones, a rangefinder bar and a ranging dish.
            headB.solid(block(0.54, 0.27, 0.42, 0.04), T_PAINT, [0, 0, 0.04])
            headB.solid(slab([[-0.27, 0], [0.27, 0], [0.22, 0.26], [-0.22, 0.26]], 0.05, 0.012), tint, [0, -0.11, -0.23], [-1.05, 0, 0])
            headB.metal(box(0.012, 0.2, 0.3), T_BLACK, [0, 0.04, 0.06])
            headB.solid(block(0.12, 0.2, 0.3, 0.02), T_ARMOR, [0.31, -0.01, 0.06], [0, 0, 0], [1, 1, 1], true)
            headB.solid(block(0.13, 0.05, 0.2, 0.01), T_LIGHT, [0.31, 0.11, 0.08], [0, 0, 0], [1, 1, 1], true)
            // Optical rangefinder across the roof, dish behind it.
            headB.metal(tube(0.028, 0.028, 0.78, 6), T_DARK, [0, 0.165, 0.02], [0, Math.PI / 2, 0])
            headB.glow(bore(0.02, 6), color, 3, [0.39, 0.165, -0.002], [0, 0, 0], [1, 1, 1], true)
            headB.metal(box(0.05, 0.05, 0.05), T_METAL, [0.39, 0.165, 0.02], [0, 0, 0], [1, 1, 1], true)
            headB.metal(cyl(0.015, 0.02, 0.1, 5), T_DARK, [-0.12, 0.2, 0.16])
            headB.metal(new THREE.ConeGeometry(0.09, 0.04, 8, 1, true).rotateX(Math.PI), T_METAL, [-0.12, 0.27, 0.16], [0.6, 0, 0])
            headB.metal(new THREE.ConeGeometry(0.09, 0.04, 8, 1, true), T_DARK, [-0.12, 0.268, 0.158], [0.6 + Math.PI, 0, 0])
            headB.glow(octa(0.016), color, 3, [-0.12, 0.3, 0.13])
            headB.glow(box(0.3, 0.02, 0.02), color, 2, [0, 0.14, -0.13])
            for (const y of [0.075, -0.075]) {
                barrelB.metal(tube(0.06, 0.065, 0.14, 6), T_DARK, [0.11, y, -0.29], [0, 0, 0], [1, 1, 1], true)
                barrelB.metal(tube(0.034, 0.044, 0.34, 6), T_METAL, [0.11, y, -0.47], [0, 0, 0], [1, 1, 1], true)
                barrelB.metal(tube(0.052, 0.052, 0.03, 6), T_DARK, [0.11, y, -0.5], [0, 0, 0], [1, 1, 1], true)
                barrelB.metal(new THREE.ConeGeometry(0.075, 0.1, 6, 1, true).rotateX(Math.PI / 2), T_DARK, [0.11, y, -0.68], [0, 0, 0], [1, 1, 1], true)
                barrelB.glow(bore(0.04, 6), color, 2.2, [0.11, y, -0.665], [0, 0, 0], [1, 1, 1], true)
            }
            barrelB.metal(block(0.32, 0.22, 0.04, 0.008), T_ARMOR, [0, 0, -0.4])
            barrelB.metal(block(0.06, 0.26, 0.05, 0.008), T_DARK, [0, 0, -0.4])
            muzzle = new THREE.Vector3(0, 0, -0.74)
            break
        }
        case 'beam': {
            // A cutting laser: gimballed ball housing, finned emitter body, a big lens and three focusing claws around a crystal.
            headB.metal(ico(0.19, 1), T_LIGHT, [0, 0, 0.02], [0, 0, 0], [1, 0.9, 1.15])
            headB.solid(hoop(0.2, 0.2, 0.06, 12).rotateX(Math.PI / 2), tint, [0, 0, 0.02], [0, 0, 0], [1, 0.92, 1])
            headB.solid(block(0.035, 0.2, 0.3, 0.01), T_DARK, [0.2, 0, 0.03], [0, 0, 0], [1, 1, 1], true)
            // Coolant bottle and hose on the right, heat sink down the back.
            headB.solid(tube(0.05, 0.05, 0.2, 6), T_PAINT, [0.27, -0.03, 0.05])
            headB.metal(tube(0.055, 0.055, 0.03, 6), T_METAL, [0.27, -0.03, 0.0])
            headB.glow(bore(0.03, 6), color, 1.6, [0.27, -0.03, -0.052])
            headB.metal(sleeve(0.014, 0.014, 0.2, 4), T_BLACK, [0.2, 0.06, -0.12], [0.2, 0.75, 0])
            for (let i = 0; i < 4; i++) headB.metal(box(0.28 - i * 0.04, 0.24 - i * 0.03, 0.018), T_DARK, [0, 0, 0.17 + i * 0.04])
            headB.glow(box(0.14, 0.02, 0.13), color, 1.5, [0, 0, 0.24])
            barrelB.metal(tube(0.085, 0.1, 0.32, 8), T_DARK, [0, 0, -0.34])
            for (let i = 0; i < 5; i++) barrelB.metal(tube(0.135 - i * 0.004, 0.135 - i * 0.004, 0.014, 10), T_METAL, [0, 0, -0.24 - i * 0.045])
            barrelB.metal(sleeve(0.15, 0.1, 0.1, 10), T_ARMOR, [0, 0, -0.52])
            barrelB.metal(sleeve(0.155, 0.155, 0.035, 10), T_DARK, [0, 0, -0.575])
            barrelB.glow(bore(0.135, 10), color, 0.8, [0, 0, -0.565])
            barrelB.glow(bore(0.07, 8), color, 3.2, [0, 0, -0.57])
            for (let i = 0; i < 3; i++) {
                const a = (i / 3) * Math.PI * 2 + Math.PI / 2
                const c = Math.cos(a)
                const s = Math.sin(a)
                barrelB.metal(box(0.03, 0.045, 0.3), T_METAL, [c * 0.165, s * 0.165, -0.5], [0, 0, a + Math.PI / 2])
                barrelB.solid(box(0.03, 0.04, 0.17), tint, [c * 0.125, s * 0.125, -0.715], [s * 0.55, -c * 0.55, a + Math.PI / 2])
            }
            barrelB.glow(octa(0.04), color, 4.5, [0, 0, -0.76], [0, 0, 0], [1, 1, 1.7])
            muzzle = new THREE.Vector3(0, 0, -0.8)
            break
        }
        case 'missile': {
            // Twin six-cell launcher pods slung either side of a trunnion block, warheads showing, a guidance dome on top.
            headB.metal(block(0.16, 0.24, 0.3, 0.03), T_DARK, [0, 0, 0.02])
            headB.metal(tube(0.05, 0.05, 0.62, 6), T_METAL, [0, 0, 0.02], [0, Math.PI / 2, 0])
            headB.solid(cyl(0.06, 0.075, 0.04, 8), T_PAINT, [0, 0.14, 0.04])
            headB.metal(ico(0.06), T_LIGHT, [0, 0.17, 0.04])
            headB.glow(box(0.1, 0.015, 0.015), color, 2.4, [0, 0.13, -0.135])
            for (const side of [-1, 1]) {
                const px = side * 0.225
                barrelB.solid(block(0.29, 0.38, 0.56, 0.03), T_PAINT, [px, 0.01, -0.12])
                barrelB.solid(block(0.296, 0.07, 0.16, 0.008), tint, [px, 0.01, -0.22])
                barrelB.metal(block(0.25, 0.02, 0.4, 0.006), T_LIGHT, [px, 0.205, -0.12])
                barrelB.metal(box(0.25, 0.022, 0.012), T_BLACK, [px, 0.206, -0.12])
                barrelB.metal(box(0.262, 0.352, 0.02), T_BLACK, [px, 0.01, -0.396])
                for (let k = 0; k < 3; k++) barrelB.solid(box(0.03, 0.384, 0.05), k % 2 ? T_DARK : T_HAZARD, [px - side * (0.05 + k * 0.03), 0.01, 0.1])
                for (let i = 0; i < 6; i++) {
                    const x = px + (i % 2 ? 0.065 : -0.065)
                    const y = 0.01 + (Math.floor(i / 2) - 1) * 0.115
                    barrelB.metal(sleeve(0.052, 0.052, 0.04, 6), T_METAL, [x, y, -0.415])
                    barrelB.solid(new THREE.ConeGeometry(0.04, 0.08, 6).rotateX(-Math.PI / 2), (i + (side > 0 ? 1 : 0)) % 3 ? T_LIGHT : color, [x, y, -0.43])
                    barrelB.glow(new THREE.CircleGeometry(0.035, 6), 0xff7a2e, 0.9, [x, y, 0.161])
                }
            }
            barrelB.glow(box(0.02, 0.02, 0.4), color, 1.8, [0.375, 0.13, -0.12], [0, 0, 0], [1, 1, 1], true)
            muzzle = new THREE.Vector3(0, 0.01, -0.5)
            break
        }
        case 'tesla': {
            // A Tesla coil laid on its side: capacitor drum, a stack of ceramic insulators, the top-load torus and three arcing horns.
            headB.metal(cyl(0.2, 0.24, 0.2, 10), T_DARK)
            headB.solid(cyl(0.15, 0.2, 0.07, 10), T_PAINT, [0, 0.13, 0])
            headB.solid(hoop(0.212, 0.232, 0.05, 10), tint, [0, 0, 0])
            for (const z of [-0.07, 0.07]) {
                headB.metal(cyl(0.042, 0.042, 0.17, 6), T_METAL, [0.21, 0.1, z], [0, 0, 0], [1, 1, 1], true)
                headB.solid(hoop(0.045, 0.045, 0.04, 6), T_CERAMIC, [0.21, 0.13, z], [0, 0, 0], [1, 1, 1], true)
                headB.glow(new THREE.CircleGeometry(0.028, 6).rotateX(-Math.PI / 2), color, 2.6, [0.21, 0.186, z], [0, 0, 0], [1, 1, 1], true)
            }
            headB.metal(sleeve(0.016, 0.016, 0.2, 4), T_BLACK, [0.12, 0.17, -0.06], [0, Math.PI / 2 - 0.5, 0.5], [1, 1, 1], true)
            barrelB.metal(tube(0.1, 0.13, 0.1, 8), T_DARK, [0, 0.02, -0.2])
            barrelB.metal(sleeve(0.035, 0.05, 0.4, 6), T_METAL, [0, 0.02, -0.42])
            for (let i = 0; i < 4; i++) {
                const r = 0.115 - i * 0.012
                barrelB.solid(tube(r - 0.02, r, 0.04, 8), T_CERAMIC, [0, 0.02, -0.28 - i * 0.085])
                barrelB.glow(sleeve(r - 0.035, r - 0.035, 0.04, 8), color, 2.6, [0, 0.02, -0.322 - i * 0.085])
            }
            barrelB.metal(ring(0.12, 0.042, 5, 12), T_LIGHT, [0, 0.02, -0.64])
            barrelB.glow(ico(0.06), color, 5, [0, 0.02, -0.67])
            for (let i = 0; i < 3; i++) {
                const a = (i / 3) * Math.PI * 2 + Math.PI / 2
                const c = Math.cos(a)
                const s = Math.sin(a)
                barrelB.metal(box(0.022, 0.03, 0.24), T_METAL, [c * 0.19, 0.02 + s * 0.19, -0.66], [-s * 0.3, c * 0.3, a + Math.PI / 2])
                barrelB.metal(box(0.02, 0.026, 0.14), T_DARK, [c * 0.125, 0.02 + s * 0.125, -0.82], [s * 0.75, -c * 0.75, a + Math.PI / 2])
                barrelB.glow(octa(0.02), color, 4, [c * 0.072, 0.02 + s * 0.072, -0.885])
            }
            muzzle = new THREE.Vector3(0, 0.02, -0.86)
            break
        }
        case 'mortar': {
            // A siege howitzer in an open-backed shield: fat stubby tube, drum trunnions, a heavy breech with its wheel, recuperators on top.
            headB.solid(block(0.5, 0.06, 0.44, 0.015), T_PAINT, [0, -0.15, 0.02])
            headB.solid(slab([[-0.17, -0.2], [0.14, -0.26], [0.2, -0.1], [0.2, 0.2], [-0.17, 0.2]], 0.045, 0.012), T_PAINT, [0.27, 0.02, 0], [0, 0, Math.PI / 2 + 0.14], [1, 1, 1], true)
            headB.solid(slab([[-0.05, -0.06], [0.1, -0.1], [0.1, 0.12], [-0.05, 0.12]], 0.02, 0.006), tint, [0.303, 0.03, 0], [0, 0, Math.PI / 2 + 0.14], [1, 1, 1], true)
            headB.metal(cyl(0.11, 0.11, 0.1, 10), T_DARK, [0.2, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1], true)
            headB.metal(block(0.3, 0.3, 0.2, 0.03), T_DARK, [0, 0.02, 0.14])
            headB.solid(block(0.31, 0.08, 0.1, 0.01), tint, [0, 0.06, 0.16])
            headB.metal(ring(0.075, 0.014, 3, 8), T_LIGHT, [0, 0.02, 0.255])
            headB.metal(box(0.15, 0.02, 0.02), T_LIGHT, [0, 0.02, 0.255], [0, 0, 0.6])
            headB.glow(box(0.2, 0.02, 0.012), color, 2, [0, 0.15, 0.242])
            // Ready rounds racked on the left shield.
            for (let i = 0; i < 3; i++) {
                headB.metal(cyl(0.035, 0.035, 0.1, 6), T_METAL, [-0.36, -0.06, -0.06 + i * 0.085])
                headB.solid(new THREE.ConeGeometry(0.035, 0.06, 6), color, [-0.36, 0.02, -0.06 + i * 0.085])
            }
            headB.metal(box(0.03, 0.03, 0.28), T_DARK, [-0.34, -0.09, 0.025])
            barrelB.metal(tube(0.16, 0.18, 0.22, 10), T_DARK, [0, 0.02, -0.2])
            barrelB.metal(tube(0.135, 0.15, 0.5, 10), T_METAL, [0, 0.02, -0.48])
            for (const z of [-0.4, -0.56]) barrelB.metal(sleeve(0.165, 0.165, 0.045, 10), T_ARMOR, [0, 0.02, z])
            barrelB.metal(tube(0.185, 0.175, 0.13, 10), T_DARK, [0, 0.02, -0.76])
            barrelB.metal(bore(0.12, 10), T_BLACK, [0, 0.02, -0.827])
            barrelB.glow(new THREE.RingGeometry(0.1, 0.13, 10).rotateY(Math.PI), color, 2.4, [0, 0.02, -0.829])
            for (const y of [0.11, -0.07]) barrelB.glow(box(0.385, 0.022, 0.05), color, 1.7, [0, y, -0.76])
            barrelB.metal(tube(0.04, 0.04, 0.36, 6), T_LIGHT, [0.1, 0.19, -0.36], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(tube(0.052, 0.052, 0.16, 6), T_DARK, [0.1, 0.19, -0.26], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(block(0.3, 0.05, 0.04, 0.008), T_DARK, [0, 0.18, -0.52])
            muzzle = new THREE.Vector3(0, 0.02, -0.85)
            break
        }
        case 'rail': {
            // A railgun: a long slim house with capacitor banks down both sides, twin rails braced by coil frames, a forked muzzle.
            headB.solid(block(0.3, 0.24, 0.54, 0.035), T_PAINT, [0, 0, 0.0])
            headB.solid(block(0.306, 0.05, 0.18, 0.008), tint, [0, 0.07, 0.1])
            headB.solid(slab([[-0.15, 0], [0.15, 0], [0.11, 0.14], [-0.11, 0.14]], 0.03, 0.008), T_ARMOR, [0, 0.0, -0.27], [-1.2, 0, 0])
            for (let i = 0; i < 3; i++) {
                const y = -0.07 + i * 0.075
                headB.metal(tube(0.036, 0.036, 0.36, 6), T_DARK, [0.19 + (i % 2) * 0.02, y, 0.03], [0, 0, 0], [1, 1, 1], true)
                headB.glow(bore(0.024, 6), color, 2.4, [0.19 + (i % 2) * 0.02, y, -0.152], [0, 0, 0], [1, 1, 1], true)
            }
            headB.metal(block(0.07, 0.26, 0.05, 0.008), T_METAL, [0.2, 0, 0.1], [0, 0, 0], [1, 1, 1], true)
            for (let i = 0; i < 4; i++) headB.metal(box(0.2, 0.06, 0.014), T_DARK, [0, 0.14, -0.12 + i * 0.05])
            headB.glow(box(0.16, 0.012, 0.17), color, 1.6, [0, 0.122, -0.045])
            headB.metal(sleeve(0.03, 0.03, 0.16, 5), T_BLACK, [0.07, -0.04, 0.31], [0.5, 0, 0], [1, 1, 1], true)
            barrelB.metal(block(0.045, 0.12, 1.12, 0.01), T_METAL, [0.075, 0, -0.68], [0, 0, 0], [1, 1, 1], true)
            barrelB.solid(block(0.05, 0.125, 0.14, 0.008), tint, [0.078, 0, -0.98], [0, 0, 0], [1, 1, 1], true)
            barrelB.glow(box(0.024, 0.024, 1.04), color, 3, [0, 0, -0.66])
            for (let i = 0; i < 5; i++) {
                const z = -0.24 - i * 0.2
                barrelB.metal(ring(0.17 - i * 0.008, 0.024, 3, 4), T_DARK, [0, 0, z], [0, 0, Math.PI / 4])
                if (i % 2 === 0) barrelB.glow(ring(0.135 - i * 0.008, 0.012, 3, 4), color, 2.4, [0, 0, z], [0, 0, Math.PI / 4])
            }
            barrelB.metal(box(0.04, 0.03, 0.5), T_DARK, [0, -0.1, -0.42], [0.12, 0, 0])
            barrelB.metal(slab([[0, 0], [0.09, 0.03], [0.09, 0.17], [0, 0.13]], 0.02, 0.004), T_DARK, [0.1, 0, -1.28], [0, 0, 0], [1, 1, 1], true)
            barrelB.glow(octa(0.028), color, 4, [0, 0, -1.2])
            muzzle = new THREE.Vector3(0, 0, -1.25)
            break
        }
    }
    yaw.add(yawB.build().group)
    pitch.add(headB.build().group)
    barrel.add(barrelB.build().group)
    pitch.add(barrel)
    return { root, yaw, pitch, barrel, muzzle }
}

/**
 * An escort drone: an armoured little gunship with a visor and sensor eye, cutter mandibles for
 * rock, a chin cannon for hostiles and two podded drives on stub wings. It wears its mothership's colour.
 */
export function buildDrone(color: number): THREE.Group {
    const tint = shade(color, 0.5)
    const b = new ModelBuilder()
    const shape: [number, number, number] = [8, 0.65, Math.PI / 8]
    const body: Section[] = [
        { z: -0.5, w: 0.07, h: 0.05, y: -0.01 },
        { z: -0.3, w: 0.16, h: 0.11 },
        { z: 0.1, w: 0.2, h: 0.14 },
        { z: 0.36, w: 0.17, h: 0.12 },
        { z: 0.48, w: 0.1, h: 0.08 }
    ]
    b.solid(loft(body, ...shape), T_LIGHT)
    band(b, body, -0.08, 0.04, tint, shape, 0.006)
    band(b, body, 0.26, 0.3, T_DARK, shape, 0.006)
    // Visor wrapped over the nose, the eye under it.
    b.glass(loft([{ z: -0.46, w: 0.06, h: 0.02, y: 0.035 }, { z: -0.3, w: 0.13, h: 0.04, y: 0.085 }, { z: -0.14, w: 0.1, h: 0.03, y: 0.125 }], 6, 0.9), 0x0a0f18)
    b.metal(ring(0.045, 0.014, 3, 8), T_DARK, [0, -0.01, -0.5])
    b.glow(octa(0.04), color, 3.5, [0, -0.01, -0.515])
    // Dorsal armour, spine fin and aerial; a keel fin below.
    b.solid(slab([[-0.11, -0.12], [0.11, -0.12], [0.14, 0.2], [-0.14, 0.2]], 0.03, 0.01), T_ARMOR, [0, 0.14, 0.1])
    b.metal(box(0.012, 0.012, 0.3), T_BLACK, [0, 0.157, 0.1])
    b.solid(slab([[0, 0], [0.16, 0.12], [0.18, 0.26], [0, 0.24]], 0.025, 0.006), T_PAINT, [0, 0.14, 0.2], [0, 0, Math.PI / 2])
    b.glow(box(0.012, 0.06, 0.012), color, 2.6, [0, 0.29, 0.45])
    b.metal(cyl(0.005, 0.008, 0.2, 4), T_METAL, [0.07, 0.25, 0.26])
    b.glow(octa(0.015), RED, 3, [0.07, 0.35, 0.26])
    b.solid(slab([[0, 0], [0.1, 0.08], [0.1, 0.2], [0, 0.22]], 0.02, 0.005), T_DARK, [0, -0.13, 0.18], [0, 0, -Math.PI / 2])
    // Stub wings carry the drive pods; painted tips and running lights.
    b.solid(slab([[0.14, -0.08], [0.44, 0.06], [0.44, 0.3], [0.14, 0.34]], 0.04, 0.01), T_DARK, [0, 0, 0], [0, 0, -0.12], [1, 1, 1], true)
    b.solid(slab([[0.44, 0.06], [0.68, 0.2], [0.68, 0.34], [0.44, 0.3]], 0.03, 0.008), T_LIGHT, [0, 0, 0], [0, 0, -0.12], [1, 1, 1], true)
    b.solid(slab([[0.6, 0.15], [0.69, 0.2], [0.69, 0.35], [0.6, 0.33]], 0.036, 0.008), tint, [0, 0, 0], [0, 0, -0.12], [1, 1, 1], true)
    b.glow(octa(0.02), GREEN, 3, [0.7, -0.085, 0.27])
    b.glow(octa(0.02), RED, 3, [-0.7, -0.085, 0.27])
    const pod: Section[] = [
        { z: 0.0, w: 0.05, h: 0.05, x: 0.34, y: -0.04 },
        { z: 0.1, w: 0.085, h: 0.085, x: 0.34, y: -0.04 },
        { z: 0.46, w: 0.085, h: 0.085, x: 0.34, y: -0.04 },
        { z: 0.54, w: 0.07, h: 0.07, x: 0.34, y: -0.04 }
    ]
    b.solid(loft(pod, 8, 0.9), T_PAINT, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
    band(b, pod, 0.16, 0.22, tint, [8, 0.9, 0], 0.005, 0, true)
    b.glass(bore(0.04, 8), T_BLACK, [0.34, -0.04, -0.002], [0, 0, 0], [1, 1, 1], true)
    b.metal(tube(0.075, 0.095, 0.08, 8), T_DARK, [0.34, -0.04, 0.57], [0, 0, 0], [1, 1, 1], true)
    b.glow(new THREE.CircleGeometry(0.068, 8), color, 0.6, [0.34, -0.04, 0.605], [0, 0, 0], [1, 1, 1], true)
    b.glow(new THREE.CircleGeometry(0.04, 8), color, 2.6, [0.34, -0.04, 0.607], [0, 0, 0], [1, 1, 1], true)
    // Cutter mandibles reach past the nose, their inner edges live.
    b.metal(slab([[0, 0], [0.05, -0.04], [0.035, -0.36], [0, -0.3]], 0.04, 0.008), T_METAL, [0.12, -0.06, -0.3], [0, -0.1, 0], [1, 1, 1], true)
    b.glow(box(0.008, 0.012, 0.22), color, 2.6, [0.105, -0.06, -0.49], [0, -0.1, 0], [1, 1, 1], true)
    b.metal(block(0.07, 0.06, 0.12, 0.01), T_DARK, [0.13, -0.06, -0.26], [0, 0, 0], [1, 1, 1], true)
    // Chin cannon on a cheek mount.
    b.metal(block(0.09, 0.07, 0.22, 0.012), T_DARK, [0, -0.15, -0.06])
    b.metal(tube(0.03, 0.035, 0.1, 6), T_ARMOR, [0, -0.155, -0.2])
    b.metal(tube(0.016, 0.02, 0.26, 6), T_METAL, [0, -0.155, -0.36])
    b.metal(tube(0.028, 0.028, 0.04, 6), T_DARK, [0, -0.155, -0.47])
    b.glow(bore(0.014, 6), color, 3, [0, -0.155, -0.492])
    // Centre drive.
    b.metal(tube(0.09, 0.11, 0.08, 8), T_DARK, [0, 0, 0.51])
    b.glow(new THREE.CircleGeometry(0.075, 8), color, 2.4, [0, 0, 0.552])
    return b.build().group
}
