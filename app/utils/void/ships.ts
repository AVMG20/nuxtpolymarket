// Void Runner — player hulls.
//
// Every hull is lofted from cross-sections (a rounded polygon swept along the
// ship's length), dressed with chamfered plates, bare-metal machinery, glass
// canopies and lit detail: nav lights, window rows, panel seams, vents. Still
// procedural and flat-shaded, but each silhouette is designed to read at a
// glance and look expensive up close.

import * as THREE from 'three'
import type { VoidTurretId } from '#shared/utils/gamelogic/void'
import { ModelBuilder, cyl, ico, octa, ring, tube, type BuiltModel, type TurretModel } from './models'

type Vec3 = [number, number, number]

// ─── Geometry helpers ──────────────────────────────────────────────────────

export interface Section {
    z: number
    /** Half width. */
    w: number
    /** Half height. */
    h: number
    y?: number
    x?: number
}

/**
 * Sweeps a rounded polygon through the sections (nose first, -Z to +Z) and
 * caps both ends. `roundness` below 1 squares the profile off; 1 is an ellipse.
 */
export function loft(sections: Section[], sides = 10, roundness = 0.8, phase = 0) {
    const ringAt = (s: Section) => {
        const pts: THREE.Vector3[] = []
        for (let j = 0; j < sides; j++) {
            const a = (j / sides) * Math.PI * 2 + phase
            const c = Math.cos(a)
            const sn = Math.sin(a)
            pts.push(new THREE.Vector3(
                (s.x ?? 0) + s.w * Math.sign(c) * Math.pow(Math.abs(c), roundness),
                (s.y ?? 0) + s.h * Math.sign(sn) * Math.pow(Math.abs(sn), roundness),
                s.z
            ))
        }
        return pts
    }
    const rings = sections.map(ringAt)
    const pos: number[] = []
    const push = (...vs: THREE.Vector3[]) => vs.forEach(v => pos.push(v.x, v.y, v.z))
    for (let i = 0; i < rings.length - 1; i++) {
        const r0 = rings[i]!
        const r1 = rings[i + 1]!
        for (let j = 0; j < sides; j++) {
            const a = r0[j]!
            const b = r0[(j + 1) % sides]!
            const c = r1[j]!
            const d = r1[(j + 1) % sides]!
            push(a, b, c)
            push(b, d, c)
        }
    }
    const first = rings[0]!
    const last = rings[rings.length - 1]!
    const c0 = new THREE.Vector3(sections[0]!.x ?? 0, sections[0]!.y ?? 0, sections[0]!.z)
    const c1 = new THREE.Vector3(sections[sections.length - 1]!.x ?? 0, sections[sections.length - 1]!.y ?? 0, sections[sections.length - 1]!.z)
    for (let j = 0; j < sides; j++) {
        push(c0, first[(j + 1) % sides]!, first[j]!)
        push(c1, last[j]!, last[(j + 1) % sides]!)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
}

/** A flat outline (x, z) extruded along Y with chamfered edges that catch the light. */
export function slab(points: [number, number][], thickness: number, bevel = 0.03) {
    const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)))
    const depth = Math.max(0.001, thickness - bevel * 2)
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 1 })
    g.rotateX(Math.PI / 2)
    g.translate(0, depth / 2, 0)
    return g
}

/** A chamfered box. */
export function block(w: number, h: number, d: number, bevel = 0.04) {
    const hw = w / 2 - bevel
    const hd = d / 2 - bevel
    return slab([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]], h, bevel)
}

// ─── Kit parts ─────────────────────────────────────────────────────────────

interface Livery {
    paint: number
    paint2: number
    trim: number
    metal: number
    accent: number
    glow: number
    glass: number
}

const RED = 0xff3040
const GREEN = 0x39ff88
const WINDOW = 0xffe6b0

function navLights(b: ModelBuilder, x: number, y: number, z: number) {
    b.glow(octa(0.07), RED, 3.5, [-x, y, z])
    b.glow(octa(0.07), GREEN, 3.5, [x, y, z])
}

function windows(b: ModelBuilder, from: Vec3, count: number, spacing: number, size = 0.12, axis: 'x' | 'z' = 'x') {
    for (let i = 0; i < count; i++) {
        const at: Vec3 = axis === 'x' ? [from[0] + i * spacing, from[1], from[2]] : [from[0], from[1], from[2] + i * spacing]
        b.glow(new THREE.BoxGeometry(axis === 'x' ? size : 0.03, size * 0.6, axis === 'x' ? 0.03 : size), WINDOW, 1.5, at)
    }
}

function mast(b: ModelBuilder, pos: Vec3, height: number, mirror = false) {
    b.metal(cyl(0.035, 0.07, height, 5), 0x3a414c, [pos[0], pos[1] + height / 2, pos[2]], [0, 0, 0], [1, 1, 1], mirror)
    b.glow(octa(0.08), RED, 3.5, [pos[0], pos[1] + height, pos[2]], [0, 0, 0], [1, 1, 1], mirror)
}

/** A long panel seam: a faint lit line inlaid on the hull. */
function seam(b: ModelBuilder, color: number, from: Vec3, length: number, mirror = false, axis: 'x' | 'z' = 'z', intensity = 1) {
    const geo = axis === 'z' ? new THREE.BoxGeometry(0.03, 0.03, length) : new THREE.BoxGeometry(length, 0.03, 0.03)
    b.glow(geo, color, intensity, from, [0, 0, 0], [1, 1, 1], mirror)
}

