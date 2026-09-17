import { describe, it, expect } from 'vitest'
import {
    multiplicities,
    validateWindow,
    autoLayout,
    slotRates,
    derivedImpressions,
    populationTable,
    godFeasibility
} from '../../shared/utils/tcg/sheet-math'

describe('multiplicities', () => {
    it('counts each printing', () => {
        const mults = multiplicities(['A', 'B', 'A', 'C', 'A', 'B'])
        expect(mults.get('A')).toBe(3)
        expect(mults.get('B')).toBe(2)
        expect(mults.get('C')).toBe(1)
        expect(mults.size).toBe(3)
    })

    it('returns an empty map for an empty layout', () => {
        expect(multiplicities([]).size).toBe(0)
    })
})

describe('validateWindow', () => {
    it('returns [] for k <= 1 and empty layouts', () => {
        expect(validateWindow(['A', 'A', 'A'], 1)).toEqual([])
        expect(validateWindow(['A', 'A', 'A'], 0)).toEqual([])
        expect(validateWindow([], 4)).toEqual([])
    })

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

    it('flags a seam-spanning duplicate at window distance k-1', () => {
        // A at position 4 and A at position 0 are 2 apart across the seam;
        // k=3 windows see them together, k=2 windows do not.
        const layout = ['A', 'B', 'C', 'D', 'A', 'E']
        expect(validateWindow(layout, 3)).toEqual([{ position: 4, printingId: 'A' }])
        expect(validateWindow(layout, 2)).toEqual([])
    })

    it('flags every position when k exceeds the sheet size and a printing repeats', () => {
        const violations = validateWindow(['A', 'B', 'A'], 10)
        expect(violations.filter(v => v.printingId === 'A').map(v => v.position).sort()).toEqual([0, 2])
    })

    it('does not compare a position with itself when k > M', () => {
        expect(validateWindow(['A', 'B', 'C'], 10)).toEqual([])
    })
})

describe('autoLayout', () => {
    const mults: [string, number][] = [['A', 3], ['B', 3], ['C', 2], ['D', 2], ['E', 1], ['F', 1]]

    it('throws when total copies do not equal size', () => {
        expect(() => autoLayout([['A', 3]], 4)).toThrow()
        expect(() => autoLayout(mults, 11)).toThrow()
    })

    it('produces a layout with exactly the requested multiplicities', () => {
        const layout = autoLayout(mults, 12)
        expect(layout).toHaveLength(12)
        const counts = multiplicities(layout)
        for (const [id, m] of mults) {
            expect(counts.get(id)).toBe(m)
        }
    })

    it('passes validateWindow for feasible inputs (m <= floor(M/k))', () => {
        // M=12, k=4 → every m <= 3, so even spacing keeps gaps >= k
        const layout = autoLayout(mults, 12)
        expect(validateWindow(layout, 4)).toEqual([])
    })

    it('passes validateWindow on a larger fitted sheet', () => {
        // M=60, k=5 → feasible while m <= 12
        const big: [string, number][] = [
            ['common1', 12], ['common2', 12], ['common3', 10],
            ['uncommon1', 8], ['uncommon2', 8],
            ['rare1', 4], ['rare2', 3], ['rare3', 2], ['chase', 1]
        ]
        const layout = autoLayout(big, 60)
        expect(layout).toHaveLength(60)
        expect(validateWindow(layout, 5)).toEqual([])
    })

    it('is deterministic regardless of input order', () => {
        const shuffled: [string, number][] = [['F', 1], ['C', 2], ['A', 3], ['E', 1], ['D', 2], ['B', 3]]
        expect(autoLayout(mults, 12)).toEqual(autoLayout(mults, 12))
        expect(autoLayout(shuffled, 12)).toEqual(autoLayout(mults, 12))
    })
})

describe('slotRates', () => {
    it('computes k*m/M and its reciprocal', () => {
        // M=12, k=4: A has m=3 → expected 1 per pack; F has m=1 → 1 in 3
        const layout = autoLayout([['A', 3], ['B', 3], ['C', 2], ['D', 2], ['E', 1], ['F', 1]], 12)
        const rates = new Map(slotRates(layout, 4).map(r => [r.printingId, r]))
        expect(rates.get('A')).toMatchObject({ multiplicity: 3, expectedPerPack: 1, oneIn: 1 })
        expect(rates.get('F')).toMatchObject({ multiplicity: 1 })
        expect(rates.get('F')!.expectedPerPack).toBeCloseTo(1 / 3)
        expect(rates.get('F')!.oneIn).toBeCloseTo(3)
    })

    it('returns [] for an empty layout', () => {
        expect(slotRates([], 4)).toEqual([])
    })
})

