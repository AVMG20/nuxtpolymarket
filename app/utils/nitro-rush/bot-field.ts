import { BOOST_DURATION, BOOST_KICK, BRAKE_DECEL, ENGINE_TOP_SPEED, GRIP_LATERAL, MAX_STEER_ANGLE, NITRO_ACCEL, PHYSICS_HZ, ROLLING_DRAG, STEER_FALLOFF_SPEED, WHEELBASE } from './config'
import type { CarInput, CarState } from './physics'
import { RUN_OUT, type FieldPath } from '#shared/utils/nitro-rush/field-plan'
import { headingOf, wrapAngle } from '#shared/utils/nitro-rush/track'

/** The bot on a field: it holds its planned racing line, steering for the line's bends ahead, at the speed each bend allows. */

/** Share of the tyres' grip the bot corners on, leaving the rest to hold the line. */
const GRIP_SHARE = 0.97
/** Share of full braking the bot counts on before a bend. */
const BRAKE_SHARE = 0.95
/** How quickly, in radians per second, and how damped the bot closes on its line once off it. */
const HOLD_RATE = 3
const HOLD_DAMPING = 0.8
/** Seconds ahead the bot reads the line's bend, as the wheel takes that long to turn. */
const STEER_LEAD = 0.12
/** Metres off the line, or radians off its way, past which the bot heads back for it rather than holding it. */
const LOST_OFFSET = 5
const LOST_ANGLE = 0.8
/** Below this speed the bot still accelerates at full lock, so it never stalls in a turn. */
const LOCKED_SPEED = 10
/** The least the bot drives at, so a bend sharper than the wheels' lock still gets driven round. */
const CREEP = 5
/** Faster than the car goes even boosted: the limit on a straight. */
const FLAT_OUT = ENGINE_TOP_SPEED * 1.5
/** Metres a pad's surge lasts at a brisk speed, through which it pushes against the brakes. */
const SURGE_REACH = BOOST_DURATION * 60
/** Share of the surge's push a braking car feels, as the push fades with speed. */
const SURGE_PULL = 0.6
/** Metres per second over its speed for a bend before the bot brakes rather than lifts. */
const BRAKE_SLACK = 1
/** Below this speed with the throttle on for PINNED_STEPS, the bot is wedged on a post or wall and reverses off it for BACK_STEPS. */
const PINNED_SPEED = 0.5
// Counted in physics steps, as the bot isn't told how long a step is.
const PINNED_STEPS = PHYSICS_HZ / 2
const BACK_STEPS = PHYSICS_HZ

/** Where each car is along its path, so a path passing near itself doesn't jump it ahead or back. */
const progress = new WeakMap<CarState, { path: FieldPath, seg: number }>()
/** Which of its route's field paths each car is on, or is to take next once off a field, so a field crossed twice is driven in turn. */
const turns = new WeakMap<CarState, { paths: readonly FieldPath[], at: number }>()
/** Each path's top speed at each point at full pace, worked out once. */
const limits = new WeakMap<FieldPath, Float64Array>()
/** Steps each car has sat pinned with the throttle on, and steps left of backing off. */
const wedged = new WeakMap<CarState, { pinned: number, back: number }>()

/** Metres short of a path's ends the car counts as still running in to its field, or as through and out of it. */
const END_REACH = RUN_OUT + 4

/** Forgets where the car was along its field's path, once it's off the field, so the next lap starts the path again; through it, the next path is due. */
export function leaveField(car: CarState) {
    const was = progress.get(car)
    if (!was) return
    progress.delete(car)
    const { cum } = was.path
    const turn = turns.get(car)
    if (turn && turn.paths[turn.at] === was.path && cum[cum.length - 1]! - cum[was.seg]! <= END_REACH) turn.at = (turn.at + 1) % turn.paths.length
}

/** The path the car is on though off its fields: its run-in, where the road can count as the field's already, or the road between two joined fields. */
export function heldPath(car: CarState): FieldPath | undefined {
    const was = progress.get(car)
    if (!was) return undefined
    const { points, cum } = was.path
    if (onSegment(points, was.seg, car.x, car.z).d >= LOST_OFFSET * LOST_OFFSET) return undefined
    if (cum[was.seg]! < END_REACH) return was.path
    return (was.path.fields?.length ?? 1) > 1 && cum[cum.length - 1]! - cum[was.seg]! > RUN_OUT + 2 ? was.path : undefined
}

/** The path for a car on (or heading for, with `peek`) `field`: the next of `paths` across it from the one it's on or due. */
export function fieldPathFor(car: CarState, paths: readonly FieldPath[], field: number, peek = false): FieldPath | undefined {
    const turn = turns.get(car)
    const from = turn?.paths === paths ? turn.at : 0
    for (let k = 0; k < paths.length; k++) {
        const at = (from + k) % paths.length
        if (!(paths[at]!.fields?.includes(field) ?? paths[at]!.field === field)) continue
        if (!peek) turns.set(car, { paths, at })
        return paths[at]
    }
    return undefined
}

