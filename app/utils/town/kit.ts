// Polytown — the modelling kit. A building is a list of primitive parts in
// tile-local space: the tile is 1×1 centred on the origin, y is up, the ground
// is y = 0 and the front door faces +Z. Buildings are authored to fill their
// tile edge to edge, so a street of them reads as one block from the usual
// zoomed-out camera. Everything here is plain data; models.ts turns it into
// meshes.

import * as THREE from 'three'

export interface Part {
    shape: 'box' | 'cyl' | 'cone' | 'sphere' | 'dome' | 'prism' | 'pyramid' | 'crystal'
    x: number
    /** Bottom of the part (not the centre) — parts stack naturally. */
    y: number
    z: number
    w: number
    h: number
    d: number
    color: number
    /** Lit parts are batched into a mesh named 'glow' that the scene animates. */
    emissive?: number
    rotY?: number
    rotX?: number
    rotZ?: number
    /** Turn applied after the part's own rotation: which wall it hangs on. */
    faceY?: number
    /** Radial segments for round shapes (defaults keep the low-poly look). */
    seg?: number
    /** Skip the baked bottom-to-top shading (flat ground details, water). */
    flat?: boolean
}

/** Parts that turn together around a pivot (sails, saw blades, winding wheels). */
export interface Spinner {
    pivot: [number, number, number]
    axis: 'x' | 'y' | 'z'
    /** Radians per second at normal speed; fast machinery by default. */
    rate?: number
    parts: Part[]
}

export interface ModelSpec {
    parts: Part[]
    spinners?: Spinner[]
    /** Chimney tops: where the scene releases smoke puffs. */
    smoke?: [number, number, number][]
}

export type Face = 'front' | 'back' | 'left' | 'right'

// ─── Palette ─────────────────────────────────────────────────────────────────
// Sun-baked plaster, terracotta and weathered timber.

export const C = {
    cream: 0xf8ead0, ochre: 0xf4c452, terracotta: 0xe4795a, white: 0xfbf8f1, sky: 0x8ec3e6, rose: 0xf2a6a6, mint: 0xa9dcc3, lavender: 0xcdb8f2,
    roofRed: 0xd4382c, roofOrange: 0xec7228, roofBrown: 0x8a4a33, roofBlue: 0x2e6db8, roofDark: 0x4a5266, roofGreen: 0x2c8a6f, roofTeal: 0x239aa9, roofPlum: 0x7e3d95,
    trim: 0xfdfbf5, timber: 0x4f3220, accent: 0x3b8f96,
    wood: 0xb47a45, woodDark: 0x63391f, woodLight: 0xd8a868, plank: 0xcb9553,
    stone: 0xb8b3a3, stoneDark: 0x6f7370, stoneLight: 0xe0dbc9, cobble: 0xc2b394, paving: 0xd8caa8,
    brick: 0xbe5a38, brickDark: 0x8a3b25, metal: 0x505c68, metalLight: 0x9ba7ae, iron: 0x2f353d,
    soil: 0x9a7040, soilDark: 0x74532f, wheat: 0xf1c53e, wheatLight: 0xfadd6d, hay: 0xe4b53f,
    grass: 0x7fb24a, grassDark: 0x5c9440, leaf: 0x5aa43f, leafLight: 0x8cc44a, leafDark: 0x38803f, pine: 0x246b4c, pineLight: 0x358a58,
    autumn: 0xe4a12e, bloomPink: 0xf07fa0, bloomYellow: 0xf9d146, bloomWhite: 0xfaf3e2,
    water: 0x3fa9c4, glass: 0x3f6480, lit: 0xffdd8f, litGlow: 0xffb347, fire: 0xff7a1a,
    shutterGreen: 0x2f7d52, shutterTeal: 0x2a8390, shutterBrown: 0x6f4024, shutterBlue: 0x2f5aa0, shutterRed: 0xb8382e,
    gold: 0xf0be4a, wine: 0xa0384c, purple: 0x7a3fb0, violet: 0x9864d9, lilac: 0xc39bf0, teal: 0x5fc7bc,
    rock: 0x8f8f86, rockDark: 0x6a6b66, rockLight: 0xb0afa2, shadowRock: 0x55566d
}

