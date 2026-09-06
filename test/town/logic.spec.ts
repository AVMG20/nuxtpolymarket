import { describe, expect, it } from 'vitest'
import {
    TOWN_BASE_STORAGE,
    TOWN_BUILDINGS,
    TOWN_FACING,
    TOWN_HAPPINESS_BASE_TARGET,
    TOWN_HAPPINESS_CROWDING_PENALTY,
    TOWN_HAPPINESS_STARVING_PENALTY,
    TOWN_INDUSTRY_MAX_PENALTY,
    TOWN_INDUSTRY_NUISANCE,
    TOWN_INDUSTRY_PENALTY_SCALE,
    TOWN_LEVEL_COST_GROWTH,
    TOWN_LEVEL_TIME_GROWTH,
    TOWN_MAX_BUILD_MS,
    TOWN_MAX_BUILDING_LEVEL,
    TOWN_MAX_OFFLINE_MS,
    TOWN_MILESTONES,
    TOWN_MOODS,
    TOWN_NEEDS,
    TOWN_PARK_MAX_BONUS,
    TOWN_PARK_RADIUS,
    TOWN_PLOT_COOLDOWN_BASE_MS,
    TOWN_PLOT_COOLDOWN_GROWTH,
    TOWN_PLOT_PRICE_BASE,
    TOWN_PLOT_PRICE_GROWTH,
    TOWN_PLOT_SIZE,
    TOWN_REPEAT_GROWTH,
    TOWN_RESOURCES,
    TOWN_ROAD_REPEAT_GROWTH,
    TOWN_RUSH_MS_PER_GEM,
    TOWN_TICK_MS,
    TOWN_TIER_POP_REQUIREMENT,
    TOWN_TIER_PRODUCTION_REQUIREMENT,
    TOWN_WAREHOUSE_STORAGE,
    adjacencyHappiness,
    deriveTown,
    getTownBuilding,
    getTownMilestone,
    houseAdjacency,
    isValidTownPrice,
    isValidTownQuantity,
    needsHappiness,
    scaleBag,
    settleTown,
    townAutoFacing,
    townBuildingsFronting,
    townEffectRadius,
    townFrontTile,
    townHousesWithin,
    townIndustryNuisance,
    townIsPlotEdge,
    townLayoutScore,
    townLevelBuildMs,
    townLevelCost,
    townMilestoneComplete,
    townMilestoneSnapshot,
    townMood,
    townNeedExpected,
    townNeedsPerTick,
    townNetPerTick,
    townNextMood,
    townOrderTotal,
    townPlaceCost,
    townPlacementIssue,
    townPlotCooldownMs,
    townPlotPrice,
    townProducedOfTier,
    townReachableTier,
    townRepeatGrowth,
    townRoadAccess,
    townRoadAt,
    townRushGemCost,
    townSpeedMultiplier,
    townSpiralCoords,
    townTierRequirement,
    townTierUnlocked,
    type TownBuildingId,
    type TownMilestoneSnapshot,
    type TownSimBuilding,
    type TownSimState
} from '#shared/utils/gamelogic/town'

const T0 = 1_700_000_000_000

/** The grain need: the only one the smallest towns have. */
const GRAIN = TOWN_NEEDS.find(n => n.resource === 'wheat')!
const BREAD = TOWN_NEEDS.find(n => n.resource === 'bread')!

const HOUSE = getTownBuilding('house')!
/** Residents one house level is worth — every workforce here is sized off this. */
const PER_HOUSE_LEVEL = HOUSE.popCap

/** How far a farm's smog carries, and what it costs a resident inside it. */
const FARM_NUISANCE = townIndustryNuisance(getTownBuilding('farm')!)
/** A tile far enough from everything that no radius in the game reaches it. */
const FAR_AWAY = 40

/** The resource tier a need's goods belong to. */
function tierOf(need: typeof GRAIN): number {
    return TOWN_RESOURCES.find(r => r.id === need.resource)!.tier
}

/** House levels needed to shelter `pop` residents. */
function houseLevelsFor(pop: number): number {
    return Math.ceil(pop / PER_HOUSE_LEVEL)
}

/** A finished building that already existed before the settle window opens. */
function built(id: string, type: TownBuildingId, over: Partial<TownSimBuilding> = {}): TownSimBuilding {
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

/** Same, but pinned to a world tile so the adjacency rules can see it. */
function at(id: string, type: TownBuildingId, wx: number, wy: number, over: Partial<TownSimBuilding> = {}): TownSimBuilding {
    return built(id, type, { wx, wy, ...over })
}

/** A road tile — instant, so it is always standing. */
function road(wx: number, wy: number): TownSimBuilding {
    return at(`road-${wx}-${wy}`, 'road', wx, wy)
}

/**
 * The same layout plus a road at every building's front door. Anything without
 * one is cut off, and deriveTown leaves it out of the town altogether.
 */
function connected(buildings: TownSimBuilding[]): TownSimBuilding[] {
    const roads = new Map<string, TownSimBuilding>()
    for (const b of buildings) {
        if (b.type === 'road' || b.wx === undefined || b.wy === undefined) continue
        const f = townFrontTile(b.wx, b.wy, b.rotation ?? 0)
        roads.set(`${f.wx},${f.wy}`, road(f.wx, f.wy))
    }
    return [...buildings, ...roads.values()]
}

function sim(over: Partial<TownSimState> = {}): TownSimState {
    return {
        happiness: 100,
        tickProgressMs: 0,
        lastSettledAt: T0,
        inventory: {},
        buildings: [],
        ...over
    }
}

// A house plus a level-2 farm is the smallest town that runs a surplus: the
// farm grows 2 wheat a tick and the house's residents eat 1 of them.
function houseAndFarm(): TownSimBuilding[] {
    return [
        built('house', 'house', { createdAt: T0 - 90_000 }),
        built('farm', 'farm', { level: 2, createdAt: T0 - 80_000 })
    ]
}

/** One house tall enough to shelter the population bread needs to appear. */
const BIG_HOUSE = built('house', 'house', { level: houseLevelsFor(BREAD.minPop), createdAt: T0 - 90_000 })
/** What that town eats every tick: grain and bread both. */
const BIG_DEMAND = townNeedsPerTick(PER_HOUSE_LEVEL * houseLevelsFor(BREAD.minPop))

describe('townSpiralCoords', () => {
    it('starts at the origin and never repeats a square', () => {
        expect(townSpiralCoords(0)).toEqual({ x: 0, y: 0 })

        const seen = new Set<string>()
        for (let i = 0; i < 25; i++) {
            const { x, y } = townSpiralCoords(i)
            seen.add(`${x},${y}`)
        }
        expect(seen.size).toBe(25)
    })

    it('walks whole rings before starting the next one', () => {
        // Ring r holds indexes (2r-1)^2 .. (2r+1)^2 - 1, and every square on it
        // has max(|x|, |y|) === r.
        for (let ring = 1; ring <= 4; ring++) {
            const start = (2 * ring - 1) ** 2
            const end = (2 * ring + 1) ** 2 - 1
            for (let i = start; i <= end; i++) {
                const { x, y } = townSpiralCoords(i)
                expect(Math.max(Math.abs(x), Math.abs(y))).toBe(ring)
            }
        }
    })

    it('keeps consecutive plots adjacent', () => {
        let prev = townSpiralCoords(0)
        for (let i = 1; i < 50; i++) {
            const next = townSpiralCoords(i)
            expect(Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y)).toBe(1)
            prev = next
        }
    })
})

describe('plot cooldown and price', () => {
    it('gives the founding plot away for free with no wait', () => {
        expect(townPlotCooldownMs(1)).toBe(0)
        expect(townPlotPrice(1)).toBe(0)
        expect(townPlotCooldownMs(0)).toBe(0)
        expect(townPlotPrice(-3)).toBe(0)
    })

    it('makes the second plot cost the base price after ten minutes', () => {
        expect(townPlotCooldownMs(2)).toBe(10 * 60_000)
        expect(townPlotCooldownMs(2)).toBe(TOWN_PLOT_COOLDOWN_BASE_MS)
        expect(townPlotPrice(2)).toBe(TOWN_PLOT_PRICE_BASE)
    })

    it('multiplies both the wait and the price for every further plot', () => {
        for (let index = 3; index <= 8; index++) {
            expect(townPlotCooldownMs(index)).toBe(Math.round(townPlotCooldownMs(index - 1) * TOWN_PLOT_COOLDOWN_GROWTH))
            // Compared against the closed form, not the previous plot: rounding
            // the running product would drift apart from it by plot eight.
            expect(townPlotPrice(index)).toBe(Math.round(TOWN_PLOT_PRICE_BASE * TOWN_PLOT_PRICE_GROWTH ** (index - 2)))
            expect(townPlotPrice(index)).toBeGreaterThan(townPlotPrice(index - 1))
        }
    })
})

describe('townRushGemCost', () => {
    it('is free once the clock has run out', () => {
        expect(townRushGemCost(0)).toBe(0)
        expect(townRushGemCost(-1)).toBe(0)
        expect(townRushGemCost(-TOWN_RUSH_MS_PER_GEM)).toBe(0)
    })

    it('charges one gem per started five minutes', () => {
        expect(townRushGemCost(1)).toBe(1)
        expect(townRushGemCost(TOWN_RUSH_MS_PER_GEM)).toBe(1)
        expect(townRushGemCost(TOWN_RUSH_MS_PER_GEM + 1)).toBe(2)
        expect(townRushGemCost(TOWN_RUSH_MS_PER_GEM * 4)).toBe(4)
        expect(townRushGemCost(TOWN_RUSH_MS_PER_GEM * 4 - 1)).toBe(4)
    })
})

describe('townLevelCost', () => {
    const mill = getTownBuilding('mill')!

    it('charges the sticker price for the first level', () => {
        expect(townLevelCost(mill, 1)).toEqual({ coins: mill.cost.coins, resources: { ...mill.cost.resources } })
    })

    it('grows coins and resources together, level over level', () => {
        for (let level = 2; level <= 10; level++) {
            const previous = townLevelCost(mill, level - 1)
            const current = townLevelCost(mill, level)
            expect(current.coins).toBe(Math.round(mill.cost.coins * TOWN_LEVEL_COST_GROWTH ** (level - 1)))
            expect(current.coins).toBeGreaterThan(previous.coins)
            expect(current.resources.wood!).toBeGreaterThan(previous.resources.wood!)
        }
    })

    it('adds the upgrade resources from level two up, never to the first build', () => {
        const house = getTownBuilding('house')!
        // A house is free to build and still costs timber to extend.
        expect(townLevelCost(house, 1).resources).toEqual({})
        expect(townLevelCost(house, 2).resources).toEqual(scaleBag(house.upgradeResources, TOWN_LEVEL_COST_GROWTH))
        expect(townLevelCost(house, 5).resources).toEqual(scaleBag(house.upgradeResources, TOWN_LEVEL_COST_GROWTH ** 4))
    })

    it('stacks the upgrade resources on top of the scaled build cost', () => {
        for (const level of [2, 3, 6]) {
            const factor = TOWN_LEVEL_COST_GROWTH ** (level - 1)
            const base = scaleBag(mill.cost.resources, factor)
            const extra = scaleBag(mill.upgradeResources, factor)
            const expected = { ...base }
            for (const [id, qty] of Object.entries(extra)) {
                expected[id as keyof typeof expected] = (expected[id as keyof typeof expected] ?? 0) + qty
            }
            expect(townLevelCost(mill, level).resources).toEqual(expected)
        }
        // Planks appear only because the upgrade asks for them.
        expect(townLevelCost(mill, 1).resources.planks).toBeUndefined()
        expect(townLevelCost(mill, 2).resources.planks).toBe(Math.round(mill.upgradeResources.planks! * TOWN_LEVEL_COST_GROWTH))
    })
})

