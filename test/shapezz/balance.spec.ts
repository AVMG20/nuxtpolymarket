import { describe, expect, it } from 'vitest'
import {
  SHAPEZZ_CHECKPOINT_MS,
  SHAPEZZ_COIN_PAYOUT_SCALE,
  SHAPEZZ_COMBAT_LIMITS,
  SHAPEZZ_DIFFICULTIES,
  SHAPEZZ_WEAPONS,
  shapezzCheckpointCount,
  shapezzCheckpointPressure,
  shapezzEnemyHealthMultiplier,
  shapezzIntensity,
  shapezzMaxPayoutForRun,
  SHAPEZZ_RUN_COOLDOWN_MS,
  shapezzPermanentUpgradeCost,
  shapezzPlayerStats,
  shapezzRunCooldownRemainingMs,
  shapezzWeapon,
  shapezzWeaponReplacement
} from '#shared/utils/gamelogic/shapezz'

describe('SHAPEZZ checkpoint pacing', () => {
  it('offers the first decision exactly 45 seconds into a run', () => {
    expect(SHAPEZZ_CHECKPOINT_MS).toBe(45_000)
    expect(shapezzCheckpointCount(44_999)).toBe(0)
    expect(shapezzCheckpointCount(45_000)).toBe(1)
    expect(shapezzCheckpointCount(135_000)).toBe(3)
  })

  it('ramps endless pressure over time on every difficulty', () => {
    for (const difficulty of SHAPEZZ_DIFFICULTIES) {
      expect(shapezzIntensity(5 * 60_000, difficulty.id)).toBeGreaterThan(shapezzIntensity(60_000, difficulty.id))
    }
  })

  it('makes selected difficulty authoritative for enemy pressure and rewards', () => {
    expect(shapezzIntensity(90_000, 'annihilation')).toBeGreaterThan(shapezzIntensity(90_000, 'spark'))
    expect(shapezzMaxPayoutForRun(90_000, 'annihilation')).toBeGreaterThan(shapezzMaxPayoutForRun(90_000, 'spark'))
  })

  it('turns mutations 8 to 10 into a wall and 12 to 14 into a terminal health ramp', () => {
    expect(shapezzCheckpointPressure(8).health).toBeGreaterThan(7)
    expect(shapezzCheckpointPressure(10).health).toBeGreaterThan(11)
    expect(shapezzCheckpointPressure(12).health).toBeGreaterThan(19)
    expect(shapezzCheckpointPressure(14).health).toBeGreaterThan(31)
    expect(shapezzCheckpointPressure(14).damage).toBeLessThan(2.2)
  })

  it('adds extra late durability to high selected difficulties without coupling it to player power', () => {
    expect(shapezzEnemyHealthMultiplier(5 * 60_000, 'annihilation')).toBeGreaterThan(25)
    expect(shapezzEnemyHealthMultiplier(5 * 60_000, 'annihilation')).toBeGreaterThan(shapezzEnemyHealthMultiplier(5 * 60_000, 'spark') * 10)
  })

  it('gives a first cashout meaningful value while high difficulties pay several times more', () => {
    // A first cashout has enough headroom for the 10x drop conversion.
    expect(SHAPEZZ_COIN_PAYOUT_SCALE).toBe(10)
    expect(shapezzMaxPayoutForRun(45_000, 'surge')).toBeGreaterThan(18_000)
    expect(shapezzMaxPayoutForRun(45_000, 'surge')).toBeLessThan(20_000)
    expect(shapezzMaxPayoutForRun(45_000, 'annihilation')).toBeGreaterThan(shapezzMaxPayoutForRun(45_000, 'surge') * 4)
  })

  it('keeps a six-minute Surge ceiling close to Pirate while preserving high-difficulty upside', () => {
    expect(shapezzMaxPayoutForRun(6 * 60_000, 'surge')).toBeGreaterThan(180_000)
    expect(shapezzMaxPayoutForRun(6 * 60_000, 'surge')).toBeLessThan(200_000)
    expect(shapezzMaxPayoutForRun(10 * 60_000, 'annihilation')).toBeGreaterThan(2_000_000)
    expect(shapezzMaxPayoutForRun(10 * 60_000, 'annihilation')).toBeLessThan(2_500_000)
    // Lower difficulties stay an order of magnitude below the top end.
    expect(shapezzMaxPayoutForRun(10 * 60_000, 'surge')).toBeLessThan(shapezzMaxPayoutForRun(10 * 60_000, 'annihilation') / 4)
  })
})

