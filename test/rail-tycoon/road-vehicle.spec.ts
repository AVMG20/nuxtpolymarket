import { describe, expect, it } from 'vitest'
import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { buildDepot } from '#shared/utils/rail-tycoon/depots'
import { RtMap, RtTileKind, type RtDir } from '#shared/utils/rail-tycoon/map'
import { buildRoad } from '#shared/utils/rail-tycoon/road'
import { rtCrossingBarred, stepRoadVehicle } from '#shared/utils/rail-tycoon/road-vehicle'
import { RtStationTile, buildRoadStop } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_X, RT_ROAD_Y, RtTrack, buildRail } from '#shared/utils/rail-tycoon/track'
import { rtRemoveTrain, stepTrain, type RtTrainHooks } from '#shared/utils/rail-tycoon/train'
import { RtOrderKind, RtVehicleKind, RtVehicleState, type RtStation, type RtTown, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { buyVehicle } from '#shared/utils/rail-tycoon/vehicles'
import { RtWorld } from '#shared/utils/rail-tycoon/world'
import { devIt } from './dev-only'

const BUS = RT_CATALOG.vehicles.models.townBus.index
const ENGINE = RT_CATALOG.vehicles.models.expressEngine.index
const GAP = RT_CATALOG.movement.roadLaneGap
const BLOCKED = RT_CATALOG.vehicles.roadBlockedTicks

function town(map: RtMap): RtTown {
    return {
        id: 0, name: 'Testbury', centre: map.idx(20, 10), houseCount: 0, population: 0, growthCounter: 0, growthRate: 0,
        growing: false, activeStations: 0, receivedThisMonth: RT_CARGO_IDS.map(() => 0), receivedLastMonth: RT_CARGO_IDS.map(() => 0)
    }
}

function world(): RtWorld {
    const map = new RtMap(64)
    const w = RtWorld.empty({ side: 64, maxCompanies: 8, sharing: false }, { map, rngState: 11, towns: [town(map)] })
    w.addCompany('Buses')
    return w
}

function road(w: RtWorld, from: [number, number], to: [number, number]): void {
    const map = w.map
    const [x0, y0] = from
    const [x1, y1] = to
    const bits = y0 === y1 ? RT_ROAD_X : RT_ROAD_Y
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
            const built = buildRoad(map, 0, map.idx(x, y), bits, true)
            if (!built.ok) throw new Error(`road failed at ${x},${y} (${built.error})`)
        }
    }
}

function stop(w: RtWorld, x: number, y: number): number {
    const built = buildRoadStop(w.map, w.stations as RtStation[], w.towns as RtTown[], 0, w.map.idx(x, y), RtStationTile.bus, true)
    if (!built.ok) throw new Error(`stop failed at ${x},${y} (${built.error})`)
    return (built as { station: number }).station
}

function bus(w: RtWorld, depot: [number, number], facing: RtDir, orders: RtVehicle['orders'] = []): RtVehicle {
    const tile = w.map.idx(depot[0], depot[1])
    if (w.map.kind[tile] !== RtTileKind.depot) {
        const built = buildDepot(w.map, 0, tile, RtVehicleKind.road, facing, true)
        if (!built.ok) throw new Error(`depot failed (${built.error})`)
    }
    const bought = buyVehicle(w, 0, tile, BUS, [], true)
    if (!bought.ok) throw new Error(`buy failed (${bought.error})`)
    const v = w.vehicle(bought.vehicle)!
    v.orders = orders.map(o => ({ ...o }))
    v.stopped = false
    return v
}

const visit = (target: number) => ({ kind: RtOrderKind.gotoStation, target, flags: 0 })

function run(w: RtWorld, ticks: number, hooks?: RtTrainHooks, each?: (tick: number) => unknown): void {
    for (let t = 0; t < ticks; t++) {
        w.tick++
        w.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
        for (const v of w.vehicleList()) {
            const result = v.kind === RtVehicleKind.rail ? stepTrain(w, v, hooks) : stepRoadVehicle(w, v, hooks)
            if (result.remove) rtRemoveTrain(w, v)
        }
        if (each?.(t)) return
    }
}

/** Two road vehicles whose heads share a tile and lane are at least roadLaneGap apart. */
function lanesApart(w: RtWorld): boolean {
    const cars = w.vehicleList().filter(v => v.kind === RtVehicleKind.road && v.state !== RtVehicleState.inDepot)
    for (const a of cars) {
        for (const b of cars) {
            if (a.id < b.id && a.tiles[0] === b.tiles[0] && a.pieces[0] === b.pieces[0] && Math.abs(a.progress - b.progress) < GAP) return false
        }
    }
    return true
}

