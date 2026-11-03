import { describe, expect, it } from 'vitest'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { buildDepot } from '#shared/utils/rail-tycoon/depots'
import { RtMap, RtTileKind, type RtDir } from '#shared/utils/rail-tycoon/map'
import { buildSiding } from '#shared/utils/rail-tycoon/sidings'
import { RtSignalType, placeSignal, rtPieceReserved } from '#shared/utils/rail-tycoon/signals'
import { RtAxis, buildRailStation } from '#shared/utils/rail-tycoon/stations-build'
import { RtBuildError, buildRail, rtPieceBetween } from '#shared/utils/rail-tycoon/track'
import { stepTrain, rtRemoveTrain, type RtTrainHooks } from '#shared/utils/rail-tycoon/train'
import { RT_NONE, RtOrderKind, RtVehicleKind, RtVehicleState, type RtStation, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { RT_VEHICLE_MODELS, buyVehicle } from '#shared/utils/rail-tycoon/vehicles'
import { RtOccupiedRegistry, RtWorld, rtStartDate } from '#shared/utils/rail-tycoon/world'

type XY = [number, number]

function dirTo(a: XY, b: XY): RtDir {
    if (b[0] === a[0] - 1) return 0
    if (b[1] === a[1] + 1) return 1
    if (b[0] === a[0] + 1) return 2
    return 3
}

function lay(map: RtMap, owner: number, path: XY[]): void {
    for (let k = 0; k < path.length; k++) {
        const prev = k > 0 ? path[k - 1] : undefined
        const next = k < path.length - 1 ? path[k + 1] : undefined
        const here = path[k]!
        const a = prev ? dirTo(here, prev) : ((dirTo(here, next!) + 2) & 3) as RtDir
        const b = next ? dirTo(here, next) : ((a + 2) & 3) as RtDir
        const result = buildRail(map, owner, map.idx(here[0], here[1]), rtPieceBetween(a, b), true)
        if (!result.ok && result.error !== RtBuildError.alreadyBuilt) throw new Error(`lay failed at ${here} (${result.error})`)
    }
}

function row(y: number, x0: number, x1: number): XY[] {
    const out: XY[] = []
    if (x0 <= x1) for (let x = x0; x <= x1; x++) out.push([x, y])
    else for (let x = x0; x >= x1; x--) out.push([x, y])
    return out
}

function column(x: number, y0: number, y1: number): XY[] {
    const out: XY[] = []
    for (let y = y0; y <= y1; y++) out.push([x, y])
    return out
}

function flatWorld(sharing = false, companies = 1): RtWorld {
    const world = new RtWorld({
        settings: { side: 64, maxCompanies: 8, sharing }, map: new RtMap(64), rngState: 12345, tick: 0,
        date: rtStartDate(), pathfinderCursor: 0, companies: [], towns: [], industries: [], stations: [], vehicles: []
    })
    for (let c = 0; c < companies; c++) world.addCompany(`Company ${c}`)
    return world
}

/** A depot at `tile` facing `facing`, then a train bought there and started with `orders`. */
function train(world: RtWorld, owner: number, depot: number, facing: RtDir, orders: RtVehicle['orders'] = [], wagons: number[] = []): RtVehicle {
    if (world.map.kind[depot] !== RtTileKind.depot) {
        const built = buildDepot(world.map, owner, depot, RtVehicleKind.rail, facing, true)
        if (!built.ok) throw new Error(`depot failed (${built.error})`)
    }
    const bought = buyVehicle(world, owner, depot, 1, wagons, true)
    if (!bought.ok) throw new Error(`buy failed (${bought.error})`)
    const v = world.vehicle(bought.vehicle)!
    v.orders = orders
    v.stopped = false
    return v
}

/** Steps every train in id order for `ticks` ticks, as RtWorld.step will. */
function run(world: RtWorld, ticks: number, hooks?: RtTrainHooks, each?: () => void): void {
    for (let t = 0; t < ticks; t++) {
        world.tick++
        world.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
        for (const v of world.vehicleList()) {
            if (v.kind !== RtVehicleKind.rail) continue
            const result = stepTrain(world, v, hooks)
            if (result.remove) rtRemoveTrain(world, v)
        }
        each?.()
    }
}

/** Every train's tiles are distinct from every other train's (no two trains ever share a tile). */
function noSharedTiles(world: RtWorld): boolean {
    const seen = new Map<number, number>()
    for (const v of world.vehicleList()) {
        if (v.state === RtVehicleState.inDepot || v.state === RtVehicleState.crashed) continue
        for (const tile of v.tiles) {
            const other = seen.get(tile)
            if (other !== undefined && other !== v.id) return false
            seen.set(tile, v.id)
        }
    }
    return true
}

describe('rail tycoon train movement', () => {
    it('leaves its depot, runs to the end of the line, turns round and comes back', () => {
        const world = flatWorld()
        const map = world.map
        lay(map, 0, row(10, 6, 30))
        const v = train(world, 0, map.idx(5, 10), 2 as RtDir)
        let farthest = 0
        let returned = false
        run(world, 1500, undefined, () => {
            if (v.state === RtVehicleState.inDepot) return
            const x = v.tiles[0]! % 64
            farthest = Math.max(farthest, x)
            if (farthest === 30 && x < 15) returned = true
        })
        expect(farthest).toBe(30)
        expect(returned).toBe(true)
        expect(v.lost).toBe(false)
    })

    it('shuttles between two stations with orders, stopping at each', () => {
        const world = flatWorld()
        const map = world.map
        lay(map, 0, row(10, 6, 40))
        const stations = world.stations as RtStation[]
        const a = buildRailStation(map, stations, [], 0, map.idx(8, 10), RtAxis.x, 1, 3, true)
        const b = buildRailStation(map, stations, [], 0, map.idx(34, 10), RtAxis.x, 1, 3, true)
        expect(a.ok && b.ok).toBe(true)
        const ids = [(a as { station: number }).station, (b as { station: number }).station]
        const v = train(world, 0, map.idx(5, 10), 2 as RtDir, [
            { kind: RtOrderKind.gotoStation, target: ids[0]!, flags: 0 },
            { kind: RtOrderKind.gotoStation, target: ids[1]!, flags: 0 }
        ])
        const arrivals: number[] = []
        run(world, 10000, { arrive: (_w, _v, station) => arrivals.push(station) })
        expect(arrivals.filter(s => s === ids[0]).length).toBeGreaterThanOrEqual(3)
        expect(arrivals.filter(s => s === ids[1]).length).toBeGreaterThanOrEqual(3)
        for (let k = 1; k < arrivals.length; k++) expect(arrivals[k]).not.toBe(arrivals[k - 1])
        expect(v.lost).toBe(false)
    })

    it('drives every tile from its depot door on, starting at the beginning of the first', () => {
        const world = flatWorld()
        const map = world.map
        lay(map, 0, row(10, 6, 30))
        const v = train(world, 0, map.idx(5, 10), 2 as RtDir)
        const heads: number[] = []
        run(world, 400, undefined, () => {
            if (v.state === RtVehicleState.inDepot) return
            if (heads.length === 0) expect(v.progress).toBe(0)
            const x = v.tiles[0]! % 64
            if (heads[heads.length - 1] !== x) heads.push(x)
        })
        expect(heads.slice(0, 6)).toEqual([6, 7, 8, 9, 10, 11])
    })

    it('runs a depot order: drives in, is serviced and leaves for the next order', () => {
        const world = flatWorld()
        const map = world.map
        lay(map, 0, row(10, 6, 30))
        buildDepot(map, 0, map.idx(31, 10), RtVehicleKind.rail, 0, true)
        const v = train(world, 0, map.idx(5, 10), 2 as RtDir, [
            { kind: RtOrderKind.gotoDepot, target: map.idx(31, 10), flags: 0 },
            { kind: RtOrderKind.gotoDepot, target: map.idx(5, 10), flags: 0 }
        ])
        v.reliability = 1000
        let visited = false
        run(world, 3000, undefined, () => {
            if (v.state === RtVehicleState.inDepot && v.tiles[0] === map.idx(31, 10)) visited = true
        })
        expect(visited).toBe(true)
        expect(v.reliability).toBeGreaterThan(1000)
    })

    it('stops at a red block signal behind a standing train and never shares a tile with it', () => {
        const world = flatWorld()
        const map = world.map
        lay(map, 0, row(10, 6, 40))
        expect(placeSignal(map, 0, map.idx(20, 10), 0, RtSignalType.block, true).ok).toBe(true)
        const blocker = train(world, 0, map.idx(5, 10), 2 as RtDir)
        let safe = true
        run(world, 600, undefined, () => {
            if (blocker.tiles[0]! % 64 >= 30) blocker.stopped = true
        })
        const follower = train(world, 0, map.idx(5, 10), 2 as RtDir)
        run(world, 1500, undefined, () => {
            if (!noSharedTiles(world)) safe = false
        })
        expect(safe).toBe(true)
        expect(follower.state).not.toBe(RtVehicleState.crashed)
        expect(blocker.state).not.toBe(RtVehicleState.crashed)
    })

    it('crashes two of its own trains meeting on unsignalled track, then removes them', () => {
        const world = flatWorld()
        const map = world.map
        // a depot works as a block signal, so the two lines start apart and are joined while both trains run at the gap
        lay(map, 0, row(10, 6, 17))
        lay(map, 0, row(10, 19, 30))
        const east = train(world, 0, map.idx(5, 10), 2 as RtDir)
        const west = train(world, 0, map.idx(31, 10), 0 as RtDir)
        let crashed = false
        let joined = false
        run(world, 800, undefined, () => {
            if (!joined && east.state === RtVehicleState.driving && west.state === RtVehicleState.driving
                && east.tiles[0]! % 64 >= 13 && west.tiles[0]! % 64 <= 23) {
                lay(map, 0, row(10, 17, 19))
                joined = true
            }
            if (east.state === RtVehicleState.crashed && west.state === RtVehicleState.crashed) crashed = true
        })
        expect(joined).toBe(true)
        expect(crashed).toBe(true)
        run(world, RT_CATALOG.vehicles.crashTicks + 10)
        expect(world.vehicle(east.id)).toBeUndefined()
        expect(world.vehicle(west.id)).toBeUndefined()
        for (let x = 6; x <= 30; x++) expect(world.occupied.trainsOnPiece(map.idx(x, 10), 0)).toEqual([])
    })

    it('never crashes trains of different companies on shared track: they stop and one turns round', () => {
        const world = flatWorld(true, 2)
        const map = world.map
        lay(map, 0, row(10, 6, 18))
        lay(map, 1, row(10, 19, 30))
        const a = train(world, 0, map.idx(5, 10), 2 as RtDir)
        const b = train(world, 1, map.idx(31, 10), 0 as RtDir)
        let safe = true
        run(world, 6000, undefined, () => {
            if (!noSharedTiles(world)) safe = false
        })
        expect(safe).toBe(true)
        expect(a.state).not.toBe(RtVehicleState.crashed)
        expect(b.state).not.toBe(RtVehicleState.crashed)
    })

    it('sends a stopped train to a parking spot, where it parks', () => {
        const world = flatWorld()
        const map = world.map
        lay(map, 0, row(10, 6, 40))
        lay(map, 0, [[19, 10], [20, 10], ...column(20, 11, 14)])
        expect(buildSiding(map, 0, map.idx(20, 14), true).ok).toBe(true)
        const v = train(world, 0, map.idx(5, 10), 2 as RtDir)
        // stopped while moving, it cannot back up to its depot (also a parking place), so it takes the spot ahead
        let stoppedAt = -1
        run(world, 400, undefined, () => {
            if (stoppedAt < 0 && v.state === RtVehicleState.driving && v.speed > 0 && v.tiles[0]! % 64 >= 14) {
                v.stopped = true
                stoppedAt = v.tiles[0]! % 64
            }
        })
        expect(stoppedAt).toBeGreaterThanOrEqual(14)
        expect(stoppedAt).toBeLessThan(19)
        run(world, 1500)
        expect(v.state).toBe(RtVehicleState.parked)
        expect(v.tiles[0]).toBe(map.idx(20, 14))
        v.stopped = false
        run(world, 5)
        expect(v.state).toBe(RtVehicleState.driving)
    })

    it('keeps its piece holdings equal to a rebuild while a long train runs into its own tail on a loop', () => {
        const world = flatWorld()
        const map = world.map
        const ring: XY[] = [[10, 10], [11, 10], [12, 10], [12, 11], [12, 12], [11, 12], [10, 12], [10, 11]]
        for (let k = 0; k < ring.length; k++) {
            const here = ring[k]!
            const piece = rtPieceBetween(dirTo(here, ring[(k + ring.length - 1) % ring.length]!), dirTo(here, ring[(k + 1) % ring.length]!))
            expect(buildRail(map, 0, map.idx(here[0], here[1]), piece, true).ok).toBe(true)
        }
        // the depot joins the loop from the west, onto a curve that only leads round it
        expect(buildRail(map, 0, map.idx(10, 11), rtPieceBetween(0, 1), true).ok).toBe(true)
        const wagon = RT_VEHICLE_MODELS.findIndex(m => m.kind === 'rail' && m.cargo !== null)
        const v = train(world, 0, map.idx(9, 11), 2 as RtDir, [], Array<number>(13).fill(wagon))
        const trackdirPiece = (trackdir: number) => trackdir & 7
        // filling the whole ring, its head enters each tile in the step its tail gives that tile up
        let ringFull = 0
        let drifted = -1
        run(world, 6000, undefined, () => {
            if (new Set(v.tiles).size === ring.length) ringFull++
            const rescan = new RtOccupiedRegistry(map.tileCount)
            rescan.rebuild(world.vehicles, trackdirPiece)
            if (drifted < 0 && !rescan.equals(world.occupied)) drifted = world.tick
        })
        expect(v.state).toBe(RtVehicleState.driving)
        expect(ringFull).toBeGreaterThan(1000)
        expect(drifted).toBe(-1)
        for (let k = 0; k < v.tiles.length; k++) expect(rtPieceReserved(map, v.tiles[k]!, v.pieces[k]! & 7)).toBe(true)
    })

    it('gives identical worlds identical trains', () => {
        const build = () => {
            const world = flatWorld()
            const map = world.map
            lay(map, 0, row(10, 6, 30))
            lay(map, 0, [[19, 10], [20, 10], ...column(20, 11, 14)])
            train(world, 0, map.idx(5, 10), 2 as RtDir)
            train(world, 0, map.idx(31, 10), 0 as RtDir)
            return world
        }
        const one = build()
        const two = build()
        run(one, 2000)
        run(two, 2000)
        expect(one.hash()).toBe(two.hash())
    })

    it('ignores garbage vehicles without throwing', () => {
        const world = flatWorld()
        const broken = {
            id: 7, owner: 0, kind: RtVehicleKind.rail, model: 1, consist: [1], wagonCount: 0, tiles: [5], pieces: [], direction: 0,
            progress: 0, speed: 0, subspeed: 0, route: [], routeIndex: 0, routeTick: RT_NONE, reservedEnd: 0, orders: [], orderIndex: 0,
            state: RtVehicleState.driving, stopped: false, loadTicks: 0, loadingStation: RT_NONE, cargo: [], reliability: 1, breakdownChance: 0,
            breakdownTicks: 0, breakdownsSinceService: 0, lastServiceTick: RT_NONE, serviceDepot: RT_NONE, haltInDepot: false, runningTicks: 0, lost: false,
            lostRetryTick: RT_NONE, blockedTicks: 0, waitTicks: 0, crashTicks: 0, age: 0, value: 0, profitThisYear: 0, profitLastYear: 0
        } satisfies RtVehicle
        expect(stepTrain(world, broken)).toEqual({ remove: false, searched: false })
        expect(stepTrain(world, { ...broken, pieces: [99] }).remove).toBe(false)
    })
})
