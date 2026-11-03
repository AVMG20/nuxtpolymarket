// Rail Tycoon — build tools.
//
// Turns pointer gestures on tiles into commands: rail and road lines, stations, road stops, depots,
// signals, parking spots, the bulldozer, the query click and the orders editor's pick mode. Every
// gesture emits at most one command, on release: a drag becomes one line or area command
// however long it is, clamped to the catalog's line and area caps first so the UI never builds a
// payload the server refuses for size.
//
// The preview runs the same build rules with apply off against the local world, treating pieces
// that are already there as free and passable as the line command does, and stops where the
// command would stop: a refusal or the money running out. It only guides the player. The server's
// pre-check and the stamped apply decide; a gesture that would build nothing emits nothing.
//
// Pure: no pixi, no DOM. The game view feeds it tiles (and where in the tile the pointer is) from
// RtCamera and draws the preview; tests drive it headless.

import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import {
    RtCommandError,
    RtCommandKind,
    applyCommand,
    rtAreaRect,
    rtLineMaxTiles,
    rtRailLineWalk,
    rtStationFootprint,
    type RtCommand
} from '#shared/utils/rail-tycoon/commands'
import { rtCatchmentOf } from '#shared/utils/rail-tycoon/stations'
import { RtTileKind, type RtDir, type RtMap } from '#shared/utils/rail-tycoon/map'
import { RtSignalType, rtSignalTypeAt } from '#shared/utils/rail-tycoon/signals'
import { RtAxis, RtRoadStopShape, RtStationTile, rtBayShape, rtShapeIsBay, rtStationId } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_X, RT_ROAD_Y, RT_TRACK_COUNT, RtTrack, rtRailTilePieces } from '#shared/utils/rail-tycoon/track'
import { RT_NONE, RtVehicleKind } from '#shared/utils/rail-tycoon/types'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'
import { rtCornerHeightsAt, rtWorldToTile, type RtCamera } from './camera'

/* ------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------- */

export const RtToolKind = {
    none: 0,
    rail: 1,
    road: 2,
    railStation: 3,
    roadStop: 4,
    depot: 5,
    signal: 6,
    demolish: 7,
    query: 8,
    pick: 9,
    parking: 10
} as const
export type RtToolKind = typeof RtToolKind[keyof typeof RtToolKind]

/** What the orders editor asks the player to click: a station or a depot. */
export type RtPickKind = 'station' | 'depot'

export interface RtPicked {
    kind: RtPickKind
    /** The station id, or the depot's tile (a depot order's target). */
    id: number
}

/**
 * The rail tool's direction, the original's four track buttons and autorail: on screen, x runs
 * south-west to north-east, y north-west to south-east, horizontal is the upper and lower pieces and
 * vertical the left and right ones. Autorail takes whichever piece the drag points along.
 */
export const RtRailDirection = { auto: 0, x: 1, y: 2, horizontal: 3, vertical: 4 } as const
export type RtRailDirection = typeof RtRailDirection[keyof typeof RtRailDirection]

const RAIL_DIRECTION_PIECES: readonly number[] = [
    0x3f,
    1 << RtTrack.x,
    1 << RtTrack.y,
    (1 << RtTrack.upper) | (1 << RtTrack.lower),
    (1 << RtTrack.left) | (1 << RtTrack.right)
]

/** The piece bits a rail click or drag may start with in a direction. */
export function rtRailDirectionPieces(direction: RtRailDirection): number {
    return RAIL_DIRECTION_PIECES[direction] ?? 0x3f
}

/** The road tool's axis, the original's two road buttons and autoroad, which follows the longer drag. */
export const RtRoadDirection = { auto: 0, x: 1, y: 2 } as const
export type RtRoadDirection = typeof RtRoadDirection[keyof typeof RtRoadDirection]

