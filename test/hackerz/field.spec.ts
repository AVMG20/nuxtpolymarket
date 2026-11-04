import { describe, expect, it } from 'vitest'
import { MOUNT_U, WALL_HALF_LENGTH, mountPosition } from '../../app/utils/hackerz-engine/constants'
import { HACKERZ_MAX_SLOTS } from '#shared/utils/gamelogic/hackerz'

describe('hackerz field geometry', () => {
  it('has a distinct mount on the wall for every slot the shop can sell', () => {
    expect(MOUNT_U.length).toBe(HACKERZ_MAX_SLOTS)
    expect(new Set(MOUNT_U).size).toBe(MOUNT_U.length)
    for (let slot = 0; slot < HACKERZ_MAX_SLOTS; slot++) {
      expect(Math.abs(mountPosition(slot).u)).toBeLessThan(WALL_HALF_LENGTH)
    }
  })
})
