<script setup lang="ts">
import { emblemPolygonPoints, emblemStarPoints, emblemStrokePath, parseEmblem } from '#shared/utils/emblem'
import { prestigeTier } from '#shared/utils/prestige'

const props = defineProps<{
  emblem?: unknown
  name?: string | null
  /** 0-4. Draws the rotating prestige ring around the emblem when above 0. */
  prestige?: number | null
}>()

const data = computed(() => parseEmblem(props.emblem))
const initial = computed(() => (props.name?.trim().charAt(0) || 'P').toUpperCase())
const tier = computed(() => prestigeTier(props.prestige))

// The ring is a full conic-gradient disc sitting behind an opaque emblem that
// covers its middle — only the rim shows. Cheaper and far more robust across
// every size this component is rendered at than masking a real ring would be.
const ringStyle = computed(() => tier.value && {
  background: tier.value.ring,
  animationDuration: `${tier.value.spinSeconds}s`
})
const glowStyle = computed(() => tier.value && {
  background: tier.value.accent
})
</script>

<template>
  <span class="relative inline-flex aspect-square shrink-0 rounded-full align-middle">
    <template v-if="tier">
      <span
        aria-hidden="true"
        class="pointer-events-none absolute -inset-[12%] rounded-full opacity-45 blur-[5px]"
        :style="glowStyle"
      />
      <span
        aria-hidden="true"
        class="pointer-events-none absolute -inset-[9%] animate-spin rounded-full motion-reduce:animate-none"
        :style="ringStyle"
      />
    </template>

    <span class="relative flex size-full overflow-hidden rounded-full border border-default bg-elevated">
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
            :d="emblemStrokePath(element.points)"
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
            :points="emblemStarPoints(element)"
          />
          <polygon
            v-else
            :fill="element.color"
            :points="emblemPolygonPoints(element)"
          />
        </template>
      </svg>
      <span v-else class="flex size-full items-center justify-center bg-primary/15 font-bold text-primary">
        {{ initial }}
      </span>
    </span>
  </span>
</template>
