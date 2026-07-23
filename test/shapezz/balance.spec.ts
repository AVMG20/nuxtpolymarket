import { describe, expect, it } from 'vitest'
import {
  SHAPEZZ_CHECKPOINT_MS,
  SHAPEZZ_COOLDOWN_RUSH_MS_PER_GEM,
  SHAPEZZ_COIN_PAYOUT_SCALE,
  SHAPEZZ_COMBAT_LIMITS,
  SHAPEZZ_DIFFICULTIES,
  SHAPEZZ_LAUNCHER_EDGE_DAMAGE_MULTIPLIER,
  SHAPEZZ_WEAPONS,
  shapezzCheckpointCount,
  shapezzCooldownRushCost,
  shapezzCheckpointPressure,
  shapezzEnemyHealthMultiplier,
  shapezzExplosionDamageMultiplier,
  shapezzIntensity,
  shapezzMaxPayoutForRun,
  shapezzPayoutForRun,
  SHAPEZZ_RUN_COOLDOWN_MS,
  SHAPEZZ_RUN_UPGRADES,
  shapezzPermanentUpgradeCost,
  shapezzPlayerStats,
  shapezzExecutionThreshold,
  shapezzKillShockwaveStats,
  shapezzOverkillDividendStats,
  shapezzRunCooldownRemainingMs,
  shapezzWeapon,
  shapezzWeaponPointBlankDps,
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
    // A first cashout has enough headroom for the 25x drop conversion.
    expect(SHAPEZZ_COIN_PAYOUT_SCALE).toBe(25)
    expect(shapezzMaxPayoutForRun(45_000, 'surge')).toBeGreaterThan(46_000)
    expect(shapezzMaxPayoutForRun(45_000, 'surge')).toBeLessThan(48_000)
    expect(shapezzMaxPayoutForRun(45_000, 'annihilation')).toBeGreaterThan(shapezzMaxPayoutForRun(45_000, 'surge') * 4)
  })

  it('gives risky long runs substantially more upside than guaranteed-payout games', () => {
    expect(shapezzMaxPayoutForRun(6 * 60_000, 'surge')).toBeGreaterThan(450_000)
    expect(shapezzMaxPayoutForRun(6 * 60_000, 'surge')).toBeLessThan(500_000)
    expect(shapezzMaxPayoutForRun(10 * 60_000, 'annihilation')).toBeGreaterThan(5_000_000)
    expect(shapezzMaxPayoutForRun(10 * 60_000, 'annihilation')).toBeLessThan(6_250_000)
    // Lower difficulties stay an order of magnitude below the top end.
    expect(shapezzMaxPayoutForRun(10 * 60_000, 'surge')).toBeLessThan(shapezzMaxPayoutForRun(10 * 60_000, 'annihilation') / 4)
  })

  it('turns an over-cap client loot total into the amount the server can bank', () => {
    const elapsedMs = 7 * SHAPEZZ_CHECKPOINT_MS
    const cap = shapezzMaxPayoutForRun(elapsedMs, 'surge')

    expect(shapezzPayoutForRun(cap + 400_000, elapsedMs, 'surge')).toBe(cap)
    expect(shapezzPayoutForRun(cap - 1, elapsedMs, 'surge')).toBe(cap - 1)
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
  it('offers four weapon archetypes across five rarity tiers', () => {
    expect(SHAPEZZ_WEAPONS).toHaveLength(20)
    expect(new Set(SHAPEZZ_WEAPONS.map(weapon => weapon.type))).toEqual(new Set(['blaster', 'launcher', 'shotgun', 'arcCoil']))
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
    expect(launcher.explosionRadius).toBe(125)
    expect(shotgun.pellets).toBe(7)
    expect(shapezzWeapon('shotgun', 'mythic').pellets).toBe(11)
    expect(shotgun.minFalloffDamage).toBe(1)
    expect(shotgun.falloffEnd).toBeGreaterThan(shotgun.falloffStart)
    expect(shotgun.falloffStart).toBeGreaterThan(9000)
  })

  it('gives the Nova Mortar a strong inner blast and a weaker outer ring', () => {
    const radius = shapezzWeapon('launcher', 'common').explosionRadius

    expect(shapezzExplosionDamageMultiplier(radius * 0.45, radius)).toBe(1)
    expect(shapezzExplosionDamageMultiplier(radius * 0.725, radius)).toBeCloseTo(0.6)
    expect(shapezzExplosionDamageMultiplier(radius, radius)).toBe(SHAPEZZ_LAUNCHER_EDGE_DAMAGE_MULTIPLIER)
  })

  it('keeps Scatter Array close-range DPS in line with the other weapons', () => {
    const baseFireRate = shapezzPlayerStats({ core: 0, overclock: 0, armor: 0, thrusters: 0, magnet: 0, killHeal: 0 }).fireRate

    for (const rarity of ['common', 'rare', 'epic', 'legendary', 'mythic'] as const) {
      const blasterDps = shapezzWeaponPointBlankDps(shapezzWeapon('blaster', rarity), baseFireRate)
      const launcherDps = shapezzWeaponPointBlankDps(shapezzWeapon('launcher', rarity), baseFireRate)
      const shotgunDps = shapezzWeaponPointBlankDps(shapezzWeapon('shotgun', rarity), baseFireRate)

      expect(launcherDps).toBeLessThan(blasterDps)
      expect(shotgunDps).toBeLessThanOrEqual(blasterDps * 1.22)
    }
  })

  it('keeps Arc Coil short-ranged while higher rarities add chains and DPS', () => {
    const baseFireRate = shapezzPlayerStats({ core: 0, overclock: 0, armor: 0, thrusters: 0, magnet: 0, killHeal: 0 }).fireRate
    const common = shapezzWeapon('arcCoil', 'common')
    const mythic = shapezzWeapon('arcCoil', 'mythic')

    expect(common.chainRange).toBe(235)
    expect(mythic.chainRange).toBe(common.chainRange)
    expect(common.chainCount).toBe(1)
    expect(mythic.chainCount).toBe(5)
    expect(shapezzWeaponPointBlankDps(mythic, baseFireRate)).toBeGreaterThan(shapezzWeaponPointBlankDps(common, baseFireRate) * 2.5)
    expect(shapezzWeaponPointBlankDps(common, baseFireRate)).toBeLessThan(shapezzWeaponPointBlankDps(shapezzWeapon('blaster', 'common'), baseFireRate))
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

describe('SHAPEZZ new run upgrades', () => {
  it('registers every requested upgrade in the checkpoint pool', () => {
    const ids = new Set(SHAPEZZ_RUN_UPGRADES.map(upgrade => upgrade.id))

    expect(ids.has('killShockwave')).toBe(true)
    expect(ids.has('executioner')).toBe(true)
    expect(ids.has('overkillDividend')).toBe(true)
    expect(ids.has('ceilingBattery')).toBe(true)
  })

  it('scales Executioner modestly from a 12% starting threshold', () => {
    expect(shapezzExecutionThreshold(0)).toBe(0)
    expect(shapezzExecutionThreshold(1)).toBe(0.12)
    expect(shapezzExecutionThreshold(3)).toBeCloseTo(0.17)
    expect(shapezzExecutionThreshold(99)).toBe(0.24)
  })

  it('makes repeated KILLQUAKE stacks trigger sooner with a larger, harder blast', () => {
    const first = shapezzKillShockwaveStats(1)
    const stacked = shapezzKillShockwaveStats(4)

    expect(first.kills).toBe(18)
    expect(stacked.kills).toBeLessThan(first.kills)
    expect(stacked.radius).toBeGreaterThan(first.radius)
    expect(stacked.damageMultiplier).toBeGreaterThan(first.damageMultiplier)
  })

  it('caps Overkill Dividend conversion and radius growth', () => {
    const first = shapezzOverkillDividendStats(1)
    const capped = shapezzOverkillDividendStats(99)

    expect(capped.radius).toBeGreaterThan(first.radius)
    expect(capped.conversion).toBeGreaterThan(first.conversion)
    expect(capped).toEqual(shapezzOverkillDividendStats(5))
  })
})

describe('SHAPEZZ arena cooldown', () => {
  it('charges one gem per started ten minutes to rush arena recharge', () => {
    expect(shapezzCooldownRushCost(0)).toBe(0)
    expect(shapezzCooldownRushCost(1)).toBe(1)
    expect(shapezzCooldownRushCost(SHAPEZZ_COOLDOWN_RUSH_MS_PER_GEM)).toBe(1)
    expect(shapezzCooldownRushCost(SHAPEZZ_COOLDOWN_RUSH_MS_PER_GEM + 1)).toBe(2)
    expect(shapezzCooldownRushCost(SHAPEZZ_RUN_COOLDOWN_MS)).toBe(12)
  })

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
