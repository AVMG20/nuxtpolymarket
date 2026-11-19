import { blockWalls, edgeWalls, FIELD_TILE, GATE_POST_RADIUS, gatePosts, isGate, PILLAR_RADIUS, type EdgeOpening } from './field'
import { RACING_MARGIN, racingLine } from './racing-line'
import type { CourseField } from './track-fields'

/** The bot's racing line across open field: the tile path rounded off, then bent across its room as the road's line is. */

/** The length of (dx, dz); Math.hypot rounds differently in V8 and JavaScriptCore, which split the plan between browsers. */
export const span = (dx: number, dz: number) => Math.sqrt(dx * dx + dz * dz)

/** Metres the line keeps from any wall, block, pillar or gate post: the car's half width and room to stray. */
export const LINE_MARGIN = 2.1
/** Metres between the line's points. */
const SPACING = 2
/** The most a point moves in one rounding pass, so it never hops over a post. */
const MAX_MOVE = 0.8
/** Passes rounding off the tile path's corners before the line is bent across the room round it. */
const ROUNDING = 60
/** Metres either side the room round the rounded path is measured out to, and in what steps. */
const MAX_ROOM = 60
const ROOM_STEP = 0.5
/** Share of a bend's radius the line may cut in toward its middle, so neighbouring points' ways across never cross. */
const INSIDE_SHARE = 0.7
const CELL = 8
/** Times the line is bent across its room, each from the last one's line, so a hairpin the rounding drew tight swings out wide. */
const SOLVES = 3
/** Passes spreading the points evenly along the line between solves. */
const EVENING = 10
/** Metres a solve may stretch the gap between two neighbouring points; past it the solve has torn the line there. */
const MAX_STRETCH = 2 * SPACING
/** Metres across a point may have moved where a torn stretch of a solve is undone back to, so the line joins up again. */
const SETTLED = 0.5

/** Somewhere a point of the line has to stay: `hu` either way along (ux, uz) from the centre, and from `vlo` to `vhi` across it, to its left. */
export interface LineBox {
    cx: number
    cz: number
    ux: number
    uz: number
    hu: number
    vlo: number
    vhi: number
}

/** A point of the planner's path: `fixed` ones stay put, a `box` keeps one inside it, the rest go where the line wants. */
export interface PathPoint {
    x: number
    z: number
    fixed?: boolean
    box?: LineBox
    /** On the road by a mouth, held to the road by its box alone, as the field's walls are shut across the mouth. */
    road?: boolean
}

export interface RaceLine {
    points: [number, number][]
    /** Per point: how sharply the line turns, in radians per metre, + to the left. */
    curvature: Float64Array
    /** Per point: metres along the line. */
    cum: Float64Array
}

/** What the line keeps clear of, in the world: wall faces as (x0, z0, x1, z1) and posts as (x, z, radius), found by grid cell. */
export class LineObstacles {
    private readonly segs: number[] = []
    private readonly posts: number[] = []
    private readonly cells = new Map<number, { segs: number[], posts: number[] }>()

    /** `fields` walled all round but for each one's `openings`; mouths are walled unless listed, so the line keeps to the fields. Plus `posts`, as (x, z, radius). */
    constructor(fields: readonly CourseField[], openings: (field: CourseField) => readonly EdgeOpening[] = () => [], posts: readonly (readonly [number, number, number])[] = []) {
        for (const [x, z, r] of posts) this.addPost(x, z, r)
        for (const f of fields) {
            for (const w of [...edgeWalls(f.def.plan, openings(f)), ...blockWalls(f.def.plan)]) {
                const [x0, z0] = f.world(w.x0, w.z0)
                const [x1, z1] = f.world(w.x1, w.z1)
                this.addSeg(x0, z0, x1, z1)
            }
            for (const t of f.def.plan.tiles) {
                if (t.kind === 'pillar') this.addPost(...f.world((t.col + 0.5) * FIELD_TILE, (t.row + 0.5) * FIELD_TILE), PILLAR_RADIUS)
                else if (isGate(t.kind) && 'dir' in t) for (const [u, v] of gatePosts(t)) this.addPost(...f.world(u, v), GATE_POST_RADIUS)
            }
        }
    }

