// Rail Tycoon — renderer.
//
// Draws the client's world with pixi.js v8 from the OpenGFX sprite atlas the way the original's
// viewport does: every ground sprite first (terrain, water, track, road, platform and depot floors),
// then everything that stands up (trees, houses, industries, station buildings, depots, signals and
// vehicles) sorted back to front, so a train passes behind a house in front of it and in front of a
// house behind it. Only tiles RtCamera can show are drawn, from pooled sprites, over a range grown by
// a margin so a pan rebuilds only when it leaves that margin; dirty tiles from RtLockstep are redrawn
// one by one.
//
// Over that, in screen pixels: station name signs in the owner's colour, parking spot markers
// and the income that rises and fades for 2 s where a vehicle is paid. The canvas renders at the
// device pixel ratio with a floor of 1 (never below native resolution on a standard screen), nearest
// sampling, no antialias, every position on a whole pixel.
//
// What each tile and vehicle draws is pure and lives in tile-draw.ts, vehicle-draw.ts and
// render-space.ts. pixi is imported lazily in RtRenderer.create, so importing this module never
// touches it.

import type { Application, Container, Graphics, GraphicsContext, Sprite, Text } from 'pixi.js'
import { RT_VEHICLE_MODEL_IDS } from '#shared/utils/rail-tycoon/catalog'
import type { RtMap } from '#shared/utils/rail-tycoon/map'
import { RtVehicleState } from '#shared/utils/rail-tycoon/types'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'
import { rtForEachTileInRange, rtCornerHeightsAt, rtTileToWorld, type RtCamera, type RtTileRange } from './camera'
import type { RtLockstep } from './lockstep'
import {
    RT_RENDER_MARGIN,
    RT_RENDER_SHRINK,
    rtGrowRange,
    rtObjectDepth,
    rtRangeArea,
    rtRangeContains,
    rtRenderResolution,
    rtTileInRange
} from './render-space'
import { RT_SPRITE_DIRECTIONS, rtVehicleSpriteName, rtWaterFrameAt, type RtSlopeName } from './sprite-names'
import { buildSpriteAtlas, rtCompanyColour, rtCompanyRamp, type RtSpriteAtlas, type RtSpriteFrame } from './sprites'
import { rtIsParkingSpot, rtTileDrawList } from './tile-draw'
import type { RtToolPreview } from './tools'
import { RtFloatTexts, rtFloatLook, rtFormatIncome, rtVehicleParts, type RtFloat } from './vehicle-draw'

/* ------------------------------------------------------------------------------------------
 * RtRenderer
 * ---------------------------------------------------------------------------------------- */

type Pixi = typeof import('pixi.js')

export const RT_RENDERER_BACKGROUND = 0x000000
/** Sign and float text, in CSS pixels. */
const SIGN_FONT = { fontFamily: 'Verdana, Tahoma, sans-serif', fontSize: 10, fontWeight: 'bold' as const, fill: 0xffffff }
const FLOAT_FONT = { ...SIGN_FONT, fontSize: 11, fill: 0xffd84a, stroke: { color: 0x1a1200, width: 3, join: 'round' as const } }
/** World pixels a station sign floats above its tile's centre. */
const SIGN_LIFT = 26
/** World pixels a float starts above its tile's centre. */
const FLOAT_LIFT = 14
/** Parking marker: a 9 by 9 sign, drawn at a whole multiple of its pixels. */
const MARKER_SIZE = 9
const MARKER_BLUE = 0x1f4fbf
const PREVIEW = {
    tile: 0xffffff,
    refused: 0xffa531,
    blocked: 0xff3030,
    catchment: 0x3aa0ff
}
/** Thin preview outlines stay at least this wide on screen (CSS pixels), whatever the zoom. */
const PREVIEW_LINE = 1.5

class SpritePool {
    private readonly free: Sprite[] = []

    constructor(private readonly pixi: Pixi, readonly parent: Container) {}

