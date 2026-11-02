/**
 * Bay road stops (Q29a, 2026-11-02): the original's normal bus and lorry stops beside the drive-through
 * ones. Building every shape and its refusals, a bus serving a bay (in, load, turn, out), two bays
 * full with a third bus waiting outside, twin worlds staying hash-equal, saves of bays, a save from
 * before bays, and the command byte that carries the shape.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RtCommandError, RtCommandKind, applyCommand, decodeCommand, encodeCommand, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import { demolishTile } from '#shared/utils/rail-tycoon/demolish'
import { buildDepot } from '#shared/utils/rail-tycoon/depots'
import { RT_ROAD_DIR_BIT, RtDir, RtMap, RtTileKind, rtReverseDir } from '#shared/utils/rail-tycoon/map'
import { findRoadRoute, RtRouteOutcome } from '#shared/utils/rail-tycoon/pathfinder'
import { decodeClientMsg, encodeClientMsg } from '#shared/utils/rail-tycoon/protocol'
import { buildRoad, rtRoadBits } from '#shared/utils/rail-tycoon/road'
import { RT_BAY_STOP, stepRoadVehicle } from '#shared/utils/rail-tycoon/road-vehicle'
import { decodeWorld, encodeWorld } from '#shared/utils/rail-tycoon/save'
import {
    RtAxis,
    RtRoadStopShape,
    RtStationTile,
    buildRoadStop,
    rtBayLane,
    rtBayPayload,
    rtBaySlot,
    rtRoadStopBits,
    rtRoadStopFacing,
    rtRoadStopIsBay,
    rtRoadStopRoadOwner,
    rtStationAxis,
    rtStationId,
    rtStationPayload,
    rtStationTileType
} from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_X, RT_ROAD_Y, RtBuildError } from '#shared/utils/rail-tycoon/track'
import type { RtTrainHooks } from '#shared/utils/rail-tycoon/train'
import { RT_OWNER_NONE, RtOrderKind, RtVehicleKind, RtVehicleState, type RtStation, type RtTown, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { buyVehicle } from '#shared/utils/rail-tycoon/vehicles'
import { RtWorld, rtNewCompany, rtStartDate } from '#shared/utils/rail-tycoon/world'

const C = RT_CATALOG.construction
const TILE = RT_CATALOG.movement.subTileUnits
const BUS = RT_CATALOG.vehicles.models.townBus.index
const K = RtCommandKind
const ME = 0
const RIVAL = 1
const BAYS = [RtRoadStopShape.bayNe, RtRoadStopShape.baySe, RtRoadStopShape.baySw, RtRoadStopShape.bayNw] as const

function town(map: RtMap): RtTown {
    return {
        id: 0, name: 'Baybury', centre: map.idx(20, 10), houseCount: 0, population: 0, growthCounter: 0, growthRate: 0,
        growing: false, activeStations: 0, receivedThisMonth: RT_CARGO_IDS.map(() => 0), receivedLastMonth: RT_CARGO_IDS.map(() => 0)
    }
}

function world(): RtWorld {
    const map = new RtMap(64)
    const w = new RtWorld({
        settings: { side: 64, maxCompanies: 8, sharing: false }, map, rngState: 5, tick: 0, date: rtStartDate(),
        pathfinderCursor: 0, companies: [rtNewCompany(ME, 'Bays', 0, 0), rtNewCompany(RIVAL, 'Rival', 1, 0)],
        towns: [town(map)], industries: [], stations: [], vehicles: []
    })
    for (const company of w.companyList()) company.money = 50_000_000
    return w
}

function must(w: RtWorld, command: RtCommand, company = ME) {
    const result = applyCommand(w, company, command, true)
    if (!result.ok) throw new Error(`command ${JSON.stringify(command)} refused (${result.error})`)
    return result
}

/** A straight road from one tile to another, along a row or a column. */
function road(w: RtWorld, x0: number, y0: number, x1: number, y1: number): void {
    must(w, { kind: K.buildRoadLine, tile: w.map.idx(x0, y0), endTile: w.map.idx(x1, y1) })
}

function stations(w: RtWorld): RtStation[] {
    return w.stations as RtStation[]
}

