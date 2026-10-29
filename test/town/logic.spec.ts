import { describe, expect, it } from 'vitest'
import {
    TOWN_BASE_STORAGE,
    TOWN_BUILDINGS,
    TOWN_FACING,
    TOWN_HAPPINESS_CROWDING_PENALTY,
    TOWN_HOUSE_CHEER_MAX,
    TOWN_INDUSTRY_PENALTY_SCALE,
    TOWN_SELF_SUPPLY_LEVEL,
    TOWN_LEVEL_TIME_GROWTH,
    TOWN_MAX_BUILD_MS,
    TOWN_MAX_BUILDING_LEVEL,
    TOWN_MAX_OFFLINE_MS,
    TOWN_MILESTONES,
    TOWN_MOODS,
    TOWN_NEEDS,
    TOWN_PLOT_COOLDOWNS_MS,
    TOWN_MAX_PLOTS,
    TOWN_PLOT_SIZE,
    TOWN_RESOURCES,
    TOWN_RUSH_MS_PER_GEM,
    TOWN_TICK_MS,
    TOWN_TIER_POP_REQUIREMENT,
    TOWN_TIER_PRODUCTION_REQUIREMENT,
    adjacencyHappiness,
    deriveTown,
    getTownBuilding,
    getTownMilestone,
    houseAdjacency,
    isValidTownPrice,
    isValidTownQuantity,
    settleTown,
    townTickRecipe,
    townTickWork,
    townTerrainAt,
    townFrontTile,
    townFrontTiles,
    townBuildingSize,
    townIndustryNuisance,
    townDistricts,
    townLevelBuildMs,
    townLevelCost,
    townAllNeedsSatisfied,
    townMilestoneComplete,
    townMilestoneSnapshot,
    townMood,
    townNeedsPerTick,
    townOrderTotal,
    townPlaceCost,
    townPlacementIssue,
    townPlotCooldownMs,
    townPlotPrice,
    townReachableTier,
    townRoadAccess,
    townRushGemCost,
    townSpiralCoords,
    townTierRequirement,
    townTierUnlocked,
    type TownBuildingId,
    type TownMilestoneSnapshot,
    type TownSimBuilding,
    type TownSimState
} from '#shared/utils/gamelogic/town'
import { TOWN_MONUMENT_STAGES } from '#shared/utils/gamelogic/town-monuments'

const T0 = 1_700_000_000_000

/** The grain need: the only one the smallest towns have. */
const GRAIN = TOWN_NEEDS.find(n => n.resource === 'wheat')!
const BREAD = TOWN_NEEDS.find(n => n.resource === 'bread')!
const BRICKS = TOWN_NEEDS.find(n => n.resource === 'bricks')!

const HOUSE = getTownBuilding('house')!
/** Residents one house level is worth — every workforce here is sized off this. */
const PER_HOUSE_LEVEL = HOUSE.popCap

/** How far a farm's smog carries, and what it costs a resident inside it. */
const FARM_NUISANCE = townIndustryNuisance(getTownBuilding('farm')!)
/** A tile far enough from everything that no radius in the game reaches it. */
const FAR_AWAY = 40
/** What one park level is worth to each home in reach. */
const PARK_CHEER = getTownBuilding('park')!.happiness
/** houseAdjacency for a tile nothing reaches. */
const NOBODY_AROUND = { parks: 0, industry: 0, industryPenalty: 0, cheer: 0, nuisance: 0, mood: 0 }

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
        for (const f of townFrontTiles(b.wx, b.wy, b.rotation ?? 0, townBuildingSize(b.type))) roads.set(`${f.wx},${f.wy}`, road(f.wx, f.wy))
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

/** The first world tile of the given terrain, searched outward from the origin. */
function tileOf(terrain: 'fertile' | 'plain'): { wx: number, wy: number } {
    for (let r = 0; r <= 6; r++) {
        for (let px = -r; px <= r; px++) {
            for (let py = -r; py <= r; py++) {
                for (let ty = 0; ty < TOWN_PLOT_SIZE - 1; ty++) {
                    for (let tx = 0; tx < TOWN_PLOT_SIZE; tx++) {
                        const wx = px * TOWN_PLOT_SIZE + tx
                        const wy = py * TOWN_PLOT_SIZE + ty
                        // The road in front of it (see farmOn) has to be dry land too.
                        if (townTerrainAt(wx, wy) === terrain && townTerrainAt(wx, wy + 1) !== 'water') return { wx, wy }
                    }
                }
            }
        }
    }
    throw new Error(`no ${terrain} tile anywhere near the origin`)
}
const fertileTile = () => tileOf('fertile')

