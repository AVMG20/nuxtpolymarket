// Aether Gates artwork, drawn procedurally with Canvas 2D. Nothing is
// fetched: every symbol and multiplier orb is built
// from paths, gradients and facet shading at whatever pixel size the caller
// asks for, so it stays crisp at any device pixel ratio.
//
// Symbols draw in a unit space of [-1, 1] on both axes (see `unit`). Canvas
// shadows are specified in device pixels and ignore the transform, so every
// recipe receives `px` (device pixels per unit) to scale them.

import type { AetherSymbol } from '#shared/utils/gamelogic/aethergates'

type Ctx = CanvasRenderingContext2D
type Pt = [number, number]

export const AG_FONT = '\'Cinzel\', \'Trajan Pro\', Georgia, \'Times New Roman\', serif'

// --- symbol metadata -------------------------------------------------------

export interface AgSymbolInfo {
    name: string
    /** Accent colour for particles, glows and win text. */
    color: number
    css: string
}

export const AG_SYMBOL_INFO: Record<AetherSymbol, AgSymbolInfo> = {
    coin: { name: 'Emerald', color: 0x34d399, css: '#34d399' },
    ring: { name: 'Sapphire', color: 0x60a5fa, css: '#60a5fa' },
    chalice: { name: 'Amethyst', color: 0xc084fc, css: '#c084fc' },
    laurel: { name: 'Ruby', color: 0xfb7185, css: '#fb7185' },
    lyre: { name: 'Golden Lyre', color: 0xfcd34d, css: '#fcd34d' },
    helm: { name: 'Aegis Helm', color: 0xf87171, css: '#f87171' },
    sun: { name: 'Sun Disc', color: 0xfbbf24, css: '#fbbf24' },
    star: { name: 'Crown of Aether', color: 0xfde68a, css: '#fde68a' },
    scatter: { name: 'Aether Gate', color: 0x67e8f9, css: '#67e8f9' },
    multiplier: { name: 'Storm Orb', color: 0xa5f3fc, css: '#a5f3fc' }
}

export interface AgOrbTier {
    min: number
    hue: number
    color: number
    css: string
    label: string
}

/** Orb colour by value; the higher the value the hotter the orb. */
export const AG_ORB_TIERS: AgOrbTier[] = [
    { min: 2, hue: 158, color: 0x34d399, css: '#34d399', label: 'Jade' },
    { min: 5, hue: 212, color: 0x60a5fa, css: '#60a5fa', label: 'Azure' },
    { min: 10, hue: 276, color: 0xc084fc, css: '#c084fc', label: 'Violet' },
    { min: 25, hue: 350, color: 0xfb7185, css: '#fb7185', label: 'Crimson' },
    { min: 100, hue: 44, color: 0xfcd34d, css: '#fcd34d', label: 'Solar' }
]

export function agOrbTier(value: number): number {
    let tier = 0
    for (let i = 0; i < AG_ORB_TIERS.length; i++) if (value >= AG_ORB_TIERS[i]!.min) tier = i
    return tier
}

// --- primitives ------------------------------------------------------------

function hsl(h: number, s: number, l: number, a = 1): string {
    return `hsla(${h}, ${s}%, ${Math.max(0, Math.min(100, l))}%, ${a})`
}

function poly(pts: Pt[]): Path2D {
    const p = new Path2D()
    pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)))
    p.closePath()
    return p
}

function circle(x: number, y: number, r: number): Path2D {
    const p = new Path2D()
    p.arc(x, y, r, 0, Math.PI * 2)
    return p
}

function shadow(ctx: Ctx, px: number, blur = 0.07, y = 0.04, color = 'rgba(0,0,0,0.55)') {
    ctx.shadowColor = color
    ctx.shadowBlur = px * blur
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = px * y
}

function noShadow(ctx: Ctx) {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
}

/** Polished gold: alternating bright and dark bands down the shape. */
function gold(ctx: Ctx, y0 = -1, y1 = 1, x0 = -0.25, x1 = 0.25): CanvasGradient {
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    g.addColorStop(0, '#fffbe0')
    g.addColorStop(0.16, '#ffe486')
    g.addColorStop(0.38, '#e3a72b')
    g.addColorStop(0.55, '#8f5a12')
    g.addColorStop(0.72, '#f2c24f')
    g.addColorStop(0.88, '#ffeaa6')
    g.addColorStop(1, '#b3761a')
    return g
}

interface BevelOptions {
    depth?: number
    outline?: string
    outlineWidth?: number
    light?: string
    dark?: string
    shadow?: boolean
}

