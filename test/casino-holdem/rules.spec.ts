import { describe, expect, it } from 'vitest'
import { evaluateFive } from '#shared/utils/casino-holdem/evaluator'
import type { ChCard } from '#shared/utils/casino-holdem/evaluator'
import {
    aaPayMultiplier,
    antePayMultiplier,
    dealerQualifies,
    resolveSeat
} from '#shared/utils/casino-holdem/rules'
import { shouldCall } from '#shared/utils/casino-holdem/strategy'
import type { LtRank, LtSuit } from '#shared/utils/live-table/types'

const SUITS: Record<string, LtSuit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }

function cards(text: string): ChCard[] {
    return text.split(' ').map(token => ({
        rank: token.slice(0, -1) as LtRank,
        suit: SUITS[token.slice(-1)]!
    }))
}

const five = (text: string) => evaluateFive(cards(text))

const ROYAL = five('As Ks Qs Js 10s')
const STRAIGHT_FLUSH = five('9h 8h 7h 6h 5h')
const QUADS = five('7s 7h 7d 7c Kd')
const BOAT = five('4s 4h 4d 9c 9h')
const FLUSH = five('Kd 10d 8d 4d 2d')
const STRAIGHT = five('10s 9h 8d 7c 6s')
const TRIPS = five('Js Jh Jd 9c 3s')
const TWO_PAIR = five('5s 5h Ks Kh 2d')
const ACES = five('As Ah Kd 7c 3s')
const FOURS = five('4s 4h Kd 7c 3s')
const THREES = five('3s 3h Kd 7c 2s')
const HIGH = five('As Qh 9d 7c 3s')

describe('dealerQualifies', () => {
    it('qualifies on exactly a pair of fours', () => {
        expect(dealerQualifies(FOURS)).toBe(true)
    })

    it('does not qualify on a pair of threes', () => {
        expect(dealerQualifies(THREES)).toBe(false)
    })

    it('does not qualify on a pair of twos', () => {
        expect(dealerQualifies(five('2s 2h Ad Kc Qs'))).toBe(false)
    })

    it('does not qualify on ace high', () => {
        expect(dealerQualifies(HIGH)).toBe(false)
    })

    it('qualifies on anything above a pair', () => {
        for (const hand of [TWO_PAIR, TRIPS, STRAIGHT, FLUSH, BOAT, QUADS, STRAIGHT_FLUSH, ROYAL]) {
            expect(dealerQualifies(hand)).toBe(true)
        }
    })
})

describe('antePayMultiplier', () => {
    it('pays the scale from pair-or-less up to a royal', () => {
        expect(antePayMultiplier(HIGH)).toBe(1)
        expect(antePayMultiplier(ACES)).toBe(1)
        expect(antePayMultiplier(TWO_PAIR)).toBe(1)
        expect(antePayMultiplier(TRIPS)).toBe(1)
        expect(antePayMultiplier(STRAIGHT)).toBe(1)
        expect(antePayMultiplier(FLUSH)).toBe(2)
        expect(antePayMultiplier(BOAT)).toBe(3)
        expect(antePayMultiplier(QUADS)).toBe(10)
        expect(antePayMultiplier(STRAIGHT_FLUSH)).toBe(20)
        expect(antePayMultiplier(ROYAL)).toBe(100)
    })
})

describe('aaPayMultiplier', () => {
    it('starts at a pair of aces', () => {
        expect(aaPayMultiplier(ACES)).toBe(7)
        expect(aaPayMultiplier(five('Ks Kh Ad 7c 3s'))).toBe(0)
        expect(aaPayMultiplier(HIGH)).toBe(0)
    })

    it('pays the ladder above that', () => {
        expect(aaPayMultiplier(TWO_PAIR)).toBe(7)
        expect(aaPayMultiplier(TRIPS)).toBe(7)
        expect(aaPayMultiplier(STRAIGHT)).toBe(7)
        expect(aaPayMultiplier(FLUSH)).toBe(20)
        expect(aaPayMultiplier(BOAT)).toBe(30)
        expect(aaPayMultiplier(QUADS)).toBe(40)
        expect(aaPayMultiplier(STRAIGHT_FLUSH)).toBe(50)
        expect(aaPayMultiplier(ROYAL)).toBe(100)
    })
})

