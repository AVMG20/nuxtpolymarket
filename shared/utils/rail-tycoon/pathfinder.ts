/**
 * Route search: integer A-star over trackdirs for trains and over road tiles and
 * directions for road vehicles. Costs and budgets come from RT_CATALOG pathfinder and mimic the
 * original's pathfinder at its default settings; the code is written from scratch.
 *
 * Every search is deterministic: integer costs, neighbours expanded in trackdir (or direction)
 * order, and a binary heap that breaks equal costs by insertion order. It ends in one of
 * three outcomes: found, notFound (the reachable graph or the per-search node budget ran
 * out first; the route then leads to the visited node nearest the target and lost is set) or
 * deferred (the world's per-tick budget ran out first, which says nothing about reachability).
 */

import { RT_CATALOG } from './catalog'
import { RT_ROAD_DIR_BIT, RtTileKind, rtReverseDir, type RtDir, type RtMap } from './map'
import {
    RtStationTile,
    rtBayFacingAt,
    rtDrivableRoadBits,
    rtRoadLaneExit,
    rtRoadStopBits,
    rtStationId,
    rtStationTileType
} from './stations-build'
import { rtDepotFacing, rtDepotKind } from './depots'
import { rtOneWayBlocked, rtPieceReserved, rtSignalGreen, rtSignalOnTrackdir, rtSignalTypeAt, RtSignalType } from './signals'
import {
    RT_TRACKDIR_END,
    followTrack,
    rtIsCrossing,
    rtReverseTrackdir,
    rtTileCorners,
    rtTrackdirDirection,
    rtTrackdirEntryEdge,
    rtTrackdirExitDir,
    rtValidTrackdir,
    type RtTrackdir
} from './track'
import { RT_NONE, RtVehicleKind, type RtStation } from './types'

export const RtRouteOutcome = { found: 0, notFound: 1, deferred: 2 } as const
export type RtRouteOutcome = typeof RtRouteOutcome[keyof typeof RtRouteOutcome]

/**
 * What a search looks for: entering any goal tile reaches it. Stations give their platform or stop
 * tiles, a depot its tile, a parking target the tiles of every free spot. The tiles are
 * also the heuristic's targets. Among goals reached at the same cost the lowest rank wins (default:
 * the tile index; a parking spot's tiles rank by its dead-end tile). accept, when given, can refuse a
 * goal tile entered along a trackdir or direction.
 */
export interface RtRouteTarget {
    tiles: readonly number[]
    rank?: (tile: number) => number
    accept?: (tile: number, dir: number) => boolean
}

/** A train's target for a station order: the station's rail platforms. */
export function rtStationRailTarget(map: RtMap, station: RtStation): RtRouteTarget {
    return { tiles: stationTiles(map, station, RtStationTile.rail) }
}

/** A road vehicle's target for a station order: the station's bus stops or truck stops. */
export function rtStationRoadTarget(map: RtMap, station: RtStation, stop: RtStationTile): RtRouteTarget {
    return { tiles: stationTiles(map, station, stop) }
}

/** The target of a depot order (the depot's tile). */
export function rtDepotTarget(tile: number): RtRouteTarget {
    return { tiles: [tile] }
}

function stationTiles(map: RtMap, station: RtStation, type: RtStationTile): number[] {
    const out: number[] = []
    for (const tile of station.tiles) {
        if (!map.validTile(tile) || map.kind[tile] !== RtTileKind.station) continue
        const payload = map.payload[tile]!
        if (rtStationId(payload) === station.id && rtStationTileType(payload) === type) out.push(tile)
    }
    return out
}

/* ------------------------------------------------------------------------------------------
 * The heap: smallest cost first, then the earliest pushed
 * ---------------------------------------------------------------------------------------- */

/** The search's binary min-heap: lowest integer cost first, equal costs in the order they were pushed. */
export class RtRouteHeap {
    private readonly cost: number[] = []
    private readonly seq: number[] = []
    private readonly node: number[] = []
    private counter = 0

    get size(): number {
        return this.node.length
    }

    private less(a: number, b: number): boolean {
        return this.cost[a]! < this.cost[b]! || (this.cost[a] === this.cost[b] && this.seq[a]! < this.seq[b]!)
    }

