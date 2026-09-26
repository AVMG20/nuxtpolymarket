// Polytown — homes and shops: the House, the Bakery and the Emporium. A house is an L: a main
// block across the back of the tile and a wing down one side of the front, so
// the front corner left over is a garden. Every look has its own fixed scheme
// (tierLook) and adds a storey and a new piece of massing: a timber cottage, a
// brick-and-ochre townhouse with dormers, a rose villa with a corner turret, a
// white-stone mansion with two turrets and a fountain court, and a marble
// palace with a gold clock tower. The tile only mirrors the plan and picks the
// main roof's shape; colours never depend on it.

import { C, awning, balcony, ball, barrel, box, bush, chimney, column, cone, coneRoof, cyl, dome, dormer, fence, flatRoof, flowerBed, gableRoof, ground, hipRoof, logPile, onFace, planter, roundTree, sack, shade, tierLook, weathervane, windowAt, type Face, type ModelSpec, type Part, type TierLook } from './kit'

type Factory = (stage: number, variant: number) => ModelSpec

export const HOUSE_W = 0.96
/** Main block depth and centre; the wing and garden take the rest of the tile. */
export const HOUSE_D = 0.56
export const HOUSE_Z = -0.2
const WING_W = 0.5
const WING_D = 0.38
const WING_Z = 0.27
const GROUND_FLOOR = 0.34
const UPPER_FLOOR = 0.23
const LOAF = 0xd99a4a

export function townhouseWallHeight(floors: number) {
    return GROUND_FLOOR + (floors - 1) * UPPER_FLOOR
}

/** Sill height of a storey above the ground part. */
const storey = (floor: number) => 0.02 + (floor ? GROUND_FLOOR + (floor - 1) * UPPER_FLOOR : 0)

// ─── Local details ───────────────────────────────────────────────────────────

/** Pennant on a pole in the look's metal. */
function pennant(x: number, y: number, z: number, color: number, metal: number, h = 0.22): Part[] {
    return [cyl(x, y, z, 0.014, h, metal, { seg: 5 }), box(x + 0.055, y + h - 0.08, z, 0.1, 0.065, 0.01, color), ball(x, y + h, z, 0.03, 0.03, metal, { seg: 5 })]
}

/** Banner hanging down a wall, authored against the front face. */
function drape(x: number, y: number, h: number, color: number, metal: number): Part[] {
    return [box(x, y, 0.008, 0.09, h, 0.012, color), box(x, y - 0.035, 0.008, 0.05, 0.035, 0.012, color), box(x, y + h, 0.014, 0.13, 0.018, 0.024, metal)]
}

/** Lamp on a bracket, authored against the front face. */
function wallLamp(x: number, y: number, metal: number): Part[] {
    return [box(x, y, 0.025, 0.014, 0.014, 0.05, metal), box(x, y - 0.06, 0.045, 0.036, 0.06, 0.036, C.lit, { emissive: C.litGlow }), box(x, y - 0.004, 0.045, 0.05, 0.014, 0.05, metal)]
}

function lampPost(x: number, z: number, metal: number, y = 0.02): Part[] {
    return [cyl(x, y, z, 0.024, 0.26, metal, { seg: 6 }), box(x, y + 0.26, z, 0.055, 0.065, 0.055, C.lit, { emissive: C.litGlow }), cone(x, y + 0.325, z, 0.08, 0.04, metal, { seg: 4 })]
}

/** Stone balustrade from (x0,z0) to (x1,z1), axis-aligned. */
function balustrade(x0: number, z0: number, x1: number, z1: number, y: number, color: number): Part[] {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0)
    const n = Math.max(2, Math.round(len / 0.065))
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2
    return [
        box(cx, y, cz, along ? len : 0.04, 0.02, along ? 0.04 : len, color),
        box(cx, y + 0.08, cz, along ? len + 0.01 : 0.046, 0.022, along ? 0.046 : len + 0.01, color),
        ...Array.from({ length: n }, (_, i) => cyl(x0 + (x1 - x0) * (i + 0.5) / n, y + 0.02, z0 + (z1 - z0) * (i + 0.5) / n, 0.026, 0.06, color, { seg: 6 }))
    ]
}

function fountain(x: number, z: number, s: number, metal: number): Part[] {
    return [
        cyl(x, 0.02, z, s, 0.07, C.stoneLight, { seg: 12 }),
        cyl(x, 0.07, z, s - 0.035, 0.012, C.water, { seg: 12, flat: true }),
        cyl(x, 0.02, z, 0.045, 0.15, C.stoneLight, { seg: 6 }),
        cyl(x, 0.17, z, s * 0.45, 0.035, C.stoneLight, { seg: 10 }),
        cyl(x, 0.195, z, s * 0.38, 0.012, C.water, { seg: 10, flat: true }),
        cone(x, 0.205, z, 0.045, 0.08, metal, { seg: 5 })
    ]
}

/** A clipped topiary cone in a stone pot, for the formal gardens. */
function topiary(x: number, z: number, metal: number): Part[] {
    return [box(x, 0.02, z, 0.08, 0.06, 0.08, C.stoneLight), box(x, 0.08, z, 0.09, 0.012, 0.09, metal), cone(x, 0.09, z, 0.1, 0.2, C.leafDark, { seg: 6 })]
}

/** Round corner tower with a teal cap; slimmer overhang than the kit's so it can stand on the tile's corner. */
function tower(x: number, z: number, w: number, h: number, wall: number, trim: number, metal: number): Part[] {
    // Turned half a segment so a flat face, not an edge, looks down the street.
    const parts: Part[] = [cyl(x, 0.02, z, w, h - 0.02, wall, { seg: 10, rotY: Math.PI / 10 }), cyl(x, h - 0.03, z, w + 0.03, 0.03, trim, { seg: 10, rotY: Math.PI / 10 })]
    const face = z + w / 2 * Math.cos(Math.PI / 10)
    for (let i = 0, y = 0.2; y < h - 0.16; i++, y += 0.23) parts.push(box(x, y, face, 0.05, 0.09, 0.012, i % 2 ? C.glass : C.lit, i % 2 ? {} : { emissive: C.litGlow }))
    parts.push(...coneRoof(x, h, z, w + 0.03, w * 1.3, C.accent, 10), ball(x, h + w * 1.3, z, 0.035, 0.05, metal, { seg: 5 }))
    return parts
}

