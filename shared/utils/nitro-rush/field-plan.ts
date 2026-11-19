import { cheapestPath } from './cheapest-path'
import { edgeAt, edgePoint, FIELD_TILE, GATE_POST_RADIUS, GATE_SPAN, gatePosts, isBlocking, isGate, mouthTiles, sharedEdges, type FieldDir } from './field'
import { LINE_MARGIN, LineObstacles, lineSeconds, raceLine, span, type LineBox, type PathPoint, type RaceLine } from './field-line'
import { joinedFields, type CourseField, type FieldMark, type MouthSpot } from './track-fields'
import type { Route } from './track-graph'

/** The bot's path across a field on a route, through every gate: the cheapest gate order by A* over the tiles, cached per route. */

/** Metres behind a field's start gate the grid sits, as the car is placed there. */
export const GRID_BACK = 14

/** A field's plan on one route: its racing line, mouth to mouth. */
export interface FieldPath extends RaceLine {
    field: number
    /** A path over joined fields, as an arena's, covers them all. */
    fields?: readonly number[]
    /** Per point: 1 where it runs over a pad its way, which kicks the car on. */
    pads: Uint8Array
    /** Whether a straight drive between two world points keeps a car's width clear of blocks and pillars. */
    open: (ax: number, az: number, bx: number, bz: number) => boolean
    /** An arena's lap, laid twice from point `from`, `length` points each, so the bot goes round again from the second. */
    cycle?: { from: number, length: number }
}

/** Tile steps, eight ways, as (du, dv), clockwise from the field's forward. */
const STEPS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]] as const
/** Tiles of distance a 45° turn costs, so the plan keeps to straight runs. */
const TURN_COST = 0.35
/** Tiles of distance each pillar squeezed past costs, so the plan only squeezes by one where going round is far longer. */
const PILLAR_COST = 2
/** Tiles of distance turning back out of a gate's tile costs, so only a gate walled in behind is left that way. */
const BACK_COST = 8
/** What a tile costs driven over a pad pointing its way: pads are worth a detour. */
const PAD_SHARE = 0.6
/** Every gate order is tried up to this many gates; more go nearest first. */
const MAX_ORDERED_GATES = 6
const SEARCH_LIMIT = 20_000
/** Metres either side of a straight run that have to be open for the path to skip the tiles between. */
const SIGHT_HALF = 3
/** Metres either side the bot keeps clear aiming straight at a point. */
const CAR_SIGHT = 2
/** Metres the path runs on out of a mouth, so the bot leaves square to the edge, and starts before one on the road. */
export const RUN_OUT = 15
/** Metres between the line's points on the road by a mouth, each held to the road. */
const RUN_STEP = 2.5
/** Metres along the road a point by a mouth may slide. */
const MOUTH_DEPTH = 0.5
/** Metres round each end of a road's mouth on an open seam the line keeps off, where the road's walls end. */
const MOUTH_POST = 1.5
/** Metres in from each mouth the path keeps square to the edge, so the bot turns once it's on the field. */
const SQUARE_IN = 6
/** Metres either way of a gate's centre the line may cross it, its posts kept LINE_MARGIN clear. */
const GATE_WINDOW = GATE_SPAN - GATE_POST_RADIUS - LINE_MARGIN
/** Metres before or past a gate's line the line's point there may be. */
const GATE_DEPTH = 1.5
/** Metres either way of a pad's centre the line keeps to, to be sure to drive over it. */
const PAD_WINDOW = FIELD_TILE / 2 - 1
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

