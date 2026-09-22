// Polytown — plastered townhouses. One parametric builder covers the House and
// every shop that lives in a house-shaped building: a level adds storeys, the
// colour variant picks the plaster, roof tiles, shutters and roof shape, so a
// street of identical houses still looks like a street. Houses are tall and
// bright on purpose: the camera looks down on them, so the skyline and the
// roof colours are most of what a player sees.

import { C, awning, balcony, box, chimney, doorAt, dormer, flag, gableRoof, ground, hipRoof, lantern, onFace, planter, shade, tierRoof, turret, weathervane, windowRow, type ModelSpec, type Part } from './kit'

// The tile only picks plaster, shutters and roof shape. Roof colour comes from
// the level (tierRoof), so a street reads as levels at a glance.
const WALLS = [C.cream, C.ochre, C.white, C.sky, C.rose, C.mint, C.terracotta, C.lavender]
const SHUTTERS = [C.shutterGreen, C.shutterBrown, C.shutterTeal, C.shutterBlue, C.shutterRed]

export interface TownhouseOptions {
    floors: number
    wall: number
    roof: number
    shutters: number
    roofKind: 'gableX' | 'gableZ' | 'hip'
    /** Door on the left (-1) or right (1) of the front. */
    doorSide?: number
    paving?: number
    /** Striped awning over a ground-floor shop window. */
    shop?: [number, number]
    /** Stone corners and cornice on the grander stages. */
    dressed?: boolean
    /** Dark beams across the upper storeys. */
    timbered?: boolean
    /** Round corner towers with pointed caps: 0, 1 or 2. */
    turrets?: number
    chimneys?: number
    chimneyColor?: number
    /** Weathervane on the ridge. */
    vane?: boolean
}

export const HOUSE_W = 0.96
export const HOUSE_D = 0.9
export const HOUSE_Z = -0.03
const GROUND_FLOOR = 0.34
const UPPER_FLOOR = 0.28

export function townhouseWallHeight(floors: number) {
    return GROUND_FLOOR + (floors - 1) * UPPER_FLOOR
}