describe('resolveSeat', () => {
    const bets = { ante: 100, call: 200, aa: 0 }

    it('pays the ante scale and even money on the call when the player beats a qualified dealer', () => {
        const result = resolveSeat(bets, { folded: false, player: ACES, dealer: FOURS, aa: null })
        expect(result.outcome).toBe('win')
        expect(result.dealerQualified).toBe(true)
        expect(result.anteReturn).toBe(200)
        expect(result.callReturn).toBe(400)
        expect(result.payout).toBe(600)
        expect(result.net).toBe(300)
    })

    it('pays the ante scale up for a bigger hand', () => {
        const result = resolveSeat(bets, { folded: false, player: BOAT, dealer: FOURS, aa: null })
        expect(result.anteMultiplier).toBe(3)
        expect(result.anteReturn).toBe(400)
        expect(result.callReturn).toBe(400)
        expect(result.net).toBe(500)
    })

    it('takes both bets when a qualified dealer wins', () => {
        const result = resolveSeat(bets, { folded: false, player: THREES, dealer: TRIPS, aa: null })
        expect(result.outcome).toBe('lose')
        expect(result.payout).toBe(0)
        expect(result.net).toBe(-300)
    })

    it('pushes both bets on an equal hand', () => {
        const tie = five('Ad Ac Kh 7s 3d')
        const result = resolveSeat(bets, { folded: false, player: ACES, dealer: tie, aa: null })
        expect(result.outcome).toBe('push')
        expect(result.anteReturn).toBe(100)
        expect(result.callReturn).toBe(200)
        expect(result.net).toBe(0)
    })

    it('pays the ante and pushes the call when the dealer does not qualify', () => {
        const result = resolveSeat(bets, { folded: false, player: THREES, dealer: HIGH, aa: null })
        expect(result.outcome).toBe('win')
        expect(result.dealerQualified).toBe(false)
        expect(result.anteReturn).toBe(200)
        expect(result.callReturn).toBe(200)
        expect(result.net).toBe(100)
    })

    it('pays a non-qualifying dealer even when the player would have lost the comparison', () => {
        // Ace high beats the player's king high, but the dealer never qualified.
        const player = five('Ks Qh 9d 7c 3s')
        const result = resolveSeat(bets, { folded: false, player, dealer: HIGH, aa: null })
        expect(result.outcome).toBe('win')
        expect(result.net).toBe(100)
    })

    it('pays a non-qualifying dealer on the full ante scale', () => {
        const result = resolveSeat(bets, { folded: false, player: QUADS, dealer: HIGH, aa: null })
        expect(result.anteReturn).toBe(1100)
        expect(result.callReturn).toBe(200)
        expect(result.net).toBe(1000)
    })

    it('forfeits the ante on a fold and stakes no call bet', () => {
        const result = resolveSeat({ ante: 100, call: 0, aa: 0 }, {
            folded: true,
            player: null,
            dealer: TRIPS,
            aa: null
        })
        expect(result.outcome).toBe('folded')
        expect(result.staked).toBe(100)
        expect(result.payout).toBe(0)
        expect(result.net).toBe(-100)
    })

    it('settles the AA bonus off the flop, so a fold cannot take it away', () => {
        const result = resolveSeat({ ante: 100, call: 0, aa: 50 }, {
            folded: true,
            player: null,
            dealer: TRIPS,
            aa: ACES
        })
        expect(result.aaMultiplier).toBe(7)
        expect(result.aaReturn).toBe(400)
        expect(result.staked).toBe(150)
        expect(result.net).toBe(250)
    })

    it('loses only the AA stake when the flop misses', () => {
        const result = resolveSeat({ ante: 100, call: 200, aa: 50 }, {
            folded: false,
            player: ACES,
            dealer: FOURS,
            aa: HIGH
        })
        expect(result.aaReturn).toBe(0)
        expect(result.staked).toBe(350)
        expect(result.payout).toBe(600)
        expect(result.net).toBe(250)
    })

    it('pays nothing on the AA leg when no bonus was staked', () => {
        const result = resolveSeat(bets, { folded: false, player: ACES, dealer: FOURS, aa: ACES })
        expect(result.aaMultiplier).toBe(0)
        expect(result.aaReturn).toBe(0)
    })
})

describe('shouldCall', () => {
    const hole = (text: string) => cards(text)

    it('calls with a pocket pair', () => {
        expect(shouldCall(hole('7s 7h'), cards('Ad Kc 2s'))).toBe(true)
    })

    it('calls when a hole card pairs the board', () => {
        expect(shouldCall(hole('6s 3h'), cards('6d Kc 2s'))).toBe(true)
    })

    it('calls with any ace', () => {
        expect(shouldCall(hole('As 3h'), cards('Kd 9c 5s'))).toBe(true)
    })

    it('calls on a four-flush that uses a hole card', () => {
        expect(shouldCall(hole('9d 4d'), cards('Kd 7d 2s'))).toBe(true)
    })

    it('calls on an open-ended draw', () => {
        expect(shouldCall(hole('9c 8h'), cards('7d 6s 2c'))).toBe(true)
    })

    it('folds a hand with nothing at all', () => {
        expect(shouldCall(hole('7c 2h'), cards('Kd 9s 8d'))).toBe(false)
    })

    it('ignores a flush draw the board makes without the hole cards', () => {
        expect(shouldCall(hole('7c 2h'), cards('Kd 9d 8d'))).toBe(false)
    })
})
