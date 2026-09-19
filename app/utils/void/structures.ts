// Void Runner — the places on the map: home station, beacons, jump gate, the Free Trader and wrecks.

import * as THREE from 'three'
import { ModelBuilder, cyl, ico, mulberry32, octa, ring, tube } from './models'
import { type Livery, type Section, type Vec3, loft, slab, block, dish, shade, tank, RED, GREEN, WINDOW } from './ship-kit'

// ─── Shared helpers ────────────────────────────────────────────────────────

type Rng = () => number

/** Anything parts can be added to: a builder, or a `Frame` that places them in its own space. */
interface Sink {
    solid(geo: THREE.BufferGeometry, color: number, pos?: Vec3, rot?: Vec3, scale?: Vec3): unknown
    metal(geo: THREE.BufferGeometry, color: number, pos?: Vec3, rot?: Vec3, scale?: Vec3): unknown
    glass(geo: THREE.BufferGeometry, color: number, pos?: Vec3, rot?: Vec3, scale?: Vec3): unknown
    glow(geo: THREE.BufferGeometry, color: number, intensity: number, pos?: Vec3, rot?: Vec3, scale?: Vec3): unknown
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _d = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

/** A rigid sub-assembly: parts are laid out in local space and baked into the builder through `matrix`. */
class Frame implements Sink {
    constructor(private b: ModelBuilder, private matrix: THREE.Matrix4) {}

    private place(geo: THREE.BufferGeometry, pos: Vec3, rot: Vec3, scale: Vec3) {
        _m.compose(new THREE.Vector3(...pos), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), new THREE.Vector3(...scale))
        return geo.applyMatrix4(_m).applyMatrix4(this.matrix)
    }

    solid(geo: THREE.BufferGeometry, color: number, pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]) {
        this.b.solid(this.place(geo, pos, rot, scale), color)
    }

    metal(geo: THREE.BufferGeometry, color: number, pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]) {
        this.b.metal(this.place(geo, pos, rot, scale), color)
    }

    glass(geo: THREE.BufferGeometry, color: number, pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]) {
        this.b.glass(this.place(geo, pos, rot, scale), color)
    }

    glow(geo: THREE.BufferGeometry, color: number, intensity: number, pos: Vec3 = [0, 0, 0], rot: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]) {
        this.b.glow(this.place(geo, pos, rot, scale), color, intensity)
    }
}

/** Loft standing up along Y instead of Z. */
function tower(sections: Section[], sides = 8, roundness = 0.8, phase = 0) {
    return loft(sections, sides, roundness, phase).rotateX(-Math.PI / 2)
}

/** A chamfered disc of deck between two heights. */
function drum(y0: number, y1: number, r: number, sides = 16, bevel = 0.35) {
    return tower([
        { z: y0, w: r - bevel, h: r - bevel },
        { z: y0 + bevel, w: r, h: r },
        { z: y1 - bevel, w: r, h: r },
        { z: y1, w: r - bevel, h: r - bevel }
    ], sides, 1)
}

/** A point on a horizontal circle: `r` out along bearing `a`, `t` sideways along the tangent. */
function polar(a: number, r: number, y: number, t = 0): Vec3 {
    return [Math.cos(a) * r - Math.sin(a) * t, y, Math.sin(a) * r + Math.cos(a) * t]
}

/** A rod between two points. `glow` above zero makes it a light. */
function strut(b: Sink, from: Vec3, to: Vec3, r: number, color: number, sides = 5, glow = 0, kind: 'metal' | 'solid' = 'metal') {
    _d.set(to[0] - from[0], to[1] - from[1], to[2] - from[2])
    const len = _d.length()
    if (len < 1e-4) return
    _e.setFromQuaternion(_q.setFromUnitVectors(UP, _d.divideScalar(len)))
    const pos: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2]
    const rot: Vec3 = [_e.x, _e.y, _e.z]
    if (glow) b.glow(cyl(r, r, len, sides), color, glow, pos, rot)
    else b[kind](cyl(r, r, len, sides), color, pos, rot)
}

/** A row of lit windows around a polygonal deck, a few of them dark so it reads as lived in. */
function windowRing(b: Sink, rng: Rng, r: number, y: number, sides: number, per: number, w = 0.9, h = 0.7, dark = 0.22) {
    const apothem = r * Math.cos(Math.PI / sides) + 0.03
    const face = 2 * r * Math.sin(Math.PI / sides)
    for (let i = 0; i < sides; i++) {
        const a = ((i + 0.5) / sides) * Math.PI * 2
        for (let k = 0; k < per; k++) {
            if (rng() < dark) continue
            const t = ((k + 0.5) / per - 0.5) * face * 0.8
            b.glow(new THREE.BoxGeometry(0.12, h, w), rng() < 0.2 ? 0xcfe6ff : WINDOW, 1.1 + rng() * 0.6, polar(a, apothem, y, t), [0, -a, 0])
        }
    }
}

// ─── Station ───────────────────────────────────────────────────────────────

const PAINT = 0xd5dae1
const PAINT2 = 0xaab4c2
const CREAM = 0xe2d9c6
const PANEL = 0x8f98a6
const STEEL = 0x59616d
const DARK = 0x2a3038
const DEEP = 0x14181e
const SOLAR = 0x16264a
const HAZARD = 0xd9892b
const HOT = 0xff8a3c
const POD_COLORS = [0xb5653a, 0x4f6f94, CREAM, 0x6b7a4a, 0x8a3f3a]

/** A docking arm: a piped boom out to an open hangar with a lit interior and an approach lane. */
function dockingArm(b: ModelBuilder, rng: Rng, a: number, accent: number) {
    const y = -8
    const rot: Vec3 = [0, -a, 0]
    // Boom: a layered box girder with pipe runs on top and tanks slung either side.
    b.solid(block(20, 3.4, 5, 0.4), PANEL, polar(a, 21, y), rot)
    b.solid(block(16, 1, 6.2, 0.25), PAINT2, polar(a, 21, y + 1.9), rot)
    b.metal(block(18, 1.2, 3.4, 0.2), DARK, polar(a, 21, y - 2.1), rot)
    for (const t of [-1.6, 0, 1.6]) strut(b, polar(a, 12, y + 2.7, t), polar(a, 30.5, y + 2.7, t), 0.32, t ? STEEL : shade(accent, 0.5), 6)
    for (let k = 0; k < 4; k++) {
        b.metal(block(0.7, 4.4, 5.8, 0.1), STEEL, polar(a, 14 + k * 4.6, y), rot)
        b.glow(new THREE.BoxGeometry(0.5, 0.25, 0.12), WINDOW, 1.6, polar(a, 16.3 + k * 4.6, y + 0.4, 2.52), rot)
        b.glow(new THREE.BoxGeometry(0.5, 0.25, 0.12), WINDOW, 1.6, polar(a, 16.3 + k * 4.6, y + 0.4, -2.52), rot)
    }
    for (const side of [-1, 1]) {
        for (const r of [17, 24]) {
            b.solid(cyl(1.3, 1.3, 5, 10), side > 0 ? CREAM : PAINT2, polar(a, r, y - 0.4, side * 4), [0, -a, Math.PI / 2])
            b.solid(ico(1.3, 1), side > 0 ? CREAM : PAINT2, polar(a, r - 2.5, y - 0.4, side * 4), rot, [0.6, 1, 1])
            b.solid(ico(1.3, 1), side > 0 ? CREAM : PAINT2, polar(a, r + 2.5, y - 0.4, side * 4), rot, [0.6, 1, 1])
            b.metal(ring(1.36, 0.1, 4, 10), STEEL, polar(a, r, y - 0.4, side * 4), [0, -a + Math.PI / 2, 0])
        }
    }

    // Hangar shell: floor, roof, side walls and a back wall around an open mouth.
    const r0 = 31
    const r1 = 47
    const mid = (r0 + r1) / 2
    const len = r1 - r0
    b.solid(block(len, 1, 18, 0.25), PANEL, polar(a, mid, y - 5), rot)
    b.solid(block(len, 1.2, 18, 0.3), PAINT, polar(a, mid, y + 5), rot)
    b.solid(block(len - 3, 0.9, 13, 0.3), PAINT2, polar(a, mid - 1, y + 6), rot)
    for (const side of [-1, 1]) {
        b.solid(block(len, 10, 1.4, 0.3), PAINT, polar(a, mid, y, side * 8.6), rot)
        b.solid(block(len - 4, 5, 0.8, 0.25), PAINT2, polar(a, mid - 1, y + 0.5, side * 9.5), rot)
        b.metal(block(len - 6, 1.2, 0.6, 0.1), DARK, polar(a, mid - 1, y - 3, side * 9.5), rot)
        for (let k = 0; k < 5; k++) if (rng() > 0.25) b.glow(new THREE.BoxGeometry(1.3, 0.6, 0.12), WINDOW, 1.4, polar(a, r0 + 3 + k * 2.4, y + 1.2, side * 9.95), rot)
        // Hazard-striped jambs either side of the mouth.
        for (let k = 0; k < 6; k++) b.solid(new THREE.BoxGeometry(0.5, 1.5, 1.7), k % 2 ? DEEP : HAZARD, polar(a, r1 + 0.1, y - 3.75 + k * 1.5, side * 8.6), rot)
        b.glow(new THREE.BoxGeometry(0.2, 8.6, 0.3), accent, 2.4, polar(a, r1 + 0.4, y, side * 7.7), rot)
    }
    b.metal(block(1.2, 10, 18, 0.2), DARK, polar(a, r0 + 0.2, y), rot)
    // Interior: a bright back wall, ceiling strips, a painted floor lane and a parked shuttle.
    b.glow(new THREE.BoxGeometry(0.1, 5.5, 13), WINDOW, 0.75, polar(a, r0 + 0.95, y + 0.4), rot)
    for (const t of [-5.2, -2.6, 0, 2.6, 5.2]) b.metal(new THREE.BoxGeometry(0.4, 6.5, 0.4), DARK, polar(a, r0 + 1.1, y + 0.4, t), rot)
    for (const t of [-4.5, 0, 4.5]) b.glow(new THREE.BoxGeometry(len - 3, 0.12, 0.5), 0xdff1ff, 1.5, polar(a, mid, y + 4.3, t), rot)
    b.glow(new THREE.BoxGeometry(len - 2, 0.06, 0.35), accent, 1.6, polar(a, mid + 0.5, y - 4.45), rot)
    for (const t of [-6.5, 6.5]) b.glow(new THREE.BoxGeometry(len - 2, 0.06, 0.18), HAZARD, 1.3, polar(a, mid + 0.5, y - 4.45, t), rot)
    const shuttle = loft([
        { z: -2.6, w: 0.3, h: 0.25 }, { z: -1.4, w: 1, h: 0.7 }, { z: 1.2, w: 1.2, h: 0.85 }, { z: 2.4, w: 0.9, h: 0.6 }
    ], 8, 0.7)
    b.solid(shuttle, CREAM, polar(a, r0 + 5.5, y - 3.6, -4.4), [0, -a - Math.PI / 2, 0])
    b.solid(block(3.4, 0.15, 1.6, 0.04), PAINT2, polar(a, r0 + 6.2, y - 3.75, -4.4), [0, -a - Math.PI / 2, 0])
    b.glow(new THREE.BoxGeometry(0.1, 0.3, 0.9), accent, 2, polar(a, r0 + 2.95, y - 3.5, -4.4), rot)
    for (const t of [3, 5.4]) b.solid(block(2.2, 1.8, 1.8, 0.08), POD_COLORS[Math.floor(rng() * POD_COLORS.length)]!, polar(a, r0 + 3.2, y - 3.6, t), rot)
    // Lit lintel and sill.
    b.metal(block(1, 1.4, 16, 0.2), DARK, polar(a, r1 + 0.2, y + 4.2), rot)
    b.glow(new THREE.BoxGeometry(0.2, 0.35, 15), accent, 2.6, polar(a, r1 + 0.75, y + 4.2), rot)
    b.glow(new THREE.BoxGeometry(0.2, 0.3, 15), accent, 2.2, polar(a, r1 + 0.6, y - 4.6), rot)
    // Roof clutter: control cupola, vent stacks, tanks and a whip antenna.
    b.solid(drum(y + 6.4, y + 8.6, 2.4, 8, 0.3), PAINT, polar(a, mid - 3, 0, 3.5))
    b.glow(ring(2.42, 0.22, 4, 8), WINDOW, 1.3, polar(a, mid - 3, y + 7.6, 3.5), [Math.PI / 2, 0, Math.PI / 8])
    for (let k = 0; k < 3; k++) b.metal(block(1.4, 1.2 + k * 0.4, 1.4, 0.1), STEEL, polar(a, mid + 2 + k * 2, y + 6.8 + k * 0.2, -4), rot)
    strut(b, polar(a, r1 - 2, y + 6, 6), polar(a, r1 - 2, y + 15, 6), 0.12, DARK)
    b.glow(octa(0.35), RED, 4, polar(a, r1 - 2, y + 15.2, 6))
    // Approach lane: two light rails reaching out from the sill.
    for (const side of [-1, 1]) {
        strut(b, polar(a, r1, y - 5, side * 7.5), polar(a, 74, y - 5, side * 9.5), 0.18, DARK)
        for (let k = 0; k < 7; k++) {
            const u = k / 6
            b.glow(octa(0.42), k % 2 ? WINDOW : (side > 0 ? GREEN : RED), 3.2, polar(a, 50 + u * 24, y - 4.6, side * (7.6 + u * 1.9)))
        }
    }
}

