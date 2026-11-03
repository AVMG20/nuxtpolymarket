import { describe, expect, it } from 'vitest'
import { RT_CARGO_IDS, RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { chargeSharing, rtEmptyFinance, type RtSharingWorld } from '#shared/utils/rail-tycoon/economy'
import {
    RT_NONE,
    RT_OWNER_NONE,
    RtOrderKind,
    RtVehicleKind,
    RtVehicleState,
    type RtCompany,
    type RtStation,
    type RtVehicle
} from '#shared/utils/rail-tycoon/types'
import { RtOccupiedRegistry } from '#shared/utils/rail-tycoon/occupied'
import { rtCleanCompanyName, rtNameSkeleton } from '#shared/utils/rail-tycoon/company-names'
import {
    RtWorld,
    rtLowestFreeId,
    rtNewCompany
} from '#shared/utils/rail-tycoon/world'
import { rtWriteSavedState, type RtSaveSink } from '#shared/utils/rail-tycoon/save-write'
import { generateWorld } from '#shared/utils/rail-tycoon/worldgen'
import { RtReader, RtWriter } from '#shared/utils/rail-tycoon/bytes'
import { RT_FINANCE_KEYS, RT_SAVE_MAGIC, decodeWorldOrThrow, encodeWorld } from '#shared/utils/rail-tycoon/save'
import { RT_SERVER_COMPANY, RtCommandError, RtCommandKind, applyCommand, decodeCommand, encodeCommand, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import { infrastructureUpkeep, monthlyInterest } from '#shared/utils/rail-tycoon/economy'
import { rtRecountInfrastructure } from '#shared/utils/rail-tycoon/infrastructure'
import { rtPieceReserved, rtReservedAhead } from '#shared/utils/rail-tycoon/signals'
import { stationsAround } from '#shared/utils/rail-tycoon/stations'
import { RtDir, RtTileKind } from '#shared/utils/rail-tycoon/map'
import { RtAxis, RtStationTile, rtRoadStopRoadOwner } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_X, RtTrack, rtCrossingRoadOwner, rtIsCrossing, rtRailPieceReserved, rtTrackdirOf } from '#shared/utils/rail-tycoon/track'
import { stepTrain } from '#shared/utils/rail-tycoon/train'
import { rtVehicleSellValue } from '#shared/utils/rail-tycoon/vehicles'

const SETTINGS = { side: 64, maxCompanies: 8, sharing: true }

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

function vehicle(id: number, kind: RtVehicleKind, state: RtVehicleState, tiles: number[], pieces: number[]): RtVehicle {
    return {
        id, owner: 0, kind, model: 0, consist: [0], wagonCount: 0, tiles, pieces, direction: 0, progress: 0,
        speed: 0, subspeed: 0, route: [], routeIndex: 0, routeTick: 0, reservedEnd: 0, orders: [], orderIndex: 0,
        state, stopped: false, loadTicks: 0, loadingStation: RT_NONE, cargo: [], reliability: 0, breakdownChance: 0,
        breakdownTicks: 0, breakdownsSinceService: 0, lastServiceTick: 0, serviceDepot: RT_NONE, haltInDepot: false, runningTicks: 0,
        lost: false, lostRetryTick: 0, blockedTicks: 0, waitTicks: 0, crashTicks: 0, age: 0, value: 0,
        profitThisYear: 0, profitLastYear: 0
    }
}

describe('RtWorld.create', () => {
    it('exposes the layout\'s towns and industries under their ids, ascending', () => {
        const layout = generateWorld(1234, { side: 64 })
        const world = RtWorld.create(layout, SETTINGS)
        expect(layout.towns.length).toBeGreaterThan(0)
        expect(layout.industries.length).toBeGreaterThan(0)
        expect(world.townList()).toEqual(layout.towns)
        expect(world.industryList()).toEqual(layout.industries)
        for (const town of layout.towns) expect(world.town(town.id)).toBe(town)
        for (const industry of layout.industries) expect(world.industry(industry.id)).toBe(industry)
        expect(world.map).toBe(layout.map)
    })

    it('starts at tick 0 on 1 January of the start year with no companies, stations or vehicles', () => {
        const world = RtWorld.create(generateWorld(7, { side: 64 }), SETTINGS)
        expect(world.tick).toBe(0)
        expect(world.date).toEqual({ day: 1, month: 0, year: RT_CATALOG.time.startYear })
        expect(world.pathfinderCursor).toBe(0)
        expect(world.pathNodesLeft).toBe(RT_CATALOG.pathfinder.pathNodesPerTick)
        expect(world.companyList()).toEqual([])
        expect(world.stationList()).toEqual([])
        expect(world.vehicleList()).toEqual([])
        expect(world.dirtyTiles.size).toBe(0)
        expect('paused' in world).toBe(false)
        expect(world.scalars()).toEqual({ tick: 0, date: world.date, rngState: world.rng.state, pathfinderCursor: 0 })
    })

    it('creates identical worlds from one seed', () => {
        const a = RtWorld.create(generateWorld(99, { side: 64 }), SETTINGS)
        const b = RtWorld.create(generateWorld(99, { side: 64 }), SETTINGS)
        expect(a.scalars()).toEqual(b.scalars())
        expect(a.rng.next()).toBe(b.rng.next())
        expect(a.townList()).toEqual(b.townList())
    })

    it('keeps settings fixed, including sharing', () => {
        const world = RtWorld.create(generateWorld(5, { side: 64 }), { side: 64, maxCompanies: 4, sharing: false })
        expect(world.settings).toEqual({ side: 64, maxCompanies: 4, sharing: false })
        expect(Object.isFrozen(world.settings)).toBe(true)
    })

    it('refuses settings that do not fit the layout or the caps', () => {
        const layout = generateWorld(5, { side: 64 })
        expect(() => RtWorld.create(layout, { side: 128, maxCompanies: 8, sharing: true })).toThrow(RangeError)
        expect(() => RtWorld.create(layout, { side: 64, maxCompanies: 1, sharing: true })).toThrow(RangeError)
        expect(() => RtWorld.create(layout, { side: 64, maxCompanies: 9, sharing: true })).toThrow(RangeError)
    })

    it('satisfies the sharing rules\' view of a world', () => {
        const world = RtWorld.create(generateWorld(3, { side: 64 }), SETTINGS)
        world.insertCompany(company(0))
        world.insertCompany(company(1))
        const view: RtSharingWorld = world
        expect(chargeSharing(view, 0, 1, 10, 'rail')).toBe(true)
        expect(world.company(1)!.money).toBe(RT_CATALOG.economy.startMoney + 10)
    })
})

describe('RtWorld ids', () => {
    it('hands out the lowest free id and reuses a freed one', () => {
        const world = RtWorld.create(generateWorld(3, { side: 64 }), SETTINGS)
        for (let k = 0; k < 3; k++) {
            const id = world.freeVehicleId()
            expect(id).toBe(k)
            world.insertVehicle(vehicle(id, RtVehicleKind.road, RtVehicleState.driving, [], []))
        }
        world.removeVehicle(1)
        expect(world.vehicleList().map(v => v.id)).toEqual([0, 2])
        expect(world.freeVehicleId()).toBe(1)
        world.removeVehicle(2)
        expect(world.vehicles.length).toBe(1)
        expect(world.freeVehicleId()).toBe(1)
        expect(() => world.insertVehicle(vehicle(0, RtVehicleKind.road, RtVehicleState.driving, [], []))).toThrow(RangeError)
    })

    it('reports no free company id once the world has its maximum', () => {
        const world = RtWorld.create(generateWorld(3, { side: 64 }), { side: 64, maxCompanies: 2, sharing: true })
        world.insertCompany(company(world.freeCompanyId()))
        world.insertCompany(company(world.freeCompanyId()))
        expect(world.freeCompanyId()).toBe(RT_NONE)
        expect(rtLowestFreeId([null, 1, 2], 3)).toBe(0)
    })
})

describe('RtOccupiedRegistry', () => {
    it('keeps trains on pieces, depot occupants and road vehicles apart', () => {
        const reg = new RtOccupiedRegistry(64 * 64)
        reg.holdPiece(5, 100, 0)
        reg.holdPiece(2, 100, 0)
        reg.enterDepot(3, 200)
        reg.holdRoad(4, 300, 1)

        expect(reg.trainOnPiece(100, 0)).toBe(true)
        expect(reg.trainOnPiece(100, 1)).toBe(false)
        expect(reg.trainsOnPiece(100, 0)).toEqual([2, 5])
        expect(reg.otherTrainOnPiece(100, 0, 2)).toBe(5)
        expect(reg.otherTrainOnPiece(100, 1, 2)).toBe(RT_NONE)

        // trainOnPiece never sees depot occupants or road vehicles
        for (let piece = 0; piece < 6; piece++) {
            expect(reg.trainOnPiece(200, piece)).toBe(false)
            expect(reg.trainOnPiece(300, piece)).toBe(false)
        }
        // vehicleOnTile sees all three
        expect(reg.vehicleOnTile(100)).toBe(true)
        expect(reg.vehicleOnTile(200)).toBe(true)
        expect(reg.vehicleOnTile(300)).toBe(true)
        expect(reg.vehicleOnTile(400)).toBe(false)
        // level crossings see only road vehicles
        expect(reg.roadVehicleOnCrossing(300)).toBe(true)
        expect(reg.roadVehicleOnCrossing(100)).toBe(false)
        expect(reg.depotOccupants(200)).toEqual([3])
        expect(reg.roadVehiclesInLane(300, 1)).toEqual([4])

        expect(reg.releasePiece(5, 100, 0)).toBe(true)
        expect(reg.releasePiece(5, 100, 0)).toBe(false)
        expect(reg.releasePiece(2, 100, 0)).toBe(true)
        expect(reg.vehicleOnTile(100)).toBe(false)
        expect(reg.leaveDepot(3, 200)).toBe(true)
        expect(reg.releaseRoad(4, 300, 1)).toBe(true)
        expect(reg.roadVehicleOnCrossing(300)).toBe(false)
        expect(reg.canonical()).toBe('')
    })

    it('releases every holding of one vehicle', () => {
        const reg = new RtOccupiedRegistry(64 * 64)
        reg.holdPiece(1, 10, 0)
        reg.holdPiece(1, 11, 2)
        reg.holdPiece(2, 11, 2)
        expect(reg.releaseVehicle(1)).toBe(2)
        expect(reg.vehicleOnTile(10)).toBe(false)
        expect(reg.trainsOnPiece(11, 2)).toEqual([2])
        expect(reg.releaseVehicle(1)).toBe(0)
    })

    it('refuses an out-of-range tile, piece or lane', () => {
        const reg = new RtOccupiedRegistry(16)
        expect(() => reg.holdPiece(0, 16, 0)).toThrow(RangeError)
        expect(() => reg.holdPiece(0, 0, 6)).toThrow(RangeError)
        expect(() => reg.holdRoad(0, 0, 4)).toThrow(RangeError)
        expect(() => reg.vehicleOnTile(-1)).toThrow(RangeError)
    })

    it('rebuilds from vehicle state to match the incremental registry', () => {
        const world = RtWorld.create(generateWorld(11, { side: 64 }), SETTINGS)
        const trackdirPiece = (trackdir: number) => trackdir & 7
        const train = vehicle(0, RtVehicleKind.rail, RtVehicleState.driving, [500, 501], [8, 0])
        const parked = vehicle(1, RtVehicleKind.rail, RtVehicleState.inDepot, [700], [0])
        const bus = vehicle(2, RtVehicleKind.road, RtVehicleState.loading, [900], [3])
        for (const v of [train, parked, bus]) world.insertVehicle(v)
        world.occupied.holdPiece(0, 500, 0)
        world.occupied.holdPiece(0, 501, 0)
        world.occupied.enterDepot(1, 700)
        world.occupied.holdRoad(2, 900, 3)

        const rescan = new RtOccupiedRegistry(world.map.tileCount)
        rescan.rebuild(world.vehicles, trackdirPiece)
        expect(rescan.equals(world.occupied)).toBe(true)

        world.removeVehicle(2)
        expect(world.occupied.vehicleOnTile(900)).toBe(false)
        expect(rescan.equals(world.occupied)).toBe(false)
        rescan.rebuild(world.vehicles, trackdirPiece)
        expect(rescan.equals(world.occupied)).toBe(true)
    })
})

describe('RtWorld dirty tiles', () => {
    it('drains marked tiles in ascending order', () => {
        const world = RtWorld.create(generateWorld(2, { side: 64 }), SETTINGS)
        world.markDirty(30)
        world.markDirty(4)
        world.markDirty(30)
        expect(world.drainDirtyTiles()).toEqual([4, 30])
        expect(world.dirtyTiles.size).toBe(0)
    })
})

function station(id: number): RtStation {
    const packet = { cargo: 0, count: 12, sourceTile: 300, sourceStation: id, transitPeriods: 3, feederShare: 40 }
    return {
        id, owner: 0, name: 'Halt', town: 0, sign: 400, tiles: [400, 401], tilesRevision: 2, facilities: 1,
        cargo: RT_CARGO_IDS.map((_, c) => ({
            rating: 175, hasRating: true, loadAttempted: true, packets: c === 0 ? [packet] : [], fraction: 9,
            cyclesSincePickup: 4, maxWaiting: 12, lastSpeed: 60, lastAge: 1
        })),
        acceptance: 3, lastPickupTick: 10, lastDeliveryTick: 20, lastVehicleKind: 0,
        catchment: [399, 400, 401], catchmentRevision: 2
    }
}

/** A small world with every saved list and nested array non-empty, so every field can be mutated. */
function populated(seed = 21): RtWorld {
    const world = RtWorld.create(generateWorld(seed, { side: 64 }), SETTINGS)
    world.addCompany('Alpha Rail')
    world.addCompany('Beta Lines')
    const first = world.company(0)!
    first.monthlyIncome.push({ income: 500, expenses: -300 })
    first.infrastructure.railPieces = 4
    world.insertStation(station(0))
    const train = vehicle(0, RtVehicleKind.rail, RtVehicleState.driving, [400, 401], [0, 0])
    train.consist = [0, 2]
    train.wagonCount = 1
    train.route = [0, 1, 0]
    train.orders = [{ kind: 0, target: 0, flags: 1 }]
    train.cargo = [{ cargo: 0, count: 5, sourceTile: 300, sourceStation: 0, transitPeriods: 1, feederShare: 0 }]
    world.insertVehicle(train)
    world.occupied.holdPiece(0, 400, 0)
    return world
}

const DERIVED = new Set(['infrastructure', 'catchment', 'catchmentRevision'])

type Holder = Record<string | number, unknown>

/** Calls visit for every primitive leaf, and once per array for a length change, under value. */
function eachLeaf(value: unknown, path: string[], visit: (holder: Holder, key: string | number, path: string[]) => void): void {
    if (Array.isArray(value)) {
        visit({ list: value }, 'list', [...path, '#length'])
        value.forEach((item, k) => {
            if (item !== null && typeof item === 'object') eachLeaf(item, [...path, String(k)], visit)
            else visit(value as unknown as Holder, k, [...path, String(k)])
        })
        return
    }
    for (const [key, item] of Object.entries(value as Holder)) {
        if (item !== null && typeof item === 'object') eachLeaf(item, [...path, key], visit)
        else visit(value as Holder, key, [...path, key])
    }
}

/** Mutates one leaf and returns how to undo it. */
function mutate(holder: Holder, key: string | number, path: string[]): () => void {
    const old = holder[key]
    if (path[path.length - 1] === '#length') {
        const list = old as unknown[]
        list.push(list.length > 0 && typeof list[0] === 'object' ? structuredClone(list[0]) : 0)
        return () => { list.pop() }
    }
    if (typeof old === 'number') holder[key] = old + 1
    else if (typeof old === 'boolean') holder[key] = !old
    else if (typeof old === 'string') holder[key] = old + 'x'
    else if (old === null) holder[key] = [1]
    else throw new Error(`unexpected leaf at ${path.join('.')}`)
    return () => { holder[key] = old }
}

/** The save bytes as a string to compare, or null when the mutated world breaks a save bound. */
function hashed(world: RtWorld): number | null {
    try {
        return world.hash()
    } catch (e) {
        if (e instanceof RangeError) return null
        throw e
    }
}

function saved(world: RtWorld): string | null {
    try {
        return encodeWorld(world).join(',')
    } catch (e) {
        if (e instanceof RangeError) return null
        throw e
    }
}

describe('RtWorld.hash', () => {
    it('is a u32, stable across calls, and equal for twin worlds', () => {
        const a = populated()
        const b = populated()
        const h = a.hash()
        expect(Number.isInteger(h)).toBe(true)
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThanOrEqual(0xffffffff)
        expect(a.hash()).toBe(h)
        expect(b.hash()).toBe(h)
        expect(populated(22).hash()).not.toBe(h)
    })

    it('changes exactly when the save changes: every saved entity field, never a derived one', () => {
        const world = populated()
        const base = world.hash()
        const baseBytes = saved(world)
        expect(baseBytes).not.toBeNull()
        const lists: [string, readonly unknown[]][] = [
            ['company', world.companyList()], ['town', world.townList()], ['industry', world.industryList()],
            ['station', world.stationList()], ['vehicle', world.vehicleList()]
        ]
        let checked = 0
        let againstSave = 0
        for (const [kind, entities] of lists) {
            expect(entities.length).toBeGreaterThan(0)
            eachLeaf(entities[0], [kind], (holder, key, path) => {
                const where = path.join('.')
                const undo = mutate(holder, key, path)
                const changed = hashed(world)
                const bytes = saved(world)
                undo()
                expect(world.hash(), `restored ${where}`).toBe(base)
                // a mutation that breaks a save bound fails the hash as it fails the save (only the
                // writer also range-checks each value)
                if (changed === null) expect(bytes, `save refuses ${where} as the hash does`).toBeNull()
                const derived = path.some(part => DERIVED.has(part))
                if (derived) expect(changed, `derived ${where}`).toBe(base)
                else if (changed !== null) expect(changed, `saved ${where}`).not.toBe(base)
                if (bytes !== null) {
                    expect(bytes !== baseBytes, `save and hash agree on ${where}`).toBe(!derived)
                    againstSave++
                }
                checked++
            })
        }
        expect(checked).toBeGreaterThan(100)
        expect(againstSave).toBeGreaterThan(100)
    })

    it('covers the map arrays, the scalars and the settings', () => {
        const world = populated()
        const base = world.hash()
        for (const array of [world.map.heights, world.map.kind, world.map.owner, world.map.payload]) {
            array[777] = array[777]! + 1
            expect(world.hash()).not.toBe(base)
            array[777] = array[777]! - 1
        }
        expect(world.hash()).toBe(base)

        const scalars: [string, () => void, () => void][] = [
            ['tick', () => { world.tick++ }, () => { world.tick-- }],
            ['day', () => { world.date.day++ }, () => { world.date.day-- }],
            ['month', () => { world.date.month++ }, () => { world.date.month-- }],
            ['year', () => { world.date.year++ }, () => { world.date.year-- }],
            ['pathfinderCursor', () => { world.pathfinderCursor++ }, () => { world.pathfinderCursor-- }]
        ]
        for (const [name, change, undo] of scalars) {
            change()
            expect(world.hash(), name).not.toBe(base)
            undo()
        }
        const rngState = world.rng.state
        world.rng.next()
        expect(world.hash()).not.toBe(base)
        world.rng.state = rngState
        expect(world.hash()).toBe(base)

        const shared = RtWorld.create(generateWorld(21, { side: 64 }), SETTINGS).hash()
        const apart = RtWorld.create(generateWorld(21, { side: 64 }), { ...SETTINGS, sharing: false }).hash()
        const fewer = RtWorld.create(generateWorld(21, { side: 64 }), { ...SETTINGS, maxCompanies: 4 }).hash()
        expect(apart).not.toBe(shared)
        expect(fewer).not.toBe(shared)
    })

    it('covers the pathfinder cursor, lost-retry tick and road blocked counter', () => {
        const world = populated()
        const base = world.hash()
        const train = world.vehicle(0)!
        train.lostRetryTick = 74
        expect(world.hash()).not.toBe(base)
        train.lostRetryTick = 0
        train.blockedTicks = 1
        expect(world.hash()).not.toBe(base)
        train.blockedTicks = 0
        world.pathfinderCursor = 1
        expect(world.hash()).not.toBe(base)
    })

    it('ignores derived state: the occupied registry, dirty tiles and the node budget', () => {
        const world = populated()
        const base = world.hash()
        world.occupied.holdRoad(9, 1000, 2)
        world.occupied.enterDepot(8, 1200)
        world.markDirty(5)
        world.pathNodesLeft = 3
        expect(world.hash()).toBe(base)
    })

    it('tells entity ids and list membership apart', () => {
        const a = populated()
        const b = populated()
        const moved = b.removeVehicle(0)!
        moved.id = 1
        b.insertVehicle(moved)
        expect(b.hash()).not.toBe(a.hash())
        b.removeVehicle(1)
        expect(b.hash()).not.toBe(a.hash())
    })

    it('hashes -0 like 0, as the save writes both alike', () => {
        const a = populated()
        const b = populated()
        a.company(0)!.money = 0
        b.company(0)!.money = -0
        expect(Object.is(b.company(0)!.money, -0)).toBe(true)
        expect(b.hash()).toBe(a.hash())
    })

    it('hashes exactly what a save holds after its header, settings and map first, in one fixed order', () => {
        const record = (out: string[]): RtSaveSink => ({
            u8: () => { out.push('u8') },
            u16: () => { out.push('u16') },
            u32: () => { out.push('u32') },
            varint: value => {
                if (value < 0) throw new RangeError(`negative varint ${value}`)
                out.push('v')
            },
            svarint: () => { out.push('s') },
            bytes: () => { out.push('bytes') },
            str: () => { out.push('str') }
        })
        const world = populated()
        const train = world.vehicle(0)!
        train.loadingStation = RT_NONE
        train.serviceDepot = RT_NONE
        train.cargo[0]!.sourceStation = RT_NONE
        train.orders[0]!.target = RT_NONE
        world.station(0)!.town = RT_NONE
        const calls: string[] = []
        rtWriteSavedState(record(calls), world)
        expect(calls.slice(0, 5)).toEqual(['u16', 'u8', 'u8', 'v', 'bytes'])
        const again: string[] = []
        rtWriteSavedState(record(again), world)
        expect(again).toEqual(calls)
        const w = new RtWriter()
        rtWriteSavedState(w, world)
        expect(w.finish()).toEqual(encodeWorld(world).subarray(RT_SAVE_MAGIC.length + 2))
        expect(RT_FINANCE_KEYS).toEqual(Object.keys(rtEmptyFinance()))
    })
})

describe('RtWorld.addCompany', () => {
    it('founds companies under the lowest free id with start money, the start loan and the first unused colour', () => {
        const world = RtWorld.create(generateWorld(8, { side: 64 }), SETTINGS)
        world.tick = 1234
        const rngState = world.rng.state
        expect(world.addCompany('Alpha')).toBe(0)
        expect(world.addCompany('Beta')).toBe(1)
        const alpha = world.company(0)!
        expect(alpha.name).toBe('Alpha')
        expect(alpha.money).toBe(RT_CATALOG.economy.startMoney)
        expect(alpha.loan).toBe(RT_CATALOG.economy.startLoan)
        expect(alpha.money).toBe(100000)
        expect(alpha.loan).toBe(100000)
        expect(alpha.bankruptMonths).toBe(0)
        expect(alpha.foundedTick).toBe(1234)
        expect(alpha.financeThisYear).toEqual(rtEmptyFinance())
        expect(alpha.financeLastYear).toEqual(rtEmptyFinance())
        expect(alpha.monthIncome).toBe(0)
        expect(alpha.monthExpenses).toBe(0)
        expect(alpha.monthlyIncome).toEqual([])
        expect(alpha.infrastructure).toEqual({ railPieces: 0, roadPieces: 0, signals: 0, stationTiles: 0, depots: 0 })
        expect(world.companyList().map(c => c.colour)).toEqual([0, 1])
        expect(world.rng.state).toBe(rngState)
    })

    it('refuses a ninth company in an eight-company world without changing anything', () => {
        const world = RtWorld.create(generateWorld(8, { side: 64 }), SETTINGS)
        for (let k = 0; k < 8; k++) expect(world.addCompany(`Company ${k}`)).toBe(k)
        const before = world.hash()
        expect(world.addCompany('Ninth')).toBeNull()
        expect(world.companyList()).toHaveLength(8)
        expect(world.hash()).toBe(before)

        const small = RtWorld.create(generateWorld(8, { side: 64 }), { ...SETTINGS, maxCompanies: 2 })
        expect(small.addCompany('A')).toBe(0)
        expect(small.addCompany('B')).toBe(1)
        expect(small.addCompany('C')).toBeNull()
    })

    it('reuses a freed id and its colour', () => {
        const world = RtWorld.create(generateWorld(8, { side: 64 }), SETTINGS)
        for (let k = 0; k < 3; k++) world.addCompany(`C${k}`)
        world.companies[1] = null
        expect(world.addCompany('Again')).toBe(1)
        expect(world.company(1)!.colour).toBe(1)
    })

    it('uses a preferred colour only when it is a valid unused index', () => {
        const world = RtWorld.create(generateWorld(8, { side: 64 }), SETTINGS)
        expect(world.addCompany('A', 5)).toBe(0)
        expect(world.company(0)!.colour).toBe(5)
        expect(world.addCompany('B', 5)).toBe(1)
        expect(world.company(1)!.colour).toBe(0)
        for (const bad of [-1, 16, 2.5, Number.NaN, '3', null]) world.addCompany('X', bad)
        expect(world.companyList().map(c => c.colour)).toEqual([5, 0, 1, 2, 3, 4, 6, 7])
    })

    it('clamps a long accented or emoji name to maxNameBytes so the save can always decode it', () => {
        const world = RtWorld.create(generateWorld(8, { side: 64 }), SETTINGS)
        const name = 'Société Ferroviaire 🚂🚃🚃🚃 Ëxpress'
        expect(name.length).toBeGreaterThanOrEqual(30)
        const id = world.addCompany(name)!
        const stored = world.company(id)!.name
        expect(new TextEncoder().encode(stored).length).toBeLessThanOrEqual(RT_CATALOG.caps.maxNameBytes)
        expect(name.startsWith(stored)).toBe(true)
        const writer = new RtWriter()
        writer.str(stored)
        expect(new RtReader(writer.finish()).str(RT_CATALOG.caps.maxNameBytes)).toBe(stored)
        expect(saved(world)).not.toBeNull()
    })

    it('cleans hostile names without throwing', () => {
        const world = RtWorld.create(generateWorld(8, { side: 64 }), SETTINGS)
        expect(world.company(world.addCompany(undefined)!)!.name).toBe('Company 1')
        expect(world.company(world.addCompany(42)!)!.name).toBe('Company 2')
        expect(world.company(world.addCompany('   \t\n ')!)!.name).toBe('Company 3')
        expect(world.company(world.addCompany('  Ev\u0000il\u001b \u0085Co  ')!)!.name).toBe('Evil Co')
        expect(rtCleanCompanyName('a\ud800b')).toBe('a�b')
        expect(rtCleanCompanyName('x'.repeat(100000))).toBe('x'.repeat(RT_CATALOG.caps.maxNameBytes))
        expect(rtCleanCompanyName(' '.repeat(5000) + 'Late')).toBe('Late')
        expect(saved(world)).not.toBeNull()
    })

    it('drops invisible characters and refuses a name that only looks different from another company\'s', () => {
        expect(rtCleanCompanyName('Big​Bridge⁦  　 Rail﻿')).toBe('BigBridge Rail')
        // Greek omicron, Cyrillic a, a zero-width space, another case and spacing, 0 for o, I for l
        for (const lookalike of ['Gοod Rail', 'Good Rаil', 'Go​od Rail', 'GOOD  rail', 'goodrail', 'G00d RaiI']) {
            const world = RtWorld.create(generateWorld(8, { side: 64 }), SETTINGS)
            const mine = world.addCompany('Good Rail')!
            const rival = world.addCompany(lookalike)!
            expect(world.company(rival)!.name).toBe(`Company ${rival + 1}`)
            expect(applyCommand(world, rival, { kind: RtCommandKind.renameCompany, name: lookalike }, false))
                .toMatchObject({ ok: false, error: RtCommandError.conflict })
            expect(world.company(mine)!.name).toBe('Good Rail')
        }
        expect(rtNameSkeleton('Modern Rail')).toBe(rtNameSkeleton('Modem Rail'))
        const world = RtWorld.create(generateWorld(8, { side: 64 }), SETTINGS)
        world.addCompany('Good Rail')
        const other = world.addCompany('Gold Rail')!
        expect(world.company(other)!.name).toBe('Gold Rail')
        expect(applyCommand(world, other, { kind: RtCommandKind.renameCompany, name: 'Great Rail' }, false).ok).toBe(true)
    })

    it('keeps twin worlds hashing equal and tells a different join apart', () => {
        const a = RtWorld.create(generateWorld(8, { side: 64 }), SETTINGS)
        const b = RtWorld.create(generateWorld(8, { side: 64 }), SETTINGS)
        const before = a.hash()
        a.addCompany('Same')
        b.addCompany('Same')
        expect(a.hash()).toBe(b.hash())
        expect(a.hash()).not.toBe(before)
        const c = RtWorld.create(generateWorld(8, { side: 64 }), SETTINGS)
        c.addCompany('Other')
        expect(c.hash()).not.toBe(a.hash())
    })
})

describe('RtWorld.resetCompany', () => {
    const [ME, RIVAL] = [0, 1]
    const K = RtCommandKind
    const EAST = rtTrackdirOf(RtTrack.x, true)

    function built() {
        const w = RtWorld.empty({ side: 64, maxCompanies: 8, sharing: true }, {
            rngState: 3, tick: 900, companies: [rtNewCompany(ME, 'Doomed', 2, 0), rtNewCompany(RIVAL, 'Rival', 5, 0)]
        })
        for (const c of w.companyList()) c.money = 10_000_000
        const at = (x: number, y: number) => w.map.idx(x, y)
        const must = (owner: number, command: RtCommand) => {
            const result = applyCommand(w, owner, command, true)
            if (!result.ok) throw new Error(`command ${command.kind} refused (${result.error})`)
            return result
        }
        // ME: a line y = 10 with a station, a depot, a signal and a siding-free spur; a road y = 20 with a bus stop
        must(ME, { kind: K.buildRailLine, tile: at(6, 10), endTile: at(40, 10), trackdir: EAST })
        must(ME, { kind: K.buildRailStation, tile: at(20, 12), axis: RtAxis.x, tracks: 1, length: 3 })
        must(ME, { kind: K.buildDepot, tile: at(5, 10), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        must(ME, { kind: K.placeSignal, tile: at(30, 10), piece: RtTrack.x, signalType: 0 })
        must(ME, { kind: K.buildRoadLine, tile: at(4, 20), endTile: at(40, 20) })
        must(ME, { kind: K.buildRoadStop, tile: at(15, 20), stop: RtStationTile.bus })
        must(ME, { kind: K.buildDepot, tile: at(3, 20), vehicleKind: RtVehicleKind.road, facing: RtDir.sw })
        // RIVAL: a road y = 30 crossed by ME's rail at (25, 30); RIVAL's rail crossing ME's road at (30, 20)
        must(RIVAL, { kind: K.buildRoadLine, tile: at(20, 30), endTile: at(30, 30) })
        must(ME, { kind: K.buildRailLine, tile: at(25, 28), endTile: at(25, 32), trackdir: rtTrackdirOf(RtTrack.y, false) })
        must(RIVAL, { kind: K.buildRailLine, tile: at(30, 18), endTile: at(30, 22), trackdir: rtTrackdirOf(RtTrack.y, false) })
        // ME's stop on a town road; a rival stop on the rival's own road
        w.map.setTile(at(45, 30), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_X)
        must(ME, { kind: K.buildRoadStop, tile: at(45, 30), stop: RtStationTile.bus })
        must(RIVAL, { kind: K.buildRoadStop, tile: at(27, 30), stop: RtStationTile.bus })
        return { w, at, must }
    }

    it('clears every tile it owned, keeps its roads unowned and restarts the company with its name and colour', () => {
        const { w, at, must } = built()
        must(ME, { kind: K.buyVehicle, depot: at(5, 10), model: RT_CATALOG.vehicles.models.expressEngine.index, wagons: [] })
        w.company(ME)!.money = -5
        w.company(ME)!.bankruptMonths = 3
        expect(w.resetCompany(ME)).toBe(true)
        for (let t = 0; t < 64 * 64; t++) expect(w.map.owner[t]).not.toBe(ME)
        expect(w.vehicleList().filter(v => v.owner === ME)).toEqual([])
        expect(w.stationList().map(s => s.owner)).toEqual([RIVAL])
        for (let x = 4; x <= 40; x++) {
            if (x === 30) continue
            expect(w.map.kind[at(x, 20)]).toBe(RtTileKind.road)
            expect(w.map.owner[at(x, 20)]).toBe(RT_OWNER_NONE)
        }
        // its own stop on its own road is unowned road with the stop's bits
        expect(w.map.payload[at(15, 20)]).toBe(RT_ROAD_X)
        for (const x of [6, 20, 40]) expect(w.map.kind[at(x, 10)]).toBe(RtTileKind.clear)
        expect(w.map.kind[at(5, 10)]).toBe(RtTileKind.clear)
        const restarted = w.company(ME)!
        expect([restarted.name, restarted.colour, restarted.money, restarted.loan, restarted.bankruptMonths, restarted.foundedTick])
            .toEqual(['Doomed', 2, RT_CATALOG.economy.startMoney, RT_CATALOG.economy.startLoan, 0, 900])
        expect(decodeWorldOrThrow(encodeWorld(w)).hash()).toBe(w.hash())
    })

    it('its crossings become road of the road owner; a rival crossing on its road keeps the rail', () => {
        const { w, at } = built()
        w.resetCompany(ME)
        // ME's rail over the rival's road: plain rival road
        expect([w.map.kind[at(25, 30)], w.map.owner[at(25, 30)], w.map.payload[at(25, 30)]]).toEqual([RtTileKind.road, RIVAL, RT_ROAD_X])
        // ME's stop on a town road: town road again
        expect([w.map.kind[at(45, 30)], w.map.owner[at(45, 30)], w.map.payload[at(45, 30)]]).toEqual([RtTileKind.road, RT_OWNER_NONE, RT_ROAD_X])
        // the rival's rail over ME's road: still the rival's crossing, the road part unowned
        const crossing = at(30, 20)
        expect([w.map.kind[crossing], w.map.owner[crossing]]).toEqual([RtTileKind.rail, RIVAL])
        expect(rtIsCrossing(w.map.payload[crossing]!)).toBe(true)
        expect(rtCrossingRoadOwner(w.map.payload[crossing]!)).toBe(RT_OWNER_NONE)
        // the rival's own stop is untouched
        expect([w.map.owner[at(27, 30)], rtRoadStopRoadOwner(w.map.payload[at(27, 30)]!)]).toEqual([RIVAL, RIVAL])
    })

    it('a rival train on its track is deleted and its owner refunded; rival orders to its stations and depots go', () => {
        const { w, at, must } = built()
        must(RIVAL, { kind: K.buildDepot, tile: at(41, 10), vehicleKind: RtVehicleKind.rail, facing: RtDir.ne })
        const train = w.vehicle(must(RIVAL, { kind: K.buyVehicle, depot: at(41, 10), model: RT_CATALOG.vehicles.models.expressEngine.index, wagons: [] }).id!)!
        must(RIVAL, { kind: K.startStop, vehicle: train.id, stopped: false })
        for (let t = 0; t < 600 && !(train.state === RtVehicleState.driving && w.map.owner[train.tiles[0]!] === ME); t++) {
            w.tick++
            w.pathNodesLeft = RT_CATALOG.pathfinder.pathNodesPerTick
            stepTrain(w, train)
        }
        expect(w.map.owner[train.tiles[0]!]).toBe(ME)
        const bus = w.vehicle(must(RIVAL, { kind: K.buildDepot, tile: at(19, 31), vehicleKind: RtVehicleKind.road, facing: RtDir.nw }) && must(RIVAL, {
            kind: K.buyVehicle, depot: at(19, 31), model: RT_CATALOG.vehicles.models.townBus.index, wagons: []
        }).id!)!
        const station = w.stationList().find(s => s.owner === RIVAL)!
        const mine = w.stationList().find(s => s.owner === ME && s.tiles.includes(at(45, 30)))!
        must(RIVAL, { kind: K.setOrders, vehicle: bus.id, orders: [{ kind: RtOrderKind.gotoStation, target: mine.id, flags: 0 }, { kind: RtOrderKind.gotoStation, target: station.id, flags: 0 }] })
        station.cargo[0]!.packets.push({ cargo: 0, count: 5, sourceTile: at(45, 30), sourceStation: mine.id, transitPeriods: 0, feederShare: 0 })
        const refund = rtVehicleSellValue(train)
        const money = w.company(RIVAL)!.money
        w.resetCompany(ME)
        expect(w.vehicle(train.id)).toBeUndefined()
        expect(w.company(RIVAL)!.money).toBe(money + refund)
        expect(bus.orders.map(o => o.target)).toEqual([station.id])
        expect(station.cargo[0]!.packets[0]!.sourceStation).toBe(RT_NONE)
        for (let t = 0; t < 64 * 64; t++) expect(w.map.kind[t] === RtTileKind.rail && rtRailPieceReserved(w.map.payload[t]!, 0)).toBe(false)
    })

    it('after the reset the same company id builds rail and buys a vehicle', () => {
        const { w, at, must } = built()
        w.resetCompany(ME)
        must(ME, { kind: K.buildRailLine, tile: at(6, 40), endTile: at(20, 40), trackdir: EAST })
        must(ME, { kind: K.buildDepot, tile: at(5, 40), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        must(ME, { kind: K.buyVehicle, depot: at(5, 40), model: RT_CATALOG.vehicles.models.expressEngine.index, wagons: [] })
        expect(w.vehicleList().filter(v => v.owner === ME).length).toBe(1)
        expect(w.resetCompany(7)).toBe(false)
    })
})

/* ------------------------------------------------------------------------------------------
 * The world stepping as a whole. Commands are stamped with a tick and applied before that
 * tick's step, as the room does.
 * ---------------------------------------------------------------------------------------- */

type Stamped = [tick: number, company: number, command: RtCommand]

/** Steps `ticks` ticks, applying every command stamped for a tick (encoded and decoded, as on the wire) just before it. */
function play(w: RtWorld, script: readonly Stamped[], ticks: number, each?: (applied: boolean) => void): void {
    for (let k = 0; k < ticks; k++) {
        const next = w.tick + 1
        let applied = false
        for (const [tick, company, command] of script) {
            if (tick !== next) continue
            const result = applyCommand(w, company, decodeCommand(encodeCommand(command), w.map.side)!, true)
            if (!result.ok) throw new Error(`tick ${next}: command ${command.kind} refused (${result.error}, ${result.detail})`)
            applied = true
        }
        w.step()
        each?.(applied)
    }
}

/** The first row stretch of `length` flat tiles holding only clear land or trees, scanning rows from the top. */
function flatStretch(w: RtWorld, length: number): [number, number] {
    const map = w.map
    for (let y = 4; y < map.side - 4; y++) {
        let run = 0
        for (let x = 1; x < map.side - 1; x++) {
            const tile = map.idx(x, y)
            const free = (map.kind[tile] === RtTileKind.clear || map.kind[tile] === RtTileKind.tree) && map.isFlat(tile)
            run = free ? run + 1 : 0
            if (run === length) return [x - length + 1, y]
        }
    }
    throw new Error('no flat stretch')
}

/** A shuttle on a stretch from (x, y): a depot, a three-tile station at each end, a train between them. */
function shuttleScript(w: RtWorld, owner: number, x: number, y: number, length: number, from: number): Stamped[] {
    const K = RtCommandKind
    const at = (dx: number) => w.map.idx(x + dx, y)
    const east = rtTrackdirOf(RtTrack.x, true)
    const M = RT_CATALOG.vehicles.models
    // station ids are the lowest free ones, in build order
    const first = w.freeStationId()
    return [
        [from, owner, { kind: K.buildDepot, tile: at(0), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw }],
        [from, owner, { kind: K.buildRailStation, tile: at(1), axis: RtAxis.x, tracks: 1, length: 3 }],
        [from + 1, owner, { kind: K.buildRailStation, tile: at(length - 3), axis: RtAxis.x, tracks: 1, length: 3 }],
        [from + 1, owner, { kind: K.buildRailLine, tile: at(4), endTile: at(length - 4), trackdir: east }],
        [from + 2, owner, { kind: K.buyVehicle, depot: at(0), model: M.expressEngine.index, wagons: [M.passengerCoach.index, M.passengerCoach.index] }],
        [from + 3, owner, { kind: K.setOrders, vehicle: w.freeVehicleId(), orders: [
            { kind: RtOrderKind.gotoStation, target: first, flags: 0 },
            { kind: RtOrderKind.gotoStation, target: first + 1, flags: 0 }
        ] }],
        [from + 3, owner, { kind: K.startStop, vehicle: w.freeVehicleId(), stopped: false }]
    ]
}

/** Whether the incrementally kept state equals a full rebuild: a decoded copy rebuilds all of it. */
function expectMatchesRescan(w: RtWorld): void {
    const copy = decodeWorldOrThrow(encodeWorld(w))
    for (const company of w.companyList()) expect(company.infrastructure).toEqual(copy.company(company.id)!.infrastructure)
    expect(w.occupied.equals(copy.occupied)).toBe(true)
    for (let tile = 0; tile < w.map.side * w.map.side; tile++) {
        expect(stationsAround(w, tile).map(s => s.id)).toEqual(stationsAround(copy, tile).map(s => s.id))
    }
    // every reserved piece is held by a train or lies on a train's reservation ahead
    const owned = new Set<number>()
    for (const v of w.vehicleList()) {
        if (v.kind !== RtVehicleKind.rail || v.state === RtVehicleState.inDepot) continue
        for (let k = 0; k < v.tiles.length; k++) owned.add(v.tiles[k]! * 8 + (v.pieces[k]! & 7))
        const ahead = rtReservedAhead(w.map, v)
        for (let k = 0; k < ahead.tiles.length; k++) owned.add(ahead.tiles[k]! * 8 + (ahead.trackdirs[k]! & 7))
    }
    for (let tile = 0; tile < w.map.side * w.map.side; tile++) {
        for (let piece = 0; piece < 6; piece++) if (rtPieceReserved(w.map, tile, piece)) expect(owned.has(tile * 8 + piece)).toBe(true)
    }
}

describe('RtWorld.step', () => {
    const settings = { side: 64, maxCompanies: 8, sharing: false }

    it('twin worlds from one seed fed the same commands hash equal after 20000 ticks; one command a tick late splits them', () => {
        const make = () => RtWorld.create(generateWorld(99, { side: 64 }), settings)
        const probe = make()
        // the generated island is rough: its widest flat run is about 14 tiles
        const [x, y] = flatStretch(probe, 14)
        const script: Stamped[] = [
            [5, RT_SERVER_COMPANY, { kind: RtCommandKind.foundCompany, name: 'One', colour: 1 }],
            [6, RT_SERVER_COMPANY, { kind: RtCommandKind.foundCompany, name: 'Two', colour: 2 }],
            ...shuttleScript(probe, 0, x, y, 14, 10)
        ]
        const [a, b] = [make(), make()]
        play(a, script, 20000)
        play(b, script, 20000)
        expect(a.hash()).toBe(b.hash())
        expect(a.vehicleList().length).toBe(1)
        expect(a.vehicleList()[0]!.state).not.toBe(RtVehicleState.inDepot)
        const late = make()
        play(late, script.map(([tick, company, command]): Stamped => [command.kind === RtCommandKind.startStop ? tick + 1 : tick, company, command]), 20000)
        expect(late.hash()).not.toBe(a.hash())
    })

    it('a scripted network earns once its train has made two round trips; after every command the kept state matches a rescan; no tick overspends its search budget', () => {
        const w = RtWorld.empty({ side: 64, maxCompanies: 8, sharing: false }, { rngState: 11 })
        // houses round both ends, so passengers come and go. Houses hand cargo only to a station a train
        // has called at, so the first round trip runs empty: the line is short enough for a second one
        for (const [cx, cy] of [[6, 13], [22, 13]]) {
            w.towns.push({
                id: w.towns.length, name: `Town ${w.towns.length}`, centre: w.map.idx(cx, cy), houseCount: 6, population: 300, growthCounter: 0,
                growthRate: 0, growing: false, activeStations: 0, receivedThisMonth: RT_CARGO_IDS.map(() => 0), receivedLastMonth: RT_CARGO_IDS.map(() => 0)
            })
            for (let dx = -2; dx <= 3; dx++) w.map.setTile(w.map.idx(cx + dx, cy), RtTileKind.house, RT_OWNER_NONE, 2)
        }
        const script: Stamped[] = [
            [1, RT_SERVER_COMPANY, { kind: RtCommandKind.foundCompany, name: 'Earner', colour: 3 }],
            ...shuttleScript(w, 0, 4, 10, 20, 2)
        ]
        const budget = w.pathNodesPerTick
        const checkStep = (applied: boolean) => {
            if (applied) expectMatchesRescan(w)
            expect(w.pathNodesLeft).toBeGreaterThanOrEqual(0)
            expect(budget - w.pathNodesLeft).toBeLessThanOrEqual(budget)
        }
        play(w, script, 10, checkStep)
        // the first round trip runs empty, so income follows the second; four station calls make two round trips
        const train = w.vehicleList()[0]!
        let calls = 0
        let order = train.orderIndex
        for (let tick = 0; calls < 4; tick++) {
            if (tick > RT_CATALOG.time.dayTicks * 365) throw new Error(`the train made ${calls} station calls in a year`)
            play(w, [], 1, checkStep)
            if (train.orderIndex !== order) {
                order = train.orderIndex
                calls++
            }
        }
        expect(w.company(0)!.financeThisYear.trainIncome).toBeGreaterThan(0)
        expectMatchesRescan(w)
    })

    it('refuses a ninth company', () => {
        const w = RtWorld.create(generateWorld(5, { side: 64 }), settings)
        for (let k = 0; k < 8; k++) expect(applyCommand(w, RT_SERVER_COMPANY, { kind: RtCommandKind.foundCompany, name: `C${k}`, colour: k }, true).ok).toBe(true)
        expect(applyCommand(w, RT_SERVER_COMPANY, { kind: RtCommandKind.foundCompany, name: 'Ninth', colour: 0 }, true))
            .toEqual({ ok: false, error: RtCommandError.limit })
        expect(w.companyList().length).toBe(8)
    })

    it('after a company reset another company\'s bus on its former road keeps running and arrives', () => {
        const w = RtWorld.empty({ side: 64, maxCompanies: 8, sharing: false }, {
            rngState: 4, companies: [rtNewCompany(0, 'Roads', 0, 0), rtNewCompany(1, 'Buses', 1, 0)]
        })
        const at = (x: number) => w.map.idx(x, 20)
        // town road at both ends, company 0's road between
        for (const x of [4, 5, 6, 7, 34, 35, 36, 37]) w.map.setTile(at(x), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_X)
        const must = (company: number, command: RtCommand) => {
            const result = applyCommand(w, company, command, true)
            if (!result.ok) throw new Error(`command ${command.kind} refused (${result.error})`)
            return result
        }
        must(0, { kind: RtCommandKind.buildRoadLine, tile: at(8), endTile: at(33) })
        const a = must(1, { kind: RtCommandKind.buildRoadStop, tile: at(5), stop: RtStationTile.bus }).id!
        const b = must(1, { kind: RtCommandKind.buildRoadStop, tile: at(36), stop: RtStationTile.bus }).id!
        must(1, { kind: RtCommandKind.buildDepot, tile: at(3), vehicleKind: RtVehicleKind.road, facing: RtDir.sw })
        const bus = w.vehicle(must(1, { kind: RtCommandKind.buyVehicle, depot: at(3), model: RT_CATALOG.vehicles.models.townBus.index, wagons: [] }).id!)!
        must(1, { kind: RtCommandKind.setOrders, vehicle: bus.id, orders: [{ kind: RtOrderKind.gotoStation, target: a, flags: 0 }, { kind: RtOrderKind.gotoStation, target: b, flags: 0 }] })
        must(1, { kind: RtCommandKind.startStop, vehicle: bus.id, stopped: false })
        for (let k = 0; k < 3000 && !(bus.state === RtVehicleState.driving && w.map.tileX(bus.tiles[0]!) > 15); k++) w.step()
        expect(w.map.tileX(bus.tiles[0]!)).toBeGreaterThan(15)
        w.resetCompany(0)
        expect(w.map.owner[at(20)]).toBe(RT_OWNER_NONE)
        let arrived = false
        for (let k = 0; k < 3000 && !arrived; k++) {
            w.step()
            arrived = bus.state === RtVehicleState.loading && bus.loadingStation === b
        }
        expect(arrived).toBe(true)
    })

    it('across 1 January every company rolls this year into last year and every vehicle its profit', () => {
        const w = RtWorld.empty({ side: 64, maxCompanies: 8, sharing: false }, {
            rngState: 4, tick: 74 * 1000, date: { day: 31, month: 11, year: 1955 },
            companies: [rtNewCompany(0, 'Roller', 0, 0), rtNewCompany(1, 'Other', 1, 0)]
        })
        applyCommand(w, 0, { kind: RtCommandKind.buildDepot, tile: w.map.idx(5, 5), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw }, true)
        const v = w.vehicle(applyCommand(w, 0, { kind: RtCommandKind.buyVehicle, depot: w.map.idx(5, 5), model: 0, wagons: [] }, true) as unknown as number)
            ?? w.vehicleList()[0]!
        v.profitThisYear = 1234
        for (const c of w.companyList()) c.financeThisYear.trainIncome = 500 + c.id
        // step up to the last tick of the year
        while ((w.tick + 1) % RT_CATALOG.time.dayTicks !== 0) w.step()
        const before = w.companyList().map(c => ({ ...c.financeThisYear }))
        const upkeep = w.companyList().map(c => {
            rtRecountInfrastructure(w)
            return { property: infrastructureUpkeep(c.infrastructure), interest: monthlyInterest(c, 11) }
        })
        w.step()
        expect(w.date).toEqual({ day: 1, month: 0, year: 1956 })
        for (const c of w.companyList()) {
            const was = before[c.id]!
            expect(c.financeLastYear).toEqual({
                ...was,
                property: was.property - upkeep[c.id]!.property,
                loanInterest: was.loanInterest - upkeep[c.id]!.interest,
                other: was.other - RT_CATALOG.economy.monthlyOtherCost
            })
            expect(Object.values(c.financeThisYear).every(value => value === 0)).toBe(true)
        }
        expect(v.profitLastYear).toBe(1234)
        expect(v.profitThisYear).toBe(0)
    })
})
