import type { CarState } from './physics'
import { headingOf } from '#shared/utils/nitro-rush/track'

/** Off while every line counts either way; the timing still works, so turning it on brings the warning back. */
export const WRONG_WAY_WARNING = false
/** Seconds of driving against the road before the warning shows. */
export const WRONG_WAY_DELAY = 1.2

/** Seconds the car has gone the wrong way, `held` before this `dt` step; a field is free roam, so it never counts there. */
export function wrongWayTime(car: CarState, held: number, dt: number) {
    if (car.proj.field >= 0) return 0
    const along = Math.cos(car.travel - headingOf(car.proj.tx, car.proj.tz)) * car.speed
    return along < -3 ? held + dt : 0
}
