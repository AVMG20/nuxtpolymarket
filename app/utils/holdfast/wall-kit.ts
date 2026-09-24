// Holdfast — modular wall pieces, in the spirit of Age of Empires IV ramparts.
//
// A wall cell is drawn from a handful of instanced pieces:
// - an `arm` from the cell centre toward every connected neighbour (straight
//   or diagonal, with its own merlon rhythm so diagonals aren't stretched),
//   carrying a wide walkway, a crenellated parapet on the outer side, stone
//   courses and a painted team band at the foot;
// - an octagonal `hub` where arms bend, plus mitred `hubFlat` parapet pieces
//   on the outside of the bend, so any 45° joint closes cleanly;
// - a squat `tower` (with one `towerFlat` parapet piece per closed side)
//   where a wall ends, turns or branches;
// - a `stair` / ladder on the inner face now and then;
// - `gate` passages with arches and a raised portcullis, flanked by a
//   `gateTower` at each end of a run of gates.
//
// Every piece is built with its outer side on local +Z (arms run along +X),
// and the renderer rotates instances into place. The walkway top sits exactly
// at WALL_HEIGHT, where archers are drawn; tower floors sit a hair lower so
// they never z-fight the walkways of their neighbours.

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { WALL_HEIGHT } from '#shared/utils/holdfast/sim'

const Y = WALL_HEIGHT
/** Half the width of the wall body. */
const HW = 0.45
/** Parapet inner and outer faces (local z). */
const P_IN = 0.27
const P_OUT = 0.5
/** Crenel (parapet) and merlon tops. */
const P_TOP = Y + 0.2
const M_TOP = Y + 0.42
/** Tower floors sit just under the walkway so overlapping tops never fight. */
const FLOOR = Y - 0.006
/** Gatehouse roof line. */
const GATE_TOP = Y + 0.3
const T8 = Math.tan(Math.PI / 8)
const DIAG = Math.SQRT1_2

const TEAM = 0x3f7fe0
const TEAM_DARK = 0x2f5fb0
const IRON = 0x34343c
const SLIT = 0x26252b
const DOOR = 0x6a4527

interface Palette {
    base: number
    body: number
    dark: number
    walk: number
    parapet: number
    merlon: number
    trim: number
    roof: number
}

const PALETTES: readonly Palette[] = [
    // Timber palisade on a rubble footing.
    { base: 0x7d7566, body: 0x8e5f37, dark: 0x5c3d22, walk: 0xc49259, parapet: 0x9c6c3d, merlon: 0xe3c28b, trim: 0x5a3b24, roof: TEAM },
    // Pale limestone.
    { base: 0x9d9180, body: 0xdcd2bf, dark: 0xb2a690, walk: 0xcfc2a7, parapet: 0xe2d9c7, merlon: 0xece4d4, trim: 0xa99d87, roof: TEAM },
    // Fortified dark granite with gold trim.
    { base: 0x464958, body: 0x858a9f, dark: 0x656a80, walk: 0xb2a996, parapet: 0x8f94a9, merlon: 0x9da2b6, trim: 0xe0b24a, roof: TEAM_DARK }
]

const tmp = new THREE.Color()
const Y_AXIS = new THREE.Vector3(0, 1, 0)

type Profile = readonly (readonly [number, number])[]

class Pieces {
    readonly parts: THREE.BufferGeometry[] = []
    private xf: THREE.Matrix4 | null = null

