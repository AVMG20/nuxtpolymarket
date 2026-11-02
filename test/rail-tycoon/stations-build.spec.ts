import { describe, expect, it } from 'vitest'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { demolishTile } from '#shared/utils/rail-tycoon/demolish'
import { buildDepot, rtDepotFacing, rtDepotKind, rtDepotLink, rtDepotTrackFor } from '#shared/utils/rail-tycoon/depots'
import { RT_ROAD_DIR_BIT, RtDir, RtMap, RtTileKind, rtTreePayload } from '#shared/utils/rail-tycoon/map'
import { buildRoad, rtRoadBits } from '#shared/utils/rail-tycoon/road'
import {
    RtAxis,
    RtStationTile,
    buildRailStation,
    buildRoadStop,
    rtPlatformReserved,
    rtPlatformTrack,
    rtRoadStopRoadOwner,
    rtStationAxis,
    rtStationId,
    rtStationTileType,
    rtWithPlatformReservation
} from '#shared/utils/rail-tycoon/stations-build'
import {
    RT_ROAD_X,
    RT_ROAD_Y,
    RtBuildError,
    RtTrack,
    buildRail,
    rtRailPieceReserved,
    rtRailPieces,
    rtTracksOverlap,
    rtWithRailReservation,
    type RtReservationHooks
} from '#shared/utils/rail-tycoon/track'
import {
    RT_NONE,
    RT_OWNER_NONE,
    RtFacility,
    RtOrderKind,
    RtVehicleKind,
    RtVehicleState,
    type RtCargoPacket,
    type RtStation,
    type RtTown,
    type RtVehicle
} from '#shared/utils/rail-tycoon/types'

const C = RT_CATALOG.construction
const ME = 0
const RIVAL = 1
const free = () => false
const busy = () => true

function setCorners(map: RtMap, x: number, y: number, h: { n: number, w: number, e: number, s: number }): number {
    map.setCornerHeight(x, y, h.n)
    map.setCornerHeight(x + 1, y, h.w)
    map.setCornerHeight(x, y + 1, h.e)
    map.setCornerHeight(x + 1, y + 1, h.s)
    return map.idx(x, y)
}

function town(id: number, name: string, centre: number): RtTown {
    return {
        id, name, centre, houseCount: 1, population: 40, growthCounter: 0, growthRate: 0, growing: false,
        activeStations: 0, receivedThisMonth: [0, 0, 0, 0, 0], receivedLastMonth: [0, 0, 0, 0, 0]
    }
}

function vehicle(id: number, owner: number): RtVehicle {
    return {
        id, owner, kind: RtVehicleKind.rail, model: 0, consist: [0], wagonCount: 0, tiles: [], pieces: [], direction: 0,
        progress: 0, speed: 0, subspeed: 0, route: [], routeIndex: 0, routeTick: 0, reservedEnd: 0, orders: [], orderIndex: 0,
        state: RtVehicleState.driving, stopped: false, loadTicks: 0, loadingStation: RT_NONE, cargo: [], reliability: 0,
        breakdownChance: 0, breakdownTicks: 0, breakdownsSinceService: 0, lastServiceTick: 0, serviceDepot: RT_NONE, runningTicks: 0,
        lost: false, lostRetryTick: 0, blockedTicks: 0, waitTicks: 0, crashTicks: 0, age: 0, value: 0, profitThisYear: 0, profitLastYear: 0
    }
}

function packet(sourceStation: number): RtCargoPacket {
    return { cargo: 0, count: 10, sourceTile: 0, sourceStation, transitPeriods: 0, feederShare: 0 }
}

function setup(): { map: RtMap, stations: RtStation[], towns: RtTown[] } {
    const map = new RtMap(64)
    return { map, stations: [], towns: [town(0, 'Alderton', map.idx(5, 5)), town(1, 'Brookmere', map.idx(50, 50))] }
}

function snapshot(map: RtMap, stations: RtStation[]): string {
    return JSON.stringify([Array.from(map.kind), Array.from(map.owner), Array.from(map.payload), stations])
}

