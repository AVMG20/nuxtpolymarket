import { describe, expect, it } from 'vitest'
import {
  MOUNTS_PER_FLOOR,
  TOWER_MAX_FLOORS,
  TOWER_W,
  TOWER_X,
  VIEW_W,
  WALL_TOP_Y,
  mountPosition,
  muzzleY,
  towerFloors,
  towerTopY
} from '../../app/utils/firewall-engine/constants'
import { FIREWALL_MAX_SLOTS, firewallSlots } from '#shared/utils/gamelogic/firewall'

/**
 * The tower is the one piece of the UI that is pure geometry, so it is the one
 * piece that can be held to its design promises in a test rather than a
 * screenshot: it starts as one storey, it grows with the mounts bought, and it
 * never grows off the top of a fixed 720px field.
 */
describe('tower geometry', () => {
  it('starts as a single storey', () => {
    expect(towerFloors(firewallSlots(0, 0))).toBe(1)
  })

  it('adds a storey for every pair of mounts, and never more', () => {
    expect(towerFloors(2)).toBe(1)
    expect(towerFloors(3)).toBe(2)
    expect(towerFloors(4)).toBe(2)
    expect(towerFloors(6)).toBe(3)
    expect(towerFloors(FIREWALL_MAX_SLOTS)).toBe(TOWER_MAX_FLOORS)
    // A slot count past the cap cannot push the tower through the ceiling.
    expect(towerFloors(99)).toBe(TOWER_MAX_FLOORS)
  })

  it('grows strictly taller as mounts are bought', () => {
    let previous = Infinity
    for (let slots = 2; slots <= FIREWALL_MAX_SLOTS; slots += MOUNTS_PER_FLOOR) {
      const top = towerTopY(slots)
      expect(top).toBeLessThan(previous)
      previous = top
    }
  })

  it('stays on screen at full height', () => {
    const top = towerTopY(FIREWALL_MAX_SLOTS)
    // Headroom for the roof trim and the beacon that sit above `towerTopY`.
    expect(top).toBeGreaterThan(30)
    expect(muzzleY(FIREWALL_MAX_SLOTS)).toBeGreaterThan(0)
  })

  it('keeps the rail muzzle on the roof at every height', () => {
    for (let slots = 2; slots <= FIREWALL_MAX_SLOTS; slots++) {
      expect(muzzleY(slots)).toBeLessThan(towerTopY(slots))
      expect(muzzleY(slots)).toBeGreaterThan(towerTopY(slots) - 40)
    }
  })

  it('spaces every mount horizontally, two per storey', () => {
    const seen = new Set<string>()
    for (let slot = 0; slot < FIREWALL_MAX_SLOTS; slot++) {
      const mount = mountPosition(slot)
      // No two mounts share a position, or one turret would hide another.
      const key = `${mount.x}:${mount.y}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)

      // Balconies hang off the two outer faces, never inside the shaft.
      expect(mount.x === TOWER_X - 2 || mount.x === TOWER_X + TOWER_W + 2).toBe(true)
      expect(mount.facing).toBe(slot % MOUNTS_PER_FLOOR === 0 ? -1 : 1)
      // And they stay inside the field, above the wall, below the roof.
      expect(mount.x).toBeGreaterThan(0)
      expect(mount.x).toBeLessThan(VIEW_W)
      expect(mount.y).toBeLessThan(WALL_TOP_Y)
      expect(mount.y).toBeGreaterThan(towerTopY(FIREWALL_MAX_SLOTS))
    }
  })

  it('puts the two mounts of a storey at the same height, on opposite faces', () => {
    for (let floor = 0; floor < TOWER_MAX_FLOORS; floor++) {
      const left = mountPosition(floor * MOUNTS_PER_FLOOR)
      const right = mountPosition(floor * MOUNTS_PER_FLOOR + 1)
      expect(left.y).toBe(right.y)
      expect(right.x - left.x).toBe(TOWER_W + 4)
    }
  })

  it('fills mounts from the ground storey up', () => {
    expect(mountPosition(0).y).toBeGreaterThan(mountPosition(2).y)
    expect(mountPosition(2).y).toBeGreaterThan(mountPosition(4).y)
  })
})
