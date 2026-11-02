import { gunzipSync, gzipSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { RtBadData, RtReader } from '#shared/utils/rail-tycoon/bytes'
import { RT_CARGO_IDS, RT_CATALOG, RT_INDUSTRY_TYPE_IDS } from '#shared/utils/rail-tycoon/catalog'
import { rtClearPacketSource, rtDeleteOrdersTo } from '#shared/utils/rail-tycoon/demolish'
import { buildDepot } from '#shared/utils/rail-tycoon/depots'
import { rtEmptyFinance } from '#shared/utils/rail-tycoon/economy'
import { RT_GUNZIP_MAX_BYTES, RT_MAX_SAVE_BYTES } from '#shared/utils/rail-tycoon/limits'
import { RT_ROAD_DIR_BIT, RtDir, RtMap, RtTileKind } from '#shared/utils/rail-tycoon/map'
import { SeededRandom } from '#shared/utils/random'
import { buyVehicle, sellVehicle } from '#shared/utils/rail-tycoon/vehicles'
import {
    decodeWorld,
    decodeWorldOrThrow,
    encodeWorld,
    RT_SAVE_BOUNDS,
    RT_SAVE_FORMAT,
    RT_SAVE_MAGIC
} from '#shared/utils/rail-tycoon/save'
import {
    RT_NONE,
    RT_OWNER_NONE,
    RtOrderKind,
    RtVehicleKind,
    RtVehicleState,
    type RtCargoPacket,
    type RtCompany,
    type RtOrder,
    type RtStation,
    type RtVehicle
} from '#shared/utils/rail-tycoon/types'
import { RtWorld, rtNewCompany } from '#shared/utils/rail-tycoon/world'
import { generateWorld } from '#shared/utils/rail-tycoon/worldgen'
import { RtCommandKind, applyCommand, decodeCommand, encodeCommand, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import { RtSignalType } from '#shared/utils/rail-tycoon/signals'
import { RtAxis, RtStationTile } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_X, RT_ROAD_Y, RtTrack, rtPieceBetween, rtTrackdirOf } from '#shared/utils/rail-tycoon/track'

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

function packet(sourceStation: number): RtCargoPacket {
    return { cargo: 0, count: 37, sourceTile: 1234, sourceStation, transitPeriods: 12, feederShare: 0 }
}

function station(id: number, owner: number, tile: number): RtStation {
    return {
        id, owner, name: `Station ${id}`, town: 0, sign: tile, tiles: [tile, tile + 1, tile + 2], tilesRevision: 1,
        facilities: 1,
        cargo: RT_CARGO_IDS.map(() => ({
            rating: 175, hasRating: true, loadAttempted: true, packets: [packet(id), packet(RT_NONE)], fraction: 77,
            cyclesSincePickup: 3, maxWaiting: 74, lastSpeed: 88, lastAge: 1
        })),
        acceptance: 3, lastPickupTick: RT_NONE, lastDeliveryTick: 900, lastVehicleKind: RT_NONE,
        catchment: null, catchmentRevision: 0
    }
}

/** A train mid-route: a long cached route, a full order list and cargo aboard. */
function train(id: number, owner: number, tile: number): RtVehicle {
    return {
        id, owner, kind: RtVehicleKind.rail, model: 0, consist: [0, 2, 2, 2, 2, 2], wagonCount: 5,
        tiles: [tile, tile + 1, tile + 2, tile + 3], pieces: [2, 2, 2, 2], direction: 2, progress: 1500,
        speed: 64, subspeed: 120, route: Array.from({ length: 400 }, (_, k) => k % 12), routeIndex: 37,
        routeTick: 5000, reservedEnd: 60,
        orders: Array.from({ length: 8 }, (_, k) => ({ kind: RtOrderKind.gotoStation, target: k, flags: 1 })),
        orderIndex: 2, state: RtVehicleState.driving, stopped: false, loadTicks: 0, loadingStation: RT_NONE,
        cargo: Array.from({ length: 20 }, () => packet(1)), reliability: 50000, breakdownChance: 12,
        breakdownTicks: 0, breakdownsSinceService: 1, lastServiceTick: 3000, serviceDepot: RT_NONE, haltInDepot: false,
        runningTicks: 33, lost: true, lostRetryTick: 9000, blockedTicks: 4, waitTicks: 0, crashTicks: 0,
        age: 120, value: 80000, profitThisYear: -2500, profitLastYear: 4_000_000_000
    }
}

function busyWorld(side: number, vehicleCount: number): RtWorld {
    const world = RtWorld.create(generateWorld(4242, { side }), { side, maxCompanies: 8, sharing: true })
    world.insertCompany(company(0))
    world.insertCompany(company(1))
    for (let id = 0; id < 10; id++) world.insertStation(station(id, id % 2, 100 + id * 300))
    for (let id = 0; id < vehicleCount; id++) world.insertVehicle(train(id, id % 2, 200 + id * 100))
    world.tick = 123456
    world.pathfinderCursor = 17
    return world
}

function emptyWorld(): RtWorld {
    return new RtWorld({
        settings: { side: 64, maxCompanies: 4, sharing: false },
        map: new RtMap(64),
        rngState: 0xdeadbeef,
        tick: 987654321,
        date: { day: 14, month: 6, year: 1962 },
        pathfinderCursor: 31,
        companies: [], towns: [], industries: [], stations: [], vehicles: []
    })
}

/** Reads the header, settings and map sections back, leaving the reader at the first entity list. */
function readPrefix(bytes: Uint8Array) {
    const r = new RtReader(bytes)
    const magic = [r.u8(), r.u8(), r.u8(), r.u8()]
    const format = r.u16()
    const settings = { side: r.u16(), maxCompanies: r.u8(), sharing: r.u8() }
    const heights = r.bytes(r.varint())
    const kind = r.bytes(r.varint())
    const owner = r.bytes(r.varint())
    const payloadCount = r.varint()
    const payload: number[] = []
    for (let i = 0; i < payloadCount; i++) payload.push(r.u32())
    return { r, magic, format, settings, heights, kind, owner, payload }
}

describe('rail tycoon save format: encodeWorld', () => {
    it('is format 1 and starts with the RTWD magic and the version', () => {
        expect(RT_SAVE_FORMAT).toBe(1)
        const { magic, format } = readPrefix(encodeWorld(emptyWorld()))
        expect(String.fromCharCode(...magic)).toBe('RTWD')
        expect(magic).toEqual([...RT_SAVE_MAGIC])
        expect(format).toBe(RT_SAVE_FORMAT)
    })

    it('writes the settings, then every map array raw with its length', () => {
        const world = busyWorld(64, 4)
        world.map.payload[5] = 0xfedcba98
        const { settings, heights, kind, owner, payload } = readPrefix(encodeWorld(world))
        expect(settings).toEqual({ side: 64, maxCompanies: 8, sharing: 1 })
        expect([...heights]).toEqual([...world.map.heights])
        expect([...kind]).toEqual([...world.map.kind])
        expect([...owner]).toEqual([...world.map.owner])
        expect(payload).toEqual([...world.map.payload])
    })

    it('ends with the RNG state, tick, date and pathfinder cursor after the entity lists and the crossing violations', () => {
        const { r } = readPrefix(encodeWorld(emptyWorld()))
        // five entity lists, then the violation list
        for (let list = 0; list < 6; list++) expect(r.varint()).toBe(0)
        expect(r.u32()).toBe(0xdeadbeef)
        expect(r.varint()).toBe(987654321)
        expect({ day: r.u8(), month: r.u8(), year: r.varint() }).toEqual({ day: 14, month: 6, year: 1962 })
        expect(r.varint()).toBe(31)
        r.end()
    })

    it('writes money as svarint: negative cash and values past 2^32', () => {
        const world = emptyWorld()
        const rich = company(0)
        rich.money = -123456
        rich.loan = 2 ** 40
        world.insertCompany(rich)
        const { r } = readPrefix(encodeWorld(world))
        expect(r.varint()).toBe(1)
        expect(r.varint()).toBe(0)
        expect(r.str(32)).toBe('Company 0')
        expect(r.varint()).toBe(0)
        expect(r.svarint()).toBe(-123456)
        expect(r.svarint()).toBe(2 ** 40)
    })

    it('is deterministic and leaves the world unchanged', () => {
        const world = busyWorld(64, 6)
        const before = JSON.stringify([world.companyList(), world.stationList(), world.vehicleList(), world.scalars()])
        const a = encodeWorld(world)
        const b = encodeWorld(world)
        expect(b).toEqual(a)
        expect(JSON.stringify([world.companyList(), world.stationList(), world.vehicleList(), world.scalars()])).toBe(before)
    })

    it('does not save derived state: the occupied registry, dirty tiles and catchment caches', () => {
        const world = busyWorld(64, 3)
        const plain = encodeWorld(world)
        world.occupied.holdPiece(0, 200, 2)
        world.markDirty(77)
        world.pathNodesLeft = 5
        world.station(0)!.catchment = [1, 2, 3]
        world.station(0)!.catchmentRevision = 9
        world.company(0)!.infrastructure.railPieces = 40
        expect(encodeWorld(world)).toEqual(plain)
    })

    it('encodes a 128 map world with 50 vehicles under 300 KB before gzip', () => {
        const bytes = encodeWorld(busyWorld(128, 50))
        console.log(`128 map, 50 vehicles: ${bytes.length} bytes`)
        expect(bytes.length).toBeLessThan(300 * 1024)
    })

    it('refuses a world that breaks a save bound instead of writing an unloadable save', () => {
        const long = emptyWorld()
        const named = company(0)
        named.name = 'x'.repeat(RT_CATALOG.caps.maxNameBytes + 1)
        long.insertCompany(named)
        expect(() => encodeWorld(long)).toThrow(RangeError)

        const months = emptyWorld()
        const history = company(0)
        history.monthlyIncome = Array.from({ length: 13 }, () => ({ income: 1, expenses: -1 }))
        months.insertCompany(history)
        expect(() => encodeWorld(months)).toThrow(RangeError)

        const ragged = emptyWorld()
        const vehicle = train(0, 0, 10)
        vehicle.pieces.pop()
        ragged.insertVehicle(vehicle)
        expect(() => encodeWorld(ragged)).toThrow(RangeError)

        const orders = emptyWorld()
        const busy = train(0, 0, 10)
        busy.orders = Array.from({ length: RT_CATALOG.caps.maxOrders + 1 }, () => ({ kind: RtOrderKind.gotoStation, target: 0, flags: 0 }))
        orders.insertVehicle(busy)
        expect(() => encodeWorld(orders)).toThrow(RangeError)
    })
})

describe('rail tycoon save format: encode refuses what decode would refuse', () => {
    it('refuses per-cargo arrays that do not hold one entry per cargo', () => {
        const world = busyWorld(64, 0)
        world.towns.find(town => town !== null)!.receivedThisMonth.pop()
        expect(() => encodeWorld(world)).toThrow(RangeError)

        const stations = busyWorld(64, 0)
        stations.station(0)!.cargo.pop()
        expect(() => encodeWorld(stations)).toThrow(RangeError)
    })

    it('bounds a station at stationSpread squared tiles', () => {
        const spread = RT_CATALOG.stations.stationSpread
        expect(RT_SAVE_BOUNDS.stationTiles).toBe(spread * spread)
        const world = busyWorld(64, 0)
        world.station(0)!.tiles = Array.from({ length: spread * spread + 1 }, (_, k) => k)
        expect(() => encodeWorld(world)).toThrow(RangeError)
    })
})

/**
 * Offset of the first entity list in a 64 map save: header and settings (10), heights (2-byte length
 * + 65 squared), kind and owner (2-byte length + 64 squared each), payload (2-byte count + 4 per tile).
 */
const MAP_END_64 = 10 + (2 + 65 * 65) + 2 * (2 + 64 * 64) + (2 + 64 * 64 * 4)

/** Derived fields types.ts marks as caches: decode rebuilds them (stations.ts builds catchments), so they are not compared. */
const DERIVED_KEYS = new Set(['infrastructure', 'catchment', 'catchmentRevision'])

/** JSON of entities with their derived fields left out. */
function savedJson(list: readonly object[]): string {
    return JSON.stringify(list, (key, value) => DERIVED_KEYS.has(key) ? undefined : value)
}

/** Encodes, decodes and re-encodes: the decoded world must write the same bytes and hash the same. */
function roundTrip(world: RtWorld): RtWorld {
    const bytes = encodeWorld(world)
    const back = decodeWorld(bytes)
    expect(back).not.toBeNull()
    expect(encodeWorld(back!)).toEqual(bytes)
    expect(back!.hash()).toBe(world.hash())
    return back!
}

/** Whether decodeWorld refuses the bytes, and decodeWorldOrThrow with RtBadData and nothing else. */
function refused(bytes: Uint8Array): boolean {
    if (decodeWorld(bytes) !== null) return false
    try {
        decodeWorldOrThrow(bytes)
    } catch (error) {
        return error instanceof RtBadData
    }
    return false
}

/** a with its first byte that differs from b raised by one: a count one past what a held. */
function bumpFirstDifference(a: Uint8Array, b: Uint8Array): Uint8Array {
    let at = 0
    while (a[at] === b[at]) at++
    const out = a.slice()
    out[at] = out[at]! + 1
    return out
}

/** A bus on two road tiles in lane 1. */
function bus(id: number, owner: number, tile: number): RtVehicle {
    return {
        ...train(id, owner, tile), kind: RtVehicleKind.road, model: 7, consist: [7], wagonCount: 0,
        tiles: [tile, tile + 1], pieces: [1, 1], direction: 1, route: [1, 1, 2, 2], routeIndex: 1, reservedEnd: 0,
        cargo: [packet(RT_NONE)]
    }
}

/** A save of busyWorld(64, 2) changed after it is built; encode must accept the change. */
function variant(change: (world: RtWorld) => void): Uint8Array {
    const world = busyWorld(64, 2)
    change(world)
    return encodeWorld(world)
}

describe('rail tycoon save format: decodeWorld', () => {
    it('round-trips an empty world to the same bytes and hash', () => {
        const back = roundTrip(emptyWorld())
        expect(back.scalars()).toEqual(emptyWorld().scalars())
        expect(back.settings).toEqual({ side: 64, maxCompanies: 4, sharing: false })
    })

    it('round-trips a busy world mid-route, every saved field equal', () => {
        const world = busyWorld(128, 12)
        world.vehicle(3)!.state = RtVehicleState.loading
        world.vehicle(3)!.loadingStation = 4
        world.company(1)!.monthlyIncome = Array.from({ length: 12 }, (_, k) => ({ income: k * 1000, expenses: -k }))
        world.company(1)!.financeThisYear.trainIncome = 2 ** 45
        world.map.payload[77] = 0xffffffff
        const back = roundTrip(world)
        expect(savedJson(back.companyList())).toBe(savedJson(world.companyList()))
        expect(savedJson(back.townList())).toBe(savedJson(world.townList()))
        expect(savedJson(back.industryList())).toBe(savedJson(world.industryList()))
        expect(savedJson(back.stationList())).toBe(savedJson(world.stationList()))
        expect(savedJson(back.vehicleList())).toBe(savedJson(world.vehicleList()))
        expect(back.scalars()).toEqual(world.scalars())
        expect(back.rng.next()).toBe(world.rng.next())
    })

    it('copies the map out of the input, so the bytes may be reused', () => {
        const bytes = encodeWorld(busyWorld(64, 1))
        const back = decodeWorld(bytes)!
        const hash = back.hash()
        bytes.fill(0)
        expect(back.hash()).toBe(hash)
    })

    it('rebuilds derived state: depot occupants, road lanes, stale catchments, empty dirty tiles', () => {
        const world = busyWorld(64, 2)
        world.insertVehicle(bus(2, 1, 900))
        const parked = train(3, 0, 1500)
        parked.state = RtVehicleState.inDepot
        parked.tiles = [1500]
        parked.pieces = [2]
        world.insertVehicle(parked)
        world.station(2)!.catchment = [1, 2, 3]
        world.station(2)!.catchmentRevision = 1
        const back = decodeWorld(encodeWorld(world))!
        expect(back.occupied.depotOccupants(1500)).toEqual([3])
        expect(back.occupied.roadVehiclesInLane(900, 1)).toEqual([2])
        expect(back.occupied.roadVehiclesInLane(901, 1)).toEqual([2])
        expect(back.occupied.vehicleOnTile(901)).toBe(true)
        // the saved cache is never trusted: decode leaves it stale (null) or rebuilds it from the tiles
        const rebuilt = back.station(2)!
        expect(rebuilt.catchment).not.toEqual([1, 2, 3])
        if (rebuilt.catchment !== null) expect(rebuilt.catchmentRevision).toBe(rebuilt.tilesRevision)
        expect(back.dirtyTiles.size).toBe(0)
        expect(back.company(0)!.infrastructure).toEqual({ railPieces: 0, roadPieces: 0, signals: 0, stationTiles: 0, depots: 0 })
    })

    it('returns null for a flipped magic, another version, bad settings, a trailing byte or no bytes', () => {
        const bytes = encodeWorld(emptyWorld())
        const patched = (at: number, value: number) => {
            const out = bytes.slice()
            out[at] = value
            return out
        }
        expect(refused(patched(0, 0x53))).toBe(true)
        expect(refused(patched(3, 0x45))).toBe(true)
        expect(refused(patched(4, RT_SAVE_FORMAT + 1))).toBe(true)
        expect(refused(patched(6, 100))).toBe(true)
        expect(refused(patched(8, 1))).toBe(true)
        expect(refused(patched(8, 9))).toBe(true)
        expect(refused(patched(9, 2))).toBe(true)
        // the date ends the save as day, month, a 2-byte year and a 1-byte cursor; the world refuses a bad one
        const dayAt = bytes.length - 5
        expect([bytes[dayAt], bytes[dayAt + 1]]).toEqual([14, 6])
        expect(refused(patched(dayAt, 0))).toBe(true)
        expect(refused(patched(dayAt + 1, 12))).toBe(true)
        const longer = new Uint8Array(bytes.length + 1)
        longer.set(bytes)
        expect(refused(longer)).toBe(true)
        expect(refused(new Uint8Array(0))).toBe(true)
        expect(refused([1, 2, 3] as unknown as Uint8Array)).toBe(true)
    })

    it('returns null for every truncation of a save', () => {
        const bytes = encodeWorld(busyWorld(64, 2))
        for (let length = 0; length < bytes.length; length++) {
            if (!refused(bytes.subarray(0, length))) throw new Error(`truncated to ${length} of ${bytes.length} bytes was accepted`)
        }
        expect(decodeWorld(bytes)).not.toBeNull()
    })

    it('refuses counts above their bound before reading the entries', () => {
        // the companies count is the first byte after the map; the empty world allows 4
        const empty = encodeWorld(emptyWorld())
        const listsAt = MAP_END_64
        expect([...empty.subarray(listsAt, listsAt + 5)]).toEqual([0, 0, 0, 0, 0])
        const companies = empty.slice()
        companies[listsAt] = 5
        expect(refused(companies)).toBe(true)
        const towns = empty.slice()
        towns[listsAt + 1] = RT_SAVE_BOUNDS.towns + 1
        expect(refused(towns)).toBe(true)
        // 4000 vehicles is within the cap but far past the bytes left: refused before any entry is read
        const vehiclesAt = listsAt + 4
        const huge = new Uint8Array(empty.length + 1)
        huge.set(empty.subarray(0, vehiclesAt))
        huge.set([0xa0, 0x1f], vehiclesAt)
        huge.set(empty.subarray(vehiclesAt + 1), vehiclesAt + 2)
        expect(refused(huge)).toBe(true)

        const orders = (count: number) => variant(world => {
            world.vehicle(1)!.orders = Array.from({ length: count }, () => ({ kind: RtOrderKind.gotoStation, target: 0, flags: 0 }))
        })
        expect(decodeWorld(orders(RT_SAVE_BOUNDS.orders))).not.toBeNull()
        expect(refused(bumpFirstDifference(orders(RT_SAVE_BOUNDS.orders), orders(RT_SAVE_BOUNDS.orders - 1)))).toBe(true)

        const route = (count: number) => variant(world => {
            world.vehicle(1)!.route = Array.from({ length: count }, () => 3)
        })
        expect(decodeWorld(route(RT_SAVE_BOUNDS.route))).not.toBeNull()
        expect(refused(bumpFirstDifference(route(RT_SAVE_BOUNDS.route), route(RT_SAVE_BOUNDS.route - 1)))).toBe(true)

        const consist = (count: number) => variant(world => {
            const vehicle = world.vehicle(1)!
            vehicle.consist = [0, ...Array.from({ length: count - 1 }, () => 2)]
            vehicle.wagonCount = count - 1
        })
        expect(decodeWorld(consist(RT_SAVE_BOUNDS.consist))).not.toBeNull()
        expect(refused(bumpFirstDifference(consist(RT_SAVE_BOUNDS.consist), consist(RT_SAVE_BOUNDS.consist - 1)))).toBe(true)

        const tiles = (count: number) => variant(world => {
            world.station(9)!.tiles = Array.from({ length: count }, (_, k) => 3000 + k)
        })
        expect(decodeWorld(tiles(RT_SAVE_BOUNDS.stationTiles))).not.toBeNull()
        expect(refused(bumpFirstDifference(tiles(RT_SAVE_BOUNDS.stationTiles), tiles(RT_SAVE_BOUNDS.stationTiles - 1)))).toBe(true)

        const cargo = (count: number) => variant(world => {
            world.vehicle(0)!.cargo = Array.from({ length: count }, () => packet(RT_NONE))
        })
        expect(decodeWorld(cargo(RT_SAVE_BOUNDS.vehiclePackets))).not.toBeNull()
        expect(refused(bumpFirstDifference(cargo(RT_SAVE_BOUNDS.vehiclePackets), cargo(RT_SAVE_BOUNDS.vehiclePackets - 1)))).toBe(true)
    })

    it('returns null for a dangling id; a packet with no source station is not dangling', () => {
        expect(decodeWorld(variant(world => {
            world.vehicle(0)!.cargo[0]!.sourceStation = RT_NONE
        }))).not.toBeNull()
        const dangling: ((world: RtWorld) => void)[] = [
            world => { world.vehicle(0)!.orders[0]!.target = 50 },
            world => { world.vehicle(0)!.cargo[0]!.sourceStation = 33 },
            world => { world.station(0)!.cargo[2]!.packets[0]!.sourceStation = 11 },
            world => { world.vehicle(1)!.loadingStation = 12 },
            world => { world.vehicle(1)!.owner = 2 },
            world => { world.station(3)!.owner = 5 },
            world => {
                expect(world.town(RT_CATALOG.caps.maxTowns - 1)).toBeUndefined()
                world.station(3)!.town = RT_CATALOG.caps.maxTowns - 1
            },
            world => { world.map.owner[10] = 3 }
        ]
        for (const [k, change] of dangling.entries()) {
            if (!refused(variant(change))) throw new Error(`dangling case ${k} was accepted`)
        }
        expect(decodeWorld(variant(world => {
            world.map.owner[10] = 1
        }))).not.toBeNull()
    })

    it('returns null for an enum, boolean or value out of range', () => {
        const cases: ((world: RtWorld) => void)[] = [
            world => { world.vehicle(0)!.kind = 2 as RtVehicleKind },
            world => { world.vehicle(0)!.state = (RtVehicleState.parked + 1) as RtVehicleState },
            world => { world.vehicle(0)!.orders[1]!.kind = 2 as RtOrderKind },
            world => { world.vehicle(0)!.orders[1]!.flags = 8 },
            world => {
                world.vehicle(0)!.orders[1]!.kind = RtOrderKind.gotoDepot
                world.vehicle(0)!.orders[1]!.target = 64 * 64
            },
            world => { world.vehicle(0)!.model = 99 },
            world => {
                world.vehicle(0)!.model = 2
                world.vehicle(0)!.consist[0] = 2
            },
            world => { world.vehicle(0)!.consist[1] = 7 },
            world => { world.vehicle(0)!.consist[0] = 1 },
            world => { world.vehicle(0)!.wagonCount = 6 },
            world => { world.vehicle(0)!.tiles[1] = 64 * 64 },
            world => { world.vehicle(0)!.pieces[1] = 16 },
            world => { world.vehicle(0)!.route[5] = 16 },
            world => { world.vehicle(0)!.routeIndex = 401 },
            world => { world.vehicle(0)!.orderIndex = 8 },
            world => { world.vehicle(0)!.reliability = 65536 },
            world => { world.vehicle(0)!.cargo[0]!.cargo = RT_CARGO_IDS.length },
            world => { world.vehicle(0)!.cargo[0]!.sourceTile = 64 * 64 },
            world => { world.station(0)!.facilities = 8 },
            world => { world.station(0)!.cargo[0]!.rating = 256 },
            world => { world.station(0)!.cargo[0]!.fraction = 256 },
            world => { world.station(0)!.tiles = [5, 5] },
            world => { world.station(0)!.lastVehicleKind = 2 },
            world => { world.station(0)!.acceptance = 1 << RT_CARGO_IDS.length },
            world => { world.industries.find(industry => industry !== null)!.type = 4 },
            world => { world.company(0)!.colour = RT_CATALOG.companies.colours.length },
            world => { world.map.kind[3] = 10 },
            world => { world.map.heights[3] = 16 }
        ]
        for (const [k, change] of cases.entries()) {
            if (!refused(variant(change))) throw new Error(`case ${k} was accepted`)
        }
    })

    it('only ever returns null or a valid world under seeded random byte flips', () => {
        const bytes = encodeWorld(busyWorld(64, 2))
        // the entity lists and scalars follow the map; aim half the flips there
        const mapEnd = MAP_END_64
        const rng = new SeededRandom(0x5eed)
        const rounds = 1500
        let accepted = 0
        for (let round = 0; round < rounds; round++) {
            const flipped = bytes.slice()
            const flips = rng.randomInt(1, 4)
            for (let k = 0; k < flips; k++) {
                const at = rng.randomRatio(1, 2) ? rng.randomInt(mapEnd, bytes.length - 1) : rng.randomInt(0, bytes.length - 1)
                flipped[at] = flipped[at]! ^ rng.randomInt(1, 255)
            }
            let world: RtWorld
            try {
                world = decodeWorldOrThrow(flipped)
            } catch (error) {
                if (!(error instanceof RtBadData)) throw error
                expect(decodeWorld(flipped)).toBeNull()
                continue
            }
            accepted++
            // anything accepted is a world that saves and loads again unchanged
            expect(decodeWorld(encodeWorld(world))!.hash()).toBe(world.hash())
        }
        expect(accepted).toBeGreaterThan(0)
        expect(accepted).toBeLessThan(rounds)
    })
})

/* ------------------------------------------------------------------------------------------
 * Saves are lossless for everything the simulation reads, not just the hash
 * ---------------------------------------------------------------------------------------- */

/** An empty 64 map world with company 0 and a rail depot at (10, 10) facing north-east, holding `trains` bought trains. */
function depotWorld(trains: number): { world: RtWorld, depot: number } {
    const world = emptyWorld()
    world.insertCompany(company(0))
    const depot = world.map.idx(10, 10)
    expect(buildDepot(world.map, 0, depot, RtVehicleKind.rail, 0, true).ok).toBe(true)
    for (let k = 0; k < trains; k++) buyTrain(world, depot, k)
    return { world, depot }
}

/** Buys a tank engine with two coaches into the depot and checks it got the expected id. */
function buyTrain(world: RtWorld, depot: number, expectedId: number): void {
    expect(buyVehicle(world, 0, depot, 0, [2, 2], true)).toEqual({ ok: true, cost: expect.any(Number), vehicle: expectedId })
}

/** Every saved list of two worlds, field by field (savedJson leaves the derived caches out). */
function expectSameState(back: RtWorld, world: RtWorld): void {
    expect(savedJson(back.companyList())).toBe(savedJson(world.companyList()))
    expect(savedJson(back.townList())).toBe(savedJson(world.townList()))
    expect(savedJson(back.industryList())).toBe(savedJson(world.industryList()))
    expect(savedJson(back.stationList())).toBe(savedJson(world.stationList()))
    expect(savedJson(back.vehicleList())).toBe(savedJson(world.vehicleList()))
    expect(back.scalars()).toEqual(world.scalars())
}

describe('rail tycoon save format: lossless round trips', () => {
    it('a decoded world hashes like the live world it was saved from', () => {
        const worlds = [
            emptyWorld(),
            busyWorld(64, 6),
            busyWorld(128, 30),
            RtWorld.create(generateWorld(77, { side: 64 }), { side: 64, maxCompanies: 2, sharing: false }),
            depotWorld(3).world
        ]
        const hashes = new Set<number>()
        for (const world of worlds) {
            const back = decodeWorld(encodeWorld(world))!
            expect(back.hash()).toBe(world.hash())
            hashes.add(world.hash())
        }
        expect(hashes.size).toBe(worlds.length)

        // the copy is its own state: a change to it shows in its hash and not in the original's
        const world = busyWorld(64, 2)
        const before = world.hash()
        const back = decodeWorld(encodeWorld(world))!
        back.vehicle(1)!.blockedTicks++
        expect(back.hash()).not.toBe(before)
        expect(world.hash()).toBe(before)
    })

    it('round-trips negative cash, a negative profit, negative finance categories and money past 2^32', () => {
        const world = busyWorld(64, 3)
        const poor = world.company(0)!
        poor.money = -987654
        poor.loan = 2 ** 33 + 7
        poor.financeThisYear.runningCosts = -(2 ** 34)
        poor.financeLastYear.property = -1
        poor.monthExpenses = -(2 ** 32) - 1
        poor.monthlyIncome = [{ income: 2 ** 40, expenses: -(2 ** 40) }]
        const rich = world.company(1)!
        rich.money = Number.MAX_SAFE_INTEGER
        rich.financeThisYear.other = -Number.MAX_SAFE_INTEGER
        rich.financeLastYear.trainIncome = 2 ** 52 + 1
        const vehicle = world.vehicle(2)!
        vehicle.profitThisYear = -(2 ** 35)
        vehicle.profitLastYear = -1
        vehicle.value = 2 ** 36
        world.vehicle(0)!.cargo[0]!.feederShare = -(2 ** 33)

        const back = roundTrip(world)
        expectSameState(back, world)
        expect(back.company(0)!.money).toBe(-987654)
        expect(back.company(0)!.financeThisYear.runningCosts).toBe(-(2 ** 34))
        expect(back.company(1)!.money).toBe(Number.MAX_SAFE_INTEGER)
        expect(back.company(1)!.financeThisYear.other).toBe(-Number.MAX_SAFE_INTEGER)
        expect(back.vehicle(2)!.profitThisYear).toBe(-(2 ** 35))
        expect(back.vehicle(0)!.cargo[0]!.feederShare).toBe(-(2 ** 33))
    })

    it('round-trips after a demolished station with orders and packets, and a company reset', () => {
        const gone = 1
        // a station removed without the clean-up leaves dangling orders and packets: the save is refused
        const careless = busyWorld(64, 6)
        careless.removeStation(gone)
        expect(refused(encodeWorld(careless))).toBe(true)

        const world = busyWorld(64, 6)
        world.station(4)!.cargo[1]!.packets.push(packet(gone))
        world.vehicle(5)!.orderIndex = 3
        rtDeleteOrdersTo(world.vehicleList(), RtOrderKind.gotoStation, gone)
        rtClearPacketSource(world.stationList(), world.vehicleList(), gone)
        world.removeStation(gone)
        for (const vehicle of world.vehicleList()) {
            expect(vehicle.orders.some(order => order.target === gone)).toBe(false)
            expect(vehicle.cargo.every(cargo => cargo.sourceStation === RT_NONE)).toBe(true)
        }
        expect(world.vehicle(5)!.orderIndex).toBe(2)

        // company 1 resets: its vehicles and stations go (with the same clean-up), its tiles fall to
        // nobody, and it restarts under its old name and colour, founded now
        world.map.owner[10] = 1
        const old = world.company(1)!
        for (const vehicle of world.vehicleList()) if (vehicle.owner === 1) world.removeVehicle(vehicle.id)
        for (const station of world.stationList()) {
            if (station.owner !== 1) continue
            rtDeleteOrdersTo(world.vehicleList(), RtOrderKind.gotoStation, station.id)
            rtClearPacketSource(world.stationList(), world.vehicleList(), station.id)
            world.removeStation(station.id)
        }
        for (let i = 0; i < world.map.tileCount; i++) if (world.map.owner[i] === 1) world.map.owner[i] = RT_OWNER_NONE
        world.companies[1] = rtNewCompany(1, old.name, old.colour, world.tick)

        const back = roundTrip(world)
        expectSameState(back, world)
        expect(back.company(1)!.foundedTick).toBe(world.tick)
        expect(back.stationList().map(station => station.id)).toEqual([0, 2, 4, 6, 8])
        expect(back.vehicleList().map(vehicle => vehicle.id)).toEqual([0, 2, 4])
    })

    it('gives the same id to a vehicle bought on the live and the decoded world after the highest id was sold', () => {
        const { world, depot } = depotWorld(4)
        expect(sellVehicle(world, 0, 3, true).ok).toBe(true)
        expect(world.vehicles.length).toBe(3)
        const back = roundTrip(world)
        expect(back.freeVehicleId()).toBe(3)
        expect(world.freeVehicleId()).toBe(3)

        buyTrain(world, depot, 3)
        buyTrain(back, depot, 3)
        expect(back.hash()).toBe(world.hash())
        expect(encodeWorld(back)).toEqual(encodeWorld(world))
        expect([...back.occupied.depotOccupants(depot)].sort()).toEqual([...world.occupied.depotOccupants(depot)].sort())
    })

    it('fills id holes the same way on the live and the decoded world', () => {
        const { world, depot } = depotWorld(6)
        expect(sellVehicle(world, 0, 1, true).ok).toBe(true)
        expect(sellVehicle(world, 0, 5, true).ok).toBe(true)
        const back = roundTrip(world)
        for (const expected of [1, 5, 6]) {
            buyTrain(world, depot, expected)
            buyTrain(back, depot, expected)
            expect(back.hash()).toBe(world.hash())
        }
    })

    it('round-trips lost trains mid-retry and a pathfinder cursor part-way round', () => {
        const world = busyWorld(64, 6)
        world.tick = 50_000
        for (const id of [1, 4]) {
            const vehicle = world.vehicle(id)!
            vehicle.lost = true
            vehicle.lostRetryTick = world.tick + 37 + id
            vehicle.route = []
            vehicle.routeIndex = 0
            vehicle.reservedEnd = 0
            vehicle.routeTick = RT_NONE
        }
        // one retries on the very next tick, one gave up its search with a stale route still cached
        world.vehicle(3)!.lostRetryTick = world.tick
        world.vehicle(0)!.lost = false
        world.vehicle(0)!.lostRetryTick = RT_NONE
        const lostBus = bus(6, 1, 900)
        lostBus.lost = true
        lostBus.lostRetryTick = world.tick + 1000
        lostBus.blockedTicks = 17
        world.insertVehicle(lostBus)
        world.pathfinderCursor = 4

        const back = roundTrip(world)
        expectSameState(back, world)
        expect(back.pathfinderCursor).toBe(4)
        expect(back.vehicleList().filter(vehicle => vehicle.lost).map(vehicle => [vehicle.id, vehicle.lostRetryTick]))
            .toEqual([[1, 50_038], [2, 9000], [3, 50_000], [4, 50_041], [5, 9000], [6, 51_000]])

        // the hash sees the cursor, a retry tick and a blocked counter
        const hash = back.hash()
        const nudges: ((w: RtWorld) => () => void)[] = [
            w => {
                w.pathfinderCursor++
                return () => { w.pathfinderCursor-- }
            },
            w => {
                w.vehicle(4)!.lostRetryTick++
                return () => { w.vehicle(4)!.lostRetryTick-- }
            },
            w => {
                w.vehicle(6)!.blockedTicks++
                return () => { w.vehicle(6)!.blockedTicks-- }
            }
        ]
        for (const nudge of nudges) {
            const undo = nudge(back)
            expect(back.hash()).not.toBe(hash)
            undo()
            expect(back.hash()).toBe(hash)
        }

        // the cursor may stand anywhere up to the vehicle cap
        world.pathfinderCursor = RT_SAVE_BOUNDS.vehicles
        roundTrip(world)
    })

    it('round-trips names with a leading U+FEFF and 4-byte UTF-8, up to the byte bound', () => {
        const world = busyWorld(64, 1)
        const names = {
            bom: '﻿Acme \u{1F682} Rail',
            full: '\u{1F682}'.repeat(RT_SAVE_BOUNDS.nameBytes / 4),
            onlyBom: '﻿',
            twoBoms: '﻿﻿\u{1D516}tation'
        }
        world.company(0)!.name = names.bom
        world.company(1)!.name = names.full
        world.towns.find(town => town !== null)!.name = names.onlyBom
        world.station(3)!.name = names.twoBoms

        const back = roundTrip(world)
        expect(back.company(0)!.name).toBe(names.bom)
        expect(back.company(0)!.name.charCodeAt(0)).toBe(0xfeff)
        expect(back.company(1)!.name).toBe(names.full)
        expect(back.towns.find(town => town !== null)!.name).toBe(names.onlyBom)
        expect(back.station(3)!.name).toBe(names.twoBoms)

        // one more byte past a run of 4-byte characters breaks the bound
        world.company(1)!.name = names.full + 'x'
        expect(() => encodeWorld(world)).toThrow(RangeError)
    })

    it('a name with a lone surrogate either round-trips with an equal hash or is refused by encode', () => {
        const world = emptyWorld()
        const named = company(0)
        named.name = 'ab\uD800'
        world.insertCompany(named)
        let bytes: Uint8Array
        try {
            bytes = encodeWorld(world)
        } catch (error) {
            expect(error).toBeInstanceOf(RangeError)
            return
        }
        expect(decodeWorld(bytes)!.hash()).toBe(world.hash())
    })

    it('refuses a 128 map save truncated at 100 random offsets, or with a flipped magic', () => {
        const bytes = encodeWorld(busyWorld(128, 20))
        const rng = new SeededRandom(0x7a11)
        for (let k = 0; k < 100; k++) {
            const at = rng.randomInt(0, bytes.length - 1)
            if (!refused(bytes.subarray(0, at))) throw new Error(`truncated to ${at} of ${bytes.length} bytes was accepted`)
        }
        for (let at = 0; at < RT_SAVE_MAGIC.length; at++) {
            const flipped = bytes.slice()
            flipped[at] = flipped[at]! ^ 0xff
            expect(refused(flipped)).toBe(true)
        }
        expect(decodeWorld(bytes)).not.toBeNull()
    })
})

/* ------------------------------------------------------------------------------------------
 * A 256 map filled to every cap
 * ---------------------------------------------------------------------------------------- */

/**
 * A 256 map world at every cap: 8 companies of 500 vehicles (4000, the world cap), 64 towns, 256
 * industries, 1024 stations of 4 tiles (4096 station tiles, the world cap) each holding 1024
 * packets, every vehicle with 64 orders, 14 parts and 256 packets. Packet contents are shaped like
 * play, not noise: a station's packets come from its own tiles, so gzip sees what a real save holds.
 * Routes are short: a world where every vehicle also caches maxRouteLength steps is larger still.
 */
function capWorld(): RtWorld {
    const caps = RT_CATALOG.caps
    const side = 256
    const rng = new SeededRandom(0xca95)
    const world = new RtWorld({
        settings: { side, maxCompanies: caps.maxCompanies, sharing: true },
        map: new RtMap(side),
        rngState: 0x1234abcd,
        tick: 5_000_000,
        date: { day: 3, month: 4, year: 1999 },
        pathfinderCursor: 1234,
        companies: [], towns: [], industries: [], stations: [], vehicles: []
    })
    for (let id = 0; id < caps.maxCompanies; id++) world.insertCompany(rtNewCompany(id, `Company ${id + 1}`, id, 0))
    const perCargo = () => RT_CARGO_IDS.map(() => rng.randomInt(0, 100_000))
    for (let id = 0; id < caps.maxTowns; id++) {
        world.towns[id] = {
            id, name: `Town ${id}`, centre: rng.randomInt(0, side * side - 1), houseCount: 300, population: 9000,
            growthCounter: 20, growthRate: 70, growing: true, activeStations: 4,
            receivedThisMonth: perCargo(), receivedLastMonth: perCargo()
        }
    }
    for (let id = 0; id < caps.maxIndustries; id++) {
        world.industries[id] = {
            id, type: id % RT_INDUSTRY_TYPE_IDS.length, origin: rng.randomInt(0, side * side - 1),
            waiting: perCargo(), delivered: perCargo(), producedThisMonth: perCargo(), transportedThisMonth: perCargo()
        }
    }
    const played = (home: number): RtCargoPacket => ({
        cargo: home % RT_CARGO_IDS.length, count: rng.randomInt(1, 80), sourceTile: home * 64 + rng.randomInt(0, 3),
        sourceStation: home, transitPeriods: rng.randomInt(0, 40), feederShare: 0
    })
    const stationTiles = caps.maxStationTiles / caps.maxStations
    const perSlot = caps.maxPacketsPerStation / RT_CARGO_IDS.length
    for (let id = 0; id < caps.maxStations; id++) {
        const base = id * 64
        world.insertStation({
            id, owner: id % caps.maxCompanies, name: `Station ${id}`, town: id % caps.maxTowns, sign: base,
            tiles: Array.from({ length: stationTiles }, (_, k) => base + k), tilesRevision: 3, facilities: 1,
            cargo: RT_CARGO_IDS.map((_, k) => ({
                rating: 170, hasRating: true, loadAttempted: true,
                packets: Array.from({ length: Math.floor(perSlot) + (k < caps.maxPacketsPerStation % RT_CARGO_IDS.length ? 1 : 0) }, () => played(id)),
                fraction: 12, cyclesSincePickup: 2, maxWaiting: 900, lastSpeed: 80, lastAge: 3
            })),
            acceptance: 31, lastPickupTick: 4_999_000, lastDeliveryTick: 4_999_500, lastVehicleKind: RtVehicleKind.rail,
            catchment: null, catchmentRevision: 0
        })
    }
    const parts = RT_CATALOG.vehicles.maxTrainVehicles
    for (let id = 0; id < caps.maxVehicles; id++) {
        const tile = id * 16
        const length = Math.min(RT_SAVE_BOUNDS.vehicleTiles, 8)
        world.insertVehicle({
            ...train(id, id % caps.maxCompanies, tile),
            consist: [0, ...Array.from({ length: parts - 1 }, () => 2)], wagonCount: parts - 1,
            tiles: Array.from({ length }, (_, k) => tile + k), pieces: Array.from({ length }, () => 2),
            route: [2, 2, 2, 2], routeIndex: 1, reservedEnd: 2, routeTick: 4_999_000, lost: false, lostRetryTick: RT_NONE,
            orders: Array.from({ length: caps.maxOrders }, () => ({ kind: RtOrderKind.gotoStation, target: rng.randomInt(0, caps.maxStations - 1), flags: 0 })),
            cargo: Array.from({ length: caps.maxPacketsPerVehicle }, () => played(rng.randomInt(0, caps.maxStations - 1)))
        })
    }
    return world
}

describe('rail tycoon save format: a 256 map at every cap', () => {
    let cached: { world: RtWorld, bytes: Uint8Array, gz: Uint8Array } | null = null
    const capSave = () => {
        if (!cached) {
            const world = capWorld()
            const bytes = encodeWorld(world)
            cached = { world, bytes, gz: gzipSync(bytes) }
        }
        return cached
    }
    afterAll(() => {
        cached = null
    })

    it('encodes, gunzips under RT_GUNZIP_MAX_BYTES and round-trips with an equal hash', { timeout: 120_000 }, () => {
        const { world, bytes, gz } = capSave()
        const caps = RT_CATALOG.caps
        expect(world.companyList().length).toBe(caps.maxCompanies)
        expect(world.townList().length).toBe(caps.maxTowns)
        expect(world.industryList().length).toBe(caps.maxIndustries)
        expect(world.stationList().length).toBe(caps.maxStations)
        expect(world.vehicleList().length).toBe(caps.maxVehicles)
        expect(world.vehicleList().filter(vehicle => vehicle.owner === 0).length).toBe(caps.maxVehiclesPerCompany)
        expect(world.stationList().reduce((sum, station) => sum + station.tiles.length, 0)).toBe(caps.maxStationTiles)

        console.log(`256 map at every cap: ${bytes.length} bytes raw, ${gz.length} bytes gzipped `
            + `(RT_MAX_SAVE_BYTES ${RT_MAX_SAVE_BYTES}, RT_GUNZIP_MAX_BYTES ${RT_GUNZIP_MAX_BYTES})`)
        expect(bytes.length).toBeLessThanOrEqual(RT_GUNZIP_MAX_BYTES)
        const unzipped = gunzipSync(gz, { maxOutputLength: RT_GUNZIP_MAX_BYTES })
        expect(unzipped.length).toBe(bytes.length)
        const back = decodeWorld(new Uint8Array(unzipped.buffer, unzipped.byteOffset, unzipped.byteLength))
        expect(back).not.toBeNull()
        expect(back!.hash()).toBe(world.hash())
    })

    // A world at every cap gzips to about 9.3 MB with play-shaped packets; the save bound is 16 MiB
    it('compresses under RT_MAX_SAVE_BYTES', { timeout: 120_000 }, () => {
        expect(capSave().gz.length).toBeLessThan(RT_MAX_SAVE_BYTES)
    })
})

/* ------------------------------------------------------------------------------------------
 * Continued stepping, on RtWorld.step.
 * ---------------------------------------------------------------------------------------- */

function stepN(world: RtWorld, ticks: number): void {
    for (let k = 0; k < ticks; k++) world.step()
}

/**
 * Steps the live world and its decoded copy side by side for `ticks`, applying the same encoded
 * command stream to both at every 100th tick, as peers do, and fails at the first 100-tick boundary
 * where their hashes differ. `commands` sees the live world and returns what its players send.
 */
function expectLockstep(live: RtWorld, copy: RtWorld, ticks: number, commands?: (world: RtWorld) => [number, RtCommand][]): void {
    const startMonths = live.date.year * 12 + live.date.month
    for (let done = 0; done < ticks; done += 100) {
        for (const [company, command] of commands?.(live) ?? []) {
            const bytes = encodeCommand(command)
            for (const world of [live, copy]) applyCommand(world, company, decodeCommand(bytes, world.map.side)!, true)
        }
        stepN(live, 100)
        stepN(copy, 100)
        if (copy.hash() !== live.hash()) throw new Error(`hashes split by tick ${live.tick}`)
    }
    // 5000 ticks is more than two month ends
    if (ticks >= 5000) expect(live.date.year * 12 + live.date.month - startMonths).toBeGreaterThanOrEqual(2)
}

/**
 * A running network built through commands, in December so a lockstep run crosses a month end and
 * the new year: company 0's main line y = 10 between two stations with a path-signalled passing loop
 * and a block-signalled stretch leaving through a path signal (a mixed block), crossing a town
 * road; company 1's depot and spur at the east end, its train running over company 0's track to
 * company 0's stations (sharing on); a bus between two stops on the town road; a growing town by
 * the east station with houses; cargo waiting. 300 ticks in, trains are mid-route holding
 * reservations, and one is broken down.
 */
function networkWorld(): RtWorld {
    const world = new RtWorld({
        settings: { side: 64, maxCompanies: 4, sharing: true }, map: new RtMap(64), rngState: 0x5eed, tick: 74 * 400,
        date: { day: 24, month: 11, year: 1962 }, pathfinderCursor: 0,
        companies: [rtNewCompany(0, 'Alpha', 0, 0), rtNewCompany(1, 'Beta', 1, 0)], towns: [], industries: [], stations: [], vehicles: []
    })
    const map = world.map
    const at = (x: number, y: number) => map.idx(x, y)
    const must = (owner: number, command: RtCommand) => {
        const result = applyCommand(world, owner, command, true)
        if (!result.ok) throw new Error(`fixture command ${command.kind} refused (${result.error})`)
        return result
    }
    const K = RtCommandKind
    const east = rtTrackdirOf(RtTrack.x, true)
    const line = (owner: number, x0: number, x1: number, y = 10) => must(owner, { kind: K.buildRailLine, tile: at(x0, y), endTile: at(x1, y), trackdir: east })
    const signal = (x: number, y: number, type: number, times: number) => {
        for (let k = 0; k < times; k++) must(0, { kind: K.placeSignal, tile: at(x, y), piece: RtTrack.x, signalType: type })
    }
    // the town and its road (x = 40) before the rail crosses it
    for (let y = 3; y <= 16; y++) map.setTile(at(40, y), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
    for (const [x, y] of [[38, 4], [39, 4], [41, 4], [42, 4], [38, 6], [41, 7], [42, 7]] as [number, number][]) map.setTile(at(x, y), RtTileKind.house, RT_OWNER_NONE, 1)
    world.towns.push({
        id: 0, name: 'Eastwick', centre: at(40, 5), houseCount: 7, population: 140, growthCounter: 3, growthRate: 6, growing: true,
        activeStations: 1, receivedThisMonth: RT_CARGO_IDS.map(() => 0), receivedLastMonth: RT_CARGO_IDS.map(() => 0)
    })

    const west = must(0, { kind: K.buildRailStation, tile: at(10, 10), axis: RtAxis.x, tracks: 1, length: 3 }).id
    const eastStation = must(0, { kind: K.buildRailStation, tile: at(43, 10), axis: RtAxis.x, tracks: 1, length: 3 })
    line(0, 6, 9)
    line(0, 13, 42)
    line(0, 46, 50)
    // the passing loop: eastbound on y = 10, westbound on y = 12
    must(0, { kind: K.buildRail, tile: at(19, 10), piece: rtPieceBetween(RtDir.ne, RtDir.se) })
    must(0, { kind: K.buildRail, tile: at(19, 11), piece: RtTrack.y })
    must(0, { kind: K.buildRail, tile: at(19, 12), piece: rtPieceBetween(RtDir.nw, RtDir.sw) })
    line(0, 20, 26, 12)
    must(0, { kind: K.buildRail, tile: at(27, 12), piece: rtPieceBetween(RtDir.ne, RtDir.nw) })
    must(0, { kind: K.buildRail, tile: at(27, 11), piece: RtTrack.y })
    must(0, { kind: K.buildRail, tile: at(27, 10), piece: rtPieceBetween(RtDir.se, RtDir.sw) })
    signal(20, 10, RtSignalType.path, 3)
    signal(26, 10, RtSignalType.path, 3)
    signal(26, 12, RtSignalType.path, 2)
    signal(20, 12, RtSignalType.path, 2)
    // the mixed block: block signals in, a path signal out
    signal(31, 10, RtSignalType.block, 3)
    signal(36, 10, RtSignalType.path, 3)
    must(0, { kind: K.buildDepot, tile: at(5, 10), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
    // company 1's spur and depot on the east end
    line(1, 51, 54)
    must(1, { kind: K.buildDepot, tile: at(55, 10), vehicleKind: RtVehicleKind.rail, facing: RtDir.ne })

    const buy = (owner: number, depot: number, model: number, wagons: number[], orders: RtOrder[]) => {
        const id = must(owner, { kind: K.buyVehicle, depot, model, wagons }).id!
        must(owner, { kind: K.setOrders, vehicle: id, orders })
        must(owner, { kind: K.startStop, vehicle: id, stopped: false })
        return id
    }
    const goto = (target: number): RtOrder => ({ kind: RtOrderKind.gotoStation, target, flags: 0 })
    const M = RT_CATALOG.vehicles.models
    buy(0, at(5, 10), M.expressEngine.index, [M.passengerCoach.index, M.passengerCoach.index], [goto(west!), goto(eastStation.id!)])
    buy(0, at(5, 10), M.tankEngine.index, [M.mailCar.index], [goto(eastStation.id!), goto(west!)])
    buy(1, at(55, 10), M.expressEngine.index, [M.passengerCoach.index], [goto(eastStation.id!), goto(west!)])
    // a bus line on the town road, its depot beside it
    const stopA = must(0, { kind: K.buildRoadStop, tile: at(40, 5), stop: RtStationTile.bus }).id!
    const stopB = must(0, { kind: K.buildRoadStop, tile: at(40, 14), stop: RtStationTile.bus }).id!
    must(0, { kind: K.buildRoad, tile: at(41, 15), bits: RT_ROAD_X })
    must(0, { kind: K.buildDepot, tile: at(42, 15), vehicleKind: RtVehicleKind.road, facing: RtDir.ne })
    map.setTile(at(40, 15), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y | RT_ROAD_DIR_BIT[RtDir.sw]!)
    buy(0, at(42, 15), M.townBus.index, [], [goto(stopA), goto(stopB)])
    // a train standing stopped in the depot
    must(0, { kind: K.buyVehicle, depot: at(5, 10), model: M.tankEngine.index, wagons: [] })

    for (const station of world.stationList()) {
        station.cargo[RT_CATALOG.cargos.passengers.index]!.packets.push({ cargo: RT_CATALOG.cargos.passengers.index, count: 120, sourceTile: station.sign, sourceStation: station.id, transitPeriods: 0, feederShare: 0 })
    }
    stepN(world, 300)
    return world
}

describe('rail tycoon save format: continued stepping', () => {
    const runningWorld = () => {
        const world = networkWorld()
        world.vehicle(1)!.breakdownTicks = 40
        return world
    }

    it('the network fixture runs: trains move, hold reservations and the bus drives', () => {
        const world = runningWorld()
        // the second train out of the west depot waits there while the first holds the block (a depot is a block signal)
        const moving = world.vehicleList().filter(v => v.state !== RtVehicleState.inDepot)
        expect(moving.length).toBeGreaterThanOrEqual(3)
        expect(world.vehicleList().some(v => v.state === RtVehicleState.inDepot && v.stopped)).toBe(true)
        expect(world.vehicleList().some(v => v.reservedEnd > 0)).toBe(true)
        const before = world.vehicleList().map(v => v.tiles[0])
        stepN(world, 200)
        expect(world.vehicleList().map(v => v.tiles[0])).not.toEqual(before)
    })

    it('snapshots at 5 ticks each step 5000 more in lockstep with the original', () => {
        // the fixture is deterministic, so each snapshot point gets its own original to keep stepping
        for (const ticks of [37, 1013, 2222, 3001, 4999]) {
            const live = runningWorld()
            stepN(live, ticks)
            expectLockstep(live, roundTrip(live), 5000)
        }
    })

    it('the extended fixture (sharing, a crossing over a town road, a stop on it, a growing town) steps 5000 ticks in lockstep after a round trip', () => {
        const live = runningWorld()
        expectLockstep(live, roundTrip(live), 5000)
    })

    it('a mixed block snapshotted mid-run steps 5000 ticks in lockstep', () => {
        const live = runningWorld()
        stepN(live, 500)
        expectLockstep(live, roundTrip(live), 5000)
    })

    it('lost trains mid-retry and a part-way pathfinder cursor step 5000 ticks in lockstep', () => {
        const live = runningWorld()
        for (const id of [1, 3]) {
            const vehicle = live.vehicle(id)!
            vehicle.lost = true
            vehicle.lostRetryTick = live.tick + 50 * id
        }
        live.pathfinderCursor = 2
        expectLockstep(live, roundTrip(live), 5000)
    })

    it('after the highest id is sold, buying on both copies keeps them in lockstep', () => {
        const { world: live, depot } = depotWorld(4)
        expect(sellVehicle(live, 0, 3, true).ok).toBe(true)
        const copy = roundTrip(live)
        // the buy goes out on the first 100-tick boundary; id 3 is free there only once
        let bought = -1
        expectLockstep(live, copy, 5000, world => {
            if (world.freeVehicleId() !== 3) return []
            bought = world.tick
            return [[0, { kind: RtCommandKind.buyVehicle, depot, model: 0, wagons: [2, 2] }]]
        })
        expect(bought).toBeGreaterThan(0)
        expect(live.vehicle(3)).toBeDefined()
        expect(copy.vehicle(3)).toBeDefined()
    })
})
