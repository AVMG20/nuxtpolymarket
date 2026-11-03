import { describe, expect, it } from 'vitest'
import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { demolishTile } from '#shared/utils/rail-tycoon/demolish'
import { buildDepot } from '#shared/utils/rail-tycoon/depots'
import { deliveryPayment, stationSharingShare } from '#shared/utils/rail-tycoon/economy'
import { rtLoadHooks } from '#shared/utils/rail-tycoon/loading'
import { RtDir, RtMap, RtTileKind } from '#shared/utils/rail-tycoon/map'
import {
    RT_MAX_ORDERS,
    RtOrderError,
    advanceOrder,
    rtCurrentOrder,
    rtReplaceOrders,
    validateOrders
} from '#shared/utils/rail-tycoon/orders'
import { RtSignalType, placeSignal, updateSignalStates } from '#shared/utils/rail-tycoon/signals'
import { RtAxis, RtStationTile, buildRailStation, buildRoadStop } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_X, RtBuildError, buildRail, rtPieceBetween } from '#shared/utils/rail-tycoon/track'
import { rtRemoveTrain, stepTrain, type RtTrainHooks } from '#shared/utils/rail-tycoon/train'
import {
    RT_NONE,
    RT_OWNER_NONE,
    RtOrderFlag,
    RtOrderKind,
    RtVehicleKind,
    RtVehicleState,
    type RtOrder,
    type RtStation,
    type RtTown,
    type RtVehicle
} from '#shared/utils/rail-tycoon/types'
import { buyVehicle, createVehicle } from '#shared/utils/rail-tycoon/vehicles'
import { RtWorld, rtNewCompany } from '#shared/utils/rail-tycoon/world'

const M = RT_CATALOG.vehicles.models
const ME = 0
const RIVAL = 1
const free = () => false

function town(id: number, centre: number): RtTown {
    return {
        id, name: `Town ${id}`, centre, houseCount: 1, population: 40, growthCounter: 0, growthRate: 0, growing: false,
        activeStations: 0, receivedThisMonth: RT_CARGO_IDS.map(() => 0), receivedLastMonth: RT_CARGO_IDS.map(() => 0)
    }
}

const station = (target: number, flags = 0): RtOrder => ({ kind: RtOrderKind.gotoStation, target, flags })
const depot = (target: number): RtOrder => ({ kind: RtOrderKind.gotoDepot, target, flags: 0 })

/**
 * Three own rail stations (ids 0, 1, 2), a rival rail station (3), a rival bus stop (4), an own rail
 * depot, a rival rail depot and an own road depot.
 */
function setup(): { map: RtMap, stations: RtStation[], ids: Record<string, number> } {
    const map = new RtMap(64)
    const stations: RtStation[] = []
    const towns = [town(0, map.idx(5, 5)), town(1, map.idx(50, 50))]
    const rail = (owner: number, x: number, y: number) => {
        const result = buildRailStation(map, stations, towns, owner, map.idx(x, y), RtAxis.x, 1, 2, true)
        if (!result.ok || result.station === undefined) throw new Error('fixture station refused')
        return result.station
    }
    const a = rail(ME, 10, 10)
    const b = rail(ME, 20, 10)
    const c = rail(ME, 30, 10)
    const rivalRail = rail(RIVAL, 40, 10)
    const busTile = map.idx(40, 30)
    map.setTile(busTile, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_X)
    const bus = buildRoadStop(map, stations, towns, RIVAL, busTile, RtStationTile.bus, true)
    if (!bus.ok || bus.station === undefined) throw new Error('fixture stop refused')
    const ownDepot = map.idx(10, 20)
    const rivalDepot = map.idx(20, 20)
    const roadDepot = map.idx(30, 20)
    buildDepot(map, ME, ownDepot, RtVehicleKind.rail, RtDir.se, true)
    buildDepot(map, RIVAL, rivalDepot, RtVehicleKind.rail, RtDir.se, true)
    buildDepot(map, ME, roadDepot, RtVehicleKind.road, RtDir.se, true)
    return { map, stations, ids: { a, b, c, rivalRail, rivalBus: bus.station, ownDepot, rivalDepot, roadDepot } }
}

