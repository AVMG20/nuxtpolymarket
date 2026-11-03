/**
 * Player commands: the only way a company changes the world. Every peer applies the same
 * stamped command stream at the same ticks, so applyCommand is deterministic, never throws and
 * refuses anything the UI could not have produced the same way as an illegal move (Michael,
 * 2026-10-29). The build and vehicle rules (goals 03 to 07) decide what is possible; this layer adds
 * ownership, money, caps, the line and area drags and the signal refresh.
 */

import { clampUtf8, RtBadData, RtReader, RtWriter } from './bytes'
import { RT_CATALOG } from './catalog'
import { demolishTile } from './demolish'
import { buildDepot, rtDepotKind } from './depots'
import { bookMoney, changeLoan } from './economy'
import { rtCountTiles } from './infrastructure'
import { rtRecordCrossings } from './inspector'
import { RT_MAP_SIDES, RtTileKind, type RtDir, type RtMap } from './map'
import { RT_MAX_ORDERS, RT_ORDER_FLAG_MASK, rtReplaceOrders, validateOrders } from './orders'
import { findRailRoute, findRoadRoute, RtRouteOutcome } from './pathfinder'
import { buildRoad, removeRoad } from './road'
import { buildSiding, removeSiding, rtCanReverse } from './sidings'
import { placeSignal, rtReservationHooks, RtSignalType, updateSignalStates, type RtTrainOnPiece } from './signals'
import {
    buildRailStation,
    buildRoadStop,
    RT_MAX_PLATFORM_LENGTH,
    RT_MAX_PLATFORMS,
    RT_ROAD_STOP_SHAPE_MAX,
    RtAxis,
    RtRoadStopShape,
    RtStationTile
} from './stations-build'
import {
    buildRail,
    removeRail,
    RT_ROAD_X,
    RT_ROAD_Y,
    RT_TRACK_COUNT,
    RtBuildError,
    rtRailTilePieces,
    rtTrackdirDirection,
    rtTrackdirExitDir,
    rtTrackdirList,
    rtTrackdirPiece,
    rtTrackdirsEnteringWith,
    rtValidTrackdir,
    type RtBuildResult
} from './track'
import { rtReverseTrain } from './train'
import { RT_NONE, RT_OWNER_NONE, RtOrderKind, RtVehicleKind, RtVehicleState, type RtCompany, type RtFinance, type RtOrder, type RtStation, type RtVehicle } from './types'
import { buyVehicle, sellVehicle } from './vehicles'
import { rtCleanCompanyName, rtNameSkeleton, type RtWorld } from './world'

/** Command kinds. Fixed for protocol version 1 (the encoder writes them as a u8); a new one takes a new value. */
export const RtCommandKind = {
    buildRail: 0,
    buildRailLine: 1,
    removeRail: 2,
    buildRoad: 3,
    buildRoadLine: 4,
    removeRoad: 5,
    buildRailStation: 6,
    buildRoadStop: 7,
    buildDepot: 8,
    placeSignal: 9,
    demolish: 10,
    demolishArea: 11,
    buyVehicle: 12,
    sellVehicle: 13,
    setOrders: 14,
    startStop: 15,
    sendToDepot: 16,
    reverseTrain: 17,
    changeLoan: 18,
    renameCompany: 19,
    buildSiding: 20,
    removeSiding: 21,
    /** Server-only: a player joins a world. decodeClientMsg refuses it from clients. */
    foundCompany: 22
} as const
export type RtCommandKind = typeof RtCommandKind[keyof typeof RtCommandKind]

export type RtCommand =
    | { kind: typeof RtCommandKind.buildRail, tile: number, piece: number }
    /** A drag along a trackdir from tile to endTile, inclusive; diagonal drags alternate the two pieces. */
    | { kind: typeof RtCommandKind.buildRailLine, tile: number, endTile: number, trackdir: number }
    | { kind: typeof RtCommandKind.removeRail, tile: number, piece: number }
    | { kind: typeof RtCommandKind.buildRoad, tile: number, bits: number }
    /** A straight drag from tile to endTile, inclusive, on one row or one column. */
    | { kind: typeof RtCommandKind.buildRoadLine, tile: number, endTile: number }
    | { kind: typeof RtCommandKind.removeRoad, tile: number, bits: number }
    | { kind: typeof RtCommandKind.buildRailStation, tile: number, axis: number, tracks: number, length: number }
    /**
     * A bus or truck stop; shape is an RtRoadStopShape, auto (a drive-through stop along the road there)
     * when left out, as every stop command before bays.
     */
    | { kind: typeof RtCommandKind.buildRoadStop, tile: number, stop: number, shape?: number }
    | { kind: typeof RtCommandKind.buildDepot, tile: number, vehicleKind: number, facing: number }
    | { kind: typeof RtCommandKind.placeSignal, tile: number, piece: number, signalType: number }
    | { kind: typeof RtCommandKind.demolish, tile: number }
    /** The rectangle with corners tile and endTile, inclusive, walked row by row. */
    | { kind: typeof RtCommandKind.demolishArea, tile: number, endTile: number }
    | { kind: typeof RtCommandKind.buyVehicle, depot: number, model: number, wagons: number[] }
    | { kind: typeof RtCommandKind.sellVehicle, vehicle: number }
    | { kind: typeof RtCommandKind.setOrders, vehicle: number, orders: RtOrder[] }
    /** Sets the vehicle stopped or started; refused when it already is. */
    | { kind: typeof RtCommandKind.startStop, vehicle: number, stopped: boolean }
    /** Sends the vehicle to its nearest own depot to stop there, or cancels that when already sent. */
    | { kind: typeof RtCommandKind.sendToDepot, vehicle: number }
    | { kind: typeof RtCommandKind.reverseTrain, vehicle: number }
    /** Loan steps: positive borrows, negative repays. */
    | { kind: typeof RtCommandKind.changeLoan, steps: number }
    | { kind: typeof RtCommandKind.renameCompany, name: string }
    | { kind: typeof RtCommandKind.buildSiding, tile: number }
    | { kind: typeof RtCommandKind.removeSiding, tile: number }
    | { kind: typeof RtCommandKind.foundCompany, name: string, colour: number }

