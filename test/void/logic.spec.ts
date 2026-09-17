import { describe, expect, it } from 'vitest'
import {
    VOID_SHIPS, VOID_TURRETS, VOID_UPGRADES, VOID_MARKET_PRICES,
    voidAutoFit, voidBundleValue, voidCanAfford, voidDerivedStats, voidDescribeState, voidLoadoutFor, voidNormalizeFit, voidNormalizeLevels, voidSettleRun,
    voidSectorResources, voidSectorUnlocked, voidSubtractBundle, voidUpgradeCost, type VoidStateSnapshot
} from '#shared/utils/gamelogic/void'
import {
    VOID_BOUNTY_XP, VOID_DAILY_GEAR, VOID_LORE, VOID_PERKS, voidAllowedDepth, voidLoreForSector, voidNormalizePerks, voidPerkCost, voidBountyXp, voidGearCap, voidRunMarks
} from '#shared/utils/gamelogic/void-pilot'
import {
    VOID_DAMAGE_MULT, VOID_DAMAGE_TYPE, VOID_DEVICES, VOID_SECONDARIES, VOID_ITEM_TYPES, VOID_RARITIES, voidCanCraftTier, voidCraftCost, voidDefenceStats, voidItemUpgradeCost, voidRollBonusAffix, voidRollItem, voidRollMod, voidRollSalvagedGear, voidWeaponFit,
    type VoidItem
} from '#shared/utils/gamelogic/void-items'

function snapshot(overrides: Partial<VoidStateSnapshot> = {}): VoidStateSnapshot {
    return {
        userId: 'u',
        resources: {},
        ownedShipIds: ['sparrow'],
        equippedShipId: 'sparrow',
        loadouts: {},
        upgradeLevels: {},
        highestSectorCleared: 0,
        runsPlayed: 0,
        extractions: 0,
        kills: 0,
        wardensKilled: 0,
        bestHaulValue: 0,
        totalSold: 0,
        runStartedAt: null,
        runSector: null,
        pilotXp: 0,
        tradeLevel: 0,
        unlockedSkills: ['seeker'],
        equippedSkill: 'seeker',
        skillNodes: {},
        ...overrides
    }
}

function item(overrides: Partial<VoidItem> = {}): VoidItem {
    return { id: overrides.id ?? `i${Math.random()}`, kind: 'turret', type: 'pulse', tier: 1, rarity: 0, level: 0, affixes: {}, mod: null, ...overrides }
}

/** A deterministic sequence for rolls. */
function seq(values: number[]) {
    let i = 0
    return () => values[i++ % values.length]!
}

describe('void runner catalogue', () => {
    it('grows from a one-turret scout to a twelve-turret dreadnought', () => {
        expect(VOID_SHIPS).toHaveLength(10)
        expect(VOID_SHIPS[0]!.turrets).toBe(1)
        expect(Math.max(...VOID_SHIPS.map(s => s.turrets))).toBe(12)
        expect(VOID_SHIPS[0]!.cost).toEqual({})
        for (const ship of VOID_SHIPS) expect(ship.armor + ship.shields).toBeGreaterThanOrEqual(2)
    })

    it('gates later hulls behind cleared sectors', () => {
        for (let i = 1; i < VOID_SHIPS.length; i++) {
            expect(VOID_SHIPS[i]!.requiresSector).toBeGreaterThanOrEqual(VOID_SHIPS[i - 1]!.requiresSector)
        }
    })

    it('prices every system level in materials and coins, and stops at max', () => {
        for (const u of VOID_UPGRADES) {
            let previousCoins = 0
            for (let level = 0; level < u.maxLevel; level++) {
                const price = voidUpgradeCost(u.id, level)
                expect(price, `${u.id} ${level}`).not.toBeNull()
                expect(Object.values(price!.resources).every(v => Number.isInteger(v) && v > 0)).toBe(true)
                expect(price!.coins).toBeGreaterThan(previousCoins * 1.7)
                previousCoins = price!.coins
            }
            expect(voidUpgradeCost(u.id, u.maxLevel)).toBeNull()
        }
    })

    it('never lets a hull past the loaner be bought with coins alone', () => {
        for (const ship of VOID_SHIPS.slice(1)) {
            expect(Object.keys(ship.cost).length, ship.id).toBeGreaterThan(0)
            expect(ship.coins, ship.id).toBeGreaterThan(0)
        }
    })

    it('has a turret item type for every turret definition', () => {
        for (const t of VOID_TURRETS) expect(VOID_ITEM_TYPES.some(x => x.kind === 'turret' && x.id === t.id), t.id).toBe(true)
    })
})

