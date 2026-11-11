import {
    AERO_DRAG, BOOST_DURATION, BOOST_KICK, BRAKE_DECEL, CAR_HALF_LENGTH, CAR_HALF_WIDTH, DRIFT_ALIGN, DRIFT_LATERAL, DRIFT_MIN_SPEED, DRIFT_SCRUB, DRIFT_SLIP_IN, DRIFT_SLIP_MID,
    DRIFT_SLIP_RESPONSE, DRIFT_SLIP_WIDE, ENGINE_ACCEL, ENGINE_TOP_SPEED, GRIP_ALIGN, GRIP_LATERAL, MAX_STEER_ANGLE, NITRO_ACCEL, NITRO_DURATION,
    NITRO_PER_DRIFT_SECOND, NITRO_TOP_SPEED_MULT, REVERSE_ACCEL, REVERSE_MAX, ROLLING_DRAG, STEER_FALLOFF_SPEED, STEER_RATE, STEER_RETURN_RATE,
    WALL_FRICTION, WALL_HARD_IMPACT, WALL_KEEP_MIN, WALL_PIVOT_RATE, WALL_PIVOT_SPEED, WALL_PRESS_HOLD, WALL_TOUCH_KEEP, WALL_RESTITUTION, WALL_SCRAPE, WALL_TOUCH_GAP, WHEELBASE
} from './config'
import { FALL_DEPTH, headingOf, newProjection, newTrackFrame, newTrackPoint, WALL_HEIGHT, wallFoot, wrapAngle, type Projection, type Route, type Track, type TrackFrame, type TrackLine } from '#shared/utils/nitro-rush/track'

/**
 * The car, as a point with a heading. Pure and deterministic: the engine
 * steps it at a fixed rate, and the tests and the menu's demo lap drive it
 * the same way.
 *
 * Angles grow turning left. Heading `h` faces (-sin h, -cos h), which is
 * where the car model's nose points at rotation.y = h. `travel` is the
 * direction the car is actually moving; the gap between them is the slip.
 *
 * On a looping or corkscrew the car rides on rails: the road's plan overlaps
 * itself there, so the car moves by distance along the road (`proj.s`) and
 * offset across it (`proj.lateral`), steering by `rel`, its angle to the road.
 * Off a jump's kicker the car flies: `y` and `vy` carry it until it lands, on
 * any road under it, or it falls and `fell` tells the engine to put it back.
 * The walls are low: a car in the air above them clears them.
 *
 * On a forked course `proj.branch` is the line the car is on, and every lookup goes to that line.
 * Where two branches share a deck the wall between them is open; the nose where their walls
 * meet is a crash cushion.
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
    /** The tank, 0 to 1. */
    nitro: number
    /** Burning the tank this step. */
    nitroOn: boolean
    /** Seconds left of the surge from the last boost pad. */
    boostTime: number
    /** Over a pad now, so it kicks only once per pass. */
    onBoostPad: boolean
    /** Last projection onto the track; `seg` is the search hint for the next. */
    proj: Projection
    /** Height of the car's wheels: on the road, except in the air. */
    y: number
    /** Climb rate, metres per second. */
    vy: number
    airborne: boolean
    /** Where along the road (its branch and distance), and how high, the car last left it; a fall puts it back there. */
    leftBranch: number
    leftS: number
    leftY: number
    /** On a looping or corkscrew. */
    onRail: boolean
    /** On rails: the angle from the road's direction to the car's, + to the left. */
    rel: number
    /** Seconds left in which the car still counts as pressed on a side wall it last hit. */
    wallPress: number
}

export interface CarInput {
    throttle: number
    brake: number
    /** -1 full left to 1 full right. */
    steer: number
    /** The drift button: held with the steer turned it starts a drift, and the drift lasts until it is let go. */
    drift: boolean
    /** Held, the tank burns for as long as it has any in it. */
    nitro?: boolean
}

