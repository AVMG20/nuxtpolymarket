<script setup lang="ts">
import { cssColor, LINE_COLORS } from '~/utils/nitro-rush/config'
import { inletStub, type JoinInlet } from '#shared/utils/nitro-rush/custom-forks'
import { obstacleMarks, type ObstacleMark } from '#shared/utils/nitro-rush/custom-obstacles'
import { OBSTACLE_KINDS, type Obstacle } from '#shared/utils/nitro-rush/obstacles'
import { GRID, type LayoutWalk } from '#shared/utils/nitro-rush/layout'
import { STEP } from '#shared/utils/nitro-rush/road-checks'
import { BOOST_LANES, type BoostLane } from '#shared/utils/nitro-rush/track'
import type { BuilderHandle } from '~/utils/nitro-rush/builder-preview'

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
    /** Road not joined up yet, drawn as lines after the course's. */
    loose: readonly LayoutWalk[]
    /** The highlighted section of loose road, which stands in for `selected`. */
    looseSelected: { k: number, index: number } | null
    /** The piece about to be built. */
    ghost: LayoutWalk | null
    ghostBlocked: boolean
    /** The course's obstacles, each loose stretch's, and one about to go down. */
    obstacles: readonly Obstacle[]
    looseObstacles: readonly (readonly Obstacle[])[]
    obstacleGhost: { obstacle: Obstacle, blocked: boolean } | null
    /** The course's obstacle picked out, by its index. */
    obstacleSelected: number | null
    /** Placing obstacles: a press lays one and holding it down keeps laying them. */
    paint: boolean
    /** Buttons stood on the map, such as the ends loose road connects from. */
    handles: readonly BuilderHandle[]
}>()
type Picked = { index: number, line: number }
const emit = defineEmits<{
    hover: [at: { x: number, z: number, onRoad: boolean } | null]
    tap: [picked: Picked | null]
    remove: [picked: Picked]
    dragging: [drag: { k: number, dx: number, dz: number } | null]
    move: [k: number, dx: number, dz: number]
    /** A press held down while painting, each move while it's held, and letting go. */
    press: []
    stroke: []
    release: []
    handle: [key: string]
}>()

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
/** Bumped on every draw, so the handles follow the map's zoom. */
const viewTick = ref(0)

/** The course's lines, then the loose road. */
const allWalks = computed(() => [...props.lines, ...props.loose])

