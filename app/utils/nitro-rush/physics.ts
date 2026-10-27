import {
    AERO_DRAG, BRAKE_DECEL, CAR_HALF_WIDTH, DRIFT_ALIGN, DRIFT_EXIT_SLIP, DRIFT_LATERAL, DRIFT_MIN_SPEED, DRIFT_MIN_TIME, DRIFT_SCRUB,
    DRIFT_SLIP_COUNTER, DRIFT_SLIP_IN, DRIFT_SLIP_RECOVER, DRIFT_SLIP_RESPONSE, ENGINE_ACCEL, ENGINE_TOP_SPEED, GRIP_ALIGN, GRIP_LATERAL,
    HANDBRAKE_DECEL, MAX_STEER_ANGLE, NITRO_ACCEL, NITRO_DURATION, NITRO_PER_DRIFT_SECOND, NITRO_TOP_SPEED_MULT, REVERSE_ACCEL, REVERSE_MAX,
    ROLLING_DRAG, STEER_FALLOFF_SPEED, STEER_RATE, STEER_RETURN_RATE, WALL_FRICTION, WALL_HARD_IMPACT, WALL_RESTITUTION, WHEELBASE
} from './config'
import { wrapAngle, type Projection, type Track } from './track'

/**
 * The car, as a point with a heading. Pure and deterministic: the engine
 * steps it at a fixed rate, and the tests and the menu's demo lap drive it
 * the same way.
 *
 * Angles grow turning left. Heading `h` faces (-sin h, -cos h), which is
 * where the car model's nose points at rotation.y = h. `travel` is the
 * direction the car is actually moving; the gap between them is the slip.
 */
export interface CarState {
    x: number
    z: number
    heading: number
    travel: number
    /** Along `travel`; negative while reversing. */
    speed: number
    /** Smoothed wheel, -1 full left to 1 full right. */
    steer: number
    drifting: boolean
    /** 1 for a drift to the left (nose left of travel), -1 to the right. */
    driftDir: number
    driftTime: number
    nitro: number
    nitroTime: number
    /** Last projection onto the track; `seg` is the search hint for the next. */
    proj: Projection
}

export interface CarInput {
    throttle: number
    brake: number
    /** -1 full left to 1 full right. */
    steer: number
    handbrake: boolean
}

export interface StepEvents {
    /** Speed into the wall on a hit this step, else 0. */
    wallImpact: number
    driftStarted: boolean
    /** Seconds the drift lasted, on the step it ended; 0 otherwise. */
    driftEnded: number
    /** Nitro banked by the drift that just ended. */
    nitroEarned: number
}

/** Half the car's length, for how far a sideways car reaches toward the wall. */
const CAR_HALF_LENGTH = 2.25
/** Wheel the brake needs to be paired with to throw the car into a drift. */
const DRIFT_STEER_THRESHOLD = 0.35
/** Wheel into the drift below which the player counts as letting go of it. */
const DRIFT_LET_GO = 0.1

const moveTowards = (v: number, target: number, maxDelta: number) =>
    Math.abs(target - v) <= maxDelta ? target : v + Math.sign(target - v) * maxDelta

export function createCar(track: Track, s: number, lateral = 0): CarState {
    const p = track.pointAt(s)
    const heading = Math.atan2(-p.tx, -p.tz)
    const x = p.x - p.tz * lateral
    const z = p.z + p.tx * lateral
    const car: CarState = {
        x, z, heading, travel: heading, speed: 0, steer: 0,
        drifting: false, driftDir: 1, driftTime: 0, nitro: 0, nitroTime: 0,
        proj: { seg: 0, s: 0, lateral: 0, tx: 0, tz: 1 }
    }
    track.project(x, z, -1, car.proj)
    return car
}

export function slipAngle(car: CarState) {
    return wrapAngle(car.heading - car.travel)
}

/** The widest the car can sit off the centreline before its corner touches the wall; angled bodies reach further. */
export function wallLimit(track: Track, car: CarState) {
    // The body's angle to the track, not the slip: a bounce turns the travel but not the car.
    const angle = wrapAngle(car.heading - Math.atan2(-car.proj.tx, -car.proj.tz))
    const reach = CAR_HALF_WIDTH * Math.abs(Math.cos(angle)) + CAR_HALF_LENGTH * Math.abs(Math.sin(angle))
    return track.wallOffset - reach
}

