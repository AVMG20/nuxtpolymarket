/**
 * A boss fight's log, cut into what the stage acts out.
 *
 * The stage starts each swing early so its blow lands on the logged moment, which only works if
 * the log is grouped by who swings. These pin the grouping, and that it never drops or alters an
 * event: every number the replay shows is the server's.
 */

import { describe, expect, it } from 'vitest'
import { scriptFight } from '../../app/utils/hero-quest-art/fight-script'
import { runFight, type FightEvent } from '#shared/utils/hero-quest/fight'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import { RARITY_STAT_MULTIPLIER, getChampion } from '#shared/utils/hero-quest/content/champions'
import type { HeroSnapshot } from '#shared/utils/hero-quest/types'

describe('scriptFight', () => {
    it('makes one beat of a multi-strike, with the death it caused riding on it', () => {
        const events: FightEvent[] = [
            { at: 1, kind: 'attack', unitIndex: 0, enemyIndex: 0, damage: '5', remainingHp: '5' },
            { at: 1, kind: 'attack', unitIndex: 0, enemyIndex: 0, damage: '5', remainingHp: '0' },
            { at: 1, kind: 'enemy_down', enemyIndex: 0, remainingHp: '0' }
        ]
        const { beats, instants } = scriptFight(events)
        expect(beats).toHaveLength(1)
        expect(beats[0]).toMatchObject({ at: 1, side: 0, actor: 0, cast: false })
        expect(beats[0]!.hits).toHaveLength(2)
        expect(beats[0]!.downs.map(e => e.kind)).toEqual(['enemy_down'])
        expect(instants).toEqual([])
    })

    it('keeps an attack and a cast by the same unit at one moment apart', () => {
        const { beats } = scriptFight([
            { at: 2, kind: 'attack', unitIndex: 1, enemyIndex: 0, damage: '1', remainingHp: '9' },
            { at: 2, kind: 'skill', unitIndex: 1, enemyIndex: 0, skillId: 'x', damage: '3', remainingHp: '6' }
        ])
        expect(beats.map(b => b.cast)).toEqual([false, true])
    })

    it('casts a utility skill with nothing to land, and leaves its heal on its own moment', () => {
        const { beats, instants } = scriptFight([
            { at: 3, kind: 'heal', unitIndex: 0, skillId: 'mend', damage: '20', remainingHp: '80' },
            { at: 3, kind: 'skill', unitIndex: 2, skillId: 'mend', damage: '0' }
        ])
        expect(beats).toEqual([{ at: 3, side: 0, actor: 2, cast: true, skillId: 'mend', hits: [], downs: [] }])
        expect(instants.map(e => e.kind)).toEqual(['heal'])
    })

    it('puts an enemy swing on the enemy, and the party member it fells on that swing', () => {
        const { beats, instants } = scriptFight([
            { at: 4, kind: 'enemy_attack', enemyIndex: 2, unitIndex: 1, damage: '50', remainingHp: '0' },
            { at: 4, kind: 'unit_down', unitIndex: 1, remainingHp: '0' },
            { at: 4, kind: 'unit_down', unitIndex: 3, remainingHp: '0' }
        ])
        expect(beats).toHaveLength(1)
        expect(beats[0]).toMatchObject({ side: 1, actor: 2 })
        expect(beats[0]!.downs.map(e => e.unitIndex)).toEqual([1])
        // a death no swing this moment dealt (a tick of damage over time) stands on its own
        expect(instants.map(e => e.unitIndex)).toEqual([3])
    })

    it("makes a boss's special one cast across the party, with the deaths it dealt", () => {
        const { beats, instants } = scriptFight([
            { at: 5, kind: 'enemy_special', enemyIndex: 2, unitIndex: 0, skillId: 'special_inferno', damage: '9', remainingHp: '1' },
            { at: 5, kind: 'enemy_special', enemyIndex: 2, unitIndex: 1, skillId: 'special_inferno', damage: '9', remainingHp: '0' },
            { at: 5, kind: 'unit_down', unitIndex: 1, remainingHp: '0' },
            { at: 5, kind: 'status_applied', unitIndex: 0, statusId: 'special_inferno' }
        ])
        expect(beats).toHaveLength(1)
        expect(beats[0]).toMatchObject({ side: 1, actor: 2, cast: true, skillId: 'special_inferno' })
        expect(beats[0]!.hits.map(e => e.unitIndex)).toEqual([0, 1])
        expect(beats[0]!.downs.map(e => e.unitIndex)).toEqual([1])
        expect(instants.map(e => e.kind)).toEqual(['status_applied'])
    })

    it('accounts for every event of a real fight exactly once', () => {
        const champions = ['champ_kaira', 'champ_borin', 'champ_lys'].map((id) => {
            const d = getChampion(id as never)
            return {
                championId: d.id, archetype: d.archetype, rarityMultiplier: RARITY_STAT_MULTIPLIER[d.rarity],
                investment: 1, strikesPerAttack: d.strikesPerAttack, row: 'back' as const, abilities: d.abilities
            }
        })
        const hero: HeroSnapshot = {
            classId: 'class_archer', heroLevel: 3, heroXp: ZERO, goldBonusPct: 0,
            offlineEfficiencyLevel: 0, offlineCapLevel: 0, champions
        }
        const fight = runFight({ hero, position: { prestige: 0, world: 4, stage: 5, killsInStage: 0 }, seed: 4242 })
        const { beats, instants } = scriptFight(fight.events)
        const utility = fight.events.filter(e => e.kind === 'skill' && e.enemyIndex === undefined).length
        const placed = beats.reduce((n, b) => n + b.hits.length + b.downs.length, 0) + instants.length
        expect(placed + utility).toBe(fight.events.length)
        // in log order, so a swing never starts after one logged later
        for (let k = 1; k < beats.length; k++) expect(beats[k]!.at).toBeGreaterThanOrEqual(beats[k - 1]!.at)
    })
})