/** The fastest the car corners on a bend of curvature `k`: the grip it counts on, and at low speed the front wheels' lock. */
function cornerSpeed(k: number) {
    let lo = 0
    let hi = FLAT_OUT
    if (k < 1e-5) return hi
    for (let i = 0; i < 24; i++) {
        const v = (lo + hi) / 2
        if (Math.min(GRIP_LATERAL * GRIP_SHARE / (v * v), Math.tan(MAX_STEER_ANGLE / (1 + v / STEER_FALLOFF_SPEED)) / WHEELBASE) >= k) lo = v
        else hi = v
    }
    return lo
}

/** Each point's top speed along `path` at full pace: its bend's, and slow enough to brake for every bend after it. */
function speedLimits(path: FieldPath) {
    let out = limits.get(path)
    if (out) return out
    const { points, curvature, cum, pads } = path
    const n = points.length
    out = new Float64Array(n)
    const surging = new Uint8Array(n)
    let padAt = -Infinity
    for (let i = 0; i < n; i++) {
        if (pads[i]) padAt = cum[i]!
        surging[i] = cum[i]! - padAt <= SURGE_REACH ? 1 : 0
    }
    for (let i = n - 1; i >= 0; i--) {
        // The sharper of its own bend and its neighbours', as a bend is read over a few points.
        const k = Math.max(Math.abs(curvature[i]!), Math.abs(curvature[Math.max(0, i - 1)]!), Math.abs(curvature[Math.min(n - 1, i + 1)]!))
        const brake = BRAKE_DECEL * BRAKE_SHARE + ROLLING_DRAG - (surging[i] ? NITRO_ACCEL * SURGE_PULL : 0)
        let ahead = i + 1 < n ? Math.sqrt(out[i + 1]! * out[i + 1]! + 2 * brake * (cum[i + 1]! - cum[i]!)) : FLAT_OUT
        // Onto a pad, slow enough that its kick doesn't take the car past what follows.
        if (i + 1 < n && pads[i + 1] && !pads[i]) ahead = Math.min(ahead, Math.max(BRAKE_SLACK, out[i + 1]! - BOOST_KICK))
        out[i] = Math.max(CREEP, Math.min(cornerSpeed(k), ahead))
    }
    limits.set(path, out)
    return out
}

/** The speed a car may carry onto `path`'s first point at `pace`. */
export const fieldEntrySpeed = (path: FieldPath, pace: number) => speedLimits(path)[0]! * pace

/** Squared distance from (x, z) to segment `i` of `points`, and the share along it of the nearest point. */
function onSegment(points: FieldPath['points'], i: number, x: number, z: number) {
    const [ax, az] = points[i]!
    const [bx, bz] = points[i + 1]!
    const dx = bx - ax
    const dz = bz - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    const ox = ax + dx * t - x
    const oz = az + dz * t - z
    return { t, d: ox * ox + oz * oz }
}

/** The segment of `path` the car is on: on from where it was while that gets nearer, or the nearest of all on first meeting it. */
function locate(car: CarState, path: FieldPath) {
    const { points } = path
    const last = points.length - 2
    const known = progress.get(car)
    let seg = 0
    if (known?.path === path) {
        seg = known.seg
        while (seg < last && onSegment(points, seg + 1, car.x, car.z).d < onSegment(points, seg, car.x, car.z).d) seg++
        while (seg > 0 && onSegment(points, seg - 1, car.x, car.z).d < onSegment(points, seg, car.x, car.z).d - 1e-6) seg--
    } else {
        let best = Infinity
        for (let i = 0; i <= last; i++) {
            const { d } = onSegment(points, i, car.x, car.z)
            if (d < best - 1e-6) {
                best = d
                seg = i
            }
        }
    }
    // Into an arena's second lap, it carries on from the same spot on the first, so the path never runs out.
    if (path.cycle && seg >= path.cycle.from + path.cycle.length) seg -= path.cycle.length
    progress.set(car, { path, seg })
    return { seg, t: onSegment(points, seg, car.x, car.z).t }
}

/** Point index and share `ahead` metres on along the path from (seg, t). */
function along(path: FieldPath, seg: number, t: number, ahead: number) {
    const { cum } = path
    const n = cum.length
    const at = cum[seg]! + (cum[seg + 1]! - cum[seg]!) * t + ahead
    let i = seg
    while (i < n - 2 && cum[i + 1]! < at) i++
    const span = cum[i + 1]! - cum[i]!
    return { i, t: span > 0 ? Math.max(0, Math.min(1, (at - cum[i]!) / span)) : 0 }
}

/** The bot's controls on a field along `path`; pinned against a post or wall, it backs off with the wheel the other way, as in a three-point turn. */
export function fieldBotInput(car: CarState, path: FieldPath, pace: number): CarInput {
    const input = followLine(car, path, pace)
    let stuck = wedged.get(car)
    if (!stuck) wedged.set(car, stuck = { pinned: 0, back: 0 })
    if (stuck.back > 0) {
        stuck.back--
        return { throttle: 0, brake: 1, steer: -input.steer, drift: false }
    }
    stuck.pinned = input.throttle > 0 && Math.abs(car.speed) < PINNED_SPEED ? stuck.pinned + 1 : 0
    if (stuck.pinned >= PINNED_STEPS) {
        stuck.pinned = 0
        stuck.back = BACK_STEPS
    }
    return input
}

