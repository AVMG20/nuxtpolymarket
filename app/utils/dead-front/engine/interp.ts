import type { DfPlayerSnap, DfSnapshot, DfZombieSnap } from '#shared/utils/dead-front/protocol'
import type { Vec3 } from '#shared/utils/dead-front/types'

// Snapshot buffer and interpolation for remote entities (pure, tested).
// Remote players and zombies render DF_INTERP_DELAY_MS behind the estimated
// server clock; when the next snapshot is late the newest pair extrapolates
// for a short while, then holds.
//
// Built for a weak link (40-90 ms round trip with regular 300 ms spikes): the
// clock offset is the earliest arrival over a short window, so a spike (and
// the burst of stale snapshots after it) never moves it, and the render clock
// slews toward it at a few percent instead of stepping. Lateness beyond the
// jitter margin counts as a spike, kept apart from the jitter: remote players
// widen their delay to ride spikes out, zombies keep a short delay and
// dead-reckon through them.

const MAX_SNAPS = 40
/** Longest extrapolation past the newest snapshot, in seconds (remote players, projectiles). */
export const DF_MAX_EXTRAPOLATE = 0.25
/** Zombies dead-reckon along their velocity and are smoothed: they can bridge a whole 300 ms spike plus a tick. */
export const DF_MAX_ZOMBIE_EXTRAPOLATE = 0.5
/** Upper bound for the adaptive render delay, in ms. */
export const DF_MAX_INTERP_DELAY_MS = 300
/** Remote players may run further behind to ride out a 300 ms spike plus a tick without extrapolating. */
export const DF_MAX_PLAYER_DELAY_MS = 380
/** Lower bound for the zombies' render delay, in ms. */
export const DF_MIN_ZOMBIE_DELAY_MS = 55
/** Arrivals later than the jitter margin by this much (ms) are a lag spike, not jitter. */
const SPIKE_MARGIN_MS = 40
/** Snapshots arriving within this many ms of the previous one came out of one queue (a burst). */
const BURST_MS = 12
/** The clock offset is the earliest arrival within this window (ms). */
const OFFSET_WINDOW_MS = 1000
/** Fraction of real time the render clock may run fast or slow while it re-syncs; faster when far off. */
const CLOCK_SLEW = 0.05
const CLOCK_SLEW_FAR = 0.2
/** A re-sync bigger than this (ms) jumps instead (a pause, a stalled server). */
const CLOCK_SNAP_MS = 500
/** How fast a render delay may grow / shrink, as a fraction of real time (the render clock's speed change). */
const DELAY_GROW = 0.1
const DELAY_SHRINK = 0.05

/** Seconds after which a prediction is dropped even though no snapshot acknowledged it (inputs not getting through). */
export const DF_PREDICTION_TIMEOUT = 3

/**
 * Has the server answered a prediction (a hit, kill, points, buy, ammo)? One
 * ordered socket carries everything and the server handles each message as it
 * lands, so once a snapshot acks an input sent after the action (`ackNeeded`
 * is the next input seq at the time), the action's outcome is in that snapshot
 * or an earlier one. A late answer (a spike, the stale burst after it) is never
 * mistaken for a refusal, however long it takes; only a line that delivers
 * nothing falls back to the timeout.
 */
export function dfPredictionSettled(ackNeeded: number, snapAck: number, ageS: number, rttMs: number): boolean {
    return snapAck >= ackNeeded || ageS > DF_PREDICTION_TIMEOUT + Math.max(0, rttMs) / 500
}

/**
 * Eases a render delay (ms) toward its target. The change shows as the render
 * clock running slow (growing) or fast (shrinking), so it is capped at 10% /
 * 5% of real time: zombies never visibly slow down after a spike.
 */
export function dfEaseDelay(current: number, target: number, dt: number): number {
    const d = target - current
    const step = d * Math.min(1, dt * (d > 0 ? 2 : 0.3))
    return current + Math.max(-DELAY_SHRINK * dt * 1000, Math.min(DELAY_GROW * dt * 1000, step))
}

