// Rail Tycoon — sprite atlas.
//
// Loads the committed OpenGFX atlas (public/rail-tycoon/opengfx, cut by
// scripts/rail-tycoon/extract-opengfx.ts) into pixi textures with nearest
// sampling, recolours the company-coloured sprites once per company, and keeps
// the names the renderer asks for in small pure helpers.
//
// Everything above buildSpriteAtlas is pure and runs without a GPU, so it is
// unit tested in test/rail-tycoon/sprites.spec.ts. pixi itself is imported
// lazily inside buildSpriteAtlas, so importing this module never touches it.

import type { Renderer, Texture, TextureSource } from 'pixi.js'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import type { RtVehicleModelId } from '#shared/utils/rail-tycoon/catalog'
import { RT_ROAD_DIR_BIT, RtDir, RtSlope } from '#shared/utils/rail-tycoon/map'

/* ------------------------------------------------------------------------------------------
 * atlas.json
 * ---------------------------------------------------------------------------------------- */

/** One sprite: its rectangle in atlas.png and the offset of its top-left pixel from the anchor. */
export interface RtAtlasEntry {
    x: number
    y: number
    w: number
    h: number
    ox: number
    oy: number
    /** Station, depot and road stop parts: rear is drawn before a vehicle on the tile, front after. */
    layer?: 'rear' | 'front'
}

export interface RtAtlasMeta {
    size: { w: number, h: number }
    tile: { w: number, h: number, heightStep: number }
    waterFrames: number
    directions: string[]
    slopes: Record<string, { corners: string, steep: boolean }>
    industryLayouts: Record<string, [number, number, number][]>
    [key: string]: unknown
}

export interface RtAtlasJson {
    meta: RtAtlasMeta
    sprites: Record<string, RtAtlasEntry>
}

/** Where the committed atlas is served from. */
export const RT_ATLAS_BASE_URL = '/rail-tycoon/opengfx/'

/* ------------------------------------------------------------------------------------------
 * Company colours
 * ---------------------------------------------------------------------------------------- */

/** Shades in a company colour ramp, 0 darkest to 7 lightest, as mask.png stores them. */
export const RT_COMPANY_SHADES = 8
/** The ramp shade that equals the catalog colour itself. */
export const RT_COMPANY_BASE_SHADE = 4

/**
 * The 8-shade ramp of one company colour (0xRRGGBB) as 24 bytes, r g b per shade.
 * Shades below the base darken toward 40% of the colour; shades above blend up to 60% toward white.
 */
export function rtCompanyRamp(rgb: number): Uint8Array {
    const ramp = new Uint8Array(RT_COMPANY_SHADES * 3)
    const base = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255]
    for (let s = 0; s < RT_COMPANY_SHADES; s++) {
        for (let c = 0; c < 3; c++) {
            const v = base[c]!
            let out = v
            if (s < RT_COMPANY_BASE_SHADE) out = v * (0.4 + 0.15 * s)
            else if (s > RT_COMPANY_BASE_SHADE) out = v + (255 - v) * 0.2 * (s - RT_COMPANY_BASE_SHADE)
            ramp[s * 3 + c] = Math.round(out)
        }
    }
    return ramp
}

/** The catalog colour (0xRRGGBB) of a company colour index (RtCompany.colour). */
export function rtCompanyColour(colourIndex: number): number {
    const colours = RT_CATALOG.companies.colours
    const colour = colours[colourIndex]
    if (colour === undefined) throw new RangeError(`no company colour ${colourIndex}`)
    return colour
}

/** Shade 0 to 7 stored in a mask.png value ((s + 1) * 32 - 1), or -1 where the pixel is not company coloured. */
export function rtMaskShade(value: number): number {
    if (value === 0) return -1
    return Math.min(RT_COMPANY_SHADES - 1, Math.max(0, Math.round((value + 1) / 32) - 1))
}

/** One byte per pixel: the first channel of a decoded RGBA mask image. */
export function rtMaskChannel(rgba: ArrayLike<number>): Uint8Array {
    const out = new Uint8Array(rgba.length >> 2)
    for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4]!
    return out
}

/**
 * Zeroes the colour of fully transparent pixels in place. The atlas only has alpha 0 and 255, so
 * this makes the buffer premultiplied, which is how pixi blends a raw buffer upload.
 */
