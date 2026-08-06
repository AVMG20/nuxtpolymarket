import { describe, expect, it } from 'vitest'
import { compareHands, dealerQualifies, evaluateHand } from '#shared/utils/three-card-poker/hand'
import { hand } from './cards'

const evaluate = (notation: string) => evaluateHand(hand(notation))
const beats = (a: string, b: string) => compareHands(evaluate(a), evaluate(b))

describe('evaluateHand', () => {
    it('reads a straight flush', () => {
        expect(evaluate('Qs Js 10s').category).toBe('straightFlush')
        expect(evaluate('Qs Js 10s').label).toBe('Straight flush, Queen high')
    })

    it('reads three of a kind', () => {
        expect(evaluate('7s 7h 7c').category).toBe('trips')
        expect(evaluate('7s 7h 7c').label).toBe('Three of a kind, Sevens')
    })

    it('reads a straight across mixed suits', () => {
        expect(evaluate('Qs Jh 10d').category).toBe('straight')
        expect(evaluate('Qs Jh 10d').label).toBe('Straight, Queen high')
    })

    it('reads a flush', () => {
        expect(evaluate('Kc 9c 4c').category).toBe('flush')
        expect(evaluate('Kc 9c 4c').label).toBe('Flush, King high')
    })

    it('reads a pair regardless of where the odd card falls', () => {
        expect(evaluate('7s 7h 3d').label).toBe('Pair of Sevens')
        expect(evaluate('3d 7s 7h').label).toBe('Pair of Sevens')
        expect(evaluate('Ks 3d 3h').label).toBe('Pair of Threes')
    })

    it('reads a high card hand', () => {
        expect(evaluate('As Kd 6c').category).toBe('highCard')
        expect(evaluate('As Kd 6c').label).toBe('Ace-King high')
    })

    it('plays the ace low in A-2-3, the lowest straight there is', () => {
        expect(evaluate('As 2h 3d').category).toBe('straight')
        expect(evaluate('As 2h 3d').label).toBe('Straight, Three high')
        expect(beats('2h 3d 4s', 'As 2h 3d')).toBeGreaterThan(0)
    })

    it('makes Q-K-A the highest straight', () => {
        expect(evaluate('Qs Kh Ad').category).toBe('straight')
        expect(evaluate('Qs Kh Ad').label).toBe('Straight, Ace high')
    })

    it('does not read a wrapped K-A-2 as a straight', () => {
        expect(evaluate('Ks Ah 2d').category).toBe('highCard')
    })

    it('reads A-2-3 in one suit as a straight flush', () => {
        expect(evaluate('Ac 2c 3c').category).toBe('straightFlush')
    })
})

describe('compareHands', () => {
    it('ranks a straight above a flush — the whole point of three-card ranking', () => {
        expect(beats('Qs Jh 10d', 'Kc 9c 4c')).toBeGreaterThan(0)
        expect(beats('2s 3h 4d', 'Ac Qc 9c')).toBeGreaterThan(0)
    })

    it('ranks the categories straight flush > trips > straight > flush > pair > high card', () => {
        expect(beats('Qs Js 10s', '7s 7h 7c')).toBeGreaterThan(0)
        expect(beats('7s 7h 7c', 'Qs Jh 10d')).toBeGreaterThan(0)
        expect(beats('Qs Jh 10d', 'Kc 9c 4c')).toBeGreaterThan(0)
        expect(beats('Kc 9c 4c', 'As Ah 2d')).toBeGreaterThan(0)
        expect(beats('2s 2h 3d', 'As Kd 9c')).toBeGreaterThan(0)
    })

    it('breaks a flush tie on the highest card, then the next', () => {
        expect(beats('Kc 9c 4c', 'Qc 10c 9c')).toBeGreaterThan(0)
        expect(beats('Kc 9c 4c', 'Kd 8d 7d')).toBeGreaterThan(0)
    })

    it('breaks a pair tie on the kicker', () => {
        expect(beats('7s 7h Kd', '7c 7d Qs')).toBeGreaterThan(0)
        expect(beats('8s 8h 2d', '7c 7d As')).toBeGreaterThan(0)
    })

    it('breaks a high-card tie on the second and third cards', () => {
        expect(beats('As Kd 6c', 'Ah Qd Jc')).toBeGreaterThan(0)
        expect(beats('As Kd 6c', 'Ah Kc 5s')).toBeGreaterThan(0)
    })

    it('calls hands of identical ranks a tie, whatever the suits', () => {
        expect(beats('As Kd 6c', 'Ah Kc 6s')).toBe(0)
        expect(beats('7s 7h 3d', '7c 7d 3s')).toBe(0)
        expect(beats('Qs Js 10s', 'Qh Jh 10h')).toBe(0)
    })
})

describe('dealerQualifies', () => {
    it('qualifies on exactly queen high', () => {
        expect(dealerQualifies(evaluate('Qs 3h 2d'))).toBe(true)
    })

    it('fails on jack high, one rank below the line', () => {
        expect(dealerQualifies(evaluate('Js 10h 8d'))).toBe(false)
    })

    it('qualifies on king and ace high', () => {
        expect(dealerQualifies(evaluate('Ks 3h 2d'))).toBe(true)
        expect(dealerQualifies(evaluate('As 3h 2d'))).toBe(true)
    })

    it('qualifies on any pair or better, however low', () => {
        expect(dealerQualifies(evaluate('2s 2h 3d'))).toBe(true)
        expect(dealerQualifies(evaluate('7c 4c 2c'))).toBe(true)
        expect(dealerQualifies(evaluate('As 2h 3d'))).toBe(true)
    })

    it('fails on the worst hand in the deck', () => {
        expect(dealerQualifies(evaluate('2s 3h 5d'))).toBe(false)
    })
})
