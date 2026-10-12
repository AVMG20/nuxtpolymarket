import { describe, expect, it } from 'vitest'
import {
    attackIntervalFor,
    attacksPerSecondFor,
    cooldownFor,
    critChanceFor,
    critMultiplierFor,
    expectedHitDamage,
    hitChanceAgainst,
    maxHpFor,
    mitigation,
    partyDps,
    partyMitigation,
    rawHitDamage,
    unitDps
} from '#shared/utils/hero-quest/combat'
import {
    BASE_ATTACK_INTERVAL_SECONDS,
    MIN_ATTACK_INTERVAL_SECONDS,
    BASE_HP,
    CRIT_CHANCE_PER_POINT,
    CRIT_DAMAGE_PER_POINT,
    MIN_COOLDOWN_SECONDS,
    MIN_DAMAGE,
    SKILL_BASE_COOLDOWN_SECONDS,
    HP_PER_VIT,
    K,
    MAX_EVASION,
    OVERFLOW_CONVERSION_RATE
} from '#shared/utils/hero-quest/constants'
import { deriveUnitStats, heroStatBlock } from '#shared/utils/hero-quest/stats'
import { getClass } from '#shared/utils/hero-quest/content/classes'
import { D } from '#shared/utils/hero-quest/numbers'

describe('hero-quest combat math', () => {
    /**
     * The pairwise contract — one attacker, one defender. A *party* does not experience
     * this directly: it pools PWR first, which is the `pooled party damage` block below.
     */
    describe('mitigation and damage', () => {
        it('deals full damage against zero DEF', () => {
            expect(mitigation(100, 0).toNumber()).toBe(0)
            expect(rawHitDamage(100, 0).toNumber()).toBe(100)
        })

        it('reaches full mitigation at DEF = PWR × K, and floors damage at MIN_DAMAGE', () => {
            const pwr = 100
            const def = pwr * K
            // Mitigation itself is still a clean 100% — the floor lives in the damage
            // formula, not in the ratio.
            expect(mitigation(pwr, def).toNumber()).toBe(1)
            expect(rawHitDamage(pwr, def).toNumber()).toBe(MIN_DAMAGE)
        })

        it('stays on the floor past the threshold, never zero and never negative', () => {
            const pwr = 100
            for (const def of [pwr * K, pwr * K * 2, pwr * K * 1000]) {
                expect(rawHitDamage(pwr, def).toNumber()).toBe(MIN_DAMAGE)
            }
        })

        it('scales smoothly with the DEF-to-PWR ratio below the threshold', () => {
            // DEF at half the threshold → half mitigation.
            expect(mitigation(100, 100 * K / 2).toNumber()).toBeCloseTo(0.5, 10)
            expect(rawHitDamage(100, 100 * K / 2).toNumber()).toBeCloseTo(50, 10)
        })

        it('is relative, not absolute — the same ratio mitigates the same at any scale', () => {
            const small = mitigation(10, 10).toNumber()
            const huge = mitigation(D(10).pow(60), D(10).pow(60)).toNumber()
            expect(huge).toBeCloseTo(small, 10)
        })

        it('applies the ability multiplier', () => {
            expect(rawHitDamage(100, 0, 2.5).toNumber()).toBe(250)
        })
    })

    describe('crit', () => {
        it('converts LCK linearly up to 100%', () => {
            const lck = 20
            expect(critChanceFor(lck).critChance).toBeCloseTo(lck * CRIT_CHANCE_PER_POINT, 10)
            expect(critChanceFor(lck).overflow.toNumber()).toBe(0)
        })

        it('caps chance at 100% and overflows the excess', () => {
            const lck = 2 / CRIT_CHANCE_PER_POINT // twice what's needed for 100%
            expect(critChanceFor(lck).critChance).toBe(1)
            expect(critChanceFor(lck).overflow.toNumber()).toBeCloseTo(1, 10)
        })

        it('converts overflow LCK into crit damage rather than wasting it', () => {
            const atCap = 1 / CRIT_CHANCE_PER_POINT
            const beyond = 2 / CRIT_CHANCE_PER_POINT
            expect(critMultiplierFor(beyond, 10).gt(critMultiplierFor(atCap, 10))).toBe(true)
        })

        it('keeps overflow well below direct IMP investment', () => {
            expect(OVERFLOW_CONVERSION_RATE).toBeLessThan(CRIT_DAMAGE_PER_POINT)
        })

        it('scales crit damage from IMP', () => {
            expect(critMultiplierFor(0, 10).toNumber()).toBeCloseTo(1 + 10 * CRIT_DAMAGE_PER_POINT, 10)
        })
    })

    describe('HP', () => {
        it('is base plus VIT scaling', () => {
            expect(maxHpFor(0).toNumber()).toBe(BASE_HP)
            expect(maxHpFor(10).toNumber()).toBe(BASE_HP + 10 * HP_PER_VIT)
        })
    })

    describe('attack rate', () => {
        it('starts at the base interval when SPD is zero', () => {
            // Both halves read the constant rather than restating it, so a spec about a *shape*
            // does not encode a tuning value.
            expect(attackIntervalFor(0)).toBe(BASE_ATTACK_INTERVAL_SECONDS)
            expect(attacksPerSecondFor(0)).toBeCloseTo(1 / BASE_ATTACK_INTERVAL_SECONDS, 10)
        })

        it('speeds up monotonically with SPD', () => {
            let previous = attackIntervalFor(0)
            for (const spd of [10, 50, 100, 200]) {
                const interval = attackIntervalFor(spd)
                expect(interval).toBeLessThan(previous)
                previous = interval
            }
        })

        it('is hard-capped by the floor interval, however high SPD climbs', () => {
            // The property is "SPD cannot buy an unbounded rate", not a particular cap.
            const cap = 1 / MIN_ATTACK_INTERVAL_SECONDS
            for (const spd of [400, 4_000, 1e9]) {
                expect(attacksPerSecondFor(spd)).toBeLessThanOrEqual(cap)
            }
            expect(attacksPerSecondFor(1e9)).toBeCloseTo(cap, 10)
        })

        it('never slows below the base interval for a zero or negative SPD', () => {
            expect(attackIntervalFor(-50)).toBe(BASE_ATTACK_INTERVAL_SECONDS)
        })
    })

    describe('skill cooldowns', () => {
        it('is the skill\'s own base at zero SPD', () => {
            expect(cooldownFor(SKILL_BASE_COOLDOWN_SECONDS, 0)).toBe(SKILL_BASE_COOLDOWN_SECONDS)
        })

        it('shortens monotonically with SPD', () => {
            let previous = cooldownFor(SKILL_BASE_COOLDOWN_SECONDS, 0)
            for (const spd of [10, 50, 100, 200]) {
                const cooldown = cooldownFor(SKILL_BASE_COOLDOWN_SECONDS, spd)
                expect(cooldown).toBeLessThan(previous)
                previous = cooldown
            }
        })

        it('never drops below the floor, however high SPD climbs', () => {
            for (const spd of [400, 4_000, 1e9]) {
                expect(cooldownFor(SKILL_BASE_COOLDOWN_SECONDS, spd)).toBeGreaterThanOrEqual(MIN_COOLDOWN_SECONDS)
            }
        })

        it('never lengthens a cooldown for a zero or negative SPD', () => {
            expect(cooldownFor(SKILL_BASE_COOLDOWN_SECONDS, -50)).toBe(SKILL_BASE_COOLDOWN_SECONDS)
        })

        it('rides the same SPD curve the autoattack interval does', () => {
            // One stat, one shape — a skill base equal to the attack interval must track
            // attackIntervalFor exactly.
            for (const spd of [0, 10, 100]) {
                expect(cooldownFor(BASE_ATTACK_INTERVAL_SECONDS, spd)).toBeCloseTo(attackIntervalFor(spd), 10)
            }
        })

        it('leaves a base shorter than the floor alone rather than raising it', () => {
            const tiny = MIN_COOLDOWN_SECONDS / 2
            expect(cooldownFor(tiny, 500)).toBe(tiny)
        })
    })

    describe('evasion', () => {
        it('lands every hit at zero EVA', () => {
            expect(hitChanceAgainst(0)).toBe(1)
        })

        it('clamps total EVA at MAX_EVASION', () => {
            expect(hitChanceAgainst(MAX_EVASION)).toBeCloseTo(1 - MAX_EVASION, 10)
            expect(hitChanceAgainst(0.99)).toBeCloseTo(1 - MAX_EVASION, 10)
        })

        it('never makes a party untouchable', () => {
            expect(hitChanceAgainst(1)).toBeGreaterThan(0)
        })
    })

    describe('DPS derivation', () => {
        it('folds multi-strike kits into party DPS', () => {
            const hunter = getClass('class_hunter')
            const single = { ...deriveUnitStats(heroStatBlock('class_hunter', 1), hunter), strikesPerAttack: 1 }
            const triple = deriveUnitStats(heroStatBlock('class_hunter', 1), hunter)
            expect(triple.strikesPerAttack).toBe(3)
            expect(unitDps(triple, 0).toNumber()).toBeCloseTo(unitDps(single, 0).toNumber() * 3, 6)
        })

        it('averages crit rather than rolling it', () => {
            const beginner = getClass('class_beginner')
            const unit = deriveUnitStats(heroStatBlock('class_beginner', 1), beginner)
            const expected = unit.pwr.toNumber() * (1 + unit.critChance * (unit.critMultiplier - 1))
            expect(expectedHitDamage(unit, 0).toNumber()).toBeCloseTo(expected, 6)
        })

        it('floors at MIN_DAMAGE, not zero, when the defender fully mitigates a lone attacker', () => {
            const beginner = getClass('class_beginner')
            const unit = deriveUnitStats(heroStatBlock('class_beginner', 1), beginner)

            // The hit itself lands on the floor exactly...
            expect(rawHitDamage(unit.pwr, unit.pwr.mul(K)).toNumber()).toBe(MIN_DAMAGE)
            // ...so the derived rate is small but never nothing. A wall is slow, not sealed.
            expect(unitDps(unit, unit.pwr.mul(K)).toNumber()).toBeGreaterThan(0)
        })

        it('cannot be pushed below the floor by any amount of DEF', () => {
            const beginner = getClass('class_beginner')
            const unit = deriveUnitStats(heroStatBlock('class_beginner', 1), beginner)
            for (const def of ['1e6', '1e50', '1e300']) {
                expect(rawHitDamage(unit.pwr, D(def)).toNumber()).toBe(MIN_DAMAGE)
            }
        })
    })

    /**
     * Pooling is what lets unit count move the mitigation threshold instead of only scaling
     * the residual below it. Without it, mitigation resolves per attacker and N units share
     * one ceiling — a party could never open a wall the Hero alone could not.
     */
    describe('pooled party damage', () => {
        const beginner = getClass('class_beginner')
        const unit = () => deriveUnitStats(heroStatBlock('class_beginner', 1), beginner)
        const party = (size: number) => Array.from({ length: size }, unit)

        it('agrees with the per-unit path at a party of one', () => {
            const solo = unit()
            for (const def of [0, 5, 12]) {
                expect(partyDps([solo], def).toNumber()).toBeCloseTo(unitDps(solo, def).toNumber(), 10)
            }
        })

        it('pools PWR, so the mitigation threshold scales with party size', () => {
            const solo = unit()
            const wall = solo.pwr.mul(K)

            // What a party of N looks like once DEF is so far past the clamp that every unit
            // is pinned to MIN_DAMAGE. "Shut out" is this value rather than 0 — measured rather
            // than hardcoded so it survives a retune of MIN_DAMAGE or the crit constants.
            const floored = (size: number) => partyDps(party(size), D('1e300')).toNumber()

            // The DEF that pins one unit to the floor leaves a party of three still cutting.
            expect(partyDps([solo], wall).toNumber()).toBe(floored(1))
            expect(partyDps(party(3), wall).toNumber()).toBeGreaterThan(floored(3))

            // ...and the party has its own threshold, three times further out.
            expect(partyDps(party(3), wall.mul(3)).toNumber()).toBe(floored(3))
        })

        it('beats a plain sum of solo DPS whenever mitigation is biting', () => {
            const units = party(3)
            const def = units[0]!.pwr.toNumber() // well inside the clamp, not past it
            const summed = units.reduce((total, one) => total + unitDps(one, def).toNumber(), 0)

            expect(partyDps(units, def).toNumber()).toBeGreaterThan(summed)
        })

        it('is a plain sum when nothing is mitigated', () => {
            const units = party(4)
            const summed = units.reduce((total, one) => total + unitDps(one, 0).toNumber(), 0)
            expect(partyDps(units, 0).toNumber()).toBeCloseTo(summed, 6)
        })

        it('adds a weak unit as a gain, never a penalty', () => {
            const units = party(2)
            const weakling = { ...unit(), pwr: D(1) }
            expect(partyDps([...units, weakling], 20).toNumber())
                .toBeGreaterThan(partyDps(units, 20).toNumber())
        })

        it('is zero for an empty party', () => {
            expect(partyDps([], 0).toNumber()).toBe(0)
            expect(partyMitigation([], 10).toNumber()).toBe(1)
        })
    })
})
