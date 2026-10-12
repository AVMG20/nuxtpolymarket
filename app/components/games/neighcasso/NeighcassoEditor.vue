<script setup lang="ts">
/**
 * The Neighcasso doodle pad. Strokes live in the shared 600x400 drawing space
 * and are tagged with the body part they animate as on the track. Points are
 * thinned while drawing (nothing closer than MIN_STEP) and simplified with a
 * light Ramer-Douglas-Peucker pass when the stroke ends, so a busy doodle
 * still fits under the server's point budget.
 */
import '~/assets/css/neighcasso.css'
import NeighcassoHorseCanvas from '~/components/games/neighcasso/NeighcassoHorseCanvas.vue'
import { NC_CANVAS_H, NC_CANVAS_W, NC_NAME_MAX } from '#shared/utils/neighcasso/types'
import type { NcDrawing, NcHorse, NcStroke, NcStrokeKind } from '#shared/utils/neighcasso/types'
import { NC_MAX_POINTS, NC_MAX_STROKES } from '#shared/utils/neighcasso/drawing'
import { randomInt } from '#shared/utils/random'

const props = withDefaults(defineProps<{
    horse?: NcHorse | null
}>(), { horse: null })

const emit = defineEmits<{
    saved: [horse: NcHorse]
    close: []
}>()

const toast = useToast()

const MIN_STEP = 2
const RDP_EPSILON = 0.8
const ERASE_RADIUS = 10
const HISTORY_LIMIT = 200
const GROUND_Y = 350

interface PartTool {
    kind: NcStrokeKind
    label: string
    blurb: string
    tint: string
    icon: string
}

const PARTS: PartTool[] = [
    { kind: 'body', label: 'Body', blurb: 'stays put', tint: '#4a7bd1', icon: 'M4 15c0-5 5-8 10-8s10 2 10 7-5 7-10 7S4 20 4 15z' },
    { kind: 'leg', label: 'Legs', blurb: 'gallop', tint: '#e2574c', icon: 'M9 4l-2 17M7 21h4M19 4l2 17M19 21h4' },
    { kind: 'tail', label: 'Tail', blurb: 'wags', tint: '#e0a526', icon: 'M22 5c-6 0-9 3-8 7s6 4 5 8-7 4-11 2' },
    { kind: 'head', label: 'Head', blurb: 'bobs', tint: '#3fae6a', icon: 'M6 22c0-7 3-13 9-15l2-4 2 5c3 2 5 5 5 8 0 3-3 3-6 2l-3 4M15 12h.5' }
]
const PART_TINT: Record<NcStrokeKind, string> = Object.fromEntries(PARTS.map(p => [p.kind, p.tint])) as Record<NcStrokeKind, string>

const CRAYONS = [
    { c: '#2b2118', n: 'Charcoal' },
    { c: '#6b4226', n: 'Chestnut' },
    { c: '#c0392b', n: 'Cherry' },
    { c: '#ff7a3d', n: 'Carrot' },
    { c: '#f5c518', n: 'Hay' },
    { c: '#7bc043', n: 'Grass' },
    { c: '#1f8a70', n: 'Pond' },
    { c: '#3b82f6', n: 'Sky' },
    { c: '#8e5cd9', n: 'Grape' },
    { c: '#ff6fb5', n: 'Bubblegum' },
    { c: '#ffffff', n: 'Chalk' },
    { c: '#9aa0a6', n: 'Pebble' }
]

const SIZES = [
    { label: 'S', w: 4 },
    { label: 'M', w: 8 },
    { label: 'L', w: 14 },
    { label: 'XL', w: 24 }
]

const GAITS = [
    { label: 'Idle', gait: 0 },
    { label: 'Gallop', gait: 1 },
    { label: 'Zoomies', gait: 2.5 }
]

