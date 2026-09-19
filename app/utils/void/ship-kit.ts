// Void Runner — the ship kit: lofting helpers and the dressing parts (canopies,
// nacelles, vents, greebles, radiators) every hull, hostile and structure is built from.

import * as THREE from 'three'
import type { ModelBuilder} from './models';
import { cyl, ico, octa, ring, tube } from './models'

export type Vec3 = [number, number, number]

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

export interface Livery {
    paint: number
    paint2: number
    trim: number
    metal: number
    accent: number
    glow: number
    glass: number
}

export const RED = 0xff3040
export const GREEN = 0x39ff88
export const WINDOW = 0xffe6b0
/** The near-black of a recessed panel gap. */
export const PANEL = 0x0e1014
/** Heat-stained metal around a nozzle. */
export const SCORCH = 0x3a302b
export const HAZARD = 0xf2c230

export function navLights(b: ModelBuilder, x: number, y: number, z: number) {
    b.glow(octa(0.07), RED, 3.5, [-x, y, z])
    b.glow(octa(0.07), GREEN, 3.5, [x, y, z])
}

export function windows(b: ModelBuilder, from: Vec3, count: number, spacing: number, size = 0.12, axis: 'x' | 'z' = 'x') {
    for (let i = 0; i < count; i++) {
        const at: Vec3 = axis === 'x' ? [from[0] + i * spacing, from[1], from[2]] : [from[0], from[1], from[2] + i * spacing]
        b.glow(new THREE.BoxGeometry(axis === 'x' ? size : 0.03, size * 0.6, axis === 'x' ? 0.03 : size), WINDOW, 1.5, at)
    }
}

export function mast(b: ModelBuilder, pos: Vec3, height: number, mirror = false) {
    b.metal(cyl(0.035, 0.07, height, 5), 0x3a414c, [pos[0], pos[1] + height / 2, pos[2]], [0, 0, 0], [1, 1, 1], mirror)
    b.glow(octa(0.08), RED, 3.5, [pos[0], pos[1] + height, pos[2]], [0, 0, 0], [1, 1, 1], mirror)
}

/** A long panel seam: a faint lit line inlaid on the hull. */
export function seam(b: ModelBuilder, color: number, from: Vec3, length: number, mirror = false, axis: 'x' | 'z' = 'z', intensity = 1) {
    const geo = axis === 'z' ? new THREE.BoxGeometry(0.03, 0.03, length) : new THREE.BoxGeometry(length, 0.03, 0.03)
    b.glow(geo, color, intensity, from, [0, 0, 0], [1, 1, 1], mirror)
}

/** Glass canopy with a metal frame rib and a lit sill. */
export function canopy(b: ModelBuilder, l: Livery, z0: number, z1: number, y: number, w: number, h: number) {
    const len = z1 - z0
    b.glass(loft([
        { z: z0, w: w * 0.1, h: h * 0.1, y },
        { z: z0 + len * 0.3, w: w * 0.85, h: h * 0.8, y: y + h * 0.35 },
        { z: z0 + len * 0.7, w, h, y: y + h * 0.4 },
        { z: z1, w: w * 0.5, h: h * 0.3, y: y + h * 0.1 }
    ], 8, 0.9), l.glass)
    b.metal(new THREE.BoxGeometry(0.04, 0.05, len * 0.75), l.trim, [0, y + h * 1.38, z0 + len * 0.55])
    // Frame hoops split the glass into a windscreen, a hood and a rear quarter.
    for (const [t, sw, sh, sy] of [[0.3, 0.85, 0.8, 0.35], [0.7, 1, 1, 0.4]] as const) {
        const hoop = { w: w * sw + 0.012, h: h * sh + 0.012, y: y + h * sy }
        b.metal(loft([{ z: z0 + len * t - len * 0.02, ...hoop }, { z: z0 + len * t + len * 0.02, ...hoop }], 8, 0.9), l.trim)
    }
    b.glow(new THREE.BoxGeometry(w * 1.7, 0.025, 0.025), l.glow, 1.2, [0, y + h * 0.05, z0 + len * 0.62])
}

