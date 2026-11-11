import { newProjection, newTrackPoint, type OpenSide, type TrackLine } from './track-line'

/**
 * How a forked course's lines fit together: where each branch leaves and meets other road,
 * the routes through it, the fewest checkpoints any route drives, the progress mapping and
 * the shared decks at forks and joins.
 *
 * Vertices are the points where roads meet (the start, forks, joins, finishes); edges are the
 * stretches of a line between two of them, in driving order. A loop is cut at its start line, so
 * its graph runs from the start (`s` 0 on the main line) to the end (`s` = its length), and every
 * route of a lap is a path between the two.
 */

/** The builder caps a course's routes so the medal bot's runs stay bounded. */
export const MAX_ROUTES = 16
/** Metres between a branch's end and the road it meets, and the radians their headings may differ by. */
const ATTACH_TOLERANCE = 0.05
const ATTACH_ANGLE = 0.02
/** Metres a fork's roads may differ in height over the deck they share. */
const DECK_LEVEL = 0.3
/** Metres a fork's roads are followed to find where they part. */
const DECK_SEARCH = 400
const DECK_STEP = 1
/** Offset at which a road counts as having moved off to one side of the other. */
const DECK_PARTED = 0.5
/** A bend tighter than this radius counts as tight when picking the medal bot's routes. */
const TIGHT_RADIUS = 60

export class TrackGraphError extends Error {
    constructor(readonly reason: string) {
        super(reason)
        this.name = 'TrackGraphError'
    }
}

/** A point on a line: its branch and distance along it. */
export interface BranchEnd {
    branch: number
    at: number
}

/** Where a branch comes from, and where it goes: other road, or a sprint's own finish. */
export interface BranchLink {
    from: BranchEnd
    to: BranchEnd | 'finish'
}

export interface RouteLeg {
    branch: number
    from: number
    to: number
}

/** One way round a lap or down a sprint: one choice at every fork. */
export interface Route {
    legs: readonly RouteLeg[]
    /** Metres from the start line to the finish (or back to the start). */
    length: number
    /** Ids of the checkpoints it drives through. */
    checkpoints: readonly number[]
    /** Runs of road tighter than `TIGHT_RADIUS`. */
    bends: number
}

/** A point where a fork's inner walls meet (a nose) or a join's end (a tail): a crash cushion. */
export interface Cushion {
    x: number
    y: number
    z: number
}

interface Vertex {
    kind: 'start' | 'end' | 'finish' | 'node'
    /** Where it sits on each line it's on. */
    marks: BranchEnd[]
}

export interface GraphEdge {
    from: number
    to: number
    branch: number
    s0: number
    s1: number
}

export interface CourseGraph {
    vertexCount: number
    /** The vertex's place on each line it's on. */
    vertexMarks: readonly (readonly BranchEnd[])[]
    edges: readonly GraphEdge[]
    /** Each line's edges, in order along it. */
    lineEdges: readonly (readonly GraphEdge[])[]
    start: number
    /** The loop's end, or every finish. */
    ends: readonly number[]
    routes: readonly Route[]
    /** The fewest checkpoints on any route: a lap counts once the car has touched this many. */
    k: number
    /** Each vertex's share of the longest route through it: 0 at the start, 1 at a finish. */
    progress: Float64Array
    cushions: readonly Cushion[]
}

/** Whether a line keeps going past `s` without running out: a loop always does. */
const onLine = (line: TrackLine, s: number) => line.closed || (s >= 0 && s <= line.length)

/**
 * Compiles a course's lines into its graph and opens the walls where branches share a deck.
 * `links[b]` says where branch b (1 up) leaves and goes; `checkpointIds[b]` are line b's checkpoints' ids.
 */
