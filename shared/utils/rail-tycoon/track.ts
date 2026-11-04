/**
 * Rail track rules: laying and removing one track piece, the shared RtBuildResult every
 * builder returns, and the rail tile payload layout signals.ts reads for signals and reservations.
 * Behaviour mimics the original game at its default settings; the code is written from scratch.
 *
 * Rail payload (32 bits, kind rail):
 *   bits 0-5    track pieces present, one bit per RtTrack
 *   bit  6      level crossing; the tile then holds exactly one straight and the perpendicular road
 *   bits 7-12   reservation, one bit per RtTrack (bit 7 + piece)
 *   bits 13-20  signal slot 0; on a level crossing this byte holds the road's owner (255 a town)
 *   bits 21-28  signal slot 1
 *   bits 29-31  unused, always 0 (bit 29 is kept free for the siding flag)
 * A signal slot byte: bits 0-2 the signalled piece (RT_SIGNAL_SLOT_EMPTY when the slot is empty),
 * bit 3 the type (0 block, 1 path), bits 4-5 presence per direction, bits 6-7 aspect per direction
 * (1 green, 0 red). A tile carries at most two signalled pieces; a crossing carries none.
 */

import { RT_CATALOG } from './catalog'
import { RT_ROAD_DIR_BIT, RtDir, RtTileKind, rtReverseDir, rtTreeCount, type RtMap } from './map'
import { RtAxis, RtStationTile, rtDepotFacingBits, rtDepotKind, rtRoadBits, rtStationAxis, rtStationTileType } from './tile-payloads'
import { RT_OWNER_NONE, RtVehicleKind, type RtVehicle } from './types'

/* ------------------------------------------------------------------------------------------
 * The shared build result
 * ---------------------------------------------------------------------------------------- */

/** Why a build or removal was refused. */
export const RtBuildError = {
    /** Something else stands on the tile (a house, an industry, a road that cannot be crossed). */
    occupied: 0,
    /** The tile or the object belongs to another company or a town. */
    notOwner: 1,
    /** The land is sloped the wrong way, or steep. */
    badSlope: 2,
    /** Water, or the sea-level side of a coast tile. */
    water: 3,
    /** A vehicle, a signal, a reservation or a road stop/depot is in the way, or more than one station adjoins. */
    conflict: 4,
    /** A footprint or a depot's front tile runs off the map. */
    edge: 5,
    /** The station would span more than RT_CATALOG stationSpread tiles in a direction. */
    tooSpread: 6,
    /** Exactly this is already built; a line command treats it as success at no cost. */
    alreadyBuilt: 7,
    /** A parameter is out of range or names nothing there (hostile or stale input). */
    invalid: 8,
    /** A world cap (RT_CATALOG.caps) would be exceeded. */
    limit: 9,
    /**
     * The road runs the other way: a drive-through stop across a road. 16, past RtCommandError's own
     * codes (10 to 15), since the codes go out on the wire.
     */
    wrongDirection: 16
} as const
export type RtBuildError = typeof RtBuildError[keyof typeof RtBuildError]

/**
 * ok with the signed cost (positive a cost, negative a refund; the caller books it), or a refusal.
 * Station builders add the id of the station built or joined.
 */
export type RtBuildResult = { ok: true, cost: number, station?: number } | { ok: false, error: RtBuildError }

export function rtBuildOk(cost: number, station?: number): RtBuildResult {
    return station === undefined ? { ok: true, cost } : { ok: true, cost, station }
}

export function rtBuildFail(error: RtBuildError): RtBuildResult {
    return { ok: false, error }
}

/** Reports whether any vehicle (train, road vehicle or depot occupant) is on a tile. */
export type RtOccupied = (tile: number) => boolean

/**
 * The reservation side of the train rules, passed in by the caller (wired by the
 * commands in commands.ts). Removing a reserved piece, platform or depot tile needs them; without them such
 * a removal is refused with conflict, so a train's reservation is never silently lost.
 */
export interface RtReservationHooks {
    /** The train whose reservation covers (tile, piece), scanning trains in ascending id; null when none. */
    reserverOf(tile: number, piece: RtTrack): RtVehicle | null
    /** Releases that train's reservation ahead of its head, so it stops and waits. */
    releaseAhead(vehicle: RtVehicle): void
    /** Asks that train to reserve again from its head before the command returns. */
    reserveAgain(vehicle: RtVehicle): void
}

