// Rail Tycoon — pure helpers for the world windows.
//
// What the buy, vehicle list, vehicle, station and minimap windows show, computed from the client's
// world without touching it: consists and their totals, vehicle names and status lines, order text and
// order list edits, station cargo rows and acceptance, the window a query click opens, and the
// minimap's colours and projection. The components read these inside a computed after `tick`. The
// one piece of state is rtOrderPickOwner, which vehicle window holds the map's pick mode.

import { shallowRef } from 'vue'
import { RT_CARGO_IDS, RT_CATALOG, RT_INDUSTRY_TYPE_IDS, type RtVehicleModelSpec } from '#shared/utils/rail-tycoon/catalog'
import { rtDepotKind } from '#shared/utils/rail-tycoon/depots'
import { RtTileKind } from '#shared/utils/rail-tycoon/map'
import { RtOrderError, rtCurrentOrder, rtStationById } from '#shared/utils/rail-tycoon/orders'
import { RT_ACCEPT_THRESHOLD, computeCatchment, rtAcceptanceAround, rtStationServesCargo } from '#shared/utils/rail-tycoon/stations'
import { rtStationId } from '#shared/utils/rail-tycoon/stations-build'
import { RT_OWNER_NONE, RtOrderFlag, RtOrderKind, RtVehicleKind, RtVehicleState, type RtOrder, type RtStation, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import {
    RT_VEHICLE_MODELS,
    rtConsistCapacity,
    rtConsistCost,
    rtConsistHalfTiles,
    rtConsistLengthTiles,
    rtConsistMaxSpeed,
    rtConsistPower,
    rtConsistRunningCost,
    rtConsistWeight
} from '#shared/utils/rail-tycoon/vehicles'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'

/* ------------------------------------------------------------------------------------------
 * Cargo
 * ---------------------------------------------------------------------------------------- */

/** A cargo index's display name. */
export function rtCargoName(cargo: number): string {
    const id = RT_CARGO_IDS[cargo]
    return id ? RT_CATALOG.cargos[id].name : 'Cargo'
}

/** A cargo index's colour as CSS, for swatches. */
export function rtCargoCss(cargo: number): string {
    const id = RT_CARGO_IDS[cargo]
    const colour = id ? RT_CATALOG.cargos[id].colour : 0x888888
    return `#${colour.toString(16).padStart(6, '0')}`
}

/* ------------------------------------------------------------------------------------------
 * Buying
 * ---------------------------------------------------------------------------------------- */

/** The models a depot of this kind sells as the lead vehicle: locomotives, or road vehicles. */
export function rtBuyableModels(kind: RtVehicleKind): RtVehicleModelSpec[] {
    return RT_VEHICLE_MODELS.filter(spec => kind === RtVehicleKind.rail ? spec.role === 'engine' : spec.role === 'road')
}

/** Every wagon model, one per cargo. */
export function rtWagonModels(): RtVehicleModelSpec[] {
    return RT_VEHICLE_MODELS.filter(spec => spec.role === 'wagon')
}

/**
 * The most wagons the engine can pull: the longest consist that fits maxTrainLength tiles of
 * halfTilesPerVehicle parts and maxTrainVehicles parts. 0 for anything not a locomotive.
 */
export function rtMaxWagons(engine: number): number {
    const spec = RT_VEHICLE_MODELS[engine]
    if (!spec || spec.role !== 'engine') return 0
    const vehicles = RT_CATALOG.vehicles
    const halfTiles = vehicles.maxTrainLength * 2
    const wagonHalfTiles = Math.max(1, vehicles.halfTilesPerVehicle)
    const byLength = Math.floor((halfTiles - rtConsistHalfTiles([engine])) / wagonHalfTiles)
    return Math.max(0, Math.min(byLength, vehicles.maxTrainVehicles - 1))
}

/** The part list a purchase sends: the lead model, then `count` wagons of one model (none for a road vehicle). */
export function rtPlannedConsist(model: number, wagon: number | null, count: number): number[] {
    const spec = RT_VEHICLE_MODELS[model]
    if (!spec) return []
    if (spec.role !== 'engine' || wagon === null) return [model]
    const wagons = Math.max(0, Math.min(Math.floor(count), rtMaxWagons(model)))
    return [model, ...Array.from({ length: wagons }, () => wagon)]
}

export interface RtConsistSummary {
    cost: number
    /** Per year of running (money). */
    runningCost: number
    /** km/h. */
    maxSpeed: number
    power: number
    weight: number
    lengthTiles: number
    /** Capacity per cargo index. */
    capacity: number[]
}

/** A consist's totals for the buy and vehicle windows. */
export function rtConsistSummary(consist: readonly number[]): RtConsistSummary {
    return {
        cost: rtConsistCost(consist),
        runningCost: rtConsistRunningCost(consist),
        maxSpeed: rtConsistMaxSpeed(consist),
        power: rtConsistPower(consist),
        weight: rtConsistWeight(consist),
        lengthTiles: rtConsistLengthTiles(consist),
        capacity: rtConsistCapacity(consist)
    }
}

/** Capacity as text: "120 Passengers, 30 Mail", or "None". */
export function rtCapacityText(capacity: readonly number[]): string {
    const parts: string[] = []
    capacity.forEach((amount, cargo) => {
        if (amount > 0) parts.push(`${amount} ${rtCargoName(cargo)}`)
    })
    return parts.length > 0 ? parts.join(', ') : 'None'
}

/** The consist as a name: "Meridian Express + 4 Passenger Coach". */
export function rtConsistText(consist: readonly number[]): string {
    const lead = RT_VEHICLE_MODELS[consist[0] ?? -1]
    if (!lead) return 'Unknown vehicle'
    const counts = new Map<number, number>()
    for (const part of consist.slice(1)) counts.set(part, (counts.get(part) ?? 0) + 1)
    const wagons = [...counts].map(([part, n]) => `${n} ${RT_VEHICLE_MODELS[part]?.name ?? 'wagon'}`)
    return [lead.name, ...wagons].join(' + ')
}

/** The vehicles standing in a depot, ascending id. */
export function rtVehiclesInDepot(world: RtWorld, depot: number): RtVehicle[] {
    return world.vehicleList().filter(vehicle => vehicle.state === RtVehicleState.inDepot && vehicle.tiles[0] === depot)
}

/* ------------------------------------------------------------------------------------------
 * Vehicles
 * ---------------------------------------------------------------------------------------- */

/** A vehicle's name: "Train 4" or "Road vehicle 9", numbered by its id. */
export function rtVehicleName(vehicle: Pick<RtVehicle, 'id' | 'kind'>): string {
    return `${vehicle.kind === RtVehicleKind.rail ? 'Train' : 'Road vehicle'} ${vehicle.id + 1}`
}

/** Age in days as the vehicle window shows it: "45 days", "1 year", "3 years". */
export function rtAgeText(days: number): string {
    const years = Math.floor(days / RT_CATALOG.time.yearDays)
    if (years === 0) return `${days} ${days === 1 ? 'day' : 'days'}`
    return `${years} ${years === 1 ? 'year' : 'years'}`
}

/** value out of max as a whole percentage, clamped to 0 to 100. */
export function rtPercent(value: number, max: number): number {
    if (!(max > 0)) return 0
    return Math.max(0, Math.min(100, Math.round(value * 100 / max)))
}

/** Reliability (0 to 65535) as a percentage. */
export function rtReliabilityPercent(reliability: number): number {
    return rtPercent(reliability, 65535)
}

function depotText(world: RtWorld, tile: number): string {
    const map = world.map
    if (!map.validTile(tile)) return 'depot'
    return `depot at ${map.tileX(tile)}, ${map.tileY(tile)}`
}

/** An order as the orders list shows it: "Go to Brookfield Halt (Full load)", "Service at depot at 12, 40". */
export function rtOrderText(world: RtWorld, order: RtOrder): string {
    if (order.kind === RtOrderKind.gotoDepot) return `Service at ${depotText(world, order.target)}`
    const station = rtStationById(world.stations, order.target)
    const flags: string[] = []
    if (order.flags & RtOrderFlag.fullLoad) flags.push('Full load')
    if (order.flags & RtOrderFlag.unload) flags.push('Unload all')
    if (order.flags & RtOrderFlag.noUnload) flags.push('No unloading')
    const text = `Go to ${station?.name ?? 'a removed station'}`
    return flags.length > 0 ? `${text} (${flags.join(', ')})` : text
}

/** Where an order takes the vehicle, short: the station's name or "depot at x, y". */
function orderTarget(world: RtWorld, order: RtOrder): string {
    if (order.kind === RtOrderKind.gotoDepot) return depotText(world, order.target)
    return rtStationById(world.stations, order.target)?.name ?? 'a removed station'
}

/** The vehicle's status line, the original's: what it is doing or where it is heading. */
export function rtVehicleStatus(world: RtWorld, vehicle: RtVehicle): string {
    if (vehicle.state === RtVehicleState.crashed) return 'Crashed!'
    if (vehicle.breakdownTicks > 0) return 'Broken down'
    if (vehicle.state === RtVehicleState.inDepot && vehicle.stopped) return 'Stopped in depot'
    if (vehicle.state === RtVehicleState.parked) return 'Parked'
    if (vehicle.state === RtVehicleState.parking) return 'Stopping: looking for a parking spot'
    if (vehicle.stopped) return 'Stopped'
    if (vehicle.haltInDepot && vehicle.serviceDepot >= 0) return `Heading for ${depotText(world, vehicle.serviceDepot)} to stop`
    if (vehicle.state === RtVehicleState.loading) {
        const station = rtStationById(world.stations, vehicle.loadingStation)
        return `Loading at ${station?.name ?? 'a station'}`
    }
    if (vehicle.lost) return 'Lost'
    if (vehicle.serviceDepot >= 0) return `Heading for ${depotText(world, vehicle.serviceDepot)} for service`
    const order = rtCurrentOrder(vehicle)
    if (!order) return 'No orders'
    return `Heading for ${orderTarget(world, order)}`
}

export interface RtCargoAboard {
    cargo: number
    name: string
    aboard: number
    capacity: number
}

/** Cargo aboard and capacity, per cargo the vehicle can carry or is carrying. */
export function rtVehicleCargo(vehicle: RtVehicle): RtCargoAboard[] {
    const capacity = rtConsistCapacity(vehicle.consist)
    const aboard = RT_CARGO_IDS.map(() => 0)
    for (const packet of vehicle.cargo) if (aboard[packet.cargo] !== undefined) aboard[packet.cargo]! += packet.count
    const out: RtCargoAboard[] = []
    for (let cargo = 0; cargo < capacity.length; cargo++) {
        if (capacity[cargo]! === 0 && aboard[cargo]! === 0) continue
        out.push({ cargo, name: rtCargoName(cargo), aboard: aboard[cargo]!, capacity: capacity[cargo]! })
    }
    return out
}

export type RtVehicleSortKey = 'number' | 'profit' | 'age'

export interface RtVehicleRow {
    id: number
    name: string
    kind: RtVehicleKind
    status: string
    profitThisYear: number
    profitLastYear: number
    /** Days. */
    age: number
}

/** The company's vehicles as vehicle list rows, ascending id. */
export function rtVehicleRows(world: RtWorld, company: number): RtVehicleRow[] {
    const rows: RtVehicleRow[] = []
    for (const vehicle of world.vehicleList()) {
        if (vehicle.owner !== company) continue
        rows.push({
            id: vehicle.id,
            name: rtVehicleName(vehicle),
            kind: vehicle.kind,
            status: rtVehicleStatus(world, vehicle),
            profitThisYear: vehicle.profitThisYear,
            profitLastYear: vehicle.profitLastYear,
            age: vehicle.age
        })
    }
    return rows
}

/** Rows sorted by number (id), profit this year or age; ties fall back to the number. A new array. */
export function rtSortVehicleRows(rows: readonly RtVehicleRow[], key: RtVehicleSortKey, descending: boolean): RtVehicleRow[] {
    const value = (row: RtVehicleRow) => key === 'profit' ? row.profitThisYear : key === 'age' ? row.age : row.id
    const sign = descending ? -1 : 1
    return [...rows].sort((a, b) => (value(a) - value(b)) * sign || a.id - b.id)
}

/** The vehicle standing on a tile outside a depot, lowest id first; null when none. */
export function rtVehicleOnTile(world: RtWorld, tile: number): RtVehicle | null {
    for (const vehicle of world.vehicleList()) {
        if (vehicle.state === RtVehicleState.inDepot) continue
        if (vehicle.tiles.includes(tile)) return vehicle
    }
    return null
}

/* ------------------------------------------------------------------------------------------
 * Order list edits: each returns a new list, the input untouched
 * ---------------------------------------------------------------------------------------- */

/**
 * The vehicle window whose orders editor holds the map's pick mode (its window key), or null: one
 * at a time across every open vehicle window, so a pick lands in the window that asked for it.
 */
export const rtOrderPickOwner = shallowRef<string | null>(null)

/** Inserts an order after `after` (-1 or past the end appends). */
export function rtOrdersInsert(orders: readonly RtOrder[], after: number, order: RtOrder): RtOrder[] {
    const out = orders.map(o => ({ ...o }))
    const at = after >= 0 && after < out.length ? after + 1 : out.length
    out.splice(at, 0, { ...order })
    return out
}

export function rtOrdersRemove(orders: readonly RtOrder[], index: number): RtOrder[] {
    return orders.filter((_, k) => k !== index).map(o => ({ ...o }))
}

/** Moves an order one place up (-1) or down (+1); out of range changes nothing. */
export function rtOrdersMove(orders: readonly RtOrder[], index: number, delta: -1 | 1): RtOrder[] {
    const out = orders.map(o => ({ ...o }))
    const to = index + delta
    if (index < 0 || index >= out.length || to < 0 || to >= out.length) return out
    const [moved] = out.splice(index, 1)
    out.splice(to, 0, moved!)
    return out
}

/**
 * Toggles a flag on a station order. Unload and no unloading exclude each other, so setting one
 * clears the other; depot orders carry no flags and are left alone.
 */
export function rtOrdersToggleFlag(orders: readonly RtOrder[], index: number, flag: number): RtOrder[] {
    const out = orders.map(o => ({ ...o }))
    const order = out[index]
    if (!order || order.kind !== RtOrderKind.gotoStation) return out
    if (order.flags & flag) {
        order.flags &= ~flag
    } else {
        order.flags |= flag
        if (flag === RtOrderFlag.unload) order.flags &= ~RtOrderFlag.noUnload
        if (flag === RtOrderFlag.noUnload) order.flags &= ~RtOrderFlag.unload
    }
    return out
}

const ORDER_ERRORS: Record<RtOrderError, string> = {
    [RtOrderError.invalid]: 'Those orders can\'t be used',
    [RtOrderError.tooMany]: `A vehicle can hold at most ${RT_CATALOG.caps.maxOrders} orders`,
    [RtOrderError.noTarget]: 'That station or depot no longer exists',
    [RtOrderError.notOwner]: 'That belongs to another company',
    [RtOrderError.unusable]: 'This vehicle can\'t use that station or depot',
    [RtOrderError.badFlags]: 'Those loading options don\'t go together',
    [RtOrderError.foreignFullLoad]: 'Full load is only allowed at your own stations'
}

/** validateOrders' refusal as a toast. */
export function rtOrderErrorText(error: RtOrderError): string {
    return ORDER_ERRORS[error] ?? 'Those orders can\'t be used'
}

/* ------------------------------------------------------------------------------------------
 * Stations
 * ---------------------------------------------------------------------------------------- */

export interface RtStationCargoRow {
    cargo: number
    name: string
    /** Units waiting. */
    waiting: number
    /** Rating as a percentage, or null while the cargo has none. */
    rating: number | null
}

/** Each cargo that waits or has a rating at the station, in cargo order. */
export function rtStationCargoRows(station: RtStation): RtStationCargoRow[] {
    const rows: RtStationCargoRow[] = []
    station.cargo.forEach((entry, cargo) => {
        let waiting = 0
        for (const packet of entry.packets) waiting += packet.count
        if (waiting === 0 && !entry.hasRating) return
        rows.push({
            cargo,
            name: rtCargoName(cargo),
            waiting,
            rating: entry.hasRating ? rtPercent(entry.rating, RT_CATALOG.stationRating.max) : null
        })
    })
    return rows
}

/** The cargo indices the station accepts, summed over its catchment (computeCatchment) as the acceptance rule does. */
export function rtStationAccepts(world: RtWorld, station: RtStation): number[] {
    const sums = rtAcceptanceAround(world, computeCatchment(world.map, station))
    const out: number[] = []
    sums.forEach((sum, cargo) => {
        if (sum >= RT_ACCEPT_THRESHOLD && rtStationServesCargo(station.facilities, cargo)) out.push(cargo)
    })
    return out
}

/* ------------------------------------------------------------------------------------------
 * Query clicks (for the page)
 * ---------------------------------------------------------------------------------------- */

export type RtQueryTarget =
    | { kind: 'vehicle', id: number }
    | { kind: 'station', id: number }
    | { kind: 'buyVehicle', id: number }

/**
 * The window a query click on a tile opens: a vehicle on it first (outside depots), then the
 * station, then the depot's buy window for the player's own depot. Null for anything else, and for
 * another company's depot (buying is own-depot only).
 */
export function rtQueryTarget(world: RtWorld, company: number | null, tile: number): RtQueryTarget | null {
    const map = world.map
    if (!map.validTile(tile)) return null
    const vehicle = rtVehicleOnTile(world, tile)
    if (vehicle) return { kind: 'vehicle', id: vehicle.id }
    if (map.kind[tile] === RtTileKind.station) {
        const id = rtStationId(map.payload[tile]!)
        return world.station(id) ? { kind: 'station', id } : null
    }
    if (map.kind[tile] === RtTileKind.depot && company !== null && map.owner[tile] === company) return { kind: 'buyVehicle', id: tile }
    return null
}

/** The vehicle kind a depot tile serves, or null when the tile is not a depot. */
export function rtDepotKindAt(world: RtWorld, tile: number): RtVehicleKind | null {
    const map = world.map
    if (!map.validTile(tile) || map.kind[tile] !== RtTileKind.depot) return null
    return rtDepotKind(map.payload[tile]!) === RtVehicleKind.road ? RtVehicleKind.road : RtVehicleKind.rail
}

/* ------------------------------------------------------------------------------------------
 * Minimap
 * ---------------------------------------------------------------------------------------- */

/** Minimap width in CSS pixels; the height is half of it (the map is drawn as the main view's diamond). */
export const RT_MINIMAP_WIDTH = 512

/** CSS pixels per tile step along a map axis, so the whole map fills RT_MINIMAP_WIDTH. */
export function rtMinimapScale(side: number): number {
    return RT_MINIMAP_WIDTH / (2 * side)
}

/** World pixels per minimap pixel: the main view's tile is 64 wide, the minimap's 2 * scale. */
function worldPerPixel(side: number): number {
    return 32 / rtMinimapScale(side)
}

/** Where a main-view world point lies on the minimap (CSS pixels from its top-left). */
export function rtMinimapFromWorld(side: number, wx: number, wy: number): { x: number, y: number } {
    const k = worldPerPixel(side)
    return { x: wx / k + RT_MINIMAP_WIDTH / 2, y: wy / k }
}

/** The main-view world point under a minimap point (heights ignored). */
export function rtMinimapToWorld(side: number, mx: number, my: number): { x: number, y: number } {
    const k = worldPerPixel(side)
    return { x: (mx - RT_MINIMAP_WIDTH / 2) * k, y: my * k }
}

const GRASS_LOW = [0x4a, 0x7a, 0x2e]
const GRASS_HIGH = [0xa8, 0xc0, 0x6a]
const MINIMAP = {
    water: 0x2f5fa8,
    coast: 0xc8b878,
    tree: 0x2c5a1e,
    house: 0xb4a48c,
    townRoad: 0x9a9a9a,
    unknown: 0x6b6b6b
}
const INDUSTRY_COLOURS: Record<string, number> = {
    coalMine: 0x2a2a2a,
    powerStation: 0xc0392b,
    forest: 0x1e4d14,
    sawmill: 0xa0663a
}

function rgb(r: number, g: number, b: number): number {
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}

/** A company's colour as 0xRRGGBB, grey for none. */
function ownerColour(world: RtWorld, owner: number): number {
    if (owner === RT_OWNER_NONE) return MINIMAP.townRoad
    const company = world.company(owner)
    return (company ? RT_CATALOG.companies.colours[company.colour] : undefined) ?? MINIMAP.unknown
}

/**
 * A tile's minimap colour (0xRRGGBB): grass shaded by height, water, coast, trees, houses,
 * industries by type, and rail, roads, stations and depots in their owner's colour (town roads grey).
 */
export function rtMinimapColour(world: RtWorld, tile: number): number {
    const map = world.map
    switch (map.kind[tile]) {
        case RtTileKind.water: return MINIMAP.water
        case RtTileKind.coast: return MINIMAP.coast
        case RtTileKind.tree: return MINIMAP.tree
        case RtTileKind.house: return MINIMAP.house
        case RtTileKind.industry: {
            const industry = world.industry(map.payload[tile]!)
            const type = industry ? RT_INDUSTRY_TYPE_IDS[industry.type] : undefined
            return (type ? INDUSTRY_COLOURS[type] : undefined) ?? MINIMAP.unknown
        }
        case RtTileKind.rail:
        case RtTileKind.road:
        case RtTileKind.station:
        case RtTileKind.depot:
            return ownerColour(world, map.owner[tile]!)
        default: {
            const t = Math.min(1, map.tileHeight(tile) / 10)
            return rgb(
                GRASS_LOW[0]! + (GRASS_HIGH[0]! - GRASS_LOW[0]!) * t,
                GRASS_LOW[1]! + (GRASS_HIGH[1]! - GRASS_LOW[1]!) * t,
                GRASS_LOW[2]! + (GRASS_HIGH[2]! - GRASS_LOW[2]!) * t
            )
        }
    }
}
