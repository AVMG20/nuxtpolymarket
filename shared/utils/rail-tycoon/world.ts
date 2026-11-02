/**
 * RtWorld: the complete, deterministic Rail Tycoon game state in one object (W56). Every peer holds
 * one and advances it identically; goal 09 saves exactly its saved state and goal 08 hashes the same.
 * Entities live in dense arrays indexed by id, null where an id is free, so lookups are direct and
 * iteration in ascending id is a plain loop. A new entity takes the lowest free id of its kind, as
 * the original's pools allocate (AR-137), so there is no next-id counter to save.
 * There is no paused flag: pausing is room state (AR-47).
 */

import { clampUtf8 } from './bytes'
import { RT_CATALOG } from './catalog'
import { rtClearPacketSource, rtDeleteOrdersTo } from './demolish'
import { bookMoney, monthlyFinance, rtEmptyFinance } from './economy'
import { RT_MAP_SIDES, RtTileKind, type RtMap } from './map'
import { RtRng } from './rng'
import { releaseAllFor, rtReleaseAhead, rtReservedAhead, updateSignalStates } from './signals'
import {
    RT_STATION_ROAD_OWNER_SHIFT,
    RtStationTile,
    rtRoadStopBits,
    rtRoadStopIsBay,
    rtRoadStopRoadOwner,
    rtStationId,
    rtStationTileType
} from './stations-build'
import {
    rtCrossingPayload,
    rtCrossingRoadBits,
    rtCrossingRoadOwner,
    rtIsCrossing,
    rtRailPieceReserved,
    rtRailPieces,
    type RtTrack
} from './track'
import {
    RT_NONE,
    RT_OWNER_NONE,
    RtOrderKind,
    RtVehicleKind,
    RtVehicleState,
    type RtCargoPacket,
    type RtCompany,
    type RtCrossingViolation,
    type RtDate,
    type RtFinance,
    type RtIndustry,
    type RtStation,
    type RtTown,
    type RtVehicle,
    type RtWorldScalars,
    type RtWorldSettings
} from './types'
import { agePackets } from './cargo'
import { rtDepotKind } from './depots'
import { industryTick } from './industries'
import { rtDropViolationsOf, rtInspectCrossings, rtProsecuteAccidents, rtUncrashedIds } from './inspector'
import { rtRecountInfrastructure } from './infrastructure'
import { rtLoadHooks } from './loading'
import { findRailRoute, findRoadRoute, RtRouteOutcome } from './pathfinder'
import { stepRoadVehicle } from './road-vehicle'
import { stationsTick } from './stations'
import { rtTownMonthly, townTick } from './towns'
import { rtRemoveTrain, stepTrain } from './train'
import { rtIsVehicleDayTick, rtVehicleDay, rtVehicleSellValue } from './vehicles'
import type { RtWorldLayout } from './worldgen'

/** Days in a month (0 = January) of a year: February gains one in a Gregorian leap year, as the original's calendar. */
export function rtDaysInMonth(month: number, year: number): number {
    const time = RT_CATALOG.time
    const days = time.daysPerMonth[month]!
    const leap = time.leapYears && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return month === 1 && leap ? days + 1 : days
}

/** The piece of a one-piece bit set (a level crossing's), the lowest set bit. */
function rtTrackPieceOf(pieces: number): RtTrack {
    let piece = 0
    while (piece < 5 && (pieces & (1 << piece)) === 0) piece++
    return piece as RtTrack
}

/* ------------------------------------------------------------------------------------------
 * Occupied-tile registry (derived; rebuilt on decode, never saved or hashed)
 * ---------------------------------------------------------------------------------------- */

/** Track pieces per rail tile (the six piece bits of the rail payload, W16). */
export const RT_TRACK_PIECES = 6

/** Road lanes a tile can hold apart; a road vehicle's lane is its road direction (0 to 3). */
export const RT_ROAD_LANES = 4

const HOLD_RAIL = 0
const HOLD_DEPOT = 1
const HOLD_ROAD = 2

const EMPTY_IDS: readonly number[] = Object.freeze([])

/** Maps a train's trackdir (RtVehicle.pieces) to its track piece index; track.ts (W27) defines it. */
export type RtTrackdirPiece = (trackdir: number) => number

function insertSorted(list: number[], value: number): void {
    let at = list.length
    while (at > 0 && list[at - 1]! > value) at--
    list.splice(at, 0, value)
}

function removeOne(list: number[], value: number): boolean {
    const at = list.indexOf(value)
    if (at < 0) return false
    list.splice(at, 1)
    return true
}

/**
 * Who stands where, piece by piece (AR-56, AR-57). Three separate holdings: a train on track holds
 * (tile, track piece) pairs; a vehicle inside a depot is a depot occupant, not a track holder; a road
 * vehicle holds (tile, lane). A vehicle may hold several pieces, and two trains may briefly hold one
 * piece (the collision tick). Every query answers in ascending vehicle id.
 */
export class RtOccupiedRegistry {
    readonly tileCount: number
    /** Holdings of every kind per tile, so vehicleOnTile is one read. */
    private readonly perTile: Uint16Array
    /** tile * RT_TRACK_PIECES + piece -> train ids, ascending. */
    private readonly rail = new Map<number, number[]>()
    /** depot tile -> occupant ids, ascending. */
    private readonly depot = new Map<number, number[]>()
    /** tile * RT_ROAD_LANES + lane -> road vehicle ids, ascending. */
    private readonly road = new Map<number, number[]>()
    /** Road holdings per tile, every lane, for level crossings. */
    private readonly roadPerTile = new Map<number, number>()
    /** vehicle id -> its holdings, each encoded key * 4 + kind, in the order they were taken. */
    private readonly byVehicle = new Map<number, number[]>()

    constructor(tileCount: number) {
        if (!Number.isInteger(tileCount) || tileCount < 1) throw new RangeError(`bad tile count: ${tileCount}`)
        this.tileCount = tileCount
        this.perTile = new Uint16Array(tileCount)
    }

    private checkTile(tile: number): void {
        if (!Number.isInteger(tile) || tile < 0 || tile >= this.tileCount) throw new RangeError(`tile out of range: ${tile}`)
    }

    private checkVehicle(vehicle: number): void {
        if (!Number.isInteger(vehicle) || vehicle < 0) throw new RangeError(`bad vehicle id: ${vehicle}`)
    }

    private railKey(tile: number, piece: number): number {
        this.checkTile(tile)
        if (!Number.isInteger(piece) || piece < 0 || piece >= RT_TRACK_PIECES) throw new RangeError(`bad track piece: ${piece}`)
        return tile * RT_TRACK_PIECES + piece
    }

    private roadKey(tile: number, lane: number): number {
        this.checkTile(tile)
        if (!Number.isInteger(lane) || lane < 0 || lane >= RT_ROAD_LANES) throw new RangeError(`bad road lane: ${lane}`)
        return tile * RT_ROAD_LANES + lane
    }

