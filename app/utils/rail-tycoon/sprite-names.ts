// Rail Tycoon — sprite names.
//
// The names the renderer asks the atlas for, the water animation clock and the bridge from map
// bits to those names. Pure, so it is unit tested in test/rail-tycoon/sprites.spec.ts.

import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import type { RtVehicleModelId } from '#shared/utils/rail-tycoon/catalog'
import { RT_ROAD_DIR_BIT, RtDir, RtSlope } from '#shared/utils/rail-tycoon/map'

/* ------------------------------------------------------------------------------------------
 * Water animation
 * ---------------------------------------------------------------------------------------- */

/** Water (and coast) frames in the atlas: one full turn of the water colours. */
export const RT_WATER_FRAMES = 8

/**
 * Wall-clock length of one water colour cycle. The original rotates its dark-water colours one
 * full turn every 65536 / (8 * 320) = 25.6 palette steps, one step per game tick.
 */
export const RT_WATER_CYCLE_MS = (65536 / (8 * 320)) * RT_CATALOG.time.tickMs

/** The water frame to show at a wall-clock time in ms (cosmetic, so it keeps running while paused). */
export function rtWaterFrameAt(ms: number, frames = RT_WATER_FRAMES): number {
    const frame = Math.floor(ms / (RT_WATER_CYCLE_MS / frames)) % frames
    return frame < 0 ? frame + frames : frame
}

/* ------------------------------------------------------------------------------------------
 * Sprite names (atlas.json meta documents each family)
 * ---------------------------------------------------------------------------------------- */

/** The 19 slope names of the atlas and their raised corners (meta.slopes). */
export const RT_SLOPE_CORNERS = {
    'flat': '',
    'w': 'w',
    's': 's',
    'sw': 'sw',
    'e': 'e',
    'ew': 'ew',
    'se': 'se',
    'wse': 'wse',
    'n': 'n',
    'nw': 'nw',
    'ns': 'ns',
    'nws': 'nws',
    'ne': 'ne',
    'enw': 'enw',
    'sen': 'sen',
    'steep-n': 'enw',
    'steep-s': 'wse',
    'steep-w': 'nws',
    'steep-e': 'sen'
} as const
export type RtSlopeName = keyof typeof RT_SLOPE_CORNERS

/** Tile sides, the names the atlas uses for road halves, ramps and building facings. */
export type RtSideName = 'ne' | 'se' | 'sw' | 'nw'
export const RT_SIDE_NAMES: readonly RtSideName[] = ['ne', 'se', 'sw', 'nw']

/** The 8 directions of vehicle and signal sprites, in atlas order (meta.directions). */
export type RtSpriteDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export const RT_SPRITE_DIRECTIONS: readonly RtSpriteDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

/** Rail track pieces (meta.railPieces): x NE-SW, y NW-SE, and the four corner pieces. */
export type RtRailPiece = 'x' | 'y' | 'n' | 's' | 'e' | 'w'
export const RT_RAIL_PIECES: readonly RtRailPiece[] = ['x', 'y', 'n', 's', 'e', 'w']

/** Tile sides each rail piece touches. */
const RAIL_PIECE_SIDES: Record<RtRailPiece, readonly RtSideName[]> = {
    x: ['ne', 'sw'],
    y: ['nw', 'se'],
    n: ['ne', 'nw'],
    s: ['se', 'sw'],
    e: ['ne', 'se'],
    w: ['nw', 'sw']
}

/** Piece sets with a sprite of their own; any other set is a junction ground plus one overlay per piece. */
const RAIL_FLAT_SETS: Record<string, string> = {
    'x': 'rail.flat.x',
    'y': 'rail.flat.y',
    'n': 'rail.flat.n',
    's': 'rail.flat.s',
    'e': 'rail.flat.e',
    'w': 'rail.flat.w',
    'x-y': 'rail.flat.x-y',
    'n-s': 'rail.flat.n-s',
    'e-w': 'rail.flat.e-w'
}

/** The slope name for a set of raised corners (any order) and the steep flag. */
export function rtSlopeNameFromCorners(corners: string, steep: boolean): RtSlopeName {
    const key = [...corners].sort().join('')
    for (const [name, raised] of Object.entries(RT_SLOPE_CORNERS) as [RtSlopeName, string][]) {
        if (name.startsWith('steep-') !== steep) continue
        if ([...raised].sort().join('') === key) return name
    }
    throw new RangeError(`no slope with corners '${corners}'${steep ? ' (steep)' : ''}`)
}