describe('townPlaceCost', () => {
    const farm = getTownBuilding('farm')!
    const mill = getTownBuilding('mill')!
    const roadDef = getTownBuilding('road')!

    it('charges the sticker price for the first copy', () => {
        expect(townPlaceCost(farm, 0)).toEqual({ coins: farm.cost.coins, resources: { ...farm.cost.resources } })
        expect(townPlaceCost(mill, 0)).toEqual({ coins: mill.cost.coins, resources: { ...mill.cost.resources } })
        // A negative count cannot make a building cheaper than its sticker price.
        expect(townPlaceCost(farm, -4)).toEqual(townPlaceCost(farm, 0))
    })

    it('charges goods to place a farm, a quarry or a park', () => {
        // Placing these costs materials on top of the coins, and the materials
        // climb with the copy count exactly like the coins do.
        for (const id of ['farm', 'quarry', 'park'] as const) {
            const def = getTownBuilding(id)!
            expect(Object.keys(def.cost.resources).length).toBeGreaterThan(0)
            for (const [res, qty] of Object.entries(def.cost.resources) as [keyof typeof def.cost.resources, number][]) {
                expect(townPlaceCost(def, 0).resources[res]).toBe(qty)
                expect(townPlaceCost(def, 3).resources[res])
                    .toBe(Math.round(qty * townRepeatGrowth(def) ** 3))
                expect(townPlaceCost(def, 3).resources[res]!).toBeGreaterThan(qty)
            }
        }
    })

    it('keeps the bootstrap pair buyable with coins alone', () => {
        // A fresh town has no workers and so no goods: the house that houses
        // them and the camp that cuts the first wood must never ask for any.
        for (const id of ['house', 'lumber'] as const) {
            const def = getTownBuilding(id)!
            expect(def.cost.resources).toEqual({})
            for (const existing of [0, 1, 7]) expect(townPlaceCost(def, existing).resources).toEqual({})
        }
    })

    it('multiplies coins and resources by the repeat growth per existing copy', () => {
        for (const def of [farm, mill, getTownBuilding('house')!, getTownBuilding('park')!]) {
            for (const existing of [1, 2, 5, 9]) {
                const factor = townRepeatGrowth(def) ** existing
                expect(townPlaceCost(def, existing)).toEqual({
                    coins: Math.round(def.cost.coins * factor),
                    resources: scaleBag(def.cost.resources, factor)
                })
            }
        }
        expect(townPlaceCost(farm, 1).coins).toBeGreaterThan(townPlaceCost(farm, 0).coins)
        expect(townPlaceCost(farm, 2).coins).toBeGreaterThan(townPlaceCost(farm, 1).coins)
        expect(townPlaceCost(mill, 3).resources.wood!).toBeGreaterThan(townPlaceCost(mill, 0).resources.wood!)
    })

    it('climbs steeper the higher the tier, and barely at all for roads', () => {
        expect(townRepeatGrowth(roadDef)).toBe(TOWN_ROAD_REPEAT_GROWTH)
        for (const def of TOWN_BUILDINGS) {
            expect(townRepeatGrowth(def)).toBeGreaterThanOrEqual(1)
            if (def.kind !== 'road') expect(townRepeatGrowth(def)).toBeGreaterThan(TOWN_ROAD_REPEAT_GROWTH)
        }
        // A tier-6 emporium repeats harder than a tier-1 farm.
        expect(townRepeatGrowth(getTownBuilding('emporium')!)).toBeGreaterThan(townRepeatGrowth(farm))
    })

    it('lets roads climb on their own, much gentler curve', () => {
        expect(townPlaceCost(roadDef, 0).coins).toBe(roadDef.cost.coins)
        expect(townPlaceCost(roadDef, 1).coins).toBe(Math.round(roadDef.cost.coins * TOWN_ROAD_REPEAT_GROWTH))
        expect(townPlaceCost(roadDef, 20).coins).toBe(Math.round(roadDef.cost.coins * TOWN_ROAD_REPEAT_GROWTH ** 20))
        // Twenty roads still cost less than twenty of anything else would.
        expect(TOWN_ROAD_REPEAT_GROWTH).toBeLessThan(TOWN_REPEAT_GROWTH)
    })
})

describe('scaleBag', () => {
    it('rounds each entry and drops anything that rounds to zero', () => {
        expect(scaleBag({ wheat: 10, wood: 1 }, 0.4)).toEqual({ wheat: 4 })
        expect(scaleBag({ wheat: 1 }, 0)).toEqual({})
        expect(scaleBag({}, 5)).toEqual({})
    })

    it('honours the rounding function it is handed', () => {
        expect(scaleBag({ wheat: 3 }, 0.5, Math.ceil)).toEqual({ wheat: 2 })
        expect(scaleBag({ wheat: 3 }, 0.5, Math.floor)).toEqual({ wheat: 1 })
    })
})

describe('needs', () => {
    it('asks for nothing from an empty town', () => {
        expect(townNeedsPerTick(0)).toEqual({})
        expect(townNeedsPerTick(-5)).toEqual({})
    })

    it('introduces each need at its own minimum population', () => {
        expect(townNeedsPerTick(1)).toEqual({ wheat: 1 })
        expect(townNeedsPerTick(15)).toEqual({ wheat: 2 })
        // Bread joins at sixteen residents, tools at forty, luxuries at 120.
        expect(Object.keys(townNeedsPerTick(16))).toEqual(['wheat', 'bread'])
        expect(Object.keys(townNeedsPerTick(39))).toEqual(['wheat', 'bread'])
        expect(Object.keys(townNeedsPerTick(40))).toEqual(['wheat', 'bread', 'tools'])
        expect(Object.keys(townNeedsPerTick(119))).toEqual(['wheat', 'bread', 'tools'])
        expect(Object.keys(townNeedsPerTick(120))).toEqual(['wheat', 'bread', 'tools', 'luxuries'])
    })

    it('rounds the per-tick demand up, and never below one unit', () => {
        for (const need of TOWN_NEEDS) {
            const pop = Math.max(need.minPop, need.perPop * 3 + 1)
            expect(townNeedsPerTick(pop)[need.resource]).toBe(Math.ceil(pop / need.perPop))
            // At the very edge of appearing, a need still costs a whole unit.
            expect(townNeedsPerTick(need.minPop)[need.resource]).toBe(Math.max(1, Math.ceil(need.minPop / need.perPop)))
        }
        expect(townNeedsPerTick(12).wheat).toBe(1)
        expect(townNeedsPerTick(13).wheat).toBe(2)
        expect(townNeedsPerTick(24).wheat).toBe(2)
        expect(townNeedsPerTick(25).wheat).toBe(3)
    })

    it('pays a bonus per supplied need and starves a town with no food', () => {
        expect(needsHappiness({}, 0)).toBe(0)
        expect(needsHappiness({ wheat: true }, 0)).toBe(0)

        // Grain is expected of the smallest town, so going without it costs the
        // bonus as well as the starving penalty.
        expect(needsHappiness({}, 10)).toBe(-GRAIN.happiness - TOWN_HAPPINESS_STARVING_PENALTY)
        expect(needsHappiness({ wheat: true }, 10)).toBe(GRAIN.happiness)
        expect(needsHappiness({ wheat: true, bread: true }, BREAD.minPop)).toBe(GRAIN.happiness + BREAD.happiness)

        // Bread alone still counts as food, so nobody starves — but the grain
        // this town was expected to supply and did not is still a mark against it.
        expect(needsHappiness({ bread: true }, BREAD.minPop)).toBe(BREAD.happiness - GRAIN.happiness)
    })

    it('leaves a need the town is too small for off the scorecard', () => {
        const small = BREAD.minPop - 1
        // Missing bread costs a town this size nothing at all…
        expect(needsHappiness({ wheat: true }, small)).toBe(GRAIN.happiness)
        // …and buying it anyway still pays.
        expect(needsHappiness({ wheat: true, bread: true }, small)).toBe(GRAIN.happiness + BREAD.happiness)
    })

    it('only marks a town down for needs its buildings could reach', () => {
        const pop = BREAD.minPop
        const breadTier = tierOf(BREAD)

        // A tier-1 town cannot bake, so missing bread is not held against it.
        expect(needsHappiness({ wheat: true }, pop, breadTier - 1)).toBe(GRAIN.happiness)
        // The moment bread is within reach, going without it costs its bonus.
        expect(needsHappiness({ wheat: true }, pop, breadTier)).toBe(GRAIN.happiness - BREAD.happiness)
        // Bread the town was never expected to make still counts when it has it.
        expect(needsHappiness({ wheat: true, bread: true }, pop, breadTier - 1))
            .toBe(GRAIN.happiness + BREAD.happiness)
    })

    it('only starves a town that was expected to feed itself', () => {
        // No food resource is within reach, so an empty larder is nobody's fault.
        expect(needsHappiness({}, 10, tierOf(GRAIN) - 1)).toBe(0)
        // Grain within reach and missing: the bonus is lost and the town starves.
        expect(needsHappiness({}, 10, tierOf(GRAIN)))
            .toBe(-GRAIN.happiness - TOWN_HAPPINESS_STARVING_PENALTY)
    })

    it('still starves a town that has everything but food', () => {
        const tools = TOWN_NEEDS.find(n => n.resource === 'tools')!
        const pop = tools.minPop
        // Everything else this town was expected to stock is missing with it.
        const missed = TOWN_NEEDS
            .filter(n => n.resource !== tools.resource && townNeedExpected(n, pop, 99))
            .reduce((sum, n) => sum + n.happiness, 0)
        expect(needsHappiness({ tools: true }, pop))
            .toBe(tools.happiness - missed - TOWN_HAPPINESS_STARVING_PENALTY)

        const everything = { wheat: true, bread: true, tools: true, luxuries: true }
        const all = TOWN_NEEDS.reduce((sum, n) => sum + n.happiness, 0)
        expect(needsHappiness(everything, 200)).toBe(all)
    })

    it('is what deriveTown folds into the happiness target', () => {
        const town = [built('house', 'house', { level: 3 })] // six residents
        const hungry = deriveTown(town, 50, T0, {})
        const fed = deriveTown(town, 50, T0, { wheat: true })

        expect(hungry.needsPerTick).toEqual({ wheat: 1 })
        expect(hungry.happinessBreakdown.needs).toBe(-GRAIN.happiness - TOWN_HAPPINESS_STARVING_PENALTY)
        expect(fed.happinessBreakdown.needs).toBe(GRAIN.happiness)
        // Grain swings from minus its bonus to plus it, and the town stops starving.
        expect(fed.happinessTarget - hungry.happinessTarget)
            .toBe(2 * GRAIN.happiness + TOWN_HAPPINESS_STARVING_PENALTY)
    })
})