    private cellsOver(x0: number, z0: number, x1: number, z1: number, add: (cell: { segs: number[], posts: number[] }) => void) {
        const reach = LINE_MARGIN + MAX_MOVE + 1
        for (let cx = Math.floor((Math.min(x0, x1) - reach) / CELL); cx <= Math.floor((Math.max(x0, x1) + reach) / CELL); cx++) {
            for (let cz = Math.floor((Math.min(z0, z1) - reach) / CELL); cz <= Math.floor((Math.max(z0, z1) + reach) / CELL); cz++) {
                const key = cx * 100_003 + cz
                let cell = this.cells.get(key)
                if (!cell) this.cells.set(key, cell = { segs: [], posts: [] })
                add(cell)
            }
        }
    }

    private addSeg(x0: number, z0: number, x1: number, z1: number) {
        const i = this.segs.length
        this.segs.push(x0, z0, x1, z1)
        this.cellsOver(x0, z0, x1, z1, c => c.segs.push(i))
    }

    private addPost(x: number, z: number, r: number) {
        const i = this.posts.length
        this.posts.push(x, z, r)
        this.cellsOver(x - r, z - r, x + r, z + r, c => c.posts.push(i))
    }

    /** Metres from (x, z) to the nearest thing it keeps clear of, past LINE_MARGIN + MAX_MOVE counted as clear; `away` gets the way out from it. */
    clearance(x: number, z: number, away?: { x: number, z: number }) {
        const cell = this.cells.get(Math.floor(x / CELL) * 100_003 + Math.floor(z / CELL))
        let best = Infinity
        if (!cell) return best
        const s = this.segs
        for (const i of cell.segs) {
            const dx = s[i + 2]! - s[i]!
            const dz = s[i + 3]! - s[i + 1]!
            const t = Math.max(0, Math.min(1, ((x - s[i]!) * dx + (z - s[i + 1]!) * dz) / (dx * dx + dz * dz || 1)))
            const ox = x - s[i]! - dx * t
            const oz = z - s[i + 1]! - dz * t
            const d = span(ox, oz)
            if (d < best) {
                best = d
                if (away) {
                    away.x = ox / (d || 1)
                    away.z = oz / (d || 1)
                }
            }
        }
        const p = this.posts
        for (const i of cell.posts) {
            const ox = x - p[i]!
            const oz = z - p[i + 1]!
            const c = span(ox, oz)
            const d = c - p[i + 2]!
            if (d < best) {
                best = d
                if (away) {
                    away.x = ox / (c || 1)
                    away.z = oz / (c || 1)
                }
            }
        }
        return best
    }
}

/** Signed curvature of the circle through three points, + bending to the left as a car sees it. */
export function leftBend(ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
    const x1 = cx - bx
    const z1 = cz - bz
    const x2 = ax - bx
    const z2 = az - bz
    const x3 = cx - ax
    const z3 = cz - az
    const norms = Math.sqrt((x1 * x1 + z1 * z1) * (x2 * x2 + z2 * z2) * (x3 * x3 + z3 * z3))
    return norms > 0 ? -2 * (x1 * z2 - x2 * z1) / norms : 0
}

/** The path as points every SPACING metres, each keeping its source point's role at its exact spot; between two fixed ones, fixed too. */
function resample(path: readonly PathPoint[], loop: boolean): PathPoint[] {
    const out: PathPoint[] = []
    const n = path.length
    for (let i = 0; i < (loop ? n : n - 1); i++) {
        const a = path[i]!
        const b = path[(i + 1) % n]!
        out.push({ ...a })
        const steps = Math.max(1, Math.round(span(b.x - a.x, b.z - a.z) / SPACING))
        for (let k = 1; k < steps; k++) out.push({ x: a.x + (b.x - a.x) * k / steps, z: a.z + (b.z - a.z) * k / steps, fixed: !!a.fixed && !!b.fixed })
    }
    if (!loop) out.push({ ...path[n - 1]! })
    return out
}

function clampToBox(b: LineBox, x: number, z: number): [number, number] {
    const dx = x - b.cx
    const dz = z - b.cz
    const u = Math.max(-b.hu, Math.min(b.hu, dx * b.ux + dz * b.uz))
    const v = Math.max(b.vlo, Math.min(b.vhi, -dx * b.uz + dz * b.ux))
    return [b.cx + b.ux * u - b.uz * v, b.cz + b.uz * u + b.ux * v]
}

