<script setup lang="ts">
import { sortTracks, type TrackSort } from '~/utils/nitro-rush/community'
import type { CommunityTrackEntry } from '~/utils/nitro-rush/types'
import type { Medal } from '~/utils/nitro-rush/medals'
import type { NrTrackSummary } from '#server/utils/nitro-rush'
import type { NrTrackVotes } from '#server/utils/nitro-rush-tracks'
import type { TrackDef } from '#shared/utils/nitro-rush/track'

/** Other players' published courses, newest, best voted or most raced first; the info panel takes the votes. */
const props = defineProps<{
    trackId: string
    tracks: CommunityTrackEntry[]
    summaries: Record<string, NrTrackSummary>
    votes: Record<string, NrTrackVotes>
    /** The medal the viewer's best holds on a course. */
    medalOn: (id: string, def: TrackDef) => Medal | null
}>()
defineEmits<{ select: [id: string] }>()

const sort = ref<TrackSort>('listed')
const sorted = shallowRef<CommunityTrackEntry[]>([])
// Ranked when the list or the sort changes, not on every vote, so a card doesn't jump away from the tap.
watch([() => props.tracks, sort], ([tracks, by]) => {
    sorted.value = sortTracks(tracks, by, c => c.track.id, props)
}, { immediate: true })
</script>

<template>
  <div>
    <div class="mb-1.5 flex items-center gap-3">
      <h3 class="nr-group">COMMUNITY</h3>
      <span class="nr-blurb hidden flex-1 truncate text-right sm:block">Tracks by other players</span>
      <span class="flex-1 sm:hidden" />
      <NitroRushSortSeg v-if="tracks.length > 1" v-model="sort" listed="NEWEST" />
    </div>
    <div v-if="tracks.length" class="nr-track-grid">
      <NitroRushTrackCard
        v-for="c in sorted"
        :key="c.track.id"
        :track="c.def"
        :active="c.track.id === trackId"
        has-board
        :record="summaries[c.track.id]?.record ?? null"
        :medal="medalOn(c.track.id, c.def)"
        :author="c.track.author"
        :votes="votes[c.track.id] ?? c.track.votes"
        :plays="summaries[c.track.id]?.plays"
        @select="$emit('select', c.track.id)"
      />
    </div>
    <p v-else class="nr-blurb py-6 text-center">Nobody has published a track yet. Build one under My Tracks and be the first.</p>
  </div>
</template>
