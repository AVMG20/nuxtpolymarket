<script setup lang="ts">
import type { LevelField } from '#shared/utils/nitro-rush/field'
import { fieldOutlines, onAnyField } from '#shared/utils/nitro-rush/field-group'

/** A course's centreline, branches and all, and its fields, in a single colour turning slowly on a tilted turntable. */
const props = defineProps<{
    points: readonly [number, number][]
    heights?: readonly number[]
    closed: boolean
    /** A forked course's branches, laid on the same ground as the main line. */
    branches?: readonly { points: readonly [number, number][], heights?: readonly number[] }[]
    /** Its fields, drawn as floors with joined ones rimmed as one; the line isn't drawn across them. */
    fields?: readonly LevelField[]
    color: string
}>()

/** Points across the whole course, shared out by length. */
const SAMPLES = 160
/** The fewest points a short branch gets, so its bends still read. */
const MIN_LINE_SAMPLES = 12
const TILT = 0.95
/** Camera distance in track radii: enough perspective to read as 3D without warping the shape. */
const CAMERA = 3.2
const TURN_SECONDS = 16
const STILL_ANGLE = 0.6
const LINE_PX = 2
const FIELD_ALPHA = 0.22
const PAD_PX = 4
/** Heights are tiny beside a course's length; stretched so a ramp or a spiral reads at card size. */
const HEIGHT_SCALE = 5
/** Turntable angles sampled to find the line's reach over a whole turn. */
const FIT_ANGLES = 48

const canvas = ref<HTMLCanvasElement | null>(null)
let frame = 0
let observer: ResizeObserver | null = null

type Point3 = [number, number, number]

interface PreviewLine {
    points: readonly [number, number][]
    heights?: readonly number[]
    closed: boolean
}

/** A line's length along the ground, and where along it each point lies. */
function measure({ points: pts, closed }: PreviewLine) {
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
    const total = cum[cum.length - 1]! + (closed ? Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) : 0)
    return { cum, total }
}

/** `count` evenly spaced points along a line, with their heights. */
function resample(line: PreviewLine, count: number): Point3[] {
    const { points: pts, heights: hs, closed } = line
    const { cum, total } = measure(line)
    const out: Point3[] = []
    let j = 0
    for (let k = 0; k < count; k++) {
        const s = total * k / (closed ? count : count - 1)
        while (j < pts.length - 1 && cum[j + 1]! < s) j++
        const a = pts[j]!
        const b = pts[(j + 1) % pts.length]!
        const span = (j + 1 < pts.length ? cum[j + 1]! : total) - cum[j]!
        const f = span > 0 ? Math.min(1, (s - cum[j]!) / span) : 0
        const ha = hs?.[j] ?? 0
        const hb = hs?.[(j + 1) % pts.length] ?? 0
        out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, ha + (hb - ha) * f])
    }
    return out
}

