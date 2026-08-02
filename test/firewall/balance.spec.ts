import { describe, expect, it } from 'vitest'
import {
  FIREWALL_DIFFICULTIES,
  FIREWALL_MAINFRAME,
  FIREWALL_MAX_SLOTS,
  FIREWALL_MAX_WAVE,
  FIREWALL_RUN_COOLDOWN_MS,
  FIREWALL_COOLDOWN_RUSH_MS_PER_GEM,
  FIREWALL_TURRETS,
  FIREWALL_TYPE_BONUS,
  FIREWALL_UPGRADES,
  FIREWALL_WEAPONS,
  firewallCoinValue,
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
  firewallFreshBuild,
  firewallGearedBuild,
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

  it('covers both types across weapons and turrets', () => {
    for (const types of [FIREWALL_WEAPONS.map(w => w.damageType), FIREWALL_TURRETS.map(t => t.damageType)]) {
      expect(types).toContain('kinetic')
      expect(types).toContain('energy')
    }
  })
})

describe('shop shape', () => {
  it('offers exactly four ways to upgrade the gun', () => {
    expect(FIREWALL_UPGRADES.filter(u => u.tab === 'rail')).toHaveLength(4)
  })

  it('has no in-run credit-rate upgrade — that moved to the Mainframe', () => {
    expect(FIREWALL_UPGRADES.some(u => u.id === ('bounty' as never))).toBe(false)
    expect(FIREWALL_MAINFRAME.some(m => m.id === 'salvage')).toBe(true)
  })

  it('gates weapons and turrets behind waves, in ascending price order', () => {
    const purchasable = FIREWALL_WEAPONS.filter(w => w.cost > 0)
    for (let i = 1; i < purchasable.length; i++) {
      expect(purchasable[i]!.cost).toBeGreaterThan(purchasable[i - 1]!.cost)
      expect(purchasable[i]!.unlockWave).toBeGreaterThan(purchasable[i - 1]!.unlockWave)
    }
    for (let i = 1; i < FIREWALL_TURRETS.length; i++) {
      expect(FIREWALL_TURRETS[i]!.cost).toBeGreaterThan(FIREWALL_TURRETS[i - 1]!.cost)
      expect(FIREWALL_TURRETS[i]!.unlockWave).toBeGreaterThan(FIREWALL_TURRETS[i - 1]!.unlockWave)
    }
  })

  it('prices the last turret as a real commitment against the first', () => {
    const [first] = FIREWALL_TURRETS
    const last = FIREWALL_TURRETS[FIREWALL_TURRETS.length - 1]!
    expect(last.cost / first!.cost).toBeGreaterThanOrEqual(10)
  })

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
  it('starts at a 100k price tag and reaches the ten-billion tier', () => {
    const opening = FIREWALL_MAINFRAME.map(def => firewallMainframeCost(def, 0) ?? 0)
    expect(Math.min(...opening)).toBe(100_000)

    const topLevels = FIREWALL_MAINFRAME.map(def => firewallMainframeCost(def, def.max - 1) ?? 0)
    expect(Math.max(...topLevels)).toBeGreaterThanOrEqual(10_000_000_000)
  })

  it('returns null once maxed rather than an ever-growing price', () => {
    for (const def of FIREWALL_MAINFRAME) {
      expect(firewallMainframeCost(def, def.max)).toBeNull()
      expect(firewallMainframeCost(def, def.max - 1)).toBeGreaterThan(0)
    }
  })

  it('raises base values without touching the in-run ceiling', () => {
    const none = firewallMainframeEffects({
      bulwark: 0, munitions: 0, foundry: 0, grant: 0, salvage: 0, capacitor: 0, charter: 0, arsenal: 0
    })
    const maxed = firewallMaxBuild().mainframe
    const full = firewallMainframeEffects(maxed)
    expect(none.wallHp).toBe(1)
    expect(none.weaponDamage).toBe(1)
    // Deliberately modest: the Mainframe is how you reach a harder difficulty,
    // not how you skip the run you are on.
    expect(full.weaponDamage).toBeLessThanOrEqual(2)
    expect(full.turretDamage).toBeLessThanOrEqual(2)
    expect(full.wallHp).toBeLessThanOrEqual(2)
  })

  it('lifts weapon wave gates one weapon at a time', () => {
    const sniper = FIREWALL_WEAPONS[4]!
    expect(firewallWeaponUnlockWave(sniper, 0)).toBe(sniper.unlockWave)
    expect(firewallWeaponUnlockWave(sniper, 3)).toBe(sniper.unlockWave)
    expect(firewallWeaponUnlockWave(sniper, 4)).toBe(1)
  })
})

