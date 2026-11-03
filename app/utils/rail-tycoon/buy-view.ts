// Rail Tycoon — what the depot's buy window shows: the models a depot sells, the consist a purchase
// sends and its totals, and the vehicles standing in the depot.

import type { RtVehicleModelSpec } from '#shared/utils/rail-tycoon/catalog'
import { rtDepotKind } from '#shared/utils/rail-tycoon/depots'
import { RtTileKind } from '#shared/utils/rail-tycoon/map'
import { RtVehicleKind, RtVehicleState, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import {
    RT_VEHICLE_MODELS,
    rtConsistCapacity,
    rtConsistCost,
    rtConsistLengthTiles,
    rtConsistMaxSpeed,
    rtConsistPower,
    rtConsistRunningCost,
    rtConsistWeight,
    rtMaxWagons
} from '#shared/utils/rail-tycoon/vehicles'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'
import { rtCargoName } from './view-format'

/** The models a depot of this kind sells as the lead vehicle: locomotives, or road vehicles. */
export function rtBuyableModels(kind: RtVehicleKind): RtVehicleModelSpec[] {
    return RT_VEHICLE_MODELS.filter(spec => kind === RtVehicleKind.rail ? spec.role === 'engine' : spec.role === 'road')
}

/** Every wagon model, one per cargo. */
export function rtWagonModels(): RtVehicleModelSpec[] {
    return RT_VEHICLE_MODELS.filter(spec => spec.role === 'wagon')
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

/** The vehicle kind a depot tile serves, or null when the tile is not a depot. */
export function rtDepotKindAt(world: RtWorld, tile: number): RtVehicleKind | null {
    const map = world.map
    if (!map.validTile(tile) || map.kind[tile] !== RtTileKind.depot) return null
    return rtDepotKind(map.payload[tile]!) === RtVehicleKind.road ? RtVehicleKind.road : RtVehicleKind.rail
}
