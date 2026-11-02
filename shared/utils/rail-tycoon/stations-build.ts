/**
 * Station building: rail stations and drive-through road stops. Behaviour mimics the
 * original game at its default settings (adjacent tiles join an own station, station spread 12,
 * drive-through stops allowed on town roads); the code is written from scratch.
 *
 * Station payload (kind station):
 *   bits 0-15   station id
 *   bits 16-17  tile type (RtStationTile: rail platform, bus stop, truck stop; 3 is never used)
 *   bit  18     axis: 0 along x, 1 along y (the platform track, or the stop's road)
 *   bit  19     reservation of a platform tile, set and checked by reservePath
 *   bit  20     road stops: a bay stop (0 a drive-through stop)
 *   bits 21-22  bay stops: the side the entrance faces (RtDir); the axis bit follows it
 *   bit  23     unused, 0
 *   bits 24-31  road stops: owner of the road under the stop (RT_OWNER_NONE a town), restored on demolish;
 *               a bay's is its own owner
 * The tile's owner byte is the station owner. A drive-through stop always carries the full straight
 * road along its axis; a bay only the half towards its entrance, and it is a dead end with two bays
 * side by side (the original's normal road stop). A platform carries the straight track along its axis.
 * Payloads written before bays existed have bits 20-23 clear, so they read as drive-through stops.
 */

import { clampUtf8 } from './bytes'
import { RT_CARGO_IDS, RT_CATALOG } from './catalog'
import { manhattan } from './economy'
import { RT_ROAD_DIR_BIT, RtTileKind, rtReverseDir, type RtDir, type RtMap } from './map'
import { buildRoad, rtRoadBits } from './road'
import {
    RT_ROAD_X,
    RT_ROAD_Y,
    RtBuildError,
    RtTrack,
    rtBitCount,
    rtBuildFail,
    rtBuildOk,
    rtClearingCost,
    rtIsCrossing,
    rtRailHasSignals,
    rtRailPieceReserved,
    rtRailPieces,
    rtValidCompany,
    type RtBuildResult,
    type RtOccupied
} from './track'
import { RT_NONE, RT_OWNER_NONE, RtFacility, type RtStation, type RtStationCargo, type RtTown } from './types'

/** Kind of a station tile. */
export const RtStationTile = { rail: 0, bus: 1, truck: 2 } as const
export type RtStationTile = typeof RtStationTile[keyof typeof RtStationTile]

/** Platform axis: along x (track x) or along y (track y). */
export const RtAxis = { x: 0, y: 1 } as const
export type RtAxis = typeof RtAxis[keyof typeof RtAxis]

export const RT_STATION_ID_MASK = 0xffff
export const RT_STATION_TYPE_SHIFT = 16
export const RT_STATION_AXIS_BIT = 1 << 18
export const RT_STATION_RESERVED_BIT = 1 << 19
export const RT_STATION_BAY_BIT = 1 << 20
export const RT_STATION_BAY_FACING_SHIFT = 21
export const RT_STATION_ROAD_OWNER_SHIFT = 24

/**
 * The shape of a road stop a build asks for: auto is a drive-through stop along the road already
 * there (the only shape before bays existed), driveX and driveY a drive-through stop along that
 * axis, and bayNe to bayNw a bay whose entrance faces that side (RtDir order, bayNe + facing).
 */
export const RtRoadStopShape = { auto: 0, driveX: 1, driveY: 2, bayNe: 3, baySe: 4, baySw: 5, bayNw: 6 } as const
export type RtRoadStopShape = typeof RtRoadStopShape[keyof typeof RtRoadStopShape]
export const RT_ROAD_STOP_SHAPE_MAX = RtRoadStopShape.bayNw

/** Whether a shape is a bay. */
export function rtShapeIsBay(shape: number): boolean {
    return shape >= RtRoadStopShape.bayNe && shape <= RtRoadStopShape.bayNw
}

/** The bay shape whose entrance faces `facing`. */
export function rtBayShape(facing: RtDir): RtRoadStopShape {
    return (RtRoadStopShape.bayNe + (facing & 3)) as RtRoadStopShape
}

/** Most platforms and longest platform one rail station build may make. */
export const RT_MAX_PLATFORMS = 4
export const RT_MAX_PLATFORM_LENGTH = 7

export function rtStationPayload(id: number, type: RtStationTile, axis: RtAxis, roadOwner = 0): number {
    return ((id & RT_STATION_ID_MASK)
        | (type << RT_STATION_TYPE_SHIFT)
        | (axis === RtAxis.y ? RT_STATION_AXIS_BIT : 0)
        | ((roadOwner & 0xff) << RT_STATION_ROAD_OWNER_SHIFT)) >>> 0
}

