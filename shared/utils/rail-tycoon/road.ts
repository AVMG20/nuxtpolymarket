/**
 * Road rules: laying and removing road bits. Behaviour mimics the original game at its
 * default settings; the code is written from scratch.
 *
 * Road payload (kind road): bits 0-3 the road bits (RT_ROAD_DIR_BIT, one per half-tile direction),
 * every other bit 0. The tile's owner byte is the road owner: a company id, or RT_OWNER_NONE for a
 * town road. A level crossing is a rail tile (see track.ts); its road owner lives in the payload.
 */

import { RT_CATALOG } from './catalog'
import { RT_ROAD_DIR_BIT, RtDir, RtTileKind, type RtMap } from './map'
import {
    RT_ROAD_X,
    RT_ROAD_Y,
    RtBuildError,
    RtTrack,
    rtBitCount,
    rtBuildFail,
    rtBuildOk,
    rtClearingCost,
    rtCrossingPayload,
    rtCrossingRoadBits,
    rtCrossingRoadOwner,
    rtIsCrossing,
    rtRailHasSignals,
    rtRailPayload,
    rtRailPieceReserved,
    rtRailPieces,
    rtTileCorners,
    rtValidCompany,
    rtWithRailReservation,
    type RtBuildResult,
    type RtOccupied
} from './track'
import { RT_ROAD_BITS_MASK, rtRoadBits } from './tile-payloads'
import { RT_OWNER_NONE } from './types'

export { RT_ROAD_BITS_MASK, rtRoadBits } from './tile-payloads'

function validBits(bits: number): boolean {
    return Number.isInteger(bits) && bits > 0 && bits <= RT_ROAD_BITS_MASK
}

/** Corners each road bit's half touches, for the coast sea-level test. */
const ROAD_BIT_CORNERS: readonly (readonly ('n' | 'w' | 'e' | 's')[])[] = (() => {
    const out: ('n' | 'w' | 'e' | 's')[][] = []
    out[RT_ROAD_DIR_BIT[RtDir.ne]!] = ['n', 'e']
    out[RT_ROAD_DIR_BIT[RtDir.se]!] = ['e', 's']
    out[RT_ROAD_DIR_BIT[RtDir.sw]!] = ['w', 's']
    out[RT_ROAD_DIR_BIT[RtDir.nw]!] = ['n', 'w']
    return out
})()

/**
 * Whether road bits may lie on a tile: flat land takes any bits, a ramp only bits along its climbing
 * axis, anything else (one or three raised corners, steep) none; on a coast tile no bit may touch sea
 * level. Returns the refusal or null.
 */
export function rtRoadSlopeError(map: RtMap, tile: number, bits: number): RtBuildError | null {
    const c = rtTileCorners(map, tile)
    if (Math.max(c.n, c.w, c.e, c.s) - Math.min(c.n, c.w, c.e, c.s) >= 2) return RtBuildError.badSlope
    if ((bits & RT_ROAD_X) !== 0 && !(c.n === c.e && c.w === c.s)) return RtBuildError.badSlope
    if ((bits & RT_ROAD_Y) !== 0 && !(c.n === c.w && c.e === c.s)) return RtBuildError.badSlope
    if (map.kind[tile] === RtTileKind.coast) {
        for (let bit = 1; bit <= 8; bit <<= 1) {
            if ((bits & bit) === 0) continue
            if (ROAD_BIT_CORNERS[bit]!.some(corner => c[corner] === 0)) return RtBuildError.water
        }
    }
    return null
}

/* ------------------------------------------------------------------------------------------
 * Build road bits
 * ---------------------------------------------------------------------------------------- */

/**
 * Lays road bits for a company at RT_CATALOG road cost per added bit. Allowed on clear land, coast and
 * trees (cleared at catalog cost), and adding bits to the company's own road or a town road, whose
 * owner stays the town. Across a single straight of anyone's rail without signals, on flat land, a
 * road perpendicular to it makes a level crossing (the full straight, two bits' cost) that keeps the
 * rail owner as tile owner and records the road builder in the road-owner byte; a vehicle on
 * the tile (when occupied is given) refuses it. With apply false nothing is written.
 */
