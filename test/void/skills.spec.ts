import { describe, expect, it } from 'vitest'
import {
    VOID_MAX_PILOT_LEVEL, VOID_SKILLS, voidPilotLevel, voidRunXp, voidSkillCooldown, voidSkillParams, voidSkillPoints,
    voidValidateSkillNodes, voidXpForLevel
} from '#shared/utils/gamelogic/void-skills'
import { voidSellPrice, voidTradeCost, voidTradeMult, VOID_MARKET_PRICES } from '#shared/utils/gamelogic/void'

describe('void pilot skills', () => {
    it('has six skills with one free starter and eleven nodes each', () => {
        expect(VOID_SKILLS).toHaveLength(6)
        expect(VOID_SKILLS.filter(s => s.coins === 0 && !Object.keys(s.cost).length).map(s => s.id)).toEqual(['seeker'])
        for (const s of VOID_SKILLS) {
            expect(s.nodes).toHaveLength(11)
            expect(s.nodes.filter(n => n.keystone)).toHaveLength(2)
        }
    })

    it('levels from xp and never hands out enough points to fill a tree', () => {
        expect(voidPilotLevel(0)).toBe(1)
        expect(voidPilotLevel(voidXpForLevel(10))).toBe(10)
        expect(voidPilotLevel(voidXpForLevel(10) - 1)).toBe(9)
        expect(voidPilotLevel(1e12)).toBe(VOID_MAX_PILOT_LEVEL)
        expect(voidSkillPoints(1)).toBe(1)
        expect(voidSkillPoints(VOID_MAX_PILOT_LEVEL)).toBeLessThan(10)
    })

    it('validates trees: parents, point budget and a single keystone', () => {
        expect(voidValidateSkillNodes('seeker', ['a1'], 1)).toEqual(['a1'])
        expect(voidValidateSkillNodes('seeker', ['a2'], 25)).toBeNull()
        expect(voidValidateSkillNodes('seeker', ['a1', 'b1'], 1)).toBeNull()
        expect(voidValidateSkillNodes('seeker', ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'k1'], 25)).not.toBeNull()
        expect(voidValidateSkillNodes('seeker', ['b1', 'b2', 'b3', 'c1', 'c2', 'c3', 'k2'], 25)).not.toBeNull()
        expect(voidValidateSkillNodes('seeker', ['a1', 'a2', 'a3', 'k1', 'b1', 'b2', 'k2'], 25)).toBeNull()
        expect(voidValidateSkillNodes('seeker', ['nope'], 25)).toBeNull()
        expect(voidValidateSkillNodes('nope', [], 25)).toBeNull()
    })

    it('sums node mods and keeps cooldowns sane', () => {
        const params = voidSkillParams('seeker', ['b1', 'b2', 'b3'])
        expect(params.count).toBe(4)
        expect(voidSkillCooldown(params)).toBeCloseTo(8 * 0.85)
        for (const s of VOID_SKILLS) expect(voidSkillCooldown(voidSkillParams(s.id, s.nodes.map(n => n.id)))).toBeGreaterThanOrEqual(2)
    })

    it('caps xp from a forged report by wall-clock time', () => {
        const honest = voidRunXp({ extracted: true, kills: 25, elapsedMs: 5 * 60_000, wardenKilled: false, tier: 1, skillUses: 20 })
        const forged = voidRunXp({ extracted: true, kills: 100_000, elapsedMs: 5 * 60_000, wardenKilled: false, tier: 1, skillUses: 100_000 })
        expect(honest).toBeGreaterThan(100)
        expect(forged).toBeLessThan(1500)
    })
})

describe('void trade contracts', () => {
    it('scales hard from 10M to 10B over ten levels', () => {
        expect(voidTradeCost(0)).toBe(10_000_000)
        expect(voidTradeCost(9)).toBe(10_000_000_000)
        expect(voidTradeCost(10)).toBeNull()
        for (let l = 1; l < 10; l++) expect(voidTradeCost(l)!).toBeGreaterThan(voidTradeCost(l - 1)! * 1.8)
    })

    it('multiplies sell prices', () => {
        expect(voidTradeMult(0)).toBe(1)
        expect(voidSellPrice('ferrite', 0)).toBe(VOID_MARKET_PRICES.ferrite)
        expect(voidSellPrice('ferrite', 10)).toBe(VOID_MARKET_PRICES.ferrite * 8)
    })
})