function mirrorZ(parts: Part[], about: number): Part[] {
    return parts.map(p => ({ ...p, z: 2 * about - p.z }))
}

/** Lit windows: every other one early on, most of them on the marble palace. */
function isLit(stage: number, i: number, floor: number) {
    return stage >= 4 ? (i + floor) % 3 !== 0 : (i + floor) % 2 === 0
}

interface WindowStyle { stage: number, look: TierLook, frame: number }

/** A run of `n` windows centred on `cx`, authored against the front face. */
function windows(s: WindowStyle, span: number, cx: number, y: number, n: number, floor: number, o: { sill?: boolean, cap?: boolean } = {}): Part[] {
    const h = s.stage >= 2 ? 0.16 : 0.14
    const parts: Part[] = []
    for (let i = 0; i < n; i++) {
        const x = cx + (i + 0.5) / n * span - span / 2
        parts.push(...windowAt(x, y, 0.1, h, { frame: s.frame, sill: o.sill ?? false, shutters: s.stage <= 2 ? s.look.paint : undefined, lit: isLit(s.stage, i, floor) }))
        if (o.cap && s.stage >= 3) parts.push(box(x, y + h + 0.012, 0.012, 0.15, 0.022, 0.03, s.frame))
    }
    return parts
}

// ─── The townhouse ───────────────────────────────────────────────────────────

export interface TownhouseOptions {
    /** Main block storeys. */
    floors: number
    /** Wing storeys. */
    wingFloors: number
    roofKind: 'gable' | 'hip'
    /** Wing on the left (-1) or right (1) of the front; the garden takes the other corner. */
    doorSide: number
}

