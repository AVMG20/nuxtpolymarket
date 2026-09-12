import { describe, expect, it } from 'vitest'
import {
    TOWN_BUILDINGS,
    TOWN_RESOURCES,
    TOWN_SUPPLY_FALLOFF_TILES,
    TOWN_SUPPLY_FULL_TILES,
    TOWN_SUPPLY_MIN_EFFICIENCY,
    TOWN_TICK_MS,
    deriveTown,
    getTownBuilding,
    settleTown,
    townTerrainMultiplier,
    townResourceDepth,
    townRoadDistance,
    townSupply,
    townSupplyEfficiency,
    townSupplyNetwork,
    type TownBuildingId,
    type TownResourceId,
    type TownSimBuilding,
    type TownSimState,
    type TownSupplyEntry
} from '#shared/utils/gamelogic/town'

const T0 = 1_700_000_000_000

const LUMBER = getTownBuilding('lumber')!
const SAWMILL = getTownBuilding('sawmill')!
const FARM = getTownBuilding('farm')!
const MILL = getTownBuilding('mill')!
const BAKERY = getTownBuilding('bakery')!
const HOUSE = getTownBuilding('house')!

/** Wood one level of lumber camp fells per tick, and what one level of sawmill eats. */
const WOOD_PER_CAMP = LUMBER.outputs.wood!
const WOOD_PER_SAWMILL = SAWMILL.inputs.wood!

/**
 * A distance halfway up the falloff ramp: far enough that the trip costs
 * something, near enough that it has not bottomed out. Everything positional
 * in this file is measured off the two radii so a retune moves the fixtures
 * instead of breaking them.
 */
const HALFWAY_TILES = Math.round((TOWN_SUPPLY_FULL_TILES + TOWN_SUPPLY_FALLOFF_TILES) / 2)
/** Long enough a street that nothing on it accidentally falls off the end. */
const STREET_END = TOWN_SUPPLY_FALLOFF_TILES + 8
/** Where the housing estate sits — past every nuisance radius in the game. */
const ESTATE_X = TOWN_SUPPLY_FALLOFF_TILES + 12

// ─── Fixtures ────────────────────────────────────────────────────────────────
// deriveTown drops any building without a road at its front door, and the
// supply network only registers one whose front tile IS a road. So every town
// here is a single street of road tiles along y = 0: workshops stand at y = 1
// facing south (rotation 2), houses at y = -1 facing north (rotation 0), and
// both open onto the same road. Road distance is then just the gap in x.

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

function at(id: string, type: TownBuildingId, wx: number, wy: number, over: Partial<TownSimBuilding> = {}): TownSimBuilding {
    return built(id, type, { wx, wy, ...over })
}

function road(wx: number, wy: number): TownSimBuilding {
    return at(`road-${wx}-${wy}`, 'road', wx, wy)
}

/** Road tiles from x = `from` to x = `to` along y = 0. */
function street(from: number, to: number): TownSimBuilding[] {
    const tiles: TownSimBuilding[] = []
    for (let x = from; x <= to; x++) tiles.push(road(x, 0))
    return tiles
}

/** A workshop on the north side of the street, its door on (x, 0). */
function shop(id: string, type: TownBuildingId, x: number, over: Partial<TownSimBuilding> = {}): TownSimBuilding {
    return at(id, type, x, 1, { rotation: 2, ...over })
}

/** A house on the south side of the street, its door on (x, 0). */
function home(id: string, x: number, over: Partial<TownSimBuilding> = {}): TownSimBuilding {
    return at(id, 'house', x, -1, { rotation: 0, ...over })
}

/** Enough housing to shelter `pop`, parked far from every workshop's smog. */
function estate(pop: number): TownSimBuilding[] {
    const levels = Math.ceil(pop / HOUSE.popCap)
    return [home('estate', ESTATE_X, { level: levels, createdAt: T0 - 5_000 })]
}

function network(buildings: TownSimBuilding[]) {
    return townSupplyNetwork(buildings, T0)
}

/** Every industry building manned to the given ratio — staffing is not what these specs are about. */
function staffedAt(buildings: TownSimBuilding[], staff = 1): Map<string, number> {
    const map = new Map<string, number>()
    for (const b of buildings) {
        if (getTownBuilding(b.type)!.kind === 'industry') map.set(b.id, staff)
    }
    return map
}