/** Fill a shape and give it a raised, bevelled edge: light top-left, dark bottom-right. */
function bevel(ctx: Ctx, path: Path2D, fill: string | CanvasGradient, px: number, opts: BevelOptions = {}) {
    const depth = opts.depth ?? 0.028
    ctx.save()
    if (opts.shadow !== false) shadow(ctx, px)
    ctx.fillStyle = fill
    ctx.fill(path)
    ctx.restore()

    ctx.save()
    ctx.clip(path)
    ctx.lineJoin = 'round'
    ctx.lineWidth = depth * 2
    ctx.strokeStyle = opts.light ?? 'rgba(255, 250, 215, 0.85)'
    ctx.translate(depth * 0.8, depth * 0.8)
    ctx.stroke(path)
    ctx.restore()

    ctx.save()
    ctx.clip(path)
    ctx.lineJoin = 'round'
    ctx.lineWidth = depth * 2
    ctx.strokeStyle = opts.dark ?? 'rgba(70, 35, 0, 0.55)'
    ctx.translate(-depth * 0.8, -depth * 0.8)
    ctx.stroke(path)
    ctx.restore()

    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineWidth = opts.outlineWidth ?? 0.022
    ctx.strokeStyle = opts.outline ?? '#2b1703'
    ctx.stroke(path)
    ctx.restore()
}

/** Shiny ball (finials, pearls). */
function sphere(ctx: Ctx, x: number, y: number, r: number, px: number, light: string, mid: string, dark: string) {
    ctx.save()
    shadow(ctx, px, 0.04, 0.02)
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.2, light)
    g.addColorStop(0.65, mid)
    g.addColorStop(1, dark)
    ctx.fillStyle = g
    ctx.fill(circle(x, y, r))
    noShadow(ctx)
    ctx.lineWidth = 0.014
    ctx.strokeStyle = 'rgba(40, 20, 0, 0.7)'
    ctx.stroke(circle(x, y, r))
    ctx.restore()
}

/** Four-point twinkle. */
function twinkle(ctx: Ctx, x: number, y: number, r: number, px: number, color = '#ffffff', alpha = 1) {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.shadowColor = color
    ctx.shadowBlur = px * r * 0.8
    ctx.fillStyle = '#ffffff'
    const w = r * 0.16
    ctx.beginPath()
    ctx.moveTo(x, y - r)
    ctx.quadraticCurveTo(x + w, y - w, x + r, y)
    ctx.quadraticCurveTo(x + w, y + w, x, y + r)
    ctx.quadraticCurveTo(x - w, y + w, x - r, y)
    ctx.quadraticCurveTo(x - w, y - w, x, y - r)
    ctx.fill()
    ctx.restore()
}

// --- faceted gems ------------------------------------------------------------

interface GemStyle {
    hue: number
    sat: number
    light: number
}

const LIGHT: Pt = [-0.56, -0.83]

function scalePts(pts: Pt[], c: Pt, k: number): Pt[] {
    return pts.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k])
}

/** Layered cuts, internal reflections and a polished edge, rendered at the
 * texture's full resolution. Facets follow the silhouette rather than noise. */