/**
 * Why a command was refused: the build rule codes (RtBuildError, 0 to 9) and the command layer's
 * own. The room sends the code to the sender only (protocol result).
 */
export const RtCommandError = {
    ...RtBuildError,
    /** The company cannot pay for it (cash, which includes the loan). */
    money: 10,
    /** The acting company does not exist, or the command is not one it may issue. */
    noCompany: 11,
    /** validateOrders refused the list; detail holds its RtOrderError. */
    orders: 12,
    /** changeLoan refused; detail holds its RtLoanError. */
    loan: 13,
    /** No own depot of the vehicle's kind can be reached. */
    noDepot: 14,
    /** The vehicle is not in a state where that button is shown. */
    state: 15
} as const
export type RtCommandError = typeof RtCommandError[keyof typeof RtCommandError]

/** ok with the signed cost (a refund negative) and the id made: the company, the vehicle, or the station built or joined. */
export type RtCommandResult =
    | { ok: true, cost: number, id?: number }
    | { ok: false, error: RtCommandError, detail?: number }

/** The company id stamped on a server-issued command (the protocol's 255). */
export const RT_SERVER_COMPANY = RT_OWNER_NONE

const ok = (cost: number, id?: number): RtCommandResult => (id === undefined ? { ok: true, cost } : { ok: true, cost, id })
const fail = (error: RtCommandError, detail?: number): RtCommandResult => (detail === undefined ? { ok: false, error } : { ok: false, error, detail })

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

/** What one command did: tiles whose rail, signals, platforms or depots changed, for the signal refresh. */
interface Touched {
    tiles: Set<number>
}

function trainOnPieceOf(world: RtWorld): RtTrainOnPiece {
    return (tile, piece, except) => world.occupied.otherTrainOnPiece(tile, piece, except) !== RT_NONE
}

const vehicleOn = (world: RtWorld) => (tile: number) => world.occupied.vehicleOnTile(tile)

function reservationHooks(world: RtWorld) {
    return rtReservationHooks(world.map, world.vehicles, trainOnPieceOf(world), world.settings.sharing)
}

/**
 * Runs a station rule against the dense station list the rules take, then mirrors what it did into
 * the world's id-indexed list: a station it created is inserted, one it deleted is removed.
 */
function withStations<T>(world: RtWorld, rule: (list: RtStation[]) => T): T {
    const list = world.stationList()
    const before = new Set(list.map(station => station.id))
    const result = rule(list)
    const after = new Set<number>()
    for (const station of list) {
        after.add(station.id)
        if (!before.has(station.id)) world.insertStation(station)
    }
    for (const id of before) if (!after.has(id)) world.removeStation(id)
    return result
}

/**
 * One build step: the rule validated first, the cost checked against cash, then the rule applied
 * and the cost booked under `category`. `spent` is what earlier steps of the same command cost, so
 * a drag stops at the first tile it cannot pay for; applied steps have already left the cash, so
 * only a validation counts it.
 */
function step(
    company: RtCompany, apply: boolean, spent: number, category: keyof RtFinance, rule: (apply: boolean) => RtBuildResult
): RtCommandResult {
    const check = rule(false)
    if (!check.ok) return fail(check.error)
    if (check.cost > 0 && company.money - (apply ? 0 : spent) < check.cost) return fail(RtCommandError.money)
    if (!apply) return ok(check.cost, check.station)
    const done = rule(true)
    if (!done.ok) return fail(done.error)
    bookMoney(company, category, -done.cost)
    return ok(done.cost, done.station)
}

/** A single-tile build or removal. */
function single(company: RtCompany, apply: boolean, touched: Touched, tiles: number[], rule: (apply: boolean) => RtBuildResult): RtCommandResult {
    const result = step(company, apply, 0, 'construction', rule)
    if (result.ok && apply) for (const tile of tiles) touched.tiles.add(tile)
    return result
}

/** The most tiles one rail or road line command covers on this map. */
export function rtLineMaxTiles(map: RtMap): number {
    return Math.min(map.side, RT_CATALOG.caps.lineMaxTiles)
}

/**
 * The pieces a rail drag lays from tile along trackdir, straight or diagonal (a diagonal alternates
 * two pieces), up to maxTiles or the map edge. The line command and the client's rail tool
 * both walk it, so a preview covers exactly what the command builds.
 */
export function rtRailLineWalk(map: RtMap, tile: number, trackdir: number, maxTiles: number): { tile: number, piece: number }[] {
    const out: { tile: number, piece: number }[] = []
    if (!map.validTile(tile) || !rtValidTrackdir(trackdir)) return out
    const direction = rtTrackdirDirection(trackdir)
    let here = tile
    let td = trackdir
    for (;;) {
        out.push({ tile: here, piece: rtTrackdirPiece(td) })
        if (out.length >= maxTiles) return out
        const exit = rtTrackdirExitDir(td)
        const next = map.neighbour(here, exit)
        if (!map.validTile(next)) return out
        const onward = rtTrackdirList(rtTrackdirsEnteringWith(exit)).find(t => rtTrackdirDirection(t) === direction)
        if (onward === undefined) return out
        here = next
        td = onward
    }
}

/** Tiles of a rail drag: from tile along trackdir until endTile, or null when it never gets there. */
function railLineTiles(world: RtWorld, tile: number, endTile: number, trackdir: number): { tile: number, piece: number }[] | null {
    const map = world.map
    if (!map.validTile(tile) || !map.validTile(endTile) || !rtValidTrackdir(trackdir)) return null
    const walk = rtRailLineWalk(map, tile, trackdir, rtLineMaxTiles(map))
    const at = walk.findIndex(step => step.tile === endTile)
    return at < 0 ? null : walk.slice(0, at + 1)
}

