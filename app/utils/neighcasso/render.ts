import type { NcDrawing, NcRaceEventKind, NcStroke, NcStrokeKind } from '#shared/utils/neighcasso/types'

/**
 * Neighcasso horse renderer: turns a flat doodle into a rigged puppet (legs
 * swing from the hip, tail wags, head nods) and draws it with a hand-drawn
 * line boil. Plain canvas 2D, no Vue.
 */

export type NcPose = 'idle' | 'win' | NcRaceEventKind

export interface NcPart {
    rig: NcStrokeKind
    color: string
    width: number
    dot: boolean
    /** Boil variants of the stroke, in drawing units. */
    paths: Path2D[]
    /** Dot centre per boil variant (only for dots). */
    dots: number[]
    pivotX: number
    pivotY: number
    /** Gallop phase offset in radians (legs only). */
    phase: number
    /** 1 for a front leg, -1 for a back leg. */
    side: number
    seed: number
}

export interface PreparedHorse {
    parts: NcPart[]
    minX: number
    minY: number
    maxX: number
    maxY: number
    w: number
    h: number
    cx: number
    cy: number
    legCount: number
    /** Where the head sits relative to the bbox, 0..1. */
    headU: number
    headV: number
}

export interface DrawHorseOptions {
    /** Bottom-centre (feet) anchor in canvas px. */
    x: number
    y: number
    /** On-screen height of the drawing's bbox, px. */
    height: number
    /** Seconds; drives breathing, boil and wagging. */
    time: number
    /** 0 idle, ~1 gallop, 2.5 zoomies. */
    gait: number
    pose?: NcPose
    /** Seconds since the pose began (event poses). Defaults to `time`. */
    poseT?: number
    /** Length of the pose in seconds. Defaults to 1. */
    poseDur?: number
    /**
     * Accumulated stride in cycles. Pass one you integrate yourself
     * (`stride += dt * gaitRate(gait)`) when gait changes over time, otherwise
     * the legs jump phase. Defaults to `time * gaitRate(gait)`.
     */
    stride?: number
    flip?: boolean
    alpha?: number
    /** Paper-coloured sticker outline behind every stroke. */
    halo?: string | null
    /** Halo thickness on screen, px. */
    haloWidth?: number
    /** Per-horse offset so identical drawings don't move in sync. */
    seed?: number
}

const BOIL_VARIANTS = 3
const BOIL_FPS = 8
const MIN_LINE_PX = 1.5
const TAU = Math.PI * 2

/** Stride cycles per second for a gait. */
export function gaitRate(gait: number): number {
    return gait <= 0.02 ? 0 : 0.9 + 1.9 * gait
}

/** Deterministic hash to [0, 1). */
export function ncHash(a: number, b = 0, c = 0): number {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
}

function strokeBox(p: number[]) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < p.length; i += 2) {
        const x = p[i]!
        const y = p[i + 1]!
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
    }
    return { minX, minY, maxX, maxY }
}

function buildPath(p: number[]): Path2D {
    const path = new Path2D()
    const n = p.length / 2
    path.moveTo(p[0]!, p[1]!)
    if (n === 2) {
        path.lineTo(p[2]!, p[3]!)
        return path
    }
    for (let i = 1; i < n - 1; i++) {
        const x = p[i * 2]!
        const y = p[i * 2 + 1]!
        const mx = (x + p[i * 2 + 2]!) / 2
        const my = (y + p[i * 2 + 3]!) / 2
        path.quadraticCurveTo(x, y, mx, my)
    }
    path.lineTo(p[(n - 1) * 2]!, p[(n - 1) * 2 + 1]!)
    return path
}

/** Drop points closer than `min` to the previous one; keeps the last point. */
function decimate(p: number[], min: number): number[] {
    if (p.length <= 4) return p
    const out = [p[0]!, p[1]!]
    const min2 = min * min
    for (let i = 2; i < p.length - 2; i += 2) {
        const dx = p[i]! - out[out.length - 2]!
        const dy = p[i + 1]! - out[out.length - 1]!
        if (dx * dx + dy * dy >= min2) out.push(p[i]!, p[i + 1]!)
    }
    out.push(p[p.length - 2]!, p[p.length - 1]!)
    return out
}

