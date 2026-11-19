import { sharedEdges } from './field'
import { GRID_BACK } from './field-plan'
import { farTurn } from './far-line'
import { KICKER_GRADE, SPEED_CEILING, wallFoot, type TrackLine } from './track-line'
import type { Track } from './track'

/**
 * The shortest way round from the start through K checkpoints, every required one among them, to a finish: by road, straight across
 * fields, and off jumps. A loop is also searched the other way round, and less the grid's run-up, which a lap driven off the grid backward skips.
 * A loop started on a field has to cross its far line once more one way than the other (`far-line.ts`), as the lap timer has it.
 */

/** Past this many checkpoints it counts touches rather than which ones, so one touched twice counts twice: still a lower bound. */
const MIN_LAP_CHECKPOINTS = 12
/** Required checkpoints still told apart while counting touches; dropping the rest only lowers the result. */
const KEPT_REQUIRED = 4
/** Edges the search may look at over every state, so no course makes it slow; past it, it tracks fewer checkpoints, which only lowers the result. */
const SEARCH_BUDGET = 2_000_000
/** Net crossings of the far line tracked, from -2 to 2; more would take another lap round. */
const TURNS = 5
/** A move across a field whose roads span this much of the lap or more can cross the far line any number of times. */
const ANY_TURN = 2
/** As the physics has it, for how far a kicker can throw the car. */
const GRAVITY = 9.81
/** Metres of height a flight's reach allows for: pose rounding, and a car landing a touch above the road. */
const LANDING_SLACK = 1

interface Edge { to: number, d: number, turn: number }

