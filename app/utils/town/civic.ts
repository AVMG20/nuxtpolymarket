// Polytown — civic landmarks. Like everything else they own the whole tile: a
// park is lawn to the kerb, the bathhouse, theatre and warehouse are
// full-width blocks. Every look is a new building, not a new prop: the park
// grows a bandstand and then a glasshouse, the warehouse goes from a plank
// barn to a brick depot to a stone clock-tower storehouse. Colours come from
// tierLook(stage); the tile variant only mirrors the plan.

import type { TownBuildingId } from '#shared/utils/gamelogic/town'
import { C, awning, balcony, ball, barrel, box, chimney, column, cone, coneRoof, crate, cyl, dome, flag, flowerBed, gableRoof, ground, hipRoof, lantern, onFace, roundTree, shade, tierLook, turret, weathervane, windowAt, windowRow, type Face, type ModelSpec, type Part, type TierLook } from './kit'

type Factory = (stage: number, variant: number) => ModelSpec

const FACES: Face[] = ['front', 'back', 'left', 'right']
/** Glasshouse panes: pale aqua that glows faintly at night. */
const GLASS = 0x9fd6d6
/** The theatre's own colour: curtains, drapes and playbills on every look. */
const CURTAIN = C.wine
const GOLD_GLOW = 0x6a4a10

/** Mirror a finished model left to right, so odd tiles swap their towers and chimneys. */
function mirrored(spec: ModelSpec, variant: number): ModelSpec {
    if (variant % 2 === 0) return spec
    const flip = (p: Part): Part => ({ ...p, x: -p.x, rotY: p.rotY && -p.rotY, rotZ: p.rotZ && -p.rotZ, faceY: p.faceY && -p.faceY })
    return { ...spec, parts: spec.parts.map(flip), smoke: spec.smoke?.map(([x, y, z]) => [-x, y, z]) }
}

/** Cornice band that wraps a w×d block and caps its top by a hair, so no two tops share a plane. */
function cornice(x: number, top: number, z: number, w: number, d: number, color: number, h = 0.035): Part {
    return box(x, top - h + 0.006, z, w + 0.03, h, d + 0.03, color)
}

/** Dressed stone corners on a w×d block from y0 to y1. */
function quoins(x: number, z: number, w: number, d: number, y0: number, y1: number, color: number): Part[] {
    const parts: Part[] = []
    for (let y = y0, i = 0; y < y1 - 0.03; y += 0.07, i++) {
        const s = i % 2 ? 0.05 : 0.08
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(x + sx * (w / 2 - s / 2 + 0.006), y, z + sz * (d / 2 - 0.03 + 0.006), s, 0.05, 0.06, color))
    }
    return parts
}

/** Windows at chosen x positions along a wall (to skip doors and towers). */
function windowsAt(xs: number[], y: number, o: { w?: number, h?: number, shutters?: number, lit?: number, frame?: number, sill?: boolean } = {}): Part[] {
    return xs.flatMap((x, i) => windowAt(x, y, o.w, o.h, { shutters: o.shutters, frame: o.frame, sill: o.sill, lit: (i + (o.lit ?? 0)) % 2 === 0 }))
}

function bench(x: number, z: number, faceY = 0): Part[] {
    return [box(x, 0.06, z, 0.16, 0.015, 0.05, C.wood, { faceY }), box(x, 0.02, z, 0.14, 0.04, 0.03, C.iron, { faceY })]
}

// ─── Park ────────────────────────────────────────────────────────────────────
// L1 a lawn with a fountain, L5 hedged gardens around a bandstand, L10 a
// domed glasshouse across the back with a tiered fountain out front.

function fountain(x: number, z: number, s: number, tiers: number, trim: number): Part[] {
    const g = 0.035
    const parts = [
        cyl(x, g, z, 0.3 * s, 0.05, C.stoneLight, { seg: 12 }),
        cyl(x, g + 0.05, z, 0.25 * s, 0.004, C.water, { seg: 12, flat: true }),
        cyl(x, g + 0.05, z, 0.05, 0.1 + tiers * 0.06, C.stoneLight, { seg: 8 })
    ]
    let y = g + 0.15
    for (let t = 0; t < tiers; t++) {
        const bw = (0.16 - t * 0.04) * s
        parts.push(cyl(x, y, z, bw, 0.02, trim, { seg: 10 }), cyl(x, y + 0.02, z, bw - 0.03, 0.004, C.water, { seg: 10, flat: true }))
        y += 0.06
    }
    parts.push(ball(x, y - 0.04, z, 0.05, 0.07, 0xbfe6ec, { seg: 6 }))
    return parts
}