const HORSE_NAMES = [
    'Sir Neighs-a-Lot', 'Hoof Hearted', "Seabiscuit's Cousin", 'Doodle McGallop', 'Neigh Sayer',
    'Galloping Gary', 'Mane Event', 'Hay Girl Hay', 'Colt 45 Minutes Late', 'Unstable Genius',
    'Trotsky', 'Oats McGoats', 'Buttercup Blitz', 'Pony Soprano', 'Marefectly Normal',
    'Canter Claus', 'Horse Power Nap', 'Shergar Was Here', 'Clip Clop Clapton', 'Filly Collins',
    'Neighpoleon', 'Hoofus Maximus', 'Sugar Cube Sam', 'Four Legs Maybe', 'Stallion Around',
    'Whinny the Pooh', 'Saddle Up Susan', 'Glue Factory Escapee', 'Mustang Sally Forth', 'Barn Burner',
    'Carrot Top Speed', 'Noodle Legs', 'Lord of the Neighs', 'Speedy Spaghetti', 'Mr. Wobbles',
    'Bojack Horseplay', 'Horsey McHorseface', 'Tail Spin', 'Heinz Neighty-Seven', 'Potato With Legs',
    'Gallopagos', 'Mane Attraction'
]

function randomHorseName() {
    return HORSE_NAMES[randomInt(0, HORSE_NAMES.length - 1)]!
}

// ── state ────────────────────────────────────────────────────────────────

const strokes = ref<NcStroke[]>([])
const past = ref<NcStroke[][]>([])
const future = ref<NcStroke[][]>([])
const name = ref('')
const tool = ref<'pen' | 'eraser'>('pen')
const kind = ref<NcStrokeKind>('body')
const color = ref('#2b2118')
const size = ref(8)
const showParts = ref(false)
const showGhost = ref(true)
const gait = ref(1)
const clearArmed = ref(false)
const saving = ref(false)
const error = ref('')
const limitNote = ref('')

let clearTimer: ReturnType<typeof setTimeout> | null = null

function reset(horse: NcHorse | null) {
    strokes.value = horse ? horse.drawing.strokes.map(s => ({ ...s, p: [...s.p] })) : []
    past.value = []
    future.value = []
    name.value = horse?.name ?? randomHorseName()
    error.value = ''
    limitNote.value = ''
}

watch(() => props.horse, h => reset(h ?? null), { immediate: true })

const pointCount = computed(() => strokes.value.reduce((n, s) => n + s.p.length / 2, 0))
const canUndo = computed(() => past.value.length > 0)
const canRedo = computed(() => future.value.length > 0)
const isEmpty = computed(() => strokes.value.length === 0)
const previewDrawing = computed<NcDrawing | null>(() => isEmpty.value ? null : { v: 1, strokes: strokes.value })
const previewPose = computed(() => gait.value > 2 ? 'zoomies' as const : 'idle' as const)
const activePart = computed(() => PARTS.find(p => p.kind === kind.value)!)

function commit(next: NcStroke[]) {
    past.value.push(strokes.value)
    if (past.value.length > HISTORY_LIMIT) past.value.shift()
    future.value = []
    strokes.value = next
    error.value = ''
}

function undo() {
    const prev = past.value.pop()
    if (!prev) return
    future.value.push(strokes.value)
    strokes.value = prev
}

function redo() {
    const next = future.value.pop()
    if (!next) return
    past.value.push(strokes.value)
    strokes.value = next
}

function onClear() {
    if (!clearArmed.value) {
        clearArmed.value = true
        if (clearTimer) clearTimeout(clearTimer)
        clearTimer = setTimeout(() => { clearArmed.value = false }, 3000)
        return
    }
    clearArmed.value = false
    if (clearTimer) clearTimeout(clearTimer)
    if (!isEmpty.value) commit([])
}

function pickPart(k: NcStrokeKind) {
    kind.value = k
    tool.value = 'pen'
}

function rerollName() {
    let next = randomHorseName()
    for (let i = 0; i < 5 && next === name.value; i++) next = randomHorseName()
    name.value = next
}

