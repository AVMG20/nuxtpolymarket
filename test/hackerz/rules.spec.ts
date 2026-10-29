import { describe, expect, it } from 'vitest'
import {
  HACKERZ_DIFFICULTIES,
  HACKERZ_MAINFRAME,
  HACKERZ_MAX_SLOTS,
  HACKERZ_MAX_WAVE,
  HACKERZ_RUN_COOLDOWN_MS,
  HACKERZ_COOLDOWN_RUSH_MS_PER_GEM,
  HACKERZ_TYPE_BONUS,
  HACKERZ_UPGRADES,
  HACKERZ_WEAPONS,
  hackerzCooldownRushCost,
  hackerzDifficulty,
  hackerzMainframeCost,
  hackerzMainframeEffects,
  hackerzMaxPayout,
  hackerzPayoutForRun,
  hackerzRunCooldownRemainingMs,
  hackerzSlots,
  hackerzTypeMultiplier,
  hackerzUpgradeCost,
  hackerzWeaponUnlockWave,
  type HackerzDifficultyId
} from '#shared/utils/gamelogic/hackerz'
import {
  hackerzMaxBuild,
  hackerzSimulateRun
} from '#shared/utils/gamelogic/hackerz-sim'

describe('damage types', () => {
  it('pays a bonus for the right type and never a penalty for the wrong one', () => {
    // The entire point of replacing flat armour reduction: a mismatched weapon
    // is worse than the right one, but it is never worse than it was.
    expect(hackerzTypeMultiplier('kinetic', true)).toBe(1 + HACKERZ_TYPE_BONUS)
    expect(hackerzTypeMultiplier('energy', false)).toBe(1 + HACKERZ_TYPE_BONUS)
    expect(hackerzTypeMultiplier('energy', true)).toBe(1)
    expect(hackerzTypeMultiplier('kinetic', false)).toBe(1)
  })
})

describe('shop shape', () => {
  it('offers a gun\'s own upgrade only for that gun', () => {
    for (const def of HACKERZ_UPGRADES.filter(u => u.weapon)) {
      expect(def.tab).toBe('rail')
      expect(HACKERZ_WEAPONS.some(w => w.id === def.weapon)).toBe(true)
    }
  })

  it('never lets an upgrade level get cheaper than the one before it', () => {
    for (const def of HACKERZ_UPGRADES) {
      for (let level = 1; level < def.max; level++) {
        expect(hackerzUpgradeCost(def, level)).toBeGreaterThan(hackerzUpgradeCost(def, level - 1))
      }
    }
  })
})

describe('mounts', () => {
  it('caps total mounts at what the tower geometry can hold', () => {
    expect(hackerzSlots(6, 4)).toBe(HACKERZ_MAX_SLOTS)
    expect(hackerzSlots(0, 0)).toBe(2)
  })
})

describe('the Mainframe', () => {
  it('returns null once maxed rather than an ever-growing price', () => {
    for (const def of HACKERZ_MAINFRAME) {
      expect(hackerzMainframeCost(def, def.max)).toBeNull()
      expect(hackerzMainframeCost(def, def.max - 1)).toBeGreaterThan(0)
    }
  })

  it('lifts weapon wave gates one weapon at a time', () => {
    const sniper = HACKERZ_WEAPONS[4]!
    expect(hackerzWeaponUnlockWave(sniper, 0)).toBe(sniper.unlockWave)
    expect(hackerzWeaponUnlockWave(sniper, 3)).toBe(sniper.unlockWave)
    expect(hackerzWeaponUnlockWave(sniper, 4)).toBe(1)
  })
})

describe('difficulties', () => {
  it('leaves the two lowest ungated so a new account can always play', () => {
    expect(HACKERZ_DIFFICULTIES[0]!.requiredBestWave).toBe(0)
    expect(HACKERZ_DIFFICULTIES[1]!.requiredBestWave).toBe(0)
  })
})

describe('run depth', () => {
  it('can never run past the wave cap on any difficulty', () => {
    for (const difficulty of HACKERZ_DIFFICULTIES) {
      const run = hackerzSimulateRun(hackerzMaxBuild(), difficulty.id)
      expect(run.endedWave).toBeLessThanOrEqual(HACKERZ_MAX_WAVE)
      expect(run.waves.length).toBeLessThanOrEqual(HACKERZ_MAX_WAVE)
    }
  })
})

describe('coin economy', () => {
  it('leaves honest play well clear of the anti-cheat ceiling', () => {
    for (const difficulty of HACKERZ_DIFFICULTIES) {
      const run = hackerzSimulateRun(hackerzMaxBuild(), difficulty.id)
      const ceiling = hackerzMaxPayout(run.endedWave, difficulty, hackerzMainframeEffects(hackerzMaxBuild().mainframe).coins)
      expect(ceiling).toBeGreaterThan(run.coins * 1.5)
    }
  })

  it('clamps a forged coin total to the depth the run actually reached', () => {
    const difficulty = hackerzDifficulty('zeroday')
    const honest = hackerzPayoutForRun(5_000, 3, difficulty, 1)
    expect(honest).toBe(5_000)
    // A run that only ever reached wave three cannot pay a wave-thirty purse.
    expect(hackerzPayoutForRun(1e15, 3, difficulty, 1)).toBe(hackerzMaxPayout(3, difficulty, 1))
    expect(hackerzPayoutForRun(1e15, 3, difficulty, 1))
      .toBeLessThan(hackerzMaxPayout(HACKERZ_MAX_WAVE, difficulty, 1))
  })

  it('never pays for a run that reached no waves', () => {
    for (const id of HACKERZ_DIFFICULTIES.map(d => d.id as HackerzDifficultyId)) {
      expect(hackerzPayoutForRun(999_999, 0, hackerzDifficulty(id), 1)).toBe(0)
    }
  })
})

describe('HACKERZ uplink cooldown', () => {
  it('charges one gem per started ten minutes to rush uplink recharge', () => {
    expect(hackerzCooldownRushCost(0)).toBe(0)
    expect(hackerzCooldownRushCost(1)).toBe(1)
    expect(hackerzCooldownRushCost(HACKERZ_COOLDOWN_RUSH_MS_PER_GEM)).toBe(1)
    expect(hackerzCooldownRushCost(HACKERZ_COOLDOWN_RUSH_MS_PER_GEM + 1)).toBe(2)
    expect(hackerzCooldownRushCost(HACKERZ_RUN_COOLDOWN_MS)).toBe(12)
  })

  it('locks the uplink for 2 hours after a settled run', () => {
    expect(HACKERZ_RUN_COOLDOWN_MS).toBe(2 * 60 * 60 * 1000)
    const finishedAt = new Date('2026-08-02T12:00:00Z')
    expect(hackerzRunCooldownRemainingMs(finishedAt, finishedAt.getTime())).toBe(HACKERZ_RUN_COOLDOWN_MS)
    expect(hackerzRunCooldownRemainingMs(finishedAt, finishedAt.getTime() + 30 * 60 * 1000)).toBe(90 * 60 * 1000)
  })

  it('is fully open once the cooldown elapses or when no run ever finished', () => {
    const finishedAt = new Date('2026-08-02T12:00:00Z')
    expect(hackerzRunCooldownRemainingMs(finishedAt, finishedAt.getTime() + HACKERZ_RUN_COOLDOWN_MS)).toBe(0)
    expect(hackerzRunCooldownRemainingMs(finishedAt, finishedAt.getTime() + HACKERZ_RUN_COOLDOWN_MS + 1)).toBe(0)
    expect(hackerzRunCooldownRemainingMs(null, Date.now())).toBe(0)
  })
})