/** Every line, main line first, as evenly spaced points, and every field, centred and scaled into the unit circle together. */
const shape = computed(() => {
    const fields = props.fields ?? []
    const lines: PreviewLine[] = [
        { points: props.points, heights: props.heights, closed: props.closed },
        ...(props.branches ?? []).filter(b => b.points.length > 1).map(b => ({ ...b, closed: false }))
    ]
    const lengths = lines.map(l => measure(l).total)
    const sum = lengths.reduce((a, b) => a + b, 0) || 1
    const sampled = lines.map((l, i) => {
        const pts = resample(l, Math.max(MIN_LINE_SAMPLES, Math.round(SAMPLES * lengths[i]! / sum)))
        // A segment whose middle is on a field is the road's crossing of it, which the floor already shows.
        const fielded = pts.map((a, k) => {
            const b = pts[(k + 1) % pts.length]!
            return onAnyField(fields, (a[0] + b[0]) / 2, (a[2] + b[2]) / 2, (a[1] + b[1]) / 2)
        })
        return { closed: l.closed, pts, fielded }
    })
    const outlines = fieldOutlines(fields).map(o => ({
        corners: o.corners.map(([x, z]): Point3 => [x, z, o.y]),
        rim: o.rim.map(([a, b]): [Point3, Point3] => [[a[0], a[1], o.y], [b[0], b[1], o.y]])
    }))
    const all = [...sampled.flatMap(l => l.pts), ...outlines.flatMap(o => o.corners)]
    const xs = all.map(p => p[0])
    const zs = all.map(p => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2
    const r = Math.max(...all.map(([x, z]) => Math.hypot(x - cx, z - cz))) || 1
    const norm = ([x, z, h]: Point3): Point3 => [(x - cx) / r, (z - cz) / r, h / r * HEIGHT_SCALE]
    return {
        lines: sampled.map(l => ({ ...l, pts: l.pts.map(norm) })),
        fields: outlines.map(o => ({ corners: o.corners.map(norm), rim: o.rim.map(([a, b]): [Point3, Point3] => [norm(a), norm(b)]) }))
    }
})

/** Where a point lands at turntable angle `angle`, before scaling to the canvas. */
function place(p: Readonly<Point3>, ca: number, sa: number) {
    const sin = Math.sin(TILT)
    const cos = Math.cos(TILT)
    const rx = p[0] * ca - p[1] * sa
    const rz = p[0] * sa + p[1] * ca
    const toward = rz * cos + p[2] * sin
    const f = CAMERA / (CAMERA - toward)
    return { x: rx * f, y: (rz * sin - p[2] * cos) * f, depth: rz }
}

/** The box the line sweeps over a whole turn, so it never clips or breathes as it spins. */
const bounds = computed(() => {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let k = 0; k < FIT_ANGLES; k++) {
        const a = k / FIT_ANGLES * Math.PI * 2
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        for (const p of [...shape.value.lines.flatMap(l => l.pts), ...shape.value.fields.flatMap(f => f.corners)]) {
            const q = place(p, ca, sa)
            minX = Math.min(minX, q.x)
            maxX = Math.max(maxX, q.x)
            minY = Math.min(minY, q.y)
            maxY = Math.max(maxY, q.y)
        }
    }
    // Centred on the turntable's axis, so the spin stays put.
    const halfX = Math.max(-minX, maxX)
    return { halfX, minY, maxY }
})

function draw(angle: number) {
    const el = canvas.value
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const w = el.width
    const h = el.height
    const dpr = w / Math.max(1, el.clientWidth)
    const pad = PAD_PX * dpr
    const b = bounds.value
    const scale = Math.min((w / 2 - pad) / b.halfX, (h - pad * 2) / (b.maxY - b.minY))
    const oy = h / 2 - scale * (b.minY + b.maxY) / 2
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    const project = (p: Point3) => {
        const q = place(p, ca, sa)
        return { x: w / 2 + q.x * scale, y: oy + q.y * scale, depth: q.depth }
    }
    // The far side fades, which is what makes a flat line read as turning in space.
    const fade = (a: { depth: number }, b: { depth: number }) => 0.6 + 0.4 * ((a.depth + b.depth) / 2 + 1) / 2
    const segment = (a: { x: number, y: number }, b: { x: number, y: number }) => {
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
    }
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = props.color
    ctx.fillStyle = props.color
    ctx.lineWidth = LINE_PX * dpr
    ctx.lineCap = 'round'
    for (const field of shape.value.fields) {
        const corners = field.corners.map(project)
        ctx.globalAlpha = FIELD_ALPHA
        ctx.beginPath()
        corners.forEach((c, i) => i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y))
        ctx.fill()
        for (const [p, q] of field.rim) {
            const a = project(p)
            const b = project(q)
            ctx.globalAlpha = fade(a, b)
            segment(a, b)
        }
    }
    for (const line of shape.value.lines) {
        const proj = line.pts.map(project)
        const n = line.closed ? proj.length : proj.length - 1
        for (let i = 0; i < n; i++) {
            if (line.fielded[i]) continue
            const a = proj[i]!
            const b = proj[(i + 1) % proj.length]!
            ctx.globalAlpha = fade(a, b)
            segment(a, b)
        }
    }
    ctx.globalAlpha = 1
}

function resize() {
    const el = canvas.value
    if (!el) return
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    el.width = Math.round(el.clientWidth * dpr)
    el.height = Math.round(el.clientHeight * dpr)
}

onMounted(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const fit = () => {
        resize()
        if (still) draw(STILL_ANGLE)
    }
    fit()
    observer = new ResizeObserver(fit)
    observer.observe(canvas.value!)
    if (still) {
        watch(() => props.color, () => draw(STILL_ANGLE))
        return
    }
    const loop = (now: number) => {
        draw(now / 1000 / TURN_SECONDS * Math.PI * 2)
        frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    observer?.disconnect()
})
</script>

<template>
  <canvas ref="canvas" aria-hidden="true" />
</template>
