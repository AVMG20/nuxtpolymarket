<script setup lang="ts">
import type { FieldTool } from '#shared/utils/nitro-rush/field-edit'
import { edgeTiles, FIELD_EDGES, FIELD_TILE, portLocal, type FieldEdge, type FieldPlan, type FieldPort } from '#shared/utils/nitro-rush/field'

/** The highlighted field from above, its entry at the bottom: tap a tile to place or turn an item, drag to paint, tap an edge to add a road out. */
const props = defineProps<{
    plan: FieldPlan
    /** Each road that leaves the field through a port, with its line. */
    ports: readonly { line: number, port: FieldPort }[]
    /** Where each road meets the field, in its (u, v), with its line. */
    mouths: readonly { line: number, u: number, v: number }[]
    /** Why the last edit didn't go in. */
    error: string | null
}>()
const emit = defineEmits<{
    tool: [col: number, row: number, tool: FieldTool, painting: boolean]
    resize: [width: number, length: number]
    exit: [port: FieldPort]
    road: [port: FieldPort]
}>()

type Tool = FieldTool | 'exit' | 'road'
const TOOLS: { id: Tool, icon: string, label: string }[] = [
    { id: 'boost', icon: 'i-lucide-chevrons-up', label: 'Boost pad (tap again to turn)' },
    { id: 'checkpoint', icon: 'i-lucide-milestone', label: 'Gate (tap again to turn)' },
    { id: 'block', icon: 'i-lucide-square', label: 'Block: drag to paint' },
    { id: 'pillar', icon: 'i-lucide-circle-dot', label: 'Pillar' },
    { id: 'exit', icon: 'i-lucide-git-branch', label: 'New branch: tap an edge' },
    { id: 'road', icon: 'i-lucide-route', label: 'Move exit: tap an edge' },
    { id: 'erase', icon: 'i-lucide-eraser', label: 'Erase: drag to clear' }
]
const tool = ref<Tool>('boost')
const edgeTool = computed(() => tool.value === 'exit' || tool.value === 'road')

/** Metres round the field for its edge slots. */
const MARGIN = 14
const SLOT = 8
const svg = ref<SVGSVGElement | null>(null)
const viewBox = computed(() => `${-MARGIN} ${-MARGIN} ${props.plan.width + MARGIN * 2} ${props.plan.length + MARGIN * 2}`)
const cols = computed(() => props.plan.width / FIELD_TILE)
const rows = computed(() => props.plan.length / FIELD_TILE)
/** The entry edge is at the bottom, so v runs up the picture. */
const py = (v: number) => props.plan.length - v

/** Each item's corner in the picture, and its turn in degrees: a quarter turn of `dir` is clockwise there too. */
const tiles = computed(() => props.plan.tiles.map(t => ({ ...t, x: t.col * FIELD_TILE, y: py((t.row + 1) * FIELD_TILE), turn: 'dir' in t ? t.dir * 90 : 0 })))

/** Every edge slot a road could meet the field at, with the road there now, if any. */
const slots = computed(() => FIELD_EDGES.flatMap(edge => Array.from({ length: edgeTiles(props.plan, edge) }, (_, tile) => {
    const { u, v } = portLocal(props.plan, { edge, tile })
    const across = edge === 'entry' || edge === 'exit'
    const out = edge === 'entry' || edge === 'left' ? -1 : 1
    const cx = across ? u : u + out * (SLOT / 2 + 1)
    const cy = across ? py(v + out * (SLOT / 2 + 1)) : py(v)
    const isEntry = edge === 'entry' && tile === props.plan.entry
    const isExit = props.plan.exit.edge === edge && props.plan.exit.tile === tile
    const port = props.ports.find(p => p.port.edge === edge && p.port.tile === tile)
    return { edge, tile, cx, cy, across, label: isEntry ? 'IN' : isExit ? 'OUT' : port ? `${port.line}` : '', taken: isEntry || isExit || !!port }
})))

/** Roads that come into the field rather than leaving through a port: where they land. */
const arrivals = computed(() => props.mouths.filter(m => m.line > 0 && !props.ports.some(p => p.line === m.line)))

