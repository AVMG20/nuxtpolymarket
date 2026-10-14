import { describe, expect, it } from 'vitest'
import {
  HACKERZ_BONUS_EVERY,
  HACKERZ_DEPLOYABLES,
  HACKERZ_DEPLOYABLE_MAX,
  HACKERZ_EVENTS,
  HACKERZ_MAX_WAVE,
  HACKERZ_SAVE_VERSION,
  hackerzBonusEvent,
  hackerzBonusOffered,
  hackerzDeployableCost,
  hackerzEmptyArmoury,
  hackerzEmptyMainframe,
  hackerzLoadout,
  hackerzStock,
  hackerzValidateSave,
  type HackerzRunSave
} from '#shared/utils/gamelogic/hackerz'

function save(overrides: Partial<HackerzRunSave> = {}): HackerzRunSave {
  return {
    version: HACKERZ_SAVE_VERSION,
    difficulty: 'breach',
    wave: 6,
    credits: 500,
    coins: 1200,
    kills: 80,
    wallHp: 900,
    armoury: hackerzEmptyArmoury(),
    bonusWave: 3,
    ...overrides
  }
}

describe('hackerz bonus rounds', () => {
  it('offers one after every third cleared wave', () => {
    const offered = Array.from({ length: HACKERZ_MAX_WAVE }, (_, i) => i + 1)
      .filter(wave => hackerzBonusOffered(wave, 0))
    expect(offered.every(wave => wave % HACKERZ_BONUS_EVERY === 0)).toBe(true)
    expect(offered).toContain(3)
  })

  it('never offers one before the run starts or after the final wave', () => {
    expect(hackerzBonusOffered(0, 0)).toBe(false)
    expect(hackerzBonusOffered(HACKERZ_MAX_WAVE, 0)).toBe(false)
  })

  it('stops offering once the offer was answered', () => {
    expect(hackerzBonusOffered(6, 3)).toBe(true)
    expect(hackerzBonusOffered(6, 6)).toBe(false)
  })

  it('rotates through every event', () => {
    const seen = new Set([3, 6, 9].map(wave => hackerzBonusEvent(wave).id))
    expect(seen.size).toBe(HACKERZ_EVENTS.length)
  })
})

describe('hackerz deployables', () => {
  it('prices creep with the wave and never fall', () => {
    for (const def of HACKERZ_DEPLOYABLES) {
      expect(hackerzDeployableCost(def, 0)).toBe(def.cost)
      expect(hackerzDeployableCost(def, 20)).toBeGreaterThan(hackerzDeployableCost(def, 5))
    }
  })

  it('fills a stock for an armoury written before deployables existed', () => {
    const { deployables: _, ...legacy } = hackerzEmptyArmoury()
    expect(hackerzStock(legacy)).toEqual({ honeypot: 0, bomb: 0, proxy: 0 })
  })

  it('carries the stock into the loadout', () => {
    const armoury = { ...hackerzEmptyArmoury(), deployables: { honeypot: 2, bomb: 0, proxy: 1 } }
    expect(hackerzLoadout(armoury, hackerzEmptyMainframe(), 'breach').deployables).toEqual({ honeypot: 2, bomb: 0, proxy: 1 })
  })
})

describe('hackerz save validation', () => {
  it('accepts a save with bonus and deployable state', () => {
    expect(hackerzValidateSave(save({ armoury: { ...hackerzEmptyArmoury(), deployables: { honeypot: 3, bomb: 1, proxy: 0 } } }))).toBe(true)
  })

  it('still accepts a save from before bonus rounds and deployables', () => {
    const { deployables: _, ...armoury } = hackerzEmptyArmoury()
    const { bonusWave: __, ...legacy } = save({ armoury })
    expect(hackerzValidateSave(legacy)).toBe(true)
  })

  it('rejects a bonus marker past the cleared wave', () => {
    expect(hackerzValidateSave(save({ wave: 6, bonusWave: 9 }))).toBe(false)
  })

  it('rejects an overfull or unknown deployable stock', () => {
    const over = { ...hackerzEmptyArmoury(), deployables: { honeypot: HACKERZ_DEPLOYABLE_MAX + 1, bomb: 0, proxy: 0 } }
    expect(hackerzValidateSave(save({ armoury: over }))).toBe(false)
    const unknown = { ...hackerzEmptyArmoury(), deployables: { honeypot: 0, bomb: 0, proxy: 0, nuke: 1 } as never }
    expect(hackerzValidateSave(save({ armoury: unknown }))).toBe(false)
  })
})
