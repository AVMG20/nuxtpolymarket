// Ember Portals: canvas-painted artwork for the Pixi stage and the Vue UI.
// Nothing is fetched except the three Google fonts. Symbols and the portal
// live in ./emberportals-vectors, the stage and board in ./emberportals-scene,
// shared brushes in ./emberportals-paint.

import type { EpSymbol } from '#shared/utils/gamelogic/emberportals'
import { GOLD, TAU, blurFill, blurStroke, circle, fade, glow, innerShadow, lin, makeCanvas, rad, rimLight, sparkle, type Ctx } from './emberportals-paint'
import {
    EP_PORTAL_TIERS,
    epPortalTier,
    epPortalTierIndex,
    paintEpBuyVector,
    paintEpPortalCoreVector,
    paintEpPortalRingVector,
    paintEpSymbolVector,
    type EpPortalTier
} from './emberportals-vectors'

export { EP_PORTAL_TIERS, epPortalTier, epPortalTierIndex, type EpPortalTier }
export { paintEpBoard, paintEpScene, paintEpSceneLayers, type EpSceneLayers } from './emberportals-scene'

export const EP_DISPLAY_FONT = 'Cinzel Decorative'
export const EP_NUMBER_FONT = 'Cinzel'
export const EP_UI_FONT = 'Nunito'
export const EP_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&family=Cinzel:wght@600;700;900&family=Nunito:wght@400;600;700;800&display=swap'

/** Player-facing names and accent colours. */
export const EP_SYMBOLS: Record<EpSymbol, { name: string, color: string }> = {
    ember: { name: 'Ember Shard', color: '#ff5a2a' },
    rune: { name: 'Rune Stone', color: '#3d7bff' },
    potion: { name: 'Potion', color: '#46e86a' },
    hourglass: { name: 'Hourglass', color: '#ffbf40' },
    chalice: { name: 'Chalice', color: '#2ee0c8' },
    amulet: { name: 'Amulet', color: '#b865ff' },
    grimoire: { name: 'Grimoire', color: '#ff4fa8' },
    phoenix: { name: 'Phoenix', color: '#ffd23a' },
    wild: { name: 'Fire Portal', color: '#ff8a1a' },
    scatter: { name: 'Eye of the Peak', color: '#5ff6ff' }
}

function displayFont(size: number, weight = 900) {
    return `${weight} ${size}px '${EP_DISPLAY_FONT}', 'Cinzel', Georgia, serif`
}

function numberFont(size: number) {
    return `900 ${size}px '${EP_NUMBER_FONT}', Georgia, serif`
}

// --- symbols and portal ---------------------------------------------------------

const cache = new Map<string, HTMLCanvasElement>()

function cached(key: string, px: number, paint: (ctx: Ctx) => void): HTMLCanvasElement {
    const k = `${key}@${Math.round(px)}`
    let c = cache.get(k)
    if (!c) {
        const [cv, ctx] = makeCanvas(px)
        ctx.scale(cv.width / 256, cv.height / 256)
        paint(ctx)
        c = cv
        cache.set(k, c)
    }
    return c
}

/** A symbol on a transparent px×px canvas (cached; don't draw on it). 'wild' is the tier-0 portal. */
export function paintEpSymbol(id: EpSymbol, px: number): HTMLCanvasElement {
    return cached(id, px, ctx => paintEpSymbolVector(ctx, id))
}

/**
 * Swirling vortex for the inside of the portal ring, in the tier's colours
 * (cached). Transparent at the edge, dark in the eye so a number reads on it.
 * Size it to ~0.5× the ring canvas and spin it.
 */
export function paintEpPortalCore(px: number, tier = 0): HTMLCanvasElement {
    return cached(`core${tier}`, px, ctx => paintEpPortalCoreVector(ctx, tier))
}

/**
 * The portal rim with its flame corona for a tier (cached). Meant to be drawn
 * at ~1.3× the cell: the stone ring spans 47-67% of the radius and the hole
 * inside (47%) is clear for the core; flames and bloom fill out to the edge.
 */
