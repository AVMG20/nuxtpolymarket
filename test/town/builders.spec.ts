import { describe, expect, it } from 'vitest'
import {
    TOWN_BUILDER_GEM_COSTS,
    TOWN_FREE_BUILDERS,
    TOWN_MAX_BUILDERS,
    TOWN_BUILDINGS,
    TOWN_LEVEL_VISUAL_STEP,
    TOWN_MAX_BUILDING_LEVEL,
    townBuildingMaxLevel,
    TOWN_LEVEL_COST_GROWTH,
    TOWN_LEVEL_RESOURCE_GROWTH,
    TOWN_MAX_BUILD_MS_BY_TIER,
    getTownBuilding,
    townBuilderGemCost,
    townBuildersBusy,
    townBuildersFree,
    townLevelBuildMs,
    townLevelCost,
    townMaxBuildMs,
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
    it('counts nothing in a town where every clock has run out', () => {
        expect(townBuildersBusy([], T0)).toBe(0)
        expect(townBuildersBusy([b('a', 'farm'), b('c', 'mill')], T0)).toBe(0)
    })

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

    it('climbs with every crew hired', () => {
        for (let i = 1; i < TOWN_BUILDER_GEM_COSTS.length; i++) {
            expect(TOWN_BUILDER_GEM_COSTS[i]!).toBeGreaterThan(TOWN_BUILDER_GEM_COSTS[i - 1]!)
        }
        expect(TOWN_BUILDER_GEM_COSTS).toHaveLength(TOWN_MAX_BUILDERS - TOWN_FREE_BUILDERS)
    })
})

describe('the build-time wall is per tier', () => {
    it('gives every tier its own ceiling, rising with the tier', () => {
        for (let tier = 1; tier <= 6; tier++) {
            expect(townMaxBuildMs({ tier })).toBe(TOWN_MAX_BUILD_MS_BY_TIER[tier])
            expect(townMaxBuildMs({ tier })).toBeGreaterThanOrEqual(townMaxBuildMs({ tier: tier - 1 }))
        }
    })

    it('caps a maxed tier-1 building well below a maxed tier-6 one', () => {
        const farm = getTownBuilding('farm')!
        const emporium = getTownBuilding('emporium')!
        const farmTop = townLevelBuildMs(farm, TOWN_MAX_BUILDING_LEVEL)
        const emporiumTop = townLevelBuildMs(emporium, TOWN_MAX_BUILDING_LEVEL)
        expect(farmTop).toBe(TOWN_MAX_BUILD_MS_BY_TIER[1])
        expect(emporiumTop).toBe(TOWN_MAX_BUILD_MS_BY_TIER[6])
        expect(emporiumTop).toBeGreaterThan(farmTop * 8)
    })
})

describe('goods climb faster than coins', () => {
    it('scales resources by the steeper growth and coins by the gentler one', () => {
        const kiln = getTownBuilding('kiln')!
        const level = 8
        const cost = townLevelCost(kiln, level)
        expect(cost.coins).toBe(Math.round(kiln.cost.coins * TOWN_LEVEL_COST_GROWTH ** (level - 1)))

        const goodsFactor = TOWN_LEVEL_RESOURCE_GROWTH ** (level - 1)
        expect(cost.resources.wood).toBe(
            Math.round(kiln.cost.resources.wood! * goodsFactor)
        )
        expect(TOWN_LEVEL_RESOURCE_GROWTH).toBeGreaterThan(TOWN_LEVEL_COST_GROWTH)
    })

    it('makes the last levels cost far more goods than coins, relatively', () => {
        const farm = getTownBuilding('farm')!
        const coinRatio = townLevelCost(farm, 20).coins / townLevelCost(farm, 2).coins
        const woodRatio = townLevelCost(farm, 20).resources.wood! / townLevelCost(farm, 2).resources.wood!
        expect(woodRatio).toBeGreaterThan(coinRatio * 2)
    })
})

describe('per-building level caps', () => {
    it('stops a park and a warehouse short of the global cap', () => {
        expect(townBuildingMaxLevel(getTownBuilding('park')!)).toBeLessThan(TOWN_MAX_BUILDING_LEVEL)
        expect(townBuildingMaxLevel(getTownBuilding('warehouse')!)).toBeLessThan(TOWN_MAX_BUILDING_LEVEL)
    })

    it('lets every workshop and every house reach the cap', () => {
        for (const def of TOWN_BUILDINGS) {
            if (def.kind !== 'industry' && def.kind !== 'housing') continue
            expect(townBuildingMaxLevel(def)).toBe(TOWN_MAX_BUILDING_LEVEL)
        }
    })

    it('lands every cap on a level where the model finishes a look', () => {
        for (const def of TOWN_BUILDINGS) {
            if (def.kind === 'road') continue
            expect(townBuildingMaxLevel(def) % TOWN_LEVEL_VISUAL_STEP).toBe(0)
        }
    })

    it('gives roads no levels at all', () => {
        expect(townBuildingMaxLevel(getTownBuilding('road')!)).toBe(1)
    })
})