/** Supply for a fully manned town, so anything short of 1 is the roads' doing. */
function supplyOf(buildings: TownSimBuilding[]): Map<string, TownSupplyEntry> {
    return townSupply(buildings, staffedAt(buildings), network(buildings), T0)
}

function ratioOf(buildings: TownSimBuilding[], id: string): number {
    return supplyOf(buildings).get(id)!.ratio
}

function sim(over: Partial<TownSimState> = {}): TownSimState {
    return {
        happiness: 50,
        tickProgressMs: 0,
        lastSettledAt: T0,
        inventory: {},
        buildings: [],
        ...over
    }
}

describe('townSupplyEfficiency', () => {
    it('delivers every unit inside the full radius', () => {
        for (const tiles of [0, 1, TOWN_SUPPLY_FULL_TILES - 1, TOWN_SUPPLY_FULL_TILES]) {
            expect(townSupplyEfficiency(tiles)).toBe(1)
        }
    })

    it('bottoms out at the minimum from the falloff radius onward', () => {
        for (const tiles of [TOWN_SUPPLY_FALLOFF_TILES, TOWN_SUPPLY_FALLOFF_TILES + 1, TOWN_SUPPLY_FALLOFF_TILES * 10]) {
            expect(townSupplyEfficiency(tiles)).toBe(TOWN_SUPPLY_MIN_EFFICIENCY)
        }
    })

    it('falls strictly, and only, between the two radii', () => {
        let previous = townSupplyEfficiency(TOWN_SUPPLY_FULL_TILES)
        for (let tiles = TOWN_SUPPLY_FULL_TILES + 1; tiles < TOWN_SUPPLY_FALLOFF_TILES; tiles++) {
            const here = townSupplyEfficiency(tiles)
            expect(here).toBeLessThan(previous)
            // Strictly inside the band at both ends: the ramp never reaches
            // either bound before the radius that owns it.
            expect(here).toBeLessThan(1)
            expect(here).toBeGreaterThan(TOWN_SUPPLY_MIN_EFFICIENCY)
            previous = here
        }
    })

    it('rams down in equal steps — a straight line, not a curve', () => {
        // Every extra tile costs the same, so the halfway distance is worth
        // exactly the average of the two ends.
        const steps: number[] = []
        for (let tiles = TOWN_SUPPLY_FULL_TILES; tiles < TOWN_SUPPLY_FALLOFF_TILES; tiles++) {
            steps.push(townSupplyEfficiency(tiles + 1) - townSupplyEfficiency(tiles))
        }
        for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 10)
        expect(townSupplyEfficiency(HALFWAY_TILES))
            .toBeCloseTo((1 + TOWN_SUPPLY_MIN_EFFICIENCY) / 2, 10)
    })

    it('joins up at both radii with no step in the curve', () => {
        const hair = 1e-9
        expect(townSupplyEfficiency(TOWN_SUPPLY_FULL_TILES + hair)).toBeCloseTo(1, 8)
        expect(townSupplyEfficiency(TOWN_SUPPLY_FALLOFF_TILES - hair)).toBeCloseTo(TOWN_SUPPLY_MIN_EFFICIENCY, 8)
    })
})

