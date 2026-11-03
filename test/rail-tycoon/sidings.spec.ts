import { describe, expect, it } from 'vitest'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { buildDepot } from '#shared/utils/rail-tycoon/depots'
import { RtMap, RtTileKind, type RtDir } from '#shared/utils/rail-tycoon/map'
import {
    RT_RAIL_SIDING,
    RtParkingOutcome,
    buildSiding,
    findParkingTarget,
    removeSiding,
    rtCanReverse,
    rtIsSiding,
    rtSidingSpot,
    type RtParkingWorld
} from '#shared/utils/rail-tycoon/sidings'
import { RtSignalType, placeSignal } from '#shared/utils/rail-tycoon/signals'
import {
    RT_ROAD_Y,
    RT_TRACKDIR_END,
    RtBuildError,
    RtTrack,
    buildRail,
    removeRail,
    rtPieceBetween,
    rtTrackdirEntryEdge,
    rtTrackdirExitDir,
    rtValidTrackdir
} from '#shared/utils/rail-tycoon/track'
import { RT_NONE, RT_OWNER_NONE, RtVehicleKind, RtVehicleState, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { RtOccupiedRegistry } from '#shared/utils/rail-tycoon/occupied'

type XY = [number, number]

function dirTo(a: XY, b: XY): RtDir {
    if (b[0] === a[0] - 1) return 0
    if (b[1] === a[1] + 1) return 1
    if (b[0] === a[0] + 1) return 2
    return 3
}

function opposite(dir: RtDir): RtDir {
    return ((dir + 2) & 3) as RtDir
}

/** Lays track along a path of adjacent tiles; the ends run straight on. */
function lay(map: RtMap, owner: number, path: XY[]): void {
    for (let k = 0; k < path.length; k++) {
        const prev = k > 0 ? path[k - 1] : undefined
        const next = k < path.length - 1 ? path[k + 1] : undefined
        const here = path[k]!
        const a = prev ? dirTo(here, prev) : opposite(dirTo(here, next!))
        const b = next ? dirTo(here, next) : opposite(a)
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

function trackdir(entry: RtDir, exit: RtDir): number {
    for (let td = 0; td < RT_TRACKDIR_END; td++) {
        if (rtValidTrackdir(td) && rtTrackdirEntryEdge(td) === entry && rtTrackdirExitDir(td) === exit) return td
    }
    throw new Error(`no trackdir ${entry} -> ${exit}`)
}

/** Trackdirs of a train driving along a path (tile k entered from k - 1, left towards k + 1). */
function trackdirsAlong(path: XY[]): number[] {
    return path.map((here, k) => {
        const exit = k < path.length - 1 ? dirTo(here, path[k + 1]!) : opposite(dirTo(here, path[k - 1]!))
        const entry = k > 0 ? dirTo(here, path[k - 1]!) : opposite(exit)
        return trackdir(entry, exit)
    })
}

/** A train covering `path` (tail first, head last), its pieces held in the registry. */
function trainOn(world: RtParkingWorld & { occupied: RtOccupiedRegistry }, id: number, path: XY[], consist = [0]): RtVehicle {
    const tds = trackdirsAlong(path)
    const tiles: number[] = []
    const pieces: number[] = []
    for (let k = path.length - 1; k >= 0; k--) {
        tiles.push(world.map.idx(path[k]![0], path[k]![1]))
        pieces.push(tds[k]!)
    }
    for (let k = 0; k < tiles.length; k++) world.occupied.holdPiece(id, tiles[k]!, pieces[k]! & 7)
    return {
        id, owner: 0, kind: RtVehicleKind.rail, model: 0, consist, wagonCount: consist.length - 1, tiles, pieces,
        direction: pieces[0]!, progress: 0, speed: 0, subspeed: 0, route: [], routeIndex: 0, routeTick: RT_NONE, reservedEnd: 0,
        orders: [], orderIndex: 0, state: RtVehicleState.parking, stopped: true, loadTicks: 0, loadingStation: RT_NONE,
        cargo: [], reliability: 50000, breakdownChance: 0, breakdownTicks: 0, breakdownsSinceService: 0,
        lastServiceTick: RT_NONE, serviceDepot: RT_NONE, haltInDepot: false, runningTicks: 0, lost: false, lostRetryTick: RT_NONE,
        blockedTicks: 0, waitTicks: 0, crashTicks: 0, age: 0, value: 0, profitThisYear: 0, profitLastYear: 0
    }
}

/** The tile a route ends on, walking it from the train's head. */
function routeEnd(map: RtMap, train: RtVehicle, route: number[], reverse: boolean): number {
    let tile = reverse ? train.tiles[train.tiles.length - 1]! : train.tiles[0]!
    let td = reverse ? train.pieces[train.pieces.length - 1]! ^ 8 : train.pieces[0]!
    for (const next of route) {
        tile = map.neighbour(tile, rtTrackdirExitDir(td))
        td = next
    }
    return tile
}

/**
 * A main line on row 10 (x 2 to 40), and two dead-end branches for east-bound trains: one leaving
 * at (12, 10) down column 12 to (12, 14), one at (20, 10) down column 20 to (20, 13).
 */
function fixture(sharing = false) {
    const map = new RtMap(64)
    lay(map, 0, row(10, 2, 40))
    lay(map, 0, [[11, 10], [12, 10], ...column(12, 11, 14)])
    lay(map, 0, [[19, 10], [20, 10], ...column(20, 11, 13)])
    const world = { map, settings: { sharing }, occupied: new RtOccupiedRegistry(map.side * map.side) }
    const t = (x: number, y: number) => map.idx(x, y)
    return { map, world, t }
}

const BUDGET = RT_CATALOG.pathfinder.maxSearchNodes

describe('rail tycoon parking spots', () => {
    it('marks the dead end of an own branch and reads back its run to the junction', () => {
        const { map, t } = fixture()
        const dryRun = buildSiding(map, 0, t(12, 14), false)
        expect(dryRun).toEqual({ ok: true, cost: RT_CATALOG.construction.siding })
        expect(rtIsSiding(map.payload[t(12, 14)]!)).toBe(false)
        expect(buildSiding(map, 0, t(12, 14), true).ok).toBe(true)
        expect(rtIsSiding(map.payload[t(12, 14)]!)).toBe(true)
        const spot = rtSidingSpot(map, t(12, 14))
        expect(spot?.tiles).toEqual([t(12, 14), t(12, 13), t(12, 12), t(12, 11)])
        expect(spot?.pieces).toEqual([RtTrack.y, RtTrack.y, RtTrack.y, RtTrack.y])
        expect(buildSiding(map, 0, t(12, 14), true)).toEqual({ ok: false, error: RtBuildError.alreadyBuilt })
    })

    it('refuses everything that is not the dead end of plain own track', () => {
        const { map, t } = fixture()
        const fail = (owner: number, tile: number) => {
            const r = buildSiding(map, owner, tile, true)
            return r.ok ? -1 : r.error
        }
        expect(fail(0, t(5, 10))).toBe(RtBuildError.conflict)
        expect(fail(0, t(12, 10))).toBe(RtBuildError.conflict)
        expect(fail(0, t(12, 12))).toBe(RtBuildError.conflict)
        expect(fail(1, t(12, 14))).toBe(RtBuildError.notOwner)
        expect(fail(0, t(30, 30))).toBe(RtBuildError.invalid)
        expect(fail(0, -1)).toBe(RtBuildError.invalid)
        expect(fail(0, 64 * 64)).toBe(RtBuildError.invalid)
        expect(fail(0, 1.5)).toBe(RtBuildError.invalid)
        expect(fail(9, t(12, 14))).toBe(RtBuildError.invalid)
        // an isolated stub has two open ends: not a branch
        lay(map, 0, column(30, 20, 22))
        expect(fail(0, t(30, 22))).toBe(RtBuildError.conflict)
        // a signal on the run
        expect(placeSignal(map, 0, t(20, 12), RtTrack.y, RtSignalType.block, true).ok).toBe(true)
        expect(fail(0, t(20, 13))).toBe(RtBuildError.conflict)
        // another company's tile on the run
        const foreign = new RtMap(64)
        lay(foreign, 0, row(10, 2, 20))
        lay(foreign, 0, [[11, 10], [12, 10], [12, 11]])
        lay(foreign, 1, [[12, 12], [12, 13]])
        expect(buildSiding(foreign, 1, foreign.idx(12, 13), true)).toEqual({ ok: false, error: RtBuildError.conflict })
        expect(map.payload[t(20, 13)]! & RT_RAIL_SIDING).toBe(0)
    })

    it('stops being a spot once the run changes, and the mark goes with the rail', () => {
        const { map, t } = fixture()
        expect(buildSiding(map, 0, t(12, 14), true).ok).toBe(true)
        // a signal on the run ends the spot; taking it away brings the spot back
        expect(placeSignal(map, 0, t(12, 12), RtTrack.y, RtSignalType.block, true).ok).toBe(true)
        expect(rtSidingSpot(map, t(12, 14))).toBeNull()
        map.payload[t(12, 12)] = (map.payload[t(12, 12)]! | (0xff << 13) | (0xff << 21)) >>> 0
        expect(rtSidingSpot(map, t(12, 14))).not.toBeNull()
        // a second piece across the run makes that tile the junction, so the spot shrinks to what lies beyond it
        expect(buildRail(map, 0, t(12, 12), RtTrack.x, true).ok).toBe(true)
        expect(rtSidingSpot(map, t(12, 14))?.tiles).toEqual([t(12, 14), t(12, 13)])
        expect(removeRail(map, 0, t(12, 12), RtTrack.x, () => false, true).ok).toBe(true)
        expect(rtSidingSpot(map, t(12, 14))?.tiles.length).toBe(4)
        expect(removeRail(map, 0, t(12, 14), RtTrack.y, () => false, true).ok).toBe(true)
        expect(map.kind[t(12, 14)]).toBe(RtTileKind.clear)
        expect(rtSidingSpot(map, t(12, 14))).toBeNull()
    })

    it('removes a mark for a refund, and only its owner can', () => {
        const { map, t } = fixture()
        expect(buildSiding(map, 0, t(12, 14), true).ok).toBe(true)
        expect(removeSiding(map, 1, t(12, 14), true)).toEqual({ ok: false, error: RtBuildError.notOwner })
        expect(removeSiding(map, 0, t(12, 13), true)).toEqual({ ok: false, error: RtBuildError.invalid })
        expect(removeSiding(map, 0, t(12, 14), true)).toEqual({ ok: true, cost: RT_CATALOG.construction.removeSiding })
        expect(rtIsSiding(map.payload[t(12, 14)]!)).toBe(false)
        expect(rtSidingSpot(map, t(12, 14))).toBeNull()
    })

    it('sends a stopped train to the nearest free spot and drives it in to the dead end', () => {
        const { map, world, t } = fixture()
        buildSiding(map, 0, t(12, 14), true)
        buildSiding(map, 0, t(20, 13), true)
        const train = trainOn(world, 0, row(10, 6, 8))
        const result = findParkingTarget(world, train, BUDGET, BUDGET)
        expect(result.outcome).toBe(RtParkingOutcome.found)
        expect(result.place).toBe(t(12, 14))
        expect(result.depot).toBe(false)
        expect(result.reverse).toBe(false)
        expect(routeEnd(map, train, result.route, false)).toBe(t(12, 14))
        expect(result.nodes).toBeGreaterThan(0)
    })

    it('gives two stopped trains two different spots', () => {
        const { map, world, t } = fixture()
        buildSiding(map, 0, t(12, 14), true)
        buildSiding(map, 0, t(20, 13), true)
        const parked = trainOn(world, 1, column(12, 13, 14))
        expect(parked.tiles).toEqual([t(12, 14), t(12, 13)])
        const train = trainOn(world, 0, row(10, 6, 8))
        const result = findParkingTarget(world, train, BUDGET, BUDGET)
        expect(result.outcome).toBe(RtParkingOutcome.found)
        expect(result.place).toBe(t(20, 13))
        expect(routeEnd(map, train, result.route, false)).toBe(t(20, 13))
    })

    it('skips a spot the train does not fit in', () => {
        const { map, world, t } = fixture()
        buildSiding(map, 0, t(12, 14), true)
        buildSiding(map, 0, t(20, 13), true)
        // eight parts are four tiles: the four-tile spot at column 12 fits, the three-tile one does not
        const long = trainOn(world, 0, row(10, 6, 8), [0, 1, 1, 1, 1, 1, 1, 1])
        const first = findParkingTarget(world, long, BUDGET, BUDGET)
        expect(first.place).toBe(t(12, 14))
        trainOn(world, 1, column(12, 13, 14))
        const second = findParkingTarget(world, long, BUDGET, BUDGET)
        expect(second.outcome).toBe(RtParkingOutcome.none)
        expect(second.route).toEqual([])
        expect(second.place).toBe(RT_NONE)
    })

    it('skips a reserved spot', () => {
        const { map, world, t } = fixture()
        buildSiding(map, 0, t(12, 14), true)
        buildSiding(map, 0, t(20, 13), true)
        const payload = map.payload[t(12, 12)]!
        map.payload[t(12, 12)] = (payload | (1 << (7 + RtTrack.y))) >>> 0
        const train = trainOn(world, 0, row(10, 6, 8))
        expect(findParkingTarget(world, train, BUDGET, BUDGET).place).toBe(t(20, 13))
    })

    it('falls back to an own rail depot, and finds nothing without one', () => {
        const { map, world, t } = fixture()
        const train = trainOn(world, 0, row(10, 6, 8))
        expect(findParkingTarget(world, train, BUDGET, BUDGET).outcome).toBe(RtParkingOutcome.none)
        expect(buildDepot(map, 0, t(41, 10), RtVehicleKind.rail, 0, true).ok).toBe(true)
        const result = findParkingTarget(world, train, BUDGET, BUDGET)
        expect(result.outcome).toBe(RtParkingOutcome.found)
        expect(result.depot).toBe(true)
        expect(result.place).toBe(t(41, 10))
    })

    it('never parks in another company\'s spot or depot', () => {
        const { map, world, t } = fixture(true)
        lay(map, 1, [[30, 10], [30, 11], [30, 12], [30, 13]].map(([x, y]) => [x, y] as XY).slice(1))
        expect(buildDepot(map, 1, t(41, 10), RtVehicleKind.rail, 0, true).ok).toBe(true)
        const train = trainOn(world, 0, row(10, 6, 8))
        expect(findParkingTarget(world, train, BUDGET, BUDGET).outcome).toBe(RtParkingOutcome.none)
    })

    it('backs up into a spot behind it when it may reverse', () => {
        const map = new RtMap(64)
        lay(map, 0, row(10, 2, 40))
        // a branch facing west-bound trains: it joins the main line at (12, 10) from the east side
        lay(map, 0, [[13, 10], [12, 10], ...column(12, 11, 14)])
        const world = { map, settings: { sharing: false }, occupied: new RtOccupiedRegistry(map.side * map.side) }
        buildSiding(map, 0, map.idx(12, 14), true)
        const train = trainOn(world, 0, row(10, 18, 20))
        expect(rtCanReverse(world, train)).toBe(true)
        const result = findParkingTarget(world, train, BUDGET, BUDGET)
        expect(result.outcome).toBe(RtParkingOutcome.found)
        expect(result.reverse).toBe(true)
        expect(result.place).toBe(map.idx(12, 14))
        expect(routeEnd(map, train, result.route, true)).toBe(map.idx(12, 14))

        // a moving train cannot back up: the spot behind it is out of reach
        train.speed = 40
        expect(rtCanReverse(world, train)).toBe(false)
        expect(findParkingTarget(world, train, BUDGET, BUDGET).outcome).toBe(RtParkingOutcome.none)
    })

    it('does not reverse on a level crossing or into a held piece', () => {
        const map = new RtMap(64)
        lay(map, 0, row(10, 2, 40))
        const world = { map, settings: { sharing: false }, occupied: new RtOccupiedRegistry(map.side * map.side) }
        const train = trainOn(world, 0, row(10, 18, 20))
        expect(rtCanReverse(world, train)).toBe(true)
        trainOn(world, 1, row(10, 16, 17))
        expect(rtCanReverse(world, train)).toBe(false)

        const crossingMap = new RtMap(64)
        lay(crossingMap, 0, row(10, 2, 17))
        crossingMap.setTile(crossingMap.idx(18, 10), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
        expect(buildRail(crossingMap, 0, crossingMap.idx(18, 10), RtTrack.x, true).ok).toBe(true)
        lay(crossingMap, 0, row(10, 19, 40))
        const crossingWorld = { map: crossingMap, settings: { sharing: false }, occupied: new RtOccupiedRegistry(64 * 64) }
        const onCrossing = trainOn(crossingWorld, 0, row(10, 17, 19))
        expect(rtCanReverse(crossingWorld, onCrossing)).toBe(false)
    })

    it('defers when the tick budget runs out, without calling the train lost', () => {
        const { map, world, t } = fixture()
        buildSiding(map, 0, t(20, 13), true)
        const train = trainOn(world, 0, row(10, 6, 8))
        const result = findParkingTarget(world, train, BUDGET, 2)
        expect(result.outcome).toBe(RtParkingOutcome.deferred)
        expect(result.nodes).toBeLessThanOrEqual(2)
    })

    it('never throws on a broken train and gives identical answers for identical input', () => {
        const { map, world, t } = fixture()
        buildSiding(map, 0, t(12, 14), true)
        const train = trainOn(world, 0, row(10, 6, 8))
        const bad = [
            { ...train, tiles: [], pieces: [] },
            { ...train, pieces: [99, 99, 99] },
            { ...train, tiles: [-5, 1, 2] },
            { ...train, pieces: [0] }
        ]
        for (const v of bad) expect(findParkingTarget(world, v, BUDGET, BUDGET).outcome).toBe(RtParkingOutcome.none)
        expect(findParkingTarget(world, train, BUDGET, BUDGET)).toEqual(findParkingTarget(world, train, BUDGET, BUDGET))
    })
})
