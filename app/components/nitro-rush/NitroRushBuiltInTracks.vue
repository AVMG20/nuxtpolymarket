<script setup lang="ts">
import { sortTracks, type TrackSort } from '~/utils/nitro-rush/community'
import { TRACK_GROUPS, TRACKS } from '#shared/utils/nitro-rush/tracks'
import type { Medal } from '~/utils/nitro-rush/medals'
import type { NrTrackSummary } from '#server/utils/nitro-rush'
import type { NrTrackVotes } from '#server/utils/nitro-rush-tracks'
import type { TrackDef } from '#shared/utils/nitro-rush/track'

/** The game's own courses, by group, or all together by votes or popularity. */
const props = defineProps<{
    trackId: string
    summaries: Record<string, NrTrackSummary>
    votes: Record<string, NrTrackVotes>
    /** The medal the viewer's best holds on a course. */
    medalOn: (id: string, def: TrackDef) => Medal | null
}>()
defineEmits<{ select: [id: string] }>()

const trackGroups = TRACK_GROUPS
    .map(g => ({ ...g, tracks: TRACKS.filter(t => t.group === g.id) }))
    .filter(g => g.tracks.length)
const groupName = (t: TrackDef) => TRACK_GROUPS.find(g => g.id === t.group)?.name

const BLURBS: Record<TrackSort, string> = { listed: 'The game\'s own tracks', top: 'Best voted first', popular: 'Most raced lately first' }
const sort = ref<TrackSort>('listed')
const sorted = shallowRef<TrackDef[]>([])
// Ranked when the sort changes or the counts first arrive, not on every vote or lap, so a card doesn't jump away from the tap.
watch([sort, () => Object.keys(props.votes).length, () => Object.keys(props.summaries).length], ([by]) => {
    sorted.value = sortTracks([...TRACKS], by, t => t.id, props)
}, { immediate: true })
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between gap-3">
      <span class="nr-blurb truncate">{{ BLURBS[sort] }}</span>
      <NitroRushSortSeg v-model="sort" listed="GROUPS" />
    </div>
    <template v-if="sort === 'listed'">
      <section v-for="g in trackGroups" :key="g.id" class="mt-5 first-of-type:mt-0">
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
            :medal="medalOn(t.id, t)"
            :votes="votes[t.id]"
            :plays="summaries[t.id]?.plays"
            @select="$emit('select', t.id)"
          />
        </div>
      </section>
    </template>
    <div v-else class="nr-track-grid">
      <NitroRushTrackCard
        v-for="t in sorted"
        :key="t.id"
        :track="t"
        :active="t.id === trackId"
        has-board
        :record="summaries[t.id]?.record ?? null"
        :medal="medalOn(t.id, t)"
        :group="groupName(t)"
        :votes="votes[t.id]"
        :plays="summaries[t.id]?.plays"
        @select="$emit('select', t.id)"
      />
    </div>
  </div>
</template>