export interface StepEvents {
    /** Speed into the wall on a hit this step, else 0. */
    wallImpact: number
    /** First touched a wall this step, which costs speed however light the touch. */
    wallTouched: boolean
    /** Rubbing along a side wall this step. */
    scraping: boolean
    driftStarted: boolean
    /** Seconds the drift lasted, on the step it ended; 0 otherwise. */
    driftEnded: number
    /** Nitro banked by the drift that just ended. */
    nitroEarned: number
    tookOff: boolean
    /** Falling speed on the step the car touched down, else 0. */
    landed: number
    /** Dropped into a gap: the engine puts the car back on the road. */
    fell: boolean
    /** Drove onto a boost pad this step. */
    boosted: boolean
    /** A nitro burn began this step. */
    nitroStarted: boolean
}

/** Held steer the drift button needs to be paired with to throw the car into a drift. */
const DRIFT_STEER_THRESHOLD = 0.35
const GRAVITY = 9.81
/** Speed kept when a car on rails grazes a wall, per unit of the hit. */
const RAIL_WALL_BOUNCE = 0.3
/** Gentler than WALL_FRICTION on purpose: rails have no bend to cut with a wall, and a stall halfway up a looping rolls the car back down. */
const RAIL_WALL_FRICTION = 0.6
const railFrame = newTrackFrame()
const railEntry = newTrackPoint()
const under = newProjection()
/** Radius of the crash cushion at a fork's nose or a join's tail. */
const CUSHION_RADIUS = 0.5

const moveTowards = (v: number, target: number, maxDelta: number) =>
    Math.abs(target - v) <= maxDelta ? target : v + Math.sign(target - v) * maxDelta

/** The line the car is on. */
const lineOf = (car: CarState, track: Track): TrackLine => track.branches[car.proj.branch] ?? track

export function createCar(track: Track, s: number, lateral = 0, branch = 0): CarState {
    const line = track.branches[branch] ?? track
    const p = line.pointAt(s)
    const heading = headingOf(p.tx, p.tz)
    const x = p.x - p.tz * lateral
    const z = p.z + p.tx * lateral
    const car: CarState = {
        x, z, heading, travel: heading, speed: 0, steer: 0,
        drifting: false, driftDir: 1, driftTime: 0, driftSpent: false, nitro: 0, nitroOn: false, boostTime: 0, onBoostPad: false,
        proj: newProjection(), y: p.y, vy: 0, airborne: false, leftBranch: line.branch, leftS: s, leftY: p.y, onRail: false, rel: 0, wallPress: 0
    }
    // Searched from the known segment, so a spot under another level of a spiral lands on the right one.
    track.locate(x, z, line.branch, line.segmentAt(s), car.proj)
    if (line.railAt(s)) {
        car.onRail = true
        placeOnRail(car, line, s, lateral)
    }
    return car
}

/** Puts a car on rails at distance `s` and offset `lateral`, from the road's own frame. */
function placeOnRail(car: CarState, track: TrackLine, s: number, lateral: number) {
    const f = track.frameAt(s, railFrame)
    const p = car.proj
    p.branch = track.branch
    p.s = track.wrapS(s)
    p.seg = track.segmentAt(p.s)
    p.lateral = lateral
    p.y = f.y
    p.grade = f.ty / Math.max(0.05, Math.hypot(f.tx, f.tz))
    // A looping's plan turns back on itself; the car keeps the bearing it came in on, so nothing reads it as a spin.
    const rail = track.rails.find(([a, b]) => p.s >= a && p.s < b)
    const bearing = track.pointAt(rail ? rail[0] : p.s, railEntry)
    p.tx = bearing.tx
    p.tz = bearing.tz
    car.x = f.x + f.rx * lateral
    car.z = f.z + f.rz * lateral
    car.y = f.y + f.ry * lateral
    car.vy = 0
    car.airborne = false
    car.heading = car.travel = wrapAngle(headingOf(p.tx, p.tz) + car.rel)
}

