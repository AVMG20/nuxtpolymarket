// Polytown — workshops: the mill, sawmill, kiln, smithy, foundry and factory.
// Each one keeps its identity at every look (the mill's sails, the sawmill's
// blade and logs, the kiln's brick domes, the smithy's forge, the foundry's
// stacks, the factory's saw-tooth roof) while every look is a taller, clearly
// different building dressed in that tier's scheme from tierLook().

import type { TownBuildingId } from '#shared/utils/gamelogic/town'
import {
    C, ball, barrel, box, chimney, cone, coneRoof, crate, cyl, dome, flag, gableRoof, ground, hipRoof, lantern, logPile,
    onFace, plankStack, sack, shade, silo, tierLook, turret, weathervane, windowAt, windowRow,
    type Face, type ModelSpec, type Part, type Spinner, type TierLook
} from './kit'

type Factory = (stage: number, variant: number) => ModelSpec

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Eight-sided round shapes, turned so a flat faces each axis. */
const OCT = { seg: 8, rotY: Math.PI / 8 }
/** Distance from the centre of an octagon to a flat, per unit of diameter. */
const FLAT = 0.462
const FACES: Face[] = ['front', 'back', 'left', 'right']

/** Mirror a whole model across x (odd tile variants swap their wings over). */
function mirror(spec: ModelSpec): ModelSpec {
    const flip = (p: Part): Part => ({ ...p, x: -p.x, ...(p.rotY ? { rotY: -p.rotY } : {}), ...(p.rotZ ? { rotZ: -p.rotZ } : {}), ...(p.faceY ? { faceY: -p.faceY } : {}) })
    return {
        parts: spec.parts.map(flip),
        spinners: spec.spinners?.map(s => ({ ...s, pivot: [-s.pivot[0], s.pivot[1], s.pivot[2]], parts: s.parts.map(flip) })),
        smoke: spec.smoke?.map(([x, y, z]) => [-x, y, z])
    }
}

/** Parts on one flat of an octagonal tower of diameter `d`. */
function octFace(face: Face, x: number, z: number, d: number, parts: Part[]): Part[] {
    return onFace(face, 2 * FLAT * d, 2 * FLAT * d, parts, x, z)
}

/** A framed door standing on `y`, authored against a wall (place with onFace). */
function doorway(x: number, y: number, w: number, h: number, color: number, frame: number): Part[] {
    return [box(x, y, 0.004, w + 0.04, h + 0.02, 0.02, frame), box(x, y, 0.01, w, h, 0.02, color), box(x + w * 0.28, y + h * 0.45, 0.022, 0.014, 0.014, 0.01, C.gold)]
}

/** A row of windows in the tier's style: plain early on, shuttered at L10, framed and lit from L15. */
function tierWindows(stage: number, span: number, y: number, count: number, w = 0.08, h = 0.1): Part[] {
    const L = tierLook(stage)
    if (stage >= 3) return Array.from({ length: count }, (_, i) => windowAt((i + 0.5) / count * span - span / 2, y, w, h, { lit: true, sill: false, frame: L.trim })).flat()
    return windowRow(span, y, count, { w, h, lit: 1, sill: stage >= 1, frame: stage >= 1 ? L.trim : undefined, shutters: stage === 2 ? L.paint : undefined })
}

/** Dressed corner stones on a box shell. */
function quoins(cx: number, cz: number, w: number, d: number, y: number, h: number, color: number): Part[] {
    const parts: Part[] = []
    // Clear of base courses and cornices, so no two faces share a plane.
    for (let i = 0; 0.07 + i * 0.1 + 0.06 <= h - 0.045; i++) {
        const a = i % 2 ? 0.1 : 0.065, b = i % 2 ? 0.065 : 0.1
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(cx + sx * (w / 2 - a / 2 + 0.008), y + 0.07 + i * 0.1, cz + sz * (d / 2 - b / 2 + 0.008), a, 0.06, b, color))
    }
    return parts
}

/** Post-and-rail balustrade around the edge of a flat top at height y. */
function balustrade(cx: number, y: number, cz: number, w: number, d: number, color: number, sides: Face[] = FACES): Part[] {
    const parts: Part[] = []
    for (const side of sides) {
        const along = side === 'front' || side === 'back'
        const len = along ? w : d
        const at = side === 'front' ? cz + d / 2 - 0.02 : side === 'back' ? cz - d / 2 + 0.02 : side === 'right' ? cx + w / 2 - 0.02 : cx - w / 2 + 0.02
        parts.push(along ? box(cx, y + 0.065, at, w, 0.022, 0.035, color) : box(at, y + 0.065, cz, 0.035, 0.022, d, color))
        const n = Math.max(2, Math.round(len / 0.1))
        for (let i = 0; i <= n; i++) {
            const t = -len / 2 + 0.02 + i * (len - 0.04) / n
            parts.push(along ? box(cx + t, y, at, 0.025, 0.07, 0.025, color) : box(at, y, cz + t, 0.025, 0.07, 0.025, color))
        }
    }
    return parts
}

/** Battlements: square merlons along the edge of a flat top. */
function merlons(cx: number, y: number, cz: number, w: number, d: number, color: number, size = 0.06): Part[] {
    const parts: Part[] = [box(cx, y, cz, w + 0.02, 0.03, d + 0.02, color)]
    const nx = Math.max(2, Math.round(w / (size * 2))), nz = Math.max(2, Math.round(d / (size * 2)))
    for (let i = 0; i <= nx; i++) for (const s of [-1, 1]) parts.push(box(cx - w / 2 + size / 2 + i * (w - size) / nx, y + 0.03, cz + s * (d / 2 - size / 2 + 0.01), size, size, size, color))
    for (let i = 1; i < nz; i++) for (const s of [-1, 1]) parts.push(box(cx + s * (w / 2 - size / 2 + 0.01), y + 0.03, cz - d / 2 + size / 2 + i * (d - size) / nz, size, size, size, color))
    return parts
}

/** Gold spike and ball on top of a roof or dome. */
function finial(x: number, y: number, z: number, color: number, h = 0.14): Part[] {
    return [cone(x, y, z, 0.05, h, color, { seg: 6 }), ball(x, y + h - 0.025, z, 0.045, 0.045, color, { seg: 6 })]
}

/** Clock face authored against a wall (place with onFace), centred at cy. */
function clock(cy: number, dia: number, rim: number): Part[] {
    return [
        cyl(0, cy - 0.008, 0.008, dia + 0.04, 0.016, rim, { rotX: Math.PI / 2, seg: 12 }),
        cyl(0, cy - 0.008, 0.02, dia, 0.016, 0xfdf6e3, { rotX: Math.PI / 2, seg: 12, emissive: 0xffe3a0 }),
        box(0, cy, 0.032, 0.014, dia * 0.34, 0.01, C.iron),
        box(dia * 0.14, cy - 0.007, 0.032, dia * 0.28, 0.014, 0.01, C.iron)
    ]
}

/** A banner hanging down a wall from `top`, authored against the wall. */
function banner(x: number, top: number, color: number, trim: number, w = 0.09, h = 0.2): Part[] {
    return [box(x, top - 0.02, 0.012, w + 0.03, 0.02, 0.024, trim), box(x, top - h, 0.006, w, h - 0.02, 0.012, color), box(x, top - h, 0.014, w, 0.025, 0.01, trim)]
}

/** Lantern on a post, in the tier's metal. */
function lamp(x: number, z: number, metal: number, y = 0.02): Part[] {
    return lantern(x, z, y).map(p => p.color === C.iron ? { ...p, color: metal } : p)
}

function awningParts(x: number, y: number, w: number, a: number, b: number): Part[] {
    const stripes = Math.max(3, Math.round(w / 0.06))
    return Array.from({ length: stripes }, (_, i) => box(x - w / 2 + (i + 0.5) * w / stripes, y, 0.05, w / stripes, 0.025, 0.11, i % 2 ? a : b, { rotX: 0.38 }))
}

function balconyParts(x: number, y: number, w: number, rail: number): Part[] {
    const bars = Math.max(3, Math.round(w / 0.05))
    return [
        box(x, y, 0.045, w, 0.025, 0.09, C.stoneLight),
        box(x, y + 0.085, 0.085, w, 0.012, 0.012, rail),
        ...Array.from({ length: bars }, (_, i) => box(x - w / 2 + (i + 0.5) * w / bars, y + 0.025, 0.085, 0.01, 0.06, 0.01, rail))
    ]
}

/** Smoke stack with a foot, two bands and a lip. */
function stack(spec: ModelSpec, x: number, z: number, y: number, h: number, w: number, color: number, band = C.iron) {
    spec.parts.push(cyl(x, y, z, w, h, color, { seg: 9 }), cyl(x, y, z, w * 1.25, 0.06, shade(color, -0.1), { seg: 9 }), cyl(x, y + h * 0.6, z, w * 1.1, 0.025, band, { seg: 9 }), cyl(x, y + h - 0.03, z, w * 1.15, 0.03, band, { seg: 9 }))
    ;(spec.smoke ??= []).push([x, y + h + 0.04, z])
}

// ─── Mill ────────────────────────────────────────────────────────────────────
// L1 a timber post mill, L5 a brick tower mill with a granary, L10 a taller
// rose tower with a gallery and banners, L15 white stone under a teal cap,
// L20 a marble mill on a podium with a gold cap and huge sails.

function sails(pivot: [number, number, number], span: number, stock = C.woodDark, cloth = C.bloomWhite): Spinner {
    const [px, py, pz] = pivot
    const len = span / 2, cw = 0.1 * span
    const parts: Part[] = [cyl(px, py - 0.04, pz - 0.04, 0.09, 0.08, stock, { rotX: Math.PI / 2, seg: 8 })]
    for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4
        const dx = -Math.sin(a), dy = Math.cos(a)
        // t runs along the arm, off across it (towards the cloth side).
        const arm = (t: number, off: number, w: number, h: number, d: number, z: number, color: number) =>
            box(px + dx * len * t + dy * off, py + dy * len * t - dx * off - h / 2, z, w, h, d, color, { rotZ: a })
        parts.push(arm(0.5, 0, 0.03, len, 0.024, pz, stock), arm(0.6, cw / 2 + 0.012, cw, len * 0.72, 0.01, pz - 0.008, cloth), arm(0.6, cw + 0.018, 0.014, len * 0.72, 0.018, pz, stock))
        for (const t of [0.34, 0.6, 0.86]) parts.push(arm(t, cw / 2 + 0.012, cw + 0.02, 0.014, 0.016, pz + 0.004, stock))
    }
    return { pivot, axis: 'z', rate: 1.2, parts }
}