describe('townReachableTier', () => {
    it('sits one tier above the best building the town has finished', () => {
        expect(townReachableTier([], T0)).toBe(1)
        // Roads, houses and parks are all tier 0, so a starter town reaches tier 1.
        expect(townReachableTier([road(0, 0), built('h', 'house'), built('p', 'park')], T0)).toBe(1)
        expect(townReachableTier([built('farm', 'farm')], T0)).toBe(getTownBuilding('farm')!.tier + 1)
        expect(townReachableTier([built('farm', 'farm'), built('mill', 'mill')], T0))
            .toBe(getTownBuilding('mill')!.tier + 1)
    })

    it('ignores a building that is still going up', () => {
        const site = built('mill', 'mill', { level: 0, completesAt: T0 + 60_000 })
        const town = [built('farm', 'farm'), site]

        expect(townReachableTier(town, T0)).toBe(getTownBuilding('farm')!.tier + 1)
        expect(townReachableTier(town, T0 + 60_000)).toBe(getTownBuilding('mill')!.tier + 1)
    })
})

describe('townNeedExpected', () => {
    it('waits for the population the need is written for', () => {
        expect(townNeedExpected(BREAD, BREAD.minPop - 1, 99)).toBe(false)
        expect(townNeedExpected(BREAD, BREAD.minPop, 99)).toBe(true)
    })

    it('waits for a tier the town could plausibly stock', () => {
        expect(townNeedExpected(BREAD, BREAD.minPop, tierOf(BREAD) - 1)).toBe(false)
        expect(townNeedExpected(BREAD, BREAD.minPop, tierOf(BREAD))).toBe(true)
        // Grain is tier 1, so even an empty town is expected to have some.
        expect(townNeedExpected(GRAIN, GRAIN.minPop, townReachableTier([], T0))).toBe(true)
    })
})

describe('moods', () => {
    it('steps up the ladder at each threshold and clamps outside [0, 100]', () => {
        expect(townMood(0).id).toBe('miserable')
        expect(townMood(24).id).toBe('miserable')
        expect(townMood(25).id).toBe('uneasy')
        expect(townMood(49).id).toBe('uneasy')
        expect(townMood(50).id).toBe('content')
        expect(townMood(74).id).toBe('content')
        expect(townMood(75).id).toBe('happy')
        expect(townMood(89).id).toBe('happy')
        expect(townMood(90).id).toBe('thriving')
        expect(townMood(100).id).toBe('thriving')
        expect(townMood(-40).id).toBe('miserable')
        expect(townMood(500).id).toBe('thriving')
    })

    it('never leaves a gap between one mood and the next', () => {
        for (const mood of TOWN_MOODS) expect(townMood(mood.min)).toBe(mood)
        for (let h = 0; h <= 100; h++) expect(TOWN_MOODS).toContain(townMood(h))
    })

    it('points at the next threshold, and at nothing from the top', () => {
        expect(townNextMood(0)!.min).toBe(25)
        expect(townNextMood(24)!.min).toBe(25)
        expect(townNextMood(25)!.min).toBe(50)
        expect(townNextMood(74)!.min).toBe(75)
        expect(townNextMood(89)!.min).toBe(90)
        expect(townNextMood(90)).toBeNull()
        expect(townNextMood(100)).toBeNull()
        expect(townNextMood(500)).toBeNull()
    })

    it('reads the speed multiplier straight off the ladder', () => {
        expect(townSpeedMultiplier(0)).toBe(0.5)
        expect(townSpeedMultiplier(24)).toBe(0.5)
        expect(townSpeedMultiplier(25)).toBe(0.75)
        expect(townSpeedMultiplier(50)).toBe(1)
        expect(townSpeedMultiplier(74)).toBe(1)
        expect(townSpeedMultiplier(75)).toBe(1.15)
        expect(townSpeedMultiplier(90)).toBe(1.3)
        expect(townSpeedMultiplier(-50)).toBe(0.5)
        expect(townSpeedMultiplier(1000)).toBe(1.3)
        expect(deriveTown([], 90, T0).speedMultiplier).toBe(1.3)
    })

    it('applies the build-time perk only when happiness is handed over', () => {
        const farm = getTownBuilding('farm')!
        // Putting one up uses buildMs; every upgrade starts from upgradeMs.
        expect(townLevelBuildMs(farm, 1)).toBe(farm.buildMs)
        expect(townLevelBuildMs(farm, 2)).toBe(farm.upgradeMs)
        expect(townLevelBuildMs(farm, 3)).toBe(Math.round(farm.upgradeMs * TOWN_LEVEL_TIME_GROWTH))

        for (const mood of TOWN_MOODS) {
            expect(townLevelBuildMs(farm, 1, mood.min)).toBe(Math.round(farm.buildMs * mood.buildTime))
            expect(townLevelBuildMs(farm, 4, mood.min))
                .toBe(Math.round(farm.upgradeMs * TOWN_LEVEL_TIME_GROWTH ** 2 * mood.buildTime))
        }
        // Growing a building is the idle part: the first upgrade dwarfs the build.
        expect(townLevelBuildMs(farm, 2)).toBeGreaterThan(townLevelBuildMs(farm, 1) * 5)
        // A thriving town builds faster than a miserable one.
        expect(townLevelBuildMs(farm, 1, 100)).toBeLessThan(townLevelBuildMs(farm, 1, 0))
    })

    it('puts up a starter building in a minute flat', () => {
        for (const id of ['house', 'park', 'farm', 'lumber'] as const) {
            expect(townLevelBuildMs(getTownBuilding(id)!, 1)).toBe(60_000)
        }
    })

    it('never lets a build run past the ceiling, however deep the tier', () => {
        const emporium = getTownBuilding('emporium')!
        // Unclamped, a top-level emporium would run for months.
        expect(emporium.buildMs * TOWN_LEVEL_TIME_GROWTH ** (TOWN_MAX_BUILDING_LEVEL - 1))
            .toBeGreaterThan(TOWN_MAX_BUILD_MS)
        expect(townLevelBuildMs(emporium, TOWN_MAX_BUILDING_LEVEL)).toBe(TOWN_MAX_BUILD_MS)
        // The mood perk cannot push it back over either.
        for (const mood of TOWN_MOODS) {
            expect(townLevelBuildMs(emporium, TOWN_MAX_BUILDING_LEVEL, mood.min)).toBeLessThanOrEqual(TOWN_MAX_BUILD_MS)
        }
        // Every building at every level stays under the wall.
        for (const def of TOWN_BUILDINGS) {
            for (const level of [1, 10, TOWN_MAX_BUILDING_LEVEL]) {
                expect(townLevelBuildMs(def, level)).toBeLessThanOrEqual(TOWN_MAX_BUILD_MS)
            }
        }
    })
})

