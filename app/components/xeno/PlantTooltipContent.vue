<script setup lang="ts">
import { plantColor, effectiveGrowTime } from '#shared/utils/xeno'
import { formatDuration } from '~/utils/xeno-format'

const props = defineProps<{
  name: string
  tier: number
  color: string
  speed: number
  yield: number
  baseTime: number
  value: number
  description?: string
  quantity?: number
}>()

const growTime = computed(() => formatDuration(effectiveGrowTime({ baseTime: props.baseTime, speed: props.speed })))
const maxValue = computed(() => props.value * (1 + props.yield))
</script>

<template>
  <div class="w-56 p-3 space-y-3 bg-elevated border border-default rounded-xl shadow-xl">
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="font-bold text-sm">{{ name }}</p>
        <p
          v-if="quantity !== undefined"
          class="text-xs font-bold uppercase tracking-wider mt-0.5"
          :class="plantColor(color)"
        >
          {{ quantity }} remaining
        </p>
      </div>
      <XenoTierLabel :tier="tier" class="bg-elevated border border-default rounded-full px-2 py-0.5 shrink-0" />
    </div>

    <USeparator />

    <div class="space-y-1.5">
      <XenoStatLevel label="Speed" :level="speed" color="bg-warning" />
      <XenoStatLevel label="Yield" :level="yield" color="bg-info" />
    </div>

    <USeparator />

    <div class="space-y-1">
      <div class="flex justify-between text-xs">
        <span class="text-muted uppercase tracking-wider font-semibold">Growth</span>
        <span class="font-mono">{{ growTime }}</span>
      </div>
      <div class="flex justify-between text-xs">
        <span class="text-muted uppercase tracking-wider font-semibold">Yield</span>
        <span class="font-mono">1–{{ 1 + yield }} units</span>
      </div>
      <div class="flex justify-between text-xs">
        <span class="text-muted uppercase tracking-wider font-semibold">Value</span>
        <span class="font-mono">${{ formatNumber(value, false) }}–${{ formatNumber(maxValue, false) }}</span>
      </div>
    </div>

    <p v-if="description" class="text-xs text-muted/70 italic">{{ description }}</p>
  </div>
</template>
