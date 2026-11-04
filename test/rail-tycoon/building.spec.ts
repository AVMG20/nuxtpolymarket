import { describe, expect, it } from 'vitest'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RT_ROAD_DIR_BIT, RtDir, RtMap, RtTileKind, rtTreePayload } from '#shared/utils/rail-tycoon/map'
import { buildRoad, removeRoad, rtRoadBits } from '#shared/utils/rail-tycoon/road'
import {
    RT_ROAD_X,
    RT_ROAD_Y,
    RT_SIGNAL_SLOT_EMPTY,
    RtBuildError,
    RtTrack,
    buildRail,
    removeRail,
    rtCrossingRoadBits,
    rtCrossingRoadOwner,
    rtIsCrossing,
    rtRailPieceReserved,
    rtRailPieces,
    rtSignalSlot,
    rtTracksOverlap,
    rtWithRailReservation,
    rtWithSignalSlot,
    type RtReservationHooks
} from '#shared/utils/rail-tycoon/track'
import { RT_OWNER_NONE, RtVehicleKind, RtVehicleState, type RtVehicle } from '#shared/utils/rail-tycoon/types'

const C = RT_CATALOG.construction
const ME = 0
const RIVAL = 1
const free = () => false
const busy = () => true

/** Set tile (x, y)'s corners; north is corner (x, y), west (x + 1, y), east (x, y + 1), south (x + 1, y + 1). */
function setCorners(map: RtMap, x: number, y: number, h: { n: number, w: number, e: number, s: number }): number {
    map.setCornerHeight(x, y, h.n)
    map.setCornerHeight(x + 1, y, h.w)
    map.setCornerHeight(x, y + 1, h.e)
    map.setCornerHeight(x + 1, y + 1, h.s)
    return map.idx(x, y)
}

function snapshot(map: RtMap): { kind: Uint8Array, owner: Uint8Array, payload: Uint32Array } {
    return { kind: map.kind.slice(), owner: map.owner.slice(), payload: map.payload.slice() }
}

function expectUnchanged(map: RtMap, before: ReturnType<typeof snapshot>): void {
    expect(map.kind).toEqual(before.kind)
    expect(map.owner).toEqual(before.owner)
    expect(map.payload).toEqual(before.payload)
}

function vehicle(id: number, owner: number): RtVehicle {
    return {
        id, owner, kind: RtVehicleKind.rail, model: 0, consist: [0], wagonCount: 0, tiles: [], pieces: [], direction: 0,
        progress: 0, speed: 0, subspeed: 0, route: [], routeIndex: 0, routeTick: 0, reservedEnd: 0, orders: [], orderIndex: 0,
        state: RtVehicleState.driving, stopped: false, loadTicks: 0, loadingStation: -1, cargo: [], reliability: 0,
        breakdownChance: 0, breakdownTicks: 0, breakdownsSinceService: 0, lastServiceTick: 0, serviceDepot: -1, runningTicks: 0,
        lost: false, lostRetryTick: 0, blockedTicks: 0, waitTicks: 0, crashTicks: 0, age: 0, value: 0, profitThisYear: 0, profitLastYear: 0
    }
}

/**
 * A stand-in for signals.ts's reservation rules over plain rail: each train follows a fixed list of
 * (tile, piece) steps, reserving from the start until the first missing or foreign-reserved piece.
 * Only the hook contract is under test here, not the real reservePath.
 */
class FakeReservations implements RtReservationHooks {
    readonly held = new Map<number, Set<string>>()
    readonly calls: string[] = []
    constructor(private readonly map: RtMap, private readonly trains: { v: RtVehicle, path: [number, RtTrack][] }[]) {
        for (const t of trains) this.held.set(t.v.id, new Set())
    }

    private key(tile: number, piece: number): string {
        return `${tile}:${piece}`
    }

    reserverOf(tile: number, piece: RtTrack): RtVehicle | null {
        const ordered = [...this.trains].sort((a, b) => a.v.id - b.v.id)
        for (const t of ordered) {
            if (this.held.get(t.v.id)!.has(this.key(tile, piece))) return t.v
        }
        return null
    }

