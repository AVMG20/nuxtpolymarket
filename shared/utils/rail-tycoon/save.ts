/**
 * Rail Tycoon's binary world save (goal 09). encodeWorld (W66) writes a whole RtWorld at a tick
 * boundary; decodeWorld (W67) reads it back under the bounds below. The bytes are uncompressed:
 * goal 10 gzips them for the database and goal 13 for snapshots.
 *
 * Layout, little-endian, every list prefixed with its count as a varint:
 *   magic 'RTWD' (4 bytes), u16 format version
 *   settings: u16 side, u8 maxCompanies, u8 sharing (0 or 1)
 *   map: varint length + raw bytes for heights, kind and owner; varint length + u32 per tile for payload
 *   entity lists in this order: companies, towns, industries, stations, vehicles. Each is a count of
 *     live entities, then each entity in ascending id, its saved fields in types.ts declaration order
 *     (fields marked derived are skipped)
 *   crossing violations: a count, then each in list order as varint tile, causer and since
 *   scalars: u32 rng state, varint tick, u8 day, u8 month, varint year, varint pathfinder cursor
 *
 * Field encodings: ids, counts, tiles, ticks and other non-negative integers are varints; money is an
 * svarint (it goes negative and past 2^31, AR-58); a field that may hold RT_NONE is a "ref", the
 * varint of value + 1; booleans and small enums (vehicle kind, state, order kind and flags) are u8.
 *
 * encodeWorld refuses (RangeError) a world that breaks a bound decode enforces, so a save that cannot
 * be loaded is never written.
 *
 * decodeWorld is a hostile-input boundary: a save may come from a client. Every count is checked
 * against its bound (and against the bytes left) before anything is allocated, every enum and
 * reference is range-checked, and any failure is RtBadData, which decodeWorld turns into null.
 */

import { clampUtf8, RtBadData, RtReader, RtWriter } from './bytes'
import { RT_CARGO_IDS, RT_CATALOG, RT_INDUSTRY_TYPE_IDS, RT_VEHICLE_MODEL_IDS, type RtVehicleModelSpec } from './catalog'
import { rtEmptyFinance } from './economy'
import { RT_MAP_SIDES, RT_MAX_HEIGHT, RtMap, RtTileKind } from './map'
import { RT_TRACKDIR_END, rtTrackdirPiece } from './track'
import {
    RT_NONE,
    RT_OWNER_NONE,
    RtFacility,
    RtOrderFlag,
    RtOrderKind,
    RtVehicleKind,
    RtVehicleState,
    type RtCargoPacket,
    type RtCompany,
    type RtCrossingViolation,
    type RtFinance,
    type RtIndustry,
    type RtMonthTotals,
    type RtOrder,
    type RtStation,
    type RtStationCargo,
    type RtTown,
    type RtVehicle
} from './types'
import { RT_ROAD_LANES, RtWorld, type RtTrackdirPiece } from './world'
import { rtRebuildStationIndex } from './stations'
import { rtStationPayloadValid } from './stations-build'
import { rtRecountInfrastructure } from './infrastructure'
import { rtClearSignalCache } from './signals'

/** Save format version; decodeWorld accepts this one only. */
export const RT_SAVE_FORMAT = 1

/** The four bytes every save starts with: 'RTWD'. */
export const RT_SAVE_MAGIC: readonly number[] = Object.freeze([0x52, 0x54, 0x57, 0x44])

/** The bounds encode checks and decode enforces, equal to the creation caps (W59, W37, AR-78). */
export const RT_SAVE_BOUNDS = Object.freeze({
    /** UTF-8 bytes of a company, town or station name. */
    nameBytes: RT_CATALOG.caps.maxNameBytes,
    /** Entries of every per-cargo array (town, industry and station cargo). */
    cargos: RT_CARGO_IDS.length,
    /** Completed months a company keeps for its income graph. */
    monthlyIncome: 12,
    /** Companies; a world's own settings.maxCompanies is the tighter bound. */
    companies: RT_CATALOG.caps.maxCompanies,
    towns: RT_CATALOG.caps.maxTowns,
    industries: RT_CATALOG.caps.maxIndustries,
    stations: RT_CATALOG.caps.maxStations,
    vehicles: RT_CATALOG.caps.maxVehicles,
    vehiclesPerCompany: RT_CATALOG.caps.maxVehiclesPerCompany,
    /**
     * Tiles of one station: its tiles lie within stationSpread in each direction (AR-101), so at most
     * stationSpread squared, tighter than the world-wide caps.maxStationTiles.
     */
    stationTiles: Math.min(RT_CATALOG.stations.stationSpread ** 2, RT_CATALOG.caps.maxStationTiles),
    /** Waiting packets of one station, summed over its cargos. */
    stationPackets: RT_CATALOG.caps.maxPacketsPerStation,
    /** Packets aboard one vehicle. */
    vehiclePackets: RT_CATALOG.caps.maxPacketsPerVehicle,
    /** Orders of one vehicle. */
    orders: RT_CATALOG.caps.maxOrders,
    /** Entries of one vehicle's cached route. */
    route: RT_CATALOG.caps.maxRouteLength,
    /** Parts of one consist (maxTrainLength tiles of half-tile vehicles, AR-91). */
    consist: RT_CATALOG.vehicles.maxTrainVehicles,
    /** Tiles one vehicle occupies: every part covers at most one more tile, plus the head's. */
    vehicleTiles: RT_CATALOG.vehicles.maxTrainVehicles + 1,
    /** Crossing violations the inspector watches. */
    violations: RT_CATALOG.inspector.maxViolations
})

