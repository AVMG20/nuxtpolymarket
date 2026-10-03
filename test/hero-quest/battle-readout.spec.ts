/**
 * What the battle screen draws, and where it thinks the run has got to.
 *
 * Two halves, matching the module. `projectRun` walks the run forward from a payload — kills,
 * stage, world, XP, level — and `battleReadout` turns where it landed into bars.
 *
 * The projection half exists because the screen was a minute-old photograph: the stage counter
 * filled and then sat at 30/30, the world and stage never moved until the poll landed, and the XP
 * bar was frozen the whole time. The specs that matter most here are the ones pinning that the
 * client's walk is the *same* walk `settle()` does — stage rollover, the boss gate that stops it,
 * and the wave wall that restarts instead of clearing. A client that advanced past a gate the
 * server parks at would be lying about where the player is.
 *
 * The readout half comes from the session-1 playtest: the Hero HP bar never moved, the enemy HP
 * figure disagreed with the bar beside it, and the pack count never came down. The fix was to
 * derive every readout from one quantity, so the bars cannot disagree.
 */

import { describe, expect, it } from 'vitest'
import {
    battleReadout,
    HeroHpGauge,
    projectRun,
    type BattleReadoutInput,
    type RunAnchor
} from '../../app/utils/hero-quest-battle'
import { enemyPackAt, killsBeforeWipe, settle, totalXpForLevel } from '#shared/utils/hero-quest/settle'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import { BASE_KILL_COUNT, BOSS_STAGE, STAGES_PER_WORLD, WIPE_RECOVERY_SECONDS } from '#shared/utils/hero-quest/constants'
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
    it('advances the kill count at the server\'s own seconds-per-kill', () => {
        expect(project({}, 0).killsInStage).toBe(0)
        expect(project({}, 2).killsInStage).toBe(1)
        expect(project({}, 9).killsInStage).toBe(4.5)
    })

    it('starts from the served count rather than from zero', () => {
        expect(project({ killCount: 10 }, 4).killsInStage).toBe(12)
    })

    it('starts from the served part-kill too, so the current body is not rewound', () => {
        // The settle banks whole kills and carries the rest; anchoring at the whole count alone
        // would step the enemy's HP bar backwards by up to one body every time a payload landed.
        expect(project({ killCount: 10, killFraction: 0.5 }, 0).killsInStage).toBe(10.5)
        expect(project({ killCount: 10, killFraction: 0.5 }, 3).killsInStage).toBe(12)
    })

    it('ignores a part-kill outside [0, 1), exactly as the settle does', () => {
        expect(project({ killCount: 10, killFraction: 1 }, 0).killsInStage).toBe(10)
        expect(project({ killCount: 10, killFraction: -1 }, 0).killsInStage).toBe(10)
        expect(project({ killCount: 10, killFraction: Number.NaN }, 0).killsInStage).toBe(10)
    })

    it('stands still when the server reports no rate', () => {
        // `secondsPerKill` is null when the party cannot kill anything. Dividing by it would
        // send the run to Infinity; the honest reading is that nothing is happening.
        expect(project({ secondsPerKill: null }, 9999).killsInStage).toBe(0)
        expect(project({ secondsPerKill: 0 }, 9999).killsInStage).toBe(0)
        expect(project({ secondsPerKill: null }, 9999).stage).toBe(1)
    })

    it('rolls over into the next stage instead of pinning at the requirement', () => {
        // The regression this whole half exists for: the counter used to fill and stop.
        const rolled = project({}, BASE_KILL_COUNT * 2 + 4)
        expect(rolled.stage).toBe(2)
        expect(rolled.killsInStage).toBe(2)
        expect(rolled.killsRequired).toBe(BASE_KILL_COUNT)
    })

    it('never turns a world over on its own — the last stage of one is a super boss', () => {
        // Worth pinning as a property rather than left implicit: every world ends in a gate, so
        // the projection can advance stages freely but a *world* only ever changes because the
        // player won a fight the server resolved. The screen cannot walk itself into World 2.
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

    it('keeps earning while parked, because the gate farms the stage before it', () => {
        const parked = project({ stage: BOSS_STAGE }, 600)
        expect(parked.atBossGate).toBe(true)
        expect(parked.stage).toBe(BOSS_STAGE)
        expect(parked.goldEarned).toBeGreaterThan(0)
        expect(parked.heroXp.gt(0) || parked.levelsGained > 0).toBe(true)
    })

    it('restarts a walled stage instead of clearing it, however long it runs', () => {
        // A wall is `killsBeforeWipe < killsRequired`. The attempt cycles rather than banking,
        // so the stage is never left and the Hero bar sawtooths.
        const walled = project({ killsBeforeWipe: 12 }, 100_000)
        expect(walled.walled).toBe(true)
        expect(walled.stage).toBe(1)
        expect(walled.killsInStage).toBeLessThan(12)
    })

    it('holds a wiped party down for the recovery before its next attempt', () => {
        // 12 kills at 2s is 24s, then the recovery: nothing lands until it has run out
        const fell = project({ killsBeforeWipe: 12 }, 24 + WIPE_RECOVERY_SECONDS / 2)
        expect(fell.killsInStage).toBe(0)
        expect(fell.recoverySeconds).toBeCloseTo(WIPE_RECOVERY_SECONDS / 2, 10)
        expect(fell.killsLanded).toBe(12)

        const back = project({ killsBeforeWipe: 12 }, 24 + WIPE_RECOVERY_SECONDS + 4)
        expect(back.killsInStage).toBeCloseTo(2, 10)
        expect(back.recoverySeconds).toBe(0)
        expect(back.killsLanded).toBeCloseTo(14, 10)
    })

    it('serves a recovery the server says is owed before anything lands', () => {
        const owed = project({ killsBeforeWipe: 12, recoverySeconds: 3 }, 2)
        expect(owed.killsLanded).toBe(0)
        expect(owed.recoverySeconds).toBeCloseTo(1, 10)
        expect(owed.walled).toBe(true)
        expect(project({ killsBeforeWipe: 12, recoverySeconds: 3 }, 7).killsInStage).toBeCloseTo(2, 10)
    })

    it('earns nothing on a stage that kills faster than it clears', () => {
        const hopeless = project({ killsBeforeWipe: 0 }, 100_000)
        expect(hopeless.killsInStage).toBe(0)
        expect(hopeless.goldEarned).toBe(0)
        expect(hopeless.killsLanded).toBe(0)
    })
})

