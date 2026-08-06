import { describe, expect, it } from 'vitest'
import { evaluateHand } from '#shared/utils/three-card-poker/hand'
import {
    TCP_ANTE_BONUS_PAYS,
    TCP_PAIR_PLUS_PAYS,
    anteBonusTier,
    pairPlusTier,
    resolveHand
} from '#shared/utils/three-card-poker/payouts'
import { shouldPlay } from '#shared/utils/three-card-poker/strategy'
import { hand } from './cards'

const evaluate = (notation: string) => evaluateHand(hand(notation))

function resolve(
    player: string,
    dealer: string,
    bets: { ante?: number, pairPlus?: number, played?: boolean } = {}
) {
    return resolveHand(
        { ante: bets.ante ?? 100, pairPlus: bets.pairPlus ?? 0, played: bets.played ?? true },
        evaluate(player),
        evaluate(dealer)
    )
}

const NO_QUALIFY = 'Js 9h 4d'
const QUEEN_HIGH = 'Qs 3h 2d'

describe('resolveHand — dealer does not qualify', () => {
    it('pays the ante even money and pushes the play bet', () => {
        const result = resolve('As Kd 6c', NO_QUALIFY)

        expect(result.dealerQualified).toBe(false)
        expect(result.ante).toBe('win')
        expect(result.play).toBe('push')
        expect(result.staked).toBe(200)
        expect(result.payout).toBe(300)
        expect(result.net).toBe(100)
    })

    it('pays it even to a hand that would have lost the showdown', () => {
        const result = resolve('2s 3h 5d', NO_QUALIFY)

        expect(result.net).toBe(100)
    })
})

describe('resolveHand — dealer qualifies', () => {
    it('pays ante and play even money on a win', () => {
        const result = resolve('As Kd 6c', QUEEN_HIGH)

        expect(result.dealerQualified).toBe(true)
        expect(result.ante).toBe('win')
        expect(result.play).toBe('win')
        expect(result.staked).toBe(200)
        expect(result.payout).toBe(400)
        expect(result.net).toBe(200)
    })

    it('takes both bets on a loss', () => {
        const result = resolve('Qs 2h 3d', 'Ks 4h 2d')

        expect(result.ante).toBe('lose')
        expect(result.play).toBe('lose')
        expect(result.payout).toBe(0)
        expect(result.net).toBe(-200)
    })

    it('pushes both bets on an exact tie', () => {
        const result = resolve('As Kd 6c', 'Ah Kc 6s')

        expect(result.ante).toBe('push')
        expect(result.play).toBe('push')
        expect(result.payout).toBe(200)
        expect(result.net).toBe(0)
    })

    it('beats a dealer flush with a player straight', () => {
        const result = resolve('Qs Jh 10d', 'Kc 9c 4c')

        expect(result.ante).toBe('win')
        expect(result.net).toBe(200 + TCP_ANTE_BONUS_PAYS.straight * 100)
    })
})

describe('resolveHand — ante bonus', () => {
    it('pays a straight, three of a kind and a straight flush off the ante', () => {
        expect(resolve('Qs Jh 10d', QUEEN_HIGH).anteBonusPayout).toBe(100 * TCP_ANTE_BONUS_PAYS.straight)
        expect(resolve('7s 7h 7c', QUEEN_HIGH).anteBonusPayout).toBe(100 * TCP_ANTE_BONUS_PAYS.trips)
        expect(resolve('Qs Js 10s', QUEEN_HIGH).anteBonusPayout).toBe(100 * TCP_ANTE_BONUS_PAYS.straightFlush)
    })

    it('pays nothing on a flush, a pair or a high card', () => {
        expect(resolve('Kc 9c 4c', QUEEN_HIGH).anteBonusPayout).toBe(0)
        expect(resolve('7s 7h 3d', QUEEN_HIGH).anteBonusPayout).toBe(0)
        expect(resolve('As Kd 6c', QUEEN_HIGH).anteBonusPayout).toBe(0)
    })

    it('pays even when the dealer wins the hand', () => {
        // Both hold a straight; the dealer's is higher, so ante and play are lost
        // and the bonus is the only thing that comes back.
        const result = resolve('4s 5h 6d', 'Qs Jh 10d')

        expect(result.ante).toBe('lose')
        expect(result.payout).toBe(100 * TCP_ANTE_BONUS_PAYS.straight)
        expect(result.net).toBe(-100)
    })

    it('is forfeited along with the ante when the seat folds', () => {
        const result = resolve('Qs Js 10s', QUEEN_HIGH, { played: false })

        expect(result.anteBonusTier).toBeNull()
        expect(result.anteBonusPayout).toBe(0)
    })

    it('reads the tier off the hand', () => {
        expect(anteBonusTier(evaluate('Qs Js 10s'))).toBe('straightFlush')
        expect(anteBonusTier(evaluate('7s 7h 7c'))).toBe('trips')
        expect(anteBonusTier(evaluate('Qs Jh 10d'))).toBe('straight')
        expect(anteBonusTier(evaluate('Kc 9c 4c'))).toBeNull()
    })
})