export function townhouse(o: TownhouseOptions): ModelSpec {
    const spec: ModelSpec = { parts: [] }
    const parts = spec.parts
    const w = HOUSE_W, d = HOUSE_D, cz = HOUSE_Z
    const top = 0.02 + townhouseWallHeight(o.floors)
    const side = o.doorSide ?? -1
    const frame = o.wall === C.white ? C.timber : C.trim
    const band = o.dressed ? C.stoneLight : o.timbered ? C.timber : shade(o.wall, -0.14)
    parts.push(ground(o.paving ?? C.cobble), box(0, 0.02, cz, w + 0.02, 0.06, d + 0.02, C.stoneDark), box(0, 0.02, cz, w, top - 0.02, d, o.wall))

    const face = (f: 'front' | 'back' | 'left' | 'right', items: Part[]) => parts.push(...onFace(f, w, d, items, 0, cz))
    // Ground floor: door to one side, a shop front or two windows beside it.
    face('front', doorAt(side * 0.28, 0.14, 0.26))
    if (o.shop) face('front', [box(-side * 0.13, 0.08, 0.004, 0.46, 0.17, 0.02, C.lit, { emissive: C.litGlow }), box(-side * 0.13, 0.07, 0.002, 0.5, 0.2, 0.014, frame), box(-side * 0.13, 0.06, 0.012, 0.5, 0.02, 0.04, C.woodDark), ...awning(-side * 0.13, 0.29, 0.54, o.shop[0], o.shop[1])])
    else face('front', windowRow(0.5, 0.12, 2, { h: 0.15, shutters: o.shutters, lit: 1, frame }).map(p => ({ ...p, x: p.x - side * 0.15 })))
    face('back', windowRow(w, 0.12, 3, { h: 0.15, shutters: o.shutters, frame }))
    for (const f of ['left', 'right'] as const) face(f, windowRow(d, 0.12, 2, { h: 0.15, sill: false, frame, lit: f === 'left' ? 1 : 0 }))

    for (let floor = 1; floor < o.floors; floor++) {
        const y = 0.02 + GROUND_FLOOR + (floor - 1) * UPPER_FLOOR
        parts.push(box(0, y - 0.012, cz, w + 0.025, 0.025, d + 0.025, band))
        face('front', windowRow(w, y + 0.06, 3, { h: 0.15, shutters: o.shutters, lit: floor, frame }))
        face('back', windowRow(w, y + 0.06, 3, { h: 0.15, shutters: o.shutters, lit: floor + 1, frame }))
        for (const f of ['left', 'right'] as const) face(f, windowRow(d, y + 0.06, 2, { h: 0.15, sill: false, frame, lit: floor + (f === 'left' ? 0 : 1) }))
        if (o.timbered) {
            // Posts between the windows and a rail under the sills.
            for (const f of ['front', 'back'] as const) face(f, [...[-0.47, -0.16, 0.16, 0.47].map(x => box(x, y, 0.002, 0.025, UPPER_FLOOR, 0.012, C.timber)), box(0, y + UPPER_FLOOR - 0.03, 0.002, w, 0.02, 0.012, C.timber)])
        }
    }
    if (o.floors >= 3) face('front', [...balcony(0, 0.02 + GROUND_FLOOR + UPPER_FLOOR + 0.03, 0.3, o.shutters), ...planter(0, 0.02 + GROUND_FLOOR + UPPER_FLOOR + 0.055, 0.06, 0.2)])
    if (o.floors >= 5) face('front', balcony(0, 0.02 + GROUND_FLOOR + UPPER_FLOOR * 3 + 0.03, 0.62, o.shutters))
    if (o.dressed) {
        for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(x * (w / 2 - 0.02), 0.08, cz + z * (d / 2 - 0.02), 0.06, top - 0.08, 0.06, C.stoneLight))
    }
    // Cornice under the eaves in the trim colour, so the wall and roof separate.
    parts.push(box(0, top - 0.035, cz, w + 0.04, 0.035, d + 0.04, o.dressed ? C.stoneLight : frame))

    // The roof reaches the tile edge so terraces join up without a gap.
    const rh = o.roofKind === 'hip' ? 0.32 : 0.38
    if (o.roofKind === 'hip') parts.push(...hipRoof(0, top, cz + 0.01, 1, 0.98, rh, o.roof, 0.2))
    else parts.push(...gableRoof(0, top, cz + 0.01, 1, 0.98, rh, o.roof, o.roofKind === 'gableX' ? 'x' : 'z', o.wall))
    const chimneys = o.chimneys ?? (o.floors >= 4 ? 2 : 1)
    for (let i = 0; i < chimneys; i++) {
        const cx = (i ? -1 : 1) * side * 0.3
        chimney(spec, o.roofKind === 'gableZ' ? cx * 0.5 : cx, top + rh * 0.35, cz + (o.roofKind === 'gableX' ? -0.12 : -0.28), rh * 0.65 + 0.1, o.chimneyColor ?? C.brick)
    }
    const cap = o.roof
    if (o.roofKind === 'gableX' && o.floors >= 3) {
        // Dormers on the street side once the attic is worth living in.
        for (const x of o.floors >= 4 ? [-0.26, 0.26] : [0]) parts.push(...dormer(x, top + 0.05, cz + 0.3, o.wall, cap))
    }
    if (o.roofKind === 'hip' && o.floors >= 4) parts.push(...dormer(0, top + 0.05, cz + 0.3, o.wall, cap))
    if (o.vane) parts.push(...weathervane(side * 0.18, top + (o.roofKind === 'hip' ? rh : rh + 0.018), cz + (o.roofKind === 'gableZ' ? 0.2 : 0)))
    if (o.turrets) {
        // Corner towers rise a storey above the eaves, capped in the contrast colour.
        const tw = 0.2
        const corners = o.turrets >= 2 ? [-1, 1] : [-side]
        for (const c of corners) parts.push(...turret(c * (w / 2 - 0.1), 0.02, cz + d / 2 - 0.1, tw, top + 0.12, o.wall, cap, o.dressed ? C.stoneLight : frame))
    }
    return spec
}

export function houseModel(stage: number, variant: number): ModelSpec {
    const roof = tierRoof(stage)
    const spec = townhouse({
        floors: stage + 2,
        wall: WALLS[variant % WALLS.length]!,
        roof,
        shutters: SHUTTERS[(variant >> 1) % SHUTTERS.length]!,
        roofKind: variant % 4 === 3 ? 'gableZ' : variant % 4 === 1 && stage > 0 ? 'hip' : 'gableX',
        doorSide: variant % 2 ? 1 : -1,
        dressed: stage >= 3,
        timbered: variant % 3 === 2 && stage < 3,
        turrets: stage >= 3 ? 2 : stage >= 2 ? 1 : 0,
        vane: stage >= 1
    })
    const side = variant % 2 ? 1 : -1
    if (stage >= 1) spec.parts.push(...planter(-side * 0.15, 0.02, 0.46, 0.4, variant % 3 ? C.bloomPink : C.bloomYellow))
    if (stage >= 2) spec.parts.push(...lantern(side * 0.45, 0.46))
    if (stage >= 4) spec.parts.push(...flag(0, 0.02 + townhouseWallHeight(6) + 0.4, HOUSE_Z, C.gold, 0.24))
    return spec
}
