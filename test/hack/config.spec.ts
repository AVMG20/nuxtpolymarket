import { describe, it, expect, afterEach, vi } from 'vitest'
import { stubRandomFloat } from '../setup/stub-random'
import {
    OP_TEMPLATES,
    ITEM_MAX_LEVEL,
    ITEM_BULK_UPGRADE_LEVELS,
    MAX_TOTAL_SPEED,
    MOD_RANGES,
    RARITY_MOD_COUNT,
    itemUpgradeCost,
    itemUpgradeCostForLevels,
    itemBulkUpgradeLevels,
    rerollCost,
    rerollItemMods,
    generateItem,
    agentPower,
    effectiveDurationMs,
    opSuccessChance,
    MIN_DEPLOY_SUCCESS,
    effectiveItemDropChance,
    collectBonuses,
    rollOpReward,
    rollRarity,
    type ItemMod,
    type HackRarity,
    type AgentClass
} from '../../shared/utils/hack-config'

const OP = OP_TEMPLATES.find(t => t.id === 'port_scan')!

afterEach(() => {
    vi.restoreAllMocks()
})

describe('itemUpgradeCost ladder', () => {
    it('sums the per-level cost across a multi-level buy', () => {
        const expected = itemUpgradeCost(3) + itemUpgradeCost(4) + itemUpgradeCost(5)
        expect(itemUpgradeCostForLevels(3, 3)).toBe(expected)
    })

    it('costs nothing to buy zero levels', () => {
        expect(itemUpgradeCostForLevels(5, 0)).toBe(0)
    })
})

describe('itemBulkUpgradeLevels', () => {
    it('buys the full bulk count when far from the ceiling', () => {
        expect(itemBulkUpgradeLevels(1)).toBe(ITEM_BULK_UPGRADE_LEVELS)
    })

    it('clamps so it never crosses the max level', () => {
        expect(itemBulkUpgradeLevels(ITEM_MAX_LEVEL - 2)).toBe(2)
        expect(itemBulkUpgradeLevels(ITEM_MAX_LEVEL)).toBe(0)
    })
})

describe('rerollCost', () => {
    it('is one gem per mod with no locks', () => {
        expect(rerollCost(3, 0)).toBe(3)
    })

    it('adds an escalating surcharge per locked mod (2·locked − 1)', () => {
        expect(rerollCost(3, 1)).toBe(4)
        expect(rerollCost(3, 2)).toBe(6)
        expect(rerollCost(5, 3)).toBe(10)
    })
})

describe('rerollItemMods', () => {
    const mods: ItemMod[] = [
        { type: 'power_flat', value: 10 },
        { type: 'loot_percent', value: 5 },
        { type: 'speed_percent', value: 8 }
    ]

    it('keeps locked mods at their exact type and value', () => {
        const result = rerollItemMods(mods, ['power_flat'])
        expect(result[0]).toEqual({ type: 'power_flat', value: 10 })
    })

    it('preserves slot count and keeps mod types unique', () => {
        const result = rerollItemMods(mods, ['power_flat'])
        expect(result).toHaveLength(mods.length)
        expect(new Set(result.map(m => m.type)).size).toBe(result.length)
    })
})

describe('generateItem', () => {
    it('always drops at level 1 with the rarity-appropriate mod count', () => {
        for (const rarity of ['ghost', 'operative', 'specialist', 'elite', 'phantom'] as HackRarity[]) {
            const item = generateItem(rarity, 'tool')
            expect(item.itemLevel).toBe(1)
            expect(item.slot).toBe('tool')
            expect(item.rarity).toBe(rarity)
            expect(item.mods).toHaveLength(RARITY_MOD_COUNT[rarity])
            expect(new Set(item.mods.map(m => m.type)).size).toBe(item.mods.length)
        }
    })

    it('rolls every mod value within its configured range', () => {
        for (let i = 0; i < 50; i++) {
            const item = generateItem('phantom')
            for (const mod of item.mods) {
                const range = MOD_RANGES[mod.type]
                expect(mod.value).toBeGreaterThanOrEqual(range.min)
                expect(mod.value).toBeLessThanOrEqual(range.max)
            }
        }
    })
})

