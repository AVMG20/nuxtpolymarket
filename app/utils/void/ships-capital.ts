// Void Runner — capital player hulls: Aegis, Hive, Seraph, Bastion, Tempest, Leviathan and Sovereign.
//
// Capital hulls are built in layers so they read as big: a dark structural core,
// armour shells split into plates over it, machinery trenches in the gaps, stepped
// superstructure with lit window rows, barbettes under every hardpoint and a
// cowled engine block. The helpers below are that layer kit.

import * as THREE from 'three'
import { cyl, ico, mulberry32, octa, ring, tube, type ModelBuilder } from './models'
import { type Livery, type Vec3, type Section, loft, slab, block, WINDOW, RED, navLights, nacelle, mast, seam, canopy, vent, greeble, barrel, sectionAt, band, flankPlate, radiator, dish, shade } from './ship-kit'

type Shape = [number, number, number]

const OCT: Shape = [8, 0.5, Math.PI / 8]
const HAZARD = 0xe8b31e
const SOOT = 0x0b0d12
const COOL = 0x9fd8ff
const HEAT = 0xff7a2e

/** An armour shell riding on a core hull: the same plan, a slice of its height, pushed up or down. */
function shell(core: Section[], lift: number, height: number, grow = 0.2): Section[] {
    return core.map(s => ({ ...s, w: s.w + grow, h: s.h * height, y: (s.y ?? 0) + s.h * lift }))
}

/** Splits a stretch of hull into armour plates: alternating shades and heights with a dark gap between each. */
function plating(b: ModelBuilder, hull: Section[], z0: number, z1: number, count: number, colors: number[], shape: Shape = OCT, grow = 0.04, mirror = false) {
    const step = (z1 - z0) / count
    for (let i = 0; i < count; i++) {
        band(b, hull, z0 + i * step + 0.03, z0 + (i + 1) * step - 0.03, colors[i % colors.length]!, shape, grow + (i % 2) * 0.025, 0, mirror)
    }
}

type Face = 'side' | 'fore' | 'aft'

/**
 * Rows of lit viewports on a wall. `side` walls face +X with columns running aft
 * (mirror for the port wall); `fore` and `aft` walls run their columns along +X.
 * A seeded share of the panes stay dark so the wall reads as inhabited.
 */
function litRows(b: ModelBuilder, face: Face, from: Vec3, cols: number, rows: number, step: number, size: number, seed: number, mirror = false, lit = 0.74) {
    const rnd = mulberry32(seed)
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const roll = rnd()
            const tint = rnd()
            const power = 1.0 + rnd() * 0.8
            if (roll > lit) continue
            const g = new THREE.PlaneGeometry(size, size * 0.5)
            if (face === 'side') g.rotateY(Math.PI / 2)
            else if (face === 'fore') g.rotateY(Math.PI)
            const y = from[1] - r * size * 1.4
            const at: Vec3 = face === 'side' ? [from[0], y, from[2] + c * step] : [from[0] + c * step, y, from[2]]
            b.glow(g, tint < 0.85 ? WINDOW : COOL, power, at, [0, 0, 0], [1, 1, 1], mirror)
        }
    }
}

/** One storey of superstructure sitting on `base` (centre of its floor): a chamfered block, a cap course and windows all round. */
function tier(b: ModelBuilder, color: number, cap: number, base: Vec3, w: number, h: number, d: number, seed: number, rows = 1) {
    const [x, y, z] = base
    b.solid(block(w, h, d, 0.08), color, [x, y + h / 2, z])
    b.solid(block(w + 0.07, 0.1, d + 0.07, 0.025), cap, [x, y + h - 0.04, z])
    b.metal(block(w + 0.05, 0.06, d + 0.05, 0.02), SOOT, [x, y + 0.05, z])
    const size = Math.min(0.16, h * 0.16)
    const step = size * 2.1
    const wy = y + h * 0.62
    const nx = Math.max(1, Math.floor((w - 0.5) / step))
    const nz = Math.max(1, Math.floor((d - 0.5) / step))
    litRows(b, 'fore', [x - ((nx - 1) * step) / 2, wy, z - d / 2 - 0.005], nx, rows, step, size, seed)
    litRows(b, 'aft', [x - ((nx - 1) * step) / 2, wy, z + d / 2 + 0.005], nx, rows, step, size, seed + 1)
    if (x === 0) litRows(b, 'side', [w / 2 + 0.005, wy, z - ((nz - 1) * step) / 2], nz, rows, step, size, seed + 2, true)
    else {
        litRows(b, 'side', [x + w / 2 + 0.005, wy, z - ((nz - 1) * step) / 2], nz, rows, step, size, seed + 2)
    }
}

/** An armoured turret seat: stepped rings with marker lamps, and the hardpoint on top. */
function barbette(b: ModelBuilder, l: Livery, pos: Vec3, up = true, mirror = false, r = 0.3) {
    const s = up ? 1 : -1
    const [x, y, z] = pos
    const a = (top: number, bottom: number) => (up ? [top, bottom] : [bottom, top]) as [number, number]
    b.solid(cyl(...a(r * 1.75, r * 2.0), 0.16, 8), l.paint2, [x, y + s * 0.08, z], [0, Math.PI / 8, 0], [1, 1, 1], mirror)
    b.metal(cyl(...a(r * 1.35, r * 1.5), 0.12, 8), l.trim, [x, y + s * 0.22, z], [0, Math.PI / 8, 0], [1, 1, 1], mirror)
    b.metal(cyl(...a(r, r * 1.15), 0.08, 12), l.metal, [x, y + s * 0.32, z], [0, 0, 0], [1, 1, 1], mirror)
    for (let i = 0; i < 4; i++) {
        const t = (i / 4) * Math.PI * 2 + Math.PI / 4
        b.glow(new THREE.BoxGeometry(r * 0.22, 0.04, r * 0.22), i % 2 ? l.glow : WINDOW, 2, [x + Math.cos(t) * r * 1.62, y + s * 0.17, z + Math.sin(t) * r * 1.62], [0, 0, 0], [1, 1, 1], mirror)
    }
    b.hardpoint([x, y + s * 0.37, z], [0, s, 0], mirror)
}

