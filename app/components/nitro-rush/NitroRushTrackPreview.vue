<script setup lang="ts">
/** A course's centreline as a single-colour line, turning slowly on a tilted turntable. */
const props = defineProps<{
    points: readonly [number, number][]
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

const canvas = ref<HTMLCanvasElement | null>(null)
let frame = 0
let observer: ResizeObserver | null = null

/** Evenly spaced points, centred and scaled into the unit circle. */
const shape = computed(() => {
    const pts = props.points
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
    const total = cum[cum.length - 1]! + (props.closed ? Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) : 0)
    const out: [number, number][] = []
    let j = 0
    for (let k = 0; k < SAMPLES; k++) {
        const s = total * k / (props.closed ? SAMPLES : SAMPLES - 1)
        while (j < pts.length - 1 && cum[j + 1]! < s) j++
        const a = pts[j]!
        const b = pts[(j + 1) % pts.length]!
        const span = (j + 1 < pts.length ? cum[j + 1]! : total) - cum[j]!
        const f = span > 0 ? Math.min(1, (s - cum[j]!) / span) : 0
        out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
    }
    const xs = out.map(p => p[0])
    const zs = out.map(p => p[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2
    const r = Math.max(...out.map(([x, z]) => Math.hypot(x - cx, z - cz))) || 1
    return out.map(([x, z]) => [(x - cx) / r, (z - cz) / r] as [number, number])
})

function draw(angle: number) {
    const el = canvas.value
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const w = el.width
    const h = el.height
    const dpr = w / Math.max(1, el.clientWidth)
    const sin = Math.sin(TILT)
    const cos = Math.cos(TILT)
    // Sized for the widest the unit circle can project at any angle, so the line never clips or breathes.
    const near = CAMERA / (CAMERA - cos)
    const far = CAMERA / (CAMERA + cos)
    const pad = PAD_PX * dpr
    const scale = Math.min((w / 2 - pad) / near, (h - pad * 2) / (sin * (near + far)))
    const oy = h / 2 - scale * sin * (near - far) / 2
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    const proj = shape.value.map(([x, z]) => {
        const rx = x * ca - z * sa
        const rz = x * sa + z * ca
        const f = CAMERA / (CAMERA - rz * cos)
        return { x: w / 2 + rx * f * scale, y: oy + rz * sin * f * scale, depth: rz }
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