function handCart(x: number, z: number, load = C.bloomWhite): Part[] {
    return [
        box(x, 0.07, z, 0.2, 0.04, 0.13, C.wood), box(x, 0.11, z - 0.06, 0.2, 0.04, 0.012, C.woodDark),
        ...[-1, 1].map(s => cyl(x + s * 0.11, 0.08 - 0.01, z, 0.12, 0.02, C.woodDark, { rotZ: Math.PI / 2, seg: 8 })),
        ...[-1, 1].map(s => box(x + s * 0.05, 0.09, z + 0.11, 0.015, 0.015, 0.1, C.woodDark)),
        sack(x - 0.03, 0.11, z + 0.01, load)
    ]
}

function postMill(spec: ModelSpec, L: TierLook) {
    const parts = spec.parts
    const x = -0.04, z = -0.06
    // Trestle: stone piers, cross-trees and the post the whole buck turns on.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(x + sx * 0.16, 0.02, z + sz * 0.16, 0.09, 0.07, 0.09, C.stone))
    parts.push(box(x, 0.09, z, 0.42, 0.04, 0.05, C.woodDark), box(x, 0.09, z, 0.05, 0.04, 0.42, C.woodDark), cyl(x, 0.13, z, 0.1, 0.22, C.wood, { seg: 8 }))
    for (const s of [-1, 1]) parts.push(box(x + s * 0.09, 0.1, z, 0.03, 0.22, 0.03, C.woodDark, { rotZ: -s * 0.75 }))
    // The weatherboarded buck.
    const by = 0.36, bh = 0.34, bw = 0.4, bd = 0.44
    parts.push(box(x, by - 0.025, z, bw + 0.03, 0.03, bd + 0.03, C.woodDark))
    for (let i = 0; i < 4; i++) parts.push(box(x, by + i * bh / 4, z, bw, bh / 4, bd, i % 2 ? shade(C.wood, -0.05) : C.wood))
    for (const s of [-1, 1]) parts.push(box(x + s * (bw / 2 - 0.012), by, z + bd / 2 - 0.012, 0.03, bh, 0.03, L.trim), box(x + s * (bw / 2 - 0.012), by, z - bd / 2 + 0.012, 0.03, bh, 0.03, L.trim))
    parts.push(...gableRoof(x, by + bh, z, bw + 0.04, bd + 0.06, 0.2, L.roof, 'z', C.wood))
    parts.push(...onFace('left', bw, bd, windowAt(0, by + 0.14, 0.08, 0.09, { sill: false, frame: L.trim }), x, z))
    parts.push(...onFace('back', bw, bd, doorway(0, by + 0.01, 0.11, 0.2, L.paint, L.trim), x, z))
    // Ladder down from the back door.
    const lean = Math.atan2(0.19, 0.35)
    for (const s of [-1, 1]) parts.push(box(x + s * 0.05, 0.195 - 0.2, -0.385, 0.018, 0.4, 0.018, C.woodDark, { rotX: lean }))
    for (const t of [0.25, 0.5, 0.75]) parts.push(box(x, 0.02 + 0.35 * t, -0.48 + 0.19 * t, 0.1, 0.014, 0.014, C.wood))
    spec.spinners = [sails([x, by + bh * 0.55, z + bd / 2 + 0.075], 0.86)]
    // Yard: millstone, sacks, a hand cart and hay.
    parts.push(cyl(0.34, 0.02, -0.34, 0.22, 0.05, C.stone, { seg: 10 }), cyl(0.34, 0.07, -0.34, 0.06, 0.004, C.stoneDark, { seg: 8 }))
    parts.push(sack(0.3, 0.02, 0.3), sack(0.4, 0.02, 0.36), sack(0.33, 0.02, 0.42, C.cream), ...handCart(-0.34, 0.36))
    parts.push(box(0.43, 0.02, 0.05, 0.12, 0.1, 0.12, C.hay), box(0.43, 0.12, 0.05, 0.1, 0.02, 0.1, shade(C.hay, 0.08)))
}

const MILL_TOWERS = [
    { plinth: 0.06, h: 0.8, n: 4, d0: 0.56, d1: 0.42, span: 0.86, cap: 0.24 },
    { plinth: 0.1, h: 0.96, n: 5, d0: 0.58, d1: 0.42, span: 0.92, cap: 0.3 },
    { plinth: 0.13, h: 1.1, n: 6, d0: 0.6, d1: 0.44, span: 0.96, cap: 0.28 },
    { plinth: 0.16, h: 1.24, n: 6, d0: 0.62, d1: 0.46, span: 1, cap: 0.3 }
]

