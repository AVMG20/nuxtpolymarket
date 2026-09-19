import { describe, expect, it } from 'vitest'
import { gemAdvisorOptions, gemAdvisorPick, gemAdvisorState, type GemAdvisorMarket } from '../../shared/utils/gamelogic/gem-price-advisor'

const trades = (prices: number[]) => prices.map(price => ({ price, quantity: 10 }))

const market: GemAdvisorMarket = {
    guidePrice: 400,
    bestBid: 390,
    bestAsk: 420,
    gemsForSale: 500,
    gemsWanted: 500,
    trades: trades([410, 405, 400, 400, 395, 390]),
    trades24h: 10
}

describe('gem price advisor options', () => {
    it('keeps every sell resting above the best bid, fastest first', () => {
        const options = gemAdvisorOptions('sell', market)
        expect(options.every(option => option.price > market.bestBid!)).toBe(true)
        expect(options.map(option => option.price)).toEqual([...options.map(option => option.price)].sort((a, b) => a - b))
        expect(options.find(option => option.front)?.price).toBe(419.99)
    })

    it('keeps every buy resting below the best ask, fastest first', () => {
        const options = gemAdvisorOptions('buy', market)
        expect(options.every(option => option.price < market.bestAsk!)).toBe(true)
        expect(options.map(option => option.price)).toEqual([...options.map(option => option.price)].sort((a, b) => b - a))
        expect(options.find(option => option.front)?.price).toBe(390.01)
    })

    it('clamps the guide into the resting range when the book sits away from it', () => {
        const options = gemAdvisorOptions('sell', { ...market, bestBid: 450, bestAsk: 470 })
        expect(Math.min(...options.map(option => option.price))).toBe(450.01)
        expect(new Set(options.map(option => option.price)).size).toBe(options.length)
    })

    it('works on an empty book', () => {
        const empty = { ...market, bestBid: null, bestAsk: null, gemsForSale: 0, gemsWanted: 0, trades: [], trades24h: 0 }
        const options = gemAdvisorOptions('buy', empty)
        expect(options.map(option => option.price)).toEqual([400, 380, 340])
        expect(options.some(option => option.front)).toBe(false)
        expect(gemAdvisorState('buy', 5, empty).market.balance).toBe('the book is empty')
    })
})

describe('gem price advisor pick', () => {
    const options = gemAdvisorOptions('sell', market)

    it('takes a confident choice', () => {
        const pick = gemAdvisorPick(options, 400, { choice: options[2]!.id, probabilities: { [options[2]!.id]: 0.7 } })
        expect(pick).toMatchObject({ option: options[2], jev: true })
    })

    it('falls back to the front of the queue when unsure or unknown', () => {
        const front = options.find(option => option.front)
        expect(gemAdvisorPick(options, 400, { choice: options[2]!.id, probabilities: { [options[2]!.id]: 0.2 } }).option).toBe(front)
        expect(gemAdvisorPick(options, 400, { choice: 'nope' }).option).toBe(front)
        expect(gemAdvisorPick(options, 400, null)).toMatchObject({ option: front, jev: false })
    })
})
