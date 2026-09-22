// Polytown — plastered townhouses. One parametric builder covers the House and
// every shop that lives in a house-shaped building. A house is an L: a main
// block across the back of the tile and a wing down one side of the front, so
// the front corner left over is a walled garden with a tree. The plot still
// runs edge to edge, but from the camera every house has its own silhouette,
// throws a shadow into its garden and shows some green between the roofs.
// Levels add storeys, a dormer, corner turrets and finally a teal dome; the
// roof colour follows the level (tierRoof), the tile only picks plaster,
// shutters and roof shape.

import { C, awning, balcony, ball, box, bush, chimney, cone, cyl, doorAt, dome, dormer, fence, flag, flowerBed, gableRoof, ground, hipRoof, lantern, onFace, planter, roundTree, shade, tierRoof, turret, weathervane, windowRow, type ModelSpec, type Part } from './kit'

const WALLS = [C.cream, C.white, C.ochre, C.sky, C.rose, C.cream, C.white, C.mint]
const SHUTTERS = [C.shutterGreen, C.shutterBrown, C.shutterTeal, C.shutterBlue]

export interface TownhouseOptions {
    floors: number
    wall: number
    roof: number
    shutters: number
    roofKind: 'gable' | 'hip'
    /** Wing on the left (-1) or right (1) of the front; the garden takes the other corner. */
    doorSide?: number
    paving?: number
    /** Striped awning over a ground-floor shop window on the wing. */
    shop?: [number, number]
    /** Stone corners and cornice on the grander stages. */
    dressed?: boolean
    /** Dark beams across the upper storeys. */
    timbered?: boolean
    /** Round corner towers with teal caps: 0, 1 or 2. */
    turrets?: number
    /** Central dome on the main roof: 0 none, 1 small, 2 grand. */
    dome?: number
    chimneys?: number
    chimneyColor?: number
    /** Weathervane on the ridge. */
    vane?: boolean
}

export const HOUSE_W = 0.96
/** Main block depth and centre; the wing and garden take the rest of the tile. */
export const HOUSE_D = 0.56
export const HOUSE_Z = -0.2
const WING_W = 0.5
const WING_D = 0.38
const WING_Z = 0.27
const GROUND_FLOOR = 0.34
const UPPER_FLOOR = 0.28

export function townhouseWallHeight(floors: number) {
    return GROUND_FLOOR + (floors - 1) * UPPER_FLOOR
}

