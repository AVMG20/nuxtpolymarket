/**
 * Ability effects, and the enemy grid they target.
 *
 * The specs that matter most here are the seven class skills that had **no doc description at
 * all** and were specified during this pass — Whirlwind, Threatening Roar, Shockwave, Piercing
 * Arrow, Fan of Arrows, Arrow Rain, Kill Shot. For those, these assertions *are* the
 * specification: there is no doc to check them against, so if one changes, it should change
 * here deliberately rather than drift.
 */

import { describe, expect, it } from 'vitest'
import {
    columnOf,
    enemyPosition,
    packSizeFor,
    rowOf
} from '#shared/utils/hero-quest/settle'
import {
    executeMultiplier,
    isAllyTarget,
    resolveAllyTargets,
    resolveEnemyTargets,
    stretchEffect
} from '#shared/utils/hero-quest/effects'
import { CLASS_BY_ID } from '#shared/utils/hero-quest/content/classes'
import { applyStatus } from '#shared/utils/hero-quest/status'
import type { StatusInstance } from '#shared/utils/hero-quest/status'
import {
    CHAMPIONS,
    CHAMPION_ABILITY_EFFECTS,
    CHAMPION_ABILITY_POOL
} from '#shared/utils/hero-quest/content/champions'
import {
    BOSS_MINION_COUNT,
    BOSS_STAGE,
    EXECUTE_BONUS,
    FOCUSED_BARRAGE_HITS,
    FROSTBIND_FREEZE_STACKS,
    FROSTBIND_STACKS_PER_CAST,
    STATUS_MAX_STACKS,
    KILL_SHOT_CRIT_MULTIPLIER,
    WAVE_PACK_SIZE
} from '#shared/utils/hero-quest/constants'

const geometry = { columnOf, rowOf }
const all = (size: number) => Array.from({ length: size }, (_unused, index) => index)

describe('the enemy grid', () => {
    it('splits a six-strong wave pack three in front, three behind', () => {
        expect(WAVE_PACK_SIZE).toBe(6)
        expect(rowOf('front', 6)).toEqual([0, 1, 2])
        expect(rowOf('back', 6)).toEqual([3, 4, 5])
    })

    it('lines columns up front to back', () => {
        expect(columnOf(0, 6)).toEqual([0, 3])
        expect(columnOf(2, 6)).toEqual([2, 5])
        // A back-row member resolves to the same column as the body screening it.
        expect(columnOf(4, 6)).toEqual([1, 4])
    })

    it('puts a boss behind its own escort, with no boss-specific branch', () => {
        const size = packSizeFor(BOSS_STAGE)
        const bossIndex = size - 1
        // Minions occupy the front, the boss the back — falling out of `ceil(size / 2)` alone.
        expect(enemyPosition(bossIndex, size).row).toBe('back')
        for (let index = 0; index < BOSS_MINION_COUNT; index++) {
            expect(enemyPosition(index, size).row, `minion ${index}`).toBe('front')
        }
    })

    it('keeps a lone enemy in front, so nothing hides behind an empty row', () => {
        expect(enemyPosition(0, 1)).toEqual({ row: 'front', col: 0 })
        expect(rowOf('back', 1)).toEqual([])
    })
})

