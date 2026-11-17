import { newTrackFrame, type TrackFrame, type TrackLine } from '#shared/utils/nitro-rush/track'
import type { NrLivePose } from '#server/utils/nitro-rush-live'

// How a dev fake driver moves: along a line's racing line, posed the way `poseCar` poses a car.

/** Sideways grip a fake corners on, in m/s², about what a real car holds through a bend. */
const FAKE_GRIP = 32
const FAKE_MIN_SPEED = 20
/** Metres ahead a fake looks for a bend, so it brakes before it, not in it. */
const LOOKAHEAD = [0, 20, 45, 75]
/** How far past a sprint's finish a fake runs before it starts over. */
const SPRINT_OVERRUN = 30

/** Where distance `d` driven lands on the line: a loop wraps round, a sprint starts over once past its finish. */
export function nrFakeLapS(line: TrackLine, d: number): number {
    if (line.closed) return line.wrapS(d)
    const span = Math.min(line.length, line.finishS + SPRINT_OVERRUN)
    return ((d % span) + span) % span
}

/** The pace a fake with top speed `top` keeps at `d`: slower for any bend just ahead. */
export function nrFakeSpeedAt(line: TrackLine, d: number, top: number): number {
    const curvature = line.racingCurvature
    let v = top
    for (const ahead of LOOKAHEAD) {
        const k = Math.abs(curvature[line.segmentAt(nrFakeLapS(line, d + ahead))] ?? 0)
        if (k > 1e-6) v = Math.min(v, Math.sqrt(FAKE_GRIP / k))
    }
    return Math.max(FAKE_MIN_SPEED, v)
}

/** The car at distance `d`, `lateral` metres right of the centreline, nose along the road and roof off its surface. */
export function nrFakePoseAt(line: TrackLine, d: number, lateral = 0, frame: TrackFrame = newTrackFrame()): NrLivePose {
    const f = line.frameAt(nrFakeLapS(line, d), frame)
    // Model axes as `poseCar` has them: nose down -z, roof up +y, x = forward × up.
    let ux = f.ry * f.tz - f.rz * f.ty
    let uy = f.rz * f.tx - f.rx * f.tz
    let uz = f.rx * f.ty - f.ry * f.tx
    let sx = f.ty * uz - f.tz * uy
    let sy = f.tz * ux - f.tx * uz
    let sz = f.tx * uy - f.ty * ux
    const sl = Math.hypot(sx, sy, sz) || 1
    sx /= sl
    sy /= sl
    sz /= sl
    ux = sy * f.tz - sz * f.ty
    uy = sz * f.tx - sx * f.tz
    uz = sx * f.ty - sy * f.tx
    return {
        x: f.x + f.rx * lateral,
        y: f.y + f.ry * lateral,
        z: f.z + f.rz * lateral,
        ...quatOfBasis(sx, sy, sz, ux, uy, uz, -f.tx, -f.ty, -f.tz)
    }
}

/** The rotation whose matrix has columns x, y and z (orthonormal), as three's `setFromRotationMatrix` works it out. */
function quatOfBasis(m11: number, m21: number, m31: number, m12: number, m22: number, m32: number, m13: number, m23: number, m33: number) {
    const trace = m11 + m22 + m33
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1)
        return { qx: (m32 - m23) * s, qy: (m13 - m31) * s, qz: (m21 - m12) * s, qw: 0.25 / s }
    }
    if (m11 > m22 && m11 > m33) {
        const s = 2 * Math.sqrt(1 + m11 - m22 - m33)
        return { qx: 0.25 * s, qy: (m12 + m21) / s, qz: (m13 + m31) / s, qw: (m32 - m23) / s }
    }
    if (m22 > m33) {
        const s = 2 * Math.sqrt(1 + m22 - m11 - m33)
        return { qx: (m12 + m21) / s, qy: 0.25 * s, qz: (m23 + m32) / s, qw: (m13 - m31) / s }
    }
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22)
    return { qx: (m13 + m31) / s, qy: (m23 + m32) / s, qz: 0.25 * s, qw: (m21 - m12) / s }
}