export function rtStationId(payload: number): number {
    return payload & RT_STATION_ID_MASK
}

export function rtStationTileType(payload: number): RtStationTile {
    return ((payload >>> RT_STATION_TYPE_SHIFT) & 3) as RtStationTile
}

export function rtStationAxis(payload: number): RtAxis {
    return (payload & RT_STATION_AXIS_BIT) !== 0 ? RtAxis.y : RtAxis.x
}

/** The track piece a platform holds (the straight along its axis). */
export function rtPlatformTrack(payload: number): RtTrack {
    return rtStationAxis(payload) === RtAxis.y ? RtTrack.y : RtTrack.x
}

/** A bay stop's payload: the axis bit follows the facing, and its road is its owner's. */
export function rtBayPayload(id: number, type: RtStationTile, facing: RtDir, owner: number): number {
    return (rtStationPayload(id, type, (facing & 1) === 0 ? RtAxis.x : RtAxis.y, owner)
        | RT_STATION_BAY_BIT
        | ((facing & 3) << RT_STATION_BAY_FACING_SHIFT)) >>> 0
}

/** Whether a station tile payload is a bay stop. */
export function rtRoadStopIsBay(payload: number): boolean {
    return (payload & RT_STATION_BAY_BIT) !== 0 && rtStationTileType(payload) !== RtStationTile.rail
}

/** The side a bay's entrance faces (meaningless for any other tile). */
export function rtRoadStopFacing(payload: number): RtDir {
    return ((payload >>> RT_STATION_BAY_FACING_SHIFT) & 3) as RtDir
}

/** The facing of the bay stop on a tile, or -1 when the tile is no bay. */
export function rtBayFacingAt(map: RtMap, tile: number): number {
    if (!map.validTile(tile) || map.kind[tile] !== RtTileKind.station) return -1
    const payload = map.payload[tile]!
    return rtRoadStopIsBay(payload) ? rtRoadStopFacing(payload) : -1
}

/** Road bits a road stop carries: a drive-through stop the full straight along its axis, a bay the half to its entrance. */
export function rtRoadStopBits(payload: number): number {
    if (rtRoadStopIsBay(payload)) return RT_ROAD_DIR_BIT[rtRoadStopFacing(payload)]!
    return rtStationAxis(payload) === RtAxis.y ? RT_ROAD_Y : RT_ROAD_X
}

/**
 * The lane a road vehicle holds in each of a bay's two bays: the side of the tile the bay lies on,
 * one of the two sides across the entrance (slot 0 the next side clockwise). Neither is a way out of
 * the tile, so a lane alone tells a vehicle in a bay apart from one driving through.
 */
export function rtBayLane(facing: RtDir, slot: number): RtDir {
    return ((facing + 1 + 2 * (slot & 1)) & 3) as RtDir
}

/** Which bay (0 or 1) a lane is in a bay facing `facing`, or -1 when it is no bay lane. */
export function rtBaySlot(facing: RtDir, lane: number): number {
    if (lane === rtBayLane(facing, 0)) return 0
    if (lane === rtBayLane(facing, 1)) return 1
    return -1
}

/**
 * The side a road vehicle in `lane` leaves `tile` by: a bay is left by its entrance whichever bay it
 * stands in, every other tile by the lane itself (a road vehicle's lane is its exit direction).
 */
export function rtRoadLaneExit(map: RtMap, tile: number, lane: number): number {
    const facing = rtBayFacingAt(map, tile)
    return facing >= 0 ? facing : lane
}

/**
 * Whether a station tile's payload can exist (decodeWorld refuses a save holding one that cannot): a known tile
 * type, no bay or reservation bit on the wrong kind, a bay's axis matching its facing and its road
 * owned by its owner, and the unused bit clear.
 */
export function rtStationPayloadValid(payload: number, tileOwner: number): boolean {
    const type = (payload >>> RT_STATION_TYPE_SHIFT) & 3
    if (type > RtStationTile.truck || (payload & (1 << 23)) !== 0) return false
    // a platform's road-owner byte means nothing and is left alone
    if (type === RtStationTile.rail) return (payload & (0xf << 20)) === 0
    if ((payload & RT_STATION_RESERVED_BIT) !== 0) return false
    if ((payload & RT_STATION_BAY_BIT) === 0) return ((payload >>> RT_STATION_BAY_FACING_SHIFT) & 3) === 0
    const facing = rtRoadStopFacing(payload)
    return ((payload & RT_STATION_AXIS_BIT) !== 0) === ((facing & 1) === 1) && rtRoadStopRoadOwner(payload) === tileOwner
}