    releaseAhead(v: RtVehicle): void {
        this.calls.push(`release ${v.id}`)
        const held = this.held.get(v.id)!
        for (const k of held) {
            const [tile, piece] = k.split(':').map(Number) as [number, RtTrack]
            if (this.map.kind[tile] === RtTileKind.rail) this.map.payload[tile] = rtWithRailReservation(this.map.payload[tile]!, piece, false)
        }
        held.clear()
    }

    reserveAgain(v: RtVehicle): void {
        this.calls.push(`reserve ${v.id}`)
        this.tryReserve(v.id)
    }

    /**
     * Reserves the train's path up to the first gap (an end of line); a piece reserved by another
     * train, or crossing one, is a conflict and reserves nothing (returns 0), as reservePath.
     */
    tryReserve(id: number): number {
        const train = this.trains.find(t => t.v.id === id)!
        const held = this.held.get(id)!
        let count = 0
        for (const [tile, piece] of train.path) {
            if (this.map.kind[tile] !== RtTileKind.rail || (rtRailPieces(this.map.payload[tile]!) & (1 << piece)) === 0) break
            const payload = this.map.payload[tile]!
            for (let other = 0; other < 6; other++) {
                if ((rtRailPieces(payload) & (1 << other)) === 0 || !rtRailPieceReserved(payload, other as RtTrack)) continue
                if (held.has(this.key(tile, other))) continue
                if (other === piece || rtTracksOverlap((1 << other) | (1 << piece))) return 0
            }
            count++
        }
        for (const [tile, piece] of train.path.slice(0, count)) {
            this.map.payload[tile] = rtWithRailReservation(this.map.payload[tile]!, piece, true)
            held.add(this.key(tile, piece))
        }
        return count
    }
}

