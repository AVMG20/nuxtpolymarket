import {
    AERO_DRAG, BRAKE_DECEL, CAR_HALF_WIDTH, DRIFT_ALIGN, DRIFT_LATERAL, DRIFT_MIN_SPEED, DRIFT_SCRUB, DRIFT_SLIP_IN, DRIFT_SLIP_MID,
    DRIFT_SLIP_RESPONSE, DRIFT_SLIP_WIDE, ENGINE_ACCEL, ENGINE_TOP_SPEED, GRIP_ALIGN, GRIP_LATERAL, MAX_STEER_ANGLE, NITRO_ACCEL, NITRO_DURATION,
    NITRO_PER_DRIFT_SECOND, NITRO_TOP_SPEED_MULT, REVERSE_ACCEL, REVERSE_MAX, ROLLING_DRAG, STEER_FALLOFF_SPEED, STEER_RATE, STEER_RETURN_RATE,
    WALL_FRICTION, WALL_HARD_IMPACT, WALL_RESTITUTION, WHEELBASE
} from './config'
import { headingOf, newProjection, wrapAngle, type Projection, type Track } from '#shared/utils/nitro-rush/track'

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
    /** Set when a drift ends with the button still held: it must be let go before the next one. */
    driftSpent: boolean
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
    /** The drift button: held with the wheel turned it starts a drift, and the drift lasts until it is let go. */
    drift: boolean
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
/** Wheel the drift button needs to be paired with to throw the car into a drift. */
const DRIFT_STEER_THRESHOLD = 0.35
const GRAVITY = 9.81

const moveTowards = (v: number, target: number, maxDelta: number) =>
    Math.abs(target - v) <= maxDelta ? target : v + Math.sign(target - v) * maxDelta

export function createCar(track: Track, s: number, lateral = 0): CarState {
    const p = track.pointAt(s)
    const heading = headingOf(p.tx, p.tz)
    const x = p.x - p.tz * lateral
    const z = p.z + p.tx * lateral
    const car: CarState = {
        x, z, heading, travel: heading, speed: 0, steer: 0,
        drifting: false, driftDir: 1, driftTime: 0, driftSpent: false, nitro: 0, nitroTime: 0,
        proj: newProjection()
    }
    // Searched from the known segment, so a spot under another level of a spiral lands on the right one.
    track.project(x, z, track.segmentAt(s), car.proj)
    return car
}

export function slipAngle(car: CarState) {
    return wrapAngle(car.heading - car.travel)
}

/** The body's angle to the track, not the slip: a bounce turns the travel but not the car. */
function bodyAngle(car: CarState) {
    return wrapAngle(car.heading - headingOf(car.proj.tx, car.proj.tz))
}

