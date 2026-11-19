import { newProjection, SPEED_CEILING, type LapLine, type RouteLeg, type Track } from './track'
import { joinedFields, type CourseField } from './track-fields'
import { farTurn } from './far-line'

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
    /** Over the line short of checkpoints, so the lap goes on; `required` when one it missed is a required one. */
    | { type: 'missed', lap: number, required: boolean }

/** Metres on top of the speed ceiling's travel that one step may move and still count as driven. */
const DRIVEN_SLACK = 5
/** How far below a line a car may cross it, and how far above before it has to be over that line's road. */
const LINE_BELOW = 2
const LINE_ABOVE = 5
/** Metres along the road from a line that the road under a high car may be and still be that line's. */
const LINE_ROAD_SLACK = 5
/** Seconds of crossings kept, for a respawn to take back what a flight crossed before it fell. */
const LOG_SECONDS = 30
/** Ways over a road loop's start kept, newest last, for a respawn carried over it to take back. */
const START_WAYS = 64

interface Crossing {
    line: LapLine
    /** Share of the step's move at which it crossed. */
    f: number
    /** Along the road's way across the line. */
    forward: boolean
}

/**
 * Lap clock: a lap is K checkpoints in any order, every required one among them, then a loop's start or a sprint's finish.
 * Every line counts either way through and a loop goes either way round; a move longer than one step's drive crosses nothing.
 */
export class LapTimer {
    readonly closed: boolean
    readonly k: number
    /** Ids of the checkpoints every lap has to drive. */
    readonly required: readonly number[]
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
    /** A loop whose start is a gate on a field, which a car can drive round instead of through. */
    private readonly gated: boolean
    /** On a loop started on the road, rounds of the start line the car is past since its lap set off over it; -1 is just behind it. */
    private wind: number
    /** Which way the car went over that line each time, so a respawn only takes back a crossing it made, never adds one. */
    private startWays: boolean[]
    /** On a loop started on a field, crossings of its gate still owed before one can end a lap. */
    private owed: number
    private log: { at: number, line: LapLine, forward: boolean }[] = []
    private readonly under = newProjection()
    /** A field start and those joined to it, which the car has to leave between laps so it can't just circle the gate. */
    private readonly home: readonly CourseField[]
    private away: boolean
    /** On a loop started on a field, the far line's progress (`far-line.ts`): a lap has to have crossed it once more one way than the other. */
    private readonly farAt: number | null
    private turn = 0
    /** Progress where the car was last seen off its start's fields; NaN on them, as a way across them crosses nothing. */
    private lastP = Number.NaN
    private readonly where = newProjection()
    /** Whether `where` is a good place to search on from, rather than the whole course. */
    private hinted = false
    private readonly spot = { u: 0, v: 0 }

    /** The car sets off at (x, y, z); on a loop, behind the line it owes a crossing first, unless `owes` says otherwise. */
    constructor(track: Track, x: number, y: number, z: number, owes?: boolean) {
        this.track = track
        this.closed = track.closed
        this.k = track.k
        this.required = track.requiredIds
        this.lines = track.lapLines
        this.splits = this.blankSplits()
        this.x = x
        this.y = y
        this.z = z
        const start = this.lines[0]!
        const behind = (x - start.x) * start.tx + (z - start.z) * start.tz < 0 && Math.hypot(x - start.x, z - start.z) < start.reach * 4
        const owing = this.closed && (owes ?? behind)
        this.gated = this.closed && start.field !== undefined
        this.wind = owing ? -1 : 0
        this.startWays = [!owing]
        this.owed = owing && this.gated ? 1 : 0
        // An arena's laps never leave its fields; its checkpoints, at least one, keep a lap from circling the gate.
        this.home = this.gated && !track.arena ? joinedFields(track.fields, start.field!) : []
        this.away = !this.onHome(x, z)
        this.farAt = this.home.length ? track.farProgress : null
    }

    get lapTime() {
        return this.clock - this.lapStart
    }

    private onHome(x: number, z: number) {
        return this.home.some(f => f.contains(f.local(x, z, this.spot).u, this.spot.v))
    }

