// Aether Gates artwork, drawn procedurally with Canvas 2D. Nothing is
// fetched: every symbol, multiplier orb and the sky-temple backdrop is built
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

/** A round metal rod: dark outline, gold body, shade below and a hot highlight. */
function tube(ctx: Ctx, path: Path2D, width: number, px: number, body?: string | CanvasGradient) {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    shadow(ctx, px, 0.06, 0.035)
    ctx.strokeStyle = '#2b1703'
    ctx.lineWidth = width + 0.05
    ctx.stroke(path)
    noShadow(ctx)
    ctx.strokeStyle = body ?? gold(ctx)
    ctx.lineWidth = width
    ctx.stroke(path)
    ctx.save()
    ctx.translate(0.012, 0.02)
    ctx.strokeStyle = 'rgba(110, 55, 0, 0.45)'
    ctx.lineWidth = width * 0.45
    ctx.stroke(path)
    ctx.restore()
    ctx.translate(-0.012, -0.018)
    ctx.strokeStyle = 'rgba(255, 252, 225, 0.85)'
    ctx.lineWidth = width * 0.24
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

function goldSphere(ctx: Ctx, x: number, y: number, r: number, px: number) {
    sphere(ctx, x, y, r, px, '#fff1a8', '#e0a12a', '#6d4108')
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

/**
 * A cut gem: the outline is split into rings (outer girdle -> table) and every
 * band between two rings is cut into triangular facets, each lit by how much
 * it faces the top-left light. The table gets a glossy gradient, a specular
 * streak and a twinkle.
 */
function gem(ctx: Ctx, outline: Pt[], center: Pt, style: GemStyle, px: number, rings: number[] = [1, 0.74, 0.5], bezel = true) {
    const { hue, sat, light } = style
    const outer = poly(outline)

    // Soft coloured aura so a main stone reads on a dark board.
    const radius = Math.max(...outline.map(([x, y]) => Math.hypot(x - center[0], y - center[1])))
    if (radius > 0.4) {
        ctx.save()
        const aura = ctx.createRadialGradient(center[0], center[1], radius * 0.2, center[0], center[1], radius * 1.35)
        aura.addColorStop(0, hsl(hue, sat, 60, 0.3))
        aura.addColorStop(1, hsl(hue, sat, 50, 0))
        ctx.fillStyle = aura
        ctx.fill(circle(center[0], center[1], radius * 1.35))
        ctx.restore()
    }

    if (bezel) {
        const setting = poly(scalePts(outline, center, 1.1))
        bevel(ctx, setting, gold(ctx), px, { depth: 0.024 })
    }

    ctx.save()
    shadow(ctx, px, 0.05, 0.02, 'rgba(0,0,0,0.6)')
    ctx.fillStyle = hsl(hue, sat, light - 22)
    ctx.fill(outer)
    ctx.restore()

    const n = outline.length
    for (let r = 0; r < rings.length - 1; r++) {
        const a = scalePts(outline, center, rings[r]!)
        const b = scalePts(outline, center, rings[r + 1]!)
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n
            const mx = (a[i]![0] + a[j]![0]) / 2 - center[0]
            const my = (a[i]![1] + a[j]![1]) / 2 - center[1]
            const len = Math.hypot(mx, my) || 1
            const lambert = (mx / len) * LIGHT[0] + (my / len) * LIGHT[1]
            const band = r === 0 ? 0 : 6
            const l1 = light + lambert * 20 + band + 4
            const l2 = light + lambert * 16 + band - 6
            ctx.fillStyle = hsl(hue, sat, l1)
            ctx.fill(poly([a[i]!, a[j]!, b[j]!]))
            ctx.fillStyle = hsl(hue, sat, l2)
            ctx.fill(poly([a[i]!, b[j]!, b[i]!]))
        }
        ctx.save()
        ctx.lineWidth = 0.008
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'
        for (let i = 0; i < n; i++) {
            ctx.beginPath()
            ctx.moveTo(a[i]![0], a[i]![1])
            ctx.lineTo(b[i]![0], b[i]![1])
            ctx.stroke()
        }
        ctx.stroke(poly(b))
        ctx.restore()
    }

    // Table: glossy face with star facets.
    const tablePts = scalePts(outline, center, rings[rings.length - 1]!)
    const table = poly(tablePts)
    const tg = ctx.createLinearGradient(center[0] - 0.4, center[1] - 0.5, center[0] + 0.4, center[1] + 0.5)
    tg.addColorStop(0, hsl(hue, sat, light + 26))
    tg.addColorStop(0.5, hsl(hue, sat, light + 6))
    tg.addColorStop(1, hsl(hue, sat, light - 8))
    ctx.fillStyle = tg
    ctx.fill(table)
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
        ctx.fill(poly([center, tablePts[i]!, tablePts[j]!]))
    }

    // Specular streak across the table.
    ctx.save()
    ctx.clip(outer)
    ctx.translate(center[0] - 0.18, center[1] - 0.22)
    ctx.rotate(-0.7)
    const sg = ctx.createLinearGradient(0, -0.12, 0, 0.12)
    sg.addColorStop(0, 'rgba(255,255,255,0)')
    sg.addColorStop(0.5, 'rgba(255,255,255,0.5)')
    sg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = sg
    ctx.fillRect(-0.7, -0.12, 1.4, 0.24)
    ctx.restore()

    // Girdle rim: bright top-left, dark outline.
    ctx.save()
    const rim = ctx.createLinearGradient(-0.8, -0.8, 0.8, 0.8)
    rim.addColorStop(0, 'rgba(255,255,255,0.9)')
    rim.addColorStop(0.5, 'rgba(255,255,255,0.1)')
    rim.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.lineJoin = 'round'
    ctx.lineWidth = 0.02
    ctx.strokeStyle = rim
    ctx.stroke(outer)
    ctx.lineWidth = 0.012
    ctx.strokeStyle = hsl(hue, sat, 12, 0.9)
    ctx.stroke(outer)
    ctx.restore()

    const tl = tablePts.reduce((best, p) => (p[0] + p[1] < best[0] + best[1] ? p : best), tablePts[0]!)
    twinkle(ctx, tl[0] + (center[0] - tl[0]) * 0.25, tl[1] + (center[1] - tl[1]) * 0.25, Math.min(0.2, Math.max(0.05, radius * 0.28)), px)
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
    const n = 26
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
    gem(ctx, octagon(0.54, 0.74, 0.2), [0, 0], { hue: 150, sat: 78, light: 40 }, px, [1, 0.78, 0.56, 0.38])
}

