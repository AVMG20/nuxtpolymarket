/**
 * The stat breakdown, checked against the stats the game actually fights with: every stat's last
 * stage must equal what `partyUnitStats` computed, for the Hero and for every fielded Champion, so
 * the breakdown is a decomposition rather than a second implementation that can drift.
 */

import { describe, expect, it } from 'vitest'
import { explainStats } from '#shared/utils/hero-quest/explain'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { maxHpFor } from '#shared/utils/hero-quest/combat'
import { CHAMPIONS, RARITY_STAT_MULTIPLIER, getChampion } from '#shared/utils/hero-quest/content/champions'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import type { ChampionSnapshot, HeroSnapshot } from '#shared/utils/hero-quest/types'

function hero(over: Partial<HeroSnapshot> = {}): HeroSnapshot {
    return {
        classId: 'class_beginner',
        heroLevel: 1,
        heroXp: ZERO,
        goldBonusPct: 0,
        offlineEfficiencyLevel: 0,
        offlineCapLevel: 0,
        ...over
    }
}

function fielded(championId: string): ChampionSnapshot {
    const definition = getChampion(championId)
    return {
        championId: definition.id,
        archetype: definition.archetype,
        rarityMultiplier: RARITY_STAT_MULTIPLIER[definition.rarity],
        investment: 1,
        strikesPerAttack: definition.strikesPerAttack,
        row: 'back',
        abilities: definition.abilities
    }
}

describe('agreement with the stats the game fights with', () => {
    const cases: [string, HeroSnapshot][] = [
        ['level-1 solo Beginner', hero()],
        ['level-40 Berserker', hero({ classId: 'class_berserker', heroLevel: 40 })],
        ['a hero with a collection passive', hero({
            heroLevel: 30,
            ownedChampions: CHAMPIONS.slice(0, 12).map(c => ({ archetype: c.archetype, investment: 20 }))
        })],
        ['a hero with two fielded Champions', hero({
            heroLevel: 60,
            champions: [fielded(CHAMPIONS[0]!.id), fielded(CHAMPIONS[1]!.id)]
        })]
    ]

    for (const [label, snapshot] of cases) {
        it(`reproduces every final stat for ${label}`, () => {
            const explained = explainStats(snapshot)
            const units = partyUnitStats(snapshot)
            expect(explained.units).toHaveLength(units.length)

            explained.units.forEach((unit, index) => {
                const actual = units[index]!
                const find = (key: string) => unit.stats.find(stat => stat.key === key)!

                expect(find('pwr').final.toString(), `${label} #${index} pwr`).toBe(actual.pwr.toString())
                expect(find('def').final.toString(), `${label} #${index} def`).toBe(actual.def.toString())
                expect(find('spd').final.toString(), `${label} #${index} spd`).toBe(actual.spd.toString())
                // VIT is not on `UnitStats` directly — it is the input to max HP, which is.
                expect(maxHpFor(find('vit').final).toString()).toBe(actual.maxHp.toString())
            })
        })
    }
})