describe('void runner gear', () => {
    it('only crafts up to one tier past the deepest cleared sector', () => {
        expect(voidCanCraftTier(1, 0)).toBe(true)
        expect(voidCanCraftTier(2, 0)).toBe(false)
        expect(voidCanCraftTier(2, 1)).toBe(true)
        expect(voidCanCraftTier(6, 9)).toBe(false)
    })

    it('makes every tier cost more in both materials and coins', () => {
        for (const kind of ['gun', 'turret', 'armor', 'shield'] as const) {
            for (let t = 2; t <= 5; t++) {
                expect(voidCraftCost(kind, t).coins).toBeGreaterThan(voidCraftCost(kind, t - 1).coins * 3.5)
                expect(Object.keys(voidCraftCost(kind, t).resources).length).toBeGreaterThan(0)
            }
        }
    })

    it('levels items on an exponential curve that ends at +10', () => {
        let previous = 0
        for (let level = 0; level < 10; level++) {
            const cost = voidItemUpgradeCost({ kind: 'turret', tier: 2, level })!
            expect(cost.coins).toBeGreaterThan(previous)
            previous = cost.coins
        }
        expect(voidItemUpgradeCost({ kind: 'turret', tier: 2, level: 10 })).toBeNull()
        // A maxed item costs far more than the craft itself.
        const total = Array.from({ length: 10 }, (_, l) => voidItemUpgradeCost({ kind: 'turret', tier: 2, level: l })!.coins).reduce((a, b) => a + b, 0)
        expect(total).toBeGreaterThan(voidCraftCost('turret', 2).coins * 8)
    })

    it('rolls rarity from the weights and gives rarer items more affixes', () => {
        const common = voidRollItem('turret', 'pulse', 1, seq([0]))
        expect(common.rarity).toBe(0)
        expect(Object.keys(common.affixes)).toHaveLength(0)
        const legendary = voidRollItem('turret', 'pulse', 1, seq([0.9999, 0.1, 0.5, 0.2, 0.5, 0.3, 0.5]))
        expect(legendary.rarity).toBe(VOID_RARITIES.length - 1)
        expect(Object.keys(legendary.affixes)).toHaveLength(3)
        for (let i = 0; i < 20; i++) expect(voidRollMod(seq([i / 20]))).toBeTruthy()
    })

    it('scales weapons with tier, level and rarity', () => {
        const t1 = voidWeaponFit(item()).power
        const t1max = voidWeaponFit(item({ level: 10 })).power
        const t2 = voidWeaponFit(item({ tier: 2 })).power
        const t5leg = voidWeaponFit(item({ tier: 5, rarity: 4, level: 10 })).power
        // A maxed item keeps pace with a fresh one a tier up.
        expect(t1max).toBeGreaterThanOrEqual(t2)
        expect(t2).toBeGreaterThan(t1)
        expect(t5leg).toBeGreaterThan(15)
        // Rarity can jump a tier: a maxed T1 legendary beats a maxed T2 common, not a maxed T2 uncommon.
        const t1leg = voidWeaponFit(item({ rarity: 4, level: 10 })).power
        expect(t1leg).toBeGreaterThan(voidWeaponFit(item({ tier: 2, level: 10 })).power)
        expect(t1leg).toBeLessThan(voidWeaponFit(item({ tier: 2, rarity: 1, level: 10 })).power)
        expect(voidWeaponFit(item({ level: 10 })).power).toBeLessThan(voidWeaponFit(item({ tier: 2, level: 10 })).power)
    })

    it('adds a bonus affix at milestone levels', () => {
        const once = voidRollBonusAffix({ kind: 'turret', rarity: 0, affixes: {} }, seq([0.5]))
        expect(Object.keys(once)).toHaveLength(1)
        const full = { damage: 0.04, rate: 0.03, crit: 0.03, range: 0.08 }
        const boosted = voidRollBonusAffix({ kind: 'turret', rarity: 0, affixes: full }, seq([0.5]))
        expect(Object.values(boosted).reduce((a, b) => a + b, 0)).toBeGreaterThan(Object.values(full).reduce((a, b) => a + b, 0))
    })

    it('adds hull and shield from gear and caps resist', () => {
        const d = voidDefenceStats(100, 50, [item({ kind: 'armor', type: 'plating' })], [item({ kind: 'shield', type: 'deflector' })])
        expect(d.hull).toBeGreaterThan(100)
        expect(d.shield).toBeGreaterThan(50)
        const tank = voidDefenceStats(100, 0, Array.from({ length: 20 }, () => item({ kind: 'armor', type: 'bulkhead', affixes: { resist: 0.05 } })), [])
        expect(tank.resist).toBe(0.4)
    })
})

