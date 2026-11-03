// Rail Tycoon — camera.
//
// The isometric projection between tiles and screen pixels, as in the original game: 2:1 diamonds
// 64 px wide and 32 px tall at zoom 1, 8 px per height level. Tile x runs down-left on screen and
// tile y down-right, so the north corner of tile (x, y) is the top of its diamond.
//
// World pixels are screen pixels at zoom 1 with the north corner of tile (0, 0) at height 0 as the
// origin. RtCamera adds the scroll position, the zoom (0.5, 1, 2 and 4) and the viewport, rounds
// every screen position to a whole device pixel, picks the tile under a screen point with heights
// taken into account, and turns drags, arrow keys and screen-edge hovering into scrolling.
//
// Pure: no pixi, no DOM. The renderer and the tools read it; tests run it headless.

import { RT_MAX_HEIGHT } from '#shared/utils/rail-tycoon/map'
import type { RtMap, RtTileXY } from '#shared/utils/rail-tycoon/map'

/* ------------------------------------------------------------------------------------------
 * Projection
 * ---------------------------------------------------------------------------------------- */

/** Tile diamond width in world pixels (zoom 1). */
export const RT_CAMERA_TILE_W = 64
/** Tile diamond height in world pixels (zoom 1). */
export const RT_CAMERA_TILE_H = 32
/** World pixels a tile rises per height level. */
export const RT_CAMERA_HEIGHT_STEP = 8

/** The zoom steps, overview first: 0.5 shows twice the map, 4 is the closest view. */
export const RT_CAMERA_ZOOMS = [0.5, 1, 2, 4] as const
export type RtCameraZoom = typeof RT_CAMERA_ZOOMS[number]

const HALF_W = RT_CAMERA_TILE_W / 2
const HALF_H = RT_CAMERA_TILE_H / 2

export interface RtPoint {
    x: number
    y: number
}

/**
 * World pixel position of map point (x, y) at a height level. Integer x and y give the north corner
 * of tile (x, y); fractions give points inside a tile and fractional heights points between levels.
 */
export function rtTileToWorld(x: number, y: number, height: number): RtPoint {
    return {
        x: (y - x) * HALF_W,
        y: (x + y) * HALF_H - height * RT_CAMERA_HEIGHT_STEP
    }
}

/** The map point (fractional tile coordinates) that projects to world point (wx, wy) at a height level. */
export function rtWorldToTile(wx: number, wy: number, height: number = 0): RtPoint {
    const s = (wy + height * RT_CAMERA_HEIGHT_STEP) / HALF_H
    const d = wx / HALF_W
    return { x: (s - d) / 2, y: (s + d) / 2 }
}

/** Corner heights of tile (x, y) as [n, w, e, s]; n is corner (x, y), w (x + 1, y), e (x, y + 1), s (x + 1, y + 1). */
export function rtCornerHeightsAt(map: RtMap, x: number, y: number): [number, number, number, number] {
    const c = map.side + 1
    const top = y * c + x
    const h = map.heights
    return [h[top]!, h[top + 1]!, h[top + c]!, h[top + c + 1]!]
}

/** Twice the signed area of (a, b, p): positive when p lies right of a -> b in screen space (y down). */
function cross(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

/** Whether p lies in triangle abc, edges included, whatever the winding. */
function inTriangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, px: number, py: number): boolean {
    const d1 = cross(ax, ay, bx, by, px, py)
    const d2 = cross(bx, by, cx, cy, px, py)
    const d3 = cross(cx, cy, ax, ay, px, py)
    const neg = d1 < 0 || d2 < 0 || d3 < 0
    const pos = d1 > 0 || d2 > 0 || d3 > 0
    return !(neg && pos)
}

/**
 * Whether world point (wx, wy) lies on the drawn surface of tile (x, y). The surface is the
 * quadrilateral of the four projected corners; the west corner always lies left of the north-south
 * diagonal and the east corner right of it, so the two triangles either side of it cover it exactly.
 */
export function rtTileContainsWorld(map: RtMap, x: number, y: number, wx: number, wy: number): boolean {
    const [hn, hw, he, hs] = rtCornerHeightsAt(map, x, y)
    const nx = (y - x) * HALF_W
    const ny = (x + y) * HALF_H
    const step = RT_CAMERA_HEIGHT_STEP
    const nY = ny - hn * step
    const wX = nx - HALF_W
    const wY = ny + HALF_H - hw * step
    const eX = nx + HALF_W
    const eY = ny + HALF_H - he * step
    const sY = ny + RT_CAMERA_TILE_H - hs * step
    if (wx < nx) return inTriangle(nx, nY, wX, wY, nx, sY, wx, wy)
    return inTriangle(nx, nY, eX, eY, nx, sY, wx, wy)
}

