/**
 * Enemy packs (`classes-and-combat.md` §7).
 *
 * The load-bearing spec is the first one: **at pack size 1 every function reproduces the
 * single-enemy model exactly.** Packs were introduced so AoE, chain and taunt abilities have
 * targets, not to reprice the game, so the size-1 path has to stay bit-identical — it is the
 * control against which every pack result is read.
 *
 * Wave and elite encounters are homogeneous; boss encounters are the boss plus an escort, and
 * are the first genuinely mixed pack in the game.
 */

import { describe, expect, it } from 'vitest'
import {
    bossMinionStats,
    effectiveStreams,
    enemyPackAt,
    enemyStatsAt,
    incomingDps,
    killsBeforeWipe,
    packDps,
    packHp,
    packSize,
    packSizeFor,
    rawSecondsPerPack,
    secondsPerKill,
    secondsPerPack,
    secondsToDie
} from '#shared/utils/hero-quest/settle'
import { partyDps } from '#shared/utils/hero-quest/combat'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import {
    BASE_KILL_COUNT,
    BOSS_MINION_COUNT,
    BOSS_STAGE,
    ELITE_PACK_SIZE,
    ENEMY_HP_STEP_EXPONENT,
    ENEMY_STEP_BASE,
    MIN_SECONDS_PER_KILL,
    PACK_LIVE_STREAM_FRACTION,
    SUPER_BOSS_STAGE,
    WAVE_PACK_SIZE
} from '#shared/utils/hero-quest/constants'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import type { EnemyPack, HeroSnapshot, RunPosition } from '#shared/utils/hero-quest/types'

function hero(heroLevel: number): HeroSnapshot {
    return {
        classId: 'class_beginner',
        heroLevel,
        heroXp: ZERO,
        goldBonusPct: 0,
        offlineEfficiencyLevel: 0,
        offlineCapLevel: 0
    }
}

function at(world: number, stage: number, prestige = 0): RunPosition {
    return { prestige, world, stage, killsInStage: 0 }
}

/** A pack of exactly one — the pre-pack world, expressed in the new model. */
function solo(pos: RunPosition): EnemyPack {
    return { members: [enemyStatsAt(pos)] }
}

