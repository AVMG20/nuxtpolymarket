/**
 * Rail Tycoon's tile map: the single source of truth for what occupies each tile.
 * Tiles are indexed y * side + x. Heights live on the (side + 1) squared corner grid, so a tile's
 * slope follows from its four corners as in the original game: the north corner of tile (x, y) is
 * corner (x, y), west is (x + 1, y), east is (x, y + 1) and south is (x + 1, y + 1).
 * Every array is a plain typed array so the save (save.ts) can write the map raw.
 */

import { RT_OWNER_NONE } from './types'

export const RtTileKind = {
    clear: 0,
    water: 1,
    coast: 2,
    tree: 3,
    rail: 4,
    road: 5,
    house: 6,
    industry: 7,
    station: 8,
    depot: 9
} as const
export type RtTileKind = typeof RtTileKind[keyof typeof RtTileKind]

const KIND_COUNT = 10

/** Highest corner height level; heights run 0 (sea level) to RT_MAX_HEIGHT. */
export const RT_MAX_HEIGHT = 15

/** Map sides RtMap accepts: powers of two from 64 to 256. */
export const RT_MAP_SIDES: readonly number[] = [64, 128, 256]

/**
 * tileSlope bits, the original's order: one bit per raised corner plus a steep flag. A steep slope
 * has its highest corner two levels above the lowest and carries the three corners above the lowest.
 */
export const RtSlope = {
    flat: 0,
    w: 1,
    s: 2,
    e: 4,
    n: 8,
    steep: 16,
    /** Ramps: two adjacent corners raised, climbing along one axis. */
    sw: 3,
    se: 6,
    nw: 9,
    ne: 12
} as const

/** The four axis directions, in the original's order (north-east first, clockwise). */
export const RtDir = {
    /** Towards x - 1. */
    ne: 0,
    /** Towards y + 1. */
    se: 1,
    /** Towards x + 1. */
    sw: 2,
    /** Towards y - 1. */
    nw: 3
} as const
export type RtDir = typeof RtDir[keyof typeof RtDir]

/** Every RtDir in order. */
export const RT_DIRS: readonly RtDir[] = [0, 1, 2, 3]

/** Tile step of each RtDir along x and y. */
export const RT_DIR_DX: readonly number[] = [-1, 0, 1, 0]
export const RT_DIR_DY: readonly number[] = [0, 1, 0, -1]

/** The opposite of a direction. */
export function rtReverseDir(dir: RtDir): RtDir {
    return ((dir + 2) & 3) as RtDir
}

/** Road bit of each RtDir, the original's road-bit values (nw 1, sw 2, se 4, ne 8). */
export const RT_ROAD_DIR_BIT: readonly number[] = [8, 4, 2, 1]

/**
 * Tree tile payload: bits 0-3 tree type (0-11), bits 4-6 growth stage (0-6, 3 fully grown),
 * bits 8-9 trees on the tile minus one (1 to 4 trees).
 */
export function rtTreePayload(type: number, stage: number, count: number): number {
    return (type & 15) | ((stage & 7) << 4) | (((count - 1) & 3) << 8)
}

export function rtTreeType(payload: number): number {
    return payload & 15
}

export function rtTreeStage(payload: number): number {
    return (payload >>> 4) & 7
}

export function rtTreeCount(payload: number): number {
    return ((payload >>> 8) & 3) + 1
}

export interface RtTileXY {
    x: number
    y: number
}

export class RtMap {
    /** Tiles per side. */
    readonly side: number
    /** side * side. */
    readonly tileCount: number
    /** Corner heights, (side + 1) squared, index cy * (side + 1) + cx, 0 to RT_MAX_HEIGHT. */
    readonly heights: Uint8Array
    /** RtTileKind per tile. */
    readonly kind: Uint8Array
    /** Owning company per tile; RT_OWNER_NONE (255) for none or a town. */
    readonly owner: Uint8Array
    /** Per-tile data whose meaning depends on kind. */
    readonly payload: Uint32Array

    constructor(side: number) {
        if (!RT_MAP_SIDES.includes(side)) {
            throw new RangeError(`map side must be a power of two from 64 to 256: ${side}`)
        }
        this.side = side
        this.tileCount = side * side
        this.heights = new Uint8Array((side + 1) * (side + 1))
        this.kind = new Uint8Array(this.tileCount)
        this.owner = new Uint8Array(this.tileCount).fill(RT_OWNER_NONE)
        this.payload = new Uint32Array(this.tileCount)
    }