describe('target patterns', () => {
    it('hits one for a plain single-target ability', () => {
        expect(resolveEnemyTargets('enemy_single', 0, all(6), 6, geometry)).toEqual([0])
    })

    it('pierces exactly once — the target and the body behind it', () => {
        // Piercing Arrow, as specified: "all enemies in a row… essentially piercing once".
        expect(resolveEnemyTargets('enemy_pierce', 1, all(6), 6, geometry)).toEqual([1, 4])
    })

    it('sweeps the whole front line', () => {
        // Fan of Arrows and Whirlwind: "all enemies in the front column".
        expect(resolveEnemyTargets('enemy_front_line', 0, all(6), 6, geometry)).toEqual([0, 1, 2])
    })

    it('falls through to the back row once the front is dead', () => {
        const living = [3, 4, 5]
        expect(resolveEnemyTargets('enemy_front_line', 3, living, 6, geometry)).toEqual([3, 4, 5])
    })

    it('covers every occupied spot for a full-board ability', () => {
        // Arrow Rain: "all enemies in each spot".
        expect(resolveEnemyTargets('enemy_all', 0, all(6), 6, geometry)).toEqual(all(6))
    })

    it('never returns a corpse', () => {
        const living = [0, 2, 5]
        for (const pattern of ['enemy_pierce', 'enemy_front_line', 'enemy_all'] as const) {
            const hit = resolveEnemyTargets(pattern, 0, living, 6, geometry)
            expect(hit.every(index => living.includes(index)), pattern).toBe(true)
        }
    })

    it('picks the neediest ally by HP fraction, not by raw HP', () => {
        const party = [
            { alive: true, hpFraction: 0.9 },
            { alive: true, hpFraction: 0.2 },
            { alive: false, hpFraction: 0 }
        ]
        expect(resolveAllyTargets('ally_lowest_hp', 0, party)).toEqual([1])
        // A fallen ally is not "the neediest" — reviving is its own effect, not a heal target.
        expect(resolveAllyTargets('ally_all', 0, party)).toEqual([0, 1])
        expect(resolveAllyTargets('self', 0, party)).toEqual([0])
    })

    it('gives an enemy pattern no ally targets and vice versa', () => {
        expect(resolveEnemyTargets('ally_all', 0, all(6), 6, geometry)).toEqual([])
        expect(resolveAllyTargets('enemy_all', 0, [{ alive: true, hpFraction: 1 }])).toEqual([])
    })
})

describe('the seven skills specified this pass', () => {
    const skillOf = (classId: keyof typeof CLASS_BY_ID) => CLASS_BY_ID[classId]!.skill

    it('Whirlwind sweeps the front line for the Warrior', () => {
        const skill = skillOf('class_warrior')
        expect(skill.effect?.target).toBe('enemy_front_line')
        expect(skill.abilityMultiplier).toBeGreaterThan(0)
    })

    it('Shockwave reaches the whole encounter and staggers it', () => {
        const skill = skillOf('class_knight')
        expect(skill.effect?.target).toBe('enemy_all')
        expect(skill.effect?.status?.kind).toBe('stun')
    })

    it('gives the Knight more reach than the Warrior, elite over base', () => {
        expect(skillOf('class_warrior').effect?.target).toBe('enemy_front_line')
        expect(skillOf('class_knight').effect?.target).toBe('enemy_all')
    })

    it('Threatening Roar cows the encounter and pulls it onto the roarer', () => {
        const skill = skillOf('class_barbarian')
        expect(skill.effect?.target).toBe('enemy_all')
        expect(skill.effect?.status).toMatchObject({ kind: 'debuff', stat: 'pwr' })
        expect(skill.effect?.selfStatus?.kind).toBe('taunt')
        // Utility, not damage — this is the Warrior path's aggro button, not a second sweep.
        expect(skill.abilityMultiplier).toBe(0)
    })

    it('escalates the Archer line pierce → line → board', () => {
        expect(skillOf('class_archer').effect?.target).toBe('enemy_pierce')
        expect(skillOf('class_bowman').effect?.target).toBe('enemy_front_line')
        expect(skillOf('class_marksman').effect?.target).toBe('enemy_all')
    })

    it('pays Piercing Arrow more than a basic attack and less than a burst', () => {
        // "slightly higher damage than a basic attack" — a basic attack is ×1.
        expect(skillOf('class_archer').abilityMultiplier).toBeGreaterThan(1)
        expect(skillOf('class_archer').abilityMultiplier)
            .toBeLessThan(skillOf('class_hunter').abilityMultiplier)
    })

    it('makes Kill Shot a guaranteed crit at double crit damage, single target', () => {
        const skill = skillOf('class_hunter')
        expect(skill.effect?.alwaysCrits).toBe(true)
        expect(skill.effect?.critDamageMultiplier).toBe(KILL_SHOT_CRIT_MULTIPLIER)
        // Single-target: the Hunter's multi-strike is on its autoattack, not here.
        expect(skill.effect?.target).toBe('enemy_single')
    })
})