/** RtFinance categories in the order they are saved (and hashed). */
export const RT_FINANCE_KEYS: readonly (keyof RtFinance)[] = Object.freeze([
    'construction', 'newVehicles', 'runningCosts', 'property', 'loanInterest',
    'trainIncome', 'roadIncome', 'sharingIncome', 'sharingCosts', 'other', 'fines'
] as (keyof RtFinance)[])

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

function checkCount(length: number, cap: number, what: string): void {
    if (length > cap) throw new RangeError(`${what}: ${length} exceeds the save bound ${cap}`)
}

// TextEncoder turns a lone surrogate into U+FFFD, which would decode to a different name and hash
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function name(w: RtWriter, text: string, what: string): void {
    if (LONE_SURROGATE.test(text)) throw new RangeError(`${what} name holds a lone surrogate`)
    if (clampUtf8(text, RT_SAVE_BOUNDS.nameBytes) !== text) {
        throw new RangeError(`${what} name exceeds ${RT_SAVE_BOUNDS.nameBytes} bytes`)
    }
    w.str(text)
}

/** A field that may hold RT_NONE (-1): written as value + 1. */
function ref(w: RtWriter, value: number): void {
    w.varint(value + 1)
}

function bool(w: RtWriter, value: boolean): void {
    w.u8(value ? 1 : 0)
}

function varints(w: RtWriter, values: readonly number[], cap: number, what: string): void {
    checkCount(values.length, cap, what)
    w.varint(values.length)
    for (const value of values) w.varint(value)
}

/** Every per-cargo array holds exactly one entry per cargo; decode refuses any other length. */
function checkCargoLength(length: number, what: string): void {
    if (length !== RT_SAVE_BOUNDS.cargos) throw new RangeError(`${what}: ${length} entries, not ${RT_SAVE_BOUNDS.cargos}`)
}

function cargoVarints(w: RtWriter, values: readonly number[], what: string): void {
    checkCargoLength(values.length, what)
    varints(w, values, RT_SAVE_BOUNDS.cargos, what)
}

function writeMap(w: RtWriter, world: RtWorld): void {
    const map = world.map
    for (const raw of [map.heights, map.kind, map.owner]) {
        w.varint(raw.length)
        w.bytes(raw)
    }
    const payload = map.payload
    w.varint(payload.length)
    if (LITTLE_ENDIAN) {
        w.bytes(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength))
    } else {
        for (const value of payload) w.u32(value)
    }
}

function writeFinance(w: RtWriter, finance: RtFinance): void {
    for (const key of RT_FINANCE_KEYS) w.svarint(finance[key])
}

function writeCompany(w: RtWriter, company: RtCompany): void {
    w.varint(company.id)
    name(w, company.name, 'company')
    w.varint(company.colour)
    w.svarint(company.money)
    w.svarint(company.loan)
    w.varint(company.bankruptMonths)
    w.varint(company.foundedTick)
    writeFinance(w, company.financeThisYear)
    writeFinance(w, company.financeLastYear)
    w.svarint(company.monthIncome)
    w.svarint(company.monthExpenses)
    checkCount(company.monthlyIncome.length, RT_SAVE_BOUNDS.monthlyIncome, 'monthly income')
    w.varint(company.monthlyIncome.length)
    for (const month of company.monthlyIncome) {
        w.svarint(month.income)
        w.svarint(month.expenses)
    }
}

function writeTown(w: RtWriter, town: RtTown): void {
    w.varint(town.id)
    name(w, town.name, 'town')
    w.varint(town.centre)
    w.varint(town.houseCount)
    w.varint(town.population)
    w.varint(town.growthCounter)
    w.varint(town.growthRate)
    bool(w, town.growing)
    w.varint(town.activeStations)
    cargoVarints(w, town.receivedThisMonth, 'town cargo')
    cargoVarints(w, town.receivedLastMonth, 'town cargo')
}

function writeIndustry(w: RtWriter, industry: RtIndustry): void {
    w.varint(industry.id)
    w.varint(industry.type)
    w.varint(industry.origin)
    cargoVarints(w, industry.waiting, 'industry cargo')
    cargoVarints(w, industry.delivered, 'industry cargo')
    cargoVarints(w, industry.producedThisMonth, 'industry cargo')
    cargoVarints(w, industry.transportedThisMonth, 'industry cargo')
}

function writePacket(w: RtWriter, packet: RtCargoPacket): void {
    w.varint(packet.cargo)
    w.varint(packet.count)
    w.varint(packet.sourceTile)
    ref(w, packet.sourceStation)
    w.varint(packet.transitPeriods)
    w.svarint(packet.feederShare)
}

function writePackets(w: RtWriter, packets: readonly RtCargoPacket[]): void {
    w.varint(packets.length)
    for (const packet of packets) writePacket(w, packet)
}

function writeStationCargo(w: RtWriter, cargo: RtStationCargo): void {
    w.varint(cargo.rating)
    bool(w, cargo.hasRating)
    bool(w, cargo.loadAttempted)
    writePackets(w, cargo.packets)
    w.varint(cargo.fraction)
    w.varint(cargo.cyclesSincePickup)
    w.varint(cargo.maxWaiting)
    w.varint(cargo.lastSpeed)
    w.varint(cargo.lastAge)
}

