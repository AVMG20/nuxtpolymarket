// Polytown — extraction sites. Each one owns its whole tile and keeps its
// identity at every stage: a farm is always a golden field, a lumber camp a
// stand of pines, a quarry a stone pit, a mine a spoil heap under a headframe.
// The buildings on the site climb the tier ladder like every other plot: a
// timber shed, then brick, rose stucco, white stone and finally a marble and
// gold landmark, taller at every step.

import type { TownBuildingId } from '#shared/utils/gamelogic/town'
import {
    C, ball, balcony, barrel, box, chimney, coneRoof, crate, crystal, cyl, dome, doorAt, fence, flag, gableRoof, ground, hayBale, hipRoof,
    lantern, logPile, onFace, pineTree, rock, shade, silo, tierLook, weathervane, windowAt, windowRow,
    type ModelSpec, type Part
} from './kit'

type Factory = (stage: number, variant: number) => ModelSpec

// ─── Shared pieces ───────────────────────────────────────────────────────────

/** Odd tiles get the mirror image, so neighbouring sites don't repeat. Colours never change. */
function mirrorX(spec: ModelSpec): ModelSpec {
    const flip = (p: Part): Part => ({ ...p, x: -p.x, rotY: p.rotY && -p.rotY, rotZ: p.rotZ && -p.rotZ, faceY: p.faceY && -p.faceY })
    return {
        parts: spec.parts.map(flip),
        spinners: spec.spinners?.map(s => ({ ...s, pivot: [-s.pivot[0], s.pivot[1], s.pivot[2]], parts: s.parts.map(flip) })),
        smoke: spec.smoke?.map(([x, y, z]) => [-x, y, z])
    }
}

function vane(x: number, y: number, z: number, stage: number, h = 0.14): Part[] {
    if (stage < 4) return weathervane(x, y, z, h)
    const gold = tierLook(stage).metal
    return [cyl(x, y, z, 0.014, h, gold, { seg: 5 }), box(x, y + h - 0.03, z, 0.13, 0.014, 0.014, gold), box(x + 0.05, y + h - 0.012, z, 0.045, 0.04, 0.01, gold), ball(x, y + h, z, 0.03, 0.03, gold, { seg: 5 })]
}

interface HallOptions { y?: number, wall?: number, roofH?: number, ridge?: 'x' | 'z', hip?: boolean }

/**
 * A walled block in the look's colours under its tier roof: planked at L1,
 * a trim cornice from L10, dressed corner stones from L15. Returns the eave.
 */
function hall(parts: Part[], stage: number, x: number, z: number, w: number, d: number, h: number, o: HallOptions = {}): number {
    const look = tierLook(stage)
    const y = o.y ?? 0.03
    const wall = o.wall ?? look.wall
    const top = y + h
    parts.push(box(x, y, z, w, h, d, wall), box(x, y, z, w + 0.02, 0.045, d + 0.02, stage >= 3 ? shade(look.wall, -0.12) : C.stone))
    if (stage === 0) for (let yy = y + 0.1; yy < top - 0.03; yy += 0.07) parts.push(box(x, yy, z, w + 0.008, 0.012, d + 0.008, shade(wall, -0.14)))
    if (stage >= 2) parts.push(box(x, top - 0.03, z, w + 0.025, 0.03, d + 0.025, look.trim))
    if (stage >= 3) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            for (let yy = y + 0.07; yy < top - 0.08; yy += 0.1) parts.push(box(x + sx * w / 2, yy, z + sz * d / 2, 0.05, 0.05, 0.05, look.trim))
        }
    }
    const roofH = o.roofH ?? 0.16
    parts.push(...(o.hip ? hipRoof(x, top, z, w + 0.05, d + 0.05, roofH, look.roof, 0.06) : gableRoof(x, top, z, w + 0.04, d + 0.04, roofH, look.roof, o.ridge ?? 'x', wall)))
    return top
}

/** Hanging banners in the look's colour, authored against a front wall. */
function banners(xs: number[], y: number, stage: number, h = 0.16): Part[] {
    const look = tierLook(stage)
    return xs.flatMap(x => [box(x, y + h, 0.012, 0.08, 0.02, 0.02, look.metal), box(x, y, 0.01, 0.06, h, 0.012, look.banner), box(x, y - 0.025, 0.01, 0.03, 0.025, 0.012, look.banner)])
}

/** Big plank doors with an X brace: barns, sheds, winding houses. */
function barnDoor(y: number, w: number, h: number, frame: number, fill: number): Part[] {
    const a = Math.atan2(h - 0.04, w - 0.04)
    const len = Math.hypot(w - 0.04, h - 0.04) - 0.01
    return [
        box(0, y, 0.004, w, h, 0.012, frame), box(0, y + 0.015, 0.008, w - 0.03, h - 0.03, 0.012, fill),
        box(0, y + h / 2 - 0.006, 0.016, len, 0.012, 0.008, frame, { rotZ: a }), box(0, y + h / 2 - 0.006, 0.016, len, 0.012, 0.008, frame, { rotZ: -a })
    ]
}

/**
 * Square tower whose crown carries the tier: a hipped cap, a weathervane, a
 * banner, a teal dome over a balustrade, then a lit belfry under a gold spire
 * (or, for the jewel mine, a glowing crystal). Returns the very top.
 */