/** The toolbar's settings for the tools that take them. */
export interface RtToolOptions {
    railDirection: RtRailDirection
    roadDirection: RtRoadDirection
    /** The signal type a click on an unsignalled piece places. */
    signalType: RtSignalType
    stationAxis: RtAxis
    /** Platforms side by side, 1 to RT_MAX_PLATFORMS. */
    stationTracks: number
    /** Platform length in tiles, 1 to RT_MAX_PLATFORM_LENGTH. */
    stationLength: number
    stopType: typeof RtStationTile.bus | typeof RtStationTile.truck
    /** The stop's shape (RtRoadStopShape): a bay facing a side or a drive-through stop along an axis; R turns it. */
    stopShape: RtRoadStopShape
    depotKind: RtVehicleKind
    /** The side the depot's entrance faces (RtDir); R turns it. */
    depotFacing: number
}

/** What a gesture would do, for the view to draw. */
export interface RtToolPreview {
    /** Tiles the gesture covers. */
    tiles: number[]
    /** Tiles it would not reach: from the first refusal or the first step it cannot pay for (drawn red). */
    blocked: number[]
    /** The catchment of a station or road stop being placed. */
    catchment: number[]
    /** Total cost of what would be built (a refund negative). */
    cost: number
    /** Whether releasing now sends a command. */
    ok: boolean
    /** Why nothing would be built, when the rules say why. */
    error: RtCommandError | null
    /** A short note for the player (a parking spot on a tile that is not a dead end). */
    hint: string | null
}

export interface RtToolEvents {
    command: RtCommand
    query: number
    picked: RtPicked
    /** Pick mode ended without a pick (Escape, or another tool chosen). */
    pickEnd: undefined
    preview: RtToolPreview | null
    /** The selected tool changed, pick mode included. */
    tool: RtToolKind
    /** The options changed: a new object each time, so a view can hold it in a shallow ref. */
    options: Readonly<RtToolOptions>
}

/** Where the tools read the world and who the player is. */
export interface RtToolContext {
    world(): RtWorld | null
    /** The player's company, or RT_NONE for a spectator (who may only query). */
    company(): number
}

/** The pointer's position inside its tile, both in [0, 1); the tile's centre when unknown. */
export interface RtSubTile {
    fx: number
    fy: number
}

const CENTRE: RtSubTile = { fx: 0.5, fy: 0.5 }

/** Every trackdir a line can start with: the six pieces each way. */
const TRACKDIRS = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13]

/* ------------------------------------------------------------------------------------------
 * Geometry helpers
 * ---------------------------------------------------------------------------------------- */

/**
 * How far a point in the tile lies from a piece's centre line. Tile corners: north (0, 0), west
 * (1, 0), east (0, 1), south (1, 1); x crosses from the x = 0 edge to the x = 1 edge.
 */
function pieceDistance(piece: number, at: RtSubTile): number {
    const { fx, fy } = at
    switch (piece) {
        case RtTrack.x: return Math.abs(fy - 0.5)
        case RtTrack.y: return Math.abs(fx - 0.5)
        case RtTrack.upper: return Math.abs(fx + fy - 0.5)
        case RtTrack.lower: return Math.abs(fx + fy - 1.5)
        case RtTrack.left: return Math.abs(fx - fy - 0.5)
        default: return Math.abs(fy - fx - 0.5)
    }
}

/** The piece of `mask` (or of all six when 0) nearest the pointer, the lowest on a tie. */
export function rtNearestPiece(mask: number, at: RtSubTile = CENTRE): number {
    let best = -1
    let bestDistance = Infinity
    for (let piece = 0; piece < RT_TRACK_COUNT; piece++) {
        if (mask !== 0 && (mask & (1 << piece)) === 0) continue
        const d = pieceDistance(piece, at)
        if (d < bestDistance) {
            best = piece
            bestDistance = d
        }
    }
    return best
}

/**
 * The rail line from `start` towards `end`: of the straight and diagonal lines starting
 * at `start`, the one passing nearest `end`, cut at its tile nearest `end`. On a tie a line whose
 * first piece is already on the start tile wins (dragging on from the end of a line extends it), then
 * the first piece nearest the pointer. Only lines whose first piece is in `pieces` count. Null when no
 * line leaves the tile.
 */