// ── canvas ───────────────────────────────────────────────────────────────

const wrap = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let resizer: ResizeObserver | null = null
let frame = 0

/** Stroke being drawn right now; kept out of reactivity so moves stay cheap. */
let live: NcStroke | null = null
let activePointer: number | null = null
let erasedThisDrag = false
let hover: { x: number, y: number } | null = null

function fitCanvas() {
    const el = canvas.value
    const box = wrap.value
    if (!el || !box) return
    const cssW = box.clientWidth
    const cssH = cssW * NC_CANVAS_H / NC_CANVAS_W
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    el.width = Math.max(1, Math.round(cssW * dpr))
    el.height = Math.max(1, Math.round(cssH * dpr))
    ctx = el.getContext('2d')
    scheduleDraw()
}

function scheduleDraw() {
    if (frame || typeof requestAnimationFrame === 'undefined') return
    frame = requestAnimationFrame(() => {
        frame = 0
        draw()
    })
}

function drawGhost(c: CanvasRenderingContext2D) {
    c.save()
    c.strokeStyle = 'rgba(43, 33, 24, 0.2)'
    c.fillStyle = 'rgba(43, 33, 24, 0.05)'
    c.lineWidth = 3
    c.setLineDash([8, 8])
    c.lineCap = 'round'
    c.lineJoin = 'round'

    c.beginPath()
    c.ellipse(290, 225, 118, 52, 0, 0, Math.PI * 2)
    c.fill()
    c.stroke()

    c.beginPath()
    c.moveTo(365, 195)
    c.lineTo(408, 108)
    c.lineTo(442, 118)
    c.lineTo(402, 215)
    c.fill()
    c.stroke()

    c.beginPath()
    c.ellipse(452, 122, 40, 22, 0.4, 0, Math.PI * 2)
    c.fill()
    c.stroke()

    c.beginPath()
    c.moveTo(418, 100)
    c.lineTo(424, 74)
    c.lineTo(436, 98)
    c.stroke()

    c.lineWidth = 12
    c.setLineDash([10, 10])
    for (const [x0, y0, x1, y1] of [[222, 262, 210, GROUND_Y - 6], [256, 268, 262, GROUND_Y - 6], [335, 268, 328, GROUND_Y - 6], [368, 258, 386, GROUND_Y - 6]] as const) {
        c.beginPath()
        c.moveTo(x0, y0)
        c.lineTo(x1, y1)
        c.stroke()
    }

    c.lineWidth = 6
    c.beginPath()
    c.moveTo(176, 205)
    c.quadraticCurveTo(122, 196, 132, 290)
    c.stroke()

    c.setLineDash([])
    c.fillStyle = 'rgba(43, 33, 24, 0.22)'
    c.font = 'bold 20px "Comic Neue", "Chalkboard SE", "Comic Sans MS", cursive'
    c.textAlign = 'center'
    c.fillText('horse goes here', 290, 232)
    c.restore()
}

function drawStroke(c: CanvasRenderingContext2D, s: NcStroke) {
    const tint = showParts.value ? PART_TINT[s.k] : s.c
    const p = s.p
    if (p.length === 2) {
        c.fillStyle = tint
        c.beginPath()
        c.arc(p[0]!, p[1]!, s.w / 2, 0, Math.PI * 2)
        c.fill()
        return
    }
    c.strokeStyle = tint
    c.lineWidth = s.w
    c.beginPath()
    c.moveTo(p[0]!, p[1]!)
    for (let i = 2; i < p.length; i += 2) c.lineTo(p[i]!, p[i + 1]!)
    c.stroke()
}

