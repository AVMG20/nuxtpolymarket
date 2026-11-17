import { BRAKE_DECEL, ENGINE_TOP_SPEED, GRIP_LATERAL } from './config'
import type { CarInput, CarState } from './physics'
import type { FieldPath } from '#shared/utils/nitro-rush/field-plan'
import { headingOf, wrapAngle } from '#shared/utils/nitro-rush/track'

/** The bot on a field: it chases a point ahead along its planned path and slows for the path's corners. */

/** Metres a path's corner is rounded over at a full quarter turn, which sets how fast the bot takes it. */
const CORNER_REACH = 10
/** Segments ahead the bot looks for where it is: one, so a car knocked wide still comes back for the gate it missed. */
const SEARCH_AHEAD = 1
/** Below this speed the bot still accelerates at full lock, so it never stalls in a turn. */
const LOCKED_SPEED = 10
/** Share of full braking the bot counts on before a corner, as it turns in while still slowing. */
const BRAKE_SHARE = 0.5

/** Where each car is along its path, so a path passing near itself doesn't jump it ahead or back. */
const progress = new WeakMap<CarState, { path: FieldPath, seg: number }>()

/** Forgets where the car was along its field's path, once it's off the field, so the next lap starts the path again. */
export const leaveField = (car: CarState) => progress.delete(car)

/** The nearest point on segment `i` of `points` to (x, z), as its share of the segment, and how far it is. */
function onSegment(points: FieldPath['points'], i: number, x: number, z: number) {
    const [ax, az] = points[i]!
    const [bx, bz] = points[i + 1]!
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
    return { t, d: Math.hypot(ax + dx * t - x, az + dz * t - z) }
}

/** The bot's controls on a field along `path`. */
export function fieldBotInput(car: CarState, path: FieldPath, pace: number): CarInput {
    const { points } = path
    const known = progress.get(car)
    const from = known?.path === path ? known.seg : 0
    const to = known?.path === path ? Math.min(points.length - 2, from + SEARCH_AHEAD) : points.length - 2
    let seg = from
    let best = Infinity
    let share = 0
    for (let i = from; i <= to; i++) {
        const { t, d } = onSegment(points, i, car.x, car.z)
        if (d < best - 1e-6) {
            best = d
            seg = i
            share = t
        }
    }
    progress.set(car, { path, seg })
    const v = Math.max(0, car.speed)
    // It aims nearer while the straight line to its aim would clip a block or pillar, so it never cuts a corner into one.
    let reach = 8 + v * 0.25
    let [x, z] = alongPath(points, seg, share, reach)
    while (reach > 3 && !path.open(car.x, car.z, x, z)) {
        reach /= 2
        ;[x, z] = alongPath(points, seg, share, reach)
    }
    const err = wrapAngle(headingOf(x - car.x, z - car.z) - car.travel)
    const steer = Math.max(-1, Math.min(1, -err * 4))
    // Facing well off the path a few metres on (mid-hairpin, or a pad threw it wide), it slows enough to turn onto it now.
    const [fx, fz] = alongPath(points, seg, share, CORNER_REACH * 1.5)
    const off = Math.abs(wrapAngle(headingOf(fx - car.x, fz - car.z) - car.travel))
    const allowed = Math.min(pathAllowed(points, seg, share, v, pace), cornerSpeed(off, pace))
    // At full lock it lifts off, or the wheels run wide of a tight turn.
    const locked = Math.abs(steer) === 1 && v > LOCKED_SPEED
    return { throttle: !locked && v < Math.min(allowed, ENGINE_TOP_SPEED * pace) ? 1 : 0, brake: v > allowed + 2 ? 1 : 0, steer, drift: false }
}

/** The fastest a car `v` may go from (seg, share) on `points` and still slow for every corner in braking range. */
export function pathAllowed(points: FieldPath['points'], seg: number, share: number, v: number, pace: number) {
    let allowed = Infinity
    const look = 20 + v * v / (BRAKE_DECEL * 1.4)
    let [px, pz] = lerp(points, seg, share)
    let d = 0
    // Corners closer than three reaches run into one, as a hairpin round a gate.
    let joined = 0
    let from = 0
    for (let k = seg + 1; k < points.length - 1 && d <= look; k++) {
        const [cx, cz] = points[k]!
        const run = Math.hypot(cx - px, cz - pz)
        d += run
        const [nx, nz] = points[k + 1]!
        const turn = Math.abs(wrapAngle(headingOf(nx - cx, nz - cz) - headingOf(cx - px, cz - pz)))
        // A run of corners is taken at the speed of their joined turn from the first of them.
        if (run < CORNER_REACH * 3 && k > seg + 1) joined += turn
        else {
            joined = turn
            from = d
        }
        if (turn > 0.05) allowed = Math.min(allowed, Math.sqrt(cornerSpeed(joined, pace) ** 2 + 2 * BRAKE_DECEL * BRAKE_SHARE * from))
        px = cx
        pz = cz
    }
    return allowed
}

/** How fast the bot takes a turn of `turn` radians rounded over CORNER_REACH. */
function cornerSpeed(turn: number, pace: number) {
    if (turn <= 0.05) return Infinity
    const radius = CORNER_REACH / Math.tan(Math.min(turn, 2.2) / 2)
    return Math.sqrt(GRIP_LATERAL * 0.9 * radius) * pace
}

/** The point `ahead` metres on along `points` from (seg, share). */
function alongPath(points: FieldPath['points'], seg: number, share: number, ahead: number): [number, number] {
    let left = ahead
    let i = seg
    let [x, z] = lerp(points, i, share)
    while (i < points.length - 1) {
        const [bx, bz] = points[i + 1]!
        const d = Math.hypot(bx - x, bz - z)
        if (d >= left) return [x + (bx - x) * left / d, z + (bz - z) * left / d]
        left -= d
        x = bx
        z = bz
        i++
    }
    return [x, z]
}

function lerp(points: FieldPath['points'], i: number, t: number): [number, number] {
    const [ax, az] = points[i]!
    const [bx, bz] = points[Math.min(i + 1, points.length - 1)]!
    return [ax + (bx - ax) * t, az + (bz - az) * t]
}