export function rtClearTransparent(rgba: Uint8Array | Uint8ClampedArray): void {
    for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] === 0) {
            rgba[i] = 0
            rgba[i + 1] = 0
            rgba[i + 2] = 0
        }
    }
}

export interface RtRect {
    x: number
    y: number
    w: number
    h: number
}

/** Whether any pixel of rect is company coloured in a one-channel mask of the given width. */
export function rtRectHasMask(mask: Uint8Array, width: number, rect: RtRect): boolean {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
        const row = y * width
        for (let x = rect.x; x < rect.x + rect.w; x++) {
            if (mask[row + x]) return true
        }
    }
    return false
}

/**
 * Copies rect of an RGBA atlas into dst at (dx, dy), replacing each company-coloured pixel's colour
 * with its shade from ramp. Transparent pixels are written as 0 0 0 0.
 */
export function rtRecolourInto(
    src: ArrayLike<number>, mask: Uint8Array, srcWidth: number, rect: RtRect, ramp: Uint8Array,
    dst: Uint8Array, dstWidth: number, dx: number, dy: number
): void {
    for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
            const p = (rect.y + y) * srcWidth + rect.x + x
            const s = p * 4
            const d = ((dy + y) * dstWidth + dx + x) * 4
            const alpha = src[s + 3]!
            if (alpha === 0) {
                dst[d] = 0
                dst[d + 1] = 0
                dst[d + 2] = 0
                dst[d + 3] = 0
                continue
            }
            const shade = rtMaskShade(mask[p]!)
            if (shade < 0) {
                dst[d] = src[s]!
                dst[d + 1] = src[s + 1]!
                dst[d + 2] = src[s + 2]!
            } else {
                dst[d] = ramp[shade * 3]!
                dst[d + 1] = ramp[shade * 3 + 1]!
                dst[d + 2] = ramp[shade * 3 + 2]!
            }
            dst[d + 3] = alpha
        }
    }
}

/** Sprite families that carry a company's colour; other sprites keep the atlas colours. */
export const RT_RECOLOURED_PREFIXES: readonly string[] = ['vehicle.', 'station.', 'depot.', 'roadstop.']

export function rtIsRecolouredName(name: string): boolean {
    return RT_RECOLOURED_PREFIXES.some(prefix => name.startsWith(prefix))
}

export interface RtPacking {
    width: number
    height: number
    /** Top-left of each input rectangle, in input order. */
    slots: { x: number, y: number }[]
}

/**
 * Shelf-packs rectangles (tallest first) into a sheet of the given width with padding pixels
 * between them, for the per-company sheets. Deterministic for the same input.
 */
export function rtPackRects(sizes: readonly { w: number, h: number }[], width: number, padding = 1): RtPacking {
    const order = sizes.map((_, k) => k).sort((a, b) => sizes[b]!.h - sizes[a]!.h || sizes[b]!.w - sizes[a]!.w || a - b)
    const slots: { x: number, y: number }[] = new Array(sizes.length)
    let x = padding
    let y = padding
    let shelf = 0
    for (const k of order) {
        const { w, h } = sizes[k]!
        if (w + 2 * padding > width) throw new RangeError(`sprite ${w} wide does not fit a ${width} sheet`)
        if (x + w + padding > width) {
            x = padding
            y += shelf + padding
            shelf = 0
        }
        slots[k] = { x, y }
        x += w + padding
        shelf = Math.max(shelf, h)
    }
    return { width, height: sizes.length ? y + shelf + padding : 0, slots }
}

/** RGBA pixels of a flat-coloured tile diamond, w by h, for a sprite missing from the atlas. */
export function rtPlaceholderPixels(w: number, h: number, rgb: number): Uint8Array {
    const out = new Uint8Array(w * h * 4)
    const cx = (w - 1) / 2
    const cy = (h - 1) / 2
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (Math.abs(x - cx) / (w / 2) + Math.abs(y - cy) / (h / 2) > 1) continue
            const d = (y * w + x) * 4
            out[d] = (rgb >> 16) & 255
            out[d + 1] = (rgb >> 8) & 255
            out[d + 2] = rgb & 255
            out[d + 3] = 255
        }
    }
    return out
}

