/**
 * The bulldozer: one rule for everything that is not track or road. Behaviour mimics the
 * original game at its default settings; the code is written from scratch.
 */

import { RT_CATALOG } from './catalog'
import { RtTileKind, type RtMap } from './map'
import { rtDepotFacing, rtDepotReserved, rtDepotTrackFor } from './depots'
import {
    RtStationTile,
    rtFacilityOf,
    rtFindStation,
    rtPlatformReserved,
    rtPlatformTrack,
    rtRoadStopBits,
    rtRoadStopIsBay,
    rtRoadStopRoadOwner,
    rtStationId,
    rtStationTileType
} from './stations-build'
import {
    RtBuildError,
    rtBuildFail,
    rtBuildOk,
    rtClearingCost,
    rtValidCompany,
    type RtBuildResult,
    type RtOccupied,
    type RtReservationHooks,
    type RtTrack
} from './track'
import { RT_NONE, RT_OWNER_NONE, RtOrderKind, type RtStation, type RtVehicle } from './types'

/** What demolishing a station or depot reaches beyond the map and the station list. */
export interface RtDemolishContext {
    /** Every vehicle of every company, for order and packet cleanup. */
    vehicles?: RtVehicle[]
    /** Needed to remove a reserved platform or depot tile. */
    reservations?: RtReservationHooks
}

/**
 * Deletes every order of every vehicle that targets (kind, target), in ascending vehicle id, as the
 * original. A vehicle's current order index moves down past a deleted earlier order, stays on the
 * next order when its current one goes (wrapping to 0), and is 0 for an emptied list.
 */
export function rtDeleteOrdersTo(vehicles: readonly RtVehicle[], kind: RtOrderKind, target: number): void {
    const ordered = [...vehicles].sort((a, b) => a.id - b.id)
    for (const vehicle of ordered) {
        for (let i = vehicle.orders.length - 1; i >= 0; i--) {
            const order = vehicle.orders[i]!
            if (order.kind !== kind || order.target !== target) continue
            vehicle.orders.splice(i, 1)
            if (i < vehicle.orderIndex) vehicle.orderIndex--
        }
        if (vehicle.orderIndex >= vehicle.orders.length) vehicle.orderIndex = 0
        if (kind === RtOrderKind.gotoDepot && vehicle.serviceDepot === target) {
            vehicle.serviceDepot = RT_NONE
            vehicle.haltInDepot = false
        }
    }
}

/** Sets the source station of every packet loaded at a removed station to none, aboard vehicles and waiting elsewhere. */
export function rtClearPacketSource(stations: readonly RtStation[], vehicles: readonly RtVehicle[], stationId: number): void {
    for (const vehicle of vehicles) {
        for (const packet of vehicle.cargo) {
            if (packet.sourceStation === stationId) packet.sourceStation = RT_NONE
        }
    }
    for (const station of stations) {
        for (const cargo of station.cargo) {
            for (const packet of cargo.packets) {
                if (packet.sourceStation === stationId) packet.sourceStation = RT_NONE
            }
        }
    }
}

/** Takes a tile out of its station: tiles, revision, facilities and sign; deletes an emptied station. Returns whether it was deleted. */
function detachTile(map: RtMap, stations: RtStation[], station: RtStation, tile: number): boolean {
    const at = station.tiles.indexOf(tile)
    if (at >= 0) station.tiles.splice(at, 1)
    station.tilesRevision++
    if (station.tiles.length === 0) {
        const index = stations.indexOf(station)
        if (index >= 0) stations.splice(index, 1)
        return true
    }
    let facilities = 0
    for (const t of station.tiles) {
        if (map.kind[t] === RtTileKind.station) facilities |= rtFacilityOf(rtStationTileType(map.payload[t]!))
    }
    station.facilities = facilities
    if (station.sign === tile) station.sign = station.tiles[0]!
    return false
}

