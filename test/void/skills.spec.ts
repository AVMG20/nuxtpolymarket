import { describe, expect, it } from 'vitest'
import {
    VOID_MAX_PILOT_LEVEL, voidPilotLevel, voidRunXp, voidSkillPoints, voidValidateSkillNodes, voidXpForLevel
} from '#shared/utils/gamelogic/void-skills'
import { voidTradeCost } from '#shared/utils/gamelogic/void'

describe('void pilot skills', () => {
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

    it('caps xp from a forged report by wall-clock time', () => {
        const honest = voidRunXp({ extracted: true, kills: 25, elapsedMs: 5 * 60_000, wardenKilled: false, tier: 1, skillUses: 20 })
        const forged = voidRunXp({ extracted: true, kills: 100_000, elapsedMs: 5 * 60_000, wardenKilled: false, tier: 1, skillUses: 100_000 })
        expect(honest).toBeGreaterThan(100)
        expect(forged).toBeLessThan(1500)
    })
})

describe('void trade contracts', () => {
    it('stops at ten levels', () => {
        expect(voidTradeCost(9)).not.toBeNull()
        expect(voidTradeCost(10)).toBeNull()
    })
})
