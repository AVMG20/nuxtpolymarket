<script setup lang="ts">
import { TRACK_GROUPS, TRACKS } from '#shared/utils/nitro-rush/tracks'
import type { NrTrackSummary } from '#server/utils/nitro-rush'

/** The game's own courses, by group. */
defineProps<{
    trackId: string
    summaries: Record<string, NrTrackSummary>
    best: (id: string) => number | null
}>()
defineEmits<{ select: [id: string] }>()

const trackGroups = TRACK_GROUPS
    .map(g => ({ ...g, tracks: TRACKS.filter(t => t.group === g.id) }))
    .filter(g => g.tracks.length)
</script>

<template>
  <div>
    <section v-for="g in trackGroups" :key="g.id" class="mt-5 first:mt-0">
      <div class="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 class="nr-group">{{ g.name.toUpperCase() }}</h3>
        <span class="nr-blurb">{{ g.blurb }}</span>
      </div>
      <div class="nr-track-grid">
        <NitroRushTrackCard
          v-for="t in g.tracks"
          :key="t.id"
          :track="t"
          :active="t.id === trackId"
          has-board
          :record="summaries[t.id]?.record ?? null"
          :best="best(t.id)"
          @select="$emit('select', t.id)"
        />
      </div>
    </section>
  </div>
</template>