function bandstand(x: number, z: number, roof: number, trim: number): Part[] {
    const parts = [cyl(x, 0.03, z, 0.34, 0.06, C.stoneLight, { seg: 8 }), cyl(x, 0.09, z, 0.3, 0.012, C.plank, { seg: 8 })]
    for (let i = 0; i < 6; i++) parts.push(cyl(x + Math.cos(i * Math.PI / 3) * 0.12, 0.1, z + Math.sin(i * Math.PI / 3) * 0.12, 0.022, 0.22, trim, { seg: 5 }))
    parts.push(cyl(x, 0.32, z, 0.34, 0.025, trim, { seg: 8 }), ...coneRoof(x, 0.345, z, 0.36, 0.2, roof, 8), ...weathervane(x, 0.53, z, 0.16))
    return parts
}

function glasshouse(parts: Part[], stage: number, L: TierLook) {
    const z = -0.27, y0 = 0.09
    const drumH = 0.38 + (stage - 2) * 0.08
    parts.push(box(0, 0.03, z, 0.96, 0.06, 0.44, L.wall), box(0, 0.03, z + 0.24, 0.24, 0.03, 0.06, C.stoneLight))
    // Low glass wings under pitched roofs.
    for (const sx of [-1, 1]) {
        const x = sx * 0.3
        parts.push(box(x, y0, z, 0.34, 0.22, 0.34, GLASS))
        for (const f of ['front', 'back'] as const) parts.push(...onFace(f, 0.34, 0.34, [-0.1, 0, 0.1].map(mx => box(mx, y0, 0.004, 0.015, 0.22, 0.01, L.trim)), x, z))
        parts.push(...onFace(sx > 0 ? 'right' : 'left', 0.34, 0.34, [-0.08, 0.08].map(mx => box(mx, y0, 0.004, 0.015, 0.22, 0.01, L.trim)), x, z))
        parts.push(cornice(x, y0 + 0.22, z, 0.34, 0.34, L.trim, 0.025), ...gableRoof(x, y0 + 0.226, z, 0.38, 0.38, 0.14, L.roof, 'x', GLASS))
    }
    // Glass rotunda under a dome, with a teal lantern on top.
    parts.push(cyl(0, y0, z, 0.42, drumH, GLASS, { seg: 8, emissive: 0x1d4f4f }), cyl(0, y0, z, 0.44, 0.05, L.wall, { seg: 8 }), cyl(0, y0 + drumH * 0.5, z, 0.435, 0.02, L.trim, { seg: 8 }))
    const top = y0 + drumH
    parts.push(cyl(0, top - 0.02, z, 0.46, 0.04, L.trim, { seg: 8 }), dome(0, top + 0.02, z, 0.44, 0.26, L.roof, { seg: 8 }))
    parts.push(cyl(0, top + 0.26, z, 0.1, 0.08, L.trim, { seg: 8 }), dome(0, top + 0.34, z, 0.12, 0.08, C.accent, { seg: 8 }))
    if (stage >= 4) parts.push(cone(0, top + 0.41, z, 0.05, 0.26, C.gold, { seg: 6 }), ball(0, top + 0.64, z, 0.05, 0.05, C.gold, { seg: 6, emissive: GOLD_GLOW }))
    else parts.push(...flag(0, top + 0.41, z, L.banner, 0.22))
    // Porch on the rotunda's front.
    parts.push(box(0, y0, z + 0.2, 0.16, 0.22, 0.1, L.wall), box(0, y0, z + 0.256, 0.1, 0.16, 0.012, L.paint), ...gableRoof(0, y0 + 0.22, z + 0.2, 0.2, 0.12, 0.08, L.roof, 'z', L.wall))
}