describe('townResourceDepth', () => {
    /** Everything a building with nothing to haul in can make: the raw goods. */
    const raw = new Set<TownResourceId>()
    for (const def of TOWN_BUILDINGS) {
        if (def.kind !== 'industry' || Object.keys(def.inputs).length > 0) continue
        for (const id of Object.keys(def.outputs) as TownResourceId[]) raw.add(id)
    }

    it('puts everything dug or grown from nothing at the bottom', () => {
        expect([...raw].sort()).toEqual(['jewels', 'stone', 'wheat', 'wood'])
        for (const id of raw) expect(townResourceDepth(id)).toBe(0)
    })

    it('gives every resource a whole, non-negative depth', () => {
        for (const r of TOWN_RESOURCES) {
            const depth = townResourceDepth(r.id)
            expect(Number.isInteger(depth)).toBe(true)
            expect(depth).toBeGreaterThanOrEqual(0)
        }
    })

    // This is the invariant townSupply's resolution order rests on: it walks
    // the consumed resources shallowest first so that, by the time a bakery
    // asks for flour, the mill that makes it already knows its own ratio. If
    // any recipe ever consumed something as deep as what it makes, that walk
    // would read a supplier's ratio before it was computed.
    it('makes every recipe deepen the chain, across the whole building table', () => {
        for (const def of TOWN_BUILDINGS) {
            const inputs = Object.keys(def.inputs) as TownResourceId[]
            const outputs = Object.keys(def.outputs) as TownResourceId[]
            if (inputs.length === 0 || outputs.length === 0) continue
            const deepestInput = Math.max(...inputs.map(townResourceDepth))
            for (const out of outputs) {
                expect(townResourceDepth(out)).toBeGreaterThan(deepestInput)
            }
        }
    })

    it('orders the chains a town actually walks', () => {
        expect(townResourceDepth('wood')).toBeLessThan(townResourceDepth('planks'))
        expect(townResourceDepth('planks')).toBeLessThan(townResourceDepth('tools'))
        expect(townResourceDepth('tools')).toBeLessThan(townResourceDepth('ore'))
        expect(townResourceDepth('ore')).toBeLessThan(townResourceDepth('steel'))
        expect(townResourceDepth('steel')).toBeLessThan(townResourceDepth('machines'))
        expect(townResourceDepth('machines')).toBeLessThan(townResourceDepth('luxuries'))

        expect(townResourceDepth('wheat')).toBeLessThan(townResourceDepth('flour'))
        expect(townResourceDepth('flour')).toBeLessThan(townResourceDepth('bread'))

        // The last thing a town learns to make is the deepest thing there is.
        const deepest = Math.max(...TOWN_RESOURCES.map(r => townResourceDepth(r.id)))
        expect(townResourceDepth('luxuries')).toBe(deepest)
    })
})

describe('townSupplyNetwork and townRoadDistance', () => {
    it('registers each workshop against the road tile it fronts onto', () => {
        const buildings = [...street(0, 4), shop('camp', 'lumber', 0), shop('saw', 'sawmill', 3)]
        const net = network(buildings)

        expect(net.frontOf.get('camp')).toBe('0,0')
        expect(net.frontOf.get('saw')).toBe('3,0')
    })

    it('counts the tiles between two doors down the street', () => {
        const buildings = [...street(0, 6), shop('camp', 'lumber', 0), shop('near', 'sawmill', 1), shop('far', 'sawmill', 4)]
        const net = network(buildings)

        expect(townRoadDistance(net, 'camp', 'near')).toBe(1)
        expect(townRoadDistance(net, 'camp', 'far')).toBe(4)
        // The walk is the same in either direction.
        expect(townRoadDistance(net, 'far', 'camp')).toBe(4)
    })

    it('reads zero when two workshops share one front tile', () => {
        // Facing each other across a single road tile: no journey at all.
        const buildings = [road(0, 0), shop('north', 'lumber', 0), at('south', 'sawmill', 0, -1, { rotation: 0 })]
        const net = network(buildings)

        expect(net.frontOf.get('north')).toBe(net.frontOf.get('south'))
        expect(townRoadDistance(net, 'north', 'south')).toBe(0)
        expect(townSupplyEfficiency(0)).toBe(1)
    })

    it('measures the road, not the crow\'s flight', () => {
        // Two doors two tiles apart with no road between them; the only way
        // across is the loop below, which is twice as long.
        const buildings = [
            road(0, 0), road(0, -1), road(1, -1), road(2, -1), road(2, 0),
            shop('camp', 'lumber', 0),
            shop('saw', 'sawmill', 2)
        ]
        const net = network(buildings)
        const asTheCrowFlies = 2

        expect(townRoadDistance(net, 'camp', 'saw')).toBe(4)
        expect(townRoadDistance(net, 'camp', 'saw')).toBeGreaterThan(asTheCrowFlies)
    })

    it('returns null between two towns that never meet', () => {
        // Two one-tile roads with nothing joining them.
        const buildings = [road(0, 0), road(10, 0), shop('camp', 'lumber', 0), shop('saw', 'sawmill', 10)]
        const net = network(buildings)

        expect(net.frontOf.size).toBe(2)
        expect(townRoadDistance(net, 'camp', 'saw')).toBeNull()
        expect(townRoadDistance(net, 'saw', 'camp')).toBeNull()
    })

    it('leaves a workshop with no road at its door out of the network', () => {
        const buildings = [
            road(0, 0),
            shop('served', 'lumber', 0),
            // Right on the street but facing away from it.
            at('sideways', 'sawmill', 0, 1, { rotation: 0 }),
            // Out in the fields with no road at all.
            at('lonely', 'sawmill', 9, 9),
            // A legacy fixture with no tile of its own.
            built('placeless', 'sawmill')
        ]
        const net = network(buildings)

        expect(net.frontOf.has('served')).toBe(true)
        expect(net.frontOf.has('sideways')).toBe(false)
        expect(net.frontOf.has('lonely')).toBe(false)
        expect(net.frontOf.has('placeless')).toBe(false)
        expect(townRoadDistance(net, 'served', 'sideways')).toBeNull()
        expect(townRoadDistance(net, 'served', 'lonely')).toBeNull()
    })

    it('keeps houses and roads out of it — only industry delivers', () => {
        const buildings = [...street(0, 2), shop('camp', 'lumber', 0), home('house', 1), shop('park', 'park', 2)]
        const net = network(buildings)

        expect([...net.frontOf.keys()]).toEqual(['camp'])
        expect(townRoadDistance(net, 'camp', 'house')).toBeNull()
        expect(townRoadDistance(net, 'camp', 'park')).toBeNull()
    })
})

