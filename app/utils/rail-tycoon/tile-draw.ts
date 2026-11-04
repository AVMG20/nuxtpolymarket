// Rail Tycoon — tile draw lists.
//
// The sprites each tile draws, ground first in stacking order, one rule per tile kind. Pure: the
// same world and atlas give the same list, unit tested in test/rail-tycoon/renderer.spec.ts.

import { RT_INDUSTRY_TYPE_IDS } from '#shared/utils/rail-tycoon/catalog'
import { rtDepotFacing, rtDepotKind } from '#shared/utils/rail-tycoon/depots'
import { RtTileKind, rtTreeCount, rtTreeStage, rtTreeType, type RtMap } from '#shared/utils/rail-tycoon/map'
import { rtRoadBits } from '#shared/utils/rail-tycoon/road'
import { rtIsSiding } from '#shared/utils/rail-tycoon/sidings'
import {
    RtAxis,
    RtStationTile,
    rtRoadStopBits,
    rtRoadStopFacing,
    rtRoadStopIsBay,
    rtRoadStopRoadOwner,
    rtStationAxis,
    rtStationId,
    rtStationTileType
} from '#shared/utils/rail-tycoon/stations-build'
import { RtSignalType, rtTileSignals } from '#shared/utils/rail-tycoon/signals'
import {
    RT_TRACKDIR_REVERSE,
    RtTrack,
    rtCrossingRoadOwner,
    rtIsCrossing,
    rtRailPieceReserved,
    rtRailPieces,
    rtTrackdirDirection
} from '#shared/utils/rail-tycoon/track'
import { RT_OWNER_NONE, RtVehicleKind, type RtCompany, type RtIndustry, type RtStation } from '#shared/utils/rail-tycoon/types'
import { rtCornerHeightsAt, rtTileToWorld } from './camera'
import {
    RT_INCLINES,
    RT_TRACK_BITS,
    rtGroundDepth,
    rtObjectDepth,
    rtPartDepth,
    rtSignalPoint,
    rtSlopeName,
    rtSurfaceHeight,
    rtTileHash,
    rtTreePoint
} from './render-space'
import {
    RT_HOUSE_SIZES,
    RT_SIDE_NAMES,
    RT_SPRITE_DIRECTIONS,
    rtCoastSpriteName,
    rtCrossingSpriteName,
    rtDepotSpriteNames,
    rtFoundationSpriteName,
    rtHouseSpriteName,
    rtIndustrySpriteName,
    rtRailPiecesFromBits,
    rtRailSpriteNames,
    rtRoadSidesFromBits,
    rtRoadSpriteName,
    rtRoadStopSpriteNames,
    rtSignalSpriteName,
    rtStationSpriteNames,
    rtTerrainSpriteName,
    rtTreeSpriteName,
    rtWaterSpriteName,
    type RtSlopeName
} from './sprite-names'

/* ------------------------------------------------------------------------------------------
 * What a tile draws
 * ---------------------------------------------------------------------------------------- */

/** One sprite of a tile, in world pixels (zoom 1, RtCamera's world space). */
export interface RtDrawItem {
    /** Atlas sprite name. */
    name: string
    /** Colour index (RtCompany.colour) of the company sprites to use, -1 for the shared atlas. */
    colour: number
    /** Ground sprites draw before every standing one. */
    ground: boolean
    /** The point the sprite's atlas offsets count from (whole world pixels). */
    wx: number
    wy: number
    /** Sort key within its layer (rtGroundDepth or rtObjectDepth). */
    z: number
    /** Water and coast cycle their frames; the renderer swaps the frame in place. */
    water?: { coast: RtSlopeName | null }
}

/** What the tile rules need of the atlas; RtSpriteAtlas has it. */
export interface RtSpriteLookup {
    readonly meta: { readonly industryLayouts: Record<string, [number, number, number][]> }
    has(name: string): boolean
    variantCount(prefix: string): number
    get(name: string): { readonly layer: 'rear' | 'front' | null }
}

/** What the tile rules read of the world; RtWorld has it. */
export interface RtDrawWorld {
    readonly map: RtMap
    company(id: number): RtCompany | undefined
    industry(id: number): RtIndustry | undefined
    station(id: number): RtStation | undefined
    readonly occupied: { trainOnPiece(tile: number, piece: number): boolean }
}

/** Whether a tile is the dead-end tile of a parking spot, which gets a marker. */
export function rtIsParkingSpot(map: RtMap, tile: number): boolean {
    return map.kind[tile] === RtTileKind.rail && rtIsSiding(map.payload[tile]!)
}

/** One tile's drawing in progress: the tile, its land, and the sprites so far in stacking order. */
class TileDraw {
    readonly map: RtMap
    readonly x: number
    readonly y: number
    readonly payload: number
    readonly slope: RtSlopeName
    readonly low: number
    readonly high: number
    readonly items: RtDrawItem[] = []
    private sub = 0
    private corners: [number, number, number, number] | null = null