const park: Factory = (stage, variant) => {
    const L = tierLook(stage)
    const spec: ModelSpec = { parts: [ground(C.grass, 0.03)] }
    const parts = spec.parts
    const g = 0.03
    const crowns = [C.leaf, C.bloomPink, C.leafDark, C.leafLight]
    if (stage < 2) {
        parts.push(box(0, g, 0, 0.14, 0.006, 1, C.paving, { flat: true }), box(0, g, 0, 1, 0.006, 0.14, C.paving, { flat: true }), cyl(0, g, 0, 0.44, 0.008, C.paving, { seg: 12, flat: true }))
        parts.push(...fountain(0, 0, stage ? 1.15 : 1, stage + 1, stage ? L.trim : C.stone))
        const corners: [number, number][] = [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]]
        corners.forEach(([x, z], i) => {
            if (stage >= 1 && i === 1) return
            parts.push(...roundTree(x, z, 0.95 + stage * 0.1 + (i % 2) * 0.05, crowns[i]!, g))
        })
        parts.push(...bench(-0.17, 0.14, Math.PI / 2), ...bench(0.17, -0.14, Math.PI / 2), ...flowerBed(-0.3, 0.12, 0.26, 0.07, g))
        if (stage === 0) parts.push(...flowerBed(0.3, -0.12, 0.26, 0.07, g))
        else {
            // Clipped hedges to the kerb and a bandstand in the far corner.
            for (const [x, z] of [[-0.29, 0.47], [0.29, 0.47], [-0.29, -0.47]] as const) parts.push(box(x, g, z, 0.4, 0.07, 0.05, C.leafDark))
            for (const [x, z] of [[-0.47, 0.29], [0.47, 0.29], [-0.47, -0.29]] as const) parts.push(box(x, g, z, 0.05, 0.07, 0.4, C.leafDark))
            parts.push(...flowerBed(0.3, 0.12, 0.26, 0.07, g), ...flowerBed(-0.3, -0.12, 0.26, 0.07, g), ...lantern(0.12, 0.12, g), ...lantern(-0.12, -0.12, g))
            parts.push(...bandstand(0.3, -0.3, L.roof, L.trim))
        }
        return mirrored(spec, variant)
    }
    // Glasshouse garden: the walk runs from the kerb to the rotunda's porch.
    parts.push(box(0, g, 0.21, 0.16, 0.006, 0.58, C.paving, { flat: true }), box(0, g, 0.2, 1, 0.006, 0.14, C.paving, { flat: true }), cyl(0, g, 0.2, 0.46, 0.008, C.paving, { seg: 12, flat: true }))
    parts.push(...fountain(0, 0.2, 1.3, 3, L.trim))
    for (const sx of [-1, 1]) {
        parts.push(...roundTree(sx * 0.35, 0.37, 0.9, crowns[sx > 0 ? 1 : 0]!, g), ...lantern(sx * 0.12, 0.42, g), ...bench(sx * 0.35, 0.08))
        parts.push(box(sx * 0.47, g, 0.2, 0.05, 0.07, 0.56, C.leafDark), ...flowerBed(sx * 0.3, -0.02, 0.26, 0.06, g))
    }
    glasshouse(parts, stage, L)
    return mirrored(spec, variant)
}

// ─── Bathhouse ───────────────────────────────────────────────────────────────
// L1 a timber bath hut with a stove and a plank pool, L5 a domed thermae
// with a portico, a furnace stack and a stone pool.