const visit = (target: number) => ({ kind: RtOrderKind.gotoStation, target, flags: 0 })

/** A bus bought in the road depot at (x, y) facing `facing`, with orders, started. */
function bus(w: RtWorld, x: number, y: number, facing: RtDir, orders: RtVehicle['orders']): RtVehicle {
    const tile = w.map.idx(x, y)
    if (w.map.kind[tile] !== RtTileKind.depot) {
        const built = buildDepot(w.map, ME, tile, RtVehicleKind.road, facing, true)
        if (!built.ok) throw new Error(`depot refused (${built.error})`)
        buildRoad(w.map, ME, w.map.neighbour(tile, facing), RT_ROAD_DIR_BIT[rtReverseDir(facing)]!, true)
    }
    const bought = buyVehicle(w, ME, tile, BUS, [], true)
    if (!bought.ok) throw new Error(`buy refused (${bought.error})`)
    const v = w.vehicle(bought.vehicle)!
    v.orders = orders.map(o => ({ ...o }))
    v.stopped = false
    return v
}

/** Steps only the vehicles, with loading hooks that hold a vehicle `loadTicks` ticks at each stop. */
function run(w: RtWorld, ticks: number, loadTicks: number, each?: (tick: number) => boolean | undefined, arrivals?: number[]): void {
    const loading = new Map<number, number>()
    const hooks: RtTrainHooks = {
        arrive: (_w, v, station) => {
            arrivals?.push(station)
            loading.set(v.id, loadTicks)
        },
        loadStep: (_w, v) => {
            const left = (loading.get(v.id) ?? 0) - 1
            loading.set(v.id, left)
            return left <= 0
        }
    }
    for (let t = 0; t < ticks; t++) {
        w.tick++
        w.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
        for (const v of w.vehicleList()) stepRoadVehicle(w, v, hooks)
        if (each?.(t)) return
    }
}

/** No two road vehicles stand in one bay, and nothing but a bay lane is held on a bay tile. */
function baysSound(w: RtWorld, bay: number, facing: RtDir): boolean {
    const held = [0, 1, 2, 3].map(lane => w.occupied.roadVehiclesInLane(bay, lane).length)
    return held[facing] === 0 && held[rtReverseDir(facing)] === 0 && held[rtBayLane(facing, 0)]! <= 1 && held[rtBayLane(facing, 1)]! <= 1
}