function tower(spec: ModelSpec, stage: number, x: number, z: number, w: number, h: number, crown: 'spire' | 'crystal' = 'spire'): number {
    const look = tierLook(stage)
    const parts = spec.parts
    const y = 0.03
    const top = y + h
    const wall = stage === 0 ? C.wood : stage === 1 ? look.wall2 : look.wall
    parts.push(box(x, y, z, w, h, w, wall), box(x, y, z, w + 0.03, 0.06, w + 0.03, stage >= 3 ? shade(look.wall, -0.12) : C.stone))
    if (stage >= 3) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            for (let yy = y + 0.08; yy < top - 0.08; yy += 0.1) parts.push(box(x + sx * w / 2, yy, z + sz * w / 2, 0.05, 0.05, 0.05, look.trim))
        }
    } else {
        for (let yy = y + 0.2; yy < top - 0.1; yy += 0.2) parts.push(box(x, yy, z, w + 0.016, 0.02, w + 0.016, look.trim))
    }
    for (let yy = y + 0.1; yy < top - (stage === 4 ? 0.34 : 0.14); yy += 0.2) {
        for (const face of ['front', 'back', 'left', 'right'] as const) parts.push(...onFace(face, w, w, windowAt(0, yy + 0.02, 0.055, 0.09, { lit: stage >= 3 || face === 'front', sill: false }), x, z))
    }
    if (stage <= 2) {
        if (stage === 2) parts.push(box(x, top - 0.03, z, w + 0.04, 0.03, w + 0.04, look.trim))
        const rh = [0.1, 0.14, 0.2][stage]!
        parts.push(...hipRoof(x, top, z, w + 0.08, w + 0.08, rh, look.roof, 0.04))
        if (stage === 1) parts.push(...vane(x, top + rh, z, stage))
        if (stage === 2) parts.push(...flag(x, top + rh, z, look.banner, 0.16))
        return top + rh + (stage === 1 ? 0.14 : stage === 2 ? 0.16 : 0)
    }
    parts.push(box(x, top - 0.03, z, w + 0.05, 0.05, w + 0.05, look.trim))
    if (stage === 3) {
        // Balustraded deck under a teal dome.
        const r = w / 2 + 0.01
        for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) if (sx || sz) parts.push(box(x + sx * r, top + 0.02, z + sz * r, 0.022, 0.07, 0.022, look.trim))
        parts.push(box(x, top + 0.09, z + r, 2 * r + 0.02, 0.016, 0.02, look.trim), box(x, top + 0.09, z - r, 2 * r + 0.02, 0.016, 0.02, look.trim), box(x + r, top + 0.09, z, 0.02, 0.016, 2 * r, look.trim), box(x - r, top + 0.09, z, 0.02, 0.016, 2 * r, look.trim))
        parts.push(dome(x, top + 0.02, z, w * 0.72, 0.17, C.accent, { seg: 10 }), ball(x, top + 0.18, z, 0.04, 0.05, look.metal, { seg: 5 }))
        return top + 0.23
    }
    // Lit belfry: marble piers round a glowing lantern room.
    const ly = top + 0.02
    const lh = 0.13
    const p = w / 2 - 0.02
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(x + sx * p, ly, z + sz * p, 0.045, lh, 0.045, look.wall))
    parts.push(box(x, ly, z, w - 0.06, lh, w - 0.06, C.lit, { emissive: C.litGlow }), box(x, ly + lh, z, w + 0.06, 0.03, w + 0.06, look.trim))
    for (const face of ['front', 'right', 'back', 'left'] as const) parts.push(...onFace(face, w, w, banners([0], top - 0.24, stage, 0.18), x, z))
    const cap = ly + lh + 0.03
    if (crown === 'crystal') {
        parts.push(cyl(x, cap, z, w * 0.8, 0.05, look.trim, { seg: 8 }), crystal(x, cap + 0.03, z, 0.15, 0.36, C.lilac), crystal(x - 0.05, cap + 0.03, z + 0.03, 0.08, 0.2, C.teal, 0.35), crystal(x + 0.05, cap + 0.03, z - 0.02, 0.08, 0.22, C.violet, -0.35))
        return cap + 0.39
    }
    parts.push(...hipRoof(x, cap, z, w + 0.02, w + 0.02, 0.3, look.roof, 0.024), cyl(x, cap + 0.3, z, 0.014, 0.05, look.metal, { seg: 5 }), ball(x, cap + 0.34, z, 0.045, 0.05, look.metal, { seg: 6 }))
    return cap + 0.39
}

// ─── Farm ────────────────────────────────────────────────────────────────────

/** Wheat in rows; rows behind `yardZ` only grow from `yardX` on, clear of the yard. */
function wheatField(parts: Part[], yardX: number, yardZ: number) {
    for (let row = 0; row < 9; row++) {
        const z = -0.44 + row * 0.11
        const from = z < yardZ ? yardX : -0.48
        if (from > 0.4) continue
        const len = 0.48 - from
        const h = 0.12 + (row % 3) * 0.012
        parts.push(box(from + len / 2, 0.03, z, len, h, 0.082, row % 2 ? shade(C.wheat, -0.05) : C.wheat), box(from + len / 2, 0.03 + h, z, len, 0.025, 0.06, shade(C.wheat, 0.08)))
    }
}

function windpump(spec: ModelSpec, x: number, z: number, h: number, metal: number) {
    const parts = spec.parts
    for (const dx of [-0.04, 0.04]) for (const dz of [-0.04, 0.04]) parts.push(box(x + dx, 0.03, z + dz, 0.02, h, 0.02, metal))
    for (let y = 0.15; y < h; y += 0.15) parts.push(box(x, y, z + 0.04, 0.1, 0.014, 0.014, metal), box(x, y, z - 0.04, 0.1, 0.014, 0.014, metal))
    parts.push(box(x, 0.03 + h, z, 0.11, 0.02, 0.11, metal), box(x, 0.05 + h, z, 0.05, 0.05, 0.1, C.metal), box(x, 0.05 + h, z - 0.1, 0.01, 0.07, 0.1, C.bloomWhite))
    const pivot: [number, number, number] = [x, 0.075 + h, z + 0.06]
    const blades: Part[] = [cyl(pivot[0], pivot[1] - 0.01, pivot[2], 0.04, 0.02, C.metal, { rotX: Math.PI / 2, seg: 8 })]
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4
        blades.push(box(pivot[0] - Math.sin(a) * 0.05, pivot[1] + Math.cos(a) * 0.05 - 0.05, pivot[2], 0.03, 0.1, 0.006, i % 2 ? C.bloomWhite : C.metalLight, { rotZ: a }))
    }
    ;(spec.spinners ??= []).push({ pivot, axis: 'z', rate: 2.4, parts: blades })
}

