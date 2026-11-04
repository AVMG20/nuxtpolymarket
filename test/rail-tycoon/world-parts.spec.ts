import { describe, expect, it } from 'vitest'
import { RtBadData } from '#shared/utils/rail-tycoon/bytes'
import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { rtEmptyFinance } from '#shared/utils/rail-tycoon/economy'
import { rtIndustryTiles } from '#shared/utils/rail-tycoon/industries'
import { RtTileKind } from '#shared/utils/rail-tycoon/map'
import { rtHasTileEntity } from '#shared/utils/rail-tycoon/tile-entities'
import { RtAxis, RtStationTile, rtStationId, rtStationPayload } from '#shared/utils/rail-tycoon/stations-build'
import {
    decodeWorld,
    decodeWorldParts,
    decodeWorldPartsOrThrow,
    encodeWorld,
    encodeWorldParts,
    RT_CHUNK_TILES,
    rtChunkCount,
    rtChunkOfTile,
    rtPartHash
} from '#shared/utils/rail-tycoon/save'
import { RT_NONE, RT_OWNER_NONE, RtOrderKind, RtVehicleKind, RtVehicleState, type RtCompany, type RtStation, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { RtWorld } from '#shared/utils/rail-tycoon/world'
import { generateWorld } from '#shared/utils/rail-tycoon/worldgen'
import { SeededRandom } from '#shared/utils/random'
import { devIt } from './dev-only'
import { freeTiles, insertStationWithTiles } from './fixtures/tile-entities'

function company(id: number): RtCompany {
    return {
        id,
        name: `Company ${id}`,
        colour: id,
        money: RT_CATALOG.economy.startMoney,
        loan: RT_CATALOG.economy.startLoan,
        bankruptMonths: 0,
        foundedTick: 0,
        infrastructure: { railPieces: 0, roadPieces: 0, signals: 0, stationTiles: 0, depots: 0 },
        financeThisYear: rtEmptyFinance(),
        financeLastYear: rtEmptyFinance(),
        monthIncome: 0,
        monthExpenses: 0,
        monthlyIncome: []
    }
}

function station(id: number, owner: number, tile: number): RtStation {
    return {
        id, owner, name: `Station ${id}`, town: 0, sign: tile, tiles: [tile], tilesRevision: 1, facilities: 1,
        cargo: RT_CARGO_IDS.map(() => ({
            rating: 175, hasRating: true, loadAttempted: true,
            packets: [{ cargo: 0, count: 37, sourceTile: 1234, sourceStation: id, transitPeriods: 12, feederShare: 0 }],
            fraction: 77, cyclesSincePickup: 3, maxWaiting: 74, lastSpeed: 88, lastAge: 1
        })),
        acceptance: 3, lastPickupTick: RT_NONE, lastDeliveryTick: 900, lastVehicleKind: RT_NONE,
        catchment: null, catchmentRevision: 0
    }
}

function train(id: number, owner: number, tile: number): RtVehicle {
    return {
        id, owner, kind: RtVehicleKind.rail, model: 0, consist: [0, 2, 2], wagonCount: 2,
        tiles: [tile, tile + 1], pieces: [2, 2], direction: 2, progress: 1500,
        speed: 64, subspeed: 120, route: [1, 2, 3], routeIndex: 1, routeTick: 5000, reservedEnd: 2,
        orders: [{ kind: RtOrderKind.gotoStation, target: 0, flags: 1 }],
        orderIndex: 0, state: RtVehicleState.driving, stopped: false, loadTicks: 0, loadingStation: RT_NONE,
        cargo: [], reliability: 50000, breakdownChance: 12, breakdownTicks: 0, breakdownsSinceService: 1,
        lastServiceTick: 3000, serviceDepot: RT_NONE, haltInDepot: false, runningTicks: 33, lost: false,
        lostRetryTick: RT_NONE, blockedTicks: 4, waitTicks: 0, crashTicks: 0, age: 120, value: 80000,
        profitThisYear: -2500, profitLastYear: 4000
    }
}

/** A generated world with companies, stations spread over many chunks and trains. */
function busyWorld(side: number, seed = 4242): RtWorld {
    const world = RtWorld.create(generateWorld(seed, { side }), { side, maxCompanies: 8, sharing: true })
    world.insertCompany(company(0))
    world.insertCompany(company(1))
    for (let id = 0; id < 12; id++) insertStationWithTiles(world, station(id, id % 2, freeTiles(world, (id * 997 + 31) % (side * side), 1)[0]!))
    for (let id = 0; id < 6; id++) world.insertVehicle(train(id, id % 2, 200 + id * 100))
    world.tick = 123456
    return world
}

function hashes(parts: readonly Uint8Array[]): string[] {
    return parts.map(rtPartHash)
}

/** The indexes whose hash differs between two part lists of equal length. */
function changed(before: readonly string[], after: readonly string[]): number[] {
    return before.flatMap((hash, k) => hash === after[k] ? [] : [k])
}

describe('world parts', () => {
    devIt('round-trips to exactly the whole-world save, at every map side', () => {
        for (const side of [64, 128, 256]) {
            const world = busyWorld(side)
            const parts = encodeWorldParts(world)
            expect(parts).toHaveLength(1 + rtChunkCount(side))
            expect(rtChunkCount(side)).toBe((side / RT_CHUNK_TILES) ** 2)
            const back = decodeWorldPartsOrThrow(parts)
            expect(encodeWorld(back)).toEqual(encodeWorld(world))
            expect(back.hash()).toBe(world.hash())
            expect(back.townList().length).toBeGreaterThan(0)
            expect(back.industryList().length).toBeGreaterThan(0)
        }
    })

    it('keeps every entity in the entity part and only the map in the chunks', () => {
        const world = busyWorld(128)
        const parts = encodeWorldParts(world)
        const before = hashes(parts)

        // a tile entity's state, a town and a moving train change only the entity part
        world.station(5)!.cargo[0]!.packets[0]!.count++
        expect(changed(before, hashes(encodeWorldParts(world)))).toEqual([0])
        world.station(5)!.cargo[0]!.packets[0]!.count--
        world.industryList()[0]!.waiting[0]!++
        expect(changed(before, hashes(encodeWorldParts(world)))).toEqual([0])
        world.industryList()[0]!.waiting[0]!--
        const name = world.townList()[0]!.name
        world.townList()[0]!.name = 'Renamed'
        expect(changed(before, hashes(encodeWorldParts(world)))).toEqual([0])
        world.townList()[0]!.name = name
        world.vehicle(3)!.progress++
        expect(changed(before, hashes(encodeWorldParts(world)))).toEqual([0])
        world.vehicle(3)!.progress--

        // a tile built on changes only its chunk
        const tile = 70 * 128 + 90
        world.map.payload[tile] = world.map.payload[tile]! ^ 1
        expect(changed(before, hashes(encodeWorldParts(world)))).toEqual([1 + rtChunkOfTile(128, tile)])
        world.map.payload[tile] = world.map.payload[tile]! ^ 1

        // a corner on the far edge belongs to the last chunk of its row
        world.map.heights[129 * 129 - 1] = world.map.heights[129 * 129 - 1]! ^ 1
        expect(changed(before, hashes(encodeWorldParts(world)))).toEqual([rtChunkCount(128)])
        world.map.heights[129 * 129 - 1] = world.map.heights[129 * 129 - 1]! ^ 1

        expect(hashes(encodeWorldParts(world))).toEqual(before)
    })

    it('hashes equal bytes equally and different bytes differently', () => {
        const a = Uint8Array.from([1, 2, 3, 4])
        expect(rtPartHash(a)).toBe(rtPartHash(Uint8Array.from(a)))
        expect(rtPartHash(a)).toMatch(/^[0-9a-f]{16}$/)
        const seen = new Set<string>()
        const bytes = new Uint8Array(64)
        for (let i = 0; i < bytes.length; i++) {
            for (const bit of [1, 128]) {
                bytes[i] = bit
                seen.add(rtPartHash(bytes))
                bytes[i] = 0
            }
        }
        expect(seen.size).toBe(128)
        expect(rtPartHash(new Uint8Array(0))).not.toBe(rtPartHash(new Uint8Array(1)))
    })

    it('refuses parts that do not fit together, as RtBadData only', () => {
        const world = busyWorld(64)
        const parts = encodeWorldParts(world)
        const refused = (bad: Uint8Array[]) => {
            expect(() => decodeWorldPartsOrThrow(bad)).toThrow(RtBadData)
            expect(decodeWorldParts(bad)).toBeNull()
        }
        refused([])
        refused(parts.slice(0, -1))
        refused([...parts, parts[1]!])
        // two chunks swapped, and the entity part where a chunk belongs
        refused([parts[0]!, parts[2]!, parts[1]!, ...parts.slice(3)])
        refused([parts[1]!, ...parts.slice(1)])
        refused([parts[0]!, parts[0]!, ...parts.slice(2)])
        // a chunk from a map of another side
        const other = encodeWorldParts(busyWorld(128))
        refused([parts[0]!, other[1]!, ...parts.slice(2)])
        // truncated and padded parts
        for (const k of [0, 1, parts.length - 1]) {
            refused(parts.map((part, i) => i === k ? part.subarray(0, part.length - 1) : part))
            refused(parts.map((part, i) => i === k ? Uint8Array.from([...part, 0]) : part))
        }
        expect(decodeWorldParts(parts)).not.toBeNull()
    })

    it('joins every building with a tile entity to it by location', () => {
        const world = busyWorld(64)
        const back = decodeWorldPartsOrThrow(encodeWorldParts(world))
        let buildings = 0
        for (let tile = 0; tile < back.map.tileCount; tile++) {
            const kind = back.map.kind[tile]!
            if (!rtHasTileEntity(kind)) continue
            buildings++
            const payload = back.map.payload[tile]!
            if (kind === RtTileKind.station) expect(back.station(rtStationId(payload))!.tiles).toContain(tile)
            else expect(rtIndustryTiles(back.map, back.industries[payload]!)).toContain(tile)
        }
        expect(back.stationList().length).toBe(12)
        expect(buildings).toBeGreaterThan(12)
    })

    it('refuses a building without its tile entity, or a tile entity whose tiles are not its buildings', () => {
        const refused = (change: (world: RtWorld) => void) => {
            const world = busyWorld(64)
            change(world)
            expect(() => decodeWorldPartsOrThrow(encodeWorldParts(world))).toThrow(RtBadData)
            expect(decodeWorld(encodeWorld(world))).toBeNull()
        }
        const clear = (world: RtWorld, tile: number) => world.map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
        const spare = (world: RtWorld) => freeTiles(world, 1000, 1)[0]!
        const industry = (world: RtWorld) => world.industryList()[0]!

        // a station's tile cleared, given to another company, or naming another station
        refused(world => clear(world, world.station(0)!.tiles[0]!))
        refused(world => world.map.owner[world.station(0)!.tiles[0]!] = 1)
        refused(world => world.map.payload[world.station(0)!.tiles[0]!] = rtStationPayload(1, RtStationTile.rail, RtAxis.x))
        // a platform no station holds, naming a live station or none
        refused(world => world.map.setTile(spare(world), RtTileKind.station, 0, rtStationPayload(0, RtStationTile.rail, RtAxis.x)))
        refused(world => world.map.setTile(spare(world), RtTileKind.station, 0, rtStationPayload(99, RtStationTile.rail, RtAxis.x)))
        // an industry tile cleared or naming another industry, and an industry building with no industry
        refused(world => clear(world, industry(world).origin))
        refused(world => world.map.payload[industry(world).origin] = industry(world).id + 1)
        refused(world => world.map.setTile(spare(world), RtTileKind.industry, RT_OWNER_NONE, industry(world).id))
        refused(world => world.industries[industry(world).id] = undefined)

        expect(decodeWorldParts(encodeWorldParts(busyWorld(64)))).not.toBeNull()
    })

    devIt('yields null or a world for seeded byte flips of every part, never another error', () => {
        const world = busyWorld(64)
        const parts = encodeWorldParts(world)
        const rng = new SeededRandom(77)
        let worlds = 0
        for (let n = 0; n < 400; n++) {
            const k = rng.randomInt(0, parts.length - 1)
            const part = Uint8Array.from(parts[k]!)
            for (let flips = rng.randomInt(1, 3); flips > 0; flips--) part[rng.randomInt(0, part.length - 1)]! ^= 1 << rng.randomInt(0, 7)
            const flipped = parts.slice()
            flipped[k] = part
            if (decodeWorldParts(flipped)) worlds++
        }
        expect(worlds).toBeLessThan(400)
    })

    it('keeps a map with every tile kind identical through the parts', () => {
        const world = busyWorld(64)
        for (let tile = 0; tile < world.map.tileCount; tile += 37) world.map.kind[tile] = tile % 2 ? RtTileKind.clear : world.map.kind[tile]!
        const back = decodeWorldPartsOrThrow(encodeWorldParts(world))
        expect(back.map.kind).toEqual(world.map.kind)
        expect(back.map.heights).toEqual(world.map.heights)
        expect(back.map.payload).toEqual(world.map.payload)
        expect(back.map.owner).toEqual(world.map.owner)
    })
})
