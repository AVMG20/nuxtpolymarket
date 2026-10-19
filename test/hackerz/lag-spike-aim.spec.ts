import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HACKERZ_ENEMIES } from '#shared/utils/gamelogic/hackerz'
import { placeEnemy } from '../../app/utils/hackerz-engine/game/bodies'
import { PacketLoss } from '../../app/utils/hackerz-engine/game/packet-loss'
import { GLITCH_FADE_MS } from '../../app/utils/hackerz-engine/game/tuning'
import type { HackerzGame } from '../../app/utils/hackerz-engine/hackerz-game'
import type { EnemyEntity } from '../../app/utils/hackerz-engine/types'

/*
 * During a PACKET LOSS spike the turrets aim at where a unit is seen. A unit
 * glitching after a blast is drawn skipped off its spot by cosmetic
 * `Math.random`, so the aim must come from the spot it was drawn at, not
 * from the skipped rig, or a run's outcome moves with every cosmetic roll.
 */

/** A unit standing at (u, d), glitching at full strength. */
function glitchingUnit(u: number, d: number) {
  const def = HACKERZ_ENEMIES.find(e => !(e.altitude ?? 0))!
  return {
    def,
    u,
    d,
    altitude: 0,
    hover: 0,
    burrowMs: 0,
    riseMs: 0,
    glitchMs: GLITCH_FADE_MS,
    rig: { height: 2, root: { position: new THREE.Vector3() } }
  } as unknown as EnemyEntity
}

/** mulberry32: a repeatable `Math.random` stand-in. */
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

/** Where a spike sees a glitching unit after a few frames drawn under the given cosmetic rolls. */
function seenUnder(seed: number) {
  vi.spyOn(Math, 'random').mockImplementation(seeded(seed))
  const enemy = glitchingUnit(0.3, 0.6)
  for (let frame = 0; frame < 8; frame++) placeEnemy(enemy)
  const lag = new PacketLoss({} as HackerzGame)
  lag.boardLagMs = 1000
  return { seen: lag.seenAt(enemy), drawn: enemy.rig.root.position.clone() }
}

describe('Hackerz lag-spike aim', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sees a glitching unit where it stands, not where its picture skipped to', () => {
    const runs = [1, 2, 3, 4, 5].map(seenUnder)
    // The rolls do move the picture, so the check below is not vacuous.
    expect(new Set(runs.map(r => `${r.drawn.x},${r.drawn.z}`)).size).toBeGreaterThan(1)
    for (const run of runs) expect(run.seen).toEqual({ u: 0.3, d: 0.6 })
  })

  it('sees a unit where it really is when no spike is on, and where it was drawn during one', () => {
    const enemy = glitchingUnit(0.3, 0.6)
    placeEnemy(enemy)
    enemy.u = 0.5
    const lag = new PacketLoss({} as HackerzGame)
    expect(lag.seenAt(enemy)).toEqual({ u: 0.5, d: 0.6 })
    lag.boardLagMs = 1000
    expect(lag.seenAt(enemy)).toEqual({ u: 0.3, d: 0.6 })
  })
})