/** A truss boom carrying four pairs of tilted solar panels. */
function solarWing(b: ModelBuilder, side: number, y: number) {
    const tilt = 0.4 * side
    for (const z of [-0.7, 0.7]) strut(b, [side * 7, y + 0.5, z], [side * 60, y + 0.5, z], 0.28, STEEL, 6)
    strut(b, [side * 7, y - 0.7, 0], [side * 60, y - 0.7, 0], 0.28, STEEL, 6)
    for (let k = 0; k < 13; k++) {
        const x = side * (8 + k * 4.3)
        strut(b, [x, y + 0.5, -0.7], [x + side * 4.3, y - 0.7, 0], 0.12, DARK, 4)
        strut(b, [x, y + 0.5, 0.7], [x + side * 4.3, y - 0.7, 0], 0.12, DARK, 4)
    }
    for (let k = 0; k < 4; k++) {
        const x = side * (20 + k * 11.2)
        b.metal(block(1.6, 1.8, 3, 0.15), PANEL, [x, y, 0])
        for (const dir of [-1, 1]) {
            const at = (z: number, up = 0): Vec3 => [x, y - z * dir * Math.sin(tilt) + up * Math.cos(tilt), z * dir * Math.cos(tilt) + up * Math.sin(tilt)]
            b.solid(block(10, 0.25, 15, 0.08), SOLAR, at(9.4), [tilt * dir, 0, 0])
            b.metal(new THREE.BoxGeometry(10.4, 0.4, 0.4), STEEL, at(1.8), [tilt * dir, 0, 0])
            b.metal(new THREE.BoxGeometry(0.4, 0.34, 15), STEEL, at(9.4), [tilt * dir, 0, 0])
            for (let r = 0; r < 5; r++) b.glow(new THREE.BoxGeometry(9.6, 0.05, 0.1), 0x4f9dff, 0.55, at(3.4 + r * 3, 0.16), [tilt * dir, 0, 0])
        }
    }
    b.glow(octa(0.7), side > 0 ? GREEN : RED, 4, [side * 60.8, y + 0.5, 0])
}

