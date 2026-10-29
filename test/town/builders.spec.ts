import { describe, expect, it } from 'vitest'
import {
    TOWN_BUILDER_GEM_COSTS,
    TOWN_FREE_BUILDERS,
    TOWN_MAX_BUILDERS,
    townBuilderGemCost,
    townBuildersBusy,
    townBuildersFree,
    type TownBuildingId,
    type TownSimBuilding
} from '#shared/utils/gamelogic/town'

const T0 = 1_700_000_000_000

function b(id: string, type: TownBuildingId, over: Partial<TownSimBuilding> = {}): TownSimBuilding {
    return {
        id,
        type,
        level: 1,
        completesAt: T0 - 60_000,
        upgradingTo: null,
        createdAt: T0 - 60_000,
        ...over
    }
}

/** A first build still running: level 0 with the clock ahead of us. */
const building = (id: string) => b(id, 'farm', { level: 0, completesAt: T0 + 60_000 })
/** An upgrade still running. */
const upgrading = (id: string) => b(id, 'farm', { level: 3, upgradingTo: 4, completesAt: T0 + 60_000 })

describe('townBuildersBusy', () => {
    it('counts a first build and an upgrade alike', () => {
        expect(townBuildersBusy([building('a')], T0)).toBe(1)
        expect(townBuildersBusy([upgrading('a')], T0)).toBe(1)
        expect(townBuildersBusy([building('a'), upgrading('c'), b('d', 'mill')], T0)).toBe(2)
    })

    it('frees the crew the moment the clock runs out', () => {
        const jobs = [building('a'), upgrading('c')]
        expect(townBuildersBusy(jobs, T0)).toBe(2)
        expect(townBuildersBusy(jobs, T0 + 60_000)).toBe(0)
    })

    it('never counts a finished building that is simply standing there', () => {
        // A level-4 building with no upgrade running holds nobody, even though
        // its completesAt is in the past.
        expect(townBuildersBusy([b('a', 'farm', { level: 4 })], T0)).toBe(0)
    })
})

describe('townBuildersFree', () => {
    it('is what is left of the crews the town owns', () => {
        expect(townBuildersFree([], TOWN_FREE_BUILDERS, T0)).toBe(TOWN_FREE_BUILDERS)
        expect(townBuildersFree([building('a')], 2, T0)).toBe(1)
        expect(townBuildersFree([building('a'), upgrading('c')], 2, T0)).toBe(0)
    })

    it('never goes negative, however many jobs are somehow running', () => {
        const jobs = [building('a'), upgrading('c'), building('d')]
        expect(townBuildersFree(jobs, 2, T0)).toBe(0)
    })
})

describe('townBuilderGemCost', () => {
    it('prices each crew above the free ones, and stops at the cap', () => {
        expect(townBuilderGemCost(TOWN_FREE_BUILDERS)).toBe(TOWN_BUILDER_GEM_COSTS[0])
        expect(townBuilderGemCost(TOWN_FREE_BUILDERS + 1)).toBe(TOWN_BUILDER_GEM_COSTS[1])
        expect(townBuilderGemCost(TOWN_MAX_BUILDERS)).toBeNull()
    })
})
