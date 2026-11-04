import * as THREE from 'three'
import { canvas, finish } from './canvas'
import { curve, MAX_S, NOSE_U, TAIL_U, type BodySurface } from './car-body'

/** The car's paintwork, drawn at load: stripes, numbers and shut lines on the skin, and an atlas of smaller decals. */

const WHITE = '#f4f4ee'
const GOLD = '#c99a3c'
const ORANGE = '#ee5a14'
const INK = '#08080a'
const SHUT_LINE = 'rgba(0, 0, 0, 0.72)'

const WIDE_FONT = '"Eurostile", "Bank Gothic", "Microgramma", "Segoe UI", "Helvetica Neue", Arial, sans-serif'
const NUMBER_FONT = '"Arial Black", "Segoe UI Black", "Helvetica Neue", Arial, sans-serif'

const CAR_NUMBER = '07'
const CAR_NAME = 'KESTREL'

type Ctx = CanvasRenderingContext2D

/** Pixels per metre on the livery canvas. */
const PPM = 400
const W = 2048
const H = Math.round(2 * MAX_S * PPM)

const px = (u: number) => (u - TAIL_U) / (NOSE_U - TAIL_U) * W
const py = (s: number) => H / 2 + s / (2 * MAX_S) * H

function spaced(ctx: Ctx, spacing: string) {
    (ctx as Ctx & { letterSpacing: string }).letterSpacing = spacing
}

