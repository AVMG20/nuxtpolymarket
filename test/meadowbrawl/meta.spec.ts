import { describe, expect, it } from 'vitest'
import {
    MEADOWBRAWL_MAX_PAYOUT,
    MEADOWBRAWL_PETS,
    MEADOWBRAWL_PET_MAX_LEVEL,
    MEADOWBRAWL_SAVE_VERSION,
    MEADOWBRAWL_TOTAL_WAVES,
    MEADOWBRAWL_UPGRADES,
    MEADOWBRAWL_WEAPON_IDS,
    MEADOWBRAWL_WEAPON_UNLOCKS,
    meadowbrawlAccountEffects,
    meadowbrawlCoinCeiling,
    meadowbrawlMinElapsedMsForWave,
    meadowbrawlPayoutForRun,
    meadowbrawlPetCost,
    meadowbrawlPetEffects,
    meadowbrawlRunCooldownRemainingMs,
    meadowbrawlRushGemCost,
    meadowbrawlSettleRun,
    meadowbrawlTotalUpgradeCost,
    meadowbrawlUnlockedWeapons,
    meadowbrawlUpgradeCost,
    meadowbrawlValidateSave,
    type MeadowbrawlRunSave,
    type MeadowbrawlSettlementState
} from '../../shared/utils/gamelogic/meadowbrawl-meta'

function save(over: Partial<MeadowbrawlRunSave> = {}): MeadowbrawlRunSave {
    return {
        version: MEADOWBRAWL_SAVE_VERSION,
        wave: 5,
        hp: 80,
        maxHp: 100,
        upgrades: { might: 2, haste: 2 },
        offers: ['vigor', 'flow', 'burn'],
        rerolled: false,
        coins: 9000,
        phoenixUsed: 0,
        stats: { kills: 60, elitesKilled: 1, damageDealt: 4000, damageTaken: 120, highestCombo: 9, time: 300 },
        ...over
    }
}

function account(over: Partial<MeadowbrawlSettlementState> = {}): MeadowbrawlSettlementState {
    return {
        runWeapon: 'sword',
        runCoinMult: '1.0000',
        runSave: null,
        runsPlayed: 0,
        victories: 0,
        totalEarned: '0',
        bestEarned: 0,
        bestWave: 0,
        bestWaveByWeapon: {},
        unlockedWeapons: [],
        ...over
    }
}

const HOURS = 60 * 60 * 1000

describe('meadowbrawl economy', () => {
    it('the whole sink lands between 500M and 800M', () => {
        const total = meadowbrawlTotalUpgradeCost()
        expect(total).toBeGreaterThan(500_000_000)
        expect(total).toBeLessThan(800_000_000)
    })

    it('every track grows exponentially and stops at its cap', () => {
        for (const def of MEADOWBRAWL_UPGRADES) {
            let prev = 0
            for (let level = 0; level < def.max; level++) {
                const cost = meadowbrawlUpgradeCost(def, level)!
                expect(cost).toBeGreaterThan(prev)
                prev = cost
            }
            expect(meadowbrawlUpgradeCost(def, def.max)).toBeNull()
        }
        for (const pet of MEADOWBRAWL_PETS) {
            expect(meadowbrawlPetCost(pet, 0)).toBe(pet.baseCost)
            expect(meadowbrawlPetCost(pet, MEADOWBRAWL_PET_MAX_LEVEL)).toBeNull()
        }
    })

    it('the coin ceiling climbs every wave', () => {
        expect(meadowbrawlCoinCeiling(0)).toBe(0)
        for (let w = 1; w <= MEADOWBRAWL_TOTAL_WAVES; w++) {
            expect(meadowbrawlCoinCeiling(w)).toBeGreaterThan(meadowbrawlCoinCeiling(w - 1))
        }
        expect(meadowbrawlCoinCeiling(99)).toBe(meadowbrawlCoinCeiling(MEADOWBRAWL_TOTAL_WAVES))
    })

    it('a maxed account clearing all thirty waves pays between 1M and 2M', () => {
        const maxed = meadowbrawlAccountEffects({ prosperity: 10, vitality: 5, tempering: 5, nimble: 2, fortune: 2 })
        const owl = meadowbrawlPetEffects('owl', 10)
        const mult = maxed.coinMult * owl.coinMult
        const win = meadowbrawlPayoutForRun(1e12, MEADOWBRAWL_TOTAL_WAVES, mult, true)
        expect(win.capped).toBe(true)
        expect(win.awarded).toBeGreaterThan(1_000_000)
        expect(win.awarded).toBeLessThanOrEqual(MEADOWBRAWL_MAX_PAYOUT)
        // Waves fifteen to twenty, where most good runs end, sit in the 250-500k band.
        const mid = meadowbrawlPayoutForRun(1e12, 16, mult, false).awarded
        const deep = meadowbrawlPayoutForRun(1e12, 20, mult, false).awarded
        expect(mid).toBeGreaterThan(250_000)
        expect(deep).toBeLessThan(600_000)
        // A bare account is far below that.
        expect(meadowbrawlPayoutForRun(1e12, 10, 1, false).awarded).toBeLessThan(50_000)
    })

    it('honest coins pass through untouched', () => {
        const p = meadowbrawlPayoutForRun(5000, 5, 1.4, false)
        expect(p.counted).toBe(5000)
        expect(p.awarded).toBe(7000)
        expect(p.capped).toBe(false)
    })

    it('the pacing floor is far under a real run and the cooldown costs a gem per ten minutes', () => {
        expect(meadowbrawlMinElapsedMsForWave(5)).toBeLessThan(60_000)
        expect(meadowbrawlMinElapsedMsForWave(30)).toBeLessThan(10 * 60_000)
        const finished = new Date(1_000_000)
        expect(meadowbrawlRunCooldownRemainingMs(null, 5)).toBe(0)
        expect(meadowbrawlRunCooldownRemainingMs(finished, finished.getTime() + HOURS)).toBe(HOURS)
        expect(meadowbrawlRunCooldownRemainingMs(finished, finished.getTime() + 3 * HOURS)).toBe(0)
        expect(meadowbrawlRushGemCost(2 * HOURS)).toBe(12)
        expect(meadowbrawlRushGemCost(1)).toBe(1)
        expect(meadowbrawlRushGemCost(0)).toBe(0)
    })
})