/** Whether owner is a company id a builder accepts. */
export function rtValidCompany(owner: number): boolean {
    return Number.isInteger(owner) && owner >= 0 && owner < RT_CATALOG.caps.maxCompanies
}

/** Number of set bits in a small non-negative integer. */
export function rtBitCount(bits: number): number {
    let n = 0
    let b = bits >>> 0
    while (b !== 0) {
        b &= b - 1
        n++
    }
    return n
}

/* ------------------------------------------------------------------------------------------
 * Track pieces and the payload
 * ---------------------------------------------------------------------------------------- */

/**
 * The six track pieces, in the original's order. x runs along the x axis (north-east to south-west
 * edge), y along the y axis (north-west to south-east edge); the four corner pieces each cut one
 * corner: upper the north corner (north-east to north-west edge), lower the south corner (south-east
 * to south-west), left the west corner (south-west to north-west), right the east corner (north-east
 * to south-east).
 */
export const RtTrack = { x: 0, y: 1, upper: 2, lower: 3, left: 4, right: 5 } as const
export type RtTrack = typeof RtTrack[keyof typeof RtTrack]
export const RT_TRACK_COUNT = 6

export const RT_RAIL_PIECES_MASK = 0x3f
export const RT_RAIL_CROSSING = 1 << 6
export const RT_RAIL_RESERVED_SHIFT = 7
export const RT_RAIL_RESERVED_MASK = 0x3f << RT_RAIL_RESERVED_SHIFT
/** Bit offsets of signal slots 0 and 1. */
export const RT_RAIL_SIGNAL_SHIFT: readonly number[] = [13, 21]
/** Piece field of an empty signal slot. */
export const RT_SIGNAL_SLOT_EMPTY = 7
export const RT_SIGNAL_PIECE_MASK = 7
/** Type bit of a signal slot: set for a path signal, clear for a block signal. */
export const RT_SIGNAL_PATH = 1 << 3
export const RT_SIGNAL_PRESENCE_SHIFT = 4
export const RT_SIGNAL_ASPECT_SHIFT = 6

/** Road bits of the x axis (north-east and south-west halves) and of the y axis. */
export const RT_ROAD_X = RT_ROAD_DIR_BIT[RtDir.ne]! | RT_ROAD_DIR_BIT[RtDir.sw]!
export const RT_ROAD_Y = RT_ROAD_DIR_BIT[RtDir.se]! | RT_ROAD_DIR_BIT[RtDir.nw]!

export function rtValidTrack(piece: number): piece is RtTrack {
    return Number.isInteger(piece) && piece >= 0 && piece < RT_TRACK_COUNT
}

/** Payload of plain rail holding the given piece bits, unreserved and without signals. */
export function rtRailPayload(pieces: number): number {
    return ((pieces & RT_RAIL_PIECES_MASK)
        | (RT_SIGNAL_SLOT_EMPTY << RT_RAIL_SIGNAL_SHIFT[0]!)
        | (RT_SIGNAL_SLOT_EMPTY << RT_RAIL_SIGNAL_SHIFT[1]!)) >>> 0
}

/** Payload of a level crossing: one straight piece, the road owner byte, optionally reserved. */
export function rtCrossingPayload(piece: RtTrack, roadOwner: number, reserved = false): number {
    return ((1 << piece)
        | RT_RAIL_CROSSING
        | (reserved ? 1 << (RT_RAIL_RESERVED_SHIFT + piece) : 0)
        | ((roadOwner & 0xff) << RT_RAIL_SIGNAL_SHIFT[0]!)
        | (RT_SIGNAL_SLOT_EMPTY << RT_RAIL_SIGNAL_SHIFT[1]!)) >>> 0
}

export function rtRailPieces(payload: number): number {
    return payload & RT_RAIL_PIECES_MASK
}

export function rtIsCrossing(payload: number): boolean {
    return (payload & RT_RAIL_CROSSING) !== 0
}

/** Road owner of a level crossing (RT_OWNER_NONE for a town road). */
export function rtCrossingRoadOwner(payload: number): number {
    return (payload >>> RT_RAIL_SIGNAL_SHIFT[0]!) & 0xff
}