export interface DfBufferedSnap {
    s: DfSnapshot
    zombies: Map<number, DfZombieSnap>
    players: Map<number, DfPlayerSnap>
}

export interface DfSample {
    a: DfBufferedSnap
    b: DfBufferedSnap
    /** 0..1 between a and b; >1 extrapolating past b. */
    alpha: number
    /** Seconds between a and b. */
    span: number
}

/** Shortest-arc angle lerp (radians). */
export function dfLerpAngle(a: number, b: number, t: number): number {
    let d = (b - a) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    else if (d < -Math.PI) d += Math.PI * 2
    return a + d * t
}

export function dfWrapAngle(a: number): number {
    let x = a % (Math.PI * 2)
    if (x > Math.PI) x -= Math.PI * 2
    else if (x < -Math.PI) x += Math.PI * 2
    return x
}

/** A fresh sample object for `DfSnapBuffer.at(t, out)`. */
export function dfNewSample(): DfSample {
    return { a: null as unknown as DfBufferedSnap, b: null as unknown as DfBufferedSnap, alpha: 0, span: 0.05 }
}

export class DfSnapBuffer {
    readonly snaps: DfBufferedSnap[] = []
    /**
     * Estimated localMs - serverMs: the earliest arrival over the last second.
     * Set it to null to re-sync (after a pause the server clock resumes where it stopped).
     */
    offset: number | null = null
    /** Smoothed lateness of arrivals (ms) under normal jitter, see targetDelay. */
    jitter = 0
    /** Lateness of recent lag spikes (ms), fading over ~50 s (a weak line spikes again); see targetDelay. */
    spike = 0
    /** The offset the render clock runs on: slews toward `offset`. */
    private clock: number | null = null
    private clockAt = 0
    private lastArrival = -Infinity
    /** Arrival time and offset sample of recent snapshots (for the windowed minimum). */
    private readonly arrivals: { at: number, sample: number }[] = []
    private readonly sample: DfSample = { a: null as unknown as DfBufferedSnap, b: null as unknown as DfBufferedSnap, alpha: 0, span: 0.05 }

    get latest(): DfBufferedSnap | null {
        return this.snaps[this.snaps.length - 1] ?? null
    }

    /** Adds a snapshot received at local time `nowMs`. Returns false for stale / duplicate ones. */
    push(s: DfSnapshot, nowMs: number): boolean {
        const last = this.latest
        if (last && s.time <= last.s.time) {
            // a restarted clock (new match on the same buffer) resets everything
            if (s.time < last.s.time - 5) this.reset()
            else return false
        }
        const z = new Map<number, DfZombieSnap>()
        for (const e of s.zombies) z.set(e.id, e)
        const p = new Map<number, DfPlayerSnap>()
        for (const e of s.players) p.set(e.pid, e)
        this.snaps.push({ s, zombies: z, players: p })
        if (this.snaps.length > MAX_SNAPS) this.snaps.shift()
        const sample = nowMs - s.time * 1000
        if (this.offset === null) {
            // first snapshot, or a re-sync was asked for
            this.arrivals.length = 0
            this.clock = null
        }
        this.arrivals.push({ at: nowMs, sample })
        while (this.arrivals.length > 1 && this.arrivals[0]!.at < nowMs - OFFSET_WINDOW_MS) this.arrivals.shift()
        let min = sample
        for (const a of this.arrivals) if (a.sample < min) min = a.sample
        this.offset = min
        // How late snapshots arrive relative to the earliest ones: network and server-tick jitter.
        // Snapshots landing together (the queue a stall releases) are less late than the first of
        // them, which already counted: skipping them keeps a spike's burst from inflating the jitter.
        const burst = nowMs - this.lastArrival < BURST_MS
        this.lastArrival = nowMs
        const late = Math.max(0, sample - min)
        if (burst) {
            // counted with the first of the burst
        } else if (late > this.jitter * 2.5 + SPIKE_MARGIN_MS) {
            // a lag spike, or the stale burst right after it: remembered apart, it barely moves the jitter
            this.spike = Math.max(this.spike, late)
            this.jitter += (late - this.jitter) * 0.02
        } else {
            this.jitter += (late - this.jitter) * (late > this.jitter ? 0.25 : 0.02)
        }
        this.spike *= 0.999
        return true
    }

