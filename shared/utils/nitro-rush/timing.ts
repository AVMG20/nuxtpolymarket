import { newProjection, SPEED_CEILING, type LapLine, type RouteLeg, type Track } from './track'

/** Lap clock and how times read; shared by the game, the server's leaderboard and the tests. */

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

/** A time for the HUD and menus, or a blank one before there is any. */
export const lapTimeOrBlank = (seconds: number | null) => seconds === null ? '-:--.---' : formatLapTime(seconds)

export type LapEvent =
    /** `sector` is the checkpoint's id; `touched` how many the lap has touched with it. */
    | { type: 'split', lap: number, sector: number, time: number, touched: number }
    /** `splits` holds each checkpoint's time by id, null where the lap didn't touch it. */
    | { type: 'lap', lap: number, time: number, splits: (number | null)[] }

/** Metres on top of the speed ceiling's travel that one step may move and still count as driven. */
const DRIVEN_SLACK = 5
/** How far below a line a car may cross it, and how far above before it has to be over that line's road. */
const LINE_BELOW = 2
const LINE_ABOVE = 5
/** Metres along the road from a line that the road under a high car may be and still be that line's. */
const LINE_ROAD_SLACK = 5
/** Seconds of crossings kept, for a respawn to take back what a flight crossed before it fell. */
const LOG_SECONDS = 30

interface Crossing {
    line: LapLine
    /** Share of the step's move at which it crossed. */
    f: number
    forward: boolean
}

/**
 * Lap clock and counter for an endless session, run on the car's moves across the course's
 * lines. A lap counts once the car has touched K different checkpoints, in any order, where K
 * is the fewest any route drives, and then crosses the start line of a loop or a finish of a
 * sprint. Backing over a checkpoint takes it back. A move longer than the car can drive in a
 * step crosses nothing. Each crossing is interpolated inside the step that made it, so times
 * don't snap to the frame.
 *
 * On a loop the laps never stop; crossing the start line backward owes a crossing before the
 * next lap can close, and so does a grid behind it. A sprint's clock runs from GO, and its run
 * is over at the first finish crossed with K checkpoints touched.
 */
export class LapTimer {
    readonly closed: boolean
    readonly k: number
    clock = 0
    lap = 0
    lapStart = 0
    /** Each checkpoint's time on this lap, by id; null until touched. */
    splits: (number | null)[]
    /** Ids of the checkpoints this lap has touched, in the order it did. */
    touched: number[] = []
    finished = false
    private readonly track: Track
    private readonly lines: readonly LapLine[]
    private x: number
    private y: number
    private z: number
    private owed: number
    private log: { at: number, line: LapLine }[] = []
    private readonly under = newProjection()

    /** The car sets off at (x, y, z); on a loop, behind the line it owes a crossing first, unless `owes` says otherwise. */
    constructor(track: Track, x: number, y: number, z: number, owes?: boolean) {
        this.track = track
        this.closed = track.closed
        this.k = track.k
        this.lines = track.lapLines
        this.splits = this.blankSplits()
        this.x = x
        this.y = y
        this.z = z
        const start = this.lines[0]!
        const behind = (x - start.x) * start.tx + (z - start.z) * start.tz < 0 && Math.hypot(x - start.x, z - start.z) < start.reach * 4
        this.owed = this.closed && (owes ?? behind) ? 1 : 0
    }

    get lapTime() {
        return this.clock - this.lapStart
    }

    private blankSplits() {
        return new Array<number | null>(this.track.checkpointCount).fill(null)
    }

    /** One physics step to (x, y, z); `driven` is false while the car is off to the side of the road, whose moves then cross nothing. */
    update(x: number, y: number, z: number, dt: number, driven = true): LapEvent[] {
        if (this.finished) return []
        this.clock += dt
        const x0 = this.x
        const y0 = this.y
        const z0 = this.z
        this.x = x
        this.y = y
        this.z = z
        const dx = x - x0
        const dz = z - z0
        if (!driven || Math.hypot(dx, dz) > SPEED_CEILING * dt + DRIVEN_SLACK) return []
        const crossings: Crossing[] = []
        for (const line of this.lines) {
            const a0 = (x0 - line.x) * line.tx + (z0 - line.z) * line.tz
            const a1 = (x - line.x) * line.tx + (z - line.z) * line.tz
            const forward = a0 < 0 && a1 >= 0
            if (!forward && !(a0 >= 0 && a1 < 0)) continue
            const f = a0 / (a0 - a1)
            const cx = x0 + dx * f
            const cz = z0 + dz * f
            const cy = y0 + (y - y0) * f
            if (Math.abs((cx - line.x) * -line.tz + (cz - line.z) * line.tx) > line.reach) continue
            if (cy < line.y - LINE_BELOW || (cy > line.y + LINE_ABOVE && !this.overLine(line, cx, cy, cz))) continue
            crossings.push({ line, f, forward })
        }
        if (!crossings.length) return []
        crossings.sort((a, b) => a.f - b.f)
        const events: LapEvent[] = []
        this.log = this.log.filter(c => c.at > this.clock - LOG_SECONDS)
        for (const c of crossings) {
            const at = this.clock - dt + dt * c.f
            if (!c.forward) {
                this.backOver(c.line)
                continue
            }
            this.log.push({ at, line: c.line })
            if (c.line.kind === 'checkpoint') {
                if (this.touched.includes(c.line.id)) continue
                this.touched.push(c.line.id)
                this.splits[c.line.id] = at - this.lapStart
                events.push({ type: 'split', lap: this.lap, sector: c.line.id, time: at - this.lapStart, touched: this.touched.length })
                continue
            }
            const ends = this.closed ? c.line.kind === 'start' : c.line.kind === 'finish'
            if (!ends) continue
            if (this.owed > 0) {
                this.owed--
                continue
            }
            if (this.touched.length < this.k) continue
            events.push({ type: 'lap', lap: this.lap, time: at - this.lapStart, splits: this.splits })
            this.lap++
            this.lapStart = at
            this.splits = this.blankSplits()
            this.touched = []
            if (!this.closed) {
                this.finished = true
                this.clock = at
            }
            break
        }
        return events
    }

    /** A car high over a line crosses it only flying over that line's own road, not another road stacked above it. */
    private overLine(line: LapLine, x: number, y: number, z: number) {
        if (!this.track.landing(x, y, z, this.under)) return true
        return this.under.branch === line.branch && Math.abs(this.under.s - line.s) <= LINE_ROAD_SLACK
    }

    private backOver(line: LapLine) {
        if (line.kind === 'checkpoint') {
            const i = this.touched.indexOf(line.id)
            if (i < 0) return
            this.touched.splice(i, 1)
            this.splits[line.id] = null
        } else if (this.closed && line.kind === 'start') {
            this.owed++
        }
    }

    /**
     * The car put back on the road at (x, y, z), as a respawn does: whatever it crossed since it left
     * the road at clock `since`, and every line on the road `legs` take it back over, it has backed over.
     */
    rewind(since: number, legs: readonly RouteLeg[], x: number, y: number, z: number) {
        const flown = this.log.filter(c => c.at > since)
        this.log = this.log.filter(c => c.at <= since)
        for (const c of flown.reverse()) this.backOver(c.line)
        for (const leg of legs) {
            const line = this.track.branches[leg.branch]!
            for (const l of this.lines) {
                if (l.branch !== leg.branch) continue
                const on = (s: number) => s <= leg.from && s > leg.to
                if (on(l.s) || (line.closed && (on(l.s - line.length) || on(l.s + line.length)))) this.backOver(l)
            }
        }
        this.x = x
        this.y = y
        this.z = z
    }
}
