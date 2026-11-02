import { describe, expect, it } from 'vitest'
import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { agePackets, distributeProduction, rtAppendPacket, rtCapPackets } from '#shared/utils/rail-tycoon/cargo'
import { RT_ROAD_DIR_BIT, RtMap, RtTileKind } from '#shared/utils/rail-tycoon/map'
import { SeededRandom } from '#shared/utils/random'
import { decodeWorld, encodeWorld } from '#shared/utils/rail-tycoon/save'
import { RtAxis, RtStationTile, buildRoadStop, rtFacilityOf, rtNewStationCargo, rtStationPayload } from '#shared/utils/rail-tycoon/stations-build'
import {
    RT_ACCEPT_THRESHOLD,
    accepts,
    computeCatchment,
    rtAcceptanceAround,
    rtAcceptanceDue,
    rtPacketTotal,
    rtRatingTarget,
    stationCatchment,
    stationTilesChanged,
    stationsAround,
    stationsTick,
    updateAcceptance,
    updateStationRatings
} from '#shared/utils/rail-tycoon/stations'
import { townTick } from '#shared/utils/rail-tycoon/towns'
import { RT_NONE, RT_OWNER_NONE, type RtCargoPacket, type RtIndustry, type RtStation, type RtTown } from '#shared/utils/rail-tycoon/types'
import { RtWorld } from '#shared/utils/rail-tycoon/world'

const SIDE = 64
const PAX = RT_CATALOG.cargos.passengers.index
const MAIL = RT_CATALOG.cargos.mail.index
const COAL = RT_CATALOG.cargos.coal.index
const GOODS = RT_CATALOG.cargos.goods.index

const zeros = () => RT_CARGO_IDS.map(() => 0)

function newTown(id: number, centre: number, houses = 0): RtTown {
    return {
        id,
        name: `Town ${id}`,
        centre,
        houseCount: houses,
        population: 0,
        growthCounter: 0,
        growthRate: 0,
        growing: false,
        activeStations: 0,
        receivedThisMonth: zeros(),
        receivedLastMonth: zeros()
    }
}

