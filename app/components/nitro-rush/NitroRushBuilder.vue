<script setup lang="ts">
import { checkpointRoles } from '~/utils/nitro-rush/builder-forks'
import { isTyping } from '~/utils/nitro-rush/input'
import { readStorage, STORAGE_KEYS, writeStorage } from '~/utils/nitro-rush/storage'
import { exportCustomTrack, importCustomTrack, mapWalkHeights, MAX_NAME_LENGTH, MAX_SECTIONS, raisedTo, rideTag, sectionCount, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import type { Curve } from '#shared/utils/nitro-rush/construct'
import { GRID, type LayoutWalk } from '#shared/utils/nitro-rush/layout'
import { endOf, headOf, LEVEL_HEIGHT } from '#shared/utils/nitro-rush/loose-road'
import { obstacleFault, obstacleMarks, obstacleSpotAt } from '#shared/utils/nitro-rush/custom-obstacles'
import { footprint, MAX_OBSTACLES, OBSTACLE_KIND_IDS, OBSTACLE_KINDS, type Obstacle, type ObstacleKind } from '#shared/utils/nitro-rush/obstacles'
import type { BuilderHandle } from '~/utils/nitro-rush/builder-preview'
import { Track } from '#shared/utils/nitro-rush/track'

/** The track builder: lay sections one at a time, or from the drawer, until the course is drivable. */
const props = defineProps<{
    track: CustomTrack
    /** False for a course that isn't stored yet, which has nothing to delete. */
    saved: boolean
    /** Deleting takes down a published copy, and the times set on it go too. */
    clearsTimes: boolean
}>()
const emit = defineEmits<{
    /** Leave the builder; the course comes along when it changed. */
    done: [track: CustomTrack | null]
    drive: [track: CustomTrack]
    delete: [id: string]
}>()

const {
    draft, line, cursor, forks, lines, walk, ground, looseRoad, looseSel, lineClosed, lineSections, compiled, gap, endings, full, canFork, joinable, length, canUndo, finishError,
    walkUpTo, insert, removeAt, moveTo, finishLine, joinAt, removeLine, replace, setClosed, setName, select, selectLine, undo,
    addObstacle, removeObstacle, appendTo, extendLoose, placeLoose, removeLooseAt, shiftLoose, turnLooseBy, mirrorLooseAt, copyLooseAt, deleteLoose, bridge, bridgeAndClose, turnObstacle, selectLoose
} = useNitroRushTrackDraft(toRef(props, 'track'))

/** The course in 3D or the top-down map, remembered in this browser; building is seen best in 3D, so it opens there. */
const remembered = readStorage<{ view: string }>(STORAGE_KEYS.builderView, { view: '3d' })
const view = ref<'map' | '3d'>(remembered.view === 'map' ? 'map' : '3d')
watch(view, v => writeStorage(STORAGE_KEYS.builderView, { view: v }))

/** The drawer with every section; it paints its pictures on mounting, so that waits for the first opening. */
const drawerOpen = ref(false)
const drawerOpened = ref(false)
watch(drawerOpen, () => {
    drawerOpened.value = true
})
const { choice, state, next, shownWalk, ghost, blocked, fault, pick, build } = useNitroRushConstruction({ cursor, walk, closed: lineClosed, full, walkUpTo, insert })

/** A loop whose road already meets its start line. */
const closes = computed(() => draft.value.closed && !!compiled.value.def)
/** Per line, whether its end needs no marker: a branch on the road it joins, or a loop that closes. */
const ended = computed(() => [closes.value, ...endings.value.map(e => e.kind === 'joins')])

const placement = useNitroRushPlacement({ draft, ground, ended, choice, full, appendTo, extendLoose, placeLoose })
/** What the pointer lays: road, or obstacles on the road. */
const tool = ref<'road' | 'obstacles'>('road')
const obstacleKind = ref<ObstacleKind>('barrel')
const obstacleRot = ref<0 | 90>(0)
/** The pointer on the view's ground. */
const pointer = ref<{ x: number, z: number, onRoad: boolean } | null>(null)

function onHover(at: { x: number, z: number, onRoad: boolean } | null) {
    pointer.value = at
    placement.hover.value = tool.value === 'road' ? at : null
}

watch(tool, () => onHover(pointer.value))

/** The obstacle a click would stand on the road under the pointer. */
const obstacleCandidate = computed<Obstacle | null>(() => {
    const p = pointer.value
    if (tool.value !== 'obstacles' || !p) return null
    const spot = obstacleSpotAt(lines.value, -1, p.x, p.z)
    if (!spot) return null
    const o: Obstacle = { kind: obstacleKind.value, ...spot }
    if (obstacleRot.value === 90 && OBSTACLE_KINDS[o.kind].turns) o.rot = 90
    return o
})
/** Why the candidate can't stand there; worked out once per spot, since it compiles the course. */
let faultMemo: { key: string, track: CustomTrack, fault: string | null } | null = null
const obstacleCandidateFault = computed(() => {
    const o = obstacleCandidate.value
    if (!o) return null
    const key = JSON.stringify(o)
    if (faultMemo?.key !== key || faultMemo.track !== draft.value) faultMemo = { key, track: draft.value, fault: obstacleFault(draft.value, o) }
    return faultMemo.fault
})
const obstacleGhost = computed(() => obstacleCandidate.value && { obstacle: obstacleCandidate.value, blocked: !!obstacleCandidateFault.value || (draft.value.obstacles?.length ?? 0) >= MAX_OBSTACLES })
const looseObstacles = computed(() => looseRoad.value.map(r => r.obstacles ?? []))

/** The obstacle nearest the pointer, within `reach` metres of its edge. */
function obstacleUnderPointer(reach = 3) {
    const p = pointer.value
    if (!p) return -1
    let best = -1
    let bestD = reach
    for (const m of obstacleMarks(lines.value, draft.value.obstacles ?? [])) {
        const d = Math.hypot(m.x - p.x, m.z - p.z) - Math.max(m.halfAlong, m.halfAcross)
        if (d < bestD) {
            best = m.index
            bestD = d
        }
    }
    return best
}

/** The course's obstacle picked out with a click, by index. */
const obstacleSel = ref<number | null>(null)
const selectedObstacle = computed(() => obstacleSel.value === null ? null : draft.value.obstacles?.[obstacleSel.value] ?? null)
watch(draft, (t, before) => {
    if ((t.obstacles?.length ?? 0) !== (before.obstacles?.length ?? 0)) obstacleSel.value = null
})
/** Metres a click still picks an obstacle from its edge. */
const PICK_REACH = 1

/** A press held down to lay obstacles, and where it laid the last one. */
let painting: { x: number, z: number } | null | false = false

function onPress() {
    const hit = obstacleUnderPointer(PICK_REACH)
    if (hit >= 0) {
        obstacleSel.value = hit
        painting = false
        return
    }
    obstacleSel.value = null
    painting = null
    paintHere()
}

/** Lays the candidate where the pointer is, once it's clear of the last one laid. */
function paintHere() {
    const o = obstacleCandidate.value
    const p = pointer.value
    if (painting === false || !o || !p || obstacleGhost.value?.blocked) return
    if (painting) {
        const size = footprint(o.kind, o.rot ?? 0)
        if (Math.hypot(p.x - painting.x, p.z - painting.z) < Math.max(size.along, size.across) * 2 + 0.5) return
    }
    addObstacle(o)
    painting = { x: p.x, z: p.z }
}

function onRelease() {
    painting = false
}

/** Loose road being dragged, and how far so far. */
const dragging = ref<{ k: number, dx: number, dz: number } | null>(null)
/** Building with the pointer: its ghost stands in for the controls' while it's over a spot it can build on. */
const pointing = computed(() => !!placement.target.value || !!dragging.value)

/** How far loose road digging in has lifted everything. */
const groundLift = computed(() => ground.value.rise - lines.value[0]!.rise)
/** How far the controls' ghost digging in lifts everything, which only shows while it's the ghost shown. */
const ghostLift = computed(() => pointing.value || looseSel.value || tool.value === 'obstacles' ? 0 : shownWalk.value.rise - walk.value.rise)
const lift = computed(() => Math.max(groundLift.value, ghostLift.value))
/** Every line as shown: a ghost or loose road that digs in lifts the whole course, not just the road it's on. */
const shownLines = computed(() => lines.value.map(w => lift.value ? raisedTo(w, w.rise + lift.value) : w))
const shownLoose = computed(() => {
    const by = lift.value - groundLift.value
    return by ? ground.value.loose.map(w => mapWalkHeights(w, y => y + by)) : ground.value.loose
})

/** A walk moved `dx`, `dz` metres across the map. */
function shifted(w: LayoutWalk, dx: number, dz: number): LayoutWalk {
    return { ...w, pts: w.pts.map(([x, z]) => [x + dx, z + dz]), end: { ...w.end, x: w.end.x + dx, z: w.end.z + dz } }
}

/** What's about to go down, as shown: loose road being dragged, the pointer's piece, or the controls' piece. */
const shownGhost = computed(() => {
    const d = dragging.value
    if (d) {
        const w = shownLoose.value[d.k]
        return w ? { walk: shifted(w, d.dx, d.dz), blocked: false } : null
    }
    if (placement.target.value) {
        const g = placement.ghost.value
        return g ? { walk: g, blocked: placement.blocked.value || !!placement.fault.value } : null
    }
    if (looseSel.value || tool.value === 'obstacles') return null
    const g = ghost.value
    return g ? { walk: ghostLift.value === lift.value ? g : mapWalkHeights(g, y => y + lift.value - ghostLift.value), blocked: blocked.value } : null
})
/** The plane the pointer builds on: the level free road goes down at. */
const planeY = computed(() => placement.level.value * LEVEL_HEIGHT)
const ending = computed(() => line.value ? endings.value[line.value - 1] ?? null : null)

/** The finished course, when it forks: which checkpoints every route drives and how many a lap needs. */
const forked = computed(() => compiled.value.def?.branches ? new Track(compiled.value.def) : null)
const roles = computed(() => forked.value && checkpointRoles(forked.value, walk.value, line.value))
const ROLE_TAGS = { required: 'EVERY ROUTE', optional: 'OPTIONAL' } as const
const tags = computed(() => lineSections.value.map((id, i) => {
    const role = roles.value?.get(i)
    return [rideTag(id, walk.value.states[i]!), role && ROLE_TAGS[role]].filter(Boolean).join(' ')
}))

const dirty = computed(() => draft.value !== props.track)

/** The nearest pair of an open end and loose road's start close enough to lay road between. */
const BRIDGE_RANGE = 300
const bridgeOffer = computed(() => {
    const heads = looseRoad.value.map(r => headOf(r, ground.value.rise))
    let best: { line: number, k: number, metres: number } | null = null
    ground.value.lines.forEach((w, l) => {
        if (ended.value[l]) return
        const end = endOf(w)
        heads.forEach((h, k) => {
            const metres = Math.hypot(h.x - end.x, h.z - end.z)
            if (metres <= BRIDGE_RANGE && (!best || metres < best.metres)) best = { line: l, k, metres }
        })
    })
    return best as { line: number, k: number, metres: number } | null
})
const bridgeError = ref<string | null>(null)
watch(draft, () => {
    bridgeError.value = null
})

/** The open line end nearest loose road `k`'s start, or -1. */
function nearestOpen(k: number) {
    const r = looseRoad.value[k]
    if (!r) return -1
    const h = headOf(r, ground.value.rise)
    let best = -1
    let bestD = Infinity
    ground.value.lines.forEach((w, l) => {
        if (ended.value[l]) return
        const e = endOf(w)
        const d = Math.hypot(h.x - e.x, h.z - e.z)
        if (d < bestD) {
            best = l
            bestD = d
        }
    })
    return best
}

/** Buttons on each stretch of loose road: its start connects it to the road, and on a loop its end closes the loop too. */
const handles = computed<BuilderHandle[]>(() => {
    if (full.value || dragging.value || !ended.value.some(e => !e)) return []
    return shownLoose.value.flatMap((w, k) => {
        const [x, z] = w.pts[0]!
        const out: BuilderHandle[] = [{ key: `head:${k}`, label: 'Connect to the road', icon: 'i-lucide-link', x, y: w.ys[0]! + 2.5, z }]
        if (draft.value.closed && !ended.value[0]) out.push({ key: `tail:${k}`, label: 'Connect it and close the loop', icon: 'i-lucide-refresh-cw', x: w.end.x, y: w.end.y + 2.5, z: w.end.z })
        return out
    })
})

function onHandle(key: string) {
    const [kind, at] = key.split(':')
    const k = Number(at)
    const l = kind === 'tail' ? 0 : nearestOpen(k)
    if (l < 0) return
    if (!(kind === 'tail' ? bridgeAndClose(l, k) : bridge(l, k))) bridgeError.value = finishError.value
}

function connect() {
    const offer = bridgeOffer.value
    if (!offer || full.value) return
    if (!bridge(offer.line, offer.k)) bridgeError.value = finishError.value
}

/** The view's taps: on an end or open ground they build, on road they pick its section. */
function onTap(picked: { index: number, line: number } | null) {
    obstacleSel.value = null
    if (picked && picked.line < lines.value.length) {
        const hit = obstacleUnderPointer(PICK_REACH)
        if (hit >= 0) {
            obstacleSel.value = hit
            return
        }
    }
    if (placement.target.value) {
        placement.place()
        return
    }
    if (!picked) {
        looseSel.value = null
        return
    }
    const k = picked.line - lines.value.length
    if (k >= 0) selectLoose(k, picked.index)
    else select(picked.index, picked.line)
}

function onRemove(picked: { index: number, line: number }) {
    if (tool.value === 'obstacles') {
        const i = obstacleUnderPointer()
        if (i >= 0) removeObstacle(i)
        return
    }
    const k = picked.line - lines.value.length
    if (k >= 0) {
        removeLooseAt(k, picked.index)
    } else {
        select(picked.index, picked.line)
        removeAt(picked.index)
    }
}

function onMove(k: number, dx: number, dz: number) {
    shiftLoose(k, dx, dz)
    selectLoose(k, 0)
}

/** Keys 1 to 7 pick the way the next piece goes, hairpin left to hairpin right. */
const CURVE_KEYS: Curve[] = ['left-180', 'left-90', 'left-45', 'straight', 'right-45', 'right-90', 'right-180']
const { armed, tap } = useNitroRushConfirmTap()

/** What's still wrong with a branch's end, or null when it ends somewhere. */
function branchStatus(l: number) {
    const e = endings.value[l - 1]
    if (e?.kind === 'open') return `Branch ${l} needs ${draft.value.closed ? 'a join' : 'a join or a finish line'}`
    if (e?.kind === 'short') return `Branch ${l} is ${Math.round(e.metres)} m from its join`
    if (e?.kind === 'askew') return `Branch ${l} ${e.why}`
    return null
}

const status = computed(() => {
    if (compiled.value.def) {
        const k = forked.value?.k ?? 0
        const loose = looseRoad.value.length ? ` (loose road left over isn't raced)` : ''
        return { ok: true, text: (k ? `Ready to race: ${k} of ${forked.value!.checkpointCount} checkpoints per lap` : 'Ready to race') + loose }
    }
    if (finishError.value) return { ok: false, text: friendly(`can't finish the ${line.value ? 'branch' : 'loop'}: ${finishError.value}`) }
    const own = line.value ? branchStatus(line.value) : null
    if (own) return { ok: false, text: own }
    const g = gap.value
    if (g && !lines.value[0]!.misplaced && (g.distance > 0.5 || g.turn !== 0 || Math.abs(g.climb) > 0.01 || g.bank !== 0 || g.grade !== 0 || g.width !== 0 || g.air !== 0)) {
        const parts = [`${Math.round(g.distance)} m to go`]
        if (g.turn) parts.push(`turn ${Math.abs(g.turn)}° ${g.turn > 0 ? 'right' : 'left'}`)
        if (Math.abs(g.climb) > 0.01) parts.push(`${Math.round(Math.abs(g.climb))} m ${g.climb > 0 ? 'down' : 'up'}`)
        if (g.bank !== 0) parts.push('level the bank')
        if (g.grade !== 0) parts.push('level the slope')
        if (g.width !== 0) parts.push('set normal width')
        if (g.air !== 0) parts.push('land the jump')
        return { ok: false, text: `Join the road back up to the start: ${parts.join(', ')}` }
    }
    const other = endings.value.map((_, i) => branchStatus(i + 1)).find(t => t)
    if (other) return { ok: false, text: other }
    return { ok: false, text: friendly(compiled.value.error ?? '') }
})

/** The road laid onto its end: the main road back to the start line, or a branch onto the road it joins. */
const finishAction = computed(() => {
    if (compiled.value.def) return null
    if (!line.value) return draft.value.closed && gap.value && gap.value.distance > 0.5 ? { label: 'FINISH THE LOOP', title: 'Lay the road back to the start line' } : null
    return ending.value?.kind === 'short' || ending.value?.kind === 'askew' ? { label: 'FINISH THE BRANCH', title: 'Lay road into the join' } : null
})

/** A layout error as a player reads it: no map coordinates, a capital letter. */
function friendly(reason: string) {
    const text = reason.replace(/ at \([^)]*\)/, '')
    return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The JSON box: paste a course in to replace the road, or copy this one out. */
const jsonOpen = ref(false)
const jsonText = ref('')
const jsonNote = ref<{ ok: boolean, text: string } | null>(null)

function toggleJson() {
    jsonOpen.value = !jsonOpen.value
    jsonNote.value = null
    if (jsonOpen.value && !jsonText.value) jsonText.value = exportCustomTrack(draft.value)
}

function importJson() {
    const { track, error } = importCustomTrack(jsonText.value, draft.value.id)
    if (!track) {
        jsonNote.value = { ok: false, text: friendly(error) }
        return
    }
    replace(track)
    jsonNote.value = { ok: true, text: 'Imported: undo takes it back' }
}

async function copyJson() {
    jsonText.value = exportCustomTrack(draft.value)
    try {
        await navigator.clipboard.writeText(jsonText.value)
        jsonNote.value = { ok: true, text: 'Copied to the clipboard' }
    } catch {
        jsonNote.value = { ok: true, text: 'Select the text above to copy it' }
    }
}

function finish() {
    emit('done', dirty.value ? draft.value : null)
}

function drive() {
    if (compiled.value.def) emit('drive', draft.value)
}

function askDelete() {
    if (tap('delete')) emit('delete', draft.value.id)
}

/** Map steps for the arrow keys, which move loose road. */
const ARROWS: Record<string, [number, number]> = { ArrowUp: [0, -GRID], ArrowDown: [0, GRID], ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0] }

