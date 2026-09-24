// Ember Portals: shared canvas-2D painting helpers (gradients, soft glows,
// rim light, inner shadow, blurred silhouettes). Blurs use the shadow trick
// rather than ctx.filter, which Safari doesn't support on canvas.

export type Ctx = CanvasRenderingContext2D
export type Stops = [number, string][]

export const TAU = Math.PI * 2

export function makeCanvas(w: number, h = w): [HTMLCanvasElement, Ctx] {
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w))
    c.height = Math.max(1, Math.round(h))
    return [c, c.getContext('2d')!]
}

/** Current user-space → device scale (the contexts here only scale, never rotate). */
export function scaleOf(ctx: Ctx): number {
    const t = ctx.getTransform()
    return Math.hypot(t.a, t.b) || 1
}

export function lin(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: Stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1)
    for (const [o, c] of stops) g.addColorStop(o, c)
    return g
}

export function rad(ctx: Ctx, x: number, y: number, r: number, stops: Stops, x0 = x, y0 = y, r0 = 0) {
    const g = ctx.createRadialGradient(x0, y0, r0, x, y, r)
    for (const [o, c] of stops) g.addColorStop(o, c)
    return g
}

export function circle(cx: number, cy: number, r: number): Path2D {
    const p = new Path2D()
    p.arc(cx, cy, r, 0, TAU)
    return p
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0): Path2D {
    const p = new Path2D()
    p.ellipse(cx, cy, rx, ry, rot, 0, TAU)
    return p
}

export function poly(pts: [number, number][]): Path2D {
    const p = new Path2D()
    pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)))
    p.closePath()
    return p
}

/** Closed polygon with rounded corners. */
export function roundedPoly(pts: [number, number][], r: number): Path2D {
    const p = new Path2D()
    const n = pts.length
    const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const start = mid(pts[n - 1]!, pts[0]!)
    p.moveTo(start[0], start[1])
    for (let i = 0; i < n; i++) {
        const cur = pts[i]!
        const m = mid(cur, pts[(i + 1) % n]!)
        p.arcTo(cur[0], cur[1], m[0], m[1], r)
    }
    p.closePath()
    return p
}

export function regular(cx: number, cy: number, r: number, sides: number, rot = -Math.PI / 2): [number, number][] {
    const pts: [number, number][] = []
    for (let i = 0; i < sides; i++) {
        const a = rot + (i / sides) * TAU
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
    return pts
}

export function roundRect(x: number, y: number, w: number, h: number, r: number): Path2D {
    const p = new Path2D()
    p.roundRect(x, y, w, h, r)
    return p
}

/** Pointed leaf / feather / flame tongue from (x0,y0) to (x1,y1). `bend` curves it sideways. */
export function leaf(x0: number, y0: number, x1: number, y1: number, w: number, bend = 0): Path2D {
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const mx = x0 + dx * 0.42 + nx * bend
    const my = y0 + dy * 0.42 + ny * bend
    const p = new Path2D()
    p.moveTo(x0, y0)
    p.quadraticCurveTo(mx + nx * w, my + ny * w, x1, y1)
    p.quadraticCurveTo(mx - nx * w, my - ny * w, x0, y0)
    p.closePath()
    return p
}

/** A licking flame: wide round base, S-curved body, sharp tip. */
export function flame(x0: number, y0: number, x1: number, y1: number, w: number, sway: number): Path2D {
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const at = (t: number, s: number): [number, number] => [x0 + dx * t + nx * s, y0 + dy * t + ny * s]
    const p = new Path2D()
    const [ax, ay] = at(0, -w)
    p.moveTo(ax, ay)
    const [c1x, c1y] = at(0.35, -w * 1.05 + sway * 0.4)
    const [c2x, c2y] = at(0.7, -w * 0.3 + sway)
    p.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1)
    const [c3x, c3y] = at(0.72, w * 0.25 + sway * 1.1)
    const [c4x, c4y] = at(0.35, w * 1.05 + sway * 0.4)
    const [bx, by] = at(0, w)
    p.bezierCurveTo(c3x, c3y, c4x, c4y, bx, by)
    const [c5x, c5y] = at(-0.22, w * 0.6)
    const [c6x, c6y] = at(-0.22, -w * 0.6)
    p.bezierCurveTo(c5x, c5y, c6x, c6y, ax, ay)
    p.closePath()
    return p
}

/** Draw into a same-size scratch layer, then composite it back. */
export function layer(ctx: Ctx, draw: (l: Ctx) => void, op: GlobalCompositeOperation = 'source-over', alpha = 1) {
    const src = ctx.canvas
    const [c, l] = makeCanvas(src.width, src.height)
    const t = ctx.getTransform()
    l.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
    draw(l)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = op
    ctx.globalAlpha = alpha
    ctx.drawImage(c, 0, 0)
    ctx.restore()
}