    /** Rotate (about Y) and shift everything added until `reset()`. */
    frame(rotY: number, x = 0, z = 0): void {
        this.xf = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z)
    }

    reset(): void {
        this.xf = null
    }

    private push(geo: THREE.BufferGeometry, color: number): void {
        const g = geo.index ? geo.toNonIndexed() : geo
        if (g !== geo) geo.dispose()
        g.deleteAttribute('uv')
        if (this.xf) g.applyMatrix4(this.xf)
        tmp.setHex(color)
        const n = g.attributes.position!.count
        const c = new Float32Array(n * 3)
        for (let i = 0; i < n; i++) {
            c[i * 3] = tmp.r
            c[i * 3 + 1] = tmp.g
            c[i * 3 + 2] = tmp.b
        }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3))
        this.parts.push(g)
    }

    /** Axis-aligned box from min to max corners. */
    box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number): void {
        const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))
        g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        this.push(g, color)
    }

    /** A square beam between two points. */
    beam(a: readonly [number, number, number], b: readonly [number, number, number], thick: number, color: number): void {
        const from = new THREE.Vector3(...a)
        const dir = new THREE.Vector3(...b).sub(from)
        const len = dir.length()
        const g = new THREE.BoxGeometry(thick, len, thick)
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize()))
        g.translate(from.x + (b[0] - a[0]) / 2, from.y + (b[1] - a[1]) / 2, from.z + (b[2] - a[2]) / 2)
        this.push(g, color)
    }

    cyl(x: number, y0: number, z: number, r: number, h: number, color: number, seg = 6, rTop = r, open = false): void {
        const g = new THREE.CylinderGeometry(rTop, r, h, seg, 1, open || rTop === 0)
        g.translate(x, y0 + h / 2, z)
        this.push(g, color)
    }

    /** A sharpened log: shaft plus a pointed tip. */
    log(x: number, y0: number, y1: number, z: number, r: number, body: number, tip: number): void {
        this.cyl(x, y0, z, r, y1 - y0, body, 6, r, true)
        this.cyl(x, y1, z, r, r * 1.8, tip, 6, 0)
    }

    /** Octagonal prism with flats facing the axes and diagonals (sizes are apothems). */
    oct(ap: number, y0: number, y1: number, color: number, apTop = ap): void {
        const k = 1 / Math.cos(Math.PI / 8)
        const g = new THREE.CylinderGeometry(apTop * k, ap * k, y1 - y0, 8, 1, apTop === 0)
        g.rotateY(Math.PI / 8)
        g.translate(0, (y0 + y1) / 2, 0)
        this.push(g, color)
    }

    /** Four-sided pyramid roof, base centred at (x, y, z); `r` is the half-width. */
    roof(x: number, y: number, z: number, r: number, h: number, color: number): void {
        const g = new THREE.ConeGeometry(r * Math.SQRT2, h, 4, 1)
        g.rotateY(Math.PI / 4)
        g.translate(x, y + h / 2, z)
        this.push(g, color)
    }

    /**
     * Extrude a (z, y) profile along X from x0 to x1. With `mitre` set, each
     * vertex instead ends at ±z·mitre, so octagon sides join into a ring.
     */
    prismX(profile: Profile, x0: number, x1: number, color: number, mitre = 0): void {
        const shape = new THREE.Shape()
        profile.forEach(([z, y], i) => i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y))
        const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
        // Shape x becomes world z; the extrusion runs along world -x from 0 to -1.
        g.rotateY(-Math.PI / 2)
        const pos = g.attributes.position!
        for (let i = 0; i < pos.count; i++) {
            const end = pos.getX(i) < -0.5 ? 0 : 1
            if (mitre > 0) pos.setX(i, (end ? 1 : -1) * pos.getZ(i) * mitre)
            else pos.setX(i, end ? x1 : x0)
        }
        this.push(g, color)
    }

    /** Extrude an (x, y) shape along Z from z0 to z1. */
    prismZ(shape: THREE.Shape, z0: number, z1: number, color: number, curveSegments = 10): void {
        const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments })
        g.translate(0, 0, z0)
        this.push(g, color)
    }

    build(): THREE.BufferGeometry {
        const g = mergeGeometries(this.parts, false)
        for (const p of this.parts) p.dispose()
        if (!g) throw new Error('holdfast wall kit: merge failed')
        g.computeVertexNormals()
        g.computeBoundingSphere()
        return g
    }
}

