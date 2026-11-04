import { describe, expect, it } from 'vitest'
import {
    VOID_SHIPS, VOID_MAX_RUN_MS,
    voidApplyBeaconReport, voidBeaconStates, voidCleanBeacons, voidRollBeaconAttack, voidBundleValue, voidCanAfford, voidDescribeState, voidLoadoutFor, voidNormalizeFit, voidSettleRun,
    VOID_MAX_SHIP_TIER, voidNormalizeShipTiers, voidShipTier,
    voidSectorUnlocked, voidShip, voidShipUnlocked, voidSubtractBundle, type VoidStateSnapshot
} from '#shared/utils/gamelogic/void'
import {
    VOID_BOUNTY_XP, VOID_DAILY_GEAR, VOID_PERKS, voidAllowedDepth, voidNormalizePerks, voidPerkCost, voidBountyXp, voidCapitalKills, voidGearCap, voidRunMarks, VOID_MAX_RUN_MARKS, VOID_MAX_RUN_CACHES
} from '#shared/utils/gamelogic/void-pilot'
import { voidCleanTelemetry } from '#shared/utils/gamelogic/void-telemetry'
import {
    VOID_ITEM_TYPES, VOID_RARITIES, voidCanCraftTier, voidDefenceStats, voidItemUpgradeCost, voidRollItem, voidRollMod, voidRollSalvagedGear,
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
    it('only builds the capstone hull for a pilot who owns every other ship', () => {
        const sovereign = voidShip('sovereign')
        const others = VOID_SHIPS.filter(s => s.id !== 'sovereign').map(s => s.id)
        expect(voidShipUnlocked(sovereign, 5, others)).toBe(true)
        expect(voidShipUnlocked(sovereign, 5, others.slice(1))).toBe(false)
        expect(voidShipUnlocked(sovereign, 4, others)).toBe(false)
        // Ordinary hulls only need their sector.
        expect(voidShipUnlocked(voidShip('tempest'), 5, ['sparrow'])).toBe(true)
        expect(voidShipUnlocked(voidShip('tempest'), 4, others)).toBe(false)
    })
})

