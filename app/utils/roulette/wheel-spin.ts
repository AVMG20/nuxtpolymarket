import { WHEEL_ORDER } from '#shared/utils/roulette/wheel'

const STEP = 360 / WHEEL_ORDER.length

/**
 * Angle (degrees, clockwise from the top) of a pocket's CENTRE on the
 * unrotated wheel. `buildWheelSvg` draws pocket `i` sweeping clockwise from
 * `i * STEP` to `(i + 1) * STEP`, so its centre sits half a pocket further
 * round — omitting that `STEP / 2` is what used to land the ball on the
 * boundary between two pockets instead of on either one of them.
 */
export function pocketCenterAngle(number: number): number {
    const idx = WHEEL_ORDER.indexOf(number)
    if (idx === -1) throw new Error(`${number} is not a wheel pocket`)
    return idx * STEP + STEP / 2
}

/**
 * Total wheel rotation (CSS `rotate()`, degrees) that brings `number`'s pocket
 * centre to the fixed pointer at the top. Keeps spinning the same direction
 * from wherever the wheel currently sits, plus full extra turns so the
 * animation always spins forward rather than snapping back.
 */
export function wheelRotationFor(currentRotation: number, number: number, extraTurns = 3): number {
    const targetWithinTurn = (((360 - pocketCenterAngle(number)) % 360) + 360) % 360
    const currentWithinTurn = ((currentRotation % 360) + 360) % 360
    let delta = targetWithinTurn - currentWithinTurn
    if (delta <= 0) delta += 360
    return currentRotation + delta + 360 * extraTurns
}
