// Trash Panda Heist artwork, painted procedurally on 2D canvases: reel
// symbols, sticky multiplier wilds, the Dumpster Dive pick items, particle
// sprites and the reel backdrop. Pixi turns the canvases into textures; the
// DOM (paytable, pick game, buy dialog, logo) uses the same paintings as data
// URLs. No image files are loaded.
//
// Style: bold cartoon stickers. Every shape is filled, cel-shaded (a shadow
// crescent on the lower right, a gloss on the upper left) and outlined in one
// thick ink colour. Painters work in a 256-unit square; `paintTphArt` scales to
// the requested pixel size. shadowBlur ignores the transform, so blur radii
// are multiplied by `k` (pixels per unit) by hand.

import type { TphSymbol } from '#shared/utils/gamelogic/trashpanda'

export type TphWildMult = 2 | 3 | 5 | 10
export const TPH_WILD_MULTS: TphWildMult[] = [2, 3, 5, 10]

export type TphArtId
    = TphSymbol
        | `wild${TphWildMult}`
        | 'can-closed' | 'dog' | 'key' | 'double' | 'coins' | 'raccoon'

export const TPH_DISPLAY_FONT = 'Bangers'
export const TPH_NUMBER_FONT = 'Lilita One'
export const TPH_UI_FONT = 'Fredoka'

const INK = '#1a1030'

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
    safe: { name: 'Safe', color: '#fbbf24' },
    bin: { name: 'Dumpster', color: '#4ade80' }
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

function rrect(x: number, y: number, w: number, h: number, r: number): Path2D {
    return path(p => p.roundRect(x, y, w, h, r))
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

/** A thick inked stroke with a coloured core (bones, stems, straps). */
function tube(ctx: Ctx, p: Path2D, color: string, width: number, outline = 8) {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.strokeStyle = INK
    ctx.lineWidth = width + outline
    ctx.stroke(p)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.stroke(p)
    ctx.restore()
}

/** Soft contact shadow under a symbol. */
function ground(ctx: Ctx, cx: number, cy: number, rx: number, ry = rx * 0.22) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1, ry / rx)
    ctx.fillStyle = radial(ctx, 0, 0, rx, [[0, 'rgba(8,4,24,0.5)'], [1, 'rgba(8,4,24,0)']])
    ctx.beginPath()
    ctx.arc(0, 0, rx, 0, Math.PI * 2)
    ctx.fill()
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

/** Comic lettering: ink outline, coloured fill with a gradient, white top gloss. */
function comicText(ctx: Ctx, text: string, cx: number, cy: number, size: number, maxW: number, fill: [number, string][], opts: { font?: (s: number) => string, rot?: number, outline?: number } = {}) {
    const f = opts.font ?? displayFont
    ctx.save()
    ctx.font = f(size)
    const w = ctx.measureText(text).width
    const sx = w > maxW ? maxW / w : 1
    ctx.translate(cx, cy)
    ctx.rotate(opts.rot ?? 0)
    ctx.scale(sx, 1)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    // Drop shadow block.
    ctx.fillStyle = INK
    ctx.lineWidth = opts.outline ?? Math.max(8, size * 0.2)
    ctx.strokeStyle = INK
    ctx.strokeText(text, 3, 5)
    ctx.fillText(text, 3, 5)
    ctx.strokeText(text, 0, 0)
    ctx.fillStyle = linear(ctx, 0, -size * 0.45, 0, size * 0.45, fill)
    ctx.fillText(text, 0, 0)
    ctx.restore()
}

// Low symbols: trash ---------------------------------------------------------

