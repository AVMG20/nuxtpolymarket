// Trash Panda Heist: shared vector illustrations for SVG UI artwork and
// canvas-backed Pixi textures, plus procedural particles and reel backdrops.

import type { TphSymbol } from '#shared/utils/gamelogic/trashpanda'
import { paintTphVector, tphVectorSvg } from './trashpanda-vectors'

export type TphWildMult = 2 | 3 | 5 | 10
export const TPH_WILD_MULTS: TphWildMult[] = [2, 3, 5, 10]

export type TphArtId
    = TphSymbol
        | `wild${TphWildMult}`
        | 'can-closed' | 'dog' | 'key' | 'double' | 'coins' | 'raccoon'

export const TPH_DISPLAY_FONT = 'Bangers'
export const TPH_NUMBER_FONT = 'Lilita One'
export const TPH_UI_FONT = 'Fredoka'

const INK = '#182333'

/** Player-facing names and accent colours. */
export const TPH_SYMBOLS: Record<TphSymbol, { name: string, color: string }> = {
    fish: { name: 'Fish Bones', color: '#7dd3fc' },
    banana: { name: 'Banana Peel', color: '#fde047' },
    can: { name: 'Soda Can', color: '#f87171' },
    apple: { name: 'Apple Core', color: '#86efac' },
    pizza: { name: 'Pizza Slice', color: '#fb923c' },
    donut: { name: 'Donut', color: '#f9a8d4' },
    cash: { name: 'Cash Stack', color: '#4ade80' },
    bag: { name: 'Loot Bag', color: '#fbbf24' },
    gem: { name: 'Diamond', color: '#67e8f9' },
    boss: { name: 'The Boss', color: '#c4b5fd' },
    wild: { name: 'Mask Wild', color: '#facc15' },
    safe: { name: 'Safe', color: '#d8b4ff' },
    bin: { name: 'Dumpster', color: '#9bffd1' }
}

/** Badge colours of the sticky multiplier wilds. */
export const TPH_WILD_COLORS: Record<TphWildMult, string> = {
    2: '#4ade80',
    3: '#38bdf8',
    5: '#e879f9',
    10: '#f43f5e'
}

type Ctx = CanvasRenderingContext2D

function canvas(w: number, h = w): [HTMLCanvasElement, Ctx] {
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w))
    c.height = Math.max(1, Math.round(h))
    return [c, c.getContext('2d')!]
}

function linear(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    for (const [o, c] of stops) g.addColorStop(o, c)
    return g
}

function radial(ctx: Ctx, x: number, y: number, r: number, stops: [number, string][], x0 = x, y0 = y, r0 = 0) {
    const g = ctx.createRadialGradient(x0, y0, r0, x, y, r)
    for (const [o, c] of stops) g.addColorStop(o, c)
    return g
}

function path(build: (p: Path2D) => void): Path2D {
    const p = new Path2D()
    build(p)
    return p
}

function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0): Path2D {
    return path(p => p.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2))
}

interface BlobStyle {
    /** Shadow crescent offset (units). */
    d?: number
    line?: number
    /** Gloss ellipse: [cx, cy, rx, ry, rotation], relative to the canvas. */
    gloss?: [number, number, number, number, number]
    glossAlpha?: number
    noShade?: boolean
}

/** Fill, cel-shade and ink one shape. `fill` may be a colour or gradient. */
function blob(ctx: Ctx, p: Path2D, fill: string | CanvasGradient, shadow: string, s: BlobStyle = {}) {
    const d = s.d ?? 12
    ctx.save()
    ctx.fillStyle = fill
    ctx.fill(p)
    if (!s.noShade) {
        ctx.save()
        ctx.clip(p)
        ctx.fillStyle = shadow
        ctx.fillRect(0, 0, 256, 256)
        ctx.translate(-d, -d * 0.9)
        ctx.fillStyle = fill
        ctx.fill(p)
        ctx.restore()
    }
    if (s.gloss) {
        ctx.save()
        ctx.clip(p)
        const [gx, gy, rx, ry, rot] = s.gloss
        ctx.globalAlpha = s.glossAlpha ?? 0.55
        ctx.fillStyle = '#ffffff'
        ctx.fill(ellipse(gx, gy, rx, ry, rot))
        ctx.restore()
    }
    ink(ctx, p, s.line ?? 9)
    ctx.restore()
}

function ink(ctx: Ctx, p: Path2D, width = 9) {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = width
    ctx.strokeStyle = INK
    ctx.stroke(p)
    ctx.restore()
}