export function buildRoad(map: RtMap, owner: number, tile: number, bits: number, apply: boolean, occupied?: RtOccupied): RtBuildResult {
    if (!rtValidCompany(owner) || !map.validTile(tile) || !validBits(bits)) return rtBuildFail(RtBuildError.invalid)
    const prices = RT_CATALOG.construction
    switch (map.kind[tile]) {
        case RtTileKind.water:
            return rtBuildFail(RtBuildError.water)
        case RtTileKind.clear:
        case RtTileKind.coast:
        case RtTileKind.tree: {
            const slope = rtRoadSlopeError(map, tile, bits)
            if (slope !== null) return rtBuildFail(slope)
            const cost = prices.road * rtBitCount(bits) + rtClearingCost(map, tile)
            if (apply === true) map.setTile(tile, RtTileKind.road, owner, bits)
            return rtBuildOk(cost)
        }
        case RtTileKind.road: {
            const roadOwner = map.owner[tile]
            if (roadOwner !== owner && roadOwner !== RT_OWNER_NONE) return rtBuildFail(RtBuildError.notOwner)
            const existing = rtRoadBits(map.payload[tile]!)
            const added = bits & ~existing
            if (added === 0) return rtBuildFail(RtBuildError.alreadyBuilt)
            const slope = rtRoadSlopeError(map, tile, existing | added)
            if (slope !== null) return rtBuildFail(slope)
            if (apply === true) map.payload[tile] = existing | added
            return rtBuildOk(prices.road * rtBitCount(added))
        }
        case RtTileKind.rail: {
            const payload = map.payload[tile]!
            if (rtIsCrossing(payload)) {
                return (bits & ~rtCrossingRoadBits(payload)) === 0
                    ? rtBuildFail(RtBuildError.alreadyBuilt)
                    : rtBuildFail(RtBuildError.occupied)
            }
            const pieces = rtRailPieces(payload)
            if (pieces !== 1 << RtTrack.x && pieces !== 1 << RtTrack.y) return rtBuildFail(RtBuildError.occupied)
            const piece = pieces === 1 << RtTrack.x ? RtTrack.x : RtTrack.y
            const across = piece === RtTrack.x ? RT_ROAD_Y : RT_ROAD_X
            if ((bits & ~across) !== 0) return rtBuildFail(RtBuildError.occupied)
            if (rtRailHasSignals(payload)) return rtBuildFail(RtBuildError.conflict)
            if (!map.isFlat(tile)) return rtBuildFail(RtBuildError.badSlope)
            if (occupied && occupied(tile)) return rtBuildFail(RtBuildError.conflict)
            if (apply === true) {
                const reserved = rtRailPieceReserved(payload, piece)
                map.setTile(tile, RtTileKind.rail, map.owner[tile]!, rtCrossingPayload(piece, owner, reserved))
            }
            return rtBuildOk(prices.road * 2)
        }
        default:
            return rtBuildFail(RtBuildError.occupied)
    }
}

/* ------------------------------------------------------------------------------------------
 * Remove road bits
 * ---------------------------------------------------------------------------------------- */

/**
 * Removes the company's own road bits at RT_CATALOG removeRoad per bit. Town roads and other
 * companies' roads are refused with notOwner, a vehicle on the tile, a road stop or a depot
 * with conflict, bits that are not there with invalid. Removing every bit leaves clear land. On a
 * level crossing only the road owner in its road-owner byte may remove the road part, always the whole
 * straight (two bits' cost), which leaves the rail as plain rail of the rail owner.
 */
export function removeRoad(map: RtMap, owner: number, tile: number, bits: number, occupied: RtOccupied, apply: boolean): RtBuildResult {
    if (!rtValidCompany(owner) || !map.validTile(tile) || !validBits(bits) || typeof occupied !== 'function') {
        return rtBuildFail(RtBuildError.invalid)
    }
    const price = RT_CATALOG.construction.removeRoad
    switch (map.kind[tile]) {
        case RtTileKind.station:
        case RtTileKind.depot:
            return rtBuildFail(RtBuildError.conflict)
        case RtTileKind.road: {
            if (map.owner[tile] !== owner) return rtBuildFail(RtBuildError.notOwner)
            const existing = rtRoadBits(map.payload[tile]!)
            if ((bits & ~existing) !== 0) return rtBuildFail(RtBuildError.invalid)
            if (occupied(tile)) return rtBuildFail(RtBuildError.conflict)
            const remaining = existing & ~bits
            if (apply === true) {
                if (remaining === 0) map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
                else map.payload[tile] = remaining
            }
            return rtBuildOk(price * rtBitCount(bits))
        }
        case RtTileKind.rail: {
            const payload = map.payload[tile]!
            if (!rtIsCrossing(payload)) return rtBuildFail(RtBuildError.invalid)
            if (rtCrossingRoadOwner(payload) !== owner) return rtBuildFail(RtBuildError.notOwner)
            if ((bits & ~rtCrossingRoadBits(payload)) !== 0) return rtBuildFail(RtBuildError.invalid)
            if (occupied(tile)) return rtBuildFail(RtBuildError.conflict)
            if (apply === true) {
                const pieces = rtRailPieces(payload)
                const piece = pieces === 1 << RtTrack.x ? RtTrack.x : RtTrack.y
                map.payload[tile] = rtWithRailReservation(rtRailPayload(pieces), piece, rtRailPieceReserved(payload, piece))
            }
            return rtBuildOk(price * 2)
        }
        default:
            return rtBuildFail(RtBuildError.invalid)
    }
}
