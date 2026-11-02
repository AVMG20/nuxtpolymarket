<script setup lang="ts">
import type { CustomTrackEntry } from '~/utils/nitro-rush/types'
import type { NrTrackSummary } from '#server/utils/nitro-rush'
import { GHOST_MAX_SECONDS } from '#shared/utils/nitro-rush/ghost'

/** The player's own courses: drive, edit, and publish them for everyone to race. */
const props = defineProps<{
    trackId: string
    tracks: CustomTrackEntry[]
    summaries: Record<string, NrTrackSummary>
    busy: string | null
    /** Whether the player has a lap with a ghost on this local course. */
    hasLap: (id: string) => boolean
    /** Its lap kept no ghost for being too long, rather than for a respawn. */
    lapTooLong: (id: string) => boolean
}>()
const emit = defineEmits<{ select: [id: string], build: [id?: string], publish: [id: string], unpublish: [id: string] }>()

/** How long a button waits for its second tap before a step that clears times. */
const CONFIRM_MS = 3000
const confirming = ref<{ id: string, action: 'publish' | 'unpublish' } | null>(null)
let confirmTimer: ReturnType<typeof setTimeout> | undefined

const PUBLISH_LABEL = { new: 'PUBLISH', rename: 'UPDATE NAME', replace: 'PUBLISH CHANGES' } as const

/** A new road goes up with the builder's lap on it; a rename keeps the board it has. */
const needsLap = (c: CustomTrackEntry) => (c.change === 'new' || c.change === 'replace') && !props.hasLap(c.track.id)

const lapHint = (c: CustomTrackEntry) => props.lapTooLong(c.track.id) ? 'LAP TOO LONG TO PUBLISH' : 'DRIVE A LAP FIRST'

function status(c: CustomTrackEntry) {
    if (!c.def) return 'UNFINISHED'
    if (!c.published) return needsLap(c) ? lapHint(c) : 'ONLY ON THIS DEVICE'
    if (needsLap(c)) return `CHANGED · ${lapHint(c)}`
    const racers = c.published.summary.entries
    const times = `${racers} ${racers === 1 ? 'RACER' : 'RACERS'}`
    return c.change === 'replace' ? `CHANGED SINCE PUBLISHED · ${times}` : `PUBLISHED · ${times}`
}

/** Taps that would clear other players' times need a second tap. */
function act(c: CustomTrackEntry, action: 'publish' | 'unpublish') {
    const clears = (action === 'unpublish' || c.change === 'replace') && !!c.published?.summary.entries
    const armed = confirming.value?.id === c.track.id && confirming.value.action === action
    clearTimeout(confirmTimer)
    if (clears && !armed) {
        confirming.value = { id: c.track.id, action }
        confirmTimer = setTimeout(() => {
            confirming.value = null
        }, CONFIRM_MS)
        return
    }
    confirming.value = null
    if (action === 'publish') emit('publish', c.track.id)
    else emit('unpublish', c.track.id)
}

const isArmed = (c: CustomTrackEntry, action: 'publish' | 'unpublish') => confirming.value?.id === c.track.id && confirming.value.action === action
const hasBoard = (c: CustomTrackEntry) => c.playId !== c.track.id

onBeforeUnmount(() => clearTimeout(confirmTimer))
</script>

<template>
  <div>
    <div class="mb-1.5 flex items-baseline justify-between gap-3">
      <h3 class="nr-group">MY TRACKS</h3>
      <span class="nr-blurb">Build your own from track sections</span>
    </div>
    <div class="nr-track-grid">
      <button class="nr-track nr-track-new" @click="$emit('build')">
        <span class="nr-track-preview grid place-items-center"><UIcon name="i-lucide-plus" class="size-7" /></span>
        <span class="nr-track-name">TRACK BUILDER</span>
      </button>
      <div v-for="c in tracks" :key="c.track.id" class="flex flex-col gap-1.5">
        <div class="relative">
          <NitroRushTrackCard
            v-if="c.def"
            :track="c.def"
            :active="c.playId === trackId"
            :has-board="hasBoard(c)"
            :record="summaries[c.playId]?.record ?? null"
            @select="$emit('select', c.playId)"
          />
          <button v-else class="nr-track" @click="$emit('build', c.track.id)">
            <span class="nr-track-preview grid place-items-center"><UIcon name="i-lucide-construction" class="size-7" /></span>
            <span class="min-w-0 flex-1">
              <span class="nr-track-name block">{{ c.track.name }}</span>
              <span class="nr-track-holder block">UNFINISHED</span>
            </span>
          </button>
          <button v-if="c.def" class="nr-icon-btn nr-track-edit" :aria-label="`Edit ${c.track.name}`" title="Edit in the track builder" @click="$emit('build', c.track.id)">
            <UIcon name="i-lucide-pencil" class="size-4" />
          </button>
        </div>
        <div v-if="c.def" class="nr-track-actions">
          <span class="nr-track-holder flex-1">{{ status(c) }}</span>
          <button
            v-if="c.change"
            class="nr-ghost nr-small"
            :class="{ 'is-danger': isArmed(c, 'publish'), 'is-locked': needsLap(c) }"
            :disabled="!!busy || needsLap(c)"
            :title="needsLap(c) ? (lapTooLong(c.track.id) ? `Drive a lap under ${GHOST_MAX_SECONDS / 60} minutes first` : 'Drive one clean lap first') : undefined"
            @click="act(c, 'publish')"
          >
            {{ isArmed(c, 'publish') ? 'CLEARS TIMES · TAP AGAIN' : PUBLISH_LABEL[c.change] }}
          </button>
          <button
            v-if="c.published"
            class="nr-ghost nr-small"
            :class="{ 'is-danger': isArmed(c, 'unpublish') }"
            :disabled="!!busy"
            @click="act(c, 'unpublish')"
          >
            {{ isArmed(c, 'unpublish') ? 'CLEARS TIMES · TAP AGAIN' : 'UNPUBLISH' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