function scarecrow(x: number, z: number, coat: number): Part[] {
    return [box(x, 0.03, z, 0.02, 0.3, 0.02, C.woodDark), box(x, 0.22, z, 0.2, 0.02, 0.02, C.woodDark), box(x, 0.15, z, 0.08, 0.1, 0.05, coat), ball(x, 0.26, z, 0.07, 0.07, C.hay, { seg: 6 }), { shape: 'cone', x, y: 0.31, z, w: 0.1, h: 0.06, d: 0.1, color: C.woodDark, seg: 8 }]
}

const farm: Factory = (stage, variant) => {
    const look = tierLook(stage)
    const spec: ModelSpec = { parts: [ground(C.soil, 0.03)], spinners: [] }
    const parts = spec.parts
    wheatField(parts, [-0.1, 0.5, 0.5, 0.5, 0.5][stage]!, [-0.16, -0.06, -0.02, 0.02, 0.02][stage]!)
    if (stage === 0) {
        // A plank shed at the corner of the field.
        hall(parts, 0, -0.29, -0.33, 0.32, 0.26, 0.24, { wall: C.wood, roofH: 0.14 })
        parts.push(...onFace('front', 0.32, 0.26, [...doorAt(0.06, 0.1, 0.16, look.paint, false), ...windowAt(-0.08, 0.13, 0.06, 0.07, { shutters: look.paint, sill: false })], -0.29, -0.33))
        parts.push(...scarecrow(0.14, 0.06, look.paint), ...barrel(-0.44, 0.03, -0.12, 0.08))
    }
    if (stage === 1) {
        // Brick barn with a silo and a lean-to.
        hall(parts, 1, -0.22, -0.29, 0.44, 0.34, 0.28, { wall: look.wall2, ridge: 'z', roofH: 0.2 })
        parts.push(...onFace('front', 0.44, 0.34, [...barnDoor(0.03, 0.2, 0.2, look.trim, shade(look.wall2, -0.15)), box(0, 0.25, 0.004, 0.08, 0.05, 0.012, look.trim)], -0.22, -0.29))
        parts.push(...vane(-0.22, 0.51, -0.29, stage, 0.11), ...silo(0.1, -0.36, 0.17, 0.44, C.metalLight, look.roof, 0.03))
        hall(parts, 1, 0.36, -0.37, 0.24, 0.2, 0.18, { roofH: 0.1 })
        parts.push(...onFace('front', 0.24, 0.2, doorAt(0.04, 0.08, 0.13, look.paint, false), 0.36, -0.37), ...lantern(0.03, -0.1), ...hayBale(0.34, 0.03, -0.17))
    }
    if (stage === 2) {
        // Big rose barn, twin silos and a windpump.
        hall(parts, 2, -0.2, -0.27, 0.54, 0.42, 0.34, { ridge: 'z', roofH: 0.24 })
        parts.push(...onFace('front', 0.54, 0.42, [...barnDoor(0.03, 0.22, 0.24, look.trim, look.paint), ...barnDoor(0.3, 0.09, 0.06, look.trim, look.paint), ...banners([-0.19, 0.19], 0.12, stage)], -0.2, -0.27))
        parts.push(...silo(0.17, -0.38, 0.15, 0.52, C.metalLight, look.roof, 0.03), ...silo(0.33, -0.38, 0.15, 0.6, C.metalLight, look.roof, 0.03))
        windpump(spec, 0.4, -0.14, 0.58, C.metalLight)
        parts.push(...hayBale(0.2, 0.17, 0.41, 0.3), ...hayBale(0.36, 0.17, 0.41), ...fence(-0.48, 0.485, 0.48, 0.485))
    }
    if (stage >= 3) {
        const grand = stage === 4
        // White-stone (then marble) barn with the field running up to it.
        const bx = grand ? -0.25 : -0.26
        const bw = grand ? 0.46 : 0.44
        const bh = grand ? 0.42 : 0.36
        hall(parts, stage, bx, -0.24, bw, 0.46, bh, { ridge: 'z', roofH: grand ? 0.28 : 0.26 })
        parts.push(...onFace('front', bw, 0.46, [
            ...barnDoor(0.03, 0.22, 0.26, look.trim, look.paint),
            ...windowRow(0.36, 0.33, 2, { w: 0.06, h: 0.09, lit: 0, frame: look.trim }),
            ...(grand ? banners([-0.16, 0.16], 0.1, stage, 0.18) : [])
        ], bx, -0.24))
        const eave = 0.03 + bh
        if (grand) {
            // Lit cupola on the ridge under a gold cap.
            parts.push(box(bx, eave + 0.2, -0.24, 0.12, 0.12, 0.12, look.wall), box(bx, eave + 0.24, -0.24, 0.13, 0.05, 0.06, C.lit, { emissive: C.litGlow }), box(bx, eave + 0.24, -0.24, 0.06, 0.05, 0.13, C.lit, { emissive: C.litGlow }))
            parts.push(...hipRoof(bx, eave + 0.32, -0.24, 0.17, 0.17, 0.08, look.roof, 0.03), ...vane(bx, eave + 0.4, -0.24, stage))
            // Silo tower: marble drum, gold bands, a lit lantern ring and a gold cone.
            const tx = 0.33
            const tz = -0.3
            parts.push(cyl(tx, 0.03, tz, 0.24, 0.6, look.wall, { seg: 12 }), ...[0.2, 0.4].map(t => cyl(tx, 0.03 + t, tz, 0.252, 0.025, look.trim, { seg: 12 })))
            parts.push(cyl(tx, 0.63, tz, 0.26, 0.02, look.trim, { seg: 12 }), cyl(tx, 0.65, tz, 0.2, 0.08, C.lit, { emissive: C.litGlow, seg: 12 }), cyl(tx, 0.73, tz, 0.28, 0.03, look.trim, { seg: 12 }))
            parts.push(...coneRoof(tx, 0.76, tz, 0.28, 0.22, look.roof, 12), ball(tx, 0.98, tz, 0.05, 0.06, look.metal, { seg: 6 }))
            parts.push(...onFace('front', 0.24, 0.24, banners([0], 0.36, stage, 0.18), tx, tz))
            parts.push(...silo(0.085, -0.36, 0.14, 0.56, look.wall2, C.accent, 0.03))
            parts.push(...lantern(0.04, 0.02), ...lantern(0.46, -0.1), ...fence(-0.48, 0.485, 0.48, 0.485, look.metal))
        } else {
            // Farmhouse with lit windows and a balcony, teal-capped silos between.
            const fx = 0.31
            const fz = -0.28
            hall(parts, stage, fx, fz, 0.34, 0.34, 0.46, { hip: true })
            parts.push(...onFace('front', 0.34, 0.34, [...doorAt(0, 0.1, 0.18, look.paint, true), ...windowRow(0.3, 0.08, 2, { w: 0.06, h: 0.09, lit: 1, frame: look.trim }).map(p => ({ ...p, x: p.x * 1.4 })), ...windowRow(0.3, 0.32, 2, { w: 0.07, h: 0.1, lit: 0, frame: look.trim }), ...balcony(0, 0.29, 0.26, look.metal)], fx, fz))
            chimney(spec, fx + 0.09, 0.49, fz - 0.08, 0.14, C.stoneLight)
            parts.push(...silo(0.05, -0.4, 0.14, 0.78, look.wall2, C.accent, 0.03), ...silo(0.05, -0.22, 0.14, 0.6, look.wall2, C.accent, 0.03))
            parts.push(...lantern(-0.02, 0.03), ...fence(-0.48, 0.485, 0.48, 0.485, look.trim))
        }
    }
    return variant % 2 ? mirrorX(spec) : spec
}

