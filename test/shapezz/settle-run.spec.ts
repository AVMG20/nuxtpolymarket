import { describe, expect, it } from 'vitest'
import { settleShapezzRun, type ShapezzRunReport, type ShapezzSettlementState } from '#server/utils/shapezz'
import { SHAPEZZ_CHECKPOINT_MS, shapezzMaxPayoutForRun } from '#shared/utils/gamelogic/shapezz'

const STARTED_AT = new Date('2026-01-01T00:00:00.000Z')

function state(overrides: Partial<ShapezzSettlementState> = {}): ShapezzSettlementState {
  return {
    runStartedAt: STARTED_AT,
    runDifficultySnapshot: 'surge',
    runPowerSnapshot: 25,
    runsPlayed: 2,
    totalCoinsEarned: 800,
    bestSurvivalMs: 40_000,
    bestKills: 80,
    bestCheckpoint: 0,
    ...overrides
  }
}

function report(overrides: Partial<ShapezzRunReport> = {}): ShapezzRunReport {
  return {
    reason: 'cashout',
    reportedElapsedMs: SHAPEZZ_CHECKPOINT_MS,
    reportedCoins: 200,
    reportedKills: 60,
    ...overrides
  }
}

describe('settleShapezzRun', () => {
  it('only pays a cash-out at a completed checkpoint', () => {
    const result = settleShapezzRun(state(), report({ reportedElapsedMs: SHAPEZZ_CHECKPOINT_MS - 2000 }), STARTED_AT.getTime() + SHAPEZZ_CHECKPOINT_MS)

    expect(result.cashout).toBe(false)
    expect(result.awarded).toBe(0)
  })

  it('pays a valid checkpoint cash-out and updates run records', () => {
    const result = settleShapezzRun(state(), report(), STARTED_AT.getTime() + SHAPEZZ_CHECKPOINT_MS)

    expect(result.cashout).toBe(true)
    expect(result.awarded).toBe(200)
    expect(result.runsPlayed).toBe(3)
    expect(result.bestSurvivalMs).toBe(SHAPEZZ_CHECKPOINT_MS)
    expect(result.bestCheckpoint).toBe(1)
  })

  it('caps a fabricated offer against elapsed time and selected difficulty', () => {
    const elapsedMs = 90_000
    const cap = shapezzMaxPayoutForRun(elapsedMs, 'surge')
    const result = settleShapezzRun(state(), report({ reportedElapsedMs: elapsedMs, reportedCoins: cap + 1_000_000 }), STARTED_AT.getTime() + elapsedMs)

    expect(result.awarded).toBe(cap)
    expect(result.capped).toBe(true)
  })

  it('pays zero on defeat even after several checkpoints', () => {
    const elapsedMs = 180_000
    const result = settleShapezzRun(state(), report({ reason: 'defeat', reportedElapsedMs: elapsedMs, reportedCoins: 50_000 }), STARTED_AT.getTime() + elapsedMs)

    expect(result.awarded).toBe(0)
    expect(result.cashout).toBe(false)
    expect(result.runsPlayed).toBe(3)
  })

  it('clears abandoned locks without recording progress', () => {
    const result = settleShapezzRun(state(), report({ reason: 'abandoned', reportedElapsedMs: 180_000, reportedCoins: 50_000 }), STARTED_AT.getTime() + 180_000)

    expect(result.elapsedMs).toBe(0)
    expect(result.awarded).toBe(0)
    expect(result.runsPlayed).toBe(2)
    expect(result.bestSurvivalMs).toBe(40_000)
  })

  it('cannot report more active playtime than wall time', () => {
    const result = settleShapezzRun(state(), report({ reportedElapsedMs: 180_000 }), STARTED_AT.getTime() + 50_000)

    expect(result.elapsedMs).toBe(53_000)
  })
})