/** Whether a piece is on a tile, as plain rail, a platform or a rail depot. */
function pieceThere(map: RtMap, tile: number, piece: RtTrack): boolean {
    const p = map.payload[tile]!
    if (map.kind[tile] === RtTileKind.rail) return (rtRailPieces(p) & (1 << piece)) !== 0
    if (map.kind[tile] === RtTileKind.station) return rtStationTileType(p) === RtStationTile.rail && rtPlatformTrack(p) === piece
    return false
}

function reservedThere(map: RtMap, tile: number, piece: RtTrack): boolean {
    const p = map.payload[tile]!
    if (map.kind[tile] === RtTileKind.rail) return rtRailPieceReserved(p, piece)
    if (map.kind[tile] === RtTileKind.station) return rtPlatformReserved(p)
    return false
}

function setReserved(map: RtMap, tile: number, piece: RtTrack, on: boolean): void {
    if (map.kind[tile] === RtTileKind.rail) map.payload[tile] = rtWithRailReservation(map.payload[tile]!, piece, on)
    else if (map.kind[tile] === RtTileKind.station) map.payload[tile] = rtWithPlatformReservation(map.payload[tile]!, on)
}

/**
 * A stand-in for signals.ts's reservation rules over rail and platforms: each train follows a fixed list
 * of (tile, piece) steps and reserves up to the first gap; a step reserved by another train, or
 * crossing one, reserves nothing. Only the hook contract is under test, not the real reservePath.
 */
class FakeReservations implements RtReservationHooks {
    readonly held = new Map<number, Set<string>>()
    readonly calls: string[] = []
    constructor(private readonly map: RtMap, private readonly trains: { v: RtVehicle, path: [number, RtTrack][] }[]) {
        for (const t of trains) this.held.set(t.v.id, new Set())
    }

    reserverOf(tile: number, piece: RtTrack): RtVehicle | null {
        for (const t of [...this.trains].sort((a, b) => a.v.id - b.v.id)) {
            if (this.held.get(t.v.id)!.has(`${tile}:${piece}`)) return t.v
        }
        return null
    }

    releaseAhead(v: RtVehicle): void {
        this.calls.push(`release ${v.id}`)
        for (const k of this.held.get(v.id)!) {
            const [tile, piece] = k.split(':').map(Number) as [number, RtTrack]
            setReserved(this.map, tile, piece, false)
        }
        this.held.get(v.id)!.clear()
    }

    reserveAgain(v: RtVehicle): void {
        this.calls.push(`reserve ${v.id}`)
        this.tryReserve(v.id)
    }

    tryReserve(id: number): number {
        const train = this.trains.find(t => t.v.id === id)!
        const held = this.held.get(id)!
        let count = 0
        for (const [tile, piece] of train.path) {
            if (!pieceThere(this.map, tile, piece)) break
            for (let other = 0; other < 6; other++) {
                const o = other as RtTrack
                if (!pieceThere(this.map, tile, o) || !reservedThere(this.map, tile, o) || held.has(`${tile}:${o}`)) continue
                if (o === piece || rtTracksOverlap((1 << o) | (1 << piece))) return 0
            }
            count++
        }
        for (const [tile, piece] of train.path.slice(0, count)) {
            setReserved(this.map, tile, piece, true)
            held.add(`${tile}:${piece}`)
        }
        return count
    }
}