describe('rail tycoon rail and road building', () => {
    describe('buildRail', () => {
        it('lays a straight on flat clear land for the track cost', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            expect(buildRail(map, ME, tile, RtTrack.x, true)).toEqual({ ok: true, cost: C.track })
            expect(map.kind[tile]).toBe(RtTileKind.rail)
            expect(map.owner[tile]).toBe(ME)
            expect(rtRailPieces(map.payload[tile]!)).toBe(1 << RtTrack.x)
            expect(rtSignalSlot(map.payload[tile]!, 0) & 7).toBe(RT_SIGNAL_SLOT_EMPTY)
            expect(rtSignalSlot(map.payload[tile]!, 1) & 7).toBe(RT_SIGNAL_SLOT_EMPTY)
            expect(rtIsCrossing(map.payload[tile]!)).toBe(false)
        })

        it('adds pieces to own rail and reports a piece already there', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            buildRail(map, ME, tile, RtTrack.x, true)
            expect(buildRail(map, ME, tile, RtTrack.y, true)).toEqual({ ok: true, cost: C.track })
            expect(rtRailPieces(map.payload[tile]!)).toBe((1 << RtTrack.x) | (1 << RtTrack.y))
            expect(buildRail(map, ME, tile, RtTrack.x, true)).toEqual({ ok: false, error: RtBuildError.alreadyBuilt })
        })

        it('refuses a corner piece on a ramp and a straight across it, allows a straight up it', () => {
            const map = new RtMap(64)
            const ramp = setCorners(map, 10, 10, { n: 0, w: 1, e: 0, s: 1 })
            for (const piece of [RtTrack.upper, RtTrack.lower, RtTrack.left, RtTrack.right, RtTrack.y]) {
                expect(buildRail(map, ME, ramp, piece, false)).toEqual({ ok: false, error: RtBuildError.badSlope })
            }
            expect(buildRail(map, ME, ramp, RtTrack.x, false)).toEqual({ ok: true, cost: C.track })
        })

        it('allows a corner piece on its level half and refuses steep slopes', () => {
            const map = new RtMap(64)
            const southUp = setCorners(map, 10, 10, { n: 0, w: 0, e: 0, s: 1 })
            expect(buildRail(map, ME, southUp, RtTrack.upper, false).ok).toBe(true)
            expect(buildRail(map, ME, southUp, RtTrack.lower, false)).toEqual({ ok: false, error: RtBuildError.badSlope })
            const steep = setCorners(map, 20, 20, { n: 0, w: 1, e: 1, s: 2 })
            for (let piece = 0; piece < 6; piece++) {
                expect(buildRail(map, ME, steep, piece, false)).toEqual({ ok: false, error: RtBuildError.badSlope })
            }
        })

        it('refuses another company\'s rail, water, houses and the sea-level side of a coast', () => {
            const map = new RtMap(64)
            const theirs = map.idx(5, 5)
            buildRail(map, RIVAL, theirs, RtTrack.x, true)
            expect(buildRail(map, ME, theirs, RtTrack.y, false)).toEqual({ ok: false, error: RtBuildError.notOwner })
            map.setTile(map.idx(6, 6), RtTileKind.water, RT_OWNER_NONE, 0)
            expect(buildRail(map, ME, map.idx(6, 6), RtTrack.x, false)).toEqual({ ok: false, error: RtBuildError.water })
            map.setTile(map.idx(7, 7), RtTileKind.house, RT_OWNER_NONE, 0)
            expect(buildRail(map, ME, map.idx(7, 7), RtTrack.x, false)).toEqual({ ok: false, error: RtBuildError.occupied })
            const coast = setCorners(map, 30, 30, { n: 0, w: 1, e: 1, s: 1 })
            map.setTile(coast, RtTileKind.coast, RT_OWNER_NONE, 0)
            expect(buildRail(map, ME, coast, RtTrack.lower, false).ok).toBe(true)
            expect(buildRail(map, ME, coast, RtTrack.upper, false)).toEqual({ ok: false, error: RtBuildError.badSlope })
            const beach = setCorners(map, 40, 40, { n: 0, w: 1, e: 0, s: 1 })
            map.setTile(beach, RtTileKind.coast, RT_OWNER_NONE, 0)
            expect(buildRail(map, ME, beach, RtTrack.x, false)).toEqual({ ok: false, error: RtBuildError.water })
        })

        it('clears trees at the catalog price per tree', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            map.setTile(tile, RtTileKind.tree, RT_OWNER_NONE, rtTreePayload(2, 3, 3))
            expect(buildRail(map, ME, tile, RtTrack.x, true)).toEqual({ ok: true, cost: C.track + 3 * C.clearTrees })
            expect(map.kind[tile]).toBe(RtTileKind.rail)
        })

        it('refuses a crossing piece next to a signal or under a vehicle', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            buildRail(map, ME, tile, RtTrack.x, true)
            expect(buildRail(map, ME, tile, RtTrack.y, false, busy)).toEqual({ ok: false, error: RtBuildError.conflict })
            map.payload[tile] = rtWithSignalSlot(map.payload[tile]!, 0, RtTrack.x)
            expect(buildRail(map, ME, tile, RtTrack.y, false)).toEqual({ ok: false, error: RtBuildError.conflict })
            expect(buildRail(map, ME, tile, RtTrack.upper, false)).toEqual({ ok: false, error: RtBuildError.conflict })
            // the parallel corner pair does not overlap, so a signal there does not block the second one
            const pair = map.idx(12, 12)
            buildRail(map, ME, pair, RtTrack.upper, true)
            map.payload[pair] = rtWithSignalSlot(map.payload[pair]!, 0, RtTrack.upper)
            expect(buildRail(map, ME, pair, RtTrack.lower, false)).toEqual({ ok: true, cost: C.track })
        })

        it('leaves the map untouched when apply is false', () => {
            const map = new RtMap(64)
            map.setTile(map.idx(3, 3), RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
            map.setTile(map.idx(4, 4), RtTileKind.tree, RT_OWNER_NONE, rtTreePayload(0, 3, 1))
            const before = snapshot(map)
            expect(buildRail(map, ME, map.idx(1, 1), RtTrack.x, false).ok).toBe(true)
            expect(buildRail(map, ME, map.idx(3, 3), RtTrack.x, false).ok).toBe(true)
            expect(buildRail(map, ME, map.idx(4, 4), RtTrack.y, false).ok).toBe(true)
            expect(buildRoad(map, ME, map.idx(5, 5), RT_ROAD_X, false).ok).toBe(true)
            expectUnchanged(map, before)
        })
    })

    describe('level crossings', () => {
        it('rail across a town road makes a crossing that keeps the town as road owner', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            map.setTile(tile, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
            expect(buildRail(map, ME, tile, RtTrack.x, true)).toEqual({ ok: true, cost: C.track })
            expect(map.kind[tile]).toBe(RtTileKind.rail)
            expect(map.owner[tile]).toBe(ME)
            expect(rtIsCrossing(map.payload[tile]!)).toBe(true)
            expect(rtCrossingRoadOwner(map.payload[tile]!)).toBe(RT_OWNER_NONE)
            expect(rtCrossingRoadBits(map.payload[tile]!)).toBe(RT_ROAD_Y)
            // removing the rail gives the road back to the town
            expect(removeRail(map, ME, tile, RtTrack.x, free, true)).toEqual({ ok: true, cost: -C.removeRailRefund })
            expect(map.kind[tile]).toBe(RtTileKind.road)
            expect(map.owner[tile]).toBe(RT_OWNER_NONE)
            expect(rtRoadBits(map.payload[tile]!)).toBe(RT_ROAD_Y)
        })

        it('rail across another company\'s road keeps that company as road owner and completes a half road', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            map.setTile(tile, RtTileKind.road, RIVAL, RT_ROAD_DIR_BIT[RtDir.se]!)
            expect(buildRail(map, ME, tile, RtTrack.x, true)).toEqual({ ok: true, cost: C.track + C.road })
            expect(map.owner[tile]).toBe(ME)
            expect(rtCrossingRoadOwner(map.payload[tile]!)).toBe(RIVAL)
            expect(removeRail(map, ME, tile, RtTrack.x, free, true).ok).toBe(true)
            expect(map.kind[tile]).toBe(RtTileKind.road)
            expect(map.owner[tile]).toBe(RIVAL)
            expect(rtRoadBits(map.payload[tile]!)).toBe(RT_ROAD_Y)
        })

        it('refuses a crossing on a slope, along the road, or over a junction', () => {
            const map = new RtMap(64)
            const along = map.idx(10, 10)
            map.setTile(along, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_X)
            expect(buildRail(map, ME, along, RtTrack.x, false)).toEqual({ ok: false, error: RtBuildError.occupied })
            expect(buildRail(map, ME, along, RtTrack.upper, false)).toEqual({ ok: false, error: RtBuildError.occupied })
            const junction = map.idx(12, 12)
            map.setTile(junction, RtTileKind.road, RT_OWNER_NONE, 15)
            expect(buildRail(map, ME, junction, RtTrack.y, false)).toEqual({ ok: false, error: RtBuildError.occupied })
            const ramp = setCorners(map, 20, 20, { n: 0, w: 0, e: 1, s: 1 })
            map.setTile(ramp, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
            expect(buildRail(map, ME, ramp, RtTrack.x, false)).toEqual({ ok: false, error: RtBuildError.badSlope })
            const used = map.idx(14, 14)
            map.setTile(used, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
            expect(buildRail(map, ME, used, RtTrack.x, false, busy)).toEqual({ ok: false, error: RtBuildError.conflict })
        })

        it('road across another company\'s straight rail makes a crossing whose road owner is the road builder', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            buildRail(map, RIVAL, tile, RtTrack.y, true)
            expect(buildRoad(map, ME, tile, RT_ROAD_DIR_BIT[RtDir.ne]!, true)).toEqual({ ok: true, cost: 2 * C.road })
            expect(map.kind[tile]).toBe(RtTileKind.rail)
            expect(map.owner[tile]).toBe(RIVAL)
            expect(rtIsCrossing(map.payload[tile]!)).toBe(true)
            expect(rtCrossingRoadOwner(map.payload[tile]!)).toBe(ME)
            expect(rtCrossingRoadBits(map.payload[tile]!)).toBe(RT_ROAD_X)
            expect(buildRoad(map, ME, tile, RT_ROAD_X, false)).toEqual({ ok: false, error: RtBuildError.alreadyBuilt })
        })

        it('road across own rail keeps the reservation and refuses a signalled or bent piece', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            buildRail(map, ME, tile, RtTrack.x, true)
            map.payload[tile] = rtWithRailReservation(map.payload[tile]!, RtTrack.x, true)
            expect(buildRoad(map, ME, tile, RT_ROAD_Y, true).ok).toBe(true)
            expect(rtRailPieceReserved(map.payload[tile]!, RtTrack.x)).toBe(true)
            const signalled = map.idx(12, 12)
            buildRail(map, ME, signalled, RtTrack.x, true)
            map.payload[signalled] = rtWithSignalSlot(map.payload[signalled]!, 0, RtTrack.x)
            expect(buildRoad(map, ME, signalled, RT_ROAD_Y, false)).toEqual({ ok: false, error: RtBuildError.conflict })
            const bent = map.idx(14, 14)
            buildRail(map, ME, bent, RtTrack.upper, true)
            expect(buildRoad(map, ME, bent, RT_ROAD_Y, false)).toEqual({ ok: false, error: RtBuildError.occupied })
        })

        it('only the road owner removes the road part, which leaves plain rail', () => {
            const map = new RtMap(64)
            const townCrossing = map.idx(10, 10)
            map.setTile(townCrossing, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_Y)
            buildRail(map, ME, townCrossing, RtTrack.x, true)
            expect(removeRoad(map, ME, townCrossing, RT_ROAD_Y, free, true)).toEqual({ ok: false, error: RtBuildError.notOwner })

            const mine = map.idx(20, 20)
            buildRail(map, RIVAL, mine, RtTrack.x, true)
            buildRoad(map, ME, mine, RT_ROAD_Y, true)
            expect(removeRoad(map, RIVAL, mine, RT_ROAD_Y, free, true)).toEqual({ ok: false, error: RtBuildError.notOwner })
            expect(removeRoad(map, ME, mine, RT_ROAD_DIR_BIT[RtDir.se]!, free, true)).toEqual({ ok: true, cost: 2 * C.removeRoad })
            expect(map.kind[mine]).toBe(RtTileKind.rail)
            expect(map.owner[mine]).toBe(RIVAL)
            expect(rtIsCrossing(map.payload[mine]!)).toBe(false)
            expect(rtRailPieces(map.payload[mine]!)).toBe(1 << RtTrack.x)
            expect(rtSignalSlot(map.payload[mine]!, 0) & 7).toBe(RT_SIGNAL_SLOT_EMPTY)
        })
    })

    describe('removeRail', () => {
        it('refunds and clears the tile when the last piece goes', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            buildRail(map, ME, tile, RtTrack.x, true)
            buildRail(map, ME, tile, RtTrack.upper, true)
            expect(removeRail(map, ME, tile, RtTrack.upper, free, true)).toEqual({ ok: true, cost: -C.removeRailRefund })
            expect(rtRailPieces(map.payload[tile]!)).toBe(1 << RtTrack.x)
            expect(removeRail(map, ME, tile, RtTrack.x, free, true)).toEqual({ ok: true, cost: -C.removeRailRefund })
            expect(map.kind[tile]).toBe(RtTileKind.clear)
            expect(map.owner[tile]).toBe(RT_OWNER_NONE)
            expect(map.payload[tile]).toBe(0)
        })

        it('refuses a signalled piece, a vehicle on the tile, others\' rail and a missing piece without touching the map', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            buildRail(map, ME, tile, RtTrack.x, true)
            buildRail(map, ME, tile, RtTrack.y, true)
            map.payload[tile] = rtWithSignalSlot(map.payload[tile]!, 1, RtTrack.y)
            const theirs = map.idx(11, 11)
            buildRail(map, RIVAL, theirs, RtTrack.x, true)
            const before = snapshot(map)
            expect(removeRail(map, ME, tile, RtTrack.y, free, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            expect(removeRail(map, ME, tile, RtTrack.x, busy, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            expect(removeRail(map, ME, theirs, RtTrack.x, free, true)).toEqual({ ok: false, error: RtBuildError.notOwner })
            expect(removeRail(map, ME, tile, RtTrack.lower, free, true)).toEqual({ ok: false, error: RtBuildError.invalid })
            expect(removeRail(map, ME, tile, RtTrack.x, free, false).ok).toBe(true)
            expectUnchanged(map, before)
            // the unsignalled piece of a signalled tile may go
            expect(removeRail(map, ME, tile, RtTrack.x, free, true).ok).toBe(true)
        })

        it('refuses a reserved piece when no reservation hooks are given', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            buildRail(map, ME, tile, RtTrack.x, true)
            map.payload[tile] = rtWithRailReservation(map.payload[tile]!, RtTrack.x, true)
            expect(removeRail(map, ME, tile, RtTrack.x, free, true)).toEqual({ ok: false, error: RtBuildError.conflict })
        })

        it('re-reserves the reserving train inside the command, so a lower-id train never takes the freed junction', () => {
            const map = new RtMap(64)
            const a = map.idx(10, 10)
            const junction = map.idx(11, 10)
            const b = map.idx(12, 10)
            const branch = map.idx(11, 11)
            for (const t of [a, junction, b]) buildRail(map, ME, t, RtTrack.x, true)
            buildRail(map, ME, junction, RtTrack.lower, true)
            buildRail(map, ME, branch, RtTrack.y, true)
            const high = vehicle(5, ME)
            const low = vehicle(2, ME)
            const fake = new FakeReservations(map, [
                { v: high, path: [[a, RtTrack.x], [junction, RtTrack.x], [b, RtTrack.x]] },
                { v: low, path: [[branch, RtTrack.y], [junction, RtTrack.lower]] }
            ])
            expect(fake.tryReserve(high.id)).toBe(3)

            const result = removeRail(map, ME, b, RtTrack.x, free, true, fake)
            expect(result).toEqual({ ok: true, cost: -C.removeRailRefund })
            expect(fake.calls).toEqual([`release ${high.id}`, `reserve ${high.id}`])
            // the train stops before the gap but keeps the junction
            expect(map.kind[b]).toBe(RtTileKind.clear)
            expect(rtRailPieceReserved(map.payload[a]!, RtTrack.x)).toBe(true)
            expect(rtRailPieceReserved(map.payload[junction]!, RtTrack.x)).toBe(true)
            expect(fake.held.get(high.id)!.size).toBe(2)
            // the lower-id train moving on the same tick cannot enter the junction
            expect(fake.tryReserve(low.id)).toBe(0)
            expect(rtRailPieceReserved(map.payload[junction]!, RtTrack.lower)).toBe(false)
            // had the command not re-reserved, the junction would have been free for it
            fake.releaseAhead(high)
            expect(fake.tryReserve(low.id)).toBe(2)
        })
    })

    describe('roads', () => {
        it('adding a straight to a town road keeps the town as owner', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            map.setTile(tile, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_DIR_BIT[RtDir.ne]!)
            expect(buildRoad(map, ME, tile, RT_ROAD_Y, true)).toEqual({ ok: true, cost: 2 * C.road })
            expect(map.owner[tile]).toBe(RT_OWNER_NONE)
            expect(rtRoadBits(map.payload[tile]!)).toBe(RT_ROAD_Y | RT_ROAD_DIR_BIT[RtDir.ne]!)
            expect(buildRoad(map, ME, tile, RT_ROAD_Y, true)).toEqual({ ok: false, error: RtBuildError.alreadyBuilt })
            const rivals = map.idx(12, 12)
            map.setTile(rivals, RtTileKind.road, RIVAL, RT_ROAD_X)
            expect(buildRoad(map, ME, rivals, RT_ROAD_Y, false)).toEqual({ ok: false, error: RtBuildError.notOwner })
        })

        it('builds on clear land and trees, and only along a ramp\'s axis', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            expect(buildRoad(map, ME, tile, RT_ROAD_X, true)).toEqual({ ok: true, cost: 2 * C.road })
            expect(map.owner[tile]).toBe(ME)
            const trees = map.idx(11, 11)
            map.setTile(trees, RtTileKind.tree, RT_OWNER_NONE, rtTreePayload(0, 3, 2))
            expect(buildRoad(map, ME, trees, RT_ROAD_DIR_BIT[RtDir.nw]!, false)).toEqual({ ok: true, cost: C.road + 2 * C.clearTrees })
            const ramp = setCorners(map, 20, 20, { n: 0, w: 1, e: 0, s: 1 })
            expect(buildRoad(map, ME, ramp, RT_ROAD_DIR_BIT[RtDir.se]!, false)).toEqual({ ok: false, error: RtBuildError.badSlope })
            expect(buildRoad(map, ME, ramp, RT_ROAD_X | RT_ROAD_DIR_BIT[RtDir.se]!, false)).toEqual({ ok: false, error: RtBuildError.badSlope })
            expect(buildRoad(map, ME, ramp, RT_ROAD_X, false).ok).toBe(true)
            const corner = setCorners(map, 30, 30, { n: 1, w: 0, e: 0, s: 0 })
            expect(buildRoad(map, ME, corner, RT_ROAD_X, false)).toEqual({ ok: false, error: RtBuildError.badSlope })
        })

        it('removes an own dead end to clear land and refuses a town road', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            buildRoad(map, ME, tile, RT_ROAD_DIR_BIT[RtDir.sw]!, true)
            expect(removeRoad(map, ME, tile, RT_ROAD_DIR_BIT[RtDir.sw]!, free, true)).toEqual({ ok: true, cost: C.removeRoad })
            expect(map.kind[tile]).toBe(RtTileKind.clear)
            expect(map.owner[tile]).toBe(RT_OWNER_NONE)
            const town = map.idx(12, 12)
            map.setTile(town, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_X)
            expect(removeRoad(map, ME, town, RT_ROAD_X, free, true)).toEqual({ ok: false, error: RtBuildError.notOwner })
        })

        it('removes some bits and refuses missing bits, a vehicle, a road stop or a depot without touching the map', () => {
            const map = new RtMap(64)
            const tile = map.idx(10, 10)
            buildRoad(map, ME, tile, 15, true)
            map.setTile(map.idx(11, 11), RtTileKind.station, ME, 0)
            map.setTile(map.idx(12, 12), RtTileKind.depot, ME, 0)
            const before = snapshot(map)
            expect(removeRoad(map, ME, tile, RT_ROAD_X, busy, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            expect(removeRoad(map, ME, map.idx(11, 11), RT_ROAD_X, free, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            expect(removeRoad(map, ME, map.idx(12, 12), RT_ROAD_X, free, true)).toEqual({ ok: false, error: RtBuildError.conflict })
            expect(removeRoad(map, ME, map.idx(13, 13), RT_ROAD_X, free, true)).toEqual({ ok: false, error: RtBuildError.invalid })
            expectUnchanged(map, before)
            expect(removeRoad(map, ME, tile, RT_ROAD_X, free, true)).toEqual({ ok: true, cost: 2 * C.removeRoad })
            expect(rtRoadBits(map.payload[tile]!)).toBe(RT_ROAD_Y)
            expect(removeRoad(map, ME, tile, RT_ROAD_X, free, true)).toEqual({ ok: false, error: RtBuildError.invalid })
        })
    })

    describe('hostile input', () => {
        it('refuses garbage parameters with invalid and never throws or writes', () => {
            const map = new RtMap(64)
            buildRail(map, ME, map.idx(1, 1), RtTrack.x, true)
            buildRoad(map, ME, map.idx(2, 2), RT_ROAD_X, true)
            const before = snapshot(map)
            const junk = [-1, 1.5, NaN, Infinity, 1e12, map.tileCount, 2 ** 32, '3' as unknown as number, null as unknown as number]
            for (const bad of junk) {
                expect(buildRail(map, bad, map.idx(5, 5), RtTrack.x, true)).toEqual({ ok: false, error: RtBuildError.invalid })
                expect(buildRail(map, ME, bad, RtTrack.x, true)).toEqual({ ok: false, error: RtBuildError.invalid })
                expect(buildRail(map, ME, map.idx(5, 5), bad, true)).toEqual({ ok: false, error: RtBuildError.invalid })
                expect(removeRail(map, ME, bad, RtTrack.x, free, true)).toEqual({ ok: false, error: RtBuildError.invalid })
                expect(removeRail(map, ME, map.idx(1, 1), bad, free, true)).toEqual({ ok: false, error: RtBuildError.invalid })
                expect(buildRoad(map, ME, map.idx(5, 5), bad, true)).toEqual({ ok: false, error: RtBuildError.invalid })
                expect(buildRoad(map, bad, map.idx(5, 5), RT_ROAD_X, true)).toEqual({ ok: false, error: RtBuildError.invalid })
                expect(removeRoad(map, ME, map.idx(2, 2), bad, free, true)).toEqual({ ok: false, error: RtBuildError.invalid })
            }
            expect(buildRail(map, RT_CATALOG.caps.maxCompanies, map.idx(5, 5), RtTrack.x, true).ok).toBe(false)
            expect(buildRoad(map, ME, map.idx(5, 5), 16, true).ok).toBe(false)
            expect(removeRail(map, ME, map.idx(1, 1), RtTrack.x, undefined as unknown as () => boolean, true).ok).toBe(false)
            expectUnchanged(map, before)
        })
    })
})
