/**
 * The bankruptcy reset, as the original removes a company: everything it built and ran comes off the
 * world. RtWorld.resetCompany then restarts the company record itself.
 */

import { rtClearPacketSource, rtDeleteOrdersTo } from './demolish'
import { bookMoney } from './economy'
import { RtTileKind, type RtMap } from './map'
import { releaseAllFor, rtReleaseAhead, rtReservedAhead, updateSignalStates } from './signals'
import {
    RtStationTile,
    rtRoadStopBits,
    rtRoadStopIsBay,
    rtRoadStopRoadOwner,
    rtStationId,
    rtStationTileType,
    rtWithRoadStopRoadOwner
} from './stations-build'
import { rtCrossingRoadBits, rtCrossingRoadOwner, rtIsCrossing, rtWithCrossingRoadOwner } from './track'
import { RT_NONE, RT_OWNER_NONE, RtOrderKind, RtVehicleKind, RtVehicleState, type RtStation, type RtVehicle } from './types'
import { rtVehicleSellValue } from './vehicles'
import type { RtWorld } from './world'

/** The road owner a tile keeps once company `id` is gone: unowned where that was the company. */
function keptRoadOwner(roadOwner: number, id: number): number {
    return roadOwner === id ? RT_OWNER_NONE : roadOwner
}

/** Whether a tile is the company's rail, platform or depot, where nobody else's train may stay. */
function isTheirTrack(map: RtMap, tile: number, id: number): boolean {
    const kind = map.kind[tile]
    return map.owner[tile] === id && (kind === RtTileKind.rail || kind === RtTileKind.station || kind === RtTileKind.depot)
}

/**
 * Its vehicles go (reservations released); another company's vehicle standing on its rail, platforms
 * or in its depots goes too, its owner refunded the sell value, in ascending vehicle id. A remaining
 * train whose path reservation runs over its track gives it up and plans again.
 */
function removeVehicles(world: RtWorld, id: number, touched: Set<number>): void {
    const map = world.map
    const drop = (vehicle: RtVehicle) => {
        releaseAllFor(map, vehicle)
        for (const tile of vehicle.tiles) touched.add(tile)
        world.removeVehicle(vehicle.id)
    }
    for (const vehicle of world.vehicleList()) {
        if (vehicle.owner === id) {
            drop(vehicle)
            continue
        }
        const inTheirDepot = vehicle.state === RtVehicleState.inDepot && map.owner[vehicle.tiles[0]!] === id
        const onTheirTrack = vehicle.kind === RtVehicleKind.rail && vehicle.tiles.some(tile => isTheirTrack(map, tile, id))
        if (!inTheirDepot && !onTheirTrack) continue
        const owner = world.company(vehicle.owner)
        if (owner) bookMoney(owner, 'newVehicles', rtVehicleSellValue(vehicle))
        drop(vehicle)
    }
    for (const vehicle of world.vehicleList()) {
        if (vehicle.kind !== RtVehicleKind.rail) continue
        if (rtReservedAhead(map, vehicle).tiles.some(tile => isTheirTrack(map, tile, id))) rtReleaseAhead(map, vehicle)
    }
}

/** A platform or a bay becomes clear land; a drive-through stop becomes plain road under its road owner. */
function removeStation(world: RtWorld, station: RtStation, id: number, touched: Set<number>): void {
    const map = world.map
    const vehicles = world.vehicleList()
    rtDeleteOrdersTo(vehicles, RtOrderKind.gotoStation, station.id)
    for (const tile of station.tiles) {
        if (!map.validTile(tile) || map.kind[tile] !== RtTileKind.station || rtStationId(map.payload[tile]!) !== station.id) continue
        const payload = map.payload[tile]!
        if (rtStationTileType(payload) === RtStationTile.rail || rtRoadStopIsBay(payload)) {
            map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
        } else {
            map.setTile(tile, RtTileKind.road, keptRoadOwner(rtRoadStopRoadOwner(payload), id), rtRoadStopBits(payload))
        }
        touched.add(tile)
    }
    world.removeStation(station.id)
    rtClearPacketSource(world.stationList(), vehicles, station.id)
}

/** One tile the company owns: depots and rail go (a crossing leaves its road), its road stays unowned. */
function freeOwnTile(world: RtWorld, tile: number, id: number): boolean {
    const map = world.map
    const kind = map.kind[tile]
    const payload = map.payload[tile]!
    if (kind === RtTileKind.depot) {
        rtDeleteOrdersTo(world.vehicleList(), RtOrderKind.gotoDepot, tile)
        map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
    } else if (kind === RtTileKind.rail && rtIsCrossing(payload)) {
        map.setTile(tile, RtTileKind.road, keptRoadOwner(rtCrossingRoadOwner(payload), id), rtCrossingRoadBits(payload))
    } else if (kind === RtTileKind.rail) {
        map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
    } else if (kind === RtTileKind.road) {
        map.setTile(tile, RtTileKind.road, RT_OWNER_NONE, payload)
    } else {
        return false
    }
    return true
}

/** Another company's crossing or stop on the company's road keeps its rail or stop, the road part unowned. */
function freeRoadPart(world: RtWorld, tile: number, id: number): boolean {
    const map = world.map
    const kind = map.kind[tile]
    const payload = map.payload[tile]!
    if (kind === RtTileKind.rail && rtIsCrossing(payload) && rtCrossingRoadOwner(payload) === id) {
        map.payload[tile] = rtWithCrossingRoadOwner(payload, RT_OWNER_NONE)
        return true
    }
    if (kind === RtTileKind.station && rtStationTileType(payload) !== RtStationTile.rail && rtRoadStopRoadOwner(payload) === id) {
        map.payload[tile] = rtWithRoadStopRoadOwner(payload, RT_OWNER_NONE)
        return true
    }
    return false
}

/**
 * Removes company `id`'s vehicles, stations, depots, signals and rail, with the order and packet
 * clean-up in demolish.ts. Its road bits stay as unowned road, so towns and others keep driving them.
 * Every remaining vehicle plans afresh, and the signals of every touched tile are refreshed.
 */
export function rtClearCompanyAssets(world: RtWorld, id: number): void {
    const map = world.map
    const touched = new Set<number>()
    removeVehicles(world, id, touched)
    for (const station of world.stationList()) {
        if (station.owner === id) removeStation(world, station, id, touched)
    }
    for (let tile = 0; tile < map.side * map.side; tile++) {
        const freed = map.owner[tile] === id ? freeOwnTile(world, tile, id) : freeRoadPart(world, tile, id)
        if (freed) touched.add(tile)
    }
    for (const vehicle of world.vehicleList()) vehicle.routeTick = RT_NONE
    const tiles = [...touched].sort((a, b) => a - b)
    for (const tile of tiles) world.markDirty(tile)
    updateSignalStates(map, world.occupied.otherTrainOn, tiles, world.settings.sharing)
}