describe('bay road stops: building (Q29a)', () => {
    it('builds a bay of every facing on clear land: its payload, cost and road stub', () => {
        for (const shape of BAYS) {
            const w = world()
            const facing = (shape - RtRoadStopShape.bayNe) as RtDir
            const tile = w.map.idx(30, 30)
            const result = buildRoadStop(w.map, stations(w), w.townList(), ME, tile, RtStationTile.truck, true, undefined, shape)
            expect(result).toEqual({ ok: true, cost: C.roadStop, station: 0 })
            const payload = w.map.payload[tile]!
            expect(w.map.kind[tile]).toBe(RtTileKind.station)
            expect(rtRoadStopIsBay(payload)).toBe(true)
            expect(rtRoadStopFacing(payload)).toBe(facing)
            expect(rtStationTileType(payload)).toBe(RtStationTile.truck)
            expect(rtStationAxis(payload)).toBe((facing & 1) === 0 ? RtAxis.x : RtAxis.y)
            expect(rtRoadStopRoadOwner(payload)).toBe(ME)
            expect(rtRoadStopBits(payload)).toBe(RT_ROAD_DIR_BIT[facing])
            expect(rtStationId(payload)).toBe(0)
            expect(payload).toBe(rtBayPayload(0, RtStationTile.truck, facing, ME))
        }
    })

    it('joins the road outside its entrance only, at road cost, and a vehicle can then drive in', () => {
        const w = world()
        road(w, 20, 20, 30, 20)
        const bay = w.map.idx(25, 19)
        // the bay faces south-east (+y), onto the road; the road gains its north-west half there
        const outside = w.map.idx(25, 20)
        expect(rtRoadBits(w.map.payload[outside]!)).toBe(RT_ROAD_X)
        const r = must(w, { kind: K.buildRoadStop, tile: bay, stop: RtStationTile.bus, shape: RtRoadStopShape.baySe })
        expect(r.cost).toBe(C.roadStop + C.road)
        expect(rtRoadBits(w.map.payload[outside]!)).toBe(RT_ROAD_X | RT_ROAD_DIR_BIT[RtDir.nw]!)
        // the tiles beside it and behind it are untouched
        for (const dir of [RtDir.ne, RtDir.sw, RtDir.nw]) expect(w.map.kind[w.map.neighbour(bay, dir)]).toBe(RtTileKind.clear)
        // a rival's road outside is left alone
        const rivalRoad = w.map.idx(35, 40)
        expect(buildRoad(w.map, RIVAL, rivalRoad, RT_ROAD_X, true).ok).toBe(true)
        const r2 = must(w, { kind: K.buildRoadStop, tile: w.map.idx(35, 39), stop: RtStationTile.bus, shape: RtRoadStopShape.baySe })
        expect(r2.cost).toBe(C.roadStop)
        expect(rtRoadBits(w.map.payload[rivalRoad]!)).toBe(RT_ROAD_X)
    })

    it('refuses a bay on road, rail, water, a slope, another company\'s station, off the edge, or over a vehicle', () => {
        const w = world()
        const map = w.map
        const sl = stations(w)
        const bay = (tile: number, shape: number = RtRoadStopShape.bayNe, owner = ME, occupied?: (t: number) => boolean) =>
            buildRoadStop(map, sl, w.townList(), owner, tile, RtStationTile.bus, false, occupied, shape)
        road(w, 10, 10, 14, 10)
        expect(bay(map.idx(12, 10))).toEqual({ ok: false, error: RtBuildError.occupied })
        map.setTile(map.idx(5, 5), RtTileKind.water, RT_OWNER_NONE, 0)
        expect(bay(map.idx(5, 5))).toEqual({ ok: false, error: RtBuildError.water })
        map.setCornerHeight(41, 41, 1)
        expect(bay(map.idx(40, 40))).toEqual({ ok: false, error: RtBuildError.badSlope })
        // facing north-east (-x) from x = 0 has no tile in front
        expect(bay(map.idx(0, 30), RtRoadStopShape.bayNe)).toEqual({ ok: false, error: RtBuildError.edge })
        expect(bay(map.idx(63, 30), RtRoadStopShape.baySw)).toEqual({ ok: false, error: RtBuildError.edge })
        must(w, { kind: K.buildRoadStop, tile: map.idx(30, 50), stop: RtStationTile.bus, shape: RtRoadStopShape.bayNw }, RIVAL)
        expect(bay(map.idx(30, 50))).toEqual({ ok: false, error: RtBuildError.notOwner })
        expect(bay(map.idx(30, 50), RtRoadStopShape.bayNe, RIVAL)).toEqual({ ok: false, error: RtBuildError.occupied })
        expect(bay(map.idx(20, 30), RtRoadStopShape.bayNe, ME, () => true)).toEqual({ ok: false, error: RtBuildError.conflict })
        for (const shape of [7, -1, 1.5, Number.NaN, 255]) expect(bay(map.idx(20, 30), shape)).toEqual({ ok: false, error: RtBuildError.invalid })
    })

    it('a drive-through stop of an axis runs along the road there, refuses one across it, and lays its own road on clear land', () => {
        const w = world()
        const map = w.map
        road(w, 10, 10, 14, 10)
        road(w, 30, 10, 30, 14)
        const drive = (tile: number, shape: number, apply = true) =>
            buildRoadStop(map, stations(w), w.townList(), ME, tile, RtStationTile.bus, apply, undefined, shape)
        expect(drive(map.idx(30, 12), RtRoadStopShape.driveX)).toEqual({ ok: false, error: RtBuildError.wrongDirection })
        expect(drive(map.idx(12, 10), RtRoadStopShape.driveY)).toEqual({ ok: false, error: RtBuildError.wrongDirection })
        // along the road: the same tile as the shape-less stop would build
        expect(drive(map.idx(12, 10), RtRoadStopShape.driveX)).toEqual({ ok: true, cost: C.roadStop, station: 0 })
        expect(map.payload[map.idx(12, 10)]).toBe(rtStationPayload(0, RtStationTile.bus, RtAxis.x, ME))
        // a half road the other way is refused; one the same way is completed, as before
        expect(buildRoad(map, ME, map.idx(40, 40), RT_ROAD_DIR_BIT[RtDir.se]!, true).ok).toBe(true)
        expect(drive(map.idx(40, 40), RtRoadStopShape.driveX)).toEqual({ ok: false, error: RtBuildError.wrongDirection })
        expect(drive(map.idx(40, 40), RtRoadStopShape.driveY)).toMatchObject({ ok: true, cost: C.roadStop + C.road })
        // a junction stays refused
        expect(buildRoad(map, ME, map.idx(14, 10), RT_ROAD_Y, true).ok).toBe(true)
        expect(drive(map.idx(14, 10), RtRoadStopShape.driveX)).toEqual({ ok: false, error: RtBuildError.conflict })
        // on clear land: its own straight road, joined to the road at its ends (here only the north-east one has road)
        const fresh = map.idx(31, 12)
        const r = drive(fresh, RtRoadStopShape.driveX)
        expect(r).toMatchObject({ ok: true, cost: C.roadStop + 2 * C.road + C.road })
        expect(rtRoadStopBits(map.payload[fresh]!)).toBe(RT_ROAD_X)
        expect(rtRoadStopRoadOwner(map.payload[fresh]!)).toBe(ME)
        expect(rtRoadBits(map.payload[map.idx(30, 12)]!)).toBe(RT_ROAD_Y | RT_ROAD_DIR_BIT[RtDir.sw]!)
        expect(map.kind[map.idx(32, 12)]).toBe(RtTileKind.clear)
        // a shape-less stop still needs road to follow
        expect(drive(map.idx(50, 50), RtRoadStopShape.auto, false)).toEqual({ ok: false, error: RtBuildError.conflict })
    })

    it('the tool preview (apply false) says why, and changes nothing', () => {
        const w = world()
        road(w, 30, 10, 30, 14)
        const before = w.hash()
        expect(applyCommand(w, ME, { kind: K.buildRoadStop, tile: w.map.idx(30, 12), stop: RtStationTile.bus, shape: RtRoadStopShape.driveX }, false))
            .toEqual({ ok: false, error: RtCommandError.wrongDirection })
        expect(applyCommand(w, ME, { kind: K.buildRoadStop, tile: w.map.idx(30, 12), stop: RtStationTile.bus, shape: RtRoadStopShape.bayNe }, false))
            .toEqual({ ok: false, error: RtCommandError.occupied })
        expect(applyCommand(w, ME, { kind: K.buildRoadStop, tile: w.map.idx(31, 12), stop: RtStationTile.bus, shape: RtRoadStopShape.bayNe }, false))
            .toEqual({ ok: true, cost: C.roadStop + C.road, id: 0 })
        expect(w.hash()).toBe(before)
        expect(w.map.kind[w.map.idx(31, 12)]).toBe(RtTileKind.clear)
    })

    it('demolishing a bay leaves clear land; a drive-through stop on its own road leaves the road', () => {
        const w = world()
        const map = w.map
        const bay = map.idx(20, 20)
        const drive = map.idx(30, 20)
        must(w, { kind: K.buildRoadStop, tile: bay, stop: RtStationTile.bus, shape: RtRoadStopShape.baySw })
        must(w, { kind: K.buildRoadStop, tile: drive, stop: RtStationTile.bus, shape: RtRoadStopShape.driveX })
        expect(demolishTile(map, stations(w), ME, bay, () => false, true)).toEqual({ ok: true, cost: C.removeRoadStop })
        expect(map.kind[bay]).toBe(RtTileKind.clear)
        expect(demolishTile(map, stations(w), ME, drive, () => false, true)).toEqual({ ok: true, cost: C.removeRoadStop })
        expect(map.kind[drive]).toBe(RtTileKind.road)
        expect(map.owner[drive]).toBe(ME)
        expect(rtRoadBits(map.payload[drive]!)).toBe(RT_ROAD_X)
    })
})