/** Mirror a finished piece across z = 0 (outer side +Z becomes -Z). */
function mirrorZ(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const g = src.clone()
    g.scale(1, 1, -1)
    // Mirroring flips the winding: swap two corners of every triangle back.
    for (const name of ['position', 'color'] as const) {
        const a = g.attributes[name]!
        for (let i = 0; i < a.count; i += 3) {
            for (let c = 0; c < a.itemSize; c++) {
                const v1 = a.getComponent(i + 1, c)
                a.setComponent(i + 1, c, a.getComponent(i + 2, c))
                a.setComponent(i + 2, c, v1)
            }
        }
    }
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
}

/** Corbel + parapet cross-section on the outer side of a stone walkway. */
const PARAPET: Profile = [
    [P_IN, Y - 0.05],
    [HW - 0.01, Y - 0.05],
    [HW - 0.01, Y - 0.2],
    [P_OUT, Y - 0.12],
    [P_OUT, P_TOP],
    [P_IN, P_TOP]
]

/** Stone course heights on the wall faces. */
const COURSES = [0.5, 0.76, 1.02]

// ─── Walls ──────────────────────────────────────────────────────────────

/** Stone arm from the cell centre (x = 0) to x = len, outer side on +Z. */
function stoneArm(k: Pieces, p: Palette, tier: number, len: number): void {
    const diag = len > 0.6
    k.box(0, len, 0, 0.1, -0.5, 0.5, p.base)
    k.box(0, len, 0.1, 0.26, -HW - 0.015, HW + 0.015, TEAM)
    k.box(0, len, 0.1, Y - 0.05, -HW, HW, p.body)
    for (const y of COURSES) k.box(0, len, y, y + 0.022, -HW - 0.006, HW + 0.006, p.dark)
    // Staggered block joints between the courses.
    const joints: [number, number, number][] = [[0.5, 0.26, COURSES[0]!], [0.14, COURSES[0]!, COURSES[1]!], [0.66, COURSES[1]!, COURSES[2]!]]
    for (const [f, y0, y1] of joints) k.box(len * f - 0.009, len * f + 0.009, y0 + 0.02, y1, -HW - 0.004, HW + 0.004, p.dark)
    // Pilaster on the outer face at the cell edge (the neighbour adds its half).
    k.box(len - 0.075, len, 0.1, Y - 0.16, HW, HW + 0.06, tier === 3 ? p.dark : p.parapet)
    // Walkway, overhanging the inner face a touch.
    k.box(0, len, Y - 0.05, Y, -HW - 0.025, P_IN + 0.01, p.walk)
    k.box(0, len, Y - 0.09, Y - 0.05, -HW - 0.025, -HW + 0.02, p.dark)
    k.prismX(PARAPET, 0, len, p.parapet)
    const merlons = diag ? [len * 0.25, len * 0.75] : [len * 0.5]
    const mw = diag ? 0.1 : 0.12
    if (tier === 3) {
        k.box(0, len, P_TOP, P_TOP + 0.025, P_IN - 0.01, P_OUT + 0.01, p.trim)
        for (const m of merlons) k.box(m - mw, m + mw, P_TOP + 0.025, M_TOP + 0.02, P_IN + 0.02, P_OUT, p.merlon)
        k.box(0, len, Y - 0.25, Y - 0.22, HW, HW + 0.02, p.trim)
    } else {
        for (const m of merlons) k.box(m - mw, m + mw, P_TOP, M_TOP, P_IN + 0.02, P_OUT, p.merlon)
    }
    // Arrow slit in the outer face.
    const s = len * 0.45
    k.box(s - 0.02, s + 0.02, 0.56, 0.84, HW, HW + 0.008, SLIT)
}