const bathhouse: Factory = (stage, variant) => {
    const L = tierLook(stage)
    const spec: ModelSpec = { parts: [ground(C.paving)] }
    const parts = spec.parts
    if (stage === 0) {
        const cz = -0.2, d = 0.56, w = 0.96, fw = w - 0.02, fd = d - 0.02
        parts.push(box(0, 0.02, cz, w, 0.06, d, C.stone), box(0, 0.08, cz, fw, 0.3, fd, L.wall))
        for (const f of ['front', 'back'] as const) parts.push(...onFace(f, fw, fd, [...[-0.455, -0.16, 0.16, 0.455].map(x => box(x, 0.08, 0.004, 0.03, 0.3, 0.012, L.trim)), box(0, 0.35, 0.006, fw, 0.03, 0.012, L.trim)], 0, cz))
        for (const f of ['left', 'right'] as const) parts.push(...onFace(f, fw, fd, [box(0, 0.35, 0.006, fd, 0.03, 0.012, L.trim), box(-0.05, 0.08, 0.004, 0.03, 0.3, 0.012, L.trim), ...windowAt(0.12, 0.18, 0.08, 0.1, { shutters: L.paint })], 0, cz))
        parts.push(...onFace('front', fw, fd, [box(0, 0.08, 0.006, 0.14, 0.21, 0.02, L.paint), box(0, 0.08, 0.003, 0.18, 0.23, 0.014, L.trim), ...windowsAt([-0.3, 0.3], 0.17, { w: 0.1, h: 0.1, shutters: L.paint, lit: 1 })], 0, cz))
        parts.push(...gableRoof(0, 0.38, cz, 1, d + 0.06, 0.24, L.roof, 'x', L.wall))
        chimney(spec, 0.3, 0.38, cz - 0.1, 0.36, C.stone, 0.1)
        // Plank-decked plunge pool out front, a towel rack and barrels beside it.
        parts.push(box(0, 0.02, 0.29, 0.94, 0.04, 0.38, C.plank), box(0, 0.06, 0.29, 0.72, 0.006, 0.24, C.water, { flat: true }))
        for (const s of [-1, 1]) parts.push(box(0, 0.06, 0.29 + s * 0.14, 0.8, 0.03, 0.04, C.woodDark), box(s * 0.38, 0.06, 0.29, 0.04, 0.03, 0.24, C.woodDark))
        parts.push(...barrel(-0.44, 0.06, 0.43, 0.08), ...barrel(0.44, 0.06, 0.43, 0.08), box(0.44, 0.06, 0.16, 0.06, 0.1, 0.03, C.wood), box(0.44, 0.13, 0.16, 0.07, 0.04, 0.05, C.bloomWhite))
        return mirrored(spec, variant)
    }
    const h = 0.5 + (stage - 1) * 0.1
    const cz = -0.18, d = 0.6, w = 0.96, base = 0.055
    const top = base + h
    parts.push(box(0, 0.02, 0, 1, 0.035, 1, C.stoneLight), box(0, base, cz, w, h, d, L.wall), box(0, base, cz, w + 0.012, 0.1, d + 0.012, L.wall2), cornice(0, top, cz, w, d, L.trim), box(0, top, cz, w - 0.06, 0.012, d - 0.06, shade(L.roof, -0.1)))
    if (stage >= 3) parts.push(...quoins(0, cz, w, d, base + 0.1, top - 0.03, L.trim))
    // Drum and dome, with a teal cupola at each shoulder.
    const drum = 0.12 + (stage - 1) * 0.04
    parts.push(cyl(0, top, cz, 0.5, drum, L.wall2, { seg: 12 }), cyl(0, top + drum - 0.03, cz, 0.54, 0.035, L.trim, { seg: 12 }), dome(0, top + drum + 0.005, cz, 0.52, 0.3, L.roof, { seg: 12 }))
    const crown = top + drum + 0.3
    parts.push(cyl(0, crown - 0.02, cz, 0.09, 0.07, L.trim, { seg: 8 }), dome(0, crown + 0.05, cz, 0.1, 0.07, C.accent, { seg: 8 }))
    if (stage >= 4) parts.push(cone(0, crown + 0.11, cz, 0.045, 0.24, C.gold, { seg: 6 }), ball(0, crown + 0.33, cz, 0.05, 0.05, C.gold, { seg: 6, emissive: GOLD_GLOW }))
    else parts.push(...weathervane(0, crown + 0.11, cz, 0.16))
    for (const x of [-0.36, 0.36]) parts.push(cyl(x, top, cz + 0.02, 0.18, 0.05, L.trim, { seg: 8 }), dome(x, top + 0.05, cz + 0.02, 0.17, 0.11, C.accent, { seg: 8 }), ball(x, top + 0.155, cz + 0.02, 0.03, 0.04, L.metal, { seg: 5 }))
    chimney(spec, -0.22, top, cz - 0.23, 0.26, C.brick, 0.09)
    // Portico with a pediment.
    const col = h - 0.06
    for (const x of [-0.36, -0.12, 0.12, 0.36]) parts.push(...column(x, base, 0.2, col, C.white, L.trim))
    parts.push(box(0, base + col, 0.165, 0.92, 0.06, 0.14, L.trim), ...gableRoof(0, top, 0.165, 0.94, 0.16, 0.12, L.roof, 'z', L.trim))
    parts.push(...onFace('front', w, d, [box(0, base, 0.008, 0.16, 0.26, 0.02, L.paint), box(0, base, 0.003, 0.2, 0.29, 0.014, L.trim), ...[-0.24, 0.24].map(x => box(x, base + 0.12, 0.004, 0.13, 0.2, 0.02, 0x7fd6d0, { emissive: 0x2f8f86 }))], 0, cz))
    for (const f of ['back', 'left', 'right'] as const) parts.push(...onFace(f, w, d, windowRow(f === 'back' ? w : d, base + 0.16, f === 'back' ? 4 : 3, { h: 0.2, w: 0.09, lit: 1, frame: L.trim }), 0, cz))
    // Stone pool with a statue, lanterns at the kerb.
    parts.push(box(0, base, 0.38, 0.84, 0.03, 0.22, C.stoneLight), box(0, base + 0.03, 0.38, 0.76, 0.006, 0.15, C.water, { flat: true }), box(0, base + 0.03, 0.38, 0.06, 0.08, 0.06, L.trim), ball(0, base + 0.11, 0.38, 0.05, 0.08, C.white, { seg: 6 }))
    parts.push(...lantern(-0.46, 0.46, base), ...lantern(0.46, 0.46, base))
    if (stage >= 2) for (const x of [-0.4, 0.4]) parts.push(...flag(x, top + 0.006, cz - 0.26, L.banner, 0.26))
    return mirrored(spec, variant)
}

