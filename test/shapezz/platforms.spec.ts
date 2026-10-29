import { describe, expect, it } from 'vitest'
import { shapezzRollPlatforms } from '#shared/utils/gamelogic/shapezz'

const FLOOR_Y = 662
const WIDTH = 1280
/** A bare account's jump apex (930 px/s against 1900 px/s² gravity). */
const JUMP_APEX = 930 * 930 / (2 * 1900)

describe('SHAPEZZ platform rolls', () => {
  it('keeps every ledge inside the arena and reachable from the floor', () => {
    const problems: string[] = []
    for (let roll = 0; roll < 200; roll++) {
      const platforms = shapezzRollPlatforms()
      if (platforms.length < 2 || platforms.length > 7) problems.push(`roll ${roll}: ${platforms.length} ledges`)
      for (const platform of platforms) {
        const tag = `roll ${roll} ledge ${platform.x},${platform.y}`
        if (platform.x < 0 || platform.x + platform.width > WIDTH) problems.push(`${tag}: outside the arena`)
        if (platform.y >= FLOOR_Y) problems.push(`${tag}: below the floor`)
        const supports = [{ x: 0, y: FLOOR_Y, width: WIDTH }, ...platforms.filter(other => other.y > platform.y)]
        const reachable = supports.some(support => support.y - platform.y < JUMP_APEX - 30
          && platform.x < support.x + support.width && support.x < platform.x + platform.width)
        if (!reachable) problems.push(`${tag}: out of reach`)
      }
    }
    expect(problems).toEqual([])
  })
})