/**
 * Roof colour by look (level 1, 5, 10, 15, 20): terracotta, brick, wine, steel
 * blue, gold. The same ramp on every building and it only gets richer, so a
 * glance at a roof says what tier a plot is and a gold street is a flex. No
 * other colour changes with the tile. Domes and turret caps stay C.accent teal
 * on every level, which ties the whole town together.
 */
export const TIER_ROOFS = [0xc8664a, 0xb2453a, 0x8f3f5c, 0x3f6494, 0xd6a53f] as const

export function tierRoof(stage: number): number {
    return TIER_ROOFS[Math.max(0, Math.min(TIER_ROOFS.length - 1, stage))]!
}

/** Lighten (+) or darken (−) by a lightness step, judged in sRGB so dark tones don't collapse to black. */
export function shade(color: number, amount: number): number {
    const c = new THREE.Color(color)
    const hsl = { h: 0, s: 0, l: 0 }
    c.getHSL(hsl, THREE.SRGBColorSpace)
    c.setHSL(hsl.h, Math.min(1, hsl.s * (amount < 0 ? 1.05 : 0.95)), Math.max(0, Math.min(1, hsl.l + amount)), THREE.SRGBColorSpace)
    return c.getHex()
}

// ─── Primitives ──────────────────────────────────────────────────────────────

export const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'box', x, y, z, w, h, d, color, ...extra })
export const cyl = (x: number, y: number, z: number, w: number, h: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'cyl', x, y, z, w, h, d: w, color, ...extra })
export const cone = (x: number, y: number, z: number, w: number, h: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'cone', x, y, z, w, h, d: w, color, ...extra })
export const ball = (x: number, y: number, z: number, w: number, h: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'sphere', x, y, z, w, h, d: w, color, ...extra })
export const dome = (x: number, y: number, z: number, w: number, h: number, color: number, extra: Partial<Part> = {}): Part => ({ shape: 'dome', x, y, z, w, h, d: w, color, ...extra })

/** The whole tile, so no meadow shows between neighbours. */
export const ground = (color: number, h = 0.02): Part => box(0, 0, 0, 1, h, 1, color, { flat: true })

/**
 * Move parts authored against the front wall (x along the wall, z = distance
 * out from it) onto any face of a w×d shell centred on (cx, cz).
 */
export function onFace(face: Face, w: number, d: number, parts: Part[], cx = 0, cz = 0): Part[] {
    return parts.map((p) => {
        switch (face) {
            case 'front': return { ...p, x: cx + p.x, z: cz + d / 2 + p.z }
            case 'back': return { ...p, x: cx - p.x, z: cz - d / 2 - p.z, faceY: Math.PI }
            case 'right': return { ...p, x: cx + w / 2 + p.z, z: cz - p.x, faceY: Math.PI / 2 }
            case 'left': return { ...p, x: cx - w / 2 - p.z, z: cz + p.x, faceY: -Math.PI / 2 }
        }
    })
}

// ─── Roofs ───────────────────────────────────────────────────────────────────
// Roofs are stepped courses rather than smooth slopes: the banding reads as
// rows of tiles from far away and costs one box per course.

function courses(h: number, size = 0.045) {
    return Math.max(3, Math.round(h / size))
}