/* ------------------------------------------------------------------------------------------
 * Water animation
 * ---------------------------------------------------------------------------------------- */

/** Water (and coast) frames in the atlas: one full turn of the water colours. */
export const RT_WATER_FRAMES = 8

/**
 * Wall-clock length of one water colour cycle. The original rotates its dark-water colours one
 * full turn every 65536 / (8 * 320) = 25.6 palette steps, one step per game tick.
 */
export const RT_WATER_CYCLE_MS = (65536 / (8 * 320)) * RT_CATALOG.time.tickMs

/** The water frame to show at a wall-clock time in ms (cosmetic, so it keeps running while paused). */
export function rtWaterFrameAt(ms: number, frames = RT_WATER_FRAMES): number {
    const frame = Math.floor(ms / (RT_WATER_CYCLE_MS / frames)) % frames
    return frame < 0 ? frame + frames : frame
}

/* ------------------------------------------------------------------------------------------
 * Sprite names (atlas.json meta documents each family)
 * ---------------------------------------------------------------------------------------- */

/** The 19 slope names of the atlas and their raised corners (meta.slopes). */
export const RT_SLOPE_CORNERS = {
    'flat': '',
    'w': 'w',
    's': 's',
    'sw': 'sw',
    'e': 'e',
    'ew': 'ew',
    'se': 'se',
    'wse': 'wse',
    'n': 'n',
    'nw': 'nw',
    'ns': 'ns',
    'nws': 'nws',
    'ne': 'ne',
    'enw': 'enw',
    'sen': 'sen',
    'steep-n': 'enw',
    'steep-s': 'wse',
    'steep-w': 'nws',
    'steep-e': 'sen'
} as const
export type RtSlopeName = keyof typeof RT_SLOPE_CORNERS

/** Tile sides, the names the atlas uses for road halves, ramps and building facings. */
export type RtSideName = 'ne' | 'se' | 'sw' | 'nw'
export const RT_SIDE_NAMES: readonly RtSideName[] = ['ne', 'se', 'sw', 'nw']

/** The 8 directions of vehicle and signal sprites, in atlas order (meta.directions). */
export type RtSpriteDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export const RT_SPRITE_DIRECTIONS: readonly RtSpriteDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']

/** Rail track pieces (meta.railPieces): x NE-SW, y NW-SE, and the four corner pieces. */
export type RtRailPiece = 'x' | 'y' | 'n' | 's' | 'e' | 'w'
export const RT_RAIL_PIECES: readonly RtRailPiece[] = ['x', 'y', 'n', 's', 'e', 'w']

/** Tile sides each rail piece touches. */
const RAIL_PIECE_SIDES: Record<RtRailPiece, readonly RtSideName[]> = {
    x: ['ne', 'sw'],
    y: ['nw', 'se'],
    n: ['ne', 'nw'],
    s: ['se', 'sw'],
    e: ['ne', 'se'],
    w: ['nw', 'sw']
}

/** Piece sets with a sprite of their own; any other set is a junction ground plus one overlay per piece. */
const RAIL_FLAT_SETS: Record<string, string> = {
    'x': 'rail.flat.x',
    'y': 'rail.flat.y',
    'n': 'rail.flat.n',
    's': 'rail.flat.s',
    'e': 'rail.flat.e',
    'w': 'rail.flat.w',
    'x-y': 'rail.flat.x-y',
    'n-s': 'rail.flat.n-s',
    'e-w': 'rail.flat.e-w'
}

/** The slope name for a set of raised corners (any order) and the steep flag. */
export function rtSlopeNameFromCorners(corners: string, steep: boolean): RtSlopeName {
    const key = [...corners].sort().join('')
    for (const [name, raised] of Object.entries(RT_SLOPE_CORNERS) as [RtSlopeName, string][]) {
        if (name.startsWith('steep-') !== steep) continue
        if ([...raised].sort().join('') === key) return name
    }
    throw new RangeError(`no slope with corners '${corners}'${steep ? ' (steep)' : ''}`)
}