function writeStation(w: RtWriter, station: RtStation): void {
    w.varint(station.id)
    w.varint(station.owner)
    name(w, station.name, 'station')
    ref(w, station.town)
    w.varint(station.sign)
    varints(w, station.tiles, RT_SAVE_BOUNDS.stationTiles, 'station tiles')
    w.varint(station.tilesRevision)
    w.varint(station.facilities)
    checkCargoLength(station.cargo.length, 'station cargo')
    let packets = 0
    for (const cargo of station.cargo) packets += cargo.packets.length
    checkCount(packets, RT_SAVE_BOUNDS.stationPackets, 'station packets')
    w.varint(station.cargo.length)
    for (const cargo of station.cargo) writeStationCargo(w, cargo)
    w.varint(station.acceptance)
    ref(w, station.lastPickupTick)
    ref(w, station.lastDeliveryTick)
    ref(w, station.lastVehicleKind)
    // catchment and catchmentRevision are derived: decode rebuilds them (W35, AR-88)
}

function writeVehicle(w: RtWriter, vehicle: RtVehicle): void {
    w.varint(vehicle.id)
    w.varint(vehicle.owner)
    w.u8(vehicle.kind)
    w.varint(vehicle.model)
    varints(w, vehicle.consist, RT_SAVE_BOUNDS.consist, 'consist')
    w.varint(vehicle.wagonCount)
    if (vehicle.pieces.length !== vehicle.tiles.length) {
        throw new RangeError(`vehicle ${vehicle.id}: ${vehicle.pieces.length} pieces for ${vehicle.tiles.length} tiles`)
    }
    varints(w, vehicle.tiles, RT_SAVE_BOUNDS.vehicleTiles, 'vehicle tiles')
    varints(w, vehicle.pieces, RT_SAVE_BOUNDS.vehicleTiles, 'vehicle pieces')
    w.varint(vehicle.direction)
    w.varint(vehicle.progress)
    w.varint(vehicle.speed)
    w.varint(vehicle.subspeed)
    varints(w, vehicle.route, RT_SAVE_BOUNDS.route, 'route')
    w.varint(vehicle.routeIndex)
    ref(w, vehicle.routeTick)
    w.varint(vehicle.reservedEnd)
    checkCount(vehicle.orders.length, RT_SAVE_BOUNDS.orders, 'orders')
    w.varint(vehicle.orders.length)
    for (const order of vehicle.orders) {
        w.u8(order.kind)
        ref(w, order.target)
        w.u8(order.flags)
    }
    w.varint(vehicle.orderIndex)
    w.u8(vehicle.state)
    bool(w, vehicle.stopped)
    w.varint(vehicle.loadTicks)
    ref(w, vehicle.loadingStation)
    checkCount(vehicle.cargo.length, RT_SAVE_BOUNDS.vehiclePackets, 'vehicle packets')
    writePackets(w, vehicle.cargo)
    w.varint(vehicle.reliability)
    w.varint(vehicle.breakdownChance)
    w.varint(vehicle.breakdownTicks)
    w.varint(vehicle.breakdownsSinceService)
    ref(w, vehicle.lastServiceTick)
    ref(w, vehicle.serviceDepot)
    bool(w, vehicle.haltInDepot)
    w.varint(vehicle.runningTicks)
    bool(w, vehicle.lost)
    ref(w, vehicle.lostRetryTick)
    w.varint(vehicle.blockedTicks)
    w.varint(vehicle.waitTicks)
    w.varint(vehicle.crashTicks)
    w.varint(vehicle.age)
    w.svarint(vehicle.value)
    w.svarint(vehicle.profitThisYear)
    w.svarint(vehicle.profitLastYear)
}

function writeList<T>(w: RtWriter, list: readonly T[], cap: number, what: string, write: (w: RtWriter, entity: T) => void): void {
    checkCount(list.length, cap, what)
    w.varint(list.length)
    for (const entity of list) write(w, entity)
}

/**
 * The whole world as a format-1 save (uncompressed). Call it only at a tick boundary, between two
 * steps: derived state (the occupied registry, catchment caches, infrastructure counts, dirty tiles,
 * the path-signal cache, pathNodesLeft) is not written, and decode rebuilds it. Synchronous; the
 * world is only read. Throws RangeError when the world breaks a save bound.
 */
export function encodeWorld(world: RtWorld): Uint8Array {
    const w = new RtWriter()
    for (const byte of RT_SAVE_MAGIC) w.u8(byte)
    w.u16(RT_SAVE_FORMAT)

    const settings = world.settings
    w.u16(settings.side)
    w.u8(settings.maxCompanies)
    bool(w, settings.sharing)

    writeMap(w, world)

    const vehicles = world.vehicleList()
    const perCompany = new Map<number, number>()
    for (const vehicle of vehicles) perCompany.set(vehicle.owner, (perCompany.get(vehicle.owner) ?? 0) + 1)
    for (const [owner, count] of perCompany) checkCount(count, RT_SAVE_BOUNDS.vehiclesPerCompany, `company ${owner} vehicles`)

    writeList(w, world.companyList(), settings.maxCompanies, 'companies', writeCompany)
    writeList(w, world.townList(), RT_SAVE_BOUNDS.towns, 'towns', writeTown)
    writeList(w, world.industryList(), RT_SAVE_BOUNDS.industries, 'industries', writeIndustry)
    writeList(w, world.stationList(), RT_SAVE_BOUNDS.stations, 'stations', writeStation)
    writeList(w, vehicles, RT_SAVE_BOUNDS.vehicles, 'vehicles', writeVehicle)
    writeList(w, world.violations, RT_SAVE_BOUNDS.violations, 'violations', (w, entry) => {
        if (!world.company(entry.causer)) throw new RangeError(`violation at tile ${entry.tile}: causer ${entry.causer} is not a company`)
        w.varint(entry.tile)
        w.varint(entry.causer)
        w.varint(entry.since)
    })

    const scalars = world.scalars()
    w.u32(scalars.rngState)
    w.varint(scalars.tick)
    w.u8(scalars.date.day)
    w.u8(scalars.date.month)
    w.varint(scalars.date.year)
    w.varint(scalars.pathfinderCursor)
    return w.finish()
}