/** The field's tiles: whether one is open to drive, the step direction a pad or gate on it points, and its gate posts; pillars are squeezed past only if `squeeze`. */
function tilesOf(field: CourseField, squeeze = false) {
    const open = new Uint8Array(field.cols * field.rows).fill(1)
    const pillar = new Uint8Array(field.cols * field.rows)
    const pad = new Int8Array(field.cols * field.rows).fill(-1)
    const gate = new Int8Array(field.cols * field.rows).fill(-1)
    for (const t of field.def.plan.tiles) {
        const i = t.col + t.row * field.cols
        if (t.kind === 'pillar' && squeeze) pillar[i] = 1
        if (isBlocking(t.kind)) open[i] = 0
        else if (t.kind === 'boost') pad[i] = t.dir * 2
        else if ('dir' in t && isGate(t.kind)) gate[i] = t.dir * 2
    }
    const on = (col: number, row: number) => col >= 0 && row >= 0 && col < field.cols && row < field.rows
    const at = (col: number, row: number) => on(col, row) && open[col + row * field.cols] === 1
    const pillarAt = (col: number, row: number) => on(col, row) && pillar[col + row * field.cols] === 1
    const block = (col: number, row: number) => !at(col, row) && !pillarAt(col, row)
    // A diagonal step passes the corner its two side tiles share, which a block fills but a pillar leaves room by.
    const cut = (col: number, row: number, du: number, dv: number) => block(col + du, row) || block(col, row + dv) ? -1 : ((pillarAt(col + du, row) ? 1 : 0) + (pillarAt(col, row + dv) ? 1 : 0)) * PILLAR_COST
    // The sides of a pillar's tile driven along way `d` (-1 or 1 along the way a quarter turn clockwise) with no block or wall to squeeze it against.
    const beside = (col: number, row: number, d: number) => {
        const [ru, rv] = STEPS[(d + 2) % 8]!
        return [-1, 1].filter(k => !block(col + ru * k, row + rv * k))
    }
    const gateAt = (col: number, row: number) => col >= 0 && row >= 0 && col < field.cols && row < field.rows ? gate[col + row * field.cols]! : -1
    // Its posts stand either side, so a tile step in or out of a gate's tile goes within 45° of straight through, either way.
    const past = (col: number, row: number, dir: number) => gateAt(col, row) >= 0 && offAxis(gateAt(col, row), dir) > 1
    // Into a gate's tile one way and out of it the other recrosses the gate's line beside a post.
    const back = (col: number, row: number, from: number, to: number) => {
        const g = gateAt(col, row)
        if (g < 0) return false
        const [gu, gv] = STEPS[g]!
        return (STEPS[from]![0] * gu + STEPS[from]![1] * gv) * (STEPS[to]![0] * gu + STEPS[to]![1] * gv) < 0
    }
    const posts = field.def.plan.tiles.flatMap(t => isGate(t.kind) && 'dir' in t ? gatePosts(t) : [])
    return { at, pillar: pillarAt, cut, beside, past, back, posts, pad: (col: number, row: number) => pad[col + row * field.cols]! }
}

type Tiles = ReturnType<typeof tilesOf>

/** What a tile step from `s` on `a` way `d` onto `to` on `b` costs beyond its length; -1 if it can't be driven. */
function stepCost(a: Tiles, s: State, d: number, b: Tiles, to: State) {
    const toPillar = b.pillar(to.col, to.row)
    if (!toPillar && !b.at(to.col, to.row)) return -1
    const [du, dv] = STEPS[d]!
    // A pillar's tile is driven straight through, beside the pillar.
    if (toPillar || a.pillar(s.col, s.row)) {
        if (d !== s.dir || (du && dv)) return -1
        if (!toPillar) return 0
        return b.beside(to.col, to.row, to.dir).length ? PILLAR_COST : -1
    }
    return du && dv ? a.cut(s.col, s.row, du, dv) : 0
}

/** Where the path passes the pillar on `states[j]`'s tile: half a tile aside, toward where it heads either side of the pillars there. */
function besidePillar<S extends State>(states: readonly S[], j: number, fieldOf: (s: S) => CourseField, tilesFor: (s: S) => Tiles): [number, number] {
    const s = states[j]!
    const field = fieldOf(s)
    const centre = (t: S) => fieldOf(t).world((t.col + 0.5) * FIELD_TILE, (t.row + 0.5) * FIELD_TILE)
    const [cx, cz] = centre(s)
    const [rx, rz] = stepWorld(field, (s.dir + 2) % 8)
    const pillared = (t: S) => tilesFor(t).pillar(t.col, t.row)
    let before = j - 1
    while (before > 0 && pillared(states[before]!)) before--
    let after = j + 1
    while (after < states.length - 1 && pillared(states[after]!)) after++
    let lean = 0
    for (const t of [states[before], states[after]]) {
        if (!t) continue
        const [x, z] = centre(t)
        lean += (x - cx) * rx + (z - cz) * rz
    }
    const sides = tilesFor(s).beside(s.col, s.row, s.dir)
    // Square on it leans neither way, and the margin keeps rounding noise from picking a side.
    const side = sides.length > 1 ? (lean < -1e-6 ? -1 : 1) : sides[0]!
    return [cx + rx * side * FIELD_TILE / 2, cz + rz * side * FIELD_TILE / 2]
}