export function townhouse(stage: number, o: TownhouseOptions): ModelSpec {
    const spec: ModelSpec = { parts: [] }
    const parts = spec.parts
    const look = tierLook(stage)
    const side = o.doorSide
    const mw = HOUSE_W, md = HOUSE_D, mz = HOUSE_Z
    const ww = WING_W, wd = WING_D, wx = side * (0.48 - ww / 2), wz = WING_Z
    const top = 0.02 + townhouseWallHeight(o.floors)
    const wtop = 0.02 + townhouseWallHeight(o.wingFloors)
    const flatWing = stage >= 3
    const wingTurret = stage >= 2
    const frame = look.trim
    const band = stage === 0 ? C.timber : stage >= 4 ? look.wall2 : look.trim
    const style: WindowStyle = { stage, look, frame }
    const metal = look.metal

    const main = (f: Face, items: Part[]) => parts.push(...onFace(f, mw, md, items, 0, mz))
    const wing = (f: Face, items: Part[]) => parts.push(...onFace(f, ww, wd, items, wx, wz))
    const outer = side > 0 ? 'right' : 'left'
    const inner = side > 0 ? 'left' : 'right'
    const gx = -side * 0.25

    // Shells on a dark plinth: main block in the look's plaster, wing in its second tone.
    parts.push(ground(stage >= 3 ? C.paving : C.cobble))
    parts.push(box(0, 0.02, mz, mw + 0.02, 0.06, md + 0.02, C.stoneDark), box(0, 0.02, mz, mw, top - 0.02, md, look.wall))
    parts.push(box(wx, 0.02, wz, ww + 0.02, 0.06, wd + 0.02, C.stoneDark), box(wx, 0.02, wz, ww, wtop - 0.02, wd, look.wall2))

    // Ground floor: the door opens onto the garden; the wing shows windows or the shop.
    main('front', [box(-side * 0.15, 0.02, 0.004, 0.17, 0.26, 0.02, frame), box(-side * 0.15, 0.02, 0.01, 0.13, 0.23, 0.02, look.paint), box(-side * 0.15 + 0.035, 0.12, 0.022, 0.014, 0.014, 0.01, C.gold), box(-side * 0.15, 0, 0.05, 0.22, 0.035, 0.09, C.stone)])
    main('front', windows(style, 0.1, -side * 0.38, 0.14, 1, 0, { sill: true, cap: true }))
    wing('front', windows(style, wingTurret ? 0.2 : ww, wingTurret ? -side * 0.12 : 0, 0.14, wingTurret ? 1 : 2, 0, { sill: true, cap: true }))
    wing(inner, windows(style, wd, 0, 0.14, 1, 1, { sill: true, cap: true }))
    main('back', windows(style, mw, 0, 0.14, 3, 1, { sill: true }))
    for (const f of ['left', 'right'] as const) main(f, windows(style, md, 0, 0.14, 1, f === 'left' ? 0 : 1))
    if (!wingTurret) wing(outer, windows(style, wd, 0, 0.14, 1, 0))

    for (let floor = 1; floor < o.floors; floor++) {
        const y = storey(floor)
        const wy = y + 0.06
        parts.push(box(0, y - 0.012, mz, mw + 0.024, 0.024, md + 0.024, band))
        // Below the wing's eaves only the garden half of the front shows.
        if (y + 0.2 < wtop) main('front', windows(style, 0.46, gx, wy, 2, floor, { cap: true }))
        else main('front', windows(style, mw, 0, wy, stage >= 3 ? 4 : 3, floor, { cap: true }))
        main('back', windows(style, mw, 0, wy, 3, floor + 1))
        for (const f of ['left', 'right'] as const) main(f, windows(style, md, 0, wy, 1, floor + (f === 'left' ? 0 : 1)))
        if (floor < o.wingFloors) {
            parts.push(box(wx, y - 0.012, wz, ww + 0.024, 0.024, wd + 0.024, band))
            wing('front', windows(style, wingTurret ? 0.2 : ww, wingTurret ? -side * 0.12 : 0, wy, wingTurret ? 1 : 2, floor, { cap: true }))
            wing(inner, windows(style, wd, 0, wy, 1, floor))
            if (!wingTurret) wing(outer, windows(style, wd, 0, wy, 1, floor + 1))
        }
    }

    // Timber framing on the cottage, brick courses on the townhouse wing.
    if (stage === 0) {
        const fy = storey(1)
        const posts = [-0.47, -0.16, 0.16, 0.47]
        for (const f of ['front', 'back'] as const) main(f, [...posts.map(x => box(x, fy, 0.004, 0.03, UPPER_FLOOR, 0.012, C.timber)), box(0, top - 0.03, 0.004, mw, 0.024, 0.012, C.timber)])
        main('back', [-0.31, 0.31].map(x => box(x, fy + 0.03, 0.004, 0.024, 0.26, 0.01, C.timber, { rotZ: x > 0 ? 0.9 : -0.9 })))
        wing('front', [-0.235, 0.235].map(x => box(x, 0.08, 0.004, 0.03, wtop - 0.08, 0.012, C.timber)))
        wing(inner, [-0.175, 0.175].map(x => box(x, 0.08, 0.004, 0.03, wtop - 0.08, 0.012, C.timber)))
    }
    if (stage === 1) {
        for (let floor = 0; floor < o.wingFloors; floor++) {
            for (const t of [0.35, 0.7]) parts.push(box(wx, storey(floor) + t * (floor ? UPPER_FLOOR : GROUND_FLOOR), wz, ww + 0.008, 0.012, wd + 0.008, shade(look.wall2, -0.1)))
        }
    }

    // Balconies over the garden from the villa up.
    if (stage >= 2) main('front', [...balcony(gx, storey(1) + 0.02, 0.4, metal), ...planter(gx - 0.1, storey(1) + 0.045, 0.06, 0.1)])
    if (stage >= 3) main('front', balcony(gx, storey(3) + 0.02, 0.4, metal))
    if (stage >= 3) {
        // Dressed corners.
        const q = stage >= 4 ? look.wall2 : shade(look.trim, -0.06)
        for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(x * (mw / 2 - 0.018), 0.08, mz + z * (md / 2 - 0.018), 0.06, top - 0.1, 0.06, q))
        parts.push(box(-side * 0.018, 0.08, wz + wd / 2 - 0.018, 0.06, wtop - 0.1, 0.06, q))
    }
    if (stage >= 1) main('front', [...wallLamp(-side * 0.15 - 0.12, 0.28, metal), ...wallLamp(-side * 0.15 + 0.12, 0.28, metal)])

    // Cornices.
    parts.push(box(0, top - 0.035, mz, mw + 0.04, 0.035, md + 0.04, look.trim))
    parts.push(box(wx, wtop - 0.035, wz, ww + 0.04, 0.035, wd + 0.04, look.trim))

    // Main roof: its ridge runs across the tile.
    const rh = o.roofKind === 'hip' ? 0.3 : 0.36
    if (o.roofKind === 'hip') parts.push(...hipRoof(0, top, mz, 1, md + 0.04, rh, look.roof, 0.22))
    else parts.push(...gableRoof(0, top, mz, 1, md + 0.04, rh, look.roof, 'x', look.wall))
    const chimneyColor = stage >= 3 ? look.wall2 : C.brick
    chimney(spec, side * 0.4, top, mz - 0.06, rh + 0.08, chimneyColor)
    if (stage >= 1) chimney(spec, -side * 0.4, top, mz - 0.1, rh + 0.04, chimneyColor)
    if (stage >= 1) parts.push(...dormer(gx, top + 0.06, mz + 0.14, look.wall, look.roof))
    if (stage >= 2) parts.push(...mirrorZ(dormer(side * 0.2, top + 0.06, mz + 0.14, look.wall, look.roof), mz))
    if (stage === 1) parts.push(...weathervane(-side * 0.22, top, mz, rh + 0.16))
    if (stage === 2 || stage === 3) parts.push(...pennant(-side * 0.22, top, mz, look.banner, metal, rh + 0.26))

    // Wing roof: a gable to the street, then a balustraded terrace.
    if (flatWing) {
        parts.push(...flatRoof(wx, wtop, wz, ww, wd, C.stone, look.trim))
        if (stage >= 3) {
            parts.push(...balustrade(wx - side * 0.03, wz + wd / 2 - 0.03, wx + side * 0.2, wz + wd / 2 - 0.03, wtop + 0.03, look.trim))
            parts.push(...balustrade(-side * 0.01, wz - wd / 2 + 0.05, -side * 0.01, wz + wd / 2 - 0.05, wtop + 0.03, look.trim))
        }
    } else {
        parts.push(...gableRoof(wx, wtop, wz - 0.03, ww + 0.04, wd + 0.1, stage === 0 ? 0.24 : 0.28, look.roof, 'z', look.wall2))
    }
    if (wingTurret) {
        const th = wtop + (flatWing ? 0.2 : 0.3)
        parts.push(...tower(side * 0.4, 0.4, 0.22, th, look.wall, look.trim, metal))
    }
    if (stage >= 3) parts.push(...tower(-side * 0.4, -0.4, 0.22, top + 0.2, look.wall2, look.trim, metal))

    if (stage >= 4) clockTower(parts, top, rh, mz, look)
    if (stage >= 4) {
        wing('front', drape(side * 0.01, wtop - 0.5, 0.42, look.banner, metal))
        main('front', drape(gx, storey(o.floors - 2) + 0.06, top - storey(o.floors - 2) - 0.14, look.banner, metal))
    }

    garden(parts, stage, side, look)
    return spec
}

/** The palace's landmark: a clock tower out of the roof with a gold spire. */
function clockTower(parts: Part[], top: number, rh: number, mz: number, look: TierLook) {
    const w = 0.3
    const shaft = 0.5
    const cy = top + 0.36
    parts.push(box(0, top - 0.02, mz, w, shaft + 0.02, w, look.wall))
    for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(x * (w / 2 - 0.015), top + 0.02, mz + z * (w / 2 - 0.015), 0.04, shaft - 0.02, 0.04, look.wall2))
    for (const f of ['front', 'back', 'left', 'right'] as const) {
        parts.push(...onFace(f, w, w, [
            cyl(0, cy, 0.006, 0.21, 0.012, look.trim, { rotX: Math.PI / 2, seg: 12 }),
            cyl(0, cy + 0.02, 0.014, 0.17, 0.012, C.bloomWhite, { rotX: Math.PI / 2, seg: 12, emissive: 0x9a7a3a }),
            box(0, cy + 0.045, 0.024, 0.012, 0.06, 0.006, C.iron),
            box(0.02, cy + 0.066, 0.024, 0.045, 0.01, 0.006, C.iron)
        ], 0, mz))
    }
    const by = top + shaft
    parts.push(box(0, by, mz, w + 0.05, 0.035, w + 0.05, look.trim))
    // Open belfry: corner piers round a glowing bell chamber.
    parts.push(box(0, by + 0.035, mz, w - 0.08, 0.13, w - 0.08, C.lit, { emissive: C.litGlow }))
    for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(x * (w / 2 - 0.03), by + 0.035, mz + z * (w / 2 - 0.03), 0.05, 0.13, 0.05, look.wall))
    parts.push(box(0, by + 0.165, mz, w + 0.03, 0.03, w + 0.03, look.trim))
    parts.push(dome(0, by + 0.195, mz, w - 0.02, 0.13, look.roof, { seg: 10 }), cyl(0, by + 0.31, mz, 0.06, 0.05, look.trim, { seg: 8 }))
    parts.push(cone(0, by + 0.36, mz, 0.07, 0.2, look.metal, { seg: 6 }), ball(0, by + 0.54, mz, 0.04, 0.04, look.metal, { seg: 6 }))
}

