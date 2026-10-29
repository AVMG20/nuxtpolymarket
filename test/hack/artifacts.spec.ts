import { describe, it, expect } from 'vitest'
import {
  OP_TEMPLATES,
  collectBonuses,
  effectiveGemRange,
  ARTIFACT_VALUE,
  AGENT_TRAIT_RANGES,
  RARITY_ORDER,
  type AgentClass,
  type AgentTraitType,
  type ItemMod,
} from '../../shared/utils/hack-config'

describe('artifacts', () => {
  it('keeps every artifact magnitude within the same units as the trait it targets, never overshooting the full range in one apply', () => {
    // Regression: a magnitude table whose units don't match the trait's own scale
    // overshoots the entire range on a single Ghost apply, silently maxing the trait
    // and rendering nonsense like "+20.0%" where "+0.2%" was meant.
    for (const type of Object.keys(ARTIFACT_VALUE) as AgentTraitType[]) {
      const range = AGENT_TRAIT_RANGES[type]
      const gap = range.max - range.min
      for (const rarity of RARITY_ORDER) {
        expect(ARTIFACT_VALUE[type][rarity]).toBeLessThan(gap)
      }
    }
  })

  it('always pays out a whole number of gems from a fractionally-stacked Gem Yield trait', () => {
    // Regression: gems are never fractional anywhere else in the game, but a Gem
    // Yield Artifact accumulates in fractional steps (e.g. Ghost +1 onto a 10.4
    // roll), so the multiplied payout has to round rather than leak "12.6 gems"
    // into the collect screen and the pre-deploy preview.
    const agent = { level: 1, class: 'bruteforce' as AgentClass, traits: [{ type: 'gem_yield' as AgentTraitType, value: 33.3 }], items: [] as Array<{ mods: ItemMod[] }> }
    const bonuses = collectBonuses([agent])
    const gemOp = OP_TEMPLATES.find(t => t.id === 'project_zero')!
    for (const n of effectiveGemRange(gemOp, bonuses)) expect(Number.isInteger(n)).toBe(true)
  })
})