describe('deriveTown', () => {
    it('houses two residents per house level', () => {
        expect(PER_HOUSE_LEVEL).toBe(2)
        for (const level of [1, 3, 7]) {
            expect(deriveTown([built('h', 'house', { level })], 50, T0).popCap).toBe(PER_HOUSE_LEVEL * level)
        }
        // Two houses shelter exactly as many as one house of twice the level.
        expect(deriveTown([built('a', 'house'), built('b', 'house')], 50, T0).popCap)
            .toBe(deriveTown([built('h', 'house', { level: 2 })], 50, T0).popCap)
    })

    it('sizes the workforce off the housing, so one house staffs very little', () => {
        // A single house cannot fill a farm and a mill at once: the farm was
        // built first and takes its resident, the mill runs on what is left.
        const farmDef = getTownBuilding('farm')!
        const millDef = getTownBuilding('mill')!
        const town = deriveTown([
            built('house', 'house', { createdAt: T0 - 1000 }),
            built('farm', 'farm', { createdAt: T0 - 900 }),
            built('mill', 'mill', { createdAt: T0 - 800 })
        ], 50, T0)

        expect(town.popCap).toBe(PER_HOUSE_LEVEL)
        expect(town.workersDemanded).toBe(farmDef.workers + millDef.workers)
        expect(town.workersDemanded).toBeGreaterThan(town.popCap)
        expect(town.workersEmployed).toBe(PER_HOUSE_LEVEL)
        expect(town.staffing.get('farm')).toBe(1)
        expect(town.staffing.get('mill')).toBe((PER_HOUSE_LEVEL - farmDef.workers) / millDef.workers)
    })

    it('ignores buildings that are still under construction', () => {
        const town = deriveTown([built('h', 'house', { level: 0, completesAt: T0 + 60_000 })], 50, T0)
        expect(town.popCap).toBe(0)
        expect(town.needsPerTick).toEqual({})
    })

    it('hands workers to the oldest industry first', () => {
        // One house against one more farm than its residents can staff: the
        // newest farm is the one that goes idle.
        const pop = PER_HOUSE_LEVEL * 2
        const buildings = [
            built('house', 'house', { level: 2, createdAt: T0 - 1000 }),
            ...Array.from({ length: pop + 1 }, (_, i) => built(`farm${i}`, 'farm', { createdAt: T0 - 900 + i }))
        ]
        const town = deriveTown(buildings, 50, T0)

        expect(town.popCap).toBe(pop)
        expect(town.workersDemanded).toBe(pop + 1)
        expect(town.workersEmployed).toBe(pop)
        expect(Array.from({ length: pop }, (_, i) => town.staffing.get(`farm${i}`)))
            .toEqual(Array.from({ length: pop }, () => 1))
        expect(town.staffing.get(`farm${pop}`)).toBe(0)
    })

    it('staffs a half-manned building at a fractional ratio', () => {
        // The farm is served first; the level-2 mill takes whatever is left of
        // the house's residents, which is less than the four jobs it has.
        const millLevel = 2
        const buildings = [
            built('house', 'house', { level: 2, createdAt: T0 - 1000 }),
            built('farm', 'farm', { createdAt: T0 - 900 }),
            built('mill', 'mill', { level: millLevel, createdAt: T0 - 800 })
        ]
        const town = deriveTown(buildings, 50, T0)

        const pop = PER_HOUSE_LEVEL * 2
        const forMill = pop - getTownBuilding('farm')!.workers
        const millJobs = getTownBuilding('mill')!.workers * millLevel
        expect(forMill).toBeLessThan(millJobs)
        expect(town.staffing.get('farm')).toBe(1)
        expect(town.staffing.get('mill')).toBe(forMill / millJobs)
        expect(town.workersEmployed).toBe(pop)
    })

    it('docks happiness for the residents who live beside industry', () => {
        // Two houses, only one of them within the farm's reach. Half the town
        // breathes the smog, so the town pays roughly half the going rate.
        const buildings = connected([
            at('houseNear', 'house', 0, 0, { rotation: 2, createdAt: T0 - 1000 }),
            at('houseFar', 'house', FAR_AWAY, 0, { rotation: 2, createdAt: T0 - 900 }),
            at('farm', 'farm', 0, FARM_NUISANCE.radius, { rotation: 0, createdAt: T0 - 800 })
        ])
        const town = deriveTown(buildings, 50, T0, { wheat: true })
        const layout = townLayoutScore(buildings, T0)

        expect(town.industryTiles).toBe(1)
        expect(layout.residents).toBe(2 * PER_HOUSE_LEVEL)
        expect(layout.residentsWithIndustry).toBe(PER_HOUSE_LEVEL)
        expect(layout.industry).toBe(Math.round(FARM_NUISANCE.penalty * TOWN_INDUSTRY_PENALTY_SCALE / 2))
        expect(town.happinessBreakdown.industry).toBe(-layout.industry)
        expect(town.happinessTarget)
            .toBe(TOWN_HAPPINESS_BASE_TARGET + GRAIN.happiness - layout.industry)

        // Move the far house in beside the farm and every resident breathes it,
        // which costs more than half of them doing so.
        const both = connected([
            at('houseNear', 'house', 0, 0, { rotation: 2, createdAt: T0 - 1000 }),
            at('houseAlso', 'house', 1, 0, { rotation: 2, createdAt: T0 - 900 }),
            at('farm', 'farm', 0, FARM_NUISANCE.radius, { rotation: 0, createdAt: T0 - 800 })
        ])
        const crowdedIn = townLayoutScore(both, T0)

        expect(crowdedIn.residentsWithIndustry).toBe(crowdedIn.residents)
        expect(crowdedIn.industry).toBeGreaterThan(layout.industry)
    })

    it('caps the smog a big industrial town breathes', () => {
        // One house under a wall of factories: the raw nuisance runs miles past
        // the ceiling, and the ceiling is what the town actually pays.
        const factory = getTownBuilding('factory')!
        const wall = [-2, -1, 0, 1, 2].map((dx, i) => at(
            `factory${i}`, 'factory', dx, townIndustryNuisance(factory).radius - 2,
            { rotation: 0, createdAt: T0 - 900 + i }
        ))
        const buildings = connected([
            at('house', 'house', 0, 0, { rotation: 2, createdAt: T0 - 1000 }),
            ...wall
        ])
        const raw = wall.length * townIndustryNuisance(factory).penalty * TOWN_INDUSTRY_PENALTY_SCALE
        const town = deriveTown(buildings, 50, T0, { wheat: true })

        expect(raw).toBeGreaterThan(TOWN_INDUSTRY_MAX_PENALTY)
        expect(town.happinessBreakdown.layout.residentsWithIndustry).toBe(town.happinessBreakdown.layout.residents)
        expect(town.happinessBreakdown.industry).toBe(-TOWN_INDUSTRY_MAX_PENALTY)
        expect(adjacencyHappiness(buildings, T0)).toBe(-TOWN_INDUSTRY_MAX_PENALTY)
    })

    it('docks happiness again once there are more jobs than residents', () => {
        const jobs = 5
        const farms = Array.from({ length: jobs }, (_, i) => built(`farm${i}`, 'farm', { createdAt: T0 - 900 + i }))
        // Enough house levels for every job in the roomy town; a single level
        // (fewer residents than jobs) in the crowded one.
        const roomy = deriveTown([
            built('house', 'house', { level: houseLevelsFor(jobs), createdAt: T0 - 1000 }),
            ...farms
        ], 50, T0, { wheat: true })
        const crowded = deriveTown([
            built('house', 'house', { createdAt: T0 - 1000 }),
            ...farms
        ], 50, T0, { wheat: true })

        expect(roomy.popCap).toBeGreaterThanOrEqual(jobs)
        expect(crowded.popCap).toBeLessThan(jobs)
        // Nothing here carries world coordinates, so the layout scores nothing
        // either way and crowding is the only difference between the two.
        // (The breakdown negates its penalties, so an absent one reads as -0.)
        expect(roomy.happinessBreakdown.crowding).toBe(0)
        expect(roomy.happinessTarget).toBe(TOWN_HAPPINESS_BASE_TARGET + GRAIN.happiness)
        expect(crowded.happinessBreakdown.crowding).toBe(-TOWN_HAPPINESS_CROWDING_PENALTY)
        expect(crowded.happinessTarget).toBe(roomy.happinessTarget - TOWN_HAPPINESS_CROWDING_PENALTY)
    })

    it('keeps the happiness target inside [0, 100]', () => {
        // Two tenements ringed by farms, a bakery working more jobs than the
        // town has residents, and an empty larder: the smog ceiling, crowding
        // and every reachable need missing, all at once.
        const houses = [0, 1].map(x => at(`house${x}`, 'house', x, 0, { level: 10, rotation: 2, createdAt: T0 - 2000 + x }))
        const farms = [-2, -1, 0, 1, 2, 3, 4].map(x => at(`farm${x}`, 'farm', x, FARM_NUISANCE.radius, { rotation: 0, createdAt: T0 - 900 + x }))
        // A tier-3 bakery puts bread and tools within reach, so their absence
        // counts — and its jobs outnumber the residents.
        const bakery = at('bakery', 'bakery', FAR_AWAY, 0, { level: 20, rotation: 2, createdAt: T0 - 800 })

        const miserable = deriveTown(connected([...houses, ...farms, bakery]), 50, T0, {})
        const blissful = deriveTown(
            Array.from({ length: 40 }, (_, i) => built(`park${i}`, 'park', { createdAt: T0 - 900 + i })),
            50, T0, {}
        )

        expect(miserable.happinessBreakdown.industry).toBe(-TOWN_INDUSTRY_MAX_PENALTY)
        expect(miserable.happinessBreakdown.crowding).toBe(-TOWN_HAPPINESS_CROWDING_PENALTY)
        expect(miserable.happinessBreakdown.needs).toBeLessThan(0)
        expect(miserable.happinessTarget).toBe(0)
        expect(blissful.happinessTarget).toBe(100)
    })

    it('raises the storage cap by one warehouse allowance per level', () => {
        expect(deriveTown([], 50, T0).storageCap).toBe(TOWN_BASE_STORAGE)
        expect(deriveTown([built('w', 'warehouse', { level: 2 })], 50, T0).storageCap)
            .toBe(TOWN_BASE_STORAGE + 2 * TOWN_WAREHOUSE_STORAGE)
    })

    it('multiplies the storage cap by the mood on top of that', () => {
        for (const mood of TOWN_MOODS) {
            expect(deriveTown([], mood.min, T0).storageCap).toBe(Math.round(TOWN_BASE_STORAGE * mood.storage))
            expect(deriveTown([built('w', 'warehouse', { level: 2 })], mood.min, T0).storageCap)
                .toBe(Math.round((TOWN_BASE_STORAGE + 2 * TOWN_WAREHOUSE_STORAGE) * mood.storage))
        }
        expect(deriveTown([], 100, T0).storageCap).toBeGreaterThan(deriveTown([], 50, T0).storageCap)
    })

    it('reports what the town will consume this tick', () => {
        expect(deriveTown([], 50, T0).needsPerTick).toEqual({})

        // Big enough that bread has joined grain on the shopping list.
        const level = houseLevelsFor(BREAD.minPop)
        const town = deriveTown([built('h', 'house', { level })], 50, T0)
        expect(town.popCap).toBe(PER_HOUSE_LEVEL * level)
        expect(town.needsPerTick).toEqual(townNeedsPerTick(town.popCap))
        expect(Object.keys(town.needsPerTick)).toEqual([GRAIN.resource, BREAD.resource])
    })
})

describe('layout', () => {
    it('cheers every house inside the park radius, diagonals included', () => {
        for (let dx = -TOWN_PARK_RADIUS; dx <= TOWN_PARK_RADIUS; dx++) {
            for (let dy = -TOWN_PARK_RADIUS; dy <= TOWN_PARK_RADIUS; dy++) {
                if (dx === 0 && dy === 0) continue
                expect(adjacencyHappiness([
                    at('house', 'house', 0, 0),
                    at('park', 'park', dx, dy)
                ])).toBe(TOWN_PARK_MAX_BONUS)
            }
        }
        // The far corner counts; one tile beyond the radius does not.
        const r = TOWN_PARK_RADIUS
        expect(adjacencyHappiness([at('house', 'house', 0, 0), at('park', 'park', r, r)]))
            .toBe(TOWN_PARK_MAX_BONUS)
        expect(adjacencyHappiness([at('house', 'house', 0, 0), at('park', 'park', r + 1, r)])).toBe(0)
        expect(adjacencyHappiness([at('house', 'house', 0, 0), at('park', 'park', 0, r + 1)])).toBe(0)
    })

    it('scores the residents parks cover, not the number of parks', () => {
        // One park wedged between two houses covers the whole town.
        expect(adjacencyHappiness([
            at('houseW', 'house', 0, 0),
            at('park', 'park', 1, 0),
            at('houseE', 'house', 2, 0)
        ])).toBe(TOWN_PARK_MAX_BONUS)

        // A second park over the same residents adds nothing — they were
        // already covered by the first.
        expect(adjacencyHappiness([
            at('house', 'house', 0, 0),
            at('parkE', 'park', 2, 2),
            at('parkW', 'park', -2, -2)
        ])).toBe(TOWN_PARK_MAX_BONUS)
    })

    it('scales the nuisance radius and penalty with the industry tier', () => {
        for (const type of ['farm', 'mill', 'bakery', 'mine', 'factory', 'emporium'] as const) {
            const def = getTownBuilding(type)!
            const { radius, penalty } = townIndustryNuisance(def)
            expect({ radius, penalty }).toEqual(TOWN_INDUSTRY_NUISANCE[def.tier])
            expect(townEffectRadius(def)).toBe(radius)

            // A diagonal at exactly the radius still bites; one tile out does not.
            expect(houseAdjacency([at('house', 'house', 0, 0), at('bad', type, radius, radius)], 0, 0, Infinity))
                .toEqual({ parks: 0, industry: 1, industryPenalty: penalty })
            expect(houseAdjacency([at('house', 'house', 0, 0), at('bad', type, radius + 1, 0)], 0, 0, Infinity))
                .toEqual({ parks: 0, industry: 0, industryPenalty: 0 })
        }

        // A tier-5 factory reaches further and stings harder than a tier-1 farm.
        const farm = townIndustryNuisance(getTownBuilding('farm')!)
        const factory = townIndustryNuisance(getTownBuilding('factory')!)
        expect(factory.radius).toBeGreaterThan(farm.radius)
        expect(factory.penalty).toBeGreaterThan(farm.penalty)
    })

    it('gives nothing but industry and parks an effect radius', () => {
        expect(townIndustryNuisance(getTownBuilding('house')!)).toEqual({ radius: 0, penalty: 0 })
        expect(townEffectRadius(getTownBuilding('park')!)).toBe(TOWN_PARK_RADIUS)
        expect(townEffectRadius(getTownBuilding('house')!)).toBe(0)
        expect(townEffectRadius(getTownBuilding('warehouse')!)).toBe(0)
        expect(townEffectRadius(getTownBuilding('road')!)).toBe(0)
    })

    it('nets parks against industry on the same house', () => {
        const farmPenalty = townIndustryNuisance(getTownBuilding('farm')!).penalty
        // Every resident of the only house breathes the farm, so the town pays
        // the full per-resident rate.
        expect(adjacencyHappiness([
            at('house', 'house', 0, 0),
            at('farm', 'farm', 1, 0)
        ])).toBe(-farmPenalty * TOWN_INDUSTRY_PENALTY_SCALE)

        expect(adjacencyHappiness([
            at('house', 'house', 0, 0),
            at('park', 'park', -1, 0),
            at('quarry', 'quarry', 1, 0)
        ])).toBe(TOWN_PARK_MAX_BONUS - farmPenalty * TOWN_INDUSTRY_PENALTY_SCALE)
    })

    it('clamps parks and industry at their own ceilings', () => {
        const house = at('house', 'house', 0, 0)
        const parks = []
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (dx === 0 && dy === 0) continue
                parks.push(at(`park${dx}:${dy}`, 'park', dx, dy))
            }
        }
        // Twenty-four parks cover exactly the residents one park already did.
        expect(parks.length).toBeGreaterThan(1)
        expect(adjacencyHappiness([house, parks[0]!])).toBe(TOWN_PARK_MAX_BONUS)
        expect(adjacencyHappiness([house, ...parks])).toBe(TOWN_PARK_MAX_BONUS)

        // Eleven factories over one house is far more misery than the ceiling allows.
        const around: [number, number][] = [
            [1, 0], [2, 0], [3, 0], [4, 0],
            [-1, 0], [-2, 0], [-3, 0], [-4, 0],
            [0, 1], [0, 2], [0, 3]
        ]
        const factories = around.map(([dx, dy]) => at(`factory${dx}:${dy}`, 'factory', dx, dy))
        const penalty = townIndustryNuisance(getTownBuilding('factory')!).penalty
        expect(factories.length * penalty * TOWN_INDUSTRY_PENALTY_SCALE).toBeGreaterThan(TOWN_INDUSTRY_MAX_PENALTY)
        expect(adjacencyHappiness([house, ...factories])).toBe(-TOWN_INDUSTRY_MAX_PENALTY)
    })

    it('ignores neighbours that are neither civic nor industry', () => {
        expect(adjacencyHappiness([
            at('house', 'house', 0, 0),
            at('house2', 'house', 1, 0),
            at('warehouse', 'warehouse', 0, 1),
            road(0, -1)
        ])).toBe(0)
    })

    it('skips buildings that carry no world coordinates', () => {
        // The park has no tile, so nothing is adjacent to anything.
        expect(adjacencyHappiness([
            at('house', 'house', 0, 0),
            built('park', 'park')
        ])).toBe(0)

        // And a house without a tile earns nothing from a park that has one.
        expect(adjacencyHappiness([
            built('house', 'house'),
            at('park', 'park', 1, 0)
        ])).toBe(0)

        expect(adjacencyHappiness([])).toBe(0)
    })

    it('only pays houses — a park beside a farm is worth nothing', () => {
        expect(adjacencyHappiness([
            at('park', 'park', 0, 0),
            at('farm', 'farm', 1, 0)
        ])).toBe(0)
    })

    it('feeds straight into the happiness target deriveTown computes', () => {
        const layout = connected([
            at('house', 'house', 0, 0, { rotation: 2, createdAt: T0 - 1000 }),
            at('park', 'park', 1, 0, { rotation: 0, createdAt: T0 - 900 })
        ])
        const plain = deriveTown([
            built('house', 'house', { createdAt: T0 - 1000 }),
            built('park', 'park', { createdAt: T0 - 900 })
        ], 50, T0, { wheat: true })

        expect(deriveTown(layout, 50, T0, { wheat: true }).happinessTarget)
            .toBe(plain.happinessTarget + TOWN_PARK_MAX_BONUS)
    })

    it('scores a tidy tier-1 town well clear of the base, and marks it down once bread comes within reach', () => {
        // Houses on a street, parks on the same street covering all of them,
        // and the farms far enough off that nobody smells them.
        const houses = [0, 1, 2].map(x => at(`house${x}`, 'house', x, 1, { level: 3, rotation: 2, createdAt: T0 - 2000 + x }))
        const parks = [3, 4].map(x => at(`park${x}`, 'park', x, 1, { rotation: 2, createdAt: T0 - 1500 + x }))
        const farms = [0, 1].map(i => at(`farm${i}`, 'farm', FAR_AWAY + i, 1, { rotation: 2, createdAt: T0 - 1000 + i }))
        const core = [...houses, ...parks, ...farms]

        const town = deriveTown(connected(core), 50, T0, { wheat: true })
        const parkBonus = parks.length * getTownBuilding('park')!.happiness

        expect(town.reachableTier).toBe(getTownBuilding('farm')!.tier + 1)
        // Big enough that bread would be on the scorecard if it were reachable.
        expect(town.popCap).toBeGreaterThanOrEqual(BREAD.minPop)
        expect(town.happinessBreakdown).toMatchObject({
            base: TOWN_HAPPINESS_BASE_TARGET,
            needs: GRAIN.happiness,
            parks: TOWN_PARK_MAX_BONUS,
            // A clean town reports a plain zero, never -0.
            industry: 0,
            crowding: 0
        })
        expect(town.happinessTarget).toBe(TOWN_HAPPINESS_BASE_TARGET + parkBonus + TOWN_PARK_MAX_BONUS + GRAIN.happiness)
        expect(town.happinessTarget).toBeGreaterThan(TOWN_HAPPINESS_BASE_TARGET)

        // A mill puts bread within reach. Nothing else about the town changed,
        // and the larder is still empty, so the town is marked down for it.
        const mill = at('mill', 'mill', FAR_AWAY + farms.length, 1, { rotation: 2, createdAt: T0 - 900 })
        const later = deriveTown(connected([...core, mill]), 50, T0, { wheat: true })

        expect(later.reachableTier).toBe(tierOf(BREAD))
        expect(townNeedExpected(BREAD, later.popCap, later.reachableTier)).toBe(true)
        expect(later.happinessBreakdown.needs).toBe(GRAIN.happiness - BREAD.happiness)
        expect(later.happinessTarget).toBe(town.happinessTarget - BREAD.happiness)
    })
})