    private add(bucket: Map<number, number[]>, key: number, kind: number, tile: number, vehicle: number): void {
        this.checkVehicle(vehicle)
        const ids = bucket.get(key)
        if (ids) insertSorted(ids, vehicle)
        else bucket.set(key, [vehicle])
        this.perTile[tile]!++
        const held = this.byVehicle.get(vehicle)
        if (held) held.push(key * 4 + kind)
        else this.byVehicle.set(vehicle, [key * 4 + kind])
    }

    private remove(bucket: Map<number, number[]>, key: number, kind: number, tile: number, vehicle: number): boolean {
        const ids = bucket.get(key)
        if (!ids || !removeOne(ids, vehicle)) return false
        if (ids.length === 0) bucket.delete(key)
        this.perTile[tile]!--
        const held = this.byVehicle.get(vehicle)!
        removeOne(held, key * 4 + kind)
        if (held.length === 0) this.byVehicle.delete(vehicle)
        return true
    }

    /** A train on track takes a track piece of a tile (as its head enters it). */
    holdPiece(vehicle: number, tile: number, piece: number): void {
        this.add(this.rail, this.railKey(tile, piece), HOLD_RAIL, tile, vehicle)
    }

    /** A train gives up a track piece (as its tail leaves it); false when it did not hold it. */
    releasePiece(vehicle: number, tile: number, piece: number): boolean {
        return this.remove(this.rail, this.railKey(tile, piece), HOLD_RAIL, tile, vehicle)
    }

    /** A vehicle enters a depot and becomes one of its occupants. */
    enterDepot(vehicle: number, tile: number): void {
        this.checkTile(tile)
        this.add(this.depot, tile, HOLD_DEPOT, tile, vehicle)
    }

    /** A vehicle leaves a depot; false when it was not inside. */
    leaveDepot(vehicle: number, tile: number): boolean {
        this.checkTile(tile)
        return this.remove(this.depot, tile, HOLD_DEPOT, tile, vehicle)
    }

    /** A road vehicle takes a lane of a tile. */
    holdRoad(vehicle: number, tile: number, lane: number): void {
        this.add(this.road, this.roadKey(tile, lane), HOLD_ROAD, tile, vehicle)
        this.roadPerTile.set(tile, (this.roadPerTile.get(tile) ?? 0) + 1)
    }

    /** A road vehicle leaves a lane of a tile; false when it did not hold it. */
    releaseRoad(vehicle: number, tile: number, lane: number): boolean {
        if (!this.remove(this.road, this.roadKey(tile, lane), HOLD_ROAD, tile, vehicle)) return false
        const left = this.roadPerTile.get(tile)! - 1
        if (left === 0) this.roadPerTile.delete(tile)
        else this.roadPerTile.set(tile, left)
        return true
    }

    /** Drop every holding of a vehicle (deleted, crashed and removed, sold); returns how many. */
    releaseVehicle(vehicle: number): number {
        const held = this.byVehicle.get(vehicle)
        if (!held) return 0
        const codes = held.slice()
        for (const code of codes) {
            const kind = code & 3
            const key = (code - kind) / 4
            if (kind === HOLD_RAIL) this.releasePiece(vehicle, (key / RT_TRACK_PIECES) | 0, key % RT_TRACK_PIECES)
            else if (kind === HOLD_DEPOT) this.leaveDepot(vehicle, key)
            else this.releaseRoad(vehicle, (key / RT_ROAD_LANES) | 0, key % RT_ROAD_LANES)
        }
        return codes.length
    }

    /**
     * Whether a train on track holds that piece: collisions and signal blocks (W28, W48). Depot
     * occupants and road vehicles never count.
     */
    trainOnPiece(tile: number, piece: number): boolean {
        return this.rail.has(this.railKey(tile, piece))
    }

    /** The trains on track holding that piece, ascending id; never depot occupants or road vehicles. */
    trainsOnPiece(tile: number, piece: number): readonly number[] {
        return this.rail.get(this.railKey(tile, piece)) ?? EMPTY_IDS
    }

    /** The lowest-id train other than `except` holding that piece, or RT_NONE (reservations, W29). */
    otherTrainOnPiece(tile: number, piece: number, except: number): number {
        const ids = this.rail.get(this.railKey(tile, piece))
        if (!ids) return RT_NONE
        for (const id of ids) if (id !== except) return id
        return RT_NONE
    }

    /** Whether any vehicle is on the tile: a train on track, a depot occupant or a road vehicle (removal and demolish refusals). */
    vehicleOnTile(tile: number): boolean {
        this.checkTile(tile)
        return this.perTile[tile]! > 0
    }

    /** Whether a road vehicle stands on the tile in any lane (level crossings). */
    roadVehicleOnCrossing(tile: number): boolean {
        this.checkTile(tile)
        return this.roadPerTile.has(tile)
    }

    /** The road vehicles holding a lane of a tile, ascending id (road vehicle blocking, W47). */
    roadVehiclesInLane(tile: number, lane: number): readonly number[] {
        return this.road.get(this.roadKey(tile, lane)) ?? EMPTY_IDS
    }

    /** The vehicles inside a depot, ascending id. */
    depotOccupants(tile: number): readonly number[] {
        this.checkTile(tile)
        return this.depot.get(tile) ?? EMPTY_IDS
    }

    /** Forget every holding. */
    clear(): void {
        this.perTile.fill(0)
        this.rail.clear()
        this.depot.clear()
        this.road.clear()
        this.roadPerTile.clear()
        this.byVehicle.clear()
    }

    /**
     * Rebuild from vehicle state in ascending id, as decode does and the W64 rescan checks against: a
     * vehicle inside a depot occupies its depot tile (tiles[0]); a crashed or driving train holds each
     * occupied tile's piece; a road vehicle holds each tile's lane (its road direction in pieces).
     */
    rebuild(vehicles: readonly (RtVehicle | null)[], trackdirPiece: RtTrackdirPiece): void {
        this.clear()
        for (const vehicle of vehicles) {
            if (!vehicle) continue
            if (vehicle.state === RtVehicleState.inDepot) {
                if (vehicle.tiles.length > 0) this.enterDepot(vehicle.id, vehicle.tiles[0]!)
                continue
            }
            for (let k = 0; k < vehicle.tiles.length; k++) {
                const tile = vehicle.tiles[k]!
                const piece = vehicle.pieces[k]!
                if (vehicle.kind === RtVehicleKind.rail) this.holdPiece(vehicle.id, tile, trackdirPiece(piece))
                else this.holdRoad(vehicle.id, tile, piece)
            }
        }
    }