describe('bay road stops: road vehicles (Q29a)', () => {
    /**
     * A street along y = 20 (x 10 to 40), a depot at its west end, a bay at (25, 19) whose entrance
     * faces south-east onto the street, and a drive-through stop at (38, 20).
     */
    function street(): { w: RtWorld, bay: number, outside: number, bayStation: number, far: number } {
        const w = world()
        road(w, 10, 20, 40, 20)
        const bay = w.map.idx(25, 19)
        const bayStation = must(w, { kind: K.buildRoadStop, tile: bay, stop: RtStationTile.bus, shape: RtRoadStopShape.baySe }).id!
        const far = must(w, { kind: K.buildRoadStop, tile: w.map.idx(38, 20), stop: RtStationTile.bus, shape: RtRoadStopShape.driveX }).id!
        return { w, bay, outside: w.map.idx(25, 20), bayStation, far }
    }

    it('the pathfinder enters a bay only through its entrance, only as the goal, and leaves one by its entrance', () => {
        const { w, bay, outside } = street()
        const map = w.map
        // a goal: the route ends entering the bay from the street (north-west, -y)
        const toBay = findRoadRoute(map, map.idx(12, 20), RtDir.sw, { tiles: [bay] }, 10000, 10000)
        expect(toBay.outcome).toBe(RtRouteOutcome.found)
        expect(toBay.goal).toBe(bay)
        expect(toBay.route[toBay.route.length - 2]).toBe(RtDir.nw)
        // no goal: never a way through, even when it is the only way round
        road(w, 25, 15, 25, 18)
        const through = findRoadRoute(map, map.idx(12, 20), RtDir.sw, { tiles: [map.idx(25, 15)] }, 10000, 10000)
        expect(through.outcome).toBe(RtRouteOutcome.notFound)
        // nor a place to turn: heading past the bay with the target behind, it turns where it stands
        const turn = findRoadRoute(map, map.idx(24, 20), RtDir.sw, { tiles: [map.idx(20, 20)] }, 10000, 10000)
        expect(turn.outcome).toBe(RtRouteOutcome.found)
        expect(turn.turnAround).toBe(true)
        expect(turn.route).toEqual([RtDir.ne, RtDir.ne, RtDir.ne, RtDir.ne])
        // the road above the bay does not reach into it from behind either
        const behind = findRoadRoute(map, map.idx(25, 15), RtDir.se, { tiles: [bay] }, 10000, 10000)
        expect(behind.outcome).toBe(RtRouteOutcome.notFound)
        // from inside, in either bay's lane, it leaves by the entrance without turning
        for (const slot of [0, 1]) {
            const out = findRoadRoute(map, bay, rtBayLane(RtDir.se, slot), { tiles: [map.idx(38, 20)] }, 10000, 10000)
            expect(out.outcome).toBe(RtRouteOutcome.found)
            expect(out.turnAround).toBe(false)
            expect(map.neighbour(bay, RtDir.se)).toBe(outside)
        }
    })

    it('a bus drives into the bay from its entrance, halts at the far end to load, turns and leaves the way it came', () => {
        const { w, bay, outside, bayStation, far } = street()
        const v = bus(w, 10, 21, RtDir.nw, [visit(bayStation), visit(far)])
        const arrivals: number[] = []
        const trace: { tile: number, lane: number, progress: number, state: number }[] = []
        run(w, 6000, 40, () => {
            trace.push({ tile: v.tiles[0]!, lane: v.pieces[0]!, progress: v.progress, state: v.state })
            expect(baysSound(w, bay, RtDir.se)).toBe(true)
        }, arrivals)
        expect(arrivals.filter(s => s === bayStation).length).toBeGreaterThanOrEqual(3)
        expect(arrivals.filter(s => s === far).length).toBeGreaterThanOrEqual(3)
        for (let k = 1; k < arrivals.length; k++) expect(arrivals[k]).not.toBe(arrivals[k - 1])
        // every visit: entered from the tile outside, in a bay's lane, progress rising to the halt
        let visits = 0
        for (let k = 1; k < trace.length; k++) {
            const [prev, now] = [trace[k - 1]!, trace[k]!]
            if (now.tile === bay && prev.tile !== bay) {
                visits++
                expect(prev.tile).toBe(outside)
                expect(rtBaySlot(RtDir.se, now.lane)).toBeGreaterThanOrEqual(0)
            }
            if (now.tile === bay && prev.tile === bay) {
                expect(now.lane).toBe(prev.lane)
                expect(now.progress).toBeGreaterThanOrEqual(prev.progress)
                if (now.state === RtVehicleState.loading) expect(now.progress).toBe(RT_BAY_STOP)
            }
            // out: from the bay back onto the tile outside, never anywhere else
            if (prev.tile === bay && now.tile !== bay) {
                expect(now.tile).toBe(outside)
                expect(prev.progress).toBeGreaterThan(RT_BAY_STOP)
            }
        }
        expect(visits).toBeGreaterThanOrEqual(3)
        // loading at the halt, then driving on past it in the same bay
        const loads = trace.filter(t => t.tile === bay && t.state === RtVehicleState.loading)
        expect(loads.length).toBeGreaterThan(0)
        expect(trace.some(t => t.tile === bay && t.state === RtVehicleState.driving && t.progress > RT_BAY_STOP)).toBe(true)
        expect(v.lost).toBe(false)
    })

    it('two buses fill both bays and a third waits on the road outside the entrance until one leaves', () => {
        const { w, bay, outside, bayStation, far } = street()
        const buses = [0, 1, 2].map(() => bus(w, 10, 21, RtDir.nw, [visit(bayStation), visit(far)]))
        let sawFull = false
        let sawWaiting = false
        run(w, 8000, 900, () => {
            expect(baysSound(w, bay, RtDir.se)).toBe(true)
            const inBay = buses.filter(b => b.tiles[0] === bay)
            expect(inBay.length).toBeLessThanOrEqual(2)
            const loadingInBay = inBay.filter(b => b.state === RtVehicleState.loading)
            if (loadingInBay.length === 2) {
                sawFull = true
                expect(new Set(loadingInBay.map(b => b.pieces[0])).size).toBe(2)
                const waiting = buses.find(b => !inBay.includes(b) && b.tiles[0] === outside && b.progress === TILE)
                if (waiting) {
                    sawWaiting = true
                    expect(waiting.state).toBe(RtVehicleState.driving)
                    expect(waiting.speed).toBe(0)
                    // in the lane into the bay, leaving the other lane of the street free
                    expect(waiting.pieces[0]).toBe(RtDir.nw)
                    expect(waiting.tiles.length).toBe(1)
                }
            }
            return sawWaiting
        })
        expect(sawFull).toBe(true)
        expect(sawWaiting).toBe(true)
        for (const b of buses) expect(b.lost).toBe(false)
    })

    it('every bus gets its turn: the waiting bus enters a bay as soon as one is free', () => {
        const { w, bay, bayStation, far } = street()
        const buses = [0, 1, 2].map(() => bus(w, 10, 21, RtDir.nw, [visit(bayStation), visit(far)]))
        const served = new Set<number>()
        run(w, 8000, 900, () => {
            for (const b of buses) if (b.tiles[0] === bay && b.state === RtVehicleState.loading) served.add(b.id)
            return served.size === 3
        })
        expect(served.size).toBe(3)
    })
})