function draw() {
    const el = canvas.value
    const c = ctx
    if (!el || !c) return
    const scale = el.width / NC_CANVAS_W
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, el.width, el.height)
    c.setTransform(scale, 0, 0, scale, 0, 0)

    // Ground line.
    c.save()
    c.strokeStyle = 'rgba(107, 90, 72, 0.35)'
    c.lineWidth = 2
    c.setLineDash([12, 10])
    c.beginPath()
    c.moveTo(12, GROUND_Y)
    c.lineTo(NC_CANVAS_W - 12, GROUND_Y)
    c.stroke()
    c.restore()

    if (showGhost.value) drawGhost(c)

    c.lineCap = 'round'
    c.lineJoin = 'round'
    for (const s of strokes.value) drawStroke(c, s)
    if (live) drawStroke(c, live)

    if (hover && activePointer === null) {
        c.save()
        c.lineWidth = 1.5
        c.setLineDash(tool.value === 'eraser' ? [4, 4] : [])
        c.strokeStyle = tool.value === 'eraser' ? 'rgba(192, 57, 43, 0.8)' : 'rgba(43, 33, 24, 0.5)'
        c.beginPath()
        c.arc(hover.x, hover.y, tool.value === 'eraser' ? ERASE_RADIUS : Math.max(2, size.value / 2), 0, Math.PI * 2)
        c.stroke()
        c.restore()
    }
}

watch([strokes, showParts, showGhost, tool, size], scheduleDraw)

onMounted(() => {
    fitCanvas()
    resizer = new ResizeObserver(fitCanvas)
    if (wrap.value) resizer.observe(wrap.value)
    window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
    resizer?.disconnect()
    if (frame) cancelAnimationFrame(frame)
    if (clearTimer) clearTimeout(clearTimer)
    window.removeEventListener('keydown', onKey)
})

// ── input ────────────────────────────────────────────────────────────────

function toLogical(e: PointerEvent) {
    const rect = canvas.value!.getBoundingClientRect()
    return {
        x: Math.round(Math.min(NC_CANVAS_W, Math.max(0, (e.clientX - rect.left) / rect.width * NC_CANVAS_W))),
        y: Math.round(Math.min(NC_CANVAS_H, Math.max(0, (e.clientY - rect.top) / rect.height * NC_CANVAS_H)))
    }
}

function segDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
    const dx = bx - ax
    const dy = by - ay
    const len = dx * dx + dy * dy
    let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0
    t = Math.max(0, Math.min(1, t))
    const x = ax + t * dx - px
    const y = ay + t * dy - py
    return x * x + y * y
}

function hitStroke(x: number, y: number): number {
    for (let i = strokes.value.length - 1; i >= 0; i--) {
        const s = strokes.value[i]!
        const r = s.w / 2 + ERASE_RADIUS
        const r2 = r * r
        const p = s.p
        if (p.length === 2) {
            if (segDistSq(x, y, p[0]!, p[1]!, p[0]!, p[1]!) <= r2) return i
            continue
        }
        for (let j = 2; j < p.length; j += 2) {
            if (segDistSq(x, y, p[j - 2]!, p[j - 1]!, p[j]!, p[j + 1]!) <= r2) return i
        }
    }
    return -1
}

function eraseAt(x: number, y: number) {
    const i = hitStroke(x, y)
    if (i < 0) return
    const next = strokes.value.slice()
    next.splice(i, 1)
    if (!erasedThisDrag) {
        commit(next)
        erasedThisDrag = true
    } else {
        strokes.value = next
    }
}

function onDown(e: PointerEvent) {
    if (activePointer !== null) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const { x, y } = toLogical(e)

    if (tool.value === 'eraser') {
        activePointer = e.pointerId
        canvas.value?.setPointerCapture(e.pointerId)
        erasedThisDrag = false
        eraseAt(x, y)
        return
    }

    if (strokes.value.length >= NC_MAX_STROKES) {
        limitNote.value = `That's ${NC_MAX_STROKES} strokes, the most a horse can hold. Erase some to keep going.`
        return
    }
    if (pointCount.value >= NC_MAX_POINTS) {
        limitNote.value = 'Out of ink! This horse is as detailed as it gets. Erase some strokes to keep going.'
        return
    }
    limitNote.value = ''
    activePointer = e.pointerId
    canvas.value?.setPointerCapture(e.pointerId)
    live = { k: kind.value, c: color.value.toLowerCase(), w: size.value, p: [x, y] }
    scheduleDraw()
}

