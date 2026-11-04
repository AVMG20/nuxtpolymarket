/**
 * What the train and road vehicle movers do alike: routes, the depot visit, the crash countdown and
 * the load step. Each mover keeps what its track or road makes different (reservations, lanes).
 */

import { RT_CATALOG } from './catalog'
import { advanceOrder, rtCurrentOrder } from './orders'
import { RT_NONE, RtOrderKind, RtVehicleState, type RtVehicle } from './types'
import { rtServiceInDepot } from './vehicles'
import type { RtWorld } from './world'

/** Route steps a vehicle may have passed before the passed part is cut off the front of its route. */
const ROUTE_COMPACT_AFTER = 256

/** What one mover tick reports to RtWorld.step. */
export interface RtVehicleStepResult {
    /** A crashed vehicle whose crash period ran out: the caller removes it (rtRemoveTrain works for both kinds). */
    remove: boolean
    /** The vehicle ran a route search this tick (for RtWorld.step's round-robin cursor). */
    searched: boolean
}

/** What happens at a stop (loading.ts supplies it). Without hooks a stop ends on the next tick. */
export interface RtVehicleHooks {
    /** The vehicle stopped at its target platform or stop. */
    arrive?(world: RtWorld, vehicle: RtVehicle, station: number): void
    /** One loading step; true when the vehicle may leave. */
    loadStep?(world: RtWorld, vehicle: RtVehicle): boolean
}

/** Points the vehicle at a new route from its head (no reservation ahead may be held). */
export function rtSetRoute(world: RtWorld, vehicle: RtVehicle, route: number[]): void {
    vehicle.route = route.slice(0, RT_CATALOG.caps.maxRouteLength)
    vehicle.routeIndex = 0
    vehicle.reservedEnd = 0
    vehicle.routeTick = world.tick
}

/** Cuts the steps already driven off the front of a long route, once none of them is reserved. */
export function rtCompactRoute(vehicle: RtVehicle): void {
    if (vehicle.routeIndex <= ROUTE_COMPACT_AFTER || vehicle.routeIndex < vehicle.reservedEnd) return
    vehicle.route.splice(0, vehicle.routeIndex)
    vehicle.routeIndex = 0
    vehicle.reservedEnd = 0
}

/**
 * Whether the vehicle has just left `station` and still stands on it: after loading, loadingStation
 * keeps the station until the head is off its platform or stop, and a vehicle never stops twice in a
 * row at one station, as the original (a single-order vehicle drives on and comes back round).
 */
export function rtJustLeft(vehicle: RtVehicle, station: number): boolean {
    return vehicle.state !== RtVehicleState.loading && station !== RT_NONE && vehicle.loadingStation === station
}

/** The vehicle's state read through a call: TypeScript narrows vehicle.state from earlier checks, but a move changes it. */
export function rtStateOf(vehicle: RtVehicle): RtVehicleState {
    return vehicle.state
}

/**
 * The vehicle drives into `depot`: it leaves the network (the caller has released any reservation),
 * stands inside on `piece`, is serviced and runs its depot order. Sent by sendToDepot, it stops
 * inside until started. Every tile it left, and the depot, go to `mark`.
 */
export function rtArriveInDepot(world: RtWorld, vehicle: RtVehicle, depot: number, piece: number, mark: (tile: number) => void): void {
    for (const tile of vehicle.tiles) mark(tile)
    world.occupied.releaseVehicle(vehicle.id)
    world.occupied.enterDepot(vehicle.id, depot)
    mark(depot)
    vehicle.state = RtVehicleState.inDepot
    vehicle.tiles = [depot]
    vehicle.pieces = [piece]
    vehicle.direction = piece
    vehicle.progress = 0
    vehicle.speed = 0
    vehicle.subspeed = 0
    vehicle.route = []
    vehicle.routeIndex = 0
    vehicle.reservedEnd = 0
    vehicle.routeTick = RT_NONE
    const halt = vehicle.haltInDepot
    vehicle.haltInDepot = false
    rtServiceInDepot(world, vehicle, depot, world.tick)
    const order = rtCurrentOrder(vehicle)
    if (order && order.kind === RtOrderKind.gotoDepot && order.target === depot) advanceOrder(vehicle, world.stations, world.map)
    if (halt) vehicle.stopped = true
}

/** A crashed vehicle counts its crash period down; true while it is crashed, with `remove` set once the period runs out. */
export function rtCrashCountdown(vehicle: RtVehicle, result: RtVehicleStepResult): boolean {
    if (vehicle.state !== RtVehicleState.crashed) return false
    vehicle.crashTicks = Math.max(0, vehicle.crashTicks - 1)
    result.remove = vehicle.crashTicks === 0
    return true
}

/** One loading tick; once loading is done the vehicle drives on to its next order (loadingStation stays, see rtJustLeft). */
export function rtLoadTick(world: RtWorld, vehicle: RtVehicle, hooks: RtVehicleHooks | undefined): void {
    const done = hooks?.loadStep ? hooks.loadStep(world, vehicle) : true
    if (!done) return
    vehicle.state = RtVehicleState.driving
    advanceOrder(vehicle, world.stations, world.map)
    vehicle.routeTick = RT_NONE
}
