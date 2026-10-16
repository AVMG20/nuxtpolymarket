import { describe, expect, it } from 'vitest'
import {
  hackerzGunForMatchup,
  hackerzLayaBonusPick,
  hackerzLayaBonusQuestion,
  hackerzLayaDeployPick,
  hackerzLayaDeployQuestions,
  hackerzLayaFightDecision,
  hackerzLayaFightQuestions,
  hackerzLayaShopPick,
  hackerzLayaShopQuestions,
  type HackerzAutopilotView
} from '#shared/utils/gamelogic/hackerz-autopilot'

function board(patch: Partial<HackerzAutopilotView> = {}): HackerzAutopilotView {
  return {
    wave: 4,
    wall: 0.6,
    held: 2,
    nodes: 8,
    contacts: [
      { key: 'e0', name: 'Crawler', boss: false, hacking: true, hacker: true, d: 420, health: 0.4 },
      { key: 'e1', name: 'Daemon', boss: false, hacking: false, hacker: false, d: 180, health: 1 }
    ],
    near: 1,
    hidden: 0,
    total: 2,
    pulseReady: false,
    pingReady: false,
    overclockReady: false,
    ...patch
  }
}

describe('hackerz auto-play questions', () => {
  it('asks for a target only when there is a choice to make', () => {
    expect(hackerzLayaFightQuestions(board()).target?.criteria).toHaveProperty('e1')
    const one = board({ contacts: [board().contacts[0]!] })
    expect(hackerzLayaFightQuestions(one).target).toBeUndefined()
    expect(hackerzLayaFightDecision(one, {}).target).toBe('e0')
  })

  it('asks about an ability only when it is ready and useful', () => {
    expect(hackerzLayaFightQuestions(board()).pulse).toBeUndefined()
    expect(hackerzLayaFightQuestions(board({ pulseReady: true })).pulse).toBeDefined()
    expect(hackerzLayaFightQuestions(board({ pingReady: true })).ping).toBeUndefined()
    expect(hackerzLayaFightQuestions(board({ pingReady: true, hidden: 3 })).ping).toBeDefined()
  })

  it('reads only answers that name a real contact, and abilities above even odds', () => {
    const view = board({ pulseReady: true })
    expect(hackerzLayaFightDecision(view, { target: { choice: 'e1' }, pulse: { noul: 0.8 } }))
      .toEqual({ target: 'e1', pulse: true, ping: false, overclock: false })
    expect(hackerzLayaFightDecision(view, { target: { choice: 'e9' }, pulse: { noul: 0.3 } }).target).toBeNull()
  })

  it('swaps guns by matchup: chains for a crowd, the right damage type for a lone target', () => {
    const guns = [
      { id: 'rail', name: 'Packet Rail', tag: 'all-rounder', damageType: 'energy' as const, dps: 60, multi: false },
      { id: 'arc', name: 'Tesla Coil', tag: 'chains', damageType: 'energy' as const, dps: 56, multi: true },
      { id: 'sniper', name: 'Longbore', tag: 'pierce', damageType: 'kinetic' as const, dps: 70, multi: false }
    ]
    const tank = { key: 'e0', name: 'Siege Tank', boss: false, hacking: false, hacker: false, d: 300, health: 1, plated: true }
    const crawler = { ...tank, name: 'Crawler', plated: false }
    const quiet = board({ near: 1, total: 1 })
    const crowd = board({ near: 10, total: 30 })
    expect(hackerzGunForMatchup(quiet, tank, guns, 'rail')).toBe('sniper')
    expect(hackerzGunForMatchup(crowd, crawler, guns, 'rail')).toBe('arc')
    // A gun only a little better is not worth the reload.
    expect(hackerzGunForMatchup(quiet, crawler, guns, 'rail')).toBeNull()
    expect(hackerzGunForMatchup(quiet, tank, [guns[0]!], 'rail')).toBeNull()
  })

  it('asks about a deployable only where it would do real work, and uses the surest yes', () => {
    const stock = [
      { id: 'surge', name: 'Power Surge', description: 'Lightning.', instant: false, count: 2 },
      { id: 'blip', name: 'Cosmic Blip', description: 'Flips a node.', instant: true, count: 1 },
      { id: 'portscan', name: 'Portscan', description: 'Pings.', instant: true, count: 0 }
    ]
    const calm = { pack: { size: 2, d: 300 }, held: 1, nodes: 8, hidden: 5, wall: 1 }
    expect(Object.keys(hackerzLayaDeployQuestions(calm, stock))).toEqual([])
    const rush = { pack: { size: 9, d: 400 }, held: 4, nodes: 8, hidden: 0, wall: 0.5 }
    expect(Object.keys(hackerzLayaDeployQuestions(rush, stock))).toEqual(['deploy_surge', 'deploy_blip'])
    // A pack still far out is not worth a placed one yet.
    expect(hackerzLayaDeployQuestions({ ...rush, pack: { size: 9, d: 900 } }, stock).deploy_surge).toBeUndefined()
    expect(hackerzLayaDeployPick({ deploy_surge: { noul: 0.7 }, deploy_blip: { noul: 0.9 } })).toBe('blip')
    expect(hackerzLayaDeployPick({ deploy_surge: { noul: 0.4 } })).toBeNull()
  })

  it('puts a bonus round to Laya only while the wall can take it', () => {
    const bonus = { name: 'BLACKOUT', tagline: 'Dark.', failBelow: 0.5, multiplier: 2, seconds: 30 }
    expect(hackerzLayaBonusQuestion(bonus, 0.55, 7)).toBeNull()
    expect(hackerzLayaBonusQuestion(bonus, 0.9, 7)?.type).toBe('noul')
    expect(hackerzLayaBonusPick({ bonus: { noul: 0.8 } })).toBe(true)
    expect(hackerzLayaBonusPick({ bonus: { noul: 0.3 } })).toBe(false)
  })

  it('offers no way to buy nothing, and picks only a listed offer', () => {
    const offers = [{ key: 'repair', text: 'repair the wall' }, { key: 'u_damage', text: 'Payload Amp' }]
    const shopView = { nextWave: 5, wall: 0.5, credits: 900, gun: 'Packet Rail', mounts: 6, filled: 2, held: 3, nodes: 8 }
    expect(Object.keys(hackerzLayaShopQuestions(shopView, offers).buy.criteria!)).toEqual(['repair', 'u_damage'])
    expect(hackerzLayaShopPick(offers, { buy: { choice: 'u_damage' } })?.key).toBe('u_damage')
    expect(hackerzLayaShopPick(offers, { buy: { choice: 'save' } })).toBeNull()
  })
})
