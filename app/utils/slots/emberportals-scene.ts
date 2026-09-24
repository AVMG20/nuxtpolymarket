// Ember Portals: the painted stage (sky, mountains, the ancient portal arch,
// foreground rocks, mist) and the board frame. The stage is dark and low in
// contrast on purpose: all the brightness belongs to the board. It comes as
// layers (for parallax) and as one composite (paintEpScene).
//
// Stage layers use gradients, blurred silhouettes and fills only (no
// per-shape scratch layers): they are painted at full device resolution.

import {
    GOLD,
    TAU,
    blurFill,
    blurStroke,
    circle,
    ellipse,
    fade,
    glow,
    innerShadow,
    lin,
    makeCanvas,
    rad,
    roundRect,
    seeded,
    type Ctx
} from './emberportals-paint'

export interface EpSceneLayers {
    /** Opaque sky: gradient, stars, moon / lava horizon. */
    sky: HTMLCanvasElement
    /** Transparent: distant mountain silhouettes. */
    far: HTMLCanvasElement
    /** Transparent: the ancient portal arch behind the board. */
    arch: HTMLCanvasElement
    /** Transparent: foreground rocks at the bottom corners. */
    near: HTMLCanvasElement
    /** Transparent: mist, embers / ash and the vignette. */
    mist: HTMLCanvasElement
}

type Mode = 'base' | 'bonus'

interface Palette {
    rune: string
    ember: string
}

function palette(mode: Mode): Palette {
    return mode === 'bonus'
        ? { rune: '#ff9a3a', ember: '#ff5a14' }
        : { rune: '#4fd8ff', ember: '#ff7a24' }
}

/** Where the arch sits; shared by every layer so the light lines up. */
function archGeometry(w: number, h: number) {
    const u = Math.min(w, h)
    const cx = w / 2
    const A = Math.min(w * 0.36, h * 0.46)
    const T = u * 0.08
    const top = h * 0.06
    const spring = top + T + A
    return { u, cx, A, T, top, spring }
}

// --- sky -----------------------------------------------------------------------------