/* ------------------------------------------------------------------------------------------
 * decodeWorld (W67)
 * ---------------------------------------------------------------------------------------- */

const TILE_KIND_COUNT = Object.keys(RtTileKind).length

/**
 * Exclusive bound of a train's trackdir (pieces, direction, route): track.ts RT_TRACKDIR_END (W26).
 * 6 and 7 lie inside the bound but are no trackdir; rtTrackdirPiece refuses them in a train's pieces.
 */
const RT_TRACKDIR_LIMIT = RT_TRACKDIR_END

/** Exclusive bound of a road vehicle's direction, which is also its lane (RT_ROAD_LANES). */
const ROAD_DIRECTION_LIMIT = RT_ROAD_LANES

const FACILITY_MASK = RtFacility.rail | RtFacility.busStop | RtFacility.truckStop
const ORDER_FLAG_MASK = RtOrderFlag.fullLoad | RtOrderFlag.unload | RtOrderFlag.noUnload
const ACCEPTANCE_MASK = (1 << RT_CARGO_IDS.length) - 1
const FRACTION_MAX = (1 << RT_CATALOG.production.fracBits) - 1
const BYTE_MAX = 0xff
const U16_MAX = 0xffff

const MODEL_SPECS: readonly RtVehicleModelSpec[] = RT_VEHICLE_MODEL_IDS.map(id => RT_CATALOG.vehicles.models[id])

/** What decode knows so far: the map size and which ids are live, for checking references. */
interface DecodeContext {
    readonly r: RtReader
    tileCount: number
    maxCompanies: number
    readonly companies: boolean[]
    readonly towns: boolean[]
    readonly stations: boolean[]
    /** Vehicles per owning company, for vehiclesPerCompany. */
    readonly perCompany: number[]
}

function bad(message: string): never {
    throw new RtBadData(message)
}

/** A varint no greater than max. */
function readUint(r: RtReader, max: number, what: string): number {
    const value = r.varint()
    if (value > max) bad(`${what} out of range: ${value} > ${max}`)
    return value
}

/**
 * A list count, checked against its bound and against the bytes left (every entry takes at least
 * one byte) before the caller allocates or loops, so a crafted count can neither allocate nor spin.
 */
function readCount(r: RtReader, cap: number, what: string): number {
    const count = r.varint()
    if (count > cap) bad(`${what}: ${count} exceeds the save bound ${cap}`)
    if (count > r.remaining()) bad(`${what}: ${count} entries but ${r.remaining()} bytes left`)
    return count
}

/** A ref field: varint of value + 1, so RT_NONE (-1) or a non-negative value. */
function readRef(r: RtReader): number {
    return r.varint() - 1
}

function readBool(r: RtReader, what: string): boolean {
    const value = r.u8()
    if (value > 1) bad(`${what} is not a boolean: ${value}`)
    return value === 1
}

function readU8Max(r: RtReader, max: number, what: string): number {
    const value = r.u8()
    if (value > max) bad(`${what} out of range: ${value} > ${max}`)
    return value
}

function readTile(ctx: DecodeContext, what: string): number {
    return readUint(ctx.r, ctx.tileCount - 1, what)
}

function readRefTile(ctx: DecodeContext, what: string): number {
    const tile = readRef(ctx.r)
    if (tile >= ctx.tileCount) bad(`${what} off the map: ${tile}`)
    return tile
}

/** The next entity id: strictly above the previous one and below the cap. */
function readId(r: RtReader, previous: number, cap: number, what: string): number {
    const id = r.varint()
    if (id <= previous || id >= cap) bad(`${what} id ${id} is not ascending below ${cap}`)
    return id
}

/** A company id that must name a live company. */
function readOwner(ctx: DecodeContext, what: string): number {
    const owner = ctx.r.varint()
    if (owner >= ctx.maxCompanies || !ctx.companies[owner]) bad(`${what} owner ${owner} is not a company`)
    return owner
}

/** A station ref within the station cap; whether it is live is checked once every station is read. */
function readStationRef(r: RtReader, what: string): number {
    const id = readRef(r)
    if (id >= RT_SAVE_BOUNDS.stations) bad(`${what} station out of range: ${id}`)
    return id
}

function checkLiveStation(ctx: DecodeContext, id: number, what: string): void {
    if (id !== RT_NONE && !ctx.stations[id]) bad(`${what} names missing station ${id}`)
}

function readName(r: RtReader): string {
    return r.str(RT_SAVE_BOUNDS.nameBytes)
}

function readCargoUints(r: RtReader, what: string): number[] {
    const count = r.varint()
    if (count !== RT_SAVE_BOUNDS.cargos) bad(`${what}: ${count} entries, not ${RT_SAVE_BOUNDS.cargos}`)
    const values: number[] = []
    for (let k = 0; k < count; k++) values.push(r.varint())
    return values
}

