/**
 * The Global Power Number and the collection passives that feed it.
 *
 * GPN's design claim (`global-power-number.md` §1) is that it needs no collection term because
 * everything owned already reaches the party's real stats. That claim is only true if the
 * collection passives actually work — so both halves are specced here together.
 */

import { describe, expect, it } from 'vitest'
import { makeHero, makeParty } from '../../scripts/hero-quest/sim'
import { globalPower, memberEhp } from '#shared/utils/hero-quest/power'
import { economyBonuses, heroModifierTotals, partyUnitStats } from '#shared/utils/hero-quest/stats'
import { EHP_DEF_CONSTANT, GPN_DISPLAY_SCALE, MAX_EVASION, SKILL_COLLECTION_PASSIVE_FRACTION } from '#shared/utils/hero-quest/constants'
import { SKILLS } from '#shared/utils/hero-quest/content/skills'
import { ARTIFACTS } from '#shared/utils/hero-quest/content/artifacts'
import { D } from '#shared/utils/hero-quest/numbers'
import type { OwnedCopy } from '#shared/utils/hero-quest/types'

const maxed = (contentId: string): OwnedCopy => ({ contentId, star: 5, level: 10 })

/** A Passive Skill with a plain stat line (and which stat it is), and one whose only line is Gold. */
const STAT_SKILL = SKILLS.find(skill => skill.type === 'passive'
    && (skill.modifiers ?? []).some(line => line.kind === 'stat'))!
const SKILL_STAT = STAT_SKILL.modifiers!.find(line => line.kind === 'stat')!.stat!
const GOLD_SKILL = SKILLS.find(skill => skill.type === 'passive'
    && (skill.modifiers ?? []).length > 0
    && (skill.modifiers ?? []).every(line => line.kind === 'gold'))!
/** An Artifact whose lines include a PWR stat line. */
const PWR_ARTIFACT = ARTIFACTS.find(artifact =>
    artifact.effects.some(line => line.kind === 'stat' && line.stat === 'pwr'))!

describe('globalPower', () => {
    it('is the geometric mean of party DPS and party effective HP, lifted by the display scale', () => {
        const power = globalPower(makeHero('class_beginner', 40))
        expect(power.gpn.toNumber())
            .toBeCloseTo(power.dps.mul(power.ehp).sqrt().mul(GPN_DISPLAY_SCALE).toNumber(), 6)
        // The root holds it to the same order as the stats it is made of; the scale keeps it clear
        // of them. A fresh Hero opens in the hundreds rather than the tens of thousands.
        expect(globalPower(makeHero('class_beginner', 1)).gpn.toNumber()).toBeGreaterThan(100)
        expect(globalPower(makeHero('class_beginner', 1)).gpn.toNumber()).toBeLessThan(10_000)
    })

    it('reads effective HP as HP stretched by DEF and by evasion', () => {
        const unit = partyUnitStats(makeHero('class_warrior', 30))[0]!
        const expected = unit.maxHp.mul(D(1).add(unit.def.div(EHP_DEF_CONSTANT)))
        expect(memberEhp(unit).toNumber()).toBeCloseTo(expected.toNumber(), 6)

        // Half the attacks missing is exactly twice as durable (§2).
        expect(memberEhp({ ...unit, eva: 0.5 }).toNumber()).toBeCloseTo(expected.mul(2).toNumber(), 6)
        // And evasion cannot run past the cap however it is sourced.
        expect(memberEhp({ ...unit, eva: 0.95 }).toNumber())
            .toBeCloseTo(expected.div(1 - MAX_EVASION).toNumber(), 6)
    })

    it('itemises per unit, and the rows sum to the party totals', () => {
        const power = globalPower(makeParty('class_beginner', 60, 3))
        expect(power.units).toHaveLength(3)
        const dps = power.units.reduce((total, row) => total.add(row.dps), D(0))
        const ehp = power.units.reduce((total, row) => total.add(row.ehp), D(0))
        expect(dps.toNumber()).toBeCloseTo(power.dps.toNumber(), 6)
        expect(ehp.toNumber()).toBeCloseTo(power.ehp.toNumber(), 6)
    })

    it('climbs with every level', () => {
        let previous = D(0)
        for (const level of [1, 2, 10, 50, 200, 1000]) {
            const gpn = globalPower(makeHero('class_beginner', level)).gpn
            expect(gpn.gt(previous), `level ${level}`).toBe(true)
            previous = gpn
        }
    })

    it('stays finite deep into the curve', () => {
        expect(Number.isFinite(globalPower(makeParty('class_beginner', 5000, 6)).gpn.log10().toNumber())).toBe(true)
    })

    it('rises when Champions are fielded, so benching them lowers it — it is a live reading', () => {
        const solo = globalPower(makeHero('class_beginner', 50)).gpn
        const party = globalPower(makeParty('class_beginner', 50, 3)).gpn
        expect(party.gt(solo)).toBe(true)
    })

    it('falls when an Artifact is unequipped, but not to nothing — the collection passive stays', () => {
        const owned = [maxed(PWR_ARTIFACT.id)]
        const none = globalPower(makeHero('class_beginner', 50)).gpn
        const benched = globalPower(makeHero('class_beginner', 50, { ownedArtifacts: owned })).gpn
        const equipped = globalPower(makeHero('class_beginner', 50, { ownedArtifacts: owned, equippedArtifacts: owned })).gpn
        expect(benched.gt(none)).toBe(true)
        expect(equipped.gt(benched)).toBe(true)
    })
})

