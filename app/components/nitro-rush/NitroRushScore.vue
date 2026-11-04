<script setup lang="ts">
import { voteCounts, voteScore } from '~/utils/nitro-rush/community'
import type { NrTrackVotes } from '#server/utils/nitro-rush-tracks'

/** A published course's net votes as a quiet chip, where there's no voting to be done. */
const props = defineProps<{ votes: NrTrackVotes }>()
const score = computed(() => voteScore(props.votes))
</script>

<template>
  <span class="nr-score tabular-nums" :class="{ 'is-down': score < 0 }" :title="voteCounts(votes)">
    <UIcon :name="score < 0 ? 'i-lucide-thumbs-down' : 'i-lucide-thumbs-up'" class="size-3" />
    {{ score }}
  </span>
</template>
