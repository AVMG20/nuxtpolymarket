// Xeno Slot uses shared vector illustrations for SVGs and Canvas textures.
// Particle sprites and the deep-space reel backdrop are painted separately.

import type { SlotSymbol } from '#shared/utils/gamelogic/xenoslot'
import { paintXenoVector, xenoVectorSvg } from './xenoslot-vectors'

export type XenoCoinTier = 'bronze' | 'silver' | 'gold' | 'xenium'
export type XenoCoreMult = 2 | 5 | 10

export type XenoArtId
    = SlotSymbol
        | `coin-${XenoCoinTier}`
        | 'ufo' | 'ufo-on'
        | `core-${XenoCoreMult}`

export const XENO_DISPLAY_FONT = 'Orbitron'
/** Symbol glyphs (royals, 7, WILD, BONUS, ×N) use a rounder face than the UI. */
export const XENO_GLYPH_FONT = 'Audiowide'
/** Amounts: a squared techno face with an unslashed zero. */
export const XENO_NUMBER_FONT = 'Chakra Petch'

/** Player-facing names and accent colours of the reel symbols. */
export const XENO_SYMBOLS: Record<SlotSymbol, { name: string, color: string }> = {
    ten: { name: '10', color: '#22d3ee' },
    jack: { name: 'J', color: '#a3e635' },
    queen: { name: 'Q', color: '#c084fc' },
    king: { name: 'K', color: '#fbbf24' },
    ace: { name: 'A', color: '#fb7185' },
    bell: { name: 'Glow Pod', color: '#2dd4bf' },
    seven: { name: 'Plasma 7', color: '#f97316' },
    diamond: { name: 'Xeno Crystal', color: '#e879f9' },
    wild: { name: 'Alien Wild', color: '#a3e635' },
    bonus: { name: 'Portal', color: '#f0abfc' }
}

/** Coin metal by value in × bet. */
export function xenoCoinTier(mult: number): XenoCoinTier {
    if (mult >= 25) return 'xenium'
    if (mult >= 5) return 'gold'
    if (mult >= 1) return 'silver'
    return 'bronze'
}

export const XENO_COIN_TIER_INDEX: Record<XenoCoinTier, number> = { bronze: 0, silver: 1, gold: 2, xenium: 3 }

type Ctx = CanvasRenderingContext2D

function canvas(size: number): [HTMLCanvasElement, Ctx] {
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    return [c, c.getContext('2d')!]
}

function font(px: number) {
    return `400 ${px}px ${XENO_GLYPH_FONT}, 'Arial Black', system-ui, sans-serif`
}

function linear(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    for (const [o, c] of stops) g.addColorStop(o, c)
    return g
}

function radial(ctx: Ctx, x: number, y: number, r0: number, x1: number, y1: number, r1: number, stops: [number, string][]) {
    const g = ctx.createRadialGradient(x, y, r0, x1, y1, r1)
    for (const [o, c] of stops) g.addColorStop(o, c)
    return g
}

function hexPath(ctx: Ctx, cx: number, cy: number, r: number, rot = -Math.PI / 2) {
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
        const a = rot + i * Math.PI / 3
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
    }
    ctx.closePath()
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
}

/** Four-point star sparkle. */
function star(ctx: Ctx, x: number, y: number, r: number, color = '#ffffff', alpha = 1) {
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

/** Rasterize the shared vector illustration for Pixi. */
export function paintXenoArt(id: XenoArtId, px: number): HTMLCanvasElement {
    const [c, ctx] = canvas(px)
    ctx.scale(px / 256, px / 256)
    paintXenoVector(ctx, id)
    return c
}

/** Vertical motion-blur copy of a painted symbol, used while the reels spin. */
export function xenoMotionBlur(src: HTMLCanvasElement): HTMLCanvasElement {
    const [c, ctx] = canvas(src.width)
    const spread = src.width * 0.09
    const taps = 7
    ctx.globalAlpha = 0.26
    for (let i = 0; i < taps; i++) {
        const dy = (i / (taps - 1) - 0.5) * 2 * spread
        ctx.drawImage(src, 0, dy)
    }
    return c
}

/** Soft white radial glow (tinted in Pixi for halos and flares). */
export function xenoGlowSprite(px = 128): HTMLCanvasElement {
    const [c, ctx] = canvas(px)
    const h = px / 2
    ctx.fillStyle = radial(ctx, h, h, 0, h, h, h, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']])
    ctx.fillRect(0, 0, px, px)
    return c
}

/** White four-point star for sparks. */
export function xenoSparkSprite(px = 64): HTMLCanvasElement {
    const [c, ctx] = canvas(px)
    const h = px / 2
    ctx.fillStyle = radial(ctx, h, h, 0, h, h, h * 0.5, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']])
    ctx.fillRect(0, 0, px, px)
    star(ctx, h, h, h * 0.95, '#ffffff', 1)
    return c
}

const urlCache = new Map<string, string>()

/** Crisp SVG UI artwork, sharing its paths with the reel textures. */
export function xenoArtDataUrl(id: XenoArtId, px = 128): string {
    const key = `${id}@${px}`
    let url = urlCache.get(key)
    if (!url) {
        url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xenoVectorSvg(id, px))}`
        urlCache.set(key, url)
    }
    return url
}

/** Load the display font before painting, so canvases don't bake a fallback face. */
export async function loadXenoFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return
    try {
        await Promise.race([
            Promise.all([
                document.fonts.load(font(64)),
                document.fonts.load(`700 32px ${XENO_DISPLAY_FONT}`),
                document.fonts.load(`700 32px '${XENO_NUMBER_FONT}'`)
            ]),
            new Promise(resolve => setTimeout(resolve, 2500))
        ])
    } catch {
        // Fallback face is fine.
    }
    urlCache.clear()
}

/** Reel window backdrop: deep-space glass, lit reel columns and a faint hex mesh. */
export function paintXenoReelBackdrop(w: number, h: number, scale: number, cols: number, colX: (i: number) => number, colW: number, top: number, colH: number): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = Math.round(w * scale)
    c.height = Math.round(h * scale)
    const ctx = c.getContext('2d')!
    ctx.scale(scale, scale)

    for (let i = 0; i < cols; i++) {
        const x = colX(i)
        roundRect(ctx, x, top, colW, colH, 14)
        ctx.fillStyle = linear(ctx, 0, top, 0, top + colH, [[0, '#100c25'], [0.18, '#191434'], [0.5, '#252044'], [0.82, '#191434'], [1, '#100c25']])
        ctx.fill()
        ctx.save()
        ctx.clip()
        // Hex mesh.
        ctx.strokeStyle = 'rgba(146,184,219,0.04)'
        ctx.lineWidth = 1
        const r = 14
        for (let yy = top - r; yy < top + colH + r; yy += r * 1.5) {
            for (let xx = x - r; xx < x + colW + r; xx += r * Math.sqrt(3)) {
                const off = Math.round((yy - top) / (r * 1.5)) % 2 ? r * Math.sqrt(3) / 2 : 0
                hexPath(ctx, xx + off, yy, r)
                ctx.stroke()
            }
        }
        // Side shading gives each reel a drum curve.
        ctx.fillStyle = linear(ctx, x, 0, x + colW, 0, [[0, 'rgba(0,0,0,0.45)'], [0.18, 'rgba(0,0,0,0)'], [0.82, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.45)']])
        ctx.fillRect(x, top, colW, colH)
        ctx.restore()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = 'rgba(146,184,219,0.18)'
        roundRect(ctx, x + 0.75, top + 0.75, colW - 1.5, colH - 1.5, 14)
        ctx.stroke()
    }
    return c
}