describe('rail tycoon station building', () => {
    describe('rail stations', () => {
        it('a 2 by 4 station on flat land creates one station with 8 tiles named after the nearest town', () => {
            const { map, stations, towns } = setup()
            const origin = map.idx(10, 10)
            const result = buildRailStation(map, stations, towns, ME, origin, RtAxis.x, 2, 4, true)
            expect(result).toEqual({ ok: true, cost: 8 * (C.railStationTile + C.track) + 4 * C.railStationLength, station: 0 })
            expect(stations).toHaveLength(1)
            const station = stations[0]!
            expect(station.name).toBe('Alderton')
            expect(station.town).toBe(0)
            expect(station.owner).toBe(ME)
            expect(station.sign).toBe(origin)
            expect(station.tiles).toHaveLength(8)
            expect(station.tiles).toEqual([...station.tiles].sort((a, b) => a - b))
            expect(station.facilities).toBe(RtFacility.rail)
            expect(station.cargo).toHaveLength(5)
            for (const tile of station.tiles) {
                expect(map.kind[tile]).toBe(RtTileKind.station)
                expect(map.owner[tile]).toBe(ME)
                expect(rtStationId(map.payload[tile]!)).toBe(0)
                expect(rtStationTileType(map.payload[tile]!)).toBe(RtStationTile.rail)
                expect(rtStationAxis(map.payload[tile]!)).toBe(RtAxis.x)
                expect(rtPlatformReserved(map.payload[tile]!)).toBe(false)
            }
            expect(map.tileX(Math.max(...station.tiles))).toBe(13)
            expect(map.tileY(Math.max(...station.tiles))).toBe(11)
        })

        it('an adjacent build joins the station; a separate one gets a numbered name', () => {
            const { map, stations, towns } = setup()
            buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 2, 4, true)
            const joined = buildRailStation(map, stations, towns, ME, map.idx(14, 11), RtAxis.x, 1, 2, true)
            expect(joined).toMatchObject({ ok: true, station: 0 })
            expect(stations).toHaveLength(1)
            expect(stations[0]!.tiles).toHaveLength(10)
            // a diagonal touch joins too, as the original's 3 by 3 ring
            expect(buildRailStation(map, stations, towns, ME, map.idx(9, 12), RtAxis.y, 1, 1, false)).toMatchObject({ ok: true, station: 0 })
            const apart = buildRailStation(map, stations, towns, ME, map.idx(10, 20), RtAxis.y, 1, 3, true)
            expect(apart).toMatchObject({ ok: true, station: 1 })
            expect(stations.map(s => s.name)).toEqual(['Alderton', 'Alderton 2'])
            const far = buildRailStation(map, stations, towns, ME, map.idx(48, 48), RtAxis.y, 1, 3, true)
            expect(far).toMatchObject({ ok: true, station: 2 })
            expect(stations[2]!.name).toBe('Brookmere')
        })

        it('refuses another company\'s rail, a bent own piece, a slope, water and two adjoining stations', () => {
            const { map, stations, towns } = setup()
            buildRail(map, RIVAL, map.idx(12, 10), RtTrack.x, true)
            expect(buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 1, 4, true)).toEqual({ ok: false, error: RtBuildError.notOwner })
            buildRail(map, ME, map.idx(12, 20), RtTrack.y, true)
            expect(buildRailStation(map, stations, towns, ME, map.idx(10, 20), RtAxis.x, 1, 4, true)).toEqual({ ok: false, error: RtBuildError.occupied })
            setCorners(map, 31, 30, { n: 0, w: 1, e: 0, s: 1 })
            expect(buildRailStation(map, stations, towns, ME, map.idx(30, 30), RtAxis.x, 1, 2, true)).toEqual({ ok: false, error: RtBuildError.badSlope })
            map.setTile(map.idx(41, 30), RtTileKind.water, RT_OWNER_NONE, 0)
            expect(buildRailStation(map, stations, towns, ME, map.idx(40, 30), RtAxis.x, 1, 2, true)).toEqual({ ok: false, error: RtBuildError.water })
            expect(stations).toHaveLength(0)

            buildRailStation(map, stations, towns, ME, map.idx(10, 40), RtAxis.x, 1, 2, true)
            buildRailStation(map, stations, towns, ME, map.idx(14, 40), RtAxis.x, 1, 2, true)
            expect(stations).toHaveLength(2)
            expect(buildRailStation(map, stations, towns, ME, map.idx(12, 40), RtAxis.x, 1, 2, true)).toEqual({ ok: false, error: RtBuildError.conflict })
        })

        it('reuses own straight rail along the axis and clears trees at their price', () => {
            const { map, stations, towns } = setup()
            buildRail(map, ME, map.idx(10, 10), RtTrack.x, true)
            map.setTile(map.idx(11, 10), RtTileKind.tree, RT_OWNER_NONE, rtTreePayload(1, 3, 2))
            const result = buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 1, 2, true)
            expect(result).toEqual({ ok: true, cost: 2 * (C.railStationTile + C.track) + 2 * C.railStationLength + 2 * C.clearTrees, station: 0 })
            expect(map.kind[map.idx(10, 10)]).toBe(RtTileKind.station)
            buildRail(map, ME, map.idx(20, 20), RtTrack.x, true)
            expect(buildRailStation(map, stations, towns, ME, map.idx(20, 20), RtAxis.x, 1, 1, false, busy)).toEqual({ ok: false, error: RtBuildError.conflict })
        })

        it('leaves the map and the station list untouched when apply is false', () => {
            const { map, stations, towns } = setup()
            buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 1, 2, true)
            const before = snapshot(map, stations)
            expect(buildRailStation(map, stations, towns, ME, map.idx(12, 10), RtAxis.x, 1, 2, false).ok).toBe(true)
            expect(buildRailStation(map, stations, towns, ME, map.idx(30, 30), RtAxis.y, 3, 5, false).ok).toBe(true)
            expect(snapshot(map, stations)).toBe(before)
            map.setTile(map.idx(40, 40), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
            const withRoad = snapshot(map, stations)
            expect(buildRoadStop(map, stations, towns, ME, map.idx(40, 40), RtStationTile.bus, false).ok).toBe(true)
            expect(buildDepot(map, ME, map.idx(45, 45), RtVehicleKind.rail, RtDir.se, false).ok).toBe(true)
            expect(demolishTile(map, stations, ME, map.idx(10, 10), free, false).ok).toBe(true)
            expect(snapshot(map, stations)).toBe(withRoad)
        })

        it('refuses growing a station to 13 tiles across', () => {
            const { map, stations, towns } = setup()
            buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 1, 7, true)
            expect(buildRailStation(map, stations, towns, ME, map.idx(17, 10), RtAxis.x, 1, 6, true)).toEqual({ ok: false, error: RtBuildError.tooSpread })
            expect(stations[0]!.tiles).toHaveLength(7)
            expect(buildRailStation(map, stations, towns, ME, map.idx(17, 10), RtAxis.x, 1, 5, true)).toMatchObject({ ok: true, station: 0 })
            expect(stations[0]!.tiles).toHaveLength(12)
        })

        it('refuses a new station at the station cap', () => {
            const { map, towns } = setup()
            const stations = Array.from({ length: RT_CATALOG.caps.maxStations }, (_, id) => ({ id, name: `S${id}` }) as RtStation)
            expect(buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 1, 1, true)).toEqual({ ok: false, error: RtBuildError.limit })
        })
    })

    describe('road stops', () => {
        it('a bus stop on a straight town road works and keeps the road passable; a junction is refused', () => {
            const { map, stations, towns } = setup()
            const tile = map.idx(10, 10)
            map.setTile(tile, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_X)
            expect(buildRoadStop(map, stations, towns, ME, tile, RtStationTile.bus, true)).toEqual({ ok: true, cost: C.roadStop, station: 0 })
            expect(map.kind[tile]).toBe(RtTileKind.station)
            expect(map.owner[tile]).toBe(ME)
            expect(rtStationTileType(map.payload[tile]!)).toBe(RtStationTile.bus)
            expect(rtStationAxis(map.payload[tile]!)).toBe(RtAxis.x)
            expect(rtRoadStopRoadOwner(map.payload[tile]!)).toBe(RT_OWNER_NONE)
            expect(stations[0]!.facilities).toBe(RtFacility.busStop)

            const junction = map.idx(20, 20)
            map.setTile(junction, RtTileKind.road, RT_OWNER_NONE, 15)
            expect(buildRoadStop(map, stations, towns, ME, junction, RtStationTile.bus, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            const corner = map.idx(22, 20)
            map.setTile(corner, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_DIR_BIT[RtDir.ne]! | RT_ROAD_DIR_BIT[RtDir.se]!)
            expect(buildRoadStop(map, stations, towns, ME, corner, RtStationTile.truck, true)).toEqual({ ok: false, error: RtBuildError.conflict })
        })

        it('completes a half road, refuses others\' roads, slopes, bare land and an occupied tile', () => {
            const { map, stations, towns } = setup()
            const half = map.idx(10, 10)
            buildRoad(map, ME, half, RT_ROAD_DIR_BIT[RtDir.nw]!, true)
            expect(buildRoadStop(map, stations, towns, ME, half, RtStationTile.truck, true)).toEqual({ ok: true, cost: C.roadStop + C.road, station: 0 })
            expect(rtStationAxis(map.payload[half]!)).toBe(RtAxis.y)
            expect(rtRoadStopRoadOwner(map.payload[half]!)).toBe(ME)
            expect(stations[0]!.facilities).toBe(RtFacility.truckStop)
            const rivals = map.idx(30, 30)
            map.setTile(rivals, RtTileKind.road, RIVAL, RT_ROAD_X)
            expect(buildRoadStop(map, stations, towns, ME, rivals, RtStationTile.bus, true)).toEqual({ ok: false, error: RtBuildError.notOwner })
            const ramp = setCorners(map, 40, 40, { n: 0, w: 1, e: 0, s: 1 })
            map.setTile(ramp, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_X)
            expect(buildRoadStop(map, stations, towns, ME, ramp, RtStationTile.bus, true)).toEqual({ ok: false, error: RtBuildError.badSlope })
            expect(buildRoadStop(map, stations, towns, ME, map.idx(45, 45), RtStationTile.bus, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            const used = map.idx(50, 40)
            map.setTile(used, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
            expect(buildRoadStop(map, stations, towns, ME, used, RtStationTile.bus, true, busy)).toEqual({ ok: false, error: RtBuildError.conflict })
        })

        it('a bus stop joins an adjacent rail station', () => {
            const { map, stations, towns } = setup()
            buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 1, 2, true)
            const tile = map.idx(10, 11)
            map.setTile(tile, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_X)
            expect(buildRoadStop(map, stations, towns, ME, tile, RtStationTile.bus, true)).toMatchObject({ ok: true, station: 0 })
            expect(stations[0]!.facilities).toBe(RtFacility.rail | RtFacility.busStop)
            expect(stations[0]!.tiles).toHaveLength(3)
        })

        it('a chain of road stops is refused once it would pass stationSpread', () => {
            const { map, stations, towns } = setup()
            for (let x = 10; x <= 23; x++) map.setTile(map.idx(x, 10), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_X)
            for (let x = 10; x <= 21; x++) {
                expect(buildRoadStop(map, stations, towns, ME, map.idx(x, 10), RtStationTile.bus, true)).toMatchObject({ ok: true, station: 0 })
            }
            expect(stations).toHaveLength(1)
            expect(buildRoadStop(map, stations, towns, ME, map.idx(22, 10), RtStationTile.bus, true)).toEqual({ ok: false, error: RtBuildError.tooSpread })
            expect(map.kind[map.idx(22, 10)]).toBe(RtTileKind.road)
        })
    })

    describe('depots', () => {
        it('a rail depot on flat land succeeds; on a ramp or facing off the map it is refused', () => {
            const { map } = setup()
            const tile = map.idx(10, 10)
            expect(buildDepot(map, ME, tile, RtVehicleKind.rail, RtDir.sw, true)).toEqual({ ok: true, cost: C.trainDepot })
            expect(map.kind[tile]).toBe(RtTileKind.depot)
            expect(map.owner[tile]).toBe(ME)
            expect(rtDepotKind(map.payload[tile]!)).toBe(RtVehicleKind.rail)
            expect(rtDepotFacing(map.payload[tile]!)).toBe(RtDir.sw)
            expect(rtDepotLink(map.payload[tile]!)).toBe(1 << RtTrack.x)
            expect(rtDepotTrackFor(RtDir.se)).toBe(RtTrack.y)

            const road = map.idx(12, 12)
            expect(buildDepot(map, ME, road, RtVehicleKind.road, RtDir.nw, true)).toEqual({ ok: true, cost: C.roadDepot })
            expect(rtDepotLink(map.payload[road]!)).toBe(RT_ROAD_DIR_BIT[RtDir.nw])

            const ramp = setCorners(map, 20, 20, { n: 0, w: 1, e: 0, s: 1 })
            expect(buildDepot(map, ME, ramp, RtVehicleKind.rail, RtDir.sw, true)).toEqual({ ok: false, error: RtBuildError.badSlope })
            expect(buildDepot(map, ME, map.idx(0, 30), RtVehicleKind.rail, RtDir.ne, true)).toEqual({ ok: false, error: RtBuildError.edge })
            expect(buildDepot(map, ME, tile, RtVehicleKind.rail, RtDir.ne, true)).toEqual({ ok: false, error: RtBuildError.occupied })
            const trees = map.idx(30, 30)
            map.setTile(trees, RtTileKind.tree, RT_OWNER_NONE, rtTreePayload(0, 2, 4))
            expect(buildDepot(map, ME, trees, RtVehicleKind.road, RtDir.se, false)).toEqual({ ok: true, cost: C.roadDepot + 4 * C.clearTrees })
        })
    })

    describe('demolishTile', () => {
        it('removing the last tile of a station deletes the station', () => {
            const { map, stations, towns } = setup()
            buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 1, 2, true)
            expect(demolishTile(map, stations, ME, map.idx(10, 10), free, true)).toEqual({ ok: true, cost: C.removeRailStation })
            expect(stations).toHaveLength(1)
            expect(stations[0]!.tiles).toEqual([map.idx(11, 10)])
            expect(stations[0]!.sign).toBe(map.idx(11, 10))
            expect(map.kind[map.idx(10, 10)]).toBe(RtTileKind.clear)
            expect(demolishTile(map, stations, ME, map.idx(11, 10), free, true).ok).toBe(true)
            expect(stations).toHaveLength(0)
            expect(map.kind[map.idx(11, 10)]).toBe(RtTileKind.clear)
            expect(map.owner[map.idx(11, 10)]).toBe(RT_OWNER_NONE)
        })

        it('demolishing a depot with a vehicle inside is refused; empty, it clears', () => {
            const { map, stations } = setup()
            const tile = map.idx(10, 10)
            buildDepot(map, ME, tile, RtVehicleKind.road, RtDir.se, true)
            expect(demolishTile(map, stations, ME, tile, busy, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            expect(map.kind[tile]).toBe(RtTileKind.depot)
            expect(demolishTile(map, stations, RIVAL, tile, free, true)).toEqual({ ok: false, error: RtBuildError.notOwner })
            expect(demolishTile(map, stations, ME, tile, free, true)).toEqual({ ok: true, cost: C.removeDepot })
            expect(map.kind[tile]).toBe(RtTileKind.clear)
        })

        it('a drive-through stop on a town road, demolished, leaves a town-owned straight road', () => {
            const { map, stations, towns } = setup()
            buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 1, 2, true)
            const tile = map.idx(10, 11)
            map.setTile(tile, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_X)
            buildRoadStop(map, stations, towns, ME, tile, RtStationTile.bus, true)
            expect(demolishTile(map, stations, ME, tile, free, true)).toEqual({ ok: true, cost: C.removeRoadStop })
            expect(map.kind[tile]).toBe(RtTileKind.road)
            expect(map.owner[tile]).toBe(RT_OWNER_NONE)
            expect(rtRoadBits(map.payload[tile]!)).toBe(RT_ROAD_X)
            expect(stations[0]!.tiles).not.toContain(tile)
            expect(stations[0]!.facilities).toBe(RtFacility.rail)
        })

        it('clears trees, does nothing on clear land, refuses houses, water, town roads and own track', () => {
            const { map, stations } = setup()
            const trees = map.idx(10, 10)
            map.setTile(trees, RtTileKind.tree, RT_OWNER_NONE, rtTreePayload(0, 3, 2))
            expect(demolishTile(map, stations, ME, trees, free, true)).toEqual({ ok: true, cost: 2 * C.clearTrees })
            expect(map.kind[trees]).toBe(RtTileKind.clear)
            expect(demolishTile(map, stations, ME, trees, free, true)).toEqual({ ok: true, cost: 0 })
            map.setTile(map.idx(11, 11), RtTileKind.house, RT_OWNER_NONE, 0)
            expect(demolishTile(map, stations, ME, map.idx(11, 11), free, true)).toEqual({ ok: false, error: RtBuildError.occupied })
            map.setTile(map.idx(12, 12), RtTileKind.water, RT_OWNER_NONE, 0)
            expect(demolishTile(map, stations, ME, map.idx(12, 12), free, true)).toEqual({ ok: false, error: RtBuildError.water })
            map.setTile(map.idx(13, 13), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
            expect(demolishTile(map, stations, ME, map.idx(13, 13), free, true)).toEqual({ ok: false, error: RtBuildError.notOwner })
            buildRail(map, ME, map.idx(14, 14), RtTrack.x, true)
            expect(demolishTile(map, stations, ME, map.idx(14, 14), free, true)).toEqual({ ok: false, error: RtBuildError.conflict })
        })

        it('demolishing a station deletes every order to it and clears packet sources', () => {
            const { map, stations, towns } = setup()
            buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 1, 1, true)
            buildRailStation(map, stations, towns, RIVAL, map.idx(30, 30), RtAxis.x, 1, 1, true)
            const gone = stations[0]!.id
            const kept = stations[1]!.id
            const goto = (target: number) => ({ kind: RtOrderKind.gotoStation, target, flags: 0 })
            const mine = vehicle(3, ME)
            mine.orders = [goto(gone), goto(kept), goto(gone)]
            mine.orderIndex = 2
            mine.cargo = [packet(gone), packet(kept)]
            const theirs = vehicle(1, RIVAL)
            theirs.orders = [goto(kept), goto(gone)]
            theirs.orderIndex = 1
            theirs.cargo = [packet(gone)]
            stations[1]!.cargo[0]!.packets.push(packet(gone))
            const shifted = vehicle(2, ME)
            shifted.orders = [goto(gone), goto(kept), goto(9)]
            shifted.orderIndex = 2
            const vehicles = [mine, theirs, shifted]

            expect(demolishTile(map, stations, ME, map.idx(10, 10), free, true, { vehicles }).ok).toBe(true)
            expect(stations.map(s => s.id)).toEqual([kept])
            expect(mine.orders).toEqual([goto(kept)])
            expect(mine.orderIndex).toBe(0)
            expect(theirs.orders).toEqual([goto(kept)])
            expect(theirs.orderIndex).toBe(0)
            // an earlier deleted order moves the current index down with its order
            expect(shifted.orders).toEqual([goto(kept), goto(9)])
            expect(shifted.orderIndex).toBe(1)
            expect(mine.cargo.map(p => p.sourceStation)).toEqual([RT_NONE, kept])
            expect(theirs.cargo[0]!.sourceStation).toBe(RT_NONE)
            expect(stations[0]!.cargo[0]!.packets[0]!.sourceStation).toBe(RT_NONE)
            // the freed id is handed out again
            expect(buildRailStation(map, stations, towns, ME, map.idx(40, 10), RtAxis.x, 1, 1, true)).toMatchObject({ ok: true, station: gone })
            expect(stations.map(s => s.id)).toEqual([gone, kept])
        })

        it('demolishing a depot deletes the depot orders and service visits to it', () => {
            const { map, stations } = setup()
            const depot = map.idx(10, 10)
            buildDepot(map, ME, depot, RtVehicleKind.rail, RtDir.sw, true)
            const v = vehicle(1, ME)
            v.orders = [{ kind: RtOrderKind.gotoStation, target: 4, flags: 0 }, { kind: RtOrderKind.gotoDepot, target: depot, flags: 0 }]
            v.orderIndex = 1
            v.serviceDepot = depot
            expect(demolishTile(map, stations, ME, depot, free, true, { vehicles: [v] }).ok).toBe(true)
            expect(v.orders).toEqual([{ kind: RtOrderKind.gotoStation, target: 4, flags: 0 }])
            expect(v.orderIndex).toBe(0)
            expect(v.serviceDepot).toBe(RT_NONE)
        })

        it('bulldozing a reserved platform frees the reservation, the train stops before the gap and re-reserves inside the command', () => {
            const { map, stations, towns } = setup()
            const a = map.idx(8, 10)
            const junction = map.idx(9, 10)
            const branch = map.idx(9, 11)
            buildRail(map, ME, a, RtTrack.x, true)
            buildRail(map, ME, junction, RtTrack.x, true)
            buildRail(map, ME, junction, RtTrack.lower, true)
            buildRail(map, ME, branch, RtTrack.y, true)
            buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 1, 2, true)
            const p1 = map.idx(10, 10)
            const p2 = map.idx(11, 10)
            const high = vehicle(6, ME)
            const low = vehicle(2, ME)
            const fake = new FakeReservations(map, [
                { v: high, path: [[a, RtTrack.x], [junction, RtTrack.x], [p1, RtTrack.x], [p2, RtTrack.x]] },
                { v: low, path: [[branch, RtTrack.y], [junction, RtTrack.lower]] }
            ])
            expect(fake.tryReserve(high.id)).toBe(4)
            expect(rtPlatformReserved(map.payload[p2]!)).toBe(true)

            // without the hooks a reserved platform is refused, and so is an occupied one
            expect(demolishTile(map, stations, ME, p2, free, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            expect(demolishTile(map, stations, ME, p2, busy, true, { reservations: fake })).toEqual({ ok: false, error: RtBuildError.conflict })

            expect(demolishTile(map, stations, ME, p2, free, true, { reservations: fake })).toEqual({ ok: true, cost: C.removeRailStation })
            expect(fake.calls).toEqual([`release ${high.id}`, `reserve ${high.id}`])
            expect(map.kind[p2]).toBe(RtTileKind.clear)
            expect(fake.held.get(high.id)!.size).toBe(3)
            expect(rtPlatformReserved(map.payload[p1]!)).toBe(true)
            expect(rtRailPieceReserved(map.payload[junction]!, RtTrack.x)).toBe(true)
            expect(fake.tryReserve(low.id)).toBe(0)
            expect(rtRailPieceReserved(map.payload[junction]!, RtTrack.lower)).toBe(false)
        })

        it('refuses garbage parameters with invalid and never throws or writes', () => {
            const { map, stations, towns } = setup()
            buildRailStation(map, stations, towns, ME, map.idx(10, 10), RtAxis.x, 1, 2, true)
            map.setTile(map.idx(20, 20), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
            const before = snapshot(map, stations)
            const junk = [-1, 1.5, NaN, Infinity, 1e12, map.tileCount, '2' as unknown as number, null as unknown as number]
            for (const bad of junk) {
                expect(buildRailStation(map, stations, towns, bad, map.idx(30, 30), RtAxis.x, 1, 1, true).ok).toBe(false)
                expect(buildRailStation(map, stations, towns, ME, bad, RtAxis.x, 1, 1, true).ok).toBe(false)
                expect(buildRailStation(map, stations, towns, ME, map.idx(30, 30), bad, 1, 1, true).ok).toBe(false)
                expect(buildRailStation(map, stations, towns, ME, map.idx(30, 30), RtAxis.x, bad, 1, true).ok).toBe(false)
                expect(buildRailStation(map, stations, towns, ME, map.idx(30, 30), RtAxis.x, 1, bad, true).ok).toBe(false)
                expect(buildRoadStop(map, stations, towns, ME, bad, RtStationTile.bus, true).ok).toBe(false)
                expect(buildRoadStop(map, stations, towns, ME, map.idx(20, 20), bad, true).ok).toBe(false)
                expect(buildDepot(map, ME, bad, RtVehicleKind.rail, RtDir.se, true).ok).toBe(false)
                expect(buildDepot(map, ME, map.idx(30, 30), bad, RtDir.se, true).ok).toBe(false)
                expect(buildDepot(map, ME, map.idx(30, 30), RtVehicleKind.rail, bad, true).ok).toBe(false)
                expect(demolishTile(map, stations, bad, map.idx(10, 10), free, true).ok).toBe(false)
                expect(demolishTile(map, stations, ME, bad, free, true).ok).toBe(false)
            }
            expect(buildRailStation(map, stations, towns, ME, map.idx(60, 60), RtAxis.x, 1, 7, true)).toEqual({ ok: false, error: RtBuildError.edge })
            expect(buildRailStation(map, stations, towns, ME, map.idx(30, 30), RtAxis.x, 5, 1, true).ok).toBe(false)
            expect(buildRailStation(map, stations, towns, ME, map.idx(30, 30), RtAxis.x, 1, 8, true).ok).toBe(false)
            expect(buildRoadStop(map, stations, towns, ME, map.idx(20, 20), RtStationTile.rail, true).ok).toBe(false)
            expect(demolishTile(map, stations, ME, map.idx(10, 10), undefined as unknown as () => boolean, true).ok).toBe(false)
            // a station tile whose station is missing from the list is refused, not thrown on
            expect(demolishTile(map, [], ME, map.idx(10, 10), free, true)).toEqual({ ok: false, error: RtBuildError.invalid })
            expect(snapshot(map, stations)).toBe(before)
        })
    })
})
