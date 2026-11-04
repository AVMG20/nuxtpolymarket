// Rail Tycoon — sprite atlas.
//
// Loads the committed OpenGFX atlas (public/rail-tycoon/opengfx, cut by
// scripts/rail-tycoon/extract-opengfx.ts) into pixi textures with nearest
// sampling and recolours the company-coloured sprites once per company. The
// names the renderer asks for live in sprite-names.ts.
//
// Everything above buildSpriteAtlas is pure and runs without a GPU, so it is
// unit tested in test/rail-tycoon/sprites.spec.ts. pixi itself is imported
// lazily inside buildSpriteAtlas, so importing this module never touches it.

import type { Renderer, Texture, TextureSource } from 'pixi.js'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RT_WATER_FRAMES, rtCoastSpriteName, rtWaterSpriteName, type RtSlopeName } from './sprite-names'

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

/** atlas.json: every sprite's frame, and the meta the renderer and the build picker read. */
export async function rtFetchAtlasJson(baseUrl = RT_ATLAS_BASE_URL): Promise<RtAtlasJson> {
    const response = await fetch(`${baseUrl}atlas.json`)
    if (!response.ok) throw new Error(`could not load atlas.json: ${response.status}`)
    return response.json() as Promise<RtAtlasJson>
}

/**
 * Loads atlas.json, atlas.png and mask.png and builds every texture the renderer draws, with
 * nearest sampling. Company sheets are built lazily by company() and cached until destroy().
 */
export async function buildSpriteAtlas(renderer: Renderer, baseUrl = RT_ATLAS_BASE_URL): Promise<RtSpriteAtlas> {
    const pixi = await import('pixi.js')
    const [json, image, maskImage] = await Promise.all([
        rtFetchAtlasJson(baseUrl),
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
