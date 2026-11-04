/**
 * Player commands: the only way a company changes the world. Every peer applies the same
 * stamped command stream at the same ticks, so applyCommand is deterministic, never throws and
 * refuses anything the UI could not have produced the same way as an illegal move (Michael,
 * 2026-10-29). The build and vehicle rules decide what is possible; this layer adds
 * ownership, money, caps, the line and area drags and the signal refresh. Each kind has one entry in
 * RULES; its wire form is in command-codec.ts.
 */

import { RT_CATALOG } from './catalog'
import {
    RT_SERVER_COMPANY,
    RtCommandError,
    RtCommandKind,
    type RtCommand,
    type RtCommandOf,
    type RtCommandResult
} from './command-kinds'
import { decodeCommand, encodeCommand, rtLineShape } from './command-codec'
import { rtCleanCompanyName, rtNameSkeleton } from './company-names'
import { demolishTile } from './demolish'
import { buildDepot, rtDepotTiles } from './depots'
import { bookMoney, changeLoan } from './economy'
import { rtCountTiles } from './infrastructure'
import { rtRecordCrossings } from './inspector'
import { RtTileKind, type RtDir, type RtMap } from './map'
import { rtReplaceOrders, validateOrders } from './orders'
import { findRailRoute, findRoadRoute, RtRouteOutcome } from './pathfinder'
import { buildRoad, removeRoad, rtRoadBits } from './road'
import { buildSiding, removeSiding, rtCanReverse } from './sidings'
import { placeSignal, rtReservationHooks, updateSignalStates } from './signals'
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
    rtIsCrossing,
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
import { RT_NONE, RT_OWNER_NONE, RtVehicleKind, RtVehicleState, type RtCompany, type RtFinance, type RtStation, type RtVehicle } from './types'
import { buyVehicle, sellVehicle } from './vehicles'
import type { RtWorld } from './world'

export * from './command-kinds'
export { decodeCommand, encodeCommand, RT_COMMAND_MAX_SIDE } from './command-codec'

const ok = (cost: number, id?: number): RtCommandResult => (id === undefined ? { ok: true, cost } : { ok: true, cost, id })
const fail = (error: RtCommandError, detail?: number): RtCommandResult => (detail === undefined ? { ok: false, error } : { ok: false, error, detail })

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

/** What one command did: tiles whose rail, signals, platforms or depots changed, for the signal refresh. */
interface Touched {
    tiles: Set<number>
}

const vehicleOn = (world: RtWorld) => (tile: number) => world.occupied.vehicleOnTile(tile)

function reservationHooks(world: RtWorld) {
    return rtReservationHooks(world.map, world.vehicles, world.occupied.otherTrainOn, world.settings.sharing)
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
    const shape = rtLineShape(tile, endTile, map.side)
    if (!shape.straight || shape.tiles > rtLineMaxTiles(map)) return null
    const [x0, y0, x1, y1] = [map.tileX(tile), map.tileY(tile), map.tileX(endTile), map.tileY(endTile)]
    const alongX = y0 === y1 && x0 !== x1
    const count = shape.tiles
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
        return [{ tiles: [tile], rule: (apply: boolean) => removeRoad(map, owner, tile, rtRoadBits(map.payload[tile]!), occupied, apply) }]
    }
    return [{
        tiles: [tile],
        rule: (apply: boolean) => withStations(world, list => demolishTile(map, list, owner, tile, occupied, apply, {
            vehicles: world.vehicleList(),
            reservations: reservationHooks(world)
        }))
    }]
}

/** The rectangle with corners a and b, row by row: an area drag's tiles, and the area tool's preview. */
export function rtAreaRect(map: RtMap, a: number, b: number): number[] {
    const [x0, x1] = [Math.min(map.tileX(a), map.tileX(b)), Math.max(map.tileX(a), map.tileX(b))]
    const [y0, y1] = [Math.min(map.tileY(a), map.tileY(b)), Math.max(map.tileY(a), map.tileY(b))]
    const out: number[] = []
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(map.idx(x, y))
    return out
}

