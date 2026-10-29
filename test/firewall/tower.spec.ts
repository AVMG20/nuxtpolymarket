import { describe, expect, it } from 'vitest'
import { VIEW_W, mountPosition } from '../../app/utils/firewall-engine/constants'
import { FIREWALL_MAX_SLOTS } from '#shared/utils/gamelogic/firewall'

describe('tower geometry', () => {
  it('gives every slot the shop can sell its own on-screen mount', () => {
    // No two mounts share a position, or one bought turret would hide another.
    const seen = new Set<string>()
    for (let slot = 0; slot < FIREWALL_MAX_SLOTS; slot++) {
      const mount = mountPosition(slot)
      seen.add(`${mount.x}:${mount.y}`)
      expect(mount.x).toBeGreaterThan(0)
      expect(mount.x).toBeLessThan(VIEW_W)
      expect(mount.y).toBeGreaterThan(0)
    }
    expect(seen.size).toBe(FIREWALL_MAX_SLOTS)
  })
})