describe('townSupply allocation', () => {
    it('cannot stretch one camp across two sawmills', () => {
        // Both sawmills sit inside the full radius, so the only thing that
        // separates them is that the camp runs out.
        const buildings = [
            ...street(0, STREET_END),
            shop('camp', 'lumber', 0),
            shop('near', 'sawmill', 1),
            shop('far', 'sawmill', TOWN_SUPPLY_FULL_TILES)
        ]
        const supply = supplyOf(buildings)
        const near = supply.get('near')!
        const far = supply.get('far')!

        // One level-1 camp is worth less than one sawmill's appetite.
        expect(WOOD_PER_CAMP).toBeLessThan(WOOD_PER_SAWMILL)
        expect(near.ratio).toBe(WOOD_PER_CAMP / WOOD_PER_SAWMILL)
        expect(near.ratio).toBeGreaterThan(far.ratio)
        // Nothing was left by the time the queue reached the far one.
        expect(far.ratio).toBe(TOWN_SUPPLY_MIN_EFFICIENCY)
        expect(far.inputs).toEqual([{ resource: 'wood', ratio: TOWN_SUPPLY_MIN_EFFICIENCY, nearestTiles: null, suppliers: 0 }])
        // A camp has nothing to haul in, so it always runs flat out.
        expect(supply.get('camp')).toEqual({ ratio: 1, inputs: [] })
    })

    it('pairs each camp with its own neighbour instead of splitting down the street', () => {
        // Two self-contained ends of town, further apart than the falloff.
        const east = TOWN_SUPPLY_FALLOFF_TILES + 4
        const buildings = [
            ...street(0, east + 1),
            shop('campWest', 'lumber', 0),
            shop('sawWest', 'sawmill', 1),
            shop('campEast', 'lumber', east),
            shop('sawEast', 'sawmill', east + 1)
        ]
        const supply = supplyOf(buildings)

        for (const id of ['sawWest', 'sawEast']) {
            const entry = supply.get(id)!
            // Each took its neighbour's whole output and nobody's else.
            expect(entry.inputs).toEqual([
                { resource: 'wood', ratio: WOOD_PER_CAMP / WOOD_PER_SAWMILL, nearestTiles: 1, suppliers: 1 }
            ])
        }
        expect(supply.get('sawWest')!.ratio).toBe(supply.get('sawEast')!.ratio)
        // Had they crossed the town for it, the trip would have cost the lot.
        expect(townSupplyEfficiency(east - 1)).toBe(TOWN_SUPPLY_MIN_EFFICIENCY)
    })

    it('feeds more sawmills from a bigger camp', () => {
        // Level 1 is short of even one sawmill; this level covers two.
        const bigLevel = Math.ceil(2 * WOOD_PER_SAWMILL / WOOD_PER_CAMP)
        const sawmills = ['s1', 's2', 's3']
        const layout = (level: number) => [
            ...street(0, STREET_END),
            shop('camp', 'lumber', 0, { level }),
            ...sawmills.map((id, i) => shop(id, 'sawmill', i + 1))
        ]

        const small = supplyOf(layout(1))
        const big = supplyOf(layout(bigLevel))
        const fed = (supply: Map<string, TownSupplyEntry>) =>
            sawmills.filter(id => supply.get(id)!.ratio > TOWN_SUPPLY_MIN_EFFICIENCY).length

        expect(fed(small)).toBe(1)
        expect(fed(big)).toBeGreaterThan(fed(small))
        expect(big.get('s1')!.ratio).toBe(1)
        expect(big.get('s2')!.ratio).toBe(1)
        // Every sawmill is at least as well off, and the queue still runs dry.
        for (const id of sawmills) {
            expect(big.get(id)!.ratio).toBeGreaterThanOrEqual(small.get(id)!.ratio)
        }
        expect(big.get('s3')!.ratio).toBe(TOWN_SUPPLY_MIN_EFFICIENCY)
    })

    it('runs a sawmill flat out when the camps next door match the recipe', () => {
        // A sawmill eats two wood; two level-1 camps, one either side.
        const camps = Math.round(WOOD_PER_SAWMILL / WOOD_PER_CAMP)
        expect(camps).toBe(2)
        const buildings = [
            ...street(0, 2),
            shop('campWest', 'lumber', 0),
            shop('saw', 'sawmill', 1),
            shop('campEast', 'lumber', 2)
        ]

        expect(supplyOf(buildings).get('saw')).toEqual({
            ratio: 1,
            inputs: [{ resource: 'wood', ratio: 1, nearestTiles: 1, suppliers: camps }]
        })
    })

    it('ignores a camp that no road connects it to', () => {
        // The same two camps, but on a street of their own.
        const buildings = [
            ...street(0, 2),
            shop('saw', 'sawmill', 1),
            ...street(20, 22),
            shop('campWest', 'lumber', 20),
            shop('campEast', 'lumber', 22)
        ]

        expect(supplyOf(buildings).get('saw')!.ratio).toBe(TOWN_SUPPLY_MIN_EFFICIENCY)
    })
})

