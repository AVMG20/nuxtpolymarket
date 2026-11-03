/**
 * Train movement: one tick of one train, as the original's train controller. The plan places
 * stepTrain in vehicles.ts; it lives here so world.ts can import it without a cycle.
 *
 * A train's tiles run head first; pieces[k] is the trackdir held on tiles[k]; progress is the head's
 * way through its tile (a straight piece subTileUnits long, a corner cornerPieceUnits). The train
 * covers its length in tiles behind the front, so it lists length + 1 tiles while the front is inside
 * a tile and length tiles when it stands at a tile edge. Reaching an edge it tries to enter the next
 * tile: the route's trackdir when it still connects, else the first connecting one; signals, path
 * reservations, foreign trains and the end of the line can hold it there.
 * Red signals stop it at the edge at once, as the original; a platform end, an end of line and a
 * parking spot slow it in the last tile instead.
 */

import { RT_CATALOG } from './catalog'
import { chargeSharing, railSharingFee } from './economy'
import { rtIsForeignCrossing } from './inspector'
import { RtTileKind, type RtMap } from './map'
import { advanceOrder, rtCurrentOrder } from './orders'
import { findRailRoute, rtDepotTarget, rtStationRailTarget, RtRouteOutcome, type RtRouteTarget } from './pathfinder'
import { RtParkingOutcome, findParkingTarget, rtCanReverse, rtIsSiding } from './sidings'
import {
    blockHasPathSignal,
    releaseAllFor,
    rtDepotBlockOccupied,
    releaseReservation,
    reservePath,
    rtPassableTrackdirs,
    rtReleaseAhead,
    rtSetPieceReserved,
    rtSetSignalAspect,
    rtSignalGreen,
    rtSignalOnTrackdir,
    rtSignalTypeAt,
    RtSignalType,
    updateSignalStates,
    type RtTrainOnPiece
} from './signals'
import { RtStationTile, rtStationId, rtStationTileType } from './stations-build'
import {
    followTrack,
    rtFirstTrackdir,
    rtIsCrossing,
    rtRailDepotFacing,
    rtTrackdirDirection,
    rtTrackdirExitDir,
    rtTracksOverlap,
    rtValidTrackdir,
    RT_TRACK_COUNT
} from './track'
import { RT_NONE, RtOrderKind, RtVehicleKind, RtVehicleState, type RtVehicle } from './types'
import {
    rtBreakdownTick,
    rtConsistLengthTiles,
    rtConsistMaxSpeed,
    rtConsistPower,
    rtConsistWeight,
    rtCountRunningTick,
    rtServiceInDepot
} from './vehicles'
import type { RtWorld } from './world'

/** What happens at a station stop (loading.ts supplies it). Without hooks a stop ends on the next tick. */
export interface RtTrainHooks {
    /** The head stopped at the end of its target platform. */
    arrive?(world: RtWorld, vehicle: RtVehicle, station: number): void
    /** One loading step; true when the train may leave. */
    loadStep?(world: RtWorld, vehicle: RtVehicle): boolean
}

export interface RtTrainStepResult {
    /** A crashed train whose crash period ran out: the caller removes it (rtRemoveTrain). */
    remove: boolean
    /** The train ran a route search this tick (for RtWorld.step's round-robin cursor). */
    searched: boolean
}

const M = RT_CATALOG.movement
const SIG = RT_CATALOG.signals
const PF = RT_CATALOG.pathfinder

/** Length of a trackdir's piece in progress units. */
export function rtPieceLength(td: number): number {
    return (td & 7) < 2 ? M.subTileUnits : M.cornerPieceUnits
}

/** The trackdir leaving a rail depot through its entrance. */
export function rtDepotExitTrackdir(map: RtMap, depot: number): number {
    const facing = rtRailDepotFacing(map, depot)
    if (facing < 0) return -1
    const piece = (facing & 1) === 0 ? 0 : 1
    for (const td of [piece, piece + 8]) {
        if (rtTrackdirExitDir(td) === facing) return td
    }
    return -1
}