/**
 * A house whose residents eat one grain a tick, and a level-1 farm standing on
 * `tile` with a road at its front door. On grassland the farm grows exactly
 * what the house eats; on fertile ground it grows a quarter more.
 */
function farmOn(tile: { wx: number, wy: number }): TownSimBuilding[] {
    // The house lives next door on the same street: people only staff what
    // their own roads reach.
    return [
        at('house', 'house', tile.wx + 1, tile.wy, { rotation: 0, createdAt: T0 - 90_000 }),
        at('house-road', 'road', tile.wx + 1, tile.wy + 1, { createdAt: T0 - 85_000 }),
        at('road', 'road', tile.wx, tile.wy + 1, { createdAt: T0 - 85_000 }),
        at('farm', 'farm', tile.wx, tile.wy, { rotation: 0, createdAt: T0 - 80_000 })
    ]
}

/** One house tall enough to shelter the population bread needs to appear. */
const BIG_HOUSE = built('house', 'house', { level: houseLevelsFor(BREAD.minPop), createdAt: T0 - 90_000 })
/**
 * A finished bakery, so bread counts as something the town can make and going
 * without it costs happiness. With no flour on hand it bakes nothing, so it
 * never moves the inventory itself.
 */
const BAKERY = built('bakery', 'bakery', { createdAt: T0 - 90_000 })
/** What that town eats every tick: grain and bread both, bakery or not. */
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
})