/** The controls that hold the car on `path`, or bring it back when it's lost. */
function followLine(car: CarState, path: FieldPath, pace: number): CarInput {
    const { points, curvature } = path
    const { seg, t } = locate(car, path)
    const v = Math.max(0, car.speed)
    const [ax, az] = points[seg]!
    const [bx, bz] = points[seg + 1]!
    const way = headingOf(bx - ax, bz - az)
    // How far the line lies to the car's left, and how far its way turns left of the car's.
    const fx = ax + (bx - ax) * t - car.x
    const fz = az + (bz - az) * t - car.z
    const off = fx * -Math.cos(way) + fz * Math.sin(way)
    const angle = wrapAngle(way - car.travel)
    const top = speedLimits(path)
    const ahead = along(path, seg, t, v * 0.05)
    const allowed = (top[ahead.i]! + (top[ahead.i + 1]! - top[ahead.i]!) * ahead.t) * pace
    if (Math.abs(off) > LOST_OFFSET || Math.abs(angle) > LOST_ANGLE) return findLine(car, path, seg, t, Math.min(allowed, 15 * pace))
    const lead = along(path, seg, t, v * STEER_LEAD)
    const bend = curvature[lead.i]! + (curvature[lead.i + 1]! - curvature[lead.i]!) * lead.t
    const rate = Math.max(v, 6)
    const want = bend + 2 * HOLD_DAMPING * HOLD_RATE / rate * angle + HOLD_RATE * HOLD_RATE / (rate * rate) * off
    const lock = MAX_STEER_ANGLE / (1 + v / STEER_FALLOFF_SPEED)
    const steer = Math.max(-1, Math.min(1, -Math.atan(want * WHEELBASE) / lock))
    // At full lock it lifts off, or the wheels run wide of a tight turn.
    const locked = Math.abs(steer) === 1 && v > LOCKED_SPEED
    return { throttle: !locked && v < Math.min(allowed, ENGINE_TOP_SPEED * pace) ? 1 : 0, brake: v > allowed + BRAKE_SLACK ? 1 : 0, steer, drift: false }
}

/** Metres on along its line the bot looks, once lost, for a point it can drive straight to and turn onto. */
const FIND_REACH = 80
/** Share of the wheels' lock at CREEP the bot counts on turning onto a point it heads for. */
const FIND_LOCK = 0.8

/** The curvature of the turn from the car's way onto (x, z); a point behind takes a turn round first. */
function turnOnto(car: CarState, x: number, z: number) {
    const d = Math.sqrt((x - car.x) * (x - car.x) + (z - car.z) * (z - car.z))
    const err = wrapAngle(headingOf(x - car.x, z - car.z) - car.travel)
    return Math.abs(err) > Math.PI / 2 ? 2 / Math.max(d, 1e-6) : 2 * Math.abs(Math.sin(err)) / Math.max(d, 1e-6)
}

/** Well off its line it heads for a point on it ahead, slow enough to turn onto it, never cutting across a block or pillar to get there. */
function findLine(car: CarState, path: FieldPath, seg: number, t: number, allowed: number): CarInput {
    const v = Math.max(0, car.speed)
    const pointAt = (reach: number) => {
        const { i, t: s } = along(path, seg, t, reach)
        const [ax, az] = path.points[i]!
        const [bx, bz] = path.points[i + 1]!
        return [ax + (bx - ax) * s, az + (bz - az) * s] as const
    }
    const near = 8 + v * 0.25
    const lock = Math.tan(MAX_STEER_ANGLE / (1 + CREEP / STEER_FALLOFF_SPEED)) / WHEELBASE * FIND_LOCK
    // The nearest point ahead in plain sight that's no tighter a turn than the wheels make: one inside the turning circle is orbited forever.
    let aim: readonly [number, number] | null = null
    let seen: readonly [number, number] | null = null
    for (let reach = near; reach <= FIND_REACH && !aim; reach += 4) {
        const [x, z] = pointAt(reach)
        if (!path.open(car.x, car.z, x, z)) continue
        seen ??= [x, z]
        if (turnOnto(car, x, z) <= lock) aim = [x, z]
    }
    if (!aim) {
        aim = seen
        for (let reach = near; !aim; reach /= 2) {
            const [x, z] = pointAt(reach)
            if (reach <= 3 || path.open(car.x, car.z, x, z)) aim = [x, z]
        }
    }
    const [x, z] = aim
    const err = wrapAngle(headingOf(x - car.x, z - car.z) - car.travel)
    const steer = Math.max(-1, Math.min(1, -err * 4))
    const limit = Math.min(allowed, Math.max(CREEP, cornerSpeed(turnOnto(car, x, z))))
    const locked = Math.abs(steer) === 1 && v > LOCKED_SPEED
    return { throttle: !locked && v < limit ? 1 : 0, brake: v > limit + BRAKE_SLACK ? 1 : 0, steer, drift: false }
}