/** A level crossing payload with its road part owned by `owner` instead, its rail piece and reservation kept. */
export function rtWithCrossingRoadOwner(payload: number, owner: number): number {
    let piece = 0
    while (piece < 5 && (rtRailPieces(payload) & (1 << piece)) === 0) piece++
    return rtCrossingPayload(piece as RtTrack, owner, rtRailPieceReserved(payload, piece as RtTrack))
}

/** Road bits of a level crossing: the full straight across its rail piece. */
export function rtCrossingRoadBits(payload: number): number {
    return (payload & (1 << RtTrack.x)) !== 0 ? RT_ROAD_Y : RT_ROAD_X
}

export function rtRailPieceReserved(payload: number, piece: RtTrack): boolean {
    return (payload & (1 << (RT_RAIL_RESERVED_SHIFT + piece))) !== 0
}

export function rtWithRailReservation(payload: number, piece: RtTrack, reserved: boolean): number {
    const bit = 1 << (RT_RAIL_RESERVED_SHIFT + piece)
    return (reserved ? payload | bit : payload & ~bit) >>> 0
}

/** Signal slot k (0 or 1) as its 8-bit value. Meaningless on a crossing, whose slot 0 is the road owner. */
export function rtSignalSlot(payload: number, k: number): number {
    return (payload >>> RT_RAIL_SIGNAL_SHIFT[k & 1]!) & 0xff
}

export function rtWithSignalSlot(payload: number, k: number, slot: number): number {
    const shift = RT_RAIL_SIGNAL_SHIFT[k & 1]!
    return ((payload & ~(0xff << shift)) | ((slot & 0xff) << shift)) >>> 0
}

/** Whether a piece carries a signal (never on a crossing). */
export function rtPieceHasSignal(payload: number, piece: RtTrack): boolean {
    if (rtIsCrossing(payload)) return false
    return (rtSignalSlot(payload, 0) & RT_SIGNAL_PIECE_MASK) === piece
        || (rtSignalSlot(payload, 1) & RT_SIGNAL_PIECE_MASK) === piece
}

/** Whether any piece of the tile carries a signal. */
export function rtRailHasSignals(payload: number): boolean {
    if (rtIsCrossing(payload)) return false
    return (rtSignalSlot(payload, 0) & RT_SIGNAL_PIECE_MASK) !== RT_SIGNAL_SLOT_EMPTY
        || (rtSignalSlot(payload, 1) & RT_SIGNAL_PIECE_MASK) !== RT_SIGNAL_SLOT_EMPTY
}

const HORIZONTAL_PAIR = (1 << RtTrack.upper) | (1 << RtTrack.lower)
const VERTICAL_PAIR = (1 << RtTrack.left) | (1 << RtTrack.right)

/** Whether pieces cross or touch each other: any two or more, except the two parallel corner pairs. */
export function rtTracksOverlap(pieces: number): boolean {
    const bits = pieces & RT_RAIL_PIECES_MASK
    if (bits === HORIZONTAL_PAIR || bits === VERTICAL_PAIR) return false
    return rtBitCount(bits) > 1
}

/* ------------------------------------------------------------------------------------------
 * Slopes
 * ---------------------------------------------------------------------------------------- */

/** The four corner heights of a tile, named by compass corner. */
export interface RtCorners {
    n: number
    w: number
    e: number
    s: number
}

export function rtTileCorners(map: RtMap, tile: number): RtCorners {
    const x = map.tileX(tile)
    const y = map.tileY(tile)
    return {
        n: map.cornerHeight(x, y),
        w: map.cornerHeight(x + 1, y),
        e: map.cornerHeight(x, y + 1),
        s: map.cornerHeight(x + 1, y + 1)
    }
}

function isSteep(c: RtCorners): boolean {
    return Math.max(c.n, c.w, c.e, c.s) - Math.min(c.n, c.w, c.e, c.s) >= 2
}

/**
 * Whether a piece lies on level ground without a foundation: a straight needs its two end edges
 * level (flat, or a ramp climbing along it), a corner piece needs the three corners of its half level.
 */
function pieceFits(c: RtCorners, piece: number): boolean {
    switch (piece) {
        case RtTrack.x: return c.n === c.e && c.w === c.s
        case RtTrack.y: return c.n === c.w && c.e === c.s
        case RtTrack.upper: return c.n === c.w && c.n === c.e
        case RtTrack.lower: return c.w === c.s && c.e === c.s
        case RtTrack.left: return c.n === c.w && c.w === c.s
        default: return c.n === c.e && c.e === c.s
    }
}

