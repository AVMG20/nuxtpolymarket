import type { CarState } from './physics'

/** A circuit fills the meter at the line so every flying lap starts with nitro; a burn already lit runs on, and a sprint has one run. */
export function refillAtLine(car: Pick<CarState, 'nitro'>, closed: boolean) {
    if (!closed) return false
    car.nitro = 1
    return true
}
