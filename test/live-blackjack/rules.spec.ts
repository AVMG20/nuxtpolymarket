import { describe, expect, it } from 'vitest'
import { chipRackFor, chipStack, LB_CHIPS } from '#shared/utils/live-blackjack/chips'
import {
    canDouble,
    canSplit,
    canSurrender,
    dealerShouldHit,
    handScore,
    hiLoValue,
    isBlackjack,
    LB_RULES,
    settleHand
} from '#shared/utils/live-blackjack/rules'
import type { LbCard, LbHand, LbRank } from '#shared/utils/live-blackjack/types'

let seq = 0
const card = (rank: LbRank, hidden = false): LbCard => ({
    id: `c${++seq}`,
    rank,
    suit: 'spades',
    hidden: hidden || undefined
})

function hand(ranks: LbRank[], overrides: Partial<LbHand> = {}): LbHand {
    return {
        id: 'h1',
        cards: ranks.map(r => card(r)),
        bet: 100,
        status: 'playing',
        doubled: false,
        fromSplit: false,
        score: 0,
        soft: false,
        ...overrides
    }
}

describe('handScore', () => {
    it('counts an ace as 11 while it fits', () => {
        expect(handScore([card('A'), card('6')])).toEqual({ total: 17, soft: true })
    })

    it('demotes aces one at a time to stay under 21', () => {
        expect(handScore([card('A'), card('A'), card('9')])).toEqual({ total: 21, soft: true })
        expect(handScore([card('A'), card('A'), card('9'), card('5')])).toEqual({ total: 16, soft: false })
    })

    it('treats every face card as ten', () => {
        expect(handScore([card('J'), card('Q')]).total).toBe(20)
        expect(handScore([card('K'), card('10')]).total).toBe(20)
    })

    it('ignores a face-down card so the hole card never leaks through the score', () => {
        expect(handScore([card('10'), card('A', true)])).toEqual({ total: 10, soft: false })
    })
})

describe('isBlackjack', () => {
    it('is a natural only on the first two cards', () => {
        expect(isBlackjack(hand(['A', 'K']))).toBe(true)
        expect(isBlackjack(hand(['7', '4', '10']))).toBe(false)
    })

    it('is never a natural on a split hand', () => {
        expect(isBlackjack(hand(['A', 'K'], { fromSplit: true }))).toBe(false)
    })
})

describe('dealerShouldHit', () => {
    it('draws below 17', () => {
        expect(dealerShouldHit([card('10'), card('6')])).toBe(true)
    })

    it('stands on hard and soft 17 alike', () => {
        expect(dealerShouldHit([card('10'), card('7')])).toBe(false)
        expect(dealerShouldHit([card('A'), card('6')])).toBe(false)
    })
})

describe('settleHand', () => {
    const dealer = (ranks: LbRank[]) => ranks.map(r => card(r))

    it('pays a natural 3:2', () => {
        const result = settleHand(hand(['A', 'K']), dealer(['10', '9']))
        expect(result).toEqual({ status: 'blackjack', payout: 250, net: 150 })
    })

    it('pushes two naturals', () => {
        const result = settleHand(hand(['A', 'K']), dealer(['A', 'Q']))
        expect(result).toEqual({ status: 'push', payout: 100, net: 0 })
    })

    it('loses a non-natural 21 to a dealer natural', () => {
        const result = settleHand(hand(['7', '4', '10']), dealer(['A', 'Q']))
        expect(result).toEqual({ status: 'lost', payout: 0, net: -100 })
    })

    it('pays even money on a plain win', () => {
        expect(settleHand(hand(['10', '9']), dealer(['10', '8']))).toEqual({
            status: 'won', payout: 200, net: 100
        })
    })

    it('pays when the dealer busts', () => {
        expect(settleHand(hand(['10', '6']), dealer(['10', '6', '9']))).toEqual({
            status: 'won', payout: 200, net: 100
        })
    })

    it('loses a bust even against a dealer bust', () => {
        expect(settleHand(hand(['10', '6', '9']), dealer(['10', '6', '9']))).toEqual({
            status: 'busted', payout: 0, net: -100
        })
    })

    it('stakes twice on a doubled hand', () => {
        expect(settleHand(hand(['5', '6', '10'], { doubled: true }), dealer(['10', '8']))).toEqual({
            status: 'won', payout: 400, net: 200
        })
        expect(settleHand(hand(['5', '6', '2'], { doubled: true }), dealer(['10', '8']))).toEqual({
            status: 'lost', payout: 0, net: -200
        })
    })

    it('returns half the stake on a surrender', () => {
        expect(settleHand(hand(['10', '6'], { status: 'surrendered' }), dealer(['10', '9']))).toEqual({
            status: 'surrendered', payout: 50, net: -50
        })
    })

    it('keeps fractional payouts on the numeric(19,4) grid', () => {
        const result = settleHand(hand(['A', 'K'], { bet: 25 }), dealer(['10', '9']))
        expect(result.payout).toBe(62.5)
        expect(result.net).toBe(37.5)
    })

    it('survives a table-maximum stake without float drift', () => {
        const result = settleHand(hand(['A', 'K'], { bet: 100_000_000_000 }), dealer(['10', '9']))
        expect(result.payout).toBe(250_000_000_000)
        expect(result.net).toBe(150_000_000_000)
    })
})

