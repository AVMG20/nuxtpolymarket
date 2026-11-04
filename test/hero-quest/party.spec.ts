/**
 * Party composition.
 *
 * These specs are about *shape*: that a Champion's power is driven by the Hero's level rather
 * than its own (Champions have no XP level — only the bounded `star × 10 + level` dupe
 * scalar), and that nothing downstream assumes a party of one. Roster content is covered in
 * `content.spec.ts`; survivability and formation in `formation.spec.ts`.
 */

import { describe, expect, it } from 'vitest'
import { championStatBlock, heroStatBlock, partyUnitStats } from '#shared/utils/hero-quest/stats'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import type { ChampionSnapshot, HeroSnapshot } from '#shared/utils/hero-quest/types'

function champion(overrides: Partial<ChampionSnapshot> = {}): ChampionSnapshot {
    return {
        championId: 'champ_test',
        archetype: 'damage',
        rarityMultiplier: 1,
        investment: 1,
        strikesPerAttack: 1,
        row: 'back',
        // Stat-pipeline specs — `partyUnitStats` derives no skill term, so an ability list
        // would be inert here either way.
        abilities: [],
        ...overrides
    }
}

function hero(heroLevel: number, champions: ChampionSnapshot[] = []): HeroSnapshot {
    return {
        classId: 'class_beginner',
        heroLevel,
        heroXp: ZERO,
        goldBonusPct: 0,
        offlineEfficiencyLevel: 0,
        offlineCapLevel: 0,
        champions
    }
}

describe('party composition', () => {
    it('fields the Hero alone when no Champions are present', () => {
        expect(partyUnitStats(hero(10))).toHaveLength(1)
        expect(partyUnitStats({ ...hero(10), champions: undefined })).toHaveLength(1)
    })

    it('puts the Hero first and keeps every fielded Champion', () => {
        const units = partyUnitStats(hero(10, [champion(), champion({ championId: 'champ_two' })]))
        expect(units).toHaveLength(3)

        const solo = partyUnitStats(hero(10))[0]!
        expect(units[0]!.pwr.eq(solo.pwr)).toBe(true)
    })

    it('scales Champions off the Hero level, which is what stops them becoming dead weight', () => {
        const base = heroStatBlock('class_beginner', 1)
        const low = championStatBlock(base, champion(), 1)
        const high = championStatBlock(base, champion(), 50)

        expect(high.pwr.gt(low.pwr)).toBe(true)
        // An un-invested Champion is exactly a Hero-equivalent body, never a penalty.
        expect(low.pwr.toNumber()).toBeCloseTo(base.pwr.toNumber(), 10)
    })
})
