/**
 * The Global Power Number and the collection passives that feed it.
 *
 * GPN's design claim (`global-power-number.md` §1) is that it needs no collection term because
 * everything owned already reaches the party's real stats. That claim is only true if the
 * collection passives actually work — so both halves are specced here together.
 */

import { describe, expect, it } from 'vitest'
import { makeHero, makeParty } from '../../scripts/hero-quest/sim'
import { globalPower } from '#shared/utils/hero-quest/power'
import { economyBonuses, heroModifierTotals, partyUnitStats } from '#shared/utils/hero-quest/stats'
import { SKILLS } from '#shared/utils/hero-quest/content/skills'
import { ARTIFACTS } from '#shared/utils/hero-quest/content/artifacts'
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
    it('stays finite deep into the curve', () => {
        expect(Number.isFinite(globalPower(makeParty('class_beginner', 5000, 6)).gpn.log10().toNumber())).toBe(true)
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
