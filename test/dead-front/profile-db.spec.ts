import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'
import { applyDfMatchResult, getDfProfile, withLockedDfProfile } from '#server/utils/dead-front-profile'
import { dfPerkXpFromMatch } from '#shared/utils/dead-front/progression'
import type { DfMatchResult } from '#shared/utils/dead-front/types'

const USER = `df-profile-test-${Date.now().toString(36)}`

const result: DfMatchResult = {
    roundsSurvived: 8, kills: 60, headshots: 10, downs: 1,
    weaponKills: { m1911: 10 }, weaponsFound: ['mp18'], completedEasterEgg: false
}

describe.skipIf(SKIP)('dead front profile (db)', () => {
    beforeAll(async () => {
        await seedUser(USER)
    })
    afterAll(async () => {
        await cleanupUser(USER)
    })

    it('creates the row and merges parallel match results without losing writes', async () => {
        const first = await getDfProfile(USER)
        expect(first.unlockedWeapons).toEqual(['m1911'])
        await withLockedDfProfile(USER, view => ({ next: { ...view, researchPerk: 'fleetfoot' }, out: null }))
        await Promise.all(Array.from({ length: 6 }, () => applyDfMatchResult(USER, result)))
        const after = await getDfProfile(USER)
        expect(after.gamesPlayed).toBe(6)
        expect(after.totalKills).toBe(360)
        expect(after.weaponXp.m1911).toBeGreaterThan(0)
        expect(after.unlockedWeapons).toContain('mp18')
        expect(after.perkXp.fleetfoot).toBe(dfPerkXpFromMatch(result) * 6)
    })
})