export function compileGraph(lines: readonly TrackLine[], links: readonly (BranchLink | undefined)[], checkpointIds: readonly (readonly number[])[]): CourseGraph {
    const fail = (why: string): never => {
        throw new TrackGraphError(why)
    }
    const main = lines[0]!
    const vertices: Vertex[] = []
    const marks: { s: number, v: number }[][] = lines.map(() => [])
    const add = (kind: Vertex['kind'], branch: number, s: number) => {
        vertices.push({ kind, marks: [{ branch, at: s }] })
        marks[branch]!.push({ s, v: vertices.length - 1 })
        return vertices.length - 1
    }
    const vertexOn = (branch: number, s: number) => marks[branch]!.find(m => Math.abs(m.s - s) < 1e-3)?.v ?? add('node', branch, s)
    const link = (branch: number, s: number, v: number) => {
        marks[branch]!.push({ s, v })
        vertices[v]!.marks.push({ branch, at: s })
    }
    /** The stretch of line `b` that laps are timed on. */
    const timed = (b: number): [number, number] => {
        const line = lines[b]!
        if (b === 0) return line.closed ? [0, line.length] : [line.startS, line.finishS]
        return [0, links[b]?.to === 'finish' ? line.finishS : line.length]
    }

    const start = add('start', 0, main.closed ? 0 : main.startS)
    // A road shorter than its run-up and run-off (a builder draft) puts the finish before the start; it still has to build.
    const ends = [main.closed ? add('end', 0, main.length) : add('finish', 0, Math.max(main.startS, main.finishS))]
    const near = newTrackPoint()
    const atEnd = newTrackPoint()
    for (let b = 1; b < lines.length; b++) {
        const line = lines[b]!
        const l = links[b]
        if (!l) return fail('A branch must fork off a road')
        const placed = (end: BranchEnd, fork: boolean): BranchEnd => {
            const target = lines[end.branch]
            if (!target || end.branch === b) return fail('A branch can\'t fork off or join itself')
            let at = end.at
            // A loop's start line is both 0 and its length along the main line: a fork leaves from 0, a join lands on the length.
            if (end.branch === 0 && target.closed) at = fork ? (at >= target.length - 1e-6 ? 0 : at) : (at <= 1e-6 ? target.length : at)
            const [lo, hi] = timed(end.branch)
            const inside = end.branch === 0 && target.closed ? (fork ? at >= 0 && at < hi : at > 0 && at <= hi) : at > lo + 1 && at < hi - 1
            if (!inside) return fail('Keep forks and joins on timed road, away from branch ends')
            if (!target.plainRoadAt(Math.min(at, target.length - 1e-6))) return fail('Forks and joins need flat, plain road')
            return { branch: end.branch, at }
        }
        const from = placed(l.from, true)
        lines[from.branch]!.pointAt(from.at, near)
        line.pointAt(0, atEnd)
        if (!meets(near, atEnd)) return fail('A branch must start on the road it leaves')
        link(b, 0, vertexOn(from.branch, from.at))
        if (l.to === 'finish') {
            if (main.closed) return fail('Loop branches must rejoin the road')
            ends.push(add('finish', b, line.finishS))
        } else {
            const to = placed(l.to, false)
            lines[to.branch]!.pointAt(to.at, near)
            line.pointAt(line.length, atEnd)
            atEnd.tx = line.txs[line.n - 1]!
            atEnd.tz = line.tzs[line.n - 1]!
            if (!meets(near, atEnd)) return fail('A branch must end on the road it joins')
            link(b, line.length, vertexOn(to.branch, to.at))
        }
    }

    // Edges between neighbouring vertices along each line.
    const edges: GraphEdge[] = []
    const lineEdges: GraphEdge[][] = lines.map(() => [])
    marks.forEach((list, b) => {
        list.sort((p, q) => p.s - q.s)
        for (let i = 0; i + 1 < list.length; i++) {
            const e = { from: list[i]!.v, to: list[i + 1]!.v, branch: b, s0: list[i]!.s, s1: list[i + 1]!.s }
            edges.push(e)
            lineEdges[b]!.push(e)
        }
    })
    const outs: GraphEdge[][] = vertices.map(() => [])
    const ins: GraphEdge[][] = vertices.map(() => [])
    for (const e of edges) {
        outs[e.from]!.push(e)
        ins[e.to]!.push(e)
    }
    if (vertices.some((_, v) => outs[v]!.length > 2 || ins[v]!.length > 2)) fail('Only two roads can meet here')

    // Every route runs one way, so the graph cut at the start line has no cycles.
    const order: number[] = []
    const waiting = vertices.map((_, v) => ins[v]!.length)
    const ready = vertices.map((_, v) => v).filter(v => waiting[v] === 0)
    while (ready.length) {
        const v = ready.pop()!
        order.push(v)
        for (const e of outs[v]!) if (--waiting[e.to]! === 0) ready.push(e.to)
    }
    if (order.length < vertices.length) fail('A branch can\'t rejoin before its fork')
    const isEnd = (v: number) => ends.includes(v)
    // Reached from the start, and leading to the end.
    const reached = new Uint8Array(vertices.length)
    reached[start] = 1
    for (const v of order) if (reached[v]) for (const e of outs[v]!) reached[e.to] = 1
    const leads = new Uint8Array(vertices.length)
    for (const v of [...order].reverse()) if (isEnd(v) || outs[v]!.some(e => leads[e.to])) leads[v] = 1
    if (vertices.some((_, v) => !reached[v] || !leads[v])) fail(main.closed ? 'Every branch must lead back to the start' : 'Every branch must reach a finish')

    // Longest distances to and from each vertex: its progress is its share of the longest route through it.
    const into = new Float64Array(vertices.length)
    const onward = new Float64Array(vertices.length)
    for (const v of order) for (const e of outs[v]!) into[e.to] = Math.max(into[e.to]!, into[v]! + e.s1 - e.s0)
    for (const v of [...order].reverse()) for (const e of outs[v]!) onward[v] = Math.max(onward[v]!, onward[e.to]! + e.s1 - e.s0)
    const progress = new Float64Array(vertices.length).map((_, v) => into[v]! + onward[v]! > 0 ? into[v]! / (into[v]! + onward[v]!) : 0)

    const routes = findRoutes(lines, start, isEnd, outs, checkpointIds, fail)
    const k = Math.min(...routes.map(r => r.checkpoints.length))

    const open: OpenSide[][] = lines.map(() => [])
    const cushions: Cushion[] = []
    vertices.forEach((_, v) => {
        const [a, c] = outs[v]!
        if (a && c) shareDeck(lines, a.branch, a.s0, c.branch, c.s0, 1, open, cushions, fail)
        const [p, q] = ins[v]!
        if (p && q) shareDeck(lines, p.branch, p.s1, q.branch, q.s1, -1, open, cushions, fail)
    })
    lines.forEach((line, b) => {
        line.open = open[b]!
    })
    for (let b = 1; b < lines.length; b++) {
        const line = lines[b]!
        line.barrierStart = false
        line.barrierEnd = links[b]?.to === 'finish'
    }

    return {
        vertexCount: vertices.length,
        vertexMarks: vertices.map(v => v.marks),
        edges,
        lineEdges,
        start,
        ends,
        routes,
        k,
        progress,
        cushions
    }
}