/** Tiles of a straight road drag, or null when the ends share no row or column or it is too long. */
function roadLineTiles(world: RtWorld, tile: number, endTile: number): { tiles: number[], alongX: boolean } | null {
    const map = world.map
    if (!map.validTile(tile) || !map.validTile(endTile)) return null
    const [x0, y0, x1, y1] = [map.tileX(tile), map.tileY(tile), map.tileX(endTile), map.tileY(endTile)]
    if (x0 !== x1 && y0 !== y1) return null
    const alongX = y0 === y1 && x0 !== x1
    const count = Math.abs(x1 - x0) + Math.abs(y1 - y0) + 1
    if (count > rtLineMaxTiles(map)) return null
    const tiles: number[] = []
    const dx = Math.sign(x1 - x0)
    const dy = Math.sign(y1 - y0)
    for (let k = 0; k < count; k++) tiles.push(map.idx(x0 + dx * k, y0 + dy * k))
    return { tiles, alongX }
}

/**
 * Walks a drag's steps in order, stopping at the first refusal or unaffordable step and keeping what
 * was done. A step answering alreadyBuilt counts as done at no cost. The drag succeeds when
 * at least one step did something; otherwise it returns the first refusal.
 */
function drag(company: RtCompany, apply: boolean, touched: Touched, steps: { tiles: number[], rule: (apply: boolean) => RtBuildResult }[]): RtCommandResult {
    let spent = 0
    let did = false
    let first: RtCommandResult | null = null
    for (const { tiles, rule } of steps) {
        const result = step(company, apply, spent, 'construction', rule)
        if (!result.ok) {
            if (result.error === RtCommandError.alreadyBuilt) {
                first ??= result
                continue
            }
            if (!did) return result
            break
        }
        spent += result.cost
        did = true
        if (apply) for (const tile of tiles) touched.tiles.add(tile)
    }
    return did ? ok(spent) : first ?? fail(RtCommandError.invalid)
}

/** The steps that clear one tile of an area for `owner` (own rail pieces, own road bits, or the bulldozer). */
function clearSteps(world: RtWorld, owner: number, tile: number): { tiles: number[], rule: (apply: boolean) => RtBuildResult }[] {
    const map = world.map
    const occupied = vehicleOn(world)
    const kind = map.kind[tile]
    if (kind === RtTileKind.rail && map.owner[tile] === owner) {
        const pieces = rtRailTilePieces(map, tile)
        const steps = []
        for (let piece = 0; piece < RT_TRACK_COUNT; piece++) {
            if ((pieces & (1 << piece)) === 0) continue
            steps.push({ tiles: [tile], rule: (apply: boolean) => removeRail(map, owner, tile, piece, occupied, apply, reservationHooks(world)) })
        }
        return steps
    }
    if (kind === RtTileKind.road && map.owner[tile] === owner) {
        return [{ tiles: [tile], rule: (apply: boolean) => removeRoad(map, owner, tile, map.payload[tile]! & 15, occupied, apply) }]
    }
    return [{
        tiles: [tile],
        rule: (apply: boolean) => withStations(world, list => demolishTile(map, list, owner, tile, occupied, apply, {
            vehicles: world.vehicleList(),
            reservations: reservationHooks(world)
        }))
    }]
}

/** The tiles of an area drag, row by row, or null beyond areaMaxTiles a side. */
function areaTiles(world: RtWorld, tile: number, endTile: number): number[] | null {
    const map = world.map
    if (!map.validTile(tile) || !map.validTile(endTile)) return null
    const [xa, ya, xb, yb] = [map.tileX(tile), map.tileY(tile), map.tileX(endTile), map.tileY(endTile)]
    const [x0, x1, y0, y1] = [Math.min(xa, xb), Math.max(xa, xb), Math.min(ya, yb), Math.max(ya, yb)]
    const max = RT_CATALOG.caps.areaMaxTiles
    if (x1 - x0 + 1 > max || y1 - y0 + 1 > max) return null
    const out: number[] = []
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(map.idx(x, y))
    return out
}

/** The footprint of a rail station, for the signal refresh and the station tool's preview. */
export function rtStationFootprint(map: RtMap, origin: number, axis: number, tracks: number, length: number): number[] {
    const out: number[] = []
    if (!map.validTile(origin) || !isInt(tracks) || !isInt(length)) return out
    const [x, y] = [map.tileX(origin), map.tileY(origin)]
    for (let t = 0; t < Math.min(tracks, 8); t++) {
        for (let l = 0; l < Math.min(length, 16); l++) {
            const [tx, ty] = axis === RtAxis.x ? [x + l, y + t] : [x + t, y + l]
            if (map.inBounds(tx, ty)) out.push(map.idx(tx, ty))
        }
    }
    return out
}

/** Whether every tile the train holds is the company's own: only then may it be stopped there. */
function onOwnTrack(world: RtWorld, vehicle: RtVehicle): boolean {
    for (const tile of vehicle.tiles) if (world.map.owner[tile] !== vehicle.owner) return false
    return true
}

/**
 * The nearest own depot of the vehicle's kind it can reach, by the movers' own pathfinder within one
 * search budget, or RT_NONE. Another company's depot is never a target: a foreign vehicle
 * must never be able to stand in a depot and block its demolition. A train searches behind
 * itself too, moving or not, and `reverse` says the depot found lies that way: the original turns the
 * train round when it is sent to a depot behind it.
 */
