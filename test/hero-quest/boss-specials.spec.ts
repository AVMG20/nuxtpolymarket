import { describe, expect, it } from 'vitest'
import { runFight, type FightEvent } from '#shared/utils/hero-quest/fight'
import {
    BOSS_SPECIAL_COOLDOWN_SECONDS,
    BOSS_SPECIAL_STUN_SECONDS,
    BOSS_STAGE,
    SUPER_BOSS_STAGE,
    WORLD_COUNT
} from '#shared/utils/hero-quest/constants'
import { attackIntervalFor } from '#shared/utils/hero-quest/combat'
import { BOSS_SPECIALS, RAID_BOSS_SPECIALS, bossSpecialAt, raidBossSpecials } from '#shared/utils/hero-quest/content/boss-specials'
import { RAIDS } from '#shared/utils/hero-quest/content/raids'
import { forgeStats, runDigSiteFight, runForgeFight, runKnightFight, runRampageFight } from '#shared/utils/hero-quest/raids'
import { makeParty } from '../../scripts/hero-quest/sim'
import { DEEPCOIL, FORGE_APPRENTICE, FORGE_JOURNEYMAN, FORGE_MASTER, GILDED_WARLORD, RAMPANT } from '../../app/utils/hero-quest-art/raids'
import { specialsOf } from '../../app/utils/hero-quest-art/creature'
import { SKILLS } from '#shared/utils/hero-quest/content/skills'
import { enemyPackAt } from '#shared/utils/hero-quest/settle'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import type { HeroSnapshot, RunPosition } from '#shared/utils/hero-quest/types'

function hero(heroLevel: number, overrides: Partial<HeroSnapshot> = {}): HeroSnapshot {
    return { classId: 'class_beginner', heroLevel, heroXp: ZERO, goldBonusPct: 0, offlineEfficiencyLevel: 0, offlineCapLevel: 0, ...overrides }
}

function at(world: number, stage: number): RunPosition {
    return { prestige: 0, world, stage, killsInStage: 0 }
}