export function paintEpPortalRing(px: number, tier: number): HTMLCanvasElement {
    return cached(`ring${tier}`, px, ctx => paintEpPortalRingVector(ctx, tier))
}

// --- logo and buy art ------------------------------------------------------------

function fitFont(ctx: Ctx, text: string, size: number, maxW: number, font: (s: number) => string) {
    ctx.font = font(size)
    const w = ctx.measureText(text).width
    if (w > maxW) ctx.font = font(size * maxW / w)
}

function paintLogo(w: number, h: number): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(w, h)
    ctx.scale(w / 512, h / 256)

    // Just the plate and the wordmark: a faint gold glow, no flame crown.
    glow(ctx, 256, 145, 230, 'rgba(232,181,74,0.18)')

    // Plaque: gold frame, dark enamel, notched ends.
    const plaque = new Path2D('M36 132L70 76H442L476 132L442 214H70Z')
    blurFill(ctx, plaque, 'rgba(0,0,0,0.7)', 14, 0, 6)
    ctx.fillStyle = lin(ctx, 36, 76, 476, 214, GOLD)
    ctx.fill(plaque)
    rimLight(ctx, plaque, 'rgba(255,252,230,1)', 0, 3, 2, 'lighter')
    const inner = new Path2D('M54 132L80 88H432L458 132L432 202H80Z')
    ctx.fillStyle = lin(ctx, 0, 88, 0, 202, [[0, '#15102a'], [0.55, '#0a0718'], [1, '#040310']])
    ctx.fill(inner)
    innerShadow(ctx, inner, 'rgba(0,0,0,0.9)', 10, 0, 3)
    ctx.save()
    ctx.clip(inner)
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = rad(ctx, 256, 150, 220, [[0, 'rgba(232,181,74,0.12)'], [1, 'rgba(232,181,74,0)']])
    ctx.fillRect(0, 0, 512, 256)
    ctx.strokeStyle = 'rgba(255,190,90,0.1)'
    ctx.lineWidth = 2
    for (let i = 0; i < 9; i++) {
        ctx.beginPath()
        ctx.arc(256, 280, 110 + i * 22, Math.PI * 1.15, Math.PI * 1.85)
        ctx.stroke()
    }
    ctx.restore()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    fitFont(ctx, 'EMBER', 72, 360, s => displayFont(s))
    ctx.lineWidth = 10
    ctx.strokeStyle = '#2a0600'
    ctx.strokeText('EMBER', 256, 124)
    ctx.save()
    ctx.shadowColor = 'rgba(232,181,74,0.6)'
    ctx.shadowBlur = 12 * (w / 512)
    ctx.fillStyle = lin(ctx, 0, 96, 0, 152, [[0, '#ffffff'], [0.3, '#ffe27a'], [0.65, '#ff8a1a'], [1, '#d0200a']])
    ctx.fillText('EMBER', 256, 124)
    ctx.restore()
    fitFont(ctx, 'PORTALS', 40, 330, s => displayFont(s, 700))
    ctx.lineWidth = 7
    ctx.strokeStyle = '#040a1a'
    ctx.strokeText('PORTALS', 256, 176)
    ctx.save()
    ctx.shadowColor = '#38e8ff'
    ctx.shadowBlur = 18 * (w / 512)
    ctx.fillStyle = lin(ctx, 0, 160, 0, 194, [[0, '#ffffff'], [0.5, '#b8f6ff'], [1, '#4ab8e0']])
    ctx.fillText('PORTALS', 256, 176)
    ctx.restore()
    sparkle(ctx, 118, 96, 14, '#fffbe0')
    sparkle(ctx, 400, 196, 10, '#dcfffd', 0.9)
    return c
}

const urlCache = new Map<string, string>()

/** PNG data URL for the Vue UI (paytable, buy dialog, header). 'logo' is px*2 × px. */
export function epArtDataUrl(id: EpSymbol | 'logo' | 'buy', px = 128): string {
    const key = `${id}@${px}`
    let url = urlCache.get(key)
    if (url) return url
    let c: HTMLCanvasElement
    if (id === 'logo') {
        c = paintLogo(px * 2, px)
    } else if (id === 'buy') {
        c = cached('buy', px, paintEpBuyVector)
    } else {
        c = paintEpSymbol(id, px)
    }
    url = c.toDataURL('image/png')
    urlCache.set(key, url)
    return url
}

