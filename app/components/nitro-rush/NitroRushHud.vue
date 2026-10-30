<script setup lang="ts">
import { formatLapTime, lapTimeOrBlank } from '#shared/utils/nitro-rush/timing'
import type { TrackDef } from '#shared/utils/nitro-rush/track'
import type { HudState } from '~/utils/nitro-rush/types'

const props = defineProps<{
    hud: HudState
    track: TrackDef
    /** The player's place on this track's leaderboard, once they have one. */
    rank: { rank: number, entries: number } | null
    /** Other players driving this course right now, shown as live ghosts. */
    racers?: number
    isTouch: boolean
}>()
defineEmits<{ pause: [], nitro: [] }>()

const nitroFull = computed(() => !props.hud.nitroActive && props.hud.nitro >= 1)
const lapWord = computed(() => props.hud.closed ? 'LAP' : 'RUN')
/** Each recent lap against the personal best; the lap that set it reads as the best. */
const recent = computed(() => props.hud.recentLaps.map((l) => {
    const best = props.hud.bestLap
    const isBest = best !== null && l.time <= best
    return { ...l, isBest, delta: best === null || isBest ? '' : formatLapTime(l.time - best, true) }
}))
</script>

<template>
  <div class="pointer-events-none absolute inset-0 p-3 sm:p-5">
    <!-- The top left stays clear for a rival's panel in a head-to-head mode. -->
    <div class="flex items-start justify-end gap-2">
      <div class="nr-laps">
        <div class="nr-label">{{ lapWord }} <b class="nr-lap tabular-nums">{{ hud.lap }}</b></div>
        <NitroRushDigits class="nr-time block" :text="lapTimeOrBlank(hud.lapTime)" />
        <div class="nr-laps-row nr-laps-best">
          <span class="nr-label">BEST</span>
          <NitroRushDigits class="nr-mono nr-best" :text="lapTimeOrBlank(hud.bestLap)" />
        </div>
        <ol v-if="recent.length" class="nr-laps-recent">
          <li v-for="l in recent" :key="l.lap" class="nr-laps-row">
            <span class="nr-label">{{ lapWord }} {{ l.lap }}</span>
            <NitroRushDigits class="nr-mono" :class="{ 'nr-best': l.isBest }" :text="formatLapTime(l.time)" />
            <span class="nr-laps-delta">{{ l.delta }}</span>
          </li>
        </ol>
        <div v-if="rank" class="nr-label mt-1.5 tabular-nums">RANK <span class="nr-mono">#{{ rank.rank }}<span class="text-white/50"> / {{ rank.entries }}</span></span></div>
        <div v-if="racers" class="nr-label tabular-nums"><span class="nr-mono">{{ racers }}</span> RACING</div>
      </div>
      <button class="nr-icon-btn pointer-events-auto" aria-label="Pause" @click="$emit('pause')">
        <UIcon name="i-lucide-pause" class="size-4" />
      </button>
    </div>

    <div v-if="hud.wrongWay" class="absolute inset-x-0 top-[40%] text-center">
      <span class="nr-wrong">WRONG WAY</span>
    </div>

    <div class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 sm:p-5" :class="{ 'pb-32': isTouch }">
      <NitroRushMinimap :track="track" :car="hud.car" :ghosts="hud.ghosts" />
      <div class="flex min-w-0 flex-1 flex-col items-center gap-1.5 pb-1">
        <div class="nr-drift" :class="{ 'is-on': hud.drifting }">DRIFT</div>
        <button
          class="nr-nitro-bar pointer-events-auto"
          :class="{ 'is-full': nitroFull, 'is-active': hud.nitroActive }"
          @pointerdown.stop="$emit('nitro')"
        >
          <div class="nr-nitro-fill" :style="{ width: `${Math.min(1, hud.nitro) * 100}%` }" />
          <span class="nr-nitro-text">
            <UIcon name="i-lucide-zap" class="size-3.5" />
            {{ hud.nitroActive ? 'NITRO' : nitroFull ? (isTouch ? 'TAP FOR NITRO' : 'SHIFT FOR NITRO') : 'DRIFT TO CHARGE' }}
          </span>
        </button>
      </div>
      <NitroRushSpeedDial :kmh="hud.speedKmh" :nitro="hud.nitroActive" />
    </div>
  </div>
</template>

<style src="./nitro-rush-hud.css"></style>
