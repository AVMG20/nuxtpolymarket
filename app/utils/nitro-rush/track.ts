/**
 * Courses and lap timing. Pure maths, no three.js, so the physics, the bot
 * and the tests all share it.
 *
 * A course is a closed centreline sampled every couple of metres, in driving
 * order, with the start line at the first point. Everything else (the road
 * ribbon, walls, kerbs, where the car is) is measured from it as a distance
 * along the line (`s`) and a signed offset across it (`lateral`, + is right).
 */

export interface TrackDef {
    id: string
    name: string
    points: [number, number][]
    halfWidth: number
    /** Centreline to the face of the wall. */
    wallOffset: number
}

export interface Projection {
    seg: number
    s: number
    lateral: number
    /** Unit tangent of the segment, in driving direction. */
    tx: number
    tz: number
}

export interface TrackPoint {
    x: number
    z: number
    tx: number
    tz: number
}

const TAU = Math.PI * 2
/** Segments either side of the hint that a projection checks before falling back to a full scan. */
const SEARCH_WINDOW = 10

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

/** Two straights joined by two half circles, run anticlockwise seen from above (left turns). */
export function ovalTrack(straight = 360, radius = 75, step = 2): TrackDef {
    const pts: [number, number][] = []
    const half = straight / 2
    const line = (x: number, z0: number, z1: number) => {
        const n = Math.max(1, Math.round(Math.abs(z1 - z0) / step))
        for (let i = 0; i < n; i++) pts.push([x, z0 + (z1 - z0) * i / n])
    }
    const arc = (cz: number, a0: number) => {
        const n = Math.max(8, Math.round(Math.PI * radius / step))
        for (let i = 0; i < n; i++) {
            const a = a0 + Math.PI * i / n
            pts.push([Math.cos(a) * radius, cz - Math.sin(a) * radius])
        }
    }
    // Start mid main straight on the right, heading up the screen (-z).
    line(radius, 0, -half)
    arc(-half, 0)
    line(-radius, -half, half)
    arc(half, Math.PI)
    line(radius, half, 0)
    return { id: 'polytown-oval', name: 'Polytown Oval', points: pts, halfWidth: 9, wallOffset: 10.6 }
}

export class Track {
    readonly def: TrackDef
    readonly n: number
    readonly length: number
    readonly xs: Float64Array
    readonly zs: Float64Array
    /** Distance along the line at each point; `cum[n]` is the full lap. */
    readonly cum: Float64Array
    /** Per point: the unit tangent averaged over its two segments, so offsets mitre cleanly. */
    readonly txs: Float64Array
    readonly tzs: Float64Array
    /** Per point: how sharply the line turns there, in radians per metre. */
    readonly curvature: Float64Array