    take(frame: RtSpriteFrame, wx: number, wy: number, z: number): Sprite {
        let sprite = this.free.pop()
        if (sprite) {
            sprite.visible = true
        } else {
            sprite = new this.pixi.Sprite()
            this.parent.addChild(sprite)
        }
        sprite.texture = frame.texture
        sprite.position.set(wx + frame.ox, wy + frame.oy)
        sprite.zIndex = z
        return sprite
    }

    give(sprite: Sprite): void {
        sprite.visible = false
        sprite.tint = 0xffffff
        this.free.push(sprite)
    }
}

interface TileSprites {
    ground: Sprite[]
    objects: Sprite[]
    water: { sprite: Sprite, wx: number, wy: number, coast: RtSlopeName | null }[]
}

interface Sign {
    view: Container
    back: Graphics
    text: Text
    key: string
    tile: number
}

export interface RtRendererOptions {
    /** The camera the tools pick with; the renderer resizes it with the element. */
    camera: RtCamera
    /** Where the OpenGFX atlas is served from (sprites.ts RT_ATLAS_BASE_URL by default). */
    atlasUrl?: string
    background?: number
    /** Aborting while create() loads makes it clean up and resolve null (an unmounted view). */
    signal?: AbortSignal
}

export class RtRenderer {
    readonly camera: RtCamera
    readonly atlas: RtSpriteAtlas
    readonly floats = new RtFloatTexts()

    private readonly pixi: Pixi
    private readonly app: Application
    private readonly element: HTMLElement
    private readonly worldLayer: Container
    private readonly groundLayer: Container
    private readonly objectLayer: Container
    private readonly previewLayer: Graphics
    private readonly markerLayer: Container
    private readonly signLayer: Container
    private readonly floatLayer: Container
    private readonly groundPool: SpritePool
    private readonly objectPool: SpritePool
    private readonly markerContext: GraphicsContext
    private readonly observer: ResizeObserver | null

    private lockstep: RtLockstep | null = null
    private unsubscribe: (() => void)[] = []
    private readonly tiles = new Map<number, TileSprites>()
    private readonly waterTiles = new Set<TileSprites>()
    private readonly dirty = new Set<number>()
    private readonly sidings = new Set<number>()
    private readonly markers: Graphics[] = []
    private readonly signs = new Map<number, Sign>()
    private readonly floatViews = new Map<RtFloat, Text>()
    private readonly freeFloatViews: Text[] = []
    private vehicleSprites: Sprite[] = []
    private preview: RtToolPreview | null = null

    private drawn: RtTileRange | null = null
    private needsFull = true
    private cameraVersion = -1
    private previewZoom = -1
    private drawnTick = -1
    private vehiclesDirty = true
    private overlayDirty = true
    private waterFrame = 0
    private width = 0
    private height = 0
    private resolution = 1
    private raf = 0
    private destroyed = false
    private readonly onWindowResize = () => this.resize()

