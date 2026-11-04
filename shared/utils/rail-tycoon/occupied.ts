/**
 * The occupied-tile registry: who stands where. Derived state, rebuilt on decode, never saved or
 * hashed.
 */

import { RT_NONE, RtVehicleKind, RtVehicleState, type RtVehicle } from './types'

/** Track pieces per rail tile (the six piece bits of the rail payload). */
export const RT_TRACK_PIECES = 6

/** Road lanes a tile can hold apart; a road vehicle's lane is its road direction (0 to 3). */
export const RT_ROAD_LANES = 4

const HOLD_RAIL = 0
const HOLD_DEPOT = 1
const HOLD_ROAD = 2

const EMPTY_IDS: readonly number[] = Object.freeze([])

/** Maps a train's trackdir (RtVehicle.pieces) to its track piece index; track.ts defines it. */
export type RtTrackdirPiece = (trackdir: number) => number

function insertSorted(list: number[], value: number): void {
    let at = list.length
    while (at > 0 && list[at - 1]! > value) at--
    list.splice(at, 0, value)
}

function removeOne(list: number[], value: number): boolean {
    const at = list.indexOf(value)
    if (at < 0) return false
    list.splice(at, 1)
    return true
}

/**
 * Who stands where, piece by piece. Three separate holdings: a train on track holds
 * (tile, track piece) pairs; a vehicle inside a depot is a depot occupant, not a track holder; a road
 * vehicle holds (tile, lane). A vehicle may hold several pieces, and two trains may briefly hold one
 * piece (the collision tick). Every query answers in ascending vehicle id.
 */
export class RtOccupiedRegistry {
    readonly tileCount: number
    /** Holdings of every kind per tile, so vehicleOnTile is one read. */
    private readonly perTile: Uint16Array
    /** tile * RT_TRACK_PIECES + piece -> train ids, ascending. */
    private readonly rail = new Map<number, number[]>()
    /** depot tile -> occupant ids, ascending. */
    private readonly depot = new Map<number, number[]>()
    /** tile * RT_ROAD_LANES + lane -> road vehicle ids, ascending. */
    private readonly road = new Map<number, number[]>()
    /** Road holdings per tile, every lane, for level crossings. */
    private readonly roadPerTile = new Map<number, number>()
    /** vehicle id -> its holdings, each encoded key * 4 + kind, in the order they were taken. */
    private readonly byVehicle = new Map<number, number[]>()

    constructor(tileCount: number) {
        if (!Number.isInteger(tileCount) || tileCount < 1) throw new RangeError(`bad tile count: ${tileCount}`)
        this.tileCount = tileCount
        this.perTile = new Uint16Array(tileCount)
    }

    private checkTile(tile: number): void {
        if (!Number.isInteger(tile) || tile < 0 || tile >= this.tileCount) throw new RangeError(`tile out of range: ${tile}`)
    }

    private checkVehicle(vehicle: number): void {
        if (!Number.isInteger(vehicle) || vehicle < 0) throw new RangeError(`bad vehicle id: ${vehicle}`)
    }

    private railKey(tile: number, piece: number): number {
        this.checkTile(tile)
        if (!Number.isInteger(piece) || piece < 0 || piece >= RT_TRACK_PIECES) throw new RangeError(`bad track piece: ${piece}`)
        return tile * RT_TRACK_PIECES + piece
    }

    private roadKey(tile: number, lane: number): number {
        this.checkTile(tile)
        if (!Number.isInteger(lane) || lane < 0 || lane >= RT_ROAD_LANES) throw new RangeError(`bad road lane: ${lane}`)
        return tile * RT_ROAD_LANES + lane
    }

    private add(bucket: Map<number, number[]>, key: number, kind: number, tile: number, vehicle: number): void {
        this.checkVehicle(vehicle)
        const ids = bucket.get(key)
        if (ids) insertSorted(ids, vehicle)
        else bucket.set(key, [vehicle])
        this.perTile[tile]!++
        const held = this.byVehicle.get(vehicle)
        if (held) held.push(key * 4 + kind)
        else this.byVehicle.set(vehicle, [key * 4 + kind])
    }