function train(id: number, orders: RtOrder[], orderIndex = 0): RtVehicle {
    const vehicle = createVehicle(id, ME, M.tankEngine.index, [M.coalHopper.index], 0, RtDir.se, 0)
    vehicle.state = RtVehicleState.driving
    vehicle.stopped = false
    vehicle.orders = orders
    vehicle.orderIndex = orderIndex
    return vehicle
}

describe('rail tycoon orders and loading', () => {
    describe('advanceOrder', () => {
        it('a three-order list cycles A, B, C, A', () => {
            const { map, stations, ids } = setup()
            const v = train(0, [station(ids.a!), station(ids.b!), station(ids.c!)])
            expect(rtCurrentOrder(v)!.target).toBe(ids.a)
            const seen = [1, 2, 3, 4].map(() => advanceOrder(v, stations, map)!.target)
            expect(seen).toEqual([ids.b, ids.c, ids.a, ids.b])
            expect(v.orderIndex).toBe(1)
            expect(v.routeTick).toBe(RT_NONE)
        })

        it('demolishing a station removes its order from every vehicle, which continues with the next order', () => {
            const { map, stations, ids } = setup()
            const list = () => [station(ids.a!), station(ids.b!), station(ids.c!)]
            const onB = train(0, list(), 1)
            const onC = train(1, list(), 2)
            const onA = train(2, list(), 0)
            const vehicles = [onB, onC, onA]
            for (const tile of [map.idx(20, 10), map.idx(21, 10)]) {
                expect(demolishTile(map, stations, ME, tile, free, true, { vehicles }).ok).toBe(true)
            }
            for (const v of vehicles) expect(v.orders.map(o => o.target)).toEqual([ids.a, ids.c])
            expect(rtCurrentOrder(onB)!.target).toBe(ids.c)
            expect(rtCurrentOrder(onC)!.target).toBe(ids.c)
            expect(rtCurrentOrder(onA)!.target).toBe(ids.a)
            expect(advanceOrder(onB, stations, map)!.target).toBe(ids.a)
            expect(advanceOrder(onA, stations, map)!.target).toBe(ids.c)
        })

        it('a vehicle whose last order is removed keeps driving with no destination', () => {
            const { map, stations, ids } = setup()
            const v = train(0, [station(ids.a!)])
            for (const tile of [map.idx(10, 10), map.idx(11, 10)]) {
                demolishTile(map, stations, ME, tile, free, true, { vehicles: [v] })
            }
            expect(v.orders).toEqual([])
            expect(v.orderIndex).toBe(0)
            expect(rtCurrentOrder(v)).toBeNull()
            expect(advanceOrder(v, stations, map)).toBeNull()
            expect(v.state).toBe(RtVehicleState.driving)
            expect(v.stopped).toBe(false)
        })

        it('setting an empty list is valid and leaves a running train running', () => {
            const { map, stations, ids } = setup()
            const v = train(0, [station(ids.a!), station(ids.b!)], 1)
            const result = validateOrders([], stations, map, ME, false, v)
            expect(result).toEqual({ ok: true, orders: [] })
            rtReplaceOrders(v, [])
            expect(v.orderIndex).toBe(0)
            expect(v.state).toBe(RtVehicleState.driving)
            expect(v.stopped).toBe(false)
        })

        it('a depot order cycles like any other; a target missing from a corrupt world yields null, not a throw', () => {
            const { map, stations, ids } = setup()
            const v = train(0, [station(ids.a!), depot(ids.ownDepot!), station(999)])
            expect(advanceOrder(v, stations, map)).toEqual(depot(ids.ownDepot!))
            expect(advanceOrder(v, stations, map)).toBeNull()
            expect(v.orderIndex).toBe(2)
            expect(advanceOrder(v, stations, map)!.target).toBe(ids.a)
        })
    })

    describe('validateOrders', () => {
        it('accepts own stations and depots with load flags and returns fresh copies', () => {
            const { map, stations, ids } = setup()
            const input = [station(ids.a!, RtOrderFlag.fullLoad), station(ids.b!, RtOrderFlag.unload), depot(ids.ownDepot!)]
            const result = validateOrders(input, stations, map, ME, false, train(0, []))
            expect(result).toEqual({ ok: true, orders: input })
            if (!result.ok) return
            input[0]!.target = 77
            expect(result.orders[0]!.target).toBe(ids.a)
        })

        it('with sharing off an order to another company\'s station or depot is refused', () => {
            const { map, stations, ids } = setup()
            const v = train(0, [])
            expect(validateOrders([station(ids.a!), station(ids.rivalRail!)], stations, map, ME, false, v))
                .toEqual({ ok: false, error: RtOrderError.notOwner, index: 1 })
            expect(validateOrders([depot(ids.rivalDepot!)], stations, map, ME, false, v))
                .toEqual({ ok: false, error: RtOrderError.notOwner, index: 0 })
        })

        it('with sharing on another company\'s station and depot validate, but full load there is refused', () => {
            const { map, stations, ids } = setup()
            const v = train(0, [])
            expect(validateOrders([station(ids.rivalRail!, RtOrderFlag.unload), depot(ids.rivalDepot!)], stations, map, ME, true, v).ok).toBe(true)
            expect(validateOrders([station(ids.rivalRail!, RtOrderFlag.fullLoad)], stations, map, ME, true, v))
                .toEqual({ ok: false, error: RtOrderError.foreignFullLoad, index: 0 })
            expect(validateOrders([station(ids.a!, RtOrderFlag.fullLoad)], stations, map, ME, true, v).ok).toBe(true)
        })

        it('refuses a station the vehicle cannot use and a depot of the other kind', () => {
            const { map, stations, ids } = setup()
            const rail = train(0, [])
            const bus = createVehicle(1, ME, M.townBus.index, [], 0, RtDir.se, 0)
            const lorry = createVehicle(2, ME, M.coalLorry.index, [], 0, RtDir.se, 0)
            expect(validateOrders([station(ids.rivalBus!)], stations, map, ME, true, rail))
                .toEqual({ ok: false, error: RtOrderError.unusable, index: 0 })
            expect(validateOrders([station(ids.rivalBus!)], stations, map, ME, true, bus).ok).toBe(true)
            expect(validateOrders([station(ids.rivalBus!)], stations, map, ME, true, lorry))
                .toEqual({ ok: false, error: RtOrderError.unusable, index: 0 })
            expect(validateOrders([station(ids.a!)], stations, map, ME, true, bus))
                .toEqual({ ok: false, error: RtOrderError.unusable, index: 0 })
            expect(validateOrders([depot(ids.roadDepot!)], stations, map, ME, false, rail))
                .toEqual({ ok: false, error: RtOrderError.unusable, index: 0 })
            expect(validateOrders([depot(ids.roadDepot!)], stations, map, ME, false, bus).ok).toBe(true)
        })

        it('refuses more than RT_MAX_ORDERS', () => {
            const { map, stations, ids } = setup()
            const v = train(0, [])
            const full = Array.from({ length: RT_MAX_ORDERS }, (_, k) => station(k % 2 === 0 ? ids.a! : ids.b!))
            expect(validateOrders(full, stations, map, ME, false, v).ok).toBe(true)
            expect(validateOrders([...full, station(ids.c!)], stations, map, ME, false, v))
                .toEqual({ ok: false, error: RtOrderError.tooMany, index: -1 })
        })

        it('refuses hostile payloads without throwing', () => {
            const { map, stations, ids } = setup()
            const v = train(0, [])
            const throwing = new Proxy({}, { get() { throw new Error('trap') } })
            const cases: [unknown, number][] = [
                [null, RtOrderError.invalid],
                ['orders', RtOrderError.invalid],
                [{ length: 1 }, RtOrderError.invalid],
                [[null], RtOrderError.invalid],
                [[[0, ids.a, 0]], RtOrderError.invalid],
                [[{ kind: 2, target: ids.a, flags: 0 }], RtOrderError.invalid],
                [[{ kind: '0', target: ids.a, flags: 0 }], RtOrderError.invalid],
                [[{ kind: 0, target: -1, flags: 0 }], RtOrderError.invalid],
                [[{ kind: 0, target: 1.5, flags: 0 }], RtOrderError.invalid],
                [[{ kind: 0, target: NaN, flags: 0 }], RtOrderError.invalid],
                [[{ kind: 0, target: ids.a }], RtOrderError.invalid],
                [[{ kind: 0, target: ids.a, flags: 8 }], RtOrderError.invalid],
                [[{ kind: 0, target: ids.a, flags: RtOrderFlag.unload | RtOrderFlag.noUnload }], RtOrderError.badFlags],
                [[{ kind: 1, target: ids.ownDepot, flags: RtOrderFlag.fullLoad }], RtOrderError.badFlags],
                [[{ kind: 0, target: 999, flags: 0 }], RtOrderError.noTarget],
                [[{ kind: 1, target: map.idx(1, 1), flags: 0 }], RtOrderError.noTarget],
                [[{ kind: 1, target: 64 * 64, flags: 0 }], RtOrderError.noTarget],
                [[throwing], RtOrderError.invalid],
                [throwing, RtOrderError.invalid]
            ]
            for (const [orders, error] of cases) {
                const result = validateOrders(orders, stations, map, ME, true, v)
                expect(result.ok).toBe(false)
                if (!result.ok) expect(result.error).toBe(error)
            }
            expect(validateOrders([], stations, map, -1, true, v).ok).toBe(false)
            expect(validateOrders([], stations, map, 8, true, v).ok).toBe(false)
        })
    })
})

