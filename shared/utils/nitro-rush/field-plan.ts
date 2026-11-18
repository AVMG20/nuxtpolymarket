import { cheapestPath } from './cheapest-path'
import { edgeAt, edgePoint, FIELD_TILE, GATE_POST_RADIUS, gatePosts, isBlocking, isGate, mouthTiles, sharedEdges, type FieldDir } from './field'
import { joinedFields, type CourseField, type FieldMark, type MouthSpot } from './track-fields'
import type { Route } from './track-graph'

/** The bot's path across a field on a route, through every gate: the cheapest gate order by A* over the tiles, cached per route. */

/** Metres behind a field's start gate the grid sits, as the car is placed there. */
export const GRID_BACK = 14

/** A field's plan on one route: the points to steer through, mouth to mouth. */
export interface FieldPath {
    field: number
    /** An arena's path covers all its joined fields. */
    fields?: readonly number[]
    points: readonly (readonly [number, number])[]
    /** Whether a straight drive between two world points keeps a car's width clear of blocks and pillars. */
    open: (ax: number, az: number, bx: number, bz: number) => boolean
    /** An arena's lap, laid twice from point `from`, `length` points each, so the bot goes round again from the second. */
    cycle?: { from: number, length: number }
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
        else if ('dir' in t && isGate(t.kind)) gate[i] = t.dir * 2
    }
    const at = (col: number, row: number) => col >= 0 && row >= 0 && col < field.cols && row < field.rows && open[col + row * field.cols] === 1
    const gateAt = (col: number, row: number) => col >= 0 && row >= 0 && col < field.cols && row < field.rows ? gate[col + row * field.cols]! : -1
    // Its posts stand either side, so a tile step in or out of a gate's tile goes within 45° of straight through, either way.
    const past = (col: number, row: number, dir: number) => gateAt(col, row) >= 0 && offAxis(gateAt(col, row), dir) > 1
    const posts = field.def.plan.tiles.flatMap(t => isGate(t.kind) && 'dir' in t ? gatePosts(t) : [])
    return { at, past, posts, pad: (col: number, row: number) => pad[col + row * field.cols]! }
}

