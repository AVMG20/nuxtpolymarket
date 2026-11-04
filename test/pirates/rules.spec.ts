import { describe, expect, it } from 'vitest'
import {
  pirateSurvivalCoins,
  pirateSurvivalCoinRate,
  pirateRollBoss,
  pirateRollPowerUp,
  PIRATE_POWER_UPS,
  pirateRepairRushGemCost,
  pirateNormalizeDifficulty,
  pirateRecommendedDifficulty,
  PIRATE_RUN_DURATION_MS,
  PIRATE_REPAIR_RUSH_MS_PER_GEM
} from '../../shared/utils/gamelogic/pirates'

describe('pirate difficulty, pay and repairs', () => {
  it('advances recommendations in 50-point completed tiers', () => {
    expect(pirateRecommendedDifficulty(-50)).toBe(0)
    expect(pirateRecommendedDifficulty(0)).toBe(50)
    expect(pirateRecommendedDifficulty(350)).toBe(400)
    expect(pirateNormalizeDifficulty(374)).toBe(350)
  })

  it('pays a rate every second that sums to the survival haul', () => {
    let summed = 0
    for (let ms = 0; ms < PIRATE_RUN_DURATION_MS; ms += 100) summed += pirateSurvivalCoinRate(ms + 50, 350) * 0.1
    expect(summed / pirateSurvivalCoins(PIRATE_RUN_DURATION_MS, 350)).toBeCloseTo(1, 2)
  })

  it('charges one gem per started ten minutes to rush dry-dock repairs', () => {
    expect(pirateRepairRushGemCost(0)).toBe(0)
    expect(pirateRepairRushGemCost(1)).toBe(1)
    expect(pirateRepairRushGemCost(PIRATE_REPAIR_RUSH_MS_PER_GEM)).toBe(1)
    expect(pirateRepairRushGemCost(PIRATE_REPAIR_RUSH_MS_PER_GEM + 1)).toBe(2)
  })
})

describe('pirate bosses and salvage', () => {
  it('only surfaces the Dreadnought early and never repeats a boss while there is a choice', () => {
    expect(pirateRollBoss(60_000, 0, null).id).toBe('dreadnought')
    for (let i = 0; i < 20; i++) expect(pirateRollBoss(PIRATE_RUN_DURATION_MS, 0, 'kraken').id).not.toBe('kraken')
  })

  it('rolls crates within their stack caps and honours the boss rarity floor', () => {
    const allMaxed = Object.fromEntries(PIRATE_POWER_UPS.map(p => [p.id, p.maxStacks]))
    expect(pirateRollPowerUp(allMaxed)).toBeNull()
    for (let i = 0; i < 30; i++) {
      const drop = pirateRollPowerUp({}, 'epic')!
      expect(['epic', 'legendary']).toContain(drop.rarity)
    }
    const onlyOak = { ...allMaxed, 'oak-planking': 0 }
    expect(pirateRollPowerUp(onlyOak, 'epic')!.id).toBe('oak-planking')
  })
})