export function rtRailDrag(map: RtMap, start: number, end: number, at: RtSubTile = CENTRE, pieces = 0x3f): { endTile: number, trackdir: number } | null {
    if (!map.validTile(start) || !map.validTile(end)) return null
    const [ex, ey] = [map.tileX(end), map.tileY(end)]
    const present = map.kind[start] === RtTileKind.rail ? rtRailTilePieces(map, start) : 0
    const max = rtLineMaxTiles(map)
    let best: { endTile: number, trackdir: number, score: number[] } | null = null
    for (const td of TRACKDIRS) {
        if ((pieces & (1 << (td & 7))) === 0) continue
        const walk = rtRailLineWalk(map, start, td, max)
        if (walk.length < 2) continue
        let k = 0
        let distance = Infinity
        walk.forEach((step, i) => {
            const d = (map.tileX(step.tile) - ex) ** 2 + (map.tileY(step.tile) - ey) ** 2
            if (d < distance) {
                distance = d
                k = i
            }
        })
        if (k === 0) continue
        const piece = walk[0]!.piece
        const score = [distance, (present & (1 << piece)) !== 0 ? 0 : 1, pieceDistance(piece, at)]
        if (!best || lexLess(score, best.score)) best = { endTile: walk[k]!.tile, trackdir: td, score }
    }
    return best ? { endTile: best.endTile, trackdir: best.trackdir } : null
}

function lexLess(a: number[], b: number[]): boolean {
    for (let i = 0; i < a.length; i++) {
        if (a[i]! !== b[i]!) return a[i]! < b[i]!
    }
    return false
}

/** R on a road stop: a bay turns to face the next side clockwise, a drive-through stop to the other axis. */
export function rtTurnRoadStopShape(shape: RtRoadStopShape): RtRoadStopShape {
    if (rtShapeIsBay(shape)) return rtBayShape(((shape - RtRoadStopShape.bayNe + 1) & 3) as RtDir)
    return shape === RtRoadStopShape.driveX ? RtRoadStopShape.driveY : RtRoadStopShape.driveX
}

/**
 * The road line from `start` towards `end`: along the row or column with the longer drag (or the
 * fixed axis), clamped to the line cap.
 */
export function rtRoadDrag(map: RtMap, start: number, end: number, direction: RtRoadDirection = RtRoadDirection.auto): number {
    const [x0, y0, x1, y1] = [map.tileX(start), map.tileY(start), map.tileX(end), map.tileY(end)]
    const max = rtLineMaxTiles(map) - 1
    const alongX = direction === RtRoadDirection.auto ? Math.abs(x1 - x0) >= Math.abs(y1 - y0) : direction === RtRoadDirection.x
    if (alongX) {
        return map.idx(x0 + Math.sign(x1 - x0) * Math.min(max, Math.abs(x1 - x0)), y0)
    }
    return map.idx(x0, y0 + Math.sign(y1 - y0) * Math.min(max, Math.abs(y1 - y0)))
}

/** The far corner of an area drag, clamped so neither side exceeds the area cap. */
export function rtAreaDrag(map: RtMap, start: number, end: number): number {
    const [x0, y0, x1, y1] = [map.tileX(start), map.tileY(start), map.tileX(end), map.tileY(end)]
    const max = RT_CATALOG.caps.areaMaxTiles - 1
    const clamp = (from: number, to: number) => from + Math.sign(to - from) * Math.min(max, Math.abs(to - from))
    return map.idx(clamp(x0, x1), clamp(y0, y1))
}

/**
 * The tile under a screen point and where in it the pointer is, for the tools' piece choice: the
 * point projected at the tile's mean corner height, clamped into the tile. Null off the map.
 */
export function rtPointerTile(camera: RtCamera, map: RtMap, px: number, py: number): { tile: number, at: RtSubTile } | null {
    const hit = camera.screenToTile(px, py, map)
    if (!hit) return null
    const [n, w, e, s] = rtCornerHeightsAt(map, hit.x, hit.y)
    const world = camera.screenToWorld(px, py)
    const point = rtWorldToTile(world.x, world.y, (n + w + e + s) / 4)
    const inside = (v: number) => Math.min(0.999, Math.max(0, v))
    return { tile: map.idx(hit.x, hit.y), at: { fx: inside(point.x - hit.x), fy: inside(point.y - hit.y) } }
}