function drawSapphire(ctx: Ctx, px: number) {
    gem(ctx, roundGem(0.74, 16), [0, 0], { hue: 216, sat: 88, light: 46 }, px, [1, 0.7, 0.44])
}

function drawAmethyst(ctx: Ctx, px: number) {
    gem(ctx, heartGem(0.86, 0.02), [0, 0.08], { hue: 278, sat: 72, light: 48 }, px, [1, 0.72, 0.46])
}

function drawRuby(ctx: Ctx, px: number) {
    gem(ctx, trillionGem(0.9, 0.16, 0.12), [0, 0.12], { hue: 352, sat: 84, light: 46 }, px, [1, 0.7, 0.42])
}

function drawLyre(ctx: Ctx, px: number) {
    ctx.scale(1.14, 1.04)
    // Arms curl out and back in at the top.
    const arms = new Path2D()
    arms.moveTo(-0.26, 0.5)
    arms.bezierCurveTo(-0.66, 0.34, -0.7, -0.18, -0.4, -0.44)
    arms.bezierCurveTo(-0.26, -0.56, -0.3, -0.8, -0.52, -0.76)
    arms.moveTo(0.26, 0.5)
    arms.bezierCurveTo(0.66, 0.34, 0.7, -0.18, 0.4, -0.44)
    arms.bezierCurveTo(0.26, -0.56, 0.3, -0.8, 0.52, -0.76)
    tube(ctx, arms, 0.13, px)

    // Violet enamel sound box.
    const box = new Path2D()
    box.moveTo(-0.4, 0.44)
    box.quadraticCurveTo(0, 0.36, 0.4, 0.44)
    box.bezierCurveTo(0.42, 0.66, 0.24, 0.84, 0, 0.86)
    box.bezierCurveTo(-0.24, 0.84, -0.42, 0.66, -0.4, 0.44)
    box.closePath()
    const enamel = ctx.createLinearGradient(0, 0.36, 0, 0.9)
    enamel.addColorStop(0, '#d8b4fe')
    enamel.addColorStop(0.4, '#7e22ce')
    enamel.addColorStop(1, '#3b0764')
    bevel(ctx, box, enamel, px, { depth: 0.022 })
    tube(ctx, box, 0.045, px)

    // Strings.
    ctx.save()
    ctx.lineCap = 'round'
    for (let i = 0; i < 5; i++) {
        const x = -0.2 + i * 0.1
        ctx.strokeStyle = 'rgba(40, 20, 0, 0.6)'
        ctx.lineWidth = 0.028
        ctx.beginPath()
        ctx.moveTo(x, -0.38)
        ctx.lineTo(x * 1.1, 0.46)
        ctx.stroke()
        const sg = ctx.createLinearGradient(0, -0.4, 0, 0.5)
        sg.addColorStop(0, '#fffbe6')
        sg.addColorStop(0.5, '#fde68a')
        sg.addColorStop(1, '#fff7d6')
        ctx.strokeStyle = sg
        ctx.lineWidth = 0.014
        ctx.stroke()
    }
    ctx.restore()

    // Yoke across the top.
    const yoke = new Path2D()
    yoke.moveTo(-0.46, -0.4)
    yoke.quadraticCurveTo(0, -0.5, 0.46, -0.4)
    tube(ctx, yoke, 0.1, px)

    gem(ctx, roundGem(0.12, 10, 0, 0.62), [0, 0.62], { hue: 200, sat: 90, light: 50 }, px, [1, 0.5], true)
    goldSphere(ctx, -0.53, -0.76, 0.075, px)
    goldSphere(ctx, 0.53, -0.76, 0.075, px)
    goldSphere(ctx, 0, -0.47, 0.06, px)
}

