<script setup lang="ts">
import { lapTimeOrBlank } from '#shared/utils/nitro-rush/timing'
import type { TrackDef } from '#shared/utils/nitro-rush/track'
import type { NrTrackVotes } from '#server/utils/nitro-rush-tracks'

/** One course on the track menu, kept to what fits a small card: its shape, name and record; the info panel has the rest. */
defineProps<{
    track: TrackDef
    active: boolean
    /** False for a course with no leaderboard, which hides the record row. */
    hasBoard: boolean
    /** `mine` comes from the server's ranking, which settles ties. */
    record: { lapMs: number, mine?: boolean } | null
    /** Who built it, for another player's course. */
    author?: string
    /** Its votes, for another player's course. */
    votes?: NrTrackVotes
}>()
defineEmits<{ select: [] }>()
</script>

<template>
  <button class="nr-track" :class="{ 'is-active': active }" :aria-pressed="active" @click="$emit('select')">
    <NitroRushTrackPreview class="nr-track-preview" :points="track.points" :heights="track.heights" :closed="track.closed !== false" :color="active ? '#ff2bd6' : '#3df2ff'" />
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline justify-between gap-2">
        <span class="nr-track-name">{{ track.name }}</span>
        <NitroRushScore v-if="votes" :votes="votes" />
      </div>
      <div v-if="author" class="nr-track-holder">by {{ author }}</div>
      <dl v-if="hasBoard" class="nr-track-times tabular-nums">
        <dt>RECORD</dt>
        <dd>
          {{ lapTimeOrBlank(record ? record.lapMs / 1000 : null) }}
          <span v-if="record?.mine" class="nr-crown" role="img" aria-label="Your record" title="Your record">
            <UIcon name="i-lucide-crown" class="size-full" />
          </span>
        </dd>
      </dl>
    </div>
  </button>
</template>
