import { describe, it, expect, afterEach, vi } from 'vitest'
import { stubRandomFloat } from '../setup/stub-random'
import {
    playBookOfShadows,
    PAYTABLE,
    SYMBOL_WEIGHTS,
    BOS_MAX_WIN_MULT,
    BONUS_TRIGGER_COUNT,
    BONUS_SPINS,
    BONUS_RETRIGGER_SPINS,
    BONUS_TIERS,
    type SlotSymbol
} from '../../shared/utils/gamelogic/bookofshadows'

afterEach(() => {
    vi.restoreAllMocks()
})

// Deterministic source for the Monte-Carlo-style sweeps below — reproducible
// coverage of the RNG-heavy bonus simulation without real crypto's run-to-run
// variance.
function mulberry32(seed: number) {
    let a = seed
    return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// rand() reads crypto.getRandomValues into a length-1 Uint32Array (same
// pattern as playDice — see dice.spec.ts), so stubRandomFloat's packing pins
// it to within ~1e-9 of the fed value.
const TEN_VAL = 0 // lands in ten's [0, 26/132) weighted-pick bucket
const BOOK_VAL = 0.99 // lands in book's [130/132, 1) weighted-pick bucket

function bookThenTen(bookCount: number) {
    let i = 0
    return () => (i++ < bookCount ? BOOK_VAL : TEN_VAL)
}

describe('playBookOfShadows validation', () => {
    it('rejects a zero or negative bet', () => {
        expect(() => playBookOfShadows(0)).toThrow()
        expect(() => playBookOfShadows(-10)).toThrow()
    })

    it('rejects a non-finite bet', () => {
        expect(() => playBookOfShadows(NaN)).toThrow()
        expect(() => playBookOfShadows(Infinity)).toThrow()
    })
})

describe('PAYTABLE monotonicity', () => {
    it('pays strictly more for a longer connection, for every symbol', () => {
        for (const values of Object.values(PAYTABLE)) {
            expect(values[0]).toBeLessThan(values[1])
            expect(values[1]).toBeLessThan(values[2])
        }
    })

    it('never pays less for a more common symbol than a rarer one', () => {
        const rankedAscending = [
            ...(Object.keys(SYMBOL_WEIGHTS) as Exclude<SlotSymbol, 'bonuswild'>[])
                .sort((a, b) => SYMBOL_WEIGHTS[b] - SYMBOL_WEIGHTS[a]),
            'bonuswild' as const
        ]
        for (let length = 0; length < 3; length++) {
            for (let i = 1; i < rankedAscending.length; i++) {
                const prev = PAYTABLE[rankedAscending[i - 1]!]![length]!
                const cur = PAYTABLE[rankedAscending[i]!]![length]!
                expect(cur).toBeGreaterThanOrEqual(prev)
            }
        }
    })
})

describe('bonus trigger boundary', () => {
    it('does not trigger the bonus with one fewer than BONUS_TRIGGER_COUNT BOOK symbols', () => {
        stubRandomFloat(bookThenTen(BONUS_TRIGGER_COUNT - 1))
        const result = playBookOfShadows(100)
        expect(result.bonusTriggered).toBe(false)
        expect(result.bonus).toBeNull()
    })

    it('triggers the bonus at exactly BONUS_TRIGGER_COUNT BOOK symbols', () => {
        stubRandomFloat(bookThenTen(BONUS_TRIGGER_COUNT))
        const result = playBookOfShadows(100)
        expect(result.bonusTriggered).toBe(true)
        expect(result.bonus).not.toBeNull()
    })
})

describe('deterministic full-grid payout', () => {
    it('pays the length-5 rate when the whole grid lands one common symbol', () => {
        stubRandomFloat(() => TEN_VAL)
        const result = playBookOfShadows(100)
        expect(result.grid.flat().every(s => s === 'ten')).toBe(true)
        expect(result.bonusTriggered).toBe(false)
        expect(result.payout).toBeCloseTo(PAYTABLE.ten[2]! * 100, 6)
    })

    it('collapses wild-on-wild to a single scan and pays the book rate when the whole grid is BOOK', () => {
        stubRandomFloat(() => BOOK_VAL)
        const result = playBookOfShadows(100)
        expect(result.grid.flat().every(s => s === 'book')).toBe(true)
        expect(result.wins).toHaveLength(1)
        expect(result.wins[0]!.symbol).toBe('book')
        expect(result.basePayout).toBeCloseTo(PAYTABLE.book[2]! * 100, 6)
        expect(result.bonusTriggered).toBe(true)
    })
})

describe('max-win cap', () => {
    it('reports maxWin as bet times BOS_MAX_WIN_MULT', () => {
        expect(playBookOfShadows(50).maxWin).toBe(50 * BOS_MAX_WIN_MULT)
    })

    it('never pays out above maxWin, across a seeded sweep of buy-bonus rounds', () => {
        stubRandomFloat(mulberry32(1))
        for (let i = 0; i < 400; i++) {
            const result = playBookOfShadows(10, { buyBonus: true })
            expect(result.payout).toBeLessThanOrEqual(result.maxWin)
            expect(result.basePayout).toBeLessThanOrEqual(result.maxWin)
        }
    })
})

describe('RTP', () => {
    it('stays within a sane band over a seeded sample of base spins', () => {
        stubRandomFloat(mulberry32(7))
        const bet = 1
        const rounds = 4000
        let totalPayout = 0
        for (let i = 0; i < rounds; i++) totalPayout += playBookOfShadows(bet).payout
        const rtp = totalPayout / (rounds * bet)
        expect(rtp).toBeGreaterThan(0.3)
        expect(rtp).toBeLessThan(3)
    })
})

describe('bonus retrigger boundary', () => {
    it('extends totalSpins by BONUS_RETRIGGER_SPINS exactly once when it fires, and stops BOOK from landing afterwards', () => {
        stubRandomFloat(mulberry32(3))
        let sawRetrigger = false
        for (let i = 0; i < 300; i++) {
            const result = playBookOfShadows(1, { forceBonus: true })
            const bonus = result.bonus!
            expect(bonus.spins).toHaveLength(bonus.totalSpins)
            expect(bonus.totalSpins).toBe(bonus.retriggered ? BONUS_SPINS + BONUS_RETRIGGER_SPINS : BONUS_SPINS)
            expect(bonus.spins.filter(s => s.retriggered)).toHaveLength(bonus.retriggered ? 1 : 0)

            if (bonus.retriggered) {
                sawRetrigger = true
                const idx = bonus.spins.findIndex(s => s.retriggered)
                expect(bonus.spins.slice(idx + 1).every(s => s.booksLanded === 0)).toBe(true)
            }
        }
        expect(sawRetrigger).toBe(true) // sanity: the sample actually exercised the boundary
    })
})

describe('won flag', () => {
    it('compares payout against bet on a base spin', () => {
        stubRandomFloat(() => TEN_VAL)
        const result = playBookOfShadows(100)
        expect(result.won).toBe(result.payout > 100)
    })

    it('compares payout against the buy price, not zero, on a buy-bonus round', () => {
        stubRandomFloat(mulberry32(5))
        let sawUnderwaterRound = false
        for (let i = 0; i < 300; i++) {
            const result = playBookOfShadows(1, { buyBonus: true })
            expect(result.won).toBe(result.payout > result.cost!)
            if (result.payout > 0 && result.payout < result.cost!) sawUnderwaterRound = true
        }
        expect(sawUnderwaterRound).toBe(true)
    })

    it('does not report a win when a buy-bonus round pays less than it cost', () => {
        stubRandomFloat(mulberry32(5))
        const underwater = Array.from({ length: 300 }, () => playBookOfShadows(1, { buyBonus: true }))
            .filter(r => r.payout > 0 && r.payout < r.cost!)
        expect(underwater.length).toBeGreaterThan(0)
        expect(underwater.every(r => r.won === false)).toBe(true)
    })
})

describe('bonus tier payout formula', () => {
    it('scales only the wild portion by the rolled tier multiplier', () => {
        stubRandomFloat(mulberry32(11))
        for (let i = 0; i < 200; i++) {
            const result = playBookOfShadows(1, { forceBonus: true })
            const bonus = result.bonus!
            expect(BONUS_TIERS.some(t => t.id === bonus.tier.id)).toBe(true)
            expect(bonus.wildPayout).toBeCloseTo(bonus.wildBaseline * bonus.tier.multiplier, 4)
            expect(bonus.totalWin).toBeCloseTo(bonus.ordinaryPayout + bonus.wildPayout, 4)
        }
    })
})
