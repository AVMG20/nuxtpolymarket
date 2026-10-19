import { describe, expect, it } from 'vitest'
import {
  HACKERZ_DIFFICULTY_FULL_WAVE,
  HACKERZ_MAX_WAVE,
  hackerzDifficulty,
  hackerzWaveEnemyDamage,
  hackerzWaveEnemyHp,
  hackerzWaveReward
} from '#shared/utils/gamelogic/hackerz'

describe('hackerz difficulty ramp', () => {
  const zeroday = hackerzDifficulty('zeroday')
  const breach = hackerzDifficulty('breach')
  const probe = hackerzDifficulty('probe')

  it('fights a hard rung at Breach strength on wave one', () => {
    expect(hackerzWaveEnemyHp(zeroday, 1)).toBe(1)
    expect(hackerzWaveEnemyDamage(zeroday, 1)).toBe(1)
    expect(hackerzWaveReward(zeroday, 1)).toBe(breach.reward)
  })

  it('reaches full strength at the full wave and holds it to the end', () => {
    for (const wave of [HACKERZ_DIFFICULTY_FULL_WAVE, HACKERZ_MAX_WAVE]) {
      expect(hackerzWaveEnemyHp(zeroday, wave)).toBe(zeroday.enemyHp)
      expect(hackerzWaveEnemyDamage(zeroday, wave)).toBe(zeroday.enemyDamage)
      expect(hackerzWaveReward(zeroday, wave)).toBe(zeroday.reward)
    }
  })

  it('climbs every wave in between', () => {
    for (let wave = 2; wave <= HACKERZ_DIFFICULTY_FULL_WAVE; wave++) {
      expect(hackerzWaveEnemyHp(zeroday, wave)).toBeGreaterThan(hackerzWaveEnemyHp(zeroday, wave - 1))
      expect(hackerzWaveReward(zeroday, wave)).toBeGreaterThan(hackerzWaveReward(zeroday, wave - 1))
    }
  })

  it('leaves the soft and standard rungs as they were', () => {
    for (const wave of [1, 12, HACKERZ_MAX_WAVE]) {
      expect(hackerzWaveEnemyHp(probe, wave)).toBe(probe.enemyHp)
      expect(hackerzWaveReward(probe, wave)).toBe(probe.reward)
      expect(hackerzWaveEnemyHp(breach, wave)).toBe(breach.enemyHp)
      expect(hackerzWaveReward(breach, wave)).toBe(breach.reward)
    }
  })
})