/** A small town: a main street along y = 10 (x 6 to 34) and a cross street along x = 20 (y 4 to 16). */
function townRoads(w: RtWorld): void {
    road(w, [6, 10], [34, 10])
    road(w, [20, 4], [20, 9])
    road(w, [20, 11], [20, 16])
    // the junction: a full crossroads
    buildRoad(w.map, 0, w.map.idx(20, 10), RT_ROAD_Y, true)
}

function count(list: number[], value: number): number {
    return list.filter(x => x === value).length
}

describe('rail tycoon road vehicles', () => {
    it('a bus serves two stops across a town, round a junction, for 10000 ticks', () => {
        const w = world()
        townRoads(w)
        const market = stop(w, 10, 10)
        const church = stop(w, 20, 6)
        const v = bus(w, [5, 10], 2 as RtDir, [visit(market), visit(church)])
        const arrivals: number[] = []
        run(w, 10000, { arrive: (_w, _v, s) => arrivals.push(s) })
        expect(count(arrivals, market)).toBeGreaterThanOrEqual(4)
        expect(count(arrivals, church)).toBeGreaterThanOrEqual(4)
        for (let k = 1; k < arrivals.length; k++) expect(arrivals[k]).not.toBe(arrivals[k - 1])
        expect(v.lost).toBe(false)
    })

    it('two buses on the same streets never overlap in a lane (10000 ticks)', () => {
        const w = world()
        townRoads(w)
        const market = stop(w, 10, 10)
        const church = stop(w, 20, 6)
        const school = stop(w, 20, 15)
        const first = bus(w, [5, 10], 2 as RtDir, [visit(market), visit(church)])
        const second = bus(w, [5, 10], 2 as RtDir, [visit(school), visit(market), visit(church)])
        const arrivals = new Map<number, number>()
        let apart = true
        run(w, 10000, { arrive: (_w, car) => arrivals.set(car.id, (arrivals.get(car.id) ?? 0) + 1) }, () => {
            apart &&= lanesApart(w)
        })
        expect(apart).toBe(true)
        expect(arrivals.get(first.id) ?? 0).toBeGreaterThanOrEqual(4)
        expect(arrivals.get(second.id) ?? 0).toBeGreaterThanOrEqual(4)
        expect(w.vehicleList().some(v => v.state === RtVehicleState.crashed)).toBe(false)
    })

    it('shuttles between two drive-through stops on a dead-end road, at least four arrivals at each (10000 ticks)', () => {
        const w = world()
        road(w, [6, 10], [30, 10])
        const a = stop(w, 9, 10)
        const b = stop(w, 28, 10)
        bus(w, [5, 10], 2 as RtDir, [visit(a), visit(b)])
        const arrivals: number[] = []
        run(w, 10000, { arrive: (_w, _v, s) => arrivals.push(s) })
        expect(count(arrivals, a)).toBeGreaterThanOrEqual(4)
        expect(count(arrivals, b)).toBeGreaterThanOrEqual(4)
        for (let k = 1; k < arrivals.length; k++) expect(arrivals[k]).not.toBe(arrivals[k - 1])
    })

    devIt('crosses a busy line over and over in 10000 ticks without ever sharing the crossing with a train', () => {
        const w = world()
        const map = w.map
        for (let x = 6; x <= 40; x++) buildRail(map, 0, map.idx(x, 10), RtTrack.x, true)
        road(w, [20, 5], [20, 15])
        const crossing = map.idx(20, 10)
        const top = stop(w, 20, 6)
        const bottom = stop(w, 20, 14)
        buildDepot(map, 0, map.idx(5, 10), RtVehicleKind.rail, 2, true)
        const train = w.vehicle((buyVehicle(w, 0, map.idx(5, 10), ENGINE, [], true) as { vehicle: number }).vehicle)!
        train.stopped = false
        const v = bus(w, [20, 4], 1 as RtDir, [visit(top), visit(bottom)])
        let crossings = 0
        let inside = false
        let clash = false
        run(w, 10000, undefined, () => {
            const now = v.tiles.includes(crossing)
            if (now && !inside) crossings++
            inside = now
            if (now && w.occupied.trainOnPiece(crossing, RtTrack.x)) clash = true
        })
        expect(crossings).toBeGreaterThanOrEqual(4)
        expect(clash).toBe(false)
        expect(v.state).not.toBe(RtVehicleState.crashed)
        expect(train.state).not.toBe(RtVehicleState.crashed)
    })

    it('reaching a crossing as a train approaches on an unsignalled line, waits there and survives', () => {
        const w = world()
        const map = w.map
        for (let x = 6; x <= 40; x++) buildRail(map, 0, map.idx(x, 10), RtTrack.x, true)
        road(w, [20, 5], [20, 15])
        const crossing = map.idx(20, 10)
        buildDepot(map, 0, map.idx(5, 10), RtVehicleKind.rail, 2, true)
        const train = w.vehicle((buyVehicle(w, 0, map.idx(5, 10), ENGINE, [], true) as { vehicle: number }).vehicle)!
        train.stopped = false
        // the train comes up to the crossing and breaks down with its head next to it, facing in
        run(w, 3000, undefined, () => train.tiles[0] === map.idx(19, 10))
        expect(train.tiles[0]).toBe(map.idx(19, 10))
        train.breakdownTicks = 400
        expect(rtCrossingBarred(w, crossing)).toBe(true)
        const bottom = stop(w, 20, 14)
        const v = bus(w, [20, 4], 1 as RtDir, [visit(bottom)])
        let waitedAtBarrier = false
        let onWithTrain = false
        let crossedAfter = false
        let trainFarthest = 0
        run(w, 2000, undefined, () => {
            trainFarthest = Math.max(trainFarthest, train.tiles[0]! % 64)
            if (map.neighbour(v.tiles[0]!, v.pieces[0]! as RtDir) === crossing && v.speed === 0 && rtCrossingBarred(w, crossing)) waitedAtBarrier = true
            if (v.tiles.includes(crossing) && w.occupied.trainOnPiece(crossing, RtTrack.x)) onWithTrain = true
            if (waitedAtBarrier && v.tiles[0]! >= map.idx(20, 11)) crossedAfter = true
        })
        expect(waitedAtBarrier).toBe(true)
        expect(onWithTrain).toBe(false)
        expect(crossedAfter).toBe(true)
        expect(v.state).not.toBe(RtVehicleState.crashed)
        // the train went over the crossing
        expect(trainFarthest).toBeGreaterThan(20)
    })

    it('a bus stopped by its owner blocks the bus behind for exactly roadBlockedTicks, which then drives through and serves its stops', () => {
        const w = world()
        const map = w.map
        townRoads(w)
        const market = stop(w, 30, 10)
        const church = stop(w, 20, 6)
        const blocker = bus(w, [5, 10], 2 as RtDir)
        run(w, 400, undefined, () => blocker.tiles[0]! % 64 >= 12)
        blocker.stopped = true
        run(w, 5)
        const where = [...blocker.tiles]
        const follower = bus(w, [5, 10], 2 as RtDir, [visit(market), visit(church)])
        let firstBlocked = -1
        let movedAgain = -1
        let position = ''
        let counterWhenReleased = -1
        let previousCounter = 0
        const arrivals: number[] = []
        run(w, 6000, { arrive: (_w, car, s) => { if (car === follower) arrivals.push(s) } }, tick => {
            const now = `${follower.tiles.join(',')}:${follower.progress}`
            if (firstBlocked < 0 && follower.blockedTicks === 1) {
                firstBlocked = tick
                position = now
            } else if (firstBlocked >= 0 && movedAgain < 0 && now !== position) {
                movedAgain = tick
                counterWhenReleased = previousCounter
            }
            previousCounter = follower.blockedTicks
        })
        expect(firstBlocked).toBeGreaterThan(0)
        // the counter runs roadBlockedTicks ticks; past it the bus is released and pulls away from a
        // standstill, which costs one tick at road acceleration (half a km/h per tick rounds to 0)
        expect(movedAgain - firstBlocked).toBe(BLOCKED + 1)
        expect(counterWhenReleased).toBeGreaterThan(BLOCKED)
        expect(blocker.tiles).toEqual(where)
        expect(count(arrivals, market)).toBeGreaterThanOrEqual(1)
        expect(count(arrivals, church)).toBeGreaterThanOrEqual(1)
        expect(follower.state).not.toBe(RtVehicleState.crashed)
        expect(map.kind[blocker.tiles[0]!]).toBe(RtTileKind.road)
    })
})