function trainOnPieceOf(world: RtWorld): RtTrainOnPiece {
    return (tile, piece, except) => world.occupied.otherTrainOnPiece(tile, piece, except) !== RT_NONE
}

/** Recomputes the signals around `tiles` and marks every changed tile dirty. */
function refreshSignals(world: RtWorld, tiles: Iterable<number>): void {
    const changed = updateSignalStates(world.map, trainOnPieceOf(world), tiles, world.settings.sharing)
    for (const tile of changed) world.markDirty(tile)
}

/** The ids of other trains on `tile` holding `piece` or a piece crossing it. */
function trainsAcross(world: RtWorld, tile: number, piece: number, except: number): number[] {
    const out: number[] = []
    for (let q = 0; q < RT_TRACK_COUNT; q++) {
        if (q !== piece && !rtTracksOverlap((1 << q) | (1 << piece))) continue
        for (const id of world.occupied.trainsOnPiece(tile, q)) {
            if (id !== except && !out.includes(id)) out.push(id)
        }
    }
    return out.sort((a, b) => a - b)
}

/** Crashes a vehicle: it stops, drops every reservation and counts down crashTicks; its pieces stay held until removal. */
export function rtCrashVehicle(world: RtWorld, vehicle: RtVehicle): void {
    if (vehicle.state === RtVehicleState.crashed) return
    vehicle.state = RtVehicleState.crashed
    vehicle.crashTicks = RT_CATALOG.vehicles.crashTicks
    vehicle.speed = 0
    vehicle.subspeed = 0
    vehicle.loadingStation = RT_NONE
    if (vehicle.kind === RtVehicleKind.rail) releaseAllFor(world.map, vehicle)
    for (const tile of vehicle.tiles) world.markDirty(tile)
}

/** Removes a vehicle whose crash period ran out (or any train being deleted): frees its pieces and refreshes the signals of its blocks. */
export function rtRemoveTrain(world: RtWorld, vehicle: RtVehicle): void {
    const tiles = [...vehicle.tiles]
    if (vehicle.kind === RtVehicleKind.rail) releaseAllFor(world.map, vehicle)
    world.removeVehicle(vehicle.id)
    for (const tile of tiles) world.markDirty(tile)
    refreshSignals(world, tiles)
}

/** Points the train at a new route from its head (no reservation ahead may be held). */
function setRoute(world: RtWorld, vehicle: RtVehicle, route: number[]): void {
    vehicle.route = route.slice(0, RT_CATALOG.caps.maxRouteLength)
    vehicle.routeIndex = 0
    vehicle.reservedEnd = 0
    vehicle.routeTick = world.tick
}

/**
 * Turns the train round: its tile list and trackdirs flip, the reservation ahead is released,
 * and it stands still with a stale route, to reserve and search again from its new head.
 */
export function rtReverseTrain(world: RtWorld, vehicle: RtVehicle): void {
    if (vehicle.tiles.length === 0) return
    rtReleaseAhead(world.map, vehicle)
    const length = rtConsistLengthTiles(vehicle.consist)
    const oldLen = rtPieceLength(vehicle.pieces[0]!)
    const fraction = vehicle.tiles.length > length ? Math.min(vehicle.progress, oldLen) / oldLen : 0
    vehicle.tiles.reverse()
    vehicle.pieces = vehicle.pieces.reverse().map(td => td ^ 8)
    vehicle.direction = vehicle.pieces[0]!
    const newLen = rtPieceLength(vehicle.pieces[0]!)
    vehicle.progress = Math.max(0, Math.min(newLen, newLen - Math.floor(fraction * newLen)))
    vehicle.speed = 0
    vehicle.subspeed = 0
    vehicle.route = []
    vehicle.routeIndex = 0
    vehicle.reservedEnd = 0
    vehicle.routeTick = RT_NONE
    vehicle.waitTicks = 0
}

/**
 * Whether the train has just left `station` and still stands on it: after loading, loadingStation
 * keeps the station until the head is off its platform, and the train never stops twice in a row at
 * one station, as the original (a single-order train drives on and comes back round).
 */
