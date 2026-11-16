import {
    CAR_HALF_LENGTH, CAR_HALF_WIDTH, NITRO_PER_DRIFT_SECOND, WALL_FRICTION, WALL_HARD_IMPACT, WALL_KEEP_MIN, WALL_PIVOT_SPEED, WALL_PRESS_HOLD, WALL_RESTITUTION, WALL_TOUCH_KEEP
} from './config'
import { headingOf, WALL_HEIGHT, type CourseField, type FieldWall, type Track } from '#shared/utils/nitro-rush/track'
import type { CarState, StepEvents } from './physics'

/** What the car bumps into besides the road's side walls: end barriers, crash cushions and a field's walls and pillars. */

/** Radius of the crash cushion at a fork's nose or a join's tail. */
const CUSHION_RADIUS = 0.5
const scratchLocal = { u: 0, v: 0 }

export function endDrift(car: CarState, ev: StepEvents, clean: boolean) {
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

/** Pushes the car `push` metres out along the barrier's normal (n points away from it) and bounces it off. */
export function hitBarrier(car: CarState, ev: StepEvents, nx: number, nz: number, push: number) {
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

/** A round post of `radius` at (px, pz), hit like a wall by the car's body; head on, the push goes out the nearest face. */
function hitPost(car: CarState, ev: StepEvents, px: number, pz: number, radius: number) {
    const dx = px - car.x
    const dz = pz - car.z
    const fx = -Math.sin(car.heading)
    const fz = -Math.cos(car.heading)
    // The post in the car's frame: along its nose, and to its right.
    const a = dx * fx + dz * fz
    const b = dx * -fz + dz * fx
    const ca = Math.max(-CAR_HALF_LENGTH, Math.min(CAR_HALF_LENGTH, a))
    const cb = Math.max(-CAR_HALF_WIDTH, Math.min(CAR_HALF_WIDTH, b))
    let na: number
    let nb: number
    let push: number
    if (ca !== a || cb !== b) {
        const d = Math.hypot(a - ca, b - cb)
        if (d >= radius) return
        na = (ca - a) / d
        nb = (cb - b) / d
        push = radius - d
    } else if (CAR_HALF_LENGTH - Math.abs(a) < CAR_HALF_WIDTH - Math.abs(b)) {
        na = a < 0 ? 1 : -1
        nb = 0
        push = CAR_HALF_LENGTH - Math.abs(a) + radius
    } else {
        na = 0
        nb = b < 0 ? 1 : -1
        push = CAR_HALF_WIDTH - Math.abs(b) + radius
    }
    hitBarrier(car, ev, na * fx + nb * -fz, na * fz + nb * fx, push)
}

/** The crash cushions at the noses and tails where branches' walls meet. A car in the air above them clears them. */
export function hitCushions(car: CarState, track: Track, ev: StepEvents) {
    for (const c of track.cushions) {
        const dx = c.x - car.x
        const dz = c.z - car.z
        if (dx * dx + dz * dz > 36 || (car.airborne && car.y > c.y + WALL_HEIGHT)) continue
        hitPost(car, ev, c.x, c.z, CUSHION_RADIUS)
    }
}

/** Pushes the car's deepest corner back out along the face; a corner past the face's end is left to the post there. */
function hitFace(car: CarState, ev: StepEvents, w: FieldWall) {
    const fx = -Math.sin(car.heading)
    const fz = -Math.cos(car.heading)
    const fn = fx * w.nx + fz * w.nz
    const rn = -fz * w.nx + fx * w.nz
    const reach = CAR_HALF_LENGTH * Math.abs(fn) + CAR_HALF_WIDTH * Math.abs(rn)
    const d = (car.x - w.x0) * w.nx + (car.z - w.z0) * w.nz
    // Clear of it, or so far past it that it's another face's business.
    if (d >= reach || d <= -reach) return
    const sa = fn > 0 ? -1 : 1
    const sb = rn > 0 ? -1 : 1
    const cx = car.x + sa * CAR_HALF_LENGTH * fx + sb * CAR_HALF_WIDTH * -fz
    const cz = car.z + sa * CAR_HALF_LENGTH * fz + sb * CAR_HALF_WIDTH * fx
    const t = (cx - w.x0) * w.tx + (cz - w.z0) * w.tz
    if (t < 0 || t > w.length) return
    hitBarrier(car, ev, w.nx, w.nz, reach - d)
}

/** A car on a field against its edge walls, block outlines and pillars, found through the field's grid. */
export function hitFieldWalls(car: CarState, field: CourseField, ev: StepEvents) {
    if (car.airborne && car.y > field.y + WALL_HEIGHT) return
    const { u, v } = field.local(car.x, car.z, scratchLocal)
    const near = field.near(u, v)
    for (const i of near.walls) hitFace(car, ev, field.walls[i]!)
    for (const i of near.posts) {
        const p = field.posts[i]!
        hitPost(car, ev, p.x, p.z, p.radius)
    }
}