/** Lowest corner a piece touches; a piece touching sea level on a coast tile would flood. */
function pieceLowCorner(c: RtCorners, piece: number): number {
    switch (piece) {
        case RtTrack.upper: return Math.min(c.n, c.w, c.e)
        case RtTrack.lower: return Math.min(c.w, c.e, c.s)
        case RtTrack.left: return Math.min(c.n, c.w, c.s)
        case RtTrack.right: return Math.min(c.n, c.e, c.s)
        default: return Math.min(c.n, c.w, c.e, c.s)
    }
}

/**
 * Whether a set of pieces may lie on a tile: badSlope for a steep slope or a piece that needs a
 * foundation (there are none), water for a coast piece touching sea level, null when it fits.
 */
export function rtRailSlopeError(map: RtMap, tile: number, pieces: number): RtBuildError | null {
    const c = rtTileCorners(map, tile)
    if (isSteep(c)) return RtBuildError.badSlope
    for (let piece = 0; piece < RT_TRACK_COUNT; piece++) {
        if ((pieces & (1 << piece)) === 0) continue
        if (!pieceFits(c, piece)) return RtBuildError.badSlope
    }
    if (map.kind[tile] === RtTileKind.coast) {
        for (let piece = 0; piece < RT_TRACK_COUNT; piece++) {
            if ((pieces & (1 << piece)) !== 0 && pieceLowCorner(c, piece) === 0) return RtBuildError.water
        }
    }
    return null
}

/** Cost of clearing what stands on a buildable tile: trees at the catalog price per tree, else nothing. */
export function rtClearingCost(map: RtMap, tile: number): number {
    if (map.kind[tile] !== RtTileKind.tree) return 0
    return RT_CATALOG.construction.clearTrees * rtTreeCount(map.payload[tile]!)
}

/* ------------------------------------------------------------------------------------------
 * Build one piece
 * ---------------------------------------------------------------------------------------- */

/**
 * Lays one track piece for a company. Allowed on clear land, coast above sea level and trees (cleared
 * at catalog cost), and on the company's own plain rail not already holding the piece. A straight
 * across a straight road on flat land makes a level crossing whoever owns the road, completing
 * a half road at road cost; the crossing keeps the road owner in its first signal slot byte. Refused on
 * water, houses, industries, stations, depots and other companies' rail. Adding a piece that crosses
 * existing ones is refused while the tile carries signals or, when occupied is given, a vehicle.
 * With apply false nothing is written.
 */
export function buildRail(map: RtMap, owner: number, tile: number, piece: number, apply: boolean, occupied?: RtOccupied): RtBuildResult {
    if (!rtValidCompany(owner) || !map.validTile(tile) || !rtValidTrack(piece)) return rtBuildFail(RtBuildError.invalid)
    const bit = 1 << piece
    const prices = RT_CATALOG.construction
    switch (map.kind[tile]) {
        case RtTileKind.water:
            return rtBuildFail(RtBuildError.water)
        case RtTileKind.rail: {
            if (map.owner[tile] !== owner) return rtBuildFail(RtBuildError.notOwner)
            const payload = map.payload[tile]!
            const pieces = rtRailPieces(payload)
            if ((pieces & bit) !== 0) return rtBuildFail(RtBuildError.alreadyBuilt)
            if (rtIsCrossing(payload)) return rtBuildFail(RtBuildError.occupied)
            const combined = pieces | bit
            const slope = rtRailSlopeError(map, tile, combined)
            if (slope !== null) return rtBuildFail(slope)
            if (rtTracksOverlap(combined)) {
                if (rtRailHasSignals(payload)) return rtBuildFail(RtBuildError.conflict)
                if (occupied && occupied(tile)) return rtBuildFail(RtBuildError.conflict)
            }
            if (apply === true) map.payload[tile] = (payload | bit) >>> 0
            return rtBuildOk(prices.track)
        }
        case RtTileKind.road: {
            const roadBits = rtRoadBits(map.payload[tile]!)
            const across = piece === RtTrack.x ? RT_ROAD_Y : piece === RtTrack.y ? RT_ROAD_X : 0
            if (across === 0 || roadBits === 0 || (roadBits & ~across) !== 0) return rtBuildFail(RtBuildError.occupied)
            if (!map.isFlat(tile)) return rtBuildFail(RtBuildError.badSlope)
            if (occupied && occupied(tile)) return rtBuildFail(RtBuildError.conflict)
            const missing = 2 - rtBitCount(roadBits)
            if (apply === true) map.setTile(tile, RtTileKind.rail, owner, rtCrossingPayload(piece, map.owner[tile]!))
            return rtBuildOk(prices.track + missing * prices.road)
        }
        case RtTileKind.clear:
        case RtTileKind.coast:
        case RtTileKind.tree: {
            const slope = rtRailSlopeError(map, tile, bit)
            if (slope !== null) return rtBuildFail(slope)
            const cost = prices.track + rtClearingCost(map, tile)
            if (apply === true) map.setTile(tile, RtTileKind.rail, owner, rtRailPayload(bit))
            return rtBuildOk(cost)
        }
        default:
            return rtBuildFail(RtBuildError.occupied)
    }
}