export function fireNitro(car: CarState) {
    if (car.nitro < 1 || car.nitroTime > 0) return false
    car.nitro = 0
    car.nitroTime = NITRO_DURATION
    return true
}

export function stepCar(car: CarState, input: CarInput, track: Track, dt: number): StepEvents {
    const ev: StepEvents = { wallImpact: 0, driftStarted: false, driftEnded: 0, nitroEarned: 0 }

    // The wheel eases toward the input, and back to centre a little quicker.
    const want = Math.max(-1, Math.min(1, input.steer))
    const returning = want === 0 || Math.sign(want) !== Math.sign(car.steer)
    car.steer = moveTowards(car.steer, want, (returning ? STEER_RETURN_RATE : STEER_RATE) * dt)
    const left = -car.steer

    // ── Speed along the direction of travel ──
    const v = car.speed
    const nitro = car.nitroTime > 0
    if (nitro) car.nitroTime = Math.max(0, car.nitroTime - dt)
    const top = ENGINE_TOP_SPEED * (nitro ? NITRO_TOP_SPEED_MULT : 1)
    const pull = Math.max(0, 1 - v / top)
    let drive = 0
    if (input.throttle > 0 && v >= -0.5) drive += ENGINE_ACCEL * input.throttle * pull
    if (nitro) drive += NITRO_ACCEL * pull
    if (input.brake > 0 && v <= 0.5 && v > -REVERSE_MAX) drive -= REVERSE_ACCEL * input.brake
    let resist = ROLLING_DRAG + AERO_DRAG * v * v
    if (input.brake > 0 && v > 0.5) resist += BRAKE_DECEL * input.brake
    if (input.throttle > 0 && v < -0.5) resist += BRAKE_DECEL * input.throttle
    if (input.handbrake) resist += HANDBRAKE_DECEL
    if (car.drifting) resist += DRIFT_SCRUB * Math.abs(Math.sin(slipAngle(car)))
    car.speed = moveTowards(v + drive * dt, 0, resist * dt)

    // ── Drift entry: a stab of brake or handbrake with the wheel turned, at speed ──
    if (!car.drifting && car.speed > DRIFT_MIN_SPEED && Math.abs(left) > DRIFT_STEER_THRESHOLD && (input.handbrake || input.brake > 0)) {
        car.drifting = true
        car.driftDir = Math.sign(left)
        car.driftTime = 0
        ev.driftStarted = true
    }

    if (car.drifting) {
        const d = car.driftDir
        const into = left * d
        let target = into >= 0 ? DRIFT_SLIP_IN * into : DRIFT_SLIP_COUNTER * -into
        if (input.handbrake) target += 0.12
        let slip = slipAngle(car)
        // The path bends toward the nose, as hard as the sliding tyres allow.
        const turn = Math.sign(slip) * Math.min(Math.abs(slip) * DRIFT_ALIGN, DRIFT_LATERAL / Math.max(car.speed, 1))
        car.travel = wrapAngle(car.travel + turn * dt)
        // Only a centred or countered wheel straightens up quickly and ends the drift, so tapping the key into it holds a shallow slide.
        const letGo = into < DRIFT_LET_GO
        slip += (target * d - slip) * (1 - Math.exp(-(letGo ? DRIFT_SLIP_RECOVER : DRIFT_SLIP_RESPONSE) * dt))
        car.heading = wrapAngle(car.travel + slip)
        car.driftTime += dt
        const settled = car.driftTime > DRIFT_MIN_TIME && letGo && (Math.abs(slip) < DRIFT_EXIT_SLIP || Math.sign(slip) !== d)
        if (settled || car.speed < DRIFT_MIN_SPEED * 0.6) endDrift(car, ev, true)
    } else {
        const angle = MAX_STEER_ANGLE / (1 + Math.abs(car.speed) / STEER_FALLOFF_SPEED) * left
        const cap = GRIP_LATERAL / Math.max(Math.abs(car.speed), 1)
        // Past the tyres' limit the path can't bend any tighter: the car washes wide.
        const turn = Math.max(-cap, Math.min(cap, car.speed * Math.tan(angle) / WHEELBASE))
        car.travel = wrapAngle(car.travel + turn * dt)
        const slip = slipAngle(car) * Math.exp(-GRIP_ALIGN * dt)
        car.heading = wrapAngle(car.travel + slip)
    }

    car.x += car.speed * -Math.sin(car.travel) * dt
    car.z += car.speed * -Math.cos(car.travel) * dt

    // ── Walls ──
    const p = track.project(car.x, car.z, car.proj.seg, car.proj)
    const limit = wallLimit(track, car)
    if (Math.abs(p.lateral) > limit) {
        const side = Math.sign(p.lateral)
        // Inward normal: away from the wall, toward the centreline.
        const nx = p.tz * side
        const nz = -p.tx * side
        const push = Math.abs(p.lateral) - limit
        car.x += nx * push
        car.z += nz * push
        p.lateral = side * limit
        let vx = car.speed * -Math.sin(car.travel)
        let vz = car.speed * -Math.cos(car.travel)
        const vn = vx * nx + vz * nz
        if (vn < 0) {
            const impact = -vn
            ev.wallImpact = impact
            vx -= (1 + WALL_RESTITUTION) * vn * nx
            vz -= (1 + WALL_RESTITUTION) * vn * nz
            const along = vx * p.tx + vz * p.tz
            const across = vx * nx + vz * nz
            const kept = Math.max(0, 1 - WALL_FRICTION * impact / Math.max(Math.abs(along), 1))
            vx = p.tx * along * kept + nx * across
            vz = p.tz * along * kept + nz * across
            // A car hitting sideways keeps rolling the way it was going; grip then swings the nose round.
            const speed = Math.hypot(vx, vz)
            const forward = car.speed >= 0
            car.speed = forward ? speed : -speed
            if (speed > 0.01) car.travel = forward ? Math.atan2(-vx, -vz) : Math.atan2(vx, vz)
            if (car.drifting && impact > WALL_HARD_IMPACT) endDrift(car, ev, false)
        }
    }
    return ev
}

