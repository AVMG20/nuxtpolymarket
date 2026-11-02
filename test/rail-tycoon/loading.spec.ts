import { describe, expect, it } from 'vitest'
import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { buildDepot } from '#shared/utils/rail-tycoon/depots'
import { deliveryPayment, stationSharingShare } from '#shared/utils/rail-tycoon/economy'
import { loadUnload, rtLoadHooks, rtLoadStepAmount, rtLoadStepTicks } from '#shared/utils/rail-tycoon/loading'
import { RtMap } from '#shared/utils/rail-tycoon/map'
import { buildRoad } from '#shared/utils/rail-tycoon/road'
import { stepRoadVehicle } from '#shared/utils/rail-tycoon/road-vehicle'
import { RtStationTile, buildRoadStop } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_X } from '#shared/utils/rail-tycoon/track'
import {
    RT_NONE,
    RtOrderFlag,
    RtOrderKind,
    RtVehicleKind,
    type RtCargoPacket,
    type RtIndustry,
    type RtStation,
    type RtTown,
    type RtVehicle
} from '#shared/utils/rail-tycoon/types'
import { buyVehicle } from '#shared/utils/rail-tycoon/vehicles'
import { RtWorld, rtStartDate } from '#shared/utils/rail-tycoon/world'

const C = RT_CATALOG.cargos
const M = RT_CATALOG.vehicles.models
const PASSENGERS = C.passengers.index
const WOOD = C.wood.index
const COAL = C.coal.index
const STEP = RT_CATALOG.vehicles.loadAmount

function town(id: number, centre: number): RtTown {
    return {
        id, name: `Town ${id}`, centre, houseCount: 0, population: 0, growthCounter: 0, growthRate: 0, growing: false,
        activeStations: 0, receivedThisMonth: RT_CARGO_IDS.map(() => 0), receivedLastMonth: RT_CARGO_IDS.map(() => 0)
    }
}

function sawmill(id: number, origin: number): RtIndustry {
    const zeros = () => RT_CARGO_IDS.map(() => 0)
    return { id, type: RT_CATALOG.industries.sawmill.index, origin, waiting: zeros(), delivered: zeros(), producedThisMonth: zeros(), transportedThisMonth: zeros() }
}

/** A world with two companies, a town at (20, 20), a sawmill at (24, 12) and a road along y = 10. */
function setup(sharing = false) {
    const map = new RtMap(64)
    const world = new RtWorld({
        settings: { side: 64, maxCompanies: 8, sharing }, map, rngState: 99, tick: 1000,
        date: rtStartDate(), pathfinderCursor: 0, companies: [], towns: [town(0, map.idx(20, 20))],
        industries: [sawmill(0, map.idx(24, 12))], stations: [], vehicles: []
    })
    world.addCompany('A')
    world.addCompany('B')
    for (let x = 4; x <= 50; x++) buildRoad(map, 0, map.idx(x, 10), RT_ROAD_X, true)
    buildDepot(map, 0, map.idx(3, 10), RtVehicleKind.road, 2, true)
    return { world, map }
}

function stopAt(world: RtWorld, x: number, type: RtStationTile, owner = 0, y = 10): RtStation {
    const built = buildRoadStop(world.map, world.stations as RtStation[], world.towns as RtTown[], owner, world.map.idx(x, y), type, true)
    if (!built.ok) throw new Error(`stop failed (${built.error})`)
    return world.stations[(built as { station: number }).station]!
}

function vehicle(world: RtWorld, model: number, orders: RtVehicle['orders'] = []): RtVehicle {
    const bought = buyVehicle(world, 0, world.map.idx(3, 10), model, [], true)
    if (!bought.ok) throw new Error(`buy failed (${bought.error})`)
    const v = world.vehicle(bought.vehicle)!
    v.orders = orders
    return v
}

function packet(cargo: number, count: number, sourceTile: number, sourceStation = RT_NONE, transitPeriods = 0): RtCargoPacket {
    return { cargo, count, sourceTile, sourceStation, transitPeriods, feederShare: 0 }
}

function aboard(v: RtVehicle, cargo: number): number {
    return v.cargo.filter(p => p.cargo === cargo).reduce((sum, p) => sum + p.count, 0)
}