/** Raw bytes into a map array of exactly its length. */
function readRaw(r: RtReader, into: Uint8Array, what: string): void {
    const length = r.varint()
    if (length !== into.length) bad(`map ${what}: ${length} bytes, not ${into.length}`)
    into.set(r.bytes(length))
}

function readMap(ctx: DecodeContext, side: number): RtMap {
    const r = ctx.r
    const corners = (side + 1) * (side + 1)
    const tiles = side * side
    // heights, kind, owner and four payload bytes per tile, before allocating the map
    if (r.remaining() < corners + tiles * 6) bad(`truncated map: ${r.remaining()} bytes left`)
    const map = new RtMap(side)
    readRaw(r, map.heights, 'heights')
    for (let i = 0; i < corners; i++) if (map.heights[i]! > RT_MAX_HEIGHT) bad(`corner ${i} height ${map.heights[i]}`)
    readRaw(r, map.kind, 'kind')
    for (let i = 0; i < tiles; i++) if (map.kind[i]! >= TILE_KIND_COUNT) bad(`tile ${i} kind ${map.kind[i]}`)
    // owners are checked against the companies once those are read
    readRaw(r, map.owner, 'owner')
    const count = r.varint()
    if (count !== tiles) bad(`map payload: ${count} entries, not ${tiles}`)
    const raw = r.bytes(count * 4)
    if (LITTLE_ENDIAN) {
        new Uint8Array(map.payload.buffer, map.payload.byteOffset, map.payload.byteLength).set(raw)
    } else {
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
        for (let i = 0; i < count; i++) map.payload[i] = view.getUint32(i * 4, true)
    }
    ctx.tileCount = tiles
    return map
}

function readFinance(r: RtReader): RtFinance {
    const finance = rtEmptyFinance()
    for (const key of RT_FINANCE_KEYS) finance[key] = r.svarint()
    return finance
}

function readCompany(ctx: DecodeContext, previous: number): RtCompany {
    const r = ctx.r
    const id = readId(r, previous, ctx.maxCompanies, 'company')
    const name = readName(r)
    const colour = readUint(r, RT_CATALOG.companies.colours.length - 1, 'company colour')
    const money = r.svarint()
    const loan = r.svarint()
    const bankruptMonths = r.varint()
    const foundedTick = r.varint()
    const financeThisYear = readFinance(r)
    const financeLastYear = readFinance(r)
    const monthIncome = r.svarint()
    const monthExpenses = r.svarint()
    const months = readCount(r, RT_SAVE_BOUNDS.monthlyIncome, 'monthly income')
    const monthlyIncome: RtMonthTotals[] = []
    for (let k = 0; k < months; k++) {
        const income = r.svarint()
        monthlyIncome.push({ income, expenses: r.svarint() })
    }
    return {
        id, name, colour, money, loan, bankruptMonths, foundedTick,
        infrastructure: { railPieces: 0, roadPieces: 0, signals: 0, stationTiles: 0, depots: 0 },
        financeThisYear, financeLastYear, monthIncome, monthExpenses, monthlyIncome
    }
}

function readTown(ctx: DecodeContext, previous: number): RtTown {
    const r = ctx.r
    const id = readId(r, previous, RT_SAVE_BOUNDS.towns, 'town')
    const name = readName(r)
    const centre = readTile(ctx, 'town centre')
    const houseCount = r.varint()
    const population = r.varint()
    const growthCounter = r.varint()
    const growthRate = r.varint()
    const growing = readBool(r, 'town growing')
    const activeStations = r.varint()
    const receivedThisMonth = readCargoUints(r, 'town cargo')
    const receivedLastMonth = readCargoUints(r, 'town cargo')
    return {
        id, name, centre, houseCount, population, growthCounter, growthRate, growing, activeStations,
        receivedThisMonth, receivedLastMonth
    }
}

function readIndustry(ctx: DecodeContext, previous: number): RtIndustry {
    const r = ctx.r
    const id = readId(r, previous, RT_SAVE_BOUNDS.industries, 'industry')
    const type = readUint(r, RT_INDUSTRY_TYPE_IDS.length - 1, 'industry type')
    const origin = readTile(ctx, 'industry origin')
    const waiting = readCargoUints(r, 'industry cargo')
    const delivered = readCargoUints(r, 'industry cargo')
    const producedThisMonth = readCargoUints(r, 'industry cargo')
    const transportedThisMonth = readCargoUints(r, 'industry cargo')
    return { id, type, origin, waiting, delivered, producedThisMonth, transportedThisMonth }
}

function readPacket(ctx: DecodeContext): RtCargoPacket {
    const r = ctx.r
    const cargo = readUint(r, RT_CARGO_IDS.length - 1, 'packet cargo')
    const count = r.varint()
    const sourceTile = readTile(ctx, 'packet source tile')
    const sourceStation = readStationRef(r, 'packet source')
    const transitPeriods = readUint(r, RT_CATALOG.payment.maxTransitPeriods, 'packet transit periods')
    const feederShare = r.svarint()
    return { cargo, count, sourceTile, sourceStation, transitPeriods, feederShare }
}

function readPackets(ctx: DecodeContext, cap: number, what: string): RtCargoPacket[] {
    const count = readCount(ctx.r, cap, what)
    const packets: RtCargoPacket[] = []
    for (let k = 0; k < count; k++) packets.push(readPacket(ctx))
    return packets
}