function nearestOwnDepot(world: RtWorld, vehicle: RtVehicle): { depot: number, reverse: boolean } {
    const none = { depot: RT_NONE, reverse: false }
    const map = world.map
    const depots: number[] = []
    for (let tile = 0; tile < map.side * map.side; tile++) {
        if (map.kind[tile] !== RtTileKind.depot || map.owner[tile] !== vehicle.owner) continue
        if (rtDepotKind(map.payload[tile]!) === vehicle.kind) depots.push(tile)
    }
    if (depots.length === 0 || vehicle.tiles.length === 0) return none
    const budget = RT_CATALOG.pathfinder.maxSearchNodes
    const head = vehicle.tiles[0]!
    if (vehicle.kind === RtVehicleKind.rail) {
        const tail = vehicle.tiles[vehicle.tiles.length - 1]!
        const reverseFrom = rtCanReverse(world, vehicle, true) ? { tile: tail, trackdir: vehicle.pieces[vehicle.pieces.length - 1]! } : null
        const found = findRailRoute(map, vehicle.owner, head, vehicle.pieces[0]!, { tiles: depots }, budget, budget, { sharing: world.settings.sharing, reverseFrom })
        return found.outcome === RtRouteOutcome.found ? { depot: found.goal, reverse: found.reverse } : none
    }
    const found = findRoadRoute(map, head, vehicle.pieces[0]!, { tiles: depots }, budget, budget)
    return found.outcome === RtRouteOutcome.found ? { depot: found.goal, reverse: false } : none
}

/** The acting company's own live vehicle, or the refusal. */
function ownVehicle(world: RtWorld, owner: number, id: unknown): RtVehicle | RtCommandResult {
    if (!isInt(id) || id < 0) return fail(RtCommandError.invalid)
    const vehicle = world.vehicle(id)
    if (!vehicle) return fail(RtCommandError.invalid)
    if (vehicle.owner !== owner) return fail(RtCommandError.notOwner)
    if (vehicle.state === RtVehicleState.crashed) return fail(RtCommandError.state)
    return vehicle
}

const isVehicle = (value: RtVehicle | RtCommandResult): value is RtVehicle => !('ok' in value)

function vehicleCommand(world: RtWorld, company: RtCompany, command: RtCommand, apply: boolean, touched: Touched): RtCommandResult {
    const owner = company.id
    const map = world.map
    switch (command.kind) {
        case RtCommandKind.buyVehicle: {
            const check = buyVehicle(world, owner, command.depot, command.model, command.wagons, false)
            if (!check.ok) return fail(check.error)
            if (company.money < check.cost) return fail(RtCommandError.money)
            if (!apply) return ok(check.cost, check.vehicle)
            const done = buyVehicle(world, owner, command.depot, command.model, command.wagons, true)
            if (!done.ok) return fail(done.error)
            bookMoney(company, 'newVehicles', -done.cost)
            return ok(done.cost, done.vehicle)
        }
        case RtCommandKind.sellVehicle: {
            const vehicle = ownVehicle(world, owner, command.vehicle)
            if (!isVehicle(vehicle)) return vehicle
            const check = sellVehicle(world, owner, vehicle.id, false)
            if (!check.ok) return fail(check.error)
            if (!apply) return ok(check.cost)
            const depot = vehicle.tiles[0]
            const done = sellVehicle(world, owner, vehicle.id, true)
            if (!done.ok) return fail(done.error)
            bookMoney(company, 'newVehicles', -done.cost)
            if (depot !== undefined) touched.tiles.add(depot)
            return ok(done.cost)
        }
        case RtCommandKind.setOrders: {
            const vehicle = ownVehicle(world, owner, command.vehicle)
            if (!isVehicle(vehicle)) return vehicle
            const checked = validateOrders(command.orders, world.stations, map, owner, world.settings.sharing, vehicle)
            if (!checked.ok) return fail(RtCommandError.orders, checked.error)
            if (apply) rtReplaceOrders(vehicle, checked.orders)
            return ok(0)
        }
        case RtCommandKind.startStop: {
            const vehicle = ownVehicle(world, owner, command.vehicle)
            if (!isVehicle(vehicle)) return vehicle
            if (typeof command.stopped !== 'boolean' || command.stopped === vehicle.stopped) return fail(RtCommandError.state)
            // a train is parked only on its own network; in a depot it simply stops
            if (command.stopped && vehicle.kind === RtVehicleKind.rail && vehicle.state !== RtVehicleState.inDepot && !onOwnTrack(world, vehicle)) {
                return fail(RtCommandError.notOwner)
            }
            if (apply) vehicle.stopped = command.stopped
            return ok(0)
        }
        case RtCommandKind.sendToDepot: {
            const vehicle = ownVehicle(world, owner, command.vehicle)
            if (!isVehicle(vehicle)) return vehicle
            if (vehicle.state === RtVehicleState.inDepot) return fail(RtCommandError.state)
            if (vehicle.haltInDepot) {
                if (apply) {
                    vehicle.haltInDepot = false
                    vehicle.serviceDepot = RT_NONE
                    vehicle.routeTick = RT_NONE
                }
                return ok(0)
            }
            const { depot, reverse } = nearestOwnDepot(world, vehicle)
            if (depot === RT_NONE) return fail(RtCommandError.noDepot)
            if (apply) {
                if (reverse) {
                    for (const tile of vehicle.tiles) touched.tiles.add(tile)
                    rtReverseTrain(world, vehicle)
                }
                vehicle.serviceDepot = depot
                vehicle.haltInDepot = true
                vehicle.stopped = false
                vehicle.routeTick = RT_NONE
            }
            return ok(0)
        }
        case RtCommandKind.reverseTrain: {
            const vehicle = ownVehicle(world, owner, command.vehicle)
            if (!isVehicle(vehicle)) return vehicle
            if (vehicle.kind !== RtVehicleKind.rail || vehicle.state === RtVehicleState.inDepot || vehicle.tiles.length === 0) {
                return fail(RtCommandError.state)
            }
            if (apply) {
                const before = [...vehicle.tiles]
                rtReverseTrain(world, vehicle)
                for (const tile of before) touched.tiles.add(tile)
            }
            return ok(0)
        }
        default:
            return fail(RtCommandError.invalid)
    }
}