function paintSky(w: number, h: number, mode: Mode): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(w, h)
    const u = Math.min(w, h)
    const bonus = mode === 'bonus'
    const rnd = seeded(bonus ? 101 : 17)

    ctx.fillStyle = lin(ctx, 0, 0, 0, h, bonus
        ? [[0, '#040102'], [0.35, '#12030a'], [0.55, '#2a060a'], [0.66, '#5a120a'], [0.72, '#2a0808'], [1, '#080204']]
        : [[0, '#030210'], [0.35, '#080722'], [0.58, '#141238'], [0.68, '#1c1a48'], [0.8, '#0e0c28'], [1, '#05040f']])
    ctx.fillRect(0, 0, w, h)

    // Stars (a few, dim) or drifting smoke.
    const stars = Math.round((w * h) / (bonus ? 14000 : 3800))
    for (let i = 0; i < stars; i++) {
        const x = rnd() * w
        const y = rnd() * h * 0.55
        const r = u * (rnd() < 0.04 ? 0.0018 : 0.0006 + rnd() * 0.0007)
        ctx.globalAlpha = (0.2 + rnd() * 0.55) * (1 - y / (h * 0.6))
        ctx.fillStyle = bonus ? '#ff9a7a' : (rnd() < 0.25 ? '#b8d8ff' : '#e8ecff')
        ctx.fill(circle(x, y, r))
    }
    ctx.globalAlpha = 1

    if (bonus) {
        // Smoke banks lit from below.
        for (let i = 0; i < 40; i++) {
            const x = rnd() * w
            const y = h * (0.2 + rnd() * 0.4)
            const r = u * (0.08 + rnd() * 0.12)
            ctx.save()
            ctx.translate(x, y)
            ctx.scale(1, 0.4)
            ctx.fillStyle = rad(ctx, 0, r * 0.3, r, [[0, `rgba(${90 + Math.round(rnd() * 50)},14,10,0.16)`], [1, 'rgba(40,4,6,0)']])
            ctx.fillRect(-r, -r, r * 2, r * 2)
            ctx.restore()
        }
        // Lava glow along the horizon.
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = lin(ctx, 0, h * 0.5, 0, h * 0.72, [[0, 'rgba(255,60,10,0)'], [0.7, 'rgba(255,80,20,0.35)'], [1, 'rgba(255,120,30,0.1)']])
        ctx.fillRect(0, h * 0.5, w, h * 0.22)
        ctx.restore()
        for (const fx of [0.14, 0.86]) glow(ctx, w * fx, h * 0.64, u * 0.3, 'rgba(255,70,15,0.35)')
        // A dull red moon behind the smoke.
        const mx = w * 0.8
        const my = h * 0.15
        const mr = u * 0.045
        glow(ctx, mx, my, mr * 4, 'rgba(200,40,20,0.25)')
        ctx.fillStyle = rad(ctx, mx, my, mr, [[0, '#c24a2a'], [1, '#6a140e']], mx - mr * 0.3, my - mr * 0.3, 0)
        ctx.fill(circle(mx, my, mr))
    } else {
        // Moon and its halo.
        const mx = w * 0.8
        const my = h * 0.15
        const mr = u * 0.045
        glow(ctx, mx, my, mr * 7, 'rgba(90,110,200,0.22)')
        glow(ctx, mx, my, mr * 2, 'rgba(190,205,255,0.35)')
        ctx.fillStyle = rad(ctx, mx, my, mr, [[0, '#f4f6ff'], [0.7, '#cfd6f4'], [1, '#98a4d8']], mx - mr * 0.35, my - mr * 0.35, 0)
        ctx.fill(circle(mx, my, mr))
        ctx.fillStyle = 'rgba(100,110,170,0.2)'
        for (const [dx, dy, r] of [[0.3, 0.15, 0.22], [-0.3, 0.35, 0.14], [-0.1, -0.35, 0.12]] as const) {
            ctx.fill(circle(mx + mr * dx, my + mr * dy, mr * r))
        }
        // Faint aurora veil.
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        for (let i = 0; i < 3; i++) {
            const y = h * (0.2 + i * 0.05)
            ctx.save()
            ctx.translate(w * (0.3 + i * 0.2), y)
            ctx.rotate(-0.12 + i * 0.1)
            ctx.scale(1, 0.12)
            const r = w * 0.4
            ctx.fillStyle = rad(ctx, 0, 0, r, [[0, i === 1 ? 'rgba(90,120,255,0.07)' : 'rgba(40,200,190,0.06)'], [1, 'rgba(0,0,0,0)']])
            ctx.fillRect(-r, -r, r * 2, r * 2)
            ctx.restore()
        }
        ctx.restore()
    }
    return c
}

// --- mountains ------------------------------------------------------------------------

interface Peak { x: number, h: number, s: number, skew: number }

/** A silhouette of overlapping peaks with a little ridge noise. */
function silhouette(ctx: Ctx, w: number, h: number, baseY: number, maxH: number, count: number, seed: number, top: string, bottom: string, lit: string) {
    const rnd = seeded(seed)
    const peaks: Peak[] = Array.from({ length: count }, () => ({
        x: rnd() * w * 1.2 - w * 0.1,
        h: maxH * (0.3 + rnd() * 0.7),
        s: w * (0.07 + rnd() * 0.12),
        skew: 0.65 + rnd() * 0.7
    }))
    const phases = [rnd() * TAU, rnd() * TAU, rnd() * TAU]
    const yAt = (x: number) => {
        let best = 0
        for (const p of peaks) {
            const span = x < p.x ? p.s * p.skew : p.s / p.skew
            const t = 1 - Math.abs(x - p.x) / span
            if (t > 0) best = Math.max(best, p.h * t ** 1.15)
        }
        const noise = Math.sin(x / w * 40 + phases[0]!) * 0.012 + Math.sin(x / w * 97 + phases[1]!) * 0.006 + Math.sin(x / w * 13 + phases[2]!) * 0.02
        return baseY - best + noise * maxH
    }
    const step = Math.max(2, w / 600)
    const p = new Path2D()
    p.moveTo(0, h)
    for (let x = 0; x <= w + step; x += step) p.lineTo(x, yAt(x))
    p.lineTo(w, h)
    p.closePath()
    ctx.fillStyle = lin(ctx, 0, baseY - maxH, 0, h, [[0, top], [0.5, bottom], [1, bottom]])
    ctx.fill(p)
    // Faint light on the moon-side faces.
    ctx.save()
    ctx.clip(p)
    for (const pk of peaks) {
        const py = baseY - pk.h
        const face = new Path2D()
        face.moveTo(pk.x, py)
        face.lineTo(pk.x + pk.s / pk.skew, baseY)
        face.lineTo(pk.x + pk.s * 0.12, baseY)
        face.closePath()
        ctx.fillStyle = lin(ctx, 0, py, 0, baseY, [[0, lit], [1, fade(lit, 0)]])
        ctx.fill(face)
    }
    ctx.restore()
}

