import { describe, it, expect } from 'vitest'
import {
    LOOTBOX_REWARDS,
    lootboxExpectedValue,
    lootboxOpenPrice,
    lootboxRoll
} from '../../shared/utils/miner-config'

describe('lootboxes', () => {
    it('only contains cash rewards', () => {
        expect(LOOTBOX_REWARDS).toHaveLength(7)
        expect(LOOTBOX_REWARDS.every(reward => reward.id.startsWith('cash-'))).toBe(true)
    })

    it('only rolls cash rewards', () => {
        for (let index = 0; index < 100; index++) {
            expect(lootboxRoll().id).toMatch(/^cash-/)
        }
    })

    it('calculates paid opens from cash-only expected value', () => {
        const expectedValue = lootboxExpectedValue(1_000)
        expect(expectedValue).toBeGreaterThan(0)
        expect(lootboxOpenPrice(1_000)).toBeGreaterThan(expectedValue)
    })
})
