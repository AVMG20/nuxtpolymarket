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

/** The hull's cross-section at `z`, interpolated between the two sections around it. */
function sectionAt(sections: Section[], z: number): Section {
    for (let i = 0; i < sections.length - 1; i++) {
        const a = sections[i]!
        const c = sections[i + 1]!
        if (z < a.z || z > c.z) continue
        const t = (z - a.z) / (c.z - a.z)
        const mix = (p: number, q: number) => p + (q - p) * t
        return { z, w: mix(a.w, c.w), h: mix(a.h, c.h), x: mix(a.x ?? 0, c.x ?? 0), y: mix(a.y ?? 0, c.y ?? 0) }
    }
    return { ...(z < sections[0]!.z ? sections[0]! : sections[sections.length - 1]!), z }
}

/** A painted or lit band hugging a lofted hull between two stations: livery stripes, armour belts, light strips. */
function band(b: ModelBuilder, sections: Section[], z0: number, z1: number, color: number, shape: [number, number, number], grow = 0.03, glow = 0, mirror = false) {
    const inner = sections.filter(s => s.z > z0 && s.z < z1)
    const geo = loft([sectionAt(sections, z0), ...inner, sectionAt(sections, z1)].map(s => ({ ...s, w: s.w + grow, h: s.h + grow })), ...shape)
    if (glow) b.glow(geo, color, glow, [0, 0, 0], [0, 0, 0], [1, 1, 1], mirror)
    else b.solid(geo, color, [0, 0, 0], [0, 0, 0], [1, 1, 1], mirror)
}

/** A turret ring bolted to the hull, with its hardpoint on top. */
function mount(b: ModelBuilder, l: Livery, pos: Vec3, up = true, mirror = false, r = 0.3) {
    b.metal(cyl(up ? r : r * 1.2, up ? r * 1.2 : r, 0.1, 8), l.trim, pos, [0, 0, 0], [1, 1, 1], mirror)
    b.hardpoint([pos[0], pos[1] + (up ? 0.05 : -0.05), pos[2]], [0, up ? 1 : -1, 0], mirror)
}

/** An armour plate standing on a flank. The outline is (height, z); a positive tilt leans its top inboard. */
function flankPlate(b: ModelBuilder, color: number, outline: [number, number][], thickness: number, pos: Vec3, tilt = 0, bevel = 0.05) {
    b.solid(slab(outline, thickness, bevel), color, pos, [0, 0, Math.PI / 2 + tilt], [1, 1, 1], true)
}

/** A radiator wing reaching out from `pos` along X, its hot coils lit on both faces. */
function radiator(b: ModelBuilder, l: Livery, pos: Vec3, w: number, d: number, tilt: number, color: number, coils = 4) {
    const c = Math.cos(tilt)
    const s = Math.sin(tilt)
    const at = (u: number, v: number, z: number): Vec3 => [pos[0] + u * c - v * s, pos[1] + u * s + v * c, pos[2] + z]
    b.metal(block(w, 0.06, d, 0.015), l.trim, at(w / 2, 0, 0), [0, 0, tilt], [1, 1, 1], true)
    b.metal(new THREE.BoxGeometry(w, 0.1, 0.08), l.metal, at(w / 2, 0, -d / 2), [0, 0, tilt], [1, 1, 1], true)
    for (let i = 0; i < coils; i++) {
        const z = -d / 2 + (d * (i + 0.75)) / (coils + 0.5)
        for (const v of [0.04, -0.04]) b.glow(new THREE.BoxGeometry(w * 0.86, 0.015, d * 0.09), color, 1.7, at(w * 0.52, v, z), [0, 0, tilt], [1, 1, 1], true)
    }
}