/** The home station: a stacked spindle of decks inside a turning habitat ring, with three open hangars. */
export function buildStation(accent: number) {
    const rng = mulberry32(0x57a71)
    const stripe = shade(accent, 0.5)
    const livery: Livery = { paint: PAINT, paint2: PAINT2, trim: PANEL, metal: STEEL, accent: stripe, glow: accent, glass: 0x0a0e14 }
    const hub = new ModelBuilder()

    // Bearing drum the ring turns on.
    hub.metal(drum(-5, 5, 12.5, 16, 0.8), PANEL)
    hub.metal(drum(-3.4, -2.6, 13, 16, 0.2), DARK)
    hub.metal(drum(2.6, 3.4, 13, 16, 0.2), DARK)

    // Habitat decks stacked above it: painted bands, recessed dark galleries, rows of windows.
    const decks: [number, number, number, number, number][] = [
        [5, 9.2, 11.5, PAINT, 1],
        [9.2, 10.6, 9.6, DEEP, 0],
        [10.6, 15.4, 13, PAINT2, 2],
        [15.4, 16.6, 10, DEEP, 0],
        [16.6, 21.2, 11, PAINT, 2],
        [21.2, 22.2, 8, DEEP, 0],
        [22.2, 27, 9.4, CREAM, 1],
        [27, 31.5, 6.6, PANEL, 0],
        [31.5, 35.5, 8.2, PAINT, 1],
        [35.5, 38, 5.6, DARK, 0]
    ]
    for (const [y0, y1, r, color, rows] of decks) {
        if (color === DEEP || color === DARK) hub.metal(drum(y0 - 0.2, y1 + 0.2, r, 16, 0.2), color)
        else hub.solid(drum(y0, y1, r, 16, 0.5), color)
        if (color === DEEP) windowRing(hub, rng, r, (y0 + y1) / 2, 16, 3, 0.7, 0.55, 0.15)
        for (let k = 0; k < rows; k++) windowRing(hub, rng, r, y0 + (y1 - y0) * ((k + 1) / (rows + 1)) + 0.2, 16, 2, 1, 0.6)
        if (rows) {
            // Ribs on every corner break the deck face into panels.
            for (let i = 0; i < 16; i++) {
                const a = (i / 16) * Math.PI * 2
                hub.metal(new THREE.BoxGeometry(0.7, y1 - y0 - 1, 0.5), STEEL, polar(a, r + 0.05, (y0 + y1) / 2), [0, -a, 0])
            }
        }
    }
    hub.solid(drum(12.6, 13.6, 13.15, 16, 0.15), stripe)
    hub.solid(drum(24.4, 25.2, 9.5, 16, 0.12), stripe)
    hub.glow(ring(10.1, 0.12, 4, 32), accent, 1.5, [0, 15.4, 0], [Math.PI / 2, 0, 0])
    // Observation blisters and comms dishes hung off the upper decks.
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4
        hub.solid(block(3.4, 2.6, 4.4, 0.4), PAINT, polar(a, 13.6, 18.8), [0, -a, 0])
        hub.glass(block(1, 1.5, 3.6, 0.2), 0x0a0e14, polar(a, 15.1, 18.9), [0, -a, 0])
        hub.glow(new THREE.BoxGeometry(0.4, 0.12, 3.4), WINDOW, 1.4, polar(a, 15.4, 18), [0, -a, 0])
    }
    for (const [a, r, y, size] of [[1.2, 12.5, 27.2, 3.2], [4.1, 9.5, 35.6, 2.4], [5.3, 12, 21.4, 2]] as const) {
        const at = polar(a, r, y)
        strut(hub, polar(a, r - 5, y - 1), at, 0.3, STEEL)
        dish(hub, livery, at, size)
    }

    // Traffic control: a slim stem, a glazed cab and an antenna farm on its roof.
    hub.solid(tower([{ z: 38, w: 3.4, h: 3.4 }, { z: 40, w: 2.2, h: 2.2 }, { z: 49, w: 2, h: 2 }, { z: 50.5, w: 4.4, h: 4.4 }], 8, 1), PANEL)
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        strut(hub, polar(a, 5, 38), polar(a, 3.6, 50.2), 0.22, STEEL)
    }
    hub.solid(drum(50.5, 51.6, 5.2, 12, 0.3), PAINT)
    hub.glass(drum(51.6, 53.6, 5.5, 12, 0.25), 0x0a0e14)
    hub.glow(ring(5.45, 0.14, 4, 12), WINDOW, 1.8, [0, 51.75, 0], [Math.PI / 2, 0, Math.PI / 12])
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        hub.metal(new THREE.BoxGeometry(0.3, 2.2, 0.3), STEEL, polar(a, 5.5, 52.6), [0, -a, 0])
    }
    hub.solid(drum(53.6, 54.6, 6, 12, 0.4), PAINT2)
    hub.glow(ring(6.05, 0.12, 4, 24), accent, 2, [0, 54.1, 0], [Math.PI / 2, 0, 0])
    strut(hub, [0, 54.6, 0], [0, 74, 0], 0.3, DARK, 6)
    hub.metal(drum(60, 60.6, 1.6, 8, 0.15), STEEL)
    hub.metal(drum(65, 65.5, 1.1, 8, 0.12), STEEL)
    hub.glow(octa(1), RED, 4.5, [0, 74.8, 0])
    for (const [x, z, h] of [[3, 2, 8], [-3.4, 1, 5.5], [-1, -3.6, 10], [3.2, -2.6, 4]] as const) {
        strut(hub, [x, 54.6, z], [x, 54.6 + h, z], 0.1, DARK, 4)
        hub.glow(octa(0.25), h > 7 ? RED : WINDOW, 3.5, [x, 54.8 + h, z])
    }
    hub.metal(ico(1.3, 1), PAINT, [-3.2, 55.6, -2.8])

    // Dock collar: the arms spring from here.
    hub.solid(drum(-12.5, -5, 12, 16, 0.6), PAINT2)
    hub.solid(drum(-7, -5.8, 12.15, 16, 0.12), stripe)
    windowRing(hub, rng, 12, -10.2, 16, 2, 1, 0.6)
    hub.glow(ring(11.3, 0.14, 4, 32), accent, 1.6, [0, -12.6, 0], [Math.PI / 2, 0, 0])
    for (let i = 0; i < 3; i++) dockingArm(hub, rng, (i / 3) * Math.PI * 2 + Math.PI / 2, accent)

    // Neck with riser pipes, ringed by cargo pods racked two tiers deep.
    hub.metal(drum(-25, -12.5, 6.2, 12, 0.3), DARK)
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        strut(hub, polar(a, 6.6, -12.5), polar(a, 6.6, -25), 0.3, i % 3 ? STEEL : stripe, 5)
    }
    for (const y of [-13.4, -17.9, -22.4]) hub.metal(ring(11.4, 0.3, 4, 24), STEEL, [0, y, 0], [Math.PI / 2, 0, 0])
    for (let tier = 0; tier < 2; tier++) {
        for (let i = 0; i < 10; i++) {
            if (rng() < 0.2) continue
            const a = (i / 10) * Math.PI * 2 + tier * 0.31
            const at = polar(a, 9.6, -15.65 - tier * 4.5)
            hub.solid(block(6, 3.6, 4.4, 0.2), POD_COLORS[Math.floor(rng() * POD_COLORS.length)]!, at, [0, -a, 0])
            hub.metal(new THREE.BoxGeometry(6.1, 0.3, 4.5), DARK, at, [0, -a, 0])
            hub.glow(new THREE.BoxGeometry(0.1, 0.4, 0.4), rng() < 0.5 ? GREEN : HAZARD, 2.2, polar(a, 12.65, -14.6 - tier * 4.5, 1.4), [0, -a, 0])
        }
    }

    // Reactor block, its radiators glowing between the docking arms, and the core hanging underneath.
    hub.solid(drum(-34, -25, 9.6, 12, 0.7), PANEL)
    hub.solid(drum(-30.2, -28.8, 9.75, 12, 0.12), HAZARD)
    for (let i = 0; i < 12; i++) {
        const a = ((i + 0.5) / 12) * Math.PI * 2
        hub.glow(new THREE.BoxGeometry(0.12, 3, 0.6), accent, 1.8, polar(a, 9.6 * Math.cos(Math.PI / 12) + 0.04, -32), [0, -a, 0])
    }
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 2
        strut(hub, polar(a, 9, -29.5), polar(a, 36, -29.5), 0.4, STEEL, 6)
        for (const dy of [-4.2, 4.2]) {
            hub.metal(block(24, 7.6, 0.3, 0.08), DARK, polar(a, 23.5, -29.5 + dy), [0, -a, 0])
            for (let k = 0; k < 4; k++) {
                for (const t of [-0.2, 0.2]) hub.glow(new THREE.BoxGeometry(22.5, 0.5, 0.05), HOT, 1.1, polar(a, 23.5, -29.5 + dy - 2.7 + k * 1.8, t), [0, -a, 0])
            }
        }
    }
    hub.metal(tower([{ z: -34, w: 8.6, h: 8.6 }, { z: -38, w: 6, h: 6 }, { z: -40, w: 3, h: 3 }], 12, 1), DARK)
    hub.glow(ico(3.4, 1), accent, 2.4, [0, -44.5, 0])
    hub.glow(ico(2, 1), 0xffffff, 2.6, [0, -44.5, 0])
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        strut(hub, polar(a, 5.5, -38), polar(a, 6.4, -46), 0.45, STEEL, 6)
        strut(hub, polar(a, 6.4, -46), polar(a, 1.2, -52), 0.4, STEEL, 6)
        hub.solid(block(1.6, 4, 2.2, 0.2), PAINT2, polar(a, 6.6, -43), [0, -a, 0])
    }
    for (let i = 0; i < 3; i++) hub.glow(ring(5.2 - i * 1.2, 0.12, 4, 24), accent, 1.8 - i * 0.3, [0, -40.5 - i * 4, 0], [Math.PI / 2, 0, 0])
    hub.metal(tower([{ z: -60, w: 0.2, h: 0.2 }, { z: -54, w: 1, h: 1 }, { z: -51, w: 1.6, h: 1.6 }], 8, 1), DARK)
    hub.glow(octa(0.6), WINDOW, 4, [0, -60.6, 0])

    solarWing(hub, 1, 29.2)
    solarWing(hub, -1, 29.2)
    const hubModel = hub.build()

    // The habitat ring: a flattened torus with a window belt, roof modules and six trussed spokes.
    const rb = new ModelBuilder()
    rb.solid(ring(46, 3.6, 8, 72), PAINT, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.78])
    rb.metal(ring(49, 1.1, 4, 72), DARK, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 1.5])
    rb.metal(ring(43, 1, 4, 72), DARK, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 1.3])
    rb.glow(ring(46, 0.14, 4, 72), accent, 1.5, [0, 2.86, 0], [Math.PI / 2, 0, 0])
    rb.glow(ring(46, 0.14, 4, 72), accent, 1.5, [0, -2.86, 0], [Math.PI / 2, 0, 0])
    rb.metal(drum(-1.6, 1.6, 14.6, 16, 0.4), STEEL)
    for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2
        if (i % 16 < 2 || i % 16 > 14) continue
        for (const y of [1.55, -1.55]) if (rng() > 0.2) rb.glow(new THREE.BoxGeometry(0.2, 0.75, 1.7), WINDOW, 1.3, polar(a, 49.35, y), [0, -a, 0])
        if (i % 2 && rng() > 0.3) rb.glow(new THREE.BoxGeometry(0.2, 0.6, 1.4), 0xcfe6ff, 1.1, polar(a, 42.5, 0.9), [0, -a, 0])
    }
    for (let i = 0; i < 24; i++) {
        if (i % 4 === 0) continue
        const a = (i / 24) * Math.PI * 2
        const tall = i % 4 === 2
        rb.solid(block(4.6, tall ? 1.8 : 1.1, 8.6, 0.25), i % 2 ? PAINT2 : CREAM, polar(a, 46, 2.8 + (tall ? 0.9 : 0.55)), [0, -a, 0])
        rb.metal(block(3.4, 0.8, 7, 0.15), DARK, polar(a, 46, -3.1), [0, -a, 0])
        if (tall) rb.glow(new THREE.BoxGeometry(4.7, 0.3, 0.3), WINDOW, 1.4, polar(a, 46, 3.9, 2), [0, -a, 0])
    }
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        // Spoke: twin tubes, rungs and a lit lift shaft between them.
        for (const t of [-1.5, 1.5]) strut(rb, polar(a, 14, 0, t), polar(a, 43, 0, t), 0.55, PANEL, 6)
        for (let k = 0; k < 7; k++) {
            rb.metal(new THREE.BoxGeometry(0.5, 0.5, 3.4), STEEL, polar(a, 16.5 + k * 4, 0), [0, -a, 0])
            strut(rb, polar(a, 16.5 + k * 4, 0, -1.5), polar(a, 20.5 + k * 4, 0, 1.5), 0.16, DARK, 4)
        }
        rb.metal(new THREE.BoxGeometry(29, 0.9, 0.9), DARK, polar(a, 28.5, 0), [0, -a, 0])
        for (const y of [0.5, -0.5]) rb.glow(new THREE.BoxGeometry(27, 0.08, 0.3), accent, 1.6, polar(a, 28.5, y), [0, -a, 0])
        // Junction module where the spoke meets the ring.
        rb.solid(block(9.4, 8.6, 10, 0.7), PANEL, polar(a, 46, 0), [0, -a, 0])
        rb.solid(block(7, 1.4, 7.6, 0.4), PAINT, polar(a, 46, 4.8), [0, -a, 0])
        rb.solid(block(10, 1.2, 10.4, 0.2), stripe, polar(a, 46, 0), [0, -a, 0])
        rb.glow(new THREE.BoxGeometry(0.2, 0.5, 8), accent, 2.2, polar(a, 50.85, 2.4), [0, -a, 0])
        rb.glow(new THREE.BoxGeometry(0.2, 0.5, 8), accent, 2.2, polar(a, 50.85, -2.4), [0, -a, 0])
        rb.metal(block(1.2, 3, 5, 0.2), DARK, polar(a, 51, 0), [0, -a, 0])
        strut(rb, polar(a, 46, 5.5), polar(a, 46, 10), 0.14, DARK, 4)
        rb.glow(octa(0.45), i % 2 ? GREEN : RED, 4, polar(a, 46, 10.3))
    }
    const ringModel = rb.build()
    const group = new THREE.Group()
    group.add(hubModel.group)
    group.add(ringModel.group)
    return { group, ring: ringModel.group, radius: 50 }
}

// ─── Beacon ────────────────────────────────────────────────────────────────

/**
 * Navigation and claim buoy: an armoured core with an emitter spire and dock
 * clamps, inside two counter-rotating gimbal rings. Every light is the accent
 * colour, so the owner reads from a distance.
 */
