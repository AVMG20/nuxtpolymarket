<script setup lang="ts">
import { cssColor, LINE_COLORS } from '~/utils/nitro-rush/config'
import type { LayoutWalk } from '#shared/utils/nitro-rush/layout'

/** The track builder's top-down map: the course as laid so far, where the next section attaches and where a loop has to close. */
const props = defineProps<{
    walk: LayoutWalk
    closed: boolean
    halfWidth: number
    selected: number | null
}>()
const emit = defineEmits<{ pick: [index: number] }>()

const PAD_PX = 14
const MIN_ROAD_PX = 3
const OUTLINE_PX = 2
/** The smallest span the map zooms to, so a course of one or two sections isn't blown up to fill the card. */
const MIN_SPAN = 120
/** Heights are drawn in bands this tall: a bridge clears the road below by more than two, so it always draws over it. */
const LAYER = 3
/** Where the road colour reaches gold. */
const TOP = 24
const GROUND = [61, 242, 255] as const
const HIGH = [255, 210, 61] as const
const PINK = '#ff2bd6'
const OUTLINE = 'rgba(4, 6, 18, 0.92)'
/** Grid steps in metres, the finest whose cells are at least this many CSS px wide. */
const GRID_STEPS = [10, 50, 250, 1000]
const GRID_MIN_PX = 14

interface Segment {
    a: readonly [number, number]
    b: readonly [number, number]
    y: number
    piece: number
    layer: number
}

const canvas = ref<HTMLCanvasElement | null>(null)
let observer: ResizeObserver | null = null
/** The last draw's world-to-canvas transform, in backing-store pixels, for clicks. */
let view = { scale: 1, ox: 0, oy: 0, dpr: 1 }

/** The centreline as segments, the last one running on to where the course ends. */
const segments = computed(() => {
    const { pts, ys, pieceStarts, end } = props.walk
    const out: Segment[] = []
    let piece = 0
    for (let i = 0; i < pts.length; i++) {
        while (piece + 1 < pieceStarts.length && pieceStarts[piece + 1]! <= i) piece++
        const last = i === pts.length - 1
        const b: [number, number] = last ? [end.x, end.z] : pts[i + 1]!
        const y = (ys[i]! + (last ? end.y : ys[i + 1]!)) / 2
        out.push({ a: pts[i]!, b, y, piece, layer: Math.round(y / LAYER) })
    }
    return out
})

function roadColor(y: number) {
    const t = Math.min(1, Math.max(0, y / TOP))
    const c = GROUND.map((g, i) => Math.round(g + (HIGH[i]! - g) * t))
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/** A chevron at (x, y) in canvas pixels pointing along heading `h`. */
function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, size: number) {
    const fx = Math.sin(h)
    const fy = -Math.cos(h)
    const at = (f: number, r: number) => [x + fx * f * size - fy * r * size, y + fy * f * size + fx * r * size] as const
    ctx.beginPath()
    ctx.moveTo(...at(1, 0))
    ctx.lineTo(...at(-0.7, 0.8))
    ctx.lineTo(...at(-0.3, 0))
    ctx.lineTo(...at(-0.7, -0.8))
    ctx.closePath()
}

