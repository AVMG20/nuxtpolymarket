// Rail Tycoon — render space.
//
// Canvas resolution, the tile ranges the renderer keeps drawn, depth keys and where on a tile
// things stand. Pure, unit tested in test/rail-tycoon/renderer.spec.ts.

import { RtTileKind, type RtMap } from '#shared/utils/rail-tycoon/map'
import { RtTrack, rtTrackdirEntryEdge, rtTrackdirExitDir } from '#shared/utils/rail-tycoon/track'
import { rtCornerHeightsAt, type RtTileRange } from './camera'
import { rtSlopeNameFromBits, type RtSlopeName, type RtTrackBitTable } from './sprite-names'

/* ------------------------------------------------------------------------------------------
 * Resolution, ranges and depth
 * ---------------------------------------------------------------------------------------- */

/**
 * Canvas resolution for a device pixel ratio and zoom: at least the ratio and never below 1 (the
 * house rule for dpr 1 screens), raised until a world pixel covers a whole number of canvas pixels.
 * Sprites sit on whole world pixels, so they then share one sub-pixel offset and round alike: at
 * 0.5x on a dpr 1 screen, or at a fractional ratio, a half-pixel position otherwise rounds one tile
 * left and its neighbour right, which shows as seams that shimmer while panning. The browser scales
 * the larger canvas down.
 */
export function rtRenderResolution(dpr: number | undefined, zoom: number = 1): number {
    const base = Math.max(1, Number.isFinite(dpr) && dpr! > 0 ? dpr! : 1)
    // the epsilon keeps 2 * 0.5 from rounding up to the next step
    return Math.ceil(base * zoom - 1e-9) / zoom
}

/** Rows and columns drawn beyond the visible range, so a pan rebuilds only when it leaves them. */
export const RT_RENDER_MARGIN = 8
/** A drawn range more than this many times the needed one (after zooming in) is rebuilt smaller. */
export const RT_RENDER_SHRINK = 2.5

export function rtTileInRange(range: RtTileRange, x: number, y: number): boolean {
    const s = x + y
    const d = y - x
    return s >= range.sMin && s <= range.sMax && d >= range.dMin && d <= range.dMax
}

export function rtRangeContains(outer: RtTileRange, inner: RtTileRange): boolean {
    return inner.sMin >= outer.sMin && inner.sMax <= outer.sMax && inner.dMin >= outer.dMin && inner.dMax <= outer.dMax
}

export function rtGrowRange(range: RtTileRange, margin: number): RtTileRange {
    return { sMin: range.sMin - margin, sMax: range.sMax + margin, dMin: range.dMin - margin, dMax: range.dMax + margin }
}

/** Tiles a range covers, map edges ignored (half the s by d cells hold a tile). */
export function rtRangeArea(range: RtTileRange): number {
    return Math.max(0, range.sMax - range.sMin + 1) * Math.max(0, range.dMax - range.dMin + 1) / 2
}

/** Ground sprites a tile may stack (foundation, ground, track overlays); the ground sort key leaves room for them. */
export const RT_GROUND_SUBLAYERS = 16

/** Sort key of a tile's sub-th ground sprite: back rows first, then the tile's own stacking order. */
export function rtGroundDepth(x: number, y: number, sub: number): number {
    return (x + y) * RT_GROUND_SUBLAYERS + Math.min(sub, RT_GROUND_SUBLAYERS - 1)
}

/**
 * Sort key of something standing at (lx, ly) inside tile (x, y), 0 to 1 each: within (x + y + 0.6,
 * x + y + 1.4), so anything of a tile row sorts after the row behind it and before the row in front.
 */
export function rtObjectDepth(x: number, y: number, lx: number, ly: number): number {
    return x + y + 0.6 + 0.4 * (Math.min(1, Math.max(0, lx)) + Math.min(1, Math.max(0, ly)))
}

/** Station, depot and road stop parts: rear before any vehicle on the tile, front after it. */
export function rtPartDepth(x: number, y: number, layer: 'rear' | 'front' | null): number {
    if (layer === 'rear') return x + y + 0.55
    if (layer === 'front') return x + y + 1.45
    return x + y + 1
}

