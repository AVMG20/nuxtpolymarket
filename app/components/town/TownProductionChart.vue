<script setup lang="ts">
interface ChartBucket { at: number, totals: Record<string, number> }

const props = defineProps<{
    /** Oldest first; one bucket per hour. The last bucket is the current, partial hour. */
    buckets: ChartBucket[]
    /** Resource ids to draw, in list order. */
    series: string[]
    colors: Record<string, string>
    names: Record<string, string>
    hours: number
}>()

// Fixed viewBox — the svg scales with the pane, so no resize observer and no per-frame work.
const W = 800
const H = 250
const PAD_L = 54
const PAD_R = 14
const PAD_T = 12
const PAD_B = 24
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B

/** Round a max up to a 1 / 2 / 2.5 / 5 × 10ⁿ step so gridline labels stay readable. */
function niceMax(v: number) {
    if (!(v > 0)) return 1
    const base = 10 ** Math.floor(Math.log10(v))
    const n = v / base
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
    return step * base
}

const count = computed(() => props.buckets.length)

const maxValue = computed(() => {
    let m = 0
    for (const b of props.buckets) {
        for (const id of props.series) {
            const v = b.totals[id] ?? 0
            if (v > m) m = v
        }
    }
    return niceMax(m)
})

function xAt(i: number) {
    const n = count.value
    if (n <= 1) return PAD_L + PLOT_W / 2
    return PAD_L + (i / (n - 1)) * PLOT_W
}

function yAt(v: number) {
    return PAD_T + PLOT_H - (v / maxValue.value) * PLOT_H
}

