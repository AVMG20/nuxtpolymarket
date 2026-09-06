import { describe, expect, it } from 'vitest'
import {
    TOWN_BASE_STORAGE,
    TOWN_HAPPINESS_BASE_TARGET,
    TOWN_HAPPINESS_BREAD_BONUS,
    TOWN_HAPPINESS_CROWDING_PENALTY,
    TOWN_HAPPINESS_INDUSTRY_ADJACENT,
    TOWN_HAPPINESS_INDUSTRY_PENALTY,
    TOWN_HAPPINESS_PARK_ADJACENT,
    TOWN_LEVEL_COST_GROWTH,
    TOWN_MAX_OFFLINE_MS,
    TOWN_PLOT_COOLDOWN_BASE_MS,
    TOWN_PLOT_COOLDOWN_GROWTH,
    TOWN_PLOT_PRICE_BASE,
    TOWN_PLOT_PRICE_GROWTH,
    TOWN_RUSH_MS_PER_GEM,
    TOWN_MILESTONES,
    TOWN_TICK_MS,
    TOWN_WAREHOUSE_STORAGE,
    adjacencyHappiness,
    deriveTown,
    getTownBuilding,
    getTownMilestone,
    houseAdjacency,
    isValidTownPrice,
    isValidTownQuantity,
    scaleBag,
    settleTown,
    townLevelCost,
    townMilestoneComplete,
    townMilestoneSnapshot,
    townNetPerTick,
    townOrderTotal,
    townPlotCooldownMs,
    townPlotPrice,
    townRushGemCost,
    townSpeedMultiplier,
    townSpiralCoords,
    townTierUnlocked,
    type TownBuildingId,
    type TownMilestoneSnapshot,
    type TownSimBuilding,
    type TownSimState
} from '#shared/utils/gamelogic/town'

const T0 = 1_700_000_000_000

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