    /** Every holding in a canonical order, for comparing an incremental registry with a rebuilt one. */
    canonical(): string {
        const parts: string[] = []
        const dump = (name: string, bucket: Map<number, number[]>) => {
            const keys = [...bucket.keys()].sort((a, b) => a - b)
            for (const key of keys) parts.push(`${name}${key}:${bucket.get(key)!.join(',')}`)
        }
        dump('r', this.rail)
        dump('d', this.depot)
        dump('l', this.road)
        return parts.join(';')
    }

    /** Whether two registries hold exactly the same vehicles on the same pieces, depots and lanes. */
    equals(other: RtOccupiedRegistry): boolean {
        return this.tileCount === other.tileCount && this.canonical() === other.canonical()
    }
}

/* ------------------------------------------------------------------------------------------
 * Entity id helpers
 * ---------------------------------------------------------------------------------------- */

/** The lowest free id in an id-indexed list below cap, or RT_NONE when every id is taken (AR-137). */
export function rtLowestFreeId(list: readonly (unknown | null)[], cap: number): number {
    const end = Math.min(list.length, cap)
    for (let id = 0; id < end; id++) if (list[id] === null || list[id] === undefined) return id
    return list.length < cap ? list.length : RT_NONE
}

/** The live entities of an id-indexed list, ascending id. */
function live<T>(list: readonly (T | null)[]): T[] {
    const out: T[] = []
    for (const entity of list) if (entity) out.push(entity)
    return out
}

/** Builds an id-indexed list from entities in any order, refusing a bad or repeated id. */
function indexById<T extends { id: number }>(entities: readonly T[], cap: number, what: string): (T | null)[] {
    const list: (T | null)[] = []
    for (const entity of entities) {
        const id = entity.id
        if (!Number.isInteger(id) || id < 0 || id >= cap) throw new RangeError(`${what} id out of range: ${id}`)
        while (list.length <= id) list.push(null)
        if (list[id]) throw new RangeError(`duplicate ${what} id: ${id}`)
        list[id] = entity
    }
    return list
}

/** Puts an entity at its id in an id-indexed list, growing it with free slots as needed. */
function placeAt<T extends { id: number }>(list: (T | null)[], entity: T, cap: number, what: string): void {
    const id = entity.id
    if (!Number.isInteger(id) || id < 0 || id >= cap) throw new RangeError(`${what} id out of range: ${id}`)
    while (list.length <= id) list.push(null)
    if (list[id]) throw new RangeError(`${what} id already taken: ${id}`)
    list[id] = entity
}

/** Frees an id; trailing free slots are trimmed so the list's length stays one past the highest id. */
function removeAt<T>(list: (T | null)[], id: number): T | null {
    if (!Number.isInteger(id) || id < 0 || id >= list.length) return null
    const entity = list[id] ?? null
    list[id] = null
    while (list.length > 0 && list[list.length - 1] === null) list.pop()
    return entity
}

/* ------------------------------------------------------------------------------------------
 * Saved state in canonical order (W58): the hash walks exactly what encodeWorld (W66) writes, in
 * the same order; a field added to one must be added to the other
 * ---------------------------------------------------------------------------------------- */

/**
 * Receives the saved state in canonical order. uint is a value that is never negative (ids,
 * counts, tiles, ticks); int may be negative (money, RT_NONE, timers). Each typed array and string
 * carries its own length, so the sink decides how to write it.
 */
export interface RtStateSink {
    uint(value: number): void
    int(value: number): void
    bool(value: boolean): void
    str(value: string): void
    u8s(values: Uint8Array): void
    u32s(values: Uint32Array): void
}

/**
 * RtFinance categories in their saved order, the same as save.ts RT_FINANCE_KEYS (a private copy:
 * save.ts will import this file at runtime for decode, and a cycle must not decide load order).
 */
const FINANCE_KEYS: readonly (keyof RtFinance)[] = Object.freeze([
    'construction', 'newVehicles', 'runningCosts', 'property', 'loanInterest',
    'trainIncome', 'roadIncome', 'sharingIncome', 'sharingCosts', 'other', 'fines'
] as const)

function walkUints(sink: RtStateSink, values: readonly number[]): void {
    sink.uint(values.length)
    for (let k = 0; k < values.length; k++) sink.uint(values[k]!)
}

function walkPackets(sink: RtStateSink, packets: readonly RtCargoPacket[]): void {
    sink.uint(packets.length)
    for (let k = 0; k < packets.length; k++) {
        const packet = packets[k]!
        sink.uint(packet.cargo)
        sink.uint(packet.count)
        sink.uint(packet.sourceTile)
        sink.int(packet.sourceStation)
        sink.uint(packet.transitPeriods)
        sink.int(packet.feederShare)
    }
}

function walkFinance(sink: RtStateSink, finance: RtFinance): void {
    for (let k = 0; k < FINANCE_KEYS.length; k++) sink.int(finance[FINANCE_KEYS[k]!])
}

/** Live entities in an id-indexed list, counted without allocating. */
function liveCount(list: readonly (unknown | null)[]): number {
    let count = 0
    for (let id = 0; id < list.length; id++) if (list[id]) count++
    return count
}

function walkCompany(sink: RtStateSink, company: RtCompany): void {
    sink.uint(company.id)
    sink.str(company.name)
    sink.uint(company.colour)
    sink.int(company.money)
    sink.int(company.loan)
    sink.uint(company.bankruptMonths)
    sink.uint(company.foundedTick)
    // infrastructure is derived: recounted on decode
    walkFinance(sink, company.financeThisYear)
    walkFinance(sink, company.financeLastYear)
    sink.int(company.monthIncome)
    sink.int(company.monthExpenses)
    sink.uint(company.monthlyIncome.length)
    for (let k = 0; k < company.monthlyIncome.length; k++) {
        sink.int(company.monthlyIncome[k]!.income)
        sink.int(company.monthlyIncome[k]!.expenses)
    }
}

function walkTown(sink: RtStateSink, town: RtTown): void {
    sink.uint(town.id)
    sink.str(town.name)
    sink.uint(town.centre)
    sink.uint(town.houseCount)
    sink.uint(town.population)
    sink.int(town.growthCounter)
    sink.int(town.growthRate)
    sink.bool(town.growing)
    sink.uint(town.activeStations)
    walkUints(sink, town.receivedThisMonth)
    walkUints(sink, town.receivedLastMonth)
}

function walkIndustry(sink: RtStateSink, industry: RtIndustry): void {
    sink.uint(industry.id)
    sink.uint(industry.type)
    sink.uint(industry.origin)
    walkUints(sink, industry.waiting)
    walkUints(sink, industry.delivered)
    walkUints(sink, industry.producedThisMonth)
    walkUints(sink, industry.transportedThisMonth)
}

