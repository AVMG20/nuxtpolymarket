import { describe, expect, it } from 'vitest'
import { botDrawing, ncPayout } from '#shared/utils/neighcasso/bots'
import { parseDrawing } from '#shared/utils/neighcasso/drawing'
import { NC_BOT_FEE } from '#shared/utils/neighcasso/types'

describe('bots', () => {
    it('returns 99% of every bet however many bots race', () => {
        for (const bots of [1, 2, 3, 4, 5]) {
            const bet = 100
            const pot = bet * (bots + 1)
            // Chance of winning is the bet's share of the pot.
            const rtp = (bet / pot) * ncPayout(pot, true) / bet
            expect(rtp).toBeCloseTo(1 - NC_BOT_FEE, 10)
        }
        expect(ncPayout(1000, false)).toBe(1000)
    })

    it('draws the same valid robot for a seed', () => {
        expect(botDrawing(42)).toEqual(botDrawing(42))
        for (let seed = 0; seed < 50; seed++) expect(parseDrawing(botDrawing(seed))).toEqual(botDrawing(seed))
    })
})
