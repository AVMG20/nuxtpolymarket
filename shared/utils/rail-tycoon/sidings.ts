/**
 * Parking spots (answered by Michael): a stopped train is sent off the line to a
 * parking spot instead of standing where it is. A spot is a dead-end side rail: a run of the owner's
 * own plain track that branches off at a junction and ends in a dead end, marked on its dead-end tile
 * with RT_RAIL_SIDING. It holds one train, which must fit. The inside of an own rail depot is a
 * parking place too. With no place found ahead or (by reversing) behind, the train travels on and
 * pays as any running train does; it never stands on a crossing, the main line or foreign track.
 *
 * A spot is never saved as such: it is recomputed from the map on every use, so building onto its
 * run, a signal on it, or removing a piece simply makes it stop being a spot.
 */

import { RT_CATALOG } from './catalog'
import { RtTileKind, rtReverseDir, type RtDir, type RtMap } from './map'
import { findRailRoute, RtRouteOutcome, type RtRouteTarget } from './pathfinder'
import { rtPieceReserved } from './signals'
import {
    RtBuildError,
    followTrack,
    rtBitCount,
    rtBuildFail,
    rtBuildOk,
    rtIsCrossing,
    rtPieceEdges,
    rtRailDepotFacing,
    rtRailHasSignals,
    rtRailPieces,
    rtReverseTrackdir,
    rtTrackdirExitDir,
    rtTrackdirList,
    rtValidCompany,
    rtValidTrackdir,
    type RtBuildResult,
    type RtTrack,
    type RtTrackdir
} from './track'
import { RT_NONE, type RtVehicle } from './types'
import { rtConsistLengthTiles } from './vehicles'

/** Rail payload bit marking a parking spot's dead-end tile (bits 29-31 are unused by track.ts's layout). */
export const RT_RAIL_SIDING = 1 << 29
/** A spot's run is walked back at most this many tiles; a longer run is not a spot. */
export const RT_SIDING_MAX_TILES = 64

export function rtIsSiding(payload: number): boolean {
    return (payload & RT_RAIL_SIDING) !== 0
}

/** A parking spot: its tiles from the dead end back to (not including) the branching junction, with each tile's piece. */
export interface RtSidingSpot {
    deadEnd: number
    tiles: number[]
    pieces: RtTrack[]
}

/** The single piece of a plain own rail tile (no crossing, no signal), or -1. */
function plainPiece(map: RtMap, tile: number, owner: number): number {
    if (map.kind[tile] !== RtTileKind.rail || map.owner[tile] !== owner) return -1
    const payload = map.payload[tile]!
    if (rtIsCrossing(payload) || rtRailHasSignals(payload)) return -1
    const pieces = rtRailPieces(payload)
    if (rtBitCount(pieces) !== 1) return -1
    return 31 - Math.clz32(pieces)
}

/** The other edge of a piece. */
function otherEdge(piece: RtTrack, edge: RtDir): RtDir {
    const [a, b] = rtPieceEdges(piece)
    return a === edge ? b : a
}

/**
 * The spot whose dead end is `tile`, for a train of `owner`, ignoring whether the tile is marked:
 * the tile holds one plain piece with exactly one connected edge, and the run back through that
 * edge is plain single-piece own track until it meets a tile with more than one piece (the
 * junction). Anything else on the way (a signal, crossing, station, depot, foreign or open end)
 * means no spot.
 */
function spotFrom(map: RtMap, tile: number, owner: number): RtSidingSpot | null {
    const first = plainPiece(map, tile, owner)
    if (first < 0) return null
    const piece = first as RtTrack
    const [a, b] = rtPieceEdges(piece)
    const openA = followTrack(map, tile, a, owner, true) !== 0
    const openB = followTrack(map, tile, b, owner, true) !== 0
    if (openA === openB) return null
    const spot: RtSidingSpot = { deadEnd: tile, tiles: [tile], pieces: [piece] }
    let cur = tile
    let exit: RtDir = openA ? a : b
    for (let n = 1; n <= RT_SIDING_MAX_TILES; n++) {
        if (followTrack(map, cur, exit, owner, true) === 0) return null
        const next = map.neighbour(cur, exit)
        const entry = rtReverseDir(exit)
        if (map.kind[next] === RtTileKind.rail && map.owner[next] === owner) {
            const payload = map.payload[next]!
            if (rtIsCrossing(payload)) return null
            if (rtBitCount(rtRailPieces(payload)) > 1) return spot
        }
        const p = plainPiece(map, next, owner)
        if (p < 0) return null
        spot.tiles.push(next)
        spot.pieces.push(p as RtTrack)
        cur = next
        exit = otherEdge(p as RtTrack, entry)
    }
    return null
}