function walkStation(sink: RtStateSink, station: RtStation): void {
    sink.uint(station.id)
    sink.uint(station.owner)
    sink.str(station.name)
    sink.int(station.town)
    sink.uint(station.sign)
    walkUints(sink, station.tiles)
    sink.uint(station.tilesRevision)
    sink.uint(station.facilities)
    sink.uint(station.cargo.length)
    for (let k = 0; k < station.cargo.length; k++) {
        const cargo = station.cargo[k]!
        sink.uint(cargo.rating)
        sink.bool(cargo.hasRating)
        sink.bool(cargo.loadAttempted)
        walkPackets(sink, cargo.packets)
        sink.uint(cargo.fraction)
        sink.uint(cargo.cyclesSincePickup)
        sink.uint(cargo.maxWaiting)
        sink.uint(cargo.lastSpeed)
        sink.uint(cargo.lastAge)
    }
    sink.uint(station.acceptance)
    sink.int(station.lastPickupTick)
    sink.int(station.lastDeliveryTick)
    sink.int(station.lastVehicleKind)
    // catchment and catchmentRevision are derived: rebuilt on decode
}

function walkVehicle(sink: RtStateSink, vehicle: RtVehicle): void {
    sink.uint(vehicle.id)
    sink.uint(vehicle.owner)
    sink.uint(vehicle.kind)
    sink.uint(vehicle.model)
    walkUints(sink, vehicle.consist)
    sink.uint(vehicle.wagonCount)
    walkUints(sink, vehicle.tiles)
    walkUints(sink, vehicle.pieces)
    sink.uint(vehicle.direction)
    sink.int(vehicle.progress)
    sink.int(vehicle.speed)
    sink.int(vehicle.subspeed)
    walkUints(sink, vehicle.route)
    sink.uint(vehicle.routeIndex)
    sink.int(vehicle.routeTick)
    sink.uint(vehicle.reservedEnd)
    sink.uint(vehicle.orders.length)
    for (let k = 0; k < vehicle.orders.length; k++) {
        const order = vehicle.orders[k]!
        sink.uint(order.kind)
        sink.int(order.target)
        sink.uint(order.flags)
    }
    sink.uint(vehicle.orderIndex)
    sink.uint(vehicle.state)
    sink.bool(vehicle.stopped)
    sink.int(vehicle.loadTicks)
    sink.int(vehicle.loadingStation)
    walkPackets(sink, vehicle.cargo)
    sink.uint(vehicle.reliability)
    sink.uint(vehicle.breakdownChance)
    sink.int(vehicle.breakdownTicks)
    sink.uint(vehicle.breakdownsSinceService)
    sink.int(vehicle.lastServiceTick)
    sink.int(vehicle.serviceDepot)
    sink.bool(vehicle.haltInDepot)
    sink.int(vehicle.runningTicks)
    sink.bool(vehicle.lost)
    sink.int(vehicle.lostRetryTick)
    sink.int(vehicle.blockedTicks)
    sink.int(vehicle.waitTicks)
    sink.int(vehicle.crashTicks)
    sink.int(vehicle.age)
    sink.int(vehicle.value)
    sink.int(vehicle.profitThisYear)
    sink.int(vehicle.profitLastYear)
}

function walkList<T>(sink: RtStateSink, list: readonly (T | null)[], walk: (sink: RtStateSink, entity: T) => void): void {
    sink.uint(liveCount(list))
    for (let id = 0; id < list.length; id++) {
        const entity = list[id]
        if (entity) walk(sink, entity)
    }
}

/**
 * Walks every saved field of a world in canonical order: settings, the four map arrays, each
 * entity list as a live count then its entities in ascending id (each field in its interface's
 * declaration order), the crossing violations in list order (tile, causer, since), then RNG state,
 * tick, date and the pathfinder cursor (goal 09 § 8.1, AR-137).
 * Derived state is skipped: company infrastructure, station catchment and catchmentRevision, the
 * occupied registry, dirty tiles and pathNodesLeft (AR-66). Allocates nothing.
 */
export function rtWalkSavedState(world: RtWorld, sink: RtStateSink): void {
    sink.uint(world.settings.side)
    sink.uint(world.settings.maxCompanies)
    sink.bool(world.settings.sharing)
    sink.u8s(world.map.heights)
    sink.u8s(world.map.kind)
    sink.u8s(world.map.owner)
    sink.u32s(world.map.payload)
    walkList(sink, world.companies, walkCompany)
    walkList(sink, world.towns, walkTown)
    walkList(sink, world.industries, walkIndustry)
    walkList(sink, world.stations, walkStation)
    walkList(sink, world.vehicles, walkVehicle)
    sink.uint(world.violations.length)
    for (let k = 0; k < world.violations.length; k++) {
        const entry = world.violations[k]!
        sink.uint(entry.tile)
        sink.uint(entry.causer)
        sink.uint(entry.since)
    }
    sink.uint(world.rng.state)
    sink.uint(world.tick)
    sink.uint(world.date.day)
    sink.uint(world.date.month)
    sink.uint(world.date.year)
    sink.uint(world.pathfinderCursor)
}

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const TWO_32 = 0x100000000

/** Scratch for hashing a number that is not a safe integer by its float64 bits (state should never hold one). */
const scratchF64 = new Float64Array(1)
const scratchU32 = new Uint32Array(scratchF64.buffer)

/**
 * 32-bit FNV-1a over the saved state, byte by byte. A number is hashed as its 64-bit two's
 * complement (low word, then high word, little-endian), so -0 and 0 hash alike as they encode alike;
 * a string as its length and UTF-16 code units; a typed array as its length and elements.
 */
class RtHashSink implements RtStateSink {
    h = FNV_OFFSET

    private word(w: number): void {
        let h = this.h
        h = Math.imul(h ^ (w & 0xff), FNV_PRIME)
        h = Math.imul(h ^ ((w >>> 8) & 0xff), FNV_PRIME)
        h = Math.imul(h ^ ((w >>> 16) & 0xff), FNV_PRIME)
        h = Math.imul(h ^ (w >>> 24), FNV_PRIME)
        this.h = h
    }

    private num(value: number): void {
        if (Number.isSafeInteger(value)) {
            this.word(value >>> 0)
            this.word(Math.floor(value / TWO_32) | 0)
        } else {
            scratchF64[0] = value
            this.word(scratchU32[0]!)
            this.word(scratchU32[1]!)
        }
    }

    uint(value: number): void {
        this.num(value)
    }

    int(value: number): void {
        this.num(value)
    }

    bool(value: boolean): void {
        this.h = Math.imul(this.h ^ (value ? 1 : 0), FNV_PRIME)
    }

    str(value: string): void {
        this.num(value.length)
        let h = this.h
        for (let k = 0; k < value.length; k++) {
            const unit = value.charCodeAt(k)
            h = Math.imul(h ^ (unit & 0xff), FNV_PRIME)
            h = Math.imul(h ^ (unit >>> 8), FNV_PRIME)
        }
        this.h = h
    }

    u8s(values: Uint8Array): void {
        this.num(values.length)
        let h = this.h
        for (let k = 0; k < values.length; k++) h = Math.imul(h ^ values[k]!, FNV_PRIME)
        this.h = h
    }

