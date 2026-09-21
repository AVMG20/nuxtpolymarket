import { describe, expect, it } from 'vitest'
import {
    VOID_SHIPS, VOID_TURRETS, VOID_UPGRADES, VOID_MARKET_PRICES,
    voidApplyBeaconReport, voidBeaconStates, voidCleanBeacons, voidRollBeaconAttack, voidAutoFit, voidBundleValue, voidCanAfford, voidDerivedStats, voidDescribeState, voidLoadoutFor, voidNormalizeFit, voidNormalizeLevels, voidSettleRun,
    VOID_MAX_SHIP_TIER, voidNormalizeShipTiers, voidRefitCost, voidShipAtTier, voidShipNativeTier, voidShipTier,
    voidGearTier, voidSectorResources, voidSectorUnlocked, voidSubtractBundle, voidUpgradeCost, type VoidStateSnapshot
} from '#shared/utils/gamelogic/void'
import {
    VOID_BOUNTY_XP, VOID_DAILY_GEAR, VOID_LORE, VOID_PERKS, voidAllowedDepth, voidLoreForSector, voidNormalizePerks, voidPerkCost, voidBountyXp, voidCapitalKills, voidGearCap, voidRunMarks, VOID_MAX_RUN_MARKS
} from '#shared/utils/gamelogic/void-pilot'
import { voidCleanTelemetry } from '#shared/utils/gamelogic/void-telemetry'
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
    it('grows from a one-turret scout to a six-turret dreadnought', () => {
        expect(VOID_SHIPS).toHaveLength(10)
        expect(VOID_SHIPS[0]!.turrets).toBe(1)
        expect(Math.max(...VOID_SHIPS.map(s => s.turrets))).toBe(6)
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
        const fit = voidNormalizeFit('mule', { gun: 't', turrets: ['t', 't', 'x'], armor: ['g'], shields: [] }, [gun, turret])
        expect(fit).toEqual({ gun: null, turrets: ['t', null], armor: [null, null], shields: [null], secondary: null, device: null })
    })

    it('auto-fits the strongest gear into every slot', () => {
        const items = [item({ id: 'weak' }), item({ id: 'strong', tier: 3 }), item({ id: 'a', kind: 'armor', type: 'plating' })]
        const fit = voidAutoFit('mule', items)
        expect(fit.turrets).toEqual(['strong', 'weak'])
        expect(fit.armor).toEqual(['a', null])
        const stats = voidDerivedStats('mule', voidNormalizeLevels({}), fit, items)
        expect(stats.hull).toBeGreaterThan(VOID_SHIPS[2]!.hull)
    })

    it('refits an old hull a tier up without adding slots', () => {
        expect(voidShipNativeTier('phantom')).toBe(2)
        const base = voidShipAtTier('phantom', 2)
        const refit = voidShipAtTier('phantom', 4)
        expect(refit.hull).toBeGreaterThan(base.hull)
        expect(refit.cargo).toBeGreaterThan(base.cargo)
        expect(refit.turretBonus).toBeCloseTo(0.3)
        expect([refit.turrets, refit.armor, refit.shields]).toEqual([base.turrets, base.armor, base.shields])
        const fit = voidNormalizeFit('phantom', null, [])
        const levels = voidNormalizeLevels({})
        expect(voidDerivedStats('phantom', levels, fit, [], undefined, 4).turretMult).toBeGreaterThan(voidDerivedStats('phantom', levels, fit, []).turretMult)
    })

    it('never reads a stored tier below the hull\'s own or above the cap', () => {
        expect(voidShipTier('aegis', { aegis: 1 })).toBe(3)
        expect(voidShipTier('wasp', { wasp: 99 })).toBe(VOID_MAX_SHIP_TIER)
        expect(voidNormalizeShipTiers({ nope: 4, wasp: 'x' })).toEqual({})
    })

    it('prices a refit just under a new hull of that tier, climbing every tier', () => {
        const costs = Array.from({ length: VOID_MAX_SHIP_TIER - 1 }, (_, i) => voidRefitCost(i + 2)!)
        costs.forEach((c, i) => {
            if (i) expect(c.coins).toBeGreaterThan(costs[i - 1]!.coins)
        })
        const aegis = VOID_SHIPS.find(s => s.id === 'aegis')!
        expect(voidRefitCost(3)!.coins).toBeLessThan(aegis.coins)
        expect(voidRefitCost(3)!.coins).toBeGreaterThan(aegis.coins * 0.7)
        expect(voidRefitCost(VOID_MAX_SHIP_TIER + 1)).toBeNull()
    })

    it('rates gear across every slot, so bare hardpoints drag the rating down', () => {
        // Sparrow: gun, one turret, one plate, one generator.
        const items = [item({ id: 'g', kind: 'gun', type: 'blaster', tier: 3 }), item({ id: 't', tier: 3 }), item({ id: 'a', kind: 'armor', type: 'plating', tier: 1 })]
        const fit = voidAutoFit('sparrow', items)
        expect(voidGearTier('sparrow', fit, items)).toBe((3 + 3 + 1 + 0) / 4)
    })

    it('prices each model on its own, with a signature material for the fancier ones', () => {
        const pulse = voidCraftCost('turret', 4, 'pulse')
        const rail = voidCraftCost('turret', 4, 'rail')
        expect(pulse).toEqual(voidCraftCost('turret', 4))
        expect(rail.coins).toBeGreaterThan(pulse.coins * 1.2)
        expect(rail.resources.xenite!).toBeGreaterThan(pulse.resources.xenite! * 1.3)
        expect(voidCraftCost('turret', 2, 'tesla').resources.cobalt!).toBeGreaterThan(voidCraftCost('turret', 2).resources.cobalt!)
        expect(voidCraftCost('shield', 1, 'regenerator').resources.cobalt).toBeGreaterThan(0)
        // Levelling and scrapping follow the model's own recipe.
        expect(voidItemUpgradeCost({ kind: 'turret', type: 'rail', tier: 4, level: 0 })!.coins).toBeGreaterThan(voidItemUpgradeCost({ kind: 'turret', type: 'pulse', tier: 4, level: 0 })!.coins)
        for (const t of VOID_ITEM_TYPES) expect(Object.values(voidCraftCost(t.kind, t.minTier, t.id).resources).every(n => n! > 0)).toBe(true)
    })

    it('keeps a craft within one gunship hold so rolls can be repeated, and puts the grind in levelling', () => {
        const hold = VOID_SHIPS.find(s => s.id === 'kestrel')!.cargo
        const units = (bundle: Record<string, number | undefined>) => Object.entries(bundle).reduce((sum, [id, n]) => sum + (id === 'core' ? 0 : n!), 0)
        for (const tier of [3, 4]) {
            expect(units(voidCraftCost('turret', tier).resources)).toBeLessThan(hold)
            const levelling = Array.from({ length: 10 }, (_, l) => units(voidItemUpgradeCost({ kind: 'turret', tier, level: l })!.resources)).reduce((a, b) => a + b, 0)
            expect(levelling).toBeGreaterThan(hold * 4)
        }
        expect(voidCraftCost('armor', 4).resources.core ?? 0).toBe(0)
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
        const quick = voidSettleRun({ extracted: true, haul: { core: 3 }, elapsedMs: 5_000, kills: 1, wardenKilled: true }, 3, 100, 5_000)
        expect(quick.wardenKilled).toBe(false)
        expect(quick.haul.core ?? 0).toBe(0)
        const real = voidSettleRun({ extracted: true, haul: { core: 3 }, elapsedMs: minutes(6), kills: 40, wardenKilled: true }, 3, 100, minutes(6))
        expect(real.wardenKilled).toBe(true)
        expect(real.haul.core).toBe(3)
    })

    it('counts a geared pilot\'s fast sector 4 warden kill', () => {
        const fast = voidSettleRun({ extracted: true, haul: {}, elapsedMs: minutes(3), kills: 30, wardenKilled: true }, 4, 100, minutes(3))
        expect(fast.wardenKilled).toBe(true)
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
    it('pays Command Marks only for extractions, and only trusts a carrier kill past ten seconds', () => {
        const base = { extracted: true, wardenKilled: true, carrierKilled: false, depth: 1, elapsedMs: 10 * 60_000, sector: 3 }
        expect(voidRunMarks({ ...base, extracted: false })).toBe(0)
        expect(voidRunMarks(base)).toBe(2)
        expect(voidRunMarks({ ...base, carrierKilled: true, elapsedMs: 5_000, wardenKilled: false })).toBe(0)
        expect(voidRunMarks({ ...base, carrierKilled: true, elapsedMs: 60_000, wardenKilled: false })).toBe(3)
        expect(voidRunMarks({ ...base, carrierKilled: true })).toBe(5)
    })

    it('only trusts Tyrant and Harbinger kills on runs past ten seconds and deep enough to have fought them', () => {
        const base = { extracted: true, wardenKilled: false, carrierKilled: false, depth: 1, elapsedMs: 10 * 60_000 }
        expect(voidRunMarks({ ...base, tyrantKilled: true })).toBe(3)
        expect(voidRunMarks({ ...base, tyrantKilled: true, elapsedMs: 5_000 })).toBe(0)
        expect(voidRunMarks({ ...base, tyrantKilled: true, elapsedMs: 60_000 })).toBe(3)
        // The Harbinger only exists past a jump.
        expect(voidRunMarks({ ...base, harbingerKilled: true })).toBe(0)
        expect(voidRunMarks({ ...base, harbingerKilled: true, depth: 2 })).toBe(5)
        expect(voidRunMarks({ ...base, harbingerKilled: true, depth: 2, elapsedMs: 5_000 })).toBe(0)
        expect(voidRunMarks({ ...base, harbingerKilled: true, depth: 2, elapsedMs: 2 * 60_000 })).toBe(5)
        expect(voidCapitalKills({ carrierKilled: true, tyrantKilled: true, harbingerKilled: true, depth: 2 }, 8 * 60_000)).toEqual({ carrier: true, tyrant: true, harbinger: true })
    })

    it('never pays more Marks than a full-trophy run, whatever is claimed', () => {
        const forged = { extracted: true, wardenKilled: true, carrierKilled: true, tyrantKilled: true, harbingerKilled: true, depth: 9999, elapsedMs: 60 * 60_000, sector: 99, marks: 100 }
        expect(voidRunMarks(forged)).toBe(VOID_MAX_RUN_MARKS)
        expect(VOID_MAX_RUN_MARKS).toBe(28)
    })

    it('pays fewer Marks in easier sectors', () => {
        // Warden, Tyrant and depth 3 in ninety seconds: the sector 1 farm.
        const farm = { extracted: true, wardenKilled: true, carrierKilled: false, tyrantKilled: true, depth: 3, elapsedMs: 90_000 }
        expect([1, 2, 3, 4, 5].map(sector => voidRunMarks({ ...farm, sector }))).toEqual([1, 3, 6, 9, 12])
        const full = { extracted: true, wardenKilled: true, carrierKilled: true, tyrantKilled: true, harbingerKilled: true, depth: 3, elapsedMs: 10 * 60_000 }
        expect([1, 2, 3, 4, 5].map(sector => voidRunMarks({ ...full, sector }))).toEqual([3, 7, 14, 21, 28])
        expect(voidRunMarks({ ...full, sector: 0 })).toBe(3)
    })

    it('lets capital kills bank their warp cores and nothing more', () => {
        const haul = { core: 99 }
        const plain = voidSettleRun({ extracted: true, haul, elapsedMs: 600_000, kills: 40, wardenKilled: false, depth: 2 }, 3, 1e9, 600_000)
        const tyrant = voidSettleRun({ extracted: true, haul, elapsedMs: 600_000, kills: 40, wardenKilled: false, tyrantKilled: true, depth: 2 }, 3, 1e9, 600_000)
        const both = voidSettleRun({ extracted: true, haul, elapsedMs: 600_000, kills: 40, wardenKilled: false, tyrantKilled: true, harbingerKilled: true, depth: 2 }, 3, 1e9, 600_000)
        expect(plain.haul.core).toBe(2)
        expect(tyrant.haul.core).toBe(2 + 3)
        expect(both.haul.core).toBe(2 + 3 + 5)
        // A Harbinger claimed from the home zone pays nothing.
        const forged = voidSettleRun({ extracted: true, haul, elapsedMs: 600_000, kills: 40, wardenKilled: false, harbingerKilled: true, depth: 1 }, 3, 1e9, 600_000)
        expect(forged.haul.core).toBe(2)
    })

    it('caps jump depth by elapsed time', () => {
        expect(voidAllowedDepth(8, 5_000)).toBe(1)
        expect(voidAllowedDepth(3, 60_000)).toBe(3)
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
        const run = { elapsedMs: 60_000, wardenKilled: false, carrierKilled: false }
        const full = { elapsedMs: 10 * 60_000, wardenKilled: true, carrierKilled: true }
        expect(voidGearCap(run, 0)).toBe(0)
        expect(voidGearCap({ ...run, elapsedMs: 90_000 }, 0)).toBe(1)
        expect(voidGearCap({ ...run, elapsedMs: 60 * 60_000 }, 0)).toBe(3)
        expect(voidGearCap(full, 0)).toBe(5)
        expect(voidGearCap({ ...run, elapsedMs: 5 * 60_000, tyrantKilled: true }, 0)).toBe(3)
        // Boss kills count on any run past ten seconds.
        expect(voidGearCap({ ...run, elapsedMs: 120_000, carrierKilled: true, wardenKilled: true }, 0)).toBe(3)
        expect(voidGearCap({ ...run, elapsedMs: 5_000, carrierKilled: true, wardenKilled: true }, 0)).toBe(0)
        expect(voidGearCap(full, VOID_DAILY_GEAR - 2)).toBe(2)
        expect(voidGearCap(full, VOID_DAILY_GEAR + 3)).toBe(0)
    })
})