/** The spot marked on `tile`, or null when the tile is not marked or no longer forms a spot. */
export function rtSidingSpot(map: RtMap, tile: number): RtSidingSpot | null {
    if (!map.validTile(tile) || map.kind[tile] !== RtTileKind.rail || !rtIsSiding(map.payload[tile]!)) return null
    return spotFrom(map, tile, map.owner[tile]!)
}

/**
 * Mark a parking spot on the dead-end tile of an own branch. Refused with invalid for bad
 * input or a tile that is not rail, notOwner for another company's track, alreadyBuilt for a marked
 * tile, and conflict when the tile is no dead end or its run back to the junction holds anything but
 * plain track.
 */
export function buildSiding(map: RtMap, owner: number, tile: number, apply: boolean): RtBuildResult {
    if (!rtValidCompany(owner) || !map.validTile(tile)) return rtBuildFail(RtBuildError.invalid)
    if (map.kind[tile] !== RtTileKind.rail) return rtBuildFail(RtBuildError.invalid)
    if (map.owner[tile] !== owner) return rtBuildFail(RtBuildError.notOwner)
    const payload = map.payload[tile]!
    if (rtIsSiding(payload)) return rtBuildFail(RtBuildError.alreadyBuilt)
    if (spotFrom(map, tile, owner) === null) return rtBuildFail(RtBuildError.conflict)
    if (apply === true) map.payload[tile] = (payload | RT_RAIL_SIDING) >>> 0
    return rtBuildOk(RT_CATALOG.construction.siding)
}

/** Take the mark off an own marked tile. Removing the rail itself drops the mark too. */
export function removeSiding(map: RtMap, owner: number, tile: number, apply: boolean): RtBuildResult {
    if (!rtValidCompany(owner) || !map.validTile(tile)) return rtBuildFail(RtBuildError.invalid)
    if (map.kind[tile] !== RtTileKind.rail) return rtBuildFail(RtBuildError.invalid)
    if (map.owner[tile] !== owner) return rtBuildFail(RtBuildError.notOwner)
    const payload = map.payload[tile]!
    if (!rtIsSiding(payload)) return rtBuildFail(RtBuildError.invalid)
    if (apply === true) map.payload[tile] = (payload & ~RT_RAIL_SIDING) >>> 0
    return rtBuildOk(RT_CATALOG.construction.removeSiding)
}

/** What findParkingTarget reads from the world. RtWorld satisfies it. */
export interface RtParkingWorld {
    map: RtMap
    settings: { sharing: boolean }
    occupied: { otherTrainOnPiece(tile: number, piece: number, except: number): number }
}

export const RtParkingOutcome = { found: 0, none: 1, deferred: 2 } as const
export type RtParkingOutcome = typeof RtParkingOutcome[keyof typeof RtParkingOutcome]

export interface RtParkingResult {
    outcome: RtParkingOutcome
    /** Trackdirs from the next tile to the dead end or into the depot (found only). */
    route: RtTrackdir[]
    /** The route starts by reversing the train. */
    reverse: boolean
    /** Dead-end tile of the spot, or the depot tile; RT_NONE unless found. */
    place: number
    /** The place is a depot rather than a spot. */
    depot: boolean
    /** Pathfinder nodes used; the caller charges them to world.pathNodesLeft. */
    nodes: number
}

/** Every spot of `owner` the train fits in that no other train holds or has reserved, and every own rail depot. */
export function rtParkingPlaces(world: RtParkingWorld, vehicle: RtVehicle): { spots: RtSidingSpot[], depots: number[] } {
    const map = world.map
    const length = rtConsistLengthTiles(vehicle.consist)
    const spots: RtSidingSpot[] = []
    const depots: number[] = []
    const count = map.side * map.side
    for (let tile = 0; tile < count; tile++) {
        if (map.owner[tile] !== vehicle.owner) continue
        const kind = map.kind[tile]
        if (kind === RtTileKind.depot) {
            if (rtRailDepotFacing(map, tile) >= 0) depots.push(tile)
            continue
        }
        if (kind !== RtTileKind.rail || !rtIsSiding(map.payload[tile]!)) continue
        const spot = spotFrom(map, tile, vehicle.owner)
        if (!spot || spot.tiles.length < length) continue
        let free = true
        for (let k = 0; k < spot.tiles.length && free; k++) {
            const t = spot.tiles[k]!
            const p = spot.pieces[k]!
            if (world.occupied.otherTrainOnPiece(t, p, vehicle.id) !== RT_NONE) free = false
            else if (rtPieceReserved(map, t, p) && !holdsTile(vehicle, t)) free = false
        }
        if (free) spots.push(spot)
    }
    return { spots, depots }
}

