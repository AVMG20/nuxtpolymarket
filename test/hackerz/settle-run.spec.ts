import { describe, expect, it } from 'vitest'
import {
  settleHackerzRun,
  type HackerzRunReport,
  type HackerzSettlementState
} from '#server/utils/hackerz'
import {
  HACKERZ_MAX_WAVE,
  HACKERZ_SAVE_VERSION,
  HACKERZ_WAVE_MS,
  hackerzDifficulty,
  hackerzEmptyArmoury,
  hackerzMaxPayout,
  hackerzMaxWaveForElapsedMs,
  hackerzValidateSave,
  type HackerzRunSave
} from '#shared/utils/gamelogic/hackerz'

function state(overrides: Partial<HackerzSettlementState> = {}): HackerzSettlementState {
  return {
    runDifficultySnapshot: 'breach',
    runCoinMultiplierSnapshot: '1.0000',
    runsPlayed: 3,
    totalCoinsEarned: '12000.0000',
    bestWave: 9,
    bestKills: 400,
    bestPayout: 5000,
    victories: 0,
    ...overrides
  }
}

function report(overrides: Partial<HackerzRunReport> = {}): HackerzRunReport {
  return {
    reason: 'defeat',
    reportedWave: 12,
    reportedCoins: 8_000,
    reportedKills: 520,
    ...overrides
  }
}

function save(overrides: Partial<HackerzRunSave> = {}): HackerzRunSave {
  return {
    version: HACKERZ_SAVE_VERSION,
    difficulty: 'breach',
    wave: 6,
    credits: 1200,
    coins: 4500,
    kills: 260,
    wallHp: 900,
    armoury: hackerzEmptyArmoury(),
    ...overrides
  }
}

describe('settleHackerzRun', () => {
  it('pays the banked coins and advances the records', () => {
    const result = settleHackerzRun(state(), report())
    expect(result.awarded).toBe(8_000)
    expect(result.capped).toBe(false)
    expect(result.runsPlayed).toBe(4)
    expect(result.bestWave).toBe(12)
    expect(result.bestKills).toBe(520)
    expect(result.totalCoinsEarned).toBe('20000.0000')
  })

  it('never lowers a record a better run already set', () => {
    const result = settleHackerzRun(
      state({ bestWave: 25, bestKills: 9_000, bestPayout: 4_000_000 }),
      report({ reportedWave: 4, reportedKills: 10 })
    )
    expect(result.bestWave).toBe(25)
    expect(result.bestKills).toBe(9_000)
    expect(result.bestPayout).toBe(4_000_000)
  })

  it('counts a victory, and only a victory', () => {
    expect(settleHackerzRun(state(), report({ reason: 'victory' })).victories).toBe(1)
    expect(settleHackerzRun(state(), report({ reason: 'defeat' })).victories).toBe(0)
    expect(settleHackerzRun(state(), report({ reason: 'retire' })).victories).toBe(0)
    expect(settleHackerzRun(state(), report({ reason: 'victory' })).victory).toBe(true)
  })

  it('caps a forged coin total at the ceiling for the wave reached', () => {
    const result = settleHackerzRun(state(), report({ reportedWave: 3, reportedCoins: 1e12 }))
    expect(result.capped).toBe(true)
    expect(result.awarded).toBe(hackerzMaxPayout(3, hackerzDifficulty('breach'), 1))
  })

  it('uses the snapshotted coin multiplier, not the account\'s current one', () => {
    // Salvage Rig bought after this run started must not reach back into it.
    const low = settleHackerzRun(
      state({ runCoinMultiplierSnapshot: '1.0000' }),
      report({ reportedWave: 3, reportedCoins: 1e12 })
    )
    const high = settleHackerzRun(
      state({ runCoinMultiplierSnapshot: '2.0000' }),
      report({ reportedWave: 3, reportedCoins: 1e12 })
    )
    expect(high.awarded).toBeGreaterThan(low.awarded)
  })

  it('settles a difficulty snapshot it does not recognise as the default', () => {
    const result = settleHackerzRun(state({ runDifficultySnapshot: null }), report())
    expect(result.difficulty.id).toBe('breach')
    expect(result.awarded).toBe(8_000)
  })

  it('treats a negative or non-finite coin total as zero', () => {
    expect(settleHackerzRun(state(), report({ reportedCoins: -500 })).awarded).toBe(0)
    expect(settleHackerzRun(state(), report({ reportedCoins: Number.NaN })).awarded).toBe(0)
  })
})

describe('hackerzValidateSave', () => {
  it('accepts a save the game actually produced', () => {
    expect(hackerzValidateSave(save())).toBe(true)
  })

  it('rejects anything that is not the current save shape', () => {
    expect(hackerzValidateSave(null)).toBe(false)
    expect(hackerzValidateSave({})).toBe(false)
    expect(hackerzValidateSave(save({ version: HACKERZ_SAVE_VERSION + 1 }))).toBe(false)
    expect(hackerzValidateSave(save({ difficulty: 'impossible' as never }))).toBe(false)
    expect(hackerzValidateSave(save({ wave: HACKERZ_MAX_WAVE + 1 }))).toBe(false)
    expect(hackerzValidateSave(save({ wave: -1 }))).toBe(false)
    expect(hackerzValidateSave(save({ credits: Number.POSITIVE_INFINITY }))).toBe(false)
    expect(hackerzValidateSave(save({ coins: -1 }))).toBe(false)
  })

  it('rejects an armoury holding things that do not exist', () => {
    expect(hackerzValidateSave(save({
      armoury: { ...hackerzEmptyArmoury(), owned: ['plasma' as never] }
    }))).toBe(false)
    expect(hackerzValidateSave(save({
      armoury: { ...hackerzEmptyArmoury(), turrets: ['deathray' as never] }
    }))).toBe(false)
    expect(hackerzValidateSave(save({
      armoury: { ...hackerzEmptyArmoury(), active: 'plasma' as never }
    }))).toBe(false)
  })

  it('rejects upgrade levels past the maximum the shop sells', () => {
    const armoury = hackerzEmptyArmoury()
    armoury.levels.damage = 999
    expect(hackerzValidateSave(save({ armoury }))).toBe(false)
  })

  it('rejects more turret mounts than the tower can hold', () => {
    const armoury = hackerzEmptyArmoury()
    armoury.turrets = Array.from({ length: 40 }, () => null)
    expect(hackerzValidateSave(save({ armoury }))).toBe(false)
  })
})

describe('hackerzMaxWaveForElapsedMs', () => {
  it('bounds claimed progress by the clock a run has actually had', () => {
    expect(hackerzMaxWaveForElapsedMs(0)).toBe(0)
    expect(hackerzMaxWaveForElapsedMs(HACKERZ_WAVE_MS - 1)).toBe(0)
    expect(hackerzMaxWaveForElapsedMs(HACKERZ_WAVE_MS * 10)).toBe(10)
    expect(hackerzMaxWaveForElapsedMs(-5000)).toBe(0)
  })
})
