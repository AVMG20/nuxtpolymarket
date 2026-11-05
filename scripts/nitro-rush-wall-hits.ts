/**
 * What hitting a wall in Nitro Rush does to the car, by the angle and speed it comes in at: the speed it keeps, how far
 * it's thrown off the wall, how far the nose swings with the wheel straight, and the time it costs a driver who steers back.
 *
 *   bun --tsconfig-override .nuxt/tsconfig.app.json scripts/nitro-rush-wall-hits.ts
 */
import { PHYSICS_HZ } from '../app/utils/nitro-rush/config'
import { createCar, stepCar, wallLimit, type CarInput, type CarState } from '../app/utils/nitro-rush/physics'
import { buildTrack, finish, start, straight } from '../shared/utils/nitro-rush/layout'
import { headingOf, Track, wrapAngle } from '../shared/utils/nitro-rush/track'
import { ROAD } from '../shared/utils/nitro-rush/tracks'

const DT = 1 / PHYSICS_HZ
const ANGLES = [10, 20, 30, 45, 60, 75, 90]
const SPEEDS = [5, 15, 30, 60, 86]
/** Road past the hit that a recovering car has to cover. */
const RUN_ON = 200
const GIVE_UP = 60
const START_S = 200

const track = new Track(buildTrack({ id: 'wall-hits', name: 'Wall hits', group: 'sprints', ...ROAD, closed: false, origin: { x: 0, z: 0, heading: 0 }, pieces: [straight(100), start, straight(2000), finish, straight(200)] }))
const clamp = (v: number) => Math.max(-1, Math.min(1, v))
const degrees = (a: number) => a * 180 / Math.PI
const roadHeading = (car: CarState) => headingOf(car.proj.tx, car.proj.tz)
/** Gas on, wheel straight. */
const handsOff = (): CarInput => ({ throttle: 1, brake: 0, steer: 0, drift: false })
/** Gas on, wheel turning the nose back up the road, and off the wall. */
const steerBack = (car: CarState): CarInput => ({ throttle: 1, brake: 0, steer: clamp(-wrapAngle(roadHeading(car) + Math.min(0.25, Math.max(-0.25, car.proj.lateral / 20)) - car.heading) * 4), drift: false })

/** A car a moment from the right-hand wall, `angle` degrees off the road and doing `speed`. */
function approach(angle: number, speed: number) {
    const lateral = Math.max(0, wallLimit(track, createCar(track, START_S)) - 1 - speed * 0.05 * Math.sin(angle * Math.PI / 180))
    const car = createCar(track, START_S, lateral)
    car.heading = car.travel = wrapAngle(car.heading - angle * Math.PI / 180)
    car.speed = speed
    return car
}

/** Rolls the car, off the gas, into the wall. */
function toHit(car: CarState) {
    for (let i = 0; i < PHYSICS_HZ * 2; i++) {
        if (stepCar(car, { ...handsOff(), throttle: 0 }, track, DT).wallImpact > 0) return
    }
    throw new Error('never reached the wall')
}

function hit(angle: number, speed: number) {
    const car = approach(angle, speed)
    toHit(car)
    const kept = car.speed
    const nose = car.heading
    const wall = car.proj.lateral
    let swing = 0
    let thrown = 0
    for (let i = 0; i < PHYSICS_HZ * 1.5; i++) {
        stepCar(car, handsOff(), track, DT)
        swing = Math.max(swing, Math.abs(wrapAngle(car.heading - nose)))
        thrown = Math.max(thrown, wall - car.proj.lateral)
    }
    return { kept, swing: degrees(swing), thrown }
}

/** Seconds to `RUN_ON` metres past the hit, against the same car with the road clear, driving back under `steerBack`. */
function timeLost(angle: number, speed: number) {
    const car = approach(angle, speed)
    toHit(car)
    const goal = car.proj.s + RUN_ON
    const clean = createCar(track, car.proj.s)
    clean.speed = speed
    let cleanTime = 0
    while (clean.proj.s < goal) {
        stepCar(clean, handsOff(), track, DT)
        cleanTime += DT
    }
    let time = 0
    while (car.proj.s < goal && time < GIVE_UP) {
        stepCar(car, steerBack(car), track, DT)
        time += DT
    }
    return time >= GIVE_UP ? null : time - cleanTime
}

console.log('angle  speed |   kept  of speed | thrown | nose swing | time lost')
for (const angle of ANGLES) {
    for (const speed of SPEEDS) {
        const { kept, swing, thrown } = hit(angle, speed)
        const lost = timeLost(angle, speed)
        console.log(`${String(angle).padStart(4)}° ${String(speed).padStart(5)}  | ${kept.toFixed(1).padStart(6)} ${(`${Math.round(kept / speed * 100)}%`).padStart(9)} | ${thrown.toFixed(1).padStart(4)} m | ${Math.round(swing).toString().padStart(9)}° | ${lost === null ? '  stuck' : `${lost.toFixed(2)} s`}`)
    }
}