    constructor(readonly world: RtDrawWorld, readonly tile: number, readonly lookup: RtSpriteLookup, readonly waterFrame: number) {
        const map = this.map = world.map
        this.x = map.tileX(tile)
        this.y = map.tileY(tile)
        this.payload = map.payload[tile]!
        this.slope = rtSlopeName(map.tileSlope(tile))
        this.low = map.tileHeight(tile)
        this.high = map.tileMaxHeight(tile)
    }

    ground(name: string, height = this.low, colour = -1, water?: { coast: RtSlopeName | null }): void {
        const at = rtTileToWorld(this.x, this.y, height)
        const item: RtDrawItem = { name, colour, ground: true, wx: at.x, wy: at.y, z: rtGroundDepth(this.x, this.y, this.sub++) }
        if (water) item.water = water
        this.items.push(item)
    }

    part(name: string, height: number, colour = -1): void {
        const at = rtTileToWorld(this.x, this.y, height)
        this.items.push({ name, colour, ground: false, wx: at.x, wy: at.y, z: rtPartDepth(this.x, this.y, this.lookup.get(name).layer) })
    }

    standing(name: string, lx: number, ly: number, height: number, colour = -1): void {
        const at = rtTileToWorld(this.x + lx, this.y + ly, height)
        this.items.push({ name, colour, ground: false, wx: Math.round(at.x), wy: Math.round(at.y), z: rtObjectDepth(this.x, this.y, lx, ly) })
    }

    /** Something standing at (lx, ly) on the land itself. */
    onLand(name: string, lx: number, ly: number): void {
        this.corners ??= rtCornerHeightsAt(this.map, this.x, this.y)
        this.standing(name, lx, ly, rtSurfaceHeight(this.corners, lx, ly))
    }

    terrain(): void {
        this.ground(rtTerrainSpriteName('grass', this.slope))
    }

    /** The level buildings and flat track stand on: the land when flat, else on a foundation at the top corner. */
    level(): number {
        if (this.slope === 'flat') return this.low
        this.ground(rtFoundationSpriteName(this.slope) ?? rtTerrainSpriteName('grass', this.slope))
        return this.high
    }

    water(): void {
        this.ground(rtWaterSpriteName(this.waterFrame), this.low, -1, { coast: null })
    }

    /** The tile owner's colour index, -1 for none. */
    ownerColour(): number {
        return this.world.company(this.map.owner[this.tile]!)?.colour ?? -1
    }
}

function drawCoast(d: TileDraw): void {
    if (d.slope !== 'flat') d.ground(rtCoastSpriteName(d.slope, d.waterFrame), d.low, -1, { coast: d.slope })
    else if (d.low === 0) d.water()
    else d.terrain()
}

function drawTrees(d: TileDraw): void {
    d.terrain()
    const count = rtTreeCount(d.payload)
    const name = rtTreeSpriteName(rtTreeType(d.payload), rtTreeStage(d.payload))
    for (let k = 0; k < count; k++) {
        const p = rtTreePoint(d.tile, k, count)
        d.onLand(name, p.x, p.y)
    }
}

function drawRail(d: TileDraw): void {
    const payload = d.payload
    if (rtIsCrossing(payload)) {
        const piece = (rtRailPieces(payload) & RT_TRACK_BITS.x) !== 0 ? RtTrack.x : RtTrack.y
        const closed = rtRailPieceReserved(payload, piece) || d.world.occupied.trainOnPiece(d.tile, piece)
        const surface = rtCrossingRoadOwner(payload) === RT_OWNER_NONE ? 'town' : 'grass'
        d.ground(rtCrossingSpriteName(surface, piece === RtTrack.x ? 'x' : 'y', closed), d.level())
        return
    }
    const pieces = rtRailPiecesFromBits(rtRailPieces(payload), RT_TRACK_BITS)
    if (d.slope !== 'flat' && pieces.length === 1 && d.lookup.has(`rail.slope.${d.slope}`)) {
        // one piece on land it fits: the sloped track sprite of that land
        d.ground(`rail.slope.${d.slope}`)
    } else {
        const at = d.level()
        for (const name of rtRailSpriteNames(pieces, 'flat')) d.ground(name, at)
    }
    drawSignals(d)
}

function drawSignals(d: TileDraw): void {
    for (const signal of rtTileSignals(d.map, d.tile)) {
        const both = signal.faces[0] && signal.faces[1]
        const kind = signal.type === RtSignalType.block ? 'block' : both ? 'path' : 'path-oneway'
        for (const half of [0, 1] as const) {
            if (!signal.faces[half]) continue
            const td = signal.piece + (half ? RT_TRACKDIR_REVERSE : 0)
            const facing = RT_SPRITE_DIRECTIONS[rtTrackdirDirection(td)]
            if (!facing) continue
            const p = rtSignalPoint(td)
            d.onLand(rtSignalSpriteName(kind, facing, signal.green[half]), p.x, p.y)
        }
    }
}

