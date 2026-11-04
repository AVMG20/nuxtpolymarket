// Rail Tycoon — vehicle and income drawing.
//
// Where each part of a vehicle stands and faces, and the income texts that rise where a vehicle
// is paid. Pure, unit tested in test/rail-tycoon/renderer.spec.ts.

import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import type { RtDir, RtMap } from '#shared/utils/rail-tycoon/map'
import { RT_BAY_STOP } from '#shared/utils/rail-tycoon/road-vehicle'
import { rtBayFacingAt, rtBaySlot } from '#shared/utils/rail-tycoon/stations-build'
import { rtTrackdirDirection, rtTrackdirEntryEdge, rtTrackdirExitDir, rtValidTrackdir } from '#shared/utils/rail-tycoon/track'
import { rtPieceLength } from '#shared/utils/rail-tycoon/train'
import { RtVehicleKind, RtVehicleState, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import type { RtPayment } from './lockstep'
import { RT_EDGE_MID, RT_ROAD_LANE_OFFSET, rtStandHeight } from './render-space'

/* ------------------------------------------------------------------------------------------
 * Vehicles
 * ---------------------------------------------------------------------------------------- */

/** One drawn engine, wagon or road vehicle: where in which tile it stands and which way it faces. */
export interface RtVehiclePart {
    /** Index in the consist, engine first. */
    index: number
    /** Model index (RT_VEHICLE_MODEL_IDS). */
    model: number
    tile: number
    /** Tile-local position, 0 to 1. */
    lx: number
    ly: number
    /** Height level (fractional) it stands at. */
    height: number
    /** Facing, an index into RT_SPRITE_DIRECTIONS. */
    direction: number
}

/** Progress units one engine or wagon covers along the track. */
export const RT_PART_UNITS = RT_CATALOG.movement.subTileUnits / 2 * RT_CATALOG.vehicles.halfTilesPerVehicle

/**
 * Where each part of a vehicle stands, derived from its tiles, pieces and progress only. A train's
 * part k is centred (k + 0.5) parts behind the head's front, walked back through the tiles it holds;
 * a road vehicle stands at its progress through its head tile, in the right-hand lane.
 */
export function rtVehicleParts(map: RtMap, vehicle: RtVehicle): RtVehiclePart[] {
    const parts: RtVehiclePart[] = []
    const { tiles, pieces } = vehicle
    if (tiles.length === 0 || tiles.length !== pieces.length || !map.validTile(tiles[0]!)) return parts
    if (vehicle.kind === RtVehicleKind.road) {
        const bay = rtBayPart(map, vehicle)
        if (bay) return [bay]
        const dir = pieces[0]! & 3
        const a = RT_EDGE_MID[(dir + 2) & 3]!
        const b = RT_EDGE_MID[dir]!
        const f = Math.min(1, Math.max(0, vehicle.progress / RT_CATALOG.movement.subTileUnits))
        const vx = b[0] - a[0]
        const vy = b[1] - a[1]
        const lx = a[0] + vx * f + vy * RT_ROAD_LANE_OFFSET
        const ly = a[1] + vy * f - vx * RT_ROAD_LANE_OFFSET
        parts.push({ index: 0, model: vehicle.consist[0] ?? vehicle.model, tile: tiles[0]!, lx, ly, height: rtStandHeight(map, tiles[0]!, lx, ly), direction: 1 + 2 * dir })
        return parts
    }
    for (let k = 0; k < vehicle.consist.length; k++) {
        let behind = (k + 0.5) * RT_PART_UNITS
        let i = 0
        let avail = Math.min(Math.max(vehicle.progress, 0), rtValidTrackdir(pieces[0]!) ? rtPieceLength(pieces[0]!) : 0)
        while (behind > avail && i + 1 < tiles.length) {
            behind -= avail
            i++
            avail = rtValidTrackdir(pieces[i]!) ? rtPieceLength(pieces[i]!) : 0
        }
        const td = pieces[i]!
        const tile = tiles[i]!
        if (!rtValidTrackdir(td) || !map.validTile(tile)) continue
        const f = Math.max(0, avail - behind) / rtPieceLength(td)
        const a = RT_EDGE_MID[rtTrackdirEntryEdge(td)]!
        const b = RT_EDGE_MID[rtTrackdirExitDir(td)]!
        const lx = a[0] + (b[0] - a[0]) * f
        const ly = a[1] + (b[1] - a[1]) * f
        parts.push({ index: k, model: vehicle.consist[k]!, tile, lx, ly, height: rtStandHeight(map, tile, lx, ly), direction: rtTrackdirDirection(td) })
    }
    return parts
}

/** How deep into a bay (tile widths from the entrance) a vehicle halts to load. */
export const RT_BAY_DEPTH = 0.62

/**
 * Where a road vehicle whose head stands in a bay stop is drawn, or null when it is not in one. Its
 * bay's lane names the side of the tile the bay lies on (rtBayLane); its progress runs in to
 * RT_BAY_STOP, the halt at RT_BAY_DEPTH, and back out to the entrance, facing in on the way in and
 * out on the way out, so it turns round where it loaded.
 */
export function rtBayPart(map: RtMap, vehicle: RtVehicle): RtVehiclePart | null {
    const tile = vehicle.tiles[0]!
    const facing = rtBayFacingAt(map, tile)
    if (facing < 0) return null
    const slot = rtBaySlot(facing as RtDir, vehicle.pieces[0]!)
    const entry = RT_EDGE_MID[facing]!
    const back = RT_EDGE_MID[(facing + 2) & 3]!
    const progress = Math.min(Math.max(vehicle.progress, 0), RT_CATALOG.movement.subTileUnits)
    const inbound = progress <= RT_BAY_STOP
    const depth = RT_BAY_DEPTH * (inbound ? progress : RT_CATALOG.movement.subTileUnits - progress) / RT_BAY_STOP
    // across the tile towards its bay's side; a lane that is no bay (a hostile save) keeps to the middle
    const side = RT_EDGE_MID[vehicle.pieces[0]! & 3]!
    const sx = slot < 0 ? 0 : (side[0] - 0.5) * 2 * RT_ROAD_LANE_OFFSET
    const sy = slot < 0 ? 0 : (side[1] - 0.5) * 2 * RT_ROAD_LANE_OFFSET
    const lx = entry[0] + (back[0] - entry[0]) * depth + sx
    const ly = entry[1] + (back[1] - entry[1]) * depth + sy
    const heading = inbound ? (facing + 2) & 3 : facing
    return {
        index: 0,
        model: vehicle.consist[0] ?? vehicle.model,
        tile,
        lx,
        ly,
        height: rtStandHeight(map, tile, lx, ly),
        direction: 1 + 2 * heading
    }
}

/** A vehicle window badge: parked in a spot, or stopped and still travelling to find one. */
export type RtVehicleBadge = 'parked' | 'parking'

export function rtVehicleBadge(vehicle: RtVehicle): RtVehicleBadge | null {
    if (vehicle.kind !== RtVehicleKind.rail) return null
    if (vehicle.state === RtVehicleState.parked) return 'parked'
    if (vehicle.state === RtVehicleState.parking) return 'parking'
    if (vehicle.stopped && vehicle.state === RtVehicleState.driving) return 'parking'
    return null
}

/* ------------------------------------------------------------------------------------------
 * Income floats
 * ---------------------------------------------------------------------------------------- */

/** How long income text shows, rising and fading (ms). */
export const RT_FLOAT_MS = 2000
/** How far it rises over that time (CSS pixels). */
export const RT_FLOAT_RISE = 24
/** It stays opaque for this long, then fades out over the rest. */
export const RT_FLOAT_HOLD_MS = 1000
/** Most floats on screen at once; the oldest goes first. */
export const RT_FLOAT_MAX = 64

export interface RtFloat {
    tile: number
    amount: number
    company: number
    /** Time it appeared (ms, the renderer's clock). */
    born: number
}

/** Rise (CSS pixels) and opacity of a float `age` ms old, or null once it is gone. */
export function rtFloatLook(age: number): { rise: number, alpha: number } | null {
    if (age < 0 || age >= RT_FLOAT_MS) return age < 0 ? { rise: 0, alpha: 1 } : null
    const alpha = age <= RT_FLOAT_HOLD_MS ? 1 : 1 - (age - RT_FLOAT_HOLD_MS) / (RT_FLOAT_MS - RT_FLOAT_HOLD_MS)
    return { rise: (age / RT_FLOAT_MS) * RT_FLOAT_RISE, alpha }
}

/** Income text as the original shows it: the amount paid, in pounds. */
export function rtFormatIncome(amount: number): string {
    return `+£${Math.round(amount).toLocaleString('en-GB')}`
}

/** The income floats alive at a time; the renderer draws them. */
export class RtFloatTexts {
    readonly items: RtFloat[] = []

    add(payment: RtPayment, now: number): RtFloat | null {
        if (!(payment.amount > 0) || payment.tile < 0) return null
        const float: RtFloat = { tile: payment.tile, amount: payment.amount, company: payment.company, born: now }
        this.items.push(float)
        if (this.items.length > RT_FLOAT_MAX) this.items.shift()
        return float
    }

    /** Drops the floats that are gone at `now` and returns them. */
    prune(now: number): RtFloat[] {
        const gone: RtFloat[] = []
        let keep = 0
        for (const float of this.items) {
            if (rtFloatLook(now - float.born)) this.items[keep++] = float
            else gone.push(float)
        }
        this.items.length = keep
        return gone
    }

    clear(): void {
        this.items.length = 0
    }
}