describe('resolveHand — pair plus', () => {
    it('pays every tier off the player hand alone', () => {
        const pays = (player: string) => resolve(player, QUEEN_HIGH, { pairPlus: 50 }).pairPlusPayout

        expect(pays('7s 7h 3d')).toBe(50 * (1 + TCP_PAIR_PLUS_PAYS.pair))
        expect(pays('Kc 9c 4c')).toBe(50 * (1 + TCP_PAIR_PLUS_PAYS.flush))
        expect(pays('Qs Jh 10d')).toBe(50 * (1 + TCP_PAIR_PLUS_PAYS.straight))
        expect(pays('7s 7h 7c')).toBe(50 * (1 + TCP_PAIR_PLUS_PAYS.trips))
        expect(pays('Qs Js 10s')).toBe(50 * (1 + TCP_PAIR_PLUS_PAYS.straightFlush))
    })

    it('loses on a high card hand', () => {
        const result = resolve('As Kd 6c', QUEEN_HIGH, { pairPlus: 50 })

        expect(result.pairPlusTier).toBeNull()
        expect(result.pairPlusPayout).toBe(0)
    })

    it('pays a folded seat exactly as it pays a played one', () => {
        const played = resolve('7s 7h 3d', 'As Kd 2c', { pairPlus: 50, played: true })
        const folded = resolve('7s 7h 3d', 'As Kd 2c', { pairPlus: 50, played: false })

        expect(folded.pairPlusPayout).toBe(played.pairPlusPayout)
    })

    it('never looks at the dealer', () => {
        const strong = resolve('7s 7h 3d', 'As Ah Ad', { pairPlus: 50 })
        const weak = resolve('7s 7h 3d', NO_QUALIFY, { pairPlus: 50 })

        expect(strong.pairPlusPayout).toBe(weak.pairPlusPayout)
    })

    it('reads the tier off the hand', () => {
        expect(pairPlusTier(evaluate('7s 7h 3d'))).toBe('pair')
        expect(pairPlusTier(evaluate('As Kd 6c'))).toBeNull()
    })
})

describe('resolveHand — folding', () => {
    it('stakes only the ante and pair plus, and returns nothing on a bare high card', () => {
        const result = resolve('As Kd 6c', QUEEN_HIGH, { pairPlus: 50, played: false })

        expect(result.ante).toBe('fold')
        expect(result.play).toBe('none')
        expect(result.staked).toBe(150)
        expect(result.payout).toBe(0)
        expect(result.net).toBe(-150)
    })

    it('can still come out ahead when pair plus lands', () => {
        const result = resolve('Qs Js 10s', QUEEN_HIGH, { pairPlus: 50, played: false })

        expect(result.payout).toBe(50 * (1 + TCP_PAIR_PLUS_PAYS.straightFlush))
        expect(result.net).toBe(50 * (1 + TCP_PAIR_PLUS_PAYS.straightFlush) - 150)
    })
})

describe('shouldPlay', () => {
    it('plays exactly Q-6-4', () => {
        expect(shouldPlay(hand('Qs 6h 4c'))).toBe(true)
    })

    it('folds the rank below it', () => {
        expect(shouldPlay(hand('Qs 6h 3c'))).toBe(false)
        expect(shouldPlay(hand('Qs 5h 2c'))).toBe(false)
    })

    it('plays anything ace or king high', () => {
        expect(shouldPlay(hand('As 3h 2c'))).toBe(true)
        expect(shouldPlay(hand('Ks 3h 2c'))).toBe(true)
    })

    it('folds jack high and below', () => {
        expect(shouldPlay(hand('Js 10h 8c'))).toBe(false)
        expect(shouldPlay(hand('7s 5h 3c'))).toBe(false)
    })

    it('plays every made hand', () => {
        expect(shouldPlay(hand('2s 2h 3c'))).toBe(true)
        expect(shouldPlay(hand('7c 5c 2c'))).toBe(true)
        expect(shouldPlay(hand('2s 3h 4c'))).toBe(true)
    })
})