// ─── Lumber camp ─────────────────────────────────────────────────────────────

const PINES: [number, number, number][] = [
    [-0.35, -0.36, 1], [-0.13, -0.38, 0.9], [0.09, -0.37, 0.95], [0.33, -0.38, 0.85], [-0.37, -0.13, 0.95],
    [-0.16, -0.15, 0.85], [0.06, -0.2, 0.8], [-0.38, 0.12, 0.85], [-0.17, 0.08, 0.75]
]

function sawpit(parts: Part[], x: number, z: number, stage: number) {
    parts.push(box(x, 0.02, z, 0.26, 0.006, 0.14, C.soilDark, { flat: true }), ball(x + 0.1, 0.02, z + 0.05, 0.1, 0.04, C.woodLight, { seg: 6 }))
    for (const dx of [-0.08, 0.08]) parts.push(box(x + dx, 0.02, z, 0.025, 0.11, 0.025, C.woodDark, { rotZ: 0.35 }), box(x + dx, 0.02, z, 0.025, 0.11, 0.025, C.woodDark, { rotZ: -0.35 }))
    parts.push(cyl(x, 0.02, z, 0.06, 0.24, C.wood, { rotZ: Math.PI / 2, seg: 7 }))
    if (stage >= 2) {
        // An open shelter over the pit.
        for (const dx of [-0.13, 0.13]) for (const dz of [-0.07, 0.07]) parts.push(box(x + dx, 0.02, z + dz, 0.025, 0.22, 0.025, C.woodDark))
        parts.push(...gableRoof(x, 0.24, z, 0.32, 0.2, 0.08, tierLook(stage).roof, 'x'))
    }
}