/** Each line's centreline as segments, the last one running on to where the line ends. */
const segments = computed(() => allWalks.value.map(({ pts, ys, halfWidths, pieceStarts, gaps, end }, line) => {
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
    const walks = allWalks.value
    const hw = Math.max(...walks.flatMap(w => [w.end.halfWidth, ...w.halfWidths]))
    const ghost = props.ghost
    const ghostPath: readonly (readonly [number, number])[] = ghost ? [...ghost.pts, [ghost.end.x, ghost.end.z]] : []

    // Fit the course, the origin and every end, keeping the aspect ratio.
    let minX = 0
    let maxX = 0
    let minZ = 0
    let maxZ = 0
    // Not the ghost: one following the pointer would rescale the map under it.
    for (const [x, z] of [...walks.flatMap(w => [...w.pts, [w.end.x, w.end.z] as const]), ...inlets.value.flatMap(i => i.path)]) {
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
    viewTick.value++
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
    const looseSel = props.looseSelected
    const picked = (s: Segment) => looseSel ? s.line === props.lines.length + looseSel.k && s.piece === looseSel.index : s.line === props.line && s.piece === props.selected
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

    // Obstacles, by what they do: grey to dodge, orange to smash, purple to slide on.
    const markColor = (m: ObstacleMark) => m.solid ? 'rgba(230, 232, 240, 0.95)' : OBSTACLE_KINDS[m.kind].mechanic === 'slick' ? 'rgba(160, 90, 255, 0.85)' : 'rgba(255, 150, 40, 0.95)'
    const drawMark = (m: ObstacleMark, fill: string) => {
        const along = Math.max(1.5 * dpr, m.halfAlong * scale)
        const across = Math.max(1.5 * dpr, m.halfAcross * scale)
        const [ax, ay] = [m.dx, m.dz]
        const [cx, cy] = [-m.dz, m.dx]
        const x = sx(m.x)
        const y = sy(m.z)
        ctx.beginPath()
        ctx.moveTo(x + ax * along + cx * across, y + ay * along + cy * across)
        ctx.lineTo(x + ax * along - cx * across, y + ay * along - cy * across)
        ctx.lineTo(x - ax * along - cx * across, y - ay * along - cy * across)
        ctx.lineTo(x - ax * along + cx * across, y - ay * along + cy * across)
        ctx.closePath()
        ctx.fillStyle = fill
        ctx.fill()
    }
    for (const m of obstacleMarks(props.lines, props.obstacles)) drawMark(m, markColor(m))
    props.loose.forEach((w, k) => {
        for (const m of obstacleMarks([w], props.looseObstacles[k] ?? [])) drawMark(m, markColor(m))
    })
    if (props.obstacleGhost) {
        for (const m of obstacleMarks(props.lines, [props.obstacleGhost.obstacle])) drawMark(m, props.obstacleGhost.blocked ? GHOST_BLOCKED : GHOST)
    }
    const chosen = props.obstacleSelected === null ? null : obstacleMarks(props.lines, props.obstacles).find(m => m.index === props.obstacleSelected)
    if (chosen) {
        ctx.beginPath()
        ctx.arc(sx(chosen.x), sy(chosen.z), Math.max(6 * dpr, (Math.max(chosen.halfAlong, chosen.halfAcross) + 1.5) * scale), 0, Math.PI * 2)
        ctx.strokeStyle = PINK
        ctx.lineWidth = 2 * dpr
        ctx.stroke()
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
    props.lines.forEach((w, l) => {
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
    // Where loose road starts and ends: it joins on where a line's end lands on its start.
    for (const w of props.loose) {
        const [x, z] = w.pts[0] ?? [w.end.x, w.end.z]
        ctx.beginPath()
        ctx.arc(sx(x), sy(z), Math.max(3 * dpr, marker * 0.3), 0, Math.PI * 2)
        ctx.strokeStyle = OTHER_END
        ctx.lineWidth = 1.5 * dpr
        ctx.stroke()
        chevron(ctx, sx(w.end.x), sy(w.end.z), w.end.heading, marker * 0.7)
        ctx.fillStyle = OTHER_END
        ctx.fill()
    }
    // Where the next section attaches on each line still going somewhere; the line being built on stands out.
    props.lines.forEach(({ end }, l) => {
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

/** A spot on the canvas in metres. */
function groundAt(e: MouseEvent) {
    const { scale, ox, oy, dpr } = view
    return [(e.offsetX * dpr - ox) / scale, (e.offsetY * dpr - oy) / scale] as const
}

/** On the road the topmost piece wins (it's the one drawn there), and off it the nearest within `slack` of it. */
function segmentAt(p: readonly [number, number], slack: boolean) {
    const { scale, dpr } = view
    const near = slack ? (MIN_ROAD_PX + 6) * dpr / scale : 0
    let best: Segment | null = null
    let bestD = Infinity
    for (const s of segments.value.flat()) {
        const d = distance(p, s.a, s.b)
        if (d > (slack ? Math.max(s.hw * 2, near) : Math.max(s.hw, MIN_ROAD_PX * dpr / scale / 2))) continue
        const onRoad = d <= s.hw
        const bestOnRoad = !!best && bestD <= best.hw
        if (onRoad && bestOnRoad ? s.layer > best!.layer || (s.layer === best!.layer && d < bestD) : d < bestD) {
            best = s
            bestD = d
        }
    }
    return best && { index: best.piece, line: best.line }
}

const TAP_SLOP_PX = 6
let pressed: { x: number, y: number, button: number } | null = null
let held: { k: number, x: number, z: number, moved: boolean } | null = null
let painting = false
const snapped = (v: number) => Math.round(v / GRID) * GRID

function onPointerDown(e: PointerEvent) {
    pressed = e.isPrimary ? { x: e.clientX, y: e.clientY, button: e.button } : null
    held = null
    if (!pressed || e.button !== 0) return
    const p = groundAt(e)
    if (props.paint) {
        painting = true
        emit('hover', { x: p[0], z: p[1], onRoad: !!segmentAt(p, false) })
        emit('press')
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        return
    }
    const picked = segmentAt(p, false)
    const k = picked ? picked.line - props.lines.length : -1
    if (k < 0) return
    held = { k, x: p[0], z: p[1], moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
    const p = groundAt(e)
    if (held) {
        const dx = snapped(p[0] - held.x)
        const dz = snapped(p[1] - held.z)
        held.moved ||= dx !== 0 || dz !== 0
        if (held.moved) emit('dragging', { k: held.k, dx, dz })
        return
    }
    emit('hover', { x: p[0], z: p[1], onRoad: !!segmentAt(p, false) })
    if (painting) emit('stroke')
}

function onPointerUp(e: PointerEvent) {
    const press = pressed
    pressed = null
    const p = groundAt(e)
    if (painting) {
        painting = false
        emit('release')
        return
    }
    if (held) {
        const h = held
        held = null
        emit('dragging', null)
        if (h.moved) {
            emit('move', h.k, snapped(p[0] - h.x), snapped(p[1] - h.z))
            return
        }
    }
    if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP_PX) return
    const picked = segmentAt(p, true)
    if (press.button === 2) {
        if (picked) emit('remove', picked)
    } else if (press.button === 0) {
        const on = segmentAt(p, false)
        // A touch has no hover before it, so the spot it builds on is read now.
        emit('hover', { x: p[0], z: p[1], onRoad: !!on })
        emit('tap', on ?? picked)
    }
}

function onPointerLeave() {
    if (!held && !painting) emit('hover', null)
}

/** Each handle where it stands on the canvas, in CSS px. */
const placedHandles = computed(() => {
    void viewTick.value
    const { scale, ox, oy, dpr } = view
    return props.handles.map(h => ({ ...h, left: (ox + h.x * scale) / dpr, top: (oy + h.z * scale) / dpr }))
})

watch(() => [props.lines, props.loose, props.looseSelected, props.obstacles, props.looseObstacles, props.obstacleGhost, props.obstacleSelected, props.line, props.closed, props.selected, props.ended, props.joins, props.ghost, props.ghostBlocked], draw)

onMounted(() => {
    resize()
    observer = new ResizeObserver(resize)
    observer.observe(canvas.value!)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div>
    <canvas
      ref="canvas"
      class="block h-full w-full cursor-crosshair touch-none"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
      @contextmenu.prevent
    />
    <button
      v-for="h in placedHandles"
      :key="h.key"
      class="nr-handle"
      :style="{ left: `${h.left}px`, top: `${h.top}px` }"
      :aria-label="h.label"
      :title="h.label"
      @click="emit('handle', h.key)"
    >
      <UIcon :name="h.icon" class="size-3.5" />
    </button>
  </div>
</template>