/* ------------------------------------------------------------------------------------------
 * Orders and loading on running trains. Every vehicle is stepped in id order each tick, as
 * RtWorld.step will.
 * ---------------------------------------------------------------------------------------- */

type XY = [number, number]

const COAL = RT_CATALOG.cargos.coal.index
const ENGINE = M.expressEngine.index
const EAST = 8

function dirTo(a: XY, b: XY): RtDir {
    if (b[0] === a[0] - 1) return RtDir.ne
    if (b[1] === a[1] + 1) return RtDir.se
    if (b[0] === a[0] + 1) return RtDir.sw
    return RtDir.nw
}

/** Lays track along a path of adjacent tiles; `closed` joins the last tile back to the first. */
function lay(map: RtMap, owner: number, path: XY[], closed = false): void {
    const n = path.length
    for (let k = 0; k < n; k++) {
        const here = path[k]!
        const prev = k > 0 ? path[k - 1] : closed ? path[n - 1] : undefined
        const next = k < n - 1 ? path[k + 1] : closed ? path[0] : undefined
        const a = prev ? dirTo(here, prev) : ((dirTo(here, next!) + 2) & 3) as RtDir
        const b = next ? dirTo(here, next) : ((a + 2) & 3) as RtDir
        const result = buildRail(map, owner, map.idx(here[0], here[1]), rtPieceBetween(a, b), true)
        if (!result.ok && result.error !== RtBuildError.alreadyBuilt) throw new Error(`lay failed at ${here} (${result.error})`)
    }
}

