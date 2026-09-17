import { describe, expect, it } from 'vitest'
import { bestHand, compareHands, evaluateFive, rankValue } from '#shared/utils/casino-holdem/evaluator'
import type { ChCard } from '#shared/utils/casino-holdem/evaluator'
import type { LtRank, LtSuit } from '#shared/utils/live-table/types'

const SUITS: Record<string, LtSuit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }

/** "As Kh 10d 4c 2s" — rank then a one-letter suit. */
function cards(text: string): ChCard[] {
    return text.split(' ').map(token => ({
        rank: token.slice(0, -1) as LtRank,
        suit: SUITS[token.slice(-1)]!
    }))
}

const five = (text: string) => evaluateFive(cards(text))
const best = (text: string) => bestHand(cards(text))

describe('evaluateFive categories', () => {
    it('names a royal flush', () => {
        const hand = five('As Ks Qs Js 10s')
        expect(hand.category).toBe('royal-flush')
        expect(hand.label).toBe('Royal flush')
    })

    it('names a straight flush by its top card', () => {
        const hand = five('9h 8h 7h 6h 5h')
        expect(hand.category).toBe('straight-flush')
        expect(hand.tiebreak).toEqual([9])
        expect(hand.label).toBe('Straight flush, Nine high')
    })

    it('reads the steel wheel as a five-high straight flush, not a royal', () => {
        const hand = five('Ac 2c 3c 4c 5c')
        expect(hand.category).toBe('straight-flush')
        expect(hand.tiebreak).toEqual([5])
    })

    it('names four of a kind with its kicker', () => {
        const hand = five('7s 7h 7d 7c Kd')
        expect(hand.category).toBe('four-of-a-kind')
        expect(hand.tiebreak).toEqual([7, 13])
    })

    it('names a full house trips first', () => {
        const hand = five('4s 4h 4d 9c 9h')
        expect(hand.category).toBe('full-house')
        expect(hand.tiebreak).toEqual([4, 9])
        expect(hand.label).toBe('Full house, Fours full of Nines')
    })

    it('names a flush by every card in descending order', () => {
        const hand = five('Kd 10d 8d 4d 2d')
        expect(hand.category).toBe('flush')
        expect(hand.tiebreak).toEqual([13, 10, 8, 4, 2])
    })

    it('names a straight across suits', () => {
        const hand = five('10s 9h 8d 7c 6s')
        expect(hand.category).toBe('straight')
        expect(hand.tiebreak).toEqual([10])
    })

    it('reads the wheel as a five-high straight', () => {
        const hand = five('As 2h 3d 4c 5s')
        expect(hand.category).toBe('straight')
        expect(hand.tiebreak).toEqual([5])
        expect(hand.label).toBe('Straight, Five high')
    })

    it('does not read a king-high wrap-around as a straight', () => {
        const hand = five('Qs Ks Ah 2d 3c')
        expect(hand.category).toBe('high-card')
    })

    it('names three of a kind with both kickers', () => {
        const hand = five('Js Jh Jd 9c 3s')
        expect(hand.category).toBe('three-of-a-kind')
        expect(hand.tiebreak).toEqual([11, 9, 3])
    })

    it('names two pair high pair first', () => {
        const hand = five('5s 5h Ks Kh 2d')
        expect(hand.category).toBe('two-pair')
        expect(hand.tiebreak).toEqual([13, 5, 2])
        expect(hand.label).toBe('Two pair, Kings and Fives')
    })

    it('names a pair with three kickers', () => {
        const hand = five('As Ah Kd 7c 3s')
        expect(hand.category).toBe('pair')
        expect(hand.tiebreak).toEqual([14, 13, 7, 3])
        expect(hand.label).toBe('Pair of Aces, King kicker')
    })

    it('names a high card hand', () => {
        const hand = five('As Qh 9d 7c 3s')
        expect(hand.category).toBe('high-card')
        expect(hand.tiebreak).toEqual([14, 12, 9, 7, 3])
        expect(hand.label).toBe('Ace high')
    })

    it('refuses anything other than five cards', () => {
        expect(() => evaluateFive(cards('As Kh Qd'))).toThrow()
        expect(() => evaluateFive(cards('As Kh Qd Jc 9s 8h'))).toThrow()
    })
})

