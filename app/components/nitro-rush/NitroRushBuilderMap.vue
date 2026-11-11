<script setup lang="ts">
import { cssColor, LINE_COLORS } from '~/utils/nitro-rush/config'
import { inletStub, type JoinInlet } from '#shared/utils/nitro-rush/custom-forks'
import type { LayoutWalk } from '#shared/utils/nitro-rush/layout'
import { STEP } from '#shared/utils/nitro-rush/road-checks'
import { BOOST_LANES, type BoostLane } from '#shared/utils/nitro-rush/track'

/** The track builder's top-down map: every line laid so far, where the next section attaches, where a loop has to close and where branches fork and join. */
const props = defineProps<{
    /** The main road first, then each branch. */
    lines: readonly LayoutWalk[]
    /** The line being built on. */
    line: number
    closed: boolean
    /** The highlighted section, on the line being built on. */
    selected: number | null
    /** Lines whose end already meets the road they join, which need no marker for where to go on. */
    ended: readonly boolean[]
    /** Every join section, with where a road comes into it. */
    joins: readonly JoinInlet[]
    /** The piece about to be built. */
    ghost: LayoutWalk | null
    ghostBlocked: boolean
}>()
const emit = defineEmits<{ pick: [index: number, line: number] }>()

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
const BOOST = '#2bff5a'
const GHOST = 'rgba(61, 242, 255, 0.5)'
const GHOST_BLOCKED = 'rgba(255, 59, 82, 0.6)'
const SELECTED_FILL = 'rgba(255, 43, 214, 0.3)'
const OUTLINE = 'rgba(4, 6, 18, 0.92)'
const OTHER_END = 'rgba(255, 255, 255, 0.85)'
/** Grid steps in metres, the finest whose cells are at least this many CSS px wide. */
const GRID_STEPS = [10, 50, 250, 1000]
const GRID_MIN_PX = 14

interface Segment {
    a: readonly [number, number]
    b: readonly [number, number]
    y: number
    /** Half the road's width along the segment. */
    hw: number
    piece: number
    line: number
    layer: number
    /** Over a jump's empty road, which has no deck to draw. */
    empty: boolean
}

const canvas = ref<HTMLCanvasElement | null>(null)
let observer: ResizeObserver | null = null
/** The last draw's world-to-canvas transform, in backing-store pixels, for clicks. */
let view = { scale: 1, ox: 0, oy: 0, dpr: 1 }

/** Each line's centreline as segments, the last one running on to where the line ends. */
const segments = computed(() => props.lines.map(({ pts, ys, halfWidths, pieceStarts, gaps, end }, line) => {
    const out: Segment[] = []
    let piece = 0
    for (let i = 0; i < pts.length; i++) {
        while (piece + 1 < pieceStarts.length && pieceStarts[piece + 1]! <= i) piece++
        const last = i === pts.length - 1
        const b: [number, number] = last ? [end.x, end.z] : pts[i + 1]!
        const y = (ys[i]! + (last ? end.y : ys[i + 1]!)) / 2
        const hw = (halfWidths[i]! + (last ? end.halfWidth : halfWidths[i + 1]!)) / 2
        const empty = gaps.some(([from, to]) => i >= from && i < to)
        out.push({ a: pts[i]!, b, y, hw, piece, line, layer: Math.round(y / LAYER), empty })
    }
    return out
}))

