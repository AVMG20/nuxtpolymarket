/**
 * The command codec. One u8 kind, then the fields at fixed widths: tiles as u32, piece,
 * trackdir, bits and small enums as u8, vehicle ids as u16, loan steps as i16, names as a
 * varint-length UTF-8 string of at most maxNameBytes. Lines and areas are two tiles (and a trackdir),
 * so a drag of any length is one small command. Never JSON. Each kind has one entry in CODECS, its
 * writer and its reader side by side.
 */

import { clampUtf8, RtBadData, RtReader, RtWriter } from './bytes'
import { RT_CATALOG } from './catalog'
import { RtCommandKind, type RtCommand, type RtCommandOf } from './command-kinds'
import { RT_MAP_SIDES } from './map'
import { RT_MAX_ORDERS, RT_ORDER_FLAG_MASK } from './orders'
import { RtSignalType } from './signals'
import { RT_MAX_PLATFORM_LENGTH, RT_MAX_PLATFORMS, RT_ROAD_STOP_SHAPE_MAX, RtAxis, RtRoadStopShape, RtStationTile } from './stations-build'
import { RT_TRACK_COUNT, rtTrackdirPiece, rtValidTrackdir } from './track'
import { RtOrderKind, RtVehicleKind, type RtOrder } from './types'

/** The largest map side (RT_MAP_SIDES); decodeCommand bounds tiles by it when given no side. */
export const RT_COMMAND_MAX_SIDE = RT_MAP_SIDES[RT_MAP_SIDES.length - 1]!

const NAME_BYTES = RT_CATALOG.caps.maxNameBytes
const MAX_WAGONS = RT_CATALOG.vehicles.maxTrainVehicles - 1

/**
 * buildRoadStop's one byte: bits 0-1 the stop type, bits 2-4 the RtRoadStopShape, bits 5-7 zero. A
 * stop command from before bays has shape 0 (auto) there and decodes as it always did.
 */
const ROAD_STOP_TYPE_MASK = 3
const ROAD_STOP_SHAPE_SHIFT = 2

/** How far apart two tiles of a map of `side` lie along x and along y. */
function span(a: number, b: number, side: number): { dx: number, dy: number } {
    return { dx: Math.abs((a % side) - (b % side)), dy: Math.abs(Math.floor(a / side) - Math.floor(b / side)) }
}

/** The tiles a line from a to b covers on a map of `side`, and whether it keeps to one row or column: decode filters on it, the road build applies it. */
export function rtLineShape(a: number, b: number, side: number): { tiles: number, straight: boolean } {
    const { dx, dy } = span(a, b, side)
    return { tiles: dx + dy + 1, straight: dx === 0 || dy === 0 }
}

/** The reader of one command with the field readers every kind shares, bounded by the map side. */
class CommandReader {
    private readonly tiles: number

    constructor(readonly r: RtReader, readonly side: number | undefined) {
        this.tiles = (side ?? RT_COMMAND_MAX_SIDE) ** 2
    }

    /** A u8 that must be at most `max`. */
    u8Max(max: number, what: string): number {
        const value = this.r.u8()
        if (value > max) throw new RtBadData(`${what} ${value} above ${max}`)
        return value
    }

    tile(what = 'tile'): number {
        const value = this.r.u32()
        if (value >= this.tiles) throw new RtBadData(`${what} ${value} off the map`)
        return value
    }

    /** An order target: a station id, or a depot tile. */
    target(orderKind: number): number {
        const value = this.r.u32()
        const limit = orderKind === RtOrderKind.gotoStation ? RT_CATALOG.caps.maxStations : this.tiles
        if (value >= limit) throw new RtBadData(`order target ${value}`)
        return value
    }

    vehicle(): number {
        const value = this.r.u16()
        if (value >= RT_CATALOG.caps.maxVehicles) throw new RtBadData(`vehicle ${value} out of range`)
        return value
    }

    piece(): number {
        return this.u8Max(RT_TRACK_COUNT - 1, 'piece')
    }