describe('compareHands', () => {
    it('ranks the categories in the standard order', () => {
        const ladder = [
            'As Qh 9d 7c 3s',
            '2s 2h 9d 7c 3s',
            '2s 2h 9d 9c 3s',
            '4s 4h 4d 9c 3s',
            '10s 9h 8d 7c 6s',
            'Kd 10d 8d 4d 2d',
            '4s 4h 4d 9c 9h',
            '7s 7h 7d 7c Kd',
            '9h 8h 7h 6h 5h',
            'As Ks Qs Js 10s'
        ].map(five)
        for (let i = 1; i < ladder.length; i++) {
            expect(compareHands(ladder[i]!, ladder[i - 1]!)).toBeGreaterThan(0)
        }
    })

    it('puts a flush above a straight', () => {
        expect(compareHands(five('2d 5d 8d 9d Kd'), five('10s 9h 8d 7c 6s'))).toBeGreaterThan(0)
    })

    it('separates equal pairs on the first kicker', () => {
        expect(compareHands(five('Ks Kh Ad 7c 3s'), five('Kd Kc Qh 7s 3d'))).toBeGreaterThan(0)
    })

    it('separates equal pairs on the last kicker', () => {
        expect(compareHands(five('Ks Kh Ad 7c 4s'), five('Kd Kc Ah 7s 3d'))).toBeGreaterThan(0)
    })

    it('separates two pair on the kicker', () => {
        expect(compareHands(five('Ks Kh 5d 5c Ad'), five('Kd Kc 5s 5h Qd'))).toBeGreaterThan(0)
    })

    it('puts a six-high straight above the wheel', () => {
        expect(compareHands(five('6s 5h 4d 3c 2s'), five('As 2h 3d 4c 5s'))).toBeGreaterThan(0)
    })

    it('calls hands of the same ranks in different suits a tie', () => {
        expect(compareHands(five('As Kh 9d 7c 3s'), five('Ad Kc 9h 7s 3d'))).toBe(0)
        expect(compareHands(five('8s 8h 4d 4c Ks'), five('8d 8c 4h 4s Kd'))).toBe(0)
    })
})

describe('bestHand over seven cards', () => {
    it('picks the flush out of a board that also makes a straight', () => {
        // Two hole cards, five board: 2d..Kd is a flush, 9-10-J-Q-K a straight.
        const hand = best('Kd 2d 10d Qd 9d Jc 10s')
        expect(hand.category).toBe('flush')
        expect(hand.tiebreak).toEqual([13, 12, 10, 9, 2])
    })

    it('picks the best five when seven cards make a full house two ways', () => {
        const hand = best('9s 9h 9d 4s 4h 4d 2c')
        expect(hand.category).toBe('full-house')
        expect(hand.tiebreak).toEqual([9, 4])
    })

    it('finds a straight that spans hole cards and board', () => {
        const hand = best('7h 8d 9s 10c Jh 2c 3d')
        expect(hand.category).toBe('straight')
        expect(hand.tiebreak).toEqual([11])
    })

    it('finds the wheel in seven cards', () => {
        const hand = best('Ah 2d 3s 4c 5h Kd Qc')
        expect(hand.category).toBe('straight')
        expect(hand.tiebreak).toEqual([5])
    })

    it('keeps the best kicker rather than the first one it sees', () => {
        const hand = best('As Ah 2c 5d 9h Kc 7s')
        expect(hand.category).toBe('pair')
        expect(hand.tiebreak).toEqual([14, 13, 9, 7])
    })

    it('takes quads plus the highest kicker', () => {
        const hand = best('6s 6h 6d 6c 2s 3h Ad')
        expect(hand.category).toBe('four-of-a-kind')
        expect(hand.tiebreak).toEqual([6, 14])
    })

    it('plays the board when the hole cards add nothing', () => {
        const hand = best('2c 3d As Ks Qs Js 10s')
        expect(hand.category).toBe('royal-flush')
    })

    it('refuses fewer than five cards', () => {
        expect(() => bestHand(cards('As Kh Qd Jc'))).toThrow()
    })
})

describe('rankValue', () => {
    it('runs two through ace with the ace high', () => {
        expect(rankValue('2')).toBe(2)
        expect(rankValue('10')).toBe(10)
        expect(rankValue('J')).toBe(11)
        expect(rankValue('A')).toBe(14)
    })
})