function towerMill(spec: ModelSpec, stage: number, L: TierLook) {
    const parts = spec.parts
    const t = MILL_TOWERS[stage - 1]!
    const tz = -0.1
    // L20 stands on a marble podium with a gold edge.
    const b0 = stage >= 4 ? 0.07 : 0.02
    if (stage >= 4) parts.push(box(0, 0.02, 0, 0.98, 0.05, 0.98, L.wall2), box(0, 0.052, 0, 0.99, 0.012, 0.99, L.trim))
    const body = stage === 1 ? L.wall2 : L.wall
    const y0 = b0 + t.plinth
    const ch = t.h / t.n
    const dOf = (i: number) => t.d0 + (t.d1 - t.d0) * i / (t.n - 1)
    const dAt = (y: number) => dOf(Math.max(0, Math.min(t.n - 1, Math.floor((y - y0) / ch))))
    parts.push(cyl(0, b0, tz, t.d0 + 0.08, t.plinth, [C.stoneDark, C.stone, C.stoneLight, L.wall2][stage - 1]!, OCT))
    for (let i = 0; i < t.n; i++) parts.push(cyl(0, y0 + i * ch, tz, dOf(i), ch, i % 2 ? shade(body, -0.05) : body, OCT))
    const top = y0 + t.h
    // Trim bands: one under the cap, more up the shaft on the grander looks.
    for (let i = stage >= 2 ? 1 : t.n; i <= t.n; i += 2) parts.push(cyl(0, y0 + i * ch - 0.03, tz, dOf(i - 1) + 0.025, 0.03, L.trim, OCT))
    parts.push(...octFace('front', 0, tz, dOf(0), doorway(0, y0, 0.11, Math.min(0.2, ch - 0.02), L.paint, L.trim)))
    for (let i = 1; i < t.n; i++) {
        for (const f of i % 2 ? ['front', 'back'] as const : ['left', 'right'] as const) {
            const win = stage >= 3
                ? windowAt(0, y0 + i * ch + ch * 0.28, 0.07, Math.min(0.11, ch * 0.45), { lit: true, sill: false, frame: L.trim })
                : windowAt(0, y0 + i * ch + ch * 0.28, 0.06, Math.min(0.1, ch * 0.45), { lit: (i + stage) % 3 === 0, sill: false, frame: L.trim })
            parts.push(...octFace(f, 0, tz, dOf(i), win))
        }
    }
    // Cap: brick cone, wine cone and pennant, teal dome, then a gold dome and spire.
    parts.push(cyl(0, top, tz, t.d1 + 0.06, 0.03, stage >= 4 ? L.trim : C.woodDark, OCT))
    const capY = top + 0.03
    const capW = t.d1 + 0.08
    if (stage <= 2) {
        parts.push(...coneRoof(0, capY, tz, capW, t.cap, L.roof, 8).map(p => ({ ...p, rotY: Math.PI / 8 })))
        if (stage === 1) parts.push(...weathervane(0, capY + t.cap - 0.03, tz, 0.16))
        else parts.push(...flag(0, capY + t.cap - 0.03, tz, L.banner, 0.2))
    } else if (stage === 3) {
        parts.push(dome(0, capY, tz, capW, t.cap, C.accent, OCT), ...finial(0, capY + t.cap - 0.03, tz, L.metal, 0.14))
    } else {
        parts.push(dome(0, capY, tz, capW, t.cap, L.roof, OCT), cyl(0, capY + t.cap - 0.06, tz, 0.1, 0.06, L.wall, { seg: 8 }), cone(0, capY + t.cap, tz, 0.1, 0.26, L.roof, { seg: 8 }), ball(0, capY + t.cap + 0.24, tz, 0.05, 0.05, L.trim, { seg: 6 }), ...flag(0, capY + t.cap + 0.27, tz, L.banner, 0.16))
    }
    // Sails sweep clear of the tower where it is widest under them.
    const py = top + 0.07
    const low = py - t.span / 2
    const pz = tz + FLAT * dAt(low) + 0.1
    parts.push(cyl(0, py - (pz - 0.07 - tz) / 2, (tz + pz - 0.07) / 2, 0.07, pz - 0.07 - tz, C.woodDark, { rotX: Math.PI / 2, seg: 8 }))
    spec.spinners = [sails([0, py, pz], t.span, stage >= 4 ? L.trim : C.woodDark)]
    // Gallery (reefing stage) below the sweep, with banners hanging under it.
    if (stage >= 2) {
        const yg = low - 0.16
        const dg = dAt(yg) + 0.2
        const deck = [C.wood, L.trim, L.wall2][stage - 2]!
        const rail = [C.woodDark, L.trim, L.trim][stage - 2]!
        parts.push(cyl(0, yg, tz, dg, 0.03, deck, OCT))
        for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4
            const r = FLAT * dg - 0.012
            const v = a + Math.PI / 8, rv = dg / 2 - 0.02
            parts.push(box(Math.sin(a) * r, yg + 0.1, tz + Math.cos(a) * r, 0.383 * dg, 0.018, 0.018, rail, { rotY: a }))
            parts.push(box(Math.sin(v) * rv, yg + 0.03, tz + Math.cos(v) * rv, 0.022, 0.085, 0.022, rail))
        }
        for (const f of ['left', 'right'] as const) parts.push(...octFace(f, 0, tz, dAt(yg - 0.12), banner(0, yg, L.banner, L.trim, 0.1, 0.24)))
    }
    // The granary wing beside the tower, one new massing per look.
    const wx = 0.31
    if (stage === 1) {
        const wd = 0.58, wz = -0.19
        parts.push(box(wx, 0.02, wz, 0.34, 0.3, wd, L.wall), box(wx, 0.02, wz, 0.35, 0.06, wd + 0.01, L.wall2), ...gableRoof(wx, 0.32, wz, 0.38, wd + 0.04, 0.16, L.roof, 'z', L.wall))
        parts.push(...onFace('front', 0.34, wd, doorway(0, 0.08, 0.1, 0.16, L.paint, L.trim), wx, wz), ...onFace('right', 0.34, wd, windowRow(wd, 0.14, 3, { h: 0.09, lit: 1, frame: L.trim }), wx, wz))
        parts.push(...lamp(-0.15, 0.26, L.metal), ...lamp(0.15, 0.26, L.metal), sack(-0.36, 0.02, 0.32), sack(-0.28, 0.02, 0.4), sack(-0.4, 0.02, 0.42, C.cream), ...barrel(0.4, 0.02, 0.36), ...crate(0.26, 0.02, 0.4), ...handCart(-0.36, -0.38))
    } else if (stage === 2) {
        const wd = 0.62, wz = -0.17
        parts.push(box(wx, 0.02, wz, 0.34, 0.5, wd, L.wall2), box(wx, 0.27, wz, 0.35, 0.025, wd + 0.01, L.wall), ...gableRoof(wx, 0.52, wz, 0.38, wd + 0.04, 0.2, L.roof, 'z', L.wall2))
        parts.push(...onFace('front', 0.34, wd, [...doorway(0, 0.02, 0.1, 0.17, L.paint, L.trim), ...windowAt(0, 0.33, 0.1, 0.12, { shutters: L.paint, sill: false, frame: L.trim }), ...awningParts(0, 0.2, 0.2, L.banner, L.wall2)], wx, wz))
        parts.push(...onFace('front', 0.34, wd, balconyParts(0, 0.3, 0.24, L.metal), wx, wz))
        for (const y of [0.1, 0.34]) parts.push(...onFace('right', 0.34, wd, tierWindows(stage, wd, y, 3), wx, wz))
        parts.push(...lamp(-0.15, 0.27, L.metal), ...lamp(0.12, 0.3, L.metal), sack(-0.36, 0.02, 0.32), sack(-0.28, 0.02, 0.4), ...barrel(-0.4, 0.02, 0.42), ...crate(0.36, 0.02, 0.4), ...handCart(-0.36, -0.38))
    } else if (stage === 3) {
        const wd = 0.66, wz = -0.15, ww = 0.36, wh = 0.56
        parts.push(box(wx, 0.02, wz, ww, wh, wd, L.wall), ...quoins(wx, wz, ww, wd, 0.02, wh, L.trim), box(wx, 0.02 + wh - 0.03, wz, ww + 0.02, 0.03, wd + 0.02, L.trim), ...hipRoof(wx, 0.02 + wh + 0.025, wz, ww + 0.04, wd + 0.04, 0.2, L.roof, 0.08))
        parts.push(...onFace('front', ww, wd, [...doorway(0, 0.02, 0.12, 0.2, L.paint, L.trim), ...tierWindows(stage, ww, 0.34, 1, 0.1, 0.13)], wx, wz))
        for (const y of [0.12, 0.34]) parts.push(...onFace('right', ww, wd, tierWindows(stage, wd, y, 3), wx, wz))
        parts.push(...silo(-0.38, -0.38, 0.22, 0.5, L.wall2, C.accent), ...lamp(-0.15, 0.27, L.metal), ...lamp(0.15, 0.27, L.metal), sack(-0.36, 0.02, 0.32), sack(-0.28, 0.02, 0.4), ...crate(-0.4, 0.02, 0.42), ...crate(0.36, 0.02, 0.4), ...barrel(0.24, 0.02, 0.42))
    } else {
        const wd = 0.7, wz = -0.13, ww = 0.36, wh = 0.6, wy = 0.07
        parts.push(box(wx, wy, wz, ww, wh, wd, L.wall), box(wx, wy, wz, ww + 0.01, 0.05, wd + 0.01, L.wall2), box(wx, wy + wh - 0.035, wz, ww + 0.025, 0.035, wd + 0.025, L.trim), ...hipRoof(wx, wy + wh + 0.025, wz, ww + 0.04, wd + 0.04, 0.2, L.roof, 0.14))
        parts.push(dome(wx, wy + wh + 0.22, wz, 0.13, 0.12, C.accent, { seg: 8 }), ...finial(wx, wy + wh + 0.32, wz, L.trim, 0.1))
        parts.push(...onFace('front', ww, wd, [...doorway(0, wy, 0.12, 0.22, L.paint, L.trim), ...tierWindows(stage, ww, wy + 0.34, 1, 0.1, 0.14), ...banner(-0.13, wy + wh - 0.05, L.banner, L.trim, 0.07, 0.3), ...banner(0.13, wy + wh - 0.05, L.banner, L.trim, 0.07, 0.3)], wx, wz))
        for (const y of [wy + 0.1, wy + 0.34]) parts.push(...onFace('right', ww, wd, tierWindows(stage, wd, y, 3), wx, wz))
        parts.push(...lamp(-0.15, 0.27, L.metal, wy), ...lamp(0.15, 0.27, L.metal, wy), sack(-0.36, wy, 0.32), sack(-0.28, wy, 0.4), ...crate(-0.4, wy, 0.42), ...barrel(0.36, wy, 0.4))
        parts.push(...silo(-0.38, -0.38, 0.2, 0.46, L.wall, C.accent, wy), ...finial(-0.38, wy + 0.46 + 0.09, -0.38, L.trim, 0.08))
    }
}

const mill: Factory = (stage, variant) => {
    const L = tierLook(stage)
    const spec: ModelSpec = { parts: [ground([0xc9ae78, C.cobble, C.cobble, C.paving, 0xe9e2d0][stage]!)] }
    if (stage === 0) postMill(spec, L)
    else towerMill(spec, stage, L)
    return variant % 2 ? mirror(spec) : spec
}

// ─── Sawmill ─────────────────────────────────────────────────────────────────
// L1 an open saw shed, L5 a brick mill house with a waterwheel, L10 a rose
// two-storey mill with a hoist tower, L15 a white-stone hall with a cupola and
// log gantry, L20 a marble hall with a gold roof and a clock tower.

function sawBlade(pivot: [number, number, number]): Spinner {
    const [px, py, pz] = pivot
    return { pivot, axis: 'z', parts: [cyl(px, py - 0.006, pz, 0.2, 0.012, C.metalLight, { rotX: Math.PI / 2, seg: 12 }), ...[0, 1, 2, 3].map(k => box(px, py - 0.11, pz, 0.03, 0.22, 0.014, C.metal, { rotZ: k * Math.PI / 4 }))] }
}

function waterWheel(pivot: [number, number, number], dia: number, rim: number, hub: number): Spinner {
    const [px, py, pz] = pivot
    const width = 0.07
    return {
        pivot, axis: 'x', rate: 1.4,
        parts: [
            cyl(px, py - width / 2, pz, 0.09, width, hub, { rotZ: Math.PI / 2, seg: 8 }),
            ...[-1, 1].map(s => cyl(px + s * (width / 2 - 0.008), py - 0.008, pz, dia - 0.05, 0.016, rim, { rotZ: Math.PI / 2, seg: 12 })),
            ...[0, 1, 2, 3, 4, 5].map(k => box(px, py - dia / 2, pz, width - 0.01, dia, 0.022, shade(C.wood, -0.08), { rotX: k * Math.PI / 6 }))
        ]
    }
}

/** Open cutting shed from x0..x1 (outer wall on x0), with a saw bench and blades. */
function sawShed(spec: ModelSpec, stage: number, x0: number, x1: number, z0: number, z1: number, eave: number, blades: number) {
    const L = tierLook(stage)
    const parts = spec.parts
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
    const wall = stage >= 3 ? L.wall : C.wood
    const post = stage >= 3 ? L.trim : C.woodDark
    parts.push(box(cx, 0.02, z0 + 0.025, w, eave, 0.05, wall), box(x0 + 0.025, 0.02, cz, 0.05, eave, d, wall))
    if (stage < 3) for (let i = 0; i < 4; i++) parts.push(box(x0 - 0.002, 0.07 + i * eave / 5, cz, 0.012, 0.012, d, C.woodDark))
    for (const z of [cz, z1 - 0.03]) parts.push(box(x1 - 0.03, 0.02, z, 0.05, eave, 0.05, post))
    parts.push(box(x0 + 0.03, 0.02, z1 - 0.03, 0.05, eave, 0.05, post))
    parts.push(...gableRoof(cx, 0.02 + eave, cz, w + 0.02, d + 0.02, 0.18, L.roof, 'z', wall))
    const bx = cx + 0.03
    const back = z0 + 0.08
    parts.push(box(bx, 0.02, (back + z1 - 0.06) / 2, 0.2, 0.1, z1 - 0.06 - back, C.woodDark))
    const logFrom = back + 0.1 + blades * 0.14
    const logLen = z1 - 0.08 - logFrom
    parts.push(cyl(bx, 0.12 - logLen / 2, logFrom + logLen / 2, 0.1, logLen, C.wood, { rotX: Math.PI / 2, seg: 8 }), cyl(bx, 0.12 - 0.003, z1 - 0.08, 0.075, 0.006, C.woodLight, { rotX: Math.PI / 2, seg: 8 }))
    for (let i = 0; i < blades; i++) (spec.spinners ??= []).push(sawBlade([bx, 0.15, back + 0.1 + i * 0.14]))
}

