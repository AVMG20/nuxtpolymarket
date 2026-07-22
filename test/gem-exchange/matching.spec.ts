import { describe, it, expect } from 'vitest'
import {
    GEM_EXCHANGE_MAX_QUANTITY,
    isValidGemPrice,
    isValidGemQuantity,
    isValidGemOrderTotal,
    gemOrderTotal,
    getGemBookLevelOrder,
    matchGemOrder,
    type RestingGemOrder
} from '../../shared/utils/gamelogic/gem-exchange'

function resting(id: string, userId: string, price: number, remaining: number): RestingGemOrder {
    return { id, userId, price, remaining }
}

describe('isValidGemPrice', () => {
    it('accepts whole-cent prices with no artificial ceiling', () => {
        expect(isValidGemPrice(0.01)).toBe(true)
        expect(isValidGemPrice(300)).toBe(true)
        expect(isValidGemPrice(299.99)).toBe(true)
        expect(isValidGemPrice(1_000_000_000)).toBe(true)
    })

    it('rejects sub-cent precision, zero, negatives and beyond-exact-cents values', () => {
        expect(isValidGemPrice(0.001)).toBe(false)
        expect(isValidGemPrice(299.999)).toBe(false)
        expect(isValidGemPrice(0)).toBe(false)
        expect(isValidGemPrice(-5)).toBe(false)
        // cents no longer representable exactly in float64
        expect(isValidGemPrice(Number.MAX_SAFE_INTEGER)).toBe(false)
        expect(isValidGemPrice(NaN)).toBe(false)
        expect(isValidGemPrice(Infinity)).toBe(false)
    })
})

describe('isValidGemQuantity', () => {
    it('accepts integers up to the int4 column limit', () => {
        expect(isValidGemQuantity(1)).toBe(true)
        expect(isValidGemQuantity(GEM_EXCHANGE_MAX_QUANTITY)).toBe(true)
    })

    it('rejects zero, negatives, fractions and beyond-column values', () => {
        expect(isValidGemQuantity(0)).toBe(false)
        expect(isValidGemQuantity(-1)).toBe(false)
        expect(isValidGemQuantity(1.5)).toBe(false)
        expect(isValidGemQuantity(GEM_EXCHANGE_MAX_QUANTITY + 1)).toBe(false)
    })
})

describe('isValidGemOrderTotal', () => {
    it('accepts totals that stay cent-exact', () => {
        expect(isValidGemOrderTotal(300, 1_000_000)).toBe(true)
        expect(isValidGemOrderTotal(1_000_000_000, 1_000)).toBe(true)
    })

    it('rejects totals whose cents overflow exact float64 integers', () => {
        expect(isValidGemOrderTotal(90_000_000_000_000, 2)).toBe(false)
    })
})

describe('gemOrderTotal', () => {
    it('is exact for prices that are lossy in float math', () => {
        // 0.1 + 0.2 style floats: 3 × 289.55 = 868.65 exactly, not 868.6500000000001
        expect(gemOrderTotal(289.55, 3)).toBe(868.65)
        expect(gemOrderTotal(0.01, 10_000)).toBe(100)
        expect(gemOrderTotal(0.29, 3)).toBe(0.87)
    })
})

describe('getGemBookLevelOrder', () => {
    const asks = [
        { price: 290, quantity: 5 },
        { price: 295, quantity: 10 },
        { price: 300, quantity: 20 }
    ]

    it('buys the best ask quantity at its price', () => {
        expect(getGemBookLevelOrder('sell', asks, 0)).toEqual({
            side: 'buy',
            price: 290,
            quantity: 5
        })
    })

    it('includes every better ask when buying through a deeper level', () => {
        expect(getGemBookLevelOrder('sell', asks, 2)).toEqual({
            side: 'buy',
            price: 300,
            quantity: 35
        })
    })

    it('sells through bids and caps the quantity at the order limit', () => {
        const bids = [
            { price: 320, quantity: GEM_EXCHANGE_MAX_QUANTITY },
            { price: 310, quantity: 10 }
        ]
        expect(getGemBookLevelOrder('buy', bids, 1)).toEqual({
            side: 'sell',
            price: 310,
            quantity: GEM_EXCHANGE_MAX_QUANTITY
        })
    })

    it('returns null for a missing level', () => {
        expect(getGemBookLevelOrder('sell', asks, 10)).toBeNull()
    })
})

describe('matchGemOrder', () => {
    it('fills at the resting order price, not the incoming limit', () => {
        const book = [resting('a1', 'seller', 290, 10)]
        const { fills, remaining } = matchGemOrder({ side: 'buy', price: 310, quantity: 10, book })
        expect(fills).toEqual([{ orderId: 'a1', userId: 'seller', price: 290, quantity: 10 }])
        expect(remaining).toBe(0)
    })

    it('walks the book best-first and partially fills the last level', () => {
        const book = [
            resting('a1', 's1', 290, 5),
            resting('a2', 's2', 295, 5),
            resting('a3', 's3', 300, 20)
        ]
        const { fills, remaining } = matchGemOrder({ side: 'buy', price: 300, quantity: 15, book })
        expect(fills.map(f => [f.orderId, f.quantity])).toEqual([['a1', 5], ['a2', 5], ['a3', 5]])
        expect(remaining).toBe(0)
    })

    it('stops at the first non-crossing price and leaves the rest unfilled', () => {
        const book = [
            resting('a1', 's1', 290, 5),
            resting('a2', 's2', 350, 5)
        ]
        const { fills, remaining } = matchGemOrder({ side: 'buy', price: 300, quantity: 10, book })
        expect(fills).toHaveLength(1)
        expect(remaining).toBe(5)
    })

    it('does not fill when nothing crosses', () => {
        const book = [resting('a1', 's1', 350, 5)]
        const { fills, remaining } = matchGemOrder({ side: 'buy', price: 300, quantity: 5, book })
        expect(fills).toHaveLength(0)
        expect(remaining).toBe(5)
    })

    it('matches sells against bids at the resting (higher) bid price', () => {
        const book = [
            resting('b1', 'buyer1', 320, 5),
            resting('b2', 'buyer2', 310, 5)
        ]
        const { fills, remaining } = matchGemOrder({ side: 'sell', price: 300, quantity: 8, book })
        expect(fills).toEqual([
            { orderId: 'b1', userId: 'buyer1', price: 320, quantity: 5 },
            { orderId: 'b2', userId: 'buyer2', price: 310, quantity: 3 }
        ])
        expect(remaining).toBe(0)
    })

    it('matches a player against their own resting order like any other', () => {
        const book = [
            resting('mine', 'me', 290, 5),
            resting('other', 'them', 295, 5)
        ]
        const { fills, remaining } = matchGemOrder({ side: 'buy', price: 300, quantity: 10, book })
        expect(fills).toEqual([
            { orderId: 'mine', userId: 'me', price: 290, quantity: 5 },
            { orderId: 'other', userId: 'them', price: 295, quantity: 5 }
        ])
        expect(remaining).toBe(0)
    })

    it('never over-fills a resting order', () => {
        const book = [resting('a1', 's1', 290, 3)]
        const { fills, remaining } = matchGemOrder({ side: 'buy', price: 300, quantity: 10, book })
        expect(fills[0]!.quantity).toBe(3)
        expect(remaining).toBe(7)
    })
})
