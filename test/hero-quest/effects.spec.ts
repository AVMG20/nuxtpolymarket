/**
 * Ability targeting on the enemy grid, and the invariants that keep an authored ability from
 * silently doing nothing.
 */

import { describe, expect, it } from 'vitest'
import {
    columnOf,
    enemyPosition,
    rowOf
} from '#shared/utils/hero-quest/settle'
import {
    executeMultiplier,
    resolveAllyTargets,
    resolveEnemyTargets,
    stretchEffect
} from '#shared/utils/hero-quest/effects'
import {
    CHAMPIONS,
    CHAMPION_ABILITY_EFFECTS,
    CHAMPION_ABILITY_POOL
} from '#shared/utils/hero-quest/content/champions'
import {
    EXECUTE_BONUS,
    FROSTBIND_FREEZE_STACKS,
    FROSTBIND_STACKS_PER_CAST,
    STATUS_MAX_STACKS
} from '#shared/utils/hero-quest/constants'

const geometry = { columnOf, rowOf }
const all = (size: number) => Array.from({ length: size }, (_unused, index) => index)

describe('the enemy grid', () => {
    it('lines columns up front to back', () => {
        expect(columnOf(0, 6)).toEqual([0, 3])
        expect(columnOf(2, 6)).toEqual([2, 5])
        // A back-row member resolves to the same column as the body screening it.
        expect(columnOf(4, 6)).toEqual([1, 4])
    })

    it('keeps a lone enemy in front, so nothing hides behind an empty row', () => {
        expect(enemyPosition(0, 1)).toEqual({ row: 'front', col: 0 })
        expect(rowOf('back', 1)).toEqual([])
    })
})

describe('target patterns', () => {
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

describe('Champion abilities', () => {
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

    it('keeps the Frostbind freeze reachable — a threshold above the stack cap would disable it', () => {
        // Both halves are dials; raising the threshold past the cap is a legitimate way to turn
        // the freeze off, but doing it by accident is not.
        expect(FROSTBIND_FREEZE_STACKS).toBeLessThanOrEqual(STATUS_MAX_STACKS)
        expect(FROSTBIND_STACKS_PER_CAST).toBeGreaterThan(0)
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

    it('is the identity on the bottom rank', () => {
        expect(stretchEffect(weaken, 1)).toBe(weaken)
    })
})
