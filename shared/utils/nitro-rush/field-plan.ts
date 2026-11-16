import { cheapestPath } from './cheapest-path'
import { FIELD_TILE, GATE_POST_RADIUS, gatePosts, isBlocking, tileInside, type FieldDir } from './field'
import type { CourseField, FieldMark, MouthSpot } from './track-fields'
import type { Route } from './track-graph'

/** The bot's path across a field on a route, through every gate: the cheapest gate order by A* over the tiles, cached per route. */

/** A field's plan on one route: the points to steer through, mouth to mouth. */
export interface FieldPath {
    field: number
    points: readonly (readonly [number, number])[]
    /** Whether a straight drive between two world points keeps a car's width clear of blocks and pillars. */
    open: (ax: number, az: number, bx: number, bz: number) => boolean
}

/** Tile steps, eight ways, as (du, dv), clockwise from the field's forward. */
const STEPS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]] as const
/** Tiles of distance a 45° turn costs, so the plan keeps to straight runs. */
const TURN_COST = 0.35
/** What a tile costs driven over a pad pointing its way: pads are worth a detour. */
const PAD_SHARE = 0.6
/** Every gate order is tried up to this many gates; more go nearest first. */
const MAX_ORDERED_GATES = 6
const SEARCH_LIMIT = 20_000
/** Metres either side of a straight run that have to be open for the path to skip the tiles between. */
const SIGHT_HALF = 3
/** Metres either side the bot keeps clear aiming straight at a point. */
const CAR_SIGHT = 2
/** Metres the path runs on out of a mouth, so the bot leaves square to the edge. */
const RUN_OUT = 15
/** Metres in from each mouth the path keeps square to the edge, so the bot turns once it's on the field. */
const SQUARE_IN = 6
/** Each edge's outward way in field metres (du, dv). */
const OUTWARD: Record<MouthSpot['edge'], readonly [number, number]> = { entry: [0, -1], exit: [0, 1], left: [-1, 0], right: [1, 0] }

interface State {
    col: number
    row: number
    dir: number
}

/** A leg's goal; a gate (`either`) counts driven through either way. */
interface Goal extends State {
    either?: boolean
}

const turnOf = (a: number, b: number) => Math.min(Math.abs(a - b), 8 - Math.abs(a - b))
/** How far `d` is off a gate's way across, driven either way. */
const offAxis = (gate: number, d: number) => Math.min(turnOf(gate, d), turnOf((gate + 4) % 8, d))

/** The field's tiles: whether one is open to drive, the step direction a pad or gate on it points, and its gate posts. */
function tilesOf(field: CourseField) {
    const open = new Uint8Array(field.cols * field.rows).fill(1)
    const pad = new Int8Array(field.cols * field.rows).fill(-1)
    const gate = new Int8Array(field.cols * field.rows).fill(-1)
    for (const t of field.def.plan.tiles) {
        const i = t.col + t.row * field.cols
        if (isBlocking(t.kind)) open[i] = 0
        else if (t.kind === 'boost') pad[i] = t.dir * 2
        else if (t.kind === 'checkpoint') gate[i] = t.dir * 2
    }
    const at = (col: number, row: number) => col >= 0 && row >= 0 && col < field.cols && row < field.rows && open[col + row * field.cols] === 1
    const gateAt = (col: number, row: number) => col >= 0 && row >= 0 && col < field.cols && row < field.rows ? gate[col + row * field.cols]! : -1
    // Its posts stand either side, so a tile step in or out of a gate's tile goes within 45° of straight through, either way.
    const past = (col: number, row: number, dir: number) => gateAt(col, row) >= 0 && offAxis(gateAt(col, row), dir) > 1
    const posts = field.def.plan.tiles.flatMap(t => t.kind === 'checkpoint' ? gatePosts(t) : [])
    return { at, past, posts, pad: (col: number, row: number) => pad[col + row * field.cols]! }
}

/** A mouth's tile and the step direction pointing out of the field there. */
function mouthState(field: CourseField, m: MouthSpot): State {
    const { u, v } = field.local(m.x, m.z)
    const { col, row } = tileInside(field, u, v)
    const out: Record<MouthSpot['edge'], FieldDir> = { entry: 2, exit: 0, left: 3, right: 1 }
    return { col, row, dir: out[m.edge] * 2 }
}