function readStationCargo(ctx: DecodeContext, packetsLeft: number): RtStationCargo {
    const r = ctx.r
    const rating = readUint(r, RT_CATALOG.stationRating.max, 'station rating')
    const hasRating = readBool(r, 'station hasRating')
    const loadAttempted = readBool(r, 'station loadAttempted')
    const packets = readPackets(ctx, packetsLeft, 'station packets')
    const fraction = readUint(r, FRACTION_MAX, 'station fraction')
    const cyclesSincePickup = readUint(r, BYTE_MAX, 'station cycles since pickup')
    const maxWaiting = r.varint()
    const lastSpeed = readUint(r, BYTE_MAX, 'station last speed')
    const lastAge = readUint(r, BYTE_MAX, 'station last age')
    return { rating, hasRating, loadAttempted, packets, fraction, cyclesSincePickup, maxWaiting, lastSpeed, lastAge }
}

function readStation(ctx: DecodeContext, previous: number): RtStation {
    const r = ctx.r
    const id = readId(r, previous, RT_SAVE_BOUNDS.stations, 'station')
    const owner = readOwner(ctx, 'station')
    const name = readName(r)
    const town = readRef(r)
    if (town !== RT_NONE && (town >= RT_SAVE_BOUNDS.towns || !ctx.towns[town])) bad(`station ${id} names missing town ${town}`)
    const sign = readTile(ctx, 'station sign')
    const tileCount = readCount(r, RT_SAVE_BOUNDS.stationTiles, 'station tiles')
    const tiles: number[] = []
    for (let k = 0; k < tileCount; k++) {
        const tile = readTile(ctx, 'station tile')
        if (k > 0 && tile <= tiles[k - 1]!) bad(`station ${id} tiles are not ascending`)
        tiles.push(tile)
    }
    const tilesRevision = r.varint()
    const facilities = readUint(r, FACILITY_MASK, 'station facilities')
    const cargoCount = r.varint()
    if (cargoCount !== RT_SAVE_BOUNDS.cargos) bad(`station cargo: ${cargoCount} entries, not ${RT_SAVE_BOUNDS.cargos}`)
    const cargo: RtStationCargo[] = []
    let packetsLeft = RT_SAVE_BOUNDS.stationPackets
    for (let k = 0; k < cargoCount; k++) {
        const entry = readStationCargo(ctx, packetsLeft)
        packetsLeft -= entry.packets.length
        cargo.push(entry)
    }
    const acceptance = readUint(r, ACCEPTANCE_MASK, 'station acceptance')
    const lastPickupTick = readRef(r)
    const lastDeliveryTick = readRef(r)
    const lastVehicleKind = readRef(r)
    if (lastVehicleKind !== RT_NONE && lastVehicleKind !== RtVehicleKind.rail && lastVehicleKind !== RtVehicleKind.road) {
        bad(`station last vehicle kind ${lastVehicleKind}`)
    }
    return {
        id, owner, name, town, sign, tiles, tilesRevision, facilities, cargo, acceptance,
        lastPickupTick, lastDeliveryTick, lastVehicleKind,
        // derived: rebuilt from tiles (W35, AR-88)
        catchment: null, catchmentRevision: 0
    }
}

/** Uints each below limit, as many as count says up to cap. */
function readBelow(r: RtReader, cap: number, limit: number, what: string): number[] {
    const count = readCount(r, cap, what)
    const values: number[] = []
    for (let k = 0; k < count; k++) values.push(readUint(r, limit - 1, what))
    return values
}

function readOrder(ctx: DecodeContext): RtOrder {
    const r = ctx.r
    const kind = readU8Max(r, RtOrderKind.gotoDepot, 'order kind') as RtOrder['kind']
    let target: number
    if (kind === RtOrderKind.gotoStation) {
        target = readStationRef(r, 'order')
        checkLiveStation(ctx, target, 'order')
    } else {
        target = readRefTile(ctx, 'depot order')
    }
    const flags = readU8Max(r, ORDER_FLAG_MASK, 'order flags')
    return { kind, target, flags }
}

