import { describe, expect, it } from 'vitest'
import { demolishTile } from '#shared/utils/rail-tycoon/demolish'
import { buildDepot, rtDepotPayload, rtDepotTrackFor } from '#shared/utils/rail-tycoon/depots'
import { RtMap, RtTileKind, type RtDir } from '#shared/utils/rail-tycoon/map'
import { decodeWorld, encodeWorld } from '#shared/utils/rail-tycoon/save'
import {
    RtSignalType,
    blockHasPathSignal,
    placeSignal,
    releaseAllFor,
    releaseReservation,
    reservePath,
    rtPieceReserved,
    rtDepotBlockOccupied,
    rtReservationHooks,
    rtSetPieceReserved,
    rtSignalGreen,
    rtSignalOnTrackdir,
    rtSignalTypeAt,
    rtTileSignals,
    updateSignalStates,
    type RtTrainOnPiece
} from '#shared/utils/rail-tycoon/signals'
import { RtAxis, RtStationTile, rtPlatformTrack, rtStationPayload } from '#shared/utils/rail-tycoon/stations-build'
import {
    RT_TRACKDIR_END,
    RtBuildError,
    RtTrack,
    RtTrackdir,
    buildRail,
    followTrack,
    removeRail,
    rtPieceBetween,
    rtRailTilePieces,
    rtSignalSlot,
    rtTrackdirEntryEdge,
    rtTrackdirExitDir,
    rtTrackdirList,
    rtTrackdirPiece,
    rtTrackdirsEnteringWith,
    rtValidTrackdir
} from '#shared/utils/rail-tycoon/track'
import { RT_NONE, RT_OWNER_NONE, RtVehicleKind, RtVehicleState, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { RtWorld, rtNewCompany } from '#shared/utils/rail-tycoon/world'
import { RtOccupiedRegistry } from '#shared/utils/rail-tycoon/occupied'

type XY = [number, number]

/** Direction (RtDir) from tile a to the adjacent tile b. */
function dirTo(a: XY, b: XY): RtDir {
    if (b[0] === a[0] - 1) return 0
    if (b[1] === a[1] + 1) return 1
    if (b[0] === a[0] + 1) return 2
    return 3
}

function opposite(dir: RtDir): RtDir {
    return ((dir + 2) & 3) as RtDir
}

/** Lays track along a path of adjacent tiles; `closed` joins the last tile back to the first. */
function lay(map: RtMap, owner: number, path: XY[], closed = false): void {
    for (let k = 0; k < path.length; k++) {
        const prev = k > 0 ? path[k - 1] : closed ? path[path.length - 1] : undefined
        const next = k < path.length - 1 ? path[k + 1] : closed ? path[0] : undefined
        const here = path[k]!
        const a = prev ? dirTo(here, prev) : opposite(dirTo(here, next!))
        const b = next ? dirTo(here, next) : opposite(a)
        const piece = rtPieceBetween(a, b)
        const result = buildRail(map, owner, map.idx(here[0], here[1]), piece, true)
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
    if (y0 <= y1) for (let y = y0; y <= y1; y++) out.push([x, y])
    else for (let y = y0; y >= y1; y--) out.push([x, y])
    return out
}

/** The trackdir entering through edge `entry` and leaving through edge `exit`. */
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

function makeTrain(id: number, owner: number, tiles: number[], pieces: number[], route: number[]): RtVehicle {
    return {
        id, owner, kind: RtVehicleKind.rail, model: 0, consist: [0], wagonCount: 0, tiles, pieces,
        direction: pieces[0]!, progress: 0, speed: 0, subspeed: 0, route, routeIndex: 0, routeTick: 0, reservedEnd: 0,
        orders: [], orderIndex: 0, state: RtVehicleState.driving, stopped: false, loadTicks: 0, loadingStation: RT_NONE,
        cargo: [], reliability: 50000, breakdownChance: 0, breakdownTicks: 0, breakdownsSinceService: 0,
        lastServiceTick: RT_NONE, serviceDepot: RT_NONE, haltInDepot: false, runningTicks: 0, lost: false, lostRetryTick: RT_NONE,
        blockedTicks: 0, waitTicks: 0, crashTicks: 0, age: 0, value: 0, profitThisYear: 0, profitLastYear: 0
    }
}

/**
 * A train on a path: path[0] is its tail, path[headAt] its head; the route is the rest of the path.
 * Its pieces are held in the registry.
 */
function trainOn(map: RtMap, registry: RtOccupiedRegistry, id: number, path: XY[], headAt: number): RtVehicle {
    const tds = trackdirsAlong(path)
    const tiles: number[] = []
    const pieces: number[] = []
    for (let k = headAt; k >= 0; k--) {
        tiles.push(map.idx(path[k]![0], path[k]![1]))
        pieces.push(tds[k]!)
    }
    const train = makeTrain(id, 0, tiles, pieces, tds.slice(headAt + 1))
    for (let k = 0; k < tiles.length; k++) registry.holdPiece(id, tiles[k]!, pieces[k]! & 7)
    return train
}

function trainOnPieceOf(registry: RtOccupiedRegistry): RtTrainOnPiece {
    return (tile, piece, except) => registry.otherTrainOnPiece(tile, piece, except) !== RT_NONE
}

/**
 * Fixture A: a main line on row 10 (x 4 to 24) and a branch coming up column 12 (y 16 to 11) that
 * merges at (12, 10), a junction of the x piece and the lower corner. A path signal at (8, 10) on the
 * main line and at (12, 13) on the branch; a block signal at (18, 10).
 */
function fixtureA() {
    const map = new RtMap(64)
    const main = row(10, 4, 24)
    const branch = [...column(12, 16, 11), [12, 10] as XY, ...row(10, 13, 24)]
    lay(map, 0, main)
    lay(map, 0, branch)
    const t = (x: number, y: number) => map.idx(x, y)
    expect(placeSignal(map, 0, t(8, 10), RtTrack.x, RtSignalType.path, true).ok).toBe(true)
    expect(placeSignal(map, 0, t(12, 13), RtTrack.y, RtSignalType.path, true).ok).toBe(true)
    expect(placeSignal(map, 0, t(18, 10), RtTrack.x, RtSignalType.block, true).ok).toBe(true)
    const registry = new RtOccupiedRegistry(map.tileCount)
    // T1 waits at the main path signal, head on (7, 10); T0 (lower id) at the branch path signal, head on (12, 14)
    const t1 = trainOn(map, registry, 1, main, 3)
    const t0 = trainOn(map, registry, 0, branch, 2)
    return { map, t, registry, t0, t1, top: trainOnPieceOf(registry) }
}

describe('rail tycoon signals and reservations', () => {
    describe('trackdirs and followTrack', () => {
        it('uses the original trackdir numbering and maps every trackdir to its piece', () => {
            expect(RtTrackdir).toEqual({ xNe: 0, ySe: 1, upperE: 2, lowerE: 3, leftS: 4, rightS: 5, xSw: 8, yNw: 9, upperW: 10, lowerW: 11, leftN: 12, rightN: 13 })
            for (let td = 0; td < 6; td++) {
                expect(rtTrackdirPiece(td)).toBe(td)
                expect(rtTrackdirPiece(td + 8)).toBe(td)
            }
            for (const bad of [6, 7, 14, 15, -1, 1.5, Number.NaN]) expect(() => rtTrackdirPiece(bad)).toThrow(RangeError)
            // moving north-east (x - 1) a train can be on the x piece or the lower and left corners
            expect(rtTrackdirList(rtTrackdirsEnteringWith(0))).toEqual([RtTrackdir.xNe, RtTrackdir.lowerE, RtTrackdir.leftN])
            expect(rtTrackdirList(rtTrackdirsEnteringWith(2))).toEqual([RtTrackdir.rightS, RtTrackdir.xSw, RtTrackdir.upperW])
        })

        it('returns both branches at a junction and one into a merge', () => {
            const { map, t } = fixtureA()
            // from (13, 10) towards x - 1 the junction offers the main line and the branch
            expect(rtTrackdirList(followTrack(map, t(13, 10), 0, 0, false))).toEqual([RtTrackdir.xNe, RtTrackdir.lowerE])
            // from the branch into the junction only the corner connects
            expect(rtTrackdirList(followTrack(map, t(12, 11), 3, 0, false))).toEqual([RtTrackdir.lowerW])
            // from the main line into the junction only the straight
            expect(rtTrackdirList(followTrack(map, t(11, 10), 2, 0, false))).toEqual([RtTrackdir.xSw])
            // a tile cannot be left through an edge no piece touches, nor past the map edge
            expect(followTrack(map, t(11, 10), 1, 0, false)).toBe(0)
            const edge = new RtMap(64)
            lay(edge, 0, row(5, 0, 3))
            expect(followTrack(edge, edge.idx(0, 5), 0, 0, true)).toBe(0)
        })

        it('enters another company\'s rail only with sharing on', () => {
            const map = new RtMap(64)
            lay(map, 0, row(20, 4, 9))
            lay(map, 1, row(20, 10, 14))
            expect(followTrack(map, map.idx(9, 20), 2, 0, false)).toBe(0)
            expect(rtTrackdirList(followTrack(map, map.idx(9, 20), 2, 0, true))).toEqual([RtTrackdir.xSw])
            expect(followTrack(map, map.idx(10, 20), 0, 1, false)).toBe(0)
            expect(rtTrackdirList(followTrack(map, map.idx(10, 20), 0, 1, true))).toEqual([RtTrackdir.xNe])
        })

        it('enters a depot only through its entrance and a platform only along its axis', () => {
            const map = new RtMap(64)
            const depot = map.idx(10, 30)
            expect(buildDepot(map, 0, depot, RtVehicleKind.rail, 0, true).ok).toBe(true)
            lay(map, 0, row(30, 6, 9))
            expect(rtTrackdirList(followTrack(map, map.idx(9, 30), 2, 0, false))).toEqual([RtTrackdir.xSw])
            expect(rtTrackdirList(followTrack(map, depot, 0, 0, false))).toEqual([RtTrackdir.xNe])
            lay(map, 0, row(30, 11, 13))
            expect(followTrack(map, map.idx(11, 30), 0, 0, false)).toBe(0)
            expect(followTrack(map, depot, 2, 0, false)).toBe(0)

            const platform = map.idx(20, 40)
            map.setTile(platform, RtTileKind.station, 0, rtStationPayload(3, RtStationTile.rail, RtAxis.y))
            lay(map, 0, column(20, 36, 39))
            expect(rtTrackdirList(followTrack(map, map.idx(20, 39), 1, 0, false))).toEqual([RtTrackdir.ySe])
            lay(map, 0, row(40, 16, 19))
            expect(followTrack(map, map.idx(19, 40), 2, 0, false)).toBe(0)
        })

        it('reads platform and depot pieces at the bits stations-build.ts and depots.ts write', () => {
            const map = new RtMap(64)
            for (const axis of [RtAxis.x, RtAxis.y]) {
                const payload = rtStationPayload(77, RtStationTile.rail, axis)
                map.setTile(5, RtTileKind.station, 0, payload)
                expect(rtRailTilePieces(map, 5)).toBe(1 << rtPlatformTrack(payload))
                map.setTile(5, RtTileKind.station, 0, rtStationPayload(77, RtStationTile.bus, axis))
                expect(rtRailTilePieces(map, 5)).toBe(0)
            }
            for (let facing = 0; facing < 4; facing++) {
                map.setTile(6, RtTileKind.depot, 0, rtDepotPayload(RtVehicleKind.rail, facing as RtDir))
                expect(rtRailTilePieces(map, 6)).toBe(1 << rtDepotTrackFor(facing as RtDir))
                map.setTile(6, RtTileKind.depot, 0, rtDepotPayload(RtVehicleKind.road, facing as RtDir))
                expect(rtRailTilePieces(map, 6)).toBe(0)
            }
        })
    })

    describe('placeSignal', () => {
        it('rtTileSignals reads each signal as the per-trackdir accessors do', () => {
            const { map, t } = fixtureA()
            expect(rtTileSignals(map, t(9, 10))).toEqual([])
            expect(rtTileSignals(map, -1)).toEqual([])
            for (const tile of [t(8, 10), t(12, 13), t(18, 10)]) {
                const signals = rtTileSignals(map, tile)
                expect(signals.length).toBe(1)
                const signal = signals[0]!
                expect(signal.type).toBe(rtSignalTypeAt(map, tile, signal.piece))
                for (const half of [0, 1] as const) {
                    const td = signal.piece + (half ? 8 : 0)
                    expect(signal.faces[half]).toBe(rtSignalOnTrackdir(map, tile, td))
                    if (signal.faces[half]) expect(signal.green[half]).toBe(rtSignalGreen(map, tile, td))
                }
            }
            expect(rtTileSignals(map, t(18, 10))[0]).toMatchObject({ piece: RtTrack.x, type: RtSignalType.block })
            expect(rtTileSignals(map, t(12, 13))[0]).toMatchObject({ piece: RtTrack.y, type: RtSignalType.path })
        })

        it('places a path signal on a straight and refuses platforms, junctions and crossings', () => {
            const { map, t } = fixtureA()
            const result = placeSignal(map, 0, t(20, 10), RtTrack.x, RtSignalType.path, true)
            expect(result).toEqual({ ok: true, cost: 48 })
            expect(rtSignalTypeAt(map, t(20, 10), RtTrack.x)).toBe(RtSignalType.path)
            expect(rtSignalOnTrackdir(map, t(20, 10), RtTrackdir.xNe)).toBe(true)
            expect(rtSignalOnTrackdir(map, t(20, 10), RtTrackdir.xSw)).toBe(true)

            map.setTile(t(30, 30), RtTileKind.station, 0, rtStationPayload(0, RtStationTile.rail, RtAxis.x))
            expect(placeSignal(map, 0, t(30, 30), RtTrack.x, RtSignalType.path, true)).toEqual({ ok: false, error: RtBuildError.invalid })
            expect(placeSignal(map, 0, t(12, 10), RtTrack.x, RtSignalType.block, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            expect(placeSignal(map, 0, t(12, 10), RtTrack.lower, RtSignalType.block, true)).toEqual({ ok: false, error: RtBuildError.conflict })

            map.setTile(t(40, 40), RtTileKind.road, RT_OWNER_NONE, 1 | 4)
            expect(buildRail(map, 0, t(40, 40), RtTrack.x, true).ok).toBe(true)
            expect(placeSignal(map, 0, t(40, 40), RtTrack.x, RtSignalType.block, true)).toEqual({ ok: false, error: RtBuildError.conflict })
        })

        it('gives two parallel diagonals a signal each and keeps the slots apart', () => {
            const map = new RtMap(64)
            const tile = map.idx(30, 30)
            expect(buildRail(map, 0, tile, RtTrack.upper, true).ok).toBe(true)
            expect(buildRail(map, 0, tile, RtTrack.lower, true).ok).toBe(true)
            expect(placeSignal(map, 0, tile, RtTrack.upper, RtSignalType.path, true).ok).toBe(true)
            const first = rtSignalSlot(map.payload[tile]!, 0)
            for (let k = 0; k < 4; k++) {
                expect(placeSignal(map, 0, tile, RtTrack.lower, RtSignalType.block, true).ok).toBe(true)
                expect(rtSignalSlot(map.payload[tile]!, 0)).toBe(first)
            }
            expect(placeSignal(map, 0, tile, RtTrack.lower, RtSignalType.block, true).ok).toBe(true)
            expect(rtSignalTypeAt(map, tile, RtTrack.upper)).toBe(RtSignalType.path)
            expect(rtSignalTypeAt(map, tile, RtTrack.lower)).toBe(RtSignalType.block)
            // a third piece would make a junction: refused while signals stand
            expect(buildRail(map, 0, tile, RtTrack.x, true)).toEqual({ ok: false, error: RtBuildError.conflict })
        })

        it('cycles both ways, one way, the other way, then removes', () => {
            const map = new RtMap(64)
            lay(map, 0, row(5, 3, 8))
            const tile = map.idx(5, 5)
            const ways = () => [rtSignalOnTrackdir(map, tile, RtTrackdir.xNe), rtSignalOnTrackdir(map, tile, RtTrackdir.xSw)]
            expect(placeSignal(map, 0, tile, RtTrack.x, RtSignalType.block, true)).toEqual({ ok: true, cost: 48 })
            expect(ways()).toEqual([true, true])
            expect(placeSignal(map, 0, tile, RtTrack.x, RtSignalType.block, true)).toEqual({ ok: true, cost: 0 })
            expect(ways()).toEqual([true, false])
            expect(placeSignal(map, 0, tile, RtTrack.x, RtSignalType.block, true)).toEqual({ ok: true, cost: 0 })
            expect(ways()).toEqual([false, true])
            expect(placeSignal(map, 0, tile, RtTrack.x, RtSignalType.block, true)).toEqual({ ok: true, cost: 7 })
            expect(ways()).toEqual([false, false])
            expect(rtSignalTypeAt(map, tile, RtTrack.x)).toBe(-1)
            // the other type converts in place
            placeSignal(map, 0, tile, RtTrack.x, RtSignalType.block, true)
            expect(placeSignal(map, 0, tile, RtTrack.x, RtSignalType.path, true)).toEqual({ ok: true, cost: 48 })
            expect(rtSignalTypeAt(map, tile, RtTrack.x)).toBe(RtSignalType.path)
            expect(ways()).toEqual([true, true])
        })

        it('refuses hostile and foreign input without throwing and writes nothing without apply', () => {
            const map = new RtMap(64)
            lay(map, 0, row(5, 3, 8))
            lay(map, 1, row(7, 3, 8))
            const before = map.payload.slice()
            const bad: [number, number, number, number][] = [
                [0, -1, 0, 0], [0, 1.5, 0, 0], [0, Number.NaN, 0, 0], [0, map.tileCount, 0, 0], [99, map.idx(5, 5), 0, 0],
                [0, map.idx(5, 5), 9, 0], [0, map.idx(5, 5), RtTrack.y, 0], [0, map.idx(5, 5), 0, 2], [0, map.idx(5, 5), 0, -1],
                [0, map.idx(20, 20), 0, 0]
            ]
            for (const [owner, tile, piece, type] of bad) {
                expect(placeSignal(map, owner, tile, piece, type, true)).toEqual({ ok: false, error: RtBuildError.invalid })
            }
            expect(placeSignal(map, 0, map.idx(5, 7), RtTrack.x, 0, true)).toEqual({ ok: false, error: RtBuildError.notOwner })
            expect(placeSignal(map, 0, map.idx(5, 5), RtTrack.x, 0, false)).toEqual({ ok: true, cost: 48 })
            expect(placeSignal({} as RtMap, 0, 0, 0, 0, true).ok).toBe(false)
            expect(map.payload).toEqual(before)
        })
    })

    describe('block signal states', () => {
        /** A loop x 10 to 20, y 10 to 15, split into an east and a west block by signals at (15, 10) and (15, 15). */
        function loop() {
            const map = new RtMap(64)
            const path: XY[] = [...row(10, 10, 20), ...column(20, 11, 15), ...row(15, 19, 10), ...column(10, 14, 11)]
            lay(map, 0, path, true)
            const t = (x: number, y: number) => map.idx(x, y)
            placeSignal(map, 0, t(15, 10), RtTrack.x, RtSignalType.block, true)
            placeSignal(map, 0, t(15, 15), RtTrack.x, RtSignalType.block, true)
            const registry = new RtOccupiedRegistry(map.tileCount)
            return { map, t, registry, top: trainOnPieceOf(registry) }
        }

        it('turns the entry signals of an occupied block red and leaves the other block green', () => {
            const { map, t, registry, top } = loop()
            registry.holdPiece(5, t(20, 12), RtTrack.y)
            updateSignalStates(map, top, [t(15, 10), t(15, 15)], false)
            // into the east block (x > 15) is towards x + 1
            expect(rtSignalGreen(map, t(15, 10), RtTrackdir.xSw)).toBe(false)
            expect(rtSignalGreen(map, t(15, 15), RtTrackdir.xSw)).toBe(false)
            expect(rtSignalGreen(map, t(15, 10), RtTrackdir.xNe)).toBe(true)
            expect(rtSignalGreen(map, t(15, 15), RtTrackdir.xNe)).toBe(true)

            registry.releasePiece(5, t(20, 12), RtTrack.y)
            registry.holdPiece(5, t(10, 12), RtTrack.y)
            const changed = updateSignalStates(map, top, [t(20, 12), t(10, 12)], false)
            expect(changed).toEqual([t(15, 10), t(15, 15)])
            expect(rtSignalGreen(map, t(15, 10), RtTrackdir.xSw)).toBe(true)
            expect(rtSignalGreen(map, t(15, 10), RtTrackdir.xNe)).toBe(false)
            expect(rtSignalGreen(map, t(15, 15), RtTrackdir.xNe)).toBe(false)
        })

        it('keeps two parallel diagonals in their own blocks', () => {
            const map = new RtMap(64)
            lay(map, 0, [...row(30, 26, 30), ...column(30, 29, 26)])
            lay(map, 0, [...column(30, 34, 31), [30, 30], ...row(30, 31, 34)])
            const tile = map.idx(30, 30)
            expect(rtRailTilePieces(map, tile)).toBe((1 << RtTrack.upper) | (1 << RtTrack.lower))
            placeSignal(map, 0, tile, RtTrack.upper, RtSignalType.block, true)
            placeSignal(map, 0, tile, RtTrack.lower, RtSignalType.block, true)
            const registry = new RtOccupiedRegistry(map.tileCount)
            registry.holdPiece(1, tile, RtTrack.lower)
            updateSignalStates(map, trainOnPieceOf(registry), [tile], false)
            expect(rtSignalGreen(map, tile, RtTrackdir.lowerE)).toBe(false)
            expect(rtSignalGreen(map, tile, RtTrackdir.lowerW)).toBe(false)
            expect(rtSignalGreen(map, tile, RtTrackdir.upperE)).toBe(true)
            expect(rtSignalGreen(map, tile, RtTrackdir.upperW)).toBe(true)
        })

        it('runs a block through one parallel diagonal without the other', () => {
            const map = new RtMap(64)
            lay(map, 0, [...row(30, 24, 30), ...column(30, 29, 24)])
            lay(map, 0, [...column(30, 36, 31), [30, 30], ...row(30, 31, 36)])
            const t = (x: number, y: number) => map.idx(x, y)
            placeSignal(map, 0, t(27, 30), RtTrack.x, RtSignalType.block, true)
            placeSignal(map, 0, t(33, 30), RtTrack.x, RtSignalType.block, true)
            const registry = new RtOccupiedRegistry(map.tileCount)
            registry.holdPiece(1, t(30, 30), RtTrack.lower)
            // fills that enter the shared tile from outside take only the diagonal they arrive on
            updateSignalStates(map, trainOnPieceOf(registry), [t(28, 30), t(32, 30)], false)
            expect(rtSignalGreen(map, t(33, 30), RtTrackdir.xNe)).toBe(false)
            expect(rtSignalGreen(map, t(27, 30), RtTrackdir.xSw)).toBe(true)
        })

        it('leaves the block in front of a depot green while a train stands inside', () => {
            const map = new RtMap(64)
            const depot = map.idx(40, 40)
            buildDepot(map, 0, depot, RtVehicleKind.rail, 0, true)
            lay(map, 0, row(40, 34, 39))
            const signal = map.idx(37, 40)
            placeSignal(map, 0, signal, RtTrack.x, RtSignalType.block, true)
            const registry = new RtOccupiedRegistry(map.tileCount)
            const top = trainOnPieceOf(registry)
            registry.enterDepot(3, depot)
            updateSignalStates(map, top, [depot], false)
            expect(rtSignalGreen(map, signal, RtTrackdir.xSw)).toBe(true)
            registry.leaveDepot(3, depot)
            registry.holdPiece(3, depot, RtTrack.x)
            // track behind the depot does not connect to it
            lay(map, 0, row(40, 41, 46))
            const behind = map.idx(43, 40)
            placeSignal(map, 0, behind, RtTrack.x, RtSignalType.block, true)
            updateSignalStates(map, top, [depot, behind], false)
            expect(rtSignalGreen(map, signal, RtTrackdir.xSw)).toBe(false)
            expect(rtSignalGreen(map, behind, RtTrackdir.xNe)).toBe(true)
        })

        it('a depot\'s block answer follows the track while its fill is memoised', () => {
            const map = new RtMap(64)
            const depot = map.idx(40, 40)
            buildDepot(map, 0, depot, RtVehicleKind.rail, 0, true)
            lay(map, 0, row(40, 30, 39))
            const registry = new RtOccupiedRegistry(map.tileCount)
            const top = trainOnPieceOf(registry)
            expect(rtDepotBlockOccupied(map, depot, top, false)).toBe(false)
            registry.holdPiece(5, map.idx(31, 40), RtTrack.x)
            expect(rtDepotBlockOccupied(map, depot, top, false)).toBe(true)
            // a gap cuts the train's tile off the depot's block, and closing it joins them again
            const gap = map.idx(35, 40)
            map.setTile(gap, RtTileKind.clear, RT_OWNER_NONE, 0)
            expect(rtDepotBlockOccupied(map, depot, top, false)).toBe(false)
            expect(buildRail(map, 0, gap, RtTrack.x, true).ok).toBe(true)
            expect(rtDepotBlockOccupied(map, depot, top, false)).toBe(true)
            // a signal between them splits the block too
            placeSignal(map, 0, map.idx(36, 40), RtTrack.x, RtSignalType.block, true)
            expect(rtDepotBlockOccupied(map, depot, top, false)).toBe(false)
        })

        it('ignores a bus on a level crossing', () => {
            const map = new RtMap(64)
            const crossing = map.idx(50, 45)
            map.setTile(crossing, RtTileKind.road, RT_OWNER_NONE, 1 | 4)
            lay(map, 0, row(45, 46, 54))
            expect(map.kind[crossing]).toBe(RtTileKind.rail)
            const signal = map.idx(48, 45)
            placeSignal(map, 0, signal, RtTrack.x, RtSignalType.block, true)
            const registry = new RtOccupiedRegistry(map.tileCount)
            registry.holdRoad(9, crossing, 1)
            updateSignalStates(map, trainOnPieceOf(registry), [crossing], false)
            expect(rtSignalGreen(map, signal, RtTrackdir.xSw)).toBe(true)
        })

        it('sets a new signal red at once in front of an occupied block, and refreshes after a removal or a deleted train', () => {
            const map = new RtMap(64)
            lay(map, 0, row(50, 2, 22))
            const t = (x: number) => map.idx(x, 50)
            const registry = new RtOccupiedRegistry(map.tileCount)
            const top = trainOnPieceOf(registry)
            registry.holdPiece(4, t(12), RtTrack.x)

            placeSignal(map, 0, t(10), RtTrack.x, RtSignalType.block, true)
            updateSignalStates(map, top, [t(10)], false)
            expect(rtSignalGreen(map, t(10), RtTrackdir.xSw)).toBe(false)
            expect(rtSignalGreen(map, t(10), RtTrackdir.xNe)).toBe(true)

            placeSignal(map, 0, t(6), RtTrack.x, RtSignalType.block, true)
            placeSignal(map, 0, t(14), RtTrack.x, RtSignalType.block, true)
            updateSignalStates(map, top, [t(6), t(14)], false)
            expect(rtSignalGreen(map, t(6), RtTrackdir.xSw)).toBe(true)
            for (let k = 0; k < 3; k++) placeSignal(map, 0, t(10), RtTrack.x, RtSignalType.block, true)
            expect(rtSignalTypeAt(map, t(10), RtTrack.x)).toBe(-1)
            updateSignalStates(map, top, [t(10)], false)
            expect(rtSignalGreen(map, t(6), RtTrackdir.xSw)).toBe(false)

            // removing track splits the block: the part without the train turns green
            expect(removeRail(map, 0, t(10), RtTrack.x, () => false, true).ok).toBe(true)
            updateSignalStates(map, top, [t(10)], false)
            expect(rtSignalGreen(map, t(6), RtTrackdir.xSw)).toBe(true)
            expect(rtSignalGreen(map, t(14), RtTrackdir.xNe)).toBe(false)

            registry.releaseVehicle(4)
            updateSignalStates(map, top, [t(12)], false)
            expect(rtSignalGreen(map, t(14), RtTrackdir.xNe)).toBe(true)
        })

        it('treats a block too large to fill as occupied', () => {
            const map = new RtMap(128)
            // a serpentine of more than RT_CATALOG blockFillTiles tiles with a signal at its start
            const path: XY[] = []
            for (let y = 1; y < 70; y += 2) {
                const leftToRight = ((y - 1) / 2) % 2 === 0
                path.push(...row(y, leftToRight ? 1 : 126, leftToRight ? 126 : 1))
                if (y + 2 < 70) path.push([leftToRight ? 126 : 1, y + 1])
            }
            expect(path.length).toBeGreaterThan(4096)
            lay(map, 0, path)
            placeSignal(map, 0, map.idx(3, 1), RtTrack.x, RtSignalType.block, true)
            updateSignalStates(map, () => false, [map.idx(3, 1)], false)
            expect(rtSignalGreen(map, map.idx(3, 1), RtTrackdir.xNe)).toBe(true)
            expect(rtSignalGreen(map, map.idx(3, 1), RtTrackdir.xSw)).toBe(false)
        })
    })

    describe('path reservation', () => {
        it('waits while a block-signalled train stands on the merge, then reserves to the first safe waiting position', () => {
            const { map, t, registry, t0, top } = fixtureA()
            registry.holdPiece(2, t(13, 10), RtTrack.x)
            expect(reservePath(map, t0, t0.route, 0, top, false)).toBe(0)
            expect(rtPieceReserved(map, t(12, 13), RtTrack.y)).toBe(false)
            expect(t0.reservedEnd).toBe(0)

            registry.releaseVehicle(2)
            // (12, 13) to (12, 11), the corner at (12, 10), then (13, 10) to (17, 10): stops before the block signal at (18, 10)
            expect(reservePath(map, t0, t0.route, 0, top, false)).toBe(9)
            expect(t0.reservedEnd).toBe(9)
            expect(rtPieceReserved(map, t(12, 10), RtTrack.lower)).toBe(true)
            expect(rtPieceReserved(map, t(12, 10), RtTrack.x)).toBe(false)
            for (let x = 13; x <= 17; x++) expect(rtPieceReserved(map, t(x, 10), RtTrack.x)).toBe(true)
            expect(rtPieceReserved(map, t(18, 10), RtTrack.x)).toBe(false)
            expect(rtSignalGreen(map, t(12, 13), RtTrackdir.yNw)).toBe(true)
            // the reserved path signal keeps its aspect through a block update (its block has a junction)
            updateSignalStates(map, top, [t(12, 13)], false)
            expect(rtSignalGreen(map, t(12, 13), RtTrackdir.yNw)).toBe(true)
        })

        it('refuses a junction piece crossing a piece another train stands on', () => {
            const { map, t, registry, t0, top } = fixtureA()
            registry.holdPiece(2, t(12, 10), RtTrack.x)
            expect(reservePath(map, t0, t0.route, 0, top, false)).toBe(0)
        })

        it('keeps a piece reserved that the train stands on and has reserved again ahead (a short loop)', () => {
            const map = new RtMap(64)
            const path: XY[] = [...row(10, 10, 14), ...column(14, 11, 12), ...row(12, 13, 10), [10, 11]]
            lay(map, 0, path, true)
            const t = (x: number, y: number) => map.idx(x, y)
            placeSignal(map, 0, t(12, 10), RtTrack.x, RtSignalType.path, true)
            const registry = new RtOccupiedRegistry(map.tileCount)
            // a train of 5 tiles from (13, 12) round to (11, 10), head before the path signal
            const tour: XY[] = [[13, 12], [12, 12], [11, 12], [10, 12], [10, 11], [10, 10], [11, 10], ...row(10, 12, 14), ...column(14, 11, 12), ...row(12, 13, 10)]
            const train = trainOn(map, registry, 0, tour, 6)
            for (let k = 0; k <= 6; k++) rtSetPieceReserved(map, train.tiles[k]!, train.pieces[k]! & 7, true)
            expect(reservePath(map, train, train.route, 0, trainOnPieceOf(registry), false)).toBeGreaterThan(5)
            const tail = train.tiles[train.tiles.length - 1]!
            expect(releaseReservation(map, train, tail, train.pieces[train.pieces.length - 1]! & 7)).toBe(false)
            expect(rtPieceReserved(map, tail, train.pieces[train.pieces.length - 1]! & 7)).toBe(true)
        })

        it('stops a reservation before a path signal facing the train', () => {
            const { map, t, t1, top } = fixtureA()
            placeSignal(map, 0, t(15, 10), RtTrack.x, RtSignalType.path, true)
            expect(reservePath(map, t1, t1.route, 0, top, false)).toBe(7)
            expect(rtPieceReserved(map, t(14, 10), RtTrack.x)).toBe(true)
            expect(rtPieceReserved(map, t(15, 10), RtTrack.x)).toBe(false)
        })

        it('lets only the first of two trains through the junction until it releases', () => {
            const { map, t, t0, t1, top } = fixtureA()
            expect(reservePath(map, t1, t1.route, 0, top, false)).toBe(10)
            expect(reservePath(map, t0, t0.route, 0, top, false)).toBe(0)
            // a train never clears a piece it does not own
            expect(releaseReservation(map, t0, t(10, 10), RtTrack.x)).toBe(false)
            expect(rtPieceReserved(map, t(10, 10), RtTrack.x)).toBe(true)
            expect(releaseReservation(map, t1, t(8, 10), RtTrack.x)).toBe(true)
            expect(rtPieceReserved(map, t(8, 10), RtTrack.x)).toBe(false)
            releaseAllFor(map, t1)
            expect(t1.reservedEnd).toBe(0)
            expect(rtPieceReserved(map, t(12, 10), RtTrack.x)).toBe(false)
            expect(reservePath(map, t0, t0.route, 0, top, false)).toBe(9)
        })

        it('walks the first connecting piece for an orderless train', () => {
            const { map, registry, top } = fixtureA()
            // an orderless train at the branch path signal: up the branch, the corner, along the main line
            const branch = [...column(12, 16, 11), [12, 10] as XY, ...row(10, 13, 24)]
            const orderless = trainOn(map, registry, 7, branch, 2)
            orderless.route = []
            expect(reservePath(map, orderless, orderless.route, 0, top, false)).toBe(9)
            expect(orderless.route).toEqual([RtTrackdir.yNw, RtTrackdir.yNw, RtTrackdir.yNw, RtTrackdir.lowerW, ...Array(5).fill(RtTrackdir.xSw)])
            expect(orderless.reservedEnd).toBe(9)
            // at the far junction from the other side the first trackdir in order wins: x before lower
            const back = trainOn(map, registry, 8, row(10, 20, 13), 6)
            back.route = []
            expect(reservePath(map, back, back.route, 0, top, false)).toBe(0)
            releaseAllFor(map, orderless)
            expect(reservePath(map, back, back.route, 0, top, false)).toBeGreaterThan(0)
            expect(back.route.slice(0, 2)).toEqual([RtTrackdir.xNe, RtTrackdir.xNe])
        })

        it('never throws on hostile trains', () => {
            const { map, t1, top } = fixtureA()
            expect(reservePath(map, t1, t1.route, -1, top, false)).toBe(0)
            expect(reservePath(map, t1, t1.route, 1.5, top, false)).toBe(0)
            expect(reservePath(map, t1, t1.route, 99, top, false)).toBe(0)
            const broken = makeTrain(9, 0, [map.tileCount + 5], [6], [99, -3])
            expect(reservePath(map, broken, broken.route, 0, top, false)).toBe(0)
            expect(releaseReservation(map, broken, -1, 0)).toBe(false)
            expect(releaseAllFor(map, broken)).toBe(0)
        })
    })

    describe('reservation hooks for removals', () => {
        it('re-reserves for the train inside the removal, so a lower-id train cannot take the freed path', () => {
            const { map, t, registry, t0, t1, top } = fixtureA()
            expect(reservePath(map, t1, t1.route, 0, top, false)).toBe(10)
            const occupied = (tile: number) => registry.vehicleOnTile(tile)
            expect(removeRail(map, 0, t(15, 10), RtTrack.x, occupied, true)).toEqual({ ok: false, error: RtBuildError.conflict })

            const hooks = rtReservationHooks(map, [t0, t1], top, false)
            expect(hooks.reserverOf(t(15, 10), RtTrack.x)).toBe(t1)
            expect(hooks.reserverOf(t(12, 10), RtTrack.lower)).toBeNull()
            expect(removeRail(map, 0, t(15, 10), RtTrack.x, occupied, true, hooks).ok).toBe(true)
            expect(map.kind[t(15, 10)]).toBe(RtTileKind.clear)
            // the route breaks at (15, 10): the train holds (8, 10) to (14, 10) again
            expect(t1.reservedEnd).toBe(7)
            for (let x = 8; x <= 14; x++) expect(rtPieceReserved(map, t(x, 10), RtTrack.x)).toBe(true)
            for (let x = 16; x <= 17; x++) expect(rtPieceReserved(map, t(x, 10), RtTrack.x)).toBe(false)
            expect(reservePath(map, t0, t0.route, 0, top, false)).toBe(0)
        })

        it('re-reserves after demolishing a reserved depot', () => {
            const map = new RtMap(64)
            const depot = map.idx(11, 30)
            buildDepot(map, 0, depot, RtVehicleKind.rail, 0, true)
            lay(map, 0, row(30, 2, 10))
            placeSignal(map, 0, map.idx(6, 30), RtTrack.x, RtSignalType.path, true)
            const registry = new RtOccupiedRegistry(map.tileCount)
            const top = trainOnPieceOf(registry)
            const train = trainOn(map, registry, 0, [...row(30, 2, 10), [11, 30]], 3)
            expect(reservePath(map, train, train.route, 0, top, false)).toBe(6)
            expect(rtPieceReserved(map, depot, RtTrack.x)).toBe(true)
            const occupied = (tile: number) => registry.vehicleOnTile(tile)
            expect(demolishTile(map, [], 0, depot, occupied, true, { vehicles: [train] }).ok).toBe(false)
            const result = demolishTile(map, [], 0, depot, occupied, true, { vehicles: [train], reservations: rtReservationHooks(map, [train], top, false) })
            expect(result.ok).toBe(true)
            expect(train.reservedEnd).toBe(5)
            expect(rtPieceReserved(map, map.idx(10, 30), RtTrack.x)).toBe(true)
        })
    })

    describe('blockHasPathSignal', () => {
        function lines() {
            const map = new RtMap(64)
            lay(map, 0, row(55, 4, 20))
            lay(map, 0, row(57, 4, 20))
            const t = (x: number, y: number) => map.idx(x, y)
            placeSignal(map, 0, t(8, 55), RtTrack.x, RtSignalType.block, true)
            placeSignal(map, 0, t(14, 55), RtTrack.x, RtSignalType.path, true)
            placeSignal(map, 0, t(8, 57), RtTrack.x, RtSignalType.block, true)
            placeSignal(map, 0, t(14, 57), RtTrack.x, RtSignalType.block, true)
            return { map, t }
        }

        it('is true for a block with a path signal on its exit and false for a plain block', () => {
            const { map, t } = lines()
            expect(blockHasPathSignal(map, t(10, 55), RtTrackdir.xSw, false)).toBe(true)
            expect(blockHasPathSignal(map, t(10, 55), RtTrackdir.xNe, false)).toBe(true)
            expect(blockHasPathSignal(map, t(8, 55), RtTrackdir.xSw, false)).toBe(true)
            expect(blockHasPathSignal(map, t(8, 55), RtTrackdir.xNe, false)).toBe(false)
            expect(blockHasPathSignal(map, t(10, 57), RtTrackdir.xSw, false)).toBe(false)
            expect(blockHasPathSignal(map, t(30, 30), RtTrackdir.xSw, false)).toBe(false)
            expect(blockHasPathSignal(map, -4, 99, false)).toBe(false)
        })

        it('is refreshed after a signal is built or removed', () => {
            const { map, t } = lines()
            expect(blockHasPathSignal(map, t(10, 57), RtTrackdir.xSw, false)).toBe(false)
            placeSignal(map, 0, t(14, 57), RtTrack.x, RtSignalType.path, true)
            expect(blockHasPathSignal(map, t(10, 57), RtTrackdir.xSw, false)).toBe(true)
            for (let k = 0; k < 3; k++) placeSignal(map, 0, t(14, 57), RtTrack.x, RtSignalType.path, true)
            expect(rtSignalTypeAt(map, t(14, 57), RtTrack.x)).toBe(-1)
            expect(blockHasPathSignal(map, t(10, 57), RtTrackdir.xSw, false)).toBe(false)
            placeSignal(map, 0, t(11, 57), RtTrack.x, RtSignalType.path, true)
            expect(blockHasPathSignal(map, t(10, 57), RtTrackdir.xSw, false)).toBe(true)
            removeRail(map, 0, t(4, 57), RtTrack.x, () => false, true)
            expect(blockHasPathSignal(map, t(10, 57), RtTrackdir.xSw, false)).toBe(true)
        })

        it('answers the same on a world that has run and on a copy decoded from its snapshot', () => {
            const { map, t } = lines()
            const company = rtNewCompany(0, 'Alpha', 0, 0)
            const world = RtWorld.empty({ side: 64, maxCompanies: 2, sharing: false }, { map, tick: 500, companies: [company] })
            const signalled: [number, number][] = []
            for (let tile = 0; tile < map.tileCount; tile++) {
                for (let piece = 0; piece < 6; piece++) {
                    if (rtSignalTypeAt(map, tile, piece) >= 0) signalled.push([tile, piece])
                }
            }
            // the running world fills its memo, then the network changes under it
            for (const [tile, piece] of signalled) {
                blockHasPathSignal(world.map, tile, piece, false)
                blockHasPathSignal(world.map, tile, piece + 8, false)
            }
            placeSignal(world.map, 0, t(14, 57), RtTrack.x, RtSignalType.path, true)
            placeSignal(world.map, 0, t(14, 55), RtTrack.x, RtSignalType.block, true)
            for (const [tile, piece] of signalled) blockHasPathSignal(world.map, tile, piece, false)

            const copy = decodeWorld(encodeWorld(world))
            expect(copy).not.toBeNull()
            for (const [tile, piece] of signalled) {
                for (const td of [piece, piece + 8]) {
                    expect(blockHasPathSignal(copy!.map, tile, td, false)).toBe(blockHasPathSignal(world.map, tile, td, false))
                }
            }
            expect(blockHasPathSignal(world.map, t(10, 57), RtTrackdir.xSw, false)).toBe(true)
            expect(blockHasPathSignal(world.map, t(10, 55), RtTrackdir.xSw, false)).toBe(false)
        })
    })
})