/** The tiles of an area drag, row by row, or null beyond areaMaxTiles a side. */
function areaTiles(world: RtWorld, tile: number, endTile: number): number[] | null {
    const map = world.map
    if (!map.validTile(tile) || !map.validTile(endTile)) return null
    const max = RT_CATALOG.caps.areaMaxTiles
    if (Math.abs(map.tileX(tile) - map.tileX(endTile)) + 1 > max || Math.abs(map.tileY(tile) - map.tileY(endTile)) + 1 > max) return null
    return rtAreaRect(map, tile, endTile)
}

/** The footprint of a rail station, for the signal refresh and the station tool's preview. */
export function rtStationFootprint(map: RtMap, origin: number, axis: number, tracks: number, length: number): number[] {
    const out: number[] = []
    if (!map.validTile(origin) || !isInt(tracks) || !isInt(length)) return out
    const [x, y] = [map.tileX(origin), map.tileY(origin)]
    for (let t = 0; t < Math.min(tracks, RT_MAX_PLATFORMS); t++) {
        for (let l = 0; l < Math.min(length, RT_MAX_PLATFORM_LENGTH); l++) {
            const [tx, ty] = axis === RtAxis.x ? [x + l, y + t] : [x + t, y + l]
            if (map.inBounds(tx, ty)) out.push(map.idx(tx, ty))
        }
    }
    return out
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

/** Whether every tile the train holds is the company's own: only then may it be stopped there. */
function onOwnTrack(world: RtWorld, vehicle: RtVehicle): boolean {
    for (const tile of vehicle.tiles) if (world.map.owner[tile] !== vehicle.owner) return false
    return true
}

/**
 * Why a road vehicle may not be stopped where it stands, or null: it may stop in its own depot, or on
 * its own and town roads clear of level crossings. Elsewhere it would block another company's depot or bait trains.
 */
function roadStopRefusal(world: RtWorld, vehicle: RtVehicle): RtCommandError | null {
    const map = world.map
    if (vehicle.state === RtVehicleState.inDepot) return map.owner[vehicle.tiles[0]!] === vehicle.owner ? null : RtCommandError.notOwner
    for (const tile of vehicle.tiles) {
        const owner = map.owner[tile]
        if (map.kind[tile] === RtTileKind.rail && rtIsCrossing(map.payload[tile]!)) return RtCommandError.state
        if (owner !== vehicle.owner && owner !== RT_OWNER_NONE) return RtCommandError.notOwner
    }
    return null
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
    const depots = rtDepotTiles(map, vehicle.kind, owner => owner === vehicle.owner)
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

function oneTileRoadBits(world: RtWorld, tile: number): number {
    const map = world.map
    const bits = map.kind[tile] === RtTileKind.road ? rtRoadBits(map.payload[tile]!) : 0
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

/* ------------------------------------------------------------------------------------------
 * The rules, one entry per kind
 * ---------------------------------------------------------------------------------------- */

/** What a rule works on: the acting company, whether to apply or only validate, and what it touched. */
interface ApplyContext {
    readonly world: RtWorld
    readonly company: RtCompany
    readonly apply: boolean
    readonly touched: Touched
}

interface RtCommandRule<K extends RtCommandKind> {
    /**
     * A build changes tiles: their infrastructure is recounted around it and a crossing it makes is
     * recorded against the builder. A vehicle or company command changes no tile's ownership.
     */
    readonly family: 'build' | 'vehicle' | 'company'
    /** Every tile a build can change, when more than its own tile: a drag's line or area, a station's footprint. */
    tiles?(world: RtWorld, command: RtCommandOf<K>): number[]
    run(x: ApplyContext, command: RtCommandOf<K>): RtCommandResult
}

/** Every kind a company issues; foundCompany is the server's alone. */
type PlayerKind = Exclude<RtCommandKind, typeof RtCommandKind.foundCompany>

/** A build that changes one tile through one rule. */
function oneTile<K extends PlayerKind>(rule: (x: ApplyContext, command: RtCommandOf<K>, apply: boolean) => RtBuildResult): RtCommandRule<K> {
    return {
        family: 'build',
        run: (x, command) => single(x.company, x.apply, x.touched, [(command as { tile: number }).tile], a => rule(x, command, a))
    }
}

/** A vehicle command on one of the company's own live vehicles. */
function ownVehicleRule<K extends PlayerKind>(run: (x: ApplyContext, vehicle: RtVehicle, command: RtCommandOf<K>) => RtCommandResult): RtCommandRule<K> {
    return {
        family: 'vehicle',
        run: (x, command) => {
            const vehicle = ownVehicle(x.world, x.company.id, (command as { vehicle: unknown }).vehicle)
            return isVehicle(vehicle) ? run(x, vehicle, command) : vehicle
        }
    }
}

function buildDepotRule(x: ApplyContext, command: RtCommandOf<typeof RtCommandKind.buildDepot>): RtCommandResult {
    const map = x.world.map
    const front = map.validTile(command.tile) && isInt(command.facing) ? map.neighbour(command.tile, (command.facing & 3) as RtDir) : RT_NONE
    const tiles = map.validTile(front) ? [command.tile, front] : [command.tile]
    return single(x.company, x.apply, x.touched, tiles, a => buildDepot(map, x.company.id, command.tile, command.vehicleKind, command.facing, a))
}

function buildRailStationRule(x: ApplyContext, command: RtCommandOf<typeof RtCommandKind.buildRailStation>): RtCommandResult {
    const { world, company } = x
    const tiles = rtStationFootprint(world.map, command.tile, command.axis, command.tracks, command.length)
    return single(company, x.apply, x.touched, tiles, a => withStations(world, list => buildRailStation(
        world.map, list, world.townList(), company.id, command.tile, command.axis, command.tracks, command.length, a, vehicleOn(world)
    )))
}

function buildRoadStopRule(x: ApplyContext, command: RtCommandOf<typeof RtCommandKind.buildRoadStop>): RtCommandResult {
    const { world, company } = x
    if (command.stop !== RtStationTile.bus && command.stop !== RtStationTile.truck) return fail(RtCommandError.invalid)
    const shape = command.shape ?? RtRoadStopShape.auto
    if (!isInt(shape) || shape < 0 || shape > RT_ROAD_STOP_SHAPE_MAX) return fail(RtCommandError.invalid)
    return single(company, x.apply, x.touched, roadStopTiles(world.map, command.tile), a => withStations(world, list => buildRoadStop(
        world.map, list, world.townList(), company.id, command.tile, command.stop, a, vehicleOn(world), shape
    )))
}

function buildRailLineRule(x: ApplyContext, command: RtCommandOf<typeof RtCommandKind.buildRailLine>): RtCommandResult {
    const { world, company } = x
    const line = railLineTiles(world, command.tile, command.endTile, command.trackdir)
    if (!line) return fail(RtCommandError.invalid)
    return drag(company, x.apply, x.touched, line.map(({ tile, piece }) => ({
        tiles: [tile],
        rule: (a: boolean) => buildRail(world.map, company.id, tile, piece, a, vehicleOn(world))
    })))
}

function buildRoadLineRule(x: ApplyContext, command: RtCommandOf<typeof RtCommandKind.buildRoadLine>): RtCommandResult {
    const { world, company } = x
    const line = roadLineTiles(world, command.tile, command.endTile)
    if (!line) return fail(RtCommandError.invalid)
    const bits = line.alongX ? RT_ROAD_X : RT_ROAD_Y
    const oneTile = line.tiles.length === 1
    return drag(company, x.apply, x.touched, line.tiles.map(tile => ({
        tiles: [tile],
        // a one-tile drag builds the straight piece the tile's road already runs along, else x
        rule: (a: boolean) => buildRoad(world.map, company.id, tile, oneTile ? oneTileRoadBits(world, tile) : bits, a, vehicleOn(world))
    })))
}

function buyVehicleRule(x: ApplyContext, command: RtCommandOf<typeof RtCommandKind.buyVehicle>): RtCommandResult {
    const { world, company } = x
    const check = buyVehicle(world, company.id, command.depot, command.model, command.wagons, false)
    if (!check.ok) return fail(check.error)
    if (company.money < check.cost) return fail(RtCommandError.money)
    if (!x.apply) return ok(check.cost, check.vehicle)
    const done = buyVehicle(world, company.id, command.depot, command.model, command.wagons, true)
    if (!done.ok) return fail(done.error)
    bookMoney(company, 'newVehicles', -done.cost)
    return ok(done.cost, done.vehicle)
}

function sellVehicleRule(x: ApplyContext, vehicle: RtVehicle): RtCommandResult {
    const { world, company } = x
    const check = sellVehicle(world, company.id, vehicle.id, false)
    if (!check.ok) return fail(check.error)
    if (!x.apply) return ok(check.cost)
    const depot = vehicle.tiles[0]
    const done = sellVehicle(world, company.id, vehicle.id, true)
    if (!done.ok) return fail(done.error)
    bookMoney(company, 'newVehicles', -done.cost)
    if (depot !== undefined) x.touched.tiles.add(depot)
    return ok(done.cost)
}

function startStopRule(x: ApplyContext, vehicle: RtVehicle, command: RtCommandOf<typeof RtCommandKind.startStop>): RtCommandResult {
    if (typeof command.stopped !== 'boolean' || command.stopped === vehicle.stopped) return fail(RtCommandError.state)
    // a train is parked only on its own network; in a depot it simply stops
    if (command.stopped && vehicle.kind === RtVehicleKind.rail && vehicle.state !== RtVehicleState.inDepot && !onOwnTrack(x.world, vehicle)) {
        return fail(RtCommandError.notOwner)
    }
    const roadRefusal = command.stopped && vehicle.kind === RtVehicleKind.road ? roadStopRefusal(x.world, vehicle) : null
    if (roadRefusal !== null) return fail(roadRefusal)
    if (x.apply) vehicle.stopped = command.stopped
    return ok(0)
}

function sendToDepotRule(x: ApplyContext, vehicle: RtVehicle): RtCommandResult {
    if (vehicle.state === RtVehicleState.inDepot) return fail(RtCommandError.state)
    if (vehicle.haltInDepot) {
        if (x.apply) {
            vehicle.haltInDepot = false
            vehicle.serviceDepot = RT_NONE
            vehicle.routeTick = RT_NONE
        }
        return ok(0)
    }
    const { depot, reverse } = nearestOwnDepot(x.world, vehicle)
    if (depot === RT_NONE) return fail(RtCommandError.noDepot)
    if (x.apply) {
        if (reverse) {
            for (const tile of vehicle.tiles) x.touched.tiles.add(tile)
            rtReverseTrain(x.world, vehicle)
        }
        vehicle.serviceDepot = depot
        vehicle.haltInDepot = true
        vehicle.stopped = false
        vehicle.routeTick = RT_NONE
    }
    return ok(0)
}

function reverseTrainRule(x: ApplyContext, vehicle: RtVehicle): RtCommandResult {
    if (vehicle.kind !== RtVehicleKind.rail || vehicle.state === RtVehicleState.inDepot || vehicle.tiles.length === 0) {
        return fail(RtCommandError.state)
    }
    if (x.apply) {
        const before = [...vehicle.tiles]
        rtReverseTrain(x.world, vehicle)
        for (const tile of before) x.touched.tiles.add(tile)
    }
    return ok(0)
}

function changeLoanRule(x: ApplyContext, command: RtCommandOf<typeof RtCommandKind.changeLoan>): RtCommandResult {
    if (!isInt(command.steps) || command.steps === 0) return fail(RtCommandError.loan, 0)
    const result = changeLoan(x.apply ? x.company : { ...x.company }, command.steps)
    return result.ok ? ok(0) : fail(RtCommandError.loan, result.error)
}

function renameCompanyRule(x: ApplyContext, command: RtCommandOf<typeof RtCommandKind.renameCompany>): RtCommandResult {
    const name = rtCleanCompanyName(command.name)
    if (name === '') return fail(RtCommandError.invalid)
    const looks = rtNameSkeleton(name)
    for (const other of x.world.companyList()) {
        if (other.id !== x.company.id && rtNameSkeleton(other.name) === looks) return fail(RtCommandError.conflict)
    }
    if (x.apply) x.company.name = name
    return ok(0)
}

const RULES: { readonly [K in PlayerKind]: RtCommandRule<K> } = {
    [RtCommandKind.buildRail]: oneTile((x, c, a) => buildRail(x.world.map, x.company.id, c.tile, c.piece, a, vehicleOn(x.world))),
    [RtCommandKind.removeRail]: oneTile((x, c, a) => removeRail(x.world.map, x.company.id, c.tile, c.piece, vehicleOn(x.world), a, reservationHooks(x.world))),
    [RtCommandKind.buildRoad]: oneTile((x, c, a) => buildRoad(x.world.map, x.company.id, c.tile, c.bits, a, vehicleOn(x.world))),
    [RtCommandKind.removeRoad]: oneTile((x, c, a) => removeRoad(x.world.map, x.company.id, c.tile, c.bits, vehicleOn(x.world), a)),
    [RtCommandKind.placeSignal]: oneTile((x, c, a) => placeSignal(x.world.map, x.company.id, c.tile, c.piece, c.signalType, a)),
    [RtCommandKind.buildSiding]: oneTile((x, c, a) => buildSiding(x.world.map, x.company.id, c.tile, a)),
    [RtCommandKind.removeSiding]: oneTile((x, c, a) => removeSiding(x.world.map, x.company.id, c.tile, a)),
    [RtCommandKind.buildDepot]: { family: 'build', run: buildDepotRule },
    [RtCommandKind.buildRailStation]: {
        family: 'build',
        tiles: (world, c) => rtStationFootprint(world.map, c.tile, c.axis, c.tracks, c.length),
        run: buildRailStationRule
    },
    [RtCommandKind.buildRoadStop]: { family: 'build', tiles: (world, c) => roadStopTiles(world.map, c.tile), run: buildRoadStopRule },
    [RtCommandKind.demolish]: {
        family: 'build',
        run: (x, c) => x.world.map.validTile(c.tile) ? drag(x.company, x.apply, x.touched, clearSteps(x.world, x.company.id, c.tile)) : fail(RtCommandError.invalid)
    },
    [RtCommandKind.demolishArea]: {
        family: 'build',
        tiles: (world, c) => areaTiles(world, c.tile, c.endTile) ?? [],
        run: (x, c) => {
            const tiles = areaTiles(x.world, c.tile, c.endTile)
            return tiles ? area(x.world, x.company, x.apply, x.touched, tiles) : fail(RtCommandError.invalid)
        }
    },
    [RtCommandKind.buildRailLine]: {
        family: 'build',
        tiles: (world, c) => railLineTiles(world, c.tile, c.endTile, c.trackdir)?.map(step => step.tile) ?? [],
        run: buildRailLineRule
    },
    [RtCommandKind.buildRoadLine]: {
        family: 'build',
        tiles: (world, c) => roadLineTiles(world, c.tile, c.endTile)?.tiles ?? [],
        run: buildRoadLineRule
    },
    [RtCommandKind.buyVehicle]: { family: 'vehicle', run: buyVehicleRule },
    [RtCommandKind.sellVehicle]: ownVehicleRule(sellVehicleRule),
    [RtCommandKind.setOrders]: ownVehicleRule((x, vehicle, c) => {
        const checked = validateOrders(c.orders, x.world.stations, x.world.map, x.company.id, x.world.settings.sharing, vehicle)
        if (!checked.ok) return fail(RtCommandError.orders, checked.error)
        if (x.apply) rtReplaceOrders(vehicle, checked.orders)
        return ok(0)
    }),
    [RtCommandKind.startStop]: ownVehicleRule(startStopRule),
    [RtCommandKind.sendToDepot]: ownVehicleRule(sendToDepotRule),
    [RtCommandKind.reverseTrain]: ownVehicleRule(reverseTrainRule),
    [RtCommandKind.changeLoan]: { family: 'company', run: changeLoanRule },
    [RtCommandKind.renameCompany]: { family: 'company', run: renameCompanyRule }
}

function ruleOf(kind: number): RtCommandRule<PlayerKind> | undefined {
    return Object.hasOwn(RULES, kind) ? RULES[kind as PlayerKind] as RtCommandRule<PlayerKind> : undefined
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

/** A command due at the world's current tick, with what to do with its result. */
export interface RtDueCommand {
    company: number
    command: RtCommand
    onApplied?: (result: RtCommandResult) => void
}

/** Applies due commands in order, each result handed to its onApplied before the next applies. */
export function rtApplyCommands(world: RtWorld, due: Iterable<RtDueCommand>): void {
    for (const entry of due) {
        // computed first: an optional call would skip its argument when there is no callback
        const result = applyCommand(world, entry.company, entry.command, true)
        entry.onApplied?.(result)
    }
}

/**
 * One lockstep tick, the same on every peer and on the room: every command stamped for the world's
 * current tick in stamp order, then the step. Determinism hangs on this order.
 */
export function rtApplyTick(world: RtWorld, due: Iterable<RtDueCommand>): void {
    rtApplyCommands(world, due)
    world.step()
}

/**
 * The foundCompany command for a new member named `name`, in the first unused colour, as its bytes
 * and as the world decodes them, or null when the world has no free company. A name the codec
 * cannot carry falls back to '', which the world turns into the company's default name.
 */
export function rtFoundCompanyCommand(world: RtWorld, name: string): { command: RtCommand, bytes: Uint8Array } | null {
    const colour = world.firstUnusedColour()
    let bytes: Uint8Array
    try {
        bytes = encodeCommand({ kind: RtCommandKind.foundCompany, name, colour })
    } catch {
        bytes = encodeCommand({ kind: RtCommandKind.foundCompany, name: '', colour })
    }
    const command = decodeCommand(bytes, world.map.side)
    if (!command || !applyCommand(world, RT_SERVER_COMPANY, command, false).ok) return null
    return { command, bytes }
}

/** Founds the company of a member who joins with no room live: the same command a live join stamps. */
export function rtFoundCompany(world: RtWorld, name: string): number | null {
    const found = rtFoundCompanyCommand(world, name)
    if (!found) return null
    const result = applyCommand(world, RT_SERVER_COMPANY, found.command, true)
    return result.ok && result.id !== undefined ? result.id : null
}

function foundCompany(world: RtWorld, companyId: number, command: RtCommandOf<typeof RtCommandKind.foundCompany>, apply: boolean): RtCommandResult {
    if (companyId !== RT_SERVER_COMPANY) return fail(RtCommandError.noCompany)
    if (world.freeCompanyId() === RT_NONE) return fail(RtCommandError.limit)
    if (!apply) return ok(0)
    const id = world.addCompany(command.name, command.colour)
    return id === null ? fail(RtCommandError.limit) : ok(0, id)
}

/** Runs a build with the infrastructure counts following it: what its tiles counted before comes off, what they count after goes on. */
function runBuild(x: ApplyContext, rule: RtCommandRule<PlayerKind>, command: RtCommandOf<PlayerKind>): RtCommandResult {
    const tiles = !x.apply ? [] : rule.tiles ? rule.tiles(x.world, command) : 'tile' in command ? [command.tile] : []
    rtCountTiles(x.world, tiles, -1)
    try {
        return rule.run(x, command)
    } finally {
        rtCountTiles(x.world, tiles, 1)
    }
}

function applyInner(world: RtWorld, companyId: number, command: RtCommand, apply: boolean): RtCommandResult {
    if (!command || typeof command !== 'object' || !isInt(command.kind)) return fail(RtCommandError.invalid)
    if (command.kind === RtCommandKind.foundCompany) return foundCompany(world, companyId, command, apply)
    if (!isInt(companyId)) return fail(RtCommandError.noCompany)
    const company = world.company(companyId)
    if (!company) return fail(RtCommandError.noCompany)
    if (!wellFormed(world, command)) return fail(RtCommandError.invalid)
    const rule = ruleOf(command.kind)
    if (!rule) return fail(RtCommandError.invalid)

    const x: ApplyContext = { world, company, apply, touched: { tiles: new Set() } }
    const build = rule.family === 'build'
    const result = build ? runBuild(x, rule, command) : rule.run(x, command)
    if (apply && x.touched.tiles.size > 0) {
        const tiles = [...x.touched.tiles].sort((a, b) => a - b)
        // a crossing on another company's rail or road is recorded against the builder (inspector.ts)
        if (result.ok && build) rtRecordCrossings(world, company.id, tiles)
        for (const tile of tiles) world.markDirty(tile)
        updateSignalStates(world.map, world.occupied.otherTrainOn, tiles, world.settings.sharing)
    }
    return result
}
