// Xeno Slot artwork, painted procedurally on 2D canvases: reel symbols, bonus
// coins, the UFO collector, multiplier cores, particle sprites and the reel
// window backdrop. Pixi turns the canvases into textures; the DOM (paytable,
// buy-bonus card) uses the same paintings as data URLs, so every surface
// shares one look. No image files are loaded.
//
// Every painter works in a 256-unit square; `paintXenoArt` scales it to the
// requested pixel size. shadowBlur ignores the canvas transform, so glow radii
// are multiplied by `k` (pixels per unit) by hand.

import type { SlotSymbol } from '#shared/utils/gamelogic/xenoslot'

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

function glow(ctx: Ctx, k: number, color: string, blur: number) {
    ctx.shadowColor = color
    ctx.shadowBlur = blur * k
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
}

function noGlow(ctx: Ctx) {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
}

/**
 * Paint `draw` onto a separate layer, then run `shade` on it with
 * source-atop so highlights stay inside the shape, and composite the layer.
 */
function layer(ctx: Ctx, px: number, k: number, draw: (l: Ctx) => void, shade?: (l: Ctx) => void) {
    const [c, l] = canvas(px)
    l.scale(k, k)
    draw(l)
    if (shade) {
        l.globalCompositeOperation = 'source-atop'
        shade(l)
        l.globalCompositeOperation = 'source-over'
    }
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(c, 0, 0)
    ctx.restore()
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

/** Glyph text fitted to a max width, drawn with glow, outline, chrome rim, gradient fill and a top gloss. */
function chromeText(ctx: Ctx, px: number, k: number, text: string, cx: number, cy: number, size: number, maxW: number, fill: [number, string][], glowColor: string, rim: string) {
    ctx.save()
    ctx.font = font(size)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(text).width
    const sx = w > maxW ? maxW / w : 1
    const top = cy - size * 0.42
    const bottom = cy + size * 0.42

    const place = (l: Ctx) => {
        l.translate(cx, cy)
        l.scale(sx, 1)
        l.font = font(size)
        l.textAlign = 'center'
        l.textBaseline = 'middle'
        l.lineJoin = 'round'
    }

    // Outer glow + dark outline.
    ctx.translate(cx, cy)
    ctx.scale(sx, 1)
    ctx.lineJoin = 'round'
    glow(ctx, k, glowColor, 26)
    ctx.lineWidth = Math.max(4, size * 0.12)
    ctx.strokeStyle = '#05020c'
    ctx.strokeText(text, 0, 0)
    noGlow(ctx)
    ctx.lineWidth = Math.max(2, size * 0.055)
    ctx.strokeStyle = linear(ctx, 0, -size * 0.5, 0, size * 0.5, [[0, '#ffffff'], [0.35, rim], [0.55, '#1c1530'], [0.8, rim], [1, '#ffffff']])
    ctx.strokeText(text, 0, 0)
    ctx.restore()

    layer(ctx, px, k, (l) => {
        l.save()
        place(l)
        l.fillStyle = linear(l, 0, top - cy, 0, bottom - cy, fill)
        l.fillText(text, 0, 0)
        l.restore()
    }, (l) => {
        // Gloss on the upper half and a soft bottom reflection.
        l.fillStyle = linear(l, 0, top, 0, cy + 4, [[0, 'rgba(255,255,255,0.7)'], [0.55, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']])
        l.fillRect(0, top - 20, 256, cy - top + 24)
        l.fillStyle = linear(l, 0, cy + size * 0.1, 0, bottom, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.35)']])
        l.fillRect(0, cy, 256, bottom - cy + 20)
    })
}

// Low symbols: neon-glass royals on a faint hex plate -------------------------

const ROYAL_STYLE: Record<'ten' | 'jack' | 'queen' | 'king' | 'ace', { text: string, stops: [number, string][], glow: string, rim: string, plate: string }> = {
    ten: { text: '10', stops: [[0, '#ecfeff'], [0.3, '#67e8f9'], [0.65, '#0891b2'], [1, '#083344']], glow: '#22d3ee', rim: '#a5f3fc', plate: '#0e7490' },
    jack: { text: 'J', stops: [[0, '#f7fee7'], [0.3, '#bef264'], [0.65, '#65a30d'], [1, '#1a2e05']], glow: '#a3e635', rim: '#d9f99d', plate: '#4d7c0f' },
    queen: { text: 'Q', stops: [[0, '#faf5ff'], [0.3, '#d8b4fe'], [0.65, '#9333ea'], [1, '#2e1065']], glow: '#c084fc', rim: '#e9d5ff', plate: '#7e22ce' },
    king: { text: 'K', stops: [[0, '#fffbeb'], [0.3, '#fcd34d'], [0.65, '#d97706'], [1, '#451a03']], glow: '#fbbf24', rim: '#fde68a', plate: '#b45309' },
    ace: { text: 'A', stops: [[0, '#fff1f2'], [0.3, '#fda4af'], [0.65, '#e11d48'], [1, '#4c0519']], glow: '#fb7185', rim: '#fecdd3', plate: '#be123c' }
}

function paintRoyal(ctx: Ctx, px: number, k: number, id: keyof typeof ROYAL_STYLE) {
    const s = ROYAL_STYLE[id]
    // Hex plate: dark glass with a neon edge.
    hexPath(ctx, 128, 128, 112, 0)
    ctx.fillStyle = radial(ctx, 128, 96, 10, 128, 128, 120, [[0, `${s.plate}55`], [0.7, '#0b061a88'], [1, '#05020c55']])
    ctx.fill()
    glow(ctx, k, s.glow, 14)
    ctx.lineWidth = 3
    ctx.strokeStyle = `${s.glow}aa`
    ctx.stroke()
    noGlow(ctx)
    hexPath(ctx, 128, 128, 102, 0)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.stroke()

    chromeText(ctx, px, k, s.text, 128, 134, id === 'ten' ? 150 : 176, 196, s.stops, s.glow, s.rim)
    star(ctx, 190, 62, 11, '#ffffff', 0.85)
}

// Premium symbols -----------------------------------------------------------

function paintPod(ctx: Ctx, _px: number, k: number) {
    // Stem.
    ctx.lineCap = 'round'
    ctx.strokeStyle = linear(ctx, 0, 150, 0, 240, [[0, '#34d399'], [1, '#064e3b']])
    ctx.lineWidth = 12
    ctx.beginPath()
    ctx.moveTo(128, 238)
    ctx.bezierCurveTo(120, 210, 136, 190, 128, 160)
    ctx.stroke()

    // Leaves.
    const leaf = (dir: 1 | -1) => {
        ctx.save()
        ctx.translate(128, 222)
        ctx.scale(dir, 1)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.bezierCurveTo(30, -44, 82, -40, 102, -24)
        ctx.bezierCurveTo(78, -2, 36, 14, 0, 0)
        ctx.fillStyle = linear(ctx, 0, -40, 90, 10, [[0, '#a7f3d0'], [0.4, '#10b981'], [1, '#064e3b']])
        glow(ctx, k, '#10b981', 10)
        ctx.fill()
        noGlow(ctx)
        ctx.strokeStyle = 'rgba(209,250,229,0.6)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(6, -2)
        ctx.quadraticCurveTo(50, -24, 96, -23)
        ctx.stroke()
        ctx.restore()
    }
    leaf(1)
    leaf(-1)

    // Pod body.
    ctx.save()
    glow(ctx, k, '#2dd4bf', 34)
    ctx.beginPath()
    ctx.moveTo(128, 22)
    ctx.bezierCurveTo(196, 30, 204, 118, 176, 148)
    ctx.bezierCurveTo(156, 172, 100, 172, 80, 148)
    ctx.bezierCurveTo(52, 118, 60, 30, 128, 22)
    ctx.closePath()
    ctx.fillStyle = radial(ctx, 108, 70, 4, 128, 100, 96, [[0, '#f0fdfa'], [0.22, '#99f6e4'], [0.55, '#14b8a6'], [0.85, '#115e59'], [1, '#042f2e']])
    ctx.fill()
    noGlow(ctx)
    ctx.clip()
    // Bioluminescent spots.
    const spots: [number, number, number][] = [[150, 60, 9], [166, 98, 7], [100, 120, 8], [140, 136, 6], [88, 84, 5], [120, 44, 4]]
    for (const [x, y, r] of spots) {
        ctx.fillStyle = radial(ctx, x, y, 0, x, y, r * 1.8, [[0, 'rgba(254,249,195,0.95)'], [0.5, 'rgba(253,224,71,0.55)'], [1, 'rgba(253,224,71,0)']])
        ctx.beginPath()
        ctx.arc(x, y, r * 1.8, 0, Math.PI * 2)
        ctx.fill()
    }
    // Rim light.
    ctx.strokeStyle = 'rgba(204,251,241,0.5)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.restore()

    // Specular.
    ctx.save()
    ctx.translate(104, 62)
    ctx.rotate(-0.5)
    ctx.fillStyle = radial(ctx, 0, 0, 0, 0, 0, 24, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']])
    ctx.beginPath()
    ctx.ellipse(0, 0, 22, 11, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // Curling tendril with a glowing tip.
    ctx.strokeStyle = '#5eead4'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(128, 24)
    ctx.bezierCurveTo(132, 6, 160, 4, 160, 18)
    ctx.stroke()
    glow(ctx, k, '#fde047', 16)
    ctx.fillStyle = '#fef9c3'
    ctx.beginPath()
    ctx.arc(160, 20, 6, 0, Math.PI * 2)
    ctx.fill()
    noGlow(ctx)
}

function paintSeven(ctx: Ctx, px: number, k: number) {
    // Heat haze behind the glyph.
    ctx.fillStyle = radial(ctx, 128, 128, 10, 128, 128, 120, [[0, 'rgba(251,146,60,0.45)'], [0.6, 'rgba(220,38,38,0.12)'], [1, 'rgba(220,38,38,0)']])
    ctx.fillRect(0, 0, 256, 256)
    chromeText(ctx, px, k, '7', 128, 132, 236, 210, [[0, '#fffbeb'], [0.22, '#fde047'], [0.5, '#f97316'], [0.78, '#dc2626'], [1, '#450a0a']], '#f97316', '#fecaca')
    star(ctx, 60, 56, 14, '#fff7ed', 0.95)
    star(ctx, 200, 196, 9, '#fff7ed', 0.8)
    star(ctx, 206, 44, 6, '#fff7ed', 0.7)
}

function paintCrystal(ctx: Ctx, _px: number, k: number) {
    const cx = 128
    const tableY = 64
    const girdleY = 108
    const culet: [number, number] = [128, 232]
    const tl = 80
    const tr = 176
    const gl = 26
    const gr = 230

    ctx.save()
    glow(ctx, k, '#e879f9', 34)
    ctx.beginPath()
    ctx.moveTo(tl, tableY)
    ctx.lineTo(tr, tableY)
    ctx.lineTo(gr, girdleY)
    ctx.lineTo(culet[0], culet[1])
    ctx.lineTo(gl, girdleY)
    ctx.closePath()
    ctx.fillStyle = '#a21caf'
    ctx.fill()
    ctx.restore()

    const facet = (pts: [number, number][], fill: string | CanvasGradient) => {
        ctx.beginPath()
        ctx.moveTo(pts[0]![0], pts[0]![1])
        for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1])
        ctx.closePath()
        ctx.fillStyle = fill
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,240,255,0.55)'
        ctx.lineWidth = 1.6
        ctx.stroke()
    }

    // Crown.
    const mid = (a: number, b: number) => (a + b) / 2
    facet([[tl, tableY], [tr, tableY], [mid(tl, tr) + 20, 90], [mid(tl, tr) - 20, 90]], linear(ctx, 0, tableY, 0, 90, [[0, '#fdf4ff'], [1, '#f0abfc']]))
    facet([[tl, tableY], [mid(tl, tr) - 20, 90], [70, girdleY]], '#e879f9')
    facet([[tr, tableY], [mid(tl, tr) + 20, 90], [186, girdleY]], '#d946ef')
    facet([[mid(tl, tr) - 20, 90], [mid(tl, tr) + 20, 90], [186, girdleY], [70, girdleY]], linear(ctx, 0, 90, 0, girdleY, [[0, '#f5d0fe'], [1, '#c026d3']]))
    facet([[tl, tableY], [70, girdleY], [gl, girdleY]], '#a855f7')
    facet([[tr, tableY], [186, girdleY], [gr, girdleY]], '#7e22ce')

    // Pavilion.
    const girdle: number[] = [gl, 70, cx, 186, gr]
    const pav = ['#c026d3', '#f0abfc', '#86198f', '#e879f9', '#581c87', '#a21caf']
    for (let i = 0; i < girdle.length - 1; i++) {
        const a = girdle[i]!
        const b = girdle[i + 1]!
        facet([[a, girdleY], [mid(a, b), girdleY], culet], pav[(i * 2) % pav.length]!)
        facet([[mid(a, b), girdleY], [b, girdleY], culet], pav[(i * 2 + 1) % pav.length]!)
    }
    // Cyan inner fire.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = radial(ctx, 150, 150, 0, 150, 150, 50, [[0, 'rgba(103,232,249,0.55)'], [1, 'rgba(103,232,249,0)']])
    ctx.fillRect(90, 100, 120, 110)
    ctx.restore()
    // Girdle line.
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(gl, girdleY)
    ctx.lineTo(gr, girdleY)
    ctx.stroke()

    star(ctx, 96, 72, 16, '#ffffff', 0.95)
    star(ctx, 196, 150, 9, '#ffffff', 0.8)
}

function paintWild(ctx: Ctx, px: number, k: number) {
    // Head.
    ctx.save()
    glow(ctx, k, '#a3e635', 30)
    ctx.beginPath()
    ctx.moveTo(128, 18)
    ctx.bezierCurveTo(214, 18, 228, 100, 188, 146)
    ctx.quadraticCurveTo(156, 190, 128, 194)
    ctx.quadraticCurveTo(100, 190, 68, 146)
    ctx.bezierCurveTo(28, 100, 42, 18, 128, 18)
    ctx.closePath()
    ctx.fillStyle = radial(ctx, 110, 60, 6, 128, 100, 110, [[0, '#f7fee7'], [0.25, '#bef264'], [0.6, '#65a30d'], [0.9, '#1a2e05'], [1, '#0a1402']])
    ctx.fill()
    noGlow(ctx)
    ctx.clip()
    ctx.strokeStyle = 'rgba(236,252,203,0.45)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.restore()

    // Eyes.
    const eye = (x: number, rot: number) => {
        ctx.save()
        ctx.translate(x, 104)
        ctx.rotate(rot)
        ctx.beginPath()
        ctx.ellipse(0, 0, 34, 17, 0, 0, Math.PI * 2)
        ctx.fillStyle = radial(ctx, -6, -6, 2, 0, 0, 36, [[0, '#1e1b4b'], [0.6, '#020617'], [1, '#000000']])
        ctx.fill()
        ctx.strokeStyle = 'rgba(45,212,191,0.55)'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.beginPath()
        ctx.ellipse(-12, -6, 7, 4, -0.3, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(94,234,212,0.7)'
        ctx.beginPath()
        ctx.arc(10, 6, 2.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
    }
    eye(90, 0.45)
    eye(166, -0.45)

    // Mouth.
    ctx.strokeStyle = 'rgba(26,46,5,0.8)'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(116, 156)
    ctx.quadraticCurveTo(128, 162, 140, 156)
    ctx.stroke()

    // WILD banner.
    ctx.save()
    glow(ctx, k, '#d946ef', 16)
    roundRect(ctx, 30, 176, 196, 60, 14)
    ctx.fillStyle = linear(ctx, 0, 176, 0, 236, [[0, '#c026d3'], [0.5, '#6b21a8'], [1, '#2e1065']])
    ctx.fill()
    noGlow(ctx)
    ctx.lineWidth = 4
    ctx.strokeStyle = linear(ctx, 0, 176, 0, 236, [[0, '#fef9c3'], [0.5, '#eab308'], [1, '#713f12']])
    ctx.stroke()
    ctx.restore()
    chromeText(ctx, px, k, 'WILD', 128, 208, 50, 172, [[0, '#fffbeb'], [0.4, '#fde047'], [1, '#b45309']], '#fde047', '#fef3c7')
}

function paintPortal(ctx: Ctx, px: number, k: number) {
    const cx = 128
    const cy = 106
    // Vortex.
    ctx.save()
    glow(ctx, k, '#d946ef', 36)
    ctx.beginPath()
    ctx.arc(cx, cy, 90, 0, Math.PI * 2)
    ctx.fillStyle = radial(ctx, cx, cy, 0, cx, cy, 90, [[0, '#fdf4ff'], [0.18, '#f0abfc'], [0.45, '#a21caf'], [0.75, '#3b0764'], [1, '#12021f']])
    ctx.fill()
    noGlow(ctx)
    ctx.clip()
    ctx.globalCompositeOperation = 'lighter'
    for (let arm = 0; arm < 5; arm++) {
        ctx.beginPath()
        for (let r = 4; r <= 92; r += 2) {
            const a = arm * (Math.PI * 2 / 5) + r * 0.055
            const x = cx + Math.cos(a) * r
            const y = cy + Math.sin(a) * r
            if (r === 4) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = arm % 2 ? 'rgba(103,232,249,0.4)' : 'rgba(250,232,255,0.45)'
        ctx.lineWidth = 7
        ctx.stroke()
    }
    ctx.fillStyle = radial(ctx, cx, cy, 0, cx, cy, 30, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']])
    ctx.fillRect(cx - 30, cy - 30, 60, 60)
    ctx.restore()

    // Gold ring with running lights.
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, 98, 0, Math.PI * 2)
    const cone = ctx.createConicGradient(-Math.PI / 4, cx, cy)
    const golds: [number, string][] = [[0, '#fef9c3'], [0.15, '#ca8a04'], [0.3, '#fde68a'], [0.5, '#854d0e'], [0.7, '#fde047'], [0.85, '#a16207'], [1, '#fef9c3']]
    for (const [o, c] of golds) cone.addColorStop(o, c)
    ctx.strokeStyle = cone
    ctx.lineWidth = 16
    glow(ctx, k, '#facc15', 14)
    ctx.stroke()
    noGlow(ctx)
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(66,32,6,0.8)'
    ctx.beginPath()
    ctx.arc(cx, cy, 90, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    for (let i = 0; i < 10; i++) {
        const a = i * Math.PI / 5 - Math.PI / 2
        const x = cx + Math.cos(a) * 98
        const y = cy + Math.sin(a) * 98
        glow(ctx, k, '#67e8f9', 10)
        ctx.fillStyle = i % 2 ? '#a5f3fc' : '#fdf4ff'
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fill()
    }
    noGlow(ctx)

    // BONUS plate.
    ctx.save()
    glow(ctx, k, '#22d3ee', 14)
    roundRect(ctx, 26, 186, 204, 54, 27)
    ctx.fillStyle = linear(ctx, 0, 186, 0, 240, [[0, '#312e81'], [1, '#0f0a2e']])
    ctx.fill()
    noGlow(ctx)
    ctx.lineWidth = 3.5
    ctx.strokeStyle = '#67e8f9'
    ctx.stroke()
    ctx.restore()
    chromeText(ctx, px, k, 'BONUS', 128, 214, 42, 180, [[0, '#fffbeb'], [0.45, '#fde047'], [1, '#c2410c']], '#fde047', '#fef3c7')
}

// Bonus pieces --------------------------------------------------------------

const COIN_METALS: Record<XenoCoinTier, { hi: string, mid: string, lo: string, glow: string | null, edge: string }> = {
    bronze: { hi: '#fde2c4', mid: '#c77a3a', lo: '#4a2410', glow: null, edge: '#8a4a1c' },
    silver: { hi: '#ffffff', mid: '#b8c4d6', lo: '#3b4658', glow: '#cbd5e1', edge: '#6b7a90' },
    gold: { hi: '#fffbe0', mid: '#f5c518', lo: '#6b4204', glow: '#facc15', edge: '#a16207' },
    xenium: { hi: '#ecfdf5', mid: '#34d399', lo: '#053d2c', glow: '#34d399', edge: '#059669' }
}

function paintCoin(ctx: Ctx, _px: number, k: number, tier: XenoCoinTier) {
    const m = COIN_METALS[tier]
    const c = 128
    ctx.save()
    if (m.glow) glow(ctx, k, m.glow, tier === 'xenium' ? 34 : 20)
    ctx.beginPath()
    ctx.arc(c, c, 108, 0, Math.PI * 2)
    ctx.fillStyle = linear(ctx, 40, 30, 216, 226, [[0, m.hi], [0.45, m.mid], [1, m.lo]])
    ctx.fill()
    ctx.restore()

    // Reeded edge.
    ctx.save()
    ctx.translate(c, c)
    for (let i = 0; i < 48; i++) {
        ctx.rotate(Math.PI * 2 / 48)
        ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.16)'
        ctx.fillRect(-2, -108, 4, 12)
    }
    ctx.restore()

    // Bevel and face.
    ctx.beginPath()
    ctx.arc(c, c, 92, 0, Math.PI * 2)
    ctx.fillStyle = linear(ctx, 40, 30, 216, 226, [[0, m.lo], [0.5, m.edge], [1, m.hi]])
    ctx.fill()
    ctx.beginPath()
    ctx.arc(c, c, 84, 0, Math.PI * 2)
    ctx.fillStyle = radial(ctx, 100, 90, 6, c, c, 96, [[0, m.hi], [0.5, m.mid], [1, m.edge]])
    ctx.fill()

    // Hex emblem.
    hexPath(ctx, c, c, 64)
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.stroke()
    hexPath(ctx, c, c, 58)
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'
    ctx.stroke()

    // Shine.
    ctx.save()
    ctx.beginPath()
    ctx.arc(c, c, 84, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = linear(ctx, 0, 40, 0, 130, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']])
    ctx.beginPath()
    ctx.ellipse(c - 10, 70, 80, 42, -0.25, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    if (tier !== 'bronze') star(ctx, 70, 72, 14, '#ffffff', 0.9)
}

function paintUfo(ctx: Ctx, _px: number, k: number, on: boolean) {
    ctx.translate(0, 18)
    if (on) {
        // Tractor beam.
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.beginPath()
        ctx.moveTo(92, 142)
        ctx.lineTo(164, 142)
        ctx.lineTo(236, 238)
        ctx.lineTo(20, 238)
        ctx.closePath()
        ctx.fillStyle = linear(ctx, 0, 142, 0, 238, [[0, 'rgba(167,243,208,0.8)'], [0.5, 'rgba(45,212,191,0.35)'], [1, 'rgba(45,212,191,0.02)']])
        ctx.fill()
        ctx.clip()
        for (let y = 150; y < 238; y += 14) {
            ctx.fillStyle = 'rgba(236,253,245,0.18)'
            ctx.fillRect(0, y, 256, 3)
        }
        ctx.restore()
    }

    // Dome with a tiny pilot.
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(128, 96, 50, 52, 0, Math.PI, 0)
    ctx.closePath()
    ctx.fillStyle = radial(ctx, 110, 66, 4, 128, 96, 60, [[0, 'rgba(224,242,254,0.95)'], [0.4, 'rgba(56,189,248,0.7)'], [1, 'rgba(12,74,110,0.9)']])
    ctx.fill()
    ctx.clip()
    ctx.fillStyle = radial(ctx, 124, 70, 2, 128, 80, 26, [[0, '#d9f99d'], [0.6, '#65a30d'], [1, '#1a2e05']])
    ctx.beginPath()
    ctx.ellipse(128, 82, 18, 22, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#020617'
    ctx.beginPath()
    ctx.ellipse(120, 80, 6, 3.5, 0.5, 0, Math.PI * 2)
    ctx.ellipse(136, 80, 6, 3.5, -0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.beginPath()
    ctx.ellipse(108, 64, 14, 7, -0.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // Saucer body.
    ctx.save()
    glow(ctx, k, on ? '#5eead4' : '#a78bfa', on ? 30 : 18)
    ctx.beginPath()
    ctx.ellipse(128, 118, 116, 34, 0, 0, Math.PI * 2)
    ctx.fillStyle = linear(ctx, 0, 84, 0, 152, [[0, '#f8fafc'], [0.35, '#cbd5e1'], [0.5, '#64748b'], [0.56, '#312e81'], [1, '#0b0a1f']])
    ctx.fill()
    noGlow(ctx)
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.stroke()
    ctx.restore()
    ctx.beginPath()
    ctx.ellipse(128, 136, 64, 14, 0, 0, Math.PI * 2)
    ctx.fillStyle = on
        ? radial(ctx, 128, 136, 2, 128, 136, 64, [[0, '#ecfdf5'], [0.4, '#5eead4'], [1, '#134e4a']])
        : radial(ctx, 128, 136, 2, 128, 136, 64, [[0, '#6d28d9'], [1, '#1e1b4b']])
    ctx.fill()

    // Running lights.
    const colors = ['#f472b6', '#facc15', '#22d3ee']
    for (let i = 0; i < 9; i++) {
        const t = (i + 0.5) / 9
        const a = Math.PI * (1 - t)
        const x = 128 + Math.cos(a) * 100
        const y = 120 + Math.sin(a) * 18
        const color = colors[i % 3]!
        if (on) glow(ctx, k, color, 12)
        ctx.fillStyle = on ? color : `${color}88`
        ctx.beginPath()
        ctx.arc(x, y, 5.5, 0, Math.PI * 2)
        ctx.fill()
    }
    noGlow(ctx)
}

const CORE_STYLE: Record<XenoCoreMult, { stops: [number, string][], glow: string, text: [number, string][] }> = {
    2: { stops: [[0, '#ecfeff'], [0.35, '#22d3ee'], [0.75, '#155e75'], [1, '#062a36']], glow: '#22d3ee', text: [[0, '#ffffff'], [1, '#a5f3fc']] },
    5: { stops: [[0, '#fdf4ff'], [0.35, '#e879f9'], [0.75, '#86198f'], [1, '#2e0536']], glow: '#e879f9', text: [[0, '#ffffff'], [1, '#f5d0fe']] },
    10: { stops: [[0, '#fefce8'], [0.35, '#facc15'], [0.75, '#a16207'], [1, '#3a1d02']], glow: '#facc15', text: [[0, '#ffffff'], [1, '#fef08a']] }
}

function paintCore(ctx: Ctx, px: number, k: number, mult: XenoCoreMult) {
    const s = CORE_STYLE[mult]
    ctx.save()
    glow(ctx, k, s.glow, 36)
    hexPath(ctx, 128, 128, 108, 0)
    ctx.fillStyle = radial(ctx, 128, 128, 4, 128, 128, 110, s.stops)
    ctx.fill()
    noGlow(ctx)
    ctx.lineWidth = 8
    ctx.strokeStyle = linear(ctx, 0, 20, 0, 236, [[0, '#ffffff'], [0.3, '#94a3b8'], [0.55, '#1e293b'], [0.8, '#cbd5e1'], [1, '#475569']])
    ctx.stroke()
    ctx.restore()
    for (const r of [84, 62]) {
        hexPath(ctx, 128, 128, r, 0)
        ctx.lineWidth = 2
        ctx.strokeStyle = 'rgba(255,255,255,0.28)'
        ctx.stroke()
    }
    // Arcs of energy.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 2.5
    const bolts: [number, number][][] = [
        [[128, 128], [96, 104], [108, 88], [70, 60]],
        [[128, 128], [164, 110], [150, 86], [190, 62]],
        [[128, 128], [120, 170], [140, 184], [124, 222]]
    ]
    for (const bolt of bolts) {
        ctx.beginPath()
        ctx.moveTo(bolt[0]![0], bolt[0]![1])
        for (const p of bolt.slice(1)) ctx.lineTo(p[0], p[1])
        ctx.stroke()
    }
    ctx.restore()
    chromeText(ctx, px, k, `×${mult}`, 128, 134, mult === 10 ? 84 : 96, 170, s.text, s.glow, '#ffffff')
}

// Public painters -----------------------------------------------------------

/** Paint one artwork into a new square canvas `px` pixels wide. */
export function paintXenoArt(id: XenoArtId, px: number): HTMLCanvasElement {
    const [c, ctx] = canvas(px)
    const k = px / 256
    ctx.scale(k, k)
    ctx.imageSmoothingQuality = 'high'
    switch (id) {
        case 'ten':
        case 'jack':
        case 'queen':
        case 'king':
        case 'ace':
            paintRoyal(ctx, px, k, id)
            break
        case 'bell': paintPod(ctx, px, k); break
        case 'seven': paintSeven(ctx, px, k); break
        case 'diamond': paintCrystal(ctx, px, k); break
        case 'wild': paintWild(ctx, px, k); break
        case 'bonus': paintPortal(ctx, px, k); break
        case 'coin-bronze': paintCoin(ctx, px, k, 'bronze'); break
        case 'coin-silver': paintCoin(ctx, px, k, 'silver'); break
        case 'coin-gold': paintCoin(ctx, px, k, 'gold'); break
        case 'coin-xenium': paintCoin(ctx, px, k, 'xenium'); break
        case 'ufo': paintUfo(ctx, px, k, false); break
        case 'ufo-on': paintUfo(ctx, px, k, true); break
        case 'core-2': paintCore(ctx, px, k, 2); break
        case 'core-5': paintCore(ctx, px, k, 5); break
        case 'core-10': paintCore(ctx, px, k, 10); break
    }
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

/** PNG data URL of an artwork, cached per id and size (paytable, buy card). */
export function xenoArtDataUrl(id: XenoArtId, px = 128): string {
    const key = `${id}@${px}`
    let url = urlCache.get(key)
    if (!url) {
        url = paintXenoArt(id, px).toDataURL('image/png')
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
        ctx.fillStyle = linear(ctx, 0, top, 0, top + colH, [[0, '#07031a'], [0.18, '#170c36'], [0.5, '#221247'], [0.82, '#170c36'], [1, '#07031a']])
        ctx.fill()
        ctx.save()
        ctx.clip()
        // Hex mesh.
        ctx.strokeStyle = 'rgba(167,139,250,0.07)'
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
        ctx.strokeStyle = 'rgba(192,132,252,0.22)'
        roundRect(ctx, x + 0.75, top + 0.75, colW - 1.5, colH - 1.5, 14)
        ctx.stroke()
    }
    return c
}
