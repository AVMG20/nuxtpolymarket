import { describe, expect, it } from 'vitest'
import {
  pirateBossFirstSpawnMs,
  pirateDifficultyMultiplier,
  pirateAmmoCapacity,
  pirateAmmoPricePerUnit,
  pirateAverageRunPayoutEstimate,
  pirateNormalizeDifficulty,
  pirateRecommendedDifficulty,
  PIRATE_BOSS_ABILITY_COOLDOWN_MAX_MS,
  PIRATE_BOSS_DAMAGE_MULT,
  PIRATE_ENEMY_TIERS,
  pirateInitialEnemyCount,
  pirateMaxConcurrentEnemies,
  pirateRollEnemyTier,
  pirateSpawnIntervalMs
} from '../../shared/utils/gamelogic/pirates'

const TEST_POWER = 366

describe('pirate difficulty at power 366', () => {
  it('keeps the opening survivable while preserving a late ramp', () => {
    const opening = pirateDifficultyMultiplier(0, TEST_POWER)
    const minuteOne = pirateDifficultyMultiplier(60_000, TEST_POWER)
    const endgame = pirateDifficultyMultiplier(8 * 60_000, TEST_POWER)

    expect(opening.hpMult).toBeCloseTo(4.423, 3)
    expect(opening.dmgMult).toBeLessThan(1.4)
    expect(minuteOne.hpMult).toBeLessThan(4.8)
    expect(minuteOne.hpMult / opening.hpMult).toBeLessThan(1.08)
    expect(endgame.hpMult).toBeGreaterThan(9)
  })

  it('starts with a manageable fleet and delays the first boss', () => {
    expect(pirateInitialEnemyCount(TEST_POWER)).toBe(3)
    expect(pirateMaxConcurrentEnemies(0, TEST_POWER)).toBe(4)
    expect(pirateSpawnIntervalMs(0, TEST_POWER)).toBeGreaterThanOrEqual(5000)
    expect(pirateBossFirstSpawnMs(TEST_POWER)).toBeGreaterThanOrEqual(135_000)
  })

  it('does not unlock midgame tanks in the first minute', () => {
    const alwaysLastRoll = () => 0.999999
    expect(pirateRollEnemyTier(0, TEST_POWER, alwaysLastRoll).id).toBe('sloop')
    expect(pirateRollEnemyTier(60_000, TEST_POWER, alwaysLastRoll).id).toBe('sniper')
    expect(pirateRollEnemyTier(75_000, TEST_POWER, alwaysLastRoll).id).toBe('ironclad')
  })
})

describe('pirate selectable difficulty and premium ammo', () => {
  it('advances recommendations in 50-point completed tiers', () => {
    expect(pirateRecommendedDifficulty(-50)).toBe(0)
    expect(pirateRecommendedDifficulty(0)).toBe(50)
    expect(pirateRecommendedDifficulty(350)).toBe(400)
    expect(pirateNormalizeDifficulty(374)).toBe(350)
  })

  it('makes higher tiers visibly more profitable', () => {
    expect(pirateAverageRunPayoutEstimate(50)).toBeGreaterThan(pirateAverageRunPayoutEstimate(0))
    expect(pirateAverageRunPayoutEstimate(350)).toBeGreaterThan(pirateAverageRunPayoutEstimate(50) * 4)
  })

  it('doubles magazine capacity and cuts premium prices by 75 percent', () => {
    expect(pirateAmmoCapacity(1)).toBe(240)
    expect(pirateAmmoCapacity(10)).toBe(1050)
    expect(pirateAmmoPricePerUnit(366)).toBe(196)
  })
})

describe('pirate boss balance', () => {
  it('is kiteable and less durable while using specials frequently', () => {
    const boss = PIRATE_ENEMY_TIERS.find(tier => tier.boss)!
    expect(boss.hp).toBe(560)
    expect(boss.range).toBe(310)
    expect(boss.maxDamage).toBe(32)
    expect(PIRATE_BOSS_DAMAGE_MULT).toBe(0.3)
    expect(PIRATE_BOSS_ABILITY_COOLDOWN_MAX_MS).toBeLessThan(6000)
  })
})