/** The free corner: a cottage garden that becomes a formal fountain court. */
function garden(parts: Part[], stage: number, side: number, look: TierLook) {
    const gx = -side * 0.25
    const metal = look.metal
    if (stage <= 2) {
        parts.push(box(gx, 0.02, 0.28, 0.46, 0.022, 0.4, C.grass, { flat: true }), box(-side * 0.15, 0.03, 0.29, 0.14, 0.014, 0.4, C.paving, { flat: true }))
        parts.push(...fence(-side * 0.48, 0.47, -side * 0.23, 0.47, stage === 0 ? C.woodLight : stage === 1 ? C.white : metal))
        parts.push(...roundTree(-side * 0.36, 0.33, 0.66 + stage * 0.06, C.leaf, 0.04))
        parts.push(...flowerBed(-side * 0.38, 0.15, 0.16, 0.06, 0.04))
        if (stage >= 1) parts.push(...bush(-side * 0.05, 0.42, 0.08, C.leafLight, 0.04))
        if (stage >= 2) parts.push(...lampPost(-side * 0.05, 0.3, metal, 0.04), ...flowerBed(-side * 0.05, 0.16, 0.06, 0.1, 0.04))
        return
    }
    // Paved court with a fountain, clipped topiary and a balustrade to the street.
    parts.push(box(gx, 0.02, 0.28, 0.46, 0.016, 0.4, C.stoneLight, { flat: true }), box(-side * 0.15, 0.036, 0.28, 0.14, 0.008, 0.4, shade(C.stoneLight, -0.08), { flat: true }))
    parts.push(...fountain(-side * 0.35, 0.3, stage >= 4 ? 0.22 : 0.19, metal))
    parts.push(...balustrade(-side * 0.47, 0.465, -side * 0.24, 0.465, 0.036, look.trim))
    parts.push(...topiary(-side * 0.44, 0.13, metal), ...topiary(-side * 0.05, 0.13, metal))
    if (stage >= 4) parts.push(...lampPost(-side * 0.24, 0.465, metal, 0.13), ...lampPost(-side * 0.05, 0.46, metal, 0.036))
}

export function houseModel(stage: number, variant: number): ModelSpec {
    return townhouse(stage, {
        floors: stage + 2,
        wingFloors: stage + 1,
        roofKind: stage >= 4 || variant % 3 === 1 ? 'hip' : 'gable',
        doorSide: variant % 2 ? 1 : -1
    })
}

// ─── The Bakery ──────────────────────────────────────────────────────────────
// A shop, not a house: a low shop under a striped awning that runs its whole
// front, a domed brick bread oven beside it with a smoking flue, a giant loaf
// or pretzel on the roof and a café terrace with parasols. Crust cream walls
// and a pink roof on every tile. Every look adds height and a new piece: a
// cottage bakehouse, a two-storey shop with a pretzel sign, a turning pretzel
// over a gabled shop and an oven on a drum, a roof salon under a teal dome,
// then a patisserie whose oven rises into a glowing gold-crowned tower.

/** Shop block on the café side; the oven stands on the other (+x before mirroring). */
const SHOP_X = -0.18
const SHOP_W = 0.62
const SHOP_Z = -0.17
const SHOP_D = 0.6
const OVEN_Z = -0.06

function mirrorX(spec: ModelSpec): ModelSpec {
    const flip = (p: Part): Part => ({ ...p, x: -p.x, ...(p.rotY ? { rotY: -p.rotY } : {}), ...(p.rotZ ? { rotZ: -p.rotZ } : {}), ...(p.faceY ? { faceY: -p.faceY } : {}) })
    return {
        parts: spec.parts.map(flip),
        spinners: spec.spinners?.map(s => ({ ...s, pivot: [-s.pivot[0], s.pivot[1], s.pivot[2]], parts: s.parts.map(flip) })),
        smoke: spec.smoke?.map(([x, y, z]) => [-x, y, z])
    }
}

/** A rope from (x0,y0) to (x1,y1) in the plane z, for the pretzel. */
function rope(x0: number, y0: number, x1: number, y1: number, z: number, t: number, color: number): Part {
    const len = Math.hypot(x1 - x0, y1 - y0) + t * 0.6
    return box((x0 + x1) / 2, (y0 + y1) / 2 - t / 2, z, len, t, t, color, { rotZ: Math.atan2(y1 - y0, x1 - x0) })
}

/** Giant pretzel facing the street, `s` wide, bottom on `y`. */
function pretzel(cx: number, y: number, z: number, s: number, color: number): Part[] {
    const t = Math.max(0.035, s * 0.12)
    const rx = s / 2 - t / 2, ry = s * 0.4 - t / 2, cy = y + t / 2 + ry
    const n = 12
    const at = (i: number): [number, number] => [cx + Math.sin(i / n * Math.PI * 2) * rx, cy - Math.cos(i / n * Math.PI * 2) * ry]
    const parts: Part[] = []
    for (let i = 0; i < n; i++) parts.push(rope(...at(i), ...at(i + 1), z, t, i % 2 ? shade(color, -0.05) : color))
    // The crossed arms make the three holes.
    parts.push(rope(cx - s * 0.3, y + s * 0.1, cx + s * 0.26, y + s * 0.64, z + 0.006, t, shade(color, 0.04)))
    parts.push(rope(cx + s * 0.3, y + s * 0.1, cx - s * 0.26, y + s * 0.64, z - 0.006, t, shade(color, 0.04)))
    // Salt.
    for (const [dx, dy] of [[-0.3, 0.55], [0.3, 0.55], [0, 0.08], [-0.15, 0.72]] as const) parts.push(box(cx + dx * s, y + dy * s, z + t / 2, 0.016, 0.016, 0.01, C.bloomWhite))
    return parts
}