/** Timber arm: palisade logs outside, a plank walkway on posts inside. */
function woodArm(k: Pieces, p: Palette, len: number): void {
    k.prismX([[-0.5, 0], [0.5, 0], [0.42, 0.14], [-0.42, 0.14]], 0, len, p.base)
    const n = Math.round(len / 0.125)
    for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * len / n
        k.log(x, 0.1, Y + (i % 2 === 0 ? 0.3 : 0.2), 0.36, 0.068, p.parapet, p.merlon)
    }
    // Binding beams across the outside of the logs; the low one is painted.
    k.box(0, len, 0.28, 0.4, 0.41, 0.46, TEAM)
    k.box(0, len, Y - 0.26, Y - 0.18, 0.41, 0.45, p.trim)
    // Walkway on a stringer, a post and a braced cross beam.
    k.box(0, len, Y - 0.07, Y, -HW, 0.3, p.walk)
    k.box(0, len, Y - 0.15, Y - 0.07, -HW + 0.02, -HW + 0.1, p.trim)
    const m = len / 2
    k.box(m - 0.045, m + 0.045, Y - 0.16, Y - 0.07, -HW + 0.02, 0.3, p.trim)
    k.box(m - 0.05, m + 0.05, 0.12, Y - 0.07, -HW + 0.02, -HW + 0.12, p.body)
    k.beam([m, 0.5, -HW + 0.1], [m, Y - 0.16, 0.26], 0.05, p.dark)
}

function arm(tier: number, len: number): THREE.BufferGeometry {
    const p = PALETTES[tier - 1]!
    const k = new Pieces()
    if (tier === 1) woodArm(k, p, len)
    else stoneArm(k, p, tier, len)
    return k.build()
}

/** Octagonal joint where arms bend. */
function hub(tier: number): THREE.BufferGeometry {
    const p = PALETTES[tier - 1]!
    const k = new Pieces()
    if (tier === 1) {
        k.oct(0.48, 0, 0.14, p.base, 0.42)
        k.oct(HW, Y - 0.07, Y, p.walk)
        k.cyl(0, 0.12, 0, 0.08, Y - 0.19, p.body, 6)
    } else {
        k.oct(0.5, 0, 0.1, p.base)
        k.oct(HW + 0.015, 0.1, 0.26, TEAM)
        k.oct(HW, 0.1, Y - 0.05, p.body)
        for (const y of COURSES) k.oct(HW + 0.006, y, y + 0.022, p.dark)
        k.oct(HW, Y - 0.05, Y, p.walk)
    }
    return k.build()
}

/** One mitred side of parapet on a hub's octagon, facing +Z. */
function hubFlat(tier: number): THREE.BufferGeometry {
    const p = PALETTES[tier - 1]!
    const k = new Pieces()
    if (tier === 1) {
        for (const x of [-0.07, 0.07]) k.log(x, 0.1, Y + 0.25, 0.36, 0.068, p.parapet, p.merlon)
        k.prismX([[0.41, 0.28], [0.46, 0.28], [0.46, 0.4], [0.41, 0.4]], 0, 0, TEAM, T8)
        k.prismX([[0.41, Y - 0.26], [0.45, Y - 0.26], [0.45, Y - 0.18], [0.41, Y - 0.18]], 0, 0, p.trim, T8)
    } else {
        k.prismX(PARAPET, 0, 0, p.parapet, T8)
        if (tier === 3) k.prismX([[P_IN - 0.01, P_TOP], [P_OUT + 0.01, P_TOP], [P_OUT + 0.01, P_TOP + 0.025], [P_IN - 0.01, P_TOP + 0.025]], 0, 0, p.trim, T8)
    }
    return k.build()
}

// ─── Towers ─────────────────────────────────────────────────────────────

const TOWER_AP = 0.64
const TOWER_RIM = 0.74
const TOWER_IN = 0.52
const TOWER_PTOP = Y + 0.4
const TOWER_MTOP = Y + 0.68

