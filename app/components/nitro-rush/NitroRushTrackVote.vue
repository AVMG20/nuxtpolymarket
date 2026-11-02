<script setup lang="ts">
import { trackScore, voteCounts } from '~/utils/nitro-rush/community'
import type { NrPublishedTrack, NrVote } from '#server/utils/nitro-rush-tracks'

/** A community course's score with up and down buttons; tapping the lit one takes the vote back. */
const props = defineProps<{
    track: NrPublishedTrack
    busy: boolean
}>()
const emit = defineEmits<{ vote: [value: NrVote] }>()

const tap = (value: 1 | -1) => emit('vote', props.track.votes.myVote === value ? 0 : value)
</script>

<template>
  <div class="nr-vote">
    <button
      class="nr-vote-btn"
      :class="{ 'is-up': track.votes.myVote === 1 }"
      :aria-pressed="track.votes.myVote === 1"
      aria-label="Like"
      title="Like"
      :disabled="busy"
      @click="tap(1)"
    >
      <UIcon name="i-lucide-thumbs-up" class="size-3.5" />
    </button>
    <span class="nr-vote-score tabular-nums" :title="voteCounts(track.votes)">{{ trackScore(track) }}</span>
    <button
      class="nr-vote-btn"
      :class="{ 'is-down': track.votes.myVote === -1 }"
      :aria-pressed="track.votes.myVote === -1"
      aria-label="Dislike"
      title="Dislike"
      :disabled="busy"
      @click="tap(-1)"
    >
      <UIcon name="i-lucide-thumbs-down" class="size-3.5" />
    </button>
  </div>
</template>
