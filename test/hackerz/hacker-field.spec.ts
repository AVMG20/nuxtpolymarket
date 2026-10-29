import { describe, expect, it } from 'vitest'
import {
  HACKERZ_BASE_SLOTS,
  HACKERZ_MAX_SLOTS,
  HACKERZ_UPGRADES,
  hackerzSlots,
  hackerzUpgradeMax
} from '#shared/utils/gamelogic/hackerz'

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
