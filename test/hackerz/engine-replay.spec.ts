import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  HACKERZ_DEPLOYABLES, hackerzEmptyArmoury, hackerzEmptyMainframe, hackerzLoadout, type HackerzEventId, type HackerzLoadout
} from '#shared/utils/gamelogic/hackerz'

/*
 * The Hackerz engine, played headless: a few fixed, fully seeded waves hashed
 * once a simulated second. The engine's systems run in a fixed order each
 * frame, and later ones act on what earlier ones did that frame, so a
 * reordered `tick`, or a changed shared helper, shows up here as a changed
 * hash.
 *
 * `Math.random` is the picture's alone (particles, glitch skips, log lines),
 * so how a wave plays must never depend on it. The PACKET LOSS round checks
 * that by replaying under different cosmetic rolls: during its lag spikes
 * the turrets aim at a unit's frozen picture (see `PacketLoss.seenAt`).
 *
 * When a change is meant to change how the game plays, update the snapshot
 * below, and say so in the commit.
 */

// No GPU here: an inert renderer stands in, and draw calls are skipped.
vi.mock('three', async (importOriginal) => {
  const THREE = await importOriginal<typeof import('three')>()
  class HeadlessRenderer {
    domElement = fakeElement()
    toneMapping = 0
    toneMappingExposure = 1
    outputColorSpace = ''
    getPixelRatio() { return 1 }
    setPixelRatio() {}
    getSize(target: InstanceType<typeof THREE.Vector2>) { return target.set(1280, 720) }
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...THREE, WebGLRenderer: HeadlessRenderer }
})
// The models are built-in stand-ins: nothing to fetch.
vi.mock('../../app/utils/hackerz-engine/models', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../app/utils/hackerz-engine/models')>(),
  loadModels: async () => {}
}))

/** A DOM element (or 2D canvas) that takes every call and does nothing. */
function fakeElement(): Record<string, unknown> {
  const call = (key: string | symbol) => {
    if (key === 'measureText') return () => ({ width: 10 })
    return () => ({ addColorStop() {} })
  }
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : call(key)),
    set: (target, key, value) => {
      target[key] = value
      return true
    }
  })
  return {
    style: {},
    width: 256,
    height: 256,
    clientWidth: 1280,
    clientHeight: 720,
    classList: { add() {} },
    appendChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    getContext: () => context
  }
}

/** mulberry32, the same small generator the engine's demo boards use. */
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DEPLOY_ORDER = HACKERZ_DEPLOYABLES.map(def => def.id)

function loadout(): HackerzLoadout {
  const base = hackerzLoadout(hackerzEmptyArmoury(), hackerzEmptyMainframe(), 'breach')
  return {
    ...base,
    slots: Math.max(base.slots, 3),
    turrets: [
      { id: 'gun', slot: 0, name: 'Gun', damage: 9, intervalMs: 320, range: 700, damageType: 'kinetic', pierce: 0, splashRadius: 0, splashDamage: 0, hex: 0x22d3ee },
      { id: 'warhead', slot: 1, name: 'Warhead', damage: 14, intervalMs: 1400, range: 800, damageType: 'energy', pierce: 0, splashRadius: 70, splashDamage: 10, hex: 0xf97316 },
      { id: 'lance', slot: 2, name: 'Lance', damage: 22, intervalMs: 900, range: 900, damageType: 'energy', pierce: 2, splashRadius: 0, splashDamage: 0, hex: 0xe879f9 }
    ],
    deployables: Object.fromEntries(DEPLOY_ORDER.map(id => [id, 3])) as HackerzLoadout['deployables'],
    pulseUnlocked: true,
    overclockUnlocked: true,
    wallMaxHp: 6000
  }
}

// Fixed precision: the platforms' Math.sin/cos/atan2 differ in the last bit,
// and this hash is after reordering, not float drift.
const n = (value: number) => value.toFixed(3)

