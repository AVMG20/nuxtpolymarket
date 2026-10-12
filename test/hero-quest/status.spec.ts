/**
 * The status engine (`shared/utils/hero-quest/status.ts`).
 *
 * These specs test the *rules* rather than any content — ability content is covered in
 * `effects.spec.ts` and `fight.spec.ts`: stacking, refresh, expiry, cadence, cleanse, immunity,
 * shields, and the control kinds.
 *
 * Every rule here was decided rather than transcribed, because no design doc defines a status
 * system while both ability rosters assume one. Each spec names the rule it pins down, so a
 * later change to a rule shows up as a spec that has to be argued with rather than one that
 * quietly goes red.
 */

import { describe, expect, it } from 'vitest'
import {
    absorbDamage,
    applyStatus,
    canAutoattack,
    canCastAbilities,
    cleanse,
    extendHostile,
    hasStatus,
    isHostile,
    reflectFraction,
    stackCount,
    statMultiplier,
    tickStatuses
} from '#shared/utils/hero-quest/status'
import type { StatusInstance } from '#shared/utils/hero-quest/status'
import { STATUS_MAX_STACKS, STATUS_TICK_SECONDS } from '#shared/utils/hero-quest/constants'

const burn = { id: 'burn', kind: 'dot' as const, duration: 10, magnitude: 5 }

function list(...applications: Parameters<typeof applyStatus>[1][]): StatusInstance[] {
    const statuses: StatusInstance[] = []
    for (const application of applications) applyStatus(statuses, application)
    return statuses
}