/** A loaf lying along x with three scores across the top. */
function bigLoaf(x: number, y: number, z: number, w: number): Part[] {
    const h = w * 0.42
    return [
        { shape: 'sphere', x, y, z, w, h, d: w * 0.5, color: LOAF, seg: 8 },
        ...[-0.22, 0, 0.22].map(dx => box(x + dx * w, y + h * 0.82, z, w * 0.1, h * 0.14, w * 0.3, C.bloomYellow, { rotY: 0.5 }))
    ]
}

/** Full-width striped awning with a scalloped valance, authored against the front face. */
function shopAwning(w: number, y: number, reach: number, a: number, b: number): Part[] {
    const n = Math.max(5, Math.round(w / 0.08))
    const parts: Part[] = []
    for (let i = 0; i < n; i++) {
        const x = -w / 2 + (i + 0.5) * w / n
        parts.push(box(x, y, reach / 2, w / n, 0.022, reach + 0.02, i % 2 ? a : b, { rotX: 0.34 }))
        parts.push(box(x, y - 0.062, reach * 0.94 + 0.01, w / n - 0.012, 0.04, 0.012, i % 2 ? a : b))
    }
    return parts
}

function parasolTable(x: number, z: number, cloth: number, metal: number): Part[] {
    return [
        cyl(x, 0.02, z, 0.018, 0.25, metal, { seg: 5 }), cyl(x, 0.12, z, 0.11, 0.014, C.white, { seg: 8 }),
        box(x - 0.08, 0.02, z, 0.045, 0.07, 0.045, C.woodDark), box(x + 0.08, 0.02, z, 0.045, 0.07, 0.045, C.woodDark),
        cone(x, 0.2, z, 0.24, 0.08, cloth, { seg: 8 }), ball(x, 0.275, z, 0.025, 0.025, metal, { seg: 5 })
    ]
}

/** Bread rack against the shop front: two shelves of loaves. */
function breadRack(x: number): Part[] {
    return [
        box(x, 0.02, 0.025, 0.15, 0.22, 0.04, C.woodDark),
        ...[0.07, 0.15].flatMap(y => [box(x, y, 0.05, 0.15, 0.014, 0.07, C.wood), ...[-0.04, 0.04].map(dx => ball(x + dx, y + 0.012, 0.055, 0.07, 0.04, LOAF, { seg: 6 }))])
    ]
}

/** Square brick flue with a band and cap; smoke rises from its top. */
function flue(spec: ModelSpec, x: number, y: number, z: number, h: number, w: number, band: number, cap: number) {
    spec.parts.push(box(x, y, z, w, h, w, C.brick), box(x, y + h * 0.62, z, w + 0.016, 0.03, w + 0.016, band))
    spec.parts.push(box(x, y + h, z, w + 0.035, 0.035, w + 0.035, cap), box(x, y + h + 0.035, z, w * 0.62, 0.03, w * 0.62, C.iron))
    ;(spec.smoke ??= []).push([x, y + h + 0.07, z])
}

/** The beehive: a stepped brick dome of diameter `d` from `y`. */
function beehive(x: number, y: number, z: number, d: number, h: number): Part[] {
    const n = 7
    return Array.from({ length: n }, (_, i) => cyl(x, y + i * h / n, z, Math.max(0.1, d * Math.sqrt(1 - (i / n) ** 2)), h / n, i % 2 ? C.brickDark : C.brick, { seg: 12 }))
}