    private constructor(pixi: Pixi, app: Application, atlas: RtSpriteAtlas, element: HTMLElement, camera: RtCamera) {
        this.pixi = pixi
        this.app = app
        this.atlas = atlas
        this.element = element
        this.camera = camera
        this.resolution = app.renderer.resolution

        const stage = app.stage
        // the tools read pointer events off the element; pixi never hit-tests this many sprites
        stage.eventMode = 'none'
        stage.interactiveChildren = false
        this.worldLayer = new pixi.Container({ isRenderGroup: true })
        this.groundLayer = new pixi.Container({ sortableChildren: true })
        this.previewLayer = new pixi.Graphics()
        this.objectLayer = new pixi.Container({ sortableChildren: true })
        this.worldLayer.addChild(this.groundLayer, this.previewLayer, this.objectLayer)
        this.markerLayer = new pixi.Container()
        this.signLayer = new pixi.Container()
        this.floatLayer = new pixi.Container()
        stage.addChild(this.worldLayer, this.markerLayer, this.signLayer, this.floatLayer)
        this.groundPool = new SpritePool(pixi, this.groundLayer)
        this.objectPool = new SpritePool(pixi, this.objectLayer)
        this.markerContext = buildMarkerContext(pixi)

        const canvas = app.canvas
        canvas.style.display = 'block'
        canvas.style.imageRendering = 'pixelated'
        element.appendChild(canvas)
        this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize())
        this.observer?.observe(element)
        // a window moved to a screen with another pixel ratio fires resize without changing the element's size
        window.addEventListener('resize', this.onWindowResize)
        this.resize()
    }

    /**
     * Creates the pixi Application on `element` (its canvas fills it) and loads the sprite atlas.
     * Resolves null when options.signal aborted meanwhile.
     */
    static async create(element: HTMLElement, options: RtRendererOptions): Promise<RtRenderer | null> {
        const pixi = await import('pixi.js')
        if (options.signal?.aborted) return null
        const app = new pixi.Application()
        await app.init({
            width: Math.max(1, element.clientWidth),
            height: Math.max(1, element.clientHeight),
            resolution: rtRenderResolution(window.devicePixelRatio, options.camera.zoom),
            autoDensity: true,
            antialias: false,
            roundPixels: true,
            background: options.background ?? RT_RENDERER_BACKGROUND,
            preference: 'webgl',
            autoStart: false,
            sharedTicker: false
        })
        if (options.signal?.aborted) {
            app.destroy(true)
            return null
        }
        let atlas: RtSpriteAtlas
        try {
            atlas = await buildSpriteAtlas(app.renderer, options.atlasUrl)
        } catch (error) {
            app.destroy(true)
            throw error
        }
        if (options.signal?.aborted) {
            atlas.destroy()
            app.destroy(true)
            return null
        }
        return new RtRenderer(pixi, app, atlas, element, options.camera)
    }

    /** The canvas the renderer draws into (inside the element). */
    get canvas(): HTMLCanvasElement {
        return this.app.canvas
    }

    /**
     * Draws this lockstep's world from now on (null: nothing). Call it again with the new lockstep
     * after a resync, since that replaces the world.
     */
    setLockstep(lockstep: RtLockstep | null): void {
        for (const off of this.unsubscribe) off()
        this.unsubscribe = []
        this.releaseAllTiles()
        this.releaseVehicles()
        this.floats.clear()
        for (const view of this.floatViews.values()) this.releaseFloatView(view)
        this.floatViews.clear()
        for (const sign of this.signs.values()) sign.view.destroy({ children: true })
        this.signs.clear()
        for (const marker of this.markers) marker.visible = false
        this.previewLayer.clear()
        this.dirty.clear()
        this.lockstep = lockstep
        this.needsFull = true
        this.vehiclesDirty = true
        this.overlayDirty = true
        this.previewZoom = -1
        if (!lockstep) return
        this.camera.setMapSide(lockstep.world.map.side)
        this.unsubscribe.push(
            lockstep.on('dirty', (tiles) => {
                for (const tile of tiles) this.dirty.add(tile)
            }),
            lockstep.on('payment', (payment) => {
                this.floats.add(payment, performance.now())
            }),
            lockstep.on('vehicles', () => {
                this.vehiclesDirty = true
            })
        )
    }

    /**
     * Shows a build tool's preview (RtTools 'preview' event): the covered tiles tinted, blocked ones
     * red, and a station's catchment highlighted. null clears it.
     */
    drawPreview(preview: RtToolPreview | null): void {
        this.preview = preview
        this.previewZoom = -1
    }

    /** Follows the element's size and the window's pixel ratio; called by itself on resize. */
    resize(): void {
        if (this.destroyed) return
        const width = Math.max(1, Math.floor(this.element.clientWidth))
        const height = Math.max(1, Math.floor(this.element.clientHeight))
        const dpr = window.devicePixelRatio || 1
        const resolution = rtRenderResolution(dpr, this.camera.zoom)
        if (width === this.width && height === this.height && resolution === this.resolution && this.camera.width === width) return
        this.width = width
        this.height = height
        this.app.renderer.resize(width, height, resolution)
        this.camera.resize(width, height, dpr)
        if (resolution !== this.resolution) {
            this.resolution = resolution
            for (const sign of this.signs.values()) sign.text.resolution = resolution
            for (const view of this.floatViews.values()) view.resolution = resolution
            for (const view of this.freeFloatViews) view.resolution = resolution
        }
        this.overlayDirty = true
    }

    /**
     * Runs a frame loop: `beforeRender` (the view steps the lockstep and scrolls the camera there),
     * then render. stop() ends it.
     */
    start(beforeRender?: (now: number) => void): void {
        if (this.raf !== 0 || this.destroyed) return
        const loop = (now: number) => {
            this.raf = requestAnimationFrame(loop)
            beforeRender?.(now)
            this.render(now)
        }
        this.raf = requestAnimationFrame(loop)
    }

    stop(): void {
        if (this.raf !== 0) cancelAnimationFrame(this.raf)
        this.raf = 0
    }

    /** One frame: brings the sprites up to the camera and the world, then draws. */
    render(now: number = performance.now()): void {
        if (this.destroyed) return
        const camera = this.camera
        const moved = camera.version !== this.cameraVersion
        if (moved) {
            // a zoom step can need another canvas resolution
            if (rtRenderResolution(window.devicePixelRatio || 1, camera.zoom) !== this.resolution) this.resize()
            this.cameraVersion = camera.version
            this.worldLayer.position.set(camera.originX, camera.originY)
            this.worldLayer.scale.set(camera.zoom)
            this.overlayDirty = true
        }
        const lockstep = this.lockstep
        if (lockstep) {
            const world = lockstep.world
            const rebuilt = (moved || this.needsFull) && this.updateRange(world)
            if (this.dirty.size > 0) this.redrawDirty(world)
            this.animateWater(now)
            if (rebuilt || this.vehiclesDirty || world.tick !== this.drawnTick) {
                this.drawVehicles(world)
                this.overlayDirty = true
            }
            if (this.overlayDirty) {
                this.drawMarkers(world.map)
                this.drawSigns(world)
                this.overlayDirty = false
            }
            this.drawFloats(world.map, now)
            if (this.previewZoom !== camera.zoom) this.drawPreviewNow(world.map)
        }
        this.app.render()
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.stop()
        for (const off of this.unsubscribe) off()
        this.unsubscribe = []
        this.observer?.disconnect()
        window.removeEventListener('resize', this.onWindowResize)
        this.lockstep = null
        this.tiles.clear()
        this.waterTiles.clear()
        this.signs.clear()
        this.floatViews.clear()
        // sprites, texts and graphics first, then the textures the atlas owns while the renderer can
        // still free them on the GPU, then the renderer and its canvas
        this.app.stage.destroy({ children: true })
        this.markerContext.destroy()
        this.atlas.destroy()
        this.app.destroy(true)
    }

    /* ---------------- tiles ---------------- */

    /** Brings the drawn range over the visible one; returns whether it changed. */
    private updateRange(world: RtWorld): boolean {
        const visible = this.camera.visibleTileRange()
        const wanted = rtGrowRange(visible, RT_RENDER_MARGIN)
        const drawn = this.drawn
        if (!this.needsFull && drawn && rtRangeContains(drawn, visible) && rtRangeArea(drawn) <= RT_RENDER_SHRINK * rtRangeArea(wanted)) return false
        const map = world.map
        if (this.needsFull) {
            this.releaseAllTiles()
            this.dirty.clear()
        } else {
            for (const tile of [...this.tiles.keys()]) {
                if (!rtTileInRange(wanted, map.tileX(tile), map.tileY(tile))) this.releaseTile(tile)
            }
        }
        rtForEachTileInRange(wanted, map.side, (x, y) => {
            const tile = map.idx(x, y)
            if (!this.tiles.has(tile)) this.drawTile(world, tile)
        })
        this.drawn = wanted
        this.needsFull = false
        this.overlayDirty = true
        return true
    }

    private redrawDirty(world: RtWorld): void {
        for (const tile of this.dirty) {
            if (!this.tiles.has(tile)) continue
            this.releaseTile(tile)
            this.drawTile(world, tile)
        }
        this.dirty.clear()
        this.overlayDirty = true
    }

    private frameOf(name: string, colour: number): RtSpriteFrame {
        return colour >= 0 ? this.atlas.company(colour).get(name) : this.atlas.get(name)
    }

    private drawTile(world: RtWorld, tile: number): void {
        const entry: TileSprites = { ground: [], objects: [], water: [] }
        for (const item of rtTileDrawList(world, tile, this.atlas, this.waterFrame)) {
            const frame = this.frameOf(item.name, item.colour)
            if (item.ground) {
                const sprite = this.groundPool.take(frame, item.wx, item.wy, item.z)
                entry.ground.push(sprite)
                if (item.water) entry.water.push({ sprite, wx: item.wx, wy: item.wy, coast: item.water.coast })
            } else {
                entry.objects.push(this.objectPool.take(frame, item.wx, item.wy, item.z))
            }
        }
        this.tiles.set(tile, entry)
        if (entry.water.length > 0) this.waterTiles.add(entry)
        if (rtIsParkingSpot(world.map, tile)) this.sidings.add(tile)
    }

    private releaseTile(tile: number): void {
        const entry = this.tiles.get(tile)
        if (!entry) return
        for (const sprite of entry.ground) this.groundPool.give(sprite)
        for (const sprite of entry.objects) this.objectPool.give(sprite)
        this.waterTiles.delete(entry)
        this.tiles.delete(tile)
        this.sidings.delete(tile)
    }

    private releaseAllTiles(): void {
        for (const tile of [...this.tiles.keys()]) this.releaseTile(tile)
        this.drawn = null
    }

    private animateWater(now: number): void {
        const frame = rtWaterFrameAt(now)
        if (frame === this.waterFrame) return
        this.waterFrame = frame
        for (const entry of this.waterTiles) {
            for (const water of entry.water) {
                const next = water.coast ? this.atlas.coast(water.coast, frame) : this.atlas.water(frame)
                water.sprite.texture = next.texture
                water.sprite.position.set(water.wx + next.ox, water.wy + next.oy)
            }
        }
    }

    /* ---------------- vehicles ---------------- */

    private releaseVehicles(): void {
        for (const sprite of this.vehicleSprites) this.objectPool.give(sprite)
        this.vehicleSprites = []
    }

    private drawVehicles(world: RtWorld): void {
        this.releaseVehicles()
        this.drawnTick = world.tick
        this.vehiclesDirty = false
        const drawn = this.drawn
        if (!drawn) return
        const map = world.map
        for (const vehicle of world.vehicleList()) {
            if (vehicle.state === RtVehicleState.inDepot) continue
            const colour = world.company(vehicle.owner)?.colour ?? -1
            const loaded = vehicle.cargo.length > 0
            for (const part of rtVehicleParts(map, vehicle)) {
                const x = map.tileX(part.tile)
                const y = map.tileY(part.tile)
                if (!rtTileInRange(drawn, x, y)) continue
                const model = RT_VEHICLE_MODEL_IDS[part.model]
                const facing = RT_SPRITE_DIRECTIONS[part.direction]
                if (!model || !facing) continue
                const at = rtTileToWorld(x + part.lx, y + part.ly, part.height)
                const frame = this.frameOf(rtVehicleSpriteName(model, facing, loaded), colour)
                const sprite = this.objectPool.take(frame, Math.round(at.x), Math.round(at.y), rtObjectDepth(x, y, part.lx, part.ly))
                if (vehicle.state === RtVehicleState.crashed) sprite.tint = 0x6a6a6a
                this.vehicleSprites.push(sprite)
            }
        }
    }

    /* ---------------- overlay (screen pixels) ---------------- */

    /** Screen position of a tile's centre at its highest corner. */
    private tileCentre(map: RtMap, tile: number): { x: number, y: number } {
        const w = rtTileToWorld(map.tileX(tile) + 0.5, map.tileY(tile) + 0.5, map.tileMaxHeight(tile))
        return this.camera.worldToScreen(w.x, w.y)
    }

    private drawMarkers(map: RtMap): void {
        const camera = this.camera
        // whole multiples of the marker's own pixels, so it stays crisp; larger when zoomed in
        const scale = camera.zoom >= 2 ? 2 : 1
        let used = 0
        for (const tile of this.sidings) {
            let marker = this.markers[used]
            if (!marker) {
                marker = new this.pixi.Graphics(this.markerContext)
                this.markers.push(marker)
                this.markerLayer.addChild(marker)
            }
            used++
            const at = this.tileCentre(map, tile)
            marker.visible = true
            marker.scale.set(scale)
            marker.position.set(camera.snap(at.x - (MARKER_SIZE * scale) / 2), camera.snap(at.y - MARKER_SIZE * scale - 4 * camera.zoom))
        }
        for (let k = used; k < this.markers.length; k++) this.markers[k]!.visible = false
    }

    private drawSigns(world: RtWorld): void {
        const map = world.map
        const camera = this.camera
        const drawn = this.drawn
        const seen = new Set<number>()
        for (const station of world.stationList()) {
            if (!drawn || !map.validTile(station.sign) || !rtTileInRange(drawn, map.tileX(station.sign), map.tileY(station.sign))) continue
            seen.add(station.id)
            const colourIndex = world.company(station.owner)?.colour ?? -1
            const key = `${station.name}\u0000${colourIndex}`
            let sign = this.signs.get(station.id)
            if (!sign) {
                const view = new this.pixi.Container()
                const back = new this.pixi.Graphics()
                const text = new this.pixi.Text({ text: '', style: SIGN_FONT, resolution: this.resolution })
                view.addChild(back, text)
                this.signLayer.addChild(view)
                sign = { view, back, text, key: '', tile: -1 }
                this.signs.set(station.id, sign)
            }
            if (sign.key !== key) {
                sign.key = key
                sign.text.text = station.name
                const w = Math.ceil(sign.text.width) + 6
                const h = Math.ceil(sign.text.height) + 2
                const rgb = colourIndex >= 0 ? rtCompanyColour(colourIndex) : 0x6b6b6b
                const ramp = rtCompanyRamp(rgb)
                const dark = (ramp[3]! << 16) | (ramp[4]! << 8) | ramp[5]!
                sign.back.clear().rect(0, 0, w, h).fill(dark).rect(1, 1, w - 2, h - 2).fill(rgb)
                sign.text.position.set(3, 1)
            }
            sign.tile = station.sign
            const at = this.tileCentre(map, station.sign)
            const w = Math.ceil(sign.text.width) + 6
            const h = Math.ceil(sign.text.height) + 2
            sign.view.visible = true
            sign.view.position.set(camera.snap(at.x - w / 2), camera.snap(at.y - h - SIGN_LIFT * camera.zoom))
        }
        for (const [id, sign] of this.signs) {
            if (seen.has(id)) continue
            if (world.station(id)) {
                sign.view.visible = false
            } else {
                sign.view.destroy({ children: true })
                this.signs.delete(id)
            }
        }
    }

    private takeFloatView(): Text {
        const view = this.freeFloatViews.pop()
        if (view) {
            view.visible = true
            return view
        }
        const created = new this.pixi.Text({ text: '', style: FLOAT_FONT, resolution: this.resolution })
        this.floatLayer.addChild(created)
        return created
    }

    private releaseFloatView(view: Text): void {
        view.visible = false
        this.freeFloatViews.push(view)
    }

    private drawFloats(map: RtMap, now: number): void {
        for (const gone of this.floats.prune(now)) {
            const view = this.floatViews.get(gone)
            if (view) this.releaseFloatView(view)
            this.floatViews.delete(gone)
        }
        // floats pushed out by RT_FLOAT_MAX
        if (this.floatViews.size > this.floats.items.length) {
            const alive = new Set(this.floats.items)
            for (const [float, view] of this.floatViews) {
                if (alive.has(float)) continue
                this.releaseFloatView(view)
                this.floatViews.delete(float)
            }
        }
        const camera = this.camera
        // several floats on one tile stack: the newest at the base, each older one a line higher
        const stacked = new Map<number, number>()
        const items = this.floats.items
        for (let k = items.length - 1; k >= 0; k--) {
            const float = items[k]!
            const look = rtFloatLook(now - float.born)
            if (!look || !map.validTile(float.tile)) continue
            let view = this.floatViews.get(float)
            if (!view) {
                view = this.takeFloatView()
                view.text = rtFormatIncome(float.amount)
                this.floatViews.set(float, view)
            }
            const below = stacked.get(float.tile) ?? 0
            stacked.set(float.tile, below + 1)
            const at = this.tileCentre(map, float.tile)
            view.alpha = look.alpha
            view.position.set(camera.snap(at.x - view.width / 2), camera.snap(at.y - FLOAT_LIFT * camera.zoom - view.height * (1 + below) - look.rise))
        }
    }

    /* ---------------- preview ---------------- */

    private drawPreviewNow(map: RtMap): void {
        const g = this.previewLayer
        const zoom = this.camera.zoom
        this.previewZoom = zoom
        g.clear()
        const preview = this.preview
        if (!preview) return
        const width = PREVIEW_LINE / zoom
        const diamond = (tile: number): boolean => {
            if (!map.validTile(tile)) return false
            const x = map.tileX(tile)
            const y = map.tileY(tile)
            const [hn, hw, he, hs] = rtCornerHeightsAt(map, x, y)
            const n = rtTileToWorld(x, y, hn)
            const e = rtTileToWorld(x, y + 1, he)
            const s = rtTileToWorld(x + 1, y + 1, hs)
            const w = rtTileToWorld(x + 1, y, hw)
            g.poly([n.x, n.y, e.x, e.y, s.x, s.y, w.x, w.y])
            return true
        }
        const group = (tiles: Iterable<number>, color: number, fill: number, line: number) => {
            let any = false
            for (const tile of tiles) any = diamond(tile) || any
            if (!any) return
            g.fill({ color, alpha: fill })
            if (line > 0) g.stroke({ color, alpha: line, width })
        }
        const blocked = new Set(preview.blocked)
        group(preview.catchment, PREVIEW.catchment, 0.2, 0)
        group(preview.tiles.filter(tile => !blocked.has(tile)), preview.ok ? PREVIEW.tile : PREVIEW.refused, 0.25, 0.9)
        group(blocked, PREVIEW.blocked, 0.4, 0.9)
    }
}

/** The parking spot marker: a blue square sign with a white P, unlike any signal. */
function buildMarkerContext(pixi: Pixi): GraphicsContext {
    const s = MARKER_SIZE
    return new pixi.GraphicsContext()
        .rect(0, 0, s, s).fill(0xffffff)
        .rect(1, 1, s - 2, s - 2).fill(MARKER_BLUE)
        // the P, 4 by 5 pixels: stem, top bar, bowl side, middle bar
        .rect(3, 2, 1, 5).fill(0xffffff)
        .rect(3, 2, 3, 1).fill(0xffffff)
        .rect(6, 3, 1, 1).fill(0xffffff)
        .rect(3, 4, 3, 1).fill(0xffffff)
}