describe('agreement with the settle it is drawing', () => {
    /**
     * The client's walk and the server's have to land in the same place, or the screen shows a
     * stage the run is not on and then snaps back when the poll arrives.
     *
     * Compared against `settle()` directly rather than against a hand-written expectation: the
     * claim is not "stage 4" but "wherever the server would have put it". The two differ by under
     * one kill by construction — `settle` floors its kill budget into whole banked kills and the
     * projection does not, because a bar redrawn ten times a second should not step in bodies.
     */
    const hero = {
        classId: 'class_beginner' as const,
        heroLevel: 1,
        heroXp: ZERO,
        goldBonusPct: 0,
        offlineEfficiencyLevel: 0,
        offlineCapLevel: 0
    }

    for (const seconds of [30, 120, 600, 3600]) {
        it(`lands where settle() would after ${seconds}s online`, () => {
            const served = settle({
                hero,
                position: { prestige: 0, world: 1, stage: 1, killsInStage: 0 },
                elapsedSeconds: seconds,
                online: true,
                tenureDays: SPEC_TENURE_DAYS
            })

            // The same bound the server puts in the payload (`server/utils/hero-quest.ts`),
            // not `null`. `null` would assert "this stage never wipes", which is not true for a
            // level-1 Hero, and the two walks would then disagree about which stage they are on.
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
            expect(projected.heroLevel).toBe(served.heroLevel)
        })
    }
})