    private remove(bucket: Map<number, number[]>, key: number, kind: number, tile: number, vehicle: number): boolean {
        const ids = bucket.get(key)
        if (!ids || !removeOne(ids, vehicle)) return false
        if (ids.length === 0) bucket.delete(key)
        this.perTile[tile]!--
        const held = this.byVehicle.get(vehicle)!
        removeOne(held, key * 4 + kind)
        if (held.length === 0) this.byVehicle.delete(vehicle)
        return true
    }

    /** A train on track takes a track piece of a tile (as its head enters it). */
    holdPiece(vehicle: number, tile: number, piece: number): void {
        this.add(this.rail, this.railKey(tile, piece), HOLD_RAIL, tile, vehicle)
    }

    /** A train gives up a track piece (as its tail leaves it); false when it did not hold it. */
    releasePiece(vehicle: number, tile: number, piece: number): boolean {
        return this.remove(this.rail, this.railKey(tile, piece), HOLD_RAIL, tile, vehicle)
    }

    /** A vehicle enters a depot and becomes one of its occupants. */
    enterDepot(vehicle: number, tile: number): void {
        this.checkTile(tile)
        this.add(this.depot, tile, HOLD_DEPOT, tile, vehicle)
    }

    /** A vehicle leaves a depot; false when it was not inside. */
    leaveDepot(vehicle: number, tile: number): boolean {
        this.checkTile(tile)
        return this.remove(this.depot, tile, HOLD_DEPOT, tile, vehicle)
    }

    /** A road vehicle takes a lane of a tile. */
    holdRoad(vehicle: number, tile: number, lane: number): void {
        this.add(this.road, this.roadKey(tile, lane), HOLD_ROAD, tile, vehicle)
        this.roadPerTile.set(tile, (this.roadPerTile.get(tile) ?? 0) + 1)
    }

    /** A road vehicle leaves a lane of a tile; false when it did not hold it. */
    releaseRoad(vehicle: number, tile: number, lane: number): boolean {
        if (!this.remove(this.road, this.roadKey(tile, lane), HOLD_ROAD, tile, vehicle)) return false
        const left = this.roadPerTile.get(tile)! - 1
        if (left === 0) this.roadPerTile.delete(tile)
        else this.roadPerTile.set(tile, left)
        return true
    }

    /** Drop every holding of a vehicle (deleted, crashed and removed, sold); returns how many. */
    releaseVehicle(vehicle: number): number {
        const held = this.byVehicle.get(vehicle)
        if (!held) return 0
        const codes = held.slice()
        for (const code of codes) {
            const kind = code & 3
            const key = (code - kind) / 4
            if (kind === HOLD_RAIL) this.releasePiece(vehicle, (key / RT_TRACK_PIECES) | 0, key % RT_TRACK_PIECES)
            else if (kind === HOLD_DEPOT) this.leaveDepot(vehicle, key)
            else this.releaseRoad(vehicle, (key / RT_ROAD_LANES) | 0, key % RT_ROAD_LANES)
        }
        return codes.length
    }

    /**
     * Whether a train on track holds that piece: collisions and signal blocks. Depot
     * occupants and road vehicles never count.
     */
    trainOnPiece(tile: number, piece: number): boolean {
        return this.rail.has(this.railKey(tile, piece))
    }

    /** The trains on track holding that piece, ascending id; never depot occupants or road vehicles. */
    trainsOnPiece(tile: number, piece: number): readonly number[] {
        return this.rail.get(this.railKey(tile, piece)) ?? EMPTY_IDS
    }

    /** The lowest-id train other than `except` holding that piece, or RT_NONE (reservations). */
    otherTrainOnPiece(tile: number, piece: number, except: number): number {
        const ids = this.rail.get(this.railKey(tile, piece))
        if (!ids) return RT_NONE
        for (const id of ids) if (id !== except) return id
        return RT_NONE
    }