export function prepareHorse(drawing: NcDrawing): PreparedHorse {
    const strokes: NcStroke[] = drawing?.strokes?.filter(s => Array.isArray(s.p) && s.p.length >= 2) ?? []
    if (!strokes.length) return prepareHorse(DEFAULT_HORSE)

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const boxes = strokes.map((s) => {
        const b = strokeBox(s.p)
        const r = s.w / 2
        minX = Math.min(minX, b.minX - r)
        minY = Math.min(minY, b.minY - r)
        maxX = Math.max(maxX, b.maxX + r)
        maxY = Math.max(maxY, b.maxY + r)
        return b
    })
    let w = maxX - minX
    let h = maxY - minY
    if (h < 20) {
        const pad = (20 - h) / 2
        minY -= pad
        maxY += pad
        h = 20
    }
    if (w < 20) {
        const pad = (20 - w) / 2
        minX -= pad
        maxX += pad
        w = 20
    }

    // Rig kinds, auto-detecting legs when nobody tagged any.
    const rigs: NcStrokeKind[] = strokes.map(s => s.k)
    if (!rigs.includes('leg')) {
        const legTop = minY + h * 0.5
        const candidates: number[] = []
        boxes.forEach((b, i) => {
            if (rigs[i] !== 'body') return
            const bh = b.maxY - b.minY
            const bw = b.maxX - b.minX
            if (bh >= h * 0.15 && bh >= bw * 0.9 && b.minY >= legTop) candidates.push(i)
        })
        // A body made only of "legs" (e.g. a column of vertical scribbles) stays a body.
        if (candidates.length && candidates.length < strokes.length && candidates.length <= 8) {
            for (const i of candidates) rigs[i] = 'leg'
        }
    }

    // Body centre from whatever isn't a limb.
    let bMinX = Infinity
    let bMinY = Infinity
    let bMaxX = -Infinity
    let bMaxY = -Infinity
    boxes.forEach((b, i) => {
        if (rigs[i] !== 'body') return
        bMinX = Math.min(bMinX, b.minX)
        bMinY = Math.min(bMinY, b.minY)
        bMaxX = Math.max(bMaxX, b.maxX)
        bMaxY = Math.max(bMaxY, b.maxY)
    })
    const hasBody = Number.isFinite(bMinX)
    const bodyCx = hasBody ? (bMinX + bMaxX) / 2 : (minX + maxX) / 2
    const bodyCy = hasBody ? (bMinY + bMaxY) / 2 : (minY + maxY) / 2

    // Shared pivots for the head group and the tail group so multi-stroke
    // heads (eyes, ears, mane) move as one.
    const nearest = (kind: NcStrokeKind, endpointsOnly: boolean) => {
        let best: [number, number] | null = null
        let bestD = Infinity
        strokes.forEach((s, i) => {
            if (rigs[i] !== kind) return
            const idx = endpointsOnly ? [0, s.p.length - 2] : Array.from({ length: s.p.length / 2 }, (_, j) => j * 2)
            for (const j of idx) {
                const dx = s.p[j]! - bodyCx
                const dy = s.p[j + 1]! - bodyCy
                const d = dx * dx + dy * dy
                if (d < bestD) {
                    bestD = d
                    best = [s.p[j]!, s.p[j + 1]!]
                }
            }
        })
        return best as [number, number] | null
    }
    const headPivot = nearest('head', false)
    const tailPivot = nearest('tail', true)

    let hMinX = Infinity
    let hMinY = Infinity
    let hMaxX = -Infinity
    let hMaxY = -Infinity
    boxes.forEach((b, i) => {
        if (rigs[i] !== 'head') return
        hMinX = Math.min(hMinX, b.minX)
        hMinY = Math.min(hMinY, b.minY)
        hMaxX = Math.max(hMaxX, b.maxX)
        hMaxY = Math.max(hMaxY, b.maxY)
    })
    const headU = Number.isFinite(hMinX) ? ((hMinX + hMaxX) / 2 - minX) / w : 0.8
    const headV = Number.isFinite(hMinY) ? ((hMinY + hMaxY) / 2 - minY) / h : 0.15

    const amp = Math.max(0.6, h * 0.004)
    const minStep = Math.max(1, h * 0.004)
    const parts: NcPart[] = strokes.map((s, i) => {
        const rig = rigs[i]!
        const p = decimate(s.p, minStep)
        const dot = p.length === 2 || (boxes[i]!.maxX - boxes[i]!.minX < 1 && boxes[i]!.maxY - boxes[i]!.minY < 1)
        const paths: Path2D[] = []
        const dots: number[] = []
        for (let v = 0; v < BOIL_VARIANTS; v++) {
            const ox = (ncHash(i, v, 1) - 0.5) * 1.4 * amp
            const oy = (ncHash(i, v, 2) - 0.5) * 1.4 * amp
            if (dot) {
                dots.push(p[0]! + ox, p[1]! + oy)
                continue
            }
            const q = p.slice()
            for (let j = 0; j < q.length; j += 2) {
                q[j] = q[j]! + ox + (ncHash(i * 7919 + j, v, 3) - 0.5) * amp
                q[j + 1] = q[j + 1]! + oy + (ncHash(i * 7919 + j, v, 4) - 0.5) * amp
            }
            paths.push(buildPath(q))
        }

        let pivotX = bodyCx
        let pivotY = bodyCy
        if (rig === 'leg') {
            const top = s.p[1]! <= s.p[s.p.length - 1]! ? 0 : s.p.length - 2
            pivotX = s.p[top]!
            pivotY = s.p[top + 1]!
        } else if (rig === 'head' && headPivot) {
            [pivotX, pivotY] = headPivot
        } else if (rig === 'tail' && tailPivot) {
            [pivotX, pivotY] = tailPivot
        }
        return {
            rig,
            color: s.c,
            width: s.w,
            dot,
            paths,
            dots,
            pivotX,
            pivotY,
            phase: 0,
            side: pivotX >= bodyCx ? 1 : -1,
            seed: Math.floor(ncHash(i, 99) * 1000)
        }
    })

    // Gallop: back legs and front legs half a cycle apart, and each leg in a
    // pair a little behind its partner, ordered by x.
    const legs = parts.filter(p => p.rig === 'leg').sort((a, b) => a.pivotX - b.pivotX)
    const counts = { back: 0, front: 0 }
    for (const leg of legs) {
        const key = leg.side > 0 ? 'front' : 'back'
        const k = counts[key]++
        leg.phase = (leg.side > 0 ? Math.PI : 0) + (k % 2) * Math.PI * 0.55 + Math.floor(k / 2) * 0.3
    }

    return {
        parts,
        minX,
        minY,
        maxX,
        maxY,
        w,
        h,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        legCount: legs.length,
        headU,
        headV
    }
}