describe('the hero\'s level and XP', () => {
    it('fills the XP bar continuously rather than once a payload', () => {
        const early = project({}, 10)
        const later = project({}, 40)
        expect(later.heroXp.gt(early.heroXp) || later.heroLevel > early.heroLevel).toBe(true)
        expect(early.xpProgress).toBeGreaterThan(0)
        expect(early.xpProgress).toBeLessThanOrEqual(1)
    })

    it('levels up mid-projection, and says how many levels it granted', () => {
        const levelled = project({ killsBeforeWipe: null }, 3600)
        expect(levelled.heroLevel).toBeGreaterThan(1)
        expect(levelled.levelsGained).toBe(levelled.heroLevel - 1)
        // XP resets into the new level rather than accumulating past the threshold.
        expect(levelled.heroXp.lt(levelled.xpToNextLevel)).toBe(true)
    })

    it('applies the served XP bonus rather than stacking one of its own', () => {
        // Measured on lifetime XP, not on `heroXp` — that field is the remainder *after*
        // levelling, so doubling the intake moves the level rather than the remainder.
        const lifetime = (over: Partial<RunAnchor>) => {
            const ahead = project(over, 100)
            return totalXpForLevel(ahead.heroLevel).add(ahead.heroXp)
        }
        expect(lifetime({ xpBonusPct: 1 }).div(lifetime({})).toNumber()).toBeCloseTo(2, 6)
    })

    it('applies the served Gold bonus the same way', () => {
        expect(project({ goldBonusPct: 0.5 }, 100).goldEarned)
            .toBeCloseTo(project({}, 100).goldEarned * 1.5, 6)
    })
})

// ── The bars ───────────────────────────────────────────────────────────────────────────

const base: BattleReadoutInput = {
    killsInStage: 0,
    killsRequired: 30,
    killsBeforeWipe: 60,
    packSize: 6,
    atBossGate: false
}
const read = (over: Partial<BattleReadoutInput> = {}) => battleReadout({ ...base, ...over })

describe('the pack in front of you', () => {
    it('counts bodies down as they drop, and never reaches zero mid-encounter', () => {
        // Six standing at the start; one fewer per kill; the last is still up until the pack
        // rolls over, because an encounter with nothing in it is not a state the player sees.
        expect(read({ killsInStage: 0 }).enemiesStanding).toBe(6)
        expect(read({ killsInStage: 1 }).enemiesStanding).toBe(5)
        expect(read({ killsInStage: 5 }).enemiesStanding).toBe(1)
        expect(read({ killsInStage: 6 }).enemiesStanding).toBe(6)
    })

    it('empties the pack bar in step with the bodies', () => {
        expect(read({ killsInStage: 0 }).enemyHpPct).toBe(100)
        expect(read({ killsInStage: 3 }).enemyHpPct).toBeCloseTo(50, 10)
        expect(read({ killsInStage: 6 }).enemyHpPct).toBe(100)
    })

    it('keeps the bar and the body count telling the same story', () => {
        // The regression that started this: the bar swept on a wall clock while the number
        // beside it never moved. Both now come off `packProgress`, so more of the pack dead
        // always means less of the bar left.
        let previousHp = 101
        for (let kills = 0; kills < 6; kills++) {
            const view = read({ killsInStage: kills })
            expect(view.enemyHpPct, `kill ${kills}`).toBeLessThan(previousHp)
            expect(view.enemiesStanding, `kill ${kills}`).toBe(6 - kills)
            previousHp = view.enemyHpPct
        }
    })

    it('handles a pack of one without dividing by it', () => {
        const view = read({ packSize: 1, killsInStage: 0.5 })
        expect(view.enemiesStanding).toBe(1)
        expect(view.enemyHpPct).toBeCloseTo(50, 10)
    })
})

describe('the Hero bar', () => {
    it('drains across the attempt, per the settle model\'s own semantics', () => {
        // `settle.ts`: "HP carries across the whole stage attempt and refills only when the
        // stage clears or restarts." So the fraction spent is kills over killsBeforeWipe.
        expect(read({ killsInStage: 0 }).heroHpPct).toBe(100)
        expect(read({ killsInStage: 30 }).heroHpPct).toBeCloseTo(50, 10)
    })

    it('stays full for a party the server calls undying', () => {
        // `killsBeforeWipe` is null when nothing can bring the party down — not a reason to
        // divide by nothing.
        expect(read({ killsBeforeWipe: null, killsInStage: 25 }).heroHpPct).toBe(100)
        expect(read({ killsBeforeWipe: 0, killsInStage: 25 }).heroHpPct).toBe(100)
    })

    it('refills as a walled attempt restarts, rather than pinning at empty', () => {
        // The projection cycles `killsInStage` modulo `killsBeforeWipe` on a walled stage, so
        // the bar sawtooths. Watching it refill is how the player sees the restart happen.
        const nearlyDead = read({ killsBeforeWipe: 12, killsInStage: 11.9 })
        const restarted = read({ killsBeforeWipe: 12, killsInStage: 0.1 })
        expect(nearlyDead.heroHpPct).toBeLessThan(5)
        expect(restarted.heroHpPct).toBeGreaterThan(95)
    })

    it('never reports a negative bar', () => {
        expect(read({ killsBeforeWipe: 5, killsInStage: 30 }).heroHpPct).toBe(0)
    })
})

