import { compileGraph, progressOn, type BranchEnd, type BranchLink, type CourseGraph, type Cushion, type Route, type RouteLeg } from './track-graph'
import { racingLine, type RacingLine } from './racing-line'
import { newProjection, SPEED_CEILING, TrackLine, wallFoot, type LineDef, type Projection, type TrackGroup } from './track-line'
import { GATE_SPAN, LEVEL_TOLERANCE, type FieldDef, type FieldLineKind } from './field'
import { CourseField, joinedFields } from './track-fields'
import { gridAllowance, shortestLap } from './min-lap'
import { findFarProgress } from './far-line'

export * from './track-line'
export { MAX_ROUTES, TrackGraphError, type BranchEnd, type Cushion, type Route, type RouteLeg } from './track-graph'
export { CourseField, type FieldMark, type FieldPost, type FieldWall } from './track-fields'

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
    onFields?: LineDef['onFields']
    /** Distance along the branch of each checkpoint. */
    checkpoints?: number[]
    requiredCheckpoints?: number[]
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
    /** Left out on a course without fields. */
    fields?: FieldDef[]
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
    /** From the centre out to either end of the line: the walls' outer foot, or a field gate's posts. */
    reach: number
    /** The field a gate stands on; its `branch` and `s` are only its place along the course. */
    field?: number
    /** A checkpoint every lap has to drive. */
    required?: true
}

/** A place on the road: its line and the distance along it. */
export interface RoadSpot {
    line: TrackLine
    s: number
}

/** Metres past either end of a road's crossing that a car on that road may sit and still come onto its field. */
const CROSSING_SLACK = 1
/** Metres above or below a field a car may be and still be found on it. */
const FIELD_LEVEL = 4
/** How far below a car's wheels a field may lie and still be what it comes down on this step, as for road. */
const FIELD_UNDER = 0.05
/** Metres nearer the other road a car on a shared deck has to be before it counts as on it, so it doesn't flicker between them. */
const DECK_HYSTERESIS = 1.5