function drawHelm(ctx: Ctx, px: number) {
    // Crimson crest fanning over the dome.
    const crest = new Path2D()
    crest.moveTo(-0.6, -0.2)
    crest.bezierCurveTo(-0.72, -0.8, -0.2, -1, 0, -0.98)
    crest.bezierCurveTo(0.2, -1, 0.72, -0.8, 0.6, -0.2)
    crest.bezierCurveTo(0.44, -0.58, -0.44, -0.58, -0.6, -0.2)
    crest.closePath()
    const red = ctx.createLinearGradient(0, -1, 0, -0.2)
    red.addColorStop(0, '#fca5a5')
    red.addColorStop(0.35, '#dc2626')
    red.addColorStop(1, '#6b0f0f')
    bevel(ctx, crest, red, px, { outline: '#2a0505', light: 'rgba(255,220,220,0.6)', dark: 'rgba(40,0,0,0.6)' })
    ctx.save()
    ctx.clip(crest)
    ctx.lineWidth = 0.014
    for (let i = 0; i <= 22; i++) {
        const a = Math.PI + (i / 22) * Math.PI
        ctx.strokeStyle = i % 2 ? 'rgba(255,200,200,0.35)' : 'rgba(60,0,0,0.45)'
        ctx.beginPath()
        ctx.moveTo(0, -0.2)
        ctx.lineTo(Math.cos(a) * 1.1, -0.2 + Math.sin(a) * 1.1)
        ctx.stroke()
    }
    ctx.restore()

    // Dark interior behind the openings.
    ctx.fillStyle = '#12070a'
    ctx.fill(poly([[-0.3, -0.2], [0.3, -0.2], [0.26, 0.9], [-0.26, 0.9]]))

    const helm = new Path2D()
    helm.moveTo(0, -0.64)
    helm.bezierCurveTo(0.44, -0.64, 0.64, -0.4, 0.64, -0.02)
    helm.lineTo(0.62, 0.4)
    helm.bezierCurveTo(0.6, 0.66, 0.46, 0.86, 0.24, 0.9)
    helm.lineTo(0.14, 0.9)
    helm.lineTo(0.12, 0.3)
    helm.quadraticCurveTo(0, 0.24, -0.12, 0.3)
    helm.lineTo(-0.14, 0.9)
    helm.lineTo(-0.24, 0.9)
    helm.bezierCurveTo(-0.46, 0.86, -0.6, 0.66, -0.62, 0.4)
    helm.lineTo(-0.64, -0.02)
    helm.bezierCurveTo(-0.64, -0.4, -0.44, -0.64, 0, -0.64)
    helm.closePath()
    bevel(ctx, helm, gold(ctx, -0.7, 0.9, -0.5, 0.5), px, { depth: 0.035 })

    // Almond eye holes either side of the nose guard.
    for (const s of [-1, 1]) {
        const eye = new Path2D()
        eye.moveTo(s * 0.07, -0.08)
        eye.bezierCurveTo(s * 0.2, -0.2, s * 0.44, -0.14, s * 0.52, -0.02)
        eye.bezierCurveTo(s * 0.4, 0.08, s * 0.2, 0.1, s * 0.08, 0.12)
        eye.closePath()
        ctx.save()
        const eg = ctx.createLinearGradient(0, -0.2, 0, 0.12)
        eg.addColorStop(0, '#000000')
        eg.addColorStop(1, '#2a0d10')
        ctx.fillStyle = eg
        ctx.fill(eye)
        ctx.lineWidth = 0.022
        ctx.strokeStyle = 'rgba(255, 240, 190, 0.8)'
        ctx.translate(0, 0.012)
        ctx.stroke(eye)
        ctx.restore()
    }

    // Brow ridge and centre stone.
    const brow = new Path2D()
    brow.moveTo(-0.58, -0.2)
    brow.quadraticCurveTo(0, -0.42, 0.58, -0.2)
    tube(ctx, brow, 0.06, px)
    const ridge = new Path2D()
    ridge.moveTo(0, -0.62)
    ridge.lineTo(0, -0.34)
    tube(ctx, ridge, 0.05, px)
    gem(ctx, octagon(0.08, 0.1, 0.035, -0.3), [0, -0.3], { hue: 205, sat: 90, light: 52 }, px, [1, 0.5], true)

    // Rivets along the cheek guards.
    for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) goldSphere(ctx, s * (0.48 - i * 0.04), 0.3 + i * 0.18, 0.03, px)
    }
}

