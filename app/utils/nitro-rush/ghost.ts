import { GHOST_EPS as EPS, GHOST_HZ, GHOST_MAX_SECONDS, GHOST_POSE as POSE, ghostSampleCount, type Ghost } from '#shared/utils/nitro-rush/ghost'
import type { CarPose } from './types'

/** Playing a ghost back and recording one; its stored form lives in shared, so the server can check it. */

/** The longest stretch of lap time without a frame that still counts as a full recording. */
const MAX_GAP = 0.25

// ─── Pose maths ────────────────────────────────────────────────────────────

/** Spherical blend of the quaternions at `a[ai]` and `b[bi]`, written to `out[oi]`. */
function slerpInto(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number, f: number, out: number[] | Float32Array, oi: number) {
    const ax = a[ai]!, ay = a[ai + 1]!, az = a[ai + 2]!, aw = a[ai + 3]!
    let bx = b[bi]!, by = b[bi + 1]!, bz = b[bi + 2]!, bw = b[bi + 3]!
    let cos = ax * bx + ay * by + az * bz + aw * bw
    // The shorter way round.
    if (cos < 0) {
        cos = -cos
        bx = -bx
        by = -by
        bz = -bz
        bw = -bw
    }
    let ka = 1 - f
    let kb = f
    if (cos < 0.9995) {
        const angle = Math.acos(cos)
        const sin = Math.sin(angle)
        ka = Math.sin((1 - f) * angle) / sin
        kb = Math.sin(f * angle) / sin
    }
    const x = ax * ka + bx * kb
    const y = ay * ka + by * kb
    const z = az * ka + bz * kb
    const w = aw * ka + bw * kb
    const len = Math.hypot(x, y, z, w) || 1
    out[oi] = x / len
    out[oi + 1] = y / len
    out[oi + 2] = z / len
    out[oi + 3] = w / len
}

/** Pose `a` to pose `b` by `f`: positions lerped, orientations slerped, both carried on along the same line past 1. */
function blendInto(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number, f: number, out: number[] | Float32Array, oi: number) {
    for (let j = 0; j < 3; j++) out[oi + j] = a[ai + j]! + (b[bi + j]! - a[ai + j]!) * f
    slerpInto(a, ai + 3, b, bi + 3, f, out, oi + 3)
}

function poseToArray(p: CarPose, out: number[], oi = 0) {
    out[oi] = p.x
    out[oi + 1] = p.y
    out[oi + 2] = p.z
    out[oi + 3] = p.qx
    out[oi + 4] = p.qy
    out[oi + 5] = p.qz
    out[oi + 6] = p.qw
    return out
}

function arrayToPose(a: ArrayLike<number>, ai: number, out: CarPose) {
    out.x = a[ai]!
    out.y = a[ai + 1]!
    out.z = a[ai + 2]!
    out.qx = a[ai + 3]!
    out.qy = a[ai + 4]!
    out.qz = a[ai + 5]!
    out.qw = a[ai + 6]!
    return out
}

// ─── Playback ──────────────────────────────────────────────────────────────

const scratch: number[] = new Array(POSE).fill(0)

/** The ghost's pose at lap time `t`, held at its first and last pose outside the lap. */
export function ghostPose(g: Ghost, t: number, out: CarPose): CarPose {
    const n = g.data.length / POSE
    if (n === 1 || !(t > 0)) return arrayToPose(g.data, 0, out)
    if (t >= g.end) return arrayToPose(g.data, (n - 1) * POSE, out)
    const k = Math.min(n - 2, Math.floor(t * g.hz))
    const t0 = k / g.hz
    const t1 = k + 1 === n - 1 ? g.end : (k + 1) / g.hz
    const f = Math.min(1, Math.max(0, (t - t0) / Math.max(EPS, t1 - t0)))
    blendInto(g.data, k * POSE, g.data, (k + 1) * POSE, f, scratch, 0)
    return arrayToPose(scratch, 0, out)
}

/** Lap time `t` on a ghost that ends at `end`: one that carries on into its lap again from the line, rather than waiting there. */
export function ghostTime(t: number, end: number, carriesOn: boolean) {
    return carriesOn && end > 0 && t > end ? t % end : t
}

