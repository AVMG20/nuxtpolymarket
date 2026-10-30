<script setup lang="ts">
import type { CommunityTrackEntry } from '~/utils/nitro-rush/types'
import type { NrTrackSummary } from '#server/utils/nitro-rush'

/** Other players' published courses, newest first. */
defineProps<{
    trackId: string
    tracks: CommunityTrackEntry[]
    summaries: Record<string, NrTrackSummary>
    best: (id: string) => number | null
}>()
defineEmits<{ select: [id: string] }>()
</script>

<template>
  <div>
    <div class="mb-1.5 flex items-baseline justify-between gap-3">
      <h3 class="nr-group">COMMUNITY</h3>
      <span class="nr-blurb">Tracks other players built and published</span>
    </div>
    <div v-if="tracks.length" class="nr-track-grid">
      <NitroRushTrackCard
        v-for="c in tracks"
        :key="c.track.id"
        :track="c.def"
        :active="c.track.id === trackId"
        has-board
        :record="summaries[c.track.id]?.record ?? null"
        :best="best(c.track.id)"
        :author="c.track.author"
        @select="$emit('select', c.track.id)"
      />
    </div>
    <p v-else class="nr-blurb py-6 text-center">Nobody has published a track yet. Build one under My Tracks and be the first.</p>
  </div>
</template>