function readVehicle(ctx: DecodeContext, previous: number): RtVehicle {
    const r = ctx.r
    const id = readId(r, previous, RT_SAVE_BOUNDS.vehicles, 'vehicle')
    const owner = readOwner(ctx, 'vehicle')
    const owned = (ctx.perCompany[owner] ?? 0) + 1
    if (owned > RT_SAVE_BOUNDS.vehiclesPerCompany) bad(`company ${owner} has more than ${RT_SAVE_BOUNDS.vehiclesPerCompany} vehicles`)
    ctx.perCompany[owner] = owned

    const kind = readU8Max(r, RtVehicleKind.road, 'vehicle kind') as RtVehicleKind
    const rail = kind === RtVehicleKind.rail
    const model = readUint(r, MODEL_SPECS.length - 1, 'vehicle model')
    if (MODEL_SPECS[model]!.role !== (rail ? 'engine' : 'road')) bad(`vehicle ${id} model ${model} does not lead a ${rail ? 'train' : 'road vehicle'}`)
    // a train's consist is bounded by maxTrainLength in half-tile vehicles (AR-91); a road vehicle is one part
    const parts = readCount(r, rail ? RT_SAVE_BOUNDS.consist : 1, 'consist')
    const consist: number[] = []
    for (let k = 0; k < parts; k++) {
        const part = readUint(r, MODEL_SPECS.length - 1, 'consist model')
        if (MODEL_SPECS[part]!.kind !== MODEL_SPECS[model]!.kind) bad(`vehicle ${id} consist mixes rail and road`)
        consist.push(part)
    }
    if (consist.length === 0 || consist[0] !== model) bad(`vehicle ${id} consist does not start with its model`)
    const wagonCount = readUint(r, consist.length - 1, 'wagon count')

    const directions = rail ? RT_TRACKDIR_LIMIT : ROAD_DIRECTION_LIMIT
    const tileCount = readCount(r, RT_SAVE_BOUNDS.vehicleTiles, 'vehicle tiles')
    const tiles: number[] = []
    for (let k = 0; k < tileCount; k++) tiles.push(readTile(ctx, 'vehicle tile'))
    if (r.varint() !== tileCount) bad(`vehicle ${id} pieces do not match its tiles`)
    const pieces: number[] = []
    for (let k = 0; k < tileCount; k++) pieces.push(readUint(r, directions - 1, 'vehicle piece'))
    const direction = readUint(r, directions - 1, 'vehicle direction')
    const progress = readUint(r, RT_CATALOG.movement.subTileUnits, 'vehicle progress')
    const speed = readUint(r, U16_MAX, 'vehicle speed')
    const subspeed = readUint(r, BYTE_MAX, 'vehicle subspeed')
    const route = readBelow(r, RT_SAVE_BOUNDS.route, directions, 'route')
    const routeIndex = readUint(r, route.length, 'route index')
    const routeTick = readRef(r)
    const reservedEnd = readUint(r, route.length, 'reserved end')

    const orderCount = readCount(r, RT_SAVE_BOUNDS.orders, 'orders')
    const orders: RtOrder[] = []
    for (let k = 0; k < orderCount; k++) orders.push(readOrder(ctx))
    const orderIndex = readUint(r, Math.max(0, orders.length - 1), 'order index')
    const state = readU8Max(r, RtVehicleState.parked, 'vehicle state') as RtVehicleState
    const stopped = readBool(r, 'vehicle stopped')
    const loadTicks = r.varint()
    const loadingStation = readStationRef(r, 'loading')
    checkLiveStation(ctx, loadingStation, 'loading')
    const cargo = readPackets(ctx, RT_SAVE_BOUNDS.vehiclePackets, 'vehicle packets')
    for (const packet of cargo) checkLiveStation(ctx, packet.sourceStation, 'packet source')

    const reliability = readUint(r, U16_MAX, 'reliability')
    const breakdownChance = readUint(r, BYTE_MAX, 'breakdown chance')
    const breakdownTicks = r.varint()
    const breakdownsSinceService = r.varint()
    const lastServiceTick = readRef(r)
    const serviceDepot = readRefTile(ctx, 'service depot')
    const haltInDepot = readBool(r, 'vehicle halt in depot')
    if (haltInDepot && serviceDepot === RT_NONE) throw new RtBadData('halt in depot without a depot')
    const runningTicks = r.varint()
    const lost = readBool(r, 'vehicle lost')
    const lostRetryTick = readRef(r)
    const blockedTicks = r.varint()
    const waitTicks = r.varint()
    const crashTicks = r.varint()
    const age = r.varint()
    const value = r.svarint()
    const profitThisYear = r.svarint()
    const profitLastYear = r.svarint()
    return {
        id, owner, kind, model, consist, wagonCount, tiles, pieces, direction, progress, speed, subspeed,
        route, routeIndex, routeTick, reservedEnd, orders, orderIndex, state, stopped, loadTicks,
        loadingStation, cargo, reliability, breakdownChance, breakdownTicks, breakdownsSinceService,
        lastServiceTick, serviceDepot, haltInDepot, runningTicks, lost, lostRetryTick, blockedTicks, waitTicks,
        crashTicks, age, value, profitThisYear, profitLastYear
    }
}

function readList<T extends { id: number }>(
    ctx: DecodeContext, cap: number, what: string, read: (ctx: DecodeContext, previous: number) => T, live: boolean[]
): T[] {
    const count = readCount(ctx.r, cap, what)
    const list: T[] = []
    let previous = -1
    for (let k = 0; k < count; k++) {
        const entity = read(ctx, previous)
        previous = entity.id
        live[entity.id] = true
        list.push(entity)
    }
    return list
}

/** The crossing violations: tiles on the map and never repeated, causers live companies. */
function readViolations(ctx: DecodeContext): RtCrossingViolation[] {
    const count = readCount(ctx.r, RT_SAVE_BOUNDS.violations, 'violations')
    const seen = new Set<number>()
    const list: RtCrossingViolation[] = []
    for (let k = 0; k < count; k++) {
        const tile = readTile(ctx, 'violation tile')
        if (seen.has(tile)) bad(`violation tile ${tile} repeated`)
        seen.add(tile)
        const causer = readOwner(ctx, 'violation')
        list.push({ tile, causer, since: ctx.r.varint() })
    }
    return list
}

/**
 * A RangeError from the world constructor or the occupied registry given decoded state means the
 * save is bad; any other error is a bug and propagates.
 */
function asBadData<T>(what: string, run: () => T): T {
    try {
        return run()
    } catch (error) {
        if (error instanceof RangeError) bad(`${what}: ${error.message}`)
        throw error
    }
}

/**
 * track.ts's trackdir -> track piece mapping (goal 04, W26); it throws RangeError on a value that is
 * no trackdir, which decode reports as bad data. The fallback below it is kept for a null mapping.
 * The blockHasPathSignal memo (W28) needs no rebuild: it is keyed by the map object and checks
 * every tile it read before answering.
 */
const SAVE_TRACKDIR_PIECE: RtTrackdirPiece | null = rtTrackdirPiece