/** Stone-kerbed mill race along the +x edge. */
function millRace(parts: Part[], kerb: number) {
    parts.push(box(0.385, 0.02, 0, 0.02, 0.05, 1, kerb), box(0.49, 0.02, 0, 0.02, 0.05, 1, kerb), box(0.4375, 0.005, 0, 0.085, 0.03, 1, C.water, { flat: true }))
}

const sawmill: Factory = (stage, variant) => {
    const L = tierLook(stage)
    const spec: ModelSpec = { parts: [ground([0xc7a46c, 0xc7a46c, C.cobble, C.paving, 0xe9e2d0][stage]!)], spinners: [] }
    const parts = spec.parts
    if (stage === 0) {
        sawShed(spec, 0, -0.49, 0.1, -0.48, 0.48, 0.36, 1)
        parts.push(...plankStack(0.3, 0.34, 0.26, 3, 0.02, Math.PI / 2), ...plankStack(0.3, -0.02, 0.26, 2, 0.02, Math.PI / 2), ...logPile(0.3, -0.34, 0.28, 2))
        parts.push(ball(-0.2, 0.02, 0.4, 0.14, 0.07, C.woodLight, { seg: 6 }), cyl(0.24, 0.02, 0.16, 0.09, 0.07, C.wood, { seg: 7 }))
        return variant % 2 ? mirror(spec) : spec
    }
    millRace(parts, stage >= 3 ? L.trim : C.stone)
    // The mill house between the saw shed and the race.
    const hx = 0.17, hw = 0.38
    const hz = stage >= 3 ? -0.15 : -0.18, hd = stage >= 3 ? 0.66 : 0.6
    const hh = [0, 0.4, 0.58, 0.64, 0.68][stage]!
    const wall = stage === 1 ? L.wall2 : L.wall
    parts.push(box(hx, 0.02, hz, hw, hh, hd, wall), box(hx, 0.02, hz, hw + 0.01, 0.05, hd + 0.01, stage >= 3 ? L.trim : shade(wall, -0.15)))
    if (stage >= 2) parts.push(box(hx, 0.32, hz, hw + 0.01, 0.022, hd + 0.01, L.trim))
    if (stage >= 3) parts.push(...quoins(hx, hz, hw, hd, 0.02, hh, L.trim), box(hx, 0.02 + hh - 0.03, hz, hw + 0.02, 0.03, hd + 0.02, L.trim))
    const roofY = 0.02 + hh
    if (stage <= 2) parts.push(...gableRoof(hx, roofY, hz, hw + 0.04, hd + 0.04, 0.2, L.roof, 'x', wall))
    else parts.push(...hipRoof(hx, roofY + 0.025, hz, hw + 0.04, hd + 0.04, 0.2, L.roof, 0.14))
    for (const y of stage >= 2 ? [0.12, 0.38] : [0.15]) {
        parts.push(...onFace('back', hw, hd, tierWindows(stage, hw, y, 2), hx, hz))
        if (y > 0.2) parts.push(...onFace('front', hw, hd, tierWindows(stage, hw, y, 2), hx, hz))
    }
    parts.push(...onFace('front', hw, hd, [...doorway(-0.08, 0.02, 0.11, 0.19, L.paint, L.trim), ...tierWindows(stage, 0.16, 0.13, 1).map(p => ({ ...p, x: p.x + 0.1 }))], hx, hz))
    if (stage === 2) parts.push(...onFace('front', hw, hd, awningParts(-0.08, 0.22, 0.18, L.banner, L.wall2), hx, hz))
    if (stage >= 4) parts.push(...onFace('front', hw, hd, [...banner(-0.16, hh - 0.04, L.banner, L.trim, 0.06, 0.26), ...banner(0.16, hh - 0.04, L.banner, L.trim, 0.06, 0.26)], hx, hz))
    // Waterwheel on the race, turning off an axle from the house wall.
    const wd = [0, 0.44, 0.5, 0.54, 0.56][stage]!
    const pivot: [number, number, number] = [0.435, wd / 2, hz - 0.02]
    parts.push(cyl(0.3975, pivot[1] - 0.0375, pivot[2], 0.04, 0.075, C.iron, { rotZ: Math.PI / 2, seg: 8 }))
    spec.spinners!.push(waterWheel(pivot, wd, stage >= 4 ? L.trim : C.wood, stage >= 3 ? L.metal : C.iron))
    // Saw shed on the far side, blades doubling from L15.
    sawShed(spec, stage, -0.49, -0.08, -0.48, stage >= 3 ? 0.2 : 0.12, 0.32 + stage * 0.02, stage >= 3 ? 2 : 1)
    // Front yard: logs waiting and sawn stock.
    const yz = stage >= 3 ? 0.36 : 0.32
    parts.push(...logPile(-0.26, yz, 0.4, 2), ...plankStack(0.15, yz - 0.06, 0.28, 2 + stage), ...plankStack(0.15, yz + 0.08, 0.28, 1 + stage))
    if (stage === 1) parts.push(...weathervane(hx, roofY + 0.2, hz, 0.16), ...lamp(-0.04, 0.16, L.metal), ...lamp(0.34, 0.16, L.metal))
    if (stage === 2) {
        // Hoist tower rising through the back of the roof.
        const tx = 0.04, tzz = -0.36, tw = 0.18, th = 0.84
        parts.push(box(tx, 0.02, tzz, tw, th, tw, L.wall2), box(tx, 0.02 + th - 0.03, tzz, tw + 0.02, 0.03, tw + 0.02, L.trim), ...hipRoof(tx, 0.02 + th + 0.025, tzz, tw + 0.06, tw + 0.06, 0.16, L.roof, 0.03))
        parts.push(...onFace('left', tw, tw, windowAt(0, th - 0.2, 0.07, 0.1, { shutters: L.paint, sill: false, frame: L.trim }), tx, tzz), ...onFace('back', tw, tw, windowAt(0, th - 0.2, 0.07, 0.1, { lit: true, sill: false, frame: L.trim }), tx, tzz))
        parts.push(...onFace('left', tw, tw, banner(0, th - 0.3, L.banner, L.trim, 0.08, 0.22), tx, tzz), ...lamp(0.34, 0.16, L.metal))
    }
    if (stage >= 3) {
        // Log gantry over the yard.
        const g = stage >= 4 ? L.trim : L.metal
        for (const x of [-0.44, 0.34]) parts.push(box(x, 0.02, 0.44, 0.035, 0.5, 0.035, g))
        parts.push(box(-0.05, 0.52, 0.44, 0.84, 0.035, 0.035, g), box(-0.1, 0.36, 0.44, 0.008, 0.16, 0.008, C.iron), cyl(-0.1, 0.36 - 0.13, 0.44, 0.07, 0.26, C.wood, { rotZ: Math.PI / 2, seg: 7 }))
    }
    if (stage === 3) {
        // Cupola on the hip roof.
        const cy = roofY + 0.025 + 0.2
        parts.push(box(hx, cy, hz, 0.14, 0.1, 0.14, L.wall), ...FACES.flatMap(f => onFace(f, 0.14, 0.14, [box(0, cy + 0.02, 0.004, 0.06, 0.06, 0.02, C.lit, { emissive: C.litGlow })], hx, hz)), box(hx, cy + 0.1, hz, 0.17, 0.02, 0.17, L.trim), dome(hx, cy + 0.12, hz, 0.15, 0.13, C.accent, { seg: 8 }), ...finial(hx, cy + 0.23, hz, L.metal, 0.08))
        parts.push(...lamp(-0.04, 0.24, L.metal))
    }
    if (stage >= 4) {
        // Clock tower at the back corner of the hall, gold-crowned.
        const tx = 0.03, tzz = -0.37, tw = 0.2, th = 1.02
        parts.push(box(tx, 0.02, tzz, tw, th, tw, L.wall), ...quoins(tx, tzz, tw, tw, 0.02, th, L.wall2))
        for (const y of [0.72, th - 0.03]) parts.push(box(tx, 0.02 + y, tzz, tw + 0.025, 0.03, tw + 0.025, L.trim))
        parts.push(...onFace('left', tw, tw, clock(0.9, 0.12, L.trim), tx, tzz), ...onFace('back', tw, tw, clock(0.9, 0.12, L.trim), tx, tzz))
        parts.push(...onFace('front', tw, tw, [box(0, 0.85, 0.004, 0.07, 0.12, 0.02, C.lit, { emissive: C.litGlow })], tx, tzz))
        parts.push(...hipRoof(tx, 0.02 + th + 0.025, tzz, tw + 0.05, tw + 0.05, 0.26, L.roof, 0.03), ...finial(tx, 0.02 + th + 0.26, tzz, L.trim, 0.16), ...flag(tx, 0.02 + th + 0.38, tzz, L.banner, 0.14))
        parts.push(...lamp(-0.04, 0.24, L.metal))
    }
    return variant % 2 ? mirror(spec) : spec
}

// ─── Brick kiln ──────────────────────────────────────────────────────────────
// Red-brick beehive domes at every look. L1 one kiln and a drying rack, L5 two
// kilns, a tall chimney and a brick shed, L10 a long ring kiln with a round
// stack and a rose office, L15 a white-stone office with a teal cupola, L20 a
// marble office under gold beside a gold-crowned chimney.

function beehive(spec: ModelSpec, x: number, z: number, s: number, band = C.brickDark) {
    spec.parts.push(
        cyl(x, 0.02, z, 0.46 * s, 0.16 * s, C.brick, { seg: 10 }), cyl(x, 0.02 + 0.16 * s, z, 0.48 * s, 0.02, band, { seg: 10 }),
        dome(x, 0.04 + 0.16 * s, z, 0.46 * s, 0.26 * s, shade(C.brick, 0.04), { seg: 10 }),
        box(x, 0.02, z + 0.22 * s, 0.13 * s, 0.13 * s, 0.05, C.brickDark), box(x, 0.03, z + 0.235 * s + 0.012, 0.09 * s, 0.09 * s, 0.02, C.fire, { emissive: C.fire })
    )
    chimney(spec, x, 0.04 + 0.4 * s, z, 0.12 * s, C.brickDark, 0.08)
}