/** Two points of road in the same place, heading the same way. */
function meets(a: { x: number, y: number, z: number, tx: number, tz: number }, b: typeof a) {
    return Math.hypot(a.x - b.x, a.z - b.z) <= ATTACH_TOLERANCE && Math.abs(a.y - b.y) <= ATTACH_TOLERANCE && a.tx * b.tx + a.tz * b.tz >= Math.cos(ATTACH_ANGLE)
}

/** Every route from the start to an end, keeping to the line it's on first so the main line's route comes first. */
function findRoutes(
    lines: readonly TrackLine[],
    start: number,
    isEnd: (v: number) => boolean,
    outs: readonly GraphEdge[][],
    checkpointIds: readonly (readonly number[])[],
    fail: (why: string) => never
): Route[] {
    const routes: Route[] = []
    const path: GraphEdge[] = []
    const walk = (v: number, branch: number) => {
        if (isEnd(v)) {
            if (routes.length >= MAX_ROUTES) fail(`Too many routes (${MAX_ROUTES} max)`)
            routes.push(routeOf(lines, path, checkpointIds))
            return
        }
        const next = [...outs[v]!].sort((a, b) => Number(b.branch === branch) - Number(a.branch === branch))
        for (const e of next) {
            path.push(e)
            walk(e.to, e.branch)
            path.pop()
        }
    }
    walk(start, 0)
    return routes
}

function routeOf(lines: readonly TrackLine[], path: readonly GraphEdge[], checkpointIds: readonly (readonly number[])[]): Route {
    const legs: RouteLeg[] = []
    for (const e of path) {
        const last = legs[legs.length - 1]
        if (last && last.branch === e.branch && Math.abs(last.to - e.s0) < 1e-6) last.to = e.s1
        else legs.push({ branch: e.branch, from: e.s0, to: e.s1 })
    }
    const checkpoints = new Set<number>()
    let bends = 0
    for (const leg of legs) {
        const line = lines[leg.branch]!
        line.checkpoints.forEach((s, i) => {
            if (s >= leg.from && s <= leg.to) checkpoints.add(checkpointIds[leg.branch]![i]!)
        })
        let tight = false
        // Short of the end, which a loop's main line wraps back to its start.
        for (let i = line.segmentAt(leg.from); i <= line.segmentAt(Math.min(leg.to, line.length - 1e-6)); i++) {
            const now = line.curvature[i]! > 1 / TIGHT_RADIUS
            if (now && !tight) bends++
            tight = now
        }
    }
    return { legs, length: legs.reduce((sum, l) => sum + l.to - l.from, 0), checkpoints: [...checkpoints].sort((a, b) => a - b), bends }
}