/* ------------------------------------------------------------------------------------------
 * Remove one piece
 * ---------------------------------------------------------------------------------------- */

/**
 * Removes one of the company's own track pieces, refunding RT_CATALOG removeRailRefund (a negative
 * cost). Refused with conflict while a vehicle is on the tile or the piece carries a signal.
 * The last piece leaves clear land; the rail of a level crossing leaves the road, owned by the owner
 * in the crossing's road-owner byte. A reserved piece is not refused: with apply, the
 * reserving train's reservation ahead is released first, the piece removed, and the train asked to
 * reserve again before returning; that needs `reservations`, without which a reserved
 * piece is refused with conflict.
 */
export function removeRail(map: RtMap, owner: number, tile: number, piece: number, occupied: RtOccupied, apply: boolean, reservations?: RtReservationHooks): RtBuildResult {
    if (!rtValidCompany(owner) || !map.validTile(tile) || !rtValidTrack(piece) || typeof occupied !== 'function') {
        return rtBuildFail(RtBuildError.invalid)
    }
    if (map.kind[tile] !== RtTileKind.rail) return rtBuildFail(RtBuildError.invalid)
    if (map.owner[tile] !== owner) return rtBuildFail(RtBuildError.notOwner)
    const payload = map.payload[tile]!
    if ((rtRailPieces(payload) & (1 << piece)) === 0) return rtBuildFail(RtBuildError.invalid)
    if (occupied(tile)) return rtBuildFail(RtBuildError.conflict)
    if (rtPieceHasSignal(payload, piece)) return rtBuildFail(RtBuildError.conflict)
    const reserved = rtRailPieceReserved(payload, piece)
    if (reserved && !reservations) return rtBuildFail(RtBuildError.conflict)
    const cost = -RT_CATALOG.construction.removeRailRefund
    if (apply !== true) return rtBuildOk(cost)

    const train = reserved && reservations ? reservations.reserverOf(tile, piece) : null
    if (train && reservations) reservations.releaseAhead(train)
    // the release may have changed reservation bits, so build from the payload as it is now
    const now = map.payload[tile]!
    if (rtIsCrossing(now)) {
        const roadOwner = rtCrossingRoadOwner(now)
        map.setTile(tile, RtTileKind.road, roadOwner, rtCrossingRoadBits(now))
    } else {
        const remaining = rtRailPieces(now) & ~(1 << piece)
        if (remaining === 0) {
            map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
        } else {
            map.payload[tile] = (rtWithRailReservation(now, piece, false) & ~(1 << piece)) >>> 0
        }
    }
    if (train && reservations) reservations.reserveAgain(train)
    return rtBuildOk(cost)
}

/* ------------------------------------------------------------------------------------------
 * Trackdirs and track following
 * ---------------------------------------------------------------------------------------- */

/**
 * A trackdir is a track piece plus a travel direction, in the original's numbering: the piece index
 * (RtTrack) for one direction and piece + 8 for the other, so bit 3 is the reverse flag and 6, 7, 14
 * and 15 are never trackdirs. Names give the compass direction of travel: xNe runs the x piece
 * towards its north-east edge, upperE the upper corner from its north-west to its north-east edge.
 */
export const RtTrackdir = {
    xNe: 0, ySe: 1, upperE: 2, lowerE: 3, leftS: 4, rightS: 5,
    xSw: 8, yNw: 9, upperW: 10, lowerW: 11, leftN: 12, rightN: 13
} as const
export type RtTrackdir = typeof RtTrackdir[keyof typeof RtTrackdir]

