import { describe, it, expect } from 'vitest'
import { isIncomeCategory, summariseIncome } from '../../shared/utils/player-income'

describe('isIncomeCategory', () => {
    it('counts game payouts and uncategorised credits', () => {
        expect(isIncomeCategory('dice')).toBe(true)
        expect(isIncomeCategory('tcg:market')).toBe(true)
        expect(isIncomeCategory('gem exchange')).toBe(true)
        expect(isIncomeCategory(null)).toBe(true)
    })

    it('skips bank moves and gifts', () => {
        expect(isIncomeCategory('bank')).toBe(false)
        expect(isIncomeCategory('bank:loan')).toBe(false)
        expect(isIncomeCategory('gift:received')).toBe(false)
    })

    it('skips money coming back to the player', () => {
        expect(isIncomeCategory('polytown:refund')).toBe(false)
        expect(isIncomeCategory('shapezz:weapon-refund')).toBe(false)
        expect(isIncomeCategory('live-blackjack:recovery')).toBe(false)
        expect(isIncomeCategory('town:market:cancel')).toBe(false)
    })
})

describe('summariseIncome', () => {
    it('folds categories onto their audit label and ranks them', () => {
        const summary = summariseIncome([
            { category: 'blackjack', amount: 100 },
            { category: 'live-blackjack:side:perfectPairs', amount: 50 },
            { category: 'xeno', amount: 300 },
            { category: 'bank', amount: 10_000 },
            { category: 'gift:received', amount: 5_000 }
        ])

        expect(summary.total).toBe(450)
        expect(summary.sources.map(s => [s.label, s.amount])).toEqual([['Xeno', 300], ['Blackjack', 150]])
        expect(summary.sources[0]!.genre).toBe('idle')
        expect(summary.sources[0]!.share).toBeCloseTo(300 / 450)
        expect(summary.otherAmount).toBe(0)
        expect(summary.otherCount).toBe(0)
    })

    it('keeps the top five and rolls the rest into other', () => {
        const rows = ['dice', 'limbo', 'wheel', 'xeno', 'colony', 'miner', 'pirates']
            .map((category, i) => ({ category, amount: (i + 1) * 10 }))
        const summary = summariseIncome(rows)

        expect(summary.sources).toHaveLength(5)
        expect(summary.sources.map(s => s.label)).toEqual(['Pirates', 'Miner', 'Colony', 'Xeno', 'Wheel'])
        expect(summary.otherAmount).toBe(30)
        expect(summary.otherCount).toBe(2)
        expect(summary.total).toBe(280)
    })

    it('is empty when nothing came in', () => {
        expect(summariseIncome([])).toEqual({ total: 0, sources: [], otherAmount: 0, otherCount: 0 })
        expect(summariseIncome([{ category: 'bank', amount: 10 }]).total).toBe(0)
    })
})
