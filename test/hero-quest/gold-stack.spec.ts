/**
 * The Gold stack (`gold-economy.md` §5): a dedicated Gold build stays under the ×5.5 the balance
 * column's headroom check in `settle.spec.ts` assumes, the bursts and the passive Gold% lines
 * together.
 */
import { describe, expect, it } from 'vitest'
import { makeParty } from '../../scripts/hero-quest/sim'
import { MAX_ARTIFACT_SLOTS, MAX_SKILL_SLOTS, MAX_STAR, LEVELS_PER_STAR } from '#shared/utils/hero-quest/constants'
import { SKILLS } from '#shared/utils/hero-quest/content/skills'
import { ARTIFACTS } from '#shared/utils/hero-quest/content/artifacts'
import { economyBonuses, partyUnitStats } from '#shared/utils/hero-quest/stats'
import { projectAbilities } from '#shared/utils/hero-quest/projection'
import type { HeroSnapshot, OwnedCopy } from '#shared/utils/hero-quest/types'

const base = makeParty('class_hunter', 400, 3)
const maxed = (contentId: string): OwnedCopy => ({ contentId, star: MAX_STAR, level: LEVELS_PER_STAR })
const stack = (hero: HeroSnapshot) =>
    (1 + economyBonuses(hero).goldPct) * projectAbilities(hero, partyUnitStats(hero), 5).goldFactor

/** The `count` items that each raise Gold the most on their own, maxed. */
function best<T extends { id: string }>(items: readonly T[], count: number, field: 'Skills' | 'Artifacts'): OwnedCopy[] {
    return items
        .map(item => ({ copy: maxed(item.id), gold: stack({ ...base, [`equipped${field}`]: [maxed(item.id)], [`owned${field}`]: [maxed(item.id)] }) }))
        .sort((a, b) => b.gold - a.gold)
        .slice(0, count)
        .map(entry => entry.copy)
}

describe('the Gold stack', () => {
    it('stays under the worst case with every slot on maxed Gold', () => {
        const skills = best(SKILLS, MAX_SKILL_SLOTS, 'Skills')
        const artifacts = best(ARTIFACTS, MAX_ARTIFACT_SLOTS, 'Artifacts')
        const worst = stack({ ...base, equippedSkills: skills, ownedSkills: skills, equippedArtifacts: artifacts, ownedArtifacts: artifacts })
        expect(worst).toBeLessThan(5.5)
    })
})
