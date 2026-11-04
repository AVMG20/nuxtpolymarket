import { describe, expect, it } from 'vitest'
import { getBet, ROULETTE_BETS, ROULETTE_PAYOUTS } from '#shared/utils/roulette/layout'

describe('ROULETTE_BETS catalog', () => {
    it('covers every pocket with exactly one straight bet', () => {
        for (let n = 0; n <= 36; n++) {
            expect(getBet(`straight:${n}`)).toEqual({ key: `straight:${n}`, type: 'straight', numbers: [n] })
        }
    })

    it('rejects a straight bet on a number the wheel does not have', () => {
        expect(getBet('straight:37')).toBeUndefined()
        expect(getBet('straight:-1')).toBeUndefined()
    })

    it('groups a street as the three numbers in one grid column', () => {
        const bet = getBet('street:1-2-3')
        expect(bet?.type).toBe('street')
        expect(bet?.numbers).toEqual([1, 2, 3])
    })

    it('builds exactly 22 corners, each covering four numbers', () => {
        const corners = [...ROULETTE_BETS.values()].filter(b => b.type === 'corner')
        expect(corners).toHaveLength(22)
        expect(corners.every(c => c.numbers.length === 4)).toBe(true)
    })

    it('builds exactly 11 six-number lines', () => {
        const lines = [...ROULETTE_BETS.values()].filter(b => b.type === 'line')
        expect(lines).toHaveLength(11)
        expect(lines.every(l => l.numbers.length === 6)).toBe(true)
    })

    it('splits the board into three columns of 12 numbers each', () => {
        for (let row = 0; row < 3; row++) {
            expect(getBet(`column:${row}`)?.numbers).toHaveLength(12)
        }
        const columns = [0, 1, 2].map(row => new Set(getBet(`column:${row}`)!.numbers))
        const union = new Set(columns.flatMap(c => [...c]))
        expect(union.size).toBe(36)
    })

    it('splits the board into three dozens of 12 consecutive numbers', () => {
        expect(getBet('dozen:0')!.numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
        expect(getBet('dozen:1')!.numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 13))
        expect(getBet('dozen:2')!.numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 25))
    })

    it('splits every non-zero number between red and black with no overlap', () => {
        const red = new Set(getBet('red')!.numbers)
        const black = new Set(getBet('black')!.numbers)
        expect(red.size + black.size).toBe(36)
        expect([...red].some(n => black.has(n))).toBe(false)
    })

    it('has a payout entry for every bet type it can produce', () => {
        for (const bet of ROULETTE_BETS.values()) {
            expect(ROULETTE_PAYOUTS[bet.type]).toBeGreaterThan(0)
        }
    })
})
