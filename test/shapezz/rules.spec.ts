import { describe, expect, it } from 'vitest'
import {
  SHAPEZZ_CHECKPOINT_MS,
  SHAPEZZ_COOLDOWN_RUSH_MS_PER_GEM,
  SHAPEZZ_COMBAT_LIMITS,
  shapezzCooldownRushCost,
  shapezzMaxPayoutForRun,
  shapezzPayoutForRun,
  SHAPEZZ_RUN_COOLDOWN_MS,
  shapezzPermanentUpgradeCost,
  shapezzOverkillDividendStats,
  shapezzRunCooldownRemainingMs,
  shapezzWeaponReplacement
} from '#shared/utils/gamelogic/shapezz'

describe('SHAPEZZ payouts', () => {
  it('turns an over-cap client loot total into the amount the server can bank', () => {
    const elapsedMs = 7 * SHAPEZZ_CHECKPOINT_MS
    const cap = shapezzMaxPayoutForRun(elapsedMs, 'surge')

    expect(shapezzPayoutForRun(cap + 400_000, elapsedMs, 'surge')).toBe(cap)
    expect(shapezzPayoutForRun(cap - 1, elapsedMs, 'surge')).toBe(cap - 1)
  })
})

describe('SHAPEZZ permanent progression', () => {
  it('makes workshop costs grow with each purchased level', () => {
    for (let level = 1; level < 20; level++) {
      expect(shapezzPermanentUpgradeCost('core', level)!).toBeGreaterThan(shapezzPermanentUpgradeCost('core', level - 1)!)
    }
  })
})

describe('SHAPEZZ weapons', () => {
  it('refunds exactly 25% of the stored previous purchase price', () => {
    expect(shapezzWeaponReplacement(8_000_000, 50_000_000)).toEqual({ refund: 2_000_000, netCost: 48_000_000 })
    expect(shapezzWeaponReplacement(50_000_000, 8_000)).toEqual({ refund: 12_500_000, netCost: -12_492_000 })
  })

  it('uses bounded combat pools instead of allowing endgame effects to grow without limit', () => {
    expect(SHAPEZZ_COMBAT_LIMITS.playerBullets).toBeLessThanOrEqual(1200)
    expect(SHAPEZZ_COMBAT_LIMITS.enemyBullets).toBeLessThanOrEqual(SHAPEZZ_COMBAT_LIMITS.playerBullets)
    expect(SHAPEZZ_COMBAT_LIMITS.particles).toBeLessThanOrEqual(2000)
    expect(SHAPEZZ_COMBAT_LIMITS.enemies).toBeLessThanOrEqual(120)
  })
})

describe('SHAPEZZ new run upgrades', () => {
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
