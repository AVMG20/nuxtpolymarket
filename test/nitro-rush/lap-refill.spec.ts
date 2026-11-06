import { describe, expect, it } from 'vitest'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { refillAtLine } from '../../app/utils/nitro-rush/lap-refill'
import { createCar, stepCar } from '../../app/utils/nitro-rush/physics'
import { RECTANGLE, trackOf } from './bot-lap'

const SPRINT = ['straight-20', 'start', 'straight-100', 'right-tight', 'straight-100', 'finish', 'straight-200'] as const

describe('nitro refill at the line', () => {
    it('fills the meter when a loop completes a lap', () => {
        const track = trackOf(true, RECTANGLE)
        const car = createCar(track, track.startS)
        car.nitro = 0.25
        expect(refillAtLine(car, track.closed)).toBe(true)
        expect(car.nitro).toBe(1)
    })

    it('leaves a sprint\'s meter alone', () => {
        const track = trackOf(false, [...SPRINT])
        const car = createCar(track, track.startS)
        car.nitro = 0.25
        expect(refillAtLine(car, track.closed)).toBe(false)
        expect(car.nitro).toBe(0.25)
    })

    it('keeps a held burn going on the refilled tank', () => {
        const track = trackOf(true, RECTANGLE)
        const car = createCar(track, track.startS)
        const held = { throttle: 1, brake: 0, steer: 0, drift: false, nitro: true }
        car.nitro = 0.5
        stepCar(car, held, track, 1 / PHYSICS_HZ)
        refillAtLine(car, track.closed)
        expect(car.nitro).toBe(1)
        const ev = stepCar(car, held, track, 1 / PHYSICS_HZ)
        expect(ev.nitroStarted).toBe(false)
        expect(car.nitroOn).toBe(true)
        expect(car.nitro).toBeLessThan(1)
    })
})