function row(y: number, x0: number, x1: number): XY[] {
    const out: XY[] = []
    const step = x0 <= x1 ? 1 : -1
    for (let x = x0; x !== x1 + step; x += step) out.push([x, y])
    return out
}

function column(x: number, y0: number, y1: number): XY[] {
    const out: XY[] = []
    const step = y0 <= y1 ? 1 : -1
    for (let y = y0; y !== y1 + step; y += step) out.push([x, y])
    return out
}

function net(sharing: boolean): RtWorld {
    return RtWorld.empty({ side: 64, maxCompanies: 8, sharing }, {
        rngState: 7, companies: [rtNewCompany(ME, 'Mine', 0, 0), rtNewCompany(RIVAL, 'Rival', 1, 0)]
    })
}

function railStation(world: RtWorld, owner: number, xy: XY, axis: number, length: number): RtStation {
    const built = buildRailStation(world.map, world.stations as RtStation[], [], owner, world.map.idx(xy[0], xy[1]), axis, 1, length, true)
    if (!built.ok) throw new Error(`station failed at ${xy} (${built.error})`)
    return world.stations[(built as { station: number }).station]!
}

/** A stopped train (engine plus wagons) bought in the depot at `xy`, built facing `facing`. */
function depotTrain(world: RtWorld, owner: number, xy: XY, facing: number, wagons: number[] = []): RtVehicle {
    const tile = world.map.idx(xy[0], xy[1])
    if (world.map.kind[tile] !== RtTileKind.depot) {
        const built = buildDepot(world.map, owner, tile, RtVehicleKind.rail, facing, true)
        if (!built.ok) throw new Error(`depot failed at ${xy} (${built.error})`)
    }
    const bought = buyVehicle(world, owner, tile, ENGINE, wagons, true)
    if (!bought.ok) throw new Error(`buy failed (${bought.error})`)
    return world.vehicle(bought.vehicle)!
}