    /**
     * Render delay (ms) for remote players: two snapshots ahead of the render
     * clock under the measured jitter (one tick plus a margin), widened to ride
     * out recent lag spikes (teammates may run a little behind; they must not snap).
     */
    targetDelay(baseMs: number, tickMs: number): number {
        const spike = this.spike > 1 ? this.spike + tickMs * 0.5 + this.jitter : 0
        return Math.min(DF_MAX_PLAYER_DELAY_MS, Math.max(baseMs, Math.min(DF_MAX_INTERP_DELAY_MS, tickMs + this.jitter * 2.5 + 30), spike))
    }

    /**
     * Zombies render closer to the present than players: about one tick plus
     * the jitter margin, spikes ignored. Past the newest snapshot they
     * dead-reckon along their velocity (up to DF_MAX_ZOMBIE_EXTRAPOLATE) and
     * `DfZombieSmoother` blends the correction in, so a lower delay costs no
     * visible snapping and zombies stay where they really are.
     */
    zombieDelay(tickMs: number): number {
        return Math.min(DF_MAX_INTERP_DELAY_MS, Math.max(DF_MIN_ZOMBIE_DELAY_MS, tickMs + this.jitter * 1.5 + 10))
    }

    reset(): void {
        this.snaps.length = 0
        this.arrivals.length = 0
        this.offset = null
        this.clock = null
        this.lastArrival = -Infinity
        this.jitter = 0
        this.spike = 0
    }

    /**
     * Server time (seconds) to render remote entities at. The clock slews
     * toward the measured offset (5% of real time, 20% when far off) so a
     * re-estimate never steps entities back or forward.
     */
    renderTime(nowMs: number, delayMs: number): number {
        if (this.offset === null) return 0
        if (this.clock === null) {
            this.clock = this.offset
            this.clockAt = nowMs
        } else if (nowMs > this.clockAt) {
            const diff = this.offset - this.clock
            const elapsed = nowMs - this.clockAt
            this.clockAt = nowMs
            if (Math.abs(diff) > CLOCK_SNAP_MS) {
                this.clock = this.offset
            } else {
                const max = elapsed * (Math.abs(diff) > 100 ? CLOCK_SLEW_FAR : CLOCK_SLEW)
                this.clock += Math.max(-max, Math.min(max, diff))
            }
        }
        return (nowMs - this.clock - delayMs) / 1000
    }

    /**
     * Finds the pair of snapshots around `t` (server seconds), extrapolating at
     * most `maxOver` seconds past the newest. The returned object is reused (pass `out` to keep two).
     */
    at(t: number, out: DfSample = this.sample, maxOver = DF_MAX_EXTRAPOLATE): DfSample | null {
        const n = this.snaps.length
        if (n === 0) return null
        if (n === 1) {
            out.a = out.b = this.snaps[0]!
            out.alpha = 1
            out.span = 0.05
            return out
        }
        const first = this.snaps[0]!
        if (t <= first.s.time) {
            out.a = first
            out.b = this.snaps[1]!
            out.span = Math.max(1e-3, out.b.s.time - out.a.s.time)
            out.alpha = 0
            return out
        }
        for (let i = n - 1; i > 0; i--) {
            const a = this.snaps[i - 1]!
            const b = this.snaps[i]!
            if (t >= a.s.time && (t <= b.s.time || i === n - 1)) {
                out.a = a
                out.b = b
                out.span = Math.max(1e-3, b.s.time - a.s.time)
                const over = Math.min(t - b.s.time, maxOver)
                out.alpha = t <= b.s.time ? (t - a.s.time) / out.span : 1 + Math.max(0, over) / out.span
                return out
            }
        }
        return null
    }