function newWorld(towns: RtTown[] = [], industries: RtIndustry[] = [], map = new RtMap(SIDE)): RtWorld {
    const world = new RtWorld({
        settings: { side: SIDE, maxCompanies: 4, sharing: true },
        map,
        rngState: 1,
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
    world.addCompany('B')
    return world
}

/** A station placed by hand: each tile is set on the map with the given type, the station listed under its id. */
function placeStation(world: RtWorld, id: number, owner: number, tiles: number[], type: RtStationTile): RtStation {
    const station: RtStation = {
        id,
        owner,
        name: `S${id}`,
        town: RT_NONE,
        sign: tiles[0]!,
        tiles: [...tiles].sort((a, b) => a - b),
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
    for (const tile of tiles) world.map.setTile(tile, RtTileKind.station, owner, rtStationPayload(id, type, RtAxis.x, RT_OWNER_NONE))
    world.insertStation(station)
    return station
}

function addHouse(map: RtMap, tile: number, size = 1): void {
    map.setTile(tile, RtTileKind.house, RT_OWNER_NONE, size)
}

function powerStation(map: RtMap, id: number, x: number, y: number): RtIndustry {
    for (let ty = y; ty < y + 2; ty++) for (let tx = x; tx < x + 4; tx++) map.setTile(map.idx(tx, ty), RtTileKind.industry, RT_OWNER_NONE, id)
    return { id, type: 1, origin: map.idx(x, y), waiting: zeros(), delivered: zeros(), producedThisMonth: zeros(), transportedThisMonth: zeros() }
}

function packet(cargo: number, count: number, sourceTile: number, transit = 0): RtCargoPacket {
    return { cargo, count, sourceTile, sourceStation: 0, transitPeriods: transit, feederShare: 0 }
}

/** Every saved number of the world's stations, for comparing two worlds. */
function stationState(world: RtWorld): unknown {
    return world.stationList().map(s => ({ ...s, catchment: null, catchmentRevision: 0 }))
}

/** The test's stand-in for RtWorld.step: towns, then stations, each tick. */
function advance(world: RtWorld, ticks: number): void {
    for (let k = 0; k < ticks; k++) {
        world.tick++
        for (const town of world.towns) if (town) townTick(world, town, world.rng, world.tick)
        stationsTick(world, world.rng, world.tick)
    }
}

describe('rail tycoon stations and cargo', () => {
    describe('catchment', () => {
        it('covers a square of radius 4 around a platform and 3 around a road stop, clipped to the map', () => {
            const world = newWorld()
            const map = world.map
            const rail = placeStation(world, 0, 0, [map.idx(20, 20)], RtStationTile.rail)
            const stop = placeStation(world, 1, 0, [map.idx(40, 40)], RtStationTile.bus)
            const edge = placeStation(world, 2, 0, [map.idx(0, 0)], RtStationTile.rail)
            expect(computeCatchment(map, rail)).toHaveLength(81)
            expect(computeCatchment(map, stop)).toHaveLength(49)
            expect(computeCatchment(map, edge)).toHaveLength(25)
            const tiles = computeCatchment(map, rail)
            expect(tiles).toEqual([...tiles].sort((a, b) => a - b))
            expect(tiles).toContain(map.idx(16, 16))
            expect(tiles).not.toContain(map.idx(15, 20))
        })

        it('is the union of each tile\'s own square', () => {
            const world = newWorld()
            const map = world.map
            const station = placeStation(world, 0, 0, [map.idx(20, 20), map.idx(21, 20)], RtStationTile.rail)
            expect(computeCatchment(map, station)).toHaveLength(9 * 10)
        })

        it('lists the stations covering a tile in ascending id and follows tile changes', () => {
            const world = newWorld()
            const map = world.map
            const b = placeStation(world, 1, 1, [map.idx(22, 20)], RtStationTile.truck)
            const a = placeStation(world, 0, 0, [map.idx(20, 20)], RtStationTile.rail)
            expect(stationsAround(world, map.idx(21, 21)).map(s => s.id)).toEqual([0, 1])
            expect(stationsAround(world, map.idx(26, 20)).map(s => s.id)).toEqual([])
            expect(a.catchmentRevision).toBe(a.tilesRevision)
            // station 0 grows east: the index follows its new revision without being told
            a.tiles.push(map.idx(27, 20))
            map.setTile(map.idx(27, 20), RtTileKind.station, 0, rtStationPayload(0, RtStationTile.rail, RtAxis.x))
            a.tilesRevision++
            expect(stationsAround(world, map.idx(26, 20)).map(s => s.id)).toEqual([0])
            expect(stationsAround(world, map.idx(25, 20)).map(s => s.id)).toEqual([0, 1])
            world.removeStation(1)
            expect(stationsAround(world, map.idx(24, 20)).map(s => s.id)).toEqual([0])
            expect(b.id).toBe(1)
        })
    })

    describe('acceptance', () => {
        it('a bus stop in a town centre accepts passengers', () => {
            const map = new RtMap(SIDE)
            const centre = map.idx(30, 30)
            map.setTile(centre, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_DIR_BIT[0]! | RT_ROAD_DIR_BIT[2]!)
            for (const [x, y] of [[30, 29], [30, 31], [31, 29], [29, 31]] as const) addHouse(map, map.idx(x, y), 2)
            const world = newWorld([newTown(0, centre, 4)], [], map)
            const stations: RtStation[] = []
            const built = buildRoadStop(map, stations, world.townList(), 0, centre, RtStationTile.bus, true)
            expect(built.ok).toBe(true)
            world.insertStation(stations[0]!)
            const stop = world.station(0)!
            updateAcceptance(world, stop)
            expect(accepts(stop, PAX)).toBe(true)
            // four large houses give 4 x 3 = 12 eighths of mail, but a bus stop alone never handles mail
            expect(rtAcceptanceAround(world, stationCatchment(map, stop))[MAIL]).toBeGreaterThanOrEqual(RT_ACCEPT_THRESHOLD)
            expect(accepts(stop, MAIL)).toBe(false)
            expect(accepts(stop, COAL)).toBe(false)
        })

        it('a truck stop at a power station accepts coal, a bus stop there does not', () => {
            const map = new RtMap(SIDE)
            const plant = powerStation(map, 0, 10, 10)
            const world = newWorld([], [plant], map)
            const truck = placeStation(world, 0, 0, [map.idx(15, 10)], RtStationTile.truck)
            const bus = placeStation(world, 1, 0, [map.idx(10, 13)], RtStationTile.bus)
            updateAcceptance(world, truck)
            updateAcceptance(world, bus)
            expect(accepts(truck, COAL)).toBe(true)
            expect(accepts(truck, GOODS)).toBe(false)
            expect(accepts(bus, COAL)).toBe(false)
        })

        it('adding a station tile updates acceptance at once', () => {
            const map = new RtMap(SIDE)
            for (let y = 38; y < 42; y++) addHouse(map, map.idx(35, y), 1)
            const world = newWorld([], [], map)
            const station = placeStation(world, 0, 0, [map.idx(30, 40)], RtStationTile.rail)
            stationTilesChanged(world, station)
            expect(accepts(station, PAX)).toBe(false)
            const tile = map.idx(31, 40)
            map.setTile(tile, RtTileKind.station, 0, rtStationPayload(0, RtStationTile.rail, RtAxis.x))
            station.tiles.push(tile)
            station.tilesRevision++
            stationTilesChanged(world, station)
            expect(accepts(station, PAX)).toBe(true)
            // goods: 4 medium houses give 16 eighths
            expect(accepts(station, GOODS)).toBe(true)
        })
    })

    describe('ratings', () => {
        it('climbs toward the target by at most the step per cycle with a fast new vehicle picking up every cycle', () => {
            const world = newWorld()
            const station = placeStation(world, 0, 0, [world.map.idx(10, 10)], RtStationTile.rail)
            const goods = station.cargo[PAX]!
            goods.hasRating = true
            goods.lastSpeed = 112
            goods.lastAge = 0
            const target = rtRatingTarget(112, 1, 0, 0)
            expect(target).toBe(209)
            const rng = new SeededRandom(1)
            let previous = goods.rating
            for (let cycle = 0; cycle < 40; cycle++) {
                goods.cyclesSincePickup = 0
                updateStationRatings(station, cycle * 185, rng)
                expect(goods.rating - previous).toBeLessThanOrEqual(RT_CATALOG.stationRating.stepLimit)
                expect(goods.rating).toBeGreaterThanOrEqual(previous)
                previous = goods.rating
            }
            expect(goods.rating).toBe(target)
        })

        it('falls without pickups, and an unserved pile above the cap shrinks', () => {
            const world = newWorld()
            const station = placeStation(world, 0, 0, [world.map.idx(10, 10)], RtStationTile.rail)
            const goods = station.cargo[COAL]!
            goods.hasRating = true
            goods.cyclesSincePickup = 100
            goods.packets.push(packet(COAL, 6000, 5), packet(COAL, 4000, 6))
            const rng = new SeededRandom(1)
            updateStationRatings(station, 0, rng)
            expect(goods.rating).toBe(RT_CATALOG.stationRating.start - 2)
            const left = rtPacketTotal(goods.packets)
            expect(left).toBeLessThan(10000)
            expect(left).toBeGreaterThanOrEqual(10000 - Math.floor((10000 - 4096) / 64) - 4)
        })

        it('drops the rating and the pile after abandonCycles without a pickup', () => {
            const world = newWorld()
            const station = placeStation(world, 0, 0, [world.map.idx(10, 10)], RtStationTile.rail)
            const goods = station.cargo[PAX]!
            goods.hasRating = true
            goods.cyclesSincePickup = RT_CATALOG.stationRating.abandonCycles - 1
            goods.packets.push(packet(PAX, 50, 5))
            updateStationRatings(station, 0, new SeededRandom(1))
            expect(goods.hasRating).toBe(false)
            expect(goods.packets).toEqual([])
        })

        it('a cargo without a rating creeps back to the start rating', () => {
            const world = newWorld()
            const station = placeStation(world, 0, 0, [world.map.idx(10, 10)], RtStationTile.rail)
            station.cargo[PAX]!.rating = 100
            updateStationRatings(station, 0, new SeededRandom(1))
            expect(station.cargo[PAX]!.rating).toBe(101)
        })
    })

    describe('production split', () => {
        function twoStations(owners: [number, number]) {
            const map = new RtMap(SIDE)
            const house = map.idx(30, 30)
            addHouse(map, house)
            const world = newWorld([], [], map)
            const high = placeStation(world, 0, owners[0], [map.idx(28, 30)], RtStationTile.rail)
            const low = placeStation(world, 1, owners[1], [map.idx(32, 30)], RtStationTile.rail)
            for (const [s, r] of [[high, 200], [low, 100]] as const) {
                s.cargo[PAX]!.rating = r
                s.cargo[PAX]!.loadAttempted = true
            }
            return { world, house, high, low }
        }

        it('gives the higher-rated station the larger share and matches the formula', () => {
            for (const owners of [[0, 0], [0, 1]] as [number, number][]) {
                const { world, house, high, low } = twoStations(owners)
                const moved = distributeProduction(world, [house], PAX, 100)
                const h = rtPacketTotal(high.cargo[PAX]!.packets)
                const l = rtPacketTotal(low.cargo[PAX]!.packets)
                expect(h).toBeGreaterThan(l)
                expect(h + l).toBe(moved)
                // 100 * 201 split 2:1 is 13400 and 6700 in 1/256 units
                expect([h, l]).toEqual([13400 >> 8, 6700 >> 8])
                expect(high.cargo[PAX]!.fraction).toBe(13400 & 255)
                expect(low.cargo[PAX]!.fraction).toBe(6700 & 255)
                expect(high.cargo[PAX]!.hasRating).toBe(true)
                expect(high.cargo[PAX]!.packets[0]).toMatchObject({ sourceTile: house, sourceStation: 0, transitPeriods: 0 })
            }
        })

        it('one station gets amount * (rating + 1) / 256, carrying the fraction', () => {
            const { world, house, high, low } = twoStations([0, 0])
            low.cargo[PAX]!.loadAttempted = false
            expect(distributeProduction(world, [house], PAX, 3)).toBe((3 * 201) >> 8)
            expect(high.cargo[PAX]!.fraction).toBe((3 * 201) & 255)
            expect(distributeProduction(world, [house], PAX, 3)).toBe(((3 * 201 * 2) >> 8) - ((3 * 201) >> 8))
        })

        it('no station receives anything before a load attempt, nor a station that does not handle the cargo', () => {
            const { world, house, high, low } = twoStations([0, 0])
            high.cargo[PAX]!.loadAttempted = false
            low.cargo[PAX]!.loadAttempted = false
            expect(distributeProduction(world, [house], PAX, 100)).toBe(0)
            expect(high.cargo[PAX]!.packets).toEqual([])
            const truck = placeStation(world, 2, 0, [world.map.idx(30, 32)], RtStationTile.truck)
            truck.cargo[PAX]!.loadAttempted = true
            expect(distributeProduction(world, [house], PAX, 100)).toBe(0)
        })

        it('the split shares sum to exactly the scaled total and never exceed it', () => {
            const rng = new SeededRandom(1)
            for (let round = 0; round < 200; round++) {
                const map = new RtMap(SIDE)
                const house = map.idx(30, 30)
                addHouse(map, house)
                const world = newWorld([], [], map)
                const count = rng.randomInt(2, 5)
                let best = 0
                for (let id = 0; id < count; id++) {
                    const s = placeStation(world, id, rng.randomInt(0, 1), [map.idx(27 + id, 27)], RtStationTile.rail)
                    s.cargo[PAX]!.rating = rng.randomInt(1, 255)
                    s.cargo[PAX]!.loadAttempted = true
                    best = Math.max(best, s.cargo[PAX]!.rating)
                }
                const amount = rng.randomInt(1, 255)
                distributeProduction(world, [house], PAX, amount)
                let scaled = 0
                for (const s of world.stationList()) scaled += rtPacketTotal(s.cargo[PAX]!.packets) * 256 + s.cargo[PAX]!.fraction
                expect(scaled).toBe(amount * (best + 1))
            }
        })

        it('identical inputs and seed give identical packets', () => {
            const run = () => {
                const map = new RtMap(SIDE)
                const centre = map.idx(30, 30)
                map.setTile(centre, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_DIR_BIT[0]! | RT_ROAD_DIR_BIT[2]!)
                for (let x = 26; x < 35; x++) if (x !== 30) addHouse(map, map.idx(x, 31), x % 3)
                const world = newWorld([newTown(0, centre, 8)], [], map)
                const a = placeStation(world, 0, 0, [map.idx(28, 33)], RtStationTile.rail)
                const b = placeStation(world, 1, 1, [map.idx(33, 33)], RtStationTile.bus)
                for (const s of [a, b]) {
                    s.cargo[PAX]!.loadAttempted = true
                    s.cargo[MAIL]!.loadAttempted = true
                }
                advance(world, 5000)
                return { stations: stationState(world), rng: world.rng.state }
            }
            const first = run()
            expect(first).toEqual(run())
            const s = first.stations as RtStation[]
            expect(rtPacketTotal(s[0]!.cargo[PAX]!.packets)).toBeGreaterThan(0)
            // the bus stop never takes mail
            expect(s[1]!.cargo[MAIL]!.packets).toEqual([])
        })
    })

    describe('packets (caps and ageing)', () => {
        it('merges into the newest packet with the same source', () => {
            const packets: RtCargoPacket[] = []
            rtAppendPacket(packets, packet(PAX, 5, 1), 10)
            rtAppendPacket(packets, packet(PAX, 7, 1), 10)
            rtAppendPacket(packets, packet(PAX, 2, 9), 10)
            expect(packets.map(p => p.count)).toEqual([12, 2])
        })

        it('caps a list by merging the oldest packets of one cargo, keeping the larger transit and the older source', () => {
            const packets = [packet(PAX, 1, 10, 3), packet(MAIL, 2, 11, 0), packet(PAX, 4, 12, 9), packet(PAX, 8, 13, 1)]
            rtCapPackets(packets, 3)
            expect(packets).toEqual([packet(PAX, 5, 10, 9), packet(MAIL, 2, 11, 0), packet(PAX, 8, 13, 1)])
            const station: RtCargoPacket[] = []
            for (let k = 0; k < RT_CATALOG.caps.maxPacketsPerStation + 5; k++) rtAppendPacket(station, packet(PAX, 1, k), RT_CATALOG.caps.maxPacketsPerStation)
            expect(station).toHaveLength(RT_CATALOG.caps.maxPacketsPerStation)
            expect(rtPacketTotal(station)).toBe(RT_CATALOG.caps.maxPacketsPerStation + 5)
            expect(station[0]!.sourceTile).toBe(0)
        })

        it('ages packets by one per call and saturates', () => {
            const packets = [packet(PAX, 1, 0, 0), packet(PAX, 1, 0, RT_CATALOG.payment.maxTransitPeriods - 1)]
            agePackets(packets)
            expect(packets.map(p => p.transitPeriods)).toEqual([1, RT_CATALOG.payment.maxTransitPeriods])
            agePackets(packets)
            expect(packets.map(p => p.transitPeriods)).toEqual([2, RT_CATALOG.payment.maxTransitPeriods])
        })
    })

    describe('acceptance timing and saves', () => {
        /** A small growing town whose roads all lie inside a rail station's catchment, two houses to start. */
        function growingTownWorld(): { world: RtWorld, station: RtStation } {
            const map = new RtMap(SIDE)
            const centre = map.idx(30, 30)
            const x = RT_ROAD_DIR_BIT[0]! | RT_ROAD_DIR_BIT[2]!
            map.setTile(map.idx(29, 30), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_DIR_BIT[2]!)
            map.setTile(centre, RtTileKind.road, RT_OWNER_NONE, x)
            map.setTile(map.idx(31, 30), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_DIR_BIT[0]!)
            addHouse(map, map.idx(30, 29), 0)
            addHouse(map, map.idx(30, 31), 0)
            // a ring of water keeps the town inside the catchment
            for (let k = 25; k <= 35; k++) {
                for (const tile of [map.idx(k, 25), map.idx(k, 35), map.idx(25, k), map.idx(35, k)]) map.setTile(tile, RtTileKind.water, RT_OWNER_NONE, 0)
            }
            const town = newTown(0, centre, 2)
            town.population = 80
            town.growing = true
            const world = newWorld([town], [], map)
            const station = placeStation(world, 0, 0, [map.idx(30, 33)], RtStationTile.rail)
            station.cargo[PAX]!.loadAttempted = true
            stationTilesChanged(world, station)
            return { world, station }
        }

        /** Runs the world until a growth step lifts mail in the catchment past the threshold, off the acceptance tick. */
        function growUntilMailCrosses(world: RtWorld, station: RtStation): void {
            for (let k = 0; k < 200000; k++) {
                world.tick++
                if (rtAcceptanceDue(station, world.tick)) {
                    stationsTick(world, world.rng, world.tick)
                    continue
                }
                townTick(world, world.town(0)!, world.rng, world.tick)
                stationsTick(world, world.rng, world.tick)
                if (rtAcceptanceAround(world, stationCatchment(world.map, station))[MAIL]! >= RT_ACCEPT_THRESHOLD) return
            }
            throw new Error('the town never grew enough')
        }

        it('houses grown next to a station change its acceptance only at the next recompute, and a save in between keeps it', () => {
            const { world, station } = growingTownWorld()
            expect(accepts(station, MAIL)).toBe(false)
            growUntilMailCrosses(world, station)
            expect(accepts(station, MAIL)).toBe(false)

            const copy = decodeWorld(encodeWorld(world))!
            expect(copy).not.toBeNull()
            expect(copy.station(0)!.acceptance).toBe(station.acceptance)
            expect(copy.hash()).toBe(world.hash())

            for (const w of [world, copy]) {
                while (!rtAcceptanceDue(w.station(0)!, w.tick + 1)) advance(w, 1)
                expect(accepts(w.station(0)!, MAIL)).toBe(false)
                advance(w, 1)
                expect(accepts(w.station(0)!, MAIL)).toBe(true)
            }
            expect(copy.hash()).toBe(world.hash())
        })

        it('a world decoded right after a house grows in the catchment delivers the same passengers over 1000 ticks', () => {
            const { world, station } = growingTownWorld()
            growUntilMailCrosses(world, station)
            const copy = decodeWorld(encodeWorld(world))!
            advance(world, 1000)
            advance(copy, 1000)
            const live = world.station(0)!.cargo[PAX]!
            const loaded = copy.station(0)!.cargo[PAX]!
            expect(rtPacketTotal(live.packets)).toBeGreaterThan(0)
            expect(loaded.packets).toEqual(live.packets)
            expect(stationState(copy)).toEqual(stationState(world))
            expect(copy.hash()).toBe(world.hash())
        })
    })
})
