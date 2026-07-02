import { describe, it, expect } from 'vitest'
import {
    LOOTBOX_REWARDS,
    lootboxGemCount
} from '../../shared/utils/miner-config'

describe('lootboxGemCount', () => {
    it('scales gem rewards by factory level and rarity', () => {
        const common = LOOTBOX_REWARDS.find(r => r.id === 'gems-1')!
        const legendary = LOOTBOX_REWARDS.find(r => r.id === 'gems-10')!

        expect(lootboxGemCount(common, 20)).toBe(5)
        expect(lootboxGemCount(legendary, 20)).toBe(30)
    })
})