export function buildBeacon(accent: number) {
    const ARMOUR = 0xb8c0cb
    const PLATE = 0x7c8694
    const GUN = 0x39414c
    const b = new ModelBuilder()
    // Core: an armoured octagonal body with a lit waist.
    b.solid(tower([
        { z: -2.6, w: 1.5, h: 1.5 }, { z: -2.1, w: 2.3, h: 2.3 }, { z: -0.5, w: 2.5, h: 2.5 }
    ], 8, 1), ARMOUR)
    b.metal(drum(-0.6, 0.6, 2.1, 8, 0.1), DEEP)
    b.glow(drum(-0.32, 0.32, 2.16, 8, 0.05), accent, 2.6)
    b.solid(tower([
        { z: 0.5, w: 2.5, h: 2.5 }, { z: 1.9, w: 2.2, h: 2.2 }, { z: 2.5, w: 1.3, h: 1.3 }
    ], 8, 1), ARMOUR)
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 8
        // Stand-off armour slabs over the waist, a status bar in each gap.
        b.solid(block(0.5, 3.6, 2.1, 0.12), PLATE, polar(a, 2.75, 0), [0, -a, 0])
        b.metal(block(0.35, 1, 1.5, 0.08), GUN, polar(a, 3, 1), [0, -a, 0])
        b.metal(block(0.35, 1, 1.5, 0.08), GUN, polar(a, 3, -1), [0, -a, 0])
        const g = a + Math.PI / 4
        b.glow(new THREE.BoxGeometry(0.1, 1.5, 0.3), accent, 3, polar(g, 2.33, 1.35), [0, -g, 0])
        b.glow(new THREE.BoxGeometry(0.1, 1.5, 0.3), accent, 3, polar(g, 2.33, -1.35), [0, -g, 0])
    }
    // Emitter spire: a caged lantern, stepped collars and a bright tip.
    b.metal(drum(2.5, 2.9, 1.5, 8, 0.1), GUN)
    b.glow(cyl(0.75, 0.9, 1.3, 8), accent, 3.6, [0, 3.55, 0])
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        strut(b, polar(a, 1.25, 2.9), polar(a, 0.95, 4.3), 0.09, GUN, 4)
    }
    b.solid(tower([{ z: 4.2, w: 1.15, h: 1.15 }, { z: 4.6, w: 0.8, h: 0.8 }, { z: 5.6, w: 0.22, h: 0.22 }], 6, 1), ARMOUR)
    b.glow(ring(0.8, 0.07, 4, 12), accent, 3, [0, 4.75, 0], [Math.PI / 2, 0, 0])
    b.glow(ring(0.5, 0.06, 4, 12), accent, 3, [0, 5.15, 0], [Math.PI / 2, 0, 0])
    b.glow(octa(0.36), 0xffffff, 4.5, [0, 5.85, 0])
    // Keel: sensor pod and three dock clamps with guide lights.
    b.metal(tower([{ z: -4.3, w: 0.5, h: 0.5 }, { z: -3.4, w: 1.2, h: 1.2 }, { z: -2.6, w: 1.4, h: 1.4 }], 8, 1), GUN)
    b.glow(octa(0.4), accent, 3.4, [0, -4.6, 0])
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.3
        strut(b, polar(a, 1.2, -2.4), polar(a, 3.4, -3.6), 0.2, PLATE, 5, 0, 'solid')
        strut(b, polar(a, 3.4, -3.6), polar(a, 3.7, -5.2), 0.17, PLATE, 5, 0, 'solid')
        b.metal(block(0.8, 0.5, 1.3, 0.06), GUN, polar(a, 3.4, -3.6), [0, -a, 0])
        for (const t of [-0.42, 0.42]) {
            b.metal(block(0.9, 0.22, 0.22, 0.04), GUN, polar(a, 3.4, -5.3, t), [0, -a, -0.5])
        }
        b.glow(octa(0.16), accent, 4, polar(a, 3.75, -4.4))
    }
    // Whip antennas.
    for (const [a, h] of [[0.9, 2.4], [2.9, 1.7], [5, 2]] as const) {
        strut(b, polar(a, 1.9, 2.1), polar(a, 2.5, 2.1 + h), 0.04, GUN, 4)
        b.glow(octa(0.09), accent, 4, polar(a, 2.5, 2.2 + h))
    }
    const core = b.build()

    // Outer gimbal, standing in the XY plane: armour segments over a dark race, lit on both rims.
    const r1 = new ModelBuilder()
    r1.metal(ring(7.9, 0.4, 6, 36), GUN, [0, 0, 0], [0, 0, 0], [1, 1, 0.7])
    r1.glow(ring(8.42, 0.1, 4, 48), accent, 2.8)
    r1.glow(ring(7.4, 0.08, 4, 48), accent, 2)
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        const at: Vec3 = [Math.cos(a) * 7.9, Math.sin(a) * 7.9, 0]
        if (i % 3 === 0) {
            r1.solid(block(1.5, 1.7, 1.1, 0.12), ARMOUR, at, [0, 0, a])
            r1.metal(block(0.5, 0.9, 1.3, 0.06), GUN, [Math.cos(a) * 8.75, Math.sin(a) * 8.75, 0], [0, 0, a])
            for (const z of [-0.57, 0.57]) r1.glow(new THREE.BoxGeometry(0.7, 0.7, 0.05), accent, 3, [at[0], at[1], z], [0, 0, a + Math.PI / 4])
        } else {
            r1.solid(block(1, 2.9, 0.75, 0.1), i % 3 === 1 ? PLATE : ARMOUR, at, [0, 0, a])
        }
    }
    // Inner gimbal, lying in the XZ plane.
    const r2 = new ModelBuilder()
    r2.metal(ring(6.55, 0.3, 6, 32), GUN, [0, 0, 0], [Math.PI / 2, 0, 0], [1, 1, 0.7])
    r2.glow(ring(6.95, 0.08, 4, 40), accent, 2.4, [0, 0, 0], [Math.PI / 2, 0, 0])
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        r2.solid(block(0.85, 0.6, i % 2 ? 2.6 : 1.3, 0.08), i % 2 ? PLATE : ARMOUR, polar(a, 6.55, 0), [0, -a, 0])
        if (i % 2 === 0) {
            r2.glow(new THREE.BoxGeometry(0.4, 0.05, 0.4), accent, 3, polar(a, 6.55, 0.33), [0, -a, 0])
            r2.glow(new THREE.BoxGeometry(0.4, 0.05, 0.4), accent, 3, polar(a, 6.55, -0.33), [0, -a, 0])
        }
    }
    const group = new THREE.Group()
    const ringA = r1.build().group
    const ringB = r2.build().group
    group.add(core.group, ringA, ringB)
    return { group, ringA, ringB }
}

// ─── Jump gate ─────────────────────────────────────────────────────────────

/** The membrane stretched across the gate: a slow additive swirl, clear enough in the middle to see stars through. */
function gateHorizon(accent: number, radius: number) {
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(accent) } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
            varying vec2 vUv;
            uniform float uTime;
            uniform vec3 uColor;
            void main() {
                vec2 p = vUv * 2.0 - 1.0;
                float r = length(p);
                float a = atan(p.y, p.x);
                float arms = sin(a * 3.0 + r * 9.0 - uTime * 1.3) * 0.5 + 0.5;
                float fine = sin(a * -7.0 + r * 17.0 + uTime * 0.9) * 0.5 + 0.5;
                float ripple = sin(r * 26.0 - uTime * 2.2) * 0.5 + 0.5;
                float outer = smoothstep(0.25, 1.0, r);
                float edge = smoothstep(1.0, 0.9, r);
                float v = 0.1 + outer * (0.25 + arms * fine * 1.5 + ripple * 0.18) + pow(outer, 6.0) * 1.4;
                gl_FragColor = vec4(mix(uColor, vec3(1.0), pow(outer, 8.0) * 0.5) * v * edge, 1.0);
            }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    })
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), material)
    mesh.name = 'horizon'
    mesh.onBeforeRender = () => {
        material.uniforms.uTime!.value = performance.now() / 1000
    }
    return mesh
}

/**
 * The jump gate: a segmented armoured ring you fly through along its Z axis,
 * braced by four pylons, with a membrane across the opening. `spin` is the
 * inner emitter rotor; the frame itself stands still.
 */