    /** A drag's two ends. */
    ends(): [number, number] {
        return [this.tile(), this.tile('end tile')]
    }

    /** A drag at most lineMaxTiles long, and on one row or column when straight. */
    checkLine([a, b]: [number, number], straight: boolean): void {
        if (this.side === undefined) return
        const shape = rtLineShape(a, b, this.side)
        if (straight && !shape.straight) throw new RtBadData('line off one row or column')
        if (shape.tiles > RT_CATALOG.caps.lineMaxTiles) throw new RtBadData('line too long')
    }

    /** An area's two corners: at most areaMaxTiles wide and tall. */
    area(): [number, number] {
        const ends = this.ends()
        if (this.side === undefined) return ends
        const { dx, dy } = span(ends[0], ends[1], this.side)
        const max = RT_CATALOG.caps.areaMaxTiles
        if (dx + 1 > max || dy + 1 > max) throw new RtBadData('area too large')
        return ends
    }
}

interface RtCommandCodec<K extends RtCommandKind> {
    write(w: RtWriter, command: RtCommandOf<K>): void
    read(r: CommandReader, kind: K): RtCommandOf<K>
}

type TileKinds = typeof RtCommandKind.demolish | typeof RtCommandKind.buildSiding | typeof RtCommandKind.removeSiding
type VehicleKinds = typeof RtCommandKind.sellVehicle | typeof RtCommandKind.sendToDepot | typeof RtCommandKind.reverseTrain
type PieceKinds = typeof RtCommandKind.buildRail | typeof RtCommandKind.removeRail
type RoadKinds = typeof RtCommandKind.buildRoad | typeof RtCommandKind.removeRoad

/* codecs several kinds of one shape share */

const tileCodec = {
    write: (w: RtWriter, c: { tile: number }) => w.u32(c.tile),
    read: <K extends TileKinds>(r: CommandReader, kind: K) => ({ kind, tile: r.tile() }) as RtCommandOf<K>
}

const vehicleCodec = {
    write: (w: RtWriter, c: { vehicle: number }) => w.u16(c.vehicle),
    read: <K extends VehicleKinds>(r: CommandReader, kind: K) => ({ kind, vehicle: r.vehicle() }) as RtCommandOf<K>
}

const pieceCodec = {
    write: (w: RtWriter, c: { tile: number, piece: number }) => {
        w.u32(c.tile)
        w.u8(c.piece)
    },
    read: <K extends PieceKinds>(r: CommandReader, kind: K) => ({ kind, tile: r.tile(), piece: r.piece() }) as RtCommandOf<K>
}

const roadCodec = {
    write: (w: RtWriter, c: { tile: number, bits: number }) => {
        w.u32(c.tile)
        w.u8(c.bits)
    },
    read: <K extends RoadKinds>(r: CommandReader, kind: K) => {
        const tile = r.tile()
        const bits = r.u8Max(15, 'road bits')
        if (bits === 0) throw new RtBadData('no road bits')
        return { kind, tile, bits } as RtCommandOf<K>
    }
}

function writeName(w: RtWriter, name: string): void {
    w.str(clampUtf8(String(name), NAME_BYTES))
}

