/**
 * The cooldowns the battle stage casts on are the fight's own.
 *
 * `partyKits` is served with the hero so the stage can fire each ability the moment its cooldown
 * ends. The claim worth pinning is that this is the fight's clock and not a second one: in a real
 * seeded fight, every ability's first cast lands on the cooldown served for it.
 */

import { describe, expect, it } from 'vitest'
import { runFight } from '#shared/utils/hero-quest/fight'
import { partyKits } from '#shared/utils/hero-quest/projection'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { FIGHT_TICK_SECONDS } from '#shared/utils/hero-quest/constants'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import { RARITY_STAT_MULTIPLIER, getChampion } from '#shared/utils/hero-quest/content/champions'
import type { HeroSnapshot } from '#shared/utils/hero-quest/types'

function party(level: number): HeroSnapshot {
    const champions = ['champ_kaira', 'champ_borin', 'champ_lys'].map((id) => {
        const d = getChampion(id as never)
        return {
            championId: d.id, archetype: d.archetype, rarityMultiplier: RARITY_STAT_MULTIPLIER[d.rarity],
            investment: 1, strikesPerAttack: d.strikesPerAttack, row: 'back' as const, abilities: d.abilities
        }
    })
    return {
        classId: 'class_archer', heroLevel: level, heroXp: ZERO, goldBonusPct: 0,
        offlineEfficiencyLevel: 0, offlineCapLevel: 0, champions
    }
}

describe('partyKits', () => {
    it('keys each kit by the Hero\'s class, then each Champion, in fight order', () => {
        const hero = party(10)
        expect(partyKits(hero, partyUnitStats(hero)).map(k => k.id))
            .toEqual(['class_archer', 'champ_kaira', 'champ_borin', 'champ_lys'])
    })

    it('serves the cooldown each ability first fires on in a real fight', () => {
        const hero = party(8)
        const kits = partyKits(hero, partyUnitStats(hero))
        const fight = runFight({ hero, position: { prestige: 0, world: 2, stage: 5, killsInStage: 0 }, seed: 777 })
        let checked = 0
        kits.forEach((kit, unitIndex) => {
            const down = fight.events.find(e => e.kind === 'unit_down' && e.unitIndex === unitIndex)?.at ?? Infinity
            for (const skill of kit.skills) {
                // only what the fight lived long enough to cast
                if (skill.cooldownSeconds + FIGHT_TICK_SECONDS >= Math.min(down, fight.secondsElapsed)) continue
                const first = fight.events.find(e => e.unitIndex === unitIndex && e.skillId === skill.id
                    && (e.kind === 'skill' || e.kind === 'heal' || e.kind === 'status_applied'))
                expect(first, `${kit.id} ${skill.id}`).toBeDefined()
                expect(Math.abs(first!.at - skill.cooldownSeconds)).toBeLessThanOrEqual(FIGHT_TICK_SECONDS + 1e-9)
                checked++
            }
        })
        expect(checked).toBeGreaterThanOrEqual(3)
    })
})