/** Owner of the road under a road stop (RT_OWNER_NONE a town road). */
export function rtRoadStopRoadOwner(payload: number): number {
    return (payload >>> RT_STATION_ROAD_OWNER_SHIFT) & 0xff
}

export function rtPlatformReserved(payload: number): boolean {
    return (payload & RT_STATION_RESERVED_BIT) !== 0
}

export function rtWithPlatformReservation(payload: number, reserved: boolean): number {
    return (reserved ? payload | RT_STATION_RESERVED_BIT : payload & ~RT_STATION_RESERVED_BIT) >>> 0
}

/** Facility bit of a station tile type. */
export function rtFacilityOf(type: RtStationTile): number {
    return type === RtStationTile.rail ? RtFacility.rail : type === RtStationTile.bus ? RtFacility.busStop : RtFacility.truckStop
}

/* ------------------------------------------------------------------------------------------
 * Shared helpers
 * ---------------------------------------------------------------------------------------- */

/** The station with this id in a list kept in ascending id order, or undefined. */
export function rtFindStation(stations: readonly RtStation[], id: number): RtStation | undefined {
    for (const station of stations) {
        if (station.id === id) return station
    }
    return undefined
}

/** A fresh per-cargo state: the starting rating, nothing waiting, never served. */
export function rtNewStationCargo(): RtStationCargo {
    return {
        rating: RT_CATALOG.stationRating.start,
        hasRating: false,
        loadAttempted: false,
        packets: [],
        fraction: 0,
        cyclesSincePickup: 0,
        maxWaiting: 0,
        lastSpeed: 0,
        lastAge: 0
    }
}

/** The lowest station id no station uses, as the original's pool hands out ids. */
function lowestFreeId(stations: readonly RtStation[]): number {
    const used = new Set<number>()
    for (const station of stations) used.add(station.id)
    let id = 0
    while (used.has(id)) id++
    return id
}

/** The town nearest a tile by Manhattan distance, the lowest id on a tie, or undefined without towns. */
function nearestTown(map: RtMap, towns: readonly RtTown[], tile: number): RtTown | undefined {
    let best: RtTown | undefined
    let bestDistance = Infinity
    for (const town of towns) {
        if (!town || !map.validTile(town.centre)) continue
        const d = manhattan(tile, town.centre, map.side)
        if (d < bestDistance || (d === bestDistance && best !== undefined && town.id < best.id)) {
            best = town
            bestDistance = d
        }
    }
    return best
}

/** The town's name, or "<name> N" with the lowest N from 2 that no station uses, within maxNameBytes. */
function uniqueStationName(base: string, stations: readonly RtStation[]): string {
    const max = RT_CATALOG.caps.maxNameBytes
    const taken = new Set<string>()
    for (const station of stations) taken.add(station.name)
    const plain = clampUtf8(base, max)
    if (!taken.has(plain)) return plain
    for (let n = 2; ; n++) {
        const suffix = ` ${n}`
        const name = clampUtf8(base, max - suffix.length) + suffix
        if (!taken.has(name)) return name
    }
}

function newStation(map: RtMap, stations: readonly RtStation[], towns: readonly RtTown[], owner: number, sign: number): RtStation {
    const town = nearestTown(map, towns, sign)
    const id = lowestFreeId(stations)
    return {
        id,
        owner,
        name: uniqueStationName(town ? town.name : 'Station', stations),
        town: town ? town.id : RT_NONE,
        sign,
        tiles: [],
        tilesRevision: 0,
        facilities: 0,
        cargo: RT_CARGO_IDS.map(() => rtNewStationCargo()),
        acceptance: 0,
        lastPickupTick: RT_NONE,
        lastDeliveryTick: RT_NONE,
        lastVehicleKind: RT_NONE,
        catchment: null,
        catchmentRevision: RT_NONE
    }
}

/** Inserts a station keeping the list in ascending id order. */
function insertStation(stations: RtStation[], station: RtStation): void {
    let at = stations.length
    while (at > 0 && stations[at - 1]!.id > station.id) at--
    stations.splice(at, 0, station)
}

/**
 * The own station the given tiles join: every own station tile in the 3 by 3 ring around each tile
 * counts, as the original. Returns the station id, RT_NONE when none adjoins, or null when two or
 * more different own stations adjoin.
 */
