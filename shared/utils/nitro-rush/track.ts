import { compileGraph, progressOn, type BranchEnd, type BranchLink, type CourseGraph, type Cushion, type Route, type RouteLeg } from './track-graph'
import { racingLine, type RacingLine } from './racing-line'
import { KICKER_GRADE, newProjection, SPEED_CEILING, TrackLine, wallFoot, type LineDef, type Projection, type TrackGroup } from './track-line'

export * from './track-line'
export { MAX_ROUTES, TrackGraphError, type BranchEnd, type Cushion, type Route, type RouteLeg } from './track-graph'

/**
 * A course: its main line, and where the road forks, a line per branch. Loops and sprints
 * both fork; every branch leaves other road and either joins road again or, on a sprint,
 * runs to a finish of its own. A course with no branches is the one line it always was,
 * and every method here falls straight through to it.
 *
 * The course is its main line too (`branches[0] === this`), so everything that only knows
 * about one line (the meshes, the builder) keeps working on the main line.
 */

/** A branch of a forked course: its own line, which leaves `from` and ends at `to`. */
export interface BranchDef {
    points: [number, number][]
    heights?: number[]
    halfWidths?: number[]
    ups?: [number, number, number][]
    rails?: [number, number][]
    gaps?: [number, number][]
    boosts?: LineDef['boosts']
    /** Distance along the branch of each checkpoint. */
    checkpoints?: number[]
    from: BranchEnd
    /** The road it joins, or `'finish'` for a sprint's other finish, `runOff` short of its far end. */
    to: BranchEnd | 'finish'
    runOff?: number
}

export interface TrackDef extends LineDef {
    id: string
    name: string
    group: TrackGroup
    /** Left out on a course that never forks. */
    branches?: BranchDef[]
}

/** A line the lap timer counts the car across. */
export interface LapLine {
    kind: 'start' | 'finish' | 'checkpoint'
    /** The checkpoint's id; -1 for a start or finish. */
    id: number
    branch: number
    s: number
    x: number
    y: number
    z: number
    /** The road's direction across the line: crossing along it is forward. */
    tx: number
    tz: number
    /** From the centre out to either end of the line: the walls' outer foot. */
    reach: number
}

/** A place on the road: its line and the distance along it. */
export interface RoadSpot {
    line: TrackLine
    s: number
}

/** Metres nearer the other road a car on a shared deck has to be before it counts as on it, so it doesn't flicker between them. */
const DECK_HYSTERESIS = 1.5
/** Past this many checkpoints the minimum lap stops tracking which were touched, which only makes it more lenient. */
const MIN_LAP_CHECKPOINTS = 12
/** As the physics has it, for how far a kicker can throw the car. */
const GRAVITY = 9.81
/** Metres of height a flight's reach allows for: pose rounding, and a car landing a touch above the road. */
const LANDING_SLACK = 1

export class Track extends TrackLine {
    declare readonly def: TrackDef
    /** Every line of the course, by branch; the main line first. */
    readonly branches: readonly TrackLine[]
    /** Where each branch leaves and goes; undefined for the main line. */
    readonly links: readonly (BranchLink | undefined)[]
    /** Each line's checkpoints' ids: the main line's first, in order, then each branch's. */
    readonly checkpointIds: readonly (readonly number[])[]
    readonly checkpointCount: number
    readonly graph: CourseGraph
    /** Every line the lap timer counts. */
    readonly lapLines: readonly LapLine[]
    private readonly scratch = newProjection()
    private readonly spot: RoadSpot = { line: this, s: 0 }
    private readonly racingRoutes = new Map<Route, RacingLine[]>()
    private minLap: number | null = null

    constructor(def: TrackDef) {
        super(def, 0)
        const lines: TrackLine[] = [this]
        const links: (BranchLink | undefined)[] = [undefined]
        for (const b of def.branches ?? []) {
            const { from, to, ...road } = b
            lines.push(new TrackLine({ ...road, halfWidth: def.halfWidth, wallOffset: def.wallOffset, closed: false, runUp: 0, runOff: to === 'finish' ? b.runOff : 0 }, lines.length))
            links.push({ from, to })
        }
        this.branches = lines
        this.links = links
        let next = 0
        this.checkpointIds = lines.map(line => line.checkpoints.map(() => next++))
        this.checkpointCount = next
        this.graph = compileGraph(lines, links, this.checkpointIds)
        for (const line of lines) line.peers = lines
        this.lapLines = this.findLapLines()
    }

