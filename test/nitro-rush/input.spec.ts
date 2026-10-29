import { describe, expect, it } from 'vitest'
import { tyreSlide } from '../../app/utils/nitro-rush/car-fx'
import { carInput } from '../../app/utils/nitro-rush/input'
import { createCar } from '../../app/utils/nitro-rush/physics'
import type { Control } from '../../app/utils/nitro-rush/types'
import { Track } from '#shared/utils/nitro-rush/track'
import { POLYTOWN_OVAL } from '#shared/utils/nitro-rush/tracks'
import { buildTrack } from '#shared/utils/nitro-rush/layout'

const held = (...down: Control[]) => ({ throttle: false, brake: false, left: false, right: false, drift: false, ...Object.fromEntries(down.map(c => [c, true])) })

describe('car input', () => {
    it('keeps the keyboard drift button apart from the brake and gas', () => {
        expect(carInput(held('drift', 'left'), false, false)).toEqual({ throttle: 0, brake: 0, steer: -1, drift: true })
        expect(carInput(held('throttle', 'brake', 'right'), false, true)).toEqual({ throttle: 1, brake: 1, steer: 1, drift: false })
    })

    it('holds the gas on touch, and the pedal lifts it to brake but not through a drift', () => {
        expect(carInput(held(), true, false)).toMatchObject({ throttle: 1, brake: 0 })
        expect(carInput(held('drift'), true, false)).toMatchObject({ throttle: 0, brake: 1, drift: true })
        expect(carInput(held('drift', 'left'), true, true)).toMatchObject({ throttle: 1, brake: 1, drift: true })
        expect(carInput(held('brake'), true, false)).toMatchObject({ throttle: 0, brake: 1 })
    })
})

describe('tyre slide', () => {
    const track = new Track(buildTrack(POLYTOWN_OVAL))

    it('locks the tyres on the brakes, not on a drift button held down the straight', () => {
        const car = createCar(track, 0)
        car.speed = 40
        expect(tyreSlide(car, carInput(held('drift'), false, false), true)).toBe(0)
        expect(tyreSlide(car, carInput(held('brake'), false, false), true)).toBeGreaterThan(0.5)
        expect(tyreSlide(car, carInput(held('drift'), true, false), true)).toBeGreaterThan(0.5)
    })
})