function sparkle(ctx: Ctx, x: number, y: number, r: number, color = '#ffffff', alpha = 1) {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(x, y - r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.quadraticCurveTo(x, y, x, y + r)
    ctx.quadraticCurveTo(x, y, x - r, y)
    ctx.quadraticCurveTo(x, y, x, y - r)
    ctx.fill()
    ctx.restore()
}

function displayFont(size: number) {
    return `400 ${size}px '${TPH_DISPLAY_FONT}', 'Arial Black', Impact, sans-serif`
}

function numberFont(size: number) {
    return `400 ${size}px '${TPH_NUMBER_FONT}', 'Arial Black', sans-serif`
}

/** Rasterize the shared vector illustration for the Pixi reel texture. */
export function paintTphArt(id: TphArtId, px: number): HTMLCanvasElement {
    const [c, ctx] = canvas(px)
    ctx.scale(c.width / 256, c.height / 256)
    paintTphVector(ctx, id)
    return c
}

/** Vertical motion-blur copy of a painted symbol, used while the reels spin. */
export function tphMotionBlur(src: HTMLCanvasElement): HTMLCanvasElement {
    const [c, ctx] = canvas(src.width)
    const spread = src.width * 0.1
    const taps = 7
    ctx.globalAlpha = 0.26
    for (let i = 0; i < taps; i++) {
        const dy = (i / (taps - 1) - 0.5) * 2 * spread
        ctx.drawImage(src, 0, dy)
    }
    return c
}

/** Soft white radial glow (tinted in Pixi for halos). */
export function tphGlowSprite(px = 128): HTMLCanvasElement {
    const [c, ctx] = canvas(px)
    const h = px / 2
    ctx.fillStyle = radial(ctx, h, h, h, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']])
    ctx.fillRect(0, 0, px, px)
    return c
}

/** White four-point star for sparks. */
export function tphSparkSprite(px = 64): HTMLCanvasElement {
    const [c, ctx] = canvas(px)
    const h = px / 2
    ctx.fillStyle = radial(ctx, h, h, h * 0.5, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']])
    ctx.fillRect(0, 0, px, px)
    sparkle(ctx, h, h, h * 0.95)
    return c
}

/** Small gold coin for the coin fountain. */
export function tphCoinSprite(px = 64): HTMLCanvasElement {
    const [c, ctx] = canvas(px)
    const k = px / 256
    ctx.scale(k, k)
    blob(ctx, ellipse(128, 128, 110, 110), radial(ctx, 96, 96, 150, [[0, '#fef9c3'], [0.5, '#facc15'], [1, '#b45309']]), '#92400e', { d: 12, line: 16 })
    ctx.font = displayFont(130)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#92400e'
    ctx.fillText('$', 128, 134)
    return c
}

const urlCache = new Map<string, string>()

/** Resolution-independent SVG, shared with the reel paintings. */
export function tphArtDataUrl(id: TphArtId, px = 128): string {
    const key = `${id}@${px}`
    let url = urlCache.get(key)
    if (!url) {
        url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tphVectorSvg(id, px))}`
        urlCache.set(key, url)
    }
    return url
}

/** Load the fonts the paintings use, so canvases don't bake a fallback face. */
export async function loadTphFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return
    try {
        await Promise.race([
            Promise.all([
                document.fonts.load(displayFont(64)),
                document.fonts.load(numberFont(32)),
                document.fonts.load(`600 16px '${TPH_UI_FONT}'`)
            ]),
            new Promise(resolve => setTimeout(resolve, 2500))
        ])
    } catch {
        // Fallback face is fine.
    }
    urlCache.clear()
}

/** Reel backdrop: dark alley columns with faint brickwork. */
export function paintTphReelBackdrop(w: number, h: number, scale: number, cols: number, colX: (i: number) => number, colW: number, top: number, colH: number): HTMLCanvasElement {
    const [c, ctx] = canvas(w * scale, h * scale)
    ctx.scale(scale, scale)
    for (let i = 0; i < cols; i++) {
        const x = colX(i)
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(x, top, colW, colH, 14)
        ctx.fillStyle = linear(ctx, 0, top, 0, top + colH, [[0, '#142632'], [0.2, '#1a303e'], [0.5, '#223e4c'], [0.8, '#1a303e'], [1, '#142632']])
        ctx.fill()
        ctx.clip()
        // Bricks.
        ctx.strokeStyle = 'rgba(147,197,190,0.05)'
        ctx.lineWidth = 1.5
        const bh = 22
        const bw = 46
        for (let row = 0; row * bh < colH; row++) {
            const y = top + row * bh
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x + colW, y)
            ctx.stroke()
            for (let xx = x - (row % 2 ? bw / 2 : 0); xx < x + colW; xx += bw) {
                ctx.beginPath()
                ctx.moveTo(xx, y)
                ctx.lineTo(xx, y + bh)
                ctx.stroke()
            }
        }
        // Drum curve.
        ctx.fillStyle = linear(ctx, x, 0, x + colW, 0, [[0, 'rgba(0,0,0,0.5)'], [0.2, 'rgba(0,0,0,0)'], [0.8, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.5)']])
        ctx.fillRect(x, top, colW, colH)
        ctx.restore()
        ctx.lineWidth = 2
        ctx.strokeStyle = 'rgba(147,197,190,0.14)'
        ctx.beginPath()
        ctx.roundRect(x + 1, top + 1, colW - 2, colH - 2, 14)
        ctx.stroke()
    }
    return c
}
