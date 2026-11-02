/**
 * Signals and path reservations (goal 04): placing signals (W27), block signal aspects (W28), path
 * reservation (W29), releasing it (W30) and the RtReservationHooks the building commands use
 * (AR-118). Behaviour mimics the original game's block and path signals; the code is written from
 * scratch.
 *
 * A signal sits on one track piece and governs trains entering its tile along that piece: a train
 * whose trackdir has a red signal stops before the tile. The signal tile belongs to the blocks on
 * both of its sides, as the original's segments do. Presence and aspect bits of a slot are ordered
 * by trackdir: bit 0 for the piece's 0-5 trackdir, bit 1 for its reverse (piece + 8).
 */

import { RT_CATALOG } from './catalog'
import { rtDepotReserved, rtWithDepotReservation } from './depots'
import { RtMap, RtTileKind, rtReverseDir, type RtDir } from './map'
import { RtStationTile, rtPlatformReserved, rtPlatformTrack, rtStationTileType, rtWithPlatformReservation } from './stations-build'
import {
    RT_RAIL_RESERVED_MASK,
    RT_RAIL_SIGNAL_SHIFT,
    RT_SIGNAL_ASPECT_SHIFT,
    RT_SIGNAL_PATH,
    RT_SIGNAL_PIECE_MASK,
    RT_SIGNAL_PRESENCE_SHIFT,
    RT_SIGNAL_SLOT_EMPTY,
    RT_TRACK_COUNT,
    RT_TRACKDIR_REVERSE,
    RtBuildError,
    RtTrack,
    followTrack,
    rtBitCount,
    rtBuildFail,
    rtBuildOk,
    rtFirstTrackdir,
    rtIsCrossing,
    rtPieceEdges,
    rtPieceTrackdirs,
    rtRailDepotFacing,
    rtRailPieceReserved,
    rtRailPieces,
    rtRailTilePieces,
    rtSignalSlot,
    rtTracksOverlap,
    rtTrackdirExitDir,
    rtTrackdirsEnteringWith,
    rtValidCompany,
    rtValidTrack,
    rtValidTrackdir,
    rtWithRailReservation,
    rtWithSignalSlot,
    type RtBuildResult,
    type RtReservationHooks,
    type RtTrackdir
} from './track'
import { RtVehicleKind, RtVehicleState, type RtVehicle } from './types'

/** Signal types, the slot's type bit. */
export const RtSignalType = { block: 0, path: 1 } as const
export type RtSignalType = typeof RtSignalType[keyof typeof RtSignalType]

/**
 * Whether a train other than `except` holds the track piece (tile, piece): world.occupied's
 * otherTrainOnPiece(tile, piece, except) !== RT_NONE. Depot occupants and road vehicles never count
 * (AR-57). updateSignalStates passes except = -1, meaning any train.
 */
export type RtTrainOnPiece = (tile: number, piece: number, except: number) => boolean

const HALF_PRESENCE = [1 << RT_SIGNAL_PRESENCE_SHIFT, 1 << (RT_SIGNAL_PRESENCE_SHIFT + 1)] as const
const BOTH_PRESENCE = HALF_PRESENCE[0] | HALF_PRESENCE[1]
const HALF_ASPECT = [1 << RT_SIGNAL_ASPECT_SHIFT, 1 << (RT_SIGNAL_ASPECT_SHIFT + 1)] as const

/** Which presence/aspect half of a slot a trackdir uses: 0 for trackdirs 0-5, 1 for 8-13. */
function half(td: number): 0 | 1 {
    return (td & RT_TRACKDIR_REVERSE) !== 0 ? 1 : 0
}

/** Slot index (0 or 1) holding the piece's signal, or -1. */
function slotOf(payload: number, piece: number): number {
    if (rtIsCrossing(payload)) return -1
    if ((rtSignalSlot(payload, 0) & RT_SIGNAL_PIECE_MASK) === piece) return 0
    if ((rtSignalSlot(payload, 1) & RT_SIGNAL_PIECE_MASK) === piece) return 1
    return -1
}

/* ------------------------------------------------------------------------------------------
 * Reading and writing signals
 * ---------------------------------------------------------------------------------------- */

/** The type of the signal on a piece of a rail tile, or -1 when it has none. */
export function rtSignalTypeAt(map: RtMap, tile: number, piece: number): number {
    if (!map.validTile(tile) || map.kind[tile] !== RtTileKind.rail) return -1
    const payload = map.payload[tile]!
    const k = slotOf(payload, piece & 7)
    if (k < 0) return -1
    return (rtSignalSlot(payload, k) & RT_SIGNAL_PATH) !== 0 ? RtSignalType.path : RtSignalType.block
}

/** Whether a signal on the tile faces trains travelling `td` (governs them entering the tile). */
export function rtSignalOnTrackdir(map: RtMap, tile: number, td: number): boolean {
    if (!map.validTile(tile) || map.kind[tile] !== RtTileKind.rail) return false
    const payload = map.payload[tile]!
    const k = slotOf(payload, td & 7)
    if (k < 0) return false
    return (rtSignalSlot(payload, k) & HALF_PRESENCE[half(td)]) !== 0
}