    /** The fewest checkpoints on any route: a lap counts once the car has touched this many. */
    get k() {
        return this.graph.k
    }

    get routes(): readonly Route[] {
        return this.graph.routes
    }

    get cushions(): readonly Cushion[] {
        return this.graph.cushions
    }

    get forked() {
        return this.branches.length > 1
    }

    /** True when any line of the course leaves the ground. */
    get anyElevated() {
        return this.branches.some(l => l.elevated)
    }

    /** How far through the lap (branch, s) is, 0 at the start to 1 at a finish; for respawns, ranking and the ghost check, not laps. */
    progressAt(branch: number, s: number) {
        return progressOn(this.graph, branch, s)
    }

    /** The line at (branch, s): a finish there, or the checkpoint with that id. */
    private findLapLines(): LapLine[] {
        const out: LapLine[] = []
        const add = (kind: LapLine['kind'], id: number, line: TrackLine, s: number) => {
            const p = line.pointAt(s)
            out.push({ kind, id, branch: line.branch, s, x: p.x, y: p.y, z: p.z, tx: p.tx, tz: p.tz, reach: wallFoot(line.wallAt(s)) })
        }
        add('start', -1, this, this.startS)
        if (!this.closed) add('finish', -1, this, this.finishS)
        this.branches.forEach((line, b) => {
            line.checkpoints.forEach((s, i) => add('checkpoint', this.checkpointIds[b]![i]!, line, s))
            if (b > 0 && this.links[b]!.to === 'finish') add('finish', -1, line, line.finishS)
        })
        return out
    }

    /**
     * Where (x, z) is on the road, searched from the car's last `branch` and `seg`, into `out`.
     * Past the end of a branch it carries on onto the road it meets; on a shared deck the car
     * changes road once it's clearly nearer the other one, or past where its own wall would be.
     */
    locate(x: number, z: number, branch: number, seg: number, out: Projection = newProjection(), y = Number.NaN): Projection {
        if (!this.forked) return this.project(x, z, seg, out, y)
        let line = this.branches[branch] ?? this
        let d = seg >= 0 ? line.projectNear(x, z, seg, out) : Infinity
        for (let hop = 0; hop < 2 && Number.isFinite(d); hop++) {
            const link = this.links[line.branch]
            if (!link) break
            let at: number
            let next: number
            if (out.s < 0) {
                next = link.from.branch
                at = link.from.at + out.s
            } else if (out.s > line.length && link.to !== 'finish') {
                next = link.to.branch
                at = link.to.at + out.s - line.length
            } else break
            line = this.branches[next]!
            d = line.projectNear(x, z, line.segmentAt(at), out)
        }
        if (!line.trusts(d, out)) return this.nearest(x, z, out, y)
        const open = line.openAt(out.s, out.lateral < 0 ? -1 : 1)
        if (open) {
            const partner = this.branches[open.partner]!
            const q = this.scratch
            const dq = partner.projectNear(x, z, partner.segmentAt(open.partnerFrom + out.s - open.from), q)
            const past = Math.abs(out.lateral) > line.wallAt(out.s)
            if (partner.trusts(dq, q) && (past || Math.abs(q.lateral) + DECK_HYSTERESIS < Math.abs(out.lateral))) Object.assign(out, q)
        }
        return out
    }

    /** The nearest road on any line, `y` picking between stacked ones. */
    nearest(x: number, z: number, out: Projection = newProjection(), y = Number.NaN) {
        let best = Infinity
        for (const line of this.branches) {
            const score = line.projectAll(x, z, this.scratch, y)
            if (score < best) {
                best = score
                Object.assign(out, this.scratch)
            }
        }
        return out
    }

    /** The highest road on any line under (x, z) and no higher than `y`, into `out`: what a falling car lands on. */
    landing(x: number, y: number, z: number, out: Projection): boolean {
        if (!this.forked) return this.roadUnder(x, y, z, out)
        let top = -Infinity
        for (const line of this.branches) for (let i = 0; i < line.segments; i++) top = line.underSegment(i, x, y, z, top, out)
        return top > -Infinity
    }

    /**
     * The racing line on `branch` as `route` drives it: worked out along the whole route, so it sets up for the
     * branch it takes at a fork. Without a route, or on a course without forks, the line's own.
     */
    racingOn(route: Route | null, branch: number): RacingLine {
        const line = this.branches[branch]!
        if (!route || !this.forked) return line.racing
        let lines = this.racingRoutes.get(route)
        if (!lines) {
            lines = this.racingAlong(route)
            this.racingRoutes.set(route, lines)
        }
        return lines[branch]!
    }