function adjoiningStation(map: RtMap, owner: number, tiles: readonly number[]): number | null {
    let found: number = RT_NONE
    const side = map.side
    for (const tile of tiles) {
        const x = map.tileX(tile)
        const y = map.tileY(tile)
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx
                const ny = y + dy
                if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue
                const n = ny * side + nx
                if (map.kind[n] !== RtTileKind.station || map.owner[n] !== owner) continue
                const id = rtStationId(map.payload[n]!)
                if (found === RT_NONE) found = id
                else if (found !== id) return null
            }
        }
    }
    return found
}

/** Whether a station's tiles plus the new ones span at most stationSpread tiles in each direction. */
function withinSpread(map: RtMap, existing: readonly number[], added: readonly number[]): boolean {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const list of [existing, added]) {
        for (const tile of list) {
            const x = map.tileX(tile)
            const y = map.tileY(tile)
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
    }
    const spread = RT_CATALOG.stations.stationSpread
    return maxX - minX + 1 <= spread && maxY - minY + 1 <= spread
}

/**
 * Resolves which station a build joins or whether it creates one: the joined station, a fresh
 * (unlisted) station, or a refusal. Checks the adjoining rule, the spread and the station cap.
 */
function resolveStation(
    map: RtMap, stations: readonly RtStation[], towns: readonly RtTown[], owner: number, tiles: readonly number[], sign: number
): { station: RtStation, created: boolean } | RtBuildError {
    const join = adjoiningStation(map, owner, tiles)
    if (join === null) return RtBuildError.conflict
    if (join !== RT_NONE) {
        const station = rtFindStation(stations, join)
        if (!station || station.owner !== owner) return RtBuildError.invalid
        if (!withinSpread(map, station.tiles, tiles)) return RtBuildError.tooSpread
        return { station, created: false }
    }
    if (stations.length >= RT_CATALOG.caps.maxStations) return RtBuildError.limit
    if (!withinSpread(map, [], tiles)) return RtBuildError.tooSpread
    return { station: newStation(map, stations, towns, owner, sign), created: true }
}

/** Adds tiles to a station (ascending), bumps its revision and facility bits, listing it when new. */
function commitTiles(stations: RtStation[], station: RtStation, created: boolean, tiles: readonly number[], type: RtStationTile): void {
    if (created) insertStation(stations, station)
    for (const tile of tiles) {
        if (!station.tiles.includes(tile)) station.tiles.push(tile)
    }
    station.tiles.sort((a, b) => a - b)
    station.tilesRevision++
    station.facilities |= rtFacilityOf(type)
}

/* ------------------------------------------------------------------------------------------
 * Rail stations
 * ---------------------------------------------------------------------------------------- */

/**
 * Builds a rail station of `tracks` platforms (1 to 4) of `length` tiles (1 to 7) from the north
 * corner tile `origin`, platforms running along `axis`. The footprint must lie on the map, be flat and
 * hold only clear land, trees (cleared at catalog cost) or the company's own unsignalled, unreserved
 * straight rail along the axis (reused; refused with occupied on a vehicle when occupied is given).
 * Touching one own station (the 3 by 3 ring) joins it, touching two is refused, otherwise a new
 * station named after the nearest town is created (RT_CATALOG caps.maxStations bounds it). The station
 * stays within stationSpread. Cost per tile railStationTile plus track, plus
 * railStationLength per platform length, as the original. Returns the station id on success.
 */