    /** Drops snapshots older than `t` minus a margin (keeps at least two). */
    trim(t: number): void {
        while (this.snaps.length > 2 && this.snaps[1]!.s.time < t - 1) this.snaps.shift()
    }
}

export function dfLerpVec(a: Vec3, b: Vec3, t: number, out: Vec3): Vec3 {
    out.x = a.x + (b.x - a.x) * t
    out.y = a.y + (b.y - a.y) * t
    out.z = a.z + (b.z - a.z) * t
    return out
}

function newZombie(): DfZombieSnap {
    return { id: 0, type: 'shambler', pos: { x: 0, y: 0, z: 0 }, yaw: 0, hp: 1, anim: 'walk' }
}

/**
 * Interpolated zombie list for a sample, written into `pool` (grown as
 * needed, objects reused). Zombies present only in `b` appear at their `b`
 * state; zombies gone from `b` are dropped (the zombie view keeps corpses).
 */
export function dfInterpZombies(sample: DfSample, pool: DfZombieSnap[], out: DfZombieSnap[]): DfZombieSnap[] {
    const { a, b } = sample
    const t = sample.alpha
    out.length = 0
    let i = 0
    for (const zb of b.s.zombies) {
        let z = pool[i]
        if (!z) pool[i] = z = newZombie()
        i++
        const za = a.zombies.get(zb.id)
        z.id = zb.id
        z.type = zb.type
        z.hp = zb.hp
        z.anim = zb.anim
        z.armored = zb.armored
        z.shocked = zb.shocked
        z.tell = zb.tell
        z.crawl = zb.crawl
        z.masked = zb.masked
        const vel = z.vel ?? (z.vel = { x: 0, y: 0, z: 0 })
        vel.x = zb.vel?.x ?? 0
        vel.y = zb.vel?.y ?? 0
        vel.z = zb.vel?.z ?? 0
        if (t > 1) {
            // past the newest snapshot: dead-reckon along the reported velocity (a standing
            // zombie sends none and stays put; extrapolating a→b would carry it on)
            const over = (t - 1) * sample.span
            z.pos.x = zb.pos.x + vel.x * over
            z.pos.y = zb.pos.y + vel.y * over
            z.pos.z = zb.pos.z + vel.z * over
            z.yaw = zb.yaw
        } else if (za && za !== zb) {
            // a long jump between snapshots (respawn / teleport) snaps instead of sliding
            const dx = zb.pos.x - za.pos.x
            const dz = zb.pos.z - za.pos.z
            if (dx * dx + dz * dz > 25) {
                z.pos.x = zb.pos.x
                z.pos.y = zb.pos.y
                z.pos.z = zb.pos.z
                z.yaw = zb.yaw
            } else {
                dfLerpVec(za.pos, zb.pos, t, z.pos)
                z.yaw = dfLerpAngle(za.yaw, zb.yaw, Math.min(1, t))
            }
        } else {
            z.pos.x = zb.pos.x
            z.pos.y = zb.pos.y
            z.pos.z = zb.pos.z
            z.yaw = zb.yaw
        }
        out.push(z)
    }
    return out
}

export interface DfInterpPlayer {
    pid: number
    pos: Vec3
    /** Horizontal velocity estimate (m/s) for animation. */
    vx: number
    vz: number
    vy: number
    yaw: number
    pitch: number
    flags: number
    snap: DfPlayerSnap
}

export function dfNewInterpPlayer(): DfInterpPlayer {
    return { pid: -1, pos: { x: 0, y: 0, z: 0 }, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, flags: 0, snap: null as unknown as DfPlayerSnap }
}