/** Tower drum up to its floor; parapet sides are separate `towerFlat`s. */
function tower(tier: number): THREE.BufferGeometry {
    const p = PALETTES[tier - 1]!
    const k = new Pieces()
    if (tier === 1) {
        k.oct(0.72, 0, 0.16, p.base, 0.66)
        k.oct(0.6, 0.12, Y - 0.1, p.body)
        k.oct(0.615, 0.3, 0.44, TEAM)
        k.oct(0.615, 0.92, 0.98, p.trim)
        // Corner posts up the drum.
        for (let i = 0; i < 4; i++) {
            const a = Math.PI / 4 + i * Math.PI / 2
            k.cyl(Math.sin(a) * 0.64, 0.1, Math.cos(a) * 0.64, 0.06, Y - 0.2, p.dark, 6)
        }
        k.oct(TOWER_RIM - 0.02, Y - 0.1, FLOOR, p.walk)
        return k.build()
    }
    k.oct(0.8, 0, 0.36, p.base, TOWER_AP)
    k.oct(TOWER_AP + 0.016, 0.36, 0.5, TEAM)
    k.oct(TOWER_AP, 0.36, Y - 0.22, p.body)
    for (const y of [0.78, 1.0]) k.oct(TOWER_AP + 0.008, y, y + 0.024, p.dark)
    k.oct(TOWER_AP, Y - 0.22, Y - 0.1, p.parapet, TOWER_RIM)
    k.oct(TOWER_RIM, Y - 0.1, Y - 0.012, p.parapet)
    k.oct(TOWER_IN + 0.04, Y - 0.04, FLOOR, p.walk)
    if (tier === 3) k.oct(TOWER_AP + 0.012, Y - 0.27, Y - 0.23, p.trim)
    // Arrow slits on the three outward faces.
    for (const a of [-Math.PI / 4, 0, Math.PI / 4]) {
        k.frame(a)
        k.box(-0.022, 0.022, 0.6, 0.9, TOWER_AP - 0.004, TOWER_AP + 0.01, SLIT)
        if (tier === 3 && a === 0) {
            k.box(-0.11, 0.11, 0.58, Y - 0.3, TOWER_AP + 0.01, TOWER_AP + 0.03, TEAM)
            k.box(-0.13, 0.13, Y - 0.32, Y - 0.29, TOWER_AP + 0.01, TOWER_AP + 0.04, p.trim)
            k.box(-0.035, 0.035, 0.84, 0.94, TOWER_AP + 0.03, TOWER_AP + 0.04, p.trim)
        }
    }
    k.reset()
    return k.build()
}

/** One mitred side of a tower's crenellated rim, facing +Z. */
function towerFlat(tier: number): THREE.BufferGeometry {
    const p = PALETTES[tier - 1]!
    const k = new Pieces()
    if (tier === 1) {
        for (const [x, h] of [[-0.17, 0.42], [0, 0.54], [0.17, 0.42]] as const) k.log(x, FLOOR - 0.1, Y + h, 0.62, 0.08, p.parapet, p.merlon)
        k.prismX([[0.69, Y + 0.12], [0.73, Y + 0.12], [0.73, Y + 0.22], [0.69, Y + 0.22]], 0, 0, TEAM, T8)
        return k.build()
    }
    k.prismX([[TOWER_IN, Y - 0.012], [TOWER_RIM, Y - 0.012], [TOWER_RIM, TOWER_PTOP], [TOWER_IN, TOWER_PTOP]], 0, 0, p.parapet, T8)
    let top = TOWER_PTOP
    if (tier === 3) {
        k.prismX([[TOWER_IN - 0.01, top], [TOWER_RIM + 0.01, top], [TOWER_RIM + 0.01, top + 0.025], [TOWER_IN - 0.01, top + 0.025]], 0, 0, p.trim, T8)
        top += 0.025
    }
    k.box(-0.12, 0.12, top, TOWER_MTOP, TOWER_IN + 0.03, TOWER_RIM, p.merlon)
    return k.build()
}

