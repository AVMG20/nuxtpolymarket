<script setup lang="ts">
import { findCar, findPaint, type CarId, type PaintId } from '~/utils/nitro-rush/config'
import { bestLap } from '~/utils/nitro-rush/record'
import type { CommunityTrackEntry, CustomTrackEntry, TrackRecord } from '~/utils/nitro-rush/types'
import type { TrackDef } from '#shared/utils/nitro-rush/track'
import { findTrack } from '#shared/utils/nitro-rush/tracks'
import { GHOST_MAX_SECONDS } from '#shared/utils/nitro-rush/ghost'
import type { NrBoard, NrTrackSummary } from '#server/utils/nitro-rush'
import type { NrTrackVotes, NrVote } from '#server/utils/nitro-rush-tracks'
import { NO_VOTES } from '~/utils/nitro-rush/community'

const props = defineProps<{
    trackId: string
    trackName: string
    /** The course on the engine. */
    trackDef: TrackDef | null
    /** Its leaderboard; null until it is in. */
    board: NrBoard | null
    boardLoading: boolean
    car: CarId
    paint: PaintId
    isTouch: boolean
    hasPad: boolean
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
    /** Every course's votes, by id. */
    votes: Record<string, NrTrackVotes>
    /** Courses with a vote in flight. */
    voting: Set<string>
    /** Players driving each public course right now, by id. */
    racing: Record<string, number>
}>()
defineEmits<{ back: [], select: [id: string], car: [id: CarId], garage: [open: boolean], paint: [id: PaintId], start: [], build: [id?: string], publish: [id: string], unpublish: [id: string], delete: [id: string], vote: [id: string, value: NrVote] }>()

type Tab = 'tracks' | 'community' | 'mine' | 'garage'
const TABS: readonly { id: Tab, label: string }[] = [
    { id: 'tracks', label: 'TRACKS' },
    { id: 'community', label: 'COMMUNITY' },
    { id: 'mine', label: 'MY TRACKS' },
    { id: 'garage', label: 'GARAGE' }
]
/** Opens on the tab holding the course on the engine. */
const tab = ref<Tab>(findTrack(props.trackId) ? 'tracks' : props.communityTracks.some(c => c.track.id === props.trackId) ? 'community' : 'mine')
const carSummary = computed(() => `${findCar(props.car).label} · ${findPaint(props.paint).label}`)
const best = (id: string) => bestLap(props.records[id], props.summaries[id])
const medals = useNitroRushMedals()
/** Only courses the viewer has a time on are ever worked out. */
const medalOn = (id: string, def: TrackDef) => medals.medalOf(def, best(id))
/** Publishing a road needs a lap driven on it in this browser, ghost and all. */
const hasLap = (id: string) => !!props.records[id]?.ghost
/** Its best lap ran past what a ghost holds, so no lap driven so far can publish it. */
const lapTooLong = (id: string) => !hasLap(id) && (props.records[id]?.bestLap ?? 0) > GHOST_MAX_SECONDS

const votesOf = (id: string) => props.votes[id] ?? NO_VOTES
/** The selected course as the side panel shows it: any public course can be voted on, the player's own included. */
const selected = computed((): { author: string | null, votes: NrTrackVotes | null, canVote: boolean } => {
    if (findTrack(props.trackId)) return { author: null, votes: votesOf(props.trackId), canVote: true }
    const listed = props.communityTracks.find(c => c.track.id === props.trackId)
    if (listed) return { author: listed.mine ? 'you' : listed.track.author, votes: votesOf(props.trackId), canVote: true }
    const own = props.customTracks.find(c => c.playId === props.trackId)
    // A private course has no votes.
    const published = own?.published?.id === props.trackId
    return { author: own ? 'you' : null, votes: published ? votesOf(props.trackId) : null, canVote: published }
})
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
      <div class="nr-card flex w-full flex-col text-left lg:max-h-full lg:max-w-4xl">
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
          <NitroRushBuiltInTracks v-if="tab === 'tracks'" :track-id="trackId" :summaries="summaries" :votes="votes" :racing="racing" :medal-on="medalOn" @select="$emit('select', $event)" />
          <NitroRushCommunityTracks v-else-if="tab === 'community'" :track-id="trackId" :tracks="communityTracks" :summaries="summaries" :votes="votes" :racing="racing" :medal-on="medalOn" @select="$emit('select', $event)" />
          <NitroRushGarage v-else-if="tab === 'garage'" :car="car" :paint="paint" @select="$emit('car', $event)" @paint="$emit('paint', $event)" @open="$emit('garage', $event)" />
          <NitroRushMyTracks
            v-else
            :track-id="trackId"
            :tracks="customTracks"
            :summaries="summaries"
            :medal-on="medalOn"
            :busy="busy"
            :has-lap="hasLap"
            :lap-too-long="lapTooLong"
            @select="$emit('select', $event)"
            @build="$emit('build', $event)"
            @publish="$emit('publish', $event)"
            @unpublish="$emit('unpublish', $event)"
            @delete="$emit('delete', $event)"
          />
        </div>
      </div>

      <div class="nr-card flex w-full flex-col gap-4 text-left lg:w-72 lg:shrink-0">
        <div>
          <div class="nr-label mb-1">CAR</div>
          <div class="text-sm text-white/70">{{ carSummary }}</div>
        </div>
        <NitroRushTrackInfo
          :track-id="trackId"
          :track-name="trackName"
          :def="trackDef"
          :author="selected.author"
          :votes="selected.votes"
          :can-vote="selected.canVote"
          :voting="voting.has(trackId)"
          :board="board"
          :board-loading="boardLoading"
          :best="best(trackId)"
          :racing="racing[trackId] ?? 0"
          @vote="$emit('vote', trackId, $event)"
        />
        <button class="nr-play self-center" @click="$emit('start')">
          <UIcon name="i-lucide-flag" class="size-6" />
          START
        </button>
        <p v-if="hasPad || !isTouch" class="text-center text-[11px] font-semibold text-white/50 [font-family:system-ui,sans-serif]">{{ hasPad ? 'D-pad: browse · A: pick · Start: race · B: back' : 'Enter to start · Esc for the title' }}</p>
      </div>
    </div>
  </div>
</template>
