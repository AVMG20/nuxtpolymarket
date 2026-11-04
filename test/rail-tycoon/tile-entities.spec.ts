import { describe, expect, it } from 'vitest'
import { RT_CARGO_IDS, RT_CATALOG, RT_INDUSTRY_TYPE_IDS } from '#shared/utils/rail-tycoon/catalog'
import { rtEmptyFinance } from '#shared/utils/rail-tycoon/economy'
import { industryTick } from '#shared/utils/rail-tycoon/industries'
import { RtTileKind } from '#shared/utils/rail-tycoon/map'
import { decodeWorld, encodeWorld } from '#shared/utils/rail-tycoon/save'
import { rtStationTick } from '#shared/utils/rail-tycoon/stations'
import {
    RT_INDUSTRY_TILE_ENTITY,
    RT_STATION_TILE_ENTITY,
    RT_TILE_ENTITY_KINDS,
    rtHasTileEntity,
    rtTickTileEntities,
    rtTileEntityMismatch
} from '#shared/utils/rail-tycoon/tile-entities'
import { RT_NONE } from '#shared/utils/rail-tycoon/types'
import { RtWorld } from '#shared/utils/rail-tycoon/world'
import { generateWorld } from '#shared/utils/rail-tycoon/worldgen'
import { insertStationWithTiles } from './fixtures/tile-entities'

/**
 * A generated world with a one-tile station beside every industry, cargo waiting and rated. Station ids
 * are offset from their industry's, so an industry's production cycle and its station's rating cycle
 * fall on the same tick within the run, where the order of the two ticks shows.
 */
function servedWorld(): RtWorld {
    const side = 64
    const world = RtWorld.create(generateWorld(9090, { side }), { side, maxCompanies: 4, sharing: false })
    world.insertCompany({
        id: 0, name: 'Served', colour: 0, money: 1e9, loan: 0, bankruptMonths: 0, foundedTick: 0,
        infrastructure: { railPieces: 0, roadPieces: 0, signals: 0, stationTiles: 0, depots: 0 },
        financeThisYear: rtEmptyFinance(), financeLastYear: rtEmptyFinance(), monthIncome: 0, monthExpenses: 0, monthlyIncome: []
    })
    let id = 3
    for (const industry of world.industryList()) {
        const spec = RT_CATALOG.industries[RT_INDUSTRY_TYPE_IDS[industry.type]!]
        const tile = industry.origin + spec.width
        if (rtHasTileEntity(world.map.kind[tile]!)) continue
        insertStationWithTiles(world, {
            id, owner: 0, name: `S${id}`, town: RT_NONE, sign: tile, tiles: [tile], tilesRevision: 1, facilities: 1,
            cargo: RT_CARGO_IDS.map(() => ({
                rating: 120, hasRating: true, loadAttempted: true,
                packets: [{ cargo: 0, count: 900, sourceTile: tile, sourceStation: id, transitPeriods: 3, feederShare: 0 }],
                fraction: 0, cyclesSincePickup: 0, maxWaiting: 0, lastSpeed: 0, lastAge: 0
            })),
            acceptance: 0, lastPickupTick: RT_NONE, lastDeliveryTick: RT_NONE, lastVehicleKind: RT_NONE,
            catchment: null, catchmentRevision: 0
        })
        id += 7
    }
    return world
}

/** Steps a world the way RtWorld.step did before the registry: every industry, then every station. */
function stepByHand(world: RtWorld, ticks: number): void {
    for (let n = 0; n < ticks; n++) {
        world.tick++
        for (const industry of world.industryList()) industryTick(world, industry, world.rng, world.tick)
        for (const station of world.stationList()) rtStationTick(world, station, world.rng, world.tick)
    }
}

function stepRegistry(world: RtWorld, ticks: number): void {
    for (let n = 0; n < ticks; n++) {
        world.tick++
        rtTickTileEntities(world, world.rng, world.tick)
    }
}

describe('tile entities', () => {
    it('are stations and industries, claiming their tile kinds and no other', () => {
        expect(RT_TILE_ENTITY_KINDS.map(kind => kind.name)).toEqual(['industry', 'station'])
        const kinds = Object.values(RtTileKind).filter(kind => rtHasTileEntity(kind))
        expect(kinds).toEqual([RtTileKind.industry, RtTileKind.station])
    })

    it('tick every industry in id order, then every station in id order', () => {
        const world = servedWorld()
        expect(world.stationList().length).toBeGreaterThan(3)
        const copy = decodeWorld(encodeWorld(world))!
        stepRegistry(world, 30000)
        stepByHand(copy, 30000)
        expect(world.hash()).toBe(copy.hash())
        // the run is long enough for the order to matter: stations first ends elsewhere
        const swapped = decodeWorld(encodeWorld(servedWorld()))!
        for (let n = 0; n < 30000; n++) {
            swapped.tick++
            for (const station of swapped.stationList()) rtStationTick(swapped, station, swapped.rng, swapped.tick)
            for (const industry of swapped.industryList()) industryTick(swapped, industry, swapped.rng, swapped.tick)
        }
        expect(swapped.hash()).not.toBe(world.hash())
    })

    it('locate each building by its own kind: an industry by its footprint, a station by its tiles', () => {
        const world = servedWorld()
        expect(rtTileEntityMismatch(world)).toBeNull()
        const industry = world.industryList()[0]!
        const station = world.stationList()[0]!
        expect(RT_INDUSTRY_TILE_ENTITY.tiles(world.map, industry)).toContain(industry.origin)
        expect(RT_STATION_TILE_ENTITY.tiles(world.map, station)).toEqual(station.tiles)
        expect(RT_STATION_TILE_ENTITY.idOf(world.map.payload[station.tiles[0]!]!)).toBe(station.id)
        expect(RT_INDUSTRY_TILE_ENTITY.idOf(world.map.payload[industry.origin]!)).toBe(industry.id)

        // an industry whose footprint would run off the map has no building that can stand
        const edge = { ...industry, origin: world.map.side - 1 }
        expect(RT_INDUSTRY_TILE_ENTITY.tiles(world.map, edge)).toBeNull()
        world.industries[industry.id] = edge
        expect(rtTileEntityMismatch(world)).toMatch(/industry \d+ does not fit the map/)
    })
})