/* ------------------------------------------------------------------------------------------
 * RtTools
 * ---------------------------------------------------------------------------------------- */

type Listener<K extends keyof RtToolEvents> = (value: RtToolEvents[K]) => void

/** A gesture in progress: where the press started, and the command and preview it would send now. */
interface Gesture {
    start: number
    at: RtSubTile
    command: RtCommand | null
}

export class RtTools {
    tool: RtToolKind = RtToolKind.none
    /** Replaced, never changed in place: setOptions() is the only writer. */
    private current: Readonly<RtToolOptions> = {
        railDirection: RtRailDirection.auto,
        roadDirection: RtRoadDirection.auto,
        signalType: RtSignalType.path,
        stationAxis: RtAxis.x,
        stationTracks: 1,
        stationLength: 4,
        stopType: RtStationTile.bus,
        stopShape: RtRoadStopShape.driveX,
        depotKind: RtVehicleKind.rail,
        depotFacing: 2
    }

    /** What the gesture (or, between gestures, the hover) would do now. */
    preview: RtToolPreview | null = null

    private gesture: Gesture | null = null
    private hover = RT_NONE
    private pickKinds: RtPickKind[] = []
    private beforePick: RtToolKind = RtToolKind.none
    private readonly listeners = new Map<keyof RtToolEvents, Set<(value: never) => void>>()

    constructor(private readonly context: RtToolContext) {}

    get options(): Readonly<RtToolOptions> {
        return this.current
    }

    /** Changes some options, tells the listeners and recomputes the preview. */
    setOptions(patch: Partial<RtToolOptions>): void {
        this.current = { ...this.current, ...patch }
        this.emit('options', this.current)
        this.refresh()
    }

    on<K extends keyof RtToolEvents>(event: K, listener: Listener<K>): () => void {
        let set = this.listeners.get(event)
        if (!set) this.listeners.set(event, set = new Set())
        set.add(listener as (value: never) => void)
        return () => set.delete(listener as (value: never) => void)
    }

    private emit<K extends keyof RtToolEvents>(event: K, value: RtToolEvents[K]): void {
        for (const listener of this.listeners.get(event) ?? []) (listener as Listener<K>)(value)
    }

    /** Chooses a tool; leaving pick mode this way ends it without a pick. */
    select(tool: RtToolKind): void {
        if (this.tool === RtToolKind.pick && tool !== RtToolKind.pick) {
            this.pickKinds = []
            this.emit('pickEnd', undefined)
        }
        this.tool = tool
        this.cancel()
        this.emit('tool', tool)
    }

    /** Pick mode for the orders editor: the next click on one of these emits picked. */
    enterPick(kinds: RtPickKind[]): void {
        if (this.tool !== RtToolKind.pick) this.beforePick = this.tool
        this.tool = RtToolKind.pick
        this.pickKinds = [...kinds]
        this.cancel()
        this.emit('tool', this.tool)
    }

    private leavePick(picked: RtPicked | null): void {
        this.pickKinds = []
        this.tool = this.beforePick
        this.cancel()
        this.emit('tool', this.tool)
        if (picked) this.emit('picked', picked)
        else this.emit('pickEnd', undefined)
    }

    /**
     * Outlines tiles and shades a catchment through the preview stream, for a window such as the
     * station's. Returns the preview emitted: the next preview that is not this one replaced it.
     * refresh() brings the tool's own preview back.
     */
    highlight(tiles: number[], catchment: number[]): RtToolPreview {
        const preview: RtToolPreview = { tiles: [...tiles], blocked: [], catchment: [...catchment], cost: 0, ok: true, error: null, hint: null }
        this.emit('preview', preview)
        return preview
    }

