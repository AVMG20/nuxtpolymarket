<script setup lang="ts">
import type { SectionSpot } from '#shared/utils/nitro-rush/custom'
import type { FieldTool, GrowEdge } from '#shared/utils/nitro-rush/field-edit'
import { FIELD_TILE, GATE_SPAN, PILLAR_RADIUS, type FieldDir, type FieldEdge, type FieldPlan, type FieldPort } from '#shared/utils/nitro-rush/field'
import type { WalkedFieldSection } from '#shared/utils/nitro-rush/field-group'
import { fieldEditorPicture, pictureTile } from '~/utils/nitro-rush/field-editor'

/** A start or finish's checkered band: two rows of squares right across its tile. */
const CHECK = 2.5
const CHECK_COLS = FIELD_TILE / CHECK
const CHECKS = Array.from({ length: CHECK_COLS * 2 }, (_, i) => [i % CHECK_COLS, Math.floor(i / CHECK_COLS)] as const)
    .filter(([c, r]) => (c + r) % 2 === 1)
    .map(([c, r]) => [-FIELD_TILE / 2 + c * CHECK, (r - 1) * CHECK] as const)

/** The highlighted field and those joined to it, from above: tap a tile to place or turn an item, drag to paint, tap an edge for a road, + for another field. */
const props = defineProps<{
    plan: FieldPlan
    /** The highlighted field and every field joined to it edge to edge, in course order. */
    group: readonly WalkedFieldSection[]
    selected: SectionSpot
    /** Each road that leaves the highlighted field through a port, with its line. */
    ports: readonly { line: number, port: FieldPort }[]
    /** Where roads from other lines drive into the group, in the world. */
    arrivals: readonly { line: number, x: number, z: number }[]
    /** Whether the highlighted field may grow: only the last of a run of fields does. */
    grows: boolean
    /** Why the last edit didn't go in. */
    error: string | null
    /** A loop, which has no finish. */
    closed: boolean
    /** A loop of only fields, which no road comes into or leaves. */
    arena: boolean
    /** Why the highlighted field's way in can't move, or null. */
    entryLock: string | null
}>()
const emit = defineEmits<{
    tool: [spot: SectionSpot, col: number, row: number, tool: FieldTool, painting: boolean, facing: FieldDir, required: boolean]
    resize: [width: number, length: number]
    exit: [port: FieldPort]
    road: [port: FieldPort]
    entry: [port: FieldPort]
    grow: [edge: GrowEdge]
}>()

type Tool = FieldTool | 'exit' | 'road'
const TOOLS: { id: Tool, icon: string, label: string, hint: string }[] = [
    { id: 'boost', icon: 'i-lucide-chevrons-up', label: 'Boost', hint: 'Tap a tile for a boost pad; tap it again to turn it.' },
    { id: 'checkpoint', icon: 'i-lucide-milestone', label: 'Checkpoint', hint: 'Tap a tile to add a checkpoint. Tap again to turn it.' },
    { id: 'start', icon: 'i-lucide-flag-triangle-right', label: 'Start', hint: 'Tap a tile to move the start. Tap again to turn the grid.' },
    { id: 'finish', icon: 'i-lucide-flag', label: 'Finish', hint: 'Tap a tile to move the finish. Tap again to turn it.' },
    { id: 'block', icon: 'i-lucide-square', label: 'Block', hint: 'Tap or drag across tiles to wall them off.' },
    { id: 'pillar', icon: 'i-lucide-circle-dot', label: 'Pillar', hint: 'Tap a tile to add a pillar.' },
    { id: 'erase', icon: 'i-lucide-eraser', label: 'Erase', hint: 'Tap or drag across tiles to clear them.' },
    { id: 'exit', icon: 'i-lucide-git-branch', label: 'Branch', hint: 'Tap a slot on the highlighted field\'s edge to start a new road out.' },
    { id: 'road', icon: 'i-lucide-route', label: 'Move road', hint: 'Tap an edge slot to move the road out. Tap IN, then a slot, to move the road in.' }
]
const tool = ref<Tool>('boost')
// A loop's start line ends each lap, so it has no finish to place.
const tools = computed(() => {
    const list = props.closed
        ? TOOLS.filter(t => t.id !== 'finish').map(t => t.id === 'start'
            ? { ...t, label: 'Start/Finish', hint: 'Tap a tile to move the start/finish. Tap again to turn the grid.' }
            : t)
        : TOOLS
    // An arena has no road in or out to move, and no branches yet.
    return props.arena ? list.filter(t => t.id !== 'exit' && t.id !== 'road') : list
})
watch(tools, (list) => {
    if (!list.some(t => t.id === tool.value)) tool.value = 'boost'
})
const current = computed(() => tools.value.find(t => t.id === tool.value) ?? tools.value[0]!)
/** With the checkpoint tool: new checkpoints go in required, and tapping one switches it to match before it turns. */
const required = ref(false)
const hint = computed(() => tool.value === 'checkpoint' && required.value
    ? 'Tap a tile or checkpoint to make it required. Tap again to turn it.'
    : current.value.hint)
