// Ember Portals: painterly symbol art. Every painter draws into a 256×256
// unit space (the caller scales the context), so one painting serves the
// reel textures, the paytable and the buy dialog at any size.
//
// Lows are loose gems with a coloured aura; highs sit on ornate gold-framed
// enamel plates; the portal wild and the scatter carry the most light.
// No ink outlines: form comes from gradients, rim light, inner shadow,
// speculars and glow.

import type { EpSymbol } from '#shared/utils/gamelogic/emberportals'
import {
    GOLD,
    GOLD_SOFT,
    TAU,
    blurFill,
    blurStroke,
    circle,
    ellipse,
    fade,
    flame,
    glow,
    innerShadow,
    lin,
    mix,
    poly,
    rad,
    rimLight,
    roundRect,
    roundedPoly,
    seeded,
    sparkle,
    type Ctx,
    type Stops
} from './emberportals-paint'

export type { Ctx }

// --- portal tiers ------------------------------------------------------------------

export interface EpPortalTier {
    /** Smallest multiplier that shows this tier. */
    min: number
    name: string
    /** Metal inlay of the ring. */
    ring: string
    /** Vortex body colour. */
    core: string
    /** Halo / bloom colour. */
    glow: string
    /** Flame colours, hot to cool. */
    flames: string[]
}

export const EP_PORTAL_TIERS: EpPortalTier[] = [
    { min: 1, name: 'Ember', ring: '#ff9a2e', core: '#ff7a14', glow: '#ff8a1a', flames: ['#fffbe6', '#ffd23a', '#ff7a14', '#d6200a'] },
    { min: 5, name: 'Crimson', ring: '#ff4a5a', core: '#ff1f3d', glow: '#ff2a48', flames: ['#fff0f0', '#ff8a8a', '#ff1f3d', '#8a0020'] },
    { min: 15, name: 'Arcane', ring: '#e070ff', core: '#c23cff', glow: '#d24aff', flames: ['#fff0ff', '#ff9af0', '#c23cff', '#5a0fa8'] },
    { min: 50, name: 'Storm', ring: '#5ac8ff', core: '#2a8cff', glow: '#3aa8ff', flames: ['#f4ffff', '#8af0ff', '#2a8cff', '#1a2ab8'] },
    { min: 150, name: 'Jade', ring: '#3affb0', core: '#10e090', glow: '#2affa8', flames: ['#f4fff6', '#9affd0', '#10e090', '#067a5a'] },
    { min: 256, name: 'Celestial', ring: '#ffffff', core: '#eef4ff', glow: '#ffffff', flames: ['#ffffff', '#f4f8ff', '#d8e6ff', '#9ab4e0'] }
]

export function epPortalTierIndex(mult: number): number {
    let i = 0
    EP_PORTAL_TIERS.forEach((t, j) => { if (mult >= t.min) i = j })
    return i
}

export function epPortalTier(mult: number): EpPortalTier {
    return EP_PORTAL_TIERS[epPortalTierIndex(mult)]!
}

function tierOf(tier: number): EpPortalTier {
    return EP_PORTAL_TIERS[Math.max(0, Math.min(EP_PORTAL_TIERS.length - 1, Math.round(tier)))]!
}

// --- gem helpers -------------------------------------------------------------------

interface GemPalette {
    tip: string
    hi: string
    mid: string
    lo: string
    deep: string
}

/** A faceted crystal prism from its base to its tip: three lit faces and a cap. */
function prism(ctx: Ctx, bx: number, by: number, tx: number, ty: number, w: number, c: GemPalette, fleck: string[], seed: number) {
    const dx = tx - bx
    const dy = ty - by
    const len = Math.hypot(dx, dy)
    const ax = dx / len
    const ay = dy / len
    const nx = -ay
    const ny = ax
    const sh = 0.7
    const P = (t: number, u: number): [number, number] => [bx + dx * t + nx * w * u, by + dy * t + ny * w * u]
    const tip: [number, number] = [tx, ty]
    const outline = poly([P(0, -1), P(sh, -1), tip, P(sh, 1), P(0, 1)])

    blurFill(ctx, outline, fade(c.mid, 0.8), 16)

    const faces: { pts: [number, number][], fill: CanvasGradient | string }[] = [
        { pts: [P(0, -1), P(sh, -1), P(sh, -0.25), P(0, -0.25)], fill: lin(ctx, ...P(0, 0), ...P(sh, 0), [[0, c.deep], [1, c.lo]]) },
        { pts: [P(0, -0.25), P(sh, -0.25), P(sh, 0.4), P(0, 0.4)], fill: lin(ctx, ...P(0, 0), ...P(sh, 0), [[0, c.lo], [0.5, c.mid], [1, c.hi]]) },
        { pts: [P(0, 0.4), P(sh, 0.4), P(sh, 1), P(0, 1)], fill: lin(ctx, ...P(0, 0), ...P(sh, 0), [[0, c.mid], [1, c.tip]]) },
        { pts: [P(sh, -1), tip, P(sh, -0.25)], fill: mix(c.lo, c.mid, 0.4) },
        { pts: [P(sh, -0.25), tip, P(sh, 0.4)], fill: lin(ctx, ...P(sh, 0), ...tip, [[0, c.hi], [1, c.tip]]) },
        { pts: [P(sh, 0.4), tip, P(sh, 1)], fill: '#ffffff' }
    ]
    for (const f of faces) {
        ctx.fillStyle = f.fill
        ctx.fill(poly(f.pts))
    }

    // Inner fire and opal flecks.
    ctx.save()
    ctx.clip(outline)
    ctx.globalCompositeOperation = 'lighter'
    const [gx, gy] = P(0.2, 0.1)
    ctx.fillStyle = rad(ctx, gx, gy, len * 0.55, [[0, fade(c.tip, 0.8)], [0.5, fade(c.hi, 0.35)], [1, fade(c.hi, 0)]])
    ctx.fillRect(0, 0, 256, 256)
    const rnd = seeded(seed)
    for (let i = 0; i < 7; i++) {
        const [fx, fy] = P(0.1 + rnd() * 0.6, -0.8 + rnd() * 1.6)
        ctx.fillStyle = fade(fleck[i % fleck.length]!, 0.35 + rnd() * 0.3)
        ctx.fill(ellipse(fx, fy, 2 + rnd() * 4, 1 + rnd() * 2.5, Math.atan2(ay, ax)))
    }
    ctx.restore()

    // Facet edges catch the light.
    ctx.save()
    ctx.lineWidth = 1.4
    ctx.strokeStyle = fade(c.tip, 0.7)
    for (const u of [-0.25, 0.4]) {
        const [x0, y0] = P(0, u)
        const [x1, y1] = P(sh, u)
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
        ctx.lineTo(tx, ty)
        ctx.stroke()
    }
    ctx.lineWidth = 1.8
    ctx.strokeStyle = fade(c.deep, 0.6)
    ctx.stroke(outline)
    ctx.restore()
    rimLight(ctx, outline, fade(c.tip, 0.9), -3, 2, 3, 'lighter')
}