function clamp01(v: number) {
    return v < 0 ? 0 : v > 1 ? 1 : v
}

function easeInOut(v: number) {
    return v * v * (3 - 2 * v)
}

const FONT = '\'Comic Neue\', \'Chalkboard SE\', \'Comic Sans MS\', cursive'

export function drawHorse(ctx: CanvasRenderingContext2D, horse: PreparedHorse, opts: DrawHorseOptions): void {
    const { x, y, height, time } = opts
    const gait = Math.max(0, opts.gait)
    const pose = opts.pose ?? 'idle'
    const poseDur = opts.poseDur ?? 1
    const poseT = opts.poseT ?? time
    const seed = opts.seed ?? 0
    const s = height / horse.h
    if (!(s > 0)) return
    const dir = opts.flip ? -1 : 1
    const halfW = horse.w * s / 2

    let stride = opts.stride ?? time * gaitRate(gait)
    if (pose === 'moonwalk') stride = -stride
    const theta = stride * TAU
    const g = Math.min(gait, 1.5)
    const legless = horse.legCount === 0
    const running = gait > 0.05

    // Whole-body motion, in screen px around the feet anchor.
    let bob = 0
    let sx = 1
    let sy = 1 + 0.018 * Math.sin(time * 2.2 + seed)
    let rot = 0
    let rotX = 0
    let rotY = 0
    if (running) {
        const up = Math.abs(Math.sin(theta))
        if (legless) {
            bob = -up * height * 0.2 * Math.min(1.2, gait)
            const land = (1 - up) ** 3
            sy = 1 - 0.16 * land * Math.min(1, gait) + 0.08 * up * Math.min(1, gait)
            rot = Math.sin(theta) * 0.08 * g
            rotY = -height / 2
        } else {
            bob = -up * height * 0.055 * g
            sy = 1 + 0.04 * Math.sin(theta * 2) * g
            rot = 0.03 * gait + Math.sin(theta) * 0.035 * g
            rotY = -height * 0.4
        }
    } else if (legless) {
        rot = Math.sin(time * 1.7 + seed) * 0.05
        sy += 0.03 * Math.sin(time * 3.1 + seed)
    }

    const poseEnv = clamp01(poseT / poseDur)
    let legOverride: ((part: NcPart) => number) | null = null
    let headExtra = 0
    let lieDown = 0
    switch (pose) {
        case 'stumble': {
            const env = Math.sin(Math.PI * poseEnv)
            rot = 0.6 * env + 0.1 * Math.sin(poseT * 26) * env
            rotX = halfW * 0.9
            rotY = 0
            bob = 0
            headExtra = 0.3 * env
            break
        }
        case 'nap': {
            lieDown = Math.min(1, poseT * 4) * (poseEnv < 0.9 ? 1 : (1 - poseEnv) * 10)
            sy = 1 + 0.03 * Math.sin(time * 2.4)
            rot = 0
            bob = 0
            legOverride = part => (part.side > 0 ? 1.25 : -1.1) * lieDown
            headExtra = 0.3 * lieDown
            break
        }
        case 'moonwalk':
            rot = -0.08 + Math.sin(theta) * 0.03
            rotY = -height * 0.4
            break
        case 'spin':
            rot = TAU * easeInOut(poseEnv)
            rotX = 0
            rotY = -height / 2
            bob = -Math.sin(Math.PI * poseEnv) * height * 0.25
            break
        case 'win': {
            const hop = Math.abs(Math.sin(time * 5))
            bob = -hop * height * 0.08
            if (legless) {
                sy = 1 + 0.1 * Math.sin(time * 10)
                rot = Math.sin(time * 5) * 0.12
                rotY = -height / 2
            } else {
                rot = -(0.38 + 0.08 * Math.sin(time * 6))
                rotX = -halfW * 0.8
                rotY = 0
                legOverride = part => (part.side > 0
                    ? -0.5 + Math.sin(time * 12 + part.phase) * 0.6
                    : Math.sin(time * 3 + part.phase) * 0.1)
            }
            break
        }
        case 'zoomies':
            rot += 0.1
            break
    }
    sx = 1 / Math.sqrt(sy)

    const legAmp = running ? Math.min(0.7, 0.18 + 0.32 * gait) : 0
    const tailFlick = (() => {
        const f = (time + seed * 0.37) % 3.3
        return f < 0.45 ? Math.sin((f / 0.45) * TAU) * 0.35 : 0
    })()
    const wagSpeed = pose === 'win' ? 14 : 3 + 2.4 * g
    const tailAngle = Math.sin(time * wagSpeed + seed) * (0.1 + 0.12 * g) + 0.18 * g + (running ? 0 : tailFlick)
    const headAngle = (running ? Math.sin(theta * 2 + 0.6) * 0.05 * g : Math.sin(time * 1.1 + seed) * 0.03)
        + (pose === 'win' ? Math.sin(time * 9) * 0.1 : 0) + headExtra

    const partAngle = (part: NcPart) => {
        switch (part.rig) {
            case 'leg':
                if (legOverride) return legOverride(part)
                if (running) return Math.sin(theta + part.phase) * legAmp
                return Math.sin(time * 1.3 + part.phase + seed) * 0.03
            case 'tail':
                return tailAngle
            case 'head':
                return headAngle
            default:
                return 0
        }
    }

    const alpha = opts.alpha ?? 1

    // Speed lines trail behind on zoomies.
    if (pose === 'zoomies' || gait > 1.8) {
        ctx.save()
        ctx.globalAlpha = alpha * 0.55
        ctx.strokeStyle = '#4a4a4a'
        ctx.lineCap = 'round'
        ctx.lineWidth = Math.max(1.5, height * 0.025)
        for (let i = 0; i < 5; i++) {
            const ly = y - height * (0.15 + i * 0.17) + bob
            const len = height * (0.4 + ncHash(i, Math.floor(time * 10)) * 0.5)
            const start = x - dir * (halfW + height * 0.1 + ((time * 3 + i * 0.37) % 1) * height * 0.2)
            ctx.beginPath()
            ctx.moveTo(start, ly)
            ctx.lineTo(start - dir * len, ly)
            ctx.stroke()
        }
        ctx.restore()
    }

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(x, y + bob + lieDown * height * 0.18)
    if (dir < 0) ctx.scale(-1, 1)
    if (rot) {
        ctx.translate(rotX, rotY)
        ctx.rotate(rot)
        ctx.translate(-rotX, -rotY)
    }
    ctx.scale(sx, sy)
    ctx.scale(s, s)
    ctx.translate(-horse.cx, -horse.maxY)
    const base = ctx.getTransform()

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const boilFrame = Math.floor(time * BOIL_FPS)
    const minW = MIN_LINE_PX / s

    const place = (part: NcPart) => {
        const a = partAngle(part)
        ctx.setTransform(base)
        if (a) {
            ctx.translate(part.pivotX, part.pivotY)
            ctx.rotate(a)
            ctx.translate(-part.pivotX, -part.pivotY)
        }
    }
    const paint = (part: NcPart, color: string, width: number) => {
        const v = (boilFrame + part.seed) % BOIL_VARIANTS
        if (part.dot) {
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(part.dots[v * 2]!, part.dots[v * 2 + 1]!, width / 2, 0, TAU)
            ctx.fill()
        } else {
            ctx.strokeStyle = color
            ctx.lineWidth = width
            ctx.stroke(part.paths[v]!)
        }
    }

    if (opts.halo) {
        const extra = (opts.haloWidth ?? 4) * 2 / s
        for (const part of horse.parts) {
            place(part)
            paint(part, opts.halo, Math.max(part.width, minW) + extra)
        }
    }
    for (const part of horse.parts) {
        place(part)
        paint(part, part.color, Math.max(part.width, minW))
    }
    ctx.restore()

    // Overlays in plain screen space.
    const headX = x + dir * (horse.headU - 0.5) * horse.w * s
    const topY = y - height + bob
    if (pose === 'nap') {
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.fillStyle = '#3b4a8a'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (let i = 0; i < 3; i++) {
            const k = (time * 0.7 + i / 3) % 1
            const size = Math.max(9, height * (0.14 + k * 0.14))
            ctx.globalAlpha = alpha * Math.sin(Math.PI * k)
            ctx.font = `bold ${size}px ${FONT}`
            ctx.fillText(i % 2 ? 'z' : 'Z', headX + dir * height * (0.1 + k * 0.35), topY + height * 0.2 - k * height * 0.55)
        }
        ctx.restore()
    } else if (pose === 'stumble') {
        ctx.save()
        ctx.globalAlpha = alpha
        const size = Math.max(12, height * 0.32)
        ctx.font = `bold ${size}px ${FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        const wob = Math.sin(poseT * 18) * 0.2
        ctx.translate(headX, topY - height * 0.05)
        ctx.rotate(wob)
        ctx.lineWidth = Math.max(2, size * 0.16)
        ctx.strokeStyle = '#fffaf0'
        ctx.strokeText('?!', 0, 0)
        ctx.fillStyle = '#d6336c'
        ctx.fillText('?!', 0, 0)
        ctx.restore()
    } else if (pose === 'moonwalk') {
        ctx.save()
        ctx.globalAlpha = alpha
        for (let i = 0; i < 2; i++) {
            const tw = Math.abs(Math.sin(time * 7 + i * 2))
            const r = Math.max(3, height * 0.07) * tw
            const px = x + dir * (i ? -halfW * 0.6 : halfW * 0.5)
            const py = y - height * (i ? 0.1 : 0.25)
            star(ctx, px, py, r, '#f5b700')
        }
        ctx.restore()
    }
}

export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    if (r <= 0.3) return
    ctx.fillStyle = color
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU - Math.PI / 2
        const rr = i % 2 ? r * 0.38 : r
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    ctx.closePath()
    ctx.fill()
}

// ---------------------------------------------------------------------------
// Default horse
// ---------------------------------------------------------------------------

/** A wobbly closed loop, rounded to integers like a saved drawing. */
function loop(cx: number, cy: number, rx: number, ry: number, n: number, wob: number, phase: number): number[] {
    const p: number[] = []
    for (let i = 0; i <= n; i++) {
        const a = (i / n) * TAU
        const k = 1 + Math.sin(a * 3 + phase) * wob + Math.sin(a * 5 + phase * 2) * wob * 0.5
        p.push(Math.round(cx + Math.cos(a) * rx * k), Math.round(cy + Math.sin(a) * ry * k))
    }
    // Overshoot a touch past the start, like a pen that didn't quite stop.
    p.push(Math.round(cx + rx * 1.02), Math.round(cy + ry * 0.12))
    return p
}

const INK = '#3b2a1a'
const COAT = '#b5651d'

export const DEFAULT_HORSE: NcDrawing = {
    v: 1,
    strokes: [
        // Tail (behind the body)
        { k: 'tail', c: INK, w: 9, p: [178, 180, 150, 176, 124, 188, 106, 214, 102, 244, 112, 268] },
        { k: 'tail', c: INK, w: 6, p: [176, 190, 146, 200, 130, 226, 128, 254] },
        // Back legs
        { k: 'leg', c: COAT, w: 10, p: [212, 238, 206, 272, 212, 300, 206, 334, 222, 336] },
        { k: 'leg', c: COAT, w: 10, p: [244, 244, 246, 280, 238, 306, 244, 338, 260, 338] },
        // Front legs
        { k: 'leg', c: COAT, w: 10, p: [344, 244, 350, 280, 342, 308, 348, 338, 364, 338] },
        { k: 'leg', c: COAT, w: 10, p: [376, 236, 384, 270, 380, 302, 388, 334, 404, 334] },
        // Body
        { k: 'body', c: COAT, w: 8, p: loop(292, 204, 118, 52, 28, 0.04, 0.7) },
        { k: 'body', c: '#e8a86b', w: 5, p: [236, 226, 268, 236, 304, 238, 340, 230] },
        // Spots
        { k: 'body', c: INK, w: 12, p: [250, 196] },
        { k: 'body', c: INK, w: 9, p: [318, 184] },
        // Neck and head
        { k: 'head', c: COAT, w: 8, p: [378, 176, 392, 150, 408, 120, 420, 98] },
        { k: 'head', c: COAT, w: 8, p: [404, 196, 420, 164, 434, 130, 446, 108] },
        { k: 'head', c: COAT, w: 8, p: loop(452, 90, 44, 26, 20, 0.05, 2.1) },
        // Ears
        { k: 'head', c: COAT, w: 7, p: [424, 70, 426, 44, 440, 66] },
        { k: 'head', c: COAT, w: 7, p: [442, 66, 450, 40, 460, 64] },
        // Mane
        { k: 'head', c: INK, w: 7, p: [420, 72, 404, 86, 414, 96, 398, 110, 408, 120, 390, 136, 400, 146, 384, 164] },
        // Googly eye, nostril, goofy grin, tongue
        { k: 'head', c: '#ffffff', w: 20, p: [454, 80] },
        { k: 'head', c: INK, w: 9, p: [458, 82] },
        { k: 'head', c: INK, w: 6, p: [486, 92] },
        { k: 'head', c: INK, w: 4, p: [462, 104, 474, 110, 488, 104] },
        { k: 'head', c: '#e85d8a', w: 7, p: [474, 112, 478, 120] }
    ]
}
