import { describe, expect, it } from 'vitest'
import {
  deriveNutritionMax,
  effectiveEatPerTick,
  gemFeedNutritionPerGem,
  researchResourceMultiplier,
  MAX_RESEARCH_LEVEL,
  RESEARCH_RESOURCE_MULTIPLIERS
} from '../../shared/utils/colony'

describe('colony food balance', () => {
  it('charges the same meal regardless of yield', () => {
    const lowYield = { eat: 8, yield: 1 }
    const highYield = { eat: 8, yield: 100 }

    expect(effectiveEatPerTick(lowYield, 0.7)).toBe(effectiveEatPerTick(highYield, 0.7))
  })
})

describe('colony research', () => {
  it('doubles resource output at max level, in even 25% steps', () => {
    expect(RESEARCH_RESOURCE_MULTIPLIERS).toHaveLength(MAX_RESEARCH_LEVEL + 1)
    expect(researchResourceMultiplier(0)).toBe(1)
    expect(researchResourceMultiplier(MAX_RESEARCH_LEVEL)).toBe(2)
    for (let level = 1; level <= MAX_RESEARCH_LEVEL; level++) {
      expect(researchResourceMultiplier(level) - researchResourceMultiplier(level - 1)).toBeCloseTo(0.25, 10)
    }
  })

  it('clamps out-of-range levels instead of returning undefined', () => {
    expect(researchResourceMultiplier(-1)).toBe(1)
    expect(researchResourceMultiplier(MAX_RESEARCH_LEVEL + 5)).toBe(2)
  })
})

describe('gem nutrition balance', () => {
  it('starts at 200 nutrition per gem and scales with maximum storage', () => {
    const baseMax = deriveNutritionMax({})
    const upgradedMax = deriveNutritionMax({ nutrition_storage: 15 })

    expect(gemFeedNutritionPerGem(baseMax)).toBe(200)
    expect(gemFeedNutritionPerGem(upgradedMax)).toBeGreaterThan(200)
  })
})