function onKeyDown(e: KeyboardEvent) {
    if (isTyping(e)) return
    const mod = e.ctrlKey || e.metaKey
    const sel = looseSel.value
    const digit = /^Digit([1-7])$/.exec(e.code)
    if (e.code === 'Escape') {
        // Lets go of what's picked out; it never leaves the builder.
        const last = lineSections.value.length - 1
        if (obstacleSel.value !== null) obstacleSel.value = null
        else if (sel) looseSel.value = null
        else if (cursor.value !== last) select(last)
    } else if (obstacleSel.value !== null && (e.code === 'Delete' || e.code === 'Backspace')) {
        removeObstacle(obstacleSel.value)
        obstacleSel.value = null
    } else if (obstacleSel.value !== null && e.code === 'KeyR' && !mod) {
        if (selectedObstacle.value && OBSTACLE_KINDS[selectedObstacle.value.kind].turns) turnObstacle(obstacleSel.value)
    } else if (e.code === 'KeyZ' && mod) {
        undo()
    } else if (e.code === 'KeyO' && !mod) {
        tool.value = tool.value === 'road' ? 'obstacles' : 'road'
    } else if (digit && !mod && tool.value === 'obstacles') {
        obstacleKind.value = OBSTACLE_KIND_IDS[Number(digit[1]) - 1] ?? obstacleKind.value
    } else if (digit && !mod) {
        pick({ curve: CURVE_KEYS[Number(digit[1]) - 1]! })
    } else if (e.code === 'KeyR' && !mod && tool.value === 'obstacles') {
        obstacleRot.value = obstacleRot.value ? 0 : 90
    } else if ((e.code === 'Delete' || e.code === 'Backspace') && tool.value === 'obstacles') {
        const i = obstacleUnderPointer()
        if (i >= 0) removeObstacle(i)
    } else if (e.code === 'KeyR' && !mod) {
        if (sel) turnLooseBy(sel.k, e.shiftKey ? -1 : 1)
        else placement.turn(e.shiftKey ? -1 : 1)
    } else if ((e.code === 'KeyQ' || e.code === 'KeyE') && !mod) {
        const by = e.code === 'KeyE' ? 1 : -1
        if (sel) shiftLoose(sel.k, 0, 0, by * LEVEL_HEIGHT)
        else placement.raise(by)
    } else if (e.code === 'KeyM' && !mod && sel) {
        mirrorLooseAt(sel.k)
    } else if (e.code === 'KeyC' && !mod && sel) {
        copyLooseAt(sel.k, GRID * 6, 0)
    } else if (e.code === 'KeyF' && !mod) {
        connect()
    } else if ((e.code === 'Delete' || e.code === 'Backspace') && sel) {
        if (e.shiftKey) deleteLoose(sel.k)
        else removeLooseAt(sel.k, sel.index)
    } else if ((e.code === 'Delete' || e.code === 'Backspace') && cursor.value >= 0) {
        removeAt(cursor.value, e.shiftKey)
    } else if (sel && ARROWS[e.code]) {
        shiftLoose(sel.k, ...ARROWS[e.code]!)
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        select(cursor.value + (e.code === 'ArrowUp' ? -1 : 1))
    } else if (e.code === 'Enter' && !sel) {
        build()
    } else {
        return
    }
    e.preventDefault()
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div class="nr-select absolute inset-0 flex flex-col gap-3 overflow-y-auto p-4 sm:p-6 lg:overflow-hidden">
    <div class="flex flex-wrap items-center gap-3 pr-32">
      <button class="nr-icon-btn shrink-0" aria-label="Save and go back to the tracks" @click="finish">
        <UIcon name="i-lucide-chevron-left" class="size-5" />
      </button>
      <h2 class="nr-heading">TRACK BUILDER</h2>
      <input
        :value="draft.name"
        class="nr-input min-w-0 flex-1 sm:max-w-64"
        :maxlength="MAX_NAME_LENGTH"
        aria-label="Track name"
        placeholder="Track name"
        @input="setName(($event.target as HTMLInputElement).value)"
      >
      <button class="nr-icon-btn shrink-0" :disabled="!canUndo" aria-label="Undo" title="Undo (Ctrl+Z)" @click="undo">
        <UIcon name="i-lucide-undo-2" class="size-4" />
      </button>
      <button class="nr-icon-btn shrink-0" :class="{ 'is-active': jsonOpen }" :aria-expanded="jsonOpen" aria-label="Import or export JSON" title="Import or export as JSON" @click="toggleJson">
        <UIcon name="i-lucide-braces" class="size-4" />
      </button>
    </div>

    <div v-if="jsonOpen" class="nr-card nr-card-tight flex flex-col gap-2 text-left">
      <textarea
        v-model="jsonText"
        class="nr-input h-40 resize-y font-mono text-xs"
        spellcheck="false"
        aria-label="Track JSON"
        placeholder="Paste a track's JSON here"
      />
      <div class="flex flex-wrap items-center gap-2">
        <button class="nr-ghost nr-small" @click="importJson">IMPORT</button>
        <button class="nr-ghost nr-small" @click="copyJson">COPY THIS TRACK</button>
        <span v-if="jsonNote" class="text-[11px] font-semibold [font-family:system-ui,sans-serif]" :class="jsonNote.ok ? 'text-emerald-300' : 'text-rose-300'">{{ jsonNote.text }}</span>
      </div>
    </div>

    <div class="flex flex-col gap-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_17rem] lg:grid-rows-[minmax(0,1fr)_auto]">
      <div class="nr-card nr-card-map flex min-h-80 flex-col lg:min-h-0">
        <div class="relative min-h-0 flex-1">
          <NitroRushBuilderPreview
            v-if="view === '3d'"
            class="absolute inset-0"
            :track="draft"
            :forks="forks"
            :lines="shownLines"
            :line="line"
            :closes="closes"
            :loop="draft.closed"
            :ended="ended"
            :selected="cursor >= 0 && !looseSel ? cursor : null"
            :loose="shownLoose"
            :loose-selected="looseSel"
            :plane-y="planeY"
            :ghost="shownGhost?.walk ?? null"
            :ghost-blocked="!!shownGhost?.blocked"
            :ghost-reframe="!pointing"
            :loose-obstacles="looseObstacles"
            :obstacle-ghost="obstacleGhost"
            :obstacle-selected="selectedObstacle"
            :paint="tool === 'obstacles'"
            :handles="handles"
            @press="onPress"
            @stroke="paintHere"
            @release="onRelease"
            @handle="onHandle"
            @hover="onHover"
            @tap="onTap"
            @remove="onRemove"
            @dragging="dragging = $event"
            @move="onMove"
          />
          <NitroRushBuilderMap
            v-else
            class="absolute inset-0"
            :lines="shownLines"
            :line="line"
            :closed="draft.closed"
            :selected="cursor >= 0 && !looseSel ? cursor : null"
            :ended="ended"
            :joins="forks.joins"
            :loose="shownLoose"
            :loose-selected="looseSel"
            :ghost="shownGhost?.walk ?? null"
            :ghost-blocked="!!shownGhost?.blocked"
            :obstacles="draft.obstacles ?? []"
            :loose-obstacles="looseObstacles"
            :obstacle-ghost="obstacleGhost"
            :obstacle-selected="obstacleSel"
            :paint="tool === 'obstacles'"
            :handles="handles"
            @press="onPress"
            @stroke="paintHere"
            @release="onRelease"
            @handle="onHandle"
            @hover="onHover"
            @tap="onTap"
            @remove="onRemove"
            @dragging="dragging = $event"
            @move="onMove"
          />
          <div class="nr-place-hud pointer-events-none absolute bottom-2.5 left-2.5">
            <template v-if="tool === 'road'">
              <span>LEVEL {{ placement.level.value }}</span>
              <span>{{ ['↑', '→', '↓', '←'][placement.quarters.value] }}</span>
            </template>
            <span v-else>{{ OBSTACLE_KINDS[obstacleKind].label.toUpperCase() }}{{ obstacleRot ? ' ⟳' : '' }}</span>
            <span v-if="looseRoad.length">{{ looseRoad.length }} LOOSE</span>
          </div>
          <div class="nr-toggle is-small absolute right-2.5 top-2.5" role="radiogroup" aria-label="Builder view">
            <button role="radio" :aria-checked="view === 'map'" :class="{ 'is-active': view === 'map' }" @click="view = 'map'">MAP</button>
            <button role="radio" :aria-checked="view === '3d'" :class="{ 'is-active': view === '3d' }" @click="view = '3d'">3D</button>
          </div>
        </div>
        <div class="nr-build-status" :class="{ 'is-ok': status.ok }">
          <UIcon :name="status.ok ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'" class="size-4 shrink-0" />
          <span class="min-w-0 flex-1">{{ bridgeError ? friendly(`can't connect: ${bridgeError}`) : status.text }}</span>
          <button
            v-if="bridgeOffer && !finishAction"
            class="nr-ghost nr-small is-locked"
            :disabled="full"
            :title="`Lay road onto the loose road ${Math.round(bridgeOffer.metres)} m away (F)`"
            @click="connect"
          >
            CONNECT
          </button>
          <button
            v-if="finishAction"
            class="nr-ghost nr-small is-locked"
            :disabled="full || !!finishError"
            :title="full ? 'That\'s the most sections a track can have' : finishAction.title"
            @click="finishLine"
          >
            {{ finishAction.label }}
          </button>
        </div>
      </div>

      <div class="nr-card nr-card-tight flex min-w-0 flex-col gap-2 text-left lg:col-start-1 lg:row-start-2">
        <div class="nr-toggle is-small self-start" role="radiogroup" aria-label="Build tool">
          <button role="radio" :aria-checked="tool === 'road'" :class="{ 'is-active': tool === 'road' }" @click="tool = 'road'">ROAD</button>
          <button role="radio" :aria-checked="tool === 'obstacles'" :class="{ 'is-active': tool === 'obstacles' }" title="Obstacles (O)" @click="tool = 'obstacles'">OBSTACLES</button>
        </div>
        <div v-if="tool === 'obstacles'" class="nr-construct">
          <div class="nr-construct-group">
            <span class="nr-label">OBSTACLE</span>
            <div class="nr-toggle is-small is-row" role="radiogroup" aria-label="Obstacle">
              <button
                v-for="(kind, i) in OBSTACLE_KIND_IDS"
                :key="kind"
                role="radio"
                :aria-checked="obstacleKind === kind"
                :aria-label="OBSTACLE_KINDS[kind].label"
                :title="`${OBSTACLE_KINDS[kind].label} (${i + 1})`"
                :class="{ 'is-active': obstacleKind === kind }"
                @click="obstacleKind = kind"
              >
                <UIcon :name="OBSTACLE_KINDS[kind].icon" class="size-4" />
              </button>
            </div>
          </div>
          <div v-if="OBSTACLE_KINDS[obstacleKind].turns" class="nr-construct-group">
            <span class="nr-label">TURN</span>
            <div class="nr-toggle is-small is-row" role="radiogroup" aria-label="Turn">
              <button role="radio" :aria-checked="!obstacleRot" :class="{ 'is-active': !obstacleRot }" @click="obstacleRot = 0">ACROSS</button>
              <button role="radio" :aria-checked="obstacleRot === 90" :class="{ 'is-active': obstacleRot === 90 }" @click="obstacleRot = 90">ALONG</button>
            </div>
          </div>
          <div class="nr-construct-group nr-construct-action">
            <span class="nr-label nr-construct-next" :class="{ 'is-blocked': !!obstacleCandidateFault }">
              {{ obstacleCandidateFault ? friendly(obstacleCandidateFault) : `${OBSTACLE_KINDS[obstacleKind].label} · ${draft.obstacles?.length ?? 0} / ${MAX_OBSTACLES}` }}
            </span>
          </div>
        </div>
        <NitroRushBuilderConstruct
          v-else :choice="choice" :next="next" :disabled="full" :blocked="blocked" :fault="fault" @pick="pick" @build="build">
          <button class="nr-ghost nr-small nr-drawer-toggle" :aria-expanded="drawerOpen" @click="drawerOpen = !drawerOpen">
            ALL SECTIONS
            <UIcon :name="drawerOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'" class="size-3.5" />
          </button>
        </NitroRushBuilderConstruct>
        <NitroRushBuilderPalette v-if="drawerOpened" v-show="drawerOpen && tool === 'road'" class="nr-drawer" :disabled="full" :can-fork="canFork" :state="state" @add="insert" />
      </div>

      <div class="nr-card nr-card-tight flex flex-col gap-3 text-left lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0">
        <div class="nr-toggle" role="radiogroup" aria-label="Course type">
          <button role="radio" :aria-checked="draft.closed" :class="{ 'is-active': draft.closed }" @click="setClosed(true)">LOOP</button>
          <button role="radio" :aria-checked="!draft.closed" :class="{ 'is-active': !draft.closed }" @click="setClosed(false)">SPRINT</button>
        </div>
        <p class="text-[11px] font-semibold text-white/55 [font-family:system-ui,sans-serif]">
          {{ line ? (draft.closed ? 'End the branch at a join.' : 'End the branch at a join or a finish line.') : draft.closed ? 'Bring the road back round to the start line.' : 'Lay a finish line, with room to stop after it.' }}
          New sections go in after the highlighted one; drag a section's grip to move it.
        </p>
        <p class="nr-keys">
          <b>Click</b> an end or open ground to build · <b>right-click</b> a section to cut it out · <b>drag</b> loose road to move it ·
          <b>1–7</b> direction · <b>R</b> turn · <b>Q/E</b> level · <b>F</b> connect · <b>M</b> mirror · <b>C</b> copy · <b>Shift+Del</b> close the gap ·
          <b>O</b> obstacles: click or hold on the road to place, click one to pick it, right-click to remove · <b>Esc</b> deselect
        </p>
        <NitroRushBuilderRoads
          v-if="draft.branches?.length"
          :endings="endings"
          :line="line"
          :joins="forks.joins"
          :joinable="joinable"
          @select="selectLine"
          @join="joinAt"
          @remove="removeLine"
        />
        <div class="max-h-64 min-h-0 flex-1 overflow-y-auto lg:max-h-none">
          <NitroRushBuilderPieces
            v-if="looseSel && looseRoad[looseSel.k]"
            :sections="looseRoad[looseSel.k]!.sections"
            :tags="[]"
            :cursor="looseSel.index"
            start-label="Loose road"
            @select="selectLoose(looseSel.k, $event)"
            @move="() => {}"
            @remove="removeLooseAt(looseSel.k, $event)"
          />
          <NitroRushBuilderPieces v-else :sections="lineSections" :tags="tags" :cursor="cursor" :start-label="line ? 'Fork' : 'Start of the road'" @select="select" @move="moveTo" @remove="removeAt" />
        </div>
        <div class="flex items-baseline justify-between text-[11px] text-white/60 tabular-nums">
          <span>{{ (length / 1000).toFixed(2) }} KM</span>
          <span>{{ sectionCount(draft) }} / {{ MAX_SECTIONS }} SECTIONS</span>
        </div>
        <button class="nr-play self-stretch !px-6 !py-2.5 !text-xl" :disabled="!compiled.def" @click="drive">
          <UIcon name="i-lucide-flag" class="size-5" />
          DRIVE IT
        </button>
        <button v-if="saved" class="nr-ghost" :class="{ 'is-danger': armed }" @click="askDelete">
          {{ armed ? (clearsTimes ? 'Clears times · tap again' : 'Tap again to delete') : 'Delete track' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style src="./nitro-rush-builder.css"></style>
