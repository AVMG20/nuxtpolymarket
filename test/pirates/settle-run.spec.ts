import { describe, expect, it } from 'vitest'
import { settlePirateRun, type PirateRunReport, type PirateSettlementState } from '#server/utils/pirates'
import {
  PIRATE_RUN_DURATION_MS,
  PIRATE_REPAIR_MAX_MS,
  pirateCompletionBonus,
  pirateMaxPayoutForRun,
  pirateRepairDurationMs
} from '#shared/utils/gamelogic/pirates'

const RUN_STARTED_AT = new Date('2026-01-01T00:00:00.000Z')
const DIFFICULTY = 200

function makeState(overrides: Partial<PirateSettlementState> = {}): PirateSettlementState {
  return {
    runStartedAt: RUN_STARTED_AT,
    runPowerSnapshot: 120,
    runDifficultySnapshot: DIFFICULTY,
    ammoCount: 50,
    gemAmmoCount: 10,
    runsPlayed: 3,
    totalCoinsEarned: 10_000,
    bestSurvivalMs: 60_000,
    bestRunPower: 100,
    bestRunLoot: 5_000,
    highestCompletedDifficulty: 150,
    bestCompletedLoot: 8_000,
    bestCompletedPower: 110,
    bestCompletedSkinId: 'starter',
    equippedSkinId: 'crimson-privateer',
    hullRepairUntil: null,
    hullRepairTotalMs: 0,
    ...overrides
  }
}

function makeReport(overrides: Partial<PirateRunReport> = {}): PirateRunReport {
  return {
    abandoned: false,
    survived: true,
    reason: 'timeout',
    reportedElapsedMs: 0,
    reportedCoins: 0,
    reportedKills: 10,
    reportedShotsFired: 50,
    reportedAmmoUsed: 0,
    reportedGemAmmoUsed: 0,
    reportedHullDamageFraction: 0,
    ...overrides
  }
}

describe('settlePirateRun — abandoned runs', () => {
  it('zeroes elapsed, awarded and ammo, and preserves prior bests and repair state', () => {
    const priorRepairUntil = new Date('2026-01-01T02:00:00.000Z')
    const state = makeState({ hullRepairUntil: priorRepairUntil, hullRepairTotalMs: 3_600_000 })
    const now = RUN_STARTED_AT.getTime() + 90_000

    const result = settlePirateRun(state, makeReport({
      abandoned: true,
      reportedElapsedMs: 90_000,
      reportedCoins: 50_000,
      reportedAmmoUsed: 20,
      reportedGemAmmoUsed: 5,
      reportedHullDamageFraction: 0.5
    }), now)

    expect(result.elapsedMs).toBe(0)
    expect(result.awarded).toBe(0)
    expect(result.runCoins).toBe(0)
    expect(result.ammoUsed).toBe(0)
    expect(result.gemAmmoUsed).toBe(0)
    expect(result.ammoCount).toBe(state.ammoCount)
    expect(result.gemAmmoCount).toBe(state.gemAmmoCount)
    expect(result.runsPlayed).toBe(state.runsPlayed)
    expect(result.totalCoinsEarned).toBe(state.totalCoinsEarned)
    expect(result.bestSurvivalMs).toBe(state.bestSurvivalMs)
    expect(result.bestRunLoot).toBe(state.bestRunLoot)
    expect(result.bestRunPower).toBe(state.bestRunPower)
    expect(result.highestCompletedDifficulty).toBe(state.highestCompletedDifficulty)
    expect(result.hullRepairUntil).toBe(priorRepairUntil)
    expect(result.hullRepairTotalMs).toBe(3_600_000)
  })
})

describe('settlePirateRun — elapsed time clamping', () => {
  it('clamps reported elapsed to wall-clock time plus a 5s grace window', () => {
    const state = makeState()
    const now = RUN_STARTED_AT.getTime() + PIRATE_RUN_DURATION_MS + 20_000

    const result = settlePirateRun(state, makeReport({ reportedElapsedMs: PIRATE_RUN_DURATION_MS + 100_000 }), now)

    expect(result.elapsedMs).toBe(PIRATE_RUN_DURATION_MS + 5_000)
  })

  it('clamps reported elapsed to actual wall-clock elapsed when under the grace ceiling', () => {
    const state = makeState()
    const now = RUN_STARTED_AT.getTime() + 30_000

    const result = settlePirateRun(state, makeReport({ reportedElapsedMs: 90_000 }), now)

    expect(result.elapsedMs).toBe(30_000)
  })

  it('never lets elapsed go negative when the report predates the run start', () => {
    const state = makeState()
    const now = RUN_STARTED_AT.getTime() - 5_000

    const result = settlePirateRun(state, makeReport({ reportedElapsedMs: 1_000 }), now)

    expect(result.elapsedMs).toBe(0)
  })
})

