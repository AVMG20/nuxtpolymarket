<script setup lang="ts">
/** A course's centreline as a single-colour line, turning slowly on a tilted turntable. */
const props = defineProps<{
    points: readonly [number, number][]
    heights?: readonly number[]
    closed: boolean
    color: string
}>()

const SAMPLES = 160
const TILT = 0.95
/** Camera distance in track radii: enough perspective to read as 3D without warping the shape. */
const CAMERA = 3.2
const TURN_SECONDS = 16
const STILL_ANGLE = 0.6
const LINE_PX = 2
const PAD_PX = 4
/** Heights are tiny beside a course's length; stretched so a ramp or a spiral reads at card size. */
const HEIGHT_SCALE = 5
/** Turntable angles sampled to find the line's reach over a whole turn. */
const FIT_ANGLES = 48

const canvas = ref<HTMLCanvasElement | null>(null)
let frame = 0
let observer: ResizeObserver | null = null

/** Evenly spaced points, centred and scaled into the unit circle, with their heights on the same scale. */
const shape = computed(() => {
    const pts = props.points
    const hs = props.heights
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
    const total = cum[cum.length - 1]! + (props.closed ? Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) : 0)
    const out: [number, number, number][] = []
    let j = 0
    for (let k = 0; k < SAMPLES; k++) {
        const s = total * k / (props.closed ? SAMPLES : SAMPLES - 1)
        while (j < pts.length - 1 && cum[j + 1]! < s) j++
        const a = pts[j]!
        const b = pts[(j + 1) % pts.length]!
        const span = (j + 1 < pts.length ? cum[j + 1]! : total) - cum[j]!
        const f = span > 0 ? Math.min(1, (s - cum[j]!) / span) : 0
        const ha = hs?.[j] ?? 0
        const hb = hs?.[(j + 1) % pts.length] ?? 0
        out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, ha + (hb - ha) * f])
    }
    const xs = out.map(p => p[0])
    const zs = out.map(p => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2
    const r = Math.max(...out.map(([x, z]) => Math.hypot(x - cx, z - cz))) || 1
    return out.map(([x, z, h]) => [(x - cx) / r, (z - cz) / r, h / r * HEIGHT_SCALE] as [number, number, number])
})

/** Where a point lands at turntable angle `angle`, before scaling to the canvas. */
function place(p: readonly [number, number, number], ca: number, sa: number) {
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
        for (const p of shape.value) {
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
    const proj = shape.value.map((p) => {
        const q = place(p, ca, sa)
        return { x: w / 2 + q.x * scale, y: oy + q.y * scale, depth: q.depth }
    })
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = props.color
    ctx.lineWidth = LINE_PX * dpr
    ctx.lineCap = 'round'
    const n = props.closed ? proj.length : proj.length - 1
    for (let i = 0; i < n; i++) {
        const a = proj[i]!
        const b = proj[(i + 1) % proj.length]!
        // The far side fades, which is what makes a flat line read as turning in space.
        ctx.globalAlpha = 0.6 + 0.4 * ((a.depth + b.depth) / 2 + 1) / 2
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
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