    /** Drops the gesture in progress; nothing is sent. */
    cancel(): void {
        this.gesture = null
        this.setPreview(this.hover !== RT_NONE ? this.hoverPreview(this.hover) : null)
    }

    /** A key: R turns the depot, the station axis or the road stop, Escape cancels the gesture or leaves pick mode. */
    key(key: string): void {
        if (key === 'Escape') {
            if (this.gesture) this.cancel()
            else if (this.tool === RtToolKind.pick) this.leavePick(null)
            else this.select(RtToolKind.none)
            return
        }
        if (key === 'r' || key === 'R') {
            const o = this.current
            if (this.tool === RtToolKind.depot) this.setOptions({ depotFacing: (o.depotFacing + 1) & 3 })
            else if (this.tool === RtToolKind.railStation) this.setOptions({ stationAxis: o.stationAxis === RtAxis.x ? RtAxis.y : RtAxis.x })
            else if (this.tool === RtToolKind.roadStop) this.setOptions({ stopShape: rtTurnRoadStopShape(o.stopShape) })
        }
    }

    /** Recomputes the preview after the world or an option changed. */
    refresh(): void {
        if (this.gesture) this.track(this.hover !== RT_NONE ? this.hover : this.gesture.start, this.gesture.at)
        else this.setPreview(this.hover !== RT_NONE ? this.hoverPreview(this.hover) : null)
    }

    pointerDown(tile: number, at: RtSubTile = CENTRE): void {
        const world = this.context.world()
        if (!world || !world.map.validTile(tile)) return
        this.hover = tile
        if (this.tool === RtToolKind.rail || this.tool === RtToolKind.road || this.tool === RtToolKind.demolish) {
            this.gesture = { start: tile, at, command: null }
            this.track(tile, at)
        }
    }

    pointerMove(tile: number, at: RtSubTile = CENTRE): void {
        const world = this.context.world()
        if (!world || !world.map.validTile(tile)) return
        this.hover = tile
        if (this.gesture) this.track(tile, this.gesture.at)
        else this.setPreview(this.hoverPreview(tile, at))
    }

    /** The release: sends the gesture's command, or the click's for a single-tile tool. `remove` is the remove modifier. */
    pointerUp(tile: number, at: RtSubTile = CENTRE, remove = false): void {
        const world = this.context.world()
        if (!world) return
        if (this.gesture) {
            if (world.map.validTile(tile)) this.track(tile, this.gesture.at)
            const command = this.preview?.ok ? this.gesture.command : null
            this.gesture = null
            if (command) this.emit('command', command)
            this.setPreview(null)
            return
        }
        if (!world.map.validTile(tile)) return
        if (this.tool === RtToolKind.query) {
            this.emit('query', tile)
            return
        }
        if (this.tool === RtToolKind.pick) {
            const picked = this.pickAt(world, tile)
            if (picked) this.leavePick(picked)
            return
        }
        const command = this.clickCommand(world, tile, at, remove)
        if (!command) return
        const preview = this.previewSingle(world, command, tile)
        this.setPreview(preview)
        if (preview.ok) this.emit('command', command)
    }

    private setPreview(preview: RtToolPreview | null): void {
        this.preview = preview
        this.emit('preview', preview)
    }

    /* --------------------------------------------------------------------------------------
     * Drags
     * ------------------------------------------------------------------------------------ */

