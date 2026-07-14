import { describe, expect, it } from 'vitest'
import {
  BUG_TYPES,
  UPGRADE_TRACKS,
  avgTickYield,
  deriveNutritionMax,
  effectiveEatPerTick,
  effectiveTickMs,
  gemFeedNutritionPerGem,
  getItem,
  habitatLevelUpDurationMs,
  habitatTrackRequirement,
  socialSpeedBonusPct,
  trackLevelDurationMs
} from '../../shared/utils/colony'

describe('colony food balance', () => {
  it('charges the same meal regardless of yield', () => {
    const lowYield = { eat: 8, yield: 1 }
    const highYield = { eat: 8, yield: 100 }

    expect(effectiveEatPerTick(lowYield, 0.7)).toBe(effectiveEatPerTick(highYield, 0.7))
  })

  it('starts low and rises with bug tier', () => {
    for (let tier = 2; tier <= 6; tier++) {
      const previousMax = Math.max(...BUG_TYPES.filter(bug => bug.tier === tier - 1).map(bug => bug.eatMax))
      const currentMin = Math.min(...BUG_TYPES.filter(bug => bug.tier === tier).map(bug => bug.eatMin))
      expect(currentMin).toBeGreaterThanOrEqual(previousMax)
    }
  })
})

describe('colony economy balance', () => {
  it('raises realistic baseline income smoothly at every tier', () => {
    const incomeByTier = new Map<number, number[]>()
    for (const bug of BUG_TYPES.filter(type => !type.producesGems)) {
      // Social species are meant to be grouped; solitary species are meant
      // to be kept alone. In both cases this is their intended +45% setup.
      const sameSpeciesCount = bug.social ? 4 : 1
      const tickMs = effectiveTickMs(
        { typeId: bug.id, speed: 12.5 },
        socialSpeedBonusPct(bug.id, sameSpeciesCount)
      )
      const hourlyIncome = avgTickYield(1.5) * (3_600_000 / tickMs) * (getItem(bug.itemId)?.sellValue ?? 0)
      const tierIncome = incomeByTier.get(bug.tier) ?? []
      tierIncome.push(hourlyIncome)
      incomeByTier.set(bug.tier, tierIncome)
    }

    let previousAverage = 0
    for (let tier = 1; tier <= 6; tier++) {
      const incomes = incomeByTier.get(tier) ?? []
      const average = incomes.reduce((sum, income) => sum + income, 0) / incomes.length
      if (previousAverage > 0) {
        expect(average / previousAverage).toBeGreaterThanOrEqual(2.2)
        expect(average / previousAverage).toBeLessThanOrEqual(4)
      }
      previousAverage = average
    }
  })

  it('keeps the builder critical path between 60 and 90 days', () => {
    let totalMs = 0
    for (const track of UPGRADE_TRACKS) {
      const requiredLevel = habitatTrackRequirement(track.id, 5)
      for (let level = 1; level <= requiredLevel; level++) totalMs += trackLevelDurationMs(level)
    }
    for (let habitatLevel = 1; habitatLevel < 6; habitatLevel++) {
      totalMs += habitatLevelUpDurationMs(habitatLevel)
    }

    const totalDays = totalMs / 86_400_000
    expect(totalDays).toBeGreaterThanOrEqual(60)
    expect(totalDays).toBeLessThanOrEqual(90)
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
