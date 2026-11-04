/**
 * The saved state of a world, written field by field into a sink: save.ts writes it into an RtWriter
 * for a save, world-hash.ts into an FNV-1a sink for the desync hash. One writer for both means the
 * hash covers exactly what a save holds. See save.ts for the layout and the field encodings.
 *
 * The world is only a type here, so world.ts can hash through this file without an import cycle.
 */

import { clampUtf8 } from './bytes'
import { RT_CARGO_IDS, RT_CATALOG } from './catalog'
import type {
    RtCargoPacket,
    RtCompany,
    RtFinance,
    RtIndustry,
    RtStation,
    RtStationCargo,
    RtTown,
    RtVehicle
} from './types'
import type { RtWorld } from './world'

/** The RtWriter calls the saved state is written with. */
export interface RtSaveSink {
    u8(value: number): void
    u16(value: number): void
    u32(value: number): void
    varint(value: number): void
    svarint(value: number): void
    bytes(data: Uint8Array): void
    str(text: string): void
}

/** The bounds encode checks and decode enforces, equal to the creation caps. */
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
     * Tiles of one station: its tiles lie within stationSpread in each direction, so at most
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
    /** Parts of one consist (maxTrainLength tiles of half-tile vehicles). */
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

export const RT_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

function checkCount(length: number, cap: number, what: string): void {
    if (length > cap) throw new RangeError(`${what}: ${length} exceeds the save bound ${cap}`)
}

// TextEncoder turns a lone surrogate into U+FFFD, which would decode to a different name and hash
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function name(w: RtSaveSink, text: string, what: string): void {
    if (LONE_SURROGATE.test(text)) throw new RangeError(`${what} name holds a lone surrogate`)
    if (clampUtf8(text, RT_SAVE_BOUNDS.nameBytes) !== text) {
        throw new RangeError(`${what} name exceeds ${RT_SAVE_BOUNDS.nameBytes} bytes`)
    }
    w.str(text)
}

/** A field that may hold RT_NONE (-1): written as value + 1. */
function ref(w: RtSaveSink, value: number): void {
    w.varint(value + 1)
}

export function rtWriteBool(w: RtSaveSink, value: boolean): void {
    w.u8(value ? 1 : 0)
}

function varints(w: RtSaveSink, values: readonly number[], cap: number, what: string): void {
    checkCount(values.length, cap, what)
    w.varint(values.length)
    for (const value of values) w.varint(value)
}

/** Every per-cargo array holds exactly one entry per cargo; decode refuses any other length. */
function checkCargoLength(length: number, what: string): void {
    if (length !== RT_SAVE_BOUNDS.cargos) throw new RangeError(`${what}: ${length} entries, not ${RT_SAVE_BOUNDS.cargos}`)
}

function cargoVarints(w: RtSaveSink, values: readonly number[], what: string): void {
    checkCargoLength(values.length, what)
    varints(w, values, RT_SAVE_BOUNDS.cargos, what)
}

function writeSettings(w: RtSaveSink, world: RtWorld): void {
    const settings = world.settings
    w.u16(settings.side)
    w.u8(settings.maxCompanies)
    rtWriteBool(w, settings.sharing)
}

function writeMap(w: RtSaveSink, world: RtWorld): void {
    const map = world.map
    for (const raw of [map.heights, map.kind, map.owner]) {
        w.varint(raw.length)
        w.bytes(raw)
    }
    const payload = map.payload
    w.varint(payload.length)
    if (RT_LITTLE_ENDIAN) {
        w.bytes(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength))
    } else {
        for (const value of payload) w.u32(value)
    }
}

function writeFinance(w: RtSaveSink, finance: RtFinance): void {
    for (const key of RT_FINANCE_KEYS) w.svarint(finance[key])
}