/** Bare terrain: ground grass or rough; rough flat land has variants 0 to 4. */
export function rtTerrainSpriteName(ground: 'grass' | 'rough', slope: RtSlopeName, variant = 0): string {
    if (ground === 'rough' && slope === 'flat' && variant > 0) return `terrain.rough.flat-${((variant - 1) % 4) + 1}`
    return `terrain.${ground}.${slope}`
}

export function rtFoundationSpriteName(slope: RtSlopeName): string | null {
    if (slope === 'flat' || slope.startsWith('steep-')) return null
    return `foundation.${slope}`
}

export function rtWaterSpriteName(frame: number): string {
    return `water.${frame}`
}

export function rtCoastSpriteName(slope: RtSlopeName, frame: number): string {
    return `coast.${slope}.${frame}`
}

export function rtTreeSpriteName(type: number, stage: number): string {
    return `tree.${type}.${stage}`
}

/** The incline a single straight piece climbs: the slopes with two adjacent corners raised. */
const RAIL_INCLINES: Partial<Record<RtSlopeName, RtRailPiece>> = { ne: 'x', sw: 'x', se: 'y', nw: 'y' }

/**
 * The sprites of a rail tile, drawn in order: one piece set sprite, or a junction ground (named
 * for the tile side no piece touches) followed by one overlay per piece. A single straight piece
 * on its incline uses the sloped sprite; on any other slope the renderer draws the foundation and
 * then these flat sprites on top.
 */
export function rtRailSpriteNames(pieces: Iterable<RtRailPiece>, slope: RtSlopeName = 'flat'): string[] {
    const set = RT_RAIL_PIECES.filter(p => [...pieces].includes(p))
    if (!set.length) return []
    if (set.length === 1 && RAIL_INCLINES[slope] === set[0]) return [`rail.slope.${slope}`]
    const own = RAIL_FLAT_SETS[set.join('-')]
    if (own) return [own]
    const touched = new Set(set.flatMap(p => RAIL_PIECE_SIDES[p]))
    const open = (['ne', 'sw', 'nw', 'se'] as const).find(side => !touched.has(side))
    return [open ? `rail.junction.no-${open}` : 'rail.junction.all', ...set.map(p => `rail.overlay.${p}`)]
}

/** A road tile: the half-tile pieces present, or the ramp when the road climbs a slope. */
export function rtRoadSpriteName(surface: 'grass' | 'town', sides: Iterable<RtSideName>, slope: RtSlopeName = 'flat'): string | null {
    const present = RT_SIDE_NAMES.filter(s => [...sides].includes(s))
    if (!present.length) return null
    if (RAIL_INCLINES[slope]) return `road.${surface}.slope-${slope}`
    return `road.${surface}.${present.join('-')}`
}

/** A level crossing; railAxis is the rail's axis piece (x or y). */
export function rtCrossingSpriteName(surface: 'grass' | 'town', railAxis: 'x' | 'y', closed: boolean): string {
    return `crossing.${surface}.${railAxis}${closed ? '-closed' : ''}`
}

/** A signal; facing is the direction a train passing it travels (meta signal names `to-<dir>`). */
export function rtSignalSpriteName(kind: 'block' | 'path' | 'path-oneway', facing: RtSpriteDirection, green: boolean): string {
    return `signal.${kind}.to-${facing}.${green ? 'green' : 'red'}`
}

/** A rail station tile's rear and front parts. */
export function rtStationSpriteNames(axis: 'x' | 'y', building: boolean): { rear: string, front: string } {
    const prefix = `station.rail.${axis}.${building ? 'building' : 'plain'}`
    return { rear: `${prefix}.rear`, front: `${prefix}.front` }
}

/** A depot's parts in draw order: ground, building (rear) and, for the se and sw facings, a front part. */
export function rtDepotSpriteNames(kind: 'rail' | 'road', facing: RtSideName): string[] {
    const parts = facing === 'se' || facing === 'sw' ? ['ground', 'building', 'front'] : ['ground', 'building']
    return parts.map(part => `depot.${kind}.${facing}.${part}`)
}

/** A road stop's ground and its parts a (rear), b and c (front). */
export function rtRoadStopSpriteNames(kind: 'bus' | 'truck', facing: RtSideName): string[] {
    return ['ground', 'a', 'b', 'c'].map(part => `roadstop.${kind}.${facing}.${part}`)
}

