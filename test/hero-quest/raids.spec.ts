import { describe, expect, it } from 'vitest'
import { RAIDS, paysEveryRun } from '#shared/utils/hero-quest/content/raids'
import { RAID_KEY_CAP, damageDealt, dummyLevelFor, dummyThreshold, grantKeys, knightStats, nextRaidLevel, raidReward, forgeStats, rampageLevelReached, rampageStats, rampageThreshold, runDigSiteFight, runDummyRound, runForgeFight, runRampageFight } from '#shared/utils/hero-quest/raids'
import { RAID_DIG_ADD_SECONDS, RAID_DIG_BURROWS, RAID_DUMMY_SECONDS, RAID_ENRAGE_SECONDS, RAID_FORGE_HANDOFF_SECONDS, RAID_FORGE_KILL_SECONDS, RAID_RAMPAGE_CAP_SECONDS } from '#shared/utils/hero-quest/constants'
import { makeParty } from '../../scripts/hero-quest/sim'
import { D, ZERO } from '#shared/utils/hero-quest/numbers'
import type { FightEvent } from '#shared/utils/hero-quest/fight'
import type { HeroSnapshot } from '#shared/utils/hero-quest/types'

describe('hero-quest raids', () => {
    it('has the five raids, each with its own stable id', () => {
        expect(RAIDS).toHaveLength(5)
        expect(new Set(RAIDS.map(r => r.id)).size).toBe(5)
    })

    it('pairs each of the four gachas with exactly one raid, and leaves the Trait Raid standalone', () => {
        const paired = RAIDS.map(r => r.pairedSystem).filter(s => s !== null)
        expect(new Set(paired)).toEqual(new Set(['gear', 'champion', 'skill', 'artifact']))
        expect(paired).toHaveLength(4)
        expect(RAIDS.find(r => r.id === 'raid_trait')?.pairedSystem).toBeNull()
    })

    it('spends a Key on every run only where every run pays', () => {
        const everyRun = RAIDS.filter(r => paysEveryRun(r.fightType)).map(r => r.id)
        expect(everyRun.sort()).toEqual(['raid_training_grounds', 'raid_trait'])
    })
})