describe('the nine skills the docs described', () => {
    const skillOf = (classId: keyof typeof CLASS_BY_ID) => CLASS_BY_ID[classId]!.skill

    it('doubles SPD for Haste, the one magnitude any doc states', () => {
        expect(skillOf('class_beginner').effect?.selfStatus)
            .toMatchObject({ kind: 'buff', stat: 'spd', magnitude: 1 })
    })

    it('makes Enrage a trade, not a free buff', () => {
        const effect = skillOf('class_berserker').effect
        expect(effect?.selfStatus).toMatchObject({ kind: 'buff', stat: 'pwr' })
        // The cost half — §2's "trades incoming damage taken" — without which it is strictly
        // an upgrade and the word "trades" means nothing.
        expect(effect?.status).toMatchObject({ kind: 'debuff', stat: 'def' })
    })

    it('spreads Bouncebolt across the line and the storms across the board', () => {
        expect(skillOf('class_mage').effect?.target).toBe('enemy_front_line')
        expect(skillOf('class_wizard').effect?.target).toBe('enemy_all')
        expect(skillOf('class_sorcerer').effect?.target).toBe('enemy_all')
        // The Sorcerer is the Wizard's master tier, so it leaves a burn behind.
        expect(skillOf('class_sorcerer').effect?.status?.kind).toBe('dot')
    })

    it('points the party-or-battlefield abilities at the party', () => {
        for (const classId of ['class_shaman', 'class_witch_doctor', 'class_paladin'] as const) {
            const target = skillOf(classId).effect?.target
            expect(['ally_all', 'self'], classId).toContain(target)
        }
    })
})