/** A cheap integer hash of a tile index, for cosmetic choices (house variants, tree spots); never for outcomes. */
export function rtTileHash(tile: number): number {
    let h = Math.imul((tile ^ 0x9e3779b9) >>> 0, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
    return h >>> 0
}

/**
 * Height (levels, fractional) of the land at (lx, ly) inside a tile with corner heights [n, w, e, s].
 * The surface is two triangles split along the north-south diagonal, as RtCamera picks it.
 */
export function rtSurfaceHeight(corners: readonly [number, number, number, number], lx: number, ly: number): number {
    const [n, w, e, s] = corners
    if (lx >= ly) return n + (w - n) * lx + (s - w) * ly
    return n + (s - e) * lx + (e - n) * ly
}

/** The ramps: two adjacent corners raised, which road and a straight track climb without a foundation. */
export const RT_INCLINES: ReadonlySet<RtSlopeName> = new Set<RtSlopeName>(['ne', 'se', 'sw', 'nw'])

const SLOPE_NAMES = new Map<number, RtSlopeName>()

/** rtSlopeNameFromBits, remembered per value: a full redraw asks it for thousands of tiles. */
export function rtSlopeName(bits: number): RtSlopeName {
    let name = SLOPE_NAMES.get(bits)
    if (name === undefined) SLOPE_NAMES.set(bits, name = rtSlopeNameFromBits(bits))
    return name
}

/**
 * Height a vehicle or signal stands at on a tile: the land itself where the tile is drawn sloped
 * (rail, whose pieces always fit the land, and road on a ramp), else the level of its foundation.
 */
export function rtStandHeight(map: RtMap, tile: number, lx: number, ly: number): number {
    const x = map.tileX(tile)
    const y = map.tileY(tile)
    const slope = rtSlopeName(map.tileSlope(tile))
    if (slope === 'flat') return map.tileHeight(tile)
    const kind = map.kind[tile]
    if (kind === RtTileKind.rail || (kind === RtTileKind.road && RT_INCLINES.has(slope))) {
        return rtSurfaceHeight(rtCornerHeightsAt(map, x, y), lx, ly)
    }
    return map.tileMaxHeight(tile)
}

/* ------------------------------------------------------------------------------------------
 * Tile geometry
 * ---------------------------------------------------------------------------------------- */

/** Midpoint of each tile edge (RtDir order ne, se, sw, nw) in tile-local coordinates. */
export const RT_EDGE_MID: readonly (readonly [number, number])[] = [[0, 0.5], [0.5, 1], [1, 0.5], [0.5, 0]]

/** The rail piece bits of RtTrack as the atlas names them. */
export const RT_TRACK_BITS: RtTrackBitTable = {
    x: 1 << RtTrack.x,
    y: 1 << RtTrack.y,
    n: 1 << RtTrack.upper,
    s: 1 << RtTrack.lower,
    w: 1 << RtTrack.left,
    e: 1 << RtTrack.right
}

/** How far along its piece, from the entry edge, a signal stands (where a train it holds stops). */
export const RT_SIGNAL_ALONG = 0.3
/** How far beside the track (tile widths) a signal stands, on the right of the trains it governs. */
export const RT_SIGNAL_SIDE = 0.3
/** How far right of the road's centre line a road vehicle drives (tile widths). */
export const RT_ROAD_LANE_OFFSET = 0.18

function clampUnit(v: number): number {
    return Math.min(0.97, Math.max(0.03, v))
}

/**
 * Where in its tile the signal for trackdir td stands (tile-local, 0 to 1). Right of the travel
 * direction (vx, vy) in tile space is (vy, -vx): the projection mirrors, so this is right on screen.
 */
export function rtSignalPoint(td: number): { x: number, y: number } {
    const a = RT_EDGE_MID[rtTrackdirEntryEdge(td) & 3]!
    const b = RT_EDGE_MID[rtTrackdirExitDir(td) & 3]!
    const vx = b[0] - a[0]
    const vy = b[1] - a[1]
    const len = Math.hypot(vx, vy) || 1
    return {
        x: clampUnit(a[0] + vx * RT_SIGNAL_ALONG + (vy / len) * RT_SIGNAL_SIDE),
        y: clampUnit(a[1] + vy * RT_SIGNAL_ALONG - (vx / len) * RT_SIGNAL_SIDE)
    }
}

/** Where tree k of count stands in a tile (tile-local): one per quadrant, rotated and nudged by the tile hash. */
export function rtTreePoint(tile: number, k: number, count: number): { x: number, y: number } {
    const hash = rtTileHash(tile)
    if (count <= 1) return { x: 0.5 + (((hash >>> 4) & 7) - 3.5) / 40, y: 0.5 + (((hash >>> 7) & 7) - 3.5) / 40 }
    const slot = (k + (hash & 3)) & 3
    const jx = (((hash >>> (8 + k * 6)) & 7) - 3.5) / 48
    const jy = (((hash >>> (11 + k * 6)) & 7) - 3.5) / 48
    return { x: (slot & 1 ? 0.72 : 0.28) + jx, y: (slot & 2 ? 0.72 : 0.28) + jy }
}