describe('void run telemetry', () => {
    it('bounds a client blob to known shapes, short labels and clamped numbers', () => {
        const clean = voidCleanTelemetry({
            kills: { raider: 12, 'DROP TABLE': 5, mauler: -3 },
            elites: 2.6,
            damage: { 'tyrant:storm': 1e12, ok: 'junk' },
            bosses: [
                { id: 'tyrant', outcome: 'killed', depth: 99, firstHit: 100, lastHit: 400, killedAt: 410, hpLeft: 0, taken: 900 },
                { id: 'godzilla', outcome: 'killed' }
            ],
            zones: Array.from({ length: 40 }, () => ({ zone: 'ion', at: 10 })),
            death: { by: 'harbinger:pulse', boss: 'harbinger', depth: 2, zone: 'nebula', at: 700 },
            peakWanted: 9,
            lowestHull: -1
        })!
        expect(clean.kills).toEqual({ raider: 12, mauler: 0 })
        expect(clean.elites).toBe(3)
        expect(clean.damage).toEqual({ 'tyrant:storm': 1e8, ok: 0 })
        expect(clean.bosses).toHaveLength(1)
        expect(clean.bosses[0]!.depth).toBe(8)
        expect(clean.zones).toHaveLength(9)
        expect(clean.death).toEqual({ by: 'harbinger:pulse', boss: 'harbinger', depth: 2, zone: 'nebula', at: 700 })
        expect(clean.peakWanted).toBe(5)
        expect(clean.lowestHull).toBe(0)
        expect(voidCleanTelemetry('junk')).toBeNull()
    })
})