/** The racing roundel: a white disc, a black ring and the number. Drawn around the origin. */
function roundel(ctx: Ctx, r: number) {
    ctx.fillStyle = WHITE
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = INK
    ctx.lineWidth = r * 0.09
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.font = `italic 900 ${r * 1.05}px ${NUMBER_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(CAR_NUMBER, 0, r * 0.04)
}

/** Fills the band between two edges in canvas space, walking u0 to u1. */
function band(ctx: Ctx, u0: number, u1: number, lo: (u: number) => number, hi: (u: number) => number, fill: string) {
    const steps = 48
    ctx.fillStyle = fill
    ctx.beginPath()
    for (let i = 0; i <= steps; i++) {
        const u = u0 + (u1 - u0) * i / steps
        ctx[i ? 'lineTo' : 'moveTo'](px(u), py(lo(u)))
    }
    for (let i = steps; i >= 0; i--) {
        const u = u0 + (u1 - u0) * i / steps
        ctx.lineTo(px(u), py(hi(u)))
    }
    ctx.closePath()
    ctx.fill()
}

/** Strokes a line along the surface. */
function line(ctx: Ctx, pts: [number, number][], stroke: string, width = 1.6) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    pts.forEach(([u, s], i) => ctx[i ? 'lineTo' : 'moveTo'](px(u), py(s)))
    ctx.stroke()
}

/** The stripes over the car's spine, drawn once per side and pinching together into the beak. */
function spineStripes(ctx: Ctx) {
    const pinch = curve([[TAIL_U, 1], [1.2, 1], [1.9, 0.86], [2.35, 0.52], [NOSE_U, 0.2]])
    const stripe = (a: number, b: number, fill: string) => {
        for (const side of [-1, 1]) band(ctx, TAIL_U + 0.02, NOSE_U, u => side * a * pinch(u), u => side * b * pinch(u), fill)
    }
    stripe(0.075, 0.27, WHITE)
    stripe(0.325, 0.345, GOLD)
    // The beak is solid white where the two stripes run together.
    band(ctx, 2.2, NOSE_U, () => -0.09, () => 0.09, WHITE)
}

/** Everything painted down one flank; `side` is +1 for the car's right. */
function flank(ctx: Ctx, surface: BodySurface, side: number) {
    const sAt = (u: number, y: number) => side * surface.sAtY(u, y)
    /** Draws upright and level with the ground as seen from outside the car, with the origin at (u, y). */
    const upright = (u: number, y: number, draw: () => void) => {
        ctx.save()
        ctx.translate(px(u), py(sAt(u, y)))
        ctx.rotate(Math.atan2(py(sAt(u + 0.04, y)) - py(sAt(u - 0.04, y)), px(u + 0.04) - px(u - 0.04)))
        if (side < 0) ctx.rotate(Math.PI)
        draw()
        ctx.restore()
    }
    const lined = (pts: [number, number][], stroke = SHUT_LINE, width = 1.6) => line(ctx, pts.map(([u, y]) => [u, sAt(u, y)]), stroke, width)

    // The door's speed line, white over orange.
    const speedTop = curve([[-0.3, 0.665], [0.3, 0.635], [0.86, 0.6]])
    band(ctx, -0.3, 0.86, u => sAt(u, speedTop(u)), u => sAt(u, speedTop(u) - 0.05), WHITE)
    band(ctx, -0.3, 0.86, u => sAt(u, speedTop(u) - 0.05), u => sAt(u, speedTop(u) - 0.072), ORANGE)

    upright(0.34, 0.43, () => roundel(ctx, 52))
    upright(0.32, 0.27, () => {
        ctx.fillStyle = WHITE
        ctx.font = `500 34px ${WIDE_FONT}`
        spaced(ctx, '6px')
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(CAR_NAME, 0, 0)
        spaced(ctx, '0px')
    })
    upright(0.26, 0.2, () => {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.font = `600 10px ${WIDE_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('CARBON MONOCOQUE · 1,800 HP · 0-100 IN 2.1 S', 0, 0)
    })
    // Chevrons point toward the nose: right on the car's right flank as seen, left on its left.
    upright(-0.06, 0.4, () => {
        ctx.strokeStyle = ORANGE
        ctx.lineWidth = 8
        ctx.lineCap = 'butt'
        ctx.lineJoin = 'miter'
        for (let i = 0; i < 3; i++) {
            const x = (i - 1) * 17
            ctx.beginPath()
            ctx.moveTo(x - 7, -22)
            ctx.lineTo(x + 7, 0)
            ctx.lineTo(x - 7, 22)
            ctx.stroke()
        }
    })
    upright(0.62, 0.7, () => {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
        ctx.font = `700 11px ${WIDE_FONT}`
        ctx.textAlign = 'center'
        ctx.fillText('K. VOSS', 0, 0)
        ctx.fillStyle = '#d3211a'
        ctx.beginPath()
        ctx.moveTo(-34, 3)
        ctx.lineTo(-27, -9)
        ctx.lineTo(-20, 3)
        ctx.fill()
    })

    // The rear fender's slanted dashes, growing toward the door; two of them orange.
    const dashes = 8
    for (let i = 0; i < dashes; i++) {
        const u = -1.08 - i * 0.11
        const y = 0.79 + i * 0.008
        const size = 1 - i * 0.045
        upright(u, y, () => {
            ctx.fillStyle = i === 2 || i === 5 ? ORANGE : WHITE
            ctx.beginPath()
            const w = 20 * size
            const h = 14 * size
            ctx.moveTo(-w, h)
            ctx.lineTo(w * 0.1, h)
            ctx.lineTo(w, -h)
            ctx.lineTo(-w * 0.1, -h)
            ctx.closePath()
            ctx.fill()
        })
    }
    upright(-1.95, 0.56, () => {
        ctx.fillStyle = WHITE
        ctx.fillRect(-26, -9, 52, 18)
        ctx.fillStyle = INK
        ctx.font = `800 13px ${WIDE_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('NITRO', 0, 1)
    })
    upright(2.0, 0.355, () => {
        ctx.fillStyle = ORANGE
        ctx.beginPath()
        ctx.roundRect(-36, -9, 72, 18, 3)
        ctx.fill()
        ctx.fillStyle = INK
        ctx.font = `800 13px ${WIDE_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('NITRO', 0, 1)
    })

    // Louvres behind the front wheel: dark, with lit slats.
    const lo = curve([[0.76, 0.33], [0.97, 0.3]])
    const hi = curve([[0.76, 0.56], [0.97, 0.62]])
    band(ctx, 0.76, 0.97, u => sAt(u, hi(u)), u => sAt(u, lo(u)), INK)
    for (let i = 0; i < 4; i++) {
        const t = (i + 0.7) / 4.2
        lined([[0.77, lo(0.77) + (hi(0.77) - lo(0.77)) * t], [0.96, lo(0.96) + (hi(0.96) - lo(0.96)) * t]], 'rgba(150, 156, 160, 0.9)', 3.2)
    }

    // Short gills along the front fender's crest and the rear haunch.
    const gills = (u0: number, u1: number, n: number, x: number, len: number, width: number) => {
        for (let i = 0; i < n; i++) {
            const u = u0 + (u1 - u0) * i / (n - 1)
            const a = side * surface.sAtX(u, x)
            line(ctx, [[u - 0.015, a], [u + 0.015, a + side * len]], INK, width)
        }
    }
    gills(1.0, 1.28, 7, 0.6, 0.15, 5)
    gills(-1.2, -1.82, 12, 0.56, 0.2, 6)

    // Shut lines: door, front wing, rear clamshell, fuel flap and door handle.
    lined([[0.9, 0.81], [0.88, 0.55], [0.84, 0.23]])
    lined([[-0.26, 0.86], [-0.3, 0.6], [-0.3, 0.23]])
    lined([[0.9, 0.81], [0.5, 0.79], [0.1, 0.79], [-0.26, 0.82]])
    lined([[-1.9, 0.68], [-1.9, 0.6], [-1.78, 0.6], [-1.78, 0.68], [-1.9, 0.68]])
    upright(-0.05, 0.745, () => {
        ctx.strokeStyle = SHUT_LINE
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.roundRect(-44, -10, 88, 20, 10)
        ctx.stroke()
    })

    // The bonnet's cut, closing in on the badge at the beak.
    const hood = curve([[0.98, 0.62], [1.5, 0.6], [2.0, 0.44], [2.32, 0.08]])
    line(ctx, Array.from({ length: 40 }, (_, i) => {
        const u = 0.98 + (2.32 - 0.98) * i / 39
        return [u, side * surface.sAtX(u, hood(u))] as [number, number]
    }), SHUT_LINE)
}