/* ------------------------------------------------------------------------------------------
 * Culling
 * ---------------------------------------------------------------------------------------- */

/**
 * A band of tiles in diagonal coordinates: s = x + y runs back (top of the screen) to front, and
 * d = y - x runs left to right. Walking s upwards is the back-to-front order the renderer draws in.
 */
export interface RtTileRange {
    sMin: number
    sMax: number
    dMin: number
    dMax: number
}

/** Extra world pixels around the viewport whose tiles still count as visible. */
export interface RtCullPad {
    /** Left and right, for sprites wider than their tile. */
    side: number
    /** Below the bottom edge, for tall sprites (houses, industries, trees) standing on tiles out of view. */
    below: number
}

export const RT_CAMERA_CULL_PAD: RtCullPad = { side: 32, below: 160 }

/** Visit every on-map tile of a range, back to front (s ascending) and left to right within a row. */
export function rtForEachTileInRange(range: RtTileRange, side: number, visit: (x: number, y: number) => void): void {
    const sTo = Math.min(range.sMax, 2 * (side - 1))
    for (let s = Math.max(range.sMin, 0); s <= sTo; s++) {
        // x = (s - d) / 2 and y = (s + d) / 2 must both be integers on the map
        let dFrom = Math.max(range.dMin, -s, s - 2 * (side - 1))
        const dTo = Math.min(range.dMax, s, 2 * (side - 1) - s)
        if ((dFrom + s) & 1) dFrom++
        for (let d = dFrom; d <= dTo; d += 2) visit((s - d) / 2, (s + d) / 2)
    }
}

/* ------------------------------------------------------------------------------------------
 * Scrolling feel (the original's, per 27 ms tick, in screen pixels)
 * ---------------------------------------------------------------------------------------- */

/** Milliseconds per scroll step; scrolling speeds below are per step and scale with elapsed time. */
export const RT_CAMERA_STEP_MS = 27
/** Arrow-key scroll per step, screen pixels; with shift held it is five times as fast. */
export const RT_CAMERA_KEY_SPEED = 20
export const RT_CAMERA_KEY_FAST = 5
/** Edge scrolling starts this many pixels from the viewport edge. */
export const RT_CAMERA_EDGE_ZONE = 15
/** Edge scroll per step for each pixel the cursor is into the edge zone. */
export const RT_CAMERA_EDGE_SPEED = 3

/** Arrow-key bits for keyScroll. */
export const RtScrollKey = {
    left: 1,
    up: 2,
    right: 4,
    down: 8
} as const

/**
 * How each arrow-key combination scrolls, in units of the key speed. Diagonals follow the 2:1 tile
 * axes rather than 45 degrees, and opposite keys cancel, as in the original.
 */
const KEY_VECTORS: readonly (readonly [number, number])[] = [
    [0, 0], [-1, 0], [0, -1], [-1, -0.5],
    [1, 0], [0, 0], [1, -0.5], [0, -1],
    [0, 1], [-1, 0.5], [0, 0], [-1, 0],
    [1, 0.5], [0, 1], [1, 0], [0, 0]
]

/**
 * How a drag moves the view. 'viewport' is the original default: the view travels with the mouse
 * (meant for a locked pointer). 'map' grabs the map instead, so it follows the cursor.
 */
export type RtDragMode = 'viewport' | 'map'

/* ------------------------------------------------------------------------------------------
 * RtCamera
 * ---------------------------------------------------------------------------------------- */

export interface RtCameraOptions {
    /** Viewport size in CSS pixels. */
    width?: number
    height?: number
    /** Device pixel ratio; rendering and rounding use it with a floor of 1. */
    dpr?: number
    zoom?: RtCameraZoom
    /** Map side, for clamping the view to the map. */
    mapSide?: number
}

export class RtCamera {
    /** Viewport size in CSS pixels. */
    width: number
    height: number
    /** Device pixels per CSS pixel, at least 1: positions round to multiples of 1 / resolution. */
    resolution: number
    zoom: RtCameraZoom
    /** World pixel at the viewport's top-left corner. */
    scrollX = 0
    scrollY = 0
    /** Map side the view is clamped to; 0 leaves it unclamped. */
    mapSide: number
    /** Bumped on every change of scroll, zoom or viewport, so a renderer can redraw only when it moved. */
    version = 0