    /** The racing line along `route`, cut back into each line's points; a sprint's runs past its start and finish lines included. */
    private racingAlong(route: Route): RacingLine[] {
        const { legs } = route
        // Each point, and the roads either side of its leg, which the car crosses onto once on its way.
        const points: [TrackLine, number, number[]][] = []
        legs.forEach((leg, k) => {
            const line = this.branches[leg.branch]!
            const from = k === 0 && !this.closed ? 0 : leg.from
            const to = k === legs.length - 1 && !this.closed ? line.length : leg.to
            const at = (j: number) => legs[this.closed ? (j + legs.length) % legs.length : j]?.branch
            const onto = [at(k - 1), at(k + 1)].filter(b => b !== undefined)
            for (let i = 0; i < line.n; i++) {
                if (line.cum[i]! < from - 1e-6 || line.cum[i]! > to + 1e-6) continue
                // Where one leg hands over to the next, both lines have a point on the same spot.
                const last = points[points.length - 1]
                if (last && Math.hypot(last[0].xs[last[1]]! - line.xs[i]!, last[0].zs[last[1]]! - line.zs[i]!) < 0.5) continue
                points.push([line, i, onto])
            }
        })
        if (this.closed && points.length > 1) {
            const [a, i] = points[0]!
            const [b, j] = points[points.length - 1]!
            if (Math.hypot(a.xs[i]! - b.xs[j]!, a.zs[i]! - b.zs[j]!) < 0.5) points.pop()
        }
        const pick = (f: (line: TrackLine, i: number, onto: number[]) => number) => Float64Array.from(points, ([line, i, onto]) => f(line, i, onto))
        const along = racingLine({
            n: points.length,
            closed: this.closed,
            xs: pick((l, i) => l.xs[i]!),
            zs: pick((l, i) => l.zs[i]!),
            txs: pick((l, i) => l.txs[i]!),
            tzs: pick((l, i) => l.tzs[i]!),
            left: pick((l, i, onto) => l.reachAt(i, -1, onto)),
            right: pick((l, i, onto) => l.reachAt(i, 1, onto)),
            railed: pick((l, i) => l.railed[i]!)
        })
        // Off the route the bot only strays for a moment, so the road's own centreline does there.
        const lines = this.branches.map(l => ({ offsets: new Float64Array(l.n), curvature: l.curvature.slice() }))
        points.forEach(([line, i], k) => {
            lines[line.branch]!.offsets[i] = along.offsets[k]!
            lines[line.branch]!.curvature[i] = along.curvature[k]!
        })
        return lines
    }

    /**
     * The road `d` metres on from (branch, s), following `route` where the car is on it and
     * the road's own way on where it isn't. Valid until the next call.
     */
    ahead(route: Route | null, branch: number, s: number, d: number): RoadSpot {
        const out = this.spot
        if (!this.forked) {
            out.line = this
            out.s = s + d
            return out
        }
        const legs = route?.legs ?? []
        let i = legs.findIndex(l => l.branch === branch && s >= l.from - 1e-6 && s <= l.to + 1e-6)
        let at = s + d
        if (i < 0) {
            let line = this.branches[branch] ?? this
            for (let hop = 0; hop < 4; hop++) {
                const link = this.links[line.branch]
                if (!link || link.to === 'finish' || at <= line.length) break
                at = link.to.at + at - line.length
                line = this.branches[link.to.branch]!
            }
            out.line = line
            out.s = at
            return out
        }
        for (let hop = 0; hop < legs.length * 2; hop++) {
            const leg = legs[i]!
            if (at <= leg.to) break
            const next = i + 1 < legs.length ? i + 1 : this.closed ? 0 : -1
            if (next < 0) break
            at = legs[next]!.from + at - leg.to
            i = next
        }
        out.line = this.branches[legs[i]!.branch]!
        out.s = at
        return out
    }