describe('agentPower', () => {
    it('clamps the total to the rarity power cap', () => {
        // base 200 + 20 gear = 220 raw, but a Ghost is capped at 200
        const power = agentPower(
            { level: 20, class: 'infiltrator', rarity: 'ghost' },
            [{ itemLevel: 10, mods: [] }],
            []
        )
        expect(power).toBe(200)
    })
})

describe('effectiveDurationMs', () => {
    it('never drops below the squad-wide speed floor', () => {
        const fast = {
            class: 'infiltrator' as AgentClass,
            items: [{ mods: [{ type: 'speed_percent', value: 40 }] }]
        }
        const duration = effectiveDurationMs(OP, [fast, fast, fast, fast])
        expect(duration).toBe(Math.round(OP.durationMs * (1 - MAX_TOTAL_SPEED)))
    })
})

describe('opSuccessChance', () => {
    it('is always certain when the op needs no power', () => {
        expect(opSuccessChance(0, 0)).toBe(1)
        expect(opSuccessChance(999, 0)).toBe(1)
    })

    it('clamps to [0, 1] around the power ratio', () => {
        expect(opSuccessChance(0, 1000)).toBe(0)
        expect(opSuccessChance(100_000, 100)).toBe(1)
    })

    it('deploys nothing below half the op power', () => {
        // The floor is what stops a squad being thrown at an op it can't clear; it
        // has to line up with the curve, or the two disagree about what is runnable.
        expect(opSuccessChance(49, 100)).toBeLessThan(MIN_DEPLOY_SUCCESS)
        expect(opSuccessChance(50, 100)).toBeGreaterThanOrEqual(MIN_DEPLOY_SUCCESS)
    })
})

describe('effective reward ranges & clamps', () => {
    const bonuses = collectBonuses([])

    it('caps item drop chance at 0.9', () => {
        const inflated = { ...bonuses, itemChance: 5 }
        expect(effectiveItemDropChance(OP, inflated)).toBe(0.9)
    })
})

describe('rollOpReward', () => {
    it('returns nothing on a failed op', () => {
        stubRandomFloat(() => 0.99)
        const gov = OP_TEMPLATES.find(t => t.id === 'gov_heist')!
        const reward = rollOpReward(gov, [{ level: 1, class: 'infiltrator', items: [] }], 1, false)
        expect(reward).toEqual({ success: false, cash: 0, gems: 0, item: null, inventoryFull: false, artifacts: [] })
    })

    it('never awards gems on an op with no base gem chance', () => {
        stubRandomFloat(() => 0)
        const reward = rollOpReward(OP, [{ level: 1, class: 'infiltrator', items: [] }], 100, false)
        expect(reward.success).toBe(true)
        expect(reward.gems).toBe(0)
    })

    it('flags a dropped item as lost when the inventory is full', () => {
        stubRandomFloat(() => 0)
        const reward = rollOpReward(OP, [{ level: 1, class: 'infiltrator', items: [] }], 100, true)
        expect(reward.item).toBeNull()
        expect(reward.inventoryFull).toBe(true)
    })
})

describe('rollRarity', () => {
    it('never returns a zero-weight rarity', () => {
        const weights = { ghost: 60, operative: 35, specialist: 5, elite: 0, phantom: 0 }
        const seen = new Set<HackRarity>()
        for (let i = 0; i < 300; i++) seen.add(rollRarity(weights))
        expect(seen.has('elite')).toBe(false)
        expect(seen.has('phantom')).toBe(false)
    })

    it('picks the rarity the roll lands in', () => {
        const weights = { ghost: 60, operative: 35, specialist: 5, elite: 0, phantom: 0 }
        stubRandomFloat(() => 0) // roll ≈ 0 → first bucket
        expect(rollRarity(weights)).toBe('ghost')
        stubRandomFloat(() => 0.99) // roll ≈ 99 → last non-zero bucket
        expect(rollRarity(weights)).toBe('specialist')
    })
})
