import { describe, expect, it } from 'vitest'
import {
  HACKERZ_BOSS_EVERY,
  HACKERZ_CODEX_ALWAYS,
  HACKERZ_CODEX_IDS,
  HACKERZ_ENEMIES,
  hackerzCodexFromArmoury,
  hackerzCodexFromWave,
  hackerzEmptyArmoury
} from '#shared/utils/gamelogic/hackerz'

describe('hackerz database unlocks', () => {
  it('opens only the stock rail for a fresh armoury', () => {
    expect(hackerzCodexFromArmoury(hackerzEmptyArmoury())).toEqual(['rail'])
  })

  it('opens every gun, turret, deployable and upgrade bought into an armoury', () => {
    const armoury = hackerzEmptyArmoury()
    armoury.owned = ['rail', 'flak']
    armoury.turrets = ['warhead', null]
    armoury.deployables = { ...armoury.deployables!, honeypot: 2 }
    armoury.levels = { ...armoury.levels, shield: 1, pulse: 2 }
    expect(new Set(hackerzCodexFromArmoury(armoury))).toEqual(new Set(['rail', 'flak', 'warhead', 'honeypot', 'barrier', 'pulse']))
  })

  it('opens nothing for a player who has not played', () => {
    expect(hackerzCodexFromWave(0)).toEqual([])
  })

  it('opens the threats a best wave has shown, its bosses and its bonus rounds', () => {
    const opened = hackerzCodexFromWave(HACKERZ_BOSS_EVERY)
    for (const def of HACKERZ_ENEMIES) {
      if (!def.boss && !def.spawnedOnly && def.fromWave <= HACKERZ_BOSS_EVERY) expect(opened).toContain(def.id)
    }
    expect(opened).toContain('titan')
    expect(opened).toContain('spiderling')
    expect(opened).not.toContain('leviathan')
    expect(opened).toContain('ddos')
  })

  it('only ever opens real entries', () => {
    for (const id of hackerzCodexFromWave(30)) expect(HACKERZ_CODEX_IDS.has(id)).toBe(true)
    const armoury = hackerzEmptyArmoury()
    armoury.levels = { ...armoury.levels, spikes: 1, overclock: 1 }
    for (const id of hackerzCodexFromArmoury(armoury)) expect(HACKERZ_CODEX_IDS.has(id) || HACKERZ_CODEX_ALWAYS.includes(id)).toBe(true)
  })
})
