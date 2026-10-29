<script setup lang="ts">
import { lapTimeOrBlank } from '#shared/utils/nitro-rush/timing'
import type { HudState } from '~/utils/nitro-rush/types'

const props = defineProps<{
    hud: HudState
    /** The player's place on this track's leaderboard, once they have one. */
    rank: { rank: number, entries: number } | null
    /** Other players driving this course right now, shown as live ghosts. */
    racers?: number
    isTouch: boolean
}>()
defineEmits<{ pause: [], nitro: [] }>()

const nitroFull = computed(() => !props.hud.nitroActive && props.hud.nitro >= 1)
</script>

<template>
  <div class="pointer-events-none absolute inset-0 p-3 sm:p-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="nr-label">{{ hud.closed ? 'LAP' : 'RUN' }} <b class="nr-lap tabular-nums">{{ hud.lap }}</b></div>
        <NitroRushDigits class="nr-time block" :text="lapTimeOrBlank(hud.lapTime)" />
        <div class="mt-1.5 flex flex-col gap-0.5">
          <div class="nr-label tabular-nums">LAST <span class="nr-mono">{{ lapTimeOrBlank(hud.lastLap) }}</span></div>
          <div class="nr-label tabular-nums">BEST <span class="nr-mono nr-best">{{ lapTimeOrBlank(hud.bestLap) }}</span></div>
        </div>
      </div>
      <div class="flex flex-col items-end gap-1.5">
        <button class="nr-icon-btn pointer-events-auto" aria-label="Pause" @click="$emit('pause')">
          <UIcon name="i-lucide-pause" class="size-4" />
        </button>
        <div class="nr-label">SESSION BEST</div>
        <div class="nr-total tabular-nums">{{ lapTimeOrBlank(hud.sessionBest) }}</div>
        <div v-if="rank" class="nr-label tabular-nums">RANK <span class="nr-mono">#{{ rank.rank }}<span class="text-white/50"> / {{ rank.entries }}</span></span></div>
        <div v-if="racers" class="nr-label tabular-nums"><span class="nr-mono">{{ racers }}</span> RACING</div>
      </div>
    </div>

    <div v-if="hud.wrongWay" class="absolute inset-x-0 top-[40%] text-center">
      <span class="nr-wrong">WRONG WAY</span>
    </div>

    <div class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 sm:p-5" :class="{ 'pb-32': isTouch }">
      <div class="nr-speedo">
        <NitroRushDigits :text="hud.speedKmh" />
        <span class="nr-label">KM/H</span>
      </div>
      <div class="flex flex-1 flex-col items-center gap-1.5 pb-1">
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
      <div class="nr-speedo invisible" aria-hidden="true">
        <span>000</span>
      </div>
    </div>
  </div>
</template>