describe('status engine', () => {
    describe('stacking and refresh', () => {
        it('adds a stack and refreshes duration when the same effect reapplies', () => {
            const statuses = list(burn)
            tickStatuses(statuses, 4)
            expect(statuses[0]!.remaining).toBe(6)

            applyStatus(statuses, burn)
            // One instance, two stacks, clock back to full — both halves are needed: the
            // stack because the rosters say "re-application stacks", the refresh because a
            // stacking effect that never refreshed would expire however hard it was kept up.
            expect(statuses).toHaveLength(1)
            expect(statuses[0]!.stacks).toBe(2)
            expect(statuses[0]!.remaining).toBe(10)
        })

        it('refreshes to the longer duration, never blindly to the newer one', () => {
            const statuses = list({ ...burn, duration: 20 })
            applyStatus(statuses, { ...burn, duration: 3 })
            // Otherwise a short cheap application would cut a long expensive one short, making
            // a strong effect strictly worse for standing next to a weak one.
            expect(statuses[0]!.remaining).toBe(20)
        })

        it('refreshes a stat buff or debuff in place rather than stacking it', () => {
            // A buff that outlasts its own cooldown is recast while still up. Stacking it would
            // turn "doubles SPD" into ×6 and a −20% debuff into −100%.
            const haste = { id: 'haste', kind: 'buff' as const, stat: 'spd' as const, duration: 6, magnitude: 1 }
            const statuses = list(haste)
            tickStatuses(statuses, 4)
            applyStatus(statuses, haste)
            applyStatus(statuses, { ...haste, id: 'weaken', kind: 'debuff', stat: 'pwr' })
            applyStatus(statuses, { ...haste, id: 'weaken', kind: 'debuff', stat: 'pwr' })

            expect(statuses.find(status => status.id === 'haste')).toMatchObject({ stacks: 1, remaining: 6 })
            expect(statuses.find(status => status.id === 'weaken')!.stacks).toBe(1)
            expect(statMultiplier(statuses, 'spd').toNumber()).toBe(2)
        })

        it('stacks a stat effect whose application asks for stacks', () => {
            // How Frostbind's slow and Iron Skin opt in.
            const slow = { id: 'slow', kind: 'debuff' as const, stat: 'spd' as const, duration: 6, magnitude: 0.1, stacks: 1 }
            const statuses = list(slow, slow, slow)
            expect(statuses[0]!.stacks).toBe(3)
        })

        it('caps stacks so a maintained effect cannot grow without bound', () => {
            const statuses = list(burn)
            for (let index = 0; index < STATUS_MAX_STACKS + 5; index++) applyStatus(statuses, burn)
            expect(statuses[0]!.stacks).toBe(STATUS_MAX_STACKS)
        })

        it('keeps different ids as separate instances', () => {
            const statuses = list(burn, { ...burn, id: 'other_burn' })
            expect(statuses).toHaveLength(2)
            expect(stackCount(statuses, 'dot')).toBe(2)
        })
    })

    describe('periodic effects', () => {
        it('pays out on the status grid, not the combat tick', () => {
            const statuses = list(burn)
            // The rule that keeps "damage per second" a property of the effect: halving the
            // sim's resolution must not halve a burn.
            const whole = tickStatuses(list(burn), STATUS_TICK_SECONDS).damage.toNumber()
            const halves = [0, 0].reduce(
                (total) => total + tickStatuses(statuses, STATUS_TICK_SECONDS / 2).damage.toNumber(),
                0
            )
            expect(halves).toBeCloseTo(whole, 10)
            expect(whole).toBe(5)
        })

        it('scales with stacks', () => {
            const statuses = list(burn, burn, burn)
            expect(tickStatuses(statuses, STATUS_TICK_SECONDS).damage.toNumber()).toBe(15)
        })

        it('pays only the fraction earned when an effect expires mid-tick', () => {
            const statuses = list({ ...burn, duration: STATUS_TICK_SECONDS / 4 })
            // A quarter of a tick left means a quarter of a tick's damage, not a whole one and
            // not nothing.
            expect(tickStatuses(statuses, STATUS_TICK_SECONDS).damage.toNumber()).toBe(5 / 4)
        })

        it('heals rather than damages for a hot', () => {
            const statuses = list({ id: 'regen', kind: 'hot', duration: 10, magnitude: 7 })
            const tick = tickStatuses(statuses, STATUS_TICK_SECONDS)
            expect(tick.healing.toNumber()).toBe(7)
            expect(tick.damage.toNumber()).toBe(0)
        })

        it('reports and removes what expired', () => {
            const statuses = list(burn, { id: 'slow', kind: 'debuff', stat: 'spd', duration: 2, magnitude: 0.5 })
            const tick = tickStatuses(statuses, 3)
            expect(tick.expired.map(status => status.id)).toEqual(['slow'])
            expect(statuses.map(status => status.id)).toEqual(['burn'])
        })
    })

    describe('stat modifiers', () => {
        it('is the identity when nothing is applied — the no-status path must not move', () => {
            expect(statMultiplier([], 'pwr').toNumber()).toBe(1)
        })

        it('combines multiplicatively, so resolution order cannot matter', () => {
            const buffFirst = list(
                { id: 'empower', kind: 'buff', stat: 'pwr', duration: 10, magnitude: 0.5 },
                { id: 'weaken', kind: 'debuff', stat: 'pwr', duration: 10, magnitude: 0.2 }
            )
            const debuffFirst = list(
                { id: 'weaken', kind: 'debuff', stat: 'pwr', duration: 10, magnitude: 0.2 },
                { id: 'empower', kind: 'buff', stat: 'pwr', duration: 10, magnitude: 0.5 }
            )
            // 1.5 × 0.8 either way. This is *why* the scheme is multiplicative: an additive
            // one would need a stated order and a floor rule, both arbitrary.
            expect(statMultiplier(buffFirst, 'pwr').toNumber()).toBeCloseTo(1.2, 10)
            expect(statMultiplier(debuffFirst, 'pwr').toNumber())
                .toBeCloseTo(statMultiplier(buffFirst, 'pwr').toNumber(), 10)
        })

        it('touches only the stat it names', () => {
            const statuses = list({ id: 'shred', kind: 'debuff', stat: 'def', duration: 10, magnitude: 0.3 })
            expect(statMultiplier(statuses, 'def').toNumber()).toBeCloseTo(0.7, 10)
            expect(statMultiplier(statuses, 'pwr').toNumber()).toBe(1)
        })

        it('floors a stat at zero rather than letting debuffs drive it negative', () => {
            const statuses = list({ id: 'shred', kind: 'debuff', stat: 'def', duration: 10, magnitude: 0.5 })
            statuses[0]!.stacks = 4 // 4 × 50% would be −100% without the clamp
            expect(statMultiplier(statuses, 'def').toNumber()).toBe(0)
        })
    })

    describe('shields', () => {
        const shield = { id: 'sanctuary', kind: 'shield' as const, duration: 10, magnitude: 100 }

        it('eats damage before HP and reports what it took', () => {
            const statuses = list(shield)
            const result = absorbDamage(statuses, 40)
            expect(result.absorbed.toNumber()).toBe(40)
            expect(result.throughput.toNumber()).toBe(0)
            expect(statuses[0]!.magnitude.toNumber()).toBe(60)
        })

        it('lets the remainder through once the pool is gone, and breaks', () => {
            const statuses = list(shield)
            const result = absorbDamage(statuses, 150)
            expect(result.absorbed.toNumber()).toBe(100)
            expect(result.throughput.toNumber()).toBe(50)
            expect(result.broken.map(status => status.id)).toEqual(['sanctuary'])
            expect(statuses).toHaveLength(0)
        })

        it('tops up rather than replacing when reapplied — a pool, not a rate', () => {
            const statuses = list(shield)
            absorbDamage(statuses, 30)
            applyStatus(statuses, shield)
            expect(statuses[0]!.magnitude.toNumber()).toBe(170)
        })

        it('passes damage straight through when no shield is up', () => {
            expect(absorbDamage([], 40).throughput.toNumber()).toBe(40)
        })
    })

    describe('control', () => {
        it('lets a silenced unit swing but not cast', () => {
            const statuses = list({ id: 'silence', kind: 'silence', duration: 5 })
            expect(canAutoattack(statuses)).toBe(true)
            expect(canCastAbilities(statuses)).toBe(false)
        })

        it('stops both for a stun — the harder of the two', () => {
            const statuses = list({ id: 'freeze', kind: 'stun', duration: 5 })
            expect(canAutoattack(statuses)).toBe(false)
            expect(canCastAbilities(statuses)).toBe(false)
        })

        it('frees the unit once control expires', () => {
            const statuses = list({ id: 'freeze', kind: 'stun', duration: 2 })
            tickStatuses(statuses, 3)
            expect(canAutoattack(statuses)).toBe(true)
        })
    })

    describe('cleanse, immunity and extension', () => {
        it('strips hostile effects and leaves the bearer its own buffs and shields', () => {
            const statuses = list(
                burn,
                { id: 'silence', kind: 'silence', duration: 5 },
                { id: 'empower', kind: 'buff', stat: 'pwr', duration: 5, magnitude: 0.5 },
                { id: 'sanctuary', kind: 'shield', duration: 5, magnitude: 50 }
            )
            const removed = cleanse(statuses)

            expect(removed.map(status => status.id).sort()).toEqual(['burn', 'silence'])
            expect(statuses.map(status => status.id).sort()).toEqual(['empower', 'sanctuary'])
        })

        it('classifies kinds so a cleanse can never eat a friendly effect', () => {
            expect(['dot', 'debuff', 'silence', 'stun'].every(isHostile)).toBe(true)
            expect(['hot', 'buff', 'shield', 'taunt', 'reflect'].some(isHostile)).toBe(false)
        })

        it('blocks new hostile effects while immune, and lets friendly ones land', () => {
            const statuses = list({ id: 'purify', kind: 'immunity', duration: 5 })

            expect(applyStatus(statuses, burn)).toBe(false)
            expect(hasStatus(statuses, 'dot')).toBe(false)
            // Reports the deflection rather than silently dropping it, so a replay can show it.
            expect(applyStatus(statuses, { id: 'regen', kind: 'hot', duration: 5, magnitude: 1 })).toBe(true)
        })

        it('extends every live hostile effect — the mechanism behind Unraveling Curse', () => {
            const statuses = list(
                burn,
                { id: 'empower', kind: 'buff', stat: 'pwr', duration: 10, magnitude: 0.5 }
            )
            expect(extendHostile(statuses, 5)).toBe(1)
            expect(statuses.find(status => status.id === 'burn')!.remaining).toBe(15)
            // The buff is untouched — "extend all debuffs" must not extend the target's own
            // advantages, which is only expressible because the registry is queryable by kind.
            expect(statuses.find(status => status.id === 'empower')!.remaining).toBe(10)
        })
    })

    describe('reflect', () => {
        it('sums across instances and caps at the whole hit', () => {
            expect(reflectFraction([]).toNumber()).toBe(0)
            const statuses = list(
                { id: 'thorns', kind: 'reflect', duration: 5, magnitude: 0.3 },
                { id: 'vow', kind: 'reflect', duration: 5, magnitude: 0.4 }
            )
            expect(reflectFraction(statuses).toNumber()).toBeCloseTo(0.7, 10)

            statuses[0]!.stacks = STATUS_MAX_STACKS
            expect(reflectFraction(statuses).toNumber()).toBe(1)
        })
    })
})