describe('void runner loadouts', () => {
    it('drops items that do not exist, do not fit the slot, or are fitted twice', () => {
        const gun = item({ id: 'g', kind: 'gun', type: 'blaster' })
        const turret = item({ id: 't' })
        const fit = voidNormalizeFit('wasp', { gun: 't', turrets: ['t', 't', 'x'], armor: ['g'], shields: [] }, [gun, turret])
        expect(fit).toEqual({ gun: null, turrets: ['t', null], armor: [null], shields: [null], secondary: null, device: null })
    })

    it('auto-fits the strongest gear into every slot', () => {
        const items = [item({ id: 'weak' }), item({ id: 'strong', tier: 3 }), item({ id: 'a', kind: 'armor', type: 'plating' })]
        const fit = voidAutoFit('wasp', items)
        expect(fit.turrets).toEqual(['strong', 'weak'])
        expect(fit.armor).toEqual(['a'])
        const stats = voidDerivedStats('wasp', voidNormalizeLevels({}), fit, items)
        expect(stats.hull).toBeGreaterThan(VOID_SHIPS[1]!.hull)
    })

    it('describes a fresh hangar with only the loaner owned and sector 1 open', () => {
        const state = voidDescribeState(snapshot(), 0, 0, [])
        expect(state.ships.filter(s => s.owned).map(s => s.id)).toEqual(['sparrow'])
        expect(state.sectors.filter(s => s.unlocked).map(s => s.tier)).toEqual([1])
        expect(state.crafting.maxTier).toBe(1)
        expect(voidSectorUnlocked(2, 1)).toBe(true)
        expect(voidSectorUnlocked(3, 1)).toBe(false)
        expect(voidLoadoutFor(snapshot(), []).gun).toBeNull()
    })
})

describe('void runner bundles', () => {
    it('subtracts costs and drops empty stacks', () => {
        expect(voidCanAfford({ ferrite: 5 }, { ferrite: 6 })).toBe(false)
        expect(voidSubtractBundle({ ferrite: 6, scrap: 2 }, { ferrite: 6 })).toEqual({ scrap: 2 })
    })
})

