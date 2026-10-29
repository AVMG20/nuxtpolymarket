/**
 * Course geometry. Pure maths, no three.js, so the physics, the bot, the
 * server's leaderboard checks and the tests all share it.
 *
 * A course is a centreline sampled every couple of metres, in driving order.
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
 * The road can climb: each point has a height, and the road is level across.
 * `s` stays a distance over the ground plan, which the gentle grades keep
 * within a fraction of a percent of the distance driven.
 *
 * Stunt pieces add a full frame per point: banks tip the road's up, and on
 * rails (loopings, corkscrews) the plan overlaps itself or the road turns on
 * its side, so there `s` is the distance along the road itself and the car is
 * driven by distance and offset instead of by its spot on the plan. Gaps are
 * stretches with no road: a jump's.
 */

export type TrackGroup = 'circuits' | 'sprints'

export interface TrackDef {
    id: string
    name: string
    group: TrackGroup
    points: [number, number][]
    /** Road height at each point, in metres above the ground; left out on a flat course. */
    heights?: number[]
    halfWidth: number
    /** Centreline to the face of the wall. */
    wallOffset: number
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
}

export interface Projection {
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
const SPEED_CEILING = 110

export const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU)

/** The heading that faces along (dx, dz); heading 0 faces -z. */
export const headingOf = (dx: number, dz: number) => Math.atan2(-dx, -dz)

export const newProjection = (): Projection => ({ seg: 0, s: 0, lateral: 0, tx: 0, tz: 1, y: 0, grade: 0 })
export const newTrackPoint = (): TrackPoint => ({ x: 0, z: 0, tx: 0, tz: 1, y: 0, grade: 0 })
export const newTrackFrame = (): TrackFrame => ({ x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: -1, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 })

/** Ranges in point indices to ranges in distance. */
const toDistance = (cum: Float64Array, ranges: readonly [number, number][] | undefined) => (ranges ?? []).map(([a, b]) => [cum[a]!, cum[b]!] as const)
const within = (ranges: readonly (readonly [number, number])[], s: number) => ranges.some(([a, b]) => s >= a && s < b)

export class Track {
    readonly def: TrackDef
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
    /** Per point: true on rails. */
    readonly railed: Uint8Array

    constructor(def: TrackDef) {
        this.def = def
        this.closed = def.closed !== false
        const n = def.points.length
        this.n = n
        this.segments = this.closed ? n : n - 1
        this.xs = new Float64Array(n)
        this.zs = new Float64Array(n)
        this.ys = new Float64Array(n)
        def.points.forEach(([x, z], i) => {
            this.xs[i] = x
            this.zs[i] = z
            this.ys[i] = def.heights?.[i] ?? 0
        })
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

    /** True over a jump's gap, where there's no road. */
    gapAt(s: number) {
        return this.gaps.length > 0 && within(this.gaps, this.wrapS(s))
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

    get halfWidth() {
        return this.def.halfWidth
    }

    get wallOffset() {
        return this.def.wallOffset
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

    /** No legitimate lap is quicker than this. */
    get minLapSeconds() {
        return this.lapLength / SPEED_CEILING
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
        let best = Infinity
        const last = this.segments - 1
        let level = false
        const test = (i: number) => {
            const j = (i + 1) % this.n
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
            if (level) d2 += (y - ry) * (y - ry) * LEVEL_WEIGHT * LEVEL_WEIGHT
            if (d2 < best) {
                best = d2
                const len = Math.sqrt(len2)
                out.seg = i
                out.s = this.cum[i]! + len * t
                out.tx = dx / len
                out.tz = dz / len
                // Right of the driving direction is the tangent turned a quarter clockwise seen from above.
                out.lateral = (x - ax) * -out.tz + (z - az) * out.tx
                out.y = ry
                out.grade = this.grades[i]! + (this.grades[j]! - this.grades[i]!) * f
            }
        }
        if (hint >= 0) {
            for (let k = -SEARCH_WINDOW; k <= SEARCH_WINDOW; k++) {
                const i = hint + k
                if (this.closed) test((i + this.n) % this.n)
                else if (i >= 0 && i <= last) test(i)
            }
        }
        // A teleport or a bad hint: the windowed answer is only trusted while it's on the track.
        if (hint < 0 || Math.sqrt(best) > this.def.wallOffset + 4) {
            best = Infinity
            level = Number.isFinite(y)
            for (let i = 0; i <= last; i++) test(i)
        }
        return out
    }
}