function pallet(parts: Part[], x: number, z: number, layers: number) {
    parts.push(box(x, 0.02, z, 0.17, 0.02, 0.15, C.woodDark))
    for (let layer = 0; layer < layers; layer++) parts.push(box(x, 0.04 + layer * 0.045, z, 0.15, 0.04, 0.13, layer % 2 ? C.brick : shade(C.brick, 0.06)))
}

/** Tall round brick stack with stone bands. */
function brickStack(spec: ModelSpec, x: number, z: number, h: number, w: number, band: number, crown: number) {
    const parts = spec.parts
    parts.push(box(x, 0.02, z, w + 0.08, 0.14, w + 0.08, C.brickDark), cyl(x, 0.16, z, w, h - 0.14, C.brick, { seg: 10 }))
    for (const t of [0.35, 0.7]) parts.push(cyl(x, 0.02 + h * t, z, w + 0.025, 0.03, band, { seg: 10 }))
    parts.push(cyl(x, 0.02 + h, z, w + 0.05, 0.05, crown, { seg: 10 }))
    ;(spec.smoke ??= []).push([x, 0.1 + h, z])
}

const kiln: Factory = (stage, variant) => {
    const L = tierLook(stage)
    const spec: ModelSpec = { parts: [ground([0xb88962, 0xb88962, C.cobble, C.paving, 0xe9e2d0][stage]!)] }
    const parts = spec.parts
    if (stage === 0) {
        beehive(spec, -0.2, -0.18, 1.1)
        // Open drying rack of green bricks.
        const rx = 0.28, rz = -0.26
        for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(rx + x * 0.16, 0.02, rz + z * 0.18, 0.035, 0.3, 0.035, C.woodDark))
        parts.push(...gableRoof(rx, 0.32, rz, 0.4, 0.46, 0.14, L.roof, 'x'))
        for (const y of [0.04, 0.16]) parts.push(box(rx, y, rz, 0.3, 0.02, 0.34, C.wood), box(rx, y + 0.02, rz, 0.26, 0.04, 0.3, 0xd9a97c))
        pallet(parts, 0.3, 0.3, 3); pallet(parts, 0.1, 0.34, 2); pallet(parts, -0.36, 0.34, 2)
        parts.push(ball(-0.12, 0.02, 0.24, 0.18, 0.1, 0xa8714e, { seg: 6 }), ...barrel(0.42, 0.02, 0.05))
    } else if (stage === 1) {
        beehive(spec, -0.25, -0.22, 1.05)
        beehive(spec, 0.2, -0.26, 0.95)
        brickStack(spec, -0.01, -0.42, 0.95, 0.12, C.stoneLight, C.brickDark)
        // Brick drying shed on the front corner.
        const sx = 0.3, sz = 0.26
        parts.push(box(sx, 0.02, sz - 0.18, 0.36, 0.3, 0.05, C.brick), box(sx + 0.155, 0.02, sz, 0.05, 0.3, 0.4, C.brick), box(sx - 0.155, 0.02, sz + 0.17, 0.04, 0.3, 0.04, C.woodDark))
        parts.push(...gableRoof(sx, 0.32, sz, 0.4, 0.44, 0.15, L.roof, 'x', C.brick), ...weathervane(sx, 0.47, sz, 0.14))
        pallet(parts, sx - 0.02, sz, 3)
        pallet(parts, -0.36, 0.34, 3); pallet(parts, -0.16, 0.34, 2); pallet(parts, -0.36, 0.14, 2)
        parts.push(ball(0.02, 0.02, 0.2, 0.16, 0.1, 0xa8714e, { seg: 6 }), ...lamp(0.06, 0.4, L.metal))
    } else {
        // Ring kiln: a long brick vault with glowing firing ports.
        const kz = -0.3, kd = 0.34, kw = stage >= 3 ? 0.62 : 0.96, kx = stage >= 3 ? -0.18 : 0
        parts.push(box(kx, 0.02, kz, kw, 0.24, kd, C.brick), box(kx, 0.02, kz, kw + 0.01, 0.05, kd + 0.01, C.brickDark))
        for (let i = 0; i < 4; i++) parts.push(box(kx, 0.26 + i * 0.035, kz, kw - 0.02, 0.035, kd * (1 - i * 0.22), i % 2 ? shade(C.brick, -0.05) : shade(C.brick, 0.04)))
        const ports = Math.round(kw / 0.2)
        parts.push(...onFace('front', kw, kd, Array.from({ length: ports }, (_, i) => [box((i + 0.5) / ports * kw - kw / 2, 0.02, 0.004, 0.09, 0.12, 0.02, C.brickDark), box((i + 0.5) / ports * kw - kw / 2, 0.03, 0.012, 0.06, 0.08, 0.02, C.fire, { emissive: C.fire })]).flat(), kx, kz))
        const stackX = stage >= 3 ? 0.3 : 0, stackZ = stage >= 3 ? -0.34 : kz
        const sh = [0, 0, 1.12, 1.34, 1.62][stage]!
        brickStack(spec, stackX, stackZ, sh, [0, 0, 0.16, 0.18, 0.2][stage]!, L.trim, stage >= 4 ? L.trim : C.brickDark)
        if (stage >= 4) parts.push(cyl(stackX, 0.07 + sh, stackZ, 0.2, 0.03, C.fire, { seg: 10, emissive: C.fire }))
        if (stage === 2) {
            beehive(spec, -0.28, 0.22, 0.95)
            // Rose stucco office with an awning and a banner flag.
            const ox = 0.28, oz = 0.14, ow = 0.4, od = 0.46, oh = 0.4
            parts.push(box(ox, 0.02, oz, ow, oh, od, L.wall), box(ox, 0.02, oz, ow + 0.01, 0.05, od + 0.01, L.wall2), ...gableRoof(ox, 0.02 + oh, oz, ow + 0.04, od + 0.04, 0.18, L.roof, 'x', L.wall))
            parts.push(...onFace('front', ow, od, [...doorway(-0.08, 0.02, 0.1, 0.18, L.paint, L.trim), ...tierWindows(stage, 0.16, 0.14, 1).map(p => ({ ...p, x: p.x + 0.1 })), ...awningParts(-0.08, 0.22, 0.18, L.banner, L.wall2), ...tierWindows(stage, ow, 0.3, 2)], ox, oz))
            parts.push(...onFace('left', ow, od, tierWindows(stage, od, 0.2, 2), ox, oz), ...flag(ox, 0.02 + oh + 0.16, oz, L.banner, 0.2))
            pallet(parts, -0.02, 0.38, 3); pallet(parts, -0.02, 0.16, 2)
        } else {
            beehive(spec, -0.32, 0.2, 0.9, stage >= 4 ? L.trim : C.brickDark)
            beehive(spec, stage >= 4 ? -0.06 : 0.02, stage >= 4 ? 0.28 : 0.26, 0.8, stage >= 4 ? L.trim : C.brickDark)
            // Stone (L15) or marble (L20) works office with lit windows.
            const ox = 0.33, oz = 0.14, ow = 0.34, od = 0.62, oh = stage >= 4 ? 0.6 : 0.5
            parts.push(box(ox, 0.02, oz, ow, oh, od, L.wall), box(ox, 0.02, oz, ow + 0.01, 0.05, od + 0.01, L.wall2), box(ox, 0.02 + oh - 0.03, oz, ow + 0.02, 0.03, od + 0.02, L.trim), ...quoins(ox, oz, ow, od, 0.02, oh, L.trim))
            parts.push(...hipRoof(ox, 0.02 + oh + 0.025, oz, ow + 0.04, od + 0.04, 0.18, L.roof, 0.12))
            for (const y of [0.12, 0.34]) parts.push(...onFace('left', ow, od, tierWindows(stage, od, y, 3), ox, oz))
            parts.push(...onFace('front', ow, od, [...doorway(0, 0.02, 0.11, 0.2, L.paint, L.trim), ...tierWindows(stage, ow, 0.32, 2)], ox, oz))
            const cy = 0.02 + oh + 0.025 + 0.18
            if (stage === 3) parts.push(box(ox, cy, oz, 0.12, 0.09, 0.12, L.wall), ...FACES.flatMap(f => onFace(f, 0.12, 0.12, [box(0, cy + 0.02, 0.004, 0.05, 0.05, 0.02, C.lit, { emissive: C.litGlow })], ox, oz)), dome(ox, cy + 0.09, oz, 0.14, 0.12, C.accent, { seg: 8 }), ...finial(ox, cy + 0.19, oz, L.metal, 0.08))
            else parts.push(box(ox, cy - 0.02, oz, 0.15, 0.26, 0.15, L.wall), ...FACES.flatMap(f => onFace(f, 0.15, 0.15, [box(0, cy + 0.06, 0.004, 0.06, 0.12, 0.02, C.lit, { emissive: C.litGlow })], ox, oz)), box(ox, cy + 0.21, oz, 0.18, 0.03, 0.18, L.trim), ...hipRoof(ox, cy + 0.265, oz, 0.19, 0.19, 0.16, L.roof, 0.02), ...finial(ox, cy + 0.4, oz, L.trim, 0.12), ...onFace('front', ow, od, [...banner(-0.12, oh - 0.04, L.banner, L.trim, 0.06, 0.26), ...banner(0.12, oh - 0.04, L.banner, L.trim, 0.06, 0.26)], ox, oz))
            pallet(parts, -0.4, -0.04, 2); pallet(parts, 0.08, 0, 3)
            parts.push(...lamp(0.12, 0.44, L.metal))
        }
    }
    return variant % 2 ? mirror(spec) : spec
}

// ─── Smithy ──────────────────────────────────────────────────────────────────
// L1 an open forge shed, L5 a brick smithy with a chimney and coal lean-to,
// L10 a two-storey forge hall with a turret, L15 a crenellated stone armoury,
// L20 a marble guild hall with a tall glowing forge tower.

function anvil(x: number, z: number, y = 0.02): Part[] {
    return [cyl(x, y, z, 0.09, 0.07, C.woodDark, { seg: 7 }), box(x, y + 0.07, z, 0.12, 0.035, 0.06, C.iron), box(x, y + 0.105, z, 0.16, 0.025, 0.05, C.iron)]
}

