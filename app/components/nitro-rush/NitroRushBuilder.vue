<script setup lang="ts">
import { isTyping } from '~/utils/nitro-rush/input'
import { MAX_NAME_LENGTH, MAX_SECTIONS, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import { ROAD } from '#shared/utils/nitro-rush/tracks'

/** The track builder: lay pre-built sections on a map until the course is drivable. */
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

const { draft, cursor, walk, compiled, gap, full, length, canUndo, insert, removeAt, move, setClosed, setName, select, undo } = useNitroRushTrackDraft(toRef(props, 'track'))

const dirty = computed(() => draft.value !== props.track)
const confirmingDelete = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | undefined

const status = computed(() => {
    if (compiled.value.def) return { ok: true, text: 'Ready to race' }
    const g = gap.value
    if (g && (g.distance > 0.5 || g.turn !== 0 || g.climb > 0.01)) {
        const parts = [`${Math.round(g.distance)} m to go`]
        if (g.turn) parts.push(`turn ${Math.abs(g.turn)}° ${g.turn > 0 ? 'right' : 'left'}`)
        if (g.climb > 0.01) parts.push(`${Math.round(g.climb)} m down`)
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
    if (confirmingDelete.value) {
        emit('delete', draft.value.id)
        return
    }
    confirmingDelete.value = true
    clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => {
        confirmingDelete.value = false
    }, 3000)
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
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    clearTimeout(confirmTimer)
})
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

    <div class="flex flex-col gap-3 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[15rem_minmax(0,1fr)_17rem]">
      <div class="nr-card nr-card-tight text-left lg:min-h-0 lg:overflow-y-auto">
        <NitroRushBuilderPalette :disabled="full" @add="insert" />
        <p v-if="full" class="mt-3 text-[11px] font-semibold text-white/60 [font-family:system-ui,sans-serif]">That's the most sections a track can have.</p>
      </div>

      <div class="nr-card nr-card-map relative min-h-80 lg:min-h-0">
        <NitroRushBuilderMap
          class="absolute inset-0"
          :walk="walk"
          :closed="draft.closed"
          :half-width="ROAD.halfWidth"
          :selected="cursor >= 0 ? cursor : null"
          @pick="select"
        />
        <div class="nr-build-status" :class="{ 'is-ok': status.ok }">
          <UIcon :name="status.ok ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'" class="size-4 shrink-0" />
          <span>{{ status.text }}</span>
        </div>
      </div>

      <div class="nr-card nr-card-tight flex flex-col gap-3 text-left lg:min-h-0">
        <div class="nr-toggle" role="radiogroup" aria-label="Course type">
          <button role="radio" :aria-checked="draft.closed" :class="{ 'is-active': draft.closed }" @click="setClosed(true)">LOOP</button>
          <button role="radio" :aria-checked="!draft.closed" :class="{ 'is-active': !draft.closed }" @click="setClosed(false)">SPRINT</button>
        </div>
        <p class="text-[11px] font-semibold text-white/55 [font-family:system-ui,sans-serif]">
          {{ draft.closed ? 'Bring the road back round to the start line.' : 'Lay a finish line, with room to stop after it.' }}
          New sections go in after the highlighted one.
        </p>
        <div class="max-h-64 min-h-0 flex-1 overflow-y-auto lg:max-h-none">
          <NitroRushBuilderPieces :sections="draft.sections" :cursor="cursor" @select="select" @move="move" @remove="removeAt" />
        </div>
        <div class="flex items-baseline justify-between text-[11px] text-white/60 tabular-nums">
          <span>{{ (length / 1000).toFixed(2) }} KM</span>
          <span>{{ draft.sections.length }} / {{ MAX_SECTIONS }} SECTIONS</span>
        </div>
        <button class="nr-play self-stretch !px-6 !py-2.5 !text-xl" :disabled="!compiled.def" @click="drive">
          <UIcon name="i-lucide-flag" class="size-5" />
          DRIVE IT
        </button>
        <button v-if="saved" class="nr-ghost" :class="{ 'is-danger': confirmingDelete }" @click="askDelete">
          {{ confirmingDelete ? 'Tap again to delete' : 'Delete track' }}
        </button>
      </div>
    </div>
  </div>
</template>