function noseBadge(ctx: Ctx) {
    ctx.save()
    ctx.translate(px(2.35), py(0))
    ctx.fillStyle = INK
    ctx.beginPath()
    ctx.arc(0, 0, 14, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = WHITE
    ctx.beginPath()
    ctx.moveTo(9, 0)
    ctx.lineTo(-7, -7)
    ctx.lineTo(-3, 0)
    ctx.lineTo(-7, 7)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
}

/** The skin's livery; premultiplied so mips don't bleed black, and left in sRGB so the paint shader can undo both. */
export function liveryTexture(surface: BodySurface) {
    const [c, ctx] = canvas(W, H)
    ctx.clearRect(0, 0, W, H)
    spineStripes(ctx)
    for (const side of [-1, 1]) flank(ctx, surface, side)
    // On the bonnet, upright to someone standing ahead of the car.
    ctx.save()
    ctx.translate(px(1.3), py(0))
    ctx.rotate(-Math.PI / 2)
    roundel(ctx, 46)
    ctx.restore()
    noseBadge(ctx)
    const t = finish(c, false)
    t.premultiplyAlpha = true
    return t
}

/** A place on the decal atlas, in pixels. */
export interface AtlasRect {
    x: number
    y: number
    w: number
    h: number
}

const ATLAS = 1024
export const DECALS = {
    tyre: { x: 0, y: 0, w: 512, h: 512 },
    name: { x: 512, y: 0, w: 512, h: 128 },
    number: { x: 512, y: 128, w: 256, h: 128 },
    plate: { x: 768, y: 128, w: 256, h: 128 },
    banner: { x: 512, y: 256, w: 512, h: 72 }
} satisfies Record<string, AtlasRect>

/** Where a rect's corner sits in uv, for a point a and b of the way across it (b measured up from its bottom). */
export function atlasUv(r: AtlasRect, a: number, b: number): [number, number] {
    return [(r.x + r.w * a) / ATLAS, 1 - (r.y + r.h * (1 - b)) / ATLAS]
}

/** Points a geometry's 0 to 1 uv at one decal. */
export function mapToDecal<T extends THREE.BufferGeometry>(geo: T, r: AtlasRect) {
    const uv = geo.attributes.uv!
    for (let i = 0; i < uv.count; i++) {
        const [a, b] = atlasUv(r, uv.getX(i), uv.getY(i))
        uv.setXY(i, a, b)
    }
    return geo
}

function tyreLettering(ctx: Ctx, r: AtlasRect) {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const radius = r.w * 0.415
    ctx.fillStyle = WHITE
    ctx.font = `800 26px ${WIDE_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const text = `${CAR_NAME} CORSA`
    for (const start of [0, Math.PI]) {
        const step = 0.098
        for (let i = 0; i < text.length; i++) {
            const a = start + (i - (text.length - 1) / 2) * step
            ctx.save()
            ctx.translate(cx + Math.sin(a) * radius, cy - Math.cos(a) * radius)
            ctx.rotate(a)
            ctx.fillText(text[i]!, 0, 0)
            ctx.restore()
        }
    }
}

/** The smaller decals, shared by every car. */
export function decalAtlas() {
    const [c, ctx] = canvas(ATLAS, ATLAS)
    ctx.clearRect(0, 0, ATLAS, ATLAS)
    tyreLettering(ctx, DECALS.tyre)

    const name = DECALS.name
    ctx.fillStyle = WHITE
    ctx.font = `500 76px ${WIDE_FONT}`
    spaced(ctx, '14px')
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(CAR_NAME, name.x + name.w / 2, name.y + name.h / 2, name.w - 24)

    const banner = DECALS.banner
    ctx.font = `600 44px ${WIDE_FONT}`
    spaced(ctx, '10px')
    ctx.fillText(CAR_NAME, banner.x + banner.w / 2, banner.y + banner.h / 2, banner.w - 60)
    spaced(ctx, '0px')

    const num = DECALS.number
    ctx.font = `italic 900 88px ${NUMBER_FONT}`
    ctx.fillText(CAR_NUMBER, num.x + num.w / 2, num.y + num.h / 2)

    const plate = DECALS.plate
    ctx.font = `600 30px ${WIDE_FONT}`
    spaced(ctx, '3px')
    ctx.fillText(CAR_NAME, plate.x + plate.w / 2, plate.y + plate.h * 0.32)
    spaced(ctx, '0px')
    ctx.fillStyle = ORANGE
    ctx.fillRect(plate.x + 34, plate.y + plate.h * 0.5, plate.w - 68, 3)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.font = `600 16px ${WIDE_FONT}`
    ctx.fillText('R1 · ACTIVE AERO', plate.x + plate.w / 2, plate.y + plate.h * 0.72)
    return finish(c)
}

/** Dark mesh for the vents, tiled across them; a tile covers a set size on the car. */
export function meshTexture() {
    const [c, ctx] = canvas(64, 64)
    ctx.fillStyle = '#050506'
    ctx.fillRect(0, 0, 64, 64)
    const holes = (fill: string, r: number) => {
        ctx.fillStyle = fill
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 2; x++) {
                const ox = x * 32 + (y % 2) * 16
                const oy = y * 32
                ctx.beginPath()
                ctx.arc(ox + 8, oy + 16, r, 0, Math.PI * 2)
                ctx.arc(ox - 24, oy + 16, r, 0, Math.PI * 2)
                ctx.fill()
            }
        }
    }
    holes('#141518', 8.5)
    holes('#050506', 5.5)
    const t = finish(c)
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.repeat.set(16, 16)
    return t
}