const CODECS: { readonly [K in RtCommandKind]: RtCommandCodec<K> } = {
    [RtCommandKind.buildRail]: pieceCodec,
    [RtCommandKind.removeRail]: pieceCodec,
    [RtCommandKind.buildRailLine]: {
        write: (w, c) => {
            w.u32(c.tile)
            w.u32(c.endTile)
            w.u8(c.trackdir)
        },
        read: (r, kind) => {
            const ends = r.ends()
            const trackdir = r.r.u8()
            if (!rtValidTrackdir(trackdir)) throw new RtBadData(`trackdir ${trackdir}`)
            // the trackdir decides whether the line must be straight
            r.checkLine(ends, rtTrackdirPiece(trackdir) < 2)
            return { kind, tile: ends[0], endTile: ends[1], trackdir }
        }
    },
    [RtCommandKind.buildRoad]: roadCodec,
    [RtCommandKind.removeRoad]: roadCodec,
    [RtCommandKind.buildRoadLine]: {
        write: (w, c) => {
            w.u32(c.tile)
            w.u32(c.endTile)
        },
        read: (r, kind) => {
            const [tile, endTile] = r.ends()
            r.checkLine([tile, endTile], true)
            return { kind, tile, endTile }
        }
    },
    [RtCommandKind.demolishArea]: {
        write: (w, c) => {
            w.u32(c.tile)
            w.u32(c.endTile)
        },
        read: (r, kind) => {
            const [tile, endTile] = r.area()
            return { kind, tile, endTile }
        }
    },
    [RtCommandKind.buildRailStation]: {
        write: (w, c) => {
            w.u32(c.tile)
            w.u8(c.axis)
            w.u8(c.tracks)
            w.u8(c.length)
        },
        read: (r, kind) => {
            const tile = r.tile()
            const axis = r.u8Max(RtAxis.y, 'axis')
            const tracks = r.u8Max(RT_MAX_PLATFORMS, 'tracks')
            const length = r.u8Max(RT_MAX_PLATFORM_LENGTH, 'length')
            if (tracks === 0 || length === 0) throw new RtBadData('empty station')
            return { kind, tile, axis, tracks, length }
        }
    },
    [RtCommandKind.buildRoadStop]: {
        write: (w, c) => {
            w.u32(c.tile)
            w.u8(c.stop | ((c.shape ?? RtRoadStopShape.auto) << ROAD_STOP_SHAPE_SHIFT))
        },
        read: (r, kind) => {
            const tile = r.tile()
            const packed = r.r.u8()
            const stop = packed & ROAD_STOP_TYPE_MASK
            const shape = packed >>> ROAD_STOP_SHAPE_SHIFT
            if (stop === RtStationTile.rail || stop > RtStationTile.truck) throw new RtBadData(`stop ${stop} is no road stop`)
            if (shape > RT_ROAD_STOP_SHAPE_MAX) throw new RtBadData(`road stop shape ${shape}`)
            // a stop without a shape is the old command, byte for byte
            return shape === RtRoadStopShape.auto ? { kind, tile, stop } : { kind, tile, stop, shape }
        }
    },
    [RtCommandKind.buildDepot]: {
        write: (w, c) => {
            w.u32(c.tile)
            w.u8(c.vehicleKind)
            w.u8(c.facing)
        },
        read: (r, kind) => ({ kind, tile: r.tile(), vehicleKind: r.u8Max(RtVehicleKind.road, 'vehicle kind'), facing: r.u8Max(3, 'facing') })
    },
    [RtCommandKind.placeSignal]: {
        write: (w, c) => {
            w.u32(c.tile)
            w.u8(c.piece)
            w.u8(c.signalType)
        },
        read: (r, kind) => ({ kind, tile: r.tile(), piece: r.piece(), signalType: r.u8Max(RtSignalType.path, 'signal type') })
    },
    [RtCommandKind.demolish]: tileCodec,
    [RtCommandKind.buildSiding]: tileCodec,
    [RtCommandKind.removeSiding]: tileCodec,
    [RtCommandKind.buyVehicle]: {
        write: (w, c) => {
            w.u32(c.depot)
            w.u8(c.model)
            w.u8(c.wagons.length)
            for (const wagon of c.wagons) w.u8(wagon)
        },
        read: (r, kind) => {
            const depot = r.tile('depot')
            const model = r.r.u8()
            const count = r.u8Max(MAX_WAGONS, 'wagon count')
            const wagons: number[] = []
            for (let k = 0; k < count; k++) wagons.push(r.r.u8())
            return { kind, depot, model, wagons }
        }
    },
    [RtCommandKind.sellVehicle]: vehicleCodec,
    [RtCommandKind.sendToDepot]: vehicleCodec,
    [RtCommandKind.reverseTrain]: vehicleCodec,
    [RtCommandKind.setOrders]: {
        write: (w, c) => {
            w.u16(c.vehicle)
            w.u8(c.orders.length)
            for (const order of c.orders) {
                w.u8(order.kind)
                w.u32(order.target)
                w.u8(order.flags)
            }
        },
        read: (r, kind) => {
            const vehicle = r.vehicle()
            const count = r.u8Max(RT_MAX_ORDERS, 'order count')
            const orders: RtOrder[] = []
            for (let k = 0; k < count; k++) {
                const orderKind = r.u8Max(RtOrderKind.gotoDepot, 'order kind')
                const target = r.target(orderKind)
                const flags = r.r.u8()
                if ((flags & ~RT_ORDER_FLAG_MASK) !== 0) throw new RtBadData(`order flags ${flags}`)
                orders.push({ kind: orderKind as RtOrder['kind'], target, flags })
            }
            return { kind, vehicle, orders }
        }
    },
    [RtCommandKind.startStop]: {
        write: (w, c) => {
            w.u16(c.vehicle)
            w.u8(c.stopped ? 1 : 0)
        },
        read: (r, kind) => ({ kind, vehicle: r.vehicle(), stopped: r.u8Max(1, 'stopped') === 1 })
    },
    [RtCommandKind.changeLoan]: {
        write: (w, c) => w.i16(c.steps),
        read: (r, kind) => ({ kind, steps: r.r.i16() })
    },
    [RtCommandKind.renameCompany]: {
        write: (w, c) => writeName(w, c.name),
        read: (r, kind) => ({ kind, name: r.r.str(NAME_BYTES) })
    },
    [RtCommandKind.foundCompany]: {
        write: (w, c) => {
            writeName(w, c.name)
            w.u8(c.colour)
        },
        read: (r, kind) => {
            const name = r.r.str(NAME_BYTES)
            const colour = r.u8Max(RT_CATALOG.companies.colours.length - 1, 'colour')
            return { kind, name, colour }
        }
    }
}