/**
 * Rebuilds the derived state a save omits (goal 09 § 8.1, § 8.4) on a freshly decoded world: dirty
 * tiles empty, pathNodesLeft full, company infrastructure counts from the map (W57), every
 * station's catchment cache marked stale (null), the tile-to-stations index (W35), the path-signal
 * cache dropped (W28) and the occupied registry from the vehicles (depot occupants and road vehicles
 * now, train pieces once SAVE_TRACKDIR_PIECE is set). Throws RangeError on a vehicle the registry
 * refuses.
 */
export function rtRebuildDerived(world: RtWorld): void {
    world.dirtyTiles.clear()
    world.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
    rtRecountInfrastructure(world)
    rtClearSignalCache(world.map)
    for (const station of world.stations) {
        if (!station) continue
        station.catchment = null
        station.catchmentRevision = 0
    }
    rtRebuildStationIndex(world)
    if (SAVE_TRACKDIR_PIECE) {
        world.occupied.rebuild(world.vehicles, SAVE_TRACKDIR_PIECE)
        return
    }
    // the same walk as RtOccupiedRegistry.rebuild, minus the train pieces it cannot place yet
    world.occupied.clear()
    for (const vehicle of world.vehicles) {
        if (!vehicle) continue
        if (vehicle.state === RtVehicleState.inDepot) {
            if (vehicle.tiles.length > 0) world.occupied.enterDepot(vehicle.id, vehicle.tiles[0]!)
            continue
        }
        if (vehicle.kind !== RtVehicleKind.road) continue
        for (let k = 0; k < vehicle.tiles.length; k++) world.occupied.holdRoad(vehicle.id, vehicle.tiles[k]!, vehicle.pieces[k]!)
    }
}

/**
 * Parses a format-1 save into a world, or throws RtBadData: wrong magic or version, a short or
 * over-long read, a count past its bound (RT_SAVE_BOUNDS, checked before allocating), an enum or
 * value out of range, ids not strictly ascending, a reference to a missing company, town or station
 * (a packet's source station may be RT_NONE, AR-69), or trailing bytes. Never throws another error
 * type for any input. Derived state is rebuilt (rtRebuildDerived).
 */
export function decodeWorldOrThrow(bytes: Uint8Array): RtWorld {
    if (!(bytes instanceof Uint8Array)) bad('a save must be a Uint8Array')
    const r = new RtReader(bytes)
    for (const byte of RT_SAVE_MAGIC) if (r.u8() !== byte) bad('not a Rail Tycoon save')
    const format = r.u16()
    if (format !== RT_SAVE_FORMAT) bad(`unsupported save format ${format}`)

    const side = r.u16()
    if (!RT_MAP_SIDES.includes(side)) bad(`map side ${side}`)
    const maxCompanies = r.u8()
    if (maxCompanies < 2 || maxCompanies > RT_SAVE_BOUNDS.companies) bad(`maxCompanies ${maxCompanies}`)
    const sharing = readBool(r, 'sharing')

    const ctx: DecodeContext = { r, tileCount: 0, maxCompanies, companies: [], towns: [], stations: [], perCompany: [] }
    const map = readMap(ctx, side)

    const companies = readList(ctx, maxCompanies, 'companies', readCompany, ctx.companies)
    for (let i = 0; i < map.tileCount; i++) {
        const owner = map.owner[i]!
        if (owner !== RT_OWNER_NONE && (owner >= maxCompanies || !ctx.companies[owner])) bad(`tile ${i} owner ${owner} is not a company`)
        if (map.kind[i] === RtTileKind.station && !rtStationPayloadValid(map.payload[i]!, owner)) bad(`tile ${i} station payload ${map.payload[i]}`)
    }
    const towns = readList(ctx, RT_SAVE_BOUNDS.towns, 'towns', readTown, ctx.towns)
    const industries = readList(ctx, RT_SAVE_BOUNDS.industries, 'industries', readIndustry, [])
    const stations = readList(ctx, RT_SAVE_BOUNDS.stations, 'stations', readStation, ctx.stations)
    // a station's packets may come from a station with a higher id, so they are checked once all are live
    for (const station of stations) {
        for (const cargo of station.cargo) for (const packet of cargo.packets) checkLiveStation(ctx, packet.sourceStation, 'packet source')
    }
    const vehicles = readList(ctx, RT_SAVE_BOUNDS.vehicles, 'vehicles', readVehicle, [])
    const violations = readViolations(ctx)

    const rngState = r.u32()
    const tick = r.varint()
    for (const entry of violations) if (entry.since > tick) bad(`violation at tile ${entry.tile} dates from after tick ${tick}`)
    const day = r.u8()
    const month = r.u8()
    const year = r.varint()
    const pathfinderCursor = readUint(r, RT_SAVE_BOUNDS.vehicles, 'pathfinder cursor')
    r.end()

    const world = asBadData('world', () => new RtWorld({
        settings: { side, maxCompanies, sharing },
        map,
        rngState,
        tick,
        date: { day, month, year },
        pathfinderCursor,
        companies,
        towns,
        industries,
        stations,
        vehicles,
        violations
    }))
    asBadData('derived state', () => rtRebuildDerived(world))
    return world
}

/**
 * The world in a format-1 save, or null when the bytes are malformed, oversized or reference a
 * missing entity (W67 § 5.1). Goal 10's rtLoadWorld and goal 14's RtLockstep call it.
 */
export function decodeWorld(bytes: Uint8Array): RtWorld | null {
    try {
        return decodeWorldOrThrow(bytes)
    } catch (error) {
        if (error instanceof RtBadData) return null
        throw error
    }
}