/** House size classes of RT_CATALOG.houses.classes, in order. */
export const RT_HOUSE_SIZES = ['small', 'medium', 'large'] as const

/** A house of a size class; variant wraps over the count of that class in the atlas. */
export function rtHouseSpriteName(sizeClass: number, variant: number, count: number): string {
    const size = RT_HOUSE_SIZES[sizeClass]
    if (!size) throw new RangeError(`no house size class ${sizeClass}`)
    return `house.${size}.${((variant % count) + count) % count}`
}

/** An industry tile by industry type id and its tile index (meta.industryLayouts). */
export function rtIndustrySpriteName(type: string, tile: number): string {
    return `industry.${type}.${tile}`
}

/** Atlas vehicle kind of each catalog model, and the loaded look where the atlas has one. */
export const RT_VEHICLE_SPRITES: Record<RtVehicleModelId, { empty: string, loaded: string }> = {
    tankEngine: { empty: 'vehicle.train.steam', loaded: 'vehicle.train.steam' },
    expressEngine: { empty: 'vehicle.train.diesel', loaded: 'vehicle.train.diesel' },
    passengerCoach: { empty: 'vehicle.wagon.passengers', loaded: 'vehicle.wagon.passengers' },
    mailCar: { empty: 'vehicle.wagon.mail', loaded: 'vehicle.wagon.mail' },
    coalHopper: { empty: 'vehicle.wagon.coal', loaded: 'vehicle.wagon.coal-full' },
    timberFlat: { empty: 'vehicle.wagon.wood', loaded: 'vehicle.wagon.wood-full' },
    goodsBoxcar: { empty: 'vehicle.wagon.goods', loaded: 'vehicle.wagon.goods' },
    townBus: { empty: 'vehicle.road.bus', loaded: 'vehicle.road.bus' },
    mailVan: { empty: 'vehicle.road.mail', loaded: 'vehicle.road.mail' },
    coalLorry: { empty: 'vehicle.road.coal', loaded: 'vehicle.road.coal-full' },
    timberLorry: { empty: 'vehicle.road.wood', loaded: 'vehicle.road.wood-full' },
    goodsLorry: { empty: 'vehicle.road.goods', loaded: 'vehicle.road.goods' }
}

export function rtVehicleSpriteName(model: RtVehicleModelId, direction: RtSpriteDirection, loaded: boolean): string {
    const kind = RT_VEHICLE_SPRITES[model]
    return `${loaded ? kind.loaded : kind.empty}.${direction}`
}

/* ------------------------------------------------------------------------------------------
 * Map encoding bridge: the only place map bits become sprite names.
 * Slope and road bits come from shared/utils/rail-tycoon/map.ts. Track bits are defined in
 * track.ts, so the renderer passes that table to rtRailPiecesFromBits.
 * ---------------------------------------------------------------------------------------- */

/** The slope name of an RtMap.tileSlope value (RtSlope corner bits plus RtSlope.steep). */
export function rtSlopeNameFromBits(bits: number): RtSlopeName {
    let corners = ''
    if (bits & RtSlope.n) corners += 'n'
    if (bits & RtSlope.e) corners += 'e'
    if (bits & RtSlope.s) corners += 's'
    if (bits & RtSlope.w) corners += 'w'
    return rtSlopeNameFromCorners(corners, (bits & RtSlope.steep) !== 0)
}

/** The road sides present in a road-bit mask (RT_ROAD_DIR_BIT per RtDir). */
export function rtRoadSidesFromBits(bits: number): RtSideName[] {
    return RT_SIDE_NAMES.filter(side => bits & RT_ROAD_DIR_BIT[RtDir[side]]!)
}

/** The bit of each rail piece in a track-bit mask; the renderer supplies track.ts's encoding. */
export type RtTrackBitTable = Readonly<Record<RtRailPiece, number>>

export function rtRailPiecesFromBits(bits: number, table: RtTrackBitTable): RtRailPiece[] {
    return RT_RAIL_PIECES.filter(piece => bits & table[piece])
}

/* ------------------------------------------------------------------------------------------
 * pixi textures
 * ---------------------------------------------------------------------------------------- */

