<script setup lang="ts">
import { sortCommunity, type CommunitySort } from '~/utils/nitro-rush/community'
import type { CommunityTrackEntry } from '~/utils/nitro-rush/types'
import type { NrTrackSummary } from '#server/utils/nitro-rush'

/** Other players' published courses, newest or most popular first; the info panel takes the votes. */
const props = defineProps<{
    trackId: string
    tracks: CommunityTrackEntry[]
    summaries: Record<string, NrTrackSummary>
}>()
defineEmits<{ select: [id: string] }>()

const SORTS: readonly { id: CommunitySort, label: string }[] = [
    { id: 'newest', label: 'NEWEST' },
    { id: 'popular', label: 'TOP' }
]
const sort = ref<CommunitySort>('newest')
const sorted = shallowRef<CommunityTrackEntry[]>([])
// Ranked when the list or the sort changes, not on every vote, so a card doesn't jump away from the tap.
watch([() => props.tracks, sort], ([tracks, by]) => {
    sorted.value = sortCommunity(tracks, by)
}, { immediate: true })
</script>

<template>
  <div>
    <div class="mb-1.5 flex items-center gap-3">
      <h3 class="nr-group">COMMUNITY</h3>
      <span class="nr-blurb hidden flex-1 truncate text-right sm:block">Tracks by other players</span>
      <span class="flex-1 sm:hidden" />
      <div v-if="tracks.length > 1" class="nr-seg" role="radiogroup" aria-label="Sort tracks">
        <button
          v-for="s in SORTS"
          :key="s.id"
          class="nr-seg-btn"
          :class="{ 'is-active': sort === s.id }"
          role="radio"
          :aria-checked="sort === s.id"
          @click="sort = s.id"
        >
          {{ s.label }}
        </button>
      </div>
    </div>
    <div v-if="tracks.length" class="nr-track-grid">
      <NitroRushTrackCard
        v-for="c in sorted"
        :key="c.track.id"
        :track="c.def"
        :active="c.track.id === trackId"
        has-board
        :record="summaries[c.track.id]?.record ?? null"
        :author="c.track.author"
        :votes="c.track.votes"
        @select="$emit('select', c.track.id)"
      />
    </div>
    <p v-else class="nr-blurb py-6 text-center">Nobody has published a track yet. Build one under My Tracks and be the first.</p>
  </div>
</template>