/**
 * Plays `seconds` of `wave` (as the bonus round `event`, if given) on a fresh
 * engine and hashes the field every simulated second. `cosmetic` seeds
 * `Math.random`, which only the picture may read.
 */
async function play(wave: number, seconds: number, event: HackerzEventId | null = null, cosmetic = 0xc0ffee + wave) {
  const { HackerzGame } = await import('../../app/utils/hackerz-engine/hackerz-game')
  const { seededRng, withSeed } = await import('../../app/utils/hackerz-engine/rng')
  const game = new HackerzGame(new Proxy({}, { get: () => () => {} }) as never)
  await game.mount(fakeElement() as unknown as HTMLDivElement)
  // Drawing decides nothing, and there is nothing to draw on.
  game.view!.render = () => {}
  const random = vi.spyOn(Math, 'random').mockImplementation(seeded(cosmetic))
  const frames: string[] = []
  try {
    withSeed(seededRng(0x5eed + wave * 101), () => {
      const kit = loadout()
      game.startRun({ loadout: kit })
      game.startWave(wave, kit, event)
      let deploy = 0
      for (let s = 0; s < seconds; s++) {
        const lead = game.autopilotView().contacts.get('e0') ?? null
        if (lead) game.autopilotAim(lead)
        else if (!game.autopilotBlindFire()) game.autopilotAim(null)
        if (s % 7 === 3) game.autopilotAbility('pulse')
        if (s % 9 === 5) game.autopilotAbility('ping')
        if (s % 13 === 6) game.autopilotAbility('overclock')
        if (s % 6 === 2) game.autopilotDeploy(DEPLOY_ORDER[deploy++ % DEPLOY_ORDER.length]!)
        game.debugStep(1000)
        frames.push([
          ...game.enemies.map(e => [e.def.id, n(e.u), n(e.d), n(e.hp), n(e.yaw)].join(',')),
          `W${n(game.bastion.wallHp)},${n(game.bastion.shield)},${n(game.rail.mag)},${n(game.scoring.totalKills)}`,
          ...game.battery.turrets.map(m => `T${n(m.heading)},${n(m.cooldown)}`),
          ...(game.pathChips?.chips ?? []).map(c => `C${c.state},${n(c.hack)}`),
          ...game.projectiles.bullets.map(b => `B${n(b.u)},${n(b.d)}`)
        ].join('|'))
      }
    })
    return {
      hash: createHash('sha1').update(frames.join('\n')).digest('hex').slice(0, 16),
      kills: game.scoring.totalKills,
      wallHp: Math.round(game.bastion.wallHp)
    }
  } finally {
    random.mockRestore()
    game.destroy()
  }
}

beforeAll(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('document', { createElement: () => fakeElement() })
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('the hackerz engine, replayed', () => {
  it('plays a wave exactly as it did', async () => {
    expect(await play(3, 40)).toEqual({ hash: '019db90981f70051', kills: 55, wallHp: 6000 })
  })

  it('plays a ROOTKIT wave exactly as it did', async () => {
    expect(await play(5, 40)).toEqual({ hash: '76442b542c2fd22f', kills: 71, wallHp: 5861 })
  })

  it('plays a BLACK ICE wave exactly as it did', async () => {
    expect(await play(10, 40)).toEqual({ hash: 'a1e4e5257154b5e9', kills: 51, wallHp: 5371 })
  })

  it('plays a PACKET LOSS round exactly as it did', async () => {
    expect(await play(8, 30, 'packetloss')).toEqual({ hash: '507c76972eeb46c4', kills: 12, wallHp: 5581 })
  })

  it('plays a PACKET LOSS round the same whatever the cosmetic rolls', async () => {
    // Its lag spikes are where cosmetic randomness once leaked into the aim.
    const runs = []
    for (const cosmetic of [1, 2, 3]) runs.push(await play(8, 30, 'packetloss', cosmetic))
    expect(runs[1]).toEqual(runs[0])
    expect(runs[2]).toEqual(runs[0])
  })
})