function paintFar(w: number, h: number, mode: Mode): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(w, h)
    if (mode === 'bonus') {
        silhouette(ctx, w, h, h * 0.66, h * 0.34, 9, 3, '#2a0a10', '#160508', 'rgba(255,90,40,0.07)')
        silhouette(ctx, w, h, h * 0.74, h * 0.26, 8, 9, '#140406', '#0a0204', 'rgba(255,70,30,0.05)')
    } else {
        silhouette(ctx, w, h, h * 0.66, h * 0.34, 9, 3, '#1e1c46', '#121030', 'rgba(170,190,255,0.08)')
        // Moonlit mist band between the ranges.
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = lin(ctx, 0, h * 0.56, 0, h * 0.72, [[0, 'rgba(80,100,180,0)'], [0.6, 'rgba(80,100,180,0.1)'], [1, 'rgba(80,100,180,0)']])
        ctx.fillRect(0, h * 0.56, w, h * 0.16)
        ctx.restore()
        silhouette(ctx, w, h, h * 0.74, h * 0.26, 8, 9, '#0e0c26', '#08071a', 'rgba(150,170,255,0.05)')
    }
    return c
}

// --- arch -----------------------------------------------------------------------------

function rune(ctx: Ctx, x: number, y: number, s: number, rot: number, variant: number, color: string) {
    const shapes = [
        'M-1 -1L0 1 1 -1', 'M0 -1V1M-0.7 -0.3L0 -1 0.7 -0.3', 'M-0.7 -1H0.7L-0.7 1H0.7', 'M-0.5 -1V1M-0.5 0L0.7 -0.8M-0.5 0L0.7 0.8',
        'M0 -1L0.7 0 0 1 -0.7 0Z', 'M-0.7 1V-1L0.7 1V-1', 'M0 -1V1M-0.8 -0.4H0.8M-0.5 0.5L0.5 0.5'
    ]
    const p = new Path2D()
    p.addPath(new Path2D(shapes[variant % shapes.length]!), new DOMMatrix().translateSelf(x, y).rotateSelf((rot * 180) / Math.PI).scaleSelf(s, s))
    blurStroke(ctx, p, fade(color, 0.9), s * 0.4, s * 1.2)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = s * 0.2
    ctx.strokeStyle = fade(color, 0.85)
    ctx.stroke(p)
    ctx.restore()
}

function block(ctx: Ctx, p: Path2D, x0: number, y0: number, x1: number, y1: number, bonus: boolean, rnd: () => number) {
    ctx.fillStyle = lin(ctx, x0, y0, x1, y1, bonus
        ? [[0, '#2e1a20'], [0.5, '#1c0e14'], [1, '#0e060a']]
        : [[0, '#2a2848'], [0.5, '#1a1834'], [1, '#0c0b1e']])
    ctx.fill(p)
    ctx.save()
    ctx.clip(p)
    for (let i = 0; i < 14; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.14)'
        const r = Math.max(1, Math.hypot(x1 - x0, y1 - y0) * 0.03 * rnd())
        ctx.fill(circle(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), r))
    }
    ctx.restore()
    ctx.save()
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.lineWidth = 1.5
    ctx.stroke(p)
    ctx.restore()
}

