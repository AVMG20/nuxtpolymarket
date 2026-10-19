import { describe, expect, it } from 'vitest'
import {
  claimHackerzVictory, hackerzSaveOutcome, type HackerzSaveOutcome, type HackerzVictoryClaim
} from '../../app/utils/hackerz-victory'

const FINAL = 30

/**
 * A claim against a scripted server: each save answers the next outcome in
 * `saves`, and the server holds `stored`. Everything the claim does is logged
 * in order, so a test can see that nothing settled before a save landed.
 */
function scripted(saves: HackerzSaveOutcome[], stored: { wave: number, revision: number } | null = null) {
  const log: string[] = []
  const claim: HackerzVictoryClaim = {
    save: async () => {
      const outcome = saves.shift() ?? 'unreachable'
      log.push(`save:${outcome}`)
      return outcome
    },
    stored: async () => {
      log.push('read')
      return stored
    },
    adopt: (revision) => { log.push(`adopt:${revision}`) },
    settle: async () => { log.push('settle') },
    wait: async (ms) => { log.push(`wait:${ms}`) }
  }
  return { claim, log }
}

describe('banking a won hackerz run', () => {
  it('settles straight after a save that lands', async () => {
    const { claim, log } = scripted(['saved'])
    expect(await claimHackerzVictory(claim, FINAL)).toBe('settled')
    expect(log).toEqual(['save:saved', 'settle'])
  })

  it('retries a save the uplink never answered, and settles only once one lands', async () => {
    const { claim, log } = scripted(['unreachable', 'unreachable', 'saved'])
    expect(await claimHackerzVictory(claim, FINAL)).toBe('settled')
    expect(log).toEqual(['save:unreachable', 'wait:1000', 'save:unreachable', 'wait:2000', 'save:saved', 'settle'])
  })

  it('never settles when no save lands', async () => {
    const { claim, log } = scripted(['unreachable', 'unreachable', 'unreachable'])
    expect(await claimHackerzVictory(claim, FINAL)).toBe('pending')
    expect(log).not.toContain('settle')
  })

  it('settles from the stored save when the final save landed but its answer was lost', async () => {
    // The first save landed, its answer never came; the retry carries the old revision.
    const { claim, log } = scripted(['unreachable', 'stale'], { wave: FINAL, revision: 8 })
    expect(await claimHackerzVictory(claim, FINAL)).toBe('settled')
    expect(log).toEqual(['save:unreachable', 'wait:1000', 'save:stale', 'read', 'adopt:8', 'settle'])
  })

  it('does not settle a race lost to an earlier wave', async () => {
    const { claim, log } = scripted(['stale'], { wave: FINAL - 1, revision: 8 })
    expect(await claimHackerzVictory(claim, FINAL)).toBe('conflict')
    expect(log).not.toContain('settle')
  })

  it('stops at once on a run that has already ended, or a save the server refuses', async () => {
    for (const outcome of ['ended', 'rejected'] as const) {
      const { claim, log } = scripted([outcome, 'saved'])
      expect(await claimHackerzVictory(claim, FINAL)).toBe(outcome)
      expect(log).toEqual([`save:${outcome}`])
    }
  })

  it('treats a stale save with no run left on the server as ended', async () => {
    const { claim, log } = scripted(['stale'], null)
    expect(await claimHackerzVictory(claim, FINAL)).toBe('ended')
    expect(log).not.toContain('settle')
  })

  it('sorts a failed save by its status', () => {
    expect(hackerzSaveOutcome({ statusCode: 409 })).toBe('stale')
    expect(hackerzSaveOutcome({ statusCode: 410 })).toBe('ended')
    expect(hackerzSaveOutcome({ statusCode: 400 })).toBe('rejected')
    expect(hackerzSaveOutcome({ statusCode: 503 })).toBe('unreachable')
    expect(hackerzSaveOutcome(new TypeError('fetch failed'))).toBe('unreachable')
  })
})