/** A mouth's open tiles, both on the line between two, each with the step direction pointing out of the field there, or `into` it. */
function mouthStates(field: CourseField, tiles: Tiles, m: MouthSpot, into: boolean): State[] {
    const out: Record<MouthSpot['edge'], FieldDir> = { entry: 2, exit: 0, left: 3, right: 1 }
    const dir = (out[m.edge] * 2 + (into ? 4 : 0)) % 8
    return mouthTiles(field.def.plan, m.edge, m.at).filter(t => tiles.at(t.col, t.row)).map(t => ({ ...t, dir }))
}

/** The cheapest drive across the tiles from `from` to `goal`: arriving square on `goal.dir` if it can, else up to 45° off, else any way. */
function leg(field: CourseField, tiles: Tiles, from: State, goal: Goal) {
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
                const to = { col, row, dir: d }
                const extra = stepCost(tiles, s, d, tiles, to)
                if (extra < 0 || tiles.past(col, row, d) || tiles.past(s.col, s.row, d)) continue
                const length = du && dv ? Math.SQRT2 : 1
                out.push({ to, cost: length * (tiles.pad(col, row) === d ? PAD_SHARE : 1) + turn * TURN_COST + (tiles.back(s.col, s.row, s.dir, d) ? BACK_COST : 0) + extra, label: to })
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
function planField(field: CourseField, into: MouthSpot | null, out: MouthSpot | null, again: boolean, squeeze: boolean): FieldPath | null {
    const route = fieldRoute(field, into, out, again, squeeze)
    if (!route) return null
    const line = raceLine(route.points, new LineObstacles([field]), false, !into)
    return { field: field.index, ...line, pads: padsAlong([field], line.points), open: route.open }
}

/** The tile path across `field` as planField lays it, before the line is bent round it, squeezing past pillars if `squeeze`; null if there's none. */
function fieldRoute(field: CourseField, into: MouthSpot | null, out: MouthSpot | null, again: boolean, squeeze: boolean) {
    const tiles = tilesOf(field, squeeze)
    const goalOf = (g: FieldMark | null) => g && { col: g.col, row: g.row, dir: dirOfMark(field, g) }
    const startLine = goalOf(field.start)
    const finishLine = goalOf(field.finish)
    const starts = into ? mouthStates(field, tiles, into, true) : startLine ? [startLine] : []
    // A finish counts either way through, so the route may end over it from whichever side is nearer.
    const ends: Goal[] = out ? mouthStates(field, tiles, out, false) : finishLine ? [{ ...finishLine, either: true }] : []
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
    return { points: smooth(field, tiles, best.states, [...gates, ...[startLine, finishLine].filter(g => g !== null)], into, out), open }
}

/** One line over a run of joined fields, bent as a whole, so the bot never lines up square for the slot between them. */
function planChain(joined: readonly RouteCrossing[], squeeze: boolean): FieldPath | null {
    // Fields a road joins that also share an edge are driven straight over it, as the physics lets the car cross anywhere along it.
    const crossings = joined.map(c => ({ ...c }))
    let moved = false
    for (let k = 1; k < crossings.length; k++) {
        const prev = crossings[k - 1]!
        const c = crossings[k]!
        if (c.into!.branch < 0 || !sharedEdges(prev.field.def, [prev.field.def, c.field.def]).length) continue
        const across = crossOver(prev.field, c.field, prev.into, lineUp(c.field, c.out, c.field.finish), squeeze)
        if (!across) continue
        prev.out = across.out
        c.into = across.into
        moved = true
    }
    // A slot off the road the tiles can't reach both sides of leaves the road's mouth.
    return (moved ? chainLine(crossings, squeeze) : null) ?? chainLine(joined, squeeze)
}

/** The line over `crossings`, each in and out where it says; null if a field has no way across. */
function chainLine(crossings: readonly RouteCrossing[], squeeze: boolean): FieldPath | null {
    const points: PathPoint[] = []
    for (const [k, c] of crossings.entries()) {
        const route = fieldRoute(c.field, c.into, c.out, c.again, squeeze)
        if (!route) return null
        // Where fields meet, drop the road each side and keep one point on the edge, free to slide along it.
        let part = route.points
        if (k > 0) part = part.slice(roadRunLength + (c.into!.branch < 0 ? 1 : 0))
        if (k < crossings.length - 1) {
            part = part.slice(0, part.length - roadRunLength)
            if (c.out!.branch < 0) part[part.length - 1] = { ...part[part.length - 1]!, fixed: false }
        }
        points.push(...part)
    }
    const group = crossings.map(c => c.field)
    const tiles = group.map(f => tilesOf(f))
    const posts = group.flatMap((f, i) => tiles[i]!.posts.map(([u, v]) => f.world(u, v)))
    // Off a road's mouth the physics puts the car on the road, so a road join is crossed only there; an edge-to-edge seam anywhere.
    const defs = group.map(f => f.def)
    const seams = (f: CourseField) => crossings.flatMap((c, k) => [
        ...k > 0 && c.field === f ? [c.into!] : [],
        ...k < crossings.length - 1 && c.field === f ? [c.out!] : []
    ]).flatMap(m => m.branch >= 0 ? [m] : sharedEdges(f.def, defs))
    // Beside a road's mouth on an open seam the physics puts the car on the road, against its walls.
    const roadEnds = group.flatMap(f => f.mouths.filter(m => m.branch >= 0 && sharedEdges(f.def, defs).some(e => e.edge === m.edge && Math.abs(m.at - e.at) <= e.half)).flatMap(m => [-1, 1].map((side) => {
        const { u, v } = edgePoint(f.def.plan, m.edge, m.at + side * m.half)
        const [x, z] = f.world(u, v)
        return [x, z, MOUTH_POST] as const
    })))
    const line = raceLine(points, new LineObstacles(group, seams, roadEnds), false, !crossings[0]!.into)
    return {
        field: group[0]!.index,
        fields: [...new Set(group.map(f => f.index))],
        ...line,
        pads: padsAlong(group, line.points),
        open: (ax, az, bx, bz) => groupClear(group, tiles, posts, ax, az, bx, bz, CAR_SIGHT)
    }
}

/** A gate's way across as a step direction. */
function dirOfMark(field: CourseField, g: FieldMark) {
    for (let q = 0; q < 4; q++) {
        const [dx, dz] = field.direction(q)
        if (dx * g.dx + dz * g.dz > 0.5) return q * 2
    }
    return 0
}

/** A box on `field` round local (u, v), `hu` either way along local way (du, dv) and from `vlo` to `vhi` to its left. */
function boxOn(field: CourseField, u: number, v: number, du: number, dv: number, hu: number, vlo: number, vhi: number): LineBox {
    const [cx, cz] = field.world(u, v)
    const n = span(du, dv)
    return { cx, cz, ux: (field.rx * du + field.fx * dv) / n, uz: (field.rz * du + field.fz * dv) / n, hu, vlo, vhi }
}

/** A gate's span, which the line's point there keeps to, so the line goes through between the posts. */
function gateBox(field: CourseField, g: State) {
    const [du, dv] = STEPS[(g.dir + 2) % 8]!
    return { ...boxOn(field, (g.col + 0.5) * FIELD_TILE, (g.row + 0.5) * FIELD_TILE, du, dv, GATE_WINDOW, -GATE_DEPTH, GATE_DEPTH) }
}

/** Boxes either side of a gate for the line's points before and past it, driven along step way `dir`, so the line can't turn back short of it. */
function gateSides(field: CourseField, g: State, dir: number): [LineBox, LineBox] {
    const box = gateBox(field, g)
    const [tx, tz] = stepWorld(field, dir)
    const ahead = -tx * box.uz + tz * box.ux > 0 ? 1 : -1
    const side = (s: number): LineBox => s > 0 ? { ...box, vlo: GATE_DEPTH, vhi: FIELD_TILE / 2 } : { ...box, vlo: -FIELD_TILE / 2, vhi: -GATE_DEPTH }
    return [side(-ahead), side(ahead)]
}

/** The tile path for the racing line: through its turns, gates and pads only, straight wherever the ground between is open. */
function smooth(field: CourseField, tiles: Tiles, states: readonly State[], gates: readonly State[], into: MouthSpot | null, out: MouthSpot | null): PathPoint[] {
    type Local = { u: number, v: number, pin: boolean, fixed?: boolean, box?: LineBox, dir?: number }
    const centre = (s: State) => ({ u: (s.col + 0.5) * FIELD_TILE, v: (s.row + 0.5) * FIELD_TILE })
    // Each gate is driven through: in from the middle of its tile's back half, across its span, out through the front half.
    const through = (s: State, g: State, from: number): Local[] => {
        const c = centre(s)
        const [du, dv] = STEPS[s.dir]!
        const at = (d: number) => ({ u: c.u + du * d, v: c.v + dv * d, pin: true })
        const [before, after] = gateSides(field, g, s.dir)
        return [{ ...at(from), ...from === -GRID_BACK ? { fixed: true } : { box: before } }, { ...at(0), box: gateBox(field, g) }, { ...at(FIELD_TILE * 0.3), box: after }]
    }
    // A road's mouth the line may cross anywhere its width allows; where joined fields meet, it keeps to its slot.
    const inside = (m: MouthSpot): Local[] => {
        const p = field.local(m.x, m.z)
        const [du, dv] = OUTWARD[m.edge]
        const into = { u: p.u - du * SQUARE_IN, v: p.v - dv * SQUARE_IN, pin: true }
        return m.branch >= 0 ? [into] : [{ ...p, pin: true, fixed: true }, into]
    }
    const gateOf = (s: State) => gates.find(g => g.col === s.col && g.row === s.row && offAxis(g.dir, s.dir) <= 1)
    // From the grid, the path sets off behind the start gate and runs through it.
    const local: Local[] = into ? inside(into) : through(states[0]!, gateOf(states[0]!) ?? states[0]!, -GRID_BACK)
    for (let j = 1; j < states.length; j++) {
        const s = states[j]!
        const gate = gateOf(s)
        if (gate) local.push(...through(s, gate, -FIELD_TILE * 0.3))
        else if (tiles.pillar(s.col, s.row)) local.push({ ...field.local(...besidePillar(states, j, () => field, () => tiles)), pin: true })
        else if (tiles.pad(s.col, s.row) === s.dir) {
            local.push({ ...centre(s), pin: true, box: padBox(field, s) })
        } else local.push({ ...centre(s), pin: false, dir: s.dir })
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
    const points: PathPoint[] = kept.map((p) => {
        const [x, z] = field.world(p.u, p.v)
        return { x, z, fixed: p.fixed, box: p.box }
    })
    // The road runs straight on either side of a mouth, so the line comes in and goes out along it.
    if (into) points.unshift(...roadRun(field, into, true))
    if (out) points.push(...roadRun(field, out, false).reverse())
    else {
        // Past the finish it runs straight on, wherever that leads.
        const last = states[states.length - 1]!
        const [ox, oz] = field.direction(last.dir / 2)
        const { x, z } = points[points.length - 1]!
        points.push({ x: x + ox * RUN_OUT, z: z + oz * RUN_OUT, fixed: true })
    }
    return points
}

/** Points roadRun lays. */
const roadRunLength = Math.floor(RUN_OUT / RUN_STEP) + 1

/** The line's points on the road off mouth `m`: free across it so the line can take the mouth on a slant, but met mid-road. */
function roadRun(field: CourseField, m: MouthSpot, into: boolean): PathPoint[] {
    const p = field.local(m.x, m.z)
    const [du, dv] = OUTWARD[m.edge]
    const free = m.branch >= 0 ? Math.max(0, m.half - LINE_MARGIN) : 0
    const out: PathPoint[] = []
    for (let d = RUN_OUT; d >= 0; d -= RUN_STEP) {
        const [x, z] = field.world(p.u + du * d, p.v + dv * d)
        const reach = into ? free * (1 - d / RUN_OUT) * (1 - d / RUN_OUT) : free
        out.push(reach > 0 ? { x, z, road: true, box: boxOn(field, p.u + du * d, p.v + dv * d, -dv, du, reach, -MOUTH_DEPTH, MOUTH_DEPTH) } : { x, z, fixed: true })
    }
    return out
}

/** Whether a straight run from `a` to `b` stays on open tiles and off gate posts, `half` metres either side. */
function clear(field: CourseField, tiles: Tiles, a: { u: number, v: number }, b: { u: number, v: number }, half = SIGHT_HALF) {
    const length = span(b.u - a.u, b.v - a.v)
    for (const [pu, pv] of tiles.posts) {
        const t = length < 1e-6 ? 0 : Math.max(0, Math.min(1, ((pu - a.u) * (b.u - a.u) + (pv - a.v) * (b.v - a.v)) / (length * length)))
        if (span(a.u + (b.u - a.u) * t - pu, a.v + (b.v - a.v) * t - pv) < GATE_POST_RADIUS + half) return false
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
        const toward = lineUp(to, p.out, to.finish)
        for (let k = 0; k + 1 < chain.length; k++) {
            const across = crossOver(chain[k]!, chain[k + 1]!, into, toward, false) ?? crossOver(chain[k]!, chain[k + 1]!, into, toward, true)
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

/** Where the bot drives over the edge from field `a` onto `b`: the slot of the stretch they share it can reach on the straightest way from where it came in (or its start gate) on `toward`. */
function crossOver(a: CourseField, b: CourseField, into: MouthSpot | null, toward: { x: number, z: number } | null, squeeze: boolean) {
    const shared = sharedEdges(a.def, [a.def, b.def])[0]
    if (!shared) return null
    const from = into ?? (a.start ? lineUp(a, null, a.start, -1) : null) ?? (() => {
        const [x, z] = a.world(a.width / 2, a.length / 2)
        return { x, z }
    })()
    const spots: number[] = []
    for (let at = shared.at - shared.half + FIELD_TILE / 2; at <= shared.at + shared.half - FIELD_TILE / 2 + 1e-6; at += FIELD_TILE / 2) spots.push(at)
    const local = (at: number) => edgePoint(a.def.plan, shared.edge, at)
    const tilesA = tilesOf(a)
    const tilesB = tilesOf(b)
    const way = (at: number) => {
        const { u, v } = local(at)
        const [x, z] = a.world(u, v)
        return span(x - from.x, z - from.z) + (toward ? span(x - toward.x, z - toward.z) : 0)
    }
    // Slots tie on a straight run across, so the nearer one to where it came in goes first, as before.
    spots.sort((p, q) => way(p) - way(q))
    for (const at of spots) {
        const { u, v } = local(at)
        const [x, z] = a.world(u, v)
        const out: MouthSpot = { branch: -1, s: 0, edge: shared.edge, at, half: FIELD_TILE / 2, x, z }
        const p = b.local(x, z)
        const onB = edgeAt(b.def.plan, p.u, p.v, 0.05)
        // Beside a block either side, the car would cross the seam against its wall.
        if (!onB || !mouthTiles(a.def.plan, shared.edge, at).every(t => tilesA.at(t.col, t.row))) continue
        if (!mouthTiles(b.def.plan, onB.edge, onB.at).every(t => tilesB.at(t.col, t.row)) || !fieldRoute(a, into, out, true, squeeze)) continue
        return { out, into: { ...out, edge: onB.edge, at: onB.at } }
    }
    return null
}

/** Metres before a mouth or gate a crossing lines up to go through it square, which the way over a seam aims for. */
const LINE_UP = 40

/** The spot LINE_UP inside `field` square off mouth `m`, or else before gate `mark` (past it, `sign` -1, for one it sets off through). */
function lineUp(field: CourseField, m: MouthSpot | null, mark: FieldMark | null, sign = 1): { x: number, z: number } | null {
    if (m) {
        const p = field.local(m.x, m.z)
        const [du, dv] = OUTWARD[m.edge]
        const [x, z] = field.world(p.u - du * LINE_UP, p.v - dv * LINE_UP)
        return { x, z }
    }
    return mark && { x: mark.x - mark.dx * LINE_UP * sign, z: mark.z - mark.dz * LINE_UP * sign }
}

/** Crossings in runs driven straight from one field onto the next, where they meet or a road's mouths do. */
function chainsOf(crossings: readonly RouteCrossing[]) {
    const out: RouteCrossing[][] = []
    for (const c of crossings) {
        const last = out[out.length - 1]
        const prev = last?.[last.length - 1]
        if (prev?.out && c.into && span(prev.out.x - c.into.x, prev.out.z - c.into.z) < 1) last!.push(c)
        else out.push([c])
    }
    return out
}

const plans = new WeakMap<Route, FieldPath[]>()

/** The bot's path across each field `route` crosses, worked out once per route. */
export function routeFieldPaths(fields: readonly CourseField[], route: Route): readonly FieldPath[] {
    let cached = plans.get(route)
    if (!cached) {
        const arena = fields.length && fields.every(f => !f.mouths.length) && fields.some(f => f.start)
        cached = arena
            ? [quicker(fields, true, squeeze => planArena(fields, squeeze))].filter(p => p !== null)
            : chainsOf(routeCrossings(fields, route)).flatMap(chain => quicker(chain.map(c => c.field), !chain[0]!.into, squeeze => chain.length > 1 ? planChain(chain, squeeze) : planField(chain[0]!.field, chain[0]!.into, chain[0]!.out, chain[0]!.again, squeeze)) ?? [])
        plans.set(route, cached)
    }
    return cached
}

/** `plan` going round pillars, or squeezing past them where that drives quicker, which tile costs can't tell. */
function quicker(fields: readonly CourseField[], fromRest: boolean, plan: (squeeze: boolean) => FieldPath | null) {
    const round = plan(false)
    if (!fields.some(f => f.def.plan.tiles.some(t => t.kind === 'pillar'))) return round
    const squeezed = plan(true)
    if (!round || !squeezed) return round ?? squeezed
    // Within the margin it goes round, so rounding noise never picks the squeeze.
    return lineSeconds(squeezed, fromRest) < lineSeconds(round, fromRest) - 1e-6 ? squeezed : round
}

/** A tile on one of an arena's fields, by its index among them. */
interface GroupState extends State {
    f: number
}

/**
 * The bot's lap round an arena, a loop of joined fields no road meets: from the start gate through every
 * checkpoint in the cheapest order and back through the start, in world points; null if there's none.
 */
function planArena(fields: readonly CourseField[], squeeze: boolean): FieldPath | null {
    const home = fields.find(f => f.start)
    if (!home) return null
    const group = joinedFields(fields, home.index)
    const tiles = group.map(f => tilesOf(f, squeeze))
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
                    if (!to || tiles[to.f]!.past(to.col, to.row, to.dir) || tiles[s.f]!.past(s.col, s.row, d)) continue
                    const extra = stepCost(tiles[s.f]!, s, d, tiles[to.f]!, to)
                    if (extra < 0) continue
                    const [du, dv] = STEPS[d]!
                    const length = du && dv ? Math.SQRT2 : 1
                    out.push({ to, cost: length * (tiles[to.f]!.pad(to.col, to.row) === to.dir ? PAD_SHARE : 1) + turn * TURN_COST + extra, label: to })
                }
                return out
            },
            done: s => s.f === goal.f && s.col === goal.col && s.row === goal.row && (goal.either ? offAxis(goal.dir, s.dir) : turnOf(s.dir, goal.dir)) <= slack,
            estimate: (s) => {
                const [x, z] = centre(s)
                return span(x - gx, z - gz) / FIELD_TILE * PAD_SHARE
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
    const marks = [start, ...gates]
    type Point = { x: number, z: number, pin: boolean, box?: LineBox, wx?: number, wz?: number }
    // Each gate is driven through as on any field: in from its tile's back half, across its span, out through the front half.
    const through = (s: GroupState, g: GroupState): Point[] => {
        const [cx, cz] = centre(s)
        const [dx, dz] = stepWorld(group[s.f]!, s.dir)
        const at = (d: number) => ({ x: cx + dx * d, z: cz + dz * d, pin: true })
        const [before, after] = gateSides(group[g.f]!, g, s.dir)
        return [{ ...at(-FIELD_TILE * 0.3), box: before }, { ...at(0), box: gateBox(group[g.f]!, g) }, { ...at(FIELD_TILE * 0.3), box: after }]
    }
    // The lap from the start gate's middle round to just short of it again; the last state is the start, which the first stands for.
    const [behind, ...onward] = through(start, start)
    const lap: Point[] = onward
    for (let j = 1; j < best.states.length - 1; j++) {
        const s = best.states[j]!
        const gate = marks.find(g => g.f === s.f && g.col === s.col && g.row === s.row && offAxis(g.dir, s.dir) <= 1)
        if (gate) lap.push(...through(s, gate))
        else if (tiles[s.f]!.pillar(s.col, s.row)) {
            const [x, z] = besidePillar(best.states, j, t => group[t.f]!, t => tiles[t.f]!)
            lap.push({ x, z, pin: true })
        } else {
            const [x, z] = centre(s)
            const [wx, wz] = stepWorld(group[s.f]!, s.dir)
            const pad = tiles[s.f]!.pad(s.col, s.row) === s.dir
            lap.push({ x, z, pin: pad, wx, wz, ...pad ? { box: padBox(group[s.f]!, s) } : {} })
        }
    }
    lap.push(behind!)
    const kept = [lap[0]!]
    for (let i = 1; i < lap.length; i++) {
        const p = lap[i]!
        const next = lap[i + 1] ?? lap[0]!
        const from = kept[kept.length - 1]!
        const back = p.wx !== undefined && (next.x - from.x) * p.wx + (next.z - from.z) * p.wz! <= 0
        if (p.pin || back || !open(from.x, from.z, next.x, next.z, SIGHT_HALF)) kept.push(p)
    }
    const defs = group.map(f => f.def)
    const loop = raceLine(kept, new LineObstacles(group, f => sharedEdges(f.def, defs)), true)
    // From the grid straight onto the lap where it crosses the start, then the lap laid twice, so the bot goes round again from the second.
    const [gx, gz] = gridPoint(group[start.f]!, start)
    const [lx, lz] = loop.points[0]!
    const leadSteps = Math.max(1, Math.round(span(lx - gx, lz - gz) / 2))
    const lead = Array.from({ length: leadSteps }, (_, k) => [gx + (lx - gx) * k / leadSteps, gz + (lz - gz) * k / leadSteps] as [number, number])
    const points = [...lead, ...loop.points, ...loop.points, loop.points[0]!]
    const curvature = Float64Array.from([...lead.map(() => 0), ...loop.curvature, ...loop.curvature, loop.curvature[0]!])
    const cum = new Float64Array(points.length)
    for (let j = 1; j < points.length; j++) cum[j] = cum[j - 1]! + span(points[j]![0] - points[j - 1]![0], points[j]![1] - points[j - 1]![1])
    return {
        field: home.index,
        fields: group.map(f => f.index),
        points,
        curvature,
        cum,
        pads: padsAlong(group, points),
        open: (ax, az, bx, bz) => open(ax, az, bx, bz),
        cycle: { from: lead.length, length: loop.points.length }
    }
}

/** Which of `points` lie on a pad of `fields`, with the way on to the next point within a quarter turn of the pad's. */
function padsAlong(fields: readonly CourseField[], points: readonly (readonly [number, number])[]) {
    const out = new Uint8Array(points.length)
    for (let i = 0; i + 1 < points.length; i++) {
        const [x, z] = points[i]!
        const dx = points[i + 1]![0] - x
        const dz = points[i + 1]![1] - z
        for (const f of fields) {
            const p = f.local(x, z)
            const pad = f.padUnder(p.u, p.v)
            if (pad && pad.dx * dx + pad.dz * dz > 0) out[i] = 1
        }
    }
    return out
}

/** Where the grid sits behind a start gate, in the world. */
function gridPoint(field: CourseField, s: State): [number, number] {
    const [dx, dz] = stepWorld(field, s.dir)
    const [cx, cz] = field.world((s.col + 0.5) * FIELD_TILE, (s.row + 0.5) * FIELD_TILE)
    return [cx - dx * GRID_BACK, cz - dz * GRID_BACK]
}

/** A pad's tile, shrunk so a car on the line is surely over it. */
const padBox = (field: CourseField, s: State) => boxOn(field, (s.col + 0.5) * FIELD_TILE, (s.row + 0.5) * FIELD_TILE, 1, 0, PAD_WINDOW, -PAD_WINDOW, PAD_WINDOW)

/** A tile step's way `d` on `field` as a world unit vector. */
function stepWorld(field: CourseField, d: number): [number, number] {
    const [du, dv] = STEPS[d]!
    const n = span(du, dv)
    return [(field.rx * du + field.fx * dv) / n, (field.rz * du + field.fz * dv) / n]
}

/** Whether a straight run between two world points stays on open tiles of `group` and off its gate posts, `half` metres either side. */
function groupClear(group: readonly CourseField[], tiles: readonly Tiles[], posts: readonly [number, number][], ax: number, az: number, bx: number, bz: number, half: number) {
    const length = span(bx - ax, bz - az)
    for (const [px, pz] of posts) {
        const t = length < 1e-6 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / (length * length)))
        if (span(ax + (bx - ax) * t - px, az + (bz - az) * t - pz) < GATE_POST_RADIUS + half) return false
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
