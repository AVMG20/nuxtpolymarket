<script setup lang="ts">
import { TRACK_SORTS, type TrackSort } from '~/utils/nitro-rush/community'

/** The order a course list shows in; each list names its own order. */
defineProps<{
    /** What the list's own order is called: NEWEST, GROUPS. */
    listed: string
}>()
const sort = defineModel<TrackSort>({ required: true })

const label = (id: TrackSort, listed: string) => id === 'listed' ? listed : id === 'top' ? 'TOP' : 'POPULAR'
</script>

<template>
  <div class="nr-seg" role="radiogroup" aria-label="Sort tracks">
    <button
      v-for="s in TRACK_SORTS"
      :key="s"
      class="nr-seg-btn"
      :class="{ 'is-active': sort === s }"
      role="radio"
      :aria-checked="sort === s"
      @click="sort = s"
    >
      {{ label(s, listed) }}
    </button>
  </div>
</template>