/** Bare terrain: ground grass or rough; rough flat land has variants 0 to 4. */
export function rtTerrainSpriteName(ground: 'grass' | 'rough', slope: RtSlopeName, variant = 0): string {
    if (ground === 'rough' && slope === 'flat' && variant > 0) return `terrain.rough.flat-${((variant - 1) % 4) + 1}`
    return `terrain.${ground}.${slope}`
}

export function rtFoundationSpriteName(slope: RtSlopeName): string | null {
    if (slope === 'flat' || slope.startsWith('steep-')) return null
    return `foundation.${slope}`
}

export function rtWaterSpriteName(frame: number): string {
    return `water.${frame}`
}

export function rtCoastSpriteName(slope: RtSlopeName, frame: number): string {
    return `coast.${slope}.${frame}`
}

export function rtTreeSpriteName(type: number, stage: number): string {
    return `tree.${type}.${stage}`
}

/** The incline a single straight piece climbs: the slopes with two adjacent corners raised. */
const RAIL_INCLINES: Partial<Record<RtSlopeName, RtRailPiece>> = { ne: 'x', sw: 'x', se: 'y', nw: 'y' }

/**
 * The sprites of a rail tile, drawn in order: one piece set sprite, or a junction ground (named
 * for the tile side no piece touches) followed by one overlay per piece. A single straight piece
 * on its incline uses the sloped sprite; on any other slope the renderer draws the foundation and
 * then these flat sprites on top.
 */
export function rtRailSpriteNames(pieces: Iterable<RtRailPiece>, slope: RtSlopeName = 'flat'): string[] {
    const set = RT_RAIL_PIECES.filter(p => [...pieces].includes(p))
    if (!set.length) return []
    if (set.length === 1 && RAIL_INCLINES[slope] === set[0]) return [`rail.slope.${slope}`]
    const own = RAIL_FLAT_SETS[set.join('-')]
    if (own) return [own]
    const touched = new Set(set.flatMap(p => RAIL_PIECE_SIDES[p]))
    const open = (['ne', 'sw', 'nw', 'se'] as const).find(side => !touched.has(side))
    return [open ? `rail.junction.no-${open}` : 'rail.junction.all', ...set.map(p => `rail.overlay.${p}`)]
}

/** A road tile: the half-tile pieces present, or the ramp when the road climbs a slope. */
export function rtRoadSpriteName(surface: 'grass' | 'town', sides: Iterable<RtSideName>, slope: RtSlopeName = 'flat'): string | null {
    const present = RT_SIDE_NAMES.filter(s => [...sides].includes(s))
    if (!present.length) return null
    if (RAIL_INCLINES[slope]) return `road.${surface}.slope-${slope}`
    return `road.${surface}.${present.join('-')}`
}

/** A level crossing; railAxis is the rail's axis piece (x or y). */
export function rtCrossingSpriteName(surface: 'grass' | 'town', railAxis: 'x' | 'y', closed: boolean): string {
    return `crossing.${surface}.${railAxis}${closed ? '-closed' : ''}`
}

/** A signal; facing is the direction a train passing it travels (meta signal names `to-<dir>`). */
export function rtSignalSpriteName(kind: 'block' | 'path' | 'path-oneway', facing: RtSpriteDirection, green: boolean): string {
    return `signal.${kind}.to-${facing}.${green ? 'green' : 'red'}`
}

/** A rail station tile's rear and front parts. */
export function rtStationSpriteNames(axis: 'x' | 'y', building: boolean): { rear: string, front: string } {
    const prefix = `station.rail.${axis}.${building ? 'building' : 'plain'}`
    return { rear: `${prefix}.rear`, front: `${prefix}.front` }
}

/** A depot's parts in draw order: ground, building (rear) and, for the se and sw facings, a front part. */
export function rtDepotSpriteNames(kind: 'rail' | 'road', facing: RtSideName): string[] {
    const parts = facing === 'se' || facing === 'sw' ? ['ground', 'building', 'front'] : ['ground', 'building']
    return parts.map(part => `depot.${kind}.${facing}.${part}`)
}

