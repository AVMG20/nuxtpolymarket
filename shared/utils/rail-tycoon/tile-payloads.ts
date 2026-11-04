/**
 * The tile payload bits that modules below stations-build.ts and depots.ts must read too, held in
 * one leaf so track.ts and road.ts read them without importing (and cycling through) the builders.
 * The full layouts are documented where they are built: road.ts, stations-build.ts, depots.ts.
 */

import { RtVehicleKind } from './types'

/** Kind of a station tile. */
export const RtStationTile = { rail: 0, bus: 1, truck: 2 } as const
export type RtStationTile = typeof RtStationTile[keyof typeof RtStationTile]

/** Platform axis: along x (track x) or along y (track y). */
export const RtAxis = { x: 0, y: 1 } as const
export type RtAxis = typeof RtAxis[keyof typeof RtAxis]

export const RT_ROAD_BITS_MASK = 15

export const RT_STATION_TYPE_SHIFT = 16
export const RT_STATION_AXIS_BIT = 1 << 18

export const RT_DEPOT_ROAD_BIT = 1
export const RT_DEPOT_FACING_SHIFT = 1

/** The road bits of a road tile (RT_ROAD_DIR_BIT, one per half-tile direction). */
export function rtRoadBits(payload: number): number {
    return payload & RT_ROAD_BITS_MASK
}

export function rtStationTileType(payload: number): RtStationTile {
    return ((payload >>> RT_STATION_TYPE_SHIFT) & 3) as RtStationTile
}

export function rtStationAxis(payload: number): RtAxis {
    return (payload & RT_STATION_AXIS_BIT) !== 0 ? RtAxis.y : RtAxis.x
}

export function rtDepotKind(payload: number): RtVehicleKind {
    return (payload & RT_DEPOT_ROAD_BIT) !== 0 ? RtVehicleKind.road : RtVehicleKind.rail
}

/** The side a depot's entrance opens towards (RtDir, 0 to 3). */
export function rtDepotFacingBits(payload: number): number {
    return (payload >>> RT_DEPOT_FACING_SHIFT) & 3
}