function trough(x: number, z: number, y = 0.02): Part[] {
    return [box(x, y, z, 0.2, 0.06, 0.09, C.wood), box(x, y + 0.05, z, 0.17, 0.012, 0.06, C.water, { flat: true })]
}

/** Forge mouth against a wall: dark arch, fire and a lintel. */
function forgeMouth(x: number, w: number, h: number, lintel: number): Part[] {
    return [box(x, 0.02, 0.002, w, h, 0.02, C.iron), box(x, 0.04, 0.008, w - 0.1, h * 0.55, 0.02, C.fire, { emissive: C.fire }), box(x, 0.02 + h, 0.012, w + 0.06, 0.035, 0.04, lintel)]
}

const smithy: Factory = (stage, variant) => {
    const L = tierLook(stage)
    const spec: ModelSpec = { parts: [ground([0x8f8a80, C.stoneDark, C.cobble, C.paving, 0xe9e2d0][stage]!)] }
    const parts = spec.parts
    if (stage === 0) {
        // Open timber shed over a stone hearth.
        const cx = -0.1, cz = -0.18, w = 0.76, d = 0.58, eave = 0.34
        parts.push(box(cx, 0.02, cz - d / 2 + 0.025, w, eave, 0.05, C.wood))
        for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(cx + x * (w / 2 - 0.025), 0.02, cz + z * (d / 2 - 0.025), 0.05, eave, 0.05, C.woodDark))
        for (let i = 0; i < 3; i++) parts.push(box(cx, 0.08 + i * 0.1, cz - d / 2 - 0.002, w, 0.012, 0.012, C.woodDark))
        parts.push(...gableRoof(cx, 0.02 + eave, cz, w + 0.04, d + 0.04, 0.2, L.roof, 'x', C.wood))
        parts.push(box(-0.26, 0.02, -0.34, 0.26, 0.14, 0.2, C.stone), box(-0.26, 0.16, -0.34, 0.2, 0.012, 0.14, C.fire, { emissive: C.fire }), box(-0.26, 0.26, -0.34, 0.2, 0.06, 0.16, C.stoneDark))
        chimney(spec, -0.26, 0.32, -0.38, 0.4, C.stone, 0.1)
        parts.push(...anvil(-0.06, 0.2), ...trough(0.16, 0.36), ...logPile(0.4, -0.2, 0.18, 2), box(0.14, 0.02, -0.3, 0.16, 0.14, 0.012, C.woodDark), ...barrel(0.38, 0.02, 0.38, 0.09))
        parts.push(cyl(-0.38, 0.02 + 0.07 - 0.01, 0.34, 0.14, 0.02, C.stone, { rotZ: Math.PI / 2, seg: 10 }), box(-0.38, 0.02, 0.34, 0.03, 0.06, 0.06, C.woodDark))
        return variant % 2 ? mirror(spec) : spec
    }
    const hx = stage >= 3 ? 0 : -0.1, hw = stage >= 3 ? 0.96 : 0.76
    const hz = -0.14, hd = [0, 0.62, 0.64, 0.66, 0.62][stage]!
    const hh = [0, 0.42, 0.62, 0.7, 0.66][stage]!
    const wall = stage === 1 ? L.wall2 : L.wall
    parts.push(box(hx, 0.02, hz, hw, hh, hd, wall), box(hx, 0.02, hz, hw + 0.01, 0.06, hd + 0.01, stage >= 3 ? L.trim : shade(wall, -0.15)))
    if (stage >= 2) parts.push(box(hx, 0.34, hz, hw + 0.01, 0.022, hd + 0.01, L.trim))
    if (stage >= 3) parts.push(...quoins(hx, hz, hw, hd, 0.02, hh, L.trim))
    parts.push(...onFace('front', hw, hd, [...forgeMouth(-0.14, 0.34, 0.2, stage >= 3 ? L.trim : C.woodDark), ...doorway(0.22, 0.02, 0.11, 0.2, L.paint, L.trim)], hx, hz))
    for (const f of ['left', 'right', 'back'] as const) parts.push(...onFace(f, hw, hd, tierWindows(stage, f === 'back' ? hw : hd, 0.13, 2), hx, hz))
    if (stage >= 2) for (const f of FACES) parts.push(...onFace(f, hw, hd, tierWindows(stage, f === 'left' || f === 'right' ? hd : hw, 0.42, f === 'front' || f === 'back' ? 3 : 2), hx, hz))
    const top = 0.02 + hh
    // Forge flue.
    const flueX = hx - hw / 2 + 0.2, flueZ = hz - 0.12
    if (stage <= 2) parts.push(...gableRoof(hx, top, hz, hw + 0.04, hd + 0.06, 0.24, L.roof, 'x', wall))
    if (stage === 1) {
        chimney(spec, flueX, top, flueZ, 0.5, C.stone, 0.14)
        parts.push(...weathervane(hx + 0.18, top + 0.22, hz, 0.14))
        // Coal lean-to on the side.
        parts.push(box(0.43, 0.02, -0.14, 0.12, 0.28, 0.6, L.wall2), ...gableRoof(0.42, 0.3, -0.14, 0.16, 0.64, 0.1, L.roof, 'z', L.wall2), ball(0.42, 0.02, 0.26, 0.14, 0.08, C.iron, { seg: 6 }))
        parts.push(...lamp(-0.44, 0.24, L.metal), ...anvil(-0.2, 0.3), ...trough(0.08, 0.38), ...barrel(0.4, 0.02, 0.4, 0.09))
    } else if (stage === 2) {
        chimney(spec, flueX, top + 0.05, flueZ, 0.36, C.stone, 0.14)
        parts.push(...turret(0.38, 0.02, 0.06, 0.22, 0.86, L.wall2, C.accent, L.trim))
        parts.push(...onFace('front', hw, hd, [...banner(-0.26, 0.6, L.banner, L.trim, 0.08, 0.22), ...balconyParts(0.1, 0.34, 0.2, L.metal)], hx, hz))
        parts.push(...onFace('front', hw, hd, awningParts(-0.14, 0.26, 0.3, L.banner, L.wall2), hx, hz))
        parts.push(...lamp(-0.46, 0.3, L.metal), ...anvil(-0.2, 0.34), ...trough(0.06, 0.4), ...barrel(0.4, 0.02, 0.42, 0.09), ...crate(0.24, 0.02, 0.42, 0.09))
    } else if (stage === 3) {
        // Armoury: blue hip roof behind battlements, corner towers with teal caps.
        parts.push(...merlons(hx, top, hz, hw, hd, L.trim), ...hipRoof(hx, top + 0.055, hz, hw - 0.14, hd - 0.14, 0.2, L.roof, 0.1))
        for (const s of [-1, 1]) {
            const tx = s * 0.4, tzz = hz + hd / 2 - 0.06
            parts.push(box(tx, 0.02, tzz, 0.18, hh + 0.24, 0.18, L.wall), box(tx, hh + 0.23, tzz, 0.21, 0.03, 0.21, L.trim), ...hipRoof(tx, hh + 0.28, tzz, 0.22, 0.22, 0.2, C.accent, 0.02), ...finial(tx, hh + 0.47, tzz, L.metal, 0.08))
            parts.push(...onFace('front', 0.18, 0.18, [box(0, hh + 0.02, 0.004, 0.04, 0.12, 0.02, C.lit, { emissive: C.litGlow })], tx, tzz))
        }
        chimney(spec, flueX + 0.06, top + 0.2, flueZ, 0.34, C.stone, 0.14)
        parts.push(...onFace('front', hw, hd, banner(0, 0.62, L.banner, L.trim, 0.1, 0.2), hx, hz))
        // Weapon rack and yard.
        parts.push(box(-0.3, 0.02, 0.4, 0.28, 0.03, 0.06, C.woodDark), box(-0.3, 0.2, 0.4, 0.28, 0.02, 0.03, C.woodDark))
        for (let i = 0; i < 4; i++) parts.push(box(-0.41 + i * 0.075, 0.05, 0.4, 0.012, 0.28, 0.012, C.metalLight), cone(-0.41 + i * 0.075, 0.33, 0.4, 0.03, 0.05, C.metalLight, { seg: 4 }))
        parts.push(...anvil(0.05, 0.36), ...trough(0.3, 0.4), ...lamp(0.46, 0.24, L.metal))
    } else {
        // Guild hall under a gold roof, with a tall forge tower.
        parts.push(box(hx, top - 0.035, hz, hw + 0.025, 0.035, hd + 0.025, L.trim), ...hipRoof(hx, top + 0.025, hz, hw + 0.04, hd + 0.04, 0.22, L.roof, 0.2))
        parts.push(...onFace('front', hw, hd, [...banner(-0.38, hh - 0.04, L.banner, L.trim, 0.07, 0.3), ...banner(0.38, hh - 0.04, L.banner, L.trim, 0.07, 0.3)], hx, hz))
        const tx = -0.3, tzz = -0.3, tw = 0.26, th = 1.5
        parts.push(box(tx, 0.02, tzz, tw, th, tw, L.wall2), ...quoins(tx, tzz, tw, tw, 0.02, th, L.wall))
        for (const y of [0.74, 1.2]) parts.push(box(tx, 0.02 + y, tzz, tw + 0.025, 0.03, tw + 0.025, L.trim))
        for (const f of FACES) parts.push(...onFace(f, tw, tw, [box(0, 0.8, 0.004, 0.06, 0.3, 0.02, C.fire, { emissive: C.fire }), box(0, 1.26, 0.004, 0.1, 0.16, 0.02, C.fire, { emissive: C.fire })], tx, tzz))
        parts.push(...merlons(tx, 0.02 + th, tzz, tw + 0.02, tw + 0.02, L.trim, 0.05))
        parts.push(cyl(tx, 0.05 + th, tzz, 0.14, 0.12, C.iron, { seg: 8 }), cyl(tx, 0.17 + th, tzz, 0.1, 0.02, C.fire, { seg: 8, emissive: C.fire }))
        ;(spec.smoke ??= []).push([tx, 0.24 + th, tzz])
        parts.push(...anvil(-0.14, 0.34), ...trough(0.14, 0.4), ...lamp(-0.46, 0.3, L.metal), ...lamp(0.46, 0.3, L.metal), ...crate(0.34, 0.02, 0.4, 0.09))
    }
    return variant % 2 ? mirror(spec) : spec
}