    /** Tile index of (x, y); the caller keeps (x, y) in bounds. */
    idx(x: number, y: number): number {
        return y * this.side + x
    }

    /** Tile coordinates of index i. */
    xy(i: number): RtTileXY {
        return { x: i % this.side, y: (i / this.side) | 0 }
    }

    tileX(i: number): number {
        return i % this.side
    }

    tileY(i: number): number {
        return (i / this.side) | 0
    }

    /** Whether tile (x, y) lies on the map. */
    inBounds(x: number, y: number): boolean {
        return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.side && y < this.side
    }

    /** Whether i is a tile index on the map. */
    validTile(i: number): boolean {
        return Number.isInteger(i) && i >= 0 && i < this.tileCount
    }

    private cornerIndex(cx: number, cy: number): number {
        const c = this.side + 1
        if (!Number.isInteger(cx) || !Number.isInteger(cy) || cx < 0 || cy < 0 || cx >= c || cy >= c) {
            throw new RangeError(`corner out of range: ${cx},${cy}`)
        }
        return cy * c + cx
    }

    /** Height of corner (cx, cy), 0 <= cx, cy <= side. */
    cornerHeight(cx: number, cy: number): number {
        return this.heights[this.cornerIndex(cx, cy)]!
    }

    setCornerHeight(cx: number, cy: number, height: number): void {
        if (!Number.isInteger(height) || height < 0 || height > RT_MAX_HEIGHT) {
            throw new RangeError(`height out of range: ${height}`)
        }
        this.heights[this.cornerIndex(cx, cy)] = height
    }

    /** The four corner heights of tile i as [n, w, e, s]. */
    private corners(i: number): [number, number, number, number] {
        const c = this.side + 1
        const x = i % this.side
        const y = (i / this.side) | 0
        const top = y * c + x
        const h = this.heights
        return [h[top]!, h[top + 1]!, h[top + c]!, h[top + c + 1]!]
    }

    /** Raised-corner mask (RtSlope corner bits) plus RtSlope.steep when a corner is 2+ above the lowest. */
    tileSlope(i: number): number {
        const [n, w, e, s] = this.corners(i)
        const low = Math.min(n, w, e, s)
        const high = Math.max(n, w, e, s)
        let slope = 0
        if (w > low) slope |= RtSlope.w
        if (s > low) slope |= RtSlope.s
        if (e > low) slope |= RtSlope.e
        if (n > low) slope |= RtSlope.n
        if (high - low >= 2) slope |= RtSlope.steep
        return slope
    }

    /** Height of the tile's lowest corner. */
    tileHeight(i: number): number {
        const [n, w, e, s] = this.corners(i)
        return Math.min(n, w, e, s)
    }

    /** Height of the tile's highest corner. */
    tileMaxHeight(i: number): number {
        const [n, w, e, s] = this.corners(i)
        return Math.max(n, w, e, s)
    }

    isFlat(i: number): boolean {
        const [n, w, e, s] = this.corners(i)
        return n === w && n === e && n === s
    }

    /** The tile one step from i in an axis direction, or -1 past the edge. */
    neighbour(i: number, dir: RtDir): number {
        const x = i % this.side + RT_DIR_DX[dir]!
        const y = ((i / this.side) | 0) + RT_DIR_DY[dir]!
        if (x < 0 || y < 0 || x >= this.side || y >= this.side) return -1
        return y * this.side + x
    }

    /** Write a tile's kind, owner and payload together. */
    setTile(i: number, kind: RtTileKind, owner: number, payload: number): void {
        if (!this.validTile(i)) throw new RangeError(`tile out of range: ${i}`)
        if (!Number.isInteger(kind) || kind < 0 || kind >= KIND_COUNT) throw new RangeError(`bad tile kind: ${kind}`)
        if (!Number.isInteger(owner) || owner < 0 || owner > 255) throw new RangeError(`bad owner: ${owner}`)
        if (!Number.isInteger(payload) || payload < 0 || payload > 0xffffffff) throw new RangeError(`bad payload: ${payload}`)
        this.kind[i] = kind
        this.owner[i] = owner
        this.payload[i] = payload
    }
}
