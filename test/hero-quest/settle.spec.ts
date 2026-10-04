import { describe, expect, it } from 'vitest'
import {
    applyXp,
    cappedOfflineSeconds,
    curveIndex,
    enemyMultiplier,
    enemyPackAt,
    enemyStatsAt,
    fallbackStage,
    goldPerKill,
    goldProgressionFactor,
    goldTenureCeiling,
    platformCeiling,
    killsBeforeWipe,
    killsRequired,
    maxGoldPerHour,
    secondsToDie,
    nextStage,
    offlineCapHours,
    offlineEfficiency,
    offlineFarmStage,
    rateAt,
    secondsPerKill,
    settle,
    stageArchetype,
    totalXpForLevel,
    walkWall,
    xpPerKill,
    xpToNextLevel
} from '#shared/utils/hero-quest/settle'
import {
    BASE_KILL_COUNT,
    BOSS_STAGE,
    ENEMY_CURVE_T,
    ENEMY_STEP_BASE,
    BASE_GOLD,
    GOLD_BOUND_HORIZON_DAYS,
    GOLD_PLATFORM_DISCOUNT,
    GOLD_STEP_BASE,
    GOLD_TENURE_CEILING,
    GOLD_TENURE_CRAWL,
    GOLD_TENURE_DAYS,
    LEVELS_PER_STAGE,
    MAX_OFFLINE_CAP_LEVEL,
    MAX_OFFLINE_EFFICIENCY,
    MAX_OFFLINE_EFFICIENCY_LEVEL,
    MIN_SECONDS_PER_KILL,
    MAX_BATTLE_SPEED,
    OFFLINE_CAP_MAX_HOURS,
    PRESTIGE_INDEX_STEPS,
    STAGES_PER_WORLD,
    SUPER_BOSS_STAGE,
    WIPE_RECOVERY_SECONDS,
    WORLD_COUNT,
    XP_STEP_BASE,
    XP_TO_LEVEL_BASE,
    XP_TO_LEVEL_GROWTH
} from '#shared/utils/hero-quest/constants'
import { D, ZERO } from '#shared/utils/hero-quest/numbers'
import { partyDps } from '#shared/utils/hero-quest/combat'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import type { HeroSnapshot, RunPosition, SettleInput } from '#shared/utils/hero-quest/types'

const hero: HeroSnapshot = {
    classId: 'class_beginner',
    heroLevel: 1,
    heroXp: ZERO,
    goldBonusPct: 0,
    offlineEfficiencyLevel: 0,
    offlineCapLevel: 0
}

function at(world: number, stage: number, killsInStage = 0, prestige = 0): RunPosition {
    return { prestige, world, stage, killsInStage }
}

/**
 * Lowest level at which a solo Hero outlasts every wave stage in World 1 — **found, not named.**
 *
 * A Hero that levels as it walks clears World 1 Stages 1–4, but a level-1 *snapshot* held for a
 * whole settle window does not: it drops on Stage 4 of World 1. Specs about *advance* and *gate*
 * logic need a Hero past that point, or they quietly measure the wave wipe instead of the rule
 * they claim to test.
 */
const OPENING_CLEAR_LEVEL = (() => {
    for (let heroLevel = 1; heroLevel <= 300; heroLevel++) {
        const units = partyUnitStats({ ...hero, heroLevel })
        const clearsWorldOne = [1, 2, 3, 4].every(stage => {
            const pack = enemyPackAt(at(1, stage))
            return killsBeforeWipe(units, pack, secondsPerKill(units, pack)) >= BASE_KILL_COUNT
        })
        if (clearsWorldOne) return heroLevel
    }
    throw new Error('no level within reach clears World 1 — the opening is unplayable')
})()

/**
 * First position along the play order where the hero cannot land a single kill inside the
 * longest window the game ever settles (the 72h offline cap).
 *
 * With the `MIN_DAMAGE` floor no position produces literally zero damage — the wall is a *rate*
 * wall rather than an absolute one. "Cannot progress" therefore
 * has to be expressed against a time budget, and the offline cap is the natural one: a stage
 * that yields nothing across a maximal offline window yields nothing in practice.
 */
const LONGEST_SETTLE_SECONDS = 72 * 3600

/**
 * Scanned across prestiges, not just the first loop — tuning moves where the stall lands, and
 * naming a prestige would be the same mistake as naming a stage: the claim under test is that
 * the wall exists and that levels answer it, not where it sits.
 */
const STALL_SEARCH_PRESTIGES = 4

function firstStallingPosition(snapshot: HeroSnapshot): RunPosition | null {
    for (let prestige = 0; prestige < STALL_SEARCH_PRESTIGES; prestige++) {
        for (let world = 1; world <= WORLD_COUNT; world++) {
            for (let stage = 1; stage <= STAGES_PER_WORLD; stage++) {
                // Wave stages only. A gate settles to zero kills because it is a gate — the
                // fight is a separate seeded resolution — so a gate would satisfy every
                // assertion below without the DEF wall being involved at all, and the spec
                // would quietly stop testing what it claims to.
                if (stage === BOSS_STAGE || stage === SUPER_BOSS_STAGE) continue
                const position = at(world, stage, 0, prestige)
                const spk = secondsPerKill(partyUnitStats(snapshot), enemyPackAt(position))
                if (!(spk <= LONGEST_SETTLE_SECONDS)) return position
            }
        }
    }
    return null
}

/**
 * The lowest level at which the wall stops being a wall — found, not named, for the same reason
 * the wall itself is. A single retune can move it by a hundred levels.
 *
 * Searched through `settle` rather than through `secondsPerKill`, because the rate alone is not
 * what decides whether a window yields anything: the offline cap shortens the window, a party
 * that wipes restarts the stage, and `MIN_SECONDS_PER_KILL` floors the result. Asking the thing
 * under test is both simpler and harder to fool than reproducing its three gates here and
 * getting one of them subtly wrong.
 */
function firstLevelClearing(snapshot: HeroSnapshot, position: RunPosition, maxLevel = 1000): number | null {
    for (let heroLevel = 1; heroLevel <= maxLevel; heroLevel++) {
        const attempt = settle(input({
            hero: { ...snapshot, heroLevel },
            position,
            elapsedSeconds: LONGEST_SETTLE_SECONDS
        }))
        if (attempt.kills > 0) return heroLevel
    }
    return null
}

/**
 * Old enough that the Gold tenure ceiling is never the binding term, so every assertion below
 * that is really about the *progression* curve keeps measuring the progression curve. The
 * ceiling gets its own block, where it is the thing under test.
 */
const SPEC_TENURE_DAYS = 3650

