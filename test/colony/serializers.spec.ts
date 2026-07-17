import { describe, expect, it } from 'vitest'
import {
  foragedDisplay,
  serializePlacedBugs,
  serializeBugInventory,
  serializeUpgradeTracks,
  serializeBuilder
} from '../../server/utils/colony'
import { deriveTrackModifiers, getBug, habitatLevelUpDurationMs, trackLevelDurationMs } from '../../shared/utils/colony'

/** Minimal colonyBugs row fixture — only the fields the pure serializers read. */
function makeBug(overrides: Partial<{ id: string, typeId: string, speed: number, yield: number, eat: number, tickProgressMs: number }> = {}) {
  return {
    id: 'bug-1',
    userId: 'user-1',
    typeId: 'larva',
    speed: 0,
    yield: 1,
    eat: 2,
    inTerrarium: true,
    tickProgressMs: 0,
    createdAt: new Date(),
    ...overrides
  }
}

const baseMods = deriveTrackModifiers({})

describe('foragedDisplay', () => {
  it('special-cases gem-producing species instead of looking up an item', () => {
    const gemSnail = getBug('gem_snail')
    expect(foragedDisplay(gemSnail)).toEqual({ emoji: '💎', name: 'Gems', sellValue: 0 })
  })

  it('looks up the foraged item for a normal species', () => {
    const larva = getBug('larva')
    expect(foragedDisplay(larva)).toEqual({ emoji: '🧵', name: 'Silk Scrap', sellValue: 50 })
  })

  it('falls back to placeholders when the type is unknown', () => {
    expect(foragedDisplay(undefined)).toEqual({ emoji: '❓', name: 'Item', sellValue: 0 })
  })
})

describe('serializePlacedBugs', () => {
  it('derives a normal bug\'s tick/yield/feed stats from its type and track modifiers', () => {
    const bug = makeBug({ typeId: 'larva', speed: 0, yield: 1, eat: 2 })
    const { bugs, nutritionDrainPerHour } = serializePlacedBugs([bug], baseMods, false)

    expect(bugs).toHaveLength(1)
    const dto = bugs[0]!
    expect(dto.tickMs).toBe(240_000)
    expect(dto.itemsPerTickMin).toBe(1)
    expect(dto.itemsPerTickMax).toBe(2)
    expect(dto.itemTypeId).toBe('silk')
    expect(dto.feedPerHour).toBeCloseTo(30)
    expect(nutritionDrainPerHour).toBeCloseTo(30)
  })

  it('bumps effective yield and shortens tick time while the gem-feed buff is active', () => {
    const bug = makeBug({ typeId: 'larva', speed: 0, yield: 1, eat: 2 })
    const buffed = serializePlacedBugs([bug], baseMods, true).bugs[0]!
    const unbuffed = serializePlacedBugs([bug], baseMods, false).bugs[0]!

    expect(buffed.itemsPerTickMax).toBe(unbuffed.itemsPerTickMax + 1)
    expect(buffed.tickMs).toBeLessThan(unbuffed.tickMs)
  })

  it('routes gem-producing species through the fixed-cycle gem branch, not the item roll', () => {
    const bug = makeBug({ typeId: 'gem_snail', speed: 0, yield: 1, eat: 8 })
    const { bugs, nutritionDrainPerHour } = serializePlacedBugs([bug], baseMods, false)

    const dto = bugs[0]!
    expect(dto.itemTypeId).toBe('')
    expect(dto.itemEmoji).toBe('💎')
    expect(dto.gemsPerCycle).toBe(1)
    expect(dto.itemsPerTickMin).toBe(dto.itemsPerTickMax)
    expect(dto.tickMs).toBe(86_400_000)
    expect(nutritionDrainPerHour).toBeCloseTo(dto.feedPerHour)
  })
})

describe('serializeBugInventory', () => {
  it('stacks unplaced bugs that share type and rolled traits, keeping different rolls separate', () => {
    const stacked = serializeBugInventory([
      makeBug({ id: 'a', typeId: 'larva', speed: 10, yield: 2, eat: 3 }),
      makeBug({ id: 'b', typeId: 'larva', speed: 10, yield: 2, eat: 3 }),
      makeBug({ id: 'c', typeId: 'larva', speed: 15, yield: 2, eat: 3 })
    ], baseMods)

    expect(stacked).toHaveLength(2)
    const matched = stacked.find(s => s.speed === 10)!
    const distinct = stacked.find(s => s.speed === 15)!
    expect(matched.quantity).toBe(2)
    expect(distinct.quantity).toBe(1)
  })

  it('computes gem-species feed rate off the fixed gem cycle instead of effectiveFeedPerHour', () => {
    const [dto] = serializeBugInventory([makeBug({ typeId: 'gem_snail', speed: 0, yield: 1, eat: 8 })], baseMods)
    expect(dto!.producesGems).toBe(true)
    expect(dto!.feedPerHour).toBeCloseTo(8 * (3_600_000 / 86_400_000))
  })
})

describe('serializeUpgradeTracks', () => {
  it('nulls out next-step fields once a track is maxed', () => {
    const tracks = serializeUpgradeTracks({ capacity: 15 }, 1)
    const capacity = tracks.find(t => t.id === 'capacity')!
    expect(capacity.atMax).toBe(true)
    expect(capacity.nextEffect).toBeNull()
    expect(capacity.nextCost).toBeNull()
    expect(capacity.nextDurationMs).toBeNull()
  })

  it('flags whether the current level meets the habitat requirement for the next step', () => {
    const tracks = serializeUpgradeTracks({ capacity: 0 }, 1)
    const capacity = tracks.find(t => t.id === 'capacity')!
    expect(capacity.atMax).toBe(false)
    expect(capacity.nextCost).not.toBeNull()
    expect(capacity.meetsHabitatRequirement).toBe(false)
  })
})

describe('serializeBuilder', () => {
  const startedAt = new Date('2026-01-01T00:00:00Z')

  it('is null when no job is running', () => {
    expect(serializeBuilder({ builderTrackId: null, builderStartedAt: null, habitatLevel: 1 } as never, {})).toBeNull()
  })

  it('builds a habitat job DTO, one level above the current habitat level', () => {
    const builder = serializeBuilder({ builderTrackId: 'habitat_level', builderStartedAt: startedAt, habitatLevel: 3 } as never, {})
    expect(builder).toMatchObject({ kind: 'habitat', trackName: 'Habitat', level: 4 })
    expect(builder!.completesAt).toBe(new Date(startedAt.getTime() + habitatLevelUpDurationMs(3)).toISOString())
  })

  it('builds a track job DTO, one level above the track\'s current level', () => {
    const builder = serializeBuilder({ builderTrackId: 'capacity', builderStartedAt: startedAt, habitatLevel: 1 } as never, { capacity: 2 })
    expect(builder).toMatchObject({ kind: 'track', trackId: 'capacity', trackName: 'Terrarium Capacity', level: 3 })
    expect(builder!.completesAt).toBe(new Date(startedAt.getTime() + trackLevelDurationMs(3)).toISOString())
  })
})