describe('action availability', () => {
    it('doubles only on two cards', () => {
        expect(canDouble(hand(['5', '6']))).toBe(true)
        expect(canDouble(hand(['5', '6', '2']))).toBe(false)
        expect(canDouble(hand(['5', '6'], { doubled: true }))).toBe(false)
    })

    it('allows doubling after a split', () => {
        expect(canDouble(hand(['5', '6'], { fromSplit: true }))).toBe(true)
    })

    it('splits any equal-value pair', () => {
        expect(canSplit(hand(['8', '8']), [hand(['8', '8'])])).toBe(true)
        expect(canSplit(hand(['K', '10']), [hand(['K', '10'])])).toBe(true)
        expect(canSplit(hand(['9', '8']), [hand(['9', '8'])])).toBe(false)
    })

    it('keeps splitting past four hands, up to the table cap', () => {
        const four = Array.from({ length: 4 }, () => hand(['8', '8']))
        expect(canSplit(four[0]!, four)).toBe(true)

        const atCap = Array.from({ length: LB_RULES.maxHands }, () => hand(['8', '8']))
        expect(canSplit(atCap[0]!, atCap)).toBe(false)
    })

    it('resplits aces', () => {
        const split = hand(['A', 'A'], { fromSplit: true })
        expect(canSplit(split, [split, hand(['A', '5'])])).toBe(true)
    })

    it('surrenders any fresh two-card hand, including after a split', () => {
        expect(canSurrender(hand(['10', '6']), [hand(['10', '6'])])).toBe(true)
        expect(canSurrender(hand(['10', '6', '2']), [hand(['10', '6', '2'])])).toBe(false)
        const pair = hand(['8', '8'], { fromSplit: true })
        expect(canSurrender(pair, [pair, hand(['8', '3'])])).toBe(true)
    })

    it('doubles a split ace, which the one-card rule would forbid', () => {
        expect(canDouble(hand(['A', '7'], { fromSplit: true }))).toBe(true)
    })
})

describe('hiLoValue', () => {
    it('scores low cards up, tens and aces down, and the rest neutral', () => {
        expect([2, 3, 4, 5, 6].map(n => hiLoValue(String(n) as LbRank))).toEqual([1, 1, 1, 1, 1])
        expect([7, 8, 9].map(n => hiLoValue(String(n) as LbRank))).toEqual([0, 0, 0])
        expect(['10', 'J', 'Q', 'K', 'A'].map(r => hiLoValue(r as LbRank))).toEqual([-1, -1, -1, -1, -1])
    })

    it('balances to zero over a full deck', () => {
        const ranks: LbRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
        const deck = ranks.flatMap(r => [r, r, r, r])
        expect(deck.reduce((sum, r) => sum + hiLoValue(r), 0)).toBe(0)
    })
})

describe('chips', () => {
    it('breaks an amount down largest-denomination first', () => {
        expect(chipStack(1_625).map(c => c.value)).toEqual([1000, 500, 100, 25])
    })

    it('caps the stack rather than rendering hundreds of chips', () => {
        expect(chipStack(999_999, 5)).toHaveLength(5)
    })

    it('offers a rack a small bankroll can actually afford', () => {
        const rack = chipRackFor(3_000)
        expect(rack[rack.length - 1]!.value).toBe(5_000)
        expect(rack.some(c => c.value <= 3_000)).toBe(true)
    })

    it('moves the rack up for a billionaire', () => {
        const rack = chipRackFor(50_000_000_000)
        expect(rack[rack.length - 1]!.value).toBe(100_000_000_000)
        expect(rack[0]!.value).toBeGreaterThanOrEqual(5_000_000)
    })

    it('never leaves a chip without art or a label', () => {
        for (const chip of LB_CHIPS) {
            expect(chip.label).toBeTruthy()
            expect(chip.value).toBeGreaterThan(0)
        }
    })
})