/** Pitched roof; `ridge` is the axis the ridge runs along. `gable` fills the end walls. */
export function gableRoof(x: number, y: number, z: number, w: number, d: number, h: number, color: number, ridge: 'x' | 'z' = 'x', gable?: number): Part[] {
    const n = courses(h)
    const parts: Part[] = [box(x, y - 0.025, z, w + 0.02, 0.03, d + 0.02, shade(color, -0.2))]
    for (let i = 0; i < n; i++) {
        const t = 1 - i / n
        const tone = i % 2 ? shade(color, -0.06) : color
        parts.push(ridge === 'x'
            ? box(x, y + i * h / n, z, w, h / n, Math.max(0.05, d * t), tone)
            : box(x, y + i * h / n, z, Math.max(0.05, w * t), h / n, d, tone))
    }
    parts.push(ridge === 'x' ? box(x, y + h, z, w, 0.018, 0.05, shade(color, -0.1)) : box(x, y + h, z, 0.05, 0.018, d, shade(color, -0.1)))
    if (gable !== undefined) {
        parts.push(ridge === 'x'
            ? { shape: 'prism', x, y, z, w: d - 0.08, h: h - 0.02, d: w - 0.05, color: gable, rotY: Math.PI / 2 }
            : { shape: 'prism', x, y, z, w: w - 0.08, h: h - 0.02, d: d - 0.05, color: gable })
    }
    return parts
}

export function hipRoof(x: number, y: number, z: number, w: number, d: number, h: number, color: number, flatTop = 0.12): Part[] {
    const n = courses(h, 0.03)
    const parts: Part[] = [box(x, y - 0.025, z, w + 0.02, 0.03, d + 0.02, shade(color, -0.2))]
    for (let i = 0; i < n; i++) {
        const t = 1 - i / n
        parts.push(box(x, y + i * h / n, z, Math.max(flatTop, w * t), h / n, Math.max(flatTop, d * t), i % 2 ? shade(color, -0.06) : color))
    }
    return parts
}

/** Round stepped cap for towers and silos. */
export function coneRoof(x: number, y: number, z: number, w: number, h: number, color: number, seg = 10): Part[] {
    const n = courses(h)
    return Array.from({ length: n }, (_, i) => cyl(x, y + i * h / n, z, Math.max(0.04, w * (1 - i / n)), h / n, i % 2 ? shade(color, -0.06) : color, { seg }))
}

export function flatRoof(x: number, y: number, z: number, w: number, d: number, color: number, parapet = C.stoneLight): Part[] {
    return [
        box(x, y, z, w, 0.03, d, color),
        box(x, y, z + d / 2 - 0.02, w, 0.07, 0.04, parapet), box(x, y, z - d / 2 + 0.02, w, 0.07, 0.04, parapet),
        box(x + w / 2 - 0.02, y, z, 0.04, 0.07, d, parapet), box(x - w / 2 + 0.02, y, z, 0.04, 0.07, d, parapet)
    ]
}

// ─── Facade details (authored against the front wall; place with onFace) ─────

export function windowAt(x: number, y: number, w = 0.1, h = 0.13, o: { shutters?: number, lit?: boolean, sill?: boolean, frame?: number } = {}): Part[] {
    const parts = [box(x, y, 0.004, w, h, 0.02, o.lit ? C.lit : C.glass, o.lit ? { emissive: C.litGlow } : {})]
    if (o.frame !== undefined) parts.push(box(x, y - 0.012, 0.002, w + 0.03, h + 0.024, 0.016, o.frame))
    if (o.sill !== false) parts.push(box(x, y - 0.02, 0.012, w + 0.05, 0.02, 0.035, o.frame ?? C.stoneLight))
    if (o.shutters !== undefined) {
        for (const side of [-1, 1]) parts.push(box(x + side * (w / 2 + w * 0.22), y, 0.006, w * 0.4, h, 0.016, o.shutters))
    }
    return parts
}

/** Evenly spaced windows along a wall of width `span`; every other one is lit. */
export function windowRow(span: number, y: number, count: number, o: { w?: number, h?: number, shutters?: number, lit?: number, sill?: boolean, frame?: number } = {}): Part[] {
    return Array.from({ length: count }, (_, i) => windowAt((i + 0.5) / count * span - span / 2, y, o.w, o.h, { shutters: o.shutters, sill: o.sill, frame: o.frame, lit: (i + (o.lit ?? 0)) % 2 === 0 })).flat()
}

