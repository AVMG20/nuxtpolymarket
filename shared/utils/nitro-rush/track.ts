/**
 * Courses and lap timing. Pure maths, no three.js, so the physics, the bot,
 * the server's leaderboard checks and the tests all share it.
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
 * Courses are laid out from blocks in `layout.ts`; this file only sees the
 * sampled line they compile to.
 *
 * The road can climb: each point has a height, and the road is level across.
 * `s` stays a distance over the ground plan, which the gentle grades keep
 * within a fraction of a percent of the distance driven.
 */

import { buildTrack, POLYTOWN_OVAL, S_BEND_SPRINT, TWIN_HELIX, ZIGZAG_SPRINT } from './layout'

export type TrackGroup = 'circuits' | 'sprints'

/** Menu categories, in menu order. */
export const TRACK_GROUPS: readonly { id: TrackGroup, name: string, blurb: string }[] = [
    { id: 'circuits', name: 'Circuits', blurb: 'Loops: lap as long as you like' },
    { id: 'sprints', name: 'Sprints', blurb: 'Point to point, start to finish' }
]

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

/** `1:02.345`, or `+0.42` / `-0.42` with `signed` for a gap to a best time. */
export function formatLapTime(seconds: number, signed = false) {
    const ms = Math.round(Math.abs(seconds) * 1000)
    const m = Math.floor(ms / 60000)
    const s = Math.floor(ms / 1000) % 60
    const frac = String(ms % 1000).padStart(3, '0')
    const body = m > 0 ? `${m}:${String(s).padStart(2, '0')}.${frac}` : `${s}.${frac}`
    if (signed) return `${seconds < 0 ? '-' : '+'}${body}`
    return m > 0 ? body : `0:${String(s).padStart(2, '0')}.${frac}`
}

/** The courses players can pick, in menu order. Ids are leaderboard keys: never rename one. */
export const TRACKS: readonly TrackDef[] = [buildTrack(POLYTOWN_OVAL), buildTrack(TWIN_HELIX), buildTrack(S_BEND_SPRINT), buildTrack(ZIGZAG_SPRINT)]

export function findTrack(id: string) {
    return TRACKS.find(t => t.id === id) ?? null
}

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
        this.cum = new Float64Array(n + 1)
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n
            const seg = i < this.segments ? Math.hypot(this.xs[j]! - this.xs[i]!, this.zs[j]! - this.zs[i]!) : 0
            this.cum[i + 1] = this.cum[i]! + seg
        }
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
            this.curvature[i] = turn / ((la + lb) / 2 || 1)
            this.grades[i] = (this.ys[j]! - this.ys[p]!) / (la + lb || 1)
        }
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

    pointAt(s: number, out: TrackPoint = { x: 0, z: 0, tx: 0, tz: 0, y: 0, grade: 0 }): TrackPoint {
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
    project(x: number, z: number, hint = -1, out: Projection = { seg: 0, s: 0, lateral: 0, tx: 0, tz: 1, y: 0, grade: 0 }, y = Number.NaN): Projection {
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

export type LapEvent =
    | { type: 'split', lap: number, sector: number, time: number }
    | { type: 'lap', lap: number, time: number, splits: number[] }

/**
 * Lap clock and counter for an endless session. It follows an unwrapped
 * distance from the start line, so reversing over the line and back never
 * counts a lap, and interpolates each crossing inside the step that made it,
 * so times don't snap to the frame.
 *
 * On a loop the laps never stop. On an open course `s` is the distance from
 * the start line and the run is over once the finish is crossed. Each
 * checkpoint, given as a distance from the start line, closes a sector.
 */
export class LapTimer {
    readonly lapLength: number
    readonly closed: boolean
    /** The checkpoints, then the line that ends the lap. */
    private readonly marks: number[]
    clock = 0
    distance: number
    lap = 0
    lapStart = 0
    splits: number[] = []
    finished = false
    private lastS: number

    constructor(lapLength: number, closed: boolean, startDistance: number, checkpoints: readonly number[] = []) {
        this.lapLength = lapLength
        this.closed = closed
        this.marks = [...checkpoints, lapLength]
        this.distance = startDistance
        this.lastS = closed ? ((startDistance % lapLength) + lapLength) % lapLength : startDistance
    }

    get lapTime() {
        return this.clock - this.lapStart
    }

    update(s: number, dt: number): LapEvent[] {
        if (this.finished) return []
        const L = this.lapLength
        let ds = s - this.lastS
        if (this.closed) {
            if (ds > L / 2) ds -= L
            else if (ds < -L / 2) ds += L
        }
        this.lastS = s
        const from = this.distance
        this.clock += dt
        this.distance += ds
        const events: LapEvent[] = []
        if (ds <= 0) return events
        const crossedAt = (mark: number) => this.clock - dt + dt * (mark - from) / ds
        for (;;) {
            const nextSplit = this.lap * L + this.marks[this.splits.length]!
            if (this.distance < nextSplit) break
            const at = crossedAt(nextSplit)
            if (this.splits.length < this.marks.length - 1) {
                this.splits.push(at - this.lapStart)
                events.push({ type: 'split', lap: this.lap, sector: this.splits.length - 1, time: at - this.lapStart })
                continue
            }
            const time = at - this.lapStart
            events.push({ type: 'lap', lap: this.lap, time, splits: this.splits })
            this.lap++
            this.lapStart = at
            this.splits = []
            if (!this.closed) {
                this.finished = true
                this.clock = at
                break
            }
        }
        return events
    }
}