    /** Where a car at `p` (and x, z) is on `route`: on its own line, or across a shared deck on the route's road. */
    onRoute(route: Route | null, p: Projection, x: number, z: number): { branch: number, s: number } {
        if (!route || !this.forked) return { branch: p.branch, s: p.s }
        const on = (b: number, s: number) => route.legs.some(l => l.branch === b && s >= l.from - 1e-6 && s <= l.to + 1e-6)
        if (on(p.branch, p.s)) return { branch: p.branch, s: p.s }
        const line = this.branches[p.branch]!
        for (const side of [-1, 1]) {
            const open = line.openAt(p.s, side)
            if (!open) continue
            const partner = this.branches[open.partner]!
            partner.projectNear(x, z, partner.segmentAt(open.partnerFrom + p.s - open.from), this.scratch)
            if (on(open.partner, this.scratch.s)) return { branch: open.partner, s: this.scratch.s }
        }
        return { branch: p.branch, s: p.s }
    }

    /**
     * The road `by` metres back from (branch, s), and the stretches driven back over to reach it,
     * each from its later end to its earlier one. Off the start of a branch it carries on back down
     * the road it left; `floor` stops it on an open main line.
     */
    back(branch: number, s: number, by: number, floor = -Infinity): { branch: number, s: number, legs: RouteLeg[] } {
        const legs: RouteLeg[] = []
        let b = branch
        let at = s
        let left = by
        for (let hop = 0; hop < this.branches.length + 1; hop++) {
            const link = this.links[b]
            if (!link || at - left >= 0) {
                const to = link ? at - left : Math.max(floor, at - left)
                legs.push({ branch: b, from: at, to })
                return { branch: b, s: this.branches[b]!.wrapS(to), legs }
            }
            legs.push({ branch: b, from: at, to: 0 })
            left -= at
            b = link.from.branch
            at = link.from.at
        }
        return { branch: b, s: at, legs }
    }

    /**
     * The least time any lap can take at the speed ceiling: the shortest way round from the start
     * through at least K checkpoints to a finish, along the road and, off a jump's lip, flying
     * ahead as far as a kicker throws it. Walls keep a car on the ground on its road, so only a lip lets it leave.
     */
    get minLapSeconds() {
        if (!this.forked && !this.gaps.length) return this.lapLength / SPEED_CEILING
        this.minLap ??= this.shortestLap() / SPEED_CEILING
        return this.minLap
    }

