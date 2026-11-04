import { describe, expect, it } from 'vitest'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RT_ROAD_DIR_BIT, RtMap, RtTileKind, type RtDir } from '#shared/utils/rail-tycoon/map'
import { RT_ROAD_TURN_AROUND_PENALTY, RtRouteHeap, RtRouteOutcome, findRailRoute, findRoadRoute, type RtRouteTarget } from '#shared/utils/rail-tycoon/pathfinder'
import { rtSetPieceReserved } from '#shared/utils/rail-tycoon/signals'
import { RtAxis, RtStationTile, rtStationPayload } from '#shared/utils/rail-tycoon/stations-build'
import {
    RtBuildError,
    RtTrack,
    RtTrackdir,
    buildRail,
    followTrack,
    rtPieceBetween,
    rtRailPayload,
    rtTrackdirExitDir
} from '#shared/utils/rail-tycoon/track'

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

function lay(map: RtMap, owner: number, path: XY[]): void {
    for (let k = 0; k < path.length; k++) {
        const prev = path[k - 1]
        const next = path[k + 1]
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
    if (y0 <= y1) for (let y = y0; y <= y1; y++) out.push([x, y])
    else for (let y = y0; y >= y1; y--) out.push([x, y])
    return out
}

/** The tiles a rail route visits, checking every step is a connection followTrack offers. */
function railTiles(map: RtMap, owner: number, sharing: boolean, fromTile: number, fromTd: number, route: number[]): number[] {
    const tiles: number[] = []
    let tile = fromTile
    let td = fromTd
    for (const next of route) {
        const options = followTrack(map, tile, rtTrackdirExitDir(td), owner, sharing)
        expect(options & (1 << next)).not.toBe(0)
        tile = map.neighbour(tile, rtTrackdirExitDir(td))
        td = next
        tiles.push(tile)
    }
    return tiles
}

/**
 * Two routes from row 20 to a three-tile platform at (31..33, 20): the straight row (A) and a detour
 * down column 10, along row 25 and up column 30 (B), split at (10, 20) and merging at (30, 20).
 */
function twoRoutes() {
    const map = new RtMap(64)
    const t = (x: number, y: number) => map.idx(x, y)
    lay(map, 0, row(20, 3, 33))
    lay(map, 0, [[9, 20], [10, 20], ...column(10, 21, 24), [10, 25], ...row(25, 11, 29), [30, 25], ...column(30, 24, 21), [30, 20], [31, 20]])
    for (let x = 31; x <= 33; x++) map.setTile(t(x, 20), RtTileKind.station, 0, rtStationPayload(5, RtStationTile.rail, RtAxis.x))
    const target: RtRouteTarget = { tiles: [t(31, 20), t(32, 20), t(33, 20)] }
    return { map, t, target }
}

const BUDGET = RT_CATALOG.pathfinder.maxSearchNodes

/** A 61 by 64 field of tiles holding all six pieces (every trackdir connects) and a target out of reach. */
function maze() {
    const map = new RtMap(64)
    for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 61; x++) map.setTile(map.idx(x, y), RtTileKind.rail, 0, rtRailPayload(0x3f))
    }
    map.setTile(map.idx(63, 63), RtTileKind.station, 0, rtStationPayload(1, RtStationTile.rail, RtAxis.x))
    return { map, target: { tiles: [map.idx(63, 63)] } }
}