function gem(ctx: Ctx, outline: Pt[], center: Pt, style: GemStyle, px: number, rings: number[] = [1, 0.62], bezel = true) {
    const { hue, sat, light } = style
    const outer = poly(outline)
    const shoulder = scalePts(outline, center, 0.9)
    const tablePts = scalePts(outline, center, rings[1] ?? 0.62)
    const radius = Math.max(...outline.map(([x, y]) => Math.hypot(x - center[0], y - center[1])))
    ctx.save()
    shadow(ctx, px, 0.13, 0.075, hsl(hue, 80, 6, 0.75))
    ctx.fillStyle = hsl(hue, sat, light - 22)
    ctx.fill(outer)
    noShadow(ctx)

    // A slim polished girdle catches the light around the entire stone.
    const edge = ctx.createLinearGradient(-0.7, -0.9, 0.6, 0.8)
    edge.addColorStop(0, hsl(hue, 30, 96))
    edge.addColorStop(0.35, hsl(hue, sat - 20, light + 15))
    edge.addColorStop(0.65, hsl(hue, sat, light - 24))
    edge.addColorStop(1, hsl(hue, sat - 10, light + 8))
    ctx.fillStyle = edge
    ctx.fill(outer)
    const n = outline.length
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        const a = shoulder[i]!
        const b = shoulder[j]!
        const c = tablePts[i]!
        const d = tablePts[j]!
        const lightAngle = a[0] * LIGHT[0] + a[1] * LIGHT[1]
        const facet = ctx.createLinearGradient(a[0], a[1], d[0], d[1])
        facet.addColorStop(0, hsl(hue, sat - 12, light + lightAngle * 27 + 8))
        facet.addColorStop(1, hsl(hue, sat, light + lightAngle * 15 - 12))
        ctx.fillStyle = facet
        ctx.fill(poly([a, b, d, c]))
        ctx.fillStyle = hsl(hue + (i % 2 ? 5 : -5), sat, light + lightAngle * 18 + (i % 3 === 0 ? 17 : -8), 0.65)
        ctx.fill(poly([a, d, c]))
    }

    const face = ctx.createLinearGradient(-0.4, -0.7, 0.35, 0.65)
    face.addColorStop(0, hsl(hue, sat - 22, light + 31))
    face.addColorStop(0.34, hsl(hue, sat, light + 9))
    face.addColorStop(0.7, hsl(hue + 5, sat, light - 7))
    face.addColorStop(1, hsl(hue, sat, light - 23))
    ctx.fillStyle = face
    ctx.fill(poly(tablePts))
    // Offset pavilion reflections give the transparent centre depth.
    const culet: Pt = [center[0] + radius * 0.13, center[1] + radius * 0.22]
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        ctx.fillStyle = i % 3 === 0 ? 'rgba(235,250,255,0.2)' : 'rgba(6,12,40,0.1)'
        ctx.fill(poly([tablePts[i]!, tablePts[j]!, culet]))
    }
    ctx.save()
    ctx.clip(outer)
    const sheen = ctx.createLinearGradient(-0.5, -0.7, 0.45, 0.6)
    sheen.addColorStop(0, 'rgba(255,255,255,0)')
    sheen.addColorStop(0.23, 'rgba(255,255,255,0.04)')
    sheen.addColorStop(0.28, 'rgba(255,255,255,0.42)')
    sheen.addColorStop(0.31, 'rgba(255,255,255,0.08)')
    sheen.addColorStop(0.48, 'rgba(255,255,255,0)')
    ctx.fillStyle = sheen
    ctx.fillRect(-1, -1, 2, 2)
    ctx.restore()
    ctx.lineJoin = 'round'
    ctx.lineWidth = bezel ? 0.018 : 0.012
    ctx.strokeStyle = edge
    ctx.stroke(outer)
    ctx.lineWidth = 0.009
    ctx.strokeStyle = 'rgba(235,250,255,0.45)'
    ctx.stroke(poly(tablePts))
    if (radius > 0.4) {
        const top = shoulder.reduce((best, point) => point[0] + point[1] < best[0] + best[1] ? point : best, shoulder[0]!)
        twinkle(ctx, top[0], top[1], 0.065, px, '#f2fcff', 0.9)
    }
    ctx.restore()
}

function octagon(w: number, h: number, c: number, cy = 0): Pt[] {
    return [[-w + c, -h + cy], [w - c, -h + cy], [w, -h + c + cy], [w, h - c + cy], [w - c, h + cy], [-w + c, h + cy], [-w, h - c + cy], [-w, -h + c + cy]]
}

function roundGem(r: number, n: number, cx = 0, cy = 0, rot = 0): Pt[] {
    const pts: Pt[] = []
    for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2 - Math.PI / 2
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
    return pts
}

function heartGem(scale: number, cy = 0): Pt[] {
    const pts: Pt[] = []
    const n = 20
    for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2
        const x = 16 * Math.sin(t) ** 3
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
        pts.push([x / 17 * scale, (y + 2.5) / 17 * scale + cy])
    }
    return pts
}

function trillionGem(r: number, bulge: number, cy = 0): Pt[] {
    const corners: Pt[] = [0, 1, 2].map((i) => {
        const a = -Math.PI / 2 + i * (Math.PI * 2 / 3)
        return [Math.cos(a) * r, Math.sin(a) * r + cy]
    })
    const pts: Pt[] = []
    for (let i = 0; i < 3; i++) {
        const a = corners[i]!
        const b = corners[(i + 1) % 3]!
        const mx = (a[0] + b[0]) / 2
        const my = (a[1] + b[1]) / 2 - cy
        const ml = Math.hypot(mx, my) || 1
        for (let k = 0; k < 4; k++) {
            const t = k / 4
            const push = Math.sin(Math.PI * t) * bulge
            pts.push([a[0] + (b[0] - a[0]) * t + (mx / ml) * push, a[1] + (b[1] - a[1]) * t + (my / ml) * push])
        }
    }
    return pts
}

