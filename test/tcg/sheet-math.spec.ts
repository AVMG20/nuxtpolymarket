import { describe, it, expect } from 'vitest'
import {
    multiplicities,
    validateWindow,
    autoLayout,
    derivedImpressions,
    godFeasibility
} from '../../shared/utils/tcg/sheet-math'

// The window rule is what keeps one pack from holding the same card twice.
describe('validateWindow', () => {
    it('passes a clean linear layout', () => {
        expect(validateWindow(['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'], 4)).toEqual([])
    })

    it('flags an adjacent duplicate mid-layout', () => {
        const violations = validateWindow(['A', 'B', 'B', 'C'], 2)
        expect(violations).toEqual([{ position: 1, printingId: 'B' }])
    })

    it('flags a duplicate spanning the circular seam', () => {
        // A at positions 3 and 0 are adjacent on the circle: window of 2
        // starting at position 3 wraps around and contains both.
        const violations = validateWindow(['A', 'B', 'C', 'A'], 2)
        expect(violations).toEqual([{ position: 3, printingId: 'A' }])
    })
})

describe('autoLayout', () => {
    it('keeps the requested multiplicities and passes validateWindow on a fitted sheet', () => {
        // M=60, k=5 → feasible while m <= 12
        const big: [string, number][] = [
            ['common1', 12], ['common2', 12], ['common3', 10],
            ['uncommon1', 8], ['uncommon2', 8],
            ['rare1', 4], ['rare2', 3], ['rare3', 2], ['chase', 1]
        ]
        const layout = autoLayout(big, 60)
        expect(layout).toHaveLength(60)
        const counts = multiplicities(layout)
        for (const [id, m] of big) {
            expect(counts.get(id)).toBe(m)
        }
        expect(validateWindow(layout, 5)).toEqual([])
    })
})

describe('derivedImpressions', () => {
    // A sheet that runs out before the last pack would sell a pack with no cards.
    it('always leaves capacity for the packs served', () => {
        for (const [N, G, k, M] of [[61, 6, 4, 12], [1000, 10, 5, 121], [2500, 25, 4, 2683], [7, 0, 3, 12]] as const) {
            const { cutsCapacity, leftoverTokens } = derivedImpressions(N, G, k, M)
            expect(cutsCapacity).toBeGreaterThanOrEqual(N - G)
            expect(leftoverTokens).toBeGreaterThanOrEqual(0)
            expect(leftoverTokens).toBeLessThan(M)
        }
    })
})

describe('godFeasibility', () => {
    it('rejects more god packs than the run has packs', () => {
        const { G, errors } = godFeasibility(10, 0.5, true, true)
        expect(G).toBe(20)
        expect(errors.some(e => e.includes('exceeds'))).toBe(true)
    })
})