describe('settlePirateRun — payout anti-cheat cap', () => {
  it('clamps reported coins to the max plausible payout for the run', () => {
    const state = makeState()
    const elapsedMs = 120_000
    const now = RUN_STARTED_AT.getTime() + elapsedMs
    const maxPayout = pirateMaxPayoutForRun(elapsedMs, DIFFICULTY, 0)

    const result = settlePirateRun(state, makeReport({
      survived: false,
      reason: 'defeat',
      reportedElapsedMs: elapsedMs,
      reportedCoins: maxPayout + 1_000_000
    }), now)

    expect(result.runCoins).toBe(maxPayout)
    expect(result.capped).toBe(true)
  })

  it('does not cap coins that stay under the plausible ceiling', () => {
    const state = makeState()
    const elapsedMs = 120_000
    const now = RUN_STARTED_AT.getTime() + elapsedMs
    const maxPayout = pirateMaxPayoutForRun(elapsedMs, DIFFICULTY, 0)
    const reportedCoins = Math.floor(maxPayout / 2)

    const result = settlePirateRun(state, makeReport({
      survived: false,
      reason: 'defeat',
      reportedElapsedMs: elapsedMs,
      reportedCoins
    }), now)

    expect(result.runCoins).toBe(reportedCoins)
    expect(result.capped).toBe(false)
  })
})

describe('settlePirateRun — completion bonus', () => {
  it('adds the completion bonus for a full-length timeout survival', () => {
    const state = makeState()
    const now = RUN_STARTED_AT.getTime() + PIRATE_RUN_DURATION_MS

    const result = settlePirateRun(state, makeReport({
      survived: true,
      reason: 'timeout',
      reportedElapsedMs: PIRATE_RUN_DURATION_MS,
      reportedCoins: 0
    }), now)

    expect(result.completed).toBe(true)
    expect(result.completionBonus).toBe(pirateCompletionBonus(DIFFICULTY))
    expect(result.awarded).toBe(result.runCoins + result.completionBonus)
  })

  it('accepts elapsed within the 1s completion tolerance', () => {
    const state = makeState()
    const elapsedMs = PIRATE_RUN_DURATION_MS - 1_000
    const now = RUN_STARTED_AT.getTime() + elapsedMs

    const result = settlePirateRun(state, makeReport({
      survived: true,
      reason: 'timeout',
      reportedElapsedMs: elapsedMs
    }), now)

    expect(result.completed).toBe(true)
  })

  it('does not award the bonus a moment short of the tolerance', () => {
    const state = makeState()
    const elapsedMs = PIRATE_RUN_DURATION_MS - 1_001
    const now = RUN_STARTED_AT.getTime() + elapsedMs

    const result = settlePirateRun(state, makeReport({
      survived: true,
      reason: 'timeout',
      reportedElapsedMs: elapsedMs
    }), now)

    expect(result.completed).toBe(false)
    expect(result.completionBonus).toBe(0)
  })

  it('does not award the bonus on a defeat or an abandoned finish, even at full length', () => {
    const state = makeState()
    const now = RUN_STARTED_AT.getTime() + PIRATE_RUN_DURATION_MS

    const defeated = settlePirateRun(state, makeReport({
      survived: false,
      reason: 'defeat',
      reportedElapsedMs: PIRATE_RUN_DURATION_MS
    }), now)
    expect(defeated.completed).toBe(false)
    expect(defeated.completionBonus).toBe(0)

    const abandoned = settlePirateRun(state, makeReport({
      abandoned: true,
      survived: true,
      reason: 'timeout',
      reportedElapsedMs: PIRATE_RUN_DURATION_MS
    }), now)
    expect(abandoned.completed).toBe(false)
    expect(abandoned.completionBonus).toBe(0)
  })
})

describe('settlePirateRun — hull repair', () => {
  it('forces full hull damage and max repair time on a defeat, ignoring the reported fraction', () => {
    const state = makeState()
    const now = RUN_STARTED_AT.getTime() + 45_000

    const result = settlePirateRun(state, makeReport({
      survived: false,
      reason: 'defeat',
      reportedElapsedMs: 45_000,
      reportedHullDamageFraction: 0.1
    }), now)

    expect(result.repairMs).toBe(pirateRepairDurationMs(1))
    expect(result.repairMs).toBe(PIRATE_REPAIR_MAX_MS)
    expect(result.hullRepairUntil?.getTime()).toBe(now + PIRATE_REPAIR_MAX_MS)
    expect(result.hullRepairTotalMs).toBe(PIRATE_REPAIR_MAX_MS)
  })

  it('trusts the reported hull damage fraction on a non-defeat finish', () => {
    const state = makeState()
    const now = RUN_STARTED_AT.getTime() + 45_000

    const result = settlePirateRun(state, makeReport({
      survived: false,
      reason: 'cancelled',
      reportedElapsedMs: 45_000,
      reportedHullDamageFraction: 0.25
    }), now)

    expect(result.repairMs).toBe(pirateRepairDurationMs(0.25))
    expect(result.hullRepairUntil?.getTime()).toBe(now + result.repairMs)
  })

  it('sets no repair when the hull took no damage', () => {
    const state = makeState()
    const now = RUN_STARTED_AT.getTime() + 45_000

    const result = settlePirateRun(state, makeReport({
      survived: true,
      reason: 'timeout',
      reportedElapsedMs: 45_000,
      reportedHullDamageFraction: 0
    }), now)

    expect(result.repairMs).toBe(0)
    expect(result.hullRepairUntil).toBeNull()
  })
})

