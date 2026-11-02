<script setup lang="ts">
import { topRows } from '~/utils/nitro-rush/board'
import type { NrBoard } from '#server/utils/nitro-rush'
import type { NrPublishedTrack, NrVote } from '#server/utils/nitro-rush-tracks'
import { isCustomTrackId } from '#shared/utils/nitro-rush/custom'
import { lapTimeOrBlank } from '#shared/utils/nitro-rush/timing'
import { Track, type TrackDef } from '#shared/utils/nitro-rush/track'

/** The selected course in the menu's side panel: who built it, its length, its votes and its top 5. */
const props = defineProps<{
    trackId: string
    trackName: string
    def: TrackDef | null
    /** Who built it: a name, 'you', or null for a built-in course. */
    author: string | null
    /** Its published copy, which carries the votes; null for a built-in or private course. */
    published: NrPublishedTrack | null
    /** Another player's course, which the viewer may vote on. */
    canVote: boolean
    /** A vote on it is in flight. */
    voting: boolean
    /** The open course's board; null until it is in. */
    board: NrBoard | null
    boardLoading: boolean
    /** The viewer's best here, in seconds. */
    best: number | null
}>()
defineEmits<{ vote: [value: NrVote] }>()

const km = computed(() => props.def ? new Track(props.def).lapLength / 1000 : null)
const meta = computed(() => [props.author && `by ${props.author}`, km.value !== null && `${km.value.toFixed(2)} KM`].filter(Boolean).join(' · '))

// A private course's times never leave this browser.
const hasBoard = computed(() => !isCustomTrackId(props.trackId))
const fresh = computed(() => props.board?.trackId === props.trackId ? props.board : null)
// The last board stays up, dimmed, while the next one loads, so the panel doesn't jump.
const shown = shallowRef<NrBoard | null>(null)
watch(fresh, (b) => {
    if (b) shown.value = b
}, { immediate: true })
const listed = computed(() => fresh.value ?? (props.boardLoading ? shown.value : null))
// A failed request leaves nothing to list, so the heading goes too and YOUR BEST stands alone.
const showTop = computed(() => hasBoard.value && (!!listed.value || props.boardLoading))
const rows = computed(() => listed.value ? topRows(listed.value) : { top: [], own: null })
const own = computed(() => fresh.value ? rows.value.own : null)
const inTop = computed(() => !!fresh.value && rows.value.top.some(r => r.you))
const showBest = computed(() => !own.value && !inTop.value && !(fresh.value?.entries === 0 && props.best === null))
const time = (ms: number) => lapTimeOrBlank(ms / 1000)
</script>

<template>
  <div>
    <div class="nr-label mb-1">TRACK</div>
    <div class="flex items-center justify-between gap-2">
      <div class="nr-track-name min-w-0">{{ trackName }}</div>
      <NitroRushTrackVote v-if="published && canVote" :track="published" :busy="voting" @vote="$emit('vote', $event)" />
      <NitroRushScore v-else-if="published" :votes="published.votes" />
    </div>
    <div class="nr-track-holder">{{ meta }}</div>

    <template v-if="showTop">
      <div class="nr-label mt-3 mb-1">TOP 5</div>
      <ol class="nr-board" :class="{ 'is-loading': !fresh && !!listed }">
        <li v-for="r in rows.top" :key="r.rank" class="nr-board-row" :class="{ 'is-you': r.you && !!fresh }">
          <span class="nr-board-rank">{{ r.rank }}</span>
          <span class="nr-board-name">{{ r.name }}</span>
          <span class="nr-board-time">{{ time(r.lapMs) }}</span>
        </li>
        <li v-if="fresh && !fresh.entries" class="nr-board-empty">No times yet</li>
      </ol>
    </template>
    <div v-if="own" class="nr-board-row nr-board-own is-you">
      <span class="nr-board-rank">{{ own.rank }}</span>
      <span class="nr-board-name">{{ own.name }}</span>
      <span class="nr-board-time">{{ time(own.lapMs) }}</span>
    </div>
    <div v-else-if="showBest" class="nr-board-row is-you" :class="showTop ? 'nr-board-own' : 'mt-3'">
      <span class="nr-board-name col-span-2">YOUR BEST</span>
      <span class="nr-board-time">{{ lapTimeOrBlank(best) }}</span>
    </div>
  </div>
</template>
