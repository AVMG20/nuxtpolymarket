<script setup lang="ts">
import { voteCounts, voteScore } from '~/utils/nitro-rush/community'
import type { NrTrackVotes, NrVote } from '#server/utils/nitro-rush-tracks'

/** A course's score with up and down buttons; tapping the lit one takes the vote back. */
const props = defineProps<{
    votes: NrTrackVotes
    busy: boolean
}>()
const emit = defineEmits<{ vote: [value: NrVote] }>()

const tap = (value: 1 | -1) => emit('vote', props.votes.myVote === value ? 0 : value)
</script>

<template>
  <div class="nr-vote">
    <button
      class="nr-vote-btn"
      :class="{ 'is-up': votes.myVote === 1 }"
      :aria-pressed="votes.myVote === 1"
      aria-label="Like"
      title="Like"
      :disabled="busy"
      @click="tap(1)"
    >
      <UIcon name="i-lucide-thumbs-up" class="size-3.5" />
    </button>
    <span class="nr-vote-score tabular-nums" :title="voteCounts(votes)">{{ voteScore(votes) }}</span>
    <button
      class="nr-vote-btn"
      :class="{ 'is-down': votes.myVote === -1 }"
      :aria-pressed="votes.myVote === -1"
      aria-label="Dislike"
      title="Dislike"
      :disabled="busy"
      @click="tap(-1)"
    >
      <UIcon name="i-lucide-thumbs-down" class="size-3.5" />
    </button>
  </div>
</template>