    private track(tile: number, at: RtSubTile): void {
        const world = this.context.world()
        const gesture = this.gesture
        if (!world || !gesture) return
        const map = world.map
        const start = gesture.start
        let command: RtCommand | null = null
        let preview: RtToolPreview
        if (this.tool === RtToolKind.rail) {
            const allowed = rtRailDirectionPieces(this.options.railDirection)
            if (tile === start) {
                const present = map.kind[start] === RtTileKind.rail ? rtRailTilePieces(map, start) : 0
                // a click on a tile: the free allowed piece nearest the pointer (any allowed one once all are there)
                const piece = rtNearestPiece((~present & allowed) || allowed, at)
                command = { kind: RtCommandKind.buildRail, tile: start, piece }
                preview = this.previewSingle(world, command, start)
            } else {
                const line = rtRailDrag(map, start, tile, at, allowed)
                if (line) {
                    command = { kind: RtCommandKind.buildRailLine, tile: start, endTile: line.endTile, trackdir: line.trackdir }
                    const walk = rtRailLineWalk(map, start, line.trackdir, rtLineMaxTiles(map))
                    const steps = walk.slice(0, walk.findIndex(step => step.tile === line.endTile) + 1)
                    preview = this.previewSteps(world, steps.map(step => ({
                        tile: step.tile, command: { kind: RtCommandKind.buildRail, tile: step.tile, piece: step.piece }
                    })))
                } else {
                    preview = emptyPreview([start])
                }
            }
        } else if (this.tool === RtToolKind.road) {
            const direction = this.options.roadDirection
            const endTile = rtRoadDrag(map, start, tile, direction)
            if (endTile === start && direction !== RtRoadDirection.auto) {
                // a click with a fixed axis builds that axis's straight piece
                command = { kind: RtCommandKind.buildRoad, tile: start, bits: direction === RtRoadDirection.x ? RT_ROAD_X : RT_ROAD_Y }
                preview = this.previewSingle(world, command, start)
            } else {
                command = { kind: RtCommandKind.buildRoadLine, tile: start, endTile }
                preview = this.previewRoad(world, start, endTile)
            }
        } else {
            const endTile = rtAreaDrag(map, start, tile)
            command = start === endTile ? { kind: RtCommandKind.demolish, tile: start } : { kind: RtCommandKind.demolishArea, tile: start, endTile }
            preview = this.previewSingle(world, command, ...rtAreaRect(map, start, endTile))
        }
        gesture.command = command
        this.setPreview(preview)
    }

    /** A road drag's preview, step by step as the line command builds it. */
    private previewRoad(world: RtWorld, start: number, endTile: number): RtToolPreview {
        const map = world.map
        const [x0, y0, x1, y1] = [map.tileX(start), map.tileY(start), map.tileX(endTile), map.tileY(endTile)]
        if (start === endTile) return this.previewSingle(world, { kind: RtCommandKind.buildRoadLine, tile: start, endTile }, start)
        const tiles: number[] = []
        const count = Math.abs(x1 - x0) + Math.abs(y1 - y0) + 1
        for (let k = 0; k < count; k++) tiles.push(map.idx(x0 + Math.sign(x1 - x0) * k, y0 + Math.sign(y1 - y0) * k))
        // the line command builds each tile's straight piece along the drag
        const bits = y0 === y1 ? RT_ROAD_X : RT_ROAD_Y
        return this.previewSteps(world, tiles.map(tile => ({ tile, command: { kind: RtCommandKind.buildRoad, tile, bits } })))
    }

    /**
     * Previews a drag's steps in order as the server's drag does: a step already built is free and
     * passable, the first refusal or the first step the cash cannot cover ends the line there.
     */
    private previewSteps(world: RtWorld, steps: { tile: number, command: RtCommand }[]): RtToolPreview {
        const preview = emptyPreview(steps.map(step => step.tile))
        const companyId = this.context.company()
        const company = world.company(companyId)
        if (!company) return { ...preview, blocked: [...preview.tiles], error: RtCommandError.noCompany }
        let spent = 0
        let did = false
        for (let k = 0; k < steps.length; k++) {
            const result = applyCommand(world, companyId, steps[k]!.command, false)
            if (!result.ok && result.error === RtCommandError.alreadyBuilt) continue
            const refused = !result.ok ? result.error : company.money - spent < result.cost ? RtCommandError.money : null
            if (refused !== null) {
                if (!did) preview.error = refused
                preview.blocked = preview.tiles.slice(k)
                break
            }
            if (result.ok) spent += result.cost
            did = true
        }
        preview.cost = spent
        preview.ok = did
        return preview
    }