/** Whether the signal facing `td` on the tile shows green; false when there is none. */
export function rtSignalGreen(map: RtMap, tile: number, td: number): boolean {
    if (!rtSignalOnTrackdir(map, tile, td)) return false
    const payload = map.payload[tile]!
    return (rtSignalSlot(payload, slotOf(payload, td & 7)) & HALF_ASPECT[half(td)]) !== 0
}

/** Sets the aspect of the signal facing `td`; returns whether it changed. */
export function rtSetSignalAspect(map: RtMap, tile: number, td: number, green: boolean): boolean {
    if (!rtSignalOnTrackdir(map, tile, td)) return false
    const payload = map.payload[tile]!
    const k = slotOf(payload, td & 7)
    const slot = rtSignalSlot(payload, k)
    const bit = HALF_ASPECT[half(td)]
    const next = green ? slot | bit : slot & ~bit
    if (next === slot) return false
    map.payload[tile] = rtWithSignalSlot(payload, k, next)
    return true
}

/**
 * Whether a one-way signal faces against trains travelling `td` (a signal for the other direction
 * only): the original treats that as impassable, for routes and for moving trains alike.
 */
export function rtOneWayBlocked(map: RtMap, tile: number, td: number): boolean {
    return rtSignalOnTrackdir(map, tile, td ^ RT_TRACKDIR_REVERSE) && !rtSignalOnTrackdir(map, tile, td)
}

/** The trackdirs of a set entered on `tile` that no one-way signal blocks. */
export function rtPassableTrackdirs(map: RtMap, tile: number, bits: number): number {
    let out = bits
    for (let td = 0; td < 14; td++) {
        if ((bits & (1 << td)) !== 0 && rtOneWayBlocked(map, tile, td)) out &= ~(1 << td)
    }
    return out
}

/* ------------------------------------------------------------------------------------------
 * W27: placing, cycling and removing a signal
 * ---------------------------------------------------------------------------------------- */

/**
 * Places a signal of `type` (RtSignalType) on one piece of the company's own plain rail, as the
 * original: never on a platform, depot or level crossing, nor on a tile whose pieces overlap (a
 * junction, AR-50), so at most two parallel diagonals of a tile carry one each. A new signal is
 * two-way, shows red until updateSignalStates runs, and costs RT_CATALOG signal. Placing again on a
 * signalled piece with the same type cycles it: both ways, one way (the piece's 0-5 trackdir), the
 * other way, then removes it at removeSignal; turning around is free, as the original. Placing the
 * other type converts the signal in place at the signal price, as the original. A reserved piece is
 * refused with conflict so a reservation's waiting point never moves under a train. Never throws.
 */
export function placeSignal(map: RtMap, owner: number, tile: number, piece: number, type: number, apply: boolean): RtBuildResult {
    if (!(map instanceof RtMap) || !rtValidCompany(owner) || !map.validTile(tile) || !rtValidTrack(piece)) {
        return rtBuildFail(RtBuildError.invalid)
    }
    if (type !== RtSignalType.block && type !== RtSignalType.path) return rtBuildFail(RtBuildError.invalid)
    if (map.kind[tile] !== RtTileKind.rail) return rtBuildFail(RtBuildError.invalid)
    if (map.owner[tile] !== owner) return rtBuildFail(RtBuildError.notOwner)
    const payload = map.payload[tile]!
    const pieces = rtRailPieces(payload)
    if ((pieces & (1 << piece)) === 0) return rtBuildFail(RtBuildError.invalid)
    if (rtIsCrossing(payload) || rtTracksOverlap(pieces)) return rtBuildFail(RtBuildError.conflict)
    if (rtRailPieceReserved(payload, piece)) return rtBuildFail(RtBuildError.conflict)
    const prices = RT_CATALOG.construction
    const typeBit = type === RtSignalType.path ? RT_SIGNAL_PATH : 0

    const k = slotOf(payload, piece)
    if (k >= 0) {
        const slot = rtSignalSlot(payload, k)
        if ((slot & RT_SIGNAL_PATH) !== typeBit) {
            if (apply === true) map.payload[tile] = rtWithSignalSlot(payload, k, (slot & ~RT_SIGNAL_PATH) | typeBit)
            return rtBuildOk(prices.signal)
        }
        const presence = slot & BOTH_PRESENCE
        if (presence === HALF_PRESENCE[1]) {
            if (apply === true) map.payload[tile] = rtWithSignalSlot(payload, k, RT_SIGNAL_SLOT_EMPTY)
            return rtBuildOk(prices.removeSignal)
        }
        const next = presence === BOTH_PRESENCE ? HALF_PRESENCE[0] : HALF_PRESENCE[1]
        // aspects follow presence; updateSignalStates sets them
        if (apply === true) map.payload[tile] = rtWithSignalSlot(payload, k, piece | typeBit | next)
        return rtBuildOk(0)
    }

    const free = (rtSignalSlot(payload, 0) & RT_SIGNAL_PIECE_MASK) === RT_SIGNAL_SLOT_EMPTY
        ? 0
        : (rtSignalSlot(payload, 1) & RT_SIGNAL_PIECE_MASK) === RT_SIGNAL_SLOT_EMPTY ? 1 : -1
    if (free < 0) return rtBuildFail(RtBuildError.conflict)
    if (apply === true) map.payload[tile] = rtWithSignalSlot(payload, free, piece | typeBit | BOTH_PRESENCE)
    return rtBuildOk(prices.signal)
}