function justLeft(vehicle: RtVehicle, station: number): boolean {
    return vehicle.state !== RtVehicleState.loading && station !== RT_NONE && vehicle.loadingStation === station
}

/** Where the current order (or a pending service visit) sends the train; null when it has nowhere to go. */
function orderTarget(world: RtWorld, vehicle: RtVehicle): RtRouteTarget | null {
    if (vehicle.serviceDepot !== RT_NONE) return rtDepotTarget(vehicle.serviceDepot)
    const order = rtCurrentOrder(vehicle)
    if (!order) return null
    if (order.kind === RtOrderKind.gotoDepot) return world.map.validTile(order.target) ? rtDepotTarget(order.target) : null
    if (justLeft(vehicle, order.target)) return null
    const station = world.station(order.target)
    return station ? rtStationRailTarget(world.map, station) : null
}

/** The station the train is heading for, or RT_NONE. */
function targetStation(vehicle: RtVehicle): number {
    if (vehicle.state === RtVehicleState.parking || vehicle.serviceDepot !== RT_NONE) return RT_NONE
    const order = rtCurrentOrder(vehicle)
    return order && order.kind === RtOrderKind.gotoStation && !justLeft(vehicle, order.target) ? order.target : RT_NONE
}

function isPlatformOf(map: RtMap, tile: number, station: number): boolean {
    if (!map.validTile(tile) || map.kind[tile] !== RtTileKind.station) return false
    const payload = map.payload[tile]!
    return rtStationTileType(payload) === RtStationTile.rail && rtStationId(payload) === station
}

/** Searches a route when the train needs one and the tick's node budget allows. */
function plan(world: RtWorld, vehicle: RtVehicle): boolean {
    if (vehicle.routeIndex < vehicle.reservedEnd) return false
    const stale = vehicle.routeTick === RT_NONE || vehicle.routeIndex >= vehicle.route.length
    if (world.pathNodesLeft <= 0) return false
    const head = vehicle.tiles[0]!
    // inside a depot pieces[0] is the depot's facing, not a trackdir: plan from the way out
    const inDepot = vehicle.state === RtVehicleState.inDepot
    const headTd = inDepot ? rtDepotExitTrackdir(world.map, head) : vehicle.pieces[0]!
    if (!rtValidTrackdir(headTd)) return false
    const tick = world.tick

    if (vehicle.state === RtVehicleState.parking && (vehicle.lostRetryTick === RT_NONE || tick >= vehicle.lostRetryTick)) {
        const found = findParkingTarget(world, vehicle, PF.maxSearchNodes, world.pathNodesLeft)
        world.pathNodesLeft = Math.max(0, world.pathNodesLeft - found.nodes)
        if (found.outcome === RtParkingOutcome.found) {
            if (found.reverse) rtReverseTrain(world, vehicle)
            setRoute(world, vehicle, found.route)
            vehicle.lostRetryTick = RT_NONE
            return true
        }
        if (found.outcome === RtParkingOutcome.none) vehicle.lostRetryTick = tick + PF.lostRetryTicks
        if (found.outcome === RtParkingOutcome.deferred || !stale) return found.nodes > 0
    }
    if (!stale) return false
    const target = orderTarget(world, vehicle)
    if (!target) return false
    if (vehicle.lost && vehicle.lostRetryTick !== RT_NONE && tick < vehicle.lostRetryTick) return false
    const tail = vehicle.tiles[vehicle.tiles.length - 1]!
    const tailTd = vehicle.pieces[vehicle.pieces.length - 1]!
    const reverseFrom = !inDepot && rtCanReverse(world, vehicle) ? { tile: tail, trackdir: tailTd } : null
    const result = findRailRoute(world.map, vehicle.owner, head, headTd, target, PF.maxSearchNodes, world.pathNodesLeft, {
        sharing: world.settings.sharing,
        reverseFrom
    })
    world.pathNodesLeft = Math.max(0, world.pathNodesLeft - result.nodes)
    if (result.outcome === RtRouteOutcome.deferred) return result.nodes > 0
    if (result.reverse) rtReverseTrain(world, vehicle)
    setRoute(world, vehicle, result.route)
    if (result.outcome === RtRouteOutcome.found) {
        vehicle.lost = false
        if (vehicle.state !== RtVehicleState.parking) vehicle.lostRetryTick = RT_NONE
    } else {
        vehicle.lost = true
        vehicle.lostRetryTick = tick + PF.lostRetryTicks
    }
    return true
}