describe('meadowbrawl pets', () => {
    it('unlock their abilities at three and six and double their potency at ten', () => {
        expect(meadowbrawlPetEffects('fox', 1).abilities).toHaveLength(0)
        expect(meadowbrawlPetEffects('fox', 3).abilities.map(a => a.id)).toEqual(['flameDash'])
        expect(meadowbrawlPetEffects('fox', 6).abilities.map(a => a.id)).toEqual(['flameDash', 'cinderHowl'])
        expect(meadowbrawlPetEffects('fox', 9).potency).toBe(1)
        expect(meadowbrawlPetEffects('fox', 10).potency).toBe(2)
        // Cooldowns shrink with levels past the unlock.
        const early = meadowbrawlPetEffects('owl', 3).abilities[0]!.cooldown
        const late = meadowbrawlPetEffects('owl', 10).abilities[0]!.cooldown
        expect(late).toBeLessThan(early)
    })

    it('stay useful but modest', () => {
        expect(meadowbrawlPetEffects('fox', 10).damageMult).toBeCloseTo(1.15)
        expect(meadowbrawlPetEffects('tortoise', 10).damageReduction).toBeCloseTo(0.1)
        expect(meadowbrawlPetEffects('tortoise', 10).maxHp).toBe(30)
        expect(meadowbrawlPetEffects('owl', 10).coinMult).toBeCloseTo(1.1)
        expect(meadowbrawlPetEffects('tortoise', 10).damageMult).toBe(1)
    })
})

describe('meadowbrawl weapon unlocks', () => {
    it('only the sword is free', () => {
        expect(meadowbrawlUnlockedWeapons({})).toEqual(['sword'])
    })

    it('every feat needs a different weapon, so one class cannot unlock the rest', () => {
        const required = MEADOWBRAWL_WEAPON_UNLOCKS.map(u => u.requires)
        expect(new Set(required).size).toBe(required.length)
        const unlockedByOne = meadowbrawlUnlockedWeapons({ sword: 30 })
        expect(unlockedByOne).toEqual(['sword', 'greataxe'])
    })

    it('chains through the roster in order and earlier feats stay earned', () => {
        const best = { sword: 4, greataxe: 8, spear: 10, daggers: 12, warhammer: 14 }
        expect(meadowbrawlUnlockedWeapons(best)).toEqual(MEADOWBRAWL_WEAPON_IDS)
        expect(meadowbrawlUnlockedWeapons({ sword: 3 })).toEqual(['sword'])
        expect(meadowbrawlUnlockedWeapons({}, ['scythe', 'bogus'])).toEqual(['sword', 'scythe'])
    })
})

