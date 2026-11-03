/**
 * Company infrastructure counts: track pieces, road bits, signals, station tiles and depots per
 * company, which monthly upkeep charges. They are derived state: never saved or hashed, recounted
 * from the map on decode and after a bankruptcy reset, and kept incrementally between, by subtracting
 * what a command's tiles counted before it ran and adding what they count after (applyCommand).
 */

import { RtTileKind, type RtMap } from './map'
import { RtStationTile, rtRoadStopBits, rtRoadStopRoadOwner, rtStationTileType } from './stations-build'
import { rtRoadBits } from './tile-payloads'
import {
    RT_TRACK_COUNT,
    rtBitCount,
    rtCrossingRoadBits,
    rtCrossingRoadOwner,
    rtIsCrossing,
    rtPieceHasSignal,
    rtRailPieces,
    rtValidCompany,
    type RtTrack
} from './track'
import type { RtCompany, RtInfrastructure } from './types'

/** What the counts read: the map and the companies by id. RtWorld satisfies it. */
export interface RtInfrastructureWorld {
    readonly map: RtMap
    readonly companies: readonly (RtCompany | null)[]
}

export function rtEmptyInfrastructure(): RtInfrastructure {
    return { railPieces: 0, roadPieces: 0, signals: 0, stationTiles: 0, depots: 0 }
}

/**
 * Adds `sign` times what one tile counts to its owners: the rail owner's pieces and signals and the
 * road owner's bits on a level crossing, a platform as a station tile and a track piece, a road stop
 * as a station tile and its road bits for the road's owner, a depot as a depot. Unowned road and
 * anything owned by no company counts for nobody.
 */
function addTile(world: RtInfrastructureWorld, tile: number, sign: number): void {
    const map = world.map
    const add = (owner: number, key: keyof RtInfrastructure, amount: number) => {
        if (amount === 0 || !rtValidCompany(owner)) return
        const company = world.companies[owner]
        if (company) company.infrastructure[key] += sign * amount
    }
    const owner = map.owner[tile]!
    const payload = map.payload[tile]!
    switch (map.kind[tile]) {
        case RtTileKind.rail: {
            const pieces = rtRailPieces(payload)
            add(owner, 'railPieces', rtBitCount(pieces))
            if (rtIsCrossing(payload)) {
                add(rtCrossingRoadOwner(payload), 'roadPieces', rtBitCount(rtCrossingRoadBits(payload)))
                break
            }
            for (let piece = 0; piece < RT_TRACK_COUNT; piece++) {
                if ((pieces & (1 << piece)) !== 0 && rtPieceHasSignal(payload, piece as RtTrack)) add(owner, 'signals', 1)
            }
            break
        }
        case RtTileKind.road:
            add(owner, 'roadPieces', rtBitCount(rtRoadBits(payload)))
            break
        case RtTileKind.station:
            add(owner, 'stationTiles', 1)
            if (rtStationTileType(payload) === RtStationTile.rail) add(owner, 'railPieces', 1)
            else add(rtRoadStopRoadOwner(payload), 'roadPieces', rtBitCount(rtRoadStopBits(payload)))
            break
        case RtTileKind.depot:
            add(owner, 'depots', 1)
            break
        default:
            break
    }
}

/** Adds (sign 1) or takes away (sign -1) what the tiles count; tiles off the map and repeats are skipped. */
export function rtCountTiles(world: RtInfrastructureWorld, tiles: Iterable<number>, sign: 1 | -1): void {
    const seen = new Set<number>()
    for (const tile of tiles) {
        if (!world.map.validTile(tile) || seen.has(tile)) continue
        seen.add(tile)
        addTile(world, tile, sign)
    }
}

/** Every company's counts from a full scan of the map (decode, a reset, and the tests' rescan). */
export function rtRecountInfrastructure(world: RtInfrastructureWorld): void {
    for (const company of world.companies) if (company) company.infrastructure = rtEmptyInfrastructure()
    const count = world.map.side * world.map.side
    for (let tile = 0; tile < count; tile++) addTile(world, tile, 1)
}
