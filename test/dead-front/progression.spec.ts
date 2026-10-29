import { describe, expect, it } from 'vitest'
import { DF_PERK_LEVEL_XP, dfPerkLevel, dfPerkLevelProgress, dfPerkXpFromMatch } from '#shared/utils/dead-front/progression'
import type { DfMatchResult } from '#shared/utils/dead-front/types'

const match = (rounds: number, kills: number, egg = false): DfMatchResult => ({
    roundsSurvived: rounds, kills, headshots: 0, downs: 0, weaponKills: {}, weaponsFound: [], completedEasterEgg: egg
})

describe('dead front research curve', () => {
    it('levels 0..6', () => {
        expect(dfPerkLevel(0)).toBe(0)
        expect(dfPerkLevel(DF_PERK_LEVEL_XP[0]!)).toBe(1)
        expect(dfPerkLevel(1e9)).toBe(6)
        expect(dfPerkLevelProgress(1e9).frac).toBe(1)
    })

    it('rewards the easter egg and ignores junk input', () => {
        expect(dfPerkXpFromMatch(match(10, 100, true))).toBe(dfPerkXpFromMatch(match(10, 100)) + 300)
        expect(dfPerkXpFromMatch(match(-5, Number.NaN))).toBe(100)
    })
})