/** Brilliant-cut oval gem: table, star and girdle facets lit from the top left. */
function brilliant(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, c: GemPalette) {
    const outline = ellipse(cx, cy, rx, ry)
    blurFill(ctx, outline, fade(c.mid, 0.9), 18)
    ctx.fillStyle = rad(ctx, cx, cy, Math.max(rx, ry), [[0, c.hi], [0.55, c.mid], [0.85, c.lo], [1, c.deep]], cx - rx * 0.2, cy - ry * 0.25, 2)
    ctx.fill(outline)

    const n = 8
    const outer = (i: number): [number, number] => {
        const a = (i / n) * TAU - Math.PI / 2
        return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]
    }
    const table = (i: number): [number, number] => {
        const a = (i / n) * TAU - Math.PI / 2 + Math.PI / n
        return [cx + Math.cos(a) * rx * 0.46, cy + Math.sin(a) * ry * 0.46]
    }
    const light = (a: number) => (Math.cos(a - Math.PI * 1.25) + 1) / 2 // 1 facing top-left
    ctx.save()
    ctx.clip(outline)
    for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU - Math.PI / 2
        const l = light(a)
        // Kite facet between two table corners and the girdle point.
        ctx.fillStyle = mix(mix(c.deep, c.lo, 0.6), c.tip, l * 0.75)
        ctx.globalAlpha = 0.85
        ctx.fill(poly([table(i - 1), outer(i), table(i), [cx, cy]]))
        // Girdle facet.
        const l2 = light(a + Math.PI / n)
        ctx.fillStyle = mix(c.lo, c.hi, l2)
        ctx.globalAlpha = 0.75
        ctx.fill(poly([outer(i), outer(i + 1), table(i)]))
    }
    ctx.globalAlpha = 1
    const tpts = Array.from({ length: n }, (_, i) => table(i))
    ctx.fillStyle = rad(ctx, cx, cy, rx * 0.5, [[0, c.tip], [0.6, c.hi], [1, c.mid]], cx - rx * 0.15, cy - ry * 0.18, 0)
    ctx.globalAlpha = 0.9
    ctx.fill(poly(tpts))
    ctx.globalAlpha = 1
    ctx.lineWidth = 1.1
    ctx.strokeStyle = fade(c.tip, 0.55)
    for (let i = 0; i < n; i++) {
        ctx.beginPath()
        ctx.moveTo(...table(i))
        ctx.lineTo(...outer(i))
        ctx.lineTo(...table(i - 1))
        ctx.moveTo(...outer(i))
        ctx.lineTo(...outer(i + 1))
        ctx.stroke()
    }
    ctx.stroke(poly(tpts))
    // Refraction: warm light pooling at the bottom right.
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = rad(ctx, cx + rx * 0.35, cy + ry * 0.45, rx * 0.8, [[0, fade(c.hi, 0.7)], [1, fade(c.hi, 0)]])
    ctx.fillRect(0, 0, 256, 256)
    ctx.restore()
    innerShadow(ctx, outline, fade(c.deep, 0.9), 8)
    rimLight(ctx, outline, '#ffffff', 3, 4, 3, 'lighter', 0.9)
}

/** Cabochon (smooth domed stone). */
function cabochon(ctx: Ctx, cx: number, cy: number, r: number, c: GemPalette) {
    const p = circle(cx, cy, r)
    ctx.fillStyle = rad(ctx, cx, cy, r, [[0, c.tip], [0.35, c.hi], [0.75, c.mid], [1, c.deep]], cx - r * 0.35, cy - r * 0.4, 0)
    ctx.fill(p)
    ctx.save()
    ctx.clip(p)
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = rad(ctx, cx + r * 0.3, cy + r * 0.4, r * 0.7, [[0, fade(c.hi, 0.6)], [1, fade(c.hi, 0)]])
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.restore()
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fill(ellipse(cx - r * 0.35, cy - r * 0.42, r * 0.28, r * 0.16, -0.6))
    ctx.lineWidth = Math.max(1, r * 0.14)
    ctx.strokeStyle = fade(c.deep, 0.8)
    ctx.stroke(p)
}

/** A gold bezel ring around a stone. */
function bezel(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, w: number) {
    const outer = ellipse(cx, cy, rx + w, ry + w)
    const p = new Path2D()
    p.addPath(outer)
    p.ellipse(cx, cy, rx, ry, 0, 0, TAU, true)
    ctx.fillStyle = lin(ctx, cx - rx, cy - ry, cx + rx, cy + ry, GOLD)
    ctx.fill(p)
    rimLight(ctx, p, 'rgba(255,250,220,0.95)', 1.5, 2, 1.5, 'lighter')
}

// --- palettes ----------------------------------------------------------------------

const RUBY: GemPalette = { tip: '#fff0d8', hi: '#ffb04a', mid: '#ff4a26', lo: '#c0122e', deep: '#4a0418' }
const SAPPHIRE: GemPalette = { tip: '#eaf6ff', hi: '#7ac4ff', mid: '#2a6cff', lo: '#1a2aa8', deep: '#060a3a' }
const AMETHYST: GemPalette = { tip: '#fff0ff', hi: '#f0a0ff', mid: '#b34cff', lo: '#6a18c8', deep: '#22064a' }
const EMERALD: GemPalette = { tip: '#f0fff4', hi: '#8affb0', mid: '#1ed070', lo: '#0a7a44', deep: '#022a18' }
const DIAMOND: GemPalette = { tip: '#ffffff', hi: '#e8faff', mid: '#b0dcff', lo: '#6a8ac8', deep: '#26304a' }

// --- lows --------------------------------------------------------------------------

function paintEmber(ctx: Ctx) {
    glow(ctx, 128, 150, 118, 'rgba(255,80,20,0.55)')
    // Rock bed.
    const rock = new Path2D('M52 204C58 184 80 176 100 180C112 170 146 168 160 178C182 172 204 184 206 204C200 222 170 228 128 228C86 228 58 222 52 204Z')
    ctx.fillStyle = lin(ctx, 0, 170, 0, 228, [[0, '#4a2238'], [0.5, '#24101e'], [1, '#12060e']])
    ctx.fill(rock)
    rimLight(ctx, rock, 'rgba(255,140,60,0.9)', 0, 6, 5, 'lighter')
    ctx.save()
    ctx.clip(rock)
    blurStroke(ctx, new Path2D('M70 206L92 200 104 212M150 198L170 208 188 202'), 'rgba(255,120,30,0.95)', 3, 4)
    ctx.restore()

    const fleck = ['#ffe08a', '#ff5ab0', '#7affd8', '#fff6c0']
    prism(ctx, 90, 194, 58, 92, 20, RUBY, fleck, 11)
    prism(ctx, 170, 192, 204, 100, 19, RUBY, fleck, 12)
    prism(ctx, 128, 204, 126, 26, 34, RUBY, fleck, 13)
    prism(ctx, 102, 210, 82, 140, 15, RUBY, fleck, 14)
    prism(ctx, 156, 210, 180, 146, 14, RUBY, fleck, 15)
    sparkle(ctx, 142, 60, 14, '#fff6e0')
    sparkle(ctx, 70, 104, 8, '#ffe6c0', 0.8)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const [x, y, r] of [[112, 20, 3], [150, 30, 2.4], [96, 42, 2], [176, 70, 2.4]] as const) {
        ctx.fillStyle = rad(ctx, x, y, r * 3, [[0, 'rgba(255,230,160,1)'], [1, 'rgba(255,100,20,0)']])
        ctx.fill(circle(x, y, r * 3))
    }
    ctx.restore()
}