/** Rounds the path's corners: each point eases toward its neighbours' middle, never nearer anything than LINE_MARGIN. */
function round(pts: readonly PathPoint[], xs: Float64Array, zs: Float64Array, obstacles: LineObstacles, loop: boolean) {
    const n = pts.length
    const away = { x: 0, z: 0 }
    for (let pass = 0; pass < ROUNDING; pass++) {
        for (let j = 0; j < n; j++) {
            const pt = pts[j]!
            if (pt.fixed || (!loop && (j === 0 || j === n - 1))) continue
            const a = (j - 1 + n) % n
            const c = (j + 1) % n
            let x = xs[j]! + ((xs[a]! + xs[c]!) / 2 - xs[j]!) * 0.5
            let z = zs[j]! + ((zs[a]! + zs[c]!) / 2 - zs[j]!) * 0.5
            const step = span(x - xs[j]!, z - zs[j]!)
            if (step > MAX_MOVE) {
                x = xs[j]! + (x - xs[j]!) * MAX_MOVE / step
                z = zs[j]! + (z - zs[j]!) * MAX_MOVE / step
            }
            if (pt.box) [x, z] = clampToBox(pt.box, x, z)
            if (pt.road) {
                xs[j] = x
                zs[j] = z
                continue
            }
            let room = obstacles.clearance(x, z, away)
            if (room < LINE_MARGIN) {
                x += away.x * (LINE_MARGIN - room)
                z += away.z * (LINE_MARGIN - room)
                if (pt.box) [x, z] = clampToBox(pt.box, x, z)
                room = obstacles.clearance(x, z)
            }
            if (room < LINE_MARGIN - 1e-6) continue
            xs[j] = x
            zs[j] = z
        }
    }
}

/** Slides each point along the line toward the middle of its neighbours, so a line bent wide of its path has its points evenly spread again. */
function even(pts: readonly PathPoint[], xs: Float64Array, zs: Float64Array, obstacles: LineObstacles, loop: boolean) {
    const n = pts.length
    for (let pass = 0; pass < EVENING; pass++) {
        for (let j = 0; j < n; j++) {
            const pt = pts[j]!
            if (pt.fixed || (!loop && (j === 0 || j === n - 1))) continue
            const a = (j - 1 + n) % n
            const c = (j + 1) % n
            const tx = xs[c]! - xs[a]!
            const tz = zs[c]! - zs[a]!
            const chord = span(tx, tz)
            if (chord < 1e-9) continue
            const shift = (span(xs[c]! - xs[j]!, zs[c]! - zs[j]!) - span(xs[j]! - xs[a]!, zs[j]! - zs[a]!)) / 2 * 0.5
            let x = xs[j]! + tx / chord * shift
            let z = zs[j]! + tz / chord * shift
            if (pt.box) [x, z] = clampToBox(pt.box, x, z)
            if (!pt.road && obstacles.clearance(x, z) < LINE_MARGIN - 1e-6) continue
            xs[j] = x
            zs[j] = z
        }
    }
}

/**
 * Undoes `offsets` (metres across along `txs`, `tzs`'s right) wherever they tear the line: pull two neighbours far apart or fold it
 * back on itself, which the bot can't drive and which cuts past what the points keep clear of. Each tear is undone out to where
 * its points had barely moved; if that still leaves one, the whole solve is.
 */
