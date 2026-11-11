/**
 * Road geometry along one line. Pure maths, no three.js, so the physics, the bot, the
 * server's leaderboard checks and the tests all share it. A course (`track.ts`) is one
 * or more of these: its main line, and a line per branch where the road forks.
 *
 * A line is a centreline sampled every couple of metres, in driving order.
 * Everything else (the road ribbon, walls, kerbs, where the car is) is
 * measured from it as a distance along the line (`s`) and a signed offset
 * across it (`lateral`, + is right).
 *
 * A loop closes back on its first point, with the start line there. An open
 * course (a sprint) runs from its first point to its last: barriers close
 * both ends, the start line sits `runUp` in and the finish `runOff` short of
 * the far end, so the car has room to stop.
 *
 * Courses are laid out from blocks in `layout.ts` and registered in
 * `tracks.ts`; this file only sees the sampled line they compile to.
 *
 * The road can climb: each point has a height, measured at the centreline.
 * `s` stays a distance over the ground plan, which the gentle grades keep
 * within a fraction of a percent of the distance driven.
 *
 * Stunt pieces add a full frame per point: banks tip the road's up, and on
 * rails (loopings, corkscrews) the plan overlaps itself or the road turns on
 * its side, so there `s` is the distance along the road itself and the car is
 * driven by distance and offset instead of by its spot on the plan. Gaps are
 * stretches with no road: a jump's.
 *
 * The road's width can change along it; the verge from its edge to the wall stays the same.
 *
 * The walls are low: a car in the air above them flies over, and lands on whatever road lies under it, or falls.
 * Where branches share a deck at a fork or a join, a side's wall is open over a stretch.
 */

export type TrackGroup = 'circuits' | 'sprints'

/** One line of road: a whole single-line course, or one branch of a forked one. */
export interface LineDef {
    points: [number, number][]
    /** Road height at each point, in metres above the ground; left out on a flat course. */
    heights?: number[]
    /** The road's half width, and centreline to the face of the wall, where `halfWidths` doesn't say otherwise. */
    halfWidth: number
    wallOffset: number
    /** Half the road's width at each point; left out where it never changes. */
    halfWidths?: number[]
    /** False for a point-to-point sprint; loops are the default. */
    closed?: boolean
    /** Open courses only: from the start barrier to the start line. */
    runUp?: number
    /** Open courses only: from the finish line to the end barrier. */
    runOff?: number
    /** Distance along the line of each checkpoint, in driving order; each one closes a sector. */
    checkpoints?: number[]
    /** The road's up at each point, where any of it isn't straight up: banks, loopings, corkscrews. */
    ups?: [number, number, number][]
    /** Point ranges, [from, to), driven on rails. */
    rails?: [number, number][]
    /** Point ranges, [from, to), with no road: a jump's gap runs from its first point to the first point after. */
    gaps?: [number, number][]
    boosts?: BoostPadDef[]
}

/** Which part of the road's width a boost pad covers. */
export type BoostLane = 'full' | 'left' | 'right'

export interface BoostPadDef {
    /** Point range, [from, to). */
    range: [number, number]
    lane: BoostLane
}

/** A boost pad on the road: distances along it and offsets across it, + to the right. */
export interface BoostPad {
    from: number
    to: number
    latFrom: number
    latTo: number
}

/** A lane's edges, as shares of the road's half width. */
export const BOOST_LANES: Readonly<Record<BoostLane, readonly [number, number]>> = { full: [-1, 1], left: [-1, 0], right: [0, 1] }

export interface Projection {
    /** The branch the road belongs to; 0 on the main line. */
    branch: number
    seg: number
    s: number
    lateral: number
    /** Unit tangent of the segment, in driving direction. */
    tx: number
    tz: number
    /** Road height at the projected point. */
    y: number
    /** Rise per metre in the driving direction. */
    grade: number
}

/** The road at a distance: its centre, and the unit tangent, right and up of its surface. */
export interface TrackFrame {
    x: number
    y: number
    z: number
    tx: number
    ty: number
    tz: number
    rx: number
    ry: number
    rz: number
    ux: number
    uy: number
    uz: number
}