describe('townSupply and distance', () => {
    /** Two camps that between them match the sawmill's recipe, `tiles` away. */
    function hauledFrom(tiles: number): TownSupplyEntry {
        const buildings = [
            ...street(0, STREET_END),
            shop('saw', 'sawmill', 0),
            shop('campNear', 'lumber', tiles),
            shop('campFar', 'lumber', tiles + 1)
        ]
        return supplyOf(buildings).get('saw')!
    }

    it('scores the same recipe lower once the camps are down the street', () => {
        const nextDoor = hauledFrom(1)
        const downTheStreet = hauledFrom(HALFWAY_TILES)

        expect(nextDoor.ratio).toBe(1)
        expect(downTheStreet.ratio).toBeLessThan(nextDoor.ratio)
        expect(downTheStreet.ratio).toBeGreaterThan(TOWN_SUPPLY_MIN_EFFICIENCY)
        // Both camps delivered in full; only the trip cost anything.
        expect(downTheStreet.inputs[0]!.suppliers).toBe(2)
        expect(downTheStreet.inputs[0]!.nearestTiles).toBe(HALFWAY_TILES)
        expect(downTheStreet.ratio).toBeCloseTo(
            (townSupplyEfficiency(HALFWAY_TILES) + townSupplyEfficiency(HALFWAY_TILES + 1)) / 2,
            10
        )
    })

    it('charges nothing at all up to the full radius, and from the next tile on', () => {
        // Both camps inside the free radius: nothing is lost on the way.
        expect(hauledFrom(TOWN_SUPPLY_FULL_TILES - 1).ratio).toBe(1)
        // Nudge the far one past it and the ratio starts slipping.
        const slipping = hauledFrom(TOWN_SUPPLY_FULL_TILES)
        expect(slipping.ratio).toBeLessThan(1)
        expect(slipping.ratio).toBeGreaterThan(TOWN_SUPPLY_MIN_EFFICIENCY)
    })

    it('never falls further than the floor however long the haul', () => {
        const stranded = hauledFrom(TOWN_SUPPLY_FALLOFF_TILES + 1)
        expect(stranded.ratio).toBe(TOWN_SUPPLY_MIN_EFFICIENCY)
        expect(stranded.inputs[0]!.suppliers).toBe(2)
    })
})