function holdsTile(vehicle: RtVehicle, tile: number): boolean {
    return vehicle.tiles.includes(tile)
}

/**
 * Whether the train may reverse now: standing still, off every level crossing, with a free, unreserved
 * piece behind its tail. `moving` drops the standing-still condition, for an order that turns a moving
 * train round at once (send to depot, as the original).
 */
export function rtCanReverse(world: RtParkingWorld, vehicle: RtVehicle, moving = false): boolean {
    const map = world.map
    if (vehicle.tiles.length === 0 || (!moving && vehicle.speed !== 0)) return false
    for (const tile of vehicle.tiles) {
        if (map.validTile(tile) && map.kind[tile] === RtTileKind.rail && rtIsCrossing(map.payload[tile]!)) return false
    }
    const tail = vehicle.tiles[vehicle.tiles.length - 1]!
    const tailTd = vehicle.pieces[vehicle.pieces.length - 1]!
    if (!map.validTile(tail) || !rtValidTrackdir(tailTd)) return false
    const back = rtTrackdirExitDir(rtReverseTrackdir(tailTd))
    const bits = followTrack(map, tail, back, vehicle.owner, world.settings.sharing)
    if (bits === 0) return false
    const next = map.neighbour(tail, back)
    for (const td of rtTrackdirList(bits)) {
        const piece = td & 7
        if (world.occupied.otherTrainOnPiece(next, piece, vehicle.id) === RT_NONE && !rtPieceReserved(map, next, piece)) return true
    }
    return false
}

/**
 * Where a train under a stop order should park. Searches for the nearest free spot it fits
 * in, or an own rail depot, ahead of the train and, when it may reverse, behind it, in one search
 * (the pathfinder weighs the reversal). found gives the route; none means no place is reachable,
 * and the train travels on; deferred means the tick's node budget ran out, and the caller
 * keeps moving and asks again next tick. Never throws.
 */
export function findParkingTarget(world: RtParkingWorld, vehicle: RtVehicle, searchBudget: number, tickBudget: number): RtParkingResult {
    const none = (outcome: RtParkingOutcome, nodes = 0): RtParkingResult => ({ outcome, route: [], reverse: false, place: RT_NONE, depot: false, nodes })
    const map = world.map
    if (!vehicle || vehicle.tiles.length === 0 || vehicle.tiles.length !== vehicle.pieces.length) return none(RtParkingOutcome.none)
    const head = vehicle.tiles[0]!
    const headTd = vehicle.pieces[0]!
    if (!map.validTile(head) || !rtValidTrackdir(headTd)) return none(RtParkingOutcome.none)

    const { spots, depots } = rtParkingPlaces(world, vehicle)
    if (spots.length === 0 && depots.length === 0) return none(RtParkingOutcome.none)
    const rankOf = new Map<number, number>()
    const placeOf = new Map<number, number>()
    for (const spot of spots) {
        for (const tile of spot.tiles) {
            rankOf.set(tile, spot.deadEnd)
            placeOf.set(tile, spot.deadEnd)
        }
    }
    for (const tile of depots) {
        rankOf.set(tile, tile)
        placeOf.set(tile, tile)
    }
    const target: RtRouteTarget = { tiles: [...placeOf.keys()].sort((x, y) => x - y), rank: tile => rankOf.get(tile) ?? tile }

    const tail = vehicle.tiles[vehicle.tiles.length - 1]!
    const tailTd = vehicle.pieces[vehicle.pieces.length - 1]!
    const reverseFrom = rtCanReverse(world, vehicle) ? { tile: tail, trackdir: tailTd } : null
    const found = findRailRoute(map, vehicle.owner, head, headTd, target, searchBudget, tickBudget, {
        sharing: world.settings.sharing,
        reverseFrom
    })
    if (found.outcome === RtRouteOutcome.deferred) return none(RtParkingOutcome.deferred, found.nodes)
    if (found.outcome !== RtRouteOutcome.found || found.goal === RT_NONE) return none(RtParkingOutcome.none, found.nodes)
    const place = placeOf.get(found.goal) ?? found.goal
    return {
        outcome: RtParkingOutcome.found,
        route: found.route,
        reverse: found.reverse,
        place,
        depot: map.kind[place] === RtTileKind.depot,
        nodes: found.nodes
    }
}