    constructor(options: RtCameraOptions = {}) {
        this.width = options.width ?? 0
        this.height = options.height ?? 0
        this.resolution = Math.max(1, options.dpr ?? 1)
        this.zoom = options.zoom ?? 1
        this.mapSide = options.mapSide ?? 0
        this.clamp()
    }

    /** Follow the element's new size or the window's new device pixel ratio. */
    resize(width: number, height: number, dpr: number = this.resolution): void {
        const cx = this.scrollX + this.width / 2 / this.zoom
        const cy = this.scrollY + this.height / 2 / this.zoom
        this.width = width
        this.height = height
        this.resolution = Math.max(1, dpr)
        this.centreOnWorld(cx, cy)
    }

    setMapSide(side: number): void {
        this.mapSide = side
        this.clamp()
        this.version++
    }

    /** Round a CSS pixel position to a whole device pixel. */
    snap(v: number): number {
        return Math.round(v * this.resolution) / this.resolution
    }

    /** Screen position of the world origin, a whole device pixel: the renderer's world container goes here at scale zoom. */
    get originX(): number {
        return this.snap(-this.scrollX * this.zoom)
    }

    get originY(): number {
        return this.snap(-this.scrollY * this.zoom)
    }

    /* ---------------- projection ---------------- */

    /** Screen position (CSS pixels, whole device pixels) of a world pixel. */
    worldToScreen(wx: number, wy: number): RtPoint {
        return {
            x: this.originX + this.snap(wx * this.zoom),
            y: this.originY + this.snap(wy * this.zoom)
        }
    }

    /** World pixel under a screen position (CSS pixels from the viewport's top-left). */
    screenToWorld(px: number, py: number): RtPoint {
        return {
            x: (px - this.originX) / this.zoom,
            y: (py - this.originY) / this.zoom
        }
    }

    /** Screen position of the north corner of tile (x, y) at a height level (fractions allowed, as in rtTileToWorld). */
    tileToScreen(x: number, y: number, height: number): RtPoint {
        const w = rtTileToWorld(x, y, height)
        return this.worldToScreen(w.x, w.y)
    }

    /**
     * The tile whose drawn surface is under a screen position, or null off the map. Candidates are
     * the tiles whose diamond could reach the point at some height, tested front to back, so a
     * tile hidden behind a hill gives way to the hill in front of it.
     */
    screenToTile(px: number, py: number, map: RtMap): RtTileXY | null {
        const w = this.screenToWorld(px, py)
        const d = w.x / HALF_W
        // a tile's own diamond spans s = x + y to s + 2; raising it to height h lifts it by h / 2 rows
        const sLow = Math.floor(w.y / HALF_H) - 2
        const sHigh = Math.ceil((w.y + RT_MAX_HEIGHT * RT_CAMERA_HEIGHT_STEP) / HALF_H)
        const kLow = Math.ceil(d - 1)
        const kHigh = Math.floor(d + 1)
        const side = map.side
        for (let s = sHigh; s >= sLow; s--) {
            for (let k = kLow; k <= kHigh; k++) {
                if ((s + k) & 1) continue
                const x = (s - k) / 2
                const y = (s + k) / 2
                if (x < 0 || y < 0 || x >= side || y >= side) continue
                if (rtTileContainsWorld(map, x, y, w.x, w.y)) return { x, y }
            }
        }
        return null
    }

    /**
     * Tiles that can show in the viewport: every tile whose diamond, raised to any height up to the
     * map's maximum, touches the viewport grown by pad. Not clipped to the map; rtForEachTileInRange does that.
     */
    visibleTileRange(pad: RtCullPad = RT_CAMERA_CULL_PAD): RtTileRange {
        const tl = this.screenToWorld(0, 0)
        const br = this.screenToWorld(this.width, this.height)
        const wx0 = tl.x - pad.side
        const wx1 = br.x + pad.side
        const wy0 = tl.y
        const wy1 = br.y + pad.below
        return {
            sMin: Math.floor((wy0 - RT_CAMERA_TILE_H) / HALF_H),
            sMax: Math.ceil((wy1 + RT_MAX_HEIGHT * RT_CAMERA_HEIGHT_STEP) / HALF_H),
            dMin: Math.floor(wx0 / HALF_W - 1),
            dMax: Math.ceil(wx1 / HALF_W + 1)
        }
    }