function endDrift(car: CarState, ev: StepEvents, clean: boolean) {
    car.drifting = false
    ev.driftEnded = car.driftTime
    if (clean) {
        const earned = Math.min(1 - car.nitro, car.driftTime * NITRO_PER_DRIFT_SECOND)
        car.nitro += earned
        ev.nitroEarned = earned
    }
    car.driftTime = 0
}

/**
 * A tidy grip driver for the menu's demo laps and the tests: it chases a
 * point down the centreline and brakes for the tightest bend ahead.
 */
export function botInput(car: CarState, track: Track, pace = 1): CarInput {
    const v = Math.max(0, car.speed)
    const ahead = track.pointAt(car.proj.s + 8 + v * 0.45)
    const want = Math.atan2(-(ahead.x - car.x), -(ahead.z - car.z))
    const err = wrapAngle(want - car.travel)
    const steer = Math.max(-1, Math.min(1, -err * 4))
    // The fastest the car may be going now so it can still slow for every bend in braking range.
    let allowed = Infinity
    const look = 20 + v * v / (BRAKE_DECEL * 1.4)
    for (let d = 0; d <= look; d += 4) {
        const k = track.curvature[track.segmentAt(car.proj.s + d)]!
        if (k < 1e-4) continue
        const corner = Math.sqrt(GRIP_LATERAL * 0.9 / k) * pace
        allowed = Math.min(allowed, Math.sqrt(corner * corner + 2 * BRAKE_DECEL * 0.7 * d))
    }
    allowed = Math.min(allowed, ENGINE_TOP_SPEED * pace)
    // It only lifts mid-bend: braking with the wheel turned would throw it into a drift.
    const braking = v > allowed + 2 && Math.abs(steer) < DRIFT_STEER_THRESHOLD
    return {
        throttle: v < allowed ? 1 : 0,
        brake: braking ? 1 : 0,
        steer,
        handbrake: false
    }
}