describe('the 28 Champion abilities', () => {
    const pool = Object.values(CHAMPION_ABILITY_POOL).flat()

    it('gives every ability in the pool an authored effect', () => {
        for (const name of pool) {
            expect(CHAMPION_ABILITY_EFFECTS[name], name).toBeDefined()
        }
        // And nothing authored that is not in the pool — a typo'd key would otherwise sit
        // there silently doing nothing.
        for (const name of Object.keys(CHAMPION_ABILITY_EFFECTS)) {
            expect(pool, name).toContain(name)
        }
    })

    it('finally gives Support and Control a mechanical identity', () => {
        // The whole point of the pass: before it, a Support's heal and a Control's silence
        // were single-target damage exactly like a Damage Champion's Cleave.
        for (const name of CHAMPION_ABILITY_POOL.support) {
            const effect = CHAMPION_ABILITY_EFFECTS[name]!
            const helpsAllies = effect.heal || effect.shield || effect.revive
                || effect.cleanse || (isAllyTarget(effect.target) && effect.status)
            expect(Boolean(helpsAllies), name).toBe(true)
        }
        for (const name of CHAMPION_ABILITY_POOL.control) {
            const effect = CHAMPION_ABILITY_EFFECTS[name]!
            const controls = effect.status?.kind === 'debuff'
                || effect.status?.kind === 'silence'
                || effect.status?.kind === 'stun'
                || Boolean(effect.extendDebuffs)
            expect(controls, name).toBe(true)
        }
    })

    it('keeps Tank abilities defensive rather than offensive', () => {
        for (const name of CHAMPION_ABILITY_POOL.tank) {
            const effect = CHAMPION_ABILITY_EFFECTS[name]!
            const defends = effect.selfStatus?.kind === 'taunt'
                || effect.selfStatus?.kind === 'reflect'
                || effect.selfStatus?.kind === 'redirect'
                || effect.selfStatus?.kind === 'buff'
                || effect.status?.kind === 'buff'
                || effect.status?.kind === 'stun'
            expect(defends, name).toBe(true)
        }
    })

    it('points every Champion ability at a real target pattern', () => {
        for (const champion of CHAMPIONS) {
            for (const skill of champion.abilities) {
                expect(skill.effect?.target, `${champion.id}/${skill.name}`).toBeTruthy()
            }
        }
    })

    it('arms damage abilities and disarms utility ones', () => {
        for (const champion of CHAMPIONS) {
            for (const skill of champion.abilities) {
                const effect = skill.effect!
                const isUtility = skill.abilityMultiplier === 0
                if (!isUtility) continue
                // A zero-damage ability must carry a payload, or it is a cooldown that does
                // nothing at all — the same invariant the class skills are held to.
                const payload = effect.status || effect.selfStatus || effect.heal
                    || effect.shield || effect.revive || effect.cleanse || effect.extendDebuffs
                expect(Boolean(payload), skill.name).toBe(true)
            }
        }
    })

    it('splits Focused Barrage into several crit rolls', () => {
        expect(CHAMPION_ABILITY_EFFECTS['Focused Barrage']!.hits).toBe(FOCUSED_BARRAGE_HITS)
        expect(FOCUSED_BARRAGE_HITS).toBeGreaterThan(1)
    })

    it('expresses Unraveling Curse against the status registry directly', () => {
        // The ability that forced the registry to be queryable in the first place.
        expect(CHAMPION_ABILITY_EFFECTS['Unraveling Curse']!.extendDebuffs).toBeGreaterThan(0)
    })

    describe('Frostbind — a stacking slow that freezes at a threshold', () => {
        const frostbind = CHAMPION_ABILITY_EFFECTS.Frostbind!

        it('stacks a slow and escalates to a freeze', () => {
            expect(frostbind.status).toMatchObject({ kind: 'debuff', stat: 'spd' })
            expect(frostbind.status?.stacks).toBe(FROSTBIND_STACKS_PER_CAST)
            expect(frostbind.escalation?.atStacks).toBe(FROSTBIND_FREEZE_STACKS)
            expect(frostbind.escalation?.status.kind).toBe('stun')
        })

        it('keeps the freeze reachable — a threshold above the stack cap would disable it', () => {
            // Both halves are dials, so this is the assertion that they are currently set to
            // values that actually meet. Raising the threshold past the cap is a legitimate way
            // to turn the freeze off; doing it by accident is not.
            expect(FROSTBIND_FREEZE_STACKS).toBeLessThanOrEqual(STATUS_MAX_STACKS)
            expect(FROSTBIND_STACKS_PER_CAST).toBeGreaterThan(0)
        })

        it('fires the freeze on the cast that crosses the threshold, not before', () => {
            // Walked through `applyStatus` directly, which is what the fight loop checks
            // against — so this pins the *rule*, independent of how long a fight runs.
            const statuses: StatusInstance[] = []
            const casts = Math.ceil(FROSTBIND_FREEZE_STACKS / FROSTBIND_STACKS_PER_CAST)

            for (let cast = 1; cast <= casts; cast++) {
                applyStatus(statuses, {
                    id: 'frostbind', kind: 'debuff', stat: 'spd',
                    duration: 10, magnitude: 0.2, stacks: FROSTBIND_STACKS_PER_CAST
                })
                const built = statuses.find(status => status.id === 'frostbind')!
                const shouldFreeze = built.stacks >= FROSTBIND_FREEZE_STACKS
                expect(shouldFreeze, `after cast ${cast}`).toBe(cast >= casts)
            }
        })
    })
})

describe('execute scaling', () => {
    it('is neutral at full HP and pays out fully at zero', () => {
        const effect = { target: 'enemy_single' as const, executeBonus: EXECUTE_BONUS }
        expect(executeMultiplier(effect, 1)).toBe(1)
        expect(executeMultiplier(effect, 0)).toBe(1 + EXECUTE_BONUS)
        expect(executeMultiplier(effect, 0.5)).toBeCloseTo(1 + EXECUTE_BONUS / 2, 10)
    })

    it('is the identity for an ability with no execute clause', () => {
        expect(executeMultiplier({ target: 'enemy_single' }, 0)).toBe(1)
    })
})

describe('stretchEffect', () => {
    const weaken = {
        target: 'enemy_single' as const,
        heal: 0.5,
        status: { kind: 'debuff' as const, stat: 'pwr' as const, duration: 6, magnitude: 0.4 }
    }

    it('stretches a status over time rather than deepening it, so a debuff never clamps to zero', () => {
        const stretched = stretchEffect(weaken, 3)
        expect(stretched.status!.duration).toBe(18)
        expect(stretched.status!.magnitude).toBe(0.4)
    })

    it('grows per-cast payloads with the wait', () => {
        expect(stretchEffect(weaken, 3).heal).toBe(1.5)
    })

    it('is the identity on the bottom rank', () => {
        expect(stretchEffect(weaken, 1)).toBe(weaken)
    })
})
