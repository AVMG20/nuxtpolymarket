import { describe, expect, it } from 'vitest'
import {
  HACKERZ_BASE_SLOTS,
  HACKERZ_MAX_SLOTS,
  HACKERZ_UPGRADES,
  hackerzSlots,
  hackerzUpgradeMax,
  HACKERZ_HACKER_CONTINGENT,
  HACKERZ_HACKER_FIELD,
  HACKERZ_HACKER_SECOND_MS,
  HACKERZ_HACKER_SURGE_WAVE,
  HACKERZ_RUNNER_SPEED,
  hackerzEnemy,
  hackerzHackerField,
  hackerzSpawnWeight
} from '#shared/utils/gamelogic/hackerz'

describe('hackerzHackerField', () => {
  it('keeps the standard pack before the surge waves', () => {
    expect(hackerzHackerField(HACKERZ_HACKER_SURGE_WAVE - 1, 0)).toBe(HACKERZ_HACKER_FIELD)
    expect(hackerzHackerField(HACKERZ_HACKER_SURGE_WAVE - 1, 30_000)).toBe(HACKERZ_HACKER_FIELD)
  })

  it('sends one contingent first and a second one a few seconds in', () => {
    expect(hackerzHackerField(HACKERZ_HACKER_SURGE_WAVE, 0)).toBe(HACKERZ_HACKER_CONTINGENT)
    expect(hackerzHackerField(25, HACKERZ_HACKER_SECOND_MS - 1)).toBe(HACKERZ_HACKER_CONTINGENT)
    expect(hackerzHackerField(25, HACKERZ_HACKER_SECOND_MS)).toBe(HACKERZ_HACKER_CONTINGENT * 2)
  })
})

describe('hackerzUpgradeMax', () => {
  const spire = HACKERZ_UPGRADES.find(def => def.id === 'spire')!

  it('never sells a Spire level the tower has no room for', () => {
    for (let charter = 0; charter <= 4; charter++) {
      const max = hackerzUpgradeMax(spire, charter)
      expect(hackerzSlots(max, charter)).toBe(Math.min(HACKERZ_MAX_SLOTS, HACKERZ_BASE_SLOTS + spire.max + charter))
      expect(hackerzSlots(max, charter)).toBeGreaterThan(hackerzSlots(max - 1, charter))
    }
  })

  it('leaves every other upgrade at its own maximum', () => {
    for (const def of HACKERZ_UPGRADES.filter(def => def.id !== 'spire')) {
      expect(hackerzUpgradeMax(def, 4)).toBe(def.max)
    }
  })
})

describe('hackerzSpawnWeight', () => {
  it('boosts runners more as the waves go on, and leaves the rest alone', () => {
    const sapper = hackerzEnemy('sapper')
    const tank = hackerzEnemy('tank')
    expect(sapper.speed).toBeGreaterThanOrEqual(HACKERZ_RUNNER_SPEED)
    expect(hackerzSpawnWeight(sapper, 20)).toBeGreaterThan(hackerzSpawnWeight(sapper, 5))
    expect(hackerzSpawnWeight(sapper, 5)).toBeGreaterThan(sapper.weight)
    expect(hackerzSpawnWeight(tank, 20)).toBe(tank.weight)
  })

  it('never boosts the hackers, which the portal tops up on its own', () => {
    const crawler = hackerzEnemy('crawler')
    expect(hackerzSpawnWeight(crawler, 25)).toBe(crawler.weight)
  })
})
