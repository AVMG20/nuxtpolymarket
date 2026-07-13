import { describe, expect, it } from 'vitest'
import {
  pirateBossFirstSpawnMs,
  pirateDifficultyMultiplier,
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

    expect(opening.hpMult).toBeCloseTo(2.974, 3)
    expect(opening.dmgMult).toBeLessThan(1.4)
    expect(minuteOne.hpMult).toBeLessThan(3.5)
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