export function buildRailStation(
    map: RtMap, stations: RtStation[], towns: readonly RtTown[], owner: number, origin: number,
    axis: number, tracks: number, length: number, apply: boolean, occupied?: RtOccupied
): RtBuildResult {
    if (!rtValidCompany(owner) || !map.validTile(origin) || !Array.isArray(stations) || !Array.isArray(towns)) {
        return rtBuildFail(RtBuildError.invalid)
    }
    if (axis !== RtAxis.x && axis !== RtAxis.y) return rtBuildFail(RtBuildError.invalid)
    if (!Number.isInteger(tracks) || tracks < 1 || tracks > RT_MAX_PLATFORMS) return rtBuildFail(RtBuildError.invalid)
    if (!Number.isInteger(length) || length < 1 || length > RT_MAX_PLATFORM_LENGTH) return rtBuildFail(RtBuildError.invalid)
    const w = axis === RtAxis.x ? length : tracks
    const h = axis === RtAxis.x ? tracks : length
    const ox = map.tileX(origin)
    const oy = map.tileY(origin)
    if (ox + w > map.side || oy + h > map.side) return rtBuildFail(RtBuildError.edge)

    const prices = RT_CATALOG.construction
    const piece = axis === RtAxis.x ? RtTrack.x : RtTrack.y
    const tiles: number[] = []
    let cost = length * prices.railStationLength
    for (let y = oy; y < oy + h; y++) {
        for (let x = ox; x < ox + w; x++) {
            const tile = map.idx(x, y)
            switch (map.kind[tile]) {
                case RtTileKind.water:
                    return rtBuildFail(RtBuildError.water)
                case RtTileKind.clear:
                case RtTileKind.coast:
                case RtTileKind.tree:
                    break
                case RtTileKind.rail: {
                    if (map.owner[tile] !== owner) return rtBuildFail(RtBuildError.notOwner)
                    const payload = map.payload[tile]!
                    if (rtIsCrossing(payload) || rtRailPieces(payload) !== 1 << piece) return rtBuildFail(RtBuildError.occupied)
                    if (rtRailHasSignals(payload) || rtRailPieceReserved(payload, piece)) return rtBuildFail(RtBuildError.conflict)
                    if (occupied && occupied(tile)) return rtBuildFail(RtBuildError.conflict)
                    break
                }
                case RtTileKind.station:
                case RtTileKind.depot:
                    return rtBuildFail(map.owner[tile] !== owner ? RtBuildError.notOwner : RtBuildError.occupied)
                default:
                    return rtBuildFail(RtBuildError.occupied)
            }
            if (!map.isFlat(tile)) return rtBuildFail(RtBuildError.badSlope)
            cost += prices.railStationTile + prices.track + rtClearingCost(map, tile)
            tiles.push(tile)
        }
    }

    const resolved = resolveStation(map, stations, towns, owner, tiles, origin)
    if (typeof resolved === 'number') return rtBuildFail(resolved)
    const { station, created } = resolved
    if (apply === true) {
        const payload = rtStationPayload(station.id, RtStationTile.rail, axis)
        for (const tile of tiles) map.setTile(tile, RtTileKind.station, owner, payload)
        commitTiles(stations, station, created, tiles, RtStationTile.rail)
    }
    return rtBuildOk(cost, station.id)
}

/* ------------------------------------------------------------------------------------------
 * Road stops
 * ---------------------------------------------------------------------------------------- */

/** The road sides (RtDir) a stop of this shape opens to: a bay its entrance, a drive-through stop both ends. */
export function rtRoadStopEntrances(shape: number, axis: RtAxis): RtDir[] {
    if (rtShapeIsBay(shape)) return [((shape - RtRoadStopShape.bayNe) & 3) as RtDir]
    return axis === RtAxis.y ? [1, 3] : [0, 2]
}

/**
 * Joins a new stop to the road outside each entrance, as the original's road stop tool does: a plain
 * road tile there with road on it, own or a town's, gains the half pointing at the stop (road cost).
 * A neighbour that cannot take it is left as it is. Returns the cost.
 */
function connectEntrances(map: RtMap, owner: number, tile: number, entrances: readonly RtDir[], apply: boolean): number {
    let cost = 0
    for (const side of entrances) {
        const next = map.neighbour(tile, side)
        if (next < 0 || map.kind[next] !== RtTileKind.road || rtRoadBits(map.payload[next]!) === 0) continue
        const bit = RT_ROAD_DIR_BIT[rtReverseDir(side)]!
        if ((map.payload[next]! & bit) !== 0) continue
        const built = buildRoad(map, owner, next, bit, apply)
        if (built.ok) cost += built.cost
    }
    return cost
}

/**
 * Builds a bus or truck stop (`kind` RtStationTile.bus or .truck) of `shape` (RtRoadStopShape), as
 * the original:
 * - auto (the default, and every stop built before bays): a drive-through stop on a straight own or
 *   town road on flat land, along the road; a half road along one axis is completed at road cost.
 * - driveX, driveY: the same along that axis; a straight road the other way is refused with
 *   wrongDirection. On flat clear land (trees cleared at catalog cost) it lays its own straight road
 *   with it, at two road halves' cost, and joins the road at both ends (connectEntrances).
 * - bayNe to bayNw: a bay on flat clear land, trees cleared, whose entrance faces that side and must
 *   lie on the map; it joins the road outside its entrance.
 * A junction, a corner, other companies' roads, a level crossing and a vehicle on the tile (when
 * occupied is given) are refused. Joins an adjoining own station or creates one, within stationSpread.
 * A drive-through stop keeps its road and remembers the road owner, so demolishing it gives
 * a town road back to the town; a bay leaves clear land. Returns the station id on success.
 */