function waiting(station: RtStation, cargo: number): number {
    return station.cargo[cargo]!.packets.reduce((sum, p) => sum + p.count, 0)
}

/** Runs loading steps until done (or `max` steps), returning how many it took. */
function until(world: RtWorld, v: RtVehicle, station: RtStation, max = 100): number {
    for (let k = 1; k <= max; k++) if (loadUnload(world, v, station.id)) return k
    return -1
}

describe('rail tycoon loading and unloading', () => {
    it('pays a bus delivering 30 passengers 20 tiles from their source the deliveryPayment amount', () => {
        const { world, map } = setup()
        const stop = stopAt(world, 30, RtStationTile.bus)
        stop.acceptance = 1 << PASSENGERS
        const bus = vehicle(world, M.townBus.index, [{ kind: RtOrderKind.gotoStation, target: stop.id, flags: 0 }])
        bus.cargo = [packet(PASSENGERS, 30, map.idx(10, 10), RT_NONE, 4)]
        const company = world.companies[0]!
        const before = company.money
        const expected = deliveryPayment(PASSENGERS, 30, 20, 4)
        expect(expected).toBeGreaterThan(0)
        expect(until(world, bus, stop)).toBeGreaterThan(0)
        expect(aboard(bus, PASSENGERS)).toBe(0)
        expect(company.money - before).toBe(expected)
        expect(company.financeThisYear.roadIncome).toBe(expected)
        expect(company.monthIncome).toBe(expected)
        expect(bus.profitThisYear).toBe(expected)
        expect(world.towns[stop.town]!.receivedThisMonth[PASSENGERS]).toBe(30)
        expect(stop.lastDeliveryTick).toBe(world.tick)
    })

    it('moves loadAmount units per cargo part per step: unloading 30 takes several steps', () => {
        const { world, map } = setup()
        const stop = stopAt(world, 30, RtStationTile.bus)
        stop.acceptance = 1 << PASSENGERS
        const bus = vehicle(world, M.townBus.index)
        expect(rtLoadStepAmount(bus)).toBe(STEP)
        bus.cargo = [packet(PASSENGERS, 30, map.idx(10, 10))]
        expect(loadUnload(world, bus, stop.id)).toBe(false)
        expect(aboard(bus, PASSENGERS)).toBe(30 - STEP)
        expect(until(world, bus, stop)).toBe(Math.ceil(30 / STEP) - 1)
    })

    it('keeps cargo the station does not accept aboard, and leaves', () => {
        const { world, map } = setup()
        const stop = stopAt(world, 30, RtStationTile.truck)
        stop.acceptance = 0
        const lorry = vehicle(world, M.coalLorry.index)
        lorry.cargo = [packet(COAL, 20, map.idx(10, 10))]
        const before = world.companies[0]!.money
        expect(until(world, lorry, stop)).toBe(1)
        expect(aboard(lorry, COAL)).toBe(20)
        expect(world.companies[0]!.money).toBe(before)
    })

    it('with no-unload keeps even accepted cargo aboard; with unload transfers what is not accepted', () => {
        const { world, map } = setup()
        const stop = stopAt(world, 30, RtStationTile.truck)
        stop.acceptance = 1 << COAL
        const lorry = vehicle(world, M.coalLorry.index, [{ kind: RtOrderKind.gotoStation, target: stop.id, flags: RtOrderFlag.noUnload }])
        lorry.cargo = [packet(COAL, 20, map.idx(10, 10))]
        expect(until(world, lorry, stop)).toBe(1)
        expect(aboard(lorry, COAL)).toBe(20)

        stop.acceptance = 0
        lorry.orders = [{ kind: RtOrderKind.gotoStation, target: stop.id, flags: RtOrderFlag.unload }]
        const before = world.companies[0]!.money
        expect(until(world, lorry, stop)).toBeGreaterThan(0)
        expect(aboard(lorry, COAL)).toBe(0)
        expect(waiting(stop, COAL)).toBe(20)
        // a transfer pays nothing yet, and the transferred cargo keeps its origin for the final payment
        expect(world.companies[0]!.money).toBe(before)
        expect(stop.cargo[COAL]!.packets[0]!.sourceTile).toBe(map.idx(10, 10))
    })

    it('loads waiting cargo up to capacity and marks the load attempt, pickup tick, speed and age', () => {
        const { world, map } = setup()
        const stop = stopAt(world, 30, RtStationTile.bus)
        stop.cargo[PASSENGERS]!.packets = [packet(PASSENGERS, 100, map.idx(30, 12), stop.id)]
        const bus = vehicle(world, M.townBus.index)
        bus.age = 3 * 365 + 10
        expect(until(world, bus, stop)).toBe(Math.ceil(M.townBus.capacity / STEP))
        expect(aboard(bus, PASSENGERS)).toBe(M.townBus.capacity)
        expect(waiting(stop, PASSENGERS)).toBe(100 - M.townBus.capacity)
        const goods = stop.cargo[PASSENGERS]!
        expect(goods.loadAttempted).toBe(true)
        expect(goods.hasRating).toBe(true)
        expect(goods.lastSpeed).toBe(M.townBus.maxSpeed)
        expect(goods.lastAge).toBe(3)
        expect(goods.cyclesSincePickup).toBe(0)
        expect(stop.lastPickupTick).toBe(world.tick)
        expect(stop.lastVehicleKind).toBe(RtVehicleKind.road)
    })

    it('without full load leaves once nothing more waits; with full load stays until full', () => {
        const { world, map } = setup()
        const stop = stopAt(world, 30, RtStationTile.bus)
        stop.cargo[PASSENGERS]!.packets = [packet(PASSENGERS, 7, map.idx(30, 12), stop.id)]
        const bus = vehicle(world, M.townBus.index)
        expect(until(world, bus, stop)).toBe(2)
        expect(aboard(bus, PASSENGERS)).toBe(7)

        const full = vehicle(world, M.townBus.index, [{ kind: RtOrderKind.gotoStation, target: stop.id, flags: RtOrderFlag.fullLoad }])
        stop.cargo[PASSENGERS]!.packets = [packet(PASSENGERS, 7, map.idx(30, 12), stop.id)]
        expect(until(world, full, stop, 20)).toBe(-1)
        expect(aboard(full, PASSENGERS)).toBe(7)
        stop.cargo[PASSENGERS]!.packets.push(packet(PASSENGERS, 100, map.idx(30, 12), stop.id))
        expect(until(world, full, stop)).toBeGreaterThan(0)
        expect(aboard(full, PASSENGERS)).toBe(M.townBus.capacity)
    })

    it('never unloads cargo at the station it was picked up at: no pay-for-nothing loop', () => {
        const { world, map } = setup()
        const stop = stopAt(world, 30, RtStationTile.bus)
        stop.acceptance = 1 << PASSENGERS
        stop.cargo[PASSENGERS]!.packets = [packet(PASSENGERS, 200, map.idx(36, 10), stop.id)]
        const bus = vehicle(world, M.townBus.index)
        const before = world.companies[0]!.money
        const steps = until(world, bus, stop)
        expect(steps).toBeGreaterThan(0)
        expect(aboard(bus, PASSENGERS)).toBe(M.townBus.capacity)
        expect(world.companies[0]!.money).toBe(before)
        // and under the unload flag, cargo it would only transfer off again is not loaded
        const lorry = vehicle(world, M.coalLorry.index, [{ kind: RtOrderKind.gotoStation, target: stop.id, flags: RtOrderFlag.unload }])
        expect(until(world, lorry, stop)).toBe(1)
    })

    it('feeds an accepting industry in the catchment', () => {
        const { world, map } = setup()
        const stop = stopAt(world, 25, RtStationTile.truck)
        stop.acceptance = 1 << WOOD
        const lorry = vehicle(world, M.timberLorry.index)
        lorry.cargo = [packet(WOOD, 20, map.idx(5, 10))]
        expect(until(world, lorry, stop)).toBeGreaterThan(0)
        expect(world.industries[0]!.delivered[WOOD]).toBe(20)
        expect(world.companies[0]!.financeThisYear.roadIncome).toBe(deliveryPayment(WOOD, 20, 20, 0))
    })

    it('shares a delivery with the owner of the station it is made at, and of the station the cargo came from', () => {
        const { world, map } = setup(true)
        // company 1's own road, two rows south
        for (let x = 4; x <= 50; x++) buildRoad(map, 1, map.idx(x, 12), RT_ROAD_X, true)
        const foreign = stopAt(world, 30, RtStationTile.bus, 1, 12)
        foreign.acceptance = 1 << PASSENGERS
        const source = stopAt(world, 10, RtStationTile.bus, 1, 12)
        const bus = vehicle(world, M.townBus.index)
        bus.cargo = [packet(PASSENGERS, 30, map.idx(10, 10), source.id, 2)]
        const [a, b] = [world.companies[0]!, world.companies[1]!]
        const aBefore = a.money
        const bBefore = b.money
        expect(until(world, bus, foreign)).toBeGreaterThan(0)
        // (10, 10) to the stop at (30, 12): 22 tiles
        const payment = deliveryPayment(PASSENGERS, 30, 22, 2)
        const share = stationSharingShare(payment)
        expect(share).toBeGreaterThan(0)
        expect(a.financeThisYear.roadIncome).toBe(payment)
        expect(a.financeThisYear.sharingCosts).toBe(-2 * share)
        expect(b.financeThisYear.sharingIncome).toBe(2 * share)
        expect(a.money - aBefore).toBe(payment - 2 * share)
        expect(b.money - bBefore).toBe(2 * share)
        expect(bus.profitThisYear).toBe(payment - 2 * share)
    })

    it('runs a step every loadStepTicks through the movers\' hooks', () => {
        const { world, map } = setup()
        const stop = stopAt(world, 30, RtStationTile.bus)
        stop.cargo[PASSENGERS]!.packets = [packet(PASSENGERS, 100, map.idx(30, 12), stop.id)]
        const bus = vehicle(world, M.townBus.index)
        bus.loadingStation = stop.id
        rtLoadHooks.arrive!(world, bus, stop.id)
        const every = rtLoadStepTicks(bus)
        expect(every).toBe(RT_CATALOG.vehicles.roadLoadStepTicks)
        let ticks = 0
        while (!rtLoadHooks.loadStep!(world, bus) && ticks < 1000) ticks++
        // ceil(31 / 5) = 7 steps, the first at once and one every `every` ticks after it
        expect(ticks).toBe((Math.ceil(M.townBus.capacity / STEP) - 1) * every)
    })

    it('with the hooks on a driving bus, carries passengers between two stops and earns', () => {
        const { world, map } = setup()
        const a = stopAt(world, 8, RtStationTile.bus)
        const b = stopAt(world, 40, RtStationTile.bus)
        a.acceptance = 1 << PASSENGERS
        b.acceptance = 1 << PASSENGERS
        a.cargo[PASSENGERS]!.packets = [packet(PASSENGERS, 500, map.idx(8, 12), a.id)]
        const bus = vehicle(world, M.townBus.index, [
            { kind: RtOrderKind.gotoStation, target: a.id, flags: 0 },
            { kind: RtOrderKind.gotoStation, target: b.id, flags: 0 }
        ])
        bus.stopped = false
        for (let t = 0; t < 6000; t++) {
            world.tick++
            world.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
            stepRoadVehicle(world, bus, rtLoadHooks)
        }
        expect(world.companies[0]!.financeThisYear.roadIncome).toBeGreaterThan(0)
        expect(bus.profitThisYear).toBe(world.companies[0]!.financeThisYear.roadIncome)
        expect(world.towns[b.town]!.receivedThisMonth[PASSENGERS]).toBeGreaterThanOrEqual(M.townBus.capacity)
    })

    it('ends the stop when the station or company is gone, without throwing', () => {
        const { world } = setup()
        const bus = vehicle(world, M.townBus.index)
        expect(loadUnload(world, bus, 999)).toBe(true)
        expect(loadUnload(world, bus, -1)).toBe(true)
        bus.owner = 7
        const stop = stopAt(world, 30, RtStationTile.bus)
        expect(loadUnload(world, bus, stop.id)).toBe(true)
    })
})