const lumber: Factory = (stage, variant) => {
    const look = tierLook(stage)
    const spec: ModelSpec = { parts: [ground(0x5d8244)] }
    const parts = spec.parts
    // Where the camp's lodge stands, so the pines keep clear of it.
    const lot = [
        { x: 0.24, z: -0.14, w: 0.34, d: 0.26, h: 0.2 },
        { x: 0.22, z: -0.06, w: 0.4, d: 0.3, h: 0.26 },
        { x: 0.2, z: -0.02, w: 0.44, d: 0.32, h: 0.3 },
        { x: 0.2, z: -0.02, w: 0.46, d: 0.34, h: 0.36 },
        { x: 0.19, z: -0.01, w: 0.5, d: 0.36, h: 0.4 }
    ][stage]!
    const clear = (px: number, pz: number, r: number) => {
        const areas = [[lot.x - lot.w / 2 - 0.03, lot.z - lot.d / 2 - 0.03, lot.x + lot.w / 2 + 0.03, lot.z + lot.d / 2 + 0.03]]
        if (stage >= 1) areas.push([0.24, -0.5, 0.5, -0.22])
        return areas.every(([x0, z0, x1, z1]) => px + r < x0! || px - r > x1! || pz + r < z0! || pz - r > z1!)
    }
    for (const [x, z, s] of PINES) if (clear(x, z, 0.15 * s)) parts.push(...pineTree(x, z, s, 0.02))
    // Felled ground at the front: stumps, chips and the stacked timber.
    for (const [x, z] of [[0.42, 0.4], [-0.44, 0.44], [-0.02, 0.24]] as const) parts.push(cyl(x, 0.02, z, 0.08, 0.05, C.wood, { seg: 7 }), cyl(x, 0.07, z, 0.06, 0.006, C.woodLight, { seg: 7 }))
    parts.push(...logPile(0.14, 0.38, 0.34, Math.min(3, 1 + stage)))
    if (stage >= 1) sawpit(parts, -0.26, 0.34, stage)

    // The lodge: a log cabin, then brick, rose stucco, white stone and marble.
    const walls = stage === 0 ? C.wood : stage === 1 ? look.wall2 : look.wall
    const eave = hall(parts, stage, lot.x, lot.z, lot.w, lot.d, lot.h, { wall: walls, roofH: [0.13, 0.15, 0.18, 0.16, 0.24][stage]!, hip: stage === 3 })
    const face: Part[] = [...doorAt(-lot.w * 0.22, 0.1, Math.min(0.2, lot.h * 0.7), look.paint, true)]
    face.push(...windowRow(lot.w * 0.5, 0.1, stage >= 2 ? 2 : 1, { w: 0.07, h: 0.08, lit: stage >= 3 ? 0 : 1, shutters: stage < 3 ? look.paint : undefined, frame: stage >= 3 ? look.trim : undefined }).map(p => ({ ...p, x: p.x + lot.w * 0.18 })))
    if (stage >= 2) face.push(...windowRow(lot.w * 0.8, lot.h * 0.62 + 0.03, 3, { w: 0.06, h: 0.08, lit: stage >= 3 ? 0 : 1, frame: look.trim }), ...balcony(lot.w * 0.18, lot.h * 0.55 + 0.03, lot.w * 0.5, look.metal))
    if (stage === 4) face.push(...banners([-lot.w * 0.4, lot.w * 0.4], 0.12, stage, 0.2))
    parts.push(...onFace('front', lot.w, lot.d, face, lot.x, lot.z))
    chimney(spec, lot.x + lot.w / 2 - 0.08, eave, lot.z - 0.05, 0.16 + stage * 0.02, stage >= 3 ? C.stoneLight : C.stone)
    if (stage === 1) parts.push(...vane(lot.x - 0.06, eave + 0.15, lot.z, stage))

    if (stage === 1) {
        // Timber lookout over the stand.
        const x = 0.36
        const z = -0.36
        for (const dx of [-0.08, 0.08]) for (const dz of [-0.08, 0.08]) parts.push(box(x + dx, 0.02, z + dz, 0.03, 0.58, 0.03, C.woodDark))
        for (const y of [0.16, 0.3]) parts.push(box(x, y, z + 0.08, 0.19, 0.02, 0.02, C.wood), box(x, y, z - 0.08, 0.19, 0.02, 0.02, C.wood), box(x + 0.08, y, z, 0.02, 0.02, 0.19, C.wood), box(x - 0.08, y, z, 0.02, 0.02, 0.19, C.wood))
        parts.push(box(x, 0.42, z, 0.24, 0.03, 0.24, C.plank), box(x, 0.5, z + 0.11, 0.24, 0.018, 0.018, C.wood), box(x, 0.5, z - 0.11, 0.24, 0.018, 0.018, C.wood), box(x + 0.11, 0.5, z, 0.018, 0.018, 0.24, C.wood), box(x - 0.11, 0.5, z, 0.018, 0.018, 0.24, C.wood))
        parts.push(...hipRoof(x, 0.6, z, 0.28, 0.28, 0.1, look.roof, 0.04), ...lantern(0.02, 0.18))
    }
    if (stage >= 2) {
        tower(spec, stage, 0.36, -0.34, stage === 4 ? 0.22 : 0.2, [0, 0, 0.5, 0.72, 0.74][stage]!)
        parts.push(...lantern(-0.06, 0.2))
        if (stage >= 3) parts.push(...lantern(0.46, 0.22))
    }
    if (stage >= 4) parts.push(...crate(0.3, 0.02, 0.26), ...barrel(0.42, 0.02, 0.26))
    return variant % 2 ? mirrorX(spec) : spec
}

// ─── Quarry ──────────────────────────────────────────────────────────────────

function derrick(spec: ModelSpec, stage: number, x: number, z: number, mastH: number) {
    const look = tierLook(stage)
    const parts = spec.parts
    const steel = stage >= 3
    const beam = steel ? look.metal : C.woodDark
    const base = stage >= 2 ? 0.2 : 0.06
    parts.push(box(x, 0.03, z, stage >= 2 ? 0.16 : 0.12, base - 0.03, stage >= 2 ? 0.16 : 0.12, stage >= 2 ? (stage >= 3 ? look.wall : C.stone) : C.wood))
    const top = base + mastH
    parts.push(box(x, base, z, 0.04, mastH, 0.04, beam))
    if (steel) for (let y = base + 0.08; y < top - 0.04; y += 0.12) parts.push(box(x, y, z, 0.06, 0.012, 0.06, shade(beam, -0.15)))
    // The jib reaches out over the pit and a block hangs from it.
    const reach = 0.34 + stage * 0.02
    const tilt = 0.28
    const jibY = top - 0.06
    parts.push(box(x, jibY, z + reach / 2 - 0.03, 0.035, 0.035, reach, beam, { rotX: -tilt }), box(x, top, z, 0.07, 0.03, 0.07, beam))
    const tipZ = z + (reach - 0.03) * Math.cos(tilt) - 0.02
    const tipY = jibY + 0.0175 + (reach / 2 - 0.03) * Math.sin(tilt)
    parts.push(box(x, 0.18, tipZ, 0.008, tipY - 0.18, 0.008, C.iron), box(x, 0.11, tipZ, 0.1, 0.07, 0.1, C.stoneLight))
    if (stage >= 2) {
        const pivot: [number, number, number] = [x + 0.1, 0.13, z]
        ;(spec.spinners ??= []).push({ pivot, axis: 'x', rate: 1.2, parts: [cyl(pivot[0], pivot[1] - 0.01, pivot[2], 0.18, 0.02, C.wood, { rotZ: Math.PI / 2, seg: 10 }), ...[0, 1].map(k => box(pivot[0], pivot[1] - 0.085, pivot[2], 0.02, 0.17, 0.014, C.woodDark, { rotX: k * Math.PI / 2 }))] })
        parts.push(box(x + 0.07, 0.03, z, 0.05, 0.1, 0.03, C.woodDark), cyl(x + 0.05, 0.12, z, 0.1, 0.014, C.iron, { rotZ: Math.PI / 2, seg: 6 }))
    }
    if (stage === 2) parts.push(...flag(x, top + 0.03, z, look.banner, 0.14))
    if (stage >= 3) parts.push(ball(x, top + 0.03, z, 0.05, 0.05, look.metal, { seg: 6 }))
}

