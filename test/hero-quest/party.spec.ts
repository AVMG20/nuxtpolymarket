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
import { partyDps } from '#shared/utils/hero-quest/combat'
import { CHAMPION_INVESTMENT_PER_POINT, K } from '#shared/utils/hero-quest/constants'
import { D, ZERO } from '#shared/utils/hero-quest/numbers'
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

    it('rewards rarity and investment on top of the Hero-driven baseline', () => {
        const base = heroStatBlock('class_beginner', 20)
        const plain = championStatBlock(base, champion(), 20)
        const rare = championStatBlock(base, champion({ rarityMultiplier: 2.5 }), 20)
        const maxed = championStatBlock(base, champion({ investment: 60 }), 20)

        expect(rare.pwr).toBeCloseTo(plain.pwr * 2.5, 6)
        expect(maxed.pwr).toBeCloseTo(plain.pwr * (1 + 59 * CHAMPION_INVESTMENT_PER_POINT), 6)
    })

    it('makes party size worth real depth, not just speed', () => {
        // A DEF that pins the solo Hero to the damage floor is still genuinely cut by a
        // party — the property the whole pooling change exists to produce.
        const solo = partyUnitStats(hero(30))
        // Exactly the DEF at which `mitigation` clamps for one body — `PWR × K`, read from the
        // constant so a retune of K moves the wall with it rather than silently unpinning it.
        const wall = solo[0]!.pwr.mul(K)
        const trio = partyUnitStats(hero(30, [champion(), champion()]))

        // "Shut out" means pinned to MIN_DAMAGE, not zero. Measured
        // against an unreachable DEF rather than hardcoded, so it survives a retune.
        expect(partyDps(solo, wall).toNumber()).toBe(partyDps(solo, D('1e300')).toNumber())
        expect(partyDps(trio, wall).toNumber()).toBeGreaterThan(partyDps(trio, D('1e300')).toNumber())
    })
})

describe('cooldown SPD', () => {
    const party = (heroLevel: number): HeroSnapshot => ({
        classId: 'class_mage', heroLevel, heroXp: ZERO, goldBonusPct: 0, offlineEfficiencyLevel: 0,
        offlineCapLevel: 0, champions: [champion()]
    })

    it('leaves the level curve out, so cooldowns stop shrinking as the party levels', () => {
        const low = partyUnitStats(party(1))
        const high = partyUnitStats(party(300))
        for (const [index, unit] of high.entries()) {
            expect(unit.spd.gt(low[index]!.spd)).toBe(true)
            expect(unit.cooldownSpd.toString()).toBe(low[index]!.cooldownSpd.toString())
        }
    })

    it('still carries every multiplier, so a SPD investment shortens cooldowns', () => {
        const plain = partyUnitStats(party(300))[0]!
        const invested = partyUnitStats({
            ...party(300),
            ownedChampions: [{ archetype: 'control', investment: 60 }]
        })[0]!
        expect(invested.cooldownSpd.gt(plain.cooldownSpd)).toBe(true)
    })
})
