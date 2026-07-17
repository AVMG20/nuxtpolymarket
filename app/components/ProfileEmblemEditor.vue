<script setup lang="ts">
import {
  EMBLEM_MAX_ELEMENTS,
  EMBLEM_MAX_POINTS_PER_STROKE,
  emblemPolygonPoints,
  emblemStarPoints,
  parseEmblem,
  type EmblemData,
  type EmblemElement,
  type EmblemPlacedShape,
  type EmblemPoint,
  type EmblemShape,
  type EmblemStroke
} from '#shared/utils/emblem'

const props = defineProps<{
  modelValue?: unknown
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: EmblemData]
  save: [value: EmblemData]
}>()

type Tool = 'pencil' | EmblemShape

const palette = ['#ffffff', '#111827', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']
const canvas = ref<SVGSVGElement | null>(null)
const tool = ref<Tool>('pencil')
const color = ref('#ffffff')
const brushSize = ref(6)
const shapeSize = ref(34)
const shapeRotation = ref(0)
const drawing = ref(false)
const activeStroke = ref<EmblemStroke | null>(null)
const history = ref<EmblemElement[][]>([])
const hoverPoint = ref<EmblemPoint | null>(null)

watch(tool, (next) => {
  shapeRotation.value = next === 'square' ? 45 : 0
})

const previewShape = computed<EmblemPlacedShape | null>(() => {
  if (tool.value === 'pencil' || !hoverPoint.value || emblem.elements.length >= EMBLEM_MAX_ELEMENTS) return null
  const [x, y] = hoverPoint.value
  return {
    kind: 'shape',
    shape: tool.value,
    color: color.value,
    x,
    y,
    size: shapeSize.value,
    rotation: shapeRotation.value
  }
})

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const initial = parseEmblem(props.modelValue)
const emblem = reactive<EmblemData>(initial
  ? clone(initial)
  : { version: 1, background: '#312e81', elements: [] })

watch(() => props.modelValue, (value) => {
  const next = parseEmblem(value)
  if (!next || JSON.stringify(next) === JSON.stringify(emblem)) return
  Object.assign(emblem, clone(next))
  history.value = []
})

function snapshot() {
  history.value.push(clone(emblem.elements))
  if (history.value.length > 30) history.value.shift()
}

function changed() {
  emit('update:modelValue', clone(emblem))
}

function pointFromEvent(event: PointerEvent): EmblemPoint {
  const rect = canvas.value!.getBoundingClientRect()
  return [
    Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
  ]
}

function pointerDown(event: PointerEvent) {
  if (!canvas.value || emblem.elements.length >= EMBLEM_MAX_ELEMENTS) return
  canvas.value.setPointerCapture(event.pointerId)
  const [x, y] = pointFromEvent(event)
  snapshot()

  if (tool.value === 'pencil') {
    const stroke: EmblemStroke = {
      kind: 'stroke',
      color: color.value,
      width: brushSize.value,
      points: [[x, y]]
    }
    emblem.elements.push(stroke)
    activeStroke.value = stroke
    drawing.value = true
    return
  }

  emblem.elements.push({
    kind: 'shape',
    shape: tool.value,
    color: color.value,
    x,
    y,
    size: shapeSize.value,
    rotation: shapeRotation.value
  })
  changed()
}

function wheelRotate(event: WheelEvent) {
  if (tool.value === 'pencil' || (!event.metaKey && !event.altKey)) return
  event.preventDefault()
  const delta = event.deltaY > 0 ? -5 : 5
  shapeRotation.value = Math.max(-180, Math.min(180, shapeRotation.value + delta))
}

function pointerMove(event: PointerEvent) {
  const next = pointFromEvent(event)
  hoverPoint.value = next
  if (!drawing.value || !activeStroke.value) return
  const last = activeStroke.value.points.at(-1)!
  if (Math.hypot(next[0] - last[0], next[1] - last[1]) < 1.2) return
  if (activeStroke.value.points.length < EMBLEM_MAX_POINTS_PER_STROKE) activeStroke.value.points.push(next)
}

function pointerLeave() {
  hoverPoint.value = null
}

function pointerUp(event: PointerEvent) {
  if (canvas.value?.hasPointerCapture(event.pointerId)) canvas.value.releasePointerCapture(event.pointerId)
  if (drawing.value) changed()
  drawing.value = false
  activeStroke.value = null
}

function undo() {
  const previous = history.value.pop()
  if (!previous) return
  emblem.elements = previous
  changed()
}

function clear() {
  if (!emblem.elements.length) return
  snapshot()
  emblem.elements = []
  changed()
}

function setBackground(value: string) {
  emblem.background = value
  changed()
}

function save() {
  emit('save', clone(emblem))
}

defineShortcuts({
  meta_z: undo,
  meta_s: save,
  d: () => { tool.value = 'pencil' },
  '1': () => { tool.value = 'circle' },
  '2': () => { tool.value = 'square' },
  '3': () => { tool.value = 'triangle' },
  '4': () => { tool.value = 'star' },
  delete: clear
})
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[minmax(260px,420px)_1fr]">
    <div class="mx-auto w-full max-w-[420px]">
      <div class="relative aspect-square overflow-hidden rounded-full border-4 border-default bg-elevated shadow-lg">
        <ProfileEmblem :emblem="emblem" class="size-full border-0" />
        <svg
          ref="canvas"
          aria-label="Profile emblem drawing canvas"
          class="absolute inset-0 size-full cursor-crosshair touch-none rounded-full"
          role="img"
          viewBox="0 0 100 100"
          @pointercancel="pointerUp"
          @pointerdown="pointerDown"
          @pointerleave="pointerLeave"
          @pointermove="pointerMove"
          @pointerup="pointerUp"
          @wheel="wheelRotate"
        >
          <g pointer-events="none">
            <circle
              v-if="tool === 'pencil' && hoverPoint"
              :cx="hoverPoint[0]"
              :cy="hoverPoint[1]"
              :r="brushSize / 2"
              :fill="color"
              fill-opacity="0.4"
              :stroke="color"
              stroke-width="0.5"
            />
            <circle
              v-else-if="previewShape && previewShape.shape === 'circle'"
              :cx="previewShape.x"
              :cy="previewShape.y"
              :r="previewShape.size / 2"
              :fill="previewShape.color"
              opacity="0.5"
            />
            <rect
              v-else-if="previewShape && previewShape.shape === 'square'"
              :fill="previewShape.color"
              :height="previewShape.size"
              opacity="0.5"
              rx="2"
              :transform="`rotate(${previewShape.rotation} ${previewShape.x} ${previewShape.y})`"
              :width="previewShape.size"
              :x="previewShape.x - previewShape.size / 2"
              :y="previewShape.y - previewShape.size / 2"
            />
            <polygon
              v-else-if="previewShape && previewShape.shape === 'star'"
              :fill="previewShape.color"
              opacity="0.5"
              :points="emblemStarPoints(previewShape)"
            />
            <polygon
              v-else-if="previewShape"
              :fill="previewShape.color"
              opacity="0.5"
              :points="emblemPolygonPoints(previewShape)"
            />
          </g>
        </svg>
      </div>
      <p class="mt-3 text-center text-xs text-muted">Draw or tap to place shapes. Your emblem is cropped to a circle everywhere.</p>
    </div>

    <div class="space-y-5">
      <UFormField label="Tool" description="Choose the pencil or a shape, then use the canvas.">
        <div class="flex flex-wrap gap-2">
          <UButton
            :color="tool === 'pencil' ? 'primary' : 'neutral'"
            icon="i-lucide-pencil"
            :variant="tool === 'pencil' ? 'solid' : 'outline'"
            @click="tool = 'pencil'"
          >
            <span>Draw</span>
            <template #trailing><UKbd size="sm" value="D" /></template>
          </UButton>
          <UButton
            v-for="(shape, index) in (['circle', 'square', 'triangle', 'star'] as EmblemShape[])"
            :key="shape"
            :color="tool === shape ? 'primary' : 'neutral'"
            :icon="shape === 'circle' ? 'i-lucide-circle' : shape === 'square' ? 'i-lucide-square' : shape === 'triangle' ? 'i-lucide-triangle' : 'i-lucide-star'"
            :variant="tool === shape ? 'solid' : 'outline'"
            @click="tool = shape"
          >
            <span>{{ shape.charAt(0).toUpperCase() + shape.slice(1) }}</span>
            <template #trailing><UKbd size="sm" :value="String(index + 1)" /></template>
          </UButton>
        </div>
      </UFormField>

      <UFormField label="Paint color">
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="swatch in palette"
            :key="swatch"
            :aria-label="`Use ${swatch}`"
            :class="color === swatch ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''"
            :style="{ backgroundColor: swatch }"
            class="size-8 rounded-full border border-default transition-transform hover:scale-110"
            type="button"
            @click="color = swatch"
          />
          <label class="relative flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-default bg-elevated" title="Custom color">
            <UIcon name="i-lucide-pipette" class="pointer-events-none size-4" />
            <input v-model="color" aria-label="Custom paint color" class="absolute inset-0 cursor-pointer opacity-0" type="color">
          </label>
        </div>
      </UFormField>

      <UFormField label="Background color">
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="swatch in palette"
            :key="swatch"
            :aria-label="`Use ${swatch} as background`"
            :class="emblem.background === swatch ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''"
            :style="{ backgroundColor: swatch }"
            class="size-8 rounded-full border border-default transition-transform hover:scale-110"
            type="button"
            @click="setBackground(swatch)"
          />
          <label class="relative flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-default bg-elevated" title="Custom background color">
            <UIcon name="i-lucide-pipette" class="pointer-events-none size-4" />
            <input :value="emblem.background" aria-label="Custom background color" class="absolute inset-0 cursor-pointer opacity-0" type="color" @input="setBackground(($event.target as HTMLInputElement).value)">
          </label>
        </div>
      </UFormField>

      <UFormField :label="tool === 'pencil' ? 'Brush size' : 'Shape size'">
        <USlider v-if="tool === 'pencil'" v-model="brushSize" :max="18" :min="1" :step="1" />
        <USlider v-else v-model="shapeSize" :max="80" :min="8" :step="1" />
      </UFormField>

      <UFormField v-if="tool !== 'pencil'" label="Shape rotation" description="Hold ⌘ or Alt and scroll over the canvas to rotate.">
        <USlider v-model="shapeRotation" :max="180" :min="-180" :step="1" />
      </UFormField>

      <div class="flex flex-wrap gap-2 border-t border-default pt-5">
        <UButton color="neutral" icon="i-lucide-undo-2" variant="outline" :disabled="!history.length" @click="undo">
          <span>Undo</span>
          <template #trailing><div class="flex gap-0.5"><UKbd size="sm" value="meta" /><UKbd size="sm" value="Z" /></div></template>
        </UButton>
        <UButton color="neutral" icon="i-lucide-trash-2" variant="outline" :disabled="!emblem.elements.length" @click="clear">
          <span>Clear</span>
          <template #trailing><UKbd size="sm" value="delete" /></template>
        </UButton>
        <UButton class="sm:ml-auto" icon="i-lucide-save" :loading="loading" @click="save">
          <span>Save emblem</span>
          <template #trailing><div class="flex gap-0.5"><UKbd size="sm" value="meta" /><UKbd size="sm" value="S" /></div></template>
        </UButton>
      </div>
      <p class="text-xs text-muted">{{ emblem.elements.length }}/{{ EMBLEM_MAX_ELEMENTS }} marks used</p>
    </div>
  </div>
</template>
