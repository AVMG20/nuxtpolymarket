<script setup lang="ts">
import { findPaint, PAINTS, type PaintId } from '~/utils/nitro-rush/config'
import type { TrackRecord } from '~/utils/nitro-rush/types'
import { lapTimeOrBlank } from '#shared/utils/nitro-rush/timing'
import { Track } from '#shared/utils/nitro-rush/track'
import { TRACK_GROUPS, TRACKS } from '#shared/utils/nitro-rush/tracks'
import type { NrTrackSummary } from '#server/utils/nitro-rush'

const props = defineProps<{
    trackId: string
    trackName: string
    paint: PaintId
    isTouch: boolean
    /** This browser's bests, by track. */
    records: Record<string, TrackRecord>
    /** The leaderboard's record and the player's own best, by track. */
    summaries: Record<string, NrTrackSummary>
}>()
defineEmits<{ back: [], select: [id: string], paint: [id: PaintId], start: [] }>()

const trackGroups = TRACK_GROUPS
    .map(g => ({ ...g, tracks: TRACKS.filter(t => t.group === g.id).map(t => ({ ...t, km: new Track(t).lapLength / 1000 })) }))
    .filter(g => g.tracks.length)
const paintLabel = computed(() => findPaint(props.paint).label)
const trackRecord = (id: string) => props.summaries[id]?.record ?? null

/** Quickest of this browser's best and the server's, which may have been set on another device. */
function myBest(id: string) {
    const local = props.records[id]?.bestLap ?? null
    const server = props.summaries[id]?.myLapMs ?? null
    if (server === null) return local
    return local === null ? server / 1000 : Math.min(local, server / 1000)
}
</script>

<template>
  <div class="nr-select absolute inset-0 flex flex-col gap-4 overflow-y-auto p-4 sm:p-6 lg:overflow-hidden">
    <div class="flex items-center gap-3 pr-32">
      <button class="nr-icon-btn shrink-0" aria-label="Back to the title screen" @click="$emit('back')">
        <UIcon name="i-lucide-chevron-left" class="size-5" />
      </button>
      <h2 class="nr-heading">CHOOSE A TRACK</h2>
    </div>

    <div class="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-start lg:justify-between">
      <div class="nr-card w-full text-left lg:max-h-full lg:max-w-2xl lg:overflow-y-auto">
        <section v-for="g in trackGroups" :key="g.id" class="mt-5 first:mt-0">
          <div class="mb-1.5 flex items-baseline justify-between gap-3">
            <h3 class="nr-group">{{ g.name.toUpperCase() }}</h3>
            <span class="truncate text-[11px] font-semibold text-white/50 [font-family:system-ui,sans-serif]">{{ g.blurb }}</span>
          </div>
          <div class="nr-track-grid">
            <button
              v-for="t in g.tracks"
              :key="t.id"
              class="nr-track"
              :class="{ 'is-active': t.id === trackId }"
              :aria-pressed="t.id === trackId"
              @click="$emit('select', t.id)"
            >
              <NitroRushTrackPreview class="nr-track-preview" :points="t.points" :heights="t.heights" :closed="t.closed !== false" :color="t.id === trackId ? '#ff2bd6' : '#3df2ff'" />
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline justify-between gap-2">
                  <span class="nr-track-name">{{ t.name }}</span>
                  <span class="shrink-0 text-[11px] text-white/50 tabular-nums">{{ t.km.toFixed(2) }} KM</span>
                </div>
                <dl class="nr-track-times tabular-nums">
                  <dt>RECORD</dt>
                  <dd>
                    {{ lapTimeOrBlank(trackRecord(t.id) ? trackRecord(t.id)!.lapMs / 1000 : null) }}
                    <span v-if="trackRecord(t.id)" class="nr-track-holder">{{ trackRecord(t.id)!.name }}</span>
                  </dd>
                  <dt>YOUR BEST</dt>
                  <dd class="is-you">{{ lapTimeOrBlank(myBest(t.id)) }}</dd>
                </dl>
              </div>
            </button>
          </div>
        </section>
      </div>

      <div class="nr-card flex w-full flex-col gap-4 text-left lg:w-72 lg:shrink-0">
        <div>
          <div class="nr-label mb-2">CAR</div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-for="p in PAINTS"
              :key="p.id"
              class="nr-swatch"
              :class="{ 'is-active': paint === p.id }"
              :style="{ '--swatch': `#${p.color.toString(16).padStart(6, '0')}` }"
              :aria-label="p.label"
              :title="p.label"
              @click="$emit('paint', p.id)"
            />
          </div>
          <div class="mt-2 text-sm text-white/70">{{ paintLabel }}</div>
        </div>
        <div>
          <div class="nr-label mb-1">TRACK</div>
          <div class="nr-track-name">{{ trackName }}</div>
        </div>
        <button class="nr-play self-center" @click="$emit('start')">
          <UIcon name="i-lucide-flag" class="size-6" />
          START
        </button>
        <p v-if="!isTouch" class="text-center text-[11px] font-semibold text-white/50 [font-family:system-ui,sans-serif]">Enter to start · Esc for the title</p>
      </div>
    </div>
  </div>
</template>
