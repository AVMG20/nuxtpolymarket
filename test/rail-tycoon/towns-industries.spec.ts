import { describe, expect, it } from 'vitest'
import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { acceptDelivery, industryTick, rtIndustryTiles } from '#shared/utils/rail-tycoon/industries'
import { RT_DIRS, RT_ROAD_DIR_BIT, RtMap, RtTileKind } from '#shared/utils/rail-tycoon/map'
import { SeededRandom } from '#shared/utils/random'
import { RtAxis, RtStationTile, rtFacilityOf, rtNewStationCargo, rtStationPayload } from '#shared/utils/rail-tycoon/stations-build'
import { rtPacketTotal } from '#shared/utils/rail-tycoon/stations'
import { rtCountActiveStations, rtTownGrowthRate, rtTownMonthly, townTick } from '#shared/utils/rail-tycoon/towns'
import { RT_NONE, RT_OWNER_NONE, type RtIndustry, type RtStation, type RtTown } from '#shared/utils/rail-tycoon/types'
import { RtWorld } from '#shared/utils/rail-tycoon/world'

const SIDE = 64
const PAX = RT_CATALOG.cargos.passengers.index
const COAL = RT_CATALOG.cargos.coal.index
const WOOD = RT_CATALOG.cargos.wood.index
const GOODS = RT_CATALOG.cargos.goods.index
const MONTH_TICKS = 30 * RT_CATALOG.time.dayTicks

const zeros = () => RT_CARGO_IDS.map(() => 0)

function newTown(centre: number): RtTown {
    return {
        id: 0,
        name: 'Town',
        centre,
        houseCount: 0,
        population: 0,
        growthCounter: 10,
        growthRate: 160,
        growing: false,
        activeStations: 0,
        receivedThisMonth: zeros(),
        receivedLastMonth: zeros()
    }
}

function newIndustry(id: number, type: number, origin: number): RtIndustry {
    return { id, type, origin, waiting: zeros(), delivered: zeros(), producedThisMonth: zeros(), transportedThisMonth: zeros() }
}

function newWorld(map: RtMap, towns: RtTown[], industries: RtIndustry[] = [], seed = 1): RtWorld {
    const world = new RtWorld({
        settings: { side: SIDE, maxCompanies: 2, sharing: true },
        map,
        rngState: seed,
        tick: 0,
        date: { day: 1, month: 0, year: 1950 },
        pathfinderCursor: 0,
        companies: [],
        towns,
        industries,
        stations: [],
        vehicles: []
    })
    world.addCompany('A')
    return world
}

function placeStation(world: RtWorld, id: number, tile: number, type: RtStationTile): RtStation {
    const station: RtStation = {
        id,
        owner: 0,
        name: `S${id}`,
        town: RT_NONE,
        sign: tile,
        tiles: [tile],
        tilesRevision: 1,
        facilities: rtFacilityOf(type),
        cargo: RT_CARGO_IDS.map(() => rtNewStationCargo()),
        acceptance: 0,
        lastPickupTick: RT_NONE,
        lastDeliveryTick: RT_NONE,
        lastVehicleKind: RT_NONE,
        catchment: null,
        catchmentRevision: RT_NONE
    }
    world.map.setTile(tile, RtTileKind.station, 0, rtStationPayload(id, type, RtAxis.x))
    world.insertStation(station)
    return station
}

/**
 * A town on a flat map with a short road cross and four houses, with a few sloped tiles beside the
 * roads so growth has to skip them.
 */
function townWorld(seed = 1): { world: RtWorld, town: RtTown, slopes: number[], startHouses: Set<number> } {
    const map = new RtMap(SIDE)
    const cx = 32
    const cy = 32
    const centre = map.idx(cx, cy)
    for (const dir of RT_DIRS) {
        const dx = [-1, 0, 1, 0][dir]!
        const dy = [0, 1, 0, -1][dir]!
        for (let k = 1; k <= 2; k++) {
            const bits = RT_ROAD_DIR_BIT[(dir + 2) & 3]! | (k < 2 ? RT_ROAD_DIR_BIT[dir]! : 0)
            map.setTile(map.idx(cx + dx * k, cy + dy * k), RtTileKind.road, RT_OWNER_NONE, bits)
        }
    }
    map.setTile(centre, RtTileKind.road, RT_OWNER_NONE, 15)
    const startHouses = new Set<number>()
    for (const [x, y] of [[31, 31], [33, 33], [31, 33], [33, 31]] as const) {
        map.setTile(map.idx(x, y), RtTileKind.house, RT_OWNER_NONE, 1)
        startHouses.add(map.idx(x, y))
    }
    // raise the corner shared by a few tiles beside the road ends: they become sloped
    map.setCornerHeight(36, 31, 1)
    map.setCornerHeight(28, 34, 1)
    const slopes: number[] = []
    for (let i = 0; i < map.tileCount; i++) if (!map.isFlat(i)) slopes.push(i)
    const town = newTown(centre)
    town.houseCount = 4
    town.population = 4 * RT_CATALOG.houses.classes[1]!.population
    const world = newWorld(map, [town], [], seed)
    return { world, town, slopes, startHouses }
}