function paintArch(w: number, h: number, mode: Mode): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(w, h)
    const bonus = mode === 'bonus'
    const pal = palette(mode)
    const { u, cx, A, T, spring } = archGeometry(w, h)
    const rnd = seeded(bonus ? 55 : 44)

    // Deep dark opening, warmed from below.
    const opening = new Path2D()
    opening.moveTo(cx - A, h)
    opening.lineTo(cx - A, spring)
    opening.arc(cx, spring, A, Math.PI, TAU)
    opening.lineTo(cx + A, h)
    opening.closePath()
    ctx.save()
    ctx.clip(opening)
    ctx.fillStyle = lin(ctx, 0, spring - A, 0, h, bonus
        ? [[0, 'rgba(10,2,4,0.55)'], [0.7, 'rgba(40,6,4,0.5)'], [1, 'rgba(120,24,6,0.6)']]
        : [[0, 'rgba(4,3,14,0.55)'], [0.7, 'rgba(10,8,26,0.5)'], [1, 'rgba(60,24,14,0.5)']])
    ctx.fillRect(0, 0, w, h)
    ctx.restore()

    // Shadow cast behind the stones.
    const shape = new Path2D()
    shape.moveTo(cx - A - T, h)
    shape.lineTo(cx - A - T, spring)
    shape.arc(cx, spring, A + T, Math.PI, TAU)
    shape.lineTo(cx + A + T, h)
    shape.lineTo(cx + A, h)
    shape.lineTo(cx + A, spring)
    shape.arc(cx, spring, A, TAU, Math.PI, true)
    shape.lineTo(cx - A, h)
    shape.closePath()
    blurFill(ctx, shape, 'rgba(0,0,0,0.7)', u * 0.03, 0, u * 0.008)

    // Voussoirs.
    const blocks = 15
    const runeAt = new Set([2, 5, 9, 12])
    for (let i = 0; i < blocks; i++) {
        const key = i === (blocks - 1) / 2
        const a0 = Math.PI + (i / blocks) * Math.PI
        const a1 = Math.PI + ((i + 1) / blocks) * Math.PI
        const r1 = A + T * (key ? 1.4 : 1)
        const p = new Path2D()
        p.arc(cx, spring, r1, a0, a1)
        p.arc(cx, spring, A, a1, a0, true)
        p.closePath()
        const am = (a0 + a1) / 2
        block(ctx, p, cx + Math.cos(am) * r1, spring + Math.sin(am) * r1, cx + Math.cos(am) * A, spring + Math.sin(am) * A, bonus, rnd)
        if (key) {
            const kx = cx + Math.cos(am) * (A + T * 0.7)
            const ky = spring + Math.sin(am) * (A + T * 0.7)
            const s = T * 0.2
            glow(ctx, kx, ky, s * 6, fade(pal.ember, 0.45))
            ctx.fillStyle = rad(ctx, kx, ky, s, [[0, '#fff0c0'], [0.4, '#ffa040'], [1, '#6a1404']], kx - s * 0.3, ky - s * 0.3, 0)
            ctx.fill(circle(kx, ky, s))
        } else if (runeAt.has(i)) {
            const gr = A + T * 0.5
            rune(ctx, cx + Math.cos(am) * gr, spring + Math.sin(am) * gr, T * 0.18, am + Math.PI / 2, i, pal.rune)
        }
    }
    // Moonlight catching the arch's top edge.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = Math.max(1, u * 0.002)
    ctx.strokeStyle = bonus ? 'rgba(255,90,40,0.12)' : 'rgba(170,190,255,0.12)'
    ctx.beginPath()
    ctx.arc(cx, spring, A + T - 1, Math.PI * 1.1, Math.PI * 1.9)
    ctx.stroke()
    ctx.restore()

    // Pillars.
    for (const side of [-1, 1]) {
        const x0 = side < 0 ? cx - A - T : cx + A
        const rows = Math.max(3, Math.round((h - spring) / (T * 0.95)))
        const bh = (h - spring) / rows
        for (let r = 0; r < rows; r++) {
            const y0 = spring + r * bh
            block(ctx, roundRect(x0, y0, T, bh, 2), x0, y0, x0 + T, y0 + bh, bonus, rnd)
            if (r === 1) rune(ctx, x0 + T / 2, y0 + bh / 2, T * 0.18, 0, r + (side > 0 ? 3 : 0), pal.rune)
        }
        const cap = roundRect(x0 - T * 0.14, spring - T * 0.1, T * 1.28, T * 0.2, 3)
        block(ctx, cap, x0, spring - T * 0.1, x0, spring + T * 0.1, bonus, rnd)
    }

    // Ember glow at the base of the arch.
    for (const x of [cx - A - T / 2, cx + A + T / 2]) {
        glow(ctx, x, h * 0.98, T * 3.2, fade(pal.ember, bonus ? 0.55 : 0.4))
        glow(ctx, x, h * 0.99, T * 1.2, 'rgba(255,200,120,0.35)')
    }
    glow(ctx, cx, h * 1.02, A * 1.1, fade(pal.ember, bonus ? 0.35 : 0.2))
    return c
}