export function shortestLap(track: Track) {
    const g = track.graph
    const far = track.farProgress
    interface Point { x: number, y: number, z: number, tx: number, tz: number, bit: number, p: number }
    const points: Point[] = []
    const vertexPoint = new Map<number, number>()
    const node = (line: TrackLine, s: number, bit = -1, p = track.progressAt(line.branch, s)) => {
        const q = line.pointAt(s)
        return points.push({ x: q.x, y: q.y, z: q.z, tx: q.tx, tz: q.tz, bit, p }) - 1
    }
    /** Road between neighbouring points on a line, `a` before `b`; a gap's only drives forward. */
    const stretches: { line: TrackLine, s0: number, s1: number, a: number, b: number, gap: boolean }[] = []
    // A lap flies off a jump its own way round only: a flight against it needs a turn round the search can't see, which priced laps far too short.
    const lips: { p: number, tx: number, tz: number }[] = []
    const backLips: { p: number, tx: number, tz: number }[] = []
    // A field's mouths and gates, which a car drives between straight across it.
    const fieldNodes: number[][] = track.fields.map(() => [])
    track.branches.forEach((line, b) => {
        const marks: { s: number, p: number, gap?: number }[] = []
        g.vertexMarks.forEach((list, v) => {
            for (const m of list) {
                if (m.branch !== b) continue
                if (!vertexPoint.has(v)) vertexPoint.set(v, node(line, m.at))
                marks.push({ s: m.at, p: vertexPoint.get(v)! })
            }
        })
        line.checkpoints.forEach((s, i) => marks.push({ s, p: node(line, s, track.checkpointIds[b]![i]!) }))
        for (const f of track.fields) {
            for (const m of f.mouths) {
                if (m.branch !== b) continue
                const p = node(line, m.s)
                fieldNodes[f.index]!.push(p)
                marks.push({ s: m.s, p })
            }
        }
        line.gaps.forEach(([a, c], i) => {
            const pa = node(line, a)
            const pc = node(line, c)
            marks.push({ s: a, p: pa, gap: i }, { s: c, p: pc, gap: i })
            lips.push({ p: pa, tx: points[pa]!.tx, tz: points[pa]!.tz })
            backLips.push({ p: pc, tx: -points[pc]!.tx, tz: -points[pc]!.tz })
        })
        // Where the road crosses the far line, so every stretch lies to one side of it.
        if (far !== null) {
            for (const e of g.lineEdges[b] ?? []) {
                const p0 = g.progress[e.from]!
                const p1 = g.progress[e.to]!
                if ((p0 - far) * (p1 - far) < 0) {
                    const s = e.s0 + (far - p0) / (p1 - p0) * (e.s1 - e.s0)
                    marks.push({ s, p: node(line, s, -1, far) })
                }
            }
        }
        marks.sort((p, q) => p.s - q.s)
        for (let i = 0; i + 1 < marks.length; i++) {
            const m = marks[i]!
            const n = marks[i + 1]!
            stretches.push({ line, s0: m.s, s1: n.s, a: m.p, b: n.p, gap: m.gap !== undefined && m.gap === n.gap })
        }
    })
    // A field's gates, which a car reaches straight from any of its mouths or other gates.
    const gateLines = new Map(track.lapLines.map(l => [l.id, l]))
    track.fields.forEach((f, i) => f.gates.forEach((gate, j) => {
        const id = track.fieldGateIds[i]![j]!
        const at = gateLines.get(id)!
        fieldNodes[i]!.push(points.push({ x: gate.x, y: f.y, z: gate.z, tx: gate.dx, tz: gate.dz, bit: id, p: track.progressAt(at.branch, at.s) }) - 1)
    }))
    // Fields that meet edge to edge are open between them, so their points join up straight across both.
    const group = track.fields.map((_, i) => i)
    const root = (i: number): number => group[i] === i ? i : (group[i] = root(group[i]!))
    for (const a of track.fields) {
        for (const b of track.fields) if (a.index < b.index && sharedEdges(a.def, [a.def, b.def]).length) group[root(b.index)] = root(a.index)
    }
    const groups = new Map<number, number[]>()
    fieldNodes.forEach((list, i) => groups.set(root(i), [...groups.get(root(i)) ?? [], ...list]))
    // Across the start's fields the timer counts nothing; across another, the far line as its roads' progress has it, or any way when they span half the lap.
    const startLine = track.lapLines[0]!
    const home = startLine.field === undefined ? -1 : root(startLine.field)
    const spread = new Map<number, [number, number]>()
    for (const f of track.fields) {
        const [lo, hi] = spread.get(root(f.index)) ?? [Infinity, -Infinity]
        const ps = f.crossings.flatMap(c => [track.progressAt(c.branch, c.from), track.progressAt(c.branch, c.to)])
        spread.set(root(f.index), [Math.min(lo, ...ps), Math.max(hi, ...ps)])
    }
    const turnOf = (a: number, b: number) => far === null ? 0 : farTurn(points[a]!.p, points[b]!.p, far)
    const acrossTurn = (r: number, a: number, b: number) => {
        if (far === null || r === home) return 0
        const [lo, hi] = spread.get(r)!
        return hi - lo >= 0.5 ? ANY_TURN : turnOf(a, b)
    }
    // A field start is its gate, and a loop's lap ends back at it, each reached straight across its fields from any of their mouths and gates.
    const gatePoint = (p: number) => points.push({ x: startLine.x, y: startLine.y, z: startLine.z, tx: startLine.tx, tz: startLine.tz, bit: -1, p }) - 1
    const start = home < 0 ? vertexPoint.get(g.start)! : gatePoint(track.progressAt(startLine.branch, startLine.s))
    const ends = new Set(home >= 0 && track.closed ? [gatePoint(1)] : g.ends.map(v => vertexPoint.get(v)!))
    const edges: Edge[][] = points.map(() => [])
    const straight = (a: number, b: number, turn = 0) => edges[a]!.push({ to: b, d: Math.hypot(points[a]!.x - points[b]!.x, points[a]!.z - points[b]!.z), turn })
    // A start or finish gate on a field is reached straight across it, from or to any of its group's mouths and gates.
    for (const f of track.fields) {
        const list = groups.get(root(f.index)) ?? []
        const from = f.start ? [start] : []
        const into = f.finish ? [vertexPoint.get(g.ends[0]!)!] : f.start && track.closed ? [...ends] : []
        for (const a of from) for (const b of list) straight(a, b)
        for (const v of into) for (const a of [...list, ...f.finish ? from : []]) straight(a, v)
    }
    for (const r of stretches) {
        edges[r.a]!.push({ to: r.b, d: r.s1 - r.s0, turn: turnOf(r.a, r.b) })
        if (!r.gap) edges[r.b]!.push({ to: r.a, d: r.s1 - r.s0, turn: turnOf(r.b, r.a) })
    }
    for (const [r, list] of groups) {
        for (const a of list) {
            for (const b of list) if (a !== b) straight(a, b, acrossTurn(r, a, b))
        }
    }
    // A flight comes down on road ahead of its lip in a kicker's reach at the speed ceiling, then drives to either end of that stretch.
    const lift = SPEED_CEILING * KICKER_GRADE
    const flights = (list: readonly { p: number, tx: number, tz: number }[]) => {
        const out: Edge[][] = points.map(() => [])
        for (const lip of list) {
            const from = points[lip.p]!
            const reach = new Map<number, number>()
            const offer = (p: number, d: number) => {
                if (p !== lip.p && d < (reach.get(p) ?? Infinity)) reach.set(p, d)
            }
            for (const r of stretches) {
                if (r.gap) continue
                const land = flightLands(r.line, r.s0, r.s1, from, lip.tx, lip.tz, lift)
                if (!land) continue
                offer(r.a, land.a)
                offer(r.b, land.b)
            }
            for (const [to, d] of reach) out[lip.p]!.push({ to, d, turn: turnOf(lip.p, to) })
        }
        return out
    }
    const forthFlights = flights(lips)
    const backFlights = track.closed ? flights(backLips) : forthFlights
    const edgeCount = Math.max(points.length, ...[forthFlights, backFlights].map(f => f.reduce((n, list, p) => n + list.length + edges[p]!.length, 0)))

    // Which checkpoints a state tells apart, as much as the budget allows: each set exactly, or touches and a few required ones.
    const turns = far === null ? 1 : TURNS
    const work = edgeCount * turns
    const counted = track.checkpointCount <= MIN_LAP_CHECKPOINTS && work * 2 ** track.checkpointCount <= SEARCH_BUDGET
    let need = track.k
    let kept = counted ? [] : track.requiredIds.slice(0, KEPT_REQUIRED)
    while (kept.length && work * (need + 1) * 2 ** kept.length > SEARCH_BUDGET) kept = kept.slice(0, -1)
    if (!counted) need = Math.min(need, Math.max(0, Math.floor(SEARCH_BUDGET / work) - 1))
    const span = need + 1
    const requiredMask = counted ? track.requiredIds.reduce((m, id) => m | (1 << id), 0) : 0
    const allKept = (1 << kept.length) - 1
    const base = counted ? 1 << track.checkpointCount : span << kept.length
    const masks = base * turns
    const level = (turns - 1) / 2
    const best = new Float64Array(points.length * masks).fill(Infinity)
    const bitsOf = (m: number) => {
        let c = 0
        for (let v = m; v; v &= v - 1) c++
        return c
    }
    // Dijkstra over (point, checkpoints touched, far line crossings), with a binary heap.
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
    /** The shortest way from any of `from` to any of `to` through the checkpoints a lap needs, flying off `lips`; Infinity when there's none. */
    const search = (from: readonly number[], to: ReadonlySet<number>, lips: readonly Edge[][]) => {
        best.fill(Infinity)
        heap.length = 0
        for (const p of from) {
            best[p * masks + base * level] = 0
            push(0, p * masks + base * level)
        }
        const relax = (d: number, mask: number, t: number, e: Edge) => {
            const bit = points[e.to]!.bit
            const r = kept.indexOf(bit)
            const m = bit < 0 ? mask : counted ? mask | (1 << bit) : Math.min(need, mask % span + 1) + span * (Math.floor(mask / span) | (r < 0 ? 0 : 1 << r))
            for (let next = 0; next < turns; next++) {
                if (e.turn !== ANY_TURN && next !== Math.max(0, Math.min(turns - 1, t + e.turn))) continue
                const k = e.to * masks + base * next + m
                if (d + e.d < best[k]!) {
                    best[k] = d + e.d
                    push(d + e.d, k)
                }
            }
        }
        while (heap.length) {
            const [d, key] = pop()
            if (d > best[key]!) continue
            const p = Math.floor(key / masks)
            const t = Math.floor((key % masks) / base)
            const mask = key % base
            const done = (counted ? bitsOf(mask) >= need && (mask & requiredMask) === requiredMask : mask % span >= need && Math.floor(mask / span) === allKept)
                && (far === null || t !== level)
            if (to.has(p) && !from.includes(p) && done) return d
            for (const e of edges[p]!) relax(d, mask, t, e)
            for (const e of lips[p]!) relax(d, mask, t, e)
        }
        return Infinity
    }
    let shortest = search([start], ends, forthFlights)
    // The other way round a loop: from its end back to the start, or out of a field start through any mouth, as the search forward already may.
    if (track.closed) shortest = Math.min(shortest, home >= 0 ? search([start], ends, backFlights) : search([...ends], new Set([start]), backFlights))
    if (!Number.isFinite(shortest)) return 0
    return Math.max(0, shortest - gridAllowance(track))
}

/** Metres a run from the grid may skip of the shortest way from the line: the grid behind it, unless every run has to cross the line from it. */
export function gridAllowance(track: Track) {
    return track.closed || track.lapLines[0]!.field !== undefined ? GRID_BACK : 0
}

/** The shortest flight off a lip at `from` heading (tx, tz) onto `line` between `s0` and `s1`, then along the road to each end; null when it can't come down there. */
function flightLands(line: TrackLine, s0: number, s1: number, from: { x: number, y: number, z: number }, tx: number, tz: number, lift: number) {
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