/** Glass canopy with a metal frame rib and a lit sill. */
function canopy(b: ModelBuilder, l: Livery, z0: number, z1: number, y: number, w: number, h: number) {
    const len = z1 - z0
    b.glass(loft([
        { z: z0, w: w * 0.1, h: h * 0.1, y },
        { z: z0 + len * 0.3, w: w * 0.85, h: h * 0.8, y: y + h * 0.35 },
        { z: z0 + len * 0.7, w, h, y: y + h * 0.4 },
        { z: z1, w: w * 0.5, h: h * 0.3, y: y + h * 0.1 }
    ], 8, 0.9), l.glass)
    b.metal(new THREE.BoxGeometry(0.04, 0.05, len * 0.75), l.trim, [0, y + h * 1.38, z0 + len * 0.55])
    b.glow(new THREE.BoxGeometry(w * 1.7, 0.025, 0.025), l.glow, 1.2, [0, y + h * 0.05, z0 + len * 0.62])
}

/** Engine pod: a lofted nacelle ending in a nozzle, with an intake ring up front. */
function nacelle(b: ModelBuilder, l: Livery, pos: Vec3, r: number, length: number, mirror = false) {
    const [x, y, z] = pos
    const geo = loft([
        { z: z - length / 2, w: r * 0.65, h: r * 0.65, x, y },
        { z: z - length / 2 + r * 0.6, w: r, h: r, x, y },
        { z: z + length / 2 - r * 0.4, w: r, h: r, x, y },
        { z: z + length / 2, w: r * 0.85, h: r * 0.85, x, y }
    ], 10, 0.95)
    b.solid(geo, l.paint2, [0, 0, 0], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(ring(r * 0.72, r * 0.12, 4, 10), l.metal, [x, y, z - length / 2 + 0.02], [0, 0, 0], [1, 1, 1], mirror)
    b.glass(new THREE.CircleGeometry(r * 0.62, 10).rotateY(Math.PI), 0x07090d, [x, y, z - length / 2 + 0.03], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(new THREE.BoxGeometry(r * 2.05, 0.05, length * 0.45), l.trim, [x, y, z + length * 0.1], [0, 0, 0], [1, 1, 1], mirror)
    b.engine([x, y, z + length / 2], r * 0.82, mirror, l.glow)
}

/** Recessed intake / vent grille: dark box with a few metal slats. */
function vent(b: ModelBuilder, pos: Vec3, w: number, h: number, d: number, mirror = false, slats = 3) {
    b.metal(new THREE.BoxGeometry(w, h, d), 0x14171c, pos, [0, 0, 0], [1, 1, 1], mirror)
    for (let i = 0; i < slats; i++) {
        b.metal(new THREE.BoxGeometry(w * 1.05, h * 0.12, d * 0.9), 0x59616d, [pos[0], pos[1] - h * 0.35 + (i * h * 0.7) / Math.max(1, slats - 1), pos[2]], [0, 0, 0], [1, 1, 1], mirror)
    }
}

/**
 * Surface clutter for big flat decks: small plates, pipes and boxes laid out
 * deterministically so a hull always looks the same.
 */
function greeble(b: ModelBuilder, l: Livery, center: Vec3, sizeX: number, sizeZ: number, count: number, seed: number, mirror = false) {
    let a = seed >>> 0
    const rng = () => {
        a = (a * 1664525 + 1013904223) >>> 0
        return a / 4294967296
    }
    for (let i = 0; i < count; i++) {
        const x = center[0] + (rng() - 0.5) * sizeX
        const z = center[2] + (rng() - 0.5) * sizeZ
        const kind = rng()
        if (kind < 0.45) {
            const w = 0.15 + rng() * 0.45
            const d = 0.15 + rng() * 0.6
            const h = 0.05 + rng() * 0.12
            b.metal(block(w, h, d, 0.015), rng() < 0.5 ? l.metal : l.trim, [x, center[1] + h / 2, z], [0, 0, 0], [1, 1, 1], mirror)
        } else if (kind < 0.75) {
            const len = 0.4 + rng() * 1.2
            b.metal(tube(0.04, 0.04, len, 6), l.metal, [x, center[1] + 0.05, z], [0, rng() < 0.5 ? Math.PI / 2 : 0, 0], [1, 1, 1], mirror)
        } else if (kind < 0.9) {
            b.solid(block(0.3 + rng() * 0.3, 0.08, 0.3 + rng() * 0.3, 0.02), l.paint2, [x, center[1] + 0.04, z], [0, 0, 0], [1, 1, 1], mirror)
        } else {
            b.glow(new THREE.BoxGeometry(0.06, 0.04, 0.06), rng() < 0.5 ? l.glow : WINDOW, 2.5, [x, center[1] + 0.03, z], [0, 0, 0], [1, 1, 1], mirror)
        }
    }
}

/** A gun barrel with a muzzle brake and a hot tip. */
function barrel(b: ModelBuilder, l: Livery, pos: Vec3, length: number, r: number, mirror = false) {
    b.metal(tube(r, r * 1.2, length, 8), l.metal, pos, [0, 0, 0], [1, 1, 1], mirror)
    b.metal(tube(r * 1.5, r * 1.5, length * 0.12, 8), l.trim, [pos[0], pos[1], pos[2] - length * 0.45], [0, 0, 0], [1, 1, 1], mirror)
    b.glow(tube(r * 0.6, r * 0.6, 0.02, 8), l.glow, 2.5, [pos[0], pos[1], pos[2] - length * 0.51], [0, 0, 0], [1, 1, 1], mirror)
}

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
        b.solid(loft([
            { z: -1.75, w: 0.02, h: 0.02, y: -0.02 },
            { z: -1.25, w: 0.15, h: 0.11 },
            { z: -0.55, w: 0.3, h: 0.22, y: 0.02 },
            { z: 0.35, w: 0.36, h: 0.25 },
            { z: 1.0, w: 0.32, h: 0.22 },
            { z: 1.25, w: 0.26, h: 0.18 }
        ], 10, 0.72), l.paint)
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
        b.solid(loft([
            { z: -2.3, w: 0.02, h: 0.02 },
            { z: -1.5, w: 0.13, h: 0.11 },
            { z: -0.5, w: 0.25, h: 0.21, y: 0.02 },
            { z: 0.7, w: 0.3, h: 0.23 },
            { z: 1.25, w: 0.2, h: 0.16 }
        ], 10, 0.7), l.paint)
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

    mule(b, l) {
        // Cab: a chunky tug nose with a wraparound canopy.
        b.solid(loft([
            { z: -2.95, w: 0.5, h: 0.42, y: 0.05 },
            { z: -2.55, w: 0.88, h: 0.7 },
            { z: -1.5, w: 1.0, h: 0.8 },
            { z: -1.15, w: 0.92, h: 0.72 }
        ], 8, 0.58, Math.PI / 8), l.paint)
        b.glass(loft([
            { z: -2.78, w: 0.55, h: 0.12, y: 0.4 },
            { z: -2.45, w: 0.9, h: 0.2, y: 0.5 },
            { z: -2.1, w: 0.95, h: 0.2, y: 0.55 }
        ], 8, 0.7), l.glass)
        b.metal(new THREE.BoxGeometry(0.06, 0.26, 0.5), l.trim, [0, 0.6, -2.42])
        windows(b, [1.005, 0.3, -2.0], 3, 0.25, 0.14, 'z')
        windows(b, [-1.005, 0.3, -2.0], 3, 0.25, 0.14, 'z')
        for (let i = 0; i < 5; i++) b.solid(block(0.2, 0.06, 0.34, 0.01), i % 2 ? l.trim : l.accent, [-0.48 + i * 0.24, -0.52, -2.62], [0.75, 0, 0])
        // Work lights and mining drills
        b.glow(new THREE.BoxGeometry(0.22, 0.1, 0.04), 0xfff4d6, 3.2, [0.55, -0.2, -2.93], [0, 0, 0], [1, 1, 1], true)
        b.metal(block(0.22, 0.22, 1.1, 0.03), l.metal, [0.62, -0.55, -2.6], [0, 0, 0], [1, 1, 1], true)
        b.metal(new THREE.ConeGeometry(0.2, 0.75, 8).rotateX(-Math.PI / 2), l.trim, [0.62, -0.55, -3.45], [0, 0, 0], [1, 1, 1], true)
        b.glow(ring(0.17, 0.025, 3, 12), l.glow, 2.6, [0.62, -0.55, -3.2], [0, 0, 0], [1, 1, 1], true)
        b.glow(ring(0.11, 0.02, 3, 12), l.glow, 2.6, [0.62, -0.55, -3.45], [0, 0, 0], [1, 1, 1], true)
        // Spine truss
        b.metal(block(0.16, 0.16, 4.3, 0.02), l.metal, [0.28, 0.2, 0.9], [0, 0, 0], [1, 1, 1], true)
        b.metal(block(0.16, 0.16, 4.3, 0.02), l.metal, [0.28, -0.3, 0.9], [0, 0, 0], [1, 1, 1], true)
        for (let i = 0; i < 6; i++) b.metal(new THREE.BoxGeometry(0.62, 0.06, 0.06), l.trim, [0, 0.2 - (i % 2) * 0.5, -0.9 + i * 0.75])
        // Cargo modules with hazard stripes
        for (let i = 0; i < 3; i++) {
            const z = -0.45 + i * 1.18
            const paint = i === 1 ? l.paint2 : l.paint
            b.solid(block(0.95, 0.95, 1.05, 0.07), paint, [0.82, -0.02, z], [0, 0, 0], [1, 1, 1], true)
            b.metal(block(1.0, 0.07, 1.1, 0.02), l.trim, [0.82, 0.47, z], [0, 0, 0], [1, 1, 1], true)
            b.metal(block(1.0, 0.07, 1.1, 0.02), l.trim, [0.82, -0.51, z], [0, 0, 0], [1, 1, 1], true)
            for (let k = 0; k < 4; k++) b.solid(new THREE.BoxGeometry(0.02, 0.1, 0.2), k % 2 ? l.trim : l.accent, [1.3, 0.3, z - 0.3 + k * 0.2], [0, 0, 0], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.03, 0.12, 0.12), l.glow, 2, [1.31, -0.25, z + 0.35], [0, 0, 0], [1, 1, 1], true)
        }
        // Crane on the roof
        b.metal(cyl(0.2, 0.25, 0.15, 10), l.trim, [0, 0.9, -1.55])
        b.solid(block(0.16, 0.16, 1.4, 0.02), l.accent, [0, 1.05, -1.0], [0.25, 0, 0])
        b.metal(new THREE.BoxGeometry(0.04, 0.6, 0.04), l.metal, [0, 0.95, -0.35])
        b.metal(block(0.2, 0.1, 0.2, 0.02), l.trim, [0, 0.62, -0.35])
        mast(b, [-0.5, 0.78, -1.3], 0.7)
        // Engine block with radiator fins
        b.solid(loft([
            { z: 1.95, w: 0.85, h: 0.62, y: 0.05 },
            { z: 2.3, w: 1.05, h: 0.75, y: 0.05 },
            { z: 2.85, w: 1.0, h: 0.7, y: 0.05 },
            { z: 3.0, w: 0.85, h: 0.6, y: 0.05 }
        ], 8, 0.55, Math.PI / 8), l.paint2)
        for (let i = 0; i < 4; i++) {
            b.metal(slab([[0, 0], [0.5, 0.1], [0.5, 0.5], [0, 0.6]], 0.04, 0.01), l.metal, [0.35 + i * 0.12, 0.72, 2.2], [0, 0, Math.PI / 2], [1, 1, 1], true)
        }
        b.glow(new THREE.BoxGeometry(0.02, 0.02, 0.55), l.glow, 2, [0.35, 1.23, 2.45], [0, 0, 0], [1, 1, 1], true)
        vent(b, [1.02, 0.1, 2.5], 0.06, 0.4, 0.5, true, 4)
        nacelle(b, l, [1.05, -0.35, 2.55], 0.24, 0.9, true)
        b.engine([0.42, 0.25, 3.05], 0.3, true, l.glow)
        b.engine([0, -0.28, 3.05], 0.3, false, l.glow)
        navLights(b, 1.35, 0.5, 1.9)
        b.hardpoint([0, 0.82, -1.95], [0, 1, 0])
        b.hardpoint([0, -0.36, 0.55], [0, -1, 0])
    },

    kestrel(b, l) {
        b.solid(loft([
            { z: -2.5, w: 0.05, h: 0.04, y: -0.02 },
            { z: -1.7, w: 0.42, h: 0.2 },
            { z: -0.4, w: 0.78, h: 0.32, y: 0.02 },
            { z: 1.0, w: 0.88, h: 0.34 },
            { z: 1.85, w: 0.7, h: 0.28 }
        ], 10, 0.62), l.paint)
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
        b.solid(slab([[1.6, 0.2], [2.3, 0.85], [2.05, 1.3], [1.5, 0.75]], 0.07, 0.02), l.paint2, [0, -0.015, 0], [0, 0, 0], [1, 1, 1], true)
        // Leading-edge light strips.
        b.glow(new THREE.BoxGeometry(0.03, 0.03, 2.75), l.glow, 2.6, [1.3, 0.01, -0.13], [0, -0.79, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.4, 0.02, 0.02), l.accent, 2.5, [0, 0.27, 0.6])
        // V-tail
        b.solid(slab([[0, 0.3], [0.55, 1.0], [0.45, 1.35], [0, 1.2]], 0.05, 0.015), l.paint2, [0.35, 0.15, 0.2], [0, 0, Math.PI / 2 - 0.65], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.02, 0.4, 0.02), l.glow, 2, [0.62, 0.52, 1.55], [0, 0, -0.65], [1, 1, 1], true)
        vent(b, [0.45, 0.12, 0.6], 0.3, 0.04, 0.4, true, 2)
        b.metal(block(0.7, 0.12, 0.35, 0.02), l.trim, [0, 0, 1.45])
        b.engine([0.26, 0, 1.55], 0.17, true, l.glow)
        b.hardpoint([0, 0.27, 0.45], [0, 1, 0])
        b.hardpoint([0.95, -0.05, 0.65], [0, -1, 0], true)
    },

    aegis(b, l) {
        b.solid(loft([
            { z: -3.4, w: 0.8, h: 0.5, y: -0.1 },
            { z: -2.6, w: 1.45, h: 0.9 },
            { z: 0, w: 1.8, h: 1.1 },
            { z: 2.4, w: 1.7, h: 1.0 },
            { z: 2.95, w: 1.35, h: 0.78 }
        ], 8, 0.5, Math.PI / 8), l.paint)
        // Armoured prow and chamfered side plates.
        b.solid(slab([[-0.9, -3.8], [0.9, -3.8], [1.5, -2.6], [-1.5, -2.6]], 0.5, 0.08), l.paint2, [0, -0.1, 0])
        for (let i = 0; i < 3; i++) {
            const z = -1.5 + i * 1.5
            b.solid(block(0.3, 1.2, 1.35, 0.08), i === 1 ? l.accent : l.paint2, [1.86, 0.05, z], [0, 0, 0.08], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.03, 0.05, 1.0), l.glow, 1.6, [2.02, -0.35, z], [0, 0, 0], [1, 1, 1], true)
        }
        // Sponsons
        b.solid(block(0.85, 0.9, 2.3, 0.08), l.paint2, [2.25, 0, -0.5], [0, 0, 0], [1, 1, 1], true)
        barrel(b, l, [2.25, 0, -2.0], 0.8, 0.09, true)
        // Bridge
        b.solid(loft([
            { z: -0.9, w: 0.5, h: 0.2, y: 1.2 },
            { z: -0.5, w: 0.7, h: 0.35, y: 1.3 },
            { z: 0.8, w: 0.7, h: 0.35, y: 1.3 },
            { z: 1.1, w: 0.55, h: 0.25, y: 1.25 }
        ], 8, 0.55, Math.PI / 8), l.paint2)
        windows(b, [-0.45, 1.4, -0.72], 7, 0.15, 0.1)
        mast(b, [0.35, 1.62, 0.7], 1.1)
        mast(b, [-0.3, 1.62, 0.8], 0.7)
        vent(b, [0.9, 0.95, 1.8], 0.6, 0.06, 0.8, true, 3)
        seam(b, l.glow, [0, 1.1, -2.2], 1.6, false, 'z', 0.8)
        navLights(b, 2.3, 0.5, 0.7)
        b.engine([0.6, 0.35, 3.05], 0.42, true, l.glow)
        b.engine([0.6, -0.35, 3.05], 0.38, true, l.glow)
        greeble(b, l, [0.8, 1.08, 1.5], 0.9, 1.4, 10, 11, true)
        greeble(b, l, [0.9, 0.96, -1.6], 0.8, 1.2, 8, 12, true)
        b.hardpoint([0, 1.12, 1.9], [0, 1, 0])
        b.hardpoint([0, 0.98, -1.7], [0, 1, 0])
        b.hardpoint([2.25, 0.46, -0.5], [0, 1, 0], true)
        b.hardpoint([2.25, -0.46, -0.5], [0, -1, 0], true)
    },

    hive(b, l) {
        b.solid(loft([
            { z: -3.5, w: 0.6, h: 0.3 },
            { z: -2.8, w: 1.6, h: 0.5 },
            { z: 2.6, w: 1.75, h: 0.55 },
            { z: 3.2, w: 1.25, h: 0.45 }
        ], 8, 0.45, Math.PI / 8), l.paint)
        // Flight deck with runway lights
        b.metal(block(2.7, 0.08, 5.6, 0.02), l.trim, [0, 0.56, -0.2])
        for (let i = 0; i < 8; i++) b.glow(new THREE.BoxGeometry(0.06, 0.02, 0.28), l.glow, 2, [0, 0.61, -2.6 + i * 0.62])
        seam(b, l.accent, [1.3, 0.61, -0.2], 5.4, true, 'z', 1.2)
        // Launch bay mouth
        b.metal(block(1.9, 0.5, 0.2, 0.03), 0x0b0c0f, [0, 0.1, -2.95])
        b.glow(new THREE.BoxGeometry(1.7, 0.08, 0.02), l.glow, 2.2, [0, 0.28, -3.06])
        // Side sponsons with bay doors
        for (const side of [1]) {
            b.solid(loft([
                { z: -2.2, w: 0.3, h: 0.3, x: 1.95 * side },
                { z: -1.6, w: 0.5, h: 0.42, x: 1.95 * side },
                { z: 2.1, w: 0.5, h: 0.42, x: 1.95 * side },
                { z: 2.6, w: 0.38, h: 0.32, x: 1.95 * side }
            ], 8, 0.6, Math.PI / 8), l.paint2, [0, -0.05, 0], [0, 0, 0], [1, 1, 1], true)
        }
        for (let i = 0; i < 3; i++) b.glow(new THREE.BoxGeometry(0.02, 0.3, 0.6), l.glow, 1.6, [2.46, -0.05, -1.0 + i * 1.1], [0, 0, 0], [1, 1, 1], true)
        // Island
        b.solid(loft([
            { z: 0.1, w: 0.25, h: 0.45, x: 1.15, y: 1.05 },
            { z: 0.4, w: 0.35, h: 0.5, x: 1.15, y: 1.05 },
            { z: 1.4, w: 0.35, h: 0.5, x: 1.15, y: 1.05 },
            { z: 1.6, w: 0.28, h: 0.4, x: 1.15, y: 1.05 }
        ], 8, 0.5, Math.PI / 8), l.paint2)
        windows(b, [0.82, 1.35, 0.9], 5, 0.18, 0.12, 'z')
        mast(b, [1.2, 1.55, 1.2], 1.1)
        b.metal(new THREE.ConeGeometry(0.25, 0.1, 10, 1, true).rotateX(Math.PI), l.metal, [1.1, 1.7, 0.5], [0.5, 0, 0])
        navLights(b, 2.45, 0.35, 2.5)
        b.engine([0.75, 0, 3.3], 0.45, true, l.glow)
        greeble(b, l, [-0.9, 0.6, 2.2], 0.6, 1.2, 8, 21)
        b.hardpoint([1.15, 1.56, 0.7], [0, 1, 0])
        b.hardpoint([0, -0.55, -0.5], [0, -1, 0])
    },

    seraph(b, l) {
        b.solid(loft([
            { z: -3.4, w: 0.02, h: 0.02 },
            { z: -2.3, w: 0.28, h: 0.22 },
            { z: -0.6, w: 0.55, h: 0.38, y: 0.03 },
            { z: 1.2, w: 0.6, h: 0.4 },
            { z: 2.3, w: 0.38, h: 0.28 }
        ], 12, 0.85), l.paint)
        b.solid(loft([
            { z: -2.8, w: 0.06, h: 0.05, y: -0.15 },
            { z: 2.0, w: 0.35, h: 0.1, y: -0.34 }
        ], 6, 0.6), l.paint2)
        canopy(b, l, -2.1, -0.75, 0.28, 0.24, 0.15)
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

    bastion(b, l) {
        b.solid(loft([
            { z: -5.4, w: 0.5, h: 0.4, y: -0.3 },
            { z: -4.3, w: 2.3, h: 1.2 },
            { z: 0, w: 3.1, h: 1.55 },
            { z: 4.0, w: 2.95, h: 1.45 },
            { z: 4.8, w: 2.4, h: 1.15 }
        ], 8, 0.5, Math.PI / 8), l.paint)
        // Ram prow
        b.solid(slab([[-0.4, -6.2], [0.4, -6.2], [2.2, -4.2], [-2.2, -4.2]], 0.7, 0.1), l.paint2, [0, -0.4, 0])
        b.glow(new THREE.BoxGeometry(3.0, 0.04, 0.04), l.glow, 1.6, [0, -0.02, -4.5])
        // Broadside gun decks
        b.solid(block(1.5, 2.0, 7.4, 0.12), l.paint2, [3.35, 0, 0.1], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[-0.6, -1.0], [0.6, -1.0], [0.75, 0.9], [-0.75, 0.9]], 2.0, 0.12), l.paint2, [3.35, 0, -4.2], [0, 0, 0], [1, 1, 1], true)
        for (let i = 0; i < 5; i++) b.glow(new THREE.BoxGeometry(0.03, 0.18, 0.5), l.glow, 1.8, [4.12, 0.4, -2.6 + i * 1.3], [0, 0, 0], [1, 1, 1], true)
        seam(b, l.accent, [4.11, -0.55, 0.1], 6.8, true, 'z', 1.4)
        // Stepped superstructure
        b.solid(block(2.4, 0.95, 4.2, 0.1), l.paint2, [0, 2.0, 0.4])
        b.solid(block(1.7, 1.0, 2.4, 0.1), l.paint, [0, 2.98, 1.0])
        b.solid(loft([
            { z: 0.1, w: 0.55, h: 0.25, y: 3.72 },
            { z: 0.35, w: 0.75, h: 0.35, y: 3.75 },
            { z: 1.3, w: 0.75, h: 0.35, y: 3.75 },
            { z: 1.5, w: 0.6, h: 0.28, y: 3.72 }
        ], 8, 0.5, Math.PI / 8), l.paint2)
        windows(b, [-0.55, 3.82, 0.22], 8, 0.155, 0.11)
        windows(b, [-0.95, 2.1, -1.72], 9, 0.24, 0.13)
        mast(b, [0.4, 4.1, 1.3], 2.2)
        mast(b, [-0.4, 4.1, 1.35], 1.5)
        b.metal(new THREE.ConeGeometry(0.4, 0.15, 12, 1, true).rotateX(Math.PI), l.metal, [0, 3.7, 2.2], [0.6, 0, 0])
        for (let i = 0; i < 4; i++) vent(b, [1.5, 1.6, -0.9 + i * 0.8], 0.06, 0.4, 0.5, true, 3)
        navLights(b, 4.15, 1.05, 3.6)
        b.engine([0, -0.1, 4.95], 0.8, false, l.glow)
        b.engine([1.55, 0.55, 4.9], 0.62, true, l.glow)
        b.engine([1.55, -0.65, 4.9], 0.55, true, l.glow)
        b.engine([3.35, 0, 3.95], 0.55, true, l.glow)
        greeble(b, l, [1.8, 1.5, -2.2], 1.4, 3.0, 22, 31, true)
        greeble(b, l, [3.35, 1.0, 1.0], 1.0, 4.0, 14, 32, true)
        greeble(b, l, [0.7, 2.5, 1.6], 0.8, 1.8, 10, 33, true)
        b.hardpoint([0, 2.49, -1.4], [0, 1, 0])
        b.hardpoint([0, 3.49, 1.95], [0, 1, 0])
        b.hardpoint([3.35, 1.01, -2.0], [0, 1, 0], true)
        b.hardpoint([3.35, 1.01, 2.0], [0, 1, 0], true)
        b.hardpoint([3.35, -1.01, 0], [0, -1, 0], true)
        b.hardpoint([0, -1.55, -1.0], [0, -1, 0])
        b.hardpoint([0, -1.45, 3.0], [0, -1, 0])
    },

    leviathan(b, l) {
        b.solid(loft([
            { z: -7.6, w: 1.1, h: 0.7 },
            { z: -6.5, w: 2.4, h: 1.5 },
            { z: -4.0, w: 2.6, h: 1.8 },
            { z: 3.0, w: 3.2, h: 2.2 },
            { z: 7.0, w: 2.8, h: 2.0 },
            { z: 8.0, w: 2.2, h: 1.55 }
        ], 10, 0.55, Math.PI / 10), l.paint)
        // Hammerhead prow
        b.solid(slab([[-3.8, -8.4], [3.8, -8.4], [4.4, -6.6], [-4.4, -6.6]], 0.9, 0.14), l.paint2, [0, 0.2, 0])
        b.glow(new THREE.BoxGeometry(7.2, 0.05, 0.05), l.glow, 1.8, [0, 0.2, -8.45])
        navLights(b, 4.35, 0.6, -7.5)
        // Spinal lance under the prow
        b.metal(tube(0.65, 0.85, 5, 12), l.trim, [0, -1.4, -8.4])
        for (let i = 0; i < 4; i++) b.glow(ring(0.8, 0.07, 4, 16), l.glow, 2.4, [0, -1.4, -9.8 + i * 1.0])
        b.glow(tube(0.42, 0.42, 0.1, 12), l.glow, 4, [0, -1.4, -10.93])
        // Outrigger hulls on struts
        b.solid(loft([
            { z: -3.6, w: 0.4, h: 0.5, x: 6 },
            { z: -2.6, w: 1.05, h: 1.25, x: 6 },
            { z: 4.4, w: 1.05, h: 1.25, x: 6 },
            { z: 5.2, w: 0.75, h: 0.9, x: 6 }
        ], 8, 0.55, Math.PI / 8), l.paint, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.metal(block(3.2, 0.5, 0.9, 0.06), l.metal, [4.3, 0.2, -1.2], [0, 0, 0], [1, 1, 1], true)
        b.metal(block(3.2, 0.5, 0.9, 0.06), l.metal, [4.3, -0.2, 2.8], [0, 0, 0], [1, 1, 1], true)
        seam(b, l.accent, [7.06, 0, 0.8], 6.4, true, 'z', 1.6)
        for (let i = 0; i < 6; i++) b.glow(new THREE.BoxGeometry(0.03, 0.14, 0.4), WINDOW, 1.4, [7.07, 0.45, -1.8 + i * 1.1], [0, 0, 0], [1, 1, 1], true)
        // Hull ribs and seams
        for (let i = 0; i < 6; i++) b.metal(block(0.2, 0.25, 0.35, 0.03), l.metal, [2.95, 0.9, -3 + i * 1.8], [0, 0, 0], [1, 1, 1], true)
        seam(b, l.glow, [2.9, -0.7, 0.5], 10, true, 'z', 1.2)
        // Superstructure
        b.solid(block(3.0, 1.2, 5.0, 0.12), l.paint2, [0, 2.7, 3.2])
        b.solid(block(2.0, 1.2, 3.0, 0.12), l.paint, [0, 3.85, 3.6])
        b.solid(loft([
            { z: 2.3, w: 0.8, h: 0.3, y: 4.75 },
            { z: 2.6, w: 1.0, h: 0.45, y: 4.8 },
            { z: 4.0, w: 1.0, h: 0.45, y: 4.8 },
            { z: 4.3, w: 0.8, h: 0.35, y: 4.75 }
        ], 8, 0.5, Math.PI / 8), l.paint2)
        windows(b, [-0.8, 4.9, 2.42], 11, 0.16, 0.11)
        windows(b, [-1.3, 2.85, 0.68], 11, 0.26, 0.14)
        b.solid(slab([[0, 0], [0.8, 0.6], [0.7, 3.6], [0, 4]], 0.2, 0.04), l.accent, [0, 3.35, 1.6], [0, 0, Math.PI / 2])
        mast(b, [0.5, 5.2, 3.9], 3)
        mast(b, [-0.5, 5.2, 3.7], 2.2)
        b.metal(new THREE.ConeGeometry(0.6, 0.2, 14, 1, true).rotateX(Math.PI), l.metal, [0, 4.55, 5.1], [0.6, 0, 0])
        for (let i = 0; i < 5; i++) vent(b, [1.6, 2.3, 1.2 + i * 0.9], 0.08, 0.5, 0.6, true, 3)
        // Engines
        b.engine([0, 0, 8.1], 1.0, false, l.glow)
        b.engine([1.55, 0.85, 8.05], 0.8, true, l.glow)
        b.engine([1.55, -0.95, 8.05], 0.8, true, l.glow)
        b.engine([6, 0, 5.4], 0.75, true, l.glow)
        greeble(b, l, [1.6, 1.85, -2.5], 1.6, 4.0, 30, 41, true)
        greeble(b, l, [6, 1.25, 0.4], 1.2, 6.0, 22, 42, true)
        greeble(b, l, [2.0, 2.25, 5.8], 1.2, 2.4, 14, 43, true)
        greeble(b, l, [1.0, 3.3, 3.2], 0.9, 3.8, 12, 44, true)
        b.hardpoint([0, 1.64, -6.1], [0, 1, 0])
        b.hardpoint([0, 1.78, -4.2], [0, 1, 0])
        b.hardpoint([0, 2.05, -0.8], [0, 1, 0])
        b.hardpoint([0, 4.46, 5.0], [0, 1, 0])
        b.hardpoint([6, 1.26, -1.5], [0, 1, 0], true)
        b.hardpoint([6, 1.26, 2.8], [0, 1, 0], true)
        b.hardpoint([6, -1.26, 0.6], [0, -1, 0], true)
        b.hardpoint([0, -2.1, 2.0], [0, -1, 0])
        b.hardpoint([0, -1.95, 6.2], [0, -1, 0])
    }
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

// ─── Turrets ───────────────────────────────────────────────────────────────

const T_PAINT = 0x9aa3af
const T_DARK = 0x2a2f37
const T_METAL = 0x69727e

export function buildTurret(type: VoidTurretId, color: number): TurretModel {
    const root = new THREE.Group()
    const baseB = new ModelBuilder()
    baseB.metal(cyl(0.3, 0.38, 0.12, 12), T_DARK, [0, 0.06, 0])
    baseB.solid(cyl(0.26, 0.3, 0.06, 12), T_PAINT, [0, 0.14, 0])
    baseB.glow(ring(0.3, 0.018, 3, 20), color, 1.6, [0, 0.13, 0], [Math.PI / 2, 0, 0])
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
    // Trunnion cheeks either side of the elevating head.
    yawB.metal(block(0.07, 0.26, 0.26, 0.015), T_DARK, [0.22, 0.12, 0], [0, 0, 0], [1, 1, 1], true)

    switch (type) {
        case 'pulse':
            headB.solid(loft([
                { z: -0.3, w: 0.14, h: 0.09 },
                { z: -0.15, w: 0.19, h: 0.13 },
                { z: 0.22, w: 0.19, h: 0.13 },
                { z: 0.28, w: 0.15, h: 0.1 }
            ], 8, 0.6, Math.PI / 8), T_PAINT)
            headB.glow(new THREE.BoxGeometry(0.02, 0.02, 0.3), color, 1.8, [0.15, 0.08, 0], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(tube(0.045, 0.06, 0.55, 8), T_METAL, [0, 0.01, -0.5])
            barrelB.metal(tube(0.075, 0.075, 0.08, 8), T_DARK, [0, 0.01, -0.73])
            barrelB.glow(tube(0.03, 0.03, 0.02, 8), color, 3, [0, 0.01, -0.78])
            muzzle = new THREE.Vector3(0, 0.01, -0.8)
            break
        case 'gatling':
            headB.solid(block(0.36, 0.28, 0.42, 0.04), T_PAINT)
            headB.metal(cyl(0.1, 0.1, 0.38, 10), T_DARK, [0.21, 0, 0.02], [Math.PI / 2, 0, 0])
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2
                barrelB.metal(tube(0.022, 0.022, 0.62, 5), T_METAL, [Math.cos(a) * 0.065, Math.sin(a) * 0.065, -0.5])
            }
            barrelB.metal(cyl(0.1, 0.1, 0.04, 10), T_DARK, [0, 0, -0.3], [Math.PI / 2, 0, 0])
            barrelB.metal(cyl(0.1, 0.1, 0.04, 10), T_DARK, [0, 0, -0.72], [Math.PI / 2, 0, 0])
            barrelB.glow(ring(0.1, 0.012, 3, 12), color, 2.2, [0, 0, -0.25])
            muzzle = new THREE.Vector3(0, 0, -0.82)
            break
        case 'flak':
            headB.solid(block(0.56, 0.3, 0.48, 0.05), T_PAINT)
            headB.metal(block(0.12, 0.22, 0.3, 0.02), T_DARK, [0.34, 0, 0.05], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(tube(0.075, 0.09, 0.42, 8), T_METAL, [0.13, 0, -0.4], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(tube(0.1, 0.1, 0.06, 8), T_DARK, [0.13, 0, -0.62], [0, 0, 0], [1, 1, 1], true)
            barrelB.glow(new THREE.BoxGeometry(0.44, 0.025, 0.025), color, 2.2, [0, 0.16, -0.12])
            muzzle = new THREE.Vector3(0, 0, -0.66)
            break
        case 'beam':
            headB.metal(ico(0.2, 1), T_PAINT, [0, 0, 0], [0, 0, 0], [1, 0.85, 1.25])
            headB.solid(block(0.04, 0.18, 0.34, 0.01), T_DARK, [0.22, 0, 0.05], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(tube(0.05, 0.13, 0.36, 8), T_DARK, [0, 0, -0.34])
            for (let i = 0; i < 3; i++) barrelB.glow(ring(0.075 - i * 0.012, 0.012, 3, 12), color, 2.4, [0, 0, -0.3 - i * 0.07])
            barrelB.glow(octa(0.08), color, 4.5, [0, 0, -0.58], [0, 0, 0], [1, 1, 1.8])
            muzzle = new THREE.Vector3(0, 0, -0.64)
            break
        case 'missile':
            headB.metal(block(0.22, 0.2, 0.28, 0.03), T_DARK)
            barrelB.solid(block(0.56, 0.36, 0.56, 0.05), T_PAINT, [0, 0.02, -0.12])
            for (let i = 0; i < 6; i++) {
                const x = -0.16 + (i % 3) * 0.16
                const y = i < 3 ? 0.1 : -0.06
                barrelB.metal(cyl(0.055, 0.055, 0.02, 8), T_DARK, [x, y + 0.02, -0.41], [Math.PI / 2, 0, 0])
                barrelB.glow(new THREE.CircleGeometry(0.035, 8).rotateY(Math.PI), color, 2.6, [x, y + 0.02, -0.425])
            }
            barrelB.glow(new THREE.BoxGeometry(0.58, 0.02, 0.02), color, 1.6, [0, 0.21, 0.1])
            muzzle = new THREE.Vector3(0, 0.02, -0.46)
            break
        case 'tesla':
            headB.metal(cyl(0.2, 0.24, 0.2, 10), T_DARK)
            headB.solid(cyl(0.16, 0.2, 0.08, 10), T_PAINT, [0, 0.12, 0])
            // A coil tower with glowing rings and a charged ball on top of the barrel.
            barrelB.metal(tube(0.05, 0.07, 0.5, 8), T_METAL, [0, 0.02, -0.34])
            for (let i = 0; i < 4; i++) barrelB.glow(ring(0.11 - i * 0.012, 0.014, 3, 14), color, 2.6, [0, 0.02, -0.18 - i * 0.12])
            barrelB.glow(ico(0.09, 1), color, 5, [0, 0.02, -0.66])
            barrelB.metal(block(0.02, 0.2, 0.02, 0.004), T_METAL, [0.1, 0.02, -0.62], [0, 0, 0.5], [1, 1, 1], true)
            muzzle = new THREE.Vector3(0, 0.02, -0.68)
            break
        case 'mortar':
            headB.solid(block(0.58, 0.34, 0.5, 0.06), T_PAINT)
            headB.metal(block(0.1, 0.26, 0.36, 0.02), T_DARK, [0.34, 0, 0.02], [0, 0, 0], [1, 1, 1], true)
            // One fat, short tube with a muzzle brake.
            barrelB.metal(tube(0.14, 0.16, 0.6, 12), T_METAL, [0, 0.03, -0.42])
            barrelB.metal(tube(0.19, 0.19, 0.12, 12), T_DARK, [0, 0.03, -0.74])
            barrelB.glow(ring(0.16, 0.02, 3, 16), color, 2.4, [0, 0.03, -0.8])
            barrelB.glow(new THREE.BoxGeometry(0.5, 0.024, 0.024), color, 1.8, [0, 0.19, 0.12])
            muzzle = new THREE.Vector3(0, 0.03, -0.84)
            break
        case 'rail':
            headB.solid(block(0.38, 0.26, 0.56, 0.04), T_PAINT)
            headB.metal(block(0.1, 0.14, 0.4, 0.02), T_DARK, [0.24, 0.02, 0.05], [0, 0, 0], [1, 1, 1], true)
            barrelB.metal(block(0.05, 0.1, 1.15, 0.01), T_METAL, [0.075, 0, -0.66], [0, 0, 0], [1, 1, 1], true)
            barrelB.glow(new THREE.BoxGeometry(0.03, 0.03, 1.05), color, 3, [0, 0, -0.64])
            for (let i = 0; i < 4; i++) barrelB.metal(block(0.2, 0.03, 0.05, 0.005), T_DARK, [0, 0.055, -0.25 - i * 0.25])
            muzzle = new THREE.Vector3(0, 0, -1.25)
            break
    }
    yaw.add(yawB.build().group)
    pitch.add(headB.build().group)
    barrel.add(barrelB.build().group)
    pitch.add(barrel)
    return { root, yaw, pitch, barrel, muzzle }
}

export function buildDrone(color: number): THREE.Group {
    const b = new ModelBuilder()
    b.solid(loft([
        { z: -0.55, w: 0.05, h: 0.04 },
        { z: -0.2, w: 0.2, h: 0.13 },
        { z: 0.3, w: 0.22, h: 0.14 },
        { z: 0.45, w: 0.16, h: 0.1 }
    ], 8, 0.7, Math.PI / 8), T_PAINT)
    b.solid(slab([[0.12, -0.05], [0.62, 0.2], [0.62, 0.34], [0.14, 0.34]], 0.04, 0.01), T_DARK, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
    b.glow(new THREE.BoxGeometry(0.03, 0.03, 0.14), color, 3, [0.62, 0, 0.27], [0, 0, 0], [1, 1, 1], true)
    b.glass(octa(0.09), 0x0a0f18, [0, 0.12, -0.22], [0, 0, 0], [1, 0.7, 1.6])
    b.glow(octa(0.06), color, 3.5, [0, 0, -0.56])
    b.glow(new THREE.CircleGeometry(0.1, 8), color, 2.5, [0, 0, 0.46])
    return b.build().group
}

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