// ─── Foundry ─────────────────────────────────────────────────────────────────
// Sooty brick casting hall at every look, with stacks that climb each tier:
// L1 a single-stack shed, L5 a clerestory hall, L10 a blast furnace and rose
// office, L15 three stacks and a teal-domed stone office, L20 a gold-crowned
// marble clock tower.

const FOUNDRY_BRICK = 0x9c3d2c

const foundry: Factory = (stage, variant) => {
    const L = tierLook(stage)
    const spec: ModelSpec = { parts: [ground([0x6d6a66, 0x5d5f61, 0x5d5f61, 0x8f8f89, 0xd9d3c3][stage]!)] }
    const parts = spec.parts
    const hw = [0.7, 0.96, 0.7, 0.66, 0.62][stage]!
    const hx = 0.5 - hw / 2 - 0.01
    const h = [0.38, 0.46, 0.54, 0.6, 0.64][stage]!
    const d = [0.62, 0.66, 0.68, 0.7, 0.7][stage]!
    const cz = -0.49 + d / 2
    parts.push(box(hx, 0.02, cz, hw, h, d, FOUNDRY_BRICK), box(hx, 0.02, cz, hw + 0.02, 0.07, d + 0.02, C.brickDark), box(hx, 0.02 + h - 0.03, cz, hw + 0.02, 0.03, d + 0.02, stage >= 3 ? L.trim : C.brickDark))
    const piers = Math.round(hw / 0.2)
    for (let i = 0; i <= piers; i++) parts.push(box(hx - hw / 2 + 0.02 + i * (hw - 0.04) / piers, 0.02, cz + d / 2, 0.05, h, 0.03, C.brickDark))
    parts.push(...onFace('front', hw, d, [box(0.06, 0.2, 0.02, hw - 0.28, 0.09, 0.02, C.fire, { emissive: C.fire }), box(-hw / 2 + 0.1, 0.02, 0.022, 0.14, 0.2, 0.02, C.iron)], hx, cz))
    for (const f of ['left', 'right', 'back'] as const) parts.push(...onFace(f, hw, d, [box(0, 0.2, 0.004, (f === 'back' ? hw : d) - 0.2, 0.08, 0.02, C.fire, { emissive: C.fire })], hx, cz))
    // Roof, with a clerestory monitor from L5.
    parts.push(...gableRoof(hx, 0.02 + h, cz, hw + 0.04, d + 0.04, 0.16, L.roof, 'x', FOUNDRY_BRICK))
    if (stage >= 1) parts.push(box(hx, 0.02 + h + 0.13, cz, hw * 0.7, 0.07, 0.16, FOUNDRY_BRICK), box(hx, 0.02 + h + 0.14, cz + 0.08, hw * 0.66, 0.04, 0.01, C.fire, { emissive: C.fire }), ...gableRoof(hx, 0.02 + h + 0.2, cz, hw * 0.7 + 0.06, 0.22, 0.06, L.roof, 'x'))
    // Stacks along the back, taller every look.
    const stacks = [1, 2, 2, 3, 3][stage]!
    const sh = [0.5, 0.64, 0.76, 0.9, 1.0][stage]!
    const band = stage >= 4 ? L.trim : stage >= 3 ? L.metal : C.iron
    for (let i = 0; i < stacks; i++) stack(spec, hx + (i - (stacks - 1) / 2) * 0.2, cz - d / 2 + 0.12, 0.02 + h, sh + (i % 2) * 0.08, 0.11, C.brick, band)
    // Yard: ingots, slag and the pouring ladle.
    for (let i = 0; i < 2 + stage; i++) parts.push(box(0.24 + (i % 2) * 0.13, 0.02 + Math.floor(i / 2) * 0.035, 0.4, 0.11, 0.03, 0.06, i % 3 ? C.metalLight : C.metal))
    parts.push(ball(-0.06, 0.02, 0.4, 0.18, 0.1, 0x3e4044, { seg: 6 }), cyl(0.06, 0.02, 0.24, 0.1, 0.09, C.iron, { seg: 8 }), cyl(0.06, 0.105, 0.24, 0.075, 0.008, C.fire, { seg: 8, emissive: C.fire }))
    if (stage === 0) {
        // Lean-to for moulds and a sand heap.
        parts.push(box(-0.39, 0.02, -0.2, 0.2, 0.26, 0.56, C.wood), ...gableRoof(-0.39, 0.28, -0.2, 0.24, 0.6, 0.1, L.roof, 'z', C.wood), ball(-0.36, 0.02, 0.3, 0.2, 0.08, 0xd8c08a, { seg: 6 }))
        return variant % 2 ? mirror(spec) : spec
    }
    if (stage === 1) {
        parts.push(...lamp(-0.44, 0.44, L.metal), ...lamp(0.46, 0.2, L.metal), ...weathervane(hx + 0.3, 0.02 + h + 0.16, cz, 0.12), ball(-0.36, 0.02, 0.32, 0.2, 0.08, 0xd8c08a, { seg: 6 }), ...crate(-0.26, 0.02, 0.42))
        return variant % 2 ? mirror(spec) : spec
    }
    // Blast furnace rising beside the hall.
    const fx = -0.36, fz = -0.34
    const fh = [0, 0, 0.9, 1.04, 1.1][stage]!
    parts.push(cyl(fx, 0.02, fz, 0.24, fh, 0x6f7a84, { seg: 10 }), ...[0.25, 0.5, 0.75].map(t => cyl(fx, 0.02 + fh * t, fz, 0.26, 0.025, band, { seg: 10 })), cone(fx, 0.02 + fh, fz, 0.24, 0.08, C.iron, { seg: 10 }), cyl(fx, 0.02 + fh + 0.05, fz, 0.07, 0.05, C.fire, { seg: 8, emissive: C.fire }))
    parts.push(box((fx + hx - hw / 2) / 2, 0.02 + fh * 0.6, fz, hx - hw / 2 - fx, 0.04, 0.04, C.metalLight))
    ;(spec.smoke ??= []).push([fx, 0.14 + fh, fz])
    // Office on the front corner.
    const ox = -0.34, oz = 0.22, ow = 0.3, od = 0.4
    const oh = [0, 0, 0.36, 0.46, 0.5][stage]!
    parts.push(box(ox, 0.02, oz, ow, oh, od, L.wall), box(ox, 0.02, oz, ow + 0.01, 0.05, od + 0.01, L.wall2))
    parts.push(...onFace('front', ow, od, [...doorway(-0.06, 0.02, 0.09, 0.17, L.paint, L.trim), ...tierWindows(stage, 0.12, 0.13, 1).map(p => ({ ...p, x: p.x + 0.08 })), ...tierWindows(stage, ow, 0.3, 2)], ox, oz))
    parts.push(...onFace('right', ow, od, tierWindows(stage, od, 0.2, 2), ox, oz))
    if (stage === 2) {
        parts.push(...gableRoof(ox, 0.02 + oh, oz, ow + 0.04, od + 0.04, 0.16, L.roof, 'z', L.wall), ...flag(ox, 0.02 + oh + 0.14, oz, L.banner, 0.18))
        parts.push(...onFace('front', ow, od, awningParts(-0.06, 0.22, 0.16, L.banner, L.wall2), ox, oz), ...lamp(-0.1, 0.44, L.metal))
    } else if (stage === 3) {
        parts.push(box(ox, 0.02 + oh - 0.03, oz, ow + 0.02, 0.03, od + 0.02, L.trim), ...quoins(ox, oz, ow, od, 0.02, oh, L.trim), ...balustrade(ox, 0.02 + oh, oz, ow, od, L.trim))
        parts.push(dome(ox, 0.02 + oh, oz, 0.2, 0.16, C.accent, { seg: 8 }), ...finial(ox, 0.02 + oh + 0.15, oz, L.metal, 0.08))
        parts.push(...lamp(-0.1, 0.44, L.metal))
    } else {
        parts.push(box(ox, 0.02 + oh - 0.035, oz, ow + 0.025, 0.035, od + 0.025, L.trim), ...hipRoof(ox, 0.02 + oh + 0.025, oz, ow + 0.04, od + 0.04, 0.16, L.roof, 0.04))
        parts.push(...onFace('front', ow, od, banner(0.1, oh - 0.02, L.banner, L.trim, 0.06, 0.2), ox, oz))
        // Clock tower: marble shaft, gold crown, lit clock faces.
        const tx = -0.02, tzz = 0.12, tw = 0.22, th = 1.36
        parts.push(box(tx, 0.02, tzz, tw, th, tw, L.wall), box(tx, 0.02, tzz, tw + 0.02, 0.08, tw + 0.02, L.wall2), ...quoins(tx, tzz, tw, tw, 0.02, th - 0.2, L.wall2))
        for (const y of [0.6, th - 0.24, th - 0.03]) parts.push(box(tx, 0.02 + y, tzz, tw + 0.03, 0.03, tw + 0.03, L.trim))
        for (const f of FACES) parts.push(...onFace(f, tw, tw, clock(th - 0.12, 0.13, L.trim), tx, tzz))
        parts.push(...onFace('front', tw, tw, [box(0, 0.3, 0.004, 0.07, 0.16, 0.02, C.lit, { emissive: C.litGlow }), box(0, 0.7, 0.004, 0.07, 0.14, 0.02, C.lit, { emissive: C.litGlow })], tx, tzz))
        parts.push(...merlons(tx, 0.02 + th, tzz, tw + 0.02, tw + 0.02, L.trim, 0.05), ...hipRoof(tx, 0.05 + th, tzz, tw - 0.06, tw - 0.06, 0.24, L.roof, 0.02), ...finial(tx, 0.05 + th + 0.23, tzz, L.trim, 0.18))
        parts.push(...lamp(0.14, 0.44, L.metal))
    }
    return variant % 2 ? mirror(spec) : spec
}