function buildCommand(world: RtWorld, company: RtCompany, command: RtCommand, apply: boolean, touched: Touched): RtCommandResult {
    const owner = company.id
    const map = world.map
    const occupied = vehicleOn(world)
    switch (command.kind) {
        case RtCommandKind.buildRail:
            return single(company, apply, touched, [command.tile], a => buildRail(map, owner, command.tile, command.piece, a, occupied))
        case RtCommandKind.removeRail:
            return single(company, apply, touched, [command.tile], a => removeRail(map, owner, command.tile, command.piece, occupied, a, reservationHooks(world)))
        case RtCommandKind.buildRoad:
            return single(company, apply, touched, [command.tile], a => buildRoad(map, owner, command.tile, command.bits, a, occupied))
        case RtCommandKind.removeRoad:
            return single(company, apply, touched, [command.tile], a => removeRoad(map, owner, command.tile, command.bits, occupied, a))
        case RtCommandKind.placeSignal:
            return single(company, apply, touched, [command.tile], a => placeSignal(map, owner, command.tile, command.piece, command.signalType, a))
        case RtCommandKind.buildSiding:
            return single(company, apply, touched, [command.tile], a => buildSiding(map, owner, command.tile, a))
        case RtCommandKind.removeSiding:
            return single(company, apply, touched, [command.tile], a => removeSiding(map, owner, command.tile, a))
        case RtCommandKind.buildDepot: {
            const front = map.validTile(command.tile) && isInt(command.facing) ? map.neighbour(command.tile, (command.facing & 3) as RtDir) : RT_NONE
            const tiles = map.validTile(front) ? [command.tile, front] : [command.tile]
            return single(company, apply, touched, tiles, a => buildDepot(map, owner, command.tile, command.vehicleKind, command.facing, a))
        }
        case RtCommandKind.buildRailStation: {
            const tiles = rtStationFootprint(map, command.tile, command.axis, command.tracks, command.length)
            const result = single(company, apply, touched, tiles, a => withStations(world, list =>
                buildRailStation(map, list, world.townList(), owner, command.tile, command.axis, command.tracks, command.length, a, occupied)))
            return result
        }
        case RtCommandKind.buildRoadStop: {
            if (command.stop !== RtStationTile.bus && command.stop !== RtStationTile.truck) return fail(RtCommandError.invalid)
            const shape = command.shape ?? RtRoadStopShape.auto
            if (!isInt(shape) || shape < 0 || shape > RT_ROAD_STOP_SHAPE_MAX) return fail(RtCommandError.invalid)
            return single(company, apply, touched, roadStopTiles(map, command.tile), a => withStations(world, list =>
                buildRoadStop(map, list, world.townList(), owner, command.tile, command.stop, a, occupied, shape)))
        }
        case RtCommandKind.demolish:
            if (!map.validTile(command.tile)) return fail(RtCommandError.invalid)
            return drag(company, apply, touched, clearSteps(world, owner, command.tile))
        case RtCommandKind.demolishArea: {
            const tiles = areaTiles(world, command.tile, command.endTile)
            if (!tiles) return fail(RtCommandError.invalid)
            return area(world, company, apply, touched, tiles)
        }
        case RtCommandKind.buildRailLine: {
            const line = railLineTiles(world, command.tile, command.endTile, command.trackdir)
            if (!line) return fail(RtCommandError.invalid)
            return drag(company, apply, touched, line.map(({ tile, piece }) => ({ tiles: [tile], rule: (a: boolean) => buildRail(map, owner, tile, piece, a, occupied) })))
        }
        case RtCommandKind.buildRoadLine: {
            const line = roadLineTiles(world, command.tile, command.endTile)
            if (!line) return fail(RtCommandError.invalid)
            const bits = line.alongX ? RT_ROAD_X : RT_ROAD_Y
            const oneTile = line.tiles.length === 1
            return drag(company, apply, touched, line.tiles.map(tile => ({
                tiles: [tile],
                // a one-tile drag builds the straight piece the tile's road already runs along, else x
                rule: (a: boolean) => buildRoad(map, owner, tile, oneTile ? oneTileRoadBits(world, tile) : bits, a, occupied)
            })))
        }
        default:
            return fail(RtCommandError.invalid)
    }
}

function oneTileRoadBits(world: RtWorld, tile: number): number {
    const map = world.map
    const bits = map.kind[tile] === RtTileKind.road ? map.payload[tile]! & 15 : 0
    return (bits & RT_ROAD_Y) !== 0 && (bits & RT_ROAD_X) === 0 ? RT_ROAD_Y : RT_ROAD_X
}

/**
 * demolishArea: every tile row by row, stopping at the first tile that is refused (a foreign
 * tile, a house, a vehicle in the way) or cannot be paid for, keeping what was cleared before it.
 * Empty land counts as cleared.
 */
function area(world: RtWorld, company: RtCompany, apply: boolean, touched: Touched, tiles: number[]): RtCommandResult {
    let spent = 0
    let did = false
    for (const tile of tiles) {
        const steps = clearSteps(world, company.id, tile)
        let refused: RtCommandResult | null = null
        for (const { rule } of steps) {
            const result = step(company, apply, spent, 'construction', rule)
            if (!result.ok) {
                refused = result
                break
            }
            spent += result.cost
        }
        if (refused) return did ? ok(spent) : refused
        did = true
        if (apply) touched.tiles.add(tile)
    }
    return ok(spent)
}

function companyCommand(world: RtWorld, company: RtCompany, command: RtCommand, apply: boolean): RtCommandResult {
    switch (command.kind) {
        case RtCommandKind.changeLoan: {
            if (!isInt(command.steps) || command.steps === 0) return fail(RtCommandError.loan, 0)
            if (!apply) {
                const probe = { ...company }
                const result = changeLoan(probe, command.steps)
                return result.ok ? ok(0) : fail(RtCommandError.loan, result.error)
            }
            const result = changeLoan(company, command.steps)
            return result.ok ? ok(0) : fail(RtCommandError.loan, result.error)
        }
        case RtCommandKind.renameCompany: {
            const name = rtCleanCompanyName(command.name)
            if (name === '') return fail(RtCommandError.invalid)
            const looks = rtNameSkeleton(name)
            for (const other of world.companyList()) {
                if (other.id !== company.id && rtNameSkeleton(other.name) === looks) return fail(RtCommandError.conflict)
            }
            if (apply) company.name = name
            return ok(0)
        }
        default:
            return fail(RtCommandError.invalid)
    }
}