/* ------------------------------------------------------------------------------------------
 * W28: signal blocks
 * ---------------------------------------------------------------------------------------- */

/** One signal block found by a flood fill. */
interface RtBlock {
    /** tile * 8 + piece of every piece in the block, signal tiles at its border included. */
    nodes: number[]
    /** The nodes that carry no signal; each lies in exactly this block. */
    plain: number[]
    /** tile * 16 + trackdir of every signal facing into the block, ascending. */
    entries: number[]
    /** A path signal faces into the block (the original's path segment). */
    pathEntry: boolean
    /** The block holds a junction tile. */
    split: boolean
    /** The fill ran past RT_CATALOG blockFillTiles. */
    overflow: boolean
    /** Every tile the fill read, for the blockHasPathSignal memo. */
    probes: number[]
}

/** Trackdir of `piece` when entering its tile through edge `entry`, or -1 when it does not touch it. */
function trackdirEnteringThrough(piece: number, entry: RtDir): number {
    return rtFirstTrackdir(rtPieceTrackdirs(1 << piece) & rtTrackdirsEnteringWith(rtReverseDir(entry)))
}

/** Pieces touching edge `edge`, as piece bits. */
function piecesTouching(pieces: number, edge: RtDir): number {
    let out = 0
    for (let p = 0; p < RT_TRACK_COUNT; p++) {
        if ((pieces & (1 << p)) === 0) continue
        const [a, b] = rtPieceEdges(p as RtTrack)
        if (a === edge || b === edge) out |= 1 << p
    }
    return out
}

const HORIZONTAL_PAIR = (1 << RtTrack.upper) | (1 << RtTrack.lower)
const VERTICAL_PAIR = (1 << RtTrack.left) | (1 << RtTrack.right)

function isParallelPair(pieces: number): boolean {
    return pieces === HORIZONTAL_PAIR || pieces === VERTICAL_PAIR
}

/**
 * Flood-fills the signal block of piece `seedPiece` on `seedTile`. With `seedTd` >= 0 the piece
 * carries a signal and the block is the one ahead of a train travelling seedTd through it; with -1
 * the piece is plain and its whole block is filled. The fill crosses tile edges where followTrack's
 * geometry connects, stays on the seed tile owner's track unless sharing is on, takes a whole
 * junction tile (two parallel diagonals stay apart), enters a depot's front but not its inside, and
 * stops at signal tiles, which it includes.
 */
function floodBlock(map: RtMap, seedTile: number, seedPiece: number, seedTd: number, sharing: boolean): RtBlock {
    const block: RtBlock = { nodes: [], plain: [], entries: [], pathEntry: false, split: false, overflow: false, probes: [seedTile] }
    const seen = new Set<number>()
    const arrived = new Set<number>()
    const entrySet = new Set<number>()
    const queue: number[] = []
    const owner = map.owner[seedTile]!
    const budget = RT_CATALOG.signals.blockFillTiles
    let visits = 0

    const addNode = (tile: number, piece: number, plain: boolean) => {
        const key = tile * 8 + piece
        if (seen.has(key)) return
        seen.add(key)
        block.nodes.push(key)
        if (plain) block.plain.push(key)
    }
    const leave = (tile: number, edge: RtDir) => {
        const next = map.neighbour(tile, edge)
        if (next < 0) return
        const key = next * 4 + edge
        if (arrived.has(key)) return
        arrived.add(key)
        queue.push(next, edge)
    }
    const addEntry = (tile: number, td: number) => {
        const key = tile * 16 + td
        if (entrySet.has(key)) return
        entrySet.add(key)
        if (rtSignalTypeAt(map, tile, td) === RtSignalType.path) block.pathEntry = true
    }

    /** Takes in a tile entered through `entry` (-1 for the seed tile itself). */
    const take = (tile: number, entry: number) => {
        const kind = map.kind[tile]
        if (kind === RtTileKind.depot) {
            const facing = rtRailDepotFacing(map, tile)
            if (facing < 0) return
            if (entry >= 0 && entry !== facing) return
            addNode(tile, (facing & 1) === 0 ? RtTrack.x : RtTrack.y, true)
            if (entry < 0) leave(tile, facing as RtDir)
            return
        }
        if (kind === RtTileKind.station) {
            const pieces = rtRailTilePieces(map, tile)
            if (pieces === 0) return
            const piece = pieces === 1 << RtTrack.x ? RtTrack.x : RtTrack.y
            const [a, b] = rtPieceEdges(piece)
            if (entry >= 0 && entry !== a && entry !== b) return
            addNode(tile, piece, true)
            if (entry !== a) leave(tile, a)
            if (entry !== b) leave(tile, b)
            return
        }
        if (kind !== RtTileKind.rail) return
        const all = rtRailPieces(map.payload[tile]!)
        let tracks: number
        if (entry >= 0) {
            const reach = piecesTouching(all, entry as RtDir)
            if (reach === 0) return
            tracks = isParallelPair(all) ? reach : all
        } else {
            tracks = isParallelPair(all) ? 1 << seedPiece : all
        }
        if (rtBitCount(tracks) > 1) block.split = true
        if (entry >= 0 && rtBitCount(tracks) === 1) {
            const piece = 31 - Math.clz32(tracks)
            if (rtSignalTypeAt(map, tile, piece) >= 0) {
                addNode(tile, piece, false)
                const tdIn = trackdirEnteringThrough(piece, entry as RtDir)
                const back = tdIn ^ RT_TRACKDIR_REVERSE
                if (rtSignalOnTrackdir(map, tile, back)) addEntry(tile, back)
                return
            }
        }
        for (let p = 0; p < RT_TRACK_COUNT; p++) {
            if ((tracks & (1 << p)) === 0) continue
            addNode(tile, p, true)
            const [a, b] = rtPieceEdges(p as RtTrack)
            if (a !== entry) leave(tile, a)
            if (b !== entry) leave(tile, b)
        }
    }

    if (seedTd >= 0) {
        addNode(seedTile, seedPiece, false)
        if (rtSignalOnTrackdir(map, seedTile, seedTd)) addEntry(seedTile, seedTd)
        leave(seedTile, rtTrackdirExitDir(seedTd as RtTrackdir))
    } else {
        take(seedTile, -1)
    }
    // a read index, not shift(): shift moves the whole queue on every call
    for (let head = 0; head < queue.length;) {
        const tile = queue[head++]!
        const motion = queue[head++]! as RtDir
        block.probes.push(tile)
        if (sharing !== true && map.owner[tile] !== owner) continue
        if (++visits > budget) {
            block.overflow = true
            break
        }
        take(tile, rtReverseDir(motion))
    }
    block.entries = [...entrySet].sort((a, b) => a - b)
    return block
}

