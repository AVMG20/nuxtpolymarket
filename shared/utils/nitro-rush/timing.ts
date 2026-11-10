import { SPEED_CEILING } from './track'

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
    | { type: 'split', lap: number, sector: number, time: number }
    | { type: 'lap', lap: number, time: number, splits: number[] }

/** Metres on top of the speed ceiling's travel that one step may move and still count as driven. */
const DRIVEN_SLACK = 5

/**
 * Lap clock and counter for an endless session. Each line counts only when
 * the car crosses it following the road, on it or flying along it, in order:
 * the checkpoints, then the line that ends the lap. A flight that lands on
 * road further on crosses nothing, so a skip past a checkpoint leaves the lap
 * open until the car goes back for it. Backing over a counted line takes it back.
 * Each crossing is interpolated inside the step that made it, so times don't
 * snap to the frame.
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
    lap = 0
    lapStart = 0
    splits: number[] = []
    finished = false
    private lastS: number
    /**
     * A loop with no checkpoints has one line to count: each time the car backs over it, it owes a
     * crossing before the next one closes a lap. The grid behind the line starts it owing one.
     */
    private owed: number

    constructor(lapLength: number, closed: boolean, startDistance: number, checkpoints: readonly number[] = []) {
        this.lapLength = lapLength
        this.closed = closed
        this.marks = [...checkpoints, lapLength]
        this.lastS = closed ? this.wrap(startDistance) : startDistance
        this.owed = closed && !checkpoints.length && startDistance < 0 ? 1 : 0
    }

    get lapTime() {
        return this.clock - this.lapStart
    }

    private wrap(s: number) {
        return ((s % this.lapLength) + this.lapLength) % this.lapLength
    }

    /** How far forward from `a` the line at `mark` is; on a loop the next time round when the car sits on it. */
    private ahead(a: number, mark: number) {
        return this.closed ? this.wrap(mark - a) || this.lapLength : mark - a
    }

    /** How far back from `a` the line at `mark` is: 0 when the car sits on it. */
    private behind(a: number, mark: number) {
        return this.closed ? this.wrap(a - mark) : a - mark
    }

    /** One physics step to `s`; `driven` is false while the car is off to the side of the road, whose moves then cross nothing. */
    update(s: number, dt: number, driven = true): LapEvent[] {
        if (this.finished) return []
        this.clock += dt
        const from = this.lastS
        this.lastS = s
        let ds = s - from
        if (this.closed) {
            const L = this.lapLength
            if (ds > L / 2) ds -= L
            else if (ds < -L / 2) ds += L
        }
        if (!driven || Math.abs(ds) > SPEED_CEILING * dt + DRIVEN_SLACK) return []
        if (ds < 0) {
            this.back(from, -ds)
            return []
        }
        const events: LapEvent[] = []
        for (;;) {
            const k = this.splits.length
            const d = this.ahead(from, this.marks[k]!)
            if (d <= 0 || d > ds) break
            const at = this.clock - dt + dt * d / ds
            if (this.owed > 0) {
                this.owed--
                break
            }
            if (k < this.marks.length - 1) {
                this.splits.push(at - this.lapStart)
                events.push({ type: 'split', lap: this.lap, sector: k, time: at - this.lapStart })
                continue
            }
            events.push({ type: 'lap', lap: this.lap, time: at - this.lapStart, splits: this.splits })
            this.lap++
            this.lapStart = at
            this.splits = []
            if (!this.closed) {
                this.finished = true
                this.clock = at
            }
            break
        }
        return events
    }

    /** The car put back `by` metres along the road from `from`, as a respawn does: any line it backs over is taken back. */
    rewind(from: number, by: number) {
        const to = this.closed ? this.wrap(from - by) : from - by
        // A flight crosses lines along the road past `from` before it falls; those are taken back too.
        const flown = this.closed ? this.wrap(this.lastS - to) : this.lastS - to
        const span = flown > by && (!this.closed || flown < this.lapLength / 2) ? flown : by
        this.back(this.closed ? this.wrap(to + span) : to + span, span)
        this.lastS = to
    }

    private back(from: number, by: number) {
        // A U-turn back over the last checkpoint would otherwise leave the lap's line ahead to cross again.
        while (this.splits.length && this.behind(from, this.marks[this.splits.length - 1]!) < by) this.splits.pop()
        if (this.marks.length > 1 || !this.closed) return
        const d = this.behind(from, this.marks[0]!)
        if (d < by) this.owed++
    }
}
