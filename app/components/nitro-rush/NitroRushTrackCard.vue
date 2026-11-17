<script setup lang="ts">
import type { Medal } from '~/utils/nitro-rush/medals'
import { lapTimeOrBlank } from '#shared/utils/nitro-rush/timing'
import type { TrackDef } from '#shared/utils/nitro-rush/track'
import type { NrTrackVotes } from '#server/utils/nitro-rush-tracks'
import { playCounts } from '~/utils/nitro-rush/community'
import type { TrackPlays } from '#shared/utils/nitro-rush/popularity'

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
    /** Its series, for a built-in course shown outside its group. */
    group?: string
    /** Its votes, for a built-in or another player's course. */
    votes?: NrTrackVotes
    /** How much it is raced, for a course with a board. */
    plays?: TrackPlays
    /** The medal the viewer's best holds on it. */
    medal?: Medal | null
}>()
defineEmits<{ select: [] }>()
</script>

<template>
  <button class="nr-track" :class="{ 'is-active': active }" :aria-pressed="active" @click="$emit('select')">
    <span class="nr-track-thumb">
      <NitroRushTrackPreview class="nr-track-preview" :points="track.points" :heights="track.heights" :closed="track.closed !== false" :branches="track.branches" :fields="track.fields" :color="active ? '#ff2bd6' : '#3df2ff'" />
      <NitroRushMedal class="nr-track-medal" :medal="medal ?? null" />
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline justify-between gap-2">
        <span class="nr-track-name">{{ track.name }}</span>
        <span class="flex shrink-0 items-baseline gap-2">
          <span v-if="plays?.laps" class="nr-score tabular-nums" :title="playCounts(plays)">
            <UIcon name="i-lucide-repeat" class="size-3" />
            {{ formatNumber(plays.laps) }}
          </span>
          <NitroRushScore v-if="votes" :votes="votes" />
        </span>
      </div>
      <div v-if="author" class="nr-track-holder">by {{ author }}</div>
      <div v-else-if="group" class="nr-track-holder">{{ group }}</div>
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