/** The block seeds of one piece: both sides of a signalled piece, else the piece itself. */
function pieceSeeds(map: RtMap, tile: number, piece: number, out: number[]): void {
    if (rtSignalTypeAt(map, tile, piece) >= 0) {
        out.push(tile, piece, piece, tile, piece, piece + RT_TRACKDIR_REVERSE)
    } else {
        out.push(tile, piece, -1)
    }
}

/**
 * W28: recomputes the aspects of every signal facing into a block that touches a dirty tile (the
 * tile's own pieces and the pieces of its neighbours at the shared edges, so a removal that split or
 * merged blocks is seen). A block signal shows red when a train holds any piece of its block (AR-57:
 * trainOnPiece counts trains on track only), or when the fill overflowed RT_CATALOG blockFillTiles;
 * else green. A path signal whose piece is reserved keeps the aspect its reservation gave it; an
 * unreserved one is red when its block is occupied, holds a junction or has more than one way in,
 * else green, as the original. `sharing` is the world setting: off, a block stays on its owner's
 * track as the original; on, it runs across every company's connected track. Returns the tiles whose
 * aspects changed, ascending. Call it for the tiles a train entered or left (W48) and after every
 * applied change to rail, signals, platforms or depots and every train removal (W59, W63, AR-59).
 */
export function updateSignalStates(map: RtMap, trainOnPiece: RtTrainOnPiece, dirtyTiles: Iterable<number>, sharing: boolean): number[] {
    const tiles = [...new Set(dirtyTiles)].filter(t => map.validTile(t)).sort((a, b) => a - b)
    const seeds: number[] = []
    for (const tile of tiles) {
        const own = rtRailTilePieces(map, tile)
        for (let p = 0; p < RT_TRACK_COUNT; p++) if ((own & (1 << p)) !== 0) pieceSeeds(map, tile, p, seeds)
        for (let dir = 0; dir < 4; dir++) {
            const next = map.neighbour(tile, dir as RtDir)
            if (next < 0) continue
            const touching = piecesTouching(rtRailTilePieces(map, next), rtReverseDir(dir as RtDir))
            for (let p = 0; p < RT_TRACK_COUNT; p++) if ((touching & (1 << p)) !== 0) pieceSeeds(map, next, p, seeds)
        }
    }
    const donePlain = new Set<number>()
    const doneSides = new Set<number>()
    const changed = new Set<number>()
    for (let s = 0; s < seeds.length; s += 3) {
        const tile = seeds[s]!
        const piece = seeds[s + 1]!
        const td = seeds[s + 2]!
        if (td < 0 ? donePlain.has(tile * 8 + piece) : doneSides.has(tile * 16 + td)) continue
        const block = floodBlock(map, tile, piece, td, sharing)
        for (const key of block.plain) donePlain.add(key)
        if (td >= 0) doneSides.add(tile * 16 + td)
        for (const entry of block.entries) doneSides.add(entry)
        let occupied = block.overflow
        for (let k = 0; k < block.nodes.length && !occupied; k++) {
            const key = block.nodes[k]!
            if (trainOnPiece((key / 8) | 0, key & 7, -1)) occupied = true
        }
        for (const entry of block.entries) {
            const sigTile = (entry / 16) | 0
            const sigTd = entry & 15
            let green: boolean
            if (rtSignalTypeAt(map, sigTile, sigTd) === RtSignalType.path) {
                if (rtPieceReserved(map, sigTile, sigTd & 7)) continue
                green = !occupied && !block.split && block.entries.length <= 1
            } else {
                green = !occupied
            }
            if (rtSetSignalAspect(map, sigTile, sigTd, green)) changed.add(sigTile)
        }
    }
    return [...changed].sort((a, b) => a - b)
}