function drawSun(ctx: Ctx, px: number) {
    // Alternating long and short rays.
    const rays = new Path2D()
    const n = 16
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        const len = i % 2 ? 0.8 : 0.97
        const w = i % 2 ? 0.1 : 0.13
        rays.moveTo(Math.cos(a - w) * 0.5, Math.sin(a - w) * 0.5)
        rays.lineTo(Math.cos(a) * len, Math.sin(a) * len)
        rays.lineTo(Math.cos(a + w) * 0.5, Math.sin(a + w) * 0.5)
        rays.closePath()
    }
    const rg = ctx.createRadialGradient(0, 0, 0.4, 0, 0, 1)
    rg.addColorStop(0, '#fff3b0')
    rg.addColorStop(0.5, '#f5b829')
    rg.addColorStop(1, '#b45309')
    bevel(ctx, rays, rg, px, { depth: 0.02 })

    const disc = circle(0, 0, 0.58)
    bevel(ctx, disc, gold(ctx, -0.6, 0.6, -0.4, 0.4), px, { depth: 0.035 })

    // Engraved ring of dots.
    for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2
        goldSphere(ctx, Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.026, px)
    }

    const face = circle(0, 0, 0.42)
    const fg = ctx.createRadialGradient(-0.12, -0.14, 0.02, 0, 0, 0.44)
    fg.addColorStop(0, '#fff7cc')
    fg.addColorStop(0.45, '#fbbf24')
    fg.addColorStop(1, '#c2410c')
    ctx.save()
    ctx.fillStyle = fg
    ctx.fill(face)
    ctx.lineWidth = 0.03
    ctx.strokeStyle = '#5a2e02'
    ctx.stroke(face)
    ctx.restore()

    // Inner flame swirl.
    ctx.save()
    ctx.clip(face)
    ctx.lineWidth = 0.02
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        ctx.strokeStyle = 'rgba(255, 245, 200, 0.45)'
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * 0.2, Math.sin(a) * 0.2)
        ctx.quadraticCurveTo(Math.cos(a + 0.5) * 0.36, Math.sin(a + 0.5) * 0.36, Math.cos(a + 0.2) * 0.44, Math.sin(a + 0.2) * 0.44)
        ctx.stroke()
    }
    ctx.restore()

    gem(ctx, roundGem(0.2, 12), [0, 0], { hue: 24, sat: 95, light: 50 }, px, [1, 0.62, 0.36], true)
}