describe('townLayoutScore', () => {
    it('pays the full park bonus only when every resident is covered', () => {
        const covered = townLayoutScore([at('house', 'house', 0, 0), at('park', 'park', 1, 0)], T0)
        expect(covered.residents).toBe(PER_HOUSE_LEVEL)
        expect(covered.residentsWithPark).toBe(PER_HOUSE_LEVEL)
        expect(covered.parks).toBe(TOWN_PARK_MAX_BONUS)

        // Half the residents in reach of a park is worth about half the bonus.
        const half = townLayoutScore([
            at('houseNear', 'house', 0, 0),
            at('houseFar', 'house', FAR_AWAY, 0),
            at('park', 'park', 1, 0)
        ], T0)
        expect(half.residentsWithPark).toBe(half.residents / 2)
        expect(half.parks).toBe(Math.round(TOWN_PARK_MAX_BONUS / 2))
    })

    it('scores nothing at all without residents to score for', () => {
        expect(townLayoutScore([at('park', 'park', 0, 0)], T0))
            .toEqual({ parks: 0, industry: 0, residents: 0, residentsWithPark: 0, residentsWithIndustry: 0 })
        expect(townLayoutScore([], T0))
            .toEqual({ parks: 0, industry: 0, residents: 0, residentsWithPark: 0, residentsWithIndustry: 0 })
        expect(townLayoutScore([at('house', 'house', 0, 0)], T0))
            .toEqual({ parks: 0, industry: 0, residents: PER_HOUSE_LEVEL, residentsWithPark: 0, residentsWithIndustry: 0 })
    })

    it('weighs the industry penalty by the residents actually breathing it', () => {
        const mill = getTownBuilding('mill')!
        const penalty = townIndustryNuisance(mill).penalty
        // The same three buildings, with the taller house first beside the mill
        // and then well away from it.
        const town = (nearLevel: number, farLevel: number) => townLayoutScore([
            at('near', 'house', 0, 0, { level: nearLevel }),
            at('far', 'house', FAR_AWAY, 0, { level: farLevel }),
            at('mill', 'mill', 1, 0)
        ], T0)

        const tallNear = town(4, 1)
        const tallFar = town(1, 4)

        expect(tallNear.residents).toBe(tallFar.residents)
        expect(tallNear.residentsWithIndustry).toBe(4 * PER_HOUSE_LEVEL)
        expect(tallFar.residentsWithIndustry).toBe(PER_HOUSE_LEVEL)
        expect(tallNear.industry).toBeGreaterThan(tallFar.industry)
        for (const score of [tallNear, tallFar]) {
            expect(score.industry).toBe(Math.round(
                penalty * TOWN_INDUSTRY_PENALTY_SCALE * score.residentsWithIndustry / score.residents
            ))
        }
    })

    it('clamps the industry penalty however dirty the neighbourhood gets', () => {
        const factory = getTownBuilding('factory')!
        const radius = townIndustryNuisance(factory).radius
        const factories = Array.from(
            { length: 2 * radius + 1 },
            (_, i) => at(`factory${i}`, 'factory', i - radius, 1)
        )
        const score = townLayoutScore([at('house', 'house', 0, 0), ...factories], T0)

        expect(score.residentsWithIndustry).toBe(score.residents)
        expect(score.industry).toBe(TOWN_INDUSTRY_MAX_PENALTY)
    })
})

describe('houseAdjacency', () => {
    it('counts the parks and industry around a tile with their penalty', () => {
        const buildings = [
            at('park', 'park', 1, 0),
            at('farm', 'farm', -1, 0),
            at('quarry', 'quarry', 0, 1),
            at('house', 'house', 0, -1)
        ]
        const farmPenalty = townIndustryNuisance(getTownBuilding('farm')!).penalty
        expect(houseAdjacency(buildings, 0, 0, Infinity)).toEqual({
            parks: 1,
            industry: 2,
            industryPenalty: 2 * farmPenalty
        })
    })

    it('reports an empty neighbourhood for a tile with nothing around it', () => {
        expect(houseAdjacency([at('park', 'park', 5, 5)], 0, 0, Infinity)).toEqual({ parks: 0, industry: 0, industryPenalty: 0 })
        expect(houseAdjacency([], 0, 0, Infinity)).toEqual({ parks: 0, industry: 0, industryPenalty: 0 })
    })

    it('ignores buildings without world coordinates', () => {
        expect(houseAdjacency([
            at('park', 'park', 9, 9),
            built('farm', 'farm')
        ], 0, 0, Infinity)).toEqual({ parks: 0, industry: 0, industryPenalty: 0 })
    })

    it('only counts what has actually finished being built', () => {
        const buildings = [
            at('park', 'park', 1, 0, { level: 0, completesAt: T0 + 60_000 }),
            at('farm', 'farm', 0, 1, { level: 0, completesAt: T0 + 60_000 })
        ]
        expect(houseAdjacency(buildings, 0, 0, T0)).toEqual({ parks: 0, industry: 0, industryPenalty: 0 })
        expect(houseAdjacency(buildings, 0, 0, T0 + 60_000).parks).toBe(1)
        expect(houseAdjacency(buildings, 0, 0, T0 + 60_000).industry).toBe(1)
    })

    it('agrees with townLayoutScore on what one house is worth', () => {
        const buildings = [
            at('house', 'house', 0, 0),
            at('park', 'park', 1, 0),
            at('farm', 'farm', 0, 1)
        ]
        const { parks, industryPenalty } = houseAdjacency(buildings, 0, 0, T0)
        const score = townLayoutScore(buildings, T0)

        // One house, so its neighbourhood is the whole town's: covered by a
        // park, and every resident inside the farm's nuisance radius.
        expect(score.parks).toBe(parks > 0 ? TOWN_PARK_MAX_BONUS : 0)
        expect(score.industry).toBe(Math.round(industryPenalty * TOWN_INDUSTRY_PENALTY_SCALE))
        expect(adjacencyHappiness(buildings, T0)).toBe(score.parks - score.industry)
    })
})

describe('townHousesWithin', () => {
    it('counts finished houses inside the radius, never the tile itself', () => {
        const buildings = [
            at('here', 'house', 0, 0),
            at('near', 'house', 1, 1),
            at('far', 'house', 3, 0),
            at('park', 'park', 1, 0)
        ]
        expect(townHousesWithin(buildings, 0, 0, 2, T0)).toBe(1)
        expect(townHousesWithin(buildings, 0, 0, 3, T0)).toBe(2)
        expect(townHousesWithin(buildings, 5, 5, 2, T0)).toBe(0)
    })

    it('does not count a house that is still going up', () => {
        const buildings = [at('site', 'house', 1, 0, { level: 0, completesAt: T0 + 60_000 })]
        expect(townHousesWithin(buildings, 0, 0, 2, T0)).toBe(0)
        expect(townHousesWithin(buildings, 0, 0, 2, T0 + 60_000)).toBe(1)
    })
})

