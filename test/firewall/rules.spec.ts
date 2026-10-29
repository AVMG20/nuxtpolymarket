import { describe, expect, it } from 'vitest'
import {
  FIREWALL_DIFFICULTIES,
  FIREWALL_MAINFRAME,
  FIREWALL_MAX_SLOTS,
  FIREWALL_MAX_WAVE,
  FIREWALL_RUN_COOLDOWN_MS,
  FIREWALL_COOLDOWN_RUSH_MS_PER_GEM,
  FIREWALL_TYPE_BONUS,
  FIREWALL_UPGRADES,
  FIREWALL_WEAPONS,
  firewallCooldownRushCost,
  firewallDifficulty,
  firewallMainframeCost,
  firewallMainframeEffects,
  firewallMaxPayout,
  firewallPayoutForRun,
  firewallRunCooldownRemainingMs,
  firewallSlots,
  firewallTypeMultiplier,
  firewallUpgradeCost,
  firewallWeaponUnlockWave,
  type FirewallDifficultyId
} from '#shared/utils/gamelogic/firewall'
import {
  firewallMaxBuild,
  firewallSimulateRun
} from '#shared/utils/gamelogic/firewall-sim'

describe('damage types', () => {
  it('pays a bonus for the right type and never a penalty for the wrong one', () => {
    // The entire point of replacing flat armour reduction: a mismatched weapon
    // is worse than the right one, but it is never worse than it was.
    expect(firewallTypeMultiplier('kinetic', true)).toBe(1 + FIREWALL_TYPE_BONUS)
    expect(firewallTypeMultiplier('energy', false)).toBe(1 + FIREWALL_TYPE_BONUS)
    expect(firewallTypeMultiplier('energy', true)).toBe(1)
    expect(firewallTypeMultiplier('kinetic', false)).toBe(1)
  })
})

describe('shop shape', () => {
  it('never lets an upgrade level get cheaper than the one before it', () => {
    for (const def of FIREWALL_UPGRADES) {
      for (let level = 1; level < def.max; level++) {
        expect(firewallUpgradeCost(def, level)).toBeGreaterThan(firewallUpgradeCost(def, level - 1))
      }
    }
  })
})

describe('mounts', () => {
  it('caps total mounts at what the tower geometry can hold', () => {
    expect(firewallSlots(6, 4)).toBe(FIREWALL_MAX_SLOTS)
    expect(firewallSlots(0, 0)).toBe(2)
  })
})

describe('the Mainframe', () => {
  it('returns null once maxed rather than an ever-growing price', () => {
    for (const def of FIREWALL_MAINFRAME) {
      expect(firewallMainframeCost(def, def.max)).toBeNull()
      expect(firewallMainframeCost(def, def.max - 1)).toBeGreaterThan(0)
    }
  })

  it('lifts weapon wave gates one weapon at a time', () => {
    const sniper = FIREWALL_WEAPONS[4]!
    expect(firewallWeaponUnlockWave(sniper, 0)).toBe(sniper.unlockWave)
    expect(firewallWeaponUnlockWave(sniper, 3)).toBe(sniper.unlockWave)
    expect(firewallWeaponUnlockWave(sniper, 4)).toBe(1)
  })
})

describe('difficulties', () => {
  it('leaves the two lowest ungated so a new account can always play', () => {
    expect(FIREWALL_DIFFICULTIES[0]!.requiredBestWave).toBe(0)
    expect(FIREWALL_DIFFICULTIES[1]!.requiredBestWave).toBe(0)
  })
})

describe('run depth', () => {
  it('can never run past the wave cap on any difficulty', () => {
    for (const difficulty of FIREWALL_DIFFICULTIES) {
      const run = firewallSimulateRun(firewallMaxBuild(), difficulty.id)
      expect(run.endedWave).toBeLessThanOrEqual(FIREWALL_MAX_WAVE)
      expect(run.waves.length).toBeLessThanOrEqual(FIREWALL_MAX_WAVE)
    }
  })
})

describe('coin economy', () => {
  it('leaves honest play well clear of the anti-cheat ceiling', () => {
    for (const difficulty of FIREWALL_DIFFICULTIES) {
      const run = firewallSimulateRun(firewallMaxBuild(), difficulty.id)
      const ceiling = firewallMaxPayout(run.endedWave, difficulty, firewallMainframeEffects(firewallMaxBuild().mainframe).coins)
      expect(ceiling).toBeGreaterThan(run.coins * 1.5)
    }
  })

  it('clamps a forged coin total to the depth the run actually reached', () => {
    const difficulty = firewallDifficulty('zeroday')
    const honest = firewallPayoutForRun(5_000, 3, difficulty, 1)
    expect(honest).toBe(5_000)
    // A run that only ever reached wave three cannot pay a wave-thirty purse.
    expect(firewallPayoutForRun(1e15, 3, difficulty, 1)).toBe(firewallMaxPayout(3, difficulty, 1))
    expect(firewallPayoutForRun(1e15, 3, difficulty, 1))
      .toBeLessThan(firewallMaxPayout(FIREWALL_MAX_WAVE, difficulty, 1))
  })

  it('never pays for a run that reached no waves', () => {
    for (const id of FIREWALL_DIFFICULTIES.map(d => d.id as FirewallDifficultyId)) {
      expect(firewallPayoutForRun(999_999, 0, firewallDifficulty(id), 1)).toBe(0)
    }
  })
})

describe('FIREWALL uplink cooldown', () => {
  it('charges one gem per started ten minutes to rush uplink recharge', () => {
    expect(firewallCooldownRushCost(0)).toBe(0)
    expect(firewallCooldownRushCost(1)).toBe(1)
    expect(firewallCooldownRushCost(FIREWALL_COOLDOWN_RUSH_MS_PER_GEM)).toBe(1)
    expect(firewallCooldownRushCost(FIREWALL_COOLDOWN_RUSH_MS_PER_GEM + 1)).toBe(2)
    expect(firewallCooldownRushCost(FIREWALL_RUN_COOLDOWN_MS)).toBe(12)
  })

  it('locks the uplink for 2 hours after a settled run', () => {
    expect(FIREWALL_RUN_COOLDOWN_MS).toBe(2 * 60 * 60 * 1000)
    const finishedAt = new Date('2026-08-02T12:00:00Z')
    expect(firewallRunCooldownRemainingMs(finishedAt, finishedAt.getTime())).toBe(FIREWALL_RUN_COOLDOWN_MS)
    expect(firewallRunCooldownRemainingMs(finishedAt, finishedAt.getTime() + 30 * 60 * 1000)).toBe(90 * 60 * 1000)
  })

  it('is fully open once the cooldown elapses or when no run ever finished', () => {
    const finishedAt = new Date('2026-08-02T12:00:00Z')
    expect(firewallRunCooldownRemainingMs(finishedAt, finishedAt.getTime() + FIREWALL_RUN_COOLDOWN_MS)).toBe(0)
    expect(firewallRunCooldownRemainingMs(finishedAt, finishedAt.getTime() + FIREWALL_RUN_COOLDOWN_MS + 1)).toBe(0)
    expect(firewallRunCooldownRemainingMs(null, Date.now())).toBe(0)
  })
})