/** The trackdirs the head can enter next and the tile they lie on. */
function ahead(world: RtWorld, vehicle: RtVehicle): { next: number, bits: number } {
    const map = world.map
    const head = vehicle.tiles[0]!
    const headTd = vehicle.pieces[0]!
    const exit = rtTrackdirExitDir(headTd)
    const bits = followTrack(map, head, exit, vehicle.owner, world.settings.sharing)
    if (bits === 0) return { next: -1, bits: 0 }
    const next = map.neighbour(head, exit)
    return { next, bits: rtPassableTrackdirs(map, next, bits) }
}

/** The trackdir the train takes into the next tile: its route's when that still connects, else the first connecting one. */
function chooseTrackdir(vehicle: RtVehicle, bits: number): { td: number, fromRoute: boolean } {
    const planned = vehicle.route[vehicle.routeIndex]
    if (planned !== undefined && rtValidTrackdir(planned) && (bits & (1 << planned)) !== 0) return { td: planned, fromRoute: true }
    if (planned !== undefined) vehicle.routeTick = RT_NONE
    return { td: rtFirstTrackdir(bits), fromRoute: false }
}

/** Whether the train must come to a stop at the end of its head tile (slows it in that tile); `next` and `bits` are ahead()'s. */
function stopsAtTileEnd(world: RtWorld, vehicle: RtVehicle, next: number, bits: number): boolean {
    if (bits === 0) return true
    const station = targetStation(vehicle)
    if (station !== RT_NONE && isPlatformOf(world.map, vehicle.tiles[0]!, station)) {
        const { td } = { td: vehicle.route[vehicle.routeIndex] ?? rtFirstTrackdir(bits) }
        return !(isPlatformOf(world.map, next, station) && td >= 0 && (bits & (1 << td)) !== 0)
    }
    return false
}

/**
 * Whether a road vehicle is still driving over a crossing with barriers: they close behind it, so a
 * train waits for it. One stopped or broken down there is hit, as is any on a foreign crossing (no barriers).
 */
function roadVehicleCrossing(world: RtWorld, tile: number): boolean {
    const map = world.map
    if (map.kind[tile] !== RtTileKind.rail || !rtIsCrossing(map.payload[tile]!) || rtIsForeignCrossing(map, tile)) return false
    for (let lane = 0; lane < 4; lane++) {
        for (const id of world.occupied.roadVehiclesInLane(tile, lane)) {
            const car = world.vehicle(id)
            if (car && car.state === RtVehicleState.driving && !car.stopped && car.breakdownTicks === 0) return true
        }
    }
    return false
}

/** A held train counts its wait; past the limit it turns round. */
function waitAt(world: RtWorld, vehicle: RtVehicle, limit: number): void {
    vehicle.speed = 0
    vehicle.subspeed = 0
    vehicle.waitTicks++
    if (limit > 0 && vehicle.waitTicks >= limit) rtReverseTrain(world, vehicle)
}

/**
 * Drops the train's tail tiles beyond `keep`. Each tile entry gave up one hold (the head took one per
 * entry, as rebuild does); the reservation stays while the head still stands on that piece.
 */
function trimTail(world: RtWorld, vehicle: RtVehicle, keep: number, dirty: Set<number>): void {
    while (vehicle.tiles.length > keep) {
        const last = vehicle.tiles.length - 1
        const tile = vehicle.tiles[last]!
        const piece = vehicle.pieces[last]! & 7
        const stillOn = vehicle.pieces.some((td, k) => k < last && vehicle.tiles[k] === tile && (td & 7) === piece)
        if (!stillOn) releaseReservation(world.map, vehicle, tile, piece)
        vehicle.tiles.pop()
        vehicle.pieces.pop()
        world.occupied.releasePiece(vehicle.id, tile, piece)
        dirty.add(tile)
    }
}