describe('townSupply floor', () => {
    it('keeps a workshop with no supplier at all running at exactly the minimum', () => {
        // Goods bought from another mayor have no local camp behind them, and
        // buying is still meant to be worth doing.
        const buildings = [...street(0, 2), shop('saw', 'sawmill', 1)]

        expect(ratioOf(buildings, 'saw')).toBe(TOWN_SUPPLY_MIN_EFFICIENCY)
    })

    it('lets a bought-in town still turn stock into goods', () => {
        // A big sawmill with no camp anywhere, a warehouse full of purchased
        // wood, and nothing but the floor rate to run on: it still bakes.
        const level = 20
        const buildings = [
            ...street(0, ESTATE_X + 2),
            ...estate(SAWMILL.workers * level),
            shop('saw', 'sawmill', 0, { level, createdAt: T0 - 900 })
        ]
        const derived = deriveTown(buildings, 50, T0)

        expect(derived.staffing.get('saw')).toBe(1)
        expect(derived.supply.get('saw')!.ratio).toBe(TOWN_SUPPLY_MIN_EFFICIENCY)

        const result = settleTown(sim({ inventory: { wood: 5_000 }, buildings }), T0 + 3 * TOWN_TICK_MS)
        expect(result.ticks).toBeGreaterThan(0)
        expect(result.delta.planks!).toBeGreaterThan(0)
        expect(result.delta.wood!).toBeLessThan(0)
    })

    it('gives a workshop with nothing to haul, or no place on the map, a full ratio', () => {
        // A camp consumes nothing, so distance can never slow it down.
        const street1 = [...street(0, 1), shop('camp', 'lumber', 0), shop('saw', 'sawmill', 1)]
        expect(supplyOf(street1).get('camp')).toEqual({ ratio: 1, inputs: [] })

        // And a fixture with no world coordinates has no journey to make.
        const placeless = [built('camp', 'lumber'), built('saw', 'sawmill')]
        expect(supplyOf(placeless).get('saw')).toEqual({ ratio: 1, inputs: [] })
    })
})

describe('townSupply along a chain', () => {
    // Farm → mill → bakery, with a lumber camp for the bakery's kindling.
    // A level-2 mill grinds two flour, which is exactly one bakery's appetite;
    // to do that it wants four wheat, which is a level-4 farm.
    const millLevel = 2
    const fedFarmLevel = MILL.inputs.wheat! * millLevel

    function chain(farmLevel: number): TownSimBuilding[] {
        return [
            ...street(0, 3),
            shop('farm', 'farm', 0, { level: farmLevel }),
            shop('mill', 'mill', 1, { level: millLevel }),
            shop('bakery', 'bakery', 2),
            shop('camp', 'lumber', 3)
        ]
    }

    it('runs the whole chain at full pace when every link is fed', () => {
        expect(MILL.outputs.flour! * millLevel).toBe(BAKERY.inputs.flour!)
        expect(FARM.outputs.wheat! * fedFarmLevel).toBe(MILL.inputs.wheat! * millLevel)

        const supply = supplyOf(chain(fedFarmLevel))
        expect(supply.get('farm')!.ratio).toBe(1)
        expect(supply.get('mill')!.ratio).toBe(1)
        expect(supply.get('bakery')!.ratio).toBe(1)
    })

    it('holds the bakery to the mill\'s own ratio when the mill is starved', () => {
        // Half the wheat the mill wants, so the mill runs at half — and it can
        // only pass on the flour it actually manages to grind.
        const starved = supplyOf(chain(fedFarmLevel / 2))
        const mill = starved.get('mill')!
        const bakery = starved.get('bakery')!

        expect(mill.ratio).toBe(0.5)
        expect(bakery.ratio).toBeLessThanOrEqual(mill.ratio)
        expect(bakery.ratio).toBe(mill.ratio)

        // The bakery's wood is fine; it is the flour that holds it back, and a
        // workshop runs at the pace of its worst-served input.
        const wood = bakery.inputs.find(i => i.resource === 'wood')!
        const flour = bakery.inputs.find(i => i.resource === 'flour')!
        expect(wood.ratio).toBe(1)
        expect(flour.ratio).toBe(mill.ratio)
        expect(bakery.ratio).toBe(Math.min(wood.ratio, flour.ratio))
    })

    it('resolves the same whatever order the buildings arrive in', () => {
        // Depth ordering, not array order, is what decides who is settled
        // before whom — so reversing the town changes nothing.
        const forwards = supplyOf(chain(fedFarmLevel / 2))
        const backwards = supplyOf([...chain(fedFarmLevel / 2)].reverse())

        for (const id of ['farm', 'mill', 'bakery', 'camp']) {
            expect(backwards.get(id)!.ratio).toBe(forwards.get(id)!.ratio)
        }
    })
})

