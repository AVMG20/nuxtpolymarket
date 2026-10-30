<script setup lang="ts">
import { BuilderPreview, type PreviewCourse } from '~/utils/nitro-rush/builder-preview'
import { draftTrackDef, pieceAt } from '#shared/utils/nitro-rush/custom'
import type { LayoutWalk } from '#shared/utils/nitro-rush/layout'

/** The track builder's 3D view of the course; a tap on the road selects its section. */
const props = defineProps<{
    walk: LayoutWalk
    /** A loop that already meets its start line. */
    closes: boolean
    /** Loops show where the road has to come back to. */
    loop: boolean
    selected: number | null
}>()
const emit = defineEmits<{ pick: [index: number] }>()

/** Further than this between press and release is an orbit, not a tap. */
const TAP_SLOP_PX = 6

const host = ref<HTMLElement | null>(null)
let preview: BuilderPreview | null = null
let pressed: { x: number, y: number } | null = null

const course = computed<PreviewCourse | null>(() => {
    const def = draftTrackDef(props.walk, props.closes)
    if (!def) return null
    return { def, lines: props.walk.lines, end: props.closes ? null : props.walk.end, showOrigin: props.loop && !props.closes }
})

/** The selected section's walk points, the last one running on to where the road ends. */
const range = computed<[number, number] | null>(() => {
    const i = props.selected
    const starts = props.walk.pieceStarts
    if (i === null || i < 0 || i >= starts.length) return null
    return [starts[i]!, starts[i + 1] ?? props.walk.pts.length]
})

function onPointerDown(e: PointerEvent) {
    pressed = e.isPrimary ? { x: e.clientX, y: e.clientY } : null
}

function onPointerUp(e: PointerEvent) {
    if (!pressed || !preview || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > TAP_SLOP_PX) return
    pressed = null
    const at = preview.pick(e.clientX, e.clientY)
    if (at !== null) emit('pick', pieceAt(props.walk, at))
}

function resetView() {
    preview?.resetView()
}

watch(course, c => preview?.setCourse(c, range.value))
watch(range, r => preview?.setSelected(r))

onMounted(() => {
    preview = new BuilderPreview(host.value!)
    preview.setCourse(course.value, range.value)
})

onBeforeUnmount(() => {
    preview?.dispose()
    preview = null
})
</script>

<template>
  <div>
    <!-- No position class on the root: the builder places it, and `relative` would override that and collapse it. -->
    <div ref="host" class="absolute inset-0 cursor-grab active:cursor-grabbing" @pointerdown="onPointerDown" @pointerup="onPointerUp" />
    <button class="nr-icon-btn absolute left-3 top-3" aria-label="Frame the whole track" title="Frame the whole track" @click="resetView">
      <UIcon name="i-lucide-scan" class="size-4" />
    </button>
  </div>
</template>