/** A road stop's ground and its parts a (rear), b and c (front). */
export function rtRoadStopSpriteNames(kind: 'bus' | 'truck', facing: RtSideName): string[] {
    return ['ground', 'a', 'b', 'c'].map(part => `roadstop.${kind}.${facing}.${part}`)
}

/** House size classes of RT_CATALOG.houses.classes, in order. */
export const RT_HOUSE_SIZES = ['small', 'medium', 'large'] as const

/** A house of a size class; variant wraps over the count of that class in the atlas. */
export function rtHouseSpriteName(sizeClass: number, variant: number, count: number): string {
    const size = RT_HOUSE_SIZES[sizeClass]
    if (!size) throw new RangeError(`no house size class ${sizeClass}`)
    return `house.${size}.${((variant % count) + count) % count}`
}

/** An industry tile by industry type id and its tile index (meta.industryLayouts). */
export function rtIndustrySpriteName(type: string, tile: number): string {
    return `industry.${type}.${tile}`
}

/** Atlas vehicle kind of each catalog model, and the loaded look where the atlas has one. */
export const RT_VEHICLE_SPRITES: Record<RtVehicleModelId, { empty: string, loaded: string }> = {
    tankEngine: { empty: 'vehicle.train.steam', loaded: 'vehicle.train.steam' },
    expressEngine: { empty: 'vehicle.train.diesel', loaded: 'vehicle.train.diesel' },
    passengerCoach: { empty: 'vehicle.wagon.passengers', loaded: 'vehicle.wagon.passengers' },
    mailCar: { empty: 'vehicle.wagon.mail', loaded: 'vehicle.wagon.mail' },
    coalHopper: { empty: 'vehicle.wagon.coal', loaded: 'vehicle.wagon.coal-full' },
    timberFlat: { empty: 'vehicle.wagon.wood', loaded: 'vehicle.wagon.wood-full' },
    goodsBoxcar: { empty: 'vehicle.wagon.goods', loaded: 'vehicle.wagon.goods' },
    townBus: { empty: 'vehicle.road.bus', loaded: 'vehicle.road.bus' },
    mailVan: { empty: 'vehicle.road.mail', loaded: 'vehicle.road.mail' },
    coalLorry: { empty: 'vehicle.road.coal', loaded: 'vehicle.road.coal-full' },
    timberLorry: { empty: 'vehicle.road.wood', loaded: 'vehicle.road.wood-full' },
    goodsLorry: { empty: 'vehicle.road.goods', loaded: 'vehicle.road.goods' }
}

export function rtVehicleSpriteName(model: RtVehicleModelId, direction: RtSpriteDirection, loaded: boolean): string {
    const kind = RT_VEHICLE_SPRITES[model]
    return `${loaded ? kind.loaded : kind.empty}.${direction}`
}

/* ------------------------------------------------------------------------------------------
 * Map encoding bridge: the only place map bits become sprite names.
 * Slope and road bits come from shared/utils/rail-tycoon/map.ts. Track bits are defined in
 * track.ts, so the renderer passes that table to rtRailPiecesFromBits.
 * ---------------------------------------------------------------------------------------- */

/** The slope name of an RtMap.tileSlope value (RtSlope corner bits plus RtSlope.steep). */
export function rtSlopeNameFromBits(bits: number): RtSlopeName {
    let corners = ''
    if (bits & RtSlope.n) corners += 'n'
    if (bits & RtSlope.e) corners += 'e'
    if (bits & RtSlope.s) corners += 's'
    if (bits & RtSlope.w) corners += 'w'
    return rtSlopeNameFromCorners(corners, (bits & RtSlope.steep) !== 0)
}

/** The road sides present in a road-bit mask (RT_ROAD_DIR_BIT per RtDir). */
export function rtRoadSidesFromBits(bits: number): RtSideName[] {
    return RT_SIDE_NAMES.filter(side => bits & RT_ROAD_DIR_BIT[RtDir[side]]!)
}

/** The bit of each rail piece in a track-bit mask; the renderer supplies track.ts's encoding. */
export type RtTrackBitTable = Readonly<Record<RtRailPiece, number>>

export function rtRailPiecesFromBits(bits: number, table: RtTrackBitTable): RtRailPiece[] {
    return RT_RAIL_PIECES.filter(piece => bits & table[piece])
}
