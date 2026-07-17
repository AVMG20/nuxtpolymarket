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
    itemPower,
    agentPower,
    agentSpeedPercent,
    effectiveDurationMs,
    agentLootPercent,
    agentXpGain,
    opSuccessChance,
    effectiveCashRange,
    effectiveGemChance,
    effectiveItemDropChance,
    collectBonuses,
    rollOpReward,
    rollRarity,
    itemSellPrice,
    sortModsByPriority,
    agentBonusStats,
    type ItemMod,
    type HackRarity,
    type AgentClass
} from '../../shared/utils/hack-config'

const OP = OP_TEMPLATES.find(t => t.id === 'port_scan')!

afterEach(() => {
    vi.restoreAllMocks()
})

describe('itemUpgradeCost ladder', () => {
    it('costs 1 gem for the first level and grows monotonically', () => {
        expect(itemUpgradeCost(1)).toBe(1)
        for (let lvl = 1; lvl < ITEM_MAX_LEVEL - 1; lvl++) {
            expect(itemUpgradeCost(lvl + 1)).toBeGreaterThanOrEqual(itemUpgradeCost(lvl))
        }
    })

    it('sums the per-level cost across a multi-level buy', () => {
        const expected = itemUpgradeCost(3) + itemUpgradeCost(4) + itemUpgradeCost(5)
        expect(itemUpgradeCostForLevels(3, 3)).toBe(expected)
    })

    it('a full 1→20 upgrade costs 70 gems', () => {
        expect(itemUpgradeCostForLevels(1, ITEM_MAX_LEVEL - 1)).toBe(70)
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

    it('replaces every unlocked slot when nothing is locked', () => {
        const result = rerollItemMods(mods, [])
        expect(result).toHaveLength(mods.length)
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
        for (let i = 0; i < 200; i++) {
            const item = generateItem('phantom')
            for (const mod of item.mods) {
                const range = MOD_RANGES[mod.type]
                expect(mod.value).toBeGreaterThanOrEqual(range.min)
                expect(mod.value).toBeLessThanOrEqual(range.max)
            }
        }
    })
})

describe('itemPower', () => {
    it('is 2 per level plus any power_flat mods', () => {
        expect(itemPower({ itemLevel: 5, mods: [] })).toBe(10)
        expect(itemPower({ itemLevel: 5, mods: [{ type: 'power_flat', value: 12 }] })).toBe(22)
    })
})

describe('agentPower', () => {
    it('sums level, class power, gear and flat traits', () => {
        const power = agentPower(
            { level: 10, class: 'bruteforce' }, // base 100 + 15 class passive = 115
            [{ itemLevel: 5, mods: [{ type: 'power_flat', value: 10 }] }], // +10 level power +10 mod = 20
            [{ type: 'power_flat', value: 5 }] // +5
        )
        expect(power).toBe(140)
    })

    it('applies power_percent traits as a multiplier on the flat total', () => {
        const power = agentPower(
            { level: 10, class: 'infiltrator' }, // base 100, no class power
            [],
            [{ type: 'power_percent', value: 20 }]
        )
        expect(power).toBe(120)
    })
})

describe('agentSpeedPercent & effectiveDurationMs', () => {
    it('sums gear, class passive and speed traits for a single agent', () => {
        const speed = agentSpeedPercent({
            class: 'infiltrator', // +0.10 passive
            traits: [{ type: 'speed_percent', value: 10 }], // +0.10
            items: [{ mods: [{ type: 'speed_percent', value: 20 }] }] // +0.20
        })
        expect(speed).toBeCloseTo(0.4, 5)
    })

    it('applies each agent multiplicatively (diminishing returns)', () => {
        const agent = { class: 'cryptographer' as AgentClass, items: [{ mods: [{ type: 'speed_percent', value: 20 }] }] }
        const duration = effectiveDurationMs(OP, [agent])
        expect(duration).toBe(Math.round(OP.durationMs * 0.8))
    })

    it('never drops below the squad-wide speed floor', () => {
        const fast = {
            class: 'infiltrator' as AgentClass,
            items: [{ mods: [{ type: 'speed_percent', value: 40 }] }]
        }
        const duration = effectiveDurationMs(OP, [fast, fast, fast, fast])
        expect(duration).toBe(Math.round(OP.durationMs * (1 - MAX_TOTAL_SPEED)))
    })
})

describe('agentLootPercent', () => {
    it('sums gear, class passive and loot traits', () => {
        const loot = agentLootPercent({
            class: 'cryptographer', // +0.06 passive
            traits: [{ type: 'loot_percent', value: 4 }], // +0.04
            items: [{ mods: [{ type: 'loot_percent', value: 10 }] }] // +0.10
        })
        expect(loot).toBeCloseTo(0.2, 5)
    })
})

describe('agentXpGain', () => {
    it('awards a reduced flat XP on failure', () => {
        expect(agentXpGain(OP, { items: [] }, false)).toBe(Math.floor(OP.baseXP * 0.15))
    })

    it('scales base XP by xp_boost traits and adds flat gear XP on success', () => {
        const xp = agentXpGain(
            OP,
            { traits: [{ type: 'xp_boost', value: 50 }], items: [{ mods: [{ type: 'xp_flat', value: 3 }] }] },
            true
        )
        expect(xp).toBe(Math.round(OP.baseXP * 1.5 + 3))
    })
})

describe('opSuccessChance', () => {
    it('is always certain when the op needs no power', () => {
        expect(opSuccessChance(0, 0)).toBe(1)
        expect(opSuccessChance(999, 0)).toBe(1)
    })

    it('clamps to [0, 1] around the power ratio', () => {
        expect(opSuccessChance(10, 1000)).toBe(0)
        expect(opSuccessChance(100_000, 100)).toBe(1)
    })

    it('scales linearly between the floor and ceiling ratios', () => {
        // ratio 0.75 → (0.75 - 0.1) / 1.3 = 0.5
        expect(opSuccessChance(75, 100)).toBeCloseTo(0.5, 5)
    })
})

describe('effective reward ranges & clamps', () => {
    const bonuses = collectBonuses([])

    it('cash range echoes the base ladder when there are no bonuses', () => {
        expect(effectiveCashRange(OP, bonuses)).toEqual(OP.baseCash)
    })

    it('caps gem chance at 0.95', () => {
        const gemOp = OP_TEMPLATES.find(t => t.id === 'project_zero')!
        const inflated = { ...bonuses, gemChance: 5 }
        expect(effectiveGemChance(gemOp, inflated)).toBe(0.95)
    })

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
        for (let i = 0; i < 2000; i++) seen.add(rollRarity(weights))
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

describe('itemSellPrice', () => {
    it('scales flatly with rarity', () => {
        expect(itemSellPrice('ghost')).toBe(500)
        expect(itemSellPrice('phantom')).toBe(150_000)
        expect(itemSellPrice('elite')).toBeGreaterThan(itemSellPrice('specialist'))
    })
})

describe('sortModsByPriority', () => {
    it('orders mods by the global stat priority', () => {
        const mods: ItemMod[] = [
            { type: 'gem_chance', value: 0.01 },
            { type: 'power_flat', value: 10 },
            { type: 'loot_percent', value: 5 }
        ]
        expect(sortModsByPriority(mods).map(m => m.type)).toEqual(['power_flat', 'loot_percent', 'gem_chance'])
    })
})

describe('agentBonusStats', () => {
    it('aggregates passives, traits and gear into priority order', () => {
        const stats = agentBonusStats([
            {
                class: 'bruteforce', // +15 power passive
                traits: [
                    { type: 'speed_percent', value: 10 },
                    { type: 'gem_chance', value: 0.02 }
                ],
                gear: {
                    tool: { mods: [{ type: 'loot_percent', value: 5 }, { type: 'item_chance', value: 0.03 }] }
                }
            }
        ])
        expect(stats.map(s => s.label)).toEqual(['Power', 'Op Speed', 'Loot', 'Item Find', 'Gem Chance'])
    })

    it('sums the same stat across sources', () => {
        const stats = agentBonusStats([
            { class: 'infiltrator', traits: [{ type: 'speed_percent', value: 10 }], gear: {} }
        ])
        const speed = stats.find(s => s.label === 'Op Speed')!
        expect(speed.value).toBeCloseTo(20, 5) // 10 class passive (×100) + 10 trait
    })

    it('drops stats that net out to zero', () => {
        const stats = agentBonusStats([{ class: 'infiltrator', gear: {} }])
        expect(stats.every(s => s.value > 0)).toBe(true)
    })
})