/** Validates `orders` as the server would, installs them and starts the train. */
function dispatch(world: RtWorld, v: RtVehicle, orders: RtOrder[]): void {
    const result = validateOrders(orders, world.stations, world.map, v.owner, world.settings.sharing, v)
    if (!result.ok) throw new Error(`orders refused (${result.error})`)
    rtReplaceOrders(v, result.orders)
    v.stopped = false
}

/** Steps every vehicle in id order for up to `ticks` ticks; `each` returning true ends the run early. */
function run(world: RtWorld, ticks: number, hooks: RtTrainHooks, each: () => unknown): void {
    for (let t = 0; t < ticks; t++) {
        world.tick++
        world.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
        for (const v of world.vehicleList()) if (stepTrain(world, v, hooks).remove) rtRemoveTrain(world, v)
        if (each()) return
    }
}

const coalAboard = (v: RtVehicle) => v.cargo.filter(p => p.cargo === COAL).reduce((sum, p) => sum + p.count, 0)

/**
 * A line west to east: the train's depot at (5, 10), a three-tile coal pickup at (10, 10) and a
 * three-tile drop at (34, 10) that accepts coal, the track between owned by the train's owner. 40
 * coal waits at the pickup, from (11, 8). The train picks it up and drops it; the result holds the
 * coal aboard on arrival at the drop and the money each company booked while it unloaded.
 */