/** The widest the car can sit off the centreline before its corner touches the wall; angled bodies reach further. */
export function wallLimit(track: Track, car: CarState) {
    const angle = bodyAngle(car)
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
    // The brakes are off mid-drift, because the touch pedal is the drift button too.
    const brake = car.drifting ? 0 : input.brake
    if (brake > 0 && v <= 0.5 && v > -REVERSE_MAX) drive -= REVERSE_ACCEL * brake
    let resist = ROLLING_DRAG + AERO_DRAG * v * v
    if (brake > 0 && v > 0.5) resist += BRAKE_DECEL * brake
    if (input.throttle > 0 && v < -0.5) resist += BRAKE_DECEL * input.throttle
    if (car.drifting) resist += DRIFT_SCRUB * Math.abs(Math.sin(slipAngle(car)))
    drive -= GRAVITY * slopeAlong(car)
    car.speed = moveTowards(v + drive * dt, 0, resist * dt)

    // ── Drift entry: the drift button held with the wheel turned, at speed ──
    if (!car.drifting && !car.driftSpent && input.drift && car.speed > DRIFT_MIN_SPEED && Math.abs(left) > DRIFT_STEER_THRESHOLD) {
        car.drifting = true
        car.driftDir = Math.sign(left)
        car.driftTime = 0
        ev.driftStarted = true
    }

    if (car.drifting) {
        const d = car.driftDir
        const into = left * d
        // The wheel sets the line: into the drift tightens it, away widens it, and neither ends it.
        const target = DRIFT_SLIP_MID + into * (into >= 0 ? DRIFT_SLIP_IN - DRIFT_SLIP_MID : DRIFT_SLIP_MID - DRIFT_SLIP_WIDE)
        let slip = slipAngle(car)
        // The path bends toward the nose, as hard as the sliding tyres allow.
        const turn = Math.sign(slip) * Math.min(Math.abs(slip) * DRIFT_ALIGN, DRIFT_LATERAL / Math.max(car.speed, 1))
        car.travel = wrapAngle(car.travel + turn * dt)
        slip += (target * d - slip) * (1 - Math.exp(-DRIFT_SLIP_RESPONSE * dt))
        car.heading = wrapAngle(car.travel + slip)
        car.driftTime += dt
        if (!input.drift || car.speed < DRIFT_MIN_SPEED * 0.6) endDrift(car, ev, true)
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
    const p = track.project(car.x, car.z, car.proj.seg, car.proj, car.proj.y)
    const limit = wallLimit(track, car)
    if (Math.abs(p.lateral) > limit) {
        const side = Math.sign(p.lateral)
        // Inward normal: away from the wall, toward the centreline.
        hitBarrier(car, ev, p.tz * side, -p.tx * side, Math.abs(p.lateral) - limit)
        p.lateral = side * limit
    }
    // ── End barriers across an open course ──
    if (!track.closed) {
        const reach = endReach(car)
        if (p.s < reach) {
            hitBarrier(car, ev, p.tx, p.tz, reach - p.s)
            p.s = reach
        } else if (p.s > track.length - reach) {
            hitBarrier(car, ev, -p.tx, -p.tz, p.s - (track.length - reach))
            p.s = track.length - reach
        }
    }
    // Cleared last, after any drift this step ended, so a one-step release is enough to drift again.
    if (!input.drift) car.driftSpent = false
    return ev
}

/** Sine of the road's slope along the direction of travel: + climbing. */
function slopeAlong(car: CarState) {
    const g = car.proj.grade
    const along = -Math.sin(car.travel) * car.proj.tx - Math.cos(car.travel) * car.proj.tz
    return g * along / Math.sqrt(1 + g * g)
}

/** How far the body reaches along the track from its centre, for the end barriers. */
function endReach(car: CarState) {
    const angle = bodyAngle(car)
    return CAR_HALF_LENGTH * Math.abs(Math.cos(angle)) + CAR_HALF_WIDTH * Math.abs(Math.sin(angle))
}

/** Pushes the car `push` metres out along the barrier's normal (n points away from it) and bounces it off. */
function hitBarrier(car: CarState, ev: StepEvents, nx: number, nz: number, push: number) {
    car.x += nx * push
    car.z += nz * push
    let vx = car.speed * -Math.sin(car.travel)
    let vz = car.speed * -Math.cos(car.travel)
    const vn = vx * nx + vz * nz
    if (vn >= 0) return
    const impact = -vn
    ev.wallImpact = Math.max(ev.wallImpact, impact)
    vx -= (1 + WALL_RESTITUTION) * vn * nx
    vz -= (1 + WALL_RESTITUTION) * vn * nz
    // Along the barrier's face, which is the normal turned a quarter.
    const tx = -nz
    const tz = nx
    const along = vx * tx + vz * tz
    const across = vx * nx + vz * nz
    const kept = Math.max(0, 1 - WALL_FRICTION * impact / Math.max(Math.abs(along), 1))
    vx = tx * along * kept + nx * across
    vz = tz * along * kept + nz * across
    // A car hitting sideways keeps rolling the way it was going; grip then swings the nose round.
    const speed = Math.hypot(vx, vz)
    const forward = car.speed >= 0
    car.speed = forward ? speed : -speed
    if (speed > 0.01) car.travel = forward ? headingOf(vx, vz) : headingOf(-vx, -vz)
    if (car.drifting && impact > WALL_HARD_IMPACT) endDrift(car, ev, false)
}

function endDrift(car: CarState, ev: StepEvents, clean: boolean) {
    car.drifting = false
    car.driftSpent = true
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
    const want = headingOf(ahead.x - car.x, ahead.z - car.z)
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
    // On an open course it pulls up before the end barrier.
    if (!track.closed) allowed = Math.min(allowed, Math.sqrt(2 * BRAKE_DECEL * 0.7 * Math.max(0, track.length - 12 - car.proj.s)))
    allowed = Math.min(allowed, ENGINE_TOP_SPEED * pace)
    return {
        throttle: v < allowed ? 1 : 0,
        brake: v > allowed + 2 ? 1 : 0,
        steer,
        drift: false
    }
}
