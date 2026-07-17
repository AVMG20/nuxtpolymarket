import { describe, it, expect, afterEach, vi } from 'vitest'
import { stubRandomFloat } from '../setup/stub-random'
import { playLimbo } from '../../shared/utils/gamelogic/limbo'

afterEach(() => {
    vi.restoreAllMocks()
})

// Same crypto.getRandomValues(len-1 array) pattern as dice.ts — see the note
// in dice.spec.ts for why stubRandomFloat still pins the roll precisely enough.

describe('playLimbo validation', () => {
    it('defaults target to 2 when no options are given', () => {
        stubRandomFloat(() => 0.1)
        const result = playLimbo(100)
        expect(result.target).toBe(2)
    })

    it('rejects a non-finite target', () => {
        expect(() => playLimbo(100, { target: NaN })).toThrow()
        expect(() => playLimbo(100, { target: Infinity })).toThrow()
    })

    it('rejects a target above 1,000,000', () => {
        expect(() => playLimbo(100, { target: 1_000_001 })).toThrow()
    })

    it('accepts the upper boundary target of 1,000,000', () => {
        stubRandomFloat(() => 0)
        expect(() => playLimbo(100, { target: 1_000_000 })).not.toThrow()
    })

    // The error message claims a 1.01 floor, but the guard actually rejects
    // anything below 1.10 — message and check have drifted apart. Pinning the
    // real runtime boundary here (not the message text) since that's the
    // behavior callers actually observe. Flagged separately as a bug.
    it('rejects a target below the real 1.10 floor enforced by the code', () => {
        expect(() => playLimbo(100, { target: 1.09 })).toThrow()
        expect(() => playLimbo(100, { target: 1.05 })).toThrow()
    })

    it('accepts the real floor boundary of 1.10', () => {
        stubRandomFloat(() => 0)
        expect(() => playLimbo(100, { target: 1.10 })).not.toThrow()
    })
})

describe('playLimbo multiplier math', () => {
    it('multiplier always equals the requested target', () => {
        stubRandomFloat(() => 0.1)
        for (const target of [1.10, 2, 10, 1000, 1_000_000]) {
            expect(playLimbo(100, { target }).multiplier).toBe(target)
        }
    })
})

describe('playLimbo win/loss boundary', () => {
    it('loses when the generated result lands just under the target', () => {
        stubRandomFloat(() => 0.5000001)
        const result = playLimbo(100, { target: 1.96 })
        expect(result.result).toBe(1.95)
        expect(result.won).toBe(false)
        expect(result.payout).toBe(0)
    })

    it('pays exactly 0.98 / roll, without the old divisor skewing the result down', () => {
        stubRandomFloat(() => 0.5)
        const result = playLimbo(100, { target: 1.96 })
        expect(result.result).toBe(1.96)
        expect(result.won).toBe(true)
    })

    it('wins when the generated result reaches the target exactly', () => {
        stubRandomFloat(() => 0.49999)
        const result = playLimbo(100, { target: 1.96 })
        expect(result.result).toBe(1.96)
        expect(result.won).toBe(true)
        expect(result.payout).toBe(100 * 1.96)
    })

    it('a near-zero roll saturates the result at the 1,000,000 cap', () => {
        stubRandomFloat(() => 0)
        const result = playLimbo(100, { target: 1_000_000 })
        expect(result.result).toBe(1_000_000)
        expect(result.won).toBe(true)
    })
})

describe('playLimbo payout', () => {
    it('pays bet x target on a win and nothing on a loss', () => {
        stubRandomFloat(() => 0.001) // result = 980, comfortably above any small target
        const win = playLimbo(50, { target: 5 })
        expect(win.won).toBe(true)
        expect(win.payout).toBe(50 * 5)

        stubRandomFloat(() => 0.98) // result = 1
        const loss = playLimbo(50, { target: 5 })
        expect(loss.won).toBe(false)
        expect(loss.payout).toBe(0)
    })

    it('does not include a separate cost field — the caller stakes exactly bet', () => {
        stubRandomFloat(() => 0.1)
        const result = playLimbo(100, { target: 2 })
        expect('cost' in result).toBe(false)
    })
})
