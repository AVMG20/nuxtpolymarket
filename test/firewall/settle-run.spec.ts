import { describe, expect, it } from 'vitest'
import {
  settleFirewallRun,
  type FirewallRunReport,
  type FirewallSettlementState
} from '#server/utils/firewall'
import {
  FIREWALL_MAX_WAVE,
  FIREWALL_SAVE_VERSION,
  FIREWALL_WAVE_MS,
  firewallDifficulty,
  firewallEmptyArmoury,
  firewallMaxPayout,
  firewallMaxWaveForElapsedMs,
  firewallValidateSave,
  type FirewallRunSave
} from '#shared/utils/gamelogic/firewall'

function state(overrides: Partial<FirewallSettlementState> = {}): FirewallSettlementState {
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

function report(overrides: Partial<FirewallRunReport> = {}): FirewallRunReport {
  return {
    reason: 'defeat',
    reportedWave: 12,
    reportedCoins: 8_000,
    reportedKills: 520,
    ...overrides
  }
}

function save(overrides: Partial<FirewallRunSave> = {}): FirewallRunSave {
  return {
    version: FIREWALL_SAVE_VERSION,
    difficulty: 'breach',
    wave: 6,
    credits: 1200,
    coins: 4500,
    kills: 260,
    wallHp: 900,
    armoury: firewallEmptyArmoury(),
    ...overrides
  }
}

describe('settleFirewallRun', () => {
  it('pays the banked coins and advances the records', () => {
    const result = settleFirewallRun(state(), report())
    expect(result.awarded).toBe(8_000)
    expect(result.capped).toBe(false)
    expect(result.runsPlayed).toBe(4)
    expect(result.bestWave).toBe(12)
    expect(result.bestKills).toBe(520)
    expect(result.totalCoinsEarned).toBe('20000.0000')
  })

  it('never lowers a record a better run already set', () => {
    const result = settleFirewallRun(
      state({ bestWave: 25, bestKills: 9_000, bestPayout: 4_000_000 }),
      report({ reportedWave: 4, reportedKills: 10 })
    )
    expect(result.bestWave).toBe(25)
    expect(result.bestKills).toBe(9_000)
    expect(result.bestPayout).toBe(4_000_000)
  })

  it('counts a victory, and only a victory', () => {
    expect(settleFirewallRun(state(), report({ reason: 'victory' })).victories).toBe(1)
    expect(settleFirewallRun(state(), report({ reason: 'defeat' })).victories).toBe(0)
    expect(settleFirewallRun(state(), report({ reason: 'retire' })).victories).toBe(0)
    expect(settleFirewallRun(state(), report({ reason: 'victory' })).victory).toBe(true)
  })

  it('caps a forged coin total at the ceiling for the wave reached', () => {
    const result = settleFirewallRun(state(), report({ reportedWave: 3, reportedCoins: 1e12 }))
    expect(result.capped).toBe(true)
    expect(result.awarded).toBe(firewallMaxPayout(3, firewallDifficulty('breach'), 1))
  })

  it('uses the snapshotted coin multiplier, not the account\'s current one', () => {
    // Salvage Rig bought after this run started must not reach back into it.
    const low = settleFirewallRun(
      state({ runCoinMultiplierSnapshot: '1.0000' }),
      report({ reportedWave: 3, reportedCoins: 1e12 })
    )
    const high = settleFirewallRun(
      state({ runCoinMultiplierSnapshot: '2.0000' }),
      report({ reportedWave: 3, reportedCoins: 1e12 })
    )
    expect(high.awarded).toBeGreaterThan(low.awarded)
  })

  it('settles a difficulty snapshot it does not recognise as the default', () => {
    const result = settleFirewallRun(state({ runDifficultySnapshot: null }), report())
    expect(result.difficulty.id).toBe('breach')
    expect(result.awarded).toBe(8_000)
  })

  it('treats a negative or non-finite coin total as zero', () => {
    expect(settleFirewallRun(state(), report({ reportedCoins: -500 })).awarded).toBe(0)
    expect(settleFirewallRun(state(), report({ reportedCoins: Number.NaN })).awarded).toBe(0)
  })
})

describe('firewallValidateSave', () => {
  it('accepts a save the game actually produced', () => {
    expect(firewallValidateSave(save())).toBe(true)
  })

  it('rejects anything that is not the current save shape', () => {
    expect(firewallValidateSave(null)).toBe(false)
    expect(firewallValidateSave({})).toBe(false)
    expect(firewallValidateSave(save({ version: FIREWALL_SAVE_VERSION + 1 }))).toBe(false)
    expect(firewallValidateSave(save({ difficulty: 'impossible' as never }))).toBe(false)
    expect(firewallValidateSave(save({ wave: FIREWALL_MAX_WAVE + 1 }))).toBe(false)
    expect(firewallValidateSave(save({ wave: -1 }))).toBe(false)
    expect(firewallValidateSave(save({ credits: Number.POSITIVE_INFINITY }))).toBe(false)
    expect(firewallValidateSave(save({ coins: -1 }))).toBe(false)
  })

  it('rejects an armoury holding things that do not exist', () => {
    expect(firewallValidateSave(save({
      armoury: { ...firewallEmptyArmoury(), owned: ['plasma' as never] }
    }))).toBe(false)
    expect(firewallValidateSave(save({
      armoury: { ...firewallEmptyArmoury(), turrets: ['deathray' as never] }
    }))).toBe(false)
    expect(firewallValidateSave(save({
      armoury: { ...firewallEmptyArmoury(), active: 'plasma' as never }
    }))).toBe(false)
  })

  it('rejects upgrade levels past the maximum the shop sells', () => {
    const armoury = firewallEmptyArmoury()
    armoury.levels.damage = 999
    expect(firewallValidateSave(save({ armoury }))).toBe(false)
  })

  it('rejects more turret mounts than the tower can hold', () => {
    const armoury = firewallEmptyArmoury()
    armoury.turrets = Array.from({ length: 40 }, () => null)
    expect(firewallValidateSave(save({ armoury }))).toBe(false)
  })
})

describe('firewallMaxWaveForElapsedMs', () => {
  it('bounds claimed progress by the clock a run has actually had', () => {
    expect(firewallMaxWaveForElapsedMs(0)).toBe(0)
    expect(firewallMaxWaveForElapsedMs(FIREWALL_WAVE_MS - 1)).toBe(0)
    expect(firewallMaxWaveForElapsedMs(FIREWALL_WAVE_MS * 10)).toBe(10)
    expect(firewallMaxWaveForElapsedMs(-5000)).toBe(0)
  })
})