/** Engine pod: a lofted nacelle ending in a nozzle, with an intake ring up front. */
export function nacelle(b: ModelBuilder, l: Livery, pos: Vec3, r: number, length: number, mirror = false) {
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
    b.metal(new THREE.BoxGeometry(0.05, r * 2.05, length * 0.3), l.trim, [x, y, z + length * 0.12], [0, 0, 0], [1, 1, 1], mirror)
    // Scorched heat shield ahead of the nozzle, a panel break behind the intake.
    b.metal(tube(r * 1.04, r * 1.0, length * 0.16, 10), SCORCH, [x, y, z + length * 0.4], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(tube(r * 1.03, r * 1.03, 0.025, 10), PANEL, [x, y, z - length * 0.22], [0, 0, 0], [1, 1, 1], mirror)
    b.glow(ring(r * 0.95, r * 0.05, 3, 12), l.glow, 1.4, [x, y, z + length / 2 + r * 0.62], [0, 0, 0], [1, 1, 1], mirror)
    b.engine([x, y, z + length / 2], r * 0.82, mirror, l.glow)
}

/** Recessed intake / vent grille: dark box with a few metal slats. */
export function vent(b: ModelBuilder, pos: Vec3, w: number, h: number, d: number, mirror = false, slats = 3) {
    b.metal(new THREE.BoxGeometry(w, h, d), 0x14171c, pos, [0, 0, 0], [1, 1, 1], mirror)
    for (let i = 0; i < slats; i++) {
        b.metal(new THREE.BoxGeometry(w * 1.05, h * 0.12, d * 0.9), 0x59616d, [pos[0], pos[1] - h * 0.35 + (i * h * 0.7) / Math.max(1, slats - 1), pos[2]], [0, 0, 0], [1, 1, 1], mirror)
    }
}

/**
 * Surface clutter for big flat decks: small plates, pipes and boxes laid out
 * deterministically so a hull always looks the same.
 */
export function greeble(b: ModelBuilder, l: Livery, center: Vec3, sizeX: number, sizeZ: number, count: number, seed: number, mirror = false) {
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
export function barrel(b: ModelBuilder, l: Livery, pos: Vec3, length: number, r: number, mirror = false) {
    b.metal(tube(r, r * 1.2, length, 8), l.metal, pos, [0, 0, 0], [1, 1, 1], mirror)
    b.metal(tube(r * 1.5, r * 1.5, length * 0.12, 8), l.trim, [pos[0], pos[1], pos[2] - length * 0.45], [0, 0, 0], [1, 1, 1], mirror)
    b.glow(tube(r * 0.6, r * 0.6, 0.02, 8), l.glow, 2.5, [pos[0], pos[1], pos[2] - length * 0.51], [0, 0, 0], [1, 1, 1], mirror)
}

/** The hull's cross-section at `z`, interpolated between the two sections around it. */
export function sectionAt(sections: Section[], z: number): Section {
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
export function band(b: ModelBuilder, sections: Section[], z0: number, z1: number, color: number, shape: [number, number, number], grow = 0.03, glow = 0, mirror = false) {
    const inner = sections.filter(s => s.z > z0 && s.z < z1)
    const geo = loft([sectionAt(sections, z0), ...inner, sectionAt(sections, z1)].map(s => ({ ...s, w: s.w + grow, h: s.h + grow })), ...shape)
    if (glow) b.glow(geo, color, glow, [0, 0, 0], [0, 0, 0], [1, 1, 1], mirror)
    else b.solid(geo, color, [0, 0, 0], [0, 0, 0], [1, 1, 1], mirror)
}

/** A turret ring bolted to the hull, with its hardpoint on top. */
export function mount(b: ModelBuilder, l: Livery, pos: Vec3, up = true, mirror = false, r = 0.3) {
    b.metal(cyl(up ? r : r * 1.2, up ? r * 1.2 : r, 0.1, 8), l.trim, pos, [0, 0, 0], [1, 1, 1], mirror)
    b.hardpoint([pos[0], pos[1] + (up ? 0.05 : -0.05), pos[2]], [0, up ? 1 : -1, 0], mirror)
}

/** An armour plate standing on a flank. The outline is (height, z); a positive tilt leans its top inboard. */
export function flankPlate(b: ModelBuilder, color: number, outline: [number, number][], thickness: number, pos: Vec3, tilt = 0, bevel = 0.05) {
    b.solid(slab(outline, thickness, bevel), color, pos, [0, 0, Math.PI / 2 + tilt], [1, 1, 1], true)
}

/** A radiator wing reaching out from `pos` along X, its hot coils lit on both faces. */
export function radiator(b: ModelBuilder, l: Livery, pos: Vec3, w: number, d: number, tilt: number, color: number, coils = 4) {
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
export function tank(b: ModelBuilder, l: Livery, color: number, pos: Vec3, r: number, length: number, mirror = false) {
    b.solid(tube(r, r, length, 10), color, pos, [0, 0, 0], [1, 1, 1], mirror)
    for (const end of [-1, 1]) b.solid(ico(r, 1), color, [pos[0], pos[1], pos[2] + end * length / 2], [0, 0, 0], [1, 1, 0.6], mirror)
    for (const t of [-0.3, 0.3]) b.metal(ring(r * 1.03, r * 0.08, 4, 12), l.metal, [pos[0], pos[1], pos[2] + t * length], [0, 0, 0], [1, 1, 1], mirror)
}

/** A sensor dish on a short stalk, tipped back to look up and aft. */
export function dish(b: ModelBuilder, l: Livery, pos: Vec3, r: number) {
    b.metal(cyl(r * 0.12, r * 0.18, r * 0.8, 6), l.trim, [pos[0], pos[1] + r * 0.4, pos[2]])
    b.metal(new THREE.ConeGeometry(r, r * 0.4, 12, 1, true).rotateX(Math.PI), l.metal, [pos[0], pos[1] + r, pos[2]], [0.6, 0, 0])
    b.glow(octa(r * 0.14), l.glow, 3, [pos[0], pos[1] + r * 1.15, pos[2] + r * 0.2])
}

export function shade(color: number, f: number) {
    return new THREE.Color(color).multiplyScalar(f).getHex()
}

// ─── Fine dressing ─────────────────────────────────────────────────────────

/** Rotates an (x, z) offset the way a part yawed by `yaw` is turned. */
function yawed(pos: Vec3, dx: number, dz: number, yaw: number): Vec3 {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    return [pos[0] + dx * c + dz * s, pos[1], pos[2] - dx * s + dz * c]
}

/** A dark panel gap inlaid on a flat surface; `yaw` swings it to follow a swept edge. */
export function panelLine(b: ModelBuilder, from: Vec3, length: number, axis: 'x' | 'z' = 'z', mirror = false, yaw = 0, width = 0.018) {
    const geo = axis === 'z' ? new THREE.BoxGeometry(width, 0.012, length) : new THREE.BoxGeometry(length, 0.012, width)
    b.metal(geo, PANEL, from, [0, yaw, 0], [1, 1, 1], mirror)
}

/** Black and yellow warning chevrons laid flat: bay edges, step zones, danger areas. */
export function hazard(b: ModelBuilder, pos: Vec3, length: number, depth: number, count: number, mirror = false, axis: 'x' | 'z' = 'x', yaw = 0) {
    const step = length / count
    for (let i = 0; i < count; i++) {
        const t = -length / 2 + step * (i + 0.5)
        const geo = axis === 'x' ? new THREE.BoxGeometry(step, 0.012, depth) : new THREE.BoxGeometry(depth, 0.012, step)
        b.solid(geo, i % 2 ? 0x15171b : HAZARD, axis === 'x' ? yawed(pos, t, 0, yaw) : yawed(pos, 0, t, yaw), [0, yaw, 0], [1, 1, 1], mirror)
    }
}

/** A reaction-control quad: a small housing with nozzles up (or down), outboard and forward. */
export function rcs(b: ModelBuilder, l: Livery, pos: Vec3, mirror = false, up = true, s = 1) {
    const v = up ? 1 : -1
    b.metal(block(0.11 * s, 0.05 * s, 0.16 * s, 0.012 * s), l.trim, pos, [0, 0, 0], [1, 1, 1], mirror)
    b.metal(cyl(0.028 * s, 0.018 * s, 0.05 * s, 6), 0x1a1d22, [pos[0], pos[1] + v * 0.045 * s, pos[2] - 0.035 * s], [up ? 0 : Math.PI, 0, 0], [1, 1, 1], mirror)
    b.metal(cyl(0.028 * s, 0.018 * s, 0.05 * s, 6), 0x1a1d22, [pos[0], pos[1] + v * 0.045 * s, pos[2] + 0.035 * s], [up ? 0 : Math.PI, 0, 0], [1, 1, 1], mirror)
    b.metal(cyl(0.028 * s, 0.018 * s, 0.05 * s, 6), 0x1a1d22, [pos[0] + 0.07 * s, pos[1], pos[2]], [0, 0, -Math.PI / 2], [1, 1, 1], mirror)
}

/** A whip aerial on a small base, raked aft. */
export function aerial(b: ModelBuilder, pos: Vec3, height: number, rake = 0.35, mirror = false) {
    b.metal(cyl(0.025, 0.035, 0.05, 6), 0x3a414c, [pos[0], pos[1] + 0.02, pos[2]], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(cyl(0.005, 0.011, height, 4), 0x23272e, [pos[0], pos[1] + Math.cos(rake) * height / 2, pos[2] + Math.sin(rake) * height / 2], [rake, 0, 0], [1, 1, 1], mirror)
}

/** A landing skid slung under the hull on two raked struts, its toe turned up. */
export function skid(b: ModelBuilder, l: Livery, pos: Vec3, length: number, drop: number, mirror = false) {
    const [x, y, z] = pos
    const r = Math.max(0.018, length * 0.022)
    b.metal(tube(r, r, length, 6), l.metal, [x, y - drop, z], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(tube(r, r, length * 0.18, 6), l.metal, [x, y - drop + length * 0.035, z - length * 0.57], [-0.45, 0, 0], [1, 1, 1], mirror)
    for (const t of [-0.28, 0.3]) {
        b.metal(new THREE.BoxGeometry(r * 1.6, drop * 1.08, r * 2.6), l.trim, [x, y - drop / 2, z + t * length - drop * 0.12], [0.25, 0, 0], [1, 1, 1], mirror)
        b.metal(block(r * 4, r * 1.6, r * 5, r * 0.4), l.trim, [x, y - drop, z + t * length], [0, 0, 0], [1, 1, 1], mirror)
    }
}

/** Closed gear-bay doors on a belly: a dark frame with two leaves and a centre gap. */
export function gearBay(b: ModelBuilder, l: Livery, pos: Vec3, w: number, d: number, mirror = false, color = l.paint2) {
    b.metal(new THREE.BoxGeometry(w, 0.02, d), PANEL, pos, [0, 0, 0], [1, 1, 1], mirror)
    for (const side of [-1, 1]) b.solid(block(w * 0.44, 0.03, d * 0.92, 0.008), color, [pos[0] + side * w * 0.245, pos[1] - 0.006, pos[2]], [0, 0, 0], [1, 1, 1], mirror)
}

/** An intake scoop: a boxy duct with a raised lip, a black throat and splitter vanes. */
export function intake(b: ModelBuilder, l: Livery, pos: Vec3, w: number, h: number, d: number, mirror = false, color = l.paint2, vanes = 2) {
    const [x, y, z] = pos
    b.solid(loft([
        { z: z - d / 2, w: w / 2, h: h / 2, x, y },
        { z: z + d * 0.1, w: w / 2, h: h / 2, x, y },
        { z: z + d / 2, w: w * 0.32, h: h * 0.3, x, y }
    ], 8, 0.45, Math.PI / 8), color, [0, 0, 0], [0, 0, 0], [1, 1, 1], mirror)
    const lip = { w: w / 2 + 0.015, h: h / 2 + 0.015, x, y }
    b.metal(loft([{ z: z - d / 2 - 0.035, ...lip }, { z: z - d / 2 + 0.05, ...lip }], 8, 0.45, Math.PI / 8), l.trim, [0, 0, 0], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(new THREE.BoxGeometry(w * 0.84, h * 0.84, 0.02), 0x050608, [x, y, z - d / 2 - 0.04], [0, 0, 0], [1, 1, 1], mirror)
    for (let i = 0; i < vanes; i++) {
        b.metal(new THREE.BoxGeometry(0.015, h * 0.84, 0.03), l.metal, [x - w * 0.42 + (w * 0.84 * (i + 1)) / (vanes + 1), y, z - d / 2 - 0.045], [0, 0, 0], [1, 1, 1], mirror)
    }
}

/**
 * A full engine: scorched heat-shield collar, cooling fins, segmented nozzle
 * petals and an afterburner ring around the builder's bell. Registers the engine.
 */
export function thruster(b: ModelBuilder, l: Livery, pos: Vec3, r: number, mirror = false, petals = 8, fins = true) {
    const [x, y, z] = pos
    b.metal(tube(r * 1.42, r * 1.5, r * 0.7, 12), SCORCH, [x, y, z - r * 0.35], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(ring(r * 1.46, r * 0.07, 4, 12), l.metal, [x, y, z - r * 0.68], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(ring(r * 1.5, r * 0.06, 4, 12), l.trim, [x, y, z], [0, 0, 0], [1, 1, 1], mirror)
    for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + Math.PI / petals
        const R = r * 1.3
        b.metal(block(r * 0.72, r * 0.09, r * 0.95, r * 0.03), i % 2 ? 0x4a515c : 0x353b45, [x + Math.cos(a) * R, y + Math.sin(a) * R, z + r * 0.42], [0, 0, a + Math.PI / 2], [1, 1, 1], mirror)
    }
    for (let i = 0; fins && i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        b.metal(new THREE.BoxGeometry(r * 0.08, r * 0.5, r * 0.8), l.metal, [x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r * 1.6, z - r * 0.3], [0, 0, a + Math.PI / 2], [1, 1, 1], mirror)
    }
    b.glow(ring(r * 0.97, r * 0.05, 3, 14), l.glow, 1.5, [x, y, z + r * 0.8], [0, 0, 0], [1, 1, 1], mirror)
    b.engine(pos, r, mirror, l.glow)
}

/** A faired gun: a blister on the hull with the barrel running out of its nose. */
export function gunFairing(b: ModelBuilder, l: Livery, pos: Vec3, length: number, r: number, barrelLength: number, mirror = false, color = l.paint2) {
    const [x, y, z] = pos
    b.solid(loft([
        { z: z - length / 2, w: r * 0.75, h: r * 0.75, x, y },
        { z: z - length * 0.3, w: r * 1.25, h: r * 1.15, x, y },
        { z: z + length * 0.2, w: r * 1.25, h: r * 1.15, x, y },
        { z: z + length / 2, w: r * 0.4, h: r * 0.4, x, y }
    ], 8, 0.7), color, [0, 0, 0], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(tube(r * 0.8, r * 0.8, 0.04, 8), l.trim, [x, y, z - length / 2], [0, 0, 0], [1, 1, 1], mirror)
    barrel(b, l, [x, y, z - length / 2 - barrelLength * 0.42], barrelLength, r * 0.42, mirror)
    // Cooling slots along the blister.
    for (let i = 0; i < 3; i++) b.metal(new THREE.BoxGeometry(r * 0.5, 0.012, length * 0.07), PANEL, [x, y + r * 1.13, z - length * 0.18 + i * length * 0.13], [0, 0, 0], [1, 1, 1], mirror)
}

/** An armour plate saddled over the top (or belly) of a lofted hull between two stations. */
export function saddle(b: ModelBuilder, sections: Section[], z0: number, z1: number, color: number, frac = 0.6, lift = 0.02, top = true, mirror = false) {
    const inner = sections.filter(s => s.z > z0 && s.z < z1)
    const v = top ? 1 : -1
    const geo = loft([sectionAt(sections, z0), ...inner, sectionAt(sections, z1)].map(s => ({
        z: s.z, x: s.x, w: s.w * frac, h: s.h * 0.35, y: (s.y ?? 0) + v * (s.h * 0.68 + lift)
    })), 8, 0.5, Math.PI / 8)
    b.solid(geo, color, [0, 0, 0], [0, 0, 0], [1, 1, 1], mirror)
}

/** A flush formation light: a lit strip in a dark bezel. */
export function stripLight(b: ModelBuilder, color: number, pos: Vec3, length: number, axis: 'x' | 'z' = 'z', mirror = false, intensity = 2, yaw = 0) {
    const size = (len: number, wd: number, hh: number) => axis === 'z' ? new THREE.BoxGeometry(wd, hh, len) : new THREE.BoxGeometry(len, hh, wd)
    b.metal(size(length + 0.04, 0.06, 0.02), PANEL, pos, [0, yaw, 0], [1, 1, 1], mirror)
    b.glow(size(length, 0.028, 0.03), color, intensity, pos, [0, yaw, 0], [1, 1, 1], mirror)
}