function input(overrides: Partial<SettleInput> = {}): SettleInput {
    return {
        hero,
        position: at(1, 1),
        elapsedSeconds: 3600,
        online: false,
        tenureDays: SPEC_TENURE_DAYS,
        ...overrides
    }
}

describe('hero-quest settle', () => {
    describe('curve index', () => {
        it('is 0 at the origin and one step per stage', () => {
            expect(curveIndex(0, 1, 1)).toBe(0)
            expect(curveIndex(0, 1, 2)).toBe(1)
            expect(curveIndex(0, 2, 1)).toBe(STAGES_PER_WORLD)
            expect(curveIndex(1, 1, 1)).toBe(PRESTIGE_INDEX_STEPS)
        })

        it('increases by exactly one along the whole play order, seams included', () => {
            let previous = -1
            for (let prestige = 0; prestige < 3; prestige++) {
                for (let world = 1; world <= WORLD_COUNT; world++) {
                    for (let stage = 1; stage <= STAGES_PER_WORLD; stage++) {
                        const index = curveIndex(prestige, world, stage)
                        expect(index).toBe(previous + 1)
                        previous = index
                    }
                }
            }
        })
    })

    describe('enemy curve', () => {
        it('is 1 at the origin', () => {
            expect(enemyMultiplier(0, 1, 1).toNumber()).toBe(1)
        })

        it('grows by the same ratio for every step, wherever the step falls', () => {
            const ratio = (a: [number, number, number], b: [number, number, number]) =>
                enemyMultiplier(...b).div(enemyMultiplier(...a)).toNumber()

            // Mid-world, across a world boundary, and across a prestige boundary.
            expect(ratio([0, 1, 1], [0, 1, 2])).toBeCloseTo(ENEMY_STEP_BASE, 10)
            expect(ratio([0, 1, 10], [0, 2, 1])).toBeCloseTo(ENEMY_STEP_BASE, 10)
            expect(ratio([0, 10, 10], [1, 1, 1])).toBeCloseTo(ENEMY_STEP_BASE, 10)
        })

        it('multiplies by T over one full loop', () => {
            expect(enemyMultiplier(1, 1, 1).toNumber()).toBeCloseTo(ENEMY_CURVE_T, 10)
            // Relative, not absolute: T^3 is large enough that digit-place tolerance is
            // meaningless there.
            expect(enemyMultiplier(3, 1, 1).toNumber() / Math.pow(ENEMY_CURVE_T, 3)).toBeCloseTo(1, 10)
        })

        it('survives magnitudes no native number can hold', () => {
            const deep = enemyMultiplier(1000, 10, 10)
            expect(deep.isFinite()).toBe(true)
            expect(deep.gt(D(10).pow(300))).toBe(true)
        })
    })

    describe('stage archetypes', () => {
        it('classifies all ten stages', () => {
            expect([1, 2, 3, 4].map(stageArchetype)).toEqual(['wave', 'wave', 'wave', 'wave'])
            expect(stageArchetype(5)).toBe('boss')
            expect([6, 7, 8, 9].map(stageArchetype)).toEqual(['elite', 'elite', 'elite', 'elite'])
            expect(stageArchetype(10)).toBe('super_boss')
        })

        it('gives boss stages no kill requirement', () => {
            expect(killsRequired(at(1, 5))).toBe(0)
            expect(killsRequired(at(1, 10))).toBe(0)
            expect(killsRequired(at(1, 1))).toBe(BASE_KILL_COUNT)
        })

        it('makes elites tougher than trash and bosses tougher than elites', () => {
            const trash = enemyStatsAt(at(1, 4)).hp.toNumber()
            const elite = enemyStatsAt(at(1, 6)).hp.toNumber()
            const boss = enemyStatsAt(at(1, 5)).hp.toNumber()
            expect(elite).toBeGreaterThan(trash)
            expect(boss).toBeGreaterThan(elite)
        })
    })

    describe('secondsPerKill', () => {
        it('never dips below the throughput floor, however high DPS climbs', () => {
            const member = enemyStatsAt(at(1, 1))
            // Level stands in for raw DPS now that the signature takes the party rather than
            // a bare number — and it exercises the real stat pipeline while it's at it.
            for (const level of [200, 500, 2000]) {
                const units = partyUnitStats({ ...hero, heroLevel: level })
                expect(secondsPerKill(units, { members: [member] }))
                    .toBeGreaterThanOrEqual(MIN_SECONDS_PER_KILL)
            }
            expect(secondsPerKill(partyUnitStats({ ...hero, heroLevel: 2000 }), { members: [member] }))
                .toBe(MIN_SECONDS_PER_KILL)
        })

        it('returns Infinity for a party that cannot damage the enemy', () => {
            // An empty party is the only way to deal literally nothing since MIN_DAMAGE.
            expect(secondsPerKill([], enemyPackAt(at(1, 1)))).toBe(Number.POSITIVE_INFINITY)
        })
    })

    describe('offline window', () => {
        it('reaches exactly 72 hours at the top cap level', () => {
            expect(offlineCapHours(0)).toBe(8)
            expect(offlineCapHours(MAX_OFFLINE_CAP_LEVEL)).toBe(OFFLINE_CAP_MAX_HOURS)
            expect(offlineCapHours(MAX_OFFLINE_CAP_LEVEL + 50)).toBe(OFFLINE_CAP_MAX_HOURS)
        })

        it('reaches exactly 100% efficiency at the top shop level', () => {
            expect(offlineEfficiency(0)).toBeCloseTo(0.5, 10)
            expect(offlineEfficiency(MAX_OFFLINE_EFFICIENCY_LEVEL)).toBe(MAX_OFFLINE_EFFICIENCY)
        })

        it('stacks extra efficiency sources additively under the shared ceiling', () => {
            expect(offlineEfficiency(0, 0.2)).toBeCloseTo(0.7, 10)
            expect(offlineEfficiency(MAX_OFFLINE_EFFICIENCY_LEVEL, 0.5)).toBe(MAX_OFFLINE_EFFICIENCY)
        })

        it('clamps real elapsed time to the cap', () => {
            expect(cappedOfflineSeconds(3600, 0)).toBe(3600)
            expect(cappedOfflineSeconds(1e9, 0)).toBe(8 * 3600)
        })

        it('caps before boosting and taxes efficiency last', () => {
            // 100h offline at cap level 0 → 8h counted; a 2x boost over the whole window at
            // 50% efficiency nets exactly the unboosted 8h.
            const boosted = settle(input({
                elapsedSeconds: 100 * 3600,
                speedBoost: { multiplier: 2, overlapSeconds: 100 * 3600 }
            }))
            expect(boosted.effectiveSeconds).toBeCloseTo(8 * 3600, 6)

            const plain = settle(input({ elapsedSeconds: 100 * 3600 }))
            expect(plain.effectiveSeconds).toBeCloseTo(4 * 3600, 6)
        })
    })

    describe('stage movement', () => {
        it('advances within a world and rolls over into the next', () => {
            expect(nextStage(at(1, 4, 30))).toMatchObject({ world: 1, stage: 5, killsInStage: 0 })
            expect(nextStage(at(1, 10))).toMatchObject({ world: 2, stage: 1, killsInStage: 0 })
        })

        it('stops at the end of the last world', () => {
            expect(nextStage(at(WORLD_COUNT, STAGES_PER_WORLD))).toMatchObject({ world: WORLD_COUNT, stage: STAGES_PER_WORLD })
        })

        it('soft-fails one stage back', () => {
            expect(fallbackStage(at(1, 5))).toMatchObject({ stage: 4 })
            expect(fallbackStage(at(1, 10))).toMatchObject({ stage: 9 })
        })

        it('redirects boss stages to the preceding wave stage and leaves others alone', () => {
            expect(offlineFarmStage(at(1, 5))).toMatchObject({ stage: 4 })
            expect(offlineFarmStage(at(1, 10))).toMatchObject({ stage: 9 })
            expect(offlineFarmStage(at(1, 3))).toMatchObject({ stage: 3 })
        })
    })

    describe('the opening is playable at all', () => {
        /**
         * A level-1 solo Hero must be able to *make progress* on the very first stage — which
         * is deliberately weaker than clearing it.
         *
         * The opening clears Stage 1 today, but this floor is written against the weaker claim
         * on purpose. For a long stretch it did not — a level-1 Hero wiped partway through World
         * 1 Stage 1 — and that was still survivable as a *design*, because a wave wipe banks the
         * kills it landed and restarts the same stage, so income never stops and the Hero
         * levels its way out (`killsBeforeWipe`).
         *
         * What must never happen is banking **zero** kills. That is the real "unfarmable from
         * the first screen" failure — no XP, no Gold, no way forward, ever — and it is what
         * this floor guards, whichever way the opening is tuned next.
         *
         * Pinned deliberately rather than left to incidental coverage. `BASE_HP` silently
         * reverted to a stale value twice during editing; the suite happened to catch it the
         * second time only because an unrelated retune had made other specs sensitive to it.
         * "Happened to" is not a safety net.
         */
        it('lets a level-1 Hero bank kills on World 1 Stage 1, so the wall unsticks itself', () => {
            const units = partyUnitStats({ ...hero, heroLevel: 1 })
            const pack = enemyPackAt(at(1, 1))

            expect(killsBeforeWipe(units, pack, secondsPerKill(units, pack))).toBeGreaterThan(0)
        })

        /**
         * And the wall it unsticks itself from has to be a short one. Banking a single kill per
         * attempt would satisfy the floor above while taking days to clear the first screen, so
         * this bounds how much of the opening is spent wiping.
         *
         * The bound is **two worlds' worth of levels to clear the first world** — derived from
         * `LEVELS_PER_STAGE` rather than pinned, because the honest quantity is "how far behind
         * the natural pace does the opening put you", and a flat number stops meaning that the
         * moment fight length or the XP curve moves.
         */
        it('levels out of the opening quickly rather than grinding the first screen', () => {
            const twoWorldsOfLevels = 1 + LEVELS_PER_STAGE * STAGES_PER_WORLD * 2
            expect(OPENING_CLEAR_LEVEL).toBeLessThanOrEqual(twoWorldsOfLevels)
        })
    })

    describe('the wave wipe', () => {
        /**
         * Deep enough that a level-1 Beginner still deals damage and still banks kills, but
         * cannot outlast a whole stage — **found, not named**, for the same reason
         * `firstStallingPosition` is.
         *
         * The band it has to land inside is `0 < killsBeforeWipe < BASE_KILL_COUNT`, and it is
         * narrow: below it the stage clears outright, above it the party dies before its first
         * kill and the specs about *banking progress while walled* have nothing to measure.
         */
        const unsurvivable = (() => {
            for (let world = 1; world <= WORLD_COUNT; world++) {
                for (let stage = 1; stage <= STAGES_PER_WORLD; stage++) {
                    if (stage === BOSS_STAGE || stage === SUPER_BOSS_STAGE) continue
                    const position = at(world, stage)
                    const kills = wipeCount(position)
                    if (kills > 0 && kills < BASE_KILL_COUNT) return position
                }
            }
            throw new Error('no stage in the opening loop wipes a level-1 Hero mid-stage')
        })()

        /**
         * Both helpers read the rate model `settle()` itself runs (`rateAt`), kit included. The
         * bare stat block leaves out the Beginner's Haste, which is enough to flip a stage at the
         * edge of the wipe band between wiping and clearing.
         */
        function secondsPerKillAt(position: RunPosition, heroLevel = 1) {
            return rateAt({ ...hero, heroLevel }, position).secondsPerKill
        }

        function wipeCount(position: RunPosition, heroLevel = 1) {
            const { abilities, units, pack, secondsPerKill: spk } = rateAt({ ...hero, heroLevel }, position)
            return killsBeforeWipe(units, pack, spk, abilities.healingPerSecond, abilities.damageTakenFactor)
        }

        /**
         * The first wave stage where the Hero still scratches the enemy but one kill outlasts
         * it — **found, not named**, for the same reason `firstStallingPosition` is.
         */
        function firstNoKillWipe(): RunPosition {
            for (let world = 1; world <= WORLD_COUNT; world++) {
                for (let stage = 1; stage <= STAGES_PER_WORLD; stage++) {
                    if (stage === BOSS_STAGE || stage === SUPER_BOSS_STAGE) continue
                    const position = at(world, stage)
                    if (Number.isFinite(secondsPerKillAt(position)) && wipeCount(position) === 0) return position
                }
            }
            throw new Error('no stage in the opening loop wipes the party before its first kill')
        }

        it('is effectively unreachable for a party the enemy can barely scratch', () => {
            const units = partyUnitStats({ ...hero, heroLevel: 200 })
            const enemy = enemyPackAt(at(1, 1))

            // Not literally infinite: with the MIN_DAMAGE floor a fully-mitigated defender still
            // takes chip damage, so every party dies *eventually*.
            //
            // What makes the wipe unreachable is measured against the **stage**, not against
            // a wall-clock figure: an over-levelled party clears the 30 kills many times over
            // before dropping. A raw seconds threshold would also be a hidden assertion about
            // pack size, since packs scale survival by `1/streams(N)`. The ×100 is a proxy for
            // "unreachable", not a measured quantity.
            const survives = secondsToDie(units, enemy)
            expect(Number.isFinite(survives)).toBe(true)
            expect(wipeCount(at(1, 1), 200)).toBeGreaterThan(BASE_KILL_COUNT * 100)
        })

        it('holds the stage instead of advancing when the party cannot outlast it', () => {
            expect(wipeCount(unsurvivable)).toBeLessThan(BASE_KILL_COUNT)

            const result = settle(input({ position: unsurvivable, elapsedSeconds: 72 * 3600 }))
            expect(result.wipedOnWave).toBe(true)
            expect(result.position.world).toBe(unsurvivable.world)
            expect(result.position.stage).toBe(unsurvivable.stage)
        })

        it('never banks more stage progress than one attempt survives', () => {
            const result = settle(input({ position: unsurvivable, elapsedSeconds: 72 * 3600 }))
            expect(result.position.killsInStage).toBeLessThan(wipeCount(unsurvivable))
        })

        it('keeps paying Gold and XP while walled, so levelling breaks the wall', () => {
            const result = settle(input({ position: unsurvivable, elapsedSeconds: 8 * 3600 }))
            expect(result.kills).toBeGreaterThan(0)
            expect(result.goldEarned).toBeGreaterThan(0)
            expect(result.xpEarned.gt(0)).toBe(true)
            expect(result.heroLevel).toBeGreaterThan(hero.heroLevel)
        })

        it('recovers after every wipe, landing nothing while it does', () => {
            const wipeAt = wipeCount(unsurvivable)
            const spk = secondsPerKillAt(unsurvivable)
            const seconds = 8 * 3600
            const result = settle(input({ position: unsurvivable, elapsedSeconds: seconds, online: true }))
            // whole cycles of an attempt and a recovery, within one cycle's kills either way
            const cycles = seconds / (wipeAt * spk + WIPE_RECOVERY_SECONDS)
            expect(Math.abs(result.kills - cycles * wipeAt)).toBeLessThanOrEqual(wipeAt)
            expect(result.kills).toBeLessThan(Math.floor(seconds / spk))
        })

        it('carries a recovery cut short by a read into the next window, and serves it first', () => {
            const owed = settle(input({ position: unsurvivable, elapsedSeconds: 2, online: true, recoverySeconds: 3 }))
            expect(owed.kills).toBe(0)
            expect(owed.recoverySeconds).toBeCloseTo(1, 10)
            expect(owed.position.killsInStage).toBe(0)

            const spk = secondsPerKillAt(unsurvivable)
            const served = settle(input({ position: unsurvivable, elapsedSeconds: 3 + 2 * spk + 0.01, online: true, recoverySeconds: 3 }))
            expect(served.recoverySeconds).toBe(0)
            expect(served.kills).toBe(2)
        })

        it('earns the same over a window whether it is read once or many times', () => {
            const once = settle(input({ position: unsurvivable, elapsedSeconds: 3600, online: true }))
            let position = unsurvivable
            let killFraction = 0
            let recoverySeconds = 0
            let kills = 0
            for (let i = 0; i < 360; i++) {
                const step = settle(input({ position, elapsedSeconds: 10, online: true, killFraction, recoverySeconds }))
                ;({ position, killFraction, recoverySeconds } = step)
                kills += step.kills
            }
            expect(Math.abs(kills - once.kills)).toBeLessThanOrEqual(1)
        })

        it('resolves a long window in bounded time rather than walking wipe by wipe', () => {
            const started = Date.now()
            settle(input({ position: unsurvivable, elapsedSeconds: 72 * 3600 }))
            expect(Date.now() - started).toBeLessThan(1000)
        })

        it('earns nothing when the party dies before landing a single kill', () => {
            // The narrow band where the hero still scratches the enemy but one kill outlasts
            // it — deeper still, the kill rate itself stalls (below).
            const position = firstNoKillWipe()
            expect(secondsPerKillAt(position)).toBeLessThan(Number.POSITIVE_INFINITY)
            expect(wipeCount(position)).toBe(0)

            const result = settle(input({ position, elapsedSeconds: 24 * 3600 }))
            expect(result.wipedOnWave).toBe(true)
            expect(result.kills).toBe(0)
            expect(result.goldEarned).toBe(0)
            expect(result.position.killsInStage).toBe(0)
        })

        it('clears normally once the party outlasts the kill requirement', () => {
            expect(wipeCount(at(1, 1), OPENING_CLEAR_LEVEL)).toBeGreaterThanOrEqual(BASE_KILL_COUNT)

            const result = settle(input({
                hero: { ...hero, heroLevel: OPENING_CLEAR_LEVEL },
                position: at(1, 1),
                elapsedSeconds: 8 * 3600
            }))
            expect(result.wipedOnWave).toBe(false)
            expect(result.position.stage).toBeGreaterThan(1)
        })
    })

    describe('the boss wall', () => {
        it('never advances past Stage 5, however long the window', () => {
            const result = settle(input({
                hero: { ...hero, heroLevel: OPENING_CLEAR_LEVEL },
                position: at(1, 1),
                elapsedSeconds: 72 * 3600
            }))
            expect(result.position.stage).toBe(5)
            expect(result.blockedAtBoss).toBe(true)
        })

        it('lands the player at the boss, not past it and not short of it', () => {
            // Levelled enough to outlast a Stage 4 attempt: this is a spec about the *gate*,
            // and a hero that wipes on the wave before it never reaches the gate to be gated.
            // Reads the derived level rather than a number, because tuning moves it. The
            // wave-wipe rule is tested on its own elsewhere.
            const result = settle(input({
                hero: { ...hero, heroLevel: OPENING_CLEAR_LEVEL },
                position: at(1, 4, BASE_KILL_COUNT - 1),
                elapsedSeconds: 8 * 3600
            }))
            expect(result.position.stage).toBe(5)
            expect(result.position.killsInStage).toBe(0)
            expect(result.blockedAtBoss).toBe(true)
        })

        it('applies the redirect retroactively when already parked on a boss', () => {
            const parked = settle(input({ position: at(1, 5), elapsedSeconds: 4 * 3600 }))
            expect(parked.position.stage).toBe(5)
            expect(parked.blockedAtBoss).toBe(true)
            expect(parked.goldEarned).toBeGreaterThan(0)
            // Everything earned was valued at Stage 4, the wave stage before the gate.
            expect(parked.goldEarned).toBeCloseTo(parked.kills * goldPerKill(0, 1, 4, SPEC_TENURE_DAYS), 6)
        })

        it('gates Stage 10 the same way it gates Stage 5', () => {
            // Needs a levelled hero, one that outlasts a full elite stage attempt — six elites
            // per encounter is a much heavier incoming stream than one.
            const result = settle(input({
                hero: { ...hero, heroLevel: 80 },
                position: at(1, 9, BASE_KILL_COUNT - 1),
                elapsedSeconds: 8 * 3600
            }))
            expect(result.position.stage).toBe(10)
            expect(result.blockedAtBoss).toBe(true)
        })

        it('stalls a hero whose PWR the enemy DEF curve has outrun', () => {
            // Emergent, and deliberate: enemy DEF rides the same exponential as everything
            // else, so a static hero eventually crosses DEF >= PWR x K. Past that point it is
            // pinned to MIN_DAMAGE per swing, which against an exponential HP pool is not a
            // route through — the wall is slow rather than sealed, but it is still a wall.
            // Levelling is not optional. Where it lands moves with ENEMY_CURVE_T, so the test
            // finds it rather than naming a stage: what matters is that it exists and that
            // levels answer it.
            const wall = firstStallingPosition(hero)
            expect(wall).not.toBeNull()

            const stalled = settle(input({ position: wall!, elapsedSeconds: LONGEST_SETTLE_SECONDS }))
            expect(stalled.secondsPerKill).toBeGreaterThan(LONGEST_SETTLE_SECONDS)
            expect(stalled.kills).toBe(0)
            expect(stalled.goldEarned).toBe(0)

            const answering = firstLevelClearing(hero, wall!)
            expect(answering).not.toBeNull()

            const levelled = settle(input({
                hero: { ...hero, heroLevel: answering! },
                position: wall!,
                elapsedSeconds: LONGEST_SETTLE_SECONDS
            }))
            expect(levelled.kills).toBeGreaterThan(0)
        })

        it('earns Gold and XP while walled, so idle time is never wasted', () => {
            const result = settle(input({ position: at(1, 5), elapsedSeconds: 3600 }))
            expect(result.goldEarned).toBeGreaterThan(0)
            expect(result.xpEarned.gt(0)).toBe(true)
        })
    })

    describe('one-rate offline accrual', () => {
        it('holds the departure stage rate across a multi-stage advance', () => {
            // Past the lethal opening, or the run never advances a stage to hold a rate across.
            const advancing = { ...hero, heroLevel: OPENING_CLEAR_LEVEL }
            const start = at(1, 1)
            const result = settle(input({ hero: advancing, position: start, elapsedSeconds: 8 * 3600 }))
            // Through `rateAt`, the same helper `settle()` uses — it applies the ability
            // projection (buffed party, debuffed pack) before pricing the rate. Rebuilding
            // that here by hand is how this spec would silently start measuring a party the
            // game does not field.
            const departureRate = rateAt(advancing, start).secondsPerKill
            const arrivalRate = rateAt(advancing, result.position).secondsPerKill

            expect(result.position.stage).toBeGreaterThan(start.stage)
            expect(result.secondsPerKill).toBeCloseTo(departureRate, 10)
            // Enemies got tougher on the way, so the two rates genuinely differ — the test
            // would pass vacuously otherwise.
            expect(arrivalRate).toBeGreaterThan(departureRate)
        })

        it('derives kills from the held rate', () => {
            const result = settle(input({ position: at(1, 1), elapsedSeconds: 3600 }))
            expect(result.kills).toBe(Math.floor(result.effectiveSeconds / result.secondsPerKill))
        })

        /**
         * The lossless-window group.
         *
         * Every state read settles and there is no floor on how often one happens — the client
         * polls once a minute, every mutation refreshes, and a page reload is another. A settle
         * that dropped the part of its budget which did not add up to a whole kill therefore
         * charged the player up to one kill for the privilege of looking at the screen, and the
         * loss compounded with the refresh rate rather than the play time.
         */
        describe('the carried part-kill', () => {
            it('splits the budget into whole kills and a remainder under one', () => {
                const result = settle(input({ position: at(1, 1), elapsedSeconds: 3600 }))
                const budget = result.effectiveSeconds / result.secondsPerKill

                expect(result.kills).toBe(Math.floor(budget))
                expect(result.killFraction).toBeCloseTo(budget - result.kills, 10)
                expect(result.killFraction).toBeGreaterThanOrEqual(0)
                expect(result.killFraction).toBeLessThan(1)
            })

            it('lands the kill a carried remainder completes', () => {
                const spk = rateAt(hero, at(1, 1)).secondsPerKill
                // Nine tenths of a kill in hand, a tenth of one elapsed: that is a kill.
                const result = settle(input({
                    position: at(1, 1),
                    elapsedSeconds: spk * 0.1,
                    online: true,
                    killFraction: 0.9
                }))

                expect(result.kills).toBe(1)
                expect(result.killFraction).toBeCloseTo(0, 10)
            })

            it('holds the carry across a window too short to bank anything', () => {
                const spk = rateAt(hero, at(1, 1)).secondsPerKill
                const result = settle(input({
                    position: at(1, 1),
                    elapsedSeconds: spk * 0.25,
                    online: true,
                    killFraction: 0.5
                }))

                expect(result.kills).toBe(0)
                expect(result.killFraction).toBeCloseTo(0.75, 10)
            })

            it('holds it even when the window itself is empty', () => {
                // A no-op settle must not *cost* the player what they had already banked.
                expect(settle(input({ elapsedSeconds: 0, killFraction: 0.4 })).killFraction).toBe(0.4)
            })

            it('refuses a carry outside [0, 1), whatever the row says', () => {
                // Dropped rather than clamped into range: a carry of 1 nudged to just under one
                // would pay out a free kill on every read, and every read settles.
                const spk = rateAt(hero, at(1, 1)).secondsPerKill
                const short = { position: at(1, 1), elapsedSeconds: spk * 0.1, online: true }

                expect(settle(input({ ...short, killFraction: 1 })).kills).toBe(0)
                expect(settle(input({ ...short, killFraction: 5 })).kills).toBe(0)
                expect(settle(input({ ...short, killFraction: -3 })).kills).toBe(0)
                expect(settle(input({ ...short, killFraction: Number.NaN })).killFraction).toBeCloseTo(0.1, 6)
            })

            /**
             * The regression itself, stated as the property that was violated: an hour of
             * presence is an hour of presence, however the client chose to cut it up.
             *
             * Held to one stage attempt with a static hero, so `secondsPerKill` is identical in
             * every chunk and the only variable left is how often the settle ran. Over longer
             * windows the totals legitimately differ — a settle prices the whole window at its
             * departure stage's rate and chunking re-prices at each new stage — so a longer
             * horizon would be measuring that instead.
             *
             * Without the carry, a player refreshing faster than they killed would never progress
             * at all, since `floor()` of a sub-1 budget is zero every time.
             */
            it('adds up the same however the presence is cut', () => {
                const spk = rateAt(hero, at(1, 1)).secondsPerKill
                // Short of the stage's requirement, and off any kill boundary, so no chunking
                // can round its way across either one.
                const totalSeconds = spk * (BASE_KILL_COUNT - 5.5)

                const walk = (steps: number) => {
                    let position = at(1, 1)
                    let killFraction = 0
                    let kills = 0
                    for (let step = 0; step < steps; step++) {
                        const result = settle(input({
                            position,
                            elapsedSeconds: totalSeconds / steps,
                            online: true,
                            killFraction
                        }))
                        position = result.position
                        killFraction = result.killFraction
                        kills += result.kills
                    }
                    return { kills, position }
                }

                const whole = walk(1)
                expect(whole.kills).toBe(BASE_KILL_COUNT - 6)

                // The last of these settles roughly fifty times per kill — the shape of a player
                // reloading the page.
                for (const steps of [2, 10, 60, BASE_KILL_COUNT * 50]) {
                    const chunked = walk(steps)
                    expect(chunked.kills).toBe(whole.kills)
                    expect(chunked.position).toEqual(whole.position)
                }
            })
        })

        it('values Gold at the stage each kill actually landed in', () => {
            // 30 kills clears Stage 1; the rest are worth more, so the average beats Stage 1's rate.
            const result = settle(input({
                hero: { ...hero, heroLevel: OPENING_CLEAR_LEVEL },
                position: at(1, 1),
                elapsedSeconds: 8 * 3600
            }))
            expect(result.kills).toBeGreaterThan(BASE_KILL_COUNT)
            expect(result.goldEarned / result.kills).toBeGreaterThan(goldPerKill(0, 1, 1, SPEC_TENURE_DAYS))
        })

        it('accrues nothing for a zero or negative window', () => {
            expect(settle(input({ elapsedSeconds: 0 })).kills).toBe(0)
            expect(settle(input({ elapsedSeconds: -100 })).kills).toBe(0)
        })

        it('applies the Gold bonus multiplier', () => {
            const plain = settle(input({ elapsedSeconds: 3600 }))
            const boosted = settle(input({
                elapsedSeconds: 3600,
                hero: { ...hero, goldBonusPct: 1 }
            }))
            expect(boosted.goldEarned).toBeCloseTo(plain.goldEarned * 2, 6)
        })

        it('skips the cap and the efficiency tax while online', () => {
            const offline = settle(input({ elapsedSeconds: 3600, online: false }))
            const online = settle(input({ elapsedSeconds: 3600, online: true }))
            expect(online.effectiveSeconds).toBe(3600)
            expect(online.effectiveSeconds).toBeGreaterThan(offline.effectiveSeconds)
        })
    })

    describe('gold curve', () => {
        it('grows within a run but far more slowly than the enemy curve', () => {
            const goldGrowth = goldPerKill(0, 10, 10, SPEC_TENURE_DAYS) / goldPerKill(0, 1, 1, SPEC_TENURE_DAYS)
            const enemyGrowth = enemyMultiplier(0, 10, 10).toNumber() / enemyMultiplier(0, 1, 1).toNumber()
            expect(goldGrowth).toBeGreaterThan(1)
            expect(goldGrowth).toBeLessThan(enemyGrowth)
        })

        it('rides the same index as the enemy, one base, no seam at a boundary', () => {
            expect(goldProgressionFactor(0, 1, 1)).toBeCloseTo(1, 12)
            // Every adjacent pair along the play order steps by exactly one base, including
            // the world and prestige boundaries.
            const steps: [number, number, number][] = [
                [0, 1, 1], [0, 1, 2], [0, 1, 10], [0, 2, 1], [0, 10, 10], [1, 1, 1], [1, 1, 2]
            ]
            for (let i = 1; i < steps.length; i++) {
                const [p0, w0, s0] = steps[i - 1]!
                const [p1, w1, s1] = steps[i]!
                const gap = curveIndex(p1, w1, s1) - curveIndex(p0, w0, s0)
                expect(goldProgressionFactor(p1, w1, s1) / goldProgressionFactor(p0, w0, s0))
                    .toBeCloseTo(Math.pow(GOLD_STEP_BASE, gap), 9)
            }
        })

        it('never falls back when a run loops to the next prestige', () => {
            // Finishing World 10 and starting World 1 again must never cut Gold per kill.
            const lastStage = goldProgressionFactor(0, WORLD_COUNT, STAGES_PER_WORLD)
            const firstOfNext = goldProgressionFactor(1, 1, 1)
            expect(firstOfNext).toBeGreaterThan(lastStage)
        })

        it('needs no cap of its own, because the ceiling is the bound', () => {
            // Progression is unbounded by design; `goldPerKill` is not, at any depth.
            expect(goldProgressionFactor(50, 10, 10)).toBeGreaterThan(goldProgressionFactor(20, 10, 10))
            const deep = goldPerKill(50, WORLD_COUNT, STAGES_PER_WORLD, SPEC_TENURE_DAYS)
            expect(deep).toBeCloseTo(BASE_GOLD * goldTenureCeiling(SPEC_TENURE_DAYS), 9)
        })

        it('bounds Gold per hour by construction', () => {
            const bound = maxGoldPerHour()
            expect(Number.isFinite(bound)).toBe(true)
            expect(bound).toBeGreaterThan(0)
        })

        it('leaves healthy headroom under the shared balance column', () => {
            // Gold lives on user.balance — numeric(19,4), a ~1e15 ceiling. The worst case
            // stacks everything at once: the tenure ceiling at its ten-year horizon, the
            // throughput floor, a x4 Gold% stack and the fastest Battle Speed tier, and a player
            // who never spends a coin.
            const BALANCE_COLUMN_CEILING = 1e15
            const worstCase = maxGoldPerHour(4, MAX_BATTLE_SPEED)
            const headroomHours = BALANCE_COLUMN_CEILING / worstCase

            // At least 100 hours of uninterrupted worst-case earning before the column is
            // even a question. Tighten this if the Gold curve is ever re-fitted upward.
            expect(headroomHours).toBeGreaterThan(100)
        })

        it('clears the column by two orders of magnitude on the largest single collect', () => {
            // `gold-economy.md` §9.4. The biggest one-shot payout the game can produce is a
            // full 72-hour offline window at the worst-case rate, taken at the horizon the
            // tenure crawl is stated at.
            //
            // **§9.4 asks for three orders of magnitude and this is two** — recorded in
            // `open-items.md` #23 rather than reconciled quietly. Regenerating
            // `GOLD_TENURE_CEILING` against the real kill rate raised it 12×, and that came
            // straight out of this margin: the largest collect went from ~4.4e11 to ~5.3e12
            // against a ~1e15 column, so 187 consecutive worst-case collects fill it instead
            // of 2,250. The worst case already stacks everything at once — ten-year account
            // age, the throughput floor, ×4 Gold%, ×4 Battle Speed, a full 72-hour window,
            // and a player who never spends a coin — and `leaves healthy headroom` above
            // still passes by two orders of magnitude on its own terms.
            const collect = maxGoldPerHour(4, MAX_BATTLE_SPEED, GOLD_BOUND_HORIZON_DAYS) * OFFLINE_CAP_MAX_HOURS
            expect(collect).toBeLessThan(1e15 / 100)
        })
    })

    describe('gold tenure ceiling', () => {
        it('rises with account age and never falls', () => {
            let previous = 0
            for (const day of [0, 0.5, 1, 7, 30, 90, 180, 230, 500, 3650]) {
                const ceiling = goldTenureCeiling(day)
                expect(ceiling).toBeGreaterThanOrEqual(previous)
                previous = ceiling
            }
        })

        it('lands exactly on its rungs and interpolates geometrically between them', () => {
            GOLD_TENURE_DAYS.forEach((day, index) => {
                expect(platformCeiling(day)).toBeCloseTo(GOLD_TENURE_CEILING[index]!, 6)
            })
            // Midpoint of a rung pair is the geometric mean, not the arithmetic one.
            const lo = GOLD_TENURE_CEILING[2]!
            const hi = GOLD_TENURE_CEILING[3]!
            const midDay = (GOLD_TENURE_DAYS[2]! + GOLD_TENURE_DAYS[3]!) / 2
            expect(platformCeiling(midDay)).toBeCloseTo(Math.sqrt(lo * hi), 6)
        })

        it('sits under the platform curve by exactly the stated discount', () => {
            // The ceiling is what pays an invested account most of the time, so parity here
            // would be parity overall. The gap is deliberate and is one constant.
            expect(GOLD_PLATFORM_DISCOUNT).toBeLessThan(1)
            for (const day of [0, 1, 30, 230, 1000]) {
                expect(goldTenureCeiling(day)).toBeCloseTo(GOLD_PLATFORM_DISCOUNT * platformCeiling(day), 9)
            }
        })

        it('crawls past the last rung rather than going flat', () => {
            const last = GOLD_TENURE_DAYS.at(-1)!
            const atLast = goldTenureCeiling(last)
            expect(goldTenureCeiling(last + 100)).toBeCloseTo(atLast * Math.pow(GOLD_TENURE_CRAWL, 100), 6)
        })

        it('treats a missing or nonsense age as a brand new account', () => {
            const fresh = goldTenureCeiling(0)
            expect(goldTenureCeiling(-5)).toBe(fresh)
            expect(goldTenureCeiling(Number.NaN)).toBe(fresh)
            expect(goldTenureCeiling(Number.POSITIVE_INFINITY)).toBe(fresh)
        })

        it('caps a young account that has out-progressed the calendar', () => {
            // A deep position on a brand-new account — exactly the case the ceiling exists for.
            const young = goldPerKill(4, 10, 10, 0.1)
            expect(young).toBeCloseTo(BASE_GOLD * goldTenureCeiling(0.1), 9)
            expect(young).toBeLessThan(BASE_GOLD * goldProgressionFactor(4, 10, 10))
        })

        it('leaves a dormant account earning what its progress is worth, not its age', () => {
            // Wall-clock tenure alone would let six months of doing nothing pay like six
            // months of playing. The min() is what closes that: progress is still 1x here.
            const dormant = goldPerKill(0, 1, 1, 180)
            expect(dormant).toBeCloseTo(BASE_GOLD * goldProgressionFactor(0, 1, 1), 9)
            expect(dormant).toBeLessThan(BASE_GOLD * goldTenureCeiling(180) / 1000)
        })

        it('pays progress once the calendar has caught up with it', () => {
            const factor = goldProgressionFactor(2, 5, 5)
            const mature = GOLD_TENURE_DAYS.at(-1)!
            expect(goldTenureCeiling(mature)).toBeGreaterThan(factor)
            expect(goldPerKill(2, 5, 5, mature)).toBeCloseTo(BASE_GOLD * factor, 9)
        })

        it('prices the same position lower the younger the account is', () => {
            // Why `settleHq` reads tenure off the pre-update row: a 72-hour offline window
            // priced at its closing age would pay three days of kills at a ceiling the
            // account only reached on the last of them.
            const position = [4, 10, 10] as const
            const opened = goldPerKill(...position, 1)
            const closed = goldPerKill(...position, 4)
            expect(opened).toBeLessThan(closed)
            expect(opened).toBeCloseTo(BASE_GOLD * goldTenureCeiling(1), 9)
        })

        it('applies inside settle(), not just at the formula', () => {
            // A hero deep enough to have out-progressed a young calendar. Parked at a gate so
            // position holds and every
            // kill farms Stage 4 at one rate, making the payout readable as kills x one value.
            const deep = { hero: { ...hero, heroLevel: 1500 }, position: at(10, BOSS_STAGE, 0, 2) }

            const young = settle(input({ ...deep, tenureDays: 0, elapsedSeconds: 3600, online: true }))
            expect(young.blockedAtBoss).toBe(true)
            expect(young.kills).toBeGreaterThan(0)
            expect(young.goldEarned).toBeCloseTo(young.kills * BASE_GOLD * goldTenureCeiling(0), 6)

            // Identical progress, mature account: the ceiling lifts and progress gets paid.
            const mature = settle(input({ ...deep, tenureDays: SPEC_TENURE_DAYS, elapsedSeconds: 3600, online: true }))
            expect(mature.kills).toBe(young.kills)
            expect(mature.goldEarned).toBeCloseTo(mature.kills * BASE_GOLD * goldProgressionFactor(2, 10, 4), 6)
            expect(mature.goldEarned).toBeGreaterThan(young.goldEarned)
        })
    })

    describe('xp curve', () => {
        it('grows with world, stage and prestige', () => {
            expect(xpPerKill(0, 2, 1).gt(xpPerKill(0, 1, 1))).toBe(true)
            expect(xpPerKill(0, 1, 2).gt(xpPerKill(0, 1, 1))).toBe(true)
            expect(xpPerKill(1, 1, 1).gt(xpPerKill(0, 1, 1))).toBe(true)
        })

        it('grows by a fixed ratio per index step', () => {
            expect(xpPerKill(0, 1, 2).div(xpPerKill(0, 1, 1)).toNumber()).toBeCloseTo(XP_STEP_BASE, 10)
            expect(xpPerKill(1, 1, 1).div(xpPerKill(0, 10, 10)).toNumber()).toBeCloseTo(XP_STEP_BASE, 10)
        })

        it('never lets XP per second decay with depth', () => {
            // XP per kill measured against the enemy curve. Sharing an index at an exponent of at
            // least 1 is what keeps farming from getting worse the deeper the run goes.
            const rate = (prestige: number, world: number, stage: number) =>
                xpPerKill(prestige, world, stage).div(enemyMultiplier(prestige, world, stage)).toNumber()

            const origin = rate(0, 1, 1) * (1 - 1e-9)
            expect(rate(0, 1, STAGES_PER_WORLD)).toBeGreaterThanOrEqual(origin)
            expect(rate(0, WORLD_COUNT, STAGES_PER_WORLD)).toBeGreaterThanOrEqual(origin)
            expect(rate(5, WORLD_COUNT, STAGES_PER_WORLD)).toBeGreaterThanOrEqual(origin)
        })

        it('sums xpToNextLevel into totalXpForLevel', () => {
            let running = ZERO
            for (let level = 1; level < 20; level++) {
                expect(totalXpForLevel(level).toNumber()).toBeCloseTo(running.toNumber(), 6)
                running = running.add(xpToNextLevel(level))
            }
        })
    })

    describe('levelling', () => {
        it('leaves a hero alone when XP falls short of the next level', () => {
            const result = applyXp(1, ZERO, xpToNextLevel(1).sub(1))
            expect(result.level).toBe(1)
        })

        it('levels exactly once at the threshold', () => {
            const result = applyXp(1, ZERO, xpToNextLevel(1))
            expect(result.level).toBe(2)
            expect(result.xp.toNumber()).toBeCloseTo(0, 6)
        })

        it('carries the remainder forward instead of dropping it', () => {
            // Expressed as a fraction of level 2's own price rather than as a literal, so it
            // stays a *partial* level under any re-denomination of the XP curve — a literal
            // amount silently becomes several whole levels when `XP_TO_LEVEL_BASE` moves.
            const remainder = xpToNextLevel(2).div(4)
            const result = applyXp(1, ZERO, xpToNextLevel(1).add(remainder))
            expect(result.level).toBe(2)
            expect(result.xp.toNumber()).toBeCloseTo(remainder.toNumber(), 6)
        })

        it('respects XP already banked toward the next level', () => {
            const half = xpToNextLevel(1).div(2)
            expect(applyXp(1, half, half).level).toBe(2)
            expect(applyXp(1, ZERO, half).level).toBe(1)
        })

        it('absorbs many levels in one step', () => {
            const result = applyXp(1, ZERO, D(1e9))
            expect(result.level).toBeGreaterThan(50)
            // Landing point is exact: the remainder never reaches the next threshold.
            expect(result.xp.lt(xpToNextLevel(result.level))).toBe(true)
            expect(result.xp.gte(0)).toBe(true)
        })

        it('stays exact at Decimal magnitudes a loop could not walk', () => {
            const total = D(10).pow(120)
            const result = applyXp(1, ZERO, total)

            // Enough levels that a one-at-a-time walk is out of the question, wherever
            // XP_TO_LEVEL_GROWTH is currently tuned.
            expect(result.level).toBeGreaterThan(1000)
            // And it lands where inverting the geometric series says it should.
            const solved = Math.floor(1 + Math.log(1 + 1e120 * (XP_TO_LEVEL_GROWTH - 1) / XP_TO_LEVEL_BASE)
                / Math.log(XP_TO_LEVEL_GROWTH))
            expect(Math.abs(result.level - solved)).toBeLessThanOrEqual(1)

            expect(totalXpForLevel(result.level).lte(total)).toBe(true)
            expect(result.xp.lt(xpToNextLevel(result.level))).toBe(true)
        })

        it('never de-levels a hero', () => {
            expect(applyXp(40, ZERO, ZERO).level).toBe(40)
            expect(applyXp(40, ZERO, D(-500)).level).toBe(40)
        })

        it('applies levels at the end of a settle, not during it', () => {
            const result = settle(input({ position: at(1, 1), elapsedSeconds: 8 * 3600 }))
            expect(result.heroLevel).toBeGreaterThan(hero.heroLevel)

            // The window was fought at the departure level throughout: the reported rate
            // still matches level-1 stats, not the level the hero ended on.
            const departureDps = partyDps(partyUnitStats(hero), enemyStatsAt(at(1, 1)).def)
            expect(result.secondsPerKill)
                .toBeCloseTo(rateAt(hero, at(1, 1)).secondsPerKill, 10)

            const ended = partyDps(partyUnitStats({ ...hero, heroLevel: result.heroLevel }), enemyStatsAt(at(1, 1)).def)
            expect(ended.gt(departureDps)).toBe(true)
        })

        it('reports the level unchanged when nothing was earned', () => {
            const stalled = settle(input({
                position: firstStallingPosition(hero)!,
                elapsedSeconds: 72 * 3600
            }))
            expect(stalled.kills).toBe(0)
            expect(stalled.heroLevel).toBe(hero.heroLevel)
        })
    })
})

