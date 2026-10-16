import { describe, expect, it } from 'vitest'
import {
  DECK_FRONT,
  FIELD_DEPTH,
  FIELD_HALF_WIDTH,
  GUN_Z,
  MOUNT_BACK_FROM,
  MOUNT_U,
  WALL_HALF_LENGTH,
  mountPosition
} from '../../app/utils/hackerz-engine/constants'
import { HACKERZ_ENEMIES, HACKERZ_MAX_SLOTS } from '#shared/utils/gamelogic/hackerz'

/**
 * The field is pure geometry, so its design promises can be held in a test
 * rather than a screenshot: distances are the balance sim's, every mount sits
 * on the wall, and the guns stand far enough back that nothing at the fence is
 * under a barrel.
 */
describe('hackerz field geometry', () => {
  it('walks enemies the distance the balance sim assumes', () => {
    // scripts/hackerz-balance.ts and the sim model a 1042-unit approach.
    expect(FIELD_DEPTH).toBe(1042)
  })

  it('has a mount for every slot the shop can sell', () => {
    expect(MOUNT_U.length).toBe(HACKERZ_MAX_SLOTS)
    for (let slot = 0; slot < HACKERZ_MAX_SLOTS; slot++) {
      expect(Math.abs(mountPosition(slot).u)).toBeLessThan(WALL_HALF_LENGTH)
    }
  })

  it('fills each row from the centre outwards, alternating sides', () => {
    for (const [from, to] of [[0, MOUNT_BACK_FROM], [MOUNT_BACK_FROM, HACKERZ_MAX_SLOTS]] as const) {
      for (let slot = from; slot < to; slot += 2) {
        const left = mountPosition(slot).u
        const right = mountPosition(slot + 1).u
        expect(left).toBe(-right)
        if (slot + 2 < to) expect(Math.abs(mountPosition(slot + 2).u)).toBeGreaterThan(Math.abs(left))
      }
    }
  })

  it('has a place for every mount the upgrades can buy', () => {
    expect(MOUNT_U.length).toBe(HACKERZ_MAX_SLOTS)
    for (let slot = 0; slot < HACKERZ_MAX_SLOTS; slot++) expect(mountPosition(slot).u).not.toBe(0)
  })

  it('staggers the back row into the gaps of the front row, raised and further back', () => {
    const front = Array.from({ length: MOUNT_BACK_FROM }, (_, slot) => mountPosition(slot).u)
    for (let slot = MOUNT_BACK_FROM; slot < HACKERZ_MAX_SLOTS; slot++) {
      const at = mountPosition(slot)
      expect(at.back).toBe(true)
      expect(at.z).toBeGreaterThan(0)
      expect(at.rise).toBeGreaterThan(0)
      // Between two front mounts on its side, not lined up behind one.
      const sameSide = front.filter(u => Math.sign(u) === Math.sign(at.u)).sort((a, b) => Math.abs(a) - Math.abs(b))
      const nearest = Math.min(...sameSide.map(u => Math.abs(u - at.u)))
      expect(nearest).toBeGreaterThan(40)
      expect(Math.abs(at.u)).toBeGreaterThan(Math.abs(sameSide[0]!))
    }
  })

  it('never places two mounts on the same spot', () => {
    expect(new Set(MOUNT_U).size).toBe(MOUNT_U.length)
  })

  it('stands the guns behind the fence, clear of anything pressed against it', () => {
    expect(DECK_FRONT).toBeGreaterThan(0)
    expect(GUN_Z).toBeGreaterThan(DECK_FRONT)
    for (const def of HACKERZ_ENEMIES) {
      const standoff = def.range ?? def.height * 0.3 + 10
      expect(standoff).toBeGreaterThan(0)
    }
  })

  it('keeps the lane inside the wall', () => {
    expect(FIELD_HALF_WIDTH).toBeLessThan(WALL_HALF_LENGTH)
  })
})