describe('collection passives for Skills and Artifacts', () => {
    it('lets an unequipped Passive Skill raise the Hero\'s stat, at a fraction of equipping it', () => {
        const owned = [maxed(STAT_SKILL.id)]
        const none = heroModifierTotals(makeHero('class_beginner', 1)).stats[SKILL_STAT] - 1
        const benched = heroModifierTotals(makeHero('class_beginner', 1, { ownedSkills: owned })).stats[SKILL_STAT] - 1
        const equipped = heroModifierTotals(makeHero('class_beginner', 1, { ownedSkills: owned, equippedSkills: owned })).stats[SKILL_STAT] - 1
        expect(none).toBe(0)
        expect(benched).toBeGreaterThan(0)
        expect(equipped).toBeGreaterThan(benched)
    })

    it('pays an equipped copy its collection share on top of its full lines', () => {
        // additive since 2026-10-04: equipping a Skill never takes away what owning it gave
        const owned = [maxed(STAT_SKILL.id)]
        const withCollection = heroModifierTotals(makeHero('class_beginner', 1, { ownedSkills: owned, equippedSkills: owned }))
        const equippedOnly = heroModifierTotals(makeHero('class_beginner', 1, { equippedSkills: owned }))
        expect(withCollection.stats[SKILL_STAT] - 1)
            .toBeCloseTo((equippedOnly.stats[SKILL_STAT] - 1) * (1 + SKILL_COLLECTION_PASSIVE_FRACTION), 12)
    })

    it('passes combat-stat lines only — a benched Gold Skill adds no Gold', () => {
        const benched = economyBonuses(makeHero('class_beginner', 1, { ownedSkills: [maxed(GOLD_SKILL.id)] }))
        expect(benched.goldPct).toBe(0)
        const equipped = economyBonuses(makeHero('class_beginner', 1, {
            ownedSkills: [maxed(GOLD_SKILL.id)],
            equippedSkills: [maxed(GOLD_SKILL.id)]
        }))
        expect(equipped.goldPct).toBeGreaterThan(0)
    })

    it('reaches only the Hero — a benched Artifact never strengthens a Champion', () => {
        const without = partyUnitStats(makeParty('class_beginner', 30, 3))
        const with_ = partyUnitStats(makeParty('class_beginner', 30, 3, { ownedArtifacts: [maxed(PWR_ARTIFACT.id)] }))
        expect(with_[0]!.pwr.gt(without[0]!.pwr)).toBe(true)
        for (let index = 1; index < without.length; index++) {
            expect(with_[index]!.pwr.eq(without[index]!.pwr), `unit ${index}`).toBe(true)
        }
    })

    it('ignores ids that are not the system\'s own', () => {
        const stray = heroModifierTotals(makeHero('class_beginner', 1, {
            ownedSkills: [maxed(PWR_ARTIFACT.id)],
            ownedArtifacts: [maxed(STAT_SKILL.id)]
        }))
        expect(stray.stats.pwr).toBe(1)
        expect(stray.stats[SKILL_STAT]).toBe(1)
    })
})
