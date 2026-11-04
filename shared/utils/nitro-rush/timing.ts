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