export function townhouse(o: TownhouseOptions): ModelSpec {
    const spec: ModelSpec = { parts: [] }
    const parts = spec.parts
    const side = o.doorSide ?? -1
    const mw = HOUSE_W, md = HOUSE_D, mz = HOUSE_Z
    const ww = WING_W, wd = WING_D, wx = side * (0.48 - ww / 2), wz = WING_Z
    const wingFloors = o.floors >= 3 ? o.floors - 1 : o.floors
    const top = 0.02 + townhouseWallHeight(o.floors)
    const wtop = 0.02 + townhouseWallHeight(wingFloors)
    const frame = o.wall === C.white ? C.timber : C.trim
    const band = o.dressed ? C.stoneLight : o.timbered ? C.timber : shade(o.wall, -0.14)
    const cornice = o.dressed ? C.stoneLight : frame

    parts.push(ground(o.paving ?? C.cobble))
    parts.push(box(0, 0.02, mz, mw + 0.02, 0.06, md + 0.02, C.stoneDark), box(0, 0.02, mz, mw, top - 0.02, md, o.wall))
    parts.push(box(wx, 0.02, wz, ww + 0.02, 0.06, wd + 0.02, C.stoneDark), box(wx, 0.02, wz, ww, wtop - 0.02, wd, o.wall))

    const main = (f: 'front' | 'back' | 'left' | 'right', items: Part[]) => parts.push(...onFace(f, mw, md, items, 0, mz))
    const wing = (f: 'front' | 'back' | 'left' | 'right', items: Part[]) => parts.push(...onFace(f, ww, wd, items, wx, wz))
    const outer = side > 0 ? 'right' : 'left'
    const inner = side > 0 ? 'left' : 'right'
    const win = { h: 0.15, shutters: o.shutters, frame }

    // Ground floor: the door opens onto the garden, the wing shows a window or shop front.
    main('front', [...doorAt(-side * 0.15, 0.14, 0.26), ...windowRow(0.2, 0.12, 1, { ...win, lit: 1 }).map(p => ({ ...p, x: p.x - side * 0.37 }))])
    if (o.shop) wing('front', [box(0, 0.08, 0.004, 0.36, 0.17, 0.02, C.lit, { emissive: C.litGlow }), box(0, 0.07, 0.002, 0.4, 0.2, 0.014, frame), box(0, 0.06, 0.012, 0.4, 0.02, 0.04, C.woodDark), ...awning(0, 0.29, 0.44, o.shop[0], o.shop[1], 0.05)])
    else wing('front', windowRow(ww, 0.12, 2, { ...win, lit: 1 }))
    main('back', windowRow(mw, 0.12, 3, win))
    for (const f of ['left', 'right'] as const) main(f, windowRow(md, 0.12, 2, { ...win, sill: false, lit: f === 'left' ? 1 : 0 }))
    wing(outer, windowRow(wd, 0.12, 2, { ...win, sill: false }))
    wing(inner, windowRow(wd, 0.12, 1, { ...win, lit: 1 }))

    for (let floor = 1; floor < o.floors; floor++) {
        const y = 0.02 + GROUND_FLOOR + (floor - 1) * UPPER_FLOOR
        parts.push(box(0, y - 0.012, mz, mw + 0.025, 0.025, md + 0.025, band))
        main('front', windowRow(0.36, y + 0.06, 2, { ...win, lit: floor }).map(p => ({ ...p, x: p.x - side * 0.27 })))
        main('back', windowRow(mw, y + 0.06, 3, { ...win, lit: floor + 1 }))
        for (const f of ['left', 'right'] as const) main(f, windowRow(md, y + 0.06, 2, { ...win, sill: false, lit: floor + (f === 'left' ? 0 : 1) }))
        if (o.timbered) main('back', [...[-0.47, -0.16, 0.16, 0.47].map(x => box(x, y, 0.002, 0.025, UPPER_FLOOR, 0.012, C.timber)), box(0, y + UPPER_FLOOR - 0.03, 0.002, mw, 0.02, 0.012, C.timber)])
        if (floor < wingFloors) {
            parts.push(box(wx, y - 0.012, wz, ww + 0.025, 0.025, wd + 0.025, band))
            wing('front', windowRow(ww, y + 0.06, 2, { ...win, lit: floor }))
            wing(outer, windowRow(wd, y + 0.06, 2, { ...win, sill: false, lit: floor + 1 }))
            wing(inner, windowRow(wd, y + 0.06, 1, { ...win, lit: floor }))
            if (o.timbered) wing('front', [...[-0.24, 0, 0.24].map(x => box(x, y, 0.002, 0.025, UPPER_FLOOR, 0.012, C.timber)), box(0, y + UPPER_FLOOR - 0.03, 0.002, ww, 0.02, 0.012, C.timber)])
        }
    }
    if (o.floors >= 3) main('front', [...balcony(-side * 0.25, 0.02 + GROUND_FLOOR + 0.03, 0.34, o.shutters), ...planter(-side * 0.25, 0.02 + GROUND_FLOOR + 0.055, 0.06, 0.22)])
    if (o.floors >= 5) main('front', balcony(-side * 0.25, 0.02 + GROUND_FLOOR + UPPER_FLOOR * 3 + 0.03, 0.4, o.shutters))
    if (o.dressed) {
        for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(x * (mw / 2 - 0.02), 0.08, mz + z * (md / 2 - 0.02), 0.06, top - 0.08, 0.06, C.stoneLight))
        parts.push(box(wx + side * (ww / 2 - 0.02), 0.08, wz + wd / 2 - 0.02, 0.06, wtop - 0.08, 0.06, C.stoneLight))
    }
    parts.push(box(0, top - 0.035, mz, mw + 0.04, 0.035, md + 0.04, cornice), box(wx, wtop - 0.035, wz, ww + 0.04, 0.035, wd + 0.04, cornice))

    // Roofs: the main ridge runs across the tile, the wing's runs out to the street.
    const rh = o.roofKind === 'hip' ? 0.3 : 0.36
    const rhw = 0.28
    if (o.roofKind === 'hip') parts.push(...hipRoof(0, top, mz, 1, md + 0.04, rh, o.roof, 0.24))
    else parts.push(...gableRoof(0, top, mz, 1, md + 0.04, rh, o.roof, 'x', o.wall))
    parts.push(...gableRoof(wx, wtop, wz - 0.03, ww + 0.04, wd + 0.1, rhw, o.roof, 'z', o.wall))
    const chimneys = o.chimneys ?? (o.floors >= 3 ? 2 : 1)
    chimney(spec, side * 0.3, top + rh * 0.4, mz - 0.14, rh * 0.6 + 0.1, o.chimneyColor ?? C.brick)
    if (chimneys >= 2) chimney(spec, wx + side * 0.1, wtop + rhw * 0.5, wz - 0.08, rhw * 0.5 + 0.1, o.chimneyColor ?? C.brick)
    if (o.floors >= 3) parts.push(...dormer(-side * 0.25, top + 0.06, mz + 0.14, o.wall, o.roof))
    if (o.floors >= 5) parts.push(...dormer(side * 0.25, top + 0.06, mz + 0.14, o.wall, o.roof))
    if (o.vane) parts.push(...weathervane(-side * 0.3, top + (o.roofKind === 'hip' ? rh : rh + 0.018), mz))
    if (o.turrets) {
        // The first tower takes the wing's street corner, the second the far corner of the main block.
        parts.push(...turret(side * 0.38, 0.02, 0.38, 0.2, wtop + 0.14, o.wall, C.accent, cornice))
        if (o.turrets >= 2) parts.push(...turret(-side * 0.38, 0.02, -0.38, 0.2, top + 0.14, o.wall, C.accent, cornice))
    }
    if (o.dome) {
        const dw = o.dome >= 2 ? 0.4 : 0.32
        const dy = top + rh * 0.5
        parts.push(cyl(0, dy, mz, dw - 0.02, 0.16, o.wall, { seg: 12 }), cyl(0, dy + 0.14, mz, dw + 0.02, 0.025, cornice, { seg: 12 }))
        parts.push(dome(0, dy + 0.165, mz, dw, dw * 0.62, C.accent, { seg: 12 }), ball(0, dy + 0.165 + dw * 0.62, mz, 0.05, 0.05, C.gold, { seg: 6 }))
        if (o.dome >= 2) parts.push(cone(0, dy + 0.2 + dw * 0.62, mz, 0.05, 0.14, C.gold, { seg: 6 }))
    }

    // The garden: lawn, path to the door, low fence to the street, a tree in the corner.
    const gx = -side * 0.25
    parts.push(box(gx, 0.02, 0.28, 0.46, 0.022, 0.4, C.grass, { flat: true }), box(-side * 0.15, 0.03, 0.29, 0.14, 0.014, 0.4, C.paving, { flat: true }))
    parts.push(...fence(-side * 0.48, 0.47, -side * 0.23, 0.47), ...roundTree(-side * 0.36, 0.36, 0.72, C.leaf, 0.04))
    parts.push(...flowerBed(-side * 0.37, 0.14, 0.18, 0.06, 0.04))
    return spec
}