function drawRoad(d: TileDraw): void {
    const surface = d.map.owner[d.tile] === RT_OWNER_NONE ? 'town' : 'grass'
    const sides = rtRoadSidesFromBits(rtRoadBits(d.payload))
    const incline = RT_INCLINES.has(d.slope)
    const name = rtRoadSpriteName(surface, sides, incline ? d.slope : 'flat')
    if (!name) d.terrain()
    else if (incline) d.ground(name)
    else d.ground(name, d.level())
}

function drawHouse(d: TileDraw): void {
    const size = RT_HOUSE_SIZES[d.payload]
    if (!size) {
        d.terrain()
        return
    }
    const at = d.level()
    const count = Math.max(1, d.lookup.variantCount(`house.${size}`))
    d.part(rtHouseSpriteName(d.payload, rtTileHash(d.tile), count), at)
}

function drawIndustry(d: TileDraw): void {
    const map = d.map
    const industry = d.world.industry(d.payload)
    const type = industry ? RT_INDUSTRY_TYPE_IDS[industry.type] : undefined
    const entry = industry && type
        ? d.lookup.meta.industryLayouts[type]?.find(e => e[0] === d.x - map.tileX(industry.origin) && e[1] === d.y - map.tileY(industry.origin))
        : undefined
    if (!type || !entry) {
        d.terrain()
        return
    }
    d.part(rtIndustrySpriteName(type, entry[2]), d.level())
}

function drawStation(d: TileDraw): void {
    const colour = d.ownerColour()
    const at = d.level()
    const axis = rtStationAxis(d.payload) === RtAxis.y ? 'y' : 'x'
    if (rtStationTileType(d.payload) === RtStationTile.rail) {
        d.ground(rtRailSpriteNames([axis], 'flat')[0]!, at)
        const names = rtStationSpriteNames(axis, d.world.station(rtStationId(d.payload))?.sign === d.tile)
        d.part(names.rear, at, colour)
        d.part(names.front, at, colour)
    } else {
        drawRoadStop(d, at, colour, axis)
    }
}

/** A bay on its own ground by its entrance; a drive-through stop on its straight road under the ne or nw bay's shelters, so the two read apart. */
function drawRoadStop(d: TileDraw, at: number, colour: number, axis: 'x' | 'y'): void {
    const payload = d.payload
    const truck = rtStationTileType(payload) === RtStationTile.truck
    const bay = rtRoadStopIsBay(payload)
    const facing = bay ? RT_SIDE_NAMES[rtRoadStopFacing(payload)]! : axis === 'y' ? 'nw' : 'ne'
    const names = rtRoadStopSpriteNames(truck ? 'truck' : 'bus', facing)
    const road = bay ? null : rtRoadSpriteName(rtRoadStopRoadOwner(payload) === RT_OWNER_NONE ? 'town' : 'grass', rtRoadSidesFromBits(rtRoadStopBits(payload)), 'flat')
    if (road && d.lookup.has(road)) d.ground(road, at)
    else d.ground(names[0]!, at, colour)
    // a lorry bay's part b is the depot wall across its far end, which a road runs through here
    for (const name of names.slice(1)) if (bay || !truck || !name.endsWith('.b')) d.part(name, at, colour)
}

function drawDepot(d: TileDraw): void {
    const colour = d.ownerColour()
    const at = d.level()
    const names = rtDepotSpriteNames(rtDepotKind(d.payload) === RtVehicleKind.road ? 'road' : 'rail', RT_SIDE_NAMES[rtDepotFacing(d.payload)]!)
    d.ground(names[0]!, at, colour)
    for (const name of names.slice(1)) d.part(name, at, colour)
}

const TILE_RULES: Record<RtTileKind, (d: TileDraw) => void> = {
    [RtTileKind.clear]: d => d.terrain(),
    [RtTileKind.water]: d => d.water(),
    [RtTileKind.coast]: drawCoast,
    [RtTileKind.tree]: drawTrees,
    [RtTileKind.rail]: drawRail,
    [RtTileKind.road]: drawRoad,
    [RtTileKind.house]: drawHouse,
    [RtTileKind.industry]: drawIndustry,
    [RtTileKind.station]: drawStation,
    [RtTileKind.depot]: drawDepot
}

/**
 * The sprites tile `tile` draws, ground first in stacking order, at water frame `waterFrame`.
 * Pure: the same world and atlas give the same list.
 */
export function rtTileDrawList(world: RtDrawWorld, tile: number, lookup: RtSpriteLookup, waterFrame = 0): RtDrawItem[] {
    const d = new TileDraw(world, tile, lookup, waterFrame)
    const rule = TILE_RULES[world.map.kind[tile] as RtTileKind] ?? TILE_RULES[RtTileKind.clear]
    rule(d)
    return d.items
}