/**
 * The deck two roads share where they part (`dir` 1, at a fork) or meet (`dir` -1, at a join):
 * each one's inner wall is open from the meeting point to where the inner walls cross, a nose
 * at a fork and a tail at a join, which gets a crash cushion.
 */
function shareDeck(
    lines: readonly TrackLine[],
    xb: number, xs: number, yb: number, ys: number, dir: 1 | -1,
    open: OpenSide[][], cushions: Cushion[], fail: (why: string) => never
) {
    const X = lines[xb]!
    const Y = lines[yb]!
    const p = newProjection()
    const at = newTrackPoint()
    let side = 0
    let prev: { g: number, d: number, x: number, z: number, s: number } | null = null
    let walked = 0
    let nose: { x: number, z: number, y: number, sx: number, sy: number } | null = null
    for (let d = DECK_STEP; d <= DECK_SEARCH; d += DECK_STEP) {
        const sy = ys + dir * d
        const guess = xs + dir * d
        if (!onLine(Y, sy) || !onLine(X, guess)) break
        walked = d
        Y.pointAt(sy, at)
        X.projectNear(at.x, at.z, X.segmentAt(guess), p)
        if (Math.abs(at.y - p.y) > DECK_LEVEL && !side) fail('Forked roads must stay level until they split')
        if (!side) {
            if (Math.abs(p.lateral) < DECK_PARTED) continue
            side = Math.sign(p.lateral)
        }
        // Y's inner wall, on the side that faces X.
        const wall = Y.wallAt(sy)
        const wx = at.x + side * wall * at.tz
        const wz = at.z - side * wall * at.tx
        X.projectNear(wx, wz, X.segmentAt(guess), p)
        const g = side * p.lateral - X.wallAt(p.s)
        if (g >= 0) {
            const f = prev ? -prev.g / (g - prev.g) : 1
            const lerp = (a: number, b: number) => a + (b - a) * f
            const nx = prev ? lerp(prev.x, wx) : wx
            const nz = prev ? lerp(prev.z, wz) : wz
            nose = { x: nx, z: nz, y: p.y, sx: prev ? lerp(prev.s, p.s) : p.s, sy: ys + dir * (prev ? lerp(prev.d, d) : d) }
            break
        }
        if (Math.abs(at.y - p.y) > DECK_LEVEL) fail('Forked roads must stay level until they split')
        prev = { g, d, x: wx, z: wz, s: p.s }
    }
    if (!side) return fail('A branch must split away from its road')
    const sx = nose ? nose.sx : xs + dir * walked
    const sy = nose ? nose.sy : ys + dir * walked
    const span = (a: number, b: number): [number, number] => dir > 0 ? [a, b] : [b, a]
    const [xFrom, xTo] = span(xs, sx)
    const [yFrom, yTo] = span(ys, sy)
    open[xb]!.push({ side: side as 1 | -1, from: xFrom, to: xTo, partner: yb, partnerFrom: yFrom, partnerTo: yTo })
    open[yb]!.push({ side: -side as 1 | -1, from: yFrom, to: yTo, partner: xb, partnerFrom: xFrom, partnerTo: xTo })
    if (nose) cushions.push({ x: nose.x, y: nose.y, z: nose.z })
}

/** Progress at `s` along line `b`: rising from 0 at the start to 1 at a finish, spread evenly along each edge. */
export function progressOn(graph: CourseGraph, b: number, s: number) {
    const list = graph.lineEdges[b]
    if (!list?.length) return 0
    const first = list[0]!
    if (s <= first.s0) return graph.progress[first.from]!
    for (const e of list) {
        if (s <= e.s1) return graph.progress[e.from]! + (graph.progress[e.to]! - graph.progress[e.from]!) * (s - e.s0) / (e.s1 - e.s0 || 1)
    }
    return graph.progress[list[list.length - 1]!.to]!
}