// --- foreground ---------------------------------------------------------------------

function paintNear(w: number, h: number, mode: Mode): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(w, h)
    const bonus = mode === 'bonus'
    const pal = palette(mode)
    const u = Math.min(w, h)
    const rnd = seeded(bonus ? 71 : 61)

    const rocks = (side: -1 | 1) => {
        const edge = side < 0 ? 0 : w
        const reach = w * 0.17
        const p = new Path2D()
        p.moveTo(edge, h * 0.66)
        const steps = 12
        for (let i = 1; i <= steps; i++) {
            const t = i / steps
            const x = edge - side * reach * (0.2 + 0.8 * t) - side * (rnd() - 0.5) * u * 0.03
            const y = h * (0.66 + t * 0.34) + (rnd() - 0.5) * u * 0.02
            p.lineTo(x, y)
        }
        p.lineTo(edge, h)
        p.closePath()
        ctx.fillStyle = lin(ctx, edge, h * 0.66, edge - side * reach, h, bonus
            ? [[0, '#0a0204'], [1, '#1a0508']]
            : [[0, '#05040f'], [1, '#0c0a20']])
        ctx.fill(p)
        // Ember light grazing the inner face.
        ctx.save()
        ctx.clip(p)
        ctx.fillStyle = lin(ctx, edge, 0, edge - side * reach, 0, [[0, fade(pal.ember, 0)], [1, fade(pal.ember, bonus ? 0.16 : 0.08)]])
        ctx.fillRect(0, h * 0.6, w, h * 0.4)
        ctx.restore()
    }
    rocks(-1)
    rocks(1)
    ctx.fillStyle = lin(ctx, 0, h * 0.9, 0, h, bonus ? [[0, 'rgba(10,2,4,0)'], [1, 'rgba(10,2,4,0.9)']] : [[0, 'rgba(4,3,12,0)'], [1, 'rgba(4,3,12,0.9)']])
    ctx.fillRect(0, h * 0.9, w, h * 0.1)
    return c
}

// --- mist -----------------------------------------------------------------------------

function paintMist(w: number, h: number, mode: Mode): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(w, h)
    const bonus = mode === 'bonus'
    const pal = palette(mode)
    const u = Math.min(w, h)
    const rnd = seeded(bonus ? 88 : 77)

    // Low mist banks: dark, only slightly lighter than the ground.
    for (const [yf, alpha, count] of [[0.8, 0.07, 18], [0.92, 0.1, 20]] as const) {
        for (let i = 0; i < count; i++) {
            const x = (i / (count - 1)) * w * 1.2 - w * 0.1 + (rnd() - 0.5) * u * 0.1
            const y = h * yf + (rnd() - 0.5) * u * 0.04
            const rx = u * (0.14 + rnd() * 0.14)
            ctx.save()
            ctx.translate(x, y)
            ctx.scale(1, 0.22)
            const col = bonus ? `rgba(120,40,30,${alpha})` : `rgba(70,80,140,${alpha})`
            ctx.fillStyle = rad(ctx, 0, 0, rx, [[0, col], [1, fade(col, 0)]])
            ctx.fillRect(-rx, -rx, rx * 2, rx * 2)
            ctx.restore()
        }
    }

    // Embers drifting up (and ash falling in the bonus).
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < (bonus ? 70 : 28); i++) {
        const x = rnd() * w
        const y = h * (0.35 + rnd() * 0.65)
        const r = u * (0.0012 + rnd() * 0.0025)
        ctx.fillStyle = rad(ctx, x, y, r * 3, [[0, 'rgba(255,200,120,0.9)'], [0.4, fade(pal.ember, 0.35)], [1, fade(pal.ember, 0)]])
        ctx.fill(circle(x, y, r * 3))
    }
    ctx.restore()
    if (bonus) {
        for (let i = 0; i < 160; i++) {
            ctx.fillStyle = `rgba(${120 + Math.round(rnd() * 60)},${100 + Math.round(rnd() * 40)},${100 + Math.round(rnd() * 40)},${(0.15 + rnd() * 0.3).toFixed(2)})`
            ctx.fill(ellipse(rnd() * w, rnd() * h, u * 0.0015, u * 0.0028, rnd()))
        }
    }

    // Heavy vignette keeps the eye on the board.
    ctx.fillStyle = rad(ctx, w / 2, h * 0.5, Math.hypot(w, h) * 0.6, [[0, 'rgba(0,0,0,0)'], [0.55, 'rgba(0,0,4,0.2)'], [1, 'rgba(0,0,4,0.85)']])
    ctx.fillRect(0, 0, w, h)
    return c
}