/** A drawable sprite: put its top-left at (anchor.x + ox, anchor.y + oy). */
export interface RtSpriteFrame {
    readonly name: string
    readonly texture: Texture
    readonly ox: number
    readonly oy: number
    readonly layer: 'rear' | 'front' | null
    /** True when the name is missing from atlas.json and a flat diamond stands in. */
    readonly placeholder: boolean
}

/** One company's sprites: its recoloured vehicles and buildings, the shared atlas for the rest. */
export interface RtCompanySprites {
    readonly colourIndex: number
    readonly ramp: Uint8Array
    get(name: string): RtSpriteFrame
}

export interface RtSpriteAtlas {
    readonly meta: RtAtlasMeta
    has(name: string): boolean
    /** The sprite by atlas name; a missing name gets the placeholder, logged once in development. */
    get(name: string): RtSpriteFrame
    /** Sprites of the company with this colour index (RtCompany.colour), built on first use and cached. */
    company(colourIndex: number): RtCompanySprites
    /** Water frame f (0 to RT_WATER_FRAMES - 1); cycle with rtWaterFrameAt. */
    water(frame: number): RtSpriteFrame
    coast(slope: RtSlopeName, frame: number): RtSpriteFrame
    /** Sprites of a family in the atlas, e.g. variantCount('house.small') or ('terrain.rough'). */
    variantCount(prefix: string): number
    /** Names that fell back to the placeholder so far. */
    missing(): string[]
    destroy(): void
}

const PLACEHOLDER_RGB = 0xff00ff
const COMPANY_SHEET_WIDTH = 512

/** Decodes a PNG into straight RGBA, without colour management. */
async function loadRgba(url: string): Promise<{ width: number, height: number, data: Uint8ClampedArray }> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`could not load ${url}: ${response.status}`)
    const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    const { width, height } = bitmap
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (typeof OffscreenCanvas !== 'undefined') {
        ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
    } else {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        ctx = canvas.getContext('2d', { willReadFrequently: true })
    }
    if (!ctx) throw new Error('no 2d canvas context to decode the sprite atlas')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    return { width, height, data: ctx.getImageData(0, 0, width, height).data }
}

/**
 * Loads atlas.json, atlas.png and mask.png and builds every texture the renderer draws, with
 * nearest sampling. Company sheets are built lazily by company() and cached until destroy().
 */