describe('derivedImpressions', () => {
    it('matches hand-computed exact case', () => {
        // N=60, G=6, k=4, M=12 → tokens 216, R=18, capacity 54, leftover 0
        expect(derivedImpressions(60, 6, 4, 12)).toEqual({
            impressions: 18,
            cutsCapacity: 54,
            leftoverTokens: 0
        })
    })

    it('matches hand-computed case with remainder', () => {
        // N=61, G=6, k=4, M=12 → tokens 220, R=ceil(220/12)=19,
        // capacity floor(228/4)=57, leftover 228-220=8
        expect(derivedImpressions(61, 6, 4, 12)).toEqual({
            impressions: 19,
            cutsCapacity: 57,
            leftoverTokens: 8
        })
    })

    it('always leaves capacity for the packs served', () => {
        for (const [N, G, k, M] of [[1000, 10, 5, 121], [2500, 25, 4, 2683], [7, 0, 3, 12]] as const) {
            const { cutsCapacity, leftoverTokens } = derivedImpressions(N, G, k, M)
            expect(cutsCapacity).toBeGreaterThanOrEqual(N - G)
            expect(leftoverTokens).toBeGreaterThanOrEqual(0)
            expect(leftoverTokens).toBeLessThan(M)
        }
    })
})

describe('populationTable', () => {
    const baseLayout = autoLayout([['A', 3], ['B', 3], ['C', 2], ['D', 2], ['E', 1], ['F', 1]], 12)
    const godLayout = autoLayout([['E', 2], ['F', 2], ['G', 2]], 6)

    it('computes per-printing populations', () => {
        // Base serves N-G=54 packs at k=4 over M=12: A pop = 54*4*3/12 = 54
        // God serves G=6 packs at k=4 over M=6: G pop = 6*4*2/6 = 8
        const { rows, exactWithinOne } = populationTable(60, 6, [{ id: 's1', k: 4, layout: baseLayout }], [{ id: 'g1', k: 4, layout: godLayout }])
        const byId = new Map(rows.map(r => [r.printingId, r.population]))
        expect(byId.get('A')).toBe(54)
        expect(byId.get('G')).toBe(8)
        // E appears on both: 54*4*1/12 + 6*4*2/6 = 18 + 8 = 26
        expect(byId.get('E')).toBe(26)
        expect(exactWithinOne).toBe(true)
    })

    it('sums to N * cardsPerPack when base and god packs draw the same slot count', () => {
        const { rows } = populationTable(60, 6, [{ id: 's1', k: 4, layout: baseLayout }], [{ id: 'g1', k: 4, layout: godLayout }])
        const total = rows.reduce((sum, r) => sum + r.population, 0)
        expect(total).toBeCloseTo(60 * 4)
    })

    it('handles a run with no god packs', () => {
        const { rows } = populationTable(60, 0, [{ id: 's1', k: 4, layout: baseLayout }], [])
        const total = rows.reduce((sum, r) => sum + r.population, 0)
        expect(total).toBeCloseTo(240)
    })
})

describe('godFeasibility', () => {
    it('derives G = round(N / oneIn)', () => {
        expect(godFeasibility(1000, 100, true, true)).toEqual({ G: 10, errors: [] })
        expect(godFeasibility(250, 100, true, true).G).toBe(3)
    })

    it('requires a god template when G >= 1', () => {
        const { errors } = godFeasibility(1000, 100, false, true)
        expect(errors).toHaveLength(1)
        expect(errors[0]).toMatch(/template/)
    })

    it('requires window-clean god sheets when G >= 1', () => {
        const { errors } = godFeasibility(1000, 100, true, false)
        expect(errors).toHaveLength(1)
        expect(errors[0]).toMatch(/window/)
    })

    it('rejects G > N', () => {
        const { G, errors } = godFeasibility(10, 0.5, true, true)
        expect(G).toBe(20)
        expect(errors.some(e => e.includes('exceeds'))).toBe(true)
    })

    it('is clean when god packs are disabled', () => {
        expect(godFeasibility(1000, 0, false, false)).toEqual({ G: 0, errors: [] })
    })
})