function addPoint(x: number, y: number) {
    if (!live) return
    const p = live.p
    const dx = x - p[p.length - 2]!
    const dy = y - p[p.length - 1]!
    if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) return
    if (pointCount.value + p.length / 2 >= NC_MAX_POINTS) {
        limitNote.value = 'Out of ink! That stroke hit the detail limit.'
        return
    }
    p.push(x, y)
}

function onMove(e: PointerEvent) {
    if (e.pointerType !== 'touch') {
        hover = toLogical(e)
        if (activePointer === null) scheduleDraw()
    }
    if (e.pointerId !== activePointer) return
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    const list = events.length ? events : [e]
    for (const ev of list) {
        const { x, y } = toLogical(ev)
        if (tool.value === 'eraser') eraseAt(x, y)
        else addPoint(x, y)
    }
    scheduleDraw()
}

function onUp(e: PointerEvent) {
    if (e.pointerId !== activePointer) return
    activePointer = null
    if (canvas.value?.hasPointerCapture(e.pointerId)) canvas.value.releasePointerCapture(e.pointerId)
    if (live) {
        const done = { ...live, p: simplify(live.p) }
        live = null
        commit([...strokes.value, done])
    }
    erasedThisDrag = false
    scheduleDraw()
}

function onLeave() {
    hover = null
    scheduleDraw()
}

/** Ramer-Douglas-Peucker over flat [x, y, …] points. */
function simplify(p: number[]): number[] {
    const n = p.length / 2
    if (n <= 2) return p
    const keep = new Uint8Array(n)
    keep[0] = 1
    keep[n - 1] = 1
    const stack: [number, number][] = [[0, n - 1]]
    const eps2 = RDP_EPSILON * RDP_EPSILON
    while (stack.length) {
        const [a, b] = stack.pop()!
        let best = -1
        let bestD = eps2
        for (let i = a + 1; i < b; i++) {
            const d = segDistSq(p[i * 2]!, p[i * 2 + 1]!, p[a * 2]!, p[a * 2 + 1]!, p[b * 2]!, p[b * 2 + 1]!)
            if (d > bestD) {
                bestD = d
                best = i
            }
        }
        if (best >= 0) {
            keep[best] = 1
            stack.push([a, best], [best, b])
        }
    }
    const out: number[] = []
    for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2]!, p[i * 2 + 1]!)
    return out
}

function onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    if (!(e.ctrlKey || e.metaKey)) return
    const key = e.key.toLowerCase()
    if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
    }
}

// ── save ─────────────────────────────────────────────────────────────────

async function save() {
    if (saving.value) return
    const clean = name.value.replace(/\s+/g, ' ').trim().slice(0, NC_NAME_MAX)
    if (isEmpty.value) {
        error.value = 'Draw something first. Even a potato counts.'
        return
    }
    if (!clean) {
        error.value = 'Every horse needs a name.'
        return
    }
    if (strokes.value.length > NC_MAX_STROKES || pointCount.value > NC_MAX_POINTS) {
        error.value = 'This horse is too detailed to save. Erase a few strokes.'
        return
    }
    error.value = ''
    saving.value = true
    const body = { name: clean, drawing: { v: 1, strokes: strokes.value } satisfies NcDrawing }
    try {
        const saved = props.horse
            ? await apiFetch<NcHorse>(`/api/neighcasso/horses/${props.horse.id}`, { method: 'PUT', body })
            : await apiFetch<NcHorse>('/api/neighcasso/horses', { method: 'POST', body })
        emit('saved', saved)
    } catch (e) {
        const message = apiErrorMessage(e, 'Could not save your horse')
        error.value = message
        toast.add({ title: message, color: 'error' })
    } finally {
        saving.value = false
    }
}
</script>