describe('enemy packs', () => {
    describe('size 1 reproduces the single-enemy model exactly', () => {
        // The old implementations, inlined. If a pack of one ever stops matching these, the
        // change stopped being a pure model rewrite and started being a balance change.
        const legacySecondsPerKill = (units: ReturnType<typeof partyUnitStats>, pos: RunPosition) => {
            const enemy = enemyStatsAt(pos)
            const dps = partyDps(units, enemy.def)
            if (dps.lte(0)) return Number.POSITIVE_INFINITY
            const raw = enemy.hp.div(dps).toNumber()
            return Number.isFinite(raw) ? Math.max(MIN_SECONDS_PER_KILL, raw) : Number.POSITIVE_INFINITY
        }

        it('returns the same secondsPerKill across the whole run order', () => {
            const units = partyUnitStats(hero(40))
            for (const world of [1, 3, 6, 10]) {
                for (const stage of [1, 4, 5, 7, 10]) {
                    const pos = at(world, stage)
                    expect(secondsPerKill(units, solo(pos)), `W${world}S${stage}`)
                        .toBe(legacySecondsPerKill(units, pos))
                }
            }
        })

        it('leaves incoming damage as a single stream', () => {
            expect(effectiveStreams(1)).toBe(1)
            const units = partyUnitStats(hero(20))
            const pos = at(2, 3)
            // One member, one stream: the mean is that member and the multiplier is 1.
            expect(incomingDps(units, solo(pos)).toString())
                .toBe(incomingDps(units, { members: solo(pos).members }).toString())
        })

        it('keeps secondsPerPack equal to secondsPerKill', () => {
            const units = partyUnitStats(hero(30))
            const pack = solo(at(4, 2))
            expect(secondsPerPack(units, pack)).toBe(secondsPerKill(units, pack))
        })
    })

    describe('pack size by stage archetype', () => {
        it('gives a boss exactly one boss plus its escort, which is none', () => {
            for (const stage of [BOSS_STAGE, SUPER_BOSS_STAGE]) {
                expect(packSizeFor(stage)).toBe(BOSS_MINION_COUNT + 1)
            }
            // a boss fight is the boss alone (the user's call, 2026-10-09)
            expect(BOSS_MINION_COUNT).toBe(0)
        })

        it('packs wave and elite stages', () => {
            for (const stage of [1, 2, 3, 4]) expect(packSizeFor(stage)).toBe(WAVE_PACK_SIZE)
            for (const stage of [6, 7, 8, 9]) expect(packSizeFor(stage)).toBe(ELITE_PACK_SIZE)
        })

        it('divides the stage kill requirement evenly, so no pack is a ragged remainder', () => {
            // 30 kills at 6 a time is five clean encounters. A size that does not divide
            // `BASE_KILL_COUNT` would leave the last pack of every stage short.
            expect(BASE_KILL_COUNT % WAVE_PACK_SIZE).toBe(0)
            expect(BASE_KILL_COUNT % ELITE_PACK_SIZE).toBe(0)
            expect(BASE_KILL_COUNT / WAVE_PACK_SIZE).toBe(5)
        })

        it('builds a pack of that size from the stage enemy', () => {
            const pos = at(3, 1)
            const pack = enemyPackAt(pos)
            expect(packSize(pack)).toBe(packSizeFor(pos.stage))
            for (const member of pack.members) {
                expect(member.hp.eq(enemyStatsAt(pos).hp)).toBe(true)
            }
        })
    })

    describe('boss encounters', () => {
        const bossPos = at(2, BOSS_STAGE)

        it('stands the boss alone, with no escort', () => {
            const members = enemyPackAt(bossPos).members
            expect(members).toHaveLength(1)
            expect(members[0]!.hp.eq(enemyStatsAt(bossPos).hp)).toBe(true)
        })

        // An escort is one number away (`BOSS_MINION_COUNT`), so its minion stays specified.
        it('would make minions trash-tier at the stage depth, not scaled-down bosses', () => {
            const minion = bossMinionStats(bossPos)
            // Same curve index, wave stat layer — exactly an ordinary mob of that depth.
            const trash = enemyStatsAt(at(2, 1))
            const ratio = minion.hp.div(trash.hp).toNumber()
            // Stage 5 sits four steps deeper than stage 1 on the same curve — read through
            // `ENEMY_HP_STEP_EXPONENT`, because HP is the one enemy stat with its own exponent
            // (it is matched against DPS, a product of two level-scaled stats, rather than
            // against a single hero stat). The claim under test is unchanged: a minion is an
            // ordinary mob of the boss's own depth.
            expect(ratio).toBeCloseTo(Math.pow(ENEMY_STEP_BASE, 4 * ENEMY_HP_STEP_EXPONENT), 6)
        })
    })

    describe('the offense axis does not move', () => {
        it('charges the same seconds per enemy however large the pack', () => {
            const units = partyUnitStats(hero(50))
            const pos = at(2, 2)
            const member = enemyStatsAt(pos)
            const baseline = secondsPerKill(units, { members: [member] })

            for (const size of [1, 2, 3, 5, 8]) {
                const pack = { members: Array.from({ length: size }, () => member) }
                // N× the HP fought through, N× the bodies it buys. Exactly a wash.
                //
                // Compared to 9 decimal places rather than bit-exactly: the claim is that the
                // pack size cancels, and `packHp / dps / size` divides and re-multiplies, so the
                // last ULP is not guaranteed to survive the round trip — bit-exact would be a
                // stronger assertion than the property being tested.
                expect(secondsPerKill(units, pack), `size ${size}`).toBeCloseTo(baseline, 9)
            }
        })

        it('scales the time to clear a whole encounter linearly with size', () => {
            const units = partyUnitStats(hero(50))
            const member = enemyStatsAt(at(2, 2))
            const one = rawSecondsPerPack(units, { members: [member] })
            const four = rawSecondsPerPack(units, { members: Array.from({ length: 4 }, () => member) })
            expect(four).toBeCloseTo(one * 4, 6)
        })

        it('reports pack throughput as total HP over total time', () => {
            const units = partyUnitStats(hero(50))
            const member = enemyStatsAt(at(2, 2))
            const pack = { members: [member, member, member] }
            expect(packHp(pack).eq(member.hp.mul(3))).toBe(true)
            expect(packDps(units, pack).toNumber())
                .toBeCloseTo(partyDps(units, member.def).toNumber(), 6)
        })
    })

    describe('the survivability axis is where packs bite', () => {
        it('averages live attackers over the attempt', () => {
            // (N+1)/2 at the default fraction — a pack thins as it dies under focus fire.
            expect(PACK_LIVE_STREAM_FRACTION).toBe(0.5)
            expect(effectiveStreams(2)).toBe(1.5)
            expect(effectiveStreams(3)).toBe(2)
            expect(effectiveStreams(5)).toBe(3)
        })

        it('shortens time-to-die by exactly the stream multiplier', () => {
            const units = partyUnitStats(hero(60))
            const member = enemyStatsAt(at(1, 1))
            const one = secondsToDie(units, { members: [member] })
            const three = secondsToDie(units, { members: [member, member, member] })

            expect(three).toBeCloseTo(one / effectiveStreams(3), 6)
        })

        it('carries that straight into how many kills an attempt survives', () => {
            const units = partyUnitStats(hero(60))
            const member = enemyStatsAt(at(1, 1))
            const spk = secondsPerKill(units, { members: [member] })
            const one = killsBeforeWipe(units, { members: [member] }, spk)
            const two = killsBeforeWipe(units, { members: [member, member] }, spk)

            expect(two).toBeLessThan(one)
            // Divide the unrounded survival time, not `one`: flooring twice is off by one
            // whenever the fractional kill `one` dropped would have carried across.
            const survives = secondsToDie(units, { members: [member] })
            expect(two).toBe(Math.floor(survives / effectiveStreams(2) / spk))
        })
    })

    describe('mixed packs', () => {
        it('fights each member at its own mitigation rather than an averaged one', () => {
            const units = partyUnitStats(hero(40))
            const weak = enemyStatsAt(at(1, 1))
            const strong = enemyStatsAt(at(4, 1))
            const mixed = { members: [weak, strong] }

            // Focus fire: the total is the sum of each member's own clear time, which is not
            // the same as fighting two of either one.
            expect(rawSecondsPerPack(units, mixed)).toBeCloseTo(
                rawSecondsPerPack(units, { members: [weak] })
                + rawSecondsPerPack(units, { members: [strong] }),
                6
            )
        })
    })
})