// ─── Theatre ─────────────────────────────────────────────────────────────────
// L1 a round timber playhouse under a cone roof, L5 an opera house with a
// portico and a fly tower. Wine curtains on every look.

const theatre: Factory = (stage, variant) => {
    const L = tierLook(stage)
    const spec: ModelSpec = { parts: [ground(C.cobble)] }
    const parts = spec.parts
    if (stage === 0) {
        const cz = -0.06, r = 0.43
        parts.push(cyl(0, 0.02, cz, 2 * r, 0.4, L.wall, { seg: 8 }), cyl(0, 0.02, cz, 2 * r + 0.015, 0.05, L.trim, { seg: 8 }), cyl(0, 0.2, cz, 2 * r + 0.012, 0.025, L.trim, { seg: 8 }), cyl(0, 0.38, cz, 2 * r + 0.02, 0.046, L.trim, { seg: 8 }))
        // Posts at the corners of the octagon and a gallery window on each face.
        const ap = r * Math.cos(Math.PI / 8)
        for (let i = 0; i < 8; i++) {
            const a = Math.PI / 8 + i * Math.PI / 4
            parts.push(box(Math.sin(a) * (ap + 0.005), 0.26, cz + Math.cos(a) * (ap + 0.005), 0.08, 0.08, 0.012, i % 2 ? C.lit : C.glass, { faceY: a, ...(i % 2 ? { emissive: C.litGlow } : {}) }))
            const v = Math.PI / 4 * i
            parts.push(box(Math.sin(v) * (r - 0.012), 0.02, cz + Math.cos(v) * (r - 0.012), 0.035, 0.4, 0.035, L.trim, { faceY: v }))
        }
        parts.push(...coneRoof(0, 0.426, cz, 2 * r + 0.08, 0.32, L.roof, 8), ...flag(0, 0.72, cz, CURTAIN, 0.24))
        // Gabled entrance with the curtain drawn and a playbill.
        parts.push(box(0, 0.02, 0.4, 0.28, 0.26, 0.14, L.wall2), box(0, 0.02, 0.473, 0.16, 0.2, 0.012, CURTAIN), box(0, 0.22, 0.473, 0.22, 0.04, 0.012, L.trim), ...gableRoof(0, 0.28, 0.4, 0.32, 0.18, 0.12, L.roof, 'z', L.wall2))
        parts.push(box(0.26, 0.02, 0.46, 0.012, 0.16, 0.012, L.trim), box(0.26, 0.12, 0.47, 0.12, 0.14, 0.012, C.bloomWhite), box(0.26, 0.16, 0.478, 0.08, 0.06, 0.006, CURTAIN))
        parts.push(...barrel(-0.42, 0.02, 0.42, 0.09), ...barrel(-0.42, 0.02, -0.44, 0.09), ...crate(0.42, 0.02, -0.42, 0.11), ...crate(0.42, 0.02, 0.4, 0.1))
        return mirrored(spec, variant)
    }
    const h = 0.62 + (stage - 1) * 0.12
    const d = 0.74, cz = -0.1, w = 0.96, top = 0.02 + h
    parts.push(box(0, 0.02, cz, w, h, d, L.wall), box(0, 0.02, cz, w + 0.012, 0.1, d + 0.012, L.wall2), cornice(0, top, cz, w, d, L.trim, 0.045))
    if (stage >= 3) parts.push(...quoins(0, cz, w, d, 0.12, top - 0.045, L.trim))
    parts.push(...hipRoof(0, top + 0.006, cz, 1, d + 0.04, 0.12, L.roof, 0.4))
    // Fly tower over the stage.
    const fz = cz - 0.14, fh = 0.34 + (stage - 1) * 0.06
    parts.push(box(0, top, fz, 0.62, fh, 0.4, L.wall), cornice(0, top + fh, fz, 0.62, 0.4, L.trim), ...hipRoof(0, top + fh + 0.006, fz, 0.66, 0.44, 0.14, L.roof, 0.16))
    parts.push(...onFace('front', 0.62, 0.4, windowRow(0.62, top + 0.16, 3, { h: 0.1, w: 0.07, lit: 1, frame: L.trim }), 0, fz))
    const ftop = top + fh + 0.146
    if (stage >= 4) parts.push(cyl(0, ftop - 0.01, fz, 0.1, 0.1, L.trim, { seg: 8 }), cone(0, ftop + 0.09, fz, 0.07, 0.3, C.gold, { seg: 6 }), ball(0, ftop + 0.37, fz, 0.06, 0.06, C.gold, { seg: 6, emissive: GOLD_GLOW }))
    else parts.push(...weathervane(0, ftop - 0.01, fz, 0.18))
    // Portico: steps, four columns and a gabled pediment.
    for (let i = 0; i < 3; i++) parts.push(box(0, 0.02 + i * 0.02, 0.41 - i * 0.025, 0.9 - i * 0.04, 0.02, 0.16, C.stoneLight))
    const porch = h - 0.26
    for (const x of [-0.36, -0.12, 0.12, 0.36]) parts.push(...column(x, 0.08, 0.37, porch - 0.06, C.white, L.trim))
    parts.push(box(0, 0.02 + porch, 0.32, 0.9, 0.06, 0.2, L.trim), ...gableRoof(0, 0.08 + porch, 0.32, 0.94, 0.22, 0.14, L.roof, 'z', L.trim), ball(0, 0.1 + porch, 0.425, 0.08, 0.08, C.gold, { seg: 6 }))
    parts.push(...onFace('front', w, d, [...[-0.24, 0, 0.24].map(x => box(x, 0.08, 0.004, 0.13, 0.24, 0.02, C.lit, { emissive: C.litGlow })), ...[-0.12, 0.12].map(x => box(x, 0.12, 0.008, 0.07, 0.2, 0.012, CURTAIN)), ...[-0.44, 0.44].map(x => box(x, top - 0.34, 0.006, 0.06, 0.26, 0.012, CURTAIN)), ...windowsAt([-0.24, 0, 0.24], top - 0.22, { h: 0.12, w: 0.08, frame: L.trim })], 0, cz))
    for (const f of ['back', 'left', 'right'] as const) parts.push(...onFace(f, w, d, [...windowRow(f === 'back' ? w : d, 0.18, 3, { h: 0.16, lit: 1, frame: L.trim }), ...windowRow(f === 'back' ? w : d, top - 0.22, 3, { h: 0.1, frame: L.trim })], 0, cz))
    parts.push(...lantern(-0.46, 0.46, 0.02), ...lantern(0.46, 0.46, 0.02))
    if (stage >= 2) {
        for (const x of [-0.4, 0.4]) parts.push(...turret(x, top, cz + 0.26, 0.16, 0.18 + stage * 0.04, L.wall, C.accent, L.trim), ...flag(x, top + 0.006, cz - 0.33, L.banner, 0.26))
    }
    return mirrored(spec, variant)
}