describe('bay road stops: determinism and saves (Q29a)', () => {
    /** A world built only by commands: a street, a bay, a drive-through stop and three buses. */
    function commandWorld(): RtWorld {
        const w = world()
        road(w, 10, 20, 40, 20)
        const bay = must(w, { kind: K.buildRoadStop, tile: w.map.idx(25, 21), stop: RtStationTile.bus, shape: RtRoadStopShape.bayNw }).id!
        const far = must(w, { kind: K.buildRoadStop, tile: w.map.idx(38, 20), stop: RtStationTile.bus, shape: RtRoadStopShape.driveX }).id!
        const near = must(w, { kind: K.buildRoadStop, tile: w.map.idx(12, 19), stop: RtStationTile.bus, shape: RtRoadStopShape.baySe }).id!
        must(w, { kind: K.buildDepot, tile: w.map.idx(10, 21), vehicleKind: RtVehicleKind.road, facing: RtDir.nw })
        must(w, { kind: K.buildRoad, tile: w.map.idx(10, 20), bits: RT_ROAD_DIR_BIT[RtDir.se]! })
        for (const orders of [[visit(bay), visit(far)], [visit(near), visit(bay)], [visit(bay), visit(near), visit(far)]]) {
            const id = must(w, { kind: K.buyVehicle, depot: w.map.idx(10, 21), model: BUS, wagons: [] }).id!
            must(w, { kind: K.setOrders, vehicle: id, orders })
            must(w, { kind: K.startStop, vehicle: id, stopped: false })
        }
        return w
    }

    it('twin worlds stay hash-equal tick by tick while buses fill and leave bays, and a save taken with buses in a bay carries on the same', () => {
        const a = commandWorld()
        const b = decodeWorld(encodeWorld(a))!
        expect(b.hash()).toBe(a.hash())
        let copy: RtWorld | null = null
        let inBayAtSave = 0
        for (let t = 0; t < 12000; t++) {
            a.step()
            b.step()
            copy?.step()
            if (t % 50 === 0) {
                expect(b.hash()).toBe(a.hash())
                if (copy) expect(copy.hash()).toBe(a.hash())
            }
            const inBay = a.vehicleList().filter(v => rtRoadStopIsBay(a.map.payload[v.tiles[0]!]!) && a.map.kind[v.tiles[0]!] === RtTileKind.station).length
            if (!copy && inBay >= 2) {
                inBayAtSave = inBay
                copy = decodeWorld(encodeWorld(a))!
                expect(copy.occupied.equals(a.occupied)).toBe(true)
            }
        }
        expect(inBayAtSave).toBeGreaterThanOrEqual(2)
        expect(copy!.hash()).toBe(a.hash())
        expect(b.hash()).toBe(a.hash())
        // the buses really worked the bays
        expect(a.vehicleList().every(v => v.profitThisYear !== 0 || v.profitLastYear !== 0)).toBe(true)
    })

    it('a bay round-trips through a save byte for byte and hash for hash', () => {
        const w = commandWorld()
        for (let t = 0; t < 1500; t++) w.step()
        const bytes = encodeWorld(w)
        const back = decodeWorld(bytes)!
        expect(back).not.toBeNull()
        expect(back.hash()).toBe(w.hash())
        expect(Array.from(back.map.payload)).toEqual(Array.from(w.map.payload))
        expect(encodeWorld(back)).toEqual(bytes)
        const bays = Array.from(back.map.payload).filter((p, i) => back.map.kind[i] === RtTileKind.station && rtRoadStopIsBay(p))
        expect(bays.map(p => rtRoadStopFacing(p)).sort()).toEqual([RtDir.se, RtDir.nw].sort())
    })

    it('a save written before bays existed decodes, hashes and runs on exactly as it did', () => {
        // written by the code at the commit before bay stops: buses between three drive-through stops,
        // saved at tick 3000; that code read hash 117096413 there and 2550752929 2000 ticks on
        const bytes = new Uint8Array(readFileSync(resolve(import.meta.dirname, 'fixtures/pre-bay-stops.rtsave')))
        const w = decodeWorld(bytes)!
        expect(w).not.toBeNull()
        expect(w.hash()).toBe(117096413)
        expect(encodeWorld(w)).toEqual(bytes)
        const stops = Array.from(w.map.payload).filter((p, i) => w.map.kind[i] === RtTileKind.station)
        expect(stops.length).toBe(3)
        expect(stops.every(p => !rtRoadStopIsBay(p))).toBe(true)
        for (let t = 0; t < 2000; t++) w.step()
        expect(w.hash()).toBe(2550752929)
    })

    it('a save holding a station payload that cannot exist is refused', () => {
        const base = world()
        const tile = base.map.idx(30, 30)
        const bad = [
            // a bay whose axis bit disagrees with its facing
            (rtBayPayload(0, RtStationTile.bus, RtDir.ne, ME) | (1 << 18)) >>> 0,
            // a bay whose road is someone else's
            rtBayPayload(0, RtStationTile.bus, RtDir.se, RIVAL),
            // tile type 3
            rtStationPayload(0, RtStationTile.bus, RtAxis.x, ME) | (3 << 16),
            // the unused bit
            (rtStationPayload(0, RtStationTile.bus, RtAxis.x, ME) | (1 << 23)) >>> 0,
            // a platform reservation on a road stop
            (rtStationPayload(0, RtStationTile.truck, RtAxis.x, ME) | (1 << 19)) >>> 0,
            // a bay bit or a facing on a platform, a facing without the bay bit
            (rtStationPayload(0, RtStationTile.rail, RtAxis.x) | (1 << 20)) >>> 0,
            (rtStationPayload(0, RtStationTile.rail, RtAxis.x) | (2 << 21)) >>> 0,
            (rtStationPayload(0, RtStationTile.bus, RtAxis.x, ME) | (1 << 21)) >>> 0
        ]
        must(base, { kind: K.buildRoadStop, tile, stop: RtStationTile.bus, shape: RtRoadStopShape.baySw })
        expect(decodeWorld(encodeWorld(base))).not.toBeNull()
        for (const payload of bad) {
            const w = decodeWorld(encodeWorld(base))!
            w.map.payload[tile] = payload
            expect(decodeWorld(encodeWorld(w)), `payload ${payload.toString(16)}`).toBeNull()
        }
    })
})