/**
 * Whether a train holds any piece of the block a rail depot opens into, as the original, where a
 * depot works as a block signal: a train stays inside while its block is occupied (W48, AR-56). An
 * overflowing fill counts as occupied; a tile that is no rail depot never is.
 */
export function rtDepotBlockOccupied(map: RtMap, depot: number, trainOnPiece: RtTrainOnPiece, sharing: boolean): boolean {
    const facing = rtRailDepotFacing(map, depot)
    if (facing < 0) return false
    // every waiting train asks every tick: the fill is memoised like blockHasPathSignal's, by the
    // structure of every tile it read, so only the occupancy is checked again
    const key = depot * 2 + (sharing === true ? 1 : 0)
    let memos = depotMemos.get(map)
    let memo = memos?.get(key)
    if (!memo || !memoValid(map, memo)) {
        const block = floodBlock(map, depot, (facing & 1) === 0 ? RtTrack.x : RtTrack.y, -1, sharing === true)
        const probes = [...new Set(block.probes)]
        memo = { answer: block.overflow, probes, words: probes.map(t => structuralWord(map, t)), nodes: block.nodes }
        if (!memos) {
            memos = new Map()
            depotMemos.set(map, memos)
        }
        if (memos.size > PATH_MEMO_LIMIT) memos.clear()
        memos.set(key, memo)
    }
    if (memo.answer) return true
    for (const node of memo.nodes) if (trainOnPiece((node / 8) | 0, node & 7, -1)) return true
    return false
}

/* ------------------------------------------------------------------------------------------
 * W28 section 5.2 and 5.3: blockHasPathSignal and its memo
 * ---------------------------------------------------------------------------------------- */

/** A memoised answer and the structural content of every tile it read. */
interface RtPathMemo {
    answer: boolean
    probes: number[]
    words: number[]
}

const PATH_MEMO_LIMIT = 65536
const pathMemos = new WeakMap<RtMap, Map<number, RtPathMemo>>()
/** rtDepotBlockOccupied's fills: answer is the overflow, nodes the block's pieces. */
const depotMemos = new WeakMap<RtMap, Map<number, RtPathMemo & { nodes: number[] }>>()

/** Aspect bits of both signal slots, which change with traffic and do not shape a block. */
const RAIL_ASPECT_BITS = (3 << (RT_RAIL_SIGNAL_SHIFT[0]! + RT_SIGNAL_ASPECT_SHIFT)) | (3 << (RT_RAIL_SIGNAL_SHIFT[1]! + RT_SIGNAL_ASPECT_SHIFT))
const STATION_RESERVED_BIT = 1 << 19
const DEPOT_RESERVED_BIT = 1 << 3

/** A tile's kind, owner and block-shaping payload bits as one exact integer (reservations and aspects masked out). */
function structuralWord(map: RtMap, tile: number): number {
    const kind = map.kind[tile]!
    const payload = map.payload[tile]!
    let shape = 0
    if (kind === RtTileKind.rail) shape = (payload & ~(RT_RAIL_RESERVED_MASK | RAIL_ASPECT_BITS)) >>> 0
    else if (kind === RtTileKind.station) shape = (payload & ~STATION_RESERVED_BIT) >>> 0
    else if (kind === RtTileKind.depot) shape = (payload & ~DEPOT_RESERVED_BIT) >>> 0
    return (kind * 256 + map.owner[tile]!) * 4294967296 + shape
}

/** Forgets every memoised blockHasPathSignal and depot block answer of a map (optional: each is re-checked on use). */
export function rtClearSignalCache(map: RtMap): void {
    pathMemos.delete(map)
    depotMemos.delete(map)
}

/**
 * Whether the block a train enters along `td` on `tile` is a path block (AR-68): a path signal faces
 * into it (including the far half of a two-way path signal at its exit), as the original's path
 * segment; also true when the fill overflowed. For a signalled piece the block is the one ahead of
 * td; for a plain piece either trackdir names its one block. A block-signalled train entering a path
 * block must reserve first (W48 section 5.2).
 *
 * The answer is a function of the map alone (AR-88): it is computed on demand and memoised per map
 * together with the kind, owner and structural payload of every tile the fill read, and a memo is
 * used only while all of those are unchanged, so building, removing or decoding can never leave a
 * stale answer and every peer agrees whatever it has cached. Reservations and aspects are not part
 * of the structure. False for a tile and trackdir with no track.
 */
