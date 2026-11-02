/**
 * Depot building (W22). A depot is a tile, not an entity: orders name it by tile index. Behaviour
 * mimics the original game at its default settings; the code is written from scratch.
 *
 * Depot payload (kind depot):
 *   bit  0      kind (RtVehicleKind: 0 rail, 1 road)
 *   bits 1-2    facing (RtDir), the side the entrance opens towards
 *   bit  3      reservation of the depot's track half-piece (AR-100), set and checked by reservePath (W29)
 *   bits 8-13   rail depot: the connecting track piece bit (the straight along the facing axis)
 *   bits 8-11   road depot: the connecting road bit (RT_ROAD_DIR_BIT of the facing)
 * The tile's owner byte is the depot owner.
 */

import { RT_CATALOG } from './catalog'
import { RT_ROAD_DIR_BIT, RtTileKind, type RtDir, type RtMap } from './map'
import { RtBuildError, RtTrack, rtBuildFail, rtBuildOk, rtClearingCost, rtValidCompany, type RtBuildResult } from './track'
import { RtVehicleKind } from './types'

export const RT_DEPOT_ROAD_BIT = 1
export const RT_DEPOT_FACING_SHIFT = 1
export const RT_DEPOT_RESERVED_BIT = 1 << 3
export const RT_DEPOT_LINK_SHIFT = 8

/** The straight track piece a rail depot facing dir holds: along x for north-east/south-west, else along y. */
export function rtDepotTrackFor(facing: RtDir): RtTrack {
    return (facing & 1) === 0 ? RtTrack.x : RtTrack.y
}

export function rtDepotPayload(kind: RtVehicleKind, facing: RtDir): number {
    const link = kind === RtVehicleKind.road ? RT_ROAD_DIR_BIT[facing]! : 1 << rtDepotTrackFor(facing)
    return ((kind === RtVehicleKind.road ? RT_DEPOT_ROAD_BIT : 0)
        | ((facing & 3) << RT_DEPOT_FACING_SHIFT)
        | (link << RT_DEPOT_LINK_SHIFT)) >>> 0
}

export function rtDepotKind(payload: number): RtVehicleKind {
    return (payload & RT_DEPOT_ROAD_BIT) !== 0 ? RtVehicleKind.road : RtVehicleKind.rail
}

export function rtDepotFacing(payload: number): RtDir {
    return ((payload >>> RT_DEPOT_FACING_SHIFT) & 3) as RtDir
}

/** The connecting track piece bits (rail depot) or road bit (road depot) on the depot tile. */
export function rtDepotLink(payload: number): number {
    return (payload >>> RT_DEPOT_LINK_SHIFT) & 0x3f
}

export function rtDepotReserved(payload: number): boolean {
    return (payload & RT_DEPOT_RESERVED_BIT) !== 0
}

export function rtWithDepotReservation(payload: number, reserved: boolean): number {
    return (reserved ? payload | RT_DEPOT_RESERVED_BIT : payload & ~RT_DEPOT_RESERVED_BIT) >>> 0
}

/**
 * Builds a rail or road depot (`kind` RtVehicleKind) whose entrance faces `facing`, on a flat clear
 * or tree tile (trees cleared at catalog cost); the tile in front must lie on the map. Costs
 * RT_CATALOG trainDepot or roadDepot. With apply false nothing is written.
 */
export function buildDepot(map: RtMap, owner: number, tile: number, kind: number, facing: number, apply: boolean): RtBuildResult {
    if (!rtValidCompany(owner) || !map.validTile(tile)) return rtBuildFail(RtBuildError.invalid)
    if (kind !== RtVehicleKind.rail && kind !== RtVehicleKind.road) return rtBuildFail(RtBuildError.invalid)
    if (!Number.isInteger(facing) || facing < 0 || facing > 3) return rtBuildFail(RtBuildError.invalid)
    switch (map.kind[tile]) {
        case RtTileKind.water:
            return rtBuildFail(RtBuildError.water)
        case RtTileKind.clear:
        case RtTileKind.coast:
        case RtTileKind.tree:
            break
        default:
            return rtBuildFail(RtBuildError.occupied)
    }
    if (!map.isFlat(tile)) return rtBuildFail(RtBuildError.badSlope)
    if (map.neighbour(tile, facing as RtDir) < 0) return rtBuildFail(RtBuildError.edge)
    const prices = RT_CATALOG.construction
    const cost = (kind === RtVehicleKind.rail ? prices.trainDepot : prices.roadDepot) + rtClearingCost(map, tile)
    if (apply === true) map.setTile(tile, RtTileKind.depot, owner, rtDepotPayload(kind as RtVehicleKind, facing as RtDir))
    return rtBuildOk(cost)
}