/** Ticks a world's towns and calls the monthly update every MONTH_TICKS, as RtWorld.step does. */
function runTowns(world: RtWorld, ticks: number, eachTick?: (tick: number) => void): void {
    for (let k = 0; k < ticks; k++) {
        world.tick++
        eachTick?.(world.tick)
        for (const town of world.towns) if (town) townTick(world, town, world.rng, world.tick)
        if (world.tick % MONTH_TICKS === 0) for (const town of world.towns) if (town) rtTownMonthly(world, town, world.rng, world.tick)
    }
}

function builtTiles(world: RtWorld): number {
    let n = 0
    for (let i = 0; i < world.map.tileCount; i++) {
        const kind = world.map.kind[i]
        if (kind === RtTileKind.house || kind === RtTileKind.road) n++
    }
    return n
}

describe('rail tycoon towns and industries', () => {
    describe('towns', () => {
        it('a town with three active stations grows faster over 20000 ticks than an unserved twin', () => {
            const served = townWorld(7)
            const unserved = townWorld(7)
            // inside the town edge radius (squared distance 8 from the centre)
            const stations = [placeStation(served.world, 0, served.world.map.idx(30, 30), RtStationTile.rail),
                placeStation(served.world, 1, served.world.map.idx(34, 34), RtStationTile.bus),
                placeStation(served.world, 2, served.world.map.idx(30, 34), RtStationTile.truck)]
            const before = builtTiles(served.world)
            runTowns(served.world, 20000, (tick) => {
                for (const s of stations) s.lastPickupTick = tick
            })
            runTowns(unserved.world, 20000)
            expect(served.town.activeStations).toBe(3)
            expect(rtCountActiveStations(served.world, served.town, served.world.tick)).toBe(3)
            expect(unserved.town.activeStations).toBe(0)
            expect(builtTiles(served.world) - before).toBeGreaterThan(builtTiles(unserved.world) - before)
            expect(served.town.growthRate).toBe(rtTownGrowthRate(3, served.town.houseCount))
        })

        it('builds houses only beside roads on flat land, counting houses and population', () => {
            const { world, town, slopes, startHouses } = townWorld(3)
            town.growing = true
            town.growthRate = 0
            town.growthCounter = 0
            for (let k = 0; k < 70 * 400; k++) {
                world.tick++
                townTick(world, town, world.rng, world.tick)
            }
            const map = world.map
            const houses: number[] = []
            let population = 0
            for (let i = 0; i < map.tileCount; i++) {
                if (map.kind[i] !== RtTileKind.house) continue
                houses.push(i)
                population += RT_CATALOG.houses.classes[map.payload[i]! & 3]!.population
            }
            expect(houses.length).toBeGreaterThan(startHouses.size + 5)
            expect(town.houseCount).toBe(houses.length)
            expect(town.population).toBe(population)
            for (const house of houses) {
                if (startHouses.has(house)) continue
                expect(map.isFlat(house)).toBe(true)
                expect(slopes).not.toContain(house)
                const besideRoad = RT_DIRS.some((dir) => {
                    const n = map.neighbour(house, dir)
                    return n >= 0 && map.kind[n] === RtTileKind.road
                })
                expect(besideRoad).toBe(true)
            }
        })

        it('houses produce passengers for a station that tried to load them', () => {
            const { world, town } = townWorld(5)
            const station = placeStation(world, 0, world.map.idx(34, 34), RtStationTile.bus)
            station.cargo[PAX]!.loadAttempted = true
            runTowns(world, 4096)
            expect(rtPacketTotal(station.cargo[PAX]!.packets)).toBeGreaterThan(0)
            expect(town.receivedLastMonth).toEqual(zeros())
        })

        it('is deterministic under a fixed seed', () => {
            const run = () => {
                const { world, town } = townWorld(11)
                const station = placeStation(world, 0, world.map.idx(35, 33), RtStationTile.rail)
                station.cargo[PAX]!.loadAttempted = true
                runTowns(world, 30000, (tick) => {
                    station.lastPickupTick = tick
                })
                return { town: { ...town }, map: Array.from(world.map.kind), payload: Array.from(world.map.payload), station: station.cargo, rng: world.rng.state }
            }
            expect(run()).toEqual(run())
        })
    })

    describe('industries', () => {
        function industryWorld(type: number, stationTile: (map: RtMap) => number, cargo: number) {
            const map = new RtMap(SIDE)
            const origin = map.idx(20, 20)
            const industry = newIndustry(0, type, origin)
            const world = newWorld(map, [], [industry])
            for (const tile of rtIndustryTiles(map, industry)) map.setTile(tile, RtTileKind.industry, RT_OWNER_NONE, 0)
            const station = placeStation(world, 0, stationTile(map), RtStationTile.truck)
            station.cargo[cargo]!.loadAttempted = true
            return { world, industry, station }
        }

        function runIndustries(world: RtWorld, ticks: number): void {
            for (let k = 0; k < ticks; k++) {
                world.tick++
                for (const industry of world.industries) if (industry) industryTick(world, industry, world.rng, world.tick)
            }
        }

        it('a coal mine with an eligible station produces coal every cycle', () => {
            const { world, industry, station } = industryWorld(0, map => map.idx(24, 20), COAL)
            const rate = RT_CATALOG.industries.coalMine.produces[0]!.rate
            const cycle = RT_CATALOG.time.industryCycleTicks
            let previous = 0
            for (let k = 1; k <= 6; k++) {
                runIndustries(world, cycle)
                expect(industry.producedThisMonth[COAL]).toBe(rate * k)
                expect(industry.waiting[COAL]).toBe(0)
                const waiting = rtPacketTotal(station.cargo[COAL]!.packets)
                expect(waiting).toBe(industry.transportedThisMonth[COAL])
                expect(waiting).toBe((rate * k * (RT_CATALOG.stationRating.start + 1)) >> 8)
                expect(waiting).toBeGreaterThan(previous)
                previous = waiting
            }
        })

        it('a coal mine without a station produces but transports nothing', () => {
            const { world, industry, station } = industryWorld(0, map => map.idx(50, 50), COAL)
            runIndustries(world, RT_CATALOG.time.industryCycleTicks * 3)
            expect(industry.producedThisMonth[COAL]).toBe(45)
            expect(industry.transportedThisMonth[COAL]).toBe(0)
            expect(station.cargo[COAL]!.packets).toEqual([])
        })

        it('a sawmill that received wood produces goods the next cycle', () => {
            const { world, industry, station } = industryWorld(3, map => map.idx(23, 21), GOODS)
            const cycle = RT_CATALOG.time.industryCycleTicks
            runIndustries(world, cycle)
            expect(industry.producedThisMonth[GOODS]).toBe(0)
            expect(acceptDelivery(industry, WOOD, 40)).toBe(40)
            expect(industry.delivered[WOOD]).toBe(40)
            expect(acceptDelivery(industry, COAL, 40)).toBe(0)
            runIndustries(world, cycle - 1)
            expect(industry.producedThisMonth[GOODS]).toBe(0)
            runIndustries(world, 1)
            expect(industry.delivered[WOOD]).toBe(0)
            expect(industry.producedThisMonth[GOODS]).toBe(40)
            expect(rtPacketTotal(station.cargo[GOODS]!.packets)).toBe((40 * (RT_CATALOG.stationRating.start + 1)) >> 8)
        })

        it('a power station accepts coal and produces nothing', () => {
            const { world, industry } = industryWorld(1, map => map.idx(25, 20), COAL)
            expect(acceptDelivery(industry, COAL, 30)).toBe(30)
            expect(acceptDelivery(industry, WOOD, 30)).toBe(0)
            runIndustries(world, RT_CATALOG.time.industryCycleTicks * 2)
            expect(industry.producedThisMonth).toEqual(zeros())
            expect(industry.waiting).toEqual(zeros())
            expect(industry.delivered).toEqual(zeros())
        })

        it('is deterministic under a fixed seed', () => {
            const run = () => {
                const { world, industry, station } = industryWorld(3, map => map.idx(23, 21), GOODS)
                for (let k = 0; k < 20; k++) {
                    acceptDelivery(industry, WOOD, 7 + k)
                    runIndustries(world, 200)
                }
                return { industry: { ...industry }, packets: station.cargo, rng: new SeededRandom(world.rng.state).next() }
            }
            expect(run()).toEqual(run())
        })
    })
})