describe('void runner settlement', () => {
    const minutes = (n: number) => n * 60_000

    it('banks nothing unless the pilot docked', () => {
        const result = voidSettleRun({ extracted: false, haul: { ferrite: 30 }, elapsedMs: minutes(4), kills: 5, wardenKilled: true }, 1, 40, minutes(4))
        expect(result.haul).toEqual({})
        expect(result.wardenKilled).toBe(false)
    })

    it('banks an honest haul unchanged', () => {
        const haul = { ferrite: 650, cobalt: 100, scrap: 200 }
        const result = voidSettleRun({ extracted: true, haul, elapsedMs: minutes(3), kills: 9, wardenKilled: false }, 1, 1000, minutes(3))
        expect(result.haul).toEqual(haul)
        expect(result.trimmed).toBe(false)
        expect(result.value).toBe(voidBundleValue(haul))
    })

    it('drops resources the sector cannot produce', () => {
        const result = voidSettleRun({ extracted: true, haul: { ferrite: 10, xenite: 50 }, elapsedMs: minutes(5), kills: 0, wardenKilled: false }, 1, 400, minutes(5))
        expect(voidSectorResources(1).has('xenite')).toBe(false)
        expect(result.haul).toEqual({ ferrite: 10 })
        expect(result.trimmed).toBe(true)
    })

    it('trims to the hold, keeping the most valuable material', () => {
        const result = voidSettleRun({ extracted: true, haul: { ferrite: 750, cobalt: 750 }, elapsedMs: minutes(8), kills: 0, wardenKilled: false }, 1, 1000, minutes(8))
        expect(result.units).toBe(1000)
        expect(result.haul.cobalt).toBe(750)
        expect(result.haul.ferrite).toBe(250)
    })

    it('caps a haul to what the elapsed time allows, using the server clock', () => {
        const forged = voidSettleRun({ extracted: true, haul: { cobalt: 500_000 }, elapsedMs: minutes(30), kills: 0, wardenKilled: false }, 2, 500_000, 30_000)
        expect(forged.haul.cobalt!).toBeLessThan(2_000)
        expect(forged.value).toBeLessThan(2_000 * VOID_MARKET_PRICES.cobalt)
    })

    it('refuses warden cores from a run too short to have reached the warden', () => {
        const quick = voidSettleRun({ extracted: true, haul: { core: 3 }, elapsedMs: 20_000, kills: 1, wardenKilled: true }, 3, 100, 20_000)
        expect(quick.wardenKilled).toBe(false)
        expect(quick.haul.core ?? 0).toBe(0)
        const real = voidSettleRun({ extracted: true, haul: { core: 3 }, elapsedMs: minutes(6), kills: 40, wardenKilled: true }, 3, 100, minutes(6))
        expect(real.wardenKilled).toBe(true)
        expect(real.haul.core).toBe(3)
    })
})

describe('void runner combat systems', () => {
    it('makes energy strip shields and kinetic tear hulls', () => {
        expect(VOID_DAMAGE_MULT.energy.shield).toBeGreaterThan(VOID_DAMAGE_MULT.kinetic.shield)
        expect(VOID_DAMAGE_MULT.kinetic.hull).toBeGreaterThan(VOID_DAMAGE_MULT.energy.hull)
        for (const t of VOID_ITEM_TYPES.filter(x => x.kind === 'gun' || x.kind === 'turret' || x.kind === 'secondary')) expect(VOID_DAMAGE_TYPE[t.id], t.id).toBeTruthy()
    })

    it('defines ballistics for every secondary and device type', () => {
        for (const t of VOID_ITEM_TYPES.filter(x => x.kind === 'secondary')) expect(VOID_SECONDARIES[t.id], t.id).toBeTruthy()
        for (const t of VOID_ITEM_TYPES.filter(x => x.kind === 'device')) expect(VOID_DEVICES[t.id], t.id).toBeTruthy()
    })

    it('builds MkII gear from blueprints: stronger and never common', () => {
        const plain = voidRollItem('turret', 'pulse', 1, seq([0]))
        const mk2 = voidRollItem('turret', 'pulse', 1, seq([0]), true)
        expect(mk2.rarity).toBeGreaterThanOrEqual(1)
        expect(voidWeaponFit({ ...mk2, id: 'b', rarity: 0 }).power).toBeGreaterThan(voidWeaponFit({ ...plain, id: 'a' }).power)
    })
})

describe('void runner salvaged gear', () => {
    it('only rolls types craftable at the tier, keeping the better of two rarities', () => {
        for (let i = 0; i < 40; i++) {
            const r = (() => {
                let n = i * 0.137
                return () => (n = (n * 9301 + 49297) % 233280 / 233280)
            })()
            const item = voidRollSalvagedGear(1, r)
            const type = VOID_ITEM_TYPES.find(t => t.id === item.type)!
            expect(type.kind).toBe(item.kind)
            expect(type.minTier).toBeLessThanOrEqual(1)
            expect(item.tier).toBe(1)
        }
        const best = voidRollSalvagedGear(2, seq([0.9999]))
        expect(best.rarity).toBeGreaterThan(0)
    })
})

