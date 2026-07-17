<script setup lang="ts">
import { parseEmblem, type EmblemPlacedShape } from '#shared/utils/emblem'

const props = defineProps<{
  emblem?: unknown
  name?: string | null
}>()

const data = computed(() => parseEmblem(props.emblem))
const initial = computed(() => (props.name?.trim().charAt(0) || 'P').toUpperCase())

function polygonPoints(element: EmblemPlacedShape) {
  const count = element.shape === 'triangle' ? 3 : 4
  const start = element.shape === 'triangle' ? -90 : -45
  return Array.from({ length: count }, (_, index) => {
    const angle = ((start + element.rotation + index * (360 / count)) * Math.PI) / 180
    const radius = element.size / 2
    return `${element.x + Math.cos(angle) * radius},${element.y + Math.sin(angle) * radius}`
  }).join(' ')
}

function starPoints(element: EmblemPlacedShape) {
  return Array.from({ length: 10 }, (_, index) => {
    const angle = ((-90 + element.rotation + index * 36) * Math.PI) / 180
    const radius = index % 2 === 0 ? element.size / 2 : element.size / 4.5
    return `${element.x + Math.cos(angle) * radius},${element.y + Math.sin(angle) * radius}`
  }).join(' ')
}

function pathData(points: [number, number][]) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point[0]} ${point[1]}`).join(' ')
}
</script>

<template>
  <span class="relative inline-flex aspect-square shrink-0 overflow-hidden rounded-full border border-default bg-elevated align-middle">
    <svg
      v-if="data"
      aria-hidden="true"
      class="size-full"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 100 100"
    >
      <rect :fill="data.background" height="100" width="100" />
      <template v-for="(element, index) in data.elements" :key="index">
        <path
          v-if="element.kind === 'stroke'"
          :d="pathData(element.points)"
          :stroke="element.color"
          :stroke-width="element.width"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle
          v-else-if="element.shape === 'circle'"
          :cx="element.x"
          :cy="element.y"
          :fill="element.color"
          :r="element.size / 2"
        />
        <rect
          v-else-if="element.shape === 'square'"
          :fill="element.color"
          :height="element.size"
          :transform="`rotate(${element.rotation} ${element.x} ${element.y})`"
          :width="element.size"
          :x="element.x - element.size / 2"
          :y="element.y - element.size / 2"
          rx="2"
        />
        <polygon
          v-else-if="element.shape === 'star'"
          :fill="element.color"
          :points="starPoints(element)"
        />
        <polygon
          v-else
          :fill="element.color"
          :points="polygonPoints(element)"
        />
      </template>
    </svg>
    <span v-else class="flex size-full items-center justify-center bg-primary/15 font-bold text-primary">
      {{ initial }}
    </span>
  </span>
</template>