    private swap(a: number, b: number): void {
        const c = this.cost[a]!
        const s = this.seq[a]!
        const n = this.node[a]!
        this.cost[a] = this.cost[b]!
        this.seq[a] = this.seq[b]!
        this.node[a] = this.node[b]!
        this.cost[b] = c
        this.seq[b] = s
        this.node[b] = n
    }

    push(cost: number, node: number): void {
        let at = this.node.length
        this.cost.push(cost)
        this.seq.push(this.counter++)
        this.node.push(node)
        while (at > 0) {
            const up = (at - 1) >> 1
            if (!this.less(at, up)) break
            this.swap(at, up)
            at = up
        }
    }

    peekCost(): number {
        return this.cost[0]!
    }

    /** Removes the smallest entry and returns its node. */
    pop(): number {
        const top = this.node[0]!
        const last = this.node.length - 1
        this.swap(0, last)
        this.cost.pop()
        this.seq.pop()
        this.node.pop()
        let at = 0
        for (;;) {
            const l = at * 2 + 1
            const r = l + 1
            let best = at
            if (l < this.node.length && this.less(l, best)) best = l
            if (r < this.node.length && this.less(r, best)) best = r
            if (best === at) break
            this.swap(at, best)
            at = best
        }
        return top
    }
}

/* ------------------------------------------------------------------------------------------
 * The search shared by both pathfinders
 * ---------------------------------------------------------------------------------------- */

/** A node graph the generic search walks: nodes are tile * stride + dir. */
interface RtGraph {
    stride: number
    /** Calls visit(nextNode, edgeCost) for each successor, in a fixed order. */
    expand(node: number, visit: (next: number, cost: number) => void): void
    /** Whether a node lies on a goal tile the target accepts. */
    isGoal(node: number): boolean
    /** Heuristic: a lower bound of the cost to the nearest goal tile. */
    estimate(tile: number): number
}

interface RtSearchResult {
    outcome: RtRouteOutcome
    /** Nodes from the first after the start to the end, inclusive. */
    path: number[]
    /** The start node the path leaves from. */
    start: number
    cost: number
    nodes: number
}

function manhattanTo(map: RtMap, tile: number, goals: readonly number[]): number {
    const x = map.tileX(tile)
    const y = map.tileY(tile)
    let best = Infinity
    for (const goal of goals) {
        const d = Math.abs(map.tileX(goal) - x) + Math.abs(map.tileY(goal) - y)
        if (d < best) best = d
    }
    return best === Infinity ? 0 : best
}