function paintRune(ctx: Ctx) {
    glow(ctx, 128, 132, 118, 'rgba(40,110,255,0.5)')
    // A carved sapphire stele with a bevelled edge and real thickness.
    const outer = new Path2D('M66 76Q66 30 128 28Q190 30 190 76L194 204Q194 222 176 222L80 222Q62 222 62 204Z')
    const side = new Path2D('M190 76L200 84 204 212Q204 230 186 230L90 230 80 222 176 222Q194 222 194 204Z')
    const face = new Path2D('M80 80Q80 44 128 42Q176 44 176 80L180 198Q180 208 170 208L86 208Q76 208 76 198Z')
    blurFill(ctx, outer, 'rgba(0,6,30,0.8)', 10, 8, 10)
    ctx.fillStyle = lin(ctx, 190, 80, 204, 230, [[0, '#10207a'], [1, '#040a30']])
    ctx.fill(side)
    // Bevel: lit from the top left.
    ctx.fillStyle = lin(ctx, 62, 28, 194, 222, [[0, '#d8f0ff'], [0.25, '#6aa8ff'], [0.55, '#2a50d0'], [1, '#081660']])
    ctx.fill(outer)
    ctx.fillStyle = rad(ctx, 128, 136, 110, [[0, '#3a8cff'], [0.4, '#1a4ad8'], [0.8, '#0c1e82'], [1, '#050c3e']], 110, 96, 8)
    ctx.fill(face)
    ctx.save()
    ctx.clip(face)
    // Crystal planes and caustics.
    const planes: [[number, number][], string][] = [
        [[[80, 44], [176, 44], [150, 96], [100, 92]], 'rgba(190,225,255,0.16)'],
        [[[76, 120], [100, 92], [96, 170], [76, 200]], 'rgba(120,180,255,0.1)'],
        [[[176, 80], [180, 200], [156, 168], [150, 96]], 'rgba(0,10,60,0.25)'],
        [[[86, 208], [170, 208], [150, 176], [100, 180]], 'rgba(90,200,255,0.16)']
    ]
    for (const [pts, col] of planes) {
        ctx.fillStyle = col
        ctx.fill(poly(pts))
    }
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = rad(ctx, 150, 184, 60, [[0, 'rgba(120,220,255,0.45)'], [1, 'rgba(60,120,255,0)']])
    ctx.fillRect(60, 110, 140, 110)
    ctx.restore()
    innerShadow(ctx, face, 'rgba(0,4,40,0.9)', 12, 3, 4)
    rimLight(ctx, outer, 'rgba(240,250,255,0.95)', 3, 4, 2.5, 'lighter')
    rimLight(ctx, face, 'rgba(120,220,255,0.8)', -4, -5, 4, 'lighter')

    // The carved rune: dark groove, bevelled lip, glowing core.
    const rune = new Path2D('M128 74V184M128 94L154 118 128 142 102 118ZM100 162L128 186 156 162M112 70L144 70')
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 17
    ctx.strokeStyle = 'rgba(210,240,255,0.35)'
    ctx.translate(1.2, 1.6)
    ctx.stroke(rune)
    ctx.translate(-1.2, -1.6)
    ctx.lineWidth = 15
    ctx.strokeStyle = '#020624'
    ctx.stroke(rune)
    ctx.restore()
    glow(ctx, 128, 128, 80, 'rgba(60,200,255,0.4)')
    blurStroke(ctx, rune, 'rgba(70,220,255,1)', 10, 12)
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = 7
    ctx.strokeStyle = '#48d8ff'
    ctx.stroke(rune)
    ctx.lineWidth = 2.6
    ctx.strokeStyle = '#f4ffff'
    ctx.stroke(rune)
    ctx.restore()
    ctx.save()
    ctx.clip(face)
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.fill(ellipse(100, 60, 22, 7, -0.35))
    ctx.restore()
    sparkle(ctx, 92, 50, 12, '#ffffff')
    sparkle(ctx, 172, 196, 8, '#bfeaff', 0.8)
}

