/**
 * Where the battle screen thinks the run has got to.
 *
 * `projectRun` walks the run forward from a payload — kills, stage, world, XP, level. It exists
 * because the screen was a minute-old photograph: the stage counter filled and then sat at 30/30,
 * and the world and stage never moved until the poll landed. The specs that matter are the ones
 * pinning that the client's walk is the *same* walk `settle()` does — stage rollover, the boss
 * gate that stops it, and the wave wall that restarts instead of clearing. A client that advanced
 * past a gate the server parks at would be lying about where the player is.
 */

import { describe, expect, it } from 'vitest'
import { projectRun, type RunAnchor } from '../../app/utils/hero-quest-battle'
import { enemyPackAt, killsBeforeWipe, settle, totalXpForLevel, xpPerKill } from '#shared/utils/hero-quest/settle'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { BASE_KILL_COUNT, BOSS_STAGE, STAGES_PER_WORLD } from '#shared/utils/hero-quest/constants'
import { ZERO } from '#shared/utils/hero-quest/numbers'

/** Mature, so the Gold tenure ceiling never binds and these specs measure the walk, not the cap. */
const SPEC_TENURE_DAYS = 3650

const anchor: RunAnchor = {
    prestige: 0,
    world: 1,
    stage: 1,
    killCount: 0,
    killFraction: 0,
    recoverySeconds: 0,
    secondsPerKill: 2,
    killsBeforeWipe: 60,
    goldBonusPct: 0,
    xpBonusPct: 0,
    heroLevel: 1,
    heroXp: '0',
    tenureDays: SPEC_TENURE_DAYS
}
const project = (over: Partial<RunAnchor>, seconds: number) =>
    projectRun({ ...anchor, ...over }, seconds)

describe('walking the run forward between payloads', () => {
    it('advances the kill count at the server\'s own seconds-per-kill, from the served count', () => {
        expect(project({}, 9).killsInStage).toBe(4.5)
        expect(project({ killCount: 10 }, 4).killsInStage).toBe(12)
    })

    it('stands still when the server reports no rate', () => {
        // `secondsPerKill` is null when the party cannot kill anything. Dividing by it would
        // send the run to Infinity; the honest reading is that nothing is happening.
        expect(project({ secondsPerKill: null }, 9999).killsInStage).toBe(0)
        expect(project({ secondsPerKill: 0 }, 9999).killsInStage).toBe(0)
        expect(project({ secondsPerKill: null }, 9999).stage).toBe(1)
    })

    it('rolls over into the next stage instead of pinning at the requirement', () => {
        // The regression this whole file exists for: the counter used to fill and stop.
        const rolled = project({}, BASE_KILL_COUNT * 2 + 4)
        expect(rolled.stage).toBe(2)
        expect(rolled.killsInStage).toBe(2)
        expect(rolled.killsRequired).toBe(BASE_KILL_COUNT)
    })

    it('never turns a world over on its own — the last stage of one is a super boss', () => {
        const held = project(
            { stage: STAGES_PER_WORLD, killCount: 0, killsBeforeWipe: null },
            100_000
        )
        expect(held.atBossGate).toBe(true)
        expect(held.world).toBe(1)
        expect(held.stage).toBe(STAGES_PER_WORLD)
    })
})

describe('the stops the server would have made', () => {
    it('parks at a boss gate rather than walking through it', () => {
        const far = project({ stage: BOSS_STAGE - 1, killCount: BASE_KILL_COUNT - 1 }, 100_000)
        expect(far.stage).toBe(BOSS_STAGE)
        expect(far.atBossGate).toBe(true)
    })

    it('restarts a walled stage instead of clearing it, however long it runs', () => {
        // A wall is `killsBeforeWipe < killsRequired`. The attempt cycles rather than banking,
        // so the stage is never left.
        const walled = project({ killsBeforeWipe: 12 }, 100_000)
        expect(walled.walled).toBe(true)
        expect(walled.stage).toBe(1)
        expect(walled.killsInStage).toBeLessThan(12)
    })

    it('earns nothing on a stage that kills faster than it clears', () => {
        const hopeless = project({ killsBeforeWipe: 0 }, 100_000)
        expect(hopeless.killsInStage).toBe(0)
        expect(hopeless.goldEarned).toBe(0)
    })
})

describe('agreement with the settle it is drawing', () => {
    /**
     * The client's walk and the server's have to land in the same place, or the screen shows a
     * stage the run is not on and then snaps back when the poll arrives. Compared against
     * `settle()` directly: the claim is not "stage 4" but "wherever the server would have put it".
     */
    const hero = {
        classId: 'class_beginner' as const,
        heroLevel: 1,
        heroXp: ZERO,
        goldBonusPct: 0,
        offlineEfficiencyLevel: 0,
        offlineCapLevel: 0
    }

    for (const seconds of [120, 3600]) {
        it(`lands where settle() would after ${seconds}s online`, () => {
            const served = settle({
                hero,
                position: { prestige: 0, world: 1, stage: 1, killsInStage: 0 },
                elapsedSeconds: seconds,
                online: true,
                tenureDays: SPEC_TENURE_DAYS
            })

            // The same bound the server puts in the payload (`server/utils/hero-quest.ts`).
            const units = partyUnitStats(hero)
            const pack = enemyPackAt(served.position)
            const wipeAt = killsBeforeWipe(units, pack, served.secondsPerKill)

            const projected = project({
                secondsPerKill: served.secondsPerKill,
                killsBeforeWipe: Number.isFinite(wipeAt) ? wipeAt : null
            }, seconds)

            expect(projected.world).toBe(served.position.world)
            expect(projected.stage).toBe(served.position.stage)
            expect(Math.floor(projected.killsInStage)).toBe(served.position.killsInStage)
            // The readout earns XP on the part-kill too, so it runs ahead by under one kill's XP.
            const total = (level: number, xp: typeof ZERO) => totalXpForLevel(level).add(xp)
            const ahead = total(projected.heroLevel, projected.heroXp).sub(total(served.heroLevel, served.heroXp))
            expect(ahead.gte(0)).toBe(true)
            expect(ahead.lt(xpPerKill(0, served.position.world, served.position.stage))).toBe(true)
        })
    }
})