// A house (4 pop) plus a farm (1 worker) is the smallest town that actually
// produces: without housing every industry building sits at staffing 0.
function houseAndFarm(): TownSimBuilding[] {
    return [
        built('house', 'house', { createdAt: T0 - 90_000 }),
        built('farm', 'farm', { createdAt: T0 - 80_000 })
    ]
}

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
            expect(townPlotPrice(index)).toBe(Math.round(townPlotPrice(index - 1) * TOWN_PLOT_PRICE_GROWTH))
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

    it('leaves a free building free at every level', () => {
        const house = getTownBuilding('house')!
        expect(townLevelCost(house, 5).resources).toEqual({})
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

describe('deriveTown', () => {
    it('houses four residents per house level', () => {
        const town = deriveTown([built('h', 'house', { level: 3 })], 50, T0, false)
        expect(town.popCap).toBe(getTownBuilding('house')!.popCap * 3)
    })

    it('ignores buildings that are still under construction', () => {
        const town = deriveTown([built('h', 'house', { level: 0, completesAt: T0 + 60_000 })], 50, T0, false)
        expect(town.popCap).toBe(0)
    })

    it('hands workers to the oldest industry first', () => {
        // One house (4 residents) against five farms (5 jobs): the newest farm
        // is the one that goes idle.
        const buildings = [
            built('house', 'house', { createdAt: T0 - 1000 }),
            ...Array.from({ length: 5 }, (_, i) => built(`farm${i}`, 'farm', { createdAt: T0 - 900 + i }))
        ]
        const town = deriveTown(buildings, 50, T0, false)

        expect(town.popCap).toBe(4)
        expect(town.workersDemanded).toBe(5)
        expect(town.workersEmployed).toBe(4)
        expect([0, 1, 2, 3].map(i => town.staffing.get(`farm${i}`))).toEqual([1, 1, 1, 1])
        expect(town.staffing.get('farm4')).toBe(0)
    })

    it('staffs a half-manned building at a fractional ratio', () => {
        // house 4 pop; farm takes 1, the level-2 mill wants 4 and gets 3.
        const buildings = [
            built('house', 'house', { createdAt: T0 - 1000 }),
            built('farm', 'farm', { createdAt: T0 - 900 }),
            built('mill', 'mill', { level: 2, createdAt: T0 - 800 })
        ]
        const town = deriveTown(buildings, 50, T0, false)

        expect(town.staffing.get('farm')).toBe(1)
        expect(town.staffing.get('mill')).toBe(0.75)
        expect(town.workersEmployed).toBe(4)
    })

    it('docks happiness for every industry tile', () => {
        const buildings = [
            built('house', 'house', { level: 3, createdAt: T0 - 1000 }),
            built('farm', 'farm', { createdAt: T0 - 900 }),
            built('lumber', 'lumber', { createdAt: T0 - 800 })
        ]
        const town = deriveTown(buildings, 50, T0, false)

        expect(town.industryTiles).toBe(2)
        expect(town.happinessTarget).toBe(TOWN_HAPPINESS_BASE_TARGET - 2 * TOWN_HAPPINESS_INDUSTRY_PENALTY)
    })

    it('docks happiness again once there are more jobs than residents', () => {
        const roomy = deriveTown([
            built('house', 'house', { level: 2, createdAt: T0 - 1000 }),
            ...Array.from({ length: 5 }, (_, i) => built(`farm${i}`, 'farm', { createdAt: T0 - 900 + i }))
        ], 50, T0, false)
        const crowded = deriveTown([
            built('house', 'house', { createdAt: T0 - 1000 }),
            ...Array.from({ length: 5 }, (_, i) => built(`farm${i}`, 'farm', { createdAt: T0 - 900 + i }))
        ], 50, T0, false)

        expect(roomy.happinessTarget).toBe(TOWN_HAPPINESS_BASE_TARGET - 5 * TOWN_HAPPINESS_INDUSTRY_PENALTY)
        expect(crowded.happinessTarget).toBe(roomy.happinessTarget - TOWN_HAPPINESS_CROWDING_PENALTY)
    })

    it('adds the bread bonus to the target when the town ate', () => {
        const hungry = deriveTown(houseAndFarm(), 50, T0, false)
        const fed = deriveTown(houseAndFarm(), 50, T0, true)
        expect(fed.happinessTarget).toBe(hungry.happinessTarget + TOWN_HAPPINESS_BREAD_BONUS)
    })

    it('keeps the happiness target inside [0, 100]', () => {
        const miserable = deriveTown(
            Array.from({ length: 200 }, (_, i) => built(`farm${i}`, 'farm', { createdAt: T0 - 900 + i })),
            50, T0, false
        )
        const blissful = deriveTown(
            Array.from({ length: 40 }, (_, i) => built(`park${i}`, 'park', { createdAt: T0 - 900 + i })),
            50, T0, true
        )
        expect(miserable.happinessTarget).toBe(0)
        expect(blissful.happinessTarget).toBe(100)
    })

    it('raises the storage cap by one warehouse allowance per level', () => {
        expect(deriveTown([], 50, T0, false).storageCap).toBe(TOWN_BASE_STORAGE)
        expect(deriveTown([built('w', 'warehouse', { level: 2 })], 50, T0, false).storageCap)
            .toBe(TOWN_BASE_STORAGE + 2 * TOWN_WAREHOUSE_STORAGE)
    })

    it('maps happiness onto a 0.5 .. 1.0 speed multiplier', () => {
        expect(townSpeedMultiplier(0)).toBe(0.5)
        expect(townSpeedMultiplier(50)).toBe(0.75)
        expect(townSpeedMultiplier(100)).toBe(1)
        expect(townSpeedMultiplier(-50)).toBe(0.5)
        expect(townSpeedMultiplier(1000)).toBe(1)
        expect(deriveTown([], 100, T0, false).speedMultiplier).toBe(1)
    })
})

describe('adjacencyHappiness', () => {
    it('pays a house two happiness for every park it touches', () => {
        expect(adjacencyHappiness([
            at('house', 'house', 0, 0),
            at('park', 'park', 1, 0)
        ])).toBe(TOWN_HAPPINESS_PARK_ADJACENT)

        // Both orthogonal neighbours count, so the same house can bank twice.
        expect(adjacencyHappiness([
            at('house', 'house', 0, 0),
            at('parkE', 'park', 1, 0),
            at('parkN', 'park', 0, 1)
        ])).toBe(2 * TOWN_HAPPINESS_PARK_ADJACENT)
    })

    it('counts every (house, neighbour) pair, not every building', () => {
        // One park wedged between two houses is worth its bonus to each of them.
        expect(adjacencyHappiness([
            at('houseW', 'house', 0, 0),
            at('park', 'park', 1, 0),
            at('houseE', 'house', 2, 0)
        ])).toBe(2 * TOWN_HAPPINESS_PARK_ADJACENT)
    })

    it('docks a house for every industry building next door', () => {
        expect(adjacencyHappiness([
            at('house', 'house', 0, 0),
            at('farm', 'farm', 1, 0)
        ])).toBe(-TOWN_HAPPINESS_INDUSTRY_ADJACENT)

        // A park on one side and a quarry on the other cancel down to the net.
        expect(adjacencyHappiness([
            at('house', 'house', 0, 0),
            at('park', 'park', -1, 0),
            at('quarry', 'quarry', 1, 0)
        ])).toBe(TOWN_HAPPINESS_PARK_ADJACENT - TOWN_HAPPINESS_INDUSTRY_ADJACENT)
    })

    it('ignores neighbours that are neither civic nor industry', () => {
        expect(adjacencyHappiness([
            at('house', 'house', 0, 0),
            at('house2', 'house', 1, 0),
            at('warehouse', 'warehouse', 0, 1)
        ])).toBe(0)
    })

    it('does not count diagonals', () => {
        expect(adjacencyHappiness([
            at('house', 'house', 0, 0),
            at('park', 'park', 1, 1),
            at('farm', 'farm', -1, -1)
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
        const layout = [
            at('house', 'house', 0, 0, { createdAt: T0 - 1000 }),
            at('park', 'park', 1, 0, { createdAt: T0 - 900 })
        ]
        const plain = deriveTown([
            built('house', 'house', { createdAt: T0 - 1000 }),
            built('park', 'park', { createdAt: T0 - 900 })
        ], 50, T0, false)

        expect(deriveTown(layout, 50, T0, false).happinessTarget)
            .toBe(plain.happinessTarget + TOWN_HAPPINESS_PARK_ADJACENT)
    })
})

describe('houseAdjacency', () => {
    it('counts the parks and industry around a tile', () => {
        const buildings = [
            at('park', 'park', 1, 0),
            at('farm', 'farm', -1, 0),
            at('quarry', 'quarry', 0, 1),
            at('house', 'house', 0, -1)
        ]
        expect(houseAdjacency(buildings, 0, 0)).toEqual({ parks: 1, industry: 2 })
    })

    it('reports an empty neighbourhood for a tile with nothing around it', () => {
        expect(houseAdjacency([at('park', 'park', 5, 5)], 0, 0)).toEqual({ parks: 0, industry: 0 })
        expect(houseAdjacency([], 0, 0)).toEqual({ parks: 0, industry: 0 })
    })

    it('ignores diagonals and buildings without world coordinates', () => {
        expect(houseAdjacency([
            at('park', 'park', 1, 1),
            built('farm', 'farm')
        ], 0, 0)).toEqual({ parks: 0, industry: 0 })
    })

    it('agrees with adjacencyHappiness on what one house is worth', () => {
        const buildings = [
            at('house', 'house', 0, 0),
            at('park', 'park', 1, 0),
            at('farm', 'farm', 0, 1)
        ]
        const { parks, industry } = houseAdjacency(buildings, 0, 0)
        expect(parks * TOWN_HAPPINESS_PARK_ADJACENT - industry * TOWN_HAPPINESS_INDUSTRY_ADJACENT)
            .toBe(adjacencyHappiness(buildings))
    })
})

describe('townTierUnlocked', () => {
    it('never gates the starter tiers', () => {
        expect(townTierUnlocked([], 0, T0)).toBe(true)
        expect(townTierUnlocked([], 1, T0)).toBe(true)
    })

    it('keeps tier 2 locked until a tier-1 building has actually finished', () => {
        const unfinished = [built('farm', 'farm', { level: 0, completesAt: T0 + 60_000 })]
        expect(townTierUnlocked(unfinished, 2, T0)).toBe(false)
        expect(townTierUnlocked([], 2, T0)).toBe(false)

        expect(townTierUnlocked([built('farm', 'farm')], 2, T0)).toBe(true)
        // The same row, once its clock has run out, unlocks the tier.
        expect(townTierUnlocked(unfinished, 2, T0 + 60_000)).toBe(true)
    })

    it('looks only at the tier directly below', () => {
        const farm = [built('farm', 'farm')]
        expect(townTierUnlocked(farm, 3, T0)).toBe(false)

        const mill = [built('mill', 'mill')]
        expect(townTierUnlocked(mill, 3, T0)).toBe(true)
        expect(townTierUnlocked(mill, 2, T0)).toBe(false)
    })

    it('ignores houses and parks, which sit below tier 1', () => {
        expect(townTierUnlocked([built('house', 'house'), built('park', 'park')], 2, T0)).toBe(false)
    })
})

describe('townNetPerTick', () => {
    function net(buildings: TownSimBuilding[], happiness = 100) {
        return townNetPerTick(buildings, deriveTown(buildings, happiness, T0, false), T0)
    }

    it('nets the mill\'s wheat draw against the farm\'s output', () => {
        // 4 residents cover the farm's 1 job and the mill's 2, so both run full.
        const buildings = [
            built('house', 'house', { createdAt: T0 - 1000 }),
            built('farm', 'farm', { createdAt: T0 - 900 }),
            built('mill', 'mill', { createdAt: T0 - 800 })
        ]
        // Farm +1 wheat, mill −2 wheat +1 flour, and 3 workers eat a loaf.
        expect(net(buildings)).toEqual({ wheat: -1, flour: 1, bread: -1 })
    })

    it('subtracts the bread the working townsfolk eat', () => {
        const idle = [built('house', 'house')]
        // Nobody is employed, so nobody eats.
        expect(net(idle)).toEqual({})

        const working = [
            built('house', 'house', { createdAt: T0 - 1000 }),
            built('farm', 'farm', { createdAt: T0 - 900 })
        ]
        expect(net(working)).toEqual({ wheat: 1, bread: -1 })
    })

    it('counts nothing for a building that has no staff', () => {
        // No housing at all: the farm is unstaffed and produces nothing.
        expect(net([built('farm', 'farm')])).toEqual({})
    })

    it('skips buildings that are still under construction', () => {
        const buildings = [
            built('house', 'house', { createdAt: T0 - 1000 }),
            built('farm', 'farm', { level: 0, completesAt: T0 + 60_000, createdAt: T0 - 900 })
        ]
        expect(net(buildings)).toEqual({})
        expect(net(buildings.map(b => ({ ...b, completesAt: T0 - 1 })))).toEqual({ wheat: 1, bread: -1 })
    })

    it('scales output with the building level', () => {
        const buildings = [
            built('house', 'house', { level: 2, createdAt: T0 - 1000 }),
            built('farm', 'farm', { level: 3, createdAt: T0 - 900 })
        ]
        expect(net(buildings)).toEqual({ wheat: 3, bread: -1 })
    })
})

describe('milestones', () => {
    function snapshot(buildings: TownSimBuilding[], over: Partial<TownMilestoneSnapshot> = {}): TownMilestoneSnapshot {
        const happiness = over.happiness ?? 50
        const derived = deriveTown(buildings, happiness, T0, false)
        return {
            ...townMilestoneSnapshot(buildings, derived, happiness, over.plotsBought ?? 1, over.coinsEarned ?? 0, T0),
            ...over
        }
    }

    function complete(id: string, snap: TownMilestoneSnapshot) {
        return townMilestoneComplete(getTownMilestone(id)!, snap)
    }

    it('gives every milestone a unique id and a positive reward', () => {
        expect(new Set(TOWN_MILESTONES.map(m => m.id)).size).toBe(TOWN_MILESTONES.length)
        expect(TOWN_MILESTONES.every(m => m.reward > 0)).toBe(true)
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
        expect(snap.popCap).toBe(8)
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

        // Houses and parks are not industry, however many you build.
        expect(complete('growing', snapshot(
            Array.from({ length: 6 }, (_, i) => built(`park${i}`, 'park', { createdAt: T0 - 900 + i }))
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

    it('produces one wheat per minute at full happiness', () => {
        const result = settleTown(sim({ buildings: houseAndFarm() }), T0 + TOWN_TICK_MS)
        expect(result.ticks).toBe(1)
        expect(result.delta).toEqual({ wheat: 1 })
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

    it('stops producing once storage is full', () => {
        const result = settleTown(
            sim({ inventory: { wheat: TOWN_BASE_STORAGE - 1 }, buildings: houseAndFarm() }),
            T0 + 5 * TOWN_TICK_MS
        )
        expect(result.ticks).toBeGreaterThan(1)
        expect(result.delta).toEqual({ wheat: 1 })

        const alreadyFull = settleTown(
            sim({ inventory: { wheat: TOWN_BASE_STORAGE }, buildings: houseAndFarm() }),
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
        // Ground twice the input into one flour on tick one; tick two was short.
        expect(stocked.delta).toEqual({ wheat: -2, flour: 1 })

        const starved = settleTown(sim({ inventory: { wheat: 1 }, buildings }), T0 + 130_000)
        expect(starved.ticks).toBe(2)
        expect(starved.delta).toEqual({})
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
        const buildings = [
            built('house', 'house', { createdAt: T0 - 90_000 }),
            built('farm', 'farm', { level: 0, completesAt: T0 + 150_000, createdAt: T0 })
        ]
        const result = settleTown(sim({ buildings }), T0 + 10 * TOWN_TICK_MS)

        expect(result.completed).toEqual([{ id: 'farm', level: 1 }])
        expect(result.ticks).toBeGreaterThan(5)
        expect(result.delta.wheat ?? 0).toBeGreaterThan(0)
        // Ticks before the build finished (~2.5 min at ×0.8 speed) must not have produced.
        expect(result.delta.wheat ?? 0).toBeLessThan(result.ticks)
    })

    it('bakes a finished upgrade into completed and produces at the new level', () => {
        const buildings = [
            built('house', 'house', { createdAt: T0 - 90_000 }),
            built('farm', 'farm', { level: 1, upgradingTo: 2, completesAt: T0 - 1, createdAt: T0 - 80_000 })
        ]
        const result = settleTown(sim({ buildings }), T0 + TOWN_TICK_MS)

        expect(result.completed).toEqual([{ id: 'farm', level: 2 }])
        expect(result.delta).toEqual({ wheat: 2 })
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

    it('eats bread every tick and ends happier for it', () => {
        const buildings = houseAndFarm()
        const fed = settleTown(sim({ happiness: 50, inventory: { bread: 10 }, buildings }), T0 + 400_000)
        const hungry = settleTown(sim({ happiness: 50, buildings }), T0 + 400_000)

        expect(fed.delta.bread).toBe(-fed.ticks)
        expect(fed.happiness).toBeGreaterThan(hungry.happiness)
        // The target the fed town is climbing toward is the hungry one plus the loaf bonus.
        expect(deriveTown(buildings, fed.happiness, T0, true).happinessTarget)
            .toBe(deriveTown(buildings, fed.happiness, T0, false).happinessTarget + TOWN_HAPPINESS_BREAD_BONUS)
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
