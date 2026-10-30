<script setup lang="ts">
import { findPaint, PAINTS, type PaintId } from '~/utils/nitro-rush/config'
import { bestLap } from '~/utils/nitro-rush/record'
import type { CommunityTrackEntry, CustomTrackEntry, TrackRecord } from '~/utils/nitro-rush/types'
import { findTrack } from '#shared/utils/nitro-rush/tracks'
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
    /** The player's own courses, finished or not. */
    customTracks: CustomTrackEntry[]
    /** Other players' published courses. */
    communityTracks: CommunityTrackEntry[]
    /** The own course being published or taken down. */
    busy: string | null
}>()
defineEmits<{ back: [], select: [id: string], paint: [id: PaintId], start: [], build: [id?: string], publish: [id: string], unpublish: [id: string] }>()

type Tab = 'tracks' | 'community' | 'mine'
const TABS: readonly { id: Tab, label: string }[] = [
    { id: 'tracks', label: 'TRACKS' },
    { id: 'community', label: 'COMMUNITY' },
    { id: 'mine', label: 'MY TRACKS' }
]
/** Opens on the tab holding the course on the engine. */
const tab = ref<Tab>(findTrack(props.trackId) ? 'tracks' : props.communityTracks.some(c => c.track.id === props.trackId) ? 'community' : 'mine')
const paintLabel = computed(() => findPaint(props.paint).label)
const best = (id: string) => bestLap(props.records[id], props.summaries[id])
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
      <div class="nr-card flex w-full flex-col text-left lg:max-h-full lg:max-w-2xl">
        <div class="nr-tabs" role="tablist">
          <button
            v-for="t in TABS"
            :key="t.id"
            class="nr-tab"
            :class="{ 'is-active': tab === t.id }"
            role="tab"
            :aria-selected="tab === t.id"
            @click="tab = t.id"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="mt-4 lg:min-h-0 lg:overflow-y-auto" role="tabpanel">
          <NitroRushBuiltInTracks v-if="tab === 'tracks'" :track-id="trackId" :summaries="summaries" :best="best" @select="$emit('select', $event)" />
          <NitroRushCommunityTracks v-else-if="tab === 'community'" :track-id="trackId" :tracks="communityTracks" :summaries="summaries" :best="best" @select="$emit('select', $event)" />
          <NitroRushMyTracks
            v-else
            :track-id="trackId"
            :tracks="customTracks"
            :summaries="summaries"
            :best="best"
            :busy="busy"
            @select="$emit('select', $event)"
            @build="$emit('build', $event)"
            @publish="$emit('publish', $event)"
            @unpublish="$emit('unpublish', $event)"
          />
        </div>
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