const BUILD_KINDS: ReadonlySet<number> = new Set([
    RtCommandKind.buildRail, RtCommandKind.buildRailLine, RtCommandKind.removeRail, RtCommandKind.buildRoad,
    RtCommandKind.buildRoadLine, RtCommandKind.removeRoad, RtCommandKind.buildRailStation, RtCommandKind.buildRoadStop,
    RtCommandKind.buildDepot, RtCommandKind.placeSignal, RtCommandKind.demolish, RtCommandKind.demolishArea,
    RtCommandKind.buildSiding, RtCommandKind.removeSiding
])
const VEHICLE_KINDS: ReadonlySet<number> = new Set([
    RtCommandKind.buyVehicle, RtCommandKind.sellVehicle, RtCommandKind.setOrders, RtCommandKind.startStop,
    RtCommandKind.sendToDepot, RtCommandKind.reverseTrain
])

/** Every tile a build command can change: the tile, the drag's line or area, a station's footprint. */
function commandTiles(world: RtWorld, command: RtCommand): number[] {
    switch (command.kind) {
        case RtCommandKind.buildRailLine:
            return railLineTiles(world, command.tile, command.endTile, command.trackdir)?.map(step => step.tile) ?? []
        case RtCommandKind.buildRoadLine:
            return roadLineTiles(world, command.tile, command.endTile)?.tiles ?? []
        case RtCommandKind.demolishArea:
            return areaTiles(world, command.tile, command.endTile) ?? []
        case RtCommandKind.buildRailStation:
            return rtStationFootprint(world.map, command.tile, command.axis, command.tracks, command.length)
        case RtCommandKind.buildRoadStop:
            return roadStopTiles(world.map, command.tile)
        default:
            return 'tile' in command ? [command.tile] : []
    }
}

/** A road stop's tile and the four around it, whose road a new stop may join (connectEntrances). */
function roadStopTiles(map: RtMap, tile: number): number[] {
    if (!map.validTile(tile)) return [tile]
    const tiles = [tile]
    for (let dir = 0; dir < 4; dir++) {
        const next = map.neighbour(tile, dir as RtDir)
        if (next >= 0) tiles.push(next)
    }
    return tiles
}

/** Every integer field a build command carries, checked before any rule sees it. */
const TILE_FIELDS = ['tile', 'endTile'] as const
const INT_FIELDS = ['piece', 'trackdir', 'bits', 'axis', 'tracks', 'length', 'stop', 'shape', 'vehicleKind', 'facing', 'signalType'] as const

function wellFormed(world: RtWorld, command: RtCommand): boolean {
    const fields = command as unknown as Record<string, unknown>
    for (const key of TILE_FIELDS) {
        if (key in fields && !(isInt(fields[key]) && world.map.validTile(fields[key]))) return false
    }
    for (const key of INT_FIELDS) {
        if (key in fields && !isInt(fields[key])) return false
    }
    return true
}

/**
 * Applies (or with apply false only validates) one command for companyId. Validation never
 * changes the world, so the room pre-checks with it. A command a company issues needs that
 * company to exist; foundCompany is the server's alone (companyId RT_SERVER_COMPANY). After an
 * applied change to rail, signals, platforms or depots, or a train's removal, the signals of the
 * touched tiles are refreshed before returning, in the same order on every peer. Never
 * throws: a hostile or stale payload is refused like an illegal move.
 */
export function applyCommand(world: RtWorld, companyId: number, command: RtCommand, apply: boolean): RtCommandResult {
    try {
        return applyInner(world, companyId, command, apply === true)
    } catch {
        return fail(RtCommandError.invalid)
    }
}

function applyInner(world: RtWorld, companyId: number, command: RtCommand, apply: boolean): RtCommandResult {
    if (!command || typeof command !== 'object' || !isInt(command.kind)) return fail(RtCommandError.invalid)
    if (command.kind === RtCommandKind.foundCompany) {
        if (companyId !== RT_SERVER_COMPANY) return fail(RtCommandError.noCompany)
        if (world.freeCompanyId() === RT_NONE) return fail(RtCommandError.limit)
        if (!apply) return ok(0)
        const id = world.addCompany(command.name, command.colour)
        return id === null ? fail(RtCommandError.limit) : ok(0, id)
    }
    if (!isInt(companyId)) return fail(RtCommandError.noCompany)
    const company = world.company(companyId)
    if (!company) return fail(RtCommandError.noCompany)
    if (!wellFormed(world, command)) return fail(RtCommandError.invalid)

    const touched: Touched = { tiles: new Set() }
    let result: RtCommandResult
    if (BUILD_KINDS.has(command.kind)) {
        // infrastructure counts follow the build: what its tiles counted before comes off, what they count after goes on
        const tiles = apply ? commandTiles(world, command) : []
        rtCountTiles(world, tiles, -1)
        try {
            result = buildCommand(world, company, command, apply, touched)
        } finally {
            rtCountTiles(world, tiles, 1)
        }
    } else if (VEHICLE_KINDS.has(command.kind)) {
        result = vehicleCommand(world, company, command, apply, touched)
    } else {
        result = companyCommand(world, company, command, apply)
    }

    if (apply && touched.tiles.size > 0) {
        const tiles = [...touched.tiles].sort((a, b) => a - b)
        // a crossing on another company's rail or road is recorded against the builder (inspector.ts)
        if (result.ok && BUILD_KINDS.has(command.kind)) rtRecordCrossings(world, company.id, tiles)
        for (const tile of tiles) world.markDirty(tile)
        updateSignalStates(world.map, trainOnPieceOf(world), tiles, world.settings.sharing)
    }
    return result
}

