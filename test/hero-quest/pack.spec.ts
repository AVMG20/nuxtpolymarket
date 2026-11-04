/**
 * Enemy packs (`classes-and-combat.md` §7): a pack never reprices the offense side (seconds per
 * enemy are the same at any size), it bites on survivability, and a mixed pack fights each member
 * at its own mitigation.
 */

import { describe, expect, it } from 'vitest'
import {
    effectiveStreams,
    enemyPackAt,
    enemyStatsAt,
    packSize,
    packSizeFor,
    rawSecondsPerPack,
    secondsPerKill,
    secondsToDie
} from '#shared/utils/hero-quest/settle'
import { partyUnitStats } from '#shared/utils/hero-quest/stats'
import {
    BASE_KILL_COUNT,
    ELITE_PACK_SIZE,
    WAVE_PACK_SIZE
} from '#shared/utils/hero-quest/constants'
import { ZERO } from '#shared/utils/hero-quest/numbers'
import type { HeroSnapshot, RunPosition } from '#shared/utils/hero-quest/types'

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

describe('enemy packs', () => {
    describe('pack size by stage archetype', () => {
        it('divides the stage kill requirement evenly, so no pack is a ragged remainder', () => {
            // 30 kills at 6 a time is five clean encounters. A size that does not divide
            // `BASE_KILL_COUNT` would leave the last pack of every stage short.
            expect(BASE_KILL_COUNT % WAVE_PACK_SIZE).toBe(0)
            expect(BASE_KILL_COUNT % ELITE_PACK_SIZE).toBe(0)
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

    describe('the offense axis does not move', () => {
        it('charges the same seconds per enemy however large the pack', () => {
            const units = partyUnitStats(hero(50))
            const pos = at(2, 2)
            const member = enemyStatsAt(pos)
            const baseline = secondsPerKill(units, { members: [member] })

            for (const size of [1, 3, 8]) {
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
    })

    describe('the survivability axis is where packs bite', () => {
        it('shortens time-to-die by exactly the stream multiplier', () => {
            const units = partyUnitStats(hero(60))
            const member = enemyStatsAt(at(1, 1))
            const one = secondsToDie(units, { members: [member] })
            const three = secondsToDie(units, { members: [member, member, member] })

            expect(three).toBeCloseTo(one / effectiveStreams(3), 6)
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