function unfold(xs: Float64Array, zs: Float64Array, txs: Float64Array, tzs: Float64Array, offsets: Float64Array, loop: boolean) {
    const n = xs.length
    const at = (j: number) => loop ? ((j % n) + n) % n : j
    const torn = (j: number) => {
        // The segment from point j to the next, before and after; and whether the line runs back on itself at j.
        const a = at(j)
        const b = at(j + 1)
        const ax = xs[a]! - tzs[a]! * offsets[a]!
        const az = zs[a]! + txs[a]! * offsets[a]!
        const bx = xs[b]! - tzs[b]! * offsets[b]!
        const bz = zs[b]! + txs[b]! * offsets[b]!
        if (span(bx - ax, bz - az) > span(xs[b]! - xs[a]!, zs[b]! - zs[a]!) + MAX_STRETCH) return true
        if (!loop && j === 0) return false
        const p = at(j - 1)
        const px = xs[p]! - tzs[p]! * offsets[p]!
        const pz = zs[p]! + txs[p]! * offsets[p]!
        const folded = (ax - px) * (bx - ax) + (az - pz) * (bz - az) < 0
        return folded && (xs[a]! - xs[p]!) * (xs[b]! - xs[a]!) + (zs[a]! - zs[p]!) * (zs[b]! - zs[a]!) >= 0
    }
    const last = loop ? n : n - 1
    const tears: number[] = []
    for (let j = 0; j < last; j++) if (torn(j)) tears.push(j)
    if (!tears.length) return
    for (const j of tears) {
        let from = j
        let to = j + 1
        for (let k = 0; k < n && Math.abs(offsets[at(from)]!) > SETTLED && (loop || from > 0); k++) from--
        for (let k = 0; k < n && Math.abs(offsets[at(to)]!) > SETTLED && (loop || to < n - 1); k++) to++
        for (let k = from; k <= to && k - from < n; k++) offsets[at(k)] = 0
    }
    for (let j = 0; j < last; j++) {
        if (torn(j)) {
            offsets.fill(0)
            return
        }
    }
}

/** Metres from (x, z) along (dx, dz) that stay LINE_MARGIN clear, unless on the `road`, and inside `box` if given. */
function roomAlong(obstacles: LineObstacles, x: number, z: number, dx: number, dz: number, box?: LineBox, road?: boolean) {
    let room = 0
    for (let d = ROOM_STEP; d <= MAX_ROOM; d += ROOM_STEP) {
        const px = x + dx * d
        const pz = z + dz * d
        if (!road && obstacles.clearance(px, pz) < LINE_MARGIN) break
        if (box) {
            const [bx, bz] = clampToBox(box, px, pz)
            if (span(bx - px, bz - pz) > 1e-6) break
        }
        room = d
    }
    return room
}

/** Metres point `j` may go either way along (rx, rz) before it's as near another point as its own, past which a hairpin's sides cross. */
function foldRoom(xs: Float64Array, zs: Float64Array, j: number, rx: number, rz: number) {
    let left = Infinity
    let right = Infinity
    for (let k = 0; k < xs.length; k++) {
        const dx = xs[k]! - xs[j]!
        const dz = zs[k]! - zs[j]!
        const side = dx * rx + dz * rz
        if (side > 1e-9) right = Math.min(right, (dx * dx + dz * dz) / (2 * side))
        else if (side < -1e-9) left = Math.min(left, (dx * dx + dz * dz) / (-2 * side))
    }
    return { left, right }
}

/** The car as a line is timed, in m/s²: grip, pull from rest (none left at TOP_SPEED m/s) and brakes; near config.ts's, as only the line's shape rests on them. */
const GRIP = 26
const PULL = 24
const TOP_SPEED = 86
const BRAKES = 32
/** Widths, in points, of the bumps the line is nudged across by to cut its time, widest first. */
const NUDGE_WIDTHS = [64, 32, 16, 8]
/** Metres the first nudge at a width moves the line's middle, per point of width, halved down to LEAST_NUDGE. */
const NUDGE_SHARE = 0.25
const LEAST_NUDGE = 0.25

/** Points either side of a nudge its time is weighed over: past braking distance from TOP_SPEED, so the line beyond drives as before. */
const WEIGH_REACH = 64
/** Passes over the line at each nudge size, so a long line's time to plan stays in proportion to its length. */
const NUDGE_PASSES = 2

/**
 * Seconds to drive points `from` to `to`, entering at `vIn` and leaving no faster than `vOut`, as fast as each bend allows and
 * braking in time for the next; `v` gets each point's speed. Sqrt alone, so every engine agrees.
 */
