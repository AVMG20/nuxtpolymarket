import { describe, expect, it } from 'vitest'
import {
    isBetSpot,
    LB_21P3_PAYS,
    LB_PERFECT_PAIRS_PAYS,
    perfectPairsTier,
    settleSideBets,
    twentyOnePlusThreeTier
} from '#shared/utils/live-blackjack/sidebets'
import type { LbCard, LbRank, LbSuit } from '#shared/utils/live-blackjack/types'

let seq = 0
const card = (rank: LbRank, suit: LbSuit): LbCard => ({ id: `c${++seq}`, rank, suit })

describe('perfectPairsTier', () => {
    it('pays perfect on the same rank and suit', () => {
        expect(perfectPairsTier(card('8', 'hearts'), card('8', 'hearts'))).toBe('perfect')
    })

    it('pays coloured on the same rank and colour but a different suit', () => {
        expect(perfectPairsTier(card('K', 'hearts'), card('K', 'diamonds'))).toBe('coloured')
        expect(perfectPairsTier(card('K', 'clubs'), card('K', 'spades'))).toBe('coloured')
    })

    it('pays mixed on the same rank across colours', () => {
        expect(perfectPairsTier(card('4', 'hearts'), card('4', 'clubs'))).toBe('mixed')
    })

    it('does not pay on ten-valued cards of different rank', () => {
        expect(perfectPairsTier(card('10', 'hearts'), card('K', 'hearts'))).toBeNull()
    })
})

describe('twentyOnePlusThreeTier', () => {
    const up = (rank: LbRank, suit: LbSuit) => card(rank, suit)

    it('ranks suited trips above a straight flush', () => {
        expect(twentyOnePlusThreeTier(
            card('7', 'clubs'), card('7', 'clubs'), up('7', 'clubs')
        )).toBe('suitedTrips')
    })

    it('finds a straight flush', () => {
        expect(twentyOnePlusThreeTier(
            card('5', 'spades'), card('6', 'spades'), up('7', 'spades')
        )).toBe('straightFlush')
    })

    it('finds three of a kind across suits', () => {
        expect(twentyOnePlusThreeTier(
            card('9', 'hearts'), card('9', 'clubs'), up('9', 'spades')
        )).toBe('trips')
    })

    it('plays the ace low in A-2-3 and high in Q-K-A', () => {
        expect(twentyOnePlusThreeTier(
            card('A', 'hearts'), card('2', 'clubs'), up('3', 'spades')
        )).toBe('straight')
        expect(twentyOnePlusThreeTier(
            card('Q', 'hearts'), card('K', 'clubs'), up('A', 'spades')
        )).toBe('straight')
    })

    it('does not wrap a straight around the ace', () => {
        expect(twentyOnePlusThreeTier(
            card('K', 'hearts'), card('A', 'clubs'), up('2', 'spades')
        )).toBeNull()
    })

    it('finds a plain flush', () => {
        expect(twentyOnePlusThreeTier(
            card('2', 'diamonds'), card('7', 'diamonds'), up('J', 'diamonds')
        )).toBe('flush')
    })

    it('pays nothing on an unrelated three', () => {
        expect(twentyOnePlusThreeTier(
            card('2', 'diamonds'), card('7', 'clubs'), up('J', 'spades')
        )).toBeNull()
    })
})

describe('isBetSpot', () => {
    it('accepts the three real spots', () => {
        expect(isBetSpot('main')).toBe(true)
        expect(isBetSpot('perfectPairs')).toBe(true)
        expect(isBetSpot('twentyOnePlusThree')).toBe(true)
    })

    it('rejects anything else a socket might send', () => {
        for (const junk of ['HACKED', '__proto__', 'constructor', 'toString', '', 'Main', null, undefined, 7, {}]) {
            expect(isBetSpot(junk)).toBe(false)
        }
    })
})

describe('settleSideBets', () => {
    it('returns stake plus winnings on a hit', () => {
        const [pp] = settleSideBets(
            { perfectPairs: 100, twentyOnePlusThree: 0 },
            [card('8', 'hearts'), card('8', 'hearts')],
            card('2', 'clubs')
        )
        expect(pp!.payout).toBe(100 * (1 + LB_PERFECT_PAIRS_PAYS.perfect))
        expect(pp!.label).toBe('Perfect pair')
    })

    it('pays nothing on a spot that was never backed', () => {
        const [, tp] = settleSideBets(
            { perfectPairs: 100, twentyOnePlusThree: 0 },
            [card('5', 'spades'), card('6', 'spades')],
            card('7', 'spades')
        )
        expect(tp!.tier).toBe('straightFlush')
        expect(tp!.payout).toBe(0)
    })

    it('settles both spots independently of each other', () => {
        const [pp, tp] = settleSideBets(
            { perfectPairs: 50, twentyOnePlusThree: 50 },
            [card('9', 'hearts'), card('9', 'clubs')],
            card('9', 'spades')
        )
        expect(pp!.payout).toBe(50 * (1 + LB_PERFECT_PAIRS_PAYS.mixed))
        expect(tp!.payout).toBe(50 * (1 + LB_21P3_PAYS.trips))
    })
})
