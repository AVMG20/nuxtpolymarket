// Polytown — plastered townhouses. One parametric builder covers the House and
// every shop that lives in a house-shaped building: a level adds storeys, the
// colour variant picks the plaster, roof tiles, shutters and roof shape, so a
// street of identical houses still looks like a street.

import { C, awning, balcony, box, chimney, doorAt, flag, gableRoof, ground, hipRoof, lantern, onFace, planter, shade, windowRow, type ModelSpec, type Part } from './kit'

const WALLS = [C.cream, C.ochre, C.terracotta, C.white, C.sky, C.rose]
const ROOFS = [C.roofRed, C.roofOrange, C.roofRed, C.roofBrown, C.roofRed, C.roofBlue, C.roofOrange, C.roofRed, C.roofBrown, C.roofRed, C.roofBlue, C.roofOrange]
const SHUTTERS = [C.shutterGreen, C.shutterBrown, C.shutterTeal, C.shutterBlue]

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
    chimneys?: number
    chimneyColor?: number
}

export const HOUSE_W = 0.96
export const HOUSE_D = 0.9
export const HOUSE_Z = -0.03
const GROUND_FLOOR = 0.27
const UPPER_FLOOR = 0.23

export function townhouseWallHeight(floors: number) {
    return GROUND_FLOOR + (floors - 1) * UPPER_FLOOR
}

export function townhouse(o: TownhouseOptions): ModelSpec {
    const spec: ModelSpec = { parts: [] }
    const parts = spec.parts
    const w = HOUSE_W, d = HOUSE_D, cz = HOUSE_Z
    const top = 0.02 + townhouseWallHeight(o.floors)
    const side = o.doorSide ?? -1
    parts.push(ground(o.paving ?? C.cobble), box(0, 0.02, cz, w + 0.02, 0.05, d + 0.02, C.stoneDark), box(0, 0.02, cz, w, top - 0.02, d, o.wall))

    const face = (f: 'front' | 'back' | 'left' | 'right', items: Part[]) => parts.push(...onFace(f, w, d, items, 0, cz))
    // Ground floor: door to one side, a shop front or two windows beside it.
    face('front', doorAt(side * 0.28))
    if (o.shop) face('front', [box(-side * 0.13, 0.08, 0.004, 0.46, 0.14, 0.02, C.lit, { emissive: C.litGlow }), box(-side * 0.13, 0.06, 0.012, 0.5, 0.02, 0.04, C.woodDark), ...awning(-side * 0.13, 0.235, 0.54, o.shop[0], o.shop[1])])
    else face('front', windowRow(0.5, 0.1, 2, { shutters: o.shutters, lit: 1 }).map(p => ({ ...p, x: p.x - side * 0.15 })))
    face('back', windowRow(w, 0.1, 3, { shutters: o.shutters }))
    for (const f of ['left', 'right'] as const) face(f, windowRow(d, 0.1, 2, { sill: false, lit: f === 'left' ? 1 : 0 }))

    for (let floor = 1; floor < o.floors; floor++) {
        const y = 0.02 + GROUND_FLOOR + (floor - 1) * UPPER_FLOOR
        parts.push(box(0, y - 0.012, cz, w + 0.02, 0.022, d + 0.02, o.dressed ? C.stoneLight : shade(o.wall, -0.1)))
        face('front', windowRow(w, y + 0.055, 3, { shutters: o.shutters, lit: floor }))
        face('back', windowRow(w, y + 0.055, 3, { shutters: o.shutters, lit: floor + 1 }))
        for (const f of ['left', 'right'] as const) face(f, windowRow(d, y + 0.055, 2, { sill: false, lit: floor + (f === 'left' ? 0 : 1) }))
    }
    if (o.floors >= 3) face('front', [...balcony(0, 0.02 + GROUND_FLOOR + UPPER_FLOOR + 0.03, 0.3), ...planter(0, 0.02 + GROUND_FLOOR + UPPER_FLOOR + 0.055, 0.06, 0.2)])
    if (o.floors >= 5) face('front', balcony(0, 0.02 + GROUND_FLOOR + UPPER_FLOOR * 3 + 0.03, 0.62))
    if (o.dressed) {
        for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(x * (w / 2 - 0.02), 0.07, cz + z * (d / 2 - 0.02), 0.06, top - 0.07, 0.06, C.stoneLight))
        parts.push(box(0, top - 0.03, cz, w + 0.03, 0.03, d + 0.03, C.stoneLight))
    }

    // The roof reaches the tile edge so terraces join up without a gap.
    const rh = o.roofKind === 'hip' ? 0.24 : 0.28
    if (o.roofKind === 'hip') parts.push(...hipRoof(0, top, cz + 0.01, 1, 0.98, rh, o.roof, 0.2))
    else parts.push(...gableRoof(0, top, cz + 0.01, 1, 0.98, rh, o.roof, o.roofKind === 'gableX' ? 'x' : 'z', o.wall))
    const chimneys = o.chimneys ?? (o.floors >= 3 ? 2 : 1)
    for (let i = 0; i < chimneys; i++) {
        const cx = (i ? -1 : 1) * side * 0.3
        chimney(spec, o.roofKind === 'gableZ' ? cx * 0.5 : cx, top + rh * 0.35, cz + (o.roofKind === 'gableX' ? -0.12 : -0.28), rh * 0.65 + 0.08, o.chimneyColor ?? C.brick)
    }
    if (o.roofKind === 'gableX' && o.floors >= 3) {
        // Dormers on the street side once the attic is worth living in.
        for (const x of o.floors >= 4 ? [-0.24, 0.24] : [0]) {
            parts.push(box(x, top + 0.04, cz + 0.3, 0.15, 0.13, 0.2, o.wall), ...gableRoof(x, top + 0.17, cz + 0.3, 0.19, 0.24, 0.07, o.roof, 'z'))
            parts.push(box(x, top + 0.07, cz + 0.4, 0.08, 0.08, 0.012, C.lit, { emissive: C.litGlow }))
        }
    }
    return spec
}

export function houseModel(stage: number, variant: number): ModelSpec {
    const spec = townhouse({
        floors: stage + 1,
        wall: WALLS[variant % WALLS.length]!,
        roof: ROOFS[variant % ROOFS.length]!,
        shutters: SHUTTERS[(variant >> 1) % SHUTTERS.length]!,
        roofKind: variant % 4 === 3 ? 'gableZ' : variant % 4 === 1 && stage > 0 ? 'hip' : 'gableX',
        doorSide: variant % 2 ? 1 : -1,
        dressed: stage >= 3
    })
    const side = variant % 2 ? 1 : -1
    if (stage >= 1) spec.parts.push(...planter(-side * 0.15, 0.02, 0.46, 0.4, variant % 3 ? C.bloomPink : C.bloomYellow))
    if (stage >= 2) spec.parts.push(...lantern(side * 0.45, 0.46))
    if (stage >= 4) spec.parts.push(...flag(0, 0.02 + townhouseWallHeight(5) + 0.27, HOUSE_Z, C.roofBlue))
    return spec
}