/**
 * Bulldozes one tile for a company. Trees: cleared at clearTrees per tree. Clear land and coast:
 * nothing to do, at no cost. An own rail station tile: taken out of its station (the station deleted
 * with its last tile) and left clear, at removeRailStation. An own drive-through road stop: taken out of
 * its station, leaving the straight road with the owner it had before the stop (a town road stays a
 * town road), at removeRoadStop; a bay stop goes with its road stub and leaves clear land, at
 * the same price. An own depot: cleared at removeDepot. Station and depot tiles are refused
 * with conflict while occupied. Deleting a station or a depot deletes every order targeting it and,
 * for a station, clears the source station of packets loaded there, given ctx.vehicles. A
 * reserved platform or depot tile first has the reserving train's reservation released ahead, and the
 * train reserves again before returning; without ctx.reservations it is refused with
 * conflict. Houses and industries are refused with occupied, water with water, town roads and other
 * companies' objects with notOwner, and own track or road with conflict (removeRail / removeRoad do those).
 */
export function demolishTile(
    map: RtMap, stations: RtStation[], owner: number, tile: number, occupied: RtOccupied, apply: boolean, ctx: RtDemolishContext = {}
): RtBuildResult {
    if (!rtValidCompany(owner) || !map.validTile(tile) || !Array.isArray(stations) || typeof occupied !== 'function') {
        return rtBuildFail(RtBuildError.invalid)
    }
    const prices = RT_CATALOG.construction
    const kind = map.kind[tile]
    switch (kind) {
        case RtTileKind.clear:
        case RtTileKind.coast:
            return rtBuildOk(0)
        case RtTileKind.tree: {
            const cost = rtClearingCost(map, tile)
            if (apply === true) map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
            return rtBuildOk(cost)
        }
        case RtTileKind.water:
            return rtBuildFail(RtBuildError.water)
        case RtTileKind.house:
        case RtTileKind.industry:
            return rtBuildFail(RtBuildError.occupied)
        case RtTileKind.rail:
        case RtTileKind.road:
            return rtBuildFail(map.owner[tile] !== owner ? RtBuildError.notOwner : RtBuildError.conflict)
        default:
            break
    }
    if (map.owner[tile] !== owner) return rtBuildFail(RtBuildError.notOwner)
    if (occupied(tile)) return rtBuildFail(RtBuildError.conflict)
    const payload = map.payload[tile]!
    const hooks = ctx.reservations

    if (kind === RtTileKind.depot) {
        const reserved = rtDepotReserved(payload)
        if (reserved && !hooks) return rtBuildFail(RtBuildError.conflict)
        const cost = prices.removeDepot
        if (apply !== true) return rtBuildOk(cost)
        const train = releaseReserver(hooks, reserved, tile, rtDepotTrackFor(rtDepotFacing(payload)))
        map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
        if (ctx.vehicles) rtDeleteOrdersTo(ctx.vehicles, RtOrderKind.gotoDepot, tile)
        if (train && hooks) hooks.reserveAgain(train)
        return rtBuildOk(cost)
    }

    // kind station
    const station = rtFindStation(stations, rtStationId(payload))
    if (!station || station.owner !== owner) return rtBuildFail(RtBuildError.invalid)
    const type = rtStationTileType(payload)
    const isPlatform = type === RtStationTile.rail
    const reserved = isPlatform && rtPlatformReserved(payload)
    if (reserved && !hooks) return rtBuildFail(RtBuildError.conflict)
    const cost = isPlatform ? prices.removeRailStation : prices.removeRoadStop
    if (apply !== true) return rtBuildOk(cost)

    const train = releaseReserver(hooks, reserved, tile, rtPlatformTrack(payload))
    // a bay goes with its road stub, as the original; a drive-through stop leaves its road
    if (isPlatform || rtRoadStopIsBay(payload)) map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
    else map.setTile(tile, RtTileKind.road, rtRoadStopRoadOwner(payload), rtRoadStopBits(payload))
    if (detachTile(map, stations, station, tile) && ctx.vehicles) {
        rtDeleteOrdersTo(ctx.vehicles, RtOrderKind.gotoStation, station.id)
        rtClearPacketSource(stations, ctx.vehicles, station.id)
    }
    if (train && hooks) hooks.reserveAgain(train)
    return rtBuildOk(cost)
}

/** When the tile is reserved, finds its train and releases the reservation ahead; returns the train. */
function releaseReserver(hooks: RtReservationHooks | undefined, reserved: boolean, tile: number, piece: RtTrack): RtVehicle | null {
    if (!reserved || !hooks) return null
    const train = hooks.reserverOf(tile, piece)
    if (train) hooks.releaseAhead(train)
    return train
}