/** The train drives into a depot: it leaves the track, is serviced and runs its depot order. */
function enterDepot(world: RtWorld, vehicle: RtVehicle, depot: number, dirty: Set<number>): void {
    for (const tile of vehicle.tiles) dirty.add(tile)
    releaseAllFor(world.map, vehicle)
    world.occupied.releaseVehicle(vehicle.id)
    world.occupied.enterDepot(vehicle.id, depot)
    dirty.add(depot)
    const exitTd = rtDepotExitTrackdir(world.map, depot)
    vehicle.state = RtVehicleState.inDepot
    vehicle.tiles = [depot]
    vehicle.pieces = [exitTd >= 0 ? exitTd : vehicle.pieces[0]!]
    vehicle.direction = vehicle.pieces[0]!
    vehicle.progress = 0
    vehicle.speed = 0
    vehicle.subspeed = 0
    vehicle.route = []
    vehicle.routeIndex = 0
    vehicle.reservedEnd = 0
    vehicle.routeTick = RT_NONE
    vehicle.waitTicks = 0
    const parking = vehicle.stopped
    // sent here by sendToDepot: it stops inside until started
    const halt = vehicle.haltInDepot
    vehicle.haltInDepot = false
    rtServiceInDepot(world, vehicle, depot, world.tick)
    const order = rtCurrentOrder(vehicle)
    if (order && order.kind === RtOrderKind.gotoDepot && order.target === depot) advanceOrder(vehicle, world.stations, world.map)
    if (parking || halt) vehicle.stopped = true
}

/** The speed loss of entering a piece from another: a 45-degree turn, a 90-degree turn, a climb. */
function entrySpeed(world: RtWorld, vehicle: RtVehicle, from: number, fromTd: number, to: number, toTd: number): void {
    const turn = (rtTrackdirDirection(toTd) - rtTrackdirDirection(fromTd) + 8) & 7
    const sharp = turn === 2 || turn === 6
    const slight = turn === 1 || turn === 7
    if (sharp) vehicle.speed -= (vehicle.speed * M.curveLargeLoss) >> 8
    else if (slight) vehicle.speed -= (vehicle.speed * M.curveSmallLoss) >> 8
    const rise = world.map.tileHeight(to) - world.map.tileHeight(from)
    if (rise > 0) vehicle.speed -= (vehicle.speed * M.slopeUpLoss) >> 8
    else if (rise < 0) vehicle.speed += M.slopeDownGain
    vehicle.speed = Math.max(0, Math.min(vehicle.speed, rtConsistMaxSpeed(vehicle.consist)))
}

const enum Enter { entered, held, depot }

/**
 * The head stands at its tile's edge: enter the next tile if it may. A refusal
 * leaves the train where it is, counting its wait, and may turn it round.
 */