    u32s(values: Uint32Array): void {
        this.num(values.length)
        for (let k = 0; k < values.length; k++) this.word(values[k]!)
    }
}

/** One sink, reset per hash; hashing is synchronous, so it is never shared between two calls. */
const hashSink = new RtHashSink()

/* ------------------------------------------------------------------------------------------
 * Companies (W62)
 * ---------------------------------------------------------------------------------------- */

/**
 * A player-supplied company name made safe to store: anything but a string is empty; control
 * characters are dropped and lone surrogates become U+FFFD (so the UTF-8 save round-trips the name
 * exactly and the hash agrees); whitespace is trimmed; the result is clamped to
 * RT_CATALOG.caps.maxNameBytes of UTF-8 (AR-76). May return ''; the caller supplies a default.
 */
export function rtCleanCompanyName(name: unknown): string {
    if (typeof name !== 'string') return ''
    let clean = ''
    for (const char of name) {
        const code = char.codePointAt(0)!
        if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue
        if (clean === '' && char.trim() === '') continue
        clean += code >= 0xd800 && code <= 0xdfff ? '�' : char
        // stop early on hostile input: the clamp keeps at most maxNameBytes anyway
        if (clean.length > RT_CATALOG.caps.maxNameBytes * 2) break
    }
    return clampUtf8(clean.trim(), RT_CATALOG.caps.maxNameBytes).trim()
}

/** The name a company gets when its player supplied none. */
export function rtDefaultCompanyName(id: number): string {
    return `Company ${id + 1}`
}

/**
 * A company as it starts (and restarts after a bankruptcy reset, W63): start money, all of it the
 * start loan, as the original; no finances, infrastructure or history yet.
 */
export function rtNewCompany(id: number, name: string, colour: number, foundedTick: number): RtCompany {
    const economy = RT_CATALOG.economy
    return {
        id,
        name,
        colour,
        money: economy.startMoney,
        loan: economy.startLoan,
        bankruptMonths: 0,
        foundedTick,
        infrastructure: { railPieces: 0, roadPieces: 0, signals: 0, stationTiles: 0, depots: 0 },
        financeThisYear: rtEmptyFinance(),
        financeLastYear: rtEmptyFinance(),
        monthIncome: 0,
        monthExpenses: 0,
        monthlyIncome: []
    }
}

/* ------------------------------------------------------------------------------------------
 * The world
 * ---------------------------------------------------------------------------------------- */

/** Everything a world is built from: create(layout, settings) for a new world, decodeWorld (W67) for a saved one. */
export interface RtWorldInit {
    settings: RtWorldSettings
    map: RtMap
    rngState: number
    tick: number
    date: RtDate
    pathfinderCursor: number
    companies: readonly RtCompany[]
    towns: readonly RtTown[]
    industries: readonly RtIndustry[]
    stations: readonly RtStation[]
    vehicles: readonly RtVehicle[]
    /** Foreign level crossings the inspector watches, in registration order; none when omitted. */
    violations?: readonly RtCrossingViolation[]
}

/** Copies and checks a violation list: tiles on the map and unique, causers below the company cap, since at most the tick. */
function checkViolations(list: readonly RtCrossingViolation[], tileCount: number, maxCompanies: number, tick: number): RtCrossingViolation[] {
    if (list.length > RT_CATALOG.inspector.maxViolations) throw new RangeError(`too many violations: ${list.length}`)
    const seen = new Set<number>()
    const out: RtCrossingViolation[] = []
    for (const entry of list) {
        const { tile, causer, since } = entry
        if (!Number.isInteger(tile) || tile < 0 || tile >= tileCount) throw new RangeError(`violation tile off the map: ${tile}`)
        if (seen.has(tile)) throw new RangeError(`duplicate violation tile: ${tile}`)
        if (!Number.isInteger(causer) || causer < 0 || causer >= maxCompanies) throw new RangeError(`bad violation causer: ${causer}`)
        if (!Number.isSafeInteger(since) || since < 0 || since > tick) throw new RangeError(`bad violation since: ${since}`)
        seen.add(tile)
        out.push({ tile, causer, since })
    }
    return out
}

/** 1 January of the catalog's start year. */
export function rtStartDate(): RtDate {
    return { day: 1, month: 0, year: RT_CATALOG.time.startYear }
}

/**
 * The simulation RNG of a new world, kept apart from the generator's sequence: generateWorld
 * consumed an RtRng seeded with the same u32, so the world mixes the seed before seeding its own.
 */
export function rtWorldRngSeed(layoutSeed: number): number {
    return (Math.imul(layoutSeed ^ 0x5bd1e995, 0x9e3779b1) ^ 0x2545f491) >>> 0
}

function checkSettings(settings: RtWorldSettings): void {
    if (!RT_MAP_SIDES.includes(settings.side)) throw new RangeError(`map side must be 64, 128 or 256: ${settings.side}`)
    const max = settings.maxCompanies
    if (!Number.isInteger(max) || max < 2 || max > RT_CATALOG.caps.maxCompanies) {
        throw new RangeError(`maxCompanies must be 2 to ${RT_CATALOG.caps.maxCompanies}: ${max}`)
    }
    if (typeof settings.sharing !== 'boolean') throw new TypeError('sharing must be a boolean')
}

function checkDate(date: RtDate): void {
    const days = RT_CATALOG.time.daysPerMonth
    if (!Number.isInteger(date.month) || date.month < 0 || date.month >= days.length) throw new RangeError(`bad month: ${date.month}`)
    // the 29th of February is checked by the calendar step (W57); here only the static bound
    const most = date.month === 1 ? 29 : days[date.month]!
    if (!Number.isInteger(date.day) || date.day < 1 || date.day > most) throw new RangeError(`bad day: ${date.day}`)
    if (!Number.isInteger(date.year) || date.year < 0) throw new RangeError(`bad year: ${date.year}`)
}

export class RtWorld {
    /** Map side, company cap and sharing; set at creation, saved, never changed (Q19b). */
    readonly settings: Readonly<RtWorldSettings>
    readonly map: RtMap
    /** The one simulation RNG; its state is saved and hashed. */
    readonly rng: RtRng
    /** Ticks since the world was created. */
    tick: number
    /** The calendar; W57 advances it every RT_CATALOG time dayTicks ticks. */
    date: RtDate
    /** Index of the next vehicle the round-robin pathfinder budget serves (saved, AR-129). */
    pathfinderCursor: number
    /** Derived: pathfinder nodes left this tick, refilled to pathNodesPerTick at the start of every step (W48). */
    pathNodesLeft: number
    /**
     * Not state: the per-tick search budget, RT_CATALOG's on every peer. Only a test lowers it, to make
     * searches scarce (AR-129); a world in play must never change it, or peers would split.
     */
    pathNodesPerTick: number = RT_CATALOG.pathfinder.pathNodesPerTick