/* ------------------------------------------------------------------------------------------
 * The command codec. One u8 kind, then the fields at fixed widths: tiles as u32, piece,
 * trackdir, bits and small enums as u8, vehicle ids as u16, loan steps as i16, names as a
 * varint-length UTF-8 string of at most maxNameBytes. Lines and areas are two tiles (and a trackdir),
 * so a drag of any length is one small command. Never JSON.
 * ---------------------------------------------------------------------------------------- */

/** The largest map side (RT_MAP_SIDES); decodeCommand bounds tiles by it when given no side. */
export const RT_COMMAND_MAX_SIDE = RT_MAP_SIDES[RT_MAP_SIDES.length - 1]!

const NAME_BYTES = RT_CATALOG.caps.maxNameBytes
const MAX_WAGONS = RT_CATALOG.vehicles.maxTrainVehicles - 1

/**
 * buildRoadStop's one byte: bits 0-1 the stop type, bits 2-4 the RtRoadStopShape, bits 5-7 zero. A
 * stop command from before bays has shape 0 (auto) there and decodes as it always did.
 */
const ROAD_STOP_TYPE_MASK = 3
const ROAD_STOP_SHAPE_SHIFT = 2

/**
 * Encodes a command. A name is clamped to maxNameBytes first; anything else decodeCommand would
 * refuse throws RangeError, so a peer never sends bytes the others drop.
 */
export function encodeCommand(command: RtCommand): Uint8Array {
    const w = new RtWriter()
    w.u8(command.kind)
    switch (command.kind) {
        case RtCommandKind.buildRail:
        case RtCommandKind.removeRail:
            w.u32(command.tile)
            w.u8(command.piece)
            break
        case RtCommandKind.buildRailLine:
            w.u32(command.tile)
            w.u32(command.endTile)
            w.u8(command.trackdir)
            break
        case RtCommandKind.buildRoad:
        case RtCommandKind.removeRoad:
            w.u32(command.tile)
            w.u8(command.bits)
            break
        case RtCommandKind.buildRoadLine:
        case RtCommandKind.demolishArea:
            w.u32(command.tile)
            w.u32(command.endTile)
            break
        case RtCommandKind.buildRailStation:
            w.u32(command.tile)
            w.u8(command.axis)
            w.u8(command.tracks)
            w.u8(command.length)
            break
        case RtCommandKind.buildRoadStop:
            w.u32(command.tile)
            w.u8(command.stop | ((command.shape ?? RtRoadStopShape.auto) << ROAD_STOP_SHAPE_SHIFT))
            break
        case RtCommandKind.buildDepot:
            w.u32(command.tile)
            w.u8(command.vehicleKind)
            w.u8(command.facing)
            break
        case RtCommandKind.placeSignal:
            w.u32(command.tile)
            w.u8(command.piece)
            w.u8(command.signalType)
            break
        case RtCommandKind.demolish:
        case RtCommandKind.buildSiding:
        case RtCommandKind.removeSiding:
            w.u32(command.tile)
            break
        case RtCommandKind.buyVehicle:
            w.u32(command.depot)
            w.u8(command.model)
            w.u8(command.wagons.length)
            for (const wagon of command.wagons) w.u8(wagon)
            break
        case RtCommandKind.sellVehicle:
        case RtCommandKind.sendToDepot:
        case RtCommandKind.reverseTrain:
            w.u16(command.vehicle)
            break
        case RtCommandKind.setOrders:
            w.u16(command.vehicle)
            w.u8(command.orders.length)
            for (const order of command.orders) {
                w.u8(order.kind)
                w.u32(order.target)
                w.u8(order.flags)
            }
            break
        case RtCommandKind.startStop:
            w.u16(command.vehicle)
            w.u8(command.stopped ? 1 : 0)
            break
        case RtCommandKind.changeLoan:
            w.i16(command.steps)
            break
        case RtCommandKind.renameCompany:
            w.str(clampUtf8(String(command.name), NAME_BYTES))
            break
        case RtCommandKind.foundCompany:
            w.str(clampUtf8(String(command.name), NAME_BYTES))
            w.u8(command.colour)
            break
        default:
            throw new RangeError(`unknown command kind ${(command as { kind: unknown }).kind}`)
    }
    const bytes = w.finish()
    if (decodeCommand(bytes) === null) throw new RangeError(`command ${command.kind} does not decode`)
    return bytes
}

/** A u8 that must be at most `max`. */
function u8Max(r: RtReader, max: number, what: string): number {
    const value = r.u8()
    if (value > max) throw new RtBadData(`${what} ${value} above ${max}`)
    return value
}

/** How far apart two tiles of a map of `side` lie along x and along y. */
function span(a: number, b: number, side: number): { dx: number, dy: number } {
    return { dx: Math.abs((a % side) - (b % side)), dy: Math.abs(Math.floor(a / side) - Math.floor(b / side)) }
}

/**
 * Decodes one command, or null for anything malformed: a short or over-long frame, an unknown kind,
 * a tile at or past side squared, a piece, trackdir, enum or flag out of range, a line longer than
 * lineMaxTiles or a straight one off one row or column, an area wider or taller than areaMaxTiles,
 * more wagons than the longest consist or more orders than RT_MAX_ORDERS, a name past maxNameBytes
 * or a stopped byte other than 0 or 1. `side` is the world's map side (the room and the client know
 * it); without it tiles are bounded by the largest side and the line and area shapes are left to
 * applyCommand, since a tile index alone has no coordinates. Whatever it accepts re-encodes to the
 * same bytes.
 */
export function decodeCommand(bytes: Uint8Array, side?: number): RtCommand | null {
    try {
        if (!(bytes instanceof Uint8Array) || (side !== undefined && !RT_MAP_SIDES.includes(side))) return null
        const r = new RtReader(bytes)
        const command = readCommand(r, side)
        r.end()
        return command
    } catch (e) {
        if (e instanceof RtBadData) return null
        throw e
    }
}

