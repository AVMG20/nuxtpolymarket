import { describe, expect, it } from 'vitest'
import { NITRO_DURATION } from '../../app/utils/nitro-rush/config'
import { refillAtLine } from '../../app/utils/nitro-rush/lap-refill'
import { createCar, fireNitro } from '../../app/utils/nitro-rush/physics'
import { RECTANGLE, trackOf } from './bot-lap'

const SPRINT = ['straight-20', 'start', 'straight-100', 'right-tight', 'straight-100', 'finish', 'straight-200'] as const

describe('nitro refill at the line', () => {
    it('fills the meter when a loop completes a lap', () => {
        const track = trackOf(true, RECTANGLE)
        const car = createCar(track, track.startS)
        car.nitro = 0.25
        expect(refillAtLine(car, track.closed)).toBe(true)
        expect(car.nitro).toBe(1)
        expect(fireNitro(car)).toBe(true)
    })

    it('leaves a sprint\'s meter alone', () => {
        const track = trackOf(false, [...SPRINT])
        const car = createCar(track, track.startS)
        car.nitro = 0.25
        expect(refillAtLine(car, track.closed)).toBe(false)
        expect(car.nitro).toBe(0.25)
    })

    it('keeps a burning nitro going for its full time', () => {
        const track = trackOf(true, RECTANGLE)
        const car = createCar(track, track.startS)
        car.nitro = 1
        fireNitro(car)
        car.nitroTime = NITRO_DURATION / 2
        refillAtLine(car, track.closed)
        expect(car.nitroTime).toBe(NITRO_DURATION / 2)
        expect(car.nitro).toBe(1)
        // The refilled tank waits for the burn to end.
        expect(fireNitro(car)).toBe(false)
    })
})
