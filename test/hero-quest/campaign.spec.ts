/**
 * Campaign walker — the `--report=campaign` engine.
 *
 * Guards the properties the report's conclusions rest on: that the walk stops for a stated
 * reason, that grinding only ever moves the hero forward, and that a wall means the run
 * genuinely could not continue rather than the loop giving up early.
 */

import { describe, expect, it } from 'vitest'
import { analyzeCampaign, analyzeStage, makeHero, minLevelToClear, SIM_MATURE_TENURE_DAYS } from '../../scripts/hero-quest/sim'
import { STAGES_PER_WORLD, WORLD_COUNT } from '#shared/utils/hero-quest/constants'

const hero = makeHero('class_beginner', 1)

/**
 * Enough prestiges for a solo Hero to actually run out of road. Where that lands moves with
 * tuning, so specs that need a real wall walk far rather than naming a depth.
 */
const TO_THE_WALL = { maxPrestige: 6 }

/**
 * A short walk that still contains a blocked stage, and therefore a grind event.
 *
 * ⚠ It must keep containing one. Over an empty grind list several specs below pass vacuously
 * rather than failing — "every grind raises the level" is trivially true of nothing — so if a
 * retune clears the walk, lengthen it.
 */
const PAST_A_BLOCKER = { maxPrestige: 1 }

describe('analyzeCampaign', () => {
    it('walks past blockers by farming instead of stopping at the first one', () => {
        const result = analyzeCampaign(hero, 0, PAST_A_BLOCKER)

        expect(result.grinds.length).toBeGreaterThan(0)
        // `analyzeWorld` stops at the first stage it cannot clear; the campaign farms and
        // keeps going, so it reports more than the one world a single-world walk would.
        expect(result.rows.length).toBeGreaterThan(1)
        expect(result.endLevel).toBeGreaterThan(result.startLevel)
    })

    it('every grind raises the level and costs finite time', () => {
        const result = analyzeCampaign(hero, 0, PAST_A_BLOCKER)

        for (const event of result.grinds) {
            expect(event.toLevel).toBeGreaterThan(event.fromLevel)
            expect(event.seconds).toBeGreaterThan(0)
            expect(Number.isFinite(event.seconds)).toBe(true)
            expect(event.kills).toBeGreaterThan(0)
        }
    })

    it('never farms ahead of the blocked stage, and never on a boss', () => {
        const result = analyzeCampaign(hero, 0, PAST_A_BLOCKER)

        for (const event of result.grinds) {
            // Not *behind*: `farmStageFor` starts with the blocked stage itself, because a wave
            // stage the party cannot survive still banks the kills it lands and restarts, so it
            // is a farm (`settle.killsBeforeWipe`). What must never happen is farming a stage
            // the run has not reached, or a gate — a boss is one fight on a one-way door.
            const ahead = event.farmWorld > event.world
                || (event.farmWorld === event.world && event.farmStage > event.stage)
            expect(ahead).toBe(false)
            expect([5, 10]).not.toContain(event.farmStage)
        }
    })

    it('stops on a wall whose stage really is unclearable at the level reached', () => {
        const result = analyzeCampaign(hero, 0, TO_THE_WALL)
        const { wall } = result

        expect(wall.reason).not.toBe('prestige_limit')
        const stuck = analyzeStage(
            makeHero(hero.classId, wall.level), wall.prestige, wall.world, wall.stage, SIM_MATURE_TENURE_DAYS)
        expect(stuck.verdict).not.toBe('clear')

        // A grind wall is the honest kind: clearable, just not affordably.
        if (wall.reason === 'grind_budget') {
            expect(wall.requiredLevel).toBeGreaterThan(wall.level)
        }
    })

    it('a bigger grind budget never moves the wall backwards', () => {
        const depth = (report: ReturnType<typeof analyzeCampaign>) =>
            (report.wall.prestige * WORLD_COUNT + report.wall.world) * STAGES_PER_WORLD + report.wall.stage

        // `TO_THE_WALL`, not `PAST_A_BLOCKER`: this spec needs the tight budget to be what
        // actually stops the walk, so the walk must be long enough to contain a grind an hour
        // cannot pay for.
        const tight = analyzeCampaign(hero, 0, { ...TO_THE_WALL, grindBudgetSeconds: 3600 })
        const loose = analyzeCampaign(hero, 0, { ...TO_THE_WALL, grindBudgetSeconds: 3.2e10, maxLevel: 100000 })

        expect(tight.wall.reason).toBe('grind_budget')
        expect(depth(loose)).toBeGreaterThan(depth(tight))
        expect(loose.endLevel).toBeGreaterThan(tight.endLevel)
    })

    it('never reports a world it did not reach', () => {
        const result = analyzeCampaign(hero, 0, TO_THE_WALL)
        const last = result.rows.at(-1)!

        expect(last.completed).toBe(false)
        expect(last.world).toBe(result.wall.world)
        expect(result.rows.filter(row => !row.completed)).toHaveLength(1)
    })

    it('accumulates time and gold monotonically across the walk', () => {
        const result = analyzeCampaign(hero, 0, PAST_A_BLOCKER)

        expect(result.totalSeconds).toBeCloseTo(result.fightSeconds + result.grindSeconds, 6)
        expect(result.totalGold).toBeGreaterThan(0)
        expect(result.rows.reduce((sum, row) => sum + row.gold, 0)).toBeCloseTo(result.totalGold, 6)
    })
})

describe('minLevelToClear', () => {
    it('agrees with the stage verdict at the boundary', () => {
        const required = minLevelToClear(hero, 0, 1, STAGES_PER_WORLD)
        expect(required).not.toBeNull()

        expect(analyzeStage(makeHero(hero.classId, required!), 0, 1, STAGES_PER_WORLD, SIM_MATURE_TENURE_DAYS).verdict).toBe('clear')
        expect(analyzeStage(makeHero(hero.classId, required! - 1), 0, 1, STAGES_PER_WORLD, SIM_MATURE_TENURE_DAYS).verdict).not.toBe('clear')
    })

    it('respects the search floor', () => {
        const floor = 200
        expect(minLevelToClear(hero, 0, 1, 1, floor)).toBe(floor)
    })

    it('returns null rather than a wrong answer when the ceiling is too low', () => {
        expect(minLevelToClear(hero, 0, WORLD_COUNT, STAGES_PER_WORLD, 1, 5)).toBeNull()
    })
})