describe('difficulties', () => {
  it('offers five, ordered by both danger and reward', () => {
    expect(FIREWALL_DIFFICULTIES).toHaveLength(5)
    for (let i = 1; i < FIREWALL_DIFFICULTIES.length; i++) {
      const previous = FIREWALL_DIFFICULTIES[i - 1]!
      const current = FIREWALL_DIFFICULTIES[i]!
      expect(current.enemyHp).toBeGreaterThan(previous.enemyHp)
      expect(current.reward).toBeGreaterThan(previous.reward)
      expect(current.requiredBestWave).toBeGreaterThanOrEqual(previous.requiredBestWave)
    }
  })

  it('leaves the two lowest ungated so a new account can always play', () => {
    expect(FIREWALL_DIFFICULTIES[0]!.requiredBestWave).toBe(0)
    expect(FIREWALL_DIFFICULTIES[1]!.requiredBestWave).toBe(0)
  })
})

describe('run depth', () => {
  it('ends a fully-invested Zero Day run inside the 20-30 wave band', () => {
    // The headline balance target: everything bought, hardest difficulty, and
    // the run still has to end. An infinite game is an infinite payout.
    const run = firewallSimulateRun(firewallMaxBuild(), 'zeroday')
    expect(run.endedWave).toBeGreaterThanOrEqual(20)
    expect(run.endedWave).toBeLessThanOrEqual(FIREWALL_MAX_WAVE)
  })

  it('can never run past the wave cap on any difficulty', () => {
    for (const difficulty of FIREWALL_DIFFICULTIES) {
      const run = firewallSimulateRun(firewallMaxBuild(), difficulty.id)
      expect(run.endedWave).toBeLessThanOrEqual(FIREWALL_MAX_WAVE)
      expect(run.waves.length).toBeLessThanOrEqual(FIREWALL_MAX_WAVE)
    }
  })

  it('gives a bare account a real run on the opening difficulties', () => {
    const run = firewallSimulateRun(firewallFreshBuild(), 'breach', { autoUpgrade: true })
    expect(run.endedWave).toBeGreaterThanOrEqual(8)
    expect(run.endedWave).toBeLessThan(FIREWALL_MAX_WAVE)
  })

  it('makes a bare account lose badly on a difficulty it has not invested for', () => {
    const fresh = firewallSimulateRun(firewallFreshBuild(), 'zeroday', { autoUpgrade: true })
    const geared = firewallSimulateRun(firewallGearedBuild(), 'zeroday', { autoUpgrade: true })
    expect(fresh.endedWave).toBeLessThan(8)
    expect(geared.endedWave).toBeGreaterThan(fresh.endedWave)
  })
})

describe('coin economy', () => {
  it('pays deeper waves disproportionately more than early ones', () => {
    const difficulty = firewallDifficulty('breach')
    const early = firewallCoinValue(100, 2, difficulty, 1)
    const late = firewallCoinValue(100, 20, difficulty, 1)
    // Superlinear on purpose: without it the best play on a high difficulty is
    // to farm wave three forever.
    expect(late / early).toBeGreaterThan(10)
  })

  it('makes climbing the ladder the way to earn more', () => {
    const byDifficulty = FIREWALL_DIFFICULTIES.map(d => firewallSimulateRun(firewallMaxBuild(), d.id).coins)
    for (let i = 1; i < byDifficulty.length; i++) {
      expect(byDifficulty[i]!).toBeGreaterThan(byDifficulty[i - 1]!)
    }
  })

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