/** The tile under a pointer, or null off the field. */
function tileAt(e: PointerEvent) {
    const m = svg.value?.getScreenCTM()
    if (!m) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    const col = Math.floor(p.x / FIELD_TILE)
    const row = Math.floor((props.plan.length - p.y) / FIELD_TILE)
    return col >= 0 && row >= 0 && col < cols.value && row < rows.value ? { col, row } : null
}

/** Tiles painted on this drag, so each gets the tool once. */
let painted: Set<string> | null = null

function onDown(e: PointerEvent) {
    if (edgeTool.value || !e.isPrimary) return
    const at = tileAt(e)
    if (!at) return
    emit('tool', at.col, at.row, tool.value as FieldTool, false)
    if (tool.value === 'block' || tool.value === 'erase') {
        painted = new Set([`${at.col},${at.row}`])
        svg.value?.setPointerCapture(e.pointerId)
    }
}

function onMove(e: PointerEvent) {
    if (!painted) return
    const at = tileAt(e)
    const key = at && `${at.col},${at.row}`
    if (!at || painted.has(key!)) return
    painted.add(key!)
    emit('tool', at.col, at.row, tool.value as FieldTool, true)
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
      <div class="nr-toggle is-small is-row" role="radiogroup" aria-label="Field tool">
        <button
          v-for="t in TOOLS"
          :key="t.id"
          role="radio"
          :aria-checked="tool === t.id"
          :aria-label="t.label"
          :title="t.label"
          :class="{ 'is-active': tool === t.id }"
          @click="tool = t.id"
        >
          <UIcon :name="t.icon" class="size-4" />
        </button>
      </div>
      <NitroRushBuilderFieldSize :width="plan.width" :length="plan.length" @change="(w, l) => emit('resize', w, l)" />
    </div>
    <svg
      ref="svg"
      class="nr-field-editor"
      :viewBox="viewBox"
      preserveAspectRatio="xMidYMid meet"
      role="application"
      aria-label="Field tiles"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <rect x="0" y="0" :width="plan.width" :height="plan.length" class="nr-field-floor" />
      <line v-for="c in cols - 1" :key="`c${c}`" :x1="c * FIELD_TILE" y1="0" :x2="c * FIELD_TILE" :y2="plan.length" class="nr-field-grid" />
      <line v-for="r in rows - 1" :key="`r${r}`" x1="0" :y1="r * FIELD_TILE" :x2="plan.width" :y2="r * FIELD_TILE" class="nr-field-grid" />
      <g v-for="t in tiles" :key="`${t.col},${t.row}`" :transform="`translate(${t.x + FIELD_TILE / 2} ${t.y + FIELD_TILE / 2})`">
        <rect v-if="t.kind === 'block'" x="-10" y="-10" width="20" height="20" class="nr-field-block" />
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
      <g v-for="s in slots" :key="`${s.edge}${s.tile}`" :class="{ 'is-live': edgeTool && !s.taken }" class="nr-field-slot" @click="onSlot(s.edge, s.tile)">
        <rect
          :x="s.cx - (s.across ? FIELD_TILE / 2 - 2 : SLOT / 2)"
          :y="s.cy - (s.across ? SLOT / 2 : FIELD_TILE / 2 - 2)"
          :width="s.across ? FIELD_TILE - 4 : SLOT"
          :height="s.across ? SLOT : FIELD_TILE - 4"
          rx="1.5"
          :class="{ 'is-taken': s.taken }"
        />
        <text v-if="s.label" :x="s.cx" :y="s.cy" class="nr-field-slot-label">{{ s.label }}</text>
      </g>
      <circle v-for="(m, i) in arrivals" :key="`a${i}`" :cx="m.u" :cy="py(m.v)" r="3.5" class="nr-field-arrival">
        <title>Branch {{ m.line }} enters here</title>
      </circle>
    </svg>
    <p v-if="error" class="nr-section-notice first-letter:uppercase" role="status">{{ error }}</p>
  </div>
</template>