/** The stage as separate layers; all w×h device pixels, all but the sky transparent. */
export function paintEpSceneLayers(w: number, h: number, mode: Mode): EpSceneLayers {
    return {
        sky: paintSky(w, h, mode),
        far: paintFar(w, h, mode),
        arch: paintArch(w, h, mode),
        near: paintNear(w, h, mode),
        mist: paintMist(w, h, mode)
    }
}

/** The full stage in one canvas (the layers composited). */
export function paintEpScene(w: number, h: number, mode: Mode): HTMLCanvasElement {
    const l = paintEpSceneLayers(w, h, mode)
    const [c, ctx] = makeCanvas(w, h)
    for (const layer of [l.sky, l.far, l.arch, l.near, l.mist]) ctx.drawImage(layer, 0, 0)
    return c
}

// --- board ------------------------------------------------------------------------------

/**
 * The board behind the grid at w*scale × h*scale: carved dark stone with a
 * gold filigree inlay, corner rune crests with flames, an inner bevel and a
 * glow line, and soft recessed plates under each cell.
 */
export function paintEpBoard(w: number, h: number, scale: number, cols: number, rows: number, cell: number, gap: number, padX: number, padY: number): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(w * scale, h * scale)
    ctx.scale(scale, scale)
    const t = Math.max(6, Math.min(padX, padY) * 0.78)
    const radius = Math.min(30, Math.min(w, h) * 0.045)
    const rnd = seeded(cols * 31 + rows)

    // Carved stone frame.
    const outer = roundRect(0.5, 0.5, w - 1, h - 1, radius)
    ctx.fillStyle = lin(ctx, 0, 0, w, h, [[0, '#4a4488'], [0.25, '#2a2660'], [0.7, '#1a1640'], [1, '#0c0a24']])
    ctx.fill(outer)
    ctx.save()
    ctx.clip(outer)
    for (let i = 0; i < Math.round((w + h) * 1.2); i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.16)'
        ctx.fillRect(rnd() * w, rnd() * h, 1.6, 1.6)
    }
    ctx.restore()
    innerShadow(ctx, outer, 'rgba(180,190,255,0.5)', 3, 1.5, 1.5)
    innerShadow(ctx, outer, 'rgba(0,0,0,0.6)', 3, -1.5, -1.5)

    // Gold filigree inlay running around the frame.
    const inset = t * 0.42
    const fil = roundRect(inset, inset, w - inset * 2, h - inset * 2, Math.max(4, radius - inset * 0.6))
    ctx.save()
    ctx.lineWidth = Math.max(2, t * 0.16)
    ctx.strokeStyle = 'rgba(30,14,0,0.8)'
    ctx.translate(1, 1.2)
    ctx.stroke(fil)
    ctx.translate(-1, -1.2)
    ctx.strokeStyle = lin(ctx, 0, 0, w, h, GOLD)
    ctx.stroke(fil)
    ctx.restore()
    blurStroke(ctx, fil, 'rgba(255,190,80,0.45)', Math.max(1, t * 0.08), t * 0.3)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = Math.max(0.8, t * 0.04)
    ctx.strokeStyle = 'rgba(255,245,200,0.7)'
    ctx.stroke(fil)
    ctx.restore()
    // Diamond motifs along the inlay.
    const motif = (x: number, y: number) => {
        const s = t * 0.26
        const p = new Path2D()
        p.moveTo(x, y - s)
        p.lineTo(x + s, y)
        p.lineTo(x, y + s)
        p.lineTo(x - s, y)
        p.closePath()
        ctx.fillStyle = lin(ctx, x - s, y - s, x + s, y + s, GOLD)
        ctx.fill(p)
        glow(ctx, x, y, s * 1.6, 'rgba(255,140,50,0.45)')
        ctx.fillStyle = '#ffd08a'
        ctx.fill(circle(x, y, s * 0.32))
    }
    const stepsX = Math.max(2, Math.round(w / (cell + gap)))
    const stepsY = Math.max(2, Math.round(h / (cell + gap)))
    for (let i = 1; i < stepsX; i++) {
        motif((i / stepsX) * w, inset)
        motif((i / stepsX) * w, h - inset)
    }
    for (let i = 1; i < stepsY; i++) {
        motif(inset, (i / stepsY) * h)
        motif(w - inset, (i / stepsY) * h)
    }

    // Recessed field.
    const field = roundRect(t, t, w - t * 2, h - t * 2, Math.max(4, radius - t * 0.5))
    ctx.fillStyle = lin(ctx, 0, t, 0, h - t, [[0, '#120c34'], [0.5, '#0a0724'], [1, '#050316']])
    ctx.fill(field)
    ctx.save()
    ctx.clip(field)
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = rad(ctx, w / 2, h / 2, Math.max(w, h) * 0.6, [[0, 'rgba(110,80,220,0.2)'], [0.6, 'rgba(60,40,160,0.06)'], [1, 'rgba(0,0,0,0)']])
    ctx.fillRect(0, 0, w, h)
    ctx.restore()

    // Soft recessed sockets with a faint top-edge highlight.
    const pr = cell * 0.22
    for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
            const x = padX + col * (cell + gap)
            const y = padY + row * (cell + gap)
            const p = roundRect(x + 1, y + 1, cell - 2, cell - 2, pr)
            ctx.fillStyle = lin(ctx, 0, y, 0, y + cell, [[0, '#0a0720'], [1, '#161232']])
            ctx.fill(p)
            innerShadow(ctx, p, 'rgba(0,0,6,0.9)', cell * 0.07, 0, cell * 0.035)
            ctx.save()
            ctx.clip(p)
            ctx.strokeStyle = 'rgba(200,190,255,0.1)'
            ctx.lineWidth = 1.2
            ctx.stroke(p)
            ctx.restore()
            ctx.save()
            ctx.lineWidth = 1
            ctx.strokeStyle = 'rgba(255,220,170,0.1)'
            ctx.beginPath()
            ctx.moveTo(x + pr, y + 0.5)
            ctx.lineTo(x + cell - pr, y + 0.5)
            ctx.stroke()
            ctx.restore()
        }
    }

    // Inner bevel and glow line.
    innerShadow(ctx, field, 'rgba(0,0,0,0.85)', t * 0.7, t * 0.15, t * 0.2)
    // Warm bronze rim around the field.
    ctx.save()
    ctx.lineWidth = Math.max(2, t * 0.2)
    ctx.strokeStyle = lin(ctx, 0, 0, w, h, GOLD)
    ctx.stroke(field)
    ctx.restore()
    blurStroke(ctx, field, 'rgba(255,160,60,0.55)', 1.5, 6)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = 0.8
    ctx.strokeStyle = 'rgba(255,230,170,0.6)'
    ctx.stroke(field)
    ctx.restore()

    // Corner rune crests with small flames.
    const cr = t * 0.95
    for (const [x, y] of [[t * 0.8, t * 0.8], [w - t * 0.8, t * 0.8], [t * 0.8, h - t * 0.8], [w - t * 0.8, h - t * 0.8]] as const) {
        glow(ctx, x, y, cr * 3.2, 'rgba(255,140,40,0.7)')
        const crest = new Path2D()
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU - Math.PI / 2
            const r = i % 2 ? cr * 0.72 : cr
            if (i) crest.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
            else crest.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
        }
        crest.closePath()
        blurFill(ctx, crest, 'rgba(0,0,0,0.7)', cr * 0.3, 0, cr * 0.1)
        ctx.fillStyle = lin(ctx, x - cr, y - cr, x + cr, y + cr, GOLD)
        ctx.fill(crest)
        innerShadow(ctx, crest, 'rgba(255,250,220,0.9)', cr * 0.08, cr * 0.06, cr * 0.06)
        const gem = circle(x, y, cr * 0.42)
        ctx.fillStyle = rad(ctx, x, y, cr * 0.42, [[0, '#fffbe0'], [0.35, '#ffb040'], [0.75, '#e0400a'], [1, '#400804']], x - cr * 0.12, y - cr * 0.14, 0)
        ctx.fill(gem)
        glow(ctx, x, y, cr * 1.1, 'rgba(255,170,60,0.95)')
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.fill(ellipse(x - cr * 0.14, y - cr * 0.16, cr * 0.12, cr * 0.07, -0.6))
    }
    return c
}