export function buildGate(accent: number) {
    const HULL = 0x4a5160
    const R = 45
    const at = (a: number, r: number, z = 0, t = 0): Vec3 => [Math.cos(a) * r - Math.sin(a) * t, Math.sin(a) * r + Math.cos(a) * t, z]
    const b = new ModelBuilder()
    // Conduit race: only seen through the gaps between segments.
    b.metal(ring(R, 3, 8, 48), DEEP)
    for (const z of [-2.4, 0, 2.4]) b.glow(ring(R + (z ? 2.2 : 3.1), 0.32, 4, 64), accent, 2.4, [0, 0, z])
    for (const z of [-3.1, 3.1]) b.glow(ring(R - 1, 0.26, 4, 64), accent, 2, [0, 0, z])

    const segments = 12
    for (let i = 0; i < segments; i++) {
        const a = ((i + 0.5) / segments) * Math.PI * 2
        const rot: Vec3 = [0, 0, a]
        // Armoured segment: core block, stepped outer cap, inner lip, face plates fore and aft.
        b.solid(block(8.6, 19, 9.4, 0.8), HULL, at(a, R), rot)
        b.solid(block(2.6, 15, 11.6, 0.5), PANEL, at(a, R + 5), rot)
        b.solid(block(1.6, 9, 8, 0.4), PAINT2, at(a, R + 6.8), rot)
        b.metal(block(1.6, 16.5, 7, 0.3), DARK, at(a, R - 4.7), rot)
        b.glow(new THREE.BoxGeometry(0.25, 13, 0.5), accent, 2.6, at(a, R - 5.6), rot)
        for (const z of [-1, 1]) {
            b.solid(block(5.2, 13.5, 1.4, 0.35), i % 2 ? PAINT2 : PANEL, at(a, R + 0.6, z * 5), rot)
            b.metal(block(1.2, 17, 1, 0.2), DARK, at(a, R - 2.9, z * 4.9), rot)
            // Chevron pointing into the gate.
            for (const s of [-1, 1]) b.glow(new THREE.BoxGeometry(3.4, 0.55, 0.2), accent, 3, at(a, R + 0.8, z * 5.75, s * 1.35), [0, 0, a + s * 0.95])
            b.glow(new THREE.BoxGeometry(0.5, 0.5, 0.2), WINDOW, 2.6, at(a, R + 2.2, z * 5.75, 5.2), rot)
            b.glow(new THREE.BoxGeometry(0.5, 0.5, 0.2), WINDOW, 2.6, at(a, R + 2.2, z * 5.75, -5.2), rot)
        }
        // Coupling between this segment and the next.
        const g = a + Math.PI / segments
        for (const z of [-3.4, 3.4]) strut(b, at(g, R + 1.5, z, -3), at(g, R + 1.5, z, 3), 0.7, STEEL, 6)
        b.metal(block(3, 2.4, 5, 0.3), STEEL, at(g, R + 3.4), [0, 0, g])
        b.glow(octa(0.5), i % 2 ? RED : WINDOW, 3.5, at(g, R + 5.2))
    }

    // Four pylons: layered fins with a lit spine, and emitter prongs reaching fore and aft.
    const fin = (pts: [number, number][], thickness: number) => slab(pts, thickness, 0.3).rotateX(-Math.PI / 2)
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        const rot: Vec3 = [0, 0, a - Math.PI / 2]
        b.solid(fin([[-9, 0], [9, 0], [5.5, 13], [2.2, 34], [-2.2, 34], [-5.5, 13]], 4.4), HULL, at(a, R + 3), rot)
        b.solid(fin([[-6.5, 0], [6.5, 0], [3.6, 12], [1.2, 27], [-1.2, 27], [-3.6, 12]], 6.4), PANEL, at(a, R + 4), rot)
        b.solid(fin([[-4, 0], [4, 0], [2.2, 9], [-2.2, 9]], 8.4), PAINT2, at(a, R + 5), rot)
        b.metal(block(7, 3, 9.6, 0.4), DARK, at(a, R + 17), [0, 0, a])
        for (const z of [-3.3, 3.3]) {
            b.glow(new THREE.BoxGeometry(20, 0.5, 0.2), accent, 2.6, at(a, R + 20, z), [0, 0, a])
            for (let k = 0; k < 4; k++) b.glow(new THREE.BoxGeometry(0.7, 0.45, 0.15), WINDOW, 1.8, at(a, R + 9 + k * 1.6, z * 1.3, 2.4), [0, 0, a])
        }
        b.metal(block(3, 2.2, 3, 0.3), STEEL, at(a, R + 37), [0, 0, a])
        strut(b, at(a, R + 38), at(a, R + 47), 0.2, DARK, 5)
        b.glow(octa(0.9), i % 2 ? RED : GREEN, 4.5, at(a, R + 47.6))
        for (const z of [-1, 1]) {
            strut(b, at(a, R + 9, z * 4), at(a, R + 3, z * 17), 1.3, PANEL, 6, 0, 'solid')
            strut(b, at(a, R + 3, z * 17), at(a, R - 5, z * 27), 0.8, HULL, 6, 0, 'solid')
            strut(b, at(a, R + 16, z * 3), at(a, R + 3, z * 17), 0.35, STEEL, 5)
            b.metal(ico(1.5, 1), STEEL, at(a, R + 3, z * 17))
            b.glow(octa(1.1), accent, 4, at(a, R - 5.6, z * 27.8))
            b.glow(ring(1.5, 0.12, 4, 12), accent, 2.6, at(a, R - 3.4, z * 25), [Math.atan2(8, -10 * z) + Math.PI / 2, 0, a], [1, 1, 1])
        }
    }
    const frame = b.build()

    // Rotor: emitter claws on a bright race just inside the ring.
    const rotor = new ModelBuilder()
    rotor.glow(ring(38, 1, 6, 64), accent, 3)
    rotor.metal(ring(39.3, 0.7, 4, 48), DARK, [0, 0, 0], [0, 0, 0], [1, 1, 2.4])
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        rotor.solid(block(3, 5, 3.4, 0.3), PANEL, at(a, 39.2), [0, 0, a])
        rotor.solid(fin([[-1.6, 0], [1.6, 0], [0.3, 5.5], [-0.3, 5.5]], 1.2), HULL, at(a, 38), [0, 0, a + Math.PI / 2])
        rotor.glow(octa(0.7), 0xffffff, 4, at(a, 32))
    }
    const spin = rotor.build().group
    spin.add(gateHorizon(accent, 37.6))

    const group = new THREE.Group()
    group.add(frame.group, spin)
    return { group, spin, radius: R + 48 }
}

// ─── Free Trader ───────────────────────────────────────────────────────────

/**
 * The wandering merchant: a fat civilian hauler hung with bulbous cargo
 * modules, striped awnings, gold solar sails, shop signs and strings of lanterns.
 */