/** Steps (or a ladder) up the inner face, which is local -Z. */
function stair(tier: number): THREE.BufferGeometry {
    const p = PALETTES[tier - 1]!
    const k = new Pieces()
    if (tier === 1) {
        for (const x of [-0.12, 0.12]) k.beam([x, 0, -0.68], [x, Y + 0.1, -HW - 0.02], 0.045, p.trim)
        for (let i = 1; i <= 5; i++) {
            const t = i / 6
            const y = t * (Y + 0.1)
            const z = -0.68 + t * (0.68 - HW - 0.02)
            k.box(-0.12, 0.12, y - 0.016, y + 0.016, z - 0.02, z + 0.02, p.walk)
        }
        return k.build()
    }
    const steps = 6
    const x0 = -0.46
    const run = (0.44 - x0) / steps
    const shape = new THREE.Shape()
    shape.moveTo(x0, 0)
    shape.lineTo(0.44, 0)
    shape.lineTo(0.44, Y)
    for (let i = steps - 1; i >= 0; i--) {
        const x = x0 + i * run
        shape.lineTo(x, (i + 1) * Y / steps)
        shape.lineTo(x, i * Y / steps)
    }
    k.prismZ(shape, -0.72, -HW + 0.01, p.walk)
    // A low wall along the open side of the flight.
    k.box(x0, 0.44, 0, 0.18, -0.74, -0.7, p.base)
    return k.build()
}

// ─── Gates ──────────────────────────────────────────────────────────────

const ARCH_W = 0.3
const ARCH_SPRING = 0.6