// --- symbol recipes ------------------------------------------------------------

function drawEmerald(ctx: Ctx, px: number) {
    gem(ctx, octagon(0.54, 0.74, 0.2), [0, 0], { hue: 150, sat: 78, light: 40 }, px, [1, 0.64])
}

function drawSapphire(ctx: Ctx, px: number) {
    gem(ctx, roundGem(0.74, 12, 0, 0, Math.PI / 12), [0, 0], { hue: 216, sat: 88, light: 46 }, px, [1, 0.55])
}

function drawAmethyst(ctx: Ctx, px: number) {
    gem(ctx, heartGem(0.86, 0.02), [0, 0.08], { hue: 278, sat: 72, light: 48 }, px, [1, 0.62])
}

function drawRuby(ctx: Ctx, px: number) {
    gem(ctx, trillionGem(0.85, 0.04, 0.1), [0, 0.12], { hue: 352, sat: 84, light: 46 }, px, [1, 0.7, 0.42])
}

/** Sculpted metal: warm shadows, broad reflections and narrow polished edges. */
function relic(ctx: Ctx, path: Path2D, px: number) {
    const metal = ctx.createLinearGradient(-0.6, -0.8, 0.6, 0.9)
    metal.addColorStop(0, '#fff8df')
    metal.addColorStop(0.2, '#f5d591')
    metal.addColorStop(0.39, '#b8863e')
    metal.addColorStop(0.5, '#f4db9b')
    metal.addColorStop(0.64, '#d9ac57')
    metal.addColorStop(0.84, '#94602d')
    metal.addColorStop(1, '#e5bf71')
    bevel(ctx, path, metal, px, { depth: 0.03, outline: '#54371e', outlineWidth: 0.022, light: '#fff4cc', dark: 'rgba(73,36,13,0.8)' })
    ctx.save()
    ctx.clip(path)
    const reflection = ctx.createLinearGradient(-0.65, 0, 0.65, 0)
    reflection.addColorStop(0, 'rgba(255,249,220,0)')
    reflection.addColorStop(0.24, 'rgba(255,249,220,0.45)')
    reflection.addColorStop(0.35, 'rgba(255,249,220,0)')
    reflection.addColorStop(0.72, 'rgba(58,24,3,0.18)')
    reflection.addColorStop(1, 'rgba(255,249,220,0.2)')
    ctx.fillStyle = reflection
    ctx.fill(path)
    ctx.restore()
}

function engraving(ctx: Ctx, path: Path2D, width = 0.025) {
    ctx.save()
    ctx.strokeStyle = '#fff0c2'
    ctx.globalAlpha = 0.7
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke(path)
    ctx.restore()
}

function drawLyre(ctx: Ctx, px: number) {
    const body = new Path2D('M-.55 -.7 Q-.82 -.25 -.55 .35 Q-.4 .72 0 .78 Q.4 .72 .55 .35 Q.82 -.25 .55 -.7 L.37 -.63 Q.57 -.13 .35 .28 Q0 .7 -.35 .28 Q-.57 -.13 -.37 -.63 Z')
    relic(ctx, body, px)
    relic(ctx, new Path2D('M-.56 -.55 Q0 -.7 .56 -.55 L.53 -.43 Q0 -.54 -.53 -.43 Z'), px)
    const strings = new Path2D()
    for (let i = -2; i <= 2; i++) {
        strings.moveTo(i * 0.12, -0.48)
        strings.lineTo(i * 0.1, 0.5 - Math.abs(i) * 0.05)
    }
    engraving(ctx, strings, 0.022)
    engraving(ctx, new Path2D('M-.5 -.49 Q-.69 -.12 -.43 .37 Q0 .91 .43 .37 Q.69 -.12 .5 -.49'), 0.014)
    for (let i = -2; i <= 2; i++) sphere(ctx, i * 0.12, -0.51, 0.025, px, '#fff7db', '#c39245', '#664119')
    relic(ctx, new Path2D('M-.22 .5 Q0 .41 .22 .5 L.17 .65 Q0 .76 -.17 .65 Z'), px)
    gem(ctx, [[0, 0.42], [0.12, 0.56], [0, 0.7], [-0.12, 0.56]], [0, 0.56], { hue: 186, sat: 70, light: 45 }, px)
}