function paintFish(ctx: Ctx) {
    ground(ctx, 128, 214, 92)
    ctx.save()
    ctx.translate(128, 128)
    ctx.rotate(-0.18)
    ctx.translate(-128, -128)
    // Tail.
    const tail = path((p) => {
        p.moveTo(196, 128)
        p.lineTo(238, 88)
        p.quadraticCurveTo(228, 128, 238, 168)
        p.closePath()
    })
    blob(ctx, tail, '#e0f2fe', '#7aa7c7', { d: 8 })
    // Spine.
    tube(ctx, path((p) => {
        p.moveTo(92, 128)
        p.lineTo(204, 128)
    }), '#f8fafc', 12)
    // Ribs.
    for (let i = 0; i < 4; i++) {
        const x = 112 + i * 22
        const h = 40 - i * 5
        tube(ctx, path((p) => {
            p.moveTo(x + 8, 128 - h)
            p.quadraticCurveTo(x - 6, 128, x + 8, 128 + h)
        }), '#f8fafc', 9, 7)
    }
    // Head.
    const head = path((p) => {
        p.moveTo(100, 76)
        p.bezierCurveTo(52, 70, 20, 104, 22, 132)
        p.bezierCurveTo(24, 162, 58, 190, 100, 180)
        p.bezierCurveTo(116, 160, 118, 96, 100, 76)
        p.closePath()
    })
    blob(ctx, head, linear(ctx, 20, 70, 110, 190, [[0, '#f0f9ff'], [1, '#bae6fd']]), '#6b9ec4', { gloss: [58, 100, 20, 10, -0.5] })
    // X eye.
    ctx.save()
    ctx.strokeStyle = INK
    ctx.lineWidth = 8
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(62, 108)
    ctx.lineTo(82, 128)
    ctx.moveTo(82, 108)
    ctx.lineTo(62, 128)
    ctx.stroke()
    // Gaping mouth.
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.ellipse(34, 150, 10, 7, 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    // Stink lines.
    ctx.save()
    ctx.strokeStyle = 'rgba(190,242,100,0.9)'
    ctx.lineWidth = 5
    ctx.lineCap = 'round'
    for (const [x, y] of [[140, 50], [172, 40], [204, 56]] as const) {
        ctx.beginPath()
        ctx.moveTo(x, y + 24)
        ctx.bezierCurveTo(x - 10, y + 14, x + 10, y + 8, x, y - 4)
        ctx.stroke()
    }
    ctx.restore()
    ctx.restore()
}

/** Point and unit normal on a quadratic curve. */
function quadAt(p0: [number, number], p1: [number, number], p2: [number, number], t: number) {
    const u = 1 - t
    const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
    const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
    const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
    const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
    const len = Math.hypot(dx, dy) || 1
    return { x, y, nx: -dy / len, ny: dx / len }
}

/** A thick crescent along a quadratic curve between t0 and t1, `width(t)` half-widths. */
function crescent(p0: [number, number], p1: [number, number], p2: [number, number], t0: number, t1: number, width: (t: number) => number): Path2D {
    const steps = 36
    const a: [number, number][] = []
    const b: [number, number][] = []
    for (let i = 0; i <= steps; i++) {
        const t = t0 + (t1 - t0) * i / steps
        const q = quadAt(p0, p1, p2, t)
        const w = width(t)
        a.push([q.x + q.nx * w, q.y + q.ny * w])
        b.push([q.x - q.nx * w, q.y - q.ny * w])
    }
    return path((p) => {
        p.moveTo(a[0]![0], a[0]![1])
        for (const [x, y] of a.slice(1)) p.lineTo(x, y)
        for (const [x, y] of b.reverse()) p.lineTo(x, y)
        p.closePath()
    })
}

function paintBanana(ctx: Ctx) {
    ground(ctx, 128, 222, 100)
    // A half-peeled banana: the curved stalk end still in its yellow peel,
    // the pale fruit sticking up to the right, and three peel strips hanging
    // off where the peel was pulled back.
    const P0: [number, number] = [40, 196]
    const P1: [number, number] = [164, 228]
    const P2: [number, number] = [222, 60]
    const RIM = 0.55
    const peel = linear(ctx, 30, 120, 190, 230, [[0, '#fff27a'], [0.45, '#facc15'], [1, '#e0a800']])
    const inside = '#fff4c2'
    const fruitFill = linear(ctx, 150, 40, 210, 170, [[0, '#fffdf2'], [1, '#fbe3a0']])

    // Local frame at the rim: +x runs up the banana, +y is the lower-right side.
    const rim = quadAt(P0, P1, P2, RIM)
    const ax = rim.ny
    const ay = -rim.nx
    const L = (x: number, y: number): [number, number] => [rim.x + ax * x + rim.nx * y, rim.y + ay * x + rim.ny * y]
    // A peel strip from the rim (root between y0 and y1) to a tip, with its
    // pale inner face showing along one edge.
    const strip = (rootY: number, tip: [number, number], width: number, bend: number, innerSide: 0 | 1) => {
        const rc = L(0, rootY)
        const t = L(tip[0], tip[1])
        const dx = t[0] - rc[0]
        const dy = t[1] - rc[1]
        const len = Math.hypot(dx, dy) || 1
        const ux = -dy / len
        const uy = dx / len
        const r0: [number, number] = [rc[0] + ux * width / 2, rc[1] + uy * width / 2]
        const r1: [number, number] = [rc[0] - ux * width / 2, rc[1] - uy * width / 2]
        const px = ux * bend
        const py = uy * bend
        const c0: [number, number] = [r0[0] + dx * 0.55 + px, r0[1] + dy * 0.55 + py]
        const c1: [number, number] = [r1[0] + dx * 0.55 + px, r1[1] + dy * 0.55 + py]
        const shape = path((p) => {
            p.moveTo(r0[0], r0[1])
            p.quadraticCurveTo(c0[0], c0[1], t[0], t[1])
            p.quadraticCurveTo(c1[0], c1[1], r1[0], r1[1])
            p.closePath()
        })
        blob(ctx, shape, peel, '#b98b07', { d: 6 })
        // Pale inner face along one edge.
        ctx.save()
        ctx.clip(shape)
        ctx.fillStyle = inside
        const e = innerSide === 0 ? r0 : r1
        const ec = innerSide === 0 ? c0 : c1
        const mid: [number, number] = [(r0[0] + r1[0]) / 2 + dx * 0.5 + px * 0.6, (r0[1] + r1[1]) / 2 + dy * 0.5 + py * 0.6]
        ctx.fill(path((p) => {
            p.moveTo(e[0], e[1])
            p.quadraticCurveTo(ec[0], ec[1], t[0], t[1])
            p.quadraticCurveTo(mid[0], mid[1], (e[0] + (r0[0] + r1[0]) / 2) / 2, (e[1] + (r0[1] + r1[1]) / 2) / 2)
            p.closePath()
        }))
        ctx.restore()
        ink(ctx, shape)
    }

    // Back strip, flopped over to the upper left.
    strip(-20, [-40, -90], 30, 8, 0)

    // The peeled fruit, narrower than the peel, with a round tip.
    const fruit = crescent(P0, P1, P2, RIM - 0.05, 0.985, (t) => {
        const end = Math.min(1, (0.985 - t) / 0.12)
        return 24 * Math.sqrt(Math.max(0.03, end))
    })
    blob(ctx, fruit, fruitFill, '#efc766', { d: 7, gloss: [184, 104, 5, 20, 0.4], glossAlpha: 0.8 })

    // The unpeeled stalk end.
    const body = crescent(P0, P1, P2, 0.02, RIM + 0.02, (t) => {
        const end = Math.min(1, (t - 0.02) / 0.2)
        return 34 * Math.sqrt(Math.max(0.06, end))
    })
    blob(ctx, body, peel, '#b98b07', { d: 10, gloss: [96, 188, 26, 7, 0.1] })
    // Ridge along the peel.
    ctx.save()
    ctx.clip(body)
    ctx.strokeStyle = 'rgba(150,100,0,0.55)'
    ctx.lineWidth = 3.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = 0; i <= 16; i++) {
        const q = quadAt(P0, P1, P2, 0.08 + (RIM - 0.08) * i / 16)
        if (i === 0) ctx.moveTo(q.x - q.nx * 9, q.y - q.ny * 9)
        else ctx.lineTo(q.x - q.nx * 9, q.y - q.ny * 9)
    }
    ctx.stroke()
    ctx.restore()
    // Dark stalk tip.
    const tip = quadAt(P0, P1, P2, 0.015)
    blob(ctx, ellipse(tip.x, tip.y, 9, 11, 0.3), '#5b3d0a', '#3a2606', { d: 4, line: 7 })
    // Brown spots.
    ctx.save()
    ctx.fillStyle = '#7c5a12'
    for (const [t, off, r] of [[0.16, 8, 4], [0.28, 12, 5], [0.4, 6, 4]] as const) {
        const q = quadAt(P0, P1, P2, t)
        ctx.beginPath()
        ctx.arc(q.x + q.nx * off, q.y + q.ny * off, r, 0, Math.PI * 2)
        ctx.fill()
    }
    ctx.restore()

    // Middle strip over the peel, and the front strip hanging to the ground.
    strip(2, [-72, 18], 28, 6, 0)
    strip(22, [-24, 80], 30, -8, 1)
}

function paintCan(ctx: Ctx) {
    ground(ctx, 128, 220, 90)
    ctx.save()
    ctx.translate(128, 132)
    ctx.rotate(0.28)
    ctx.translate(-128, -132)
    // Dented can body.
    const body = path((p) => {
        p.moveTo(76, 58)
        p.lineTo(180, 58)
        p.lineTo(184, 112)
        p.lineTo(170, 132)
        p.lineTo(186, 150)
        p.lineTo(180, 210)
        p.lineTo(76, 210)
        p.lineTo(70, 150)
        p.lineTo(88, 134)
        p.lineTo(72, 112)
        p.closePath()
    })
    blob(ctx, body, linear(ctx, 70, 0, 186, 0, [[0, '#b91c1c'], [0.3, '#f87171'], [0.55, '#ef4444'], [1, '#7f1d1d']]), '#7f1d1d', { d: 10, gloss: [100, 100, 9, 36, 0] })
    // White wave stripe.
    ctx.save()
    ctx.clip(body)
    ctx.fillStyle = '#fff5f5'
    ctx.beginPath()
    ctx.moveTo(60, 150)
    ctx.bezierCurveTo(100, 120, 140, 190, 200, 150)
    ctx.lineTo(200, 170)
    ctx.bezierCurveTo(140, 206, 100, 140, 60, 172)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    ink(ctx, body)
    // Dent crease.
    ctx.save()
    ctx.strokeStyle = 'rgba(26,16,48,0.55)'
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(90, 134)
    ctx.lineTo(120, 128)
    ctx.moveTo(168, 132)
    ctx.lineTo(142, 138)
    ctx.stroke()
    ctx.restore()
    // Lid, rim and ring pull.
    blob(ctx, ellipse(128, 58, 54, 14), linear(ctx, 74, 44, 182, 72, [[0, '#f1f5f9'], [1, '#94a3b8']]), '#64748b', { d: 4, line: 8 })
    blob(ctx, ellipse(128, 210, 52, 12), '#cbd5e1', '#64748b', { d: 3, line: 8 })
    tube(ctx, path(p => p.ellipse(140, 52, 12, 5, 0, 0, Math.PI * 2)), '#e2e8f0', 4, 5)
    ctx.restore()
    // Fizz drops.
    for (const [x, y, r] of [[60, 60, 8], [44, 88, 5], [70, 36, 5]] as const) {
        blob(ctx, ellipse(x, y, r, r), '#fecaca', '#f87171', { d: 2, line: 5 })
    }
}