function tryEnter(world: RtWorld, vehicle: RtVehicle, dirty: Set<number>): Enter {
    const map = world.map
    const head = vehicle.tiles[0]!
    const { next, bits } = ahead(world, vehicle)
    if (bits === 0) {
        // the end of the line: a parking train parks on its spot, any other turns round
        if (vehicle.state === RtVehicleState.parking && map.kind[head] === RtTileKind.rail && rtIsSiding(map.payload[head]!)) {
            vehicle.state = RtVehicleState.parked
            vehicle.speed = 0
            vehicle.subspeed = 0
            rtReleaseAhead(map, vehicle)
            return Enter.held
        }
        rtReverseTrain(world, vehicle)
        return Enter.held
    }
    const station = targetStation(vehicle)
    let { td, fromRoute } = chooseTrackdir(vehicle, bits)
    if (station !== RT_NONE && isPlatformOf(map, head, station) && !(isPlatformOf(map, next, station))) {
        vehicle.state = RtVehicleState.loading
        vehicle.loadingStation = station
        vehicle.speed = 0
        vehicle.subspeed = 0
        vehicle.waitTicks = 0
        return Enter.held
    }

    // another company's train on the piece ahead: wait as at red; after the two-way wait the higher id turns round
    const blockers = trainsAcross(world, next, td & 7, vehicle.id)
    const foreign = blockers.find(id => world.vehicle(id)?.owner !== vehicle.owner)
    if (foreign !== undefined) {
        waitAt(world, vehicle, vehicle.id > foreign ? SIG.twoWaySignalWaitTicks : 0)
        return Enter.held
    }
    if (roadVehicleCrossing(world, next)) {
        waitAt(world, vehicle, 0)
        return Enter.held
    }

    const trainOnPiece = trainOnPieceOf(world)
    const reserved = vehicle.routeIndex < vehicle.reservedEnd
    if (rtSignalOnTrackdir(map, next, td)) {
        if (rtSignalTypeAt(map, next, td & 7) === RtSignalType.path) {
            if (!reserved && reservePath(map, vehicle, vehicle.route, vehicle.routeIndex, trainOnPiece, world.settings.sharing) === 0) {
                waitAt(world, vehicle, SIG.pathWaitTicks)
                return Enter.held
            }
        } else if (!rtSignalGreen(map, next, td)) {
            const twoWay = rtSignalOnTrackdir(map, next, td ^ 8)
            waitAt(world, vehicle, twoWay ? SIG.twoWaySignalWaitTicks : 0)
            return Enter.held
        }
    } else if (!reserved && blockHasPathSignal(map, next, td, world.settings.sharing)) {
        if (reservePath(map, vehicle, vehicle.route, vehicle.routeIndex, trainOnPiece, world.settings.sharing) === 0) {
            waitAt(world, vehicle, SIG.pathWaitTicks)
            return Enter.held
        }
    }
    // a reservation walk may have extended the route: follow it
    const planned = vehicle.route[vehicle.routeIndex]
    if (planned !== undefined && (bits & (1 << planned)) !== 0) {
        td = planned
        fromRoute = true
    }

    const fromTd = vehicle.pieces[0]!
    const piece = td & 7
    vehicle.tiles.unshift(next)
    vehicle.pieces.unshift(td)
    vehicle.direction = td
    if (fromRoute) vehicle.routeIndex++
    vehicle.waitTicks = 0
    world.occupied.holdPiece(vehicle.id, next, piece)
    rtSetPieceReserved(map, next, piece, true)
    dirty.add(next)
    if (rtSignalOnTrackdir(map, next, td) && rtSignalTypeAt(map, next, piece) === RtSignalType.path) {
        if (rtSetSignalAspect(map, next, td, false)) dirty.add(next)
    }
    entrySpeed(world, vehicle, head, fromTd, next, td)

    const owner = map.owner[next]!
    if (owner !== vehicle.owner) chargeSharing(world, vehicle.owner, owner, railSharingFee(world), 'rail')

    if (map.kind[next] === RtTileKind.rail && rtIsCrossing(map.payload[next]!)) {
        let hit = false
        for (let lane = 0; lane < 4; lane++) {
            for (const id of [...world.occupied.roadVehiclesInLane(next, lane)]) {
                const car = world.vehicle(id)
                if (car && car.state !== RtVehicleState.crashed) {
                    rtCrashVehicle(world, car)
                    hit = true
                }
            }
        }
        // a crossing without barriers (inspector.ts): hitting a road vehicle there may derail the train
        const rules = RT_CATALOG.inspector
        if (hit && rtIsForeignCrossing(map, next) && world.rng.randomRatio(rules.derailNumerator, rules.derailDenominator)) rtCrashVehicle(world, vehicle)
    }
    for (const id of trainsAcross(world, next, piece, vehicle.id)) {
        const other = world.vehicle(id)
        if (other && other.owner === vehicle.owner) {
            rtCrashVehicle(world, other)
            rtCrashVehicle(world, vehicle)
        }
    }
    if (vehicle.state === RtVehicleState.crashed) return Enter.held

    if (map.kind[next] === RtTileKind.depot) {
        enterDepot(world, vehicle, next, dirty)
        return Enter.depot
    }
    trimTail(world, vehicle, rtConsistLengthTiles(vehicle.consist) + 1, dirty)
    if (vehicle.routeIndex > 256 && vehicle.routeIndex >= vehicle.reservedEnd) {
        const cut = vehicle.routeIndex
        vehicle.route.splice(0, cut)
        vehicle.routeIndex = 0
        vehicle.reservedEnd = 0
    }
    return Enter.entered
}

