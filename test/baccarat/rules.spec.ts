import { describe, expect, it } from 'vitest'
import {
    bankerDraws,
    handTotal,
    isNatural,
    isPair,
    playerDraws,
    rankValue,
    winnerOf
} from '#shared/utils/baccarat/rules'
import type { LtCard, LtRank } from '#shared/utils/live-table/types'

function card(rank: LtRank): LtCard {
    return { id: `${rank}-${Math.random()}`, rank, suit: 'spades' }
}

describe('rankValue', () => {
    it('scores an ace as one', () => {
        expect(rankValue('A')).toBe(1)
    })

    it('scores tens and face cards as zero', () => {
        for (const rank of ['10', 'J', 'Q', 'K'] as LtRank[]) {
            expect(rankValue(rank)).toBe(0)
        }
    })

    it('scores number cards as their pip value', () => {
        for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9'] as LtRank[]) {
            expect(rankValue(rank)).toBe(Number(rank))
        }
    })
})

describe('handTotal', () => {
    it('sums pip values', () => {
        expect(handTotal([card('2'), card('3')])).toBe(5)
    })

    it('wraps at ten -- the only number baccarat ever shows', () => {
        expect(handTotal([card('9'), card('9')])).toBe(8)
        expect(handTotal([card('K'), card('K'), card('5')])).toBe(5)
    })

    it('treats a hidden or rankless card as worth nothing', () => {
        expect(handTotal([card('9'), { id: 'x', hidden: true }])).toBe(9)
    })
})

describe('isPair', () => {
    it('is true when the first two cards share a rank', () => {
        expect(isPair([card('7'), card('7'), card('2')])).toBe(true)
    })

    it('is false when they do not', () => {
        expect(isPair([card('7'), card('8')])).toBe(false)
    })

    it('is false with fewer than two cards', () => {
        expect(isPair([card('7')])).toBe(false)
        expect(isPair([])).toBe(false)
    })
})

describe('isNatural', () => {
    it('is true for an 8 or 9 on exactly two cards', () => {
        expect(isNatural([card('K'), card('8')])).toBe(true)
        expect(isNatural([card('4'), card('5')])).toBe(true)
    })

    it('is false once a third card has been drawn, even at the same total', () => {
        expect(isNatural([card('K'), card('8'), card('K')])).toBe(false)
    })

    it('is false under 8', () => {
        expect(isNatural([card('3'), card('4')])).toBe(false)
    })
})

describe('playerDraws', () => {
    it('draws on 0 through 5', () => {
        for (let total = 0; total <= 5; total++) expect(playerDraws(total)).toBe(true)
    })

    it('stands on 6 or 7', () => {
        expect(playerDraws(6)).toBe(false)
        expect(playerDraws(7)).toBe(false)
    })
})

describe('bankerDraws', () => {
    it('always draws on 0, 1 or 2, regardless of the player\'s third card', () => {
        for (const total of [0, 1, 2]) {
            expect(bankerDraws(total, null)).toBe(true)
            expect(bankerDraws(total, 0)).toBe(true)
            expect(bankerDraws(total, 9)).toBe(true)
        }
    })

    it('never draws on 7', () => {
        expect(bankerDraws(7, null)).toBe(false)
        expect(bankerDraws(7, 5)).toBe(false)
    })

    it('draws on 3 unless the player\'s third card was an 8', () => {
        for (let v = 0; v <= 9; v++) {
            expect(bankerDraws(3, v)).toBe(v !== 8)
        }
    })

    it('draws on 4 only for a player third card of 2 through 7', () => {
        const drawsOn = [2, 3, 4, 5, 6, 7]
        for (let v = 0; v <= 9; v++) {
            expect(bankerDraws(4, v)).toBe(drawsOn.includes(v))
        }
    })

    it('draws on 5 only for a player third card of 4 through 7', () => {
        const drawsOn = [4, 5, 6, 7]
        for (let v = 0; v <= 9; v++) {
            expect(bankerDraws(5, v)).toBe(drawsOn.includes(v))
        }
    })

    it('draws on 6 only for a player third card of 6 or 7', () => {
        for (let v = 0; v <= 9; v++) {
            expect(bankerDraws(6, v)).toBe(v === 6 || v === 7)
        }
    })

    it('when the player stood, draws exactly as the player would have', () => {
        for (let total = 0; total <= 5; total++) expect(bankerDraws(total, null)).toBe(true)
        expect(bankerDraws(6, null)).toBe(false)
        expect(bankerDraws(7, null)).toBe(false)
    })
})

describe('winnerOf', () => {
    it('picks the higher total', () => {
        expect(winnerOf(8, 5)).toBe('player')
        expect(winnerOf(5, 8)).toBe('banker')
    })

    it('is a tie on equal totals', () => {
        expect(winnerOf(6, 6)).toBe('tie')
    })
})