function paintApple(ctx: Ctx) {
    ground(ctx, 128, 222, 76)
    const red = linear(ctx, 60, 30, 200, 230, [[0, '#fb7185'], [0.45, '#e11d48'], [1, '#881337']])
    // Core silhouette: round caps with a pinched middle.
    const core = path((p) => {
        p.moveTo(80, 64)
        p.bezierCurveTo(60, 40, 100, 30, 128, 44)
        p.bezierCurveTo(156, 30, 196, 40, 176, 64)
        p.bezierCurveTo(150, 90, 150, 160, 178, 188)
        p.bezierCurveTo(196, 214, 156, 226, 128, 216)
        p.bezierCurveTo(100, 226, 60, 214, 78, 188)
        p.bezierCurveTo(106, 160, 106, 90, 80, 64)
        p.closePath()
    })
    blob(ctx, core, '#fff4d6', '#e7c98f', { d: 10, gloss: [108, 130, 8, 30, 0] })
    // Red skin caps.
    ctx.save()
    ctx.clip(core)
    ctx.fillStyle = red
    ctx.fill(path((p) => {
        p.moveTo(40, 20)
        p.lineTo(216, 20)
        p.lineTo(216, 70)
        p.bezierCurveTo(170, 84, 86, 84, 40, 70)
        p.closePath()
    }))
    ctx.fill(path((p) => {
        p.moveTo(40, 236)
        p.lineTo(216, 236)
        p.lineTo(216, 190)
        p.bezierCurveTo(170, 176, 86, 176, 40, 190)
        p.closePath()
    }))
    ctx.globalAlpha = 0.55
    ctx.fillStyle = '#ffffff'
    ctx.fill(ellipse(96, 52, 14, 6, -0.3))
    ctx.restore()
    ink(ctx, core)
    // Bite marks.
    ctx.save()
    ctx.strokeStyle = 'rgba(26,16,48,0.45)'
    ctx.lineWidth = 3
    for (const y of [104, 126, 148]) {
        ctx.beginPath()
        ctx.arc(104, y, 7, -1.2, 1.2)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(152, y, 7, Math.PI - 1.2, Math.PI + 1.2)
        ctx.stroke()
    }
    ctx.restore()
    // Seeds.
    for (const [x, y, r] of [[118, 128, -0.3], [138, 128, 0.3]] as const) {
        blob(ctx, ellipse(x, y, 5, 9, r), '#4a2c14', '#2b180a', { d: 2, line: 4 })
    }
    // Stem and leaf.
    tube(ctx, path((p) => {
        p.moveTo(128, 46)
        p.quadraticCurveTo(122, 26, 132, 12)
    }), '#6b4423', 7, 7)
    blob(ctx, path((p) => {
        p.moveTo(132, 26)
        p.bezierCurveTo(150, 4, 184, 8, 192, 20)
        p.bezierCurveTo(176, 36, 148, 38, 132, 26)
        p.closePath()
    }), '#4ade80', '#15803d', { d: 5, line: 7 })
}

function paintPizza(ctx: Ctx) {
    ground(ctx, 128, 222, 84)
    const slice = path((p) => {
        p.moveTo(46, 58)
        p.quadraticCurveTo(128, 20, 210, 58)
        p.lineTo(132, 222)
        p.quadraticCurveTo(128, 230, 124, 222)
        p.closePath()
    })
    blob(ctx, slice, linear(ctx, 0, 40, 0, 220, [[0, '#fde68a'], [1, '#fbbf24']]), '#d97706', { d: 12, gloss: [110, 96, 10, 28, -0.2] })
    // Cheese drip.
    blob(ctx, path((p) => {
        p.moveTo(150, 140)
        p.bezierCurveTo(152, 170, 172, 176, 170, 150)
        p.lineTo(166, 130)
        p.closePath()
    }), '#fcd34d', '#d97706', { d: 4, line: 7 })
    // Pepperoni.
    for (const [x, y, r] of [[96, 88, 17], [156, 92, 15], [124, 134, 16], [118, 186, 11]] as const) {
        blob(ctx, ellipse(x, y, r, r * 0.92), radial(ctx, x - 4, y - 4, r, [[0, '#f87171'], [1, '#b91c1c']]), '#7f1d1d', { d: 4, line: 6 })
        ctx.save()
        ctx.fillStyle = 'rgba(255,255,255,0.45)'
        ctx.beginPath()
        ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
    }
    // Crust.
    blob(ctx, path((p) => {
        p.moveTo(40, 60)
        p.quadraticCurveTo(128, 14, 216, 60)
        p.quadraticCurveTo(222, 76, 206, 78)
        p.quadraticCurveTo(128, 42, 50, 78)
        p.quadraticCurveTo(34, 76, 40, 60)
        p.closePath()
    }), linear(ctx, 0, 30, 0, 80, [[0, '#e8a765'], [1, '#b45309']]), '#7c2d12', { d: 5, gloss: [100, 44, 30, 5, -0.25] })
}