/** A pressure tank lying along Z: domed ends and metal straps. */
function tank(b: ModelBuilder, l: Livery, color: number, pos: Vec3, r: number, length: number, mirror = false) {
    b.solid(tube(r, r, length, 10), color, pos, [0, 0, 0], [1, 1, 1], mirror)
    for (const end of [-1, 1]) b.solid(ico(r, 1), color, [pos[0], pos[1], pos[2] + end * length / 2], [0, 0, 0], [1, 1, 0.6], mirror)
    for (const t of [-0.3, 0.3]) b.metal(ring(r * 1.03, r * 0.08, 4, 12), l.metal, [pos[0], pos[1], pos[2] + t * length], [0, 0, 0], [1, 1, 1], mirror)
}

/** A sensor dish on a short stalk, tipped back to look up and aft. */
function dish(b: ModelBuilder, l: Livery, pos: Vec3, r: number) {
    b.metal(cyl(r * 0.12, r * 0.18, r * 0.8, 6), l.trim, [pos[0], pos[1] + r * 0.4, pos[2]])
    b.metal(new THREE.ConeGeometry(r, r * 0.4, 12, 1, true).rotateX(Math.PI), l.metal, [pos[0], pos[1] + r, pos[2]], [0.6, 0, 0])
    b.glow(octa(r * 0.14), l.glow, 3, [pos[0], pos[1] + r * 1.15, pos[2] + r * 0.2])
}

