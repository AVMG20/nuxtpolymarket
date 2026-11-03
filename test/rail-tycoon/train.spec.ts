import { describe, expect, it } from 'vitest'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { buildDepot } from '#shared/utils/rail-tycoon/depots'
import { rtLoadHooks } from '#shared/utils/rail-tycoon/loading'
import { depotSharingFee } from '#shared/utils/rail-tycoon/economy'
import { RtDir, RtTileKind, type RtMap } from '#shared/utils/rail-tycoon/map'
import { buildRoad } from '#shared/utils/rail-tycoon/road'
import { stepRoadVehicle } from '#shared/utils/rail-tycoon/road-vehicle'
import { SeededRandom } from '#shared/utils/random'
import { decodeWorldOrThrow, encodeWorld } from '#shared/utils/rail-tycoon/save'
import {
    RtSignalType,
    placeSignal,
    rtPieceReserved,
    rtReservedAhead,
    rtSignalGreen,
    updateSignalStates
} from '#shared/utils/rail-tycoon/signals'
import { RtAxis, buildRailStation } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_Y, RtBuildError, RtTrack, buildRail, removeRail, rtPieceBetween } from '#shared/utils/rail-tycoon/track'
import { rtRemoveTrain, stepTrain, type RtTrainHooks } from '#shared/utils/rail-tycoon/train'
import { RT_NONE, RtOrderKind, RtVehicleKind, RtVehicleState, type RtStation, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import {
    buyVehicle,
    createVehicle,
    rtAgeVehicleDay,
    rtBreakdownTick,
    rtCheckBreakdown,
    rtConsistCapacity,
    rtConsistCost,
    rtConsistHalfTiles,
    rtConsistLengthTiles,
    rtConsistMaxSpeed,
    rtConsistRunningCost,
    rtCountRunningTick,
    rtIsVehicleDayTick,
    rtServiceInDepot,
    rtVehicleDay,
    rtVehicleDayPhase,
    rtVehicleNeedsAutoService,
    rtVehicleNeedsService,
    rtVehicleRunningCost,
    rtVehicleSellValue,
    sellVehicle,
    serviceAndBreakdown,
    type RtServiceContext
} from '#shared/utils/rail-tycoon/vehicles'
import { RtWorld, rtNewCompany } from '#shared/utils/rail-tycoon/world'

const M = RT_CATALOG.vehicles.models
const ME = 0
const RIVAL = 1
const COAL = 2

function world(): RtWorld {
    return RtWorld.empty({ side: 64, maxCompanies: 8, sharing: true }, {
        rngState: 7,
        tick: 500,
        companies: [rtNewCompany(ME, 'Mine', 0, 0), rtNewCompany(RIVAL, 'Rival', 1, 0)]
    })
}

describe('rail tycoon trains', () => {
    describe('createVehicle', () => {
        it('a locomotive and three coal wagons carry three wagons of coal and are two tiles long', () => {
            const train = createVehicle(3, ME, M.tankEngine.index, [M.coalHopper.index, M.coalHopper.index, M.coalHopper.index], 100, RtDir.se, 42)
            expect(train.consist).toEqual([M.tankEngine.index, M.coalHopper.index, M.coalHopper.index, M.coalHopper.index])
            expect(train.wagonCount).toBe(3)
            const capacity = rtConsistCapacity(train.consist)
            expect(capacity[COAL]).toBe(3 * M.coalHopper.capacity)
            expect(capacity.reduce((a, b) => a + b, 0)).toBe(3 * M.coalHopper.capacity)
            expect(rtConsistHalfTiles(train.consist)).toBe(4)
            expect(rtConsistLengthTiles(train.consist)).toBe(2)
            expect(rtConsistMaxSpeed(train.consist)).toBe(M.tankEngine.maxSpeed)
        })

        it('is stopped inside its depot with empty orders, full reliability, no profit and its price as value', () => {
            const train = createVehicle(3, ME, M.tankEngine.index, [M.coalHopper.index], 100, RtDir.sw, 42)
            expect(train).toMatchObject({
                id: 3, owner: ME, kind: RtVehicleKind.rail, model: M.tankEngine.index,
                tiles: [100], pieces: [RtDir.sw], direction: RtDir.sw, progress: 0, speed: 0,
                state: RtVehicleState.inDepot, stopped: true, orders: [], orderIndex: 0, route: [], routeTick: RT_NONE,
                cargo: [], reliability: RT_CATALOG.vehicles.reliabilityMax, breakdownChance: 0, lastServiceTick: 42,
                serviceDepot: RT_NONE, lost: false, lostRetryTick: RT_NONE, age: 0,
                value: M.tankEngine.cost + M.coalHopper.cost, profitThisYear: 0, profitLastYear: 0
            })
        })

        it('a bus is one part with its own capacity', () => {
            const bus = createVehicle(0, ME, M.townBus.index, [], 9, RtDir.ne, 0)
            expect(bus.kind).toBe(RtVehicleKind.road)
            expect(bus.consist).toEqual([M.townBus.index])
            expect(rtConsistCapacity(bus.consist)[0]).toBe(M.townBus.capacity)
        })

        it('throws on inputs that were never validated', () => {
            expect(() => createVehicle(0, ME, M.coalHopper.index, [], 9, RtDir.ne, 0)).toThrow(RangeError)
            expect(() => createVehicle(0, ME, M.townBus.index, [M.coalHopper.index], 9, RtDir.ne, 0)).toThrow(RangeError)
        })
    })

    describe('buying and selling', () => {
        it('buys into an own depot with the lowest free id, stopped inside, and returns the price', () => {
            const w = world()
            const depot = w.map.idx(10, 10)
            buildDepot(w.map, ME, depot, RtVehicleKind.rail, RtDir.se, true)
            const wagons = [M.coalHopper.index, M.coalHopper.index]
            const check = buyVehicle(w, ME, depot, M.tankEngine.index, wagons, false)
            expect(check).toEqual({ ok: true, cost: rtConsistCost([M.tankEngine.index, ...wagons]), vehicle: 0 })
            expect(w.vehicleList()).toHaveLength(0)
            expect(buyVehicle(w, ME, depot, M.tankEngine.index, wagons, true)).toEqual(check)
            const train = w.vehicle(0)!
            expect(train.state).toBe(RtVehicleState.inDepot)
            expect(train.direction).toBe(RtDir.se)
            expect(w.occupied.depotOccupants(depot)).toEqual([0])
            expect(buyVehicle(w, ME, depot, M.expressEngine.index, [], true)).toMatchObject({ ok: true, vehicle: 1 })
            w.removeVehicle(0)
            expect(buyVehicle(w, ME, depot, M.tankEngine.index, [], true)).toMatchObject({ ok: true, vehicle: 0 })
        })

        it('refuses another company\'s depot, a depot of the other kind and a tile that is no depot', () => {
            const w = world()
            const rail = w.map.idx(10, 10)
            const road = w.map.idx(20, 20)
            buildDepot(w.map, RIVAL, rail, RtVehicleKind.rail, RtDir.se, true)
            buildDepot(w.map, ME, road, RtVehicleKind.road, RtDir.se, true)
            expect(buyVehicle(w, ME, rail, M.tankEngine.index, [], true)).toEqual({ ok: false, error: RtBuildError.notOwner })
            expect(buyVehicle(w, ME, road, M.tankEngine.index, [], true)).toEqual({ ok: false, error: RtBuildError.conflict })
            expect(buyVehicle(w, ME, w.map.idx(30, 30), M.townBus.index, [], true)).toEqual({ ok: false, error: RtBuildError.invalid })
            expect(buyVehicle(w, ME, road, M.townBus.index, [], true)).toMatchObject({ ok: true })
            expect(w.vehicleList()).toHaveLength(1)
        })

        it('refuses a consist past maxTrainLength and hostile values without throwing', () => {
            const w = world()
            const depot = w.map.idx(10, 10)
            buildDepot(w.map, ME, depot, RtVehicleKind.rail, RtDir.se, true)
            const max = RT_CATALOG.vehicles.maxTrainVehicles
            expect(buyVehicle(w, ME, depot, M.tankEngine.index, Array(max - 1).fill(M.coalHopper.index), false).ok).toBe(true)
            expect(buyVehicle(w, ME, depot, M.tankEngine.index, Array(max).fill(M.coalHopper.index), false))
                .toEqual({ ok: false, error: RtBuildError.limit })
            const hostile: [unknown, unknown, unknown, unknown][] = [
                [ME, depot, M.coalHopper.index, []],
                [ME, depot, M.tankEngine.index, [M.tankEngine.index]],
                [ME, depot, M.tankEngine.index, [1.5]],
                [ME, depot, M.tankEngine.index, 'wagons'],
                [ME, depot, M.tankEngine.index, null],
                [ME, depot, 99, []],
                [ME, depot, -1, []],
                [ME, depot, '0', []],
                [ME, -1, M.tankEngine.index, []],
                [ME, 64 * 64, M.tankEngine.index, []],
                [ME, NaN, M.tankEngine.index, []],
                [5, depot, M.tankEngine.index, []],
                [8, depot, M.tankEngine.index, []],
                ['0', depot, M.tankEngine.index, []],
                [ME, depot, M.townBus.index, []]
            ]
            for (const [owner, tile, model, wagons] of hostile) {
                const result = buyVehicle(w, owner, tile, model, wagons, true)
                expect(result.ok).toBe(false)
            }
            expect(w.vehicleList()).toHaveLength(0)
        })

        it('refuses at maxVehiclesPerCompany while another company can still buy', () => {
            const w = world()
            const mine = w.map.idx(10, 10)
            const theirs = w.map.idx(20, 20)
            buildDepot(w.map, ME, mine, RtVehicleKind.road, RtDir.se, true)
            buildDepot(w.map, RIVAL, theirs, RtVehicleKind.road, RtDir.se, true)
            const cap = RT_CATALOG.caps.maxVehiclesPerCompany
            for (let k = 0; k < cap; k++) expect(buyVehicle(w, ME, mine, M.townBus.index, [], true).ok).toBe(true)
            expect(buyVehicle(w, ME, mine, M.townBus.index, [], true)).toEqual({ ok: false, error: RtBuildError.limit })
            expect(buyVehicle(w, RIVAL, theirs, M.townBus.index, [], true)).toMatchObject({ ok: true, vehicle: cap })
            const decoded = decodeWorldOrThrow(encodeWorld(w))
            expect(decoded.hash()).toBe(w.hash())
            expect(decoded.occupied.depotOccupants(mine)).toHaveLength(cap)
        })

        it('sells only an own vehicle stopped in a depot, refunding its value and freeing the depot', () => {
            const w = world()
            const depot = w.map.idx(10, 10)
            buildDepot(w.map, ME, depot, RtVehicleKind.rail, RtDir.se, true)
            buyVehicle(w, ME, depot, M.tankEngine.index, [M.coalHopper.index], true)
            const train = w.vehicle(0)!
            expect(sellVehicle(w, RIVAL, 0, true)).toEqual({ ok: false, error: RtBuildError.notOwner })
            expect(sellVehicle(w, ME, 5, true)).toEqual({ ok: false, error: RtBuildError.invalid })
            expect(sellVehicle(w, ME, '0', true)).toEqual({ ok: false, error: RtBuildError.invalid })
            train.stopped = false
            expect(sellVehicle(w, ME, 0, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            train.stopped = true
            train.state = RtVehicleState.crashed
            expect(sellVehicle(w, ME, 0, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            train.state = RtVehicleState.inDepot
            const refund = rtVehicleSellValue(train)
            expect(refund).toBe(M.tankEngine.cost + M.coalHopper.cost)
            expect(sellVehicle(w, ME, 0, false)).toEqual({ ok: true, cost: -refund, vehicle: 0 })
            expect(w.vehicle(0)).toBe(train)
            expect(sellVehicle(w, ME, 0, true)).toEqual({ ok: true, cost: -refund, vehicle: 0 })
            expect(w.vehicle(0)).toBeUndefined()
            expect(w.occupied.depotOccupants(depot)).toEqual([])
        })

        it('loses value >> 8 every eighth day, as the original, and sells for what is left', () => {
            const train = createVehicle(0, ME, M.tankEngine.index, [], 100, RtDir.se, 0)
            let expected = train.value
            for (let day = 1; day <= 365; day++) {
                rtAgeVehicleDay(train)
                if (day % 8 === 0) expected -= Math.floor(expected / 256)
            }
            expect(train.age).toBe(365)
            expect(train.value).toBe(expected)
            expect(train.value).toBeLessThan(M.tankEngine.cost)
            expect(rtVehicleSellValue(train)).toBe(Math.floor(expected * RT_CATALOG.economy.sellRefundPercent / 100))
        })
    })

    describe('reliability, breakdowns and servicing', () => {
        const DAY = RT_CATALOG.time.dayTicks
        const V = RT_CATALOG.vehicles
        const SERVICE_DAYS = M.tankEngine.serviceDays

        function sharingWorld(sharing: boolean): RtWorld {
            return RtWorld.empty({ side: 64, maxCompanies: 8, sharing }, {
                rngState: 7,
                companies: [rtNewCompany(ME, 'Mine', 0, 0), rtNewCompany(RIVAL, 'Rival', 1, 0)]
            })
        }

        /** A train out on the line at speed, last serviced at tick 0. */
        function runningTrain(id = 0, owner = ME): RtVehicle {
            const train = createVehicle(id, owner, M.tankEngine.index, [M.coalHopper.index], 1000, RtDir.se, 0)
            train.state = RtVehicleState.driving
            train.stopped = false
            train.speed = 50
            return train
        }

        /** A context whose pathfinder answer is whatever `depot.tile` holds, counting the searches. */
        function context(w: RtWorld, depot: { tile: number, searches: number }): RtServiceContext {
            return {
                world: w,
                findServiceDepot: () => {
                    depot.searches++
                    return depot.tile
                }
            }
        }

        /** One game day of ticks as movement would run them: a broken vehicle stands, a healthy one is back at speed. */
        function runTicks(vehicle: RtVehicle, speed: number): void {
            for (let t = 0; t < DAY; t++) {
                if (!rtBreakdownTick(vehicle) && vehicle.state === RtVehicleState.driving) vehicle.speed = speed
                rtCountRunningTick(vehicle)
            }
        }

        it('reliability falls by the model decay every day, never below zero, and not while loading or blocked', () => {
            const rng = new SeededRandom(7)
            const train = runningTrain()
            train.speed = 0
            const state = rng.state
            rtCheckBreakdown(train, rng)
            expect(train.reliability).toBe(V.reliabilityMax - M.tankEngine.reliabilityDecay)
            train.state = RtVehicleState.loading
            rtCheckBreakdown(train, rng)
            expect(train.reliability).toBe(V.reliabilityMax - M.tankEngine.reliabilityDecay)
            train.state = RtVehicleState.driving
            train.reliability = 10
            rtCheckBreakdown(train, rng)
            expect(train.reliability).toBe(0)
            const bus = createVehicle(1, ME, M.townBus.index, [], 1000, RtDir.se, 0)
            bus.state = RtVehicleState.driving
            bus.stopped = false
            bus.blockedTicks = 3
            rtCheckBreakdown(bus, rng)
            expect(bus.reliability).toBe(V.reliabilityMax)
            expect(rng.state).toBe(state)
        })

        it('a breakdown stands the vehicle still for breakdownDelayMin plus up to breakdownDelayRandom ticks', () => {
            const rng = new SeededRandom(7)
            const train = runningTrain()
            train.reliability = 0
            train.breakdownChance = 254
            expect(rtCheckBreakdown(train, rng)).toBe(true)
            expect(train).toMatchObject({ speed: 0, subspeed: 0, breakdownChance: 0, breakdownsSinceService: 1 })
            const ticks = train.breakdownTicks
            expect(ticks).toBeGreaterThanOrEqual(V.breakdownDelayMin)
            expect(ticks).toBeLessThanOrEqual(V.breakdownDelayMin + V.breakdownDelayRandom)
            let standing = 0
            for (let t = 0; t < 400; t++) {
                train.speed = 30
                if (rtBreakdownTick(train)) {
                    standing++
                    expect(train.speed).toBe(0)
                }
            }
            expect(standing).toBe(ticks)
            expect(train.breakdownTicks).toBe(0)
            expect(train.speed).toBe(30)
        })

        it('never rolls for a stopped, slow or already broken vehicle, and draws no randomness then', () => {
            const rng = new SeededRandom(7)
            const cases: [string, (v: RtVehicle) => void][] = [
                ['stopped', (v) => { v.stopped = true }],
                ['slow', (v) => { v.speed = V.breakdownMinSpeed - 1 }],
                ['broken', (v) => { v.breakdownTicks = 10 }],
                ['in depot', (v) => {
                    v.state = RtVehicleState.inDepot
                    v.speed = 0
                }]
            ]
            for (const [, setup] of cases) {
                const train = runningTrain()
                train.reliability = 0
                train.breakdownChance = 254
                setup(train)
                const state = rng.state
                expect(rtCheckBreakdown(train, rng)).toBe(false)
                expect(train.breakdownChance).toBe(254)
                expect(rng.state).toBe(state)
            }
        })

        it('breaks down more often as reliability falls, over a seeded SeededRandom(7) run', () => {
            // Reduced breakdowns add 26214 before the lookup, so everything from 39321 up shares the top entry.
            const levels = [V.reliabilityMax, 30000, 15000, 0]
            const counts = levels.map((level) => {
                const rng = new SeededRandom(7)
                const train = runningTrain()
                let breakdowns = 0
                for (let day = 0; day < 2000; day++) {
                    train.reliability = level + M.tankEngine.reliabilityDecay
                    if (rtCheckBreakdown(train, rng)) breakdowns++
                    train.breakdownTicks = 0
                    train.speed = 50
                }
                return breakdowns
            })
            for (let k = 1; k < counts.length; k++) expect(counts[k]).toBeGreaterThan(counts[k - 1]!)

            const rng = new SeededRandom(7)
            const train = runningTrain()
            const halves = [0, 0]
            for (let day = 0; day < 700; day++) {
                if (serviceAndBreakdown(train, rng, day * DAY).brokeDown) halves[day < 350 ? 0 : 1]!++
                runTicks(train, 50)
            }
            expect(train.reliability).toBe(Math.max(0, V.reliabilityMax - 700 * M.tankEngine.reliabilityDecay))
            expect(halves[1]).toBeGreaterThan(halves[0]!)
            expect(train.breakdownsSinceService).toBe(Math.min(255, halves[0]! + halves[1]!))
        })

        it('is due once more than serviceDays whole days have passed, only while running and without depot orders', () => {
            const train = runningTrain()
            train.lastServiceTick = 5 * DAY + 3
            const lastDay = (5 + SERVICE_DAYS) * DAY
            expect(rtVehicleNeedsService(train, lastDay + DAY - 1)).toBe(false)
            expect(rtVehicleNeedsService(train, lastDay + DAY)).toBe(true)
            const due = lastDay + DAY
            train.stopped = true
            expect(rtVehicleNeedsService(train, due)).toBe(false)
            train.stopped = false
            train.state = RtVehicleState.crashed
            expect(rtVehicleNeedsService(train, due)).toBe(false)
            train.state = RtVehicleState.loading
            expect(rtVehicleNeedsService(train, due)).toBe(true)
            expect(rtVehicleNeedsAutoService(train, due)).toBe(false)
            train.state = RtVehicleState.driving
            expect(rtVehicleNeedsAutoService(train, due)).toBe(true)
            train.orders = [{ kind: RtOrderKind.gotoStation, target: 0, flags: 0 }, { kind: RtOrderKind.gotoDepot, target: 77, flags: 0 }]
            expect(rtVehicleNeedsAutoService(train, due)).toBe(false)
            train.lastServiceTick = RT_NONE
            expect(rtVehicleNeedsService(train, 0)).toBe(true)
        })

        it('a depot visit restores reliability, clears the breakdown count and finishes an implicit visit', () => {
            const w = sharingWorld(true)
            const depot = w.map.idx(10, 10)
            buildDepot(w.map, ME, depot, RtVehicleKind.rail, RtDir.se, true)
            const train = runningTrain()
            Object.assign(train, { reliability: 1000, breakdownsSinceService: 3, breakdownChance: 40, serviceDepot: depot, routeTick: 5 })
            const money = w.company(ME)!.money
            expect(rtServiceInDepot(w, train, depot, 9000)).toBe(0)
            expect(train).toMatchObject({
                reliability: V.reliabilityMax, breakdownsSinceService: 0, breakdownChance: 0,
                lastServiceTick: 9000, serviceDepot: RT_NONE, routeTick: RT_NONE
            })
            expect(w.company(ME)!.money).toBe(money)
        })

        it('a service at another company\'s depot pays its owner depotSharingFee, and nothing without sharing', () => {
            const w = sharingWorld(true)
            const depot = w.map.idx(10, 10)
            buildDepot(w.map, RIVAL, depot, RtVehicleKind.rail, RtDir.se, true)
            const fee = depotSharingFee(w)
            expect(fee).toBeGreaterThan(0)
            const mine = w.company(ME)!
            const theirs = w.company(RIVAL)!
            const [myMoney, theirMoney] = [mine.money, theirs.money]
            expect(rtServiceInDepot(w, runningTrain(), depot, 100)).toBe(fee)
            expect(mine.money).toBe(myMoney - fee)
            expect(theirs.money).toBe(theirMoney + fee)
            expect(mine.financeThisYear.sharingCosts).toBe(-fee)
            expect(theirs.financeThisYear.sharingIncome).toBe(fee)

            const closed = sharingWorld(false)
            buildDepot(closed.map, RIVAL, depot, RtVehicleKind.rail, RtDir.se, true)
            const before = closed.company(ME)!.money
            const train = runningTrain()
            train.reliability = 5
            expect(rtServiceInDepot(closed, train, depot, 100)).toBe(0)
            expect(train.reliability).toBe(V.reliabilityMax)
            expect(closed.company(ME)!.money).toBe(before)
        })

        it('a due vehicle is sent to the depot on its way, keeps it, and drops it when no depot is near', () => {
            const w = sharingWorld(true)
            const rng = new SeededRandom(7)
            const depot = { tile: w.map.idx(10, 10), searches: 0 }
            const ctx = context(w, depot)
            const train = runningTrain()
            train.speed = 0
            const due = (SERVICE_DAYS + 1) * DAY
            expect(serviceAndBreakdown(train, rng, due - DAY, ctx).serviceDepotChanged).toBe(false)
            expect(depot.searches).toBe(0)
            train.routeTick = 40
            expect(serviceAndBreakdown(train, rng, due, ctx)).toEqual({ brokeDown: false, serviced: false, serviceDepotChanged: true, fee: 0 })
            expect(train.serviceDepot).toBe(depot.tile)
            expect(train.routeTick).toBe(RT_NONE)
            train.routeTick = 41
            expect(serviceAndBreakdown(train, rng, due + DAY, ctx).serviceDepotChanged).toBe(false)
            expect(train.routeTick).toBe(41)
            depot.tile = RT_NONE
            expect(serviceAndBreakdown(train, rng, due + 2 * DAY, ctx).serviceDepotChanged).toBe(true)
            expect(train.serviceDepot).toBe(RT_NONE)
            expect(train.routeTick).toBe(RT_NONE)
            expect(serviceAndBreakdown(train, rng, due + 3 * DAY).serviceDepotChanged).toBe(false)
        })

        it('one heading for a depot switches to another only by the original\'s small daily chance', () => {
            const w = sharingWorld(true)
            const rng = new SeededRandom(7)
            const first = w.map.idx(10, 10)
            const depot = { tile: w.map.idx(20, 20), searches: 0 }
            const ctx = context(w, depot)
            const train = runningTrain()
            train.speed = 0
            let switches = 0
            for (let day = 0; day < 1600; day++) {
                train.serviceDepot = first
                serviceAndBreakdown(train, rng, (SERVICE_DAYS + 1 + day) * DAY, ctx)
                if (train.serviceDepot === depot.tile) switches++
            }
            expect(switches).toBeGreaterThan(1600 * 3 / 16 * 0.7)
            expect(switches).toBeLessThan(1600 * 3 / 16 * 1.3)
        })

        it('a running vehicle standing in a depot is serviced in place; a stopped one is not', () => {
            const w = sharingWorld(true)
            const rng = new SeededRandom(7)
            const tile = w.map.idx(10, 10)
            buildDepot(w.map, RIVAL, tile, RtVehicleKind.rail, RtDir.se, true)
            const depot = { tile, searches: 0 }
            const train = createVehicle(0, ME, M.tankEngine.index, [], tile, RtDir.se, 0)
            train.reliability = 100
            const due = (SERVICE_DAYS + 1) * DAY
            expect(serviceAndBreakdown(train, rng, due, context(w, depot)).serviced).toBe(false)
            expect(train.reliability).toBe(100 - M.tankEngine.reliabilityDecay)
            train.stopped = false
            expect(serviceAndBreakdown(train, rng, due, context(w, depot)))
                .toEqual({ brokeDown: false, serviced: true, serviceDepotChanged: false, fee: depotSharingFee(w) })
            expect(train.reliability).toBe(V.reliabilityMax)
            expect(train.lastServiceTick).toBe(due)
            expect(depot.searches).toBe(0)
        })

        it('running cost: a year of running ticks costs the yearly running cost, less under a tick a day', () => {
            const train = runningTrain()
            const yearly = rtConsistRunningCost(train.consist)
            const period = RT_CATALOG.time.yearDays * DAY
            let total = 0
            for (let day = 0; day < RT_CATALOG.time.yearDays; day++) {
                runTicks(train, 50)
                total += rtVehicleRunningCost(train)
                expect(Number.isInteger(train.runningTicks) && train.runningTicks >= 0).toBe(true)
            }
            expect(total).toBeLessThanOrEqual(yearly)
            expect(total).toBeGreaterThanOrEqual(yearly - Math.ceil(RT_CATALOG.time.yearDays * yearly / period))
            expect(train.profitThisYear).toBe(-total)

            const parked = runningTrain()
            parked.stopped = true
            parked.speed = 0
            rtCountRunningTick(parked)
            expect(parked.runningTicks).toBe(0)
            parked.speed = 10
            rtCountRunningTick(parked)
            expect(parked.runningTicks).toBe(1)
            const bus = createVehicle(1, ME, M.townBus.index, [], 1000, RtDir.se, 0)
            bus.speed = 10
            rtCountRunningTick(bus)
            expect(bus.runningTicks).toBe(0)
        })

        it('the daily step is staggered by id: every vehicle runs once in each day', () => {
            const ids = Array.from({ length: 300 }, (_, k) => k)
            const runs = ids.map(() => 0)
            for (let tick = 5000; tick < 5000 + DAY; tick++) {
                for (const id of ids) if (rtIsVehicleDayTick(id, tick)) runs[id]!++
            }
            expect(runs.every(count => count === 1)).toBe(true)
            expect(rtVehicleDayPhase(DAY + 3)).toBe(3)
        })

        it('twin worlds stepping a fleet for 400 days with world.rng hash equal, every field a non-negative integer', () => {
            function run(): RtWorld {
                const w = sharingWorld(true)
                const own = w.map.idx(10, 10)
                const foreign = w.map.idx(30, 30)
                buildDepot(w.map, ME, own, RtVehicleKind.rail, RtDir.se, true)
                buildDepot(w.map, RIVAL, foreign, RtVehicleKind.rail, RtDir.se, true)
                for (let id = 0; id < 6; id++) {
                    const vehicle = id % 3 === 2
                        ? createVehicle(id, ME, M.townBus.index, [], 1000 + id, RtDir.se, 0)
                        : runningTrain(id)
                    vehicle.state = RtVehicleState.driving
                    vehicle.stopped = false
                    w.insertVehicle(vehicle)
                }
                const ctx: RtServiceContext = { world: w, findServiceDepot: v => (v.id % 2 === 0 ? own : foreign) }
                for (let tick = 0; tick < 400 * DAY; tick++) {
                    w.tick = tick
                    for (const vehicle of w.vehicleList()) {
                        if (rtIsVehicleDayTick(vehicle.id, tick)) rtVehicleDay(vehicle, w.rng, tick, ctx)
                        if (!rtBreakdownTick(vehicle)) vehicle.speed = 40
                        rtCountRunningTick(vehicle)
                        // Arriving at the service depot stands in for movement entering it.
                        if (vehicle.serviceDepot !== RT_NONE && tick % (7 * DAY) === 0) {
                            rtServiceInDepot(w, vehicle, vehicle.serviceDepot, tick)
                        }
                    }
                }
                return w
            }
            const a = run()
            const b = run()
            expect(a.hash()).toBe(b.hash())
            expect(a.rng.state).toBe(b.rng.state)
            expect(a.company(RIVAL)!.financeThisYear.sharingIncome).toBeGreaterThan(0)
            const counted: (keyof RtVehicle)[] = ['reliability', 'breakdownChance', 'breakdownTicks', 'breakdownsSinceService',
                'lastServiceTick', 'runningTicks', 'speed', 'subspeed', 'age']
            for (const vehicle of a.vehicleList()) {
                for (const key of counted) {
                    const value = vehicle[key] as number
                    expect(Number.isInteger(value) && value >= 0, `${key} = ${value}`).toBe(true)
                }
                expect(vehicle.breakdownChance).toBeLessThanOrEqual(255)
                expect(vehicle.reliability).toBeLessThanOrEqual(V.reliabilityMax)
                expect(vehicle.lastServiceTick).toBeGreaterThan(0)
            }
        })
    })
})

/* ------------------------------------------------------------------------------------------
 * Trains on built networks over long runs. The runs step every vehicle in
 * id order each tick, as RtWorld.step does.
 * ---------------------------------------------------------------------------------------- */

type XY = [number, number]

const ENGINE = M.expressEngine.index
const EAST = 8
const WEST = 0
const SOUTH = 1
const NORTH = 9

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

/** A diagonal staircase east and south from (x, y): (x+1, y), (x+1, y+1), (x+2, y+1), ... */
function stairs(x: number, y: number, steps: number): XY[] {
    const out: XY[] = []
    for (let k = 0; k < steps; k++) out.push([x + k + 1, y + k], [x + k + 1, y + k + 1])
    return out
}

/** A signal of `type` for trains travelling `td` only, or for both directions with `twoWay`. */
function signal(world: RtWorld, owner: number, xy: XY, type: number, td: number, twoWay = false): void {
    const times = twoWay ? 1 : (td & 8) === 0 ? 2 : 3
    for (let k = 0; k < times; k++) {
        const placed = placeSignal(world.map, owner, world.map.idx(xy[0], xy[1]), td & 7, type, true)
        if (!placed.ok) throw new Error(`signal failed at ${xy} (${placed.error})`)
    }
}

/** Every signal shows its real aspect (a new one is red until the first update). */
function settle(world: RtWorld): void {
    const tiles: number[] = []
    for (let t = 0; t < world.map.side * world.map.side; t++) if (world.map.kind[t] === RtTileKind.rail) tiles.push(t)
    updateSignalStates(world.map, (tile, piece, except) => world.occupied.otherTrainOnPiece(tile, piece, except) !== RT_NONE, tiles, world.settings.sharing)
}

function net(sharing = false): RtWorld {
    return RtWorld.empty({ side: 64, maxCompanies: 8, sharing }, {
        rngState: 7, companies: [rtNewCompany(ME, 'Mine', 0, 0), rtNewCompany(RIVAL, 'Rival', 1, 0)]
    })
}

function railStation(world: RtWorld, owner: number, xy: XY, axis: number, length: number): number {
    const built = buildRailStation(world.map, world.stations as RtStation[], [], owner, world.map.idx(xy[0], xy[1]), axis, 1, length, true)
    if (!built.ok) throw new Error(`station failed at ${xy} (${built.error})`)
    return (built as { station: number }).station
}

/** A train (engine plus wagons) bought in the depot at `xy`, built facing `facing` when missing, started unless `stopped`. */
function depotTrain(world: RtWorld, owner: number, xy: XY, facing: number, orders: RtVehicle['orders'] = [], wagons: number[] = [], stopped = false): RtVehicle {
    const tile = world.map.idx(xy[0], xy[1])
    if (world.map.kind[tile] !== RtTileKind.depot) {
        const built = buildDepot(world.map, owner, tile, RtVehicleKind.rail, facing, true)
        if (!built.ok) throw new Error(`depot failed at ${xy} (${built.error})`)
    }
    const bought = buyVehicle(world, owner, tile, ENGINE, wagons, true)
    if (!bought.ok) throw new Error(`buy failed (${bought.error})`)
    const v = world.vehicle(bought.vehicle)!
    v.orders = orders
    v.stopped = stopped
    return v
}

const gotoStation = (target: number) => ({ kind: RtOrderKind.gotoStation, target, flags: 0 })
const gotoDepot = (target: number) => ({ kind: RtOrderKind.gotoDepot, target, flags: 0 })

interface RunOptions {
    hooks?: RtTrainHooks
    /** Pathfinder nodes per tick (default the catalog's). */
    budget?: number
    /** Called after every tick; returning true ends the run early. */
    each?: (tick: number) => unknown
}

/** Steps every vehicle in id order for up to `ticks` ticks, removing crashed ones whose time is up. */
function run(world: RtWorld, ticks: number, options: RunOptions = {}): void {
    for (let t = 0; t < ticks; t++) {
        world.tick++
        world.pathNodesLeft = options.budget ?? RT_CATALOG.pathfinder.pathNodesPerTick
        for (const v of world.vehicleList()) {
            const result = v.kind === RtVehicleKind.rail ? stepTrain(world, v, options.hooks) : stepRoadVehicle(world, v, options.hooks)
            if (result.remove) rtRemoveTrain(world, v)
        }
        if (options.each?.(t)) return
    }
}

function trainsOf(world: RtWorld): RtVehicle[] {
    return world.vehicleList().filter(v => v.kind === RtVehicleKind.rail)
}

function anyCrashed(world: RtWorld): boolean {
    return world.vehicleList().some(v => v.state === RtVehicleState.crashed)
}

/** Whether two trains on track hold the same tile. */
function tileShared(world: RtWorld): boolean {
    const seen = new Map<number, number>()
    for (const v of trainsOf(world)) {
        if (v.state === RtVehicleState.inDepot) continue
        for (const tile of new Set(v.tiles)) {
            if (seen.has(tile)) return true
            seen.set(tile, v.id)
        }
    }
    return false
}

/** Whether the train holds any of the tiles (on track, not in a depot). */
function holdsAny(v: RtVehicle, tiles: Set<number>): boolean {
    return v.state !== RtVehicleState.inDepot && v.tiles.some(tile => tiles.has(tile))
}

/** Every reserved piece is held by a train or lies on a train's reservation ahead. */
function reservationsOwned(world: RtWorld): boolean {
    const owned = new Set<number>()
    for (const v of trainsOf(world)) {
        for (let k = 0; k < v.tiles.length; k++) owned.add(v.tiles[k]! * 8 + (v.pieces[k]! & 7))
        const ahead = rtReservedAhead(world.map, v)
        for (let k = 0; k < ahead.tiles.length; k++) owned.add(ahead.tiles[k]! * 8 + (ahead.trackdirs[k]! & 7))
    }
    for (let tile = 0; tile < world.map.side * world.map.side; tile++) {
        const kind = world.map.kind[tile]
        if (kind !== RtTileKind.rail && kind !== RtTileKind.station && kind !== RtTileKind.depot) continue
        for (let piece = 0; piece < 6; piece++) {
            if (rtPieceReserved(world.map, tile, piece) && !owned.has(tile * 8 + piece)) return false
        }
    }
    return true
}

/** No train's reservation ahead runs over a piece another train holds. */
function reservationsClear(world: RtWorld): boolean {
    for (const v of trainsOf(world)) {
        const ahead = rtReservedAhead(world.map, v)
        for (let k = 0; k < ahead.tiles.length; k++) {
            if (world.occupied.trainsOnPiece(ahead.tiles[k]!, ahead.trackdirs[k]! & 7).some(id => id !== v.id)) return false
        }
    }
    return true
}

function anyReservation(world: RtWorld): boolean {
    for (let tile = 0; tile < world.map.side * world.map.side; tile++) {
        for (let piece = 0; piece < 6; piece++) if (rtPieceReserved(world.map, tile, piece)) return true
    }
    return false
}

/**
 * A one-way circuit, clockwise: east along y = 10 from x = 9 to 41, south down x = 41, west along
 * y = 20, north up x = 9 (the outer branch), plus an inner branch from (14, 20) north up x = 14 that
 * merges into y = 10 at (14, 10). One-way path signals: both merge entries, before the split, and
 * every ten tiles around. A depot at (25, 9) joins the top row heading east. Returns the depot tile.
 */
function circuit(world: RtWorld): number {
    const map = world.map
    lay(map, ME, [...row(10, 9, 41), ...column(41, 11, 20), ...row(20, 40, 9), ...column(9, 19, 11)], true)
    lay(map, ME, [[15, 20], [14, 20], ...column(14, 19, 11), [14, 10], [15, 10]])
    const corner = buildRail(map, ME, map.idx(25, 10), rtPieceBetween(RtDir.nw, RtDir.sw), true)
    if (!corner.ok) throw new Error(`depot link failed (${corner.error})`)
    const depot = map.idx(25, 9)
    const built = buildDepot(map, ME, depot, RtVehicleKind.rail, RtDir.se, true)
    if (!built.ok) throw new Error(`depot failed (${built.error})`)
    const path = RtSignalType.path
    signal(world, ME, [12, 10], path, EAST)
    signal(world, ME, [14, 12], path, NORTH)
    signal(world, ME, [17, 20], path, WEST)
    signal(world, ME, [22, 10], path, EAST)
    signal(world, ME, [34, 10], path, EAST)
    signal(world, ME, [41, 15], path, SOUTH)
    signal(world, ME, [34, 20], path, WEST)
    signal(world, ME, [26, 20], path, WEST)
    settle(world)
    return depot
}

/**
 * Two trains running at each other: a west line (x 6 to 22, depot at 5) and an east line (x 24 to
 * 40, depot at 41, owned by `eastDepotOwner`), each with a train heading for the gap at x = 23. A
 * depot works as a block signal, so trains never leave onto an occupied line; the gap is closed while
 * both are on their way. Returns the per-tick step that lays (23, 10) once both are near.
 */
function headOn(w: RtWorld, westOwner: number, eastDepotOwner: number, extra?: () => void): () => void {
    const map = w.map
    lay(map, ME, row(10, 6, 22))
    lay(map, ME, row(10, 24, 40))
    extra?.()
    settle(w)
    const west = depotTrain(w, westOwner, [5, 10], RtDir.sw)
    const east = depotTrain(w, eastDepotOwner, [41, 10], RtDir.ne)
    let joined = false
    return () => {
        if (joined || west.state !== RtVehicleState.driving || east.state !== RtVehicleState.driving) return
        if (west.tiles[0]! % 64 < 17 || east.tiles[0]! % 64 > 29 || (west.pieces[0]! & 8) === 0 || (east.pieces[0]! & 8) !== 0) return
        const built = buildRail(map, ME, map.idx(23, 10), RtTrack.x, true)
        if (!built.ok) throw new Error(`join failed (${built.error})`)
        settle(w)
        joined = true
    }
}

describe('rail tycoon trains on built networks', () => {
    it('shuttles between two termini for 10000 ticks, at least four arrivals at each end, never lost', () => {
        const w = net()
        lay(w.map, ME, row(10, 6, 40))
        const a = railStation(w, ME, [8, 10], RtAxis.x, 3)
        const b = railStation(w, ME, [36, 10], RtAxis.x, 3)
        const train = depotTrain(w, ME, [5, 10], RtDir.sw, [gotoStation(a), gotoStation(b)], [M.passengerCoach.index, M.passengerCoach.index])
        const arrivals: number[] = []
        let lost = false
        run(w, 10000, { hooks: { arrive: (_w, _v, s) => arrivals.push(s) }, each: () => { lost ||= train.lost } })
        expect(arrivals.filter(s => s === a).length).toBeGreaterThanOrEqual(4)
        expect(arrivals.filter(s => s === b).length).toBeGreaterThanOrEqual(4)
        for (let k = 1; k < arrivals.length; k++) expect(arrivals[k]).not.toBe(arrivals[k - 1])
        expect(lost).toBe(false)
    })

    it('sent past the end of a spur, a train reverses and still reaches its next stop, never lost', () => {
        const w = net()
        lay(w.map, ME, row(10, 6, 34))
        const east = railStation(w, ME, [26, 10], RtAxis.x, 3)
        const west = railStation(w, ME, [8, 10], RtAxis.x, 3)
        const train = depotTrain(w, ME, [5, 10], RtDir.sw, [gotoStation(east), gotoStation(west)])
        const arrivals: number[] = []
        let lost = false
        let farthest = 0
        run(w, 4000, {
            hooks: { arrive: (_w, _v, s) => arrivals.push(s) },
            each: () => {
                lost ||= train.lost
                if (train.state !== RtVehicleState.inDepot) farthest = Math.max(farthest, train.tiles[0]! % 64)
            }
        })
        expect(arrivals.slice(0, 2)).toEqual([east, west])
        expect(lost).toBe(false)
        // it stopped at the platform end, not at the spur's end
        expect(farthest).toBeLessThanOrEqual(28)
    })

    it('two trains on a single line with a path-signalled passing loop never share a tile and keep arriving (20000 ticks)', () => {
        const w = net()
        const map = w.map
        lay(map, ME, row(10, 6, 40))
        // the loop: the upper track (y = 10) is eastbound only, the lower (y = 12) westbound only
        lay(map, ME, [[18, 10], [19, 10], [19, 11], [19, 12], ...row(12, 20, 26), [27, 12], [27, 11], [27, 10], [28, 10]])
        signal(w, ME, [20, 10], RtSignalType.path, EAST)
        signal(w, ME, [26, 10], RtSignalType.path, EAST)
        signal(w, ME, [26, 12], RtSignalType.path, WEST)
        signal(w, ME, [20, 12], RtSignalType.path, WEST)
        settle(w)
        const west = railStation(w, ME, [8, 10], RtAxis.x, 3)
        const east = railStation(w, ME, [36, 10], RtAxis.x, 3)
        const a = depotTrain(w, ME, [5, 10], RtDir.sw, [gotoStation(east), gotoStation(west)])
        const b = depotTrain(w, ME, [41, 10], RtDir.ne, [gotoStation(west), gotoStation(east)])
        const arrivals = new Map<number, number>()
        let shared = false
        run(w, 20000, {
            hooks: { arrive: (_w, v) => arrivals.set(v.id, (arrivals.get(v.id) ?? 0) + 1) },
            each: () => {
                shared ||= tileShared(w)
                return shared
            }
        })
        expect(shared).toBe(false)
        expect(anyCrashed(w)).toBe(false)
        expect(arrivals.get(a.id) ?? 0).toBeGreaterThanOrEqual(6)
        expect(arrivals.get(b.id) ?? 0).toBeGreaterThanOrEqual(6)
    })

    it('a red block signal holds a train until the block ahead clears', () => {
        const w = net()
        const map = w.map
        lay(map, ME, row(10, 6, 40))
        buildDepot(map, ME, map.idx(41, 10), RtVehicleKind.rail, RtDir.ne, true)
        signal(w, ME, [20, 10], RtSignalType.block, EAST)
        settle(w)
        const blocker = depotTrain(w, ME, [5, 10], RtDir.sw)
        run(w, 3000, { each: () => blocker.tiles[0]! % 64 >= 25 })
        // it breaks down in the block, then parks in the east depot
        blocker.breakdownTicks = 3000
        blocker.stopped = true
        const held = depotTrain(w, ME, [5, 10], RtDir.sw)
        let heldAtSignal = 0
        run(w, 2500, {
            each: () => {
                expect(held.tiles.includes(map.idx(20, 10)) && held.state !== RtVehicleState.inDepot).toBe(false)
                if (held.tiles[0] === map.idx(19, 10) && held.speed === 0) heldAtSignal++
            }
        })
        expect(heldAtSignal).toBeGreaterThan(0)
        let passed = false
        run(w, 3000, { each: () => (passed = held.state !== RtVehicleState.inDepot && held.tiles[0]! % 64 > 20) })
        expect(passed).toBe(true)
        expect(anyCrashed(w)).toBe(false)
    })

    it('two trains released at both entry signals of a merge block on the same tick never occupy it together', () => {
        const w = net()
        const map = w.map
        lay(map, ME, row(10, 6, 40))
        lay(map, ME, [...row(14, 6, 17), [18, 14], ...column(18, 13, 11), [18, 10], [19, 10]])
        const eastDepot = map.idx(41, 10)
        buildDepot(map, ME, eastDepot, RtVehicleKind.rail, RtDir.ne, true)
        signal(w, ME, [17, 10], RtSignalType.block, EAST)
        signal(w, ME, [18, 12], RtSignalType.block, NORTH)
        signal(w, ME, [30, 10], RtSignalType.block, EAST)
        settle(w)
        const block = new Set([map.idx(18, 11), map.idx(18, 10), ...row(10, 19, 29).map(([x, y]) => map.idx(x, y))])
        const blocker = depotTrain(w, ME, [5, 10], RtDir.sw)
        run(w, 3000, { each: () => blocker.tiles[0]! % 64 >= 24 })
        blocker.breakdownTicks = 2500
        blocker.stopped = true
        const one = depotTrain(w, ME, [5, 10], RtDir.sw, [gotoDepot(eastDepot)])
        const two = depotTrain(w, ME, [5, 14], RtDir.sw, [gotoDepot(eastDepot)])
        const parkInEast = () => {
            for (const v of [one, two]) if (v.state === RtVehicleState.inDepot && v.tiles[0] === eastDepot) v.stopped = true
        }
        let bothWaiting = false
        run(w, 2400, {
            each: () => {
                parkInEast()
                bothWaiting = one.speed === 0 && two.speed === 0 && one.tiles[0] === map.idx(16, 10) && two.tiles[0] === map.idx(18, 13)
            }
        })
        expect(bothWaiting).toBe(true)
        let together = false
        let releasedOn = -1
        run(w, 4000, {
            each: tick => {
                parkInEast()
                if (releasedOn < 0 && (holdsAny(one, block) || holdsAny(two, block))) releasedOn = tick
                together ||= holdsAny(one, block) && holdsAny(two, block)
            }
        })
        expect(releasedOn).toBeGreaterThanOrEqual(0)
        expect(together).toBe(false)
        expect(anyCrashed(w)).toBe(false)
        expect(one.state === RtVehicleState.inDepot && two.state === RtVehicleState.inDepot).toBe(true)
    })

    it('two trains head-on on unsignalled single track crash, free everything and are deleted; twin worlds agree', () => {
        const play = () => {
            const w = net()
            const join = headOn(w, ME, ME)
            let crashedAt = -1
            let gone = -1
            run(w, 8000, {
                each: tick => {
                    join()
                    if (crashedAt < 0 && anyCrashed(w)) crashedAt = tick
                    if (crashedAt >= 0 && gone < 0 && trainsOf(w).length === 0) gone = tick
                    return gone >= 0
                }
            })
            return { w, crashedAt, gone }
        }
        const first = play()
        const second = play()
        expect(first.crashedAt).toBeGreaterThan(0)
        expect(first.gone - first.crashedAt).toBe(RT_CATALOG.vehicles.crashTicks)
        expect(anyReservation(first.w)).toBe(false)
        for (let tile = 0; tile < 64 * 64; tile++) expect(first.w.occupied.vehicleOnTile(tile)).toBe(false)
        expect([second.crashedAt, second.gone]).toEqual([first.crashedAt, first.gone])
        expect(second.w.hash()).toBe(first.w.hash())
    })

    it('a train entering a level crossing with a bus on it destroys the bus', () => {
        const w = net()
        const map = w.map
        lay(map, ME, row(10, 6, 40))
        for (let y = 5; y <= 15; y++) buildRoad(map, ME, map.idx(20, y), RT_ROAD_Y, true)
        const crossing = map.idx(20, 10)
        buildDepot(map, ME, map.idx(20, 4), RtVehicleKind.road, RtDir.se, true)
        const bought = buyVehicle(w, ME, map.idx(20, 4), M.townBus.index, [], true)
        const bus = w.vehicle((bought as { vehicle: number }).vehicle)!
        bus.stopped = false
        run(w, 2000, { each: () => bus.tiles[0] === crossing })
        expect(bus.tiles[0]).toBe(crossing)
        // the bus breaks down on the crossing; a train comes
        bus.breakdownTicks = 10000
        const train = depotTrain(w, ME, [5, 10], RtDir.sw)
        run(w, 2000, { each: () => bus.state === RtVehicleState.crashed })
        expect(bus.state).toBe(RtVehicleState.crashed)
        expect(train.state).not.toBe(RtVehicleState.crashed)
    })

    it('two trains on parallel diagonals that share tiles run 10000 ticks without a crash', () => {
        const w = net()
        const map = w.map
        lay(map, ME, [...row(10, 6, 12), ...stairs(12, 10, 10), ...row(20, 23, 40)])
        lay(map, ME, [...row(9, 6, 12), ...stairs(12, 9, 10), ...row(19, 23, 40)])
        const one = depotTrain(w, ME, [5, 10], RtDir.sw)
        let two: RtVehicle | null = null
        let sharedTicks = 0
        run(w, 10000, {
            each: tick => {
                if (tick === 40) two = depotTrain(w, ME, [5, 9], RtDir.sw)
                if (two && one.state !== RtVehicleState.inDepot && two.state !== RtVehicleState.inDepot
                    && one.tiles.some(t => two!.tiles.includes(t))) sharedTicks++
            }
        })
        expect(anyCrashed(w)).toBe(false)
        expect(sharedTicks).toBeGreaterThan(0)
    })

    it('of two trains started in one depot, one leaves while the other waits for the block to clear; no crash', () => {
        const w = net()
        const map = w.map
        lay(map, ME, row(10, 6, 40))
        signal(w, ME, [15, 10], RtSignalType.block, EAST)
        settle(w)
        const first = depotTrain(w, ME, [5, 10], RtDir.sw)
        const second = depotTrain(w, ME, [5, 10], RtDir.sw)
        const nearBlock = new Set(row(10, 6, 14).map(([x, y]) => map.idx(x, y)))
        let waited = false
        let leftEarly = false
        run(w, 1500, {
            each: () => {
                if (holdsAny(first, nearBlock) && second.state === RtVehicleState.inDepot) waited = true
                if (holdsAny(first, nearBlock) && second.state !== RtVehicleState.inDepot) leftEarly = true
                expect(tileShared(w)).toBe(false)
            }
        })
        // the depot works as a block signal: the second leaves only once the first is out of the depot's block
        expect(waited).toBe(true)
        expect(leftEarly).toBe(false)
        expect(second.state).toBe(RtVehicleState.driving)
        expect(anyCrashed(w)).toBe(false)
    })

    it('a train driving into a depot for service with another parked inside does not crash', () => {
        const w = net()
        const map = w.map
        lay(map, ME, row(10, 6, 30))
        const depot = map.idx(31, 10)
        buildDepot(map, ME, depot, RtVehicleKind.rail, RtDir.ne, true)
        const parked = depotTrain(w, ME, [31, 10], RtDir.ne, [], [], true)
        const visitor = depotTrain(w, ME, [5, 10], RtDir.sw, [gotoDepot(depot)])
        let together = false
        run(w, 3000, {
            each: () => {
                together ||= visitor.state === RtVehicleState.inDepot && visitor.tiles[0] === depot
                    && w.occupied.depotOccupants(depot).includes(parked.id) && w.occupied.depotOccupants(depot).includes(visitor.id)
            }
        })
        expect(together).toBe(true)
        expect(anyCrashed(w)).toBe(false)
        expect(parked.state).toBe(RtVehicleState.inDepot)
    })

    it('once a crashed pair is deleted, the entry signal of their block turns green', () => {
        const w = net()
        const map = w.map
        const join = headOn(w, ME, ME, () => signal(w, ME, [12, 10], RtSignalType.block, EAST))
        let redWhileWrecked = false
        let crashed = false
        run(w, 12000, {
            each: () => {
                join()
                if (anyCrashed(w)) {
                    crashed = true
                    redWhileWrecked ||= !rtSignalGreen(map, map.idx(12, 10), EAST)
                }
                return crashed && trainsOf(w).length === 0
            }
        })
        expect(crashed).toBe(true)
        expect(redWhileWrecked).toBe(true)
        expect(trainsOf(w)).toHaveLength(0)
        expect(rtSignalGreen(map, map.idx(12, 10), EAST)).toBe(true)
    })

    it('a merge entered through path signals, two trains per branch, runs 20000 ticks: no crash, every reservation owned', () => {
        const w = net()
        const map = w.map
        const depot = circuit(w)
        const outer = railStation(w, ME, [9, 13], RtAxis.y, 3)
        const inner = railStation(w, ME, [14, 15], RtAxis.y, 3)
        const xy: XY = [map.tileX(depot), map.tileY(depot)]
        const trains = [outer, outer, inner, inner].map(s => depotTrain(w, ME, xy, RtDir.se, [gotoStation(s)]))
        const arrivals = new Map<number, number[]>()
        let clear = true
        run(w, 20000, {
            hooks: { arrive: (_w, v, s) => arrivals.set(v.id, [...(arrivals.get(v.id) ?? []), s]) },
            each: tick => {
                if (tick % 10 === 0) clear &&= reservationsClear(w)
                return anyCrashed(w)
            }
        })
        expect(anyCrashed(w)).toBe(false)
        expect(clear).toBe(true)
        expect(reservationsOwned(w)).toBe(true)
        for (const [k, train] of trains.entries()) {
            const seen = arrivals.get(train.id) ?? []
            expect(seen.length, `train ${k}`).toBeGreaterThanOrEqual(3)
            expect(seen.every(s => s === (k < 2 ? outer : inner))).toBe(true)
        }
    })

    it('a train held at a red two-way block signal turns round after twoWaySignalWaitTicks', () => {
        const w = net()
        const map = w.map
        lay(map, ME, row(10, 6, 40))
        signal(w, ME, [20, 10], RtSignalType.block, EAST, true)
        settle(w)
        const blocker = depotTrain(w, ME, [5, 10], RtDir.sw)
        run(w, 3000, { each: () => blocker.tiles[0]! % 64 >= 25 })
        blocker.breakdownTicks = 20000
        const held = depotTrain(w, ME, [5, 10], RtDir.sw)
        let stoppedAt = -1
        let turnedAt = -1
        run(w, 6000, {
            each: tick => {
                if (stoppedAt < 0 && held.tiles[0] === map.idx(19, 10) && held.speed === 0) stoppedAt = tick
                if (stoppedAt >= 0 && turnedAt < 0 && (held.pieces[0]! & 8) === 0) turnedAt = tick
                return turnedAt >= 0
            }
        })
        expect(stoppedAt).toBeGreaterThan(0)
        expect(turnedAt - stoppedAt).toBeGreaterThanOrEqual(RT_CATALOG.signals.twoWaySignalWaitTicks - 1)
        expect(turnedAt - stoppedAt).toBeLessThanOrEqual(RT_CATALOG.signals.twoWaySignalWaitTicks + 1)
        expect(anyCrashed(w)).toBe(false)
    })

    it('with sharing, trains of two companies head-on on unsignalled track both stop, one turns round, neither crashes', () => {
        const w = net(true)
        const join = headOn(w, ME, RIVAL)
        const [mine, theirs] = trainsOf(w)
        let bothStopped = false
        let turned: number | null = null
        // the heading each had out on the line (in a depot, pieces[0] is the depot's facing)
        const heading = new Map<number, number>()
        run(w, 5000, {
            each: () => {
                join()
                if (mine.state !== RtVehicleState.driving || theirs.state !== RtVehicleState.driving) return
                for (const v of [mine, theirs]) if (!heading.has(v.id)) heading.set(v.id, v.pieces[0]! & 8)
                if (mine.speed === 0 && theirs.speed === 0 && Math.abs((mine.tiles[0]! % 64) - (theirs.tiles[0]! % 64)) <= 1) bothStopped = true
                if (bothStopped && turned === null) {
                    for (const v of [mine, theirs]) if ((v.pieces[0]! & 8) !== heading.get(v.id)) turned = v.id
                }
            }
        })
        expect(bothStopped).toBe(true)
        // the higher id turns round after the two-way wait
        expect(turned).toBe(Math.max(mine.id, theirs.id))
        expect(anyCrashed(w)).toBe(false)
    })

    it('with sharing, a rival train on our track pays exactly the fees booked, and twin worlds hash equal', () => {
        const play = () => {
            const w = net(true)
            lay(w.map, ME, row(10, 6, 40))
            const a = railStation(w, ME, [8, 10], RtAxis.x, 3)
            const b = railStation(w, ME, [36, 10], RtAxis.x, 3)
            const train = depotTrain(w, RIVAL, [5, 10], RtDir.sw, [gotoStation(a), gotoStation(b)])
            const [mine, theirs] = [w.companies[ME]!, w.companies[RIVAL]!]
            const before = { mine: mine.money, theirs: theirs.money, income: mine.financeThisYear.sharingIncome, cost: theirs.financeThisYear.sharingCosts }
            run(w, 5000, { hooks: rtLoadHooks })
            return { w, train, mine, theirs, before }
        }
        const { w, train, mine, theirs, before } = play()
        const earned = mine.money - before.mine
        expect(earned).toBeGreaterThan(0)
        expect(earned).toBe(mine.financeThisYear.sharingIncome - before.income)
        expect(theirs.money - before.theirs).toBe(theirs.financeThisYear.sharingCosts - before.cost)
        expect(theirs.money - before.theirs).toBe(-earned)
        expect(train.profitThisYear).toBe(0)
        expect(play().w.hash()).toBe(w.hash())
    })

    it('a block-signalled train waits while a path reservation runs through its block, and never crashes', () => {
        const w = net()
        const map = w.map
        lay(map, ME, row(10, 6, 40))
        lay(map, ME, [...column(20, 16, 11), [20, 10], [21, 10]])
        const eastDepot = map.idx(41, 10)
        buildDepot(map, ME, eastDepot, RtVehicleKind.rail, RtDir.ne, true)
        signal(w, ME, [18, 10], RtSignalType.path, EAST)
        signal(w, ME, [20, 12], RtSignalType.block, NORTH)
        signal(w, ME, [30, 10], RtSignalType.path, EAST)
        settle(w)
        const block = new Set([map.idx(20, 11), map.idx(20, 10), ...row(10, 21, 29).map(([x, y]) => map.idx(x, y))])
        const coach = M.passengerCoach.index
        const pathTrain = depotTrain(w, ME, [5, 10], RtDir.sw, [gotoDepot(eastDepot)], [coach, coach, coach, coach])
        run(w, 3000, { each: () => pathTrain.tiles[0]! % 64 >= 19 })
        expect(pathTrain.tiles[0]! % 64).toBeGreaterThanOrEqual(19)
        const blockTrain = depotTrain(w, ME, [20, 17], RtDir.nw, [gotoDepot(eastDepot)])
        let waited = false
        let together = false
        let reservedWhileIn = false
        run(w, 5000, {
            each: () => {
                for (const v of [pathTrain, blockTrain]) if (v.state === RtVehicleState.inDepot && v.tiles[0] === eastDepot) v.stopped = true
                if (blockTrain.tiles[0] === map.idx(20, 13) && blockTrain.speed === 0 && holdsAny(pathTrain, block)) waited = true
                together ||= holdsAny(pathTrain, block) && holdsAny(blockTrain, block)
                if (holdsAny(blockTrain, block)) {
                    const ahead = rtReservedAhead(map, pathTrain)
                    reservedWhileIn ||= ahead.tiles.some(t => block.has(t))
                }
            }
        })
        expect(waited).toBe(true)
        expect(together).toBe(false)
        expect(reservedWhileIn).toBe(false)
        expect(anyCrashed(w)).toBe(false)
        expect(blockTrain.state).toBe(RtVehicleState.inDepot)
    })

    it('two trains with orders to one single-platform station through path signals never share the platform (10000 ticks)', () => {
        const w = net()
        const map = w.map
        const depot = circuit(w)
        const station = railStation(w, ME, [28, 10], RtAxis.x, 3)
        const platform = new Set([map.idx(28, 10), map.idx(29, 10), map.idx(30, 10)])
        const xy: XY = [map.tileX(depot), map.tileY(depot)]
        const trains = [0, 1].map(() => depotTrain(w, ME, xy, RtDir.se, [gotoStation(station)]))
        const arrivals = new Map<number, number>()
        let shared = false
        run(w, 10000, {
            hooks: { arrive: (_w, v) => arrivals.set(v.id, (arrivals.get(v.id) ?? 0) + 1) },
            each: () => {
                shared ||= holdsAny(trains[0]!, platform) && holdsAny(trains[1]!, platform)
                return anyCrashed(w)
            }
        })
        expect(shared).toBe(false)
        expect(anyCrashed(w)).toBe(false)
        for (const train of trains) expect(arrivals.get(train.id) ?? 0).toBeGreaterThanOrEqual(3)
    })

    it('50 trains with orders to a station cut off from them stay within the node budget, go lost and retry once a day', () => {
        const budget = 400
        const play = () => {
            const w = net()
            const map = w.map
            for (let y = 5; y <= 54; y++) lay(map, ME, row(y, 6, 30))
            lay(map, ME, row(58, 10, 30))
            const station = railStation(w, ME, [20, 58], RtAxis.x, 3)
            // the only link, from the last row down to the station's line, is removed
            lay(map, ME, [[29, 54], [30, 54], ...column(30, 55, 57), [30, 58], [29, 58]])
            const removed = removeRail(map, ME, map.idx(30, 56), RtTrack.y, tile => w.occupied.vehicleOnTile(tile), true)
            expect(removed.ok).toBe(true)
            const trains: RtVehicle[] = []
            for (let y = 5; y <= 54; y++) trains.push(depotTrain(w, ME, [5, y], RtDir.sw, [gotoStation(station)]))
            const retries = new Map<number, number[]>()
            let overspent = false
            run(w, 1500, {
                budget,
                each: tick => {
                    if (w.pathNodesLeft < 0) overspent = true
                    for (const v of trains) {
                        const list = retries.get(v.id) ?? []
                        if (v.lostRetryTick !== RT_NONE && list[list.length - 1] !== v.lostRetryTick) list.push(v.lostRetryTick)
                        retries.set(v.id, list)
                    }
                    expect(anyCrashed(w)).toBe(false)
                    void tick
                }
            })
            return { w, trains, retries, overspent }
        }
        const first = play()
        expect(first.overspent).toBe(false)
        for (const v of first.trains) {
            expect(v.lost).toBe(true)
            const list = first.retries.get(v.id)!
            expect(list.length).toBeGreaterThanOrEqual(2)
            for (let k = 1; k < list.length; k++) expect(list[k]! - list[k - 1]!).toBeGreaterThanOrEqual(RT_CATALOG.pathfinder.lostRetryTicks)
        }
        expect(net().hash()).not.toBe(first.w.hash())
        expect(play().w.hash()).toBe(first.w.hash())
    })

    it('with a tick budget that fits only a few searches, every vehicle needing one gets it within a bounded number of ticks', () => {
        const w = net()
        const trains: RtVehicle[] = []
        for (let k = 0; k < 12; k++) {
            const y = 4 + 4 * k
            lay(w.map, ME, row(y, 6, 43))
            const station = railStation(w, ME, [44, y], RtAxis.x, 3)
            trains.push(depotTrain(w, ME, [5, y], RtDir.sw, [gotoStation(station)], [], true))
        }
        // one search's cost, measured on a copy
        const probe = decodeWorldOrThrow(encodeWorld(w))
        probe.vehicle(trains[0]!.id)!.stopped = false
        probe.step()
        const cost = probe.pathNodesPerTick - probe.pathNodesLeft
        expect(cost).toBeGreaterThan(0)
        w.pathNodesPerTick = Math.floor(cost * 2.5)
        for (const v of trains) v.stopped = false
        const routed = new Map<number, number>()
        const cursors = new Set<number>()
        for (let t = 1; t <= 20 && routed.size < trains.length; t++) {
            w.step()
            cursors.add(w.pathfinderCursor)
            for (const v of trains) if (!routed.has(v.id) && v.routeTick !== RT_NONE) routed.set(v.id, t)
        }
        expect(routed.size).toBe(trains.length)
        // two full searches a tick: twelve trains are served in six ticks, give or take one
        expect(Math.max(...routed.values())).toBeLessThanOrEqual(7)
        // the cursor moved on to the starved trains
        expect(cursors.size).toBeGreaterThan(2)
    })
})