const quarry: Factory = (stage, variant) => {
    const look = tierLook(stage)
    const spec: ModelSpec = { parts: [ground(0x8a8478, 0.03)], spinners: [] }
    const parts = spec.parts
    const tone = C.stone
    // Benches step down from the back and the right into an open pit.
    parts.push(box(0.2, 0.03, -0.39, 0.6, 0.26, 0.22, tone), box(0.25, 0.03, -0.22, 0.5, 0.15, 0.12, shade(tone, 0.05)), box(0.42, 0.03, 0.06, 0.16, 0.2, 0.44, shade(tone, -0.03)), box(0.3, 0.03, 0.04, 0.08, 0.09, 0.4, shade(tone, 0.06)))
    // Pale dust on the pit floor.
    parts.push(box(0.12, 0.03, 0.08, 0.36, 0.006, 0.42, shade(C.stoneLight, -0.04), { flat: true }))
    for (const y of [0.1, 0.17, 0.23]) parts.push(box(0.2, y, -0.277, 0.58, 0.01, 0.008, shade(tone, -0.12)))
    for (const y of [0.1, 0.16]) parts.push(box(0.338, y, 0.06, 0.008, 0.01, 0.42, shade(tone, -0.12)))
    parts.push(rock(0.36, 0.24, -0.42, 0.22, 0.12, 0.16, C.rockLight, 1.2), rock(0.44, 0.19, 0.2, 0.12, 0.09, 0.12, C.rockLight, 0.3), rock(0.12, 0.15, -0.22, 0.1, 0.07, 0.08, C.rockLight, 0.7))
    // Dressed blocks waiting at the pit mouth.
    const blocks = 3 + stage * 2
    for (let i = 0; i < blocks; i++) parts.push(box(0.2 - (i % 4) * 0.12, 0.03 + Math.floor(i / 4) * 0.075, 0.41, 0.105, 0.07, 0.12, i % 2 ? C.stoneLight : C.stone))

    if (stage === 0) {
        // Lean-to against a plank wall.
        parts.push(box(-0.3, 0.03, -0.46, 0.34, 0.26, 0.04, C.wood), box(-0.3, 0.15, -0.438, 0.34, 0.012, 0.008, C.woodDark))
        for (const x of [-0.44, -0.16]) parts.push(box(x, 0.03, -0.27, 0.03, 0.2, 0.03, C.woodDark))
        parts.push(box(-0.3, 0.22, -0.36, 0.4, 0.025, 0.25, look.roof, { rotX: 0.32 }), box(-0.3, 0.03, -0.38, 0.2, 0.08, 0.1, C.woodLight), ...barrel(-0.42, 0.03, -0.14, 0.08), box(-0.12, 0.03, -0.05, 0.12, 0.08, 0.12, C.stoneLight))
        // Shear legs over the pit: two poles lashed at the top, a block on the rope.
        parts.push(box(-0.02, 0.03, 0.02, 0.03, 0.46, 0.03, C.woodDark, { rotZ: 0.2 }), box(0.14, 0.03, 0.02, 0.03, 0.46, 0.03, C.woodDark, { rotZ: -0.2 }), box(0.06, 0.44, 0.02, 0.07, 0.03, 0.04, C.wood))
        parts.push(box(0.06, 0.2, 0.02, 0.008, 0.24, 0.008, C.iron), box(0.06, 0.13, 0.02, 0.09, 0.07, 0.09, C.stoneLight))
        return variant % 2 ? mirrorX(spec) : spec
    }
    // The cutting shed at the back of the yard, grander every look.
    const shed = [{ w: 0, d: 0, h: 0 }, { w: 0.36, d: 0.28, h: 0.26 }, { w: 0.38, d: 0.3, h: 0.32 }, { w: 0.42, d: 0.34, h: 0.34 }, { w: 0.44, d: 0.34, h: 0.38 }][stage]!
    const sx = -0.49 + shed.w / 2 + 0.01
    const sz = -0.49 + shed.d / 2 + 0.01
    const eave = hall(parts, stage, sx, sz, shed.w, shed.d, shed.h, { wall: stage === 1 ? look.wall2 : look.wall, roofH: [0, 0.16, 0.2, 0.16, 0.22][stage]!, hip: stage === 3 })
    const front: Part[] = [...barnDoor(0.03, 0.14, Math.min(0.2, shed.h - 0.06), look.trim, stage >= 2 ? look.paint : C.woodDark)]
    front.push(...windowRow(0.14, 0.1, 1, { w: 0.07, h: 0.08, lit: stage >= 3 ? 0 : 1, frame: look.trim }).map(p => ({ ...p, x: p.x + shed.w * 0.3 })))
    if (stage >= 2) front.push(...windowRow(0.14, 0.1, 1, { w: 0.07, h: 0.08, lit: 0, frame: look.trim }).map(p => ({ ...p, x: p.x - shed.w * 0.3 })))
    if (stage === 2) front.push(box(0, shed.h * 0.8, 0.05, shed.w - 0.04, 0.02, 0.1, look.banner, { rotX: 0.3 }))
    if (stage === 4) front.push(...banners([-shed.w * 0.3, shed.w * 0.3], shed.h * 0.55, stage))
    parts.push(...onFace('front', shed.w, shed.d, front, sx, sz))
    if (stage === 1) parts.push(...vane(sx, eave + 0.16, sz, stage), ...lantern(-0.06, -0.22))
    derrick(spec, stage, 0.06, -0.12, [0, 0.54, 0.46, 0.72, 0.7][stage]!)
    if (stage >= 2) {
        // Tubs on a short rail from the pit floor to the yard.
        parts.push(box(0.14, 0.03, 0.12, 0.02, 0.012, 0.3, C.iron), box(0.22, 0.03, 0.12, 0.02, 0.012, 0.3, C.iron), box(0.18, 0.04, 0.12, 0.12, 0.07, 0.13, C.metal), box(0.18, 0.11, 0.12, 0.1, 0.03, 0.11, C.stoneLight))
    }
    if (stage >= 3) {
        // A monument beside the pit: a teal-domed tower, then marble and gold.
        tower(spec, stage, -0.37, 0.12, 0.2, stage === 4 ? 0.52 : 0.46)
        parts.push(...lantern(-0.2, 0.26))
    }
    return variant % 2 ? mirrorX(spec) : spec
}