export function buildTrader(glow: number) {
    const HULL = 0xd9cdb4
    const HULL2 = 0x3f7f7a
    const RUST = 0xc8683a
    const MUSTARD = 0xd9a441
    const BERRY = 0xa8435c
    const PINK = 0xff5fa8
    const AMBER = 0xffb347
    const GOLD = 0xc99a3a
    const livery: Livery = { paint: HULL, paint2: HULL2, trim: 0x6b5a48, metal: 0x6f6a62, accent: RUST, glow, glass: 0x0b0f14 }
    const b = new ModelBuilder()

    // Hull: a rounded bow, a narrow spine for the cargo, a boxy engine house aft.
    const bow: Section[] = [
        { z: -17, w: 0.5, h: 0.4, y: 0.3 }, { z: -15.6, w: 2.2, h: 1.7, y: 0.2 }, { z: -12, w: 3.7, h: 2.8 },
        { z: -7.5, w: 3.9, h: 3 }, { z: -4.4, w: 3, h: 2.5 }, { z: -3, w: 1.6, h: 1.5 }
    ]
    b.solid(loft(bow, 12, 0.85), HULL)
    b.solid(loft([{ z: -12.6, w: 3.74, h: 0.5, y: -0.6 }, { z: -7, w: 3.95, h: 0.55, y: -0.6 }, { z: -4.6, w: 3.1, h: 0.5, y: -0.6 }], 12, 0.85), HULL2)
    b.solid(loft([{ z: -11.4, w: 3.72, h: 0.16, y: 0.3 }, { z: -5, w: 3.4, h: 0.16, y: 0.3 }], 12, 0.85), RUST)
    b.solid(loft([{ z: -14, w: 3, h: 1.4, y: -1.9 }, { z: -9, w: 3.4, h: 1.6, y: -2 }, { z: -4.5, w: 2.4, h: 1.2, y: -1.7 }], 8, 0.6), livery.trim)
    b.metal(loft([{ z: -3.4, w: 1.5, h: 1.5 }, { z: 9.6, w: 1.5, h: 1.5 }], 8, 0.6), 0x4a4640)
    for (let k = 0; k < 7; k++) b.metal(block(3.4, 3.4, 0.5, 0.1), livery.metal, [0, 0, -2.4 + k * 1.85])
    b.solid(loft([
        { z: 9, w: 2.2, h: 2 }, { z: 10.4, w: 3.6, h: 3 }, { z: 14.6, w: 3.6, h: 3 }, { z: 16, w: 2.9, h: 2.4 }
    ], 8, 0.5), HULL)
    b.solid(loft([{ z: 10.8, w: 3.66, h: 0.7, y: 1.2 }, { z: 14.2, w: 3.66, h: 0.7, y: 1.2 }], 8, 0.5), HULL2)
    b.solid(block(5.4, 1.4, 4.6, 0.3), livery.trim, [0, 3.4, 12.4])
    b.metal(block(7.6, 0.5, 3, 0.1), 0x4a4640, [0, -3, 12.6])

    // Bridge: a big glass bubble with a warm sill, windows down both flanks of the bow.
    b.glass(loft([
        { z: -14.4, w: 0.4, h: 0.3, y: 1.6 }, { z: -13, w: 1.9, h: 1.1, y: 2.4 }, { z: -10.6, w: 2.3, h: 1.5, y: 2.9 }, { z: -8.6, w: 1.4, h: 0.8, y: 2.9 }
    ], 10, 0.95), livery.glass)
    b.solid(block(3.6, 1.2, 3.4, 0.3), HULL2, [0, 3.2, -7.2])
    b.glow(new THREE.BoxGeometry(4.2, 0.1, 0.1), WINDOW, 2, [0, 2.2, -12.2])
    b.glow(new THREE.BoxGeometry(3, 0.4, 0.08), WINDOW, 1.6, [0, 3.3, -5.46])
    for (let k = 0; k < 6; k++) {
        b.glow(new THREE.BoxGeometry(0.08, 0.5, 0.8), WINDOW, 1.5, [3.78 - Math.abs(k - 2.5) * 0.05, 1.2, -11.4 + k * 1.3], [0, 0, 0], [1, 1, 1], true)
        if (k % 2 === 0) b.glow(new THREE.BoxGeometry(0.08, 0.4, 0.6), WINDOW, 1.3, [3.62, -1.6, -11 + k * 1.3], [0, 0, 0], [1, 1, 1], true)
    }
    for (let k = 0; k < 3; k++) b.glow(new THREE.BoxGeometry(0.08, 0.6, 0.7), WINDOW, 1.5, [3.64, -0.4, 11.2 + k * 1.3], [0, 0, 0], [1, 1, 1], true)

    // Cargo bulbs strapped along the spine: three fat pairs, smaller ones above and below.
    const colors = [RUST, MUSTARD, HULL2, BERRY, HULL, MUSTARD]
    for (let k = 0; k < 3; k++) {
        const z = -0.4 + k * 3.7
        for (const side of [-1, 1]) {
            const c = colors[(k * 2 + (side > 0 ? 1 : 0)) % colors.length]!
            b.solid(ico(2, 2), c, [side * 3.7, -0.1, z], [0, 0, 0], [1.2, 1.05, 0.88])
            b.metal(ring(2.02, 0.1, 4, 16), livery.metal, [side * 3.7, -0.1, z], [0, 0, 0], [1.2, 1.05, 1])
            b.metal(ring(1.78, 0.1, 4, 16), livery.metal, [side * 3.7, -0.1, z], [0, Math.PI / 2, 0], [1, 1.05, 1])
            b.metal(tube(0.5, 0.5, 1.4, 6), 0x4a4640, [side * 1.8, -0.1, z], [0, Math.PI / 2, 0])
            b.glow(new THREE.BoxGeometry(0.1, 0.35, 0.35), glow, 2.4, [side * 6.12, -0.1, z])
        }
        if (k < 2) {
            b.solid(ico(1.35, 1), colors[(k + 3) % colors.length]!, [0, -2.5, z + 1.85], [0, 0, 0], [1, 0.9, 1])
            b.metal(ring(1.37, 0.08, 4, 12), livery.metal, [0, -2.5, z + 1.85], [0, Math.PI / 2, 0])
        }
    }
    tank(b, livery, HULL, [1.2, 2.1, 3.4], 0.7, 5.5, true)

    // Striped market awnings over the cargo, held out on poles, with a scalloped edge.
    for (const side of [-1, 1]) {
        const tilt = -0.2 * side
        for (let k = 0; k < 9; k++) {
            const z = -2.6 + k * 1.35
            const c = k % 2 ? 0xeadfc6 : 0xc8443a
            b.solid(block(6.4, 0.1, 1.33, 0.02), c, [side * 4.7, 3.05, z], [0, 0, tilt])
            b.solid(new THREE.ConeGeometry(0.62, 0.75, 3), c, [side * 7.85, 2.06, z], [Math.PI, Math.PI / 6 * side + Math.PI / 2, 0], [1, 1, 0.25])
        }
        b.metal(new THREE.BoxGeometry(0.16, 0.16, 12.4), livery.trim, [side * 7.85, 2.42, 2.8])
        b.metal(new THREE.BoxGeometry(0.16, 0.16, 12.4), livery.trim, [side * 1.6, 3.68, 2.8])
        for (const z of [-2.8, 2.8, 8.4]) strut(b, [side * 7.8, 2.4, z], [side * 5.6, 0.4, z + (z < 8 ? 0.95 : -1.9)], 0.07, livery.trim, 4)
        b.glow(new THREE.BoxGeometry(0.08, 0.08, 12), WINDOW, 1.5, [side * 7.7, 2.28, 2.8])
    }

    // Solar sails: gold foil fans on a stern mast, ribs lit faintly.
    strut(b, [0, 4, 12.4], [0, 13.5, 12.4], 0.22, livery.trim, 6)
    const sail = (pts: [number, number][]) => slab(pts, 0.08, 0.02).rotateX(-Math.PI / 2)
    for (const side of [-1, 1]) {
        const rot: Vec3 = [0, -0.45 * side, 0]
        const pts: [number, number][] = side > 0 ? [[0.3, 0], [9.5, 2.5], [8, 7.5], [0.3, 8.6]] : [[-0.3, 8.6], [-8, 7.5], [-9.5, 2.5], [-0.3, 0]]
        b.metal(sail(pts), GOLD, [0, 4.6, 12.4], rot)
        for (const [x, y] of [[9.5, 2.5], [8.8, 5], [8, 7.5]] as const) {
            const c = Math.cos(0.45)
            const s = Math.sin(0.45)
            strut(b, [side * 0.3, 8.9, 12.4], [side * x * c, 4.6 + y, 12.4 + x * s], 0.06, livery.trim, 4)
        }
        strut(b, [side * 0.3, 4.6, 12.4], [side * 9.5 * Math.cos(0.45), 7.1, 12.4 + 9.5 * Math.sin(0.45)], 0.09, livery.trim, 4)
    }
    b.glow(octa(0.3), AMBER, 4, [0, 13.8, 12.4])
    dish(b, livery, [-1.6, 4.1, 13.6], 1.2)

    // Shop signs: glyph boards on the engine house and a rooftop billboard.
    const glyphs = (x: number, y: number, z0: number, face: number, seed: number) => {
        const rng = mulberry32(seed)
        let z = z0
        for (let k = 0; k < 7; k++) {
            const w = 0.25 + rng() * 0.5
            const h = 0.5 + rng() * 0.9
            b.glow(new THREE.BoxGeometry(0.06, h, w), [PINK, AMBER, glow][k % 3]!, 2.4, [x + face * 0.12, y + (rng() - 0.5) * 0.3, z + w / 2])
            z += w + 0.22
        }
    }
    for (const side of [-1, 1]) {
        b.metal(block(0.2, 2.2, 5.4, 0.06), DEEP, [side * 3.78, -0.9, 12.6])
        b.glow(new THREE.BoxGeometry(0.05, 2.3, 0.08), glow, 2, [side * 3.9, -0.9, 9.95])
        b.glow(new THREE.BoxGeometry(0.05, 2.3, 0.08), glow, 2, [side * 3.9, -0.9, 15.25])
        glyphs(side * 3.8, -0.9, 10.3, side, 11 + side)
    }
    b.metal(block(0.3, 2.6, 7, 0.08), DEEP, [0, 6.2, -4])
    for (const z of [-6.8, -1.2]) strut(b, [0, 3.2, z], [0, 5, z], 0.12, livery.trim, 4)
    for (const face of [-1, 1]) {
        glyphs(face * 0.12, 6.5, -7, face, 40 + face)
        b.glow(new THREE.BoxGeometry(0.06, 0.14, 6.2), AMBER, 2.2, [face * 0.2, 5.3, -4])
        b.glow(new THREE.BoxGeometry(0.06, 0.14, 6.2), PINK, 2.2, [face * 0.2, 7.2, -4])
    }

    // Lantern strings from the billboard to the mast and down to the bow.
    const lantern = (from: Vec3, to: Vec3, count: number, sag: number) => {
        let prev = from
        for (let k = 1; k <= count; k++) {
            const u = k / count
            const p: Vec3 = [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u - Math.sin(u * Math.PI) * sag, from[2] + (to[2] - from[2]) * u]
            strut(b, prev, p, 0.025, 0x2a2622, 3)
            if (k < count) b.glow(octa(0.17), [WINDOW, AMBER, PINK, glow][k % 4]!, 3.2, [p[0], p[1] - 0.2, p[2]])
            prev = p
        }
    }
    lantern([0, 7.5, -0.6], [0, 13.2, 12.4], 9, 2.2)
    lantern([0, 7.5, -7.4], [0, 1.6, -15.4], 6, 0.9)
    for (const side of [-1, 1]) lantern([side * 7.85, 2.5, -3.2], [side * 3, 3.4, -7.2], 4, 0.4)

    // A landing stall slung under the bow for visiting pilots.
    b.metal(block(6.4, 0.3, 5.4, 0.08), 0x4a4640, [0, -4.4, -9])
    for (const x of [-2.6, 2.6]) for (const z of [-11, -7]) strut(b, [x, -4.3, z], [x * 0.8, -3, z], 0.1, livery.trim, 4)
    for (let k = 0; k < 5; k++) {
        b.glow(new THREE.BoxGeometry(0.2, 0.06, 0.2), glow, 3, [3, -4.22, -11.2 + k * 1.1], [0, 0, 0], [1, 1, 1], true)
    }
    b.glow(new THREE.BoxGeometry(3, 0.04, 0.2), glow, 1.6, [0, -4.23, -9])
    b.glow(new THREE.BoxGeometry(0.2, 0.04, 3), glow, 1.6, [0, -4.23, -9])

    // Engines: two big bells and a small one, civilian and unhurried.
    b.metal(tube(1.8, 1.6, 1.4, 10), 0x4a4640, [2, -0.4, 16.2], [0, 0, 0], [1, 1, 1], true)
    b.engine([2, -0.4, 16.6], 1.35, true, glow)
    b.engine([0, 1.7, 16.2], 0.7, false, glow)
    b.glow(octa(0.16), RED, 3.5, [-3.8, 1, -9])
    b.glow(octa(0.16), GREEN, 3.5, [3.8, 1, -9])
    return b.build()
}

// ─── Wrecks ────────────────────────────────────────────────────────────────

const SOOT = 0x121316
const RIB = 0x3b3f46
const WRECK_PALETTES: [number, number, number][] = [
    [0x6a7280, 0x4a515c, 0x8a3a30],
    [0x7a5a4a, 0x57423a, 0xc9a24a],
    [0x39475c, 0x2b3646, 0xb8bec8],
    [0x5d6650, 0x454c3c, 0x8a5a2b],
    [0xa9aeb5, 0x7c828c, 0x9a2f2f]
]

/** A point on a section's rim, matching the loft's rounded polygon. */
function rimPoint(s: Section, phi: number, roundness: number): [number, number] {
    const c = Math.cos(phi)
    const sn = Math.sin(phi)
    return [s.w * Math.sign(c) * Math.pow(Math.abs(c), roundness), (s.y ?? 0) + s.h * Math.sign(sn) * Math.pow(Math.abs(sn), roundness)]
}

/**
 * Everything that makes a hull end look ripped open: a black cavity, decks and
 * bulkheads poking out of it, broken rib hoops, peeled plating, hanging cables
 * and a few embers. `dir` is which way along Z the wound faces.
 */