describe('rail tycoon pathfinding', () => {
    describe('rail routes', () => {
        it('takes the shorter of two routes and runs on to the platform end', () => {
            const { map, t, target } = twoRoutes()
            const result = findRailRoute(map, 0, t(5, 20), RtTrackdir.xSw, target, BUDGET, BUDGET, { sharing: false })
            expect(result.outcome).toBe(RtRouteOutcome.found)
            expect(result.lost).toBe(false)
            expect(result.reverse).toBe(false)
            expect(result.goal).toBe(t(31, 20))
            const tiles = railTiles(map, 0, false, t(5, 20), RtTrackdir.xSw, result.route)
            expect(tiles).toEqual(row(20, 6, 33).map(([x, y]) => t(x, y)))
            expect(result.route.every(td => td === RtTrackdir.xSw)).toBe(true)
            expect(result.nodes).toBeGreaterThan(0)
            // (6, 20) to the first platform tile (31, 20): 26 straight tiles
            expect(result.cost).toBe(26 * RT_CATALOG.pathfinder.tileCost)
        })

        it('diverts round reserved pieces on the shorter route', () => {
            const { map, t, target } = twoRoutes()
            for (let x = 11; x <= 29; x++) rtSetPieceReserved(map, t(x, 20), RtTrack.x, true)
            const result = findRailRoute(map, 0, t(5, 20), RtTrackdir.xSw, target, BUDGET, BUDGET, { sharing: false })
            expect(result.outcome).toBe(RtRouteOutcome.found)
            const tiles = railTiles(map, 0, false, t(5, 20), RtTrackdir.xSw, result.route)
            expect(tiles).toContain(t(20, 25))
            expect(tiles).not.toContain(t(20, 20))
            expect(result.route[4]).toBe(RtTrackdir.rightS)
        })

        it('gives notFound with a route to the node nearest an unreachable target', () => {
            const { map, t } = twoRoutes()
            map.setTile(t(40, 40), RtTileKind.station, 0, rtStationPayload(9, RtStationTile.rail, RtAxis.x))
            const result = findRailRoute(map, 0, t(5, 20), RtTrackdir.xSw, { tiles: [t(40, 40)] }, BUDGET, BUDGET, { sharing: false })
            expect(result.outcome).toBe(RtRouteOutcome.notFound)
            expect(result.lost).toBe(true)
            const tiles = railTiles(map, 0, false, t(5, 20), RtTrackdir.xSw, result.route)
            // (30, 25) is 25 tiles from the target, the closest any reachable tile gets
            expect(tiles[tiles.length - 1]).toBe(t(30, 25))
            expect(result.nodes).toBeLessThan(BUDGET)
        })

        it('stops a search on a large maze at the per-search budget without hanging', () => {
            const { map, target } = maze()
            const started = performance.now()
            const result = findRailRoute(map, 0, map.idx(2, 2), RtTrackdir.xSw, target, BUDGET, RT_CATALOG.pathfinder.pathNodesPerTick, { sharing: false })
            console.log(`maze search: ${result.nodes} nodes in ${(performance.now() - started).toFixed(1)} ms`)
            expect(result.outcome).toBe(RtRouteOutcome.notFound)
            expect(result.nodes).toBe(BUDGET)
            expect(result.lost).toBe(true)
            expect(result.route.length).toBeGreaterThan(0)
        })

        it('defers when the tick budget runs out first, saying nothing about reachability', () => {
            const { map, target } = maze()
            const result = findRailRoute(map, 0, map.idx(2, 2), RtTrackdir.xSw, target, BUDGET, 500, { sharing: false })
            expect(result).toEqual({ outcome: RtRouteOutcome.deferred, route: [], cost: 0, nodes: 500, reverse: false, lost: false, goal: -1 })
            const none = findRailRoute(map, 0, map.idx(2, 2), RtTrackdir.xSw, target, BUDGET, 0, { sharing: false })
            expect(none.outcome).toBe(RtRouteOutcome.deferred)
            expect(none.nodes).toBe(0)
        })

        it('gives identical outcomes for identical inputs', () => {
            const { map, t, target } = twoRoutes()
            const run = () => [
                findRailRoute(map, 0, t(5, 20), RtTrackdir.xSw, target, BUDGET, BUDGET, { sharing: false }),
                findRailRoute(map, 0, t(5, 20), RtTrackdir.xSw, { tiles: [t(40, 40)] }, BUDGET, BUDGET, { sharing: false }),
                findRailRoute(map, 0, t(5, 20), RtTrackdir.xSw, target, BUDGET, 7, { sharing: false })
            ]
            expect(run()).toEqual(run())
        })

        it('reverses at a terminus when the target lies behind', () => {
            const { map, t } = twoRoutes()
            const target = { tiles: [t(4, 20)] }
            const stuck = findRailRoute(map, 0, t(33, 20), RtTrackdir.xSw, target, BUDGET, BUDGET, { sharing: false })
            expect(stuck.outcome).toBe(RtRouteOutcome.notFound)
            const result = findRailRoute(map, 0, t(33, 20), RtTrackdir.xSw, target, BUDGET, BUDGET, {
                sharing: false, reverseFrom: { tile: t(31, 20), trackdir: RtTrackdir.xSw }
            })
            expect(result.outcome).toBe(RtRouteOutcome.found)
            expect(result.reverse).toBe(true)
            expect(result.route[0]).toBe(RtTrackdir.xNe)
            expect(railTiles(map, 0, false, t(31, 20), RtTrackdir.xNe, result.route).at(-1)).toBe(t(4, 20))
        })

        it('never throws on bad input', () => {
            const { map, t, target } = twoRoutes()
            expect(findRailRoute(map, 0, -1, RtTrackdir.xSw, target, BUDGET, BUDGET, { sharing: false }).outcome).toBe(RtRouteOutcome.notFound)
            expect(findRailRoute(map, 0, t(5, 20), 7, target, BUDGET, BUDGET, { sharing: false }).outcome).toBe(RtRouteOutcome.notFound)
            expect(findRailRoute(map, 0, t(5, 20), RtTrackdir.xSw, { tiles: [-5, 1e9] }, Number.NaN, BUDGET, { sharing: false }).outcome).toBe(RtRouteOutcome.notFound)
            expect(findRailRoute(map, 0, t(5, 20), RtTrackdir.xSw, null as unknown as RtRouteTarget, BUDGET, BUDGET, { sharing: false }).route).toEqual([])
        })
    })

    describe('ties', () => {
        it('pops the lowest cost first and equal costs in insertion order', () => {
            const heap = new RtRouteHeap()
            const pushed: [number, number][] = []
            for (let k = 0; k < 200; k++) {
                const cost = (k * 7919) % 5
                heap.push(cost, k)
                pushed.push([cost, k])
            }
            const popped: number[] = []
            while (heap.size > 0) popped.push(heap.pop())
            const expected = [...pushed].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, node]) => node)
            expect(popped).toEqual(expected)
        })

        /** A diamond: split at (10, 30) into rows 29 and 31, merged at (20, 30), on to (25, 30). */
        function diamond() {
            const map = new RtMap(64)
            const t = (x: number, y: number) => map.idx(x, y)
            lay(map, 0, row(30, 3, 9))
            lay(map, 0, [[9, 30], [10, 30], [10, 29], ...row(29, 11, 19), [20, 29], [20, 30], [21, 30]])
            lay(map, 0, [[9, 30], [10, 30], [10, 31], ...row(31, 11, 19), [20, 31], [20, 30], [21, 30]])
            lay(map, 0, row(30, 21, 25))
            return { map, t }
        }

        it('breaks equal costs by insertion order: the branch offered first wins', () => {
            const { map, t } = diamond()
            const result = findRailRoute(map, 0, t(4, 30), RtTrackdir.xSw, { tiles: [t(25, 30)] }, BUDGET, BUDGET, { sharing: false })
            expect(result.outcome).toBe(RtRouteOutcome.found)
            // at the split the right corner (trackdir 5) is offered before the upper corner (10)
            expect(railTiles(map, 0, false, t(4, 30), RtTrackdir.xSw, result.route)).toContain(t(15, 31))
        })

        it('takes the lowest-ranked of goals reached at the same cost (parking spots)', () => {
            const { map, t } = diamond()
            const goals = [t(15, 29), t(15, 31)]
            const byTile = findRailRoute(map, 0, t(4, 30), RtTrackdir.xSw, { tiles: goals }, BUDGET, BUDGET, { sharing: false })
            expect(byTile.goal).toBe(t(15, 29))
            const reversed = findRailRoute(map, 0, t(4, 30), RtTrackdir.xSw, { tiles: goals, rank: tile => -tile }, BUDGET, BUDGET, { sharing: false })
            expect(reversed.goal).toBe(t(15, 31))
            const refused = findRailRoute(map, 0, t(4, 30), RtTrackdir.xSw, { tiles: goals, accept: tile => tile !== t(15, 29) }, BUDGET, BUDGET, { sharing: false })
            expect(refused.goal).toBe(t(15, 31))
        })
    })

    describe('sharing', () => {
        function sharedLine() {
            const map = new RtMap(64)
            const t = (x: number, y: number) => map.idx(x, y)
            lay(map, 0, row(20, 3, 9))
            lay(map, 1, row(20, 10, 12))
            lay(map, 0, row(20, 13, 20))
            return { map, t, target: { tiles: [t(20, 20)] } }
        }

        it('finds no route over another company\'s rail with sharing off, and one with sharing on', () => {
            const { map, t, target } = sharedLine()
            const off = findRailRoute(map, 0, t(4, 20), RtTrackdir.xSw, target, BUDGET, BUDGET, { sharing: false })
            expect(off.outcome).toBe(RtRouteOutcome.notFound)
            const on = findRailRoute(map, 0, t(4, 20), RtTrackdir.xSw, target, BUDGET, BUDGET, { sharing: true })
            expect(on.outcome).toBe(RtRouteOutcome.found)
            expect(on.cost).toBe(16 * RT_CATALOG.pathfinder.tileCost + 3 * RT_CATALOG.economy.sharing.foreignTrackPenalty)
        })

        it('prefers the own route over an equally long foreign one', () => {
            for (const foreignUp of [true, false]) {
                const map = new RtMap(64)
                const t = (x: number, y: number) => map.idx(x, y)
                const up: XY[] = [[9, 30], [10, 30], [10, 29], ...row(29, 11, 19), [20, 29], [20, 30], [21, 30]]
                const down: XY[] = [[9, 30], [10, 30], [10, 31], ...row(31, 11, 19), [20, 31], [20, 30], [21, 30]]
                lay(map, 0, row(30, 3, 9))
                lay(map, 0, up)
                lay(map, 0, down)
                lay(map, 0, row(30, 21, 25))
                const foreign = foreignUp ? up : down
                for (const [x, y] of foreign.slice(2, -2)) map.owner[t(x, y)] = 1
                const result = findRailRoute(map, 0, t(4, 30), RtTrackdir.xSw, { tiles: [t(25, 30)] }, BUDGET, BUDGET, { sharing: true })
                expect(result.outcome).toBe(RtRouteOutcome.found)
                const tiles = railTiles(map, 0, true, t(4, 30), RtTrackdir.xSw, result.route)
                expect(tiles).toContain(foreignUp ? t(15, 31) : t(15, 29))
            }
        })
    })

    describe('road routes', () => {
        /** Roads every four tiles from 10 to 22 both ways, a bus stop at (16, 14) on an x-axis road. */
        function town() {
            const map = new RtMap(64)
            const t = (x: number, y: number) => map.idx(x, y)
            const road = new Set<number>()
            for (let k = 10; k <= 22; k++) {
                for (const line of [10, 14, 18, 22]) {
                    road.add(t(k, line))
                    road.add(t(line, k))
                }
            }
            for (const tile of road) {
                let bits = 0
                for (let dir = 0; dir < 4; dir++) {
                    const next = map.neighbour(tile, dir as RtDir)
                    if (next >= 0 && road.has(next)) bits |= RT_ROAD_DIR_BIT[dir]!
                }
                map.setTile(tile, RtTileKind.road, 255, bits)
            }
            map.setTile(t(16, 14), RtTileKind.station, 0, rtStationPayload(7, RtStationTile.bus, RtAxis.x))
            return { map, t }
        }

        function roadTiles(map: RtMap, from: number, firstDir: number, route: number[]): number[] {
            const tiles: number[] = []
            let tile = from
            let dir = firstDir
            for (const next of route) {
                tile = map.neighbour(tile, dir as RtDir)
                expect(tile).toBeGreaterThanOrEqual(0)
                tiles.push(tile)
                dir = next
            }
            return tiles
        }

        it('finds a bus stop across a town grid', () => {
            const { map, t } = town()
            const result = findRoadRoute(map, t(10, 20), 3, { tiles: [t(16, 14)] }, BUDGET, BUDGET)
            expect(result.outcome).toBe(RtRouteOutcome.found)
            expect(result.goal).toBe(t(16, 14))
            expect(result.turnAround).toBe(false)
            const tiles = roadTiles(map, t(10, 20), 3, result.route)
            expect(tiles.at(-1)).toBe(t(16, 14))
            // the shortest way: up to row 14 and east along it, 12 tiles and one turn
            expect(tiles.length).toBe(12)
            expect(result.cost).toBe(12 * RT_CATALOG.pathfinder.tileCost + RT_CATALOG.pathfinder.roadCurvePenalty)
        })

        it('gives notFound with a nearest-node route for a disconnected stop', () => {
            const { map, t } = town()
            map.setTile(t(40, 40), RtTileKind.station, 0, rtStationPayload(8, RtStationTile.bus, RtAxis.x))
            const result = findRoadRoute(map, t(10, 20), 3, { tiles: [t(40, 40)] }, BUDGET, BUDGET)
            expect(result.outcome).toBe(RtRouteOutcome.notFound)
            expect(result.lost).toBe(true)
            const first = result.turnAround ? 1 : 3
            expect(roadTiles(map, t(10, 20), first, result.route).at(-1)).toBe(t(22, 22))
        })

        it('turns around at a dead end for free and says so', () => {
            const map = new RtMap(64)
            const t = (x: number, y: number) => map.idx(x, y)
            for (let x = 5; x <= 15; x++) map.setTile(t(x, 50), RtTileKind.road, 255, (x > 5 ? RT_ROAD_DIR_BIT[0]! : 0) | (x < 15 ? RT_ROAD_DIR_BIT[2]! : 0))
            const result = findRoadRoute(map, t(15, 50), 2, { tiles: [t(6, 50)] }, BUDGET, BUDGET)
            expect(result.outcome).toBe(RtRouteOutcome.found)
            expect(result.turnAround).toBe(true)
            expect(result.cost).toBe(9 * RT_CATALOG.pathfinder.tileCost)
            expect(roadTiles(map, t(15, 50), 0, result.route).at(-1)).toBe(t(6, 50))

            // mid-road a turn costs RT_ROAD_TURN_AROUND_PENALTY wherever it happens, so turning at once is cheapest
            const behind = findRoadRoute(map, t(10, 50), 2, { tiles: [t(8, 50)] }, BUDGET, BUDGET)
            expect(behind.turnAround).toBe(true)
            expect(behind.cost).toBe(RT_ROAD_TURN_AROUND_PENALTY + 2 * RT_CATALOG.pathfinder.tileCost)
        })

        it('defers on a spent tick budget and repeats itself exactly', () => {
            const { map, t } = town()
            const deferred = findRoadRoute(map, t(10, 20), 3, { tiles: [t(16, 14)] }, BUDGET, 3)
            expect(deferred.outcome).toBe(RtRouteOutcome.deferred)
            expect(deferred.nodes).toBe(3)
            expect(findRoadRoute(map, t(10, 20), 3, { tiles: [t(16, 14)] }, BUDGET, BUDGET))
                .toEqual(findRoadRoute(map, t(10, 20), 3, { tiles: [t(16, 14)] }, BUDGET, BUDGET))
            expect(findRoadRoute(map, -3, 9, { tiles: [] }, BUDGET, BUDGET).outcome).toBe(RtRouteOutcome.notFound)
        })
    })
})