    /** Counts the far line between the car's last place off its start's fields and (x, y, z); `jumped` when it didn't drive there. */
    private sample(x: number, y: number, z: number, jumped: boolean) {
        if (this.farAt === null) return
        if (this.onHome(x, z)) {
            this.lastP = Number.NaN
            this.hinted = false
            return
        }
        // Searched on from the last place, unless the car was moved, as a car searched from a field it was carried off stays on it.
        const p = this.hinted && !jumped ? this.track.locate(x, z, this.where.branch, this.where.seg, this.where, y) : this.track.nearest(x, z, this.where, y)
        this.hinted = true
        const at = this.track.progressAt(p.branch, p.s)
        this.turn += farTurn(this.lastP, at, this.farAt)
        this.lastP = at
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
        if (!this.away && !this.onHome(x, z)) this.away = true
        const jumped = Math.hypot(dx, dz) > SPEED_CEILING * dt + DRIVEN_SLACK
        if (driven) this.sample(x, y, z, jumped)
        if (!driven || jumped) return []
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
            this.log.push({ at, line: c.line, forward: c.forward })
            if (c.line.kind === 'checkpoint') {
                if (this.touched.includes(c.line.id)) continue
                this.touched.push(c.line.id)
                this.splits[c.line.id] = at - this.lapStart
                events.push({ type: 'split', lap: this.lap, sector: c.line.id, time: at - this.lapStart, touched: this.touched.length })
                continue
            }
            const ends = this.closed ? c.line.kind === 'start' : c.line.kind === 'finish'
            if (!ends) continue
            const skipped = this.required.some(id => !this.touched.includes(id))
            const met = !skipped && this.touched.length >= this.k
            if (this.closed && !this.gated) {
                // Back over the line the lap set off from is no lap, whichever way the car went over it.
                const round = c.forward ? this.wind + 1 : this.wind
                this.wind += c.forward ? 1 : -1
                this.startWays.push(c.forward)
                if (this.startWays.length > START_WAYS) this.startWays.shift()
                if (round === 0) continue
            } else if (this.closed) {
                const ready = this.away && (this.farAt === null || this.turn !== 0)
                // Off the grid, or back after a respawn: a crossing that can't end a lap only pays it off.
                if (this.owed > 0 && !(ready && met)) {
                    this.owed--
                    this.away = !this.home.length
                    this.turn = 0
                    continue
                }
                if (!ready) continue
            }
            if (!met) {
                events.push({ type: 'missed', lap: this.lap, required: skipped })
                continue
            }
            this.wind = c.forward ? 0 : -1
            this.owed = 0
            this.away = !this.home.length
            this.turn = 0
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
        // Coming down on a field, a line counts if it lies across that field, wherever on it the car lands.
        if (this.under.field >= 0) return this.track.fields[this.under.field]!.crossedAt(line.branch, line.s)
        return this.under.branch === line.branch && Math.abs(this.under.s - line.s) <= LINE_ROAD_SLACK
    }

    /** Takes back a crossing of `line` made `forward` or not, as the car is put back on the side it came from. */
    private undo(line: LapLine, forward: boolean) {
        if (line.kind === 'checkpoint') {
            const i = this.touched.indexOf(line.id)
            if (i < 0) return
            this.touched.splice(i, 1)
            this.splits[line.id] = null
        } else if (this.closed && line.kind === 'start') {
            if (this.gated) this.owed++
            else if (this.startWays.at(-1) === forward) {
                this.startWays.pop()
                this.wind += forward ? -1 : 1
            }
        }
    }

    /**
     * The car put back on the road at (x, y, z), as a respawn does: whatever it crossed since it left the road at
     * clock `since` is taken back, and so is every line on the road `legs` carry it over, either way along it; being carried counts as no crossing.
     */
    rewind(since: number, legs: readonly RouteLeg[], x: number, y: number, z: number) {
        const flown = this.log.filter(c => c.at > since)
        this.log = this.log.filter(c => c.at <= since)
        for (const c of flown.reverse()) this.undo(c.line, c.forward)
        for (const leg of legs) {
            const line = this.track.branches[leg.branch]!
            const lo = Math.min(leg.from, leg.to)
            const hi = Math.max(leg.from, leg.to)
            // Carried back down the road is as if it had crossed forward and that were taken back.
            const back = leg.to < leg.from
            const on = (s: number) => back ? s <= hi && s > lo : s >= lo && s < hi
            for (const l of this.lines) {
                if (l.branch !== leg.branch) continue
                if (on(l.s) || (line.closed && (on(l.s - line.length) || on(l.s + line.length)))) this.undo(l, back)
            }
        }
        this.x = x
        this.y = y
        this.z = z
        this.sample(x, y, z, true)
    }
}