    /** Companies by id, null where free; at most settings.maxCompanies. */
    readonly companies: (RtCompany | null)[]
    readonly towns: (RtTown | null)[]
    readonly industries: (RtIndustry | null)[]
    readonly stations: (RtStation | null)[]
    readonly vehicles: (RtVehicle | null)[]
    /** Foreign level crossings and their causers (inspector.ts), in registration order; saved and hashed. */
    readonly violations: RtCrossingViolation[]

    /** Derived: who stands on which piece, depot and lane; rebuilt on decode. */
    readonly occupied: RtOccupiedRegistry
    /** Derived: tiles changed since the last drain, empty at a tick boundary after W57's step. */
    readonly dirtyTiles = new Set<number>()

    // TODO(W35): the tile-to-stations index and (W28) the path-signal cache are derived state owned
    // by stations.ts and signals.ts; they hang off the world here once those modules exist.

    /**
     * Builds a world from complete state. The map and entity objects are taken over, not copied.
     * The occupied registry starts empty: a world with vehicles on track (decode, W67) rebuilds it
     * with occupied.rebuild(world.vehicles, trackdirPiece), and infrastructure counts likewise, since
     * both need track.ts encodings this file does not import.
     */
    constructor(init: RtWorldInit) {
        const settings = { side: init.settings.side, maxCompanies: init.settings.maxCompanies, sharing: init.settings.sharing }
        checkSettings(settings)
        if (init.map.side !== settings.side) throw new RangeError(`map side ${init.map.side} differs from settings side ${settings.side}`)
        if (!Number.isSafeInteger(init.tick) || init.tick < 0) throw new RangeError(`bad tick: ${init.tick}`)
        if (!Number.isInteger(init.pathfinderCursor) || init.pathfinderCursor < 0) throw new RangeError(`bad pathfinder cursor: ${init.pathfinderCursor}`)
        checkDate(init.date)
        const caps = RT_CATALOG.caps
        this.settings = Object.freeze(settings)
        this.map = init.map
        this.rng = new RtRng(init.rngState)
        this.tick = init.tick
        this.date = { day: init.date.day, month: init.date.month, year: init.date.year }
        this.pathfinderCursor = init.pathfinderCursor
        this.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
        this.companies = indexById(init.companies, settings.maxCompanies, 'company')
        this.towns = indexById(init.towns, caps.maxTowns, 'town')
        this.industries = indexById(init.industries, caps.maxIndustries, 'industry')
        this.stations = indexById(init.stations, caps.maxStations, 'station')
        this.vehicles = indexById(init.vehicles, caps.maxVehicles, 'vehicle')
        this.violations = checkViolations(init.violations ?? [], init.map.tileCount, settings.maxCompanies, init.tick)
        this.occupied = new RtOccupiedRegistry(init.map.tileCount)
    }

    /**
     * A new world from generateWorld's layout: tick 0 on 1 January of the start year, no companies,
     * stations or vehicles, the layout's towns and industries under their ids. The layout is taken
     * over, not copied. settings.side must equal the layout's map side.
     */
    static create(layout: RtWorldLayout, settings: RtWorldSettings): RtWorld {
        return new RtWorld({
            settings,
            map: layout.map,
            rngState: rtWorldRngSeed(layout.seed),
            tick: 0,
            date: rtStartDate(),
            pathfinderCursor: 0,
            companies: [],
            towns: layout.towns,
            industries: layout.industries,
            stations: [],
            vehicles: [],
            violations: []
        })
    }

    /** The saved world-level scalars (goal 09 writes them, W58 hashes them). */
    scalars(): RtWorldScalars {
        return {
            tick: this.tick,
            date: { day: this.date.day, month: this.date.month, year: this.date.year },
            rngState: this.rng.state,
            pathfinderCursor: this.pathfinderCursor
        }
    }

    /**
     * 32-bit FNV-1a (u32) over exactly the saved state in canonical order (rtWalkSavedState), so a
     * world decoded from a snapshot hashes equal to the live world it was taken from (AR-66). It
     * covers the pathfinder cursor and every vehicle's lost-retry tick and blocked counter (AR-137);
     * derived caches are not hashed. Allocates nothing; call it at a tick boundary.
     */
    hash(): number {
        hashSink.h = FNV_OFFSET
        rtWalkSavedState(this, hashSink)
        return hashSink.h >>> 0
    }

    /* ---- lookups by id; undefined for a free or out-of-range id ---- */

    company(id: number): RtCompany | undefined {
        return this.companies[id] ?? undefined
    }

    town(id: number): RtTown | undefined {
        return this.towns[id] ?? undefined
    }

    industry(id: number): RtIndustry | undefined {
        return this.industries[id] ?? undefined
    }

    station(id: number): RtStation | undefined {
        return this.stations[id] ?? undefined
    }

    vehicle(id: number): RtVehicle | undefined {
        return this.vehicles[id] ?? undefined
    }

    /* ---- iteration, ascending id ---- */

    companyList(): RtCompany[] {
        return live(this.companies)
    }

    townList(): RtTown[] {
        return live(this.towns)
    }

    industryList(): RtIndustry[] {
        return live(this.industries)
    }

    stationList(): RtStation[] {
        return live(this.stations)
    }

    vehicleList(): RtVehicle[] {
        return live(this.vehicles)
    }

    /* ---- id allocation: the lowest free id of the kind, RT_NONE at the cap (AR-137) ---- */

    freeCompanyId(): number {
        return rtLowestFreeId(this.companies, this.settings.maxCompanies)
    }

    freeTownId(): number {
        return rtLowestFreeId(this.towns, RT_CATALOG.caps.maxTowns)
    }

    freeIndustryId(): number {
        return rtLowestFreeId(this.industries, RT_CATALOG.caps.maxIndustries)
    }

    freeStationId(): number {
        return rtLowestFreeId(this.stations, RT_CATALOG.caps.maxStations)
    }

    freeVehicleId(): number {
        return rtLowestFreeId(this.vehicles, RT_CATALOG.caps.maxVehicles)
    }

    /* ---- insertion and removal by id; the caller has taken the id from free*Id ---- */

    insertCompany(company: RtCompany): void {
        placeAt(this.companies, company, this.settings.maxCompanies, 'company')
    }

    /** Whether a live company already uses that colour index. */
    colourInUse(colour: number): boolean {
        for (const company of this.companies) if (company && company.colour === colour) return true
        return false
    }

    /** The lowest colour index no company uses (there are more colours than the company cap). */
    firstUnusedColour(): number {
        const count = RT_CATALOG.companies.colours.length
        for (let colour = 0; colour < count; colour++) if (!this.colourInUse(colour)) return colour
        return 0
    }