export interface TrackPoint {
    x: number
    z: number
    tx: number
    tz: number
    y: number
    grade: number
}

const TAU = Math.PI * 2
/** Segments either side of the hint that a projection checks before falling back to a full scan. */
const SEARCH_WINDOW = 10
/** How much a metre of height counts against a metre across when a full scan picks between stacked roads. */
const LEVEL_WEIGHT = 4
const DEFAULT_RUN_UP = 30
const DEFAULT_RUN_OFF = 150
/** Faster than the car can ever average (its nitro top speed is ~103 m/s), so the server can refuse impossible laps. */
export const SPEED_CEILING = 110
/** Steepest grade of a jump's kicker, at its lip; the kicker is as long as that takes, in whole grid steps. */
export const KICKER_GRADE = 0.15
/** Below the road it left by this much, with no road under it, a car has fallen. */
export const FALL_DEPTH = 6
/** How far below a car's wheels a road may sit and still be the one it comes down on this step. */
const UNDER_TOLERANCE = 0.05
/** Half the jersey barrier's base; its road-side face sits on the track's wall offset. */
export const WALL_BASE_HALF = 0.32
/** The jersey barrier's height: a car in the air higher than its top clears it. */
export const WALL_HEIGHT = 0.86
/** Centreline to the walls' outer foot: where the deck ends, and the edge a bank pivots on. */
export const wallFoot = (wallOffset: number) => wallOffset + WALL_BASE_HALF * 2

export const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU)

/** The heading that faces along (dx, dz); heading 0 faces -z. */
export const headingOf = (dx: number, dz: number) => Math.atan2(-dx, -dz)

export const newProjection = (): Projection => ({ branch: 0, seg: 0, s: 0, lateral: 0, tx: 0, tz: 1, y: 0, grade: 0 })
export const newTrackPoint = (): TrackPoint => ({ x: 0, z: 0, tx: 0, tz: 1, y: 0, grade: 0 })
export const newTrackFrame = (): TrackFrame => ({ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: -1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 })

/** Ranges in point indices to ranges in distance. */
const toDistance = (cum: Float64Array, ranges: readonly [number, number][] | undefined) => (ranges ?? []).map(([a, b]) => [cum[a]!, cum[b]!] as const)
const within = (ranges: readonly (readonly [number, number])[], s: number) => ranges.some(([a, b]) => s >= a && s < b)

/** A stretch where one side's wall is left out, because the road shares its deck with `partner` there. */
export interface OpenSide {
    /** -1 for the left wall, 1 for the right. */
    side: -1 | 1
    from: number
    to: number
    partner: number
    /** Where the partner's own open stretch starts and ends, which line up with `from` and `to`. */
    partnerFrom: number
    partnerTo: number
}

export class TrackLine {
    readonly def: LineDef
    /** Which branch of its course this is; 0 for the main line. */
    readonly branch: number
    readonly closed: boolean
    readonly n: number
    /** Segments: one per point on a loop, one fewer on an open course. */
    readonly segments: number
    readonly length: number
    readonly xs: Float64Array
    readonly zs: Float64Array
    readonly ys: Float64Array
    /** Per point: rise per metre in the driving direction. */
    readonly grades: Float64Array
    /** Distance along the line at each point; `cum[n]` is the full length either way. */
    readonly cum: Float64Array
    /** Per point: the unit tangent averaged over its two segments, so offsets mitre cleanly. */
    readonly txs: Float64Array
    readonly tzs: Float64Array
    /** Per point: how sharply the line turns there, in radians per metre. */
    readonly curvature: Float64Array
    /** Where each checkpoint line sits along the line, in driving order. */
    readonly checkpoints: readonly number[]
    /** Per point: the road's unit tangent in 3D, and the right and up of its surface. */
    readonly t3: Float64Array
    readonly right: Float64Array
    readonly up: Float64Array
    /** Distance ranges driven on rails, and with no road. */
    readonly rails: readonly (readonly [number, number])[]
    readonly gaps: readonly (readonly [number, number])[]
    readonly boostPads: readonly BoostPad[]
    /** Per point: true on rails. */
    readonly railed: Uint8Array
    /** Per point: half the road's width, and centreline to the face of the wall. */
    readonly halfWidths: Float64Array
    readonly walls: Float64Array
    /** The furthest any wall stands from the centreline. */
    readonly maxWall: number
    /** Stretches with a side's wall left out; set by the course once its branches are known. */
    open: readonly OpenSide[] = []
    /** Every line of its course, by branch, so a shared deck can find its partner; set by the course. */
    peers: readonly TrackLine[] = []
    /** Whether a barrier closes each end; a branch's end that meets other road has none. */
    barrierStart: boolean
    barrierEnd: boolean
    private readonly scratchFrame = newTrackFrame()
    private readonly scratchPoint = newTrackPoint()
    private readonly scratchProjection = newProjection()