export function houseModel(stage: number, variant: number): ModelSpec {
    const spec = townhouse({
        floors: stage + 2,
        wall: WALLS[variant % WALLS.length]!,
        roof: tierRoof(stage),
        shutters: SHUTTERS[(variant >> 1) % SHUTTERS.length]!,
        roofKind: variant % 3 === 1 && stage > 0 ? 'hip' : 'gable',
        doorSide: variant % 2 ? 1 : -1,
        dressed: stage >= 3,
        timbered: variant % 4 === 2 && stage < 3,
        turrets: stage >= 3 ? 2 : stage >= 2 ? 1 : 0,
        dome: stage >= 4 ? 2 : stage >= 3 ? 1 : 0,
        vane: stage >= 1
    })
    const side = variant % 2 ? 1 : -1
    if (stage >= 1) spec.parts.push(...bush(-side * 0.08, 0.4, 0.08, C.leafLight, 0.04))
    if (stage >= 2) spec.parts.push(...lantern(-side * 0.06, 0.44, 0.04))
    if (stage >= 3) spec.parts.push(box(-side * 0.36, 0.04, 0.24, 0.16, 0.015, 0.05, C.wood), box(-side * 0.36, 0.02, 0.24, 0.14, 0.03, 0.03, C.iron))
    if (stage >= 4) spec.parts.push(...flag(side * 0.38, 0.02 + townhouseWallHeight(5) + 0.14 + 0.36, 0.38, C.gold, 0.2))
    return spec
}
