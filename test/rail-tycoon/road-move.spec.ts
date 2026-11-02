import { describe, expect, it } from 'vitest'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { buildDepot } from '#shared/utils/rail-tycoon/depots'
import { RtMap, RtTileKind, type RtDir } from '#shared/utils/rail-tycoon/map'
import { buildRoad } from '#shared/utils/rail-tycoon/road'
import { rtCrossingBarred, stepRoadVehicle } from '#shared/utils/rail-tycoon/road-vehicle'
import { RtStationTile, buildRoadStop } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_X, RT_ROAD_Y, RtTrack, buildRail } from '#shared/utils/rail-tycoon/track'
import { rtRemoveTrain, stepTrain, type RtTrainHooks } from '#shared/utils/rail-tycoon/train'
import { rtSetPieceReserved } from '#shared/utils/rail-tycoon/signals'
import { RtOrderKind, RtVehicleKind, RtVehicleState, type RtStation, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { buyVehicle } from '#shared/utils/rail-tycoon/vehicles'
import { RtWorld, rtStartDate } from '#shared/utils/rail-tycoon/world'

const BUS = RT_CATALOG.vehicles.models.townBus.index
const TILE = RT_CATALOG.movement.subTileUnits
const GAP = RT_CATALOG.movement.roadLaneGap

function flatWorld(): RtWorld {
    const world = new RtWorld({
        settings: { side: 64, maxCompanies: 8, sharing: false }, map: new RtMap(64), rngState: 777, tick: 0,
        date: rtStartDate(), pathfinderCursor: 0, companies: [], towns: [], industries: [], stations: [], vehicles: []
    })
    world.addCompany('Company 0')
    return world
}

function roadRow(map: RtMap, y: number, x0: number, x1: number): void {
    for (let x = x0; x <= x1; x++) {
        const built = buildRoad(map, 0, map.idx(x, y), RT_ROAD_X, true)
        if (!built.ok) throw new Error(`road failed at ${x},${y} (${built.error})`)
    }
}

function roadColumn(map: RtMap, x: number, y0: number, y1: number): void {
    for (let y = y0; y <= y1; y++) {
        const built = buildRoad(map, 0, map.idx(x, y), RT_ROAD_Y, true)
        if (!built.ok) throw new Error(`road failed at ${x},${y} (${built.error})`)
    }
}

function stop(world: RtWorld, tile: number): number {
    const built = buildRoadStop(world.map, world.stations as RtStation[], [], 0, tile, RtStationTile.bus, true)
    if (!built.ok) throw new Error(`stop failed (${built.error})`)
    return (built as { station: number }).station
}

/** A road depot at `depot` facing `facing` (built when missing), then a bus bought there and started. */
function bus(world: RtWorld, depot: number, facing: RtDir, orders: RtVehicle['orders'] = []): RtVehicle {
    if (world.map.kind[depot] !== RtTileKind.depot) {
        const built = buildDepot(world.map, 0, depot, RtVehicleKind.road, facing, true)
        if (!built.ok) throw new Error(`depot failed (${built.error})`)
    }
    const bought = buyVehicle(world, 0, depot, BUS, [], true)
    if (!bought.ok) throw new Error(`buy failed (${bought.error})`)
    const v = world.vehicle(bought.vehicle)!
    v.orders = orders
    v.stopped = false
    return v
}

/** Steps every vehicle in id order for `ticks` ticks, as RtWorld.step will. */
function run(world: RtWorld, ticks: number, hooks?: RtTrainHooks, each?: () => void): void {
    for (let t = 0; t < ticks; t++) {
        world.tick++
        world.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
        for (const v of world.vehicleList()) {
            const result = v.kind === RtVehicleKind.rail ? stepTrain(world, v, hooks) : stepRoadVehicle(world, v, hooks)
            if (result.remove) rtRemoveTrain(world, v)
        }
        each?.()
    }
}

/** Two road vehicles whose heads share a tile and lane are at least roadLaneGap apart. */
function lanesKeepTheirGap(world: RtWorld): boolean {
    const cars = world.vehicleList().filter(v => v.kind === RtVehicleKind.road && v.state !== RtVehicleState.inDepot)
    for (const a of cars) {
        for (const b of cars) {
            if (a.id >= b.id || a.tiles[0] !== b.tiles[0] || a.pieces[0] !== b.pieces[0]) continue
            if (Math.abs(a.progress - b.progress) < GAP) return false
        }
    }
    return true
}

describe('rail tycoon road vehicle movement', () => {
    it('shuttles between two drive-through stops on a dead-end road, both ways', () => {
        const world = flatWorld()
        const map = world.map
        roadRow(map, 10, 6, 30)
        const a = stop(world, map.idx(8, 10))
        const b = stop(world, map.idx(28, 10))
        const v = bus(world, map.idx(5, 10), 2 as RtDir, [
            { kind: RtOrderKind.gotoStation, target: a, flags: 0 },
            { kind: RtOrderKind.gotoStation, target: b, flags: 0 }
        ])
        const arrivals: number[] = []
        const lanes = new Set<number>()
        run(world, 8000, { arrive: (_w, _v, station) => arrivals.push(station) }, () => {
            if (v.state === RtVehicleState.loading) lanes.add(v.pieces[0]!)
        })
        expect(arrivals.filter(s => s === a).length).toBeGreaterThanOrEqual(3)
        expect(arrivals.filter(s => s === b).length).toBeGreaterThanOrEqual(3)
        for (let k = 1; k < arrivals.length; k++) expect(arrivals[k]).not.toBe(arrivals[k - 1])
        // it loads in both directions: it turns round after each stop
        expect(lanes.size).toBe(2)
        expect(v.lost).toBe(false)
    })

    it('keeps two buses in one lane apart, and both reach their stops', () => {
        const world = flatWorld()
        const map = world.map
        roadRow(map, 10, 6, 30)
        const a = stop(world, map.idx(12, 10))
        const b = stop(world, map.idx(26, 10))
        const orders = [
            { kind: RtOrderKind.gotoStation, target: a, flags: 0 },
            { kind: RtOrderKind.gotoStation, target: b, flags: 0 }
        ]
        const first = bus(world, map.idx(5, 10), 2 as RtDir, orders.map(o => ({ ...o })))
        const second = bus(world, map.idx(5, 10), 2 as RtDir, orders.map(o => ({ ...o })))
        const arrivals = new Map<number, number>()
        let apart = true
        run(world, 8000, { arrive: (_w, car) => arrivals.set(car.id, (arrivals.get(car.id) ?? 0) + 1) }, () => {
            if (!lanesKeepTheirGap(world)) apart = false
        })
        expect(apart).toBe(true)
        expect(arrivals.get(first.id) ?? 0).toBeGreaterThanOrEqual(3)
        expect(arrivals.get(second.id) ?? 0).toBeGreaterThanOrEqual(3)
    })

    it('waits before a level crossing while a train passes, and nothing crashes', () => {
        const world = flatWorld()
        const map = world.map
        for (let x = 6; x <= 40; x++) buildRail(map, 0, map.idx(x, 10), RtTrack.x, true)
        roadColumn(map, 20, 5, 15)
        const crossing = map.idx(20, 10)
        expect(map.kind[crossing]).toBe(RtTileKind.rail)
        const top = stop(world, map.idx(20, 6))
        const bottom = stop(world, map.idx(20, 14))
        buildDepot(map, 0, map.idx(5, 10), RtVehicleKind.rail, 2, true)
        const train = world.vehicle((buyVehicle(world, 0, map.idx(5, 10), 1, [], true) as { vehicle: number }).vehicle)!
        train.stopped = false
        const v = bus(world, map.idx(20, 4), 1 as RtDir, [
            { kind: RtOrderKind.gotoStation, target: top, flags: 0 },
            { kind: RtOrderKind.gotoStation, target: bottom, flags: 0 }
        ])
        let waited = 0
        let crashed = false
        let onCrossingWithTrain = false
        run(world, 12000, undefined, () => {
            if (world.vehicleList().some(car => car.state === RtVehicleState.crashed)) crashed = true
            if (rtCrossingBarred(world, crossing) && v.speed === 0 && v.progress === TILE && v.state === RtVehicleState.driving
                && map.neighbour(v.tiles[0]!, v.pieces[0]! as RtDir) === crossing) waited++
            if (world.occupied.trainOnPiece(crossing, RtTrack.x) && world.occupied.roadVehicleOnCrossing(crossing)) onCrossingWithTrain = true
        })
        expect(crashed).toBe(false)
        expect(onCrossingWithTrain).toBe(false)
        expect(waited).toBeGreaterThan(0)
    })

    it('tells a barred crossing apart: a train on it, reserved through it, or heading in from next door', () => {
        const world = flatWorld()
        const map = world.map
        for (let x = 6; x <= 40; x++) buildRail(map, 0, map.idx(x, 10), RtTrack.x, true)
        roadColumn(map, 20, 8, 12)
        const crossing = map.idx(20, 10)
        expect(rtCrossingBarred(world, crossing)).toBe(false)
        expect(rtCrossingBarred(world, map.idx(20, 9))).toBe(false)
        world.occupied.holdPiece(99, crossing, RtTrack.x)
        expect(rtCrossingBarred(world, crossing)).toBe(true)
        world.occupied.releasePiece(99, crossing, RtTrack.x)
        expect(rtCrossingBarred(world, crossing)).toBe(false)
        rtSetPieceReserved(map, crossing, RtTrack.x, true)
        expect(rtCrossingBarred(world, crossing)).toBe(true)
        rtSetPieceReserved(map, crossing, RtTrack.x, false)

        // a train runs at it from the west: open two tiles out, down with its head next door
        buildDepot(map, 0, map.idx(5, 10), RtVehicleKind.rail, 2, true)
        const train = world.vehicle((buyVehicle(world, 0, map.idx(5, 10), 1, [], true) as { vehicle: number }).vehicle)!
        train.stopped = false
        const barredAt = new Map<number, boolean>()
        run(world, 1500, undefined, () => {
            const x = train.tiles[0]! % 64
            if (train.state === RtVehicleState.driving && !barredAt.has(x)) barredAt.set(x, rtCrossingBarred(world, crossing))
        })
        expect(barredAt.get(18)).toBe(false)
        expect(barredAt.get(19)).toBe(true)
        expect(barredAt.get(20)).toBe(true)
    })

    it('runs a depot order: drives in, is serviced and leaves again', () => {
        const world = flatWorld()
        const map = world.map
        roadRow(map, 10, 6, 30)
        buildDepot(map, 0, map.idx(31, 10), RtVehicleKind.road, 0, true)
        const v = bus(world, map.idx(5, 10), 2 as RtDir, [
            { kind: RtOrderKind.gotoDepot, target: map.idx(31, 10), flags: 0 },
            { kind: RtOrderKind.gotoDepot, target: map.idx(5, 10), flags: 0 }
        ])
        v.reliability = 1000
        let visits = 0
        let inside = false
        run(world, 6000, undefined, () => {
            const now = v.state === RtVehicleState.inDepot && v.tiles[0] === map.idx(31, 10)
            if (now && !inside) visits++
            inside = now
        })
        expect(visits).toBeGreaterThanOrEqual(2)
        expect(v.reliability).toBeGreaterThan(1000)
        // inside a depot it holds no road lane
        if (v.state === RtVehicleState.inDepot) expect(world.occupied.roadVehicleOnCrossing(v.tiles[0]!)).toBe(false)
    })

    it('turns round at road ends without orders and never leaves the road', () => {
        const world = flatWorld()
        const map = world.map
        roadRow(map, 10, 6, 14)
        const v = bus(world, map.idx(5, 10), 2 as RtDir)
        const seen = new Set<number>()
        let offRoad = false
        run(world, 3000, undefined, () => {
            if (v.state === RtVehicleState.inDepot) return
            for (const tile of v.tiles) {
                if (map.kind[tile] !== RtTileKind.road && map.kind[tile] !== RtTileKind.depot) offRoad = true
            }
            seen.add(v.tiles[0]! % 64)
        })
        expect(offRoad).toBe(false)
        expect(seen.has(14)).toBe(true)
        expect(seen.has(6)).toBe(true)
    })

    it('is lost when no route exists either way, and still never leaves the road', () => {
        const world = flatWorld()
        const map = world.map
        roadRow(map, 10, 6, 14)
        roadRow(map, 20, 6, 14)
        const far = stop(world, map.idx(10, 20))
        const v = bus(world, map.idx(5, 10), 2 as RtDir, [{ kind: RtOrderKind.gotoStation, target: far, flags: 0 }])
        run(world, 500)
        expect(v.lost).toBe(true)
        expect(map.kind[v.tiles[0]!] === RtTileKind.road || map.kind[v.tiles[0]!] === RtTileKind.depot).toBe(true)
    })

    it('drives through a vehicle that has blocked it for roadBlockedTicks', () => {
        const world = flatWorld()
        const map = world.map
        roadRow(map, 10, 6, 30)
        const blocker = bus(world, map.idx(5, 10), 2 as RtDir)
        // a few tiles out, so the follower can leave the depot behind it
        run(world, 200)
        expect(blocker.tiles[0]! % 64).toBeGreaterThan(8)
        blocker.stopped = true
        run(world, 5)
        const where = blocker.tiles[0]!
        const follower = bus(world, map.idx(5, 10), 2 as RtDir)
        const limit = RT_CATALOG.vehicles.roadBlockedTicks
        run(world, limit / 2)
        expect(follower.blockedTicks).toBeGreaterThan(0)
        const heldAt = follower.tiles[0]!
        run(world, limit / 2 - 100)
        expect(follower.tiles[0]).toBe(heldAt)
        run(world, 400)
        expect(follower.blockedTicks === 0 || follower.tiles[0] !== heldAt).toBe(true)
        expect(blocker.tiles[0]).toBe(where)
        let passed = false
        run(world, 400, undefined, () => {
            if ((follower.tiles[0]! % 64) > (where % 64)) passed = true
        })
        expect(passed).toBe(true)
    })

    it('is deterministic: the same start gives the same state', () => {
        const snapshot = () => {
            const world = flatWorld()
            const map = world.map
            roadRow(map, 10, 6, 30)
            const a = stop(world, map.idx(9, 10))
            const b = stop(world, map.idx(27, 10))
            const orders = [
                { kind: RtOrderKind.gotoStation, target: a, flags: 0 },
                { kind: RtOrderKind.gotoStation, target: b, flags: 0 }
            ]
            bus(world, map.idx(5, 10), 2 as RtDir, orders.map(o => ({ ...o })))
            bus(world, map.idx(5, 10), 2 as RtDir, orders.map(o => ({ ...o })))
            run(world, 2500)
            return JSON.stringify(world.vehicleList().map(v => [v.tiles, v.pieces, v.progress, v.speed, v.state, v.blockedTicks, v.orderIndex]))
        }
        expect(snapshot()).toBe(snapshot())
    })

    it('ignores vehicles it cannot step, and counts a crash down to removal', () => {
        const world = flatWorld()
        const map = world.map
        roadRow(map, 10, 6, 30)
        const v = bus(world, map.idx(5, 10), 2 as RtDir)
        const train = { ...v, kind: RtVehicleKind.rail } as RtVehicle
        expect(stepRoadVehicle(world, train)).toEqual({ remove: false, searched: false })
        const broken = { ...v, tiles: [map.idx(6, 10)], pieces: [] } as RtVehicle
        expect(stepRoadVehicle(world, broken)).toEqual({ remove: false, searched: false })
        run(world, 50)
        v.state = RtVehicleState.crashed
        v.crashTicks = 2
        expect(stepRoadVehicle(world, v).remove).toBe(false)
        expect(stepRoadVehicle(world, v).remove).toBe(true)
    })
})