/** Gate passage: the wall runs along X, the road through along Z. */
function gate(tier: number): THREE.BufferGeometry {
    const p = PALETTES[tier - 1]!
    const k = new Pieces()
    const d = 0.48
    const H = GATE_TOP
    // Facade block with the passage cut through it.
    const shape = new THREE.Shape()
    shape.moveTo(-0.5, 0)
    shape.lineTo(-ARCH_W, 0)
    if (tier === 1) {
        shape.lineTo(-ARCH_W, 0.86)
        shape.lineTo(ARCH_W, 0.86)
    } else {
        shape.lineTo(-ARCH_W, ARCH_SPRING)
        shape.absarc(0, ARCH_SPRING, ARCH_W, Math.PI, 0, true)
    }
    shape.lineTo(ARCH_W, 0)
    shape.lineTo(0.5, 0)
    shape.lineTo(0.5, H)
    shape.lineTo(-0.5, H)
    shape.closePath()
    k.prismZ(shape, -d, d, p.body, 8)
    for (const s of [-1, 1]) {
        const a = s * ARCH_W
        const b = s * 0.5
        k.box(Math.min(a, b), Math.max(a, b), 0, 0.1, -d - 0.04, d + 0.04, p.base)
        k.box(Math.min(a, b), Math.max(a, b), 0.1, 0.26, -d - 0.015, d + 0.015, TEAM)
        // Doors swung open against the passage walls, on the inner side.
        k.box(s * (ARCH_W - 0.035), s * ARCH_W, 0.02, tier === 1 ? 0.8 : 0.66, -d + 0.02, -d + 0.3, DOOR)
    }
    // Raised portcullis just inside the outer mouth.
    const top = (x: number): number => tier === 1 ? 0.86 : ARCH_SPRING + Math.sqrt(Math.max(0, ARCH_W * ARCH_W - x * x))
    for (const x of [-0.2, -0.1, 0, 0.1, 0.2]) k.box(x - 0.014, x + 0.014, 0.54, top(x), d - 0.2, d - 0.17, IRON)
    for (const y of [0.62, 0.76]) {
        const w = tier === 1 ? ARCH_W : Math.sqrt(ARCH_W * ARCH_W - Math.max(0, y - ARCH_SPRING) ** 2)
        k.box(-w, w, y - 0.014, y + 0.014, d - 0.2, d - 0.17, IRON)
    }
    if (tier === 1) {
        // Plank seams, a painted beam, a timber lintel and a palisade top.
        for (let x = -0.45; x < 0.46; x += 0.15) k.box(x - 0.01, x + 0.01, 0.1, H, -d - 0.006, d + 0.006, p.dark)
        k.box(-0.5, 0.5, 0.95, 1.07, -d - 0.02, d + 0.02, TEAM)
        k.box(-ARCH_W - 0.06, ARCH_W + 0.06, 0.84, 0.92, -d - 0.03, d + 0.03, p.trim)
        for (let i = 0; i < 7; i++) {
            const x = -0.42 + i * 0.14
            k.log(x, H - 0.1, H + (i % 2 === 0 ? 0.26 : 0.18), 0.38, 0.066, p.parapet, p.merlon)
        }
        k.box(-0.5, 0.5, H - 0.05, H, -d, 0.32, p.walk)
        k.prismX([[-0.3, H], [0.3, H], [0, H + 0.26]], -0.5, 0.5, p.roof)
        return k.build()
    }
    // Voussoirs and keystone round the arch, both faces.
    const ring = new THREE.Shape()
    ring.absarc(0, ARCH_SPRING, ARCH_W + 0.08, 0, Math.PI, false)
    ring.absarc(0, ARCH_SPRING, ARCH_W, Math.PI, 0, true)
    ring.closePath()
    k.prismZ(ring, d, d + 0.03, p.trim, 8)
    k.prismZ(ring, -d - 0.03, -d, p.trim, 8)
    for (const s of [-1, 1]) k.box(-0.05, 0.05, ARCH_SPRING + ARCH_W - 0.02, ARCH_SPRING + ARCH_W + 0.12, s * d, s * (d + 0.05), tier === 3 ? p.trim : p.parapet)
    for (const y of [0.5, 1.12]) k.box(-0.5, 0.5, y, y + 0.022, -d - 0.006, d + 0.006, p.dark)
    // Banner over the arch.
    k.box(-0.1, 0.1, 1.04, H - 0.16, d, d + 0.02, TEAM)
    k.box(-0.035, 0.035, 1.2, 1.3, d + 0.02, d + 0.03, tier === 3 ? p.trim : 0xf2efe6)
    k.box(-0.13, 0.13, H - 0.17, H - 0.14, d, d + 0.05, p.trim)
    // Crenellated top on both faces with a gabled roof between.
    for (const s of [-1, 1]) {
        const z0 = s * (d - 0.01)
        const z1 = s * (d + 0.05)
        k.box(-0.5, 0.5, H - 0.12, H, Math.min(z0, z1), Math.max(z0, z1), p.parapet)
        const a = s * 0.3
        const b = s * (d + 0.05)
        k.box(-0.5, 0.5, H, H + 0.14, Math.min(a, b), Math.max(a, b), p.parapet)
        if (tier === 3) k.box(-0.5, 0.5, H + 0.14, H + 0.165, Math.min(a, b) - 0.01, Math.max(a, b) + 0.01, p.trim)
        for (const x of [-0.25, 0.25]) k.box(x - 0.12, x + 0.12, H + 0.14, H + 0.34, Math.min(a, b) + 0.02, Math.max(a, b), p.merlon)
    }
    k.box(-0.5, 0.5, H - 0.02, H, -0.3, 0.3, p.walk)
    k.prismX([[-0.3, H], [0.3, H], [0, H + 0.36]], -0.5, 0.5, p.roof)
    return k.build()
}

