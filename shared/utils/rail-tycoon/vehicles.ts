/**
 * Vehicles: buying, selling and ageing; reliability, breakdowns, servicing and
 * running cost; movement joins this file later. Behaviour mimics the original game at its default settings; the code is
 * written from scratch.
 *
 * A vehicle inside a depot (state inDepot) holds tiles [depot tile], pieces [facing] and direction
 * facing, where facing is the depot's RtDir (the way out), for trains and road vehicles alike. The
 * movement rules replace them with a trackdir or road direction as the vehicle leaves the depot.
 */

import { RT_CARGO_IDS, RT_CATALOG, RT_VEHICLE_MODEL_IDS, type RtVehicleModelSpec } from './catalog'
import { rtDepotFacing, rtDepotKind } from './depots'
import { chargeSharing, depotSharingFee, type RtSharingWorld } from './economy'
import { RtTileKind, type RtDir, type RtMap } from './map'
import type { SeededRandom } from '../random'
import { RtBuildError, rtValidCompany } from './track'
import { RT_NONE, RtOrderKind, RtVehicleKind, RtVehicleState, type RtCompany, type RtVehicle } from './types'

/** Every vehicle model, by its numeric index (RtVehicle.model and consist entries). */
export const RT_VEHICLE_MODELS: readonly RtVehicleModelSpec[] = Object.freeze(
    RT_VEHICLE_MODEL_IDS.map(id => RT_CATALOG.vehicles.models[id])
)

/** The model with that index, or undefined for anything that is not one. */
export function rtModelSpec(index: unknown): RtVehicleModelSpec | undefined {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return undefined
    return RT_VEHICLE_MODELS[index]
}

/** The vehicle kind a model belongs to. */
export function rtModelKind(spec: RtVehicleModelSpec): RtVehicleKind {
    return spec.kind === 'rail' ? RtVehicleKind.rail : RtVehicleKind.road
}

/** Cargo index a model carries, or RT_NONE for a locomotive. */
export function rtModelCargo(spec: RtVehicleModelSpec): number {
    return spec.cargo === null ? RT_NONE : RT_CARGO_IDS.indexOf(spec.cargo)
}

/* ------------------------------------------------------------------------------------------
 * Consist properties, derived from the part list (engine first)
 * ---------------------------------------------------------------------------------------- */

/** Half tiles a consist covers: every engine and wagon takes halfTilesPerVehicle. */
export function rtConsistHalfTiles(consist: readonly number[]): number {
    return consist.length * RT_CATALOG.vehicles.halfTilesPerVehicle
}

/** Whole tiles a consist covers, rounded up: an engine and three wagons are two tiles long. */
export function rtConsistLengthTiles(consist: readonly number[]): number {
    return Math.ceil(rtConsistHalfTiles(consist) / 2)
}

/** Capacity per cargo index (RT_CARGO_IDS order), summed over the parts. */
export function rtConsistCapacity(consist: readonly number[]): number[] {
    const capacity = RT_CARGO_IDS.map(() => 0)
    for (const part of consist) {
        const spec = RT_VEHICLE_MODELS[part]
        if (!spec || spec.cargo === null) continue
        capacity[rtModelCargo(spec)]! += spec.capacity
    }
    return capacity
}

/** Purchase price of every part together (money). */
export function rtConsistCost(consist: readonly number[]): number {
    let cost = 0
    for (const part of consist) cost += RT_VEHICLE_MODELS[part]?.cost ?? 0
    return cost
}

/** Running cost per year of running ticks, summed over the engines (money); wagons cost nothing to run. */
export function rtConsistRunningCost(consist: readonly number[]): number {
    let cost = 0
    for (const part of consist) cost += RT_VEHICLE_MODELS[part]?.runningCost ?? 0
    return cost
}

/** Top speed: the lowest limit among the parts that set one (km/h); wagons set none. */
export function rtConsistMaxSpeed(consist: readonly number[]): number {
    let speed = 0
    for (const part of consist) {
        const limit = RT_VEHICLE_MODELS[part]?.maxSpeed ?? 0
        if (limit > 0 && (speed === 0 || limit < speed)) speed = limit
    }
    return speed
}