/** A drive nozzle in its housing: shroud, lip ring and cooling fins around the bell. */
function drive(b: ModelBuilder, l: Livery, pos: Vec3, r: number, mirror = false, fins = 8, color = l.paint2) {
    const [x, y, z] = pos
    b.solid(tube(r * 1.42, r * 1.55, r * 1.9, 12), color, [x, y, z - r * 0.85], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(ring(r * 1.5, r * 0.09, 4, 12), l.metal, [x, y, z + r * 0.08], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(ring(r * 1.46, r * 0.06, 4, 12), l.trim, [x, y, z - r * 1.1], [0, 0, 0], [1, 1, 1], mirror)
    for (let i = 0; i < fins; i++) {
        const t = (i / fins) * Math.PI * 2 + Math.PI / fins
        b.metal(new THREE.BoxGeometry(r * 0.1, r * 0.42, r * 1.5), l.trim, [x + Math.cos(t) * r * 1.62, y + Math.sin(t) * r * 1.62, z - r * 0.8], [0, 0, t - Math.PI / 2], [1, 1, 1], mirror)
    }
    b.engine(pos, r, mirror, l.glow)
}

/** A machinery trench on a deck: two coamings over a dark floor full of pipes, junction boxes and work lights. */
function trench(b: ModelBuilder, l: Livery, pos: Vec3, w: number, len: number, seed: number, mirror = false) {
    const rnd = mulberry32(seed)
    const [x, y, z] = pos
    b.metal(new THREE.BoxGeometry(w, 0.05, len), SOOT, [x, y + 0.025, z], [0, 0, 0], [1, 1, 1], mirror)
    for (const side of [-1, 1]) {
        b.solid(block(0.12, 0.2, len + 0.1, 0.03), l.paint2, [x + side * (w / 2 + 0.05), y + 0.1, z], [0, 0, 0], [1, 1, 1], mirror)
        b.glow(new THREE.BoxGeometry(0.02, 0.02, len * 0.94), l.glow, 1.5, [x + side * (w / 2 - 0.03), y + 0.06, z], [0, 0, 0], [1, 1, 1], mirror)
    }
    b.metal(tube(0.045, 0.045, len * 0.96, 6), l.metal, [x - w * 0.2, y + 0.09, z], [0, 0, 0], [1, 1, 1], mirror)
    b.metal(tube(0.03, 0.03, len * 0.9, 5), l.trim, [x + w * 0.12, y + 0.07, z], [0, 0, 0], [1, 1, 1], mirror)
    const n = Math.max(2, Math.round(len / 0.55))
    for (let i = 0; i < n; i++) {
        const at = z - len / 2 + ((i + 0.5) * len) / n
        const kind = rnd()
        if (kind < 0.55) b.metal(block(w * (0.35 + rnd() * 0.5), 0.1 + rnd() * 0.1, 0.16 + rnd() * 0.2, 0.015), rnd() < 0.5 ? l.metal : l.trim, [x + (rnd() - 0.5) * w * 0.3, y + 0.1, at], [0, 0, 0], [1, 1, 1], mirror)
        else if (kind < 0.8) b.metal(new THREE.BoxGeometry(w, 0.05, 0.05), l.metal, [x, y + 0.15, at], [0, 0, 0], [1, 1, 1], mirror)
        else b.glow(new THREE.BoxGeometry(0.07, 0.03, 0.07), rnd() < 0.5 ? WINDOW : HEAT, 2.2, [x + (rnd() - 0.5) * w * 0.5, y + 0.07, at], [0, 0, 0], [1, 1, 1], mirror)
    }
}

/**
 * The waist trench between two armour shells: pipes, tanks, junction boxes and
 * viewports bolted to the exposed core, following the hull's taper. Both flanks.
 */
function waist(b: ModelBuilder, l: Livery, core: Section[], z0: number, z1: number, seed: number, reach = 0.96, mirror = true, step = 0.42) {
    const rnd = mulberry32(seed)
    for (let z = z0; z < z1; z += step) {
        const s = sectionAt(core, z)
        const x = (s.x ?? 0) + s.w * reach
        const y = s.y ?? 0
        const gap = s.h * 0.16
        const kind = rnd()
        if (kind < 0.4) {
            const h = gap * (0.6 + rnd() * 0.9)
            b.metal(block(0.1 + rnd() * 0.14, h, step * (0.5 + rnd() * 0.4), 0.015), rnd() < 0.5 ? l.metal : l.trim, [x + 0.04, y + (rnd() - 0.5) * gap, z], [0, 0, 0], [1, 1, 1], mirror)
        } else if (kind < 0.62) {
            litRows(b, 'side', [x + 0.012, y + gap * 0.3, z - step * 0.3], 3, 2, step * 0.3, Math.min(0.12, gap * 0.5), seed + Math.round(z * 10), mirror, 0.8)
        } else if (kind < 0.8) {
            b.metal(tube(gap * 0.42, gap * 0.42, step * 0.85, 8), l.metal, [x + gap * 0.3, y - gap * 0.2, z], [0, 0, 0], [1, 1, 1], mirror)
        } else if (kind < 0.9) {
            b.glow(new THREE.BoxGeometry(0.03, gap * 1.2, 0.05), rnd() < 0.6 ? l.glow : HEAT, 1.8, [x + 0.02, y, z], [0, 0, 0], [1, 1, 1], mirror)
        }
    }
    const mid = sectionAt(core, (z0 + z1) / 2)
    for (const dy of [-0.7, 0.75]) {
        const a = sectionAt(core, z0)
        const c = sectionAt(core, z1)
        const len = Math.hypot(z1 - z0, c.w - a.w)
        b.metal(tube(0.035, 0.035, len, 5), l.metal, [(mid.x ?? 0) + ((a.w + c.w) / 2) * reach + 0.05, (mid.y ?? 0) + mid.h * 0.16 * dy, (z0 + z1) / 2], [0, -Math.atan2(c.w - a.w, z1 - z0) * reach, 0], [1, 1, 1], mirror)
    }
}

/**
 * A hangar sponson opening to starboard (mirror for port): a hollow box with a lit
 * back wall, ceiling lamps, deck guide lights, parked craft and a hazard sill.
 * `pos` is the centre of the mouth.
 */
function sideBay(b: ModelBuilder, l: Livery, pos: Vec3, h: number, len: number, depth: number, seed: number, mirror = true) {
    const [x, y, z] = pos
    const cx = x - depth / 2
    const rnd = mulberry32(seed)
    const m: [Vec3, Vec3, boolean] = [[0, 0, 0], [1, 1, 1], mirror]
    b.solid(block(depth + 0.1, 0.14, len + 0.3, 0.03), l.paint, [cx, y + h / 2 + 0.07, z], ...m)
    b.solid(block(depth + 0.16, 0.16, len + 0.34, 0.03), l.paint2, [cx, y - h / 2 - 0.08, z], ...m)
    for (const end of [-1, 1]) b.solid(block(depth + 0.1, h + 0.1, 0.16, 0.03), l.paint2, [cx, y, z + end * (len / 2 + 0.07)], ...m)
    b.metal(new THREE.BoxGeometry(0.05, h, len), SOOT, [x - depth, y, z], ...m)
    b.metal(new THREE.BoxGeometry(depth, 0.03, len), 0x1a1e26, [cx, y - h / 2 + 0.015, z], ...m)
    b.glow(new THREE.PlaneGeometry(len * 0.92, h * 0.16).rotateY(Math.PI / 2), WINDOW, 1.0, [x - depth + 0.03, y + h * 0.3, z], ...m)
    b.glow(new THREE.PlaneGeometry(len * 0.92, h * 0.05).rotateY(Math.PI / 2), l.glow, 1.8, [x - depth + 0.03, y - h * 0.3, z], ...m)
    const bays = Math.max(2, Math.round(len / 0.7))
    for (let i = 0; i < bays; i++) {
        const at = z - len / 2 + ((i + 0.5) * len) / bays
        b.glow(new THREE.BoxGeometry(depth * 0.7, 0.025, 0.06), COOL, 1.8, [cx, y + h / 2 - 0.015, at], ...m)
        b.glow(new THREE.BoxGeometry(depth * 0.8, 0.02, 0.03), l.glow, 1.6, [cx, y - h / 2 + 0.04, at + len / bays / 2 - 0.02], ...m)
        b.metal(new THREE.BoxGeometry(0.06, h, 0.06), l.trim, [x - 0.04, y, at + len / bays / 2], ...m)
        if (rnd() < 0.65) {
            b.solid(octa(h * 0.3), rnd() < 0.5 ? l.paint2 : l.accent, [cx - depth * 0.1, y - h / 2 + h * 0.13, at], [0, rnd() * 0.5, 0], [1.1, 0.32, 0.8], mirror)
            b.glow(new THREE.BoxGeometry(0.03, 0.03, 0.03), RED, 2.5, [cx - depth * 0.1, y - h / 2 + h * 0.25, at], ...m)
        }
    }
    const teeth = Math.round(len / 0.18)
    for (let i = 0; i < teeth; i++) b.solid(new THREE.BoxGeometry(0.04, 0.1, len / teeth), i % 2 ? HAZARD : SOOT, [x + 0.07, y - h / 2 - 0.08, z - len / 2 + ((i + 0.5) * len) / teeth], ...m)
    b.glow(new THREE.BoxGeometry(0.03, 0.03, len), l.glow, 2, [x + 0.06, y + h / 2 + 0.07, z], ...m)
}

/** A cluster of whip aerials, yagi bars and a dish: the comms farm on top of a tower. */
function antennaFarm(b: ModelBuilder, l: Livery, pos: Vec3, spread: number, count: number, height: number, seed: number) {
    const rnd = mulberry32(seed)
    for (let i = 0; i < count; i++) {
        const x = pos[0] + (rnd() - 0.5) * spread
        const z = pos[2] + (rnd() - 0.5) * spread
        const h = height * (0.35 + rnd() * 0.65)
        b.metal(cyl(0.015, 0.035, h, 4), 0x3a414c, [x, pos[1] + h / 2, z])
        if (rnd() < 0.5) for (let k = 1; k <= 3; k++) b.metal(new THREE.BoxGeometry(0.28 - k * 0.05, 0.015, 0.015), 0x59616d, [x, pos[1] + h * (0.5 + k * 0.13), z])
        b.glow(octa(0.045), rnd() < 0.6 ? RED : WINDOW, 3.2, [x, pos[1] + h, z])
    }
}

/** A row of small marker lamps following a hull's edge on both flanks. */
function hullLights(b: ModelBuilder, hull: Section[], z0: number, z1: number, step: number, color: number, fx: number, fy: number, size = 0.06, mirror = true) {
    for (let z = z0; z <= z1; z += step) {
        const s = sectionAt(hull, z)
        b.glow(new THREE.BoxGeometry(size, size * 0.6, size), color, 2.4, [(s.x ?? 0) + s.w * fx, (s.y ?? 0) + s.h * fy, z], [0, 0, 0], [1, 1, 1], mirror)
    }
}

/** Yellow and black hazard blocks in a line. */
function hazard(b: ModelBuilder, from: Vec3, count: number, size: number, axis: 'x' | 'z', mirror = false) {
    for (let i = 0; i < count; i++) {
        const at: Vec3 = axis === 'x' ? [from[0] + i * size, from[1], from[2]] : [from[0], from[1], from[2] + i * size]
        b.solid(new THREE.BoxGeometry(axis === 'x' ? size : size * 0.9, 0.03, axis === 'x' ? size * 0.9 : size), i % 2 ? SOOT : HAZARD, at, [0, 0, 0], [1, 1, 1], mirror)
    }
}

/** Heat exchanger grilles on a deck: a dark well with glowing slats. */
function heatGrille(b: ModelBuilder, l: Livery, pos: Vec3, w: number, d: number, slats: number, mirror = false, color = HEAT) {
    b.metal(block(w + 0.12, 0.08, d + 0.12, 0.02), l.trim, pos, [0, 0, 0], [1, 1, 1], mirror)
    b.metal(new THREE.BoxGeometry(w, 0.02, d), SOOT, [pos[0], pos[1] + 0.04, pos[2]], [0, 0, 0], [1, 1, 1], mirror)
    for (let i = 0; i < slats; i++) {
        const z = pos[2] - d / 2 + ((i + 0.5) * d) / slats
        b.glow(new THREE.BoxGeometry(w * 0.9, 0.015, (d / slats) * 0.35), color, 1.5, [pos[0], pos[1] + 0.055, z], [0, 0, 0], [1, 1, 1], mirror)
        b.metal(new THREE.BoxGeometry(w * 0.96, 0.03, (d / slats) * 0.3), l.metal, [pos[0], pos[1] + 0.07, z + (d / slats) * 0.4], [0, 0, 0], [1, 1, 1], mirror)
    }
}

/** A docking collar on the starboard flank (mirror for port): a short trunk, a lit ring and guide lamps. */
function dockingCollar(b: ModelBuilder, l: Livery, pos: Vec3, r: number, mirror = true) {
    const [x, y, z] = pos
    b.metal(tube(r, r * 1.15, r * 1.2, 10), l.trim, [x, y, z], [0, -Math.PI / 2, 0], [1, 1, 1], mirror)
    b.metal(ring(r * 1.05, r * 0.14, 4, 10), l.metal, [x + r * 0.6, y, z], [0, Math.PI / 2, 0], [1, 1, 1], mirror)
    b.glow(ring(r * 0.78, r * 0.06, 3, 10), l.glow, 2.2, [x + r * 0.62, y, z], [0, Math.PI / 2, 0], [1, 1, 1], mirror)
    b.metal(cyl(r * 0.7, r * 0.7, 0.03, 10), SOOT, [x + r * 0.58, y, z], [0, 0, Math.PI / 2], [1, 1, 1], mirror)
    for (const dz of [-1.5, 1.5]) b.glow(new THREE.BoxGeometry(0.04, 0.05, 0.05), dz < 0 ? RED : WINDOW, 2.6, [x + 0.05, y + r * 1.3, z + dz * r], [0, 0, 0], [1, 1, 1], mirror)
}

export const CAPITAL_DESIGNS: Record<string, (b: ModelBuilder, l: Livery) => void> = {
    aegis(b, l) {
        const GOLD = 0xd9a441
        const hull: Section[] = [
            { z: -3.1, w: 0.55, h: 0.42, y: -0.05 },
            { z: -2.3, w: 1.15, h: 0.82 },
            { z: 0, w: 1.45, h: 1.05 },
            { z: 2.4, w: 1.35, h: 0.95 },
            { z: 3.0, w: 1.05, h: 0.72 }
        ]
        // A dark core carries two armour shells; the waist between them is open machinery.
        const upper = shell(hull, 0.6, 0.42, 0.12)
        const lower = shell(hull, -0.6, 0.42, 0.12)
        const blues = [l.paint, shade(l.paint, 0.8), shade(l.paint, 1.15), l.paint]
        b.metal(loft(hull, ...OCT), 0x151922)
        b.solid(loft(upper, ...OCT), shade(l.paint, 0.45))
        b.solid(loft(lower, ...OCT), shade(l.paint, 0.4))
        plating(b, upper, -3.05, 2.95, 11, blues, OCT, 0.03)
        plating(b, lower, -3.05, 2.95, 8, [shade(l.paint, 0.75), shade(l.paint2, 0.7)], OCT, 0.03)
        for (const part of [upper, lower]) {
            band(b, part, -2.2, -1.9, l.accent, OCT, 0.065)
            band(b, part, -1.86, -1.78, GOLD, OCT, 0.075)
            band(b, part, 1.5, 2.3, l.paint2, OCT, 0.065)
            band(b, part, 2.34, 2.42, GOLD, OCT, 0.075)
        }
        band(b, hull, -0.04, 0.04, l.glow, OCT, 0.015, 1.4)
        for (const z of [-1.3, 0.9]) band(b, hull, z, z + 0.14, l.trim, OCT, 0.16)
        waist(b, l, hull, -2.4, -1.0, 11, 0.96, true, 0.3)
        waist(b, l, hull, 1.0, 2.8, 12, 0.96, true, 0.3)
        hullLights(b, upper, -2.6, 2.8, 0.6, WINDOW, 0.64, 0.98, 0.05)
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
        drive(b, l, [1.95, 0, 0.9], 0.3, true, 6)
        litRows(b, 'side', [2.39, 0.3, -1.3], 8, 1, 0.24, 0.09, 13, true)
        // Stepped bridge tower, then the shield generator dome behind it.
        tier(b, l.paint, GOLD, [0, 1.0, -0.25], 1.7, 0.22, 2.0, 14)
        b.solid(loft([
            { z: -1.1, w: 0.45, h: 0.18, y: 1.18 },
            { z: -0.7, w: 0.7, h: 0.34, y: 1.3 },
            { z: 0.35, w: 0.7, h: 0.34, y: 1.3 },
            { z: 0.6, w: 0.55, h: 0.25, y: 1.25 }
        ], ...OCT), l.paint2)
        b.glass(new THREE.BoxGeometry(1.1, 0.14, 0.04), l.glass, [0, 1.42, -0.9], [-0.5, 0, 0])
        litRows(b, 'fore', [-0.45, 1.36, -0.945], 7, 1, 0.15, 0.09, 15, false, 1)
        litRows(b, 'side', [0.68, 1.34, -0.55], 6, 1, 0.16, 0.08, 16, true, 0.85)
        b.solid(new THREE.BoxGeometry(1.42, 0.05, 0.12), GOLD, [0, 1.64, -0.15])
        b.solid(block(0.9, 0.16, 0.6, 0.03), l.paint, [0, 1.7, 0.0])
        antennaFarm(b, l, [0, 1.76, 0.1], 0.7, 5, 1.0, 17)
        dish(b, l, [-0.45, 1.24, 0.45], 0.2)
        b.metal(cyl(0.62, 0.7, 0.16, 12), l.trim, [0, 1.05, 1.25])
        b.glow(ico(0.46, 1), l.glow, 1.5, [0, 1.12, 1.25], [0, 0, 0], [1, 0.7, 1])
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            b.metal(block(0.1, 0.4, 0.1, 0.02), l.metal, [Math.cos(a) * 0.52, 1.25, 1.25 + Math.sin(a) * 0.52], [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35])
        }
        b.metal(ring(0.5, 0.04, 4, 12), GOLD, [0, 1.42, 1.25], [Math.PI / 2, 0, 0])
        // Belly keel with a lit trench.
        b.solid(block(1.5, 0.3, 3.6, 0.08), l.paint2, [0, -1.08, 0.5])
        b.solid(block(1.1, 0.1, 3.0, 0.03), shade(l.paint, 0.7), [0, -1.24, 0.5])
        seam(b, l.glow, [0.62, -1.24, 0.5], 3.0, true, 'z', 1.4)
        // Deck trenches either side of the tower, and a quarterdeck of heat grilles over the drives.
        trench(b, l, [0.62, 0.98, -1.75], 0.3, 1.1, 18, true)
        heatGrille(b, l, [0.62, 0.99, 2.3], 0.4, 0.8, 5, true)
        hazard(b, [-0.75, 0.97, 2.85], 11, 0.15, 'x')
        navLights(b, 3.2, 0.95, 2.4)
        b.metal(block(2.3, 1.7, 0.4, 0.06), 0x14171d, [0, -0.02, 2.95])
        b.solid(block(2.3, 0.18, 0.9, 0.04), l.paint, [0, 0.86, 3.15])
        b.solid(block(2.1, 0.18, 0.9, 0.04), l.paint2, [0, -0.88, 3.15])
        b.solid(block(0.18, 1.5, 0.9, 0.04), GOLD, [1.12, -0.02, 3.15], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.04, 1.3, 0.04), HEAT, 1.5, [0, -0.02, 3.17])
        drive(b, l, [0.55, 0.36, 3.1], 0.42, true, 0, l.trim)
        drive(b, l, [0.55, -0.4, 3.1], 0.38, true, 0, l.trim)
        barbette(b, l, [0, 0.92, 2.25], true, false, 0.3)
        barbette(b, l, [0, 0.86, -1.75], true, false, 0.3)
        barbette(b, l, [0, -1.23, 0.6], false, false, 0.3)
    },

    // A catamaran carrier: drones fly out through a lit tunnel between the twin
    // hulls, and each flank is a honeycomb of launch cells.
    hive(b, l) {
        const CREAM = 0xe9e2cf
        const hull: Section[] = [
            { z: -3.8, w: 0.18, h: 0.2, x: 1.55, y: -0.1 },
            { z: -2.7, w: 0.68, h: 0.62, x: 1.55 },
            { z: 2.4, w: 0.76, h: 0.66, x: 1.55 },
            { z: 3.2, w: 0.56, h: 0.48, x: 1.55 }
        ]
        b.solid(loft(hull, ...OCT), shade(l.paint, 0.5), [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        plating(b, hull, -3.7, 3.15, 14, [l.paint, shade(l.paint, 1.35), shade(l.paint, 0.8), l.paint], OCT, 0.025, true)
        hullLights(b, hull, -2.6, 2.8, 0.6, l.glow, 1.0, -0.62, 0.05)
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
        // Inside the tunnel: ceiling lamps, racked drones on both walls and a hazard sill at the mouth.
        for (let i = 0; i < 7; i++) b.glow(new THREE.BoxGeometry(0.7, 0.02, 0.07), COOL, 1.8, [0, 0.53, -2.5 + i * 0.58])
        for (let i = 0; i < 5; i++) {
            b.solid(octa(0.2), i % 2 ? l.paint2 : CREAM, [0.55, -0.42, -2.1 + i * 0.75], [0, 0.4, 0], [1, 0.35, 1.2], true)
            b.glow(new THREE.BoxGeometry(0.03, 0.03, 0.03), RED, 2.6, [0.55, -0.33, -2.1 + i * 0.75], [0, 0, 0], [1, 1, 1], true)
            b.metal(new THREE.BoxGeometry(0.3, 0.04, 0.3), l.trim, [0.6, -0.5, -2.1 + i * 0.75], [0, 0, 0], [1, 1, 1], true)
        }
        hazard(b, [-0.9, -0.52, -2.65], 13, 0.15, 'x')
        litRows(b, 'side', [-0.8, 0.12, -2.0], 10, 2, 0.34, 0.1, 21, true)
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
        tier(b, l.paint2, l.trim, [1.55, 0.66, 0.7], 0.9, 0.5, 2.2, 22)
        tier(b, shade(l.paint, 1.4), l.paint2, [1.55, 1.14, 0.55], 0.74, 0.46, 1.4, 23)
        litRows(b, 'side', [1.17, 1.43, 0.0], 6, 1, 0.2, 0.08, 24, false, 0.85)
        b.solid(block(0.6, 0.26, 0.6, 0.04), l.paint2, [1.55, 1.72, 0.2])
        b.glass(new THREE.BoxGeometry(0.5, 0.12, 0.04), l.glass, [1.55, 1.76, -0.11], [-0.35, 0, 0])
        litRows(b, 'fore', [1.37, 1.74, -0.12], 4, 1, 0.12, 0.07, 25, false, 1)
        b.solid(block(1.1, 0.05, 0.3, 0.015), l.paint2, [1.55, 1.62, 0.2])
        antennaFarm(b, l, [1.55, 1.6, 0.9], 0.5, 5, 1.1, 26)
        dish(b, l, [1.35, 1.6, 1.0], 0.26)
        // Deck furniture: a machinery trench down the port edge, lift pads and a parked drone wing.
        trench(b, l, [-0.75, 0.69, -0.4], 0.3, 3.4, 27)
        for (const z of [-1.9, -0.6, 0.7]) {
            b.metal(block(0.7, 0.03, 0.7, 0.01), 0x22262e, [0.35, 0.7, z])
            b.glow(ring(0.25, 0.015, 3, 8), l.glow, 1.6, [0.35, 0.72, z], [Math.PI / 2, 0, 0])
        }
        for (let i = 0; i < 3; i++) b.solid(octa(0.17), CREAM, [0.35, 0.78, -1.9 + i * 1.3], [0, 0.6, 0], [1, 0.35, 1.2])
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
        const house: Section[] = [{ z: 1.35, w: 0.95, h: 0.62 }, { z: 2.7, w: 0.95, h: 0.6 }, { z: 3.0, w: 0.8, h: 0.48 }]
        b.solid(loft(house, ...OCT), shade(l.paint, 0.5))
        plating(b, house, 1.4, 2.95, 4, [l.paint, l.paint2, shade(l.paint, 1.35)], OCT, 0.03)
        heatGrille(b, l, [0, 0.72, 2.45], 1.2, 0.9, 5)
        hazard(b, [-1.0, 0.7, 3.0], 14, 0.15, 'x')
        drive(b, l, [0.42, 0, 3.05], 0.3, true, 0, l.trim)
        drive(b, l, [1.55, 0, 3.3], 0.45, true, 8)
        navLights(b, 2.35, 0.4, 2.6)
        greeble(b, l, [-0.7, 0.69, 2.3], 0.5, 0.6, 5, 21)
        barbette(b, l, [1.55, 1.6, 0.85], true, false, 0.22)
        barbette(b, l, [-1.55, 0.64, 1.9], true, false, 0.28)
    },

    // A strike wedge: a flat angular lifting body behind a forked prow, an
    // armoured canopy, two big engines carried on top and swept wings that end
    // in striped end plates.
    tempest(b, l) {
        const FLAT: Shape = [8, 0.35, Math.PI / 8]
        const body: Section[] = [
            { z: -3.3, w: 0.5, h: 0.14, y: -0.06 },
            { z: -2.0, w: 1.0, h: 0.32 },
            { z: -0.2, w: 1.45, h: 0.48, y: 0.02 },
            { z: 1.8, w: 1.6, h: 0.52, y: 0.04 },
            { z: 3.2, w: 1.35, h: 0.42 },
            { z: 3.8, w: 1.0, h: 0.3 }
        ]
        const blues = [l.paint, shade(l.paint, 0.82), l.paint, shade(l.paint, 1.25), l.paint2]
        b.solid(loft(body, ...FLAT), shade(l.paint, 0.45))
        plating(b, body, -3.25, 3.75, 15, blues, FLAT, 0.025)
        band(b, body, -2.1, -1.95, l.accent, FLAT, 0.035)
        band(b, body, -1.9, -1.84, l.glow, FLAT, 0.036, 1.8)
        band(b, body, 2.95, 3.75, SOOT, FLAT, 0.035)
        hullLights(b, body, -1.6, 2.8, 0.55, l.glow, 1.0, 0, 0.05)
        // Forked prow: two prongs reach past a recessed sensor bay.
        const prong: Section[] = [
            { z: -5.2, w: 0.03, h: 0.03, x: 0.72, y: -0.14 },
            { z: -4.2, w: 0.2, h: 0.13, x: 0.78, y: -0.1 },
            { z: -2.8, w: 0.36, h: 0.2, x: 0.86, y: -0.05 },
            { z: -1.2, w: 0.34, h: 0.22, x: 0.95 }
        ]
        b.solid(loft(prong, ...FLAT), l.paint2, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.62, -4.3], [0.95, -4.3], [1.22, -2.9], [0.5, -2.9]], 0.06, 0.015), l.accent, [0, 0.08, 0], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.03, 0.03, 2.2), l.glow, 2.4, [0.5, -0.08, -3.6], [0, 0.04, 0], [1, 1, 1], true)
        b.metal(block(1.0, 0.2, 0.5, 0.03), l.trim, [0, -0.1, -3.2])
        b.glow(new THREE.BoxGeometry(0.7, 0.07, 0.04), l.glow, 2.6, [0, -0.1, -3.47])
        barrel(b, l, [0.3, -0.12, -3.5], 1.1, 0.045, true)
        // Armoured canopy and the spine hump behind it.
        canopy(b, l, -2.4, -0.4, 0.3, 0.44, 0.28)
        b.solid(slab([[0.3, -2.0], [0.62, -1.5], [0.62, -0.3], [0.42, -0.3]], 0.22, 0.03), l.paint2, [0, 0.3, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(loft([
            { z: -0.5, w: 0.5, h: 0.2, y: 0.5 },
            { z: 0.8, w: 0.62, h: 0.3, y: 0.58 },
            { z: 3.0, w: 0.4, h: 0.16, y: 0.44 }
        ], ...FLAT), l.paint)
        seam(b, l.glow, [0, 0.9, 0.9], 2.4, false, 'z', 1.8)
        antennaFarm(b, l, [0, 0.86, 2.2], 0.15, 3, 0.45, 51)
        // Swept wings with a lit leading edge, inlaid panels and under-wing guns.
        const wing: [number, number][] = [[1.3, -0.7], [4.0, 1.9], [4.0, 3.1], [1.4, 3.3]]
        b.solid(slab(wing, 0.17, 0.05), l.paint, [0, -0.06, 0], [0, 0, -0.06], [1, 1, 1], true)
        b.solid(slab([[1.7, 0.2], [3.3, 1.75], [3.3, 2.8], [1.7, 2.9]], 0.2, 0.02), l.paint2, [0, -0.075, 0], [0, 0, -0.06], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.035, 0.035, 3.7), l.glow, 2.6, [2.66, -0.12, 0.6], [0, 0.804, -0.06], [1, 1, 1], true)
        for (let i = 0; i < 3; i++) b.glow(new THREE.BoxGeometry(0.03, 0.03, 1.0), l.glow, 2.2, [2.0 + i * 0.55, -0.05 - i * 0.033, 2.3], [0, 0, 0], [1, 1, 1], true)
        barrel(b, l, [2.5, -0.42, 0.4], 1.5, 0.05, true)
        b.metal(block(0.22, 0.2, 1.1, 0.03), l.trim, [2.5, -0.36, 1.2], [0, 0, 0], [1, 1, 1], true)
        // End plates: the wing tips turn up and down into striped fins with a tip cannon.
        const plate: [number, number][] = [[-0.75, 1.5], [0.85, 2.3], [0.85, 3.5], [-0.75, 3.2]]
        b.solid(slab(plate, 0.1, 0.03), l.paint2, [4.05, -0.3, 0], [0, 0, Math.PI / 2], [1, 1, 1], true)
        for (const [x0, x1] of [[-0.45, -0.25], [0.2, 0.4]] as const) {
            b.solid(slab([[x0, 1.8], [x1, 1.9], [x1, 3.35], [x0, 3.3]], 0.12, 0.01), l.accent, [4.06, -0.3, 0], [0, 0, Math.PI / 2], [1, 1, 1], true)
        }
        barrel(b, l, [4.0, -1.0, 1.7], 1.7, 0.055, true)
        navLights(b, 4.08, 0.6, 2.4)
        // Two big engines carried on top of the stern, and a core drive between them.
        for (const z of [1.7, 3.1]) b.metal(block(0.5, 0.3, 0.7, 0.04), l.trim, [0.98, 0.52, z], [0, 0, 0], [1, 1, 1], true)
        nacelle(b, l, [0.98, 0.95, 2.5], 0.5, 3.0, true)
        for (const z of [1.5, 2.6, 3.6]) b.metal(ring(0.52, 0.04, 4, 12), l.trim, [0.98, 0.95, z], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.02, 0.05, 1.9), l.glow, 2.2, [1.49, 0.95, 2.4], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0, 2.2], [0.75, 3.3], [0.75, 3.95], [0, 3.85]], 0.07, 0.02), l.paint, [1.3, 1.35, 0], [0, 0, Math.PI / 2 - 0.5], [1, 1, 1], true)
        b.solid(slab([[0.5, 2.95], [0.75, 3.3], [0.75, 3.95], [0.5, 3.92]], 0.09, 0.02), l.accent, [1.31, 1.35, 0], [0, 0, Math.PI / 2 - 0.5], [1, 1, 1], true)
        heatGrille(b, l, [0, 0.62, 3.3], 0.5, 0.6, 4, false, l.glow)
        drive(b, l, [0, 0, 3.95], 0.36, false, 10)
        // Belly skid plate and the three mounts.
        b.solid(loft([
            { z: -2.6, w: 0.5, h: 0.08, y: -0.36 },
            { z: 0.5, w: 1.0, h: 0.12, y: -0.58 },
            { z: 3.2, w: 0.8, h: 0.1, y: -0.5 }
        ], ...FLAT), l.paint2)
        barbette(b, l, [0, 0.88, 0.6], true, false, 0.17)
        barbette(b, l, [1.9, -0.3, 1.9], false, true, 0.16)
    },

    // The capstone: a long smooth arrowhead in obsidian. Gold sweeps flow from the
    // prow into faired engine pods, a dark canopy sits amidships, thin blade wings
    // trail low at the stern and sapphires stud every gold line.
    sovereign(b, l) {
        const SAPPHIRE = 0x3d8bff
        const AZURE = 0x7fd0ff
        const COBALT = 0x2f5bff
        const ICE = 0x9fe8ff
        const GEMS = [SAPPHIRE, AZURE, COBALT, ICE]
        const SMOOTH: Shape = [18, 0.92, 0]
        const hull: Section[] = [
            { z: -6.8, w: 0.03, h: 0.03, y: -0.1 },
            { z: -5.6, w: 0.42, h: 0.2, y: -0.07 },
            { z: -3.2, w: 1.2, h: 0.52, y: -0.02 },
            { z: 0, w: 2.05, h: 0.84, y: 0.04 },
            { z: 3.0, w: 2.55, h: 1.0, y: 0.06 },
            { z: 5.0, w: 2.35, h: 0.9, y: 0.04 },
            { z: 6.0, w: 1.65, h: 0.6 }
        ]
        const top = (z: number) => {
            const s = sectionAt(hull, z)
            return (s.y ?? 0) + s.h
        }
        b.solid(loft(hull, ...SMOOTH), shade(l.paint, 0.7))
        plating(b, hull, -6.6, 5.95, 13, [l.paint, shade(l.paint, 1.25), l.paint, shade(l.paint, 0.8)], SMOOTH, 0.012)
        // A gold belt runs the whole waterline, with a sapphire line above it and gem studs along it.
        b.metal(loft(hull.map(s => ({ ...s, w: s.w + 0.035, h: s.h * 0.13 })), ...SMOOTH), l.paint2)
        b.glow(loft(hull.slice(1).map(s => ({ ...s, w: s.w * 0.985 + 0.02, h: 0.018, y: (s.y ?? 0) + s.h * 0.2 })), ...SMOOTH), l.glow, 1.6)
        GEMS.forEach((gem, i) => hullLights(b, hull, -5.2 + i * 0.35, 5.6, 1.4, gem, 1.03, 0, 0.1))
        band(b, hull, 5.3, 5.95, SOOT, SMOOTH, 0.02)
        // The dorsal spear: a gold blade from the prow to the stern with an obsidian blade laid over it.
        const spear = (grow: number, lift: number): Section[] => [
            { z: -6.3 + (1 - grow) * 2, w: 0.04, h: 0.03, y: top(-6.3 + (1 - grow) * 2) + lift - 0.04 },
            { z: -3.4, w: 0.34 * grow + 0.08, h: 0.06, y: top(-3.4) + lift },
            { z: -0.2, w: 0.72 * grow + 0.12, h: 0.08, y: top(-0.2) + lift },
            { z: 3.2, w: 0.95 * grow + 0.14, h: 0.09, y: top(3.2) + lift },
            { z: 5.6, w: 0.6 * grow + 0.1, h: 0.07, y: top(5.6) + lift }
        ]
        b.metal(loft(spear(1, 0), ...SMOOTH), l.paint2)
        b.solid(loft(spear(0.72, 0.05), ...SMOOTH), l.paint)
        for (const x of [0.2, 0.42]) b.glow(new THREE.BoxGeometry(0.03, 0.03, 2.2), l.glow, 2, [x, top(3.8) + 0.16, 3.9], [0, 0, 0], [1, 1, 1], true)
        // Prow: a cut sapphire in a gold collar.
        b.glow(octa(0.36), SAPPHIRE, 1.3, [0, -0.1, -7.0], [0, 0, 0], [0.6, 0.6, 2.2])
        b.glow(octa(0.17), 0xd4ecff, 1.8, [0, -0.1, -7.0], [0, 0, 0], [0.6, 0.6, 2.2])
        b.metal(ring(0.26, 0.05, 4, 10), l.metal, [0, -0.1, -6.6])
        // The bridge: a low, dark canopy let into the spear.
        const zc = -1.3
        const deck = top(zc) + 0.1
        b.glass(loft([
            { z: zc - 1.7, w: 0.1, h: 0.03, y: deck - 0.02 },
            { z: zc - 0.9, w: 0.5, h: 0.2, y: deck + 0.06 },
            { z: zc, w: 0.66, h: 0.3, y: deck + 0.12 },
            { z: zc + 1.1, w: 0.5, h: 0.22, y: deck + 0.1 },
            { z: zc + 1.6, w: 0.16, h: 0.06, y: deck + 0.04 }
        ], 12, 0.92), 0x04070d)
        for (const [dz, w, h, dy] of [[-0.9, 0.5, 0.2, 0.06], [0, 0.66, 0.3, 0.12], [1.1, 0.5, 0.22, 0.1]] as const) {
            b.metal(loft([{ z: zc + dz - 0.02, w: w + 0.012, h: h + 0.012, y: deck + dy }, { z: zc + dz + 0.02, w: w + 0.012, h: h + 0.012, y: deck + dy }], 12, 0.92), l.metal)
        }
        b.metal(new THREE.BoxGeometry(0.04, 0.035, 2.3), l.metal, [0, deck + 0.425, zc])
        b.glow(new THREE.BoxGeometry(0.025, 0.025, 2.4), l.glow, 2.2, [0.7, deck - 0.02, zc], [0, 0, 0], [1, 1, 1], true)
        // Flank fairings sweep back from the shoulders into the engine pods.
        const pod: Section[] = [
            { z: -1.8, w: 0.06, h: 0.05, x: 1.35, y: 0.32 },
            { z: 0.4, w: 0.34, h: 0.26, x: 2.0, y: 0.34 },
            { z: 2.6, w: 0.6, h: 0.44, x: 2.65, y: 0.3 },
            { z: 4.4, w: 0.7, h: 0.52, x: 2.95, y: 0.26 }
        ]
        b.solid(loft(pod, ...SMOOTH), l.paint2, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(loft(pod.map(s => ({ ...s, w: s.w * 0.7, h: s.h * 0.5, y: (s.y ?? 0) + s.h * 0.62 })), ...SMOOTH), l.paint, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        nacelle(b, l, [2.95, 0.26, 5.2], 0.62, 2.4, true)
        for (const z of [4.4, 5.3, 6.1]) b.metal(ring(0.64, 0.045, 4, 14), l.metal, [2.95, 0.26, z], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.025, 0.05, 2.0), l.glow, 2.2, [3.6, 0.26, 5.0], [0, 0, 0], [1, 1, 1], true)
        b.glow(octa(0.2), SAPPHIRE, 1.4, [2.95, 1.0, 5.3], [0.5, 0, 0], [0.45, 0.8, 2.6], true)
        b.metal(block(0.3, 0.12, 0.9, 0.02), l.metal, [2.95, 0.84, 5.2], [0, 0, 0], [1, 1, 1], true)
        // Thin blade wings trail low from the stern, edged in gold and light.
        b.solid(slab([[2.3, 1.6], [6.6, 5.4], [6.4, 6.1], [4.2, 5.9], [2.3, 5.0]], 0.1, 0.035), l.paint, [0, -0.42, 0], [0, 0, -0.05], [1, 1, 1], true)
        b.metal(new THREE.BoxGeometry(0.13, 0.06, 5.6), l.paint2, [4.43, -0.58, 3.55], [0, 0.847, -0.05], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.035, 0.035, 5.7), l.glow, 2.4, [4.52, -0.58, 3.45], [0, 0.847, -0.05], [1, 1, 1], true)
        for (let i = 0; i < 4; i++) b.glow(octa(0.09), GEMS[i]!, 2.4, [3.3 + i * 0.75, -0.42 - i * 0.04, 3.7 + i * 0.62], [0, 0, 0], [1, 1.3, 1], true)
        navLights(b, 6.5, -0.7, 5.8)
        // Core drives between the pods.
        drive(b, l, [0, 0.02, 6.1], 0.6, false, 12, l.paint)
        drive(b, l, [1.25, 0.02, 6.0], 0.4, true, 8, l.paint)
        // Belly keel and the six mounts.
        b.solid(loft([
            { z: -4.4, w: 0.25, h: 0.08, y: -0.5 },
            { z: 0.5, w: 0.9, h: 0.14, y: -0.95 },
            { z: 5.0, w: 0.8, h: 0.12, y: -0.95 }
        ], ...SMOOTH), l.paint2)
        barbette(b, l, [0, top(1.3) + 0.12, 1.3], true, false, 0.32)
        barbette(b, l, [0, top(3.7) + 0.12, 3.7], true, false, 0.36)
        barbette(b, l, [2.3, 0.66, 1.9], true, true, 0.28)
        barbette(b, l, [1.3, -0.92, 1.6], false, true, 0.3)
    },

    seraph(b, l) {
        const seraphHull: Section[] = [
            { z: -3.4, w: 0.02, h: 0.02 },
            { z: -2.3, w: 0.28, h: 0.22 },
            { z: -0.6, w: 0.55, h: 0.38, y: 0.03 },
            { z: 1.2, w: 0.6, h: 0.4 },
            { z: 2.3, w: 0.38, h: 0.28 }
        ]
        const ROUND: Shape = [12, 0.85, 0]
        b.solid(loft(seraphHull, ...ROUND), shade(l.paint, 0.5))
        plating(b, seraphHull, -3.3, 2.25, 14, [l.paint, shade(l.paint, 0.9), l.paint, l.paint2], ROUND, 0.012)
        hullLights(b, seraphHull, -2.0, 2.0, 0.5, l.glow, 0.98, -0.2, 0.035)
        for (let z = -0.4; z < 1.9; z += 0.22) {
            const s = sectionAt(seraphHull, z)
            litRows(b, 'side', [s.w * 0.97 + 0.03, 0.12, z], 1, 1, 0.2, 0.07, 300 + Math.round(z * 10), true, 0.75)
        }
        // Dorsal spine: a stepped deckhouse with a command blister, over a belly keel.
        tier(b, l.paint2, l.accent, [0, 0.33, 1.0], 0.5, 0.2, 1.5, 31)
        tier(b, l.paint, l.trim, [0, 0.5, 1.3], 0.34, 0.16, 0.7, 32)
        antennaFarm(b, l, [0, 0.66, 1.4], 0.25, 4, 0.7, 33)
        heatGrille(b, l, [0, 0.4, 2.0], 0.3, 0.4, 4, false, l.glow)
        b.solid(loft([
            { z: -2.8, w: 0.06, h: 0.05, y: -0.15 },
            { z: 2.0, w: 0.35, h: 0.1, y: -0.34 }
        ], 6, 0.6), l.paint2)
        canopy(b, l, -2.1, -0.75, 0.28, 0.24, 0.15)
        band(b, seraphHull, -2.9, -2.55, l.accent, ROUND, 0.03)
        band(b, seraphHull, -0.45, -0.3, l.accent, ROUND, 0.032)
        band(b, seraphHull, -0.26, -0.22, l.trim, ROUND, 0.032)
        band(b, seraphHull, 1.5, 2.2, l.paint2, ROUND, 0.032)
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
        b.solid(block(0.5, 0.08, 1.1, 0.02), l.paint, [1.4, 0.58, 1.0], [0, 0, 0], [1, 1, 1], true)
        for (const z of [0.45, 1.75]) b.metal(ring(0.32, 0.03, 4, 12), l.trim, [1.4, 0.3, z], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.02, 0.04, 1.2), l.glow, 2, [1.71, 0.3, 1.0], [0, 0, 0], [1, 1, 1], true)
        // Wing plating: inset panels, spar lines and tip lamps.
        for (let i = 0; i < 4; i++) b.solid(slab([[0, 0], [0.5, -0.22], [0.5, 0.3], [0, 0.62]], 0.03, 0.008), i % 2 ? l.paint2 : shade(l.paint, 0.88), [0.7 + i * 0.56, 0.2 + (0.95 + i * 0.56) * Math.tan(0.22) - 0.03, -0.12 - i * 0.22], [0, 0, 0.22], [1, 1, 1], true)
        for (let i = 0; i < 5; i++) b.glow(new THREE.BoxGeometry(0.035, 0.03, 0.035), i % 2 ? WINDOW : l.glow, 2.4, [0.9 + i * 0.5, 0.15 + (0.9 + i * 0.5) * Math.tan(0.22), -0.38 - i * 0.215], [0, 0, 0], [1, 1, 1], true)
        b.glow(ring(0.85, 0.035, 4, 40), l.glow, 3, [0, 0.05, 2.75])
        b.metal(ring(0.85, 0.05, 4, 20), l.metal, [0, 0.05, 2.7])
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4
            b.metal(new THREE.BoxGeometry(0.04, 0.55, 0.04), l.metal, [Math.cos(a) * 0.55, 0.05 + Math.sin(a) * 0.55, 2.55], [0, 0, a - Math.PI / 2])
        }
        seam(b, l.accent, [0, 0.42, 0.3], 1.8, false, 'z', 1.4)
        drive(b, l, [0, 0, 2.35], 0.3, false, 8)
        barbette(b, l, [0, 0.36, 0.0], true, false, 0.16)
        barbette(b, l, [0, -0.4, -0.3], false, false, 0.16)
    },

    // A flying fortress: a dagger prow with a triple main battery, casemates
    // behind armoured skirts, a stepped citadel with twin stacks, and tail fins
    // over a cowled drive block.
    bastion(b, l) {
        const BRASS = 0xc9973f
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
        const irons = [l.paint, shade(l.paint, 0.82), shade(l.paint, 1.12), shade(l.paint, 0.9)]
        b.solid(loft(hull, ...OCT), shade(l.paint, 0.4))
        b.solid(loft(keel, ...OCT), shade(l.trim, 0.8))
        plating(b, hull, -6.3, 4.75, 17, irons, OCT, 0.04)
        plating(b, keel, -4.6, 4.3, 9, [l.trim, shade(l.paint, 0.6)], OCT, 0.03)
        band(b, hull, -6.4, -5.2, l.paint2, OCT, 0.08)
        band(b, hull, -5.15, -5.0, BRASS, OCT, 0.09)
        band(b, hull, -2.0, -1.55, l.paint2, OCT, 0.08)
        band(b, hull, 3.3, 3.95, l.paint2, OCT, 0.08)
        band(b, hull, 4.0, 4.12, BRASS, OCT, 0.09)
        band(b, hull, -4.32, -4.26, l.glow, OCT, 0.05, 1.6)
        band(b, keel, -1.0, -0.92, l.glow, OCT, 0.04, 1.6)
        band(b, keel, 1.6, 1.68, l.glow, OCT, 0.04, 1.6)
        hullLights(b, hull, -5.4, 4.4, 0.9, WINDOW, 0.66, 0.99, 0.07)
        // Ram: cheek plates either side of a lit maw.
        b.solid(slab([[0.25, -6.9], [0.7, -6.9], [2.4, -4.2], [0.9, -4.2]], 0.8, 0.1), l.paint2, [0, -0.4, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.3, -6.6], [0.55, -6.6], [1.9, -4.4], [1.1, -4.4]], 0.3, 0.05), BRASS, [0, 0.12, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[0.5, -6.2], [0.8, -6.2], [2.2, -4.3], [1.5, -4.3]], 0.3, 0.05), shade(l.paint2, 0.7), [0, -0.95, 0], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.4, 0.5, 2.0), l.glow, 1.3, [0, -0.4, -5.7])
        for (let i = 0; i < 5; i++) b.metal(new THREE.BoxGeometry(0.5, 0.62, 0.06), l.trim, [0, -0.4, -6.5 + i * 0.4])
        // Main battery on the foredeck, on a stepped plinth.
        b.solid(block(2.6, 0.2, 2.9, 0.06), shade(l.paint, 0.8), [0, 1.18, -3.0])
        hazard(b, [-1.2, 1.29, -4.4], 13, 0.2, 'x')
        b.metal(cyl(1.0, 1.15, 0.3, 8), l.trim, [0, 1.36, -3.0], [0, Math.PI / 8, 0])
        b.solid(slab([[-0.85, -0.9], [0.85, -0.9], [0.95, 0.4], [0.6, 0.9], [-0.6, 0.9], [-0.95, 0.4]], 0.6, 0.1), l.paint2, [0, 1.78, -3.0])
        b.solid(slab([[-0.6, -0.5], [0.6, -0.5], [0.7, 0.35], [0.45, 0.7], [-0.45, 0.7], [-0.7, 0.35]], 0.16, 0.04), shade(l.paint2, 0.7), [0, 2.12, -2.95])
        b.solid(new THREE.BoxGeometry(1.7, 0.08, 0.3), BRASS, [0, 2.08, -3.62])
        b.metal(block(0.3, 0.2, 0.4, 0.03), l.metal, [0.98, 1.8, -2.8], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.03, 0.08, 0.3), l.glow, 2, [1.14, 1.8, -2.8], [0, 0, 0], [1, 1, 1], true)
        for (const x of [-0.5, 0, 0.5]) {
            barrel(b, l, [x, 1.78, -4.8], 2.2, 0.11)
            b.metal(block(0.34, 0.34, 0.5, 0.04), l.trim, [x, 1.78, -3.95])
        }
        // Deck trenches between the citadel and the casemates.
        trench(b, l, [1.95, 1.43, 0.3], 0.55, 5.6, 131, true)
        greeble(b, l, [1.5, 1.3, -2.2], 0.6, 1.2, 6, 31, true)
        // Casemates with forward guns, behind canted armour skirts.
        const skirt: [number, number][] = [[-1.2, -1.0], [0.6, -1.0], [1.0, -0.6], [1.0, 0.6], [0.6, 1.0], [-1.2, 1.0], [-1.5, 0]]
        b.metal(tube(0.3, 0.3, 7.6, 8), l.metal, [3.1, 0, 0.1], [0, 0, 0], [1, 1, 1], true)
        for (let i = 0; i < 3; i++) {
            const z = -2.4 + i * 2.5
            b.solid(block(1.5, 2.0, 2.2, 0.12), i === 1 ? l.paint : shade(l.paint, 0.8), [3.3, 0, z], [0, 0, 0], [1, 1, 1], true)
            b.solid(block(1.3, 0.1, 1.9, 0.03), i === 1 ? shade(l.paint, 0.8) : l.paint, [3.3, 1.0, z], [0, 0, 0], [1, 1, 1], true)
            b.solid(block(1.3, 0.1, 1.9, 0.03), shade(l.paint, 0.7), [3.3, -1.0, z], [0, 0, 0], [1, 1, 1], true)
            b.solid(block(1.54, 0.3, 1.8, 0.04), l.trim, [3.3, -0.35, z], [0, 0, 0], [1, 1, 1], true)
            flankPlate(b, l.paint2, skirt, 0.2, [4.25, -0.1, z], 0.14, 0.06)
            flankPlate(b, shade(l.paint2, 0.72), skirt.map(([h, d]) => [h * 0.78, d * 0.8] as [number, number]), 0.1, [4.34, -0.1, z], 0.14, 0.04)
            flankPlate(b, l.paint, skirt.map(([h, d]) => [h * 0.5, d * 0.55] as [number, number]), 0.1, [4.41, -0.1, z], 0.14, 0.04)
            b.solid(new THREE.BoxGeometry(0.1, 0.1, 1.5), BRASS, [4.13, 0.88, z], [0, 0, 0.14], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.04, 0.12, 0.7), l.glow, 2, [4.5, -0.05, z], [0, 0, 0.14], [1, 1, 1], true)
            b.glow(new THREE.BoxGeometry(0.2, 0.5, 0.06), l.glow, 1.5, [3.75, 0.2, z + 1.25], [0, 0, 0], [1, 1, 1], true)
            litRows(b, 'side', [4.07, 0.62, z - 0.7], 6, 1, 0.28, 0.12, 132 + i, true)
            barrel(b, l, [3.3, 0.45, z - 1.5], 1.2, 0.09, true)
            barrel(b, l, [3.3, -0.5, z - 1.4], 0.9, 0.07, true)
        }
        heatGrille(b, l, [3.3, 1.06, 0.1], 0.8, 1.2, 6, true)
        // Bow casemates: stepped wedges with a lit gun slit.
        b.solid(slab([[-0.6, -1.3], [0.35, -1.3], [0.75, 0.9], [-0.75, 0.9]], 1.5, 0.12), l.paint2, [3.3, 0, -4.4], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[-0.62, -0.5], [0.62, -0.5], [0.78, 0.92], [-0.78, 0.92]], 1.9, 0.1), l.paint, [3.3, 0, -4.4], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[-0.64, -1.0], [0.5, -1.0], [0.62, -0.7], [-0.64, -0.7]], 1.56, 0.04), BRASS, [3.3, 0, -4.4], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.7, 0.12, 0.05), l.glow, 2.2, [3.2, 0, -5.72], [0, 0, 0], [1, 1, 1], true)
        barrel(b, l, [3.2, -0.35, -6.0], 1.0, 0.1, true)
        // Stepped citadel: three storeys, buttresses, side galleries and twin stacks.
        tier(b, l.paint2, BRASS, [0, 1.4, 0.4], 2.8, 1.05, 4.6, 133, 2)
        tier(b, l.paint, shade(l.paint2, 0.7), [0, 2.4, 1.1], 2.0, 1.0, 2.9, 134, 2)
        tier(b, l.paint2, BRASS, [0, 3.36, 0.35], 1.5, 0.7, 1.2, 135)
        for (const x of [-1, 1]) tier(b, l.paint, shade(l.paint, 0.7), [x * 1.62, 1.4, 0.9], 0.5, 0.5, 3.0, 136 + x)
        b.solid(slab([[0, -1.6], [1.7, 0.6], [1.7, 1.6], [0, 1.0]], 0.22, 0.05), l.paint, [1.0, 1.45, 0.4], [0, 0, Math.PI / 2], [1, 1, 1], true)
        b.solid(loft([
            { z: -0.35, w: 0.6, h: 0.2, y: 4.2 },
            { z: -0.1, w: 0.95, h: 0.3, y: 4.26 },
            { z: 0.8, w: 0.95, h: 0.3, y: 4.26 },
            { z: 1.05, w: 0.6, h: 0.22, y: 4.2 }
        ], ...OCT), l.paint)
        b.glass(new THREE.BoxGeometry(1.5, 0.16, 0.04), l.glass, [0, 4.36, -0.26], [-0.5, 0, 0])
        litRows(b, 'fore', [-0.62, 4.27, -0.3], 9, 1, 0.155, 0.1, 138, false, 1)
        litRows(b, 'side', [0.92, 4.28, 0], 5, 1, 0.18, 0.1, 139, true, 0.9)
        b.solid(block(2.5, 0.08, 0.4, 0.02), BRASS, [0, 4.12, 0.35])
        navLights(b, 1.25, 4.2, 0.35)
        antennaFarm(b, l, [0, 4.5, 0.5], 0.9, 6, 2.0, 140)
        mast(b, [0.45, 4.5, 0.7], 2.4)
        dish(b, l, [-0.55, 3.42, 2.2], 0.4)
        for (const x of [-0.55, 0.55]) {
            b.metal(cyl(0.3, 0.36, 1.3, 10), l.trim, [x, 2.95, 3.0], [0.22, 0, 0])
            b.solid(cyl(0.33, 0.33, 0.16, 10), l.paint2, [x, 3.35, 3.09], [0.22, 0, 0])
            b.glow(cyl(0.22, 0.22, 0.02, 10), HEAT, 1.8, [x, 3.6, 3.15], [0.22, 0, 0])
        }
        for (let i = 0; i < 4; i++) vent(b, [1.42, 1.85, -0.9 + i * 0.8], 0.06, 0.3, 0.5, true, 3)
        // Quarterdeck, tail fins and drives.
        b.solid(block(4.4, 0.24, 1.7, 0.06), shade(l.paint, 0.8), [0, 1.46, 3.75])
        heatGrille(b, l, [1.35, 1.6, 3.9], 0.9, 1.1, 5, true)
        hazard(b, [-2.1, 1.59, 4.52], 21, 0.2, 'x')
        b.solid(slab([[0, 0], [2.2, 1.4], [2.4, 2.6], [0, 2.4]], 0.24, 0.06), l.paint2, [2.0, 1.2, 2.3], [0, 0, Math.PI / 2 - 0.2], [1, 1, 1], true)
        b.solid(slab([[1.5, 0.95], [2.2, 1.4], [2.4, 2.6], [1.5, 2.55]], 0.27, 0.06), BRASS, [2.0, 1.2, 2.3], [0, 0, Math.PI / 2 - 0.2], [1, 1, 1], true)
        b.solid(slab([[0.3, 0.5], [1.3, 1.1], [1.3, 2.3], [0.3, 2.2]], 0.3, 0.04), shade(l.paint2, 0.7), [2.0, 1.2, 2.3], [0, 0, Math.PI / 2 - 0.2], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.05, 1.6, 0.06), l.glow, 2, [2.36, 2.2, 4.95], [0, 0, -0.2], [1, 1, 1], true)
        b.solid(slab([[0, 0], [1.3, 0.8], [1.3, 2.0], [0, 2.2]], 0.3, 0.06), l.paint2, [0, -2.1, 0.3], [0, 0, -Math.PI / 2])
        navLights(b, 4.5, 1.0, 3.6)
        b.metal(block(4.9, 2.7, 0.7, 0.1), 0x14161a, [0, -0.05, 4.75])
        b.solid(block(4.8, 0.3, 1.5, 0.07), l.paint, [0, 1.38, 5.05])
        b.solid(block(4.6, 0.3, 1.5, 0.07), shade(l.paint, 0.7), [0, -1.45, 5.05])
        b.solid(block(0.3, 2.5, 1.5, 0.07), l.paint2, [2.42, -0.05, 5.05], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(4.2, 0.05, 0.05), l.glow, 2, [0, 1.2, 5.8])
        for (const x of [-0.85, 0.85]) b.glow(new THREE.BoxGeometry(0.05, 2.2, 0.05), HEAT, 1.4, [x, -0.05, 5.12])
        drive(b, l, [0, -0.1, 4.95], 0.8, false, 0, l.trim)
        drive(b, l, [1.55, 0.55, 4.9], 0.62, true, 0, l.trim)
        drive(b, l, [1.55, -0.65, 4.9], 0.55, true, 0, l.trim)
        drive(b, l, [3.3, 0, 3.95], 0.55, true, 8)
        barbette(b, l, [0, 2.42, -1.2], true, false, 0.42)
        barbette(b, l, [0, 3.38, 2.0], true, false, 0.42)
        barbette(b, l, [3.3, 1.03, -2.4], true, true, 0.42)
    },

    // A dreadnought built around its gun: the spinal lance runs out between two
    // prow tines. Split armour shells over a machinery waist, a stepped citadel,
    // hangar outriggers on swept wings and a cowled five-nozzle drive block.
    leviathan(b, l) {
        const NAVY = 0x1d3557
        const GOLD = 0xd8a53c
        const core: Section[] = [
            { z: -7.4, w: 0.9, h: 0.8 },
            { z: -6.4, w: 1.9, h: 1.45 },
            { z: -4.0, w: 2.3, h: 1.8 },
            { z: 3.0, w: 2.9, h: 2.2 },
            { z: 6.8, w: 2.9, h: 2.2 },
            { z: 7.7, w: 2.5, h: 1.9 }
        ]
        const upper = shell(core, 0.6, 0.42)
        const lower = shell(core, -0.6, 0.42)
        const top = (z: number) => sectionAt(core, z).h
        const greys = [l.paint, shade(l.paint, 0.86), l.paint, l.paint2]
        b.metal(loft(core, ...OCT), 0x171b22)
        b.solid(loft(upper, ...OCT), shade(l.paint, 0.55))
        b.solid(loft(lower, ...OCT), shade(l.paint, 0.5))
        plating(b, upper, -7.3, 7.6, 22, greys)
        plating(b, lower, -7.3, 7.6, 17, [shade(l.paint, 0.8), l.paint2, shade(l.paint2, 0.8)])
        for (const hull of [upper, lower]) {
            band(b, hull, -6.3, -5.7, NAVY, OCT, 0.08)
            band(b, hull, -5.66, -5.52, GOLD, OCT, 0.09)
            band(b, hull, 0.9, 1.5, NAVY, OCT, 0.08)
            band(b, hull, 5.7, 6.7, NAVY, OCT, 0.08)
            band(b, hull, 6.74, 6.88, GOLD, OCT, 0.09)
        }
        for (const z of [-4.6, -2.6, -0.4, 2.4, 4.6]) band(b, core, z, z + 0.1, l.glow, OCT, 0.02, 1.3)
        for (const z of [-5.2, -3.4, -1.5, 0.4, 3.4, 5.3]) band(b, core, z, z + 0.22, l.trim, OCT, 0.3)
        waist(b, l, core, -6.2, 7.4, 61)
        hullLights(b, upper, -6.8, 7.2, 1.0, WINDOW, 0.64, 0.98, 0.07)
        hullLights(b, lower, -6.8, 7.2, 1.4, l.glow, 0.99, -0.3, 0.07)
        for (let z = -6.0; z < 7.2; z += 0.31) {
            const s = sectionAt(upper, z)
            litRows(b, 'side', [s.w * 0.961 + 0.075, s.y! + s.h * 0.2, z], 1, 2, 0.3, 0.12, 700 + Math.round(z * 10), true, 0.62)
        }
        // Prow tines cradling the lance.
        const tine: Section[] = [
            { z: -9.4, w: 0.12, h: 0.2, x: 2.0 },
            { z: -8.6, w: 0.5, h: 0.65, x: 2.0 },
            { z: -6.2, w: 0.75, h: 1.0, x: 2.05 },
            { z: -4.6, w: 0.5, h: 0.75, x: 2.35 }
        ]
        b.solid(loft(tine, ...OCT), shade(l.paint, 0.55), [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        plating(b, tine, -9.0, -4.7, 8, greys, OCT, 0.04, true)
        band(b, tine, -9.3, -8.9, NAVY, OCT, 0.07, 0, true)
        band(b, tine, -8.86, -8.74, GOLD, OCT, 0.08, 0, true)
        b.glow(new THREE.BoxGeometry(0.05, 0.12, 2.6), l.glow, 2.2, [1.38, 0, -7.6], [0, 0, 0], [1, 1, 1], true)
        litRows(b, 'side', [2.84, 0.3, -8.2], 9, 2, 0.34, 0.13, 63, true)
        navLights(b, 2.0, 0.3, -9.35)
        b.metal(tube(0.5, 0.85, 3.0, 12), l.trim, [0, 0, -7.9])
        b.metal(tube(0.62, 0.62, 0.5, 12), l.metal, [0, 0, -9.0])
        for (let i = 0; i < 6; i++) {
            const t = (i / 6) * Math.PI * 2
            b.metal(new THREE.BoxGeometry(0.1, 0.22, 2.4), l.metal, [Math.cos(t) * 0.78, Math.sin(t) * 0.78, -7.9], [0, 0, t - Math.PI / 2])
        }
        for (let i = 0; i < 3; i++) {
            const z = -9.0 + i * 0.75
            b.glow(ring(0.86, 0.06, 4, 16), l.glow, 2.4, [0, 0, z])
            b.metal(block(1.1, 0.16, 0.22, 0.03), l.metal, [1.0, 0, z + 0.3], [0, 0, 0], [1, 1, 1], true)
        }
        b.glow(tube(0.36, 0.36, 0.1, 12), l.glow, 4, [0, 0, -9.42])
        for (let i = 0; i < 12; i++) {
            const t = (i / 12) * Math.PI * 2
            b.solid(new THREE.BoxGeometry(0.34, 0.05, 0.3), i % 2 ? SOOT : HAZARD, [Math.cos(t) * 0.63, Math.sin(t) * 0.63, -9.0], [0, 0, t - Math.PI / 2])
        }
        // Swept wings out to the outrigger hulls: layered plates, a lit spar and radiators aft.
        b.solid(slab([[2.6, -3.0], [5.3, -0.6], [5.3, 3.6], [2.6, 3.4]], 0.6, 0.12), shade(l.paint2, 0.7), [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[2.9, -2.35], [5.0, -0.5], [5.0, 0.3], [2.9, -1.2]], 0.72, 0.08), NAVY, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[2.95, -1.0], [5.0, 0.5], [5.0, 1.5], [2.95, 0.4]], 0.7, 0.06), l.paint, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[2.95, 0.55], [5.0, 1.65], [5.0, 2.4], [2.95, 1.7]], 0.76, 0.06), l.paint2, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.solid(slab([[2.95, 1.85], [5.0, 2.55], [5.0, 3.4], [2.95, 3.2]], 0.7, 0.06), l.paint, [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.06, 0.06, 3.5), l.glow, 2.2, [3.95, 0, -1.9], [0, -0.844, 0], [1, 1, 1], true)
        for (const y of [0.4, -0.4]) b.metal(tube(0.09, 0.09, 2.6, 6), l.metal, [4.1, y, 1.0], [0, Math.PI / 2, 0], [1, 1, 1], true)
        trench(b, l, [4.0, 0.36, 1.75], 0.4, 1.0, 64, true)
        greeble(b, l, [4.0, 0.38, 2.8], 1.6, 0.9, 9, 45, true)
        for (let i = 0; i < 6; i++) b.glow(new THREE.BoxGeometry(0.07, 0.05, 0.07), i % 2 ? WINDOW : l.glow, 2.4, [2.95 + i * 0.42, 0.37, -2.55 + i * 0.372], [0, 0, 0], [1, 1, 1], true)
        for (let i = 0; i < 3; i++) radiator(b, l, [3.0, -0.1, 3.95 + i * 0.5], 2.2, 0.42, -0.12 - i * 0.12, HEAT, 3)
        const pod: Section[] = [
            { z: -4.4, w: 0.2, h: 0.3, x: 6 },
            { z: -2.8, w: 1.05, h: 1.25, x: 6 },
            { z: 4.4, w: 1.05, h: 1.25, x: 6 },
            { z: 5.2, w: 0.75, h: 0.9, x: 6 }
        ]
        b.solid(loft(pod, ...OCT), shade(l.paint, 0.55), [0, 0, 0], [0, 0, 0], [1, 1, 1], true)
        plating(b, pod, -4.2, 5.1, 12, greys, OCT, 0.04, true)
        band(b, pod, -3.6, -3.0, NAVY, OCT, 0.08, 0, true)
        band(b, pod, -2.95, -2.82, GOLD, OCT, 0.09, 0, true)
        band(b, pod, 3.3, 4.3, NAVY, OCT, 0.08, 0, true)
        band(b, pod, 2.9, 2.98, l.glow, OCT, 0.05, 1.5, true)
        sideBay(b, l, [7.62, -0.05, 0.4], 0.8, 3.6, 0.62, 65)
        litRows(b, 'side', [7.06, 0.62, -2.2], 16, 1, 0.34, 0.13, 66, true)
        dockingCollar(b, l, [7.05, 0, 3.5], 0.32)
        b.solid(slab([[0, 0], [1.8, 1.2], [1.9, 2.6], [0, 2.4]], 0.2, 0.05), NAVY, [6, 1.1, 2.4], [0, 0, Math.PI / 2], [1, 1, 1], true)
        b.solid(slab([[1.2, 0.85], [1.8, 1.2], [1.9, 2.6], [1.2, 2.55]], 0.24, 0.05), GOLD, [6, 1.1, 2.4], [0, 0, Math.PI / 2], [1, 1, 1], true)
        b.solid(slab([[0, 0], [1.3, 1.0], [1.3, 2.2], [0, 2.4]], 0.2, 0.05), NAVY, [6, -1.1, 2.4], [0, 0, -Math.PI / 2], [1, 1, 1], true)
        b.glow(new THREE.BoxGeometry(0.05, 1.3, 0.06), l.glow, 2, [6, 2.4, 5.0], [0, 0, 0], [1, 1, 1], true)
        trench(b, l, [6, 1.2, 0.25], 0.5, 1.9, 67, true)
        // Foredeck: gun plinths stepping up to the citadel, deckhouses between them, a trench down each side.
        for (const z of [-6.0, -4.2, -0.8]) {
            b.solid(block(1.9, 0.3, 1.7, 0.08), l.paint2, [0, top(z) + 0.1, z])
            b.solid(block(1.5, 0.12, 1.3, 0.03), NAVY, [0, top(z) + 0.27, z])
            hazard(b, [-0.72, top(z) + 0.26, z - 0.78], 9, 0.18, 'x')
            barbette(b, l, [0, top(z) + 0.3, z], true, false, 0.5)
        }
        tier(b, l.paint, GOLD, [0, top(-2.5) - 0.06, -2.5], 1.3, 0.62, 1.7, 71)
        vent(b, [0, top(-2.5) + 0.6, -2.5], 0.8, 0.08, 1.0, false, 4)
        tier(b, l.paint, NAVY, [0, top(-5.1) - 0.05, -5.1], 1.0, 0.4, 0.5, 72)
        trench(b, l, [1.3, top(-4.6) - 0.03, -4.6], 0.45, 2.2, 73, true)
        trench(b, l, [1.45, top(-1.4) - 0.03, -1.4], 0.5, 2.6, 74, true)
        greeble(b, l, [0.95, top(-3) + 0.02, -3.2], 0.5, 1.4, 6, 41, true)
        // Citadel: three storeys, a winged bridge and the comms farm.
        const deck = top(3.2) - 0.06
        tier(b, l.paint2, NAVY, [0, deck, 3.2], 3.6, 1.0, 5.6, 75, 2)
        tier(b, l.paint, GOLD, [0, deck + 0.96, 3.7], 2.7, 0.95, 4.4, 76, 2)
        tier(b, l.paint2, NAVY, [0, deck + 1.87, 3.3], 1.9, 0.95, 1.9, 77, 2)
        const roof = deck + 2.8
        for (const x of [-1, 1]) tier(b, l.paint, NAVY, [x * 2.1, deck, 3.4], 0.7, 0.55, 3.6, 78 + x)
        b.solid(slab([[0, -2.2], [1.5, -0.4], [1.5, 1.4], [0, 0.6]], 0.22, 0.05), l.paint, [1.2, deck, 1.0], [0, 0, Math.PI / 2], [1, 1, 1], true)
        b.solid(loft([
            { z: 2.25, w: 0.9, h: 0.22, y: roof + 0.22 },
            { z: 2.5, w: 1.25, h: 0.34, y: roof + 0.3 },
            { z: 3.7, w: 1.25, h: 0.34, y: roof + 0.3 },
            { z: 4.1, w: 0.8, h: 0.26, y: roof + 0.24 }
        ], ...OCT), l.paint)
        b.glass(new THREE.BoxGeometry(2.0, 0.2, 0.05), l.glass, [0, roof + 0.4, 2.36], [-0.5, 0, 0])
        litRows(b, 'fore', [-0.85, roof + 0.3, 2.31], 12, 1, 0.155, 0.11, 81, false, 1)
        litRows(b, 'side', [1.22, roof + 0.32, 2.7], 6, 1, 0.18, 0.11, 82, true, 0.9)
        b.solid(block(3.4, 0.1, 0.5, 0.03), GOLD, [0, roof + 0.2, 3.0])
        for (const x of [-1.6, 1.6]) b.solid(block(0.4, 0.26, 0.6, 0.04), l.paint2, [x, roof + 0.3, 3.0])
        litRows(b, 'fore', [-1.7, roof + 0.32, 2.69], 2, 1, 0.2, 0.1, 83)
        litRows(b, 'fore', [1.5, roof + 0.32, 2.69], 2, 1, 0.2, 0.1, 84)
        navLights(b, 1.82, roof + 0.46, 3.0)
        antennaFarm(b, l, [0, roof + 0.6, 3.5], 1.3, 7, 2.6, 85)
        mast(b, [0.55, roof + 0.6, 3.9], 3.2)
        dish(b, l, [-0.6, deck + 1.9, 5.3], 0.55)
        dish(b, l, [0.75, deck + 1.0, 0.95], 0.4)
        barbette(b, l, [0, deck + 1.9, 4.95], true, false, 0.5)
        greeble(b, l, [0.9, deck + 1.92, 5.3], 0.6, 0.9, 5, 44, true)
        for (let i = 0; i < 5; i++) vent(b, [1.84, deck + 0.3, 1.2 + i * 0.9], 0.08, 0.3, 0.5, true, 3)
        // Quarterdeck over the drives: the view from the chase camera.
        b.solid(block(5.2, 0.3, 2.1, 0.08), l.paint2, [0, top(7) + 0.08, 7.0])
        b.solid(block(3.2, 0.26, 1.7, 0.06), l.paint, [0, top(7) + 0.34, 7.1])
        heatGrille(b, l, [1.05, top(7) + 0.5, 7.1], 0.8, 1.3, 6, true)
        heatGrille(b, l, [2.1, top(7) + 0.25, 7.1], 0.7, 1.5, 7, true)
        b.solid(slab([[0, 0], [2.1, 0.9], [1.9, 2.5], [0, 2.7]], 0.22, 0.05), NAVY, [0, top(7) + 0.4, 5.9], [0, 0, Math.PI / 2])
        b.solid(slab([[1.35, 0.6], [2.1, 0.9], [1.9, 2.5], [1.35, 2.58]], 0.26, 0.05), GOLD, [0, top(7) + 0.4, 5.9], [0, 0, Math.PI / 2])
        b.glow(new THREE.BoxGeometry(0.06, 1.5, 0.06), l.glow, 2, [0, top(7) + 1.4, 8.42], [-0.06, 0, 0])
        hazard(b, [-2.5, top(7) + 0.245, 8.0], 26, 0.2, 'x')
        // Ventral hangar between twin keel fins.
        b.metal(block(1.9, 0.3, 3.2, 0.05), SOOT, [0, -top(-2.5) + 0.05, -2.5])
        for (const x of [-0.85, 0.85]) b.glow(new THREE.BoxGeometry(0.06, 0.06, 3.0), l.glow, 2.2, [x, -top(-2.5) - 0.12, -2.5])
        for (let i = 0; i < 6; i++) b.glow(new THREE.BoxGeometry(1.0, 0.04, 0.08), WINDOW, 1.6, [0, -top(-2.5) - 0.11, -3.8 + i * 0.52])
        hazard(b, [-0.9, -top(-2.5) - 0.11, -4.2], 10, 0.2, 'x')
        b.solid(slab([[0, 0], [1.6, 1.2], [1.6, 4.6], [0, 5.4]], 0.3, 0.06), NAVY, [1.7, -1.9, 1.2], [0, 0, -Math.PI / 2 + 0.25], [1, 1, 1], true)
        b.solid(slab([[1.0, 0.75], [1.6, 1.2], [1.6, 4.6], [1.0, 4.85]], 0.34, 0.06), l.paint2, [1.7, -1.9, 1.2], [0, 0, -Math.PI / 2 + 0.25], [1, 1, 1], true)
        // Drive block: an armoured cowl around one main and four cruise nozzles.
        b.metal(block(5.6, 4.0, 0.9, 0.12), 0x14181f, [0, 0, 7.75])
        b.solid(block(5.4, 0.34, 1.9, 0.08), l.paint, [0, 2.05, 7.95])
        b.solid(block(5.4, 0.34, 1.9, 0.08), l.paint2, [0, -2.15, 7.95])
        b.solid(block(0.34, 3.5, 1.9, 0.08), NAVY, [2.78, -0.05, 7.95], [0, 0, 0], [1, 1, 1], true)
        b.solid(block(0.12, 1.6, 1.5, 0.03), GOLD, [2.98, -0.05, 8.0], [0, 0, 0], [1, 1, 1], true)
        for (const x of [-0.6, 0.6]) b.glow(new THREE.BoxGeometry(0.05, 3.2, 0.05), HEAT, 1.5, [x * 1.35, 0, 8.22])
        b.glow(new THREE.BoxGeometry(4.6, 0.05, 0.05), l.glow, 2, [0, 1.86, 8.9])
        b.glow(new THREE.BoxGeometry(4.6, 0.05, 0.05), l.glow, 2, [0, -1.96, 8.9])
        drive(b, l, [0, 0, 8.1], 1.0, false, 0, l.trim)
        drive(b, l, [1.55, 0.85, 8.05], 0.72, true, 0, l.trim)
        drive(b, l, [1.55, -0.95, 8.05], 0.72, true, 0, l.trim)
        drive(b, l, [6, 0, 5.4], 0.75, true, 8)
        greeble(b, l, [6, 1.22, -1.9], 0.9, 1.0, 5, 42, true)
        barbette(b, l, [6, 1.2, -1.5], true, true, 0.5)
    }
}
