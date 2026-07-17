import { describe, it, expect, afterEach, vi } from 'vitest'
import { stubRandomFloat } from '../setup/stub-random'
import { playDice } from '../../shared/utils/gamelogic/dice'

afterEach(() => {
    vi.restoreAllMocks()
})

// playDice reads crypto.getRandomValues directly into a length-1 Uint32Array
// rather than going through randomFloat(). stubRandomFloat's packing only
// fills buf[0] for a 1-element array (the buf[1] write is a silent no-op), so
// arr[0]/0xFFFFFFFF ends up within ~1e-9 of the next() value fed in — far
// finer than the roll's own two-decimal resolution, so it pins deterministically.

describe('playDice validation', () => {
    it('defaults win chance to 50 when no options are given', () => {
        stubRandomFloat(() => 0.1)
        const result = playDice(100)
        expect(result.winChance).toBe(50)
    })

    it('rejects a win chance below 2', () => {
        expect(() => playDice(100, { winChance: 1 })).toThrow()
    })

    it('rejects a win chance above 96', () => {
        expect(() => playDice(100, { winChance: 97 })).toThrow()
    })

    it('rejects a non-finite win chance', () => {
        expect(() => playDice(100, { winChance: NaN })).toThrow()
        expect(() => playDice(100, { winChance: Infinity })).toThrow()
    })

    it('accepts the boundary win chances 2 and 96', () => {
        stubRandomFloat(() => 0)
        expect(() => playDice(100, { winChance: 2 })).not.toThrow()
        expect(() => playDice(100, { winChance: 96 })).not.toThrow()
    })
})

describe('playDice multiplier math', () => {
    it('is 98 / winChance, giving a constant 0.98 return factor', () => {
        for (const winChance of [2, 25, 50, 75, 96]) {
            const multiplier = playDice(100, { winChance }).multiplier
            expect(multiplier).toBeCloseTo(98 / winChance, 10)
            expect(multiplier * (winChance / 100)).toBeCloseTo(0.98, 10)
        }
    })
})

describe('playDice win/loss boundary', () => {
    it('loses when the roll lands exactly on the win chance threshold', () => {
        stubRandomFloat(() => 0.5) // roll = 50.00
        const result = playDice(100, { winChance: 50 })
        expect(result.roll).toBe(50)
        expect(result.won).toBe(false)
        expect(result.payout).toBe(0)
    })

    it('wins on the roll immediately below the win chance threshold', () => {
        stubRandomFloat(() => 0.49999) // roll = 49.99
        const result = playDice(100, { winChance: 50 })
        expect(result.roll).toBe(49.99)
        expect(result.won).toBe(true)
        expect(result.payout).toBe(100 * 1.96)
    })

    it('produces a roll capped below 100', () => {
        // The largest value randomFloat() can return. The old rand() divided by
        // 0xFFFFFFFF and so could reach exactly 1.0, rolling a 100.00.
        stubRandomFloat(() => 1 - Number.EPSILON / 2)
        const result = playDice(100, { winChance: 50 })
        expect(result.roll).toBe(99.99)
        expect(result.roll).toBeLessThan(100)
    })
})

describe('playDice payout', () => {
    it('pays bet x multiplier on a win and nothing on a loss', () => {
        stubRandomFloat(() => 0.1) // roll = 9.99
        const win = playDice(200, { winChance: 50 })
        expect(win.won).toBe(true)
        expect(win.payout).toBe(200 * win.multiplier)

        stubRandomFloat(() => 0.9) // roll = 89.99
        const loss = playDice(200, { winChance: 50 })
        expect(loss.won).toBe(false)
        expect(loss.payout).toBe(0)
    })

    it('does not include a separate cost field — the caller stakes exactly bet', () => {
        stubRandomFloat(() => 0.1)
        const result = playDice(100, { winChance: 50 })
        expect('cost' in result).toBe(false)
    })
})
