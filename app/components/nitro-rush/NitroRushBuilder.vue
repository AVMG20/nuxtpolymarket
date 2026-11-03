<script setup lang="ts">
import { isTyping } from '~/utils/nitro-rush/input'
import { readStorage, STORAGE_KEYS, writeStorage } from '~/utils/nitro-rush/storage'
import { MAX_NAME_LENGTH, MAX_SECTIONS, rideTag, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import { ROAD } from '#shared/utils/nitro-rush/tracks'

/** The track builder: lay sections one at a time, or from the drawer, until the course is drivable. */
const props = defineProps<{
    track: CustomTrack
    /** False for a course that isn't stored yet, which has nothing to delete. */
    saved: boolean
}>()
const emit = defineEmits<{
    /** Leave the builder; the course comes along when it changed. */
    done: [track: CustomTrack | null]
    drive: [track: CustomTrack]
    delete: [id: string]
}>()

const { draft, closed, cursor, walk, compiled, gap, full, length, canUndo, loopError, walkUpTo, insert, removeAt, moveTo, closeLoop, setClosed, setName, select, undo } = useNitroRushTrackDraft(toRef(props, 'track'))

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
const { choice, next, shownWalk, ghost, blocked, pick, build } = useNitroRushConstruction({ cursor, walk, closed, full, walkUpTo, insert })

const tags = computed(() => draft.value.sections.map((id, i) => rideTag(id, walk.value.states[i]!)))
/** A loop whose road already meets its start line. */
const closes = computed(() => draft.value.closed && !!compiled.value.def)

const dirty = computed(() => draft.value !== props.track)
const { armed, tap } = useNitroRushConfirmTap()

const status = computed(() => {
    if (compiled.value.def) return { ok: true, text: 'Ready to race' }
    if (loopError.value) return { ok: false, text: friendly(`can't finish the loop: ${loopError.value}`) }
    const g = gap.value
    if (g && !walk.value.notLevel && (g.distance > 0.5 || g.turn !== 0 || Math.abs(g.climb) > 0.01 || g.bank !== 0 || g.grade !== 0)) {
        const parts = [`${Math.round(g.distance)} m to go`]
        if (g.turn) parts.push(`turn ${Math.abs(g.turn)}° ${g.turn > 0 ? 'right' : 'left'}`)
        if (Math.abs(g.climb) > 0.01) parts.push(`${Math.round(Math.abs(g.climb))} m ${g.climb > 0 ? 'down' : 'up'}`)
        if (g.bank !== 0) parts.push('level the bank')
        if (g.grade !== 0) parts.push('level the slope')
        return { ok: false, text: `Join the road back up to the start: ${parts.join(', ')}` }
    }
    return { ok: false, text: friendly(compiled.value.error ?? '') }
})

/** A layout error as a player reads it: no map coordinates, a capital letter. */
function friendly(reason: string) {
    const text = reason.replace(/ at \([^)]*\)/, '')
    return text.charAt(0).toUpperCase() + text.slice(1)
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

function onKeyDown(e: KeyboardEvent) {
    if (isTyping(e)) return
    if (e.code === 'Escape') {
        finish()
    } else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
        undo()
    } else if ((e.code === 'Delete' || e.code === 'Backspace') && cursor.value >= 0) {
        removeAt(cursor.value)
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        select(cursor.value + (e.code === 'ArrowUp' ? -1 : 1))
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
    </div>

    <div class="flex flex-col gap-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_17rem] lg:grid-rows-[minmax(0,1fr)_auto]">
      <div class="nr-card nr-card-map flex min-h-80 flex-col lg:min-h-0">
        <div class="relative min-h-0 flex-1">
          <NitroRushBuilderPreview
            v-if="view === '3d'"
            class="absolute inset-0"
            :walk="shownWalk"
            :closes="closes"
            :loop="draft.closed"
            :selected="cursor >= 0 ? cursor : null"
            :ghost="ghost"
            :ghost-blocked="blocked"
            @pick="select"
          />
          <NitroRushBuilderMap
            v-else
            class="absolute inset-0"
            :walk="shownWalk"
            :closed="draft.closed"
            :half-width="ROAD.halfWidth"
            :selected="cursor >= 0 ? cursor : null"
            :ghost="ghost"
            :ghost-blocked="blocked"
            @pick="select"
          />
          <div class="nr-toggle is-small absolute right-2.5 top-2.5" role="radiogroup" aria-label="Builder view">
            <button role="radio" :aria-checked="view === 'map'" :class="{ 'is-active': view === 'map' }" @click="view = 'map'">MAP</button>
            <button role="radio" :aria-checked="view === '3d'" :class="{ 'is-active': view === '3d' }" @click="view = '3d'">3D</button>
          </div>
        </div>
        <div class="nr-build-status" :class="{ 'is-ok': status.ok }">
          <UIcon :name="status.ok ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'" class="size-4 shrink-0" />
          <span class="min-w-0 flex-1">{{ status.text }}</span>
          <button
            v-if="draft.closed && !compiled.def"
            class="nr-ghost nr-small is-locked"
            :disabled="full || !!loopError"
            :title="full ? 'That\'s the most sections a track can have' : 'Lay the road back to the start line'"
            @click="closeLoop"
          >
            FINISH THE LOOP
          </button>
        </div>
      </div>

      <div class="nr-card nr-card-tight flex min-w-0 flex-col gap-2 text-left lg:col-start-1 lg:row-start-2">
        <NitroRushBuilderConstruct :choice="choice" :next="next" :disabled="full" :blocked="blocked" @pick="pick" @build="build">
          <button class="nr-ghost nr-small nr-drawer-toggle" :aria-expanded="drawerOpen" @click="drawerOpen = !drawerOpen">
            ALL SECTIONS
            <UIcon :name="drawerOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'" class="size-3.5" />
          </button>
        </NitroRushBuilderConstruct>
        <NitroRushBuilderPalette v-if="drawerOpened" v-show="drawerOpen" class="nr-drawer" :disabled="full" @add="insert" />
      </div>

      <div class="nr-card nr-card-tight flex flex-col gap-3 text-left lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:min-h-0">
        <div class="nr-toggle" role="radiogroup" aria-label="Course type">
          <button role="radio" :aria-checked="draft.closed" :class="{ 'is-active': draft.closed }" @click="setClosed(true)">LOOP</button>
          <button role="radio" :aria-checked="!draft.closed" :class="{ 'is-active': !draft.closed }" @click="setClosed(false)">SPRINT</button>
        </div>
        <p class="text-[11px] font-semibold text-white/55 [font-family:system-ui,sans-serif]">
          {{ draft.closed ? 'Bring the road back round to the start line.' : 'Lay a finish line, with room to stop after it.' }}
          New sections go in after the highlighted one; drag a section's grip to move it.
        </p>
        <div class="max-h-64 min-h-0 flex-1 overflow-y-auto lg:max-h-none">
          <NitroRushBuilderPieces :sections="draft.sections" :tags="tags" :cursor="cursor" @select="select" @move="moveTo" @remove="removeAt" />
        </div>
        <div class="flex items-baseline justify-between text-[11px] text-white/60 tabular-nums">
          <span>{{ (length / 1000).toFixed(2) }} KM</span>
          <span>{{ draft.sections.length }} / {{ MAX_SECTIONS }} SECTIONS</span>
        </div>
        <button class="nr-play self-stretch !px-6 !py-2.5 !text-xl" :disabled="!compiled.def" @click="drive">
          <UIcon name="i-lucide-flag" class="size-5" />
          DRIVE IT
        </button>
        <button v-if="saved" class="nr-ghost" :class="{ 'is-danger': armed }" @click="askDelete">
          {{ armed ? 'Tap again to delete' : 'Delete track' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style src="./nitro-rush-builder.css"></style>