describe('settlePirateRun — best-run tiebreaks', () => {
  it('crowns a new best run on a longer survival time, regardless of loot', () => {
    const state = makeState({ bestSurvivalMs: 60_000, bestRunLoot: 5_000, bestRunPower: 100 })
    const now = RUN_STARTED_AT.getTime() + 70_000

    const result = settlePirateRun(state, makeReport({
      survived: false,
      reason: 'defeat',
      reportedElapsedMs: 70_000,
      reportedCoins: 1
    }), now)

    expect(result.bestSurvivalMs).toBe(70_000)
    expect(result.bestRunPower).toBe(state.runPowerSnapshot)
    expect(result.bestRunLoot).toBe(result.awarded)
  })

  it('breaks a tied survival time on higher loot', () => {
    const state = makeState({ bestSurvivalMs: 60_000, bestRunLoot: 500, bestRunPower: 100 })
    const now = RUN_STARTED_AT.getTime() + 60_000
    const maxPayout = pirateMaxPayoutForRun(60_000, DIFFICULTY, 0)

    const result = settlePirateRun(state, makeReport({
      survived: false,
      reason: 'defeat',
      reportedElapsedMs: 60_000,
      reportedCoins: maxPayout
    }), now)

    expect(result.bestSurvivalMs).toBe(60_000)
    expect(result.bestRunLoot).toBe(maxPayout)
    expect(result.bestRunPower).toBe(state.runPowerSnapshot)
  })

  it('does not overwrite the best run on a tied time with lower loot', () => {
    const state = makeState({ bestSurvivalMs: 60_000, bestRunLoot: 999_999_999, bestRunPower: 100 })
    const now = RUN_STARTED_AT.getTime() + 60_000

    const result = settlePirateRun(state, makeReport({
      survived: false,
      reason: 'defeat',
      reportedElapsedMs: 60_000,
      reportedCoins: 1
    }), now)

    expect(result.bestRunLoot).toBe(999_999_999)
    expect(result.bestRunPower).toBe(100)
  })
})

describe('settlePirateRun — best-completed tiebreaks', () => {
  it('crowns a new best completed run at a higher difficulty, regardless of loot', () => {
    const state = makeState({
      runDifficultySnapshot: 400,
      highestCompletedDifficulty: 150,
      bestCompletedLoot: 8_000,
      bestCompletedPower: 110,
      equippedSkinId: 'royal-aether'
    })
    const now = RUN_STARTED_AT.getTime() + PIRATE_RUN_DURATION_MS

    const result = settlePirateRun(state, makeReport({
      survived: true,
      reason: 'timeout',
      reportedElapsedMs: PIRATE_RUN_DURATION_MS
    }), now)

    expect(result.highestCompletedDifficulty).toBe(400)
    expect(result.bestCompletedLoot).toBe(result.awarded)
    expect(result.bestCompletedPower).toBe(state.runPowerSnapshot)
    expect(result.bestCompletedSkinId).toBe('royal-aether')
  })

  it('does not overwrite the best completed run at a lower difficulty, even with more loot', () => {
    const state = makeState({
      runDifficultySnapshot: 50,
      highestCompletedDifficulty: 150,
      bestCompletedLoot: 1,
      bestCompletedPower: 110,
      bestCompletedSkinId: 'starter'
    })
    const now = RUN_STARTED_AT.getTime() + PIRATE_RUN_DURATION_MS

    const result = settlePirateRun(state, makeReport({
      survived: true,
      reason: 'timeout',
      reportedElapsedMs: PIRATE_RUN_DURATION_MS
    }), now)

    expect(result.highestCompletedDifficulty).toBe(150)
    expect(result.bestCompletedLoot).toBe(1)
    expect(result.bestCompletedPower).toBe(110)
    expect(result.bestCompletedSkinId).toBe('starter')
  })
})

describe('settlePirateRun — ammo clamping', () => {
  it('clamps ammo and gem-ammo spend to what the state actually holds', () => {
    const state = makeState({ ammoCount: 10, gemAmmoCount: 2 })
    const now = RUN_STARTED_AT.getTime() + 60_000

    const result = settlePirateRun(state, makeReport({
      survived: false,
      reason: 'defeat',
      reportedElapsedMs: 60_000,
      reportedAmmoUsed: 999,
      reportedGemAmmoUsed: 999
    }), now)

    expect(result.ammoUsed).toBe(10)
    expect(result.gemAmmoUsed).toBe(2)
    expect(result.ammoCount).toBe(0)
    expect(result.gemAmmoCount).toBe(0)
  })
})