function drawCrown(ctx: Ctx, px: number) {
    // Velvet cap behind the points.
    const cap = new Path2D()
    cap.moveTo(-0.62, 0.2)
    cap.bezierCurveTo(-0.6, -0.5, 0.6, -0.5, 0.62, 0.2)
    cap.closePath()
    const vg = ctx.createRadialGradient(-0.15, -0.25, 0.05, 0, 0, 0.8)
    vg.addColorStop(0, '#fb7185')
    vg.addColorStop(0.5, '#9f1239')
    vg.addColorStop(1, '#3f0716')
    ctx.fillStyle = vg
    ctx.fill(cap)

    // Five points.
    const pts: Pt[] = [
        [-0.74, 0.24], [-0.82, -0.3], [-0.5, -0.02], [-0.4, -0.56], [-0.16, -0.14], [0, -0.8],
        [0.16, -0.14], [0.4, -0.56], [0.5, -0.02], [0.82, -0.3], [0.74, 0.24]
    ]
    const points = new Path2D()
    pts.forEach(([x, y], i) => (i ? points.lineTo(x, y) : points.moveTo(x, y)))
    points.lineTo(0, 0.3)
    points.closePath()
    bevel(ctx, points, gold(ctx, -0.8, 0.3, -0.5, 0.5), px, { depth: 0.032 })

    // Band.
    const band = new Path2D()
    band.moveTo(-0.78, 0.16)
    band.quadraticCurveTo(0, 0.3, 0.78, 0.16)
    band.lineTo(0.72, 0.62)
    band.quadraticCurveTo(0, 0.76, -0.72, 0.62)
    band.closePath()
    bevel(ctx, band, gold(ctx, 0.1, 0.8, -0.2, 0.2), px, { depth: 0.035 })
    const trim = new Path2D()
    trim.moveTo(-0.74, 0.26)
    trim.quadraticCurveTo(0, 0.4, 0.74, 0.26)
    trim.moveTo(-0.72, 0.54)
    trim.quadraticCurveTo(0, 0.68, 0.72, 0.54)
    ctx.save()
    ctx.lineWidth = 0.016
    ctx.strokeStyle = 'rgba(70,35,0,0.7)'
    ctx.stroke(trim)
    ctx.restore()

    // Pearls on the tips.
    for (const [x, y] of [pts[1]!, pts[3]!, pts[7]!, pts[9]!]) sphere(ctx, x, y - 0.04, 0.07, px, '#ffffff', '#e2e8f0', '#64748b')
    sphere(ctx, 0, -0.86, 0.08, px, '#ffffff', '#e2e8f0', '#64748b')

    // Stones on the band and the centre point.
    gem(ctx, octagon(0.15, 0.13, 0.05, 0.45), [0, 0.45], { hue: 214, sat: 90, light: 48 }, px, [1, 0.6], true)
    for (const s of [-1, 1]) {
        gem(ctx, roundGem(0.085, 10, s * 0.38, 0.42), [s * 0.38, 0.42], { hue: 350, sat: 85, light: 48 }, px, [1, 0.5], true)
        gem(ctx, roundGem(0.06, 8, s * 0.62, 0.38), [s * 0.62, 0.38], { hue: 150, sat: 80, light: 42 }, px, [1, 0.5], true)
    }
    gem(ctx, [[0, -0.52], [0.1, -0.34], [0, -0.16], [-0.1, -0.34]], [0, -0.34], { hue: 190, sat: 90, light: 55 }, px, [1, 0.5], true)
    twinkle(ctx, 0.08, -0.9, 0.22, px, '#fff7c2')
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

// --- backdrop -----------------------------------------------------------------

function mulberry32(seed: number) {
    let a = seed
    return () => {
        a |= 0
        a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function cloud(ctx: Ctx, x: number, y: number, w: number, h: number, rnd: () => number, top: string, bottom: string) {
    const puffs = 7
    for (let i = 0; i < puffs; i++) {
        const px = x + (rnd() - 0.5) * w
        const py = y + (rnd() - 0.5) * h * 0.5
        const r = h * (0.45 + rnd() * 0.55)
        const g = ctx.createRadialGradient(px, py - r * 0.35, r * 0.1, px, py, r)
        g.addColorStop(0, top)
        g.addColorStop(0.6, bottom)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fill()
    }
}

/** A temple on a floating rock: silhouette with warm rim light on the tops. */
function floatingTemple(ctx: Ctx, x: number, y: number, s: number, rnd: () => number, cols: number) {
    // Rock underside.
    ctx.save()
    const rock = new Path2D()
    rock.moveTo(x - s * 1.05, y)
    rock.lineTo(x + s * 1.05, y)
    rock.bezierCurveTo(x + s * 0.9, y + s * 0.5, x + s * 0.4, y + s * 0.7, x + s * 0.08, y + s * 1.3)
    rock.bezierCurveTo(x - s * 0.2, y + s * 0.8, x - s * 0.8, y + s * 0.5, x - s * 1.05, y)
    rock.closePath()
    const rg = ctx.createLinearGradient(0, y, 0, y + s * 1.3)
    rg.addColorStop(0, '#3a2352')
    rg.addColorStop(1, '#0f0a22')
    ctx.fillStyle = rg
    ctx.fill(rock)
    ctx.strokeStyle = 'rgba(255, 190, 120, 0.35)'
    ctx.lineWidth = Math.max(1, s * 0.012)
    ctx.beginPath()
    ctx.moveTo(x - s * 1.05, y)
    ctx.lineTo(x + s * 1.05, y)
    ctx.stroke()
    // Hanging roots / vines.
    ctx.strokeStyle = 'rgba(20, 12, 40, 0.8)'
    for (let i = 0; i < 6; i++) {
        const vx = x + (rnd() - 0.5) * s * 1.4
        ctx.beginPath()
        ctx.moveTo(vx, y + s * 0.1)
        ctx.quadraticCurveTo(vx + s * 0.05, y + s * 0.5, vx - s * 0.03, y + s * (0.5 + rnd() * 0.5))
        ctx.stroke()
    }
    ctx.restore()

    // Temple.
    const base = y - s * 0.02
    const w = s * 1.6
    const colH = s * 0.8
    const body = '#2a1a46'
    const rim = 'rgba(255, 196, 120, 0.75)'
    ctx.fillStyle = body
    ctx.fillRect(x - w / 2 - s * 0.06, base - s * 0.1, w + s * 0.12, s * 0.1)
    ctx.fillRect(x - w / 2, base - s * 0.16, w, s * 0.06)
    const colW = w / (cols * 2 - 1)
    for (let i = 0; i < cols; i++) {
        const cx = x - w / 2 + i * colW * 2
        ctx.fillStyle = body
        ctx.fillRect(cx, base - s * 0.16 - colH, colW, colH)
        ctx.fillStyle = rim
        ctx.fillRect(cx, base - s * 0.16 - colH, Math.max(1, colW * 0.18), colH)
    }
    const entab = base - s * 0.16 - colH
    ctx.fillStyle = body
    ctx.fillRect(x - w / 2 - s * 0.05, entab - s * 0.12, w + s * 0.1, s * 0.12)
    ctx.beginPath()
    ctx.moveTo(x - w / 2 - s * 0.08, entab - s * 0.12)
    ctx.lineTo(x, entab - s * 0.45)
    ctx.lineTo(x + w / 2 + s * 0.08, entab - s * 0.12)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = rim
    ctx.lineWidth = Math.max(1, s * 0.015)
    ctx.beginPath()
    ctx.moveTo(x - w / 2 - s * 0.08, entab - s * 0.12)
    ctx.lineTo(x, entab - s * 0.45)
    ctx.lineTo(x + w / 2 + s * 0.08, entab - s * 0.12)
    ctx.stroke()
    // Warm light from inside.
    const glow = ctx.createRadialGradient(x, base - colH * 0.5, 0, x, base - colH * 0.5, w * 0.6)
    glow.addColorStop(0, 'rgba(255, 200, 120, 0.35)')
    glow.addColorStop(1, 'rgba(255, 200, 120, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(x - w, base - colH * 1.5, w * 2, colH * 1.6)
}

/**
 * The sky temple: a dusk sky over a sea of clouds, a sun blazing behind the
 * cabinet and floating temples either side. Drawn in CSS pixels; the caller
 * scales the context for the device pixel ratio.
 */
export function drawAgBackdrop(ctx: Ctx, w: number, h: number) {
    const rnd = mulberry32(7331)
    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#07061c')
    sky.addColorStop(0.28, '#1b1147')
    sky.addColorStop(0.5, '#4a1f6b')
    sky.addColorStop(0.66, '#a4476e')
    sky.addColorStop(0.76, '#f08a5d')
    sky.addColorStop(0.84, '#6b3570')
    sky.addColorStop(1, '#170d2c')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)

    // Stars.
    for (let i = 0; i < 260; i++) {
        const x = rnd() * w
        const y = rnd() ** 1.6 * h * 0.6
        const r = 0.4 + rnd() * 1.3
        ctx.globalAlpha = (1 - y / (h * 0.6)) * (0.35 + rnd() * 0.65)
        ctx.fillStyle = rnd() > 0.85 ? '#c7d2fe' : '#ffffff'
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
    }
    ctx.globalAlpha = 1

    // Aurora veils.
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    for (const [x, y, r, c] of [[0.2, 0.18, 0.5, 'rgba(99, 102, 241, 0.22)'], [0.78, 0.12, 0.45, 'rgba(34, 211, 238, 0.14)'], [0.55, 0.35, 0.6, 'rgba(192, 132, 252, 0.16)']] as const) {
        const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * Math.max(w, h))
        g.addColorStop(0, c)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
    }
    ctx.restore()

    // Sun behind the cabinet with god rays.
    const sx = w / 2
    const sy = h * 0.74
    const big = Math.max(w, h)
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    for (let i = 0; i < 18; i++) {
        const a = -Math.PI + (i / 17) * Math.PI + (rnd() - 0.5) * 0.08
        const spread = 0.025 + rnd() * 0.04
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, big)
        g.addColorStop(0, 'rgba(255, 214, 150, 0.2)')
        g.addColorStop(1, 'rgba(255, 214, 150, 0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx + Math.cos(a - spread) * big, sy + Math.sin(a - spread) * big)
        ctx.lineTo(sx + Math.cos(a + spread) * big, sy + Math.sin(a + spread) * big)
        ctx.closePath()
        ctx.fill()
    }
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, big * 0.45)
    sun.addColorStop(0, 'rgba(255, 244, 214, 0.95)')
    sun.addColorStop(0.08, 'rgba(255, 200, 120, 0.7)')
    sun.addColorStop(0.35, 'rgba(240, 120, 110, 0.25)')
    sun.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = sun
    ctx.fillRect(0, 0, w, h)
    ctx.restore()

    // Distant cloud ridges.
    for (let i = 0; i < 16; i++) {
        cloud(ctx, rnd() * w, h * (0.62 + rnd() * 0.08), w * 0.2, h * 0.08, rnd, 'rgba(255, 170, 150, 0.35)', 'rgba(120, 60, 120, 0.25)')
    }

    // Floating temples.
    const unit = Math.min(w, h)
    floatingTemple(ctx, w * 0.1, h * 0.46, unit * 0.12, rnd, 5)
    floatingTemple(ctx, w * 0.9, h * 0.4, unit * 0.1, rnd, 4)
    floatingTemple(ctx, w * 0.24, h * 0.24, unit * 0.05, rnd, 3)
    floatingTemple(ctx, w * 0.8, h * 0.18, unit * 0.045, rnd, 3)

    // Sea of clouds.
    for (let layer = 0; layer < 3; layer++) {
        const y = h * (0.8 + layer * 0.08)
        for (let i = 0; i < 14; i++) {
            cloud(ctx, (i / 13) * w + (rnd() - 0.5) * w * 0.1, y, w * 0.18, h * (0.1 + layer * 0.03), rnd,
                layer === 0 ? 'rgba(255, 190, 170, 0.55)' : layer === 1 ? 'rgba(200, 140, 190, 0.5)' : 'rgba(110, 70, 150, 0.6)',
                layer === 0 ? 'rgba(160, 90, 150, 0.35)' : 'rgba(60, 30, 90, 0.4)')
        }
    }

    // Vignette.
    const v = ctx.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.3, w / 2, h * 0.5, Math.max(w, h) * 0.8)
    v.addColorStop(0, 'rgba(0,0,0,0)')
    v.addColorStop(1, 'rgba(3, 2, 12, 0.75)')
    ctx.fillStyle = v
    ctx.fillRect(0, 0, w, h)
}