export class Track extends TrackLine {
    declare readonly def: TrackDef
    /** Every line of the course, by branch; the main line first. */
    readonly branches: readonly TrackLine[]
    /** Where each branch leaves and goes; undefined for the main line. */
    readonly links: readonly (BranchLink | undefined)[]
    /** Each line's checkpoints' ids: the main line's first, in order, then each branch's. */
    readonly checkpointIds: readonly (readonly number[])[]
    /** Each field's gates' ids, numbered on after every line's checkpoints. */
    readonly fieldGateIds: readonly (readonly number[])[]
    readonly checkpointCount: number
    /** Ids of the checkpoints every lap has to drive, in order. */
    readonly requiredIds: readonly number[]
    readonly graph: CourseGraph
    /** The course's fields, by index. */
    readonly fields: readonly CourseField[]
    /** Every line the lap timer counts. */
    readonly lapLines: readonly LapLine[]
    private readonly scratch = newProjection()
    private readonly local = { u: 0, v: 0 }
    private readonly spot: RoadSpot = { line: this, s: 0 }
    private readonly racingRoutes = new Map<Route, RacingLine[]>()
    private minLap: number | null = null
    private far: number | null | undefined

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
        const fields = def.fields ?? []
        this.fields = fields.map((f, i) => new CourseField(f, i, fields))
        for (const field of this.fields) {
            field.crossings = lines.flatMap(line => (line.def.onFields ?? []).filter(o => o.field === field.index)
                .map(({ range: [a, b] }) => ({ branch: line.branch, from: line.cum[a]!, to: line.cum[Math.min(b, line.n)]! })))
        }
        let next = 0
        this.checkpointIds = lines.map(line => line.checkpoints.map(() => next++))
        this.fieldGateIds = this.fields.map(f => f.gates.map(() => next++))
        this.checkpointCount = next
        this.requiredIds = [
            ...lines.flatMap((line, b) => line.checkpoints.flatMap((_, i) => line.required[i] ? [this.checkpointIds[b]![i]!] : [])),
            ...this.fields.flatMap(f => f.gates.flatMap((g, i) => g.required ? [this.fieldGateIds[f.index]![i]!] : []))
        ]
        this.graph = compileGraph(lines, links, this.checkpointIds, fields.map((f, i) => ({ ...f, gates: this.fieldGateIds[i], group: Math.min(...joinedFields(this.fields, i).map(j => j.index)) })), this.requiredIds)
        for (const line of lines) line.peers = lines
        this.lapLines = this.findLapLines()
    }

    /** The fewest checkpoints on any route: a lap counts once the car has touched this many. */
    get k() {
        return this.graph.k
    }

    /** A loop laid only of fields, which no road meets: laps go round them from the start through every gate. */
    get arena() {
        return this.closed && this.fields.length > 0 && this.fields.every(f => !f.mouths.length)
    }

    /** On a loop started on a field, the progress a lap has to have crossed once more one way than the other (`far-line.ts`); null elsewhere. */
    get farProgress() {
        if (this.far === undefined) this.far = findFarProgress(this)
        return this.far
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
        const add = (kind: LapLine['kind'], id: number, line: TrackLine, s: number, required = false) => {
            const p = line.pointAt(s)
            out.push({ kind, id, branch: line.branch, s, x: p.x, y: p.y, z: p.z, tx: p.tx, tz: p.tz, reach: wallFoot(line.wallAt(s)), ...required ? { required: true as const } : {} })
        }
        // A field's start or finish is its gate, on the main road's crossing of it.
        const fieldLine = (kind: FieldLineKind, s: number) => {
            const f = this.fields.find(f => f[kind])
            if (!f) return false
            const g = f[kind]!
            out.push({ kind, id: -1, branch: 0, s, x: g.x, y: f.y, z: g.z, tx: g.dx, tz: g.dz, reach: GATE_SPAN, field: f.index })
            return true
        }
        if (!fieldLine('start', this.startS)) add('start', -1, this, this.startS)
        if (!this.closed && !fieldLine('finish', this.finishS)) add('finish', -1, this, this.finishS)
        this.branches.forEach((line, b) => {
            line.checkpoints.forEach((s, i) => add('checkpoint', this.checkpointIds[b]![i]!, line, s, line.required[i]))
            if (b > 0 && this.links[b]!.to === 'finish') add('finish', -1, line, line.finishS)
        })
        // A gate stands across its tile; its place along the course is the nearest spot on a road across the field.
        const p = newProjection()
        for (const f of this.fields) {
            f.gates.forEach((g, i) => {
                this.onField(f, g.x, g.z, p)
                out.push({ kind: 'checkpoint', id: this.fieldGateIds[f.index]![i]!, branch: p.branch, s: p.s, x: g.x, y: f.y, z: g.z, tx: g.dx, tz: g.dz, reach: GATE_SPAN, field: f.index, ...g.required ? { required: true as const } : {} })
            })
        }
        return out
    }

    /**
     * Where (x, z) is on the road, searched from the car's last `branch` and `seg`, into `out`.
     * Past the end of a branch it carries on onto the road it meets; on a shared deck the car
     * changes road once it's clearly nearer the other one, or past where its own wall would be.
     * A car on a field (`out.field`) stays on it until it leaves through a mouth, onto that mouth's road;
     * a car on a road that crosses a field's edge comes onto the field.
     */
    locate(x: number, z: number, branch: number, seg: number, out: Projection = newProjection(), y = Number.NaN): Projection {
        if (!this.forked && !this.fields.length) return this.project(x, z, seg, out, y)
        const was = out.field >= 0 ? this.fields[out.field] : undefined
        if (was) {
            const { u, v } = was.local(x, z, this.local)
            if (was.contains(u, v)) return this.onField(was, x, z, out)
            const mouth = was.mouthOut(u, v)
            if (!mouth) {
                // Across an edge it shares with a field beside it, or off past a wall, which pushes it back on.
                const next = this.fieldUnder(x, z, f => f !== was && Math.abs(f.y - was.y) <= LEVEL_TOLERANCE)
                return this.onField(next ?? was, x, z, out)
            }
            const road = this.branches[mouth.branch]!
            road.projectNear(x, z, road.segmentAt(mouth.s), out)
            return out
        }
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
        if (Number.isFinite(d)) {
            const field = this.fieldUnder(x, z, f => f.crossedAt(line.branch, out.s, CROSSING_SLACK))
            if (field) return this.onField(field, x, z, out)
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

    /** The nearest road on any line, `y` picking between stacked ones; a field it's on before any. */
    nearest(x: number, z: number, out: Projection = newProjection(), y = Number.NaN) {
        const field = this.fieldUnder(x, z, f => !Number.isFinite(y) || Math.abs(y - f.y) < FIELD_LEVEL)
        if (field) return this.onField(field, x, z, out)
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
        if (!this.forked && !this.fields.length) return this.roadUnder(x, y, z, out)
        let top = -Infinity
        for (const line of this.branches) for (let i = 0; i < line.segments; i++) top = line.underSegment(i, x, y, z, top, out)
        // A field and the road across it lie at one height, so the field wins.
        const field = this.fieldUnder(x, z, f => f.y <= y + FIELD_UNDER && f.y >= top - 1e-6)
        if (field) this.onField(field, x, z, out)
        return top > -Infinity || !!field
    }

    /** The first field (x, z) lies on that `ok` accepts. */
    private fieldUnder(x: number, z: number, ok: (f: CourseField) => boolean): CourseField | undefined {
        for (const f of this.fields) {
            const { u, v } = f.local(x, z, this.local)
            if (f.contains(u, v) && ok(f)) return f
        }
        return undefined
    }

    /** A car at (x, z) on `field`, into `out`: its place along the course is the nearest spot on a road across the field. */
    private onField(field: CourseField, x: number, z: number, out: Projection): Projection {
        let best = Infinity
        let range: [number, number] = [0, 0]
        for (const c of field.crossings) {
            const line = this.branches[c.branch]!
            const last = line.segmentAt(Math.max(c.from, c.to - 1e-6))
            for (let i = line.segmentAt(c.from); i <= last; i++) {
                const score = line.scoreSegment(i, x, z, Number.NaN, best, out)
                if (score < best) range = [c.from, c.to]
                best = score
            }
        }
        // An open line's end segments reach on past its ends; on a field it stays on the crossing.
        out.s = Math.min(range[1], Math.max(range[0], out.s))
        out.field = field.index
        out.y = field.y
        out.grade = 0
        return out
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
     * As `back`, but `by` metres on along the road, each stretch from its earlier end to its later one: back the way a car
     * driving against the road came. Off the end of a branch it carries on along the road it joins; it stops `short` of a finish.
     */
    forth(branch: number, s: number, by: number, short = 0): { branch: number, s: number, legs: RouteLeg[] } {
        const legs: RouteLeg[] = []
        let b = branch
        let at = s
        let left = by
        for (let hop = 0; hop < this.branches.length + 1; hop++) {
            const line = this.branches[b]!
            const link = this.links[b]
            const onward = link && link.to !== 'finish' ? link.to : null
            if (!onward || at + left <= line.length) {
                const cap = line.closed ? Infinity : onward ? line.length : line.finishS - short
                const to = Math.max(at, Math.min(at + left, cap))
                legs.push({ branch: b, from: at, to })
                return { branch: b, s: line.wrapS(to), legs }
            }
            legs.push({ branch: b, from: at, to: line.length })
            left -= line.length - at
            b = onward.branch
            at = onward.at
        }
        return { branch: b, s: at, legs }
    }

    /**
     * The least time any lap can take at the speed ceiling: the shortest way round from the start, either way on a loop,
     * through at least K checkpoints to a finish (`min-lap.ts`). Walls keep a car on the ground on its road or field,
     * so only a lip lets it leave.
     */
    get minLapSeconds() {
        if (!this.forked && !this.gaps.length && !this.fields.length) return (this.lapLength - gridAllowance(this)) / SPEED_CEILING
        this.minLap ??= shortestLap(this) / SPEED_CEILING
        return this.minLap
    }
}
