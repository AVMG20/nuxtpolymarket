<script setup lang="ts">
import type { SectionSpot } from '#shared/utils/nitro-rush/custom'
import type { FieldTool, GrowEdge } from '#shared/utils/nitro-rush/field-edit'
import { FIELD_TILE, type FieldDir, type FieldEdge, type FieldPlan, type FieldPort } from '#shared/utils/nitro-rush/field'
import type { WalkedFieldSection } from '#shared/utils/nitro-rush/field-group'
import { fieldEditorPicture, pictureTile } from '~/utils/nitro-rush/field-editor'

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
}>()
const emit = defineEmits<{
    tool: [spot: SectionSpot, col: number, row: number, tool: FieldTool, painting: boolean, facing: FieldDir]
    resize: [width: number, length: number]
    exit: [port: FieldPort]
    road: [port: FieldPort]
    grow: [edge: GrowEdge]
}>()

type Tool = FieldTool | 'exit' | 'road'
const TOOLS: { id: Tool, icon: string, label: string, hint: string }[] = [
    { id: 'boost', icon: 'i-lucide-chevrons-up', label: 'Boost', hint: 'Tap a tile for a boost pad; tap it again to turn it.' },
    { id: 'checkpoint', icon: 'i-lucide-milestone', label: 'Gate', hint: 'Tap a tile for a checkpoint gate; tap it again to turn it.' },
    { id: 'block', icon: 'i-lucide-square', label: 'Block', hint: 'Tap or drag across tiles to wall them off.' },
    { id: 'pillar', icon: 'i-lucide-circle-dot', label: 'Pillar', hint: 'Tap a tile for a pillar to steer round.' },
    { id: 'erase', icon: 'i-lucide-eraser', label: 'Erase', hint: 'Tap or drag across tiles to clear them.' },
    { id: 'exit', icon: 'i-lucide-git-branch', label: 'Branch', hint: 'Tap a slot on the highlighted field\'s edge to start a new road out.' },
    { id: 'road', icon: 'i-lucide-route', label: 'Move exit', hint: 'Tap a slot on the highlighted field\'s edge to move where the road leaves.' }
]
const tool = ref<Tool>('boost')
const current = computed(() => TOOLS.find(t => t.id === tool.value)!)
const edgeTool = computed(() => tool.value === 'exit' || tool.value === 'road')

const selectedIndex = computed(() => Math.max(0, props.group.findIndex(f => f.spot.branch === props.selected.branch && f.spot.at === props.selected.at)))
const picture = computed(() => fieldEditorPicture(props.group, selectedIndex.value, props.ports, props.arrivals, props.grows))
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
    const at = tileAt(e)
    if (!at) return
    emit('tool', at.spot, at.col, at.row, tool.value as FieldTool, false, at.facing)
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
    emit('tool', at.spot, at.col, at.row, tool.value as FieldTool, true, at.facing)
}

function onUp() {
    painted = null
}

function onSlot(edge: FieldEdge, tile: number) {
    if (tool.value === 'exit') emit('exit', { edge, tile })
    else if (tool.value === 'road') emit('road', { edge, tile })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <span class="nr-label">FIELD</span>
      <div class="nr-toggle is-small is-row flex-wrap" role="radiogroup" aria-label="Field tool">
        <button
          v-for="t in TOOLS"
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
      <NitroRushBuilderFieldSize :width="plan.width" :length="plan.length" @change="(w, l) => emit('resize', w, l)" />
    </div>
    <p class="nr-field-hint">
      {{ current.hint }}
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
        <circle v-else-if="t.kind === 'pillar'" r="4" class="nr-field-block" />
        <g v-else :transform="`rotate(${t.turn})`">
          <template v-if="t.kind === 'boost'">
            <rect x="-8" y="-8" width="16" height="16" rx="2" class="nr-field-pad" />
            <path d="M -5 2 L 0 -4 L 5 2 M -5 7 L 0 1 L 5 7" class="nr-field-arrow" />
          </template>
          <template v-else>
            <line x1="-10" y1="0" x2="10" y2="0" class="nr-field-gate" />
            <path d="M -4 0 L 0 -6 L 4 0" class="nr-field-arrow is-gate" />
          </template>
        </g>
      </g>
      <rect v-if="outlined" :x="outlined.x" :y="outlined.y" :width="outlined.width" :height="outlined.height" class="nr-field-selected" />
      <g v-for="s in picture.slots" :key="`${s.edge}${s.tile}`" :class="{ 'is-live': edgeTool && !s.taken }" class="nr-field-slot" @click="onSlot(s.edge, s.tile)">
        <rect :x="s.x - s.width / 2" :y="s.y - s.height / 2" :width="s.width" :height="s.height" rx="1.5" :class="{ 'is-taken': s.taken }" />
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
    <p v-if="error" class="nr-section-notice first-letter:uppercase" role="status">{{ error }}</p>
  </div>
</template>
