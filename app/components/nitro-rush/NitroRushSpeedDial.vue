<script setup lang="ts">
import { DIAL_MAX_KMH, DIAL_NITRO_KMH, DIAL_VIEW, dialArc, dialLabels, dialTicks, needleRotation } from '~/utils/nitro-rush/speed-dial'

/** An analog speedometer with the exact speed read out under the needle. */
const props = defineProps<{ kmh: number, nitro: boolean }>()

const C = DIAL_VIEW / 2
const RIM = 46
/** Drawn pointing right from a short tail behind the hub, then turned to the speed. */
const NEEDLE = `M${C - 6} ${C - 1.6}L${C + RIM - 6} ${C}L${C - 6} ${C + 1.6}Z`
const TICKS = dialTicks(RIM - 3)
const LABELS = dialLabels(RIM - 17)
const NITRO_ZONE = dialArc(DIAL_NITRO_KMH, DIAL_MAX_KMH, RIM)
const TRACK = dialArc(0, DIAL_MAX_KMH, RIM)

const fill = computed(() => dialArc(0, props.kmh, RIM))
</script>

<template>
  <div class="nr-dial" :class="{ 'is-nitro': nitro }">
    <svg :viewBox="`0 0 ${DIAL_VIEW} ${DIAL_VIEW}`" aria-hidden="true">
      <circle class="nr-dial-face" :cx="C" :cy="C" r="49" />
      <path class="nr-dial-track" :d="TRACK" />
      <path class="nr-dial-zone" :d="NITRO_ZONE" />
      <path v-if="fill" class="nr-dial-fill" :d="fill" />
      <line v-for="(t, i) in TICKS" :key="i" class="nr-dial-tick" :class="{ 'is-major': t.major }" :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" />
      <text v-for="l in LABELS" :key="l.text" class="nr-dial-num" :x="l.x" :y="l.y">{{ l.text }}</text>
      <path class="nr-dial-needle" :d="NEEDLE" :transform="`rotate(${needleRotation(kmh)} ${C} ${C})`" />
      <circle class="nr-dial-hub" :cx="C" :cy="C" r="4" />
    </svg>
    <div class="nr-dial-readout">
      <NitroRushDigits class="nr-dial-speed" :text="kmh" />
      <span class="nr-label">KM/H</span>
    </div>
  </div>
</template>