function budgetOf(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

/**
 * A-star from start nodes (each with its own starting cost). Every expansion charges one node; the
 * search stops at min(searchBudget, tickBudget) expansions, deferred when the tick budget was the
 * smaller one, notFound otherwise.
 */
function search(map: RtMap, graph: RtGraph, starts: readonly [number, number][], target: RtRouteTarget, searchBudget: number, tickBudget: number): RtSearchResult {
    const limitSearch = budgetOf(searchBudget)
    const limitTick = budgetOf(tickBudget)
    const limit = Math.min(limitSearch, limitTick)
    const ids = new Map<number, number>()
    const nodeKey: number[] = []
    const nodeG: number[] = []
    const nodeParent: number[] = []
    const closed: boolean[] = []
    const heap = new RtRouteHeap()
    const rank = target.rank ?? ((tile: number) => tile)

    const offer = (key: number, g: number, parent: number) => {
        let id = ids.get(key)
        if (id === undefined) {
            id = nodeKey.length
            ids.set(key, id)
            nodeKey.push(key)
            nodeG.push(g)
            nodeParent.push(parent)
            closed.push(false)
        } else if (closed[id] || g >= nodeG[id]!) {
            return
        } else {
            nodeG[id] = g
            nodeParent[id] = parent
        }
        heap.push(g + graph.estimate((key / graph.stride) | 0), id)
    }
    for (const [key, g] of starts) offer(key, g, -1)

    let expansions = 0
    let goal = -1
    let goalF = 0
    let nearest = -1
    let nearestDist = 0
    let outcome: RtRouteOutcome = RtRouteOutcome.notFound
    while (heap.size > 0) {
        const f = heap.peekCost()
        if (goal >= 0 && f > goalF) break
        const id = heap.pop()
        if (closed[id]) continue
        closed[id] = true
        const key = nodeKey[id]!
        const tile = (key / graph.stride) | 0
        if (graph.isGoal(key)) {
            if (goal < 0 || rank(tile) < rank((nodeKey[goal]! / graph.stride) | 0)) {
                goal = id
                goalF = f
            }
            continue
        }
        if (goal >= 0) continue
        if (expansions >= limit) {
            outcome = limitTick < limitSearch ? RtRouteOutcome.deferred : RtRouteOutcome.notFound
            break
        }
        expansions++
        const dist = manhattanTo(map, tile, target.tiles)
        const dir = key % graph.stride
        if (nearest < 0 || dist < nearestDist || (dist === nearestDist && dir < nodeKey[nearest]! % graph.stride)) {
            nearest = id
            nearestDist = dist
        }
        const g = nodeG[id]!
        graph.expand(key, (next, cost) => offer(next, g + cost, id))
    }

    const chain = (end: number): { path: number[], start: number } => {
        const path: number[] = []
        let at = end
        while (nodeParent[at]! >= 0) {
            path.push(nodeKey[at]!)
            at = nodeParent[at]!
        }
        path.reverse()
        return { path, start: nodeKey[at]! }
    }
    if (goal >= 0) {
        const { path, start } = chain(goal)
        return { outcome: RtRouteOutcome.found, path, start, cost: nodeG[goal]!, nodes: expansions }
    }
    if (outcome === RtRouteOutcome.deferred || nearest < 0) {
        return { outcome, path: [], start: starts.length > 0 ? starts[0]![0] : 0, cost: 0, nodes: expansions }
    }
    const { path, start } = chain(nearest)
    return { outcome: RtRouteOutcome.notFound, path, start, cost: nodeG[nearest]!, nodes: expansions }
}

/* ------------------------------------------------------------------------------------------
 * Rail
 * ---------------------------------------------------------------------------------------- */

/**
 * Cost of starting from the reversed tail. The original adds a nominal 1 so a reversal only
 * wins when the reversed route is cheaper; the catalog has no entry for it.
 */
export const RT_RAIL_REVERSE_PENALTY = 1

export interface RtRailRouteOptions {
    /** The world's sharing setting. */
    sharing: boolean
    /** A reversing point (a train stopped at a platform or an end of line): its tail tile and trackdir. */
    reverseFrom?: { tile: number, trackdir: number } | null
    /** Overrides RT_RAIL_REVERSE_PENALTY. */
    reversePenalty?: number
}

export interface RtRailRouteResult {
    outcome: RtRouteOutcome
    /**
     * Trackdirs for the tiles after the start (route[0] is entered next): to the far end of the goal
     * tiles for found (a station's platform end), to the nearest node for notFound, empty for
     * deferred. When reverse is set it starts from the reversed tail. At most RT_CATALOG maxRouteLength.
     */
    route: RtTrackdir[]
    /** Route cost in pathfinder units (the cost to the goal or nearest node). */
    cost: number
    /** Nodes expanded; the caller charges them to world.pathNodesLeft. */
    nodes: number
    /** The best route begins by reversing the train. */
    reverse: boolean
    /** notFound: no route reaches the target. */
    lost: boolean
    /** Goal tile reached (found) or RT_NONE. */
    goal: number
}

const RAIL_STRIDE = 16

/** Height of an edge of a tile: the higher of its two corners (a piece only crosses level edges). */
function edgeHeight(map: RtMap, tile: number, edge: RtDir): number {
    const c = rtTileCorners(map, tile)
    switch (edge) {
        case 0: return Math.max(c.n, c.e)
        case 1: return Math.max(c.e, c.s)
        case 2: return Math.max(c.w, c.s)
        default: return Math.max(c.n, c.w)
    }
}

function climbs(map: RtMap, tile: number, entry: RtDir, exit: RtDir): boolean {
    return edgeHeight(map, tile, exit) > edgeHeight(map, tile, entry)
}

/**
 * The cheapest train route from (fromTile, fromTrackdir) to `target`, for a train of `owner`.
 * Edges come from followTrack (one-way signals facing against the train are impassable); each tile
 * costs tileCost (a corner piece cornerTileCost) plus curvePenalty for a 45-degree and curve90Penalty
 * for a 90-degree change of direction, uphillPenalty for a climbing piece, redSignalPenalty for a red
 * block signal facing the train, reservedPiecePenalty for a reserved piece, throughPlatformPenalty for
 * a platform that is no goal, crossingPenalty for a level crossing and, with sharing on,
 * foreignTrackPenalty for another company's tile. The heuristic is the Manhattan distance to
 * the nearest goal tile times cornerTileCost, the cheapest tile, so the cost found is the least.
 * A depot that is no goal is a dead end. searchBudget is the per-search node limit (RT_CATALOG
 * maxSearchNodes), tickBudget what the world has left this tick (world.pathNodesLeft). Never throws.
 */
export function findRailRoute(
    map: RtMap, owner: number, fromTile: number, fromTrackdir: number, target: RtRouteTarget,
    searchBudget: number, tickBudget: number, options: RtRailRouteOptions
): RtRailRouteResult {
    const none = (outcome: RtRouteOutcome): RtRailRouteResult => ({
        outcome, route: [], cost: 0, nodes: 0, reverse: false, lost: outcome === RtRouteOutcome.notFound, goal: RT_NONE
    })
    if (!map.validTile(fromTile) || !rtValidTrackdir(fromTrackdir) || !target || !Array.isArray(target.tiles)) return none(RtRouteOutcome.notFound)
    const sharing = options?.sharing === true
    const p = RT_CATALOG.pathfinder
    const goals = new Set(target.tiles.filter(t => map.validTile(t)))
    const goalList = [...goals]

    const isGoal = (node: number) => {
        const tile = (node / RAIL_STRIDE) | 0
        return goals.has(tile) && (!target.accept || target.accept(tile, node % RAIL_STRIDE))
    }
    const graph: RtGraph = {
        stride: RAIL_STRIDE,
        isGoal,
        estimate: tile => manhattanTo(map, tile, goalList) * p.cornerTileCost,
        expand(node, visit) {
            const tile = (node / RAIL_STRIDE) | 0
            const td = (node % RAIL_STRIDE) as RtTrackdir
            const exit = rtTrackdirExitDir(td)
            const options = followTrack(map, tile, exit, owner, sharing)
            if (options === 0) return
            const next = map.neighbour(tile, exit)
            const kind = map.kind[next]
            if (kind === RtTileKind.depot && !goals.has(next)) return
            for (let nextTd = 0; nextTd < RT_TRACKDIR_END; nextTd++) {
                if ((options & (1 << nextTd)) === 0 || rtOneWayBlocked(map, next, nextTd)) continue
                const piece = nextTd & 7
                let cost = piece < 2 ? p.tileCost : p.cornerTileCost
                const turn = Math.abs(rtTrackdirDirection(td) - rtTrackdirDirection(nextTd as RtTrackdir))
                const bend = Math.min(turn, 8 - turn)
                if (bend === 1) cost += p.curvePenalty
                else if (bend >= 2) cost += p.curve90Penalty
                if (climbs(map, next, rtTrackdirEntryEdge(nextTd as RtTrackdir), rtTrackdirExitDir(nextTd as RtTrackdir))) cost += p.uphillPenalty
                if (rtSignalOnTrackdir(map, next, nextTd) && rtSignalTypeAt(map, next, piece) === RtSignalType.block && !rtSignalGreen(map, next, nextTd)) {
                    cost += p.redSignalPenalty
                }
                if (rtPieceReserved(map, next, piece)) cost += p.reservedPiecePenalty
                if (kind === RtTileKind.station && !goals.has(next)) cost += p.throughPlatformPenalty
                if (kind === RtTileKind.rail && rtIsCrossing(map.payload[next]!)) cost += p.crossingPenalty
                if (map.owner[next] !== owner) cost += RT_CATALOG.economy.sharing.foreignTrackPenalty
                visit(next * RAIL_STRIDE + nextTd, cost)
            }
        }
    }

    const starts: [number, number][] = [[fromTile * RAIL_STRIDE + fromTrackdir, 0]]
    const back = options?.reverseFrom
    let reverseKey = -1
    if (back && map.validTile(back.tile) && rtValidTrackdir(back.trackdir)) {
        const penalty = Number.isInteger(options.reversePenalty) && options.reversePenalty! >= 0 ? options.reversePenalty! : RT_RAIL_REVERSE_PENALTY
        reverseKey = back.tile * RAIL_STRIDE + rtReverseTrackdir(back.trackdir as RtTrackdir)
        if (reverseKey !== starts[0]![0]) starts.push([reverseKey, penalty])
    }

    const found = search(map, graph, starts, target, searchBudget, tickBudget)
    const route = found.path.map(node => (node % RAIL_STRIDE) as RtTrackdir)
    let goal: number = RT_NONE
    if (found.outcome === RtRouteOutcome.found) {
        const end = found.path.length > 0 ? found.path[found.path.length - 1]! : found.start
        goal = (end / RAIL_STRIDE) | 0
        extendThroughGoals(map, owner, sharing, end, goals, route)
    }
    const cap = RT_CATALOG.caps.maxRouteLength
    if (route.length > cap) route.length = cap
    return {
        outcome: found.outcome,
        route,
        cost: found.cost,
        nodes: found.nodes,
        reverse: found.outcome !== RtRouteOutcome.deferred && found.start === reverseKey,
        lost: found.outcome === RtRouteOutcome.notFound,
        goal
    }
}

/** Runs a found route on to the far end of the goal tiles it reached (a platform's end, a spot's dead end). */
function extendThroughGoals(map: RtMap, owner: number, sharing: boolean, end: number, goals: Set<number>, route: RtTrackdir[]): void {
    const used = new Set<number>([(end / RAIL_STRIDE) | 0])
    let tile = (end / RAIL_STRIDE) | 0
    let td = (end % RAIL_STRIDE) as RtTrackdir
    for (;;) {
        const exit = rtTrackdirExitDir(td)
        const options = followTrack(map, tile, exit, owner, sharing)
        const next = map.neighbour(tile, exit)
        if (options === 0 || !goals.has(next) || used.has(next)) return
        let pick = -1
        for (let nextTd = 0; nextTd < RT_TRACKDIR_END; nextTd++) {
            if ((options & (1 << nextTd)) !== 0 && !rtOneWayBlocked(map, next, nextTd)) {
                pick = nextTd
                break
            }
        }
        if (pick < 0) return
        used.add(next)
        route.push(pick as RtTrackdir)
        tile = next
        td = pick as RtTrackdir
    }
}

/* ------------------------------------------------------------------------------------------
 * Road
 * ---------------------------------------------------------------------------------------- */

/**
 * Cost of turning around in place on a road tile that leads on; a dead end costs no extra.
 * The catalog has no entry for it; it is set to the cost of the sharpest rail curve.
 */
export const RT_ROAD_TURN_AROUND_PENALTY = RT_CATALOG.pathfinder.curve90Penalty

export interface RtRoadRouteResult {
    outcome: RtRouteOutcome
    /**
     * For each tile after the start, the direction (RtDir) the vehicle leaves it by (on the goal tile,
     * the way it drives through or into it). When turnAround is set the vehicle first turns on its tile.
     */
    route: RtDir[]
    cost: number
    nodes: number
    /** The best route begins by turning around on the start tile. */
    turnAround: boolean
    lost: boolean
    goal: number
}

const ROAD_STRIDE = 4

/**
 * Road bits a road vehicle can use on a tile: a road's bits whoever owns it, a level crossing's
 * straight, a drive-through stop's straight; a road depot's entrance and a bay stop's entrance only
 * when it is a goal or the start, so neither is ever a way through; nothing else.
 */
function roadBitsAt(map: RtMap, tile: number, goals: Set<number>, start: number): number {
    // a bay and a road depot are entered only as the search's start or goal
    const bound = goals.has(tile) || tile === start
    const payload = map.payload[tile]!
    if (rtBayFacingAt(map, tile) >= 0) return bound ? rtRoadStopBits(payload) : 0
    if (map.kind[tile] !== RtTileKind.depot) return rtDrivableRoadBits(map, tile)
    if (rtDepotKind(payload) !== RtVehicleKind.road || !bound) return 0
    return RT_ROAD_DIR_BIT[rtDepotFacing(payload)]!
}

/**
 * The cheapest road route from a vehicle on `fromTile` heading `fromDir` (the edge it will
 * leave by) to `target`. Each tile costs tileCost, plus roadCurvePenalty for a turn,
 * roadSlopePenalty for a climb, roadCrossingPenalty for a level crossing and roadStopPenalty for a
 * road stop that is no goal. A vehicle may turn around in place on any tile at
 * RT_ROAD_TURN_AROUND_PENALTY, free at a dead end, including on its start tile. Roads are
 * public, as the original: any company's road and drive-through stop can be driven. A bay stop is
 * entered only through its entrance and only as a goal; a vehicle standing in one leaves by its
 * entrance whatever its fromDir (the lane of its bay). Same heap,
 * budgets and outcomes as findRailRoute. Never throws.
 */
export function findRoadRoute(
    map: RtMap, fromTile: number, fromDir: number, target: RtRouteTarget, searchBudget: number, tickBudget: number
): RtRoadRouteResult {
    if (!map.validTile(fromTile) || !Number.isInteger(fromDir) || fromDir < 0 || fromDir > 3 || !target || !Array.isArray(target.tiles)) {
        return { outcome: RtRouteOutcome.notFound, route: [], cost: 0, nodes: 0, turnAround: false, lost: true, goal: RT_NONE }
    }
    const p = RT_CATALOG.pathfinder
    const goals = new Set(target.tiles.filter(t => map.validTile(t)))
    const goalList = [...goals]
    const bitOf = (dir: number) => RT_ROAD_DIR_BIT[dir]!

    const graph: RtGraph = {
        stride: ROAD_STRIDE,
        isGoal: node => {
            const tile = (node / ROAD_STRIDE) | 0
            return goals.has(tile) && (!target.accept || target.accept(tile, node % ROAD_STRIDE))
        },
        estimate: tile => manhattanTo(map, tile, goalList) * p.tileCost,
        expand(node, visit) {
            const tile = (node / ROAD_STRIDE) | 0
            const dir = (node % ROAD_STRIDE) as RtDir
            if ((roadBitsAt(map, tile, goals, fromTile) & bitOf(dir)) === 0) return
            const next = map.neighbour(tile, dir)
            if (next < 0) return
            const bits = roadBitsAt(map, next, goals, fromTile)
            const back = rtReverseDir(dir)
            if ((bits & bitOf(back)) === 0) return
            const deadEnd = bits === bitOf(back)
            const kind = map.kind[next]
            for (let exit = 0; exit < 4; exit++) {
                if ((bits & bitOf(exit)) === 0) continue
                let cost = p.tileCost
                if (exit === back) {
                    if (!deadEnd) cost += RT_ROAD_TURN_AROUND_PENALTY
                } else {
                    if (exit !== dir) cost += p.roadCurvePenalty
                    if (climbs(map, next, back, exit as RtDir)) cost += p.roadSlopePenalty
                }
                if (kind === RtTileKind.rail) cost += p.roadCrossingPenalty
                if (kind === RtTileKind.station && !goals.has(next)) cost += p.roadStopPenalty
                visit(next * ROAD_STRIDE + exit, cost)
            }
        }
    }

    const startBits = roadBitsAt(map, fromTile, goals, fromTile)
    // a vehicle in a bay holds the lane of its bay; it leaves by the entrance whichever bay it is in
    const exit = rtRoadLaneExit(map, fromTile, fromDir)
    const forward = fromTile * ROAD_STRIDE + exit
    const turned = fromTile * ROAD_STRIDE + rtReverseDir(exit as RtDir)
    const turnCost = (startBits & bitOf(exit)) === 0 ? 0 : RT_ROAD_TURN_AROUND_PENALTY
    const found = search(map, graph, [[forward, 0], [turned, turnCost]], target, searchBudget, tickBudget)
    const route = found.path.map(node => (node % ROAD_STRIDE) as RtDir)
    const cap = RT_CATALOG.caps.maxRouteLength
    if (route.length > cap) route.length = cap
    let goal: number = RT_NONE
    if (found.outcome === RtRouteOutcome.found) {
        const end = found.path.length > 0 ? found.path[found.path.length - 1]! : found.start
        goal = (end / ROAD_STRIDE) | 0
    }
    return {
        outcome: found.outcome,
        route,
        cost: found.cost,
        nodes: found.nodes,
        turnAround: found.outcome !== RtRouteOutcome.deferred && found.start === turned,
        lost: found.outcome === RtRouteOutcome.notFound,
        goal
    }
}