describe('at a boss gate', () => {
    it('parks every bar — a boss is a fight, not a counter', () => {
        const view = read({ atBossGate: true, killsInStage: 3, killsRequired: 0 })
        expect(view.displayKills).toBe(3)
        expect(view.enemyHpPct).toBe(100)
        expect(view.heroHpPct).toBe(100)
        expect(view.enemiesStanding).toBe(6)
    })
})

/**
 * The Hero's HP bar used to rise once a minute: a payload after level-ups raises
 * `killsBeforeWipe`, and the readout's share is kills over it. The gauge never lets it rise
 * within an attempt, and still has it run out on the very kill the party wipes on.
 */
describe('HeroHpGauge', () => {
    const at = (killsInStage: number, killsBeforeWipe: number | null, attempt = '0:1:3') => ({
        attempt, killsInStage, killsBeforeWipe, killsRequired: 30, packSize: 5, atBossGate: false
    })

    it('matches the readout while the budget holds', () => {
        const gauge = new HeroHpGauge()
        for (const k of [0, 5, 10.5, 20]) {
            expect(gauge.next(at(k, 40))).toBeCloseTo(battleReadout(at(k, 40)).heroHpPct)
        }
    })

    it('does not heal when a payload raises the budget, and still empties on the wipe kill', () => {
        const gauge = new HeroHpGauge()
        gauge.next(at(0, 40))
        const before = gauge.next(at(20, 40))
        expect(before).toBeCloseTo(50)
        // the readout alone would jump to 75% here
        expect(battleReadout(at(20, 80)).heroHpPct).toBeCloseTo(75)
        expect(gauge.next(at(20, 80))).toBeCloseTo(50)
        // halfway from kill 20 to the new wipe at 80
        expect(gauge.next(at(50, 80))).toBeCloseTo(25)
        expect(gauge.next(at(80, 80))).toBe(0)
    })

    it('empties early when a payload lowers the budget, never late', () => {
        const gauge = new HeroHpGauge()
        gauge.next(at(0, 40))
        gauge.next(at(20, 40))
        expect(gauge.next(at(20, 30))).toBeCloseTo(50)
        expect(gauge.next(at(30, 30))).toBe(0)
        // a budget already spent empties at once
        const spent = new HeroHpGauge()
        spent.next(at(25, 40))
        expect(spent.next(at(25, 20))).toBe(0)
    })

    it('never rises on a payload pulling kills back by part of one', () => {
        const gauge = new HeroHpGauge()
        gauge.next(at(0, 40))
        const shown = gauge.next(at(20.6, 40))
        expect(gauge.next(at(20.1, 40))).toBe(shown)
    })

    it('fills again on a new stage and on a walled restart', () => {
        const gauge = new HeroHpGauge()
        gauge.next(at(0, 20))
        expect(gauge.next(at(19.5, 20))).toBeCloseTo(2.5)
        // the wall: kills cycle back to the start of a fresh attempt
        expect(gauge.next(at(0.2, 20))).toBeCloseTo(99)
        expect(gauge.next(at(0, 20, '0:1:4'))).toBe(100)
    })

    it('holds where it stands for a party the server calls undying', () => {
        const gauge = new HeroHpGauge()
        gauge.next(at(0, 40))
        gauge.next(at(10, 40))
        expect(gauge.next(at(12, null))).toBeCloseTo(75)
        expect(gauge.next(at(29, null))).toBeCloseTo(75)
    })
})