describe('void runner pilot meta', () => {
    it('pays Command Marks only for extractions, and only trusts a carrier kill on a long run', () => {
        const base = { extracted: true, wardenKilled: true, carrierKilled: false, depth: 1, elapsedMs: 10 * 60_000 }
        expect(voidRunMarks({ ...base, extracted: false })).toBe(0)
        expect(voidRunMarks(base)).toBe(2)
        expect(voidRunMarks({ ...base, carrierKilled: true, elapsedMs: 60_000, wardenKilled: false })).toBe(0)
        expect(voidRunMarks({ ...base, carrierKilled: true })).toBe(5)
    })

    it('caps jump depth by elapsed time', () => {
        expect(voidAllowedDepth(8, 60_000)).toBe(1)
        expect(voidAllowedDepth(3, 6 * 60_000)).toBe(3)
        expect(voidAllowedDepth(99, 3_600_000)).toBe(8)
    })

    it('grows the loot cap with an honest jump depth', () => {
        const haul = { ferrite: 100_000 }
        const shallow = voidSettleRun({ extracted: true, haul, elapsedMs: 600_000, kills: 0, wardenKilled: false, depth: 1 }, 1, 1e9, 600_000)
        const deep = voidSettleRun({ extracted: true, haul, elapsedMs: 600_000, kills: 0, wardenKilled: false, depth: 4 }, 1, 1e9, 600_000)
        expect(deep.haul.ferrite!).toBeGreaterThan(shallow.haul.ferrite!)
    })

    it('prices perks per rank and stops at max', () => {
        for (const perk of VOID_PERKS) {
            expect(voidPerkCost(perk.id, 0)).toBe(perk.costs[0])
            expect(voidPerkCost(perk.id, perk.costs.length)).toBeNull()
        }
        expect(voidNormalizePerks({ harness: 99, bogus: 3 }).harness).toBe(3)
    })

    it('only offers lore for the sector being flown', () => {
        expect(voidLoreForSector(1).every(id => id.startsWith('halcyon') || id === 'relic-1')).toBe(true)
        expect(VOID_LORE.length).toBeGreaterThanOrEqual(15)
    })
})


describe('void runner bounties and gear caps', () => {
    it('caps reported bounty XP at one bounty per minute flown and two per run', () => {
        expect(voidBountyXp(999, 30_000)).toBe(0)
        expect(voidBountyXp(999, 90_000)).toBe(VOID_BOUNTY_XP)
        expect(voidBountyXp(999, 20 * 60_000)).toBe(VOID_BOUNTY_XP * 2)
        expect(voidBountyXp(40, 20 * 60_000)).toBe(40)
        expect(voidBountyXp('junk', 20 * 60_000)).toBe(0)
        expect(voidBountyXp(-80, 20 * 60_000)).toBe(0)
    })

    it('caps salvaged gear by time, bosses and the daily limit', () => {
        const run = { elapsedMs: 60_000, wardenKilled: false, carrierKilled: false, earnest: true }
        const full = { elapsedMs: 10 * 60_000, wardenKilled: true, carrierKilled: true, earnest: true }
        expect(voidGearCap(run, 0)).toBe(0)
        expect(voidGearCap({ ...run, elapsedMs: 90_000 }, 0)).toBe(1)
        expect(voidGearCap({ ...run, elapsedMs: 60 * 60_000 }, 0)).toBe(3)
        expect(voidGearCap(full, 0)).toBe(5)
        // A run with no kills or cargo banks nothing, whatever it reports.
        expect(voidGearCap({ ...full, earnest: false }, 0)).toBe(0)
        // Boss kills only count on a run long enough to have fought one.
        expect(voidGearCap({ ...run, elapsedMs: 120_000, carrierKilled: true, wardenKilled: true }, 0)).toBe(1)
        expect(voidGearCap(full, VOID_DAILY_GEAR - 2)).toBe(2)
        expect(voidGearCap(full, VOID_DAILY_GEAR + 3)).toBe(0)
    })
})