/** A started train leaves its depot through the entrance once the piece outside is free. */
function leaveDepot(world: RtWorld, vehicle: RtVehicle, dirty: Set<number>): void {
    const map = world.map
    const depot = vehicle.tiles[0]!
    const exitTd = rtDepotExitTrackdir(map, depot)
    if (exitTd < 0) return
    vehicle.tiles = [depot]
    vehicle.pieces = [exitTd]
    vehicle.direction = exitTd
    const { next, bits } = ahead(world, vehicle)
    if (bits === 0) return
    const { td } = chooseTrackdir(vehicle, bits)
    if (trainsAcross(world, next, td & 7, vehicle.id).length > 0) return
    // the depot works as a block signal; into a path block, the reservation in tryEnter decides instead
    const sharing = world.settings.sharing
    if (!blockHasPathSignal(map, next, td, sharing) && rtDepotBlockOccupied(map, depot, trainOnPieceOf(world), sharing)) return
    world.occupied.leaveDepot(vehicle.id, depot)
    world.occupied.holdPiece(vehicle.id, depot, exitTd & 7)
    rtSetPieceReserved(map, depot, exitTd & 7, true)
    vehicle.state = RtVehicleState.driving
    vehicle.progress = rtPieceLength(exitTd)
    const outcome = tryEnter(world, vehicle, dirty)
    // the head starts at the beginning of the tile outside, as after any entry in stepTrain
    if (outcome === Enter.entered) vehicle.progress = 0
    if (outcome === Enter.held && vehicle.state === RtVehicleState.driving && vehicle.tiles.length === 1) {
        // still blocked at the door: back inside
        world.occupied.releasePiece(vehicle.id, depot, exitTd & 7)
        rtSetPieceReserved(map, depot, exitTd & 7, false)
        world.occupied.enterDepot(vehicle.id, depot)
        vehicle.state = RtVehicleState.inDepot
        vehicle.progress = 0
    }
    dirty.add(depot)
}

function stateOf(vehicle: RtVehicle): RtVehicleState {
    return vehicle.state
}

/**
 * Speed for this tick: accelerate toward the model's top speed, or slow down for a stop at the tile
 * end (original acceleration). On or just before a foreign crossing (inspector.ts), which has no
 * barriers, the train holds at most the inspector's crossingSpeed but never stops for it.
 */
function updateSpeed(world: RtWorld, vehicle: RtVehicle): void {
    let limit = rtConsistMaxSpeed(vehicle.consist)
    const { next, bits } = ahead(world, vehicle)
    if (rtIsForeignCrossing(world.map, vehicle.tiles[0]!) || (bits !== 0 && rtIsForeignCrossing(world.map, next))) {
        limit = Math.min(limit, RT_CATALOG.inspector.crossingSpeed)
    }
    if (stopsAtTileEnd(world, vehicle, next, bits)) {
        const remaining = rtPieceLength(vehicle.pieces[0]!) - vehicle.progress
        limit = Math.min(limit, Math.max(4, Math.floor(remaining / 24)))
    }
    if (vehicle.speed > limit) {
        vehicle.speed = limit
        vehicle.subspeed = 0
        return
    }
    const weight = Math.max(1, rtConsistWeight(vehicle.consist))
    const accel = Math.max(1, Math.min(M.trainAccelMax, Math.floor(rtConsistPower(vehicle.consist) * M.trainAccelPowerFactor / weight)))
    const sub = vehicle.subspeed + accel * M.trainMovesPerTick
    vehicle.speed += sub >> M.speedFracBits
    vehicle.subspeed = sub & ((1 << M.speedFracBits) - 1)
    if (vehicle.speed >= limit) {
        vehicle.speed = limit
        vehicle.subspeed = 0
    }
}