/** Exclusive upper bound of a trackdir value (13 is the highest). */
export const RT_TRACKDIR_END = 14
/** Set in the reverse trackdir of each piece. */
export const RT_TRACKDIR_REVERSE = 8

/** A set of trackdirs as bits (bit td), what followTrack returns. */
export type RtTrackdirBits = number

/** Edge each trackdir leaves its tile through (RtDir), -1 for a value that is no trackdir. */
const TRACKDIR_EXIT: readonly number[] = [0, 1, 0, 1, 2, 1, -1, -1, 2, 3, 3, 2, 3, 0, -1, -1]
/** Edge each trackdir enters its tile through (RtDir). */
const TRACKDIR_ENTRY: readonly number[] = [2, 3, 3, 2, 3, 0, -1, -1, 0, 1, 0, 1, 2, 1, -1, -1]
/** Compass direction of travel, in RT_SPRITE_DIRECTIONS order (n 0, ne 1, e 2, se 3, s 4, sw 5, w 6, nw 7). */
const TRACKDIR_DIRECTION: readonly number[] = [1, 3, 2, 2, 4, 4, -1, -1, 5, 7, 6, 6, 0, 0, -1, -1]

/** The trackdirs a train can take into a tile while moving in each RtDir (entering through the opposite edge). */
const ENTER_MASK: readonly number[] = (() => {
    const masks = [0, 0, 0, 0]
    for (let td = 0; td < 16; td++) {
        const entry = TRACKDIR_ENTRY[td]!
        if (entry >= 0) {
            const dir = rtReverseDir(entry as RtDir)
            masks[dir] = masks[dir]! | (1 << td)
        }
    }
    return masks
})()

/** Whether a value is a trackdir (0-5 or 8-13). */
export function rtValidTrackdir(td: number): td is RtTrackdir {
    return Number.isInteger(td) && td >= 0 && td < RT_TRACKDIR_END && (td & 7) < RT_TRACK_COUNT
}

/**
 * The track piece of a trackdir, for world.occupied.rebuild and the save decoder. Throws RangeError
 * on a value that is no trackdir.
 */
export function rtTrackdirPiece(td: number): RtTrack {
    if (!rtValidTrackdir(td)) throw new RangeError(`bad trackdir: ${td}`)
    return (td & 7) as RtTrack
}

/** The trackdir running a piece one way (reversed false: the 0-5 direction) or the other. */
export function rtTrackdirOf(piece: RtTrack, reversed: boolean): RtTrackdir {
    return (reversed ? piece + RT_TRACKDIR_REVERSE : piece) as RtTrackdir
}

/** The same piece travelled the other way. */
export function rtReverseTrackdir(td: RtTrackdir): RtTrackdir {
    return (td ^ RT_TRACKDIR_REVERSE) as RtTrackdir
}

/**
 * Edge (RtDir) a trackdir leaves its tile through, which is also the direction it moves on in.
 * Callers pass a valid trackdir (rtValidTrackdir); anything else gives -1.
 */
export function rtTrackdirExitDir(td: number): RtDir {
    return TRACKDIR_EXIT[td & 15]! as RtDir
}

/** Edge (RtDir) a trackdir enters its tile through; -1 for a value that is no trackdir. */
export function rtTrackdirEntryEdge(td: number): RtDir {
    return TRACKDIR_ENTRY[td & 15]! as RtDir
}

/** Compass direction of travel, 0 north to 7 north-west clockwise (RT_SPRITE_DIRECTIONS order); -1 for no trackdir. */
export function rtTrackdirDirection(td: number): number {
    return TRACKDIR_DIRECTION[td & 15]!
}

/** Trackdirs a train moving in `dir` can be on right after crossing into a tile, as bits. */
export function rtTrackdirsEnteringWith(dir: RtDir): RtTrackdirBits {
    return ENTER_MASK[dir & 3]!
}

/** Both trackdirs of each piece in a piece bit set. */
export function rtPieceTrackdirs(pieces: number): RtTrackdirBits {
    const bits = pieces & RT_RAIL_PIECES_MASK
    return bits | (bits << RT_TRACKDIR_REVERSE)
}

/** The trackdirs in a bit set, ascending (the original's trackdir order). */
export function rtTrackdirList(bits: RtTrackdirBits): RtTrackdir[] {
    const out: RtTrackdir[] = []
    for (let td = 0; td < RT_TRACKDIR_END; td++) if ((bits & (1 << td)) !== 0) out.push(td as RtTrackdir)
    return out
}