/** `step` adds a doorstep; leave it off when the wall already stands on the tile edge. */
export function doorAt(x: number, w = 0.13, h = 0.22, color = C.woodDark, step = true): Part[] {
    return [
        box(x, 0.02, 0.004, w + 0.04, h + 0.02, 0.02, C.stoneLight),
        box(x, 0.02, 0.01, w, h, 0.02, color),
        box(x + w * 0.28, 0.02 + h * 0.45, 0.022, 0.014, 0.014, 0.01, C.gold),
        ...(step ? [box(x, 0, 0.05, w + 0.1, 0.035, 0.09, C.stone)] : [])
    ]
}

/** Striped shop awning hanging off the front wall. */
export function awning(x: number, y: number, w: number, a: number, b: number, reach = 0.08): Part[] {
    const stripes = Math.max(3, Math.round(w / 0.09))
    return Array.from({ length: stripes }, (_, i) => box(x - w / 2 + (i + 0.5) * w / stripes, y, reach / 2, w / stripes, 0.025, reach + 0.03, i % 2 ? a : b, { rotX: 0.38 }))
}

export function balcony(x: number, y: number, w: number, rail = C.iron): Part[] {
    const bars = Math.max(3, Math.round(w / 0.05))
    return [
        box(x, y, 0.045, w, 0.025, 0.09, C.stoneLight),
        box(x, y + 0.085, 0.085, w, 0.012, 0.012, rail),
        ...Array.from({ length: bars }, (_, i) => box(x - w / 2 + (i + 0.5) * w / bars, y + 0.025, 0.085, 0.01, 0.06, 0.01, rail))
    ]
}

// ─── Props ───────────────────────────────────────────────────────────────────

export function chimney(spec: ModelSpec, x: number, y: number, z: number, h = 0.22, color = C.brick, w = 0.09) {
    spec.parts.push(box(x, y, z, w, h, w, color), box(x, y + h, z, w + 0.035, 0.03, w + 0.035, C.stoneDark), box(x, y + h + 0.03, z, w * 0.6, 0.025, w * 0.6, C.iron))
    ;(spec.smoke ??= []).push([x, y + h + 0.06, z])
}

export function crate(x: number, y: number, z: number, s = 0.11, color = C.plank): Part[] {
    return [box(x, y, z, s, s, s, color), box(x, y + s * 0.42, z, s + 0.008, s * 0.16, s + 0.008, C.woodDark)]
}

export function barrel(x: number, y: number, z: number, s = 0.1): Part[] {
    return [cyl(x, y, z, s, s * 1.25, C.wood, { seg: 8 }), cyl(x, y + s * 0.5, z, s * 1.08, s * 0.16, C.iron, { seg: 8 })]
}

export function sack(x: number, y: number, z: number, color = C.bloomWhite): Part {
    return ball(x, y, z, 0.1, 0.08, color, { seg: 6 })
}

export function hayBale(x: number, y: number, z: number, rotY = 0): Part[] {
    return [cyl(x, y + 0.005, z, 0.13, 0.12, C.hay, { rotZ: Math.PI / 2, rotY, seg: 10 }), cyl(x, y + 0.055, z, 0.135, 0.02, C.woodLight, { rotZ: Math.PI / 2, rotY, seg: 10 })]
}

export function lantern(x: number, z: number, y = 0): Part[] {
    return [cyl(x, y, z, 0.022, 0.24, C.iron, { seg: 6 }), box(x, y + 0.24, z, 0.05, 0.06, 0.05, C.lit, { emissive: C.litGlow }), { shape: 'pyramid', x, y: y + 0.3, z, w: 0.075, h: 0.035, d: 0.075, color: C.iron }]
}

export function planter(x: number, y: number, z: number, w = 0.14, bloom = C.bloomPink): Part[] {
    return [box(x, y, z, w, 0.04, 0.05, C.terracotta), ...[-1, 0, 1].map(i => ball(x + i * w * 0.3, y + 0.03, z, 0.05, 0.045, i ? C.leaf : bloom, { seg: 5 }))]
}