/** The way into each join no branch has come into yet, which a branch has to get onto. */
const inlets = computed(() => props.joins.filter(j => j.branch === null || !props.ended[j.branch]).map(j => ({ path: inletStub(j), j })))

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
    const walks = props.lines
    const hw = Math.max(...walks.flatMap(w => [w.end.halfWidth, ...w.halfWidths]))
    const ghost = props.ghost
    const ghostPath: readonly (readonly [number, number])[] = ghost ? [...ghost.pts, [ghost.end.x, ghost.end.z]] : []

    // Fit the course, the origin and every end, keeping the aspect ratio.
    let minX = 0
    let maxX = 0
    let minZ = 0
    let maxZ = 0
    for (const [x, z] of [...walks.flatMap(w => [...w.pts, [w.end.x, w.end.z] as const]), ...ghostPath, ...inlets.value.flatMap(i => i.path)]) {
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
    const roadPx = (half: number) => Math.max(MIN_ROAD_PX * dpr, half * 2 * scale)
    // Empty road has no deck: a dashed outline round where it would be, as the 3D view draws it.
    const emptyOutline = (path: readonly (readonly [number, number])[], halves: readonly number[], colour: string, fill: string | null) => {
        const edge = (side: number) => path.map(([x, z], k) => {
            const [ax, az] = path[Math.max(0, k - 1)]!
            const [bx, bz] = path[Math.min(path.length - 1, k + 1)]!
            const len = Math.hypot(bx - ax, bz - az) || 1
            const half = roadPx(halves[k]!) / 2 / scale * side
            return [sx(x - (bz - az) / len * half), sy(z + (bx - ax) / len * half)] as const
        })
        ctx.beginPath()
        for (const [px, py] of [...edge(-1), ...edge(1).reverse()]) ctx.lineTo(px, py)
        ctx.closePath()
        if (fill) {
            ctx.fillStyle = fill
            ctx.fill()
        }
        ctx.setLineDash([4 * dpr, 3 * dpr])
        ctx.lineWidth = 1.5 * dpr
        ctx.strokeStyle = colour
        ctx.stroke()
        ctx.setLineDash([])
    }
    const lineSegs = segments.value
    const layers = [...new Set(lineSegs.flat().map(s => s.layer))].sort((a, b) => a - b)
    const picked = (s: Segment) => s.line === props.line && s.piece === props.selected
    ctx.lineJoin = 'round'
    for (const layer of layers) {
        // Butt caps, so a band's outline doesn't nick the road where it joins the band below.
        ctx.strokeStyle = OUTLINE
        ctx.lineCap = 'butt'
        for (const segs of lineSegs) {
            // One path per run of the same width, so the outline only breaks where the width changes.
            let prev: Segment | null = null
            for (const s of segs) {
                const joins = prev && s.layer === layer && s.hw === prev.hw && !s.empty
                if (prev && !joins) ctx.stroke()
                if (s.layer !== layer || s.empty) {
                    prev = null
                    continue
                }
                if (!joins) {
                    ctx.lineWidth = roadPx(s.hw) + OUTLINE_PX * 2 * dpr
                    ctx.beginPath()
                    ctx.moveTo(sx(s.a[0]), sy(s.a[1]))
                }
                ctx.lineTo(sx(s.b[0]), sy(s.b[1]))
                prev = s
            }
            if (prev) ctx.stroke()
        }

        ctx.lineCap = 'round'
        for (const s of lineSegs.flat()) {
            if (s.layer !== layer || s.empty) continue
            ctx.lineWidth = roadPx(s.hw)
            ctx.strokeStyle = picked(s) ? PINK : roadColor(s.y)
            ctx.beginPath()
            ctx.moveTo(sx(s.a[0]), sy(s.a[1]))
            ctx.lineTo(sx(s.b[0]), sy(s.b[1]))
            ctx.stroke()
        }
        // Each piece's run of empty road in this band.
        for (const segs of lineSegs) {
            for (let i = 0; i < segs.length; i++) {
                const s = segs[i]!
                if (s.layer !== layer || !s.empty) continue
                const run = [s]
                while (i + 1 < segs.length && segs[i + 1]!.empty && segs[i + 1]!.layer === layer && segs[i + 1]!.piece === s.piece) run.push(segs[++i]!)
                const on = picked(s)
                emptyOutline([...run.map(r => r.a), run[run.length - 1]!.b], [...run.map(r => r.hw), run[run.length - 1]!.hw], on ? PINK : roadColor(s.y), on ? SELECTED_FILL : null)
            }
        }

        walks.forEach(({ pts, end, lines, boosts }, l) => {
            const segs = lineSegs[l]!
            // A bar across the road at point `at`, over `lane` of its width.
            const crossBar = (at: number, color: string, lane: BoostLane = 'full') => {
                const s = segs[Math.min(at, segs.length - 1)]
                if (!s || s.layer !== layer) return
                const [px, pz] = at < pts.length ? pts[at]! : [end.x, end.z]
                const dx = s.b[0] - s.a[0]
                const dz = s.b[1] - s.a[1]
                const len = Math.hypot(dx, dz) || 1
                const reach = roadPx(s.hw) / 2 + dpr
                const nx = -dz / len * reach
                const ny = dx / len * reach
                ctx.strokeStyle = color
                ctx.beginPath()
                const [a, b] = BOOST_LANES[lane]
                ctx.moveTo(sx(px) + nx * a, sy(pz) + ny * a)
                ctx.lineTo(sx(px) + nx * b, sy(pz) + ny * b)
                ctx.stroke()
            }
            ctx.lineCap = 'butt'
            // Boost pads as thick as they're long, and no thinner than a line block.
            for (const { range: [from, to], lane } of boosts) {
                ctx.lineWidth = Math.max(3 * dpr, (to - from) * STEP * scale)
                crossBar(Math.floor((from + to) / 2), BOOST, lane)
            }
            // Line blocks: where each line crosses.
            ctx.lineWidth = Math.max(2 * dpr, 2 * scale)
            for (const line of lines) crossBar(line.at, cssColor(LINE_COLORS[line.type]))
        })
    }

    const active = walks[props.line]!.end
    const marker = Math.max(9 * dpr, active.halfWidth * 1.4 * scale)
    // Loops: the ghost of where the road has to come back to.
    if (props.closed) {
        chevron(ctx, sx(0), sy(0), 0, marker)
        ctx.setLineDash([3 * dpr, 3 * dpr])
        ctx.lineWidth = 1.5 * dpr
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'
        ctx.stroke()
        ctx.setLineDash([])
    }
    // Where each branch forks off.
    walks.forEach((w, l) => {
        if (!l) return
        const [x, z] = w.pts[0] ?? [w.end.x, w.end.z]
        ctx.beginPath()
        ctx.arc(sx(x), sy(z), Math.max(3 * dpr, marker * 0.35), 0, Math.PI * 2)
        ctx.fillStyle = l === props.line ? PINK : OTHER_END
        ctx.fill()
        ctx.lineWidth = dpr
        ctx.strokeStyle = OUTLINE
        ctx.stroke()
    })
    // Where the next section attaches on each line still going somewhere; the line being built on stands out.
    walks.forEach(({ end }, l) => {
        if (props.ended[l] && l !== props.line) return
        chevron(ctx, sx(end.x), sy(end.z), end.heading, l === props.line ? marker : marker * 0.7)
        ctx.fillStyle = l === props.line ? PINK : OTHER_END
        ctx.fill()
        ctx.lineWidth = dpr
        ctx.strokeStyle = OUTLINE
        ctx.stroke()
    })
    // Each join's inlet as empty road for a branch to reach, the one the branch being built on heads for in pink.
    for (const { path, j } of inlets.value) {
        const mine = !!props.line && j.branch === props.line
        emptyOutline(path, path.map(() => j.halfWidth), mine ? PINK : OTHER_END, null)
        const [x, z] = path[0]!
        chevron(ctx, sx(x), sy(z), j.heading, marker * 0.7)
        ctx.fillStyle = mine ? PINK : OTHER_END
        ctx.fill()
    }

    if (ghost) {
        const colour = props.ghostBlocked ? GHOST_BLOCKED : GHOST
        ctx.strokeStyle = colour
        ctx.lineCap = 'butt'
        const ghostWidths = [...ghost.halfWidths, ghost.end.halfWidth]
        for (let i = 1; i < ghostPath.length; i++) {
            if (ghost.gaps.some(([from, to]) => i - 1 >= from && i - 1 < to)) continue
            ctx.lineWidth = roadPx((ghostWidths[i - 1]! + ghostWidths[i]!) / 2)
            ctx.beginPath()
            ctx.moveTo(sx(ghostPath[i - 1]![0]), sy(ghostPath[i - 1]![1]))
            ctx.lineTo(sx(ghostPath[i]![0]), sy(ghostPath[i]![1]))
            ctx.stroke()
        }
        for (const [from, to] of ghost.gaps) emptyOutline(ghostPath.slice(from, to + 1), ghostWidths.slice(from, to + 1), colour, null)
        chevron(ctx, sx(ghost.end.x), sy(ghost.end.z), ghost.end.heading, marker)
        ctx.fillStyle = colour
        ctx.fill()
    }
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

/** On the road the topmost piece wins (it's the one drawn there), and off it the nearest within reach. */
function onClick(e: MouseEvent) {
    const { scale, ox, oy, dpr } = view
    const p = [(e.offsetX * dpr - ox) / scale, (e.offsetY * dpr - oy) / scale] as const
    const near = (MIN_ROAD_PX + 6) * dpr / scale
    let best: Segment | null = null
    let bestD = Infinity
    for (const s of segments.value.flat()) {
        const d = distance(p, s.a, s.b)
        if (d > Math.max(s.hw * 2, near)) continue
        const onRoad = d <= s.hw
        const bestOnRoad = !!best && bestD <= best.hw
        if (onRoad && bestOnRoad ? s.layer > best!.layer || (s.layer === best!.layer && d < bestD) : d < bestD) {
            best = s
            bestD = d
        }
    }
    if (best) emit('pick', best.piece, best.line)
}

watch(() => [props.lines, props.line, props.closed, props.selected, props.ended, props.joins, props.ghost, props.ghostBlocked], draw)

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
