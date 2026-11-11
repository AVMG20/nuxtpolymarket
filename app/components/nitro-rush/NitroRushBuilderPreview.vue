<script setup lang="ts">
import type { PreviewCourse } from '~/utils/nitro-rush/builder-course'
import { BuilderPreview, type PreviewSelection } from '~/utils/nitro-rush/builder-preview'
import { draftTrackDef, pieceAt, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import { draftForkedDef, type ForkedLines } from '#shared/utils/nitro-rush/custom-forks'
import type { LayoutWalk } from '#shared/utils/nitro-rush/layout'

/** The track builder's 3D view of the course; a tap on the road selects its section. */
const props = defineProps<{
    /** The course's splits and joins; its sections are in `lines`. */
    track: CustomTrack
    /** The lines as walked, before any ghost lifts them. */
    forks: ForkedLines
    /** The main road first, then each branch. */
    lines: readonly LayoutWalk[]
    /** The line being built on. */
    line: number
    /** A loop that already meets its start line. */
    closes: boolean
    /** Loops show where the road has to come back to. */
    loop: boolean
    /** Lines whose end already meets the road they join. */
    ended: readonly boolean[]
    /** The highlighted section, on the line being built on. */
    selected: number | null
    /** The piece about to be built. */
    ghost: LayoutWalk | null
    ghostBlocked: boolean
}>()
const emit = defineEmits<{ pick: [index: number, line: number] }>()

/** Further than this between press and release is an orbit, not a tap. */
const TAP_SLOP_PX = 6

const host = ref<HTMLElement | null>(null)
let preview: BuilderPreview | null = null
let pressed: { x: number, y: number } | null = null

/** Where each line still open goes on from. */
const ends = computed(() => props.lines.flatMap((w, l) => (l === 0 ? props.closes : props.ended[l]) ? [] : [w.end]))
const originY = computed(() => props.loop && !props.closes ? props.lines[0]!.rise : null)

/** The course as one forked draft, once its branches fit together. */
const forked = computed(() => draftForkedDef(props.track, { ...props.forks, walks: [...props.lines] }, props.closes))
/** Walk point `i` of line `l` as the drawn course counts it: a forked loop's main line begins at its start line. */
function drawnPoint(l: number, i: number) {
    const shift = l === 0 ? forked.value?.shift ?? 0 : 0
    const n = props.lines[0]!.pts.length
    return shift ? (i - shift + n) % n : i
}

/** The whole course with its forks opened up once its branches fit together; until then each line on its own, null where there's no road yet. */
const courses = computed<(PreviewCourse | null)[]>(() => {
    if (forked.value) {
        const lines = props.lines.flatMap((w, branch) => w.lines.map(b => ({ ...b, at: drawnPoint(branch, b.at), branch })))
        return [{ def: forked.value.def, lines, ends: ends.value, originY: originY.value }]
    }
    const defs = props.lines.map((w, l) => draftTrackDef(w, l === 0 && props.closes))
    // Markers go with the first line there is, so a branch with no road yet still shows where it sets off.
    const first = defs.findIndex(d => d)
    // A branch drawn on its own leaves from the road it forks off, so no wall closes its start.
    return defs.map((def, l) => def && { def, lines: props.lines[l]!.lines, ends: l === first ? ends.value : [], originY: l === first ? originY.value : null, openStart: l > 0 })
})

/** The selected section's walk points, the last one running on to where the road ends. */
const selection = computed<PreviewSelection | null>(() => {
    const i = props.selected
    const walk = props.lines[props.line]
    const starts = walk?.pieceStarts ?? []
    if (!walk || i === null || i < 0 || i >= starts.length) return null
    const from = drawnPoint(props.line, starts[i]!)
    return { line: props.line, range: [from, from + (starts[i + 1] ?? walk.pts.length) - starts[i]!] }
})

function onPointerDown(e: PointerEvent) {
    pressed = e.isPrimary ? { x: e.clientX, y: e.clientY } : null
}

function onPointerUp(e: PointerEvent) {
    if (!pressed || !preview || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > TAP_SLOP_PX) return
    pressed = null
    const at = preview.pick(e.clientX, e.clientY)
    const walk = at && props.lines[at.line]
    if (!at || !walk?.pieceStarts.length) return
    const shift = at.line === 0 ? forked.value?.shift ?? 0 : 0
    emit('pick', pieceAt(walk, (at.point + shift) % walk.pts.length), at.line)
}

function resetView() {
    preview?.resetView()
}

/** The ghost as a course to draw, with where it ends. */
const ghostCourse = computed(() => {
    const def = props.ghost && draftTrackDef(props.ghost, false)
    return def ? { def, end: props.ghost!.end, blocked: props.ghostBlocked } : null
})

watch(courses, c => preview?.setCourse(c, selection.value))
watch(selection, s => preview?.setSelected(s))
watch(ghostCourse, g => preview?.setGhost(g))

onMounted(() => {
    preview = new BuilderPreview(host.value!)
    preview.setCourse(courses.value, selection.value)
    preview.setGhost(ghostCourse.value)
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