/** The cheapest drive across the tiles from `from` to `goal`: arriving square on `goal.dir` if it can, else up to 45° off, else any way. */
function leg(field: CourseField, tiles: ReturnType<typeof tilesOf>, from: State, goal: Goal) {
    const search = (slack: number) => cheapestPath<State, State>(from, {
        key: s => (s.col + s.row * field.cols) * 8 + s.dir,
        steps: (s) => {
            const out = []
            for (let d = 0; d < 8; d++) {
                const turn = turnOf(s.dir, d)
                if (turn > 2) continue
                const [du, dv] = STEPS[d]!
                const col = s.col + du
                const row = s.row + dv
                if (!tiles.at(col, row) || tiles.past(col, row, d) || tiles.past(s.col, s.row, d) || (du && dv && (!tiles.at(s.col + du, s.row) || !tiles.at(s.col, s.row + dv)))) continue
                const length = du && dv ? Math.SQRT2 : 1
                const to = { col, row, dir: d }
                out.push({ to, cost: length * (tiles.pad(col, row) === d ? PAD_SHARE : 1) + turn * TURN_COST, label: to })
            }
            return out
        },
        // A gate still counts crossed 45° off square, which one walled in behind needs.
        done: s => s.col === goal.col && s.row === goal.row && (goal.either ? offAxis(goal.dir, s.dir) : turnOf(s.dir, goal.dir)) <= slack,
        estimate: (s) => {
            const a = Math.abs(s.col - goal.col)
            const b = Math.abs(s.row - goal.row)
            return (Math.max(a, b) + (Math.SQRT2 - 1) * Math.min(a, b)) * PAD_SHARE
        },
        limit: SEARCH_LIMIT
    })
    const found = search(0) ?? search(1) ?? search(4)
    return found && { cost: found.cost, states: found.labels, end: found.labels[found.labels.length - 1] ?? from }
}

/** Gate orders to try: every one for a few gates, else nearest first from the way in. */
function* gateOrders(n: number, nearest: () => number[]): Generator<number[]> {
    if (n > MAX_ORDERED_GATES) {
        yield nearest()
        return
    }
    const order = Array.from({ length: n }, (_, i) => i)
    // Heap's algorithm.
    const c = new Array(n).fill(0)
    yield [...order]
    let i = 0
    while (i < n) {
        if (c[i] < i) {
            const j = i % 2 ? c[i] : 0
            ;[order[j], order[i]] = [order[i]!, order[j]!]
            yield [...order]
            c[i]++
            i = 0
        } else {
            c[i] = 0
            i++
        }
    }
}

/** The bot's path across `field` from mouth `into` to mouth `out`, through every gate; null if there's none. */
export function planField(field: CourseField, into: MouthSpot, out: MouthSpot): FieldPath | null {
    const tiles = tilesOf(field)
    const start = mouthState(field, into)
    start.dir = (start.dir + 4) % 8
    const end = mouthState(field, out)
    const gates: Goal[] = field.gates.map(g => ({ col: g.col, row: g.row, dir: dirOfMark(field, g), either: true }))
    const cache = new Map<string, ReturnType<typeof leg>>()
    const legFrom = (a: State, b: Goal) => {
        const key = `${a.col},${a.row},${a.dir}>${b.col},${b.row},${b.dir}${b.either ? '~' : ''}`
        if (!cache.has(key)) cache.set(key, leg(field, tiles, a, b))
        return cache.get(key)!
    }
    const nearest = () => {
        const left = gates.map((_, i) => i)
        const order: number[] = []
        let at = start
        while (left.length) {
            left.sort((p, q) => (legFrom(at, gates[p]!)?.cost ?? Infinity) - (legFrom(at, gates[q]!)?.cost ?? Infinity))
            const next = left.shift()!
            order.push(next)
            at = legFrom(at, gates[next]!)?.end ?? gates[next]!
        }
        return order
    }
    let best: { cost: number, states: State[] } | null = null
    for (const order of gateOrders(gates.length, nearest)) {
        let at = start
        let cost = 0
        const states: State[] = [start]
        for (const goal of [...order.map(i => gates[i]!), end]) {
            const run = legFrom(at, goal)
            if (!run) {
                cost = Infinity
                break
            }
            cost += run.cost
            states.push(...run.states)
            at = run.end
        }
        if (cost < (best?.cost ?? Infinity)) best = { cost, states }
    }
    if (!best) return null
    const open = (ax: number, az: number, bx: number, bz: number) => clear(field, tiles, field.local(ax, az), field.local(bx, bz), CAR_SIGHT)
    return { field: field.index, points: smooth(field, tiles, best.states, gates, into, out), open }
}

/** A gate's way across as a step direction. */
function dirOfMark(field: CourseField, g: FieldMark) {
    for (let q = 0; q < 4; q++) {
        const [dx, dz] = field.direction(q)
        if (dx * g.dx + dz * g.dz > 0.5) return q * 2
    }
    return 0
}