function readCommand(r: RtReader, side: number | undefined): RtCommand {
    const tiles = (side ?? RT_COMMAND_MAX_SIDE) ** 2
    const tile = (what = 'tile'): number => {
        const value = r.u32()
        if (value >= tiles) throw new RtBadData(`${what} ${value} off the map`)
        return value
    }
    const vehicle = (): number => {
        const value = r.u16()
        if (value >= RT_CATALOG.caps.maxVehicles) throw new RtBadData(`vehicle ${value} out of range`)
        return value
    }
    const piece = () => u8Max(r, RT_TRACK_COUNT - 1, 'piece')
    const line = (a: number, b: number, straight: boolean) => {
        if (side === undefined) return
        const { dx, dy } = span(a, b, side)
        if (straight && dx !== 0 && dy !== 0) throw new RtBadData('line off one row or column')
        if (dx + dy + 1 > RT_CATALOG.caps.lineMaxTiles) throw new RtBadData('line too long')
    }
    const kind = r.u8()
    switch (kind) {
        case RtCommandKind.buildRail:
        case RtCommandKind.removeRail:
            return { kind, tile: tile(), piece: piece() }
        case RtCommandKind.buildRailLine: {
            const [from, to] = [tile(), tile('end tile')]
            const trackdir = r.u8()
            if (!rtValidTrackdir(trackdir)) throw new RtBadData(`trackdir ${trackdir}`)
            line(from, to, rtTrackdirPiece(trackdir) < 2)
            return { kind, tile: from, endTile: to, trackdir }
        }
        case RtCommandKind.buildRoad:
        case RtCommandKind.removeRoad: {
            const at = tile()
            const bits = u8Max(r, 15, 'road bits')
            if (bits === 0) throw new RtBadData('no road bits')
            return { kind, tile: at, bits }
        }
        case RtCommandKind.buildRoadLine: {
            const [from, to] = [tile(), tile('end tile')]
            line(from, to, true)
            return { kind, tile: from, endTile: to }
        }
        case RtCommandKind.demolishArea: {
            const [from, to] = [tile(), tile('end tile')]
            if (side !== undefined) {
                const { dx, dy } = span(from, to, side)
                const max = RT_CATALOG.caps.areaMaxTiles
                if (dx + 1 > max || dy + 1 > max) throw new RtBadData('area too large')
            }
            return { kind, tile: from, endTile: to }
        }
        case RtCommandKind.buildRailStation: {
            const at = tile()
            const axis = u8Max(r, RtAxis.y, 'axis')
            const tracks = u8Max(r, RT_MAX_PLATFORMS, 'tracks')
            const length = u8Max(r, RT_MAX_PLATFORM_LENGTH, 'length')
            if (tracks === 0 || length === 0) throw new RtBadData('empty station')
            return { kind, tile: at, axis, tracks, length }
        }
        case RtCommandKind.buildRoadStop: {
            const at = tile()
            const packed = r.u8()
            const stop = packed & ROAD_STOP_TYPE_MASK
            const shape = packed >>> ROAD_STOP_SHAPE_SHIFT
            if (stop === RtStationTile.rail || stop > RtStationTile.truck) throw new RtBadData(`stop ${stop} is no road stop`)
            if (shape > RT_ROAD_STOP_SHAPE_MAX) throw new RtBadData(`road stop shape ${shape}`)
            // a stop without a shape is the old command, byte for byte
            return shape === RtRoadStopShape.auto ? { kind, tile: at, stop } : { kind, tile: at, stop, shape }
        }
        case RtCommandKind.buildDepot:
            return { kind, tile: tile(), vehicleKind: u8Max(r, RtVehicleKind.road, 'vehicle kind'), facing: u8Max(r, 3, 'facing') }
        case RtCommandKind.placeSignal:
            return { kind, tile: tile(), piece: piece(), signalType: u8Max(r, RtSignalType.path, 'signal type') }
        case RtCommandKind.demolish:
        case RtCommandKind.buildSiding:
        case RtCommandKind.removeSiding:
            return { kind, tile: tile() }
        case RtCommandKind.buyVehicle: {
            const depot = tile('depot')
            const model = r.u8()
            const count = u8Max(r, MAX_WAGONS, 'wagon count')
            const wagons: number[] = []
            for (let k = 0; k < count; k++) wagons.push(r.u8())
            return { kind, depot, model, wagons }
        }
        case RtCommandKind.sellVehicle:
        case RtCommandKind.sendToDepot:
        case RtCommandKind.reverseTrain:
            return { kind, vehicle: vehicle() }
        case RtCommandKind.setOrders: {
            const id = vehicle()
            const count = u8Max(r, RT_MAX_ORDERS, 'order count')
            const orders: RtOrder[] = []
            for (let k = 0; k < count; k++) {
                const orderKind = u8Max(r, RtOrderKind.gotoDepot, 'order kind')
                const target = r.u32()
                const limit = orderKind === RtOrderKind.gotoStation ? RT_CATALOG.caps.maxStations : tiles
                if (target >= limit) throw new RtBadData(`order target ${target}`)
                const flags = r.u8()
                if ((flags & ~RT_ORDER_FLAG_MASK) !== 0) throw new RtBadData(`order flags ${flags}`)
                orders.push({ kind: orderKind as RtOrder['kind'], target, flags })
            }
            return { kind, vehicle: id, orders }
        }
        case RtCommandKind.startStop:
            return { kind, vehicle: vehicle(), stopped: u8Max(r, 1, 'stopped') === 1 }
        case RtCommandKind.changeLoan:
            return { kind, steps: r.i16() }
        case RtCommandKind.renameCompany:
            return { kind, name: r.str(NAME_BYTES) }
        case RtCommandKind.foundCompany: {
            const name = r.str(NAME_BYTES)
            const colour = u8Max(r, RT_CATALOG.companies.colours.length - 1, 'colour')
            return { kind, name, colour }
        }
        default:
            throw new RtBadData(`unknown command kind ${kind}`)
    }
}
