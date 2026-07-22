import { describe, expect, it } from 'vitest'
import {
  pirateBossFirstSpawnMs,
  pirateDifficultyMultiplier,
  pirateEnemyReloadMultiplier,
  pirateAmmoCapacity,
  pirateAmmoPricePerUnit,
  pirateAverageRunPayoutEstimate,
  pirateCompletionBonus,
  pirateMaxPayoutForRun,
  pirateRepairRushGemCost,
  pirateNormalizeDifficulty,
  piratePowerLevel,
  pirateRecommendedDifficulty,
  PIRATE_BOSS_ABILITY_COOLDOWN_MAX_MS,
  PIRATE_BOSS_DAMAGE_MULT,
  PIRATE_DOUBLE_BOSS_DIFFICULTY,
  PIRATE_ENEMY_TIERS,
  PIRATE_RUN_DURATION_MS,
  PIRATE_REPAIR_RUSH_MS_PER_GEM,
  pirateInitialEnemyCount,
  pirateMaxConcurrentEnemies,
  pirateRollEnemyTier,
  pirateSeaMineDamageFraction,
  pirateSpawnBatchSize,
  pirateSpawnIntervalMs
} from '../../shared/utils/gamelogic/pirates'

const TEST_DIFFICULTY = 366

describe('pirate difficulty at tier 366', () => {
  it('keeps the opening survivable while preserving a late ramp', () => {
    const opening = pirateDifficultyMultiplier(0, TEST_DIFFICULTY)
    const minuteOne = pirateDifficultyMultiplier(60_000, TEST_DIFFICULTY)
    const endgame = pirateDifficultyMultiplier(PIRATE_RUN_DURATION_MS, TEST_DIFFICULTY)

    expect(opening.hpMult).toBeCloseTo(4.423, 3)
    expect(opening.dmgMult).toBeLessThan(1.4)
    expect(minuteOne.hpMult).toBeLessThan(4.8)
    expect(minuteOne.hpMult / opening.hpMult).toBeLessThan(1.08)
    expect(endgame.hpMult).toBeGreaterThan(6.5)
    expect(endgame.hpMult).toBeLessThan(7)
  })

  it('starts with a manageable fleet and delays the first boss', () => {
    expect(pirateInitialEnemyCount(TEST_DIFFICULTY)).toBe(3)
    expect(pirateMaxConcurrentEnemies(0, TEST_DIFFICULTY)).toBe(3)
    expect(pirateSpawnIntervalMs(0, TEST_DIFFICULTY)).toBeGreaterThanOrEqual(3800)
    expect(pirateBossFirstSpawnMs(TEST_DIFFICULTY)).toBeGreaterThanOrEqual(100_000)
  })

  it('does not unlock midgame tanks in the first minute', () => {
    const alwaysLastRoll = () => 0.999999
    expect(pirateRollEnemyTier(0, TEST_DIFFICULTY, alwaysLastRoll).id).toBe('sloop')
    expect(pirateRollEnemyTier(45_000, TEST_DIFFICULTY, alwaysLastRoll).id).toBe('sniper')
    expect(pirateRollEnemyTier(50_000, TEST_DIFFICULTY, alwaysLastRoll).id).toBe('sniper')
    expect(pirateRollEnemyTier(60_000, TEST_DIFFICULTY, alwaysLastRoll).id).toBe('ironclad')
  })
})

describe('pirate selectable difficulty and premium ammo', () => {
  it('keeps low difficulty completable while making its opening busier', () => {
    const upgradedPower = piratePowerLevel({
      levels: { hull: 5, speed: 5, defense: 5, ammoCapacity: 5, regen: 5 },
      cannonTierIds: ['longgun', 'longgun', 'longgun', 'longgun'],
      cannonSlots: 4
    })
    const endgame = pirateDifficultyMultiplier(PIRATE_RUN_DURATION_MS, 0)

    expect(upgradedPower).toBeGreaterThanOrEqual(100)
    expect(upgradedPower).toBeLessThanOrEqual(200)
    expect(endgame.hpMult).toBeLessThan(1.55)
    expect(endgame.dmgMult).toBeLessThan(1.55)
    expect(pirateEnemyReloadMultiplier(PIRATE_RUN_DURATION_MS, 0)).toBeCloseTo(0.84)
    expect(pirateSpawnIntervalMs(0, 0)).toBeLessThan(6500)
    expect(pirateSpawnIntervalMs(PIRATE_RUN_DURATION_MS, 0)).toBeGreaterThanOrEqual(1600)
    expect(pirateMaxConcurrentEnemies(PIRATE_RUN_DURATION_MS, 0)).toBeLessThanOrEqual(6)
    expect(pirateSpawnBatchSize(PIRATE_RUN_DURATION_MS, 0, () => 0)).toBe(3)
    expect(pirateSeaMineDamageFraction(PIRATE_RUN_DURATION_MS)).toBeCloseTo(0.3)
    expect(PIRATE_DOUBLE_BOSS_DIFFICULTY).toBe(600)
  })

  it('keeps mid-tier pressure within reach of a 100–200 power surplus', () => {
    const difficulty = 350
    const upgradedPower = piratePowerLevel({
      levels: { hull: 5, speed: 5, defense: 5, ammoCapacity: 5, regen: 5 },
      cannonTierIds: ['leviathan', 'leviathan', 'leviathan', 'leviathan'],
      cannonSlots: 4
    })

    expect(upgradedPower - difficulty).toBeGreaterThanOrEqual(100)
    expect(upgradedPower - difficulty).toBeLessThanOrEqual(200)
    expect(pirateDifficultyMultiplier(PIRATE_RUN_DURATION_MS, difficulty).hpMult).toBeLessThan(6.5)
    expect(pirateSpawnIntervalMs(PIRATE_RUN_DURATION_MS, difficulty)).toBeGreaterThanOrEqual(1250)
    expect(pirateMaxConcurrentEnemies(PIRATE_RUN_DURATION_MS, difficulty)).toBeLessThanOrEqual(8)
  })

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

  it('compresses the voyage to six minutes without reducing full-run rewards', () => {
    expect(PIRATE_RUN_DURATION_MS).toBe(6 * 60_000)
    expect(pirateAverageRunPayoutEstimate(0)).toBe(144_000)
    expect(pirateMaxPayoutForRun(PIRATE_RUN_DURATION_MS, 0)).toBe(259_200)
    expect(pirateCompletionBonus(0)).toBe(57_600)
  })

  it('charges one gem per started ten minutes to rush dry-dock repairs', () => {
    expect(pirateRepairRushGemCost(0)).toBe(0)
    expect(pirateRepairRushGemCost(1)).toBe(1)
    expect(pirateRepairRushGemCost(PIRATE_REPAIR_RUSH_MS_PER_GEM)).toBe(1)
    expect(pirateRepairRushGemCost(PIRATE_REPAIR_RUSH_MS_PER_GEM + 1)).toBe(2)
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
