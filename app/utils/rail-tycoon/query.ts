// Rail Tycoon — the window a query click on the map opens, for the page.

import { RtTileKind } from '#shared/utils/rail-tycoon/map'
import { rtStationId } from '#shared/utils/rail-tycoon/stations-build'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'
import { rtVehicleOnTile } from './vehicle-view'

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