/** Blurred silhouette of `p` (shadow trick: the shape itself is drawn off-canvas). */
export function blurFill(ctx: Ctx, p: Path2D, color: string, blur: number, dx = 0, dy = 0) {
    const k = scaleOf(ctx)
    const far = 20000
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = blur * k
    ctx.shadowOffsetX = far * k + dx * k
    ctx.shadowOffsetY = dy * k
    ctx.translate(-far, 0)
    ctx.fillStyle = '#000'
    ctx.fill(p)
    ctx.restore()
}

/** Blurred stroke of `p`. */
export function blurStroke(ctx: Ctx, p: Path2D, color: string, width: number, blur: number) {
    const k = scaleOf(ctx)
    const far = 20000
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = blur * k
    ctx.shadowOffsetX = far * k
    ctx.translate(-far, 0)
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#000'
    ctx.stroke(p)
    ctx.restore()
}

/** Shadow cast inward from the edges of `p`, offset by (dx, dy). */
export function innerShadow(ctx: Ctx, p: Path2D, color: string, blur: number, dx = 0, dy = 0) {
    const k = scaleOf(ctx)
    ctx.save()
    ctx.clip(p)
    const frame = new Path2D()
    frame.rect(-4000, -4000, 12000, 12000)
    frame.addPath(p)
    ctx.shadowColor = color
    ctx.shadowBlur = blur * k
    ctx.shadowOffsetX = dx * k
    ctx.shadowOffsetY = dy * k
    ctx.fillStyle = '#000'
    ctx.fill(frame, 'evenodd')
    ctx.restore()
}

/**
 * A soft crescent of light along the edge of `p` facing away from (dx, dy):
 * dx, dy > 0 lights the top-left edge.
 */
export function rimLight(ctx: Ctx, p: Path2D, color: string, dx: number, dy: number, blur: number, op: GlobalCompositeOperation = 'source-over', alpha = 1) {
    layer(ctx, (l) => {
        l.fillStyle = color
        l.fill(p)
        l.globalCompositeOperation = 'destination-out'
        const k = scaleOf(l)
        const far = 20000
        l.save()
        l.shadowColor = '#000'
        l.shadowBlur = blur * k
        l.shadowOffsetX = far * k + dx * k
        l.shadowOffsetY = dy * k
        l.translate(-far, 0)
        l.fill(p)
        l.restore()
    }, op, alpha)
}

/** Additive radial glow. */
export function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 1) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = alpha
    ctx.fillStyle = rad(ctx, x, y, r, [[0, color], [0.45, fade(color, 0.35)], [1, fade(color, 0)]])
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
    ctx.restore()
}

/** Normal-blend soft radial wash. */
export function wash(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 1) {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = rad(ctx, x, y, r, [[0, color], [1, fade(color, 0)]])
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
    ctx.restore()
}

/** Same colour at a different alpha; accepts '#rrggbb' or 'rgba(r,g,b,a)'. */
export function fade(color: string, alpha: number): string {
    if (color.startsWith('#')) {
        const n = Number.parseInt(color.slice(1, 7), 16)
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
    }
    const m = color.match(/rgba?\(([^,]+),([^,]+),([^,)]+)(?:,([^)]+))?\)/)
    if (!m) return color
    const a = m[4] === undefined ? 1 : Number(m[4])
    return `rgba(${m[1]},${m[2]},${m[3]},${(a * alpha).toFixed(3)})`
}

/** Mix two '#rrggbb' colours. */
export function mix(a: string, b: string, t: number): string {
    const pa = Number.parseInt(a.slice(1, 7), 16)
    const pb = Number.parseInt(b.slice(1, 7), 16)
    const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
    return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`
}

/** Four-point star glint. */
export function sparkle(ctx: Ctx, x: number, y: number, r: number, color = '#ffffff', alpha = 1) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = alpha
    ctx.fillStyle = rad(ctx, x, y, r * 0.7, [[0, fade(color, 0.8)], [1, fade(color, 0)]])
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(x, y - r)
    ctx.quadraticCurveTo(x, y, x + r * 0.8, y)
    ctx.quadraticCurveTo(x, y, x, y + r)
    ctx.quadraticCurveTo(x, y, x - r * 0.8, y)
    ctx.quadraticCurveTo(x, y, x, y - r)
    ctx.fill()
    ctx.restore()
}

/** Polished gold: alternating bands so it reads as curved metal. */
export const GOLD: Stops = [[0, '#6b3a07'], [0.16, '#e9b64a'], [0.3, '#fff3c4'], [0.44, '#f1c35a'], [0.6, '#8a520f'], [0.78, '#e2a93c'], [0.9, '#ffe8a0'], [1, '#7a4608']]
export const GOLD_SOFT: Stops = [[0, '#8a520f'], [0.3, '#f5cf6a'], [0.5, '#fff1c0'], [0.72, '#d69a32'], [1, '#6b3a07']]

/** Small seeded PRNG so painted scenes come out the same every load (cosmetic only). */
export function seeded(seed: number) {
    let a = seed
    return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