export function blockHasPathSignal(map: RtMap, tile: number, td: number, sharing: boolean): boolean {
    if (!map.validTile(tile) || !rtValidTrackdir(td)) return false
    const piece = td & 7
    if ((rtRailTilePieces(map, tile) & (1 << piece)) === 0) return false
    const signalled = rtSignalTypeAt(map, tile, piece) >= 0
    const key = ((tile * 16 + (signalled ? td : piece)) * 2) + (sharing === true ? 1 : 0)
    let memos = pathMemos.get(map)
    const memo = memos?.get(key)
    if (memo && memoValid(map, memo)) return memo.answer

    const block = floodBlock(map, tile, piece, signalled ? td : -1, sharing === true)
    const answer = block.pathEntry || block.overflow
    const probes = [...new Set(block.probes)]
    const fresh: RtPathMemo = { answer, probes, words: probes.map(t => structuralWord(map, t)) }
    if (!memos) {
        memos = new Map()
        pathMemos.set(map, memos)
    }
    if (memos.size > PATH_MEMO_LIMIT) memos.clear()
    memos.set(key, fresh)
    for (const node of block.plain) memos.set((((node >>> 3) * 16 + (node & 7)) * 2) + (sharing === true ? 1 : 0), fresh)
    return answer
}

function memoValid(map: RtMap, memo: RtPathMemo): boolean {
    for (let k = 0; k < memo.probes.length; k++) {
        if (structuralWord(map, memo.probes[k]!) !== memo.words[k]) return false
    }
    return true
}

/* ------------------------------------------------------------------------------------------
 * Reservation bits of every piece kind (W16, W20, W22, AR-100)
 * ---------------------------------------------------------------------------------------- */

/** Whether a rail piece, a rail platform or a rail depot's half-piece carries a reservation. */
export function rtPieceReserved(map: RtMap, tile: number, piece: number): boolean {
    if (!map.validTile(tile)) return false
    const payload = map.payload[tile]!
    switch (map.kind[tile]) {
        case RtTileKind.rail:
            return rtValidTrack(piece) && rtRailPieceReserved(payload, piece)
        case RtTileKind.station:
            return rtStationTileType(payload) === RtStationTile.rail && rtPlatformTrack(payload) === piece && rtPlatformReserved(payload)
        case RtTileKind.depot:
            return (rtRailTilePieces(map, tile) & (1 << piece)) !== 0 && rtDepotReserved(payload)
        default:
            return false
    }
}

/** Sets or clears a piece's reservation bit; returns whether the tile has that piece. */
export function rtSetPieceReserved(map: RtMap, tile: number, piece: number, reserved: boolean): boolean {
    if (!map.validTile(tile) || (rtRailTilePieces(map, tile) & (1 << piece)) === 0) return false
    const payload = map.payload[tile]!
    switch (map.kind[tile]) {
        case RtTileKind.rail:
            map.payload[tile] = rtWithRailReservation(payload, piece as RtTrack, reserved)
            return true
        case RtTileKind.station:
            map.payload[tile] = rtWithPlatformReservation(payload, reserved)
            return true
        case RtTileKind.depot:
            map.payload[tile] = rtWithDepotReservation(payload, reserved)
            return true
        default:
            return false
    }
}

/* ------------------------------------------------------------------------------------------
 * A train's pieces
 * ---------------------------------------------------------------------------------------- */

/**
 * The tiles and trackdirs of a train's reservation ahead: route[routeIndex] to route[reservedEnd - 1],
 * placed by walking from the head (route[i] lies on the tile beyond the exit of the piece before it).
 * Stops early at an invalid trackdir or the map edge.
 */
export function rtReservedAhead(map: RtMap, vehicle: RtVehicle): { tiles: number[], trackdirs: number[] } {
    const tiles: number[] = []
    const trackdirs: number[] = []
    if (vehicle.tiles.length === 0) return { tiles, trackdirs }
    let tile = vehicle.tiles[0]!
    let td = vehicle.pieces[0]!
    if (!map.validTile(tile) || !rtValidTrackdir(td)) return { tiles, trackdirs }
    const end = Math.min(vehicle.reservedEnd, vehicle.route.length)
    for (let i = Math.max(0, vehicle.routeIndex); i < end; i++) {
        const next = map.neighbour(tile, rtTrackdirExitDir(td))
        const nextTd = vehicle.route[i]!
        if (next < 0 || !rtValidTrackdir(nextTd)) break
        tiles.push(next)
        trackdirs.push(nextTd)
        tile = next
        td = nextTd
    }
    return { tiles, trackdirs }
}

/** tile * 8 + piece of every piece the train stands on. */
function heldKeys(vehicle: RtVehicle): Set<number> {
    const keys = new Set<number>()
    for (let k = 0; k < vehicle.tiles.length; k++) {
        const td = vehicle.pieces[k]!
        if (rtValidTrackdir(td)) keys.add(vehicle.tiles[k]! * 8 + (td & 7))
    }
    return keys
}

function aheadKeys(map: RtMap, vehicle: RtVehicle): Set<number> {
    const ahead = rtReservedAhead(map, vehicle)
    const keys = new Set<number>()
    for (let k = 0; k < ahead.tiles.length; k++) keys.add(ahead.tiles[k]! * 8 + (ahead.trackdirs[k]! & 7))
    return keys
}