function paintDonut(ctx: Ctx, bitten = true) {
    ground(ctx, 128, 214, 96)
    const dough = path((p) => {
        p.ellipse(128, 132, 96, 84, 0, 0, Math.PI * 2)
        p.ellipse(128, 128, 30, 24, 0, 0, Math.PI * 2)
    })
    const bite = ellipse(212, 92, 30, 30)
    ctx.save()
    if (bitten) {
        // Cut the bite out of the whole donut.
        const clip = new Path2D()
        clip.rect(0, 0, 256, 256)
        clip.addPath(bite)
        ctx.clip(clip, 'evenodd')
    }
    ctx.fillStyle = linear(ctx, 0, 50, 0, 220, [[0, '#f5c27a'], [1, '#c07a2c']])
    ctx.fill(dough, 'evenodd')
    // Frosting with a wavy edge.
    const frosting = path((p) => {
        const n = 14
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2
            const r = 84 + (i % 2 ? 6 : -2)
            const x = 128 + Math.cos(a) * r
            const y = 126 + Math.sin(a) * r * 0.86
            if (i === 0) p.moveTo(x, y)
            else p.quadraticCurveTo(128 + Math.cos(a - Math.PI / n) * (r + 6), 126 + Math.sin(a - Math.PI / n) * (r + 6) * 0.86, x, y)
        }
        p.closePath()
        p.ellipse(128, 124, 36, 29, 0, 0, Math.PI * 2)
    })
    ctx.fillStyle = linear(ctx, 0, 40, 0, 210, [[0, '#fbcfe8'], [0.5, '#f472b6'], [1, '#db2777']])
    ctx.fill(frosting, 'evenodd')
    ctx.save()
    ctx.clip(frosting, 'evenodd')
    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#ffffff'
    ctx.fill(ellipse(80, 84, 28, 10, -0.6))
    ctx.restore()
    // Sprinkles.
    const colors = ['#fde047', '#60a5fa', '#4ade80', '#ffffff', '#a78bfa', '#fb923c']
    const spots: [number, number, number][] = [[70, 110, 0.4], [96, 76, 1.2], [150, 70, 2.3], [184, 104, 0.9], [180, 160, 1.8], [138, 184, 0.3], [86, 170, 2.6], [58, 140, 1.4], [116, 64, 0.1], [196, 136, 2.9], [110, 184, 1.1], [164, 176, 0.6]]
    spots.forEach(([x, y, r], i) => {
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(r)
        ctx.fillStyle = colors[i % colors.length]!
        ctx.strokeStyle = INK
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.roundRect(-9, -3.5, 18, 7, 3.5)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
    })
    ctx.restore()
    ctx.save()
    if (bitten) {
        const clip = new Path2D()
        clip.rect(-20, -20, 300, 300)
        clip.addPath(ellipse(212, 92, 26, 26))
        ctx.clip(clip, 'evenodd')
    }
    ink(ctx, path((p) => {
        p.ellipse(128, 132, 96, 84, 0, 0, Math.PI * 2)
    }))
    ctx.restore()
    ink(ctx, ellipse(128, 128, 30, 24), 8)
    if (bitten) {
        ctx.save()
        ctx.beginPath()
        ctx.ellipse(128, 132, 101, 89, 0, 0, Math.PI * 2)
        ctx.clip()
        ctx.lineWidth = 9
        ctx.strokeStyle = INK
        ctx.beginPath()
        ctx.arc(212, 92, 30, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
        // Crumbs.
        for (const [x, y, r] of [[222, 150, 5], [236, 138, 3.5], [196, 40, 4]] as const) {
            blob(ctx, ellipse(x, y, r, r), '#e0a458', '#a16207', { d: 1, line: 3.5 })
        }
    }
}

// High symbols: loot ----------------------------------------------------------

function paintCash(ctx: Ctx) {
    ground(ctx, 128, 214, 104)
    const green = linear(ctx, 0, 60, 0, 200, [[0, '#86efac'], [1, '#16a34a']])
    // Stack of bills, back to front.
    for (let i = 3; i >= 0; i--) {
        const y = 92 + i * 22
        const x = 30 + (i % 2 ? 8 : 0)
        const bill = path((p) => {
            p.moveTo(x, y + 12)
            p.lineTo(x + 180, y)
            p.lineTo(x + 196, y + 56)
            p.lineTo(x + 16, y + 68)
            p.closePath()
        })
        blob(ctx, bill, green, '#166534', { d: 6, line: 8 })
    }
    // Top bill details.
    const x0 = 30
    const y0 = 92
    ctx.save()
    ctx.strokeStyle = 'rgba(20,83,45,0.8)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(x0 + 14, y0 + 18)
    ctx.lineTo(x0 + 178, y0 + 8)
    ctx.lineTo(x0 + 188, y0 + 50)
    ctx.lineTo(x0 + 24, y0 + 60)
    ctx.closePath()
    ctx.stroke()
    ctx.restore()
    blob(ctx, ellipse(x0 + 100, y0 + 34, 22, 20, -0.07), '#dcfce7', '#86efac', { d: 3, line: 5 })
    ctx.save()
    ctx.font = displayFont(36)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#14532d'
    ctx.translate(x0 + 100, y0 + 36)
    ctx.rotate(-0.07)
    ctx.fillText('$', 0, 0)
    ctx.restore()
    // Paper band.
    blob(ctx, path((p) => {
        p.moveTo(98, 84)
        p.lineTo(128, 82)
        p.lineTo(140, 204)
        p.lineTo(110, 206)
        p.closePath()
    }), '#fde68a', '#d97706', { d: 4, line: 7 })
    for (const [x, y] of [[40, 70], [222, 62]] as const) sparkle(ctx, x, y, 12, '#fef9c3')
}

function paintBag(ctx: Ctx) {
    ground(ctx, 128, 224, 92)
    const sack = path((p) => {
        p.moveTo(104, 78)
        p.bezierCurveTo(40, 100, 24, 170, 46, 208)
        p.bezierCurveTo(70, 234, 186, 234, 210, 208)
        p.bezierCurveTo(232, 170, 216, 100, 152, 78)
        p.closePath()
    })
    blob(ctx, sack, linear(ctx, 30, 80, 220, 230, [[0, '#9ca3af'], [0.5, '#6b7280'], [1, '#374151']]), '#1f2937', { d: 14, gloss: [80, 130, 16, 34, 0.3], glossAlpha: 0.3 })
    // Patch.
    blob(ctx, path((p) => {
        p.moveTo(162, 172)
        p.lineTo(196, 168)
        p.lineTo(198, 198)
        p.lineTo(164, 202)
        p.closePath()
    }), '#a16207', '#713f12', { d: 3, line: 6 })
    ctx.save()
    ctx.strokeStyle = '#fef3c7'
    ctx.setLineDash([5, 5])
    ctx.lineWidth = 2.5
    ctx.strokeRect(168, 174, 24, 22)
    ctx.restore()
    // Neck and tie.
    const neck = path((p) => {
        p.moveTo(100, 82)
        p.bezierCurveTo(96, 60, 84, 40, 76, 30)
        p.bezierCurveTo(110, 40, 146, 40, 180, 30)
        p.bezierCurveTo(172, 40, 160, 60, 156, 82)
        p.closePath()
    })
    blob(ctx, neck, '#6b7280', '#374151', { d: 6 })
    blob(ctx, rrect(94, 72, 68, 18, 9), '#b45309', '#78350f', { d: 4, line: 7 })
    // Big dollar sign.
    comicText(ctx, '$', 128, 158, 104, 120, [[0, '#fef9c3'], [0.5, '#facc15'], [1, '#ca8a04']], { outline: 12 })
    // Peeking coins.
    for (const [x, y] of [[100, 46], [150, 40]] as const) {
        blob(ctx, ellipse(x, y, 16, 12), radial(ctx, x - 4, y - 4, 16, [[0, '#fef08a'], [1, '#d97706']]), '#92400e', { d: 3, line: 6 })
    }
}

function paintGem(ctx: Ctx) {
    ground(ctx, 128, 222, 86)
    ctx.save()
    ctx.shadowColor = 'rgba(103,232,249,0.9)'
    ctx.shadowBlur = 0
    const outline = path((p) => {
        p.moveTo(60, 94)
        p.lineTo(94, 50)
        p.lineTo(162, 50)
        p.lineTo(196, 94)
        p.lineTo(128, 212)
        p.closePath()
    })
    ctx.fillStyle = '#22d3ee'
    ctx.fill(outline)
    ctx.restore()
    // Facets.
    const facets: [string, number[]][] = [
        ['#cffafe', [60, 94, 94, 50, 108, 94]],
        ['#a5f3fc', [94, 50, 128, 50, 108, 94]],
        ['#ecfeff', [128, 50, 148, 94, 108, 94]],
        ['#67e8f9', [128, 50, 162, 50, 148, 94]],
        ['#22d3ee', [162, 50, 196, 94, 148, 94]],
        ['#06b6d4', [60, 94, 108, 94, 128, 212]],
        ['#67e8f9', [108, 94, 148, 94, 128, 212]],
        ['#0e7490', [148, 94, 196, 94, 128, 212]]
    ]
    for (const [color, pts] of facets) {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(pts[0]!, pts[1]!)
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = 'rgba(8,51,68,0.5)'
        ctx.lineWidth = 2.5
        ctx.stroke()
    }
    ink(ctx, outline, 9)
    sparkle(ctx, 88, 72, 18)
    sparkle(ctx, 190, 150, 14, '#ecfeff')
    sparkle(ctx, 60, 170, 10, '#ecfeff', 0.9)
}

