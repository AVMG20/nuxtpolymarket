<script setup lang="ts">
import { Track, type TrackDef } from '#shared/utils/nitro-rush/track'
import { cssColor } from '~/utils/nitro-rush/config'
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
const ghosts = computed(() => props.ghosts.map(g => ({ at: toMap(plan.value.fit, g.x, g.z), fill: cssColor(g.color) })))
</script>

<template>
  <svg class="nr-minimap" :viewBox="`0 0 ${MINIMAP_VIEW} ${MINIMAP_VIEW}`" aria-hidden="true">
    <path class="nr-minimap-edge" :d="plan.road" />
    <path class="nr-minimap-road" :d="plan.road" />
    <polygon v-for="(f, i) in plan.fields" :key="`floor${i}`" class="nr-minimap-field" :points="f.floor" />
    <path v-for="(f, i) in plan.fields" :key="`rim${i}`" class="nr-minimap-rim" :d="f.rim" />
    <g v-for="(f, i) in plan.fields" :key="`field${i}`">
      <polygon v-for="(b, j) in f.blocks" :key="`b${j}`" class="nr-minimap-block" :points="b" />
      <polygon v-for="(p, j) in f.pads" :key="`p${j}`" class="nr-minimap-pad" :points="p" />
      <line v-for="(g, j) in f.gates" :key="`g${j}`" class="nr-minimap-line" :class="{ 'is-required': g.required }" :x1="g.x1" :y1="g.y1" :x2="g.x2" :y2="g.y2" />
    </g>
    <line class="nr-minimap-line" v-bind="plan.start" />
    <line v-for="(f, i) in plan.finishes" :key="`f${i}`" class="nr-minimap-line is-finish" v-bind="f" />
    <line v-for="(r, i) in plan.required" :key="`r${i}`" class="nr-minimap-line is-required" v-bind="r" />
    <circle v-for="(g, i) in ghosts" :key="i" class="nr-minimap-ghost" :cx="g.at[0]" :cy="g.at[1]" r="2.6" :fill="g.fill" />
    <path class="nr-minimap-car" d="M0 -5 L3.8 4 L0 2.2 L-3.8 4 Z" :transform="`translate(${car[0]} ${car[1]}) rotate(${markerRotation(props.car.heading)})`" />
  </svg>
</template>