export function buildRoadStop(
    map: RtMap, stations: RtStation[], towns: readonly RtTown[], owner: number, tile: number,
    kind: number, apply: boolean, occupied?: RtOccupied, shape: number = RtRoadStopShape.auto
): RtBuildResult {
    if (!rtValidCompany(owner) || !map.validTile(tile) || !Array.isArray(stations) || !Array.isArray(towns)) {
        return rtBuildFail(RtBuildError.invalid)
    }
    if (kind !== RtStationTile.bus && kind !== RtStationTile.truck) return rtBuildFail(RtBuildError.invalid)
    if (!Number.isInteger(shape) || shape < 0 || shape > RT_ROAD_STOP_SHAPE_MAX) return rtBuildFail(RtBuildError.invalid)
    const bay = rtShapeIsBay(shape)
    const wanted = shape === RtRoadStopShape.driveX ? RtAxis.x : shape === RtRoadStopShape.driveY ? RtAxis.y : -1
    const prices = RT_CATALOG.construction
    let cost = prices.roadStop
    let roadOwner = owner
    let axis: RtAxis
    switch (map.kind[tile]) {
        case RtTileKind.road: {
            if (bay) return rtBuildFail(RtBuildError.occupied)
            roadOwner = map.owner[tile]!
            if (roadOwner !== owner && roadOwner !== RT_OWNER_NONE) return rtBuildFail(RtBuildError.notOwner)
            const bits = rtRoadBits(map.payload[tile]!)
            const along = (bits & ~RT_ROAD_X) === 0 ? RtAxis.x : (bits & ~RT_ROAD_Y) === 0 ? RtAxis.y : -1
            if (bits === 0 || along < 0) return rtBuildFail(RtBuildError.conflict)
            if (wanted >= 0 && wanted !== along) return rtBuildFail(RtBuildError.wrongDirection)
            axis = along as RtAxis
            cost += prices.road * (2 - rtBitCount(bits))
            break
        }
        case RtTileKind.water:
            return rtBuildFail(RtBuildError.water)
        case RtTileKind.clear:
        case RtTileKind.coast:
        case RtTileKind.tree:
            // auto names no axis: on land without road it has nothing to follow
            if (shape === RtRoadStopShape.auto) return rtBuildFail(RtBuildError.conflict)
            axis = bay ? (((shape - RtRoadStopShape.bayNe) & 1) === 0 ? RtAxis.x : RtAxis.y) : wanted as RtAxis
            if (!bay) cost += prices.road * 2
            cost += rtClearingCost(map, tile)
            break
        case RtTileKind.station:
        case RtTileKind.depot:
            if (!bay) return rtBuildFail(RtBuildError.conflict)
            return rtBuildFail(map.owner[tile] !== owner ? RtBuildError.notOwner : RtBuildError.occupied)
        default:
            return rtBuildFail(bay ? RtBuildError.occupied : RtBuildError.conflict)
    }
    if (!map.isFlat(tile)) return rtBuildFail(RtBuildError.badSlope)
    const facing = bay ? ((shape - RtRoadStopShape.bayNe) & 3) as RtDir : -1
    if (bay && map.neighbour(tile, facing as RtDir) < 0) return rtBuildFail(RtBuildError.edge)
    if (occupied && occupied(tile)) return rtBuildFail(RtBuildError.conflict)

    const resolved = resolveStation(map, stations, towns, owner, [tile], tile)
    if (typeof resolved === 'number') return rtBuildFail(resolved)
    const { station, created } = resolved
    // a stop on a road already there keeps its ends as they are; a new one joins the road around it
    const entrances = map.kind[tile] === RtTileKind.road ? [] : rtRoadStopEntrances(shape, axis)
    cost += connectEntrances(map, owner, tile, entrances, false)
    if (apply === true) {
        const payload = bay
            ? rtBayPayload(station.id, kind as RtStationTile, facing as RtDir, owner)
            : rtStationPayload(station.id, kind as RtStationTile, axis, roadOwner)
        map.setTile(tile, RtTileKind.station, owner, payload)
        commitTiles(stations, station, created, [tile], kind as RtStationTile)
        connectEntrances(map, owner, tile, entrances, true)
    }
    return rtBuildOk(cost, station.id)
}