/** A mouth's tiles, both on the line between two, each with the step direction pointing out of the field there, or `into` it. */
function mouthStates(field: CourseField, m: MouthSpot, into: boolean): State[] {
    const out: Record<MouthSpot['edge'], FieldDir> = { entry: 2, exit: 0, left: 3, right: 1 }
    const dir = (out[m.edge] * 2 + (into ? 4 : 0)) % 8
    return mouthTiles(field.def.plan, m.edge, m.at).map(t => ({ ...t, dir }))
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

/**
 * The bot's path across `field` from mouth `into` to mouth `out`, through every gate; null if there's none.
 * A start gate is driven through first, from the grid behind it with no `into`; a finish gate last, with no `out`.
 * `again` is a later crossing of a field the route has already driven, which leaves its gates and start alone.
 */
export function planField(field: CourseField, into: MouthSpot | null, out: MouthSpot | null, again = false): FieldPath | null {
    const tiles = tilesOf(field)
    const goalOf = (g: FieldMark | null) => g && { col: g.col, row: g.row, dir: dirOfMark(field, g) }
    const startLine = goalOf(field.start)
    const finishLine = goalOf(field.finish)
    const starts = into ? mouthStates(field, into, true) : startLine ? [startLine] : []
    // A finish counts either way through, so the route may end over it from whichever side is nearer.
    const ends: Goal[] = out ? mouthStates(field, out, false) : finishLine ? [{ ...finishLine, either: true }] : []
    if (!starts.length || !ends.length) return null
    const gates: Goal[] = again ? [] : field.gates.map(g => ({ col: g.col, row: g.row, dir: dirOfMark(field, g), either: true }))
    // The bot laps the way the grid faces, so a route that comes back round to the start takes it first.
    const opening = into && startLine && !again ? [startLine] : []
    const cache = new Map<string, ReturnType<typeof leg>>()
    const legFrom = (a: State, b: Goal) => {
        const key = `${a.col},${a.row},${a.dir}>${b.col},${b.row},${b.dir}${b.either ? '~' : ''}`
        if (!cache.has(key)) cache.set(key, leg(field, tiles, a, b))
        return cache.get(key)!
    }
    const nearest = (start: State) => () => {
        const left = gates.map((_, i) => i)
        const order: number[] = []
        let at = opening[0] ?? start
        while (left.length) {
            left.sort((p, q) => (legFrom(at, gates[p]!)?.cost ?? Infinity) - (legFrom(at, gates[q]!)?.cost ?? Infinity))
            const next = left.shift()!
            order.push(next)
            at = legFrom(at, gates[next]!)?.end ?? gates[next]!
        }
        return order
    }
    let best: { cost: number, states: State[] } | null = null
    // A mouth on the line between two tiles may set off from or end on either.
    for (const start of starts) {
        for (const end of ends) {
            for (const order of gateOrders(gates.length, nearest(start))) {
                let at = start
                let cost = 0
                const states: State[] = [start]
                for (const goal of [...opening, ...order.map(i => gates[i]!), end]) {
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
        }
    }
    if (!best) return null
    const open = (ax: number, az: number, bx: number, bz: number) => clear(field, tiles, field.local(ax, az), field.local(bx, bz), CAR_SIGHT)
    return { field: field.index, points: smooth(field, tiles, best.states, [...gates, ...[startLine, finishLine].filter(g => g !== null)], into, out), open }
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
function smooth(field: CourseField, tiles: ReturnType<typeof tilesOf>, states: readonly State[], gates: readonly State[], into: MouthSpot | null, out: MouthSpot | null) {
    const centre = (s: State) => ({ u: (s.col + 0.5) * FIELD_TILE, v: (s.row + 0.5) * FIELD_TILE })
    // Each gate is driven square through: in from the middle of its tile's back half, out through the front half.
    const through = (s: State, from: number, to: number) => {
        const c = centre(s)
        const [du, dv] = STEPS[s.dir]!
        return [from, to].map(d => ({ u: c.u + du * d, v: c.v + dv * d, pin: true }))
    }
    const inside = (m: MouthSpot) => {
        const p = field.local(m.x, m.z)
        const [du, dv] = OUTWARD[m.edge]
        return [{ ...p, pin: true }, { u: p.u - du * SQUARE_IN, v: p.v - dv * SQUARE_IN, pin: true }]
    }
    // From the grid, the path sets off behind the start gate and runs through it.
    const local: { u: number, v: number, pin: boolean, dir?: number }[] = into ? inside(into) : through(states[0]!, -GRID_BACK, FIELD_TILE * 0.3)
    for (const s of states.slice(1)) {
        const gate = gates.some(g => g.col === s.col && g.row === s.row && offAxis(g.dir, s.dir) <= 1)
        if (gate) local.push(...through(s, -FIELD_TILE * 0.3, FIELD_TILE * 0.3))
        else local.push({ ...centre(s), pin: false, dir: s.dir })
    }
    if (out) local.push(...inside(out).reverse())
    const kept = [local[0]!]
    for (let i = 1; i < local.length; i++) {
        const p = local[i]!
        const next = local[i + 1]
        const from = kept[kept.length - 1]!
        // A shortcut that would cut out a turn-back (the way round to a gate) keeps it.
        const back = p.dir !== undefined && next && (next.u - from.u) * STEPS[p.dir]![0] + (next.v - from.v) * STEPS[p.dir]![1] <= 0
        if (p.pin || !next || back || !clear(field, tiles, from, next)) kept.push(p)
    }
    const points = kept.map(p => field.world(p.u, p.v))
    if (out) {
        const [ox, oz] = field.direction({ entry: 2, exit: 0, left: 3, right: 1 }[out.edge])
        points.push([out.x + ox * RUN_OUT, out.z + oz * RUN_OUT])
    } else {
        // Past the finish it runs straight on, wherever that leads.
        const last = states[states.length - 1]!
        const [ox, oz] = field.direction(last.dir / 2)
        const [x, z] = points[points.length - 1]!
        points.push([x + ox * RUN_OUT, z + oz * RUN_OUT])
    }
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

/** One crossing of a field on a route: in by `into` (none from the grid), out by `out` (none at a finish), `again` when the route has crossed it before. */
export interface RouteCrossing {
    field: CourseField
    into: MouthSpot | null
    out: MouthSpot | null
    again: boolean
}

/**
 * Each field crossing on a route, in route order: every mouth in pairs, the way in then the way out. A route that sets off
 * on a field's start has no mouth in unless it comes back round to it, and one that ends at a field's finish has none out.
 * A road back onto joined fields can come in on one and the route go on out of another, so it's crossed field by field.
 */
export function routeCrossings(fields: readonly CourseField[], route: Route): RouteCrossing[] {
    const met: { m: MouthSpot, field: CourseField, order: number }[] = []
    route.legs.forEach((leg, i) => {
        for (const field of fields) {
            for (const m of field.mouths) {
                if (m.branch === leg.branch && m.s >= leg.from - 1e-3 && m.s <= leg.to + 1e-3) met.push({ m, field, order: i + (m.s - leg.from) / Math.max(1, leg.to - leg.from + 1) })
            }
        }
    })
    met.sort((a, b) => a.order - b.order)
    const pairs: { field: CourseField, into: MouthSpot | null, to: CourseField | null, out: MouthSpot | null }[] = []
    const start = fields.find(f => f.start)
    let open: { field: CourseField, into: MouthSpot | null } | null = start ? { field: start, into: null } : null
    for (let i = 0; i < met.length; i++) {
        // Where two fields meet the road leaves one as it enters the other, at one spot: the one it's on goes first.
        const next = met[i + 1]
        if (open && next && next.order - met[i]!.order < 1e-9 && next.field === open.field && met[i]!.field !== open.field) [met[i], met[i + 1]] = [next, met[i]!]
        const { m, field } = met[i]!
        if (!open) open = { field, into: m }
        else {
            pairs.push({ ...open, to: field, out: m })
            open = null
        }
    }
    if (open) {
        const first = pairs[0]
        // A loop comes back round to its start field, which the lap then sets off across.
        if (route.legs.length && open.field.start && first?.field === open.field && !first.into && first.out) first.into = open.into
        else if (open.field.finish || joinedFields(fields, open.field.index).some(f => f.finish)) pairs.push({ ...open, to: null, out: null })
    }
    const crossed = new Set<CourseField>()
    const out: RouteCrossing[] = []
    const add = (field: CourseField, into: MouthSpot | null, exit: MouthSpot | null) => {
        out.push({ field, into, out: exit, again: crossed.has(field) })
        crossed.add(field)
    }
    for (const p of pairs) {
        const to = p.to ?? (p.field.finish ? p.field : joinedFields(fields, p.field.index).find(f => f.finish) ?? p.field)
        if (to === p.field) {
            add(p.field, p.into, p.out)
            continue
        }
        const chain = fieldChain(fields, p.field, to)
        if (!chain) continue
        let into = p.into
        for (let k = 0; k + 1 < chain.length; k++) {
            const across = crossOver(chain[k]!, chain[k + 1]!, into)
            if (!across) break
            add(chain[k]!, into, across.out)
            into = across.into
        }
        add(to, into, p.out)
    }
    return out
}

/** The fewest joined fields from `a` to `b`, both in, edge to edge; null when they aren't joined. */
function fieldChain(fields: readonly CourseField[], a: CourseField, b: CourseField): CourseField[] | null {
    const back = new Map<CourseField, CourseField | null>([[a, null]])
    const queue = [a]
    while (queue.length) {
        const f = queue.shift()!
        if (f === b) {
            const chain = [b]
            for (let p = back.get(b); p; p = back.get(p)) chain.unshift(p)
            return chain
        }
        for (const g of fields) {
            if (back.has(g) || !sharedEdges(f.def, [f.def, g.def]).length) continue
            back.set(g, f)
            queue.push(g)
        }
    }
    return null
}

/** Where the bot drives over the edge from field `a` onto `b`: a slot of the stretch they share, nearest the way it came in that it can reach. */
function crossOver(a: CourseField, b: CourseField, into: MouthSpot | null) {
    const shared = sharedEdges(a.def, [a.def, b.def])[0]
    if (!shared) return null
    const from = into ? a.local(into.x, into.z) : { u: a.width / 2, v: a.length / 2 }
    const spots: number[] = []
    for (let at = shared.at - shared.half + FIELD_TILE / 2; at <= shared.at + shared.half - FIELD_TILE / 2 + 1e-6; at += FIELD_TILE / 2) spots.push(at)
    const local = (at: number) => edgePoint(a.def.plan, shared.edge, at)
    spots.sort((p, q) => Math.hypot(local(p).u - from.u, local(p).v - from.v) - Math.hypot(local(q).u - from.u, local(q).v - from.v))
    for (const at of spots) {
        const { u, v } = local(at)
        const [x, z] = a.world(u, v)
        const out: MouthSpot = { branch: -1, s: 0, edge: shared.edge, at, half: FIELD_TILE / 2, x, z }
        const p = b.local(x, z)
        const onB = edgeAt(b.def.plan, p.u, p.v, 0.05)
        if (!onB || !planField(a, into, out, true)) continue
        return { out, into: { ...out, edge: onB.edge, at: onB.at } }
    }
    return null
}

const plans = new WeakMap<Route, FieldPath[]>()

/** The bot's path across each field `route` crosses, worked out once per route. */
export function routeFieldPaths(fields: readonly CourseField[], route: Route): readonly FieldPath[] {
    let cached = plans.get(route)
    if (!cached) {
        const arena = fields.length && fields.every(f => !f.mouths.length) && fields.some(f => f.start)
        cached = arena ? [planArena(fields)].filter(p => p !== null) : routeCrossings(fields, route).flatMap(c => planField(c.field, c.into, c.out, c.again) ?? [])
        plans.set(route, cached)
    }
    return cached
}

/** A tile on one of an arena's fields, by its index among them. */
interface GroupState extends State {
    f: number
}

/**
 * The bot's lap round an arena, a loop of joined fields no road meets: from the start gate through every
 * checkpoint in the cheapest order and back through the start, in world points; null if there's none.
 */
export function planArena(fields: readonly CourseField[]): FieldPath | null {
    const home = fields.find(f => f.start)
    if (!home) return null
    const group = joinedFields(fields, home.index)
    const tiles = group.map(tilesOf)
    const centre = (s: GroupState) => group[s.f]!.world((s.col + 0.5) * FIELD_TILE, (s.row + 0.5) * FIELD_TILE)
    const gateOf = (f: number, g: FieldMark, either: boolean) => ({ f, col: g.col, row: g.row, dir: dirOfMark(group[f]!, g), either })
    const start = gateOf(group.indexOf(home), home.start!, false)
    const gates = group.flatMap((field, f) => field.gates.map(g => gateOf(f, g, true)))
    /** A step `d` off tile (col, row) of field `f`: on that field, or straight over a shared edge onto the next, its way turned to that field's frame. */
    const across = (f: number, col: number, row: number, d: number): GroupState | null => {
        const field = group[f]!
        const [du, dv] = STEPS[d]!
        if (col + du >= 0 && row + dv >= 0 && col + du < field.cols && row + dv < field.rows) return { f, col: col + du, row: row + dv, dir: d }
        if (du && dv) return null
        const [x, z] = field.world((col + du + 0.5) * FIELD_TILE, (row + dv + 0.5) * FIELD_TILE)
        for (const [g, other] of group.entries()) {
            if (g === f) continue
            const p = other.local(x, z)
            if (p.u <= 0 || p.v <= 0 || p.u >= other.width || p.v >= other.length) continue
            const turns = Math.round((other.heading - field.heading) / (Math.PI / 4))
            return { f: g, col: Math.floor(p.u / FIELD_TILE), row: Math.floor(p.v / FIELD_TILE), dir: (((d - turns) % 8) + 8) % 8 }
        }
        return null
    }
    const openAt = (s: GroupState) => tiles[s.f]!.at(s.col, s.row)
    const legOf = (from: GroupState, goal: GroupState & Goal) => {
        const [gx, gz] = centre(goal)
        const search = (slack: number) => cheapestPath<GroupState, GroupState>(from, {
            key: s => ((s.f * 4096 + s.col + s.row * 64) * 8) + s.dir,
            steps: (s) => {
                const out = []
                for (let d = 0; d < 8; d++) {
                    const turn = turnOf(s.dir, d)
                    if (turn > 2) continue
                    const to = across(s.f, s.col, s.row, d)
                    if (!to || !openAt(to) || tiles[to.f]!.past(to.col, to.row, to.dir) || tiles[s.f]!.past(s.col, s.row, d)) continue
                    const [du, dv] = STEPS[d]!
                    if (du && dv && (!tiles[s.f]!.at(s.col + du, s.row) || !tiles[s.f]!.at(s.col, s.row + dv))) continue
                    const length = du && dv ? Math.SQRT2 : 1
                    out.push({ to, cost: length * (tiles[to.f]!.pad(to.col, to.row) === to.dir ? PAD_SHARE : 1) + turn * TURN_COST, label: to })
                }
                return out
            },
            done: s => s.f === goal.f && s.col === goal.col && s.row === goal.row && (goal.either ? offAxis(goal.dir, s.dir) : turnOf(s.dir, goal.dir)) <= slack,
            estimate: (s) => {
                const [x, z] = centre(s)
                return Math.hypot(x - gx, z - gz) / FIELD_TILE * PAD_SHARE
            },
            limit: SEARCH_LIMIT
        })
        const found = search(0) ?? search(1) ?? search(4)
        return found && { cost: found.cost, states: found.labels, end: found.labels[found.labels.length - 1] ?? from }
    }
    const cache = new Map<string, ReturnType<typeof legOf>>()
    const legFrom = (a: GroupState, b: GroupState & Goal) => {
        const key = `${a.f},${a.col},${a.row},${a.dir}>${b.f},${b.col},${b.row},${b.dir}${b.either ? '~' : ''}`
        if (!cache.has(key)) cache.set(key, legOf(a, b))
        return cache.get(key)!
    }
    const nearest = () => {
        const left = gates.map((_, i) => i)
        const order: number[] = []
        let at: GroupState = start
        while (left.length) {
            left.sort((p, q) => (legFrom(at, gates[p]!)?.cost ?? Infinity) - (legFrom(at, gates[q]!)?.cost ?? Infinity))
            const next = left.shift()!
            order.push(next)
            at = legFrom(at, gates[next]!)?.end ?? gates[next]!
        }
        return order
    }
    let best: { cost: number, states: GroupState[] } | null = null
    for (const order of gateOrders(gates.length, nearest)) {
        let at: GroupState = start
        let cost = 0
        const states: GroupState[] = [start]
        for (const goal of [...order.map(i => gates[i]!), start]) {
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
    const posts = group.flatMap((f, i) => tiles[i]!.posts.map(([u, v]) => f.world(u, v)))
    const open = (ax: number, az: number, bx: number, bz: number, half = CAR_SIGHT) => groupClear(group, tiles, posts, ax, az, bx, bz, half)
    // Each gate is driven square through, as on any field; the start's pins mark where each lap begins.
    const marks = [start, ...gates]
    type Point = { x: number, z: number, pin: boolean, wx?: number, wz?: number, lap?: true }
    const through = (s: GroupState, from: number, to: number, lap = false): Point[] => {
        const [cx, cz] = centre(s)
        const [dx, dz] = stepWorld(group[s.f]!, s.dir)
        return [from, to].map(d => ({ x: cx + dx * d, z: cz + dz * d, pin: true, ...lap ? { lap: true as const } : {} }))
    }
    const lap: Point[] = through(start, -FIELD_TILE * 0.3, FIELD_TILE * 0.3, true)
    // The last state is the start again, which the next lap's opening pins stand for.
    for (const s of best.states.slice(1, -1)) {
        const gate = marks.some(g => g.f === s.f && g.col === s.col && g.row === s.row && offAxis(g.dir, s.dir) <= 1)
        if (gate) lap.push(...through(s, -FIELD_TILE * 0.3, FIELD_TILE * 0.3))
        else {
            const [x, z] = centre(s)
            const [wx, wz] = stepWorld(group[s.f]!, s.dir)
            lap.push({ x, z, pin: false, wx, wz })
        }
    }
    const local = [through(start, -GRID_BACK, FIELD_TILE * 0.3)[0]!, ...lap, ...lap, ...lap.slice(0, 2)]
    const kept = [local[0]!]
    for (let i = 1; i < local.length; i++) {
        const p = local[i]!
        const next = local[i + 1]
        const from = kept[kept.length - 1]!
        const back = p.wx !== undefined && next && (next.x - from.x) * p.wx + (next.z - from.z) * p.wz! <= 0
        if (p.pin || !next || back || !open(from.x, from.z, next.x, next.z, SIGHT_HALF)) kept.push(p)
    }
    const laps = kept.flatMap((p, i) => p.lap && kept[i + 1]?.lap ? [i] : [])
    return {
        field: home.index,
        fields: group.map(f => f.index),
        points: kept.map(p => [p.x, p.z] as const),
        open: (ax, az, bx, bz) => open(ax, az, bx, bz),
        cycle: { from: laps[0]!, length: laps[1]! - laps[0]! }
    }
}

/** A tile step's way `d` on `field` as a world unit vector. */
function stepWorld(field: CourseField, d: number): [number, number] {
    const [du, dv] = STEPS[d]!
    const n = Math.hypot(du, dv)
    return [(field.rx * du + field.fx * dv) / n, (field.rz * du + field.fz * dv) / n]
}

/** Whether a straight run between two world points stays on open tiles of `group` and off its gate posts, `half` metres either side. */
function groupClear(group: readonly CourseField[], tiles: readonly ReturnType<typeof tilesOf>[], posts: readonly [number, number][], ax: number, az: number, bx: number, bz: number, half: number) {
    const length = Math.hypot(bx - ax, bz - az)
    for (const [px, pz] of posts) {
        const t = length < 1e-6 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / (length * length)))
        if (Math.hypot(ax + (bx - ax) * t - px, az + (bz - az) * t - pz) < GATE_POST_RADIUS + half) return false
    }
    if (length < 1e-6) return true
    const nx = -(bz - az) / length
    const nz = (bx - ax) / length
    for (let d = 0; d <= length; d += 2) {
        const x = ax + (bx - ax) * d / length
        const z = az + (bz - az) * d / length
        for (const side of [-half, 0, half]) {
            const sx = x + nx * side
            const sz = z + nz * side
            // On a seam between two fields either one will do; off every field is a wall.
            const on = group.findIndex((f) => {
                const p = f.local(sx, sz)
                return f.contains(p.u, p.v)
            })
            if (on < 0) return false
            const f = group[on]!
            const p = f.local(sx, sz)
            if (!tiles[on]!.at(Math.min(f.cols - 1, Math.floor(p.u / FIELD_TILE)), Math.min(f.rows - 1, Math.floor(p.v / FIELD_TILE)))) return false
        }
    }
    return true
}
