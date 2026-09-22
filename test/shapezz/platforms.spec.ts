import { describe, expect, it } from 'vitest'
import { shapezzRollPlatforms } from '#shared/utils/gamelogic/shapezz'

const FLOOR_Y = 662
const WIDTH = 1280
/** A bare account's jump apex (930 px/s against 1900 px/s² gravity). */
const JUMP_APEX = 930 * 930 / (2 * 1900)

describe('SHAPEZZ platform rolls', () => {
  it('keeps every ledge inside the arena and reachable from the floor', () => {
    for (let roll = 0; roll < 500; roll++) {
      const platforms = shapezzRollPlatforms()
      expect(platforms.length).toBeGreaterThanOrEqual(2)
      expect(platforms.length).toBeLessThanOrEqual(7)
      for (const platform of platforms) {
        expect(platform.x).toBeGreaterThanOrEqual(0)
        expect(platform.x + platform.width).toBeLessThanOrEqual(WIDTH)
        expect(platform.y).toBeLessThan(FLOOR_Y)
        const supports = [{ x: 0, y: FLOOR_Y, width: WIDTH }, ...platforms.filter(other => other.y > platform.y)]
        const reachable = supports.some(support => support.y - platform.y < JUMP_APEX - 30
          && platform.x < support.x + support.width && support.x < platform.x + platform.width)
        expect(reachable).toBe(true)
      }
    }
  })

  it('varies the count and size of the ledges from run to run', () => {
    const rolls = Array.from({ length: 300 }, () => shapezzRollPlatforms())
    const counts = new Set(rolls.map(platforms => platforms.length))
    const widths = rolls.flatMap(platforms => platforms.map(platform => platform.width))
    expect(counts.size).toBeGreaterThanOrEqual(4)
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(120)
  })
})
