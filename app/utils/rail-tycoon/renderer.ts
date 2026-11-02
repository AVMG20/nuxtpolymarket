// Rail Tycoon — renderer (W103).
//
// Draws the client's world with pixi.js v8 from the OpenGFX sprite atlas (W101) the way the original's
// viewport does: every ground sprite first (terrain, water, track, road, platform and depot floors),
// then everything that stands up (trees, houses, industries, station buildings, depots, signals and
// vehicles) sorted back to front, so a train passes behind a house in front of it and in front of a
// house behind it. Only tiles RtCamera can show are drawn, from pooled sprites, over a range grown by
// a margin so a pan rebuilds only when it leaves that margin; dirty tiles from RtLockstep are redrawn
// one by one.
//
// Over that, in screen pixels: station name signs in the owner's colour, parking spot markers (W150)
// and the income that rises and fades for 2 s where a vehicle is paid. The canvas renders at the
// device pixel ratio with a floor of 1 (never below native resolution on a standard screen), nearest
// sampling, no antialias, every position on a whole pixel.
//
// Everything above RtRenderer is pure and unit tested in test/rail-tycoon/renderer.spec.ts. pixi is
// imported lazily in RtRenderer.create, so importing this module never touches it.

import type { Application, Container, Graphics, GraphicsContext, Sprite, Text } from 'pixi.js'
import { RT_CATALOG, RT_INDUSTRY_TYPE_IDS, RT_VEHICLE_MODEL_IDS } from '#shared/utils/rail-tycoon/catalog'
import { rtDepotFacing, rtDepotKind } from '#shared/utils/rail-tycoon/depots'
import { RtTileKind, rtTreeCount, rtTreeStage, rtTreeType, type RtDir, type RtMap } from '#shared/utils/rail-tycoon/map'
import { rtRoadBits } from '#shared/utils/rail-tycoon/road'
import { rtIsSiding } from '#shared/utils/rail-tycoon/sidings'
import { RT_BAY_STOP } from '#shared/utils/rail-tycoon/road-vehicle'
import {
    RtAxis,
    RtStationTile,
    rtBayFacingAt,
    rtBaySlot,
    rtRoadStopBits,
    rtRoadStopFacing,
    rtRoadStopIsBay,
    rtRoadStopRoadOwner,
    rtStationAxis,
    rtStationId,
    rtStationTileType
} from '#shared/utils/rail-tycoon/stations-build'
import {
    RT_SIGNAL_ASPECT_SHIFT,
    RT_SIGNAL_PATH,
    RT_SIGNAL_PIECE_MASK,
    RT_SIGNAL_PRESENCE_SHIFT,
    RT_TRACK_COUNT,
    RT_TRACKDIR_REVERSE,
    RtTrack,
    rtCrossingRoadOwner,
    rtIsCrossing,
    rtRailPieceReserved,
    rtRailPieces,
    rtSignalSlot,
    rtTrackdirDirection,
    rtTrackdirEntryEdge,
    rtTrackdirExitDir,
    rtValidTrackdir
} from '#shared/utils/rail-tycoon/track'
import { rtPieceLength } from '#shared/utils/rail-tycoon/train'
import { RT_OWNER_NONE, RtVehicleKind, RtVehicleState, type RtCompany, type RtIndustry, type RtStation, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'
import { rtForEachTileInRange, rtTileCorners, rtTileToWorld, type RtCamera, type RtTileRange } from './camera'
import type { RtLockstep, RtPayment } from './lockstep'
import {
    RT_HOUSE_SIZES,
    RT_SIDE_NAMES,
    RT_SPRITE_DIRECTIONS,
    buildSpriteAtlas,
    rtCoastSpriteName,
    rtCompanyColour,
    rtCompanyRamp,
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
    rtSlopeNameFromBits,
    rtStationSpriteNames,
    rtTerrainSpriteName,
    rtTreeSpriteName,
    rtVehicleSpriteName,
    rtWaterFrameAt,
    rtWaterSpriteName,
    type RtSlopeName,
    type RtSpriteAtlas,
    type RtSpriteFrame,
    type RtTrackBitTable
} from './sprites'
import type { RtToolPreview } from './tools'

/* ------------------------------------------------------------------------------------------
 * Resolution, ranges and depth
 * ---------------------------------------------------------------------------------------- */

/**
 * Canvas resolution for a device pixel ratio and zoom: at least the ratio and never below 1 (the
 * house rule for dpr 1 screens), raised until a world pixel covers a whole number of canvas pixels.
 * Sprites sit on whole world pixels, so they then share one sub-pixel offset and round alike: at
 * 0.5x on a dpr 1 screen, or at a fractional ratio, a half-pixel position otherwise rounds one tile
 * left and its neighbour right, which shows as seams that shimmer while panning. The browser scales
 * the larger canvas down.
 */
export function rtRenderResolution(dpr: number | undefined, zoom: number = 1): number {
    const base = Math.max(1, Number.isFinite(dpr) && dpr! > 0 ? dpr! : 1)
    // the epsilon keeps 2 * 0.5 from rounding up to the next step
    return Math.ceil(base * zoom - 1e-9) / zoom
}

/** Rows and columns drawn beyond the visible range, so a pan rebuilds only when it leaves them. */
export const RT_RENDER_MARGIN = 8
/** A drawn range more than this many times the needed one (after zooming in) is rebuilt smaller. */
export const RT_RENDER_SHRINK = 2.5

export function rtTileInRange(range: RtTileRange, x: number, y: number): boolean {
    const s = x + y
    const d = y - x
    return s >= range.sMin && s <= range.sMax && d >= range.dMin && d <= range.dMax
}

export function rtRangeContains(outer: RtTileRange, inner: RtTileRange): boolean {
    return inner.sMin >= outer.sMin && inner.sMax <= outer.sMax && inner.dMin >= outer.dMin && inner.dMax <= outer.dMax
}

export function rtGrowRange(range: RtTileRange, margin: number): RtTileRange {
    return { sMin: range.sMin - margin, sMax: range.sMax + margin, dMin: range.dMin - margin, dMax: range.dMax + margin }
}

/** Tiles a range covers, map edges ignored (half the s by d cells hold a tile). */
export function rtRangeArea(range: RtTileRange): number {
    return Math.max(0, range.sMax - range.sMin + 1) * Math.max(0, range.dMax - range.dMin + 1) / 2
}

/** Ground sprites a tile may stack (foundation, ground, track overlays); the ground sort key leaves room for them. */
export const RT_GROUND_SUBLAYERS = 16

/** Sort key of a tile's sub-th ground sprite: back rows first, then the tile's own stacking order. */
export function rtGroundDepth(x: number, y: number, sub: number): number {
    return (x + y) * RT_GROUND_SUBLAYERS + Math.min(sub, RT_GROUND_SUBLAYERS - 1)
}

/**
 * Sort key of something standing at (lx, ly) inside tile (x, y), 0 to 1 each: within (x + y + 0.6,
 * x + y + 1.4), so anything of a tile row sorts after the row behind it and before the row in front.
 */
export function rtObjectDepth(x: number, y: number, lx: number, ly: number): number {
    return x + y + 0.6 + 0.4 * (Math.min(1, Math.max(0, lx)) + Math.min(1, Math.max(0, ly)))
}

/** Station, depot and road stop parts: rear before any vehicle on the tile, front after it. */
export function rtPartDepth(x: number, y: number, layer: 'rear' | 'front' | null): number {
    if (layer === 'rear') return x + y + 0.55
    if (layer === 'front') return x + y + 1.45
    return x + y + 1
}

/** A cheap integer hash of a tile index, for cosmetic choices (house variants, tree spots); never for outcomes. */
export function rtTileHash(tile: number): number {
    let h = Math.imul((tile ^ 0x9e3779b9) >>> 0, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
    return h >>> 0
}

/**
 * Height (levels, fractional) of the land at (lx, ly) inside a tile with corner heights [n, w, e, s].
 * The surface is two triangles split along the north-south diagonal, as RtCamera picks it.
 */
export function rtSurfaceHeight(corners: readonly [number, number, number, number], lx: number, ly: number): number {
    const [n, w, e, s] = corners
    if (lx >= ly) return n + (w - n) * lx + (s - w) * ly
    return n + (s - e) * lx + (e - n) * ly
}

/** The ramps: two adjacent corners raised, which road and a straight track climb without a foundation. */
const INCLINES: ReadonlySet<RtSlopeName> = new Set<RtSlopeName>(['ne', 'se', 'sw', 'nw'])

const SLOPE_NAMES = new Map<number, RtSlopeName>()

/** rtSlopeNameFromBits, remembered per value: a full redraw asks it for thousands of tiles. */
function slopeName(bits: number): RtSlopeName {
    let name = SLOPE_NAMES.get(bits)
    if (name === undefined) SLOPE_NAMES.set(bits, name = rtSlopeNameFromBits(bits))
    return name
}

/**
 * Height a vehicle or signal stands at on a tile: the land itself where the tile is drawn sloped
 * (rail, whose pieces always fit the land, and road on a ramp), else the level of its foundation.
 */
export function rtStandHeight(map: RtMap, tile: number, lx: number, ly: number): number {
    const x = map.tileX(tile)
    const y = map.tileY(tile)
    const slope = slopeName(map.tileSlope(tile))
    if (slope === 'flat') return map.tileHeight(tile)
    const kind = map.kind[tile]
    if (kind === RtTileKind.rail || (kind === RtTileKind.road && INCLINES.has(slope))) {
        return rtSurfaceHeight(rtTileCorners(map, x, y), lx, ly)
    }
    return map.tileMaxHeight(tile)
}

/* ------------------------------------------------------------------------------------------
 * Tile geometry
 * ---------------------------------------------------------------------------------------- */

/** Midpoint of each tile edge (RtDir order ne, se, sw, nw) in tile-local coordinates. */
const EDGE_MID: readonly (readonly [number, number])[] = [[0, 0.5], [0.5, 1], [1, 0.5], [0.5, 0]]

/** The rail piece bits of goal 03 (RtTrack) as the atlas names them. */
export const RT_TRACK_BITS: RtTrackBitTable = {
    x: 1 << RtTrack.x,
    y: 1 << RtTrack.y,
    n: 1 << RtTrack.upper,
    s: 1 << RtTrack.lower,
    w: 1 << RtTrack.left,
    e: 1 << RtTrack.right
}

/** How far along its piece, from the entry edge, a signal stands (where a train it holds stops). */
export const RT_SIGNAL_ALONG = 0.3
/** How far beside the track (tile widths) a signal stands, on the right of the trains it governs. */
export const RT_SIGNAL_SIDE = 0.3
/** How far right of the road's centre line a road vehicle drives (tile widths). */
export const RT_ROAD_LANE_OFFSET = 0.18

function clampUnit(v: number): number {
    return Math.min(0.97, Math.max(0.03, v))
}

/**
 * Where in its tile the signal for trackdir td stands (tile-local, 0 to 1). Right of the travel
 * direction (vx, vy) in tile space is (vy, -vx): the projection mirrors, so this is right on screen.
 */
export function rtSignalPoint(td: number): { x: number, y: number } {
    const a = EDGE_MID[rtTrackdirEntryEdge(td) & 3]!
    const b = EDGE_MID[rtTrackdirExitDir(td) & 3]!
    const vx = b[0] - a[0]
    const vy = b[1] - a[1]
    const len = Math.hypot(vx, vy) || 1
    return {
        x: clampUnit(a[0] + vx * RT_SIGNAL_ALONG + (vy / len) * RT_SIGNAL_SIDE),
        y: clampUnit(a[1] + vy * RT_SIGNAL_ALONG - (vx / len) * RT_SIGNAL_SIDE)
    }
}

/** Where tree k of count stands in a tile (tile-local): one per quadrant, rotated and nudged by the tile hash. */
export function rtTreePoint(tile: number, k: number, count: number): { x: number, y: number } {
    const hash = rtTileHash(tile)
    if (count <= 1) return { x: 0.5 + (((hash >>> 4) & 7) - 3.5) / 40, y: 0.5 + (((hash >>> 7) & 7) - 3.5) / 40 }
    const slot = (k + (hash & 3)) & 3
    const jx = (((hash >>> (8 + k * 6)) & 7) - 3.5) / 48
    const jy = (((hash >>> (11 + k * 6)) & 7) - 3.5) / 48
    return { x: (slot & 1 ? 0.72 : 0.28) + jx, y: (slot & 2 ? 0.72 : 0.28) + jy }
}

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

/** Whether a tile is the dead-end tile of a parking spot (W150), which gets a marker. */
export function rtIsParkingSpot(map: RtMap, tile: number): boolean {
    return map.kind[tile] === RtTileKind.rail && rtIsSiding(map.payload[tile]!)
}

/**
 * The sprites tile `tile` draws, ground first in stacking order, at water frame `waterFrame`.
 * Pure: the same world and atlas give the same list.
 */
export function rtTileDrawList(world: RtDrawWorld, tile: number, lookup: RtSpriteLookup, waterFrame = 0): RtDrawItem[] {
    const map = world.map
    const x = map.tileX(tile)
    const y = map.tileY(tile)
    const payload = map.payload[tile]!
    const slope = slopeName(map.tileSlope(tile))
    const low = map.tileHeight(tile)
    const high = map.tileMaxHeight(tile)
    const items: RtDrawItem[] = []
    let sub = 0

    const anchor = (height: number) => rtTileToWorld(x, y, height)
    const ground = (name: string, height = low, colour = -1, water?: { coast: RtSlopeName | null }) => {
        const at = anchor(height)
        const item: RtDrawItem = { name, colour, ground: true, wx: at.x, wy: at.y, z: rtGroundDepth(x, y, sub++) }
        if (water) item.water = water
        items.push(item)
    }
    const part = (name: string, height: number, colour = -1) => {
        const at = anchor(height)
        items.push({ name, colour, ground: false, wx: at.x, wy: at.y, z: rtPartDepth(x, y, lookup.get(name).layer) })
    }
    const standing = (name: string, lx: number, ly: number, height: number, colour = -1) => {
        const at = rtTileToWorld(x + lx, y + ly, height)
        items.push({ name, colour, ground: false, wx: Math.round(at.x), wy: Math.round(at.y), z: rtObjectDepth(x, y, lx, ly) })
    }
    const terrain = () => ground(rtTerrainSpriteName('grass', slope))
    /** The level buildings and flat track stand on: the land when flat, else on a foundation at the top corner. */
    const level = (): number => {
        if (slope === 'flat') return low
        ground(rtFoundationSpriteName(slope) ?? rtTerrainSpriteName('grass', slope))
        return high
    }
    const water = () => ground(rtWaterSpriteName(waterFrame), low, -1, { coast: null })
    const colourOf = (owner: number) => world.company(owner)?.colour ?? -1

    switch (map.kind[tile]) {
        case RtTileKind.water:
            water()
            break
        case RtTileKind.coast:
            if (slope !== 'flat') ground(rtCoastSpriteName(slope, waterFrame), low, -1, { coast: slope })
            else if (low === 0) water()
            else terrain()
            break
        case RtTileKind.tree: {
            terrain()
            const count = rtTreeCount(payload)
            const name = rtTreeSpriteName(rtTreeType(payload), rtTreeStage(payload))
            const corners = rtTileCorners(map, x, y)
            for (let k = 0; k < count; k++) {
                const p = rtTreePoint(tile, k, count)
                standing(name, p.x, p.y, rtSurfaceHeight(corners, p.x, p.y))
            }
            break
        }
        case RtTileKind.rail:
            railTile()
            break
        case RtTileKind.road: {
            const surface = map.owner[tile] === RT_OWNER_NONE ? 'town' : 'grass'
            const sides = rtRoadSidesFromBits(rtRoadBits(payload))
            const name = rtRoadSpriteName(surface, sides, INCLINES.has(slope) ? slope : 'flat')
            if (!name) terrain()
            else if (INCLINES.has(slope)) ground(name)
            else ground(name, level())
            break
        }
        case RtTileKind.house: {
            const size = RT_HOUSE_SIZES[payload]
            if (!size) {
                terrain()
                break
            }
            const at = level()
            const count = Math.max(1, lookup.variantCount(`house.${size}`))
            part(rtHouseSpriteName(payload, rtTileHash(tile), count), at)
            break
        }
        case RtTileKind.industry: {
            const industry = world.industry(payload)
            const type = industry ? RT_INDUSTRY_TYPE_IDS[industry.type] : undefined
            const entry = industry && type
                ? lookup.meta.industryLayouts[type]?.find(e => e[0] === x - map.tileX(industry.origin) && e[1] === y - map.tileY(industry.origin))
                : undefined
            if (!type || !entry) {
                terrain()
                break
            }
            part(rtIndustrySpriteName(type, entry[2]), level())
            break
        }
        case RtTileKind.station: {
            const colour = colourOf(map.owner[tile]!)
            const at = level()
            const type = rtStationTileType(payload)
            const axis = rtStationAxis(payload) === RtAxis.y ? 'y' : 'x'
            if (type === RtStationTile.rail) {
                ground(rtRailSpriteNames([axis], 'flat')[0]!, at)
                const building = world.station(rtStationId(payload))?.sign === tile
                const names = rtStationSpriteNames(axis, building)
                part(names.rear, at, colour)
                part(names.front, at, colour)
            } else {
                // a bay on its own ground by its entrance; a drive-through stop on its straight road
                // under the ne or nw bay's shelters, so the two read apart
                const bay = rtRoadStopIsBay(payload)
                const facing = bay ? RT_SIDE_NAMES[rtRoadStopFacing(payload)]! : axis === 'y' ? 'nw' : 'ne'
                const names = rtRoadStopSpriteNames(type === RtStationTile.bus ? 'bus' : 'truck', facing)
                const road = bay ? null : rtRoadSpriteName(rtRoadStopRoadOwner(payload) === RT_OWNER_NONE ? 'town' : 'grass', rtRoadSidesFromBits(rtRoadStopBits(payload)), 'flat')
                if (road && lookup.has(road)) ground(road, at)
                else ground(names[0]!, at, colour)
                // a lorry bay's part b is the depot wall across its far end, which a road runs through here
                for (const name of names.slice(1)) if (bay || type !== RtStationTile.truck || !name.endsWith('.b')) part(name, at, colour)
            }
            break
        }
        case RtTileKind.depot: {
            const colour = colourOf(map.owner[tile]!)
            const at = level()
            const names = rtDepotSpriteNames(rtDepotKind(payload) === RtVehicleKind.road ? 'road' : 'rail', RT_SIDE_NAMES[rtDepotFacing(payload)]!)
            ground(names[0]!, at, colour)
            for (const name of names.slice(1)) part(name, at, colour)
            break
        }
        default:
            terrain()
    }
    return items

    function railTile(): void {
        if (rtIsCrossing(payload)) {
            const piece = (rtRailPieces(payload) & RT_TRACK_BITS.x) !== 0 ? RtTrack.x : RtTrack.y
            const closed = rtRailPieceReserved(payload, piece) || world.occupied.trainOnPiece(tile, piece)
            const surface = rtCrossingRoadOwner(payload) === RT_OWNER_NONE ? 'town' : 'grass'
            ground(rtCrossingSpriteName(surface, piece === RtTrack.x ? 'x' : 'y', closed), level())
            return
        }
        const pieces = rtRailPiecesFromBits(rtRailPieces(payload), RT_TRACK_BITS)
        if (slope !== 'flat' && pieces.length === 1 && lookup.has(`rail.slope.${slope}`)) {
            // one piece on land it fits: the sloped track sprite of that land
            ground(`rail.slope.${slope}`)
        } else {
            const at = level()
            for (const name of rtRailSpriteNames(pieces, 'flat')) ground(name, at)
        }
        railSignals()
    }

    function railSignals(): void {
        const corners = rtTileCorners(map, x, y)
        for (let k = 0; k < 2; k++) {
            const slot = rtSignalSlot(payload, k)
            const piece = slot & RT_SIGNAL_PIECE_MASK
            if (piece >= RT_TRACK_COUNT) continue
            const both = ((slot >>> RT_SIGNAL_PRESENCE_SHIFT) & 3) === 3
            for (let half = 0; half < 2; half++) {
                if (((slot >>> (RT_SIGNAL_PRESENCE_SHIFT + half)) & 1) === 0) continue
                const td = piece + (half ? RT_TRACKDIR_REVERSE : 0)
                const kind = (slot & RT_SIGNAL_PATH) === 0 ? 'block' : both ? 'path' : 'path-oneway'
                const green = ((slot >>> (RT_SIGNAL_ASPECT_SHIFT + half)) & 1) !== 0
                const facing = RT_SPRITE_DIRECTIONS[rtTrackdirDirection(td)]
                if (!facing) continue
                const p = rtSignalPoint(td)
                standing(rtSignalSpriteName(kind, facing, green), p.x, p.y, rtSurfaceHeight(corners, p.x, p.y))
            }
        }
    }
}

/* ------------------------------------------------------------------------------------------
 * Vehicles
 * ---------------------------------------------------------------------------------------- */

/** One drawn engine, wagon or road vehicle: where in which tile it stands and which way it faces. */
export interface RtVehiclePart {
    /** Index in the consist, engine first. */
    index: number
    /** Model index (RT_VEHICLE_MODEL_IDS). */
    model: number
    tile: number
    /** Tile-local position, 0 to 1. */
    lx: number
    ly: number
    /** Height level (fractional) it stands at. */
    height: number
    /** Facing, an index into RT_SPRITE_DIRECTIONS. */
    direction: number
}

/** Progress units one engine or wagon covers along the track. */
export const RT_PART_UNITS = RT_CATALOG.movement.subTileUnits / 2 * RT_CATALOG.vehicles.halfTilesPerVehicle

/**
 * Where each part of a vehicle stands, derived from its tiles, pieces and progress only. A train's
 * part k is centred (k + 0.5) parts behind the head's front, walked back through the tiles it holds;
 * a road vehicle stands at its progress through its head tile, in the right-hand lane.
 */
export function rtVehicleParts(map: RtMap, vehicle: RtVehicle): RtVehiclePart[] {
    const parts: RtVehiclePart[] = []
    const { tiles, pieces } = vehicle
    if (tiles.length === 0 || tiles.length !== pieces.length || !map.validTile(tiles[0]!)) return parts
    if (vehicle.kind === RtVehicleKind.road) {
        const bay = rtBayPart(map, vehicle)
        if (bay) return [bay]
        const dir = pieces[0]! & 3
        const a = EDGE_MID[(dir + 2) & 3]!
        const b = EDGE_MID[dir]!
        const f = Math.min(1, Math.max(0, vehicle.progress / RT_CATALOG.movement.subTileUnits))
        const vx = b[0] - a[0]
        const vy = b[1] - a[1]
        const lx = a[0] + vx * f + vy * RT_ROAD_LANE_OFFSET
        const ly = a[1] + vy * f - vx * RT_ROAD_LANE_OFFSET
        parts.push({ index: 0, model: vehicle.consist[0] ?? vehicle.model, tile: tiles[0]!, lx, ly, height: rtStandHeight(map, tiles[0]!, lx, ly), direction: 1 + 2 * dir })
        return parts
    }
    for (let k = 0; k < vehicle.consist.length; k++) {
        let behind = (k + 0.5) * RT_PART_UNITS
        let i = 0
        let avail = Math.min(Math.max(vehicle.progress, 0), rtValidTrackdir(pieces[0]!) ? rtPieceLength(pieces[0]!) : 0)
        while (behind > avail && i + 1 < tiles.length) {
            behind -= avail
            i++
            avail = rtValidTrackdir(pieces[i]!) ? rtPieceLength(pieces[i]!) : 0
        }
        const td = pieces[i]!
        const tile = tiles[i]!
        if (!rtValidTrackdir(td) || !map.validTile(tile)) continue
        const f = Math.max(0, avail - behind) / rtPieceLength(td)
        const a = EDGE_MID[rtTrackdirEntryEdge(td)]!
        const b = EDGE_MID[rtTrackdirExitDir(td)]!
        const lx = a[0] + (b[0] - a[0]) * f
        const ly = a[1] + (b[1] - a[1]) * f
        parts.push({ index: k, model: vehicle.consist[k]!, tile, lx, ly, height: rtStandHeight(map, tile, lx, ly), direction: rtTrackdirDirection(td) })
    }
    return parts
}

/** How deep into a bay (tile widths from the entrance) a vehicle halts to load. */
export const RT_BAY_DEPTH = 0.62

/**
 * Where a road vehicle whose head stands in a bay stop is drawn, or null when it is not in one. Its
 * bay's lane names the side of the tile the bay lies on (rtBayLane); its progress runs in to
 * RT_BAY_STOP, the halt at RT_BAY_DEPTH, and back out to the entrance, facing in on the way in and
 * out on the way out, so it turns round where it loaded.
 */
export function rtBayPart(map: RtMap, vehicle: RtVehicle): RtVehiclePart | null {
    const tile = vehicle.tiles[0]!
    const facing = rtBayFacingAt(map, tile)
    if (facing < 0) return null
    const slot = rtBaySlot(facing as RtDir, vehicle.pieces[0]!)
    const entry = EDGE_MID[facing]!
    const back = EDGE_MID[(facing + 2) & 3]!
    const progress = Math.min(Math.max(vehicle.progress, 0), RT_CATALOG.movement.subTileUnits)
    const inbound = progress <= RT_BAY_STOP
    const depth = RT_BAY_DEPTH * (inbound ? progress : RT_CATALOG.movement.subTileUnits - progress) / RT_BAY_STOP
    // across the tile towards its bay's side; a lane that is no bay (a hostile save) keeps to the middle
    const side = EDGE_MID[vehicle.pieces[0]! & 3]!
    const sx = slot < 0 ? 0 : (side[0] - 0.5) * 2 * RT_ROAD_LANE_OFFSET
    const sy = slot < 0 ? 0 : (side[1] - 0.5) * 2 * RT_ROAD_LANE_OFFSET
    const lx = entry[0] + (back[0] - entry[0]) * depth + sx
    const ly = entry[1] + (back[1] - entry[1]) * depth + sy
    const heading = inbound ? (facing + 2) & 3 : facing
    return {
        index: 0,
        model: vehicle.consist[0] ?? vehicle.model,
        tile,
        lx,
        ly,
        height: rtStandHeight(map, tile, lx, ly),
        direction: 1 + 2 * heading
    }
}

/** A vehicle window badge (W150): parked in a spot, or stopped and still travelling to find one. */
export type RtVehicleBadge = 'parked' | 'parking'

export function rtVehicleBadge(vehicle: RtVehicle): RtVehicleBadge | null {
    if (vehicle.kind !== RtVehicleKind.rail) return null
    if (vehicle.state === RtVehicleState.parked) return 'parked'
    if (vehicle.state === RtVehicleState.parking) return 'parking'
    if (vehicle.stopped && vehicle.state === RtVehicleState.driving) return 'parking'
    return null
}

/* ------------------------------------------------------------------------------------------
 * Income floats
 * ---------------------------------------------------------------------------------------- */

/** How long income text shows, rising and fading (ms). */
export const RT_FLOAT_MS = 2000
/** How far it rises over that time (CSS pixels). */
export const RT_FLOAT_RISE = 24
/** It stays opaque for this long, then fades out over the rest. */
export const RT_FLOAT_HOLD_MS = 1000
/** Most floats on screen at once; the oldest goes first. */
export const RT_FLOAT_MAX = 64

export interface RtFloat {
    tile: number
    amount: number
    company: number
    /** Time it appeared (ms, the renderer's clock). */
    born: number
}

/** Rise (CSS pixels) and opacity of a float `age` ms old, or null once it is gone. */
export function rtFloatLook(age: number): { rise: number, alpha: number } | null {
    if (age < 0 || age >= RT_FLOAT_MS) return age < 0 ? { rise: 0, alpha: 1 } : null
    const alpha = age <= RT_FLOAT_HOLD_MS ? 1 : 1 - (age - RT_FLOAT_HOLD_MS) / (RT_FLOAT_MS - RT_FLOAT_HOLD_MS)
    return { rise: (age / RT_FLOAT_MS) * RT_FLOAT_RISE, alpha }
}

/** Income text as the original shows it: the amount paid, in pounds. */
export function rtFormatIncome(amount: number): string {
    return `+£${Math.round(amount).toLocaleString('en-GB')}`
}

/** The income floats alive at a time; the renderer draws them. */
export class RtFloatTexts {
    readonly items: RtFloat[] = []

    add(payment: RtPayment, now: number): RtFloat | null {
        if (!(payment.amount > 0) || payment.tile < 0) return null
        const float: RtFloat = { tile: payment.tile, amount: payment.amount, company: payment.company, born: now }
        this.items.push(float)
        if (this.items.length > RT_FLOAT_MAX) this.items.shift()
        return float
    }

    /** Drops the floats that are gone at `now` and returns them. */
    prune(now: number): RtFloat[] {
        const gone: RtFloat[] = []
        let keep = 0
        for (const float of this.items) {
            if (rtFloatLook(now - float.born)) this.items[keep++] = float
            else gone.push(float)
        }
        this.items.length = keep
        return gone
    }

    clear(): void {
        this.items.length = 0
    }
}

/* ------------------------------------------------------------------------------------------
 * RtRenderer
 * ---------------------------------------------------------------------------------------- */

type Pixi = typeof import('pixi.js')

export const RT_RENDERER_BACKGROUND = 0x000000
/** Sign and float text, in CSS pixels. */
const SIGN_FONT = { fontFamily: 'Verdana, Tahoma, sans-serif', fontSize: 10, fontWeight: 'bold' as const, fill: 0xffffff }
const FLOAT_FONT = { ...SIGN_FONT, fontSize: 11, fill: 0xffd84a, stroke: { color: 0x1a1200, width: 3, join: 'round' as const } }
/** World pixels a station sign floats above its tile's centre. */
const SIGN_LIFT = 26
/** World pixels a float starts above its tile's centre. */
const FLOAT_LIFT = 14
/** Parking marker: a 9 by 9 sign, drawn at a whole multiple of its pixels. */
const MARKER_SIZE = 9
const MARKER_BLUE = 0x1f4fbf
const PREVIEW = {
    tile: 0xffffff,
    refused: 0xffa531,
    blocked: 0xff3030,
    catchment: 0x3aa0ff
}
/** Thin preview outlines stay at least this wide on screen (CSS pixels), whatever the zoom. */
const PREVIEW_LINE = 1.5

class SpritePool {
    private readonly free: Sprite[] = []

    constructor(private readonly pixi: Pixi, readonly parent: Container) {}

    take(frame: RtSpriteFrame, wx: number, wy: number, z: number): Sprite {
        let sprite = this.free.pop()
        if (sprite) {
            sprite.visible = true
        } else {
            sprite = new this.pixi.Sprite()
            this.parent.addChild(sprite)
        }
        sprite.texture = frame.texture
        sprite.position.set(wx + frame.ox, wy + frame.oy)
        sprite.zIndex = z
        return sprite
    }

    give(sprite: Sprite): void {
        sprite.visible = false
        sprite.tint = 0xffffff
        this.free.push(sprite)
    }
}

interface TileSprites {
    ground: Sprite[]
    objects: Sprite[]
    water: { sprite: Sprite, wx: number, wy: number, coast: RtSlopeName | null }[]
}

interface Sign {
    view: Container
    back: Graphics
    text: Text
    key: string
    tile: number
}

export interface RtRendererOptions {
    /** The camera the tools pick with; the renderer resizes it with the element. */
    camera: RtCamera
    /** Where the OpenGFX atlas is served from (sprites.ts RT_ATLAS_BASE_URL by default). */
    atlasUrl?: string
    background?: number
    /** Aborting while create() loads makes it clean up and resolve null (an unmounted view). */
    signal?: AbortSignal
}

export class RtRenderer {
    readonly camera: RtCamera
    readonly atlas: RtSpriteAtlas
    readonly floats = new RtFloatTexts()

    private readonly pixi: Pixi
    private readonly app: Application
    private readonly element: HTMLElement
    private readonly worldLayer: Container
    private readonly groundLayer: Container
    private readonly objectLayer: Container
    private readonly previewLayer: Graphics
    private readonly markerLayer: Container
    private readonly signLayer: Container
    private readonly floatLayer: Container
    private readonly groundPool: SpritePool
    private readonly objectPool: SpritePool
    private readonly markerContext: GraphicsContext
    private readonly observer: ResizeObserver | null

    private lockstep: RtLockstep | null = null
    private unsubscribe: (() => void)[] = []
    private readonly tiles = new Map<number, TileSprites>()
    private readonly waterTiles = new Set<TileSprites>()
    private readonly dirty = new Set<number>()
    private readonly sidings = new Set<number>()
    private readonly markers: Graphics[] = []
    private readonly signs = new Map<number, Sign>()
    private readonly floatViews = new Map<RtFloat, Text>()
    private readonly freeFloatViews: Text[] = []
    private vehicleSprites: Sprite[] = []
    private preview: RtToolPreview | null = null

    private drawn: RtTileRange | null = null
    private needsFull = true
    private cameraVersion = -1
    private previewZoom = -1
    private drawnTick = -1
    private vehiclesDirty = true
    private overlayDirty = true
    private waterFrame = 0
    private width = 0
    private height = 0
    private resolution = 1
    private raf = 0
    private destroyed = false
    private readonly onWindowResize = () => this.resize()

    private constructor(pixi: Pixi, app: Application, atlas: RtSpriteAtlas, element: HTMLElement, camera: RtCamera) {
        this.pixi = pixi
        this.app = app
        this.atlas = atlas
        this.element = element
        this.camera = camera
        this.resolution = app.renderer.resolution

        const stage = app.stage
        // the tools read pointer events off the element; pixi never hit-tests this many sprites
        stage.eventMode = 'none'
        stage.interactiveChildren = false
        this.worldLayer = new pixi.Container({ isRenderGroup: true })
        this.groundLayer = new pixi.Container({ sortableChildren: true })
        this.previewLayer = new pixi.Graphics()
        this.objectLayer = new pixi.Container({ sortableChildren: true })
        this.worldLayer.addChild(this.groundLayer, this.previewLayer, this.objectLayer)
        this.markerLayer = new pixi.Container()
        this.signLayer = new pixi.Container()
        this.floatLayer = new pixi.Container()
        stage.addChild(this.worldLayer, this.markerLayer, this.signLayer, this.floatLayer)
        this.groundPool = new SpritePool(pixi, this.groundLayer)
        this.objectPool = new SpritePool(pixi, this.objectLayer)
        this.markerContext = buildMarkerContext(pixi)

        const canvas = app.canvas
        canvas.style.display = 'block'
        canvas.style.imageRendering = 'pixelated'
        element.appendChild(canvas)
        this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize())
        this.observer?.observe(element)
        // a window moved to a screen with another pixel ratio fires resize without changing the element's size
        window.addEventListener('resize', this.onWindowResize)
        this.resize()
    }

    /**
     * Creates the pixi Application on `element` (its canvas fills it) and loads the sprite atlas.
     * Resolves null when options.signal aborted meanwhile.
     */
    static async create(element: HTMLElement, options: RtRendererOptions): Promise<RtRenderer | null> {
        const pixi = await import('pixi.js')
        if (options.signal?.aborted) return null
        const app = new pixi.Application()
        await app.init({
            width: Math.max(1, element.clientWidth),
            height: Math.max(1, element.clientHeight),
            resolution: rtRenderResolution(window.devicePixelRatio, options.camera.zoom),
            autoDensity: true,
            antialias: false,
            roundPixels: true,
            background: options.background ?? RT_RENDERER_BACKGROUND,
            preference: 'webgl',
            autoStart: false,
            sharedTicker: false
        })
        if (options.signal?.aborted) {
            app.destroy(true)
            return null
        }
        let atlas: RtSpriteAtlas
        try {
            atlas = await buildSpriteAtlas(app.renderer, options.atlasUrl)
        } catch (error) {
            app.destroy(true)
            throw error
        }
        if (options.signal?.aborted) {
            atlas.destroy()
            app.destroy(true)
            return null
        }
        return new RtRenderer(pixi, app, atlas, element, options.camera)
    }

    /** The canvas the renderer draws into (inside the element). */
    get canvas(): HTMLCanvasElement {
        return this.app.canvas
    }

    /**
     * Draws this lockstep's world from now on (null: nothing). Call it again with the new lockstep
     * after a resync, since that replaces the world.
     */
    setLockstep(lockstep: RtLockstep | null): void {
        for (const off of this.unsubscribe) off()
        this.unsubscribe = []
        this.releaseAllTiles()
        this.releaseVehicles()
        this.floats.clear()
        for (const view of this.floatViews.values()) this.releaseFloatView(view)
        this.floatViews.clear()
        for (const sign of this.signs.values()) sign.view.destroy({ children: true })
        this.signs.clear()
        for (const marker of this.markers) marker.visible = false
        this.previewLayer.clear()
        this.dirty.clear()
        this.lockstep = lockstep
        this.needsFull = true
        this.vehiclesDirty = true
        this.overlayDirty = true
        this.previewZoom = -1
        if (!lockstep) return
        this.camera.setMapSide(lockstep.world.map.side)
        this.unsubscribe.push(
            lockstep.on('dirty', (tiles) => {
                for (const tile of tiles) this.dirty.add(tile)
            }),
            lockstep.on('payment', (payment) => {
                this.floats.add(payment, performance.now())
            }),
            lockstep.on('vehicles', () => {
                this.vehiclesDirty = true
            })
        )
    }

    /**
     * Shows a build tool's preview (RtTools 'preview' event): the covered tiles tinted, blocked ones
     * red, and a station's catchment highlighted. null clears it.
     */
    drawPreview(preview: RtToolPreview | null): void {
        this.preview = preview
        this.previewZoom = -1
    }

    /** Follows the element's size and the window's pixel ratio; called by itself on resize. */
    resize(): void {
        if (this.destroyed) return
        const width = Math.max(1, Math.floor(this.element.clientWidth))
        const height = Math.max(1, Math.floor(this.element.clientHeight))
        const dpr = window.devicePixelRatio || 1
        const resolution = rtRenderResolution(dpr, this.camera.zoom)
        if (width === this.width && height === this.height && resolution === this.resolution && this.camera.width === width) return
        this.width = width
        this.height = height
        this.app.renderer.resize(width, height, resolution)
        this.camera.resize(width, height, dpr)
        if (resolution !== this.resolution) {
            this.resolution = resolution
            for (const sign of this.signs.values()) sign.text.resolution = resolution
            for (const view of this.floatViews.values()) view.resolution = resolution
            for (const view of this.freeFloatViews) view.resolution = resolution
        }
        this.overlayDirty = true
    }

    /**
     * Runs a frame loop: `beforeRender` (the view steps the lockstep and scrolls the camera there),
     * then render. stop() ends it.
     */
    start(beforeRender?: (now: number) => void): void {
        if (this.raf !== 0 || this.destroyed) return
        const loop = (now: number) => {
            this.raf = requestAnimationFrame(loop)
            beforeRender?.(now)
            this.render(now)
        }
        this.raf = requestAnimationFrame(loop)
    }

    stop(): void {
        if (this.raf !== 0) cancelAnimationFrame(this.raf)
        this.raf = 0
    }

    /** One frame: brings the sprites up to the camera and the world, then draws. */
    render(now: number = performance.now()): void {
        if (this.destroyed) return
        const camera = this.camera
        const moved = camera.version !== this.cameraVersion
        if (moved) {
            // a zoom step can need another canvas resolution
            if (rtRenderResolution(window.devicePixelRatio || 1, camera.zoom) !== this.resolution) this.resize()
            this.cameraVersion = camera.version
            this.worldLayer.position.set(camera.originX, camera.originY)
            this.worldLayer.scale.set(camera.zoom)
            this.overlayDirty = true
        }
        const lockstep = this.lockstep
        if (lockstep) {
            const world = lockstep.world
            const rebuilt = (moved || this.needsFull) && this.updateRange(world)
            if (this.dirty.size > 0) this.redrawDirty(world)
            this.animateWater(now)
            if (rebuilt || this.vehiclesDirty || world.tick !== this.drawnTick) {
                this.drawVehicles(world)
                this.overlayDirty = true
            }
            if (this.overlayDirty) {
                this.drawMarkers(world.map)
                this.drawSigns(world)
                this.overlayDirty = false
            }
            this.drawFloats(world.map, now)
            if (this.previewZoom !== camera.zoom) this.drawPreviewNow(world.map)
        }
        this.app.render()
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.stop()
        for (const off of this.unsubscribe) off()
        this.unsubscribe = []
        this.observer?.disconnect()
        window.removeEventListener('resize', this.onWindowResize)
        this.lockstep = null
        this.tiles.clear()
        this.waterTiles.clear()
        this.signs.clear()
        this.floatViews.clear()
        // sprites, texts and graphics first, then the textures the atlas owns while the renderer can
        // still free them on the GPU, then the renderer and its canvas
        this.app.stage.destroy({ children: true })
        this.markerContext.destroy()
        this.atlas.destroy()
        this.app.destroy(true)
    }

    /* ---------------- tiles ---------------- */

    /** Brings the drawn range over the visible one; returns whether it changed. */
    private updateRange(world: RtWorld): boolean {
        const visible = this.camera.visibleTileRange()
        const wanted = rtGrowRange(visible, RT_RENDER_MARGIN)
        const drawn = this.drawn
        if (!this.needsFull && drawn && rtRangeContains(drawn, visible) && rtRangeArea(drawn) <= RT_RENDER_SHRINK * rtRangeArea(wanted)) return false
        const map = world.map
        if (this.needsFull) {
            this.releaseAllTiles()
            this.dirty.clear()
        } else {
            for (const tile of [...this.tiles.keys()]) {
                if (!rtTileInRange(wanted, map.tileX(tile), map.tileY(tile))) this.releaseTile(tile)
            }
        }
        rtForEachTileInRange(wanted, map.side, (x, y) => {
            const tile = map.idx(x, y)
            if (!this.tiles.has(tile)) this.drawTile(world, tile)
        })
        this.drawn = wanted
        this.needsFull = false
        this.overlayDirty = true
        return true
    }

    private redrawDirty(world: RtWorld): void {
        for (const tile of this.dirty) {
            if (!this.tiles.has(tile)) continue
            this.releaseTile(tile)
            this.drawTile(world, tile)
        }
        this.dirty.clear()
        this.overlayDirty = true
    }

    private frameOf(name: string, colour: number): RtSpriteFrame {
        return colour >= 0 ? this.atlas.company(colour).get(name) : this.atlas.get(name)
    }

    private drawTile(world: RtWorld, tile: number): void {
        const entry: TileSprites = { ground: [], objects: [], water: [] }
        for (const item of rtTileDrawList(world, tile, this.atlas, this.waterFrame)) {
            const frame = this.frameOf(item.name, item.colour)
            if (item.ground) {
                const sprite = this.groundPool.take(frame, item.wx, item.wy, item.z)
                entry.ground.push(sprite)
                if (item.water) entry.water.push({ sprite, wx: item.wx, wy: item.wy, coast: item.water.coast })
            } else {
                entry.objects.push(this.objectPool.take(frame, item.wx, item.wy, item.z))
            }
        }
        this.tiles.set(tile, entry)
        if (entry.water.length > 0) this.waterTiles.add(entry)
        if (rtIsParkingSpot(world.map, tile)) this.sidings.add(tile)
    }

    private releaseTile(tile: number): void {
        const entry = this.tiles.get(tile)
        if (!entry) return
        for (const sprite of entry.ground) this.groundPool.give(sprite)
        for (const sprite of entry.objects) this.objectPool.give(sprite)
        this.waterTiles.delete(entry)
        this.tiles.delete(tile)
        this.sidings.delete(tile)
    }

    private releaseAllTiles(): void {
        for (const tile of [...this.tiles.keys()]) this.releaseTile(tile)
        this.drawn = null
    }

    private animateWater(now: number): void {
        const frame = rtWaterFrameAt(now)
        if (frame === this.waterFrame) return
        this.waterFrame = frame
        for (const entry of this.waterTiles) {
            for (const water of entry.water) {
                const next = water.coast ? this.atlas.coast(water.coast, frame) : this.atlas.water(frame)
                water.sprite.texture = next.texture
                water.sprite.position.set(water.wx + next.ox, water.wy + next.oy)
            }
        }
    }

    /* ---------------- vehicles ---------------- */

    private releaseVehicles(): void {
        for (const sprite of this.vehicleSprites) this.objectPool.give(sprite)
        this.vehicleSprites = []
    }

    private drawVehicles(world: RtWorld): void {
        this.releaseVehicles()
        this.drawnTick = world.tick
        this.vehiclesDirty = false
        const drawn = this.drawn
        if (!drawn) return
        const map = world.map
        for (const vehicle of world.vehicleList()) {
            if (vehicle.state === RtVehicleState.inDepot) continue
            const colour = world.company(vehicle.owner)?.colour ?? -1
            const loaded = vehicle.cargo.length > 0
            for (const part of rtVehicleParts(map, vehicle)) {
                const x = map.tileX(part.tile)
                const y = map.tileY(part.tile)
                if (!rtTileInRange(drawn, x, y)) continue
                const model = RT_VEHICLE_MODEL_IDS[part.model]
                const facing = RT_SPRITE_DIRECTIONS[part.direction]
                if (!model || !facing) continue
                const at = rtTileToWorld(x + part.lx, y + part.ly, part.height)
                const frame = this.frameOf(rtVehicleSpriteName(model, facing, loaded), colour)
                const sprite = this.objectPool.take(frame, Math.round(at.x), Math.round(at.y), rtObjectDepth(x, y, part.lx, part.ly))
                if (vehicle.state === RtVehicleState.crashed) sprite.tint = 0x6a6a6a
                this.vehicleSprites.push(sprite)
            }
        }
    }

    /* ---------------- overlay (screen pixels) ---------------- */

    /** Screen position of a tile's centre at its highest corner. */
    private tileCentre(map: RtMap, tile: number): { x: number, y: number } {
        const w = rtTileToWorld(map.tileX(tile) + 0.5, map.tileY(tile) + 0.5, map.tileMaxHeight(tile))
        return this.camera.worldToScreen(w.x, w.y)
    }

    private drawMarkers(map: RtMap): void {
        const camera = this.camera
        // whole multiples of the marker's own pixels, so it stays crisp; larger when zoomed in
        const scale = camera.zoom >= 2 ? 2 : 1
        let used = 0
        for (const tile of this.sidings) {
            let marker = this.markers[used]
            if (!marker) {
                marker = new this.pixi.Graphics(this.markerContext)
                this.markers.push(marker)
                this.markerLayer.addChild(marker)
            }
            used++
            const at = this.tileCentre(map, tile)
            marker.visible = true
            marker.scale.set(scale)
            marker.position.set(camera.snap(at.x - (MARKER_SIZE * scale) / 2), camera.snap(at.y - MARKER_SIZE * scale - 4 * camera.zoom))
        }
        for (let k = used; k < this.markers.length; k++) this.markers[k]!.visible = false
    }

    private drawSigns(world: RtWorld): void {
        const map = world.map
        const camera = this.camera
        const drawn = this.drawn
        const seen = new Set<number>()
        for (const station of world.stationList()) {
            if (!drawn || !map.validTile(station.sign) || !rtTileInRange(drawn, map.tileX(station.sign), map.tileY(station.sign))) continue
            seen.add(station.id)
            const colourIndex = world.company(station.owner)?.colour ?? -1
            const key = `${station.name}\u0000${colourIndex}`
            let sign = this.signs.get(station.id)
            if (!sign) {
                const view = new this.pixi.Container()
                const back = new this.pixi.Graphics()
                const text = new this.pixi.Text({ text: '', style: SIGN_FONT, resolution: this.resolution })
                view.addChild(back, text)
                this.signLayer.addChild(view)
                sign = { view, back, text, key: '', tile: -1 }
                this.signs.set(station.id, sign)
            }
            if (sign.key !== key) {
                sign.key = key
                sign.text.text = station.name
                const w = Math.ceil(sign.text.width) + 6
                const h = Math.ceil(sign.text.height) + 2
                const rgb = colourIndex >= 0 ? rtCompanyColour(colourIndex) : 0x6b6b6b
                const ramp = rtCompanyRamp(rgb)
                const dark = (ramp[3]! << 16) | (ramp[4]! << 8) | ramp[5]!
                sign.back.clear().rect(0, 0, w, h).fill(dark).rect(1, 1, w - 2, h - 2).fill(rgb)
                sign.text.position.set(3, 1)
            }
            sign.tile = station.sign
            const at = this.tileCentre(map, station.sign)
            const w = Math.ceil(sign.text.width) + 6
            const h = Math.ceil(sign.text.height) + 2
            sign.view.visible = true
            sign.view.position.set(camera.snap(at.x - w / 2), camera.snap(at.y - h - SIGN_LIFT * camera.zoom))
        }
        for (const [id, sign] of this.signs) {
            if (seen.has(id)) continue
            if (world.station(id)) {
                sign.view.visible = false
            } else {
                sign.view.destroy({ children: true })
                this.signs.delete(id)
            }
        }
    }

    private takeFloatView(): Text {
        const view = this.freeFloatViews.pop()
        if (view) {
            view.visible = true
            return view
        }
        const created = new this.pixi.Text({ text: '', style: FLOAT_FONT, resolution: this.resolution })
        this.floatLayer.addChild(created)
        return created
    }

    private releaseFloatView(view: Text): void {
        view.visible = false
        this.freeFloatViews.push(view)
    }

    private drawFloats(map: RtMap, now: number): void {
        for (const gone of this.floats.prune(now)) {
            const view = this.floatViews.get(gone)
            if (view) this.releaseFloatView(view)
            this.floatViews.delete(gone)
        }
        // floats pushed out by RT_FLOAT_MAX
        if (this.floatViews.size > this.floats.items.length) {
            const alive = new Set(this.floats.items)
            for (const [float, view] of this.floatViews) {
                if (alive.has(float)) continue
                this.releaseFloatView(view)
                this.floatViews.delete(float)
            }
        }
        const camera = this.camera
        // several floats on one tile stack: the newest at the base, each older one a line higher
        const stacked = new Map<number, number>()
        const items = this.floats.items
        for (let k = items.length - 1; k >= 0; k--) {
            const float = items[k]!
            const look = rtFloatLook(now - float.born)
            if (!look || !map.validTile(float.tile)) continue
            let view = this.floatViews.get(float)
            if (!view) {
                view = this.takeFloatView()
                view.text = rtFormatIncome(float.amount)
                this.floatViews.set(float, view)
            }
            const below = stacked.get(float.tile) ?? 0
            stacked.set(float.tile, below + 1)
            const at = this.tileCentre(map, float.tile)
            view.alpha = look.alpha
            view.position.set(camera.snap(at.x - view.width / 2), camera.snap(at.y - FLOAT_LIFT * camera.zoom - view.height * (1 + below) - look.rise))
        }
    }

    /* ---------------- preview ---------------- */

    private drawPreviewNow(map: RtMap): void {
        const g = this.previewLayer
        const zoom = this.camera.zoom
        this.previewZoom = zoom
        g.clear()
        const preview = this.preview
        if (!preview) return
        const width = PREVIEW_LINE / zoom
        const diamond = (tile: number): boolean => {
            if (!map.validTile(tile)) return false
            const x = map.tileX(tile)
            const y = map.tileY(tile)
            const [hn, hw, he, hs] = rtTileCorners(map, x, y)
            const n = rtTileToWorld(x, y, hn)
            const e = rtTileToWorld(x, y + 1, he)
            const s = rtTileToWorld(x + 1, y + 1, hs)
            const w = rtTileToWorld(x + 1, y, hw)
            g.poly([n.x, n.y, e.x, e.y, s.x, s.y, w.x, w.y])
            return true
        }
        const group = (tiles: Iterable<number>, color: number, fill: number, line: number) => {
            let any = false
            for (const tile of tiles) any = diamond(tile) || any
            if (!any) return
            g.fill({ color, alpha: fill })
            if (line > 0) g.stroke({ color, alpha: line, width })
        }
        const blocked = new Set(preview.blocked)
        group(preview.catchment, PREVIEW.catchment, 0.2, 0)
        group(preview.tiles.filter(tile => !blocked.has(tile)), preview.ok ? PREVIEW.tile : PREVIEW.refused, 0.25, 0.9)
        group(blocked, PREVIEW.blocked, 0.4, 0.9)
    }
}

/** The parking spot marker (W150): a blue square sign with a white P, unlike any signal. */
function buildMarkerContext(pixi: Pixi): GraphicsContext {
    const s = MARKER_SIZE
    return new pixi.GraphicsContext()
        .rect(0, 0, s, s).fill(0xffffff)
        .rect(1, 1, s - 2, s - 2).fill(MARKER_BLUE)
        // the P, 4 by 5 pixels: stem, top bar, bowl side, middle bar
        .rect(3, 2, 1, 5).fill(0xffffff)
        .rect(3, 2, 3, 1).fill(0xffffff)
        .rect(6, 3, 1, 1).fill(0xffffff)
        .rect(3, 4, 3, 1).fill(0xffffff)
}
