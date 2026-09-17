import { describe, expect, it } from 'vitest'
import { WHEEL_ORDER } from '#shared/utils/roulette/wheel'
import { pocketCenterAngle, wheelRotationFor } from '../../app/utils/roulette/wheel-spin'

describe('pocketCenterAngle', () => {
    it('spaces every pocket centre an equal step apart, starting half a step past the top', () => {
        const step = 360 / WHEEL_ORDER.length
        WHEEL_ORDER.forEach((number, idx) => {
            expect(pocketCenterAngle(number)).toBeCloseTo(idx * step + step / 2)
        })
    })

    it('rejects a number the wheel does not have', () => {
        expect(() => pocketCenterAngle(37)).toThrow()
    })
})

describe('wheelRotationFor', () => {
    // The regression this guards: the wheel used to rotate so the boundary
    // between two pockets — not either pocket's centre — sat under the
    // pointer, which always reads as "the ball is between two numbers."
    it('always brings the winning pocket\'s centre, not its edge, to the pointer', () => {
        for (const number of WHEEL_ORDER) {
            for (const currentRotation of [0, 137, -412, 3600.5]) {
                const rotation = wheelRotationFor(currentRotation, number)
                const restingAngle = ((rotation % 360) + 360) % 360
                const pocketAngle = pocketCenterAngle(number)
                // The pocket's centre must land at angle 0 (the fixed pointer) —
                // i.e. the sum is a whole multiple of 360, not merely %360 of it,
                // which floating point can round just under the next multiple.
                const total = restingAngle + pocketAngle
                expect(total).toBeCloseTo(Math.round(total / 360) * 360)
            }
        }
    })

    it('always spins forward, never snapping backward to the target', () => {
        const rotation = wheelRotationFor(700, 7)
        expect(rotation).toBeGreaterThan(700)
    })
})
