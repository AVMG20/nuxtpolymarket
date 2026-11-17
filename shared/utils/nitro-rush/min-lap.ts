import { sharedEdges } from './field'
import { KICKER_GRADE, SPEED_CEILING, wallFoot, type TrackLine } from './track-line'
import type { Track } from './track'

/** The shortest way round from the start through K checkpoints to a finish: by road, straight across fields, and off jumps. */

/** Past this many checkpoints it counts touches rather than which ones, so one touched twice counts twice: still a lower bound. */
const MIN_LAP_CHECKPOINTS = 12
/** As the physics has it, for how far a kicker can throw the car. */
const GRAVITY = 9.81
/** Metres of height a flight's reach allows for: pose rounding, and a car landing a touch above the road. */
const LANDING_SLACK = 1

export function shortestLap(track: Track) {
    const g = track.graph
    interface Point { x: number, y: number, z: number, tx: number, tz: number, bit: number }
    const points: Point[] = []
    const vertexPoint = new Map<number, number>()
    const node = (line: TrackLine, s: number, bit = -1) => {
        const q = line.pointAt(s)
        return points.push({ x: q.x, y: q.y, z: q.z, tx: q.tx, tz: q.tz, bit }) - 1
    }
    const counted = track.checkpointCount <= MIN_LAP_CHECKPOINTS
    /** Road between neighbouring points on a line, `a` before `b`; a gap's only drives forward. */
    const stretches: { line: TrackLine, s0: number, s1: number, a: number, b: number, gap: boolean }[] = []
    // Only a jump's lip: a flight backward off a landing ramp needs a turn round the search can't see, so it priced laps far too short.
    const lips: { p: number, tx: number, tz: number }[] = []
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
        })
        marks.sort((p, q) => p.s - q.s)
        for (let i = 0; i + 1 < marks.length; i++) {
            const m = marks[i]!
            const n = marks[i + 1]!
            stretches.push({ line, s0: m.s, s1: n.s, a: m.p, b: n.p, gap: m.gap !== undefined && m.gap === n.gap })
        }
    })
    // A field's gates, which a car reaches straight from any of its mouths or other gates.
    track.fields.forEach((f, i) => f.gates.forEach((gate, j) => {
        fieldNodes[i]!.push(points.push({ x: gate.x, y: f.y, z: gate.z, tx: gate.dx, tz: gate.dz, bit: track.fieldGateIds[i]![j]! }) - 1)
    }))
    // Fields that meet edge to edge are open between them, so their points join up straight across both.
    const group = track.fields.map((_, i) => i)
    const root = (i: number): number => group[i] === i ? i : (group[i] = root(group[i]!))
    for (const a of track.fields) {
        for (const b of track.fields) if (a.index < b.index && sharedEdges(a.def, [a.def, b.def]).length) group[root(b.index)] = root(a.index)
    }
    const groups = new Map<number, number[]>()
    fieldNodes.forEach((list, i) => groups.set(root(i), [...groups.get(root(i)) ?? [], ...list]))
    const ends = new Set(g.ends.map(v => vertexPoint.get(v)!))
    const edges: { to: number, d: number }[][] = points.map(() => [])
    for (const r of stretches) {
        edges[r.a]!.push({ to: r.b, d: r.s1 - r.s0 })
        // Driving backward never finishes a lap.
        if (!r.gap && !ends.has(r.a)) edges[r.b]!.push({ to: r.a, d: r.s1 - r.s0 })
    }
    for (const list of groups.values()) {
        for (const a of list) {
            for (const b of list) if (a !== b) edges[a]!.push({ to: b, d: Math.hypot(points[a]!.x - points[b]!.x, points[a]!.z - points[b]!.z) })
        }
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
            const land = flightLands(r.line, r.s0, r.s1, from, lip.tx, lip.tz, lift)
            if (!land) continue
            // Driving backward never finishes a lap, and a flight onto the road before a finish has to be heading over it.
            if (!ends.has(r.a)) offer(r.a, land.a)
            if (!ends.has(r.b) || lip.tx * points[r.b]!.tx + lip.tz * points[r.b]!.tz > 0) offer(r.b, land.b)
        }
        for (const [to, d] of reach) edges[lip.p]!.push({ to, d })
    }
    const start = vertexPoint.get(g.start)!
    const need = track.k
    const masks = counted ? 1 << track.checkpointCount : need + 1
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
        if (ends.has(p) && p !== start && (counted ? bitsOf(mask) : mask) >= need) return d
        for (const e of edges[p]!) {
            const bit = points[e.to]!.bit
            const m = bit < 0 ? mask : counted ? mask | (1 << bit) : Math.min(need, mask + 1)
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
