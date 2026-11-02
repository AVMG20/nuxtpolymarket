import { GHOST_POSE, type Ghost } from './ghost'
import { FALL_DEPTH, SPEED_CEILING, type Track } from './track'

/** Whether a ghost really drove a course: every pose on the road, moving through it in order from start to finish. */

/** Past the walls by more than this, a pose has left the road; loose enough for railed and banked road. */
export const OFF_ROAD_SLACK = 10
/** Metres a pose may sit below the road past the physics' fall depth: pose rounding and a landing's last step. */
export const BELOW_ROAD_SLACK = 2
/** The first pose sits this close to the start line along the road; a standing lap starts on the grid 14 m behind it. */
export const START_SLACK = 30
/** The last pose sits this close to the finish line along the road. */
export const FINISH_SLACK = 15
/** Metres on top of twice the top speed's travel that a pose may move along the road from the one before. */
export const STEP_SLACK = 10

interface Hit {
    /** Distance along the road, unwrapped on a loop. */
    s: number
    /** How far off the road: in 3D on rails, across the ground plan elsewhere. */
    off: number
    /** Metres below the lowest the car could be there, off rails; 0 or less is fine. */
    below: number
}

/**
 * The road nearest (x, y, z) between distances `from` and `to` (unwrapped on a loop). Rails are matched in 3D and win
 * when close enough, since a looping's plan overlaps the road around it; elsewhere a flight can sit any height above.
 */
function nearestAlong(track: Track, x: number, y: number, z: number, from: number, to: number, maxOff: number): Hit | null {
    const { xs, ys, zs, cum, segments, n, railed, right } = track
    let rail: Hit | null = null
    let plan: Hit | null = null
    if (!track.closed) {
        from = Math.max(0, from)
        to = Math.min(track.length, to)
        if (from > to) return null
    }
    let i = track.segmentAt(from)
    let base = track.closed ? from - track.wrapS(from) : 0
    for (let steps = 0; steps <= segments; steps++) {
        const a = cum[i]!
        const b = cum[i + 1]!
        if (base + a > to) break
        const j = (i + 1) % n
        const ax = xs[i]!, ay = ys[i]!, az = zs[i]!
        const dx = xs[j]! - ax, dy = ys[j]! - ay, dz = zs[j]! - az
        if (railed[i]) {
            const len2 = dx * dx + dy * dy + dz * dz || 1
            const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2))
            const off = Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t)
            if (!rail || off < rail.off) rail = { s: base + a + (b - a) * t, off, below: 0 }
        } else {
            const len2 = dx * dx + dz * dz || 1
            const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2))
            const off = Math.hypot(x - ax - dx * t, z - az - dz * t)
            if (!plan || off < plan.off) {
                // A banked road's surface drops toward its low side; allow for it at the widest offset.
                const bank = Math.max(bankSlope(right, i), bankSlope(right, j)) * maxOff
                const floor = ay + dy * t - bank - FALL_DEPTH - BELOW_ROAD_SLACK
                plan = { s: base + a + (b - a) * t, off, below: floor - y }
            }
        }
        if (++i >= segments) {
            if (!track.closed) break
            i = 0
            base += track.length
        }
    }
    return rail && rail.off <= maxOff ? rail : plan ?? rail
}

/** Rise of the road's surface per metre across the plan at point `i`. */
function bankSlope(right: Float64Array, i: number) {
    const k = i * 3
    return Math.abs(right[k + 1]!) / Math.max(0.1, Math.hypot(right[k]!, right[k + 2]!))
}

/** True when every pose is on the road and no further along it than the car could go since the last, from start to finish. */
export function ghostDrivesTrack(track: Track, ghost: Ghost): boolean {
    const count = ghost.data.length / GHOST_POSE
    if (count < 2) return false
    const reach = 2 * SPEED_CEILING / ghost.hz + STEP_SLACK
    const maxOff = track.wallOffset + OFF_ROAD_SLACK
    const finish = track.closed ? track.startS + track.length : track.finishS
    let s = track.startS
    for (let k = 0; k < count; k++) {
        const i = k * GHOST_POSE
        const window = k === 0 ? START_SLACK : reach
        const hit = nearestAlong(track, ghost.data[i]!, ghost.data[i + 1]!, ghost.data[i + 2]!, s - window, s + window, maxOff)
        if (!hit || hit.off > maxOff || hit.below > 0) return false
        s = hit.s
    }
    return Math.abs(s - finish) <= FINISH_SLACK
}
