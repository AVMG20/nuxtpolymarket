// Rail Tycoon — what the vehicle and vehicle list windows show: names, status lines, cargo aboard,
// list rows, order text, order list edits and order refusals.

import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RtOrderError, rtCurrentOrder, rtStationById } from '#shared/utils/rail-tycoon/orders'
import { RtOrderFlag, RtOrderKind, RtVehicleKind, RtVehicleState, type RtOrder, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { rtConsistCapacity } from '#shared/utils/rail-tycoon/vehicles'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'
import { rtCargoName, rtPercent } from './view-format'

/* ------------------------------------------------------------------------------------------
 * Vehicles
 * ---------------------------------------------------------------------------------------- */

/** A vehicle's name: "Train 4" or "Road vehicle 9", numbered by its id. */
export function rtVehicleName(vehicle: Pick<RtVehicle, 'id' | 'kind'>): string {
    return `${vehicle.kind === RtVehicleKind.rail ? 'Train' : 'Road vehicle'} ${vehicle.id + 1}`
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
    if (!world.map.validTile(tile)) return null
    return world.vehicle(world.occupied.lowestVehicleOnTile(tile)) ?? null
}

/* ------------------------------------------------------------------------------------------
 * Order list edits: each returns a new list, the input untouched
 * ---------------------------------------------------------------------------------------- */

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