/** Whether the road tool has picked up the way in, so the next slot tapped moves it. */
const movingEntry = ref(false)
/** Why tapping the way in did nothing, until the next tap. */
const notice = ref<string | null>(null)
watch([tool, () => props.selected], () => {
    movingEntry.value = false
    notice.value = null
})
const edgeTool = computed(() => tool.value === 'exit' || tool.value === 'road')

const selectedIndex = computed(() => Math.max(0, props.group.findIndex(f => f.spot.branch === props.selected.branch && f.spot.at === props.selected.at)))
const picture = computed(() => fieldEditorPicture(props.group, selectedIndex.value, props.ports, props.arrivals, props.grows, !props.arena))
const viewBox = computed(() => {
    const { margin: m, width, height } = picture.value
    return `${-m} ${-m} ${width + m * 2} ${height + m * 2}`
})
/** The highlighted field's outline, when there are others beside it to tell it from. */
const outlined = computed(() => picture.value.floors.length > 1 ? picture.value.floors.find(f => f.selected) : undefined)
const growLabel = (edge: GrowEdge) => `Add a field past the ${edge === 'exit' ? 'far' : edge} edge`

const svg = ref<SVGSVGElement | null>(null)

/** The tile under a pointer, or null off every field. */
function tileAt(e: PointerEvent) {
    const m = svg.value?.getScreenCTM()
    if (!m) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return pictureTile(props.group, p.x, p.y)
}

/** Tiles painted on this drag, so each gets the tool once. */
let painted: Set<string> | null = null
const tileKey = (t: { spot: SectionSpot, col: number, row: number }) => `${t.spot.branch}:${t.spot.at}:${t.col},${t.row}`

function onDown(e: PointerEvent) {
    if (edgeTool.value || !e.isPrimary) return
    notice.value = null
    const at = tileAt(e)
    if (!at) return
    emit('tool', at.spot, at.col, at.row, tool.value as FieldTool, false, at.facing, required.value)
    if (tool.value === 'block' || tool.value === 'erase') {
        painted = new Set([tileKey(at)])
        svg.value?.setPointerCapture(e.pointerId)
    }
}

function onMove(e: PointerEvent) {
    if (!painted) return
    const at = tileAt(e)
    if (!at || painted.has(tileKey(at))) return
    painted.add(tileKey(at))
    emit('tool', at.spot, at.col, at.row, tool.value as FieldTool, true, at.facing, required.value)
}

function onUp() {
    painted = null
}

const isEntry = (s: { edge: FieldEdge, tile: number }) => s.edge === 'entry' && s.tile === props.plan.entry