describe('meadowbrawl checkpoints', () => {
    it('accepts the shape the game writes', () => {
        expect(meadowbrawlValidateSave(save(), 3)).toBe(true)
        expect(meadowbrawlValidateSave(save({ offers: null, upgrades: { might: 5 } }), 3)).toBe(true)
    })

    it('rejects more boons than cleared waves, too many offers, and bad shapes', () => {
        expect(meadowbrawlValidateSave(save({ upgrades: { might: 5 } }), 3)).toBe(false)
        expect(meadowbrawlValidateSave(save({ offers: ['a', 'b', 'c', 'd'] }), 3)).toBe(false)
        expect(meadowbrawlValidateSave(save({ offers: ['a', 'b', 'c', 'd'] }), 4)).toBe(true)
        expect(meadowbrawlValidateSave(save({ wave: 30 }), 3)).toBe(false)
        expect(meadowbrawlValidateSave(save({ wave: 0 }), 3)).toBe(false)
        expect(meadowbrawlValidateSave(save({ hp: 500 }), 3)).toBe(false)
        expect(meadowbrawlValidateSave(save({ coins: -1 }), 3)).toBe(false)
        expect(meadowbrawlValidateSave(save({ coins: 1.5 }), 3)).toBe(false)
        expect(meadowbrawlValidateSave(save({ version: 0 }), 3)).toBe(false)
        expect(meadowbrawlValidateSave(save({ upgrades: { 'Bad Id!': 1 } }), 3)).toBe(false)
        expect(meadowbrawlValidateSave(null, 3)).toBe(false)
        expect(meadowbrawlValidateSave('x', 3)).toBe(false)
    })
})

describe('meadowbrawl settlement', () => {
    it('caps depth at one wave past the checkpoint and coins at what those waves drop', () => {
        const r = meadowbrawlSettleRun(account({ runSave: save({ wave: 5, coins: 9000 }), runCoinMult: '2.0000' }), {
            wave: 25, coins: 1e9, won: false, abandoned: false
        }, 30 * 60_000)
        expect(r.cleared).toBe(6)
        expect(r.counted).toBe(meadowbrawlCoinCeiling(7))
        expect(r.awarded).toBe(Math.floor(meadowbrawlCoinCeiling(7) * 2))
        expect(r.capped).toBe(true)
        expect(r.won).toBe(false)
        expect(r.bestWaveByWeapon.sword).toBe(6)
        expect(r.runsPlayed).toBe(1)
    })

    it('pays an honest death exactly and records the feat for the weapon', () => {
        const r = meadowbrawlSettleRun(account({ runWeapon: 'greataxe', runSave: save({ wave: 8, coins: 20000 }), runCoinMult: '1.2000' }), {
            wave: 9, coins: 21000, won: false, abandoned: false
        }, 20 * 60_000)
        expect(r.cleared).toBe(8)
        expect(r.counted).toBe(21000)
        expect(r.awarded).toBe(25200)
        expect(r.capped).toBe(false)
        expect(r.newlyUnlocked).toEqual(['spear'])
        expect(r.unlockedWeapons).toEqual(['sword', 'spear'])
    })

    it('a win needs a checkpoint at the doorstep of the last wave', () => {
        const fake = meadowbrawlSettleRun(account({ runSave: save({ wave: 5 }) }), { wave: 30, coins: 1e9, won: true, abandoned: false }, 60 * 60_000)
        expect(fake.won).toBe(false)
        expect(fake.cleared).toBe(6)
        const real = meadowbrawlSettleRun(account({ runSave: save({ wave: 29, coins: 300000 }) }), { wave: 30, coins: 380000, won: true, abandoned: false }, 60 * 60_000)
        expect(real.won).toBe(true)
        expect(real.cleared).toBe(30)
        expect(real.victories).toBe(1)
        expect(real.awarded).toBe(Math.floor(380000 * 1.25))
    })

    it('falls back to the checkpoint when the clock says the depth is impossible', () => {
        const r = meadowbrawlSettleRun(account({ runSave: save({ wave: 20, coins: 100000 }) }), { wave: 21, coins: 120000, won: false, abandoned: false }, 5000)
        expect(r.cleared).toBe(20)
        expect(r.counted).toBe(120000)
    })

    it('an abandoned run settles from its checkpoint alone', () => {
        const r = meadowbrawlSettleRun(account({ runSave: save({ wave: 7, coins: 15000 }) }), { wave: 99, coins: 1e9, won: true, abandoned: true }, 60 * 60_000)
        expect(r.cleared).toBe(7)
        expect(r.counted).toBe(15000)
        expect(r.won).toBe(false)
        const nothing = meadowbrawlSettleRun(account(), { wave: 99, coins: 1e9, won: true, abandoned: true }, 60 * 60_000)
        expect(nothing.cleared).toBe(0)
        expect(nothing.awarded).toBe(0)
    })

    it('a run with no checkpoint still pays for its first wave', () => {
        const r = meadowbrawlSettleRun(account(), { wave: 1, coins: 800, won: false, abandoned: false }, 60_000)
        expect(r.cleared).toBe(0)
        expect(r.counted).toBe(800)
        expect(r.awarded).toBe(800)
    })
})