export function bush(x: number, z: number, s = 0.14, color = C.leaf, y = 0): Part[] {
    return [ball(x, y, z, s, s * 0.8, color, { seg: 6 }), ball(x + s * 0.3, y, z + s * 0.2, s * 0.7, s * 0.6, shade(color, 0.05), { seg: 6 })]
}

export function flowerBed(x: number, z: number, w: number, d: number, y = 0.02): Part[] {
    const blooms = [C.bloomPink, C.bloomYellow, C.bloomWhite]
    const n = Math.max(2, Math.round(w / 0.07))
    return [box(x, y, z, w, 0.025, d, C.soilDark), ...Array.from({ length: n }, (_, i) => ball(x - w / 2 + (i + 0.5) * w / n, y + 0.02, z + (i % 2 ? 0.25 : -0.25) * d, 0.05, 0.045, blooms[i % 3]!, { seg: 5 }))]
}

/** Blobby broadleaf: a few overlapping crowns, lighter toward the sun. */
export function roundTree(x: number, z: number, s = 1, color = C.leaf, y = 0): Part[] {
    return [
        cyl(x, y, z, 0.05 * s, 0.2 * s, C.woodDark, { seg: 6 }),
        ball(x, y + 0.13 * s, z, 0.3 * s, 0.26 * s, shade(color, -0.05), { seg: 7 }),
        ball(x + 0.06 * s, y + 0.24 * s, z + 0.03 * s, 0.24 * s, 0.22 * s, color, { seg: 7 }),
        ball(x - 0.05 * s, y + 0.32 * s, z - 0.03 * s, 0.17 * s, 0.16 * s, shade(color, 0.07), { seg: 6 })
    ]
}

export function pineTree(x: number, z: number, s = 1, y = 0): Part[] {
    return [
        cyl(x, y, z, 0.05 * s, 0.14 * s, C.woodDark, { seg: 6 }),
        cone(x, y + 0.1 * s, z, 0.3 * s, 0.26 * s, C.pine, { seg: 7 }),
        cone(x, y + 0.25 * s, z, 0.23 * s, 0.24 * s, C.pineLight, { seg: 7 }),
        cone(x, y + 0.4 * s, z, 0.15 * s, 0.22 * s, shade(C.pineLight, 0.05), { seg: 7 })
    ]
}

/** Post-and-rail fence from (x0,z0) to (x1,z1), axis-aligned. */
export function fence(x0: number, z0: number, x1: number, z1: number, color = C.woodLight, y = 0.02): Part[] {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0)
    const posts = Math.max(2, Math.round(len / 0.16) + 1)
    return [
        ...[0.05, 0.1].map(dy => box((x0 + x1) / 2, y + dy, (z0 + z1) / 2, along ? len : 0.015, 0.016, along ? 0.015 : len, color)),
        ...Array.from({ length: posts }, (_, i) => box(x0 + (x1 - x0) * i / (posts - 1), y, z0 + (z1 - z0) * i / (posts - 1), 0.025, 0.14, 0.025, color))
    ]
}

/** Stack of logs lying along x. */
export function logPile(x: number, z: number, len = 0.34, rows = 2, y = 0.02): Part[] {
    const parts: Part[] = []
    for (let row = 0; row < rows; row++) {
        for (let i = 0; i < rows - row + 1; i++) {
            const lz = z + (i - (rows - row) / 2) * 0.075
            parts.push(cyl(x, y + row * 0.065 - len / 2 + 0.0375, lz, 0.075, len, row % 2 ? C.wood : shade(C.wood, -0.06), { rotZ: Math.PI / 2, seg: 7 }))
            parts.push(cyl(x + len / 2, y + row * 0.065 + 0.0375 - 0.003, lz, 0.055, 0.006, C.woodLight, { rotZ: Math.PI / 2, seg: 7 }))
        }
    }
    return parts
}