describe('hero-quest raid rules', () => {
    it('pays 3 Seals at level 1 and climbs 3% a level, or one more every 5 levels on the stepped shape', () => {
        expect(raidReward('raid_training_grounds', 1)).toBe(3)
        expect(raidReward('raid_training_grounds', 50)).toBe(Math.round(3 * 1.03 ** 49))
        expect(raidReward('raid_training_grounds', 1, 'stepped')).toBe(3)
        expect(raidReward('raid_training_grounds', 6, 'stepped')).toBe(4)
        expect(raidReward('raid_trait', 1)).toBe(10)
    })

    it('grants a day of Keys for each whole day since the last grant, up to the bank, keeping its time of day', () => {
        const day = 86_400_000
        const at = Date.UTC(2026, 9, 4, 9)
        expect(grantKeys(0, at, at + day - 1)).toEqual({ balance: 0, lastGrantAt: at })
        expect(grantKeys(1, at, at + 2.5 * day)).toEqual({ balance: 7, lastGrantAt: at + 2 * day })
        expect(grantKeys(20, at, at + 30 * day).balance).toBe(RAID_KEY_CAP)
    })

    it('stops the grant at the bank, but never takes Keys from elsewhere back down to it', () => {
        const day = 86_400_000
        const at = Date.UTC(2026, 9, 4, 9)
        expect(grantKeys(RAID_KEY_CAP + 5, at, at + 3 * day)).toEqual({ balance: RAID_KEY_CAP + 5, lastGrantAt: at + 3 * day })
    })

    it('starts every round at level 1 and needs a world more of damage for each level after', () => {
        expect(dummyThreshold(1).eq(0)).toBe(true)
        expect(dummyLevelFor(D(0))).toBe(1)
        for (const level of [2, 3, 7, 25, 120]) {
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
    it('fights the Gilded Knight one past the best, a world of growth harder each level', () => {
        expect(nextRaidLevel(0)).toBe(1)
        expect(nextRaidLevel(7)).toBe(8)
        const a = knightStats(4)
        const b = knightStats(5)
        expect(b.hp.gt(a.hp)).toBe(true)
        expect(b.pwr.gt(a.pwr)).toBe(true)
        expect(knightStats(4).hp.eq(a.hp)).toBe(true)
    })

    it('sends the Dig Site adds up on their timer, into empty burrows only, and wins on the Deepcoil alone', () => {
        const hero = makeParty('class_warrior', 205, 3)
        const fight = runDigSiteFight(hero, { prestige: 0, world: 1, stage: 1, killsInStage: 0 }, 7919, 4)
        const arrivals = fight.events.filter(e => e.kind === 'enemy_arrive')
        expect(arrivals.length).toBeGreaterThan(0)
        for (const e of arrivals) expect(e.at % RAID_DIG_ADD_SECONDS).toBeCloseTo(0, 6)
        // no more adds stand at once than there are burrows
        const standing = new Set<number>()
        for (const e of fight.events) {
            if (e.kind === 'enemy_arrive') standing.add(e.enemyIndex!)
            if (e.kind === 'enemy_down') standing.delete(e.enemyIndex!)
            expect(standing.size).toBeLessThanOrEqual(RAID_DIG_BURROWS)
        }
        // nothing strikes or is struck before it arrives
        const arrived = new Map(arrivals.map(e => [e.enemyIndex!, e.at]))
        const boss = fight.enemyMaxHps.length - 1
        for (const e of fight.events) {
            if (e.enemyIndex === undefined || e.enemyIndex === boss) continue
            expect(arrived.get(e.enemyIndex)).toBeLessThanOrEqual(e.at)
        }
        // won with an add up is still a win: the Deepcoil is the fight
        const strong = runDigSiteFight(makeParty('class_warrior', 400, 3), { prestige: 0, world: 1, stage: 1, killsInStage: 0 }, 11, 1)
        expect(strong.outcome).toBe('win')
        expect(strong.events.some(e => e.kind === 'enemy_down' && e.enemyIndex === strong.enemyMaxHps.length - 1)).toBe(true)
    })

    it('walks the Forge bosses out one at a time, each a step up, the clock growing with every kill', () => {
        const [apprentice, journeyman, master] = forgeStats(3)
        expect(journeyman!.hp.gt(apprentice!.hp)).toBe(true)
        expect(master!.hp.gt(journeyman!.hp)).toBe(true)
        const fight = runForgeFight(makeParty('class_warrior', 205, 3), { prestige: 0, world: 1, stage: 1, killsInStage: 0 }, 7919, 4)
        const downs = fight.events.filter(e => e.kind === 'enemy_down')
        const arrivals = fight.events.filter(e => e.kind === 'enemy_arrive')
        expect(arrivals.map(e => e.enemyIndex)).toEqual([1, 2])
        // each walks out a handoff after the last falls, and nobody touches it before
        for (const [k, arrival] of arrivals.entries()) {
            expect(arrival.at).toBeGreaterThanOrEqual(downs[k]!.at + RAID_FORGE_HANDOFF_SECONDS - 0.11)
            expect(fight.events.some(e => e.enemyIndex === k + 1 && e.kind !== 'enemy_arrive' && e.at < arrival.at)).toBe(false)
        }
        expect(fight.outcome).toBe('win')
        // past the base clock: the kills bought the time
        expect(fight.secondsElapsed).toBeGreaterThan(RAID_ENRAGE_SECONDS)
        expect(fight.secondsElapsed).toBeLessThanOrEqual(RAID_ENRAGE_SECONDS + 2 * RAID_FORGE_KILL_SECONDS)
    })

    it('levels Shardcaller Beast on its gauge until the party falls, never killing it', () => {
        expect(rampageThreshold(4).gt(rampageThreshold(3))).toBe(true)
        expect(rampageStats(4).pwr.gt(rampageStats(3).pwr)).toBe(true)
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