export async function buildSpriteAtlas(renderer: Renderer, baseUrl = RT_ATLAS_BASE_URL): Promise<RtSpriteAtlas> {
    const pixi = await import('pixi.js')
    const [json, image, maskImage] = await Promise.all([
        fetch(`${baseUrl}atlas.json`).then((response) => {
            if (!response.ok) throw new Error(`could not load atlas.json: ${response.status}`)
            return response.json() as Promise<RtAtlasJson>
        }),
        loadRgba(`${baseUrl}atlas.png`),
        loadRgba(`${baseUrl}mask.png`)
    ])
    const { width, height } = image
    const pixels = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)
    rtClearTransparent(pixels)
    const mask = rtMaskChannel(maskImage.data)

    const sources: TextureSource[] = []
    const textures: Texture[] = []
    const makeSource = (resource: Uint8Array, w: number, h: number, label: string) => {
        const source = new pixi.BufferImageSource({
            resource, width: w, height: h, format: 'rgba8unorm', alphaMode: 'premultiplied-alpha',
            scaleMode: 'nearest', autoGenerateMipmaps: false, label
        })
        renderer.texture.initSource(source)
        sources.push(source)
        return source
    }
    const makeFrame = (name: string, source: TextureSource, rect: RtRect, entry: RtAtlasEntry, placeholder = false): RtSpriteFrame => {
        const texture = new pixi.Texture({ source, frame: new pixi.Rectangle(rect.x, rect.y, rect.w, rect.h), label: name })
        textures.push(texture)
        return { name, texture, ox: entry.ox, oy: entry.oy, layer: entry.layer ?? null, placeholder }
    }

    const atlasSource = makeSource(pixels, width, height, 'rail-tycoon atlas')
    const frames = new Map<string, RtSpriteFrame>()
    for (const [name, entry] of Object.entries(json.sprites)) frames.set(name, makeFrame(name, atlasSource, entry, entry))

    const tile = json.meta.tile
    const placeholderSource = makeSource(rtPlaceholderPixels(tile.w, tile.h - 1, PLACEHOLDER_RGB), tile.w, tile.h - 1, 'rail-tycoon placeholder')
    const placeholderEntry: RtAtlasEntry = { x: 0, y: 0, w: tile.w, h: tile.h - 1, ox: -(tile.w / 2 - 1), oy: 0 }
    const placeholders = new Map<string, RtSpriteFrame>()
    const get = (name: string): RtSpriteFrame => {
        const frame = frames.get(name)
        if (frame) return frame
        let stand = placeholders.get(name)
        if (!stand) {
            if (import.meta.dev) console.warn(`[rail-tycoon] sprite missing from atlas.json, drawn as a placeholder: ${name}`)
            stand = makeFrame(name, placeholderSource, placeholderEntry, placeholderEntry, true)
            placeholders.set(name, stand)
        }
        return stand
    }

    const frameCount = json.meta.waterFrames || RT_WATER_FRAMES
    const waterFrames = Array.from({ length: frameCount }, (_, f) => get(rtWaterSpriteName(f)))

    // One packing shared by every company: the company-coloured sprites, identical rectangles once.
    let packing: { names: Map<string, number>, rects: RtAtlasEntry[], layout: RtPacking } | null = null
    const companyPacking = () => {
        if (packing) return packing
        const names = new Map<string, number>()
        const rects: RtAtlasEntry[] = []
        const byRect = new Map<string, number>()
        for (const [name, entry] of Object.entries(json.sprites).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
            if (!rtIsRecolouredName(name) || !rtRectHasMask(mask, width, entry)) continue
            const key = `${entry.x},${entry.y},${entry.w},${entry.h}`
            let k = byRect.get(key)
            if (k === undefined) {
                k = rects.length
                rects.push(entry)
                byRect.set(key, k)
            }
            names.set(name, k)
        }
        packing = { names, rects, layout: rtPackRects(rects, COMPANY_SHEET_WIDTH) }
        return packing
    }

    const companies = new Map<number, RtCompanySprites>()
    const company = (colourIndex: number): RtCompanySprites => {
        const cached = companies.get(colourIndex)
        if (cached) return cached
        const ramp = rtCompanyRamp(rtCompanyColour(colourIndex))
        const { names, rects, layout } = companyPacking()
        const sheet = new Uint8Array(layout.width * Math.max(1, layout.height) * 4)
        rects.forEach((rect, k) => {
            const slot = layout.slots[k]!
            rtRecolourInto(pixels, mask, width, rect, ramp, sheet, layout.width, slot.x, slot.y)
        })
        const source = makeSource(sheet, layout.width, Math.max(1, layout.height), `rail-tycoon company ${colourIndex}`)
        const own = new Map<string, RtSpriteFrame>()
        for (const [name, k] of names) {
            const slot = layout.slots[k]!
            const entry = json.sprites[name]!
            own.set(name, makeFrame(name, source, { x: slot.x, y: slot.y, w: entry.w, h: entry.h }, entry))
        }
        const sprites: RtCompanySprites = { colourIndex, ramp, get: name => own.get(name) ?? get(name) }
        companies.set(colourIndex, sprites)
        return sprites
    }

    const variants = new Map<string, number>()

    return {
        meta: json.meta,
        has: name => frames.has(name),
        get,
        company,
        water: frame => waterFrames[((frame % frameCount) + frameCount) % frameCount]!,
        coast: (slope, frame) => get(rtCoastSpriteName(slope, ((frame % frameCount) + frameCount) % frameCount)),
        variantCount(prefix) {
            let count = variants.get(prefix)
            if (count === undefined) {
                count = 0
                for (const name of frames.keys()) {
                    if (name.startsWith(`${prefix}.`) && !name.slice(prefix.length + 1).includes('.')) count++
                }
                variants.set(prefix, count)
            }
            return count
        },
        missing: () => [...placeholders.keys()],
        destroy() {
            for (const texture of textures) texture.destroy(false)
            for (const source of sources) source.destroy()
            textures.length = 0
            sources.length = 0
            frames.clear()
            placeholders.clear()
            companies.clear()
        }
    }
}