function tornEnd(f: Sink, rng: Rng, s: Section, dir: 1 | -1, roundness: number, sides: number, paint: number) {
    const y = s.y ?? 0
    const z = s.z
    f.metal(loft([{ z: z - 0.5, w: s.w * 0.9, h: s.h * 0.9, y }, { z: z + 0.5, w: s.w * 0.9, h: s.h * 0.9, y }], sides, roundness), SOOT, [0, 0, dir * 0.12])
    // Decks and a bulkhead stub.
    const decks = 2 + Math.floor(rng() * 2)
    for (let k = 0; k < decks; k++) {
        const dy = y + ((k + 0.5) / decks - 0.5) * s.h * 1.5
        const len = 0.8 + rng() * 2.6
        const w = s.w * (1.3 + rng() * 0.3) * Math.sqrt(Math.max(0.2, 1 - Math.pow((dy - y) / s.h, 2)))
        f.solid(block(w, 0.14, len, 0.03), 0x4c5058, [(rng() - 0.5) * 0.3, dy, z + dir * len * 0.4], [(rng() - 0.5) * 0.25, 0, (rng() - 0.5) * 0.08])
    }
    f.solid(block(0.14, s.h * 1.5, 1 + rng() * 1.6, 0.03), 0x43474f, [(rng() - 0.5) * s.w, y, z + dir * 0.5], [0, (rng() - 0.5) * 0.3, 0])
    // Rib hoops marching into the gap, each one less complete than the last.
    const hoops = 2 + Math.floor(rng() * 3)
    for (let k = 0; k < hoops; k++) {
        const arc = Math.PI * (1.7 - k * 0.35 - rng() * 0.3)
        const geo = new THREE.TorusGeometry(1, 0.06 / Math.min(s.w, s.h) + 0.035, 4, 12, Math.max(0.8, arc)).rotateZ(rng() * Math.PI * 2)
        f.metal(geo, RIB, [0, y, z + dir * (0.7 + k * 1.05)], [0, (rng() - 0.5) * 0.12, 0], [s.w * 0.97, s.h * 0.97, 1])
    }
    // Stringers still joining the hoops.
    for (let k = 0; k < 4; k++) {
        const [x, ry] = rimPoint(s, rng() * Math.PI * 2, roundness)
        f.metal(new THREE.BoxGeometry(0.09, 0.09, 1), RIB, [x * 0.96, y + (ry - y) * 0.96, z + dir * (0.5 + rng() * 1.4)], [0, 0, 0], [1, 1, 1.4 + rng() * 2.6])
    }
    // Peeled plating around the rim.
    const plates = 6 + Math.floor(rng() * 4)
    for (let k = 0; k < plates; k++) {
        const phi = ((k + rng() * 0.7) / plates) * Math.PI * 2
        const [x, ry] = rimPoint(s, phi, roundness)
        const half = (0.35 + rng() * 0.5) * Math.max(s.w, s.h) * 0.45
        const len = 0.8 + rng() * 2.4
        const geo = slab([[-half, -0.3], [half, -0.3], [half * (0.2 + rng() * 0.6), len * (0.5 + rng() * 0.5)], [(rng() - 0.5) * half, len], [-half * (0.3 + rng() * 0.6), len * (0.3 + rng() * 0.4)]], 0.07, 0.015)
        geo.rotateX(-(0.1 + rng() * 0.9))
        if (dir < 0) geo.rotateY(Math.PI)
        f.solid(geo, rng() < 0.6 ? paint : SOOT, [x, ry, z], [0, 0, phi - Math.PI / 2])
    }
    // Cables hanging out of the wound, one or two still sparking.
    const cables = 3 + Math.floor(rng() * 3)
    for (let k = 0; k < cables; k++) {
        const [x, ry] = rimPoint(s, rng() * Math.PI * 2, roundness)
        let p: Vec3 = [x * 0.8, y + (ry - y) * 0.8, z]
        const drift: Vec3 = [(rng() - 0.5) * 0.7, -0.2 - rng() * 0.7, dir * (0.3 + rng() * 0.6)]
        const links = 3 + Math.floor(rng() * 3)
        for (let j = 0; j < links; j++) {
            const q: Vec3 = [p[0] + drift[0] + (rng() - 0.5) * 0.5, p[1] + drift[1] * (1 + j * 0.5), p[2] + drift[2] * (1 - j * 0.2)]
            strut(f, p, q, 0.035, 0x1b1d21, 4)
            p = q
        }
        if (k < 2) f.glow(octa(0.09), k ? 0x8fd8ff : 0xffc46a, 3.5, p)
    }
    for (let k = 0; k < 2; k++) {
        f.glow(octa(0.14 + rng() * 0.16), 0xff7a2e, 1.6 + rng() * 2, [(rng() - 0.5) * s.w, y + (rng() - 0.5) * s.h, z - dir * rng() * 0.3])
    }
}

/** Scorch belt, soot blooms and rows of dead windows along a hull between two stations. */
function weather(f: Sink, rng: Rng, sections: Section[], z0: number, z1: number, roundness: number, sides: number) {
    const lerp = (z: number): Section => {
        for (let i = 0; i < sections.length - 1; i++) {
            const a = sections[i]!
            const c = sections[i + 1]!
            if (z >= a.z && z <= c.z) {
                const t = (z - a.z) / (c.z - a.z)
                return { z, w: a.w + (c.w - a.w) * t, h: a.h + (c.h - a.h) * t, y: (a.y ?? 0) + ((c.y ?? 0) - (a.y ?? 0)) * t }
            }
        }
        return { ...sections[0]!, z }
    }
    for (let k = 0; k < 5; k++) {
        const s = lerp(z0 + rng() * (z1 - z0))
        const [x, y] = rimPoint(s, rng() * Math.PI * 2, roundness)
        const r = 0.5 + rng() * 1.1
        f.metal(ico(r, 1), SOOT, [x * 0.9, (s.y ?? 0) + (y - (s.y ?? 0)) * 0.9, s.z], [rng() * 3, rng() * 3, 0], [1, 1, 1.4])
    }
    const count = Math.floor((z1 - z0) / 0.8)
    for (const side of [-1, 1]) {
        for (let k = 1; k < count; k++) {
            if (rng() < 0.3) continue
            const s = lerp(z0 + k * 0.8)
            const [x, y] = rimPoint(s, side > 0 ? 0.35 : Math.PI - 0.35, roundness)
            const lit = rng() < 0.06
            if (lit) f.glow(new THREE.BoxGeometry(0.06, 0.24, 0.42), 0xffb060, 0.8, [x * 1.01, y, s.z])
            else f.glass(new THREE.BoxGeometry(0.08, 0.26, 0.44), 0x07090c, [x * 1.005, y, s.z])
        }
    }
    void sides
}

