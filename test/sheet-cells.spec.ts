import { describe, expect, it } from 'vitest'
import { choiceEditor, numberEditor, sheetHeads, stakeEditor } from '../app/utils/sheet-cells'
import type { SheetCells } from '../app/utils/sheet'
import { CASINO_MAX_BET } from '#shared/utils/limits'
import { DICE_MAX_CHANCE, DICE_MIN_CHANCE, diceMultiplier, playDice } from '#shared/utils/gamelogic/dice'
import { LIMBO_MAX_TARGET, LIMBO_MIN_TARGET, limboWinChance, playLimbo } from '#shared/utils/gamelogic/limbo'
import { gemDefaultPrice } from '#shared/utils/gamelogic/gem-exchange'

describe('sheet cell editors', () => {
    it('takes coin shorthand within the stake limit', () => {
        let stake = 0
        const edit = stakeEditor(n => stake = n)
        expect(edit('2.5k')).toBeUndefined()
        expect(stake).toBe(2500)
        expect(edit('0')).toMatch(/between 1 and/)
        expect(edit(String(CASINO_MAX_BET + 1))).toMatch(/between 1 and/)
        expect(stake).toBe(2500)
    })

    it('rejects numbers outside the range', () => {
        let value = 0
        const edit = numberEditor(n => value = n, DICE_MIN_CHANCE, DICE_MAX_CHANCE)
        expect(edit('50%')).toBeUndefined()
        expect(value).toBe(50)
        expect(edit('97')).toBe(`Input must be a number between ${DICE_MIN_CHANCE} and ${DICE_MAX_CHANCE}.`)
        expect(edit('abc')).toBeDefined()
    })

    it('matches dropdown labels case-insensitively', () => {
        let side = ''
        const edit = choiceEditor({ buy: 'Buy', sell: 'Sell' }, key => side = key)
        expect(edit(' sell ')).toBeUndefined()
        expect(side).toBe('sell')
        expect(edit('Hold')).toBe('Input must be an item on the specified list.')
    })

    it('writes a header row from a column', () => {
        const cells: SheetCells = {}
        sheetHeads(cells, 4, ['Price', 'Gems'], 3)
        expect(cells.D5?.v).toBe('Price')
        expect(cells.E5?.bold).toBe(true)
    })
})

describe('casino rules shared with the sheet', () => {
    it('accepts exactly the dice and limbo ranges the sheet allows', () => {
        expect(() => playDice(1, { winChance: DICE_MIN_CHANCE })).not.toThrow()
        expect(() => playDice(1, { winChance: DICE_MAX_CHANCE })).not.toThrow()
        expect(() => playDice(1, { winChance: DICE_MAX_CHANCE + 0.1 })).toThrow()
        expect(() => playLimbo(1, { target: LIMBO_MIN_TARGET })).not.toThrow()
        expect(() => playLimbo(1, { target: LIMBO_MAX_TARGET })).not.toThrow()
        expect(() => playLimbo(1, { target: LIMBO_MIN_TARGET - 0.01 })).toThrow()
    })

    it('prices dice and limbo at a 2% edge', () => {
        expect(diceMultiplier(49)).toBe(2)
        expect(limboWinChance(2)).toBeCloseTo(0.49)
        expect(limboWinChance(0.5)).toBe(0.98)
    })
})

describe('gem offer default price', () => {
    const book = { bestBid: 290.004, bestAsk: 310.126, guidePrice: 300 }

    it('starts at the price that trades right now', () => {
        expect(gemDefaultPrice('buy', book)).toBe(310.13)
        expect(gemDefaultPrice('sell', book)).toBe(290)
    })

    it('falls back to the guide price on an empty side', () => {
        expect(gemDefaultPrice('buy', { ...book, bestAsk: null })).toBe(300)
    })
})