export function plankStack(x: number, z: number, w = 0.3, layers = 3, y = 0.02, rotY = 0): Part[] {
    return Array.from({ length: layers }, (_, i) => box(x, y + i * 0.035, z, w, 0.03, 0.12, i % 2 ? C.plank : C.woodLight, { rotY }))
}

export function rock(x: number, y: number, z: number, w: number, h: number, d: number, color = C.rock, rotY = 0): Part {
    return { shape: 'sphere', x, y, z, w, h, d, color, seg: 5, rotY }
}

export function silo(x: number, z: number, w: number, h: number, body = C.metalLight, cap = C.roofRed, y = 0.02): Part[] {
    return [
        cyl(x, y, z, w, h, body, { seg: 10 }),
        ...[0.3, 0.65].map(t => cyl(x, y + h * t, z, w + 0.012, 0.015, shade(body, -0.12), { seg: 10 })),
        ...coneRoof(x, y + h, z, w + 0.03, w * 0.45, cap)
    ]
}

export function crystal(x: number, y: number, z: number, w: number, h: number, color = C.violet, tilt = 0): Part {
    return { shape: 'crystal', x, y, z, w, h, d: w, color, seg: 6, rotZ: tilt, rotY: 0.2, emissive: color === C.teal ? 0x0d3a33 : 0x2a1045 }
}

export function flag(x: number, y: number, z: number, color: number, h = 0.2): Part[] {
    return [cyl(x, y, z, 0.014, h, C.gold, { seg: 5 }), box(x + 0.05, y + h - 0.07, z, 0.09, 0.06, 0.01, color), ball(x, y + h, z, 0.03, 0.03, C.gold, { seg: 5 })]
}

/** Round corner tower with a stepped pointed cap, the kind that made the old skyline. */
export function turret(x: number, y: number, z: number, w: number, h: number, wall: number, cap: number, trim = C.trim): Part[] {
    return [
        cyl(x, y, z, w, h, wall, { seg: 10 }),
        cyl(x, y + h - 0.03, z, w + 0.04, 0.03, trim, { seg: 10 }),
        ...[0.35, 0.7].map(t => box(x, y + h * t, z + w / 2 - 0.005, 0.06, 0.09, 0.02, C.lit, { emissive: C.litGlow })),
        ...coneRoof(x, y + h, z, w + 0.06, w * 1.2, cap, 10),
        ball(x, y + h + w * 1.2, z, 0.035, 0.05, C.gold, { seg: 5 })
    ]
}

/** Gabled dormer poking out of a roof slope that faces +z. */
export function dormer(x: number, y: number, z: number, wall: number, roof: number, w = 0.16): Part[] {
    return [
        box(x, y, z, w, 0.14, 0.2, wall),
        box(x, y + 0.03, z + 0.1, w * 0.5, 0.08, 0.012, C.lit, { emissive: C.litGlow }),
        box(x, y + 0.015, z + 0.1, w * 0.5 + 0.03, 0.11, 0.008, C.trim),
        ...gableRoof(x, y + 0.14, z, w + 0.05, 0.24, 0.09, roof, 'z', wall)
    ]
}

export function weathervane(x: number, y: number, z: number, h = 0.16): Part[] {
    return [cyl(x, y, z, 0.012, h, C.iron, { seg: 5 }), box(x, y + h - 0.03, z, 0.12, 0.012, 0.012, C.iron), box(x + 0.045, y + h - 0.01, z, 0.04, 0.035, 0.008, C.gold), ball(x, y + h, z, 0.025, 0.025, C.gold, { seg: 5 })]
}

export function column(x: number, y: number, z: number, h: number, color = C.white, cap = C.stoneLight): Part[] {
    return [box(x, y, z, 0.075, 0.025, 0.075, cap), cyl(x, y + 0.025, z, 0.05, h - 0.05, color, { seg: 8 }), box(x, y + h - 0.025, z, 0.08, 0.025, 0.08, cap)]
}