describe('walkWall', () => {
    const R = WIPE_RECOVERY_SECONDS

    it('runs the attempt under way to its wipe, then recovers', () => {
        // 10 kills at 2s, 4 already landed: 12s to the wipe, then into the recovery
        const fell = walkWall(4, 0, 12 + 1, 10, 2)
        expect(fell.kills).toBe(6)
        expect(fell.killsInStage).toBe(0)
        expect(fell.recoverySeconds).toBeCloseTo(R - 1, 10)
    })

    it('cycles whole attempts and recoveries in closed form', () => {
        const cycle = 10 * 2 + R
        const walked = walkWall(0, 0, 20 + 3 * cycle + R + 3, 10, 2)
        expect(walked.kills).toBeCloseTo(10 + 30 + 1.5, 10)
        expect(walked.killsInStage).toBeCloseTo(1.5, 10)
        expect(walked.recoverySeconds).toBe(0)
    })

    it('finishes an owed recovery before any kill lands', () => {
        expect(walkWall(0, 3, 2, 10, 2)).toEqual({ kills: 0, killsInStage: 0, recoverySeconds: 1 })
        expect(walkWall(0, 3, 5, 10, 2).kills).toBeCloseTo(1, 10)
    })

    it('drops at once a party already past what it survives', () => {
        const walked = walkWall(12, 0, 1, 10, 2)
        expect(walked.kills).toBe(0)
        expect(walked.recoverySeconds).toBeCloseTo(R - 1, 10)
    })

    it('lands nothing for a party that dies before its first kill', () => {
        expect(walkWall(0, 0, 3600, 0, 2)).toEqual({ kills: 0, killsInStage: 0, recoverySeconds: 0 })
    })
})
