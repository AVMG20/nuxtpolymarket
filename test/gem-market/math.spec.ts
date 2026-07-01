import { describe, it, expect } from 'vitest'
import {
    gemBuyGems,
    gemSellGems,
    GEM_TRADE_FEE,
    GEM_MAX_GEMS_PER_TRADE,
    GEM_MIN_PRICE,
    GEM_MAX_PRICE
} from '../../shared/utils/gamelogic/gem-market'

describe('gemBuyGems', () => {
    it('increases the price', () => {
        const { newPrice } = gemBuyGems(1000, 10)
        expect(newPrice).toBeGreaterThan(1000)
    })

    it('cost is positive', () => {
        const { cost } = gemBuyGems(1000, 50)
        expect(cost).toBeGreaterThan(0)
    })

    it('price after max-size trade is ~50% higher', () => {
        const start = 1000
        const { newPrice } = gemBuyGems(start, GEM_MAX_GEMS_PER_TRADE)
        expect(newPrice).toBeCloseTo(start * 1.5, 4)
    })

    it('clamps to GEM_MAX_PRICE', () => {
        const { newPrice } = gemBuyGems(GEM_MAX_PRICE * 0.99, 50)
        expect(newPrice).toBe(GEM_MAX_PRICE)
    })
})

describe('gemSellGems', () => {
    it('decreases the price', () => {
        const { newPrice } = gemSellGems(1000, 10)
        expect(newPrice).toBeLessThan(1000)
    })

    it('revenue is positive', () => {
        const { revenue } = gemSellGems(1000, 50)
        expect(revenue).toBeGreaterThan(0)
    })

    it('price after max-size trade is ~33% lower (inverse of +50%)', () => {
        const start = 1000
        const { newPrice } = gemSellGems(start, GEM_MAX_GEMS_PER_TRADE)
        // buy 50 moves price × 1.5; sell 50 is the exact inverse → ÷ 1.5
        expect(newPrice).toBeCloseTo(start / 1.5, 4)
    })

    it('clamps to GEM_MIN_PRICE', () => {
        const { newPrice } = gemSellGems(GEM_MIN_PRICE * 1.01, 50)
        expect(newPrice).toBe(GEM_MIN_PRICE)
    })
})

describe('round-trip symmetry', () => {
    it('buy then sell returns to the starting price', () => {
        const start = 5000
        const gems = 25
        const { newPrice: afterBuy } = gemBuyGems(start, gems)
        const { newPrice: afterSell } = gemSellGems(afterBuy, gems)
        expect(afterSell).toBeCloseTo(start, 4)
    })

    it('round-trip costs ~1% in fees (two trades × 0.5%)', () => {
        const start = 1000
        const gems = 50
        const { cost, newPrice } = gemBuyGems(start, gems)
        const { revenue } = gemSellGems(newPrice, gems)
        const loss = cost - revenue
        // fee on buy + fee on sell ≈ 1% of the traded value
        expect(loss / cost).toBeCloseTo(2 * GEM_TRADE_FEE, 2)
    })

    it('sequential buys compound — second buy starts from a higher price', () => {
        const start = 1000
        const gems = 10
        const { newPrice: p1 } = gemBuyGems(start, gems)
        const { cost: cost1 } = gemBuyGems(start, gems)
        const { cost: cost2 } = gemBuyGems(p1, gems)
        // Second buy at higher price must cost more
        expect(cost2).toBeGreaterThan(cost1)
    })
})