/** Load the fonts the paintings use, so canvases don't bake a fallback face. */
export async function loadEpFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return
    try {
        await Promise.race([
            Promise.all([
                document.fonts.load(displayFont(64)),
                document.fonts.load(displayFont(64, 700)),
                document.fonts.load(numberFont(32)),
                document.fonts.load(`700 16px '${EP_UI_FONT}'`)
            ]),
            new Promise(resolve => setTimeout(resolve, 2500))
        ])
    } catch {
        // Fallback faces are fine.
    }
    urlCache.clear()
}

// --- HUD plaques and the spin ring ---------------------------------------------------

export type EpPlaqueVariant = 'gold' | 'fire' | 'stone'

/** Octagon with chamfered corners, inset by `d`. */
function chamfered(w: number, h: number, c: number, d: number): Path2D {
    const k = Math.max(0, c - d * 0.41)
    const p = new Path2D()
    p.moveTo(d + k, d)
    p.lineTo(w - d - k, d)
    p.lineTo(w - d, d + k)
    p.lineTo(w - d, h - d - k)
    p.lineTo(w - d - k, h - d)
    p.lineTo(d + k, h - d)
    p.lineTo(d, h - d - k)
    p.lineTo(d, d + k)
    p.closePath()
    return p
}

/**
 * An ornate HUD plaque at (w*scale)×(h*scale), transparent outside its shape:
 * chamfered corners, a bevelled gold (or stone) border with a filigree line,
 * a dark glass centre and a small crest at the top centre. The inner ~80% is
 * free for text. 'fire' glows like embers (buy), 'gold' is neutral, 'stone'
 * is subdued (info).
 */
