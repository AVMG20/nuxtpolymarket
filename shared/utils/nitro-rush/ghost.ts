/**
 * A Nitro Rush ghost: the car's pose against lap time, the line it actually drove, and
 * the packed form a track record keeps in the browser and on the server.
 *
 * A ghost holds one pose per fixed step of lap time from 0, and a last pose at
 * the lap's end time. Poses are 7 numbers: x, y, z, qx, qy, qz, qw.
 */

/** Samples per second of lap time. */
export const GHOST_HZ = 15
/** Laps longer than this keep no ghost, which bounds what a record stores. */
export const GHOST_MAX_SECONDS = 300
/** Numbers per pose. */
export const GHOST_POSE = 7
/** Lap times this close are the same moment. */
export const GHOST_EPS = 1e-6
/** Positions are stored in centimetres, quaternion parts in steps of 1/QUAT_SCALE. */
const POS_SCALE = 100
const QUAT_SCALE = 16383
const INT16 = 32767

export interface Ghost {
    hz: number
    /** The lap time of the last pose, which is the lap's time. */
    end: number
    /** GHOST_POSE numbers per sample. */
    data: Float32Array
}

/** How a ghost is kept in a track record and on the server: plain JSON, quantized and delta-packed. */
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
    return Math.max(1, Math.ceil((end - GHOST_EPS) * hz)) + 1
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
    const n = g.data.length / GHOST_POSE
    if (n < 2 || n !== ghostSampleCount(g.end, g.hz)) return null
    const q = new Int32Array(g.data.length)
    for (let k = 0; k < n; k++) {
        const i = k * GHOST_POSE
        // Keep each quaternion on the same side as the one before, so the deltas stay small.
        let sign = 1
        if (k > 0) {
            let dot = 0
            for (let j = 3; j < GHOST_POSE; j++) dot += g.data[i + j]! * q[i - GHOST_POSE + j]!
            if (dot < 0) sign = -1
        }
        for (let j = 0; j < 3; j++) q[i + j] = Math.round(g.data[i + j]! * POS_SCALE)
        for (let j = 3; j < GHOST_POSE; j++) q[i + j] = Math.round(sign * g.data[i + j]! * QUAT_SCALE)
    }
    const view = new DataView(new ArrayBuffer((n - 1) * GHOST_POSE * 2))
    for (let i = GHOST_POSE; i < q.length; i++) {
        const d = q[i]! - q[i - GHOST_POSE]!
        if (Math.abs(d) > INT16) return null
        view.setInt16((i - GHOST_POSE) * 2, d, true)
    }
    return { v: 1, hz: g.hz, end: Math.round(g.end * 1000), o: Array.from(q.subarray(0, GHOST_POSE)), d: toBase64(new Uint8Array(view.buffer)) }
}

/** A stored ghost back to poses, or null for anything that isn't one (missing, from an old version, damaged). */
export function decodeGhost(raw: unknown): Ghost | null {
    try {
        if (!raw || typeof raw !== 'object') return null
        const s = raw as Partial<StoredGhost>
        if (s.v !== 1 || typeof s.d !== 'string' || !Array.isArray(s.o) || s.o.length !== GHOST_POSE) return null
        if (!Number.isInteger(s.hz) || s.hz! < 1 || s.hz! > 60) return null
        if (!Number.isInteger(s.end) || s.end! <= 0 || s.end! > GHOST_MAX_SECONDS * 1000) return null
        if (!s.o.every(v => Number.isInteger(v) && Math.abs(v) < 1e9)) return null
        const hz = s.hz!
        const end = s.end! / 1000
        const bytes = fromBase64(s.d)
        if (bytes.length === 0 || bytes.length % (GHOST_POSE * 2) !== 0) return null
        const n = bytes.length / (GHOST_POSE * 2) + 1
        // The end was rounded to the millisecond: the last grid sample before it may sit a hair either side.
        if ((n - 2) / hz >= end + 1e-3 || (n - 1) / hz < end - 1e-3) return null
        const view = new DataView(bytes.buffer)
        const q = new Int32Array(n * GHOST_POSE)
        q.set(s.o)
        for (let i = GHOST_POSE; i < q.length; i++) q[i] = q[i - GHOST_POSE]! + view.getInt16((i - GHOST_POSE) * 2, true)
        const data = new Float32Array(q.length)
        for (let k = 0; k < n; k++) {
            const i = k * GHOST_POSE
            for (let j = 0; j < 3; j++) data[i + j] = q[i + j]! / POS_SCALE
            const len = Math.hypot(q[i + 3]!, q[i + 4]!, q[i + 5]!, q[i + 6]!)
            if (len < QUAT_SCALE * 0.5) return null
            for (let j = 3; j < GHOST_POSE; j++) data[i + j] = q[i + j]! / len
        }
        return { hz, end, data }
    } catch {
        return null
    }
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