/** Summed power of the parts (hp). */
export function rtConsistPower(consist: readonly number[]): number {
    let power = 0
    for (const part of consist) power += RT_VEHICLE_MODELS[part]?.power ?? 0
    return power
}

/** Summed empty weight of the parts (tonnes). */
export function rtConsistWeight(consist: readonly number[]): number {
    let weight = 0
    for (const part of consist) weight += RT_VEHICLE_MODELS[part]?.weight ?? 0
    return weight
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

/**
 * The consist a purchase builds, engine first, or the reason it cannot: invalid for an unknown
 * model, a wagon as the lead model, a part that is not a wagon, wagons behind a road vehicle or a
 * wagons value that is not an array; limit for more wagons than rtMaxWagons (maxTrainVehicles parts
 * within maxTrainLength tiles). Never throws on hostile input.
 */
export function rtPurchaseConsist(model: unknown, wagons: unknown): number[] | RtBuildError {
    const lead = rtModelSpec(model)
    if (!lead || lead.role === 'wagon') return RtBuildError.invalid
    if (!Array.isArray(wagons)) return RtBuildError.invalid
    if (lead.role === 'road') return wagons.length === 0 ? [lead.index] : RtBuildError.invalid
    if (wagons.length > rtMaxWagons(lead.index)) return RtBuildError.limit
    const consist = [lead.index]
    for (let k = 0; k < wagons.length; k++) {
        const spec = rtModelSpec(wagons[k])
        if (!spec || spec.role !== 'wagon') return RtBuildError.invalid
        consist.push(spec.index)
    }
    return consist
}

/* ------------------------------------------------------------------------------------------
 * createVehicle
 * ---------------------------------------------------------------------------------------- */

/**
 * A newly bought vehicle, stopped inside its depot as the original: empty orders, full purchase
 * reliability, no profit, value equal to its price and capacity from the model and wagons. Inputs
 * must already be valid (rtPurchaseConsist, or buyVehicle which checks everything); anything else
 * is a programming error and throws RangeError.
 */
export function createVehicle(
    id: number, owner: number, model: number, wagons: readonly number[], depotTile: number, facing: RtDir, tick: number
): RtVehicle {
    if (!Number.isInteger(id) || id < 0) throw new RangeError(`bad vehicle id: ${id}`)
    if (!rtValidCompany(owner)) throw new RangeError(`bad owner: ${owner}`)
    if (!Number.isInteger(depotTile) || depotTile < 0) throw new RangeError(`bad depot tile: ${depotTile}`)
    if (!Number.isInteger(facing) || facing < 0 || facing > 3) throw new RangeError(`bad facing: ${facing}`)
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError(`bad tick: ${tick}`)
    const consist = rtPurchaseConsist(model, wagons)
    if (!Array.isArray(consist)) throw new RangeError(`bad consist: model ${model}, wagons ${String(wagons)}`)
    const kind = rtModelKind(RT_VEHICLE_MODELS[model]!)
    return {
        id,
        owner,
        kind,
        model,
        consist,
        wagonCount: consist.length - 1,
        tiles: [depotTile],
        pieces: [facing],
        direction: facing,
        progress: 0,
        speed: 0,
        subspeed: 0,
        route: [],
        routeIndex: 0,
        routeTick: RT_NONE,
        reservedEnd: 0,
        orders: [],
        orderIndex: 0,
        state: RtVehicleState.inDepot,
        stopped: true,
        loadTicks: 0,
        loadingStation: RT_NONE,
        cargo: [],
        reliability: RT_CATALOG.vehicles.reliabilityMax,
        breakdownChance: 0,
        breakdownTicks: 0,
        breakdownsSinceService: 0,
        lastServiceTick: tick,
        serviceDepot: RT_NONE,
        haltInDepot: false,
        runningTicks: 0,
        lost: false,
        lostRetryTick: RT_NONE,
        blockedTicks: 0,
        waitTicks: 0,
        crashTicks: 0,
        age: 0,
        value: rtConsistCost(consist),
        profitThisYear: 0,
        profitLastYear: 0
    }
}

/* ------------------------------------------------------------------------------------------
 * Buying and selling (the rules here, the money in applyCommand)
 * ---------------------------------------------------------------------------------------- */

/** What buying and selling reach in the world; RtWorld satisfies it. */
export interface RtVehicleWorld {
    readonly map: RtMap
    readonly tick: number
    readonly companies: readonly (RtCompany | null)[]
    readonly vehicles: readonly (RtVehicle | null)[]
    readonly occupied: { enterDepot(vehicle: number, tile: number): void }
    freeVehicleId(): number
    insertVehicle(vehicle: RtVehicle): void
    removeVehicle(id: number): RtVehicle | null
}

/**
 * A vehicle rule's outcome: the signed cost (a refund is negative) and the vehicle id bought or
 * sold, or the RtBuildError refusing it. Rules never touch money; applyCommand checks cash and books.
 */
export type RtVehicleResult = { ok: true, cost: number, vehicle: number } | { ok: false, error: RtBuildError }

function vehicleFail(error: RtBuildError): RtVehicleResult {
    return { ok: false, error }
}

/** Live vehicles a company owns (count). */
export function rtCompanyVehicleCount(vehicles: readonly (RtVehicle | null)[], owner: number): number {
    let count = 0
    for (const vehicle of vehicles) if (vehicle && vehicle.owner === owner) count++
    return count
}

/**
 * Buys a vehicle into an own depot, as the original: the new vehicle is stopped inside it. For a
 * train, model is the locomotive and wagons the wagon models behind it, engine plus wagons at most
 * maxTrainVehicles; a road vehicle takes no wagons. Refused with invalid for a bad owner, an owner
 * without a company, a tile off the map or not a depot, or an unusable model or wagon list; notOwner
 * for another company's depot (buying is own-depot only, also with sharing); conflict for a
 * depot of the other vehicle kind; limit at maxVehiclesPerCompany, at the world's vehicle cap or for
 * a consist past maxTrainLength. The cost is the summed price of the parts. With apply true the
 * vehicle takes the lowest free id, enters the world and occupies the depot. Never throws on
 * hostile input.
 */
export function buyVehicle(
    world: RtVehicleWorld, owner: unknown, depotTile: unknown, model: unknown, wagons: unknown, apply: boolean
): RtVehicleResult {
    if (typeof owner !== 'number' || !rtValidCompany(owner) || !world.companies[owner]) return vehicleFail(RtBuildError.invalid)
    if (typeof depotTile !== 'number' || !world.map.validTile(depotTile)) return vehicleFail(RtBuildError.invalid)
    const consist = rtPurchaseConsist(model, wagons)
    if (!Array.isArray(consist)) return vehicleFail(consist)
    const map = world.map
    if (map.kind[depotTile] !== RtTileKind.depot) return vehicleFail(RtBuildError.invalid)
    if (map.owner[depotTile] !== owner) return vehicleFail(RtBuildError.notOwner)
    const payload = map.payload[depotTile]!
    const kind = rtModelKind(RT_VEHICLE_MODELS[consist[0]!]!)
    if (rtDepotKind(payload) !== kind) return vehicleFail(RtBuildError.conflict)
    if (rtCompanyVehicleCount(world.vehicles, owner) >= RT_CATALOG.caps.maxVehiclesPerCompany) return vehicleFail(RtBuildError.limit)
    const id = world.freeVehicleId()
    if (id === RT_NONE) return vehicleFail(RtBuildError.limit)
    const cost = rtConsistCost(consist)
    if (apply === true) {
        const vehicle = createVehicle(id, owner, consist[0]!, consist.slice(1), depotTile, rtDepotFacing(payload), world.tick)
        world.insertVehicle(vehicle)
        world.occupied.enterDepot(id, depotTile)
    }
    return { ok: true, cost, vehicle: id }
}

/** What selling a vehicle refunds: sellRefundPercent of its current value, rounded down (money). */
export function rtVehicleSellValue(vehicle: RtVehicle): number {
    return Math.floor(Math.max(0, vehicle.value) * RT_CATALOG.economy.sellRefundPercent / 100)
}

/**
 * Sells a vehicle, as the original: only its owner, only stopped inside a depot, never once
 * crashed. The cost is the negative of rtVehicleSellValue. Refused with invalid for an unknown
 * vehicle or bad owner, notOwner for another company's vehicle and conflict for a crashed vehicle
 * or one not stopped in a depot. With apply true the vehicle leaves the world, freeing its id and
 * depot place; signal refresh and reservations are the caller's. Never throws on hostile input.
 */
export function sellVehicle(world: RtVehicleWorld, owner: unknown, vehicleId: unknown, apply: boolean): RtVehicleResult {
    if (typeof owner !== 'number' || !rtValidCompany(owner)) return vehicleFail(RtBuildError.invalid)
    if (typeof vehicleId !== 'number' || !Number.isInteger(vehicleId) || vehicleId < 0) return vehicleFail(RtBuildError.invalid)
    const vehicle = world.vehicles[vehicleId]
    if (!vehicle) return vehicleFail(RtBuildError.invalid)
    if (vehicle.owner !== owner) return vehicleFail(RtBuildError.notOwner)
    if (vehicle.state !== RtVehicleState.inDepot || !vehicle.stopped) return vehicleFail(RtBuildError.conflict)
    const cost = -rtVehicleSellValue(vehicle)
    if (apply === true) world.removeVehicle(vehicleId)
    return { ok: true, cost, vehicle: vehicleId }
}

/**
 * One game day of ageing, as the original: age grows by a day and every valueDecayDays days the
 * value loses value >> valueDecayShift. The daily vehicle step calls it.
 */
export function rtAgeVehicleDay(vehicle: RtVehicle): void {
    const economy = RT_CATALOG.economy
    vehicle.age++
    if (vehicle.age % economy.valueDecayDays === 0) {
        vehicle.value -= Math.floor(Math.max(0, vehicle.value) / 2 ** economy.valueDecayShift)
    }
}

/* ------------------------------------------------------------------------------------------
 * Reliability, breakdowns and servicing
 *
 * The original's daily vehicle step at its default "reduced" breakdowns: reliability falls by the
 * model's decay every day (not while loading), a moving vehicle's breakdown chance creeps up and is
 * tested against a table indexed by reliability, and a breakdown stands the vehicle still for a
 * random delay. A vehicle past its service interval heads for a depot near its way; any depot visit
 * restores reliability. Differences from the original: a breakdown starts on the day it is rolled
 * (the original counts down up to about a hundred ticks first), and reliability decay does not
 * double with age, because the catalog has no maximum age.
 * ---------------------------------------------------------------------------------------- */

/** Reliability and the breakdown chance are a u16 and a u8 in the original. */
const RELIABILITY_LIMIT = 0xffff
const BREAKDOWN_CHANCE_LIMIT = 0xff
/** breakdownsSinceService saturates here, as the original's u8 counter. */
const BREAKDOWN_COUNT_LIMIT = 0xff
/** Reliability table index: reliability >> 10 picks one of the 64 breakdownChance entries. */
const RELIABILITY_TABLE_SHIFT = 10
/**
 * A vehicle already heading for a service depot switches to a different nearer one with this
 * chance per day: 3 in 16 for trains, 1 in 20 for road vehicles (the original's rules).
 */
const TRAIN_DEPOT_SWITCH = { numerator: 3, denominator: 16 } as const
const ROAD_DEPOT_SWITCH = { numerator: 1, denominator: 20 } as const

/** The tick within each game day on which a vehicle's daily step runs: its id modulo dayTicks, as the original spreads its day procs. */
export function rtVehicleDayPhase(vehicleId: number): number {
    return vehicleId % RT_CATALOG.time.dayTicks
}

/** Whether `tick` is the tick of the vehicle's daily step (once per game day, staggered by id). */
export function rtIsVehicleDayTick(vehicleId: number, tick: number): boolean {
    return tick % RT_CATALOG.time.dayTicks === rtVehicleDayPhase(vehicleId)
}

/** The game day a tick falls in (days since the world was created). */
function gameDay(tick: number): number {
    return Math.floor(tick / RT_CATALOG.time.dayTicks)
}

/**
 * Whether the vehicle is due for a service, as the original's NeedsServicing: it runs (neither
 * stopped nor crashed) and more than its model's serviceDays whole days have passed since the day of
 * its last service. A vehicle never serviced (lastServiceTick RT_NONE) is due.
 */
export function rtVehicleNeedsService(vehicle: RtVehicle, tick: number): boolean {
    if (vehicle.stopped || vehicle.state === RtVehicleState.crashed) return false
    const spec = RT_VEHICLE_MODELS[vehicle.model]
    if (!spec) return false
    if (vehicle.lastServiceTick < 0) return true
    return gameDay(tick) > gameDay(vehicle.lastServiceTick) + spec.serviceDays
}

/**
 * Whether the vehicle should break off to a depot for a service, as the original's
 * NeedsAutomaticServicing: never while loading, never when its orders include a depot (the player
 * services it there), otherwise when rtVehicleNeedsService says so.
 */
export function rtVehicleNeedsAutoService(vehicle: RtVehicle, tick: number): boolean {
    if (vehicle.state === RtVehicleState.loading) return false
    for (const order of vehicle.orders) if (order.kind === RtOrderKind.gotoDepot) return false
    return rtVehicleNeedsService(vehicle, tick)
}

/** What servicing reaches: the map (depot owners) and the sharing world (fees); RtWorld satisfies it. */
export interface RtServiceWorld extends RtSharingWorld {
    readonly map: RtMap
}

/**
 * Services the vehicle in the depot on depotTile, as the original does on every depot visit:
 * reliability back to the purchase level, breakdowns-since-service and the breakdown chance cleared
 * (reduced breakdowns), lastServiceTick set to tick. A pending implicit visit (serviceDepot) is
 * done, so serviceDepot clears and routeTick goes stale for movement to re-plan to the current order.
 * At another company's depot the owner is paid depotSharingFee through chargeSharing;
 * returns the fee charged (money, 0 at an own depot or without sharing).
 * Movement calls it whenever a vehicle enters a depot.
 */
export function rtServiceInDepot(world: RtServiceWorld, vehicle: RtVehicle, depotTile: number, tick: number): number {
    vehicle.reliability = RT_CATALOG.vehicles.reliabilityMax
    vehicle.breakdownsSinceService = 0
    vehicle.breakdownChance = 0
    vehicle.lastServiceTick = tick
    if (vehicle.serviceDepot !== RT_NONE) {
        vehicle.serviceDepot = RT_NONE
        vehicle.routeTick = RT_NONE
    }
    const map = world.map
    if (!map.validTile(depotTile) || map.kind[depotTile] !== RtTileKind.depot) return 0
    const depotOwner = map.owner[depotTile]!
    if (depotOwner === vehicle.owner) return 0
    const fee = depotSharingFee(world)
    return chargeSharing(world, vehicle.owner, depotOwner, fee, 'depot') ? fee : 0
}

/**
 * The original's daily breakdown check. Reliability falls by the model's reliabilityDecay, clamped
 * to [0, reliabilityMax]; under reduced breakdowns nothing happens while the vehicle is loading, and
 * a road vehicle blocked by one ahead skips the check. Only a vehicle that is running (not stopped),
 * not broken down and at least breakdownMinSpeed fast rolls: its chance grows by breakdownChanceStep,
 * plus breakdownBonusStep one time in breakdownBonusDenominator, and it breaks down once the table
 * entry for (reliability + reducedBreakdownBonus) >> 10 is at or below that chance. A breakdown sets
 * breakdownTicks to breakdownDelayMin plus a random 0..breakdownDelayRandom, zeroes the chance and
 * the speed and counts the breakdown. Returns whether the vehicle broke down.
 */
export function rtCheckBreakdown(vehicle: RtVehicle, rng: SeededRandom): boolean {
    const rules = RT_CATALOG.vehicles
    if (vehicle.state === RtVehicleState.crashed || vehicle.state === RtVehicleState.loading) return false
    if (vehicle.kind === RtVehicleKind.road && vehicle.blockedTicks !== 0) return false
    const spec = RT_VEHICLE_MODELS[vehicle.model]
    if (!spec) return false

    vehicle.reliability = Math.min(rules.reliabilityMax, Math.max(0, vehicle.reliability - spec.reliabilityDecay))

    if (vehicle.breakdownTicks !== 0 || vehicle.stopped || vehicle.speed < rules.breakdownMinSpeed) return false
    let chance = vehicle.breakdownChance + rules.breakdownChanceStep
    if (rng.randomRatio(1, rules.breakdownBonusDenominator)) chance += rules.breakdownBonusStep
    vehicle.breakdownChance = Math.min(BREAKDOWN_CHANCE_LIMIT, chance)

    const reliability = Math.min(RELIABILITY_LIMIT, vehicle.reliability + rules.reducedBreakdownBonus)
    if (rules.breakdownChance[reliability >> RELIABILITY_TABLE_SHIFT]! > vehicle.breakdownChance) return false
    vehicle.breakdownTicks = rules.breakdownDelayMin + rng.randomInt(0, rules.breakdownDelayRandom)
    vehicle.breakdownChance = 0
    vehicle.breakdownsSinceService = Math.min(BREAKDOWN_COUNT_LIMIT, vehicle.breakdownsSinceService + 1)
    vehicle.speed = 0
    vehicle.subspeed = 0
    return true
}

/**
 * One tick of a breakdown: while breakdownTicks runs the vehicle stands still (speed 0) and the count
 * falls by one. Returns true while broken down, so movement skips the vehicle this tick;
 * it calls this first, every tick, for every vehicle.
 */
export function rtBreakdownTick(vehicle: RtVehicle): boolean {
    if (vehicle.breakdownTicks <= 0) return false
    vehicle.breakdownTicks--
    vehicle.speed = 0
    vehicle.subspeed = 0
    return true
}

/** What serviceAndBreakdown needs for servicing; without it only reliability and breakdowns run. */
export interface RtServiceContext {
    readonly world: RtServiceWorld
    /**
     * The depot tile the vehicle should visit for a service: the nearest one reachable without
     * straying further than the original's go-to-depot penalty from its way, or RT_NONE. The
     * pathfinder (pathfinder.ts, for trains and road vehicles) supplies it.
     */
    findServiceDepot(vehicle: RtVehicle): number
}

/** What one daily serviceAndBreakdown did. */
export interface RtServiceOutcome {
    /** The vehicle broke down today; it stands still for breakdownTicks. */
    brokeDown: boolean
    /** It was serviced in the depot it stands in. */
    serviced: boolean
    /** serviceDepot was set, switched or dropped, and routeTick went stale so movement re-plans. */
    serviceDepotChanged: boolean
    /** Sharing fee charged for a service at another company's depot (money). */
    fee: number
}

/**
 * The daily reliability and service step, once per game day per vehicle on rtIsVehicleDayTick.
 * First rtCheckBreakdown; then, with a context, the original's service check: a vehicle due for
 * an automatic service (rtVehicleNeedsAutoService) is serviced in place when it stands in a depot,
 * otherwise sent to the depot findServiceDepot names by setting serviceDepot (an implicit visit,
 * outside its orders). One already heading for another depot switches only by the original's small
 * daily chance; when no depot is near its way any more the visit is dropped. Randomness only
 * through rng (the world's). Never books money except the depot sharing fee.
 */
export function serviceAndBreakdown(vehicle: RtVehicle, rng: SeededRandom, tick: number, context?: RtServiceContext): RtServiceOutcome {
    const outcome: RtServiceOutcome = { brokeDown: false, serviced: false, serviceDepotChanged: false, fee: 0 }
    if (vehicle.state === RtVehicleState.crashed) return outcome
    outcome.brokeDown = rtCheckBreakdown(vehicle, rng)
    // a vehicle sent to a depot keeps that depot
    if (!context || vehicle.haltInDepot || !rtVehicleNeedsAutoService(vehicle, tick)) return outcome

    if (vehicle.state === RtVehicleState.inDepot) {
        const hadVisit = vehicle.serviceDepot !== RT_NONE
        outcome.fee = rtServiceInDepot(context.world, vehicle, vehicle.tiles[0] ?? RT_NONE, tick)
        outcome.serviced = true
        outcome.serviceDepotChanged = hadVisit
        return outcome
    }

    const depot = context.findServiceDepot(vehicle)
    if (depot === RT_NONE || !context.world.map.validTile(depot)) {
        if (vehicle.serviceDepot !== RT_NONE) {
            vehicle.serviceDepot = RT_NONE
            vehicle.routeTick = RT_NONE
            outcome.serviceDepotChanged = true
        }
        return outcome
    }
    if (vehicle.serviceDepot === depot) return outcome
    if (vehicle.serviceDepot !== RT_NONE) {
        const odds = vehicle.kind === RtVehicleKind.rail ? TRAIN_DEPOT_SWITCH : ROAD_DEPOT_SWITCH
        if (!rng.randomRatio(odds.numerator, odds.denominator)) return outcome
    }
    vehicle.serviceDepot = depot
    vehicle.routeTick = RT_NONE
    outcome.serviceDepotChanged = true
    return outcome
}

/* ------------------------------------------------------------------------------------------
 * Running cost (booked by RtWorld.step)
 * ---------------------------------------------------------------------------------------- */

/**
 * One tick of running-cost time, as the original: a train counts while not stopped or still
 * rolling, a road vehicle while not stopped; a crashed vehicle never. Movement or the
 * tick step calls it once per tick per vehicle.
 */
export function rtCountRunningTick(vehicle: RtVehicle): void {
    if (vehicle.state === RtVehicleState.crashed) return
    if (!vehicle.stopped || (vehicle.kind === RtVehicleKind.rail && vehicle.speed > 0)) vehicle.runningTicks++
}

/**
 * The running cost accrued by the vehicle's running ticks, as the original's daily charge:
 * rtConsistRunningCost * runningTicks / (yearDays * dayTicks), rounded down. The whole-money part is
 * returned and taken off profitThisYear; the leftover fraction stays in runningTicks as the ticks it
 * is worth, so nothing is lost over a year. Returns the cost (money, non-negative); the caller
 * books it as runningCosts (bookMoney or monthlyFinance's runningCostsAccrued), never twice.
 */
export function rtVehicleRunningCost(vehicle: RtVehicle): number {
    const ticks = vehicle.runningTicks
    if (ticks <= 0) return 0
    const yearly = rtConsistRunningCost(vehicle.consist)
    if (yearly <= 0) {
        vehicle.runningTicks = 0
        return 0
    }
    const period = RT_CATALOG.time.yearDays * RT_CATALOG.time.dayTicks
    const total = yearly * ticks
    const cost = Math.floor(total / period)
    vehicle.runningTicks = Math.floor((total - cost * period) / yearly)
    vehicle.profitThisYear -= cost
    return cost
}

/** What one daily vehicle step did: the service outcome plus the running cost to book. */
export interface RtVehicleDayOutcome extends RtServiceOutcome {
    /** Running cost accrued today, for RtWorld.step to book as runningCosts (money, non-negative). */
    runningCost: number
}

/**
 * The whole daily vehicle step in the original's order: age and value (rtAgeVehicleDay), breakdown
 * and service (serviceAndBreakdown), then the running cost (rtVehicleRunningCost). RtWorld.step calls it for
 * every live vehicle on rtIsVehicleDayTick(vehicle.id, world.tick), with world.rng.
 */
export function rtVehicleDay(vehicle: RtVehicle, rng: SeededRandom, tick: number, context?: RtServiceContext): RtVehicleDayOutcome {
    if (vehicle.state === RtVehicleState.crashed) {
        return { brokeDown: false, serviced: false, serviceDepotChanged: false, fee: 0, runningCost: 0 }
    }
    rtAgeVehicleDay(vehicle)
    const outcome = serviceAndBreakdown(vehicle, rng, tick, context)
    return { ...outcome, runningCost: rtVehicleRunningCost(vehicle) }
}