export const bakeryModel: Factory = (stage, variant) => {
    const look = tierLook(stage)
    const spec: ModelSpec = { parts: [ground([C.cobble, C.cobble, C.paving, C.stoneLight, C.stoneLight][stage]!)] }
    const parts = spec.parts
    const metal = look.metal
    const floors = [1, 1, 2, 2, 3][stage]!
    const top = 0.02 + townhouseWallHeight(floors)
    const sw = SHOP_W, sd = SHOP_D, sx = SHOP_X, sz = SHOP_Z
    const style: WindowStyle = { stage, look, frame: look.trim }
    const face = (f: Face, items: Part[]) => parts.push(...onFace(f, sw, sd, items, sx, sz))

    // ── The shop: crust-brown plinth, cream walls, the awning across its whole front.
    parts.push(box(sx, 0.02, sz, sw + 0.02, 0.07, sd + 0.02, look.wall2), box(sx, 0.02, sz, sw, top - 0.02, sd, look.wall))
    if (stage === 1) parts.push(box(sx, 0.02, sz, sw + 0.008, top - 0.08, sd + 0.008, look.wall2))
    face('front', [
        box(-0.2, 0.02, 0.004, 0.17, 0.25, 0.02, look.trim), box(-0.2, 0.02, 0.01, 0.13, 0.22, 0.02, look.paint), box(-0.17, 0.12, 0.022, 0.014, 0.014, 0.01, C.gold),
        box(0.02, 0.08, 0.002, 0.25, 0.17, 0.014, look.trim), box(0.02, 0.09, 0.006, 0.21, 0.14, 0.02, C.lit, { emissive: C.litGlow }),
        box(0.02, 0.07, 0.014, 0.25, 0.025, 0.05, C.woodDark), ...[-0.06, 0.02, 0.1].map(x => ball(x, 0.09, 0.03, 0.07, 0.045, LOAF, { seg: 6 })),
        ...breadRack(0.225),
        ...shopAwning(sw, 0.27, 0.17, look.roof, C.white)
    ])
    face('left', windows(style, sd, 0, 0.14, 2, 0, { sill: true }))
    face('back', windows(style, sw, 0, 0.14, 2, 1, { sill: true }))
    for (let floor = 1; floor < floors; floor++) {
        const y = storey(floor) + 0.06
        parts.push(box(sx, storey(floor) - 0.012, sz, sw + 0.024, 0.024, sd + 0.024, stage === 1 ? look.trim : shade(look.trim, -0.04)))
        face('front', windows(style, stage >= 4 ? 0.56 : sw, 0, y, stage >= 4 ? 2 : 3, floor, { cap: true }))
        face('left', windows(style, sd, 0, y, 2, floor + 1))
        face('back', windows(style, sw, 0, y, 2, floor))
    }
    if (stage === 0) {
        // Timber posts at the corners of the humble bakehouse.
        for (const x of [-sw / 2 + 0.015, sw / 2 - 0.015]) face('front', [box(x, 0.02, 0.004, 0.03, top - 0.02, 0.014, C.timber)])
        face('front', [box(0, top - 0.04, 0.004, sw, 0.024, 0.014, C.timber)])
    }
    if (stage >= 2) face('front', balcony(0, storey(1) + 0.02, 0.44, metal))
    if (stage >= 3) {
        // Dressed corners.
        const q = stage >= 4 ? C.white : shade(look.trim, -0.06)
        for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(sx + x * (sw / 2 - 0.018), 0.09, sz + z * (sd / 2 - 0.018), 0.06, top - 0.12, 0.06, q))
    }
    if (stage >= 4) face('front', drape(0, storey(1) + 0.14, top - storey(1) - 0.22, look.banner, metal))
    parts.push(box(sx, top - 0.035, sz, sw + 0.04, 0.035, sd + 0.04, look.trim))

    // ── Roof and its sign: a loaf, a pretzel, then a pretzel that turns.
    let signY: number
    let signZ = sz
    if (stage === 0) {
        parts.push(...gableRoof(sx, top, sz, sw + 0.04, sd + 0.04, 0.22, look.roof, 'x', look.wall))
        signY = top + 0.21
        parts.push(...bigLoaf(sx, signY, sz, 0.34))
    } else if (stage === 1) {
        parts.push(...hipRoof(sx, top, sz, sw + 0.04, sd + 0.04, 0.26, look.roof, 0.2))
        parts.push(...dormer(sx - 0.14, top + 0.04, sz + 0.14, look.wall, look.roof, 0.14))
        signY = top + 0.26
        parts.push(box(sx, signY, sz, 0.26, 0.03, 0.08, C.woodDark), ...[-0.1, 0.1].map(dx => box(sx + dx, signY + 0.03, sz, 0.024, 0.1, 0.024, C.woodDark)))
        parts.push(...pretzel(sx, signY + 0.06, sz, 0.34, LOAF))
    } else if (stage === 2) {
        parts.push(...gableRoof(sx, top, sz, sw + 0.04, sd + 0.04, 0.3, look.roof, 'x', look.wall))
        parts.push(...dormer(sx - 0.14, top + 0.04, sz + 0.14, look.wall, look.roof, 0.14), ...dormer(sx + 0.14, top + 0.04, sz + 0.14, look.wall, look.roof, 0.14))
        signY = top + 0.3
    } else if (stage === 3) {
        // A flat roof terrace with a teal-domed tea salon.
        parts.push(...flatRoof(sx, top, sz, sw, sd, C.stone, look.trim))
        parts.push(...balustrade(sx - sw / 2 + 0.04, sz + sd / 2 - 0.03, sx + sw / 2 - 0.04, sz + sd / 2 - 0.03, top + 0.03, look.trim))
        const pw = 0.34, pd = 0.3, pz = sz - 0.08, ph = 0.24
        parts.push(box(sx, top + 0.03, pz, pw, ph, pd, look.wall), box(sx, top + 0.03 + ph - 0.03, pz, pw + 0.03, 0.03, pd + 0.03, look.trim))
        parts.push(...onFace('front', pw, pd, windows(style, pw, 0, top + 0.09, 2, 0), sx, pz))
        parts.push(dome(sx, top + 0.03 + ph, pz, 0.3, 0.16, C.accent, { seg: 10 }))
        signY = top + 0.03 + ph + 0.15
        signZ = pz
        parts.push(...lampPost(sx - sw / 2 + 0.06, sz + sd / 2 - 0.08, metal, top + 0.03))
    } else {
        // Mansard with lit dormers.
        parts.push(...hipRoof(sx, top, sz, sw + 0.04, sd + 0.04, 0.3, look.roof, 0.28))
        parts.push(...dormer(sx - 0.15, top + 0.03, sz + 0.12, look.wall, look.roof, 0.13), ...dormer(sx + 0.15, top + 0.03, sz + 0.12, look.wall, look.roof, 0.13))
        signY = top + 0.3
    }
    if (stage >= 2) {
        // The turning pretzel: bigger every look, gold on the patisserie.
        const s = [0, 0, 0.36, 0.38, 0.42][stage]!
        const pole = 0.08
        parts.push(cyl(sx, signY - 0.02, signZ, 0.03, pole + 0.02, metal, { seg: 6 }))
        const py = signY + pole
        spec.spinners = [{ pivot: [sx, py, signZ], axis: 'y', rate: 0.8, parts: pretzel(sx, py, signZ, s, stage >= 4 ? C.gold : LOAF) }]
    }

    // ── The oven: a brick beehive with a glowing mouth; it climbs onto a drum and becomes a tower.
    const d = [0.36, 0.4, 0.42, 0.42, 0.4][stage]!
    const ox = 0.49 - d / 2
    const oz = OVEN_Z
    const base = [0.08, 0.1, 0.22, 0.36, 0.98][stage]!
    const dh = [0.3, 0.34, 0.36, 0.36, 0.34][stage]!
    if (stage <= 1) {
        parts.push(box(ox, 0.02, oz, d + 0.02, base - 0.02, d + 0.02, stage ? look.wall2 : C.stone))
    } else {
        const drum = stage >= 4 ? C.white : stage === 3 ? C.stoneLight : look.wall2
        parts.push(cyl(ox, 0.02, oz, d, base - 0.02, drum, { seg: 12, rotY: Math.PI / 12 }), cyl(ox, base - 0.03, oz, d + 0.03, 0.03, look.trim, { seg: 12, rotY: Math.PI / 12 }))
        if (stage >= 3) parts.push(cyl(ox, stage >= 4 ? 0.26 : 0.2, oz, d + 0.016, 0.025, look.trim, { seg: 12, rotY: Math.PI / 12 }))
    }
    parts.push(...beehive(ox, base, oz, d, dh))
    // Mouth: a brick porch with the fire showing.
    const front = oz + d / 2
    parts.push(box(ox, 0.02, front - 0.04, 0.2, 0.2, 0.11, C.brickDark), box(ox, 0.22, front - 0.04, 0.22, 0.025, 0.12, C.stoneDark))
    parts.push(box(ox, 0.06, front + 0.019, 0.11, 0.1, 0.012, C.fire, { emissive: C.fire }), box(ox, 0.16, front + 0.021, 0.14, 0.03, 0.012, C.stoneDark))
    parts.push(box(ox, 0.02, front + 0.06, 0.18, 0.02, 0.06, C.stone))
    const domeTop = base + dh
    if (stage <= 3) {
        const fh = [0.46, 0.72, 0.8, 0.92][stage]!
        flue(spec, ox, domeTop - 0.05, oz, fh, stage >= 2 ? 0.09 : 0.08, stage >= 2 ? look.trim : C.brickDark, stage === 3 ? C.accent : C.stoneDark)
        if (stage === 2) parts.push(...pennant(ox + 0.07, domeTop + fh * 0.62 + 0.03, oz, look.banner, metal, 0.22))
    } else {
        // The patisserie's oven tower: lit windows up a marble drum, a gold crown round the dome, a glowing lantern and a gold spire.
        const flat = oz + d / 2 * Math.cos(Math.PI / 12)
        for (const y of [0.32, 0.5]) parts.push(box(ox, y, flat, 0.07, 0.13, 0.012, C.lit, { emissive: C.litGlow }))
        parts.push(...onFace('front', 0, 2 * (flat - oz), drape(0, 0.7, 0.2, look.banner, metal), ox, oz))
        parts.push(cyl(ox, base, oz, d + 0.05, 0.035, C.gold, { seg: 12 }))
        for (let i = 0; i < 8; i++) {
            const a = (i + 0.5) / 8 * Math.PI * 2
            const r = d / 2 + 0.005
            parts.push(cone(ox + Math.sin(a) * r, base + 0.035, oz + Math.cos(a) * r, 0.06, 0.11, C.gold, { seg: 4 }))
            parts.push(box(ox + Math.sin(i / 8 * Math.PI * 2) * (d / 2 - 0.012), base + 0.05, oz + Math.cos(i / 8 * Math.PI * 2) * (d / 2 - 0.012), 0.04, 0.05, 0.04, C.fire, { emissive: C.fire }))
        }
        parts.push(cyl(ox, domeTop - 0.03, oz, 0.14, 0.12, C.lit, { seg: 8, emissive: C.litGlow }), cyl(ox, domeTop + 0.09, oz, 0.17, 0.025, C.gold, { seg: 8 }))
        parts.push(cone(ox, domeTop + 0.115, oz, 0.08, 0.34, C.gold, { seg: 6 }), ball(ox, domeTop + 0.44, oz, 0.05, 0.05, C.gold, { seg: 6 }))
        flue(spec, ox, base + 0.1, oz - 0.1, 0.5, 0.08, look.trim, C.stoneDark)
    }

    // ── The yard: flour sacks and firewood by the oven, the café in front of the shop.
    parts.push(sack(0.44, 0.02, 0.24), sack(0.44, 0.02, 0.34), sack(0.44, 0.08, 0.29, C.stoneLight))
    parts.push(...logPile(0.25, 0.42, 0.22, 1))
    parts.push(...parasolTable(-0.33, 0.34, look.roof, metal))
    if (stage >= 1) parts.push(...parasolTable(-0.08, 0.38, C.white, metal))
    if (stage === 0) parts.push(...barrel(-0.06, 0.02, 0.36, 0.09))
    if (stage >= 1) parts.push(...lampPost(0.46, 0.46, metal))
    if (stage >= 3) parts.push(...balustrade(-0.47, 0.475, -0.2, 0.475, 0.02, look.trim), ...planter(-0.1, 0.02, 0.47, 0.14, C.bloomPink))
    return variant % 2 ? mirrorX(spec) : spec
}