export function paintEpPlaque(w: number, h: number, scale: number, variant: EpPlaqueVariant): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(w * scale, h * scale)
    ctx.scale(scale, scale)
    const m = Math.min(w, h)
    const chamfer = Math.min(m * 0.26, 18)
    const b = Math.max(2.5, Math.min(m * 0.09, 7))
    const outer = chamfered(w, h, chamfer, 0.5)
    const inner = chamfered(w, h, chamfer, b)
    const stone = variant === 'stone'

    // Border.
    ctx.fillStyle = stone
        ? lin(ctx, 0, 0, w * 0.4, h * 1.6, [[0, '#4a4256'], [0.3, '#2c2638'], [0.7, '#1c1826'], [1, '#100d16']])
        : lin(ctx, 0, 0, w * 0.4, h * 1.6, GOLD)
    ctx.fill(outer)
    rimLight(ctx, outer, stone ? 'rgba(230,200,160,0.5)' : 'rgba(255,252,230,1)', 1, 1.5, 1, 'lighter')
    innerShadow(ctx, outer, stone ? 'rgba(0,0,0,0.6)' : 'rgba(90,40,0,0.7)', 1.5, -1, -1.5)

    // Dark glass centre.
    ctx.fillStyle = lin(ctx, 0, b, 0, h - b, variant === 'fire'
        ? [[0, '#2a0a10'], [0.6, '#16050a'], [1, '#0a0206']]
        : stone
            ? [[0, '#100d22'], [1, '#07061a']]
            : [[0, '#17112e'], [0.6, '#0c0920'], [1, '#060414']])
    ctx.fill(inner)
    ctx.save()
    ctx.clip(inner)
    ctx.globalCompositeOperation = 'lighter'
    const glowCol = variant === 'fire' ? 'rgba(255,90,20,0.55)' : stone ? 'rgba(90,150,255,0.08)' : 'rgba(255,170,70,0.14)'
    ctx.save()
    ctx.translate(w / 2, h * 0.62)
    ctx.scale(1, Math.min(1, h / w) * 1.6)
    ctx.fillStyle = rad(ctx, 0, 0, w * 0.55, [[0, glowCol], [1, fade(glowCol, 0)]])
    ctx.fillRect(-w, -w, w * 2, w * 2)
    ctx.restore()
    // Glass sheen.
    ctx.fillStyle = lin(ctx, 0, b, 0, h * 0.5, [[0, 'rgba(255,255,255,0.08)'], [1, 'rgba(255,255,255,0)']])
    ctx.fillRect(0, 0, w, h * 0.5)
    ctx.restore()
    innerShadow(ctx, inner, 'rgba(0,0,0,0.85)', b * 1.2, 0, b * 0.3)

    // Filigree line and side scrolls.
    const fil = chamfered(w, h, chamfer, b + Math.max(2, b * 0.5))
    ctx.save()
    ctx.lineWidth = Math.max(0.9, b * 0.18)
    ctx.strokeStyle = stone ? 'rgba(200,150,90,0.45)' : lin(ctx, 0, 0, w, h, GOLD)
    ctx.globalAlpha = stone ? 1 : 0.75
    ctx.stroke(fil)
    ctx.restore()
    // Rivets on the chamfers.
    const k = chamfer * 0.5 + b * 0.35
    for (const [x, y] of [[k, k], [w - k, k], [k, h - k], [w - k, h - k]] as const) {
        const rr = Math.max(1.2, b * 0.36)
        ctx.fillStyle = rad(ctx, x - rr * 0.3, y - rr * 0.3, rr * 1.3, stone
            ? [[0, '#f0d8b0'], [0.5, '#a07040'], [1, '#3a2410']]
            : [[0, '#fffbe0'], [0.5, '#f0c050'], [1, '#6b3a07']])
        ctx.fill(circle(x, y, rr))
    }
    if (!stone) {
        for (const x of [b + 1, w - b - 1]) {
            const s = Math.min(h * 0.18, 7)
            const p = new Path2D()
            p.moveTo(x, h / 2 - s)
            p.lineTo(x + s * 0.7, h / 2)
            p.lineTo(x, h / 2 + s)
            p.lineTo(x - s * 0.7, h / 2)
            p.closePath()
            ctx.fillStyle = lin(ctx, x - s, h / 2 - s, x + s, h / 2 + s, GOLD)
            ctx.fill(p)
        }
    }
    if (variant === 'fire') blurStroke(ctx, inner, 'rgba(255,120,30,0.9)', 1.2, 4)

    // Crest at the top centre.
    const r = Math.max(3.5, Math.min(m * 0.17, 10))
    const cx = w / 2
    const cy = b * 0.5 + r * 0.25
    const crest = new Path2D()
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU - Math.PI / 2
        const rr = i % 2 ? r * 1.05 : r * 1.45
        if (i) crest.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
        else crest.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
    }
    crest.closePath()
    ctx.save()
    ctx.clip(outer)
    ctx.fillStyle = stone ? lin(ctx, cx - r, cy - r, cx + r, cy + r, [[0, '#c89a60'], [1, '#4a2e14']]) : lin(ctx, cx - r, cy - r, cx + r, cy + r, GOLD)
    ctx.fill(crest)
    const gem = variant === 'fire'
        ? [[0, '#fffbe0'], [0.35, '#ffb040'], [0.75, '#e0400a'], [1, '#400804']] as [number, string][]
        : stone
            ? [[0, '#e8ffff'], [0.4, '#4fd8ff'], [1, '#0a3050']] as [number, string][]
            : [[0, '#e8fffb'], [0.4, '#2ee0c8'], [1, '#063a36']] as [number, string][]
    glow(ctx, cx, cy, r * 2.2, variant === 'fire' ? 'rgba(255,140,40,0.7)' : 'rgba(80,230,220,0.45)')
    ctx.fillStyle = rad(ctx, cx, cy, r * 0.62, gem, cx - r * 0.2, cy - r * 0.2, 0)
    ctx.fill(circle(cx, cy, r * 0.62))
    ctx.restore()
    return c
}

const plaqueCache = new Map<string, string>()