describe('plot cooldown and price', () => {
    it('gives the founding plot away for free with no wait', () => {
        expect(townPlotCooldownMs(1)).toBe(0)
        expect(townPlotPrice(1)).toBe(0)
        expect(townPlotCooldownMs(0)).toBe(0)
        expect(townPlotPrice(-3)).toBe(0)
    })

    it('never runs off the end of the cooldown table', () => {
        const longest = TOWN_PLOT_COOLDOWNS_MS[TOWN_PLOT_COOLDOWNS_MS.length - 1]!
        expect(townPlotCooldownMs(TOWN_MAX_PLOTS + 5)).toBe(longest)
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
    it('lets a building off its own product until it can make it', () => {
        const smithy = getTownBuilding('smithy')!
        expect(smithy.upgradeResources.tools).toBeGreaterThan(0)
        // Levels two to four never ask for tools: the smithy is what makes them.
        for (const level of [2, 3, 4]) {
            expect(townLevelCost(smithy, level).resources.tools).toBeUndefined()
            expect(townLevelCost(smithy, level).resources.bricks).toBeGreaterThan(0)
        }
        expect(townLevelCost(smithy, TOWN_SELF_SUPPLY_LEVEL).resources.tools).toBeGreaterThan(0)
        // A building that wants somebody else's good pays from level two.
        const mine = getTownBuilding('mine')!
        expect(townLevelCost(mine, 2).resources.tools).toBeGreaterThan(0)
    })
})

describe('townPlaceCost', () => {
    const farm = getTownBuilding('farm')!
    const mill = getTownBuilding('mill')!

    it('charges the sticker price for the first copy', () => {
        expect(townPlaceCost(farm, 0)).toEqual({ coins: farm.cost.coins, resources: { ...farm.cost.resources } })
        expect(townPlaceCost(mill, 0)).toEqual({ coins: mill.cost.coins, resources: { ...mill.cost.resources } })
        // A negative count cannot make a building cheaper than its sticker price.
        expect(townPlaceCost(farm, -4)).toEqual(townPlaceCost(farm, 0))
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
})

describe('townTickWork', () => {
    const farm = getTownBuilding('farm')!
    const mill = getTownBuilding('mill')!

    it('pays the fraction out once it adds up to a unit', () => {
        const recipe = townTickRecipe(farm, 1, 1.25)!
        let carry = {}
        let grown = 0
        for (let i = 0; i < 4; i++) {
            const work = townTickWork(recipe, carry)
            grown += work.outputs.wheat ?? 0
            carry = work.carry
        }
        // 1 + 1 + 1 + 2: the quarters land as a whole wheat on the fourth tick.
        expect(grown).toBe(5)
        expect(carry).toEqual({})
    })

    it('does not lose a unit to floating point drift', () => {
        const recipe = { inputs: {}, outputs: { wheat: 0.1 } }
        let carry = {}
        let grown = 0
        for (let i = 0; i < 10; i++) {
            const work = townTickWork(recipe, carry)
            grown += work.outputs.wheat ?? 0
            carry = work.carry
        }
        expect(grown).toBe(1)
        expect(carry).toEqual({})
    })

    it('carries inputs the same way, so a slow mill pays exactly for what it grinds', () => {
        const recipe = townTickRecipe(mill, 1, 0.5)!
        let carry = {}
        let wheat = 0
        let flour = 0
        for (let i = 0; i < 4; i++) {
            const work = townTickWork(recipe, carry)
            wheat += work.inputs.wheat ?? 0
            flour += work.outputs.flour ?? 0
            carry = work.carry
        }
        expect(wheat).toBe(4)
        expect(flour).toBe(2)
    })
})

describe('needs', () => {
    // No need opens before the tier that makes it can: a town is never asked
    // to stock a good it could not have started producing.
    it('never asks for a good before the town could make it', () => {
        for (const need of TOWN_NEEDS) {
            const tier = TOWN_RESOURCES.find(r => r.id === need.resource)!.tier
            expect(need.minPop).toBeGreaterThanOrEqual(TOWN_TIER_POP_REQUIREMENT[tier] ?? 0)
        }
    })
})

describe('townReachableTier', () => {
    it('ignores a building that is still going up', () => {
        const site = built('mill', 'mill', { level: 0, completesAt: T0 + 60_000 })
        const town = [built('farm', 'farm'), site]

        expect(townReachableTier(town, T0)).toBe(getTownBuilding('farm')!.tier)
        expect(townReachableTier(town, T0 + 60_000)).toBe(getTownBuilding('mill')!.tier)
    })
})

describe('moods', () => {
    it('never leaves a gap between one mood and the next', () => {
        for (const mood of TOWN_MOODS) expect(townMood(mood.min)).toBe(mood)
        for (let h = 0; h <= 100; h++) expect(TOWN_MOODS).toContain(townMood(h))
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

    it('keeps the happiness target inside [0, 100]', () => {
        // Three maxed tenements ringed by farms — enough residents that bread
        // is asked for — workshops working more jobs than the town has
        // residents, and an empty larder: the smog ceiling, crowding and every
        // reachable need missing, all at once.
        const houses = [0, 1, 2].map(x => at(`house${x}`, 'house', x, 0, { level: 20, rotation: 2, createdAt: T0 - 2000 + x }))
        const farms = [-2, -1, 0, 1, 2, 3, 4].map(x => at(`farm${x}`, 'farm', x, FARM_NUISANCE.radius, { rotation: 0, createdAt: T0 - 900 + x }))
        // A tier-3 bakery puts bread within reach, so its absence counts — and
        // with a smithy beside it their jobs outnumber the residents.
        const bakery = at('bakery', 'bakery', FAR_AWAY, 0, { level: 20, rotation: 2, createdAt: T0 - 800 })
        const smithy = at('smithy', 'smithy', FAR_AWAY + 1, 0, { level: 20, rotation: 2, createdAt: T0 - 700 })

        const miserable = deriveTown(connected([...houses, ...farms, bakery, smithy]), 50, T0, {})
        expect(miserable.popCap).toBeGreaterThanOrEqual(BREAD.minPop)
        // One home with a maxed park on its doorstep, fed, and a finished
        // Colosseum across town: well past the ceiling.
        const blissful = deriveTown(connected([
            at('house', 'house', 0, 0, { rotation: 2, createdAt: T0 - 1000 }),
            at('park', 'park', 1, 0, { level: 12, rotation: 2, createdAt: T0 - 900 }),
            at('colosseum', 'colosseum', 40, 40, { level: TOWN_MONUMENT_STAGES })
        ]), 50, T0, { wheat: true })

        expect(miserable.happinessBreakdown.industry).toBeLessThan(0)
        expect(miserable.happinessBreakdown.crowding).toBe(-TOWN_HAPPINESS_CROWDING_PENALTY)
        expect(miserable.happinessBreakdown.needs).toBeLessThan(0)
        expect(miserable.happinessTarget).toBe(0)
        expect(blissful.happinessTarget).toBe(100)
    })
})

describe('layout', () => {
    it('caps what one home gains from parks, and never what it loses to factories', () => {
        const house = at('house', 'house', 0, 0)
        const parks = []
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                if (dx === 0 && dy === 0) continue
                parks.push(at(`park${dx}:${dy}`, 'park', dx, dy))
            }
        }
        // Twenty-four parks around one home are worth the home's ceiling, no more.
        expect(parks.length * PARK_CHEER).toBeGreaterThan(TOWN_HOUSE_CHEER_MAX)
        expect(adjacencyHappiness([house, parks[0]!])).toBe(PARK_CHEER)
        expect(adjacencyHappiness([house, ...parks])).toBe(TOWN_HOUSE_CHEER_MAX)
        expect(houseAdjacency([house, ...parks], 0, 0, T0).cheer).toBe(TOWN_HOUSE_CHEER_MAX)

        // Eleven factories over one house is exactly eleven factories' worth of misery.
        const around: [number, number][] = [
            [1, 0], [2, 0], [3, 0], [4, 0],
            [-1, 0], [-2, 0], [-3, 0], [-4, 0],
            [0, 1], [0, 2], [0, 3]
        ]
        const factories = around.map(([dx, dy]) => at(`factory${dx}:${dy}`, 'factory', dx, dy))
        const penalty = townIndustryNuisance(getTownBuilding('factory')!).penalty
        const misery = factories.length * penalty * TOWN_INDUSTRY_PENALTY_SCALE
        expect(misery).toBeGreaterThan(100)
        expect(adjacencyHappiness([house, ...factories])).toBe(-misery)
        // And the parks cannot buy that back: the home's ceiling is far below it.
        expect(adjacencyHappiness([house, ...parks, ...factories])).toBe(TOWN_HOUSE_CHEER_MAX - misery)
    })
})

describe('houseAdjacency', () => {
    it('only counts what has actually finished being built', () => {
        const buildings = [
            at('park', 'park', 1, 0, { level: 0, completesAt: T0 + 60_000 }),
            at('farm', 'farm', 0, 1, { level: 0, completesAt: T0 + 60_000 })
        ]
        expect(houseAdjacency(buildings, 0, 0, T0)).toEqual(NOBODY_AROUND)
        expect(houseAdjacency(buildings, 0, 0, T0 + 60_000).parks).toBe(1)
        expect(houseAdjacency(buildings, 0, 0, T0 + 60_000).industry).toBe(1)
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

    describe('districts', () => {
        // Two streets that never meet: one along y=0, one along y=5.
        const north = [road(0, 0), road(1, 0), road(2, 0)]
        const south = [road(0, 5), road(1, 5), road(2, 5)]
        const houseNorth = at('house-n', 'house', 0, 1, { rotation: 2, createdAt: T0 - 1000 })
        const farmNorth = at('farm-n', 'farm', 1, 1, { rotation: 2, createdAt: T0 - 900 })
        const farmSouth = at('farm-s', 'farm', 1, 6, { rotation: 2, createdAt: T0 - 800 })

        it('joins two networks the moment a road connects them', () => {
            const apart = townDistricts([...north, ...south, farmNorth, farmSouth])
            expect(apart.get('farm-n')).not.toBe(apart.get('farm-s'))
            const bridge = [road(2, 1), road(2, 2), road(2, 3), road(2, 4)]
            const joined = townDistricts([...north, ...south, ...bridge, farmNorth, farmSouth])
            expect(joined.get('farm-n')).toBe(joined.get('farm-s'))
        })

        it('lets residents staff only what their own roads reach', () => {
            // One house on the north street, a farm on each. The north farm
            // fills; the south farm has nobody who can walk to it, however many
            // people the town holds.
            const town = deriveTown([...north, ...south, houseNorth, farmNorth, farmSouth], 50, T0)
            expect(town.popCap).toBe(PER_HOUSE_LEVEL)
            expect(town.staffing.get('farm-n')).toBe(1)
            expect(town.staffing.get('farm-s')).toBe(0)
            expect(town.throughput.get('farm-s')).toBe(0)
            expect(town.workersEmployed).toBe(getTownBuilding('farm')!.workers)

            const south5 = town.districts.get(town.districtOf.get('farm-s')!)!
            expect(south5).toEqual({ residents: 0, jobs: getTownBuilding('farm')!.workers, employed: 0 })
            const north0 = town.districts.get(town.districtOf.get('farm-n')!)!
            expect(north0.residents).toBe(PER_HOUSE_LEVEL)
            expect(north0.employed).toBe(getTownBuilding('farm')!.workers)
        })
    })

    describe('townPlacementIssue', () => {
        const farm = getTownBuilding('farm')!
        const roadDef = getTownBuilding('road')!

        it('refuses a tile something already stands on', () => {
            const buildings = [road(3, 0), at('house', 'house', 3, 1, { rotation: 2 })]
            expect(townPlacementIssue(buildings, farm, 3, 1, 2)).toMatch(/already taken/)
            expect(townPlacementIssue(buildings, roadDef, 3, 0, 0)).toMatch(/already taken/)
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
    })

    it('keeps the total gem payout modest against what the site pays elsewhere', () => {
        const gems = TOWN_MILESTONES.reduce((sum, m) => sum + (m.gems ?? 0), 0)
        expect(gems).toBeGreaterThan(0)
        expect(gems).toBeLessThanOrEqual(350)
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

    it('counts the monument stages that stand, not the one going up', () => {
        const snap = snapshot([
            built('pyramid', 'pyramid', { level: 3 }),
            built('arc', 'arc', { level: 2, upgradingTo: 3, completesAt: T0 + 60_000 }),
            built('site', 'eiffel', { level: 0, completesAt: T0 + 60_000 })
        ])
        expect(snap.monumentStages).toBe(5)
    })

    it('completes the building and road chains off their own counts', () => {
        expect(complete('build-10', snapshot([], { buildingCount: 9 }))).toBe(false)
        expect(complete('build-10', snapshot([], { buildingCount: 10 }))).toBe(true)
        expect(complete('build-150', snapshot([], { buildingCount: 149 }))).toBe(false)
        expect(complete('road-20', snapshot([], { roadCount: 20 }))).toBe(true)
        // Roads are not buildings and buildings are not roads.
        expect(complete('road-20', snapshot([], { buildingCount: 999 }))).toBe(false)
        expect(complete('build-10', snapshot([], { roadCount: 999 }))).toBe(false)
    })

    it('completes self-sufficient only when every need asked for is met', () => {
        expect(complete('self-sufficient', snapshot([], { needsSatisfied: false }))).toBe(false)
        expect(complete('self-sufficient', snapshot([], { needsSatisfied: true }))).toBe(true)

        // A town asked for nothing has not supplied anything.
        expect(townAllNeedsSatisfied({})).toBe(false)
        expect(townAllNeedsSatisfied({ wheat: true })).toBe(true)
        expect(townAllNeedsSatisfied({ wheat: true, bread: false })).toBe(false)
        expect(townAllNeedsSatisfied(Object.fromEntries(TOWN_NEEDS.map(n => [n.resource, true])))).toBe(true)
    })

    it('completes full-chain only with one of every industry building', () => {
        const industry = TOWN_BUILDINGS.filter(b => b.kind === 'industry')
        const all = industry.map(def => built(`i-${def.id}`, def.id))
        expect(complete('full-chain', snapshot(all))).toBe(true)
        expect(complete('full-chain', snapshot(all.slice(1)))).toBe(false)
        // Duplicates of one workshop are not a chain.
        expect(complete('full-chain', snapshot(
            Array.from({ length: industry.length }, (_, i) => built(`farm${i}`, 'farm'))
        ))).toBe(false)
    })

    it('keeps the land chain inside the plots a town can actually own', () => {
        const land = TOWN_MILESTONES.filter(m => m.chain === 'land')
        const empty = snapshot([])
        for (const m of land) expect(m.progress(empty).target).toBeLessThanOrEqual(TOWN_MAX_PLOTS)
        expect(land.at(-1)!.progress(empty).target).toBe(TOWN_MAX_PLOTS)
    })

    it('keeps the level chain inside the highest level a building reaches', () => {
        const levels = TOWN_MILESTONES.filter(m => m.chain === 'levels')
        const empty = snapshot([])
        for (const m of levels) expect(m.progress(empty).target).toBeLessThanOrEqual(TOWN_MAX_BUILDING_LEVEL)
        expect(levels.at(-1)!.progress(empty).target).toBe(TOWN_MAX_BUILDING_LEVEL)
    })

    it('completes first-home only once a house is standing', () => {
        expect(complete('first-home', snapshot([]))).toBe(false)
        expect(complete('first-home', snapshot([
            built('house', 'house', { level: 0, completesAt: T0 + 60_000 })
        ]))).toBe(false)
        expect(complete('first-home', snapshot([built('house', 'house')]))).toBe(true)
    })

    it('leaves a fresh town with nothing but the empty milestones incomplete', () => {
        const fresh = snapshot([])
        const done = TOWN_MILESTONES.filter(m => townMilestoneComplete(m, fresh)).map(m => m.id)
        expect(done).toEqual([])
    })
})

describe('settleTown', () => {
    it('produces one surplus wheat per tick at full happiness', () => {
        const result = settleTown(sim({ buildings: houseAndFarm() }), T0 + TOWN_TICK_MS)
        expect(result.ticks).toBe(1)
        // Two grown, one eaten.
        expect(result.delta).toEqual({ wheat: 1 })
        expect(result.satisfied).toEqual({ wheat: true })
    })

    it('reports the needs it could not supply without touching the stock', () => {
        // A town big enough to want bread as well as grain, and more than one
        // grain a tick — so a part-stocked larder can fall short.
        const buildings = [BIG_HOUSE, BAKERY]
        expect(Object.keys(BIG_DEMAND)).toEqual([GRAIN.resource, BRICKS.resource, BREAD.resource])
        expect(BIG_DEMAND.wheat!).toBeGreaterThan(1)

        const short = settleTown(sim({ happiness: 50, inventory: { wheat: BIG_DEMAND.wheat! - 1 }, buildings }), T0 + 3 * TOWN_TICK_MS)
        expect(short.ticks).toBeGreaterThan(0)
        // Half a demand feeds nobody, so the grain on hand is never eaten.
        expect(short.delta).toEqual({})
        expect(short.satisfied).toEqual({ wheat: false, bricks: false, bread: false })

        // Two whole tick's worth of grain and a leftover the third cannot use.
        const stocked = settleTown(sim({ happiness: 50, inventory: { wheat: 2 * BIG_DEMAND.wheat! + 1 }, buildings }), T0 + 3 * TOWN_TICK_MS)
        expect(stocked.ticks).toBe(3)
        expect(stocked.delta).toEqual({ wheat: -2 * BIG_DEMAND.wheat! })
        expect(stocked.satisfied).toEqual({ wheat: false, bricks: false, bread: false })
    })

    it('lets a fed town climb and a starving one sink', () => {
        const buildings = [BIG_HOUSE, BAKERY]
        const fed = settleTown(sim({ happiness: 50, inventory: { wheat: 500, bread: 500 }, buildings }), T0 + 5 * TOWN_TICK_MS)
        const starving = settleTown(sim({ happiness: 50, buildings }), T0 + 5 * TOWN_TICK_MS)

        expect(fed.satisfied).toEqual({ wheat: true, bricks: false, bread: true })
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

    describe('fractional output', () => {
        it('produces the same total whether a window is settled whole or in pieces', () => {
            const buildings = farmOn(fertileTile())
            const whole = settleTown(sim({ buildings }), T0 + 8 * TOWN_TICK_MS)

            const first = settleTown(sim({ buildings }), T0 + 3 * TOWN_TICK_MS)
            const resume = {
                happiness: first.happiness,
                tickProgressMs: first.tickProgressMs,
                lastSettledAt: first.lastSettledAt,
                buildings
            }
            const second = settleTown(sim({ ...resume, carry: first.carry }), T0 + 8 * TOWN_TICK_MS)
            expect(first.ticks + second.ticks).toBe(whole.ticks)
            expect((first.delta.wheat ?? 0) + (second.delta.wheat ?? 0)).toBe(whole.delta.wheat ?? 0)

            // Which is exactly why the carry is persisted: forgetting it
            // between settles quietly loses part of the bonus.
            const forgetful = settleTown(sim(resume), T0 + 8 * TOWN_TICK_MS)
            expect((first.delta.wheat ?? 0) + (forgetful.delta.wheat ?? 0)).toBeLessThan(whole.delta.wheat ?? 0)
        })

        it('leaves the carry alone on a tick the workshop cannot run', () => {
            const buildings = [
                built('house', 'house', { createdAt: T0 - 90_000 }),
                built('mill', 'mill', { createdAt: T0 - 80_000 })
            ]
            // No wheat to grind: the half a flour already made stays half made.
            const starved = settleTown(sim({ buildings, carry: { mill: { flour: 0.5 } } }), T0 + TOWN_TICK_MS)
            expect(starved.ticks).toBe(1)
            expect(starved.delta).toEqual({})
            expect(starved.carry).toEqual({ mill: { flour: 0.5 } })
        })
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