function drawHelm(ctx: Ctx, px: number) {
    const crest = new Path2D('M-.56 -.37 Q-.6 -.94 0 -.94 Q.6 -.94 .56 -.37 L.35 -.45 Q0 -.72 -.35 -.45 Z')
    const red = ctx.createLinearGradient(-0.5, -0.9, 0.4, -0.3)
    red.addColorStop(0, '#ef9b96')
    red.addColorStop(1, '#883c58')
    bevel(ctx, crest, red, px, { outline: '#5d2437', depth: 0.025 })
    ctx.save()
    ctx.clip(crest)
    for (let i = 0; i < 19; i++) {
        const angle = Math.PI + i / 18 * Math.PI
        const plume = new Path2D()
        plume.moveTo(Math.cos(angle) * 0.33, -0.35 + Math.sin(angle) * 0.35)
        plume.lineTo(Math.cos(angle) * 0.64, -0.35 + Math.sin(angle) * 0.65)
        engraving(ctx, plume, i % 2 ? 0.012 : 0.022)
    }
    ctx.restore()
    const helmet = new Path2D('M0 -.62 Q.58 -.62 .6 -.08 L.51 .63 L.22 .82 L.2 .22 L.43 .07 L.1 -.01 L.08 .51 L-.08 .51 L-.1 -.01 L-.43 .07 L-.2 .22 L-.22 .82 L-.51 .63 L-.6 -.08 Q-.58 -.62 0 -.62 Z')
    relic(ctx, helmet, px)
    engraving(ctx, new Path2D('M0 -.55 L0 -.14 M-.48 -.18 Q0 -.39 .48 -.18 M-.43 .31 L-.38 .58 M.43 .31 L.38 .58'))
    for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) sphere(ctx, side * (0.44 - i * 0.025), 0.27 + i * 0.13, 0.02, px, '#fff1bd', '#ce9b4c', '#69401c')
    }
    gem(ctx, [[0, -0.48], [0.075, -0.36], [0, -0.23], [-0.075, -0.36]], [0, -0.36], { hue: 190, sat: 75, light: 45 }, px)
}

function drawSun(ctx: Ctx, px: number) {
    for (let i = 0; i < 8; i++) {
        ctx.save()
        ctx.rotate(i * Math.PI / 4)
        relic(ctx, new Path2D('M0 -.88 L.09 -.54 L0 -.45 L-.09 -.54 Z'), px)
        ctx.restore()
    }
    relic(ctx, circle(0, 0, 0.46), px)
    ctx.fillStyle = '#253e50'
    ctx.fill(circle(0, 0, 0.36))
    const enamel = ctx.createRadialGradient(-0.12, -0.16, 0.01, 0, 0, 0.36)
    enamel.addColorStop(0, '#5c8799')
    enamel.addColorStop(0.5, '#233e53')
    enamel.addColorStop(1, '#0b192d')
    ctx.fillStyle = enamel
    ctx.fill(circle(0, 0, 0.35))
    engraving(ctx, circle(0, 0, 0.3), 0.014)
    for (let i = 0; i < 24; i++) {
        const a = i * Math.PI / 12
        const mark = new Path2D()
        mark.moveTo(Math.cos(a) * 0.38, Math.sin(a) * 0.38)
        mark.lineTo(Math.cos(a) * 0.42, Math.sin(a) * 0.42)
        engraving(ctx, mark, 0.01)
    }
    relic(ctx, new Path2D('M0 -.27 L.07 -.07 L.27 0 L.07 .07 L0 .27 L-.07 .07 L-.27 0 L-.07 -.07 Z'), px)
}

function drawCrown(ctx: Ctx, px: number) {
    const crown = new Path2D('M-.64 .43 L-.8 -.39 L-.38 -.06 L0 -.77 L.38 -.06 L.8 -.39 L.64 .43 Z')
    relic(ctx, crown, px)
    ctx.fillStyle = '#253e50'
    ctx.fill(new Path2D('M-.55 .2 Q0 .33 .55 .2 L.5 .43 Q0 .56 -.5 .43 Z'))
    relic(ctx, new Path2D('M-.65 .49 Q0 .64 .65 .49 L.62 .64 Q0 .79 -.62 .64 Z'), px)
    engraving(ctx, new Path2D('M-.64 -.17 L-.47 .08 M0 -.54 L0 -.12 M.64 -.17 L.47 .08'))
    gem(ctx, [[0, -0.03], [0.16, 0.19], [0, 0.42], [-0.16, 0.19]], [0, 0.19], { hue: 190, sat: 70, light: 50 }, px)
    for (const side of [-1, 1]) {
        gem(ctx, roundGem(0.075, 8, side * 0.36, 0.33), [side * 0.36, 0.33], { hue: 190, sat: 75, light: 45 }, px)
        sphere(ctx, side * 0.8, -0.39, 0.05, px, '#fff6cf', '#d6ab60', '#74502a')
    }
    engraving(ctx, new Path2D('M-.56 .6 Q0 .73 .56 .6'), 0.013)
    twinkle(ctx, 0, -0.82, 0.1, px, '#fff0c2')
}

