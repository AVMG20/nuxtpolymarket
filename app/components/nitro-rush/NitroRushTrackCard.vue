<script setup lang="ts">
import { lapTimeOrBlank } from '#shared/utils/nitro-rush/timing'
import { Track, type TrackDef } from '#shared/utils/nitro-rush/track'

/** One course on the track menu: its shape, length, the record and the player's best. */
const props = defineProps<{
    track: TrackDef
    active: boolean
    /** False for a course with no leaderboard, which hides the record row. */
    hasBoard: boolean
    record: { name: string, lapMs: number } | null
    /** The player's best lap, in seconds. */
    best: number | null
    /** Who built it, for another player's course. */
    author?: string
}>()
defineEmits<{ select: [] }>()

const km = computed(() => new Track(props.track).lapLength / 1000)
</script>

<template>
  <button class="nr-track" :class="{ 'is-active': active }" :aria-pressed="active" @click="$emit('select')">
    <NitroRushTrackPreview class="nr-track-preview" :points="track.points" :heights="track.heights" :closed="track.closed !== false" :color="active ? '#ff2bd6' : '#3df2ff'" />
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline justify-between gap-2">
        <span class="nr-track-name">{{ track.name }}</span>
        <span class="shrink-0 text-[11px] text-white/50 tabular-nums">{{ km.toFixed(2) }} KM</span>
      </div>
      <div v-if="author" class="nr-track-holder">by {{ author }}</div>
      <dl class="nr-track-times tabular-nums">
        <template v-if="hasBoard">
          <dt>RECORD</dt>
          <dd>
            {{ lapTimeOrBlank(record ? record.lapMs / 1000 : null) }}
            <span v-if="record" class="nr-track-holder">{{ record.name }}</span>
          </dd>
        </template>
        <dt>YOUR BEST</dt>
        <dd class="is-you">{{ lapTimeOrBlank(best) }}</dd>
      </dl>
    </div>
  </button>
</template>