// ─── Factory ─────────────────────────────────────────────────────────────────
// The saw-tooth roof and stacks stay; the block grows a storey most looks:
// L1 a plaster workshop, L5 a brick mill with a water tank, L10 rose with a
// stair tower and fan, L15 white stone with a teal-domed tower, L20 marble
// with a gold-crowned clock tower.

const factory: Factory = (stage, variant) => {
    const L = tierLook(stage)
    const spec: ModelSpec = { parts: [ground([0xb3aa98, C.stone, C.cobble, C.paving, 0xe9e2d0][stage]!)], spinners: [] }
    const parts = spec.parts
    const wall = stage === 1 ? L.wall2 : L.wall
    const floors = [1, 2, 2, 3, 3][stage]!
    const fh = 0.26
    const h = 0.08 + floors * fh + (stage >= 4 ? 0.06 : 0)
    const bw = stage >= 2 ? 0.74 : 0.96, bx = 0.5 - bw / 2 - 0.02
    const bd = 0.86, bz = -0.05
    parts.push(box(bx, 0.02, bz, bw, h, bd, wall), box(bx, 0.02, bz, bw + 0.02, 0.07, bd + 0.02, stage >= 3 ? L.trim : shade(wall, -0.15)))
    const post = stage === 0 || stage >= 3 ? L.trim : shade(wall, -0.12)
    for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(bx + x * (bw / 2 - 0.03), 0.02, bz + z * (bd / 2 - 0.03), 0.07, h, 0.07, post))
    if (stage >= 3) parts.push(box(bx, 0.02 + h - 0.035, bz, bw + 0.025, 0.035, bd + 0.025, L.trim))
    parts.push(...onFace('front', bw, bd, [box(-bw / 2 + 0.2, 0.02, 0.004, 0.24, 0.2, 0.02, C.iron), ...[0.06, 0.11, 0.16].map(y => box(-bw / 2 + 0.2, y, 0.012, 0.22, 0.012, 0.012, C.metal)), ...doorway(bw / 2 - 0.14, 0.02, 0.1, 0.18, L.paint, L.trim)], bx, bz))
    const glaze = stage >= 3 ? { color: C.lit, emissive: C.litGlow } : { color: 0xbfe3f5, emissive: 0x5aa9d6 }
    for (let floor = 0; floor < floors; floor++) {
        const y = 0.13 + floor * fh
        for (const f of FACES) {
            if (f === 'front' && floor === 0) continue
            const span = (f === 'left' || f === 'right' ? bd : bw) - 0.2
            const mullions = Math.round(span / 0.18)
            parts.push(...onFace(f, bw, bd, [box(0, y, 0.004, span, 0.1, 0.02, glaze.color, { emissive: glaze.emissive }), ...Array.from({ length: mullions - 1 }, (_, i) => box(-span / 2 + (i + 1) * span / mullions, y, 0.01, 0.015, 0.1, 0.02, post))], bx, bz))
        }
    }
    // Saw-tooth roof in the tier's roof colour, each tooth with north-light glazing.
    const top = 0.02 + h
    const td = bd / 3
    for (let i = 0; i < 3; i++) {
        const z = bz - bd / 2 + td / 2 + i * td
        for (let step = 0; step < 3; step++) parts.push(box(bx, top + step * 0.04, z - step * td * 0.156, bw + 0.02, 0.04, td * (1 - step * 0.3125), step % 2 ? shade(L.roof, -0.08) : L.roof))
        parts.push(box(bx, top + 0.02, z + td * 0.18, bw - 0.08, 0.09, 0.01, glaze.color, { emissive: glaze.emissive }))
    }
    // Stacks at the back, taller every look.
    const stacks = [1, 2, 2, 3, 3][stage]!
    const sh = [0.46, 0.56, 0.66, 0.76, 0.86][stage]!
    const band = stage >= 4 ? L.trim : stage >= 3 ? L.metal : C.iron
    for (let i = 0; i < stacks; i++) stack(spec, bx + bw / 2 - 0.14 - i * 0.2, bz - bd / 2 + 0.1, top, sh + i * 0.06, 0.1, stage >= 1 ? C.brick : C.metalLight, band)
    if (stage === 0) {
        parts.push(...crate(-0.3, 0.02, 0.45), ...crate(-0.18, 0.02, 0.45, 0.09), ...barrel(0.3, 0.02, 0.45))
        return variant % 2 ? mirror(spec) : spec
    }
    if (stage === 1) {
        // Water tank on the roof, lamps at the door.
        parts.push(...[-1, 1].map(s => box(-0.2 + s * 0.08, top + 0.12, 0.2, 0.025, 0.14, 0.025, C.iron)), cyl(-0.2, top + 0.26, 0.2, 0.22, 0.16, C.wood, { seg: 10 }), cyl(-0.2, top + 0.32, 0.2, 0.23, 0.015, C.iron, { seg: 10 }), ...coneRoof(-0.2, top + 0.42, 0.2, 0.24, 0.07, L.roof))
        parts.push(...lamp(0.2, 0.46, L.metal), ...lamp(0.46, 0.46, L.metal), ...weathervane(0.3, top + 0.12, 0.2, 0.14), ...crate(-0.3, 0.02, 0.45))
        return variant % 2 ? mirror(spec) : spec
    }
    // A tower on the free side: stairs at L10, a teal-domed tower at L15, the clock tower at L20.
    const tw = 0.22, tx = -0.5 + tw / 2 + 0.02
    const th = [0, 0, 1.0, 1.24, 1.5][stage]!
    const tz = 0.14
    const tWall = stage === 2 ? L.wall2 : L.wall
    parts.push(box(tx, 0.02, tz, tw, th, tw, tWall), box(tx, 0.02, tz, tw + 0.01, 0.06, tw + 0.01, stage >= 3 ? L.trim : shade(tWall, -0.15)))
    if (stage >= 3) parts.push(...quoins(tx, tz, tw, tw, 0.02, th, stage >= 4 ? L.wall2 : L.trim))
    parts.push(...onFace('front', tw, tw, doorway(0, 0.02, 0.1, 0.18, L.paint, L.trim), tx, tz))
    for (let y = 0.3; y < th - 0.28; y += 0.26) for (const f of ['front', 'left'] as const) parts.push(...onFace(f, tw, tw, tierWindows(stage, tw, y, 1, 0.07, 0.11), tx, tz))
    // Low annexe behind the tower keeps the tile filled.
    const aWall = stage >= 3 ? L.wall2 : wall
    parts.push(box(tx, 0.02, -0.25, tw, 0.36, 0.5, aWall), ...gableRoof(tx, 0.38, -0.25, tw + 0.04, 0.52, 0.12, L.roof, 'z', aWall))
    parts.push(...onFace('left', tw, 0.5, tierWindows(stage, 0.5, 0.14, 2), tx, -0.25))
    parts.push(...lamp(0.0, 0.46, L.metal))
    if (stage === 2) {
        parts.push(box(tx, 0.02 + th - 0.03, tz, tw + 0.03, 0.03, tw + 0.03, L.trim), ...hipRoof(tx, 0.02 + th + 0.025, tz, tw + 0.06, tw + 0.06, 0.18, L.roof, 0.03), ...flag(tx, 0.02 + th + 0.16, tz, L.banner, 0.2))
        parts.push(...onFace('right', tw, tw, banner(0, th - 0.08, L.banner, L.trim, 0.08, 0.22), tx, tz))
        const pivot: [number, number, number] = [bx - 0.12, top + 0.22, 0.2]
        parts.push(cyl(bx - 0.12, top + 0.08, 0.2, 0.16, 0.14, C.metal, { seg: 10 }))
        spec.spinners!.push({ pivot, axis: 'y', parts: [0, 1].map(k => box(pivot[0], pivot[1] - 0.006, pivot[2], 0.2, 0.012, 0.035, C.metalLight, { rotY: k * Math.PI / 2 })) })
    } else if (stage === 3) {
        parts.push(box(tx, 0.02 + th - 0.035, tz, tw + 0.03, 0.035, tw + 0.03, L.trim), ...balustrade(tx, 0.02 + th, tz, tw + 0.02, tw + 0.02, L.trim), dome(tx, 0.02 + th, tz, 0.18, 0.18, C.accent, { seg: 8 }), ...finial(tx, 0.02 + th + 0.17, tz, L.metal, 0.1))
        parts.push(...balustrade(bx, top, bz, bw, bd, L.trim, ['front']))
        parts.push(cyl(bx - 0.12, top + 0.04, 0.2, 0.2, 0.2, L.wall2, { seg: 10 }), dome(bx - 0.12, top + 0.24, 0.2, 0.2, 0.08, C.accent, { seg: 10 }))
    } else {
        // Clock tower, gold-crowned, over the marble works.
        parts.push(box(tx, 0.02 + th - 0.035, tz, tw + 0.03, 0.035, tw + 0.03, L.trim), box(tx, 0.02 + th - 0.34, tz, tw + 0.03, 0.03, tw + 0.03, L.trim))
        for (const f of FACES) parts.push(...onFace(f, tw, tw, clock(th - 0.17, 0.13, L.trim), tx, tz))
        parts.push(...merlons(tx, 0.02 + th, tz, tw + 0.02, tw + 0.02, L.trim, 0.05), ...hipRoof(tx, 0.05 + th, tz, tw - 0.06, tw - 0.06, 0.26, L.roof, 0.02), ...finial(tx, 0.05 + th + 0.25, tz, L.trim, 0.18))
        parts.push(...onFace('front', bw, bd, [...banner(-0.08, h - 0.04, L.banner, L.trim, 0.07, 0.28), ...banner(0.14, h - 0.04, L.banner, L.trim, 0.07, 0.28)], bx, bz))
        parts.push(...balustrade(bx, top, bz, bw, bd, L.trim, ['front']))
    }
    return variant % 2 ? mirror(spec) : spec
}

export const INDUSTRY_MODELS: Partial<Record<TownBuildingId, Factory>> = {
    mill, sawmill, kiln, smithy, foundry, factory
}