<template>
    <div class="nc-root nc-editor nc-paper">
        <header class="nc-editor-head">
            <div class="min-w-0">
                <h2 class="nc-title text-2xl sm:text-3xl">
                    <span class="nc-scribble">{{ horse ? 'Touch up your horse' : 'Draw a horse' }}</span>
                </h2>
                <p class="nc-hint mt-1">
                    Legs gallop, tails wag, heads bob. Draw facing right →
                </p>
            </div>
            <button class="nc-sticker nc-sticker-sm shrink-0" aria-label="Close editor" @click="emit('close')">
                <UIcon name="i-lucide-x" class="size-4" />
            </button>
        </header>

        <div class="nc-editor-body">
            <section class="nc-editor-main">
                <div class="nc-toolrow" role="toolbar" aria-label="Pens">
                    <button
                        v-for="part in PARTS"
                        :key="part.kind"
                        class="nc-sticker nc-part"
                        :class="{ 'is-active': tool === 'pen' && kind === part.kind }"
                        :aria-pressed="tool === 'pen' && kind === part.kind"
                        :title="`${part.label}: ${part.blurb}`"
                        @click="pickPart(part.kind)"
                    >
                        <svg viewBox="0 0 28 26" class="nc-part-icon" aria-hidden="true">
                            <path :d="part.icon" fill="none" :stroke="part.tint" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                        <span class="flex flex-col items-start leading-none">
                            <span>{{ part.label }}</span>
                            <span class="nc-part-blurb">{{ part.blurb }}</span>
                        </span>
                    </button>
                    <button
                        class="nc-sticker nc-part"
                        :class="{ 'is-active nc-sticker-pink': tool === 'eraser' }"
                        :aria-pressed="tool === 'eraser'"
                        title="Eraser: tap or drag over a stroke to rub it out"
                        @click="tool = 'eraser'"
                    >
                        <UIcon name="i-lucide-eraser" class="size-5" />
                        <span class="flex flex-col items-start leading-none">
                            <span>Eraser</span>
                            <span class="nc-part-blurb">whole strokes</span>
                        </span>
                    </button>
                </div>

                <div class="nc-toolrow">
                    <div class="nc-palette" role="radiogroup" aria-label="Crayon colour">
                        <button
                            v-for="cr in CRAYONS"
                            :key="cr.c"
                            class="nc-swatch"
                            :class="{ 'is-active': color === cr.c }"
                            :style="{ background: cr.c }"
                            :title="cr.n"
                            role="radio"
                            :aria-checked="color === cr.c"
                            :aria-label="cr.n"
                            @click="color = cr.c; tool = 'pen'"
                        />
                        <label
                            class="nc-swatch nc-swatch-custom"
                            :class="{ 'is-active': !CRAYONS.some(cr => cr.c === color) }"
                            title="Mix your own"
                        >
                            <input v-model="color" type="color" class="sr-only" aria-label="Custom colour" @input="tool = 'pen'">
                            <UIcon name="i-lucide-plus" class="size-3.5" />
                        </label>
                    </div>
                    <div class="nc-sizes" role="radiogroup" aria-label="Brush size">
                        <button
                            v-for="s in SIZES"
                            :key="s.label"
                            class="nc-sticker nc-sticker-sm nc-size"
                            :class="{ 'is-active': size === s.w }"
                            role="radio"
                            :aria-checked="size === s.w"
                            :title="`${s.label} brush`"
                            @click="size = s.w"
                        >
                            <span class="nc-size-dot" :style="{ width: `${Math.max(4, s.w * 0.7)}px`, height: `${Math.max(4, s.w * 0.7)}px`, background: tool === 'pen' ? color : '#2b2118' }" />
                            {{ s.label }}
                        </button>
                    </div>
                </div>

                <div ref="wrap" class="nc-canvas-wrap nc-doodle-soft" :class="{ 'is-eraser': tool === 'eraser' }">
                    <canvas
                        ref="canvas"
                        class="nc-canvas"
                        @pointerdown="onDown"
                        @pointermove="onMove"
                        @pointerup="onUp"
                        @pointercancel="onUp"
                        @pointerleave="onLeave"
                        @contextmenu.prevent
                    />
                    <span class="nc-canvas-tag nc-chip" :style="{ borderColor: tool === 'eraser' ? '#c0392b' : activePart.tint }">
                        {{ tool === 'eraser' ? 'Erasing' : `Drawing: ${activePart.label}` }}
                    </span>
                </div>

                <div class="nc-toolrow">
                    <button class="nc-sticker nc-sticker-sm" :disabled="!canUndo" title="Undo (Ctrl+Z)" @click="undo">
                        <UIcon name="i-lucide-undo-2" class="size-4" /> Undo
                    </button>
                    <button class="nc-sticker nc-sticker-sm" :disabled="!canRedo" title="Redo (Ctrl+Shift+Z)" @click="redo">
                        <UIcon name="i-lucide-redo-2" class="size-4" /> Redo
                    </button>
                    <button
                        class="nc-sticker nc-sticker-sm"
                        :class="{ 'nc-sticker-red nc-wiggle': clearArmed }"
                        :disabled="isEmpty && !clearArmed"
                        @click="onClear"
                    >
                        <UIcon name="i-lucide-trash-2" class="size-4" /> {{ clearArmed ? 'Sure? Tap again' : 'Clear' }}
                    </button>
                    <button class="nc-sticker nc-sticker-sm" :class="{ 'is-active': showParts }" :aria-pressed="showParts" title="Colour strokes by body part" @click="showParts = !showParts">
                        <UIcon name="i-lucide-scan-eye" class="size-4" /> Show parts
                    </button>
                    <button class="nc-sticker nc-sticker-sm" :class="{ 'is-active': showGhost }" :aria-pressed="showGhost" title="Faint horse outline to trace" @click="showGhost = !showGhost">
                        <UIcon name="i-lucide-ghost" class="size-4" /> Ghost
                    </button>
                    <span class="nc-hint ml-auto whitespace-nowrap" :class="{ 'nc-error': strokes.length >= NC_MAX_STROKES || pointCount >= NC_MAX_POINTS }">
                        {{ strokes.length }}/{{ NC_MAX_STROKES }} strokes · {{ Math.round(pointCount / NC_MAX_POINTS * 100) }}% ink
                    </span>
                </div>

                <div v-if="showParts" class="nc-legend">
                    <span v-for="part in PARTS" :key="part.kind" class="nc-chip">
                        <span class="nc-legend-dot" :style="{ background: part.tint }" /> {{ part.label }}
                    </span>
                </div>
                <p v-if="limitNote" class="nc-error">
                    {{ limitNote }}
                </p>
            </section>

            <aside class="nc-editor-side">
                <div class="nc-preview nc-doodle-alt nc-tape nc-paper-plain">
                    <NeighcassoHorseCanvas
                        v-if="previewDrawing"
                        :drawing="previewDrawing"
                        :gait="gait"
                        :pose="previewPose"
                        :height="130"
                    />
                    <p v-else class="nc-preview-empty">
                        Your horse will trot here
                    </p>
                </div>
                <div class="nc-gaits" role="radiogroup" aria-label="Preview gait">
                    <button
                        v-for="g in GAITS"
                        :key="g.label"
                        class="nc-sticker nc-sticker-sm"
                        :class="{ 'is-active': gait === g.gait }"
                        role="radio"
                        :aria-checked="gait === g.gait"
                        @click="gait = g.gait"
                    >
                        {{ g.label }}
                    </button>
                </div>

                <label class="nc-title text-base" for="nc-horse-name">Name</label>
                <div class="flex gap-2">
                    <input
                        id="nc-horse-name"
                        v-model="name"
                        class="nc-input flex-1"
                        :maxlength="NC_NAME_MAX"
                        placeholder="Sir Neighs-a-Lot"
                        autocomplete="off"
                        @keydown.enter="save"
                    >
                    <button class="nc-sticker nc-sticker-lilac nc-sticker-sm" title="Randomize name" aria-label="Randomize name" @click="rerollName">
                        <UIcon name="i-lucide-dices" class="size-5" />
                    </button>
                </div>
                <p class="nc-hint -mt-1 text-right">
                    {{ name.length }}/{{ NC_NAME_MAX }}
                </p>

                <button class="nc-sticker nc-sticker-mint nc-sticker-lg w-full" :disabled="isEmpty || saving" @click="save">
                    <UIcon :name="saving ? 'i-lucide-loader-circle' : 'i-lucide-check'" class="size-5" :class="{ 'animate-spin': saving }" />
                    {{ saving ? 'Saving…' : horse ? 'Save changes' : 'Add to my stable' }}
                </button>
                <p v-if="error" class="nc-error text-center">
                    {{ error }}
                </p>
            </aside>
        </div>
    </div>