function coalRun(trainOwner: number, pickupOwner: number, dropOwner: number) {
    const w = net(true)
    const map = w.map
    const pickup = railStation(w, pickupOwner, [10, 10], RtAxis.x, 3)
    const drop = railStation(w, dropOwner, [34, 10], RtAxis.x, 3)
    lay(map, trainOwner, row(10, 6, 9))
    lay(map, trainOwner, row(10, 13, 33))
    drop.acceptance = 1 << COAL
    const source = map.idx(11, 8)
    pickup.cargo[COAL]!.packets = [{ cargo: COAL, count: 40, sourceTile: source, sourceStation: pickup.id, transitPeriods: 0, feederShare: 0 }]
    const v = depotTrain(w, trainOwner, [5, 10], RtDir.sw, [M.coalHopper.index, M.coalHopper.index])
    dispatch(w, v, [station(pickup.id), station(drop.id)])
    const finance = () => w.companies.map(c => ({ ...c!.financeThisYear, money: c!.money }))
    let arrived: { cargo: RtVehicle['cargo'], finance: ReturnType<typeof finance>, profit: number } | null = null
    const hooks: RtTrainHooks = {
        ...rtLoadHooks,
        arrive: (world, vehicle, at) => {
            if (at === drop.id && !arrived) arrived = { cargo: vehicle.cargo.map(p => ({ ...p })), finance: finance(), profit: vehicle.profitThisYear }
            rtLoadHooks.arrive!(world, vehicle, at)
        }
    }
    run(w, 8000, hooks, () => arrived !== null && coalAboard(v) === 0 && v.state !== RtVehicleState.loading)
    if (!arrived) throw new Error('the train never reached the drop')
    const at = arrived as { cargo: RtVehicle['cargo'], finance: ReturnType<typeof finance>, profit: number }
    const after = finance()
    const delta = (company: number, key: 'trainIncome' | 'sharingIncome' | 'sharingCosts' | 'money') => after[company]![key] - at.finance[company]![key]
    // (11, 8) to the drop's sign at (34, 10)
    const distance = 23 + 2
    return { w, v, pickup, drop, source, distance, aboard: at.cargo, delta, profit: v.profitThisYear - at.profit }
}

/**
 * A closed loop (9..41, 10..20) entered from a depot at (25, 9), with a one-way path signal at
 * (20, 10) for eastbound trains and a dead-end spur south from (30, 20) to a three-tile station at
 * (30, 24). Trains run clockwise: east along y = 10, west along y = 20.
 */
function loopWithSpur(w: RtWorld) {
    const map = w.map
    lay(map, ME, [...row(10, 9, 41), ...column(41, 11, 20), ...row(20, 40, 9), ...column(9, 19, 11)], true)
    const link = buildRail(map, ME, map.idx(25, 10), rtPieceBetween(RtDir.nw, RtDir.sw), true)
    if (!link.ok) throw new Error(`depot link failed (${link.error})`)
    const branch = buildRail(map, ME, map.idx(30, 20), rtPieceBetween(RtDir.sw, RtDir.se), true)
    if (!branch.ok) throw new Error(`branch failed (${branch.error})`)
    lay(map, ME, column(30, 21, 23))
    const spur = railStation(w, ME, [30, 24], RtAxis.y, 3)
    for (let k = 0; k < 3; k++) {
        const placed = placeSignal(map, ME, map.idx(20, 10), EAST & 7, RtSignalType.path, true)
        if (!placed.ok) throw new Error(`signal failed (${placed.error})`)
    }
    const tiles: number[] = []
    for (let t = 0; t < map.side * map.side; t++) if (map.kind[t] === RtTileKind.rail) tiles.push(t)
    updateSignalStates(map, (tile, piece, except) => w.occupied.otherTrainOnPiece(tile, piece, except) !== RT_NONE, tiles, w.settings.sharing)
    const train = depotTrain(w, ME, [25, 9], RtDir.se)
    return { spur, train, signalTile: map.idx(20, 10), pastSignal: map.idx(21, 10) }
}

/** Runs `ticks` ticks and counts the times the train's head passed the path signal eastbound. */
function countPasses(w: RtWorld, train: RtVehicle, from: number, to: number, ticks: number): { passes: number, moving: number } {
    let passes = 0
    let moving = 0
    let last = train.tiles[0]
    run(w, ticks, {}, () => {
        expect(train.state).not.toBe(RtVehicleState.crashed)
        if (last === from && train.tiles[0] === to) passes++
        if (train.speed > 0) moving++
        last = train.tiles[0]
    })
    return { passes, moving }
}