describe('roads and facing', () => {
    it('puts the front door on the tile the rotation points at', () => {
        expect(townFrontTile(5, 5, 0)).toEqual({ wx: 5, wy: 6 })
        expect(townFrontTile(5, 5, 1)).toEqual({ wx: 6, wy: 5 })
        expect(townFrontTile(5, 5, 2)).toEqual({ wx: 5, wy: 4 })
        expect(townFrontTile(5, 5, 3)).toEqual({ wx: 4, wy: 5 })
        expect(TOWN_FACING).toHaveLength(4)
    })

    it('wraps rotations outside 0..3 back onto the four quarters', () => {
        expect(townFrontTile(0, 0, 4)).toEqual(townFrontTile(0, 0, 0))
        expect(townFrontTile(0, 0, 7)).toEqual(townFrontTile(0, 0, 3))
        expect(townFrontTile(0, 0, -1)).toEqual(townFrontTile(0, 0, 3))
        expect(townFrontTile(0, 0, -4)).toEqual(townFrontTile(0, 0, 0))
    })

    it('marks the outer ring of every plot as an edge, negative coordinates included', () => {
        expect(townIsPlotEdge(0, 0)).toBe(true)
        expect(townIsPlotEdge(7, 7)).toBe(true)
        expect(townIsPlotEdge(3, 0)).toBe(true)
        expect(townIsPlotEdge(0, 3)).toBe(true)
        expect(townIsPlotEdge(3, 3)).toBe(false)
        expect(townIsPlotEdge(1, 1)).toBe(false)

        // The plot to the east starts a fresh 0..7 ring.
        expect(townIsPlotEdge(TOWN_PLOT_SIZE, TOWN_PLOT_SIZE)).toBe(true)
        expect(townIsPlotEdge(TOWN_PLOT_SIZE + 1, TOWN_PLOT_SIZE + 1)).toBe(false)

        // And so does the plot to the west, where the coordinates go negative.
        expect(townIsPlotEdge(-1, -1)).toBe(true)
        expect(townIsPlotEdge(-8, -8)).toBe(true)
        expect(townIsPlotEdge(-7, -7)).toBe(false)
        expect(townIsPlotEdge(-2, -2)).toBe(false)
        expect(townIsPlotEdge(-5, -8)).toBe(true)
    })

    it('finds a road under a tile and only a road', () => {
        const buildings = [road(1, 0), at('house', 'house', 0, 0)]
        expect(townRoadAt(buildings, 1, 0)).toBe(true)
        expect(townRoadAt(buildings, 0, 0)).toBe(false)
        expect(townRoadAt(buildings, 2, 0)).toBe(false)
        expect(townRoadAt([], 0, 0)).toBe(false)
    })

    it('auto-faces the first road it finds, in S, E, N, W order', () => {
        expect(townAutoFacing([road(0, 1)], 0, 0)).toBe(0)
        expect(townAutoFacing([road(1, 0)], 0, 0)).toBe(1)
        expect(townAutoFacing([road(0, -1)], 0, 0)).toBe(2)
        expect(townAutoFacing([road(-1, 0)], 0, 0)).toBe(3)

        // With roads on several sides the earliest rotation wins.
        expect(townAutoFacing([road(-1, 0), road(0, 1)], 0, 0)).toBe(0)
        expect(townAutoFacing([road(-1, 0), road(1, 0)], 0, 0)).toBe(1)

        expect(townAutoFacing([], 0, 0)).toBeNull()
        // A diagonal road is no front door.
        expect(townAutoFacing([road(1, 1)], 0, 0)).toBeNull()
    })

    it('grants road access through the front door and nowhere else', () => {
        const served = at('served', 'farm', 0, 1, { rotation: 2 })
        const sideways = at('sideways', 'farm', 0, 1, { rotation: 0 })
        const lonely = at('lonely', 'farm', 5, 5)
        const buildings = [road(0, 0), served, sideways, lonely]

        expect(townRoadAccess(buildings, served)).toBe(true)
        // Right next to the road, but facing away from it.
        expect(townRoadAccess(buildings, sideways)).toBe(false)
        expect(townRoadAccess(buildings, lonely)).toBe(false)
        // A road is its own access, and a building with no tile is not placed yet.
        expect(townRoadAccess(buildings, road(0, 0))).toBe(true)
        expect(townRoadAccess(buildings, built('placeless', 'farm'))).toBe(true)
    })

    it('leaves a cut-off building out of the town entirely', () => {
        const street = connected([
            at('house', 'house', 0, 0, { rotation: 2, createdAt: T0 - 1000 }),
            at('farm', 'farm', 1, 0, { rotation: 2, createdAt: T0 - 900 })
        ])
        const cut = street.filter(b => b.type !== 'road')

        const served = deriveTown(street, 50, T0)
        expect(served.popCap).toBe(getTownBuilding('house')!.popCap)
        expect(served.industryTiles).toBe(1)
        expect(served.staffing.get('farm')).toBe(1)

        const stranded = deriveTown(cut, 50, T0)
        expect(stranded.popCap).toBe(0)
        expect(stranded.industryTiles).toBe(0)
        expect(stranded.staffing.get('farm')).toBeUndefined()
        expect(stranded.needsPerTick).toEqual({})
    })

    it('stops a cut-off farm producing for the whole settle', () => {
        const street = connected([
            at('house', 'house', 0, 0, { rotation: 2, createdAt: T0 - 1000 }),
            at('farm', 'farm', 1, 0, { level: 2, rotation: 2, createdAt: T0 - 900 })
        ])
        const cut = street.filter(b => b.type !== 'road')

        expect(settleTown(sim({ buildings: street }), T0 + 5 * TOWN_TICK_MS).delta.wheat).toBeGreaterThan(0)
        expect(settleTown(sim({ buildings: cut }), T0 + 5 * TOWN_TICK_MS).delta).toEqual({})
    })

    it('lists the buildings whose front door opens onto a tile', () => {
        const buildings = [
            road(0, 0),
            at('north', 'house', 0, 1, { rotation: 2 }),
            at('east', 'farm', 1, 0, { rotation: 3 }),
            at('away', 'house', 0, -1, { rotation: 2 }),
            at('nowhere', 'house', 4, 4, { rotation: 0 }),
            built('placeless', 'house', { rotation: 0 })
        ]
        expect(townBuildingsFronting(buildings, 0, 0).map(b => b.id).sort()).toEqual(['east', 'north'])
        expect(townBuildingsFronting(buildings, 9, 9)).toEqual([])

        // Roads never front anything, not even another road.
        expect(townBuildingsFronting([road(0, 0), road(0, 1)], 0, 0)).toEqual([])
        // A building with no rotation defaults to facing +y.
        expect(townBuildingsFronting([at('plain', 'house', 0, 0)], 0, 1).map(b => b.id)).toEqual(['plain'])
    })

    describe('townPlacementIssue', () => {
        const farm = getTownBuilding('farm')!
        const roadDef = getTownBuilding('road')!

        it('refuses a tile something already stands on', () => {
            const buildings = [road(3, 0), at('house', 'house', 3, 1, { rotation: 2 })]
            expect(townPlacementIssue(buildings, farm, 3, 1, 2)).toMatch(/already taken/)
            expect(townPlacementIssue(buildings, roadDef, 3, 0, 0)).toMatch(/already taken/)
        })

        it('starts a road at the edge of the plot or beside another road', () => {
            expect(townPlacementIssue([], roadDef, 0, 0, 0)).toBeNull()
            expect(townPlacementIssue([], roadDef, 7, 3, 0)).toBeNull()
            expect(townPlacementIssue([], roadDef, 3, 3, 0)).toMatch(/edge of your land/)

            // One tile in from the edge is fine once a road reaches it.
            expect(townPlacementIssue([road(3, 0)], roadDef, 3, 1, 0)).toBeNull()
            expect(townPlacementIssue([road(3, 0)], roadDef, 3, 2, 0)).toMatch(/edge of your land/)
            // Diagonals do not continue a road.
            expect(townPlacementIssue([road(3, 1)], roadDef, 4, 2, 0)).toMatch(/edge of your land/)
        })

        it('makes every other building front onto a road', () => {
            const buildings = [road(3, 0)]
            expect(townPlacementIssue(buildings, farm, 3, 1, 2)).toBeNull()
            // Same tile, wrong way round.
            expect(townPlacementIssue(buildings, farm, 3, 1, 0)).toMatch(/front door/)
            expect(townPlacementIssue(buildings, farm, 3, 1, 1)).toMatch(/front door/)
            expect(townPlacementIssue(buildings, farm, 3, 1, 3)).toMatch(/front door/)

            // Beside the road, facing it, works from the other side too.
            expect(townPlacementIssue([road(3, 3)], farm, 2, 3, 1)).toBeNull()
            expect(townPlacementIssue([road(3, 3)], farm, 4, 3, 3)).toBeNull()
            expect(townPlacementIssue([road(3, 3)], farm, 3, 4, 2)).toBeNull()
            // Being on the plot edge buys a non-road nothing.
            expect(townPlacementIssue([], farm, 0, 0, 0)).toMatch(/front door/)
        })

        it('agrees with townAutoFacing about which rotation works', () => {
            const buildings = [road(2, 2)]
            for (const [wx, wy] of [[2, 1], [1, 2], [2, 3], [3, 2]] as const) {
                const rotation = townAutoFacing(buildings, wx, wy)!
                expect(rotation).not.toBeNull()
                expect(townPlacementIssue(buildings, farm, wx, wy, rotation)).toBeNull()
            }
            expect(townAutoFacing(buildings, 5, 5)).toBeNull()
            expect(townPlacementIssue(buildings, farm, 5, 5, 0)).toMatch(/front door/)
        })
    })
})