function draw() {
    const el = canvas.value
    const ctx = el?.getContext('2d')
    if (!el || !ctx || !el.width || !el.height) return
    const w = el.width
    const h = el.height
    const dpr = w / Math.max(1, el.clientWidth)
    const { pts, end, lines } = props.walk
    const hw = props.halfWidth

    // Fit the course, the origin and the end, keeping the aspect ratio.
    let minX = Math.min(0, end.x)
    let maxX = Math.max(0, end.x)
    let minZ = Math.min(0, end.z)
    let maxZ = Math.max(0, end.z)
    for (const [x, z] of pts) {
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
    }
    const pad = PAD_PX * dpr
    const spanX = Math.max(MIN_SPAN, maxX - minX + hw * 2)
    const spanZ = Math.max(MIN_SPAN, maxZ - minZ + hw * 2)
    const scale = Math.max(1e-6, Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ))
    const ox = w / 2 - scale * (minX + maxX) / 2
    const oy = h / 2 - scale * (minZ + maxZ) / 2
    view = { scale, ox, oy, dpr }
    const sx = (x: number) => ox + x * scale
    const sy = (z: number) => oy + z * scale

    ctx.clearRect(0, 0, w, h)

    // A faint grid, as fine as the zoom allows.
    const step = GRID_STEPS.find(s => s * scale >= GRID_MIN_PX * dpr) ?? GRID_STEPS[GRID_STEPS.length - 1]!
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
    ctx.lineWidth = dpr
    ctx.beginPath()
    for (let x = Math.ceil(-ox / scale / step) * step; sx(x) <= w; x += step) {
        const px = Math.round(sx(x)) + 0.5
        ctx.moveTo(px, 0)
        ctx.lineTo(px, h)
    }
    for (let z = Math.ceil(-oy / scale / step) * step; sy(z) <= h; z += step) {
        const py = Math.round(sy(z)) + 0.5
        ctx.moveTo(0, py)
        ctx.lineTo(w, py)
    }
    ctx.stroke()

    // Road, lowest band first, each with a dark outline beneath so a bridge reads as crossing.
    const road = Math.max(MIN_ROAD_PX * dpr, hw * 2 * scale)
    const segs = segments.value
    const layers = [...new Set(segs.map(s => s.layer))].sort((a, b) => a - b)
    ctx.lineJoin = 'round'
    for (const layer of layers) {
        // Butt caps, so a band's outline doesn't nick the road where it joins the band below.
        ctx.strokeStyle = OUTLINE
        ctx.lineWidth = road + OUTLINE_PX * 2 * dpr
        ctx.lineCap = 'butt'
        ctx.beginPath()
        let prev: Segment | null = null
        for (const s of segs) {
            if (s.layer !== layer) {
                prev = null
                continue
            }
            if (!prev) ctx.moveTo(sx(s.a[0]), sy(s.a[1]))
            ctx.lineTo(sx(s.b[0]), sy(s.b[1]))
            prev = s
        }
        ctx.stroke()

        ctx.lineWidth = road
        ctx.lineCap = 'round'
        for (const s of segs) {
            if (s.layer !== layer) continue
            ctx.strokeStyle = s.piece === props.selected ? PINK : roadColor(s.y)
            ctx.beginPath()
            ctx.moveTo(sx(s.a[0]), sy(s.a[1]))
            ctx.lineTo(sx(s.b[0]), sy(s.b[1]))
            ctx.stroke()
        }

        // Line blocks: a bar across the road where each line crosses.
        ctx.lineCap = 'butt'
        ctx.lineWidth = Math.max(2 * dpr, 2 * scale)
        for (const line of lines) {
            const s = segs[Math.min(line.at, segs.length - 1)]
            if (!s || s.layer !== layer) continue
            const [px, pz] = line.at < pts.length ? pts[line.at]! : [end.x, end.z]
            const dx = s.b[0] - s.a[0]
            const dz = s.b[1] - s.a[1]
            const len = Math.hypot(dx, dz) || 1
            const reach = road / 2 + dpr
            const nx = -dz / len * reach
            const ny = dx / len * reach
            ctx.strokeStyle = cssColor(LINE_COLORS[line.type])
            ctx.beginPath()
            ctx.moveTo(sx(px) - nx, sy(pz) - ny)
            ctx.lineTo(sx(px) + nx, sy(pz) + ny)
            ctx.stroke()
        }
    }

    const marker = Math.max(9 * dpr, hw * 1.4 * scale)
    // Loops: the ghost of where the road has to come back to.
    if (props.closed) {
        chevron(ctx, sx(0), sy(0), 0, marker)
        ctx.setLineDash([3 * dpr, 3 * dpr])
        ctx.lineWidth = 1.5 * dpr
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'
        ctx.stroke()
        ctx.setLineDash([])
    }
    // Where the next section attaches.
    chevron(ctx, sx(end.x), sy(end.z), end.heading, marker)
    ctx.fillStyle = PINK
    ctx.fill()
    ctx.lineWidth = dpr
    ctx.strokeStyle = OUTLINE
    ctx.stroke()
}

function resize() {
    const el = canvas.value
    if (!el) return
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    el.width = Math.round(el.clientWidth * dpr)
    el.height = Math.round(el.clientHeight * dpr)
    draw()
}

/** Distance from p to the segment ab, in metres. */
function distance(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]) {
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const len2 = dx * dx + dz * dz
    const t = len2 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2)) : 0
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t)
}

/** On the road, the topmost piece wins (it's the one drawn there); off it, the nearest within reach. */
function onClick(e: MouseEvent) {
    const { scale, ox, oy, dpr } = view
    const p = [(e.offsetX * dpr - ox) / scale, (e.offsetY * dpr - oy) / scale] as const
    const reach = Math.max(props.halfWidth * 2, (MIN_ROAD_PX + 6) * dpr / scale)
    let best: Segment | null = null
    let bestD = Infinity
    for (const s of segments.value) {
        const d = distance(p, s.a, s.b)
        if (d > reach) continue
        const onRoad = d <= props.halfWidth
        const bestOnRoad = bestD <= props.halfWidth
        if (onRoad && bestOnRoad ? s.layer > best!.layer || (s.layer === best!.layer && d < bestD) : d < bestD) {
            best = s
            bestD = d
        }
    }
    if (best) emit('pick', best.piece)
}

watch(() => [props.walk, props.closed, props.halfWidth, props.selected], draw)

onMounted(() => {
    resize()
    observer = new ResizeObserver(resize)
    observer.observe(canvas.value!)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <canvas ref="canvas" class="block h-full w-full cursor-pointer" @click="onClick" />
</template>