    /** Whether a train other than `except` holds the piece: the RtTrainOnPiece that signals and reservations take. */
    readonly otherTrainOn = (tile: number, piece: number, except: number): boolean => this.otherTrainOnPiece(tile, piece, except) !== RT_NONE

    /** Whether any vehicle is on the tile: a train on track, a depot occupant or a road vehicle (removal and demolish refusals). */
    vehicleOnTile(tile: number): boolean {
        this.checkTile(tile)
        return this.perTile[tile]! > 0
    }

    /** The lowest-id vehicle on the tile's track or road, never a depot occupant, or RT_NONE (picking a vehicle by its tile). */
    lowestVehicleOnTile(tile: number): number {
        this.checkTile(tile)
        let lowest = RT_NONE
        const take = (ids: number[] | undefined) => {
            if (ids && (lowest === RT_NONE || ids[0]! < lowest)) lowest = ids[0]!
        }
        if (this.perTile[tile] === 0) return lowest
        for (let piece = 0; piece < RT_TRACK_PIECES; piece++) take(this.rail.get(tile * RT_TRACK_PIECES + piece))
        for (let lane = 0; lane < RT_ROAD_LANES; lane++) take(this.road.get(tile * RT_ROAD_LANES + lane))
        return lowest
    }

    /** Whether a road vehicle stands on the tile in any lane (level crossings). */
    roadVehicleOnCrossing(tile: number): boolean {
        this.checkTile(tile)
        return this.roadPerTile.has(tile)
    }

    /** The road vehicles holding a lane of a tile, ascending id (road vehicle blocking). */
    roadVehiclesInLane(tile: number, lane: number): readonly number[] {
        return this.road.get(this.roadKey(tile, lane)) ?? EMPTY_IDS
    }

    /** The vehicles inside a depot, ascending id. */
    depotOccupants(tile: number): readonly number[] {
        this.checkTile(tile)
        return this.depot.get(tile) ?? EMPTY_IDS
    }

    /** Forget every holding. */
    clear(): void {
        this.perTile.fill(0)
        this.rail.clear()
        this.depot.clear()
        this.road.clear()
        this.roadPerTile.clear()
        this.byVehicle.clear()
    }

    /**
     * Rebuild from vehicle state in ascending id, as decode does and the tests' rescan checks against: a
     * vehicle inside a depot occupies its depot tile (tiles[0]); a crashed or driving train holds each
     * occupied tile's piece; a road vehicle holds each tile's lane (its road direction in pieces).
     */
    rebuild(vehicles: readonly (RtVehicle | null)[], trackdirPiece: RtTrackdirPiece): void {
        this.clear()
        for (const vehicle of vehicles) {
            if (!vehicle) continue
            if (vehicle.state === RtVehicleState.inDepot) {
                if (vehicle.tiles.length > 0) this.enterDepot(vehicle.id, vehicle.tiles[0]!)
                continue
            }
            for (let k = 0; k < vehicle.tiles.length; k++) {
                const tile = vehicle.tiles[k]!
                const piece = vehicle.pieces[k]!
                if (vehicle.kind === RtVehicleKind.rail) this.holdPiece(vehicle.id, tile, trackdirPiece(piece))
                else this.holdRoad(vehicle.id, tile, piece)
            }
        }
    }

    /** Every holding in a canonical order, for comparing an incremental registry with a rebuilt one. */
    canonical(): string {
        const parts: string[] = []
        const dump = (name: string, bucket: Map<number, number[]>) => {
            const keys = [...bucket.keys()].sort((a, b) => a - b)
            for (const key of keys) parts.push(`${name}${key}:${bucket.get(key)!.join(',')}`)
        }
        dump('r', this.rail)
        dump('d', this.depot)
        dump('l', this.road)
        return parts.join(';')
    }

    /** Whether two registries hold exactly the same vehicles on the same pieces, depots and lanes. */
    equals(other: RtOccupiedRegistry): boolean {
        return this.tileCount === other.tileCount && this.canonical() === other.canonical()
    }
}
