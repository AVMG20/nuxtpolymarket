import { describe, expect, it } from 'vitest'
import { CARS, findCar, isCarId } from '../../shared/utils/nitro-rush/cars'

describe('car list', () => {
    it('gives every car its own id', () => {
        expect(new Set(CARS.map(c => c.id)).size).toBe(CARS.length)
    })

    it('knows its own ids and nothing else', () => {
        for (const c of CARS) expect(isCarId(c.id)).toBe(true)
        expect(isCarId('batmobile')).toBe(false)
        expect(isCarId(undefined)).toBe(false)
    })

    it('falls back to the first car for a stale stored id', () => {
        expect(findCar('kestrel').id).toBe('kestrel')
        expect(findCar('gone')).toBe(CARS[0])
    })
})