// The Boss: a raccoon in a fedora with a gold tooth. Shared by the logo.
function paintRaccoon(ctx: Ctx, hat = true) {
    ground(ctx, 128, 230, 90)
    const fur = linear(ctx, 0, 40, 0, 220, [[0, '#a8a29e'], [1, '#57534e']])
    // Ears.
    for (const side of [-1, 1]) {
        const ear = path((p) => {
            p.moveTo(128 + side * 50, 96)
            p.bezierCurveTo(128 + side * 60, 50, 128 + side * 88, 38, 128 + side * 100, 50)
            p.bezierCurveTo(128 + side * 108, 74, 128 + side * 100, 100, 128 + side * 86, 118)
            p.closePath()
        })
        blob(ctx, ear, fur, '#44403c', { d: 6 })
        blob(ctx, path((p) => {
            p.moveTo(128 + side * 62, 96)
            p.bezierCurveTo(128 + side * 70, 66, 128 + side * 86, 58, 128 + side * 92, 64)
            p.bezierCurveTo(128 + side * 96, 80, 128 + side * 90, 96, 128 + side * 82, 106)
            p.closePath()
        }), '#292524', '#1c1917', { d: 3, line: 5, noShade: true })
    }
    // Head: wide at the cheeks with fluffy tufts.
    const head = path((p) => {
        p.moveTo(128, 70)
        p.bezierCurveTo(176, 70, 210, 96, 216, 140)
        p.lineTo(236, 150)
        p.lineTo(214, 162)
        p.lineTo(228, 178)
        p.bezierCurveTo(200, 206, 160, 218, 128, 218)
        p.bezierCurveTo(96, 218, 56, 206, 28, 178)
        p.lineTo(42, 162)
        p.lineTo(20, 150)
        p.lineTo(40, 140)
        p.bezierCurveTo(46, 96, 80, 70, 128, 70)
        p.closePath()
    })
    blob(ctx, head, fur, '#44403c', { d: 12 })
    // White brow patches and muzzle.
    ctx.save()
    ctx.clip(head)
    ctx.fillStyle = '#f5f5f4'
    ctx.fill(path((p) => {
        p.moveTo(128, 196)
        p.bezierCurveTo(84, 196, 60, 170, 70, 150)
        p.bezierCurveTo(90, 160, 110, 152, 128, 140)
        p.bezierCurveTo(146, 152, 166, 160, 186, 150)
        p.bezierCurveTo(196, 170, 172, 196, 128, 196)
        p.closePath()
    }))
    ctx.fill(ellipse(88, 104, 22, 10, -0.3))
    ctx.fill(ellipse(168, 104, 22, 10, 0.3))
    ctx.restore()
    ink(ctx, head)
    // The mask band.
    const mask = path((p) => {
        p.moveTo(34, 128)
        p.bezierCurveTo(50, 104, 96, 104, 128, 124)
        p.bezierCurveTo(160, 104, 206, 104, 222, 128)
        p.bezierCurveTo(212, 156, 170, 160, 128, 142)
        p.bezierCurveTo(86, 160, 44, 156, 34, 128)
        p.closePath()
    })
    blob(ctx, mask, '#1c1917', '#0c0a09', { d: 4, line: 6, gloss: [84, 116, 26, 5, -0.2], glossAlpha: 0.22 })
    // Shifty eyes looking to the side.
    for (const side of [-1, 1]) {
        const ex = 128 + side * 42
        blob(ctx, ellipse(ex, 130, 17, 13), '#ffffff', '#d6d3d1', { d: 3, line: 5 })
        ctx.fillStyle = INK
        ctx.beginPath()
        ctx.arc(ex + 7, 131, 7.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(ex + 9.5, 128, 2.6, 0, Math.PI * 2)
        ctx.fill()
        // Heavy lid for the smug look.
        ctx.fillStyle = '#1c1917'
        ctx.beginPath()
        ctx.ellipse(ex, 124, 19, 8, 0, Math.PI, 0)
        ctx.fill()
    }
    // Nose.
    blob(ctx, ellipse(128, 164, 15, 10), '#1c1917', '#000000', { d: 2, line: 5, gloss: [123, 160, 5, 2.5, 0], glossAlpha: 0.7 })
    // Grin with a gold tooth.
    ctx.save()
    ctx.lineCap = 'round'
    ctx.strokeStyle = INK
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(100, 180)
    ctx.quadraticCurveTo(128, 200, 160, 176)
    ctx.stroke()
    ctx.restore()
    blob(ctx, rrect(134, 184, 11, 11, 2), '#facc15', '#a16207', { d: 2, line: 4 })
    // Whiskers.
    ctx.save()
    ctx.strokeStyle = 'rgba(26,16,48,0.6)'
    ctx.lineWidth = 2.5
    for (const side of [-1, 1]) {
        for (const dy of [-4, 6]) {
            ctx.beginPath()
            ctx.moveTo(128 + side * 34, 172 + dy)
            ctx.lineTo(128 + side * 70, 166 + dy * 2)
            ctx.stroke()
        }
    }
    ctx.restore()
    if (!hat) return
    // Fedora, tipped.
    ctx.save()
    ctx.translate(128, 70)
    ctx.rotate(-0.12)
    const brim = ellipse(0, 6, 92, 16)
    blob(ctx, brim, '#3f3f46', '#18181b', { d: 5, line: 8 })
    const crown = path((p) => {
        p.moveTo(-58, 6)
        p.bezierCurveTo(-60, -30, -50, -54, -30, -58)
        p.quadraticCurveTo(0, -44, 30, -58)
        p.bezierCurveTo(50, -54, 60, -30, 58, 6)
        p.closePath()
    })
    blob(ctx, crown, linear(ctx, 0, -60, 0, 6, [[0, '#52525b'], [1, '#27272a']]), '#18181b', { d: 8, gloss: [-34, -30, 8, 18, 0.2], glossAlpha: 0.25 })
    blob(ctx, path((p) => {
        p.moveTo(-58, -6)
        p.lineTo(58, -6)
        p.lineTo(58, 6)
        p.lineTo(-58, 6)
        p.closePath()
    }), '#dc2626', '#991b1b', { d: 2, line: 6 })
    ctx.restore()
}

// Specials ----------------------------------------------------------------------

function paintMask(ctx: Ctx, cy: number, scale = 1) {
    ctx.save()
    ctx.translate(128, cy)
    ctx.scale(scale, scale)
    ctx.translate(-128, -cy)
    const mask = path((p) => {
        p.moveTo(20, cy - 6)
        p.bezierCurveTo(40, cy - 44, 100, cy - 44, 128, cy - 18)
        p.bezierCurveTo(156, cy - 44, 216, cy - 44, 236, cy - 6)
        p.bezierCurveTo(226, cy + 32, 170, cy + 42, 128, cy + 16)
        p.bezierCurveTo(86, cy + 42, 30, cy + 32, 20, cy - 6)
        p.closePath()
        p.ellipse(84, cy - 4, 24, 14, 0.15, 0, Math.PI * 2)
        p.ellipse(172, cy - 4, 24, 14, -0.15, 0, Math.PI * 2)
    })
    ctx.save()
    ctx.fillStyle = linear(ctx, 0, cy - 44, 0, cy + 40, [[0, '#3f3f46'], [0.5, '#18181b'], [1, '#09090b']])
    ctx.fill(mask, 'evenodd')
    ctx.clip(mask, 'evenodd')
    ctx.globalAlpha = 0.3
    ctx.fillStyle = '#ffffff'
    ctx.fill(ellipse(70, cy - 26, 30, 6, -0.25))
    ctx.fill(ellipse(186, cy - 26, 30, 6, 0.25))
    ctx.restore()
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.lineWidth = 8
    ctx.strokeStyle = INK
    ctx.stroke(mask)
    ctx.restore()
    // Straps.
    tube(ctx, path((p) => {
        p.moveTo(22, cy - 6)
        p.quadraticCurveTo(6, cy + 4, 10, cy + 26)
    }), '#18181b', 7, 5)
    tube(ctx, path((p) => {
        p.moveTo(234, cy - 6)
        p.quadraticCurveTo(250, cy + 4, 246, cy + 26)
    }), '#18181b', 7, 5)
    // Eyes glinting in the holes.
    for (const x of [84, 172]) {
        ctx.fillStyle = '#fef08a'
        ctx.beginPath()
        ctx.arc(x + 4, cy - 4, 6, 0, Math.PI * 2)
        ctx.fill()
    }
    ctx.restore()
}

function paintWild(ctx: Ctx, mult?: TphWildMult) {
    // Gold starburst badge behind the mask.
    ctx.save()
    ctx.shadowColor = 'rgba(250,204,21,0.8)'
    ctx.shadowBlur = 0
    const burst = path((p) => {
        const n = 16
        for (let i = 0; i < n * 2; i++) {
            const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2
            const r = i % 2 ? 94 : 116
            const x = 128 + Math.cos(a) * r
            const y = 128 + Math.sin(a) * r
            if (i === 0) p.moveTo(x, y)
            else p.lineTo(x, y)
        }
        p.closePath()
    })
    blob(ctx, burst, radial(ctx, 128, 110, 120, [[0, '#fff7c2'], [0.45, '#facc15'], [1, '#b45309']]), '#a16207', { d: 10, line: 8 })
    ctx.restore()
    ctx.save()
    ctx.globalAlpha = 0.35
    ctx.strokeStyle = '#fffbeb'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(128, 128, 82, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    paintMask(ctx, 104, 0.82)
    comicText(ctx, 'WILD', 128, 178, 66, 170, [[0, '#ffffff'], [0.55, '#fde047'], [1, '#f59e0b']], { rot: -0.06 })
    if (mult) {
        const color = TPH_WILD_COLORS[mult]
        const badge = ellipse(190, 58, 40, 36)
        blob(ctx, badge, radial(ctx, 184, 48, 44, [[0, '#ffffff'], [0.35, color], [1, color]]), 'rgba(0,0,0,0.35)', { d: 7, line: 8 })
        comicText(ctx, `×${mult}`, 190, 60, mult === 10 ? 38 : 44, 64, [[0, '#ffffff'], [1, '#fef9c3']], { font: numberFont, outline: 9 })
    }
}

function paintSafe(ctx: Ctx) {
    ground(ctx, 128, 230, 100)
    // Glow.
    ctx.save()
    ctx.fillStyle = radial(ctx, 128, 128, 128, [[0, 'rgba(250,204,21,0.45)'], [0.6, 'rgba(250,204,21,0.12)'], [1, 'rgba(250,204,21,0)']])
    ctx.fillRect(0, 0, 256, 256)
    ctx.restore()
    const box = rrect(34, 36, 188, 180, 18)
    blob(ctx, box, linear(ctx, 0, 36, 0, 216, [[0, '#94a3b8'], [0.5, '#475569'], [1, '#1e293b']]), '#0f172a', { d: 12, gloss: [70, 60, 30, 10, -0.2], glossAlpha: 0.35 })
    // Door.
    blob(ctx, rrect(52, 52, 152, 148, 12), linear(ctx, 52, 52, 204, 200, [[0, '#cbd5e1'], [1, '#64748b']]), '#334155', { d: 8, line: 7 })
    // Rivets.
    for (const [x, y] of [[62, 62], [194, 62], [62, 190], [194, 190]] as const) {
        blob(ctx, ellipse(x, y, 5, 5), '#e2e8f0', '#64748b', { d: 1.5, line: 3 })
    }
    // Hinges.
    for (const y of [78, 170]) blob(ctx, rrect(40, y - 10, 16, 20, 4), '#334155', '#0f172a', { d: 2, line: 5 })
    // Gold dial.
    blob(ctx, ellipse(128, 124, 46, 46), radial(ctx, 116, 110, 50, [[0, '#fef9c3'], [0.5, '#facc15'], [1, '#a16207']]), '#854d0e', { d: 6, line: 7 })
    ctx.save()
    ctx.strokeStyle = INK
    ctx.lineWidth = 3
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(128 + Math.cos(a) * 34, 124 + Math.sin(a) * 34)
        ctx.lineTo(128 + Math.cos(a) * 42, 124 + Math.sin(a) * 42)
        ctx.stroke()
    }
    ctx.restore()
    blob(ctx, ellipse(128, 124, 22, 22), '#1e293b', '#0f172a', { d: 3, line: 5 })
    tube(ctx, path((p) => {
        p.moveTo(128, 124)
        p.lineTo(128, 104)
    }), '#facc15', 6, 5)
    // Handle.
    tube(ctx, path((p) => {
        p.moveTo(176, 150)
        p.lineTo(176, 186)
    }), '#e2e8f0', 9, 7)
    // "SAFE" plate.
    blob(ctx, rrect(80, 176, 84, 26, 8), '#dc2626', '#991b1b', { d: 3, line: 6 })
    ctx.save()
    ctx.font = displayFont(26)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#fff7ed'
    ctx.fillText('SAFE', 122, 190)
    ctx.restore()
    sparkle(ctx, 212, 38, 16, '#fef9c3')
    sparkle(ctx, 36, 206, 11, '#fef9c3', 0.9)
}

function paintBin(ctx: Ctx) {
    ground(ctx, 128, 232, 108)
    // Wheels.
    for (const x of [62, 194]) blob(ctx, ellipse(x, 214, 14, 14), '#27272a', '#09090b', { d: 3, line: 6 })
    // Body (trapezoid).
    const body = path((p) => {
        p.moveTo(24, 96)
        p.lineTo(232, 96)
        p.lineTo(216, 212)
        p.lineTo(40, 212)
        p.closePath()
    })
    blob(ctx, body, linear(ctx, 0, 96, 0, 212, [[0, '#22c55e'], [1, '#14532d']]), '#14532d', { d: 12, gloss: [60, 126, 12, 26, 0.1], glossAlpha: 0.3 })
    // Ribs.
    ctx.save()
    ctx.clip(body)
    ctx.strokeStyle = 'rgba(5,46,22,0.6)'
    ctx.lineWidth = 5
    for (const x of [84, 128, 172]) {
        ctx.beginPath()
        ctx.moveTo(x, 104)
        ctx.lineTo(x, 206)
        ctx.stroke()
    }
    ctx.restore()
    // Stencil label.
    blob(ctx, rrect(92, 150, 72, 30, 6), '#fde047', '#ca8a04', { d: 3, line: 6 })
    ctx.save()
    ctx.font = displayFont(24)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = INK
    ctx.fillText('TRASH', 128, 166)
    ctx.restore()
    // Dark gap under the propped lid with glowing eyes.
    const gap = path((p) => {
        p.moveTo(30, 96)
        p.lineTo(226, 96)
        p.lineTo(214, 70)
        p.lineTo(44, 58)
        p.closePath()
    })
    ctx.fillStyle = '#0a0612'
    ctx.fill(gap)
    for (const [x, y] of [[104, 80], [140, 82]] as const) {
        ctx.save()
        ctx.fillStyle = '#fde047'
        ctx.shadowColor = '#fde047'
        ctx.shadowBlur = 0
        ctx.beginPath()
        ctx.ellipse(x, y, 11, 8, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = INK
        ctx.beginPath()
        ctx.ellipse(x + 2, y + 1, 3.5, 6, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
    }
    // Lid, propped open.
    const lid = path((p) => {
        p.moveTo(34, 60)
        p.lineTo(230, 70)
        p.lineTo(236, 50)
        p.lineTo(42, 36)
        p.closePath()
    })
    blob(ctx, lid, linear(ctx, 0, 36, 0, 70, [[0, '#4ade80'], [1, '#15803d']]), '#14532d', { d: 5, line: 8 })
    // Rim.
    blob(ctx, rrect(16, 90, 224, 14, 6), '#166534', '#052e16', { d: 3, line: 7 })
    // Fish bone poking out.
    tube(ctx, path((p) => {
        p.moveTo(196, 88)
        p.lineTo(214, 40)
    }), '#f8fafc', 6, 5)
    // Flies.
    for (const [x, y] of [[40, 30], [222, 22]] as const) {
        ctx.fillStyle = INK
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(26,16,48,0.7)'
        ctx.lineWidth = 2
        ctx.setLineDash([3, 4])
        ctx.beginPath()
        ctx.arc(x - 12, y + 8, 12, -1.5, 1)
        ctx.stroke()
        ctx.setLineDash([])
    }
}

// Pick-game pieces ---------------------------------------------------------------

function paintTrashCan(ctx: Ctx) {
    ground(ctx, 128, 236, 86)
    const metal = linear(ctx, 50, 0, 206, 0, [[0, '#64748b'], [0.25, '#cbd5e1'], [0.5, '#94a3b8'], [1, '#334155']])
    const body = path((p) => {
        p.moveTo(56, 92)
        p.lineTo(200, 92)
        p.lineTo(188, 228)
        p.lineTo(68, 228)
        p.closePath()
    })
    blob(ctx, body, metal, '#334155', { d: 10 })
    ctx.save()
    ctx.clip(body)
    ctx.strokeStyle = 'rgba(15,23,42,0.45)'
    ctx.lineWidth = 5
    for (const x of [92, 128, 164]) {
        ctx.beginPath()
        ctx.moveTo(x, 98)
        ctx.lineTo(x, 224)
        ctx.stroke()
    }
    ctx.restore()
    for (const y of [130, 190]) blob(ctx, rrect(58, y - 5, 140, 10, 5), '#94a3b8', '#475569', { d: 2, line: 5 })
    // Lid.
    blob(ctx, ellipse(128, 88, 84, 20), metal, '#334155', { d: 5, line: 8 })
    blob(ctx, rrect(106, 48, 44, 30, 12), '#94a3b8', '#475569', { d: 4, line: 7 })
    comicText(ctx, '?', 128, 170, 70, 70, [[0, '#ffffff'], [1, '#fde047']], { outline: 10 })
}

function paintDog(ctx: Ctx) {
    ground(ctx, 128, 232, 100)
    const fur = linear(ctx, 0, 40, 0, 230, [[0, '#d6a26b'], [1, '#8b5a2b']])
    // Floppy ears.
    for (const side of [-1, 1]) {
        blob(ctx, path((p) => {
            p.moveTo(128 + side * 56, 66)
            p.bezierCurveTo(128 + side * 104, 50, 128 + side * 122, 90, 128 + side * 108, 132)
            p.bezierCurveTo(128 + side * 96, 128, 128 + side * 84, 110, 128 + side * 72, 96)
            p.closePath()
        }), '#5b3a1a', '#3b2410', { d: 5 })
    }
    // Wide bulldog head.
    const head = path((p) => {
        p.moveTo(128, 50)
        p.bezierCurveTo(190, 50, 214, 90, 212, 136)
        p.bezierCurveTo(212, 190, 180, 222, 128, 222)
        p.bezierCurveTo(76, 222, 44, 190, 44, 136)
        p.bezierCurveTo(42, 90, 66, 50, 128, 50)
        p.closePath()
    })
    blob(ctx, head, fur, '#6b4423', { d: 12 })
    // Muzzle.
    blob(ctx, path((p) => {
        p.moveTo(128, 124)
        p.bezierCurveTo(180, 118, 196, 150, 190, 180)
        p.bezierCurveTo(182, 208, 150, 214, 128, 212)
        p.bezierCurveTo(106, 214, 74, 208, 66, 180)
        p.bezierCurveTo(60, 150, 76, 118, 128, 124)
        p.closePath()
    }), '#f5deb3', '#d4a373', { d: 6, line: 7 })
    // Angry brows and eyes.
    for (const side of [-1, 1]) {
        const ex = 128 + side * 38
        blob(ctx, ellipse(ex, 104, 15, 14), '#ffffff', '#e7e5e4', { d: 3, line: 5 })
        ctx.fillStyle = INK
        ctx.beginPath()
        ctx.arc(ex - side * 3, 108, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(ex - side * 1, 105, 2.4, 0, Math.PI * 2)
        ctx.fill()
        // Angry brows: high at the outside, low toward the snout.
        tube(ctx, path((p) => {
            p.moveTo(ex + side * 20, 80)
            p.lineTo(ex - side * 16, 96)
        }), '#3b2410', 8, 5)
    }
    // Snarl: jowls, teeth.
    ctx.save()
    const mouth = path((p) => {
        p.moveTo(84, 180)
        p.quadraticCurveTo(128, 162, 172, 180)
        p.quadraticCurveTo(170, 204, 128, 204)
        p.quadraticCurveTo(86, 204, 84, 180)
        p.closePath()
    })
    ctx.fillStyle = '#7f1d1d'
    ctx.fill(mouth)
    ctx.clip(mouth)
    ctx.fillStyle = '#ffffff'
    for (const x of [96, 116, 136, 156]) {
        ctx.beginPath()
        ctx.moveTo(x - 7, 170)
        ctx.lineTo(x + 7, 170)
        ctx.lineTo(x, 186)
        ctx.closePath()
        ctx.fill()
    }
    ctx.restore()
    ink(ctx, mouth, 6)
    // Fangs from below.
    for (const x of [100, 156]) {
        blob(ctx, path((p) => {
            p.moveTo(x - 7, 202)
            p.lineTo(x, 182)
            p.lineTo(x + 7, 202)
            p.closePath()
        }), '#ffffff', '#e5e7eb', { d: 1, line: 4 })
    }
    // Nose.
    blob(ctx, ellipse(128, 146, 20, 13), '#1c1917', '#000', { d: 2, line: 5, gloss: [122, 141, 6, 3, 0], glossAlpha: 0.7 })
    // Spiked collar.
    blob(ctx, path((p) => {
        p.moveTo(56, 206)
        p.quadraticCurveTo(128, 240, 200, 206)
        p.lineTo(204, 224)
        p.quadraticCurveTo(128, 256, 52, 224)
        p.closePath()
    }), '#dc2626', '#7f1d1d', { d: 4, line: 7 })
    for (const x of [80, 128, 176]) {
        blob(ctx, path((p) => {
            p.moveTo(x - 7, 226 + (x === 128 ? 6 : 0))
            p.lineTo(x, 210 + (x === 128 ? 6 : 0))
            p.lineTo(x + 7, 226 + (x === 128 ? 6 : 0))
            p.closePath()
        }), '#e2e8f0', '#64748b', { d: 1, line: 4 })
    }
}

function paintKey(ctx: Ctx) {
    ctx.save()
    ctx.fillStyle = radial(ctx, 128, 128, 128, [[0, 'rgba(253,224,71,0.5)'], [1, 'rgba(253,224,71,0)']])
    ctx.fillRect(0, 0, 256, 256)
    ctx.restore()
    ctx.save()
    ctx.translate(128, 128)
    ctx.rotate(-0.7)
    ctx.translate(-128, -128)
    const gold = linear(ctx, 40, 60, 220, 200, [[0, '#fef9c3'], [0.4, '#facc15'], [1, '#a16207']])
    const shape = path((p) => {
        p.ellipse(72, 128, 44, 44, 0, 0, Math.PI * 2)
        p.moveTo(108, 116)
        p.lineTo(226, 116)
        p.lineTo(226, 140)
        p.lineTo(212, 140)
        p.lineTo(212, 166)
        p.lineTo(194, 166)
        p.lineTo(194, 140)
        p.lineTo(180, 140)
        p.lineTo(180, 158)
        p.lineTo(164, 158)
        p.lineTo(164, 140)
        p.lineTo(108, 140)
        p.closePath()
    })
    ctx.fillStyle = gold
    ctx.fill(shape, 'nonzero')
    ink(ctx, shape, 8)
    blob(ctx, ellipse(72, 128, 18, 18), '#1a1030', '#000', { d: 1, line: 6, noShade: true })
    ctx.save()
    ctx.globalAlpha = 0.6
    ctx.fillStyle = '#ffffff'
    ctx.fill(ellipse(56, 102, 14, 6, -0.6))
    ctx.restore()
    ctx.restore()
    sparkle(ctx, 190, 70, 18)
    sparkle(ctx, 60, 200, 12, '#fef9c3')
}

function paintDouble(ctx: Ctx) {
    const burst = path((p) => {
        const n = 12
        for (let i = 0; i < n * 2; i++) {
            const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2
            const r = i % 2 ? 84 : 116
            const x = 128 + Math.cos(a) * r
            const y = 128 + Math.sin(a) * r
            if (i === 0) p.moveTo(x, y)
            else p.lineTo(x, y)
        }
        p.closePath()
    })
    blob(ctx, burst, radial(ctx, 120, 110, 120, [[0, '#f5d0fe'], [0.5, '#d946ef'], [1, '#86198f']]), '#701a75', { d: 10, line: 8 })
    comicText(ctx, '×2', 128, 132, 100, 150, [[0, '#ffffff'], [1, '#fde047']], { font: numberFont, outline: 14 })
}

function paintCoins(ctx: Ctx) {
    ground(ctx, 128, 220, 100)
    const coin = (x: number, y: number, r: number) => {
        blob(ctx, ellipse(x, y, r, r * 0.9), radial(ctx, x - r * 0.3, y - r * 0.3, r * 1.2, [[0, '#fef9c3'], [0.5, '#facc15'], [1, '#b45309']]), '#92400e', { d: 5, line: 7 })
        ctx.save()
        ctx.strokeStyle = 'rgba(146,64,14,0.7)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.ellipse(x, y, r * 0.66, r * 0.6, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.font = displayFont(r * 0.9)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#92400e'
        ctx.fillText('$', x, y + 2)
        ctx.restore()
    }
    coin(84, 172, 46)
    coin(172, 168, 46)
    coin(128, 116, 52)
    sparkle(ctx, 196, 90, 14)
}

// Public painters -----------------------------------------------------------

/** Paint one artwork into a new square canvas `px` pixels wide. */
export function paintTphArt(id: TphArtId, px: number): HTMLCanvasElement {
    const [c, ctx] = canvas(px)
    const k = px / 256
    ctx.scale(k, k)
    ctx.imageSmoothingQuality = 'high'
    switch (id) {
        case 'fish': paintFish(ctx); break
        case 'banana': paintBanana(ctx); break
        case 'can': paintCan(ctx); break
        case 'apple': paintApple(ctx); break
        case 'pizza': paintPizza(ctx); break
        case 'donut': paintDonut(ctx); break
        case 'cash': paintCash(ctx); break
        case 'bag': paintBag(ctx); break
        case 'gem': paintGem(ctx); break
        case 'boss': paintRaccoon(ctx, true); break
        case 'raccoon': paintRaccoon(ctx, false); break
        case 'wild': paintWild(ctx); break
        case 'wild2': paintWild(ctx, 2); break
        case 'wild3': paintWild(ctx, 3); break
        case 'wild5': paintWild(ctx, 5); break
        case 'wild10': paintWild(ctx, 10); break
        case 'safe': paintSafe(ctx); break
        case 'bin': paintBin(ctx); break
        case 'can-closed': paintTrashCan(ctx); break
        case 'dog': paintDog(ctx); break
        case 'key': paintKey(ctx); break
        case 'double': paintDouble(ctx); break
        case 'coins': paintCoins(ctx); break
    }
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

/** PNG data URL of an artwork, cached per id and size. */
export function tphArtDataUrl(id: TphArtId, px = 128): string {
    const key = `${id}@${px}`
    let url = urlCache.get(key)
    if (!url) {
        url = paintTphArt(id, px).toDataURL('image/png')
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
        ctx.fillStyle = linear(ctx, 0, top, 0, top + colH, [[0, '#120b26'], [0.2, '#1f1540'], [0.5, '#291c52'], [0.8, '#1f1540'], [1, '#120b26']])
        ctx.fill()
        ctx.clip()
        // Bricks.
        ctx.strokeStyle = 'rgba(167,139,250,0.07)'
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
        ctx.strokeStyle = 'rgba(250,204,21,0.14)'
        ctx.beginPath()
        ctx.roundRect(x + 1, top + 1, colW - 2, colH - 2, 14)
        ctx.stroke()
    }
    return c
}