</template>

<style scoped>
.nc-editor {
    padding: 1rem 1rem 1.25rem 2.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    min-height: 100%;
}

.nc-editor-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
}

.nc-editor-body {
    display: grid;
    gap: 1.25rem;
    grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 1024px) {
    .nc-editor-body {
        grid-template-columns: minmax(0, 1fr) 17rem;
    }
}

.nc-editor-main,
.nc-editor-side {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    min-width: 0;
}

.nc-toolrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
}

.nc-part {
    padding: 0.35rem 0.65rem;
}

.nc-part-icon {
    width: 26px;
    height: 24px;
    flex-shrink: 0;
}

.nc-part-blurb {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--nc-ink-soft);
    margin-top: 2px;
}

.nc-palette {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
}

.nc-swatch {
    width: 28px;
    height: 28px;
    border: 2.5px solid var(--nc-ink);
    border-radius: 50% 44% 52% 40% / 44% 52% 40% 50%;
    cursor: pointer;
    transition: transform 0.12s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--nc-ink);
}

.nc-swatch:nth-child(3n) { transform: rotate(8deg); }
.nc-swatch:nth-child(3n + 1) { transform: rotate(-6deg); }
.nc-swatch:hover { transform: scale(1.12) rotate(-4deg); }

.nc-swatch.is-active {
    transform: scale(1.18) rotate(-6deg);
    box-shadow: 0 0 0 3px var(--nc-paper), 0 0 0 5.5px var(--nc-ink);
}