/** Interpolates one player from a sample into `out`. Returns false if the player isn't in `b`. */
export function dfInterpPlayer(sample: DfSample, pid: number, out: DfInterpPlayer): boolean {
    const pb = sample.b.players.get(pid)
    if (!pb) return false
    const pa = sample.a.players.get(pid) ?? pb
    const t = sample.alpha
    out.pid = pid
    out.snap = pb
    out.flags = t < 0.5 && pa ? pa.flags : pb.flags
    const dx = pb.pos.x - pa.pos.x
    const dy = pb.pos.y - pa.pos.y
    const dz = pb.pos.z - pa.pos.z
    if (dx * dx + dz * dz > 25) {
        out.pos.x = pb.pos.x
        out.pos.y = pb.pos.y
        out.pos.z = pb.pos.z
        out.vx = out.vz = out.vy = 0
    } else {
        dfLerpVec(pa.pos, pb.pos, t, out.pos)
        out.vx = dx / sample.span
        out.vy = dy / sample.span
        out.vz = dz / sample.span
    }
    out.yaw = dfLerpAngle(pa.yaw, pb.yaw, Math.min(1, t))
    out.pitch = pa.pitch + (pb.pitch - pa.pitch) * Math.min(1, t)
    return true
}

/** Fastest a zombie's drawn position slides toward a corrected one (m/s) under DfZombieSmoother. */
const MAX_CORRECTION = 2.5

interface SmoothState {
    x: number
    y: number
    z: number
    vy: number
    seen: number
}

/**
 * Exact step of a critically damped spring toward a fixed target: the offset
 * `e` (value minus target) and its velocity `v` after `dt` at frequency `w`.
 * Stable for any dt, never overshoots.
 */
export function dfCriticalSpring(e: number, v: number, w: number, dt: number, out: { e: number, v: number }): { e: number, v: number } {
    const k = Math.exp(-w * dt)
    const j = (v + w * e) * dt
    out.e = (e + j) * k
    out.v = (v - w * j) * k
    return out
}

/**
 * Smooths the interpolated zombies before they're drawn (pure, tested).
 * Horizontally each zombie is carried along its velocity and the remaining
 * error to the interpolated target decays exponentially, so a corrected
 * extrapolation slides instead of snapping and a moving zombie never lags.
 * Vertically a critically damped spring follows the target height on its
 * own, so stair steps read as a climb, not a hop. Big jumps snap.
 */
export class DfZombieSmoother {
    private readonly states = new Map<number, SmoothState>()
    private frame = 0
    private readonly sp = { e: 0, v: 0 }

    /** `k`: horizontal error decay (1/s); `w`: vertical spring frequency (rad/s). */
    constructor(readonly k = 14, readonly w = 18) {}

    apply(list: DfZombieSnap[], dt: number): void {
        this.frame++
        const f = this.frame
        const decay = Math.exp(-this.k * Math.max(0, dt))
        for (const z of list) {
            const s = this.states.get(z.id)
            if (!s) {
                this.states.set(z.id, { x: z.pos.x, y: z.pos.y, z: z.pos.z, vy: 0, seen: f })
                continue
            }
            s.seen = f
            const vx = z.vel?.x ?? 0
            const vz = z.vel?.z ?? 0
            const ex = s.x + vx * dt - z.pos.x
            const ez = s.z + vz * dt - z.pos.z
            const e2 = ex * ex + ez * ez
            if (e2 > 4) {
                s.x = z.pos.x
                s.z = z.pos.z
            } else {
                // the error decays exponentially, but a big one (a dead-reckoned spike corrected)
                // slides in no faster than MAX_CORRECTION so it reads as a step, not a jerk
                let k = decay
                const e = Math.sqrt(e2)
                const cap = MAX_CORRECTION * Math.max(0, dt)
                if (e * (1 - decay) > cap) k = 1 - cap / e
                s.x = z.pos.x + ex * k
                s.z = z.pos.z + ez * k
            }
            const ey = s.y - z.pos.y
            if (Math.abs(ey) > 1.5) {
                s.y = z.pos.y
                s.vy = 0
            } else {
                dfCriticalSpring(ey, s.vy, this.w, dt, this.sp)
                s.y = z.pos.y + this.sp.e
                s.vy = this.sp.v
            }
            z.pos.x = s.x
            z.pos.y = s.y
            z.pos.z = s.z
        }
        if (f % 120 === 0) {
            for (const [id, s] of this.states) if (f - s.seen > 120) this.states.delete(id)
        }
    }

    forget(id: number): void {
        this.states.delete(id)
    }
}