    /* ---------------- moving ---------------- */

    /** Put world point (wx, wy) at the viewport's centre. */
    centreOnWorld(wx: number, wy: number): void {
        this.scrollX = wx - this.width / 2 / this.zoom
        this.scrollY = wy - this.height / 2 / this.zoom
        this.clamp()
        this.version++
    }

    /** Put a map point (tile coordinates, fractions allowed) at a height level at the viewport's centre. */
    centreOnTile(x: number, y: number, height: number = 0): void {
        const w = rtTileToWorld(x, y, height)
        this.centreOnWorld(w.x, w.y)
    }

    /** Move the view by screen pixels (positive x shows more of the right). */
    scrollBy(dx: number, dy: number): void {
        if (dx === 0 && dy === 0) return
        this.scrollX += dx / this.zoom
        this.scrollY += dy / this.zoom
        this.clamp()
        this.version++
    }

    /** Scroll for a mouse drag of (dx, dy) screen pixels. */
    dragScroll(dx: number, dy: number, mode: RtDragMode = 'viewport'): void {
        if (mode === 'viewport') this.scrollBy(dx, dy)
        else this.scrollBy(-dx, -dy)
    }

    /** Scroll for held arrow keys (RtScrollKey bits) over elapsed milliseconds. */
    keyScroll(keys: number, fast: boolean, elapsedMs: number): void {
        const v = KEY_VECTORS[keys & 15]!
        const speed = RT_CAMERA_KEY_SPEED * (fast ? RT_CAMERA_KEY_FAST : 1) * elapsedMs / RT_CAMERA_STEP_MS
        this.scrollBy(v[0] * speed, v[1] * speed)
    }

    /**
     * Scroll for the cursor resting near the viewport edge over elapsed milliseconds: the deeper into
     * the 15 px edge zone, the faster. Returns whether it scrolled.
     */
    edgeScroll(px: number, py: number, elapsedMs: number): boolean {
        const zone = RT_CAMERA_EDGE_ZONE
        const edge = (p: number, size: number): number => {
            if (p < zone) return p - zone
            if (p > size - zone) return p - (size - zone)
            return 0
        }
        const ex = edge(px, this.width)
        const ey = edge(py, this.height)
        if (ex === 0 && ey === 0) return false
        const k = RT_CAMERA_EDGE_SPEED * elapsedMs / RT_CAMERA_STEP_MS
        this.scrollBy(ex * k, ey * k)
        return true
    }

    /** Set the zoom, keeping the world point under screen (px, py) in place (default: the centre). */
    setZoom(zoom: RtCameraZoom, px: number = this.width / 2, py: number = this.height / 2): void {
        if (!RT_CAMERA_ZOOMS.includes(zoom)) throw new RangeError(`bad zoom: ${zoom}`)
        // the unrounded scroll, so zooming in and out at one spot never drifts the map
        const wx = this.scrollX + px / this.zoom
        const wy = this.scrollY + py / this.zoom
        this.zoom = zoom
        this.scrollX = wx - px / zoom
        this.scrollY = wy - py / zoom
        this.clamp()
        this.version++
    }

    /** Step one zoom level in (+1) or out (-1) around the cursor. Returns false at either end. */
    zoomAt(px: number, py: number, step: 1 | -1): boolean {
        const i = RT_CAMERA_ZOOMS.indexOf(this.zoom) + step
        const next = RT_CAMERA_ZOOMS[i]
        if (next === undefined) return false
        this.setZoom(next, px, py)
        return true
    }

    /** Keep the viewport's centre over the map (at sea level), as the original does. */
    private clamp(): void {
        if (this.mapSide <= 0) return
        const cx = this.scrollX + this.width / 2 / this.zoom
        const cy = this.scrollY + this.height / 2 / this.zoom
        const t = rtWorldToTile(cx, cy)
        const tx = Math.min(Math.max(t.x, 0), this.mapSide)
        const ty = Math.min(Math.max(t.y, 0), this.mapSide)
        if (tx === t.x && ty === t.y) return
        const w = rtTileToWorld(tx, ty, 0)
        this.scrollX = w.x - this.width / 2 / this.zoom
        this.scrollY = w.y - this.height / 2 / this.zoom
    }
}