.nc-swatch-custom {
    background: conic-gradient(#ff6fb5, #f5c518, #7bc043, #3b82f6, #8e5cd9, #ff6fb5);
    position: relative;
}

.nc-sizes {
    display: flex;
    gap: 0.35rem;
    margin-left: auto;
}

.nc-size {
    min-width: 3rem;
}

.nc-size-dot {
    display: inline-block;
    border-radius: 50%;
    border: 1px solid rgba(43, 33, 24, 0.4);
}

.nc-canvas-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 3 / 2;
    background: #fffdf4;
    overflow: hidden;
    cursor: crosshair;
}

.nc-canvas-wrap.is-eraser {
    cursor: cell;
}

.nc-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
}

.nc-canvas-tag {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    pointer-events: none;
    transform: rotate(-2deg);
    background: rgba(255, 255, 255, 0.85);
}

.nc-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
}

.nc-legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
}

.nc-preview {
    min-height: 150px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    overflow: hidden;
}

.nc-preview-empty {
    color: var(--nc-ink-soft);
    font-weight: 700;
    transform: rotate(-3deg);
}

.nc-gaits {
    display: flex;
    gap: 0.4rem;
    justify-content: center;
}

@media (max-width: 640px) {
    .nc-editor {
        padding: 0.75rem 0.75rem 1rem 2.4rem;
    }

    .nc-sizes {
        margin-left: 0;
    }
}
</style>
