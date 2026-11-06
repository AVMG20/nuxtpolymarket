import { describe, expect, it } from 'vitest'
import { firstPad, PadPresses, readPad, type PadCommand, type PadSource } from '../../app/utils/nitro-rush/gamepad'
import { withPad } from '../../app/utils/nitro-rush/input'

const button = (value = 0) => ({ value, pressed: value > 0.5, touched: value > 0 })

/** A standard pad with `held` buttons at the given values. */
function pad(axes: number[] = [0, 0, 0, 0], held: Record<number, number> = {}): PadSource {
    return { axes, buttons: Array.from({ length: 17 }, (_, i) => button(held[i])) }
}

const IDLE = { throttle: 0, brake: 0, steer: 0, drift: false }

describe('readPad', () => {
    it('reads an idle pad as nothing at all', () => {
        const read = readPad(pad())
        expect(read.car).toEqual(IDLE)
        expect(read.active).toBe(false)
        expect(read.held.size).toBe(0)
    })

    it('ignores a stick resting off centre, then steers from nothing to full lock', () => {
        expect(readPad(pad([0.14, 0])).car.steer).toBe(0)
        expect(readPad(pad([0.14, 0])).active).toBe(false)
        const small = readPad(pad([0.2, 0])).car.steer
        expect(small).toBeGreaterThan(0)
        expect(small).toBeLessThan(0.1)
        expect(readPad(pad([1, 0])).car.steer).toBe(1)
        expect(readPad(pad([-1, 0])).car.steer).toBe(-1)
    })

    it('reads the triggers as analogue pedals, up to full', () => {
        const { throttle, brake } = readPad(pad(undefined, { 7: 0.5, 6: 1 })).car
        expect(throttle).toBeGreaterThan(0.4)
        expect(throttle).toBeLessThan(0.5)
        expect(brake).toBe(1)
        expect(readPad(pad(undefined, { 7: 0.04 })).car.throttle).toBe(0)
    })

    it('steers with the d-pad when the stick is at rest, and the stick wins otherwise', () => {
        expect(readPad(pad(undefined, { 15: 1 })).car.steer).toBe(1)
        expect(readPad(pad(undefined, { 14: 1 })).car.steer).toBe(-1)
        expect(readPad(pad([-0.5, 0], { 15: 1 })).car.steer).toBeLessThan(0)
    })

    it('drifts on A or RB, fires nitro on X or LB', () => {
        expect(readPad(pad(undefined, { 0: 1 })).car.drift).toBe(true)
        expect(readPad(pad(undefined, { 5: 1 })).car.drift).toBe(true)
        expect(readPad(pad(undefined, { 5: 1 })).active).toBe(true)
        expect(readPad(pad(undefined, { 2: 1 })).held.has('nitro')).toBe(true)
        expect(readPad(pad(undefined, { 4: 1 })).held.has('nitro')).toBe(true)
    })

    it('names the menu buttons', () => {
        const cases: [number, PadCommand][] = [[0, 'confirm'], [1, 'back'], [8, 'restart'], [9, 'pause'], [12, 'previous'], [14, 'previous'], [13, 'next'], [15, 'next']]
        for (const [b, command] of cases) expect([...readPad(pad(undefined, { [b]: 1 })).held]).toEqual([command])
    })

    it('copes with a pad that has fewer buttons and axes than the standard', () => {
        expect(readPad({ axes: [], buttons: [] }).car).toEqual(IDLE)
    })
})

describe('firstPad', () => {
    it('takes the first with the standard mapping, as nothing else has known buttons', () => {
        const a = { mapping: '' as const, id: 'a' }
        const b = { mapping: 'standard' as const, id: 'b' }
        expect(firstPad([null, a, b])).toBe(b)
        expect(firstPad([null, a])).toBeNull()
        expect(firstPad([])).toBeNull()
    })
})

describe('PadPresses', () => {
    it('fires a command once per press, and again after a release', () => {
        const presses = new PadPresses()
        const nitro = new Set<PadCommand>(['nitro'])
        expect(presses.take(nitro)).toEqual(['nitro'])
        expect(presses.take(nitro)).toEqual([])
        expect(presses.take(new Set())).toEqual([])
        expect(presses.take(nitro)).toEqual(['nitro'])
    })
})

describe('withPad', () => {
    const keys = { throttle: 1, brake: 0, steer: 0, drift: false }

    it('leaves the keys alone with no pad', () => {
        expect(withPad(keys, null)).toBe(keys)
    })

    it('takes the harder of each pedal, and either drift', () => {
        expect(withPad(keys, { throttle: 0.4, brake: 0.6, steer: 0.5, drift: true })).toEqual({ throttle: 1, brake: 0.6, steer: 0.5, drift: true })
    })

    it('lets a held steering key win over the stick', () => {
        expect(withPad({ ...keys, steer: -1 }, { ...keys, steer: 0.5 }).steer).toBe(-1)
    })
})