// ─── The Emporium ────────────────────────────────────────────────────────────
// A grand store under a dome. Purple is its own colour on every tile; walls,
// roof and trim follow the look, and every look adds a storey and more crown.

const PURPLE = C.purple

export const emporiumModel: Factory = (stage, variant) => {
    const look = tierLook(stage)
    const spec: ModelSpec = { parts: [ground(stage >= 2 ? C.paving : C.cobble)] }
    const parts = spec.parts
    const flip = variant % 2 ? -1 : 1
    const floors = [2, 3, 4, 4, 5][stage]!
    const top = 0.02 + townhouseWallHeight(floors)
    const w = 0.96, d = 0.78, cz = -0.09
    const style: WindowStyle = { stage, look, frame: look.trim }
    const metal = look.metal
    const face = (f: Face, items: Part[]) => parts.push(...onFace(f, w, d, items, 0, cz))

    parts.push(box(0, 0.02, cz, w + 0.02, 0.06, d + 0.02, C.stoneDark), box(0, 0.02, cz, w, top - 0.02, d, look.wall))
    // Ground floor: the shop in the second wall tone, purple door and lit showcases.
    parts.push(box(0, 0.02, cz, w + 0.008, GROUND_FLOOR, d + 0.008, look.wall2))
    face('front', [
        box(0, 0.02, 0.004, 0.2, 0.27, 0.02, look.trim), box(0, 0.02, 0.01, 0.16, 0.24, 0.02, PURPLE),
        ...[-0.3, 0.3].map(x => box(x, 0.1, 0.006, 0.2, 0.17, 0.02, C.lit, { emissive: C.litGlow })),
        ...[-0.3, 0.3].map(x => box(x, 0.09, 0.004, 0.23, 0.19, 0.014, look.trim))
    ])
    for (const f of ['back', 'left', 'right'] as const) face(f, windows(style, f === 'back' ? w : d, 0, 0.14, 3, 1, { sill: true }))
    for (let floor = 1; floor < floors; floor++) {
        const y = storey(floor)
        parts.push(box(0, y - 0.012, cz, w + 0.024, 0.024, d + 0.024, stage >= 4 ? look.trim : shade(look.trim, stage === 0 ? 0 : -0.04)))
        for (const f of ['front', 'back', 'left', 'right'] as const) face(f, windows(style, f === 'left' || f === 'right' ? d : w, 0, y + 0.06, f === 'front' ? 4 : 3, floor, { cap: f === 'front' }))
    }
    if (stage === 0) {
        // General store: timber posts and a long purple awning.
        face('front', [...[-0.47, 0.47].map(x => box(x, 0.02, 0.004, 0.03, top - 0.02, 0.012, C.timber)), ...awning(0, 0.3, 0.94, PURPLE, C.white, 0.08)])
        parts.push(...[-0.36, 0.36].flatMap(x => [...barrel(x * flip, 0.02, 0.4, 0.09)]), box(0.22 * flip, 0.02, 0.41, 0.12, 0.1, 0.1, C.plank), box(-0.22 * flip, 0.02, 0.41, 0.1, 0.08, 0.1, C.plank))
    } else {
        // Colonnade across the front, taller and richer every look.
        const ch = GROUND_FLOOR + 0.02
        const cols = stage >= 3 ? [-0.44, -0.26, -0.09, 0.09, 0.26, 0.44] : [-0.42, -0.14, 0.14, 0.42]
        const colColor = stage === 1 ? look.wall2 : look.wall
        for (const x of cols) parts.push(...(stage === 1 ? [box(x, 0.02, 0.4, 0.07, ch, 0.07, colColor)] : column(x, 0.02, 0.4, ch, colColor, look.trim)))
        parts.push(box(0, 0.02 + ch, 0.39, 0.98, 0.05, 0.14, look.wall), box(0, 0.07 + ch, 0.39, 1, 0.025, 0.16, look.trim))
        parts.push(box(0, 0.02, 0.4, 0.98, 0.02, 0.14, C.stoneLight))
        if (stage >= 2) parts.push(...balustrade(-0.44, 0.44, 0.44, 0.44, 0.095 + ch, look.trim))
    }
    // Purple drapes on the upper facade.
    if (stage >= 1) face('front', [-0.24, 0.24].flatMap(x => drape(x, storey(1) + 0.22, top - storey(1) - 0.3, PURPLE, metal)))
    parts.push(box(0, top - 0.035, cz, w + 0.04, 0.035, d + 0.04, look.trim))

    // Crown: a pitched roof, then a cupola, then a flat roof and ever grander domes.
    if (stage === 0) {
        parts.push(...gableRoof(0, top, cz, 1, d + 0.04, 0.36, look.roof, 'x', look.wall))
        chimney(spec, 0.34 * flip, top, cz - 0.14, 0.3)
        face('front', [box(0, top - 0.16, 0.012, 0.44, 0.1, 0.02, PURPLE), box(0, top - 0.14, 0.024, 0.34, 0.06, 0.006, C.bloomWhite)])
        return spec
    }
    if (stage === 1) {
        parts.push(...hipRoof(0, top, cz, 1, d + 0.04, 0.3, look.roof, 0.26))
        parts.push(cyl(0, top + 0.22, cz, 0.22, 0.14, look.wall, { seg: 8 }), cyl(0, top + 0.36, cz, 0.26, 0.025, look.trim, { seg: 8 }), dome(0, top + 0.385, cz, 0.24, 0.13, C.accent, { seg: 8 }))
        parts.push(...weathervane(0, top + 0.5, cz, 0.16))
        face('front', [...wallLamp(-0.14, 0.3, metal), ...wallLamp(0.14, 0.3, metal)])
        return spec
    }
    parts.push(...flatRoof(0, top, cz, w, d, C.stone, look.trim))
    if (stage >= 3) parts.push(...balustrade(-0.44, cz + d / 2 - 0.03, 0.44, cz + d / 2 - 0.03, top + 0.03, look.trim))
    const drumH = [0, 0, 0.14, 0.2, 0.26][stage]!
    const dw = [0, 0, 0.56, 0.58, 0.62][stage]!
    parts.push(cyl(0, top + 0.03, cz, dw, drumH, look.wall, { seg: 12 }), cyl(0, top + 0.03 + drumH - 0.03, cz, dw + 0.04, 0.03, look.trim, { seg: 12 }))
    for (let i = 0; i < 6; i++) {
        const a = (i + 0.5) / 6 * Math.PI * 2
        parts.push(box(Math.sin(a) * (dw / 2 - 0.01), top + 0.03 + drumH * 0.28, cz + Math.cos(a) * (dw / 2 - 0.01), 0.06, drumH * 0.45, 0.02, C.lit, { emissive: C.litGlow, rotY: a }))
    }
    const dy = top + 0.03 + drumH
    const dh = [0, 0, 0.3, 0.32, 0.36][stage]!
    parts.push(dome(0, dy, cz, dw, dh, look.roof, { seg: 12 }))
    // Lantern on top of the dome; the palace's glows and wears a gold spire.
    parts.push(cyl(0, dy + dh - 0.02, cz, 0.1, 0.08, stage >= 4 ? C.lit : look.wall, stage >= 4 ? { seg: 8, emissive: C.litGlow } : { seg: 8 }), cone(0, dy + dh + 0.06, cz, 0.13, 0.07, look.roof, { seg: 8 }))
    parts.push(cone(0, dy + dh + 0.13, cz, 0.05, stage >= 4 ? 0.26 : 0.12, metal, { seg: 6 }), ball(0, dy + dh + (stage >= 4 ? 0.37 : 0.24), cz, 0.035, 0.035, metal, { seg: 5 }))
    if (stage >= 2) {
        // Teal-capped corner cupolas: two at the back, four on the palace.
        const corners: [number, number][] = stage >= 4 ? [[-0.37, cz - 0.28], [0.37, cz - 0.28], [-0.37, cz + 0.28], [0.37, cz + 0.28]] : [[-0.37, cz - 0.28], [0.37, cz - 0.28]]
        for (const [x, z] of corners) parts.push(cyl(x, top + 0.03, z, 0.17, 0.12, look.wall, { seg: 8 }), cyl(x, top + 0.14, z, 0.2, 0.02, look.trim, { seg: 8 }), dome(x, top + 0.16, z, 0.18, 0.11, C.accent, { seg: 8 }), ball(x, top + 0.26, z, 0.035, 0.035, metal, { seg: 5 }))
    }
    if (stage >= 3) parts.push(...lampPost(-0.47, 0.49, metal), ...lampPost(0.47, 0.49, metal))
    if (stage >= 4) for (const x of [-0.37, 0.37]) parts.push(...pennant(x, top + 0.28, cz + 0.28, PURPLE, metal))
    return spec
}
