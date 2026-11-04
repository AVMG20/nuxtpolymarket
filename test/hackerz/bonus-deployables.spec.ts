import { describe, expect, it } from 'vitest'
import {
  HACKERZ_BONUS_EVERY,
  HACKERZ_DEPLOYABLE_MAX,
  HACKERZ_MAX_WAVE,
  HACKERZ_SAVE_VERSION,
  hackerzBonusOffered,
  hackerzEmptyArmoury,
  hackerzEmptyMainframe,
  hackerzLoadout,
  hackerzValidateSave,
  type HackerzDeployableStock,
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
})

describe('hackerz deployables', () => {
  it('carries the stock into the loadout, filling items a save predates', () => {
    // A save written before the Portscan, Blip, White Hat and Surge existed.
    const armoury = { ...hackerzEmptyArmoury(), deployables: { honeypot: 2, bomb: 0, proxy: 1 } as HackerzDeployableStock }
    expect(hackerzLoadout(armoury, hackerzEmptyMainframe(), 'breach').deployables)
      .toEqual({ honeypot: 2, bomb: 0, proxy: 1, portscan: 0, blip: 0, whitehat: 0, surge: 0 })
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