describe('rail tycoon orders and loading on running trains', () => {
    it('a train delivering coal to another company\'s station pays it the station share and keeps the rest', () => {
        const { aboard, source, distance, pickup, delta, profit } = coalRun(ME, ME, RIVAL)
        expect(aboard).toHaveLength(1)
        expect(aboard[0]).toMatchObject({ cargo: COAL, count: 40, sourceTile: source, sourceStation: pickup.id, transitPeriods: 0 })
        const payment = deliveryPayment(COAL, 40, distance, 0)
        const share = stationSharingShare(payment)
        expect(share).toBeGreaterThan(0)
        expect(delta(ME, 'trainIncome')).toBe(payment)
        expect(delta(ME, 'sharingCosts')).toBe(-share)
        expect(delta(ME, 'money')).toBe(payment - share)
        expect(delta(RIVAL, 'sharingIncome')).toBe(share)
        expect(delta(RIVAL, 'money')).toBe(share)
        expect(profit).toBe(payment - share)
    })

    it('with sharing off the same order to another company\'s station is refused', () => {
        const w = net(false)
        const own = railStation(w, ME, [10, 10], RtAxis.x, 3)
        const rival = railStation(w, RIVAL, [34, 10], RtAxis.x, 3)
        const v = depotTrain(w, ME, [5, 10], RtDir.sw)
        expect(validateOrders([station(own.id), station(rival.id)], w.stations, w.map, ME, w.settings.sharing, v))
            .toEqual({ ok: false, error: RtOrderError.notOwner, index: 1 })
        expect(v.orders).toEqual([])
    })

    it('coal picked up at company A\'s station by company B\'s train and dropped at B\'s pays A the station share', () => {
        const { aboard, distance, delta, profit } = coalRun(RIVAL, ME, RIVAL)
        expect(aboard).toHaveLength(1)
        expect(aboard[0]!.count).toBe(40)
        const payment = deliveryPayment(COAL, 40, distance, 0)
        const share = stationSharingShare(payment)
        expect(delta(RIVAL, 'trainIncome')).toBe(payment)
        expect(delta(RIVAL, 'sharingCosts')).toBe(-share)
        expect(delta(RIVAL, 'money')).toBe(payment - share)
        expect(delta(ME, 'sharingIncome')).toBe(share)
        expect(delta(ME, 'money')).toBe(share)
        expect(profit).toBe(payment - share)
    })

    it('a train whose only target station is demolished keeps running round the loop and through a path signal', () => {
        const w = net(false)
        const { spur, train, signalTile, pastSignal } = loopWithSpur(w)
        dispatch(w, train, [station(spur.id)])
        // out of the depot and east along the top row, heading for the spur
        run(w, 3000, {}, () => train.state === RtVehicleState.driving && train.tiles[0] === pastSignal)
        expect(train.tiles[0]).toBe(pastSignal)
        for (const xy of [[30, 24], [30, 25], [30, 26]] as XY[]) {
            const result = demolishTile(w.map, w.stations as RtStation[], ME, w.map.idx(xy[0], xy[1]), tile => w.occupied.vehicleOnTile(tile), true, { vehicles: w.vehicleList() })
            expect(result.ok).toBe(true)
        }
        expect(train.orders).toEqual([])
        const { passes, moving } = countPasses(w, train, signalTile, pastSignal, 8000)
        expect(passes).toBeGreaterThanOrEqual(2)
        expect(moving).toBeGreaterThan(6000)
        expect(train.state).toBe(RtVehicleState.driving)
        expect(train.stopped).toBe(false)
    })

    it('setOrders with an empty list on a running train leaves it running, through the path signal', () => {
        const w = net(false)
        const { spur, train, signalTile, pastSignal } = loopWithSpur(w)
        dispatch(w, train, [station(spur.id)])
        run(w, 3000, {}, () => train.state === RtVehicleState.driving && train.tiles[0] === pastSignal)
        expect(train.speed).toBeGreaterThan(0)
        dispatch(w, train, [])
        expect(train.orders).toEqual([])
        expect(train.orderIndex).toBe(0)
        const { passes, moving } = countPasses(w, train, signalTile, pastSignal, 8000)
        expect(passes).toBeGreaterThanOrEqual(2)
        expect(moving).toBeGreaterThan(6000)
        expect(train.state).toBe(RtVehicleState.driving)
    })
})