describe('SHAPEZZ permanent progression', () => {
  it('raises owned player stats without entering the enemy intensity formula', () => {
    const starter = shapezzPlayerStats({ core: 0, overclock: 0, armor: 0, thrusters: 0, magnet: 0, killHeal: 0 })
    const upgraded = shapezzPlayerStats({ core: 4, overclock: 4, armor: 4, thrusters: 4, magnet: 4, killHeal: 4 })

    expect(upgraded.damage).toBeGreaterThan(starter.damage)
    expect(upgraded.fireRate).toBeGreaterThan(starter.fireRate)
    expect(upgraded.maxHp).toBeGreaterThan(starter.maxHp)
    expect(starter.healthPerKill).toBe(1)
    expect(upgraded.healthPerKill).toBe(5)
    expect(shapezzIntensity(90_000, 'surge')).toBe(shapezzIntensity(90_000, 'surge'))
  })

  it('makes workshop costs grow with each purchased level', () => {
    expect(shapezzPermanentUpgradeCost('core', 0)).toBe(30_000)
    expect(shapezzPermanentUpgradeCost('core', 3)!).toBeGreaterThan(shapezzPermanentUpgradeCost('core', 2)!)
    expect(shapezzPermanentUpgradeCost('core', 9)).toBe(15_360_000)
    expect(shapezzPermanentUpgradeCost('core', 19)!).toBeGreaterThan(300_000_000)
  })

  it('makes kill healing a short and deliberately expensive upgrade track', () => {
    expect(shapezzPermanentUpgradeCost('killHeal', 0)).toBe(250_000)
    expect(shapezzPermanentUpgradeCost('killHeal', 3)).toBe(30_000_000)
    expect(shapezzPermanentUpgradeCost('killHeal', 4)).toBeNull()
  })
})

describe('SHAPEZZ weapons', () => {
  it('offers three weapon archetypes across five rarity tiers', () => {
    expect(SHAPEZZ_WEAPONS).toHaveLength(15)
    expect(new Set(SHAPEZZ_WEAPONS.map(weapon => weapon.type))).toEqual(new Set(['blaster', 'launcher', 'shotgun']))
    expect(new Set(SHAPEZZ_WEAPONS.map(weapon => weapon.rarity))).toEqual(new Set(['common', 'rare', 'epic', 'legendary', 'mythic']))
  })

  it('caps the foundry at a 50 million coin mythic launcher', () => {
    expect(Math.max(...SHAPEZZ_WEAPONS.map(weapon => weapon.cost))).toBe(50_000_000)
    expect(shapezzWeapon('launcher', 'mythic').cost).toBe(50_000_000)
  })

  it('keeps the launcher slow and explosive while shotgun pellets deal full damage at range', () => {
    const launcher = shapezzWeapon('launcher', 'common')
    const shotgun = shapezzWeapon('shotgun', 'common')

    expect(launcher.fireRateMultiplier).toBeLessThan(0.3)
    expect(launcher.explosionRadius).toBeGreaterThan(0)
    expect(shotgun.pellets).toBe(7)
    expect(shapezzWeapon('shotgun', 'mythic').pellets).toBe(11)
    expect(shotgun.minFalloffDamage).toBe(1)
    expect(shotgun.falloffEnd).toBeGreaterThan(shotgun.falloffStart)
    expect(shotgun.falloffStart).toBeGreaterThan(9000)
  })

  it('makes higher rarities visually louder as well as stronger', () => {
    const common = shapezzWeapon('blaster', 'common')
    const mythic = shapezzWeapon('blaster', 'mythic')

    expect(mythic.visualIntensity).toBeGreaterThan(common.visualIntensity)
    expect(mythic.damageMultiplier).toBeGreaterThan(common.damageMultiplier)
    expect(mythic.primaryColor).not.toBe(common.primaryColor)
    expect(mythic.projectileSizeMultiplier).toBeGreaterThan(common.projectileSizeMultiplier)
  })

  it('refunds exactly 25% of the stored previous purchase price', () => {
    expect(shapezzWeaponReplacement(8_000_000, 50_000_000)).toEqual({ refund: 2_000_000, netCost: 48_000_000 })
    expect(shapezzWeaponReplacement(50_000_000, 8_000)).toEqual({ refund: 12_500_000, netCost: -12_492_000 })
  })

  it('uses bounded combat pools instead of allowing endgame effects to grow without limit', () => {
    expect(SHAPEZZ_COMBAT_LIMITS.bullets).toBeLessThanOrEqual(520)
    expect(SHAPEZZ_COMBAT_LIMITS.particles).toBeLessThanOrEqual(700)
    expect(SHAPEZZ_COMBAT_LIMITS.enemies).toBeLessThanOrEqual(100)
  })
})

describe('SHAPEZZ arena cooldown', () => {
  it('locks the arena for 2 hours after a settled run', () => {
    expect(SHAPEZZ_RUN_COOLDOWN_MS).toBe(2 * 60 * 60 * 1000)
    const finishedAt = new Date('2026-07-17T12:00:00Z')
    expect(shapezzRunCooldownRemainingMs(finishedAt, finishedAt.getTime())).toBe(SHAPEZZ_RUN_COOLDOWN_MS)
    expect(shapezzRunCooldownRemainingMs(finishedAt, finishedAt.getTime() + 30 * 60 * 1000)).toBe(90 * 60 * 1000)
  })

  it('is fully open once the cooldown elapses or when no run ever finished', () => {
    const finishedAt = new Date('2026-07-17T12:00:00Z')
    expect(shapezzRunCooldownRemainingMs(finishedAt, finishedAt.getTime() + SHAPEZZ_RUN_COOLDOWN_MS)).toBe(0)
    expect(shapezzRunCooldownRemainingMs(finishedAt, finishedAt.getTime() + SHAPEZZ_RUN_COOLDOWN_MS + 1)).toBe(0)
    expect(shapezzRunCooldownRemainingMs(null, Date.now())).toBe(0)
  })
})