/** Ghost `g` at lap time `t`, into `out`: on a loop a flying lap carries on past the line until the car crosses it. */
export function replayGhost(g: Ghost, standing: boolean, closed: boolean, t: number, out: CarPose) {
    return ghostPose(g, ghostTime(t, g.end, closed && !standing), out)
}

// ─── Recording ─────────────────────────────────────────────────────────────

/**
 * Turns the rendered car's poses into a ghost. Feed it every frame on the clock with
 * `add(lapTime, pose)`, and call `lap(time)` when a lap closes: it returns that lap's
 * ghost if the recording covered the whole lap, and carries on into the next lap.
 * Frames come at any rate; the recorder resamples them onto its fixed grid.
 */
export class GhostRecorder {
    readonly hz: number
    private samples: number[] = []
    /** The next grid sample to fill. */
    private next = 0
    /** The last two frames, as [t, ...pose]. */
    private last: number[] | null = null
    private prev: number[] | null = null
    /** False once something (a late start, a gap, time running back) means this lap can't make a ghost. */
    private whole = true

    constructor(hz = GHOST_HZ) {
        this.hz = hz
    }

    reset() {
        this.samples = []
        this.next = 0
        this.last = null
        this.prev = null
        this.whole = true
    }

    add(t: number, pose: CarPose) {
        if (!Number.isFinite(t)) return
        const last = this.last
        if (last && t < last[0]! - EPS) {
            // The clock ran back: whatever this was, it isn't one lap any more.
            this.reset()
            this.whole = false
        }
        const frame = poseToArray(pose, [t], 1)
        if (!this.last) {
            // Recording joined after the lap's start can't produce its first poses.
            if (t > 1 / this.hz) this.whole = false
            this.last = frame
            this.fillTo(t)
            return
        }
        if (t - this.last[0]! > MAX_GAP) this.whole = false
        if (t - this.last[0]! < EPS) {
            // Same moment (the grid during the countdown): just the newer pose.
            this.last = frame
            this.fillTo(t)
            return
        }
        this.prev = this.last
        this.last = frame
        if (t > GHOST_MAX_SECONDS + 1) this.whole = false
        if (this.whole) this.fillTo(t)
    }

    /** The lap closed at lap time `time`. */
    lap(time: number): Ghost | null {
        const last = this.last
        let ghost: Ghost | null = null
        if (last && this.whole && time > 0 && time <= GHOST_MAX_SECONDS && time - last[0]! <= MAX_GAP) {
            // Frames run a touch behind the physics, so the last poses up to the line are extrapolated.
            const n = ghostSampleCount(time, this.hz)
            const out = this.samples.slice(0, Math.min(this.next, n - 1) * POSE)
            const tmp = new Array<number>(POSE)
            for (let k = out.length / POSE; k < n; k++) {
                out.push(...this.poseAt(k === n - 1 ? time : k / this.hz, tmp))
            }
            ghost = { hz: this.hz, end: time, data: Float32Array.from(out) }
        }
        // The next lap starts at the line: the frames carry over, shifted back by this lap.
        const carriedLast = last ? [last[0]! - time, ...last.slice(1)] : null
        const carriedPrev = this.prev ? [this.prev[0]! - time, ...this.prev.slice(1)] : null
        this.reset()
        this.last = carriedLast
        this.prev = carriedPrev
        if (carriedLast) this.fillTo(carriedLast[0]!)
        return ghost
    }

    /** Fills grid samples up to lap time `t` from the frames so far. */
    private fillTo(t: number) {
        const tmp = new Array<number>(POSE)
        while (this.next / this.hz <= t + EPS) {
            this.samples.push(...this.poseAt(this.next / this.hz, tmp))
            this.next++
        }
    }

    /** The car's pose at lap time `t`: between the last two frames, held before them, extrapolated a little past them. */
    private poseAt(t: number, out: number[]) {
        const last = this.last!
        const prev = this.prev
        if (!prev || last[0]! - prev[0]! < EPS) {
            for (let j = 0; j < POSE; j++) out[j] = last[j + 1]!
            return out
        }
        const f = (t - prev[0]!) / (last[0]! - prev[0]!)
        if (f <= 0) {
            for (let j = 0; j < POSE; j++) out[j] = prev[j + 1]!
            return out
        }
        blendInto(prev, 1, last, 1, Math.min(f, 1 + MAX_GAP / (last[0]! - prev[0]!)), out, 0)
        return out
    }
}