/** A ship broken across the keel: two halves hinged apart, the spine girder still bridging the gap. */
function shipWreck(b: ModelBuilder, rng: Rng, warship: boolean) {
    const [paint, paint2, stripe] = WRECK_PALETTES[Math.floor(rng() * WRECK_PALETTES.length)]!
    const sides = warship ? 6 : 8
    const roundness = warship ? 0.85 : 0.45
    const L = 20 + rng() * 8
    const w = (warship ? 2 : 2.6) + rng() * 0.9
    const h = (warship ? 1.5 : 2) + rng() * 0.7
    const zb = L * (-0.12 + rng() * 0.3)
    const gap = 1.6 + rng() * 1.6
    const hinge = (0.3 + rng() * 0.45) * (rng() < 0.5 ? 1 : -1)
    const frame = (rx: number, ry: number, rz: number, off: Vec3) => {
        const pivot = new THREE.Matrix4().makeTranslation(0, -h * Math.sign(hinge), zb)
        const back = new THREE.Matrix4().makeTranslation(-off[0], h * Math.sign(hinge) - off[1], -zb - off[2])
        const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz))
        return new Frame(b, pivot.multiply(rot).multiply(back.invert()).multiply(new THREE.Matrix4().makeTranslation(0, h * Math.sign(hinge), -zb)).multiply(new THREE.Matrix4().makeTranslation(0, -h * Math.sign(hinge), zb)).multiply(new THREE.Matrix4().makeTranslation(0, h * Math.sign(hinge), -zb)))
    }
    const fore = frame(hinge / 2, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.4, [0, 0, -gap / 2])
    const aft = frame(-hinge / 2, (rng() - 0.5) * 0.2, (rng() - 0.5) * 0.3, [(rng() - 0.5) * 1.2, 0, gap / 2])

    // Fore half: nose to the break.
    const zf = zb - 0.2
    const foreSections: Section[] = [
        { z: -L / 2, w: w * 0.12, h: h * 0.15, y: warship ? 0 : -h * 0.3 },
        { z: -L / 2 + L * 0.1, w: w * (warship ? 0.5 : 0.75), h: h * 0.6, y: warship ? 0 : -h * 0.15 },
        { z: -L / 2 + L * 0.24, w, h },
        { z: zf, w: w * (0.92 + rng() * 0.1), h: h * (0.9 + rng() * 0.1) }
    ]
    fore.solid(loft(foreSections, sides, roundness), paint)
    const mid = (-L / 2 + L * 0.24 + zf) / 2
    fore.solid(loft([{ z: mid - 0.9, w: w + 0.04, h: h + 0.04 }, { z: mid + 0.6, w: w + 0.04, h: h + 0.04 }], sides, roundness), stripe)
    fore.metal(loft([{ z: zf - 2.2 - rng(), w: w + 0.03, h: h + 0.03 }, { z: zf, w: w * 0.96 + 0.03, h: h * 0.95 + 0.03 }], sides, roundness), SOOT)
    // Bridge block with blown-out glazing.
    const bz = -L / 2 + L * 0.3
    fore.solid(block(w * 1.1, h * 0.7, 3.2, 0.15), paint2, [0, h + h * 0.25, bz])
    fore.solid(block(w * 0.7, h * 0.45, 1.8, 0.1), paint, [0, h + h * 0.8, bz + 0.4])
    fore.glass(new THREE.BoxGeometry(w * 0.72, h * 0.22, 0.1), 0x07090c, [0, h + h * 0.85, bz - 0.5])
    fore.glass(new THREE.BoxGeometry(w * 1.0, h * 0.25, 0.1), 0x07090c, [0, h + h * 0.35, bz - 1.58])
    strut(fore, [w * 0.3, h * 2, bz + 0.6], [w * 0.3 + 0.9, h * 2 + 1.6, bz + 1.4], 0.04, RIB, 4)
    weather(fore, rng, foreSections, -L / 2 + L * 0.2, zf - 0.6, roundness, sides)
    tornEnd(fore, rng, foreSections[3]!, 1, roundness, sides, paint)

    // Aft half: the break back to a dead engine block.
    const za = zb + 0.2
    const aftSections: Section[] = [
        { z: za, w: w * (0.92 + rng() * 0.1), h: h * (0.9 + rng() * 0.1) },
        { z: L / 2 - L * 0.18, w, h },
        { z: L / 2 - L * 0.05, w: w * 0.9, h: h * 0.9 },
        { z: L / 2, w: w * 0.7, h: h * 0.7 }
    ]
    aft.solid(loft(aftSections, sides, roundness), paint)
    aft.metal(loft([{ z: za, w: w * 0.96 + 0.03, h: h * 0.95 + 0.03 }, { z: za + 1.8 + rng() * 1.5, w: w + 0.03, h: h + 0.03 }], sides, roundness), SOOT)
    aft.solid(loft([{ z: L / 2 - L * 0.2, w: w + 0.12, h: h + 0.12 }, { z: L / 2 - L * 0.06, w: w * 0.95 + 0.12, h: h * 0.95 + 0.12 }], sides, roundness), paint2)
    const bells = warship ? 3 : 2
    for (let k = 0; k < bells; k++) {
        const x = (k - (bells - 1) / 2) * w * (warship ? 0.62 : 0.9)
        aft.metal(tube(h * 0.36, h * 0.5, 1.5, 8), 0x23262b, [x, 0, L / 2 + 0.5])
        aft.metal(ring(h * 0.5, 0.06, 4, 10), RIB, [x, 0, L / 2 + 1.25])
        aft.glass(new THREE.CircleGeometry(h * 0.44, 8), 0x050607, [x, 0, L / 2 + 1.2])
    }
    weather(aft, rng, aftSections, za + 0.6, L / 2 - L * 0.2, roundness, sides)
    tornEnd(aft, rng, aftSections[0]!, -1, roundness, sides, paint)

    if (warship) {
        // One wing still on, the other a stump; turret hulks with drooping barrels.
        const keep = rng() < 0.5 ? 1 : -1
        for (const side of [-1, 1]) {
            const span = side === keep ? 5 + rng() * 2 : 1 + rng()
            const pts: [number, number][] = side > 0
                ? [[0, -2.5], [span, side === keep ? 0.5 : -1.6], [span * (side === keep ? 1 : 0.7), 1.6], [0, 2.5]]
                : [[0, 2.5], [-span * (side === keep ? 1 : 0.7), 1.6], [-span, side === keep ? 0.5 : -1.6], [0, -2.5]]
            aft.solid(slab(pts, 0.35, 0.08), paint2, [side * w * 0.9, -0.1, L / 2 - L * 0.2], [0, 0, side * -0.08])
            if (side !== keep) {
                for (let k = 0; k < 3; k++) strut(aft, [side * (w * 0.9 + span), -0.1, L / 2 - L * 0.2 - 1.2 + k * 1.1], [side * (w * 0.9 + span + 0.6 + rng() * 1.4), -0.3 - rng(), L / 2 - L * 0.2 - 1.2 + k * 1.3], 0.06, RIB, 4)
            }
        }
        for (const [fr, z] of [[fore, mid + 1.6], [aft, L / 2 - L * 0.3]] as const) {
            fr.metal(cyl(0.7, 0.85, 0.4, 8), RIB, [0, h + 0.2, z])
            fr.solid(block(1.1, 0.6, 1.4, 0.1), paint2, [0, h + 0.65, z], [0, rng() * 2, 0])
            strut(fr, [0.25, h + 0.7, z], [0.6 + rng(), h + 0.3 + rng() * 0.5, z - 2.2], 0.07, 0x23262b, 5)
        }
    } else {
        // Container racks down both flanks, some boxes gone, scorched frames left behind.
        for (const [fr, z0, z1] of [[fore, -L / 2 + L * 0.34, zf - 2.4], [aft, za + 2.4, L / 2 - L * 0.24]] as const) {
            for (let z = z0; z < z1; z += 2.1) {
                for (const side of [-1, 1]) {
                    fr.metal(new THREE.BoxGeometry(0.12, 1.7, 0.12), RIB, [side * (w + 0.9), -0.2, z - 0.95])
                    if (rng() < 0.45) continue
                    fr.solid(block(1.6, 1.6, 1.9, 0.06), rng() < 0.25 ? SOOT : POD_COLORS[Math.floor(rng() * POD_COLORS.length)]!, [side * (w + 0.9), -0.2, z], [0, (rng() - 0.5) * 0.15, (rng() - 0.5) * 0.1])
                }
            }
        }
    }

    // The keel girder, bent through the break, and whatever spilled out around it.
    const ky = -h * Math.sign(hinge) * 0.9
    strut(b, [0.4, ky, zb - gap - 2.5], [0.1, ky - Math.sign(hinge) * 0.5, zb], 0.16, RIB, 5)
    strut(b, [0.1, ky - Math.sign(hinge) * 0.5, zb], [0.5, ky, zb + gap + 2.5], 0.16, RIB, 5)
    strut(b, [-0.5, ky, zb - gap - 2], [-0.4, ky - Math.sign(hinge) * 0.9, zb + 0.6], 0.1, RIB, 4)
    const debris = 6 + Math.floor(rng() * 5)
    for (let k = 0; k < debris; k++) {
        const s = 0.4 + rng() * 1.1
        const pos: Vec3 = [(rng() - 0.5) * w * 5, (rng() - 0.5) * h * 5 - Math.sign(hinge) * -2, zb + (rng() - 0.5) * 7]
        const rot: Vec3 = [rng() * 6, rng() * 6, rng() * 6]
        if (rng() < 0.7) b.solid(slab([[-s, -s * 0.6], [s * 0.8, -s], [s, s * 0.5], [-s * 0.3, s]], 0.07, 0.015), rng() < 0.5 ? paint : SOOT, pos, rot)
        else b.metal(new THREE.BoxGeometry(0.1, 0.1, s * 3), RIB, pos, rot)
    }
}

/** A chunk of somebody's station: a hab drum torn at both ends, a bent truss and a shattered solar array. */
function stationWreck(b: ModelBuilder, rng: Rng) {
    const [paint, paint2, stripe] = WRECK_PALETTES[Math.floor(rng() * WRECK_PALETTES.length)]!
    const f = new Frame(b, new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5)))
    const r = 2.8 + rng() * 1.2
    const len = 9 + rng() * 5
    const sections: Section[] = [
        { z: -len / 2, w: r * 0.95, h: r * 0.95 }, { z: -len / 2 + 1, w: r, h: r }, { z: len / 2 - 1, w: r, h: r }, { z: len / 2, w: r * 0.93, h: r * 0.93 }
    ]
    f.solid(loft(sections, 12, 1), paint)
    for (const z of [-len * 0.2, len * 0.22]) f.solid(loft([{ z: z - 0.5, w: r + 0.12, h: r + 0.12 }, { z: z + 0.5, w: r + 0.12, h: r + 0.12 }], 12, 1), z < 0 ? stripe : paint2)
    for (const end of [-1, 1] as const) {
        f.metal(loft([{ z: end * len / 2 - end * 2, w: r + 0.04, h: r + 0.04 }, { z: end * len / 2, w: r * 0.94 + 0.04, h: r * 0.94 + 0.04 }].sort((p, q) => p.z - q.z), 12, 1), SOOT)
        tornEnd(f, rng, end < 0 ? sections[0]! : sections[3]!, end, 1, 12, paint)
    }
    weather(f, rng, sections, -len / 2 + 1.5, len / 2 - 1.5, 1, 12)
    // Truss boom kinked halfway, carrying what is left of a solar array.
    const knee: Vec3 = [r + 5 + rng() * 2, 1 + rng() * 2, (rng() - 0.5) * 2]
    const tip: Vec3 = [knee[0] + 5 + rng() * 3, knee[1] - 2 - rng() * 3, knee[2] + (rng() - 0.5) * 4]
    for (const o of [-0.35, 0.35]) {
        strut(f, [r * 0.9, o, o], [knee[0], knee[1] + o, knee[2] + o], 0.1, RIB, 4)
        strut(f, [knee[0], knee[1] + o, knee[2] + o], [tip[0], tip[1] + o, tip[2] + o], 0.1, RIB, 4)
    }
    for (let k = 0; k < 6; k++) {
        const u = k / 6
        strut(f, [r + (knee[0] - r) * u, knee[1] * u - 0.35, knee[2] * u - 0.35], [r + (knee[0] - r) * (u + 0.16), knee[1] * (u + 0.16) + 0.35, knee[2] * (u + 0.16) + 0.35], 0.05, RIB, 4)
    }
    const tilt = (rng() - 0.5) * 1.2
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
            if (rng() < 0.4) continue
            const pos: Vec3 = [r + 2.2 + i * 1.75, 0.5 + (knee[1] * (i + 1)) / 5, (j - 1) * 2.3 + 3.4]
            f.solid(block(1.6, 0.08, 2.1, 0.02), rng() < 0.25 ? SOOT : SOLAR, pos, [tilt + (rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3])
        }
    }
    f.metal(new THREE.BoxGeometry(7.4, 0.12, 0.12), RIB, [r + 4.8, 0.5 + knee[1] * 0.5, 2.2], [0, 0, Math.atan2(knee[1], knee[0] - r) * 0.8])
    // A docking collar on top, its hatch dark.
    f.solid(drum(r - 0.2, r + 0.9, 1.5, 8, 0.15), paint2, [0, 0, len * 0.05])
    f.glass(new THREE.CircleGeometry(1, 8).rotateX(-Math.PI / 2), 0x07090c, [0, r + 0.92, len * 0.05])
    const debris = 5 + Math.floor(rng() * 4)
    for (let k = 0; k < debris; k++) {
        const s = 0.4 + rng()
        b.solid(slab([[-s, -s * 0.6], [s * 0.8, -s], [s, s * 0.5], [-s * 0.3, s]], 0.07, 0.015), rng() < 0.5 ? paint : SOOT, [(rng() - 0.5) * 16, (rng() - 0.5) * 10, (rng() - 0.5) * 20], [rng() * 6, rng() * 6, rng() * 6])
    }
}

/** A drifting derelict. The seed picks the kind of ship, its paint, where it broke and how badly. */
export function buildWreck(seed: number) {
    const rng = mulberry32(seed)
    const b = new ModelBuilder()
    const kind = rng()
    if (kind < 0.42) shipWreck(b, rng, false)
    else if (kind < 0.78) shipWreck(b, rng, true)
    else stationWreck(b, rng)
    return b.build()
}