function shade(color: number, f: number) {
    return new THREE.Color(color).multiplyScalar(f).getHex()
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
        const ROUND: [number, number, number] = [10, 0.72, 0]
        const hull: Section[] = [
            { z: -1.75, w: 0.02, h: 0.02, y: -0.02 },
            { z: -1.25, w: 0.15, h: 0.11 },
            { z: -0.55, w: 0.3, h: 0.22, y: 0.02 },
            { z: 0.35, w: 0.36, h: 0.25 },
            { z: 1.0, w: 0.32, h: 0.22 },
            { z: 1.25, w: 0.26, h: 0.18 }
        ]
        b.solid(loft(hull, ...ROUND), l.paint)
        band(b, hull, -1.5, -1.3, l.accent, ROUND, 0.008)
        band(b, hull, 0.42, 0.56, l.accent, ROUND, 0.008)
        band(b, hull, 0.6, 0.64, l.trim, ROUND, 0.008)
        band(b, hull, 1.05, 1.24, l.paint2, ROUND, 0.008)
        b.metal(tube(0.008, 0.012, 0.35, 5), l.metal, [0, -0.02, -1.9])
        // Flaps, a missile under each wing and a whip aerial.
        b.solid(slab([[0.5, 0.78], [1.4, 0.78], [1.5, 0.92], [0.4, 0.97]], 0.075, 0.01), l.paint2, [0, -0.04, 0], [0, 0, 0], [1, 1, 1], true)
        seam(b, l.glow, [0.95, 0.0, 0.76], 0.9, true, 'x', 0.9)
        b.metal(tube(0.035, 0.035, 0.5, 6), l.trim, [0.9, -0.12, 0.45], [0, 0, 0], [1, 1, 1], true)
        b.solid(new THREE.ConeGeometry(0.035, 0.12, 6).rotateX(-Math.PI / 2), RED, [0.9, -0.12, 0.14], [0, 0, 0], [1, 1, 1], true)
        b.metal(new THREE.BoxGeometry(0.03, 0.06, 0.2), l.metal, [0.9, -0.075, 0.5], [0, 0, 0], [1, 1, 1], true)
        b.metal(cyl(0.006, 0.01, 0.4, 4), l.trim, [0, 0.45, 0.55], [-0.35, 0, 0])
        b.glow(ring(0.27, 0.012, 3, 14), l.glow, 1.8, [0, 0, 1.42])
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
        const ROUND: [number, number, number] = [10, 0.7, 0]
        const hull: Section[] = [
            { z: -2.3, w: 0.02, h: 0.02 },
            { z: -1.5, w: 0.13, h: 0.11 },
            { z: -0.5, w: 0.25, h: 0.21, y: 0.02 },
            { z: 0.7, w: 0.3, h: 0.23 },
            { z: 1.25, w: 0.2, h: 0.16 }
        ]
        b.solid(loft(hull, ...ROUND), l.paint)
        // Wasp bands down the abdomen and a steel stinger on the nose.
        for (const z of [-0.1, 0.3, 0.7, 1.05]) band(b, hull, z, z + 0.18, l.paint2, ROUND, 0.008)
        band(b, hull, -2.1, -1.85, l.trim, ROUND, 0.006)
        b.metal(new THREE.ConeGeometry(0.03, 0.5, 6).rotateX(-Math.PI / 2), l.metal, [0, 0, -2.5])
        b.glow(octa(0.035), l.glow, 3, [0, 0, -2.76])
        b.glow(new THREE.BoxGeometry(1.1, 0.02, 0.02), l.glow, 1.1, [0.95, 0.095, 0.42], [0, 0.535, 0.06], [1, 1, 1], true)
        tank(b, l, l.paint2, [0, -0.3, 0.45], 0.1, 0.7)
        b.metal(new THREE.BoxGeometry(0.03, 0.1, 0.3), l.metal, [0, -0.22, 0.45])
        b.metal(cyl(0.006, 0.01, 0.35, 4), l.trim, [0.1, 0.4, 0.2], [-0.4, 0, 0], [1, 1, 1], true)
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
        windows(b, [1.05, 0.3, -2.0], 3, 0.25, 0.14, 'z')
        windows(b, [-1.05, 0.3, -2.0], 3, 0.25, 0.14, 'z')
        // Bumper, work lights and the mining drills under the chin.
        for (let i = 0; i < 5; i++) b.solid(block(0.2, 0.06, 0.34, 0.01), i % 2 ? l.trim : l.accent, [-0.48 + i * 0.24, -0.52, -2.66], [0.75, 0, 0])
        b.glow(new THREE.BoxGeometry(0.24, 0.1, 0.04), 0xfff4d6, 3.2, [0.55, -0.18, -2.95], [0, 0, 0], [1, 1, 1], true)
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
        b.engine([0.45, 0.22, 3.32], 0.31, true, l.glow)
        b.engine([0, -0.3, 3.32], 0.31, false, l.glow)
        navLights(b, 1.4, 0.55, 2.2)
        mount(b, l, [0, 0.84, -2.0], true, false, 0.26)
        mount(b, l, [0, -0.48, 0.6], false, false, 0.26)
        mount(b, l, [0.86, 0.5, 0.58], true, true, 0.26)
    },

    kestrel(b, l) {
        const ROUND: [number, number, number] = [10, 0.62, 0]
        const hull: Section[] = [
            { z: -2.5, w: 0.05, h: 0.04, y: -0.02 },
            { z: -1.7, w: 0.42, h: 0.2 },
            { z: -0.4, w: 0.78, h: 0.32, y: 0.02 },
            { z: 1.0, w: 0.88, h: 0.34 },
            { z: 1.85, w: 0.7, h: 0.28 }
        ]
        b.solid(loft(hull, ...ROUND), l.paint)
        band(b, hull, -2.3, -1.95, l.trim, ROUND, 0.008)
        band(b, hull, -0.3, 0.0, l.paint2, ROUND, 0.01)
        band(b, hull, 0.04, 0.09, l.accent, ROUND, 0.01, 1.3)
        band(b, hull, 1.3, 1.8, l.paint2, ROUND, 0.01)
        // Chin cannon, armoured cheeks, and ordnance under the wings.
        b.metal(block(0.22, 0.14, 0.7, 0.02), l.trim, [0, -0.28, -1.35])
        for (const x of [-0.05, 0.05]) b.metal(tube(0.025, 0.03, 0.75, 6), l.metal, [x, -0.3, -1.95])
        b.glow(new THREE.BoxGeometry(0.14, 0.02, 0.02), l.glow, 2.4, [0, -0.3, -2.33])
        b.solid(slab([[0.3, -1.6], [0.62, -0.9], [0.7, -0.3], [0.45, -0.35]], 0.1, 0.02), l.paint2, [0, 0.16, 0], [0, 0, -0.35], [1, 1, 1], true)
        for (const x of [1.1, 1.5, 1.9]) {
            b.metal(tube(0.05, 0.05, 0.7, 6), l.trim, [x, -0.14, 0.45 + (x - 1.1) * 0.35], [0, 0, 0], [1, 1, 1], true)
            b.solid(new THREE.ConeGeometry(0.05, 0.16, 6).rotateX(-Math.PI / 2), x === 1.5 ? l.accent : RED, [x, -0.14, 0.02 + (x - 1.1) * 0.35], [0, 0, 0], [1, 1, 1], true)
        }
        b.solid(slab([[0.85, 0.95], [2.25, 0.85], [2.28, 1.08], [0.8, 1.28]], 0.125, 0.02), l.paint2, [0, 0, 0], [0, 0, 0.04], [1, 1, 1], true)
        b.metal(cyl(0.008, 0.012, 0.5, 4), l.trim, [0, 0.55, 1.2], [-0.35, 0, 0])
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
        b.hardpoint([0, 0.35, 0.3], [0, 1, 0])
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
        // Sawtooth panels, faint seams across the skin, a bay under the belly and a probe on the nose.
        for (let i = 0; i < 3; i++) b.solid(slab([[0, 0], [0.3, -0.22], [0.42, 0.08], [0.1, 0.2]], 0.075, 0.01), l.paint2, [0.6 + i * 0.42, -0.02, 0.62 + i * 0.07], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.015, 0.015, 1.0), l.accent, 0.9, [0.75, 0.02, 0.25], [0, 0.35, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.015, 0.015, 0.7), l.accent, 0.9, [1.3, 0.02, 0.6], [0, 0.35, 0], [1, 1, 1], true)
        b.metal(block(0.5, 0.04, 0.9, 0.01), l.trim, [0, -0.25, 0.3])
        seam(b, l.glow, [0, -0.275, 0.3], 0.8, false, 'z', 0.8)
        b.metal(tube(0.008, 0.012, 0.4, 5), l.metal, [0, 0, -2.68])
        b.solid(slab([[0.05, -2.2], [0.3, -1.15], [0.12, -1.2]], 0.05, 0.01), l.paint2, [0, 0.06, 0], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.62, 0.025, 0.02), l.glow, 1.6, [0, 0.0, 1.64])
        b.solid(slab([[1.6, 0.2], [2.3, 0.85], [2.05, 1.3], [1.5, 0.75]], 0.07, 0.02), l.paint2, [0, -0.015, 0], [0, 0, 0], [1, 1, 1], true)
        // Leading-edge light strips.
        b.glow(new THREE.BoxGeometry(0.03, 0.03, 2.7), l.glow, 2.6, [1.3, 0.01, -0.13], [0, 0.797, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.4, 0.02, 0.02), l.accent, 2.5, [0, 0.27, 0.6])
        // V-tail
        b.solid(slab([[0, 0.3], [0.55, 1.0], [0.45, 1.35], [0, 1.2]], 0.05, 0.015), l.paint2, [0.35, 0.15, 0.2], [0, 0, Math.PI / 2 - 0.65], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.02, 0.36, 0.02), l.glow, 2, [0.49, 0.34, 1.47], [0, 0, -0.65], [1, 1, 1], true)
        vent(b, [0.45, 0.12, 0.6], 0.3, 0.04, 0.4, true, 2)
        b.metal(block(0.7, 0.12, 0.35, 0.02), l.trim, [0, 0, 1.45])
        b.engine([0.26, 0, 1.55], 0.17, true, l.glow)
        b.hardpoint([0, 0.27, 0.45], [0, 1, 0])
        b.hardpoint([0.95, -0.05, 0.65], [0, -1, 0], true)
    },

    // A shield-bearer: a navy core hull carried between overlapping pauldron
    // plates, with a projector ring held out ahead of the nose.
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
