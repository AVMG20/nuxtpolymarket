<script setup lang="ts">
import type { PreviewCourse } from '~/utils/nitro-rush/builder-course'
import { BuilderPreview, type BuilderHandle, type PreviewSelection } from '~/utils/nitro-rush/builder-preview'
import { draftTrackDef, pieceAt, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import { draftForkedDef, type ForkedLines } from '#shared/utils/nitro-rush/custom-forks'
import { drawnObstacleDefs } from '#shared/utils/nitro-rush/custom-obstacles'
import { withObstacleDefs } from '#shared/utils/nitro-rush/obstacle-place'
import type { Obstacle } from '#shared/utils/nitro-rush/obstacles'
import { GRID, type LayoutWalk } from '#shared/utils/nitro-rush/layout'

/**
 * The track builder's 3D view of the course. A tap on the road selects its section and a tap elsewhere builds;
 * a right-click takes a section out, and loose road drags about. Lines past the course's are its loose road.
 */
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
    /** Road not joined up yet, drawn as lines after the course's. */
    loose: readonly LayoutWalk[]
    /** The highlighted section of loose road, which stands in for `selected`. */
    looseSelected: { k: number, index: number } | null
    /** The height new road goes down at, which the pointer is read on. */
    planeY: number
    /** The piece about to be built. */
    ghost: LayoutWalk | null
    ghostBlocked: boolean
    /** False for a ghost that follows the pointer: the view holds still for it. */
    ghostReframe?: boolean
    /** Each loose stretch's obstacles, on its own sections. */
    looseObstacles: readonly (readonly Obstacle[])[]
    /** An obstacle about to go down, on the course's lines. */
    obstacleGhost: { obstacle: Obstacle, blocked: boolean } | null
    /** The course's obstacle picked out. */
    obstacleSelected: Obstacle | null
    /** Placing obstacles: a press lays one and holding it down keeps laying them. */
    paint: boolean
    /** Buttons stood on the course, such as the ends loose road connects from. */
    handles: readonly BuilderHandle[]
}>()
/** A section on screen: line `line`, the course's lines first and then each stretch of loose road. */
type Picked = { index: number, line: number }
const emit = defineEmits<{
    hover: [at: { x: number, z: number, onRoad: boolean } | null]
    tap: [picked: Picked | null]
    remove: [picked: Picked]
    /** Loose road `k` dragged `dx`, `dz` metres so far; null when the drag is over. */
    dragging: [drag: { k: number, dx: number, dz: number } | null]
    move: [k: number, dx: number, dz: number]
    /** A press held down while painting, each move while it's held, and letting go. */
    press: []
    stroke: []
    release: []
    handle: [key: string]
}>()

/** Further than this between press and release is an orbit, not a tap. */
const TAP_SLOP_PX = 6

const host = ref<HTMLElement | null>(null)
let preview: BuilderPreview | null = null
let pressed: { x: number, y: number, button: number } | null = null
/** Loose road held for a drag: which, and where on the ground it was taken hold of. */
let held: { k: number, x: number, z: number, y: number, moved: boolean } | null = null
let painting = false

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
const looseCourses = computed<(PreviewCourse | null)[]>(() => props.loose.map((w, k) => {
    const def = draftTrackDef(w, false)
    const obstacles = drawnObstacleDefs(w, props.looseObstacles[k] ?? [], 0)
    return def && { def: obstacles.length ? { ...def, obstacles } : def, lines: w.lines, ends: [w.end], originY: null, openStart: true }
}))

/** The course's obstacles on each drawn line. */
const obstacleDefs = computed(() => props.lines.map((w, l) => drawnObstacleDefs(w, props.track.obstacles ?? [], l, l === 0 ? forked.value?.shift ?? 0 : 0)))

const courses = computed<(PreviewCourse | null)[]>(() => [...courseLines.value, ...looseCourses.value])