/** Catmull-Rom → cubic bézier, with the control points clamped inside the plot box. */
function smoothPath(pts: { x: number, y: number }[]) {
    const first = pts[0]
    if (!first) return ''
    if (pts.length === 1) return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`
    const top = PAD_T
    const bottom = PAD_T + PLOT_H
    const clamp = (y: number) => Math.max(top, Math.min(bottom, y))
    let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i]!
        const p2 = pts[i + 1]!
        const p0 = pts[i - 1] ?? p1
        const p3 = pts[i + 2] ?? p2
        const c1x = p1.x + (p2.x - p0.x) / 6 * 0.75
        const c1y = clamp(p1.y + (p2.y - p0.y) / 6 * 0.75)
        const c2x = p2.x - (p3.x - p1.x) / 6 * 0.75
        const c2y = clamp(p2.y - (p3.y - p1.y) / 6 * 0.75)
        d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    }
    return d
}

const lines = computed(() => props.series.map(id => ({
    id,
    color: props.colors[id] ?? 'var(--g-muted)',
    d: smoothPath(props.buckets.map((b, i) => ({ x: xAt(i), y: yAt(b.totals[id] ?? 0) })))
})))

const gridLines = computed(() => {
    const m = maxValue.value
    return [0, 0.25, 0.5, 0.75, 1].map(f => ({ f, y: yAt(m * f), label: formatNumber(m * f) }))
})

const labelStep = computed(() => (props.hours <= 24 ? 6 : props.hours <= 72 ? 12 : 24))

function agoLabel(ago: number) {
    if (ago === 0) return 'now'
    return ago >= 48 ? `-${Math.round(ago / 24)}d` : `-${ago}h`
}

const xLabels = computed(() => {
    const n = count.value
    const step = labelStep.value
    const out: { x: number, label: string }[] = []
    for (let i = n - 1; i >= 0; i -= step) out.push({ x: xAt(i), label: agoLabel(n - 1 - i) })
    return out.reverse()
})

// ── Hover ──
const svgEl = ref<SVGSVGElement | null>(null)
const hoverIndex = ref<number | null>(null)

function onMove(e: MouseEvent) {
    const el = svgEl.value
    const n = count.value
    if (!el || n < 1) return
    const rect = el.getBoundingClientRect()
    if (!rect.width) return
    const vx = ((e.clientX - rect.left) / rect.width) * W
    const frac = n <= 1 ? 0 : (vx - PAD_L) / PLOT_W
    const i = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))))
    if (hoverIndex.value !== i) hoverIndex.value = i
}

const hoverX = computed(() => (hoverIndex.value === null ? 0 : xAt(hoverIndex.value)))

const hoverRows = computed(() => {
    const i = hoverIndex.value
    const b = i === null ? undefined : props.buckets[i]
    if (!b) return []
    return props.series
        .map(id => ({ id, name: props.names[id] ?? id, color: props.colors[id] ?? 'var(--g-muted)', value: b.totals[id] ?? 0 }))
        .filter(r => r.value > 0)
        .sort((a, z) => z.value - a.value)
        .slice(0, 6)
})

const hoverDots = computed(() => {
    const i = hoverIndex.value
    const b = i === null ? undefined : props.buckets[i]
    if (!b || i === null) return []
    return props.series
        .map(id => ({ id, color: props.colors[id] ?? 'var(--g-muted)', value: b.totals[id] ?? 0 }))
        .filter(p => p.value > 0)
        .map(p => ({ ...p, x: xAt(i), y: yAt(p.value) }))
})

const hoverLabel = computed(() => {
    const i = hoverIndex.value
    if (i === null) return ''
    const ago = count.value - 1 - i
    return ago === 0 ? 'This hour' : `${ago}h ago`
})

const tooltipStyle = computed(() => {
    const i = hoverIndex.value
    if (i === null) return undefined
    const pct = (xAt(i) / W) * 100
    const shift = pct < 22 ? '0%' : pct > 78 ? '-100%' : '-50%'
    return { left: `${pct}%`, transform: `translateX(${shift})` }
})
</script>

<template>
    <div class="pc-wrap">
        <svg ref="svgEl" class="pc-svg" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Production per hour" @mousemove="onMove" @mouseleave="hoverIndex = null">
            <g>
                <line v-for="g in gridLines" :key="g.f" :x1="PAD_L" :x2="W - PAD_R" :y1="g.y" :y2="g.y" class="pc-grid" />
                <text v-for="g in gridLines" :key="`t-${g.f}`" :x="PAD_L - 8" :y="g.y + 3.5" class="pc-ylab">{{ g.label }}</text>
            </g>

            <line v-if="hoverIndex !== null" :x1="hoverX" :x2="hoverX" :y1="PAD_T" :y2="PAD_T + PLOT_H" class="pc-guide" />

            <path v-for="l in lines" :key="l.id" :d="l.d" :stroke="l.color" class="pc-line" />

            <circle v-for="p in hoverDots" :key="p.id" :cx="p.x" :cy="p.y" r="3.5" :fill="p.color" class="pc-dot" />

            <text v-for="(x, i) in xLabels" :key="`x-${i}`" :x="x.x" :y="H - 7" class="pc-xlab">{{ x.label }}</text>
        </svg>

        <div v-if="hoverIndex !== null && hoverRows.length" class="pc-tip" :style="tooltipStyle">
            <div class="pc-tip-head">{{ hoverLabel }}</div>
            <div v-for="r in hoverRows" :key="r.id" class="pc-tip-row">
                <span class="pc-swatch" :style="{ background: r.color }" />
                <span class="flex-1 truncate">{{ r.name }}</span>
                <b>{{ formatNumber(r.value) }}</b>
            </div>
        </div>
    </div>
</template>

<style scoped>
.pc-wrap { position: relative; width: 100%; }
.pc-svg { display: block; width: 100%; height: auto; overflow: visible; }
.pc-grid { stroke: var(--g-line); stroke-width: 1; }
.pc-guide { stroke: rgba(255, 255, 255, 0.35); stroke-width: 1; stroke-dasharray: 3 3; }
.pc-line { fill: none; stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
.pc-dot { stroke: rgba(0, 0, 0, 0.45); stroke-width: 1.5; }
.pc-ylab { fill: var(--g-muted); font-size: 10px; font-weight: 700; text-anchor: end; font-variant-numeric: tabular-nums; }
.pc-xlab { fill: var(--g-muted); font-size: 10px; font-weight: 700; text-anchor: middle; font-variant-numeric: tabular-nums; }
.pc-tip {
    position: absolute; top: 6px; z-index: 5; pointer-events: none;
    min-width: 140px; padding: 7px 9px; border-radius: 10px;
    background: rgba(12, 12, 14, 0.92); border: 1px solid var(--g-line);
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
}
.pc-tip-head { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.55; margin-bottom: 4px; }
.pc-tip-row { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.5; }
.pc-swatch { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
</style>