function onSlot(edge: FieldEdge, tile: number) {
    notice.value = null
    if (tool.value === 'exit') {
        emit('exit', { edge, tile })
    } else if (tool.value === 'road' && isEntry({ edge, tile })) {
        notice.value = props.entryLock
        movingEntry.value = !props.entryLock && !movingEntry.value
    } else if (tool.value === 'road') {
        if (movingEntry.value) emit('entry', { edge, tile })
        else emit('road', { edge, tile })
        movingEntry.value = false
    }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <span class="nr-label">FIELD</span>
      <div class="nr-toggle is-small is-row flex-wrap" role="radiogroup" aria-label="Field tool">
        <button
          v-for="t in tools"
          :key="t.id"
          role="radio"
          :aria-checked="tool === t.id"
          :title="t.hint"
          class="nr-field-tool"
          :class="{ 'is-active': tool === t.id }"
          @click="tool = t.id"
        >
          <UIcon :name="t.icon" class="size-3.5 shrink-0" />
          {{ t.label.toUpperCase() }}
        </button>
      </div>
      <button
        v-if="tool === 'checkpoint'"
        class="nr-field-required"
        :class="{ 'is-active': required }"
        :aria-pressed="required"
        title="Every lap must pass required checkpoints"
        @click="required = !required"
      >
        <UIcon name="i-lucide-badge-alert" class="size-3.5 shrink-0" />
        REQUIRED
      </button>
      <NitroRushBuilderFieldSize :width="plan.width" :length="plan.length" @change="(w, l) => emit('resize', w, l)" />
    </div>
    <p class="nr-field-hint">
      {{ hint }}
      <template v-if="grows">Tap <span class="nr-field-hint-plus">+</span> beside an edge to add a field there.</template>
      <template v-else>To add a field, highlight the last one in the run.</template>
    </p>
    <svg
      ref="svg"
      class="nr-field-editor"
      :viewBox="viewBox"
      :style="{ '--u': picture.unit }"
      preserveAspectRatio="xMidYMid meet"
      role="application"
      aria-label="Field tiles"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <g v-for="f in picture.floors" :key="f.key">
        <rect :x="f.x" :y="f.y" :width="f.width" :height="f.height" class="nr-field-floor" />
        <line v-for="x in f.cols" :key="`c${x}`" :x1="x" :y1="f.y" :x2="x" :y2="f.y + f.height" class="nr-field-grid" />
        <line v-for="y in f.rows" :key="`r${y}`" :x1="f.x" :y1="y" :x2="f.x + f.width" :y2="y" class="nr-field-grid" />
      </g>
      <g v-for="t in picture.items" :key="t.key" :transform="`translate(${t.x} ${t.y})`">
        <rect v-if="t.kind === 'block'" :x="-FIELD_TILE / 2" :y="-FIELD_TILE / 2" :width="FIELD_TILE" :height="FIELD_TILE" class="nr-field-block" />
        <circle v-else-if="t.kind === 'pillar'" :r="PILLAR_RADIUS" class="nr-field-block" />
        <template v-else-if="t.kind === 'start' || t.kind === 'finish'">
          <rect :x="-FIELD_TILE / 2" :y="-FIELD_TILE / 2" :width="FIELD_TILE" :height="FIELD_TILE" class="nr-field-line-tile" :class="`is-${t.kind}`" />
          <g :transform="`rotate(${t.turn})`">
            <rect :x="-FIELD_TILE / 2" :y="-CHECK" :width="FIELD_TILE" :height="CHECK * 2" class="nr-field-line-band" />
            <rect v-for="[x, y] in CHECKS" :key="`${x},${y}`" :x="x" :y="y" :width="CHECK" :height="CHECK" class="nr-field-line-check" />
            <circle :cx="-GATE_SPAN" cy="0" r="1.6" class="nr-field-gate-post" />
            <circle :cx="GATE_SPAN" cy="0" r="1.6" class="nr-field-gate-post" />
            <!-- Only a start has a way, the one its grid faces. -->
            <path v-if="t.kind === 'start'" d="M -5 -5 L 0 -9 L 5 -5" class="nr-field-line-arrow is-start" />
          </g>
          <!-- Kept upright, in a corner the band and arrow never reach at any turn. -->
          <g transform="translate(7.5 -7.5)">
            <circle r="2.4" class="nr-field-line-badge" :class="`is-${t.kind}`" />
            <text class="nr-field-line-letter">{{ t.kind === 'start' ? 'S' : 'F' }}</text>
          </g>
          <title>{{ t.kind === 'start' ? 'Start line' : 'Finish line' }}</title>
        </template>
        <g v-else-if="t.kind === 'boost'" :transform="`rotate(${t.turn})`">
          <rect x="-8" y="-8" width="16" height="16" rx="2" class="nr-field-pad" />
          <path d="M -5 2 L 0 -4 L 5 2 M -5 7 L 0 1 L 5 7" class="nr-field-arrow" />
        </g>
        <template v-else>
          <g :transform="`rotate(${t.turn})`" :class="{ 'is-required': t.required }">
            <rect x="-9" y="-9" width="18" height="18" rx="2" class="nr-field-gate-tile" />
            <line :x1="-GATE_SPAN" y1="0" :x2="GATE_SPAN" y2="0" class="nr-field-gate" />
            <circle :cx="-GATE_SPAN" cy="0" r="1.6" class="nr-field-gate-post" />
            <circle :cx="GATE_SPAN" cy="0" r="1.6" class="nr-field-gate-post" />
          </g>
          <!-- Upright in the corner, as a start or finish's letter is, so it isn't told apart by colour alone. -->
          <g v-if="t.required" transform="translate(7.5 -7.5)">
            <circle r="2.4" class="nr-field-line-badge is-required" />
            <text class="nr-field-line-letter">!</text>
          </g>
          <title>{{ t.required ? 'Required checkpoint' : 'Checkpoint' }}</title>
        </template>
      </g>
      <rect v-if="outlined" :x="outlined.x" :y="outlined.y" :width="outlined.width" :height="outlined.height" class="nr-field-selected" />
      <g
        v-for="s in picture.slots"
        :key="`${s.edge}${s.tile}`"
        :class="{ 'is-live': edgeTool && (!s.taken || (tool === 'road' && isEntry(s))), 'is-picked': movingEntry && isEntry(s) }"
        class="nr-field-slot"
        @click="onSlot(s.edge, s.tile)"
      >
        <rect :x="s.hit.x - s.hit.width / 2" :y="s.hit.y - s.hit.height / 2" :width="s.hit.width" :height="s.hit.height" class="nr-field-slot-hit" />
        <rect :x="s.x - s.width / 2" :y="s.y - s.height / 2" :width="s.width" :height="s.height" rx="1.5" class="nr-field-slot-mark" :class="{ 'is-taken': s.taken }" />
        <text
          v-if="s.label"
          :x="s.x"
          :y="s.y"
          :transform="s.height > s.width ? `rotate(-90 ${s.x} ${s.y})` : undefined"
          class="nr-field-slot-label"
          :style="{ fontSize: `${picture.font}px` }"
        >
          {{ s.label }}
        </text>
      </g>
      <g v-for="g in picture.grow" :key="g.edge" class="nr-field-grow" role="button" :aria-label="growLabel(g.edge)" @pointerdown.stop @click="emit('grow', g.edge)">
        <title>{{ growLabel(g.edge) }}</title>
        <circle :cx="g.x" :cy="g.y" :r="g.radius" />
        <path :d="`M ${g.x - g.radius / 2} ${g.y} H ${g.x + g.radius / 2} M ${g.x} ${g.y - g.radius / 2} V ${g.y + g.radius / 2}`" />
      </g>
      <circle v-for="(m, i) in picture.arrivals" :key="`a${i}`" :cx="m.x" :cy="m.y" r="3.5" class="nr-field-arrival">
        <title>Branch {{ m.line }} enters here</title>
      </circle>
    </svg>
    <p v-if="notice ?? error" class="nr-section-notice first-letter:uppercase" role="status">{{ notice ?? error }}</p>
  </div>
</template>