describe('void runner gear', () => {
    it('only crafts up to one tier past the deepest cleared sector', () => {
        expect(voidCanCraftTier(1, 0)).toBe(true)
        expect(voidCanCraftTier(2, 0)).toBe(false)
        expect(voidCanCraftTier(2, 1)).toBe(true)
        expect(voidCanCraftTier(6, 9)).toBe(false)
    })

    it('stops levelling items at +10', () => {
        expect(voidItemUpgradeCost({ kind: 'turret', tier: 2, level: 9 })).not.toBeNull()
        expect(voidItemUpgradeCost({ kind: 'turret', tier: 2, level: 10 })).toBeNull()
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

    it('never reads a stored tier below the hull\'s own or above the cap', () => {
        expect(voidShipTier('aegis', { aegis: 1 })).toBe(3)
        expect(voidShipTier('wasp', { wasp: 99 })).toBe(VOID_MAX_SHIP_TIER)
        expect(voidNormalizeShipTiers({ nope: 4, wasp: 'x' })).toEqual({})
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
        const result = voidSettleRun({ extracted: false, haul: { ferrite: 30 }, elapsedMs: minutes(4), kills: 5, wardenKilled: true }, 1, minutes(4))
        expect(result.haul).toEqual({})
        expect(result.wardenKilled).toBe(false)
    })

    it('banks the haul exactly as the client counted it', () => {
        const haul = { ferrite: 650, cobalt: 100, scrap: 200 }
        const result = voidSettleRun({ extracted: true, haul, elapsedMs: minutes(3), kills: 9, wardenKilled: false }, 1, minutes(3))
        expect(result.haul).toEqual(haul)
        expect(result.units).toBe(950)
        expect(result.value).toBe(voidBundleValue(haul))
    })

    it('never trims the hold: off-sector ore, cores and big stacks all come home', () => {
        const haul = { ferrite: 100_000, xenite: 50, core: 99 }
        const result = voidSettleRun({ extracted: true, haul, elapsedMs: 30_000, kills: 0, wardenKilled: false }, 1, 30_000)
        expect(result.haul).toEqual(haul)
    })

    it('drops zero, negative and junk entries from the haul', () => {
        const result = voidSettleRun({ extracted: true, haul: { ferrite: 12.9, cobalt: 0, scrap: -5, bogus: 40 } as never, elapsedMs: minutes(3), kills: 0, wardenKilled: false }, 1, minutes(3))
        expect(result.haul).toEqual({ ferrite: 12 })
    })

    it('refuses a warden kill from a run too short to have reached the warden, but still pays its cores', () => {
        const quick = voidSettleRun({ extracted: true, haul: { core: 3 }, elapsedMs: 5_000, kills: 1, wardenKilled: true }, 3, 5_000)
        expect(quick.wardenKilled).toBe(false)
        expect(quick.haul.core).toBe(3)
        const real = voidSettleRun({ extracted: true, haul: { core: 3 }, elapsedMs: minutes(6), kills: 40, wardenKilled: true }, 3, minutes(6))
        expect(real.wardenKilled).toBe(true)
        expect(real.haul.core).toBe(3)
    })

    it('counts a geared pilot\'s fast sector 4 warden kill', () => {
        const fast = voidSettleRun({ extracted: true, haul: {}, elapsedMs: minutes(3), kills: 30, wardenKilled: true }, 4, minutes(3))
        expect(fast.wardenKilled).toBe(true)
    })

    it('clamps elapsed time to the server clock and the run limit', () => {
        expect(voidSettleRun({ extracted: true, haul: {}, elapsedMs: minutes(30), kills: 0, wardenKilled: false }, 1, minutes(5)).elapsedMs).toBe(minutes(5))
        expect(voidSettleRun({ extracted: true, haul: {}, elapsedMs: minutes(90), kills: 0, wardenKilled: false }, 1, minutes(90)).elapsedMs).toBe(VOID_MAX_RUN_MS)
    })
})

describe('void runner salvaged gear', () => {
    it('only rolls types craftable at the tier, keeping the better of two rarities', () => {
        for (let i = 0; i < 10; i++) {
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
        const base = { extracted: true, wardenKilled: false, carrierKilled: false, depth: 1, elapsedMs: 10 * 60_000, sector: 3 }
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
    })

    it('caps jump depth by elapsed time', () => {
        expect(voidAllowedDepth(8, 5_000)).toBe(1)
        expect(voidAllowedDepth(3, 60_000)).toBe(3)
        expect(voidAllowedDepth(3, 6 * 60_000)).toBe(3)
        expect(voidAllowedDepth(99, 3_600_000)).toBe(8)
    })

    it('prices perks per rank and stops at max', () => {
        for (const perk of VOID_PERKS) {
            expect(voidPerkCost(perk.id, 0)).toBe(perk.costs[0])
            expect(voidPerkCost(perk.id, perk.costs.length)).toBeNull()
        }
        expect(voidNormalizePerks({ harness: 99, bogus: 3 }).harness).toBe(3)
    })
})


describe('void runner bounties and gear caps', () => {
    it('caps reported bounty XP at two bounties per run', () => {
        expect(voidBountyXp(999)).toBe(VOID_BOUNTY_XP * 2)
        expect(voidBountyXp(40)).toBe(40)
        expect(voidBountyXp('junk')).toBe(0)
        expect(voidBountyXp(-80)).toBe(0)
    })

    it('caps salvaged gear by the per-run sanity limit and the daily limit', () => {
        expect(voidGearCap(0)).toBe(Math.min(VOID_DAILY_GEAR, VOID_MAX_RUN_CACHES))
        expect(voidGearCap(VOID_DAILY_GEAR - 2)).toBe(2)
        expect(voidGearCap(VOID_DAILY_GEAR + 3)).toBe(0)
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