function isTrainOnTrack(vehicle: RtVehicle | null | undefined): vehicle is RtVehicle {
    return !!vehicle && vehicle.kind === RtVehicleKind.rail && vehicle.state !== RtVehicleState.inDepot && vehicle.tiles.length > 0
}

/** Whether entering (tile, piece) would run into another train's reservation or body (AR-62). */
function conflicts(map: RtMap, vehicle: RtVehicle, own: Set<number>, tile: number, piece: number, trainOnPiece: RtTrainOnPiece): boolean {
    if (!own.has(tile * 8 + piece) && rtPieceReserved(map, tile, piece)) return true
    if (trainOnPiece(tile, piece, vehicle.id)) return true
    if (map.kind[tile] !== RtTileKind.rail) return false
    const payload = map.payload[tile]!
    const pieces = rtRailPieces(payload)
    for (let q = 0; q < RT_TRACK_COUNT; q++) {
        if (q === piece || (pieces & (1 << q)) === 0 || !rtTracksOverlap((1 << piece) | (1 << q))) continue
        if (!own.has(tile * 8 + q) && rtRailPieceReserved(payload, q as RtTrack)) return true
        if (trainOnPiece(tile, q, vehicle.id)) return true
    }
    return false
}

/* ------------------------------------------------------------------------------------------
 * W29: path reservation
 * ---------------------------------------------------------------------------------------- */

/**
 * Reserves a train's path all or nothing, from route index `fromIndex` up to the first safe waiting
 * position, as the original: the last piece before a signal (block or path) facing the train, a
 * depot entry, an end of line, or the end of the route (which for a station order is the far end of
 * the target platform, W31). The piece at fromIndex is taken whatever signal it carries: it is the
 * signal the train is about to pass. `route` is vehicle.route; route[i] lies on the tile beyond the
 * piece before it, starting from the head (vehicle.tiles[0], vehicle.pieces[0]); fromIndex runs from
 * vehicle.routeIndex (nothing reserved yet) to vehicle.reservedEnd (extending).
 *
 * A piece conflicts when another train reserved it (any reservation bit not among this train's
 * held or reserved pieces), when trainOnPiece says another train holds it, or when it is a junction
 * piece crossing such a piece; then nothing is reserved and 0 is returned (a red path signal).
 * Otherwise every bit on the way is set, vehicle.reservedEnd becomes fromIndex plus the count, a
 * path signal at fromIndex facing the train turns green, and the count is returned.
 *
 * With no route left at fromIndex (an orderless train, AR-134, or one past the end of its route),
 * the walk takes the first connecting trackdir in trackdir order at every tile, the rule W50 drives
 * by, and appends the walked trackdirs to `route`, so the reservation stays indexable. A route that
 * no longer connects (track removed under it) ends the walk where it breaks. `sharing` is the world
 * setting (followTrack). Returns 0 when nothing can or need be reserved. Never throws.
 */
export function reservePath(
    map: RtMap, vehicle: RtVehicle, route: number[], fromIndex: number, trainOnPiece: RtTrainOnPiece, sharing: boolean
): number {
    if (!isTrainOnTrack(vehicle) || !Array.isArray(route) || typeof trainOnPiece !== 'function') return 0
    const start = Math.max(0, vehicle.routeIndex)
    if (!Number.isInteger(fromIndex) || fromIndex < start || fromIndex > route.length) return 0
    let tile = vehicle.tiles[0]!
    let td = vehicle.pieces[0]!
    if (!map.validTile(tile) || !rtValidTrackdir(td)) return 0
    for (let i = start; i < fromIndex; i++) {
        const next = map.neighbour(tile, rtTrackdirExitDir(td))
        if (next < 0 || !rtValidTrackdir(route[i]!)) return 0
        tile = next
        td = route[i]!
    }

    const own = heldKeys(vehicle)
    for (const key of aheadKeys(map, vehicle)) own.add(key)
    const walking = fromIndex >= route.length
    const cap = RT_CATALOG.caps.maxRouteLength
    const stepTiles: number[] = []
    const stepTds: number[] = []
    const planned = new Set<number>()
    let i = fromIndex
    for (;;) {
        const exit = rtTrackdirExitDir(td as RtTrackdir)
        const options = followTrack(map, tile, exit, vehicle.owner, sharing)
        if (options === 0) break
        const next = map.neighbour(tile, exit)
        let nextTd: number
        if (walking) {
            if (route.length + stepTds.length >= cap) break
            nextTd = rtFirstTrackdir(rtPassableTrackdirs(map, next, options))
            if (nextTd < 0) break
        } else {
            if (i >= route.length) break
            nextTd = route[i]!
            if (!rtValidTrackdir(nextTd) || (options & (1 << nextTd)) === 0 || rtOneWayBlocked(map, next, nextTd)) break
        }
        if (stepTds.length > 0 && rtSignalOnTrackdir(map, next, nextTd)) break
        const piece = nextTd & 7
        if (planned.has(next * 8 + piece)) break
        if (conflicts(map, vehicle, own, next, piece, trainOnPiece)) return 0
        planned.add(next * 8 + piece)
        stepTiles.push(next)
        stepTds.push(nextTd)
        tile = next
        td = nextTd
        i++
        if (map.kind[next] === RtTileKind.depot) break
    }
    if (stepTds.length === 0) return 0

    for (let k = 0; k < stepTiles.length; k++) rtSetPieceReserved(map, stepTiles[k]!, stepTds[k]! & 7, true)
    if (walking) route.push(...stepTds)
    vehicle.reservedEnd = fromIndex + stepTds.length
    if (rtSignalTypeAt(map, stepTiles[0]!, stepTds[0]!) === RtSignalType.path) rtSetSignalAspect(map, stepTiles[0]!, stepTds[0]!, true)
    return stepTds.length
}

