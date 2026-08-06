import { describe, expect, it } from 'vitest'
import { resolveBets } from '#shared/utils/roulette/resolve'

describe('resolveBets', () => {
    it('pays a straight bet 35:1, stake included, on an exact hit', () => {
        const result = resolveBets([{ key: 'straight:17', amount: 100 }], 17)
        expect(result.totalStaked).toBe(100)
        expect(result.totalPayout).toBe(3600)
        expect(result.bets).toEqual([{ key: 'straight:17', amount: 100, won: true, payout: 3600 }])
    })

    it('pays nothing when the straight bet misses', () => {
        const result = resolveBets([{ key: 'straight:17', amount: 100 }], 18)
        expect(result.totalPayout).toBe(0)
        expect(result.bets[0]).toMatchObject({ won: false, payout: 0 })
    })

    it('no longer recognises a split key — dropped from the catalog', () => {
        const result = resolveBets([{ key: 'split:16-17', amount: 100 }], 17)
        expect(result.totalStaked).toBe(0)
        expect(result.totalPayout).toBe(0)
    })

    it('pays a street 11:1', () => {
        const result = resolveBets([{ key: 'street:1-2-3', amount: 100 }], 2)
        expect(result.totalPayout).toBe(1200)
    })

    it('pays a corner 8:1', () => {
        const result = resolveBets([{ key: 'corner:2-3-5-6', amount: 100 }], 5)
        expect(result.totalPayout).toBe(900)
    })

    it('pays a six-line 5:1', () => {
        const result = resolveBets([{ key: 'line:1-2-3-4-5-6', amount: 100 }], 4)
        expect(result.totalPayout).toBe(600)
    })

    it('pays a column bet 2:1', () => {
        const result = resolveBets([{ key: 'column:0', amount: 100 }], 6)
        expect(result.totalPayout).toBe(300)
    })

    it('pays a dozen 2:1', () => {
        const result = resolveBets([{ key: 'dozen:0', amount: 100 }], 7)
        expect(result.totalPayout).toBe(300)
    })

    it('pays even-money outside bets 1:1', () => {
        expect(resolveBets([{ key: 'red', amount: 100 }], 1).totalPayout).toBe(200)
        expect(resolveBets([{ key: 'black', amount: 100 }], 2).totalPayout).toBe(200)
        expect(resolveBets([{ key: 'odd', amount: 100 }], 3).totalPayout).toBe(200)
        expect(resolveBets([{ key: 'even', amount: 100 }], 4).totalPayout).toBe(200)
        expect(resolveBets([{ key: 'low', amount: 100 }], 18).totalPayout).toBe(200)
        expect(resolveBets([{ key: 'high', amount: 100 }], 19).totalPayout).toBe(200)
    })

    it('loses every outside bet when zero hits', () => {
        for (const key of ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen:0', 'column:0']) {
            expect(resolveBets([{ key, amount: 100 }], 0).totalPayout).toBe(0)
        }
    })

    it('pays a straight bet on zero itself', () => {
        expect(resolveBets([{ key: 'straight:0', amount: 100 }], 0).totalPayout).toBe(3600)
    })

    it('settles every bet on the slip independently in one round', () => {
        const result = resolveBets([
            { key: 'straight:17', amount: 100 },
            { key: 'red', amount: 50 },
            { key: 'black', amount: 50 }
        ], 17)

        expect(result.totalStaked).toBe(200)
        // 17 is black: the straight and the black bet both win, red loses.
        expect(result.totalPayout).toBe(3600 + 100)
    })

    it('ignores a bet key that does not exist on the layout', () => {
        const result = resolveBets([{ key: 'not-a-real-bet', amount: 100 }], 17)
        expect(result.totalStaked).toBe(0)
        expect(result.totalPayout).toBe(0)
        expect(result.bets).toEqual([])
    })

    it('returns zero on zero when there is nothing staked', () => {
        const result = resolveBets([], 5)
        expect(result).toEqual({ totalStaked: 0, totalPayout: 0, bets: [] })
    })
})