function codecOf(kind: unknown): RtCommandCodec<RtCommandKind> | undefined {
    return Object.hasOwn(CODECS, kind as PropertyKey) ? CODECS[kind as RtCommandKind] as RtCommandCodec<RtCommandKind> : undefined
}

/**
 * Encodes a command. A name is clamped to maxNameBytes first; anything else decodeCommand would
 * refuse throws RangeError, so a peer never sends bytes the others drop.
 */
export function encodeCommand(command: RtCommand): Uint8Array {
    const codec = codecOf(command.kind)
    if (!codec) throw new RangeError(`unknown command kind ${(command as { kind: unknown }).kind}`)
    const w = new RtWriter()
    w.u8(command.kind)
    codec.write(w, command)
    const bytes = w.finish()
    if (decodeCommand(bytes) === null) throw new RangeError(`command ${command.kind} does not decode`)
    return bytes
}

/**
 * Decodes one command, or null for anything malformed: a short or over-long frame, an unknown kind,
 * a tile at or past side squared, a piece, trackdir, enum or flag out of range, a line longer than
 * lineMaxTiles or a straight one off one row or column, an area wider or taller than areaMaxTiles,
 * more wagons than the longest consist or more orders than RT_MAX_ORDERS, a name past maxNameBytes
 * or a stopped byte other than 0 or 1. `side` is the world's map side (the room and the client know
 * it); without it tiles are bounded by the largest side and the line and area shapes are left to
 * applyCommand, since a tile index alone has no coordinates. Whatever it accepts re-encodes to the
 * same bytes.
 */
export function decodeCommand(bytes: Uint8Array, side?: number): RtCommand | null {
    try {
        if (!(bytes instanceof Uint8Array) || (side !== undefined && !RT_MAP_SIDES.includes(side))) return null
        const r = new RtReader(bytes)
        const kind = r.u8()
        const codec = codecOf(kind)
        if (!codec) throw new RtBadData(`unknown command kind ${kind}`)
        const command = codec.read(new CommandReader(r, side), kind as RtCommandKind)
        r.end()
        return command
    } catch (e) {
        if (e instanceof RtBadData) return null
        throw e
    }
}