/** Flanking tower at the end of a run of gates, centred on its footprint. */
function gateTower(tier: number): THREE.BufferGeometry {
    const p = PALETTES[tier - 1]!
    const k = new Pieces()
    const H = GATE_TOP + 0.22
    if (tier === 1) {
        const r = 0.28
        k.box(-r - 0.04, r + 0.04, 0, 0.12, -r - 0.04, r + 0.04, p.base)
        k.box(-r, r, 0.12, H, -r, r, p.body)
        k.box(-r - 0.015, r + 0.015, 0.3, 0.42, -r - 0.015, r + 0.015, TEAM)
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(sx * r, 0.1, sz * r, 0.055, H - 0.05, p.dark, 6)
        k.box(-r - 0.06, r + 0.06, H, H + 0.07, -r - 0.06, r + 0.06, p.walk)
        k.box(-0.03, 0.03, 0.9, 1.08, r, r + 0.01, SLIT)
        k.roof(0, H + 0.07, 0, r + 0.1, 0.46, p.roof)
        return k.build()
    }
    const ap = 0.32
    k.oct(0.4, 0, 0.3, p.base, ap)
    k.oct(ap + 0.014, 0.3, 0.44, TEAM)
    k.oct(ap, 0.3, H, p.body)
    for (const y of [0.78, 1.2]) k.oct(ap + 0.007, y, y + 0.022, p.dark)
    k.oct(ap, H, H + 0.1, p.parapet, 0.38)
    k.oct(0.38, H + 0.1, H + 0.2, p.parapet)
    if (tier === 3) k.oct(0.39, H + 0.2, H + 0.225, p.trim)
    const mt = H + (tier === 3 ? 0.225 : 0.2)
    for (let i = 0; i < 8; i++) {
        k.frame(i * Math.PI / 4)
        k.box(-0.07, 0.07, mt, mt + 0.16, 0.3, 0.38, p.merlon)
    }
    k.reset()
    k.box(-0.022, 0.022, 0.62, 0.86, ap - 0.004, ap + 0.01, SLIT)
    k.box(-0.022, 0.022, 1.3, 1.5, ap - 0.004, ap + 0.01, SLIT)
    k.cyl(0, H + 0.2, 0, 0.31, 0.62, p.roof, 8, 0)
    if (tier === 3) k.cyl(0, H + 0.8, 0, 0.035, 0.14, p.trim, 6, 0)
    return k.build()
}

/** Plain block used for wall placement previews. */
function ghost(): THREE.BufferGeometry {
    const k = new Pieces()
    k.oct(HW, 0, Y, 0xffffff)
    k.oct(HW, Y, P_TOP, 0xffffff)
    return k.build()
}

// ─── Kit ────────────────────────────────────────────────────────────────

export const WALL_PIECES = ['hub', 'armPlus', 'armMinus', 'diagPlus', 'diagMinus', 'hubFlat', 'tower', 'towerFlat', 'stair', 'gate', 'gateTower'] as const
export type WallPiece = typeof WALL_PIECES[number]
export type WallKit = Record<WallPiece, THREE.BufferGeometry>

const cache = new Map<number, WallKit>()
let ghostGeo: THREE.BufferGeometry | null = null

export function wallKit(tier: number): WallKit {
    const t = Math.min(3, Math.max(1, Math.round(tier)))
    let kit = cache.get(t)
    if (!kit) {
        const straight = arm(t, 0.5)
        const diagonal = arm(t, DIAG)
        kit = {
            hub: hub(t),
            armPlus: straight,
            armMinus: mirrorZ(straight),
            diagPlus: diagonal,
            diagMinus: mirrorZ(diagonal),
            hubFlat: hubFlat(t),
            tower: tower(t),
            towerFlat: towerFlat(t),
            stair: stair(t),
            gate: gate(t),
            gateTower: gateTower(t)
        }
        cache.set(t, kit)
    }
    return kit
}

export function wallGhostGeometry(): THREE.BufferGeometry {
    ghostGeo ??= ghost()
    return ghostGeo
}

export function disposeWallKit(): void {
    for (const kit of cache.values()) {
        for (const piece of WALL_PIECES) kit[piece].dispose()
    }
    cache.clear()
    ghostGeo?.dispose()
    ghostGeo = null
}