function lineTime(xs: Float64Array, zs: Float64Array, from: number, to: number, vIn: number, vOut: number, cap: Float64Array, v: Float64Array) {
    const n = xs.length
    for (let j = Math.max(0, from - 1); j <= Math.min(n - 1, to + 1); j++) {
        const a = Math.max(0, j - 2)
        const c = Math.min(n - 1, j + 2)
        const k = a === j || c === j ? 0 : Math.abs(leftBend(xs[a]!, zs[a]!, xs[j]!, zs[j]!, xs[c]!, zs[c]!))
        v[j] = k > 1e-9 ? Math.min(TOP_SPEED, Math.sqrt(GRIP / k)) : TOP_SPEED
    }
    // A bend is read over its neighbours too, as the bot does.
    for (let j = from; j <= to; j++) cap[j] = Math.min(v[j]!, v[Math.max(0, j - 1)]!, v[Math.min(n - 1, j + 1)]!)
    v[from] = Math.min(cap[from]!, vIn)
    for (let j = from + 1; j <= to; j++) {
        const ds = span(xs[j]! - xs[j - 1]!, zs[j]! - zs[j - 1]!)
        v[j] = Math.min(cap[j]!, Math.sqrt(v[j - 1]! * v[j - 1]! + 2 * PULL * Math.max(0, 1 - v[j - 1]! / TOP_SPEED) * ds))
    }
    v[to] = Math.min(v[to]!, vOut)
    let time = 0
    for (let j = to - 1; j >= from; j--) {
        const ds = span(xs[j + 1]! - xs[j]!, zs[j + 1]! - zs[j]!)
        v[j] = Math.min(v[j]!, Math.sqrt(v[j + 1]! * v[j + 1]! + 2 * BRAKES * ds))
        time += 2 * ds / Math.max(1, v[j]! + v[j + 1]!)
    }
    return time
}

/** Nudges an open line across in smooth bumps wherever that drives it quicker, which smoothing its bends alone can't weigh. */
function quicken(pts: readonly PathPoint[], xs: Float64Array, zs: Float64Array, obstacles: LineObstacles, fromRest: boolean) {
    const n = pts.length
    const cap = new Float64Array(n)
    const v = new Float64Array(n)
    // The speeds along the line as it stands, which a nudge's stretch is entered and left at.
    const speed = new Float64Array(n)
    const nx = new Float64Array(n)
    const nz = new Float64Array(n)
    const ox = new Float64Array(n)
    const oz = new Float64Array(n)
    const v0 = fromRest ? 0 : TOP_SPEED
    const free = pts.map((p, j) => !p.fixed && j > 0 && j < n - 1)
    const fits = (j: number, x: number, z: number) => {
        const pt = pts[j]!
        if (pt.box) {
            const [bx, bz] = clampToBox(pt.box, x, z)
            if (Math.abs(bx - x) > 1e-6 || Math.abs(bz - z) > 1e-6) return false
        }
        return pt.road || obstacles.clearance(x, z) >= Math.min(LINE_MARGIN, obstacles.clearance(ox[j]!, oz[j]!))
    }
    lineTime(xs, zs, 0, n - 1, v0, Infinity, cap, speed)
    // A nudge is weighed over its own stretch, as the speeds either side of it don't change.
    const weigh = (lo: number, hi: number) => lineTime(xs, zs, lo, hi, lo === 0 ? v0 : speed[lo]!, hi === n - 1 ? Infinity : speed[hi]!, cap, v)
    for (const width of NUDGE_WIDTHS) {
        for (let j = 0; j < n; j++) {
            const tx = xs[Math.min(n - 1, j + 1)]! - xs[Math.max(0, j - 1)]!
            const tz = zs[Math.min(n - 1, j + 1)]! - zs[Math.max(0, j - 1)]!
            const length = Math.sqrt(tx * tx + tz * tz) || 1
            nx[j] = -tz / length
            nz[j] = tx / length
        }
        for (let step = width * NUDGE_SHARE; step >= LEAST_NUDGE; step /= 2) {
            for (let pass = 0; pass < NUDGE_PASSES; pass++) {
                let better = false
                for (let mid = 0; mid < n; mid += width / 2) {
                    const from = Math.max(1, mid - width + 1)
                    const to = Math.min(n - 2, mid + width - 1)
                    const lo = Math.max(0, from - WEIGH_REACH)
                    const hi = Math.min(n - 1, to + WEIGH_REACH)
                    const before = weigh(lo, hi)
                    for (const sign of [1, -1]) {
                        let fit = true
                        for (let j = from; j <= to; j++) {
                            ox[j] = xs[j]!
                            oz[j] = zs[j]!
                        }
                        for (let j = from; j <= to && fit; j++) {
                            if (!free[j]) continue
                            const t = (j - mid) / width
                            const d = sign * step * (1 - t * t) * (1 - t * t)
                            const x = ox[j]! + nx[j]! * d
                            const z = oz[j]! + nz[j]! * d
                            fit = fits(j, x, z)
                            xs[j] = x
                            zs[j] = z
                        }
                        if (fit && weigh(lo, hi) < before - 1e-9) {
                            lineTime(xs, zs, 0, n - 1, v0, Infinity, cap, speed)
                            better = true
                            break
                        }
                        for (let j = from; j <= to; j++) {
                            xs[j] = ox[j]!
                            zs[j] = oz[j]!
                        }
                    }
                }
                if (!better) break
            }
        }
    }
}

