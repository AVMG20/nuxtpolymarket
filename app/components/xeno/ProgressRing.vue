<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** 0–100 */
  pct: number
  size?: number
  stroke?: number
  ready?: boolean
}>(), { size: 72, stroke: 3.5, ready: false })

const r = computed(() => (props.size - props.stroke) / 2)
const circumference = computed(() => 2 * Math.PI * r.value)
const offset = computed(() => circumference.value * (1 - Math.min(100, Math.max(0, props.pct)) / 100))
</script>

<template>
  <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" class="absolute inset-0 m-auto pointer-events-none" aria-hidden="true">
    <circle :cx="size / 2" :cy="size / 2" :r="r" fill="none" class="xeno-ring-track" :stroke-width="stroke" />
    <circle
      :cx="size / 2" :cy="size / 2" :r="r" fill="none"
      class="xeno-ring-fill"
      :class="ready ? 'xeno-ring-ready' : ''"
      :stroke-width="stroke"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="ready ? 0 : offset"
      :transform="`rotate(-90 ${size / 2} ${size / 2})`"
    />
  </svg>
</template>