    constructor(def: TrackDef) {
        this.def = def
        const n = def.points.length
        this.n = n
        this.xs = new Float64Array(n)
        this.zs = new Float64Array(n)
        def.points.forEach(([x, z], i) => {
            this.xs[i] = x
            this.zs[i] = z
        })
        this.cum = new Float64Array(n + 1)
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n
            this.cum[i + 1] = this.cum[i]! + Math.hypot(this.xs[j]! - this.xs[i]!, this.zs[j]! - this.zs[i]!)
        }
        this.length = this.cum[n]!
        this.txs = new Float64Array(n)
        this.tzs = new Float64Array(n)
        this.curvature = new Float64Array(n)
        for (let i = 0; i < n; i++) {
            const p = (i - 1 + n) % n
            const j = (i + 1) % n
            const ax = this.xs[i]! - this.xs[p]!
            const az = this.zs[i]! - this.zs[p]!
            const bx = this.xs[j]! - this.xs[i]!
            const bz = this.zs[j]! - this.zs[i]!
            const la = Math.hypot(ax, az) || 1
            const lb = Math.hypot(bx, bz) || 1
            const tx = ax / la + bx / lb
            const tz = az / la + bz / lb
            const lt = Math.hypot(tx, tz) || 1
            this.txs[i] = tx / lt
            this.tzs[i] = tz / lt
            const turn = Math.abs(wrapAngle(Math.atan2(bx, bz) - Math.atan2(ax, az)))
            this.curvature[i] = turn / ((la + lb) / 2)
        }
    }

    get halfWidth() {
        return this.def.halfWidth
    }

    get wallOffset() {
        return this.def.wallOffset
    }

    /** Wraps any distance onto [0, length). */
    wrapS(s: number) {
        return ((s % this.length) + this.length) % this.length
    }

    /** The index of the segment holding distance `s`. */
    segmentAt(s: number) {
        const w = this.wrapS(s)
        let lo = 0
        let hi = this.n - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (this.cum[mid]! <= w) lo = mid
            else hi = mid - 1
        }
        return lo
    }

    pointAt(s: number, out: TrackPoint = { x: 0, z: 0, tx: 0, tz: 0 }): TrackPoint {
        const w = this.wrapS(s)
        const i = this.segmentAt(w)
        const j = (i + 1) % this.n
        const len = this.cum[i + 1]! - this.cum[i]!
        const t = len > 0 ? (w - this.cum[i]!) / len : 0
        out.x = this.xs[i]! + (this.xs[j]! - this.xs[i]!) * t
        out.z = this.zs[i]! + (this.zs[j]! - this.zs[i]!) * t
        out.tx = (this.xs[j]! - this.xs[i]!) / (len || 1)
        out.tz = (this.zs[j]! - this.zs[i]!) / (len || 1)
        return out
    }

    /** Nearest point on the centreline. Pass the last segment as `hint` to search only around it. */
    project(x: number, z: number, hint = -1, out: Projection = { seg: 0, s: 0, lateral: 0, tx: 0, tz: 1 }): Projection {
        let best = Infinity
        const test = (i: number) => {
            const j = (i + 1) % this.n
            const ax = this.xs[i]!
            const az = this.zs[i]!
            const dx = this.xs[j]! - ax
            const dz = this.zs[j]! - az
            const len2 = dx * dx + dz * dz || 1
            const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
            const cx = ax + dx * t
            const cz = az + dz * t
            const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz)
            if (d2 < best) {
                best = d2
                const len = Math.sqrt(len2)
                out.seg = i
                out.s = this.cum[i]! + len * t
                out.tx = dx / len
                out.tz = dz / len
                // Right of the driving direction is the tangent turned a quarter clockwise seen from above.
                out.lateral = (x - ax) * -out.tz + (z - az) * out.tx
            }
        }
        if (hint >= 0) {
            for (let k = -SEARCH_WINDOW; k <= SEARCH_WINDOW; k++) test((hint + k + this.n) % this.n)
        }
        // A teleport or a bad hint: the windowed answer is only trusted while it's on the track.
        if (hint < 0 || Math.sqrt(best) > this.def.wallOffset + 4) {
            best = Infinity
            for (let i = 0; i < this.n; i++) test(i)
        }
        return out
    }
}

export type LapEvent =
    | { type: 'split', lap: number, sector: number, time: number }
    | { type: 'lap', lap: number, time: number, splits: number[] }
    | { type: 'finish', total: number, laps: number[] }

/**
 * Race clock and lap counter. It follows an unwrapped race distance, so
 * reversing over the line and back never counts a lap, and interpolates each
 * crossing inside the step that made it, so times don't snap to the frame.
 */
export class LapTimer {
    readonly trackLength: number
    readonly totalLaps: number
    readonly sectors: number
    clock = 0
    distance: number
    lap = 0
    lapStart = 0
    splits: number[] = []
    laps: number[] = []
    finished = false
    private lastS: number

    constructor(trackLength: number, totalLaps: number, startDistance: number, sectors = 3) {
        this.trackLength = trackLength
        this.totalLaps = totalLaps
        this.sectors = sectors
        this.distance = startDistance
        this.lastS = ((startDistance % trackLength) + trackLength) % trackLength
    }

    get lapTime() {
        return this.clock - this.lapStart
    }

    update(s: number, dt: number): LapEvent[] {
        if (this.finished) return []
        const L = this.trackLength
        let ds = s - this.lastS
        if (ds > L / 2) ds -= L
        else if (ds < -L / 2) ds += L
        this.lastS = s
        const from = this.distance
        this.clock += dt
        this.distance += ds
        const events: LapEvent[] = []
        if (ds <= 0) return events
        const crossedAt = (mark: number) => this.clock - dt + dt * (mark - from) / ds
        for (;;) {
            const nextSplit = this.lap * L + (this.splits.length + 1) * L / this.sectors
            if (this.distance < nextSplit) break
            const at = crossedAt(nextSplit)
            if (this.splits.length < this.sectors - 1) {
                this.splits.push(at - this.lapStart)
                events.push({ type: 'split', lap: this.lap, sector: this.splits.length - 1, time: at - this.lapStart })
                continue
            }
            const time = at - this.lapStart
            events.push({ type: 'lap', lap: this.lap, time, splits: this.splits })
            this.laps.push(time)
            this.lap++
            this.lapStart = at
            this.splits = []
            if (this.lap >= this.totalLaps) {
                this.finished = true
                this.clock = at
                events.push({ type: 'finish', total: at, laps: [...this.laps] })
                break
            }
        }
        return events
    }
}