/** The racing line along `path`, as wide as `obstacles` allow, keeping LINE_MARGIN clear; a `loop` closes on its first point, an open one sets off `fromRest` or at speed. */
export function raceLine(path: readonly PathPoint[], obstacles: LineObstacles, loop: boolean, fromRest = false): RaceLine {
    const pts = resample(path, loop)
    const n = pts.length
    const xs = Float64Array.from(pts, p => p.x)
    const zs = Float64Array.from(pts, p => p.z)
    round(pts, xs, zs, obstacles, loop)
    const at = (j: number) => loop ? ((j % n) + n) % n : Math.max(0, Math.min(n - 1, j))
    const txs = new Float64Array(n)
    const tzs = new Float64Array(n)
    const left = new Float64Array(n)
    const right = new Float64Array(n)
    for (let round = 0; round < SOLVES; round++) {
        if (round > 0) even(pts, xs, zs, obstacles, loop)
        for (let j = 0; j < n; j++) {
            const a = at(j - 1)
            const c = at(j + 1)
            const tx = xs[c]! - xs[a]!
            const tz = zs[c]! - zs[a]!
            const length = span(tx, tz) || 1
            txs[j] = tx / length
            tzs[j] = tz / length
        }
        for (let j = 0; j < n; j++) {
            const pt = pts[j]!
            if (pt.fixed || (!loop && (j === 0 || j === n - 1))) continue
            // The right of the way along, as the road's line counts it.
            const rx = -tzs[j]!
            const rz = txs[j]!
            const bend = leftBend(xs[at(j - 3)]!, zs[at(j - 3)]!, xs[j]!, zs[j]!, xs[at(j + 3)]!, zs[at(j + 3)]!)
            const inside = Math.abs(bend) > 1e-6 ? INSIDE_SHARE / Math.abs(bend) : Infinity
            const r = roomAlong(obstacles, xs[j]!, zs[j]!, rx, rz, pt.box, pt.road)
            const l = roomAlong(obstacles, xs[j]!, zs[j]!, -rx, -rz, pt.box, pt.road)
            const fold = foldRoom(xs, zs, j, rx, rz)
            // A bend to the left has its middle on the left.
            left[j] = RACING_MARGIN + Math.min(l, bend > 0 ? inside : Infinity, fold.left * INSIDE_SHARE)
            right[j] = RACING_MARGIN + Math.min(r, bend < 0 ? inside : Infinity, fold.right * INSIDE_SHARE)
        }
        const { offsets } = racingLine({ n, closed: loop, xs, zs, txs, tzs, left, right, railed: new Uint8Array(n), heldBend: true })
        unfold(xs, zs, txs, tzs, offsets, loop)
        for (let j = 0; j < n; j++) {
            xs[j] = xs[j]! - tzs[j]! * offsets[j]!
            zs[j] = zs[j]! + txs[j]! * offsets[j]!
        }
    }
    if (!loop) quicken(pts, xs, zs, obstacles, fromRest)
    const points = Array.from(xs, (x, j) => [x, zs[j]!] as [number, number])
    const curvature = new Float64Array(n)
    for (let j = 0; j < n; j++) {
        const a = at(j - 2)
        const c = at(j + 2)
        if (a !== j && c !== j) curvature[j] = leftBend(points[a]![0], points[a]![1], points[j]![0], points[j]![1], points[c]![0], points[c]![1])
    }
    const cum = new Float64Array(n)
    for (let j = 1; j < n; j++) cum[j] = cum[j - 1]! + span(points[j]![0] - points[j - 1]![0], points[j]![1] - points[j - 1]![1])
    return { points, curvature, cum }
}