function paintPotion(ctx: Ctx) {
    glow(ctx, 128, 158, 114, 'rgba(60,255,110,0.55)')
    const cx = 128
    const cy = 158
    const r = 62
    const nx = 16
    const dy = Math.sqrt(r * r - nx * nx)
    const flask = new Path2D()
    flask.moveTo(cx - nx, 64)
    flask.lineTo(cx - nx, cy - dy)
    flask.arc(cx, cy, r, Math.atan2(-dy, -nx), Math.atan2(-dy, nx), true)
    flask.lineTo(cx + nx, 64)
    flask.closePath()

    blurFill(ctx, ellipse(128, 222, 56, 8), 'rgba(0,30,10,0.7)', 8)
    ctx.fillStyle = 'rgba(170,255,210,0.08)'
    ctx.fill(flask)

    // Liquid.
    ctx.save()
    ctx.clip(flask)
    const top = 120
    const liquid = new Path2D()
    liquid.moveTo(40, top)
    liquid.bezierCurveTo(90, top - 8, 110, top + 8, 128, top)
    liquid.bezierCurveTo(146, top - 8, 170, top + 8, 216, top)
    liquid.lineTo(216, 240)
    liquid.lineTo(40, 240)
    liquid.closePath()
    ctx.fillStyle = rad(ctx, 128, 168, 70, [[0, '#f4ffb0'], [0.3, '#7cff5a'], [0.7, '#10b050'], [1, '#03401e']], 120, 170, 4)
    ctx.fill(liquid)
    ctx.clip(liquid)
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    const swirl = (w: number, col: string, a0: number) => {
        ctx.lineWidth = w
        ctx.strokeStyle = col
        ctx.beginPath()
        for (let t = 0; t <= 1.001; t += 0.02) {
            const a = a0 + t * 5.2
            const rr = 8 + t * 50
            const x = 128 + Math.cos(a) * rr
            const y = 166 + Math.sin(a) * rr * 0.62
            if (t === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
        }
        ctx.stroke()
    }
    swirl(9, 'rgba(210,255,150,0.35)', 0)
    swirl(5, 'rgba(255,255,220,0.35)', 2.4)
    ctx.globalCompositeOperation = 'source-over'
    swirl(6, 'rgba(0,70,30,0.3)', 4.2)
    ctx.globalCompositeOperation = 'lighter'
    const rnd = seeded(5)
    for (let i = 0; i < 12; i++) {
        const x = 90 + rnd() * 76
        const y = 132 + rnd() * 76
        const br = 1.5 + rnd() * 4
        ctx.strokeStyle = 'rgba(230,255,220,0.8)'
        ctx.lineWidth = 1.2
        ctx.stroke(circle(x, y, br))
        ctx.fillStyle = 'rgba(255,255,255,0.8)'
        ctx.fill(circle(x - br * 0.35, y - br * 0.35, br * 0.3))
    }
    ctx.restore()
    // Surface.
    ctx.save()
    ctx.clip(flask)
    ctx.fillStyle = 'rgba(210,255,170,0.55)'
    ctx.fill(ellipse(128, top, 60, 6))
    ctx.restore()

    // Glass: dark edges, rim light, window reflections.
    innerShadow(ctx, flask, 'rgba(0,50,30,0.8)', 10)
    rimLight(ctx, flask, 'rgba(230,255,240,0.95)', 3, 3, 2.5, 'lighter')
    rimLight(ctx, flask, 'rgba(160,255,190,0.7)', -5, -5, 5, 'lighter')
    ctx.save()
    ctx.clip(flask)
    ctx.fillStyle = lin(ctx, 76, 0, 100, 0, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']])
    ctx.fill(ellipse(92, 150, 9, 36, 0.28))
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fill(ellipse(168, 186, 4, 12, -0.5))
    ctx.fillRect(116, 66, 4, 36)
    ctx.restore()

    // Lip, twine, cork and wax.
    const lip = roundRect(106, 56, 44, 13, 6)
    ctx.fillStyle = lin(ctx, 0, 56, 0, 69, [[0, 'rgba(240,255,250,0.9)'], [1, 'rgba(120,180,160,0.7)']])
    ctx.fill(lip)
    const cork = roundRect(113, 24, 30, 36, 7)
    ctx.fillStyle = lin(ctx, 113, 0, 143, 0, [[0, '#7a4a22'], [0.35, '#d9a262'], [0.6, '#c08448'], [1, '#5a3214']])
    ctx.fill(cork)
    ctx.save()
    ctx.clip(cork)
    const r2 = seeded(9)
    for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(60,30,10,${(0.2 + r2() * 0.3).toFixed(2)})`
        ctx.fill(circle(113 + r2() * 30, 24 + r2() * 36, 0.8 + r2() * 1.2))
    }
    ctx.restore()
    ctx.fillStyle = lin(ctx, 0, 18, 0, 40, [[0, '#ff4a5a'], [0.6, '#b0102a'], [1, '#5a0414']])
    ctx.fill(new Path2D('M110 30Q110 18 128 18Q146 18 146 30L146 38Q140 36 138 44Q134 38 128 40Q122 36 118 44Q114 36 110 38Z'))
    ctx.fillStyle = 'rgba(255,200,200,0.6)'
    ctx.fill(ellipse(120, 24, 7, 3, -0.2))
    ctx.save()
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#c8a070'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(110, 76)
    ctx.quadraticCurveTo(128, 82, 146, 76)
    ctx.moveTo(146, 76)
    ctx.quadraticCurveTo(160, 84, 156, 100)
    ctx.moveTo(146, 77)
    ctx.quadraticCurveTo(154, 92, 164, 96)
    ctx.stroke()
    ctx.restore()
    sparkle(ctx, 88, 118, 11, '#f4ffe8')
}

function paintHourglass(ctx: Ctx) {
    glow(ctx, 128, 128, 116, 'rgba(255,170,40,0.5)')
    const glass = new Path2D('M88 60C88 104 120 112 122 128C120 144 88 152 88 196L168 196C168 152 136 144 134 128C136 112 168 104 168 60Z')
    ctx.fillStyle = 'rgba(200,225,255,0.1)'
    ctx.fill(glass)
    ctx.save()
    ctx.clip(glass)
    const sand = rad(ctx, 128, 150, 80, [[0, '#fffbe0'], [0.35, '#ffd24a'], [0.8, '#e0861a'], [1, '#a0500a']])
    ctx.fillStyle = sand
    ctx.fill(new Path2D('M86 88Q128 100 170 88L170 104Q140 116 128 128Q116 116 86 104Z'))
    ctx.fill(new Path2D('M84 198Q98 158 128 150Q158 158 172 198Z'))
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = rad(ctx, 128, 176, 44, [[0, 'rgba(255,220,120,0.7)'], [1, 'rgba(255,160,40,0)']])
    ctx.fillRect(80, 130, 96, 70)
    ctx.fillStyle = '#fff6c8'
    ctx.fillRect(126.5, 122, 3, 34)
    const rnd = seeded(3)
    for (let i = 0; i < 16; i++) {
        ctx.fillStyle = `rgba(255,250,210,${(0.4 + rnd() * 0.6).toFixed(2)})`
        ctx.fill(circle(96 + rnd() * 64, 160 + rnd() * 34, 0.8 + rnd() * 1.1))
    }
    ctx.restore()
    innerShadow(ctx, glass, 'rgba(20,30,70,0.6)', 8)
    rimLight(ctx, glass, 'rgba(240,248,255,0.9)', 3, 2, 2.5, 'lighter')
    ctx.save()
    ctx.clip(glass)
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.fill(ellipse(102, 90, 5, 20, 0.2))
    ctx.fill(ellipse(102, 172, 5, 16, -0.2))
    ctx.restore()

    // Twisted posts.
    for (const x of [76, 180]) {
        const post = roundRect(x - 6, 52, 12, 152, 5)
        ctx.fillStyle = lin(ctx, x - 6, 0, x + 6, 0, GOLD_SOFT)
        ctx.fill(post)
        ctx.save()
        ctx.clip(post)
        ctx.strokeStyle = 'rgba(90,50,8,0.55)'
        ctx.lineWidth = 2.5
        for (let y = 52; y < 210; y += 10) {
            ctx.beginPath()
            ctx.moveTo(x - 7, y)
            ctx.lineTo(x + 7, y + 7)
            ctx.stroke()
        }
        ctx.restore()
        const knob = ellipse(x, 128, 9, 7)
        ctx.fillStyle = rad(ctx, x - 2, 126, 10, [[0, '#fff8d8'], [0.5, '#f0c050'], [1, '#6b3a07']])
        ctx.fill(knob)
    }
    // Caps with molding.
    for (const [y, up] of [[36, true], [196, false]] as const) {
        const plate = roundRect(56, y, 144, 18, 8)
        const lip = roundRect(66, up ? y + 16 : y - 6, 124, 8, 4)
        ctx.fillStyle = lin(ctx, 0, y, 0, y + 18, GOLD)
        ctx.fill(plate)
        ctx.fillStyle = lin(ctx, 0, up ? y + 16 : y - 6, 0, up ? y + 24 : y + 2, GOLD_SOFT)
        ctx.fill(lip)
        rimLight(ctx, plate, 'rgba(255,250,220,1)', 0, 3, 2, 'lighter')
        ctx.fillStyle = 'rgba(80,40,4,0.5)'
        ctx.fillRect(64, y + 8, 128, 1.6)
        cabochon(ctx, 128, y + 9, 7, SAPPHIRE)
        cabochon(ctx, 84, y + 9, 3.6, RUBY)
        cabochon(ctx, 172, y + 9, 3.6, RUBY)
    }
    sparkle(ctx, 194, 40, 11, '#fffbe8')
}

// --- highs: big standalone objects with an aura -------------------------------------

/** Aura behind a high symbol, then its painting scaled up about (128, cy). */
function high(ctx: Ctx, aura: string, scale: number, cy: number, draw: () => void) {
    glow(ctx, 128, 128, 128, aura)
    glow(ctx, 128, 128, 80, fade(aura, 0.6))
    ctx.save()
    ctx.translate(128, cy)
    ctx.scale(scale, scale)
    ctx.translate(-128, -cy)
    draw()
    ctx.restore()
}

function paintChalice(ctx: Ctx) {
    high(ctx, 'rgba(40,255,210,0.55)', 1.22, 138, () => chalice(ctx))
}

function chalice(ctx: Ctx) {
    blurFill(ctx, ellipse(128, 220, 50, 9), 'rgba(0,20,20,0.8)', 8)
    glow(ctx, 128, 110, 90, 'rgba(255,200,90,0.45)')

    const gold = (x0: number, x1: number) => lin(ctx, x0, 0, x1, 0, GOLD)
    // Foot.
    const foot = new Path2D('M78 214C86 194 114 188 120 170L136 170C142 188 170 194 178 214Q128 228 78 214Z')
    ctx.fillStyle = gold(78, 178)
    ctx.fill(foot)
    rimLight(ctx, foot, 'rgba(255,250,220,1)', 1, 3, 2, 'lighter')
    // Stem and knop.
    const stem = new Path2D('M118 144H138L134 176H122Z')
    ctx.fillStyle = gold(116, 140)
    ctx.fill(stem)
    const knop = ellipse(128, 160, 20, 10)
    ctx.fillStyle = gold(108, 148)
    ctx.fill(knop)
    rimLight(ctx, knop, 'rgba(255,250,220,1)', 0, 2, 1.5, 'lighter')
    cabochon(ctx, 128, 160, 5.5, SAPPHIRE)

    // Bowl.
    const bowl = new Path2D('M60 66C60 126 92 150 128 150C164 150 196 126 196 66Z')
    ctx.fillStyle = gold(60, 196)
    ctx.fill(bowl)
    ctx.save()
    ctx.clip(bowl)
    ctx.fillStyle = lin(ctx, 0, 66, 0, 150, [[0, 'rgba(255,255,255,0)'], [0.7, 'rgba(0,0,0,0)'], [1, 'rgba(60,20,0,0.5)']])
    ctx.fillRect(60, 66, 136, 84)
    // Engraved bands.
    ctx.fillStyle = 'rgba(80,36,2,0.55)'
    ctx.fillRect(56, 88, 144, 2)
    ctx.fillRect(56, 116, 144, 2)
    ctx.fillStyle = 'rgba(255,245,200,0.6)'
    ctx.fillRect(56, 90, 144, 1)
    ctx.fillRect(56, 118, 144, 1)
    ctx.restore()
    rimLight(ctx, bowl, 'rgba(255,250,225,1)', 3, 0, 3, 'lighter')
    // Jewels band.
    cabochon(ctx, 96, 103, 8, EMERALD)
    cabochon(ctx, 160, 103, 8, EMERALD)
    bezel(ctx, 128, 103, 13, 11, 3)
    brilliant(ctx, 128, 103, 13, 11, RUBY)
    // Specular streak.
    ctx.save()
    ctx.clip(bowl)
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = lin(ctx, 76, 0, 92, 0, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,240,0.85)'], [1, 'rgba(255,255,255,0)']])
    ctx.fill(ellipse(84, 104, 6, 34, 0.12))
    ctx.restore()
    // Rim and wine.
    const rim = ellipse(128, 66, 68, 14)
    ctx.fillStyle = gold(60, 196)
    ctx.fill(rim)
    const wine = ellipse(128, 66, 60, 10)
    ctx.fillStyle = rad(ctx, 128, 66, 60, [[0, '#ff4a6a'], [0.6, '#a00c2e'], [1, '#3a0210']], 110, 62, 0)
    ctx.fill(wine)
    ctx.save()
    ctx.clip(wine)
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = 'rgba(255,190,200,0.55)'
    ctx.fill(ellipse(106, 63, 24, 3.5))
    ctx.restore()
    rimLight(ctx, rim, 'rgba(255,252,230,1)', 0, 2, 1.5, 'lighter')
    sparkle(ctx, 78, 70, 14, '#fffbe8')
    sparkle(ctx, 180, 126, 9, '#fffbe8', 0.8)
}

function paintAmulet(ctx: Ctx) {
    high(ctx, 'rgba(180,80,255,0.6)', 1.3, 146, () => amulet(ctx))
}

function amulet(ctx: Ctx) {
    // Bail.
    const bail = new Path2D()
    bail.ellipse(128, 64, 11, 14, 0, 0, TAU)
    bail.ellipse(128, 64, 5, 8, 0, 0, TAU, true)
    ctx.fillStyle = lin(ctx, 116, 50, 140, 78, GOLD)
    ctx.fill(bail)

    // Scalloped filigree setting.
    blurFill(ctx, ellipse(128, 146, 66, 74), 'rgba(0,0,20,0.7)', 10, 0, 5)
    for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU
        const x = 128 + Math.cos(a) * 60
        const y = 146 + Math.sin(a) * 68
        const lit = (Math.cos(a - Math.PI * 1.25) + 1) / 2
        ctx.fillStyle = rad(ctx, x - 2, y - 2, 11, [[0, mix('#d49a38', '#fffbe0', lit)], [0.6, '#e0a83a'], [1, '#6b3a07']])
        ctx.fill(circle(x, y, 10))
    }
    const setting = ellipse(128, 146, 60, 68)
    ctx.fillStyle = lin(ctx, 68, 78, 188, 214, GOLD)
    ctx.fill(setting)
    rimLight(ctx, setting, 'rgba(255,252,230,1)', 2, 3, 2, 'lighter')
    // Diamonds around the stone.
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + Math.PI / 8
        cabochon(ctx, 128 + Math.cos(a) * 52, 146 + Math.sin(a) * 60, 4.2, DIAMOND)
    }
    brilliant(ctx, 128, 146, 40, 48, AMETHYST)
    sparkle(ctx, 110, 120, 16, '#ffffff')
    sparkle(ctx, 170, 96, 9, '#fff0ff', 0.8)
}

function paintGrimoire(ctx: Ctx) {
    high(ctx, 'rgba(255,60,170,0.55)', 1.2, 134, () => grimoire(ctx))
}

function grimoire(ctx: Ctx) {
    blurFill(ctx, poly([[66, 58], [208, 70], [204, 232], [60, 220]]), 'rgba(0,0,0,0.75)', 10, 4, 6)

    // Page block.
    const pages = poly([[184, 50], [208, 66], [204, 224], [178, 206]])
    ctx.fillStyle = lin(ctx, 184, 0, 208, 0, [[0, '#d8c090'], [1, '#fff4d8']])
    ctx.fill(pages)
    const bottom = poly([[60, 198], [178, 206], [204, 224], [82, 218]])
    ctx.fillStyle = lin(ctx, 0, 198, 0, 224, [[0, '#fff0c8'], [1, '#c8a060']])
    ctx.fill(bottom)
    ctx.save()
    ctx.clip(pages)
    ctx.strokeStyle = 'rgba(200,140,40,0.55)'
    ctx.lineWidth = 0.8
    for (let x = 186; x < 208; x += 2.2) {
        ctx.beginPath()
        ctx.moveTo(x, 50)
        ctx.lineTo(x - 4, 220)
        ctx.stroke()
    }
    ctx.restore()
    // Gilded page edge glow.
    blurStroke(ctx, new Path2D('M208 66L204 224'), 'rgba(255,210,90,0.9)', 2, 4)

    // Leather cover.
    const cover = roundedPoly([[62, 42], [184, 50], [178, 206], [58, 198]], 8)
    ctx.fillStyle = lin(ctx, 62, 42, 178, 206, [[0, '#ff4a9a'], [0.35, '#c0156a'], [0.75, '#7a0840'], [1, '#3a0220']])
    ctx.fill(cover)
    ctx.save()
    ctx.clip(cover)
    const rnd = seeded(21)
    for (let i = 0; i < 260; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,200,230,0.07)' : 'rgba(40,0,20,0.12)'
        ctx.fill(circle(58 + rnd() * 128, 42 + rnd() * 166, 0.6 + rnd() * 1.4))
    }
    // Spine bands on the left edge.
    ctx.fillStyle = 'rgba(30,0,14,0.45)'
    ctx.fillRect(56, 40, 12, 170)
    for (const y of [70, 120, 170]) {
        ctx.fillStyle = 'rgba(255,170,210,0.35)'
        ctx.fillRect(56, y, 12, 2)
        ctx.fillStyle = 'rgba(30,0,14,0.6)'
        ctx.fillRect(56, y + 2, 12, 3)
    }
    ctx.restore()
    // Embossed border.
    const border = roundedPoly([[76, 56], [172, 62], [168, 192], [72, 186]], 6)
    ctx.save()
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(40,0,20,0.6)'
    ctx.translate(1, 1.5)
    ctx.stroke(border)
    ctx.translate(-2, -3)
    ctx.strokeStyle = 'rgba(255,160,210,0.45)'
    ctx.lineWidth = 1.5
    ctx.stroke(border)
    ctx.restore()
    innerShadow(ctx, cover, 'rgba(20,0,10,0.8)', 10)
    rimLight(ctx, cover, 'rgba(255,190,225,0.85)', 2, 3, 2.5, 'lighter')

    // Gold corner guards.
    const corner = (x: number, y: number, sx: number, sy: number) => {
        const p = new Path2D(`M${x} ${y}L${x + 34 * sx} ${y + 2 * sy}Q${x + 20 * sx} ${y + 8 * sy} ${x + 12 * sx} ${y + 12 * sy}Q${x + 8 * sx} ${y + 20 * sy} ${x + 2 * sx} ${y + 34 * sy}Z`)
        ctx.fillStyle = lin(ctx, x, y, x + 34 * sx, y + 34 * sy, GOLD)
        ctx.fill(p)
        rimLight(ctx, p, 'rgba(255,250,220,1)', 1.2 * sx, 1.2 * sy, 1.5, 'lighter')
        cabochon(ctx, x + 8 * sx, y + 8 * sy, 3.4, AMETHYST)
    }
    corner(62, 42, 1, 1)
    corner(184, 50, -1, 1)
    corner(58, 198, 1, -1)
    corner(178, 206, -1, -1)
    // Clasp.
    const clasp = new Path2D('M170 106L196 108 196 140 168 138Z')
    ctx.fillStyle = lin(ctx, 168, 106, 196, 140, GOLD)
    ctx.fill(clasp)
    rimLight(ctx, clasp, 'rgba(255,250,220,1)', 1, 2, 1.5, 'lighter')

    // Glowing sigil.
    const cx = 118
    const cy = 124
    glow(ctx, cx, cy, 64, 'rgba(255,200,90,0.75)')
    const sigil = new Path2D()
    sigil.arc(cx, cy, 34, 0, TAU)
    sigil.moveTo(cx + 24, cy)
    sigil.arc(cx, cy, 24, 0, TAU)
    for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU - Math.PI / 2
        const b = a + TAU / 3
        sigil.moveTo(cx + Math.cos(a) * 24, cy + Math.sin(a) * 24)
        sigil.lineTo(cx + Math.cos(b) * 24, cy + Math.sin(b) * 24)
    }
    sigil.moveTo(cx + 7, cy + 3)
    sigil.arc(cx, cy + 3, 7, 0, TAU)
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU
        sigil.moveTo(cx + Math.cos(a) * 36, cy + Math.sin(a) * 36)
        sigil.lineTo(cx + Math.cos(a) * 42, cy + Math.sin(a) * 42)
    }
    blurStroke(ctx, sigil, 'rgba(255,190,60,1)', 5, 10)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineWidth = 3
    ctx.strokeStyle = '#ffd86a'
    ctx.stroke(sigil)
    ctx.lineWidth = 1.2
    ctx.strokeStyle = '#ffffff'
    ctx.stroke(sigil)
    ctx.restore()
    glow(ctx, cx, cy, 14, 'rgba(255,255,230,0.95)')
    sparkle(ctx, 80, 58, 12, '#ffffff', 0.9)
}

function paintPhoenix(ctx: Ctx) {
    glow(ctx, 128, 128, 128, 'rgba(255,90,20,0.7)')
    glow(ctx, 120, 100, 80, 'rgba(255,200,80,0.45)')
    const fire = (x0: number, y0: number, x1: number, y1: number, tone: number) => lin(ctx, x0, y0, x1, y1, [
        [0, mix('#fff2b0', '#ffb030', tone)],
        [0.35, mix('#ffc040', '#ff5a14', tone)],
        [0.75, mix('#ff5a14', '#c0100e', tone)],
        [1, fade(mix('#d0200a', '#5a0006', tone), 0)]
    ])

    // Flame feathers streaming back off the head and neck: deep crimson first, gold last.
    const plumes: [number, number, number, number, number, number, number][] = [
        // x0, y0, x1, y1, width, sway, tone
        [150, 190, 252, 236, 20, 16, 1], [160, 150, 254, 170, 22, -14, 1], [150, 110, 250, 104, 22, 16, 1],
        [140, 70, 238, 26, 20, -14, 1], [150, 170, 246, 206, 16, -10, 0.6], [150, 128, 252, 138, 17, 12, 0.6],
        [142, 92, 248, 66, 16, -12, 0.6], [132, 62, 206, 6, 15, 10, 0.5], [120, 60, 164, 2, 12, -8, 0.3],
        [148, 150, 232, 150, 11, 8, 0.2], [140, 108, 230, 96, 11, -8, 0.15], [132, 78, 222, 44, 10, 8, 0.1]
    ]
    for (const [x0, y0, x1, y1, w, sway, tone] of plumes) {
        const p = flame(x0, y0, x1, y1, w, sway)
        ctx.fillStyle = fire(x0, y0, x1, y1, tone)
        ctx.fill(p)
        ctx.save()
        ctx.clip(p)
        ctx.strokeStyle = fade('#fff4c0', 0.5 - tone * 0.3)
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.quadraticCurveTo((x0 + x1) / 2 + sway * 0.4, (y0 + y1) / 2 - sway * 0.3, x1, y1)
        ctx.stroke()
        ctx.restore()
    }

    // Neck sweeping down and back.
    const neck = new Path2D('M104 118C104 150 112 190 126 226C140 244 168 248 196 232C184 196 176 160 168 120C164 90 150 70 130 66Z')
    ctx.fillStyle = lin(ctx, 110, 80, 190, 244, [[0, '#ffc23a'], [0.4, '#ff6a14'], [0.8, '#b8100c'], [1, '#6a0608']])
    ctx.fill(neck)
    ctx.save()
    ctx.clip(neck)
    for (let row = 6; row >= 0; row--) {
        for (let i = 0; i < 3; i++) {
            const x = 112 + i * 20 + row * 6 + (row % 2) * 8
            const y = 112 + row * 22
            const t = row / 7
            ctx.fillStyle = lin(ctx, x, y, x + 24, y + 30, [[0, mix('#ffe070', '#ff7a1a', t)], [0.6, mix('#ff7a1a', '#c0180c', t)], [1, fade('#8a0808', 0)]])
            ctx.fill(flame(x, y, x + 26, y + 32, 10, 4))
        }
    }
    ctx.restore()
    innerShadow(ctx, neck, 'rgba(80,0,0,0.8)', 12, 4, 0)

    // Head.
    const head = new Path2D('M92 94C96 70 116 54 140 56C162 58 174 76 170 98C166 118 148 128 126 128C112 128 100 122 94 112Z')
    ctx.fillStyle = rad(ctx, 132, 84, 52, [[0, '#fff6c8'], [0.35, '#ffd24a'], [0.75, '#ff7a14'], [1, '#c01a0a']], 124, 74, 4)
    ctx.fill(head)
    innerShadow(ctx, head, 'rgba(150,20,0,0.8)', 10, 4, 5)
    rimLight(ctx, head, 'rgba(255,255,235,1)', 3, 4, 2.5, 'lighter')

    // Crest flames rising off the crown.
    for (const [x0, y0, x1, y1, w] of [[130, 60, 170, 4, 9], [142, 58, 196, 10, 9], [152, 62, 218, 26, 8]] as const) {
        const p = flame(x0, y0, x1, y1, w, -6)
        ctx.fillStyle = fire(x0, y0, x1, y1, 0)
        ctx.fill(p)
        rimLight(ctx, p, 'rgba(255,255,220,0.9)', 1, 2, 1.5, 'lighter')
    }

    // Sharp hooked beak.
    const upper = new Path2D('M102 78C86 78 64 86 50 102C42 110 40 124 46 130C50 122 56 116 64 112C76 106 90 104 106 104C110 96 108 84 102 78Z')
    ctx.fillStyle = lin(ctx, 44, 78, 106, 130, [[0, '#fff4c8'], [0.35, '#ffd060'], [0.75, '#c87a18'], [1, '#6a3006']])
    ctx.fill(upper)
    innerShadow(ctx, upper, 'rgba(100,40,0,0.7)', 5, -2, -3)
    rimLight(ctx, upper, 'rgba(255,255,255,1)', 1.5, 2.5, 1.5, 'lighter')
    const lower = new Path2D('M104 108C92 108 78 112 68 118C74 124 88 124 106 118Z')
    ctx.fillStyle = lin(ctx, 68, 108, 106, 124, [[0, '#d09040'], [1, '#5a2804']])
    ctx.fill(lower)
    ctx.fillStyle = 'rgba(90,30,0,0.8)'
    ctx.fill(ellipse(88, 90, 3, 1.6, -0.3))

    // Blazing eye with a dark mask streak.
    const mask = new Path2D('M104 90C114 80 132 78 170 86C146 88 132 94 118 102Z')
    ctx.fillStyle = 'rgba(90,6,0,0.9)'
    ctx.fill(mask)
    const eye = ellipse(122, 90, 10, 6.5, -0.2)
    blurFill(ctx, eye, 'rgba(255,240,140,1)', 10)
    ctx.fillStyle = rad(ctx, 122, 90, 10, [[0, '#ffffff'], [0.45, '#fff07a'], [1, '#ff9a1a']])
    ctx.fill(eye)
    ctx.fillStyle = '#1a0200'
    ctx.fill(ellipse(120, 90, 3.2, 5.2, -0.2))
    ctx.fillStyle = '#ffffff'
    ctx.fill(circle(124, 87, 2))

    // Loose flames and embers licking upward.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const rnd = seeded(33)
    for (let i = 0; i < 14; i++) {
        const x = 110 + rnd() * 130
        const y = 40 + rnd() * 190
        const p = flame(x, y, x + 12 + rnd() * 14, y - 22 - rnd() * 22, 4 + rnd() * 4, (rnd() - 0.5) * 12)
        ctx.fillStyle = lin(ctx, x, y, x, y - 44, [[0, 'rgba(255,220,110,0.55)'], [1, 'rgba(255,90,20,0)']])
        ctx.fill(p)
    }
    for (let i = 0; i < 10; i++) {
        const x = 20 + rnd() * 220
        const y = 10 + rnd() * 236
        ctx.fillStyle = rad(ctx, x, y, 4, [[0, 'rgba(255,240,180,1)'], [1, 'rgba(255,120,30,0)']])
        ctx.fill(circle(x, y, 4))
    }
    ctx.restore()
    sparkle(ctx, 58, 98, 10, '#ffffff', 0.9)
    sparkle(ctx, 160, 60, 9, '#fff6d0', 0.8)
}

// --- portal ------------------------------------------------------------------------

/** Swirling vortex in the tier's colours; dark in the eye so a number reads on top. */
export function paintEpPortalCoreVector(ctx: Ctx, tier = 0) {
    const t = tierOf(tier)
    const [hot, warm, body, cool] = [t.flames[0]!, t.flames[1]!, t.flames[2]!, t.flames[3] ?? t.flames[2]!]

    // Accretion disc: dark eye, bright toward the lip, fading at the edge.
    ctx.fillStyle = rad(ctx, 128, 128, 128, [[0, 'rgba(4,0,10,1)'], [0.3, fade(cool, 0.95)], [0.5, fade(body, 0.95)], [0.72, fade(warm, 0.75)], [0.9, fade(body, 0.35)], [1, fade(body, 0)]])
    ctx.fill(circle(128, 128, 128))

    // Spiral filaments, thick and hot near the eye, thin and cool outside.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    const arms = 9
    const rnd = seeded(tier * 17 + 5)
    for (let arm = 0; arm < arms; arm++) {
        const base = (arm / arms) * TAU + rnd() * 0.3
        const spin = 2.4 + rnd() * 0.6
        let px = 0
        let py = 0
        for (let s = 0; s <= 36; s++) {
            const u = s / 36
            const r = 40 + u * 84
            const a = base - u * spin
            const x = 128 + Math.cos(a) * r
            const y = 128 + Math.sin(a) * r
            if (s) {
                const k = 1 - u
                ctx.lineWidth = 3 + k * 13
                ctx.strokeStyle = fade(body, 0.16 * k + 0.04)
                ctx.beginPath()
                ctx.moveTo(px, py)
                ctx.lineTo(x, y)
                ctx.stroke()
                ctx.lineWidth = 1 + k * 5
                ctx.strokeStyle = fade(warm, 0.35 * k + 0.05)
                ctx.stroke()
                ctx.lineWidth = 0.6 + k * 1.8
                ctx.strokeStyle = fade(hot, 0.55 * k)
                ctx.stroke()
            }
            px = x
            py = y
        }
    }
    // Sparks being drawn in.
    for (let i = 0; i < 36; i++) {
        const r = 44 + rnd() * 80
        const a = rnd() * TAU
        const x = 128 + Math.cos(a) * r
        const y = 128 + Math.sin(a) * r
        const s = 2 + rnd() * 4
        ctx.fillStyle = rad(ctx, x, y, s, [[0, fade(hot, 1)], [1, fade(warm, 0)]])
        ctx.fill(circle(x, y, s))
    }
    ctx.restore()

    // Dark eye with a white-hot event horizon.
    ctx.fillStyle = rad(ctx, 128, 128, 50, [[0, 'rgba(2,0,6,0.98)'], [0.7, 'rgba(6,0,12,0.9)'], [1, 'rgba(6,0,12,0)']])
    ctx.fill(circle(128, 128, 50))
    const lip = circle(128, 128, 42)
    blurStroke(ctx, lip, fade(warm, 1), 6, 10)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = 2.5
    ctx.strokeStyle = fade(hot, 0.9)
    ctx.stroke(lip)
    ctx.restore()
    ctx.fillStyle = rad(ctx, 128, 128, 40, [[0, 'rgba(2,0,6,0.9)'], [0.8, 'rgba(2,0,6,0.6)'], [1, 'rgba(2,0,6,0)']])
    ctx.fill(circle(128, 128, 40))
}

/**
 * The portal rim: carved dark stone with a glowing metal inlay, a white-hot
 * inner lip and flames licking outward in the tier's colours. Painted to be
 * drawn ~1.3× the cell: the ring spans r 60-84 (of 128) and the flames and
 * bloom reach the edge. The hole (r < 60) stays clear for the vortex.
 */
export function paintEpPortalRingVector(ctx: Ctx, tier = 0) {
    const t = tierOf(tier)
    const [hot, warm, body, cool] = [t.flames[0]!, t.flames[1]!, t.flames[2]!, t.flames[3] ?? t.flames[2]!]
    const R0 = 60
    const R1 = 84
    const outside = new Path2D()
    outside.rect(0, 0, 256, 256)
    outside.arc(128, 128, R0 - 2, 0, TAU, true)

    ctx.save()
    ctx.clip(outside)
    // Bloom halo and a soft corona band.
    glow(ctx, 128, 128, 128, fade(t.glow, 0.95))
    blurStroke(ctx, circle(128, 128, 96), fade(body, 0.9), 22, 14)

    // Flame corona: three layers, long and cool to short and hot.
    const rnd = seeded(tier * 31 + 7)
    const tongues = (n: number, inner: number, reach: number, w: number, stops: Stops, jitter: number) => {
        for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU + rnd() * 0.15
            const len = reach * (1 - jitter + rnd() * jitter)
            const a1 = a + 0.3 + rnd() * 0.15
            const x0 = 128 + Math.cos(a) * inner
            const y0 = 128 + Math.sin(a) * inner
            const x1 = 128 + Math.cos(a1) * (inner + len)
            const y1 = 128 + Math.sin(a1) * (inner + len)
            ctx.fillStyle = lin(ctx, x0, y0, x1, y1, stops)
            ctx.fill(flame(x0, y0, x1, y1, w * (0.8 + rnd() * 0.5), w * 0.9))
        }
    }
    ctx.globalCompositeOperation = 'lighter'
    tongues(14, 80, 48, 16, [[0, fade(body, 0.95)], [0.55, fade(cool, 0.7)], [1, fade(cool, 0)]], 0.35)
    tongues(18, 82, 36, 11, [[0, fade(warm, 1)], [0.5, fade(body, 0.85)], [1, fade(body, 0)]], 0.4)
    tongues(22, 83, 24, 7, [[0, fade(hot, 1)], [0.55, fade(warm, 0.9)], [1, fade(warm, 0)]], 0.4)
    ctx.restore()

    // Stone ring.
    const ring = new Path2D()
    ring.arc(128, 128, R1, 0, TAU)
    ring.arc(128, 128, R0, 0, TAU, true)
    blurFill(ctx, ring, 'rgba(0,0,0,0.7)', 5, 0, 3)
    ctx.fillStyle = rad(ctx, 128, 128, R1, [[0.7, '#1c1224'], [0.82, '#3e2e4c'], [0.94, '#241830'], [1, '#120a18']])
    ctx.fill(ring)
    ctx.save()
    ctx.clip(ring)
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.lineWidth = 2
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + 0.13
        ctx.beginPath()
        ctx.moveTo(128 + Math.cos(a) * R0, 128 + Math.sin(a) * R0)
        ctx.lineTo(128 + Math.cos(a) * R1, 128 + Math.sin(a) * R1)
        ctx.stroke()
    }
    // Firelight catching both edges of the stone.
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = rad(ctx, 128, 128, R1, [[R0 / R1, fade(warm, 0.6)], [0.8, fade(body, 0.06)], [0.93, fade(body, 0.06)], [1, fade(warm, 0.5)]])
    ctx.fill(ring)
    ctx.restore()

    // Glowing metal inlay carrying runes.
    const inlay = circle(128, 128, 72)
    blurStroke(ctx, inlay, fade(t.glow, 1), 4, 7)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = 2.2
    ctx.strokeStyle = t.ring
    ctx.stroke(inlay)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const glyphs = ['M-4 -5L0 5 4 -5', 'M0 -6V6M-4 -2L0 -6 4 -2', 'M-4 -5H4L-4 5H4', 'M-3 -6V6M-3 0L4 -5M-3 0L4 5', 'M0 -6L4 0 0 6 -4 0Z', 'M-4 6V-6L4 6V-6']
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU - Math.PI / 2 + 0.13 + TAU / 24
        ctx.save()
        ctx.translate(128 + Math.cos(a) * 72, 128 + Math.sin(a) * 72)
        ctx.rotate(a + Math.PI / 2)
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = 'rgba(12,6,18,0.95)'
        ctx.fill(roundRect(-6, -7.5, 12, 15, 2))
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineWidth = 3.4
        ctx.strokeStyle = fade(body, 0.9)
        ctx.stroke(new Path2D(glyphs[i % glyphs.length]!))
        ctx.lineWidth = 1.3
        ctx.strokeStyle = hot
        ctx.stroke(new Path2D(glyphs[i % glyphs.length]!))
        ctx.restore()
    }
    ctx.restore()

    // White-hot inner lip and a hot outer edge.
    const lip = circle(128, 128, R0 + 1)
    blurStroke(ctx, lip, fade(warm, 1), 10, 12)
    blurStroke(ctx, circle(128, 128, R1), fade(warm, 0.9), 3, 6)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = 5
    ctx.strokeStyle = fade(body, 0.9)
    ctx.stroke(lip)
    ctx.lineWidth = 2.4
    ctx.strokeStyle = '#ffffff'
    ctx.stroke(lip)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = fade(hot, 0.8)
    ctx.stroke(circle(128, 128, R1))
    ctx.restore()

    for (let i = 0; i < 6; i++) {
        const a = rnd() * TAU
        const r = 92 + rnd() * 28
        sparkle(ctx, 128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 4 + rnd() * 5, hot, 0.9)
    }
}

function paintWild(ctx: Ctx) {
    // A cell-sized wild: core under the ring, both scaled up a touch.
    ctx.save()
    ctx.translate(128, 128)
    ctx.scale(1.08, 1.08)
    ctx.translate(-128, -128)
    ctx.save()
    ctx.translate(128, 128)
    ctx.scale(64 / 128, 64 / 128)
    ctx.translate(-128, -128)
    paintEpPortalCoreVector(ctx, 0)
    ctx.restore()
    paintEpPortalRingVector(ctx, 0)
    ctx.restore()
}

// --- scatter -----------------------------------------------------------------------

function paintScatter(ctx: Ctx) {
    // Blazing corona.
    glow(ctx, 128, 128, 128, 'rgba(255,190,60,0.95)')
    glow(ctx, 128, 128, 100, 'rgba(90,255,240,0.35)')
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU
        const len = i % 2 ? 104 : 126
        const w = i % 2 ? 0.05 : 0.08
        ctx.fillStyle = rad(ctx, 128, 128, len, [[0.3, 'rgba(255,250,220,0.9)'], [0.7, 'rgba(255,200,80,0.45)'], [1, 'rgba(255,120,20,0)']])
        ctx.beginPath()
        ctx.moveTo(128 + Math.cos(a - w * 3) * 50, 128 + Math.sin(a - w * 3) * 50)
        ctx.lineTo(128 + Math.cos(a) * len, 128 + Math.sin(a) * len)
        ctx.lineTo(128 + Math.cos(a + w * 3) * 50, 128 + Math.sin(a + w * 3) * 50)
        ctx.closePath()
        ctx.fill()
    }
    const rnd = seeded(77)
    for (let i = 0; i < 22; i++) {
        const a = (i / 22) * TAU + rnd() * 0.1
        const x0 = 128 + Math.cos(a) * 62
        const y0 = 128 + Math.sin(a) * 62
        const r1 = 86 + rnd() * 26
        const x1 = 128 + Math.cos(a + 0.2) * r1
        const y1 = 128 + Math.sin(a + 0.2) * r1
        ctx.fillStyle = lin(ctx, x0, y0, x1, y1, [[0, 'rgba(255,240,170,1)'], [0.5, 'rgba(255,140,30,0.8)'], [1, 'rgba(220,40,10,0)']])
        ctx.fill(flame(x0, y0, x1, y1, 9, 6))
    }
    ctx.restore()

    // Sun disc.
    const disc = circle(128, 128, 68)
    ctx.fillStyle = rad(ctx, 128, 128, 68, [[0, '#fffef0'], [0.4, '#ffe57a'], [0.8, '#ff9a1a'], [1, '#d0400a']], 116, 112, 4)
    ctx.fill(disc)
    ctx.save()
    ctx.clip(disc)
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (let i = 0; i < 5; i++) {
        ctx.strokeStyle = 'rgba(255,255,220,0.35)'
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.arc(128, 128, 24 + i * 9, i * 1.4, i * 1.4 + 2.2)
        ctx.stroke()
    }
    ctx.restore()
    innerShadow(ctx, disc, 'rgba(160,30,0,0.7)', 10)

    // The eye: dark almond with a glowing teal iris.
    const eye = new Path2D('M70 128Q128 76 186 128Q128 180 70 128Z')
    blurFill(ctx, eye, 'rgba(255,255,230,1)', 8)
    ctx.fillStyle = rad(ctx, 128, 128, 60, [[0, '#2a0a08'], [0.8, '#12020a'], [1, '#050008']])
    ctx.fill(eye)
    ctx.save()
    ctx.clip(eye)
    const iris = circle(128, 128, 25)
    glow(ctx, 128, 128, 44, 'rgba(60,255,230,0.9)')
    ctx.fillStyle = rad(ctx, 128, 128, 25, [[0, '#fffbd0'], [0.25, '#8affea'], [0.6, '#10c8d0'], [1, '#063a6a']])
    ctx.fill(iris)
    ctx.strokeStyle = 'rgba(200,255,250,0.5)'
    ctx.lineWidth = 1
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU
        ctx.beginPath()
        ctx.moveTo(128 + Math.cos(a) * 9, 128 + Math.sin(a) * 9)
        ctx.lineTo(128 + Math.cos(a) * 24, 128 + Math.sin(a) * 24)
        ctx.stroke()
    }
    ctx.fillStyle = '#020006'
    ctx.fill(ellipse(128, 128, 5.5, 18))
    ctx.fillStyle = '#ffffff'
    ctx.fill(ellipse(137, 118, 5, 4))
    ctx.fill(circle(120, 138, 2))
    ctx.restore()
    // Gold lids.
    ctx.save()
    ctx.lineWidth = 5
    ctx.strokeStyle = lin(ctx, 70, 100, 186, 156, GOLD)
    ctx.stroke(eye)
    ctx.restore()
    rimLight(ctx, disc, 'rgba(255,255,255,1)', 3, 4, 3, 'lighter')
    sparkle(ctx, 182, 70, 16, '#ffffff')
    sparkle(ctx, 72, 188, 11, '#e8fffc', 0.9)
}

const PAINTERS: Record<EpSymbol, (ctx: Ctx) => void> = {
    ember: paintEmber,
    rune: paintRune,
    potion: paintPotion,
    hourglass: paintHourglass,
    chalice: paintChalice,
    amulet: paintAmulet,
    grimoire: paintGrimoire,
    phoenix: paintPhoenix,
    wild: paintWild,
    scatter: paintScatter
}

/** Paint a symbol into a context already scaled to the 256-unit space. */
export function paintEpSymbolVector(ctx: Ctx, id: EpSymbol) {
    PAINTERS[id](ctx)
}

/** The buy-card art: a blazing portal with its vortex and light rays. */
export function paintEpBuyVector(ctx: Ctx) {
    glow(ctx, 128, 128, 128, 'rgba(255,140,40,0.8)')
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU + 0.13
        ctx.fillStyle = rad(ctx, 128, 128, 128, [[0, 'rgba(255,220,140,0.55)'], [1, 'rgba(255,80,20,0)']])
        ctx.beginPath()
        ctx.moveTo(128, 128)
        ctx.lineTo(128 + Math.cos(a - 0.08) * 128, 128 + Math.sin(a - 0.08) * 128)
        ctx.lineTo(128 + Math.cos(a + 0.08) * 128, 128 + Math.sin(a + 0.08) * 128)
        ctx.closePath()
        ctx.fill()
    }
    ctx.restore()
    ctx.save()
    ctx.translate(128, 128)
    ctx.scale(62 / 128, 62 / 128)
    ctx.translate(-128, -128)
    paintEpPortalCoreVector(ctx, 0)
    ctx.restore()
    paintEpPortalRingVector(ctx, 0)
}