    /**
     * A player joins as a new company under the lowest free id (W62): start money, all of it the
     * start loan, as the original. The name is cleaned and clamped to maxNameBytes (AR-76), with a
     * default when nothing is left. The preferred colour is used when it is a valid, unused index;
     * otherwise the company gets the first unused one, as the catalog decides (the original draws a
     * random unused colour; this one draws nothing, so joining never moves the RNG). Returns the new
     * id, or null when the world already has settings.maxCompanies companies. Never throws on bad
     * input; whether a player already has a company here is room state (W80, W140), not world state.
     */
    addCompany(name: unknown, colour?: unknown): number | null {
        const id = this.freeCompanyId()
        if (id === RT_NONE) return null
        const preferred = typeof colour === 'number' && Number.isInteger(colour)
            && colour >= 0 && colour < RT_CATALOG.companies.colours.length && !this.colourInUse(colour)
        const clean = rtCleanCompanyName(name)
        const company = rtNewCompany(
            id,
            clean === '' ? rtDefaultCompanyName(id) : clean,
            preferred ? colour : this.firstUnusedColour(),
            this.tick
        )
        this.insertCompany(company)
        return id
    }

    insertStation(station: RtStation): void {
        placeAt(this.stations, station, RT_CATALOG.caps.maxStations, 'station')
    }

    insertVehicle(vehicle: RtVehicle): void {
        placeAt(this.vehicles, vehicle, RT_CATALOG.caps.maxVehicles, 'vehicle')
    }

    /** Frees a station id; order and packet clean-up (W23) is the caller's. */
    removeStation(id: number): RtStation | null {
        return removeAt(this.stations, id)
    }

    /** Frees a vehicle id and drops its occupied holdings; reservations are the caller's (W30). */
    removeVehicle(id: number): RtVehicle | null {
        const vehicle = removeAt(this.vehicles, id)
        if (vehicle) this.occupied.releaseVehicle(id)
        return vehicle
    }

    /**
     * W63: the bankruptcy reset, as the original removes a company. Its vehicles go (reservations
     * released); another company's vehicle standing on its rail, platforms or in its depots goes too,
     * its owner refunded the sell value, in ascending vehicle id. Its stations, depots, signals and rail
     * are removed with the W23 order and packet clean-up (AR-69). Its road bits stay as unowned road, so
     * towns and others keep driving them; a level crossing of its rail and a road stop of its own become
     * plain road under their road owner (unowned where that was the company), and another company's
     * crossing or stop on its road keeps the rail or stop with the road part unowned (AR-52, AR-65).
     * Signals of every touched tile are refreshed (AR-59). The company restarts with start money and
     * loan and a cleared record, keeping its id, name and colour. Returns false for an unknown id.
     */
    resetCompany(id: number): boolean {
        const company = this.company(id)
        if (!company) return false
        const map = this.map
        const touched = new Set<number>()
        const onTheirs = (tile: number) => {
            const kind = map.kind[tile]
            return map.owner[tile] === id && (kind === RtTileKind.rail || kind === RtTileKind.station || kind === RtTileKind.depot)
        }
        const drop = (vehicle: RtVehicle) => {
            releaseAllFor(map, vehicle)
            for (const tile of vehicle.tiles) touched.add(tile)
            this.removeVehicle(vehicle.id)
        }

        for (const vehicle of this.vehicleList()) {
            if (vehicle.owner === id) {
                drop(vehicle)
                continue
            }
            const inTheirDepot = vehicle.state === RtVehicleState.inDepot && map.owner[vehicle.tiles[0]!] === id
            const onTheirTrack = vehicle.kind === RtVehicleKind.rail && vehicle.tiles.some(onTheirs)
            if (!inTheirDepot && !onTheirTrack) continue
            const owner = this.company(vehicle.owner)
            if (owner) bookMoney(owner, 'newVehicles', rtVehicleSellValue(vehicle))
            drop(vehicle)
        }
        // a remaining train whose path reservation runs over its track gives it up and plans again
        for (const vehicle of this.vehicleList()) {
            if (vehicle.kind === RtVehicleKind.rail && rtReservedAhead(map, vehicle).tiles.some(onTheirs)) rtReleaseAhead(map, vehicle)
        }

        const vehicles = this.vehicleList()
        for (const station of this.stationList()) {
            if (station.owner !== id) continue
            rtDeleteOrdersTo(vehicles, RtOrderKind.gotoStation, station.id)
            for (const tile of station.tiles) {
                if (!map.validTile(tile) || map.kind[tile] !== RtTileKind.station || rtStationId(map.payload[tile]!) !== station.id) continue
                const payload = map.payload[tile]!
                if (rtStationTileType(payload) === RtStationTile.rail || rtRoadStopIsBay(payload)) {
                    map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
                } else {
                    const roadOwner = rtRoadStopRoadOwner(payload)
                    map.setTile(tile, RtTileKind.road, roadOwner === id ? RT_OWNER_NONE : roadOwner, rtRoadStopBits(payload))
                }
                touched.add(tile)
            }
            this.removeStation(station.id)
            rtClearPacketSource(this.stationList(), vehicles, station.id)
        }

        for (let tile = 0; tile < map.side * map.side; tile++) {
            const kind = map.kind[tile]
            const payload = map.payload[tile]!
            if (map.owner[tile] === id) {
                if (kind === RtTileKind.depot) {
                    rtDeleteOrdersTo(vehicles, RtOrderKind.gotoDepot, tile)
                    map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
                } else if (kind === RtTileKind.rail) {
                    if (rtIsCrossing(payload)) {
                        const roadOwner = rtCrossingRoadOwner(payload)
                        map.setTile(tile, RtTileKind.road, roadOwner === id ? RT_OWNER_NONE : roadOwner, rtCrossingRoadBits(payload))
                    } else {
                        map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
                    }
                } else if (kind === RtTileKind.road) {
                    map.setTile(tile, RtTileKind.road, RT_OWNER_NONE, payload)
                } else {
                    continue
                }
                touched.add(tile)
            } else if (kind === RtTileKind.rail && rtIsCrossing(payload) && rtCrossingRoadOwner(payload) === id) {
                const piece = rtTrackPieceOf(rtRailPieces(payload))
                map.payload[tile] = rtCrossingPayload(piece, RT_OWNER_NONE, rtRailPieceReserved(payload, piece))
                touched.add(tile)
            } else if (kind === RtTileKind.station && rtStationTileType(payload) !== RtStationTile.rail && rtRoadStopRoadOwner(payload) === id) {
                map.payload[tile] = ((payload & ~(0xff << RT_STATION_ROAD_OWNER_SHIFT)) | (RT_OWNER_NONE << RT_STATION_ROAD_OWNER_SHIFT)) >>> 0
                touched.add(tile)
            }
        }

        // every remaining vehicle plans afresh: a target or a stretch of its way may have gone
        for (const vehicle of this.vehicleList()) vehicle.routeTick = RT_NONE
        const tiles = [...touched].sort((a, b) => a - b)
        for (const tile of tiles) this.markDirty(tile)
        updateSignalStates(map, (tile, piece, except) => this.occupied.otherTrainOnPiece(tile, piece, except) !== RT_NONE, tiles, this.settings.sharing)
        this.companies[id] = rtNewCompany(id, company.name, company.colour, this.tick)
        rtDropViolationsOf(this, id)
        rtRecountInfrastructure(this)
        return true
    }