function writeCompany(w: RtSaveSink, company: RtCompany): void {
    w.varint(company.id)
    name(w, company.name, 'company')
    w.varint(company.colour)
    w.svarint(company.money)
    w.svarint(company.loan)
    w.varint(company.bankruptMonths)
    w.varint(company.foundedTick)
    // infrastructure is derived: recounted on decode
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

function writeTown(w: RtSaveSink, town: RtTown): void {
    w.varint(town.id)
    name(w, town.name, 'town')
    w.varint(town.centre)
    w.varint(town.houseCount)
    w.varint(town.population)
    w.varint(town.growthCounter)
    w.varint(town.growthRate)
    rtWriteBool(w, town.growing)
    w.varint(town.activeStations)
    cargoVarints(w, town.receivedThisMonth, 'town cargo')
    cargoVarints(w, town.receivedLastMonth, 'town cargo')
}

function writeIndustry(w: RtSaveSink, industry: RtIndustry): void {
    w.varint(industry.id)
    w.varint(industry.type)
    w.varint(industry.origin)
    cargoVarints(w, industry.waiting, 'industry cargo')
    cargoVarints(w, industry.delivered, 'industry cargo')
    cargoVarints(w, industry.producedThisMonth, 'industry cargo')
    cargoVarints(w, industry.transportedThisMonth, 'industry cargo')
}

function writePacket(w: RtSaveSink, packet: RtCargoPacket): void {
    w.varint(packet.cargo)
    w.varint(packet.count)
    w.varint(packet.sourceTile)
    ref(w, packet.sourceStation)
    w.varint(packet.transitPeriods)
    w.svarint(packet.feederShare)
}

function writePackets(w: RtSaveSink, packets: readonly RtCargoPacket[]): void {
    w.varint(packets.length)
    for (const packet of packets) writePacket(w, packet)
}

function writeStationCargo(w: RtSaveSink, cargo: RtStationCargo): void {
    w.varint(cargo.rating)
    rtWriteBool(w, cargo.hasRating)
    rtWriteBool(w, cargo.loadAttempted)
    writePackets(w, cargo.packets)
    w.varint(cargo.fraction)
    w.varint(cargo.cyclesSincePickup)
    w.varint(cargo.maxWaiting)
    w.varint(cargo.lastSpeed)
    w.varint(cargo.lastAge)
}

function writeStation(w: RtSaveSink, station: RtStation): void {
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
    // catchment and catchmentRevision are derived: decode rebuilds them
}

function writeVehicleBody(w: RtSaveSink, vehicle: RtVehicle): void {
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
}

function writeVehicleRoute(w: RtSaveSink, vehicle: RtVehicle): void {
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
    rtWriteBool(w, vehicle.stopped)
    w.varint(vehicle.loadTicks)
    ref(w, vehicle.loadingStation)
    checkCount(vehicle.cargo.length, RT_SAVE_BOUNDS.vehiclePackets, 'vehicle packets')
    writePackets(w, vehicle.cargo)
}

function writeVehicleUpkeep(w: RtSaveSink, vehicle: RtVehicle): void {
    w.varint(vehicle.reliability)
    w.varint(vehicle.breakdownChance)
    w.varint(vehicle.breakdownTicks)
    w.varint(vehicle.breakdownsSinceService)
    ref(w, vehicle.lastServiceTick)
    ref(w, vehicle.serviceDepot)
    rtWriteBool(w, vehicle.haltInDepot)
    w.varint(vehicle.runningTicks)
    rtWriteBool(w, vehicle.lost)
    ref(w, vehicle.lostRetryTick)
    w.varint(vehicle.blockedTicks)
    w.varint(vehicle.waitTicks)
    w.varint(vehicle.crashTicks)
    w.varint(vehicle.age)
    w.svarint(vehicle.value)
    w.svarint(vehicle.profitThisYear)
    w.svarint(vehicle.profitLastYear)
}

function writeVehicle(w: RtSaveSink, vehicle: RtVehicle): void {
    w.varint(vehicle.id)
    w.varint(vehicle.owner)
    writeVehicleBody(w, vehicle)
    writeVehicleRoute(w, vehicle)
    writeVehicleUpkeep(w, vehicle)
}

function writeList<T>(w: RtSaveSink, list: readonly T[], cap: number, what: string, write: (w: RtSaveSink, entity: T) => void): void {
    checkCount(list.length, cap, what)
    w.varint(list.length)
    for (const entity of list) write(w, entity)
}

/** The entity lists, crossing violations and scalars that end both a whole save and an entity part. */
export function rtWriteEntities(w: RtSaveSink, world: RtWorld): void {
    const vehicles = world.vehicleList()
    const perCompany = new Map<number, number>()
    for (const vehicle of vehicles) perCompany.set(vehicle.owner, (perCompany.get(vehicle.owner) ?? 0) + 1)
    for (const [owner, count] of perCompany) checkCount(count, RT_SAVE_BOUNDS.vehiclesPerCompany, `company ${owner} vehicles`)

    writeList(w, world.companyList(), world.settings.maxCompanies, 'companies', writeCompany)
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
}

/**
 * Every saved field of a world after the save header: settings, map, then the entities. Derived state
 * (the occupied registry, catchment caches, infrastructure counts, dirty tiles, the path-signal cache,
 * pathNodesLeft) is not written. Throws RangeError when the world breaks a save bound.
 */
export function rtWriteSavedState(w: RtSaveSink, world: RtWorld): void {
    writeSettings(w, world)
    writeMap(w, world)
    rtWriteEntities(w, world)
}