// ─── Mines ───────────────────────────────────────────────────────────────────

function mound(parts: Part[], dark: number, light: number) {
    parts.push(
        rock(-0.03, -0.12, -0.14, 0.95, 0.62, 0.7, dark), rock(0.22, -0.1, -0.16, 0.5, 0.5, 0.56, light, 0.6), rock(-0.26, -0.08, -0.04, 0.42, 0.4, 0.46, light, 1.1),
        rock(0.02, 0.22, -0.26, 0.46, 0.28, 0.4, shade(light, 0.04), 0.3), rock(0.42, -0.04, -0.02, 0.18, 0.18, 0.24, dark, 0.8), rock(-0.42, -0.03, 0.14, 0.16, 0.14, 0.18, dark)
    )
}

function portal(parts: Part[], stage: number, x: number, z: number) {
    const look = tierLook(stage)
    const post = stage >= 3 ? look.wall : C.wood
    const lintel = stage >= 3 ? look.trim : C.wood
    parts.push(box(x, 0.02, z - 0.04, 0.24, 0.26, 0.1, 0x16161c), box(x - 0.13, 0.02, z, 0.06, 0.3, 0.08, post), box(x + 0.13, 0.02, z, 0.06, 0.3, 0.08, post), box(x, 0.3, z, 0.36, 0.055, 0.09, lintel))
    // Rails and an ore tub run out to the tile edge.
    for (const dx of [-0.05, 0.05]) parts.push(box(x + dx, 0.02, (z + 0.5) / 2, 0.015, 0.014, 0.5 - z, C.iron))
    for (let tz = z + 0.04; tz < 0.49; tz += 0.07) parts.push(box(x, 0.02, tz, 0.17, 0.008, 0.025, C.woodDark))
}

function headframe(spec: ModelSpec, stage: number, x: number, z: number, h: number) {
    const look = tierLook(stage)
    const leg = stage >= 3 ? look.metal : C.woodDark
    const brace = stage >= 4 ? look.wall : stage === 3 ? shade(look.metal, -0.2) : C.wood
    const parts = spec.parts
    for (const dx of [-0.1, 0.1]) for (const dz of [-0.08, 0.08]) parts.push(box(x + dx, 0.02, z + dz, 0.035, h, 0.035, leg))
    for (let y = 0.14; y < h - 0.04; y += 0.14) parts.push(box(x, y, z + 0.08, 0.23, 0.02, 0.02, brace), box(x, y, z - 0.08, 0.23, 0.02, 0.02, brace), box(x + 0.1, y + 0.07, z, 0.02, 0.02, 0.19, brace), box(x - 0.1, y + 0.07, z, 0.02, 0.02, 0.19, brace))
    const deck = 0.02 + h
    parts.push(box(x, deck, z, 0.28, 0.025, 0.22, stage >= 3 ? look.trim : C.wood))
    for (const dx of [-0.12, 0.12]) for (const dz of [-0.09, 0.09]) parts.push(box(x + dx, deck + 0.025, z + dz, 0.022, 0.13, 0.022, leg))
    const cap = deck + 0.155
    const wheels = stage >= 2 ? 2 : 1
    for (let i = 0; i < wheels; i++) {
        const pivot: [number, number, number] = [x + (wheels > 1 ? (i - 0.5) * 0.1 : 0), deck + 0.085, z]
        ;(spec.spinners ??= []).push({ pivot, axis: 'x', parts: [cyl(pivot[0], pivot[1] - 0.008, pivot[2], 0.11, 0.016, C.metal, { rotZ: Math.PI / 2, seg: 10 }), ...[0, 1].map(k => box(pivot[0], pivot[1] - 0.05, pivot[2], 0.02, 0.1, 0.014, C.metalLight, { rotX: k * Math.PI / 2 }))] })
    }
    if (stage <= 2) {
        parts.push(...hipRoof(x, cap, z, 0.32, 0.26, 0.1, look.roof, 0.06))
        if (stage === 2) parts.push(...flag(x, cap + 0.1, z, look.banner, 0.16))
    } else if (stage === 3) {
        parts.push(...hipRoof(x, cap, z, 0.32, 0.26, 0.08, look.roof, 0.14), dome(x, cap + 0.08, z, 0.14, 0.1, C.accent, { seg: 10 }), ball(x, cap + 0.17, z, 0.035, 0.04, look.metal, { seg: 5 }))
    } else {
        parts.push(...hipRoof(x, cap, z, 0.32, 0.26, 0.2, look.roof, 0.03), box(x, cap + 0.2, z, 0.02, 0.06, 0.02, look.metal), ball(x, cap + 0.24, z, 0.05, 0.05, look.metal, { seg: 6 }))
    }
}

