import { describe, expect, it } from 'vitest'
import {
  HACKERZ_DIFFICULTIES,
  HACKERZ_MAINFRAME,
  HACKERZ_MAX_SLOTS,
  HACKERZ_MAX_WAVE,
  HACKERZ_RUN_COOLDOWN_MS,
  HACKERZ_COOLDOWN_RUSH_MS_PER_GEM,
  HACKERZ_TURRETS,
  HACKERZ_TYPE_BONUS,
  HACKERZ_UPGRADES,
  HACKERZ_WEAPONS,
  hackerzCoinValue,
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
  hackerzFreshBuild,
  hackerzGearedBuild,
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

  it('covers both types across weapons and turrets', () => {
    for (const types of [HACKERZ_WEAPONS.map(w => w.damageType), HACKERZ_TURRETS.map(t => t.damageType)]) {
      expect(types).toContain('kinetic')
      expect(types).toContain('energy')
    }
  })
})

describe('shop shape', () => {
  it('offers exactly four ways to upgrade the gun', () => {
    expect(HACKERZ_UPGRADES.filter(u => u.tab === 'rail')).toHaveLength(4)
  })

  it('has no in-run credit-rate upgrade — that moved to the Mainframe', () => {
    expect(HACKERZ_UPGRADES.some(u => u.id === ('bounty' as never))).toBe(false)
    expect(HACKERZ_MAINFRAME.some(m => m.id === 'salvage')).toBe(true)
  })

  it('gates weapons and turrets behind waves, in ascending price order', () => {
    const purchasable = HACKERZ_WEAPONS.filter(w => w.cost > 0)
    for (let i = 1; i < purchasable.length; i++) {
      expect(purchasable[i]!.cost).toBeGreaterThan(purchasable[i - 1]!.cost)
      expect(purchasable[i]!.unlockWave).toBeGreaterThan(purchasable[i - 1]!.unlockWave)
    }
    for (let i = 1; i < HACKERZ_TURRETS.length; i++) {
      expect(HACKERZ_TURRETS[i]!.cost).toBeGreaterThan(HACKERZ_TURRETS[i - 1]!.cost)
      expect(HACKERZ_TURRETS[i]!.unlockWave).toBeGreaterThan(HACKERZ_TURRETS[i - 1]!.unlockWave)
    }
  })

  it('prices the last turret as a real commitment against the first', () => {
    const [first] = HACKERZ_TURRETS
    const last = HACKERZ_TURRETS[HACKERZ_TURRETS.length - 1]!
    expect(last.cost / first!.cost).toBeGreaterThanOrEqual(10)
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
  it('opens in the tens of thousands and tops out in the tens of millions', () => {
    const opening = HACKERZ_MAINFRAME.map(def => hackerzMainframeCost(def, 0) ?? 0)
    expect(Math.min(...opening)).toBe(20_000)

    // The whole tree is a few hundred million — roughly three hundred endgame
    // runs, and in the same bracket as the Pirate Raid armoury. It used to run
    // to 167 billion, which no account could reach in any number of runs.
    const topLevels = HACKERZ_MAINFRAME.map(def => hackerzMainframeCost(def, def.max - 1) ?? 0)
    expect(Math.max(...topLevels)).toBeGreaterThan(50_000_000)
    expect(Math.max(...topLevels)).toBeLessThan(150_000_000)

    let tree = 0
    for (const def of HACKERZ_MAINFRAME) {
      for (let level = 0; level < def.max; level++) tree += hackerzMainframeCost(def, level) ?? 0
    }
    expect(tree).toBeGreaterThan(300_000_000)
    expect(tree).toBeLessThan(800_000_000)
  })

  it('returns null once maxed rather than an ever-growing price', () => {
    for (const def of HACKERZ_MAINFRAME) {
      expect(hackerzMainframeCost(def, def.max)).toBeNull()
      expect(hackerzMainframeCost(def, def.max - 1)).toBeGreaterThan(0)
    }
  })

  it('raises base values without touching the in-run ceiling', () => {
    const none = hackerzMainframeEffects({
      bulwark: 0, munitions: 0, foundry: 0, grant: 0, salvage: 0, capacitor: 0, charter: 0, arsenal: 0
    })
    const maxed = hackerzMaxBuild().mainframe
    const full = hackerzMainframeEffects(maxed)
    expect(none.wallHp).toBe(1)
    expect(none.weaponDamage).toBe(1)
    // Deliberately modest: the Mainframe is how you reach a harder difficulty,
    // not how you skip the run you are on.
    expect(full.weaponDamage).toBeLessThanOrEqual(2)
    expect(full.turretDamage).toBeLessThanOrEqual(2)
    expect(full.wallHp).toBeLessThanOrEqual(2)
  })

  it('lifts weapon wave gates one weapon at a time', () => {
    const sniper = HACKERZ_WEAPONS[4]!
    expect(hackerzWeaponUnlockWave(sniper, 0)).toBe(sniper.unlockWave)
    expect(hackerzWeaponUnlockWave(sniper, 3)).toBe(sniper.unlockWave)
    expect(hackerzWeaponUnlockWave(sniper, 4)).toBe(1)
  })
})

describe('difficulties', () => {
  it('offers five, ordered by both danger and reward', () => {
    expect(HACKERZ_DIFFICULTIES).toHaveLength(5)
    for (let i = 1; i < HACKERZ_DIFFICULTIES.length; i++) {
      const previous = HACKERZ_DIFFICULTIES[i - 1]!
      const current = HACKERZ_DIFFICULTIES[i]!
      expect(current.enemyHp).toBeGreaterThan(previous.enemyHp)
      expect(current.reward).toBeGreaterThan(previous.reward)
      expect(current.requiredBestWave).toBeGreaterThanOrEqual(previous.requiredBestWave)
    }
  })

  it('leaves the two lowest ungated so a new account can always play', () => {
    expect(HACKERZ_DIFFICULTIES[0]!.requiredBestWave).toBe(0)
    expect(HACKERZ_DIFFICULTIES[1]!.requiredBestWave).toBe(0)
  })
})

describe('run depth', () => {
  it('ends a fully-invested Zero Day run inside the 20-30 wave band', () => {
    // The headline balance target: everything bought, hardest difficulty, and
    // the run still has to end. An infinite game is an infinite payout.
    const run = hackerzSimulateRun(hackerzMaxBuild(), 'zeroday')
    expect(run.endedWave).toBeGreaterThanOrEqual(20)
    expect(run.endedWave).toBeLessThanOrEqual(HACKERZ_MAX_WAVE)
  })

  it('can never run past the wave cap on any difficulty', () => {
    for (const difficulty of HACKERZ_DIFFICULTIES) {
      const run = hackerzSimulateRun(hackerzMaxBuild(), difficulty.id)
      expect(run.endedWave).toBeLessThanOrEqual(HACKERZ_MAX_WAVE)
      expect(run.waves.length).toBeLessThanOrEqual(HACKERZ_MAX_WAVE)
    }
  })

  it('gives a bare account a real run on the opening difficulties', () => {
    const run = hackerzSimulateRun(hackerzFreshBuild(), 'breach', { autoUpgrade: true })
    expect(run.endedWave).toBeGreaterThanOrEqual(8)
    expect(run.endedWave).toBeLessThan(HACKERZ_MAX_WAVE)
  })

  it('makes a bare account lose badly on a difficulty it has not invested for', () => {
    const fresh = hackerzSimulateRun(hackerzFreshBuild(), 'zeroday', { autoUpgrade: true })
    const geared = hackerzSimulateRun(hackerzGearedBuild(), 'zeroday', { autoUpgrade: true })
    expect(fresh.endedWave).toBeLessThan(8)
    expect(geared.endedWave).toBeGreaterThan(fresh.endedWave)
  })
})

describe('coin economy', () => {
  it('pays deeper waves disproportionately more than early ones', () => {
    const difficulty = hackerzDifficulty('breach')
    const early = hackerzCoinValue(100, 2, difficulty, 1)
    const late = hackerzCoinValue(100, 20, difficulty, 1)
    // Superlinear on purpose: without it the best play on a high difficulty is
    // to farm wave three forever.
    expect(late / early).toBeGreaterThan(10)
  })

  it('makes climbing the ladder the way to earn more', () => {
    const byDifficulty = HACKERZ_DIFFICULTIES.map(d => hackerzSimulateRun(hackerzMaxBuild(), d.id).coins)
    for (let i = 1; i < byDifficulty.length; i++) {
      expect(byDifficulty[i]!).toBeGreaterThan(byDifficulty[i - 1]!)
    }
  })

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