describe('tiers', () => {
    /** Enough housing for `pop` residents in a single row of houses. */
    function housing(pop: number): TownSimBuilding[] {
        const per = getTownBuilding('house')!.popCap
        return Array.from({ length: Math.ceil(pop / per) }, (_, i) => built(`house${i}`, 'house', { createdAt: T0 - 2000 + i }))
    }

    /** A lifetime production ledger that clears the gate on `tier`. */
    function madeFor(tier: number) {
        const req = TOWN_TIER_PRODUCTION_REQUIREMENT[tier]!
        const resource = TOWN_RESOURCES.find(r => r.tier === req.tier)!
        return { [resource.id]: req.amount }
    }

    const POP2 = TOWN_TIER_POP_REQUIREMENT[2]!
    const MADE2 = madeFor(2)

    it('never gates the starter tiers', () => {
        expect(townTierRequirement([], 0, T0)).toBeNull()
        expect(townTierRequirement([], 1, T0)).toBeNull()
        expect(townTierUnlocked([], 0, T0)).toBe(true)
        expect(townTierUnlocked([], 1, T0)).toBe(true)
    })

    it('wants a finished building of the tier below', () => {
        const pop = housing(POP2)

        expect(townTierRequirement(pop, 2, T0, MADE2)).toEqual({
            needsBuilding: true,
            pop: POP2,
            popRequired: POP2,
            produced: TOWN_TIER_PRODUCTION_REQUIREMENT[2]!.amount,
            producedRequired: TOWN_TIER_PRODUCTION_REQUIREMENT[2]!.amount,
            producedTier: TOWN_TIER_PRODUCTION_REQUIREMENT[2]!.tier
        })

        const site = built('farm', 'farm', { level: 0, completesAt: T0 + 60_000 })
        expect(townTierRequirement([...pop, site], 2, T0, MADE2)!.needsBuilding).toBe(true)
        // The very same row, once its clock has run out, opens the tier.
        expect(townTierRequirement([...pop, site], 2, T0 + 60_000, MADE2)).toBeNull()
        expect(townTierRequirement([...pop, built('farm', 'farm')], 2, T0, MADE2)).toBeNull()
    })

    it('wants the residents to go with it', () => {
        const short = [built('farm', 'farm'), ...housing(4)]
        expect(townTierRequirement(short, 2, T0, MADE2)).toMatchObject({
            needsBuilding: false,
            pop: 4,
            popRequired: POP2
        })
        expect(townTierUnlocked(short, 2, T0, MADE2)).toBe(false)

        // Four residents short is still short.
        const nearly = [built('farm', 'farm'), ...housing(POP2 - 4)]
        expect(townTierUnlocked(nearly, 2, T0, MADE2)).toBe(false)
        expect(townTierUnlocked([built('farm', 'farm'), ...housing(POP2)], 2, T0, MADE2)).toBe(true)
    })

    it('wants the goods of the tier below actually produced, not bought', () => {
        const town = [built('farm', 'farm'), ...housing(POP2)]
        const required = TOWN_TIER_PRODUCTION_REQUIREMENT[2]!

        expect(townTierUnlocked(town, 2, T0, {})).toBe(false)
        expect(townTierRequirement(town, 2, T0, {})).toMatchObject({
            needsBuilding: false,
            produced: 0,
            producedRequired: required.amount,
            producedTier: required.tier
        })

        const oneShort = { wheat: required.amount - 1 }
        expect(townTierUnlocked(town, 2, T0, oneShort)).toBe(false)
        expect(townTierRequirement(town, 2, T0, oneShort)!.produced).toBe(required.amount - 1)
        expect(townTierUnlocked(town, 2, T0, MADE2)).toBe(true)
    })

    it('adds up every resource of the gating tier', () => {
        const required = TOWN_TIER_PRODUCTION_REQUIREMENT[2]!
        expect(townProducedOfTier({}, 1)).toBe(0)
        expect(townProducedOfTier({ wheat: 10, wood: 5, stone: 1 }, 1)).toBe(16)
        // Goods of another tier do not count toward this one.
        expect(townProducedOfTier({ wheat: 10, flour: 900 }, 1)).toBe(10)
        expect(townProducedOfTier({ wheat: 10, flour: 900 }, 2)).toBe(900)

        // Split across the three tier-1 goods, the gate still opens.
        const third = Math.ceil(required.amount / 3)
        const town = [built('farm', 'farm'), ...housing(POP2)]
        expect(townTierUnlocked(town, 2, T0, { wheat: third, wood: third, stone: third })).toBe(true)
    })

    it('counts housing at its effective level, upgrades included', () => {
        const per = getTownBuilding('house')!.popCap
        const levels = POP2 / per
        const upgrading = built('house', 'house', { level: levels - 1, upgradingTo: levels, completesAt: T0 - 1 })
        const buildings = [built('farm', 'farm'), upgrading]

        // One tick before the upgrade lands the town is a level short.
        expect(townTierRequirement([built('farm', 'farm'), { ...upgrading, completesAt: T0 + 1 }], 2, T0, MADE2)!.pop)
            .toBe((levels - 1) * per)
        // A finished upgrade counts even before the settle writes it down.
        expect(townTierRequirement(buildings, 2, T0, MADE2)).toBeNull()
        expect(townTierUnlocked(buildings, 2, T0, MADE2)).toBe(true)
    })

    it('looks only at the tier directly below', () => {
        const pop = housing(TOWN_TIER_POP_REQUIREMENT[3]!)
        const made = madeFor(3)
        expect(townTierUnlocked([built('farm', 'farm'), ...pop], 3, T0, made)).toBe(false)

        const mill = [built('mill', 'mill'), ...pop]
        expect(townTierUnlocked(mill, 3, T0, made)).toBe(true)
        expect(townTierUnlocked(mill, 2, T0, made)).toBe(false)
    })

    it('ignores houses and parks, which sit below tier 1', () => {
        expect(townTierUnlocked([...housing(40), built('park', 'park')], 2, T0, MADE2)).toBe(false)
    })
})

describe('townNetPerTick', () => {
    function net(buildings: TownSimBuilding[], happiness = 100) {
        return townNetPerTick(buildings, deriveTown(buildings, happiness, T0), T0)
    }

    it('nets the mill\'s wheat draw against the farm\'s output and the town\'s appetite', () => {
        // Enough house levels to cover the farm's job and the mill's two, so
        // both run full.
        const jobs = getTownBuilding('farm')!.workers + getTownBuilding('mill')!.workers
        const level = houseLevelsFor(jobs)
        const buildings = [
            built('house', 'house', { level, createdAt: T0 - 1000 }),
            built('farm', 'farm', { createdAt: T0 - 900 }),
            built('mill', 'mill', { createdAt: T0 - 800 })
        ]
        // Farm +1 wheat, mill −2 wheat +1 flour, and the residents eat theirs.
        const eaten = townNeedsPerTick(PER_HOUSE_LEVEL * level).wheat!
        expect(net(buildings)).toEqual({ wheat: 1 - 2 - eaten, flour: 1 })
    })

    it('subtracts what the townsfolk consume even with nobody working', () => {
        const idle = [built('house', 'house')]
        expect(net(idle)).toEqual({ wheat: -townNeedsPerTick(PER_HOUSE_LEVEL).wheat! })

        // A level-1 farm grows exactly what its own residents eat.
        expect(net(houseAndFarm().map(b => ({ ...b, level: 1 })))).toEqual({ wheat: 0 })
        // The level-2 farm of the standard test town runs a surplus.
        expect(net(houseAndFarm())).toEqual({ wheat: 1 })
    })

    it('counts nothing for a building that has no staff', () => {
        // No housing at all: nobody works and nobody eats.
        expect(net([built('farm', 'farm')])).toEqual({})
    })

    it('skips buildings that are still under construction', () => {
        const buildings = [
            built('house', 'house', { createdAt: T0 - 1000 }),
            built('farm', 'farm', { level: 0, completesAt: T0 + 60_000, createdAt: T0 - 900 })
        ]
        expect(net(buildings)).toEqual({ wheat: -1 })
        expect(net(buildings.map(b => ({ ...b, completesAt: T0 - 1 })))).toEqual({ wheat: 0 })
    })

    it('scales output with the building level', () => {
        const buildings = [
            built('house', 'house', { level: 2, createdAt: T0 - 1000 }),
            built('farm', 'farm', { level: 3, createdAt: T0 - 900 })
        ]
        // Eight residents still only want one grain a tick.
        expect(net(buildings)).toEqual({ wheat: 2 })
    })
})

describe('milestones', () => {
    function snapshot(buildings: TownSimBuilding[], over: Partial<TownMilestoneSnapshot> = {}): TownMilestoneSnapshot {
        const happiness = over.happiness ?? 50
        const derived = deriveTown(buildings, happiness, T0)
        return {
            ...townMilestoneSnapshot(buildings, derived, happiness, over.plotsBought ?? 1, over.coinsEarned ?? 0, T0),
            ...over
        }
    }

    function complete(id: string, snap: TownMilestoneSnapshot) {
        return townMilestoneComplete(getTownMilestone(id)!, snap)
    }

    it('gives every milestone a unique id and something to claim', () => {
        expect(new Set(TOWN_MILESTONES.map(m => m.id)).size).toBe(TOWN_MILESTONES.length)
        // Every goal pays gems, coins or both — never nothing.
        expect(TOWN_MILESTONES.every(m => m.reward > 0 || (m.gems ?? 0) > 0)).toBe(true)
        // Coins are only worth printing at this site's scale.
        expect(TOWN_MILESTONES.every(m => m.reward === 0 || m.reward >= 10_000_000)).toBe(true)
    })

    it('keeps the total gem payout modest against what the site pays elsewhere', () => {
        const gems = TOWN_MILESTONES.reduce((sum, m) => sum + (m.gems ?? 0), 0)
        expect(gems).toBeGreaterThan(0)
        expect(gems).toBeLessThanOrEqual(250)
    })

    it('summarises the town into the snapshot the conditions read', () => {
        const snap = snapshot([
            built('house', 'house', { level: 2, createdAt: T0 - 1000 }),
            built('farm', 'farm', { level: 4, createdAt: T0 - 900 }),
            built('farm2', 'farm', { createdAt: T0 - 800 }),
            built('site', 'kiln', { level: 0, completesAt: T0 + 60_000, createdAt: T0 })
        ], { plotsBought: 2, coinsEarned: 1_234 })

        expect(snap.builtByType).toEqual({ house: 1, farm: 2 })
        expect(snap.maxLevel).toBe(4)
        expect(snap.popCap).toBe(PER_HOUSE_LEVEL * 2)
        expect(snap.industryCount).toBe(2)
        expect(snap.plotsBought).toBe(2)
        expect(snap.coinsEarned).toBe(1_234)
    })

    it('completes first-home only once a house is standing', () => {
        expect(complete('first-home', snapshot([]))).toBe(false)
        expect(complete('first-home', snapshot([
            built('house', 'house', { level: 0, completesAt: T0 + 60_000 })
        ]))).toBe(false)
        expect(complete('first-home', snapshot([built('house', 'house')]))).toBe(true)
    })

    it('completes growing at the fourth industry building', () => {
        const farms = (n: number) => Array.from({ length: n }, (_, i) => built(`farm${i}`, 'farm', { createdAt: T0 - 900 + i }))

        expect(complete('growing', snapshot(farms(3)))).toBe(false)
        expect(complete('growing', snapshot(farms(4)))).toBe(true)
        expect(complete('growing', snapshot(farms(9)))).toBe(true)

        // Houses, parks and roads are not industry, however many you build.
        expect(complete('growing', snapshot(
            Array.from({ length: 6 }, (_, i) => built(`park${i}`, 'park', { createdAt: T0 - 900 + i }))
        ))).toBe(false)
        expect(complete('growing', snapshot(
            Array.from({ length: 6 }, (_, i) => road(i, 0))
        ))).toBe(false)
    })

    it('completes merchant on the millionth coin earned from sales', () => {
        expect(complete('merchant', snapshot([], { coinsEarned: 999_999 }))).toBe(false)
        expect(complete('merchant', snapshot([], { coinsEarned: 1_000_000 }))).toBe(true)
        expect(complete('merchant', snapshot([], { coinsEarned: 5_000_000 }))).toBe(true)

        // The earlier sales milestone trips a thousand coins in.
        expect(complete('first-sale', snapshot([], { coinsEarned: 999 }))).toBe(false)
        expect(complete('first-sale', snapshot([], { coinsEarned: 1_000 }))).toBe(true)
    })

    it('clamps reported progress to the target it is measured against', () => {
        const snap = snapshot([], { coinsEarned: 50_000_000 })
        const merchant = getTownMilestone('merchant')!
        expect(merchant.progress(snap)).toEqual({ current: 1_000_000, target: 1_000_000 })
    })

    it('leaves a fresh town with nothing but the empty milestones incomplete', () => {
        const fresh = snapshot([])
        const done = TOWN_MILESTONES.filter(m => townMilestoneComplete(m, fresh)).map(m => m.id)
        expect(done).toEqual([])
    })
})