/** The tile path as world points: through its turns and gates only, straight wherever the ground between is open. */
function smooth(field: CourseField, tiles: ReturnType<typeof tilesOf>, states: readonly State[], gates: readonly State[], into: MouthSpot, out: MouthSpot) {
    const centre = (s: State) => ({ u: (s.col + 0.5) * FIELD_TILE, v: (s.row + 0.5) * FIELD_TILE })
    // Each gate is driven square through: in from the middle of its tile's back half, out through the front half.
    const inside = (m: MouthSpot) => {
        const p = field.local(m.x, m.z)
        const [du, dv] = OUTWARD[m.edge]
        return [{ ...p, pin: true }, { u: p.u - du * SQUARE_IN, v: p.v - dv * SQUARE_IN, pin: true }]
    }
    const local: { u: number, v: number, pin: boolean, dir?: number }[] = inside(into)
    for (const s of states.slice(1)) {
        const c = centre(s)
        const gate = gates.some(g => g.col === s.col && g.row === s.row && offAxis(g.dir, s.dir) <= 1)
        if (!gate) {
            local.push({ ...c, pin: false, dir: s.dir })
            continue
        }
        const [du, dv] = STEPS[s.dir]!
        local.push({ u: c.u - du * FIELD_TILE * 0.3, v: c.v - dv * FIELD_TILE * 0.3, pin: true }, { u: c.u + du * FIELD_TILE * 0.3, v: c.v + dv * FIELD_TILE * 0.3, pin: true })
    }
    local.push(...inside(out).reverse())
    const kept = [local[0]!]
    for (let i = 1; i < local.length; i++) {
        const p = local[i]!
        const next = local[i + 1]
        const from = kept[kept.length - 1]!
        // A shortcut that would cut out a turn-back (the way round to a gate) keeps it.
        const back = p.dir !== undefined && next && (next.u - from.u) * STEPS[p.dir]![0] + (next.v - from.v) * STEPS[p.dir]![1] <= 0
        if (p.pin || !next || back || !clear(field, tiles, from, next)) kept.push(p)
    }
    const [ox, oz] = field.direction({ entry: 2, exit: 0, left: 3, right: 1 }[out.edge])
    const points = kept.map(p => field.world(p.u, p.v))
    points.push([out.x + ox * RUN_OUT, out.z + oz * RUN_OUT])
    return points
}

/** Whether a straight run from `a` to `b` stays on open tiles and off gate posts, `half` metres either side. */
function clear(field: CourseField, tiles: ReturnType<typeof tilesOf>, a: { u: number, v: number }, b: { u: number, v: number }, half = SIGHT_HALF) {
    const length = Math.hypot(b.u - a.u, b.v - a.v)
    for (const [pu, pv] of tiles.posts) {
        const t = length < 1e-6 ? 0 : Math.max(0, Math.min(1, ((pu - a.u) * (b.u - a.u) + (pv - a.v) * (b.v - a.v)) / (length * length)))
        if (Math.hypot(a.u + (b.u - a.u) * t - pu, a.v + (b.v - a.v) * t - pv) < GATE_POST_RADIUS + half) return false
    }
    if (length < 1e-6) return true
    const nu = -(b.v - a.v) / length
    const nv = (b.u - a.u) / length
    for (let d = 0; d <= length; d += 2) {
        const u = a.u + (b.u - a.u) * d / length
        const v = a.v + (b.v - a.v) * d / length
        for (const side of [-half, 0, half]) {
            const su = Math.min(field.width - 0.01, Math.max(0.01, u + nu * side))
            const sv = Math.min(field.length - 0.01, Math.max(0.01, v + nv * side))
            if (!tiles.at(Math.floor(su / FIELD_TILE), Math.floor(sv / FIELD_TILE))) return false
        }
    }
    return true
}

/** Each field a route crosses, with the mouths it comes in and goes out by, in route order. */
export function routeCrossings(fields: readonly CourseField[], route: Route) {
    const out: { field: CourseField, into: MouthSpot, out: MouthSpot }[] = []
    for (const field of fields) {
        const met: { m: MouthSpot, order: number }[] = []
        route.legs.forEach((leg, i) => {
            for (const m of field.mouths) {
                if (m.branch === leg.branch && m.s >= leg.from - 1e-3 && m.s <= leg.to + 1e-3) met.push({ m, order: i + (m.s - leg.from) / Math.max(1, leg.to - leg.from + 1) })
            }
        })
        if (met.length < 2) continue
        met.sort((a, b) => a.order - b.order)
        out.push({ field, into: met[0]!.m, out: met[met.length - 1]!.m })
    }
    return out
}

const plans = new WeakMap<Route, FieldPath[]>()

/** The bot's path across each field `route` crosses, worked out once per route. */
export function routeFieldPaths(fields: readonly CourseField[], route: Route): readonly FieldPath[] {
    let cached = plans.get(route)
    if (!cached) {
        cached = routeCrossings(fields, route).flatMap(c => planField(c.field, c.into, c.out) ?? [])
        plans.set(route, cached)
    }
    return cached
}