describe('hero-quest boss specials', () => {
    it('gives every gate in every world exactly one special, under a unique id', () => {
        expect(BOSS_SPECIALS).toHaveLength(WORLD_COUNT * 2)
        expect(new Set(BOSS_SPECIALS.map(special => special.id)).size).toBe(BOSS_SPECIALS.length)
        for (let world = 1; world <= WORLD_COUNT; world++) {
            expect(bossSpecialAt(world, BOSS_STAGE)?.stage).toBe(BOSS_STAGE)
            expect(bossSpecialAt(world, SUPER_BOSS_STAGE)?.stage).toBe(SUPER_BOSS_STAGE)
            expect(bossSpecialAt(world, 3)).toBeUndefined()
        }
    })

    it('opens with the special on its first swing, then waits out the cooldown', () => {
        const result = runFight({ hero: hero(40), position: at(1, SUPER_BOSS_STAGE), seed: 11 })
        const boss = enemyPackAt(at(1, SUPER_BOSS_STAGE)).members.length - 1
        const casts = [...new Set(result.events.filter(event => event.kind === 'enemy_special').map(event => event.at))]

        expect(casts[0]).toBeCloseTo(attackIntervalFor(0), 5)
        for (let k = 1; k < casts.length; k++) {
            expect(casts[k]! - casts[k - 1]!).toBeGreaterThanOrEqual(BOSS_SPECIAL_COOLDOWN_SECONDS - 1e-6)
        }
        // only the boss has one, and it names itself
        expect(result.events.filter(event => event.kind === 'enemy_special')
            .every(event => event.enemyIndex === boss && event.skillId === 'special_wicker_blaze')).toBe(true)
    })

    it('swings the special in place of a basic attack', () => {
        const result = runFight({ hero: hero(40), position: at(1, SUPER_BOSS_STAGE), seed: 11 })
        const boss = enemyPackAt(at(1, SUPER_BOSS_STAGE)).members.length - 1
        const opened = result.events.find(event => event.kind === 'enemy_special')!.at
        expect(result.events.some(event => event.kind === 'enemy_attack' && event.enemyIndex === boss && event.at === opened)).toBe(false)
    })

    it('lands its status on the party, a burn ticking as damage', () => {
        const result = runFight({ hero: hero(40), position: at(1, SUPER_BOSS_STAGE), seed: 11 })
        expect(result.events.some(event => event.kind === 'status_applied' && event.statusId === 'special_wicker_blaze'
            && event.onEnemy !== true)).toBe(true)
        expect(result.events.some(event => event.kind === 'status_tick' && event.onEnemy === false)).toBe(true)
    })

    it('heals a draining boss off what it landed', () => {
        const result = runFight({ hero: hero(70), position: at(2, BOSS_STAGE), seed: 3 })
        const drains = result.events.filter(event => event.kind === 'heal' && event.onEnemy === true
            && event.skillId === 'special_brood_swarm')
        expect(drains.length).toBeGreaterThan(0)
    })

    it('leaves the gate\'s special at the gate: an encounter casts only the specials it brings', () => {
        const pack = enemyPackAt(at(1, SUPER_BOSS_STAGE))
        const result = runFight({ hero: hero(40), position: at(1, SUPER_BOSS_STAGE), seed: 11, encounter: { pack, seconds: 30 } })
        expect(result.events.some(event => event.kind === 'enemy_special')).toBe(false)
    })

    describe('raid bosses', () => {
        const party = makeParty('class_warrior', 205, 3)
        const start = at(1, 1)
        const casts = (events: readonly FightEvent[]) => events.filter(event => event.kind === 'enemy_special')
        const castIds = (events: readonly FightEvent[]) => {
            const seen: string[] = []
            let last = Number.NaN
            for (const event of casts(events)) {
                if (event.at === last) continue
                last = event.at
                seen.push(event.skillId!)
            }
            return seen
        }

        it('gives every raid but the Training Grounds its own specials, under ids of their own', () => {
            const raidIds = Object.values(RAID_BOSS_SPECIALS).flat(2).map(special => special.id)
            expect(new Set([...raidIds, ...BOSS_SPECIALS.map(special => special.id)]).size).toBe(raidIds.length + BOSS_SPECIALS.length)
            for (const raid of RAIDS) expect(raidBossSpecials(raid.id).length > 0, raid.id).toBe(raid.id !== 'raid_training_grounds')
            expect(RAID_BOSS_SPECIALS.raid_forge).toHaveLength(forgeStats(1).length)
        })

        it('names each the way its art does, in the order the art takes them', () => {
            const art = { raid_guild: [GILDED_WARLORD], raid_dig_site: [DEEPCOIL], raid_forge: [FORGE_APPRENTICE, FORGE_JOURNEYMAN, FORGE_MASTER], raid_trait: [RAMPANT[0]!] } as const
            for (const [raid, bosses] of Object.entries(art)) {
                bosses.forEach((def, k) => {
                    expect(raidBossSpecials(raid as keyof typeof art, k).map(special => special.name), `${raid} ${k}`).toEqual(specialsOf(def).map(special => special.name))
                    // a special for the adds is one in the art too
                    expect(raidBossSpecials(raid as keyof typeof art, k).map(special => special.target === 'adds')).toEqual(specialsOf(def).map(special => special.target === 'adds'))
                })
            }
            // every rampage tier takes the same two
            for (const tier of RAMPANT) expect(specialsOf(tier).map(special => special.name)).toEqual(raidBossSpecials('raid_trait').map(special => special.name))
        })

        it('opens with its special, then takes its specials in turn on the cooldown', () => {
            const fight = runKnightFight(party, start, 7919, 4)
            const at = [...new Set(casts(fight.events).map(event => event.at))]
            expect(at[0]).toBeCloseTo(attackIntervalFor(0), 5)
            for (let k = 1; k < at.length; k++) expect(at[k]! - at[k - 1]!).toBeGreaterThanOrEqual(BOSS_SPECIAL_COOLDOWN_SECONDS - 1e-6)
            const ids = raidBossSpecials('raid_guild').map(special => special.id)
            expect(castIds(fight.events)).toEqual(castIds(fight.events).map((_, k) => ids[k % ids.length]))
            expect(castIds(fight.events).length).toBeGreaterThan(1)
        })

        it('runs the Gilded Knight\'s charge through the nearest three', () => {
            const fight = runKnightFight(makeParty('class_warrior', 205, 5), start, 7919, 4)
            const charge = casts(fight.events).filter(event => event.skillId === 'special_sunlance_charge' && event.at === casts(fight.events)[0]!.at)
            expect(new Set(charge.map(event => event.unitIndex)).size).toBe(3)
        })

        it('mends the Deepcoil\'s adds only while they stand, and strikes the party otherwise', () => {
            // a party that can't clear the adds before the boss swings again
            const fight = runDigSiteFight(makeParty('class_warrior', 190, 3), start, 7919, 4)
            const firstAdd = fight.events.find(event => event.kind === 'enemy_arrive')!.at
            const mantle = casts(fight.events).filter(event => event.skillId === 'special_crystal_mantle')
            expect(castIds(fight.events)[0]).toBe('special_geode_eruption')
            expect(mantle.length).toBeGreaterThan(0)
            for (const cast of mantle) {
                expect(cast.at).toBeGreaterThanOrEqual(firstAdd)
                expect(cast.unitIndex).toBeUndefined()
            }
            const boss = fight.enemyMaxHps.length - 1
            const mends = fight.events.filter(event => event.kind === 'heal' && event.skillId === 'special_crystal_mantle')
            expect(mends.length).toBeGreaterThan(0)
            for (const heal of mends) {
                expect(heal.onEnemy).toBe(true)
                expect(heal.enemyIndex).not.toBe(boss)
            }
        })

        it('has each of the Forge\'s bosses cast its own as it walks out', () => {
            const fight = runForgeFight(makeParty('class_warrior', 225, 3), start, 7919, 4)
            for (const cast of casts(fight.events)) {
                expect(raidBossSpecials('raid_forge', cast.enemyIndex!).map(special => special.id)).toContain(cast.skillId)
            }
            expect(new Set(casts(fight.events).map(event => event.enemyIndex))).toEqual(new Set([0, 1, 2]))
        })

        it('has Shardcaller Beast cast through its rampage', () => {
            const fight = runRampageFight(party, start, 7919)
            expect(new Set(castIds(fight.events))).toEqual(new Set(raidBossSpecials('raid_trait').map(special => special.id)))
        })

        it('keeps a raid round deterministic', () => {
            expect(runDigSiteFight(party, start, 3, 4).events).toEqual(runDigSiteFight(party, start, 3, 4).events)
        })
    })

    it('stays deterministic', () => {
        const input = { hero: hero(30), position: at(1, BOSS_STAGE), seed: 99 }
        expect(runFight(input).events).toEqual(runFight(input).events)
    })

    describe('control resist', () => {
        // no Artifact draws Unshaken from its pool, so the Skill passive is the source to test
        const will = SKILLS.find(skill => skill.name === 'Unbreakable Will')!
        const resistant = hero(30, { equippedSkills: [{ contentId: will.id, star: 5, level: 10 }] })

        it('reaches the unit stats from an equipped Skill', () => {
            expect(partyUnitStats(resistant)[0]!.controlResist).toBeGreaterThan(0)
            expect(partyUnitStats(hero(30))[0]!.controlResist).toBe(0)
        })

        it("shortens a special's stun", () => {
            const stunFor = (snapshot: HeroSnapshot) => {
                const events = runFight({ hero: snapshot, position: at(1, BOSS_STAGE), seed: 5 }).events
                const landed = events.find(event => event.kind === 'status_applied' && event.statusId === 'special_tusk_charge')!
                const lifted = events.find(event => event.kind === 'status_expired' && event.statusId === 'special_tusk_charge'
                    && event.unitIndex === landed.unitIndex)!
                return lifted.at - landed.at
            }
            const plain = stunFor(hero(30))
            expect(plain).toBeCloseTo(BOSS_SPECIAL_STUN_SECONDS, 0)
            expect(stunFor(resistant)).toBeLessThan(plain)
        })
    })
})