describe('settleTown', () => {
    it('changes nothing for an empty town', () => {
        const result = settleTown(sim(), T0 + 10 * TOWN_TICK_MS)
        expect(result.delta).toEqual({})
        expect(result.completed).toEqual([])
        expect(result.lastSettledAt).toBe(T0 + 10 * TOWN_TICK_MS)
    })

    it('produces one surplus wheat per tick at full happiness', () => {
        const result = settleTown(sim({ buildings: houseAndFarm() }), T0 + TOWN_TICK_MS)
        expect(result.ticks).toBe(1)
        // Two grown, one eaten.
        expect(result.delta).toEqual({ wheat: 1 })
        expect(result.satisfied).toEqual({ wheat: true })
    })

    it('runs at half speed when the town is miserable', () => {
        const short = settleTown(sim({ happiness: 0, buildings: houseAndFarm() }), T0 + TOWN_TICK_MS)
        expect(short.ticks).toBe(0)
        expect(short.delta).toEqual({})
        expect(short.tickProgressMs).toBe(TOWN_TICK_MS / 2)

        const full = settleTown(sim({ happiness: 0, buildings: houseAndFarm() }), T0 + 2 * TOWN_TICK_MS)
        expect(full.ticks).toBe(1)
        expect(full.delta).toEqual({ wheat: 1 })
    })

    it('reports the needs it could not supply without touching the stock', () => {
        // A town big enough to want bread as well as grain, and more than one
        // grain a tick — so a part-stocked larder can fall short.
        const buildings = [BIG_HOUSE]
        expect(Object.keys(BIG_DEMAND)).toEqual([GRAIN.resource, BREAD.resource])
        expect(BIG_DEMAND.wheat!).toBeGreaterThan(1)

        const short = settleTown(sim({ happiness: 50, inventory: { wheat: BIG_DEMAND.wheat! - 1 }, buildings }), T0 + 3 * TOWN_TICK_MS)
        expect(short.ticks).toBeGreaterThan(0)
        // Half a demand feeds nobody, so the grain on hand is never eaten.
        expect(short.delta).toEqual({})
        expect(short.satisfied).toEqual({ wheat: false, bread: false })

        // Two whole tick's worth of grain and a leftover the third cannot use.
        const stocked = settleTown(sim({ happiness: 50, inventory: { wheat: 2 * BIG_DEMAND.wheat! + 1 }, buildings }), T0 + 3 * TOWN_TICK_MS)
        expect(stocked.ticks).toBe(3)
        expect(stocked.delta).toEqual({ wheat: -2 * BIG_DEMAND.wheat! })
        expect(stocked.satisfied).toEqual({ wheat: false, bread: false })
    })

    it('reports the stock on hand when no tick ran at all', () => {
        const result = settleTown(sim({ inventory: { bread: 5 } }), T0)
        expect(result.ticks).toBe(0)
        expect(result.satisfied).toEqual({ wheat: false, bread: true, tools: false, luxuries: false })
    })

    it('lets a fed town climb and a starving one sink', () => {
        const buildings = [BIG_HOUSE]
        const fed = settleTown(sim({ happiness: 50, inventory: { wheat: 500, bread: 500 }, buildings }), T0 + 5 * TOWN_TICK_MS)
        const starving = settleTown(sim({ happiness: 50, buildings }), T0 + 5 * TOWN_TICK_MS)

        expect(fed.satisfied).toEqual({ wheat: true, bread: true })
        expect(fed.delta).toEqual({ wheat: -5 * BIG_DEMAND.wheat!, bread: -5 * BIG_DEMAND.bread! })
        expect(fed.happiness).toBeGreaterThan(50)
        expect(starving.happiness).toBeLessThan(50)
        expect(starving.delta).toEqual({})
    })

    it('stops producing once storage is full', () => {
        // Wood is nobody's need, so only the storage cap can stop the camp.
        const buildings = [
            built('house', 'house', { createdAt: T0 - 90_000 }),
            built('lumber', 'lumber', { createdAt: T0 - 80_000 })
        ]
        const result = settleTown(
            sim({ happiness: 50, inventory: { wood: TOWN_BASE_STORAGE - 1 }, buildings }),
            T0 + 5 * TOWN_TICK_MS
        )
        expect(result.ticks).toBeGreaterThan(1)
        expect(result.delta).toEqual({ wood: 1 })

        const alreadyFull = settleTown(
            sim({ happiness: 50, inventory: { wood: TOWN_BASE_STORAGE }, buildings }),
            T0 + 5 * TOWN_TICK_MS
        )
        expect(alreadyFull.delta).toEqual({})
    })

    it('lets a thriving town hold more than a content one', () => {
        const buildings = [
            built('house', 'house', { createdAt: T0 - 90_000 }),
            built('lumber', 'lumber', { createdAt: T0 - 80_000 })
        ]
        const inventory = { wood: TOWN_BASE_STORAGE }
        expect(settleTown(sim({ happiness: 50, inventory, buildings }), T0 + 2 * TOWN_TICK_MS).delta).toEqual({})
        // At 100 happiness the thriving multiplier lifts the cap above the stock.
        expect(settleTown(sim({ happiness: 100, inventory, buildings }), T0 + 2 * TOWN_TICK_MS).delta.wood)
            .toBeGreaterThan(0)
    })

    it('only runs the mill on the ticks that have two wheat to grind', () => {
        const buildings = [
            built('house', 'house', { createdAt: T0 - 90_000 }),
            built('mill', 'mill', { createdAt: T0 - 80_000 })
        ]

        const stocked = settleTown(sim({ inventory: { wheat: 3 }, buildings }), T0 + 130_000)
        expect(stocked.ticks).toBe(2)
        // Tick one ground two wheat into flour and the town ate the third; tick two was short.
        expect(stocked.delta).toEqual({ wheat: -3, flour: 1 })

        const starved = settleTown(sim({ inventory: { wheat: 1 }, buildings }), T0 + 130_000)
        expect(starved.ticks).toBe(2)
        // Not enough to grind, but the residents still get their grain once.
        expect(starved.delta).toEqual({ wheat: -1 })
    })

    it('produces nothing while a building is still under construction', () => {
        const buildings = [
            built('house', 'house', { createdAt: T0 - 90_000 }),
            built('farm', 'farm', { level: 0, completesAt: T0 + 10 * TOWN_TICK_MS, createdAt: T0 })
        ]
        const result = settleTown(sim({ buildings }), T0 + 5 * TOWN_TICK_MS)

        expect(result.delta).toEqual({})
        expect(result.completed).toEqual([])
    })

    it('a first build that lands mid-window starts producing for the rest of it', () => {
        // The first farm feeds the town; the second is pure surplus, and only
        // from the tick after it finishes.
        const buildings = [
            built('house', 'house', { createdAt: T0 - 90_000 }),
            built('farm', 'farm', { createdAt: T0 - 80_000 }),
            built('farm2', 'farm', { level: 0, completesAt: T0 + 150_000, createdAt: T0 })
        ]
        const result = settleTown(sim({ buildings }), T0 + 10 * TOWN_TICK_MS)

        expect(result.completed).toEqual([{ id: 'farm2', level: 1 }])
        expect(result.ticks).toBeGreaterThan(5)
        expect(result.delta.wheat ?? 0).toBeGreaterThan(0)
        // The first few ticks ran on one farm, which the town ate clean.
        expect(result.delta.wheat ?? 0).toBeLessThan(result.ticks)
    })

    it('bakes a finished upgrade into completed and produces at the new level', () => {
        const buildings = [
            built('house', 'house', { createdAt: T0 - 90_000 }),
            built('farm', 'farm', { level: 1, upgradingTo: 2, completesAt: T0 - 1, createdAt: T0 - 80_000 })
        ]
        const result = settleTown(sim({ buildings }), T0 + TOWN_TICK_MS)

        expect(result.completed).toEqual([{ id: 'farm', level: 2 }])
        expect(result.delta).toEqual({ wheat: 1 })
    })

    it('caps an absence at the maximum offline window', () => {
        const capped = settleTown(sim({ buildings: houseAndFarm() }), T0 + TOWN_MAX_OFFLINE_MS)
        const abandoned = settleTown(sim({ buildings: houseAndFarm() }), T0 + 24 * 60 * 60_000)

        expect(abandoned.ticks).toBe(capped.ticks)
        expect(abandoned.delta).toEqual(capped.delta)
        expect(abandoned.happiness).toBe(capped.happiness)
        expect(abandoned.tickProgressMs).toBe(capped.tickProgressMs)
        // The clock still moves all the way to now — the lost time is simply lost.
        expect(abandoned.lastSettledAt).toBe(T0 + 24 * 60 * 60_000)
    })

    it('carries tick progress across settles so splitting a window changes nothing', () => {
        const whole = settleTown(sim({ buildings: houseAndFarm() }), T0 + 5 * TOWN_TICK_MS)

        const first = settleTown(sim({ buildings: houseAndFarm() }), T0 + 3 * TOWN_TICK_MS)
        const second = settleTown(sim({
            happiness: first.happiness,
            tickProgressMs: first.tickProgressMs,
            lastSettledAt: first.lastSettledAt,
            buildings: houseAndFarm()
        }), T0 + 5 * TOWN_TICK_MS)

        const split = (first.delta.wheat ?? 0) + (second.delta.wheat ?? 0)
        expect(split).toBeGreaterThanOrEqual((whole.delta.wheat ?? 0) - 1)
        expect(split).toBeLessThanOrEqual((whole.delta.wheat ?? 0) + 1)
        expect(first.ticks + second.ticks).toBe(whole.ticks)
    })

    it('produces nothing at all when there is nobody to work the industry', () => {
        const result = settleTown(sim({ buildings: [built('farm', 'farm')] }), T0 + 5 * TOWN_TICK_MS)
        expect(result.ticks).toBeGreaterThan(0)
        expect(result.delta).toEqual({})
    })
})

describe('market validators', () => {
    it('accepts prices with at most two decimals at or above the minimum', () => {
        expect(isValidTownPrice(0.01)).toBe(true)
        expect(isValidTownPrice(5)).toBe(true)
        expect(isValidTownPrice(5.55)).toBe(true)
        expect(isValidTownPrice(0.07)).toBe(true)
        expect(isValidTownPrice(1234.56)).toBe(true)
    })

    it('rejects sub-cent, non-finite and oversized prices', () => {
        expect(isValidTownPrice(0)).toBe(false)
        expect(isValidTownPrice(0.009)).toBe(false)
        expect(isValidTownPrice(-5)).toBe(false)
        expect(isValidTownPrice(5.001)).toBe(false)
        expect(isValidTownPrice(NaN)).toBe(false)
        expect(isValidTownPrice(Infinity)).toBe(false)
        expect(isValidTownPrice(Number.MAX_SAFE_INTEGER)).toBe(false)
    })

    it('accepts whole quantities inside the int32 column range', () => {
        expect(isValidTownQuantity(1)).toBe(true)
        expect(isValidTownQuantity(2_147_483_647)).toBe(true)
        expect(isValidTownQuantity(0)).toBe(false)
        expect(isValidTownQuantity(-1)).toBe(false)
        expect(isValidTownQuantity(2.5)).toBe(false)
        expect(isValidTownQuantity(2_147_483_648)).toBe(false)
        expect(isValidTownQuantity(NaN)).toBe(false)
    })

    it('totals in whole cents rather than in floats', () => {
        // 0.07 * 3 is 0.21000000000000002 in float64; the total must not be.
        expect(townOrderTotal(0.07, 3)).toBe(0.21)
        expect(townOrderTotal(0.1, 3)).toBe(0.3)
        expect(townOrderTotal(1.15, 7)).toBe(8.05)
        expect(townOrderTotal(5, 1_000)).toBe(5_000)
    })
})