function drawGateFrame(ctx: Ctx, px: number) {
    // Columns either side of the ring.
    for (const s of [-1, 1]) {
        const x = s * 0.8
        const col = new Path2D()
        col.rect(x - 0.075, -0.42, 0.15, 1.02)
        const mg = ctx.createLinearGradient(x - 0.075, 0, x + 0.075, 0)
        mg.addColorStop(0, '#94a3b8')
        mg.addColorStop(0.35, '#f8fafc')
        mg.addColorStop(0.7, '#cbd5e1')
        mg.addColorStop(1, '#475569')
        bevel(ctx, col, mg, px, { depth: 0.012, outline: '#1e293b', light: 'rgba(255,255,255,0.7)', dark: 'rgba(30,41,59,0.5)' })
        ctx.save()
        ctx.strokeStyle = 'rgba(71,85,105,0.55)'
        ctx.lineWidth = 0.012
        for (const fx of [-0.035, 0, 0.035]) {
            ctx.beginPath()
            ctx.moveTo(x + fx, -0.38)
            ctx.lineTo(x + fx, 0.56)
            ctx.stroke()
        }
        ctx.restore()
        bevel(ctx, poly([[x - 0.12, -0.5], [x + 0.12, -0.5], [x + 0.09, -0.4], [x - 0.09, -0.4]]), gold(ctx, -0.5, -0.4), px, { depth: 0.012 })
        bevel(ctx, poly([[x - 0.1, 0.56], [x + 0.1, 0.56], [x + 0.12, 0.64], [x - 0.12, 0.64]]), gold(ctx, 0.56, 0.64), px, { depth: 0.012 })
    }

    // The ring itself.
    const ring = new Path2D()
    ring.arc(0, -0.02, 0.74, 0, Math.PI * 2)
    ring.arc(0, -0.02, 0.56, 0, Math.PI * 2, true)
    bevel(ctx, ring, gold(ctx, -0.8, 0.8, -0.6, 0.6), px, { depth: 0.03 })
    ctx.save()
    ctx.lineWidth = 0.012
    ctx.strokeStyle = 'rgba(70,35,0,0.6)'
    ctx.stroke(circle(0, -0.02, 0.65))
    ctx.restore()
    // Glyph ticks and chevrons with glowing stones.
    for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 - Math.PI / 2
        const cx = Math.cos(a) * 0.65
        const cy = Math.sin(a) * 0.65 - 0.02
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(a + Math.PI / 2)
        bevel(ctx, poly([[-0.07, -0.08], [0.07, -0.08], [0.035, 0.05], [-0.035, 0.05]]), gold(ctx, -0.1, 0.1), px, { depth: 0.01, shadow: false })
        ctx.restore()
        ctx.save()
        ctx.shadowColor = '#67e8f9'
        ctx.shadowBlur = px * 0.06
        sphere(ctx, cx, cy, 0.03, px, '#e0fbff', '#22d3ee', '#0e7490')
        ctx.restore()
    }

    // Stepped pedestal.
    bevel(ctx, poly([[-0.62, 0.62], [0.62, 0.62], [0.7, 0.72], [-0.7, 0.72]]), gold(ctx, 0.6, 0.75), px, { depth: 0.014 })

    // Keystone with a big stone.
    bevel(ctx, poly([[-0.14, -0.9], [0.14, -0.9], [0.1, -0.68], [-0.1, -0.68]]), gold(ctx, -0.9, -0.68), px, { depth: 0.016 })
    gem(ctx, roundGem(0.08, 10, 0, -0.8), [0, -0.8], { hue: 190, sat: 95, light: 55 }, px, [1, 0.5], false)

    // SCATTER ribbon.
    const ribbon = new Path2D()
    ribbon.moveTo(-0.92, 0.66)
    ribbon.lineTo(0.92, 0.66)
    ribbon.lineTo(0.84, 0.8)
    ribbon.lineTo(0.92, 0.94)
    ribbon.lineTo(-0.92, 0.94)
    ribbon.lineTo(-0.84, 0.8)
    ribbon.closePath()
    const rg = ctx.createLinearGradient(0, 0.66, 0, 0.94)
    rg.addColorStop(0, '#3b4bd8')
    rg.addColorStop(1, '#141a5c')
    bevel(ctx, ribbon, rg, px, { depth: 0.014, outline: '#e7b53c', outlineWidth: 0.026, light: 'rgba(200,210,255,0.6)', dark: 'rgba(5,5,30,0.6)' })
    // Tiny fractional font sizes get clamped, so letter in pixel space.
    ctx.save()
    ctx.translate(0, 0.815)
    ctx.scale(1 / px, 1 / px)
    ctx.font = `900 ${Math.round(0.2 * px)}px ${AG_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 0.045 * px
    ctx.strokeStyle = '#1a0f02'
    ctx.strokeText('SCATTER', 0, 0, 1.45 * px)
    const tg = ctx.createLinearGradient(0, -0.1 * px, 0, 0.1 * px)
    tg.addColorStop(0, '#fffbe0')
    tg.addColorStop(0.45, '#fcd34d')
    tg.addColorStop(1, '#b7791f')
    ctx.fillStyle = tg
    ctx.fillText('SCATTER', 0, 0, 1.45 * px)
    ctx.restore()
}

/** The swirling vortex inside the gate ring, drawn on its own so it can spin. */
export function drawAgPortal(ctx: Ctx, px: number) {
    const r = 0.6
    const disc = circle(0, 0, r)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.14, '#a5f3fc')
    g.addColorStop(0.42, '#6366f1')
    g.addColorStop(0.78, '#312e81')
    g.addColorStop(1, '#0b0a2a')
    ctx.fillStyle = g
    ctx.fill(disc)
    ctx.save()
    ctx.clip(disc)
    ctx.lineCap = 'round'
    for (let arm = 0; arm < 6; arm++) {
        const a0 = (arm / 6) * Math.PI * 2
        ctx.beginPath()
        for (let k = 0; k <= 30; k++) {
            const t = k / 30
            const rr = 0.04 + t * r
            const a = a0 + t * 4.2
            const x = Math.cos(a) * rr
            const y = Math.sin(a) * rr
            if (k) ctx.lineTo(x, y)
            else ctx.moveTo(x, y)
        }
        ctx.lineWidth = 0.05
        ctx.strokeStyle = 'rgba(165, 243, 252, 0.35)'
        ctx.stroke()
        ctx.lineWidth = 0.016
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
        ctx.stroke()
    }
    for (let i = 0; i < 14; i++) {
        const a = i * 2.4
        const rr = 0.12 + ((i * 37) % 10) / 10 * 0.42
        twinkle(ctx, Math.cos(a) * rr, Math.sin(a) * rr, 0.035 + (i % 3) * 0.012, px, '#a5f3fc', 0.85)
    }
    ctx.restore()
}

/** A multiplier orb of the given tier (the value is drawn on top at runtime). */
export function drawAgOrb(ctx: Ctx, px: number, tier: number) {
    const t = AG_ORB_TIERS[Math.max(0, Math.min(AG_ORB_TIERS.length - 1, tier))]!
    const h = t.hue
    const aura = ctx.createRadialGradient(0, 0, 0.3, 0, 0, 1)
    aura.addColorStop(0, hsl(h, 90, 60, 0.55))
    aura.addColorStop(1, hsl(h, 90, 50, 0))
    ctx.fillStyle = aura
    ctx.fillRect(-1, -1, 2, 2)

    // Gold ring with four winglets.
    for (let i = 0; i < 4; i++) {
        ctx.save()
        ctx.rotate(Math.PI / 4 + (i * Math.PI) / 2)
        bevel(ctx, poly([[-0.1, -0.7], [0, -0.92], [0.1, -0.7]]), gold(ctx, -0.92, -0.7), px, { depth: 0.012 })
        ctx.restore()
    }
    const ring = new Path2D()
    ring.arc(0, 0, 0.78, 0, Math.PI * 2)
    ring.arc(0, 0, 0.66, 0, Math.PI * 2, true)
    bevel(ctx, ring, gold(ctx, -0.8, 0.8, -0.6, 0.6), px, { depth: 0.022 })

    const orb = circle(0, 0, 0.66)
    const g = ctx.createRadialGradient(-0.24, -0.3, 0.02, 0, 0, 0.7)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.16, hsl(h, 95, 82))
    g.addColorStop(0.5, hsl(h, 85, 52))
    g.addColorStop(0.85, hsl(h, 80, 28))
    g.addColorStop(1, hsl(h, 80, 16))
    ctx.fillStyle = g
    ctx.fill(orb)

    // Captured lightning inside the glass.
    ctx.save()
    ctx.clip(orb)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const bolts: Pt[][] = [
        [[-0.5, -0.1], [-0.28, 0.02], [-0.34, 0.14], [-0.1, 0.3], [0.05, 0.22], [0.3, 0.44]],
        [[0.5, -0.3], [0.3, -0.18], [0.36, -0.02], [0.12, 0.06]],
        [[-0.2, -0.56], [-0.1, -0.36], [-0.22, -0.24], [0, -0.1]]
    ]
    for (const bolt of bolts) {
        ctx.beginPath()
        bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.lineWidth = 0.05
        ctx.strokeStyle = hsl(h, 100, 80, 0.35)
        ctx.stroke()
        ctx.lineWidth = 0.016
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.stroke()
    }
    ctx.restore()

    // Glass highlights.
    ctx.save()
    ctx.clip(orb)
    const hl = ctx.createRadialGradient(-0.22, -0.36, 0, -0.22, -0.36, 0.34)
    hl.addColorStop(0, 'rgba(255,255,255,0.85)')
    hl.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = hl
    ctx.beginPath()
    ctx.ellipse(-0.22, -0.36, 0.34, 0.2, -0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 0.04
    ctx.strokeStyle = hsl(h, 100, 85, 0.5)
    ctx.beginPath()
    ctx.arc(0, 0, 0.6, 0.2, 1.6)
    ctx.stroke()
    ctx.restore()
}

const RECIPES: Record<Exclude<AetherSymbol, 'multiplier'>, (ctx: Ctx, px: number) => void> = {
    coin: drawEmerald,
    ring: drawSapphire,
    chalice: drawAmethyst,
    laurel: drawRuby,
    lyre: drawLyre,
    helm: drawHelm,
    sun: drawSun,
    star: drawCrown,
    scatter: (ctx, px) => {
        ctx.save()
        ctx.translate(0, -0.02)
        ctx.scale(0.94, 0.94)
        drawAgPortal(ctx, px)
        ctx.restore()
        drawGateFrame(ctx, px)
    }
}

// --- canvas helpers -----------------------------------------------------------

/** Run `draw` in unit space ([-1, 1]) on a fresh square canvas of `size` pixels. */
export function agUnitCanvas(size: number, draw: (ctx: Ctx, px: number) => void, pad = 0.9): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const px = (size / 2) * pad
    ctx.translate(size / 2, size / 2)
    ctx.scale(px, px)
    draw(ctx, px)
    return canvas
}

export function agSymbolCanvas(id: AetherSymbol, size: number): HTMLCanvasElement {
    if (id === 'multiplier') return agUnitCanvas(size, (ctx, px) => drawAgOrb(ctx, px, 1))
    return agUnitCanvas(size, RECIPES[id])
}

/** Scatter frame without the vortex (the vortex spins on its own layer). */
export function agGateFrameCanvas(size: number): HTMLCanvasElement {
    return agUnitCanvas(size, drawGateFrame)
}

export function agPortalCanvas(size: number): HTMLCanvasElement {
    return agUnitCanvas(size, (ctx, px) => {
        ctx.translate(0, -0.02)
        ctx.scale(0.94, 0.94)
        drawAgPortal(ctx, px)
    })
}

export function agOrbCanvas(size: number, tier: number): HTMLCanvasElement {
    return agUnitCanvas(size, (ctx, px) => drawAgOrb(ctx, px, tier))
}

/** Soft round glow sprite (white, tint it). */
export function agGlowCanvas(size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    return canvas
}

/** Small triangular gem shard for shatter particles (white, tint it). */
export function agShardCanvas(size: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.translate(size / 2, size / 2)
    const s = size / 2
    ctx.beginPath()
    ctx.moveTo(0, -s * 0.95)
    ctx.lineTo(s * 0.6, s * 0.7)
    ctx.lineTo(-s * 0.55, s * 0.5)
    ctx.closePath()
    const g = ctx.createLinearGradient(-s, -s, s, s)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0.45)')
    ctx.fillStyle = g
    ctx.fill()
    return canvas
}

const urlCache = new Map<string, string>()

/** PNG data URL of a symbol for DOM use (paytable, preview). Cached. */
export function agSymbolDataUrl(id: AetherSymbol | `orb-${number}`, size = 128): string {
    const key = `${id}:${size}`
    const hit = urlCache.get(key)
    if (hit) return hit
    const canvas = id.startsWith('orb-') ? agOrbCanvas(size, Number(id.slice(4))) : agSymbolCanvas(id as AetherSymbol, size)
    const url = canvas.toDataURL('image/png')
    urlCache.set(key, url)
    return url
}