describe('void beacons', () => {
    const now = 1_800_000_000_000
    const hour = 60 * 60 * 1000

    it('reports every beacon as hostile until captured', () => {
        expect(voidBeaconStates({}, 2)).toEqual(['hostile', 'hostile'])
        expect(voidBeaconStates({ '2:1': { at: now } }, 2)).toEqual(['hostile', 'owned'])
        expect(voidBeaconStates({ '2:1': { at: now } }, 3)).toEqual(['hostile', 'hostile'])
    })

    it('captures only beacons the pilot does not hold, and only in a run long enough', () => {
        const short = voidApplyBeaconReport({}, 1, { captured: [0, 1] }, now, 90_000)
        expect(short.captured).toBe(1)
        const both = voidApplyBeaconReport({}, 1, { captured: [0, 1, 1, 7, -1, 'x'] }, now, 600_000)
        expect(both.captured).toBe(2)
        expect(Object.keys(both.records).sort()).toEqual(['1:0', '1:1'])
        const again = voidApplyBeaconReport(both.records, 1, { captured: [0] }, now + hour, 600_000)
        expect(again.captured).toBe(0)
        expect(again.records['1:0']!.at).toBe(now)
    })

    it('leaves a held beacon alone for 32 hours, then attacks one in four visits', () => {
        const held = { '3:0': { at: now } }
        expect(voidRollBeaconAttack(held, 3, now + 31 * hour, () => 0)).toBe(held)
        expect(voidRollBeaconAttack(held, 3, now + 33 * hour, () => 0.25)).toBe(held)
        expect(voidRollBeaconAttack(held, 2, now + 33 * hour, () => 0)).toBe(held)
        const hit = voidRollBeaconAttack(held, 3, now + 33 * hour, () => 0.1)
        expect(voidBeaconStates(hit, 3)).toEqual(['attacked', 'hostile'])
    })

    it('keeps an attack standing until it is beaten off, which restarts the clock', () => {
        const hit = { '3:0': { at: now, attacked: true }, '3:1': { at: now } }
        expect(voidRollBeaconAttack(hit, 3, now + 40 * hour, () => 0)).toBe(hit)
        const ignored = voidApplyBeaconReport(hit, 3, { defended: [1] }, now + 40 * hour, 600_000)
        expect(ignored.defended).toBe(0)
        const won = voidApplyBeaconReport(hit, 3, { defended: [0] }, now + 40 * hour, 600_000)
        expect(won.defended).toBe(1)
        expect(won.records['3:0']).toEqual({ at: now + 40 * hour })
        expect(voidRollBeaconAttack(won.records, 3, now + 41 * hour, () => 0)['3:0']!.attacked).toBeUndefined()
    })

    it('drops junk from stored records', () => {
        expect(voidCleanBeacons({ '1:0': { at: now }, '9:0': { at: now }, '1:5': { at: now }, '2:0': { at: 'x' }, '2:1': null })).toEqual({ '1:0': { at: now } })
        expect(voidCleanBeacons(null)).toEqual({})
    })
})