/** The road's frame under a car on rails; valid until the next physics step. */
export function railFrameOf(car: CarState, track: Track): TrackFrame {
    return lineOf(car, track).frameAt(car.proj.s, railFrame)
}

export function slipAngle(car: CarState) {
    return wrapAngle(car.heading - car.travel)
}

/** The body's angle to the track, not the slip: a bounce turns the travel but not the car. */
function bodyAngle(car: CarState) {
    return wrapAngle(car.heading - headingOf(car.proj.tx, car.proj.tz))
}

/** The widest the car can sit off the centreline, on the side it's on, before its corner touches the wall; angled bodies reach further. */
export function wallLimit(track: Track, car: CarState) {
    const angle = bodyAngle(car)
    const reach = CAR_HALF_WIDTH * Math.abs(Math.cos(angle)) + CAR_HALF_LENGTH * Math.abs(Math.sin(angle))
    return lineOf(car, track).wallOn(car.proj.s, car.proj.lateral < 0 ? -1 : 1) - reach
}

/** Under nitro or a pad's boost: the engine pulls harder, and the car shows it. */
export function surging(car: CarState) {
    return car.nitroOn || car.boostTime > 0
}

/** Burns the tank while the button is held, so any amount of it can go in bursts as short as the player likes. */
function stepNitro(car: CarState, held: boolean, dt: number, ev: StepEvents) {
    const on = held && car.nitro > 0
    ev.nitroStarted = on && !car.nitroOn
    car.nitroOn = on
    if (on) car.nitro = Math.max(0, car.nitro - dt / NITRO_DURATION)
}