    private shortestLap() {
        const g = this.graph
        interface Point { x: number, y: number, z: number, tx: number, tz: number, bit: number }
        const points: Point[] = []
        const vertexPoint = new Map<number, number>()
        const node = (line: TrackLine, s: number, bit = -1) => {
            const q = line.pointAt(s)
            return points.push({ x: q.x, y: q.y, z: q.z, tx: q.tx, tz: q.tz, bit }) - 1
        }
        const counted = this.checkpointCount <= MIN_LAP_CHECKPOINTS
        /** Road between neighbouring points on a line, `a` before `b`; a gap's only drives forward. */
        const stretches: { line: TrackLine, s0: number, s1: number, a: number, b: number, gap: boolean }[] = []
        // Only a jump's lip: a flight backward off a landing ramp needs a turn round the search can't see, so it priced laps far too short.
        const lips: { p: number, tx: number, tz: number }[] = []
        this.branches.forEach((line, b) => {
            const marks: { s: number, p: number, gap?: number }[] = []
            g.vertexMarks.forEach((list, v) => {
                for (const m of list) {
                    if (m.branch !== b) continue
                    if (!vertexPoint.has(v)) vertexPoint.set(v, node(line, m.at))
                    marks.push({ s: m.at, p: vertexPoint.get(v)! })
                }
            })
            line.checkpoints.forEach((s, i) => marks.push({ s, p: node(line, s, counted ? this.checkpointIds[b]![i]! : -1) }))
            line.gaps.forEach(([a, c], i) => {
                const pa = node(line, a)
                const pc = node(line, c)
                marks.push({ s: a, p: pa, gap: i }, { s: c, p: pc, gap: i })
                lips.push({ p: pa, tx: points[pa]!.tx, tz: points[pa]!.tz })
            })
            marks.sort((p, q) => p.s - q.s)
            for (let i = 0; i + 1 < marks.length; i++) {
                const m = marks[i]!
                const n = marks[i + 1]!
                stretches.push({ line, s0: m.s, s1: n.s, a: m.p, b: n.p, gap: m.gap !== undefined && m.gap === n.gap })
            }
        })
        const ends = new Set(g.ends.map(v => vertexPoint.get(v)!))
        const edges: { to: number, d: number }[][] = points.map(() => [])
        for (const r of stretches) {
            edges[r.a]!.push({ to: r.b, d: r.s1 - r.s0 })
            // Driving backward never finishes a lap.
            if (!r.gap && !ends.has(r.a)) edges[r.b]!.push({ to: r.a, d: r.s1 - r.s0 })
        }
        // A flight comes down on road ahead of its lip in a kicker's reach at the speed ceiling, then drives to either end of that stretch.
        const lift = SPEED_CEILING * KICKER_GRADE
        for (const lip of lips) {
            const from = points[lip.p]!
            const reach = new Map<number, number>()
            const offer = (p: number, d: number) => {
                if (p !== lip.p && d < (reach.get(p) ?? Infinity)) reach.set(p, d)
            }
            for (const r of stretches) {
                if (r.gap) continue
                const land = this.flightLands(r.line, r.s0, r.s1, from, lip.tx, lip.tz, lift)
                if (!land) continue
                // Driving backward never finishes a lap, and a flight onto the road before a finish has to be heading over it.
                if (!ends.has(r.a)) offer(r.a, land.a)
                if (!ends.has(r.b) || lip.tx * points[r.b]!.tx + lip.tz * points[r.b]!.tz > 0) offer(r.b, land.b)
            }
            for (const [to, d] of reach) edges[lip.p]!.push({ to, d })
        }
        const start = vertexPoint.get(g.start)!
        const need = counted ? this.k : 0
        const masks = counted ? 1 << this.checkpointCount : 1
        const best = new Float64Array(points.length * masks).fill(Infinity)
        const bitsOf = (m: number) => {
            let c = 0
            for (let v = m; v; v &= v - 1) c++
            return c
        }
        // Dijkstra over (point, checkpoints touched), with a binary heap.
        const heap: [number, number][] = []
        const push = (d: number, key: number) => {
            heap.push([d, key])
            let i = heap.length - 1
            while (i > 0) {
                const up = (i - 1) >> 1
                if (heap[up]![0] <= heap[i]![0]) break
                ;[heap[up], heap[i]] = [heap[i]!, heap[up]!]
                i = up
            }
        }
        const pop = () => {
            const top = heap[0]!
            const last = heap.pop()!
            if (heap.length) {
                heap[0] = last
                let i = 0
                for (;;) {
                    const l = i * 2 + 1
                    const r = l + 1
                    let m = i
                    if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l
                    if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r
                    if (m === i) break
                    ;[heap[m], heap[i]] = [heap[i]!, heap[m]!]
                    i = m
                }
            }
            return top
        }
        best[start * masks] = 0
        push(0, start * masks)
        while (heap.length) {
            const [d, key] = pop()
            if (d > best[key]!) continue
            const p = Math.floor(key / masks)
            const mask = key % masks
            if (ends.has(p) && p !== start && bitsOf(mask) >= need) return d
            for (const e of edges[p]!) {
                const bit = points[e.to]!.bit
                const m = bit >= 0 ? mask | (1 << bit) : mask
                const k = e.to * masks + m
                if (d + e.d < best[k]!) {
                    best[k] = d + e.d
                    push(d + e.d, k)
                }
            }
        }
        return 0
    }

    /** The shortest flight off a lip at `from` heading (tx, tz) onto `line` between `s0` and `s1`, then along the road to each end; null when it can't come down there. */
    private flightLands(line: TrackLine, s0: number, s1: number, from: { x: number, y: number, z: number }, tx: number, tz: number, lift: number) {
        const { xs, ys, zs, cum, walls, n } = line
        let a = Infinity
        let b = Infinity
        for (let i = line.segmentAt(s0); i <= line.segments && cum[i]! <= s1; i++) {
            const s = cum[i]!
            if (s < s0 || line.gapAt(s)) continue
            const j = i % n
            const dx = xs[j]! - from.x
            const dz = zs[j]! - from.z
            // The car can come down anywhere out to the walls' foot, so measure to the road's near edge.
            const foot = wallFoot(walls[j]!)
            if (dx * tx + dz * tz <= -foot) continue
            const fall = lift * lift + 2 * GRAVITY * (from.y - ys[j]! + LANDING_SLACK)
            const flight = Math.max(0, Math.hypot(dx, dz) - foot)
            if (fall < 0 || flight > SPEED_CEILING * (lift + Math.sqrt(fall)) / GRAVITY) continue
            a = Math.min(a, flight + s - s0)
            b = Math.min(b, flight + s1 - s)
        }
        return a < Infinity ? { a, b } : null
    }
}
