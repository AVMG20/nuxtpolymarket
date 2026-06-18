<script setup lang="ts">
import { tierNameColor, effectiveGrowTime } from '#shared/utils/xeno'
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
const avgValue = computed(() => props.value * (1 + props.yield / 2))
</script>

<template>
  <div class="w-56 p-3 space-y-3 bg-elevated border border-default rounded-xl shadow-xl">
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="font-bold text-sm" :class="tierNameColor(tier)">{{ name }}</p>
        <p v-if="quantity !== undefined" class="text-xs font-semibold mt-0.5">
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
        <span class="font-mono">1–{{ 1 + yield }}</span>
      </div>
      <div class="flex justify-between text-xs">
        <span class="text-muted uppercase tracking-wider font-semibold">Value</span>
        <CoinBalance :showIcon="false" :value="value" :compact="false" />
      </div>
      <div class="flex justify-between text-xs">
        <span class="text-muted uppercase tracking-wider font-semibold">Avg value</span>
        <CoinBalance :showIcon="false" :value="avgValue" :compact="false" />
      </div>
    </div>

    <p v-if="description" class="text-xs text-muted/70 italic">{{ description }}</p>
  </div>
</template>