export function stepCar(car: CarState, input: CarInput, track: Track, dt: number): StepEvents {
    const ev: StepEvents = { wallImpact: 0, wallTouched: false, scraping: false, driftStarted: false, driftEnded: 0, nitroEarned: 0, tookOff: false, landed: 0, fell: false, boosted: false, nitroStarted: false }
    stepNitro(car, !!input.nitro, dt, ev)

    // The wheel eases toward the input, and back to centre a little quicker.
    const want = Math.max(-1, Math.min(1, input.steer))
    const returning = want === 0 || Math.sign(want) !== Math.sign(car.steer)
    car.steer = moveTowards(car.steer, want, (returning ? STEER_RETURN_RATE : STEER_RATE) * dt)
    const left = -car.steer

    // ── Speed along the direction of travel ──
    const v = car.speed
    const surge = surging(car)
    car.boostTime = Math.max(0, car.boostTime - dt)
    const top = ENGINE_TOP_SPEED * (surge ? NITRO_TOP_SPEED_MULT : 1)
    const pull = Math.max(0, 1 - v / top)
    let drive = 0
    // In the air the wheels have nothing to push on or brake against.
    const grounded = !car.airborne
    if (grounded && input.throttle > 0 && v >= -0.5) drive += ENGINE_ACCEL * input.throttle * pull
    if (surge) drive += NITRO_ACCEL * pull
    // The brakes are off mid-drift, because the touch pedal is the drift button too.
    const brake = car.drifting || !grounded ? 0 : input.brake
    if (brake > 0 && v <= 0.5 && v > -REVERSE_MAX) drive -= REVERSE_ACCEL * brake
    let resist = (grounded ? ROLLING_DRAG : 0) + AERO_DRAG * v * v
    if (brake > 0 && v > 0.5) resist += BRAKE_DECEL * brake
    if (grounded && input.throttle > 0 && v < -0.5) resist += BRAKE_DECEL * input.throttle
    if (car.drifting) resist += DRIFT_SCRUB * Math.abs(Math.sin(slipAngle(car)))
    // On rails gravity pulls along the road itself: a car too slow for a looping rolls back down it.
    if (car.onRail) drive -= GRAVITY * railFrameOf(car, track).ty * Math.cos(car.rel)
    else if (grounded) drive -= GRAVITY * slopeAlong(car)
    car.speed = moveTowards(v + drive * dt, 0, resist * dt)

    if (car.onRail) {
        stepRail(car, left, track, lineOf(car, track), dt, ev)
        if (!input.drift) car.driftSpent = false
        return ev
    }

    // ── Drift entry: the drift button held with the steer turned, at speed ──
    // The held steer picks the way, as the wheel still points the old way just after a quick swap.
    // From centre the wheel must catch up too, so a tap of steer with the touch pedal held still brakes.
    const swapping = car.steer * want < 0
    if (grounded && !car.drifting && !car.driftSpent && input.drift && car.speed > DRIFT_MIN_SPEED && Math.abs(want) > DRIFT_STEER_THRESHOLD && (swapping || Math.abs(car.steer) > DRIFT_STEER_THRESHOLD)) {
        car.drifting = true
        car.driftDir = -Math.sign(want)
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
    } else if (grounded) {
        car.travel = wrapAngle(car.travel + gripTurn(car.speed, left) * dt)
        const slip = slipAngle(car) * Math.exp(-GRIP_ALIGN * dt)
        car.heading = wrapAngle(car.travel + slip)
        // Nosed up to a wall the car can't roll, and the wheel needs it rolling to turn: gas and wheel pivot it off instead.
        // Only while it's on the wall, not through the press's hold, or the nose keeps going once it's free.
        if (car.wallPress === WALL_PRESS_HOLD && input.throttle > 0 && Math.abs(car.speed) < WALL_PIVOT_SPEED) {
            car.heading = wrapAngle(car.heading + left * WALL_PIVOT_RATE * dt)
            car.travel = wrapAngle(car.travel + left * WALL_PIVOT_RATE * dt)
        }
    }

    car.x += car.speed * -Math.sin(car.travel) * dt
    car.z += car.speed * -Math.cos(car.travel) * dt

    // ── Walls ──
    const p = track.locate(car.x, car.z, car.proj.branch, car.proj.seg, car.proj, car.y)
    const line = lineOf(car, track)
    const limit = wallLimit(track, car)
    if (Math.abs(p.lateral) > limit && meetsWall(car, line)) {
        const side = Math.sign(p.lateral)
        // Inward normal: away from the wall, toward the centreline, tipped back where the road narrows so its walls close in on the car.
        const slope = line.wallSlopeAt(p.s)
        const tilt = Math.sqrt(1 + slope * slope)
        hitBarrier(car, ev, (p.tz * side + p.tx * slope) / tilt, (-p.tx * side + p.tz * slope) / tilt, (Math.abs(p.lateral) - limit) / tilt)
        p.lateral = side * limit
    }
    scrapeWall(car, ev, Math.abs(p.lateral), limit, dt)
    // ── End barriers across an open course; a branch's end that meets other road has none ──
    const reach = endReach(car)
    if (line.barrierStart && p.s < reach) {
        hitBarrier(car, ev, p.tx, p.tz, reach - p.s)
        p.s = reach
    } else if (line.barrierEnd && p.s > line.length - reach) {
        hitBarrier(car, ev, -p.tx, -p.tz, p.s - (line.length - reach))
        p.s = line.length - reach
    }
    hitCushions(car, track, ev)
    stepHeight(car, track, dt, ev)
    const now = lineOf(car, track)
    stepBoostPad(car, now, ev)
    // Onto a looping or corkscrew: the rails take over from here.
    if (!car.airborne && now.railAt(p.s)) {
        if (car.drifting) endDrift(car, ev, true)
        car.onRail = true
        car.rel = wrapAngle(car.travel - headingOf(p.tx, p.tz))
        placeOnRail(car, now, p.s, p.lateral)
    }
    // Cleared last, after any drift this step ended, so a one-step release is enough to drift again.
    if (!input.drift) car.driftSpent = false
    return ev
}

/** Whether the car's move can cross a lap line: on the road, or flying over it rather than off to its side. */
export const crossesLines = (car: CarState, track: Track) => !car.airborne || lineOf(car, track).overRoad(car.proj.s, car.proj.lateral)

