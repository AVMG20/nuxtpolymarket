import { describe, expect, it } from 'vitest'
import { RAIDS, paysEveryRun } from '#shared/utils/hero-quest/content/raids'
import { RAID_KEY_CAP, damageDealt, dummyLevelFor, dummyThreshold, grantKeys, nextRaidLevel, rampageLevelReached, rampageThreshold, runDummyRound, runRampageFight } from '#shared/utils/hero-quest/raids'
import { RAID_DUMMY_SECONDS, RAID_RAMPAGE_CAP_SECONDS } from '#shared/utils/hero-quest/constants'
import { makeParty } from '../../scripts/hero-quest/sim'
import { D, ZERO } from '#shared/utils/hero-quest/numbers'
import type { FightEvent } from '#shared/utils/hero-quest/fight'
import type { HeroSnapshot } from '#shared/utils/hero-quest/types'

describe('hero-quest raids', () => {
    it('gives each raid its own id', () => {
        expect(new Set(RAIDS.map(r => r.id)).size).toBe(RAIDS.length)
    })

    it('spends a Key on every run only where every run pays', () => {
        const everyRun = RAIDS.filter(r => paysEveryRun(r.fightType)).map(r => r.id)
        expect(everyRun.sort()).toEqual(['raid_training_grounds', 'raid_trait'])
    })
})

describe('hero-quest raid rules', () => {
    describe('the daily Key grant at 00:00 UTC', () => {
        const day = 86_400_000
        const midnight = Date.UTC(2026, 9, 5)

        it('pays nothing before midnight and a day of Keys just after it, moving the clock to the start of the day', () => {
            const evening = midnight - 4 * 3_600_000
            expect(grantKeys(0, evening, midnight - 1)).toEqual({ balance: 0, lastGrantAt: evening })
            expect(grantKeys(0, evening, midnight + 1)).toEqual({ balance: 3, lastGrantAt: midnight })
            // a whole day after the last grant, but no midnight crossed: nothing yet
            expect(grantKeys(0, midnight + 1, midnight + day - 1)).toEqual({ balance: 0, lastGrantAt: midnight + 1 })
        })

        it('pays a day of Keys for each midnight crossed, however late in the day the last grant was', () => {
            const at = midnight - 60_000
            expect(grantKeys(1, at, midnight + 2 * day + 60_000)).toEqual({ balance: 10, lastGrantAt: midnight + 2 * day })
            expect(grantKeys(20, at, at + 30 * day).balance).toBe(RAID_KEY_CAP)
        })

        it('stops the grant at the bank, but never takes Keys from elsewhere back down to it', () => {
            expect(grantKeys(RAID_KEY_CAP - 1, midnight - 1, midnight + 3 * day)).toEqual({ balance: RAID_KEY_CAP, lastGrantAt: midnight + 3 * day })
            expect(grantKeys(RAID_KEY_CAP + 5, midnight - 1, midnight + 3 * day)).toEqual({ balance: RAID_KEY_CAP + 5, lastGrantAt: midnight + 3 * day })
        })
    })

    it('starts every round at level 1 and needs a world more of damage for each level after', () => {
        expect(dummyThreshold(1).eq(0)).toBe(true)
        expect(dummyLevelFor(D(0))).toBe(1)
        for (const level of [2, 25, 120]) {
            const need = dummyThreshold(level)
            expect(dummyLevelFor(need)).toBe(level)
            expect(dummyLevelFor(need.mul(0.999))).toBe(level - 1)
        }
    })

    it('counts only the damage that lands on the enemy side', () => {
        const events: FightEvent[] = [
            { at: 0.1, kind: 'attack', unitIndex: 0, enemyIndex: 0, damage: '10' },
            { at: 0.2, kind: 'skill', unitIndex: 1, enemyIndex: 0, skillId: 'x', damage: '5' },
            { at: 0.3, kind: 'status_tick', enemyIndex: 0, onEnemy: true, damage: '2' },
            { at: 0.3, kind: 'status_tick', unitIndex: 0, onEnemy: false, damage: '99' },
            { at: 0.4, kind: 'reflect', unitIndex: 0, enemyIndex: 0, damage: '99' },
            { at: 0.5, kind: 'skill', unitIndex: 0, skillId: 'haste', damage: '0' }
        ]
        expect(damageDealt(events).toNumber()).toBe(17)
        expect(damageDealt(events, 0.15).toNumber()).toBe(10)
    })

    it('plays the same round from the same seed, against a dummy that never swings back', () => {
        const hero: HeroSnapshot = { classId: 'class_warrior', heroLevel: 20, heroXp: ZERO, goldBonusPct: 0, offlineEfficiencyLevel: 0, offlineCapLevel: 0 }
        const position = { prestige: 0, world: 1, stage: 1, killsInStage: 0 }
        const a = runDummyRound(hero, position, 7)
        const b = runDummyRound(hero, position, 7)
        expect(a.damage.eq(b.damage)).toBe(true)
        expect(a.level).toBeGreaterThanOrEqual(1)
        expect(a.fight.secondsElapsed).toBe(RAID_DUMMY_SECONDS)
        expect(a.fight.events.some(e => e.kind === 'enemy_attack')).toBe(false)
    })
    it('fights the Gilded Knight one past the best', () => {
        expect(nextRaidLevel(0)).toBe(1)
        expect(nextRaidLevel(7)).toBe(8)
    })

    it('levels Shardcaller Beast on its gauge until the party falls, never killing it', () => {
        const fight = runRampageFight(makeParty('class_warrior', 205, 3), { prestige: 0, world: 1, stage: 1, killsInStage: 0 }, 7919)
        expect(fight.outcome).toBe('wipe')
        expect(fight.events.some(e => e.kind === 'enemy_down')).toBe(false)
        const ups = fight.events.filter(e => e.kind === 'enemy_level')
        expect(ups.length).toBeGreaterThan(0)
        // levels only climb, each gauge refilled below its threshold
        let last = 1
        for (const e of ups) {
            expect(e.level!).toBeGreaterThan(last)
            last = e.level!
            expect(D(e.remainingHp!).lte(rampageThreshold(e.level!))).toBe(true)
        }
        expect(rampageLevelReached(fight)).toBe(last)
        expect(fight.secondsElapsed).toBeLessThan(RAID_RAMPAGE_CAP_SECONDS)
    })
})