    /** Previews one command as a whole. */
    private previewSingle(world: RtWorld, command: RtCommand, ...tiles: number[]): RtToolPreview {
        const preview = emptyPreview(tiles)
        const result = applyCommand(world, this.context.company(), command, false)
        if (result.ok) {
            preview.ok = true
            preview.cost = result.cost
        } else {
            preview.error = result.error
            preview.blocked = [...tiles]
            if (command.kind === RtCommandKind.buildSiding && result.error !== RtCommandError.money) preview.hint = 'A parking spot needs a dead end'
        }
        if (command.kind === RtCommandKind.buildRailStation || command.kind === RtCommandKind.buildRoadStop) {
            const radius = command.kind === RtCommandKind.buildRailStation ? RT_CATALOG.catchment.rail : RT_CATALOG.catchment.roadStop
            preview.catchment = rtCatchmentOf(world.map, tiles, () => radius)
        }
        return preview
    }

    /* --------------------------------------------------------------------------------------
     * Clicks
     * ------------------------------------------------------------------------------------ */

    /** The single-tile command a click with the current tool sends, or null. */
    private clickCommand(world: RtWorld, tile: number, at: RtSubTile, remove: boolean): RtCommand | null {
        const map = world.map
        const o = this.options
        switch (this.tool) {
            case RtToolKind.railStation:
                return { kind: RtCommandKind.buildRailStation, tile, axis: o.stationAxis, tracks: o.stationTracks, length: o.stationLength }
            case RtToolKind.roadStop:
                return o.stopShape === RtRoadStopShape.auto
                    ? { kind: RtCommandKind.buildRoadStop, tile, stop: o.stopType }
                    : { kind: RtCommandKind.buildRoadStop, tile, stop: o.stopType, shape: o.stopShape }
            case RtToolKind.depot:
                return { kind: RtCommandKind.buildDepot, tile, vehicleKind: o.depotKind, facing: o.depotFacing }
            case RtToolKind.parking:
                return { kind: remove ? RtCommandKind.removeSiding : RtCommandKind.buildSiding, tile }
            case RtToolKind.signal: {
                if (map.kind[tile] !== RtTileKind.rail) return null
                const piece = rtNearestPiece(rtRailTilePieces(map, tile), at)
                if (piece < 0) return null
                // an existing signal cycles with its own type; another type would convert it instead
                const existing = rtSignalTypeAt(map, tile, piece)
                return { kind: RtCommandKind.placeSignal, tile, piece, signalType: existing >= 0 ? existing : o.signalType }
            }
            default:
                return null
        }
    }

    /** The preview while hovering between gestures: the footprint and cost of what a click would place. */
    private hoverPreview(tile: number, at: RtSubTile = CENTRE): RtToolPreview | null {
        const world = this.context.world()
        if (!world || !world.map.validTile(tile)) return null
        if (this.tool === RtToolKind.railStation) {
            const o = this.options
            const footprint = rtStationFootprint(world.map, tile, o.stationAxis, o.stationTracks, o.stationLength)
            return this.previewSingle(world, { kind: RtCommandKind.buildRailStation, tile, axis: o.stationAxis, tracks: o.stationTracks, length: o.stationLength }, ...footprint)
        }
        const command = this.clickCommand(world, tile, at, false)
        return command ? this.previewSingle(world, command, tile) : null
    }

    /** What a pick-mode click on the tile picks, if it is a station or depot the player may pick. */
    private pickAt(world: RtWorld, tile: number): RtPicked | null {
        const map = world.map
        const company = this.context.company()
        const mayUse = world.settings.sharing || map.owner[tile] === company
        if (map.kind[tile] === RtTileKind.station && this.pickKinds.includes('station')) {
            const id = rtStationId(map.payload[tile]!)
            const station = world.station(id)
            if (station && (world.settings.sharing || station.owner === company)) return { kind: 'station', id }
            return null
        }
        if (map.kind[tile] === RtTileKind.depot && this.pickKinds.includes('depot') && mayUse) return { kind: 'depot', id: tile }
        return null
    }
}

function emptyPreview(tiles: number[]): RtToolPreview {
    return { tiles, blocked: [], catchment: [], cost: 0, ok: false, error: null, hint: null }
}