describe('bay road stops: the command byte (Q29a)', () => {
    const tile = 64 * 30 + 30

    it('a stop command without a shape is byte for byte the old command and still builds a drive-through stop', () => {
        const old = new Uint8Array([K.buildRoadStop, tile & 255, tile >> 8, 0, 0, RtStationTile.bus])
        expect(decodeCommand(old)).toEqual({ kind: K.buildRoadStop, tile, stop: RtStationTile.bus })
        expect(encodeCommand({ kind: K.buildRoadStop, tile, stop: RtStationTile.bus })).toEqual(old)
        expect(encodeCommand({ kind: K.buildRoadStop, tile, stop: RtStationTile.bus, shape: RtRoadStopShape.auto })).toEqual(old)
        const w = world()
        road(w, 25, 30, 35, 30)
        expect(applyCommand(w, ME, decodeCommand(old)!, true)).toMatchObject({ ok: true })
        expect(rtRoadStopIsBay(w.map.payload[tile]!)).toBe(false)
    })

    it('every shape of both stops round-trips through the command codec and the protocol', () => {
        for (const stop of [RtStationTile.bus, RtStationTile.truck]) {
            for (let shape = 1; shape <= RtRoadStopShape.bayNw; shape++) {
                const command: RtCommand = { kind: K.buildRoadStop, tile, stop, shape }
                const bytes = encodeCommand(command)
                expect(decodeCommand(bytes, 64)).toEqual(command)
                expect(bytes[5]).toBe(stop | (shape << 2))
                const frame = encodeClientMsg({ type: 'command', seq: 3, command })
                expect(decodeClientMsg(frame)).toMatchObject({ type: 'command', seq: 3, command })
            }
        }
    })

    it('a hostile stop byte is refused by the decoder and the protocol: a rail or unknown stop, a shape past the last, high bits', () => {
        const raw = (packed: number) => new Uint8Array([K.buildRoadStop, tile & 255, tile >> 8, 0, 0, packed])
        for (const packed of [0, 3, 0 | (2 << 2), 3 | (4 << 2), 1 | (7 << 2), 2 | (15 << 2), 1 | (1 << 5), 0x80 | 1, 0xff]) {
            expect(decodeCommand(raw(packed)), `byte ${packed}`).toBeNull()
            expect(decodeClientMsg(new Uint8Array([0x06, 1, ...raw(packed)])), `frame ${packed}`).toBeNull()
        }
        // and the encoder will not write one
        expect(() => encodeCommand({ kind: K.buildRoadStop, tile, stop: RtStationTile.bus, shape: 7 })).toThrow(RangeError)
    })

    it('applyCommand refuses a hostile shape field without touching the world', () => {
        const w = world()
        const before = w.hash()
        for (const shape of [7, -1, 2.5, Number.NaN, '3', null, 1e9]) {
            const command = { kind: K.buildRoadStop, tile, stop: RtStationTile.bus, shape } as unknown as RtCommand
            expect(applyCommand(w, ME, command, true)).toEqual({ ok: false, error: RtCommandError.invalid })
        }
        expect(w.hash()).toBe(before)
        expect(w.map.kind[tile]).toBe(RtTileKind.clear)
    })
})