    constructor(def: LineDef, branch = 0) {
        this.def = def
        this.branch = branch
        this.closed = def.closed !== false
        const n = def.points.length
        this.n = n
        this.segments = this.closed ? n : n - 1
        this.barrierStart = this.barrierEnd = !this.closed
        this.xs = new Float64Array(n)
        this.zs = new Float64Array(n)
        this.ys = new Float64Array(n)
        def.points.forEach(([x, z], i) => {
            this.xs[i] = x
            this.zs[i] = z
            this.ys[i] = def.heights?.[i] ?? 0
        })
        const verge = def.wallOffset - def.halfWidth
        this.halfWidths = new Float64Array(n).map((_, i) => def.halfWidths?.[i] ?? def.halfWidth)
        this.walls = this.halfWidths.map(w => w + verge)
        this.maxWall = Math.max(...this.walls)
        this.railed = new Uint8Array(n)
        for (const [a, b] of def.rails ?? []) this.railed.fill(1, a, b)
        this.cum = new Float64Array(n + 1)
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n
            const dy = this.railed[i] ? this.ys[j]! - this.ys[i]! : 0
            const seg = i < this.segments ? Math.hypot(this.xs[j]! - this.xs[i]!, this.zs[j]! - this.zs[i]!, dy) : 0
            this.cum[i + 1] = this.cum[i]! + seg
        }
        this.rails = toDistance(this.cum, def.rails)
        this.gaps = toDistance(this.cum, def.gaps)
        this.boostPads = (def.boosts ?? []).map(({ range: [a, b], lane }) => ({
            from: this.cum[a]!,
            to: this.cum[b]!,
            latFrom: BOOST_LANES[lane][0] * this.halfWidths[a]!,
            latTo: BOOST_LANES[lane][1] * this.halfWidths[a]!
        }))
        this.length = this.cum[n]!
        this.checkpoints = [...def.checkpoints ?? []].sort((a, b) => a - b)
        this.txs = new Float64Array(n)
        this.tzs = new Float64Array(n)
        this.curvature = new Float64Array(n)
        this.grades = new Float64Array(n)
        for (let i = 0; i < n; i++) {
            // An open course's end points only have the one segment.
            const p = this.closed ? (i - 1 + n) % n : Math.max(0, i - 1)
            const j = this.closed ? (i + 1) % n : Math.min(n - 1, i + 1)
            const ax = this.xs[i]! - this.xs[p]!
            const az = this.zs[i]! - this.zs[p]!
            const bx = this.xs[j]! - this.xs[i]!
            const bz = this.zs[j]! - this.zs[i]!
            const la = Math.hypot(ax, az)
            const lb = Math.hypot(bx, bz)
            const tx = (la ? ax / la : 0) + (lb ? bx / lb : 0)
            const tz = (la ? az / la : 0) + (lb ? bz / lb : 0)
            const lt = Math.hypot(tx, tz) || 1
            this.txs[i] = tx / lt
            this.tzs[i] = tz / lt
            const turn = la && lb ? Math.abs(wrapAngle(Math.atan2(bx, bz) - Math.atan2(ax, az))) : 0
            // On rails the plan doubles back on itself; the road there runs straight in its own frame.
            this.curvature[i] = this.railed[i] ? 0 : turn / ((la + lb) / 2 || 1)
            this.grades[i] = (this.ys[j]! - this.ys[p]!) / (la + lb || 1)
        }
        this.t3 = new Float64Array(n * 3)
        this.right = new Float64Array(n * 3)
        this.up = new Float64Array(n * 3)
        for (let i = 0; i < n; i++) this.frameOf(i, def.ups?.[i])
    }

    /** Point `i`'s frame. Plain road keeps the plan's own right and straight up, exactly as before stunts. */
    private frameOf(i: number, given: readonly number[] | undefined) {
        const n = this.n
        const k = i * 3
        const plain = !this.railed[i] && (!given || (given[0] === 0 && given[1] === 1 && given[2] === 0))
        if (plain) {
            const tx = this.txs[i]!
            const tz = this.tzs[i]!
            const g = this.grades[i]!
            const len = Math.sqrt(1 + g * g)
            this.t3.set([tx / len, g / len, tz / len], k)
            this.right.set([-tz, 0, tx], k)
            this.up.set([0, 1, 0], k)
            return
        }
        const p = this.closed ? (i - 1 + n) % n : Math.max(0, i - 1)
        const j = this.closed ? (i + 1) % n : Math.min(n - 1, i + 1)
        let tx = this.xs[j]! - this.xs[p]!
        let ty = this.ys[j]! - this.ys[p]!
        let tz = this.zs[j]! - this.zs[p]!
        const tl = Math.hypot(tx, ty, tz) || 1
        tx /= tl
        ty /= tl
        tz /= tl
        const ux = given?.[0] ?? 0
        const uy = given?.[1] ?? 1
        const uz = given?.[2] ?? 0
        // Right is the tangent crossed with up; up is then squared to both.
        let rx = ty * uz - tz * uy
        let ry = tz * ux - tx * uz
        let rz = tx * uy - ty * ux
        const rl = Math.hypot(rx, ry, rz) || 1
        rx /= rl
        ry /= rl
        rz /= rl
        this.t3.set([tx, ty, tz], k)
        this.right.set([rx, ry, rz], k)
        this.up.set([ry * tz - rz * ty, rz * tx - rx * tz, rx * ty - ry * tx], k)
        if (this.railed[i]) this.grades[i] = ty / Math.max(0.05, Math.hypot(tx, tz))
    }

    /** True on a looping or corkscrew. */
    railAt(s: number) {
        return this.rails.length > 0 && within(this.rails, this.wrapS(s))
    }

    /** Point `i` lies flat across, on the plan: not on rails and not banked. */
    plainAt(i: number) {
        return !this.railed[i] && this.right[i * 3 + 1] === 0
    }

    /** Plain road at `s`: no rails, gap or bank, so scenery can stand beside it as on any other road. */
    plainRoadAt(s: number) {
        const i = this.segmentAt(s)
        return this.plainAt(i) && this.plainAt((i + 1) % this.n) && !this.gapAt(s)
    }

    /** Road at `s` that stands on pillars when raised: no rails or gap, though it may bank. */
    solidRoadAt(s: number) {
        const i = this.segmentAt(s)
        return !this.railed[i] && !this.railed[(i + 1) % this.n] && !this.gapAt(s)
    }

    /** Whether a car `lateral` across the road at `s` is on a boost pad. */
    boostAt(s: number, lateral: number) {
        if (!this.boostPads.length) return false
        const at = this.wrapS(s)
        return this.boostPads.some(p => at >= p.from && at < p.to && lateral >= p.latFrom && lateral <= p.latTo)
    }

    /** True over a jump's gap, where there's no road. */
    gapAt(s: number) {
        return this.gaps.length > 0 && within(this.gaps, this.wrapS(s))
    }

    /** Whether something `lateral` across the road at `s` is over it, out to the walls' outer foot, rather than off to its side. */
    overRoad(s: number, lateral: number) {
        return Math.abs(lateral) <= wallFoot(this.wallAt(s))
    }

    /** The road's frame at distance `s`, blended between the points either side. */
    frameAt(s: number, out: TrackFrame = newTrackFrame()): TrackFrame {
        const w = this.wrapS(s)
        const i = this.segmentAt(w)
        const j = (i + 1) % this.n
        const len = this.cum[i + 1]! - this.cum[i]!
        const t = len > 0 ? Math.min(1, (w - this.cum[i]!) / len) : 0
        out.x = this.xs[i]! + (this.xs[j]! - this.xs[i]!) * t
        out.y = this.ys[i]! + (this.ys[j]! - this.ys[i]!) * t
        out.z = this.zs[i]! + (this.zs[j]! - this.zs[i]!) * t
        const a = i * 3
        const b = j * 3
        const blend = (arr: Float64Array, c: number) => arr[a + c]! + (arr[b + c]! - arr[a + c]!) * t
        let x = blend(this.t3, 0)
        let y = blend(this.t3, 1)
        let z = blend(this.t3, 2)
        let l = Math.hypot(x, y, z) || 1
        out.tx = x / l
        out.ty = y / l
        out.tz = z / l
        x = blend(this.right, 0)
        y = blend(this.right, 1)
        z = blend(this.right, 2)
        l = Math.hypot(x, y, z) || 1
        out.rx = x / l
        out.ry = y / l
        out.rz = z / l
        x = blend(this.up, 0)
        y = blend(this.up, 1)
        z = blend(this.up, 2)
        l = Math.hypot(x, y, z) || 1
        out.ux = x / l
        out.uy = y / l
        out.uz = z / l
        return out
    }

    /** The road's height `lateral` across from the centre at `s`: off it on a bank. */
    surfaceAt(s: number, lateral: number) {
        const f = this.frameAt(s, this.scratchFrame)
        return f.y + f.ry * lateral
    }

    /** Half the road's width at `s`. */
    halfWidthAt(s: number) {
        return this.blendAt(this.halfWidths, s)
    }

    /** Centreline to the face of the wall at `s`. */
    wallAt(s: number) {
        return this.blendAt(this.walls, s)
    }

    /** Centreline to the face of the wall on `side` (-1 left, 1 right) at `s`; Infinity where that side is open. */
    wallOn(s: number, side: number) {
        if (this.open.length) {
            const at = this.wrapS(s)
            if (this.open.some(o => o.side === side && at >= o.from && at < o.to)) return Infinity
        }
        return this.wallAt(s)
    }

    /** The open stretch on `side` at `s`, if any. */
    openAt(s: number, side: number) {
        if (!this.open.length) return undefined
        const at = this.wrapS(s)
        return this.open.find(o => o.side === side && at >= o.from && at < o.to)
    }

    /**
     * How far across to `side` this road's deck runs at `s` before its partner's takes over, where the two share one;
     * Infinity elsewhere. The seam lies as far from each road's wall, so it meets the nose where the walls do.
     */
    deckEdge(s: number, side: -1 | 1): number {
        const o = this.openAt(s, side)
        const partner = o && this.peers[o.partner]
        if (!partner) return Infinity
        const p = this.pointAt(s, this.scratchPoint)
        const q = this.scratchProjection
        const hint = partner.segmentAt(o.partnerFrom + (s - o.from) * (o.partnerTo - o.partnerFrom) / (o.to - o.from || 1))
        const wall = this.wallAt(s)
        // From the partner's wall face over towards this road, `t` across from its centre.
        const beyond = (t: number) => {
            partner.projectNear(p.x - p.tz * side * t, p.z + p.tx * side * t, hint, q)
            return -side * q.lateral - partner.wallAt(q.s)
        }
        // Both distances change by about a metre per metre across, so half the mismatch closes most of it each step.
        let t = (beyond(0) + wall) / 2
        for (let k = 0; k < 3; k++) t -= (t - wall - beyond(t)) / 2
        return t
    }

    /** How fast the walls move out from the centreline at `s`, in metres per metre: - where the road narrows. */
    wallSlopeAt(s: number) {
        const i = this.segmentAt(s)
        const len = this.cum[i + 1]! - this.cum[i]!
        return len > 0 ? (this.walls[(i + 1) % this.n]! - this.walls[i]!) / len : 0
    }

    private blendAt(arr: Float64Array, s: number) {
        const w = this.wrapS(s)
        const i = this.segmentAt(w)
        const len = this.cum[i + 1]! - this.cum[i]!
        const t = len > 0 ? Math.min(1, (w - this.cum[i]!) / len) : 0
        return arr[i]! + (arr[(i + 1) % this.n]! - arr[i]!) * t
    }

    /**
     * The highest road right under (x, z) that's no higher than `y`, into `out`: what a falling car comes down on.
     * The deck runs out to the walls' outer foot; rails and gaps don't count. False when there's no road under it.
     */
    roadUnder(x: number, y: number, z: number, out: Projection): boolean {
        let top = -Infinity
        for (let i = 0; i < this.segments; i++) top = this.underSegment(i, x, y, z, top, out)
        return top > -Infinity
    }

    /** Segment `i`'s road surface right under (x, z) when it's no higher than `y` and above `top`, written to `out`; returns the new top. */
    underSegment(i: number, x: number, y: number, z: number, top: number, out: Projection): number {
        const j = (i + 1) % this.n
        if (this.railed[i] || this.railed[j]) return top
        const ax = this.xs[i]!
        const az = this.zs[i]!
        const dx = this.xs[j]! - ax
        const dz = this.zs[j]! - az
        const len2 = dx * dx + dz * dz || 1
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
        const len = Math.sqrt(len2)
        const tx = dx / len
        const tz = dz / len
        const lateral = (x - ax) * -tz + (z - az) * tx
        // Off the segment's sides only; its ends meet the next one's.
        const along = (x - ax) * tx + (z - az) * tz
        if (along < -1e-6 || along > len + 1e-6) return top
        if (Math.abs(lateral) > wallFoot(this.walls[i]! + (this.walls[j]! - this.walls[i]!) * t)) return top
        const ry = this.ys[i]! + (this.ys[j]! - this.ys[i]!) * t
        // A bank tips the surface away from the centre's height.
        const surface = ry + (this.right[i * 3 + 1]! + (this.right[j * 3 + 1]! - this.right[i * 3 + 1]!) * t) * lateral
        if (surface > y + UNDER_TOLERANCE || surface <= top) return top
        const s = this.cum[i]! + len * t
        if (this.gapAt(s)) return top
        out.branch = this.branch
        out.seg = i
        out.s = s
        out.tx = tx
        out.tz = tz
        out.lateral = lateral
        out.y = ry
        out.grade = this.grades[i]! + (this.grades[j]! - this.grades[i]!) * t
        return surface
    }

    /** Where the timed lap starts. */
    get startS() {
        return this.closed ? 0 : this.def.runUp ?? DEFAULT_RUN_UP
    }

    /** Where the timed lap ends: back at the start on a loop. */
    get finishS() {
        return this.closed ? this.length : this.length - (this.def.runOff ?? DEFAULT_RUN_OFF)
    }

    get lapLength() {
        return this.finishS - this.startS
    }

    /** Each checkpoint's distance from the start line, as the lap timer measures it. */
    get checkpointDistances() {
        return this.checkpoints.map(s => s - this.startS)
    }

    /** Wraps any distance onto [0, length) on a loop; clamps onto [0, length] on an open course. */
    wrapS(s: number) {
        if (!this.closed) return Math.min(this.length, Math.max(0, s))
        return ((s % this.length) + this.length) % this.length
    }

    /** The index of the segment holding distance `s`. */
    segmentAt(s: number) {
        const w = this.wrapS(s)
        let lo = 0
        let hi = this.segments - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (this.cum[mid]! <= w) lo = mid
            else hi = mid - 1
        }
        return lo
    }

    /** True when any of the road leaves the ground. */
    get elevated() {
        return this.ys.some(y => y > 0)
    }

    pointAt(s: number, out: TrackPoint = newTrackPoint()): TrackPoint {
        const w = this.wrapS(s)
        const i = this.segmentAt(w)
        const j = (i + 1) % this.n
        const len = this.cum[i + 1]! - this.cum[i]!
        const t = len > 0 ? (w - this.cum[i]!) / len : 0
        out.x = this.xs[i]! + (this.xs[j]! - this.xs[i]!) * t
        out.z = this.zs[i]! + (this.zs[j]! - this.zs[i]!) * t
        out.tx = (this.xs[j]! - this.xs[i]!) / (len || 1)
        out.tz = (this.zs[j]! - this.zs[i]!) / (len || 1)
        out.y = this.ys[i]! + (this.ys[j]! - this.ys[i]!) * t
        out.grade = this.grades[i]! + (this.grades[j]! - this.grades[i]!) * t
        return out
    }

    /**
     * Nearest point on the centreline. Pass the last segment as `hint` to search only around it.
     * Past either end of an open course `s` runs below 0 or above `length`, so the physics can find the barrier.
     * Where roads stack (a spiral, a bridge), `y` picks the level a full scan lands on.
     */
    project(x: number, z: number, hint = -1, out: Projection = newProjection(), y = Number.NaN): Projection {
        const near = hint >= 0 ? this.projectNear(x, z, hint, out) : Infinity
        // A teleport or a bad hint: the windowed answer is only trusted while it's on the track.
        if (!this.trusts(near, out)) this.projectAll(x, z, out, y)
        return out
    }

    /** The nearest point among the segments round `hint`, into `out`; its distance on the plan, Infinity when there are none. */
    projectNear(x: number, z: number, hint: number, out: Projection): number {
        let best = Infinity
        const last = this.segments - 1
        for (let k = -SEARCH_WINDOW; k <= SEARCH_WINDOW; k++) {
            const i = hint + k
            if (this.closed) best = this.scoreSegment((i + this.n) % this.n, x, z, Number.NaN, best, out)
            else if (i >= 0 && i <= last) best = this.scoreSegment(i, x, z, Number.NaN, best, out)
        }
        return Math.sqrt(best)
    }

    /** Whether a windowed projection `distance` from the line is close enough to be the road the car is on. */
    trusts(distance: number, p: Projection) {
        return distance <= this.walls[p.seg]! + 4
    }

    /** The nearest point on the whole line, into `out`, `y` weighing height against stacked roads; returns its score. */
    projectAll(x: number, z: number, out: Projection, y = Number.NaN): number {
        let best = Infinity
        for (let i = 0; i < this.segments; i++) best = this.scoreSegment(i, x, z, y, best, out)
        return best
    }

    /** Segment `i`'s nearest point to (x, z), written to `out` when it scores under `best`; returns the lower score. A finite `y` adds height. */
    scoreSegment(i: number, x: number, z: number, y: number, best: number, out: Projection): number {
        const j = (i + 1) % this.n
        const last = this.segments - 1
        const ax = this.xs[i]!
        const az = this.zs[i]!
        const dx = this.xs[j]! - ax
        const dz = this.zs[j]! - az
        const len2 = dx * dx + dz * dz || 1
        const lo = !this.closed && i === 0 ? -Infinity : 0
        const hi = !this.closed && i === last ? Infinity : 1
        const t = Math.min(hi, Math.max(lo, ((x - ax) * dx + (z - az) * dz) / len2))
        const cx = ax + dx * t
        const cz = az + dz * t
        const f = Math.min(1, Math.max(0, t))
        const ry = this.ys[i]! + (this.ys[j]! - this.ys[i]!) * f
        let d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz)
        if (Number.isFinite(y)) d2 += (y - ry) * (y - ry) * LEVEL_WEIGHT * LEVEL_WEIGHT
        if (!(d2 < best)) return best
        const len = Math.sqrt(len2)
        out.branch = this.branch
        out.seg = i
        out.s = this.cum[i]! + len * t
        out.tx = dx / len
        out.tz = dz / len
        // Right of the driving direction is the tangent turned a quarter clockwise seen from above.
        out.lateral = (x - ax) * -out.tz + (z - az) * out.tx
        out.y = ry
        out.grade = this.grades[i]! + (this.grades[j]! - this.grades[i]!) * f
        return d2
    }
}