/**
 * The crash cushions at the noses and tails where branches' walls meet, hit like a wall by the
 * car's body; head on, the push goes out the nearest face. A car in the air above them clears them.
 */
function hitCushions(car: CarState, track: Track, ev: StepEvents) {
    for (const c of track.cushions) {
        const dx = c.x - car.x
        const dz = c.z - car.z
        if (dx * dx + dz * dz > 36 || (car.airborne && car.y > c.y + WALL_HEIGHT)) continue
        const fx = -Math.sin(car.heading)
        const fz = -Math.cos(car.heading)
        // The cushion in the car's frame: along its nose, and to its right.
        const a = dx * fx + dz * fz
        const b = dx * -fz + dz * fx
        const ca = Math.max(-CAR_HALF_LENGTH, Math.min(CAR_HALF_LENGTH, a))
        const cb = Math.max(-CAR_HALF_WIDTH, Math.min(CAR_HALF_WIDTH, b))
        let na: number
        let nb: number
        let push: number
        if (ca !== a || cb !== b) {
            const d = Math.hypot(a - ca, b - cb)
            if (d >= CUSHION_RADIUS) continue
            na = (ca - a) / d
            nb = (cb - b) / d
            push = CUSHION_RADIUS - d
        } else if (CAR_HALF_LENGTH - Math.abs(a) < CAR_HALF_WIDTH - Math.abs(b)) {
            na = a < 0 ? 1 : -1
            nb = 0
            push = CAR_HALF_LENGTH - Math.abs(a) + CUSHION_RADIUS
        } else {
            na = 0
            nb = b < 0 ? 1 : -1
            push = CAR_HALF_WIDTH - Math.abs(b) + CUSHION_RADIUS
        }
        hitBarrier(car, ev, na * fx + nb * -fz, na * fz + nb * fx, push)
    }
}

/** Whether the wall beside the car is in its way: not over a gap, which has none, nor in the air above it or past it. */
function meetsWall(car: CarState, track: TrackLine) {
    const p = car.proj
    if (!car.airborne) return true
    if (track.gapAt(p.s)) return false
    const wall = track.wallAt(p.s)
    return Math.abs(p.lateral) <= wallFoot(wall) && car.y < track.surfaceAt(p.s, Math.sign(p.lateral) * wall) + WALL_HEIGHT
}

/** Only a car driving the right way over a pad gets anything from it. */
function stepBoostPad(car: CarState, track: TrackLine, ev: StepEvents) {
    const p = car.proj
    const on = !car.airborne && car.speed > 0 && Math.cos(wrapAngle(car.travel - headingOf(p.tx, p.tz))) > 0 && track.boostAt(p.s, p.lateral)
    if (on) {
        car.boostTime = BOOST_DURATION
        if (!car.onBoostPad) {
            // Never past nitro's top speed, which the server's lap check trusts as the car's limit; never a loss either.
            car.speed = Math.max(car.speed, Math.min(car.speed + BOOST_KICK, ENGINE_TOP_SPEED * NITRO_TOP_SPEED_MULT))
            ev.boosted = true
        }
    }
    car.onBoostPad = on
}

/** How fast the grip steering turns the car's path, in radians per second, `left` -1 to 1. */
function gripTurn(speed: number, left: number) {
    const angle = MAX_STEER_ANGLE / (1 + Math.abs(speed) / STEER_FALLOFF_SPEED) * left
    const cap = GRIP_LATERAL / Math.max(Math.abs(speed), 1)
    // Past the tyres' limit the path can't bend any tighter: the car washes wide.
    return Math.max(-cap, Math.min(cap, speed * Math.tan(angle) / WHEELBASE))
}

/**
 * The car's height: held to the road, except off the lip of a gap, where it flies until it
 * comes down on road, the road it left or any other under it. Crests never throw it, so the
 * courses from before jumps drive as they always did.
 */
