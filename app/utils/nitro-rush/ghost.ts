import type { CarPose } from './types'

/**
 * The best-lap ghost: a recording of the car's pose against lap time, played back
 * at the same lap time on the next lap, and packed small enough to keep with the
 * track's record in localStorage.
 *
 * A ghost holds one pose per fixed step of lap time from 0, and a last pose at
 * the lap's end time. Poses are 7 numbers: x, y, z, qx, qy, qz, qw.
 */

/** Samples per second of lap time. */
export const GHOST_HZ = 15
/** Laps longer than this keep no ghost, which bounds what a record stores. */
export const GHOST_MAX_SECONDS = 300
/** The longest stretch of lap time without a frame that still counts as a full recording. */
const MAX_GAP = 0.25
const POSE = 7
const EPS = 1e-6
/** Positions are stored in centimetres, quaternion parts in steps of 1/QUAT_SCALE. */
const POS_SCALE = 100
const QUAT_SCALE = 16383
const INT16 = 32767

export interface Ghost {
    hz: number
    /** The lap time of the last pose, which is the lap's time. */
    end: number
    /** POSE numbers per sample. */
    data: Float32Array
}

/** How a ghost is kept in a track record: plain JSON, quantized and delta-packed. */
export interface StoredGhost {
    v: 1
    hz: number
    /** Lap time of the last pose, in milliseconds. */
    end: number
    /** The first pose, quantized. */
    o: number[]
    /** Base64 of little-endian int16 deltas between successive quantized poses. */
    d: string
}

/** Grid samples (k / hz for k from 0) before `end`, then one at `end`. */
export function ghostSampleCount(end: number, hz: number) {
    return Math.max(1, Math.ceil((end - EPS) * hz)) + 1
}

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

/** The ghost a course keeps: its lap's time, and whether that lap began from the grid. */
export interface KeptGhost {
    end: number
    standing: boolean
}

/**
 * Whether a lap's ghost takes over from the kept one: only a faster lap does, over every attempt.
 * A loop's standing first lap only stands in until a flying lap is driven, since it starts from the grid.
 */
export function replacesGhost(kept: KeptGhost | null, lap: { time: number, standing: boolean }) {
    if (!kept) return true
    if (lap.standing !== kept.standing) return kept.standing
    return lap.time < kept.end
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

// ─── Storage ───────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array) {
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode(...bytes.subarray(i, i + 0x2000))
    return btoa(s)
}

function fromBase64(text: string) {
    const s = atob(text)
    const bytes = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
    return bytes
}

/** Packs a ghost for a track record, or null if it can't be packed (a jump too long between samples). */
export function encodeGhost(g: Ghost): StoredGhost | null {
    const n = g.data.length / POSE
    if (n < 2 || n !== ghostSampleCount(g.end, g.hz)) return null
    const q = new Int32Array(g.data.length)
    for (let k = 0; k < n; k++) {
        const i = k * POSE
        // Keep each quaternion on the same side as the one before, so the deltas stay small.
        let sign = 1
        if (k > 0) {
            let dot = 0
            for (let j = 3; j < POSE; j++) dot += g.data[i + j]! * q[i - POSE + j]!
            if (dot < 0) sign = -1
        }
        for (let j = 0; j < 3; j++) q[i + j] = Math.round(g.data[i + j]! * POS_SCALE)
        for (let j = 3; j < POSE; j++) q[i + j] = Math.round(sign * g.data[i + j]! * QUAT_SCALE)
    }
    const view = new DataView(new ArrayBuffer((n - 1) * POSE * 2))
    for (let i = POSE; i < q.length; i++) {
        const d = q[i]! - q[i - POSE]!
        if (Math.abs(d) > INT16) return null
        view.setInt16((i - POSE) * 2, d, true)
    }
    return { v: 1, hz: g.hz, end: Math.round(g.end * 1000), o: Array.from(q.subarray(0, POSE)), d: toBase64(new Uint8Array(view.buffer)) }
}

/** A stored ghost back to poses, or null for anything that isn't one (missing, from an old version, damaged). */
export function decodeGhost(raw: unknown): Ghost | null {
    try {
        if (!raw || typeof raw !== 'object') return null
        const s = raw as Partial<StoredGhost>
        if (s.v !== 1 || typeof s.d !== 'string' || !Array.isArray(s.o) || s.o.length !== POSE) return null
        if (!Number.isInteger(s.hz) || s.hz! < 1 || s.hz! > 60) return null
        if (!Number.isInteger(s.end) || s.end! <= 0 || s.end! > GHOST_MAX_SECONDS * 1000) return null
        if (!s.o.every(v => Number.isInteger(v) && Math.abs(v) < 1e9)) return null
        const hz = s.hz!
        const end = s.end! / 1000
        const bytes = fromBase64(s.d)
        if (bytes.length === 0 || bytes.length % (POSE * 2) !== 0) return null
        const n = bytes.length / (POSE * 2) + 1
        // The end was rounded to the millisecond: the last grid sample before it may sit a hair either side.
        if ((n - 2) / hz >= end + 1e-3 || (n - 1) / hz < end - 1e-3) return null
        const view = new DataView(bytes.buffer)
        const q = new Int32Array(n * POSE)
        q.set(s.o)
        for (let i = POSE; i < q.length; i++) q[i] = q[i - POSE]! + view.getInt16((i - POSE) * 2, true)
        const data = new Float32Array(q.length)
        for (let k = 0; k < n; k++) {
            const i = k * POSE
            for (let j = 0; j < 3; j++) data[i + j] = q[i + j]! / POS_SCALE
            const len = Math.hypot(q[i + 3]!, q[i + 4]!, q[i + 5]!, q[i + 6]!)
            if (len < QUAT_SCALE * 0.5) return null
            for (let j = 3; j < POSE; j++) data[i + j] = q[i + j]! / len
        }
        return { hz, end, data }
    } catch {
        return null
    }
}