const courseLines = computed<(PreviewCourse | null)[]>(() => {
    if (forked.value) {
        const lines = props.lines.flatMap((w, branch) => w.lines.map(b => ({ ...b, at: drawnPoint(branch, b.at), branch })))
        return [{ def: withObstacleDefs(forked.value.def, obstacleDefs.value), lines, ends: ends.value, originY: originY.value }]
    }
    const defs = props.lines.map((w, l) => {
        const def = draftTrackDef(w, l === 0 && props.closes)
        const obstacles = obstacleDefs.value[l]!
        return def && obstacles.length ? { ...def, obstacles } : def
    })
    // Markers go with the first line there is, so a branch with no road yet still shows where it sets off.
    const first = defs.findIndex(d => d)
    // A branch drawn on its own leaves from the road it forks off, so no wall closes its start.
    return defs.map((def, l) => def && { def, lines: props.lines[l]!.lines, ends: l === first ? ends.value : [], originY: l === first ? originY.value : null, openStart: l > 0 })
})

/** The selected section's walk points, the last one running on to where the road ends. */
const selection = computed<PreviewSelection | null>(() => {
    const loose = props.looseSelected
    if (loose) {
        const w = props.loose[loose.k]
        const starts = w?.pieceStarts ?? []
        if (!w || loose.index >= starts.length) return null
        return { line: props.lines.length + loose.k, range: [starts[loose.index]!, starts[loose.index + 1] ?? w.pts.length] }
    }
    const i = props.selected
    const walk = props.lines[props.line]
    const starts = walk?.pieceStarts ?? []
    if (!walk || i === null || i < 0 || i >= starts.length) return null
    const from = drawnPoint(props.line, starts[i]!)
    return { line: props.line, range: [from, from + (starts[i + 1] ?? walk.pts.length) - starts[i]!] }
})

/** The section under a spot on screen, if any. */
function pickAt(clientX: number, clientY: number): Picked | null {
    const at = preview?.pick(clientX, clientY)
    const walk = at && (props.lines[at.line] ?? props.loose[at.line - props.lines.length])
    if (!at || !walk?.pieceStarts.length) return null
    const shift = at.line === 0 ? forked.value?.shift ?? 0 : 0
    return { index: pieceAt(walk, (at.point + shift) % walk.pts.length), line: at.line }
}

/** Metres a drag has moved loose road, on the grid. */
const snapped = (v: number) => Math.round(v / GRID) * GRID

function onPointerDown(e: PointerEvent) {
    pressed = e.isPrimary ? { x: e.clientX, y: e.clientY, button: e.button } : null
    held = null
    if (!pressed || e.button !== 0 || !preview) return
    if (props.paint) {
        painting = true
        preview.setOrbit(false)
        hover(e)
        emit('press')
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        return
    }
    const picked = pickAt(e.clientX, e.clientY)
    const k = picked ? picked.line - props.lines.length : -1
    const w = props.loose[k]
    if (!w) return
    // Held at its own height, so the road stays under the pointer as it goes.
    const y = w.ys[0]! - w.lifts[0]!
    const at = preview.groundAt(e.clientX, e.clientY, y)
    if (!at) return
    held = { k, ...at, y, moved: false }
    preview.setOrbit(false)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
    if (!preview) return
    if (held) {
        const at = preview.groundAt(e.clientX, e.clientY, held.y)
        if (!at) return
        const dx = snapped(at.x - held.x)
        const dz = snapped(at.z - held.z)
        held.moved ||= dx !== 0 || dz !== 0
        if (held.moved) emit('dragging', { k: held.k, dx, dz })
        return
    }
    hover(e)
    if (painting) emit('stroke')
}

/** The pointer onto the ground: over the road it picks, off it it builds. On the road it reads the road's own height. */
function hover(e: PointerEvent) {
    if (!preview) return
    const road = preview.roadAt(e.clientX, e.clientY)
    const at = road ?? preview.groundAt(e.clientX, e.clientY, props.planeY)
    emit('hover', at && { x: at.x, z: at.z, onRoad: !!road || !!pickAt(e.clientX, e.clientY) })
}