function stepHeight(car: CarState, track: Track, dt: number, ev: StepEvents) {
    const p = car.proj
    if (!car.airborne) {
        if (!lineOf(car, track).gapAt(p.s)) {
            car.vy = (p.y - car.y) / dt
            car.y = p.y
            return
        }
        car.airborne = true
        car.leftBranch = p.branch
        car.leftS = p.s
        car.leftY = car.y
        ev.tookOff = true
        if (car.drifting) endDrift(car, ev, true)
    }
    const before = car.y
    car.vy -= GRAVITY * dt
    car.y += car.vy * dt
    if (track.landing(car.x, before, car.z, under)) {
        // A bank tips the surface under the car away from the centre's height; on the road, y goes back to the centre's, which project picks a level by.
        if (car.y > track.branches[under.branch]!.surfaceAt(under.s, under.lateral)) return
        Object.assign(p, under)
        ev.landed = Math.max(0, -car.vy)
        car.y = p.y
        car.vy = 0
        car.airborne = false
    } else if (car.y < 0 || car.y < car.leftY - FALL_DEPTH) {
        // Down on the ground, or well below where it left with no road to come down on.
        ev.fell = true
    }
}

/** A step on rails: the car moves along and across the road itself, held inside its walls. */
function stepRail(car: CarState, left: number, course: Track, track: TrackLine, dt: number, ev: StepEvents) {
    const p = car.proj
    // Rails charge no touch, but a press from before them still runs out, so it can't excuse a touch long after.
    car.wallPress = Math.max(0, car.wallPress - dt)
    car.rel = wrapAngle(car.rel + gripTurn(car.speed, left) * dt)
    const s = p.s + car.speed * Math.cos(car.rel) * dt
    // + rel turns the nose left, which is toward - lateral.
    let lateral = p.lateral - car.speed * Math.sin(car.rel) * dt
    const reach = CAR_HALF_WIDTH * Math.abs(Math.cos(car.rel)) + CAR_HALF_LENGTH * Math.abs(Math.sin(car.rel))
    const limit = track.wallAt(s) - reach
    if (Math.abs(lateral) > limit) {
        const into = Math.abs(car.speed * Math.sin(car.rel))
        ev.wallImpact = Math.max(ev.wallImpact, into)
        lateral = Math.sign(lateral) * limit
        car.rel = -car.rel * RAIL_WALL_BOUNCE
        car.speed *= Math.max(0, 1 - RAIL_WALL_FRICTION * into / Math.max(Math.abs(car.speed), 1))
    }
    // Off either end of the rails, back onto the plan.
    const leaving = !track.railAt(s) && (track.closed || (s > 0 && s < track.length))
    placeOnRail(car, track, s, lateral)
    if (!leaving) return
    car.onRail = false
    // Rails count lateral along the tilted road and banks on the plan, so a bank exit keeps the number to keep the car where it is.
    const across = Math.hypot(railFrame.rx, railFrame.rz)
    car.x = railFrame.x + railFrame.rx / across * lateral
    car.z = railFrame.z + railFrame.rz / across * lateral
    course.locate(car.x, car.z, track.branch, track.segmentAt(p.s), p, car.y)
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

/** A side wall drags on a car pressed on it for as long as it rubs, however shallow the angle; one merely running alongside is left alone. */
function scrapeWall(car: CarState, ev: StepEvents, offset: number, limit: number, dt: number) {
    if (ev.wallImpact === 0) car.wallPress = Math.max(0, car.wallPress - dt)
    if (car.airborne || car.wallPress === 0 || offset < limit - WALL_TOUCH_GAP) return
    ev.scraping = true
    car.speed *= Math.exp(-WALL_SCRAPE * dt)
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
    // Or-ed, as a corner can hit a side wall and an end barrier in one step.
    ev.wallTouched ||= car.wallPress === 0
    car.wallPress = WALL_PRESS_HOLD
    vx -= (1 + WALL_RESTITUTION) * vn * nx
    vz -= (1 + WALL_RESTITUTION) * vn * nz
    // Along the barrier's face, which is the normal turned a quarter.
    const tx = -nz
    const tz = nx
    const along = vx * tx + vz * tz
    const across = vx * nx + vz * nz
    const kept = Math.max(WALL_KEEP_MIN, 1 - WALL_FRICTION * impact / Math.max(Math.abs(along), 1))
    vx = tx * along * kept + nx * across
    vz = tz * along * kept + nz * across
    const forward = car.speed >= 0
    const noseward = vx * -Math.sin(car.heading) + vz * -Math.cos(car.heading)
    if (forward ? noseward < 0 : noseward > 0) {
        // Thrown back off the end it hit with: it rolls straight back, or grip would swing the nose round to follow.
        car.speed = noseward
        car.travel = car.heading
    } else {
        // Deflected: it keeps rolling the way it was going, and grip turns the nose along the wall.
        const speed = Math.hypot(vx, vz)
        car.speed = forward ? speed : -speed
        // Slow, what's left of the bounce would set the direction and aim the car across the road, so it rolls along the face.
        if (speed < WALL_PIVOT_SPEED && Math.abs(along) > 0.01) {
            vx -= nx * across
            vz -= nz * across
        }
        if (speed > 0.01) car.travel = forward ? headingOf(vx, vz) : headingOf(-vx, -vz)
    }
    if (ev.wallTouched) car.speed *= WALL_TOUCH_KEEP
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

/** A tidy grip driver for the demo laps, the medals and the tests; on a forked course it follows `route`, the main one when left out. */
export function botInput(car: CarState, track: Track, pace = 1, route: Route | null = null): CarInput {
    // On rails it floors it and holds the middle of the road.
    if (car.onRail) return { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, car.rel * 3 - car.proj.lateral * 0.15)), drift: false }
    const v = Math.max(0, car.speed)
    const way = route ?? track.routes[0] ?? null
    const here = track.onRoute(way, car.proj, car.x, car.z)
    const spot = track.ahead(way, here.branch, here.s, 8 + v * 0.25)
    const line = spot.line
    const aheadS = spot.s
    // A looping's plan doubles back, so past a rail's entry it aims straight on along the entry.
    const rail = line.branch === here.branch ? line.rails.find(([a, b]) => aheadS >= a && aheadS < b && here.s < a) : undefined
    const ahead = line.pointAt(rail ? rail[0] : aheadS)
    if (rail) {
        ahead.x += ahead.tx * (aheadS - rail[0])
        ahead.z += ahead.tz * (aheadS - rail[0])
    } else {
        const across = line.racingOffsetAt(aheadS, track.racingOn(way, line.branch))
        ahead.x -= ahead.tz * across
        ahead.z += ahead.tx * across
    }
    const want = headingOf(ahead.x - car.x, ahead.z - car.z)
    const err = wrapAngle(want - car.travel)
    const steer = Math.max(-1, Math.min(1, -err * 4))
    // The fastest the car may be going now so it can still slow for every bend in braking range.
    let allowed = Infinity
    const look = 20 + v * v / (BRAKE_DECEL * 1.4)
    for (let d = 0; d <= look; d += 4) {
        const at = track.ahead(way, here.branch, here.s, d)
        const k = track.racingOn(way, at.line.branch).curvature[at.line.segmentAt(at.s)]!
        if (k < 1e-4) continue
        const corner = Math.sqrt(GRIP_LATERAL * 0.9 / k) * pace
        allowed = Math.min(allowed, Math.sqrt(corner * corner + 2 * BRAKE_DECEL * 0.7 * d))
    }
    // It pulls up before an end barrier.
    const own = lineOf(car, track)
    if (own.barrierEnd) allowed = Math.min(allowed, Math.sqrt(2 * BRAKE_DECEL * 0.7 * Math.max(0, own.length - 12 - car.proj.s)))
    allowed = Math.min(allowed, ENGINE_TOP_SPEED * pace)
    return {
        throttle: v < allowed ? 1 : 0,
        brake: v > allowed + 2 ? 1 : 0,
        steer,
        drift: false
    }
}