function mineSite(stage: number, variant: number, gem: boolean): ModelSpec {
    const look = tierLook(stage)
    const spec: ModelSpec = { parts: [ground(gem ? C.shadowRock : C.rockDark)], spinners: [] }
    const parts = spec.parts
    mound(parts, gem ? C.shadowRock : 0x62666e, gem ? 0x77748a : 0x7d8188)
    portal(parts, stage, 0.02, 0.26)
    const ore = 0x9c5a3c
    // Ore tub on the rails and the heap by the road.
    parts.push(box(0.02, 0.04, 0.42, 0.13, 0.07, 0.11, C.woodDark))
    if (gem) parts.push(crystal(0.0, 0.1, 0.42, 0.06, 0.11, C.lilac, 0.2), crystal(0.05, 0.1, 0.43, 0.05, 0.09, C.teal, -0.3))
    else parts.push(box(0.02, 0.11, 0.42, 0.11, 0.03, 0.09, ore))
    for (let i = 0; i <= Math.min(3, stage); i++) parts.push(ball(0.44 - i * 0.07, 0.02, 0.44 - (i % 2) * 0.06, 0.12, 0.07 + (i % 2) * 0.03, gem ? (i % 2 ? C.violet : C.lilac) : (i % 2 ? shade(ore, -0.06) : ore), { seg: 6 }))
    if (gem) {
        // The seam shows more with every look: bigger spires, more of them.
        const seam: [number, number, number, number, number, number][] = [
            [-0.2, 0.3, -0.22, 0.13, 0.28, 0.16], [-0.36, 0.18, 0.0, 0.1, 0.22, 0.4], [0.36, 0.18, -0.12, 0.1, 0.2, -0.25], [0.04, 0.4, -0.28, 0.1, 0.24, -0.1],
            [0.2, 0.34, -0.26, 0.11, 0.26, 0.15], [-0.08, 0.36, -0.08, 0.08, 0.18, -0.3], [0.32, 0.03, 0.08, 0.08, 0.16, -0.2], [-0.36, 0.3, -0.3, 0.1, 0.2, 0.1],
            [0.14, 0.4, -0.12, 0.08, 0.18, 0.3], [-0.24, 0.26, 0.08, 0.08, 0.16, -0.3]
        ]
        const grow = 1 + stage * 0.12
        seam.slice(0, 4 + Math.round(stage * 1.5)).forEach(([x, y, z, w, h, tilt], i) => parts.push(crystal(x, y, z, w * grow, h * grow, [C.lilac, C.violet, C.teal][i % 3]!, tilt)))
        parts.push(box(0.02, 0.305, 0.31, 0.1, 0.07, 0.02, look.trim), crystal(0.02, 0.31, 0.325, 0.045, 0.06, C.teal))
    } else {
        parts.push(...[[-0.3, 0.26, -0.28], [0.12, 0.44, -0.3], [0.38, 0.26, -0.14]].map(([x, y, z]) => rock(x!, y!, z!, 0.1, 0.08, 0.09, ore, 0.7)))
    }

    const hx = 0.33
    const hz = 0.24
    if (stage === 0) {
        // A tool shed and a hand winch over the shaft.
        hall(parts, 0, -0.33, 0.33, 0.24, 0.2, 0.17, { wall: C.wood, roofH: 0.1 })
        parts.push(...onFace('front', 0.24, 0.2, doorAt(0.04, 0.08, 0.13, look.paint, false), -0.33, 0.33))
        for (const dx of [-0.08, 0.08]) parts.push(box(hx + dx, 0.02, hz, 0.03, 0.28, 0.03, C.woodDark))
        parts.push(cyl(hx, 0.17, hz, 0.05, 0.19, C.wood, { rotZ: Math.PI / 2, seg: 7 }), box(hx, 0.02, hz, 0.14, 0.03, 0.14, C.woodDark), ...barrel(0.42, 0.02, 0.06, 0.08))
        return variant % 2 ? mirrorX(spec) : spec
    }
    headframe(spec, stage, hx, hz, [0, 0.44, 0.5, 0.64, 0.74][stage]!)
    // The winding house: brick, rose stucco, white stone, marble.
    const wh = [0, 0.22, 0.26, 0.3, 0.32][stage]!
    const ww = stage >= 3 ? 0.32 : 0.3
    const wx = -0.49 + ww / 2 + 0.01
    const wz = 0.33
    const eave = hall(parts, stage, wx, wz, ww, 0.24, wh, { wall: stage === 1 ? look.wall2 : look.wall, roofH: [0, 0.14, 0.16, 0.12, 0.18][stage]!, hip: stage === 3 })
    const front: Part[] = [...barnDoor(0.02, 0.1, 0.16, look.trim, stage >= 2 ? look.paint : C.woodDark), ...windowAt(ww * 0.28, 0.1, 0.06, 0.08, { lit: stage >= 2, frame: look.trim, sill: false })]
    if (stage === 4) front.push(...banners([-ww * 0.32], 0.1, stage, 0.16))
    parts.push(...onFace('front', ww, 0.24, front, wx, wz))
    chimney(spec, wx - 0.08, eave, wz - 0.04, stage <= 2 ? 0.16 : 0.12, stage === 1 ? C.brick : stage === 2 ? C.stone : C.stoneLight)
    if (stage >= 2) parts.push(...lantern(-0.22, 0.46))
    if (stage === 3) {
        // Ore bin on stilts behind the winding house.
        for (const x of [-0.34, -0.18]) parts.push(box(x, 0.02, 0.1, 0.03, 0.22, 0.03, C.woodDark))
        parts.push(box(-0.26, 0.24, 0.1, 0.22, 0.12, 0.1, look.wall2), box(-0.26, 0.36, 0.1, 0.18, 0.03, 0.08, gem ? C.lilac : ore))
    }
    // The landmark: a marble tower rising out of the heap.
    if (stage === 4) tower(spec, stage, -0.33, 0.02, 0.2, 0.76, gem ? 'crystal' : 'spire')
    return variant % 2 ? mirrorX(spec) : spec
}

const mine: Factory = (stage, variant) => mineSite(stage, variant, false)
const gemmine: Factory = (stage, variant) => mineSite(stage, variant, true)

export const RESOURCE_MODELS: Partial<Record<TownBuildingId, Factory>> = { farm, lumber, quarry, mine, gemmine }