// ─── Warehouse ───────────────────────────────────────────────────────────────
// L1 a plank barn, L5 a two-storey brick depot with a hoist bay, L10 three
// storeys of stucco over brick with a hoist tower, L15 a white stone
// storehouse under a clock tower. Goods pile up on the apron as it grows.

function hoist(parts: Part[], x: number, y: number, z: number, beam: number) {
    parts.push(box(x, y, z + beam / 2, 0.04, 0.04, beam, C.woodDark), box(x, y - 0.16, z + beam - 0.02, 0.008, 0.16, 0.008, C.iron), ...crate(x, y - 0.24, z + beam - 0.02, 0.08))
}

const warehouse: Factory = (stage, variant) => {
    const L = tierLook(stage)
    const spec: ModelSpec = { parts: [ground(C.cobble)] }
    const parts = spec.parts
    const d = 0.76, cz = -0.1, w = 0.96, front = cz + d / 2
    parts.push(box(0, 0.02, cz, w, 0.06, d, C.stone))
    if (stage === 0) {
        const wall = C.plank, fw = w - 0.02, fd = d - 0.02
        parts.push(box(0, 0.08, cz, fw, 0.3, fd, wall))
        for (const f of FACES) {
            const span = f === 'front' || f === 'back' ? fw : fd
            parts.push(...onFace(f, fw, fd, Array.from({ length: 6 }, (_, i) => box((i + 0.5) / 6 * span - span / 2, 0.08, 0.004, 0.02, 0.3, 0.012, shade(wall, -0.14))), 0, cz))
        }
        parts.push(...onFace('front', fw, fd, [box(0, 0.08, 0.008, 0.34, 0.24, 0.02, C.woodDark), box(-0.085, 0.19, 0.02, 0.2, 0.02, 0.008, L.trim, { rotZ: 0.95 }), box(0.085, 0.19, 0.02, 0.2, 0.02, 0.008, L.trim, { rotZ: -0.95 }), box(0, 0.32, 0.008, 0.4, 0.03, 0.024, L.trim)], 0, cz))
        parts.push(...onFace('back', fw, fd, windowsAt([-0.25, 0.25], 0.2, { w: 0.08, h: 0.08, shutters: L.paint }), 0, cz))
        parts.push(...gableRoof(0, 0.38, cz, 1, d + 0.04, 0.26, L.roof, 'z', wall))
        parts.push(box(0, 0.42, front, 0.1, 0.1, 0.012, C.woodDark))
        hoist(parts, 0, 0.55, front - 0.01, 0.13)
    } else if (stage <= 2) {
        const storeys = stage + 1, sh = stage === 1 ? 0.3 : 0.27
        const top = 0.08 + storeys * sh
        const upper = stage === 1 ? C.brick : L.wall
        parts.push(box(0, 0.08, cz, w, sh, d, C.brick), box(0, 0.08 + sh, cz, w, top - 0.08 - sh, d, upper), cornice(0, top, cz, w, d, L.trim))
        for (let s = 1; s < storeys; s++) parts.push(box(0, 0.08 + s * sh - 0.012, cz, w + 0.012, 0.025, d + 0.012, L.trim))
        for (let s = 0; s < storeys; s++) {
            const y = 0.08 + s * sh + 0.09
            parts.push(...onFace('front', w, d, windowsAt([-0.38, -0.24, 0.24, 0.38], y, { w: 0.08, h: 0.12, frame: L.trim, lit: s }), 0, cz))
            parts.push(...onFace('back', w, d, windowsAt([-0.3, -0.1, 0.1, 0.3], y, { w: 0.08, h: 0.12, frame: L.trim, lit: s + 1 }), 0, cz))
            for (const f of ['left', 'right'] as const) parts.push(...onFace(f, w, d, windowsAt([-0.2, 0.2], y, { w: 0.08, h: 0.12, frame: L.trim, lit: s }), 0, cz))
        }
        // Hoist bay: a narrow gabled block up the middle of the front with loading doors on every floor.
        const bay = stage === 1 ? top + 0.1 : top, bz = front - 0.04
        parts.push(box(0, 0.08, bz, 0.26, bay - 0.08, 0.16, upper), box(0, 0.08, bz, 0.272, sh, 0.172, C.brick))
        for (let s = 0; s < storeys; s++) parts.push(box(0, 0.08 + s * sh + (s ? 0.05 : 0), bz + 0.09, 0.16, s ? 0.18 : 0.22, 0.02, s ? L.paint : C.woodDark))
        if (stage === 1) parts.push(...gableRoof(0, top + 0.006, cz, 1, d + 0.04, 0.28, L.roof, 'x', C.brick))
        else parts.push(...hipRoof(0, top + 0.006, cz, 1, d + 0.04, 0.2, L.roof, 0.3))
        if (stage === 1) parts.push(cornice(0, bay, bz, 0.26, 0.16, L.trim, 0.025), ...gableRoof(0, bay + 0.006, bz, 0.3, 0.2, 0.14, L.roof, 'z', upper))
        hoist(parts, 0, bay - (stage === 1 ? 0.04 : 0.08), bz + 0.08, 0.14)
        parts.push(...lantern(-0.2, 0.34, 0.02), ...lantern(0.2, 0.34, 0.02))
        if (stage === 1) parts.push(...weathervane(0.3, top + 0.28, cz, 0.16))
        else {
            // Rose stucco: a hoist tower with a banner, an awning and a balcony.
            const tx = -0.33, tz = cz - 0.1, tt = top + 0.4
            parts.push(box(tx, top - 0.02, tz, 0.28, tt - top + 0.02, 0.28, L.wall), cornice(tx, tt, tz, 0.28, 0.28, L.trim), ...hipRoof(tx, tt + 0.006, tz, 0.32, 0.32, 0.14, L.roof, 0.06), ...flag(tx, tt + 0.13, tz, L.banner, 0.24))
            for (const f of FACES) parts.push(...onFace(f, 0.28, 0.28, windowAt(0, tt - 0.2, 0.08, 0.12, { frame: L.trim, lit: f === 'front' || f === 'left' }), tx, tz))
            parts.push(...onFace('front', w, d, [...awning(0.31, 0.3, 0.26, L.banner, L.wall2), ...awning(-0.31, 0.3, 0.26, L.banner, L.wall2), ...balcony(0.31, 0.08 + sh + 0.013, 0.26, L.metal)], 0, cz))
        }
    } else {
        // White stone storehouse under a clock tower.
        const sh = 0.28, top = 0.08 + 3 * sh
        parts.push(box(0, 0.08, cz, w, top - 0.08, d, L.wall), box(0, 0.08, cz, w + 0.012, 0.1, d + 0.012, L.trim), cornice(0, top, cz, w, d, L.trim, 0.045), ...quoins(0, cz, w, d, 0.18, top - 0.045, L.trim))
        for (let s = 0; s < 3; s++) {
            const y = 0.08 + s * sh + 0.1
            parts.push(...onFace('front', w, d, windowsAt([-0.38, -0.24, 0.24, 0.38], y, { w: 0.08, h: 0.13, frame: L.trim, lit: s }), 0, cz))
            parts.push(...onFace('back', w, d, windowsAt([-0.3, -0.1, 0.1, 0.3], y, { w: 0.08, h: 0.13, frame: L.trim, lit: s + 1 }), 0, cz))
            for (const f of ['left', 'right'] as const) parts.push(...onFace(f, w, d, windowsAt([-0.2, 0.2], y, { w: 0.08, h: 0.13, frame: L.trim, lit: s }), 0, cz))
        }
        parts.push(...hipRoof(0, top + 0.006, cz, 1, d + 0.04, 0.2, L.roof, 0.36))
        // Balustrade along the front eave.
        parts.push(box(0, top + 0.006, front + 0.005, w + 0.03, 0.012, 0.03, L.trim), box(0, top + 0.068, front + 0.005, w + 0.03, 0.015, 0.03, L.trim))
        for (let i = 0; i < 11; i++) parts.push(box(-0.45 + i * 0.09, top + 0.018, front + 0.005, 0.02, 0.05, 0.02, L.trim))
        // Clock tower rising from the front centre, a clock on every face.
        const tz = front - 0.13, tw = 0.32, tt = top + 0.55 + (stage - 3) * 0.2
        parts.push(box(0, 0.08, tz, tw, tt - 0.08, 0.3, L.wall), ...quoins(0, tz, tw, 0.3, 0.18, tt - 0.04, L.trim), cornice(0, tt, tz, tw, 0.3, L.trim, 0.045))
        parts.push(...onFace('front', tw, 0.3, [box(0, 0.08, 0.008, 0.16, 0.25, 0.02, L.paint), box(0, 0.08, 0.003, 0.2, 0.28, 0.014, L.trim), ...awning(0, 0.36, 0.26, L.banner, L.trim), ...windowsAt([0], 0.08 + sh + 0.1, { w: 0.09, h: 0.14, frame: L.trim }), ...windowsAt([0], 0.08 + 2 * sh + 0.1, { w: 0.09, h: 0.14, frame: L.trim, lit: 0 })], 0, tz))
        const cy = tt - 0.14
        for (const f of FACES) parts.push(...onFace(f, tw, 0.3, [cyl(0, cy - 0.006, 0.006, 0.22, 0.012, L.trim, { rotX: Math.PI / 2, seg: 12 }), cyl(0, cy - 0.006, 0.012, 0.18, 0.012, C.bloomWhite, { rotX: Math.PI / 2, seg: 12, emissive: 0x8a7a50 }), box(0, cy, 0.02, 0.012, 0.06, 0.006, C.iron), box(0.02, cy - 0.006, 0.02, 0.05, 0.012, 0.006, C.iron)], 0, tz))
        parts.push(cyl(0, tt + 0.006, tz, 0.24, 0.08, L.wall, { seg: 8 }), cyl(0, tt + 0.07, tz, 0.27, 0.03, L.trim, { seg: 8 }))
        const cap = tt + 0.1
        if (stage >= 4) parts.push(...coneRoof(0, cap, tz, 0.26, 0.4, L.roof, 8), ball(0, cap + 0.38, tz, 0.06, 0.06, C.gold, { seg: 6, emissive: GOLD_GLOW }), ...onFace('front', w, d, [-0.31, 0.31].map(x => box(x, top - 0.36, 0.008, 0.08, 0.28, 0.012, L.banner)), 0, cz))
        else parts.push(dome(0, cap, tz, 0.26, 0.2, C.accent, { seg: 8 }), cyl(0, cap + 0.19, tz, 0.012, 0.1, L.metal, { seg: 5 }), ball(0, cap + 0.28, tz, 0.04, 0.04, C.gold, { seg: 5 }))
        parts.push(...lantern(-0.2, 0.34, 0.02), ...lantern(0.2, 0.34, 0.02))
    }
    // Goods pile up on the apron as storage grows.
    const stock = 3 + stage * 2
    for (let i = 0; i < stock; i++) {
        const c = i % 4, row = Math.floor(i / 4)
        const x = c < 2 ? -0.42 + c * 0.11 : 0.31 + (c - 2) * 0.11
        const z = 0.44 - (row % 2) * 0.1
        const y = 0.02 + Math.floor(row / 2) * 0.095
        parts.push(...(i % 3 === 2 && y < 0.05 ? barrel(x, y, z, 0.085) : crate(x, y, z, 0.095, i % 2 ? C.plank : C.woodLight)))
    }
    return mirrored(spec, variant)
}

export const CIVIC_MODELS: Partial<Record<TownBuildingId, Factory>> = { park, bathhouse, theatre, warehouse }