function onPointerUp(e: PointerEvent) {
    const press = pressed
    pressed = null
    if (painting) {
        painting = false
        preview?.setOrbit(true)
        emit('release')
        return
    }
    if (held) {
        const h = held
        held = null
        preview?.setOrbit(true)
        const at = preview?.groundAt(e.clientX, e.clientY, h.y)
        emit('dragging', null)
        if (h.moved && at) {
            emit('move', h.k, snapped(at.x - h.x), snapped(at.z - h.z))
            return
        }
    }
    if (!press || !preview || Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP_PX) return
    const picked = pickAt(e.clientX, e.clientY)
    if (press.button === 2) {
        if (picked) emit('remove', picked)
    } else if (press.button === 0) {
        // A touch has no hover before it, so the spot it builds on is read now.
        hover(e)
        emit('tap', picked)
    }
}

function onPointerLeave() {
    if (!held && !painting) emit('hover', null)
}

/** The handles' buttons, moved every frame to follow the camera. */
const handleEls: (HTMLElement | null)[] = []
function setHandleEl(i: number, el: unknown) {
    handleEls[i] = el instanceof HTMLElement ? el : null
}
function placeHandles() {
    props.handles.forEach((h, i) => {
        const el = handleEls[i]
        if (!el) return
        const at = preview?.project(h.x, h.y, h.z)
        el.style.display = at ? '' : 'none'
        if (at) el.style.transform = `translate(${at.left}px, ${at.top}px)`
    })
}

function resetView() {
    preview?.resetView()
}

/** The ghost as a course to draw, with where it ends. */
const ghostCourse = computed(() => {
    const def = props.ghost && draftTrackDef(props.ghost, false)
    return def ? { def, end: props.ghost!.end, blocked: props.ghostBlocked, reframe: props.ghostReframe } : null
})

/** The obstacle ghost on its drawn line. */
const obstacleGhostDef = computed(() => {
    const g = props.obstacleGhost
    const w = g && props.lines[g.obstacle.line]
    const def = w && drawnObstacleDefs(w, [g.obstacle], g.obstacle.line, g.obstacle.line === 0 ? forked.value?.shift ?? 0 : 0)[0]
    return def ? { line: g!.obstacle.line, def, blocked: g!.blocked } : null
})

watch(courses, (c) => {
    preview?.setCourse(c, selection.value)
    preview?.setObstacleGhost(obstacleGhostDef.value)
})
watch(obstacleGhostDef, g => preview?.setObstacleGhost(g))

/** The picked obstacle on its drawn line. */
const obstaclePickedDef = computed(() => {
    const o = props.obstacleSelected
    const w = o && props.lines[o.line]
    const def = w && drawnObstacleDefs(w, [o], o.line, o.line === 0 ? forked.value?.shift ?? 0 : 0)[0]
    return def ? { line: o!.line, def } : null
})
watch(courses, () => preview?.setObstaclePicked(obstaclePickedDef.value), { flush: 'post' })
watch(obstaclePickedDef, p => preview?.setObstaclePicked(p))
watch(selection, s => preview?.setSelected(s))
watch(ghostCourse, g => preview?.setGhost(g))

onMounted(() => {
    preview = new BuilderPreview(host.value!)
    preview.setCourse(courses.value, selection.value)
    preview.setGhost(ghostCourse.value)
    preview.setObstaclePicked(obstaclePickedDef.value)
    preview.onFrame = placeHandles
})

onBeforeUnmount(() => {
    preview?.dispose()
    preview = null
})
</script>

<template>
  <div>
    <!-- No position class on the root: the builder places it, and `relative` would override that and collapse it. -->
    <div
      ref="host"
      class="absolute inset-0 cursor-crosshair"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
      @contextmenu.prevent
    />
    <button
      v-for="(h, i) in handles"
      :key="h.key"
      :ref="el => setHandleEl(i, el)"
      class="nr-handle"
      style="left: 0; top: 0"
      :aria-label="h.label"
      :title="h.label"
      @click="emit('handle', h.key)"
    >
      <UIcon :name="h.icon" class="size-3.5" />
    </button>
    <button class="nr-icon-btn absolute left-3 top-3" aria-label="Frame the whole track" title="Frame the whole track" @click="resetView">
      <UIcon name="i-lucide-scan" class="size-4" />
    </button>
  </div>
</template>