/**
 * One tick of one train. RtWorld.step calls it for every train in id order, starting at
 * the round-robin cursor, then removes the train when `remove` is set (rtRemoveTrain).
 */
export function stepTrain(world: RtWorld, vehicle: RtVehicle, hooks?: RtTrainHooks): RtTrainStepResult {
    const result: RtTrainStepResult = { remove: false, searched: false }
    if (vehicle.kind !== RtVehicleKind.rail || vehicle.tiles.length === 0 || vehicle.tiles.length !== vehicle.pieces.length) return result
    if (vehicle.state === RtVehicleState.crashed) {
        vehicle.crashTicks = Math.max(0, vehicle.crashTicks - 1)
        result.remove = vehicle.crashTicks === 0
        return result
    }
    rtCountRunningTick(vehicle)
    if (rtBreakdownTick(vehicle)) return result

    // the stop and start orders: a running train goes parking, a started one drives again
    if (vehicle.stopped && (vehicle.state === RtVehicleState.driving || vehicle.state === RtVehicleState.loading)) {
        vehicle.state = RtVehicleState.parking
        vehicle.loadingStation = RT_NONE
        vehicle.lostRetryTick = RT_NONE
        if (vehicle.routeIndex >= vehicle.reservedEnd) vehicle.routeTick = RT_NONE
    }
    if (!vehicle.stopped && (vehicle.state === RtVehicleState.parking || vehicle.state === RtVehicleState.parked)) {
        vehicle.state = RtVehicleState.driving
        vehicle.routeTick = RT_NONE
        vehicle.lostRetryTick = RT_NONE
    }
    if (vehicle.state === RtVehicleState.parked) return result

    const dirty = new Set<number>()
    if (vehicle.state === RtVehicleState.inDepot) {
        if (vehicle.stopped) return result
        result.searched = plan(world, vehicle)
        leaveDepot(world, vehicle, dirty)
        if (dirty.size > 0) refreshSignals(world, dirty)
        return result
    }
    if (vehicle.state === RtVehicleState.loading) {
        const done = hooks?.loadStep ? hooks.loadStep(world, vehicle) : true
        if (done) {
            // loadingStation stays until the train is off the platform (justLeft)
            vehicle.state = RtVehicleState.driving
            advanceOrder(vehicle, world.stations, world.map)
            vehicle.routeTick = RT_NONE
        }
        return result
    }

    result.searched = plan(world, vehicle)
    updateSpeed(world, vehicle)
    let budget = vehicle.speed > 0 ? Math.max(1, Math.floor(vehicle.speed * M.advanceNumerator / M.advanceDenominator)) : 0
    for (let guard = 0; guard < 64; guard++) {
        const length = rtPieceLength(vehicle.pieces[0]!)
        if (vehicle.progress < length) {
            const step = Math.min(budget, length - vehicle.progress)
            vehicle.progress += step
            budget -= step
            if (vehicle.progress < length) break
        }
        const outcome = tryEnter(world, vehicle, dirty)
        if (outcome !== Enter.entered) break
        vehicle.progress = 0
        if (budget <= 0) break
    }
    // read through a call: TypeScript narrows vehicle.state from the checks above, but tryEnter changes it
    const after = stateOf(vehicle)
    // a loading train returned above, so loading here means it has just arrived
    if (after === RtVehicleState.loading) hooks?.arrive?.(world, vehicle, vehicle.loadingStation)
    if (after === RtVehicleState.driving || after === RtVehicleState.parking || after === RtVehicleState.parked) {
        const length = rtConsistLengthTiles(vehicle.consist)
        const atEdge = vehicle.progress >= rtPieceLength(vehicle.pieces[0]!)
        trimTail(world, vehicle, atEdge ? length : length + 1, dirty)
        if (vehicle.loadingStation !== RT_NONE && !isPlatformOf(world.map, vehicle.tiles[0]!, vehicle.loadingStation)) {
            vehicle.loadingStation = RT_NONE
            vehicle.routeTick = RT_NONE
        }
    }
    if (dirty.size > 0) refreshSignals(world, dirty)
    return result
}
