import { describe, it, expect, afterEach, vi } from 'vitest'
import { stubRandomFloat } from '../setup/stub-random'
import {
    playCandyMadness,
    CM_MAX_WIN_MULT,
    CM_FREE_SPINS,
    CM_SCATTER_TRIGGER
} from '../../shared/utils/gamelogic/candymadness'

afterEach(() => {
    vi.restoreAllMocks()
})

// Deterministic source for the Monte-Carlo-style sweeps below — reproducible
// coverage of the RNG-heavy cascade/bonus paths without real crypto's
// run-to-run variance.
function mulberry32(seed: number) {
    let a = seed
    return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// rand() reads crypto.getRandomValues into a length-1 Uint32Array (same
// pattern as playDice — see dice.spec.ts), so stubRandomFloat's packing pins
// it to within ~1e-9 of the fed value.
const SCATTER_VAL = 0.995 // lands in scatter's top bucket of the 7-symbol base draw
const CANDY_MIDPOINTS = [0.1002, 0.2966, 0.4830, 0.6573, 0.8096, 0.9339] // grape..red bucket midpoints, valid for both the 7-symbol base draw and the 6-symbol tumble/bonus draw

// idx % 6 always differs from its row neighbour (index delta 1) and column
// neighbour (index delta CM_ROWS = 7, and 7 % 6 = 1) by a nonzero amount mod 6,
// so this fill can never itself form a cluster. Every drop it produces resolves
// in zero tumbles, which sidesteps the cascade's unbounded loop entirely — safe
// to drive any number of rounds (including a whole bonus feature) with it.
function noClusterSequence(scatterCount: number) {
    let i = 0
    return () => {
        const idx = i++
        if (idx < scatterCount) return SCATTER_VAL
        return CANDY_MIDPOINTS[idx % 6]!
    }
}

describe('playCandyMadness validation', () => {
    it('rejects a zero or negative bet', () => {
        expect(() => playCandyMadness(0)).toThrow()
        expect(() => playCandyMadness(-10)).toThrow()
    })

    it('rejects a non-finite bet', () => {
        expect(() => playCandyMadness(NaN)).toThrow()
        expect(() => playCandyMadness(Infinity)).toThrow()
    })
})

describe('scatter trigger boundary', () => {
    it('does not trigger the bonus with one fewer than CM_SCATTER_TRIGGER scatters', () => {
        stubRandomFloat(noClusterSequence(CM_SCATTER_TRIGGER - 1))
        const result = playCandyMadness(100)
        expect(result.scatterCount).toBe(CM_SCATTER_TRIGGER - 1)
        expect(result.basePayout).toBe(0)
        expect(result.bonusTriggered).toBe(false)
        expect(result.bonus).toBeNull()
    })

    it('triggers the bonus at exactly CM_SCATTER_TRIGGER scatters', () => {
        stubRandomFloat(noClusterSequence(CM_SCATTER_TRIGGER))
        const result = playCandyMadness(100)
        expect(result.scatterCount).toBe(CM_SCATTER_TRIGGER)
        expect(result.basePayout).toBe(0)
        expect(result.bonusTriggered).toBe(true)
        expect(result.bonus).not.toBeNull()
        expect(result.bonus!.spins).toHaveLength(CM_FREE_SPINS)
        expect(result.bonus!.bonusPayout).toBe(0) // no-cluster fill holds for every free spin too
    })
})

describe('max-win cap', () => {
    it('reports maxWin as bet times CM_MAX_WIN_MULT', () => {
        expect(playCandyMadness(50).maxWin).toBe(50 * CM_MAX_WIN_MULT)
    })

    it('never pays out above maxWin, across a seeded sweep of bought free-spins rounds', () => {
        stubRandomFloat(mulberry32(1))
        for (let i = 0; i < 100; i++) {
            const result = playCandyMadness(10, { feature: 'buyFreeSpins' })
            expect(result.payout).toBeLessThanOrEqual(result.maxWin)
        }
    })
})

describe('tumble sequence win formula', () => {
    it('multiplies basePay by the multiplier-spot sum, floored at 1x', () => {
        stubRandomFloat(mulberry32(21))
        for (let i = 0; i < 50; i++) {
            const seq = playCandyMadness(1).base
            const expected = seq.basePay > 0 ? seq.basePay * Math.max(1, seq.multiplierSum) : 0
            expect(seq.win).toBeCloseTo(expected, 6)
        }
    })
})
