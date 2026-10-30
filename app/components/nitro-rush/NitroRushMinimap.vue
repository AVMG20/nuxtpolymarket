<script setup lang="ts">
import { Track, type TrackDef } from '#shared/utils/nitro-rush/track'
import { markerRotation, MINIMAP_VIEW, minimapPlan, toMap } from '~/utils/nitro-rush/minimap'
import type { HudState, MapGhost } from '~/utils/nitro-rush/types'

/** The course from above, with the car and every ghost on it. */
const props = defineProps<{
    track: TrackDef
    car: HudState['car']
    ghosts: readonly MapGhost[]
}>()

const plan = computed(() => minimapPlan(new Track(props.track)))
const car = computed(() => toMap(plan.value.fit, props.car.x, props.car.z))
const ghosts = computed(() => props.ghosts.map(g => ({ at: toMap(plan.value.fit, g.x, g.z), fill: `#${g.color.toString(16).padStart(6, '0')}` })))
</script>

<template>
  <svg class="nr-minimap" :viewBox="`0 0 ${MINIMAP_VIEW} ${MINIMAP_VIEW}`" aria-hidden="true">
    <path class="nr-minimap-edge" :d="plan.road" />
    <path class="nr-minimap-road" :d="plan.road" />
    <line class="nr-minimap-line" v-bind="plan.start" />
    <line v-if="plan.finish" class="nr-minimap-line is-finish" v-bind="plan.finish" />
    <circle v-for="(g, i) in ghosts" :key="i" class="nr-minimap-ghost" :cx="g.at[0]" :cy="g.at[1]" r="2.6" :fill="g.fill" />
    <path class="nr-minimap-car" d="M0 -5 L3.8 4 L0 2.2 L-3.8 4 Z" :transform="`translate(${car[0]} ${car[1]}) rotate(${markerRotation(props.car.heading)})`" />
  </svg>
</template>
