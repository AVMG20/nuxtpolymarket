/**
 * Vehicle orders: checking an order list a client sends and stepping through it. Behaviour
 * mimics the original game at its default settings; the code is written from scratch.
 *
 * A station order targets a station id, a depot order a depot tile index (depots are tiles, not
 * entities). A depot order always means "service there and continue"; it carries no flags. Removing
 * a station or depot deletes every order to it (rtDeleteOrdersTo in demolish.ts).
 */

import { RT_CATALOG, RT_VEHICLE_MODEL_IDS } from './catalog'
import { rtDepotKind } from './depots'
import { RtTileKind, type RtMap } from './map'
import { rtValidCompany } from './track'
import { RT_NONE, RtFacility, RtOrderFlag, RtOrderKind, RtVehicleKind, type RtOrder, type RtStation, type RtVehicle } from './types'

/** Orders one vehicle may hold; setOrders refuses a longer list. */
export const RT_MAX_ORDERS = RT_CATALOG.caps.maxOrders

/** Every RtOrderFlag bit together. */
export const RT_ORDER_FLAG_MASK = RtOrderFlag.fullLoad | RtOrderFlag.unload | RtOrderFlag.noUnload

export const RtOrderError = {
    /** Not a list of well-formed orders: wrong types, unknown kind, a target or flags out of range. */
    invalid: 0,
    /** More than RT_MAX_ORDERS orders. */
    tooMany: 1,
    /** The target station or depot does not exist. */
    noTarget: 2,
    /** The target belongs to another company and sharing is off. */
    notOwner: 3,
    /** The vehicle cannot use the target: a station without its kind of stop or platform, a depot of the other kind. */
    unusable: 4,
    /** Flags that cannot go together (unload with no-unload) or flags on a depot order. */
    badFlags: 5,
    /** Full load at another company's station. */
    foreignFullLoad: 6
} as const
export type RtOrderError = typeof RtOrderError[keyof typeof RtOrderError]

/** validateOrders' outcome: fresh, normalised orders, or the first refusal and the order index it hit (-1 for the list itself). */
export type RtOrdersResult = { ok: true, orders: RtOrder[] } | { ok: false, error: RtOrderError, index: number }

/** What validateOrders needs of the vehicle the orders are for. */
export type RtOrderVehicle = Pick<RtVehicle, 'kind' | 'model'>

/** The station with this id in a list indexed by id (RtWorld.stations) or kept in ascending id order, or undefined. */
export function rtStationById(stations: readonly (RtStation | null)[], id: number): RtStation | undefined {
    if (!Number.isInteger(id) || id < 0) return undefined
    const direct = stations[id]
    if (direct && direct.id === id) return direct
    for (const station of stations) if (station && station.id === id) return station
    return undefined
}

/**
 * The RtFacility a vehicle stops at, as the original: a train at a rail platform, a passenger
 * road vehicle at a bus stop and every other road vehicle at a truck stop. 0 for an unknown model.
 */
export function rtVehicleFacility(vehicle: RtOrderVehicle): number {
    if (vehicle.kind === RtVehicleKind.rail) return RtFacility.rail
    const id = RT_VEHICLE_MODEL_IDS[vehicle.model]
    if (vehicle.kind !== RtVehicleKind.road || id === undefined) return 0
    const cargo = RT_CATALOG.vehicles.models[id].cargo
    return cargo === 'passengers' ? RtFacility.busStop : RtFacility.truckStop
}

/** Whether the tile is a depot for that vehicle kind. */
function depotOfKind(map: RtMap, tile: number, kind: number): boolean {
    return map.kind[tile] === RtTileKind.depot && rtDepotKind(map.payload[tile]!) === kind
}

/** Whether an order's target exists: a live station, or a depot tile of any kind. */
export function rtOrderTargetExists(order: RtOrder, stations: readonly (RtStation | null)[], depots: RtMap): boolean {
    if (order.kind === RtOrderKind.gotoStation) return rtStationById(stations, order.target) !== undefined
    return order.kind === RtOrderKind.gotoDepot && depots.validTile(order.target) && depots.kind[order.target] === RtTileKind.depot
}

function isNonNegativeInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** Checks one order, returning the normalised copy or the refusal. */
function checkOrder(
    raw: unknown, stations: readonly (RtStation | null)[], depots: RtMap, owner: number, sharing: boolean, vehicle: RtOrderVehicle
): RtOrder | RtOrderError {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return RtOrderError.invalid
    const { kind, target, flags } = raw as Record<string, unknown>
    if (!isNonNegativeInt(target) || !isNonNegativeInt(flags) || (flags & ~RT_ORDER_FLAG_MASK) !== 0) return RtOrderError.invalid

    if (kind === RtOrderKind.gotoStation) {
        if ((flags & RtOrderFlag.unload) !== 0 && (flags & RtOrderFlag.noUnload) !== 0) return RtOrderError.badFlags
        const station = rtStationById(stations, target)
        if (!station) return RtOrderError.noTarget
        const foreign = station.owner !== owner
        if (foreign && !sharing) return RtOrderError.notOwner
        const facility = rtVehicleFacility(vehicle)
        if (facility === 0 || (station.facilities & facility) === 0) return RtOrderError.unusable
        if (foreign && (flags & RtOrderFlag.fullLoad) !== 0) return RtOrderError.foreignFullLoad
        return { kind: RtOrderKind.gotoStation, target, flags }
    }

    if (kind === RtOrderKind.gotoDepot) {
        if (flags !== 0) return RtOrderError.badFlags
        if (!depots.validTile(target) || depots.kind[target] !== RtTileKind.depot) return RtOrderError.noTarget
        if (depots.owner[target] !== owner && !sharing) return RtOrderError.notOwner
        if (!depotOfKind(depots, target, vehicle.kind)) return RtOrderError.unusable
        return { kind: RtOrderKind.gotoDepot, target, flags: 0 }
    }
    return RtOrderError.invalid
}

/**
 * Checks an order list a client sent for one vehicle of `owner` (the setOrders command). An empty list
 * is valid: the vehicle keeps driving without a destination. At most RT_MAX_ORDERS. With
 * sharing off every target must belong to the owner; with sharing on a station order may
 * target any company's station and a depot order any company's depot, for servicing only. Every
 * station must have the facility the vehicle stops at (rtVehicleFacility) and every depot must be of
 * the vehicle's kind, as the original. Full load at another company's station is refused.
 * Returns fresh copies, so the caller may store them. Never throws on hostile input.
 */
export function validateOrders(
    orders: unknown, stations: readonly (RtStation | null)[], depots: RtMap, owner: number, sharing: boolean, vehicle: RtOrderVehicle
): RtOrdersResult {
    try {
        if (!Array.isArray(orders) || !rtValidCompany(owner) || !Array.isArray(stations)) {
            return { ok: false, error: RtOrderError.invalid, index: -1 }
        }
        if (orders.length > RT_MAX_ORDERS) return { ok: false, error: RtOrderError.tooMany, index: -1 }
        const result: RtOrder[] = []
        for (let k = 0; k < orders.length; k++) {
            const order = checkOrder(orders[k], stations, depots, owner, sharing === true, vehicle)
            if (typeof order === 'number') return { ok: false, error: order, index: k }
            result.push(order)
        }
        return { ok: true, orders: result }
    } catch {
        // a hostile value whose property access throws (a proxy, a getter) is just malformed
        return { ok: false, error: RtOrderError.invalid, index: -1 }
    }
}

/** The vehicle's current order, or null for an empty list. */
export function rtCurrentOrder(vehicle: RtVehicle): RtOrder | null {
    return vehicle.orders[vehicle.orderIndex] ?? null
}

/**
 * Moves a vehicle on to its next order, wrapping after the last (the original's order cycle), and
 * returns that order. An empty list keeps index 0 and returns null: the vehicle has no destination
 * and keeps driving. A missing target cannot happen in a well-formed world (deleting a
 * station or depot deletes its orders); should one appear it returns null rather than throw,
 * so the vehicle drives on as if orderless, and the tests' rescan reports the corrupt state. Changing
 * the order marks the cached route stale (routeTick RT_NONE) so the movement rules plan anew.
 */
export function advanceOrder(vehicle: RtVehicle, stations: readonly (RtStation | null)[], depots: RtMap): RtOrder | null {
    const count = vehicle.orders.length
    if (count === 0) {
        vehicle.orderIndex = 0
        return null
    }
    vehicle.orderIndex = vehicle.orderIndex >= 0 && vehicle.orderIndex < count - 1 ? vehicle.orderIndex + 1 : 0
    vehicle.routeTick = RT_NONE
    const order = vehicle.orders[vehicle.orderIndex]!
    return rtOrderTargetExists(order, stations, depots) ? order : null
}

/**
 * Stores a validated order list on a vehicle (the setOrders command): the current index stays where it
 * was while it is still in range, else restarts at 0; the cached route is marked stale.
 */
export function rtReplaceOrders(vehicle: RtVehicle, orders: readonly RtOrder[]): void {
    vehicle.orders = orders.map(order => ({ kind: order.kind, target: order.target, flags: order.flags }))
    if (vehicle.orderIndex < 0 || vehicle.orderIndex >= vehicle.orders.length) vehicle.orderIndex = 0
    vehicle.routeTick = RT_NONE
}
