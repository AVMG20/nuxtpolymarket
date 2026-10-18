import { describe, expect, it } from 'vitest'
import { dfMergeMatchResult, dfNormalizeProfile, dfValidateLoadout, dfValidateMods } from '#server/utils/dead-front-profile-rules'
import type { DfProfileView } from '#shared/utils/dead-front/types'

const fresh = (): DfProfileView => dfNormalizeProfile({
    unlockedWeapons: ['m1911'], weaponXp: {}, loadout: { startWeapon: 'm1911', attachments: {} },
    researchPerk: null, perkXp: {}, perkMods: {}, gamesPlayed: 0, bestRound: 0, totalKills: 0, eggsCompleted: 0
})

describe('dead front profile rules', () => {
    it('normalises junk rows', () => {
        const v = dfNormalizeProfile({
            unlockedWeapons: ['bogus', 'kar98k'], weaponXp: { kar98k: 50, nope: 5 }, loadout: { startWeapon: 'lewis' },
            researchPerk: 'nope', perkXp: { ironhide: -3 }, perkMods: { ironhide: ['ironhide-deathwish'] },
            gamesPlayed: 1, bestRound: 3, totalKills: 9, eggsCompleted: 0
        })
        expect(v.unlockedWeapons).toEqual(['m1911', 'kar98k'])
        expect(v.weaponXp).toEqual({ kar98k: 50 })
        expect(v.loadout.startWeapon).toBe('m1911')
        expect(v.researchPerk).toBeNull()
        expect(v.perkMods).toEqual({})
    })

    it('rejects locked or unstartable start weapons', () => {
        const v = fresh()
        expect(dfValidateLoadout(v, 'kar98k', {})).toBeNull()
        v.unlockedWeapons.push('kar98k', 'xray')
        expect(dfValidateLoadout(v, 'kar98k', {})?.startWeapon).toBe('kar98k')
        expect(dfValidateLoadout(v, 'xray', {})).toBeNull()
    })

    it('validates modifiers against research level', () => {
        expect(dfValidateMods('ironhide', ['ironhide-sandbag'], 0)).toEqual([])
        expect(dfValidateMods('ironhide', ['ironhide-sandbag', 'ironhide-sandbag', 'ironhide-quickmend', 'ironhide-bloodletter'], 6)).toEqual(['ironhide-sandbag', 'ironhide-quickmend'])
    })

    it('merges a match result', () => {
        const v = { ...fresh(), researchPerk: 'twinfire' as const }
        const { next, report } = dfMergeMatchResult(v, {
            roundsSurvived: 12, kills: 150, headshots: 30, downs: 1,
            weaponKills: { m1911: 20, kar98k: 40 }, weaponsFound: ['kar98k', 'kar98k', 'm1911'], completedEasterEgg: true
        })
        expect(report.newWeapons).toEqual(['kar98k'])
        expect(next.unlockedWeapons).toEqual(['m1911', 'kar98k'])
        expect(report.perk).toBe('twinfire')
        expect(report.perkLevelBefore).toBe(0)
        expect(report.perkLevelAfter).toBeGreaterThan(0)
        expect(next.perkXp.twinfire).toBe(report.perkXpGained)
        expect(next.weaponXp.kar98k).toBeGreaterThan(0)
        expect(next.gamesPlayed).toBe(1)
        expect(next.bestRound).toBe(12)
        expect(next.totalKills).toBe(150)
        expect(next.eggsCompleted).toBe(1)
    })
})
