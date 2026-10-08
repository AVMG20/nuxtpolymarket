import { describe, expect, it } from 'vitest'
import { runFight } from '#shared/utils/hero-quest/fight'
import {
    BOSS_SPECIAL_COOLDOWN_SECONDS,
    BOSS_SPECIAL_STUN_SECONDS,
    BOSS_STAGE,
    SUPER_BOSS_STAGE,
    WORLD_COUNT
} from '#shared/utils/hero-quest/constants'
import { attackIntervalFor } from '#shared/utils/hero-quest/combat'
import { BOSS_SPECIALS, bossSpecialAt } from '#shared/utils/hero-quest/content/boss-specials'
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

    it('never comes out in a raid', () => {
        const pack = enemyPackAt(at(1, SUPER_BOSS_STAGE))
        const result = runFight({ hero: hero(40), position: at(1, SUPER_BOSS_STAGE), seed: 11, encounter: { pack, seconds: 30 } })
        expect(result.events.some(event => event.kind === 'enemy_special')).toBe(false)
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