/** The lowest trackdir in a bit set (the first connecting piece in trackdir order), or -1 when empty. */
export function rtFirstTrackdir(bits: RtTrackdirBits): number {
    if ((bits & 0x3f3f) === 0) return -1
    return 31 - Math.clz32((bits & 0x3f3f) & -(bits & 0x3f3f))
}

/** The two edges (RtDir) a piece touches. */
export function rtPieceEdges(piece: RtTrack): [RtDir, RtDir] {
    return [TRACKDIR_ENTRY[piece]! as RtDir, TRACKDIR_EXIT[piece]! as RtDir]
}

/** The piece joining two different edges of a tile, or -1 when a == b. */
export function rtPieceBetween(a: RtDir, b: RtDir): number {
    for (let piece = 0; piece < RT_TRACK_COUNT; piece++) {
        const ea = TRACKDIR_ENTRY[piece]!
        const eb = TRACKDIR_EXIT[piece]!
        if ((ea === a && eb === b) || (ea === b && eb === a)) return piece
    }
    return -1
}

/**
 * The rail pieces a vehicle can use on a tile, as piece bits, whoever owns it: rail pieces (a level
 * crossing's one straight), a rail platform's straight along its axis, a rail depot's straight along
 * its facing; 0 for anything else.
 */
export function rtRailTilePieces(map: RtMap, tile: number): number {
    const payload = map.payload[tile]!
    switch (map.kind[tile]) {
        case RtTileKind.rail:
            return rtRailPieces(payload)
        case RtTileKind.station:
            if (rtStationTileType(payload) !== RtStationTile.rail) return 0
            return 1 << (rtStationAxis(payload) === RtAxis.y ? RtTrack.y : RtTrack.x)
        case RtTileKind.depot:
            if (rtDepotKind(payload) !== RtVehicleKind.rail) return 0
            return 1 << ((rtDepotFacingBits(payload) & 1) === 0 ? RtTrack.x : RtTrack.y)
        default:
            return 0
    }
}

/** Facing (RtDir) of a rail depot tile, or -1 for any other tile. */
export function rtRailDepotFacing(map: RtMap, tile: number): number {
    if (map.kind[tile] !== RtTileKind.depot) return -1
    const payload = map.payload[tile]!
    return rtDepotKind(payload) === RtVehicleKind.rail ? rtDepotFacingBits(payload) : -1
}

/**
 * Whether rail on a tile can be left through edge `dir`: a piece touches it, and a depot only
 * through its entrance.
 */
export function rtRailCanExit(map: RtMap, tile: number, dir: RtDir): boolean {
    const facing = rtRailDepotFacing(map, tile)
    if (facing >= 0) return facing === dir
    const pieces = rtRailTilePieces(map, tile)
    return (rtPieceTrackdirs(pieces) & rtTrackdirsEnteringWith(rtReverseDir(dir))) !== 0
}

/**
 * The trackdirs on the tile beyond edge `exitDir` of `tile` that a train of `owner` can take
 * after leaving through that edge, as bits (bit td). The one connectivity rule for signal blocks,
 * reservations, the route search and movement.
 *
 * None when the tile itself cannot be left that way (no piece touches the edge, a depot's back or
 * side), at the map edge, or into another company's rail, platform or depot while sharing is off;
 * with sharing on any company's track connects like the owner's own. A level crossing
 * offers its straight, a platform its straight along the axis, a depot only its straight entered
 * through its entrance. Signals are not considered: a one-way signal facing against the train is
 * the caller's check (signals.ts rtOneWayBlocked).
 */
export function followTrack(map: RtMap, tile: number, exitDir: number, owner: number, sharing: boolean): RtTrackdirBits {
    if (!map.validTile(tile) || !Number.isInteger(exitDir) || exitDir < 0 || exitDir > 3) return 0
    const dir = exitDir as RtDir
    if (!rtRailCanExit(map, tile, dir)) return 0
    const next = map.neighbour(tile, dir)
    if (next < 0) return 0
    if (sharing !== true && map.owner[next] !== owner) return 0
    const facing = rtRailDepotFacing(map, next)
    if (facing >= 0 && facing !== rtReverseDir(dir)) return 0
    return rtPieceTrackdirs(rtRailTilePieces(map, next)) & rtTrackdirsEnteringWith(dir)
}