    /* ---- the tick (W57) ---- */

    /**
     * Advances the world one tick, in the fixed order every peer follows (goal 08): the date; every
     * vehicle in id order from the pathfinder cursor, its daily step (age, breakdown, service, running
     * cost booked as it accrues) before its move, a block it enters or leaves updated before the next
     * vehicle moves (W48, AR-46); accidents on foreign crossings charged to their causers
     * (inspector.ts); towns then industries in id order; station acceptance and ratings;
     * cargo aboard ageing every packetAgeTicks; on a new month the towns' monthly update, the crossing
     * inspector's visits and each company's month end in id order, resetting a company that went bankrupt; on 1 January the
     * new-year roll of finances and vehicle profits (AR-53). Commands for the tick are applied before
     * it is stepped (the room's and the client's job). Pausing is not stepping (AR-47).
     */
    step(): void {
        this.tick++
        this.pathNodesLeft = this.pathNodesPerTick
        const closing = this.date.month
        const turn = this.tick % RT_CATALOG.time.dayTicks === 0 ? this.advanceDay() : 'day'

        const uncrashed = this.violations.length > 0 ? rtUncrashedIds(this) : null
        this.stepVehicles()
        if (uncrashed) rtProsecuteAccidents(this, uncrashed)
        const towns = this.townList()
        for (const town of towns) townTick(this, town, this.rng, this.tick)
        for (const industry of this.industryList()) industryTick(this, industry, this.rng, this.tick)
        stationsTick(this, this.rng, this.tick)
        if (this.tick % RT_CATALOG.time.packetAgeTicks === 0) {
            for (const vehicle of this.vehicleList()) agePackets(vehicle.cargo)
        }

        if (turn === 'day') return
        for (const town of towns) rtTownMonthly(this, town, this.rng, this.tick)
        // upkeep is charged on a fresh count, so a count that drifted between month ends never costs anything
        rtRecountInfrastructure(this)
        rtInspectCrossings(this)
        for (const company of this.companyList()) {
            if (monthlyFinance(company, closing, 0, company.infrastructure) === 'reset') this.resetCompany(company.id)
        }
        if (turn !== 'year') return
        for (const company of this.companyList()) {
            company.financeLastYear = company.financeThisYear
            company.financeThisYear = rtEmptyFinance()
        }
        for (const vehicle of this.vehicleList()) {
            vehicle.profitLastYear = vehicle.profitThisYear
            vehicle.profitThisYear = 0
        }
    }

    /** Moves the date on a day; returns whether that began a month, a year, or only a day. */
    private advanceDay(): 'day' | 'month' | 'year' {
        const date = this.date
        date.day++
        if (date.day <= rtDaysInMonth(date.month, date.year)) return 'day'
        date.day = 1
        date.month++
        if (date.month < 12) return 'month'
        date.month = 0
        date.year++
        return 'year'
    }

    /**
     * Every vehicle once, in id order starting at the pathfinder cursor and wrapping. The cursor then
     * moves to the first vehicle that found this tick's search budget spent, so a vehicle starved of
     * searches goes first next tick and every search waits a bounded number of ticks (AR-129).
     */
    private stepVehicles(): void {
        const list = this.vehicleList()
        if (list.length === 0) return
        let start = list.findIndex(vehicle => vehicle.id >= this.pathfinderCursor)
        if (start < 0) start = 0
        let starved = RT_NONE
        const context = { world: this, findServiceDepot: (vehicle: RtVehicle) => this.serviceDepotFor(vehicle) }
        for (let k = 0; k < list.length; k++) {
            const vehicle = list[(start + k) % list.length]!
            if (this.vehicles[vehicle.id] !== vehicle) continue
            const budget = this.pathNodesLeft
            if (rtIsVehicleDayTick(vehicle.id, this.tick)) {
                const day = rtVehicleDay(vehicle, this.rng, this.tick, context)
                const owner = this.company(vehicle.owner)
                if (owner && day.runningCost > 0) bookMoney(owner, 'runningCosts', -day.runningCost)
            }
            const moved = vehicle.kind === RtVehicleKind.rail ? stepTrain(this, vehicle, rtLoadHooks) : stepRoadVehicle(this, vehicle, rtLoadHooks)
            // starved: the budget was gone before its turn, or its own search ran it out unfinished (deferred)
            if (starved === RT_NONE && this.pathNodesLeft <= 0 && (budget <= 0 || vehicle.routeTick === RT_NONE)) starved = vehicle.id
            if (moved.remove) rtRemoveTrain(this, vehicle)
        }
        if (starved !== RT_NONE) this.pathfinderCursor = starved
    }

    /**
     * The depot a vehicle due for a service drives to, as the original: the nearest of its kind it can
     * reach within serviceDepotMaxCost of route, its own or, with sharing on, another company's
     * (Q19b); RT_NONE when none is that near or this tick's search budget is spent. The search is
     * charged to the tick's budget.
     */
    private serviceDepotFor(vehicle: RtVehicle): number {
        const map = this.map
        if (vehicle.tiles.length === 0 || this.pathNodesLeft <= 0) return RT_NONE
        const depots: number[] = []
        for (let tile = 0; tile < map.side * map.side; tile++) {
            if (map.kind[tile] !== RtTileKind.depot || rtDepotKind(map.payload[tile]!) !== vehicle.kind) continue
            if (map.owner[tile] === vehicle.owner || this.settings.sharing) depots.push(tile)
        }
        if (depots.length === 0) return RT_NONE
        const p = RT_CATALOG.pathfinder
        const target = { tiles: depots }
        const found = vehicle.kind === RtVehicleKind.rail
            ? findRailRoute(map, vehicle.owner, vehicle.tiles[0]!, vehicle.pieces[0]!, target, p.maxSearchNodes, this.pathNodesLeft, { sharing: this.settings.sharing })
            : findRoadRoute(map, vehicle.tiles[0]!, vehicle.pieces[0]!, target, p.maxSearchNodes, this.pathNodesLeft)
        this.pathNodesLeft -= found.nodes
        return found.outcome === RtRouteOutcome.found && found.cost <= p.serviceDepotMaxCost ? found.goal : RT_NONE
    }

    /* ---- dirty tiles (derived) ---- */

    markDirty(tile: number): void {
        this.dirtyTiles.add(tile)
    }

    /** The dirty tiles in ascending order, clearing the set. */
    drainDirtyTiles(): number[] {
        const tiles = [...this.dirtyTiles].sort((a, b) => a - b)
        this.dirtyTiles.clear()
        return tiles
    }
}