/** PNG data URL of a plaque painted at 2× (cached per size and variant). */
export function epPlaqueDataUrl(w: number, h: number, variant: EpPlaqueVariant): string {
    const key = `${Math.round(w)}x${Math.round(h)}:${variant}`
    let url = plaqueCache.get(key)
    if (!url) {
        url = paintEpPlaque(w, h, 2, variant).toDataURL('image/png')
        plaqueCache.set(key, url)
    }
    return url
}

/**
 * Ornate gold-and-stone ring for the round spin button, clear in the middle
 * (r < 0.72 of the radius), with runes and studs so a slow rotation reads.
 */
export function paintEpSpinRing(px: number): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(px)
    ctx.scale(c.width / 256, c.height / 256)
    const R0 = 92
    const R1 = 124
    const ring = new Path2D()
    ring.arc(128, 128, R1, 0, TAU)
    ring.arc(128, 128, R0, 0, TAU, true)
    ctx.fillStyle = rad(ctx, 128, 128, R1, [[R0 / R1, '#120e22'], [0.86, '#2a2340'], [1, '#120e20']])
    ctx.fill(ring)
    innerShadow(ctx, ring, 'rgba(0,0,0,0.7)', 5, 0, 2)
    // Gold bevel bands on both edges.
    for (const [r, wd] of [[R1 - 4, 8], [R0 + 3.5, 7]] as const) {
        const band = new Path2D()
        band.arc(128, 128, r + wd / 2, 0, TAU)
        band.arc(128, 128, r - wd / 2, 0, TAU, true)
        ctx.fillStyle = lin(ctx, 10, 10, 246, 246, GOLD)
        ctx.fill(band)
        rimLight(ctx, band, 'rgba(255,252,230,1)', 1, 1.5, 1, 'lighter')
    }
    // Runes and studs.
    const glyphs = ['M-4 -5L0 5 4 -5', 'M0 -6V6M-4 -2L0 -6 4 -2', 'M-4 -5H4L-4 5H4', 'M0 -6L4 0 0 6 -4 0Z']
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU - Math.PI / 2
        const x = 128 + Math.cos(a) * 108
        const y = 128 + Math.sin(a) * 108
        if (i % 2) {
            ctx.fillStyle = rad(ctx, x - 1, y - 1, 4.5, [[0, '#fffbe0'], [0.5, '#f0c050'], [1, '#6b3a07']])
            ctx.fill(circle(x, y, 4))
            continue
        }
        const p = new Path2D()
        p.addPath(new Path2D(glyphs[(i / 2) % glyphs.length]!), new DOMMatrix().translateSelf(x, y).rotateSelf(((a + Math.PI / 2) * 180) / Math.PI))
        blurStroke(ctx, p, 'rgba(255,150,50,0.9)', 3, 5)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 2
        ctx.strokeStyle = '#ffd88a'
        ctx.stroke(p)
        ctx.restore()
    }
    return c
}

// --- particles ----------------------------------------------------------------------

/** Soft white radial glow (tinted in Pixi for halos). */
export function epGlowSprite(px = 128): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(px)
    const h = px / 2
    ctx.fillStyle = rad(ctx, h, h, h, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']])
    ctx.fillRect(0, 0, px, px)
    return c
}

/** Small bright ember: hot white core, orange falloff, a faint star glint. */
export function epSparkSprite(px = 64): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(px)
    const h = px / 2
    ctx.fillStyle = rad(ctx, h, h, h, [[0, 'rgba(255,255,240,1)'], [0.18, 'rgba(255,220,130,0.95)'], [0.45, 'rgba(255,120,30,0.45)'], [1, 'rgba(255,60,10,0)']])
    ctx.fillRect(0, 0, px, px)
    sparkle(ctx, h, h, h * 0.8, '#fff8e0', 0.6)
    return c
}

/** Vertical motion-blur copy of a painted symbol, used while symbols fall. */
export function epMotionBlur(src: HTMLCanvasElement): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(src.width, src.height)
    const spread = src.height * 0.12
    const taps = 7
    ctx.globalAlpha = 0.26
    for (let i = 0; i < taps; i++) {
        const dy = (i / (taps - 1) - 0.5) * 2 * spread
        ctx.drawImage(src, 0, dy)
    }
    return c
}