/* ------------------------------------------------------------------------------------------
 * W30: releasing reservations
 * ---------------------------------------------------------------------------------------- */

/**
 * Clears the reservation bit of (tile, piece) only when it is one of this train's own pieces (its
 * tile list or its reservation up to vehicle.reservedEnd), so a train never erases a reservation
 * another train set (AR-63). A piece the train both stands on and has reserved again ahead (a short
 * loop) stays reserved. Call it as the tail leaves a tile, before the tile leaves vehicle.tiles.
 * Returns whether a bit was cleared.
 */
export function releaseReservation(map: RtMap, vehicle: RtVehicle, tile: number, piece: number): boolean {
    if (!vehicle || !map.validTile(tile) || !rtValidTrack(piece)) return false
    const key = tile * 8 + piece
    const held = heldKeys(vehicle)
    const ahead = aheadKeys(map, vehicle)
    if (!held.has(key) && !ahead.has(key)) return false
    if (held.has(key) && ahead.has(key)) return false
    if (!rtPieceReserved(map, tile, piece)) return false
    return rtSetPieceReserved(map, tile, piece, false)
}

/**
 * Releases a train's reservation ahead of its head (keeping the pieces it stands on), sets a path
 * signal it had cleared back to red and resets vehicle.reservedEnd to 0. Returns the bits cleared.
 */
export function rtReleaseAhead(map: RtMap, vehicle: RtVehicle): number {
    if (!vehicle) return 0
    const ahead = rtReservedAhead(map, vehicle)
    const held = heldKeys(vehicle)
    let cleared = 0
    for (let k = 0; k < ahead.tiles.length; k++) {
        const tile = ahead.tiles[k]!
        const td = ahead.trackdirs[k]!
        if (rtSignalTypeAt(map, tile, td) === RtSignalType.path) rtSetSignalAspect(map, tile, td, false)
        if (held.has(tile * 8 + (td & 7)) || !rtPieceReserved(map, tile, td & 7)) continue
        rtSetPieceReserved(map, tile, td & 7, false)
        cleared++
    }
    vehicle.reservedEnd = 0
    return cleared
}

/**
 * Clears every piece the train holds or has reserved, for a sold, crashed, reset or stuck train
 * (W48, W59, W63), and resets vehicle.reservedEnd to 0. Returns the bits cleared. Call
 * updateSignalStates for its tiles afterwards (AR-59).
 */
export function releaseAllFor(map: RtMap, vehicle: RtVehicle): number {
    if (!vehicle) return 0
    let cleared = rtReleaseAhead(map, vehicle)
    for (let k = 0; k < vehicle.tiles.length; k++) {
        const tile = vehicle.tiles[k]!
        const td = vehicle.pieces[k]!
        if (!rtValidTrackdir(td) || !rtPieceReserved(map, tile, td & 7)) continue
        rtSetPieceReserved(map, tile, td & 7, false)
        cleared++
    }
    return cleared
}

/* ------------------------------------------------------------------------------------------
 * The reservation hooks of the building commands (goal 03, AR-118)
 * ---------------------------------------------------------------------------------------- */

/**
 * The real RtReservationHooks for removeRail and demolishTile (W59): reserverOf finds the lowest-id
 * train on track whose held pieces or reservation ahead cover (tile, piece); releaseAhead releases
 * its reservation ahead (rtReleaseAhead); reserveAgain reserves from its head along its route
 * (reservePath from vehicle.routeIndex) within the same command, as the original. When that fails
 * the train is left with no reservation ahead and must stop as at a red path signal (W48).
 * `vehicles` is every vehicle (world.vehicles), `trainOnPiece` world.occupied's otherTrainOnPiece.
 */
export function rtReservationHooks(
    map: RtMap, vehicles: readonly (RtVehicle | null)[], trainOnPiece: RtTrainOnPiece, sharing: boolean
): RtReservationHooks {
    return {
        reserverOf(tile: number, piece: RtTrack): RtVehicle | null {
            const key = tile * 8 + piece
            let found: RtVehicle | null = null
            for (const vehicle of vehicles) {
                if (!isTrainOnTrack(vehicle) || (found && vehicle.id >= found.id)) continue
                if (heldKeys(vehicle).has(key) || aheadKeys(map, vehicle).has(key)) found = vehicle
            }
            return found
        },
        releaseAhead(vehicle: RtVehicle): void {
            rtReleaseAhead(map, vehicle)
        },
        reserveAgain(vehicle: RtVehicle): void {
            reservePath(map, vehicle, vehicle.route, Math.max(0, vehicle.routeIndex), trainOnPiece, sharing)
        }
    }
}