describe('supply through deriveTown and settleTown', () => {
    const level = 3
    const jobs = LUMBER.workers * level * 2 + SAWMILL.workers * level

    /** Two camps and a sawmill, either shoulder to shoulder or strung out. */
    function town(spread: boolean): TownSimBuilding[] {
        const saw = spread ? 0 : 1
        const camps = spread ? [HALFWAY_TILES, HALFWAY_TILES + 1] : [0, 2]
        return [
            ...street(0, ESTATE_X + 2),
            ...estate(jobs),
            shop('saw', 'sawmill', saw, { level, createdAt: T0 - 900 }),
            shop('campA', 'lumber', camps[0]!, { level, createdAt: T0 - 1000 }),
            shop('campB', 'lumber', camps[1]!, { level, createdAt: T0 - 800 })
        ]
    }

    it('runs every workshop at staffing times supply times its ground', () => {
        for (const spread of [false, true]) {
            const buildings = town(spread)
            const derived = deriveTown(buildings, 50, T0)

            // Everything standing is staffed from the same pool of residents —
            // a warehouse queues alongside a sawmill — but only workshops turn
            // that into throughput.
            expect(derived.throughput.size).toBeLessThanOrEqual(derived.staffing.size)
            for (const [id, ratio] of derived.throughput) {
                const b = buildings.find(x => x.id === id)!
                const staff = derived.staffing.get(id)!
                expect(ratio).toBe(staff * (derived.supply.get(id)?.ratio ?? 1) * townTerrainMultiplier(b.type, b.wx, b.wy))
            }
        }
    })

    it('slows the sawmill down, and only the sawmill, when the camps are far off', () => {
        const together = deriveTown(town(false), 50, T0)
        const spread = deriveTown(town(true), 50, T0)

        // Identical buildings, identical jobs, identical staffing.
        expect(spread.popCap).toBe(together.popCap)
        expect(spread.workersDemanded).toBe(jobs)
        for (const id of ['saw', 'campA', 'campB']) {
            expect(spread.staffing.get(id)).toBe(1)
            expect(together.staffing.get(id)).toBe(1)
        }

        // Camps haul nothing in, so they are unaffected either way.
        expect(together.throughput.get('campA')).toBe(1)
        expect(spread.throughput.get('campA')).toBe(1)

        expect(together.throughput.get('saw')).toBe(1)
        expect(spread.throughput.get('saw')).toBeLessThan(1)
        expect(spread.throughput.get('saw')).toBeGreaterThan(TOWN_SUPPLY_MIN_EFFICIENCY)
    })

    it('produces measurably less over a settle when the town is strung out', () => {
        const window = T0 + 20 * TOWN_TICK_MS
        const together = settleTown(sim({ buildings: town(false) }), window)
        const spread = settleTown(sim({ buildings: town(true) }), window)

        // Same happiness, so the same number of ticks: the only difference in
        // the ledger is how much of the camps' wood reached the sawmill.
        expect(spread.ticks).toBe(together.ticks)
        expect(spread.happiness).toBe(together.happiness)

        expect(together.delta.planks!).toBeGreaterThan(0)
        expect(spread.delta.planks!).toBeGreaterThan(0)
        expect(spread.delta.planks!).toBeLessThan(together.delta.planks!)
        // The wood the sawmill could not take just piles up instead.
        expect(spread.delta.wood!).toBeGreaterThan(together.delta.wood!)
    })
})
